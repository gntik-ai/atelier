// Durable saga + compensation for domain B (kind deploy).
//
// The repo's sagas (apps/control-plane-executor/src/saga + workflows/wf-con-00X.mjs) are
// stubs that only snapshot() — they never run real steps and never compensate.
// Earlier this deploy compensated with an in-memory `done[]` array, which is lost
// if the control-plane crashes mid-provision (orphaned Keycloak realms / DB rows
// with no rollback). This module makes compensation DURABLE:
//
//   - every forward step records a SERIALIZABLE compensation descriptor
//     ({ type, args }) in Postgres BEFORE the side effect is considered done;
//   - on failure we replay the recorded compensations newest-first;
//   - on startup recoverSagas() finds sagas left 'running' by a crash and
//     compensates them, so rollback survives a restart.
//
// Compensations are data, not closures, so a fresh process can execute them. The
// COMPENSATORS registry maps a type -> executor; adding a new compensable side
// effect means adding one entry here and emitting the descriptor at the call site.
import { randomUUID } from 'node:crypto';
import { isProxy } from 'node:util/types';
import { kcAdmin } from './kc-admin.mjs';
import * as store from './tenant-store.mjs';
import { dropWorkspaceDatabase } from './dataplane.mjs';
import { transitionOperation } from '../../packages/provisioning-orchestrator/src/repositories/async-operation-repo.mjs';
import {
  normalizeErrorSummary,
  normalizeOperationResult
} from '../../packages/provisioning-orchestrator/src/models/async-operation.mjs';

const MAX_SAGA_ERROR_MESSAGE_BYTES = 4 * 1024;
const SAFE_SAGA_ERROR_MESSAGE = 'Saga execution failed.';

export async function ensureSagaSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS saga_runs (
      id          TEXT PRIMARY KEY,
      kind        TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'running',  -- running | completed | failed | compensated | recovered
      request     JSONB,
      result      JSONB,
      error       TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS saga_steps (
      id            TEXT PRIMARY KEY,
      run_id        TEXT NOT NULL REFERENCES saga_runs(id) ON DELETE CASCADE,
      seq           INTEGER NOT NULL,
      name          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'done',   -- done
      compensation  JSONB,                          -- { type, args } | null
      comp_status   TEXT,                           -- null | pending | compensated | comp_failed
      comp_error    TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS saga_steps_run_idx ON saga_steps(run_id, seq)');
}

// ---- compensation executors (data-driven; safe to run from a cold process) ---
const COMPENSATORS = {
  'kc.deleteRealm':  async ({ realm }) => kcAdmin.deleteRealm(realm),
  'kc.deleteUser':   async ({ realm, userId }) => kcAdmin.deleteUser(realm, userId),
  'kc.deleteClient': async ({ realm, clientUuid }) => kcAdmin.deleteClient(realm, clientUuid),
  'store.deleteTenant':    async ({ id }, { pool }) => store.deleteTenant(pool, id),
  'store.deleteWorkspaceDatabase': async ({ id }, { pool }) => store.deleteWorkspaceDatabaseRecord(pool, id),
  'pg.dropDatabase': async ({ database }, { pool }) => dropWorkspaceDatabase(pool, database)
};

export class Saga {
  constructor(pool, runId, kind) { this.pool = pool; this.runId = runId; this.kind = kind; this.seq = 0; }

  // Run a forward step. `compensation` is a serializable { type, args } executed
  // (newest-first) if the saga later fails — recorded BEFORE returning so a crash
  // right after the side effect still leaves a replayable rollback.
  async step(name, fn, compensation = null) {
    this.seq += 1;
    const value = await fn();
    // Allow the side effect to refine its own compensation args (e.g. a created id).
    const comp = typeof compensation === 'function' ? compensation(value) : compensation;
    await this.pool.query(
      `INSERT INTO saga_steps (id, run_id, seq, name, compensation, comp_status)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [randomUUID(), this.runId, this.seq, name, comp ? JSON.stringify(comp) : null, comp ? 'pending' : null]);
    return value;
  }

  // Mirror this saga into the async_operations tables (so the console Operations
  // page shows real platform activity). Best-effort: never block the saga on it.
  async attachOperation(op) {
    if (!op?.tenantId || !op?.actorId) return;
    this.op = { ...op, operationType: op.operationType ?? this.kind, correlationId: op.correlationId || this.runId };
    try {
      await this.pool.query(
        `INSERT INTO async_operations (operation_id, tenant_id, actor_id, actor_type, workspace_id, operation_type, status, result, completed_at, correlation_id, saga_id)
         VALUES ($1,$2,$3,$4,$5,$6,'running',NULL,NULL,$7,$8)`,
        [this.runId, op.tenantId, op.actorId, op.actorType ?? 'superadmin', op.workspaceId ?? null, this.op.operationType, this.op.correlationId, this.runId]);
      await this._transition('pending', 'running');
      await this._log('info', `${this.op.operationType} started`);
    } catch { this.op = null; /* table/shape mismatch -> don't couple the saga to it */ }
  }
  async _transition(from, to, metadata) {
    if (!this.op) return;
    await this.pool.query(
      `INSERT INTO async_operation_transitions (operation_id, tenant_id, actor_id, previous_status, new_status, metadata)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [this.runId, this.op.tenantId, this.op.actorId, from, to, metadata ? JSON.stringify(metadata) : null]);
  }
  async _log(level, message) {
    if (!this.op) return;
    await this.pool.query(
      `INSERT INTO async_operation_log_entries (operation_id, tenant_id, level, message) VALUES ($1,$2,$3,$4)`,
      [this.runId, this.op.tenantId, level, message]);
  }
  async _opStatus(status, errorSummary, result = null) {
    if (!this.op) return;
    let client = this.pool;
    let release = null;
    let transitioned = false;
    try {
      const isPool = typeof this.pool.connect === 'function'
        && typeof this.pool.totalCount === 'number'
        && typeof this.pool.idleCount === 'number';
      if (isPool) {
        client = await this.pool.connect();
        release = () => client.release();
      }
      await transitionOperation(client, {
        operation_id: this.runId,
        tenant_id: this.op.tenantId,
        new_status: status,
        actor_id: this.op.actorId,
        error_summary: errorSummary,
        result
      });
      transitioned = true;
    } catch { /* best-effort */ }
    finally {
      try { release?.(); } catch { /* best-effort */ }
    }
    if (transitioned) {
      try {
        await this._log(status === 'failed' ? 'error' : 'info', `${this.op.operationType} ${status}`);
      } catch { /* best-effort */ }
    }
  }

  async complete(result) {
    const safeResult = safeSagaCompletionResult(result);
    await this.pool.query(
      `UPDATE saga_runs SET status='completed', result=$2::jsonb, updated_at=NOW() WHERE id=$1`,
      [this.runId, safeResult == null ? null : JSON.stringify(safeResult)]);
    await this._opStatus('completed', null, safeResult);
  }

  async fail(error) {
    const errorSummary = safeSagaErrorSummary(error);
    await this.pool.query(`UPDATE saga_runs SET status='failed', error=$2, updated_at=NOW() WHERE id=$1`,
      [this.runId, errorSummary.message]);
    await this._opStatus('failed', errorSummary);
    await runCompensations(this.pool, this.runId);
    await this.pool.query(`UPDATE saga_runs SET status='compensated', updated_at=NOW() WHERE id=$1`, [this.runId]);
  }
}

function safeSagaCompletionResult(result) {
  try {
    return normalizeOperationResult(result);
  } catch {
    console.warn('[control-plane] unsafe saga completion result omitted');
    return null;
  }
}

function safeSagaErrorSummary(error) {
  const canInspect = error !== null
    && (typeof error === 'object' || typeof error === 'function')
    && !isProxy(error);
  const codeDescriptor = canInspect
    ? Object.getOwnPropertyDescriptor(error, 'code')
    : null;
  const messageDescriptor = canInspect
    ? Object.getOwnPropertyDescriptor(error, 'message')
    : null;
  const rawCode = typeof codeDescriptor?.value === 'string'
    ? codeDescriptor.value
    : 'SAGA_FAILED';
  let code = /^[A-Z0-9_.-]{1,100}$/i.test(rawCode) ? rawCode : 'SAGA_FAILED';
  try {
    normalizeOperationResult(code);
  } catch {
    code = 'SAGA_FAILED';
  }

  const summary = {
    code,
    message: typeof messageDescriptor?.value === 'string'
      ? messageDescriptor.value.trim()
      : (typeof error === 'string' ? error.trim() : SAFE_SAGA_ERROR_MESSAGE)
  };
  try {
    const normalizedSummary = normalizeErrorSummary(summary);
    normalizeOperationResult(summary.message);
    if (Buffer.byteLength(summary.message, 'utf8') > MAX_SAGA_ERROR_MESSAGE_BYTES) {
      throw new Error('saga error message exceeds safe bound');
    }
    return normalizedSummary;
  } catch {
    return { code: summary.code, message: SAFE_SAGA_ERROR_MESSAGE };
  }
}

export async function startSaga(pool, kind, request, operation = null) {
  const runId = randomUUID();
  await pool.query(`INSERT INTO saga_runs (id, kind, request) VALUES ($1,$2,$3)`,
    [runId, kind, request == null ? null : JSON.stringify(request)]);
  const saga = new Saga(pool, runId, kind);
  if (operation) await saga.attachOperation(operation);
  return saga;
}

// Replay every pending compensation for a run, newest-first. Each step is
// CLAIMED atomically ('pending' -> 'compensating') so two replicas can never run
// the same compensation twice (which caused double side effects + spurious
// failures). Marked 'compensated' or 'comp_failed' independently for audit.
async function runCompensations(pool, runId) {
  const { rows } = await pool.query(
    `SELECT id, name, compensation FROM saga_steps
      WHERE run_id=$1 AND compensation IS NOT NULL AND comp_status='pending'
      ORDER BY seq DESC`, [runId]);
  for (const s of rows) {
    // Atomic claim: only the worker that flips 'pending'->'compensating' runs it.
    const claim = await pool.query(
      `UPDATE saga_steps SET comp_status='compensating'
        WHERE id=$1 AND comp_status='pending' RETURNING id`, [s.id]);
    if (claim.rowCount === 0) continue; // another worker already took this step
    const comp = s.compensation;
    const exec = COMPENSATORS[comp?.type];
    try {
      if (!exec) throw new Error(`no compensator for type ${comp?.type}`);
      await exec(comp.args ?? {}, { pool });
      await pool.query(`UPDATE saga_steps SET comp_status='compensated' WHERE id=$1`, [s.id]);
    } catch (e) {
      await pool.query(`UPDATE saga_steps SET comp_status='comp_failed', comp_error=$2 WHERE id=$1`,
        [s.id, String(e?.message ?? e)]);
    }
  }
}

// Startup recovery: a saga stuck in 'running' past the orphan window was abandoned
// by a crash — roll it back so we don't leak realms / DB rows / databases. The
// window (default 5 min >> a normal saga's ~1-2s) means we never compensate a
// saga still IN FLIGHT on another live replica. The claim UPDATE is atomic, so
// across replicas each orphan is processed exactly once. Returns how many swept.
export async function recoverSagas(pool, { olderThanSeconds = 300 } = {}) {
  const { rows } = await pool.query(
    `UPDATE saga_runs SET status='recovering', updated_at=NOW()
       WHERE status='running' AND created_at < NOW() - ($1 * INTERVAL '1 second')
       RETURNING id`, [olderThanSeconds]);
  for (const r of rows) {
    await runCompensations(pool, r.id);
    await pool.query(`UPDATE saga_runs SET status='recovered', updated_at=NOW(),
      error=COALESCE(error,'recovered after restart') WHERE id=$1`, [r.id]);
  }
  return rows.length;
}
