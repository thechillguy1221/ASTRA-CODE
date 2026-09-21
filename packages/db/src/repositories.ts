import { randomUUID } from 'node:crypto';
import type { AgentEvent, ModelCatalogEntry, UsageReceipt } from '@astra/contracts';

export interface UsageReceiptStore {
  save(receipt: UsageReceipt): Promise<void>;
  listForTask(taskId: string): Promise<UsageReceipt[]>;
}

export interface ModelCatalogStore {
  listEnabled(): Promise<ModelCatalogEntry[]>;
  getEnabled(modelId: string): Promise<ModelCatalogEntry | undefined>;
}

export interface AgentEventStore {
  append(event: AgentEvent): Promise<void>;
  listForTask(taskId: string): Promise<AgentEvent[]>;
}

export class InMemoryUsageReceiptStore implements UsageReceiptStore {
  private readonly receipts: UsageReceipt[] = [];

  async save(receipt: UsageReceipt): Promise<void> {
    if (this.receipts.some((existing) => existing.requestId === receipt.requestId)) return;
    this.receipts.push(receipt);
  }

  async listForTask(taskId: string): Promise<UsageReceipt[]> {
    return this.receipts
      .filter((receipt) => receipt.taskId === taskId)
      .map((receipt) => ({ ...receipt }));
  }
}

export class InMemoryModelCatalogStore implements ModelCatalogStore {
  constructor(private readonly models: ModelCatalogEntry[]) {}

  async listEnabled(): Promise<ModelCatalogEntry[]> {
    return this.models
      .filter((model) => model.enabled && model.visible !== false)
      .map((model) => ({ ...model }));
  }

  async getEnabled(modelId: string): Promise<ModelCatalogEntry | undefined> {
    const model = this.models.find(
      (candidate) =>
        candidate.modelId === modelId && candidate.enabled && candidate.visible !== false,
    );
    return model ? { ...model } : undefined;
  }
}

export class InMemoryAgentEventStore implements AgentEventStore {
  private readonly events: AgentEvent[] = [];

  async append(event: AgentEvent): Promise<void> {
    if (this.events.some((existing) => existing.eventId === event.eventId)) return;
    this.events.push(event);
  }

  async listForTask(taskId: string): Promise<AgentEvent[]> {
    return this.events.filter((event) => event.taskId === taskId).map((event) => ({ ...event }));
  }
}

export function createMemoryReceiptStore(): InMemoryUsageReceiptStore {
  return new InMemoryUsageReceiptStore();
}

export function createMemoryCatalog(models: ModelCatalogEntry[]): InMemoryModelCatalogStore {
  return new InMemoryModelCatalogStore(models);
}

export function createMemoryEventStore(): InMemoryAgentEventStore {
  return new InMemoryAgentEventStore();
}

export function newReceiptId(): string {
  return randomUUID();
}
