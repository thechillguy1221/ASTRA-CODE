import type { TaskBudget } from '@lyntar/contracts';

export type BudgetKind = 'model' | 'repair' | 'command';

export interface BudgetSnapshot {
  modelCalls: number;
  repairs: number;
  commands: number;
  estimatedCostUsd: number;
  costLimitUsd: number;
  costCheckpoints: number;
  elapsedMs: number;
}

export class BudgetExceededError extends Error {
  public readonly kind: BudgetKind | 'wallTime' | 'cost';
  public readonly snapshot: BudgetSnapshot;

  constructor(kind: BudgetExceededError['kind'], snapshot: BudgetSnapshot) {
    super(`Task budget exceeded: ${kind}`);
    this.name = 'BudgetExceededError';
    this.kind = kind;
    this.snapshot = snapshot;
  }
}

export class BudgetTracker {
  private readonly startedAt = Date.now();
  private modelCalls = 0;
  private repairs = 0;
  private commands = 0;
  private estimatedCostUsd = 0;
  private costLimitUsd: number;
  private costCheckpoints = 0;

  constructor(private readonly budget: TaskBudget) {
    this.costLimitUsd = budget.maxEstimatedCostUsd;
  }

  consume(kind: BudgetKind, estimatedCostUsd = 0): void {
    const nextCount = this.countFor(kind) + 1;
    if (nextCount > this.limitFor(kind)) {
      throw new BudgetExceededError(kind, this.snapshot());
    }

    const nextCost = this.estimatedCostUsd + estimatedCostUsd;
    if (nextCost > this.costLimitUsd) {
      throw new BudgetExceededError('cost', this.snapshot());
    }

    this.setCount(kind, nextCount);
    this.estimatedCostUsd = nextCost;
    this.assertWallTime();
  }

  recordCost(actualCostUsd: number): void {
    if (!Number.isFinite(actualCostUsd) || actualCostUsd < 0) return;
    const nextCost = this.estimatedCostUsd + actualCostUsd;
    this.estimatedCostUsd = nextCost;
    if (nextCost > this.costLimitUsd) {
      throw new BudgetExceededError('cost', this.snapshot());
    }
  }

  extendCostLimit(additionalAllowanceUsd: number): void {
    const maxCheckpoints = this.budget.maxCostCheckpoints ?? 0;
    if (
      !Number.isFinite(additionalAllowanceUsd) ||
      additionalAllowanceUsd <= 0 ||
      this.costCheckpoints >= maxCheckpoints
    ) {
      throw new BudgetExceededError('cost', this.snapshot());
    }
    this.costLimitUsd += additionalAllowanceUsd;
    this.costCheckpoints += 1;
  }

  get configuredAllowanceUsd(): number | undefined {
    return this.budget.overrunAllowanceUsd;
  }

  assertWallTime(): void {
    if (Date.now() - this.startedAt > this.budget.maxWallTimeMs) {
      throw new BudgetExceededError('wallTime', this.snapshot());
    }
  }

  snapshot(): BudgetSnapshot {
    return {
      modelCalls: this.modelCalls,
      repairs: this.repairs,
      commands: this.commands,
      estimatedCostUsd: this.estimatedCostUsd,
      costLimitUsd: this.costLimitUsd,
      costCheckpoints: this.costCheckpoints,
      elapsedMs: Date.now() - this.startedAt,
    };
  }

  private countFor(kind: BudgetKind): number {
    if (kind === 'model') return this.modelCalls;
    if (kind === 'repair') return this.repairs;
    return this.commands;
  }

  private limitFor(kind: BudgetKind): number {
    if (kind === 'model') return this.budget.maxModelCalls;
    if (kind === 'repair') return this.budget.maxRepairs;
    return this.budget.maxCommands;
  }

  private setCount(kind: BudgetKind, count: number): void {
    if (kind === 'model') this.modelCalls = count;
    else if (kind === 'repair') this.repairs = count;
    else this.commands = count;
  }
}
