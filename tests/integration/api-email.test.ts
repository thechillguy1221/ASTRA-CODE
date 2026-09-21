import { describe, expect, it } from 'vitest';
import { buildApi } from '@astra/api';
import { AuthService, InMemoryAuthStore } from '@astra/auth';
import {
  EmailCampaignService,
  EmailService,
  InMemoryEmailCampaignStore,
  InMemoryEmailProvider,
  InMemoryEmailSenderStore,
} from '@astra/email';

describe('email administration API', () => {
  it('creates, previews, and sends a server-filtered campaign exactly once', async () => {
    const authStore = new InMemoryAuthStore();
    const auth = new AuthService({ store: authStore });
    const registration = await auth.register({
      email: 'campaign-admin@example.test',
      password: 'correct horse battery staple',
      device: {
        label: 'Astra web admin',
        platform: 'web',
        architecture: 'browser',
        appVersion: 'web',
      },
    });
    await auth.verifyEmail(registration.verificationToken);
    await authStore.updateUser({
      ...(await authStore.getUser(registration.user.id))!,
      role: 'SUPER_ADMIN',
    });
    const login = await auth.login({
      email: 'campaign-admin@example.test',
      password: 'correct horse battery staple',
      device: {
        label: 'Astra web admin',
        platform: 'web',
        architecture: 'browser',
        appVersion: 'web',
      },
    });
    const provider = new InMemoryEmailProvider();
    const email = new EmailService({ provider });
    const campaigns = new EmailCampaignService({
      email,
      store: new InMemoryEmailCampaignStore(),
    });
    const app = buildApi({
      auth,
      email,
      campaigns,
      listCampaignUsers: async () => [
        {
          userId: 'eligible',
          email: 'eligible@example.test',
          firstName: 'Ada',
          planId: 'FREE',
          verified: true,
          marketingAllowed: true,
          active: true,
        },
        {
          userId: 'suppressed',
          email: 'suppressed@example.test',
          planId: 'FREE',
          verified: true,
          marketingAllowed: false,
          active: true,
        },
      ],
    });
    const created = await app.inject({
      method: 'POST',
      url: '/v1/admin/email/campaigns',
      headers: { authorization: `Bearer ${login.accessToken}` },
      payload: {
        name: 'Verification campaign',
        subject: 'Astra update',
        html: '<p>Hello {{first_name}}</p>',
        audience: { planId: 'FREE' },
      },
    });
    expect(created.statusCode).toBe(201);
    const campaignId = created.json().campaign.id as string;
    const testEmail = await app.inject({
      method: 'POST',
      url: '/v1/admin/email/test',
      headers: { authorization: `Bearer ${login.accessToken}` },
      payload: { subject: 'Test', html: '<p>Test</p>' },
    });
    expect(testEmail.statusCode).toBe(200);
    expect(testEmail.json().delivery.status).toBe('SENT');
    const preview = await app.inject({
      method: 'GET',
      url: `/v1/admin/email/campaigns/${campaignId}/preview`,
      headers: { authorization: `Bearer ${login.accessToken}` },
    });
    expect(preview.json()).toEqual({ eligibleRecipients: 1, suppressedRecipients: 1 });
    const send = await app.inject({
      method: 'POST',
      url: `/v1/admin/email/campaigns/${campaignId}/send`,
      headers: { authorization: `Bearer ${login.accessToken}` },
    });
    expect(send.json()).toEqual({ sent: 1, suppressed: 1 });
    const retry = await app.inject({
      method: 'POST',
      url: `/v1/admin/email/campaigns/${campaignId}/send`,
      headers: { authorization: `Bearer ${login.accessToken}` },
    });
    expect(retry.json()).toEqual({ sent: 0, suppressed: 1 });
    expect(provider.messages).toHaveLength(2);
  });

  it('lets an authorized admin manage approved sender identities', async () => {
    const authStore = new InMemoryAuthStore();
    const auth = new AuthService({ store: authStore });
    const registration = await auth.register({
      email: 'sender-admin@example.test',
      password: 'correct horse battery staple',
      device: {
        label: 'Astra web admin',
        platform: 'web',
        architecture: 'browser',
        appVersion: 'web',
      },
    });
    await auth.verifyEmail(registration.verificationToken);
    await authStore.updateUser({
      ...(await authStore.getUser(registration.user.id))!,
      role: 'SUPER_ADMIN',
    });
    const login = await auth.login({
      email: 'sender-admin@example.test',
      password: 'correct horse battery staple',
      device: {
        label: 'Astra web admin',
        platform: 'web',
        architecture: 'browser',
        appVersion: 'web',
      },
    });
    const email = new EmailService({
      provider: new InMemoryEmailProvider(),
      senderStore: new InMemoryEmailSenderStore(),
    });
    const app = buildApi({ auth, email });

    const invalid = await app.inject({
      method: 'PUT',
      url: '/v1/admin/email/senders/SECURITY',
      headers: { authorization: `Bearer ${login.accessToken}` },
      payload: { fromAddress: 'Astra\r\nBcc: attacker@example.test' },
    });
    expect(invalid.statusCode).toBe(400);

    const update = await app.inject({
      method: 'PUT',
      url: '/v1/admin/email/senders/SECURITY',
      headers: { authorization: `Bearer ${login.accessToken}` },
      payload: {
        fromAddress: 'Astra Security <security@example.test>',
        replyTo: 'security@example.test',
      },
    });
    expect(update.statusCode).toBe(200);
    expect(update.json().sender.fromAddress).toBe('Astra Security <security@example.test>');

    const list = await app.inject({
      method: 'GET',
      url: '/v1/admin/email/senders',
      headers: { authorization: `Bearer ${login.accessToken}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().senders).toContainEqual(
      expect.objectContaining({
        kind: 'SECURITY',
        fromAddress: 'Astra Security <security@example.test>',
      }),
    );
  });
});
