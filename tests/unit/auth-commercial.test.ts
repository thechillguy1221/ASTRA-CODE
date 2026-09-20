import { describe, expect, it } from 'vitest';
import {
  AuthService,
  createPkceChallenge,
  createPkceVerifier,
  GoogleDesktopOAuthService,
  InMemoryAuthStore,
  InMemoryOAuthTransactionStore,
} from '@lyntar/auth';

const device = {
  label: 'Astra test desktop',
  platform: 'win32',
  architecture: 'x64',
  appVersion: '0.1.0',
};

describe('commercial authentication boundaries', () => {
  it('verifies a single-use expiring OTP and enforces the resend cooldown', async () => {
    let now = new Date('2026-09-20T10:00:00.000Z');
    const auth = new AuthService({
      store: new InMemoryAuthStore(),
      now: () => now,
      otpResendCooldownMs: 60_000,
    });
    const result = await auth.register({
      email: 'User@Example.com',
      password: 'a-strong-password-123',
      device,
    });
    await expect(auth.verifyEmailOtp('user@example.com', '000000')).rejects.toMatchObject({
      code: 'OTP_INVALID',
    });
    await expect(auth.resendVerificationOtp('user@example.com')).rejects.toMatchObject({
      code: 'OTP_COOLDOWN',
    });
    const user = await auth.verifyEmailOtp('user@example.com', result.verificationOtp);
    expect(user.emailVerifiedAt).toBe(now.toISOString());
    await expect(
      auth.verifyEmailOtp('user@example.com', result.verificationOtp),
    ).rejects.toMatchObject({
      code: 'OTP_INVALID',
    });
    now = new Date(now.getTime() + 61_000);
    expect(await auth.resendVerificationOtp('user@example.com')).toBeNull();
  });

  it('limits OTP attempts and never returns an account for an unknown email', async () => {
    const auth = new AuthService({ store: new InMemoryAuthStore(), otpMaxAttempts: 2 });
    expect(await auth.resendVerificationOtp('missing@example.com')).toBeNull();
    const result = await auth.register({
      email: 'otp@example.com',
      password: 'a-strong-password-123',
      device,
    });
    await expect(auth.verifyEmailOtp('otp@example.com', '111111')).rejects.toMatchObject({
      code: 'OTP_INVALID',
    });
    await expect(auth.verifyEmailOtp('otp@example.com', '111111')).rejects.toMatchObject({
      code: 'OTP_ATTEMPTS_EXCEEDED',
    });
    expect(result.verificationOtp).toMatch(/^\d{6}$/);
  });

  it('binds Google desktop exchange to PKCE and consumes the one-time code', async () => {
    const auth = new AuthService({ store: new InMemoryAuthStore() });
    const store = new InMemoryOAuthTransactionStore();
    const oauth = new GoogleDesktopOAuthService({
      auth,
      store,
      redirectUri: 'https://astra.test/google/callback',
      desktopCallbackUri: 'astra://auth/callback',
      provider: {
        buildAuthorizationUrl: ({ state, codeChallenge }) =>
          `https://google.test/auth?state=${state}&challenge=${codeChallenge}`,
        exchangeCode: async () => ({
          subject: 'google-subject',
          email: 'google@example.com',
          emailVerified: true,
        }),
      },
    });
    const verifier = createPkceVerifier();
    const started = await oauth.begin({ codeChallenge: createPkceChallenge(verifier), device });
    expect(started.authorizationUrl).toContain(started.state);
    const callback = await oauth.completeCallback({
      state: started.state,
      code: 'provider-code-that-is-long-enough',
    });
    await expect(
      oauth.exchangeDesktopCode({ code: callback.desktopCode, verifier: `${verifier}wrong` }),
    ).rejects.toThrow('Desktop OAuth proof is invalid');
    const session = await oauth.exchangeDesktopCode({ code: callback.desktopCode, verifier });
    expect(session.user.email).toBe('google@example.com');
    await expect(
      oauth.exchangeDesktopCode({ code: callback.desktopCode, verifier }),
    ).rejects.toThrow('Desktop OAuth code is invalid or expired');
  });

  it('keeps password auth behavior available while external identities are added', async () => {
    const auth = new AuthService({ store: new InMemoryAuthStore() });
    const result = await auth.register({
      email: 'password@example.com',
      password: 'a-strong-password-123',
      device,
    });
    await auth.verifyEmail(result.verificationToken);
    const session = await auth.login({
      email: 'password@example.com',
      password: 'a-strong-password-123',
      device,
    });
    expect(session.user.email).toBe('password@example.com');
  });

  it('throttles repeated password failures and clears the lock after the delay', async () => {
    let now = new Date('2026-09-20T10:00:00.000Z');
    const auth = new AuthService({
      store: new InMemoryAuthStore(),
      now: () => now,
      loginMaxFailures: 2,
      loginLockoutMs: 60_000,
    });
    const registration = await auth.register({
      email: 'throttle@example.com',
      password: 'a-strong-password-123',
      device,
    });
    await auth.verifyEmail(registration.verificationToken);
    const input = {
      email: 'throttle@example.com',
      password: 'wrong-password',
      device,
    };
    await expect(auth.login(input)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await expect(auth.login(input)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await expect(auth.login({ ...input, password: 'a-strong-password-123' })).rejects.toMatchObject(
      { code: 'INVALID_CREDENTIALS' },
    );
    now = new Date(now.getTime() + 60_001);
    const session = await auth.login({ ...input, password: 'a-strong-password-123' });
    expect(session.user.email).toBe('throttle@example.com');
  });
});
