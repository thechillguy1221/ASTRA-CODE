import { describe, expect, it } from 'vitest';
import { buildApi } from '@lyntar/api';
import { AuthService, InMemoryAuthStore } from '@lyntar/auth';

describe('authentication API', () => {
  it('registers, verifies, logs in, refreshes, and lists devices', async () => {
    const auth = new AuthService({
      store: new InMemoryAuthStore(),
      now: () => new Date('2026-09-20T00:00:00.000Z'),
    });
    const app = buildApi({ auth, exposeDevelopmentTokens: true });
    const registration = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        email: 'api@example.com',
        password: 'correct horse battery staple',
        device: {
          label: 'Lyntar Windows',
          platform: 'win32',
          architecture: 'x64',
          appVersion: '0.1.0',
        },
      },
    });
    expect(registration.statusCode).toBe(201);
    const verificationToken = registration.json().verificationToken as string;
    const verify = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify-email',
      payload: { token: verificationToken },
    });
    expect(verify.statusCode).toBe(204);
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: {
        email: 'api@example.com',
        password: 'correct horse battery staple',
        device: {
          label: 'Lyntar Windows',
          platform: 'win32',
          architecture: 'x64',
          appVersion: '0.1.0',
        },
      },
    });
    expect(login.statusCode).toBe(200);
    const accessToken = login.json().accessToken as string;
    const devices = await app.inject({
      method: 'GET',
      url: '/v1/auth/devices',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(devices.statusCode).toBe(200);
    expect(devices.json().devices).toHaveLength(1);
  });

  it('rejects an unauthenticated device-management request', async () => {
    const app = buildApi({ auth: new AuthService({ store: new InMemoryAuthStore() }) });
    const response = await app.inject({ method: 'GET', url: '/v1/auth/devices' });
    expect(response.statusCode).toBe(401);
  });
});
