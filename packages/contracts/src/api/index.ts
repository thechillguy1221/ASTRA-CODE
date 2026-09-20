import { z } from 'zod';
import { AgentEventSchema } from '../agent-events/index.js';
import { ModelCatalogEntrySchema } from '../domain/model.js';
import { UsageReceiptSchema } from '../domain/usage.js';

export const ModelCatalogResponseSchema = z.object({
  models: z.array(ModelCatalogEntrySchema),
});
export type ModelCatalogResponse = z.infer<typeof ModelCatalogResponseSchema>;

export const ModelMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
});
export type ModelMessage = z.infer<typeof ModelMessageSchema>;

export const ModelRequestSchema = z.object({
  requestId: z.string().min(1),
  taskId: z.string().min(1),
  agentSessionId: z.string().min(1).optional(),
  modelId: z.string().min(1),
  messages: z.array(ModelMessageSchema).min(1),
});
export type ModelRequest = z.infer<typeof ModelRequestSchema>;

export const ModelDecisionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('message'), summary: z.string().min(1) }),
  z.object({
    kind: z.literal('readFile'),
    path: z.string().min(1),
    summary: z.string().min(1),
  }),
  z.object({
    kind: z.literal('search'),
    query: z.string().min(1),
    summary: z.string().min(1),
  }),
  z.object({
    kind: z.literal('patch'),
    summary: z.string().min(1),
    files: z.array(z.object({ path: z.string().min(1), content: z.string() })).min(1),
  }),
  z.object({
    kind: z.literal('command'),
    summary: z.string().min(1),
    executable: z.string().min(1),
    args: z.array(z.string()),
    cwdRelative: z.string().default('.'),
  }),
  z.object({ kind: z.literal('finish'), summary: z.string().min(1) }),
]);
export type ModelDecision = z.infer<typeof ModelDecisionSchema>;

export const ModelStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('decision'), decision: ModelDecisionSchema }),
  z.object({ type: z.literal('usage'), receipt: UsageReceiptSchema }),
  z.object({ type: z.literal('provider'), providerRequestId: z.string().min(1) }),
  z.object({ type: z.literal('event'), event: AgentEventSchema }),
]);
export type ModelStreamEvent = z.infer<typeof ModelStreamEventSchema>;

export const ModelDecisionResponseSchema = z.object({
  decision: ModelDecisionSchema,
  usage: UsageReceiptSchema.nullable(),
  providerRequestId: z.string().min(1).nullable().optional(),
});
export type ModelDecisionResponse = z.infer<typeof ModelDecisionResponseSchema>;
