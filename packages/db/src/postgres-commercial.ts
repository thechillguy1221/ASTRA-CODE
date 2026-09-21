import type { Pool, PoolClient, QueryResultRow } from 'pg';
import {
  AuditEventInputSchema,
  CommercialPlanPriceSnapshotSchema,
  ModelConsumptionPricingSnapshotSchema,
  PromotionSnapshotSchema,
  TopUpPackageSnapshotSchema,
  type AuditEventInput,
  type CommercialPlanPriceSnapshot,
  type ModelConsumptionPricingSnapshot,
  type PromotionSnapshot,
  type TopUpPackageSnapshot,
} from '@astra/control-plane';
import { ControlPlaneError } from '@astra/control-plane';
import type { CommercialRepository, CommercialTransaction } from '@astra/control-plane';
import { randomUUID } from 'node:crypto';
import {
  CONTROL_PLANE_NOTIFY_CHANNEL,
  formatInvalidationPayload,
  runControlPlaneTransaction,
} from './postgres-control-plane.js';

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mapPlanPrice(row: QueryResultRow): CommercialPlanPriceSnapshot {
  return CommercialPlanPriceSnapshotSchema.parse({
    planId: String(row.plan_id),
    version: Number(row.version),
    region: String(row.pricing_region),
    currency: String(row.currency),
    monthlyAmount: String(row.monthly_amount),
    yearlyAmount: row.yearly_amount === null ? null : String(row.yearly_amount),
    seatAmount: row.seat_amount === null ? null : String(row.seat_amount),
    includedMonthlyCredits: String(row.included_monthly_credits),
    includedYearlyCredits:
      row.included_yearly_credits === null ? null : String(row.included_yearly_credits),
    effectiveFrom: new Date(String(row.effective_from)).toISOString(),
    effectiveTo: row.effective_to ? new Date(String(row.effective_to)).toISOString() : null,
    status: String(row.status),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  });
}

function mapTopUp(row: QueryResultRow): TopUpPackageSnapshot {
  return TopUpPackageSnapshotSchema.parse({
    packageId: String(row.package_id),
    version: Number(row.version),
    displayName: String(row.display_name),
    credits: String(row.credits),
    bonusCredits: String(row.bonus_credits),
    validityDays: Number(row.validity_days),
    prices: objectValue(row.prices),
    active: Boolean(row.active),
    displayOrder: Number(row.display_order),
    purchaseLimit: row.purchase_limit === null ? null : Number(row.purchase_limit),
    effectiveFrom: new Date(String(row.effective_from)).toISOString(),
    effectiveTo: row.effective_to ? new Date(String(row.effective_to)).toISOString() : null,
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  });
}

function mapPromotion(row: QueryResultRow): PromotionSnapshot {
  return PromotionSnapshotSchema.parse({
    promotionId: String(row.promotion_id),
    version: Number(row.version),
    code: String(row.code),
    kind: String(row.kind),
    percentOff: row.percent_off === null ? null : Number(row.percent_off),
    fixedAmount: row.fixed_amount === null ? null : String(row.fixed_amount),
    fixedCurrency: row.fixed_currency === null ? null : String(row.fixed_currency),
    bonusCredits: String(row.bonus_credits),
    planIds: Array.isArray(row.plan_ids) ? row.plan_ids.map(String) : [],
    regions: Array.isArray(row.pricing_regions) ? row.pricing_regions.map(String) : [],
    maxRedemptions: row.max_redemptions === null ? null : Number(row.max_redemptions),
    perUserRedemptionLimit:
      row.per_user_redemption_limit === null ? null : Number(row.per_user_redemption_limit),
    validFrom: new Date(String(row.valid_from)).toISOString(),
    expiresAt: row.expires_at ? new Date(String(row.expires_at)).toISOString() : null,
    active: Boolean(row.active),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  });
}

function mapModelPricing(row: QueryResultRow): ModelConsumptionPricingSnapshot {
  return ModelConsumptionPricingSnapshotSchema.parse({
    modelId: String(row.model_id),
    version: Number(row.version),
    region: String(row.pricing_region),
    inputCreditsPer1k: String(row.input_credits_per_1k),
    outputCreditsPer1k: String(row.output_credits_per_1k),
    cachedInputCreditsPer1k:
      row.cached_input_credits_per_1k === null ? null : String(row.cached_input_credits_per_1k),
    reasoningCreditsPer1k:
      row.reasoning_credits_per_1k === null ? null : String(row.reasoning_credits_per_1k),
    imageCredits: row.image_credits === null ? null : String(row.image_credits),
    audioCredits: row.audio_credits === null ? null : String(row.audio_credits),
    minimumChargeCredits: String(row.minimum_charge_credits),
    effectiveFrom: new Date(String(row.effective_from)).toISOString(),
    effectiveTo: row.effective_to ? new Date(String(row.effective_to)).toISOString() : null,
    status: String(row.status),
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

async function nextVersion(client: PoolClient, sql: string, values: unknown[]): Promise<number> {
  const result = await client.query(sql, values);
  return result.rows[0] ? Number(result.rows[0].version) : 0;
}

class PostgresCommercialTransaction implements CommercialTransaction {
  constructor(private readonly client: PoolClient) {}

  async putPlanPrice(input: {
    snapshot: CommercialPlanPriceSnapshot;
    expectedVersion: number;
    audit: AuditEventInput;
  }): Promise<CommercialPlanPriceSnapshot> {
    const current = await nextVersion(
      this.client,
      'SELECT version FROM control_plane_plan_price_versions WHERE plan_id = $1 AND pricing_region = $2 ORDER BY version DESC LIMIT 1 FOR UPDATE',
      [input.snapshot.planId, input.snapshot.region],
    );
    this.assertVersion(
      current,
      input.expectedVersion,
      input.snapshot.version,
      input.snapshot.planId,
    );
    await this.client.query(
      `INSERT INTO control_plane_plan_price_versions
       (id, plan_id, version, pricing_region, currency, monthly_amount, yearly_amount, seat_amount,
        included_monthly_credits, included_yearly_credits, effective_from, effective_to, status, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        randomUUID(),
        input.snapshot.planId,
        input.snapshot.version,
        input.snapshot.region,
        input.snapshot.currency,
        input.snapshot.monthlyAmount,
        input.snapshot.yearlyAmount,
        input.snapshot.seatAmount,
        input.snapshot.includedMonthlyCredits,
        input.snapshot.includedYearlyCredits,
        input.snapshot.effectiveFrom,
        input.snapshot.effectiveTo,
        input.snapshot.status,
        input.snapshot.updatedAt,
      ],
    );
    await this.appendAudit(input.audit);
    await this.notify(input.snapshot.planId, input.snapshot.version);
    return structuredClone(input.snapshot);
  }

  async putTopUpPackage(input: {
    snapshot: TopUpPackageSnapshot;
    expectedVersion: number;
    audit: AuditEventInput;
  }): Promise<TopUpPackageSnapshot> {
    const current = await nextVersion(
      this.client,
      'SELECT version FROM control_plane_top_up_package_versions WHERE package_id = $1 ORDER BY version DESC LIMIT 1 FOR UPDATE',
      [input.snapshot.packageId],
    );
    this.assertVersion(
      current,
      input.expectedVersion,
      input.snapshot.version,
      input.snapshot.packageId,
    );
    await this.client.query(
      `INSERT INTO control_plane_top_up_package_versions
       (id, package_id, version, display_name, credits, bonus_credits, validity_days, prices,
        active, display_order, purchase_limit, effective_from, effective_to, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        randomUUID(),
        input.snapshot.packageId,
        input.snapshot.version,
        input.snapshot.displayName,
        input.snapshot.credits,
        input.snapshot.bonusCredits,
        input.snapshot.validityDays,
        input.snapshot.prices,
        input.snapshot.active,
        input.snapshot.displayOrder,
        input.snapshot.purchaseLimit,
        input.snapshot.effectiveFrom,
        input.snapshot.effectiveTo,
        input.snapshot.updatedAt,
      ],
    );
    await this.appendAudit(input.audit);
    await this.notify(input.snapshot.packageId, input.snapshot.version);
    return structuredClone(input.snapshot);
  }

  async putPromotion(input: {
    snapshot: PromotionSnapshot;
    expectedVersion: number;
    audit: AuditEventInput;
  }): Promise<PromotionSnapshot> {
    const current = await nextVersion(
      this.client,
      'SELECT version FROM control_plane_promotions WHERE promotion_id = $1 ORDER BY version DESC LIMIT 1 FOR UPDATE',
      [input.snapshot.promotionId],
    );
    this.assertVersion(
      current,
      input.expectedVersion,
      input.snapshot.version,
      input.snapshot.promotionId,
    );
    await this.client.query(
      `INSERT INTO control_plane_promotions
       (id, promotion_id, version, code, kind, percent_off, fixed_amount, fixed_currency, bonus_credits,
        plan_ids, pricing_regions, max_redemptions, per_user_redemption_limit, valid_from, expires_at,
        active, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        randomUUID(),
        input.snapshot.promotionId,
        input.snapshot.version,
        input.snapshot.code,
        input.snapshot.kind,
        input.snapshot.percentOff,
        input.snapshot.fixedAmount,
        input.snapshot.fixedCurrency,
        input.snapshot.bonusCredits,
        input.snapshot.planIds,
        input.snapshot.regions,
        input.snapshot.maxRedemptions,
        input.snapshot.perUserRedemptionLimit,
        input.snapshot.validFrom,
        input.snapshot.expiresAt,
        input.snapshot.active,
        input.snapshot.updatedAt,
      ],
    );
    await this.appendAudit(input.audit);
    await this.notify(input.snapshot.promotionId, input.snapshot.version);
    return structuredClone(input.snapshot);
  }

  async putModelPricing(input: {
    snapshot: ModelConsumptionPricingSnapshot;
    expectedVersion: number;
    audit: AuditEventInput;
  }): Promise<ModelConsumptionPricingSnapshot> {
    const current = await nextVersion(
      this.client,
      'SELECT version FROM control_plane_model_pricing_versions WHERE model_id = $1 AND pricing_region = $2 ORDER BY version DESC LIMIT 1 FOR UPDATE',
      [input.snapshot.modelId, input.snapshot.region],
    );
    this.assertVersion(
      current,
      input.expectedVersion,
      input.snapshot.version,
      input.snapshot.modelId,
    );
    await this.client.query(
      `INSERT INTO control_plane_model_pricing_versions
       (id, model_id, version, pricing_region, input_credits_per_1k, output_credits_per_1k,
        cached_input_credits_per_1k, reasoning_credits_per_1k, image_credits, audio_credits,
        minimum_charge_credits, effective_from, effective_to, status, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [
        randomUUID(),
        input.snapshot.modelId,
        input.snapshot.version,
        input.snapshot.region,
        input.snapshot.inputCreditsPer1k,
        input.snapshot.outputCreditsPer1k,
        input.snapshot.cachedInputCreditsPer1k,
        input.snapshot.reasoningCreditsPer1k,
        input.snapshot.imageCredits,
        input.snapshot.audioCredits,
        input.snapshot.minimumChargeCredits,
        input.snapshot.effectiveFrom,
        input.snapshot.effectiveTo,
        input.snapshot.status,
        input.snapshot.updatedAt,
      ],
    );
    await this.appendAudit(input.audit);
    await this.notify(input.snapshot.modelId, input.snapshot.version);
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
        `Commercial configuration ${id} is at version ${current}`,
      );
  }

  private async notify(resourceId: string, version: number): Promise<void> {
    await this.client.query('SELECT pg_notify($1, $2)', [
      CONTROL_PLANE_NOTIFY_CHANNEL,
      formatInvalidationPayload({ domain: 'commercial', resourceId, version }),
    ]);
  }
}

export class PostgresCommercialRepository implements CommercialRepository {
  constructor(private readonly pool: Pool) {}

  async listPlanPriceVersions(
    planId: string,
    region: string,
  ): Promise<CommercialPlanPriceSnapshot[]> {
    const result = await this.pool.query(
      'SELECT * FROM control_plane_plan_price_versions WHERE plan_id = $1 AND pricing_region = $2 ORDER BY version DESC',
      [planId, region],
    );
    return result.rows.map(mapPlanPrice);
  }

  async listTopUpPackages(): Promise<TopUpPackageSnapshot[]> {
    const result = await this.pool.query(
      'SELECT DISTINCT ON (package_id) * FROM control_plane_top_up_package_versions ORDER BY package_id, version DESC',
    );
    return result.rows.map(mapTopUp);
  }

  async listPromotions(): Promise<PromotionSnapshot[]> {
    const result = await this.pool.query(
      'SELECT DISTINCT ON (promotion_id) * FROM control_plane_promotions ORDER BY promotion_id, version DESC',
    );
    return result.rows.map(mapPromotion);
  }

  async listModelPricingVersions(
    modelId: string,
    region: string,
  ): Promise<ModelConsumptionPricingSnapshot[]> {
    const result = await this.pool.query(
      'SELECT * FROM control_plane_model_pricing_versions WHERE model_id = $1 AND pricing_region = $2 ORDER BY version DESC',
      [modelId, region],
    );
    return result.rows.map(mapModelPricing);
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

  async transaction<T>(operation: (transaction: CommercialTransaction) => Promise<T>): Promise<T> {
    return runControlPlaneTransaction(this.pool, async (client) =>
      operation(new PostgresCommercialTransaction(client)),
    );
  }
}
