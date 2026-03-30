import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv';

import schema from '../../services/internal-contracts/src/async-operation-query-response.json' with { type: 'json' };

const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
const validate = ajv.compile(schema);

function expectValid(payload) {
  const valid = validate(payload);
  assert.equal(valid, true, JSON.stringify(validate.errors));
}

function expectInvalid(payload) {
  const valid = validate(payload);
  assert.equal(valid, false);
}

test('C01/C02 list payload validates and requires pagination', async () => {
  expectValid({
    queryType: 'list',
    items: [
      {
        operationId: '00000000-0000-4000-8000-000000000001',
        status: 'running',
        operationType: 'workspace.create',
        tenantId: 'tenant_a',
        workspaceId: 'wrk_1',
        actorId: 'usr_1',
        actorType: 'tenant_owner',
        createdAt: '2026-03-30T10:00:00.000Z',
        updatedAt: '2026-03-30T10:01:00.000Z',
        correlationId: 'corr_1'
      }
    ],
    total: 1,
    pagination: { limit: 20, offset: 0 }
  });

  expectInvalid({
    queryType: 'list',
    items: [],
    total: 0
  });
});

test('C03/C04 detail payload validates and requires operationId', async () => {
  expectValid({
    queryType: 'detail',
    operationId: '00000000-0000-4000-8000-000000000002',
    status: 'completed',
    operationType: 'workspace.create',
    tenantId: 'tenant_a',
    workspaceId: 'wrk_1',
    actorId: 'usr_2',
    actorType: 'tenant_owner',
    correlationId: 'corr_2',
    idempotencyKey: null,
    sagaId: null,
    createdAt: '2026-03-30T10:00:00.000Z',
    updatedAt: '2026-03-30T10:01:00.000Z',
    errorSummary: null
  });

  expectInvalid({
    queryType: 'detail',
    status: 'completed',
    operationType: 'workspace.create',
    tenantId: 'tenant_a',
    actorId: 'usr_2',
    actorType: 'tenant_owner',
    createdAt: '2026-03-30T10:00:00.000Z',
    updatedAt: '2026-03-30T10:01:00.000Z'
  });
});

test('C05/C06 logs payload accepts empty arrays and rejects invalid levels', async () => {
  expectValid({
    queryType: 'logs',
    operationId: '00000000-0000-4000-8000-000000000003',
    entries: [],
    total: 0,
    pagination: { limit: 20, offset: 0 }
  });

  expectInvalid({
    queryType: 'logs',
    operationId: '00000000-0000-4000-8000-000000000003',
    entries: [
      {
        logEntryId: '10000000-0000-4000-8000-000000000001',
        level: 'debug',
        message: 'Invalido',
        occurredAt: '2026-03-30T10:00:00.000Z'
      }
    ],
    total: 1,
    pagination: { limit: 20, offset: 0 }
  });
});

test('C07/C08/C09/C10 result payload validates success, failure and pending variants', async () => {
  expectValid({
    queryType: 'result',
    operationId: '00000000-0000-4000-8000-000000000004',
    status: 'completed',
    resultType: 'success',
    summary: 'Workspace aprovisionado',
    failureReason: null,
    retryable: null,
    completedAt: '2026-03-30T10:00:00.000Z'
  });
  expectValid({
    queryType: 'result',
    operationId: '00000000-0000-4000-8000-000000000005',
    status: 'failed',
    resultType: 'failure',
    summary: null,
    failureReason: 'Se agotó el tiempo',
    retryable: true,
    completedAt: '2026-03-30T10:05:00.000Z'
  });
  expectValid({
    queryType: 'result',
    operationId: '00000000-0000-4000-8000-000000000006',
    status: 'running',
    resultType: 'pending',
    summary: null,
    failureReason: null,
    retryable: null,
    completedAt: null
  });
  expectInvalid({
    queryType: 'result',
    operationId: '00000000-0000-4000-8000-000000000006',
    status: 'running'
  });
});
