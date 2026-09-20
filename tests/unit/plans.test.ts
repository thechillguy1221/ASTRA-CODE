import { describe, expect, it } from 'vitest';
import { loadPlanCatalog } from '@lyntar/db';
import { createDefaultPlanCatalog, PlanEntitlementError } from '@lyntar/plans';

describe('server-controlled plans', () => {
  it('seeds the four product plans without desktop constants', () => {
    const catalog = createDefaultPlanCatalog();
    expect(catalog.list().map((plan) => plan.id)).toEqual(['FREE', 'STUDENT', 'PRO', 'MAX']);
    expect(catalog.get('STUDENT').monthlyCredits).toBe('500');
    expect(catalog.get('PRO').monthlyPriceInr).toBe('299');
  });

  it('enforces model, mode, task-budget, and concurrency entitlements', () => {
    const catalog = createDefaultPlanCatalog();
    expect(
      catalog.assertTaskAllowed('STUDENT', {
        modelId: 'approved-core',
        mode: 'BUILD',
        requestedCredits: '50',
        activeJobs: 0,
      }),
    ).toBeUndefined();
    expect(() =>
      catalog.assertTaskAllowed('FREE', {
        modelId: 'frontier',
        mode: 'BUILD',
        requestedCredits: '10',
        activeJobs: 0,
      }),
    ).toThrow(PlanEntitlementError);
    expect(() =>
      catalog.assertTaskAllowed('FREE', {
        modelId: 'approved-core',
        mode: 'VIVA',
        requestedCredits: '10',
        activeJobs: 0,
      }),
    ).toThrow('MODE_NOT_ALLOWED');
  });

  it('loads server plan values from the database shape rather than desktop constants', async () => {
    const pool = {
      query: async () => ({
        rows: [
          {
            id: 'STUDENT',
            display_name: 'Student',
            monthly_price_inr: '149',
            monthly_credits: '500',
            enabled: true,
            entitlements: {
              allowedModelIds: ['approved-core'],
              allowedModes: ['BUILD'],
              maxTaskBudgetCredits: '100',
              maxConcurrentJobs: 2,
              mcpLimit: 5,
              pluginLimit: 5,
              premiumModeAccess: true,
              maxContextWindow: 128000,
              priority: 'priority',
            },
          },
        ],
      }),
    } as never;
    const catalog = await loadPlanCatalog(pool, createDefaultPlanCatalog());
    expect(catalog.get('STUDENT').monthlyCredits).toBe('500');
    expect(catalog.get('STUDENT').monthlyPriceInr).toBe('149');
  });
});
