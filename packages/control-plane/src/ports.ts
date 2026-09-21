import type {
  AuditEventInput,
  ControlPlaneModelSnapshot,
  ControlPlanePlanSnapshot,
  InvalidationMessage,
  ModelWriteInput,
  PlanWriteInput,
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

export interface InvalidationBus {
  publish(message: InvalidationMessage): Promise<void>;
  subscribe(listener: (message: InvalidationMessage) => void): () => void;
  close?(): Promise<void>;
}
