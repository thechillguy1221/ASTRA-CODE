import { createPostgresStores, applyFoundationMigration } from '@astra/db';

const connectionString = process.env.ASTRA_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString)
  throw new Error('DATABASE_URL or ASTRA_DATABASE_URL is required for migrations');
const stores = createPostgresStores(connectionString);
const client = await stores.pool.connect();
try {
  await applyFoundationMigration(client);
  console.log(JSON.stringify({ status: 'migrated', database: 'postgresql' }));
} finally {
  client.release();
  await stores.pool.end();
}
