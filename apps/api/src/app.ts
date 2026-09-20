import Fastify, { type FastifyInstance } from 'fastify';
import {
  createMemoryCatalog,
  createMemoryEventStore,
  createMemoryReceiptStore,
  type AgentEventStore,
  type ModelCatalogStore,
  type UsageReceiptStore,
} from '@lyntar/db';
import type { GatewayModelClient } from '@lyntar/model-gateway';
import { registerModelRoutes } from './model-route.js';
import { registerAgentEventRoutes } from './event-route.js';

export interface ApiDependencies {
  catalog?: ModelCatalogStore;
  receipts?: UsageReceiptStore;
  events?: AgentEventStore;
  gateway?: GatewayModelClient;
}

const unavailableGateway: GatewayModelClient = {
  complete() {
    return (async function* unavailableCompletion() {
      yield* [];
      throw new Error('No model gateway configured');
    })();
  },
};

export function buildApi(dependencies: ApiDependencies = {}): FastifyInstance {
  const app = Fastify({ logger: false });
  const catalog = dependencies.catalog ?? createMemoryCatalog([]);
  const receipts = dependencies.receipts ?? createMemoryReceiptStore();
  const events = dependencies.events ?? createMemoryEventStore();
  app.get('/health', async () => ({ status: 'ok' }));
  void registerModelRoutes(app, {
    catalog,
    receipts,
    gateway: dependencies.gateway ?? unavailableGateway,
  });
  void registerAgentEventRoutes(app, events);
  return app;
}
