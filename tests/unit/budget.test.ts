import { describe, expect, it } from 'vitest';
import { BudgetExceededError, BudgetTracker } from '@astra/agent-core';

const budget = {
  maxModelCalls: 3,
  maxRepairs: 2,
  maxCommands: 6,
  maxWallTimeMs: 30_000,
  maxEstimatedCostUsd: 1,
};

describe('task budgets', () => {
  it('blocks a fourth model call when maxModelCalls is three', () => {
    const tracker = new BudgetTracker(budget);
    tracker.consume('model');
    tracker.consume('model');
    tracker.consume('model');
    expect(() => tracker.consume('model')).toThrow(BudgetExceededError);
  });

  it('blocks a request that would exceed the estimated cost ceiling', () => {
    const tracker = new BudgetTracker({ ...budget, maxEstimatedCostUsd: 0.05 });
    tracker.consume('model', 0.04);
    expect(() => tracker.consume('model', 0.02)).toThrow(BudgetExceededError);
  });

  it('supports only explicitly configured, bounded cost extensions', () => {
    const tracker = new BudgetTracker({
      ...budget,
      maxEstimatedCostUsd: 0.05,
      overrunAllowanceUsd: 0.15,
      maxCostCheckpoints: 1,
    });
    expect(() => tracker.recordCost(0.06)).toThrow(BudgetExceededError);
    tracker.extendCostLimit(0.15);
    expect(() => tracker.extendCostLimit(0.15)).toThrow(BudgetExceededError);
    tracker.recordCost(0.1);
    expect(tracker.snapshot().costLimitUsd).toBeCloseTo(0.2);
  });
});
