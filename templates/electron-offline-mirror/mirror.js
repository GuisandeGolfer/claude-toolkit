// Cache-through HTTP mirror for an Electron session: every GET to an in-scope URL is stored on disk
// (decoded body + {url,status,headers} sidecar) and replayed later, so a web app runs offline.
//   cache   (default): disk first, network on a miss (and store it)
//   refresh          : network first, disk as fallback (pick up a new build of the site)
//   offline          : disk only; misses get 504 and are logged to misses.log
// BO1Z_TRACE / MIRROR_TRACE=1 logs START/END per request to trace.log (finds hung or failing requests).
//
// Lessons baked in (from mirroring vel.gg/bo1z):
// - Bodies come back decoded from net.fetch, so drop content-encoding/length and re-derive
//   content-length from the stored body. Some loaders check Content-Length on whole files.
// - Cache 404s too: apps often probe optional files and treat 404 as "absent", but a 504 makes them throw.
// - Key page URLs by path only (rules.pageKeys regexes), because client-only query params (?perf=1) otherwise
//   make the page miss offline. Everything else keeps its query (?part=k, ?v=<hash>) since it selects bytes.
//   Don't use "last path segment has no dot" as the page test: CDN chunk URLs like .../file.br/0?v=x match it.
// - Media elements send unpredictable Range requests: store the whole file once, then slice it (readRange).
// - Include the Range header in the key so resumable downloads replay exactly.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { net } = require('electron');

const DROP = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'set-cookie',
  'alt-svc', 'cf-ray', 'report-to', 'nel', 'date', 'age']);
const CACHEABLE = new Set([200, 206, 404]);

/**
 * @param {string} dir   mirror directory
 * @param {'cache'|'refresh'|'offline'} mode
 * @param {{ scope: RegExp[], stub?: { match: RegExp, status: number, getStatus?: number }[] }} rules
 *   scope: URLs that get mirrored. stub: URLs answered locally without network (telemetry, analytics).
 *   pageKeys: regexes for page URLs whose query string is ignored in the cache key.
 */
function createMirror(dir, mode, rules) {
  fs.mkdirSync(dir, { recursive: true });
  const missLog = path.join(dir, 'misses.log');
  const tracePath = (process.env.MIRROR_TRACE || process.env.BO1Z_TRACE) ? path.join(dir, 'trace.log') : null;
  const trace = line => tracePath && fs.appendFileSync(tracePath, `${new Date().toISOString()} ${line}\n`);
  const stats = { hits: 0, stored: 0, misses: 0, passthrough: 0, stubbed: 0 };

  const pageKeys = rules.pageKeys ?? [];
  const keyUrl = raw => { const u = new URL(raw); if (pageKeys.some(r => r.test(u.origin + u.pathname))) u.search = ''; return u.href; };
  const keyFor = (method, url, range = '') => crypto.createHash('sha256').update(`${method} ${keyUrl(url)} ${range}`).digest('hex');
  const keyOf = req => keyFor(req.method, req.url, req.headers.get('range') ?? '');
  const files = key => { const base = path.join(dir, key.slice(0, 2), key); return { body: base + '.body', meta: base + '.json' }; };
  const withLength = (headers, body) => ({ ...headers, 'content-length': String(body.length) });

  async function read(key) {
    const f = files(key);
    try {
      const meta = JSON.parse(await fs.promises.readFile(f.meta, 'utf8'));
      const body = await fs.promises.readFile(f.body);
      return new Response(body, { status: meta.status, headers: withLength(meta.headers, body) });
    } catch { return null; }
  }

  async function readRange(req) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '');
    if (!m) return null;
    const f = files(keyFor('GET', req.url));
    let meta, body;
    try { meta = JSON.parse(await fs.promises.readFile(f.meta, 'utf8')); body = await fs.promises.readFile(f.body); }
    catch { return null; }
    if (meta.status !== 200) return null;
    const size = body.length;
    let start = m[1] === '' ? size - Number(m[2]) : Number(m[1]);
    const end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
    if (start < 0) start = 0;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...meta.headers, 'content-range': `bytes */${size}` } });
    const slice = body.subarray(start, end + 1);
    return new Response(slice, { status: 206, headers: { ...meta.headers, 'accept-ranges': 'bytes',
      'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(slice.length) } });
  }

  async function fetchAndStore(req, key) {
    const res = await net.fetch(req, { bypassCustomProtocolHandlers: true });
    const body = Buffer.from(await res.arrayBuffer());
    const headers = {};
    for (const [k, v] of res.headers) if (!DROP.has(k)) headers[k] = v;
    if (CACHEABLE.has(res.status)) {
      const f = files(key);
      await fs.promises.mkdir(path.dirname(f.body), { recursive: true });
      await fs.promises.writeFile(f.body + '.tmp', body);
      await fs.promises.rename(f.body + '.tmp', f.body);
      await fs.promises.writeFile(f.meta, JSON.stringify({ url: req.url, status: res.status, headers }));
      stats.stored++;
    }
    return new Response(body, { status: res.status, headers: withLength(headers, body) });
  }

  function miss(req) {
    stats.misses++;
    fs.appendFile(missLog, `${new Date().toISOString()} ${req.method} ${req.url} ${req.headers.get('range') ?? ''}\n`, () => {});
    return new Response('offline: not in mirror', { status: 504 });
  }

  async function route(req) {
    const stub = rules.stub?.find(s => s.match.test(req.url));
    if (stub) { stats.stubbed++; return new Response(null, { status: req.method === 'GET' ? (stub.getStatus ?? stub.status) : stub.status }); }
    const inScope = rules.scope.some(r => r.test(req.url));
    if (!inScope || req.method !== 'GET') {
      stats.passthrough++;
      if (mode === 'offline') return new Response(null, { status: inScope ? 204 : 504 });
      return net.fetch(req, { bypassCustomProtocolHandlers: true });
    }
    const key = keyOf(req);
    if (mode === 'refresh') {
      try { return await fetchAndStore(req, key); } catch { return (await read(key)) ?? miss(req); }
    }
    const cached = (await read(key)) ?? (await readRange(req));
    if (cached) { stats.hits++; return cached; }
    if (mode === 'offline') return miss(req);
    try { return await fetchAndStore(req, key); } catch { return miss(req); }
  }

  return {
    stats,
    async handle(req) {
      if (!tracePath) return route(req);
      const t0 = Date.now(), tag = `${req.method} ${req.url} ${req.headers.get('range') ?? ''}`;
      trace(`START ${tag}`);
      try { const res = await route(req); trace(`END ${res.status} ${Date.now() - t0}ms ${tag}`); return res; }
      catch (e) { trace(`FAIL ${e.message} ${tag}`); throw e; }
    },
  };
}

module.exports = { createMirror };
