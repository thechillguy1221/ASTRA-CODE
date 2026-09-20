import type {
  AgentEvent,
  GitBaseline,
  GitDiff,
  ModelRequest,
  ModelStreamEvent,
  TaskBudget,
  TaskState,
  UsageReceipt,
  UsageSummary,
} from '@lyntar/contracts';
import type { SessionStore } from './session.js';

export interface WorkspaceSearchResult {
  path: string;
  line: number;
  text: string;
}

export interface WorkspacePort {
  readFile(relativePath: string): Promise<string>;
  search(query: string): Promise<WorkspaceSearchResult[]>;
}

export interface FilePatch {
  path: string;
  content: string;
}

export interface PatchPort {
  apply(
    batch: { files: FilePatch[] },
    signal: AbortSignal,
  ): Promise<{ paths: string[]; rolledBack: boolean }>;
}

export interface CommandRequest {
  executable: string;
  args: string[];
  cwdRelative: string;
  approved?: boolean;
}

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  originalEstimatedSize?: number;
}

export interface CommandPort {
  run(request: CommandRequest, signal: AbortSignal): Promise<CommandResult>;
}

export interface GitPort {
  captureBaseline(): Promise<GitBaseline>;
  diffFromBaseline(baseline: GitBaseline): Promise<GitDiff>;
}

export interface VerificationResult {
  status: 'passed' | 'failed' | 'unavailable' | 'cancelled';
  command?: string;
  summary: string;
  stdout: string;
  stderr: string;
}

export interface VerificationPort {
  verify(signal: AbortSignal): Promise<VerificationResult>;
}

export type PermissionAction =
  | { kind: 'readFile'; path: string; summary: string }
  | { kind: 'search'; query: string; summary: string }
  | { kind: 'patch'; paths: string[]; summary: string }
  | { kind: 'command'; request: CommandRequest; summary: string };

export type PermissionOutcome =
  | { kind: 'allow'; reason: string }
  | { kind: 'request'; reason: string; risk?: 'sensitive' | 'destructive' }
  | { kind: 'deny'; reason: string };

export interface PermissionPort {
  evaluate(action: PermissionAction): Promise<PermissionOutcome>;
}

export interface EventPort {
  append(event: AgentEvent): Promise<void> | void;
}

export interface ModelPort {
  complete(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent>;
}

export interface ReceiptPort {
  add(receipt: UsageReceipt): void;
  list(taskId?: string): UsageReceipt[];
}

export interface SessionPort {
  store: SessionStore;
  userId: string | (() => string);
}

export interface AgentPorts {
  model: ModelPort;
  workspace: WorkspacePort;
  patch: PatchPort;
  command: CommandPort;
  git: GitPort;
  verification: VerificationPort;
  event: EventPort;
  permission: PermissionPort;
  receipts: ReceiptPort;
  session?: SessionPort;
}

export interface StartTaskInput {
  taskId: string;
  workspaceId: string;
  agentSessionId?: string;
  prompt: string;
  modelId: string;
  budget: TaskBudget;
  signal?: AbortSignal;
}

export interface TaskResult {
  taskId: string;
  state: TaskState;
  summary: string;
  events: AgentEvent[];
  gitDiff: GitDiff;
  verification: VerificationResult;
  unresolvedIssues: string[];
  usageReceipts: UsageReceipt[];
  usageSummary: UsageSummary;
}
