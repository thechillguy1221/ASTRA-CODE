import { describe, expect, it } from 'vitest';
import {
  EmailCampaignService,
  EmailService,
  InMemoryEmailCampaignStore,
  InMemoryEmailProvider,
} from '@astra/email';

describe('email campaign safety', () => {
  it('filters opted-out users and makes retries idempotent', async () => {
    const provider = new InMemoryEmailProvider();
    const email = new EmailService({ provider });
    const campaigns = new EmailCampaignService({ email, store: new InMemoryEmailCampaignStore() });
    const campaign = await campaigns.create({
      name: 'Free users',
      subject: 'Astra update',
      previewText: 'Update',
      html: '<p>Hello {{first_name}}</p>',
      audience: { planId: 'FREE' },
      createdBy: 'admin-1',
    });
    const users = [
      {
        userId: 'u1',
        email: 'one@example.com',
        firstName: 'One',
        planId: 'FREE',
        verified: true,
        marketingAllowed: true,
        active: true,
      },
      {
        userId: 'u2',
        email: 'two@example.com',
        firstName: 'Two',
        planId: 'FREE',
        verified: true,
        marketingAllowed: false,
        active: true,
      },
      {
        userId: 'u3',
        email: 'three@example.com',
        firstName: 'Three',
        planId: 'PRO',
        verified: true,
        marketingAllowed: true,
        active: true,
      },
    ];
    const preview = await campaigns.previewById(campaign.id, users);
    expect(preview.eligible.map((user) => user.userId)).toEqual(['u1']);
    expect(preview.suppressed.map((user) => user.userId)).toEqual(['u2', 'u3']);
    expect(await campaigns.send(campaign.id, users)).toEqual({ sent: 1, suppressed: 2 });
    expect(await campaigns.send(campaign.id, users)).toEqual({ sent: 0, suppressed: 2 });
    expect(provider.messages).toHaveLength(1);
    expect(provider.messages[0]?.html).toContain('One');
  });
});
