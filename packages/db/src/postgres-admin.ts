import type { Pool } from 'pg';
import type { AdminAuditEntry, AdminAuditStore } from '@astra/billing';

function mapAudit(row: Record<string, unknown>): AdminAuditEntry {
  return {
    id: String(row.id),
    actorUserId: String(row.actor_user_id),
    role: String(row.role) as AdminAuditEntry['role'],
    action: String(row.action) as AdminAuditEntry['action'],
    targetType: String(row.target_type),
    targetId: String(row.target_id),
    before: row.before_state ?? null,
    after: row.after_state ?? null,
    reason: String(row.reason),
    requestId: String(row.request_id ?? ''),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

export class PostgresAdminAuditStore implements AdminAuditStore {
  constructor(private readonly pool: Pool) {}

  async append(entry: AdminAuditEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO admin_audit_log
        (id, actor_user_id, role, action, target_type, target_id, before_state, after_state, reason, request_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        entry.id,
        entry.actorUserId,
        entry.role,
        entry.action,
        entry.targetType,
        entry.targetId,
        entry.before,
        entry.after,
        entry.reason,
        entry.requestId,
        entry.createdAt,
      ],
    );
  }

  async list(): Promise<AdminAuditEntry[]> {
    const result = await this.pool.query(
      'SELECT * FROM admin_audit_log ORDER BY created_at DESC, id DESC',
    );
    return result.rows.map((row) => mapAudit(row as Record<string, unknown>));
  }
}
