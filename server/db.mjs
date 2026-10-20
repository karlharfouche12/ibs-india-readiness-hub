// SQLite store for the readiness hub. Uses Node's built-in node:sqlite (see docs/adr/0001).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  workstream TEXT NOT NULL,
  topic TEXT NOT NULL,
  status TEXT NOT NULL,
  criticality TEXT,
  ramp1 TEXT,
  owner TEXT,
  target TEXT,
  impact TEXT,
  current_position TEXT,
  blocker TEXT,
  next_action TEXT,
  decision TEXT,
  ask TEXT,
  fields TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS item_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id),
  ts TEXT NOT NULL,
  type TEXT,
  contributor TEXT NOT NULL,
  comment TEXT,
  changes TEXT,
  audit TEXT
);

CREATE TABLE IF NOT EXISTS supporting_actions (
  action_id TEXT PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id),
  action TEXT NOT NULL,
  owner TEXT,
  target TEXT,
  progress TEXT,
  support TEXT,
  dependency TEXT,
  evidence TEXT,
  created_at TEXT,
  updated_at TEXT,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS action_followups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id TEXT NOT NULL REFERENCES supporting_actions(action_id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  ts TEXT NOT NULL,
  by TEXT NOT NULL,
  comment TEXT,
  progress TEXT,
  target TEXT
);

CREATE TABLE IF NOT EXISTS item_relationships (
  source_item_id INTEGER NOT NULL REFERENCES items(id),
  target_item_id INTEGER NOT NULL REFERENCES items(id),
  relationship_type TEXT NOT NULL,
  PRIMARY KEY (source_item_id, target_item_id, relationship_type)
);

CREATE TABLE IF NOT EXISTS master_data (
  master_type TEXT NOT NULL,
  value TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (master_type, value)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  details TEXT
);
`;

export function openDatabase(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

// Writes an audit row. Every write path calls this with the signed-in actor.
export function audit(db, actor, action, entity, entityId, details) {
  db.prepare(
    'INSERT INTO audit_log (occurred_at, actor, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(new Date().toISOString(), actor, action, entity, String(entityId ?? ''), details ? JSON.stringify(details) : null);
}
