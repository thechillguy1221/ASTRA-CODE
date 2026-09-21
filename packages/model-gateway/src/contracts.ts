import type {
  ModelCostMetadata,
  ModelDecision,
  ModelRequest,
  ModelStreamEvent,
} from '@astra/contracts';

export interface GatewayRequest extends ModelRequest {
  gatewayModelId: string;
  provider?: string;
  costMetadata?: ModelCostMetadata;
}

export interface GatewayModelClient {
  complete(request: GatewayRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent>;
}

export interface ReceiptContext {
  requestId: string;
  taskId: string;
  agentSessionId?: string;
  modelId: string;
  gatewayModelId?: string;
  provider?: string;
  providerRoute: string;
  costMetadata?: ModelCostMetadata;
}

export interface ParsedGatewayCompletion {
  decision: ModelDecision;
  providerRequestId?: string;
  rawUsage?: unknown;
}
