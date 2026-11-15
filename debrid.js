'use strict';

const crypto = require('node:crypto');
const dns = require('node:dns');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const https = require('node:https');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const HOSTS = ['alcyone.so', 'akirabox.com', 'akirabox.to', '1fichier.com', 'alterupload.com', 'cjoint.net', 'desfichiers.com', 'dfichiers.com', 'megadl.fr', 'mesfichiers.org', 'piecejointe.net', 'pjointe.com', 'tenvoi.com', 'dl4free.com'];
const JOB_ID = /^[a-f0-9]{64}$/;

function allowedDownloadUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    return HOSTS.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch { return false; }
}

function publicIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b, c] = parts;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}

// Resolve and pin an IPv4 address for each connection; never connect to local networks.
function publicLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true, family: 4 }, (err, addresses) => {
    if (err) return callback(err);
    const address = addresses.find(item => publicIPv4(item.address));
    if (!address) return callback(new Error('No public address'));
    if (options.all) callback(null, [address]);
    else callback(null, address.address, 4);
  });
}

async function openDownload(value, redirects = 0) {
  if (!allowedDownloadUrl(value) || redirects > 3) throw new Error('La dirección de descarga no es compatible.');
  return new Promise((resolve, reject) => {
    const request = https.get(value, { lookup: publicLookup, agent: false, timeout: 30000, signal: AbortSignal.timeout(2 * 60 * 60 * 1000), headers: { 'User-Agent': 'LinkStudio/1.0', Accept: '*/*' } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        const location = response.headers.location;
        response.resume();
        if (!location) return reject(new Error('Redirección inválida.'));
        let next;
        try { next = new URL(location, value).href; } catch { return reject(new Error('Redirección inválida.')); }
        return resolve(openDownload(next, redirects + 1));
      }
      if (response.statusCode !== 200) { response.resume(); return reject(new Error('El proveedor no entregó el archivo.')); }
      resolve(response);
    });
    request.on('timeout', () => request.destroy(new Error('La descarga tardó demasiado.')));
    request.on('error', reject);
  });
}

function safeFilename(header, url) {
  const name = /filename\*=UTF-8''([^;]+)/i.exec(header || '')?.[1] || /filename="?([^";]+)"?/i.exec(header || '')?.[1] || new URL(url).pathname.split('/').pop() || 'archivo';
  let decoded; try { decoded = decodeURIComponent(name); } catch { decoded = name; }
  return [...decoded.replace(/[\\/\x00-\x1f\x7f]/g, '_')].slice(0, 200).join('') || 'archivo';
}

function validAccessToken(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !expected) return false;
  const a = Buffer.from(provided); const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createDebrid({ directory, accessToken, resolveSource, open = openDownload, maxBytes = 10 * 1024 ** 3, totalBytes = 20 * 1024 ** 3, ttlMs = 60 * 60 * 1000, maxJobs = 5 }) {
  if (!directory || typeof accessToken !== 'string' || !/^[A-Za-z0-9_-]{24,512}$/.test(accessToken)) throw new Error('Configure a storage directory and a 24-512 character URL-safe access token.');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const jobs = new Map();
  const pending = [];
  let running = false;
  let used = 0;

  // On restart, old jobs cannot be recovered; count their bytes until cleanup.
  const orphans = new Map();
  const initialized = (async () => {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.(?:part|bin)$/.test(entry.name)) continue;
      const stats = await fsp.stat(path.join(directory, entry.name)).catch(() => null);
      if (stats) { orphans.set(entry.name, stats.size); used += stats.size; }
    }
  })();
  async function cleanExpired() {
    const now = Date.now();
    for (const [id, job] of jobs) {
      if (job.expiresAt && job.expiresAt <= now) {
        jobs.delete(id);
        if (job.state === 'ready') { await fsp.rm(path.join(directory, `${id}.bin`), { force: true }); used -= job.size; }
      }
    }
  }
  async function cleanOrphans() {
    for (const [name, size] of orphans) {
      const file = path.join(directory, name);
      const stats = await fsp.stat(file).catch(() => null);
      if (!stats || Date.now() - stats.mtimeMs > ttlMs) {
        if (stats) await fsp.rm(file, { force: true });
        if (orphans.delete(name)) used -= size;
      }
    }
  }
  const cleanupTimer = setInterval(() => { void initialized.then(cleanExpired).then(cleanOrphans).catch(() => {}); }, 60 * 1000);
  cleanupTimer.unref();

  async function run() {
    if (running) return;
    running = true;
    try {
      while (pending.length) {
        const item = pending.shift();
        const job = jobs.get(item.id);
        if (!job) continue;
        const partial = path.join(directory, `${item.id}.part`);
        try {
          job.state = 'resolving';
          const resolved = await resolveSource(item.input);
          item.input = null;
          if (!resolved.url) { if (resolved.verificationUrl) job.verificationUrl = resolved.verificationUrl; throw new Error(resolved.error || 'No se pudo obtener el enlace.'); }
          if (!allowedDownloadUrl(resolved.url)) throw new Error('La dirección de descarga no es compatible.');
          job.state = 'downloading';
          const response = await open(resolved.url);
          if (/^text\/html(?:;|$)/i.test(response.headers['content-type'] || '')) { response.destroy(); throw new Error('El proveedor devolvió una página en lugar del archivo.'); }
          const length = Number(response.headers['content-length']);
          if (Number.isFinite(length) && length > 0 && (length > maxBytes || used + length > totalBytes)) {
            response.destroy(); throw new Error('El archivo supera el espacio disponible.');
          }
          job.filename = safeFilename(response.headers['content-disposition'], resolved.url);
          job.total = Number.isFinite(length) && length > 0 ? length : null;
          const limit = new Transform({ transform(chunk, encoding, callback) {
            job.size += chunk.length;
            if (job.size > maxBytes || used + job.size > totalBytes) return callback(new Error('El archivo supera el espacio disponible.'));
            callback(null, chunk);
          } });
          await pipeline(response, limit, fs.createWriteStream(partial, { flags: 'wx', mode: 0o600 }));
          await fsp.rename(partial, path.join(directory, `${item.id}.bin`));
          used += job.size; job.state = 'ready'; job.expiresAt = Date.now() + ttlMs;
        } catch (error) {
          item.input = null;
          await fsp.rm(partial, { force: true }).catch(() => {});
          job.state = 'error'; job.error = error.message || 'No se pudo descargar el archivo.'; job.expiresAt = Date.now() + ttlMs;
        }
      }
    } finally { running = false; }
  }

  async function submit(input) {
    await initialized;
    await cleanExpired();
    await cleanOrphans();
    if (jobs.size >= maxJobs) return null;
    const id = crypto.randomBytes(32).toString('hex');
    jobs.set(id, { id, state: 'queued', size: 0, total: null, filename: null, expiresAt: null });
    pending.push({ id, input });
    void run();
    return id;
  }
  async function get(id) { await initialized; await cleanExpired(); return JOB_ID.test(id) ? jobs.get(id) || null : null; }
  return { submit, get, pathFor: id => path.join(directory, `${id}.bin`), authorized: value => validAccessToken(value, accessToken) };
}

module.exports = { createDebrid, allowedDownloadUrl, publicIPv4, validAccessToken };
