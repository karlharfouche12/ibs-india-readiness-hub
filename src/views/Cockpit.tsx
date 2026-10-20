import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Summary } from '../types';

// A target is overdue when it parses as a date in the past and the item is not closed.
// Targets are free text in the source data, so anything that does not parse is left alone.
function isOverdue(target: string | null, status: string): boolean {
  if (!target || status === 'Closed') return false;
  const when = Date.parse(target);
  if (Number.isNaN(when)) return false;
  return when < Date.now();
}

export function Cockpit({ onOpen }: { onOpen: (id: number) => void }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<Summary>('GET', '/summary').then(setSummary).catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <div className="banner error">{error}</div>;
  if (!summary) return <div className="muted">Loading…</div>;

  const count = (key: string) => summary.byStatus.find((s) => s.key === key)?.n ?? 0;
  const max = Math.max(1, ...summary.byStatus.map((s) => s.n));

  return (
    <section>
      <div className="page-title">
        <h2>Leadership cockpit</h2>
        <p className="muted">Where the readiness programme stands, and which items need attention first.</p>
      </div>

      <div className="cards">
        <div className="card"><span className="label">Items</span><strong>{summary.total}</strong></div>
        <div className="card danger"><span className="label">At risk</span><strong>{count('At Risk')}</strong></div>
        <div className="card"><span className="label">In progress</span><strong>{count('In Progress')}</strong></div>
        <div className="card good"><span className="label">Closed</span><strong>{count('Closed')}</strong></div>
      </div>

      <div className="two-col">
        <div className="panel">
          <h3>By status</h3>
          {summary.byStatus.map((s) => (
            <div className="bar-row" key={s.key}>
              <span>{s.key}</span>
              <div className="bar"><div style={{ width: `${(s.n / max) * 100}%` }} /></div>
              <b>{s.n}</b>
            </div>
          ))}
        </div>
        <div className="panel">
          <h3>By workstream</h3>
          {summary.byWorkstream.map((w) => (
            <div className="bar-row" key={w.key}>
              <span>{w.key}</span>
              <div className="bar"><div style={{ width: `${(w.n / summary.total) * 100}%` }} /></div>
              <b>{w.n}</b>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h3>At risk, by target date</h3>
        {summary.atRisk.length === 0 && <p className="muted">No items are at risk.</p>}
        <table>
          <thead>
            <tr><th>ID</th><th>Topic</th><th>Workstream</th><th>Owner</th><th>Target</th></tr>
          </thead>
          <tbody>
            {summary.atRisk.map((item) => (
              <tr key={item.id} className="clickable" onClick={() => onOpen(item.id)}>
                <td>#{item.id}</td>
                <td>{item.topic}</td>
                <td>{item.workstream}</td>
                <td>{item.owner || <span className="muted">Not set</span>}</td>
                <td>
                  {item.target || <span className="muted">Not set</span>}{' '}
                  {isOverdue(item.target, 'At Risk') && <span className="pill red">Overdue</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">Showing At Risk items only. The full list is in the issue register.</p>
      </div>
    </section>
  );
}
