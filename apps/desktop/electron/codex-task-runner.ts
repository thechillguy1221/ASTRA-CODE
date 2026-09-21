import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  AgentEventSchema,
  IpcTaskResultSchema,
  UsageReceiptSchema,
  type AgentEvent,
  type IpcTaskResult,
  type TaskBudget,
  type UsageReceipt,
} from '@astra/contracts';
import {
  ASTRA_CODEX_DYNAMIC_TOOLS,
  CodexAppServerClient,
  CodexRuntimeSupervisor,
  validateCodexRuntimeManifest,
  type CodexRuntimeManifest,
  type CodexRuntimeSession,
  type CodexServerRequest,
} from '@astra/codex-runtime';
import {
  classifyCommand,
  GitWorkspace,
  LocalWorkspace,
  verifyProject,
  type CommandRequest,
} from '@astra/workspace';

type PermissionResolution = (approved: boolean) => void;

interface PendingPermission {
  requestId: string;
  action: string;
  risk: 'sensitive' | 'destructive';
  summary: string;
  command?: string;
  reason?: string;
  resolve: PermissionResolution;
}

interface ActiveCodexTask {
  taskId: string;
  prompt: string;
  modelId: string;
  roomId?: string;
  runtimeAuthToken?: string;
  workspaceId: string;
  agentSessionId: string;
  threadId: string;
  turnId: string;
  baseline: Awaited<ReturnType<GitWorkspace['captureBaseline']>>;
  client: CodexAppServerClient;
  session: CodexRuntimeSession;
  pendingPermissions: Map<string, PendingPermission>;
  cancelled: boolean;
  resolveCompletion: (status: 'completed' | 'failed' | 'cancelled') => void;
  rejectCompletion: (error: Error) => void;
  completion: Promise<'completed' | 'failed' | 'cancelled'>;
  usageReceipts: UsageReceipt[];
}

export interface CodexTaskRunnerOptions {
  workspace: LocalWorkspace;
  git: GitWorkspace;
  runtimeRoot: string;
  userDataPath: string;
  apiBaseUrl: string;
  accessToken: () => string | null;
  emit: (event: AgentEvent) => Promise<void> | void;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function event(
  taskId: string,
  type: AgentEvent['type'],
  payload: Record<string, unknown>,
): AgentEvent {
  return AgentEventSchema.parse({
    eventId: randomUUID(),
    taskId,
    type,
    occurredAt: new Date().toISOString(),
    payload,
  });
}

function commandRequest(command: string, cwd: string | undefined): CommandRequest {
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  const executable = tokens.shift() ?? '';
  return {
    executable,
    args: tokens,
    cwdRelative: cwd ?? '.',
  };
}

function workspaceRelativeCwd(root: string, cwd: string | undefined): string {
  if (!cwd) return '.';
  const workspaceRoot = resolve(root);
  const candidate = resolve(cwd);
  const value = relative(workspaceRoot, candidate);
  if (!value || (!isAbsolute(value) && value !== '..' && !value.startsWith(`..${sep}`)))
    return value || '.';
  return '__outside_workspace__';
}

function approvalDecision(approved: boolean, destructive: boolean): string {
  if (!approved) return destructive ? 'cancel' : 'decline';
  return 'accept';
}

function textResult(value: unknown): Array<{ type: 'inputText'; text: string }> {
  return [
    {
      type: 'inputText',
      text: typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value)),
    },
  ];
}

/**
 * Astra-owned production adapter around the pinned Codex app-server.
 *
 * Codex owns the autonomous inspect/edit/verify loop. Astra owns process
 * identity, approval routing, web tools, event translation, billing context,
 * and the final verification gate. There is intentionally no legacy fallback
 * in this class.
 */
export class CodexTaskRunner {
  private active: ActiveCodexTask | undefined;

  constructor(private readonly options: CodexTaskRunnerOptions) {}

  async start(input: {
    taskId: string;
    workspaceId: string;
    agentSessionId: string;
    prompt: string;
    modelId: string;
    roomId?: string | undefined;
    budget: TaskBudget;
    reservationId?: string;
  }): Promise<IpcTaskResult> {
    if (this.active) throw new Error('A Codex task is already running in this workspace');
    const baseline = await this.options.git.captureBaseline();
    const manifest = await this.readManifest();
    const accessToken = this.options.accessToken();
    let runtimeAuthToken: string | undefined;
    if (accessToken && input.reservationId) {
      const tokenResponse = await fetch(`${this.options.apiBaseUrl}/v1/runtime/codex/token`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: input.taskId, reservationId: input.reservationId }),
      });
      if (!tokenResponse.ok)
        throw new Error(`Astra Codex runtime authorization failed with ${tokenResponse.status}`);
      const tokenBody = (await tokenResponse.json()) as { token?: unknown };
      if (typeof tokenBody.token !== 'string' || !tokenBody.token)
        throw new Error('Astra Codex runtime authorization returned no scoped token');
      runtimeAuthToken = tokenBody.token;
    }
    const supervisor = new CodexRuntimeSupervisor({
      runtimeRoot: this.options.runtimeRoot,
      userDataPath: this.options.userDataPath,
      manifest,
      ...(runtimeAuthToken ? { runtimeAuthToken } : {}),
      runtimeApiBaseUrl: `${this.options.apiBaseUrl}/runtime/codex/v1`,
      ...(input.reservationId
        ? {
            runtimeQueryParams: {
              task_id: input.taskId,
              reservation_id: input.reservationId,
            },
          }
        : {}),
    });

    let session: CodexRuntimeSession | undefined;
    let client: CodexAppServerClient | undefined;
    let active: ActiveCodexTask | undefined;
    const emit = (kind: AgentEvent['type'], payload: Record<string, unknown>) =>
      this.options.emit(event(input.taskId, kind, payload));

    try {
      session = await supervisor.start();
      client = new CodexAppServerClient(session);
      await client.initialize({
        name: 'astra-code-desktop',
        title: 'Astra Code',
        version: '0.1.0',
      });
      const thread = await client.startThread({
        cwd: this.options.workspace.canonical.root,
        runtimeWorkspaceRoots: [this.options.workspace.canonical.root],
        ...(input.modelId === 'AUTO' ? {} : { model: input.modelId }),
        dynamicTools: ASTRA_CODEX_DYNAMIC_TOOLS,
        approvalPolicy: 'on-request',
        sandbox: 'workspace-write',
      });
      const completion = new Promise<'completed' | 'failed' | 'cancelled'>(
        (resolveCompletion, rejectCompletion) => {
          active = {
            taskId: input.taskId,
            prompt: input.prompt,
            modelId: input.modelId,
            ...(input.roomId ? { roomId: input.roomId } : {}),
            ...(runtimeAuthToken ? { runtimeAuthToken } : {}),
            workspaceId: input.workspaceId,
            agentSessionId: input.agentSessionId,
            threadId: thread.threadId,
            turnId: '',
            baseline,
            client: client as CodexAppServerClient,
            session: session as CodexRuntimeSession,
            pendingPermissions: new Map(),
            cancelled: false,
            resolveCompletion,
            rejectCompletion,
            completion: Promise.resolve('failed'),
            usageReceipts: [],
          };
          this.active = active;
        },
      );
      const running = active;
      if (!running) throw new Error('Codex task state was not initialized');
      running.completion = completion;

      const unsubscribeNotifications = client.onNotification((notification) => {
        this.handleNotification(running, notification, emit);
      });
      const unsubscribeRequests = client.onServerRequest((request) => {
        void this.handleServerRequest(running, request, emit);
      });

      emit('task.started', { summary: 'Codex task started' });
      emit('analysis.started', { summary: 'Codex is inspecting the workspace' });
      emit('model.requested', { modelId: input.modelId, requestId: input.taskId });
      const turn = await client.startTurn(thread.threadId, input.prompt, {
        ...(input.modelId === 'AUTO' ? {} : { model: input.modelId }),
      });
      running.turnId = turn.turnId;
      const status = await completion;
      unsubscribeNotifications();
      unsubscribeRequests();
      if (input.reservationId)
        running.usageReceipts = await this.loadUsageReceipts(input.taskId, input.reservationId);
      return await this.finalize(input, running, status, emit);
    } catch (error) {
      await this.options.emit(
        event(input.taskId, 'task.failed', {
          summary: error instanceof Error ? error.message : 'Codex task failed',
        }),
      );
      throw error;
    } finally {
      this.active = undefined;
      if (client) await client.stop().catch(() => undefined);
      else if (session) await session.stop().catch(() => undefined);
    }
  }

  cancel(taskId: string, reason: string): void {
    const active = this.active;
    if (!active || active.taskId !== taskId) return;
    active.cancelled = true;
    void active.client
      .interrupt(active.threadId, active.turnId)
      .catch(() => undefined)
      .finally(() => active.resolveCompletion('cancelled'));
    void this.options.emit(event(taskId, 'task.cancelled', { summary: reason }));
  }

  resolvePermission(taskId: string, requestId: string, approved: boolean): void {
    const active = this.active;
    if (!active || active.taskId !== taskId) return;
    const pending = active.pendingPermissions.get(requestId);
    if (!pending) return;
    active.pendingPermissions.delete(requestId);
    pending.resolve(approved);
    void this.options.emit(
      event(taskId, approved ? 'permission.granted' : 'permission.denied', {
        requestId,
        action: pending.action,
        ...(pending.reason ? { reason: pending.reason } : {}),
      }),
    );
    void this.options.emit(
      event(taskId, 'user.approval', { requestId, action: pending.action, approved }),
    );
  }

  private async readManifest(): Promise<CodexRuntimeManifest> {
    const value = JSON.parse(
      await readFile(join(this.options.runtimeRoot, 'codex-runtime.json'), 'utf8'),
    ) as unknown;
    return validateCodexRuntimeManifest(value);
  }

  private async loadUsageReceipts(taskId: string, reservationId: string): Promise<UsageReceipt[]> {
    const token = this.options.accessToken();
    if (!token) return [];
    const response = await fetch(
      `${this.options.apiBaseUrl}/v1/billing/tasks/${encodeURIComponent(taskId)}/receipts`,
      { headers: { Authorization: `Bearer ${token}`, 'x-astra-reservation-id': reservationId } },
    );
    if (!response.ok) return [];
    const body = (await response.json()) as { receipts?: unknown };
    return Array.isArray(body.receipts)
      ? body.receipts.filter((receipt): receipt is UsageReceipt => {
          try {
            return UsageReceiptSchema.safeParse(receipt).success;
          } catch {
            return false;
          }
        })
      : [];
  }

  private handleNotification(
    active: ActiveCodexTask,
    notification: Record<string, unknown>,
    emit: (type: AgentEvent['type'], payload: Record<string, unknown>) => void,
  ): void {
    const method = typeof notification.method === 'string' ? notification.method : '';
    const params = asRecord(notification.params);
    if (method === 'turn/started') {
      emit('model.streaming', { summary: 'Codex is streaming model output' });
      return;
    }
    if (method === 'item/agentMessage/delta') {
      emit('model.streaming', { summary: 'Astra agent response is streaming' });
      return;
    }
    if (method === 'item/started') {
      const item = asRecord(params.item);
      const itemType = typeof item.type === 'string' ? item.type : 'tool';
      emit('tool.requested', { tool: itemType, summary: `Codex started ${itemType}` });
      return;
    }
    if (method === 'item/fileChange/patchUpdated') {
      const changes = Array.isArray(params.changes) ? params.changes : [];
      const paths = changes
        .map((change) => {
          const record = asRecord(change);
          return typeof record.path === 'string' ? record.path : '';
        })
        .filter(Boolean);
      if (paths.length > 0) emit('patch.applied', { paths, fileCount: paths.length });
      return;
    }
    if (method === 'thread/tokenUsage/updated') {
      emit('usage.received', {
        requestId: active.turnId || active.taskId,
        actualCostUsd: null,
      });
      return;
    }
    if (method !== 'turn/completed') return;
    const turn = asRecord(params.turn);
    const status = turn.status;
    if (status === 'interrupted' || active.cancelled) active.resolveCompletion('cancelled');
    else if (status === 'completed') active.resolveCompletion('completed');
    else active.resolveCompletion('failed');
  }

  private async handleServerRequest(
    active: ActiveCodexTask,
    request: CodexServerRequest,
    emit: (type: AgentEvent['type'], payload: Record<string, unknown>) => void,
  ): Promise<void> {
    const params = asRecord(request.params);
    if (request.method === 'item/tool/call') {
      await this.handleDynamicTool(active, request, params, emit);
      return;
    }
    if (
      request.method === 'item/commandExecution/requestApproval' ||
      request.method === 'item/fileChange/requestApproval'
    ) {
      await this.handleApprovalRequest(active, request, params, emit);
      return;
    }
    active.client.respondError(
      request.id,
      -32001,
      `Astra denied unsupported Codex server request: ${request.method}`,
    );
  }

  private async handleDynamicTool(
    active: ActiveCodexTask,
    request: CodexServerRequest,
    params: Record<string, unknown>,
    emit: (type: AgentEvent['type'], payload: Record<string, unknown>) => void,
  ): Promise<void> {
    const tool = typeof params.tool === 'string' ? params.tool : '';
    const rawArguments = params.arguments;
    let args: Record<string, unknown>;
    try {
      const parsed =
        typeof rawArguments === 'string' ? (JSON.parse(rawArguments) as unknown) : rawArguments;
      args = asRecord(parsed);
    } catch {
      active.client.respond(request.id, {
        contentItems: textResult('Astra rejected malformed tool arguments.'),
        success: false,
      });
      return;
    }
    if (tool !== 'web_search' && tool !== 'web_fetch') {
      active.client.respond(request.id, {
        contentItems: textResult(`Astra does not expose the requested tool: ${tool}`),
        success: false,
      });
      return;
    }
    emit('tool.requested', { tool, summary: `Astra ${tool} requested` });
    const token = this.options.accessToken();
    if (!token) {
      active.client.respond(request.id, {
        contentItems: textResult('Authentication is required for Astra web research.'),
        success: false,
      });
      return;
    }
    const endpoint = tool === 'web_search' ? '/v1/web/search' : '/v1/web/fetch';
    const body =
      tool === 'web_search'
        ? {
            taskId: active.taskId,
            query: args.query,
            ...(active.roomId ? { roomId: active.roomId } : {}),
            ...(typeof args.max_results === 'number' ? { maxResults: args.max_results } : {}),
            ...(typeof args.recency === 'string' ? { recency: args.recency } : {}),
            ...(Array.isArray(args.domains) ? { domains: args.domains } : {}),
            ...(Array.isArray(args.exclude_domains)
              ? { excludeDomains: args.exclude_domains }
              : {}),
            ...(typeof args.safe_search === 'boolean' ? { safeSearch: args.safe_search } : {}),
          }
        : {
            taskId: active.taskId,
            url: args.url,
            ...(active.roomId ? { roomId: active.roomId } : {}),
            ...(typeof args.purpose === 'string' ? { purpose: args.purpose } : {}),
            ...(typeof args.max_bytes === 'number' ? { maxBytes: args.max_bytes } : {}),
          };
    try {
      const response = await fetch(`${this.options.apiBaseUrl}${endpoint}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const responseBody = await response.text();
      let value: unknown = responseBody;
      try {
        value = JSON.parse(responseBody) as unknown;
      } catch {
        // Preserve non-JSON provider/API diagnostics as plain text.
      }
      active.client.respond(request.id, {
        contentItems: textResult(value),
        success: response.ok,
      });
    } catch (error) {
      active.client.respond(request.id, {
        contentItems: textResult(
          error instanceof Error ? error.message : 'Astra web research failed',
        ),
        success: false,
      });
    }
  }

  private async handleApprovalRequest(
    active: ActiveCodexTask,
    request: CodexServerRequest,
    params: Record<string, unknown>,
    emit: (type: AgentEvent['type'], payload: Record<string, unknown>) => void,
  ): Promise<void> {
    const isCommand = request.method === 'item/commandExecution/requestApproval';
    const command = typeof params.command === 'string' ? params.command : undefined;
    const cwd = typeof params.cwd === 'string' ? params.cwd : undefined;
    const parsed = command
      ? commandRequest(command, workspaceRelativeCwd(this.options.workspace.canonical.root, cwd))
      : null;
    const risk = parsed ? classifyCommand(parsed) : 'sensitive';
    const requestId = String(request.id);
    const action = isCommand ? 'command.execute' : 'workspace.write';
    const summary = isCommand
      ? 'Codex requested a local command'
      : 'Codex requested project changes';
    const authorizationPermission = isCommand
      ? risk === 'destructive'
        ? 'destructive.approve'
        : 'terminal.run'
      : 'files.write';
    const authorized = await this.authorizeRuntimeAction(
      active,
      authorizationPermission,
      command ?? (typeof params.reason === 'string' ? params.reason : 'workspace change'),
      action,
    );
    if (!authorized) {
      active.client.respond(request.id, { decision: 'decline' });
      emit('permission.denied', {
        requestId,
        action,
        summary,
        reason: 'Astra Room policy denied this operation',
        ...(command ? { command } : {}),
        risk: risk === 'destructive' ? 'destructive' : 'sensitive',
      });
      return;
    }
    if (risk === 'prohibited') {
      active.client.respond(request.id, {
        decision: isCommand ? 'decline' : 'decline',
      });
      emit('permission.denied', {
        requestId,
        action,
        summary,
        reason: 'Astra workspace policy denied this operation',
        ...(command ? { command } : {}),
        risk: 'destructive',
      });
      return;
    }
    if (isCommand && risk === 'safe') {
      active.client.respond(request.id, { decision: 'accept' });
      emit('permission.granted', {
        requestId,
        action,
        summary,
        reason: 'Astra safe-command policy allowed this operation',
        ...(command ? { command } : {}),
      });
      return;
    }
    const pending = new Promise<boolean>((resolve) => {
      active.pendingPermissions.set(requestId, {
        requestId,
        action,
        risk: risk === 'destructive' ? 'destructive' : 'sensitive',
        summary,
        ...(command ? { command } : {}),
        ...(params.reason && typeof params.reason === 'string' ? { reason: params.reason } : {}),
        resolve,
      });
    });
    emit('permission.requested', {
      requestId,
      action,
      summary,
      ...(command ? { command } : {}),
      ...(params.reason && typeof params.reason === 'string' ? { reason: params.reason } : {}),
      risk: risk === 'destructive' ? 'destructive' : 'sensitive',
    });
    const approved = await pending;
    active.client.respond(request.id, {
      decision: approvalDecision(approved, risk === 'destructive'),
    });
  }

  private async authorizeRuntimeAction(
    active: ActiveCodexTask,
    permission: string,
    resource: string,
    action: string,
  ): Promise<boolean> {
    if (!active.runtimeAuthToken) return true;
    try {
      const response = await fetch(`${this.options.apiBaseUrl}/v1/runtime/codex/authorize`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${active.runtimeAuthToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ permission, action, resource }),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async finalize(
    input: {
      taskId: string;
      prompt: string;
      modelId: string;
      workspaceId: string;
      agentSessionId: string;
      budget: TaskBudget;
    },
    active: ActiveCodexTask,
    status: 'completed' | 'failed' | 'cancelled',
    emit: (type: AgentEvent['type'], payload: Record<string, unknown>) => void,
  ): Promise<IpcTaskResult> {
    if (status === 'cancelled') {
      const gitDiff = await this.options.git.diffFromBaseline(active.baseline);
      return IpcTaskResultSchema.parse({
        taskId: input.taskId,
        state: 'CANCELLED',
        summary: 'Codex task cancelled',
        gitDiff,
        verification: {
          status: 'cancelled',
          summary: 'Verification cancelled',
          stdout: '',
          stderr: '',
        },
        unresolvedIssues: ['The task was cancelled before completion.'],
        usageReceipts: active.usageReceipts,
        usageSummary: emptyUsageSummary(active.usageReceipts),
      });
    }
    if (status === 'failed') {
      const gitDiff = await this.options.git.diffFromBaseline(active.baseline);
      return IpcTaskResultSchema.parse({
        taskId: input.taskId,
        state: 'FAILED',
        summary: 'Codex reported a failed turn',
        gitDiff,
        verification: {
          status: 'unavailable',
          summary: 'Verification was not reached',
          stdout: '',
          stderr: '',
        },
        unresolvedIssues: ['Codex did not complete the requested turn.'],
        usageReceipts: active.usageReceipts,
        usageSummary: emptyUsageSummary(active.usageReceipts),
      });
    }
    emit('verification.started', { summary: 'Running Astra completion verification' });
    const verification = await verifyProject(
      this.options.workspace.canonical,
      new AbortController().signal,
    );
    const gitDiff = await this.options.git.diffFromBaseline(active.baseline);
    const result = IpcTaskResultSchema.parse({
      taskId: input.taskId,
      state: verification.status === 'passed' ? 'COMPLETED' : 'BLOCKED',
      summary:
        verification.status === 'passed'
          ? 'Codex completed the task and verification passed'
          : 'Codex finished, but Astra verification did not pass',
      gitDiff,
      verification: {
        status: verification.status,
        ...(verification.command ? { command: verification.command } : {}),
        summary: verification.summary,
        stdout: verification.result?.stdout ?? '',
        stderr: verification.result?.stderr ?? '',
      },
      unresolvedIssues:
        verification.status === 'passed' ? [] : ['Required project verification did not pass.'],
      usageReceipts: active.usageReceipts,
      usageSummary: emptyUsageSummary(active.usageReceipts),
    });
    emit(verification.status === 'passed' ? 'verification.passed' : 'verification.completed', {
      summary: verification.summary,
    });
    emit(verification.status === 'passed' ? 'task.completed' : 'task.blocked', {
      summary: result.summary,
    });
    return result;
  }
}

function emptyUsageSummary(receipts: UsageReceipt[]) {
  const sum = (field: keyof UsageReceipt): number | null => {
    const values = receipts
      .map((receipt) => receipt[field])
      .filter((value): value is number => typeof value === 'number');
    return values.length > 0 ? values.reduce((total, value) => total + value, 0) : null;
  };
  return {
    requestCount: receipts.length,
    inputTokens: sum('inputTokens'),
    outputTokens: sum('outputTokens'),
    cacheReadTokens: sum('cacheReadTokens'),
    cacheWriteTokens: sum('cacheWriteTokens'),
    reasoningUnits: sum('reasoningUnits'),
    otherBillableUnits: sum('otherBillableUnits'),
    actualCostUsd: sum('actualCostUsd'),
  };
}
