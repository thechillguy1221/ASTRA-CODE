import { z } from 'zod';
import { AgentEventSchema, type AgentEvent } from '../agent-events/index.js';
import {
  GitDiffSchema,
  TaskStateSchema,
  UsageReceiptSchema,
  UsageSummarySchema,
  type ModelCatalogEntry,
  type TaskBudget,
  type WorkspaceDescriptor,
} from '../domain/index.js';
import { TaskBudgetSchema } from '../domain/task.js';

export const IpcCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('workspace.open') }),
  z.object({ type: z.literal('workspace.readFile'), relativePath: z.string().min(1) }),
  z.object({ type: z.literal('workspace.search'), query: z.string().min(1) }),
  z.object({
    type: z.literal('agent.startTask'),
    taskId: z.string().min(1),
    prompt: z.string().min(1),
    modelId: z.string().min(1),
    budget: TaskBudgetSchema,
  }),
  z.object({ type: z.literal('agent.cancelTask'), taskId: z.string().min(1) }),
  z.object({
    type: z.literal('agent.approveAction'),
    taskId: z.string().min(1),
    requestId: z.string().min(1),
  }),
  z.object({
    type: z.literal('agent.rejectAction'),
    taskId: z.string().min(1),
    requestId: z.string().min(1),
  }),
  z.object({ type: z.literal('models.list') }),
]);
export type IpcCommand = z.infer<typeof IpcCommandSchema>;

export const IpcEventEnvelopeSchema = z.object({
  taskId: z.string().min(1),
  event: AgentEventSchema,
});
export type IpcEventEnvelope = z.infer<typeof IpcEventEnvelopeSchema>;

export const IpcTaskResultSchema = z.object({
  taskId: z.string().min(1),
  state: TaskStateSchema,
  summary: z.string().min(1),
  gitDiff: GitDiffSchema,
  verification: z.object({
    status: z.enum(['passed', 'failed', 'unavailable', 'cancelled']),
    command: z.string().optional(),
    summary: z.string().min(1),
    stdout: z.string(),
    stderr: z.string(),
  }),
  unresolvedIssues: z.array(z.string()),
  usageReceipts: z.array(UsageReceiptSchema),
  usageSummary: UsageSummarySchema,
});
export type IpcTaskResult = z.infer<typeof IpcTaskResultSchema>;

export interface LyntarIpcApi {
  workspace: {
    open(): Promise<WorkspaceDescriptor | null>;
    readFile(relativePath: string): Promise<string>;
    search(query: string): Promise<Array<{ path: string; line: number; text: string }>>;
  };
  agent: {
    startTask(input: {
      taskId: string;
      prompt: string;
      modelId: string;
      budget: TaskBudget;
    }): Promise<IpcTaskResult>;
    cancelTask(taskId: string): Promise<void>;
    approveAction(taskId: string, requestId: string): Promise<void>;
    rejectAction(taskId: string, requestId: string): Promise<void>;
  };
  models: { list(): Promise<ModelCatalogEntry[]> };
  events: { subscribe(listener: (event: AgentEvent) => void): () => void };
}
