import { randomUUID } from 'node:crypto';
import { RemoteMessageSchema, type RemoteMessage } from './types.js';

export interface RemoteHostTransport {
  send(message: RemoteMessage): void;
  onMessage(listener: (message: RemoteMessage) => void): () => void;
}

export interface RemoteHostRuntime {
  prompt(input: Extract<RemoteMessage, { type: 'prompt.submit' }>['payload']): Promise<void>;
  changeModel(input: Extract<RemoteMessage, { type: 'model.change' }>['payload']): Promise<void>;
  pause(input: { sessionId: string }): Promise<void>;
  resume(input: { sessionId: string }): Promise<void>;
  stop(input: { sessionId: string }): Promise<void>;
  terminal(input: Extract<RemoteMessage, { type: 'terminal.command' }>['payload']): Promise<void>;
  approval(input: Extract<RemoteMessage, { type: 'approval.response' }>['payload']): Promise<void>;
}

export type RemoteHostAction = 'agent.prompt' | 'terminal.run' | 'destructive.approve';

/**
 * Host-side adapter for the relay transport. It deliberately owns no
 * filesystem, process, or credential access. Those stay behind the supplied
 * DesktopRuntime callbacks and the host policy callback.
 */
export class RemoteHostBridge {
  private unsubscribe: (() => void) | undefined;

  constructor(
    private readonly options: {
      transport: RemoteHostTransport;
      runtime: RemoteHostRuntime;
      authorize: (action: RemoteHostAction, message: RemoteMessage) => boolean | Promise<boolean>;
    },
  ) {}

  start(): () => void {
    if (this.unsubscribe) return this.unsubscribe;
    this.unsubscribe = this.options.transport.onMessage((message) => {
      void this.handleMessage(message).catch(() => {
        this.publishAgentEvent(
          'remote.action.failed',
          { messageType: message.type },
          messageSessionId(message),
        );
      });
    });
    return () => {
      this.unsubscribe?.();
      this.unsubscribe = undefined;
    };
  }

  async handleMessage(value: unknown): Promise<void> {
    const parsed = RemoteMessageSchema.safeParse(value);
    if (!parsed.success) return;
    const message = parsed.data;
    const action = requiredHostAction(message);
    if (!action) return;
    if (!(await this.options.authorize(action, message))) {
      this.publishAgentEvent(
        'remote.action.denied',
        { action, messageType: message.type },
        messageSessionId(message),
      );
      return;
    }
    switch (message.type) {
      case 'prompt.submit':
        await this.options.runtime.prompt(message.payload);
        return;
      case 'model.change':
        await this.options.runtime.changeModel(message.payload);
        return;
      case 'session.pause':
        await this.options.runtime.pause(message.payload);
        return;
      case 'session.resume':
        await this.options.runtime.resume(message.payload);
        return;
      case 'session.stop':
        await this.options.runtime.stop(message.payload);
        return;
      case 'terminal.command':
        await this.options.runtime.terminal(message.payload);
        return;
      case 'approval.response':
        await this.options.runtime.approval(message.payload);
        return;
      default:
        return;
    }
  }

  publishSessionState(payload: Extract<RemoteMessage, { type: 'session.state' }>['payload']): void {
    this.options.transport.send({
      messageId: randomUUID(),
      timestamp: new Date().toISOString(),
      type: 'session.state',
      payload,
    });
  }

  publishAgentEvent(eventType: string, eventPayload: unknown, sessionId?: string): void {
    this.options.transport.send({
      messageId: randomUUID(),
      timestamp: new Date().toISOString(),
      type: 'agent.event',
      ...(sessionId ? { sessionId } : {}),
      payload: { eventType, eventPayload },
    });
  }

  publishTerminalOutput(
    payload: Extract<RemoteMessage, { type: 'terminal.output' }>['payload'],
    sessionId?: string,
  ): void {
    this.options.transport.send({
      messageId: randomUUID(),
      timestamp: new Date().toISOString(),
      type: 'terminal.output',
      ...(sessionId ? { sessionId } : {}),
      payload: {
        command: payload.command,
        stdout: payload.stdout,
        stderr: payload.stderr,
        exitCode: payload.exitCode,
        status: payload.status,
      },
    });
  }
}

function requiredHostAction(message: RemoteMessage): RemoteHostAction | null {
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

function messageSessionId(message: RemoteMessage): string | undefined {
  if ('sessionId' in message && typeof message.sessionId === 'string') {
    return message.sessionId;
  }
  if (
    'payload' in message &&
    typeof message.payload === 'object' &&
    message.payload !== null &&
    'sessionId' in message.payload &&
    typeof message.payload.sessionId === 'string'
  ) {
    return message.payload.sessionId;
  }
  return undefined;
}
