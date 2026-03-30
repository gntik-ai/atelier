import test from 'node:test';
import assert from 'node:assert/strict';

import { main } from '../../services/provisioning-orchestrator/src/actions/async-operation-retry.mjs';

function buildDbStub() {
  return {
    async query() {
      return { rows: [] };
    }
  };
}

function buildFailedOperation(overrides = {}) {
  return {
    operation_id: '11111111-1111-4111-8111-111111111111',
    tenant_id: 'tenant-a',
    actor_id: 'user-1',
    actor_type: 'workspace_admin',
    workspace_id: 'ws-01',
    operation_type: 'create-workspace',
    status: 'failed',
    correlation_id: 'op:tenant-a:prev:12345678',
    attempt_count: 0,
    max_retries: 2,
    created_at: '2026-03-30T00:00:00.000Z',
    updated_at: '2026-03-30T00:00:00.000Z',
    ...overrides
  };
}

function buildParams(overrides = {}) {
  return {
    operation_id: '11111111-1111-4111-8111-111111111111',
    callerContext: {
      tenantId: 'tenant-a',
      actor: { id: 'user-1', type: 'workspace_admin' }
    },
    ...overrides
  };
}

test('failed operation creates a pending retry attempt', async () => {
  const operation = buildFailedOperation();
  const attempt = {
    attempt_id: '22222222-2222-4222-8222-222222222222',
    operation_id: operation.operation_id,
    tenant_id: operation.tenant_id,
    attempt_number: 1,
    correlation_id: 'op:tenant-a:new:abcdef12',
    actor_id: 'user-1',
    actor_type: 'workspace_admin',
    status: 'pending',
    created_at: '2026-03-30T00:01:00.000Z'
  };

  const response = await main(buildParams(), {
    db: buildDbStub(),
    findByIdAnyTenant: async () => operation,
    createRetryAttemptModel: () => attempt,
    createRetryAttempt: async () => attempt,
    atomicResetToRetry: async () => ({ ...operation, status: 'pending', attempt_count: 1, correlation_id: attempt.correlation_id }),
    insertAsyncOperationTransition: async () => {},
    publishRetryEvent: async () => {},
    log: () => {}
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.attemptId, attempt.attempt_id);
  assert.equal(response.body.status, 'pending');
  assert.equal(response.headers['X-Correlation-Id'], attempt.correlation_id);
});

test('running or completed operations cannot be retried', async () => {
  for (const status of ['running', 'completed']) {
    await assert.rejects(
      () => main(buildParams(), {
        db: buildDbStub(),
        findByIdAnyTenant: async () => buildFailedOperation({ status }),
        log: () => {}
      }),
      (error) => error.code === 'INVALID_OPERATION_STATE' && error.statusCode === 409
    );
  }
});

test('max retries exceeded returns 422', async () => {
  await assert.rejects(
    () => main(buildParams(), {
      db: buildDbStub(),
      findByIdAnyTenant: async () => buildFailedOperation({ attempt_count: 2, max_retries: 2 }),
      log: () => {}
    }),
    (error) => error.code === 'MAX_RETRIES_EXCEEDED' && error.statusCode == 422
  );
});

test('tenant mismatch returns 403', async () => {
  await assert.rejects(
    () => main(buildParams(), {
      db: buildDbStub(),
      findByIdAnyTenant: async () => buildFailedOperation({ tenant_id: 'tenant-b' }),
      log: () => {}
    }),
    (error) => error.code === 'FORBIDDEN' && error.statusCode === 403
  );
});

test('tenant deactivated returns 400', async () => {
  await assert.rejects(
    () => main(buildParams(), {
      db: buildDbStub(),
      findByIdAnyTenant: async () => buildFailedOperation(),
      isTenantActive: () => false,
      log: () => {}
    }),
    (error) => error.code === 'TENANT_DEACTIVATED' && error.statusCode === 400
  );
});

test('superadmin can retry operations across tenants', async () => {
  const operation = buildFailedOperation({ tenant_id: 'tenant-b' });
  const attempt = {
    attempt_id: '33333333-3333-4333-8333-333333333333',
    operation_id: operation.operation_id,
    tenant_id: operation.tenant_id,
    attempt_number: 1,
    correlation_id: 'op:tenant-b:new:abcdef12',
    actor_id: 'root-1',
    actor_type: 'superadmin',
    status: 'pending',
    created_at: '2026-03-30T00:01:00.000Z'
  };

  const response = await main({
    operation_id: operation.operation_id,
    callerContext: { actor: { id: 'root-1', type: 'superadmin' } }
  }, {
    db: buildDbStub(),
    findByIdAnyTenant: async () => operation,
    createRetryAttemptModel: () => attempt,
    createRetryAttempt: async () => attempt,
    atomicResetToRetry: async () => ({ ...operation, status: 'pending', attempt_count: 1, correlation_id: attempt.correlation_id }),
    insertAsyncOperationTransition: async () => {},
    publishRetryEvent: async () => {},
    log: () => {}
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.operationId, operation.operation_id);
});
