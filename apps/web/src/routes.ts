export interface PublicRoute {
  path: string;
  title: string;
  description: string;
  status: 200 | 404;
  published?: boolean;
  category?: 'public' | 'feature' | 'use-case' | 'comparison' | 'account' | 'legal';
  competitor?: string;
}

const routeDefinitions: Array<
  [
    string,
    string,
    string,
    NonNullable<PublicRoute['category']>,
    boolean | undefined,
    string | undefined,
  ]
> = [
  [
    '/',
    'Build with the model you want.',
    'Astra Code is a desktop coding agent for local projects, bounded actions, and verified results.',
    'public',
    true,
    undefined,
  ],
  [
    '/pricing',
    'Astra Code pricing',
    'Regional plans, included Astra Credits, and optional top-ups from one account.',
    'public',
    true,
    undefined,
  ],
  [
    '/credits',
    'Astra Credits',
    'Understand included credits, purchased top-ups, pooled organization wallets, and usage.',
    'public',
    true,
    undefined,
  ],
  [
    '/download',
    'Download Astra Code',
    'Install the supported Windows desktop application and review release requirements.',
    'public',
    true,
    undefined,
  ],
  [
    '/download/windows',
    'Astra Code for Windows',
    'Windows 10/11 x64 download details, release notes, and integrity information.',
    'public',
    true,
    undefined,
  ],
  [
    '/models',
    'Choose the model for the job',
    'See the models Astra Code has approved and how Auto selects among them.',
    'public',
    true,
    undefined,
  ],
  [
    '/security',
    'Security boundaries you can inspect',
    'Workspace confinement, capability permissions, bounded actions, and secret-aware handling.',
    'public',
    true,
    undefined,
  ],
  [
    '/docs',
    'Astra Code documentation',
    'Learn how local workspaces, permissions, verification, and model usage work.',
    'public',
    true,
    undefined,
  ],
  [
    '/blog',
    'Astra Code notes',
    'Practical writing about agentic development, verification, and product updates.',
    'public',
    true,
    undefined,
  ],
  [
    '/features/agent',
    'A coding agent with a finish line',
    'Ask, plan, inspect, edit, run, verify, and review the resulting diff.',
    'feature',
    true,
    undefined,
  ],
  [
    '/features/codebase',
    'Understand the codebase before changing it',
    'Relevant-file search and scoped local reads keep the agent grounded in the repository.',
    'feature',
    true,
    undefined,
  ],
  [
    '/features/model-switching',
    'Switch models without rebuilding your workflow',
    'Use approved models through one server-controlled catalog and a shared task history.',
    'feature',
    true,
    undefined,
  ],
  [
    '/features/task-estimation',
    'See an estimate before a large task starts',
    'Task budgets and cost estimates help prevent an accidental open-ended run.',
    'feature',
    true,
    undefined,
  ],
  [
    '/features/mcp',
    'Connect tools with visible boundaries',
    'Use MCP only where a scoped connection and its permissions make sense.',
    'feature',
    true,
    undefined,
  ],
  [
    '/features/remote',
    'Remote control where supported',
    'Use the existing pairing and relay boundary without implying unrestricted public execution.',
    'feature',
    true,
    undefined,
  ],
  [
    '/features/security',
    'Security-aware development',
    'Workspace paths, command risk, approvals, rollback, and redaction are part of the workflow.',
    'feature',
    true,
    undefined,
  ],
  [
    '/features/cost-control',
    'Keep model usage bounded',
    'Reservations, task budgets, actual usage receipts, and settlement records work together.',
    'feature',
    true,
    undefined,
  ],
  [
    '/features/learn',
    'Learn from the project you actually opened',
    'Get explanations grounded in files, functions, and the local repository.',
    'feature',
    true,
    undefined,
  ],
  [
    '/features/viva',
    'Practice the architecture you built',
    'Viva questions reference project elements instead of generic computer-science prompts.',
    'feature',
    true,
    undefined,
  ],
  [
    '/features/hackathon',
    'Turn a brief into a credible MVP',
    'Define must-have scope, implement it, verify it, and prepare the demo story.',
    'feature',
    true,
    undefined,
  ],
  [
    '/features/skills',
    'Relevant Skills, loaded on demand',
    'Workflow packages guide tasks without injecting every instruction into every model request.',
    'feature',
    true,
    undefined,
  ],
  [
    '/features/plugins',
    'Extensions with explicit permissions',
    'Extend Astra only through declared capabilities and reviewable trust boundaries.',
    'feature',
    true,
    undefined,
  ],
  [
    '/use-cases/students',
    'Astra Code for students',
    'Build projects, understand the code, and prepare for interviews from one desktop workflow.',
    'use-case',
    true,
    undefined,
  ],
  [
    '/use-cases/freelancers',
    'Astra Code for freelancers',
    'Move from brief to verified change while keeping model and tool costs visible.',
    'use-case',
    true,
    undefined,
  ],
  [
    '/use-cases/startups',
    'Astra Code for startups',
    'Keep a small team moving across unfamiliar code without hiding the resulting diff.',
    'use-case',
    true,
    undefined,
  ],
  [
    '/use-cases/developers',
    'Astra Code for developers',
    'A local-first agent for real repositories, real commands, and real verification.',
    'use-case',
    true,
    undefined,
  ],
  [
    '/use-cases/teams',
    'Astra Code for teams',
    'Server-controlled models, plans, costs, and an auditable execution boundary.',
    'use-case',
    true,
    undefined,
  ],
  [
    '/compare',
    'Compare coding-agent workflows',
    'A factual comparison hub. Individual pages are published only when their sources are current and verified.',
    'comparison',
    true,
    undefined,
  ],
  [
    '/compare/cursor',
    'Astra Code vs Cursor',
    'Compare model access, usage economics, workspace workflow, and agent boundaries with current official sources.',
    'comparison',
    true,
    'cursor',
  ],
  [
    '/compare/kiro',
    'Astra Code vs Kiro',
    'Compare local desktop work, model credits, web workflows, and plan structure with current official sources.',
    'comparison',
    true,
    'kiro',
  ],
  [
    '/compare/kilo-code',
    'Astra Code vs Kilo Code',
    'Compare managed credits, BYOK flexibility, extensions, and cloud compute with current official sources.',
    'comparison',
    true,
    'kilo-code',
  ],
  [
    '/compare/cline',
    'Astra Code vs Cline',
    'Compare a managed desktop product with an open-source, provider-flexible coding agent.',
    'comparison',
    true,
    'cline',
  ],
  [
    '/compare/windsurf',
    'Astra Code vs Windsurf',
    'Comparison pending a current official Windsurf product source.',
    'comparison',
    false,
    'windsurf',
  ],
  [
    '/compare/roo-code',
    'Astra Code vs Roo Code',
    'Comparison pending a current official Roo Code product source.',
    'comparison',
    false,
    'roo-code',
  ],
  [
    '/compare/github-copilot',
    'Astra Code vs GitHub Copilot',
    'Compare a desktop-first local agent with GitHub’s editor, CLI, and cloud-agent ecosystem.',
    'comparison',
    true,
    'github-copilot',
  ],
  [
    '/compare/byok',
    'Astra Code vs BYOK agents',
    'Understand managed model access and BYOK control without treating either approach as universally better.',
    'comparison',
    true,
    'byok',
  ],
  [
    '/alternatives/cursor',
    'Astra Code alternative to Cursor',
    'A use-case-focused comparison for developers considering a managed multi-model desktop workflow.',
    'comparison',
    true,
    'cursor',
  ],
  [
    '/alternatives/kiro',
    'Astra Code alternative to Kiro',
    'Compare a local Windows workflow with Kiro’s current documented surfaces.',
    'comparison',
    true,
    'kiro',
  ],
  [
    '/alternatives/cline',
    'Astra Code alternative to Cline',
    'Compare managed credits and onboarding with a provider-flexible open-source agent.',
    'comparison',
    true,
    'cline',
  ],
  [
    '/alternatives/windsurf',
    'Astra Code alternative to Windsurf',
    'Comparison pending a current official Windsurf product source.',
    'comparison',
    false,
    'windsurf',
  ],
  [
    '/marketplace',
    'Astra Code marketplace',
    'Discover reviewed Skills, Plugins, and MCP packages when publishing is enabled.',
    'public',
    false,
    undefined,
  ],
  [
    '/skills',
    'Astra Code Skills',
    'Browse workflow packages with publisher, version, license, and permission details.',
    'public',
    true,
    undefined,
  ],
  [
    '/plugins',
    'Astra Code Plugins',
    'Browse capability-scoped extensions without granting unrestricted access by default.',
    'public',
    true,
    undefined,
  ],
  [
    '/mcp',
    'Astra Code MCP directory',
    'Browse scoped MCP connection definitions and their capabilities.',
    'public',
    true,
    undefined,
  ],
  [
    '/changelog',
    'Astra Code changelog',
    'Read versioned Astra Code product and release notes.',
    'public',
    true,
    undefined,
  ],
  // Legacy public paths remain resolvable while the canonical Astra routes take over.
  [
    '/students',
    'Astra Code for students',
    'Build projects, understand the code, and prepare for interviews from one desktop workflow.',
    'use-case',
    false,
    undefined,
  ],
  [
    '/vibe-coding',
    'Vibe coding with Astra Code',
    'Turn an idea into a working project while keeping changes bounded and verifiable.',
    'feature',
    false,
    undefined,
  ],
  [
    '/ai-coding-agent',
    'Astra Code coding agent',
    'A local repository agent that can inspect, edit, run, test, and show a verified diff.',
    'feature',
    false,
    undefined,
  ],
  [
    '/compare/astra-vs-cursor',
    'Astra Code vs Cursor',
    'Legacy alias for the current Astra Code versus Cursor comparison.',
    'comparison',
    false,
    'cursor',
  ],
  [
    '/compare/astra-vs-github-copilot',
    'Astra Code vs GitHub Copilot',
    'Legacy alias for the current Astra Code versus GitHub Copilot comparison.',
    'comparison',
    false,
    'github-copilot',
  ],
  [
    '/compare/astra-vs-cline',
    'Astra Code vs Cline',
    'Legacy alias for the current Astra Code versus Cline comparison.',
    'comparison',
    false,
    'cline',
  ],
  [
    '/compare/astra-vs-windsurf',
    'Astra Code vs Windsurf',
    'Legacy alias for a comparison pending a current official Windsurf product source.',
    'comparison',
    false,
    'windsurf',
  ],
  [
    '/login',
    'Sign in to Astra Code',
    'Use one Astra identity across the website, desktop, billing, and devices.',
    'account',
    true,
    undefined,
  ],
  [
    '/signup',
    'Create your Astra Code account',
    'Create an account and verify your email before using the product.',
    'account',
    true,
    undefined,
  ],
  [
    '/verify-email',
    'Verify your Astra Code email',
    'Enter the one-time verification code sent to your email.',
    'account',
    true,
    undefined,
  ],
  [
    '/forgot-password',
    'Reset your Astra Code password',
    'Request a time-limited password reset link.',
    'account',
    true,
    undefined,
  ],
  [
    '/reset-password',
    'Choose a new Astra Code password',
    'Set a new password after verifying a reset request.',
    'account',
    true,
    undefined,
  ],
  [
    '/account',
    'Your Astra Code account',
    'Manage your profile, security, plan, and product preferences.',
    'account',
    true,
    undefined,
  ],
  [
    '/account/wallet',
    'Your Astra Code credits',
    'View server-reported balance, reservations, settlements, and usage.',
    'account',
    true,
    undefined,
  ],
  [
    '/account/billing',
    'Astra Code billing',
    'Manage authoritative plan and payment state.',
    'account',
    true,
    undefined,
  ],
  [
    '/account/devices',
    'Your Astra Code devices',
    'Review and revoke active desktop sessions.',
    'account',
    true,
    undefined,
  ],
  [
    '/privacy',
    'Astra Code privacy',
    'How account, usage, and local workspace metadata are handled.',
    'legal',
    true,
    undefined,
  ],
  [
    '/terms',
    'Astra Code terms',
    'Terms for using Astra Code services and software.',
    'legal',
    true,
    undefined,
  ],
  [
    '/refund-policy',
    'Astra Code refund policy',
    'Refund and payment policy information.',
    'legal',
    true,
    undefined,
  ],
  [
    '/open-source-notices',
    'Astra Code open-source notices',
    'Third-party dependency and license notices.',
    'legal',
    true,
    undefined,
  ],
];

export const publicRoutes: PublicRoute[] = routeDefinitions.map(
  ([path, title, description, category, published, competitor]) => ({
    path,
    title,
    description,
    status: 200,
    category,
    ...(published === undefined ? {} : { published }),
    ...(competitor === undefined ? {} : { competitor }),
  }),
);

export function resolvePublicRoute(pathname: string): PublicRoute {
  return (
    publicRoutes.find((route) => route.path === pathname) ?? {
      path: pathname,
      title: 'Page not found',
      description: 'This route is not part of the Astra Code public surface.',
      status: 404,
    }
  );
}

export interface PublicPlanCard {
  id: string;
  displayName: string;
  currency: 'INR' | 'USD';
  price: string;
  monthlyCredits: string;
  seats: number;
  activeJobsPerSeat: number;
  pooledCredits: boolean;
  topUpEnabled: boolean;
  source: 'server' | 'unavailable';
}

export interface PublicCreditPack {
  id: string;
  credits: string;
  validityDays: number;
  price: {
    currency: 'INR' | 'USD';
    amount: string;
    taxIncluded: boolean;
  };
}

export const noLivePlanData = 'NO_LIVE_DATA';
