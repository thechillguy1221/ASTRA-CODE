import { assertProductionConfiguration, loadConfig } from '@lyntar/config';
import {
  applyFoundationMigration,
  createPostgresStores,
  listPostgresCampaignUsers,
  loadPlanCatalog,
  PostgresPaymentStore,
} from '@lyntar/db';
import { VercelGatewayClient } from '@lyntar/model-gateway';
import {
  AuthService,
  GoogleDesktopOAuthService,
  GoogleOidcProvider,
  InMemoryAuthStore,
  InMemoryOAuthTransactionStore,
  ensureSuperAdmin,
} from '@lyntar/auth';
import {
  BillingService,
  InMemoryBillingStore,
  InMemoryPaymentStore,
  RazorpayWebhookService,
} from '@lyntar/billing';
import { createDefaultPlanCatalog } from '@lyntar/plans';
import {
  RemoteAccessService,
  RemoteRelayBroker,
  WebSocketRelayServer,
} from '@lyntar/remote-protocol';
import { buildApi } from './app.js';
import {
  EmailCampaignService,
  EmailService,
  InMemoryEmailCampaignStore,
  InMemoryEmailPreferenceStore,
  ResendEmailProvider,
} from '@lyntar/email';

const config = loadConfig();
assertProductionConfiguration(config);
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
const authStore = postgres?.auth ?? new InMemoryAuthStore();
const auth = new AuthService({
  store: authStore,
  ...(postgres ? { rateLimiter: postgres.rateLimiter } : {}),
});
await ensureSuperAdmin({
  store: authStore,
  ...(config.superAdminEmail ? { email: config.superAdminEmail } : {}),
  ...(config.superAdminPasswordHash ? { passwordVerifier: config.superAdminPasswordHash } : {}),
});
const email =
  config.resendApiKey && config.emailFrom
    ? new EmailService({
        provider: new ResendEmailProvider({
          apiKey: config.resendApiKey,
          fromAddress: config.emailFrom,
        }),
        preferences: postgres?.emailPreferences ?? new InMemoryEmailPreferenceStore(),
        ...(postgres ? { deliveries: postgres.emailDeliveries } : {}),
      })
    : undefined;
const campaigns = email
  ? new EmailCampaignService({
      email,
      store: postgres?.emailCampaigns ?? new InMemoryEmailCampaignStore(),
    })
  : undefined;
const googleOAuth =
  config.googleClientId && config.googleClientSecret && config.googleRedirectUri
    ? new GoogleDesktopOAuthService({
        provider: new GoogleOidcProvider({
          clientId: config.googleClientId,
          clientSecret: config.googleClientSecret,
        }),
        auth,
        store: postgres?.oauth ?? new InMemoryOAuthTransactionStore(),
        redirectUri: config.googleRedirectUri,
        desktopCallbackUri: config.googleDesktopCallbackUri,
      })
    : undefined;
const billing = new BillingService({
  store: postgres?.billing ?? new InMemoryBillingStore(),
  plans,
});
const relayBroker = config.relaySecret ? new RemoteRelayBroker(config.relaySecret) : undefined;
const payments = postgres ? new PostgresPaymentStore(postgres.pool) : new InMemoryPaymentStore();
const razorpay = config.razorpayWebhookSecret
  ? new RazorpayWebhookService({
      secret: config.razorpayWebhookSecret,
      payments,
      billing,
      plans,
      onPlanGranted: async (userId, planId, eventId) => {
        await auth.assignPlan(userId, planId);
        const user = await auth.getUserById(userId);
        if (email && user) {
          await email.sendSubscriptionActivated({
            userId,
            email: user.email,
            planName: plans.get(planId).displayName,
            eventKey: eventId,
          });
        }
      },
      onSubscriptionCancelled: async (userId, _planId, eventId) => {
        await auth.assignPlan(userId, 'FREE');
        const user = await auth.getUserById(userId);
        if (email && user)
          await email.sendSubscriptionCancelled({ userId, email: user.email, eventKey: eventId });
      },
      onSubscriptionHalted: async (userId, _planId, eventId) => {
        await auth.assignPlan(userId, 'FREE');
        const user = await auth.getUserById(userId);
        if (email && user)
          await email.sendSubscriptionCancelled({ userId, email: user.email, eventKey: eventId });
      },
      onPaymentFailed: async (userId, eventId) => {
        const user = await auth.getUserById(userId);
        if (email && user) {
          await email.sendPaymentFailed({
            userId,
            email: user.email,
            eventKey: eventId,
            ...(config.publicSiteUrl
              ? { billingUrl: `${config.publicSiteUrl}/account/billing` }
              : {}),
          });
        }
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
  ...(email ? { email } : {}),
  ...(config.publicSiteUrl ? { publicSiteUrl: config.publicSiteUrl } : {}),
  secureCookies: config.secureCookies,
  ...(campaigns ? { campaigns } : {}),
  ...(postgres
    ? {
        listCampaignUsers: (audience: Parameters<typeof listPostgresCampaignUsers>[1]) =>
          listPostgresCampaignUsers(postgres.pool, audience),
      }
    : {}),
  ...(googleOAuth ? { googleOAuth } : {}),
  ...(postgres ? { analytics: postgres.analytics } : {}),
  ...(postgres ? { audit: postgres.audit } : {}),
  ...(postgres ? { rateLimiter: postgres.rateLimiter } : {}),
  remote: postgres?.remote ?? new RemoteAccessService(),
  ...(config.relaySecret ? { relaySecret: config.relaySecret } : {}),
  ...(relayBroker ? { relayBroker } : {}),
  developmentEntitlement: config.developmentEntitlement,
});
const relay = config.relaySecret
  ? new WebSocketRelayServer(relayBroker as RemoteRelayBroker, {
      requireTls: config.relayRequireTls,
    })
  : undefined;
if (relay) relay.attach(app.server);
if (postgres) app.addHook('onClose', async () => postgres.pool.end());
if (relay) app.addHook('onClose', async () => relay.close());
await app.listen({ port: config.apiPort, host: '127.0.0.1' });
