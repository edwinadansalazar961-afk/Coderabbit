const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'));

function shortIdFromUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || !['rootz.so', 'www.rootz.so'].includes(url.hostname) || url.port || url.username || url.password) return null;
    const match = url.pathname.match(/^\/d\/([a-zA-Z0-9_-]{1,100})\/?$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function retrySeconds(response) {
  const value = response.headers.get('retry-after');
  if (!value) return null;
  const seconds = /^\d+$/.test(value) ? Number(value) : Math.ceil((Date.parse(value) - Date.now()) / 1000);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) : null;
}

function rateLimit(response) {
  return { status: 429, error: 'Rootz ha limitado las descargas. Espera antes de intentarlo de nuevo.', retryAfter: retrySeconds(response) };
}

// Rootz also exposes a public metadata endpoint that can return a direct URL.
// Only use it when both responses explicitly identify an active, public file.
async function readBoundedText(response, maxBytes = 1024 * 1024, requireOk = true) {
  if ((requireOk && !response.ok) || !response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    bytes += value.byteLength;
    if (bytes > maxBytes) { await reader.cancel().catch(() => {}); return null; }
    text += decoder.decode(value, { stream: true });
  }
}

function isPublicFile(data) {
  return data && data.status === 'active' && data.downloadAllowed === true && data.passwordProtected === false;
}

async function publicMetadataLink(id, fetcher, headers) {
  try {
    const base = 'https://www.rootz.so';
    const opts = { redirect: 'manual', signal: AbortSignal.timeout(15000), headers };
    const page = await fetcher(`${base}/d/${encodeURIComponent(id)}`, opts);
    const html = await readBoundedText(page);
    const token = html?.match(/pageToken\\?"\s*:\s*\\?"([^"\\]+)/)?.[1];
    if (!token || token.length > 512) return null;
    const metadata = await fetcher(`${base}/api/files/download-by-short?shortId=${encodeURIComponent(id)}`, {
      ...opts, signal: AbortSignal.timeout(15000), headers: { ...headers, 'X-Page-Token': token }
    });
    const metaText = await readBoundedText(metadata);
    if (!metaText) return null;
    const meta = JSON.parse(metaText);
    const fileId = meta?.data?.fileId;
    if (!meta.success || !isPublicFile(meta.data) || typeof fileId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fileId)) return null;
    const directResponse = await fetcher(`${base}/api/files/download/${fileId}`, { ...opts, signal: AbortSignal.timeout(15000) });
    const directText = await readBoundedText(directResponse);
    if (!directText) return null;
    const payload = JSON.parse(directText);
    if (!payload.success || !isPublicFile(payload.data) || typeof payload.data.url !== 'string') return null;
    const direct = new URL(payload.data.url);
    if (direct.protocol !== 'https:' || direct.username || direct.password || direct.hostname === 'rootz.so' || direct.hostname.endsWith('.rootz.so')) return null;
    return direct.href;
  } catch {
    return null;
  }
}

async function resolveLink(value, fetcher = fetch, password = '') {
  const id = shortIdFromUrl(value);
  if (!id) return { status: 400, error: 'Introduce un enlace válido de Rootz o AkiraBox.' };
  if (typeof password !== 'string' || password.length > 1024) return { status: 400, error: 'La contraseña no es válida.' };

  try {
    const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; RootzLinkExtractor/1.0)', Accept: '*/*' };
    let token = '';
    if (password) {
      const verification = await fetcher('https://www.rootz.so/api/files/verify-download', {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15000),
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortId: id, password })
      });
      if (verification.status === 429) return rateLimit(verification);
      if (verification.status === 400 || verification.status === 401) return { status: 401, error: 'Rootz no aceptó la contraseña. Compruébala e inténtalo de nuevo.' };
      if (!verification.ok) return { status: 502, error: 'Rootz no pudo verificar la contraseña. Inténtalo de nuevo más tarde.' };
      const data = await verification.json();
      if (!data.success || typeof data.token !== 'string' || !data.token) return { status: 401, error: 'Rootz no aceptó la contraseña. Compruébala e inténtalo de nuevo.' };
      token = data.token;
    }
    const downloadUrl = new URL(`https://www.rootz.so/api/files/proxy-download/${encodeURIComponent(id)}`);
    if (token) downloadUrl.searchParams.set('download_token', token);
    const response = await fetcher(downloadUrl.href, {
      redirect: 'manual', signal: AbortSignal.timeout(15000), headers
    });
    // Rootz may stream the file instead of redirecting. Do not download it into memory.
    if (response.body) await response.body.cancel().catch(() => {});
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      let url;
      try { url = new URL(location); } catch { /* Invalid or relative redirect. */ }
      if (url && url.protocol === 'https:' && !url.username && !url.password && url.hostname !== 'rootz.so' && !url.hostname.endsWith('.rootz.so')) {
        return { status: 200, url: url.href };
      }
      return { status: 502, error: 'Rootz no devolvió un enlace directo de descarga.' };
    }
    if (response.status === 429) {
      if (!password) {
        const url = await publicMetadataLink(id, fetcher, headers);
        if (url) return { status: 200, url };
      }
      return rateLimit(response);
    }
    if (response.status === 404) return { status: 404, error: 'Rootz no encontró el archivo. Comprueba si el enlace sigue activo.' };
    if (response.status === 401 || response.status === 403) return { status: 502, error: 'Rootz rechazó la solicitud. Comprueba si el archivo necesita contraseña o si sigue disponible.' };
    return { status: 502, error: 'Rootz no devolvió un enlace directo. El archivo puede estar protegido, caducado o no estar disponible.' };
  } catch {
    return { status: 502, error: 'No se pudo conectar con Rootz. Inténtalo de nuevo más tarde.' };
  }
}

function akiraIdFromUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || !['akirabox.to', 'www.akirabox.to', 'akirabox.com', 'www.akirabox.com'].includes(url.hostname) || url.port || url.username || url.password) return null;
    return url.pathname.match(/^\/([a-zA-Z0-9_-]{1,100})\/file\/?$/)?.[1] || null;
  } catch { return null; }
}

async function resolveAkira(value, fetcher = fetch, password = '') {
  const id = akiraIdFromUrl(value);
  if (!id) return { status: 400, error: 'Introduce un enlace válido de AkiraBox.' };
  if (typeof password !== 'string' || password.length > 1024) return { status: 400, error: 'La contraseña no es válida.' };
  if (password) return { status: 400, error: 'Para archivos de AkiraBox con contraseña, utiliza la página de AkiraBox.' };
  try {
    const response = await fetcher(`https://akirabox.to/api/files/${encodeURIComponent(id)}/download`, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}'
    });
    const body = await readBoundedText(response, 128 * 1024, false);
    let data;
    try { data = JSON.parse(body); } catch { return { status: 502, error: 'AkiraBox no devolvió una respuesta válida.' }; }
    if (data?.captcha === true) return {
      status: 403, error: 'AkiraBox requiere una verificación. Ábrelo y completa la comprobación para obtener el enlace.',
      verificationUrl: `https://akirabox.to/${encodeURIComponent(id)}/file`
    };
    if (response.status === 404) return { status: 404, error: 'AkiraBox no encontró el archivo. Comprueba si el enlace sigue activo.' };
    if (response.status === 429) return { status: 429, error: 'AkiraBox ha limitado las solicitudes. Inténtalo de nuevo más tarde.' };
    if (!response.ok || data?.ok === false || typeof data?.url !== 'string') return { status: 502, error: 'AkiraBox no devolvió un enlace directo. El archivo puede estar protegido o no estar disponible.' };
    const direct = new URL(data.url);
    if (direct.protocol !== 'https:' || direct.username || direct.password || direct.port || !['akirabox.to', 'akirabox.com'].includes(direct.hostname) || !/^\/download\/[^/]+\/[^/]+$/.test(direct.pathname)) {
      return { status: 502, error: 'AkiraBox no devolvió un enlace directo válido.' };
    }
    return { status: 200, url: direct.href };
  } catch {
    return { status: 502, error: 'No se pudo conectar con AkiraBox. Inténtalo de nuevo más tarde.' };
  }
}

function createServer(fetcher = fetch, allowedOrigin = process.env.ALLOWED_ORIGIN || '') {
  return http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    res.setHeader('Vary', 'Origin');
    if (origin && origin === allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    if (req.method === 'OPTIONS' && req.url === '/api/resolve') {
      if (!origin || origin !== allowedOrigin) {
        res.writeHead(403);
        return res.end();
      }
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' });
      return res.end();
    }
    const sendJson = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(data));
    };
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
      return res.end(html);
    }
    if (req.method !== 'POST' || req.url !== '/api/resolve') return sendJson(404, { error: 'Ruta no encontrada.' });
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return sendJson(415, { error: 'La solicitud debe ser JSON.' });
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 4096) return sendJson(413, { error: 'La solicitud es demasiado grande.' });
    }
    let input;
    try { input = JSON.parse(body); } catch { return sendJson(400, { error: 'Solicitud inválida.' }); }
    const result = akiraIdFromUrl(input?.url)
      ? await resolveAkira(input.url, fetcher, input?.password ?? '')
      : await resolveLink(input?.url, fetcher, input?.password ?? '');
    return sendJson(result.status, result.url ? { url: result.url } : { error: result.error, ...(result.retryAfter ? { retryAfter: result.retryAfter } : {}), ...(result.verificationUrl ? { verificationUrl: result.verificationUrl } : {}) });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 4173;
  createServer().listen(port, '0.0.0.0', () => console.log(`Rootz Link listo en http://localhost:${port}`));
}
module.exports = { shortIdFromUrl, akiraIdFromUrl, resolveLink, resolveAkira, createServer };
