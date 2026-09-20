import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import {
  createMemoryCatalog,
  createMemoryEventStore,
  createMemoryReceiptStore,
  type AgentEventStore,
  type ModelCatalogStore,
  type UsageReceiptStore,
} from '@lyntar/db';
import type { GatewayModelClient } from '@lyntar/model-gateway';
import type { AuthService } from '@lyntar/auth';
import {
  AdminService,
  BillingService,
  InMemoryAdminAuditStore,
  InMemoryBillingStore,
  type RazorpayWebhookService,
} from '@lyntar/billing';
import { createDefaultPlanCatalog, type PlanCatalog } from '@lyntar/plans';
import { registerModelRoutes } from './model-route.js';
import { registerAgentEventRoutes } from './event-route.js';
import { registerAuthRoutes } from './auth-route.js';
import { registerBillingRoutes } from './billing-route.js';
import { registerAdminRoutes } from './admin-route.js';
import { registerRazorpayRoutes } from './razorpay-route.js';
import { registerReleaseRoutes } from './release-route.js';
import type { ReleaseManifest } from '@lyntar/releases';

export interface ApiDependencies {
  catalog?: ModelCatalogStore;
  receipts?: UsageReceiptStore;
  events?: AgentEventStore;
  gateway?: GatewayModelClient;
  auth?: AuthService;
  exposeDevelopmentTokens?: boolean;
  billing?: BillingService;
  plans?: PlanCatalog;
  admin?: AdminService;
  razorpay?: RazorpayWebhookService;
  developmentEntitlement?: boolean;
  releaseManifest?: ReleaseManifest;
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
  const catalog = dependencies.catalog ?? createMemoryCatalog([]);
  const receipts = dependencies.receipts ?? createMemoryReceiptStore();
  const events = dependencies.events ?? createMemoryEventStore();
  const plans = dependencies.plans ?? createDefaultPlanCatalog();
  const billing =
    dependencies.billing ?? new BillingService({ store: new InMemoryBillingStore(), plans });
  const audit = new InMemoryAdminAuditStore();
  const admin = dependencies.admin ?? new AdminService({ billing, audit });
  app.get('/health', async () => ({ status: 'ok' }));
  void registerModelRoutes(app, {
    catalog,
    receipts,
    gateway: dependencies.gateway ?? unavailableGateway,
    ...(dependencies.auth ? { auth: dependencies.auth } : {}),
    billing,
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
  });
  void registerBillingRoutes(app, {
    ...(dependencies.auth ? { auth: dependencies.auth } : {}),
    billing,
    plans,
    ...(dependencies.catalog ? { catalog } : {}),
  });
  void registerAdminRoutes(app, {
    ...(dependencies.auth ? { auth: dependencies.auth } : {}),
    admin,
    audit,
  });
  void registerRazorpayRoutes(app, {
    ...(dependencies.razorpay ? { webhook: dependencies.razorpay } : {}),
  });
  void registerReleaseRoutes(app, dependencies.releaseManifest);
  return app;
}
