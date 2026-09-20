import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { applyFoundationMigration, createPostgresStores } from '@lyntar/db';

const execFileAsync = promisify(execFile);
const databaseUrl = process.env.LYNTAR_DATABASE_URL;

function sanitize(value) {
  return String(value).replace(/postgres(?:ql)?:\/\/[^\s]+/gi, 'postgres://[redacted]');
}

async function executableAvailable(name) {
  try {
    await execFileAsync(process.platform === 'win32' ? 'where.exe' : 'which', [name]);
    return true;
  } catch {
    return false;
  }
}

async function backupAndRestore() {
  const restoreUrl = process.env.LYNTAR_POSTGRES_RESTORE_URL;
  const hasDump = await executableAvailable('pg_dump');
  const hasRestore = await executableAvailable('pg_restore');
  if (!hasDump || !hasRestore || !restoreUrl) {
    return {
      status: 'BLOCKED',
      reason: 'pg_dump, pg_restore, and LYNTAR_POSTGRES_RESTORE_URL are required',
    };
  }

  const directory = await mkdtemp(join(tmpdir(), 'lyntar-postgres-cert-'));
  const backupPath = join(directory, 'lyntar.dump');
  try {
    await execFileAsync('pg_dump', ['--format=custom', '--file', backupPath, databaseUrl]);
    await execFileAsync('pg_restore', [
      '--no-owner',
      '--clean',
      '--if-exists',
      '--dbname',
      restoreUrl,
      backupPath,
    ]);
    return { status: 'PASS', format: 'custom', restored: true };
  } catch (error) {
    return { status: 'FAILED', reason: sanitize(error instanceof Error ? error.message : error) };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function certify() {
  if (!databaseUrl) {
    return {
      status: 'BLOCKED',
      reason: 'LYNTAR_DATABASE_URL is not configured',
      backupRestore: { status: 'BLOCKED' },
    };
  }

  const stores = createPostgresStores(databaseUrl);
  const ids = {
    model: `cert-model-${randomUUID()}`,
    task: `cert-task-${randomUUID()}`,
    request: `cert-request-${randomUUID()}`,
    rollbackRequest: `cert-rollback-${randomUUID()}`,
    event: `cert-event-${randomUUID()}`,
  };
  const results = {};
  try {
    const client = await stores.pool.connect();
    try {
      const version = await client.query('SHOW server_version');
      results.connectivity = { status: 'PASS', serverVersion: version.rows[0].server_version };
      await applyFoundationMigration(client);
      await applyFoundationMigration(client);
      results.migration = { status: 'PASS', idempotent: true };
    } finally {
      client.release();
    }
    const concurrentMigrationClients = await Promise.all([
      stores.pool.connect(),
      stores.pool.connect(),
    ]);
    try {
      await Promise.all(
        concurrentMigrationClients.map((migrationClient) =>
          applyFoundationMigration(migrationClient),
        ),
      );
      results.migration.concurrentStartup = 'PASS';
    } finally {
      concurrentMigrationClients.forEach((migrationClient) => migrationClient.release());
    }

    await stores.pool.query(
      `INSERT INTO model_catalog
        (model_id, display_name, gateway_model_id, provider_slug, provider, enabled, visible, capabilities, cost_metadata)
       VALUES ($1, $1, $1, 'cert', 'cert', true, true, $2::jsonb, '{}'::jsonb)`,
      [
        ids.model,
        JSON.stringify({
          supportsTools: true,
          supportsStreaming: true,
          supportsReasoning: false,
          supportsStructuredOutput: true,
          supportsImageInput: false,
        }),
      ],
    );

    const receipt = {
      requestId: ids.request,
      gatewayRequestId: `gateway-${ids.request}`,
      taskId: ids.task,
      agentTaskId: ids.task,
      agentSessionId: `session-${ids.task}`,
      modelId: ids.model,
      gatewayModelId: ids.model,
      provider: 'cert',
      providerRoute: 'cert/model',
      inputTokens: 10,
      outputTokens: 5,
      cacheTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningUnits: null,
      otherBillableUnits: null,
      actualCostUsd: 0.001,
      calculatedExpectedCostUsd: 0.001,
      costDifferenceUsd: 0,
      billingAnomaly: false,
      receivedAt: new Date().toISOString(),
    };
    await Promise.all([stores.receipts.save(receipt), stores.receipts.save(receipt)]);
    const duplicateCount = await stores.pool.query(
      'SELECT count(*)::int AS count FROM usage_receipts WHERE request_id = $1',
      [ids.request],
    );
    results.duplicateReceipt = { status: duplicateCount.rows[0].count === 1 ? 'PASS' : 'FAILED' };

    const event = {
      eventId: ids.event,
      taskId: ids.task,
      occurredAt: new Date().toISOString(),
      type: 'task.started',
      payload: { summary: 'PostgreSQL certification event' },
    };
    await Promise.all([stores.events.append(event), stores.events.append(event)]);
    const storedEvents = await stores.events.listForTask(ids.task);
    results.duplicateEvent = { status: storedEvents.length === 1 ? 'PASS' : 'FAILED' };

    const rollbackClient = await stores.pool.connect();
    try {
      await rollbackClient.query('BEGIN');
      await rollbackClient.query(
        `INSERT INTO usage_receipts
          (id, request_id, task_id, model_id, provider_route, received_at)
         VALUES ($1, $2, $3, $4, $5, now())`,
        [randomUUID(), ids.rollbackRequest, ids.task, ids.model, 'cert/model'],
      );
      try {
        await rollbackClient.query('SELECT 1 / 0');
      } catch {
        await rollbackClient.query('ROLLBACK');
      }
    } finally {
      rollbackClient.release();
    }
    const rolledBack = await stores.pool.query(
      'SELECT count(*)::int AS count FROM usage_receipts WHERE request_id = $1',
      [ids.rollbackRequest],
    );
    results.transactionRollback = { status: rolledBack.rows[0].count === 0 ? 'PASS' : 'FAILED' };

    const ledgerClient = await stores.pool.connect();
    let updateRejected = false;
    let deleteRejected = false;
    try {
      await ledgerClient.query('BEGIN');
      const userId = randomUUID();
      await ledgerClient.query('INSERT INTO users (id) VALUES ($1)', [userId]);
      const entryId = randomUUID();
      await ledgerClient.query(
        `INSERT INTO credit_ledger_entries
          (id, user_id, amount_credits, transaction_type, reason)
         VALUES ($1, $2, 1, 'ADJUSTMENT', 'certification')`,
        [entryId, userId],
      );
      try {
        await ledgerClient.query('UPDATE credit_ledger_entries SET reason = $1 WHERE id = $2', [
          'mutated',
          entryId,
        ]);
      } catch {
        updateRejected = true;
        await ledgerClient.query('ROLLBACK');
      }
      await ledgerClient.query('BEGIN');
      await ledgerClient.query('INSERT INTO users (id) VALUES ($1)', [userId]);
      await ledgerClient.query(
        `INSERT INTO credit_ledger_entries
          (id, user_id, amount_credits, transaction_type, reason)
         VALUES ($1, $2, 1, 'ADJUSTMENT', 'certification')`,
        [randomUUID(), userId],
      );
      try {
        await ledgerClient.query('DELETE FROM credit_ledger_entries WHERE user_id = $1', [userId]);
      } catch {
        deleteRejected = true;
        await ledgerClient.query('ROLLBACK');
      }
    } finally {
      ledgerClient.release();
    }
    results.ledgerImmutability = {
      status: updateRejected && deleteRejected ? 'PASS' : 'FAILED',
    };

    await stores.pool.end();
    const reopened = createPostgresStores(databaseUrl);
    try {
      const persisted = await reopened.receipts.listForTask(ids.task);
      results.persistence = { status: persisted.length === 1 ? 'PASS' : 'FAILED' };
    } finally {
      await reopened.pool.query('DELETE FROM agent_events WHERE event_id = $1', [ids.event]);
      await reopened.pool.query('DELETE FROM usage_receipts WHERE request_id = $1', [ids.request]);
      await reopened.pool.query('DELETE FROM model_catalog WHERE model_id = $1', [ids.model]);
      await reopened.pool.end();
    }
    results.backupRestore = await backupAndRestore();
    const required = [
      'connectivity',
      'migration',
      'duplicateReceipt',
      'duplicateEvent',
      'transactionRollback',
      'persistence',
      'ledgerImmutability',
    ];
    const status = required.every((key) => results[key]?.status === 'PASS') ? 'PASS' : 'FAILED';
    return { status, results };
  } catch (error) {
    await stores.pool.end().catch(() => undefined);
    return {
      status: 'FAILED',
      reason: sanitize(error instanceof Error ? error.message : error),
      results,
    };
  }
}

const report =
  process.env.LYNTAR_POSTGRES_CERTIFY === '1'
    ? await certify()
    : {
        status: 'BLOCKED',
        reason: 'Set LYNTAR_POSTGRES_CERTIFY=1 only for a disposable certification database',
        backupRestore: { status: 'BLOCKED' },
      };
console.log(`[POSTGRES-CERTIFICATION] ${JSON.stringify(report)}`);
if (report.status !== 'PASS' || report.backupRestore?.status !== 'PASS') process.exitCode = 2;
