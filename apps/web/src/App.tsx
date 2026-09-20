import { useEffect, useMemo, useState } from 'react';
import { getCompetitor } from './competitors.js';
import {
  noLivePlanData,
  resolvePublicRoute,
  type PublicCreditPack,
  type PublicPlanCard,
} from './routes.js';
import { publicSiteUrl } from './site-config.js';
import './app.css';

const apiBase = '';

function LinkButton({
  path,
  children,
  className = 'text-button',
  navigate,
}: {
  path: string;
  children: React.ReactNode;
  className?: string;
  navigate: (path: string) => void;
}): React.JSX.Element {
  return (
    <button className={className} onClick={() => navigate(path)}>
      {children}
    </button>
  );
}

function countryHint(): string | null {
  const language = typeof navigator === 'undefined' ? '' : navigator.language;
  return /[-_]IN$/i.test(language) ? 'IN' : null;
}

function useServerPlans(): {
  plans: PublicPlanCard[];
  creditPacks: PublicCreditPack[];
  region: 'INDIA' | 'GLOBAL' | null;
  standardCreditRate: { currency: 'INR' | 'USD'; amount: string } | null;
  loading: boolean;
} {
  const [plans, setPlans] = useState<PublicPlanCard[]>([]);
  const [creditPacks, setCreditPacks] = useState<PublicCreditPack[]>([]);
  const [region, setRegion] = useState<'INDIA' | 'GLOBAL' | null>(null);
  const [standardCreditRate, setStandardCreditRate] = useState<{
    currency: 'INR' | 'USD';
    amount: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    const query = countryHint() ? `?country=${countryHint()}` : '';
    void fetch(`${apiBase}/v1/pricing${query}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('plans unavailable');
        const body = (await response.json()) as {
          region?: 'INDIA' | 'GLOBAL';
          standardCreditRate?: { currency: 'INR' | 'USD'; amount: string };
          plans?: Array<{
            id: string;
            displayName: string;
            monthlyCredits: string;
            seats?: number;
            activeJobsPerSeat?: number;
            maxConcurrentJobs?: number;
            pooledCredits?: boolean;
            topUpEnabled?: boolean;
            regionalPrice?: {
              currency: 'INR' | 'USD';
              amount: string;
              taxIncluded: boolean;
            };
          }>;
          creditPacks?: PublicCreditPack[];
        };
        if (!active) return;
        setRegion(body.region ?? null);
        setStandardCreditRate(body.standardCreditRate ?? null);
        setCreditPacks(body.creditPacks ?? []);
        setPlans(
          (body.plans ?? []).map((plan) => ({
            id: plan.id,
            displayName: plan.displayName,
            currency: plan.regionalPrice?.currency ?? 'USD',
            price: plan.regionalPrice?.amount ?? '—',
            monthlyCredits: plan.monthlyCredits,
            seats: plan.seats ?? 1,
            activeJobsPerSeat: plan.activeJobsPerSeat ?? plan.maxConcurrentJobs ?? 1,
            pooledCredits: plan.pooledCredits === true,
            topUpEnabled: plan.topUpEnabled === true,
            source: 'server',
          })),
        );
      })
      .catch(() => {
        if (active) {
          setPlans([]);
          setCreditPacks([]);
          setRegion(null);
          setStandardCreditRate(null);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  return { plans, creditPacks, region, standardCreditRate, loading };
}

function useMetadata(route: ReturnType<typeof resolvePublicRoute>): void {
  useEffect(() => {
    const siteUrl = publicSiteUrl;
    document.title = `${route.title} — Astra Code`;
    const setMeta = (selector: string, attribute: 'content', value: string): void => {
      const element = document.querySelector<HTMLMetaElement>(selector);
      if (element) element.setAttribute(attribute, value);
    };
    setMeta('meta[name="description"]', 'content', route.description);
    setMeta('meta[property="og:site_name"]', 'content', 'Astra Code');
    setMeta('meta[property="og:title"]', 'content', route.title);
    setMeta('meta[property="og:description"]', 'content', route.description);
    setMeta('meta[property="og:url"]', 'content', `${siteUrl}${route.path}`);
    setMeta('meta[name="twitter:title"]', 'content', route.title);
    setMeta('meta[name="twitter:description"]', 'content', route.description);
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (canonical) canonical.href = `${siteUrl}${route.path}`;
    let structured = document.querySelector<HTMLScriptElement>('#astra-route-schema');
    if (!structured) {
      structured = document.createElement('script');
      structured.id = 'astra-route-schema';
      structured.type = 'application/ld+json';
      document.head.appendChild(structured);
    }
    structured.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': route.category === 'comparison' ? 'Article' : 'WebPage',
      name: route.title,
      description: route.description,
      url: `${siteUrl}${route.path}`,
      isPartOf: { '@type': 'WebSite', name: 'Astra Code', url: siteUrl },
    });
  }, [route]);
}

function PlansSection({
  plans,
  creditPacks,
  region,
  standardCreditRate,
  loading,
  navigate,
  compact = false,
}: {
  plans: PublicPlanCard[];
  creditPacks: PublicCreditPack[];
  region: 'INDIA' | 'GLOBAL' | null;
  standardCreditRate: { currency: 'INR' | 'USD'; amount: string } | null;
  loading: boolean;
  navigate: (path: string) => void;
  compact?: boolean;
}): React.JSX.Element {
  return (
    <section className={`section ${compact ? 'section-compact' : ''}`}>
      <div className="section-heading">
        <span className="eyebrow">Server-controlled plans</span>
        <h2>Predictable credits, without provider juggling.</h2>
        <p>
          Prices and allowances are read from Astra Code’s backend. The desktop and public site do
          not own a second pricing table.
        </p>
      </div>
      {loading ? (
        <p className="data-note">Loading authoritative plan data…</p>
      ) : plans.length === 0 ? (
        <p className="data-note">
          {noLivePlanData} · Connect the public API to display current plans.
        </p>
      ) : (
        <div className="plan-grid">
          {plans.map((plan) => (
            <article className="plan-card" key={plan.id}>
              <span className="card-kicker">{plan.displayName}</span>
              <strong>
                {plan.currency === 'INR' ? '₹' : '$'}
                {plan.price}
              </strong>
              <p>{plan.monthlyCredits} credits / month</p>
              <p className="plan-detail">
                {plan.seats} seat{plan.seats === 1 ? '' : 's'} · {plan.activeJobsPerSeat} active job
                {plan.activeJobsPerSeat === 1 ? '' : 's'} per active seat
                {plan.pooledCredits ? ' · pooled' : ''}
              </p>
              {plan.topUpEnabled && (
                <p className="plan-detail">Additional credits available anytime</p>
              )}
              <LinkButton path="/signup" navigate={navigate}>
                Choose {plan.displayName}
              </LinkButton>
            </article>
          ))}
        </div>
      )}
      <p className="data-note">
        {region === 'INDIA'
          ? 'India pricing'
          : region === 'GLOBAL'
            ? 'Global pricing'
            : 'Regional pricing'}{' '}
        · Standard credit rate: {standardCreditRate?.currency === 'INR' ? '₹' : '$'}
        {standardCreditRate?.amount ?? '—'}. Model usage remains metered; subscription credits can
        roll over for one additional cycle under server policy.
      </p>
      {creditPacks.length > 0 && (
        <div className="credit-pack-strip">
          <strong>Need more credits? Add credits and continue.</strong>
          <span>
            {creditPacks.slice(0, 5).map((pack) => (
              <span key={pack.id} className="credit-pack-pill">
                {pack.credits} · {pack.price.currency === 'INR' ? '₹' : '$'}
                {pack.price.amount}
              </span>
            ))}
          </span>
        </div>
      )}
    </section>
  );
}

function Home({
  plans,
  creditPacks,
  region,
  standardCreditRate,
  loading,
  navigate,
}: {
  plans: PublicPlanCard[];
  creditPacks: PublicCreditPack[];
  region: 'INDIA' | 'GLOBAL' | null;
  standardCreditRate: { currency: 'INR' | 'USD'; amount: string } | null;
  loading: boolean;
  navigate: (path: string) => void;
}): React.JSX.Element {
  return (
    <>
      <section className="hero page">
        <div className="hero-copy">
          <span className="eyebrow">Desktop AI coding agent · Windows</span>
          <h1>Your AI coding agent, without the API-key headache.</h1>
          <p className="lede">
            Astra Code connects a local workspace, multiple approved models, bounded tools, task
            estimates, and verified results inside one coding environment.
          </p>
          <div className="hero-actions">
            <LinkButton path="/download/windows" className="cta" navigate={navigate}>
              Download Astra
            </LinkButton>
            <LinkButton path="/features/agent" className="text-button" navigate={navigate}>
              See how Astra works <span aria-hidden="true">→</span>
            </LinkButton>
          </div>
          <p className="availability">
            Windows 10/11 · x64 · Availability follows the current release manifest.
          </p>
        </div>
        <div className="hero-console" aria-label="Astra agent workflow preview">
          <div className="console-top">
            <span className="dot red" />
            <span className="dot amber" />
            <span className="dot green" />
            <span className="console-title">Fix login validation</span>
          </div>
          <div className="console-body">
            <div>
              <span className="ok">✓</span> Searching project <em>11 files considered</em>
            </div>
            <div>
              <span className="ok">✓</span> Reading <em>auth.ts · session.ts</em>
            </div>
            <div>
              <span className="active">●</span> Planning <em>3 bounded steps</em>
            </div>
            <div>
              <span className="muted">○</span> Running tests
            </div>
            <div>
              <span className="muted">○</span> Showing verified diff
            </div>
          </div>
        </div>
      </section>
      <section className="section split-section">
        <div>
          <span className="eyebrow">Model choice</span>
          <h2>Use the model that fits the work.</h2>
          <p>
            Pick an approved model or let Auto route by task complexity, required context,
            capability, availability, and estimated cost. Astra names the selected model; it does
            not hide escalation.
          </p>
          <LinkButton path="/models" navigate={navigate}>
            Explore model access →
          </LinkButton>
        </div>
        <div className="signal-list">
          <div>
            <strong>Auto</strong>
            <span>Balanced routing</span>
          </div>
          <div>
            <strong>Model picker</strong>
            <span>Switch without a new workflow</span>
          </div>
          <div>
            <strong>Usage receipt</strong>
            <span>Actual request-level accounting</span>
          </div>
        </div>
      </section>
      <section className="section feature-band">
        <span className="eyebrow">Before a large task</span>
        <h2>Know the approximate cost before Astra starts.</h2>
        <div className="estimate-card">
          <div>
            <span>Estimated range</span>
            <strong>Task budget</strong>
          </div>
          <div>
            <span>Current balance</span>
            <strong>Server-reported</strong>
          </div>
          <div>
            <span>After task</span>
            <strong>Projected balance</strong>
          </div>
        </div>
        <p>
          Reservations, hard model-call limits, repair limits, and actual receipts are the
          guardrails. See the{' '}
          <LinkButton path="/features/task-estimation" navigate={navigate}>
            estimation model
          </LinkButton>
          .
        </p>
      </section>
      <section className="section split-section">
        <div>
          <span className="eyebrow">Local workspace</span>
          <h2>Real files. Real commands. Real verification.</h2>
          <p>
            Astra works against the repository you select. Reads and writes stay capability-scoped,
            commands are risk-classified, and Git state distinguishes existing changes from Astra’s
            changes.
          </p>
          <LinkButton path="/security" navigate={navigate}>
            Read the security boundary →
          </LinkButton>
        </div>
        <ol className="workflow">
          <li>
            <b>01</b>
            <span>Ask</span>
          </li>
          <li>
            <b>02</b>
            <span>Inspect</span>
          </li>
          <li>
            <b>03</b>
            <span>Edit</span>
          </li>
          <li>
            <b>04</b>
            <span>Run and verify</span>
          </li>
          <li>
            <b>05</b>
            <span>Review the diff</span>
          </li>
        </ol>
      </section>
      <section className="section feature-band">
        <span className="eyebrow">Continuous account</span>
        <h2>Run out of credits? Just add more.</h2>
        <p>
          Your subscription stays the same. Add Astra Credits to the same wallet and continue using
          the same projects, Rooms, integrations, and agent workflows.
        </p>
        <div className="credit-flow" aria-label="Astra credit flow">
          <span>Monthly plan</span>
          <b>→</b>
          <span>Included credits</span>
          <b>→</b>
          <span>Use Astra Code</span>
          <b>→</b>
          <span>Add credits</span>
          <b>→</b>
          <span>Keep building</span>
        </div>
        <LinkButton path="/credits" navigate={navigate}>
          Learn how credits work →
        </LinkButton>
      </section>
      <PlansSection
        plans={plans}
        creditPacks={creditPacks}
        region={region}
        standardCreditRate={standardCreditRate}
        loading={loading}
        navigate={navigate}
        compact
      />
      <section className="section comparison-strip">
        <span className="eyebrow">Make an informed choice</span>
        <h2>See how the workflow differs.</h2>
        <p>
          Comparison pages use current official sources and publish a page only when the source can
          be verified.
        </p>
        <div className="link-grid">
          {[
            '/compare/cursor',
            '/compare/kiro',
            '/compare/kilo-code',
            '/compare/cline',
            '/compare/github-copilot',
            '/compare/byok',
          ].map((item) => (
            <LinkButton key={item} path={item} navigate={navigate}>
              {resolvePublicRoute(item).title} →
            </LinkButton>
          ))}
        </div>
      </section>
      <section className="final-cta page">
        <span className="eyebrow">Astra Code</span>
        <h2>Stop configuring providers. Start building.</h2>
        <LinkButton path="/download/windows" className="cta" navigate={navigate}>
          Download Astra
        </LinkButton>
      </section>
    </>
  );
}

function AuthPanel({ path }: { path: string }): React.JSX.Element {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [resetToken, setResetToken] = useState(
    new URLSearchParams(window.location.search).get('token') ?? '',
  );
  const [message, setMessage] = useState('');
  const isSignup = path === '/signup';
  const isVerification = path === '/verify-email';
  const isForgotPassword = path === '/forgot-password';
  const isResetPassword = path === '/reset-password';
  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const endpoint = isSignup
      ? '/v1/auth/register'
      : isVerification
        ? '/v1/auth/verify-otp'
        : isForgotPassword
          ? '/v1/auth/password-reset/request'
          : isResetPassword
            ? '/v1/auth/password-reset/confirm'
            : '/v1/auth/login';
    const body = isVerification
      ? { email, code }
      : isSignup
        ? {
            email,
            password,
            device: {
              label: 'Astra web',
              platform: 'web',
              architecture: 'browser',
              appVersion: 'web',
            },
          }
        : isForgotPassword
          ? { email }
          : isResetPassword
            ? { token: resetToken, password }
            : {
                email,
                password,
                device: {
                  label: 'Astra web',
                  platform: 'web',
                  architecture: 'browser',
                  appVersion: 'web',
                },
              };
    try {
      const response = await fetch(`${apiBase}${endpoint}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
        emailVerificationRequired?: boolean;
      };
      setMessage(
        response.ok
          ? isSignup
            ? 'Check your email for the verification code.'
            : isForgotPassword
              ? 'If that account exists, a reset message has been sent.'
              : isResetPassword
                ? 'Your password was updated. You can sign in now.'
                : 'Request accepted.'
          : (result.error ?? 'Request failed'),
      );
    } catch {
      setMessage('The Astra API is not connected.');
    }
  };
  return (
    <form className="auth-panel" onSubmit={(event) => void submit(event)}>
      <span className="eyebrow">Astra identity</span>
      <h1>
        {isSignup
          ? 'Create your account'
          : isVerification
            ? 'Verify your email'
            : isForgotPassword
              ? 'Reset your password'
              : isResetPassword
                ? 'Choose a new password'
                : 'Sign in'}
      </h1>
      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          autoComplete="email"
        />
      </label>
      {isVerification ? (
        <label>
          6-digit code
          <input
            inputMode="numeric"
            pattern="\d{6}"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            required
          />
        </label>
      ) : isResetPassword ? (
        <>
          <label>
            Reset token
            <input
              value={resetToken}
              onChange={(event) => setResetToken(event.target.value)}
              required
            />
          </label>
          <label>
            New password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={12}
              autoComplete="new-password"
            />
          </label>
        </>
      ) : !isForgotPassword ? (
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={12}
            autoComplete={isSignup ? 'new-password' : 'current-password'}
          />
        </label>
      ) : null}
      <button className="cta" type="submit">
        {isSignup
          ? 'Create account'
          : isVerification
            ? 'Verify email'
            : isForgotPassword
              ? 'Send reset email'
              : isResetPassword
                ? 'Update password'
                : 'Sign in'}
      </button>
      {message && (
        <p role="status" className="form-message">
          {message}
        </p>
      )}
      <p className="form-footnote">
        Google sign-in uses the system browser in the desktop application. No embedded provider
        login is used.
      </p>
    </form>
  );
}

interface AccountSnapshot {
  user: {
    id: string;
    email: string;
    emailVerifiedAt: string | null;
    planId: string;
    status: string;
  };
  wallet: {
    availableCredits: string;
    reservedCredits: string;
    consumedCredits: string;
  };
  ledger: Array<{
    id: string;
    transactionType: string;
    amountCredits: string;
    reason: string;
    createdAt: string;
  }>;
  devices: Array<{
    deviceSessionId: string;
    deviceLabel: string;
    platform: string;
    lastSeenAt: string;
    revokedAt: string | null;
  }>;
  marketingAllowed: boolean;
}

function AccountPanel({
  path,
  navigate,
}: {
  path: string;
  navigate: (path: string) => void;
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<AccountSnapshot | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [marketingAllowed, setMarketingAllowed] = useState(false);
  const tab = path.endsWith('/wallet')
    ? 'wallet'
    : path.endsWith('/billing')
      ? 'billing'
      : path.endsWith('/devices')
        ? 'devices'
        : 'overview';

  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      const request = (endpoint: string): Promise<Response> =>
        fetch(`${apiBase}${endpoint}`, { credentials: 'include' });
      const meResponse = await request('/v1/auth/me');
      if (meResponse.status === 401 || meResponse.status === 403) {
        if (active) setMessage('Sign in to manage your Astra Code account.');
        return;
      }
      if (!meResponse.ok) throw new Error('Account data is unavailable.');
      const me = (await meResponse.json()) as { user: AccountSnapshot['user'] };
      const [walletResponse, ledgerResponse, devicesResponse, preferenceResponse] =
        await Promise.all([
          request('/v1/wallet'),
          request('/v1/wallet/ledger'),
          request('/v1/auth/devices'),
          request('/v1/account/email-preferences'),
        ]);
      if (!walletResponse.ok || !ledgerResponse.ok || !devicesResponse.ok)
        throw new Error('Account data is unavailable.');
      const walletBody = (await walletResponse.json()) as { wallet: AccountSnapshot['wallet'] };
      const ledgerBody = (await ledgerResponse.json()) as { entries: AccountSnapshot['ledger'] };
      const devicesBody = (await devicesResponse.json()) as {
        devices: AccountSnapshot['devices'];
      };
      const preferenceBody = preferenceResponse.ok
        ? ((await preferenceResponse.json()) as { marketingAllowed?: boolean })
        : { marketingAllowed: false };
      if (!active) return;
      setSnapshot({
        user: me.user,
        wallet: walletBody.wallet,
        ledger: ledgerBody.entries,
        devices: devicesBody.devices,
        marketingAllowed: preferenceBody.marketingAllowed === true,
      });
      setMarketingAllowed(preferenceBody.marketingAllowed === true);
    };
    void load()
      .catch((error: unknown) => {
        if (active)
          setMessage(error instanceof Error ? error.message : 'Account data is unavailable.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path]);

  async function updateMarketingPreference(allowed: boolean): Promise<void> {
    setMarketingAllowed(allowed);
    const response = await fetch(`${apiBase}/v1/account/email-preferences`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ marketingAllowed: allowed }),
    });
    if (!response.ok)
      setMessage('Marketing preferences are unavailable until email is configured.');
  }

  async function revokeDevice(deviceSessionId: string): Promise<void> {
    const response = await fetch(
      `${apiBase}/v1/auth/devices/${encodeURIComponent(deviceSessionId)}/revoke`,
      {
        method: 'POST',
        credentials: 'include',
      },
    );
    if (!response.ok) {
      setMessage('The device could not be revoked.');
      return;
    }
    setSnapshot((current) =>
      current
        ? {
            ...current,
            devices: current.devices.map((device) =>
              device.deviceSessionId === deviceSessionId
                ? { ...device, revokedAt: new Date().toISOString() }
                : device,
            ),
          }
        : current,
    );
  }

  async function signOut(): Promise<void> {
    await fetch(`${apiBase}/v1/auth/logout`, { method: 'POST', credentials: 'include' });
    navigate('/login');
  }

  if (loading)
    return (
      <section className="page account-page">
        <p className="data-note">Loading server account data…</p>
      </section>
    );
  if (!snapshot)
    return (
      <section className="page account-page">
        <span className="eyebrow">Astra identity</span>
        <h1>Account access</h1>
        <p className="lede">{message || 'Sign in to view your account.'}</p>
        <LinkButton path="/login" className="cta" navigate={navigate}>
          Sign in
        </LinkButton>
      </section>
    );

  return (
    <section className="page account-page">
      <div className="account-heading">
        <div>
          <span className="eyebrow">Astra account</span>
          <h1>
            {tab === 'overview'
              ? 'Your account'
              : tab === 'wallet'
                ? 'Your credits'
                : tab === 'billing'
                  ? 'Billing'
                  : 'Your devices'}
          </h1>
          <p className="lede">
            {snapshot.user.email} · {snapshot.user.planId} · {snapshot.user.status}
          </p>
        </div>
        <button className="text-button" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
      <nav className="account-tabs" aria-label="Account">
        <LinkButton path="/account" navigate={navigate}>
          Overview
        </LinkButton>
        <LinkButton path="/account/wallet" navigate={navigate}>
          Credits
        </LinkButton>
        <LinkButton path="/account/billing" navigate={navigate}>
          Billing
        </LinkButton>
        <LinkButton path="/account/devices" navigate={navigate}>
          Devices
        </LinkButton>
      </nav>
      {tab === 'overview' ? (
        <div className="account-grid">
          <article className="account-card">
            <span>Available credits</span>
            <strong>{snapshot.wallet.availableCredits}</strong>
          </article>
          <article className="account-card">
            <span>Reserved</span>
            <strong>{snapshot.wallet.reservedCredits}</strong>
          </article>
          <article className="account-card">
            <span>Consumed</span>
            <strong>{snapshot.wallet.consumedCredits}</strong>
          </article>
          <article className="account-card account-card-wide">
            <h2>Product email</h2>
            <label className="preference-row">
              <input
                type="checkbox"
                checked={marketingAllowed}
                onChange={(event) => void updateMarketingPreference(event.target.checked)}
              />
              Receive product updates and announcements
            </label>
            <p>Security, verification, password, and billing messages remain transactional.</p>
          </article>
        </div>
      ) : tab === 'wallet' ? (
        <div className="account-card account-card-wide">
          <h2>Credit ledger</h2>
          {snapshot.ledger.length === 0 ? (
            <p className="data-note">No ledger entries.</p>
          ) : (
            snapshot.ledger.map((entry) => (
              <div className="ledger-row" key={entry.id}>
                <span>
                  {entry.transactionType}
                  <small>{entry.reason}</small>
                </span>
                <strong>{entry.amountCredits}</strong>
              </div>
            ))
          )}
        </div>
      ) : tab === 'billing' ? (
        <div className="account-card account-card-wide">
          <h2>{snapshot.user.planId} plan</h2>
          <p>
            Plan and payment state are authoritative on the Astra backend. Checkout and payment
            history appear here when a verified payment environment is connected.
          </p>
          <LinkButton path="/pricing" className="cta" navigate={navigate}>
            View plans
          </LinkButton>
        </div>
      ) : (
        <div className="account-card account-card-wide">
          <h2>Connected devices</h2>
          {snapshot.devices.map((device) => (
            <div className="ledger-row" key={device.deviceSessionId}>
              <span>
                {device.deviceLabel}
                <small>
                  {device.platform} · last seen {new Date(device.lastSeenAt).toLocaleString()}
                </small>
              </span>
              {device.revokedAt ? (
                <strong>Revoked</strong>
              ) : (
                <button
                  className="text-button"
                  onClick={() => void revokeDevice(device.deviceSessionId)}
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {message && (
        <p className="form-message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}

function ComparisonPage({
  slug,
  navigate,
}: {
  slug: string;
  navigate: (path: string) => void;
}): React.JSX.Element {
  if (slug === 'byok')
    return (
      <section className="page article-page">
        <span className="eyebrow">Comparison</span>
        <h1>Astra Code vs BYOK agents</h1>
        <p className="lede">
          BYOK gives advanced users direct provider control. Astra packages approved model access,
          estimates, model switching, and account-level credits into one workflow.
        </p>
        <div className="compare-flow">
          <div>
            <h2>BYOK</h2>
            <p>
              Choose a provider → create a key → enable provider billing → configure and rotate keys
              → track provider usage and errors.
            </p>
          </div>
          <div>
            <h2>Astra Code</h2>
            <p>
              Create an Astra account → choose a plan → see the estimate → run the task → inspect
              the usage receipt.
            </p>
          </div>
        </div>
        <h2>Choose based on control</h2>
        <p>
          BYOK may suit users who want direct provider relationships and potentially lower raw
          inference cost. Astra may suit users who want less provider configuration, one account,
          model switching, and predictable credit controls.
        </p>
        <LinkButton path="/pricing" className="cta" navigate={navigate}>
          See Astra plans
        </LinkButton>
      </section>
    );
  const competitor = getCompetitor(slug);
  if (!competitor)
    return (
      <section className="page article-page">
        <h1>Comparison unavailable</h1>
        <p>There is no verified source for this competitor.</p>
      </section>
    );
  return (
    <section className="page article-page">
      <span className="eyebrow">Verified {competitor.verifiedAt}</span>
      <h1>Astra Code vs {competitor.name}</h1>
      {competitor.published ? (
        <>
          <p className="lede">
            Compare workflow, model access, usage economics, and onboarding using current public
            information.
          </p>
          <div className="fact-grid">
            <div>
              <span>Astra Code</span>
              <strong>Managed desktop workflow</strong>
              <p>
                Server-controlled models, local workspace access, task budgets, estimates, and
                actual usage receipts.
              </p>
            </div>
            <div>
              <span>{competitor.name}</span>
              <strong>Verified public position</strong>
              <p>{competitor.workflow}</p>
            </div>
          </div>
          <h2>Where Astra may fit</h2>
          <p>{competitor.fit}</p>
          <h2>What to consider</h2>
          <p>{competitor.caveat}</p>
          <div className="source-note">
            <strong>Official sources</strong>
            {competitor.sourceUrls.map((source) => (
              <a href={source} key={source} target="_blank" rel="noreferrer">
                {source}
              </a>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="lede">
            This page is intentionally not published as a factual comparison yet.
          </p>
          <div className="pending-card">
            <strong>Verification pending</strong>
            <p>{competitor.caveat}</p>
            <p>Source checked: {competitor.sourceUrls.join(', ')}</p>
          </div>
        </>
      )}
      <LinkButton path="/download/windows" className="cta" navigate={navigate}>
        Download Astra
      </LinkButton>
    </section>
  );
}

export function App(): React.JSX.Element {
  const [path, setPath] = useState(window.location.pathname || '/');
  const route = useMemo(() => resolvePublicRoute(path), [path]);
  const { plans, creditPacks, region, standardCreditRate, loading } = useServerPlans();
  useMetadata(route);
  const navigate = (nextPath: string): void => {
    setPath(nextPath);
    window.history.pushState({}, '', nextPath);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  useEffect(() => {
    const onPopState = (): void => setPath(window.location.pathname || '/');
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  const isAuth =
    route.category === 'account' &&
    ['/login', '/signup', '/verify-email', '/forgot-password', '/reset-password'].includes(path);
  return (
    <div className="site-shell">
      <header className="site-nav">
        <LinkButton path="/" className="site-brand" navigate={navigate}>
          ASTRA <span>CODE</span>
        </LinkButton>
        <details className="mobile-nav">
          <summary>Menu</summary>
          <nav>
            <LinkButton path="/features/agent" navigate={navigate}>
              Product
            </LinkButton>
            <LinkButton path="/pricing" navigate={navigate}>
              Pricing
            </LinkButton>
            <LinkButton path="/docs" navigate={navigate}>
              Docs
            </LinkButton>
          </nav>
        </details>
        <nav className="desktop-nav" aria-label="Primary">
          <LinkButton path="/features/agent" navigate={navigate}>
            Product
          </LinkButton>
          <LinkButton path="/features/task-estimation" navigate={navigate}>
            Features
          </LinkButton>
          <LinkButton path="/models" navigate={navigate}>
            Models
          </LinkButton>
          <LinkButton path="/compare" navigate={navigate}>
            Compare
          </LinkButton>
          <LinkButton path="/pricing" navigate={navigate}>
            Pricing
          </LinkButton>
          <LinkButton path="/docs" navigate={navigate}>
            Docs
          </LinkButton>
        </nav>
        <div className="nav-actions">
          <LinkButton path="/login" navigate={navigate}>
            Sign in
          </LinkButton>
          <LinkButton path="/download/windows" className="nav-cta" navigate={navigate}>
            Download Astra
          </LinkButton>
        </div>
      </header>
      <main>
        {route.status === 404 ? (
          <section className="page error-page">
            <span className="eyebrow">404</span>
            <h1>{route.title}</h1>
            <p>{route.description}</p>
            <LinkButton path="/" className="cta" navigate={navigate}>
              Back to Astra
            </LinkButton>
          </section>
        ) : path === '/' ? (
          <Home
            plans={plans}
            creditPacks={creditPacks}
            region={region}
            standardCreditRate={standardCreditRate}
            loading={loading}
            navigate={navigate}
          />
        ) : route.category === 'comparison' ? (
          <ComparisonPage slug={route.competitor ?? ''} navigate={navigate} />
        ) : isAuth ? (
          <section className="page auth-page">
            <AuthPanel path={path} />
          </section>
        ) : route.category === 'account' && path.startsWith('/account') ? (
          <AccountPanel path={path} navigate={navigate} />
        ) : path === '/pricing' ? (
          <>
            <section className="page article-page">
              <span className="eyebrow">Pricing</span>
              <h1>One account for models, tasks, and credits.</h1>
              <p className="lede">
                Astra Code’s canonical plans come from the backend. Credits are settled from actual
                usage receipts; they are not a synonym for provider tokens.
              </p>
            </section>
            <PlansSection
              plans={plans}
              creditPacks={creditPacks}
              region={region}
              standardCreditRate={standardCreditRate}
              loading={loading}
              navigate={navigate}
            />
          </>
        ) : path === '/credits' ? (
          <section className="page article-page">
            <span className="eyebrow">Astra Credits</span>
            <h1>One account. Included usage. Top up when you need more.</h1>
            <p className="lede">
              Astra Credits are the standardized unit of metered AI usage. When included monthly
              credits run out, purchase credits into the same wallet instead of creating another
              account or losing project context.
            </p>
            <div className="article-columns">
              <div>
                <h2>How balances work</h2>
                <p>
                  Monthly included credits refresh each cycle and follow the configured rollover
                  policy. Purchased credits are tracked separately and remain valid for 12 months.
                </p>
                <h2>Personal and organization wallets</h2>
                <p>
                  Personal work uses a personal wallet. Team and Business Room work uses the pooled
                  organization wallet, with member and Room attribution retained in the ledger.
                </p>
                <h2>Usage is model-dependent</h2>
                <p>
                  Different models and tool workflows consume credits at different rates. Astra
                  shows estimates and reconciles actual usage from server receipts.
                </p>
              </div>
              <aside className="article-aside">
                <strong>Need more credits?</strong>
                <span>Add credits and continue.</span>
                <span>Same account</span>
                <span>Same projects</span>
                <span>Same Room context</span>
                <LinkButton path="/pricing" className="cta" navigate={navigate}>
                  View regional pricing
                </LinkButton>
              </aside>
            </div>
            <div className="faq-list">
              <h2>Credit FAQ</h2>
              <details>
                <summary>What happens when I run out?</summary>
                <p>
                  Purchase additional Astra Credits and continue from the same account. No second
                  subscription is required.
                </p>
              </details>
              <details>
                <summary>Are Team credits shared?</summary>
                <p>
                  Yes. Team and Business monthly credits are pooled through the organization wallet
                  and used by authorized members.
                </p>
              </details>
              <details>
                <summary>Can I change regional pricing with a VPN?</summary>
                <p>
                  Regional pricing is based on verified account and billing-region information, not
                  only the current IP address.
                </p>
              </details>
            </div>
          </section>
        ) : (
          <section className="page article-page">
            <span className="eyebrow">
              {route.category === 'feature'
                ? 'Feature'
                : route.category === 'use-case'
                  ? 'Use case'
                  : 'Astra Code'}
            </span>
            <h1>{route.title}</h1>
            <p className="lede">{route.description}</p>
            <div className="article-columns">
              <div>
                <h2>What Astra does</h2>
                <p>
                  Astra works with the local project you select, routes only the relevant workflow
                  context, and shows concise execution status instead of hidden model scratchpad.
                </p>
                <h2>What to expect</h2>
                <p>
                  Requests are subject to the current model catalog, plan entitlements, task
                  budgets, workspace permissions, and the availability of the connected backend.
                </p>
              </div>
              <aside className="article-aside">
                <strong>Built around evidence</strong>
                <span>Real files</span>
                <span>Bounded actions</span>
                <span>Verified results</span>
                <span>Reviewable diff</span>
              </aside>
            </div>
            <div className="article-actions">
              <LinkButton path="/download/windows" className="cta" navigate={navigate}>
                Download Astra
              </LinkButton>
              <LinkButton path="/security" navigate={navigate}>
                Read security details →
              </LinkButton>
            </div>
          </section>
        )}
      </main>
      <footer className="site-footer">
        <span>Build it. Understand it. Ship it.</span>
        <div>
          <LinkButton path="/security" navigate={navigate}>
            Security
          </LinkButton>
          <LinkButton path="/docs" navigate={navigate}>
            Docs
          </LinkButton>
          <LinkButton path="/privacy" navigate={navigate}>
            Privacy
          </LinkButton>
        </div>
      </footer>
    </div>
  );
}
