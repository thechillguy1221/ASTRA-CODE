import { ModelDecisionSchema, ModelStreamEventSchema } from '@astra/contracts';
import type { ModelStreamEvent } from '@astra/contracts';
import type { GatewayModelClient, GatewayRequest } from './contracts.js';
import { parseUsageReceipt } from './receipt.js';

export interface VercelGatewayClientOptions {
  baseUrl: string;
  apiKey: string;
  maxAttempts?: number;
  baseDelayMs?: number;
  random?: () => number;
}

export class ModelGatewayError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ModelGatewayError';
  }
}

function retryAfterMs(response: Response, now = Date.now()): number | undefined {
  const header = response.headers.get('retry-after');
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(30_000, seconds * 1000));
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, Math.min(30_000, date - now)) : undefined;
}

function waitWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted)
    return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

function extractDecision(value: unknown): ModelStreamEvent | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    const direct = ModelDecisionSchema.safeParse(parsed);
    if (direct.success) return { type: 'decision', decision: direct.data };
    if (parsed && typeof parsed === 'object' && 'decision' in parsed) {
      const nested = ModelDecisionSchema.safeParse((parsed as { decision: unknown }).decision);
      if (nested.success) return { type: 'decision', decision: nested.data };
    }
  } catch {
    return null;
  }
  return null;
}

export class VercelGatewayClient implements GatewayModelClient {
  constructor(private readonly options: VercelGatewayClientOptions) {}

  async *complete(request: GatewayRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent> {
    const maxAttempts = Math.max(1, this.options.maxAttempts ?? 3);
    let response: Response | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      response = await fetch(`${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
          'X-Astra-Request-Id': request.requestId,
        },
        signal,
        body: JSON.stringify({
          model: request.gatewayModelId,
          messages: [
            {
              role: 'system',
              content:
                'Return exactly one JSON object describing one bounded action. Allowed kinds: message, readFile, search, patch, command, finish. Never include hidden reasoning.',
            },
            ...request.messages,
          ],
          stream: true,
          stream_options: { include_usage: true },
          response_format: { type: 'json_object' },
        }),
      });
      if (response.ok) break;
      const retryable = response.status === 429 || response.status >= 500;
      const waitMs = retryAfterMs(response);
      if (!retryable || attempt === maxAttempts) {
        throw new ModelGatewayError(
          `Model gateway returned ${response.status}`,
          response.status,
          waitMs,
        );
      }
      const jitter = Math.floor((this.options.random ?? Math.random)() * 100);
      await waitWithSignal(
        waitMs ?? Math.min(30_000, (this.options.baseDelayMs ?? 250) * 2 ** (attempt - 1) + jitter),
        signal,
      );
    }
    if (!response?.ok) throw new ModelGatewayError('Model gateway did not return a response');
    if (!response.body) throw new Error('Model gateway returned no streaming body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let usagePayload: unknown = undefined;
    let providerRequestId: string | undefined;

    const consumeLine = (line: string): ModelStreamEvent | null => {
      if (!line.startsWith('data:')) return null;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') return null;
      const parsed = JSON.parse(data) as Record<string, unknown>;
      if ('usage' in parsed || 'cost' in parsed || 'providerMetadata' in parsed)
        usagePayload = parsed;
      let providerEvent: ModelStreamEvent | null = null;
      if (typeof parsed.id === 'string' && !providerRequestId) {
        providerRequestId = parsed.id;
        providerEvent = { type: 'provider', providerRequestId };
      }
      const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
      const firstChoice = choices[0];
      const delta =
        firstChoice && typeof firstChoice === 'object'
          ? (firstChoice as Record<string, unknown>).delta
          : undefined;
      if (
        delta &&
        typeof delta === 'object' &&
        typeof (delta as Record<string, unknown>).content === 'string'
      ) {
        content += (delta as { content: string }).content;
      }
      return providerEvent;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const event = consumeLine(line.trim());
        if (event) yield ModelStreamEventSchema.parse(event);
      }
    }
    if (buffer.trim()) {
      const event = consumeLine(buffer.trim());
      if (event) yield ModelStreamEventSchema.parse(event);
    }
    const decision = extractDecision(content);
    if (!decision) throw new Error('Model gateway did not return a valid structured decision');
    yield decision;
    let usage = parseUsageReceipt(usagePayload, {
      requestId: request.requestId,
      taskId: request.taskId,
      ...(request.agentSessionId ? { agentSessionId: request.agentSessionId } : {}),
      modelId: request.modelId,
      gatewayModelId: request.gatewayModelId,
      providerRoute: request.gatewayModelId,
      ...(request.provider ? { provider: request.provider } : {}),
      ...(request.costMetadata ? { costMetadata: request.costMetadata } : {}),
    });
    if (usage) {
      if (providerRequestId && usage.gatewayRequestId !== providerRequestId) {
        usage = { ...usage, gatewayRequestId: providerRequestId };
      }
      yield { type: 'usage', receipt: usage };
    }
  }
}
