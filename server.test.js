const { test } = require('node:test');
const assert = require('node:assert/strict');
const { shortIdFromUrl, akiraIdFromUrl, fichierIdFromUrl, resolveLink, resolveAkira, resolveFichier, createServer } = require('./server');

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

test('uses public file metadata when Rootz returns a cooldown', async () => {
  const calls = [];
  const id = 'f54851ba-8eb3-4861-a9f3-8790c6d3353d';
  const publicFile = { status: 'active', downloadAllowed: true, passwordProtected: false };
  const result = await resolveLink('https://rootz.so/d/example', async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return new Response(null, { status: 429, headers: { 'Retry-After': '120' } });
    if (calls.length === 2) return new Response('<script>{"pageToken":"test-token"}</script>');
    if (calls.length === 3) return Response.json({ success: true, data: { ...publicFile, fileId: id } });
    return Response.json({ success: true, data: { ...publicFile, url: 'https://cdn-files.alcyone.so/example.txt' } });
  });
  assert.deepEqual(result, { status: 200, url: 'https://cdn-files.alcyone.so/example.txt' });
  assert.equal(calls[2].options.headers['X-Page-Token'], 'test-token');
  assert.equal(calls[3].url, `https://www.rootz.so/api/files/download/${id}`);
});

test('does not return alternate URLs for protected, inactive or disallowed files', async () => {
  const id = 'f54851ba-8eb3-4861-a9f3-8790c6d3353d';
  const publicFile = { status: 'active', downloadAllowed: true, passwordProtected: false, fileId: id };
  for (const changes of [{ passwordProtected: true }, { status: 'deleted' }, { downloadAllowed: false }, { passwordProtected: undefined }]) {
    let calls = 0;
    const result = await resolveLink('https://rootz.so/d/example', async () => {
      calls++;
      if (calls === 1) return new Response(null, { status: 429, headers: { 'Retry-After': '120' } });
      if (calls === 2) return new Response('"pageToken":"test-token"');
      return Response.json({ success: true, data: { ...publicFile, ...changes } });
    });
    assert.equal(result.status, 429);
    assert.equal(calls, 3);
  }
});

test('falls back to the cooldown if the alternate response is invalid or changes access', async () => {
  const id = 'f54851ba-8eb3-4861-a9f3-8790c6d3353d';
  const publicFile = { status: 'active', downloadAllowed: true, passwordProtected: false };
  for (const changes of [{ passwordProtected: true }, { status: 'deleted' }, { downloadAllowed: false }, { url: 'https://www.rootz.so/login' }, { url: 'http://cdn.example/file' }]) {
    let calls = 0;
    const result = await resolveLink('https://rootz.so/d/example', async () => {
      calls++;
      if (calls === 1) return new Response(null, { status: 429, headers: { 'Retry-After': '120' } });
      if (calls === 2) return new Response('"pageToken":"test-token"');
      if (calls === 3) return Response.json({ success: true, data: { ...publicFile, fileId: id } });
      return Response.json({ success: true, data: { ...publicFile, url: 'https://cdn.example/file', ...changes } });
    });
    assert.equal(result.status, 429);
    assert.equal(result.retryAfter, 120);
  }
});

test('does not attempt public metadata resolution for password requests', async () => {
  let calls = 0;
  const result = await resolveLink('https://rootz.so/d/example', async () => {
    calls++;
    if (calls === 1) return Response.json({ success: true, token: 'token' });
    return new Response(null, { status: 429, headers: { 'Retry-After': '60' } });
  }, 'secret');
  assert.equal(result.status, 429);
  assert.equal(calls, 2);
});


test('validates AkiraBox URLs and rejects lookalike hosts and other paths', () => {
  assert.equal(akiraIdFromUrl('https://akirabox.to/N2p3Ddgp93Ma/file'), 'N2p3Ddgp93Ma');
  assert.equal(akiraIdFromUrl('https://www.akirabox.com/example_1/file/?share=1'), 'example_1');
  for (const url of ['https://akirabox.to.evil.test/abc/file', 'http://akirabox.to/abc/file', 'https://akirabox.to:444/abc/file', 'https://user@akirabox.to/abc/file', 'https://akirabox.to/abc/folder', 'https://akirabox.to/abc/file/extra']) assert.equal(akiraIdFromUrl(url), null);
});

test('returns a direct AkiraBox URL only from the expected download endpoint', async () => {
  let request;
  const result = await resolveAkira('https://akirabox.to/example/file', async (url, options) => {
    request = { url, options };
    return Response.json({ ok: true, url: 'https://akirabox.com/download/token/example.pkg' });
  });
  assert.equal(request.url, 'https://akirabox.to/api/files/example/download');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.redirect, 'manual');
  assert.deepEqual(result, { status: 200, url: 'https://akirabox.com/download/token/example.pkg' });
});

test('reports AkiraBox verification, unavailable files and invalid direct links', async () => {
  const source = 'https://akirabox.to/example/file';
  const verification = await resolveAkira(source, async () => Response.json({ ok: false, captcha: true }, { status: 403 }));
  assert.equal(verification.status, 403);
  assert.equal(verification.verificationUrl, source);
  assert.equal((await resolveAkira(source, async () => Response.json({ error: 'missing' }, { status: 404 }))).status, 404);
  assert.equal((await resolveAkira(source, async () => Response.json({ url: 'https://akirabox.to/example/file' }))).status, 502);
  assert.equal((await resolveAkira(source, async () => Response.json({ url: 'https://evil.test/download/token/file' }))).status, 502);
  assert.equal((await resolveAkira(source, async () => Response.json({ url: 'https://akirabox.com/download/token/file' }), 'secret')).status, 400);
});

test('HTTP endpoint routes AkiraBox requests and preserves verification information', async t => {
  const server = createServer(async () => Response.json({ ok: false, captcha: true }, { status: 403 }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://akirabox.to/example/file' }) });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).verificationUrl, 'https://akirabox.to/example/file');
});


test('validates 1fichier file links and rejects untrusted origins', () => {
  assert.equal(fichierIdFromUrl('https://1fichier.com/?abc123xyz'), 'abc123xyz');
  assert.equal(fichierIdFromUrl('https://www.1fichier.com/?abc123xyz&af=123'), 'abc123xyz');
  for (const url of ['https://1fichier.com.evil.test/?abc123', 'http://1fichier.com/?abc123', 'https://user@1fichier.com/?abc123', 'https://1fichier.com:444/?abc123', 'https://1fichier.com/api?abc123', 'https://1fichier.com/?ABC123', 'https://1fichier.com/?x']) assert.equal(fichierIdFromUrl(url), null);
});

test('requests an official 1fichier download with a per-request API key', async () => {
  let call;
  const result = await resolveFichier('https://1fichier.com/?abc123xyz&af=123', async (url, options) => {
    call = { url, options };
    return Response.json({ status: 'OK', url: 'https://a-01.1fichier.com/c123456' });
  }, 'synthetic-key', 'file-password');
  assert.equal(call.url, 'https://api.1fichier.com/v1/download/get_token.cgi');
  assert.equal(call.options.headers.Authorization, 'Bearer synthetic-key');
  assert.equal(call.options.redirect, 'manual');
  assert.deepEqual(JSON.parse(call.options.body), { url: 'https://1fichier.com/?abc123xyz', pass: 'file-password' });
  assert.deepEqual(result, { status: 200, url: 'https://a-01.1fichier.com/c123456' });
  assert.ok(!JSON.stringify(result).includes('synthetic-key'));
});

test('reports missing credentials and rejects errors and unsafe download URLs', async () => {
  const url = 'https://1fichier.com/?abc123xyz';
  let called = false;
  const missing = await resolveFichier(url, async () => { called = true; });
  assert.equal(missing.status, 401);
  assert.equal(missing.verificationUrl, url);
  assert.equal(called, false);
  assert.equal((await resolveFichier(url, async () => Response.json({ status: 'KO' }), 'key')).status, 502);
  assert.equal((await resolveFichier(url, async () => Response.json({ status: 'OK', url: 'https://evil.test/c123' }), 'key')).status, 502);
  assert.equal((await resolveFichier(url, async () => Response.json({ status: 'OK', url: 'http://a-01.1fichier.com/c123' }), 'key')).status, 502);
  assert.equal((await resolveFichier(url, async () => Response.json({ status: 'OK', url }), 'key')).status, 502);
  assert.equal((await resolveFichier(url, async () => Response.json({}), 'bad\r\nkey')).status, 400);
  assert.equal((await resolveFichier(url, async () => new Response('Forbidden', { status: 403 }), 'key')).status, 401);
  assert.equal((await resolveFichier(url, async () => new Response('Too many requests', { status: 429 }), 'key')).status, 429);
});

test('HTTP endpoint routes 1fichier with credentials without exposing them', async t => {
  const server = createServer(async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    return Response.json({ status: 'OK', url: 'https://a-01.1fichier.com/c123' });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const endpoint = `http://127.0.0.1:${server.address().port}/api/resolve`;
  const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://1fichier.com/?abc123', apiKey: 'test-key' }) });
  assert.deepEqual(await response.json(), { url: 'https://a-01.1fichier.com/c123' });
});
