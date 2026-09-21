import type { AuthError, AuthService, DeviceInput } from '@astra/auth';
import type { GoogleDesktopOAuthService } from '@astra/auth';
import type { EmailService } from '@astra/email';
import type { BillingService } from '@astra/billing';
import type { PlanCatalog } from '@astra/plans';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

const DeviceInputSchema = z.object({
  label: z.string().min(1).max(120),
  platform: z.string().min(1).max(40),
  architecture: z.string().min(1).max(40),
  appVersion: z.string().min(1).max(40),
});

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  device: DeviceInputSchema,
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  device: DeviceInputSchema,
});
const VerifyEmailSchema = z.object({ token: z.string().length(64) });
const VerifyOtpSchema = z.object({ email: z.string().email(), code: z.string().regex(/^\d{6}$/) });
const ResendOtpSchema = z.object({ email: z.string().email() });
const RefreshSchema = z.object({ refreshToken: z.string().length(64).optional() });
const ResetRequestSchema = z.object({ email: z.string().email() });
const ResetSchema = z.object({ token: z.string().length(64), password: z.string().min(12) });
const GoogleStartSchema = z.object({
  codeChallenge: z.string().min(43).max(128),
  device: DeviceInputSchema,
});
const GoogleExchangeSchema = z.object({
  code: z.string().min(20),
  verifier: z.string().min(43).max(128),
});

const ACCESS_COOKIE = 'astra_access';
const REFRESH_COOKIE = 'astra_refresh';

function bearer(request: FastifyRequest): string | null {
  const value = request.headers.authorization;
  if (!value?.startsWith('Bearer ')) return null;
  return value.slice('Bearer '.length).trim() || null;
}

function cookie(request: FastifyRequest, name: string): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
}

function accessToken(request: FastifyRequest): string | null {
  return bearer(request) ?? cookie(request, ACCESS_COOKIE);
}

function cookieValue(name: string, value: string, maxAge: number, secure: boolean): string {
  return `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

function setSessionCookies(
  request: FastifyRequest,
  reply: FastifyReply,
  session: { accessToken: string; refreshToken: string; refreshExpiresAt: string },
  secureCookies: boolean,
): void {
  const maxAge = Math.max(
    0,
    Math.floor((new Date(session.refreshExpiresAt).getTime() - Date.now()) / 1000),
  );
  const secure = secureCookies || request.protocol === 'https';
  reply.header('set-cookie', [
    cookieValue(ACCESS_COOKIE, session.accessToken, 15 * 60, secure),
    cookieValue(REFRESH_COOKIE, session.refreshToken, maxAge, secure),
  ]);
}

function clearSessionCookies(
  request: FastifyRequest,
  reply: FastifyReply,
  secureCookies: boolean,
): void {
  const secure = secureCookies || request.protocol === 'https';
  reply.header('set-cookie', [
    cookieValue(ACCESS_COOKIE, '', 0, secure),
    cookieValue(REFRESH_COOKIE, '', 0, secure),
  ]);
}

function sendAuthError(reply: FastifyReply, error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error))
    return reply.code(500).send({ error: 'auth_failed' });
  const code = (error as AuthError).code;
  const status =
    code === 'EMAIL_IN_USE'
      ? 409
      : code === 'INVALID_CREDENTIALS' || code === 'SESSION_INVALID' || code === 'SESSION_REVOKED'
        ? 401
        : code === 'EMAIL_NOT_VERIFIED' || code === 'ACCOUNT_DISABLED'
          ? 403
          : code === 'DEVICE_NOT_FOUND'
            ? 404
            : code === 'OTP_COOLDOWN'
              ? 429
              : code === 'OTP_ATTEMPTS_EXCEEDED' || code === 'OTP_EXPIRED'
                ? 400
                : 400;
  return reply.code(status).send({ error: code });
}

function requireToken(request: FastifyRequest, reply: FastifyReply): string | null {
  const token = accessToken(request);
  if (!token) {
    void reply.code(401).send({ error: 'SESSION_INVALID' });
    return null;
  }
  return token;
}

export interface AuthRouteDependencies {
  auth?: AuthService;
  exposeDevelopmentTokens?: boolean;
  billing?: BillingService;
  plans?: PlanCatalog;
  email?: EmailService;
  publicSiteUrl?: string;
  googleOAuth?: GoogleDesktopOAuthService;
  secureCookies?: boolean;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  dependencies: AuthRouteDependencies,
): Promise<void> {
  const unavailable = () => ({ error: 'auth_not_configured' });
  app.post('/v1/auth/register', async (request, reply) => {
    if (!dependencies.auth) return reply.code(503).send(unavailable());
    const parsed = RegisterSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    try {
      const result = await dependencies.auth.register({
        email: parsed.data.email,
        password: parsed.data.password,
        device: parsed.data.device as DeviceInput,
      });
      const freePlan = dependencies.plans?.get('FREE');
      if (dependencies.billing && freePlan) {
        await dependencies.billing.grantCredits({
          userId: result.user.id,
          amountCredits: freePlan.monthlyCredits,
          transactionType: 'SUBSCRIPTION_GRANT',
          idempotencyKey: `signup:${result.user.id}:FREE`,
          reason: 'Initial Free plan entitlement',
          sourceType: 'free_monthly',
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        });
      }
      if (dependencies.email)
        await dependencies.email.sendVerificationOtp({
          userId: result.user.id,
          email: result.user.email,
          otp: result.verificationOtp,
        });
      return reply.code(201).send({
        user: {
          id: result.user.id,
          email: result.user.email,
          emailVerifiedAt: result.user.emailVerifiedAt,
          status: result.user.status,
          role: result.user.role,
          planId: result.user.planId,
          createdAt: result.user.createdAt,
        },
        emailVerificationRequired: true,
        ...(dependencies.exposeDevelopmentTokens
          ? { verificationToken: result.verificationToken }
          : {}),
        ...(dependencies.exposeDevelopmentTokens
          ? { verificationOtp: result.verificationOtp }
          : {}),
      });
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post('/v1/auth/verify-email', async (request, reply) => {
    if (!dependencies.auth) return reply.code(503).send(unavailable());
    const parsed = VerifyEmailSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    try {
      await dependencies.auth.verifyEmail(parsed.data.token);
      return reply.code(204).send();
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post('/v1/auth/verify-otp', async (request, reply) => {
    if (!dependencies.auth) return reply.code(503).send(unavailable());
    const parsed = VerifyOtpSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    try {
      const user = await dependencies.auth.verifyEmailOtp(parsed.data.email, parsed.data.code);
      if (dependencies.email)
        await dependencies.email.sendWelcome({ userId: user.id, email: user.email });
      return reply.send({ user });
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post('/v1/auth/resend-otp', async (request, reply) => {
    if (!dependencies.auth) return reply.code(503).send(unavailable());
    const parsed = ResendOtpSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    try {
      const code = await dependencies.auth.resendVerificationOtp(parsed.data.email);
      if (code && dependencies.exposeDevelopmentTokens) return reply.send({ accepted: true, code });
      return reply.send({ accepted: true });
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post('/v1/auth/login', async (request, reply) => {
    if (!dependencies.auth) return reply.code(503).send(unavailable());
    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    try {
      const session = await dependencies.auth.login(parsed.data);
      if (parsed.data.device.platform === 'web')
        setSessionCookies(request, reply, session, dependencies.secureCookies ?? false);
      return reply.send(
        parsed.data.device.platform === 'web'
          ? {
              user: session.user,
              deviceSessionId: session.deviceSessionId,
              accessExpiresAt: session.accessExpiresAt,
              refreshExpiresAt: session.refreshExpiresAt,
            }
          : session,
      );
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post('/v1/auth/refresh', async (request, reply) => {
    if (!dependencies.auth) return reply.code(503).send(unavailable());
    const parsed = RefreshSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    try {
      const refreshToken = parsed.data.refreshToken ?? cookie(request, REFRESH_COOKIE);
      if (!refreshToken) return reply.code(401).send({ error: 'SESSION_INVALID' });
      const session = await dependencies.auth.refresh(refreshToken);
      if (!bearer(request))
        setSessionCookies(request, reply, session, dependencies.secureCookies ?? false);
      return reply.send(
        bearer(request)
          ? session
          : {
              user: session.user,
              deviceSessionId: session.deviceSessionId,
              accessExpiresAt: session.accessExpiresAt,
              refreshExpiresAt: session.refreshExpiresAt,
            },
      );
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.get('/v1/auth/me', async (request, reply) => {
    if (!dependencies.auth) return reply.code(503).send(unavailable());
    const token = requireToken(request, reply);
    if (!token) return;
    try {
      return reply.send(await dependencies.auth.authenticate(token));
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post('/v1/auth/logout', async (request, reply) => {
    if (!dependencies.auth) return reply.code(503).send(unavailable());
    const token = requireToken(request, reply);
    if (!token) return;
    try {
      await dependencies.auth.logout(token);
      clearSessionCookies(request, reply, dependencies.secureCookies ?? false);
      return reply.code(204).send();
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post('/v1/auth/logout-all', async (request, reply) => {
    if (!dependencies.auth) return reply.code(503).send(unavailable());
    const token = requireToken(request, reply);
    if (!token) return;
    try {
      await dependencies.auth.logoutAll(token);
      clearSessionCookies(request, reply, dependencies.secureCookies ?? false);
      return reply.code(204).send();
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.get('/v1/auth/devices', async (request, reply) => {
    if (!dependencies.auth) return reply.code(503).send(unavailable());
    const token = requireToken(request, reply);
    if (!token) return;
    try {
      return reply.send({ devices: await dependencies.auth.listDevices(token) });
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post<{ Params: { deviceSessionId: string } }>(
    '/v1/auth/devices/:deviceSessionId/revoke',
    async (request, reply) => {
      if (!dependencies.auth) return reply.code(503).send(unavailable());
      const token = requireToken(request, reply);
      if (!token) return;
      try {
        await dependencies.auth.revokeDevice(token, request.params.deviceSessionId);
        return reply.code(204).send();
      } catch (error) {
        return sendAuthError(reply, error);
      }
    },
  );

  app.post('/v1/auth/disable', async (request, reply) => {
    if (!dependencies.auth) return reply.code(503).send(unavailable());
    const token = requireToken(request, reply);
    if (!token) return;
    try {
      await dependencies.auth.disableAccount(token);
      return reply.code(204).send();
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post('/v1/auth/password-reset/request', async (request, reply) => {
    if (!dependencies.auth) return reply.code(503).send(unavailable());
    const parsed = ResetRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    const token = await dependencies.auth.requestPasswordReset(parsed.data.email);
    if (token && dependencies.email && dependencies.publicSiteUrl) {
      const user = await dependencies.auth.getUserByEmail(parsed.data.email);
      if (user)
        await dependencies.email.sendPasswordReset({
          userId: user.id,
          email: user.email,
          resetUrl: `${dependencies.publicSiteUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`,
        });
    }
    return reply.send({
      accepted: true,
      ...(dependencies.exposeDevelopmentTokens && token ? { resetToken: token } : {}),
    });
  });

  app.post('/v1/auth/password-reset/confirm', async (request, reply) => {
    if (!dependencies.auth) return reply.code(503).send(unavailable());
    const parsed = ResetSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    try {
      await dependencies.auth.resetPassword(parsed.data.token, parsed.data.password);
      return reply.code(204).send();
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post('/v1/auth/google/start', async (request, reply) => {
    if (!dependencies.googleOAuth) return reply.code(503).send({ error: 'google_not_configured' });
    const parsed = GoogleStartSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    return reply.send(
      await dependencies.googleOAuth.begin({
        codeChallenge: parsed.data.codeChallenge,
        device: parsed.data.device as DeviceInput,
      }),
    );
  });

  app.get<{ Querystring: { state?: string; code?: string; error?: string } }>(
    '/v1/auth/google/callback',
    async (request, reply) => {
      if (!dependencies.googleOAuth)
        return reply.code(503).send({ error: 'google_not_configured' });
      if (!request.query.state || !request.query.code || request.query.error)
        return reply.code(400).send({ error: 'google_callback_invalid' });
      try {
        const result = await dependencies.googleOAuth.completeCallback({
          state: request.query.state,
          code: request.query.code,
        });
        if (result.redirectUri) return reply.redirect(result.redirectUri);
        return reply.send({ code: result.desktopCode });
      } catch {
        return reply.code(400).send({ error: 'google_callback_invalid' });
      }
    },
  );

  app.post('/v1/auth/google/exchange', async (request, reply) => {
    if (!dependencies.googleOAuth) return reply.code(503).send({ error: 'google_not_configured' });
    if (!dependencies.auth) return reply.code(503).send(unavailable());
    const parsed = GoogleExchangeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    try {
      const session = await dependencies.googleOAuth.exchangeDesktopCode(parsed.data);
      const freePlan = dependencies.plans?.get('FREE');
      if (dependencies.billing && freePlan) {
        await dependencies.billing.grantCredits({
          userId: session.user.id,
          amountCredits: freePlan.monthlyCredits,
          transactionType: 'SUBSCRIPTION_GRANT',
          idempotencyKey: `signup:${session.user.id}:FREE`,
          reason: 'Initial Free plan entitlement',
          sourceType: 'free_monthly',
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        });
      }
      return reply.send(session);
    } catch {
      return reply.code(400).send({ error: 'google_exchange_invalid' });
    }
  });
}
