import { describe, expect, it } from 'vitest';
import {
  EmailService,
  InMemoryEmailPreferenceStore,
  InMemoryEmailProvider,
  renderTemplate,
  sanitizeEmailHtml,
} from '@lyntar/email';

describe('Astra email infrastructure', () => {
  it('renders escaped template variables and rejects active HTML content', () => {
    expect(renderTemplate('<p>Hello {{first_name}}</p>', { first_name: '<Ada>' })).toBe(
      '<p>Hello &lt;Ada&gt;</p>',
    );
    expect(() => sanitizeEmailHtml('<img src="javascript:alert(1)">')).toThrow();
    expect(() => sanitizeEmailHtml('<script>alert(1)</script>')).toThrow();
    expect(sanitizeEmailHtml('<p>Safe</p>')).toBe('<p>Safe</p>');
  });

  it('keeps transactional mail separate from opted-out marketing and is idempotent', async () => {
    const provider = new InMemoryEmailProvider();
    const preferences = new InMemoryEmailPreferenceStore();
    const email = new EmailService({ provider, preferences });
    await email.setMarketingPreference('user-1', false);
    const verification = await email.sendVerificationOtp({
      userId: 'user-1',
      email: 'user@example.com',
      otp: '123456',
    });
    expect(verification.status).toBe('SENT');
    const campaign = await email.send({
      kind: 'marketing',
      userId: 'user-1',
      to: 'user@example.com',
      verified: true,
      unsubscribed: true,
      subject: 'Astra update',
      html: '<p>Update</p>',
      templateId: 'campaign.test',
      idempotencyKey: 'campaign:user-1:1',
    });
    expect(campaign.status).toBe('SUPPRESSED');
    expect(
      (
        await email.sendVerificationOtp({
          userId: 'user-1',
          email: 'user@example.com',
          otp: '123456',
        })
      ).providerMessageId,
    ).toBe(verification.providerMessageId);
    expect(provider.messages).toHaveLength(1);
  });

  it('renders password reset links as transactional mail with a stable delivery key', async () => {
    const provider = new InMemoryEmailProvider();
    const email = new EmailService({ provider });
    const first = await email.sendPasswordReset({
      userId: 'user-1',
      email: 'user@example.com',
      resetUrl: 'https://astra.example/reset-password?token=opaque',
    });
    const second = await email.sendPasswordReset({
      userId: 'user-1',
      email: 'user@example.com',
      resetUrl: 'https://astra.example/reset-password?token=opaque',
    });
    expect(first).toEqual(second);
    expect(provider.messages[0]?.html).toContain(
      'https://astra.example/reset-password?token=opaque',
    );
    expect(provider.messages).toHaveLength(1);
  });
});
