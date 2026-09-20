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

export const AgentEventSchema = z.discriminatedUnion('type', [
  SummaryEventSchema,
  ModelRequestedEventSchema,
  ToolRequestedEventSchema,
  PermissionEventSchema,
  FileReadEventSchema,
  PatchEventSchema,
  PatchRollbackEventSchema,
  CommandEventSchema,
  VerificationFailedEventSchema,
  RepairStartedEventSchema,
  UsageReceivedEventSchema,
  TerminalEventSchema,
]);
export type AgentEvent = z.infer<typeof AgentEventSchema>;
