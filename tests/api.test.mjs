import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../server/api.mjs';
import { resolveActor } from '../server/identity.mjs';
import { seedDatabase, } from '../server/seed.mjs';
import { openDatabase } from '../server/db.mjs';
import { makeFixtureDir, seededDb } from './helpers.mjs';

const dev = {};
const call = (db, method, path, body, actor = 'Alice Example', query = {}) => {
  const [pathname, qs] = path.split('?');
  const parts = pathname.replace(/^\//, '').split('/');
  const q = qs ? Object.fromEntries(new URLSearchParams(qs)) : query;
  return handle(db, { method, parts, query: q, body, actor, env: dev });
};

test('seed loads every table and the audit records the import', () => {
  const db = seededDb();
  const { body } = call(db, 'GET', '/items');
  assert.equal(body.length, 2);
  const [first] = body;
  assert.equal(first.topic, 'Invoice posting');
  assert.equal(first.currentPosition, 'Pilot running');
  assert.equal(first.openActions, 1);
  const audit = call(db, 'GET', '/audit').body;
  assert.equal(audit[0].action, 'seed');
});

test('seed refuses to overwrite existing data without reset', () => {
  const db = seededDb();
  assert.throws(() => seedDatabase(db, makeFixtureDir()), /already holds data/);
  const counts = seedDatabase(db, makeFixtureDir(), { reset: true });
  assert.equal(counts.items, 2);
});

test('item detail includes updates, actions with follow-ups and relationships', () => {
  const db = seededDb();
  const { status, body } = call(db, 'GET', '/items/1');
  assert.equal(status, 200);
  assert.equal(body.updates.length, 1);
  assert.equal(body.actions[0].owner, 'Owner A');
  assert.equal(body.actions[0].followups.length, 1);
  // node:sqlite rows have a null prototype, so compare as plain JSON as the HTTP layer would send them.
  assert.deepEqual(JSON.parse(JSON.stringify(body.relationships)), [{ type: 'Blocks', otherId: 2, otherTopic: 'Rail matching' }]);
  assert.equal(body.description, 'Synthetic description', 'source-only fields are kept');
});

test('editing an item records who changed what, and only the changed fields', () => {
  const db = seededDb();
  const res = call(db, 'PATCH', '/items/1', { status: 'In Progress', owner: 'Owner C' }, 'Bob Example');
  assert.equal(res.status, 200);
  assert.equal(res.body.changed, true);
  assert.equal(res.body.item.status, 'In Progress');
  assert.equal(res.body.item.updatedBy, 'Bob Example');
  const last = call(db, 'GET', '/items/1').body.updates[0];
  assert.equal(last.contributor, 'Bob Example');
  assert.deepEqual(Object.keys(last.changes).sort(), ['owner', 'status']);
  assert.deepEqual(call(db, 'GET', '/audit').body[0].details, { status: { from: 'At Risk', to: 'In Progress' }, owner: { from: 'Owner A', to: 'Owner C' } });
});

test('an edit with no real change is a no-op', () => {
  const db = seededDb();
  const res = call(db, 'PATCH', '/items/1', { status: 'At Risk' });
  assert.equal(res.body.changed, false);
  assert.equal(call(db, 'GET', '/items/1').body.updates.length, 1);
});

test('edits are validated against the master list and the editable fields', () => {
  const db = seededDb();
  assert.equal(call(db, 'PATCH', '/items/1', { status: 'Made up' }).status, 400);
  assert.equal(call(db, 'PATCH', '/items/1', { topic: 'Renamed' }).status, 400, 'topic is not editable');
  assert.equal(call(db, 'PATCH', '/items/999', { status: 'Closed' }).status, 404);
});

test('an update needs a comment and records the signed-in author', () => {
  const db = seededDb();
  assert.equal(call(db, 'POST', '/items/1/updates', { comment: '   ' }).status, 400);
  const res = call(db, 'POST', '/items/1/updates', { comment: 'Vendor call held', type: 'Decision' }, 'Carol Example');
  assert.equal(res.status, 201);
  assert.equal(res.body.updates[0].contributor, 'Carol Example');
  assert.equal(res.body.updates[0].type, 'Decision');
});

test('an action needs an owner, and progress changes leave a follow-up', () => {
  const db = seededDb();
  assert.equal(call(db, 'POST', '/items/1/actions', { action: 'Chase vendor', owner: '' }).status, 400);
  const created = call(db, 'POST', '/items/1/actions', { action: 'Chase vendor', owner: 'Dan Example', target: '2026-12-01' }, 'Dan Example');
  assert.equal(created.status, 201);
  const newAction = created.body.actions.find((a) => a.action === 'Chase vendor');
  assert.equal(newAction.progress, 'Not started');
  assert.equal(newAction.followups[0].comment, 'Action created.');

  const res = call(db, 'PATCH', `/actions/${newAction.actionId}`, { progress: 'Complete' }, 'Dan Example');
  assert.equal(res.body.changed, true);
  const updated = res.body.item.actions.find((a) => a.actionId === newAction.actionId);
  assert.equal(updated.progress, 'Complete');
  assert.equal(updated.followups[0].progress, 'Complete');
});

test('unknown routes and actions return clear errors', () => {
  const db = seededDb();
  assert.equal(call(db, 'GET', '/nope').status, 404);
  assert.equal(call(db, 'PATCH', '/actions/missing', { progress: 'Complete' }).status, 404);
});

test('requests with no signed-in user are refused', () => {
  const db = seededDb();
  const res = handle(db, { method: 'GET', parts: ['items'], query: {}, actor: null, env: dev });
  assert.equal(res.status, 401);
});

test('identity comes from App Service in production and never falls back to the dev user', () => {
  const prod = { WEBSITE_SITE_NAME: 'hub-app' };
  assert.equal(resolveActor({}, prod), null);
  assert.equal(resolveActor({ 'x-ms-client-principal-name': 'eve@maersk.com' }, prod), 'eve@maersk.com');
  assert.equal(resolveActor({}, { HUB_DEV_USER: 'dev-person' }), 'dev-person');
  assert.equal(resolveActor({}, {}), 'local-dev');
});

test('the summary counts by status and lists at-risk items', () => {
  const db = seededDb();
  const { body } = call(db, 'GET', '/summary');
  assert.equal(body.total, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(body.byStatus.find((s) => s.key === 'At Risk'))), { key: 'At Risk', n: 1 });
  assert.equal(body.atRisk[0].id, 1);
});

test('the register filters by status and search text', () => {
  const db = seededDb();
  assert.equal(call(db, 'GET', '/items?status=Closed').body.length, 1);
  assert.equal(call(db, 'GET', '/items?q=vendor').body[0].id, 1);
  assert.equal(call(db, 'GET', '/items?workstream=Rail').body[0].id, 2);
});

test('the audit query honours its limit', () => {
  const db = openDatabase(':memory:');
  seedDatabase(db, makeFixtureDir());
  const rows = call(db, 'GET', '/audit?limit=1').body;
  assert.equal(rows.length, 1);
});
