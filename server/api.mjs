// API routes. Pure functions over the database so they can be tested without starting a server.
// Each handler returns { status, body }. Every write records the signed-in actor and an audit row.

import { audit } from './db.mjs';

const EDITABLE = {
  workstream: 'workstream',
  status: 'status',
  criticality: 'criticality',
  ramp1: 'ramp1',
  owner: 'owner',
  target: 'target',
  impact: 'impact',
  currentPosition: 'current_position',
  blocker: 'blocker',
  next: 'next_action',
  decision: 'decision',
  ask: 'ask',
};

// Fields validated against the master list (value must be in master_data for that type).
const MASTER_FIELDS = { status: 'statuses', criticality: 'criticalities', ramp1: 'ramps', workstream: 'workstreams' };

const MAX_TEXT = 4000;

const ok = (body) => ({ status: 200, body });
const created = (body) => ({ status: 201, body });
const bad = (message) => ({ status: 400, body: { error: message } });
const notFound = (what) => ({ status: 404, body: { error: `${what} not found` } });

function text(value, max = MAX_TEXT) {
  if (value === undefined || value === null) return '';
  return String(value).trim().slice(0, max);
}

function masterValues(db, type) {
  return db.prepare('SELECT value FROM master_data WHERE master_type = ? AND active = 1').all(type).map((r) => r.value);
}

function itemFromRow(row) {
  const { fields, ...typed } = row;
  return {
    id: typed.id,
    workstream: typed.workstream,
    topic: typed.topic,
    status: typed.status,
    criticality: typed.criticality,
    ramp1: typed.ramp1,
    owner: typed.owner,
    target: typed.target,
    impact: typed.impact,
    currentPosition: typed.current_position,
    blocker: typed.blocker,
    next: typed.next_action,
    decision: typed.decision,
    ask: typed.ask,
    updatedAt: typed.updated_at,
    updatedBy: typed.updated_by,
    ...JSON.parse(fields || '{}'),
  };
}

function itemExists(db, id) {
  return Boolean(db.prepare('SELECT 1 FROM items WHERE id = ?').get(id));
}

export function getMe(actor, env) {
  return ok({ name: actor, production: Boolean(env.WEBSITE_SITE_NAME) || env.NODE_ENV === 'production' });
}

export function getMaster(db) {
  const rows = db.prepare('SELECT master_type, value FROM master_data WHERE active = 1 ORDER BY master_type, value').all();
  const out = {};
  for (const r of rows) (out[r.master_type] ??= []).push(r.value);
  return ok(out);
}

export function listItems(db, query) {
  const where = [];
  const params = [];
  if (query.status) { where.push('status = ?'); params.push(query.status); }
  if (query.workstream) { where.push('workstream = ?'); params.push(query.workstream); }
  if (query.q) { where.push('(topic LIKE ? OR current_position LIKE ? OR blocker LIKE ?)'); const q = `%${query.q}%`; params.push(q, q, q); }
  const sql = `SELECT i.*, (SELECT COUNT(*) FROM supporting_actions a WHERE a.item_id = i.id AND a.progress IS NOT 'Complete') AS open_actions
    FROM items i ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY i.id`;
  const rows = db.prepare(sql).all(...params);
  return ok(rows.map((r) => ({ ...itemFromRow(r), openActions: r.open_actions })));
}

export function getSummary(db) {
  const byStatus = db.prepare('SELECT status AS key, COUNT(*) AS n FROM items GROUP BY status ORDER BY n DESC').all();
  const byWorkstream = db.prepare('SELECT workstream AS key, COUNT(*) AS n FROM items GROUP BY workstream ORDER BY n DESC').all();
  const atRisk = db.prepare("SELECT id, topic, workstream, owner, target FROM items WHERE status = 'At Risk' ORDER BY target IS NULL, target, id").all();
  return ok({ total: db.prepare('SELECT COUNT(*) AS n FROM items').get().n, byStatus, byWorkstream, atRisk });
}

export function getItem(db, id) {
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  if (!row) return notFound('Item');
  const updates = db.prepare('SELECT id, ts, type, contributor, comment, changes FROM item_updates WHERE item_id = ? ORDER BY ts DESC, id DESC').all(id)
    .map((u) => ({ ...u, changes: u.changes ? JSON.parse(u.changes) : null }));
  const actions = db.prepare('SELECT * FROM supporting_actions WHERE item_id = ? ORDER BY created_at, action_id').all(id).map((a) => ({
    actionId: a.action_id,
    action: a.action,
    owner: a.owner,
    target: a.target,
    progress: a.progress,
    support: a.support,
    dependency: a.dependency,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
    followups: db.prepare('SELECT ts, by, comment, progress, target FROM action_followups WHERE action_id = ? ORDER BY ts DESC, id DESC').all(a.action_id),
  }));
  const relationships = db.prepare(`SELECT r.relationship_type AS type, r.target_item_id AS otherId, i.topic AS otherTopic
    FROM item_relationships r JOIN items i ON i.id = r.target_item_id WHERE r.source_item_id = ? ORDER BY otherId`).all(id);
  return ok({ ...itemFromRow(row), updates, actions, relationships });
}

export function updateItem(db, actor, id, input) {
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  if (!row) return notFound('Item');
  if (!input || typeof input !== 'object') return bad('Body must be a JSON object');

  const unknown = Object.keys(input).filter((k) => !(k in EDITABLE));
  if (unknown.length) return bad(`Fields not editable: ${unknown.join(', ')}`);

  const changes = {};
  const sets = [];
  const params = [];
  for (const [field, column] of Object.entries(EDITABLE)) {
    if (!(field in input)) continue;
    let value = text(input[field], field === 'currentPosition' || field === 'blocker' || field === 'next' || field === 'ask' ? MAX_TEXT : 200);
    if (MASTER_FIELDS[field] && value !== '') {
      if (!masterValues(db, MASTER_FIELDS[field]).includes(value)) return bad(`${field} must be one of the master list values`);
    }
    // Targets stay free text: the source data mixes dates ("2026-11-02") with phrases ("2 Nov UAT").
    const before = row[column] ?? '';
    if (String(before) !== value) {
      changes[field] = { from: before, to: value };
      sets.push(`${column} = ?`);
      params.push(value === '' ? null : value);
    }
  }

  if (!sets.length) return ok({ changed: false, item: getItem(db, id).body });

  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE items SET ${sets.join(', ')}, updated_at = ?, updated_by = ? WHERE id = ?`).run(...params, now, actor, id);
    db.prepare('INSERT INTO item_updates (item_id, ts, type, contributor, comment, changes, audit) VALUES (?, ?, ?, ?, ?, ?, NULL)')
      .run(id, now, 'Field update', actor, `Updated ${Object.keys(changes).join(', ')}`, JSON.stringify(changes));
    audit(db, actor, 'item.update', 'item', id, changes);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return ok({ changed: true, item: getItem(db, id).body });
}

export function addUpdate(db, actor, id, input) {
  if (!itemExists(db, id)) return notFound('Item');
  const comment = text(input?.comment);
  if (!comment) return bad('comment is required');
  const type = text(input?.type, 100) || 'Progress update';
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO item_updates (item_id, ts, type, contributor, comment, changes, audit) VALUES (?, ?, ?, ?, ?, NULL, NULL)')
      .run(id, now, type, actor, comment);
    db.prepare('UPDATE items SET updated_at = ?, updated_by = ? WHERE id = ?').run(now, actor, id);
    audit(db, actor, 'item.update_add', 'item', id, { type });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return created(getItem(db, id).body);
}

export function addAction(db, actor, id, input) {
  if (!itemExists(db, id)) return notFound('Item');
  const action = text(input?.action, 500);
  const owner = text(input?.owner, 200);
  if (!action) return bad('action is required');
  if (!owner) return bad('owner is required: name an accountable person for every action');
  const target = text(input?.target, 100) || null;
  const now = new Date().toISOString();
  const actionId = `A${id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  db.exec('BEGIN');
  try {
    db.prepare(`INSERT INTO supporting_actions (action_id, item_id, action, owner, target, progress, created_at, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, 'Not started', ?, ?, ?)`).run(actionId, id, action, owner, target, now, now, actor);
    db.prepare('INSERT INTO action_followups (action_id, item_id, ts, by, comment, progress, target) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(actionId, id, now, actor, 'Action created.', 'Not started', target);
    audit(db, actor, 'action.create', 'action', actionId, { itemId: id, owner, target });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return created(getItem(db, id).body);
}

export function updateAction(db, actor, actionId, input) {
  const row = db.prepare('SELECT * FROM supporting_actions WHERE action_id = ?').get(actionId);
  if (!row) return notFound('Action');
  const fields = { action: 'action', owner: 'owner', target: 'target', progress: 'progress', support: 'support', dependency: 'dependency' };
  const changes = {};
  const sets = [];
  const params = [];
  for (const [field, column] of Object.entries(fields)) {
    if (!(field in (input || {}))) continue;
    const value = text(input[field], field === 'action' ? 500 : 200) || null;
    if (field === 'action' && !value) return bad('action cannot be empty');
    if (field === 'owner' && !value) return bad('owner cannot be empty');
    if ((row[column] ?? null) !== value) {
      changes[field] = { from: row[column], to: value };
      sets.push(`${column} = ?`);
      params.push(value);
    }
  }
  if (!sets.length) return ok({ changed: false });

  const now = new Date().toISOString();
  const comment = text(input?.comment) || `Updated ${Object.keys(changes).join(', ')}.`;
  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE supporting_actions SET ${sets.join(', ')}, updated_at = ?, updated_by = ? WHERE action_id = ?`).run(...params, now, actor, actionId);
    const latest = db.prepare('SELECT progress, target FROM supporting_actions WHERE action_id = ?').get(actionId);
    db.prepare('INSERT INTO action_followups (action_id, item_id, ts, by, comment, progress, target) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(actionId, row.item_id, now, actor, comment, latest.progress, latest.target);
    audit(db, actor, 'action.update', 'action', actionId, changes);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return ok({ changed: true, item: getItem(db, row.item_id).body });
}

export function listAudit(db, query) {
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 500);
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit);
  return ok(rows.map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null })));
}

// Dispatch. `parts` is the path split after /api, e.g. ['items', '12', 'updates'].
export function handle(db, { method, parts, query, body, actor, env }) {
  if (!actor) return { status: 401, body: { error: 'Not signed in' } };
  if (method === 'GET' && parts.length === 1 && parts[0] === 'me') return getMe(actor, env);
  if (method === 'GET' && parts.length === 1 && parts[0] === 'master') return getMaster(db);
  if (method === 'GET' && parts.length === 1 && parts[0] === 'summary') return getSummary(db);
  if (method === 'GET' && parts.length === 1 && parts[0] === 'audit') return listAudit(db, query);
  if (method === 'GET' && parts.length === 1 && parts[0] === 'items') return listItems(db, query);

  const id = Number(parts[1]);
  if (parts[0] === 'items' && Number.isInteger(id)) {
    if (parts.length === 2 && method === 'GET') return getItem(db, id);
    if (parts.length === 2 && method === 'PATCH') return updateItem(db, actor, id, body);
    if (parts.length === 3 && parts[2] === 'updates' && method === 'POST') return addUpdate(db, actor, id, body);
    if (parts.length === 3 && parts[2] === 'actions' && method === 'POST') return addAction(db, actor, id, body);
  }
  if (parts[0] === 'actions' && parts.length === 2 && method === 'PATCH') return updateAction(db, actor, parts[1], body);

  return { status: 404, body: { error: 'Route not found' } };
}
