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
  domain: z.enum(['plans', 'models', 'entitlements', 'limits', 'commercial']),
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
