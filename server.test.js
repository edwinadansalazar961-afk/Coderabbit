const { test } = require('node:test');
const assert = require('node:assert/strict');
const { shortIdFromUrl, resolveLink, createServer } = require('./server');

test('accepts Rootz download links and rejects other hosts and paths', () => {
  assert.equal(shortIdFromUrl(' https://www.rootz.so/d/aXcg4?ref=share '), 'aXcg4');
  assert.equal(shortIdFromUrl('https://rootz.so/d/other-123_/'), 'other-123_');
  for (const url of ['https://rootz.so.evil.test/d/aXcg4', 'http://rootz.so/d/aXcg4', 'https://rootz.so:444/d/aXcg4', 'https://rootz.so/d/a/b', 'https://user@rootz.so/d/a', 'not a url']) assert.equal(shortIdFromUrl(url), null);
});

test('resolves the upstream redirect without following it', async () => {
  let called;
  const result = await resolveLink('https://rootz.so/d/aXcg4', async (url, options) => {
    called = { url, options };
    return new Response(null, { status: 302, headers: { location: 'https://cdn-files.alcyone.so/anonymous/file.txt?filename=file.txt' } });
  });
  assert.equal(called.url, 'https://www.rootz.so/api/files/proxy-download/aXcg4');
  assert.equal(called.options.redirect, 'manual');
  assert.deepEqual(result, { status: 200, url: 'https://cdn-files.alcyone.so/anonymous/file.txt?filename=file.txt' });
});

test('reports upstream failure and rejects redirects to Rootz pages', async () => {
  for (const status of [403, 404, 429, 200]) assert.notEqual((await resolveLink('https://rootz.so/d/a', async () => new Response(null, { status }))).status, 200);
  assert.equal((await resolveLink('https://rootz.so/d/a', async () => new Response(null, { status: 302, headers: { location: 'https://www.rootz.so/login' } }))).status, 502);
  assert.equal((await resolveLink('https://rootz.so/d/a', async () => { throw Error('offline'); })).status, 502);
});

test('HTTP endpoint serves the page and returns the resolved link', async t => {
  const server = createServer(async () => new Response(null, { status: 302, headers: { location: 'https://cdn-files.alcyone.so/test.txt' } }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Obtener enlace directo/);
  const response = await fetch(`${base}/api/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://rootz.so/d/example' }) });
  assert.deepEqual(await response.json(), { url: 'https://cdn-files.alcyone.so/test.txt' });
});


test('verifies passwords with Rootz and passes its token to the download endpoint', async () => {
  const calls = [];
  const result = await resolveLink('https://rootz.so/d/example', async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return Response.json({ success: true, token: 'signed token' });
    return new Response(null, { status: 302, headers: { location: 'https://cdn-files.alcyone.so/file' } });
  }, 'secret password');
  assert.equal(calls[0].url, 'https://www.rootz.so/api/files/verify-download');
  assert.deepEqual(JSON.parse(calls[0].options.body), { shortId: 'example', password: 'secret password' });
  assert.equal(new URL(calls[1].url).searchParams.get('download_token'), 'signed token');
  assert.deepEqual(result, { status: 200, url: 'https://cdn-files.alcyone.so/file' });
});

test('handles incorrect passwords and upstream cooldown without requesting a download', async () => {
  let calls = 0;
  const incorrect = await resolveLink('https://rootz.so/d/example', async () => {
    calls++;
    return Response.json({ success: false }, { status: 401 });
  }, 'wrong');
  assert.equal(incorrect.status, 401);
  assert.equal(calls, 1);
  const limited = await resolveLink('https://rootz.so/d/example', async () => new Response(null, { status: 429, headers: { 'retry-after': '12' } }));
  assert.equal(limited.status, 429);
  assert.equal(limited.retryAfter, 12);
});

test('HTTP endpoint validates content type and malformed input', async t => {
  const server = createServer(() => { throw new Error('should not fetch'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const endpoint = `http://127.0.0.1:${server.address().port}/api/resolve`;
  assert.equal((await fetch(endpoint, { method: 'POST', body: '{}' })).status, 415);
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://example.com/d/a' }) })).status, 400);
});

test('allows the configured Pages origin to use the API and rejects other preflights', async t => {
  const origin = 'https://edwinadansalazar961-afk.github.io';
  const server = createServer(async () => new Response(null, { status: 302, headers: { location: 'https://cdn-files.alcyone.so/file' } }), origin);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const endpoint = `http://127.0.0.1:${server.address().port}/api/resolve`;
  const preflight = await fetch(endpoint, { method: 'OPTIONS', headers: { origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  assert.equal(preflight.headers.get('access-control-allow-headers'), 'Content-Type');
  const response = await fetch(endpoint, { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://rootz.so/d/example' }) });
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.deepEqual(await response.json(), { url: 'https://cdn-files.alcyone.so/file' });
  const rejected = await fetch(endpoint, { method: 'OPTIONS', headers: { origin: 'https://example.com' } });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get('access-control-allow-origin'), null);
});
