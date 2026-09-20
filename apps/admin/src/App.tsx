import { useEffect, useState } from 'react';
import { adminPermissions, canAdmin, NO_LIVE_DATA, type AdminRole } from './access.js';
import './app.css';

const sections = [
  'Overview',
  'Users',
  'Wallet',
  'AI Usage',
  'Models',
  'Payments',
  'Email',
  'Audit',
];

interface AdminOverview {
  dataStatus: 'LIVE' | typeof NO_LIVE_DATA;
  totalUsers: number | null;
  paidUsers: number | null;
  creditsConsumed: string | null;
  providerCostUsd: string | null;
  revenueUsd: string | null;
  grossMarginUsd: string | null;
  grossMarginPercent: number | null;
}

interface AdminUsage {
  dataStatus: 'LIVE' | typeof NO_LIVE_DATA;
  rows: Array<{
    modelId: string;
    provider: string;
    requests: number;
    providerCostUsd: string | null;
  }>;
}

interface AdminUser {
  id: string;
  email: string;
  emailVerifiedAt: string | null;
  status: string;
  role: string;
  planId: string;
  createdAt: string;
}

function display(value: number | string | null | undefined): string {
  return value === null || value === undefined ? NO_LIVE_DATA : String(value);
}

export function App(): React.JSX.Element {
  const [section, setSection] = useState('Overview');
  const [role, setRole] = useState<AdminRole | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [usage, setUsage] = useState<AdminUsage | null>(null);
  const [campaignName, setCampaignName] = useState('');
  const [campaignSubject, setCampaignSubject] = useState('');
  const [campaignHtml, setCampaignHtml] = useState('<p>Hello {{first_name}}</p>');
  const [campaignPlan, setCampaignPlan] = useState('');
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [campaignPreview, setCampaignPreview] = useState<{
    eligibleRecipients: number;
    suppressedRecipients: number;
  } | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);

  useEffect(() => {
    if (!token) return;
    const load = async (): Promise<void> => {
      const headers = token === 'cookie-session' ? undefined : { Authorization: `Bearer ${token}` };
      const response = await fetch('/v1/admin/overview', {
        credentials: 'include',
        ...(headers ? { headers } : {}),
      });
      if (response.status === 401 || response.status === 403) {
        setToken(null);
        setRole(null);
        throw new Error('Admin session expired or is not authorized.');
      }
      if (!response.ok) throw new Error('Admin data is unavailable.');
      setOverview((await response.json()) as AdminOverview);
      if (section === 'AI Usage') {
        const usageResponse = await fetch('/v1/admin/analytics/usage', {
          credentials: 'include',
          ...(headers ? { headers } : {}),
        });
        if (!usageResponse.ok) throw new Error('AI usage data is unavailable.');
        setUsage((await usageResponse.json()) as AdminUsage);
      }
      if (section === 'Users') {
        const usersResponse = await fetch('/v1/admin/users?limit=100', {
          credentials: 'include',
          ...(headers ? { headers } : {}),
        });
        if (!usersResponse.ok) throw new Error('User data is unavailable.');
        setUsers(((await usersResponse.json()) as { users: AdminUser[] }).users);
      }
    };
    void load().catch((error: unknown) =>
      setMessage(error instanceof Error ? error.message : 'Admin data is unavailable.'),
    );
  }, [section, token]);

  async function signIn(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setMessage('');
    try {
      const response = await fetch('/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          device: {
            label: 'Astra AI Admin',
            platform: 'web',
            architecture: 'browser',
            appVersion: '0.1.0',
          },
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        accessToken?: string;
        user?: { role?: string };
        error?: string;
      };
      if (!response.ok || !result.user?.role)
        throw new Error(result.error ?? 'Admin sign-in failed.');
      if (!(result.user.role in adminPermissions))
        throw new Error('This account is not an administrator.');
      setToken(result.accessToken ?? 'cookie-session');
      setRole(result.user.role as AdminRole);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Admin sign-in failed.');
    }
  }

  async function createCampaign(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setMessage('');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token !== 'cookie-session') headers.Authorization = `Bearer ${token}`;
    const response = await fetch('/v1/admin/email/campaigns', {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({
        name: campaignName,
        subject: campaignSubject,
        previewText: campaignSubject,
        html: campaignHtml,
        audience: campaignPlan ? { planId: campaignPlan } : {},
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      campaign?: { id?: string };
      error?: string;
    };
    if (!response.ok || !body.campaign?.id) {
      setMessage(body.error ?? 'Campaign draft could not be created.');
      return;
    }
    setCampaignId(body.campaign.id);
    setCampaignPreview(null);
    setMessage('Campaign draft created. Preview the server-calculated audience before sending.');
  }

  async function previewCampaign(): Promise<void> {
    if (!campaignId) return;
    const headers: Record<string, string> = {};
    if (token !== 'cookie-session') headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`/v1/admin/email/campaigns/${campaignId}/preview`, {
      credentials: 'include',
      ...(Object.keys(headers).length ? { headers } : {}),
    });
    const body = (await response.json().catch(() => ({}))) as {
      eligibleRecipients?: number;
      suppressedRecipients?: number;
      error?: string;
    };
    if (!response.ok) {
      setMessage(body.error ?? 'Campaign preview is unavailable.');
      return;
    }
    setCampaignPreview({
      eligibleRecipients: body.eligibleRecipients ?? 0,
      suppressedRecipients: body.suppressedRecipients ?? 0,
    });
    setMessage('Preview generated from verified, active, opted-in recipients.');
  }

  async function sendTestEmail(): Promise<void> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token !== 'cookie-session') headers.Authorization = `Bearer ${token}`;
    const response = await fetch('/v1/admin/email/test', {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ subject: campaignSubject, html: campaignHtml }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      delivery?: { status?: string };
      error?: string;
    };
    setMessage(
      response.ok
        ? `Test email: ${body.delivery?.status ?? 'accepted'}.`
        : (body.error ?? 'Test email failed.'),
    );
  }

  async function sendCampaign(): Promise<void> {
    if (
      !campaignId ||
      !window.confirm('Send this campaign to the server-calculated eligible audience?')
    )
      return;
    const headers: Record<string, string> = {};
    if (token !== 'cookie-session') headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`/v1/admin/email/campaigns/${campaignId}/send`, {
      method: 'POST',
      credentials: 'include',
      ...(Object.keys(headers).length ? { headers } : {}),
    });
    const body = (await response.json().catch(() => ({}))) as {
      sent?: number;
      suppressed?: number;
      error?: string;
    };
    setMessage(
      response.ok
        ? `Campaign delivery attempted: ${body.sent ?? 0} sent, ${body.suppressed ?? 0} suppressed.`
        : (body.error ?? 'Campaign send failed.'),
    );
  }

  if (!token || !role) {
    return (
      <main className="admin-login">
        <form className="login-card" onSubmit={(event) => void signIn(event)}>
          <div className="admin-brand">
            ASTRA <span>AI ADMIN</span>
          </div>
          <p>Secure operational access for accounts, models, money, and email.</p>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="username"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          <button className="primary-button" type="submit">
            Sign in
          </button>
          {message && (
            <p className="login-message" role="alert">
              {message}
            </p>
          )}
        </form>
      </main>
    );
  }

  const overviewCards: Array<[string, number | string | null]> = [
    ['Users', overview?.totalUsers ?? null],
    ['Paid users', overview?.paidUsers ?? null],
    [
      'AI provider cost',
      overview?.providerCostUsd === null || overview?.providerCostUsd === undefined
        ? null
        : `$${overview.providerCostUsd}`,
    ],
    [
      'Attributed revenue',
      overview?.revenueUsd === null || overview?.revenueUsd === undefined
        ? null
        : `$${overview.revenueUsd}`,
    ],
    [
      'Gross AI margin',
      overview?.grossMarginUsd === null || overview?.grossMarginUsd === undefined
        ? null
        : `$${overview.grossMarginUsd}`,
    ],
    ['Credits consumed', overview?.creditsConsumed ?? null],
  ];

  return (
    <main className="admin-shell">
      <aside>
        <div className="admin-brand">
          ASTRA <span>AI ADMIN</span>
        </div>
        <p>Operational controls for accounts, models, money, and email.</p>
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
          <div className="header-actions">
            <span className="server-role">{role} · server-authorized</span>
            <button
              className="text-button"
              onClick={() => {
                const logoutRequest: RequestInit = {
                  method: 'POST',
                  credentials: 'include',
                };
                if (token !== 'cookie-session')
                  logoutRequest.headers = { Authorization: `Bearer ${token}` };
                void fetch('/v1/auth/logout', logoutRequest);
                setToken(null);
                setRole(null);
              }}
            >
              Sign out
            </button>
          </div>
        </header>
        <div className="notice">
          <strong>Live financial data</strong>
          <span>{overview?.dataStatus ?? usage?.dataStatus ?? NO_LIVE_DATA}</span>
          <p>
            Connect certified PostgreSQL, payment, AI, and email environments before treating
            provider cost, collections, or delivery status as production evidence.
          </p>
        </div>
        <div className="admin-grid">
          {overviewCards.map(([label, value]) => (
            <article key={label}>
              <span>{label}</span>
              <strong>{display(value)}</strong>
            </article>
          ))}
        </div>
        {section === 'AI Usage' && usage?.rows.length ? (
          <section className="admin-table">
            <div className="table-heading">
              <h2>Usage by model</h2>
              <span>{usage.dataStatus}</span>
            </div>
            {usage.rows.map((row) => (
              <div className="action-row" key={`${row.provider}:${row.modelId}`}>
                <span>
                  {row.provider} / {row.modelId} · {row.requests} requests
                </span>
                <span>${row.providerCostUsd ?? NO_LIVE_DATA}</span>
              </div>
            ))}
          </section>
        ) : null}
        {section === 'Users' ? (
          <section className="admin-table">
            <div className="table-heading">
              <h2>Users</h2>
              <span>{users.length} loaded</span>
            </div>
            {users.length === 0 ? (
              <p className="form-note">{NO_LIVE_DATA}</p>
            ) : (
              users.map((user) => (
                <div className="action-row" key={user.id}>
                  <span>
                    {user.email} · {user.planId} · {user.status}
                  </span>
                  <span>{user.emailVerifiedAt ? 'verified' : 'unverified'}</span>
                </div>
              ))
            )}
          </section>
        ) : null}
        {section === 'Email' && canAdmin(role, 'manage_email') ? (
          <section className="admin-form">
            <div className="table-heading">
              <h2>Campaign draft</h2>
              <span>Server-sanitized and idempotent</span>
            </div>
            <form onSubmit={(event) => void createCampaign(event)}>
              <label>
                Campaign name
                <input
                  value={campaignName}
                  onChange={(event) => setCampaignName(event.target.value)}
                  required
                />
              </label>
              <label>
                Subject
                <input
                  value={campaignSubject}
                  onChange={(event) => setCampaignSubject(event.target.value)}
                  required
                />
              </label>
              <label>
                Audience plan
                <select
                  value={campaignPlan}
                  onChange={(event) => setCampaignPlan(event.target.value)}
                >
                  <option value="">All eligible users</option>
                  <option value="FREE">Free</option>
                  <option value="BASIC">Basic</option>
                  <option value="PRO">Pro</option>
                  <option value="MAX">Max</option>
                  <option value="TEAM">Team</option>
                  <option value="BUSINESS">Business</option>
                </select>
              </label>
              <label>
                HTML content
                <textarea
                  value={campaignHtml}
                  onChange={(event) => setCampaignHtml(event.target.value)}
                  required
                  rows={8}
                />
              </label>
              <button className="primary-button" type="submit">
                Create draft
              </button>
            </form>
            <button
              className="text-button"
              onClick={() => void sendTestEmail()}
              disabled={!campaignSubject || !campaignHtml}
            >
              Send test to my admin email
            </button>
            {campaignId && (
              <div className="campaign-actions">
                <span>Draft {campaignId}</span>
                <button className="text-button" onClick={() => void previewCampaign()}>
                  Preview audience
                </button>
                <button className="primary-button" onClick={() => void sendCampaign()}>
                  Confirm send
                </button>
              </div>
            )}
            {campaignPreview && (
              <p className="form-note">
                Eligible: {campaignPreview.eligibleRecipients} · Suppressed:{' '}
                {campaignPreview.suppressedRecipients}
              </p>
            )}
          </section>
        ) : null}
        {message && (
          <p className="login-message" role="status">
            {message}
          </p>
        )}
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
