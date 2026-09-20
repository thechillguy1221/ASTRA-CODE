import type { AuthService } from '@lyntar/auth';
import {
  BillingError,
  BillingService,
  OrganizationBillingService,
  formatUsd,
  parseUsd,
} from '@lyntar/billing';
import { AUTO_MODEL_ID, type BillingMode } from '@lyntar/contracts';
import type { ModelCatalogStore } from '@lyntar/db';
import type { UsageReceiptStore } from '@lyntar/db';
import {
  getPlanRegionalPrice,
  listCreditPacks,
  pricingRegionForCountryCode,
  normalizeCountryCode,
  STANDARD_CREDIT_RATES,
  type PlanCatalog,
} from '@lyntar/plans';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { resolveRequestedModel } from './model-selection.js';
import { RemoteAccessError, type RemoteAccessPort } from '@lyntar/remote-protocol';

const ReservationSchema = z.object({
  organizationId: z.string().min(1).optional(),
  roomId: z.string().min(1).optional(),
  hostDeviceId: z.string().min(1).optional(),
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
  if (value?.startsWith('Bearer ')) return value.slice(7).trim() || null;
  const access = request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('astra_access='))
    ?.slice('astra_access='.length);
  return access ? decodeURIComponent(access) : null;
}

function countryHintFrom(request: FastifyRequest): string | null {
  const query = request.query as { country?: unknown } | undefined;
  const candidates = [
    typeof query?.country === 'string' ? query.country : null,
    typeof request.headers['x-country-code'] === 'string'
      ? request.headers['x-country-code']
      : null,
    typeof request.headers['cf-ipcountry'] === 'string' ? request.headers['cf-ipcountry'] : null,
    typeof request.headers['x-vercel-ip-country'] === 'string'
      ? request.headers['x-vercel-ip-country']
      : null,
  ];
  return candidates.map(normalizeCountryCode).find((country) => country !== null) ?? null;
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
  if (error instanceof RemoteAccessError) return reply.code(403).send({ error: error.code });
  return reply.code(500).send({ error: 'billing_failed' });
}

export interface BillingRouteDependencies {
  auth?: AuthService;
  billing: BillingService;
  organizationBilling: OrganizationBillingService;
  plans: PlanCatalog;
  catalog?: ModelCatalogStore;
  receipts?: UsageReceiptStore;
  remote: RemoteAccessPort;
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

  app.get('/v1/pricing', async (request, reply) => {
    const countryCode = countryHintFrom(request);
    const region = pricingRegionForCountryCode(countryCode);
    return reply.send({
      productName: 'Astra Code',
      region,
      countryCode,
      plans: dependencies.plans.list().map((plan) => ({
        ...plan,
        regionalPrice: getPlanRegionalPrice(plan.id, region),
      })),
      creditPacks: listCreditPacks(region),
      standardCreditRate: STANDARD_CREDIT_RATES[region],
      policy: {
        additionalCreditsAvailable: true,
        purchasedCreditValidityDays: 365,
        subscriptionRolloverCycles: 1,
        countryIsPricingSignal: true,
        checkoutRequiresVerifiedBillingCountry: true,
      },
    });
  });

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

  app.get('/v1/wallet/buckets', async (request, reply) => {
    const identity = await requireUser(dependencies, request, reply);
    if (!identity) return;
    return reply.send({ buckets: await dependencies.billing.getBuckets(identity.user.id) });
  });

  app.get<{ Params: { roomId: string } }>('/v1/rooms/:roomId/wallet', async (request, reply) => {
    const identity = await requireUser(dependencies, request, reply);
    if (!identity) return;
    try {
      const room = await dependencies.remote.getRoom(request.params.roomId);
      await dependencies.remote.authorizeRoomAction({
        actorUserId: identity.user.id,
        roomId: room.id,
        permission: 'room.view',
      });
      return reply.send({
        wallet: await dependencies.organizationBilling.getWallet(room.organizationId),
      });
    } catch (error) {
      return sendBillingError(reply, error);
    }
  });

  app.post('/v1/billing/reservations', async (request, reply) => {
    const identity = await requireUser(dependencies, request, reply);
    if (!identity) return;
    const parsed = ReservationSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    try {
      const organizationContext = parsed.data.organizationId
        ? { organizationId: parsed.data.organizationId, roomId: parsed.data.roomId }
        : null;
      if (organizationContext && !organizationContext.roomId)
        return reply.code(400).send({ error: 'ROOM_REQUIRED_FOR_ORGANIZATION_BILLING' });
      const organizationRoom = organizationContext
        ? await dependencies.remote.getRoom(organizationContext.roomId as string)
        : null;
      if (
        organizationContext &&
        (!organizationRoom ||
          organizationRoom.organizationId !== organizationContext.organizationId)
      )
        return reply.code(403).send({ error: 'ROOM_ORGANIZATION_MISMATCH' });
      if (organizationRoom)
        await dependencies.remote.authorizeRoomAction({
          actorUserId: identity.user.id,
          roomId: organizationRoom.id,
          permission: 'agent.prompt',
        });
      const wallet = organizationContext
        ? await dependencies.organizationBilling.getWallet(organizationContext.organizationId)
        : await dependencies.billing.getWallet(identity.user.id);
      const resolved = dependencies.catalog
        ? await resolveRequestedModel(dependencies.catalog, {
            requestedModelId: parsed.data.modelId,
            planId: identity.user.planId,
            wallet,
          })
        : parsed.data.modelId === AUTO_MODEL_ID
          ? undefined
          : { model: undefined, selectedByAuto: false };
      if (dependencies.catalog && !resolved)
        return reply.code(404).send({ error: 'model_unavailable' });
      const selectedModelId = resolved?.model?.modelId ?? parsed.data.modelId;
      const reservation = organizationContext
        ? await dependencies.organizationBilling.reserveTask({
            organizationId: organizationContext.organizationId,
            actorUserId: identity.user.id,
            roomId: organizationRoom?.id ?? null,
            hostDeviceId: parsed.data.hostDeviceId ?? organizationRoom?.hostDeviceId ?? null,
            planId: identity.user.planId,
            taskId: parsed.data.taskId,
            modelId: selectedModelId,
            ...(resolved?.model?.planAccess ? { modelPlanAccess: resolved.model.planAccess } : {}),
            mode: parsed.data.mode as BillingMode,
            amountCredits: parsed.data.amountCredits,
            idempotencyKey: parsed.data.idempotencyKey,
            activeSeats: (
              await dependencies.remote.listRoomMembers(identity.user.id, organizationRoom!.id)
            ).filter((member) => member.status === 'ACTIVE').length,
          })
        : await dependencies.billing.reserveTask({
            userId: identity.user.id,
            planId: identity.user.planId,
            taskId: parsed.data.taskId,
            modelId: selectedModelId,
            ...(resolved?.model?.planAccess ? { modelPlanAccess: resolved.model.planAccess } : {}),
            mode: parsed.data.mode as BillingMode,
            amountCredits: parsed.data.amountCredits,
            idempotencyKey: parsed.data.idempotencyKey,
          });
      return reply.code(201).send({ reservation });
    } catch (error) {
      return sendBillingError(reply, error);
    }
  });

  app.get<{ Params: { taskId: string } }>(
    '/v1/billing/tasks/:taskId/receipts',
    async (request, reply) => {
      const identity = await requireUser(dependencies, request, reply);
      if (!identity) return;
      const reservationId = request.headers['x-lyntar-reservation-id'];
      if (typeof reservationId !== 'string')
        return reply.code(400).send({ error: 'RESERVATION_REQUIRED' });
      const reservation =
        (await dependencies.billing.getReservation(reservationId)) ??
        (await dependencies.organizationBilling.getReservation(reservationId));
      if (
        !reservation ||
        reservation.userId !== identity.user.id ||
        (reservation.organizationId && reservation.actorUserId !== identity.user.id) ||
        reservation.taskId !== request.params.taskId
      )
        return reply.code(404).send({ error: 'RESERVATION_NOT_FOUND' });
      if (!dependencies.receipts)
        return reply.code(503).send({ error: 'USAGE_RECEIPTS_NOT_CONFIGURED' });
      return reply.send({
        receipts: await dependencies.receipts.listForTask(request.params.taskId),
      });
    },
  );

  app.post('/v1/billing/settlements', async (request, reply) => {
    const identity = await requireUser(dependencies, request, reply);
    if (!identity) return;
    const parsed = SettlementSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    try {
      const personalReservation = await dependencies.billing.getReservation(
        parsed.data.reservationId,
      );
      const reservation =
        personalReservation ??
        (await dependencies.organizationBilling.getReservation(parsed.data.reservationId));
      if (
        !reservation ||
        reservation.userId !== identity.user.id ||
        (reservation.organizationId && reservation.actorUserId !== identity.user.id)
      )
        return reply.code(404).send({ error: 'RESERVATION_NOT_FOUND' });
      if (!dependencies.receipts)
        return reply.code(503).send({ error: 'USAGE_RECEIPTS_NOT_CONFIGURED' });
      const receipts = await dependencies.receipts.listForTask(reservation.taskId);
      const providerCost = formatUsd(
        receipts
          .filter((receipt) => receipt.actualCostUsd !== null)
          .reduce(
            (total, receipt) =>
              total + parseUsd(Math.max(receipt.actualCostUsd ?? 0, 0).toFixed(10)),
            0n,
          ),
      );
      // Provider receipts are the source of truth. The desktop request fields
      // remain accepted for wire compatibility but are never trusted for
      // financial settlement.
      const settlement = reservation.organizationId
        ? await dependencies.organizationBilling.settleTask({
            reservationId: reservation.reservationId,
            providerActualCostUsd: providerCost,
            customerBillableCostUsd: providerCost,
            idempotencyKey: parsed.data.idempotencyKey,
          })
        : await dependencies.billing.settleTask({
            reservationId: reservation.reservationId,
            providerActualCostUsd: providerCost,
            customerBillableCostUsd: providerCost,
            idempotencyKey: parsed.data.idempotencyKey,
          });
      return reply.send({ settlement });
    } catch (error) {
      return sendBillingError(reply, error);
    }
  });
}
