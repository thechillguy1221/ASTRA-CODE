import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { RemoteMessageSchema, type RemoteMessage } from './types.js';
import type { RoomPermission } from './access.js';
import { z } from 'zod';

const RelayRoleSchema = z.enum(['HOST', 'CLIENT']);
export type RelayRole = z.infer<typeof RelayRoleSchema>;

export const RelayGrantPayloadSchema = z.object({
  grantId: z.string().uuid(),
  sessionId: z.string().min(1),
  userId: z.string().min(1),
  deviceId: z.string().min(1),
  roomId: z.string().min(1).nullable(),
  role: RelayRoleSchema,
  permissions: z.array(z.string().min(1)),
  expiresAt: z.string().datetime(),
});
export type RelayGrantPayload = z.infer<typeof RelayGrantPayloadSchema>;

export interface RelayConnection {
  connectionId: string;
  grant: RelayGrantPayload;
  connectedAt: string;
  lastHeartbeatAt: string;
}

export class RelayError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_GRANT'
      | 'GRANT_EXPIRED'
      | 'GRANT_REVOKED'
      | 'NOT_CONNECTED'
      | 'SESSION_NOT_PAIRED'
      | 'PERMISSION_DENIED'
      | 'REPLAYED_MESSAGE'
      | 'BACKPRESSURE'
      | 'PAYLOAD_TOO_LARGE',
    message: string,
  ) {
    super(message);
    this.name = 'RelayError';
  }
}

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signature(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

/**
 * Creates a short-lived capability token. The API must mint this only after
 * authenticating the account, target device, Room, and requested permissions.
 * The relay never accepts those values from an unauthenticated client.
 */
export function createRelayGrant(
  input: Omit<RelayGrantPayload, 'grantId' | 'expiresAt'> & { ttlMs: number },
  secret: string,
  now = new Date(),
): { token: string; payload: RelayGrantPayload } {
  if (!Number.isFinite(input.ttlMs) || input.ttlMs <= 0)
    throw new RelayError('INVALID_GRANT', 'Relay grant TTL must be positive');
  const payload: RelayGrantPayload = RelayGrantPayloadSchema.parse({
    grantId: randomUUID(),
    sessionId: input.sessionId,
    userId: input.userId,
    deviceId: input.deviceId,
    roomId: input.roomId,
    role: input.role,
    permissions: input.permissions,
    expiresAt: new Date(now.getTime() + input.ttlMs).toISOString(),
  });
  const data = encode(JSON.stringify(payload));
  return { token: `${data}.${signature(data, secret)}`, payload };
}

export function verifyRelayGrant(
  token: string,
  secret: string,
  now = new Date(),
): RelayGrantPayload {
  const separator = token.lastIndexOf('.');
  if (separator <= 0) throw new RelayError('INVALID_GRANT', 'Relay grant format is invalid');
  const data = token.slice(0, separator);
  const provided = token.slice(separator + 1);
  const expected = signature(data, secret);
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  )
    throw new RelayError('INVALID_GRANT', 'Relay grant signature is invalid');
  let payload: RelayGrantPayload;
  try {
    payload = RelayGrantPayloadSchema.parse(JSON.parse(decode(data)));
  } catch {
    throw new RelayError('INVALID_GRANT', 'Relay grant payload is invalid');
  }
  if (new Date(payload.expiresAt).getTime() <= now.getTime())
    throw new RelayError('GRANT_EXPIRED', 'Relay grant has expired');
  return payload;
}

function requiredPermission(message: RemoteMessage): RoomPermission | null {
  switch (message.type) {
    case 'prompt.submit':
    case 'model.change':
    case 'session.pause':
    case 'session.resume':
    case 'session.stop':
      return 'agent.prompt';
    case 'terminal.command':
      return 'terminal.run';
    case 'approval.response':
      return 'destructive.approve';
    default:
      return null;
  }
}

interface InternalConnection extends RelayConnection {
  queue: RemoteMessage[];
}

/**
 * Deterministic relay core. It deliberately has no network or TLS code: the
 * production WebSocket/Streamable-HTTP adapter must authenticate at its edge
 * and delegate to this capability-checked core.
 */
export class RemoteRelayBroker {
  private readonly connections = new Map<string, InternalConnection>();
  private readonly revokedGrants = new Set<string>();
  private readonly revokedSessions = new Set<string>();
  private readonly seenMessages = new Map<string, Set<string>>();
  private readonly pending = new Map<string, Array<{ from: RelayRole; message: RemoteMessage }>>();
  private readonly now: () => Date;
  private readonly maxQueue: number;
  private readonly maxMessageBytes: number;

  constructor(
    private readonly secret: string,
    options: { now?: () => Date; maxQueue?: number; maxMessageBytes?: number } = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.maxQueue = options.maxQueue ?? 100;
    this.maxMessageBytes = options.maxMessageBytes ?? 512_000;
  }

  connect(token: string, expectedRole: RelayRole): RelayConnection {
    const grant = verifyRelayGrant(token, this.secret, this.now());
    if (grant.role !== expectedRole)
      throw new RelayError('INVALID_GRANT', 'Relay grant role does not match the connection');
    if (this.revokedGrants.has(grant.grantId) || this.revokedSessions.has(grant.sessionId))
      throw new RelayError('GRANT_REVOKED', 'Relay grant has been revoked');
    const now = this.now().toISOString();
    const connection: InternalConnection = {
      connectionId: randomUUID(),
      grant,
      connectedAt: now,
      lastHeartbeatAt: now,
      queue: [],
    };
    this.connections.set(connection.connectionId, connection);
    this.deliverPending(connection);
    return this.publicConnection(connection);
  }

  heartbeat(connectionId: string): RelayConnection {
    const connection = this.requireConnection(connectionId);
    connection.lastHeartbeatAt = this.now().toISOString();
    return this.publicConnection(connection);
  }

  disconnect(connectionId: string): void {
    this.connections.delete(connectionId);
  }

  revokeGrant(grantId: string): void {
    this.revokedGrants.add(grantId);
    for (const [connectionId, connection] of this.connections)
      if (connection.grant.grantId === grantId) this.connections.delete(connectionId);
  }

  revokeSession(sessionId: string): void {
    this.revokedSessions.add(sessionId);
    this.pending.delete(sessionId);
    for (const [connectionId, connection] of this.connections)
      if (connection.grant.sessionId === sessionId) this.connections.delete(connectionId);
  }

  revokeDevice(deviceId: string): void {
    this.revokeWhere((connection) => connection.grant.deviceId === deviceId);
  }

  revokeUser(userId: string): void {
    this.revokeWhere((connection) => connection.grant.userId === userId);
  }

  revokeRoomMember(roomId: string, userId: string): void {
    this.revokeWhere(
      (connection) => connection.grant.roomId === roomId && connection.grant.userId === userId,
    );
  }

  send(connectionId: string, message: unknown): void {
    const connection = this.requireConnection(connectionId);
    const parsed = RemoteMessageSchema.safeParse(message);
    if (!parsed.success) throw new RelayError('INVALID_GRANT', 'Remote message is invalid');
    const value = parsed.data;
    if (value.sessionId !== undefined && value.sessionId !== connection.grant.sessionId)
      throw new RelayError('INVALID_GRANT', 'Remote message session does not match grant');
    const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
    if (bytes > this.maxMessageBytes)
      throw new RelayError('PAYLOAD_TOO_LARGE', 'Remote message exceeds relay payload limit');
    const required = requiredPermission(value);
    if (
      connection.grant.role === 'CLIENT' &&
      required &&
      !connection.grant.permissions.includes(required)
    )
      throw new RelayError('PERMISSION_DENIED', `Relay grant lacks ${required}`);
    const seen = this.seenMessages.get(connection.grant.sessionId) ?? new Set<string>();
    if (seen.has(value.messageId))
      throw new RelayError('REPLAYED_MESSAGE', 'Remote message ID has already been accepted');
    seen.add(value.messageId);
    this.seenMessages.set(connection.grant.sessionId, seen);

    const peer = [...this.connections.values()].find(
      (candidate) =>
        candidate.grant.sessionId === connection.grant.sessionId &&
        candidate.grant.role !== connection.grant.role,
    );
    if (peer) {
      if (peer.queue.length >= this.maxQueue)
        throw new RelayError('BACKPRESSURE', 'Relay peer queue is full');
      peer.queue.push(value);
      return;
    }
    const queue = this.pending.get(connection.grant.sessionId) ?? [];
    if (queue.length >= this.maxQueue)
      throw new RelayError('BACKPRESSURE', 'Relay pending queue is full');
    queue.push({ from: connection.grant.role, message: value });
    this.pending.set(connection.grant.sessionId, queue);
  }

  receive(connectionId: string): RemoteMessage[] {
    const connection = this.requireConnection(connectionId);
    const messages = [...connection.queue];
    connection.queue.length = 0;
    return messages;
  }

  private deliverPending(connection: InternalConnection): void {
    const queued = this.pending.get(connection.grant.sessionId);
    if (!queued) return;
    const remaining: Array<{ from: RelayRole; message: RemoteMessage }> = [];
    for (const item of queued) {
      if (item.from === connection.grant.role || connection.queue.length >= this.maxQueue) {
        remaining.push(item);
      } else {
        connection.queue.push(item.message);
      }
    }
    if (remaining.length > 0) this.pending.set(connection.grant.sessionId, remaining);
    else this.pending.delete(connection.grant.sessionId);
  }

  private requireConnection(connectionId: string): InternalConnection {
    const connection = this.connections.get(connectionId);
    if (!connection) throw new RelayError('NOT_CONNECTED', 'Relay connection is not active');
    if (
      this.revokedGrants.has(connection.grant.grantId) ||
      this.revokedSessions.has(connection.grant.sessionId)
    ) {
      this.connections.delete(connectionId);
      throw new RelayError('GRANT_REVOKED', 'Relay grant has been revoked');
    }
    if (new Date(connection.grant.expiresAt).getTime() <= this.now().getTime()) {
      this.connections.delete(connectionId);
      throw new RelayError('GRANT_EXPIRED', 'Relay grant has expired');
    }
    return connection;
  }

  private revokeWhere(predicate: (connection: InternalConnection) => boolean): void {
    for (const [connectionId, connection] of this.connections) {
      if (!predicate(connection)) continue;
      this.revokedGrants.add(connection.grant.grantId);
      this.revokedSessions.add(connection.grant.sessionId);
      this.pending.delete(connection.grant.sessionId);
      this.connections.delete(connectionId);
    }
  }

  private publicConnection(connection: InternalConnection): RelayConnection {
    return {
      connectionId: connection.connectionId,
      grant: { ...connection.grant, permissions: [...connection.grant.permissions] },
      connectedAt: connection.connectedAt,
      lastHeartbeatAt: connection.lastHeartbeatAt,
    };
  }
}
