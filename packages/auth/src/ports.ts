import type { AccountStatus, DeviceSession, PublicUser, UserRole } from '@lyntar/contracts';

export interface StoredUser {
  id: string;
  email: string;
  passwordVerifier: string;
  emailVerifiedAt: string | null;
  status: AccountStatus;
  role: UserRole;
  planId: string;
  createdAt: string;
}

export interface StoredSession {
  sessionId: string;
  userId: string;
  deviceSessionId: string;
  accessTokenHash: string;
  refreshTokenHash: string;
  createdAt: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  revokedAt: string | null;
}

export interface EmailVerificationRecord {
  tokenHash: string;
  userId: string;
  expiresAt: string;
  usedAt: string | null;
}

export interface PasswordResetRecord {
  tokenHash: string;
  userId: string;
  expiresAt: string;
  usedAt: string | null;
}

export interface AuthStore {
  findUserByEmail(email: string): Promise<StoredUser | undefined>;
  getUser(userId: string): Promise<StoredUser | undefined>;
  saveUser(user: StoredUser): Promise<void>;
  updateUser(user: StoredUser): Promise<void>;
  saveDevice(device: DeviceSession): Promise<void>;
  getDevice(deviceSessionId: string): Promise<DeviceSession | undefined>;
  listDevices(userId: string): Promise<DeviceSession[]>;
  updateDevice(device: DeviceSession): Promise<void>;
  saveSession(session: StoredSession): Promise<void>;
  getSessionByAccessHash(hash: string): Promise<StoredSession | undefined>;
  getSessionByRefreshHash(hash: string): Promise<StoredSession | undefined>;
  listSessions(userId: string): Promise<StoredSession[]>;
  updateSession(session: StoredSession): Promise<void>;
  saveEmailVerification(record: EmailVerificationRecord): Promise<void>;
  getEmailVerification(tokenHash: string): Promise<EmailVerificationRecord | undefined>;
  updateEmailVerification(record: EmailVerificationRecord): Promise<void>;
  savePasswordReset(record: PasswordResetRecord): Promise<void>;
  getPasswordReset(tokenHash: string): Promise<PasswordResetRecord | undefined>;
  updatePasswordReset(record: PasswordResetRecord): Promise<void>;
}

export interface DeviceInput {
  label: string;
  platform: string;
  architecture: string;
  appVersion: string;
}

export interface AuthSessionResult {
  user: PublicUser;
  deviceSessionId: string;
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
}
