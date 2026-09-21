import { randomBytes } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import {
  createMemoryCatalog,
  createMemoryEventStore,
  createMemoryReceiptStore,
  type AgentEventStore,
  type ModelCatalogStore,
  type UsageReceiptStore,
} from '@astra/db';
import type { GatewayModelClient, ResponsesGatewayClient } from '@astra/model-gateway';
import type { AuthService } from '@astra/auth';
import type { RateLimitStore } from '@astra/auth';
import { hashRateLimitIdentity } from '@astra/auth';
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
} from '@astra/billing';
import { createDefaultPlanCatalog, type PlanCatalog } from '@astra/plans';
import { registerModelRoutes } from './model-route.js';
import { registerAgentEventRoutes } from './event-route.js';
import { registerAuthRoutes } from './auth-route.js';
import { registerBillingRoutes } from './billing-route.js';
import { registerAdminRoutes } from './admin-route.js';
import { registerRazorpayRoutes } from './razorpay-route.js';
import { registerReleaseRoutes } from './release-route.js';
import { registerEmailRoutes } from './email-route.js';
import type { ReleaseManifest } from '@astra/releases';
import type { EmailService } from '@astra/email';
import type { GoogleDesktopOAuthService } from '@astra/auth';
import type { EmailCampaignService, CampaignAudience, CampaignUser } from '@astra/email';
import type {
  CommercialPolicyService,
  ControlPlaneService,
  PlatformPolicyService,
} from '@astra/control-plane';
import {
  RemoteAccessService,
  type RemoteAccessPort,
  type RemoteRelayBroker,
} from '@astra/remote-protocol';
import { registerRemoteRoutes } from './remote-route.js';
import {
  UnavailableWebSearchProvider,
  WebResearchService,
  type WebResearchService as WebResearchServiceType,
} from '@astra/web-research';
import { registerWebResearchRoutes } from './web-research-route.js';
import { CodexRuntimeTokenService } from './codex-runtime-auth.js';
import { registerCodexRuntimeRoutes } from './codex-runtime-route.js';
import { registerOrchestrationRoutes } from './orchestration-route.js';
import type { PlatformOrchestrationService } from '@astra/orchestration';

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
  controlPlane?: ControlPlaneService;
  commercial?: CommercialPolicyService;
  policy?: PlatformPolicyService;
  razorpay?: RazorpayWebhookService;
  developmentEntitlement?: boolean;
  releaseManifest?: ReleaseManifest;
  email?: EmailService;
  publicSiteUrl?: string;
  allowedOrigins?: string[];
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
  orchestration?: PlatformOrchestrationService;
  readiness?: () => Promise<{ database: 'ready' | 'unconfigured' | 'failed' }>;
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
  const app = Fastify({ logger: false, bodyLimit: 40 * 1024 * 1024 });
  const defaultJsonParser = app.getDefaultJsonParser('error', 'error');
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, rawBody, done) => {
    const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    (request as FastifyRequest & { rawBody?: string }).rawBody = body;
    defaultJsonParser(request, body, done);
  });
  const allowedOrigins = new Set(
    [
      ...(dependencies.allowedOrigins ?? []),
      ...(dependencies.publicSiteUrl ? [dependencies.publicSiteUrl] : []),
    ]
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (!origin) return;
    if (!allowedOrigins.has(origin)) {
      if (request.method === 'OPTIONS')
        return reply.code(403).send({ error: 'CORS_ORIGIN_DENIED' });
      return;
    }
    reply
      .header('Access-Control-Allow-Origin', origin)
      .header('Access-Control-Allow-Credentials', 'true')
      .header('Access-Control-Allow-Methods', 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS')
      .header('Access-Control-Allow-Headers', 'Authorization,Content-Type,Idempotency-Key')
      .header('Vary', 'Origin');
    if (request.method === 'OPTIONS') return reply.code(204).send();
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
    dependencies.billing ??
    new BillingService({
      store: new InMemoryBillingStore(),
      plans,
      ...(dependencies.controlPlane ? { controlPlane: dependencies.controlPlane } : {}),
    });
  const organizationBilling =
    dependencies.organizationBilling ??
    new OrganizationBillingService({
      store: new InMemoryOrganizationBillingStore(),
      plans,
      ...(dependencies.controlPlane ? { controlPlane: dependencies.controlPlane } : {}),
    });
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
  app.get('/ready', async (_request, reply) => {
    if (!dependencies.readiness) return reply.send({ status: 'ready', database: 'unconfigured' });
    try {
      const checks = await dependencies.readiness();
      if (checks.database !== 'ready')
        return reply.code(503).send({ status: 'not_ready', ...checks });
      return reply.send({ status: 'ready', ...checks });
    } catch {
      return reply.code(503).send({ status: 'not_ready', database: 'failed' });
    }
  });
  void registerModelRoutes(app, {
    catalog,
    receipts,
    gateway: dependencies.gateway ?? unavailableGateway,
    ...(dependencies.auth ? { auth: dependencies.auth } : {}),
    ...(dependencies.controlPlane ? { controlPlane: dependencies.controlPlane } : {}),
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
    ...(dependencies.commercial ? { commercial: dependencies.commercial } : {}),
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
    ...(dependencies.commercial ? { commercial: dependencies.commercial } : {}),
    ...(dependencies.controlPlane ? { controlPlane: dependencies.controlPlane } : {}),
    remote,
    receipts,
  });
  void registerAdminRoutes(app, {
    ...(dependencies.auth ? { auth: dependencies.auth } : {}),
    admin,
    audit,
    ...(dependencies.controlPlane ? { controlPlane: dependencies.controlPlane } : {}),
    ...(dependencies.commercial ? { commercial: dependencies.commercial } : {}),
    ...(dependencies.policy ? { policy: dependencies.policy } : {}),
    remote,
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
  void registerReleaseRoutes(app, dependencies.releaseManifest, dependencies.policy);
  if (dependencies.auth) {
    void registerRemoteRoutes(app, {
      auth: dependencies.auth,
      plans,
      remote,
      ...(dependencies.relaySecret ? { relaySecret: dependencies.relaySecret } : {}),
      ...(dependencies.relayBroker ? { relayBroker: dependencies.relayBroker } : {}),
      ...(dependencies.policy ? { policy: dependencies.policy } : {}),
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
      ...(dependencies.policy ? { policy: dependencies.policy } : {}),
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
    if (dependencies.orchestration)
      void registerOrchestrationRoutes(app, {
        auth: dependencies.auth,
        orchestration: dependencies.orchestration,
      });
  }
  return app;
}
