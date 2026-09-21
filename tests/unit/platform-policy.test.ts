import { describe, expect, it } from 'vitest';
import {
  InMemoryInvalidationBus,
  InMemoryPlatformPolicyRepository,
  PlatformPolicyService,
  calculateModelUsageCredits,
  type CapabilityPolicySnapshot,
  type FeatureFlagSnapshot,
  type ModelConsumptionPricingSnapshot,
} from '@astra/control-plane';

const now = '2026-01-01T00:00:00.000Z';

function featureFlag(): FeatureFlagSnapshot {
  return {
    flagId: 'flag-1',
    key: 'new-policy-ui',
    description: 'Policy UI',
    enabled: true,
    scope: 'USER',
    targeting: {
      planIds: [],
      userIds: ['user-1'],
      organizationIds: [],
      roomIds: [],
      regions: [],
      betaGroup: null,
      internalOnly: false,
    },
    rolloutPercentage: 100,
    effectiveFrom: now,
    effectiveTo: null,
    status: 'ACTIVE',
    version: 1,
    createdBy: 'seed',
    updatedBy: 'seed',
    updatedAt: now,
  };
}

function capability(): CapabilityPolicySnapshot {
  return {
    key: 'WEB_SEARCH',
    enabled: true,
    allowedPlanIds: [],
    blockedPlanIds: [],
    allowedOrganizationIds: [],
    blockedOrganizationIds: [],
    allowedServers: [],
    blockedServers: [],
    allowedTransports: ['sse'],
    requireApproval: false,
    maxDevices: null,
    maxConcurrentSessions: null,
    sessionTimeoutSeconds: null,
    periodLimit: null,
    version: 1,
    updatedBy: 'seed',
    updatedAt: now,
  };
}

function actor() {
  return {
    userId: 'admin-1',
    role: 'SUPER_ADMIN' as const,
    permissions: ['admin.features'] as const,
  };
}

describe('platform policy control plane', () => {
  it('evaluates a targeted flag deterministically and invalidates cached versions', async () => {
    const repository = new InMemoryPlatformPolicyRepository({ featureFlags: [featureFlag()] });
    const service = new PlatformPolicyService({
      repository,
      invalidationBus: new InMemoryInvalidationBus(),
      now: () => Date.parse(now),
    });
    expect(await service.evaluateFeatureFlag('flag-1', { userId: 'user-1' })).toBe(true);
    expect(await service.evaluateFeatureFlag('flag-1', { userId: 'user-2' })).toBe(false);
    await service.updateFeatureFlag({
      snapshot: { ...featureFlag(), enabled: false, version: 2, updatedBy: 'admin-1' },
      metadata: { expectedVersion: 1, reason: 'disable rollout', requestId: 'policy-1' },
      actor: actor(),
      context: { sessionId: null, deviceId: null, ipAddress: null, userAgent: null },
    });
    expect(await service.evaluateFeatureFlag('flag-1', { userId: 'user-1' })).toBe(false);
    expect((await service.listAudit())[0]?.action).toBe('FEATURE_FLAG_UPDATED');
  });

  it('fails stale policy writes and fails closed for missing capability policy', async () => {
    const repository = new InMemoryPlatformPolicyRepository({ capabilities: [capability()] });
    const service = new PlatformPolicyService({
      repository,
      invalidationBus: new InMemoryInvalidationBus(),
    });
    await expect(service.assertCapabilityAllowed('MCP', {})).rejects.toMatchObject({
      code: 'CONTROL_PLANE_UNAVAILABLE',
    });
    await expect(
      service.updateCapabilityPolicy({
        snapshot: { ...capability(), version: 2, updatedBy: 'admin-1' },
        metadata: { expectedVersion: 0, reason: 'stale', requestId: 'policy-stale' },
        actor: actor(),
        context: { sessionId: null, deviceId: null, ipAddress: null, userAgent: null },
      }),
    ).rejects.toMatchObject({ code: 'CONTROL_PLANE_VERSION_CONFLICT' });
  });

  it('prices usage from the captured model tariff with decimal-safe arithmetic', () => {
    const pricing: ModelConsumptionPricingSnapshot = {
      modelId: 'model-1',
      version: 4,
      region: 'INDIA',
      inputCreditsPer1k: '1.5',
      outputCreditsPer1k: '3',
      cachedInputCreditsPer1k: '0.5',
      reasoningCreditsPer1k: '2',
      imageCredits: null,
      audioCredits: null,
      minimumChargeCredits: '1',
      effectiveFrom: now,
      effectiveTo: null,
      status: 'ACTIVE',
      updatedAt: now,
    };
    expect(
      calculateModelUsageCredits(pricing, {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 100,
        reasoningUnits: 250,
      }),
    ).toBe('3.55');
  });
});
