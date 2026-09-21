import type { ModelCostMetadata } from '@astra/contracts';
import { ModelGatewayError } from './vercel-gateway-client.js';

export interface ResponsesGatewayRequest {
  requestId: string;
  model: string;
  body: Record<string, unknown>;
  costMetadata?: ModelCostMetadata;
}

export interface ResponsesGatewayEvent {
  event: string | null;
  data: Record<string, unknown> | null;
}

export interface ResponsesGatewayClient {
  stream(
    request: ResponsesGatewayRequest,
    signal: AbortSignal,
  ): AsyncIterable<ResponsesGatewayEvent>;
}

function parseEventData(data: string): Record<string, unknown> | null {
  if (!data || data === '[DONE]') return null;
  try {
    const value = JSON.parse(data) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function* parseSseBlock(block: string): Generator<ResponsesGatewayEvent> {
  let event: string | null = null;
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim() || null;
    else if (line.startsWith('data:')) data.push(line.slice('data:'.length).trimStart());
  }
  const parsed = parseEventData(data.join('\n'));
  if (event || parsed) yield { event, data: parsed };
}

/**
 * Server-only Responses transport for the configured Astra/Vercel gateway.
 * The desktop never receives this client's credential or configuration.
 */
export class VercelResponsesGatewayClient implements ResponsesGatewayClient {
  constructor(
    private readonly options: {
      baseUrl: string;
      apiKey: string;
    },
  ) {}

  async *stream(
    request: ResponsesGatewayRequest,
    signal: AbortSignal,
  ): AsyncIterable<ResponsesGatewayEvent> {
    const response = await fetch(`${this.options.baseUrl.replace(/\/$/, '')}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'X-Astra-Request-Id': request.requestId,
      },
      body: JSON.stringify({ ...request.body, model: request.model, stream: true }),
      signal,
    });
    if (!response.ok)
      throw new ModelGatewayError(`Model gateway returned ${response.status}`, response.status);
    if (!response.body) throw new Error('Model gateway returned no Responses stream');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const flush = function* (complete: boolean): Generator<ResponsesGatewayEvent> {
      const blocks = buffer.split(/\r?\n\r?\n/);
      if (!complete) buffer = blocks.pop() ?? '';
      else buffer = '';
      for (const block of blocks) yield* parseSseBlock(block);
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      yield* flush(false);
    }
    buffer += decoder.decode();
    yield* flush(true);
  }
}
