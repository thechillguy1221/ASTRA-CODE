import { z } from 'zod';

export const CostEstimateSchema = z.object({
  selectedModelId: z.string().min(1),
  selectedModelDisplayName: z.string().min(1),
  estimatedMinInputTokens: z.number().int().nonnegative(),
  estimatedMaxInputTokens: z.number().int().nonnegative(),
  estimatedMinOutputTokens: z.number().int().nonnegative(),
  estimatedMaxOutputTokens: z.number().int().nonnegative(),
  estimatedMinCredits: z.string(), // CreditAmount
  estimatedMaxCredits: z.string(), // CreditAmount
  currentBalanceCredits: z.string(), // CreditAmount
  expectedMinBalanceAfter: z.string(), // CreditAmount (may be '0' if insufficient)
  expectedMaxBalanceAfter: z.string(), // CreditAmount
  couldExhaustBalance: z.boolean(),
});
export type CostEstimate = z.infer<typeof CostEstimateSchema>;

export const SpendingThresholdsSchema = z.object({
  warnAboveCredits: z.string().default('10'),
  warnAbovePercentOfBalance: z.number().min(0).max(100).default(50),
  requireAuthAboveCredits: z.string().default('25'),
  requireAuthAbovePercentOfBalance: z.number().min(0).max(100).default(75),
  maxSingleTaskCredits: z.string().default('100'),
});
export type SpendingThresholds = z.infer<typeof SpendingThresholdsSchema>;

export type CostWarningLevel = 'none' | 'info' | 'warn' | 'auth-required';
