// HTTP server: API under /api, built UI from dist/ everywhere else.
// Usage: npm run build && npm start
// Env: PORT, HUB_HOST, HUB_DB_PATH (must sit outside the deployed folder on App Service), HUB_DEV_USER (local only).
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.mjs';
import { handle } from './api.mjs';
import { resolveActor } from './identity.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const distDir = join(root, 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

const MAX_BODY_BYTES = 100 * 1024;
const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
};

function sendJson(res, status, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolveBody(undefined);
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Body must be valid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(res, pathname) {
  const safe = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
  let file = join(distDir, safe);
  if (!file.startsWith(distDir)) return sendJson(res, 400, { error: 'Bad path' });
  try {
    if (!statSync(file).isFile()) throw new Error('not a file');
  } catch {
    file = join(distDir, 'index.html'); // single-page app fallback
  }
  try {
    const data = readFileSync(file);
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'UI not built. Run npm run build first.' });
  }
}

export function createHubServer(db, env = process.env) {
  return createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' });
      return serveStatic(res, url.pathname);
    }

    const actor = resolveActor(req.headers, env);
    if (WRITE_METHODS.has(req.method) && !String(req.headers['content-type'] || '').includes('application/json')) {
      return sendJson(res, 415, { error: 'Writes must be sent as application/json' });
    }

    try {
      const body = WRITE_METHODS.has(req.method) ? await readBody(req) : undefined;
      const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
      const query = Object.fromEntries(url.searchParams.entries());
      const result = handle(db, { method: req.method, parts, query, body, actor, env });
      sendJson(res, result.status, result.body);
    } catch (error) {
      if (error.status) return sendJson(res, error.status, { error: error.message });
      console.error('Unhandled API error:', error);
      sendJson(res, 500, { error: 'Unexpected error. The details are in the server log.' });
    }
  });
}

// CLI entry point
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dbPath = process.env.HUB_DB_PATH || join(root, 'data', 'hub.sqlite');
  const db = openDatabase(dbPath);
  const count = db.prepare('SELECT COUNT(*) AS n FROM items').get().n;
  if (count === 0) console.warn('The database is empty. Run: npm run seed -- <importer output dir>');
  const port = Number(process.env.PORT || 8787);
  // Azure App Service reaches the app only on all interfaces. Locally, stay on loopback.
  const runningInAzure = Boolean(process.env.WEBSITE_SITE_NAME);
  const host = process.env.HUB_HOST || (runningInAzure || process.env.PORT ? '0.0.0.0' : '127.0.0.1');
  createHubServer(db).listen(port, host, () => {
    console.log(`IBS India readiness hub on http://${host}:${port} (database: ${dbPath})`);
  });
}
