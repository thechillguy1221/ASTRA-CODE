import { describe, expect, it } from 'vitest';
import {
  ControlPlaneService,
  InMemoryControlPlaneRepository,
  InMemoryInvalidationBus,
} from '@astra/control-plane';

describe('control-plane cache invalidation', () => {
  it('refreshes cached snapshots when a domain invalidation is published', async () => {
    const repository = new InMemoryControlPlaneRepository({ plans: [], models: [] });
    const bus = new InMemoryInvalidationBus();
    const service = new ControlPlaneService({ repository, invalidationBus: bus });

    await expect(service.getPlan('FREE')).resolves.toBeUndefined();
    await repository.seedPlan({
      id: 'FREE',
      displayName: 'Free',
      monthlyPriceInr: '0',
      monthlyPriceUsd: '0',
      monthlyCredits: '25',
      allowedModelIds: ['*'],
      allowedModes: ['BUILD'],
      maxTaskBudgetCredits: '25',
      maxConcurrentJobs: 1,
      mcpLimit: 0,
      pluginLimit: 0,
      premiumModeAccess: false,
      maxContextWindow: 128000,
      priority: 'standard',
      enabled: true,
      seats: 1,
      activeJobsPerSeat: 1,
      pooledCredits: false,
      crossPersonRooms: false,
      rolloverCycles: 1,
      topUpEnabled: false,
      version: 1,
      status: 'ACTIVE',
      public: true,
      purchaseAvailable: false,
      effectiveFrom: '2026-09-21T00:00:00.000Z',
      effectiveTo: null,
      entitlements: {},
      limits: {},
      updatedAt: '2026-09-21T00:00:00.000Z',
    });
    await bus.publish({ domain: 'plans', resourceId: 'FREE', version: 1 });

    await expect(service.getPlan('FREE')).resolves.toMatchObject({ version: 1 });
  });
});
