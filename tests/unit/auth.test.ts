import { describe, expect, it } from 'vitest';
import { AuthError, AuthService, InMemoryAuthStore } from '@lyntar/auth';

function createService() {
  return new AuthService({
    store: new InMemoryAuthStore(),
    now: () => new Date('2026-09-20T00:00:00.000Z'),
  });
}

describe('authentication service', () => {
  it('stores a one-way password verifier and requires email verification before login', async () => {
    const service = createService();
    const registration = await service.register({
      email: 'student@example.com',
      password: 'correct horse battery staple',
      device: {
        label: 'Windows laptop',
        platform: 'win32',
        architecture: 'x64',
        appVersion: '0.1.0',
      },
    });

    expect(registration.verificationToken).toHaveLength(64);
    expect(registration.user.passwordVerifier).not.toContain('correct horse battery staple');
    await expect(
      service.login({
        email: 'student@example.com',
        password: 'correct horse battery staple',
        device: registration.device,
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });

    await service.verifyEmail(registration.verificationToken);
    const login = await service.login({
      email: 'student@example.com',
      password: 'correct horse battery staple',
      device: registration.device,
    });
    expect(login.accessToken).toHaveLength(64);
    expect(login.refreshToken).toHaveLength(64);
    expect(login.user.emailVerifiedAt).toBe('2026-09-20T00:00:00.000Z');
  });

  it('rotates refresh tokens and invalidates the previous token', async () => {
    const service = createService();
    const registration = await service.register({
      email: 'rotate@example.com',
      password: 'a secure password',
      device: { label: 'Desktop', platform: 'win32', architecture: 'x64', appVersion: '0.1.0' },
    });
    await service.verifyEmail(registration.verificationToken);
    const first = await service.login({
      email: 'rotate@example.com',
      password: 'a secure password',
      device: registration.device,
    });
    const second = await service.refresh(first.refreshToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    await expect(service.refresh(first.refreshToken)).rejects.toMatchObject({
      code: 'SESSION_REVOKED',
    });
  });

  it('supports device revocation, logout-all, and account disable', async () => {
    const service = createService();
    const registration = await service.register({
      email: 'devices@example.com',
      password: 'a secure password',
      device: { label: 'Desktop', platform: 'win32', architecture: 'x64', appVersion: '0.1.0' },
    });
    await service.verifyEmail(registration.verificationToken);
    const first = await service.login({
      email: 'devices@example.com',
      password: 'a secure password',
      device: registration.device,
    });
    const second = await service.login({
      email: 'devices@example.com',
      password: 'a secure password',
      device: {
        label: 'Other desktop',
        platform: 'win32',
        architecture: 'x64',
        appVersion: '0.1.0',
      },
    });
    expect(await service.listDevices(first.accessToken)).toHaveLength(2);
    await service.revokeDevice(first.accessToken, second.deviceSessionId);
    await expect(service.refresh(second.refreshToken)).rejects.toMatchObject({
      code: 'SESSION_REVOKED',
    });
    await service.logoutAll(first.accessToken);
    await expect(service.refresh(first.refreshToken)).rejects.toMatchObject({
      code: 'SESSION_REVOKED',
    });

    const third = await service.login({
      email: 'devices@example.com',
      password: 'a secure password',
      device: registration.device,
    });
    await service.disableAccount(third.accessToken);
    await expect(service.authenticate(third.accessToken)).rejects.toMatchObject({
      code: 'ACCOUNT_DISABLED',
    });
    expect(AuthError).toBeDefined();
  });
});
