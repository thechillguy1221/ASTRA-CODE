import { loadConfig } from '@lyntar/config';
import { applyFoundationMigration, createPostgresStores } from '@lyntar/db';
import { VercelGatewayClient } from '@lyntar/model-gateway';
import { buildApi } from './app.js';

const config = loadConfig();
const postgres = config.databaseUrl ? createPostgresStores(config.databaseUrl) : undefined;
if (postgres) {
  const client = await postgres.pool.connect();
  try {
    await applyFoundationMigration(client);
  } finally {
    client.release();
  }
}
const gateway =
  config.modelGatewayBaseUrl && config.modelGatewayApiKey
    ? new VercelGatewayClient({
        baseUrl: config.modelGatewayBaseUrl,
        apiKey: config.modelGatewayApiKey,
      })
    : undefined;
const app = buildApi({
  ...(postgres
    ? { catalog: postgres.catalog, receipts: postgres.receipts, events: postgres.events }
    : {}),
  ...(gateway ? { gateway } : {}),
});
if (postgres) app.addHook('onClose', async () => postgres.pool.end());
await app.listen({ port: config.apiPort, host: '127.0.0.1' });
