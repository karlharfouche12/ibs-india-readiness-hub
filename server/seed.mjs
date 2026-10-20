// Loads the importer output (migration/output, written by tools/import-release76.mjs) into the SQLite store.
// Usage: node server/seed.mjs <importerOutDir> [--db <file>] [--reset]
//
// Refuses to write into a database that already has audit history unless --reset is given,
// so re-running the seed cannot silently wipe recorded changes.
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, audit } from './db.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Item fields with a dedicated column. Everything else goes into the `fields` JSON column.
const TYPED = {
  workstream: 'workstream',
  topic: 'topic',
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

function readJson(outDir, name) {
  return JSON.parse(readFileSync(join(outDir, `${name}.json`), 'utf8'));
}

export function seedDatabase(db, outDir, { reset = false } = {}) {
  const auditRows = db.prepare('SELECT COUNT(*) AS n FROM audit_log').get().n;
  const itemRows = db.prepare('SELECT COUNT(*) AS n FROM items').get().n;
  if ((auditRows > 0 || itemRows > 0) && !reset) {
    throw new Error('Database already holds data. Re-run with --reset to replace it.');
  }

  const items = readJson(outDir, 'items');
  const updates = readJson(outDir, 'item_updates');
  const actions = readJson(outDir, 'supporting_actions');
  const followups = readJson(outDir, 'action_followups');
  const relationships = readJson(outDir, 'item_relationships');
  const master = readJson(outDir, 'master_data');

  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM action_followups; DELETE FROM supporting_actions; DELETE FROM item_updates; DELETE FROM item_relationships; DELETE FROM master_data; DELETE FROM items; DELETE FROM audit_log;');

    const insertItem = db.prepare(`INSERT INTO items (id, workstream, topic, status, criticality, ramp1, owner, target, impact,
      current_position, blocker, next_action, decision, ask, fields, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`);
    for (const it of items) {
      const typed = Object.fromEntries(Object.values(TYPED).map((c) => [c, null]));
      const rest = {};
      for (const [key, value] of Object.entries(it)) {
        if (key === 'id') continue;
        if (key in TYPED) typed[TYPED[key]] = value ?? null;
        else rest[key] = value;
      }
      insertItem.run(
        it.id, typed.workstream ?? '', typed.topic ?? '', typed.status ?? '', typed.criticality, typed.ramp1,
        typed.owner, typed.target, typed.impact, typed.current_position, typed.blocker, typed.next_action,
        typed.decision, typed.ask, JSON.stringify(rest),
      );
    }

    const insertUpdate = db.prepare(`INSERT INTO item_updates (item_id, ts, type, contributor, comment, changes, audit)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const u of updates) {
      insertUpdate.run(u.issueId, u.ts, u.type ?? null, u.contributor, u.comment ?? null, u.changes || null, u.audit || null);
    }

    const insertAction = db.prepare(`INSERT INTO supporting_actions (action_id, item_id, action, owner, target, progress,
      support, dependency, evidence, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`);
    for (const a of actions) {
      insertAction.run(a.actionId, a.issueId, a.action, a.owner ?? null, a.target ?? null, a.progress ?? null,
        a.support ?? null, a.dependency ?? null, a.evidence ?? null, a.createdAt ?? null, a.updatedAt ?? null);
    }

    const insertFollowup = db.prepare(`INSERT INTO action_followups (action_id, item_id, ts, by, comment, progress, target)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const f of followups) {
      insertFollowup.run(f.actionId, f.issueId, f.ts, f.by, f.comment ?? null, f.progress ?? null, f.target ?? null);
    }

    const insertRel = db.prepare('INSERT INTO item_relationships (source_item_id, target_item_id, relationship_type) VALUES (?, ?, ?)');
    for (const r of relationships) {
      insertRel.run(r.sourceItemId, r.targetItemId, r.relationshipType);
    }

    const insertMaster = db.prepare('INSERT INTO master_data (master_type, value, active) VALUES (?, ?, ?)');
    for (const m of master) {
      insertMaster.run(m.masterType, m.value, m.active ? 1 : 0);
    }

    audit(db, 'system:seed', 'seed', 'database', '', { source: 'importer output', items: items.length });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return {
    items: items.length,
    item_updates: updates.length,
    supporting_actions: actions.length,
    action_followups: followups.length,
    item_relationships: relationships.length,
    master_data: master.length,
  };
}

// CLI entry point
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const outDir = args.find((a) => !a.startsWith('--'));
  const dbIndex = args.indexOf('--db');
  const dbPath = dbIndex >= 0 ? resolve(args[dbIndex + 1]) : join(root, 'data', 'hub.sqlite');
  const reset = args.includes('--reset');
  if (!outDir) {
    console.error('Usage: node server/seed.mjs <importerOutDir> [--db <file>] [--reset]');
    process.exit(2);
  }
  if (reset && existsSync(dbPath)) unlinkSync(dbPath);
  const db = openDatabase(dbPath);
  const counts = seedDatabase(db, resolve(outDir), { reset });
  console.log(`Seeded ${dbPath}`, counts);
}
