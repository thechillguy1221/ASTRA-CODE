import { randomBytes } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import {
  createMemoryCatalog,
  createMemoryEventStore,
  createMemoryReceiptStore,
  type AgentEventStore,
  type ModelCatalogStore,
  type UsageReceiptStore,
} from '@lyntar/db';
import type { GatewayModelClient, ResponsesGatewayClient } from '@lyntar/model-gateway';
import type { AuthService } from '@lyntar/auth';
import type { RateLimitStore } from '@lyntar/auth';
import { hashRateLimitIdentity } from '@lyntar/auth';
import {
  AdminService,
  BillingService,
  InMemoryAdminAuditStore,
  InMemoryBillingStore,
  InMemoryOrganizationBillingStore,
  OrganizationBillingService,
  type AdminAuditStore,
  type RazorpayWebhookService,
  type AdminAnalyticsPort,
} from '@lyntar/billing';
import { createDefaultPlanCatalog, type PlanCatalog } from '@lyntar/plans';
import { registerModelRoutes } from './model-route.js';
import { registerAgentEventRoutes } from './event-route.js';
import { registerAuthRoutes } from './auth-route.js';
import { registerBillingRoutes } from './billing-route.js';
import { registerAdminRoutes } from './admin-route.js';
import { registerRazorpayRoutes } from './razorpay-route.js';
import { registerReleaseRoutes } from './release-route.js';
import { registerEmailRoutes } from './email-route.js';
import type { ReleaseManifest } from '@lyntar/releases';
import type { EmailService } from '@lyntar/email';
import type { GoogleDesktopOAuthService } from '@lyntar/auth';
import type { EmailCampaignService, CampaignAudience, CampaignUser } from '@lyntar/email';
import {
  RemoteAccessService,
  type RemoteAccessPort,
  type RemoteRelayBroker,
} from '@lyntar/remote-protocol';
import { registerRemoteRoutes } from './remote-route.js';
import {
  UnavailableWebSearchProvider,
  WebResearchService,
  type WebResearchService as WebResearchServiceType,
} from '@lyntar/web-research';
import { registerWebResearchRoutes } from './web-research-route.js';
import { CodexRuntimeTokenService } from './codex-runtime-auth.js';
import { registerCodexRuntimeRoutes } from './codex-runtime-route.js';

export interface ApiDependencies {
  catalog?: ModelCatalogStore;
  receipts?: UsageReceiptStore;
  events?: AgentEventStore;
  gateway?: GatewayModelClient;
  responsesGateway?: ResponsesGatewayClient;
  runtimeTokenSecret?: string;
  auth?: AuthService;
  exposeDevelopmentTokens?: boolean;
  billing?: BillingService;
  organizationBilling?: OrganizationBillingService;
  plans?: PlanCatalog;
  admin?: AdminService;
  audit?: AdminAuditStore;
  razorpay?: RazorpayWebhookService;
  developmentEntitlement?: boolean;
  releaseManifest?: ReleaseManifest;
  email?: EmailService;
  publicSiteUrl?: string;
  googleOAuth?: GoogleDesktopOAuthService;
  secureCookies?: boolean;
  campaigns?: EmailCampaignService;
  listCampaignUsers?: (audience: CampaignAudience) => Promise<CampaignUser[]>;
  analytics?: AdminAnalyticsPort;
  rateLimiter?: RateLimitStore;
  remote?: RemoteAccessPort;
  relaySecret?: string;
  relayBroker?: RemoteRelayBroker;
  webResearch?: WebResearchServiceType;
}

const unavailableGateway: GatewayModelClient = {
  complete() {
    return (async function* unavailableCompletion() {
      yield* [];
      throw new Error('No model gateway configured');
    })();
  },
};

export function buildApi(dependencies: ApiDependencies = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const defaultJsonParser = app.getDefaultJsonParser('error', 'error');
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, rawBody, done) => {
    const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    (request as FastifyRequest & { rawBody?: string }).rawBody = body;
    defaultJsonParser(request, body, done);
  });
  if (dependencies.rateLimiter) {
    const limits: Record<string, { limit: number; windowMs: number }> = {
      'POST /v1/auth/register': { limit: 10, windowMs: 10 * 60 * 1000 },
      'POST /v1/auth/login': { limit: 20, windowMs: 10 * 60 * 1000 },
      'POST /v1/auth/verify-email': { limit: 10, windowMs: 10 * 60 * 1000 },
      'POST /v1/auth/verify-otp': { limit: 10, windowMs: 10 * 60 * 1000 },
      'POST /v1/auth/resend-otp': { limit: 5, windowMs: 10 * 60 * 1000 },
      'POST /v1/auth/password-reset/request': { limit: 5, windowMs: 10 * 60 * 1000 },
      'POST /v1/auth/google/start': { limit: 20, windowMs: 10 * 60 * 1000 },
      'POST /v1/auth/google/exchange': { limit: 20, windowMs: 10 * 60 * 1000 },
      'POST /v1/devices/register': { limit: 10, windowMs: 10 * 60 * 1000 },
      'POST /v1/relay/grants': { limit: 30, windowMs: 10 * 60 * 1000 },
      'POST /v1/rooms/invitations/redeem': { limit: 10, windowMs: 10 * 60 * 1000 },
      'POST /v1/web/search': { limit: 30, windowMs: 10 * 60 * 1000 },
      'POST /v1/web/fetch': { limit: 30, windowMs: 10 * 60 * 1000 },
      'POST /v1/runtime/codex/token': { limit: 30, windowMs: 10 * 60 * 1000 },
      'POST /runtime/codex/v1/responses': { limit: 120, windowMs: 10 * 60 * 1000 },
    };
    const prefixedLimits: Array<{
      method: string;
      prefix: string;
      limit: number;
      windowMs: number;
    }> = [
      { method: 'POST', prefix: '/v1/rooms/', limit: 30, windowMs: 10 * 60 * 1000 },
      { method: 'POST', prefix: '/v1/admin/', limit: 60, windowMs: 10 * 60 * 1000 },
    ];
    app.addHook('onRequest', async (request, reply) => {
      const path = request.url.split('?', 1)[0] ?? '/';
      const rule =
        limits[`${request.method} ${path}`] ??
        prefixedLimits.find(
          (candidate) => candidate.method === request.method && path.startsWith(candidate.prefix),
        );
      if (!rule) return;
      const key = `http:${hashRateLimitIdentity(`${request.ip}:${request.method}:${request.url.split('?', 1)[0]}`)}`;
      const decision = await dependencies.rateLimiter?.consume(key, rule);
      if (!decision || decision.allowed) return;
      reply.header('Retry-After', Math.ceil(decision.retryAfterMs / 1000));
      return reply.code(429).send({ error: 'RATE_LIMITED' });
    });
  }
  const catalog = dependencies.catalog ?? createMemoryCatalog([]);
  const receipts = dependencies.receipts ?? createMemoryReceiptStore();
  const events = dependencies.events ?? createMemoryEventStore();
  const plans = dependencies.plans ?? createDefaultPlanCatalog();
  const billing =
    dependencies.billing ?? new BillingService({ store: new InMemoryBillingStore(), plans });
  const organizationBilling =
    dependencies.organizationBilling ??
    new OrganizationBillingService({ store: new InMemoryOrganizationBillingStore(), plans });
  const audit = dependencies.audit ?? new InMemoryAdminAuditStore();
  const admin = dependencies.admin ?? new AdminService({ billing, audit });
  const remote = dependencies.remote ?? new RemoteAccessService();
  const webResearch =
    dependencies.webResearch ??
    new WebResearchService({ provider: new UnavailableWebSearchProvider() });
  const runtimeTokens = new CodexRuntimeTokenService(
    dependencies.runtimeTokenSecret ??
      process.env.ASTRA_RUNTIME_TOKEN_SECRET ??
      randomBytes(32).toString('hex'),
  );
  app.get('/health', async () => ({ status: 'ok' }));
  void registerModelRoutes(app, {
    catalog,
    receipts,
    gateway: dependencies.gateway ?? unavailableGateway,
    ...(dependencies.auth ? { auth: dependencies.auth } : {}),
    billing,
    organizationBilling,
    developmentEntitlement: dependencies.developmentEntitlement ?? true,
  });
  void registerAgentEventRoutes(app, events);
  void registerAuthRoutes(app, {
    ...(dependencies.auth ? { auth: dependencies.auth } : {}),
    ...(dependencies.exposeDevelopmentTokens === undefined
      ? {}
      : { exposeDevelopmentTokens: dependencies.exposeDevelopmentTokens }),
    billing,
    plans,
    ...(dependencies.email ? { email: dependencies.email } : {}),
    ...(dependencies.publicSiteUrl ? { publicSiteUrl: dependencies.publicSiteUrl } : {}),
    ...(dependencies.googleOAuth ? { googleOAuth: dependencies.googleOAuth } : {}),
    secureCookies: dependencies.secureCookies ?? false,
  });
  void registerBillingRoutes(app, {
    ...(dependencies.auth ? { auth: dependencies.auth } : {}),
    billing,
    organizationBilling,
    plans,
    ...(dependencies.catalog ? { catalog } : {}),
    remote,
    receipts,
  });
  void registerAdminRoutes(app, {
    ...(dependencies.auth ? { auth: dependencies.auth } : {}),
    admin,
    audit,
    ...(dependencies.analytics ? { analytics: dependencies.analytics } : {}),
  });
  void registerEmailRoutes(app, {
    ...(dependencies.auth ? { auth: dependencies.auth } : {}),
    ...(dependencies.email ? { email: dependencies.email } : {}),
    ...(dependencies.campaigns ? { campaigns: dependencies.campaigns } : {}),
    admin,
    audit,
    ...(dependencies.listCampaignUsers
      ? { listCampaignUsers: dependencies.listCampaignUsers }
      : {}),
  });
  void registerRazorpayRoutes(app, {
    ...(dependencies.razorpay ? { webhook: dependencies.razorpay } : {}),
  });
  void registerReleaseRoutes(app, dependencies.releaseManifest);
  if (dependencies.auth) {
    void registerRemoteRoutes(app, {
      auth: dependencies.auth,
      plans,
      remote,
      ...(dependencies.relaySecret ? { relaySecret: dependencies.relaySecret } : {}),
      ...(dependencies.relayBroker ? { relayBroker: dependencies.relayBroker } : {}),
      ...(dependencies.email ? { email: dependencies.email } : {}),
      ...(dependencies.publicSiteUrl ? { publicSiteUrl: dependencies.publicSiteUrl } : {}),
      ...(dependencies.exposeDevelopmentTokens === undefined
        ? {}
        : { exposeDevelopmentTokens: dependencies.exposeDevelopmentTokens }),
    });
    void registerWebResearchRoutes(app, {
      auth: dependencies.auth,
      remote,
      webResearch,
    });
    void registerCodexRuntimeRoutes(app, {
      auth: dependencies.auth,
      catalog,
      receipts,
      billing,
      organizationBilling,
      remote,
      runtimeTokens,
      ...(dependencies.responsesGateway ? { responsesGateway: dependencies.responsesGateway } : {}),
    });
  }
  return app;
}
