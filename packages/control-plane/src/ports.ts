import type {
  AuditEventInput,
  CommercialPlanPriceSnapshot,
  ControlPlaneModelSnapshot,
  ControlPlanePlanSnapshot,
  CapabilityPolicySnapshot,
  FeatureFlagSnapshot,
  InvalidationMessage,
  MaintenanceKey,
  MaintenancePolicySnapshot,
  ModelConsumptionPricingSnapshot,
  ModelWriteInput,
  PlanWriteInput,
  PromotionSnapshot,
  RazorpayMappingSnapshot,
  ReleaseChannel,
  ReleasePolicySnapshot,
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

export interface PlatformPolicyRepository {
  listFeatureFlags(): Promise<FeatureFlagSnapshot[]>;
  getFeatureFlag(flagId: string): Promise<FeatureFlagSnapshot | undefined>;
  listFeatureFlagVersions(flagId: string): Promise<FeatureFlagSnapshot[]>;
  listMaintenancePolicies(): Promise<MaintenancePolicySnapshot[]>;
  getMaintenancePolicy(key: MaintenanceKey): Promise<MaintenancePolicySnapshot | undefined>;
  listCapabilityPolicies(): Promise<CapabilityPolicySnapshot[]>;
  getCapabilityPolicy(
    key: CapabilityPolicySnapshot['key'],
  ): Promise<CapabilityPolicySnapshot | undefined>;
  getReleasePolicy(channel: ReleaseChannel): Promise<ReleasePolicySnapshot | undefined>;
  listReleasePolicies(): Promise<ReleasePolicySnapshot[]>;
  listRazorpayMappings(): Promise<RazorpayMappingSnapshot[]>;
  listAudit(input?: { limit?: number; offset?: number }): Promise<AuditEventInput[]>;
  transaction<T>(operation: (transaction: PlatformPolicyTransaction) => Promise<T>): Promise<T>;
}

export interface PlatformPolicyTransaction {
  putFeatureFlag(input: {
    snapshot: FeatureFlagSnapshot;
    expectedVersion: number;
    audit: AuditEventInput;
  }): Promise<FeatureFlagSnapshot>;
  putMaintenancePolicy(input: {
    snapshot: MaintenancePolicySnapshot;
    expectedVersion: number;
    audit: AuditEventInput;
  }): Promise<MaintenancePolicySnapshot>;
  putCapabilityPolicy(input: {
    snapshot: CapabilityPolicySnapshot;
    expectedVersion: number;
    audit: AuditEventInput;
  }): Promise<CapabilityPolicySnapshot>;
  putReleasePolicy(input: {
    snapshot: ReleasePolicySnapshot;
    expectedVersion: number;
    audit: AuditEventInput;
  }): Promise<ReleasePolicySnapshot>;
  putRazorpayMapping(input: {
    snapshot: RazorpayMappingSnapshot;
    expectedVersion: number;
    audit: AuditEventInput;
  }): Promise<RazorpayMappingSnapshot>;
  appendAudit(event: AuditEventInput): Promise<void>;
}

export interface InvalidationBus {
  publish(message: InvalidationMessage): Promise<void>;
  subscribe(listener: (message: InvalidationMessage) => void): () => void;
  start?(): Promise<void>;
  close?(): Promise<void>;
}
