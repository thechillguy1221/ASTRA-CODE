import { randomUUID } from 'node:crypto';
import type { BillingService } from './service.js';

export type AdminRole = 'SUPER_ADMIN' | 'FINANCE' | 'SUPPORT';
export type AdminAction =
  'read_usage' | 'adjust_wallet' | 'change_model' | 'refund_payment' | 'revoke_sessions';

export interface AdminAuditEntry {
  id: string;
  actorUserId: string;
  role: AdminRole;
  action: AdminAction;
  targetType: string;
  targetId: string;
  before: unknown;
  after: unknown;
  reason: string;
  requestId: string;
  createdAt: string;
}

export interface AdminAuditStore {
  append(entry: AdminAuditEntry): Promise<void>;
  list(): Promise<AdminAuditEntry[]>;
}

export class InMemoryAdminAuditStore implements AdminAuditStore {
  private readonly entries: AdminAuditEntry[] = [];

  async append(entry: AdminAuditEntry): Promise<void> {
    this.entries.push({ ...entry });
  }

  async list(): Promise<AdminAuditEntry[]> {
    return this.entries.map((entry) => ({ ...entry }));
  }
}

export class AdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminError';
  }
}

export class AdminService {
  constructor(private readonly options: { billing: BillingService; audit: AdminAuditStore }) {}

  assertCan(role: AdminRole, action: AdminAction): void {
    const allowed: Record<AdminAction, AdminRole[]> = {
      read_usage: ['SUPER_ADMIN', 'FINANCE', 'SUPPORT'],
      adjust_wallet: ['SUPER_ADMIN', 'FINANCE'],
      change_model: ['SUPER_ADMIN'],
      refund_payment: ['SUPER_ADMIN', 'FINANCE'],
      revoke_sessions: ['SUPER_ADMIN', 'SUPPORT'],
    };
    if (!allowed[action].includes(role)) throw new AdminError(`Role ${role} cannot ${action}`);
  }

  async adjustWallet(input: {
    actor: { userId: string; role: AdminRole };
    targetUserId: string;
    amountCredits: string;
    direction: 'credit' | 'debit';
    reason: string;
    requestId: string;
  }): Promise<void> {
    this.assertCan(input.actor.role, 'adjust_wallet');
    const before = await this.options.billing.getWallet(input.targetUserId);
    await this.options.billing.adjustCredits({
      userId: input.targetUserId,
      amountCredits: input.amountCredits,
      direction: input.direction,
      idempotencyKey: `admin:${input.requestId}`,
      reason: input.reason,
      metadata: { adminUserId: input.actor.userId },
    });
    const after = await this.options.billing.getWallet(input.targetUserId);
    await this.options.audit.append({
      id: randomUUID(),
      actorUserId: input.actor.userId,
      role: input.actor.role,
      action: 'adjust_wallet',
      targetType: 'wallet',
      targetId: input.targetUserId,
      before,
      after,
      reason: input.reason,
      requestId: input.requestId,
      createdAt: new Date().toISOString(),
    });
  }
}
