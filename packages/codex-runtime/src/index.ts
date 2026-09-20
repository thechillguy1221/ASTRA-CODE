import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

/** The immutable Codex source identity selected during Phase 0. */
export const PINNED_CODEX_SOURCE_SHA = '5c5308fc9a9ee789049d646ef11e5400384b9c6f' as const;
export const PINNED_CODEX_RUNTIME_RELEASE_TAG = 'rust-v0.156.0-alpha.10' as const;
export const PINNED_CODEX_RUNTIME_SOURCE_SHA = '106bdc71ea78c8cf4e22d7c643c1564de630b3c9' as const;

/**
 * This is the adapter identity, not a claim that a Codex artifact is present.
 * The build step replaces the pending value with a fingerprint generated from
 * the pinned app-server protocol sources before packaging.
 */
export const CODEX_ADAPTER_VERSION = 'astra-codex-adapter-v1';

export const CODEX_PROTOCOL_FINGERPRINT =
  '1b94b320c014fa02eb89bc613d7beef36b1a400d164eeeaad8dd716d6da81435' as const;

const FORBIDDEN_PROVIDER_ENVIRONMENT_KEYS = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'OPENROUTER_API_KEY',
  'CLINE_API_KEY',
  'CODEX_API_KEY',
  'VERCEL_AI_GATEWAY_API_KEY',
];

export interface CodexRuntimeManifest {
  sourceSha: string;
  runtimeSourceSha?: string;
  releaseTag?: string;
  releaseAssetUrl?: string;
  protocolFingerprint: string;
  adapterVersion: string;
  version: string;
  artifactPath: string;
  artifactSha256: string;
  args: string[];
  artifact?: { path: string; sha256: string };
}

export interface CodexRuntimeSupervisorOptions {
  runtimeRoot: string;
  userDataPath: string;
  manifest: CodexRuntimeManifest;
  runtimeAuthToken?: string;
  runtimeApiBaseUrl?: string;
  runtimeQueryParams?: Readonly<Record<string, string>>;
  spawnProcess?: typeof spawn;
  environment?: NodeJS.ProcessEnv;
}

export interface CodexRuntimeEvent {
  [key: string]: unknown;
}

export type CodexRpcId = string | number;

export interface CodexServerRequest extends CodexRuntimeEvent {
  id: CodexRpcId;
  method: string;
  params?: unknown;
}

export interface CodexRuntimeSession {
  request(method: string, params?: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): void;
  respond(id: CodexRpcId, result: unknown): void;
  respondError(id: CodexRpcId, code: number, message: string, data?: unknown): void;
  onEvent(listener: (event: CodexRuntimeEvent) => void): () => void;
  stop(): Promise<void>;
}

export interface CodexInitializeResponse {
  userAgent: string;
  codexHome: string;
  platformFamily: string;
  platformOs: string;
}

export interface CodexThreadHandle {
  threadId: string;
  model: string;
  modelProvider: string;
}

export interface CodexTurnHandle {
  turnId: string;
}

export interface CodexDynamicToolFunction {
  type: 'function';
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  deferLoading?: boolean;
}

export interface CodexStartThreadOptions {
  cwd: string;
  runtimeWorkspaceRoots?: string[];
  model?: string;
  modelProvider?: string;
  approvalPolicy?: 'untrusted' | 'on-failure' | 'on-request' | 'never';
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  dynamicTools?: ReadonlyArray<CodexDynamicToolFunction>;
}

export const ASTRA_CODEX_DYNAMIC_TOOLS: ReadonlyArray<CodexDynamicToolFunction> = [
  {
    type: 'function',
    name: 'web_search',
    description: 'Search the public web through Astra and return normalized sources.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1 },
        max_results: { type: 'integer', minimum: 1, maximum: 10 },
        recency: { type: 'string' },
        domains: { type: 'array', items: { type: 'string' } },
        exclude_domains: { type: 'array', items: { type: 'string' } },
        safe_search: { type: 'boolean' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    deferLoading: false,
  },
  {
    type: 'function',
    name: 'web_fetch',
    description: 'Fetch one public web page through Astra and return sanitized content.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', minLength: 1 },
        purpose: { type: 'string' },
        max_bytes: { type: 'integer', minimum: 1 },
      },
      required: ['url'],
      additionalProperties: false,
    },
    deferLoading: false,
  },
];

export class CodexRuntimeError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'INVALID_MANIFEST'
      | 'MISSING_ARTIFACT'
      | 'ARTIFACT_IDENTITY_MISMATCH'
      | 'PROTOCOL_MISMATCH'
      | 'RUNTIME_NOT_STARTED'
      | 'RUNTIME_EXITED'
      | 'RUNTIME_PROTOCOL_ERROR',
  ) {
    super(message);
    this.name = 'CodexRuntimeError';
  }
}

function assertSha(value: string, field: string): void {
  if (!/^[0-9a-f]{40}$/i.test(value))
    throw new CodexRuntimeError(`${field} must be a 40-character SHA-1`, 'INVALID_MANIFEST');
}

function assertHash(value: string, field: string): void {
  if (!/^[0-9a-f]{64}$/i.test(value))
    throw new CodexRuntimeError(`${field} must be a 64-character SHA-256`, 'INVALID_MANIFEST');
}

export function validateCodexRuntimeManifest(value: unknown): CodexRuntimeManifest {
  if (!value || typeof value !== 'object')
    throw new CodexRuntimeError('Codex runtime manifest must be an object', 'INVALID_MANIFEST');
  const candidate = value as Partial<CodexRuntimeManifest>;
  if (
    typeof candidate.sourceSha !== 'string' ||
    typeof candidate.protocolFingerprint !== 'string' ||
    typeof candidate.adapterVersion !== 'string' ||
    typeof candidate.version !== 'string' ||
    typeof candidate.artifactPath !== 'string' ||
    typeof candidate.artifactSha256 !== 'string' ||
    !Array.isArray(candidate.args) ||
    candidate.args.some((arg) => typeof arg !== 'string')
  ) {
    throw new CodexRuntimeError('Codex runtime manifest fields are invalid', 'INVALID_MANIFEST');
  }
  assertSha(candidate.sourceSha, 'sourceSha');
  if (candidate.runtimeSourceSha !== undefined)
    assertSha(candidate.runtimeSourceSha, 'runtimeSourceSha');
  assertHash(candidate.artifactSha256, 'artifactSha256');
  if (!candidate.protocolFingerprint.trim())
    throw new CodexRuntimeError('protocolFingerprint is required', 'INVALID_MANIFEST');
  if (!candidate.adapterVersion.trim() || !candidate.version.trim())
    throw new CodexRuntimeError('adapterVersion and version are required', 'INVALID_MANIFEST');
  if (isAbsolute(candidate.artifactPath) || candidate.artifactPath.includes('..'))
    throw new CodexRuntimeError('artifactPath must be a relative bundled path', 'INVALID_MANIFEST');
  return {
    sourceSha: candidate.sourceSha.toLowerCase(),
    ...(candidate.runtimeSourceSha
      ? { runtimeSourceSha: candidate.runtimeSourceSha.toLowerCase() }
      : {}),
    ...(candidate.releaseTag ? { releaseTag: candidate.releaseTag } : {}),
    ...(candidate.releaseAssetUrl ? { releaseAssetUrl: candidate.releaseAssetUrl } : {}),
    protocolFingerprint: candidate.protocolFingerprint,
    adapterVersion: candidate.adapterVersion,
    version: candidate.version,
    artifactPath: candidate.artifactPath,
    artifactSha256: candidate.artifactSha256.toLowerCase(),
    args: [...candidate.args],
    ...(candidate.artifact ? { artifact: { ...candidate.artifact } } : {}),
  };
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

function assertWithinRoot(root: string, candidate: string): void {
  const relativePath = relative(root, candidate);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath))
    throw new CodexRuntimeError(
      'Codex artifact escapes the bundled runtime root',
      'INVALID_MANIFEST',
    );
}

function createIsolatedEnvironment(
  base: NodeJS.ProcessEnv,
  codexHome: string,
  runtimeAuthToken: string | undefined,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...base,
    CODEX_HOME: codexHome,
    ASTRA_CODEX_ADAPTER: CODEX_ADAPTER_VERSION,
  };
  for (const key of FORBIDDEN_PROVIDER_ENVIRONMENT_KEYS) delete environment[key];
  if (runtimeAuthToken) environment.ASTRA_RUNTIME_AUTH = runtimeAuthToken;
  else delete environment.ASTRA_RUNTIME_AUTH;
  return environment;
}

class ManagedCodexSession implements CodexRuntimeSession {
  private readonly listeners = new Set<(event: CodexRuntimeEvent) => void>();
  private readonly pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private readonly exitPromise: Promise<void>;
  private readonly closePromise: Promise<void>;
  private nextRequestId = 1;
  private stopped = false;

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    this.exitPromise = new Promise((resolveExit) => {
      child.once('exit', () => resolveExit());
    });
    this.closePromise = new Promise((resolveClose) => {
      child.once('close', () => resolveClose());
    });
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) this.consume(line);
    });
    child.on('error', (error) => this.failPending(error));
    child.on('exit', (code, signal) => {
      this.stopped = true;
      this.failPending(
        new CodexRuntimeError(
          `Codex runtime exited before completing requests (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
          'RUNTIME_EXITED',
        ),
      );
    });
  }

  request(method: string, params?: unknown): Promise<unknown> {
    if (this.stopped || !this.child.stdin.writable)
      return Promise.reject(
        new CodexRuntimeError('Codex runtime is not running', 'RUNTIME_EXITED'),
      );
    const id = this.nextRequestId++;
    // The pinned Codex app-server intentionally uses JSON-RPC-shaped messages
    // without the JSON-RPC 2.0 `jsonrpc` member. Keep this wire contract exact.
    const message = { id, method, ...(params === undefined ? {} : { params }) };
    return new Promise((resolvePromise, reject) => {
      this.pending.set(String(id), { resolve: resolvePromise, reject });
      this.child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (!error) return;
        this.pending.delete(String(id));
        reject(error);
      });
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.stopped || !this.child.stdin.writable) return;
    const message = { method, ...(params === undefined ? {} : { params }) };
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  respond(id: CodexRpcId, result: unknown): void {
    if (this.stopped || !this.child.stdin.writable) return;
    this.child.stdin.write(`${JSON.stringify({ id, result })}\n`);
  }

  respondError(id: CodexRpcId, code: number, message: string, data?: unknown): void {
    if (this.stopped || !this.child.stdin.writable) return;
    this.child.stdin.write(
      `${JSON.stringify({ id, error: { code, message, ...(data === undefined ? {} : { data }) } })}\n`,
    );
  }

  onEvent(listener: (event: CodexRuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async stop(): Promise<void> {
    if (!this.stopped) {
      this.stopped = true;
      this.failPending(new CodexRuntimeError('Codex runtime stopped', 'RUNTIME_EXITED'));
      this.child.kill();
    }
    await this.exitPromise;
    await this.closePromise;
  }

  private consume(line: string): void {
    if (!line.trim()) return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      this.failPending(
        new CodexRuntimeError(
          'Codex runtime emitted invalid JSON-RPC data',
          'RUNTIME_PROTOCOL_ERROR',
        ),
      );
      return;
    }
    if (!value || typeof value !== 'object') return;
    const message = value as Record<string, unknown>;
    const id =
      typeof message.id === 'string' || typeof message.id === 'number' ? String(message.id) : null;
    if (id && this.pending.has(id)) {
      const pending = this.pending.get(id);
      this.pending.delete(id);
      if ('error' in message && message.error) pending?.reject(new Error(String(message.error)));
      else pending?.resolve(message.result);
      return;
    }
    this.listeners.forEach((listener) => listener(message));
  }

  private failPending(error: Error): void {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CodexRuntimeError(`Codex ${name} response is malformed`, 'RUNTIME_PROTOCOL_ERROR');
  return value as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, field: string, name: string): string {
  const result = value[field];
  if (typeof result !== 'string' || !result)
    throw new CodexRuntimeError(
      `Codex ${name} response is missing ${field}`,
      'RUNTIME_PROTOCOL_ERROR',
    );
  return result;
}

function optionalParam(target: Record<string, unknown>, key: string, value: unknown): void {
  if (value !== undefined) target[key] = value;
}

/** Thin Astra-owned adapter for the pinned Codex app-server protocol. */
export class CodexAppServerClient {
  private readonly notificationListeners = new Set<(event: CodexRuntimeEvent) => void>();
  private readonly serverRequestListeners = new Set<(request: CodexServerRequest) => void>();
  private readonly unsubscribe: () => void;

  constructor(private readonly session: CodexRuntimeSession) {
    this.unsubscribe = session.onEvent((event) => {
      if (typeof event.method !== 'string') return;
      if ('id' in event && (typeof event.id === 'string' || typeof event.id === 'number')) {
        this.serverRequestListeners.forEach((listener) => listener(event as CodexServerRequest));
        return;
      }
      this.notificationListeners.forEach((listener) => listener(event));
    });
  }

  onNotification(listener: (event: CodexRuntimeEvent) => void): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  onServerRequest(listener: (request: CodexServerRequest) => void): () => void {
    this.serverRequestListeners.add(listener);
    return () => this.serverRequestListeners.delete(listener);
  }

  respond(id: CodexRpcId, result: unknown): void {
    this.session.respond(id, result);
  }

  respondError(id: CodexRpcId, code: number, message: string, data?: unknown): void {
    this.session.respondError(id, code, message, data);
  }

  async initialize(input?: {
    name?: string;
    title?: string;
    version?: string;
  }): Promise<CodexInitializeResponse> {
    const result = record(
      await this.session.request('initialize', {
        clientInfo: {
          name: input?.name ?? 'astra-ai',
          title: input?.title ?? 'Astra Code',
          version: input?.version ?? '0.1.0',
        },
        capabilities: { experimentalApi: true },
      }),
      'initialize',
    );
    this.session.notify('initialized');
    return {
      userAgent: stringField(result, 'userAgent', 'initialize'),
      codexHome: stringField(result, 'codexHome', 'initialize'),
      platformFamily: stringField(result, 'platformFamily', 'initialize'),
      platformOs: stringField(result, 'platformOs', 'initialize'),
    };
  }

  async startThread(options: CodexStartThreadOptions): Promise<CodexThreadHandle> {
    const params: Record<string, unknown> = {
      cwd: options.cwd,
      modelProvider: options.modelProvider ?? 'astra',
      approvalPolicy: options.approvalPolicy ?? 'on-request',
      sandbox: options.sandbox ?? 'workspace-write',
      dynamicTools: options.dynamicTools ?? ASTRA_CODEX_DYNAMIC_TOOLS,
    };
    optionalParam(params, 'model', options.model);
    optionalParam(params, 'runtimeWorkspaceRoots', options.runtimeWorkspaceRoots ?? [options.cwd]);
    const result = record(await this.session.request('thread/start', params), 'thread/start');
    const thread = record(result.thread, 'thread/start.thread');
    return {
      threadId: stringField(thread, 'id', 'thread/start.thread'),
      model: stringField(result, 'model', 'thread/start'),
      modelProvider: stringField(result, 'modelProvider', 'thread/start'),
    };
  }

  async startTurn(
    threadId: string,
    prompt: string,
    options?: { model?: string },
  ): Promise<CodexTurnHandle> {
    const params: Record<string, unknown> = {
      threadId,
      input: [{ type: 'text', text: prompt, textElements: [] }],
    };
    optionalParam(params, 'model', options?.model);
    const result = record(await this.session.request('turn/start', params), 'turn/start');
    const turn = record(result.turn, 'turn/start.turn');
    return { turnId: stringField(turn, 'id', 'turn/start.turn') };
  }

  async interrupt(threadId: string, turnId: string): Promise<void> {
    await this.session.request('turn/interrupt', { threadId, turnId });
  }

  async stop(): Promise<void> {
    this.unsubscribe();
    await this.session.stop();
  }
}

/** Supervises only the exact Codex artifact declared by an Astra build. */
export class CodexRuntimeSupervisor {
  private session: ManagedCodexSession | null = null;

  constructor(private readonly options: CodexRuntimeSupervisorOptions) {}

  async start(): Promise<CodexRuntimeSession> {
    if (this.session) return this.session;
    const manifest = validateCodexRuntimeManifest(this.options.manifest);
    if (manifest.sourceSha !== PINNED_CODEX_SOURCE_SHA)
      throw new CodexRuntimeError(
        `Codex source SHA ${manifest.sourceSha} is not the pinned Astra SHA`,
        'ARTIFACT_IDENTITY_MISMATCH',
      );
    if (
      manifest.runtimeSourceSha !== undefined &&
      manifest.runtimeSourceSha !== PINNED_CODEX_RUNTIME_SOURCE_SHA
    )
      throw new CodexRuntimeError(
        `Codex runtime release SHA ${manifest.runtimeSourceSha} is not the pinned official release`,
        'ARTIFACT_IDENTITY_MISMATCH',
      );
    if (
      manifest.releaseTag !== undefined &&
      manifest.releaseTag !== PINNED_CODEX_RUNTIME_RELEASE_TAG
    )
      throw new CodexRuntimeError(
        `Codex runtime release ${manifest.releaseTag} is not the pinned official release`,
        'ARTIFACT_IDENTITY_MISMATCH',
      );
    if (manifest.adapterVersion !== CODEX_ADAPTER_VERSION)
      throw new CodexRuntimeError('Codex adapter version is incompatible', 'PROTOCOL_MISMATCH');
    if (manifest.protocolFingerprint !== CODEX_PROTOCOL_FINGERPRINT)
      throw new CodexRuntimeError(
        'Codex protocol fingerprint is incompatible with this adapter',
        'PROTOCOL_MISMATCH',
      );
    const root = resolve(this.options.runtimeRoot);
    const executable = resolve(root, manifest.artifactPath);
    assertWithinRoot(root, executable);
    try {
      const details = await stat(executable);
      if (!details.isFile()) throw new Error('not a regular file');
    } catch {
      throw new CodexRuntimeError(
        `Pinned Codex artifact is missing: ${executable}`,
        'MISSING_ARTIFACT',
      );
    }
    if ((await sha256(executable)) !== manifest.artifactSha256)
      throw new CodexRuntimeError(
        'Pinned Codex artifact hash does not match its manifest',
        'ARTIFACT_IDENTITY_MISMATCH',
      );
    const codexHome = join(this.options.userDataPath, 'runtime', 'codex');
    await mkdir(codexHome, { recursive: true });
    if (this.options.runtimeApiBaseUrl) {
      await writeFile(
        join(codexHome, 'config.toml'),
        [
          'model_provider = "astra"',
          '',
          '[model_providers.astra]',
          'name = "Astra Runtime"',
          `base_url = ${JSON.stringify(this.options.runtimeApiBaseUrl)}`,
          'env_key = "ASTRA_RUNTIME_AUTH"',
          'wire_api = "responses"',
          ...(this.options.runtimeQueryParams &&
          Object.keys(this.options.runtimeQueryParams).length > 0
            ? [
                `query_params = { ${Object.entries(this.options.runtimeQueryParams)
                  .map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
                  .join(', ')} }`,
              ]
            : []),
          'requires_openai_auth = false',
          'request_max_retries = 0',
          'stream_max_retries = 0',
          '',
        ].join('\n'),
        'utf8',
      );
    }
    const environment = createIsolatedEnvironment(
      this.options.environment ?? process.env,
      codexHome,
      this.options.runtimeAuthToken,
    );
    const spawnProcess = this.options.spawnProcess ?? spawn;
    const child = spawnProcess(executable, manifest.args, {
      cwd: root,
      env: environment,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.session = new ManagedCodexSession(child);
    return this.session;
  }

  async stop(): Promise<void> {
    const session = this.session;
    this.session = null;
    await session?.stop();
  }
}

export function bundledCodexRuntimeRoot(resourcesPath: string): string {
  return join(resourcesPath, 'codex');
}

export function protocolFingerprintInput(paths: string[]): string {
  return createHash('sha256').update(paths.sort().join('\n')).digest('hex');
}
