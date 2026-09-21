import type { Pool, PoolClient, QueryResultRow } from 'pg';
import {
  AuditEventInputSchema,
  ControlPlaneModelSnapshotSchema,
  ControlPlanePlanSnapshotSchema,
  InvalidationMessageSchema,
  type AuditEventInput,
  type ControlPlaneModelSnapshot,
  type ControlPlanePlanSnapshot,
  type InvalidationMessage,
} from '@astra/control-plane';
import { randomUUID } from 'node:crypto';
import { ControlPlaneError } from '@astra/control-plane';
import type {
  ControlPlaneRepository,
  ControlPlaneTransaction,
  InvalidationBus,
} from '@astra/control-plane';
import type { ModelWriteInput, PlanWriteInput } from '@astra/control-plane';

export const CONTROL_PLANE_NOTIFY_CHANNEL = 'astra_control_plane_changed';

export function formatInvalidationPayload(message: InvalidationMessage): string {
  return JSON.stringify(InvalidationMessageSchema.parse(message));
}

export function parseInvalidationPayload(payload: string): InvalidationMessage | undefined {
  try {
    return InvalidationMessageSchema.parse(JSON.parse(payload));
  } catch {
    return undefined;
  }
}

export async function runControlPlaneTransaction<T>(
  pool: Pick<Pool, 'connect'>,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function asJsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry)) : fallback;
}

function mapPlan(row: QueryResultRow): ControlPlanePlanSnapshot {
  return ControlPlanePlanSnapshotSchema.parse({
    id: String(row.plan_id ?? row.id),
    displayName: String(row.display_name),
    monthlyPriceInr: String(row.monthly_price_inr),
    monthlyPriceUsd: String(row.monthly_price_usd ?? '0'),
    monthlyCredits: String(row.monthly_credits),
    allowedModelIds: stringArray(row.allowed_model_ids, ['*']),
    allowedModes: stringArray(row.allowed_modes, ['BUILD']),
    maxTaskBudgetCredits: String(row.max_task_budget_credits),
    maxConcurrentJobs: Number(row.max_concurrent_jobs),
    mcpLimit: Number(row.mcp_limit),
    pluginLimit: Number(row.plugin_limit),
    premiumModeAccess: Boolean(row.premium_mode_access),
    maxContextWindow: Number(row.max_context_window),
    priority: String(row.priority) as 'standard' | 'priority' | 'highest',
    enabled: Boolean(row.enabled),
    seats: Number(row.seats),
    activeJobsPerSeat: Number(row.active_jobs_per_seat),
    pooledCredits: Boolean(row.pooled_credits),
    crossPersonRooms: Boolean(row.cross_person_rooms),
    rolloverCycles: Number(row.rollover_cycles),
    topUpEnabled: Boolean(row.top_up_enabled),
    version: Number(row.version),
    status: String(row.plan_status ?? row.status) as 'ACTIVE' | 'INACTIVE' | 'RETIRED',
    public: Boolean(row.is_public ?? row.public),
    purchaseAvailable: Boolean(row.purchase_available),
    effectiveFrom: new Date(String(row.effective_from)).toISOString(),
    effectiveTo: row.effective_to ? new Date(String(row.effective_to)).toISOString() : null,
    entitlements: asJsonRecord(row.entitlements) as Record<string, boolean>,
    limits: asJsonRecord(row.limits) as ControlPlanePlanSnapshot['limits'],
    updatedAt: new Date(String(row.updated_at ?? row.created_at)).toISOString(),
  });
}

function mapModel(row: QueryResultRow): ControlPlaneModelSnapshot {
  return ControlPlaneModelSnapshotSchema.parse({
    modelId: String(row.model_id),
    displayName: String(row.display_name),
    gatewayModelId: String(row.gateway_model_id),
    providerSlug: String(row.provider_slug),
    ...(row.provider ? { provider: String(row.provider) } : {}),
    enabled: Boolean(row.enabled),
    visible: Boolean(row.visible),
    ...(row.context_window === null || row.context_window === undefined
      ? {}
      : { contextWindow: Number(row.context_window) }),
    capabilities: row.capabilities,
    costMetadata: row.cost_metadata ?? {},
    pricingVerifiedAt:
      row.pricing_verified_at === null || row.pricing_verified_at === undefined
        ? null
        : new Date(String(row.pricing_verified_at)).toISOString(),
    ...(row.family ? { family: String(row.family) } : {}),
    ...(row.recommended !== null && row.recommended !== undefined
      ? { recommended: Boolean(row.recommended) }
      : {}),
    ...(Array.isArray(row.plan_access) ? { planAccess: row.plan_access.map(String) } : {}),
    ...(row.max_reasoning === null || row.max_reasoning === undefined
      ? {}
      : { maxReasoning: Number(row.max_reasoning) }),
    ...(row.routing_role ? { routingRole: String(row.routing_role) } : {}),
    ...(row.fallback_model_id ? { fallbackModelId: String(row.fallback_model_id) } : {}),
    ...(row.deprecated_at ? { deprecatedAt: new Date(String(row.deprecated_at)).toISOString() } : {}),
    ...(row.release_date ? { releaseDate: String(row.release_date).slice(0, 10) } : {}),
    version: Number(row.control_plane_version ?? row.version ?? 1),
    status: String(row.maintenance_status ?? 'AVAILABLE') as
      | 'AVAILABLE'
      | 'MAINTENANCE'
      | 'DEGRADED'
      | 'DISABLED',
    maintenanceMessage: row.maintenance_message ? String(row.maintenance_message) : null,
    regionAvailability: stringArray(row.region_availability, ['GLOBAL']),
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

class PostgresControlPlaneTransaction implements ControlPlaneTransaction {
  constructor(private readonly client: PoolClient) {}

  async putPlan(input: PlanWriteInput): Promise<ControlPlanePlanSnapshot> {
    const current = await this.client.query(
      'SELECT current_version FROM control_plane_plan_definitions WHERE plan_id = $1 FOR UPDATE',
      [input.plan.id],
    );
    const currentVersion = current.rows[0] ? Number(current.rows[0].current_version) : 0;
    if (currentVersion !== input.expectedVersion || input.plan.version !== currentVersion + 1)
      throw new ControlPlaneError(
        'CONTROL_PLANE_VERSION_CONFLICT',
        `Plan ${input.plan.id} is at version ${currentVersion}`,
      );

    if (!current.rows[0])
      await this.client.query(
        `INSERT INTO control_plane_plan_definitions
          (plan_id, status, is_public, purchase_available, current_version)
         VALUES ($1, $2, $3, $4, $5)`,
        [input.plan.id, input.plan.status, input.plan.public, input.plan.purchaseAvailable, input.plan.version],
      );

    await this.client.query(
      `INSERT INTO control_plane_plan_versions
        (id, plan_id, version, display_name, monthly_price_inr, monthly_price_usd,
         monthly_credits, allowed_model_ids, allowed_modes, max_task_budget_credits,
         max_concurrent_jobs, mcp_limit, plugin_limit, premium_mode_access,
         max_context_window, priority, enabled, seats, active_jobs_per_seat,
         pooled_credits, cross_person_rooms, rollover_cycles, top_up_enabled,
         entitlements, limits, effective_from, effective_to, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29)`,
      [
        randomUUID(),
        input.plan.id,
        input.plan.version,
        input.plan.displayName,
        input.plan.monthlyPriceInr,
        input.plan.monthlyPriceUsd ?? '0',
        input.plan.monthlyCredits,
        input.plan.allowedModelIds,
        input.plan.allowedModes,
        input.plan.maxTaskBudgetCredits,
        input.plan.maxConcurrentJobs,
        input.plan.mcpLimit,
        input.plan.pluginLimit,
        input.plan.premiumModeAccess,
        input.plan.maxContextWindow,
        input.plan.priority,
        input.plan.enabled,
        input.plan.seats,
        input.plan.activeJobsPerSeat,
        input.plan.pooledCredits,
        input.plan.crossPersonRooms,
        input.plan.rolloverCycles,
        input.plan.topUpEnabled,
        input.plan.entitlements,
        input.plan.limits,
        input.plan.effectiveFrom,
        input.plan.effectiveTo,
        input.audit.actor.userId,
      ],
    );
    await this.client.query(
      `UPDATE control_plane_plan_definitions
       SET status = $2, is_public = $3, purchase_available = $4, current_version = $5, updated_at = now()
       WHERE plan_id = $1`,
      [input.plan.id, input.plan.status, input.plan.public, input.plan.purchaseAvailable, input.plan.version],
    );
    await this.client.query(
      `INSERT INTO control_plane_plan_entitlements(plan_id, version, entitlement_key, enabled)
       SELECT $1, $2, entry.key, entry.value::boolean FROM jsonb_each_text($3::jsonb) entry`,
      [input.plan.id, input.plan.version, input.plan.entitlements],
    );
    await this.client.query(
      `INSERT INTO control_plane_plan_limits(plan_id, version, limit_key, limit_kind, numeric_value)
       SELECT $1, $2, entry.key, entry.value->>'kind',
              CASE WHEN entry.value->>'kind' = 'NUMERIC' THEN (entry.value->>'value')::integer ELSE NULL END
       FROM jsonb_each($3::jsonb) entry`,
      [input.plan.id, input.plan.version, input.plan.limits],
    );
    await this.appendAudit(input.audit);
    await this.notify({ domain: 'plans', resourceId: input.plan.id, version: input.plan.version });
    return structuredClone(input.plan);
  }

  async putModel(input: ModelWriteInput): Promise<ControlPlaneModelSnapshot> {
    const current = await this.client.query(
      'SELECT control_plane_version FROM model_catalog WHERE model_id = $1 FOR UPDATE',
      [input.model.modelId],
    );
    const currentVersion = current.rows[0] ? Number(current.rows[0].control_plane_version ?? 1) : 0;
    if (currentVersion !== input.expectedVersion || input.model.version !== currentVersion + 1)
      throw new ControlPlaneError(
        'CONTROL_PLANE_VERSION_CONFLICT',
        `Model ${input.model.modelId} is at version ${currentVersion}`,
      );
    await this.client.query(
      `INSERT INTO control_plane_model_history(model_id, version, snapshot, changed_by)
       VALUES ($1, $2, $3, $4)`,
      [input.model.modelId, input.model.version, input.model, input.audit.actor.userId],
    );
    await this.client.query(
      `UPDATE model_catalog SET display_name = $2, gateway_model_id = $3, provider_slug = $4,
        provider = $5, enabled = $6, visible = $7, context_window = $8, capabilities = $9,
        cost_metadata = $10, maintenance_status = $11, maintenance_message = $12,
        region_availability = $13, control_plane_version = $14, updated_at = now()
       WHERE model_id = $1`,
      [
        input.model.modelId,
        input.model.displayName,
        input.model.gatewayModelId,
        input.model.providerSlug,
        input.model.provider ?? input.model.providerSlug,
        input.model.enabled,
        input.model.visible ?? true,
        input.model.contextWindow ?? null,
        input.model.capabilities,
        input.model.costMetadata ?? {},
        input.model.status,
        input.model.maintenanceMessage,
        input.model.regionAvailability,
        input.model.version,
      ],
    );
    await this.appendAudit(input.audit);
    await this.notify({ domain: 'models', resourceId: input.model.modelId, version: input.model.version });
    return structuredClone(input.model);
  }

  async appendAudit(event: AuditEventInput): Promise<void> {
    const parsed = AuditEventInputSchema.parse(event);
    await this.client.query(
      `INSERT INTO admin_audit_log
        (id, actor_user_id, role, permissions, action, target_type, target_id,
         before_state, after_state, reason, request_id, session_id, device_id,
         ip_address, user_agent, redacted, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, true, $16)`,
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

  private async notify(message: InvalidationMessage): Promise<void> {
    await this.client.query('SELECT pg_notify($1, $2)', [
      CONTROL_PLANE_NOTIFY_CHANNEL,
      formatInvalidationPayload(message),
    ]);
  }
}

export class PostgresControlPlaneRepository implements ControlPlaneRepository {
  constructor(private readonly pool: Pool) {}

  async listPlans(): Promise<ControlPlanePlanSnapshot[]> {
    const result = await this.pool.query(
      `SELECT v.*, d.status AS plan_status, d.is_public, d.purchase_available, d.updated_at
       FROM control_plane_plan_versions v
       JOIN control_plane_plan_definitions d ON d.plan_id = v.plan_id AND d.current_version = v.version
       ORDER BY v.plan_id`,
    );
    return result.rows.map(mapPlan);
  }

  async getPlan(planId: string): Promise<ControlPlanePlanSnapshot | undefined> {
    const result = await this.pool.query(
      `SELECT v.*, d.status AS plan_status, d.is_public, d.purchase_available, d.updated_at
       FROM control_plane_plan_versions v
       JOIN control_plane_plan_definitions d ON d.plan_id = v.plan_id AND d.current_version = v.version
       WHERE v.plan_id = $1`,
      [planId],
    );
    return result.rows[0] ? mapPlan(result.rows[0]) : undefined;
  }

  async listPlanVersions(planId: string): Promise<ControlPlanePlanSnapshot[]> {
    const result = await this.pool.query(
      `SELECT v.*, d.status AS plan_status, d.is_public, d.purchase_available, d.updated_at
       FROM control_plane_plan_versions v
       JOIN control_plane_plan_definitions d ON d.plan_id = v.plan_id
       WHERE v.plan_id = $1 ORDER BY v.version DESC`,
      [planId],
    );
    return result.rows.map(mapPlan);
  }

  async listModels(): Promise<ControlPlaneModelSnapshot[]> {
    const result = await this.pool.query(
      'SELECT * FROM model_catalog ORDER BY display_name ASC',
    );
    return result.rows.map(mapModel);
  }

  async getModel(modelId: string): Promise<ControlPlaneModelSnapshot | undefined> {
    const result = await this.pool.query('SELECT * FROM model_catalog WHERE model_id = $1', [modelId]);
    return result.rows[0] ? mapModel(result.rows[0]) : undefined;
  }

  async listAudit(input: { limit?: number; offset?: number } = {}): Promise<AuditEventInput[]> {
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 1000);
    const offset = Math.max(input.offset ?? 0, 0);
    const result = await this.pool.query(
      `SELECT * FROM admin_audit_log ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return result.rows.map(mapAudit);
  }

  async transaction<T>(operation: (transaction: ControlPlaneTransaction) => Promise<T>): Promise<T> {
    return runControlPlaneTransaction(this.pool, async (client) =>
      operation(new PostgresControlPlaneTransaction(client)),
    );
  }
}

export class PostgresInvalidationBus implements InvalidationBus {
  private readonly listeners = new Set<(message: InvalidationMessage) => void>();
  private listenerClient: PoolClient | undefined;

  constructor(private readonly pool: Pool) {}

  async start(): Promise<void> {
    if (this.listenerClient) return;
    const client = await this.pool.connect();
    this.listenerClient = client;
    client.on('notification', (notification) => {
      if (notification.channel !== CONTROL_PLANE_NOTIFY_CHANNEL || !notification.payload) return;
      const message = parseInvalidationPayload(notification.payload);
      if (!message) return;
      for (const listener of this.listeners) listener(message);
    });
    await client.query(`LISTEN ${CONTROL_PLANE_NOTIFY_CHANNEL}`);
  }

  async publish(message: InvalidationMessage): Promise<void> {
    await this.pool.query('SELECT pg_notify($1, $2)', [
      CONTROL_PLANE_NOTIFY_CHANNEL,
      formatInvalidationPayload(message),
    ]);
  }

  subscribe(listener: (message: InvalidationMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async close(): Promise<void> {
    this.listenerClient?.release();
    this.listenerClient = undefined;
  }
}

export async function bootstrapControlPlane(pool: Pick<Pool, 'query'>): Promise<void> {
  const result = await pool.query(
    'SELECT count(*)::integer AS count FROM control_plane_plan_definitions',
  );
  if (Number(result.rows[0]?.count ?? 0) === 0)
    throw new ControlPlaneError('CONTROL_PLANE_UNAVAILABLE', 'No control-plane plan definitions are configured');
}
