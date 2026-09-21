import { z } from 'zod';

const Id = z.string().min(1).max(200);
const IsoDate = z.string().datetime({ offset: true });

export const SpecStatusSchema = z.enum([
  'DRAFT',
  'READY',
  'EXECUTING',
  'REVIEW',
  'VERIFIED',
  'BLOCKED',
  'CANCELLED',
]);
export type SpecStatus = z.infer<typeof SpecStatusSchema>;
export const SpecRequirementsSchema = z.object({
  objective: z.string().min(1),
  userStories: z.array(z.string()),
  functional: z.array(z.string()),
  nonFunctional: z.array(z.string()),
  security: z.array(z.string()),
  compatibility: z.array(z.string()),
  acceptanceCriteria: z.array(z.string()),
  nonGoals: z.array(z.string()),
});
export type SpecRequirements = z.infer<typeof SpecRequirementsSchema>;
export const SpecDesignSchema = z.object({
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
export type SpecDesign = z.infer<typeof SpecDesignSchema>;
export const SpecExecutionStateSchema = z.enum([
  'NOT_STARTED',
  'RUNNING',
  'PAUSED',
  'COMPLETED',
  'FAILED',
]);
export type SpecExecutionState = z.infer<typeof SpecExecutionStateSchema>;
export const SpecVerificationStateSchema = z.enum([
  'NOT_RUN',
  'RUNNING',
  'PASSED',
  'FAILED',
  'BLOCKED',
]);
export type SpecVerificationState = z.infer<typeof SpecVerificationStateSchema>;
export const SpecSchema = z.object({
  id: Id,
  slug: Id,
  title: z.string().min(1),
  ownerId: Id,
  repositoryId: Id.nullable(),
  status: SpecStatusSchema,
  version: z.number().int().positive(),
  requirements: SpecRequirementsSchema,
  design: SpecDesignSchema,
  taskIds: z.array(Id),
  dependencyIds: z.array(Id),
  executionState: SpecExecutionStateSchema,
  verificationState: SpecVerificationStateSchema,
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type Spec = z.infer<typeof SpecSchema>;

export const AgentRoleSchema = z.enum([
  'LEAD',
  'BACKEND',
  'FRONTEND',
  'TEST',
  'RESEARCH',
  'REVIEWER',
  'SECURITY',
  'INTEGRATION',
  'DOCUMENTATION',
]);
export type AgentRole = z.infer<typeof AgentRoleSchema>;
export const AgentDefinitionSchema = z.object({
  id: Id,
  name: z.string().min(1),
  role: AgentRoleSchema,
  description: z.string(),
  allowedTools: z.array(Id),
  allowedTargets: z.array(z.enum(['LOCAL_DEVICE', 'REMOTE_DEVICE', 'ROOM_HOST', 'ASTRA_CLOUD'])),
  maxParallelTasks: z.number().int().positive(),
  enabled: z.boolean(),
  version: z.number().int().positive(),
});
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;

export const TaskStatusSchema = z.enum([
  'PENDING',
  'READY',
  'RUNNING',
  'BLOCKED',
  'REVIEW',
  'FAILED',
  'SUCCEEDED',
  'CANCELLED',
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export const VerificationStatusSchema = z.enum([
  'NOT_RUN',
  'RUNNING',
  'PASSED',
  'FAILED',
  'BLOCKED',
]);
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;
export const TaskBudgetSchema = z.object({
  maxCredits: z.string().regex(/^\d+(?:\.\d+)?$/),
  maxModelCalls: z.number().int().positive(),
  maxParallelAgents: z.number().int().positive(),
  maxWallTimeMs: z.number().int().positive(),
});
export type TaskBudget = z.infer<typeof TaskBudgetSchema>;
export const SpecTaskSchema = z.object({
  id: Id,
  specId: Id,
  title: z.string().min(1),
  description: z.string(),
  ownerAgentRole: AgentRoleSchema,
  dependencies: z.array(Id),
  affectedAreas: z.array(z.string()),
  complexity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  status: TaskStatusSchema,
  verificationStatus: VerificationStatusSchema,
  assignedAgentId: Id.nullable(),
  worktreeId: Id.nullable(),
  budget: TaskBudgetSchema,
  leaseId: Id.nullable(),
  leaseExpiresAt: IsoDate.nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type SpecTask = z.infer<typeof SpecTaskSchema>;

export const WorktreeRecordSchema = z.object({
  id: Id,
  taskId: Id,
  repositoryRoot: z.string().min(1),
  worktreeRoot: z.string().min(1),
  path: z.string().min(1),
  branch: z.string().regex(/^astra\/task\/[a-z0-9][a-z0-9/_-]{0,80}$/),
  baseRevision: z.string().min(1),
  status: z.enum(['ACTIVE', 'MERGED', 'DISCARDED', 'CONFLICTED']),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type WorktreeRecord = z.infer<typeof WorktreeRecordSchema>;
export const CheckpointSchema = z.object({
  id: Id,
  specId: Id,
  taskId: Id.nullable(),
  reason: z.string().min(1),
  revision: z.string().nullable(),
  worktreeId: Id.nullable(),
  state: z.record(z.unknown()),
  createdAt: IsoDate,
});
export type Checkpoint = z.infer<typeof CheckpointSchema>;
export const ReviewFindingSchema = z.object({
  id: Id,
  specId: Id,
  taskId: Id.nullable(),
  reviewerRole: z.enum(['REVIEWER', 'SECURITY']),
  severity: z.enum(['BLOCKER', 'HIGH', 'MEDIUM', 'LOW', 'INFO']),
  title: z.string().min(1),
  evidence: z.string().min(1),
  affectedCode: z.array(z.string()),
  remediation: z.string(),
  status: z.enum(['OPEN', 'RESOLVED', 'WAIVED']),
  createdAt: IsoDate,
  resolvedAt: IsoDate.nullable(),
});
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;
export const VerificationEvidenceSchema = z.object({
  id: Id,
  specId: Id,
  taskId: Id.nullable(),
  category: z.enum([
    'COMPILE',
    'TYPECHECK',
    'LINT',
    'FORMAT',
    'UNIT',
    'INTEGRATION',
    'DATABASE',
    'BROWSER',
    'ELECTRON',
    'SECURITY',
    'BUILD',
    'DEPLOYMENT',
    'LIVE_SMOKE',
  ]),
  command: z.string(),
  status: z.enum(['PASS', 'FAIL', 'BLOCKED', 'SKIPPED']),
  summary: z.string(),
  output: z.string(),
  correlationId: Id,
  createdAt: IsoDate,
});
export type VerificationEvidence = z.infer<typeof VerificationEvidenceSchema>;

export const SteeringDocumentSchema = z.object({
  id: Id,
  projectId: Id,
  scope: z.enum(['PRODUCT', 'ARCHITECTURE', 'SECURITY', 'CODING', 'TESTING', 'UI', 'DEPLOYMENT']),
  title: z.string().min(1),
  content: z.string().min(1),
  version: z.number().int().positive(),
  enabled: z.boolean(),
  updatedBy: Id,
  updatedAt: IsoDate,
});
export type SteeringDocument = z.infer<typeof SteeringDocumentSchema>;
export const MemoryEntrySchema = z.object({
  id: Id,
  projectId: Id,
  kind: z.enum(['DECISION', 'CONVENTION', 'CONSTRAINT', 'ENVIRONMENT', 'CORRECTION']),
  title: z.string().min(1),
  content: z.string().min(1),
  provenance: z.enum(['USER', 'REVIEWED_AGENT', 'SYSTEM']),
  sourceTaskId: Id.nullable(),
  confidence: z.enum(['CONFIRMED', 'PROVISIONAL']),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;
export const HookSchema = z.object({
  id: Id,
  projectId: Id,
  event: z.enum([
    'TASK_CREATED',
    'AGENT_STARTED',
    'BEFORE_TOOL_CALL',
    'AFTER_TOOL_CALL',
    'FILE_CHANGED',
    'COMMAND_COMPLETED',
    'TEST_COMPLETED',
    'TASK_COMPLETED',
    'BEFORE_MERGE',
    'AFTER_MERGE',
  ]),
  kind: z.enum(['COMMAND', 'POLICY', 'AGENT']),
  name: z.string().min(1),
  policy: z.enum(['ALLOW', 'ASK', 'DENY']),
  timeoutMs: z.number().int().positive(),
  enabled: z.boolean(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type Hook = z.infer<typeof HookSchema>;
export const AutomationSchema = z.object({
  id: Id,
  ownerId: Id,
  projectId: Id.nullable(),
  name: z.string().min(1),
  trigger: z.object({ kind: z.enum(['CRON', 'EVENT']), expression: z.string().min(1) }),
  enabled: z.boolean(),
  maxParallelRuns: z.number().int().positive(),
  lastRunAt: IsoDate.nullable(),
  nextRunAt: IsoDate.nullable(),
  lastResult: z.enum(['SUCCEEDED', 'FAILED', 'BLOCKED']).nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
});
export type Automation = z.infer<typeof AutomationSchema>;
export const PluginManifestSchema = z.object({
  id: Id,
  name: z.string().min(1),
  version: z.string().min(1),
  skillIds: z.array(Id),
  mcpServerIds: z.array(Id),
  permissions: z.array(Id),
  enabled: z.boolean(),
});
export type PluginManifest = z.infer<typeof PluginManifestSchema>;
export const SkillManifestSchema = z.object({
  id: Id,
  name: z.string().min(1),
  version: z.string().min(1),
  source: z.enum(['BUILT_IN', 'USER', 'PROJECT', 'ORGANIZATION', 'ROOM']),
  dependencies: z.array(Id),
  requiredPermissions: z.array(Id),
  enabled: z.boolean(),
});
export type SkillManifest = z.infer<typeof SkillManifestSchema>;
export const McpServerPolicySchema = z.object({
  id: Id,
  name: z.string().min(1),
  transport: z.enum(['STDIO', 'SSE', 'STREAMABLE_HTTP']),
  allowedTools: z.array(Id),
  enabled: z.boolean(),
  timeoutMs: z.number().int().positive(),
  organizationIds: z.array(Id),
  roomIds: z.array(Id),
});
export type McpServerPolicy = z.infer<typeof McpServerPolicySchema>;
export const ToolPermissionSchema = z.object({
  subjectId: Id,
  scope: z.enum(['USER', 'ORGANIZATION', 'ROOM', 'AGENT']),
  capability: Id,
  decision: z.enum(['ALLOW', 'ASK', 'DENY']),
  allowedDomains: z.array(z.string()),
  updatedAt: IsoDate,
});
export type ToolPermission = z.infer<typeof ToolPermissionSchema>;
export const ExecutionTargetSchema = z.enum([
  'LOCAL_DEVICE',
  'REMOTE_DEVICE',
  'ROOM_HOST',
  'ASTRA_CLOUD',
]);
export type ExecutionTarget = z.infer<typeof ExecutionTargetSchema>;
export const ModelRouteSchema = z.object({
  modelId: Id,
  routeClass: z.enum(['FAST', 'STANDARD', 'DEEP', 'REVIEW', 'SECURITY']),
  fallbackModelIds: z.array(Id),
  estimatedCredits: z.string().regex(/^\d+(?:\.\d+)?$/),
  enabled: z.boolean(),
  planIds: z.array(Id),
});
export type ModelRoute = z.infer<typeof ModelRouteSchema>;
export const PlatformEventSchema = z.object({
  id: Id,
  kind: z.string().min(1),
  entityId: Id,
  actorId: Id.nullable(),
  correlationId: Id,
  payload: z.record(z.unknown()),
  createdAt: IsoDate,
});
export type PlatformEvent = z.infer<typeof PlatformEventSchema>;
export const PlatformEntityKindSchema = z.enum([
  'SPEC',
  'TASK',
  'AGENT',
  'WORKTREE',
  'CHECKPOINT',
  'REVIEW',
  'VERIFICATION',
  'STEERING',
  'MEMORY',
  'HOOK',
  'AUTOMATION',
  'PLUGIN',
  'SKILL',
  'MCP_SERVER',
  'PERMISSION',
  'MODEL_ROUTE',
]);
export type PlatformEntityKind = z.infer<typeof PlatformEntityKindSchema>;
export interface PlatformRecord {
  kind: PlatformEntityKind;
  id: string;
  ownerId: string;
  version: number;
  status: string;
  payload: unknown;
  createdAt: string;
  updatedAt: string;
}
export type PlatformEntity =
  | Spec
  | SpecTask
  | AgentDefinition
  | WorktreeRecord
  | Checkpoint
  | ReviewFinding
  | VerificationEvidence
  | SteeringDocument
  | MemoryEntry
  | Hook
  | Automation
  | PluginManifest
  | SkillManifest
  | McpServerPolicy
  | ToolPermission
  | ModelRoute;
