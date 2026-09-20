import { useState } from 'react';
import { adminPermissions, NO_LIVE_DATA, type AdminRole } from './access.js';
import './app.css';

const sections = ['Overview', 'Users', 'Wallet', 'AI Usage', 'Models', 'Payments', 'Audit'];

export function App(): React.JSX.Element {
  const [section, setSection] = useState('Overview');
  const [role, setRole] = useState<AdminRole>('SUPER_ADMIN');
  return (
    <main className="admin-shell">
      <aside>
        <div className="admin-brand">
          LYNTAR <span>ADMIN</span>
        </div>
        <p>Operational controls for accounts, models, and money.</p>
        <nav>
          {sections.map((item) => (
            <button
              className={section === item ? 'active' : ''}
              key={item}
              onClick={() => setSection(item)}
            >
              {item}
            </button>
          ))}
        </nav>
      </aside>
      <section className="admin-main">
        <header>
          <div>
            <span className="eyebrow">{section}</span>
            <h1>{section === 'Overview' ? 'System overview' : section}</h1>
          </div>
          <label>
            Role
            <select value={role} onChange={(event) => setRole(event.target.value as AdminRole)}>
              {Object.keys(adminPermissions).map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
        </header>
        <div className="notice">
          <strong>Live financial data</strong>
          <span>{NO_LIVE_DATA}</span>
          <p>
            Connect a certified PostgreSQL and payment environment before treating provider cost,
            collections, or payment status as production evidence.
          </p>
        </div>
        <div className="admin-grid">
          {['Users', 'Paid users', 'AI spend', 'Credits consumed'].map((label) => (
            <article key={label}>
              <span>{label}</span>
              <strong>{NO_LIVE_DATA}</strong>
            </article>
          ))}
        </div>
        <section className="admin-table">
          <div className="table-heading">
            <h2>Available actions</h2>
            <span>{role}</span>
          </div>
          {Object.values(adminPermissions[role]).map((action) => (
            <div className="action-row" key={action}>
              <span>{action.replaceAll('_', ' ')}</span>
              <span className="allowed">Allowed by server role</span>
            </div>
          ))}
        </section>
      </section>
    </main>
  );
}
