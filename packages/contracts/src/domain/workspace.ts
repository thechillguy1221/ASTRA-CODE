import { z } from 'zod';

export const WorkspaceDescriptorSchema = z.object({
  workspaceId: z.string().min(1),
  displayName: z.string().min(1),
  canonicalRoot: z.string().min(1),
  selectedAt: z.string().datetime(),
});
export type WorkspaceDescriptor = z.infer<typeof WorkspaceDescriptorSchema>;

export const GitBaselineSchema = z.object({
  repositoryRoot: z.string().min(1),
  head: z.string().nullable(),
  statusPaths: z.array(z.string()),
  fileHashes: z.record(z.string(), z.string()),
  capturedAt: z.string().datetime(),
});
export type GitBaseline = z.infer<typeof GitBaselineSchema>;

export const GitDiffSchema = z.object({
  lyntarPaths: z.array(z.string()),
  preExistingPaths: z.array(z.string()),
  mixedPaths: z.array(z.string()),
  patch: z.string(),
});
export type GitDiff = z.infer<typeof GitDiffSchema>;

export const PermissionRiskSchema = z.enum(['safe', 'sensitive', 'destructive', 'prohibited']);
export type PermissionRisk = z.infer<typeof PermissionRiskSchema>;

export const PermissionDecisionSchema = z.object({
  requestId: z.string().min(1),
  taskId: z.string().min(1),
  action: z.string().min(1),
  risk: PermissionRiskSchema,
  reason: z.string().min(1),
});
export type PermissionDecision = z.infer<typeof PermissionDecisionSchema>;
