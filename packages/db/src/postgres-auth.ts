import type { Pool } from 'pg';
import { DeviceSessionSchema, type DeviceSession } from '@lyntar/contracts';
import type {
  AuthStore,
  EmailVerificationRecord,
  PasswordResetRecord,
  StoredSession,
  StoredUser,
} from '@lyntar/auth';

function mapUser(row: Record<string, unknown>): StoredUser {
  return {
    id: String(row.id),
    email: String(row.email),
    passwordVerifier: String(row.password_verifier),
    emailVerifiedAt: row.email_verified_at
      ? new Date(String(row.email_verified_at)).toISOString()
      : null,
    status: row.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE',
    role:
      row.role === 'SUPER_ADMIN' || row.role === 'FINANCE' || row.role === 'SUPPORT'
        ? row.role
        : 'USER',
    planId: String(row.plan_id ?? 'FREE'),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

function mapDevice(row: Record<string, unknown>): DeviceSession {
  return DeviceSessionSchema.parse({
    deviceSessionId: row.id,
    userId: row.user_id,
    deviceLabel: row.device_label,
    platform: row.platform,
    architecture: row.architecture,
    desktopVersion: row.desktop_version,
    createdAt: new Date(String(row.created_at)).toISOString(),
    lastSeenAt: new Date(String(row.last_seen_at)).toISOString(),
    revokedAt: row.revoked_at ? new Date(String(row.revoked_at)).toISOString() : null,
  });
}

function mapSession(row: Record<string, unknown>): StoredSession {
  return {
    sessionId: String(row.id),
    userId: String(row.user_id),
    deviceSessionId: String(row.device_session_id),
    accessTokenHash: String(row.access_token_hash),
    refreshTokenHash: String(row.refresh_token_hash),
    createdAt: new Date(String(row.created_at)).toISOString(),
    accessExpiresAt: new Date(String(row.access_expires_at)).toISOString(),
    refreshExpiresAt: new Date(String(row.refresh_expires_at)).toISOString(),
    revokedAt: row.revoked_at ? new Date(String(row.revoked_at)).toISOString() : null,
  };
}

export class PostgresAuthStore implements AuthStore {
  constructor(private readonly pool: Pool) {}

  async findUserByEmail(email: string): Promise<StoredUser | undefined> {
    const result = await this.pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return result.rows[0] ? mapUser(result.rows[0] as Record<string, unknown>) : undefined;
  }

  async getUser(userId: string): Promise<StoredUser | undefined> {
    const result = await this.pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    return result.rows[0] ? mapUser(result.rows[0] as Record<string, unknown>) : undefined;
  }

  async saveUser(user: StoredUser): Promise<void> {
    await this.pool.query(
      `INSERT INTO users (id, email, password_verifier, email_verified_at, status, role, plan_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
      [
        user.id,
        user.email,
        user.passwordVerifier,
        user.emailVerifiedAt,
        user.status,
        user.role,
        user.planId,
        user.createdAt,
      ],
    );
  }

  async updateUser(user: StoredUser): Promise<void> {
    await this.pool.query(
      `UPDATE users SET email = $2, password_verifier = $3, email_verified_at = $4,
       status = $5, role = $6, plan_id = $7, updated_at = now() WHERE id = $1`,
      [
        user.id,
        user.email,
        user.passwordVerifier,
        user.emailVerifiedAt,
        user.status,
        user.role,
        user.planId,
      ],
    );
  }

  async saveDevice(device: DeviceSession): Promise<void> {
    await this.pool.query(
      `INSERT INTO device_sessions (id, user_id, device_label, platform, architecture, desktop_version, created_at, last_seen_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        device.deviceSessionId,
        device.userId,
        device.deviceLabel,
        device.platform,
        device.architecture,
        device.desktopVersion,
        device.createdAt,
        device.lastSeenAt,
        device.revokedAt,
      ],
    );
  }

  async getDevice(deviceSessionId: string): Promise<DeviceSession | undefined> {
    const result = await this.pool.query('SELECT * FROM device_sessions WHERE id = $1', [
      deviceSessionId,
    ]);
    return result.rows[0] ? mapDevice(result.rows[0] as Record<string, unknown>) : undefined;
  }

  async listDevices(userId: string): Promise<DeviceSession[]> {
    const result = await this.pool.query(
      'SELECT * FROM device_sessions WHERE user_id = $1 ORDER BY last_seen_at DESC',
      [userId],
    );
    return result.rows.map((row) => mapDevice(row as Record<string, unknown>));
  }

  async updateDevice(device: DeviceSession): Promise<void> {
    await this.pool.query(
      `UPDATE device_sessions SET device_label = $2, last_seen_at = $3, revoked_at = $4 WHERE id = $1 AND user_id = $5`,
      [
        device.deviceSessionId,
        device.deviceLabel,
        device.lastSeenAt,
        device.revokedAt,
        device.userId,
      ],
    );
  }

  async saveSession(session: StoredSession): Promise<void> {
    await this.pool.query(
      `INSERT INTO auth_sessions (id, user_id, device_session_id, access_token_hash, refresh_token_hash, created_at, access_expires_at, refresh_expires_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        session.sessionId,
        session.userId,
        session.deviceSessionId,
        session.accessTokenHash,
        session.refreshTokenHash,
        session.createdAt,
        session.accessExpiresAt,
        session.refreshExpiresAt,
        session.revokedAt,
      ],
    );
  }

  async getSessionByAccessHash(hash: string): Promise<StoredSession | undefined> {
    const result = await this.pool.query(
      'SELECT * FROM auth_sessions WHERE access_token_hash = $1',
      [hash],
    );
    return result.rows[0] ? mapSession(result.rows[0] as Record<string, unknown>) : undefined;
  }

  async getSessionByRefreshHash(hash: string): Promise<StoredSession | undefined> {
    const result = await this.pool.query(
      'SELECT * FROM auth_sessions WHERE refresh_token_hash = $1',
      [hash],
    );
    return result.rows[0] ? mapSession(result.rows[0] as Record<string, unknown>) : undefined;
  }

  async listSessions(userId: string): Promise<StoredSession[]> {
    const result = await this.pool.query('SELECT * FROM auth_sessions WHERE user_id = $1', [
      userId,
    ]);
    return result.rows.map((row) => mapSession(row as Record<string, unknown>));
  }

  async updateSession(session: StoredSession): Promise<void> {
    await this.pool.query('UPDATE auth_sessions SET revoked_at = $2 WHERE id = $1', [
      session.sessionId,
      session.revokedAt,
    ]);
  }

  async saveEmailVerification(record: EmailVerificationRecord): Promise<void> {
    await this.pool.query(
      'INSERT INTO email_verification_tokens (token_hash, user_id, expires_at, used_at) VALUES ($1, $2, $3, $4)',
      [record.tokenHash, record.userId, record.expiresAt, record.usedAt],
    );
  }

  async getEmailVerification(tokenHash: string): Promise<EmailVerificationRecord | undefined> {
    const result = await this.pool.query(
      'SELECT * FROM email_verification_tokens WHERE token_hash = $1',
      [tokenHash],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row
      ? {
          tokenHash: String(row.token_hash),
          userId: String(row.user_id),
          expiresAt: new Date(String(row.expires_at)).toISOString(),
          usedAt: row.used_at ? new Date(String(row.used_at)).toISOString() : null,
        }
      : undefined;
  }

  async updateEmailVerification(record: EmailVerificationRecord): Promise<void> {
    await this.pool.query(
      'UPDATE email_verification_tokens SET used_at = $2 WHERE token_hash = $1',
      [record.tokenHash, record.usedAt],
    );
  }

  async savePasswordReset(record: PasswordResetRecord): Promise<void> {
    await this.pool.query(
      'INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, used_at) VALUES ($1, $2, $3, $4)',
      [record.tokenHash, record.userId, record.expiresAt, record.usedAt],
    );
  }

  async getPasswordReset(tokenHash: string): Promise<PasswordResetRecord | undefined> {
    const result = await this.pool.query(
      'SELECT * FROM password_reset_tokens WHERE token_hash = $1',
      [tokenHash],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row
      ? {
          tokenHash: String(row.token_hash),
          userId: String(row.user_id),
          expiresAt: new Date(String(row.expires_at)).toISOString(),
          usedAt: row.used_at ? new Date(String(row.used_at)).toISOString() : null,
        }
      : undefined;
  }

  async updatePasswordReset(record: PasswordResetRecord): Promise<void> {
    await this.pool.query('UPDATE password_reset_tokens SET used_at = $2 WHERE token_hash = $1', [
      record.tokenHash,
      record.usedAt,
    ]);
  }
}
