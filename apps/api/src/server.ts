import { assertProductionConfiguration, loadConfig } from '@astra/config';
import {
  applyFoundationMigration,
  createPostgresStores,
  listPostgresCampaignUsers,
  loadPlanCatalog,
  PostgresPaymentStore,
} from '@astra/db';
import { VercelGatewayClient, VercelResponsesGatewayClient } from '@astra/model-gateway';
import {
  AuthService,
  GoogleDesktopOAuthService,
  GoogleOidcProvider,
  InMemoryAuthStore,
  InMemoryOAuthTransactionStore,
  ensureSuperAdmin,
} from '@astra/auth';
import {
  BillingService,
  InMemoryBillingStore,
  InMemoryOrganizationBillingStore,
  OrganizationBillingService,
  InMemoryPaymentStore,
  RazorpayWebhookService,
} from '@astra/billing';
import { createDefaultPlanCatalog } from '@astra/plans';
import {
  RemoteAccessService,
  RemoteRelayBroker,
  WebSocketRelayServer,
} from '@astra/remote-protocol';
import { buildApi } from './app.js';
import {
  EmailCampaignService,
  EmailService,
  InMemoryEmailCampaignStore,
  InMemoryEmailPreferenceStore,
  ResendEmailProvider,
} from '@astra/email';

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
        ...(postgres ? { senderStore: postgres.emailSenders } : {}),
        ...(config.emailFrom ? { fallbackSender: { fromAddress: config.emailFrom } } : {}),
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
const organizationBilling = new OrganizationBillingService({
  store: postgres?.organizationBilling ?? new InMemoryOrganizationBillingStore(),
  plans,
});
const remote = postgres?.remote ?? new RemoteAccessService();
const relayBroker = config.relaySecret ? new RemoteRelayBroker(config.relaySecret) : undefined;
const payments = postgres ? new PostgresPaymentStore(postgres.pool) : new InMemoryPaymentStore();
const razorpay = config.razorpayWebhookSecret
  ? new RazorpayWebhookService({
      secret: config.razorpayWebhookSecret,
      payments,
      billing,
      organizationBilling,
      plans,
      onOrganizationEntitlementChanged: async (
        organizationId,
        actorUserId,
        planId,
        status,
        eventId,
      ) => {
        await remote.setOrganizationEntitlement({
          organizationId,
          actorUserId,
          plan: (() => {
            const plan = plans.get(planId);
            return {
              id: plan.id,
              seats: plan.seats,
              monthlyCredits: plan.monthlyCredits,
              pooledCredits: plan.pooledCredits,
              crossPersonRooms: plan.crossPersonRooms,
            };
          })(),
          status,
          reason: `Razorpay webhook ${eventId}`,
        });
      },
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
const responsesGateway =
  config.modelGatewayBaseUrl && config.modelGatewayApiKey
    ? new VercelResponsesGatewayClient({
        baseUrl: config.modelGatewayBaseUrl,
        apiKey: config.modelGatewayApiKey,
      })
    : undefined;
const app = buildApi({
  ...(postgres
    ? { catalog: postgres.catalog, receipts: postgres.receipts, events: postgres.events }
    : {}),
  ...(gateway ? { gateway } : {}),
  ...(responsesGateway ? { responsesGateway } : {}),
  ...(config.runtimeTokenSecret ? { runtimeTokenSecret: config.runtimeTokenSecret } : {}),
  auth,
  billing,
  organizationBilling,
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
  remote,
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
await app.listen({ port: config.apiPort, host: config.apiHost });
