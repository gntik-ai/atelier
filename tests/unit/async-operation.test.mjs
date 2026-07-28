import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTransition,
  createOperation,
  isValidCorrelationId
} from '../../packages/provisioning-orchestrator/src/models/async-operation.mjs';

const AWS_ACCESS_KEY_FIXTURE = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
const AWS_SECRET_KEY_FIXTURE = ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'ABCD'].join('');
const GITHUB_PAT_FIXTURE = ['ghp', '_123456789012345678901234567890123456'].join('');
const OPENAI_KEY_FIXTURE = ['sk', '-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'].join('');
const STRIPE_KEY_FIXTURE = ['sk', '_test_abcdefghijklmnopqrstuvwxyz012345'].join('');

test('createOperation returns a pending async operation with required metadata', () => {
  const operation = createOperation({
    tenant_id: 'tenant-a',
    actor_id: 'actor-1',
    actor_type: 'workspace_admin',
    workspace_id: 'ws-1',
    operation_type: 'WF-CON-001'
  });

  assert.equal(operation.status, 'pending');
  assert.equal(operation.error_summary, null);
  assert.equal(operation.tenant_id, 'tenant-a');
  assert.equal(operation.actor_id, 'actor-1');
  assert.equal(operation.actor_type, 'workspace_admin');
  assert.equal(operation.workspace_id, 'ws-1');
  assert.equal(operation.operation_type, 'WF-CON-001');
  assert.equal(operation.idempotency_key, null);
  assert.equal(operation.saga_id, null);
  assert.equal(operation.result, null);
  assert.equal(operation.completed_at, null);
  assert.equal(typeof operation.operation_id, 'string');
  assert.equal(operation.created_at, operation.updated_at);
  assert.equal(isValidCorrelationId(operation.correlation_id), true);
});

test('createOperation validates required fields and actor type', () => {
  for (const field of ['tenant_id', 'actor_id', 'actor_type', 'operation_type']) {
    const payload = {
      tenant_id: 'tenant-a',
      actor_id: 'actor-1',
      actor_type: 'workspace_admin',
      operation_type: 'WF-CON-001'
    };
    delete payload[field];

    assert.throws(() => createOperation(payload), (error) => error.code === 'VALIDATION_ERROR' && error.field === field);
  }

  assert.throws(
    () => createOperation({ tenant_id: 'tenant-a', actor_id: 'actor-1', actor_type: 'robot', operation_type: 'WF-CON-001' }),
    (error) => error.code === 'VALIDATION_ERROR' && error.field === 'actor_type'
  );
});

test('applyTransition updates timestamps and enforces failed error summary shape', async () => {
  const operation = createOperation({
    tenant_id: 'tenant-a',
    actor_id: 'actor-1',
    actor_type: 'workspace_admin',
    operation_type: 'WF-CON-001'
  });

  await new Promise((resolve) => setTimeout(resolve, 5));
  const running = applyTransition(operation, { new_status: 'running' });
  assert.equal(running.status, 'running');
  assert.notEqual(running.updated_at, operation.updated_at);
  assert.equal(running.error_summary, null);
  assert.equal(running.result, null);
  assert.equal(running.completed_at, null);

  const failed = applyTransition(running, {
    new_status: 'failed',
    error_summary: { code: 'STEP_FAILED', message: 'Provisioning step failed cleanly.', failedStep: 'bind-resource' }
  });
  assert.deepEqual(failed.error_summary, {
    code: 'STEP_FAILED',
    message: 'Provisioning step failed cleanly.',
    failedStep: 'bind-resource'
  });
  assert.equal(failed.result, null);
  assert.equal(failed.completed_at, failed.updated_at);

  assert.throws(
    () => applyTransition(running, { new_status: 'failed' }),
    (error) => error.code === 'VALIDATION_ERROR' && error.field === 'error_summary'
  );
});

test('applyTransition rejects invalid transitions and does not mutate original operation', () => {
  const operation = createOperation({
    tenant_id: 'tenant-a',
    actor_id: 'actor-1',
    actor_type: 'workspace_admin',
    operation_type: 'WF-CON-001',
    correlation_id: 'custom-correlation-id'
  });

  assert.equal(operation.correlation_id, 'custom-correlation-id');
  assert.throws(() => applyTransition(operation, { new_status: 'completed' }), (error) => error.code === 'INVALID_TRANSITION');
  assert.equal(operation.status, 'pending');
});

test('applyTransition rejects sensitive error messages', () => {
  const operation = createOperation({
    tenant_id: 'tenant-a',
    actor_id: 'actor-1',
    actor_type: 'workspace_admin',
    operation_type: 'WF-CON-001'
  });
  const running = applyTransition(operation, { new_status: 'running' });

  assert.throws(
    () => applyTransition(running, {
      new_status: 'failed',
      error_summary: { code: 'STEP_FAILED', message: 'postgres://user:pass@db.internal/app' }
    }),
    (error) => error.code === 'VALIDATION_ERROR' && error.field === 'error_summary.message'
  );

  for (const message of [
    'Basic authentication failed safely.',
    'Bearer authentication succeeded before the downstream failure.'
  ]) {
    const failed = applyTransition(running, {
      new_status: 'failed',
      error_summary: { code: 'STEP_FAILED', message }
    });
    assert.equal(failed.error_summary.message, message);
  }

  for (const message of [
    'Basic YTpi',
    'Basic dXNlcjpwYXNz',
    'Bearer authentication',
    'Bearer abcdefghijklmnopqrst',
    'Bearer abcdefghijklmnop1234',
    'Provider rejected Bearer abcdefghijklmnopqrst during handshake.'
  ]) {
    assert.throws(
      () => applyTransition(running, {
        new_status: 'failed',
        error_summary: { code: 'STEP_FAILED', message }
      }),
      (error) => error.code === 'VALIDATION_ERROR' && error.field === 'error_summary.message'
    );
  }

  for (const errorSummary of [
    { code: 'DOWNSTREAM', message: '   ' },
    { code: '   ', message: 'Safe failure.' },
    { code: 'Basic YTpi', message: 'Safe failure.' },
    { code: 'Bearer abcdefghijklmnopqrst', message: 'Safe failure.' },
    { code: 'DOWNSTREAM', message: 'Safe failure.', failedStep: 'Bearer abcdefghijklmnopqrst' }
  ]) {
    assert.throws(
      () => applyTransition(running, { new_status: 'failed', error_summary: errorSummary }),
      (error) => error.code === 'VALIDATION_ERROR' && error.field.startsWith('error_summary.')
    );
  }
});

test('applyTransition persists only safe JSON-compatible completion results', () => {
  const operation = createOperation({
    tenant_id: 'tenant-a',
    actor_id: 'actor-1',
    actor_type: 'workspace_admin',
    operation_type: 'WF-CON-001'
  });
  const running = applyTransition(operation, { new_status: 'running' });
  const completed = applyTransition(running, {
    new_status: 'completed',
    result: { summary: 'Workspace provisioned', counts: { created: 2 } }
  });

  assert.deepEqual(completed.result, {
    summary: 'Workspace provisioned',
    counts: { created: 2 }
  });
  assert.equal(completed.completed_at, completed.updated_at);

  for (const unsafeResult of [
    { password: 'hunter2' },
    { auth: 'opaque-sensitive-value' },
    { authHeader: 'opaque-sensitive-value' },
    { clientSecret: 'hunter2' },
    { secretKey: 'hunter2' },
    { clientSecretValue: 'hunter2' },
    { credentialMaterialId: 'opaque-sensitive-value' },
    { passwordValue: 'opaque-sensitive-value' },
    { apiKeyValue: 'opaque-sensitive-value' },
    { accessTokenValue: 'opaque-sensitive-value' },
    { privateKeyValue: 'opaque-sensitive-value' },
    { authorizationHeader: 'opaque-sensitive-value' },
    { passwd: 'hunter2' },
    { pwd: 'hunter2' },
    { passphrase: 'hunter2' },
    { authToken: 'opaque-token' },
    { accessKeyId: AWS_ACCESS_KEY_FIXTURE },
    { secretAccessKey: AWS_SECRET_KEY_FIXTURE },
    { githubPat: GITHUB_PAT_FIXTURE },
    { value: GITHUB_PAT_FIXTURE },
    { value: OPENAI_KEY_FIXTURE },
    { value: STRIPE_KEY_FIXTURE },
    { value: AWS_ACCESS_KEY_FIXTURE },
    { value: 'https://operator:password@example.invalid/resource' },
    { summary: 'postgres://user:pass@db.internal/app' },
    { summary: { nested: 'not a response-contract string' } },
    { message: ['not', 'a', 'string'] },
    { stackTrace: 'Error: failed\n    at run (/srv/app.mjs:10:2)' },
    { summary: '/home/service/private/config.json' },
    { value: '/srv/control-plane/config.json' },
    { value: '/app/private/config.json' },
    { value: '/repo/.env' },
    { value: '/workspace/runtime.json' },
    { value: '/run/secrets/database-password' },
    { value: 'path=/srv/control-plane/config.json' },
    { value: 'file:///etc/passwd' },
    { value: 'Basic YTpi' },
    { value: 'Basic dXNlcjpwYXNz' },
    { value: 'Bearer abcdefghijklmnopqrst' },
    { value: 'Bearer abcdefghijklmnop1234' },
    { value: 'Authorization: Bearer token was issued to the caller.' },
    { value: 'Provider rejected Bearer abcdefghijklmnopqrst during handshake.' },
    JSON.parse('{"__proto__":{"summary":"must not alter the normalized prototype"}}'),
    JSON.parse('{"constructor":{"summary":"must not affect object construction"}}'),
    JSON.parse('{"prototype":{"summary":"must not affect a prototype"}}'),
    { value: 'contains\u0000nul' },
    { value: 'contains lone surrogate \uD800' },
    { ['contains\u0000nul']: 'safe value' },
    { ['contains lone high surrogate \uD800']: 'safe value' },
    { ['contains lone low surrogate \uDC00']: 'safe value' },
    {
      summary: 'Traceback (most recent call last):\n'
        + '  File "worker.py", line 12, in execute\n'
        + '    raise RuntimeError("boom")\n'
        + 'RuntimeError: boom'
    },
    { summary: 'failure in packages/provisioning-orchestrator/src/private-worker.mjs:42' },
    { value: 1n },
    { value: Number.NaN }
  ]) {
    assert.throws(
      () => applyTransition(running, { new_status: 'completed', result: unsafeResult }),
      (error) => error.code === 'VALIDATION_ERROR' && error.field === 'result'
    );
  }
});

test('completion results allow ordinary prose near sensitive vocabulary', () => {
  const operation = createOperation({
    tenant_id: 'tenant-a',
    actor_id: 'actor-1',
    actor_type: 'workspace_admin',
    operation_type: 'WF-CON-001',
    status: 'running'
  });

  const completed = applyTransition(operation, {
    new_status: 'completed',
    result: {
      summary: 'Basic authentication and Bearer authentication documentation were updated. ✅',
      secretariatContact: 'operations@example.invalid',
      note: 'The password policy and project path documentation were updated.'
    }
  });

  assert.equal(completed.status, 'completed');
  assert.equal(completed.result.secretariatContact, 'operations@example.invalid');
});

test('completion result normalization rejects accessors before durable serialization', () => {
  const operation = createOperation({
    tenant_id: 'tenant-a',
    actor_id: 'actor-1',
    actor_type: 'workspace_admin',
    operation_type: 'WF-CON-001',
    status: 'running'
  });
  let reads = 0;
  const accessorResult = {};
  Object.defineProperty(accessorResult, 'value', {
    enumerable: true,
    get() {
      reads += 1;
      return reads === 1
        ? 'safe-looking value'
        : OPENAI_KEY_FIXTURE;
    }
  });

  assert.throws(
    () => applyTransition(operation, { new_status: 'completed', result: accessorResult }),
    (error) => error.code === 'VALIDATION_ERROR' && error.field === 'result'
  );
  assert.equal(reads, 0);
});

test('completion result normalization rejects Proxy serialization traps', () => {
  const operation = createOperation({
    tenant_id: 'tenant-a',
    actor_id: 'actor-1',
    actor_type: 'workspace_admin',
    operation_type: 'WF-CON-001',
    status: 'running'
  });
  const source = { summary: 'Safe summary' };
  const adversarial = new Proxy(source, {
    ownKeys(target) {
      Object.prototype.toJSON = () => ({ passwordValue: 'must not replace canonical data' });
      return Reflect.ownKeys(target);
    }
  });

  assert.throws(
    () => applyTransition(operation, { new_status: 'completed', result: adversarial }),
    (error) => error.code === 'VALIDATION_ERROR' && error.field === 'result'
  );
  assert.equal(Object.hasOwn(Object.prototype, 'toJSON'), false);

  Object.prototype.toJSON = () => ({ passwordValue: 'must not replace canonical data' });
  try {
    assert.throws(
      () => applyTransition(operation, {
        new_status: 'completed',
        result: { summary: 'Safe-looking summary' }
      }),
      (error) => error.code === 'VALIDATION_ERROR' && error.field === 'result'
    );
    assert.throws(
      () => applyTransition(operation, {
        new_status: 'failed',
        error_summary: {
          code: 'DOWNSTREAM',
          message: 'Safe-looking failure.',
          failedStep: 'apply'
        }
      }),
      (error) => error.code === 'VALIDATION_ERROR' && error.field === 'error_summary'
    );
  } finally {
    delete Object.prototype.toJSON;
  }
});

test('failure summary normalization rejects accessors before durable serialization', () => {
  const operation = createOperation({
    tenant_id: 'tenant-a',
    actor_id: 'actor-1',
    actor_type: 'workspace_admin',
    operation_type: 'WF-CON-001',
    status: 'running'
  });
  const reads = { code: 0, message: 0, failedStep: 0 };
  const accessorSummary = {};
  for (const field of Object.keys(reads)) {
    Object.defineProperty(accessorSummary, field, {
      enumerable: true,
      get() {
        reads[field] += 1;
        return field === 'code'
          ? 'DOWNSTREAM'
          : (field === 'message' ? 'Safe-looking failure.' : 'apply');
      }
    });
  }

  assert.throws(
    () => applyTransition(operation, { new_status: 'failed', error_summary: accessorSummary }),
    (error) => error.code === 'VALIDATION_ERROR' && error.field.startsWith('error_summary.')
  );
  assert.deepEqual(reads, { code: 0, message: 0, failedStep: 0 });

  let proxyTraps = 0;
  const proxySummary = new Proxy({
    code: 'DOWNSTREAM',
    message: 'Safe-looking failure.',
    failedStep: 'apply'
  }, {
    getOwnPropertyDescriptor(target, property) {
      proxyTraps += 1;
      return Reflect.getOwnPropertyDescriptor(target, property);
    }
  });
  assert.throws(
    () => applyTransition(operation, { new_status: 'failed', error_summary: proxySummary }),
    (error) => error.code === 'VALIDATION_ERROR' && error.field === 'error_summary'
  );
  assert.equal(proxyTraps, 0);
});

test('applyTransition accepts every safe JSON scalar and container result shape', () => {
  const operation = createOperation({
    tenant_id: 'tenant-a',
    actor_id: 'actor-1',
    actor_type: 'workspace_admin',
    operation_type: 'WF-CON-001'
  });
  const running = applyTransition(operation, { new_status: 'running' });

  for (const safeResult of [
    'Safe scalar summary',
    42,
    false,
    ['safe', 2, true],
    { summary: null, message: 'Safe message 😀', counts: { created: 2 }, ['completed😀']: true }
  ]) {
    const completed = applyTransition(running, {
      new_status: 'completed',
      result: safeResult
    });
    assert.deepEqual(completed.result, safeResult);
  }
});
