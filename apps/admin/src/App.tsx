import { useEffect, useState } from 'react';
import type { ControlPlaneModelSnapshot, ControlPlanePlanSnapshot } from '@astra/control-plane';
import { adminPermissions, canAdmin, NO_LIVE_DATA, type AdminRole } from './access.js';
import './app.css';

const sections = [
  { group: 'Control', items: ['Overview', 'Plans', 'Entitlements', 'Limits'] },
  { group: 'Commercial', items: ['Pricing', 'Credits', 'Promotions', 'Payments'] },
  {
    group: 'Operations',
    items: ['Users', 'Organizations', 'Rooms', 'Devices', 'Models', 'AI Usage'],
  },
  { group: 'Platform', items: ['Web Search', 'MCP', 'Plugins', 'Skills', 'Remote Access'] },
  { group: 'System', items: ['Email', 'Security', 'Audit', 'Releases', 'Maintenance'] },
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

type ControlPlanePlan = ControlPlanePlanSnapshot;
type ControlPlaneModel = ControlPlaneModelSnapshot;

interface ControlPlaneAudit {
  action: string;
  targetType: string;
  targetId: string;
  reason: string;
  requestId: string;
  createdAt: string;
  actor: { userId: string; role: string };
}

interface PricingResponse {
  region: string;
  plans: Array<
    ControlPlanePlan & {
      regionalPrice?: {
        currency: string;
        amount: string;
        yearlyAmount: string | null;
        version: number;
      } | null;
    }
  >;
  creditPacks: Array<{
    packageId: string;
    displayName: string;
    credits: string;
    price?: { currency: string; amount: string };
  }>;
}

type SenderKind = 'DEFAULT' | 'NOREPLY' | 'SUPPORT' | 'BILLING' | 'SECURITY';
interface SenderIdentity {
  kind: SenderKind;
  fromAddress: string;
  replyTo?: string;
  updatedAt?: string;
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
  const [senders, setSenders] = useState<SenderIdentity[]>([]);
  const [senderKind, setSenderKind] = useState<SenderKind>('DEFAULT');
  const [senderFrom, setSenderFrom] = useState('');
  const [senderReplyTo, setSenderReplyTo] = useState('');
  const [controlPlans, setControlPlans] = useState<ControlPlanePlan[]>([]);
  const [controlModels, setControlModels] = useState<ControlPlaneModel[]>([]);
  const [controlAudit, setControlAudit] = useState<ControlPlaneAudit[]>([]);
  const [pricing, setPricing] = useState<PricingResponse | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [planName, setPlanName] = useState('');
  const [changeReason, setChangeReason] = useState('');
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [modelStatus, setModelStatus] = useState('AVAILABLE');

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
      if (section === 'Email') {
        const sendersResponse = await fetch('/v1/admin/email/senders', {
          credentials: 'include',
          ...(headers ? { headers } : {}),
        });
        if (!sendersResponse.ok) throw new Error('Email sender settings are unavailable.');
        const nextSenders = ((await sendersResponse.json()) as { senders: SenderIdentity[] })
          .senders;
        setSenders(nextSenders);
        const selected = nextSenders.find((sender) => sender.kind === senderKind);
        if (selected) {
          setSenderFrom(selected.fromAddress);
          setSenderReplyTo(selected.replyTo ?? '');
        }
      }
      if (section === 'Plans' || section === 'Entitlements' || section === 'Limits') {
        const plansResponse = await fetch('/v1/admin/control-plane/plans', {
          credentials: 'include',
          ...(headers ? { headers } : {}),
        });
        if (!plansResponse.ok) throw new Error('Plan policy is unavailable.');
        setControlPlans(((await plansResponse.json()) as { plans: ControlPlanePlan[] }).plans);
      }
      if (section === 'Models') {
        const modelsResponse = await fetch('/v1/admin/control-plane/models', {
          credentials: 'include',
          ...(headers ? { headers } : {}),
        });
        if (!modelsResponse.ok) throw new Error('Model policy is unavailable.');
        setControlModels(((await modelsResponse.json()) as { models: ControlPlaneModel[] }).models);
      }
      if (section === 'Pricing' || section === 'Credits' || section === 'Promotions') {
        const pricingResponse = await fetch('/v1/pricing?country=IN', { credentials: 'include' });
        if (!pricingResponse.ok) throw new Error('Commercial configuration is unavailable.');
        setPricing((await pricingResponse.json()) as PricingResponse);
      }
      if (section === 'Audit' || section === 'Security') {
        const auditResponse = await fetch('/v1/admin/control-plane/audit', {
          credentials: 'include',
          ...(headers ? { headers } : {}),
        });
        if (!auditResponse.ok) throw new Error('Audit history is unavailable.');
        setControlAudit(((await auditResponse.json()) as { entries: ControlPlaneAudit[] }).entries);
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
            label: 'Astra Code Admin',
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

  async function saveSender(): Promise<void> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token !== 'cookie-session') headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`/v1/admin/email/senders/${senderKind}`, {
      method: 'PUT',
      credentials: 'include',
      headers,
      body: JSON.stringify({
        fromAddress: senderFrom,
        ...(senderReplyTo ? { replyTo: senderReplyTo } : {}),
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      sender?: SenderIdentity;
      error?: string;
    };
    if (!response.ok || !body.sender) {
      setMessage(body.error ?? 'Sender identity could not be saved.');
      return;
    }
    setSenders((current) => [
      ...current.filter((sender) => sender.kind !== body.sender!.kind),
      body.sender!,
    ]);
    setMessage(`${senderKind} sender identity saved.`);
  }

  async function savePlan(): Promise<void> {
    const plan = controlPlans.find((candidate) => candidate.id === selectedPlanId);
    if (!plan || !changeReason.trim()) {
      setMessage('Select a plan and enter a reason before saving.');
      return;
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token !== 'cookie-session') headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`/v1/admin/control-plane/plans/${plan.id}`, {
      method: 'PUT',
      credentials: 'include',
      headers,
      body: JSON.stringify({
        plan: {
          ...plan,
          displayName: planName.trim() || plan.displayName,
          version: plan.version + 1,
          updatedAt: new Date().toISOString(),
        },
        metadata: {
          expectedVersion: plan.version,
          reason: changeReason.trim(),
          requestId: `admin-ui-${Date.now()}`,
        },
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      plan?: ControlPlanePlan;
      error?: string;
    };
    if (!response.ok || !body.plan) {
      setMessage(body.error ?? 'Plan was not saved. Refresh and retry.');
      return;
    }
    setControlPlans((current) =>
      current.map((candidate) => (candidate.id === body.plan!.id ? body.plan! : candidate)),
    );
    setChangeReason('');
    setMessage(`${body.plan.displayName} saved at version ${body.plan.version}.`);
  }

  async function saveModel(): Promise<void> {
    const model = controlModels.find((candidate) => candidate.modelId === selectedModelId);
    if (!model || !changeReason.trim()) {
      setMessage('Select a model and enter a reason before saving.');
      return;
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token !== 'cookie-session') headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`/v1/admin/control-plane/models/${model.modelId}`, {
      method: 'PUT',
      credentials: 'include',
      headers,
      body: JSON.stringify({
        model: {
          ...model,
          version: model.version + 1,
          status: modelStatus,
          updatedAt: new Date().toISOString(),
        },
        metadata: {
          expectedVersion: model.version,
          reason: changeReason.trim(),
          requestId: `admin-ui-${Date.now()}`,
        },
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      model?: ControlPlaneModel;
      error?: string;
    };
    if (!response.ok || !body.model) {
      setMessage(body.error ?? 'Model was not saved. Refresh and retry.');
      return;
    }
    setControlModels((current) =>
      current.map((candidate) =>
        candidate.modelId === body.model!.modelId ? body.model! : candidate,
      ),
    );
    setChangeReason('');
    setMessage(`${body.model.displayName} saved at version ${body.model.version}.`);
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
          {sections.map((group) => (
            <div className="nav-group" key={group.group}>
              <span className="nav-group-label">{group.group}</span>
              {group.items.map((item) => (
                <button
                  className={section === item ? 'active' : ''}
                  key={item}
                  onClick={() => setSection(item)}
                >
                  {item}
                </button>
              ))}
            </div>
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
        {section === 'Plans' || section === 'Entitlements' || section === 'Limits' ? (
          <section className="admin-table control-surface">
            <div className="table-heading">
              <h2>{section === 'Plans' ? 'Versioned plan policy' : section}</h2>
              <span>{controlPlans.length} server snapshots</span>
            </div>
            {controlPlans.map((plan) => (
              <div className="action-row" key={plan.id}>
                <button
                  className="resource-button"
                  onClick={() => {
                    setSelectedPlanId(plan.id);
                    setPlanName(plan.displayName);
                    setChangeReason('');
                  }}
                >
                  <strong>{plan.displayName}</strong>
                  <span>
                    {plan.id} · v{plan.version}
                  </span>
                </button>
                <span>
                  {plan.status} · {plan.monthlyCredits} credits / month
                </span>
              </div>
            ))}
            {section === 'Entitlements' &&
              controlPlans.map((plan) => (
                <div className="policy-block" key={`${plan.id}-entitlements`}>
                  <strong>{plan.displayName}</strong>
                  <span>
                    {Object.entries(plan.entitlements)
                      .filter(([, enabled]) => enabled)
                      .map(([key]) => key)
                      .join(', ') || 'No enabled entitlements'}
                  </span>
                </div>
              ))}
            {section === 'Limits' &&
              controlPlans.map((plan) => (
                <div className="policy-block" key={`${plan.id}-limits`}>
                  <strong>{plan.displayName}</strong>
                  <span>{JSON.stringify(plan.limits)}</span>
                </div>
              ))}
            {selectedPlanId && section === 'Plans' ? (
              <div className="edit-drawer">
                <div className="table-heading">
                  <h3>Edit {selectedPlanId}</h3>
                  <button className="text-button" onClick={() => setSelectedPlanId(null)}>
                    Close
                  </button>
                </div>
                <label>
                  Display name
                  <input value={planName} onChange={(event) => setPlanName(event.target.value)} />
                </label>
                <label>
                  Reason for change
                  <input
                    value={changeReason}
                    onChange={(event) => setChangeReason(event.target.value)}
                    required
                  />
                </label>
                <button className="primary-button" onClick={() => void savePlan()}>
                  Save versioned plan
                </button>
              </div>
            ) : null}
          </section>
        ) : null}
        {section === 'Pricing' || section === 'Credits' || section === 'Promotions' ? (
          <section className="admin-table control-surface">
            <div className="table-heading">
              <h2>{section === 'Pricing' ? 'Regional commercial policy' : section}</h2>
              <span>{pricing?.region ?? NO_LIVE_DATA}</span>
            </div>
            {section === 'Pricing' &&
              pricing?.plans.map((plan) => (
                <div className="action-row" key={plan.id}>
                  <span>
                    <strong>{plan.displayName}</strong> · v{plan.regionalPrice?.version ?? '—'}
                  </span>
                  <span>
                    {plan.regionalPrice
                      ? `${plan.regionalPrice.currency} ${plan.regionalPrice.amount}`
                      : NO_LIVE_DATA}
                  </span>
                </div>
              ))}
            {section === 'Credits' &&
              pricing?.creditPacks.map((pack) => (
                <div className="action-row" key={pack.packageId}>
                  <span>
                    <strong>{pack.displayName}</strong> · {pack.credits} credits
                  </span>
                  <span>
                    {pack.price ? `${pack.price.currency} ${pack.price.amount}` : NO_LIVE_DATA}
                  </span>
                </div>
              ))}
            {section === 'Promotions' ? (
              <p className="form-note">
                Promotions are server-managed through the commercial API. No client-side discount
                calculation is performed here.
              </p>
            ) : null}
          </section>
        ) : null}
        {section === 'Models' ? (
          <section className="admin-table control-surface">
            <div className="table-heading">
              <h2>Authoritative model catalog</h2>
              <span>{controlModels.length} models</span>
            </div>
            {controlModels.map((model) => (
              <div className="action-row" key={model.modelId}>
                <button
                  className="resource-button"
                  onClick={() => {
                    setSelectedModelId(model.modelId);
                    setModelStatus(model.status);
                    setChangeReason('');
                  }}
                >
                  <strong>{model.displayName}</strong>
                  <span>
                    {model.provider} · {model.modelId} · v{model.version}
                  </span>
                </button>
                <span className={`status status-${model.status.toLowerCase()}`}>
                  {model.status}
                </span>
              </div>
            ))}
            {selectedModelId ? (
              <div className="edit-drawer">
                <div className="table-heading">
                  <h3>Edit {selectedModelId}</h3>
                  <button className="text-button" onClick={() => setSelectedModelId(null)}>
                    Close
                  </button>
                </div>
                <label>
                  Lifecycle state
                  <select
                    value={modelStatus}
                    onChange={(event) => setModelStatus(event.target.value)}
                  >
                    <option>AVAILABLE</option>
                    <option>DEGRADED</option>
                    <option>MAINTENANCE</option>
                    <option>DISABLED</option>
                  </select>
                </label>
                <label>
                  Reason for change
                  <input
                    value={changeReason}
                    onChange={(event) => setChangeReason(event.target.value)}
                    required
                  />
                </label>
                <button className="primary-button" onClick={() => void saveModel()}>
                  Save model state
                </button>
              </div>
            ) : null}
          </section>
        ) : null}
        {section === 'Audit' || section === 'Security' ? (
          <section className="admin-table control-surface">
            <div className="table-heading">
              <h2>Append-only control-plane history</h2>
              <span>{controlAudit.length} events</span>
            </div>
            {controlAudit.map((entry) => (
              <div className="action-row" key={`${entry.requestId}-${entry.createdAt}`}>
                <span>
                  <strong>{entry.action}</strong> · {entry.targetType}/{entry.targetId}
                  <small>{entry.reason}</small>
                </span>
                <span>
                  {entry.actor.role} · {new Date(entry.createdAt).toLocaleString()}
                </span>
              </div>
            ))}
          </section>
        ) : null}
        {[
          'Organizations',
          'Rooms',
          'Devices',
          'Web Search',
          'MCP',
          'Plugins',
          'Skills',
          'Remote Access',
          'Releases',
          'Maintenance',
        ].includes(section) ? (
          <section className="admin-table control-surface">
            <div className="table-heading">
              <h2>{section} policy</h2>
              <span>Server boundary</span>
            </div>
            <p className="form-note">
              This surface is reserved for the next policy adapter. Authorization remains
              server-side; this console never treats a local toggle as permission.
            </p>
          </section>
        ) : null}
        {section === 'Email' && canAdmin(role, 'manage_email') ? (
          <section className="admin-form">
            <div className="table-heading">
              <h2>Approved sender identities</h2>
              <span>Server-authorized From and Reply-To</span>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void saveSender();
              }}
            >
              <label>
                Sender kind
                <select
                  value={senderKind}
                  onChange={(event) => {
                    const nextKind = event.target.value as SenderKind;
                    setSenderKind(nextKind);
                    const selected = senders.find((sender) => sender.kind === nextKind);
                    setSenderFrom(selected?.fromAddress ?? '');
                    setSenderReplyTo(selected?.replyTo ?? '');
                  }}
                >
                  <option value="DEFAULT">Default</option>
                  <option value="NOREPLY">No-reply</option>
                  <option value="SUPPORT">Support</option>
                  <option value="BILLING">Billing</option>
                  <option value="SECURITY">Security</option>
                </select>
              </label>
              <label>
                From address
                <input
                  value={senderFrom}
                  onChange={(event) => setSenderFrom(event.target.value)}
                  required
                />
              </label>
              <label>
                Reply-To (optional)
                <input
                  value={senderReplyTo}
                  onChange={(event) => setSenderReplyTo(event.target.value)}
                />
              </label>
              <button className="primary-button" type="submit">
                Save sender identity
              </button>
            </form>
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
