import { describe, expect, it } from 'vitest';
import {
  ControlPlaneError,
  ControlPlaneService,
  InMemoryControlPlaneRepository,
  InMemoryInvalidationBus,
  redactAuditState,
  resolveAdminPermissions,
} from '@astra/control-plane';

const plan = {
  id: 'PRO',
  displayName: 'Pro',
  monthlyPriceInr: '999',
  monthlyPriceUsd: '11',
  monthlyCredits: '600',
  allowedModelIds: ['model-a'],
  allowedModes: ['BUILD'],
  maxTaskBudgetCredits: '600',
  maxConcurrentJobs: 5,
  mcpLimit: 20,
  pluginLimit: 20,
  premiumModeAccess: true,
  maxContextWindow: 256000,
  priority: 'priority' as const,
  enabled: true,
  seats: 1,
  activeJobsPerSeat: 5,
  pooledCredits: false,
  crossPersonRooms: false,
  rolloverCycles: 1,
  topUpEnabled: true,
  version: 1,
  status: 'ACTIVE' as const,
  public: true,
  purchaseAvailable: true,
  effectiveFrom: '2026-09-21T00:00:00.000Z',
  effectiveTo: null,
  entitlements: { webSearch: true },
  limits: { rooms: { kind: 'NUMERIC' as const, value: 5 } },
  updatedAt: '2026-09-21T00:00:00.000Z',
};

const model = {
  modelId: 'model-a',
  displayName: 'Model A',
  gatewayModelId: 'provider/model-a',
  providerSlug: 'provider',
  provider: 'Provider',
  enabled: true,
  visible: true,
  capabilities: {
    supportsTools: true,
    supportsStreaming: true,
    supportsReasoning: false,
    supportsStructuredOutput: true,
    supportsImageInput: false,
  },
  version: 1,
  status: 'AVAILABLE' as const,
  maintenanceMessage: null,
  regionAvailability: ['GLOBAL'],
  updatedAt: '2026-09-21T00:00:00.000Z',
};

function makeService(options?: { cacheTtlMs?: number }) {
  const repository = new InMemoryControlPlaneRepository({ plans: [plan], models: [model] });
  const bus = new InMemoryInvalidationBus();
  const service = new ControlPlaneService({
    repository,
    invalidationBus: bus,
    ...(options?.cacheTtlMs === undefined ? {} : { cacheTtlMs: options.cacheTtlMs }),
  });
  return { repository, bus, service };
}

const actor = {
  userId: 'admin-1',
  role: 'SUPER_ADMIN',
  permissions: resolveAdminPermissions('SUPER_ADMIN'),
} as const;

describe('control-plane service', () => {
  it('updates a plan atomically, preserves history, audits, and invalidates its cache', async () => {
    const { service, repository } = makeService();
    await service.getPlan('PRO');

    const updated = await service.updatePlan({
      plan: { ...plan, version: 2, entitlements: { webSearch: false } },
      metadata: { expectedVersion: 1, reason: 'temporary policy change', requestId: 'req-1' },
      actor,
      context: {},
    });

    expect(updated.version).toBe(2);
    expect((await service.getPlan('PRO'))?.entitlements.webSearch).toBe(false);
    expect((await repository.listPlanVersions('PRO')).map((entry) => entry.version)).toEqual([2, 1]);
    expect(await service.listAudit()).toHaveLength(1);
  });

  it('rejects stale updates without changing state or appending an audit event', async () => {
    const { service, repository } = makeService();

    await expect(
      service.updatePlan({
        plan: { ...plan, version: 2 },
        metadata: { expectedVersion: 0, reason: 'stale update', requestId: 'req-stale' },
        actor,
        context: {},
      }),
    ).rejects.toMatchObject({ code: 'CONTROL_PLANE_VERSION_CONFLICT' });

    expect((await repository.getPlan('PRO'))?.version).toBe(1);
    expect(await service.listAudit()).toHaveLength(0);
  });

  it('enforces plan/model policy and fails closed when the repository is unavailable', async () => {
    const { service, repository } = makeService({ cacheTtlMs: 1 });
    expect(await service.evaluateModelAccess({ planId: 'PRO', modelId: 'model-a' })).toMatchObject({
      allowed: true,
    });
    expect(await service.evaluateModelAccess({ planId: 'FREE', modelId: 'model-a' })).toMatchObject({
      allowed: false,
      reason: 'PLAN_NOT_FOUND',
    });

    repository.failReads = true;
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await service.evaluateModelAccess({ planId: 'PRO', modelId: 'model-a' })).toMatchObject({
      allowed: false,
      reason: 'CONTROL_PLANE_UNAVAILABLE',
    });
  });

  it('maps top-level roles to explicit permissions', () => {
    expect(resolveAdminPermissions('SUPER_ADMIN')).toContain('admin.models');
    expect(resolveAdminPermissions('FINANCE')).toContain('admin.billing');
    expect(resolveAdminPermissions('SUPPORT')).not.toContain('admin.models');
  });

  it('redacts secrets recursively before audit persistence', () => {
    expect(
      redactAuditState({
        apiKey: 'secret',
        nested: { password: 'pw', safe: 'ok' },
        accessToken: 'token',
      }),
    ).toEqual({
      apiKey: '[REDACTED]',
      nested: { password: '[REDACTED]', safe: 'ok' },
      accessToken: '[REDACTED]',
    });
  });
});

describe('control-plane error types', () => {
  it('exposes stable error codes', () => {
    const error = new ControlPlaneError('CONTROL_PLANE_UNAVAILABLE', 'policy unavailable');
    expect(error.code).toBe('CONTROL_PLANE_UNAVAILABLE');
  });
});
