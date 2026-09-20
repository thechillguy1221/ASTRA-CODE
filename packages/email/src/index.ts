import { createHash, randomUUID } from 'node:crypto';

export type EmailKind = 'transactional' | 'marketing';

export interface EmailRecipientState {
  verified: boolean;
  unsubscribed: boolean;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  fromAddress: string;
}

export interface EmailMessage {
  kind: EmailKind;
  to: string;
  subject: string;
  html: string;
  text?: string;
  templateId: string;
  idempotencyKey: string;
  userId?: string;
}

export interface EmailDelivery {
  provider: string;
  providerMessageId: string | null;
  status: 'SENT' | 'FAILED' | 'SUPPRESSED';
  createdAt: string;
  errorCode?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<{ providerMessageId: string | null }>;
}

export interface EmailDeliveryStore {
  get(idempotencyKey: string): Promise<EmailDelivery | undefined>;
  save(
    idempotencyKey: string,
    delivery: EmailDelivery,
    metadata: { userId?: string; kind: EmailKind; templateId: string },
  ): Promise<void>;
}

export class EmailPolicy {
  canSend(input: { kind: EmailKind } & EmailRecipientState): boolean {
    if (input.kind === 'transactional') return true;
    return input.verified && !input.unsubscribed;
  }
}

export class SuppressionList {
  private readonly addresses = new Set<string>();

  suppress(address: string): void {
    this.addresses.add(address.trim().toLowerCase());
  }

  isSuppressed(address: string): boolean {
    return this.addresses.has(address.trim().toLowerCase());
  }
}

export type EmailTemplateVariables = Record<string, string | number | null | undefined>;

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderTemplate(template: string, variables: EmailTemplateVariables): string {
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, name: string) =>
    escapeHtml(String(variables[name] ?? '')),
  );
}

export function sanitizeEmailHtml(html: string): string {
  const unsafe =
    /<\s*(script|iframe|object|embed|form|style|link|meta)\b|\bon[a-z]+\s*=|(?:javascript|vbscript|data)\s*:/i;
  if (unsafe.test(html)) throw new Error('Email HTML contains an unsafe element or URL');
  return html;
}

export class InMemoryEmailProvider implements EmailProvider {
  readonly name = 'deterministic-test-provider';
  readonly messages: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<{ providerMessageId: string }> {
    this.messages.push(message);
    return { providerMessageId: `test-${this.messages.length}` };
  }
}

export class InMemoryEmailDeliveryStore implements EmailDeliveryStore {
  private readonly values = new Map<string, EmailDelivery>();

  async get(idempotencyKey: string): Promise<EmailDelivery | undefined> {
    return this.values.get(idempotencyKey);
  }

  async save(idempotencyKey: string, delivery: EmailDelivery): Promise<void> {
    this.values.set(idempotencyKey, delivery);
  }
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';

  constructor(
    private readonly options: {
      apiKey: string;
      fromAddress: string;
      endpoint?: string;
      fetchImpl?: typeof fetch;
    },
  ) {}

  async send(message: EmailMessage): Promise<{ providerMessageId: string | null }> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const response = await fetchImpl(this.options.endpoint ?? 'https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': message.idempotencyKey,
      },
      body: JSON.stringify({
        from: this.options.fromAddress,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        ...(message.text ? { text: message.text } : {}),
      }),
    });
    if (!response.ok) throw new Error(`Resend request failed with ${response.status}`);
    const body = (await response.json()) as { id?: unknown };
    return { providerMessageId: typeof body.id === 'string' ? body.id : null };
  }
}

export interface EmailPreferenceStore {
  get(
    userId: string,
  ): Promise<{ marketingAllowed: boolean; unsubscribedAt: string | null } | undefined>;
  set(
    userId: string,
    value: { marketingAllowed: boolean; unsubscribedAt: string | null },
  ): Promise<void>;
}

export class InMemoryEmailPreferenceStore implements EmailPreferenceStore {
  readonly values = new Map<string, { marketingAllowed: boolean; unsubscribedAt: string | null }>();

  async get(
    userId: string,
  ): Promise<{ marketingAllowed: boolean; unsubscribedAt: string | null } | undefined> {
    return this.values.get(userId);
  }

  async set(
    userId: string,
    value: { marketingAllowed: boolean; unsubscribedAt: string | null },
  ): Promise<void> {
    this.values.set(userId, value);
  }
}

export class EmailService {
  private readonly deliveries = new Map<string, EmailDelivery>();
  private readonly policy = new EmailPolicy();
  private readonly suppression = new SuppressionList();

  constructor(
    private readonly options: {
      provider: EmailProvider;
      preferences?: EmailPreferenceStore;
      deliveries?: EmailDeliveryStore;
      now?: () => Date;
    },
  ) {}

  async send(input: EmailMessage & EmailRecipientState): Promise<EmailDelivery> {
    const existing =
      this.deliveries.get(input.idempotencyKey) ??
      (await this.options.deliveries?.get(input.idempotencyKey));
    if (existing) return existing;
    if (this.suppression.isSuppressed(input.to) || !this.policy.canSend(input)) {
      const delivery: EmailDelivery = {
        provider: this.options.provider.name,
        providerMessageId: null,
        status: 'SUPPRESSED',
        createdAt: this.now().toISOString(),
      };
      await this.saveDelivery(input, delivery);
      return delivery;
    }
    let result: { providerMessageId: string | null };
    try {
      result = await this.options.provider.send({
        kind: input.kind,
        to: input.to,
        subject: input.subject,
        html: sanitizeEmailHtml(input.html),
        ...(input.text ? { text: input.text } : {}),
        templateId: input.templateId,
        idempotencyKey: input.idempotencyKey,
        ...(input.userId ? { userId: input.userId } : {}),
      });
    } catch {
      const delivery: EmailDelivery = {
        provider: this.options.provider.name,
        providerMessageId: null,
        status: 'FAILED',
        errorCode: 'provider_error',
        createdAt: this.now().toISOString(),
      };
      await this.saveDelivery(input, delivery);
      return delivery;
    }
    const delivery: EmailDelivery = {
      provider: this.options.provider.name,
      providerMessageId: result.providerMessageId,
      status: 'SENT',
      createdAt: this.now().toISOString(),
    };
    await this.saveDelivery(input, delivery);
    return delivery;
  }

  async sendVerificationOtp(input: {
    userId: string;
    email: string;
    otp: string;
  }): Promise<EmailDelivery> {
    return this.send({
      kind: 'transactional',
      userId: input.userId,
      to: input.email,
      verified: true,
      unsubscribed: false,
      subject: 'Your Astra AI verification code',
      html: `<p>Use this Astra AI verification code:</p><p><strong>${escapeHtml(input.otp)}</strong></p><p>This code expires soon and can only be used once.</p>`,
      templateId: 'auth.email_verification_otp',
      idempotencyKey: `auth:otp:${input.userId}:${input.otp}`,
    });
  }

  async sendWelcome(input: { userId: string; email: string }): Promise<EmailDelivery> {
    return this.send({
      kind: 'transactional',
      userId: input.userId,
      to: input.email,
      verified: true,
      unsubscribed: false,
      subject: 'Welcome to Astra AI',
      html: '<p>Welcome to Astra AI.</p><p>Build it. Understand it. Ship it.</p>',
      templateId: 'auth.welcome',
      idempotencyKey: `auth:welcome:${input.userId}`,
    });
  }

  async sendPasswordReset(input: {
    userId: string;
    email: string;
    resetUrl: string;
  }): Promise<EmailDelivery> {
    return this.send({
      kind: 'transactional',
      userId: input.userId,
      to: input.email,
      verified: true,
      unsubscribed: false,
      subject: 'Reset your Astra AI password',
      html: `<p>We received a request to reset your Astra AI password.</p><p><a href="${escapeHtml(input.resetUrl)}">Choose a new password</a></p><p>This link expires soon and can only be used once.</p>`,
      templateId: 'auth.password_reset',
      idempotencyKey: `auth:password-reset:${input.userId}:${hashForEmailKey(input.resetUrl)}`,
    });
  }

  async sendSubscriptionActivated(input: {
    userId: string;
    email: string;
    planName: string;
    eventKey: string;
  }): Promise<EmailDelivery> {
    return this.send({
      kind: 'transactional',
      userId: input.userId,
      to: input.email,
      verified: true,
      unsubscribed: false,
      subject: `Your Astra AI ${input.planName} plan is active`,
      html: `<p>Your Astra AI ${escapeHtml(input.planName)} plan is now active.</p><p>Your account and credits have been updated by the verified billing event.</p>`,
      templateId: 'billing.subscription_activated',
      idempotencyKey: `billing:subscription-activated:${input.eventKey}`,
    });
  }

  async sendSubscriptionCancelled(input: {
    userId: string;
    email: string;
    eventKey: string;
  }): Promise<EmailDelivery> {
    return this.send({
      kind: 'transactional',
      userId: input.userId,
      to: input.email,
      verified: true,
      unsubscribed: false,
      subject: 'Your Astra AI subscription was cancelled',
      html: '<p>Your Astra AI subscription cancellation was confirmed.</p><p>Any entitlement change shown in your account is based on the verified billing state.</p>',
      templateId: 'billing.subscription_cancelled',
      idempotencyKey: `billing:subscription-cancelled:${input.eventKey}`,
    });
  }

  async sendPaymentFailed(input: {
    userId: string;
    email: string;
    eventKey: string;
    billingUrl?: string;
  }): Promise<EmailDelivery> {
    const billingLink = input.billingUrl
      ? `<p><a href="${escapeHtml(input.billingUrl)}">Review billing</a></p>`
      : '';
    return this.send({
      kind: 'transactional',
      userId: input.userId,
      to: input.email,
      verified: true,
      unsubscribed: false,
      subject: 'Astra AI payment needs attention',
      html: `<p>Astra AI could not confirm your payment.</p>${billingLink}<p>Check your billing account for the current subscription state.</p>`,
      templateId: 'billing.payment_failed',
      idempotencyKey: `billing:payment-failed:${input.eventKey}`,
    });
  }

  async sendRoomInvitation(input: {
    email: string;
    roomName: string;
    inviteUrl: string;
    eventKey: string;
  }): Promise<EmailDelivery> {
    return this.send({
      kind: 'transactional',
      to: input.email,
      verified: true,
      unsubscribed: false,
      subject: `You were invited to an Astra AI Room`,
      html: `<p>You have been invited to join the Astra AI Room <strong>${escapeHtml(input.roomName)}</strong>.</p><p><a href="${escapeHtml(input.inviteUrl)}">Join Room</a></p><p>This invitation expires according to the Room policy and can only be redeemed by the invited email address.</p>`,
      templateId: 'remote.room_invitation',
      idempotencyKey: `remote:room-invitation:${input.eventKey}`,
    });
  }

  async setMarketingPreference(userId: string, allowed: boolean): Promise<void> {
    if (!this.options.preferences) throw new Error('Email preferences are not configured');
    await this.options.preferences.set(userId, {
      marketingAllowed: allowed,
      unsubscribedAt: allowed ? null : this.now().toISOString(),
    });
  }

  async getMarketingPreference(
    userId: string,
  ): Promise<{ marketingAllowed: boolean; unsubscribedAt: string | null } | undefined> {
    return this.options.preferences?.get(userId);
  }

  suppress(address: string): void {
    this.suppression.suppress(address);
  }

  getDelivery(idempotencyKey: string): EmailDelivery | undefined {
    return this.deliveries.get(idempotencyKey);
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private async saveDelivery(input: EmailMessage, delivery: EmailDelivery): Promise<void> {
    this.deliveries.set(input.idempotencyKey, delivery);
    await this.options.deliveries?.save(input.idempotencyKey, delivery, {
      kind: input.kind,
      templateId: input.templateId,
      ...(input.userId ? { userId: input.userId } : {}),
    });
  }
}

export interface CampaignAudience {
  planId?: string;
  activeOnly?: boolean;
}

export interface CampaignUser {
  userId: string;
  email: string;
  firstName?: string;
  planId: string;
  verified: boolean;
  marketingAllowed: boolean;
  active: boolean;
}

export interface EmailCampaign {
  id: string;
  name: string;
  subject: string;
  previewText: string;
  html: string;
  audience: CampaignAudience;
  status: 'DRAFT' | 'SCHEDULED' | 'SENDING' | 'SENT' | 'CANCELLED';
  createdBy: string;
  createdAt: string;
}

export interface EmailCampaignStore {
  save(campaign: EmailCampaign): Promise<void>;
  get(id: string): Promise<EmailCampaign | undefined>;
  update(campaign: EmailCampaign): Promise<void>;
  getRecipientState(campaignId: string, userId: string): Promise<EmailDelivery | undefined>;
  saveRecipientState(campaignId: string, userId: string, state: EmailDelivery): Promise<void>;
}

export class InMemoryEmailCampaignStore implements EmailCampaignStore {
  readonly campaigns = new Map<string, EmailCampaign>();
  readonly recipients = new Map<string, EmailDelivery>();

  async save(campaign: EmailCampaign): Promise<void> {
    this.campaigns.set(campaign.id, campaign);
  }
  async get(id: string): Promise<EmailCampaign | undefined> {
    return this.campaigns.get(id);
  }
  async update(campaign: EmailCampaign): Promise<void> {
    this.campaigns.set(campaign.id, campaign);
  }
  async getRecipientState(campaignId: string, userId: string): Promise<EmailDelivery | undefined> {
    return this.recipients.get(`${campaignId}:${userId}`);
  }
  async saveRecipientState(
    campaignId: string,
    userId: string,
    state: EmailDelivery,
  ): Promise<void> {
    this.recipients.set(`${campaignId}:${userId}`, state);
  }
}

export class EmailCampaignService {
  constructor(
    private readonly options: {
      email: EmailService;
      store: EmailCampaignStore;
      now?: () => Date;
    },
  ) {}

  async create(input: Omit<EmailCampaign, 'id' | 'createdAt' | 'status'>): Promise<EmailCampaign> {
    const campaign: EmailCampaign = {
      ...input,
      id: cryptoRandomId(),
      status: 'DRAFT',
      createdAt: this.now().toISOString(),
      html: sanitizeEmailHtml(input.html),
    };
    await this.options.store.save(campaign);
    return campaign;
  }

  async get(id: string): Promise<EmailCampaign | undefined> {
    return this.options.store.get(id);
  }

  async previewById(
    id: string,
    users: CampaignUser[],
  ): Promise<{ eligible: CampaignUser[]; suppressed: CampaignUser[] }> {
    const campaign = await this.options.store.get(id);
    if (!campaign) throw new Error('Campaign not found');
    return this.preview(campaign, users);
  }

  preview(
    campaign: EmailCampaign,
    users: CampaignUser[],
  ): { eligible: CampaignUser[]; suppressed: CampaignUser[] } {
    const audience = users.filter((user) => {
      if (!user.verified || !user.marketingAllowed) return false;
      if (campaign.audience.planId && campaign.audience.planId !== user.planId) return false;
      if (campaign.audience.activeOnly && !user.active) return false;
      return true;
    });
    return { eligible: audience, suppressed: users.filter((user) => !audience.includes(user)) };
  }

  async send(
    campaignId: string,
    users: CampaignUser[],
  ): Promise<{ sent: number; suppressed: number }> {
    const campaign = await this.options.store.get(campaignId);
    if (!campaign) throw new Error('Campaign not found');
    const { eligible, suppressed } = this.preview(campaign, users);
    await this.options.store.update({ ...campaign, status: 'SENDING' });
    let sent = 0;
    for (const user of eligible) {
      if (await this.options.store.getRecipientState(campaign.id, user.userId)) continue;
      const delivery = await this.options.email.send({
        kind: 'marketing',
        userId: user.userId,
        to: user.email,
        verified: user.verified,
        unsubscribed: !user.marketingAllowed,
        subject: campaign.subject,
        html: renderTemplate(campaign.html, { first_name: user.firstName, email: user.email }),
        templateId: `campaign:${campaign.id}`,
        idempotencyKey: `campaign:${campaign.id}:${user.userId}`,
      });
      await this.options.store.saveRecipientState(campaign.id, user.userId, delivery);
      if (delivery.status === 'SENT') sent += 1;
    }
    await this.options.store.update({ ...campaign, status: 'SENT' });
    return { sent, suppressed: suppressed.length };
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}

function cryptoRandomId(): string {
  return randomUUID();
}

function hashForEmailKey(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
