import { describe, expect, it } from 'vitest';
import { RemoteHostBridge, type RemoteHostTransport } from '@astra/remote-protocol';
import type { RemoteMessage } from '@astra/remote-protocol';

function message<T extends RemoteMessage['type']>(type: T, payload: unknown): RemoteMessage {
  return {
    messageId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    type,
    payload,
  } as RemoteMessage;
}

describe('remote host bridge', () => {
  it('dispatches authorized prompt/control messages and applies host authorization to terminal work', async () => {
    const sent: RemoteMessage[] = [];
    const listeners = new Set<(value: RemoteMessage) => void>();
    const transport: RemoteHostTransport = {
      send: (value) => sent.push(value),
      onMessage: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const calls: string[] = [];
    const bridge = new RemoteHostBridge({
      transport,
      authorize: async (action) => action !== 'terminal.run',
      runtime: {
        prompt: async () => void calls.push('prompt'),
        changeModel: async () => void calls.push('model'),
        pause: async () => void calls.push('pause'),
        resume: async () => void calls.push('resume'),
        stop: async () => void calls.push('stop'),
        terminal: async () => void calls.push('terminal'),
        approval: async () => void calls.push('approval'),
      },
    });
    const stop = bridge.start();

    listeners.forEach((listener) =>
      listener(
        message('prompt.submit', {
          sessionId: 'session-1',
          prompt: 'Fix the login test',
          modelId: 'model-1',
        }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    await bridge.handleMessage(
      message('terminal.command', {
        sessionId: 'session-1',
        command: 'npm test',
        requiresApproval: false,
      }),
    );

    expect(calls).toEqual(['prompt']);
    expect(sent.at(-1)).toMatchObject({
      type: 'agent.event',
      payload: { eventType: 'remote.action.denied' },
    });
    stop();
  });

  it('publishes bounded state/output messages without exposing host credentials', () => {
    const sent: RemoteMessage[] = [];
    const transport: RemoteHostTransport = {
      send: (value) => sent.push(value),
      onMessage: () => () => undefined,
    };
    const bridge = new RemoteHostBridge({
      transport,
      authorize: () => true,
      runtime: {
        prompt: async () => undefined,
        changeModel: async () => undefined,
        pause: async () => undefined,
        resume: async () => undefined,
        stop: async () => undefined,
        terminal: async () => undefined,
        approval: async () => undefined,
      },
    });

    bridge.publishSessionState({
      sessionId: 'session-1',
      status: 'COMPLETED',
      currentModelId: 'model-1',
      objective: 'Fix login',
      structuredState: null,
      creditsUsed: '2.5',
      currentBalance: '97.5',
    });
    bridge.publishTerminalOutput(
      {
        command: 'npm test',
        stdout: '23 passed',
        stderr: '',
        exitCode: 0,
        status: 'completed',
      },
      'session-1',
    );

    expect(sent.map((item) => item.type)).toEqual(['session.state', 'terminal.output']);
    expect(JSON.stringify(sent)).not.toContain('API_KEY');
  });

  it('contains runtime failures from transport delivery', async () => {
    const sent: RemoteMessage[] = [];
    const listeners = new Set<(value: RemoteMessage) => void>();
    const transport: RemoteHostTransport = {
      send: (value) => sent.push(value),
      onMessage: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const bridge = new RemoteHostBridge({
      transport,
      authorize: () => true,
      runtime: {
        prompt: async () => {
          throw new Error('host runtime failed');
        },
        changeModel: async () => undefined,
        pause: async () => undefined,
        resume: async () => undefined,
        stop: async () => undefined,
        terminal: async () => undefined,
        approval: async () => undefined,
      },
    });
    const stop = bridge.start();

    listeners.forEach((listener) =>
      listener(
        message('prompt.submit', {
          sessionId: 'session-1',
          prompt: 'Fix the login test',
          modelId: 'model-1',
        }),
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sent).toContainEqual(
      expect.objectContaining({
        type: 'agent.event',
        sessionId: 'session-1',
        payload: {
          eventType: 'remote.action.failed',
          eventPayload: { messageType: 'prompt.submit' },
        },
      }),
    );
    expect(JSON.stringify(sent)).not.toContain('host runtime failed');
    stop();
  });
});
