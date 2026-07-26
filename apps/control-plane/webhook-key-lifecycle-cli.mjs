#!/usr/bin/env node
import pg from 'pg';
import { buildWebhookMasterKeyRepository, isLifecycleAction } from '../../packages/webhook-engine/src/webhook-master-key-lifecycle.mjs';
import { recordAuditEventInTransaction } from './audit-store.mjs';
import { createKubernetesApi, waitForDeploymentDrain } from './kubernetes-api.mjs';
import { finalizeWebhookCredential } from './webhook-key-credential-cli.mjs';
import { withPostgresSsl } from './transport-security.mjs';
import { applyWebhookSchema } from './webhook-schema.mjs';
import {
  resolveWebhookDatabasePrincipalNames,
  verifyWebhookLifecyclePrincipalConnections,
  verifyWebhookLifecyclePrincipalSessions,
} from './webhook-database-principals.mjs';

const { Pool } = pg;

function required(env, name) {
  const value = env[name];
  if (typeof value !== 'string' || value.length === 0) throw Object.assign(new Error('invalid input'), { code: 'WEBHOOK_LIFECYCLE_INPUT_INVALID' });
  return value;
}

function bool(env, name) {
  return env[name] === 'true';
}

function kubeStateInvalid() {
  return Object.assign(new Error('deployment replica state invalid'), { code: 'KUBE_DEPLOYMENT_STATE_INVALID' });
}

function replayBinding(env, action) {
  const requestId = required(env, 'WEBHOOK_LIFECYCLE_REQUEST_ID');
  const targetKeyId = required(env, 'WEBHOOK_SIGNING_KEY_ID');
  if (action === 'adopt') {
    return {
      requestId,
      action,
      targetKeyId,
      targetManaged: bool(env, 'WEBHOOK_SIGNING_KEY_MANAGED'),
    };
  }
  const sourceKeyId = required(env, 'WEBHOOK_SOURCE_SIGNING_KEY_ID');
  if (action === 'finalize') {
    return { requestId, action, sourceKeyId, targetKeyId };
  }
  return {
    requestId,
    action,
    rotationId: required(env, 'WEBHOOK_LIFECYCLE_ROTATION_ID'),
    sourceKeyId,
    targetKeyId,
    targetManaged: bool(env, 'WEBHOOK_SIGNING_KEY_MANAGED'),
    recoveryWindowSeconds: Number(required(env, 'WEBHOOK_RECOVERY_WINDOW_SECONDS')),
  };
}

async function quiesce(env, api, authorizeAlreadyQuiesced) {
  const deployment = required(env, 'WEBHOOK_CONTROL_PLANE_DEPLOYMENT');
  const declaredReplicas = Number(required(env, 'WEBHOOK_CONTROL_PLANE_REPLICAS'));
  if (!Number.isSafeInteger(declaredReplicas) || declaredReplicas < 1) throw Object.assign(new Error('invalid replicas'), { code: 'WEBHOOK_LIFECYCLE_INPUT_INVALID' });
  const current = await api.getDeployment(deployment);
  if (!current) throw Object.assign(new Error('deployment missing'), { code: 'KUBE_DEPLOYMENT_MISSING' });
  const previousReplicas = Number(current?.spec?.replicas);
  if (previousReplicas === 0) {
    const reportedReplicas = Number(current?.status?.replicas ?? 0);
    const availableReplicas = Number(current?.status?.availableReplicas ?? 0);
    if (reportedReplicas !== 0 || availableReplicas !== 0) throw kubeStateInvalid();
    const replay = await authorizeAlreadyQuiesced();
    if (!replay) throw kubeStateInvalid();
    return { restore: null, alreadyQuiesced: true };
  }
  if (!Number.isSafeInteger(previousReplicas) || previousReplicas < 1) throw kubeStateInvalid();
  await api.scaleDeployment(deployment, 0);
  await waitForDeploymentDrain(api, deployment);
  return {
    restore: async () => api.scaleDeployment(deployment, previousReplicas),
    alreadyQuiesced: false,
  };
}

export async function runWebhookLifecycle(env = process.env, deps = {}) {
  if ((deps.argv ?? process.argv).length !== 2) throw Object.assign(new Error('arguments forbidden'), { code: 'WEBHOOK_LIFECYCLE_ARGUMENTS_FORBIDDEN' });
  const action = required(env, 'WEBHOOK_KEY_LIFECYCLE_ACTION');
  if (action !== 'status' && !isLifecycleAction(action)) throw Object.assign(new Error('invalid action'), { code: 'WEBHOOK_LIFECYCLE_INPUT_INVALID' });
  let pool = deps.pool ?? null;
  let schemaPool = deps.schemaPool ?? null;
  let ownsPool = false;
  let ownsSchemaPool = false;
  let restore = null;
  let alreadyQuiesced = false;
  try {
    if (!pool) {
      pool = new Pool(withPostgresSsl({
        connectionString: required(env, 'WEBHOOK_KEY_LIFECYCLE_DATABASE_URL'),
        max: 2,
      }));
      ownsPool = true;
    }
    if (!schemaPool) {
      if (deps.pool) {
        schemaPool = pool;
      } else {
        schemaPool = new Pool(withPostgresSsl({
          connectionString: required(env, 'WEBHOOK_SCHEMA_DATABASE_URL'),
          max: 1,
        }));
        ownsSchemaPool = true;
      }
    }
    const names = deps.applySchema ? null : resolveWebhookDatabasePrincipalNames(env);
    if (!deps.applySchema) {
      await verifyWebhookLifecyclePrincipalSessions({
        schemaPool,
        lifecyclePool: pool,
        names,
      });
    }
    const repository = deps.repository ?? buildWebhookMasterKeyRepository(pool, {
      auditWriter: deps.auditWriter ?? recordAuditEventInTransaction,
    });
    await (deps.applySchema ?? applyWebhookSchema)(schemaPool, {
      log: { log() {} },
      principalNames: names,
    });
    if (!deps.applySchema) {
      await verifyWebhookLifecyclePrincipalConnections({
        schemaPool,
        lifecyclePool: pool,
        names,
      });
    }
    if (action === 'status') return await repository.status();
    const api = deps.api ?? await createKubernetesApi(env);
    const quiesced = await quiesce(
      env,
      api,
      () => repository.authorizeQuiescedReplay(replayBinding(env, action)),
    );
    restore = quiesced.restore;
    alreadyQuiesced = quiesced.alreadyQuiesced;
    const complete = (result) => ({
      ...result,
      deploymentQuiesced: true,
      reconciledFromZero: alreadyQuiesced,
      workloadAction: 'apply-target',
    });
    if (action === 'adopt') {
      return complete(await repository.adopt({
        material: required(env, 'WEBHOOK_SIGNING_KEY'),
        keyId: required(env, 'WEBHOOK_SIGNING_KEY_ID'),
        managed: bool(env, 'WEBHOOK_SIGNING_KEY_MANAGED'),
        requestId: required(env, 'WEBHOOK_LIFECYCLE_REQUEST_ID'),
      }));
    }
    if (action === 'rotate') {
      const state = await repository.getResolutionState();
      return complete(await repository.rotate({
        sourceMaterial: required(env, 'WEBHOOK_SOURCE_SIGNING_KEY'),
        sourceKeyId: required(env, 'WEBHOOK_SOURCE_SIGNING_KEY_ID'),
        sourceMode: state?.current_mode,
        targetMaterial: required(env, 'WEBHOOK_SIGNING_KEY'),
        targetKeyId: required(env, 'WEBHOOK_SIGNING_KEY_ID'),
        targetManaged: bool(env, 'WEBHOOK_SIGNING_KEY_MANAGED'),
        requestId: required(env, 'WEBHOOK_LIFECYCLE_REQUEST_ID'),
        rotationId: required(env, 'WEBHOOK_LIFECYCLE_ROTATION_ID'),
        recoveryWindowSeconds: required(env, 'WEBHOOK_RECOVERY_WINDOW_SECONDS'),
        quiesced: true,
      }));
    }
    if (action === 'recover') {
      const state = await repository.getResolutionState();
      return complete(await repository.recover({
        currentMaterial: required(env, 'WEBHOOK_SOURCE_SIGNING_KEY'),
        currentKeyId: required(env, 'WEBHOOK_SOURCE_SIGNING_KEY_ID'),
        currentMode: state?.current_mode,
        targetMaterial: required(env, 'WEBHOOK_SIGNING_KEY'),
        targetKeyId: required(env, 'WEBHOOK_SIGNING_KEY_ID'),
        targetMode: state?.recovery_mode,
        targetManaged: bool(env, 'WEBHOOK_SIGNING_KEY_MANAGED'),
        requestId: required(env, 'WEBHOOK_LIFECYCLE_REQUEST_ID'),
        rotationId: env.WEBHOOK_LIFECYCLE_ROTATION_ID || null,
        recoveryWindowSeconds: required(env, 'WEBHOOK_RECOVERY_WINDOW_SECONDS'),
        quiesced: true,
        now: deps.now?.() ?? new Date(),
      }));
    }
    const state = await repository.getResolutionState();
    const result = await repository.finalize({
      material: required(env, 'WEBHOOK_SIGNING_KEY'),
      keyId: required(env, 'WEBHOOK_SIGNING_KEY_ID'),
      mode: state?.current_mode,
      recoveryKeyId: required(env, 'WEBHOOK_SOURCE_SIGNING_KEY_ID'),
      requestId: required(env, 'WEBHOOK_LIFECYCLE_REQUEST_ID'),
    });
    const credential = await finalizeWebhookCredential({
      api,
      env,
      expectedRecoveryKeyId: result.sourceKeyId,
      sourceManaged: result.sourceManaged,
    });
    return complete({ ...result, credential });
  } catch (caught) {
    // A lost commit acknowledgement means the durable target may already own all
    // rows. Never revive the source-reference workload in that state. The failed
    // hook intentionally leaves replicas at zero; an exact Helm retry reconciles
    // the ledger and then proceeds to apply the target Deployment.
    if (restore && caught?.code !== 'WEBHOOK_KEY_STATE_AMBIGUOUS') {
      try { await restore(); } catch { /* Helm remains failed and consumers stay stopped */ }
    }
    throw caught;
  } finally {
    const cleanup = [];
    if (ownsPool && pool) cleanup.push(pool.end());
    if (ownsSchemaPool && schemaPool && schemaPool !== pool) {
      cleanup.push(schemaPool.end());
    }
    await Promise.allSettled(cleanup);
  }
}

function sanitizedCode(caught) {
  const code = String(caught?.code ?? 'WEBHOOK_LIFECYCLE_FAILED');
  return /^(WEBHOOK|KUBE)_[A-Z0-9_]+$/.test(code) ? code : 'WEBHOOK_LIFECYCLE_FAILED';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runWebhookLifecycle()
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((caught) => {
      process.stderr.write(`${JSON.stringify({ status: 'failed', code: sanitizedCode(caught) })}\n`);
      process.exitCode = 1;
    });
}
