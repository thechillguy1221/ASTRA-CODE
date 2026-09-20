import { WebSocket } from 'ws';
import { RemoteMessageSchema, type RemoteMessage } from './types.js';
import type { RelayRole } from './relay.js';
import { z } from 'zod';

const RelayReadySchema = z.object({
  type: z.literal('relay.ready'),
  connectionId: z.string().min(1),
  expiresAt: z.string().datetime(),
});
const RelayErrorSchema = z.object({ type: z.literal('relay.error'), code: z.string().min(1) });

export interface WebSocketRelayClientOptions {
  url: string;
  token: string;
  role: RelayRole;
  heartbeatIntervalMs?: number;
}

export interface WebSocketRelayConnection {
  connectionId: string;
  expiresAt: string;
  role: RelayRole;
  connectedAt: string;
  lastHeartbeatAt: string;
}

/** Node/Electron relay client. It owns transport only; grant issuance remains server-side. */
export class WebSocketRelayClient {
  private socket: WebSocket | undefined;
  private heartbeat: NodeJS.Timeout | undefined;
  private connection: WebSocketRelayConnection | undefined;
  private readonly listeners = new Set<(message: RemoteMessage) => void>();

  constructor(private readonly options: WebSocketRelayClientOptions) {}

  async connect(): Promise<WebSocketRelayConnection> {
    if (this.connection) return this.connection;
    const socket = new WebSocket(this.options.url);
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const onOpen = (): void => {
        socket.off('error', onError);
        socket.send(
          JSON.stringify({
            type: 'relay.auth',
            token: this.options.token,
            role: this.options.role,
          }),
        );
        resolve();
      };
      const onError = (error: Error): void => reject(error);
      socket.once('open', onOpen);
      socket.once('error', onError);
    });
    const ready = await new Promise<WebSocketRelayConnection>((resolve, reject) => {
      const onMessage = (raw: Buffer): void => {
        const value: unknown = parseJson(raw.toString());
        const parsed = RelayReadySchema.safeParse(value);
        if (!parsed.success) return;
        socket.off('message', onMessage);
        socket.off('error', onError);
        const now = new Date().toISOString();
        resolve({
          connectionId: parsed.data.connectionId,
          expiresAt: parsed.data.expiresAt,
          role: this.options.role,
          connectedAt: now,
          lastHeartbeatAt: now,
        });
      };
      const onError = (error: Error): void => {
        socket.off('message', onMessage);
        reject(error);
      };
      socket.on('message', onMessage);
      socket.once('error', onError);
    });
    this.connection = ready;
    socket.on('message', (raw) => this.handleMessage(raw.toString()));
    socket.on('close', () => this.handleClose());
    socket.on('error', () => this.handleClose());
    this.heartbeat = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ type: 'relay.heartbeat' }));
    }, this.options.heartbeatIntervalMs ?? 15_000);
    return ready;
  }

  send(message: RemoteMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN)
      throw new Error('Relay client is not connected');
    this.socket.send(JSON.stringify(message));
  }

  onMessage(listener: (message: RemoteMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    this.connection = undefined;
    this.socket?.close(1000, 'Relay client closed');
    this.socket = undefined;
  }

  private handleMessage(raw: string): void {
    const value: unknown = parseJson(raw);
    if (RelayErrorSchema.safeParse(value).success) return;
    if (value && typeof value === 'object' && 'type' in value) {
      const message = RemoteMessageSchema.safeParse(value);
      if (message.success) this.listeners.forEach((listener) => listener(message.data));
    }
  }

  private handleClose(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
    this.connection = undefined;
    this.socket = undefined;
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}
