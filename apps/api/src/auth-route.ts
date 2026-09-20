import type { AuthError, AuthService, DeviceInput } from '@lyntar/auth';
import type { BillingService } from '@lyntar/billing';
import type { PlanCatalog } from '@lyntar/plans';
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
const RefreshSchema = z.object({ refreshToken: z.string().length(64) });
const ResetRequestSchema = z.object({ email: z.string().email() });
const ResetSchema = z.object({ token: z.string().length(64), password: z.string().min(12) });

function bearer(request: FastifyRequest): string | null {
  const value = request.headers.authorization;
  if (!value?.startsWith('Bearer ')) return null;
  return value.slice('Bearer '.length).trim() || null;
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
            : 400;
  return reply.code(status).send({ error: code });
}

function requireToken(request: FastifyRequest, reply: FastifyReply): string | null {
  const token = bearer(request);
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
        });
      }
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

  app.post('/v1/auth/login', async (request, reply) => {
    if (!dependencies.auth) return reply.code(503).send(unavailable());
    const parsed = LoginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    try {
      return reply.send(await dependencies.auth.login(parsed.data));
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post('/v1/auth/refresh', async (request, reply) => {
    if (!dependencies.auth) return reply.code(503).send(unavailable());
    const parsed = RefreshSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    try {
      return reply.send(await dependencies.auth.refresh(parsed.data.refreshToken));
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
}
