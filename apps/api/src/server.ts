import { loadConfig } from '@lyntar/config';
import {
  applyFoundationMigration,
  createPostgresStores,
  loadPlanCatalog,
  PostgresPaymentStore,
} from '@lyntar/db';
import { VercelGatewayClient } from '@lyntar/model-gateway';
import { AuthService, InMemoryAuthStore } from '@lyntar/auth';
import {
  BillingService,
  InMemoryBillingStore,
  InMemoryPaymentStore,
  RazorpayWebhookService,
} from '@lyntar/billing';
import { createDefaultPlanCatalog } from '@lyntar/plans';
import { buildApi } from './app.js';

const config = loadConfig();
const postgres = config.databaseUrl ? createPostgresStores(config.databaseUrl) : undefined;
if (postgres) {
  const client = await postgres.pool.connect();
  try {
    await applyFoundationMigration(client);
  } finally {
    client.release();
  }
}
const plans = postgres
  ? await loadPlanCatalog(postgres.pool, createDefaultPlanCatalog())
  : createDefaultPlanCatalog();
const auth = new AuthService({ store: postgres?.auth ?? new InMemoryAuthStore() });
const billing = new BillingService({
  store: postgres?.billing ?? new InMemoryBillingStore(),
  plans,
});
const payments = postgres ? new PostgresPaymentStore(postgres.pool) : new InMemoryPaymentStore();
const razorpay = config.razorpayWebhookSecret
  ? new RazorpayWebhookService({
      secret: config.razorpayWebhookSecret,
      payments,
      billing,
      plans,
      onPlanGranted: async (userId, planId) => {
        await auth.assignPlan(userId, planId);
      },
    })
  : undefined;
const gateway =
  config.modelGatewayBaseUrl && config.modelGatewayApiKey
    ? new VercelGatewayClient({
        baseUrl: config.modelGatewayBaseUrl,
        apiKey: config.modelGatewayApiKey,
      })
    : undefined;
const app = buildApi({
  ...(postgres
    ? { catalog: postgres.catalog, receipts: postgres.receipts, events: postgres.events }
    : {}),
  ...(gateway ? { gateway } : {}),
  auth,
  billing,
  plans,
  ...(razorpay ? { razorpay } : {}),
  developmentEntitlement: config.developmentEntitlement,
});
if (postgres) app.addHook('onClose', async () => postgres.pool.end());
await app.listen({ port: config.apiPort, host: '127.0.0.1' });
