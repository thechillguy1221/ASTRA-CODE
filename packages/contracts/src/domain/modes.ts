import { z } from 'zod';

export const LearnDepthSchema = z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']);
export type LearnDepth = z.infer<typeof LearnDepthSchema>;

export const VivaCategorySchema = z.enum([
  'ARCHITECTURE',
  'DATABASE',
  'API',
  'AUTHENTICATION',
  'SECURITY',
  'DEPENDENCIES',
  'CODE_READING',
  'IMPLEMENTATION',
  'FAILURE_SCENARIOS',
  'DEPLOYMENT',
  'TESTING',
]);
export type VivaCategory = z.infer<typeof VivaCategorySchema>;

export const VivaDifficultySchema = z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']);
export type VivaDifficulty = z.infer<typeof VivaDifficultySchema>;

export const LearnResultSchema = z.object({
  title: z.string().min(1),
  explanation: z.string().min(1),
  relevantPaths: z.array(z.string()),
  depth: LearnDepthSchema,
});
export type LearnResult = z.infer<typeof LearnResultSchema>;

export const VivaQuestionSchema = z.object({
  id: z.string().min(1),
  category: VivaCategorySchema,
  difficulty: VivaDifficultySchema,
  prompt: z.string().min(1),
  referencePath: z.string().min(1),
  expectedConcepts: z.array(z.string()),
});
export type VivaQuestion = z.infer<typeof VivaQuestionSchema>;

export const VivaEvaluationSchema = z.object({
  score: z.number().int().min(0).max(100),
  feedback: z.string().min(1),
  relevantPaths: z.array(z.string()),
  missingConcepts: z.array(z.string()),
});
export type VivaEvaluation = z.infer<typeof VivaEvaluationSchema>;

export const HackathonPlanSchema = z.object({
  problem: z.string().min(1),
  mvpScope: z.array(z.string()),
  mustHave: z.array(z.string()),
  shouldHave: z.array(z.string()),
  future: z.array(z.string()),
  testing: z.array(z.string()),
  demoPlan: z.string().min(1),
  readmeOutline: z.array(z.string()),
  architectureSummary: z.string().min(1),
  judgeQuestions: z.array(z.string()),
});
export type HackathonPlan = z.infer<typeof HackathonPlanSchema>;
