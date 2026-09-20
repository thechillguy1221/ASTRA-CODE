import { z } from 'zod';
import { AgentEventSchema, type AgentEvent } from '../agent-events/index.js';
import {
  GitDiffSchema,
  LearnDepthSchema,
  TaskStateSchema,
  UsageReceiptSchema,
  UsageSummarySchema,
  VivaCategorySchema,
  VivaDifficultySchema,
  type HackathonPlan,
  type LearnDepth,
  type LearnResult,
  type ModelCatalogEntry,
  type TaskBudget,
  type VivaCategory,
  type VivaDifficulty,
  VivaQuestionSchema,
  type VivaQuestion,
  type PublicUser,
  type VivaEvaluation,
  type Wallet,
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
  z.object({
    type: z.literal('auth.login'),
    email: z.string().email(),
    password: z.string().min(1),
    device: z.object({
      label: z.string().min(1).max(120),
      platform: z.string().min(1).max(40),
      architecture: z.string().min(1).max(40),
      appVersion: z.string().min(1).max(40),
    }),
  }),
  z.object({ type: z.literal('auth.status') }),
  z.object({ type: z.literal('auth.logout') }),
  z.object({ type: z.literal('billing.wallet') }),
  z.object({
    type: z.literal('modes.learnFile'),
    path: z.string().min(1),
    depth: LearnDepthSchema,
    question: z.string().optional(),
  }),
  z.object({
    type: z.literal('modes.generateViva'),
    categories: z.array(VivaCategorySchema).min(1),
    difficulty: VivaDifficultySchema,
    count: z.number().int().min(1).max(20),
  }),
  z.object({
    type: z.literal('modes.hackathonPlan'),
    problem: z.string().min(1),
    criteria: z.array(z.string()),
  }),
  z.object({
    type: z.literal('modes.evaluateViva'),
    question: VivaQuestionSchema,
    answer: z.string(),
  }),
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
  modes: {
    learnFile(input: { path: string; depth: LearnDepth; question?: string }): Promise<LearnResult>;
    generateViva(input: {
      categories: VivaCategory[];
      difficulty: VivaDifficulty;
      count: number;
    }): Promise<VivaQuestion[]>;
    evaluateViva(input: { question: VivaQuestion; answer: string }): Promise<VivaEvaluation>;
    hackathonPlan(input: { problem: string; criteria: string[] }): Promise<HackathonPlan>;
  };
  auth: {
    login(input: {
      email: string;
      password: string;
      device: { label: string; platform: string; architecture: string; appVersion: string };
    }): Promise<PublicUser>;
    status(): Promise<PublicUser | null>;
    logout(): Promise<void>;
    googleStart(): Promise<{ authorizationUrl: string }>;
    googleComplete(code: string): Promise<PublicUser>;
    onGoogleCallback(listener: (code: string) => void): () => void;
  };
  billing: {
    wallet(): Promise<Wallet | null>;
  };
  events: { subscribe(listener: (event: AgentEvent) => void): () => void };
}
