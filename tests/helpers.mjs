// Test helpers. Fixtures are synthetic and written to a temp directory. No business data lives in the repo.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/db.mjs';
import { seedDatabase } from '../server/seed.mjs';

export function makeFixtureDir() {
  const dir = mkdtempSync(join(tmpdir(), 'hub-fixture-'));
  const write = (name, value) => writeFileSync(join(dir, `${name}.json`), JSON.stringify(value));

  write('items', [
    {
      id: 1, workstream: 'P2P', topic: 'Invoice posting', impact: 'Financial processing', criticality: 'High',
      status: 'At Risk', owner: 'Owner A', target: '2000-01-01', ramp1: 'Ramp 1', decision: 'Yes', ask: 'Decide scope',
      currentPosition: 'Pilot running', blocker: 'Vendor data', next: 'Fix vendor data', update: 'Pilot started',
      description: 'Synthetic description', sourceComment: 'Protected original comment',
    },
    {
      id: 2, workstream: 'Rail', topic: 'Rail matching', impact: '', criticality: 'Medium',
      status: 'Closed', owner: 'Owner B', target: '', ramp1: 'Ramp 2', decision: 'No', ask: '',
      currentPosition: '', blocker: '', next: '', update: '', parent: 1,
    },
  ]);
  write('item_updates', [
    { issueId: 1, ts: '2026-10-10T09:00:00.000Z', type: 'Progress update', contributor: 'Seed Author', comment: 'First note', changes: '' },
  ]);
  write('supporting_actions', [
    { actionId: 'A1-1', issueId: 1, action: 'Fix vendor data', owner: 'Owner A', target: '2026-11-01', progress: 'In progress', createdAt: '2026-10-10T09:00:00.000Z', updatedAt: '2026-10-10T09:00:00.000Z' },
  ]);
  write('action_followups', [
    { actionId: 'A1-1', issueId: 1, ts: '2026-10-10T09:00:00.000Z', by: 'Seed Author', comment: 'Created', progress: 'In progress', target: '2026-11-01' },
  ]);
  write('item_relationships', [
    { sourceItemId: 1, targetItemId: 2, relationshipType: 'Blocks' },
    { sourceItemId: 2, targetItemId: 1, relationshipType: 'Child of' },
  ]);
  write('master_data', [
    { masterType: 'statuses', value: 'At Risk', active: true },
    { masterType: 'statuses', value: 'In Progress', active: true },
    { masterType: 'statuses', value: 'Closed', active: true },
    { masterType: 'criticalities', value: 'High', active: true },
    { masterType: 'criticalities', value: 'Medium', active: true },
    { masterType: 'ramps', value: 'Ramp 1', active: true },
    { masterType: 'ramps', value: 'Ramp 2', active: true },
    { masterType: 'workstreams', value: 'P2P', active: true },
    { masterType: 'workstreams', value: 'Rail', active: true },
  ]);
  return dir;
}

// A fresh in-memory database seeded from a synthetic fixture.
export function seededDb() {
  const db = openDatabase(':memory:');
  seedDatabase(db, makeFixtureDir());
  return db;
}
