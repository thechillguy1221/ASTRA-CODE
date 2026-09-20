import {
  AUTO_MODEL_ID,
  ModelRequestSchema,
  type ModelDecision,
  type UsageReceipt,
} from '@lyntar/contracts';
import type { AuthService } from '@lyntar/auth';
import type { BillingService } from '@lyntar/billing';
import type { ModelCatalogStore, UsageReceiptStore } from '@lyntar/db';
import type { GatewayModelClient } from '@lyntar/model-gateway';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { resolveRequestedModel } from './model-selection.js';

export interface ModelRouteDependencies {
  catalog: ModelCatalogStore;
  receipts: UsageReceiptStore;
  gateway: GatewayModelClient;
  auth?: AuthService;
  billing?: BillingService;
  developmentEntitlement: boolean;
}

function tokenFrom(request: FastifyRequest): string | null {
  const value = request.headers.authorization;
  return value?.startsWith('Bearer ') ? value.slice('Bearer '.length).trim() || null : null;
}

export async function registerModelRoutes(
  app: FastifyInstance,
  dependencies: ModelRouteDependencies,
): Promise<void> {
  app.get('/v1/models', async (_request, reply) => {
    return reply.send({ models: await dependencies.catalog.listEnabled() });
  });

  app.post('/v1/model-requests', async (request, reply) => {
    const parsed = ModelRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: 'invalid_request', details: parsed.error.flatten() });
    let identity: Awaited<ReturnType<AuthService['authenticate']>> | null = null;
    const token = tokenFrom(request);
    if (dependencies.auth && token) {
      try {
        identity = await dependencies.auth.authenticate(token);
      } catch {
        return reply.code(401).send({ error: 'SESSION_INVALID' });
      }
    } else if (dependencies.auth && !dependencies.developmentEntitlement) {
      return reply.code(401).send({ error: 'SESSION_INVALID' });
    }
    let reservation: Awaited<ReturnType<BillingService['getReservation']>>;
    if (identity && dependencies.billing) {
      const reservationId = request.headers['x-lyntar-reservation-id'];
      if (typeof reservationId !== 'string')
        return reply.code(409).send({ error: 'RESERVATION_REQUIRED' });
      reservation = await dependencies.billing.getReservation(reservationId);
      if (
        !reservation ||
        reservation.userId !== identity.user.id ||
        reservation.taskId !== parsed.data.taskId ||
        reservation.status !== 'RESERVED'
      )
        return reply.code(409).send({ error: 'RESERVATION_INVALID' });
    }
    const reservedModel =
      reservation?.modelId && reservation.modelId !== AUTO_MODEL_ID
        ? await dependencies.catalog.getEnabled(reservation.modelId)
        : undefined;
    const resolved =
      reservedModel && parsed.data.modelId === AUTO_MODEL_ID
        ? {
            model: reservedModel,
            selectedByAuto: true,
            disclosure: `Auto selected ${reservedModel.displayName}`,
          }
        : await resolveRequestedModel(dependencies.catalog, {
            requestedModelId: parsed.data.modelId,
            planId: identity?.user.planId ?? 'FREE',
            ...(identity && dependencies.billing
              ? { wallet: await dependencies.billing.getWallet(identity.user.id) }
              : {}),
            inputTokenEstimate: parsed.data.messages.reduce(
              (total, message) => total + Math.ceil(message.content.length / 4),
              0,
            ),
          });
    if (!resolved) return reply.code(404).send({ error: 'model_unavailable' });
    if (
      reservation &&
      ((parsed.data.modelId !== AUTO_MODEL_ID && reservation.modelId !== parsed.data.modelId) ||
        (parsed.data.modelId === AUTO_MODEL_ID && reservation.modelId !== resolved.model.modelId))
    )
      return reply.code(409).send({ error: 'RESERVATION_INVALID' });
    const model = resolved.model;

    const cancellation = new AbortController();
    request.raw.once('close', () => cancellation.abort('client disconnected'));
    let decision: ModelDecision | undefined;
    let receipt: UsageReceipt | null = null;
    let providerRequestId: string | undefined;
    const gatewayRequest = {
      ...parsed.data,
      gatewayModelId: model.gatewayModelId,
      provider: model.provider ?? model.providerSlug,
      ...(model.costMetadata ? { costMetadata: model.costMetadata } : {}),
    };
    for await (const event of dependencies.gateway.complete(gatewayRequest, cancellation.signal)) {
      if (event.type === 'decision') decision = event.decision;
      if (event.type === 'provider') providerRequestId = event.providerRequestId;
      if (event.type === 'usage') {
        receipt = event.receipt;
        await dependencies.receipts.save(event.receipt);
      }
    }
    if (!decision) return reply.code(502).send({ error: 'missing_model_decision' });
    return reply.send({
      decision,
      usage: receipt,
      providerRequestId: providerRequestId ?? null,
      ...(resolved.selectedByAuto
        ? { selectedModelId: model.modelId, selectedModelDisplayName: model.displayName }
        : {}),
    });
  });
}
