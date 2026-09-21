import {
  AuditEventInputSchema,
  CommercialPlanPriceSnapshotSchema,
  ModelConsumptionPricingSnapshotSchema,
  PromotionSnapshotSchema,
  TopUpPackageSnapshotSchema,
  type AuditContext,
  type AuditEventInput,
  type CommercialPlanPriceSnapshot,
  type ModelConsumptionPricingSnapshot,
  type PricingRegion,
  type PromotionSnapshot,
  type TopUpPackageSnapshot,
  type InvalidationMessage,
  MutationMetadataSchema,
} from './contracts.js';
import { redactAuditEvent } from './audit.js';
import { ControlPlaneError } from './errors.js';
import type { CommercialRepository, CommercialTransaction, InvalidationBus } from './ports.js';
import { hasAdminPermission } from './permissions.js';
import type { ControlPlaneActor } from './service.js';

const PRICING_SCALE = 10_000_000n;

function parsePricingDecimal(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole ?? '0') * PRICING_SCALE + BigInt(fraction.padEnd(7, '0').slice(0, 7) || '0');
}

function formatPricingCredits(value: bigint): string {
  const whole = value / PRICING_SCALE;
  const fraction = value % PRICING_SCALE;
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction.toString().padStart(7, '0').replace(/0+$/, '')}`;
}

function roundPricingDivision(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  return (numerator % denominator) * 2n >= denominator ? quotient + 1n : quotient;
}

export function calculateModelUsageCredits(
  pricing: ModelConsumptionPricingSnapshot,
  usage: {
    inputTokens?: number | null;
    outputTokens?: number | null;
    cacheReadTokens?: number | null;
    cacheWriteTokens?: number | null;
    reasoningUnits?: number | null;
    imageUnits?: number | null;
    audioUnits?: number | null;
  },
): string {
  let total = 0n;
  const addPerThousand = (units: number | null | undefined, rate: string | null | undefined) => {
    if (units === null || units === undefined || !Number.isFinite(units) || units <= 0 || !rate)
      return;
    total += roundPricingDivision(BigInt(Math.floor(units)) * parsePricingDecimal(rate), 1000n);
  };
  addPerThousand(usage.inputTokens, pricing.inputCreditsPer1k);
  addPerThousand(usage.outputTokens, pricing.outputCreditsPer1k);
  addPerThousand(usage.cacheReadTokens, pricing.cachedInputCreditsPer1k);
  addPerThousand(usage.cacheWriteTokens, pricing.cachedInputCreditsPer1k);
  addPerThousand(usage.reasoningUnits, pricing.reasoningCreditsPer1k);
  if (usage.imageUnits && pricing.imageCredits)
    total += BigInt(Math.floor(usage.imageUnits)) * parsePricingDecimal(pricing.imageCredits);
  if (usage.audioUnits && pricing.audioCredits)
    total += BigInt(Math.floor(usage.audioUnits)) * parsePricingDecimal(pricing.audioCredits);
  const minimum = parsePricingDecimal(pricing.minimumChargeCredits);
  return formatPricingCredits(total > minimum ? total : minimum);
}

export interface CommercialPolicyServiceOptions {
  repository: CommercialRepository;
  invalidationBus: InvalidationBus;
  cacheTtlMs?: number;
  now?: () => number;
}

export interface CommercialWriteContext {
  metadata: { expectedVersion: number; reason: string; requestId: string };
  actor: ControlPlaneActor;
  context: AuditContext;
}

export type PromotionEvaluation =
  | { eligible: true; percentOff: number | null; fixedAmount: string | null; bonusCredits: string }
  | { eligible: false; reason: string };

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class CommercialPolicyService {
  private readonly repository: CommercialRepository;
  private readonly invalidationBus: InvalidationBus;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly priceCache = new Map<string, CacheEntry<CommercialPlanPriceSnapshot[]>>();
  private readonly modelPricingCache = new Map<
    string,
    CacheEntry<ModelConsumptionPricingSnapshot[]>
  >();
  private readonly unsubscribe: () => void;

  constructor(options: CommercialPolicyServiceOptions) {
    this.repository = options.repository;
    this.invalidationBus = options.invalidationBus;
    this.cacheTtlMs = options.cacheTtlMs ?? 30_000;
    this.now = options.now ?? Date.now;
    this.unsubscribe = this.invalidationBus.subscribe((message) => this.invalidate(message));
  }

  async listPlanPriceVersions(
    planId: string,
    region: PricingRegion,
  ): Promise<CommercialPlanPriceSnapshot[]> {
    return this.read(() => this.repository.listPlanPriceVersions(planId, region));
  }

  async getPlanPrice(
    planId: string,
    region: PricingRegion,
    at = new Date(this.now()),
  ): Promise<CommercialPlanPriceSnapshot | undefined> {
    const key = `${planId}:${region}`;
    const cached = this.priceCache.get(key);
    const versions =
      cached && cached.expiresAt > this.now()
        ? cached.value
        : await this.read(() => this.repository.listPlanPriceVersions(planId, region));
    if (!cached || cached.expiresAt <= this.now())
      this.priceCache.set(key, {
        value: structuredClone(versions),
        expiresAt: this.now() + this.cacheTtlMs,
      });
    return selectEffective(versions, at);
  }

  async listTopUpPackages(): Promise<TopUpPackageSnapshot[]> {
    return this.read(() => this.repository.listTopUpPackages());
  }

  async getTopUpPackage(
    packageId: string,
    region: PricingRegion,
    at = new Date(this.now()),
  ): Promise<TopUpPackageSnapshot | undefined> {
    const packages = await this.listTopUpPackages();
    return packages.find(
      (item) =>
        item.packageId === packageId &&
        item.active &&
        new Date(item.effectiveFrom) <= at &&
        (!item.effectiveTo || new Date(item.effectiveTo) > at) &&
        item.prices[region] !== undefined,
    );
  }

  async listPromotions(): Promise<PromotionSnapshot[]> {
    return this.read(() => this.repository.listPromotions());
  }

  async evaluatePromotion(
    code: string,
    input: { planId: string; region: PricingRegion; userId: string; redemptionCount: number },
    at = new Date(this.now()),
  ): Promise<PromotionEvaluation> {
    try {
      const promotion = (await this.listPromotions()).find(
        (item) => item.code.toUpperCase() === code.trim().toUpperCase() && item.active,
      );
      if (!promotion) return { eligible: false, reason: 'NOT_FOUND' };
      if (
        new Date(promotion.validFrom) > at ||
        (promotion.expiresAt && new Date(promotion.expiresAt) <= at)
      )
        return { eligible: false, reason: 'EXPIRED_OR_NOT_ACTIVE' };
      if (promotion.planIds.length && !promotion.planIds.includes(input.planId))
        return { eligible: false, reason: 'PLAN_NOT_ELIGIBLE' };
      if (promotion.regions.length && !promotion.regions.includes(input.region))
        return { eligible: false, reason: 'REGION_NOT_ELIGIBLE' };
      if (promotion.maxRedemptions !== null && input.redemptionCount >= promotion.maxRedemptions)
        return { eligible: false, reason: 'MAX_REDEMPTIONS' };
      if (
        promotion.perUserRedemptionLimit !== null &&
        input.redemptionCount >= promotion.perUserRedemptionLimit
      )
        return { eligible: false, reason: 'PER_USER_LIMIT' };
      return {
        eligible: true,
        percentOff: promotion.percentOff,
        fixedAmount: promotion.fixedAmount,
        bonusCredits: promotion.bonusCredits,
      };
    } catch (error) {
      if (error instanceof ControlPlaneError && error.code === 'CONTROL_PLANE_UNAVAILABLE')
        return { eligible: false, reason: 'CONTROL_PLANE_UNAVAILABLE' };
      throw error;
    }
  }

  async getModelPricing(
    modelId: string,
    region: PricingRegion,
    at = new Date(this.now()),
  ): Promise<ModelConsumptionPricingSnapshot | undefined> {
    const key = `${modelId}:${region}`;
    const cached = this.modelPricingCache.get(key);
    const versions =
      cached && cached.expiresAt > this.now()
        ? cached.value
        : await this.read(() => this.repository.listModelPricingVersions(modelId, region));
    if (!cached || cached.expiresAt <= this.now())
      this.modelPricingCache.set(key, {
        value: structuredClone(versions),
        expiresAt: this.now() + this.cacheTtlMs,
      });
    return selectEffective(versions, at);
  }

  async updatePlanPrice(
    input: CommercialWriteContext & { snapshot: CommercialPlanPriceSnapshot },
  ): Promise<CommercialPlanPriceSnapshot> {
    CommercialPlanPriceSnapshotSchema.parse(input.snapshot);
    return this.write(
      'PLAN_PRICE_UPDATED',
      input.snapshot.planId,
      input,
      'admin.plans',
      (transaction, audit) =>
        transaction.putPlanPrice({
          snapshot: input.snapshot,
          expectedVersion: input.metadata.expectedVersion,
          audit,
        }),
    );
  }

  async updateTopUpPackage(
    input: CommercialWriteContext & { snapshot: TopUpPackageSnapshot },
  ): Promise<TopUpPackageSnapshot> {
    TopUpPackageSnapshotSchema.parse(input.snapshot);
    return this.write(
      'TOPUP_PACKAGE_UPDATED',
      input.snapshot.packageId,
      input,
      'admin.billing',
      (transaction, audit) =>
        transaction.putTopUpPackage({
          snapshot: input.snapshot,
          expectedVersion: input.metadata.expectedVersion,
          audit,
        }),
    );
  }

  async createPromotion(
    input: CommercialWriteContext & { snapshot: PromotionSnapshot },
  ): Promise<PromotionSnapshot> {
    PromotionSnapshotSchema.parse(input.snapshot);
    return this.write(
      'PROMOTION_UPDATED',
      input.snapshot.promotionId,
      input,
      'admin.billing',
      (transaction, audit) =>
        transaction.putPromotion({
          snapshot: input.snapshot,
          expectedVersion: input.metadata.expectedVersion,
          audit,
        }),
    );
  }

  async updateModelPricing(
    input: CommercialWriteContext & { snapshot: ModelConsumptionPricingSnapshot },
  ): Promise<ModelConsumptionPricingSnapshot> {
    ModelConsumptionPricingSnapshotSchema.parse(input.snapshot);
    return this.write(
      'MODEL_PRICING_UPDATED',
      input.snapshot.modelId,
      input,
      'admin.models',
      (transaction, audit) =>
        transaction.putModelPricing({
          snapshot: input.snapshot,
          expectedVersion: input.metadata.expectedVersion,
          audit,
        }),
    );
  }

  listAudit(input?: { limit?: number; offset?: number }): Promise<AuditEventInput[]> {
    return this.read(() => this.repository.listAudit(input));
  }

  close(): void {
    this.unsubscribe();
  }

  private async write<T extends { version: number }>(
    action: string,
    targetId: string,
    input: CommercialWriteContext & { snapshot: T },
    permission: Parameters<typeof hasAdminPermission>[1],
    operation: (transaction: CommercialTransaction, audit: AuditEventInput) => Promise<T>,
  ): Promise<T> {
    const permissions = input.actor.permissions;
    if (!hasAdminPermission(permissions, permission))
      throw new ControlPlaneError('CONTROL_PLANE_FORBIDDEN', `Missing permission ${permission}`);
    const metadata = MutationMetadataSchema.parse(input.metadata);
    const before = await this.readBefore(targetId, input.snapshot);
    const audit = redactAuditEvent(
      AuditEventInputSchema.parse({
        actor: input.actor,
        action,
        targetType: action.startsWith('PLAN')
          ? 'plan_price'
          : action.startsWith('MODEL')
            ? 'model_pricing'
            : action.startsWith('TOPUP')
              ? 'top_up_package'
              : 'promotion',
        targetId,
        before,
        after: input.snapshot,
        reason: metadata.reason,
        requestId: metadata.requestId,
        context: input.context,
        createdAt: new Date(this.now()).toISOString(),
      }),
    );
    const result = await this.repository.transaction((transaction) =>
      operation(transaction, audit),
    );
    await this.invalidationBus.publish({
      domain: 'commercial',
      resourceId: targetId,
      version: result.version,
    });
    return result;
  }

  private async readBefore(targetId: string, snapshot: unknown): Promise<unknown> {
    if ('planId' in (snapshot as object)) {
      const item = await this.repository.listPlanPriceVersions(
        String(targetId),
        String((snapshot as { region: string }).region),
      );
      return selectLatest(item);
    }
    if ('modelId' in (snapshot as object)) {
      const item = await this.repository.listModelPricingVersions(
        String(targetId),
        String((snapshot as { region: string }).region),
      );
      return selectLatest(item);
    }
    if ('packageId' in (snapshot as object))
      return (
        (await this.repository.listTopUpPackages()).find((item) => item.packageId === targetId) ??
        null
      );
    return (
      (await this.repository.listPromotions()).find((item) => item.promotionId === targetId) ?? null
    );
  }

  private async read<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      throw new ControlPlaneError(
        'CONTROL_PLANE_UNAVAILABLE',
        error instanceof Error ? error.message : 'Commercial policy read failed',
      );
    }
  }

  private invalidate(message: InvalidationMessage): void {
    if (message.domain !== 'commercial') return;
    for (const key of this.priceCache.keys())
      if (key.startsWith(`${message.resourceId}:`)) this.priceCache.delete(key);
    for (const key of this.modelPricingCache.keys())
      if (key.startsWith(`${message.resourceId}:`)) this.modelPricingCache.delete(key);
  }
}

function selectEffective<
  T extends { effectiveFrom: string; effectiveTo: string | null; status: string; version: number },
>(versions: T[], at: Date): T | undefined {
  return versions
    .filter(
      (item) =>
        item.status === 'ACTIVE' &&
        new Date(item.effectiveFrom) <= at &&
        (!item.effectiveTo || new Date(item.effectiveTo) > at),
    )
    .sort((left, right) => right.version - left.version)[0];
}

function selectLatest<T extends { version: number }>(versions: T[]): T | null {
  return versions.slice().sort((left, right) => right.version - left.version)[0] ?? null;
}

interface CommercialMemoryState {
  planPrices: Map<string, CommercialPlanPriceSnapshot[]>;
  topUps: Map<string, TopUpPackageSnapshot[]>;
  promotions: Map<string, PromotionSnapshot[]>;
  modelPricing: Map<string, ModelConsumptionPricingSnapshot[]>;
  audit: AuditEventInput[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function emptyCommercialState(): CommercialMemoryState {
  return {
    planPrices: new Map(),
    topUps: new Map(),
    promotions: new Map(),
    modelPricing: new Map(),
    audit: [],
  };
}

class MemoryCommercialTransaction implements CommercialTransaction {
  constructor(private readonly state: CommercialMemoryState) {}

  putPlanPrice(input: {
    snapshot: CommercialPlanPriceSnapshot;
    expectedVersion: number;
    audit: AuditEventInput;
  }): Promise<CommercialPlanPriceSnapshot> {
    return this.put(
      this.state.planPrices,
      `${input.snapshot.planId}:${input.snapshot.region}`,
      input.snapshot,
      input.expectedVersion,
      input.audit,
    );
  }

  putTopUpPackage(input: {
    snapshot: TopUpPackageSnapshot;
    expectedVersion: number;
    audit: AuditEventInput;
  }): Promise<TopUpPackageSnapshot> {
    return this.put(
      this.state.topUps,
      input.snapshot.packageId,
      input.snapshot,
      input.expectedVersion,
      input.audit,
    );
  }

  putPromotion(input: {
    snapshot: PromotionSnapshot;
    expectedVersion: number;
    audit: AuditEventInput;
  }): Promise<PromotionSnapshot> {
    return this.put(
      this.state.promotions,
      input.snapshot.promotionId,
      input.snapshot,
      input.expectedVersion,
      input.audit,
    );
  }

  putModelPricing(input: {
    snapshot: ModelConsumptionPricingSnapshot;
    expectedVersion: number;
    audit: AuditEventInput;
  }): Promise<ModelConsumptionPricingSnapshot> {
    return this.put(
      this.state.modelPricing,
      `${input.snapshot.modelId}:${input.snapshot.region}`,
      input.snapshot,
      input.expectedVersion,
      input.audit,
    );
  }

  async appendAudit(event: AuditEventInput): Promise<void> {
    this.state.audit.push(clone(event));
  }

  private async put<T extends { version: number }>(
    map: Map<string, T[]>,
    key: string,
    snapshot: T,
    expectedVersion: number,
    audit: AuditEventInput,
  ): Promise<T> {
    const history = map.get(key) ?? [];
    const currentVersion = history.reduce((highest, entry) => Math.max(highest, entry.version), 0);
    if (currentVersion !== expectedVersion || snapshot.version !== currentVersion + 1)
      throw new ControlPlaneError(
        'CONTROL_PLANE_VERSION_CONFLICT',
        `Commercial configuration ${key} is at version ${currentVersion}`,
      );
    history.push(clone(snapshot));
    map.set(key, history);
    await this.appendAudit(audit);
    return clone(snapshot);
  }
}

export class InMemoryCommercialRepository implements CommercialRepository {
  private state: CommercialMemoryState = emptyCommercialState();
  public failReads = false;

  constructor(
    input: {
      planPrices?: CommercialPlanPriceSnapshot[];
      topUps?: TopUpPackageSnapshot[];
      promotions?: PromotionSnapshot[];
      modelPricing?: ModelConsumptionPricingSnapshot[];
    } = {},
  ) {
    for (const value of input.planPrices ?? [])
      this.seed(this.state.planPrices, `${value.planId}:${value.region}`, value);
    for (const value of input.topUps ?? []) this.seed(this.state.topUps, value.packageId, value);
    for (const value of input.promotions ?? [])
      this.seed(this.state.promotions, value.promotionId, value);
    for (const value of input.modelPricing ?? [])
      this.seed(this.state.modelPricing, `${value.modelId}:${value.region}`, value);
  }

  async listPlanPriceVersions(
    planId: string,
    region: string,
  ): Promise<CommercialPlanPriceSnapshot[]> {
    this.assertReadable();
    return clone(this.state.planPrices.get(`${planId}:${region}`) ?? []);
  }

  async listTopUpPackages(): Promise<TopUpPackageSnapshot[]> {
    this.assertReadable();
    return clone([...this.state.topUps.values()].flat());
  }

  async listPromotions(): Promise<PromotionSnapshot[]> {
    this.assertReadable();
    return clone([...this.state.promotions.values()].flat());
  }

  async listModelPricingVersions(
    modelId: string,
    region: string,
  ): Promise<ModelConsumptionPricingSnapshot[]> {
    this.assertReadable();
    return clone(this.state.modelPricing.get(`${modelId}:${region}`) ?? []);
  }

  async listAudit(input: { limit?: number; offset?: number } = {}): Promise<AuditEventInput[]> {
    this.assertReadable();
    const limit = Math.min(Math.max(input.limit ?? 100, 1), 1000);
    const offset = Math.max(input.offset ?? 0, 0);
    return clone(
      this.state.audit
        .slice()
        .reverse()
        .slice(offset, offset + limit),
    );
  }

  async transaction<T>(operation: (transaction: CommercialTransaction) => Promise<T>): Promise<T> {
    const working = cloneCommercialState(this.state);
    const result = await operation(new MemoryCommercialTransaction(working));
    this.state = working;
    return result;
  }

  private seed<T>(map: Map<string, T[]>, key: string, value: T & { version: number }): void {
    const history = map.get(key) ?? [];
    history.push(clone(value));
    map.set(key, history);
  }

  private assertReadable(): void {
    if (this.failReads) throw new Error('commercial policy read unavailable');
  }
}

function cloneCommercialState(state: CommercialMemoryState): CommercialMemoryState {
  const next = emptyCommercialState();
  for (const [key, value] of state.planPrices) next.planPrices.set(key, clone(value));
  for (const [key, value] of state.topUps) next.topUps.set(key, clone(value));
  for (const [key, value] of state.promotions) next.promotions.set(key, clone(value));
  for (const [key, value] of state.modelPricing) next.modelPricing.set(key, clone(value));
  next.audit = clone(state.audit);
  return next;
}
