import type { Pool, PoolClient, QueryResultRow } from 'pg';
import {
  AuditEventInputSchema,
  CapabilityPolicySnapshotSchema,
  FeatureFlagSnapshotSchema,
  MaintenancePolicySnapshotSchema,
  RazorpayMappingSnapshotSchema,
  ReleasePolicySnapshotSchema,
  type AuditEventInput,
  type CapabilityPolicySnapshot,
  type FeatureFlagSnapshot,
  type MaintenanceKey,
  type MaintenancePolicySnapshot,
  type RazorpayMappingSnapshot,
  type ReleaseChannel,
  type ReleasePolicySnapshot,
} from '@astra/control-plane';
import { ControlPlaneError } from '@astra/control-plane';
import type { PlatformPolicyRepository, PlatformPolicyTransaction } from '@astra/control-plane';
import { randomUUID } from 'node:crypto';
import {
  CONTROL_PLANE_NOTIFY_CHANNEL,
  formatInvalidationPayload,
  runControlPlaneTransaction,
} from './postgres-control-plane.js';

const asArray = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

function mapFeatureFlag(row: QueryResultRow): FeatureFlagSnapshot {
  return FeatureFlagSnapshotSchema.parse({
    flagId: String(row.flag_id),
    key: String(row.flag_key),
    description: String(row.description),
    enabled: Boolean(row.enabled),
    scope: String(row.scope),
    targeting: row.targeting ?? {},
    rolloutPercentage: Number(row.rollout_percentage),
    effectiveFrom: new Date(String(row.effective_from)).toISOString(),
    effectiveTo: row.effective_to ? new Date(String(row.effective_to)).toISOString() : null,
    status: String(row.status),
    version: Number(row.version),
    createdBy: String(row.created_by),
    updatedBy: String(row.updated_by),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  });
}

function mapMaintenance(row: QueryResultRow): MaintenancePolicySnapshot {
  return MaintenancePolicySnapshotSchema.parse({
    key: String(row.policy_key),
    enabled: Boolean(row.enabled),
    message: String(row.message),
    effectiveFrom: new Date(String(row.effective_from)).toISOString(),
    expectedEnd: row.expected_end ? new Date(String(row.expected_end)).toISOString() : null,
    affectedPlanIds: asArray(row.affected_plan_ids),
    emergencyOverride: Boolean(row.emergency_override),
    version: Number(row.version),
    updatedBy: String(row.updated_by),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  });
}

function mapCapability(row: QueryResultRow): CapabilityPolicySnapshot {
  return CapabilityPolicySnapshotSchema.parse({
    key: String(row.policy_key),
    enabled: Boolean(row.enabled),
    allowedPlanIds: asArray(row.allowed_plan_ids),
    blockedPlanIds: asArray(row.blocked_plan_ids),
    allowedOrganizationIds: asArray(row.allowed_organization_ids),
    blockedOrganizationIds: asArray(row.blocked_organization_ids),
    allowedServers: asArray(row.allowed_servers),
    blockedServers: asArray(row.blocked_servers),
    allowedTransports: asArray(row.allowed_transports),
    requireApproval: Boolean(row.require_approval),
    maxDevices: row.max_devices === null ? null : Number(row.max_devices),
    maxConcurrentSessions:
      row.max_concurrent_sessions === null ? null : Number(row.max_concurrent_sessions),
    sessionTimeoutSeconds:
      row.session_timeout_seconds === null ? null : Number(row.session_timeout_seconds),
    periodLimit: row.period_limit === null ? null : Number(row.period_limit),
    version: Number(row.version),
    updatedBy: String(row.updated_by),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  });
}

function mapRelease(row: QueryResultRow): ReleasePolicySnapshot {
  return ReleasePolicySnapshotSchema.parse({
    channel: String(row.channel),
    stableVersion: String(row.stable_version),
    betaVersion: String(row.beta_version),
    minimumSupportedVersion: String(row.minimum_supported_version),
    recommendedVersion: String(row.recommended_version),
    requiredUpdateVersion: row.required_update_version ? String(row.required_update_version) : null,
    blockedVersions: asArray(row.blocked_versions),
    releaseNotesUrl: row.release_notes_url ? String(row.release_notes_url) : null,
    downloadUrl: row.download_url ? String(row.download_url) : null,
    version: Number(row.version),
    updatedBy: String(row.updated_by),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  });
}

function mapRazorpay(row: QueryResultRow): RazorpayMappingSnapshot {
  return RazorpayMappingSnapshotSchema.parse({
    mappingId: String(row.mapping_id),
    entityType: String(row.entity_type),
    entityId: String(row.entity_id),
    pricingVersion: row.pricing_version === null ? null : Number(row.pricing_version),
    region: String(row.pricing_region),
    currency: String(row.currency),
    providerProductId: String(row.provider_product_id),
    interval: String(row.payment_interval),
    active: Boolean(row.active),
    version: Number(row.version),
    updatedBy: String(row.updated_by),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  });
}

function mapAudit(row: QueryResultRow): AuditEventInput {
  return AuditEventInputSchema.parse({
    actor: {
      userId: String(row.actor_user_id),
      role: String(row.role),
      permissions: Array.isArray(row.permissions) ? row.permissions : [],
    },
    action: String(row.action),
    targetType: String(row.target_type),
    targetId: String(row.target_id),
    before: row.before_state ?? null,
    after: row.after_state ?? null,
    reason: String(row.reason),
    requestId: String(row.request_id ?? ''),
    context: {
      sessionId: row.session_id ? String(row.session_id) : null,
      deviceId: row.device_id ? String(row.device_id) : null,
      ipAddress: row.ip_address ? String(row.ip_address) : null,
      userAgent: row.user_agent ? String(row.user_agent) : null,
    },
    createdAt: new Date(String(row.created_at)).toISOString(),
  });
}

class PostgresPlatformPolicyTransaction implements PlatformPolicyTransaction {
  constructor(private readonly client: PoolClient) {}

  async putFeatureFlag(input: {
    snapshot: FeatureFlagSnapshot;
    expectedVersion: number;
    audit: AuditEventInput;
  }): Promise<FeatureFlagSnapshot> {
    const current = await this.client.query(
      'SELECT version FROM control_plane_feature_flag_versions WHERE flag_id = $1 ORDER BY version DESC LIMIT 1 FOR UPDATE',
      [input.snapshot.flagId],
    );
    this.assertVersion(
      current.rows[0] ? Number(current.rows[0].version) : 0,
      input.expectedVersion,
      input.snapshot.version,
      input.snapshot.flagId,
    );
    await this.client.query(
      `INSERT INTO control_plane_feature_flag_versions
       (flag_id, version, flag_key, description, enabled, scope, targeting, rollout_percentage,
        effective_from, effective_to, status, created_by, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        input.snapshot.flagId,
        input.snapshot.version,
        input.snapshot.key,
        input.snapshot.description,
        input.snapshot.enabled,
        input.snapshot.scope,
        input.snapshot.targeting,
        input.snapshot.rolloutPercentage,
        input.snapshot.effectiveFrom,
        input.snapshot.effectiveTo,
        input.snapshot.status,
        input.snapshot.createdBy,
        input.snapshot.updatedBy,
        input.snapshot.updatedAt,
      ],
    );
    await this.appendAudit(input.audit);
    await this.notify('features', input.snapshot.flagId, input.snapshot.version);
    return structuredClone(input.snapshot);
  }

  async putMaintenancePolicy(input: {
    snapshot: MaintenancePolicySnapshot;
    expectedVersion: number;
    audit: AuditEventInput;
  }): Promise<MaintenancePolicySnapshot> {
    const current = await this.client.query(
      'SELECT version FROM control_plane_maintenance_policies WHERE policy_key = $1 FOR UPDATE',
      [input.snapshot.key],
    );
    this.assertVersion(
      current.rows[0] ? Number(current.rows[0].version) : 0,
      input.expectedVersion,
      input.snapshot.version,
      input.snapshot.key,
    );
    await this.client.query(
      `INSERT INTO control_plane_maintenance_policies
       (policy_key, version, enabled, message, effective_from, expected_end, affected_plan_ids,
        emergency_override, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (policy_key) DO UPDATE SET version=EXCLUDED.version, enabled=EXCLUDED.enabled,
        message=EXCLUDED.message, effective_from=EXCLUDED.effective_from, expected_end=EXCLUDED.expected_end,
        affected_plan_ids=EXCLUDED.affected_plan_ids, emergency_override=EXCLUDED.emergency_override,
        updated_by=EXCLUDED.updated_by, updated_at=EXCLUDED.updated_at`,
      [
        input.snapshot.key,
        input.snapshot.version,
        input.snapshot.enabled,
        input.snapshot.message,
        input.snapshot.effectiveFrom,
        input.snapshot.expectedEnd,
        input.snapshot.affectedPlanIds,
        input.snapshot.emergencyOverride,
        input.snapshot.updatedBy,
        input.snapshot.updatedAt,
      ],
    );
    await this.appendAudit(input.audit);
    await this.notify('maintenance', input.snapshot.key, input.snapshot.version);
    return structuredClone(input.snapshot);
  }

  async putCapabilityPolicy(input: {
    snapshot: CapabilityPolicySnapshot;
    expectedVersion: number;
    audit: AuditEventInput;
  }): Promise<CapabilityPolicySnapshot> {
    const current = await this.client.query(
      'SELECT version FROM control_plane_capability_policies WHERE policy_key = $1 FOR UPDATE',
      [input.snapshot.key],
    );
    this.assertVersion(
      current.rows[0] ? Number(current.rows[0].version) : 0,
      input.expectedVersion,
      input.snapshot.version,
      input.snapshot.key,
    );
    await this.client.query(
      `INSERT INTO control_plane_capability_policies
       (policy_key, version, enabled, allowed_plan_ids, blocked_plan_ids, allowed_organization_ids,
        blocked_organization_ids, allowed_servers, blocked_servers, allowed_transports, require_approval,
        max_devices, max_concurrent_sessions, session_timeout_seconds, period_limit, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (policy_key) DO UPDATE SET version=EXCLUDED.version, enabled=EXCLUDED.enabled,
        allowed_plan_ids=EXCLUDED.allowed_plan_ids, blocked_plan_ids=EXCLUDED.blocked_plan_ids,
        allowed_organization_ids=EXCLUDED.allowed_organization_ids, blocked_organization_ids=EXCLUDED.blocked_organization_ids,
        allowed_servers=EXCLUDED.allowed_servers, blocked_servers=EXCLUDED.blocked_servers,
        allowed_transports=EXCLUDED.allowed_transports, require_approval=EXCLUDED.require_approval,
        max_devices=EXCLUDED.max_devices, max_concurrent_sessions=EXCLUDED.max_concurrent_sessions,
        session_timeout_seconds=EXCLUDED.session_timeout_seconds, period_limit=EXCLUDED.period_limit,
        updated_by=EXCLUDED.updated_by, updated_at=EXCLUDED.updated_at`,
      [
        input.snapshot.key,
        input.snapshot.version,
        input.snapshot.enabled,
        input.snapshot.allowedPlanIds,
        input.snapshot.blockedPlanIds,
        input.snapshot.allowedOrganizationIds,
        input.snapshot.blockedOrganizationIds,
        input.snapshot.allowedServers,
        input.snapshot.blockedServers,
        input.snapshot.allowedTransports,
        input.snapshot.requireApproval,
        input.snapshot.maxDevices,
        input.snapshot.maxConcurrentSessions,
        input.snapshot.sessionTimeoutSeconds,
        input.snapshot.periodLimit,
        input.snapshot.updatedBy,
        input.snapshot.updatedAt,
      ],
    );
    await this.appendAudit(input.audit);
    await this.notify('capabilities', input.snapshot.key, input.snapshot.version);
    return structuredClone(input.snapshot);
  }

  async putReleasePolicy(input: {
    snapshot: ReleasePolicySnapshot;
    expectedVersion: number;
    audit: AuditEventInput;
  }): Promise<ReleasePolicySnapshot> {
    const current = await this.client.query(
      'SELECT version FROM control_plane_release_policies WHERE channel = $1 FOR UPDATE',
      [input.snapshot.channel],
    );
    this.assertVersion(
      current.rows[0] ? Number(current.rows[0].version) : 0,
      input.expectedVersion,
      input.snapshot.version,
      input.snapshot.channel,
    );
    await this.client.query(
      `INSERT INTO control_plane_release_policies
       (channel, version, stable_version, beta_version, minimum_supported_version, recommended_version,
        required_update_version, blocked_versions, release_notes_url, download_url, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (channel) DO UPDATE SET version=EXCLUDED.version, stable_version=EXCLUDED.stable_version,
        beta_version=EXCLUDED.beta_version, minimum_supported_version=EXCLUDED.minimum_supported_version,
        recommended_version=EXCLUDED.recommended_version, required_update_version=EXCLUDED.required_update_version,
        blocked_versions=EXCLUDED.blocked_versions, release_notes_url=EXCLUDED.release_notes_url,
        download_url=EXCLUDED.download_url, updated_by=EXCLUDED.updated_by, updated_at=EXCLUDED.updated_at`,
      [
        input.snapshot.channel,
        input.snapshot.version,
        input.snapshot.stableVersion,
        input.snapshot.betaVersion,
        input.snapshot.minimumSupportedVersion,
        input.snapshot.recommendedVersion,
        input.snapshot.requiredUpdateVersion,
        input.snapshot.blockedVersions,
        input.snapshot.releaseNotesUrl,
        input.snapshot.downloadUrl,
        input.snapshot.updatedBy,
        input.snapshot.updatedAt,
      ],
    );
    await this.appendAudit(input.audit);
    await this.notify('releases', input.snapshot.channel, input.snapshot.version);
    return structuredClone(input.snapshot);
  }

  async putRazorpayMapping(input: {
    snapshot: RazorpayMappingSnapshot;
    expectedVersion: number;
    audit: AuditEventInput;
  }): Promise<RazorpayMappingSnapshot> {
    const current = await this.client.query(
      'SELECT version FROM control_plane_razorpay_mappings WHERE mapping_id = $1 FOR UPDATE',
      [input.snapshot.mappingId],
    );
    this.assertVersion(
      current.rows[0] ? Number(current.rows[0].version) : 0,
      input.expectedVersion,
      input.snapshot.version,
      input.snapshot.mappingId,
    );
    await this.client.query(
      `INSERT INTO control_plane_razorpay_mappings
       (mapping_id, version, entity_type, entity_id, pricing_version, pricing_region, currency,
        provider_product_id, payment_interval, active, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (mapping_id) DO UPDATE SET version=EXCLUDED.version, entity_type=EXCLUDED.entity_type,
        entity_id=EXCLUDED.entity_id, pricing_version=EXCLUDED.pricing_version, pricing_region=EXCLUDED.pricing_region,
        currency=EXCLUDED.currency, provider_product_id=EXCLUDED.provider_product_id,
        payment_interval=EXCLUDED.payment_interval, active=EXCLUDED.active, updated_by=EXCLUDED.updated_by,
        updated_at=EXCLUDED.updated_at`,
      [
        input.snapshot.mappingId,
        input.snapshot.version,
        input.snapshot.entityType,
        input.snapshot.entityId,
        input.snapshot.pricingVersion,
        input.snapshot.region,
        input.snapshot.currency,
        input.snapshot.providerProductId,
        input.snapshot.interval,
        input.snapshot.active,
        input.snapshot.updatedBy,
        input.snapshot.updatedAt,
      ],
    );
    await this.appendAudit(input.audit);
    await this.notify('razorpay', input.snapshot.mappingId, input.snapshot.version);
    return structuredClone(input.snapshot);
  }

  async appendAudit(event: AuditEventInput): Promise<void> {
    const parsed = AuditEventInputSchema.parse(event);
    await this.client.query(
      `INSERT INTO admin_audit_log
       (id, actor_user_id, role, permissions, action, target_type, target_id, before_state, after_state,
        reason, request_id, session_id, device_id, ip_address, user_agent, redacted, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,true,$16)`,
      [
        randomUUID(),
        parsed.actor.userId,
        parsed.actor.role,
        parsed.actor.permissions,
        parsed.action,
        parsed.targetType,
        parsed.targetId,
        parsed.before,
        parsed.after,
        parsed.reason,
        parsed.requestId,
        parsed.context.sessionId ?? null,
        parsed.context.deviceId ?? null,
        parsed.context.ipAddress ?? null,
        parsed.context.userAgent ?? null,
        parsed.createdAt,
      ],
    );
  }

  private assertVersion(current: number, expected: number, next: number, id: string): void {
    if (current !== expected || next !== current + 1)
      throw new ControlPlaneError(
        'CONTROL_PLANE_VERSION_CONFLICT',
        `Platform policy ${id} is at version ${current}`,
      );
  }

  private async notify(
    domain: 'features' | 'maintenance' | 'capabilities' | 'releases' | 'razorpay',
    resourceId: string,
    version: number,
  ): Promise<void> {
    await this.client.query('SELECT pg_notify($1, $2)', [
      CONTROL_PLANE_NOTIFY_CHANNEL,
      formatInvalidationPayload({ domain, resourceId, version }),
    ]);
  }
}

export class PostgresPlatformPolicyRepository implements PlatformPolicyRepository {
  constructor(private readonly pool: Pool) {}

  async listFeatureFlags(): Promise<FeatureFlagSnapshot[]> {
    const result = await this.pool.query(
      'SELECT DISTINCT ON (flag_id) * FROM control_plane_feature_flag_versions ORDER BY flag_id, version DESC',
    );
    return result.rows.map(mapFeatureFlag);
  }
  async getFeatureFlag(flagId: string): Promise<FeatureFlagSnapshot | undefined> {
    const result = await this.pool.query(
      'SELECT * FROM control_plane_feature_flag_versions WHERE flag_id = $1 ORDER BY version DESC LIMIT 1',
      [flagId],
    );
    return result.rows[0] ? mapFeatureFlag(result.rows[0]) : undefined;
  }
  async listFeatureFlagVersions(flagId: string): Promise<FeatureFlagSnapshot[]> {
    const result = await this.pool.query(
      'SELECT * FROM control_plane_feature_flag_versions WHERE flag_id = $1 ORDER BY version DESC',
      [flagId],
    );
    return result.rows.map(mapFeatureFlag);
  }
  async listMaintenancePolicies(): Promise<MaintenancePolicySnapshot[]> {
    const result = await this.pool.query(
      'SELECT * FROM control_plane_maintenance_policies ORDER BY policy_key',
    );
    return result.rows.map(mapMaintenance);
  }
  async getMaintenancePolicy(key: MaintenanceKey): Promise<MaintenancePolicySnapshot | undefined> {
    const result = await this.pool.query(
      'SELECT * FROM control_plane_maintenance_policies WHERE policy_key = $1',
      [key],
    );
    return result.rows[0] ? mapMaintenance(result.rows[0]) : undefined;
  }
  async listCapabilityPolicies(): Promise<CapabilityPolicySnapshot[]> {
    const result = await this.pool.query(
      'SELECT * FROM control_plane_capability_policies ORDER BY policy_key',
    );
    return result.rows.map(mapCapability);
  }
  async getCapabilityPolicy(
    key: CapabilityPolicySnapshot['key'],
  ): Promise<CapabilityPolicySnapshot | undefined> {
    const result = await this.pool.query(
      'SELECT * FROM control_plane_capability_policies WHERE policy_key = $1',
      [key],
    );
    return result.rows[0] ? mapCapability(result.rows[0]) : undefined;
  }
  async listReleasePolicies(): Promise<ReleasePolicySnapshot[]> {
    const result = await this.pool.query(
      'SELECT * FROM control_plane_release_policies ORDER BY channel',
    );
    return result.rows.map(mapRelease);
  }
  async getReleasePolicy(channel: ReleaseChannel): Promise<ReleasePolicySnapshot | undefined> {
    const result = await this.pool.query(
      'SELECT * FROM control_plane_release_policies WHERE channel = $1',
      [channel],
    );
    return result.rows[0] ? mapRelease(result.rows[0]) : undefined;
  }
  async listRazorpayMappings(): Promise<RazorpayMappingSnapshot[]> {
    const result = await this.pool.query(
      'SELECT * FROM control_plane_razorpay_mappings ORDER BY mapping_id',
    );
    return result.rows.map(mapRazorpay);
  }
  async listAudit(input: { limit?: number; offset?: number } = {}): Promise<AuditEventInput[]> {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 1000);
    const offset = Math.max(input.offset ?? 0, 0);
    const result = await this.pool.query(
      'SELECT * FROM admin_audit_log ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2',
      [limit, offset],
    );
    return result.rows.map(mapAudit);
  }
  async transaction<T>(
    operation: (transaction: PlatformPolicyTransaction) => Promise<T>,
  ): Promise<T> {
    return runControlPlaneTransaction(this.pool, async (client) =>
      operation(new PostgresPlatformPolicyTransaction(client)),
    );
  }
}
