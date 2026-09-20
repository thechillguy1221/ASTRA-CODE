import { z } from 'zod';

export const ModelCapabilitiesSchema = z.object({
  supportsTools: z.boolean(),
  supportsStreaming: z.boolean(),
  supportsReasoning: z.boolean(),
  supportsStructuredOutput: z.boolean(),
  supportsImageInput: z.boolean(),
});
export type ModelCapabilities = z.infer<typeof ModelCapabilitiesSchema>;

export const ModelCostMetadataSchema = z
  .object({
    inputUsdPer1k: z.number().nonnegative().optional(),
    outputUsdPer1k: z.number().nonnegative().optional(),
    cacheReadUsdPer1k: z.number().nonnegative().optional(),
    cacheWriteUsdPer1k: z.number().nonnegative().optional(),
    reasoningUsdPer1k: z.number().nonnegative().optional(),
  })
  .catchall(z.number().nonnegative());
export type ModelCostMetadata = z.infer<typeof ModelCostMetadataSchema>;

export const ModelCatalogEntrySchema = z.object({
  modelId: z.string().min(1),
  displayName: z.string().min(1),
  gatewayModelId: z.string().min(1),
  providerSlug: z.string().min(1),
  provider: z.string().min(1).optional(),
  enabled: z.boolean(),
  visible: z.boolean().optional(),
  contextWindow: z.number().int().positive().optional(),
  capabilities: ModelCapabilitiesSchema,
  costMetadata: ModelCostMetadataSchema.optional(),
  pricingVerifiedAt: z.string().datetime().nullable().optional(),
  family: z.string().min(1).optional(),
  recommended: z.boolean().optional(),
  planAccess: z.array(z.string().min(1)).optional(),
  maxReasoning: z.number().nonnegative().optional(),
  routingRole: z.string().min(1).optional(),
  fallbackModelId: z.string().min(1).nullable().optional(),
  deprecatedAt: z.string().datetime().nullable().optional(),
  releaseDate: z.string().date().nullable().optional(),
  logicalModelId: z.string().min(1).optional(),
});
export type ModelCatalogEntry = z.infer<typeof ModelCatalogEntrySchema>;

export const AUTO_MODEL_ID = 'AUTO';
