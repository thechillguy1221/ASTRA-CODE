import {
  AUTO_MODEL_ID,
  ModelRequestSchema,
  type ModelDecision,
  type UsageReceipt,
} from '@astra/contracts';
import type { AuthService } from '@astra/auth';
import type { BillingService, OrganizationBillingService } from '@astra/billing';
import type { ModelCatalogStore, UsageReceiptStore } from '@astra/db';
import type { GatewayModelClient } from '@astra/model-gateway';
import type { ControlPlaneService } from '@astra/control-plane';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { resolveRequestedModel } from './model-selection.js';

export interface ModelRouteDependencies {
  catalog: ModelCatalogStore;
  receipts: UsageReceiptStore;
  gateway: GatewayModelClient;
  auth?: AuthService;
  billing?: BillingService;
  organizationBilling?: OrganizationBillingService;
  controlPlane?: ControlPlaneService;
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
    if (dependencies.controlPlane) {
      try {
        return reply.send({
          models: (await dependencies.controlPlane.listModels()).filter(
            (model) => model.enabled && model.visible !== false,
          ),
        });
      } catch {
        return reply.code(503).send({ error: 'CONTROL_PLANE_UNAVAILABLE' });
      }
    }
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
      const reservationId = request.headers['x-astra-reservation-id'];
      if (typeof reservationId !== 'string')
        return reply.code(409).send({ error: 'RESERVATION_REQUIRED' });
      reservation = await dependencies.billing.getReservation(reservationId);
      if (!reservation && dependencies.organizationBilling)
        reservation = await dependencies.organizationBilling.getReservation(reservationId);
      if (
        !reservation ||
        reservation.userId !== identity.user.id ||
        (reservation.organizationId && reservation.actorUserId !== identity.user.id) ||
        reservation.taskId !== parsed.data.taskId ||
        reservation.status !== 'RESERVED'
      )
        return reply.code(409).send({ error: 'RESERVATION_INVALID' });
    }
    if (dependencies.controlPlane && identity && parsed.data.modelId !== AUTO_MODEL_ID) {
      const policy = await dependencies.controlPlane.evaluateModelAccess({
        planId: identity.user.planId,
        modelId: parsed.data.modelId,
      });
      if (!policy.allowed)
        return reply.code(policy.reason === 'CONTROL_PLANE_UNAVAILABLE' ? 503 : 403).send({
          error:
            policy.reason === 'CONTROL_PLANE_UNAVAILABLE'
              ? 'CONTROL_PLANE_UNAVAILABLE'
              : 'MODEL_POLICY_DENIED',
          reason: policy.reason,
        });
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
              ? {
                  wallet:
                    reservation?.organizationId && dependencies.organizationBilling
                      ? await dependencies.organizationBilling.getWallet(reservation.organizationId)
                      : await dependencies.billing.getWallet(identity.user.id),
                }
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
    let model = resolved.model;
    if (dependencies.controlPlane && identity) {
      const policy = await dependencies.controlPlane.evaluateModelAccess({
        planId: identity.user.planId,
        modelId: model.modelId,
      });
      if (!policy.allowed)
        return reply.code(policy.reason === 'CONTROL_PLANE_UNAVAILABLE' ? 503 : 403).send({
          error:
            policy.reason === 'CONTROL_PLANE_UNAVAILABLE'
              ? 'CONTROL_PLANE_UNAVAILABLE'
              : 'MODEL_POLICY_DENIED',
          reason: policy.reason,
        });
      if (policy.model) model = policy.model;
    }

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
    const wantsStream = request.headers.accept?.includes('application/x-ndjson') === true;
    if (wantsStream) {
      reply.hijack();
      reply.raw.statusCode = 200;
      reply.raw.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
      reply.raw.setHeader('X-Accel-Buffering', 'no');
      const write = (value: unknown): void => {
        if (!reply.raw.writableEnded) reply.raw.write(`${JSON.stringify(value)}\n`);
      };
      write({
        type: 'model',
        selectedModelId: model.modelId,
        selectedModelDisplayName: model.displayName,
        selectedByAuto: resolved.selectedByAuto,
      });
      try {
        for await (const event of dependencies.gateway.complete(
          gatewayRequest,
          cancellation.signal,
        )) {
          if (event.type === 'usage') {
            receipt = event.receipt;
            await dependencies.receipts.save(event.receipt);
          }
          write(event);
        }
      } catch {
        write({ type: 'error', error: 'model_request_failed' });
      } finally {
        if (!reply.raw.writableEnded) reply.raw.end();
      }
      return reply;
    }
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
