import { describe, expect, it } from 'vitest';
import { loadPlanCatalog } from '@lyntar/db';
import { createDefaultPlanCatalog, PlanEntitlementError } from '@lyntar/plans';

describe('server-controlled plans', () => {
  it('seeds the product plans without desktop constants', () => {
    const catalog = createDefaultPlanCatalog();
    const ids = catalog.list().map((plan) => plan.id);
    expect(ids).toContain('FREE');
    expect(ids).toContain('BASIC');
    expect(ids).toContain('TEAM');
    expect(ids).toContain('BUSINESS');
    expect(ids).toContain('PRO');
    expect(ids).toContain('MAX');
    expect(catalog.get('FREE').monthlyCredits).toBe('25');
    expect(catalog.get('BASIC').monthlyCredits).toBe('300');
    expect(catalog.get('PRO').monthlyPriceInr).toBe('999');
    expect(catalog.get('PRO').monthlyPriceUsd).toBe('11');
    expect(catalog.get('TEAM').seats).toBe(5);
    expect(catalog.get('BUSINESS').crossPersonRooms).toBe(true);
  });

  it('enforces task-budget and concurrency entitlements', () => {
    const catalog = createDefaultPlanCatalog();
    expect(
      catalog.assertTaskAllowed('BASIC', {
        modelId: 'approved-core',
        mode: 'BUILD',
        requestedCredits: '50',
        activeJobs: 0,
      }),
    ).toBeUndefined();
    expect(() =>
      catalog.assertTaskAllowed('FREE', {
        modelId: 'approved-core',
        mode: 'BUILD',
        requestedCredits: '100', // exceeds Free task budget of 25
        activeJobs: 0,
      }),
    ).toThrow(PlanEntitlementError);
  });

  it('scopes pooled-plan concurrency to active human seats', () => {
    const catalog = createDefaultPlanCatalog();
    expect(() =>
      catalog.assertTaskAllowed('TEAM', {
        modelId: 'approved-core',
        mode: 'BUILD',
        requestedCredits: '1',
        activeJobs: 10,
      }),
    ).toThrow(PlanEntitlementError);
    expect(() =>
      catalog.assertTaskAllowed('TEAM', {
        modelId: 'approved-core',
        mode: 'BUILD',
        requestedCredits: '1',
        activeJobs: 10,
        activeSeats: 2,
      }),
    ).not.toThrow();
  });

  it('loads server plan values from the database shape rather than desktop constants', async () => {
    const pool = {
      query: async () => ({
        rows: [
          {
            id: 'BASIC',
            display_name: 'Basic',
            monthly_price_inr: '549',
            monthly_price_usd: '6',
            monthly_credits: '300',
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
    expect(catalog.get('BASIC').monthlyCredits).toBe('300');
    expect(catalog.get('BASIC').monthlyPriceInr).toBe('549');
    expect(catalog.get('BASIC').monthlyPriceUsd).toBe('6');
  });
});
