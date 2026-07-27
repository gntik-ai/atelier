import { decryptSecret, encryptSecret } from './webhook-signing.mjs';
import {
  WebhookKeyError,
  assertWebhookKeyId,
  assertWebhookKeyContext,
  createCanonicalWebhookKeyContext,
  createLifecycleWebhookKeyContext,
  createRuntimeWebhookKeyContext,
} from './webhook-master-key.mjs';
import {
  acquireWebhookKeyLifecycleFence,
  assumeWebhookKeyLifecycleAuthority,
} from './webhook-master-key-fence.mjs';

const VERIFY_SENTINEL = 'falcone:webhook-master-key:v1';
const COMMIT_OUTCOME_UNKNOWN = Symbol('webhook.commit-outcome-unknown');
const VALID_ACTIONS = new Set(['adopt', 'rotate', 'recover', 'finalize']);
const VALID_LIFECYCLE_CODES = new Set([
  'WEBHOOK_ADOPTION_REQUIRED',
  'WEBHOOK_CONSUMERS_NOT_QUIESCED',
  'WEBHOOK_FINALIZE_TOO_EARLY',
  'WEBHOOK_KEY_CUSTODY_CONFLICT',
  'WEBHOOK_KEY_IDENTITY_CONFLICT',
  'WEBHOOK_KEY_STATE_AMBIGUOUS',
  'WEBHOOK_KEY_STATE_CONFLICT',
  'WEBHOOK_LIFECYCLE_FAILED',
  'WEBHOOK_LIFECYCLE_INPUT_INVALID',
  'WEBHOOK_LIFECYCLE_REQUEST_CONFLICT',
  'WEBHOOK_RECOVERY_NOT_AVAILABLE',
  'WEBHOOK_RECOVERY_WINDOW_EXPIRED',
  'WEBHOOK_ROTATION_ID_CONFLICT',
  'WEBHOOK_ROW_KEY_MISMATCH',
]);

const SAFE_MESSAGES = Object.freeze({
  WEBHOOK_ADOPTION_REQUIRED: 'Existing webhook secrets require explicit legacy adoption',
  WEBHOOK_CONSUMERS_NOT_QUIESCED: 'Webhook consumers are not confirmed quiesced',
  WEBHOOK_FINALIZE_TOO_EARLY: 'Webhook recovery material cannot be finalized yet',
  WEBHOOK_KEY_CUSTODY_CONFLICT: 'Webhook key custody conflicts with durable lifecycle state',
  WEBHOOK_KEY_IDENTITY_CONFLICT: 'Webhook key identities must be distinct',
  WEBHOOK_KEY_STATE_AMBIGUOUS: 'Webhook key lifecycle state is ambiguous',
  WEBHOOK_KEY_STATE_CONFLICT: 'Webhook key lifecycle state conflicts with the request',
  WEBHOOK_LIFECYCLE_FAILED: 'Webhook key lifecycle operation failed',
  WEBHOOK_LIFECYCLE_INPUT_INVALID: 'Webhook key lifecycle input is invalid',
  WEBHOOK_LIFECYCLE_REQUEST_CONFLICT: 'Webhook key lifecycle request identifier is already bound',
  WEBHOOK_RECOVERY_NOT_AVAILABLE: 'Webhook recovery material is not available',
  WEBHOOK_RECOVERY_WINDOW_EXPIRED: 'Webhook recovery state requires explicit finalization',
  WEBHOOK_ROTATION_ID_CONFLICT: 'Webhook rotation identifier is already bound',
  WEBHOOK_ROW_KEY_MISMATCH: 'Webhook signing-secret rows do not match one serving key',
});

export class WebhookLifecycleError extends Error {
  constructor(code) {
    super(SAFE_MESSAGES[code] ?? SAFE_MESSAGES.WEBHOOK_LIFECYCLE_FAILED);
    this.name = 'WebhookLifecycleError';
    this.code = VALID_LIFECYCLE_CODES.has(code) ? code : 'WEBHOOK_LIFECYCLE_FAILED';
  }
}

function fail(code) {
  throw new WebhookLifecycleError(code);
}

function requireId(value) {
  const id = String(value ?? '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) fail('WEBHOOK_LIFECYCLE_INPUT_INVALID');
  return id;
}

function requireWindow(value) {
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 300 || seconds > 2_592_000) {
    fail('WEBHOOK_LIFECYCLE_INPUT_INVALID');
  }
  return seconds;
}

function requireClock(value) {
  const clock = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(clock.getTime())) fail('WEBHOOK_LIFECYCLE_INPUT_INVALID');
  return clock;
}

function safeError(caught) {
  if (caught instanceof WebhookLifecycleError || caught instanceof WebhookKeyError) {
    return { code: caught.code, message: caught.message };
  }
  return { code: 'WEBHOOK_LIFECYCLE_FAILED', message: SAFE_MESSAGES.WEBHOOK_LIFECYCLE_FAILED };
}

function commitOutcomeUnknown(caught) {
  const error = new Error('Webhook lifecycle commit outcome is unknown');
  error[COMMIT_OUTCOME_UNKNOWN] = true;
  error.cause = caught;
  return error;
}

function verificationRecord(context) {
  return encryptSecret(VERIFY_SENTINEL, context);
}

function verifyRecord(cipher, iv, context) {
  try {
    if (decryptSecret(cipher, iv, context) !== VERIFY_SENTINEL) throw new Error('sentinel mismatch');
  } catch {
    throw new WebhookKeyError('WEBHOOK_KEY_VERIFICATION_FAILED');
  }
}

async function withLockedTransaction(pool, work) {
  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
  let commitAttempted = false;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '15s'");
    await client.query("SET LOCAL statement_timeout = '30min'");
    await acquireWebhookKeyLifecycleFence(client);
    const result = await work(client);
    commitAttempted = true;
    await client.query('COMMIT');
    return result;
  } catch (caught) {
    try { await client.query('ROLLBACK'); } catch { /* keep the original bounded error */ }
    if (commitAttempted) throw commitOutcomeUnknown(caught);
    throw caught;
  } finally {
    client.release?.();
  }
}

/**
 * Execute one repository read under the fixed lifecycle authority without
 * widening the lifecycle LOGIN's direct privileges. The leaf read helpers
 * below accept this already-leased client; mutating transactions call those
 * helpers directly and therefore never start a nested transaction or lease a
 * second connection.
 */
async function withLifecycleAuthorityRead(pool, work) {
  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
  let transactionStarted = false;
  try {
    await client.query(
      'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
    );
    transactionStarted = true;
    await assumeWebhookKeyLifecycleAuthority(client);
    const result = await work(client);
    await client.query('COMMIT');
    transactionStarted = false;
    return result;
  } catch (caught) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); } catch { /* preserve the original read failure */ }
    }
    throw caught;
  } finally {
    client.release?.();
  }
}

function auditDetail(result, overrides = {}) {
  return {
    actionCategory: 'configuration_change',
    source: 'platform-maintenance',
    action: result.action,
    requestId: result.requestId,
    rotationId: result.rotationId ?? null,
    sourceKeyId: result.sourceKeyId ?? null,
    targetKeyId: result.targetKeyId ?? null,
    sourceManaged: result.sourceManaged ?? null,
    targetManaged: result.targetManaged ?? null,
    state: result.state,
    affectedCount: Number(result.affectedCount ?? 0),
    verifiedCount: Number(result.verifiedCount ?? 0),
    recoveryDeadline: result.recoveryDeadline ?? null,
    errorCode: result.errorCode ?? null,
    ...overrides,
  };
}

async function emitLifecycleAudit(client, auditWriter, result, outcome, overrides = {}) {
  if (!auditWriter) return null;
  return auditWriter(client, {
    actionType: `webhook.master-key.${result.action}`,
    actorId: 'falcone:platform-maintenance',
    tenantId: null,
    workspaceId: null,
    outcome,
    previousState: null,
    newState: auditDetail(result, overrides),
    correlationId: result.requestId,
  });
}

async function markAmbiguousCommit(
  pool,
  binding,
  targetContext,
  sourceContext,
  auditWriter,
) {
  try {
    return await withLockedTransaction(pool, async (client) => {
      const ledger = await readLedger(client, binding.request_id);
      assertLedgerBinding(ledger, binding);
      if (ledger?.lifecycle_state !== 'completed') return false;
      await assertDurableReplayState(client, ledger, {
        lock: true,
        targetContext,
        sourceContext,
      });
      await client.query(
        `UPDATE webhook_master_key_state
            SET lifecycle_state = 'recovery_required', updated_at = now()
          WHERE singleton_id = 1 AND active_request_id = $1`,
        [binding.request_id],
      );
      const changed = await client.query(
        `UPDATE webhook_master_key_rotations
            SET lifecycle_state = 'recovery_required', updated_at = now()
          WHERE request_id = $1 AND lifecycle_state = 'completed'`,
        [binding.request_id],
      );
      if (Number(changed.rowCount ?? 0) === 1) {
        await emitLifecycleAudit(
          client,
          auditWriter,
          { ...ledgerResult(ledger), state: 'recovery_required' },
          'recovery_required',
        );
      }
      return true;
    });
  } catch {
    return false;
  }
}

async function resumeAmbiguousCommit(
  client,
  ledger,
  binding,
  targetContext,
  sourceContext,
  auditWriter,
) {
  if (ledger?.lifecycle_state !== 'recovery_required') return null;
  await assertDurableReplayState(client, ledger, {
    lock: true,
    targetContext,
    sourceContext,
  });
  await client.query(
    `UPDATE webhook_master_key_state
        SET lifecycle_state = 'serving', updated_at = now()
      WHERE singleton_id = 1 AND active_request_id = $1`,
    [binding.request_id],
  );
  const { rows } = await client.query(
    `UPDATE webhook_master_key_rotations
        SET lifecycle_state = 'completed', completed_at = now(), updated_at = now()
      WHERE request_id = $1 AND lifecycle_state = 'recovery_required'
      RETURNING request_id, action, rotation_id, source_key_id, target_key_id,
        source_mode, target_mode, source_managed, target_managed,
        lifecycle_state, affected_count, verified_count,
        recovery_window_seconds, recovery_deadline, error_code, completed_at`,
    [binding.request_id],
  );
  const result = ledgerResult(rows[0]);
  await emitLifecycleAudit(client, auditWriter, result, 'succeeded', { reconciled: true });
  return result;
}

async function readState(client, lock = false) {
  const suffix = lock ? ' FOR UPDATE' : '';
  const { rows } = await client.query(`SELECT * FROM webhook_master_key_state WHERE singleton_id = 1${suffix}`);
  return rows[0] ?? null;
}

async function readLedger(client, requestId) {
  const { rows } = await client.query(
    `SELECT request_id, action, rotation_id, source_key_id, target_key_id,
            source_mode, target_mode, source_managed, target_managed,
            lifecycle_state, affected_count,
            verified_count, recovery_window_seconds, recovery_deadline,
            error_code, error_message, started_at, completed_at, updated_at
       FROM webhook_master_key_rotations
      WHERE request_id = $1`,
    [requestId],
  );
  return rows[0] ?? null;
}

function ledgerResult(row) {
  return {
    action: row.action,
    requestId: row.request_id,
    rotationId: row.rotation_id ?? null,
    sourceKeyId: row.source_key_id ?? null,
    targetKeyId: row.target_key_id ?? null,
    sourceManaged: row.source_managed ?? null,
    targetManaged: row.target_managed ?? null,
    state: row.lifecycle_state,
    affectedCount: Number(row.affected_count ?? 0),
    verifiedCount: Number(row.verified_count ?? 0),
    recoveryDeadline: row.recovery_deadline ?? null,
    errorCode: row.error_code ?? null,
  };
}

function assertLedgerBinding(row, expected) {
  if (!row) return null;
  const fields = [
    'action', 'rotation_id', 'source_key_id', 'target_key_id',
    'source_mode', 'target_mode', 'target_managed',
  ];
  if (fields.some((field) => Object.hasOwn(expected, field)
      && (row[field] ?? null) !== (expected[field] ?? null))) {
    fail('WEBHOOK_LIFECYCLE_REQUEST_CONFLICT');
  }
  if (expected.recovery_window_seconds != null
      && Number(row.recovery_window_seconds) !== Number(expected.recovery_window_seconds)) {
    fail('WEBHOOK_LIFECYCLE_REQUEST_CONFLICT');
  }
  return row.lifecycle_state === 'completed' ? ledgerResult(row) : null;
}

async function insertCompletedLedger(client, record, auditWriter) {
  const { rows } = await client.query(
    `INSERT INTO webhook_master_key_rotations
       (request_id, action, rotation_id, source_key_id, target_key_id,
        source_mode, target_mode, source_managed, target_managed,
        lifecycle_state, affected_count, verified_count,
        recovery_window_seconds, recovery_deadline, completed_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'completed',$10,$11,$12,$13,now(),now())
     ON CONFLICT (request_id) DO UPDATE
       SET lifecycle_state = 'completed', affected_count = EXCLUDED.affected_count,
           verified_count = EXCLUDED.verified_count,
           source_managed = EXCLUDED.source_managed,
           target_managed = EXCLUDED.target_managed,
           recovery_deadline = EXCLUDED.recovery_deadline,
           error_code = NULL, error_message = NULL, completed_at = now(), updated_at = now()
     RETURNING request_id, action, rotation_id, source_key_id, target_key_id,
       source_mode, target_mode, source_managed, target_managed,
       lifecycle_state, affected_count, verified_count,
       recovery_window_seconds, recovery_deadline, error_code, completed_at`,
    [
      record.request_id, record.action, record.rotation_id ?? null,
      record.source_key_id ?? null, record.target_key_id ?? null,
      record.source_mode ?? null, record.target_mode ?? null,
      record.source_managed ?? null, record.target_managed ?? null,
      record.affected_count ?? 0, record.verified_count ?? 0,
      record.recovery_window_seconds ?? null, record.recovery_deadline ?? null,
    ],
  );
  const result = ledgerResult(rows[0]);
  await emitLifecycleAudit(client, auditWriter, result, 'succeeded');
  return result;
}

async function recordFailure(pool, binding, caught, auditWriter) {
  const error = safeError(caught);
  try {
    await withLockedTransaction(pool, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO webhook_master_key_rotations
           (request_id, action, rotation_id, source_key_id, target_key_id,
            source_mode, target_mode, source_managed, target_managed,
            lifecycle_state, recovery_window_seconds,
            error_code, error_message, completed_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'failed',$10,$11,$12,now(),now())
         ON CONFLICT (request_id) DO NOTHING
         RETURNING request_id, action, rotation_id, source_key_id, target_key_id,
           source_mode, target_mode, source_managed, target_managed,
           lifecycle_state, affected_count, verified_count,
           recovery_window_seconds, recovery_deadline, error_code, completed_at`,
        [
          binding.request_id, binding.action, binding.rotation_id ?? null,
          binding.source_key_id ?? null, binding.target_key_id ?? null,
          binding.source_mode ?? null, binding.target_mode ?? null,
          binding.source_managed ?? null, binding.target_managed ?? null,
          binding.recovery_window_seconds ?? null, error.code, error.message,
        ],
      );
      if (rows[0]) await emitLifecycleAudit(client, auditWriter, ledgerResult(rows[0]), 'failed');
    });
  } catch {
    // A diagnostic write must never replace the original fail-closed result.
  }
  if (caught instanceof WebhookKeyError) throw caught;
  throw new WebhookLifecycleError(error.code);
}

function assertQuiesced(value) {
  if (value !== true) fail('WEBHOOK_CONSUMERS_NOT_QUIESCED');
}

function assertStateIdentity(state, context) {
  assertWebhookKeyContext(context);
  if (!state || state.current_key_id !== context.keyId || state.current_mode !== context.mode) {
    fail('WEBHOOK_KEY_STATE_CONFLICT');
  }
  verifyRecord(state.current_verification_cipher, state.current_verification_iv, context);
}

async function assertRowsUseKey(client, keyId) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS count
       FROM webhook_signing_secrets
      WHERE encryption_key_id IS DISTINCT FROM $1`,
    [keyId],
  );
  if (Number(rows[0]?.count ?? 0) !== 0) fail('WEBHOOK_ROW_KEY_MISMATCH');
}

function assertNoRecoveryIdentity(state) {
  const fields = [
    'recovery_key_id',
    'recovery_mode',
    'recovery_managed',
    'recovery_verification_cipher',
    'recovery_verification_iv',
    'recovery_deadline',
  ];
  if (fields.some((field) => state[field] != null)) {
    fail('WEBHOOK_KEY_STATE_CONFLICT');
  }
}

async function assertDurableReplayState(client, ledger, {
  lock = false,
  targetContext = null,
  sourceContext = null,
} = {}) {
  const state = await readState(client, lock);
  const permittedState = ledger.lifecycle_state === 'recovery_required'
    ? 'recovery_required'
    : 'serving';
  if (!state || state.lifecycle_state !== permittedState) {
    fail('WEBHOOK_KEY_STATE_AMBIGUOUS');
  }
  if (state.active_request_id !== ledger.request_id
      || (state.active_rotation_id ?? null) !== (ledger.rotation_id ?? null)
      || state.current_key_id !== ledger.target_key_id
      || state.current_mode !== ledger.target_mode) {
    fail('WEBHOOK_KEY_STATE_CONFLICT');
  }
  if (state.current_managed !== ledger.target_managed) {
    fail('WEBHOOK_KEY_CUSTODY_CONFLICT');
  }

  if (['rotate', 'recover'].includes(ledger.action)) {
    if (state.recovery_key_id !== ledger.source_key_id
        || state.recovery_mode !== ledger.source_mode) {
      fail('WEBHOOK_KEY_STATE_CONFLICT');
    }
    if (state.recovery_managed !== ledger.source_managed) {
      fail('WEBHOOK_KEY_CUSTODY_CONFLICT');
    }
  } else {
    assertNoRecoveryIdentity(state);
  }

  if (targetContext) assertStateIdentity(state, targetContext);
  if (sourceContext) {
    if (state.recovery_key_id !== sourceContext.keyId
        || state.recovery_mode !== sourceContext.mode) {
      fail('WEBHOOK_KEY_STATE_CONFLICT');
    }
    verifyRecord(
      state.recovery_verification_cipher,
      state.recovery_verification_iv,
      sourceContext,
    );
  }
  await assertRowsUseKey(client, ledger.target_key_id);
  return state;
}

async function lockSigningRows(client) {
  const { rows } = await client.query(
    `SELECT id, subscription_id, tenant_id, workspace_id, secret_cipher,
            secret_iv, encryption_key_id, status, grace_expires_at, created_at, revoked_at
       FROM webhook_signing_secrets
      ORDER BY id
      FOR UPDATE`,
  );
  return rows;
}

function assertServingState(state, { allowRecovery = true, now = new Date() } = {}) {
  if (!state || state.lifecycle_state !== 'serving') fail('WEBHOOK_KEY_STATE_AMBIGUOUS');
  if (!allowRecovery && state.recovery_key_id) fail('WEBHOOK_RECOVERY_NOT_AVAILABLE');
  if (state.recovery_key_id && state.recovery_deadline
      && new Date(state.recovery_deadline).getTime() <= now.getTime()) {
    fail('WEBHOOK_RECOVERY_WINDOW_EXPIRED');
  }
}

export function buildWebhookMasterKeyRepository(pool, { auditWriter = null } = {}) {
  if (!pool?.query) fail('WEBHOOK_LIFECYCLE_INPUT_INVALID');

  return Object.freeze({
    async getResolutionState() {
      return withLifecycleAuthorityRead(
        pool,
        (client) => readState(client, false),
      );
    },

    async status() {
      return withLifecycleAuthorityRead(pool, async (client) => {
        const state = await readState(client, false);
        const { rows: recent } = await client.query(
          `SELECT request_id, action, rotation_id, source_key_id, target_key_id,
                  source_managed, target_managed, lifecycle_state,
                  affected_count, verified_count, recovery_deadline,
                  error_code, started_at, completed_at
             FROM webhook_master_key_rotations
            ORDER BY started_at DESC
            LIMIT 20`,
        );
        return {
          configured: Boolean(state),
          state: state ? {
            lifecycleState: state.lifecycle_state,
            currentKeyId: state.current_key_id,
            currentMode: state.current_mode,
            currentManaged: state.current_managed,
            recoveryKeyId: state.recovery_key_id ?? null,
            recoveryMode: state.recovery_mode ?? null,
            recoveryManaged: state.recovery_managed ?? null,
            recoveryDeadline: state.recovery_deadline ?? null,
            activeRequestId: state.active_request_id ?? null,
            activeRotationId: state.active_rotation_id ?? null,
            updatedAt: state.updated_at,
          } : null,
          recent: recent.map(ledgerResult),
        };
      });
    },

    async authorizeQuiescedReplay({
      requestId, action, rotationId = null, sourceKeyId = null, targetKeyId = null,
      recoveryWindowSeconds = null, targetManaged,
    }) {
      const request_id = requireId(requestId);
      return withLifecycleAuthorityRead(pool, async (client) => {
        const row = await readLedger(client, request_id);
        if (!row || !['completed', 'recovery_required'].includes(row.lifecycle_state)) return null;
        const expected = {
          action,
          rotation_id: rotationId || null,
          source_key_id: sourceKeyId || null,
          target_key_id: targetKeyId || null,
          source_mode: row.source_mode ?? null,
          target_mode: row.target_mode ?? null,
          recovery_window_seconds: recoveryWindowSeconds ?? null,
        };
        if (['adopt', 'rotate', 'recover'].includes(action)) {
          if (typeof targetManaged !== 'boolean') fail('WEBHOOK_LIFECYCLE_INPUT_INVALID');
          expected.target_managed = targetManaged;
        }
        assertLedgerBinding(row, expected);
        await assertDurableReplayState(client, row);
        return ledgerResult(row);
      });
    },

    async initializeOrVerify({ material, keyId, mode, managed = false, now = new Date() }) {
      return withLockedTransaction(pool, async (client) => {
        let state = await readState(client, true);
        if (!state) {
          if (mode !== 'canonical-v1') fail('WEBHOOK_ADOPTION_REQUIRED');
          const { rows } = await client.query('SELECT count(*)::int AS count FROM webhook_signing_secrets');
          if (Number(rows[0]?.count ?? 0) !== 0) fail('WEBHOOK_ADOPTION_REQUIRED');
          const context = createCanonicalWebhookKeyContext(material, keyId);
          const verification = verificationRecord(context);
          const inserted = await client.query(
            `INSERT INTO webhook_master_key_state
               (singleton_id, lifecycle_state, current_key_id, current_mode,
                current_managed, current_verification_cipher, current_verification_iv)
             VALUES (1, 'serving', $1, 'canonical-v1', $2, $3, $4)
             ON CONFLICT (singleton_id) DO NOTHING
             RETURNING *`,
            [context.keyId, Boolean(managed), verification.cipher, verification.iv],
          );
          state = inserted.rows[0] ?? await readState(client, true);
        }

        assertServingState(state, { now });
        const context = createRuntimeWebhookKeyContext({ material, keyId, mode, lifecycleState: state });
        assertStateIdentity(state, context);
        await assertRowsUseKey(client, context.keyId);
        return context;
      });
    },

    async adopt({ material, keyId, managed = false, requestId }) {
      const request_id = requireId(requestId);
      const context = createLifecycleWebhookKeyContext({ material, keyId, mode: 'legacy', purpose: 'adopt' });
      const binding = {
        request_id, action: 'adopt', rotation_id: null,
        source_key_id: null, target_key_id: context.keyId,
        source_mode: null, target_mode: 'legacy',
        target_managed: Boolean(managed),
      };
      try {
        return await withLockedTransaction(pool, async (client) => {
          const existing = await readLedger(client, request_id);
          const replay = assertLedgerBinding(existing, binding);
          if (replay) {
            await assertDurableReplayState(client, existing, {
              lock: true,
              targetContext: context,
            });
            return replay;
          }
          if (await readState(client, true)) fail('WEBHOOK_KEY_STATE_CONFLICT');
          const rows = await lockSigningRows(client);
          if (rows.some((row) => row.encryption_key_id != null)) fail('WEBHOOK_ROW_KEY_MISMATCH');
          for (const row of rows) decryptSecret(row.secret_cipher, row.secret_iv, context);
          const updated = await client.query(
            'UPDATE webhook_signing_secrets SET encryption_key_id = $1 WHERE encryption_key_id IS NULL',
            [context.keyId],
          );
          if (Number(updated.rowCount ?? 0) !== rows.length) fail('WEBHOOK_ROW_KEY_MISMATCH');
          const verification = verificationRecord(context);
          await client.query(
            `INSERT INTO webhook_master_key_state
               (singleton_id, lifecycle_state, current_key_id, current_mode,
                current_managed, current_verification_cipher, current_verification_iv,
                active_request_id)
             VALUES (1, 'serving', $1, 'legacy', $2, $3, $4, $5)`,
            [context.keyId, Boolean(managed), verification.cipher, verification.iv, request_id],
          );
          return insertCompletedLedger(client, {
            ...binding, target_managed: Boolean(managed),
            affected_count: rows.length, verified_count: rows.length,
          }, auditWriter);
        });
      } catch (caught) {
        return recordFailure(pool, binding, caught, auditWriter);
      }
    },

    async rotate({
      sourceMaterial, sourceKeyId, sourceMode,
      targetMaterial, targetKeyId, targetManaged = false,
      requestId, rotationId, recoveryWindowSeconds, quiesced,
    }) {
      assertQuiesced(quiesced);
      const request_id = requireId(requestId);
      const rotation_id = requireId(rotationId);
      const recovery_window_seconds = requireWindow(recoveryWindowSeconds);
      const source_key_id = assertWebhookKeyId(sourceKeyId);
      const target_key_id = assertWebhookKeyId(targetKeyId);
      if (source_key_id === target_key_id) fail('WEBHOOK_KEY_IDENTITY_CONFLICT');
      let source = null;
      let target = null;
      let binding = {
        request_id, action: 'rotate', rotation_id,
        source_key_id, target_key_id,
        source_mode: sourceMode, target_mode: 'canonical-v1',
        target_managed: Boolean(targetManaged), recovery_window_seconds,
      };
      try {
        return await withLockedTransaction(pool, async (client) => {
          const existing = await readLedger(client, request_id);
          // A committed replay observes the post-rotation state, whose current
          // mode is the original target mode. Reconstruct both key contexts
          // from the immutable ledger binding before validating material; using
          // the swapped durable current mode would parse a legacy source as
          // canonical and fail before the idempotency check.
          source = createLifecycleWebhookKeyContext({
            material: sourceMaterial,
            keyId: source_key_id,
            mode: existing?.source_mode ?? sourceMode,
            purpose: 'recover',
          });
          target = createCanonicalWebhookKeyContext(targetMaterial, target_key_id);
          binding = {
            ...binding,
            source_mode: source.mode,
            target_mode: target.mode,
          };
          const replay = assertLedgerBinding(existing, binding);
          if (replay) {
            await assertDurableReplayState(client, existing, {
              lock: true,
              targetContext: target,
              sourceContext: source,
            });
            return replay;
          }
          const resumed = await resumeAmbiguousCommit(
            client,
            existing,
            binding,
            target,
            source,
            auditWriter,
          );
          if (resumed) return resumed;
          const byRotation = await client.query(
            'SELECT request_id FROM webhook_master_key_rotations WHERE rotation_id = $1',
            [rotation_id],
          );
          if (byRotation.rows.some((row) => row.request_id !== request_id)) fail('WEBHOOK_ROTATION_ID_CONFLICT');
          const state = await readState(client, true);
          assertServingState(state, { allowRecovery: false });
          assertStateIdentity(state, source);
          await assertRowsUseKey(client, source.keyId);
          const rows = await lockSigningRows(client);
          let verified = 0;
          for (const row of rows) {
            const plaintext = decryptSecret(row.secret_cipher, row.secret_iv, source);
            const encrypted = encryptSecret(plaintext, target);
            if (decryptSecret(encrypted.cipher, encrypted.iv, target) !== plaintext) {
              fail('WEBHOOK_LIFECYCLE_FAILED');
            }
            const updated = await client.query(
              `UPDATE webhook_signing_secrets
                  SET secret_cipher = $2, secret_iv = $3, encryption_key_id = $4
                WHERE id = $1 AND encryption_key_id = $5`,
              [row.id, encrypted.cipher, encrypted.iv, target.keyId, source.keyId],
            );
            if (Number(updated.rowCount ?? 0) !== 1) fail('WEBHOOK_ROW_KEY_MISMATCH');
            verified += 1;
          }
          const currentVerification = verificationRecord(target);
          const recoveryDeadline = new Date(Date.now() + recovery_window_seconds * 1000);
          await client.query(
            `UPDATE webhook_master_key_state
                SET lifecycle_state = 'serving',
                    current_key_id = $1, current_mode = 'canonical-v1', current_managed = $2,
                    current_verification_cipher = $3, current_verification_iv = $4,
                    recovery_key_id = $5, recovery_mode = $6, recovery_managed = current_managed,
                    recovery_verification_cipher = current_verification_cipher,
                    recovery_verification_iv = current_verification_iv,
                    recovery_deadline = $7, active_request_id = $8, active_rotation_id = $9,
                    updated_at = now()
              WHERE singleton_id = 1`,
            [
              target.keyId, Boolean(targetManaged), currentVerification.cipher, currentVerification.iv,
              source.keyId, source.mode, recoveryDeadline, request_id, rotation_id,
            ],
          );
          return insertCompletedLedger(client, {
            ...binding,
            source_managed: state.current_managed,
            target_managed: Boolean(targetManaged),
            affected_count: rows.length, verified_count: verified,
            recovery_deadline: recoveryDeadline,
          }, auditWriter);
        });
      } catch (caught) {
        if (caught?.[COMMIT_OUTCOME_UNKNOWN]) {
          await markAmbiguousCommit(pool, binding, target, source, auditWriter);
          throw new WebhookLifecycleError('WEBHOOK_KEY_STATE_AMBIGUOUS');
        }
        return recordFailure(pool, binding, caught, auditWriter);
      }
    },

    async recover({
      currentMaterial, currentKeyId, currentMode,
      targetMaterial, targetKeyId, targetMode, targetManaged = false,
      requestId, rotationId, recoveryWindowSeconds, quiesced, now = new Date(),
    }) {
      assertQuiesced(quiesced);
      const request_id = requireId(requestId);
      const rotation_id = rotationId ? requireId(rotationId) : null;
      const recovery_window_seconds = requireWindow(recoveryWindowSeconds);
      const clock = requireClock(now);
      const source_key_id = assertWebhookKeyId(currentKeyId);
      const target_key_id = assertWebhookKeyId(targetKeyId);
      if (source_key_id === target_key_id) fail('WEBHOOK_KEY_IDENTITY_CONFLICT');
      let current = null;
      let target = null;
      let binding = {
        request_id, action: 'recover', rotation_id,
        source_key_id, target_key_id,
        source_mode: currentMode, target_mode: targetMode,
        target_managed: Boolean(targetManaged), recovery_window_seconds,
      };
      try {
        return await withLockedTransaction(pool, async (client) => {
          const existing = await readLedger(client, request_id);
          // Recovery swaps the durable current/recovery modes. Exact and
          // recovery-required replays must therefore parse the supplied
          // original source/target material with the ledger-bound modes, not
          // with the already-swapped resolution state observed by the CLI.
          current = createLifecycleWebhookKeyContext({
            material: currentMaterial,
            keyId: source_key_id,
            mode: existing?.source_mode ?? currentMode,
            purpose: 'recover',
          });
          target = createLifecycleWebhookKeyContext({
            material: targetMaterial,
            keyId: target_key_id,
            mode: existing?.target_mode ?? targetMode,
            purpose: 'recover',
          });
          binding = {
            ...binding,
            source_mode: current.mode,
            target_mode: target.mode,
          };
          const replay = assertLedgerBinding(existing, binding);
          if (replay) {
            await assertDurableReplayState(client, existing, {
              lock: true,
              targetContext: target,
              sourceContext: current,
            });
            return replay;
          }
          const resumed = await resumeAmbiguousCommit(
            client,
            existing,
            binding,
            target,
            current,
            auditWriter,
          );
          if (resumed) return resumed;
          const state = await readState(client, true);
          if (!state || !['serving', 'recovery_required'].includes(state.lifecycle_state)) {
            fail('WEBHOOK_KEY_STATE_AMBIGUOUS');
          }
          assertStateIdentity(state, current);
          if (state.recovery_key_id !== target.keyId || state.recovery_mode !== target.mode) {
            fail('WEBHOOK_RECOVERY_NOT_AVAILABLE');
          }
          // Helm declares the retained target's custody; it cannot relabel the
          // durable identity while authorizing a recovery transform.
          if (state.recovery_managed !== Boolean(targetManaged)) {
            fail('WEBHOOK_KEY_CUSTODY_CONFLICT');
          }
          if (!state.recovery_deadline
              || new Date(state.recovery_deadline).getTime() <= clock.getTime()) {
            fail('WEBHOOK_RECOVERY_WINDOW_EXPIRED');
          }
          verifyRecord(state.recovery_verification_cipher, state.recovery_verification_iv, target);
          await assertRowsUseKey(client, current.keyId);
          const rows = await lockSigningRows(client);
          for (const row of rows) {
            const plaintext = decryptSecret(row.secret_cipher, row.secret_iv, current);
            const encrypted = encryptSecret(plaintext, target);
            if (decryptSecret(encrypted.cipher, encrypted.iv, target) !== plaintext) {
              fail('WEBHOOK_LIFECYCLE_FAILED');
            }
            const updated = await client.query(
              `UPDATE webhook_signing_secrets
                  SET secret_cipher = $2, secret_iv = $3, encryption_key_id = $4
                WHERE id = $1 AND encryption_key_id = $5`,
              [row.id, encrypted.cipher, encrypted.iv, target.keyId, current.keyId],
            );
            if (Number(updated.rowCount ?? 0) !== 1) fail('WEBHOOK_ROW_KEY_MISMATCH');
          }
          const deadline = new Date(clock.getTime() + recovery_window_seconds * 1000);
          await client.query(
            `UPDATE webhook_master_key_state
                SET lifecycle_state = 'serving',
                    current_key_id = recovery_key_id,
                    current_mode = recovery_mode,
                    current_managed = recovery_managed,
                    current_verification_cipher = recovery_verification_cipher,
                    current_verification_iv = recovery_verification_iv,
                    recovery_key_id = $1,
                    recovery_mode = $2,
                    recovery_managed = current_managed,
                    recovery_verification_cipher = current_verification_cipher,
                    recovery_verification_iv = current_verification_iv,
                    recovery_deadline = $3,
                    active_request_id = $4,
                    active_rotation_id = $5,
                    updated_at = now()
              WHERE singleton_id = 1`,
            [current.keyId, current.mode, deadline, request_id, rotation_id],
          );
          return insertCompletedLedger(client, {
            ...binding,
            source_managed: state.current_managed,
            target_managed: state.recovery_managed,
            affected_count: rows.length, verified_count: rows.length,
            recovery_deadline: deadline,
          }, auditWriter);
        });
      } catch (caught) {
        if (caught?.[COMMIT_OUTCOME_UNKNOWN]) {
          await markAmbiguousCommit(pool, binding, target, current, auditWriter);
          throw new WebhookLifecycleError('WEBHOOK_KEY_STATE_AMBIGUOUS');
        }
        return recordFailure(pool, binding, caught, auditWriter);
      }
    },

    async finalize({ material, keyId, mode, recoveryKeyId, requestId, now = new Date() }) {
      const request_id = requireId(requestId);
      const recovery_key_id = assertWebhookKeyId(recoveryKeyId);
      const current = createLifecycleWebhookKeyContext({
        material, keyId, mode, purpose: mode === 'legacy' ? 'recover' : 'finalize',
      });
      if (recovery_key_id === current.keyId) fail('WEBHOOK_KEY_IDENTITY_CONFLICT');
      const binding = {
        request_id, action: 'finalize', rotation_id: null,
        source_key_id: recovery_key_id, target_key_id: current.keyId,
        source_mode: null, target_mode: current.mode,
      };
      try {
        return await withLockedTransaction(pool, async (client) => {
          const existing = await readLedger(client, request_id);
          const replay = assertLedgerBinding(existing, binding);
          if (replay) {
            await assertDurableReplayState(client, existing, {
              lock: true,
              targetContext: current,
            });
            return replay;
          }
          const state = await readState(client, true);
          if (!state || state.lifecycle_state !== 'serving') fail('WEBHOOK_KEY_STATE_AMBIGUOUS');
          assertStateIdentity(state, current);
          if (!state.recovery_key_id || state.recovery_key_id !== recovery_key_id) {
            fail('WEBHOOK_RECOVERY_NOT_AVAILABLE');
          }
          if (!state.recovery_deadline || new Date(state.recovery_deadline).getTime() > now.getTime()) {
            fail('WEBHOOK_FINALIZE_TOO_EARLY');
          }
          const signingRows = await lockSigningRows(client);
          if (signingRows.some((row) => row.encryption_key_id !== current.keyId)) {
            fail('WEBHOOK_ROW_KEY_MISMATCH');
          }
          await client.query(
            `UPDATE webhook_master_key_state
                SET recovery_key_id = NULL, recovery_mode = NULL, recovery_managed = NULL,
                    recovery_verification_cipher = NULL, recovery_verification_iv = NULL,
                    recovery_deadline = NULL, active_request_id = $1,
                    active_rotation_id = NULL, updated_at = now()
              WHERE singleton_id = 1`,
            [request_id],
          );
          return insertCompletedLedger(client, {
            ...binding,
            source_managed: state.recovery_managed,
            target_managed: state.current_managed,
            affected_count: signingRows.length,
            verified_count: signingRows.length,
          }, auditWriter);
        });
      } catch (caught) {
        return recordFailure(pool, binding, caught, auditWriter);
      }
    },
  });
}

export function isLifecycleAction(action) {
  return VALID_ACTIONS.has(action);
}

export const WEBHOOK_VERIFICATION_SENTINEL_VERSION = 'v1';
