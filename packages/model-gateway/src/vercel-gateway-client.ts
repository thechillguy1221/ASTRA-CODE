import { ModelDecisionSchema, ModelStreamEventSchema } from '@lyntar/contracts';
import type { ModelStreamEvent } from '@lyntar/contracts';
import type { GatewayModelClient, GatewayRequest } from './contracts.js';
import { parseUsageReceipt } from './receipt.js';

interface VercelGatewayClientOptions {
  baseUrl: string;
  apiKey: string;
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
    const response = await fetch(`${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
        'X-Lyntar-Request-Id': request.requestId,
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
    if (!response.ok) throw new Error(`Model gateway returned ${response.status}`);
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
