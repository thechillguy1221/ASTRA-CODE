import { createHash } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

/** The immutable Codex source identity selected during Phase 0. */
export const PINNED_CODEX_SOURCE_SHA =
  '5c5308fc9a9ee789049d646ef11e5400384b9c6f' as const;

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
  protocolFingerprint: string;
  adapterVersion: string;
  version: string;
  artifactPath: string;
  artifactSha256: string;
  args: string[];
}

export interface CodexRuntimeSupervisorOptions {
  runtimeRoot: string;
  userDataPath: string;
  manifest: CodexRuntimeManifest;
  runtimeAuthToken?: string;
  spawnProcess?: typeof spawn;
  environment?: NodeJS.ProcessEnv;
}

export interface CodexRuntimeEvent {
  [key: string]: unknown;
}

export interface CodexRuntimeSession {
  request(method: string, params?: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): void;
  onEvent(listener: (event: CodexRuntimeEvent) => void): () => void;
  stop(): Promise<void>;
}

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
  assertHash(candidate.artifactSha256, 'artifactSha256');
  if (!candidate.protocolFingerprint.trim())
    throw new CodexRuntimeError('protocolFingerprint is required', 'INVALID_MANIFEST');
  if (!candidate.adapterVersion.trim() || !candidate.version.trim())
    throw new CodexRuntimeError('adapterVersion and version are required', 'INVALID_MANIFEST');
  if (isAbsolute(candidate.artifactPath) || candidate.artifactPath.includes('..'))
    throw new CodexRuntimeError('artifactPath must be a relative bundled path', 'INVALID_MANIFEST');
  return {
    sourceSha: candidate.sourceSha.toLowerCase(),
    protocolFingerprint: candidate.protocolFingerprint,
    adapterVersion: candidate.adapterVersion,
    version: candidate.version,
    artifactPath: candidate.artifactPath,
    artifactSha256: candidate.artifactSha256.toLowerCase(),
    args: [...candidate.args],
  };
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

function assertWithinRoot(root: string, candidate: string): void {
  const relativePath = relative(root, candidate);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath))
    throw new CodexRuntimeError('Codex artifact escapes the bundled runtime root', 'INVALID_MANIFEST');
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
      return Promise.reject(new CodexRuntimeError('Codex runtime is not running', 'RUNTIME_EXITED'));
    const id = String(this.nextRequestId++);
    const message = { jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) };
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (!error) return;
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.stopped || !this.child.stdin.writable) return;
    const message = { jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) };
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
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
        new CodexRuntimeError('Codex runtime emitted invalid JSON-RPC data', 'RUNTIME_PROTOCOL_ERROR'),
      );
      return;
    }
    if (!value || typeof value !== 'object') return;
    const message = value as Record<string, unknown>;
    const id = typeof message.id === 'string' || typeof message.id === 'number' ? String(message.id) : null;
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
    if (manifest.adapterVersion !== CODEX_ADAPTER_VERSION)
      throw new CodexRuntimeError('Codex adapter version is incompatible', 'PROTOCOL_MISMATCH');
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
      throw new CodexRuntimeError('Pinned Codex artifact hash does not match its manifest', 'ARTIFACT_IDENTITY_MISMATCH');
    const codexHome = join(this.options.userDataPath, 'runtime', 'codex');
    await mkdir(codexHome, { recursive: true });
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
