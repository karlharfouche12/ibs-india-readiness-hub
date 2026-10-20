// Imports the Release 76 authoritative browser-state export into relational tables.
// Usage: node tools/import-release76.mjs <export.json> <outDir>
//
// Rules (from the migration data dictionary):
// - The main `data` section is authoritative. `localState.ibsTracker` is a stale legacy copy and is excluded.
// - Source values are never corrected or dropped. Problems are reported, not fixed.
// - Writes UTF-8 CSV (with BOM, for Excel) and JSON per table, plus a manifest and validation report.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const [, , exportPath, outDir] = process.argv;
if (!exportPath || !outDir) {
  console.error('Usage: node tools/import-release76.mjs <export.json> <outDir>');
  process.exit(2);
}

const raw = readFileSync(exportPath);
const src = JSON.parse(raw.toString('utf8'));
const sha256 = createHash('sha256').update(raw).digest('hex');

const errors = [];
const warnings = [];
const err = (table, msg) => errors.push({ table, msg });
const warn = (table, msg) => warnings.push({ table, msg });

// ---- Source checks -------------------------------------------------------
if (src.appRelease !== 76 || src.schemaVersion !== 76) {
  err('source', `expected appRelease/schemaVersion 76, got ${src.appRelease}/${src.schemaVersion}`);
}
if (src.exportType !== 'authoritative-current-browser-state') {
  warn('source', `unexpected exportType: ${src.exportType}`);
}

const items = src.data;
const itemIds = new Set();
for (const it of items) {
  if (itemIds.has(it.id)) err('items', `duplicate item id ${it.id}`);
  itemIds.add(it.id);
  for (const f of ['topic', 'workstream', 'status']) {
    if (!it[f] || !String(it[f]).trim()) warn('items', `item ${it.id} has empty ${f}`);
  }
}

const master = src.master || {};
const allowed = {
  status: new Set(master.statuses || []),
  criticality: new Set(master.criticalities || []),
  ramp1: new Set(master.ramps || []),
  workstream: new Set(master.workstreams || []),
};
for (const it of items) {
  for (const [field, set] of Object.entries(allowed)) {
    if (it[field] && set.size && !set.has(it[field])) {
      warn('items', `item ${it.id} ${field} "${it[field]}" not in master list`);
    }
  }
}

// ---- Helpers -------------------------------------------------------------
// Sanity check: localState should hold live objects, not JSON strings.
// Log it so a format change shows up in the report rather than failing silently.
for (const [k, v] of Object.entries(src.localState || {})) {
  if (typeof v === 'string' && /^[[{]/.test(v)) warn('source', `localState.${k} is a JSON string, not an object`);
}

const isoOk = (v) => v === '' || v == null || !Number.isNaN(Date.parse(v));
const json = (v) => (v === undefined || v === null ? '' : JSON.stringify(v));

function csvCell(v) {
  if (v === undefined || v === null) return '';
  const s = typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeTable(name, rows, columns) {
  const header = columns.join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(r[c])).join(','));
  writeFileSync(join(outDir, `${name}.csv`), '﻿' + [header, ...body].join('\r\n') + '\r\n', 'utf8');
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(rows, null, 2), 'utf8');
  return rows.length;
}

// ---- Build tables --------------------------------------------------------
mkdirSync(outDir, { recursive: true });
const counts = {};

// items: every source field kept verbatim so nothing is lost.
const itemCols = [...new Set(items.flatMap((it) => Object.keys(it)))];
counts.items = writeTable('items', items, itemCols);

// item_updates
const updates = src.updates.map((u, i) => {
  if (!itemIds.has(u.issueId)) err('item_updates', `update ${i} references missing item ${u.issueId}`);
  if (!isoOk(u.ts)) err('item_updates', `update ${i} has invalid ts "${u.ts}"`);
  return { updateId: i + 1, issueId: u.issueId, ts: u.ts, type: u.type, contributor: u.contributor, comment: u.comment, changes: json(u.changes), audit: json(u.audit) };
});
counts.item_updates = writeTable('item_updates', updates, ['updateId', 'issueId', 'ts', 'type', 'contributor', 'comment', 'changes', 'audit']);

// supporting_actions
const actionIds = new Set();
const actions = src.actionPlans.map((a) => {
  if (actionIds.has(a.actionId)) err('supporting_actions', `duplicate actionId ${a.actionId}`);
  actionIds.add(a.actionId);
  if (!itemIds.has(a.issueId)) err('supporting_actions', `action ${a.actionId} references missing item ${a.issueId}`);
  if (!a.owner) warn('supporting_actions', `action ${a.actionId} has no owner`);
  if (!isoOk(a.createdAt) || !isoOk(a.updatedAt)) err('supporting_actions', `action ${a.actionId} has invalid timestamp`);
  return { ...a, changes: undefined };
});
const actionCols = [...new Set(actions.flatMap((a) => Object.keys(a)))].filter((c) => c !== 'changes');
counts.supporting_actions = writeTable('supporting_actions', actions, actionCols);

// action_followups
const followups = src.actionFollowups.map((f, i) => {
  if (!actionIds.has(f.actionId)) err('action_followups', `followup ${i} references missing action ${f.actionId}`);
  if (!itemIds.has(f.issueId)) err('action_followups', `followup ${i} references missing item ${f.issueId}`);
  return { followupId: i + 1, ...f };
});
counts.action_followups = writeTable('action_followups', followups, [...new Set(followups.flatMap((f) => Object.keys(f)))]);

// outlook_captures
const captures = src.emailCaptures46;
const captureIds = new Set();
for (const c of captures) {
  if (captureIds.has(c.captureId)) err('outlook_captures', `duplicate captureId ${c.captureId}`);
  captureIds.add(c.captureId);
  if (c.appliedIssueId && !itemIds.has(Number(c.appliedIssueId))) err('outlook_captures', `capture ${c.captureId} applied to missing item ${c.appliedIssueId}`);
}
const captureCols = [...new Set(captures.flatMap((c) => Object.keys(c)))];
counts.outlook_captures = writeTable('outlook_captures', captures, captureCols);

// item_relationships: "Blocks" from items.relationships, "Child of" from items.parent.
const rels = [];
for (const it of items) {
  for (const r of it.relationships || []) {
    if (!itemIds.has(r.issueId)) err('item_relationships', `item ${it.id} relates to missing item ${r.issueId}`);
    rels.push({ sourceItemId: it.id, targetItemId: r.issueId, relationshipType: r.type });
  }
  if (it.parent !== undefined && it.parent !== '' && it.parent !== null) {
    const pid = Number(it.parent);
    if (!itemIds.has(pid)) err('item_relationships', `item ${it.id} parent ${it.parent} not found`);
    rels.push({ sourceItemId: it.id, targetItemId: pid, relationshipType: 'Child of' });
  }
}
counts.item_relationships = writeTable('item_relationships', rels, ['sourceItemId', 'targetItemId', 'relationshipType']);

// target_changes
const targets = src.targetLog.map((t, i) => {
  if (!itemIds.has(t.issueId)) err('target_changes', `target change ${i} references missing item ${t.issueId}`);
  return { targetChangeId: i + 1, ...t };
});
counts.target_changes = writeTable('target_changes', targets, [...new Set(targets.flatMap((t) => Object.keys(t)))]);

// master_data
const masterRows = [];
const activeMaster = (type, values) => (values || []).forEach((value) => masterRows.push({ masterType: type, value, active: true }));
for (const [type, values] of Object.entries(master)) activeMaster(type, values);
counts.master_data = writeTable('master_data', masterRows, ['masterType', 'value', 'active']);

// Non-table state, kept verbatim so it can be migrated or reviewed later.
const extras = {
  closureChecks: src.closureChecks,
  reviewProgress: src.reviewProgress,
  snapshot: src.snapshot,
  deleted: src.deleted,
  decisionLog: src.decisionLog,
  localState: Object.fromEntries(Object.entries(src.localState).filter(([k]) => k !== 'ibsTracker')),
};
writeFileSync(join(outDir, 'extras.json'), JSON.stringify(extras, null, 2), 'utf8');

// ---- Reconcile with the export's own integrity block ---------------------
const integ = src.integrity || {};
const reconcile = [
  ['itemCount', counts.items],
  ['updateCount', counts.item_updates],
  ['actionCount', counts.supporting_actions],
  ['followupCount', counts.action_followups],
  ['captureCount', counts.outlook_captures],
];
for (const [key, got] of reconcile) {
  if (integ[key] !== undefined && integ[key] !== got) err('reconcile', `${key}: export says ${integ[key]}, importer read ${got}`);
}

// ---- Manifest and validation ---------------------------------------------
const trackerRecords = Array.isArray(src.localState.ibsTracker) ? src.localState.ibsTracker.length : null;
const manifest = {
  source: basename(exportPath),
  sourceSha256: sha256,
  sourceExportedAt: src.exportedAt,
  appRelease: src.appRelease,
  schemaVersion: src.schemaVersion,
  integrityChecksum: integ.checksum ? { algorithm: integ.checksumAlgorithm, value: integ.checksum, verified: false } : null,
  excludedSources: [
    {
      key: 'localState.ibsTracker',
      records: trackerRecords,
      reason: 'Stale legacy copy; main data section is authoritative (owner decision 2026-10-20).',
    },
  ],
  counts,
  generatedAt: new Date().toISOString(),
};
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

const validation = { errorCount: errors.length, warningCount: warnings.length, errors, warnings };
writeFileSync(join(outDir, 'validation.json'), JSON.stringify(validation, null, 2), 'utf8');

console.log(`Imported ${counts.items} items, ${counts.item_updates} updates, ${counts.supporting_actions} actions, ${counts.action_followups} follow-ups, ${counts.outlook_captures} captures, ${counts.item_relationships} relationships.`);
console.log(`Errors: ${errors.length}  Warnings: ${warnings.length}  Output: ${outDir}`);
if (errors.length) process.exitCode = 1;
