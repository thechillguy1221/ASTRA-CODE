export interface CompetitorFact {
  slug: string;
  name: string;
  published: boolean;
  verifiedAt: string;
  sourceUrls: string[];
  pricing: string;
  workflow: string;
  modelAccess: string;
  apiKey: string;
  platforms: string;
  mcp: string;
  fit: string;
  caveat: string;
}

// Sources were checked on 2026-09-20. A route with published=false remains a safe placeholder;
// it is intentionally excluded from public comparison claims until a current official source exists.
export const competitorFacts: Record<string, CompetitorFact> = {
  cursor: {
    slug: 'cursor',
    name: 'Cursor',
    published: true,
    verifiedAt: '2026-09-20',
    sourceUrls: ['https://cursor.com/pricing', 'https://cursor.com/docs'],
    pricing:
      'Cursor publishes individual subscription tiers and usage-based model economics; current official pricing lists Hobby, Pro, Pro+, and Ultra.',
    workflow:
      'A desktop AI editor and coding-agent workflow with codebase understanding, planning, debugging, review, MCP, skills, and cloud-agent surfaces documented by Cursor.',
    modelAccess:
      'Cursor documents first-party and third-party model choices plus Auto/model routing.',
    apiKey:
      'The official pricing/docs pages describe managed Cursor usage; this comparison does not infer a blanket API-key requirement.',
    platforms:
      'Cursor documents downloads and a desktop/editor workflow; exact platform coverage should be checked against its current download page.',
    mcp: 'MCP is listed in Cursor documentation and plan information.',
    fit: 'A strong fit for developers who want a mature AI editor with broad model and cloud-agent features.',
    caveat:
      'Usage economics vary by model and mode, so plan price alone is not a direct cost comparison.',
  },
  kiro: {
    slug: 'kiro',
    name: 'Kiro',
    published: true,
    verifiedAt: '2026-09-20',
    sourceUrls: ['https://kiro.dev/faq/', 'https://kiro.dev/docs/models/'],
    pricing:
      'Kiro documents a free tier with 50 credits and paid Pro, Pro+, Pro Max, and Power tiers priced in USD.',
    workflow:
      'Kiro documents IDE, CLI, web, mobile, and Crew surfaces with agentic development workflows.',
    modelAccess:
      'Kiro documents Auto plus selectable OpenAI, Anthropic, and open-weight model options.',
    apiKey:
      'Kiro’s documented sign-in and subscription flow does not make user-managed provider keys the core onboarding path.',
    platforms: 'Kiro documents IDE, CLI, web, mobile, and supported installer flows.',
    mcp: 'This page does not claim MCP support without a directly cited current Kiro source.',
    fit: 'A strong fit for users who want a broader multi-surface agent product with a Kiro credit model.',
    caveat: 'Kiro credit rules, model multipliers, and availability can vary by region and plan.',
  },
  'kilo-code': {
    slug: 'kilo-code',
    name: 'Kilo Code',
    published: true,
    verifiedAt: '2026-09-20',
    sourceUrls: ['https://kilo.ai/pricing', 'https://kilo.ai/docs'],
    pricing:
      'Kilo documents a free individual platform plan, a $15/user/month Teams plan, and separate inference choices such as BYOK, Kilo Gateway, and Kilo Pass.',
    workflow:
      'Kilo documents VS Code, JetBrains, CLI, agentic coding, cloud features, collaboration, and automation.',
    modelAccess:
      'Kilo documents free/local models, BYOK, Kilo Gateway, Kilo Pass, and Auto Model routing.',
    apiKey:
      'BYOK is an explicit Kilo option; managed gateway and subscription options are also documented.',
    platforms: 'Kilo documents VS Code, JetBrains, CLI, and cloud surfaces.',
    mcp: 'Kilo documentation lists MCP and integrations under automation.',
    fit: 'A strong fit for developers who value open-source tooling, BYOK, and separate platform/inference choices.',
    caveat:
      'Kilo separates platform access, inference, and cloud compute, so comparing one monthly number is misleading.',
  },
  cline: {
    slug: 'cline',
    name: 'Cline',
    published: true,
    verifiedAt: '2026-09-20',
    sourceUrls: ['https://cline.bot/pricing', 'https://cline.bot/'],
    pricing:
      'Cline documents a free open-source individual product and usage-based AI inference rather than an individual subscription.',
    workflow:
      'Cline documents VS Code, CLI, SDK, MCP, multi-root workspaces, and a secure client-side architecture.',
    modelAccess:
      'Cline documents provider flexibility including BYOK and its own provider options.',
    apiKey:
      'Cline explicitly supports bringing provider API keys; its provider configuration is a central part of the product.',
    platforms:
      'Cline documents desktop/editor and CLI surfaces; this comparison avoids asserting unsupported operating-system details.',
    mcp: 'MCP is explicitly listed in Cline’s product and pricing information.',
    fit: 'A strong fit for developers who want an open-source, provider-flexible coding agent.',
    caveat: 'Provider billing and setup remain the user’s responsibility for BYOK workflows.',
  },
  'github-copilot': {
    slug: 'github-copilot',
    name: 'GitHub Copilot',
    published: true,
    verifiedAt: '2026-09-20',
    sourceUrls: [
      'https://github.com/features/copilot/plans',
      'https://docs.github.com/en/copilot/get-started/plans',
    ],
    pricing:
      'GitHub documents Free, Pro, Pro+, Max, Business, and Enterprise offerings with AI-credit allowances that vary by plan.',
    workflow:
      'GitHub documents IDE, CLI, GitHub, mobile, agent mode, cloud agents, code review, and third-party agent surfaces.',
    modelAccess:
      'GitHub’s official plans page lists model selection and plan-dependent model access.',
    apiKey:
      'Copilot is primarily a GitHub-account product; this page does not imply that users configure provider API keys.',
    platforms: 'GitHub documents a broad editor, CLI, GitHub, and mobile ecosystem.',
    mcp: 'GitHub’s plans page lists MCP integration for supported plans.',
    fit: 'A strong fit for developers deeply invested in GitHub’s repository, pull-request, and cloud workflow.',
    caveat:
      'GitHub AI Credits are a different accounting unit from Astra credits and should not be compared one-for-one.',
  },
  windsurf: {
    slug: 'windsurf',
    name: 'Windsurf',
    published: false,
    verifiedAt: '2026-09-20',
    sourceUrls: ['https://windsurf.com/pricing'],
    pricing:
      'The official URL currently redirects to Devin pricing; a current Windsurf-specific source was not established.',
    workflow: 'Not published until a current official Windsurf product page is verified.',
    modelAccess: 'UNAVAILABLE',
    apiKey: 'UNAVAILABLE',
    platforms: 'UNAVAILABLE',
    mcp: 'UNAVAILABLE',
    fit: 'UNAVAILABLE',
    caveat: 'Comparison intentionally withheld to avoid stale or misattributed product claims.',
  },
  'roo-code': {
    slug: 'roo-code',
    name: 'Roo Code',
    published: false,
    verifiedAt: '2026-09-20',
    sourceUrls: ['https://roocode.com/pricing'],
    pricing:
      'The former official URL currently redirects to Roomote; a current Roo Code-specific source was not established.',
    workflow: 'Not published until a current official Roo Code product page is verified.',
    modelAccess: 'UNAVAILABLE',
    apiKey: 'UNAVAILABLE',
    platforms: 'UNAVAILABLE',
    mcp: 'UNAVAILABLE',
    fit: 'UNAVAILABLE',
    caveat: 'Comparison intentionally withheld to avoid stale or misattributed product claims.',
  },
};

export function getCompetitor(slug: string): CompetitorFact | undefined {
  return competitorFacts[slug];
}
