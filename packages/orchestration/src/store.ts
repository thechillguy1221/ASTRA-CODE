import { randomUUID } from 'node:crypto';
import type { PlatformEntityKind, PlatformEvent, PlatformRecord } from './contracts.js';

export class PlatformConcurrencyError extends Error {
  constructor(message = 'Platform record version is stale') {
    super(message);
    this.name = 'PlatformConcurrencyError';
  }
}
export interface PlatformRecordStore {
  get(kind: PlatformEntityKind, id: string): Promise<PlatformRecord | undefined>;
  list(kind: PlatformEntityKind, ownerId?: string): Promise<PlatformRecord[]>;
  put(record: PlatformRecord, expectedVersion: number | null): Promise<PlatformRecord>;
  appendEvent(event: PlatformEvent): Promise<void>;
  listEvents(entityId: string, limit?: number): Promise<PlatformEvent[]>;
}
function clone<T>(value: T): T {
  return structuredClone(value);
}
export class InMemoryPlatformRecordStore implements PlatformRecordStore {
  private readonly records = new Map<string, PlatformRecord>();
  private readonly events: PlatformEvent[] = [];
  async get(kind: PlatformEntityKind, id: string): Promise<PlatformRecord | undefined> {
    const record = this.records.get(`${kind}:${id}`);
    return record ? clone(record) : undefined;
  }
  async list(kind: PlatformEntityKind, ownerId?: string): Promise<PlatformRecord[]> {
    return [...this.records.values()]
      .filter((record) => record.kind === kind && (!ownerId || record.ownerId === ownerId))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(clone);
  }
  async put(record: PlatformRecord, expectedVersion: number | null): Promise<PlatformRecord> {
    const key = `${record.kind}:${record.id}`;
    const current = this.records.get(key);
    if (expectedVersion === null && current)
      throw new PlatformConcurrencyError(`Platform record already exists: ${key}`);
    if (expectedVersion !== null && (!current || current.version !== expectedVersion))
      throw new PlatformConcurrencyError(`Platform record version conflict: ${key}`);
    this.records.set(key, clone(record));
    return clone(record);
  }
  async appendEvent(event: PlatformEvent): Promise<void> {
    this.events.push(clone(event));
  }
  async listEvents(entityId: string, limit = 200): Promise<PlatformEvent[]> {
    return this.events
      .filter((event) => event.entityId === entityId)
      .slice(-Math.max(1, Math.min(limit, 1000)))
      .map(clone);
  }
}
export function platformRecord(
  kind: PlatformEntityKind,
  id: string,
  ownerId: string,
  payload: unknown,
  now: string,
): PlatformRecord {
  return {
    kind,
    id,
    ownerId,
    version: 1,
    status: 'ACTIVE',
    payload: clone(payload),
    createdAt: now,
    updatedAt: now,
  };
}
export function platformEvent(
  kind: string,
  entityId: string,
  actorId: string | null,
  correlationId: string,
  payload: Record<string, unknown>,
  now: string,
): PlatformEvent {
  return { id: randomUUID(), kind, entityId, actorId, correlationId, payload, createdAt: now };
}
