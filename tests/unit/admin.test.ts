import { describe, expect, it } from 'vitest';
import { AdminError, AdminService, InMemoryAdminAuditStore } from '@lyntar/billing';
import { BillingService, InMemoryBillingStore } from '@lyntar/billing';
import { createDefaultPlanCatalog } from '@lyntar/plans';

describe('financial administration', () => {
  it('requires finance or super-admin role for wallet adjustments and records an audit entry', async () => {
    const billing = new BillingService({
      store: new InMemoryBillingStore(),
      plans: createDefaultPlanCatalog(),
    });
    const audit = new InMemoryAdminAuditStore();
    const admin = new AdminService({ billing, audit });
    await expect(
      admin.adjustWallet({
        actor: { userId: 'support-1', role: 'SUPPORT' },
        targetUserId: 'user-1',
        amountCredits: '10',
        direction: 'credit',
        reason: 'support request',
        requestId: 'req-1',
      }),
    ).rejects.toBeInstanceOf(AdminError);
    await admin.adjustWallet({
      actor: { userId: 'finance-1', role: 'FINANCE' },
      targetUserId: 'user-1',
      amountCredits: '10',
      direction: 'credit',
      reason: 'approved promo',
      requestId: 'req-2',
    });
    expect((await billing.getWallet('user-1')).availableCredits).toBe('10');
    expect(await audit.list()).toHaveLength(1);
    expect((await audit.list())[0]?.actorUserId).toBe('finance-1');
  });

  it('allows support to read but not mutate model controls', async () => {
    const admin = new AdminService({
      billing: new BillingService({
        store: new InMemoryBillingStore(),
        plans: createDefaultPlanCatalog(),
      }),
      audit: new InMemoryAdminAuditStore(),
    });
    expect(() => admin.assertCan('SUPPORT', 'read_usage')).not.toThrow();
    expect(() => admin.assertCan('SUPPORT', 'change_model')).toThrow(AdminError);
    expect(() => admin.assertCan('SUPER_ADMIN', 'change_model')).not.toThrow();
  });
});
