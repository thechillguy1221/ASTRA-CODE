import { z } from 'zod';

export const AccountStatusSchema = z.enum(['ACTIVE', 'DISABLED']);
export type AccountStatus = z.infer<typeof AccountStatusSchema>;

export const UserRoleSchema = z.enum(['USER', 'SUPER_ADMIN', 'FINANCE', 'SUPPORT']);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const DeviceSessionSchema = z.object({
  deviceSessionId: z.string().uuid(),
  userId: z.string().uuid(),
  deviceLabel: z.string().min(1).max(120),
  platform: z.string().min(1).max(40),
  architecture: z.string().min(1).max(40),
  desktopVersion: z.string().min(1).max(40),
  createdAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
});
export type DeviceSession = z.infer<typeof DeviceSessionSchema>;

export const PublicUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  emailVerifiedAt: z.string().datetime().nullable(),
  status: AccountStatusSchema,
  role: UserRoleSchema,
  planId: z.string().min(1),
  createdAt: z.string().datetime(),
});
export type PublicUser = z.infer<typeof PublicUserSchema>;

export const AuthSessionResultSchema = z.object({
  user: PublicUserSchema,
  deviceSessionId: z.string().uuid(),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  accessExpiresAt: z.string().datetime(),
  refreshExpiresAt: z.string().datetime(),
});
export type AuthSessionResult = z.infer<typeof AuthSessionResultSchema>;
