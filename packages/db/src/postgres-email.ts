import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type {
  CampaignAudience,
  CampaignUser,
  EmailCampaign,
  EmailCampaignStore,
  EmailDelivery,
  EmailDeliveryStore,
  EmailKind,
  EmailSenderIdentity,
  EmailSenderKind,
  EmailSenderStore,
} from '@astra/email';

function mapCampaign(row: Record<string, unknown>): EmailCampaign {
  return {
    id: String(row.id),
    name: String(row.name),
    subject: String(row.subject),
    previewText: String(row.preview_text ?? ''),
    html: String(row.html),
    audience: (row.audience ?? {}) as CampaignAudience,
    status: String(row.status) as EmailCampaign['status'],
    createdBy: String(row.created_by),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

export class PostgresEmailDeliveryStore implements EmailDeliveryStore {
  constructor(private readonly pool: Pool) {}

  async get(idempotencyKey: string): Promise<EmailDelivery | undefined> {
    const result = await this.pool.query(
      'SELECT provider, provider_message_id, status, error_code, created_at FROM email_events WHERE idempotency_key = $1',
      [idempotencyKey],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      provider: String(row.provider),
      providerMessageId: row.provider_message_id ? String(row.provider_message_id) : null,
      status: String(row.status) as EmailDelivery['status'],
      ...(row.error_code ? { errorCode: String(row.error_code) } : {}),
      createdAt: new Date(String(row.created_at)).toISOString(),
    };
  }

  async save(
    idempotencyKey: string,
    delivery: EmailDelivery,
    metadata: { userId?: string; kind: EmailKind; templateId: string },
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO email_events
        (id, user_id, kind, template_id, provider, provider_message_id, idempotency_key, status, error_code, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        randomUUID(),
        metadata.userId ?? null,
        metadata.kind,
        metadata.templateId,
        delivery.provider,
        delivery.providerMessageId,
        idempotencyKey,
        delivery.status,
        delivery.errorCode ?? null,
        delivery.createdAt,
      ],
    );
  }
}

export class PostgresEmailSenderStore implements EmailSenderStore {
  constructor(private readonly pool: Pool) {}

  async list(): Promise<EmailSenderIdentity[]> {
    const result = await this.pool.query(
      'SELECT kind, from_address, reply_to, updated_by, updated_at FROM email_sender_identities ORDER BY kind',
    );
    return result.rows.map((row) => ({
      kind: String(row.kind) as EmailSenderKind,
      fromAddress: String(row.from_address),
      ...(row.reply_to ? { replyTo: String(row.reply_to) } : {}),
      ...(row.updated_by ? { updatedBy: String(row.updated_by) } : {}),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    }));
  }

  async get(kind: EmailSenderKind): Promise<EmailSenderIdentity | undefined> {
    const result = await this.pool.query(
      'SELECT kind, from_address, reply_to, updated_by, updated_at FROM email_sender_identities WHERE kind = $1',
      [kind],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      kind: String(row.kind) as EmailSenderKind,
      fromAddress: String(row.from_address),
      ...(row.reply_to ? { replyTo: String(row.reply_to) } : {}),
      ...(row.updated_by ? { updatedBy: String(row.updated_by) } : {}),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    };
  }

  async upsert(identity: EmailSenderIdentity): Promise<void> {
    await this.pool.query(
      `INSERT INTO email_sender_identities(kind, from_address, reply_to, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (kind) DO UPDATE SET
         from_address = EXCLUDED.from_address,
         reply_to = EXCLUDED.reply_to,
         updated_by = EXCLUDED.updated_by,
         updated_at = now()`,
      [identity.kind, identity.fromAddress, identity.replyTo ?? null, identity.updatedBy ?? null],
    );
  }
}

export class PostgresEmailCampaignStore implements EmailCampaignStore {
  constructor(private readonly pool: Pool) {}

  async save(campaign: EmailCampaign): Promise<void> {
    await this.pool.query(
      `INSERT INTO email_campaigns (id, name, subject, preview_text, html, audience, status, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        campaign.id,
        campaign.name,
        campaign.subject,
        campaign.previewText,
        campaign.html,
        campaign.audience,
        campaign.status,
        campaign.createdBy,
        campaign.createdAt,
      ],
    );
  }

  async get(id: string): Promise<EmailCampaign | undefined> {
    const result = await this.pool.query('SELECT * FROM email_campaigns WHERE id = $1', [id]);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? mapCampaign(row) : undefined;
  }

  async update(campaign: EmailCampaign): Promise<void> {
    await this.pool.query(
      `UPDATE email_campaigns
       SET name = $2, subject = $3, preview_text = $4, html = $5, audience = $6, status = $7,
           sent_at = CASE WHEN $7 = 'SENT' THEN COALESCE(sent_at, now()) ELSE sent_at END
       WHERE id = $1`,
      [
        campaign.id,
        campaign.name,
        campaign.subject,
        campaign.previewText,
        campaign.html,
        campaign.audience,
        campaign.status,
      ],
    );
  }

  async getRecipientState(campaignId: string, userId: string): Promise<EmailDelivery | undefined> {
    const result = await this.pool.query(
      `SELECT status, provider_message_id, error_code, COALESCE(sent_at, now()) AS created_at
       FROM email_campaign_recipients WHERE campaign_id = $1 AND user_id = $2`,
      [campaignId, userId],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      provider: 'resend',
      providerMessageId: row.provider_message_id ? String(row.provider_message_id) : null,
      status: String(row.status) as EmailDelivery['status'],
      ...(row.error_code ? { errorCode: String(row.error_code) } : {}),
      createdAt: new Date(String(row.created_at)).toISOString(),
    };
  }

  async saveRecipientState(
    campaignId: string,
    userId: string,
    state: EmailDelivery,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO email_campaign_recipients
        (campaign_id, user_id, status, provider_message_id, error_code, sent_at)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $3 = 'SENT' THEN $6 ELSE NULL END)
       ON CONFLICT (campaign_id, user_id) DO UPDATE SET
         status = EXCLUDED.status,
         provider_message_id = EXCLUDED.provider_message_id,
         error_code = EXCLUDED.error_code,
         sent_at = EXCLUDED.sent_at`,
      [
        campaignId,
        userId,
        state.status,
        state.providerMessageId,
        state.errorCode ?? null,
        state.createdAt,
      ],
    );
  }
}

export async function listPostgresCampaignUsers(
  pool: Pool,
  audience: CampaignAudience,
): Promise<CampaignUser[]> {
  const values: unknown[] = [];
  const conditions = ['u.email_verified_at IS NOT NULL', "u.status = 'ACTIVE'"];
  if (audience.planId) {
    values.push(audience.planId);
    conditions.push(`u.plan_id = $${values.length}`);
  }
  if (audience.activeOnly) conditions.push("u.status = 'ACTIVE'");
  const result = await pool.query(
    `SELECT u.id, u.email, u.plan_id, u.email_verified_at,
            COALESCE(mp.marketing_allowed, false) AS marketing_allowed
       FROM users u
       LEFT JOIN marketing_preferences mp ON mp.user_id = u.id
      WHERE ${conditions.join(' AND ')}`,
    values,
  );
  return result.rows.map((row) => ({
    userId: String(row.id),
    email: String(row.email),
    planId: String(row.plan_id),
    verified: Boolean(row.email_verified_at),
    marketingAllowed: row.marketing_allowed === true,
    active: true,
  }));
}
