import { randomUUID } from 'node:crypto';
import type { AuthService } from '@lyntar/auth';
import { BillingService, OrganizationBillingService } from '@lyntar/billing';
import type { ModelCatalogStore, UsageReceiptStore } from '@lyntar/db';
import { parseUsageReceipt, type ResponsesGatewayClient } from '@lyntar/model-gateway';
import type { RemoteAccessPort } from '@lyntar/remote-protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CodexRuntimeTokenService } from './codex-runtime-auth.js';

const RuntimeTokenRequestSchema = z.object({
  taskId: z.string().min(1),
  reservationId: z.string().min(1),
});

const RuntimeQuerySchema = z.object({
  task_id: z.string().min(1),
  reservation_id: z.string().min(1),
});

function bearerToken(request: FastifyRequest): string | null {
  const value = request.headers.authorization;
  return value?.startsWith('Bearer ') ? value.slice('Bearer '.length).trim() || null : null;
}

async function authenticate(
  dependencies: CodexRuntimeRouteDependencies,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const token = bearerToken(request);
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

export interface CodexRuntimeRouteDependencies {
  auth: AuthService;
  catalog: ModelCatalogStore;
  receipts: UsageReceiptStore;
  billing: BillingService;
  organizationBilling: OrganizationBillingService;
  remote: RemoteAccessPort;
  runtimeTokens: CodexRuntimeTokenService;
  responsesGateway?: ResponsesGatewayClient;
}

async function getReservation(dependencies: CodexRuntimeRouteDependencies, reservationId: string) {
  return (
    (await dependencies.billing.getReservation(reservationId)) ??
    (await dependencies.organizationBilling.getReservation(reservationId))
  );
}

async function requireAuthorizedReservation(
  dependencies: CodexRuntimeRouteDependencies,
  reply: FastifyReply,
  input: { taskId: string; reservationId: string; userId: string },
) {
  const reservation = await getReservation(dependencies, input.reservationId);
  if (
    !reservation ||
    reservation.userId !== input.userId ||
    reservation.taskId !== input.taskId ||
    reservation.status !== 'RESERVED'
  ) {
    await reply.code(409).send({ error: 'RESERVATION_INVALID' });
    return null;
  }
  if (reservation.organizationId) {
    if (!reservation.roomId) {
      await reply.code(403).send({ error: 'ROOM_REQUIRED_FOR_ORGANIZATION_BILLING' });
      return null;
    }
    try {
      const room = await dependencies.remote.getRoom(reservation.roomId);
      if (room.organizationId !== reservation.organizationId)
        throw new Error('Room organization mismatch');
      await dependencies.remote.authorizeRoomAction({
        actorUserId: input.userId,
        roomId: room.id,
        permission: 'agent.prompt',
      });
    } catch {
      await reply.code(403).send({ error: 'ROOM_AUTHORIZATION_REQUIRED' });
      return null;
    }
  }
  return reservation;
}

function responseEventData(value: Record<string, unknown> | null): Record<string, unknown> | null {
  return value;
}

export async function registerCodexRuntimeRoutes(
  app: FastifyInstance,
  dependencies: CodexRuntimeRouteDependencies,
): Promise<void> {
  app.post('/v1/runtime/codex/token', async (request, reply) => {
    const identity = await authenticate(dependencies, request, reply);
    if (!identity) return;
    const parsed = RuntimeTokenRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    const reservation = await requireAuthorizedReservation(dependencies, reply, {
      taskId: parsed.data.taskId,
      reservationId: parsed.data.reservationId,
      userId: identity.user.id,
    });
    if (!reservation) return;
    const accessToken = bearerToken(request);
    if (!accessToken) return reply.code(401).send({ error: 'SESSION_INVALID' });
    const issued = dependencies.runtimeTokens.issue({
      accessToken,
      userId: identity.user.id,
      deviceSessionId: identity.device.deviceSessionId,
      taskId: parsed.data.taskId,
      reservationId: parsed.data.reservationId,
    });
    return reply.code(201).send({
      token: issued.token,
      scope: issued.claims.scope,
      expiresAt: new Date(issued.claims.expiresAt).toISOString(),
    });
  });

  app.post<{ Querystring: { task_id?: string; reservation_id?: string } }>(
    '/runtime/codex/v1/responses',
    async (request, reply) => {
      const token = bearerToken(request);
      if (!token) return reply.code(401).send({ error: 'RUNTIME_AUTH_REQUIRED' });
      let stored;
      try {
        stored = dependencies.runtimeTokens.verify(token);
      } catch {
        return reply.code(401).send({ error: 'RUNTIME_TOKEN_INVALID' });
      }
      let identity;
      try {
        identity = await dependencies.auth.authenticate(stored.accessToken);
      } catch {
        return reply.code(401).send({ error: 'SESSION_INVALID' });
      }
      if (
        identity.user.id !== stored.claims.userId ||
        identity.device.deviceSessionId !== stored.claims.deviceSessionId
      )
        return reply.code(401).send({ error: 'RUNTIME_TOKEN_CONTEXT_INVALID' });
      const query = RuntimeQuerySchema.safeParse(request.query);
      if (!query.success) return reply.code(400).send({ error: 'RUNTIME_CONTEXT_REQUIRED' });
      if (
        query.data.task_id !== stored.claims.taskId ||
        query.data.reservation_id !== stored.claims.reservationId
      )
        return reply.code(403).send({ error: 'RUNTIME_CONTEXT_MISMATCH' });
      const reservation = await requireAuthorizedReservation(dependencies, reply, {
        taskId: query.data.task_id,
        reservationId: query.data.reservation_id,
        userId: identity.user.id,
      });
      if (!reservation) return;
      if (!dependencies.responsesGateway)
        return reply.code(503).send({ error: 'CODEX_RUNTIME_GATEWAY_UNAVAILABLE' });
      const body =
        request.body && typeof request.body === 'object' && !Array.isArray(request.body)
          ? ({ ...(request.body as Record<string, unknown>) } as Record<string, unknown>)
          : null;
      if (!body) return reply.code(400).send({ error: 'invalid_request' });
      const requestedModel = typeof body.model === 'string' ? body.model : reservation.modelId;
      if (!requestedModel || requestedModel !== reservation.modelId)
        return reply.code(409).send({ error: 'MODEL_RESERVATION_MISMATCH' });
      const model = await dependencies.catalog.getEnabled(reservation.modelId);
      if (!model) return reply.code(404).send({ error: 'model_unavailable' });

      const requestIdHeader = request.headers['x-client-request-id'];
      const requestId = typeof requestIdHeader === 'string' ? requestIdHeader : randomUUID();
      const cancellation = new AbortController();
      request.raw.once('close', () => cancellation.abort('client disconnected'));
      reply.hijack();
      reply.raw.statusCode = 200;
      reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Accel-Buffering', 'no');
      const write = (event: string | null, data: Record<string, unknown> | null): void => {
        if (reply.raw.writableEnded) return;
        if (event) reply.raw.write(`event: ${event}\n`);
        if (data) reply.raw.write(`data: ${JSON.stringify(data)}\n`);
        reply.raw.write('\n');
      };
      try {
        for await (const event of dependencies.responsesGateway.stream(
          {
            requestId,
            model: model.gatewayModelId,
            body,
            ...(model.costMetadata ? { costMetadata: model.costMetadata } : {}),
          },
          cancellation.signal,
        )) {
          const data = responseEventData(event.data);
          write(event.event, data);
          if (data?.type === 'response.completed' || event.event === 'response.completed') {
            const receipt = parseUsageReceipt(data, {
              requestId,
              taskId: reservation.taskId,
              modelId: model.modelId,
              gatewayModelId: model.gatewayModelId,
              provider: model.provider ?? model.providerSlug,
              providerRoute: model.gatewayModelId,
              ...(model.costMetadata ? { costMetadata: model.costMetadata } : {}),
            });
            if (receipt) await dependencies.receipts.save(receipt);
          }
        }
      } catch (error) {
        if (!reply.raw.writableEnded)
          write('error', {
            type: 'error',
            error: { message: error instanceof Error ? error.message : 'model_request_failed' },
          });
      } finally {
        if (!reply.raw.writableEnded) reply.raw.end();
      }
      return reply;
    },
  );
}
