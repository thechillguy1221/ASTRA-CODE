import { z } from 'zod';

const EventBaseSchema = z.object({
  eventId: z.string().min(1),
  taskId: z.string().min(1),
  occurredAt: z.string().datetime(),
});

const SummaryEventSchema = EventBaseSchema.extend({
  type: z.enum([
    'task.started',
    'analysis.started',
    'model.streaming',
    'model.completed',
    'verification.started',
    'verification.completed',
    'verification.passed',
    'task.completed',
  ]),
  payload: z.object({ summary: z.string().min(1) }),
});

const ModelRequestedEventSchema = EventBaseSchema.extend({
  type: z.literal('model.requested'),
  payload: z.object({ modelId: z.string().min(1), requestId: z.string().min(1) }),
});

const ToolRequestedEventSchema = EventBaseSchema.extend({
  type: z.literal('tool.requested'),
  payload: z.object({ tool: z.string().min(1), summary: z.string().min(1) }),
});

const PermissionEventSchema = EventBaseSchema.extend({
  type: z.enum(['permission.requested', 'permission.granted', 'permission.denied']),
  payload: z.object({
    requestId: z.string().min(1),
    action: z.string().min(1),
    summary: z.string().min(1).optional(),
    reason: z.string().min(1).optional(),
    command: z.string().min(1).optional(),
    risk: z.enum(['sensitive', 'destructive']).optional(),
  }),
});

const FileReadEventSchema = EventBaseSchema.extend({
  type: z.literal('file.read'),
  payload: z.object({ path: z.string().min(1) }),
});

const PatchEventSchema = EventBaseSchema.extend({
  type: z.enum(['patch.started', 'patch.applied']),
  payload: z.object({ paths: z.array(z.string()), fileCount: z.number().int().positive() }),
});

const PatchRollbackEventSchema = EventBaseSchema.extend({
  type: z.literal('patch.rolled_back'),
  payload: z.object({ paths: z.array(z.string()), fileCount: z.number().int().positive() }),
});

const UsageReceivedEventSchema = EventBaseSchema.extend({
  type: z.literal('usage.received'),
  payload: z.object({
    requestId: z.string().min(1),
    actualCostUsd: z.number().nonnegative().nullable(),
    creditsUsed: z.string().min(1).optional(),
  }),
});

const CommandEventSchema = EventBaseSchema.extend({
  type: z.enum(['command.started', 'command.completed']),
  payload: z.object({
    command: z.string().min(1),
    exitCode: z.number().int().nullable().optional(),
  }),
});

const VerificationFailedEventSchema = EventBaseSchema.extend({
  type: z.literal('verification.failed'),
  payload: z.object({ command: z.string().min(1), summary: z.string().min(1) }),
});

const RepairStartedEventSchema = EventBaseSchema.extend({
  type: z.literal('repair.started'),
  payload: z.object({ attempt: z.number().int().positive(), summary: z.string().min(1) }),
});

const TerminalEventSchema = EventBaseSchema.extend({
  type: z.enum(['task.cancelled', 'task.failed', 'task.blocked']),
  payload: z.object({ summary: z.string().min(1) }),
});

const ModelChangedEventSchema = EventBaseSchema.extend({
  type: z.literal('model.changed'),
  payload: z.object({
    fromModelId: z.string().min(1),
    toModelId: z.string().min(1),
    sessionId: z.string().min(1).optional(),
  }),
});

const CheckpointCreatedEventSchema = EventBaseSchema.extend({
  type: z.literal('checkpoint.created'),
  payload: z.object({
    checkpointId: z.string().min(1),
    sessionId: z.string().min(1).optional(),
    reason: z.string().min(1),
  }),
});

const SessionPausedEventSchema = EventBaseSchema.extend({
  type: z.literal('session.paused'),
  payload: z.object({
    sessionId: z.string().min(1),
    reason: z.string().min(1).optional(),
  }),
});

const SessionResumedEventSchema = EventBaseSchema.extend({
  type: z.literal('session.resumed'),
  payload: z.object({
    sessionId: z.string().min(1),
    fromCheckpointId: z.string().min(1).optional(),
  }),
});

const CreditEventSchema = EventBaseSchema.extend({
  type: z.enum(['credit.reserved', 'credit.settled', 'credit.released']),
  payload: z.object({
    amountCredits: z.string().min(1),
    reservationId: z.string().min(1).optional(),
    taskId: z.string().min(1).optional(),
  }),
});

const UserApprovalEventSchema = EventBaseSchema.extend({
  type: z.literal('user.approval'),
  payload: z.object({
    requestId: z.string().min(1),
    action: z.string().min(1),
    approved: z.boolean(),
  }),
});

const ErrorEventSchema = EventBaseSchema.extend({
  type: z.literal('session.error'),
  payload: z.object({
    message: z.string().min(1),
    code: z.string().min(1).optional(),
    recoverable: z.boolean().optional(),
  }),
});

const SessionCompletedEventSchema = EventBaseSchema.extend({
  type: z.literal('session.completed'),
  payload: z.object({
    sessionId: z.string().min(1),
    summary: z.string().min(1),
  }),
});

const FileCreatedEventSchema = EventBaseSchema.extend({
  type: z.literal('file.created'),
  payload: z.object({ path: z.string().min(1) }),
});

const FileDeletedEventSchema = EventBaseSchema.extend({
  type: z.literal('file.deleted'),
  payload: z.object({ path: z.string().min(1) }),
});

const TestResultEventSchema = EventBaseSchema.extend({
  type: z.literal('test.result'),
  payload: z.object({
    command: z.string().min(1),
    passed: z.boolean(),
    summary: z.string().min(1),
    exitCode: z.number().int().nullable(),
  }),
});

const BuildResultEventSchema = EventBaseSchema.extend({
  type: z.literal('build.result'),
  payload: z.object({
    command: z.string().min(1),
    passed: z.boolean(),
    summary: z.string().min(1),
    exitCode: z.number().int().nullable(),
  }),
});

const LintResultEventSchema = EventBaseSchema.extend({
  type: z.literal('lint.result'),
  payload: z.object({
    command: z.string().min(1),
    passed: z.boolean(),
    summary: z.string().min(1),
    issueCount: z.number().int().nonnegative().optional(),
  }),
});

export const AgentEventSchema = z.discriminatedUnion('type', [
  SummaryEventSchema,
  ModelRequestedEventSchema,
  ToolRequestedEventSchema,
  PermissionEventSchema,
  FileReadEventSchema,
  FileCreatedEventSchema,
  FileDeletedEventSchema,
  PatchEventSchema,
  PatchRollbackEventSchema,
  CommandEventSchema,
  VerificationFailedEventSchema,
  RepairStartedEventSchema,
  UsageReceivedEventSchema,
  TerminalEventSchema,
  ModelChangedEventSchema,
  CheckpointCreatedEventSchema,
  SessionPausedEventSchema,
  SessionResumedEventSchema,
  CreditEventSchema,
  UserApprovalEventSchema,
  ErrorEventSchema,
  SessionCompletedEventSchema,
  TestResultEventSchema,
  BuildResultEventSchema,
  LintResultEventSchema,
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;
