import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHubServer } from '../server/index.mjs';
import { seededDb } from './helpers.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const distDir = join(root, 'dist');
const distExisted = existsSync(distDir);

let server;
let base;
const env = { HUB_DEV_USER: 'Test User' };

before(async () => {
  // Built UI is served from dist/. Create a tiny stand-in page so the static path can be tested.
  mkdirSync(distDir, { recursive: true });
  writeFileSync(join(distDir, 'index.html'), '<!doctype html><title>test</title>');
  server = createHubServer(seededDb(), env);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  if (!distExisted) rmSync(distDir, { recursive: true, force: true });
});

test('API returns the signed-in user and rejects unknown routes', async () => {
  const me = await fetch(`${base}/api/me`).then((r) => r.json());
  assert.equal(me.name, 'Test User');
  const missing = await fetch(`${base}/api/nope`);
  assert.equal(missing.status, 404);
});

test('a write must be sent as JSON', async () => {
  const res = await fetch(`${base}/api/items/1/updates`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'hi' });
  assert.equal(res.status, 415);
});

test('a JSON write is recorded against the signed-in user', async () => {
  const res = await fetch(`${base}/api/items/1/updates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment: 'Reviewed in test' }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.updates[0].contributor, 'Test User');
});

test('malformed JSON gets a 400, not a crash', async () => {
  const res = await fetch(`${base}/api/items/1`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  assert.equal(res.status, 400);
});

test('responses carry security headers and are not cached', async () => {
  const res = await fetch(`${base}/api/summary`);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
});

test('the UI is served and unknown paths fall back to the app page', async () => {
  const page = await fetch(`${base}/some/client/route`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>test<\/title>/);
});

test('path traversal outside dist/ is not served', async () => {
  const res = await fetch(`${base}/..%2F..%2Fpackage.json`);
  const text = await res.text();
  assert.ok(!text.includes('"name": "ibs-india-readiness-hub"'), 'package.json must not be served');
});
