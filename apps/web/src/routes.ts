export interface PublicRoute {
  path: string;
  title: string;
  description: string;
  status: 200 | 404;
}

const routeDefinitions: Array<[string, string, string]> = [
  [
    '/',
    'Build it. Understand it. Ship it.',
    'Lyntar is the Windows AI development workspace for students building real software.',
  ],
  [
    '/download',
    'Download Lyntar',
    'Download the Windows application and review requirements before installing.',
  ],
  [
    '/download/windows',
    'Lyntar for Windows',
    'Windows 10/11 x64 download details, release notes, and verification information.',
  ],
  [
    '/pricing',
    'Lyntar pricing',
    'Compare Free, Student, Pro, and Max plans served by the backend.',
  ],
  [
    '/students',
    'Lyntar for students',
    'Build projects, understand the code, and prepare for interviews with a local-first workflow.',
  ],
  [
    '/vibe-coding',
    'Vibe coding with guardrails',
    'Turn an idea into a working project while keeping changes bounded and verifiable.',
  ],
  [
    '/ai-coding-agent',
    'AI coding agent',
    'A local repository agent that can inspect, edit, run, test, and show a verified diff.',
  ],
  [
    '/features/agent',
    'Agent workspace',
    'Safe local project execution with permissions, budgets, Git isolation, and verification.',
  ],
  [
    '/features/learn',
    'Learn Mode',
    'Understand actual files and functions from the project you opened.',
  ],
  [
    '/features/viva',
    'Viva Mode',
    'Practice project-specific questions grounded in your repository.',
  ],
  [
    '/features/hackathon',
    'Hackathon Mode',
    'Shape a credible MVP, demo plan, and verification path.',
  ],
  [
    '/features/skills',
    'Skills',
    'Route relevant instruction and workflow packages without loading everything into every task.',
  ],
  ['/features/plugins', 'Plugins', 'Extend the product through explicit capability permissions.'],
  [
    '/features/mcp',
    'MCP connections',
    'Connect scoped MCP servers with visible tools, permissions, and health.',
  ],
  [
    '/compare',
    'Compare Lyntar',
    'Compare workflows honestly by use case rather than stale feature checklists.',
  ],
  [
    '/compare/lyntar-vs-cursor',
    'Lyntar vs Cursor',
    'A use-case comparison for a student-first local development workflow.',
  ],
  [
    '/compare/lyntar-vs-github-copilot',
    'Lyntar vs GitHub Copilot',
    'Compare local agent execution and learning workflows with current verified facts.',
  ],
  [
    '/compare/lyntar-vs-cline',
    'Lyntar vs Cline',
    'Compare product-layer workflows while acknowledging where each tool fits.',
  ],
  [
    '/compare/lyntar-vs-windsurf',
    'Lyntar vs Windsurf',
    'Compare project building, learning, and student workflows without stale claims.',
  ],
  [
    '/marketplace',
    'Lyntar Marketplace',
    'Discover reviewed Skills, Plugins, and MCP packages when publishing is enabled.',
  ],
  [
    '/skills',
    'Skills marketplace',
    'Browse workflow packages with publisher, version, license, and permission details.',
  ],
  ['/plugins', 'Plugins marketplace', 'Browse capability-scoped Lyntar extensions.'],
  ['/mcp', 'MCP directory', 'Browse scoped MCP connection definitions and their capabilities.'],
  [
    '/docs',
    'Lyntar documentation',
    'Learn how local workspaces, permissions, verification, and modes work.',
  ],
  ['/blog', 'Lyntar blog', 'Product notes and practical development workflows.'],
  ['/changelog', 'Lyntar changelog', 'Versioned product and release notes.'],
  [
    '/security',
    'Lyntar security',
    'Security boundaries, responsible disclosure, and local workspace protections.',
  ],
  ['/privacy', 'Privacy', 'How Lyntar handles account, usage, and local workspace metadata.'],
  ['/terms', 'Terms', 'Terms for using Lyntar services and software.'],
  ['/refund-policy', 'Refund policy', 'Refund and payment policy information.'],
  ['/open-source-notices', 'Open-source notices', 'Third-party dependency and license notices.'],
  ['/login', 'Sign in to Lyntar', 'Use your Lyntar account to access the product.'],
  [
    '/signup',
    'Create your Lyntar account',
    'Create an account and start with the available plan entitlement.',
  ],
  ['/account', 'Your Lyntar account', 'Manage account status and profile information.'],
  ['/account/wallet', 'Your wallet', 'View server-reported credits and usage.'],
  ['/account/billing', 'Billing', 'Manage plan and verified payment state.'],
  ['/account/devices', 'Devices', 'Review and revoke active desktop sessions.'],
];

export const publicRoutes: PublicRoute[] = routeDefinitions.map(([path, title, description]) => ({
  path,
  title,
  description,
  status: 200,
}));

export function resolvePublicRoute(pathname: string): PublicRoute {
  return (
    publicRoutes.find((route) => route.path === pathname) ?? {
      path: pathname,
      title: 'Page not found',
      description: 'This route is not part of the Lyntar public surface.',
      status: 404,
    }
  );
}

export const pricingPlans = [
  { id: 'FREE', price: '₹0', credits: '50 credits / month' },
  { id: 'STUDENT', price: '₹149', credits: '500 credits / month' },
  { id: 'PRO', price: '₹299', credits: '1,200 credits / month' },
  { id: 'MAX', price: '₹599', credits: '2,500 credits / month' },
];
