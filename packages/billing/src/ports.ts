import type {
  CreditReservation,
  LedgerTransactionType,
  UsageSettlement,
  Wallet,
  WalletLedgerEntry,
  WalletBucket,
  WalletBucketSourceType,
  OrganizationWallet,
  OrganizationWalletLedgerEntry,
  OrganizationWalletBucket,
} from '@astra/contracts';

export interface GrantCreditsInput {
  userId: string;
  amountCredits: string;
  transactionType: Exclude<
    LedgerTransactionType,
    'USAGE_RESERVE' | 'USAGE_SETTLEMENT' | 'RESERVE_RELEASE'
  >;
  idempotencyKey: string;
  reason: string;
  taskId?: string;
  metadata?: Record<string, unknown>;
  sourceType?: WalletBucketSourceType;
  expiresAt?: string | null;
  referenceId?: string | null;
  planCycle?: string | null;
}

export interface ReserveCreditsInput {
  userId: string;
  taskId: string;
  modelId?: string;
  amountCredits: string;
  idempotencyKey: string;
  pricingVersion?: number;
  pricingSnapshot?: Record<string, unknown>;
}

export interface SettleCreditsInput {
  reservationId: string;
  idempotencyKey: string;
  providerActualCostUsd: string;
  customerBillableCostUsd: string;
}

export interface AdjustCreditsInput {
  userId: string;
  amountCredits: string;
  direction: 'credit' | 'debit';
  idempotencyKey: string;
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface RolloverSubscriptionCreditsInput {
  userId: string;
  monthlyAllocation: string;
  periodStart: string;
  newExpiresAt?: string | null;
  idempotencyKey: string;
  referenceId?: string | null;
}

export interface BillingStore {
  getWallet(userId: string): Promise<Wallet>;
  getReservation(reservationId: string): Promise<CreditReservation | undefined>;
  grantCredits(input: GrantCreditsInput): Promise<WalletLedgerEntry>;
  reserveCredits(input: ReserveCreditsInput): Promise<CreditReservation>;
  settleCredits(input: SettleCreditsInput): Promise<UsageSettlement>;
  adjustCredits(input: AdjustCreditsInput): Promise<WalletLedgerEntry>;
  rolloverSubscriptionCredits?(input: RolloverSubscriptionCreditsInput): Promise<string>;
  listLedger(userId: string): Promise<WalletLedgerEntry[]>;
  countActiveReservations?(userId: string): Promise<number>;
  listBuckets?(userId: string): Promise<WalletBucket[]>;
}

export interface OrganizationGrantCreditsInput {
  organizationId: string;
  actorUserId: string;
  amountCredits: string;
  transactionType: Exclude<
    LedgerTransactionType,
    'USAGE_RESERVE' | 'USAGE_SETTLEMENT' | 'RESERVE_RELEASE'
  >;
  idempotencyKey: string;
  reason: string;
  roomId?: string | null;
  taskId?: string;
  metadata?: Record<string, unknown>;
  sourceType?: WalletBucketSourceType;
  expiresAt?: string | null;
  referenceId?: string | null;
  planCycle?: string | null;
}

export interface OrganizationReserveCreditsInput {
  organizationId: string;
  actorUserId: string;
  roomId?: string | null;
  hostDeviceId?: string | null;
  taskId: string;
  modelId?: string;
  amountCredits: string;
  idempotencyKey: string;
  pricingVersion?: number;
  pricingSnapshot?: Record<string, unknown>;
}

export interface OrganizationRolloverSubscriptionCreditsInput {
  organizationId: string;
  actorUserId: string;
  monthlyAllocation: string;
  periodStart: string;
  newExpiresAt?: string | null;
  idempotencyKey: string;
  referenceId?: string | null;
}

export interface OrganizationBillingStore {
  getWallet(organizationId: string): Promise<OrganizationWallet>;
  getReservation(reservationId: string): Promise<CreditReservation | undefined>;
  grantCredits(input: OrganizationGrantCreditsInput): Promise<OrganizationWalletLedgerEntry>;
  reserveCredits(input: OrganizationReserveCreditsInput): Promise<CreditReservation>;
  settleCredits(input: SettleCreditsInput): Promise<UsageSettlement>;
  listLedger(organizationId: string): Promise<OrganizationWalletLedgerEntry[]>;
  listBuckets?(organizationId: string): Promise<OrganizationWalletBucket[]>;
  countActiveReservations?(organizationId: string): Promise<number>;
  rolloverSubscriptionCredits?(
    input: OrganizationRolloverSubscriptionCreditsInput,
  ): Promise<string>;
}
