import { describe, expect, it } from 'vitest';
import { buildApi } from '@lyntar/api';
import {
  AuthService,
  createPkceChallenge,
  createPkceVerifier,
  GoogleDesktopOAuthService,
  InMemoryAuthStore,
  InMemoryOAuthTransactionStore,
} from '@lyntar/auth';

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

  it('uses HttpOnly cookie sessions for web clients while keeping bearer tokens for desktop', async () => {
    const auth = new AuthService({
      store: new InMemoryAuthStore(),
      now: () => new Date('2026-09-20T00:00:00.000Z'),
    });
    const app = buildApi({ auth, exposeDevelopmentTokens: true });
    const registration = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        email: 'web@example.com',
        password: 'correct horse battery staple',
        device: {
          label: 'Astra web',
          platform: 'web',
          architecture: 'browser',
          appVersion: 'web',
        },
      },
    });
    await app.inject({
      method: 'POST',
      url: '/v1/auth/verify-email',
      payload: { token: registration.json().verificationToken },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: {
        email: 'web@example.com',
        password: 'correct horse battery staple',
        device: {
          label: 'Astra web',
          platform: 'web',
          architecture: 'browser',
          appVersion: 'web',
        },
      },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().accessToken).toBeUndefined();
    const setCookie = login.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    if (!setCookie) throw new Error('Web login did not set session cookies');
    const cookieHeader = (Array.isArray(setCookie) ? setCookie : [setCookie])
      .map((value) => value.split(';', 1)[0])
      .join('; ');
    const me = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { cookie: cookieHeader },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('web@example.com');
    const wallet = await app.inject({
      method: 'GET',
      url: '/v1/wallet',
      headers: { cookie: cookieHeader },
    });
    expect(wallet.statusCode).toBe(200);
    expect(wallet.json().wallet.availableCredits).toBe('25');
    const refreshed = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      headers: { cookie: cookieHeader },
      payload: {},
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().accessToken).toBeUndefined();
  });

  it('grants the initial Free entitlement once for a Google desktop account', async () => {
    const auth = new AuthService({ store: new InMemoryAuthStore() });
    const oauth = new GoogleDesktopOAuthService({
      auth,
      store: new InMemoryOAuthTransactionStore(),
      redirectUri: 'https://astra.test/google/callback',
      desktopCallbackUri: 'astra://auth/callback',
      provider: {
        buildAuthorizationUrl: ({ state }) => `https://google.test/auth?state=${state}`,
        exchangeCode: async () => ({
          subject: 'google-api-subject',
          email: 'google-api@example.test',
          emailVerified: true,
        }),
      },
    });
    const app = buildApi({ auth, googleOAuth: oauth });
    const verifier = createPkceVerifier();
    const start = await app.inject({
      method: 'POST',
      url: '/v1/auth/google/start',
      payload: {
        codeChallenge: createPkceChallenge(verifier),
        device: {
          label: 'Astra Windows',
          platform: 'win32',
          architecture: 'x64',
          appVersion: '0.1.0',
        },
      },
    });
    const callback = await app.inject({
      method: 'GET',
      url: `/v1/auth/google/callback?state=${encodeURIComponent(start.json().state)}&code=provider-code-that-is-long-enough`,
    });
    const callbackUrl = callback.headers.location;
    expect(callback.statusCode).toBe(302);
    expect(callbackUrl).toBeDefined();
    if (!callbackUrl) throw new Error('Google callback did not return a desktop redirect');
    const code = new URL(callbackUrl).searchParams.get('code');
    expect(code).toBeTruthy();
    const exchange = await app.inject({
      method: 'POST',
      url: '/v1/auth/google/exchange',
      payload: { code, verifier },
    });
    expect(exchange.statusCode).toBe(200);
    const wallet = await app.inject({
      method: 'GET',
      url: '/v1/wallet',
      headers: { authorization: `Bearer ${exchange.json().accessToken}` },
    });
    expect(wallet.json().wallet.availableCredits).toBe('25');
  });
});
