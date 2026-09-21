import type { AuthService } from '@astra/auth';
import { AdminService, type AdminAuditStore, type AdminRole } from '@astra/billing';
import {
  EmailCampaignService,
  EmailService,
  type CampaignAudience,
  type CampaignUser,
  type EmailSenderKind,
} from '@astra/email';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

const PreferenceSchema = z.object({ marketingAllowed: z.boolean() });
const CampaignSchema = z.object({
  name: z.string().min(1).max(120),
  subject: z.string().min(1).max(200),
  previewText: z.string().max(240).default(''),
  html: z.string().min(1).max(500_000),
  audience: z
    .object({ planId: z.string().min(1).optional(), activeOnly: z.boolean().optional() })
    .default({}),
});
const EmailTestSchema = z.object({
  subject: z.string().min(1).max(200),
  html: z.string().min(1).max(500_000),
});
const SenderKindSchema = z.enum(['DEFAULT', 'NOREPLY', 'SUPPORT', 'BILLING', 'SECURITY']);
const SenderSchema = z.object({
  fromAddress: z.string().min(3).max(320),
  replyTo: z.string().min(3).max(320).optional(),
});

function bearer(request: FastifyRequest): string | null {
  const value = request.headers.authorization;
  if (value?.startsWith('Bearer ')) return value.slice(7).trim() || null;
  const access = request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('astra_access='))
    ?.slice('astra_access='.length);
  return access ? decodeURIComponent(access) : null;
}

async function identity(
  auth: AuthService | undefined,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const token = bearer(request);
  if (!auth || !token) {
    await reply
      .code(auth ? 401 : 503)
      .send({ error: auth ? 'SESSION_INVALID' : 'auth_not_configured' });
    return null;
  }
  try {
    return await auth.authenticate(token);
  } catch {
    await reply.code(401).send({ error: 'SESSION_INVALID' });
    return null;
  }
}

export interface EmailRouteDependencies {
  auth?: AuthService;
  email?: EmailService;
  campaigns?: EmailCampaignService;
  admin?: AdminService;
  audit?: AdminAuditStore;
  listCampaignUsers?: (audience: CampaignAudience) => Promise<CampaignUser[]>;
}

export async function registerEmailRoutes(
  app: FastifyInstance,
  dependencies: EmailRouteDependencies,
): Promise<void> {
  app.get('/v1/account/email-preferences', async (request, reply) => {
    const who = await identity(dependencies.auth, request, reply);
    if (!who || !dependencies.email)
      return dependencies.email
        ? undefined
        : reply.code(503).send({ error: 'email_not_configured' });
    const preference = await dependencies.email.getMarketingPreference(who.user.id);
    return reply.send(preference ?? { marketingAllowed: false, unsubscribedAt: null });
  });

  app.post('/v1/account/email-preferences', async (request, reply) => {
    const who = await identity(dependencies.auth, request, reply);
    if (!who || !dependencies.email)
      return dependencies.email
        ? undefined
        : reply.code(503).send({ error: 'email_not_configured' });
    const parsed = PreferenceSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    await dependencies.email.setMarketingPreference(who.user.id, parsed.data.marketingAllowed);
    return reply.code(204).send();
  });

  app.get('/v1/admin/email/senders', async (request, reply) => {
    const who = await identity(dependencies.auth, request, reply);
    if (!who || !dependencies.email || !dependencies.admin)
      return reply.code(503).send({ error: 'email_admin_not_configured' });
    try {
      dependencies.admin.assertCan(who.user.role as AdminRole, 'manage_email');
      return reply.send({ senders: await dependencies.email.listSenderIdentities() });
    } catch (error) {
      return reply
        .code(403)
        .send({ error: error instanceof Error ? error.message : 'ADMIN_FORBIDDEN' });
    }
  });

  app.put<{ Params: { kind: string } }>('/v1/admin/email/senders/:kind', async (request, reply) => {
    const who = await identity(dependencies.auth, request, reply);
    if (!who || !dependencies.email || !dependencies.admin)
      return reply.code(503).send({ error: 'email_admin_not_configured' });
    const kind = SenderKindSchema.safeParse(request.params.kind.toUpperCase());
    const parsed = SenderSchema.safeParse(request.body);
    if (!kind.success || !parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    try {
      dependencies.admin.assertCan(who.user.role as AdminRole, 'manage_email');
      const sender = await dependencies.email.upsertSenderIdentity({
        kind: kind.data as EmailSenderKind,
        fromAddress: parsed.data.fromAddress,
        ...(parsed.data.replyTo ? { replyTo: parsed.data.replyTo } : {}),
        updatedBy: who.user.id,
      });
      if (dependencies.audit)
        await dependencies.admin.recordMutation({
          actor: { userId: who.user.id, role: who.user.role as AdminRole },
          action: 'manage_email',
          targetType: 'email_sender',
          targetId: sender.kind,
          before: null,
          after: { kind: sender.kind, fromAddress: sender.fromAddress, replyTo: sender.replyTo },
          reason: 'Updated approved sender identity',
          requestId: request.id,
        });
      return reply.send({ sender });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'ADMIN_FORBIDDEN';
      if (/invalid sender address/i.test(message)) return reply.code(400).send({ error: message });
      if (/not configured/i.test(message)) return reply.code(503).send({ error: message });
      return reply.code(403).send({ error: message });
    }
  });

  app.post('/v1/admin/email/campaigns', async (request, reply) => {
    const who = await identity(dependencies.auth, request, reply);
    if (!who || !dependencies.campaigns || !dependencies.admin)
      return reply.code(503).send({ error: 'email_admin_not_configured' });
    const role = who.user.role as AdminRole;
    try {
      dependencies.admin.assertCan(role, 'manage_email');
      const parsed = CampaignSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
      const audience = {
        ...(parsed.data.audience.planId ? { planId: parsed.data.audience.planId } : {}),
        ...(parsed.data.audience.activeOnly ? { activeOnly: true } : {}),
      };
      const campaign = await dependencies.campaigns.create({
        ...parsed.data,
        createdBy: who.user.id,
        audience,
      });
      if (dependencies.audit)
        await dependencies.admin.recordMutation({
          actor: { userId: who.user.id, role },
          action: 'manage_email',
          targetType: 'email_campaign',
          targetId: campaign.id,
          before: null,
          after: { status: campaign.status, audience: campaign.audience },
          reason: 'Created marketing campaign',
          requestId: request.id,
        });
      return reply.code(201).send({ campaign });
    } catch (error) {
      return reply
        .code(403)
        .send({ error: error instanceof Error ? error.message : 'ADMIN_FORBIDDEN' });
    }
  });

  app.post('/v1/admin/email/test', async (request, reply) => {
    const who = await identity(dependencies.auth, request, reply);
    if (!who || !dependencies.email || !dependencies.admin)
      return reply.code(503).send({ error: 'email_admin_not_configured' });
    try {
      dependencies.admin.assertCan(who.user.role as AdminRole, 'manage_email');
      const parsed = EmailTestSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
      const delivery = await dependencies.email.send({
        kind: 'transactional',
        userId: who.user.id,
        to: who.user.email,
        verified: true,
        unsubscribed: false,
        subject: parsed.data.subject,
        html: parsed.data.html,
        templateId: 'admin.email_test',
        idempotencyKey: `admin-email-test:${who.user.id}:${request.id}`,
      });
      if (dependencies.audit)
        await dependencies.admin.recordMutation({
          actor: { userId: who.user.id, role: who.user.role as AdminRole },
          action: 'manage_email',
          targetType: 'email_test',
          targetId: who.user.id,
          before: null,
          after: { status: delivery.status },
          reason: 'Sent authorized admin email test',
          requestId: request.id,
        });
      return reply.send({ delivery });
    } catch (error) {
      return reply
        .code(403)
        .send({ error: error instanceof Error ? error.message : 'ADMIN_FORBIDDEN' });
    }
  });

  app.get<{ Params: { campaignId: string } }>(
    '/v1/admin/email/campaigns/:campaignId/preview',
    async (request, reply) => {
      const who = await identity(dependencies.auth, request, reply);
      if (!who || !dependencies.campaigns || !dependencies.admin || !dependencies.listCampaignUsers)
        return reply.code(503).send({ error: 'email_admin_not_configured' });
      try {
        dependencies.admin.assertCan(who.user.role as AdminRole, 'manage_email');
        const campaign = await dependencies.campaigns.get(request.params.campaignId);
        if (!campaign) return reply.code(404).send({ error: 'campaign_not_found' });
        const users = await dependencies.listCampaignUsers(campaign.audience);
        const preview = await dependencies.campaigns.previewById(request.params.campaignId, users);
        return reply.send({
          eligibleRecipients: preview.eligible.length,
          suppressedRecipients: preview.suppressed.length,
        });
      } catch (error) {
        return reply
          .code(403)
          .send({ error: error instanceof Error ? error.message : 'ADMIN_FORBIDDEN' });
      }
    },
  );

  app.post<{ Params: { campaignId: string } }>(
    '/v1/admin/email/campaigns/:campaignId/send',
    async (request, reply) => {
      const who = await identity(dependencies.auth, request, reply);
      if (!who || !dependencies.campaigns || !dependencies.admin || !dependencies.listCampaignUsers)
        return reply.code(503).send({ error: 'email_admin_not_configured' });
      try {
        dependencies.admin.assertCan(who.user.role as AdminRole, 'send_campaign');
        const campaign = await dependencies.campaigns.get(request.params.campaignId);
        if (!campaign) return reply.code(404).send({ error: 'campaign_not_found' });
        const users = await dependencies.listCampaignUsers(campaign.audience);
        const result = await dependencies.campaigns.send(request.params.campaignId, users);
        if (dependencies.audit)
          await dependencies.admin.recordMutation({
            actor: { userId: who.user.id, role: who.user.role as AdminRole },
            action: 'send_campaign',
            targetType: 'email_campaign',
            targetId: campaign.id,
            before: { status: campaign.status },
            after: result,
            reason: 'Sent marketing campaign',
            requestId: request.id,
          });
        return reply.send(result);
      } catch (error) {
        return reply
          .code(403)
          .send({ error: error instanceof Error ? error.message : 'ADMIN_FORBIDDEN' });
      }
    },
  );
}
