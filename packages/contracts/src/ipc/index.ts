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

export const DesktopDeviceSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  label: z.string().min(1),
  platform: z.string().min(1),
  architecture: z.string().min(1),
  publicKeyFingerprint: z.string().min(1),
  credentialVersion: z.number().int().positive(),
  createdAt: z.string().datetime(),
  lastSeenAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
});
export type DesktopDevice = z.infer<typeof DesktopDeviceSchema>;

export const DesktopRoomSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  hostUserId: z.string().uuid(),
  hostDeviceId: z.string().uuid(),
  name: z.string().min(1),
  workspaceRootRelative: z.string().min(1),
  projectId: z.string().uuid(),
  workspaceFingerprint: z.string().nullable(),
  hostAvailability: z.enum([
    'ONLINE',
    'OFFLINE',
    'UNAVAILABLE',
    'REVOKED',
    'DISCONNECTED',
    'UNKNOWN',
  ]),
  hostBindingVersion: z.number().int().positive(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'CLOSED']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DesktopRoom = z.infer<typeof DesktopRoomSchema>;

const DesktopSpecRequirementsSchema = z.object({
  objective: z.string(),
  userStories: z.array(z.string()),
  functional: z.array(z.string()),
  nonFunctional: z.array(z.string()),
  security: z.array(z.string()),
  compatibility: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
  nonGoals: z.array(z.string()),
});
const DesktopSpecDesignSchema = z.object({
  architecture: z.string(),
  components: z.array(z.string()),
  dataModel: z.array(z.string()),
  apiChanges: z.array(z.string()),
  flows: z.array(z.string()),
  authorization: z.array(z.string()),
  security: z.array(z.string()),
  failureModes: z.array(z.string()),
  migrations: z.array(z.string()),
  observability: z.array(z.string()),
  testing: z.array(z.string()),
  rollback: z.array(z.string()),
});
export const DesktopSpecSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  title: z.string().min(1),
  ownerId: z.string().min(1),
  repositoryId: z.string().nullable(),
  status: z.string().min(1),
  version: z.number().int().positive(),
  requirements: DesktopSpecRequirementsSchema,
  design: DesktopSpecDesignSchema,
  taskIds: z.array(z.string()),
  dependencyIds: z.array(z.string()),
  executionState: z.string().min(1),
  verificationState: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DesktopSpec = z.infer<typeof DesktopSpecSchema>;
export const DesktopSpecTaskSchema = z.object({
  id: z.string().min(1),
  specId: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  ownerAgentRole: z.string().min(1),
  dependencies: z.array(z.string()),
  affectedAreas: z.array(z.string()),
  complexity: z.string().min(1),
  status: z.string().min(1),
  verificationStatus: z.string().min(1),
  assignedAgentId: z.string().nullable(),
  worktreeId: z.string().nullable(),
  budget: z.object({
    maxCredits: z.string(),
    maxModelCalls: z.number(),
    maxParallelAgents: z.number(),
    maxWallTimeMs: z.number(),
  }),
});
export type DesktopSpecTask = z.infer<typeof DesktopSpecTaskSchema>;
export const DesktopSpecDetailsSchema = z.object({
  spec: DesktopSpecSchema,
  tasks: z.array(DesktopSpecTaskSchema),
  events: z.array(z.record(z.unknown())),
  verified: z.boolean(),
});
export type DesktopSpecDetails = z.infer<typeof DesktopSpecDetailsSchema>;

export const DesktopRoomFileSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  roomId: z.string().uuid(),
  uploaderUserId: z.string().uuid(),
  originalName: z.string().min(1),
  safeName: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  checksumSha256: z.string().length(64),
  intent: z.enum(['REFERENCE', 'ADD_TO_PROJECT']),
  securityState: z.enum(['UPLOADED', 'VALIDATING', 'SAFE', 'REJECTED', 'DELETED']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type DesktopRoomFile = z.infer<typeof DesktopRoomFileSchema>;

const DesktopRoomFileImportEntrySchema = z.object({
  path: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  checksumSha256: z.string().length(64),
  action: z.enum(['CREATE', 'OVERWRITE', 'REJECTED']),
  reason: z.string().optional(),
});

export const DesktopRoomFileImportSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  roomId: z.string().uuid(),
  fileId: z.string().uuid(),
  requestedBy: z.string().uuid(),
  destinationRelative: z.string(),
  status: z.enum(['PREVIEW', 'APPROVED', 'REJECTED', 'IMPORTED', 'FAILED']),
  manifest: z.object({
    sourceFileId: z.string().uuid(),
    destinationRelative: z.string(),
    entries: z.array(DesktopRoomFileImportEntrySchema),
    createCount: z.number().int().nonnegative(),
    overwriteCount: z.number().int().nonnegative(),
    rejectedCount: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
  }),
  approvedBy: z.string().uuid().nullable(),
  approvedAt: z.string().datetime().nullable(),
  completedBy: z.string().uuid().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DesktopRoomFileImport = z.infer<typeof DesktopRoomFileImportSchema>;

export const IpcCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('workspace.open') }),
  z.object({ type: z.literal('workspace.readFile'), relativePath: z.string().min(1) }),
  z.object({ type: z.literal('workspace.search'), query: z.string().min(1) }),
  z.object({
    type: z.literal('agent.startTask'),
    taskId: z.string().min(1),
    prompt: z.string().min(1),
    modelId: z.string().min(1),
    roomId: z.string().min(1).optional(),
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
  z.object({ type: z.literal('rooms.list') }),
  z.object({ type: z.literal('rooms.files.list'), roomId: z.string().uuid() }),
  z.object({
    type: z.literal('rooms.files.upload'),
    roomId: z.string().uuid(),
    intent: z.enum(['REFERENCE', 'ADD_TO_PROJECT']),
  }),
  z.object({
    type: z.literal('rooms.files.delete'),
    roomId: z.string().uuid(),
    fileId: z.string().uuid(),
  }),
  z.object({
    type: z.literal('rooms.files.preview'),
    roomId: z.string().uuid(),
    fileId: z.string().uuid(),
    destinationRelative: z.string().max(500),
  }),
  z.object({
    type: z.literal('rooms.files.import'),
    roomId: z.string().uuid(),
    importId: z.string().uuid(),
  }),
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

export interface AstraIpcApi {
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
      roomId?: string;
      budget: TaskBudget;
    }): Promise<IpcTaskResult>;
    cancelTask(taskId: string): Promise<void>;
    approveAction(taskId: string, requestId: string): Promise<void>;
    rejectAction(taskId: string, requestId: string): Promise<void>;
  };
  models: { list(): Promise<ModelCatalogEntry[]> };
  specs: {
    list(): Promise<DesktopSpec[]>;
    get(specId: string): Promise<DesktopSpecDetails>;
    create(input: {
      title: string;
      slug: string;
      objective: string;
      repositoryId?: string | null;
    }): Promise<DesktopSpec>;
    update(
      specId: string,
      expectedVersion: number,
      input: { requirements?: DesktopSpec['requirements']; design?: DesktopSpec['design'] },
    ): Promise<DesktopSpec>;
    transition(specId: string, to: string): Promise<DesktopSpec>;
  };
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
  devices: {
    list(): Promise<DesktopDevice[]>;
    register(): Promise<DesktopDevice>;
    revoke(deviceId: string): Promise<void>;
  };
  rooms: {
    list(): Promise<DesktopRoom[]>;
    listFiles(roomId: string): Promise<DesktopRoomFile[]>;
    uploadFile(input: {
      roomId: string;
      intent: 'REFERENCE' | 'ADD_TO_PROJECT';
    }): Promise<DesktopRoomFile | null>;
    deleteFile(roomId: string, fileId: string): Promise<void>;
    previewImport(input: {
      roomId: string;
      fileId: string;
      destinationRelative: string;
    }): Promise<DesktopRoomFileImport>;
    importFile(roomId: string, importId: string): Promise<DesktopRoomFileImport>;
  };
  events: { subscribe(listener: (event: AgentEvent) => void): () => void };
}
