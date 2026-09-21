import type { Pool } from 'pg';
import {
  PlatformConcurrencyError,
  PlatformEntityKindSchema,
  PlatformEventSchema,
  type PlatformEntityKind,
  type PlatformEvent,
  type PlatformRecord,
  type PlatformRecordStore,
} from '@astra/orchestration';

function mapRecord(row: Record<string, unknown>): PlatformRecord {
  return {
    kind: PlatformEntityKindSchema.parse(row.kind),
    id: String(row.record_id),
    ownerId: String(row.owner_id),
    version: Number(row.version),
    status: String(row.status),
    payload: row.payload,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

function mapEvent(row: Record<string, unknown>): PlatformEvent {
  return PlatformEventSchema.parse({
    id: String(row.event_id),
    kind: String(row.kind),
    entityId: String(row.entity_id),
    actorId: row.actor_id === null || row.actor_id === undefined ? null : String(row.actor_id),
    correlationId: String(row.correlation_id),
    payload: row.payload,
    createdAt: new Date(String(row.created_at)).toISOString(),
  });
}

export class PostgresOrchestrationStore implements PlatformRecordStore {
  constructor(private readonly pool: Pool) {}

  async get(kind: PlatformEntityKind, id: string): Promise<PlatformRecord | undefined> {
    const result = await this.pool.query(
      'SELECT kind, record_id, owner_id, version, status, payload, created_at, updated_at FROM astra_platform_records WHERE kind = $1 AND record_id = $2',
      [kind, id],
    );
    return result.rows[0] ? mapRecord(result.rows[0]) : undefined;
  }

  async list(kind: PlatformEntityKind, ownerId?: string): Promise<PlatformRecord[]> {
    const result = ownerId
      ? await this.pool.query(
          'SELECT kind, record_id, owner_id, version, status, payload, created_at, updated_at FROM astra_platform_records WHERE kind = $1 AND owner_id = $2 ORDER BY updated_at DESC',
          [kind, ownerId],
        )
      : await this.pool.query(
          'SELECT kind, record_id, owner_id, version, status, payload, created_at, updated_at FROM astra_platform_records WHERE kind = $1 ORDER BY updated_at DESC',
          [kind],
        );
    return result.rows.map((row) => mapRecord(row));
  }

  async put(record: PlatformRecord, expectedVersion: number | null): Promise<PlatformRecord> {
    const values = [
      record.kind,
      record.id,
      record.ownerId,
      record.version,
      record.status,
      record.payload,
      record.createdAt,
      record.updatedAt,
    ];
    if (expectedVersion === null) {
      const result = await this.pool.query(
        `INSERT INTO astra_platform_records
          (kind, record_id, owner_id, version, status, payload, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (kind, record_id) DO NOTHING
         RETURNING kind, record_id, owner_id, version, status, payload, created_at, updated_at`,
        values,
      );
      if (!result.rowCount) throw new PlatformConcurrencyError('Platform record already exists');
      return mapRecord(result.rows[0]);
    }
    const result = await this.pool.query(
      `UPDATE astra_platform_records
          SET owner_id = $3, version = $4, status = $5, payload = $6, updated_at = $8
        WHERE kind = $1 AND record_id = $2 AND version = $9
        RETURNING kind, record_id, owner_id, version, status, payload, created_at, updated_at`,
      [...values, expectedVersion],
    );
    if (!result.rowCount) throw new PlatformConcurrencyError('Platform record version conflict');
    return mapRecord(result.rows[0]);
  }

  async appendEvent(event: PlatformEvent): Promise<void> {
    const parsed = PlatformEventSchema.parse(event);
    await this.pool.query(
      `INSERT INTO astra_platform_events
        (event_id, kind, entity_id, actor_id, correlation_id, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        parsed.id,
        parsed.kind,
        parsed.entityId,
        parsed.actorId,
        parsed.correlationId,
        parsed.payload,
        parsed.createdAt,
      ],
    );
  }

  async listEvents(entityId: string, limit = 200): Promise<PlatformEvent[]> {
    const result = await this.pool.query(
      `SELECT event_id, kind, entity_id, actor_id, correlation_id, payload, created_at
         FROM astra_platform_events WHERE entity_id = $1
        ORDER BY created_at ASC, event_id ASC LIMIT $2`,
      [entityId, Math.max(1, Math.min(limit, 1000))],
    );
    return result.rows.map((row) => mapEvent(row));
  }
}
