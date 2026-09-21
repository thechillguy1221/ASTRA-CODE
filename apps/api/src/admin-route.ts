import type { AuthError, AuthService } from '@astra/auth';
import {
  ControlPlaneError,
  CommercialPlanPriceSnapshotSchema,
  CommercialPolicyService,
  CapabilityPolicySnapshotSchema,
  ControlPlaneModelSnapshotSchema,
  ControlPlanePlanSnapshotSchema,
  FeatureFlagSnapshotSchema,
  MaintenancePolicySnapshotSchema,
  ModelConsumptionPricingSnapshotSchema,
  MutationMetadataSchema,
  PromotionSnapshotSchema,
  RazorpayMappingSnapshotSchema,
  ReleasePolicySnapshotSchema,
  TopUpPackageSnapshotSchema,
  hasAdminPermission,
  resolveAdminPermissions,
  type ControlPlaneActor,
  type ControlPlaneAdminRole,
  type ControlPlaneService,
  type PlatformPolicyService,
} from '@astra/control-plane';
import {
  AdminService,
  type AdminAnalyticsPort,
  type AdminAuditStore,
  type AdminRole,
} from '@astra/billing';
import type { RemoteAccessPort } from '@astra/remote-protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

const AdjustmentSchema = z.object({
  amountCredits: z.string().regex(/^\d+(?:\.\d{1,7})?$/),
  direction: z.enum(['credit', 'debit']),
  reason: z.string().min(3).max(500),
  requestId: z.string().min(1).max(120),
});

const adminRoles: AdminRole[] = ['ADMIN', 'SUPER_ADMIN', 'FINANCE', 'SUPPORT'];

const PlanMutationSchema = z.object({
  plan: ControlPlanePlanSnapshotSchema,
  metadata: MutationMetadataSchema,
});

const ModelMutationSchema = z.object({
  model: ControlPlaneModelSnapshotSchema,
  metadata: MutationMetadataSchema,
});

const PlanPriceMutationSchema = z
  .object({
    snapshot: CommercialPlanPriceSnapshotSchema,
    metadata: MutationMetadataSchema,
  })
  .strict();

const TopUpMutationSchema = z
  .object({
    snapshot: TopUpPackageSnapshotSchema,
    metadata: MutationMetadataSchema,
  })
  .strict();

const PromotionMutationSchema = z
  .object({
    snapshot: PromotionSnapshotSchema,
    metadata: MutationMetadataSchema,
  })
  .strict();

const ModelPricingMutationSchema = z
  .object({
    snapshot: ModelConsumptionPricingSnapshotSchema,
    metadata: MutationMetadataSchema,
  })
  .strict();

const FeatureFlagMutationSchema = z.object({
  snapshot: FeatureFlagSnapshotSchema,
  metadata: MutationMetadataSchema,
});
const MaintenanceMutationSchema = z.object({
  snapshot: MaintenancePolicySnapshotSchema,
  metadata: MutationMetadataSchema,
});
const CapabilityMutationSchema = z.object({
  snapshot: CapabilityPolicySnapshotSchema,
  metadata: MutationMetadataSchema,
});
const ReleaseMutationSchema = z.object({
  snapshot: ReleasePolicySnapshotSchema,
  metadata: MutationMetadataSchema,
});
const RazorpayMappingMutationSchema = z.object({
  snapshot: RazorpayMappingSnapshotSchema,
  metadata: MutationMetadataSchema,
});
const UserStatusMutationSchema = z.object({
  status: z.enum(['ACTIVE', 'DISABLED']),
  metadata: MutationMetadataSchema,
});
const UserPlanMutationSchema = z.object({
  planId: z.string().min(1),
  metadata: MutationMetadataSchema,
});
const AdminReasonSchema = z.object({ metadata: MutationMetadataSchema });
const OrganizationStatusMutationSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'CLOSED']),
  metadata: MutationMetadataSchema,
});
const RoomStatusMutationSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'CLOSED']),
  metadata: MutationMetadataSchema,
});

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
  controlPlane?: ControlPlaneService;
  commercial?: CommercialPolicyService;
  policy?: PlatformPolicyService;
  remote?: RemoteAccessPort;
}

function sendControlPlaneError(reply: FastifyReply, error: unknown) {
  if (error instanceof ControlPlaneError) {
    const status =
      error.code === 'CONTROL_PLANE_FORBIDDEN'
        ? 403
        : error.code === 'CONTROL_PLANE_POLICY_DENIED'
          ? 403
          : error.code === 'CONTROL_PLANE_VERSION_CONFLICT'
            ? 409
            : error.code === 'CONTROL_PLANE_UNAVAILABLE'
              ? 503
              : error.code === 'CONTROL_PLANE_NOT_FOUND'
                ? 404
                : 400;
    return reply.code(status).send({ error: error.code });
  }
  return reply.code(503).send({ error: 'CONTROL_PLANE_UNAVAILABLE' });
}

function sendRemoteError(reply: FastifyReply, error: unknown) {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : 'REMOTE_DATA_UNAVAILABLE';
  const status = code === 'PERMISSION_DENIED' ? 403 : code.endsWith('_NOT_FOUND') ? 404 : 400;
  return reply.code(status).send({ error: code });
}

async function requireControlPlaneActor(
  request: FastifyRequest,
  reply: FastifyReply,
  dependencies: AdminRouteDependencies,
  permission?: Parameters<typeof hasAdminPermission>[1],
): Promise<{
  identity: Awaited<ReturnType<AuthService['authenticate']>>;
  actor: ControlPlaneActor;
  context: { sessionId: string; deviceId: string; ipAddress: string; userAgent: string | null };
} | null> {
  if (
    !dependencies.auth ||
    (!dependencies.controlPlane && !dependencies.commercial && !dependencies.policy)
  ) {
    reply.code(503).send({ error: 'CONTROL_PLANE_UNAVAILABLE' });
    return null;
  }
  const token = bearer(request);
  if (!token) {
    reply.code(401).send({ error: 'SESSION_INVALID' });
    return null;
  }
  try {
    const identity = await dependencies.auth.authenticate(token);
    const role = identity.user.role as ControlPlaneAdminRole;
    const permissions = resolveAdminPermissions(role);
    if (permission && !hasAdminPermission(permissions, permission)) {
      reply.code(403).send({ error: 'CONTROL_PLANE_FORBIDDEN' });
      return null;
    }
    return {
      identity,
      actor: { userId: identity.user.id, role, permissions },
      context: {
        sessionId: identity.session.sessionId,
        deviceId: identity.device.deviceSessionId,
        ipAddress: request.ip,
        userAgent:
          typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
      },
    };
  } catch (error) {
    sendAuthError(reply, error);
    return null;
  }
}

function integerQuery(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

async function appendAdminMutationAudit(
  dependencies: AdminRouteDependencies,
  access: NonNullable<Awaited<ReturnType<typeof requireControlPlaneActor>>>,
  permission: Parameters<typeof hasAdminPermission>[1],
  input: {
    action: string;
    targetType: string;
    targetId: string;
    before?: unknown;
    after?: unknown;
    metadata: z.infer<typeof MutationMetadataSchema>;
  },
): Promise<void> {
  await dependencies.controlPlane?.appendAudit({
    permission,
    actor: access.actor,
    context: access.context,
    ...input,
  });
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
    if (dependencies.controlPlane) {
      const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.users');
      if (!access) return;
      try {
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
        return sendControlPlaneError(reply, error);
      }
    }
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
    if (dependencies.controlPlane) {
      const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.system');
      if (!access) return;
      try {
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
        return sendControlPlaneError(reply, error);
      }
    }
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

  app.get('/v1/admin/health', async (request, reply) => {
    const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.system');
    if (!access) return;
    return reply.send({
      dataStatus: 'CONFIGURED',
      controlPlane: dependencies.controlPlane ? 'CONFIGURED' : 'UNAVAILABLE',
      commercial: dependencies.commercial ? 'CONFIGURED' : 'UNAVAILABLE',
      policy: dependencies.policy ? 'CONFIGURED' : 'UNAVAILABLE',
      remote: dependencies.remote ? 'CONFIGURED' : 'UNAVAILABLE',
      analytics: dependencies.analytics ? 'CONFIGURED' : 'NO_LIVE_DATA',
    });
  });

  app.get('/v1/admin/analytics/usage', async (request, reply) => {
    if (!dependencies.auth || !dependencies.admin)
      return reply.code(503).send({ error: 'admin_not_configured' });
    if (dependencies.controlPlane) {
      const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.system');
      if (!access) return;
      try {
        return reply.send(
          dependencies.analytics
            ? await dependencies.analytics.usage()
            : { dataStatus: 'NO_LIVE_DATA', rows: [] },
        );
      } catch (error) {
        return sendControlPlaneError(reply, error);
      }
    }
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
    if (dependencies.controlPlane) {
      const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.security');
      if (!access) return;
      try {
        return reply.send({ entries: await dependencies.controlPlane.listAudit() });
      } catch (error) {
        return sendControlPlaneError(reply, error);
      }
    }
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
      if (dependencies.controlPlane) {
        const access = await requireControlPlaneActor(
          request,
          reply,
          dependencies,
          'admin.billing',
        );
        if (!access) return;
        const parsedControlPlane = AdjustmentSchema.safeParse(request.body);
        if (!parsedControlPlane.success) return reply.code(400).send({ error: 'invalid_request' });
        try {
          await dependencies.admin.adjustWallet({
            actor: { userId: access.actor.userId, role: access.actor.role as AdminRole },
            targetUserId: request.params.userId,
            ...parsedControlPlane.data,
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
          return sendControlPlaneError(reply, error);
        }
      }
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

  app.get('/v1/entitlements/me', async (request, reply) => {
    const access = await requireControlPlaneActor(request, reply, dependencies);
    if (!access) return;
    try {
      const plan = await dependencies.controlPlane!.getPlan(
        (await dependencies.auth!.authenticate(bearer(request)!)).user.planId,
      );
      if (!plan) return reply.code(503).send({ error: 'CONTROL_PLANE_UNAVAILABLE' });
      return reply.send({
        planId: plan.id,
        version: plan.version,
        entitlements: plan.entitlements,
        limits: plan.limits,
      });
    } catch (error) {
      return sendControlPlaneError(reply, error);
    }
  });

  app.get<{ Params: { organizationId: string } }>(
    '/v1/organizations/:organizationId/entitlements',
    async (request, reply) => {
      const access = await requireControlPlaneActor(request, reply, dependencies);
      if (!access) return;
      if (!dependencies.remote || !dependencies.controlPlane)
        return reply.code(503).send({ error: 'CONTROL_PLANE_UNAVAILABLE' });
      try {
        const organization = await dependencies.remote.getOrganization(
          request.params.organizationId,
        );
        if (
          organization.ownerUserId !== access.identity.user.id &&
          !hasAdminPermission(access.actor.permissions, 'admin.organizations')
        )
          return reply.code(403).send({ error: 'CONTROL_PLANE_FORBIDDEN' });
        const plan = await dependencies.controlPlane.getPlan(organization.planId);
        if (!plan) return reply.code(503).send({ error: 'CONTROL_PLANE_UNAVAILABLE' });
        return reply.send({
          organizationId: organization.id,
          planId: plan.id,
          planVersion: plan.version,
          status: organization.status,
          entitlements: plan.entitlements,
          limits: plan.limits,
        });
      } catch (error) {
        return sendControlPlaneError(reply, error);
      }
    },
  );

  app.get('/v1/admin/organizations', async (request, reply) => {
    const access = await requireControlPlaneActor(
      request,
      reply,
      dependencies,
      'admin.organizations',
    );
    if (!access) return;
    if (!dependencies.remote) return reply.code(503).send({ error: 'REMOTE_DATA_UNAVAILABLE' });
    try {
      return reply.send({ organizations: await dependencies.remote.listOrganizations() });
    } catch (error) {
      return sendControlPlaneError(reply, error);
    }
  });

  app.get('/v1/admin/rooms', async (request, reply) => {
    const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.rooms');
    if (!access) return;
    if (!dependencies.remote) return reply.code(503).send({ error: 'REMOTE_DATA_UNAVAILABLE' });
    try {
      return reply.send({ rooms: await dependencies.remote.listAllRooms() });
    } catch (error) {
      return sendControlPlaneError(reply, error);
    }
  });

  app.get('/v1/admin/devices', async (request, reply) => {
    const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.system');
    if (!access) return;
    if (!dependencies.remote) return reply.code(503).send({ error: 'REMOTE_DATA_UNAVAILABLE' });
    try {
      return reply.send({ devices: await dependencies.remote.listAllDevices() });
    } catch (error) {
      return sendControlPlaneError(reply, error);
    }
  });

  app.put<{ Params: { userId: string } }>(
    '/v1/admin/users/:userId/status',
    async (request, reply) => {
      const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.users');
      if (!access || !dependencies.auth) return;
      const parsed = UserStatusMutationSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'CONTROL_PLANE_INVALID' });
      try {
        const before = await dependencies.auth.getUserById(request.params.userId);
        if (!before) return reply.code(404).send({ error: 'USER_NOT_FOUND' });
        const user = await dependencies.auth.adminSetStatus(
          request.params.userId,
          parsed.data.status,
        );
        await appendAdminMutationAudit(dependencies, access, 'admin.users', {
          action: 'USER_STATUS_UPDATED',
          targetType: 'user',
          targetId: request.params.userId,
          before,
          after: user,
          metadata: parsed.data.metadata,
        });
        return reply.send({ user });
      } catch (error) {
        return error instanceof ControlPlaneError
          ? sendControlPlaneError(reply, error)
          : sendAuthError(reply, error);
      }
    },
  );

  app.put<{ Params: { userId: string } }>(
    '/v1/admin/users/:userId/plan',
    async (request, reply) => {
      const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.plans');
      if (!access || !dependencies.auth) return;
      const parsed = UserPlanMutationSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'CONTROL_PLANE_INVALID' });
      try {
        const before = await dependencies.auth.getUserById(request.params.userId);
        if (!before) return reply.code(404).send({ error: 'USER_NOT_FOUND' });
        const user = await dependencies.auth.assignPlan(request.params.userId, parsed.data.planId);
        await appendAdminMutationAudit(dependencies, access, 'admin.plans', {
          action: 'USER_PLAN_UPDATED',
          targetType: 'user',
          targetId: request.params.userId,
          before,
          after: user,
          metadata: parsed.data.metadata,
        });
        return reply.send({ user });
      } catch (error) {
        return error instanceof ControlPlaneError
          ? sendControlPlaneError(reply, error)
          : sendAuthError(reply, error);
      }
    },
  );

  app.post<{ Params: { userId: string } }>(
    '/v1/admin/users/:userId/sessions/revoke',
    async (request, reply) => {
      const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.security');
      if (!access || !dependencies.auth) return;
      const parsed = AdminReasonSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'CONTROL_PLANE_INVALID' });
      try {
        await dependencies.auth.adminRevokeAllSessions(request.params.userId);
        await appendAdminMutationAudit(dependencies, access, 'admin.security', {
          action: 'USER_SESSIONS_REVOKED',
          targetType: 'user',
          targetId: request.params.userId,
          metadata: parsed.data.metadata,
        });
        return reply.code(204).send();
      } catch (error) {
        return error instanceof ControlPlaneError
          ? sendControlPlaneError(reply, error)
          : sendAuthError(reply, error);
      }
    },
  );

  app.post<{ Params: { userId: string; deviceSessionId: string } }>(
    '/v1/admin/users/:userId/devices/:deviceSessionId/revoke',
    async (request, reply) => {
      const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.security');
      if (!access || !dependencies.auth) return;
      const parsed = AdminReasonSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'CONTROL_PLANE_INVALID' });
      try {
        await dependencies.auth.adminRevokeDevice(
          request.params.userId,
          request.params.deviceSessionId,
        );
        if (dependencies.remote)
          await dependencies.remote.adminRevokeDevice(
            request.params.deviceSessionId,
            parsed.data.metadata.reason,
          );
        await appendAdminMutationAudit(dependencies, access, 'admin.security', {
          action: 'DEVICE_REVOKED',
          targetType: 'device',
          targetId: request.params.deviceSessionId,
          metadata: parsed.data.metadata,
        });
        return reply.code(204).send();
      } catch (error) {
        return error instanceof ControlPlaneError
          ? sendControlPlaneError(reply, error)
          : sendAuthError(reply, error);
      }
    },
  );

  app.put<{ Params: { organizationId: string } }>(
    '/v1/admin/organizations/:organizationId/status',
    async (request, reply) => {
      const access = await requireControlPlaneActor(
        request,
        reply,
        dependencies,
        'admin.organizations',
      );
      if (!access || !dependencies.remote)
        return reply.code(503).send({ error: 'REMOTE_DATA_UNAVAILABLE' });
      const parsed = OrganizationStatusMutationSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'CONTROL_PLANE_INVALID' });
      try {
        const before = await dependencies.remote.getOrganization(request.params.organizationId);
        const organization = await dependencies.remote.adminSetOrganizationStatus({
          organizationId: request.params.organizationId,
          status: parsed.data.status,
          reason: parsed.data.metadata.reason,
        });
        await appendAdminMutationAudit(dependencies, access, 'admin.organizations', {
          action: 'ORGANIZATION_STATUS_UPDATED',
          targetType: 'organization',
          targetId: request.params.organizationId,
          before,
          after: organization,
          metadata: parsed.data.metadata,
        });
        return reply.send({ organization });
      } catch (error) {
        return error instanceof ControlPlaneError
          ? sendControlPlaneError(reply, error)
          : sendRemoteError(reply, error);
      }
    },
  );

  app.put<{ Params: { roomId: string } }>(
    '/v1/admin/rooms/:roomId/status',
    async (request, reply) => {
      const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.rooms');
      if (!access || !dependencies.remote)
        return reply.code(503).send({ error: 'REMOTE_DATA_UNAVAILABLE' });
      const parsed = RoomStatusMutationSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'CONTROL_PLANE_INVALID' });
      try {
        const before = await dependencies.remote.getRoom(request.params.roomId);
        const room = await dependencies.remote.adminSetRoomStatus({
          roomId: request.params.roomId,
          status: parsed.data.status,
          reason: parsed.data.metadata.reason,
        });
        await appendAdminMutationAudit(dependencies, access, 'admin.rooms', {
          action: 'ROOM_STATUS_UPDATED',
          targetType: 'room',
          targetId: request.params.roomId,
          before,
          after: room,
          metadata: parsed.data.metadata,
        });
        return reply.send({ room });
      } catch (error) {
        return error instanceof ControlPlaneError
          ? sendControlPlaneError(reply, error)
          : sendRemoteError(reply, error);
      }
    },
  );

  app.post<{ Params: { deviceId: string } }>(
    '/v1/admin/devices/:deviceId/revoke',
    async (request, reply) => {
      const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.security');
      if (!access || !dependencies.remote)
        return reply.code(503).send({ error: 'REMOTE_DATA_UNAVAILABLE' });
      const parsed = AdminReasonSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'CONTROL_PLANE_INVALID' });
      try {
        await dependencies.remote.adminRevokeDevice(
          request.params.deviceId,
          parsed.data.metadata.reason,
        );
        await appendAdminMutationAudit(dependencies, access, 'admin.security', {
          action: 'REMOTE_DEVICE_REVOKED',
          targetType: 'remote_device',
          targetId: request.params.deviceId,
          metadata: parsed.data.metadata,
        });
        return reply.code(204).send();
      } catch (error) {
        return error instanceof ControlPlaneError
          ? sendControlPlaneError(reply, error)
          : sendRemoteError(reply, error);
      }
    },
  );

  app.get('/v1/admin/control-plane/plans', async (request, reply) => {
    const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.plans');
    if (!access) return;
    try {
      return reply.send({ plans: await dependencies.controlPlane!.listPlans() });
    } catch (error) {
      return sendControlPlaneError(reply, error);
    }
  });

  app.post('/v1/admin/control-plane/plans', async (request, reply) => {
    const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.plans');
    if (!access) return;
    const parsed = PlanMutationSchema.safeParse(request.body);
    if (
      !parsed.success ||
      parsed.data.metadata.expectedVersion !== 0 ||
      parsed.data.plan.version !== 1
    )
      return reply.code(400).send({ error: 'CONTROL_PLANE_INVALID' });
    try {
      if (await dependencies.controlPlane!.getPlan(parsed.data.plan.id))
        return reply.code(409).send({ error: 'CONTROL_PLANE_VERSION_CONFLICT' });
      const plan = await dependencies.controlPlane!.updatePlan({
        ...parsed.data,
        actor: access.actor,
        context: access.context,
      });
      return reply.code(201).send({ plan });
    } catch (error) {
      return sendControlPlaneError(reply, error);
    }
  });

  app.get<{ Params: { planId: string } }>(
    '/v1/admin/control-plane/plans/:planId',
    async (request, reply) => {
      const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.plans');
      if (!access) return;
      try {
        const plan = await dependencies.controlPlane!.getPlan(request.params.planId);
        if (!plan) return reply.code(404).send({ error: 'CONTROL_PLANE_NOT_FOUND' });
        return reply.send({ plan });
      } catch (error) {
        return sendControlPlaneError(reply, error);
      }
    },
  );

  app.put<{ Params: { planId: string } }>(
    '/v1/admin/control-plane/plans/:planId',
    async (request, reply) => {
      const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.plans');
      if (!access) return;
      const parsed = PlanMutationSchema.safeParse(request.body);
      if (!parsed.success || parsed.data.plan.id !== request.params.planId)
        return reply.code(400).send({ error: 'CONTROL_PLANE_INVALID' });
      try {
        if (!(await dependencies.controlPlane!.getPlan(request.params.planId)))
          return reply.code(404).send({ error: 'CONTROL_PLANE_NOT_FOUND' });
        const plan = await dependencies.controlPlane!.updatePlan({
          ...parsed.data,
          actor: access.actor,
          context: access.context,
        });
        return reply.send({ plan });
      } catch (error) {
        return sendControlPlaneError(reply, error);
      }
    },
  );

  app.get<{ Params: { planId: string } }>(
    '/v1/admin/control-plane/plans/:planId/versions',
    async (request, reply) => {
      const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.plans');
      if (!access) return;
      try {
        if (!(await dependencies.controlPlane!.getPlan(request.params.planId)))
          return reply.code(404).send({ error: 'CONTROL_PLANE_NOT_FOUND' });
        return reply.send({
          versions: await dependencies.controlPlane!.listPlanVersions(request.params.planId),
        });
      } catch (error) {
        return sendControlPlaneError(reply, error);
      }
    },
  );

  app.get('/v1/admin/control-plane/models', async (request, reply) => {
    const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.models');
    if (!access) return;
    try {
      return reply.send({ models: await dependencies.controlPlane!.listModels() });
    } catch (error) {
      return sendControlPlaneError(reply, error);
    }
  });

  app.post('/v1/admin/control-plane/models', async (request, reply) => {
    const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.models');
    if (!access) return;
    const parsed = ModelMutationSchema.safeParse(request.body);
    if (
      !parsed.success ||
      parsed.data.metadata.expectedVersion !== 0 ||
      parsed.data.model.version !== 1
    )
      return reply.code(400).send({ error: 'CONTROL_PLANE_INVALID' });
    try {
      if (await dependencies.controlPlane!.getModel(parsed.data.model.modelId))
        return reply.code(409).send({ error: 'CONTROL_PLANE_VERSION_CONFLICT' });
      const model = await dependencies.controlPlane!.updateModel({
        ...parsed.data,
        actor: access.actor,
        context: access.context,
      });
      return reply.code(201).send({ model });
    } catch (error) {
      return sendControlPlaneError(reply, error);
    }
  });

  app.get<{ Params: { modelId: string } }>(
    '/v1/admin/control-plane/models/:modelId',
    async (request, reply) => {
      const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.models');
      if (!access) return;
      try {
        const model = await dependencies.controlPlane!.getModel(request.params.modelId);
        if (!model) return reply.code(404).send({ error: 'CONTROL_PLANE_NOT_FOUND' });
        return reply.send({ model });
      } catch (error) {
        return sendControlPlaneError(reply, error);
      }
    },
  );

  app.put<{ Params: { modelId: string } }>(
    '/v1/admin/control-plane/models/:modelId',
    async (request, reply) => {
      const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.models');
      if (!access) return;
      const parsed = ModelMutationSchema.safeParse(request.body);
      if (!parsed.success || parsed.data.model.modelId !== request.params.modelId)
        return reply.code(400).send({ error: 'CONTROL_PLANE_INVALID' });
      try {
        if (!(await dependencies.controlPlane!.getModel(request.params.modelId)))
          return reply.code(404).send({ error: 'CONTROL_PLANE_NOT_FOUND' });
        const model = await dependencies.controlPlane!.updateModel({
          ...parsed.data,
          actor: access.actor,
          context: access.context,
        });
        return reply.send({ model });
      } catch (error) {
        return sendControlPlaneError(reply, error);
      }
    },
  );

  app.get('/v1/admin/control-plane/audit', async (request, reply) => {
    const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.security');
    if (!access) return;
    const query = request.query as { limit?: string; offset?: string };
    try {
      return reply.send({
        entries: await dependencies.controlPlane!.listAudit({
          limit: integerQuery(query.limit, 100),
          offset: integerQuery(query.offset, 0),
        }),
      });
    } catch (error) {
      return sendControlPlaneError(reply, error);
    }
  });

  app.get<{ Params: { planId: string; region: string } }>(
    '/v1/admin/commercial/plan-prices/:planId/:region',
    async (request, reply) => {
      const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.plans');
      if (!access || !dependencies.commercial) return;
      if (request.params.region !== 'INDIA' && request.params.region !== 'GLOBAL')
        return reply.code(400).send({ error: 'CONTROL_PLANE_INVALID' });
      try {
        return reply.send({
          versions: await dependencies.commercial.listPlanPriceVersions(
            request.params.planId,
            request.params.region,
          ),
        });
      } catch (error) {
        return sendControlPlaneError(reply, error);
      }
    },
  );

  app.put<{ Params: { planId: string; region: string } }>(
    '/v1/admin/commercial/plan-prices/:planId/:region',
    async (request, reply) => {
      const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.plans');
      if (!access || !dependencies.commercial) return;
      const parsed = PlanPriceMutationSchema.safeParse(request.body);
      if (
        !parsed.success ||
        parsed.data.snapshot.planId !== request.params.planId ||
        parsed.data.snapshot.region !== request.params.region
      )
        return reply.code(400).send({ error: 'CONTROL_PLANE_INVALID' });
      try {
        const snapshot = await dependencies.commercial.updatePlanPrice({
          ...parsed.data,
          actor: access.actor,
          context: access.context,
        });
        return reply.send({ snapshot });
      } catch (error) {
        return sendControlPlaneError(reply, error);
      }
    },
  );

  app.get('/v1/admin/commercial/top-ups', async (request, reply) => {
    const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.billing');
    if (!access || !dependencies.commercial) return;
    try {
      return reply.send({ packages: await dependencies.commercial.listTopUpPackages() });
    } catch (error) {
      return sendControlPlaneError(reply, error);
    }
  });

  app.put<{ Params: { packageId: string } }>(
    '/v1/admin/commercial/top-ups/:packageId',
    async (request, reply) => {
      const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.billing');
      if (!access || !dependencies.commercial) return;
      const parsed = TopUpMutationSchema.safeParse(request.body);
      if (!parsed.success || parsed.data.snapshot.packageId !== request.params.packageId)
        return reply.code(400).send({ error: 'CONTROL_PLANE_INVALID' });
      try {
        const snapshot = await dependencies.commercial.updateTopUpPackage({
          ...parsed.data,
          actor: access.actor,
          context: access.context,
        });
        return reply.send({ snapshot });
      } catch (error) {
        return sendControlPlaneError(reply, error);
      }
    },
  );

  app.post('/v1/admin/commercial/promotions', async (request, reply) => {
    const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.billing');
    if (!access || !dependencies.commercial) return;
    const parsed = PromotionMutationSchema.safeParse(request.body);
    if (
      !parsed.success ||
      parsed.data.snapshot.version !== 1 ||
      parsed.data.metadata.expectedVersion !== 0
    )
      return reply.code(400).send({ error: 'CONTROL_PLANE_INVALID' });
    try {
      const snapshot = await dependencies.commercial.createPromotion({
        ...parsed.data,
        actor: access.actor,
        context: access.context,
      });
      return reply.code(201).send({ snapshot });
    } catch (error) {
      return sendControlPlaneError(reply, error);
    }
  });

  app.put<{ Params: { promotionId: string } }>(
    '/v1/admin/commercial/promotions/:promotionId',
    async (request, reply) => {
      const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.billing');
      if (!access || !dependencies.commercial) return;
      const parsed = PromotionMutationSchema.safeParse(request.body);
      if (!parsed.success || parsed.data.snapshot.promotionId !== request.params.promotionId)
        return reply.code(400).send({ error: 'CONTROL_PLANE_INVALID' });
      try {
        const snapshot = await dependencies.commercial.createPromotion({
          ...parsed.data,
          actor: access.actor,
          context: access.context,
        });
        return reply.send({ snapshot });
      } catch (error) {
        return sendControlPlaneError(reply, error);
      }
    },
  );

  app.put<{ Params: { modelId: string; region: string } }>(
    '/v1/admin/commercial/model-pricing/:modelId/:region',
    async (request, reply) => {
      const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.models');
      if (!access || !dependencies.commercial) return;
      const parsed = ModelPricingMutationSchema.safeParse(request.body);
      if (
        !parsed.success ||
        parsed.data.snapshot.modelId !== request.params.modelId ||
        parsed.data.snapshot.region !== request.params.region
      )
        return reply.code(400).send({ error: 'CONTROL_PLANE_INVALID' });
      try {
        const snapshot = await dependencies.commercial.updateModelPricing({
          ...parsed.data,
          actor: access.actor,
          context: access.context,
        });
        return reply.send({ snapshot });
      } catch (error) {
        return sendControlPlaneError(reply, error);
      }
    },
  );

  app.get('/v1/admin/policies/feature-flags', async (request, reply) => {
    const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.features');
    if (!access || !dependencies.policy) return;
    try {
      return reply.send({ flags: await dependencies.policy.listFeatureFlags() });
    } catch (error) {
      return sendControlPlaneError(reply, error);
    }
  });

  app.get<{ Params: { flagId: string } }>(
    '/v1/admin/policies/feature-flags/:flagId/versions',
    async (request, reply) => {
      const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.features');
      if (!access || !dependencies.policy) return;
      try {
        return reply.send({
          versions: await dependencies.policy.listFeatureFlagVersions(request.params.flagId),
        });
      } catch (error) {
        return sendControlPlaneError(reply, error);
      }
    },
  );

  app.get('/v1/admin/policies/maintenance', async (request, reply) => {
    const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.system');
    if (!access || !dependencies.policy) return;
    try {
      return reply.send({ policies: await dependencies.policy.listMaintenancePolicies() });
    } catch (error) {
      return sendControlPlaneError(reply, error);
    }
  });

  app.get('/v1/admin/policies/capabilities', async (request, reply) => {
    const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.features');
    if (!access || !dependencies.policy) return;
    try {
      return reply.send({ policies: await dependencies.policy.listCapabilityPolicies() });
    } catch (error) {
      return sendControlPlaneError(reply, error);
    }
  });

  app.get('/v1/admin/policies/releases', async (request, reply) => {
    const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.releases');
    if (!access || !dependencies.policy) return;
    try {
      return reply.send({ policies: await dependencies.policy.listReleasePolicies() });
    } catch (error) {
      return sendControlPlaneError(reply, error);
    }
  });

  app.get('/v1/admin/commercial/razorpay-mappings', async (request, reply) => {
    const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.billing');
    if (!access || !dependencies.policy) return;
    try {
      return reply.send({ mappings: await dependencies.policy.listRazorpayMappings() });
    } catch (error) {
      return sendControlPlaneError(reply, error);
    }
  });

  app.get('/v1/admin/policies/audit', async (request, reply) => {
    const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.security');
    if (!access || !dependencies.policy) return;
    const query = request.query as { limit?: string; offset?: string };
    try {
      return reply.send({
        entries: await dependencies.policy.listAudit({
          limit: integerQuery(query.limit, 100),
          offset: integerQuery(query.offset, 0),
        }),
      });
    } catch (error) {
      return sendControlPlaneError(reply, error);
    }
  });

  app.put<{ Params: { flagId: string } }>(
    '/v1/admin/policies/feature-flags/:flagId',
    async (request, reply) => {
      const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.features');
      if (!access || !dependencies.policy) return;
      const parsed = FeatureFlagMutationSchema.safeParse(request.body);
      if (!parsed.success || parsed.data.snapshot.flagId !== request.params.flagId)
        return reply.code(400).send({ error: 'CONTROL_PLANE_INVALID' });
      try {
        return reply.send({
          snapshot: await dependencies.policy.updateFeatureFlag({
            ...parsed.data,
            actor: access.actor,
            context: access.context,
          }),
        });
      } catch (error) {
        return sendControlPlaneError(reply, error);
      }
    },
  );

  app.put<{ Params: { key: string } }>(
    '/v1/admin/policies/maintenance/:key',
    async (request, reply) => {
      const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.system');
      if (!access || !dependencies.policy) return;
      const parsed = MaintenanceMutationSchema.safeParse(request.body);
      if (!parsed.success || parsed.data.snapshot.key !== request.params.key)
        return reply.code(400).send({ error: 'CONTROL_PLANE_INVALID' });
      try {
        return reply.send({
          snapshot: await dependencies.policy.updateMaintenancePolicy({
            ...parsed.data,
            actor: access.actor,
            context: access.context,
          }),
        });
      } catch (error) {
        return sendControlPlaneError(reply, error);
      }
    },
  );

  app.put<{ Params: { key: string } }>(
    '/v1/admin/policies/capabilities/:key',
    async (request, reply) => {
      const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.features');
      if (!access || !dependencies.policy) return;
      const parsed = CapabilityMutationSchema.safeParse(request.body);
      if (!parsed.success || parsed.data.snapshot.key !== request.params.key)
        return reply.code(400).send({ error: 'CONTROL_PLANE_INVALID' });
      try {
        return reply.send({
          snapshot: await dependencies.policy.updateCapabilityPolicy({
            ...parsed.data,
            actor: access.actor,
            context: access.context,
          }),
        });
      } catch (error) {
        return sendControlPlaneError(reply, error);
      }
    },
  );

  app.put<{ Params: { channel: string } }>(
    '/v1/admin/policies/releases/:channel',
    async (request, reply) => {
      const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.releases');
      if (!access || !dependencies.policy) return;
      const parsed = ReleaseMutationSchema.safeParse(request.body);
      if (!parsed.success || parsed.data.snapshot.channel !== request.params.channel)
        return reply.code(400).send({ error: 'CONTROL_PLANE_INVALID' });
      try {
        return reply.send({
          snapshot: await dependencies.policy.updateReleasePolicy({
            ...parsed.data,
            actor: access.actor,
            context: access.context,
          }),
        });
      } catch (error) {
        return sendControlPlaneError(reply, error);
      }
    },
  );

  app.put<{ Params: { mappingId: string } }>(
    '/v1/admin/commercial/razorpay-mappings/:mappingId',
    async (request, reply) => {
      const access = await requireControlPlaneActor(request, reply, dependencies, 'admin.billing');
      if (!access || !dependencies.policy) return;
      const parsed = RazorpayMappingMutationSchema.safeParse(request.body);
      if (!parsed.success || parsed.data.snapshot.mappingId !== request.params.mappingId)
        return reply.code(400).send({ error: 'CONTROL_PLANE_INVALID' });
      try {
        return reply.send({
          snapshot: await dependencies.policy.updateRazorpayMapping({
            ...parsed.data,
            actor: access.actor,
            context: access.context,
          }),
        });
      } catch (error) {
        return sendControlPlaneError(reply, error);
      }
    },
  );

  app.get<{ Params: { flagId: string } }>('/v1/config/features/:flagId', async (request, reply) => {
    if (!dependencies.policy || !dependencies.auth)
      return reply.code(503).send({ error: 'CONTROL_PLANE_UNAVAILABLE' });
    const token = bearer(request);
    if (!token) return reply.code(401).send({ error: 'SESSION_INVALID' });
    try {
      const identity = await dependencies.auth.authenticate(token);
      const enabled = await dependencies.policy.evaluateFeatureFlag(request.params.flagId, {
        userId: identity.user.id,
        planId: identity.user.planId,
        internal: identity.user.role === 'SUPER_ADMIN',
      });
      return reply.send({ flagId: request.params.flagId, enabled });
    } catch (error) {
      if (error instanceof ControlPlaneError) return sendControlPlaneError(reply, error);
      return sendAuthError(reply, error);
    }
  });
}
