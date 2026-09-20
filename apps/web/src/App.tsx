import { useEffect, useMemo, useState } from 'react';
import { pricingPlans, publicRoutes, resolvePublicRoute } from './routes.js';
import './app.css';

export function App(): React.JSX.Element {
  const [path, setPath] = useState(window.location.pathname || '/');
  const route = useMemo(() => resolvePublicRoute(path), [path]);
  useEffect(() => {
    document.title = `${route.title} — Lyntar`;
    const description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute('content', route.description);
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.setAttribute('href', `https://lyntar.dev${route.path}`);
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) ogTitle.setAttribute('content', route.title);
    const ogDescription = document.querySelector('meta[property="og:description"]');
    if (ogDescription) ogDescription.setAttribute('content', route.description);
  }, [route]);
  useEffect(() => {
    const onPopState = (): void => setPath(window.location.pathname || '/');
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  const navigate = (nextPath: string): void => {
    setPath(nextPath);
    window.history.pushState({}, '', nextPath);
  };
  return (
    <div className="site-shell">
      <header className="site-nav">
        <button className="site-brand" onClick={() => navigate('/')}>
          LYNTAR
        </button>
        <nav>
          <button onClick={() => navigate('/features/agent')}>Product</button>
          <button onClick={() => navigate('/pricing')}>Pricing</button>
          <button onClick={() => navigate('/docs')}>Docs</button>
        </nav>
        <button className="nav-cta" onClick={() => navigate('/download/windows')}>
          Download for Windows
        </button>
      </header>
      <main>
        {route.status === 404 ? (
          <section className="page error-page">
            <span className="eyebrow">404</span>
            <h1>{route.title}</h1>
            <p>{route.description}</p>
            <button className="cta" onClick={() => navigate('/')}>
              Back to Lyntar
            </button>
          </section>
        ) : (
          <>
            <section className="hero page">
              <span className="eyebrow">
                {path === '/' ? 'A development workspace for students' : 'LYNTAR'}
              </span>
              <h1>{route.title}</h1>
              <p>{route.description}</p>
              <div className="hero-actions">
                <button className="cta" onClick={() => navigate('/download/windows')}>
                  Download Lyntar for Windows
                </button>
                <button className="text-button" onClick={() => navigate('/pricing')}>
                  View pricing
                </button>
              </div>
            </section>
            {path === '/' && (
              <>
                <section className="demo page">
                  <div>
                    <span className="eyebrow">A real local workflow</span>
                    <h2>From a failing test to a verified diff.</h2>
                    <p>
                      Lyntar searches the project, reads relevant files, makes bounded edits, runs
                      commands through a permission layer, and reports what it could prove.
                    </p>
                  </div>
                  <div className="demo-panel">
                    <div>✓ Searching project</div>
                    <div>✓ Reading auth.ts</div>
                    <div>● Applying bounded patch</div>
                    <div>○ Running verification</div>
                  </div>
                </section>
                <section className="pricing page">
                  <span className="eyebrow">Plans</span>
                  <h2>Choose the amount of room you need.</h2>
                  <div className="plan-grid">
                    {pricingPlans.map((plan) => (
                      <article key={plan.id}>
                        <span>{plan.id}</span>
                        <strong>{plan.price}</strong>
                        <p>{plan.credits}</p>
                        <button className="text-button" onClick={() => navigate('/signup')}>
                          Get started
                        </button>
                      </article>
                    ))}
                  </div>
                </section>
              </>
            )}
          </>
        )}
      </main>
      <footer className="site-footer">
        <span>Build it. Understand it. Ship it.</span>
        <div>
          {publicRoutes.slice(0, 4).map((item) => (
            <button key={item.path} onClick={() => navigate(item.path)}>
              {item.title.split(' ')[0]}
            </button>
          ))}
        </div>
      </footer>
    </div>
  );
}
