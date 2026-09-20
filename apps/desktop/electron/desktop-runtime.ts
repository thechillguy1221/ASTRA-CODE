import { randomUUID } from 'node:crypto';
import {
  AgentTaskRunner,
  type AgentPorts,
  type ModelPort,
  type PermissionAction,
  type PermissionOutcome,
} from '@lyntar/agent-core';
import {
  IpcTaskResultSchema,
  ModelCatalogEntrySchema,
  ModelCatalogResponseSchema,
  ModelDecisionResponseSchema,
  type AgentEvent,
  type IpcTaskResult,
  type ModelCatalogEntry,
  type ModelRequest,
  type ModelStreamEvent,
  type WorkspaceDescriptor,
} from '@lyntar/contracts';
import {
  classifyCommand,
  GitWorkspace,
  LocalCommandRunner,
  LocalWorkspace,
  verifyProject,
} from '@lyntar/workspace';

class ApiModelPort implements ModelPort {
  constructor(private readonly apiBaseUrl: string) {}

  async *complete(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent> {
    const response = await fetch(`${this.apiBaseUrl}/v1/model-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
    if (!response.ok) throw new Error(`Lyntar API model request failed with ${response.status}`);
    const body = ModelDecisionResponseSchema.parse(await response.json());
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

export class DesktopRuntime {
  private workspace: LocalWorkspace | undefined;
  private git: GitWorkspace | undefined;
  private descriptor: WorkspaceDescriptor | undefined;
  private runner: AgentTaskRunner | undefined;
  private agentSessionId = randomUUID();
  private readonly listeners = new Set<(event: AgentEvent) => void>();
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
  ) {}

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
    this.agentSessionId = randomUUID();
    this.descriptor = {
      workspaceId: randomUUID(),
      displayName: root.split(/[\\/]/).at(-1) ?? root,
      canonicalRoot: workspace.canonical.root,
      selectedAt: new Date().toISOString(),
    };
    this.runner = new AgentTaskRunner({
      model: new ApiModelPort(this.apiBaseUrl),
      workspace,
      patch: { apply: (batch, signal) => workspace.writeBatch(batch, signal) },
      command: {
        run: (request, signal) => new LocalCommandRunner(workspace.canonical).run(request, signal),
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
            throw new Error(`Lyntar event persistence failed with ${response.status}`);
        },
      },
      permission: new DesktopPermissionPort(),
      receipts: this.receipts,
    });
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

  async listModels(): Promise<ModelCatalogEntry[]> {
    const response = await fetch(`${this.apiBaseUrl}/v1/models`);
    if (!response.ok) throw new Error(`Lyntar API model catalog failed with ${response.status}`);
    const body = ModelCatalogResponseSchema.parse(await response.json());
    return body.models.map((model) => ModelCatalogEntrySchema.parse(model));
  }

  async startTask(input: {
    taskId: string;
    prompt: string;
    modelId: string;
    budget: Parameters<AgentTaskRunner['start']>[0]['budget'];
  }): Promise<IpcTaskResult> {
    if (!this.runner) throw new Error('Open a workspace first');
    if (!this.descriptor) throw new Error('Open a workspace first');
    return IpcTaskResultSchema.parse(
      await this.runner.start({
        ...input,
        workspaceId: this.descriptor.workspaceId,
        agentSessionId: this.agentSessionId,
      }),
    );
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
