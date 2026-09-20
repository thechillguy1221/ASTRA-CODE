import { Pool, type PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  AgentEventSchema,
  ModelCatalogEntrySchema,
  UsageReceiptSchema,
  type AgentEvent,
  type ModelCatalogEntry,
  type UsageReceipt,
} from '@lyntar/contracts';
import type { AgentEventStore, ModelCatalogStore, UsageReceiptStore } from './repositories.js';
import { PostgresAuthStore } from './postgres-auth.js';
import { PostgresBillingStore } from './postgres-billing.js';
import { PostgresAdminAnalytics, PostgresEmailPreferenceStore } from './postgres-analytics.js';
import { PostgresEmailCampaignStore, PostgresEmailDeliveryStore } from './postgres-email.js';
import { PostgresOAuthTransactionStore } from './postgres-oauth.js';
import { PostgresAdminAuditStore } from './postgres-admin.js';
import type { AuthStore } from '@lyntar/auth';
import type { BillingStore } from '@lyntar/billing';
import { PostgresRateLimitStore } from './postgres-rate-limit.js';
import { PostgresRemoteAccessService } from './postgres-remote.js';
import type { RemoteAccessPort } from '@lyntar/remote-protocol';

export interface PostgresStores {
  pool: Pool;
  catalog: ModelCatalogStore;
  receipts: UsageReceiptStore;
  events: AgentEventStore;
  auth: AuthStore;
  billing: BillingStore;
  emailPreferences: PostgresEmailPreferenceStore;
  emailDeliveries: PostgresEmailDeliveryStore;
  emailCampaigns: PostgresEmailCampaignStore;
  oauth: PostgresOAuthTransactionStore;
  audit: PostgresAdminAuditStore;
  analytics: PostgresAdminAnalytics;
  rateLimiter: PostgresRateLimitStore;
  remote: RemoteAccessPort;
}

function mapCatalogRow(row: Record<string, unknown>): ModelCatalogEntry {
  const provider = row.provider ?? row.provider_slug;
  return ModelCatalogEntrySchema.parse({
    modelId: row.model_id,
    displayName: row.display_name,
    gatewayModelId: row.gateway_model_id,
    providerSlug: row.provider_slug,
    provider,
    enabled: row.enabled,
    visible: row.visible,
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
    ...(Array.isArray(row.plan_access)
      ? { planAccess: row.plan_access.map((value) => String(value)) }
      : {}),
    ...(row.max_reasoning === null || row.max_reasoning === undefined
      ? {}
      : { maxReasoning: Number(row.max_reasoning) }),
    ...(row.routing_role ? { routingRole: String(row.routing_role) } : {}),
    ...(row.fallback_model_id === null || row.fallback_model_id === undefined
      ? {}
      : { fallbackModelId: String(row.fallback_model_id) }),
    ...(row.deprecated_at === null || row.deprecated_at === undefined
      ? {}
      : { deprecatedAt: new Date(String(row.deprecated_at)).toISOString() }),
    ...(row.release_date === null || row.release_date === undefined
      ? {}
      : { releaseDate: String(row.release_date).slice(0, 10) }),
  });
}

function mapReceiptRow(row: Record<string, unknown>): UsageReceipt {
  return UsageReceiptSchema.parse({
    ...(row.id ? { id: String(row.id) } : {}),
    requestId: row.request_id,
    gatewayRequestId: row.gateway_request_id ?? null,
    taskId: row.task_id,
    agentTaskId: row.agent_task_id ?? row.task_id,
    agentSessionId: row.agent_session_id ?? null,
    modelId: row.model_id,
    gatewayModelId: row.gateway_model_id ?? null,
    provider: row.provider ?? null,
    providerRoute: row.provider_route,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheTokens: row.cache_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheWriteTokens: row.cache_write_tokens,
    reasoningUnits: row.reasoning_units === null ? null : Number(row.reasoning_units),
    otherBillableUnits: row.other_billable_units === null ? null : Number(row.other_billable_units),
    actualCostUsd: row.actual_cost_usd === null ? null : Number(row.actual_cost_usd),
    calculatedExpectedCostUsd:
      row.calculated_expected_cost_usd === null ? null : Number(row.calculated_expected_cost_usd),
    costDifferenceUsd: row.cost_difference_usd === null ? null : Number(row.cost_difference_usd),
    billingAnomaly: row.billing_anomaly,
    receivedAt: new Date(String(row.received_at)).toISOString(),
    createdAt: row.created_at ? new Date(String(row.created_at)).toISOString() : undefined,
  });
}

export class PostgresUsageReceiptStore implements UsageReceiptStore {
  constructor(private readonly pool: Pool) {}

  async save(receipt: UsageReceipt): Promise<void> {
    await this.pool.query(
      `INSERT INTO usage_receipts
        (id, request_id, gateway_request_id, task_id, agent_task_id, agent_session_id, model_id,
         gateway_model_id, provider, provider_route, input_tokens, output_tokens, cache_tokens,
         cache_read_tokens, cache_write_tokens, reasoning_units, other_billable_units,
         actual_cost_usd, calculated_expected_cost_usd, cost_difference_usd, billing_anomaly,
         received_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
       ON CONFLICT (request_id) DO NOTHING`,
      [
        receipt.id ?? randomUUID(),
        receipt.requestId,
        receipt.gatewayRequestId ?? null,
        receipt.taskId,
        receipt.agentTaskId ?? receipt.taskId,
        receipt.agentSessionId ?? null,
        receipt.modelId,
        receipt.gatewayModelId ?? null,
        receipt.provider ?? null,
        receipt.providerRoute,
        receipt.inputTokens,
        receipt.outputTokens,
        receipt.cacheTokens,
        receipt.cacheReadTokens ?? receipt.cacheTokens,
        receipt.cacheWriteTokens ?? null,
        receipt.reasoningUnits ?? null,
        receipt.otherBillableUnits ?? null,
        receipt.actualCostUsd,
        receipt.calculatedExpectedCostUsd ?? null,
        receipt.costDifferenceUsd ?? null,
        receipt.billingAnomaly ?? false,
        receipt.receivedAt,
        receipt.createdAt ?? receipt.receivedAt,
      ],
    );
  }

  async listForTask(taskId: string): Promise<UsageReceipt[]> {
    const result = await this.pool.query(
      'SELECT * FROM usage_receipts WHERE task_id = $1 ORDER BY received_at ASC',
      [taskId],
    );
    return result.rows.map((row) => mapReceiptRow(row));
  }
}

export class PostgresAgentEventStore implements AgentEventStore {
  constructor(private readonly pool: Pool) {}

  async append(event: AgentEvent): Promise<void> {
    const parsed = AgentEventSchema.parse(event);
    await this.pool.query(
      `INSERT INTO agent_events (event_id, task_id, event_type, payload, occurred_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (event_id) DO NOTHING`,
      [parsed.eventId, parsed.taskId, parsed.type, parsed.payload, parsed.occurredAt],
    );
  }

  async listForTask(taskId: string): Promise<AgentEvent[]> {
    const result = await this.pool.query(
      'SELECT event_id, task_id, event_type, payload, occurred_at FROM agent_events WHERE task_id = $1 ORDER BY occurred_at ASC, event_id ASC',
      [taskId],
    );
    return result.rows.map((row) =>
      AgentEventSchema.parse({
        eventId: row.event_id,
        taskId: row.task_id,
        type: row.event_type,
        payload: row.payload,
        occurredAt: new Date(String(row.occurred_at)).toISOString(),
      }),
    );
  }
}

export class PostgresModelCatalogStore implements ModelCatalogStore {
  constructor(private readonly pool: Pool) {}

  async listEnabled(): Promise<ModelCatalogEntry[]> {
    const result = await this.pool.query(
      'SELECT * FROM model_catalog WHERE enabled = TRUE AND visible = TRUE ORDER BY display_name ASC',
    );
    return result.rows.map((row) => mapCatalogRow(row));
  }

  async getEnabled(modelId: string): Promise<ModelCatalogEntry | undefined> {
    const result = await this.pool.query(
      'SELECT * FROM model_catalog WHERE model_id = $1 AND enabled = TRUE AND visible = TRUE',
      [modelId],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? mapCatalogRow(row) : undefined;
  }
}

export function createPostgresStores(connectionString: string): PostgresStores {
  const pool = new Pool({ connectionString });
  return {
    pool,
    catalog: new PostgresModelCatalogStore(pool),
    receipts: new PostgresUsageReceiptStore(pool),
    events: new PostgresAgentEventStore(pool),
    auth: new PostgresAuthStore(pool),
    billing: new PostgresBillingStore(pool),
    emailPreferences: new PostgresEmailPreferenceStore(pool),
    emailDeliveries: new PostgresEmailDeliveryStore(pool),
    emailCampaigns: new PostgresEmailCampaignStore(pool),
    oauth: new PostgresOAuthTransactionStore(pool),
    audit: new PostgresAdminAuditStore(pool),
    analytics: new PostgresAdminAnalytics(pool),
    rateLimiter: new PostgresRateLimitStore(pool),
    remote: new PostgresRemoteAccessService(pool),
  };
}

export async function applyFoundationMigration(client: PoolClient): Promise<void> {
  const migrations = [
    { version: '0001_agent_foundation', file: '0001_agent_foundation.sql' },
    { version: '0002_v1_commercial', file: '0002_v1_commercial.sql' },
    { version: '0003_sessions', file: '0003_sessions.sql' },
    { version: '0006_plan_v1_rename', file: '0006_plan_v1_rename.sql' },
    { version: '0007_remote_devices', file: '0007_remote_devices.sql' },
    { version: '0008_astra_identity_email', file: '0008_astra_identity_email.sql' },
    { version: '0009_oauth_transactions', file: '0009_oauth_transactions.sql' },
    { version: '0010_astra_commercial_matrix', file: '0010_astra_commercial_matrix.sql' },
  ];
  await client.query(
    'CREATE TABLE IF NOT EXISTS lyntar_schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('lyntar:migrations'))");
    for (const migration of migrations) {
      const existing = await client.query(
        'SELECT version FROM lyntar_schema_migrations WHERE version = $1',
        [migration.version],
      );
      if (existing.rowCount) continue;
      const migrationPath = fileURLToPath(
        new URL(`../migrations/${migration.file}`, import.meta.url),
      );
      const migrationSql = await readFile(migrationPath, 'utf8');
      await client.query(migrationSql);
      await client.query('INSERT INTO lyntar_schema_migrations(version) VALUES ($1)', [
        migration.version,
      ]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
