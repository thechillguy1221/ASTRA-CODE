import type { AuthService } from '@astra/auth';
import {
  WebResearchError,
  type WebFetchRequest,
  type WebResearchContext,
  type WebResearchService,
  type WebSearchRequest,
} from '@astra/web-research';
import { RemoteAccessError, type RemoteAccessPort } from '@astra/remote-protocol';
import { ControlPlaneError, type PlatformPolicyService } from '@astra/control-plane';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

const SearchRequestSchema = z.object({
  taskId: z.string().trim().min(1).max(200),
  query: z.string().trim().min(1).max(500),
  maxResults: z.number().int().min(1).max(50).optional(),
  recency: z.string().trim().min(1).max(40).optional(),
  domains: z.array(z.string().trim().min(1).max(255)).max(20).optional(),
  excludeDomains: z.array(z.string().trim().min(1).max(255)).max(20).optional(),
  safeSearch: z.boolean().optional(),
  roomId: z.string().trim().min(1).max(200).optional(),
});

const FetchRequestSchema = z.object({
  taskId: z.string().trim().min(1).max(200),
  url: z.string().trim().min(1).max(4_000),
  purpose: z.string().trim().max(500).optional(),
  maxBytes: z.number().int().min(1).max(2_000_000).optional(),
  roomId: z.string().trim().min(1).max(200).optional(),
});

export interface WebResearchRouteDependencies {
  auth: AuthService;
  remote: RemoteAccessPort;
  webResearch: WebResearchService;
  policy?: PlatformPolicyService;
}

function tokenFrom(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7).trim() || null;
  const cookie = request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('astra_access='));
  return cookie ? decodeURIComponent(cookie.slice('astra_access='.length)) : null;
}

async function requireUser(
  dependencies: WebResearchRouteDependencies,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const token = tokenFrom(request);
  if (!token) {
    await reply.code(401).send({ error: 'SESSION_INVALID' });
    return null;
  }
  try {
    return await dependencies.auth.authenticate(token);
  } catch {
    await reply.code(401).send({ error: 'SESSION_INVALID' });
    return null;
  }
}

async function resolveContext(
  dependencies: WebResearchRouteDependencies,
  actorUserId: string,
  roomId: string | undefined,
  permission: 'web.search' | 'web.fetch',
): Promise<WebResearchContext> {
  if (!roomId)
    return {
      taskId: '',
      actorUserId,
      billingContext: { kind: 'personal', userId: actorUserId },
    };
  const room = await dependencies.remote.getRoom(roomId);
  await dependencies.remote.authorizeRoomAction({
    actorUserId,
    roomId,
    permission,
  });
  const assertAuthorized = async (action: 'search' | 'fetch'): Promise<void> => {
    try {
      await dependencies.remote.authorizeRoomAction({
        actorUserId,
        roomId,
        permission: action === 'search' ? 'web.search' : 'web.fetch',
      });
    } catch (error) {
      if (error instanceof RemoteAccessError)
        throw new WebResearchError('WEB_ACCESS_REVOKED', 'Room web access is no longer authorized');
      throw error;
    }
  };
  return {
    taskId: '',
    actorUserId,
    roomId,
    hostDeviceId: room.hostDeviceId,
    assertAuthorized,
    billingContext: {
      kind: 'organization',
      organizationId: room.organizationId,
      roomId,
      actorUserId,
    },
  };
}

function sendWebResearchError(reply: FastifyReply, error: unknown) {
  if (error instanceof WebResearchError) {
    const status =
      error.code === 'WEB_SEARCH_UNAVAILABLE' || error.code === 'WEB_PROVIDER_FAILED'
        ? 503
        : error.code === 'WEB_BUDGET_EXHAUSTED'
          ? 429
          : error.code === 'BILLING_CONTEXT_MISMATCH'
            ? 409
            : error.code === 'WEB_ACCESS_REVOKED'
              ? 403
              : error.code === 'WEB_CANCELLED'
                ? 499
                : error.code === 'WEB_FETCH_FAILED'
                  ? 502
                  : 400;
    return reply.code(status).send({ error: error.code });
  }
  if (error instanceof RemoteAccessError) {
    const status =
      error.code === 'PERMISSION_DENIED' ||
      error.code === 'MEMBER_SUSPENDED' ||
      error.code === 'MEMBER_REMOVED' ||
      error.code === 'ORGANIZATION_SUSPENDED' ||
      error.code === 'ORGANIZATION_CLOSED'
        ? 403
        : error.code === 'ROOM_NOT_FOUND' || error.code === 'ORGANIZATION_NOT_FOUND'
          ? 404
          : 400;
    return reply.code(status).send({ error: error.code });
  }
  if (error instanceof ControlPlaneError) {
    return reply
      .code(error.code === 'CONTROL_PLANE_UNAVAILABLE' ? 503 : 403)
      .send({ error: error.code });
  }
  return reply.code(500).send({ error: 'web_research_failed' });
}

export async function registerWebResearchRoutes(
  app: FastifyInstance,
  dependencies: WebResearchRouteDependencies,
): Promise<void> {
  app.post('/v1/web/search', async (request, reply) => {
    const identity = await requireUser(dependencies, request, reply);
    if (!identity) return;
    const parsed = SearchRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    const cancellation = new AbortController();
    request.raw.once('close', () => cancellation.abort('client disconnected'));
    try {
      const context = await resolveContext(
        dependencies,
        identity.user.id,
        parsed.data.roomId,
        'web.search',
      );
      await dependencies.policy?.assertCapabilityAllowed('WEB_SEARCH', {
        planId: identity.user.planId,
        ...(context.billingContext.kind === 'organization'
          ? { organizationId: context.billingContext.organizationId }
          : {}),
        ...(parsed.data.roomId ? { roomId: parsed.data.roomId } : {}),
      });
      const result = await dependencies.webResearch.search(
        {
          query: parsed.data.query,
          ...(parsed.data.maxResults === undefined ? {} : { maxResults: parsed.data.maxResults }),
          ...(parsed.data.recency === undefined ? {} : { recency: parsed.data.recency }),
          ...(parsed.data.domains === undefined ? {} : { domains: parsed.data.domains }),
          ...(parsed.data.excludeDomains === undefined
            ? {}
            : { excludeDomains: parsed.data.excludeDomains }),
          ...(parsed.data.safeSearch === undefined ? {} : { safeSearch: parsed.data.safeSearch }),
        } satisfies WebSearchRequest,
        { ...context, taskId: parsed.data.taskId },
        cancellation.signal,
      );
      return reply.send({
        ...result,
        billingContext:
          context.billingContext.kind === 'personal'
            ? { kind: 'personal', userId: identity.user.id }
            : {
                kind: 'organization',
                organizationId: context.billingContext.organizationId,
                roomId: context.billingContext.roomId,
              },
      });
    } catch (error) {
      return sendWebResearchError(reply, error);
    }
  });

  app.post('/v1/web/fetch', async (request, reply) => {
    const identity = await requireUser(dependencies, request, reply);
    if (!identity) return;
    const parsed = FetchRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    const cancellation = new AbortController();
    request.raw.once('close', () => cancellation.abort('client disconnected'));
    try {
      const context = await resolveContext(
        dependencies,
        identity.user.id,
        parsed.data.roomId,
        'web.fetch',
      );
      await dependencies.policy?.assertCapabilityAllowed('WEB_FETCH', {
        planId: identity.user.planId,
        ...(context.billingContext.kind === 'organization'
          ? { organizationId: context.billingContext.organizationId }
          : {}),
        ...(parsed.data.roomId ? { roomId: parsed.data.roomId } : {}),
      });
      const result = await dependencies.webResearch.fetch(
        {
          url: parsed.data.url,
          ...(parsed.data.purpose === undefined ? {} : { purpose: parsed.data.purpose }),
          ...(parsed.data.maxBytes === undefined ? {} : { maxBytes: parsed.data.maxBytes }),
        } satisfies WebFetchRequest,
        { ...context, taskId: parsed.data.taskId },
        cancellation.signal,
      );
      return reply.send({
        ...result,
        billingContext:
          context.billingContext.kind === 'personal'
            ? { kind: 'personal', userId: identity.user.id }
            : {
                kind: 'organization',
                organizationId: context.billingContext.organizationId,
                roomId: context.billingContext.roomId,
              },
      });
    } catch (error) {
      return sendWebResearchError(reply, error);
    }
  });
}
