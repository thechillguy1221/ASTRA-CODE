import { ModelRequestSchema, type ModelDecision, type UsageReceipt } from '@lyntar/contracts';
import type { AuthService } from '@lyntar/auth';
import type { BillingService } from '@lyntar/billing';
import type { ModelCatalogStore, UsageReceiptStore } from '@lyntar/db';
import type { GatewayModelClient } from '@lyntar/model-gateway';
import type { FastifyInstance, FastifyRequest } from 'fastify';

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
    if (identity && dependencies.billing) {
      const reservationId = request.headers['x-lyntar-reservation-id'];
      if (typeof reservationId !== 'string')
        return reply.code(409).send({ error: 'RESERVATION_REQUIRED' });
      const reservation = await dependencies.billing.getReservation(reservationId);
      if (
        !reservation ||
        reservation.userId !== identity.user.id ||
        reservation.taskId !== parsed.data.taskId ||
        reservation.status !== 'RESERVED'
      )
        return reply.code(409).send({ error: 'RESERVATION_INVALID' });
    }
    const model = await dependencies.catalog.getEnabled(parsed.data.modelId);
    if (!model) return reply.code(404).send({ error: 'model_unavailable' });

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
    return reply.send({ decision, usage: receipt, providerRequestId: providerRequestId ?? null });
  });
}
