import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import {
  AgentTaskRunner,
  InMemorySessionStore,
  type SessionStore,
  type AgentPorts,
  type ModelPort,
  type PermissionAction,
  type PermissionOutcome,
} from '@lyntar/agent-core';
import { HackathonService, LearnService, VivaService } from '@lyntar/modes';
import { MemoryCredentialStore, type CredentialStore, type DeviceIdentity } from './credentials.js';
import { CodexTaskRunner } from './codex-task-runner.js';
import {
  AuthSessionResultSchema,
  DesktopDeviceSchema,
  DesktopRoomSchema,
  DesktopRoomFileSchema,
  DesktopRoomFileImportSchema,
  PublicUserSchema,
  IpcTaskResultSchema,
  ModelCatalogEntrySchema,
  ModelCatalogResponseSchema,
  ModelDecisionResponseSchema,
  ModelStreamEventSchema,
  CreditReservationSchema,
  WalletSchema,
  type AgentEvent,
  type DesktopDevice,
  type DesktopRoom,
  type DesktopRoomFile,
  type DesktopRoomFileImport,
  type PublicUser,
  type Wallet,
  type IpcTaskResult,
  type HackathonPlan,
  type LearnDepth,
  type LearnResult,
  type ModelCatalogEntry,
  type ModelRequest,
  type ModelStreamEvent,
  type WorkspaceDescriptor,
  type VivaCategory,
  type VivaDifficulty,
  type VivaQuestion,
  type VivaEvaluation,
  type TaskBudget,
} from '@lyntar/contracts';
import { assertSafeProjectRelativePath, extractRoomArchive } from '@lyntar/remote-protocol';
import {
  classifyCommand,
  GitWorkspace,
  LocalCommandRunner,
  LocalWorkspace,
  verifyProject,
} from '@lyntar/workspace';
import { creditsFromUsd, formatUsd, parseUsd } from '@lyntar/billing';

export interface DesktopRuntimeOptions {
  /** Production defaults to the pinned Codex runtime. Legacy mode is test-only. */
  runtimeMode?: 'codex' | 'legacy-test';
  codexRuntimeRoot?: string;
  userDataPath?: string;
}

interface DesktopTaskRunner {
  start(input: {
    taskId: string;
    workspaceId: string;
    agentSessionId: string;
    prompt: string;
    modelId: string;
    roomId?: string | undefined;
    budget: TaskBudget;
    reservationId?: string;
  }): Promise<unknown>;
  cancel(taskId: string, reason: string): void;
  resolvePermission(taskId: string, requestId: string, approved: boolean): void;
}

class ApiModelPort implements ModelPort {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly accessToken: () => string | null,
    private readonly reservationId: (taskId: string) => string | null,
  ) {}

  async *complete(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/x-ndjson, application/json',
    };
    const token = this.accessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const reservation = this.reservationId(request.taskId);
    if (reservation) headers['x-lyntar-reservation-id'] = reservation;
    const response = await fetch(`${this.apiBaseUrl}/v1/model-requests`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal,
    });
    if (!response.ok)
      throw new Error(`Astra Code API model request failed with ${response.status}`);
    if (response.headers.get('content-type')?.includes('application/x-ndjson')) {
      if (!response.body) throw new Error('Astra Code API returned no model stream');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const consume = (line: string): ModelStreamEvent | null => {
        if (!line.trim()) return null;
        const value = JSON.parse(line) as Record<string, unknown>;
        if (value.type === 'error') throw new Error('Astra Code model stream failed');
        if (value.type === 'model') {
          const selectedModelId =
            typeof value.selectedModelId === 'string' ? value.selectedModelId : undefined;
          if (selectedModelId && selectedModelId !== request.modelId)
            return {
              type: 'event',
              event: {
                eventId: randomUUID(),
                taskId: request.taskId,
                type: 'model.changed',
                occurredAt: new Date().toISOString(),
                payload: {
                  fromModelId: request.modelId,
                  toModelId: selectedModelId,
                  ...(request.agentSessionId ? { sessionId: request.agentSessionId } : {}),
                },
              },
            };
          return null;
        }
        return ModelStreamEventSchema.parse(value);
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const event = consume(line);
          if (event) yield event;
        }
      }
      buffer += decoder.decode();
      const event = consume(buffer);
      if (event) yield event;
      return;
    }
    const body = ModelDecisionResponseSchema.parse(await response.json());
    if (body.selectedModelId && body.selectedModelId !== request.modelId) {
      yield {
        type: 'event',
        event: {
          eventId: randomUUID(),
          taskId: request.taskId,
          type: 'model.changed',
          occurredAt: new Date().toISOString(),
          payload: {
            fromModelId: request.modelId,
            toModelId: body.selectedModelId,
            ...(request.agentSessionId ? { sessionId: request.agentSessionId } : {}),
          },
        },
      };
    }
    if (body.providerRequestId)
      yield { type: 'provider', providerRequestId: body.providerRequestId };
    yield { type: 'decision', decision: body.decision };
    if (body.usage) yield { type: 'usage', receipt: body.usage };
  }
}

class DesktopPermissionPort {
  async evaluate(action: PermissionAction): Promise<PermissionOutcome> {
    if (action.kind !== 'command')
      return { kind: 'allow', reason: 'Selected workspace capability' };
    const risk = classifyCommand(action.request);
    if (risk === 'safe') return { kind: 'allow', reason: 'Allowlisted local development command' };
    if (risk === 'prohibited')
      return { kind: 'deny', reason: 'Command is prohibited by the workspace policy' };
    return { kind: 'request', reason: `Command requires ${risk} approval`, risk };
  }
}

function normalizeWindowsPath(value: string): string {
  return value
    .replaceAll('/', '\\')
    .replace(/[\\]+$/, '')
    .toLowerCase();
}

function contentTypeForPath(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.json':
      return 'application/json';
    case '.txt':
    case '.md':
    case '.ts':
    case '.tsx':
    case '.js':
    case '.jsx':
    case '.css':
    case '.html':
    case '.yml':
    case '.yaml':
      return 'text/plain';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.pdf':
      return 'application/pdf';
    case '.zip':
      return 'application/zip';
    default:
      return 'application/octet-stream';
  }
}

export class DesktopRuntime {
  private workspace: LocalWorkspace | undefined;
  private git: GitWorkspace | undefined;
  private descriptor: WorkspaceDescriptor | undefined;
  private runner: DesktopTaskRunner | undefined;
  private readonly runtimeMode: DesktopRuntimeOptions['runtimeMode'];
  private readonly codexRuntimeRoot: string;
  private readonly runtimeUserDataPath: string;
  private agentSessionId: string = randomUUID();
  private readonly listeners = new Set<(event: AgentEvent) => void>();
  private readonly learn = new LearnService();
  private readonly viva = new VivaService();
  private readonly hackathon = new HackathonService();
  private authSession: ReturnType<typeof AuthSessionResultSchema.parse> | null = null;
  private pendingGoogleVerifier: string | null = null;
  private readonly activeReservationIds = new Map<string, string>();
  private readonly receiptValues: NonNullable<ReturnType<AgentPorts['receipts']['list']>> = [];
  private readonly receipts: AgentPorts['receipts'] = {
    add: (receipt) => this.receiptValues.push(receipt),
    list: (taskId) =>
      taskId
        ? this.receiptValues.filter((receipt) => receipt.taskId === taskId)
        : [...this.receiptValues],
  };

  constructor(
    private readonly apiBaseUrl = process.env.LYNTAR_API_URL ?? 'http://127.0.0.1:4317',
    private readonly credentials: CredentialStore = new MemoryCredentialStore(),
    private readonly sessionStore: SessionStore = new InMemorySessionStore(),
    options: DesktopRuntimeOptions = {},
  ) {
    this.runtimeMode = options.runtimeMode ?? 'codex';
    this.codexRuntimeRoot =
      options.codexRuntimeRoot ??
      process.env.ASTRA_CODEX_RUNTIME_ROOT ??
      join(process.cwd(), 'apps/desktop/resources/codex');
    this.runtimeUserDataPath =
      options.userDataPath ?? process.env.ASTRA_RUNTIME_USER_DATA ?? join(process.cwd(), '.astra');
  }

  async openWorkspace(root: string): Promise<WorkspaceDescriptor> {
    const workspace = await LocalWorkspace.open(root);
    const git = await GitWorkspace.open(root);
    if (
      normalizeWindowsPath(workspace.canonical.root) !== normalizeWindowsPath(git.repositoryRoot)
    ) {
      throw new Error('Select the Git repository root rather than a subdirectory');
    }
    this.workspace = workspace;
    this.git = git;
    const workspaceId = `workspace-${createHash('sha256')
      .update(normalizeWindowsPath(workspace.canonical.root))
      .digest('hex')}`;
    const currentUserId = this.authSession?.user.id ?? 'local-desktop';
    const previousSession = (await this.sessionStore.listSessions(currentUserId)).find(
      (session) => session.workspaceId === workspaceId,
    );
    this.agentSessionId = previousSession?.sessionId ?? randomUUID();
    this.descriptor = {
      workspaceId,
      displayName: root.split(/[\\/]/).at(-1) ?? root,
      canonicalRoot: workspace.canonical.root,
      selectedAt: new Date().toISOString(),
    };
    const legacyRunner =
      this.runtimeMode === 'legacy-test'
        ? new AgentTaskRunner({
            model: new ApiModelPort(
              this.apiBaseUrl,
              () => this.authSession?.accessToken ?? null,
              (taskId) => this.activeReservationIds.get(taskId) ?? null,
            ),
            workspace,
            patch: { apply: (batch, signal) => workspace.writeBatch(batch, signal) },
            command: {
              run: (request, signal) =>
                new LocalCommandRunner(workspace.canonical).run(request, signal),
            },
            git,
            verification: {
              verify: async (signal) => {
                const result = await verifyProject(workspace.canonical, signal);
                return {
                  status: result.status,
                  ...(result.command ? { command: result.command } : {}),
                  summary: result.summary,
                  stdout: result.result?.stdout ?? '',
                  stderr: result.result?.stderr ?? '',
                };
              },
            },
            event: {
              append: async (event) => {
                this.listeners.forEach((listener) => listener(event));
                const response = await fetch(`${this.apiBaseUrl}/v1/agent-events`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(event),
                });
                if (!response.ok)
                  throw new Error(`Astra Code event persistence failed with ${response.status}`);
              },
            },
            permission: new DesktopPermissionPort(),
            receipts: this.receipts,
            session: {
              store: this.sessionStore,
              userId: () => this.authSession?.user.id ?? 'local-desktop',
            },
          })
        : undefined;
    this.runner =
      this.runtimeMode === 'codex'
        ? new CodexTaskRunner({
            workspace,
            git,
            runtimeRoot: this.codexRuntimeRoot,
            userDataPath: this.runtimeUserDataPath,
            apiBaseUrl: this.apiBaseUrl,
            accessToken: () => this.authSession?.accessToken ?? null,
            emit: async (event) => {
              this.listeners.forEach((listener) => listener(event));
              const response = await fetch(`${this.apiBaseUrl}/v1/agent-events`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(this.authSession?.accessToken
                    ? { Authorization: `Bearer ${this.authSession.accessToken}` }
                    : {}),
                },
                body: JSON.stringify(event),
              });
              if (!response.ok)
                throw new Error(`Astra Code event persistence failed with ${response.status}`);
            },
          })
        : legacyRunner;
    return this.descriptor;
  }

  getWorkspace(): WorkspaceDescriptor | null {
    return this.descriptor ?? null;
  }

  async readFile(relativePath: string): Promise<string> {
    if (!this.workspace) throw new Error('Open a workspace first');
    return this.workspace.readFile(relativePath);
  }

  async search(query: string): Promise<Array<{ path: string; line: number; text: string }>> {
    if (!this.workspace) throw new Error('Open a workspace first');
    return this.workspace.search(query);
  }

  async learnFile(input: {
    path: string;
    depth: LearnDepth;
    question?: string | undefined;
  }): Promise<LearnResult> {
    if (!this.workspace) throw new Error('Open a workspace first');
    const files = { [input.path]: await this.workspace.readFile(input.path) };
    return this.learn.explain({
      files,
      path: input.path,
      depth: input.depth,
      ...(input.question ? { question: input.question } : {}),
    });
  }

  async generateViva(input: {
    categories: VivaCategory[];
    difficulty: VivaDifficulty;
    count: number;
  }): Promise<VivaQuestion[]> {
    if (!this.workspace) throw new Error('Open a workspace first');
    const files = await this.readProjectSnapshot();
    return this.viva.generate({ files, ...input });
  }

  async evaluateViva(input: { question: VivaQuestion; answer: string }): Promise<VivaEvaluation> {
    const files = await this.readProjectSnapshot();
    return this.viva.evaluate(input.question, input.answer, files);
  }

  async hackathonPlan(input: { problem: string; criteria: string[] }): Promise<HackathonPlan> {
    return this.hackathon.plan(input);
  }

  private async readProjectSnapshot(): Promise<Record<string, string>> {
    if (!this.workspace) throw new Error('Open a workspace first');
    const snapshot: Record<string, string> = {};
    let totalBytes = 0;
    for (const path of (await this.workspace.listFiles()).slice(0, 200)) {
      if (totalBytes >= 1_000_000) break;
      try {
        const content = await this.workspace.readFile(path);
        totalBytes += content.length;
        if (totalBytes <= 1_000_000) snapshot[path] = content;
      } catch {
        // Binary or concurrently removed files are not useful to learning modes.
      }
    }
    return snapshot;
  }

  async listModels(): Promise<ModelCatalogEntry[]> {
    const response = await fetch(`${this.apiBaseUrl}/v1/models`);
    if (!response.ok) throw new Error(`Astra Code model catalog failed with ${response.status}`);
    const body = ModelCatalogResponseSchema.parse(await response.json());
    return body.models.map((model) => ModelCatalogEntrySchema.parse(model));
  }

  async authLogin(input: {
    email: string;
    password: string;
    device: { label: string; platform: string; architecture: string; appVersion: string };
  }): Promise<PublicUser> {
    const response = await fetch(`${this.apiBaseUrl}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(`Authentication failed with ${response.status}`);
    const session = AuthSessionResultSchema.parse(await response.json());
    await this.credentials.set(session);
    this.authSession = session;
    await this.registerDevice();
    return session.user;
  }

  async authStatus(): Promise<PublicUser | null> {
    const session = this.authSession ?? (await this.credentials.get());
    if (!session) return null;
    const response = await fetch(`${this.apiBaseUrl}/v1/auth/me`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (!response.ok) {
      const refreshed = await fetch(`${this.apiBaseUrl}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
      if (!refreshed.ok) {
        await this.credentials.clear();
        this.authSession = null;
        return null;
      }
      const rotated = AuthSessionResultSchema.parse(await refreshed.json());
      await this.credentials.set(rotated);
      this.authSession = rotated;
      await this.registerDevice().catch(() => undefined);
      return rotated.user;
    }
    const body = (await response.json()) as { user: unknown };
    const user = PublicUserSchema.parse(body.user);
    this.authSession = { ...session, user };
    await this.registerDevice().catch(() => undefined);
    return user;
  }

  async authLogout(): Promise<void> {
    const session = this.authSession ?? (await this.credentials.get());
    if (session) {
      await fetch(`${this.apiBaseUrl}/v1/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.accessToken}` },
      }).catch(() => undefined);
    }
    this.authSession = null;
    await this.credentials.clear();
  }

  async authGoogleStart(): Promise<{ authorizationUrl: string }> {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const response = await fetch(`${this.apiBaseUrl}/v1/auth/google/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        codeChallenge: challenge,
        device: {
          label: 'Astra Code desktop',
          platform: process.platform,
          architecture: process.arch,
          appVersion: '0.1.0',
        },
      }),
    });
    if (!response.ok) throw new Error(`Astra Google sign-in unavailable with ${response.status}`);
    const body = (await response.json()) as { authorizationUrl?: unknown };
    if (typeof body.authorizationUrl !== 'string')
      throw new Error('Google authorization URL is invalid');
    this.pendingGoogleVerifier = verifier;
    return { authorizationUrl: body.authorizationUrl };
  }

  async authGoogleComplete(code: string): Promise<PublicUser> {
    const verifier = this.pendingGoogleVerifier;
    if (!verifier) throw new Error('No Google sign-in is pending');
    const response = await fetch(`${this.apiBaseUrl}/v1/auth/google/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, verifier }),
    });
    if (!response.ok) throw new Error(`Google sign-in exchange failed with ${response.status}`);
    const session = AuthSessionResultSchema.parse(await response.json());
    await this.credentials.set(session);
    this.authSession = session;
    this.pendingGoogleVerifier = null;
    await this.registerDevice();
    return session.user;
  }

  async billingWallet(): Promise<Wallet | null> {
    const session = this.authSession ?? (await this.credentials.get());
    if (!session) return null;
    this.authSession = session;
    const response = await fetch(`${this.apiBaseUrl}/v1/wallet`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { wallet: unknown };
    return WalletSchema.parse(body.wallet);
  }

  async listDevices(): Promise<DesktopDevice[]> {
    const session = this.authSession ?? (await this.credentials.get());
    if (!session) return [];
    this.authSession = session;
    const response = await fetch(`${this.apiBaseUrl}/v1/devices`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (!response.ok) throw new Error(`Device list failed with ${response.status}`);
    const body = (await response.json()) as { devices?: unknown };
    if (!Array.isArray(body.devices)) throw new Error('Device list response is invalid');
    const devices = body.devices.map((device) => DesktopDeviceSchema.parse(device));
    const identity = await this.credentials.getDeviceIdentity();
    if (identity && devices.some((device) => device.id === identity.deviceId)) {
      await this.heartbeatDevice(identity.deviceId).catch(() => undefined);
    }
    return devices;
  }

  async registerDevice(): Promise<DesktopDevice> {
    const session = this.authSession ?? (await this.credentials.get());
    if (!session) throw new Error('Authentication is required to register a device');
    this.authSession = session;
    const identity = await this.getOrCreateDeviceIdentity();
    const response = await fetch(`${this.apiBaseUrl}/v1/devices/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({
        label: 'Astra Code desktop',
        platform: process.platform,
        architecture: process.arch,
        publicKeyPem: identity.publicKeyPem,
      }),
    });
    if (!response.ok) throw new Error(`Device registration failed with ${response.status}`);
    const body = (await response.json()) as { device?: unknown };
    const device = DesktopDeviceSchema.parse(body.device);
    if (device.id !== identity.deviceId)
      await this.credentials.setDeviceIdentity({ ...identity, deviceId: device.id });
    return this.heartbeatDevice(device.id);
  }

  private async heartbeatDevice(deviceId: string): Promise<DesktopDevice> {
    const session = this.authSession ?? (await this.credentials.get());
    if (!session) throw new Error('Authentication is required to heartbeat a device');
    this.authSession = session;
    const response = await fetch(
      `${this.apiBaseUrl}/v1/devices/${encodeURIComponent(deviceId)}/heartbeat`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.accessToken}` },
      },
    );
    if (!response.ok) throw new Error(`Device heartbeat failed with ${response.status}`);
    const body = (await response.json()) as { device?: unknown };
    return DesktopDeviceSchema.parse(body.device);
  }

  async revokeDevice(deviceId: string): Promise<void> {
    const session = this.authSession ?? (await this.credentials.get());
    if (!session) throw new Error('Authentication is required to revoke a device');
    this.authSession = session;
    const response = await fetch(
      `${this.apiBaseUrl}/v1/devices/${encodeURIComponent(deviceId)}/revoke`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.accessToken}` },
      },
    );
    if (!response.ok) throw new Error(`Device revocation failed with ${response.status}`);
  }

  async listRooms(): Promise<DesktopRoom[]> {
    const session = this.authSession ?? (await this.credentials.get());
    this.authSession = session;
    if (!session) return [];
    const response = await fetch(`${this.apiBaseUrl}/v1/rooms`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (!response.ok) throw new Error(`Room list failed with ${response.status}`);
    const body = (await response.json()) as { rooms?: unknown };
    return Array.isArray(body.rooms)
      ? body.rooms.flatMap((room) => {
          const parsed = DesktopRoomSchema.safeParse(room);
          return parsed.success ? [parsed.data] : [];
        })
      : [];
  }

  async listRoomFiles(roomId: string): Promise<DesktopRoomFile[]> {
    const session = this.authSession ?? (await this.credentials.get());
    this.authSession = session;
    if (!session) return [];
    const response = await fetch(
      `${this.apiBaseUrl}/v1/rooms/${encodeURIComponent(roomId)}/files`,
      { headers: { Authorization: `Bearer ${session.accessToken}` } },
    );
    if (!response.ok) throw new Error(`Room file list failed with ${response.status}`);
    const body = (await response.json()) as { files?: unknown };
    return Array.isArray(body.files)
      ? body.files.flatMap((file) => {
          const parsed = DesktopRoomFileSchema.safeParse(file);
          return parsed.success ? [parsed.data] : [];
        })
      : [];
  }

  async uploadRoomFile(
    roomId: string,
    intent: 'REFERENCE' | 'ADD_TO_PROJECT',
    filePath: string,
  ): Promise<DesktopRoomFile> {
    const session = this.authSession ?? (await this.credentials.get());
    this.authSession = session;
    if (!session) throw new Error('Authentication is required to upload a Room file');
    const content = await readFile(filePath);
    if (content.byteLength > 25 * 1024 * 1024) throw new Error('Room files are limited to 25 MB');
    const response = await fetch(
      `${this.apiBaseUrl}/v1/rooms/${encodeURIComponent(roomId)}/files`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          originalName: basename(filePath),
          contentType: contentTypeForPath(filePath),
          contentBase64: content.toString('base64'),
          intent,
        }),
      },
    );
    if (!response.ok) throw new Error(`Room file upload failed with ${response.status}`);
    const body = (await response.json()) as { file?: unknown };
    return DesktopRoomFileSchema.parse(body.file);
  }

  async deleteRoomFile(roomId: string, fileId: string): Promise<void> {
    const session = this.authSession ?? (await this.credentials.get());
    this.authSession = session;
    if (!session) throw new Error('Authentication is required to delete a Room file');
    const response = await fetch(
      `${this.apiBaseUrl}/v1/rooms/${encodeURIComponent(roomId)}/files/${encodeURIComponent(fileId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.accessToken}` },
      },
    );
    if (!response.ok) throw new Error(`Room file deletion failed with ${response.status}`);
  }

  async previewRoomFileImport(
    roomId: string,
    fileId: string,
    destinationRelative: string,
  ): Promise<DesktopRoomFileImport> {
    const session = this.authSession ?? (await this.credentials.get());
    this.authSession = session;
    if (!session) throw new Error('Authentication is required to preview a Room import');
    if (!this.workspace) throw new Error('Open the bound Room workspace first');
    await this.assertLocalRoomHost(roomId);
    const existingPaths = await this.workspace.listFiles();
    const response = await fetch(
      `${this.apiBaseUrl}/v1/rooms/${encodeURIComponent(roomId)}/files/${encodeURIComponent(fileId)}/import-preview`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({ destinationRelative, existingPaths }),
      },
    );
    if (!response.ok) throw new Error(`Room import preview failed with ${response.status}`);
    const body = (await response.json()) as { proposal?: unknown };
    return DesktopRoomFileImportSchema.parse(body.proposal);
  }

  async importRoomFile(roomId: string, importId: string): Promise<DesktopRoomFileImport> {
    const session = this.authSession ?? (await this.credentials.get());
    this.authSession = session;
    if (!session) throw new Error('Authentication is required to import a Room file');
    if (!this.workspace) throw new Error('Open the bound Room workspace first');
    const hostDeviceId = await this.assertLocalRoomHost(roomId);
    const importsResponse = await fetch(
      `${this.apiBaseUrl}/v1/rooms/${encodeURIComponent(roomId)}/file-imports`,
      { headers: { Authorization: `Bearer ${session.accessToken}` } },
    );
    if (!importsResponse.ok)
      throw new Error(`Room import lookup failed with ${importsResponse.status}`);
    const importsBody = (await importsResponse.json()) as { proposals?: unknown };
    const proposal = Array.isArray(importsBody.proposals)
      ? importsBody.proposals
          .map((candidate) => DesktopRoomFileImportSchema.safeParse(candidate))
          .find((candidate) => candidate.success && candidate.data.id === importId)
      : undefined;
    if (!proposal?.success) throw new Error('Room import proposal was not found');

    let approved = proposal.data;
    if (approved.status === 'PREVIEW') {
      const response = await fetch(
        `${this.apiBaseUrl}/v1/rooms/${encodeURIComponent(roomId)}/file-imports/${encodeURIComponent(importId)}/approve`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.accessToken}` },
        },
      );
      if (!response.ok) throw new Error(`Room import approval failed with ${response.status}`);
      const body = (await response.json()) as { proposal?: unknown };
      approved = DesktopRoomFileImportSchema.parse(body.proposal);
    }
    if (approved.status !== 'APPROVED')
      throw new Error(`Room import is not executable (${approved.status})`);

    const contentResponse = await fetch(
      `${this.apiBaseUrl}/v1/rooms/${encodeURIComponent(roomId)}/files/${encodeURIComponent(approved.fileId)}/content`,
      { headers: { Authorization: `Bearer ${session.accessToken}` } },
    );
    if (!contentResponse.ok)
      throw new Error(`Room import content fetch failed with ${contentResponse.status}`);
    const contentBody = (await contentResponse.json()) as {
      file?: unknown;
      contentBase64?: unknown;
    };
    const source = DesktopRoomFileSchema.parse(contentBody.file);
    if (typeof contentBody.contentBase64 !== 'string')
      throw new Error('Room import content is invalid');
    const sourceContent = Buffer.from(contentBody.contentBase64, 'base64');
    const isZip =
      source.contentType === 'application/zip' ||
      source.safeName.toLowerCase().endsWith('.zip') ||
      sourceContent.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ||
      sourceContent.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const extracted = isZip
      ? extractRoomArchive(sourceContent)
      : [{ path: source.safeName, content: sourceContent }];
    const manifestByPath = new Map(
      approved.manifest.entries.map((entry) => [entry.path.toLowerCase(), entry]),
    );
    const writes = extracted.map((entry) => {
      const path = assertSafeProjectRelativePath(
        approved.destinationRelative ? `${approved.destinationRelative}/${entry.path}` : entry.path,
      );
      const manifestEntry = manifestByPath.get(path.toLowerCase());
      if (!manifestEntry || manifestEntry.action === 'REJECTED')
        throw new Error(`Room import manifest does not authorize ${path}`);
      const checksum = createHash('sha256').update(entry.content).digest('hex');
      if (checksum !== manifestEntry.checksumSha256)
        throw new Error(`Room import checksum mismatch for ${path}`);
      return { path, content: entry.content };
    });
    await this.workspace.writeBufferBatch(writes);
    const completionResponse = await fetch(
      `${this.apiBaseUrl}/v1/rooms/${encodeURIComponent(roomId)}/file-imports/${encodeURIComponent(importId)}/complete`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          hostDeviceId,
          writtenPaths: writes.map((write) => write.path),
        }),
      },
    );
    if (!completionResponse.ok)
      throw new Error(`Room import completion failed with ${completionResponse.status}`);
    const completionBody = (await completionResponse.json()) as { proposal?: unknown };
    return DesktopRoomFileImportSchema.parse(completionBody.proposal);
  }

  private async assertLocalRoomHost(roomId: string): Promise<string> {
    const room = (await this.listRooms()).find((candidate) => candidate.id === roomId);
    if (!room) throw new Error('Room is not available to this account');
    if (room.hostAvailability !== 'ONLINE')
      throw new Error(`Room host is ${room.hostAvailability.toLowerCase()}`);
    const devices = await this.listDevices();
    if (!devices.some((device) => device.id === room.hostDeviceId))
      throw new Error('This desktop is not the bound Room project host');
    return room.hostDeviceId;
  }

  private async getOrCreateDeviceIdentity(): Promise<DeviceIdentity> {
    const existing = await this.credentials.getDeviceIdentity();
    if (existing) return existing;
    const pair = generateKeyPairSync('ed25519');
    const identity: DeviceIdentity = {
      deviceId: randomUUID(),
      publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      privateKeyPem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    };
    await this.credentials.setDeviceIdentity(identity);
    return identity;
  }

  async startTask(input: {
    taskId: string;
    prompt: string;
    modelId: string;
    roomId?: string | undefined;
    budget: Parameters<AgentTaskRunner['start']>[0]['budget'];
  }): Promise<IpcTaskResult> {
    if (!this.runner) throw new Error('Open a workspace first');
    if (!this.descriptor) throw new Error('Open a workspace first');
    const session = this.authSession ?? (await this.credentials.get());
    this.authSession = session;
    const reservationId = session ? await this.reserveTask(input) : null;
    if (reservationId) this.activeReservationIds.set(input.taskId, reservationId);
    try {
      const taskResult = IpcTaskResultSchema.parse(
        await this.runner.start({
          ...input,
          ...(reservationId ? { reservationId } : {}),
          workspaceId: this.descriptor.workspaceId,
          agentSessionId: this.agentSessionId,
        }),
      );
      if (reservationId) await this.settleTask(taskResult, reservationId, input.taskId);
      return taskResult;
    } catch (error) {
      if (reservationId)
        await this.settleTask(null, reservationId, input.taskId).catch(() => undefined);
      throw error;
    } finally {
      this.activeReservationIds.delete(input.taskId);
    }
  }

  private async reserveTask(input: {
    taskId: string;
    modelId: string;
    roomId?: string | undefined;
    budget: Parameters<AgentTaskRunner['start']>[0]['budget'];
  }): Promise<string> {
    const session = this.authSession;
    if (!session) throw new Error('Authentication is required for a billable task');
    const amountCredits = creditsFromUsd(Math.max(0, input.budget.maxEstimatedCostUsd).toFixed(10));
    const response = await fetch(`${this.apiBaseUrl}/v1/billing/reservations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({
        taskId: input.taskId,
        modelId: input.modelId,
        ...(input.roomId ? { roomId: input.roomId } : {}),
        mode: 'BUILD',
        amountCredits,
        idempotencyKey: `desktop:${input.taskId}:reservation`,
      }),
    });
    if (!response.ok) throw new Error(`Task credit reservation failed with ${response.status}`);
    const body = (await response.json()) as { reservation: unknown };
    return CreditReservationSchema.parse(body.reservation).reservationId;
  }

  private async settleTask(
    result: IpcTaskResult | null,
    reservationId: string,
    taskId: string,
  ): Promise<void> {
    const session = this.authSession;
    if (!session) return;
    const providerCost = this.taskCostUsd(taskId);
    const customerCost = result?.state === 'FAILED' ? '0' : providerCost;
    const response = await fetch(`${this.apiBaseUrl}/v1/billing/settlements`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({
        reservationId,
        providerActualCostUsd: providerCost,
        customerBillableCostUsd: customerCost,
        idempotencyKey: `desktop:${taskId}:settlement`,
      }),
    });
    if (!response.ok) throw new Error(`Task credit settlement failed with ${response.status}`);
  }

  private taskCostUsd(taskId: string): string {
    const total = this.receiptValues
      .filter((receipt) => receipt.taskId === taskId && receipt.actualCostUsd !== null)
      .reduce(
        (sum, receipt) => sum + parseUsd(Math.max(0, receipt.actualCostUsd ?? 0).toFixed(10)),
        0n,
      );
    return formatUsd(total);
  }

  cancelTask(taskId: string): void {
    this.runner?.cancel(taskId, 'User stopped the task');
  }

  approveAction(taskId: string, requestId: string): void {
    this.runner?.resolvePermission(taskId, requestId, true);
  }

  rejectAction(taskId: string, requestId: string): void {
    this.runner?.resolvePermission(taskId, requestId, false);
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
