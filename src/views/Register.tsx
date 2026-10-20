import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Item, Master } from '../types';
import { StatusPill } from '../components/StatusPill';

export function Register({ master, onOpen }: { master: Master; onOpen: (id: number) => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [status, setStatus] = useState('');
  const [workstream, setWorkstream] = useState('');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (workstream) params.set('workstream', workstream);
    if (q.trim()) params.set('q', q.trim());
    const handle = setTimeout(() => {
      api<Item[]>('GET', `/items?${params.toString()}`)
        .then((rows) => { setItems(rows); setError(''); })
        .catch((e: Error) => setError(e.message));
    }, 150);
    return () => clearTimeout(handle);
  }, [status, workstream, q]);

  return (
    <section>
      <div className="page-title">
        <h2>Issue register</h2>
        <p className="muted">All readiness items. Select a row to view and update it.</p>
      </div>

      <div className="toolbar">
        <input placeholder="Search topic, position or blocker" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {(master.statuses || []).map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={workstream} onChange={(e) => setWorkstream(e.target.value)} aria-label="Filter by workstream">
          <option value="">All workstreams</option>
          {(master.workstreams || []).map((w) => <option key={w}>{w}</option>)}
        </select>
        <span className="muted count">{items ? `${items.length} items` : ''}</span>
      </div>

      {error && <div className="banner error">{error}</div>}

      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>ID</th><th>Workstream</th><th>Topic</th><th>Status</th><th>Criticality</th>
              <th>Owner</th><th>Target</th><th>Open actions</th>
            </tr>
          </thead>
          <tbody>
            {items?.map((item) => (
              <tr key={item.id} className="clickable" onClick={() => onOpen(item.id)}>
                <td>#{item.id}</td>
                <td>{item.workstream}</td>
                <td>{item.topic}</td>
                <td><StatusPill status={item.status} /></td>
                <td>{item.criticality || '—'}</td>
                <td>{item.owner || <span className="muted">Not set</span>}</td>
                <td>{item.target || <span className="muted">Not set</span>}</td>
                <td>{item.openActions ?? 0}</td>
              </tr>
            ))}
            {items && items.length === 0 && (
              <tr><td colSpan={8} className="muted">No items match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
