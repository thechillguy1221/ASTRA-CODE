import { z } from 'zod';

export const UsageReceiptSchema = z.object({
  id: z.string().uuid().optional(),
  requestId: z.string().min(1),
  gatewayRequestId: z.string().min(1).nullable().optional(),
  taskId: z.string().min(1),
  agentTaskId: z.string().min(1).nullable().optional(),
  agentSessionId: z.string().min(1).nullable().optional(),
  modelId: z.string().min(1),
  gatewayModelId: z.string().min(1).nullable().optional(),
  provider: z.string().min(1).nullable().optional(),
  providerRoute: z.string().min(1),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  cacheTokens: z.number().int().nonnegative().nullable(),
  cacheReadTokens: z.number().int().nonnegative().nullable().optional(),
  cacheWriteTokens: z.number().int().nonnegative().nullable().optional(),
  reasoningUnits: z.number().nonnegative().nullable().optional(),
  otherBillableUnits: z.number().nonnegative().nullable().optional(),
  actualCostUsd: z.number().finite().nonnegative().nullable(),
  calculatedExpectedCostUsd: z.number().finite().nonnegative().nullable().optional(),
  costDifferenceUsd: z.number().finite().nullable().optional(),
  billingAnomaly: z.boolean().optional(),
  receivedAt: z.string().datetime(),
  createdAt: z.string().datetime().optional(),
});
export type UsageReceipt = z.infer<typeof UsageReceiptSchema>;

export const UsageSummarySchema = z.object({
  requestCount: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  cacheReadTokens: z.number().int().nonnegative().nullable(),
  cacheWriteTokens: z.number().int().nonnegative().nullable(),
  reasoningUnits: z.number().nonnegative().nullable(),
  otherBillableUnits: z.number().nonnegative().nullable(),
  actualCostUsd: z.number().finite().nonnegative().nullable(),
});
export type UsageSummary = z.infer<typeof UsageSummarySchema>;
