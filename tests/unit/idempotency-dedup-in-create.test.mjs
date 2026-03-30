import test from 'node:test';
import assert from 'node:assert/strict';

import { main } from '../../services/provisioning-orchestrator/src/actions/async-operation-create.mjs';

function buildParams(overrides = {}) {
  return {
    operation_type: 'create-workspace',
    workspace_id: 'ws-01',
    callerContext: {
      tenantId: 'tenant-a',
      correlationId: 'req-correlation',
      actor: { id: 'user-1', type: 'workspace_admin' }
    },
    ...overrides
  };
}

function buildStoredOperation(overrides = {}) {
  return {
    operation_id: '11111111-1111-4111-8111-111111111111',
    tenant_id: 'tenant-a',
    actor_id: 'user-1',
    actor_type: 'workspace_admin',
    workspace_id: 'ws-01',
    operation_type: 'create-workspace',
    status: 'pending',
    correlation_id: 'op:tenant-a:abc:12345678',
    idempotency_key: 'idem-1',
    created_at: '2026-03-30T00:00:00.000Z',
    updated_at: '2026-03-30T00:00:00.000Z',
    ...overrides
  };
}

function buildDbStub() {
  return {
    async query() {
      return { rows: [] };
    }
  };
}

test('deduplicated key returns existing operation and replay headers', async () => {
  const existing = buildStoredOperation();
  let dedupCalled = false;

  const response = await main(buildParams({ idempotency_key: 'idem-1' }), {
    db: buildDbStub(),
    findActiveIdempotencyKey: async () => ({
      tenant_id: 'tenant-a',
      idempotency_key: 'idem-1',
      operation_id: existing.operation_id,
      operation_type: 'create-workspace',
      params_hash: 'hash:match'
    }),
    hashParams: () => 'hash:match',
    findById: async () => existing,
    publishDeduplicationEvent: async () => {
      dedupCalled = true;
    },
    log: () => {}
  });

  assert.equal(response.body.operationId, existing.operation_id);
  assert.equal(response.body.idempotent, true);
  assert.equal(response.headers['X-Idempotent-Replayed'], 'true');
  assert.equal(dedupCalled, true);
});

test('new key creates a fresh operation and persists it inside the original flow', async () => {
  let persisted = false;
  const stored = buildStoredOperation();

  const response = await main(buildParams({ idempotency_key: 'idem-2' }), {
    db: buildDbStub(),
    persistOperation: async () => {
      persisted = true;
      return { ...stored, idempotency_key: 'idem-2' };
    },
    insertOrFindIdempotencyKey: async () => ({
      created: true,
      record: {
        tenant_id: 'tenant-a',
        idempotency_key: 'idem-2',
        operation_id: stored.operation_id,
        operation_type: 'create-workspace',
        params_hash: 'hash:new'
      }
    }),
    hashParams: () => 'hash:new',
    publishStateChanged: async () => {},
    log: () => {}
  });

  assert.equal(persisted, true);
  assert.equal(response.body.idempotent, false);
  assert.equal(response.body.paramsMismatch, false);
});

test('same key with different operation type returns conflict', async () => {
  await assert.rejects(
    () => main(buildParams({ idempotency_key: 'idem-1', operation_type: 'enable-service' }), {
      db: buildDbStub(),
      findActiveIdempotencyKey: async () => ({
        tenant_id: 'tenant-a',
        idempotency_key: 'idem-1',
        operation_id: '11111111-1111-4111-8111-111111111111',
        operation_type: 'create-workspace',
        params_hash: 'hash:match'
      }),
      hashParams: () => 'hash:match',
      log: () => {}
    }),
    (error) => error.code === 'IDEMPOTENCY_KEY_CONFLICT' && error.statusCode === 409
  );
});

test('deduplicated key with params mismatch exposes mismatch in body and headers', async () => {
  const existing = buildStoredOperation();

  const response = await main(buildParams({ idempotency_key: 'idem-1' }), {
    db: buildDbStub(),
    findActiveIdempotencyKey: async () => ({
      tenant_id: 'tenant-a',
      idempotency_key: 'idem-1',
      operation_id: existing.operation_id,
      operation_type: 'create-workspace',
      params_hash: 'hash:old'
    }),
    hashParams: () => 'hash:new',
    findById: async () => existing,
    publishDeduplicationEvent: async () => {},
    log: () => {}
  });

  assert.equal(response.body.idempotent, true);
  assert.equal(response.body.paramsMismatch, true);
  assert.equal(response.headers['X-Idempotent-Params-Mismatch'], 'true');
});

test('request without idempotency key keeps original T01 response shape', async () => {
  const stored = buildStoredOperation({ idempotency_key: null });

  const response = await main(buildParams(), {
    db: buildDbStub(),
    persistOperation: async () => stored,
    publishStateChanged: async () => {},
    log: () => {}
  });

  assert.equal(response.body.operationId, stored.operation_id);
  assert.equal('idempotent' in response.body, false);
});
