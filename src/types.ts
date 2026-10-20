export interface Item {
  id: number;
  workstream: string;
  topic: string;
  status: string;
  criticality: string | null;
  ramp1: string | null;
  owner: string | null;
  target: string | null;
  impact: string | null;
  currentPosition: string | null;
  blocker: string | null;
  next: string | null;
  decision: string | null;
  ask: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
  openActions?: number;
  [extra: string]: unknown;
}

export interface Followup {
  ts: string;
  by: string;
  comment: string | null;
  progress: string | null;
  target: string | null;
}

export interface Action {
  actionId: string;
  action: string;
  owner: string | null;
  target: string | null;
  progress: string | null;
  support: string | null;
  dependency: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  followups: Followup[];
}

export interface UpdateEntry {
  id: number;
  ts: string;
  type: string | null;
  contributor: string;
  comment: string | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
}

export interface Relationship {
  type: string;
  otherId: number;
  otherTopic: string;
}

export interface ItemDetail extends Item {
  updates: UpdateEntry[];
  actions: Action[];
  relationships: Relationship[];
}

export interface Summary {
  total: number;
  byStatus: { key: string; n: number }[];
  byWorkstream: { key: string; n: number }[];
  atRisk: { id: number; topic: string; workstream: string; owner: string | null; target: string | null }[];
}

export type Master = Record<string, string[]>;
