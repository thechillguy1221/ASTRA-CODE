import { describe, expect, it } from 'vitest';
import {
  AdminPermissionSchema,
  ControlPlaneModelSnapshotSchema,
  ControlPlanePlanSnapshotSchema,
  LimitValueSchema,
  MutationMetadataSchema,
} from '@astra/control-plane';

const validPlan = {
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
  priority: 'priority',
  enabled: true,
  seats: 1,
  activeJobsPerSeat: 5,
  pooledCredits: false,
  crossPersonRooms: false,
  rolloverCycles: 1,
  topUpEnabled: true,
  version: 1,
  status: 'ACTIVE',
  public: true,
  purchaseAvailable: true,
  effectiveFrom: '2026-09-21T00:00:00.000Z',
  effectiveTo: null,
  entitlements: { webSearch: true },
  limits: { rooms: { kind: 'NUMERIC', value: 5 } },
  updatedAt: '2026-09-21T00:00:00.000Z',
};

describe('control-plane contracts', () => {
  it('accepts a versioned plan snapshot with typed entitlements and limits', () => {
    expect(ControlPlanePlanSnapshotSchema.parse(validPlan).version).toBe(1);
  });

  it('rejects negative or malformed limits', () => {
    expect(LimitValueSchema.safeParse({ kind: 'NUMERIC', value: -1 }).success).toBe(false);
    expect(LimitValueSchema.safeParse({ kind: 'NUMERIC' }).success).toBe(false);
  });

  it('rejects unknown admin permissions and accepts the explicit permission set', () => {
    expect(AdminPermissionSchema.safeParse('admin.root').success).toBe(false);
    expect(AdminPermissionSchema.parse('admin.models')).toBe('admin.models');
  });

  it('requires optimistic version and reason metadata for mutations', () => {
    expect(MutationMetadataSchema.safeParse({ expectedVersion: 0, reason: '' }).success).toBe(false);
    expect(
      MutationMetadataSchema.safeParse({
        expectedVersion: 1,
        reason: 'approved model maintenance',
        requestId: 'req-1',
      }).success,
    ).toBe(true);
  });

  it('validates model catalog identity and lifecycle fields', () => {
    expect(
      ControlPlaneModelSnapshotSchema.safeParse({
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
        status: 'AVAILABLE',
        maintenanceMessage: null,
        regionAvailability: ['GLOBAL'],
        updatedAt: '2026-09-21T00:00:00.000Z',
      }).success,
    ).toBe(true);
  });
});
