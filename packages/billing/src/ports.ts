import type {
  CreditReservation,
  LedgerTransactionType,
  UsageSettlement,
  Wallet,
  WalletLedgerEntry,
  WalletBucket,
  WalletBucketSourceType,
} from '@lyntar/contracts';

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
