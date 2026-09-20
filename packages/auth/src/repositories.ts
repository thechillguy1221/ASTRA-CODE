import type { DeviceSession } from '@lyntar/contracts';
import type {
  AuthStore,
  EmailVerificationRecord,
  PasswordResetRecord,
  StoredSession,
  StoredUser,
} from './ports.js';

export class InMemoryAuthStore implements AuthStore {
  readonly users = new Map<string, StoredUser>();
  readonly devices = new Map<string, DeviceSession>();
  readonly sessions = new Map<string, StoredSession>();
  readonly emailVerifications = new Map<string, EmailVerificationRecord>();
  readonly passwordResets = new Map<string, PasswordResetRecord>();

  async findUserByEmail(email: string): Promise<StoredUser | undefined> {
    return [...this.users.values()].find((user) => user.email === email);
  }

  async getUser(userId: string): Promise<StoredUser | undefined> {
    return this.users.get(userId);
  }

  async saveUser(user: StoredUser): Promise<void> {
    this.users.set(user.id, user);
  }

  async updateUser(user: StoredUser): Promise<void> {
    this.users.set(user.id, user);
  }

  async saveDevice(device: DeviceSession): Promise<void> {
    this.devices.set(device.deviceSessionId, device);
  }

  async getDevice(deviceSessionId: string): Promise<DeviceSession | undefined> {
    return this.devices.get(deviceSessionId);
  }

  async listDevices(userId: string): Promise<DeviceSession[]> {
    return [...this.devices.values()].filter((device) => device.userId === userId);
  }

  async updateDevice(device: DeviceSession): Promise<void> {
    this.devices.set(device.deviceSessionId, device);
  }

  async saveSession(session: StoredSession): Promise<void> {
    this.sessions.set(session.sessionId, session);
  }

  async getSessionByAccessHash(hash: string): Promise<StoredSession | undefined> {
    return [...this.sessions.values()].find((session) => session.accessTokenHash === hash);
  }

  async getSessionByRefreshHash(hash: string): Promise<StoredSession | undefined> {
    return [...this.sessions.values()].find((session) => session.refreshTokenHash === hash);
  }

  async listSessions(userId: string): Promise<StoredSession[]> {
    return [...this.sessions.values()].filter((session) => session.userId === userId);
  }

  async updateSession(session: StoredSession): Promise<void> {
    this.sessions.set(session.sessionId, session);
  }

  async saveEmailVerification(record: EmailVerificationRecord): Promise<void> {
    this.emailVerifications.set(record.tokenHash, record);
  }

  async getEmailVerification(tokenHash: string): Promise<EmailVerificationRecord | undefined> {
    return this.emailVerifications.get(tokenHash);
  }

  async updateEmailVerification(record: EmailVerificationRecord): Promise<void> {
    this.emailVerifications.set(record.tokenHash, record);
  }

  async savePasswordReset(record: PasswordResetRecord): Promise<void> {
    this.passwordResets.set(record.tokenHash, record);
  }

  async getPasswordReset(tokenHash: string): Promise<PasswordResetRecord | undefined> {
    return this.passwordResets.get(tokenHash);
  }

  async updatePasswordReset(record: PasswordResetRecord): Promise<void> {
    this.passwordResets.set(record.tokenHash, record);
  }
}
