import { createHash } from 'node:crypto';
import {
  AuditEventInputSchema,
  CapabilityPolicySnapshotSchema,
  FeatureFlagEvaluationContextSchema,
  FeatureFlagSnapshotSchema,
  MaintenanceKeySchema,
  MaintenancePolicySnapshotSchema,
  RazorpayMappingSnapshotSchema,
  ReleasePolicySnapshotSchema,
  type AuditContext,
  type AuditEventInput,
  type CapabilityPolicySnapshot,
  type FeatureFlagEvaluationContext,
  type FeatureFlagSnapshot,
  type InvalidationMessage,
  type MaintenanceKey,
  type MaintenancePolicySnapshot,
  type MutationMetadata,
  type RazorpayMappingSnapshot,
  type ReleaseChannel,
  type ReleasePolicySnapshot,
} from './contracts.js';
import { redactAuditEvent } from './audit.js';
import { ControlPlaneError } from './errors.js';
import type {
  PlatformPolicyRepository,
  PlatformPolicyTransaction,
  InvalidationBus,
} from './ports.js';
import { hasAdminPermission } from './permissions.js';
import type { ControlPlaneActor } from './service.js';

export interface PlatformPolicyWriteContext {
  metadata: MutationMetadata;
  actor: ControlPlaneActor;
  context: AuditContext;
}

export interface CapabilityAccessContext {
  planId?: string;
  organizationId?: string;
  roomId?: string;
}

export type ReleaseResolution =
  | { status: 'CURRENT'; currentVersion: string; policy: ReleasePolicySnapshot }
  | {
      status: 'UPDATE_AVAILABLE' | 'UPDATE_RECOMMENDED' | 'UPDATE_REQUIRED';
      currentVersion: string;
      targetVersion: string;
      policy: ReleasePolicySnapshot;
    }
  | { status: 'VERSION_BLOCKED'; currentVersion: string; policy: ReleasePolicySnapshot };

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class PlatformPolicyService {
  private readonly repository: PlatformPolicyRepository;
  private readonly invalidationBus: InvalidationBus;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly featureFlags = new Map<string, CacheEntry<FeatureFlagSnapshot>>();
  private readonly maintenance = new Map<string, CacheEntry<MaintenancePolicySnapshot>>();
  private readonly capabilities = new Map<string, CacheEntry<CapabilityPolicySnapshot>>();
  private readonly releases = new Map<string, CacheEntry<ReleasePolicySnapshot>>();
  private readonly unsubscribe: () => void;

  constructor(options: {
    repository: PlatformPolicyRepository;
    invalidationBus: InvalidationBus;
    cacheTtlMs?: number;
    now?: () => number;
  }) {
    this.repository = options.repository;
    this.invalidationBus = options.invalidationBus;
    this.cacheTtlMs = options.cacheTtlMs ?? 30_000;
    this.now = options.now ?? Date.now;
    this.unsubscribe = this.invalidationBus.subscribe((message) => this.invalidate(message));
  }

  async listFeatureFlags(): Promise<FeatureFlagSnapshot[]> {
    return this.repository.listFeatureFlags();
  }

  async getFeatureFlag(flagId: string): Promise<FeatureFlagSnapshot | undefined> {
    const cached = this.featureFlags.get(flagId);
    if (cached && cached.expiresAt > this.now()) return structuredClone(cached.value);
    try {
      const value = await this.repository.getFeatureFlag(flagId);
      if (value)
        this.featureFlags.set(flagId, {
          value: structuredClone(value),
          expiresAt: this.now() + this.cacheTtlMs,
        });
      else this.featureFlags.delete(flagId);
      return value ? structuredClone(value) : undefined;
    } catch (error) {
      throw unavailable(error);
    }
  }

  async listFeatureFlagVersions(flagId: string): Promise<FeatureFlagSnapshot[]> {
    try {
      return await this.repository.listFeatureFlagVersions(flagId);
    } catch (error) {
      throw unavailable(error);
    }
  }

  async evaluateFeatureFlag(flagId: string, input: FeatureFlagEvaluationContext): Promise<boolean> {
    const context = FeatureFlagEvaluationContextSchema.parse(input);
    const flag = await this.getFeatureFlag(flagId);
    if (!flag || flag.status !== 'ACTIVE' || !flag.enabled) return false;
    const now = this.now();
    const effectiveFrom = Date.parse(flag.effectiveFrom);
    const effectiveTo = flag.effectiveTo ? Date.parse(flag.effectiveTo) : Number.POSITIVE_INFINITY;
    if (now < effectiveFrom || now >= effectiveTo) return false;
    const targeting = flag.targeting;
    if (targeting.internalOnly && context.internal !== true) return false;
    if (targeting.planIds.length && !targeting.planIds.includes(context.planId ?? '')) return false;
    if (targeting.userIds.length && !targeting.userIds.includes(context.userId ?? '')) return false;
    if (
      targeting.organizationIds.length &&
      !targeting.organizationIds.includes(context.organizationId ?? '')
    )
      return false;
    if (targeting.roomIds.length && !targeting.roomIds.includes(context.roomId ?? '')) return false;
    if (targeting.regions.length && !targeting.regions.includes(context.region ?? '')) return false;
    if (targeting.betaGroup && targeting.betaGroup !== context.betaGroup) return false;
    if (flag.scope === 'PLAN' && !context.planId) return false;
    if (flag.scope === 'USER' && !context.userId) return false;
    if (flag.scope === 'ORGANIZATION' && !context.organizationId) return false;
    if (flag.scope === 'ROOM' && !context.roomId) return false;
    if (flag.scope === 'REGION' && !context.region) return false;
    if (flag.scope === 'BETA_GROUP' && !context.betaGroup) return false;
    if (flag.rolloutPercentage >= 100) return true;
    if (flag.rolloutPercentage <= 0) return false;
    const bucketKey =
      context.bucketKey ?? context.userId ?? context.organizationId ?? context.roomId;
    if (!bucketKey) return false;
    const digest = createHash('sha256').update(`${flag.key}:${bucketKey}`).digest('hex');
    const bucket = Number.parseInt(digest.slice(0, 8), 16) % 100;
    return bucket < flag.rolloutPercentage;
  }

  async listMaintenancePolicies(): Promise<MaintenancePolicySnapshot[]> {
    try {
      return await this.repository.listMaintenancePolicies();
    } catch (error) {
      throw unavailable(error);
    }
  }

  async getMaintenancePolicy(key: MaintenanceKey): Promise<MaintenancePolicySnapshot | undefined> {
    MaintenanceKeySchema.parse(key);
    const cached = this.maintenance.get(key);
    if (cached && cached.expiresAt > this.now()) return structuredClone(cached.value);
    try {
      const value = await this.repository.getMaintenancePolicy(key);
      if (value)
        this.maintenance.set(key, {
          value: structuredClone(value),
          expiresAt: this.now() + this.cacheTtlMs,
        });
      else this.maintenance.delete(key);
      return value ? structuredClone(value) : undefined;
    } catch (error) {
      throw unavailable(error);
    }
  }

  async isMaintenanceActive(key: MaintenanceKey, planId?: string): Promise<boolean> {
    const [global, local] = await Promise.all([
      key === 'GLOBAL' ? Promise.resolve(undefined) : this.getMaintenancePolicy('GLOBAL'),
      this.getMaintenancePolicy(key),
    ]);
    return [global, local].some((policy) => {
      if (!policy || !policy.enabled) return false;
      const now = this.now();
      if (now < Date.parse(policy.effectiveFrom)) return false;
      if (policy.expectedEnd && now >= Date.parse(policy.expectedEnd)) return false;
      return !policy.affectedPlanIds.length || policy.affectedPlanIds.includes(planId ?? '');
    });
  }

  async listCapabilityPolicies(): Promise<CapabilityPolicySnapshot[]> {
    try {
      return await this.repository.listCapabilityPolicies();
    } catch (error) {
      throw unavailable(error);
    }
  }

  async getCapabilityPolicy(
    key: CapabilityPolicySnapshot['key'],
  ): Promise<CapabilityPolicySnapshot | undefined> {
    const cached = this.capabilities.get(key);
    if (cached && cached.expiresAt > this.now()) return structuredClone(cached.value);
    try {
      const value = await this.repository.getCapabilityPolicy(key);
      if (value)
        this.capabilities.set(key, {
          value: structuredClone(value),
          expiresAt: this.now() + this.cacheTtlMs,
        });
      else this.capabilities.delete(key);
      return value ? structuredClone(value) : undefined;
    } catch (error) {
      throw unavailable(error);
    }
  }

  async assertCapabilityAllowed(
    key: CapabilityPolicySnapshot['key'],
    input: CapabilityAccessContext,
  ): Promise<CapabilityPolicySnapshot> {
    const policy = await this.getCapabilityPolicy(key);
    if (!policy)
      throw new ControlPlaneError(
        'CONTROL_PLANE_UNAVAILABLE',
        `Capability policy ${key} is missing`,
      );
    if (!policy.enabled)
      throw new ControlPlaneError('CONTROL_PLANE_POLICY_DENIED', `${key} is disabled`);
    if (input.planId && policy.blockedPlanIds.includes(input.planId))
      throw new ControlPlaneError(
        'CONTROL_PLANE_POLICY_DENIED',
        `${key} is disabled for this plan`,
      );
    if (policy.allowedPlanIds.length && !policy.allowedPlanIds.includes(input.planId ?? ''))
      throw new ControlPlaneError(
        'CONTROL_PLANE_POLICY_DENIED',
        `${key} is not available for this plan`,
      );
    if (input.organizationId && policy.blockedOrganizationIds.includes(input.organizationId))
      throw new ControlPlaneError(
        'CONTROL_PLANE_POLICY_DENIED',
        `${key} is disabled for this organization`,
      );
    if (
      policy.allowedOrganizationIds.length &&
      !policy.allowedOrganizationIds.includes(input.organizationId ?? '')
    )
      throw new ControlPlaneError(
        'CONTROL_PLANE_POLICY_DENIED',
        `${key} is not available for this organization`,
      );
    if (await this.isMaintenanceActive(keyToMaintenance(key), input.planId))
      throw new ControlPlaneError('CONTROL_PLANE_POLICY_DENIED', `${key} is under maintenance`);
    return structuredClone(policy);
  }

  async listReleasePolicies(): Promise<ReleasePolicySnapshot[]> {
    try {
      return await this.repository.listReleasePolicies();
    } catch (error) {
      throw unavailable(error);
    }
  }

  async getReleasePolicy(channel: ReleaseChannel): Promise<ReleasePolicySnapshot | undefined> {
    const cached = this.releases.get(channel);
    if (cached && cached.expiresAt > this.now()) return structuredClone(cached.value);
    try {
      const value = await this.repository.getReleasePolicy(channel);
      if (value)
        this.releases.set(channel, {
          value: structuredClone(value),
          expiresAt: this.now() + this.cacheTtlMs,
        });
      else this.releases.delete(channel);
      return value ? structuredClone(value) : undefined;
    } catch (error) {
      throw unavailable(error);
    }
  }

  async resolveRelease(
    channel: ReleaseChannel,
    currentVersion: string,
  ): Promise<ReleaseResolution> {
    const policy = await this.getReleasePolicy(channel);
    if (!policy)
      throw new ControlPlaneError(
        'CONTROL_PLANE_UNAVAILABLE',
        `Release policy ${channel} is missing`,
      );
    if (policy.blockedVersions.includes(currentVersion))
      return { status: 'VERSION_BLOCKED', currentVersion, policy };
    const target = channel === 'stable' ? policy.stableVersion : policy.betaVersion;
    if (compareVersions(currentVersion, policy.minimumSupportedVersion) < 0)
      return { status: 'UPDATE_REQUIRED', currentVersion, targetVersion: target, policy };
    if (
      policy.requiredUpdateVersion &&
      compareVersions(currentVersion, policy.requiredUpdateVersion) < 0
    )
      return { status: 'UPDATE_REQUIRED', currentVersion, targetVersion: target, policy };
    if (compareVersions(currentVersion, target) < 0) {
      const status =
        compareVersions(currentVersion, policy.recommendedVersion) < 0
          ? 'UPDATE_RECOMMENDED'
          : 'UPDATE_AVAILABLE';
      return { status, currentVersion, targetVersion: target, policy };
    }
    return { status: 'CURRENT', currentVersion, policy };
  }

  async listRazorpayMappings(): Promise<RazorpayMappingSnapshot[]> {
    try {
      return await this.repository.listRazorpayMappings();
    } catch (error) {
      throw unavailable(error);
    }
  }

  async listAudit(input?: { limit?: number; offset?: number }): Promise<AuditEventInput[]> {
    try {
      return await this.repository.listAudit(input);
    } catch (error) {
      throw unavailable(error);
    }
  }

  async updateFeatureFlag(
    input: PlatformPolicyWriteContext & { snapshot: FeatureFlagSnapshot },
  ): Promise<FeatureFlagSnapshot> {
    FeatureFlagSnapshotSchema.parse(input.snapshot);
    return this.mutate(
      'admin.features',
      'FEATURE_FLAG_UPDATED',
      'feature_flag',
      input.snapshot.flagId,
      input,
      (transaction, audit) =>
        transaction.putFeatureFlag({
          snapshot: input.snapshot,
          expectedVersion: input.metadata.expectedVersion,
          audit,
        }),
    );
  }

  async updateMaintenancePolicy(
    input: PlatformPolicyWriteContext & { snapshot: MaintenancePolicySnapshot },
  ): Promise<MaintenancePolicySnapshot> {
    MaintenancePolicySnapshotSchema.parse(input.snapshot);
    return this.mutate(
      'admin.system',
      'MAINTENANCE_POLICY_UPDATED',
      'maintenance',
      input.snapshot.key,
      input,
      (transaction, audit) =>
        transaction.putMaintenancePolicy({
          snapshot: input.snapshot,
          expectedVersion: input.metadata.expectedVersion,
          audit,
        }),
    );
  }

  async updateCapabilityPolicy(
    input: PlatformPolicyWriteContext & { snapshot: CapabilityPolicySnapshot },
  ): Promise<CapabilityPolicySnapshot> {
    CapabilityPolicySnapshotSchema.parse(input.snapshot);
    return this.mutate(
      'admin.features',
      'CAPABILITY_POLICY_UPDATED',
      'capability',
      input.snapshot.key,
      input,
      (transaction, audit) =>
        transaction.putCapabilityPolicy({
          snapshot: input.snapshot,
          expectedVersion: input.metadata.expectedVersion,
          audit,
        }),
    );
  }

  async updateReleasePolicy(
    input: PlatformPolicyWriteContext & { snapshot: ReleasePolicySnapshot },
  ): Promise<ReleasePolicySnapshot> {
    ReleasePolicySnapshotSchema.parse(input.snapshot);
    return this.mutate(
      'admin.releases',
      'RELEASE_POLICY_UPDATED',
      'release_policy',
      input.snapshot.channel,
      input,
      (transaction, audit) =>
        transaction.putReleasePolicy({
          snapshot: input.snapshot,
          expectedVersion: input.metadata.expectedVersion,
          audit,
        }),
    );
  }

  async updateRazorpayMapping(
    input: PlatformPolicyWriteContext & { snapshot: RazorpayMappingSnapshot },
  ): Promise<RazorpayMappingSnapshot> {
    RazorpayMappingSnapshotSchema.parse(input.snapshot);
    return this.mutate(
      'admin.billing',
      'RAZORPAY_MAPPING_UPDATED',
      'razorpay_mapping',
      input.snapshot.mappingId,
      input,
      (transaction, audit) =>
        transaction.putRazorpayMapping({
          snapshot: input.snapshot,
          expectedVersion: input.metadata.expectedVersion,
          audit,
        }),
    );
  }

  close(): void {
    this.unsubscribe();
  }

  private async mutate<T extends { version: number }>(
    permission: Parameters<typeof hasAdminPermission>[1],
    action: string,
    targetType: string,
    targetId: string,
    input: PlatformPolicyWriteContext & { snapshot: T },
    operation: (transaction: PlatformPolicyTransaction, audit: AuditEventInput) => Promise<T>,
  ): Promise<T> {
    const permissions = input.actor.permissions;
    if (!hasAdminPermission(permissions, permission))
      throw new ControlPlaneError('CONTROL_PLANE_FORBIDDEN', `Missing permission ${permission}`);
    const before = await this.readBefore(targetType, targetId);
    const audit = redactAuditEvent(
      AuditEventInputSchema.parse({
        actor: input.actor,
        action,
        targetType,
        targetId,
        before,
        after: input.snapshot,
        reason: input.metadata.reason,
        requestId: input.metadata.requestId,
        context: input.context,
        createdAt: new Date(this.now()).toISOString(),
      }),
    );
    const updated = await this.repository.transaction((transaction) =>
      operation(transaction, audit),
    );
    await this.publishInvalidation({
      domain:
        targetType === 'feature_flag'
          ? 'features'
          : targetType === 'maintenance'
            ? 'maintenance'
            : targetType === 'release_policy'
              ? 'releases'
              : targetType === 'razorpay_mapping'
                ? 'razorpay'
                : 'capabilities',
      resourceId: targetId,
      version: updated.version,
    });
    return updated;
  }

  private async readBefore(targetType: string, targetId: string): Promise<unknown> {
    if (targetType === 'feature_flag') return this.repository.getFeatureFlag(targetId);
    if (targetType === 'maintenance')
      return this.repository.getMaintenancePolicy(MaintenanceKeySchema.parse(targetId));
    if (targetType === 'capability')
      return this.repository.getCapabilityPolicy(targetId as CapabilityPolicySnapshot['key']);
    if (targetType === 'release_policy')
      return this.repository.getReleasePolicy(targetId as ReleaseChannel);
    return (
      (await this.repository.listRazorpayMappings()).find(
        (mapping) => mapping.mappingId === targetId,
      ) ?? null
    );
  }

  private invalidate(message: InvalidationMessage): void {
    if (message.domain === 'features') this.featureFlags.delete(message.resourceId);
    if (message.domain === 'maintenance') this.maintenance.delete(message.resourceId);
    if (message.domain === 'capabilities') this.capabilities.delete(message.resourceId);
    if (message.domain === 'releases') this.releases.delete(message.resourceId);
  }

  private async publishInvalidation(message: InvalidationMessage): Promise<void> {
    this.invalidate(message);
    try {
      await this.invalidationBus.publish(message);
    } catch {
      this.invalidate(message);
    }
  }
}

export class InMemoryPlatformPolicyRepository implements PlatformPolicyRepository {
  private state: {
    featureFlags: Map<string, FeatureFlagSnapshot[]>;
    maintenance: Map<MaintenanceKey, MaintenancePolicySnapshot>;
    capabilities: Map<CapabilityPolicySnapshot['key'], CapabilityPolicySnapshot>;
    releases: Map<ReleaseChannel, ReleasePolicySnapshot>;
    razorpay: Map<string, RazorpayMappingSnapshot>;
    audit: AuditEventInput[];
  };
  failReads = false;

  constructor(
    input: {
      featureFlags?: FeatureFlagSnapshot[];
      maintenance?: MaintenancePolicySnapshot[];
      capabilities?: CapabilityPolicySnapshot[];
      releases?: ReleasePolicySnapshot[];
      razorpay?: RazorpayMappingSnapshot[];
    } = {},
  ) {
    this.state = {
      featureFlags: new Map(),
      maintenance: new Map(
        (input.maintenance ?? []).map((value) => [value.key, structuredClone(value)]),
      ),
      capabilities: new Map(
        (input.capabilities ?? []).map((value) => [value.key, structuredClone(value)]),
      ),
      releases: new Map(
        (input.releases ?? []).map((value) => [value.channel, structuredClone(value)]),
      ),
      razorpay: new Map(
        (input.razorpay ?? []).map((value) => [value.mappingId, structuredClone(value)]),
      ),
      audit: [],
    };
    for (const value of input.featureFlags ?? [])
      this.state.featureFlags.set(value.flagId, [structuredClone(value)]);
  }

  private ensureReadable(): void {
    if (this.failReads) throw new Error('platform policy read failed');
  }

  async listFeatureFlags(): Promise<FeatureFlagSnapshot[]> {
    this.ensureReadable();
    return [...this.state.featureFlags.values()].map((history) => structuredClone(history.at(-1)!));
  }
  async getFeatureFlag(flagId: string): Promise<FeatureFlagSnapshot | undefined> {
    this.ensureReadable();
    return structuredClone(this.state.featureFlags.get(flagId)?.at(-1));
  }
  async listFeatureFlagVersions(flagId: string): Promise<FeatureFlagSnapshot[]> {
    this.ensureReadable();
    return structuredClone(this.state.featureFlags.get(flagId) ?? []).reverse();
  }
  async listMaintenancePolicies(): Promise<MaintenancePolicySnapshot[]> {
    this.ensureReadable();
    return structuredClone([...this.state.maintenance.values()]);
  }
  async getMaintenancePolicy(key: MaintenanceKey): Promise<MaintenancePolicySnapshot | undefined> {
    this.ensureReadable();
    return structuredClone(this.state.maintenance.get(key));
  }
  async listCapabilityPolicies(): Promise<CapabilityPolicySnapshot[]> {
    this.ensureReadable();
    return structuredClone([...this.state.capabilities.values()]);
  }
  async getCapabilityPolicy(
    key: CapabilityPolicySnapshot['key'],
  ): Promise<CapabilityPolicySnapshot | undefined> {
    this.ensureReadable();
    return structuredClone(this.state.capabilities.get(key));
  }
  async getReleasePolicy(channel: ReleaseChannel): Promise<ReleasePolicySnapshot | undefined> {
    this.ensureReadable();
    return structuredClone(this.state.releases.get(channel));
  }
  async listReleasePolicies(): Promise<ReleasePolicySnapshot[]> {
    this.ensureReadable();
    return structuredClone([...this.state.releases.values()]);
  }
  async listRazorpayMappings(): Promise<RazorpayMappingSnapshot[]> {
    this.ensureReadable();
    return structuredClone([...this.state.razorpay.values()]);
  }
  async listAudit(input?: { limit?: number; offset?: number }): Promise<AuditEventInput[]> {
    this.ensureReadable();
    const offset = input?.offset ?? 0;
    const limit = input?.limit ?? 100;
    return structuredClone(this.state.audit)
      .reverse()
      .slice(offset, offset + limit);
  }

  async transaction<T>(
    operation: (transaction: PlatformPolicyTransaction) => Promise<T>,
  ): Promise<T> {
    const next = structuredClone(this.state);
    const transaction: PlatformPolicyTransaction = {
      putFeatureFlag: async ({ snapshot, expectedVersion, audit }) => {
        const history = next.featureFlags.get(snapshot.flagId) ?? [];
        const currentVersion = history.at(-1)?.version ?? 0;
        if (currentVersion !== expectedVersion || snapshot.version !== expectedVersion + 1)
          throw new ControlPlaneError(
            'CONTROL_PLANE_VERSION_CONFLICT',
            `Feature flag ${snapshot.flagId} version conflict`,
          );
        next.featureFlags.set(snapshot.flagId, [...history, structuredClone(snapshot)]);
        next.audit.push(structuredClone(audit));
        return structuredClone(snapshot);
      },
      putMaintenancePolicy: async ({ snapshot, expectedVersion, audit }) => {
        const currentVersion = next.maintenance.get(snapshot.key)?.version ?? 0;
        if (currentVersion !== expectedVersion || snapshot.version !== expectedVersion + 1)
          throw new ControlPlaneError(
            'CONTROL_PLANE_VERSION_CONFLICT',
            `Maintenance ${snapshot.key} version conflict`,
          );
        next.maintenance.set(snapshot.key, structuredClone(snapshot));
        next.audit.push(structuredClone(audit));
        return structuredClone(snapshot);
      },
      putCapabilityPolicy: async ({ snapshot, expectedVersion, audit }) => {
        const currentVersion = next.capabilities.get(snapshot.key)?.version ?? 0;
        if (currentVersion !== expectedVersion || snapshot.version !== expectedVersion + 1)
          throw new ControlPlaneError(
            'CONTROL_PLANE_VERSION_CONFLICT',
            `Capability ${snapshot.key} version conflict`,
          );
        next.capabilities.set(snapshot.key, structuredClone(snapshot));
        next.audit.push(structuredClone(audit));
        return structuredClone(snapshot);
      },
      putReleasePolicy: async ({ snapshot, expectedVersion, audit }) => {
        const currentVersion = next.releases.get(snapshot.channel)?.version ?? 0;
        if (currentVersion !== expectedVersion || snapshot.version !== expectedVersion + 1)
          throw new ControlPlaneError(
            'CONTROL_PLANE_VERSION_CONFLICT',
            `Release ${snapshot.channel} version conflict`,
          );
        next.releases.set(snapshot.channel, structuredClone(snapshot));
        next.audit.push(structuredClone(audit));
        return structuredClone(snapshot);
      },
      putRazorpayMapping: async ({ snapshot, expectedVersion, audit }) => {
        const currentVersion = next.razorpay.get(snapshot.mappingId)?.version ?? 0;
        if (currentVersion !== expectedVersion || snapshot.version !== expectedVersion + 1)
          throw new ControlPlaneError(
            'CONTROL_PLANE_VERSION_CONFLICT',
            `Razorpay mapping ${snapshot.mappingId} version conflict`,
          );
        next.razorpay.set(snapshot.mappingId, structuredClone(snapshot));
        next.audit.push(structuredClone(audit));
        return structuredClone(snapshot);
      },
      appendAudit: async (event) => {
        next.audit.push(structuredClone(event));
      },
    };
    const result = await operation(transaction);
    this.state = next;
    return result;
  }
}

function unavailable(error: unknown): ControlPlaneError {
  return new ControlPlaneError(
    'CONTROL_PLANE_UNAVAILABLE',
    error instanceof Error ? error.message : 'Platform policy read failed',
  );
}

function keyToMaintenance(key: CapabilityPolicySnapshot['key']): MaintenanceKey {
  return key === 'WEB_SEARCH' ? 'WEB_SEARCH' : key === 'WEB_FETCH' ? 'WEB_FETCH' : key;
}

function compareVersions(left: string, right: string): number {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0);
  }
  return 0;
}
