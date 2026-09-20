import { z } from 'zod';

export const TaskStateSchema = z.enum([
  'CREATED',
  'ANALYZING',
  'PLANNING',
  'WAITING_FOR_PERMISSION',
  'EXECUTING',
  'VERIFYING',
  'REPAIRING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'BLOCKED',
]);
export type TaskState = z.infer<typeof TaskStateSchema>;

export const TaskBudgetSchema = z.object({
  maxModelCalls: z.number().int().positive(),
  maxRepairs: z.number().int().nonnegative(),
  maxCommands: z.number().int().positive(),
  maxWallTimeMs: z.number().int().positive(),
  maxEstimatedCostUsd: z.number().finite().nonnegative(),
  overrunAllowanceUsd: z.number().finite().positive().optional(),
  maxCostCheckpoints: z.number().int().nonnegative().optional(),
});
export type TaskBudget = z.infer<typeof TaskBudgetSchema>;

export const TaskStateTransitionSchema = z.object({
  from: TaskStateSchema,
  to: TaskStateSchema,
});
export type TaskStateTransition = z.infer<typeof TaskStateTransitionSchema>;

const allowedTransitions: Record<TaskState, readonly TaskState[]> = {
  CREATED: ['ANALYZING', 'CANCELLED', 'FAILED'],
  ANALYZING: ['PLANNING', 'WAITING_FOR_PERMISSION', 'CANCELLED', 'FAILED', 'BLOCKED'],
  PLANNING: ['WAITING_FOR_PERMISSION', 'EXECUTING', 'CANCELLED', 'FAILED', 'BLOCKED'],
  WAITING_FOR_PERMISSION: ['EXECUTING', 'CANCELLED', 'FAILED', 'BLOCKED'],
  EXECUTING: ['VERIFYING', 'WAITING_FOR_PERMISSION', 'CANCELLED', 'FAILED', 'BLOCKED'],
  VERIFYING: ['REPAIRING', 'COMPLETED', 'CANCELLED', 'FAILED', 'BLOCKED'],
  REPAIRING: ['EXECUTING', 'VERIFYING', 'CANCELLED', 'FAILED', 'BLOCKED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
  BLOCKED: [],
};

export class InvalidTaskTransitionError extends Error {
  public readonly from: TaskState;
  public readonly to: TaskState;

  constructor(from: TaskState, to: TaskState) {
    super(`Invalid task transition: ${from} -> ${to}`);
    this.name = 'InvalidTaskTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function assertTaskTransition(from: TaskState, to: TaskState): void {
  if (!allowedTransitions[from].includes(to)) {
    throw new InvalidTaskTransitionError(from, to);
  }
}

export function canTransition(from: TaskState, to: TaskState): boolean {
  return allowedTransitions[from].includes(to);
}
