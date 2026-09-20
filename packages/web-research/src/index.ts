import { createHash, randomUUID } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface WebSearchRequest {
  query: string;
  maxResults?: number;
  recency?: string;
  domains?: string[];
  excludeDomains?: string[];
  safeSearch?: boolean;
}

export const ASTRA_WEB_SEARCH_TOOL = 'web_search' as const;
export const ASTRA_WEB_FETCH_TOOL = 'web_fetch' as const;

export type AstraWebToolRequest =
  | { name: typeof ASTRA_WEB_SEARCH_TOOL; input: WebSearchRequest }
  | { name: typeof ASTRA_WEB_FETCH_TOOL; input: WebFetchRequest };

export type AstraWebToolResult = WebSearchResponse | WebFetchResponse;

export interface WebFetchRequest {
  url: string;
  purpose?: string;
  maxBytes?: number;
}

export interface ProviderSearchResult {
  id?: string;
  title: string;
  url: string;
  snippet?: string;
  publishedAt?: string;
}

export interface ProviderSearchResponse {
  results: ProviderSearchResult[];
  externalCostUsd?: string | null;
}

export interface WebSearchProvider {
  readonly id: string;
  search(request: WebSearchRequest, signal: AbortSignal): Promise<ProviderSearchResponse>;
}

export interface WebSearchResult {
  id: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  publishedAt?: string;
  retrievedAt: string;
}

export interface WebSourceProvenance {
  sourceId: string;
  query?: string;
  url: string;
  domain: string;
  title?: string;
  retrievedAt: string;
  publishedAt?: string;
  contentHash?: string;
  provider: string;
}

export interface WebUsageSnapshot {
  searchesUsed: number;
  pagesFetched: number;
  bytesFetched: number;
  limits: {
    maxSearches: number;
    maxPages: number;
    maxBytes: number;
    maxFetchBytes: number;
  };
}

export interface WebSearchResponse {
  query: string;
  results: WebSearchResult[];
  sources: WebSourceProvenance[];
  provider: string;
  retrievedAt: string;
  usage: WebUsageSnapshot;
  externalCostUsd: string | null;
}

export interface WebFetchResponse {
  url: string;
  finalUrl: string;
  title?: string;
  content: string;
  contentType: string;
  retrievedAt: string;
  contentHash: string;
  untrusted: true;
  warnings: string[];
  source: WebSourceProvenance;
  usage: WebUsageSnapshot;
}

export type WebBillingContext =
  | { kind: 'personal'; userId: string }
  | {
      kind: 'organization';
      organizationId: string;
      roomId: string;
      actorUserId: string;
    };

export interface WebResearchContext {
  taskId: string;
  actorUserId: string;
  billingContext: WebBillingContext;
  roomId?: string;
  hostDeviceId?: string;
  assertAuthorized?: (action: 'search' | 'fetch') => Promise<void>;
}

export interface WebResearchPolicy {
  maxSearches: number;
  maxPages: number;
  maxBytes: number;
  maxFetchBytes: number;
  maxResearchTimeMs: number;
  maxSimilarQueries: number;
  maxRedirects: number;
}

export type WebResearchEvent =
  | { type: 'web.search.started'; taskId: string; query: string }
  | {
      type: 'web.search.completed';
      taskId: string;
      query: string;
      resultCount: number;
      provider: string;
    }
  | { type: 'web.fetch.started'; taskId: string; url: string }
  | {
      type: 'web.fetch.completed';
      taskId: string;
      url: string;
      finalUrl: string;
      bytes: number;
    }
  | { type: 'web.fetch.blocked'; taskId: string; url: string; code: string }
  | { type: 'web.budget.warning'; taskId: string; resource: 'searches' | 'pages' | 'bytes' };

export interface WebResearchUsageRecord {
  id: string;
  taskId: string;
  actorUserId: string;
  action: 'search' | 'fetch';
  provider: string;
  billingContext: WebBillingContext;
  roomId?: string;
  organizationId?: string;
  query?: string;
  url?: string;
  resultCount?: number;
  bytesFetched: number;
  externalCostUsd: string | null;
  createdAt: string;
}

export interface WebResearchUsageStore {
  record(record: WebResearchUsageRecord): void | Promise<void>;
  listByTask(taskId: string): WebResearchUsageRecord[] | Promise<WebResearchUsageRecord[]>;
}

export class InMemoryWebResearchUsageStore implements WebResearchUsageStore {
  private readonly records: WebResearchUsageRecord[] = [];

  record(record: WebResearchUsageRecord): void {
    this.records.push({
      ...record,
      billingContext: { ...record.billingContext },
    });
  }

  listByTask(taskId: string): WebResearchUsageRecord[] {
    return this.records
      .filter((record) => record.taskId === taskId)
      .map((record) => ({ ...record, billingContext: { ...record.billingContext } }));
  }
}

export type WebResearchErrorCode =
  | 'WEB_SEARCH_UNAVAILABLE'
  | 'WEB_PROVIDER_FAILED'
  | 'WEB_FETCH_FAILED'
  | 'WEB_FETCH_BLOCKED'
  | 'WEB_FETCH_TOO_LARGE'
  | 'WEB_UNSUPPORTED_CONTENT'
  | 'WEB_REDIRECT_LIMIT'
  | 'WEB_BUDGET_EXHAUSTED'
  | 'WEB_INVALID_REQUEST'
  | 'WEB_CANCELLED'
  | 'WEB_ACCESS_REVOKED'
  | 'BILLING_CONTEXT_MISMATCH';

export class WebResearchError extends Error {
  constructor(
    public readonly code: WebResearchErrorCode,
    message: string,
    public readonly details?: Record<string, string | number | boolean>,
  ) {
    super(message);
    this.name = 'WebResearchError';
  }
}

const DEFAULT_POLICY: WebResearchPolicy = {
  maxSearches: 10,
  maxPages: 5,
  maxBytes: 2_000_000,
  maxFetchBytes: 512_000,
  maxResearchTimeMs: 60_000,
  maxSimilarQueries: 3,
  maxRedirects: 3,
};

const PUBLIC_CONTENT_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'text/plain',
  'application/json',
  'application/xml',
  'text/xml',
]);

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'instance-data.ec2.internal',
  'host.docker.internal',
]);

const DEFAULT_FETCH_HEADERS = {
  accept: 'text/html,application/xhtml+xml,text/plain,application/json,application/xml;q=0.9',
  'user-agent': 'AstraAI-WebResearch/0.1',
};

export type WebFetchImplementation = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type WebDnsLookup = (hostname: string) => Promise<string[]>;

interface TaskBudgetState {
  contextKey: string;
  startedAt: number;
  searchesUsed: number;
  pagesFetched: number;
  bytesFetched: number;
  queryCounts: Map<string, number>;
}

export interface WebResearchServiceOptions {
  provider: WebSearchProvider;
  policy?: Partial<WebResearchPolicy>;
  fetchImpl?: WebFetchImplementation;
  dnsLookup?: WebDnsLookup;
  usageStore?: WebResearchUsageStore;
  onEvent?: (event: WebResearchEvent) => void;
  now?: () => Date;
}

export class UnavailableWebSearchProvider implements WebSearchProvider {
  readonly id = 'unavailable';

  async search(_request: WebSearchRequest, _signal: AbortSignal): Promise<ProviderSearchResponse> {
    throw new WebResearchError(
      'WEB_SEARCH_UNAVAILABLE',
      'No live Astra web search provider is configured',
    );
  }
}

/**
 * Small server-only adapter for providers that expose a JSON search endpoint.
 * The API key is accepted only by the server-side constructor and never enters
 * a normalized result, runtime config, or renderer-facing response.
 */
export class HttpWebSearchProvider implements WebSearchProvider {
  readonly id: string;
  private readonly fetchImpl: WebFetchImplementation;

  constructor(
    private readonly options: {
      id: string;
      endpoint: string;
      apiKey: string;
      fetchImpl?: WebFetchImplementation;
    },
  ) {
    this.id = options.id;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  async search(request: WebSearchRequest, signal: AbortSignal): Promise<ProviderSearchResponse> {
    if (!this.options.apiKey)
      throw new WebResearchError(
        'WEB_SEARCH_UNAVAILABLE',
        'Search provider credentials are missing',
      );
    const endpoint = new URL(this.options.endpoint);
    endpoint.searchParams.set('q', request.query);
    endpoint.searchParams.set('count', String(clampInteger(request.maxResults ?? 10, 1, 50)));
    if (request.recency) endpoint.searchParams.set('recency', request.recency);
    if (request.domains?.length) endpoint.searchParams.set('domains', request.domains.join(','));
    if (request.excludeDomains?.length)
      endpoint.searchParams.set('exclude_domains', request.excludeDomains.join(','));
    if (request.safeSearch !== undefined)
      endpoint.searchParams.set('safe_search', request.safeSearch ? 'true' : 'false');

    let response: Response;
    try {
      response = await this.fetchImpl(endpoint, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${this.options.apiKey}`,
        },
        signal,
      });
    } catch (error) {
      throw new WebResearchError(
        'WEB_PROVIDER_FAILED',
        error instanceof Error ? error.message : 'Search provider request failed',
      );
    }
    if (!response.ok)
      throw new WebResearchError(
        'WEB_PROVIDER_FAILED',
        `Search provider returned ${response.status}`,
      );

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new WebResearchError('WEB_PROVIDER_FAILED', 'Search provider returned invalid JSON');
    }
    const records = extractProviderResults(payload);
    return { results: records };
  }
}

export class WebResearchService {
  private readonly policy: WebResearchPolicy;
  private readonly fetchImpl: WebFetchImplementation;
  private readonly dnsLookup: WebDnsLookup;
  private readonly usageStore: WebResearchUsageStore;
  private readonly onEvent: ((event: WebResearchEvent) => void) | undefined;
  private readonly now: () => Date;
  private readonly tasks = new Map<string, TaskBudgetState>();

  constructor(private readonly options: WebResearchServiceOptions) {
    this.policy = { ...DEFAULT_POLICY, ...options.policy };
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.dnsLookup =
      options.dnsLookup ??
      (async (hostname) => {
        const addresses = await dnsLookup(hostname, { all: true });
        return addresses.map((address) => address.address);
      });
    this.usageStore = options.usageStore ?? new InMemoryWebResearchUsageStore();
    this.onEvent = options.onEvent;
    this.now = options.now ?? (() => new Date());
    validatePolicy(this.policy);
  }

  async search(
    request: WebSearchRequest,
    context: WebResearchContext,
    signal = new AbortController().signal,
  ): Promise<WebSearchResponse> {
    await context.assertAuthorized?.('search');
    throwIfAborted(signal);
    const query = normalizeQuery(request.query);
    const maxResults = clampInteger(request.maxResults ?? 10, 1, 50);
    const task = this.prepareTask(context);
    this.consumeBudget(task, 'search', query);
    this.emit({ type: 'web.search.started', taskId: context.taskId, query });
    try {
      const response = await this.options.provider.search(
        { ...request, query, maxResults },
        signal,
      );
      await context.assertAuthorized?.('search');
      throwIfAborted(signal);
      const retrievedAt = this.now().toISOString();
      const results = response.results
        .map((result) => normalizeResult(result, retrievedAt))
        .filter((result): result is WebSearchResult => result !== null)
        .slice(0, maxResults);
      const sources = results.map((result) =>
        sourceFromResult(result, query, this.options.provider.id),
      );
      await this.usageStore.record({
        id: randomUUID(),
        taskId: context.taskId,
        actorUserId: context.actorUserId,
        action: 'search',
        provider: this.options.provider.id,
        billingContext: cloneBillingContext(context.billingContext),
        ...(context.roomId ? { roomId: context.roomId } : {}),
        ...(context.billingContext.kind === 'organization'
          ? { organizationId: context.billingContext.organizationId }
          : {}),
        query,
        resultCount: results.length,
        bytesFetched: 0,
        externalCostUsd: response.externalCostUsd ?? null,
        createdAt: retrievedAt,
      });
      this.emit({
        type: 'web.search.completed',
        taskId: context.taskId,
        query,
        resultCount: results.length,
        provider: this.options.provider.id,
      });
      this.emitBudgetWarningIfNeeded(task, context.taskId);
      return {
        query,
        results,
        sources,
        provider: this.options.provider.id,
        retrievedAt,
        usage: this.snapshot(task),
        externalCostUsd: response.externalCostUsd ?? null,
      };
    } catch (error) {
      if (error instanceof WebResearchError) throw error;
      if (signal.aborted) throw abortError();
      throw new WebResearchError(
        'WEB_SEARCH_UNAVAILABLE',
        error instanceof Error ? error.message : 'Search provider is unavailable',
      );
    }
  }

  executeTool(
    request: AstraWebToolRequest,
    context: WebResearchContext,
    signal = new AbortController().signal,
  ): Promise<AstraWebToolResult> {
    if (request.name === ASTRA_WEB_SEARCH_TOOL) return this.search(request.input, context, signal);
    return this.fetch(request.input, context, signal);
  }

  async fetch(
    request: WebFetchRequest,
    context: WebResearchContext,
    signal = new AbortController().signal,
  ): Promise<WebFetchResponse> {
    await context.assertAuthorized?.('fetch');
    throwIfAborted(signal);
    const task = this.prepareTask(context);
    this.consumeBudget(task, 'fetch');
    const maxBytes = clampInteger(
      request.maxBytes ?? this.policy.maxFetchBytes,
      1,
      this.policy.maxFetchBytes,
    );
    let currentUrl = request.url;
    this.emit({ type: 'web.fetch.started', taskId: context.taskId, url: currentUrl });
    try {
      let response: Response | undefined;
      let redirects = 0;
      while (true) {
        const url = await this.assertPublicTarget(currentUrl);
        if (signal.aborted) throw abortError();
        response = await this.fetchImpl(url.toString(), {
          method: 'GET',
          headers: DEFAULT_FETCH_HEADERS,
          redirect: 'manual',
          signal,
        });
        if (response.status < 300 || response.status >= 400) break;
        const location = response.headers.get('location');
        if (!location) throw new WebResearchError('WEB_FETCH_FAILED', 'Redirect has no location');
        redirects += 1;
        if (redirects > this.policy.maxRedirects)
          throw new WebResearchError('WEB_REDIRECT_LIMIT', 'Web fetch redirect limit exceeded');
        currentUrl = new URL(location, url).toString();
      }

      if (!response || !response.ok)
        throw new WebResearchError(
          'WEB_FETCH_FAILED',
          `Web page returned ${response?.status ?? 'no response'}`,
        );
      const contentType = normalizeContentType(response.headers.get('content-type'));
      if (!PUBLIC_CONTENT_TYPES.has(contentType))
        throw new WebResearchError(
          'WEB_UNSUPPORTED_CONTENT',
          `Web content type ${contentType || 'unknown'} is not supported`,
        );
      const declaredLength = Number(response.headers.get('content-length') ?? '');
      if (Number.isFinite(declaredLength) && declaredLength > maxBytes)
        throw new WebResearchError('WEB_FETCH_TOO_LARGE', 'Web page exceeds the fetch byte limit');
      const body = await readResponseBytes(response, maxBytes, signal);
      if (task.bytesFetched + body.byteLength > this.policy.maxBytes)
        throw new WebResearchError('WEB_BUDGET_EXHAUSTED', 'Web research byte budget exhausted');
      task.bytesFetched += body.byteLength;
      await context.assertAuthorized?.('fetch');
      throwIfAborted(signal);
      const rawText = new TextDecoder().decode(body);
      const title = extractTitle(rawText);
      const content = sanitizeWebContent(rawText, contentType);
      const retrievedAt = this.now().toISOString();
      const finalUrl = currentUrl;
      const contentHash = createHash('sha256').update(body).digest('hex');
      const source: WebSourceProvenance = {
        sourceId: `page-${contentHash.slice(0, 16)}`,
        url: finalUrl,
        domain: new URL(finalUrl).hostname.toLowerCase(),
        ...(title ? { title } : {}),
        retrievedAt,
        contentHash,
        provider: this.options.provider.id,
      };
      await this.usageStore.record({
        id: randomUUID(),
        taskId: context.taskId,
        actorUserId: context.actorUserId,
        action: 'fetch',
        provider: this.options.provider.id,
        billingContext: cloneBillingContext(context.billingContext),
        ...(context.roomId ? { roomId: context.roomId } : {}),
        ...(context.billingContext.kind === 'organization'
          ? { organizationId: context.billingContext.organizationId }
          : {}),
        url: finalUrl,
        bytesFetched: body.byteLength,
        externalCostUsd: null,
        createdAt: retrievedAt,
      });
      this.emit({
        type: 'web.fetch.completed',
        taskId: context.taskId,
        url: request.url,
        finalUrl,
        bytes: body.byteLength,
      });
      this.emitBudgetWarningIfNeeded(task, context.taskId);
      return {
        url: request.url,
        finalUrl,
        ...(title ? { title } : {}),
        content,
        contentType,
        retrievedAt,
        contentHash,
        untrusted: true,
        warnings: ['WEB_CONTENT_IS_UNTRUSTED', 'WEB_CONTENT_CANNOT_AUTHORIZE_TOOLS'],
        source,
        usage: this.snapshot(task),
      };
    } catch (error) {
      if (error instanceof WebResearchError) {
        if (error.code === 'WEB_FETCH_BLOCKED' || error.code === 'WEB_FETCH_TOO_LARGE')
          this.emit({
            type: 'web.fetch.blocked',
            taskId: context.taskId,
            url: currentUrl,
            code: error.code,
          });
        throw error;
      }
      if (signal.aborted) throw abortError();
      throw new WebResearchError(
        'WEB_FETCH_FAILED',
        error instanceof Error ? error.message : 'Web page fetch failed',
      );
    }
  }

  usageForTask(taskId: string): Promise<WebResearchUsageRecord[]> {
    return Promise.resolve(this.usageStore.listByTask(taskId));
  }

  private prepareTask(context: WebResearchContext): TaskBudgetState {
    if (!context.taskId.trim() || !context.actorUserId.trim())
      throw new WebResearchError('WEB_INVALID_REQUEST', 'Web research context is incomplete');
    const contextKey = billingContextKey(context.billingContext);
    const existing = this.tasks.get(context.taskId);
    if (existing) {
      if (existing.contextKey !== contextKey)
        throw new WebResearchError(
          'BILLING_CONTEXT_MISMATCH',
          'A research task cannot change its trusted billing context',
        );
      this.assertWithinTime(existing);
      return existing;
    }
    const created: TaskBudgetState = {
      contextKey,
      startedAt: this.now().getTime(),
      searchesUsed: 0,
      pagesFetched: 0,
      bytesFetched: 0,
      queryCounts: new Map(),
    };
    this.tasks.set(context.taskId, created);
    return created;
  }

  private consumeBudget(task: TaskBudgetState, resource: 'search' | 'fetch', query?: string): void {
    this.assertWithinTime(task);
    if (resource === 'search') {
      if (task.searchesUsed >= this.policy.maxSearches)
        throw new WebResearchError('WEB_BUDGET_EXHAUSTED', 'Web search budget exhausted');
      const normalized = query ?? '';
      const count = task.queryCounts.get(normalized) ?? 0;
      if (count >= this.policy.maxSimilarQueries)
        throw new WebResearchError('WEB_BUDGET_EXHAUSTED', 'Repeated web search budget exhausted');
      task.queryCounts.set(normalized, count + 1);
      task.searchesUsed += 1;
      return;
    }
    if (task.pagesFetched >= this.policy.maxPages)
      throw new WebResearchError('WEB_BUDGET_EXHAUSTED', 'Web fetch page budget exhausted');
    task.pagesFetched += 1;
  }

  private assertWithinTime(task: TaskBudgetState): void {
    if (this.now().getTime() - task.startedAt > this.policy.maxResearchTimeMs)
      throw new WebResearchError('WEB_BUDGET_EXHAUSTED', 'Web research time budget exhausted');
  }

  private async assertPublicTarget(rawUrl: string): Promise<URL> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new WebResearchError('WEB_FETCH_BLOCKED', 'Web URL is invalid');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      throw new WebResearchError('WEB_FETCH_BLOCKED', 'Only public HTTP(S) pages may be fetched');
    if (url.username || url.password)
      throw new WebResearchError('WEB_FETCH_BLOCKED', 'Credentialed URLs are not allowed');
    const hostname = normalizeHostname(url.hostname);
    if (isBlockedHostname(hostname) || isPrivateIp(hostname))
      throw new WebResearchError(
        'WEB_FETCH_BLOCKED',
        'Private or internal web targets are blocked',
      );
    if (isIP(hostname) === 0) {
      let addresses: string[];
      try {
        addresses = await this.dnsLookup(hostname);
      } catch {
        throw new WebResearchError('WEB_FETCH_BLOCKED', 'Web target DNS resolution failed closed');
      }
      if (
        addresses.length === 0 ||
        addresses.some((address) => isPrivateIp(normalizeHostname(address)))
      )
        throw new WebResearchError(
          'WEB_FETCH_BLOCKED',
          'Web target resolves to a private or internal address',
        );
    }
    return url;
  }

  private snapshot(task: TaskBudgetState): WebUsageSnapshot {
    return {
      searchesUsed: task.searchesUsed,
      pagesFetched: task.pagesFetched,
      bytesFetched: task.bytesFetched,
      limits: {
        maxSearches: this.policy.maxSearches,
        maxPages: this.policy.maxPages,
        maxBytes: this.policy.maxBytes,
        maxFetchBytes: this.policy.maxFetchBytes,
      },
    };
  }

  private emit(event: WebResearchEvent): void {
    this.onEvent?.(event);
  }

  private emitBudgetWarningIfNeeded(task: TaskBudgetState, taskId: string): void {
    if (task.searchesUsed / this.policy.maxSearches >= 0.8)
      this.emit({ type: 'web.budget.warning', taskId, resource: 'searches' });
    if (task.pagesFetched / this.policy.maxPages >= 0.8)
      this.emit({ type: 'web.budget.warning', taskId, resource: 'pages' });
    if (task.bytesFetched / this.policy.maxBytes >= 0.8)
      this.emit({ type: 'web.budget.warning', taskId, resource: 'bytes' });
  }
}

function validatePolicy(policy: WebResearchPolicy): void {
  const values = [
    policy.maxSearches,
    policy.maxPages,
    policy.maxBytes,
    policy.maxFetchBytes,
    policy.maxResearchTimeMs,
    policy.maxSimilarQueries,
    policy.maxRedirects,
  ];
  if (values.some((value) => !Number.isInteger(value) || value <= 0))
    throw new WebResearchError(
      'WEB_INVALID_REQUEST',
      'Web research policy limits must be positive integers',
    );
  if (policy.maxFetchBytes > policy.maxBytes)
    throw new WebResearchError(
      'WEB_INVALID_REQUEST',
      'Fetch byte limit cannot exceed research byte limit',
    );
}

function normalizeQuery(query: string): string {
  const normalized = query.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > 500)
    throw new WebResearchError(
      'WEB_INVALID_REQUEST',
      'Web search query must contain 1-500 characters',
    );
  return normalized;
}

function normalizeResult(
  result: ProviderSearchResult,
  retrievedAt: string,
): WebSearchResult | null {
  let url: URL;
  try {
    url = new URL(result.url);
  } catch {
    return null;
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password)
    return null;
  const domain = normalizeHostname(url.hostname);
  if (isBlockedHostname(domain) || isPrivateIp(domain)) return null;
  const title = sanitizeInlineText(result.title);
  const snippet = sanitizeInlineText(result.snippet ?? '');
  if (!title || !url.hostname) return null;
  const publishedAt = normalizeDate(result.publishedAt);
  return {
    id: result.id?.trim() || createHash('sha256').update(url.toString()).digest('hex').slice(0, 24),
    title,
    url: url.toString(),
    domain,
    snippet,
    ...(publishedAt ? { publishedAt } : {}),
    retrievedAt,
  };
}

function sourceFromResult(
  result: WebSearchResult,
  query: string,
  provider: string,
): WebSourceProvenance {
  return {
    sourceId: result.id,
    query,
    url: result.url,
    domain: result.domain,
    title: result.title,
    retrievedAt: result.retrievedAt,
    ...(result.publishedAt ? { publishedAt: result.publishedAt } : {}),
    provider,
  };
}

function extractProviderResults(payload: unknown): ProviderSearchResult[] {
  if (!payload || typeof payload !== 'object') return [];
  const candidate = payload as { results?: unknown; items?: unknown; web?: { results?: unknown } };
  const values = Array.isArray(candidate.results)
    ? candidate.results
    : Array.isArray(candidate.items)
      ? candidate.items
      : Array.isArray(candidate.web?.results)
        ? candidate.web.results
        : [];
  return values.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const item = value as Record<string, unknown>;
    if (typeof item.title !== 'string' || typeof item.url !== 'string') return [];
    return [
      {
        ...(typeof item.id === 'string' ? { id: item.id } : {}),
        title: item.title,
        url: item.url,
        ...(typeof item.snippet === 'string'
          ? { snippet: item.snippet }
          : typeof item.description === 'string'
            ? { snippet: item.description }
            : {}),
        ...(typeof item.publishedAt === 'string'
          ? { publishedAt: item.publishedAt }
          : typeof item.published_at === 'string'
            ? { publishedAt: item.published_at }
            : {}),
      },
    ];
  });
}

async function readResponseBytes(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (!response.body) {
    const text = await response.text();
    const bytes = new TextEncoder().encode(text);
    if (bytes.byteLength > maxBytes)
      throw new WebResearchError('WEB_FETCH_TOO_LARGE', 'Web page exceeds the fetch byte limit');
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw abortError();
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes)
        throw new WebResearchError('WEB_FETCH_TOO_LARGE', 'Web page exceeds the fetch byte limit');
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function sanitizeWebContent(value: string, contentType: string): string {
  if (contentType === 'text/html' || contentType === 'application/xhtml+xml') {
    return decodeHtmlEntities(
      value
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    );
  }
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim();
}

function extractTitle(value: string): string | undefined {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(value);
  const title = match?.[1] ? sanitizeInlineText(decodeHtmlEntities(match[1])) : '';
  return title || undefined;
}

function sanitizeInlineText(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function normalizeContentType(value: string | null): string {
  return value?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

function normalizeHostname(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
}

function isBlockedHostname(hostname: string): boolean {
  return (
    BLOCKED_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.intranet')
  );
}

function isPrivateIp(value: string): boolean {
  const hostname = normalizeHostname(value);
  if (isIP(hostname) === 4) {
    const octets = hostname.split('.').map(Number);
    const [first, second] = octets;
    if (first === undefined || second === undefined) return true;
    return (
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 0) ||
      (first === 192 && second === 168) ||
      (first === 198 && (second === 18 || second === 19)) ||
      (first === 198 && second === 51) ||
      (first === 203 && second === 0) ||
      first >= 224
    );
  }
  if (isIP(hostname) === 6) {
    const ipv6 = hostname.split('%', 1)[0] ?? hostname;
    if (ipv6 === '::' || ipv6 === '::1') return true;
    if (/^f[cd]/i.test(ipv6) || /^fe[89ab]/i.test(ipv6)) return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ipv6);
    return mapped ? isPrivateIp(mapped[1] ?? '') : false;
  }
  return false;
}

function billingContextKey(context: WebBillingContext): string {
  return context.kind === 'personal'
    ? `personal:${context.userId}`
    : `organization:${context.organizationId}:${context.roomId}:${context.actorUserId}`;
}

function cloneBillingContext(context: WebBillingContext): WebBillingContext {
  return context.kind === 'personal'
    ? { kind: 'personal', userId: context.userId }
    : {
        kind: 'organization',
        organizationId: context.organizationId,
        roomId: context.roomId,
        actorUserId: context.actorUserId,
      };
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function abortError(): Error {
  return new WebResearchError('WEB_CANCELLED', 'Web research request was cancelled');
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}
