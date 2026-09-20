import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { z } from 'zod';
import { RelayError, RemoteRelayBroker, type RelayConnection, type RelayRole } from './relay.js';

const RelayAuthSchema = z.object({
  type: z.literal('relay.auth'),
  token: z.string().min(1),
  role: z.enum(['HOST', 'CLIENT']),
});

const RelayHeartbeatSchema = z.object({ type: z.literal('relay.heartbeat') });

export interface WebSocketRelayOptions {
  path?: string;
  requireTls?: boolean;
  heartbeatTimeoutMs?: number;
  flushIntervalMs?: number;
  maxSocketBufferedBytes?: number;
}

/**
 * Network adapter for the capability-checked relay broker.
 *
 * Authentication is a first WebSocket frame rather than a URL query value so
 * short-lived grant tokens are not placed in ordinary proxy access logs. The
 * adapter is transport-only: all authorization, replay, expiry and
 * backpressure decisions remain in RemoteRelayBroker.
 */
export class WebSocketRelayServer {
  private readonly websocketServer = new WebSocketServer({ noServer: true });
  private readonly connections = new Map<string, { socket: WebSocket; lastHeartbeatAt: number }>();
  private readonly options: Required<WebSocketRelayOptions>;
  private interval: NodeJS.Timeout | undefined;
  private attachedServer: HttpServer | undefined;
  private onUpgrade: ((request: IncomingMessage, socket: Duplex, head: Buffer) => void) | undefined;

  constructor(
    private readonly broker: RemoteRelayBroker,
    options: WebSocketRelayOptions = {},
  ) {
    this.options = {
      path: options.path ?? '/v1/relay',
      requireTls: options.requireTls ?? true,
      heartbeatTimeoutMs: options.heartbeatTimeoutMs ?? 45_000,
      flushIntervalMs: options.flushIntervalMs ?? 25,
      maxSocketBufferedBytes: options.maxSocketBufferedBytes ?? 1_000_000,
    };
  }

  attach(server: HttpServer): void {
    if (this.attachedServer) throw new Error('Relay server is already attached');
    this.attachedServer = server;
    this.onUpgrade = (request, socket, head) => {
      const url = new URL(request.url ?? '/', 'http://relay.local');
      if (url.pathname !== this.options.path) return;
      const encrypted =
        'encrypted' in request.socket &&
        Boolean((request.socket as typeof request.socket & { encrypted?: boolean }).encrypted);
      if (this.options.requireTls && !encrypted) {
        socket.destroy();
        return;
      }
      this.websocketServer.handleUpgrade(request, socket, head, (websocket) => {
        this.handleSocket(websocket);
      });
    };
    server.on('upgrade', this.onUpgrade);
    this.interval = setInterval(() => this.flush(), this.options.flushIntervalMs);
  }

  async close(): Promise<void> {
    if (this.interval) clearInterval(this.interval);
    this.interval = undefined;
    if (this.attachedServer && this.onUpgrade) this.attachedServer.off('upgrade', this.onUpgrade);
    this.attachedServer = undefined;
    for (const [connectionId, entry] of this.connections) {
      this.broker.disconnect(connectionId);
      entry.socket.close(1001, 'Relay shutting down');
    }
    this.connections.clear();
    await new Promise<void>((resolve) => this.websocketServer.close(() => resolve()));
  }

  private handleSocket(socket: WebSocket): void {
    let connection: RelayConnection | undefined;
    const authenticatedSocket = socket;
    const closeSocket = (code = 1008): void => {
      if (authenticatedSocket.readyState === WebSocket.OPEN)
        authenticatedSocket.close(code, 'Relay authorization failed');
      if (connection) {
        this.broker.disconnect(connection.connectionId);
        this.connections.delete(connection.connectionId);
      }
    };
    authenticatedSocket.on('message', (raw: RawData) => {
      const value = parseJson(raw);
      if (!value) return closeSocket();
      if (!connection) {
        const auth = RelayAuthSchema.safeParse(value);
        if (!auth.success) return closeSocket();
        try {
          connection = this.broker.connect(auth.data.token, auth.data.role as RelayRole);
          this.connections.set(connection.connectionId, {
            socket: authenticatedSocket,
            lastHeartbeatAt: Date.now(),
          });
          authenticatedSocket.send(
            JSON.stringify({
              type: 'relay.ready',
              connectionId: connection.connectionId,
              expiresAt: connection.grant.expiresAt,
            }),
          );
        } catch {
          closeSocket();
        }
        return;
      }
      if (RelayHeartbeatSchema.safeParse(value).success) {
        try {
          this.broker.heartbeat(connection.connectionId);
          const state = this.connections.get(connection.connectionId);
          if (state) state.lastHeartbeatAt = Date.now();
          authenticatedSocket.send(JSON.stringify({ type: 'relay.heartbeat.ack' }));
        } catch {
          closeSocket();
        }
        return;
      }
      try {
        this.broker.send(connection.connectionId, value);
        this.flush();
      } catch (error) {
        const code = error instanceof RelayError ? error.code : 'INVALID_MESSAGE';
        if (authenticatedSocket.readyState === WebSocket.OPEN)
          authenticatedSocket.send(JSON.stringify({ type: 'relay.error', code }));
        if (error instanceof RelayError && ['GRANT_REVOKED', 'GRANT_EXPIRED'].includes(error.code))
          closeSocket();
      }
    });
    authenticatedSocket.on('close', () => {
      if (connection) {
        this.broker.disconnect(connection.connectionId);
        this.connections.delete(connection.connectionId);
      }
    });
    authenticatedSocket.on('error', () => closeSocket(1011));
  }

  private flush(): void {
    const now = Date.now();
    for (const [connectionId, entry] of this.connections) {
      if (now - entry.lastHeartbeatAt > this.options.heartbeatTimeoutMs) {
        this.broker.disconnect(connectionId);
        this.connections.delete(connectionId);
        entry.socket.close(1001, 'Relay heartbeat expired');
        continue;
      }
      if (entry.socket.readyState !== WebSocket.OPEN) continue;
      if (entry.socket.bufferedAmount > this.options.maxSocketBufferedBytes) {
        this.broker.disconnect(connectionId);
        this.connections.delete(connectionId);
        entry.socket.close(1013, 'Relay backpressure');
        continue;
      }
      let messages;
      try {
        messages = this.broker.receive(connectionId);
      } catch {
        this.connections.delete(connectionId);
        entry.socket.close(1008, 'Relay authorization expired');
        continue;
      }
      for (const message of messages) {
        if (entry.socket.readyState !== WebSocket.OPEN) break;
        entry.socket.send(JSON.stringify(message));
      }
    }
  }
}

function parseJson(raw: RawData): unknown {
  try {
    const text = typeof raw === 'string' ? raw : raw.toString();
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
