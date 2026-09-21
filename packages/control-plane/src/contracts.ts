import { ModelCatalogEntrySchema, PlanSchema } from '@astra/contracts';
import { z } from 'zod';

export const AdminPermissionSchema = z.enum([
  'admin.users',
  'admin.organizations',
  'admin.rooms',
  'admin.billing',
  'admin.models',
  'admin.plans',
  'admin.security',
  'admin.email',
  'admin.features',
  'admin.releases',
  'admin.system',
]);
export type AdminPermission = z.infer<typeof AdminPermissionSchema>;

export const LimitValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('DISABLED') }),
  z.object({ kind: z.literal('UNLIMITED') }),
  z.object({ kind: z.literal('NUMERIC'), value: z.number().int().nonnegative() }),
]);
export type LimitValue = z.infer<typeof LimitValueSchema>;

export const PlanStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'RETIRED']);
export type PlanStatus = z.infer<typeof PlanStatusSchema>;

export const ControlPlanePlanSnapshotSchema = PlanSchema.extend({
  version: z.number().int().positive(),
  status: PlanStatusSchema,
  public: z.boolean(),
  purchaseAvailable: z.boolean(),
  effectiveFrom: z.string().datetime(),
  effectiveTo: z.string().datetime().nullable(),
  entitlements: z.record(z.boolean()),
  limits: z.record(LimitValueSchema),
  updatedAt: z.string().datetime(),
});
export type ControlPlanePlanSnapshot = z.infer<typeof ControlPlanePlanSnapshotSchema>;

export const ModelStatusSchema = z.enum(['AVAILABLE', 'MAINTENANCE', 'DEGRADED', 'DISABLED']);
export type ModelStatus = z.infer<typeof ModelStatusSchema>;

export const ControlPlaneModelSnapshotSchema = ModelCatalogEntrySchema.extend({
  version: z.number().int().positive(),
  status: ModelStatusSchema,
  maintenanceMessage: z.string().max(500).nullable(),
  regionAvailability: z.array(z.string().min(1)),
  updatedAt: z.string().datetime(),
});
export type ControlPlaneModelSnapshot = z.infer<typeof ControlPlaneModelSnapshotSchema>;

export const MutationMetadataSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(3).max(500),
  requestId: z.string().trim().min(1).max(120),
});
export type MutationMetadata = z.infer<typeof MutationMetadataSchema>;

export const AuditActorSchema = z.object({
  userId: z.string().min(1),
  role: z.string().min(1),
  permissions: z.array(AdminPermissionSchema),
});
export type AuditActor = z.infer<typeof AuditActorSchema>;

export const AuditContextSchema = z.object({
  sessionId: z.string().min(1).nullable().optional(),
  deviceId: z.string().min(1).nullable().optional(),
  ipAddress: z.string().min(1).nullable().optional(),
  userAgent: z.string().max(500).nullable().optional(),
});
export type AuditContext = z.infer<typeof AuditContextSchema>;

export const AuditEventInputSchema = z.object({
  actor: AuditActorSchema,
  action: z.string().trim().min(1).max(120),
  targetType: z.string().trim().min(1).max(120),
  targetId: z.string().trim().min(1).max(200),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  reason: z.string().trim().min(3).max(500),
  requestId: z.string().trim().min(1).max(120),
  context: AuditContextSchema,
  createdAt: z.string().datetime(),
});
export type AuditEventInput = z.infer<typeof AuditEventInputSchema>;

export const InvalidationMessageSchema = z.object({
  domain: z.enum([
    'plans',
    'models',
    'entitlements',
    'limits',
    'commercial',
    'features',
    'maintenance',
    'releases',
    'capabilities',
    'razorpay',
  ]),
  resourceId: z.string().min(1),
  version: z.number().int().positive(),
});
export type InvalidationMessage = z.infer<typeof InvalidationMessageSchema>;

export interface PlanWriteInput {
  plan: ControlPlanePlanSnapshot;
  expectedVersion: number;
  audit: AuditEventInput;
}

export interface ModelWriteInput {
  model: ControlPlaneModelSnapshot;
  expectedVersion: number;
  audit: AuditEventInput;
}

export const PricingRegionSchema = z.enum(['INDIA', 'GLOBAL']);
export type PricingRegion = z.infer<typeof PricingRegionSchema>;

export const PricingCurrencySchema = z.enum(['INR', 'USD']);
export type PricingCurrency = z.infer<typeof PricingCurrencySchema>;

const CommercialAmountSchema = z
  .string()
  .regex(/^\d+(?:\.\d{1,7})?$/, 'Amount must be a non-negative decimal');

export const RegionalMoneySchema = z.object({
  currency: PricingCurrencySchema,
  amount: CommercialAmountSchema,
  taxIncluded: z.boolean(),
});
export type RegionalMoney = z.infer<typeof RegionalMoneySchema>;

export const CommercialVersionStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'RETIRED']);
export type CommercialVersionStatus = z.infer<typeof CommercialVersionStatusSchema>;

export const CommercialPlanPriceSnapshotSchema = z.object({
  planId: z.string().min(1),
  version: z.number().int().positive(),
  region: PricingRegionSchema,
  currency: PricingCurrencySchema,
  monthlyAmount: CommercialAmountSchema,
  yearlyAmount: CommercialAmountSchema.nullable(),
  seatAmount: CommercialAmountSchema.nullable(),
  includedMonthlyCredits: CommercialAmountSchema,
  includedYearlyCredits: CommercialAmountSchema.nullable(),
  effectiveFrom: z.string().datetime(),
  effectiveTo: z.string().datetime().nullable(),
  status: CommercialVersionStatusSchema,
  updatedAt: z.string().datetime(),
});
export type CommercialPlanPriceSnapshot = z.infer<typeof CommercialPlanPriceSnapshotSchema>;

export const TopUpPackageSnapshotSchema = z.object({
  packageId: z.string().min(1),
  version: z.number().int().positive(),
  displayName: z.string().min(1),
  credits: CommercialAmountSchema,
  bonusCredits: CommercialAmountSchema,
  validityDays: z.number().int().positive(),
  prices: z.record(PricingRegionSchema, RegionalMoneySchema),
  active: z.boolean(),
  displayOrder: z.number().int().nonnegative(),
  purchaseLimit: z.number().int().positive().nullable(),
  effectiveFrom: z.string().datetime(),
  effectiveTo: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
});
export type TopUpPackageSnapshot = z.infer<typeof TopUpPackageSnapshotSchema>;

export const PromotionSnapshotSchema = z.object({
  promotionId: z.string().min(1),
  version: z.number().int().positive(),
  code: z.string().trim().min(1).max(80),
  kind: z.enum(['PERCENT', 'FIXED', 'BONUS_CREDITS']),
  percentOff: z.number().min(0).max(100).nullable(),
  fixedAmount: CommercialAmountSchema.nullable(),
  fixedCurrency: PricingCurrencySchema.nullable(),
  bonusCredits: CommercialAmountSchema,
  planIds: z.array(z.string().min(1)),
  regions: z.array(PricingRegionSchema),
  maxRedemptions: z.number().int().positive().nullable(),
  perUserRedemptionLimit: z.number().int().positive().nullable(),
  validFrom: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
  active: z.boolean(),
  updatedAt: z.string().datetime(),
});
export type PromotionSnapshot = z.infer<typeof PromotionSnapshotSchema>;

export const ModelConsumptionPricingSnapshotSchema = z.object({
  modelId: z.string().min(1),
  version: z.number().int().positive(),
  region: PricingRegionSchema,
  inputCreditsPer1k: CommercialAmountSchema,
  outputCreditsPer1k: CommercialAmountSchema,
  cachedInputCreditsPer1k: CommercialAmountSchema.nullable(),
  reasoningCreditsPer1k: CommercialAmountSchema.nullable(),
  imageCredits: CommercialAmountSchema.nullable(),
  audioCredits: CommercialAmountSchema.nullable(),
  minimumChargeCredits: CommercialAmountSchema,
  effectiveFrom: z.string().datetime(),
  effectiveTo: z.string().datetime().nullable(),
  status: CommercialVersionStatusSchema,
  updatedAt: z.string().datetime(),
});
export type ModelConsumptionPricingSnapshot = z.infer<typeof ModelConsumptionPricingSnapshotSchema>;

export const FeatureFlagScopeSchema = z.enum([
  'GLOBAL',
  'PLAN',
  'USER',
  'ORGANIZATION',
  'ROOM',
  'REGION',
  'BETA_GROUP',
  'INTERNAL',
]);
export type FeatureFlagScope = z.infer<typeof FeatureFlagScopeSchema>;

export const FeatureFlagTargetingSchema = z
  .object({
    planIds: z.array(z.string().min(1)).max(100).default([]),
    userIds: z.array(z.string().min(1)).max(1000).default([]),
    organizationIds: z.array(z.string().min(1)).max(1000).default([]),
    roomIds: z.array(z.string().min(1)).max(1000).default([]),
    regions: z.array(z.string().min(1).max(20)).max(100).default([]),
    betaGroup: z.string().min(1).max(120).nullable().default(null),
    internalOnly: z.boolean().default(false),
  })
  .strict();
export type FeatureFlagTargeting = z.infer<typeof FeatureFlagTargetingSchema>;

export const FeatureFlagStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'RETIRED']);
export type FeatureFlagStatus = z.infer<typeof FeatureFlagStatusSchema>;

export const FeatureFlagSnapshotSchema = z.object({
  flagId: z.string().min(1),
  key: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,119}$/),
  description: z.string().min(1).max(500),
  enabled: z.boolean(),
  scope: FeatureFlagScopeSchema,
  targeting: FeatureFlagTargetingSchema,
  rolloutPercentage: z.number().int().min(0).max(100),
  effectiveFrom: z.string().datetime(),
  effectiveTo: z.string().datetime().nullable(),
  status: FeatureFlagStatusSchema,
  version: z.number().int().positive(),
  createdBy: z.string().min(1),
  updatedBy: z.string().min(1),
  updatedAt: z.string().datetime(),
});
export type FeatureFlagSnapshot = z.infer<typeof FeatureFlagSnapshotSchema>;

export const FeatureFlagEvaluationContextSchema = z.object({
  planId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  organizationId: z.string().min(1).optional(),
  roomId: z.string().min(1).optional(),
  region: z.string().min(1).optional(),
  betaGroup: z.string().min(1).optional(),
  internal: z.boolean().optional(),
  bucketKey: z.string().min(1).optional(),
});
export type FeatureFlagEvaluationContext = z.infer<typeof FeatureFlagEvaluationContextSchema>;

export const MaintenanceKeySchema = z.enum([
  'GLOBAL',
  'MODELS',
  'PAYMENTS',
  'WEB_SEARCH',
  'WEB_FETCH',
  'MCP',
  'PLUGINS',
  'SKILLS',
  'REMOTE_ACCESS',
  'ROOMS',
  'EMAIL',
]);
export type MaintenanceKey = z.infer<typeof MaintenanceKeySchema>;

export const MaintenancePolicySnapshotSchema = z.object({
  key: MaintenanceKeySchema,
  enabled: z.boolean(),
  message: z.string().min(1).max(500),
  effectiveFrom: z.string().datetime(),
  expectedEnd: z.string().datetime().nullable(),
  affectedPlanIds: z.array(z.string().min(1)).max(100),
  emergencyOverride: z.boolean(),
  version: z.number().int().positive(),
  updatedBy: z.string().min(1),
  updatedAt: z.string().datetime(),
});
export type MaintenancePolicySnapshot = z.infer<typeof MaintenancePolicySnapshotSchema>;

export const CapabilityPolicyKeySchema = z.enum([
  'WEB_SEARCH',
  'WEB_FETCH',
  'MCP',
  'PLUGINS',
  'SKILLS',
  'REMOTE_ACCESS',
]);
export type CapabilityPolicyKey = z.infer<typeof CapabilityPolicyKeySchema>;

export const CapabilityPolicySnapshotSchema = z.object({
  key: CapabilityPolicyKeySchema,
  enabled: z.boolean(),
  allowedPlanIds: z.array(z.string().min(1)).max(100),
  blockedPlanIds: z.array(z.string().min(1)).max(100),
  allowedOrganizationIds: z.array(z.string().min(1)).max(1000),
  blockedOrganizationIds: z.array(z.string().min(1)).max(1000),
  allowedServers: z.array(z.string().min(1).max(300)).max(1000),
  blockedServers: z.array(z.string().min(1).max(300)).max(1000),
  allowedTransports: z.array(z.enum(['stdio', 'sse', 'streamable-http'])).max(10),
  requireApproval: z.boolean(),
  maxDevices: z.number().int().positive().nullable(),
  maxConcurrentSessions: z.number().int().positive().nullable(),
  sessionTimeoutSeconds: z.number().int().positive().nullable(),
  periodLimit: z.number().int().positive().nullable(),
  version: z.number().int().positive(),
  updatedBy: z.string().min(1),
  updatedAt: z.string().datetime(),
});
export type CapabilityPolicySnapshot = z.infer<typeof CapabilityPolicySnapshotSchema>;

export const ReleaseChannelSchema = z.enum(['stable', 'beta', 'nightly']);
export type ReleaseChannel = z.infer<typeof ReleaseChannelSchema>;

export const ReleasePolicySnapshotSchema = z.object({
  channel: ReleaseChannelSchema,
  stableVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  betaVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  minimumSupportedVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  recommendedVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  requiredUpdateVersion: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .nullable(),
  blockedVersions: z.array(z.string().regex(/^\d+\.\d+\.\d+$/)).max(100),
  releaseNotesUrl: z.string().url().nullable(),
  downloadUrl: z.string().url().nullable(),
  version: z.number().int().positive(),
  updatedBy: z.string().min(1),
  updatedAt: z.string().datetime(),
});
export type ReleasePolicySnapshot = z.infer<typeof ReleasePolicySnapshotSchema>;

export const RazorpayMappingEntitySchema = z.enum(['PLAN', 'TOP_UP']);
export type RazorpayMappingEntity = z.infer<typeof RazorpayMappingEntitySchema>;

export const RazorpayMappingSnapshotSchema = z.object({
  mappingId: z.string().min(1),
  entityType: RazorpayMappingEntitySchema,
  entityId: z.string().min(1),
  pricingVersion: z.number().int().positive().nullable(),
  region: PricingRegionSchema,
  currency: PricingCurrencySchema,
  providerProductId: z.string().min(1).max(200),
  interval: z.enum(['monthly', 'yearly', 'one_time']),
  active: z.boolean(),
  version: z.number().int().positive(),
  updatedBy: z.string().min(1),
  updatedAt: z.string().datetime(),
});
export type RazorpayMappingSnapshot = z.infer<typeof RazorpayMappingSnapshotSchema>;
