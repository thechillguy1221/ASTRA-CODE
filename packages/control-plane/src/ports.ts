import type {
  AuditEventInput,
  CommercialPlanPriceSnapshot,
  ControlPlaneModelSnapshot,
  ControlPlanePlanSnapshot,
  InvalidationMessage,
  ModelConsumptionPricingSnapshot,
  ModelWriteInput,
  PlanWriteInput,
  PromotionSnapshot,
  TopUpPackageSnapshot,
} from './contracts.js';

export interface ControlPlaneReadPort {
  listPlans(): Promise<ControlPlanePlanSnapshot[]>;
  getPlan(planId: string): Promise<ControlPlanePlanSnapshot | undefined>;
  listPlanVersions(planId: string): Promise<ControlPlanePlanSnapshot[]>;
  listModels(): Promise<ControlPlaneModelSnapshot[]>;
  getModel(modelId: string): Promise<ControlPlaneModelSnapshot | undefined>;
  listAudit(input?: { limit?: number; offset?: number }): Promise<AuditEventInput[]>;
}

export interface ControlPlaneTransaction {
  putPlan(input: PlanWriteInput): Promise<ControlPlanePlanSnapshot>;
  putModel(input: ModelWriteInput): Promise<ControlPlaneModelSnapshot>;
  appendAudit(event: AuditEventInput): Promise<void>;
}

export interface ControlPlaneRepository extends ControlPlaneReadPort {
  transaction<T>(operation: (transaction: ControlPlaneTransaction) => Promise<T>): Promise<T>;
}

export interface CommercialRepository {
  listPlanPriceVersions(planId: string, region: string): Promise<CommercialPlanPriceSnapshot[]>;
  listTopUpPackages(): Promise<TopUpPackageSnapshot[]>;
  listPromotions(): Promise<PromotionSnapshot[]>;
  listModelPricingVersions(
    modelId: string,
    region: string,
  ): Promise<ModelConsumptionPricingSnapshot[]>;
  listAudit(input?: { limit?: number; offset?: number }): Promise<AuditEventInput[]>;
  transaction<T>(operation: (transaction: CommercialTransaction) => Promise<T>): Promise<T>;
}

export interface CommercialTransaction {
  putPlanPrice(input: {
    snapshot: CommercialPlanPriceSnapshot;
    expectedVersion: number;
    audit: AuditEventInput;
  }): Promise<CommercialPlanPriceSnapshot>;
  putTopUpPackage(input: {
    snapshot: TopUpPackageSnapshot;
    expectedVersion: number;
    audit: AuditEventInput;
  }): Promise<TopUpPackageSnapshot>;
  putPromotion(input: {
    snapshot: PromotionSnapshot;
    expectedVersion: number;
    audit: AuditEventInput;
  }): Promise<PromotionSnapshot>;
  putModelPricing(input: {
    snapshot: ModelConsumptionPricingSnapshot;
    expectedVersion: number;
    audit: AuditEventInput;
  }): Promise<ModelConsumptionPricingSnapshot>;
  appendAudit(event: AuditEventInput): Promise<void>;
}

export interface InvalidationBus {
  publish(message: InvalidationMessage): Promise<void>;
  subscribe(listener: (message: InvalidationMessage) => void): () => void;
  start?(): Promise<void>;
  close?(): Promise<void>;
}
