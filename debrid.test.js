const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createDebrid, allowedDownloadUrl, publicIPv4 } = require('./debrid');
const { createServer } = require('./server');

function mockResponse(content, length = Buffer.byteLength(content)) {
  const response = Readable.from([Buffer.from(content)]);
  response.headers = { 'content-length': String(length), 'content-disposition': 'attachment; filename="example.txt"' };
  return response;
}
async function waitFor(service, id) {
  for (let i = 0; i < 100; i++) {
    const job = await service.get(id);
    if (job && ['ready', 'error'].includes(job.state)) return job;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Job did not complete');
}
async function fixture(t, options = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'link-studio-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return createDebrid({ directory, accessToken: 'test-access-token-long-enough', resolveSource: async () => ({ url: 'https://cdn-files.alcyone.so/example.txt' }), open: async () => mockResponse('hello world'), ...options });
}

test('restricts download destinations and rejects non-public addresses', () => {
  assert.equal(allowedDownloadUrl('https://cdn-files.alcyone.so/example'), true);
  for (const url of ['http://cdn-files.alcyone.so/x', 'https://alcyone.so.evil.test/x', 'https://user@alcyone.so/x', 'https://127.0.0.1/x', 'https://alcyone.so:444/x']) assert.equal(allowedDownloadUrl(url), false);
  for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.1.2', '192.168.1.1', '169.254.169.254', '100.64.0.1', '203.0.113.1']) assert.equal(publicIPv4(ip), false);
  assert.equal(publicIPv4('8.8.8.8'), true);
});

test('stores a resolved file and expires it', async t => {
  const service = await fixture(t, { ttlMs: 300 });
  assert.equal(service.authorized('wrong'), false);
  assert.equal(service.authorized('test-access-token-long-enough'), true);
  const id = await service.submit({ url: 'https://rootz.so/d/test' });
  const job = await waitFor(service, id);
  assert.equal(job.state, 'ready');
  assert.equal(job.filename, 'example.txt');
  assert.equal(await fs.readFile(service.pathFor(id), 'utf8'), 'hello world');
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(await service.get(id), null);
  await assert.rejects(fs.stat(service.pathFor(id)), { code: 'ENOENT' });
});

test('enforces file quota and removes partial data', async t => {
  const service = await fixture(t, { maxBytes: 4 });
  const id = await service.submit({ url: 'https://rootz.so/d/test' });
  const job = await waitFor(service, id);
  assert.equal(job.state, 'error');
  assert.match(job.error, /espacio/);
  await assert.rejects(fs.stat(service.pathFor(id)), { code: 'ENOENT' });
});

test('HTTP service requires a key and provides a capability link with range support', async t => {
  const service = await fixture(t);
  const server = createServer(fetch, '', service);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const body = JSON.stringify({ url: 'https://rootz.so/d/test' });
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer test-access-token-long-enough' };
  assert.equal((await fetch(`${base}/api/debrid/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 401);
  const submitted = await fetch(`${base}/api/debrid/jobs`, { method: 'POST', headers, body });
  assert.equal(submitted.status, 202);
  const { id } = await submitted.json();
  await waitFor(service, id);
  const status = await fetch(`${base}/api/debrid/jobs/${id}`, { headers });
  assert.equal((await status.json()).state, 'ready');
  const response = await fetch(`${base}/api/debrid/files/${id}`, { headers: { Range: 'bytes=0-4' } });
  assert.equal(response.status, 206);
  assert.equal(await response.text(), 'hello');
  assert.equal((await fetch(`${base}/api/debrid/files/${id}`, { headers: { Range: 'bytes=99-100' } })).status, 416);
});

test('counts orphaned files against storage quota after restart', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'link-studio-orphan-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, `${'b'.repeat(64)}.bin`), '12345678');
  const service = createDebrid({ directory, accessToken: 'test-access-token-long-enough', totalBytes: 10, resolveSource: async () => ({ url: 'https://cdn-files.alcyone.so/example' }), open: async () => mockResponse('hello') });
  const id = await service.submit({ url: 'https://rootz.so/d/test' });
  const job = await waitFor(service, id);
  assert.equal(job.state, 'error');
  assert.match(job.error, /espacio/);
});

test('reports provider verification without retaining submitted secrets', async t => {
  const service = await fixture(t, { resolveSource: async () => ({ error: 'Se requiere verificación.', verificationUrl: 'https://akirabox.to/example/file' }) });
  const id = await service.submit({ url: 'https://akirabox.to/example/file', password: 'synthetic-password', apiKey: 'synthetic-key' });
  const job = await waitFor(service, id);
  assert.equal(job.state, 'error');
  assert.equal(job.verificationUrl, 'https://akirabox.to/example/file');
  assert.ok(!JSON.stringify(job).includes('synthetic-password'));
  assert.ok(!JSON.stringify(job).includes('synthetic-key'));
});

test('authorizes CORS preflight only for the configured origin', async t => {
  const service = await fixture(t);
  const origin = 'https://example.github.io';
  const server = createServer(fetch, origin, service);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/api/debrid/jobs`;
  const response = await fetch(url, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.match(response.headers.get('access-control-allow-headers'), /Authorization/i);
  assert.equal((await fetch(url, { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } })).status, 403);
});

test('disabled service does not accept jobs', async t => {
  const server = createServer(fetch, '', null);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/debrid/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 503);
});
