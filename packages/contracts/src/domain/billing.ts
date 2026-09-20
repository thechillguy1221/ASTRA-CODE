import { z } from 'zod';

const decimalPattern = /^\d+(?:\.\d+)?$/;

export const CreditAmountSchema = z
  .string()
  .regex(decimalPattern)
  .refine(
    (value) => (value.split('.')[1]?.length ?? 0) <= 7,
    'Credits support at most 7 decimal places',
  );
export type CreditAmount = z.infer<typeof CreditAmountSchema>;

export const UsdAmountSchema = z
  .string()
  .regex(decimalPattern)
  .refine(
    (value) => (value.split('.')[1]?.length ?? 0) <= 10,
    'USD supports at most 10 decimal places',
  );
export type UsdAmount = z.infer<typeof UsdAmountSchema>;

export const BillingModeSchema = z.enum(['BUILD', 'LEARN', 'VIVA', 'HACKATHON']);
export type BillingMode = z.infer<typeof BillingModeSchema>;

export const LedgerTransactionTypeSchema = z.enum([
  'SUBSCRIPTION_GRANT',
  'CREDIT_PURCHASE',
  'PROMO_CREDIT',
  'USAGE_RESERVE',
  'USAGE_SETTLEMENT',
  'RESERVE_RELEASE',
  'REFUND',
  'ADJUSTMENT',
]);
export type LedgerTransactionType = z.infer<typeof LedgerTransactionTypeSchema>;

export const PlanSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  monthlyPriceInr: z.string().regex(/^\d+$/),
  monthlyCredits: CreditAmountSchema,
  allowedModelIds: z.array(z.string().min(1)),
  allowedModes: z.array(BillingModeSchema),
  maxTaskBudgetCredits: CreditAmountSchema,
  maxConcurrentJobs: z.number().int().positive(),
  mcpLimit: z.number().int().nonnegative(),
  pluginLimit: z.number().int().nonnegative(),
  premiumModeAccess: z.boolean(),
  maxContextWindow: z.number().int().positive(),
  priority: z.enum(['standard', 'priority', 'highest']),
  enabled: z.boolean(),
  taxExclusive: z.boolean().optional(),
  seats: z.number().int().positive().default(1),
  activeJobsPerSeat: z.number().int().positive().default(1),
  pooledCredits: z.boolean().default(false),
  crossPersonRooms: z.boolean().default(false),
  rolloverCycles: z.number().int().nonnegative().default(1),
  topUpEnabled: z.boolean().default(false),
});
export type Plan = z.infer<typeof PlanSchema>;

export const WalletSchema = z.object({
  walletId: z.string().min(1),
  userId: z.string().min(1),
  availableCredits: CreditAmountSchema,
  reservedCredits: CreditAmountSchema,
  consumedCredits: CreditAmountSchema,
  updatedAt: z.string().datetime(),
});
export type Wallet = z.infer<typeof WalletSchema>;

export const WalletLedgerEntrySchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  taskId: z.string().min(1).nullable(),
  amountCredits: CreditAmountSchema,
  transactionType: LedgerTransactionTypeSchema,
  idempotencyKey: z.string().min(1).nullable(),
  reason: z.string().min(1),
  availableDeltaCredits: z.string(),
  reservedDeltaCredits: z.string(),
  consumedDeltaCredits: z.string(),
  createdAt: z.string().datetime(),
  metadata: z.record(z.unknown()),
});
export type WalletLedgerEntry = z.infer<typeof WalletLedgerEntrySchema>;

export const CreditReservationSchema = z.object({
  reservationId: z.string().min(1),
  userId: z.string().min(1),
  taskId: z.string().min(1),
  modelId: z.string().min(1).optional(),
  amountCredits: CreditAmountSchema,
  status: z.enum(['RESERVED', 'SETTLED', 'RELEASED', 'CANCELLED']),
  idempotencyKey: z.string().min(1),
  createdAt: z.string().datetime(),
  settledAt: z.string().datetime().nullable(),
  bucketAllocations: z
    .array(z.object({ bucketId: z.string().min(1), amountCredits: CreditAmountSchema }))
    .default([]),
});
export type CreditReservation = z.infer<typeof CreditReservationSchema>;

export const UsageSettlementSchema = z.object({
  settlementId: z.string().min(1),
  reservationId: z.string().min(1),
  providerActualCostUsd: UsdAmountSchema,
  customerBillableCostUsd: UsdAmountSchema,
  absorbedCostUsd: UsdAmountSchema,
  reservedCredits: CreditAmountSchema,
  settledCredits: CreditAmountSchema,
  releasedCredits: CreditAmountSchema,
  idempotencyKey: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type UsageSettlement = z.infer<typeof UsageSettlementSchema>;

export const WalletBucketSourceTypeSchema = z.enum([
  'free_monthly',
  'subscription_monthly',
  'purchased_topup',
  'promotional',
  'referral',
  'refund_adjustment',
  'admin_adjustment',
]);
export type WalletBucketSourceType = z.infer<typeof WalletBucketSourceTypeSchema>;

export const WalletBucketSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().min(1),
  sourceType: WalletBucketSourceTypeSchema,
  originalCredits: CreditAmountSchema,
  remainingCredits: CreditAmountSchema,
  idempotencyKey: z.string().min(1),
  referenceId: z.string().min(1).nullable(),
  planCycle: z.string().min(1).nullable(),
  expiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type WalletBucket = z.infer<typeof WalletBucketSchema>;
