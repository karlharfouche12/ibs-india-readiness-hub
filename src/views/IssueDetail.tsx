import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Action, ItemDetail, Master } from '../types';
import { StatusPill } from '../components/StatusPill';

type FieldDef =
  | { key: string; label: string; kind: 'select'; master: string }
  | { key: string; label: string; kind: 'text' }
  | { key: string; label: string; kind: 'textarea' };

// Editable fields, in the order the team reads them. Matches the API's EDITABLE list.
const FIELDS: FieldDef[] = [
  { key: 'status', label: 'Status', kind: 'select', master: 'statuses' },
  { key: 'criticality', label: 'Criticality', kind: 'select', master: 'criticalities' },
  { key: 'ramp1', label: 'Ramp', kind: 'select', master: 'ramps' },
  { key: 'workstream', label: 'Workstream', kind: 'select', master: 'workstreams' },
  { key: 'owner', label: 'Owner', kind: 'text' },
  { key: 'target', label: 'Target', kind: 'text' },
  { key: 'decision', label: 'Leadership decision needed', kind: 'text' },
  { key: 'impact', label: 'Impact', kind: 'text' },
  { key: 'currentPosition', label: 'Current position', kind: 'textarea' },
  { key: 'blocker', label: 'Blocker', kind: 'textarea' },
  { key: 'next', label: 'Next action', kind: 'textarea' },
  { key: 'ask', label: 'Ask', kind: 'textarea' },
];

// Background fields are shown read-only. sourceComment is the protected original from the tracker.
const SOURCE_FIELDS: { key: string; label: string }[] = [
  { key: 'description', label: 'Description' },
  { key: 'background', label: 'Background' },
  { key: 'detailedImpact', label: 'Detailed impact' },
  { key: 'dependencies', label: 'Dependencies' },
  { key: 'decisionsHistory', label: 'Decisions history' },
  { key: 'detailedComments', label: 'Detailed comments' },
  { key: 'sourceComment', label: 'Original tracker comment (protected)' },
];

const PROGRESS = ['Not started', 'In progress', 'Blocked', 'Complete'];

const text = (value: unknown) => (value === null || value === undefined ? '' : String(value));

export function IssueDetail({ id, master, onBack }: { id: number; master: Master; onBack: () => void }) {
  const [item, setItem] = useState<ItemDetail | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saveMessage, setSaveMessage] = useState('');
  const [error, setError] = useState('');
  const [updateText, setUpdateText] = useState('');
  const [updateType, setUpdateType] = useState('Progress update');
  const [newAction, setNewAction] = useState({ action: '', owner: '', target: '' });

  const load = () =>
    api<ItemDetail>('GET', `/items/${id}`)
      .then((detail) => {
        setItem(detail);
        setForm(Object.fromEntries(FIELDS.map((f) => [f.key, text(detail[f.key])])));
      })
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    load();
    // load is recreated each render but depends only on id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (error && !item) return <div className="banner error">{error}</div>;
  if (!item) return <div className="muted">Loading…</div>;

  const dirty = FIELDS.some((f) => form[f.key] !== text(item[f.key]));

  const save = async () => {
    const changed = Object.fromEntries(FIELDS.filter((f) => form[f.key] !== text(item[f.key])).map((f) => [f.key, form[f.key]]));
    if (!Object.keys(changed).length) return;
    setError('');
    try {
      await api('PATCH', `/items/${id}`, changed);
      setSaveMessage('Saved.');
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const addUpdate = async () => {
    if (!updateText.trim()) return;
    setError('');
    try {
      await api('POST', `/items/${id}/updates`, { type: updateType, comment: updateText });
      setUpdateText('');
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const addAction = async () => {
    setError('');
    try {
      await api('POST', `/items/${id}/actions`, newAction);
      setNewAction({ action: '', owner: '', target: '' });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const setProgress = async (action: Action, progress: string) => {
    setError('');
    try {
      await api('PATCH', `/actions/${encodeURIComponent(action.actionId)}`, { progress });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section>
      <button className="link-button" onClick={onBack}>← Back to register</button>
      <div className="page-title">
        <h2>#{item.id} {item.topic}</h2>
        <p><StatusPill status={item.status} /> <span className="muted">{item.workstream}</span></p>
        <p className="muted small">
          Last changed {item.updatedAt ? new Date(item.updatedAt).toLocaleString() : 'in the source tracker'}
          {item.updatedBy ? ` by ${item.updatedBy}` : ''}
        </p>
      </div>

      {error && <div className="banner error">{error}</div>}
      {saveMessage && !error && <div className="banner good">{saveMessage}</div>}

      <div className="panel">
        <h3>Tracker fields</h3>
        <div className="form-grid">
          {FIELDS.map((f) => (
            <label key={f.key} className={f.kind === 'textarea' ? 'wide' : ''}>
              <span>{f.label}</span>
              {f.kind === 'select' ? (
                <select value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}>
                  <option value="">—</option>
                  {(master[f.master] || []).map((v) => <option key={v}>{v}</option>)}
                  {form[f.key] && !(master[f.master] || []).includes(form[f.key]) && <option>{form[f.key]}</option>}
                </select>
              ) : f.kind === 'textarea' ? (
                <textarea rows={3} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
              ) : (
                <input value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
              )}
            </label>
          ))}
        </div>
        <div className="actions-row">
          <button className="primary" disabled={!dirty} onClick={save}>Save changes</button>
          {!dirty && <span className="muted small">No unsaved changes</span>}
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <h3>Supporting actions</h3>
          {item.actions.length === 0 && <p className="muted">No actions yet.</p>}
          {item.actions.map((a) => (
            <div className="action-row" key={a.actionId}>
              <div>
                <b>{a.action}</b>
                <div className="muted small">Owner: {a.owner || 'Not set'} · Target: {a.target || 'Not set'}</div>
              </div>
              <select value={a.progress || ''} onChange={(e) => setProgress(a, e.target.value)} aria-label="Progress">
                {[...new Set([...PROGRESS, a.progress || ''])].filter(Boolean).map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
          ))}
          <div className="add-box">
            <h4>Add action</h4>
            <input placeholder="What needs to happen" value={newAction.action} onChange={(e) => setNewAction({ ...newAction, action: e.target.value })} />
            <div className="row2">
              <input placeholder="Owner (required)" value={newAction.owner} onChange={(e) => setNewAction({ ...newAction, owner: e.target.value })} />
              <input placeholder="Target" value={newAction.target} onChange={(e) => setNewAction({ ...newAction, target: e.target.value })} />
            </div>
            <button onClick={addAction} disabled={!newAction.action.trim() || !newAction.owner.trim()}>Add action</button>
          </div>
        </div>

        <div className="panel">
          <h3>Updates</h3>
          <div className="add-box">
            <select value={updateType} onChange={(e) => setUpdateType(e.target.value)} aria-label="Update type">
              <option>Progress update</option>
              <option>Decision</option>
              <option>Escalation</option>
              <option>Information</option>
            </select>
            <textarea rows={3} placeholder="What changed" value={updateText} onChange={(e) => setUpdateText(e.target.value)} />
            <button onClick={addUpdate} disabled={!updateText.trim()}>Add update</button>
          </div>
          <ol className="timeline">
            {item.updates.map((u) => (
              <li key={u.id}>
                <div className="muted small">{new Date(u.ts).toLocaleString()} · {u.contributor} · {u.type}</div>
                <div>{u.comment}</div>
              </li>
            ))}
            {item.updates.length === 0 && <li className="muted">No updates recorded.</li>}
          </ol>
        </div>
      </div>

      {item.relationships.length > 0 && (
        <div className="panel">
          <h3>Related items</h3>
          <ul>
            {item.relationships.map((r) => (
              <li key={`${r.type}-${r.otherId}`}>{r.type}: #{r.otherId} {r.otherTopic}</li>
            ))}
          </ul>
        </div>
      )}

      <details className="panel">
        <summary><b>Source detail (read-only)</b></summary>
        {SOURCE_FIELDS.map((f) => (
          <div className="source-block" key={f.key}>
            <div className="label">{f.label}</div>
            <div className="pre">{text(item[f.key]) || <span className="muted">Not recorded</span>}</div>
          </div>
        ))}
      </details>
    </section>
  );
}
