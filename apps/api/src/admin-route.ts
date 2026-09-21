import type { AuthError, AuthService } from '@astra/auth';
import {
  AdminService,
  type AdminAnalyticsPort,
  type AdminAuditStore,
  type AdminRole,
} from '@astra/billing';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

const AdjustmentSchema = z.object({
  amountCredits: z.string().regex(/^\d+(?:\.\d{1,7})?$/),
  direction: z.enum(['credit', 'debit']),
  reason: z.string().min(3).max(500),
  requestId: z.string().min(1).max(120),
});

const adminRoles: AdminRole[] = ['ADMIN', 'SUPER_ADMIN', 'FINANCE', 'SUPPORT'];

function bearer(request: FastifyRequest): string | null {
  const value = request.headers.authorization;
  if (value?.startsWith('Bearer ')) return value.slice('Bearer '.length).trim() || null;
  const cookieHeader = request.headers.cookie;
  const access = cookieHeader
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('astra_access='))
    ?.slice('astra_access='.length);
  return access ? decodeURIComponent(access) : null;
}

function sendAuthError(reply: FastifyReply, error: unknown) {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? (error as AuthError).code
      : 'SESSION_INVALID';
  return reply.code(401).send({ error: code });
}

export interface AdminRouteDependencies {
  auth?: AuthService;
  admin?: AdminService;
  audit?: AdminAuditStore;
  analytics?: AdminAnalyticsPort;
}

export async function registerAdminRoutes(
  app: FastifyInstance,
  dependencies: AdminRouteDependencies,
): Promise<void> {
  app.get<{
    Querystring: {
      search?: string;
      planId?: string;
      status?: string;
      limit?: string;
      offset?: string;
    };
  }>('/v1/admin/users', async (request, reply) => {
    if (!dependencies.auth || !dependencies.admin)
      return reply.code(503).send({ error: 'admin_not_configured' });
    const token = bearer(request);
    if (!token) return reply.code(401).send({ error: 'SESSION_INVALID' });
    try {
      const identity = await dependencies.auth.authenticate(token);
      const role = identity.user.role as AdminRole;
      if (!adminRoles.includes(role)) return reply.code(403).send({ error: 'ADMIN_FORBIDDEN' });
      dependencies.admin.assertCan(role, 'read_usage');
      const search = request.query.search?.trim().toLowerCase();
      const planId = request.query.planId?.trim();
      const status = request.query.status?.trim();
      const limit = Math.min(Math.max(Number(request.query.limit ?? 50) || 50, 1), 100);
      const offset = Math.max(Number(request.query.offset ?? 0) || 0, 0);
      const users = (await dependencies.auth.listUsers()).filter(
        (user) =>
          (!search || user.email.toLowerCase().includes(search) || user.id.includes(search)) &&
          (!planId || user.planId === planId) &&
          (!status || user.status === status),
      );
      return reply.send({ users: users.slice(offset, offset + limit), total: users.length });
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.get('/v1/admin/overview', async (request, reply) => {
    if (!dependencies.auth || !dependencies.admin)
      return reply.code(503).send({ error: 'admin_not_configured' });
    const token = bearer(request);
    if (!token) return reply.code(401).send({ error: 'SESSION_INVALID' });
    try {
      const identity = await dependencies.auth.authenticate(token);
      if (!adminRoles.includes(identity.user.role as AdminRole))
        return reply.code(403).send({ error: 'ADMIN_FORBIDDEN' });
      return reply.send(
        dependencies.analytics
          ? await dependencies.analytics.overview()
          : {
              dataStatus: 'NO_LIVE_DATA',
              totalUsers: null,
              verifiedUsers: null,
              activeUsers: null,
              dailyActiveUsers: null,
              monthlyActiveUsers: null,
              paidUsers: null,
              freeUsers: null,
              creditsIssued: null,
              creditsConsumed: null,
              providerCostUsd: null,
              customerCostUsd: null,
              absorbedCostUsd: null,
              revenueUsd: null,
              grossMarginUsd: null,
              grossMarginPercent: null,
              paymentFailures: null,
              billingAnomalies: null,
            },
      );
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.get('/v1/admin/analytics/usage', async (request, reply) => {
    if (!dependencies.auth || !dependencies.admin)
      return reply.code(503).send({ error: 'admin_not_configured' });
    const token = bearer(request);
    if (!token) return reply.code(401).send({ error: 'SESSION_INVALID' });
    try {
      const identity = await dependencies.auth.authenticate(token);
      const role = identity.user.role as AdminRole;
      if (!adminRoles.includes(role)) return reply.code(403).send({ error: 'ADMIN_FORBIDDEN' });
      dependencies.admin.assertCan(role, 'read_usage');
      return reply.send(
        dependencies.analytics
          ? await dependencies.analytics.usage()
          : { dataStatus: 'NO_LIVE_DATA', rows: [] },
      );
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.get('/v1/admin/audit', async (request, reply) => {
    if (!dependencies.auth || !dependencies.admin || !dependencies.audit)
      return reply.code(503).send({ error: 'admin_not_configured' });
    const token = bearer(request);
    if (!token) return reply.code(401).send({ error: 'SESSION_INVALID' });
    try {
      const identity = await dependencies.auth.authenticate(token);
      const role = identity.user.role as AdminRole;
      if (!adminRoles.includes(role)) return reply.code(403).send({ error: 'ADMIN_FORBIDDEN' });
      dependencies.admin.assertCan(role, 'read_usage');
      return reply.send({ entries: await dependencies.audit.list() });
    } catch (error) {
      return sendAuthError(reply, error);
    }
  });

  app.post<{ Params: { userId: string } }>(
    '/v1/admin/wallet/:userId/adjust',
    async (request, reply) => {
      if (!dependencies.auth || !dependencies.admin)
        return reply.code(503).send({ error: 'admin_not_configured' });
      const token = bearer(request);
      if (!token) return reply.code(401).send({ error: 'SESSION_INVALID' });
      const parsed = AdjustmentSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
      try {
        const identity = await dependencies.auth.authenticate(token);
        const role = identity.user.role as AdminRole;
        if (!adminRoles.includes(role)) return reply.code(403).send({ error: 'ADMIN_FORBIDDEN' });
        await dependencies.admin.adjustWallet({
          actor: { userId: identity.user.id, role },
          targetUserId: request.params.userId,
          ...parsed.data,
        });
        return reply.code(204).send();
      } catch (error) {
        if (
          error &&
          typeof error === 'object' &&
          'name' in error &&
          (error as Error).name === 'AdminError'
        )
          return reply.code(403).send({ error: (error as Error).message });
        return sendAuthError(reply, error);
      }
    },
  );
}
