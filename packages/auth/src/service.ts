import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import {
  PublicUserSchema,
  type AuthProvider,
  type DeviceSession,
  type PublicUser,
} from '@lyntar/contracts';
import { hashPassword, verifyPassword } from './password.js';
import {
  hashRateLimitIdentity,
  InMemoryRateLimitStore,
  type RateLimitStore,
} from './rate-limit.js';
import type {
  AuthSessionResult,
  AuthStore,
  DeviceInput,
  EmailVerificationRecord,
  PasswordResetRecord,
  EmailOtpRecord,
  StoredSession,
  StoredUser,
} from './ports.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export type AuthErrorCode =
  | 'EMAIL_IN_USE'
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_NOT_VERIFIED'
  | 'VERIFICATION_INVALID'
  | 'SESSION_INVALID'
  | 'SESSION_REVOKED'
  | 'SESSION_EXPIRED'
  | 'ACCOUNT_DISABLED'
  | 'DEVICE_NOT_FOUND'
  | 'PASSWORD_RESET_INVALID'
  | 'OTP_INVALID'
  | 'OTP_EXPIRED'
  | 'OTP_ATTEMPTS_EXCEEDED'
  | 'OTP_COOLDOWN'
  | 'EXTERNAL_IDENTITY_INVALID';

export class AuthError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface AuthServiceOptions {
  store: AuthStore;
  rateLimiter?: RateLimitStore;
  now?: () => Date;
  accessTtlMs?: number;
  refreshTtlMs?: number;
  verificationTtlMs?: number;
  resetTtlMs?: number;
  otpTtlMs?: number;
  otpResendCooldownMs?: number;
  otpMaxAttempts?: number;
  loginMaxFailures?: number;
  loginLockoutMs?: number;
}

interface LoginFailureState {
  attempts: number;
  lockedUntil: number;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function token(): string {
  return randomBytes(32).toString('hex');
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function publicUser(user: StoredUser): PublicUser {
  return PublicUserSchema.parse({
    id: user.id,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt,
    status: user.status,
    role: user.role,
    planId: user.planId,
    createdAt: user.createdAt,
  });
}

function deviceFromInput(userId: string, input: DeviceInput, now: string): DeviceSession {
  return {
    deviceSessionId: randomUUID(),
    userId,
    deviceLabel: input.label,
    platform: input.platform,
    architecture: input.architecture,
    desktopVersion: input.appVersion,
    createdAt: now,
    lastSeenAt: now,
    revokedAt: null,
  };
}

export class AuthService {
  private readonly now: () => Date;
  private readonly accessTtlMs: number;
  private readonly refreshTtlMs: number;
  private readonly verificationTtlMs: number;
  private readonly resetTtlMs: number;
  private readonly otpTtlMs: number;
  private readonly otpResendCooldownMs: number;
  private readonly otpMaxAttempts: number;
  private readonly loginMaxFailures: number;
  private readonly loginLockoutMs: number;
  private readonly rateLimiter: RateLimitStore;
  private readonly loginFailures = new Map<string, LoginFailureState>();

  constructor(private readonly options: AuthServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.accessTtlMs = options.accessTtlMs ?? 15 * 60 * 1000;
    this.refreshTtlMs = options.refreshTtlMs ?? 30 * DAY_MS;
    this.verificationTtlMs = options.verificationTtlMs ?? 24 * 60 * 60 * 1000;
    this.resetTtlMs = options.resetTtlMs ?? 60 * 60 * 1000;
    this.otpTtlMs = options.otpTtlMs ?? 10 * 60 * 1000;
    this.otpResendCooldownMs = options.otpResendCooldownMs ?? 60 * 1000;
    this.otpMaxAttempts = options.otpMaxAttempts ?? 5;
    this.loginMaxFailures = options.loginMaxFailures ?? 5;
    this.loginLockoutMs = options.loginLockoutMs ?? 60 * 1000;
    this.rateLimiter = options.rateLimiter ?? new InMemoryRateLimitStore();
  }

  async register(input: { email: string; password: string; device: DeviceInput }): Promise<
    {
      user: StoredUser;
      verificationToken: string;
      device: DeviceInput;
    } & { verificationOtp: string }
  > {
    const email = normalizeEmail(input.email);
    if (await this.options.store.findUserByEmail(email))
      throw new AuthError('EMAIL_IN_USE', 'An account already exists for this email');
    const createdAt = this.now().toISOString();
    const user: StoredUser = {
      id: randomUUID(),
      email,
      passwordVerifier: hashPassword(input.password),
      emailVerifiedAt: null,
      status: 'ACTIVE',
      role: 'USER',
      planId: 'FREE',
      createdAt,
    };
    await this.options.store.saveUser(user);
    const verificationToken = token();
    const record: EmailVerificationRecord = {
      tokenHash: hashToken(verificationToken),
      userId: user.id,
      expiresAt: new Date(this.now().getTime() + this.verificationTtlMs).toISOString(),
      usedAt: null,
    };
    await this.options.store.saveEmailVerification(record);
    const verificationOtp = await this.issueEmailOtp(user);
    return { user, verificationToken, verificationOtp, device: input.device };
  }

  async resendVerificationOtp(email: string): Promise<string | null> {
    const user = await this.options.store.findUserByEmail(normalizeEmail(email));
    if (!user || user.emailVerifiedAt || user.status === 'DISABLED') return null;
    const active = await this.options.store.getActiveEmailOtp(user.id);
    if (
      active &&
      this.now().getTime() - new Date(active.sentAt).getTime() < this.otpResendCooldownMs
    )
      throw new AuthError('OTP_COOLDOWN', 'Please wait before requesting another code');
    return this.issueEmailOtp(user);
  }

  async getUserByEmail(email: string): Promise<StoredUser | undefined> {
    return this.options.store.findUserByEmail(normalizeEmail(email));
  }

  async listUsers(): Promise<PublicUser[]> {
    return (await this.options.store.listUsers()).map((user) => publicUser(user));
  }

  async getUserById(userId: string): Promise<StoredUser | undefined> {
    return this.options.store.getUser(userId);
  }

  async verifyEmailOtp(email: string, value: string): Promise<PublicUser> {
    const user = await this.options.store.findUserByEmail(normalizeEmail(email));
    if (!user || user.emailVerifiedAt)
      throw new AuthError('OTP_INVALID', 'Verification code is invalid');
    const record = await this.options.store.getActiveEmailOtp(user.id);
    if (!record) throw new AuthError('OTP_INVALID', 'Verification code is invalid');
    if (new Date(record.expiresAt).getTime() <= this.now().getTime())
      throw new AuthError('OTP_EXPIRED', 'Verification code has expired');
    if (record.attempts >= record.maxAttempts)
      throw new AuthError('OTP_ATTEMPTS_EXCEEDED', 'Verification attempts exceeded');
    if (hashToken(value) !== record.codeHash) {
      await this.options.store.updateEmailOtp({ ...record, attempts: record.attempts + 1 });
      if (record.attempts + 1 >= record.maxAttempts)
        throw new AuthError('OTP_ATTEMPTS_EXCEEDED', 'Verification attempts exceeded');
      throw new AuthError('OTP_INVALID', 'Verification code is invalid');
    }
    const verifiedAt = this.now().toISOString();
    await this.options.store.updateUser({ ...user, emailVerifiedAt: verifiedAt });
    await this.options.store.updateEmailOtp({ ...record, usedAt: verifiedAt });
    return publicUser({ ...user, emailVerifiedAt: verifiedAt });
  }

  async verifyEmail(verificationToken: string): Promise<PublicUser> {
    const record = await this.options.store.getEmailVerification(hashToken(verificationToken));
    if (!record || record.usedAt || new Date(record.expiresAt).getTime() <= this.now().getTime())
      throw new AuthError('VERIFICATION_INVALID', 'Email verification token is invalid or expired');
    const user = await this.requireUser(record.userId);
    const verifiedAt = this.now().toISOString();
    await this.options.store.updateUser({ ...user, emailVerifiedAt: verifiedAt });
    await this.options.store.updateEmailVerification({ ...record, usedAt: verifiedAt });
    return publicUser({ ...user, emailVerifiedAt: verifiedAt });
  }

  async login(input: {
    email: string;
    password: string;
    device: DeviceInput;
  }): Promise<AuthSessionResult> {
    const email = normalizeEmail(input.email);
    const now = this.now();
    const rateLimitKey = `auth:login:${hashRateLimitIdentity(email)}`;
    const admission = await this.rateLimiter.consume(rateLimitKey, {
      limit: this.loginMaxFailures,
      windowMs: this.loginLockoutMs,
      now: now.getTime(),
    });
    if (!admission.allowed) throw new AuthError('INVALID_CREDENTIALS', 'Invalid email or password');
    const throttle = this.loginFailures.get(email);
    if (throttle && throttle.lockedUntil > now.getTime())
      throw new AuthError('INVALID_CREDENTIALS', 'Invalid email or password');
    if (throttle?.lockedUntil && throttle.lockedUntil <= now.getTime())
      this.loginFailures.delete(email);

    const user = await this.options.store.findUserByEmail(email);
    if (!user || !verifyPassword(input.password, user.passwordVerifier)) {
      this.recordLoginFailure(email, now.getTime());
      throw new AuthError('INVALID_CREDENTIALS', 'Invalid email or password');
    }
    this.loginFailures.delete(email);
    await this.rateLimiter.reset?.(rateLimitKey);
    if (user.status === 'DISABLED') throw new AuthError('ACCOUNT_DISABLED', 'Account is disabled');
    if (!user.emailVerifiedAt)
      throw new AuthError('EMAIL_NOT_VERIFIED', 'Verify your email before logging in');
    const device = deviceFromInput(user.id, input.device, now.toISOString());
    await this.options.store.saveDevice(device);
    return this.createSession(user, device, now);
  }

  private recordLoginFailure(email: string, nowMs: number): void {
    const previous = this.loginFailures.get(email);
    const attempts = (previous?.attempts ?? 0) + 1;
    this.loginFailures.set(email, {
      attempts,
      lockedUntil:
        attempts >= this.loginMaxFailures
          ? nowMs + this.loginLockoutMs
          : (previous?.lockedUntil ?? 0),
    });
  }

  async refresh(refreshToken: string): Promise<AuthSessionResult> {
    const session = await this.options.store.getSessionByRefreshHash(hashToken(refreshToken));
    if (!session) throw new AuthError('SESSION_INVALID', 'Refresh session is invalid');
    if (session.revokedAt) throw new AuthError('SESSION_REVOKED', 'Refresh session is revoked');
    if (new Date(session.refreshExpiresAt).getTime() <= this.now().getTime())
      throw new AuthError('SESSION_EXPIRED', 'Refresh session is expired');
    const user = await this.requireUser(session.userId);
    if (user.status === 'DISABLED') throw new AuthError('ACCOUNT_DISABLED', 'Account is disabled');
    const device = await this.options.store.getDevice(session.deviceSessionId);
    if (!device || device.revokedAt)
      throw new AuthError('SESSION_REVOKED', 'Device session is revoked');
    await this.options.store.updateSession({ ...session, revokedAt: this.now().toISOString() });
    await this.options.store.updateDevice({ ...device, lastSeenAt: this.now().toISOString() });
    return this.createSession(user, device, this.now());
  }

  async authenticate(
    accessToken: string,
  ): Promise<{ user: PublicUser; session: StoredSession; device: DeviceSession }> {
    const session = await this.options.store.getSessionByAccessHash(hashToken(accessToken));
    if (!session) throw new AuthError('SESSION_INVALID', 'Access session is invalid');
    if (new Date(session.accessExpiresAt).getTime() <= this.now().getTime())
      throw new AuthError('SESSION_EXPIRED', 'Access session is expired');
    const user = await this.requireUser(session.userId);
    if (user.status === 'DISABLED') throw new AuthError('ACCOUNT_DISABLED', 'Account is disabled');
    if (session.revokedAt) throw new AuthError('SESSION_REVOKED', 'Access session is revoked');
    const device = await this.options.store.getDevice(session.deviceSessionId);
    if (!device || device.revokedAt)
      throw new AuthError('SESSION_REVOKED', 'Device session is revoked');
    await this.options.store.updateDevice({ ...device, lastSeenAt: this.now().toISOString() });
    return { user: publicUser(user), session, device };
  }

  async logout(accessToken: string): Promise<void> {
    const { session } = await this.authenticate(accessToken);
    await this.options.store.updateSession({ ...session, revokedAt: this.now().toISOString() });
  }

  async logoutAll(accessToken: string): Promise<void> {
    const { user } = await this.authenticate(accessToken);
    const sessions = await this.options.store.listSessions(user.id);
    const revokedAt = this.now().toISOString();
    await Promise.all(
      sessions
        .filter((session) => !session.revokedAt)
        .map((session) => this.options.store.updateSession({ ...session, revokedAt })),
    );
  }

  async listDevices(accessToken: string): Promise<DeviceSession[]> {
    const { user } = await this.authenticate(accessToken);
    return this.options.store.listDevices(user.id);
  }

  async revokeDevice(accessToken: string, deviceSessionId: string): Promise<void> {
    const { user } = await this.authenticate(accessToken);
    const device = await this.options.store.getDevice(deviceSessionId);
    if (!device || device.userId !== user.id)
      throw new AuthError('DEVICE_NOT_FOUND', 'Device session not found');
    const revokedAt = this.now().toISOString();
    await this.options.store.updateDevice({ ...device, revokedAt });
    const sessions = await this.options.store.listSessions(user.id);
    await Promise.all(
      sessions
        .filter((session) => session.deviceSessionId === deviceSessionId && !session.revokedAt)
        .map((session) => this.options.store.updateSession({ ...session, revokedAt })),
    );
  }

  async disableAccount(accessToken: string): Promise<void> {
    const { user } = await this.authenticate(accessToken);
    await this.options.store.updateUser({
      ...(await this.requireUser(user.id)),
      status: 'DISABLED',
    });
    await this.logoutAllForUser(user.id);
  }

  async requestPasswordReset(email: string): Promise<string | null> {
    const user = await this.options.store.findUserByEmail(normalizeEmail(email));
    if (!user || user.status === 'DISABLED') return null;
    const resetToken = token();
    const record: PasswordResetRecord = {
      tokenHash: hashToken(resetToken),
      userId: user.id,
      expiresAt: new Date(this.now().getTime() + this.resetTtlMs).toISOString(),
      usedAt: null,
    };
    await this.options.store.savePasswordReset(record);
    return resetToken;
  }

  async resetPassword(resetToken: string, password: string): Promise<void> {
    const record = await this.options.store.getPasswordReset(hashToken(resetToken));
    if (!record || record.usedAt || new Date(record.expiresAt).getTime() <= this.now().getTime())
      throw new AuthError('PASSWORD_RESET_INVALID', 'Password reset token is invalid or expired');
    const user = await this.requireUser(record.userId);
    const now = this.now().toISOString();
    await this.options.store.updateUser({ ...user, passwordVerifier: hashPassword(password) });
    await this.options.store.updatePasswordReset({ ...record, usedAt: now });
    await this.logoutAllForUser(user.id);
  }

  async assignPlan(userId: string, planId: string): Promise<PublicUser> {
    const user = await this.requireUser(userId);
    const updated = { ...user, planId };
    await this.options.store.updateUser(updated);
    return publicUser(updated);
  }

  async loginExternal(input: {
    provider: AuthProvider;
    subject: string;
    email: string;
    emailVerified: boolean;
    device: DeviceInput;
  }): Promise<AuthSessionResult> {
    if (!input.emailVerified)
      throw new AuthError('EXTERNAL_IDENTITY_INVALID', 'External email is not verified');
    const email = normalizeEmail(input.email);
    let user = await this.options.store.findUserByExternalIdentity(input.provider, input.subject);
    if (!user) user = await this.options.store.findUserByEmail(email);
    if (!user) {
      user = {
        id: randomUUID(),
        email,
        passwordVerifier: '',
        emailVerifiedAt: this.now().toISOString(),
        status: 'ACTIVE',
        role: 'USER',
        planId: 'FREE',
        createdAt: this.now().toISOString(),
      };
      await this.options.store.saveUser(user);
    }
    if (user.status === 'DISABLED') throw new AuthError('ACCOUNT_DISABLED', 'Account is disabled');
    const existing = await this.options.store.findUserByExternalIdentity(
      input.provider,
      input.subject,
    );
    if (!existing)
      await this.options.store.saveExternalIdentity({
        id: randomUUID(),
        provider: input.provider,
        subject: input.subject,
        userId: user.id,
        email,
        createdAt: this.now().toISOString(),
      });
    const device = deviceFromInput(user.id, input.device, this.now().toISOString());
    await this.options.store.saveDevice(device);
    return this.createSession(user, device, this.now());
  }

  private async requireUser(userId: string): Promise<StoredUser> {
    const user = await this.options.store.getUser(userId);
    if (!user) throw new AuthError('INVALID_CREDENTIALS', 'Account not found');
    return user;
  }

  private async issueEmailOtp(user: StoredUser): Promise<string> {
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const now = this.now();
    const previous = await this.options.store.getActiveEmailOtp(user.id);
    if (previous)
      await this.options.store.updateEmailOtp({ ...previous, usedAt: now.toISOString() });
    const record: EmailOtpRecord = {
      id: randomUUID(),
      userId: user.id,
      email: user.email,
      codeHash: hashToken(code),
      expiresAt: new Date(now.getTime() + this.otpTtlMs).toISOString(),
      attempts: 0,
      maxAttempts: this.otpMaxAttempts,
      sentAt: now.toISOString(),
      usedAt: null,
    };
    await this.options.store.saveEmailOtp(record);
    return code;
  }

  private async logoutAllForUser(userId: string): Promise<void> {
    const revokedAt = this.now().toISOString();
    const sessions = await this.options.store.listSessions(userId);
    await Promise.all(
      sessions
        .filter((session) => !session.revokedAt)
        .map((session) => this.options.store.updateSession({ ...session, revokedAt })),
    );
  }

  private async createSession(
    user: StoredUser,
    device: DeviceSession,
    now: Date,
  ): Promise<AuthSessionResult> {
    const accessToken = token();
    const refreshToken = token();
    const accessExpiresAt = new Date(now.getTime() + this.accessTtlMs).toISOString();
    const refreshExpiresAt = new Date(now.getTime() + this.refreshTtlMs).toISOString();
    const session: StoredSession = {
      sessionId: randomUUID(),
      userId: user.id,
      deviceSessionId: device.deviceSessionId,
      accessTokenHash: hashToken(accessToken),
      refreshTokenHash: hashToken(refreshToken),
      createdAt: now.toISOString(),
      accessExpiresAt,
      refreshExpiresAt,
      revokedAt: null,
    };
    await this.options.store.saveSession(session);
    return {
      user: publicUser(user),
      deviceSessionId: device.deviceSessionId,
      accessToken,
      refreshToken,
      accessExpiresAt,
      refreshExpiresAt,
    };
  }
}
