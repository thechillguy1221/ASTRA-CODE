import type { AuthService } from '@lyntar/auth';
import { BillingError, BillingService } from '@lyntar/billing';
import { type BillingMode } from '@lyntar/contracts';
import type { ModelCatalogStore } from '@lyntar/db';
import type { PlanCatalog } from '@lyntar/plans';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

const ReservationSchema = z.object({
  taskId: z.string().min(1),
  modelId: z.string().min(1),
  mode: z.enum(['BUILD', 'LEARN', 'VIVA', 'HACKATHON']),
  amountCredits: z.string().regex(/^\d+(?:\.\d+)?$/),
  idempotencyKey: z.string().min(1).max(200),
});
const SettlementSchema = z.object({
  reservationId: z.string().min(1),
  providerActualCostUsd: z.string().regex(/^\d+(?:\.\d+)?$/),
  customerBillableCostUsd: z.string().regex(/^\d+(?:\.\d+)?$/),
  idempotencyKey: z.string().min(1).max(200),
});

function tokenFrom(request: FastifyRequest): string | null {
  const value = request.headers.authorization;
  return value?.startsWith('Bearer ') ? value.slice(7).trim() || null : null;
}

function sendBillingError(reply: FastifyReply, error: unknown) {
  if (error instanceof BillingError) {
    const status =
      error.code === 'INSUFFICIENT_CREDITS'
        ? 402
        : error.code === 'IDEMPOTENCY_CONFLICT'
          ? 409
          : 400;
    return reply.code(status).send({ error: error.code });
  }
  if (error instanceof Error && error.name === 'PlanEntitlementError')
    return reply.code(403).send({ error: 'PLAN_ENTITLEMENT_DENIED' });
  return reply.code(500).send({ error: 'billing_failed' });
}

export interface BillingRouteDependencies {
  auth?: AuthService;
  billing: BillingService;
  plans: PlanCatalog;
  catalog?: ModelCatalogStore;
}

async function requireUser(
  dependencies: BillingRouteDependencies,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const token = tokenFrom(request);
  if (!token) {
    await reply.code(401).send({ error: 'SESSION_INVALID' });
    return null;
  }
  if (!dependencies.auth) {
    await reply.code(503).send({ error: 'auth_not_configured' });
    return null;
  }
  try {
    return await dependencies.auth.authenticate(token);
  } catch {
    await reply.code(401).send({ error: 'SESSION_INVALID' });
    return null;
  }
}

export async function registerBillingRoutes(
  app: FastifyInstance,
  dependencies: BillingRouteDependencies,
): Promise<void> {
  app.get('/v1/plans', async (_request, reply) => reply.send({ plans: dependencies.plans.list() }));

  app.get('/v1/wallet', async (request, reply) => {
    const identity = await requireUser(dependencies, request, reply);
    if (!identity) return;
    return reply.send({ wallet: await dependencies.billing.getWallet(identity.user.id) });
  });

  app.get('/v1/wallet/ledger', async (request, reply) => {
    const identity = await requireUser(dependencies, request, reply);
    if (!identity) return;
    return reply.send({ entries: await dependencies.billing.getLedger(identity.user.id) });
  });

  app.post('/v1/billing/reservations', async (request, reply) => {
    const identity = await requireUser(dependencies, request, reply);
    if (!identity) return;
    const parsed = ReservationSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    try {
      const model = dependencies.catalog
        ? await dependencies.catalog.getEnabled(parsed.data.modelId)
        : undefined;
      if (dependencies.catalog && !model)
        return reply.code(404).send({ error: 'model_unavailable' });
      const reservation = await dependencies.billing.reserveTask({
        userId: identity.user.id,
        planId: identity.user.planId,
        taskId: parsed.data.taskId,
        modelId: parsed.data.modelId,
        ...(model?.planAccess ? { modelPlanAccess: model.planAccess } : {}),
        mode: parsed.data.mode as BillingMode,
        amountCredits: parsed.data.amountCredits,
        idempotencyKey: parsed.data.idempotencyKey,
      });
      return reply.code(201).send({ reservation });
    } catch (error) {
      return sendBillingError(reply, error);
    }
  });

  app.post('/v1/billing/settlements', async (request, reply) => {
    const identity = await requireUser(dependencies, request, reply);
    if (!identity) return;
    const parsed = SettlementSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    try {
      const reservation = await dependencies.billing.getReservation(parsed.data.reservationId);
      if (!reservation || reservation.userId !== identity.user.id)
        return reply.code(404).send({ error: 'RESERVATION_NOT_FOUND' });
      const settlement = await dependencies.billing.settleTask(parsed.data);
      return reply.send({ settlement });
    } catch (error) {
      return sendBillingError(reply, error);
    }
  });
}
