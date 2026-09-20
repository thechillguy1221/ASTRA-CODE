import { describe, expect, it } from 'vitest';
import { BudgetExceededError, BudgetTracker } from '@lyntar/agent-core';

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
});
