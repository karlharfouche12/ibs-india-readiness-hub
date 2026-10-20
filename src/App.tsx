import { useEffect, useState } from 'react';
import { api } from './api';
import type { Master } from './types';
import { Cockpit } from './views/Cockpit';
import { Register } from './views/Register';
import { IssueDetail } from './views/IssueDetail';

type View = { name: 'cockpit' } | { name: 'register' } | { name: 'issue'; id: number };

export function App() {
  const [view, setView] = useState<View>({ name: 'cockpit' });
  const [me, setMe] = useState<string>('');
  const [master, setMaster] = useState<Master | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    Promise.all([api<{ name: string }>('GET', '/me'), api<Master>('GET', '/master')])
      .then(([user, masterData]) => {
        setMe(user.name);
        setMaster(masterData);
      })
      .catch((error: Error) => setLoadError(error.message));
  }, []);

  const nav = (name: 'cockpit' | 'register', label: string) => (
    <button className={view.name === name ? 'active' : ''} onClick={() => setView(name === 'cockpit' ? { name: 'cockpit' } : { name: 'register' })}>
      {label}
    </button>
  );

  return (
    <>
      <header className="topbar">
        <div>
          <h1>IBS India readiness hub</h1>
          <div className="muted">Governance tracker</div>
        </div>
        <div className="who">Signed in as <b>{me || '…'}</b></div>
      </header>
      <div className="layout">
        <nav>
          {nav('cockpit', 'Leadership cockpit')}
          {nav('register', 'Issue register')}
        </nav>
        <main>
          {loadError && <div className="banner error">Could not load the hub: {loadError}</div>}
          {!master && !loadError && <div className="muted">Loading…</div>}
          {master && view.name === 'cockpit' && (
            <Cockpit onOpen={(id) => setView({ name: 'issue', id })} />
          )}
          {master && view.name === 'register' && (
            <Register master={master} onOpen={(id) => setView({ name: 'issue', id })} />
          )}
          {master && view.name === 'issue' && (
            <IssueDetail
              key={view.id}
              id={view.id}
              master={master}
              onBack={() => setView({ name: 'register' })}
            />
          )}
        </main>
      </div>
    </>
  );
}
