import { describe, expect, it } from 'vitest';
import {
  EmailService,
  InMemoryEmailSenderStore,
  InMemoryEmailPreferenceStore,
  InMemoryEmailProvider,
  renderTemplate,
  sanitizeEmailHtml,
} from '@astra/email';

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

  it('resolves an approved sender identity server-side before delivery', async () => {
    const provider = new InMemoryEmailProvider();
    const senders = new InMemoryEmailSenderStore();
    await senders.upsert({
      kind: 'SECURITY',
      fromAddress: 'Astra Security <security@example.test>',
      replyTo: 'security@example.test',
      updatedBy: 'super-admin',
    });
    const email = new EmailService({ provider, senderStore: senders });

    await email.send({
      kind: 'transactional',
      senderKind: 'SECURITY',
      to: 'user@example.test',
      verified: true,
      unsubscribed: false,
      subject: 'Security notice',
      html: '<p>Notice</p>',
      templateId: 'security.notice',
      idempotencyKey: 'security:notice:1',
    });

    expect(provider.messages[0]).toMatchObject({
      fromAddress: 'Astra Security <security@example.test>',
      replyTo: 'security@example.test',
    });
  });

  it('rejects header injection in approved sender identities', async () => {
    const senders = new InMemoryEmailSenderStore();
    await expect(
      senders.upsert({
        kind: 'DEFAULT',
        fromAddress: 'Astra\r\nBcc: attacker@example.test',
        updatedBy: 'super-admin',
      }),
    ).rejects.toThrow(/sender address/i);
  });
});
