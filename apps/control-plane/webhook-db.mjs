// Postgres-backed `db` adapter for the webhook-management action (#643).
//
// The webhook-management action (packages/webhook-engine/actions/webhook-management.mjs)
// is storage-agnostic: it calls an injected `db` object. On the kind runtime we
// build that object from the control-plane pg pool here.
//
// Tenant isolation is enforced twice in this adapter. Every scoped query carries
// explicit tenant/workspace predicates, and every ordinary runtime operation
// runs in a transaction with transaction-local app.tenant_id/app.workspace_id
// settings so the same code remains production-real when migration 003/FORCE
// RLS is present. A known subscription or delivery id is never sufficient to
// read or mutate another scope.

import {
  acquireWebhookKeyWriteFence,
  WebhookKeyWriteFenceError,
} from '../../packages/webhook-engine/src/webhook-master-key-fence.mjs';

const SECRET_WRITE_FAILED_CODE = 'WEBHOOK_SECRET_WRITE_FAILED';
const SECRET_WRITE_FAILED_MESSAGE = 'Webhook signing secret could not be stored';
const DATABASE_POOLS_REQUIRED_CODE = 'WEBHOOK_DATABASE_PRINCIPALS_REQUIRED';
const DATABASE_POOLS_INVALID_CODE = 'WEBHOOK_DATABASE_PRINCIPALS_INVALID';
const DATABASE_POOLS_REQUIRED_MESSAGE =
  'Webhook database principal configuration is incomplete';
const DATABASE_POOLS_INVALID_MESSAGE =
  'Webhook database principal boundary is invalid';

class WebhookDatabasePoolConfigurationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WebhookDatabasePoolConfigurationError';
    this.code = code;
  }
}

class WebhookSigningSecretWriteError extends Error {
  constructor() {
    super(SECRET_WRITE_FAILED_MESSAGE);
    this.name = 'WebhookSigningSecretWriteError';
    this.code = SECRET_WRITE_FAILED_CODE;
  }
}

function boundedSigningSecretWriteError(caught) {
  if (caught instanceof WebhookKeyWriteFenceError) return caught;
  if (caught?.code === '55000' || caught?.message === 'WEBHOOK_KEY_WRITE_FENCED') {
    return new WebhookKeyWriteFenceError();
  }
  return new WebhookSigningSecretWriteError();
}

async function insertSubscription(client, record) {
  await client.query(
    `INSERT INTO webhook_subscriptions
       (id, tenant_id, workspace_id, target_url, event_types, status,
        consecutive_failures, max_consecutive_failures, description,
        created_by, created_at, updated_at, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      record.id, record.tenant_id, record.workspace_id, record.target_url,
      record.event_types, record.status, record.consecutive_failures ?? 0,
      record.max_consecutive_failures ?? 5, record.description ?? null,
      record.created_by, record.created_at, record.updated_at,
      record.metadata ?? {},
    ],
  );
}

async function insertSigningSecret(client, subscriptionId, encrypted, tenantId, workspaceId, encryptionKeyId) {
  await client.query(
    `INSERT INTO webhook_signing_secrets
       (subscription_id, secret_cipher, secret_iv, status, tenant_id, workspace_id, encryption_key_id)
     VALUES ($1, $2, $3, 'active', $4, $5, $6)`,
    [subscriptionId, encrypted.cipher, encrypted.iv, tenantId, workspaceId, encryptionKeyId],
  );
}

async function withSigningSecretWrite(
  writePool,
  encryptionKeyId,
  tenantId,
  workspaceId,
  write,
) {
  const client = typeof writePool.connect === 'function' ? await writePool.connect() : writePool;
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    await client.query("SET LOCAL lock_timeout = '15s'");
    await acquireWebhookKeyWriteFence(client, encryptionKeyId);
    await client.query(
      "SELECT set_config('app.tenant_id', $1, true), set_config('app.workspace_id', $2, true)",
      [tenantId, workspaceId],
    );
    const result = await write(client);
    await client.query('COMMIT');
    transactionStarted = false;
    return result;
  } catch (caught) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); } catch { /* preserve the bounded/original error */ }
    }
    throw boundedSigningSecretWriteError(caught);
  } finally {
    client.release?.();
  }
}

function requireScope(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new WebhookSigningSecretWriteError();
  }
  return value;
}

function isDatabasePool(candidate) {
  return candidate !== null
    && (typeof candidate === 'object' || typeof candidate === 'function')
    && (
      typeof candidate.query === 'function'
      || typeof candidate.connect === 'function'
    );
}

/**
 * Fail closed before a webhook adapter can persist through an omitted, shared,
 * or global control-plane pool. The five-session startup verifier remains the
 * database-level authority; this is the earliest application seam available.
 */
export function assertWebhookDatabasePoolBoundary(
  runtimePool,
  writePool,
  { controlPlanePool = null } = {},
) {
  if (!isDatabasePool(runtimePool) || !isDatabasePool(writePool)) {
    throw new WebhookDatabasePoolConfigurationError(
      DATABASE_POOLS_REQUIRED_CODE,
      DATABASE_POOLS_REQUIRED_MESSAGE,
    );
  }
  if (runtimePool === writePool
      || (controlPlanePool !== null
        && (runtimePool === controlPlanePool || writePool === controlPlanePool))) {
    throw new WebhookDatabasePoolConfigurationError(
      DATABASE_POOLS_INVALID_CODE,
      DATABASE_POOLS_INVALID_MESSAGE,
    );
  }
  return { runtimePool, writePool };
}

async function withRuntimeScope(pool, tenantId, workspaceId, work) {
  const tenant = requireScope(tenantId);
  const workspace = requireScope(workspaceId);
  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    await client.query(
      "SELECT set_config('app.tenant_id', $1, true), set_config('app.workspace_id', $2, true)",
      [tenant, workspace],
    );
    const result = await work(client);
    await client.query('COMMIT');
    transactionStarted = false;
    return result;
  } catch (caught) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); } catch { /* preserve the original bounded path */ }
    }
    throw caught;
  } finally {
    client.release?.();
  }
}

export function buildWebhookDb(pool, { writePool } = {}) {
  const {
    runtimePool,
    writePool: encryptedWritePool,
  } = assertWebhookDatabasePoolBoundary(pool, writePool);
  return {
    async getWorkspaceSubscriptionCount(tenantId, workspaceId) {
      return withRuntimeScope(runtimePool, tenantId, workspaceId, async (client) => {
        const { rows } = await client.query(
          `SELECT count(*)::int AS count
             FROM webhook_subscriptions
            WHERE tenant_id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
          [tenantId, workspaceId],
        );
        return rows[0]?.count ?? 0;
      });
    },

    async insertSecret(subscriptionId, encrypted, tenantId, workspaceId, encryptionKeyId) {
      await withSigningSecretWrite(
        encryptedWritePool,
        encryptionKeyId,
        tenantId,
        workspaceId,
        (client) => insertSigningSecret(
          client,
          subscriptionId,
          encrypted,
          tenantId,
          workspaceId,
          encryptionKeyId,
        ),
      );
    },

    async insertSubscriptionWithSecret(record, encrypted, encryptionKeyId) {
      return withSigningSecretWrite(
        encryptedWritePool,
        encryptionKeyId,
        record.tenant_id,
        record.workspace_id,
        async (client) => {
          await insertSubscription(client, record);
          await insertSigningSecret(
            client,
            record.id,
            encrypted,
            record.tenant_id,
            record.workspace_id,
            encryptionKeyId,
          );
          return record;
        },
      );
    },

    async listSubscriptions(ctx, query = {}) {
      const limit = Math.min(Number(query.limit) || 100, 200);
      return withRuntimeScope(runtimePool, ctx.tenantId, ctx.workspaceId, async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM webhook_subscriptions
            WHERE tenant_id = $1 AND workspace_id = $2 AND deleted_at IS NULL
            ORDER BY created_at DESC
            LIMIT $3`,
          [ctx.tenantId, ctx.workspaceId, limit],
        );
        return rows;
      });
    },

    async getSubscription(id, tenantId, workspaceId) {
      return withRuntimeScope(runtimePool, tenantId, workspaceId, async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM webhook_subscriptions
            WHERE id = $1 AND tenant_id = $2 AND workspace_id = $3`,
          [id, tenantId, workspaceId],
        );
        return rows[0] ?? null;
      });
    },

    async updateSubscription(id, patch, tenantId, workspaceId) {
      return withRuntimeScope(runtimePool, tenantId, workspaceId, async (client) => {
        const { rows } = await client.query(
          `UPDATE webhook_subscriptions
              SET target_url = $2,
                  event_types = $3,
                  description = COALESCE($4, description),
                  metadata = COALESCE($5, metadata),
                  updated_at = now()
            WHERE id = $1 AND tenant_id = $6 AND workspace_id = $7
          RETURNING *`,
          [
            id,
            patch.target_url,
            patch.event_types,
            patch.description ?? null,
            patch.metadata ?? null,
            tenantId,
            workspaceId,
          ],
        );
        return rows[0];
      });
    },

    async replaceSubscription(record) {
      return withRuntimeScope(
        runtimePool,
        record.tenant_id,
        record.workspace_id,
        async (client) => {
          const { rows } = await client.query(
            `UPDATE webhook_subscriptions
                SET status = $2, updated_at = $3, deleted_at = $4
              WHERE id = $1 AND tenant_id = $5 AND workspace_id = $6
            RETURNING *`,
            [
              record.id,
              record.status,
              record.updated_at,
              record.deleted_at ?? null,
              record.tenant_id,
              record.workspace_id,
            ],
          );
          return rows[0];
        },
      );
    },

    async cancelPendingDeliveries(subscriptionId, tenantId, workspaceId) {
      await withRuntimeScope(runtimePool, tenantId, workspaceId, (client) => client.query(
        `UPDATE webhook_deliveries
            SET status = 'cancelled', updated_at = now()
          WHERE subscription_id = $1 AND status = 'pending'
            AND tenant_id = $2 AND workspace_id = $3`,
        [subscriptionId, tenantId, workspaceId],
      ));
    },

    async rotateSecret(subscriptionId, encrypted, graceExpiresAt, tenantId, workspaceId, encryptionKeyId) {
      // Move the current active secret to a time-boxed grace window (tenant-scoped),
      // then issue the new active secret. Both changes share one transaction and
      // one durable key-identity fence, so lifecycle transformation cannot take a
      // snapshot between them. Verification accepts both during grace.
      await withSigningSecretWrite(
        encryptedWritePool,
        encryptionKeyId,
        tenantId,
        workspaceId,
        async (client) => {
          await client.query(
            `UPDATE webhook_signing_secrets
                SET status = 'grace', grace_expires_at = $2
              WHERE subscription_id = $1 AND status = 'active'
                AND tenant_id = $3 AND workspace_id = $4`,
            [subscriptionId, graceExpiresAt, tenantId, workspaceId],
          );
          await client.query(
            `INSERT INTO webhook_signing_secrets
               (subscription_id, secret_cipher, secret_iv, status, tenant_id, workspace_id, encryption_key_id)
             VALUES ($1, $2, $3, 'active', $4, $5, $6)`,
            [subscriptionId, encrypted.cipher, encrypted.iv, tenantId, workspaceId, encryptionKeyId],
          );
        },
      );
    },

    async listDeliveries(subscriptionId, query = {}, tenantId, workspaceId) {
      // The owning subscription is already tenant-checked by the action before this runs.
      const limit = Math.min(Number(query.limit) || 100, 200);
      return withRuntimeScope(runtimePool, tenantId, workspaceId, async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM webhook_deliveries
            WHERE subscription_id = $1
              AND tenant_id = $2 AND workspace_id = $3
            ORDER BY created_at DESC
            LIMIT $4`,
          [subscriptionId, tenantId, workspaceId, limit],
        );
        return rows;
      });
    },

    async getDelivery(subscriptionId, deliveryId, tenantId, workspaceId) {
      return withRuntimeScope(runtimePool, tenantId, workspaceId, async (client) => {
        const { rows } = await client.query(
          `SELECT * FROM webhook_deliveries
            WHERE subscription_id = $1 AND id = $2
              AND tenant_id = $3 AND workspace_id = $4`,
          [subscriptionId, deliveryId, tenantId, workspaceId],
        );
        return rows[0] ?? null;
      });
    },
  };
}
