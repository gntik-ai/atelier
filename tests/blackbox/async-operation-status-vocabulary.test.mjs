import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import Ajv from 'ajv';

import {
  asyncOperationQueryResponseSchema,
  asyncOperationStateChangedSchema
} from '../../packages/internal-contracts/src/index.mjs';
import { main as queryAsyncOperations } from '../../packages/provisioning-orchestrator/src/actions/async-operation-query.mjs';
import {
  CANCELLABLE_STATES,
  TERMINAL_STATES,
  VALID_TRANSITIONS,
  isCancellableState,
  isTerminal,
  validateTransition
} from '../../packages/provisioning-orchestrator/src/models/async-operation-states.mjs';

const CANONICAL_STATUSES = Object.freeze([
  'pending',
  'running',
  'completed',
  'failed',
  'timed_out',
  'cancelling',
  'cancelled'
]);
const ACTIVE_STATUSES = Object.freeze(['pending', 'running', 'cancelling']);
const TERMINAL_STATUSES = Object.freeze(['completed', 'failed', 'timed_out', 'cancelled']);
const CANCELLABLE_STATUSES = Object.freeze(['pending', 'running']);
const LEGAL_TRANSITIONS = Object.freeze({
  pending: Object.freeze(['running', 'cancelled']),
  running: Object.freeze(['completed', 'failed', 'timed_out', 'cancelling']),
  completed: Object.freeze([]),
  failed: Object.freeze([]),
  timed_out: Object.freeze([]),
  cancelling: Object.freeze(['cancelled', 'failed']),
  cancelled: Object.freeze([])
});

const TENANT_ID = 'tenant-c12';
const OPERATION_ID = '12121212-1212-4212-8212-121212121212';
const CREATED_AT = '2026-08-05T12:00:00.000Z';
const UPDATED_AT = '2026-08-05T12:01:00.000Z';
const STALE_COMPLETED_AT = '2026-08-05T12:02:00.000Z';
const MIGRATION_076_URL = new URL(
  '../../packages/provisioning-orchestrator/src/migrations/076-timeout-cancel-recovery.sql',
  import.meta.url
);

const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
const validateQueryResponse = ajv.compile(asyncOperationQueryResponseSchema);
const validateStateChanged = ajv.compile(asyncOperationStateChangedSchema);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function operationSummary(status) {
  return {
    operationId: OPERATION_ID,
    status,
    operationType: 'workspace.provision',
    tenantId: TENANT_ID,
    workspaceId: 'workspace-c12',
    actorId: 'operator-c12',
    actorType: 'tenant-operator',
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    correlationId: 'correlation-c12'
  };
}

function listResponse(status) {
  return {
    queryType: 'list',
    items: [operationSummary(status)],
    total: 1,
    pagination: { limit: 20, offset: 0 }
  };
}

function detailResponse(status) {
  return {
    queryType: 'detail',
    ...operationSummary(status),
    idempotencyKey: null,
    sagaId: null,
    errorSummary: null
  };
}

function resultResponse(status) {
  const resultType = status === 'completed'
    ? 'success'
    : status === 'failed'
      ? 'failure'
      : 'pending';
  const terminal = TERMINAL_STATUSES.includes(status);

  return {
    queryType: 'result',
    operationId: OPERATION_ID,
    status,
    resultType,
    summary: resultType === 'success' ? 'Workspace provisioned' : null,
    failureReason: resultType === 'failure' ? 'Provisioning failed' : null,
    retryable: resultType === 'failure' ? false : null,
    completedAt: terminal ? STALE_COMPLETED_AT : null
  };
}

const QUERY_RESPONSE_FACTORIES = Object.freeze({
  list: listResponse,
  detail: detailResponse,
  result: resultResponse
});

function stateChangedEvent(previousStatus, newStatus) {
  return {
    eventId: '34343434-3434-4434-8434-343434343434',
    eventType: 'async_operation.state_changed',
    operationId: OPERATION_ID,
    tenantId: TENANT_ID,
    workspaceId: 'workspace-c12',
    actorId: 'operator-c12',
    actorType: 'tenant-operator',
    operationType: 'workspace.provision',
    previousStatus,
    newStatus,
    errorSummary: null,
    occurredAt: UPDATED_AT,
    correlationId: 'correlation-c12'
  };
}

function compactErrors(errors) {
  return (errors ?? [])
    .filter((error) => error.keyword === 'enum')
    .map(({ instancePath, params }) => ({ instancePath, allowedValues: params.allowedValues }));
}

function schemaFailure(errors) {
  return JSON.stringify(compactErrors(errors));
}

function assertEnumRejection(validate, payload, expectedInstancePath) {
  assert.equal(validate(payload), false, 'an unknown async-operation status must not validate');
  assert.equal(
    validate.errors?.some(
      (error) => error.keyword === 'enum' && error.instancePath === expectedInstancePath
    ),
    true,
    `expected an enum rejection at ${expectedInstancePath}; received ${JSON.stringify(validate.errors)}`
  );
}

/**
 * bbx-c12-01
 * fn-async-operation-contract-vocabulary
 * OpenSpec fix-c12-async-status-vocabulary — Catalog enumerates the seven ordered values
 */
test('bbx-c12-01 | both internal contracts expose the exact canonical seven-status vocabulary', () => {
  assert.deepEqual(
    asyncOperationQueryResponseSchema.definitions.OperationStatus.enum,
    CANONICAL_STATUSES
  );
  assert.deepEqual(
    asyncOperationStateChangedSchema.properties.previousStatus.enum,
    CANONICAL_STATUSES
  );
  assert.deepEqual(
    asyncOperationStateChangedSchema.properties.newStatus.enum,
    CANONICAL_STATUSES
  );
});

/**
 * bbx-c12-02
 * fn-async-operation-query-contract
 * OpenSpec fix-c12-async-status-vocabulary — List and result responses validate for extended statuses
 * OpenSpec fix-c12-async-status-vocabulary — Detail response validates for extended statuses
 */
test('bbx-c12-02 | list, detail, and C-11-compatible result responses validate for every status', () => {
  const rejected = [];

  for (const [queryType, createPayload] of Object.entries(QUERY_RESPONSE_FACTORIES)) {
    for (const status of CANONICAL_STATUSES) {
      if (!validateQueryResponse(createPayload(status))) {
        const enumPaths = compactErrors(validateQueryResponse.errors)
          .map((error) => error.instancePath)
          .filter((path, index, paths) => paths.indexOf(path) === index);
        rejected.push(`${queryType}:${status}@${enumPaths.join(',')}`);
      }
    }
  }

  assert.deepEqual(rejected, []);
});

/**
 * bbx-c12-03
 * fn-async-operation-query-contract
 * OpenSpec fix-c12-async-status-vocabulary — Unknown status is rejected
 */
test('bbx-c12-03 | list, detail, and result contracts still reject an unknown status', () => {
  for (const [queryType, createPayload] of Object.entries(QUERY_RESPONSE_FACTORIES)) {
    assertEnumRejection(
      validateQueryResponse,
      createPayload('unknown_async_status'),
      queryType === 'list' ? '/items/0/status' : '/status'
    );
  }
});

/**
 * bbx-c12-04
 * fn-async-operation-state-change-contract
 * OpenSpec fix-c12-async-status-vocabulary — Cancellation and timeout transition events validate
 */
test('bbx-c12-04 | state-change contract validates every legal lifecycle edge', () => {
  const rejected = [];

  for (const [previousStatus, nextStatuses] of Object.entries(LEGAL_TRANSITIONS)) {
    for (const newStatus of nextStatuses) {
      if (!validateStateChanged(stateChangedEvent(previousStatus, newStatus))) {
        const enumPaths = compactErrors(validateStateChanged.errors)
          .map((error) => error.instancePath);
        rejected.push(`${previousStatus}->${newStatus}@${enumPaths.join(',')}`);
      }
    }
  }

  assert.deepEqual(rejected, []);
});

/**
 * bbx-c12-05
 * fn-async-operation-state-change-contract
 * OpenSpec fix-c12-async-status-vocabulary — Unknown transition endpoint is rejected
 */
test('bbx-c12-05 | state-change contract rejects an unknown previous or new status', () => {
  assertEnumRejection(
    validateStateChanged,
    stateChangedEvent('unknown_async_status', 'running'),
    '/previousStatus'
  );
  assertEnumRejection(
    validateStateChanged,
    stateChangedEvent('running', 'unknown_async_status'),
    '/newStatus'
  );
});

/**
 * bbx-c12-06
 * fn-async-operation-lifecycle-classification
 * OpenSpec fix-c12-async-status-vocabulary — Catalog records lifecycle classifications
 * OpenSpec fix-c12-async-status-vocabulary — Transition graph invariants are preserved
 */
test('bbx-c12-06 | public lifecycle facade classifies and transitions the seven statuses canonically', () => {
  assert.deepEqual([...TERMINAL_STATES], TERMINAL_STATUSES);
  assert.deepEqual([...CANCELLABLE_STATES], CANCELLABLE_STATUSES);
  assert.deepEqual(
    CANONICAL_STATUSES.filter((status) => !isTerminal(status)),
    ACTIVE_STATUSES
  );
  assert.deepEqual(
    CANONICAL_STATUSES.filter((status) => isTerminal(status)),
    TERMINAL_STATUSES
  );
  assert.deepEqual(
    CANONICAL_STATUSES.filter((status) => isCancellableState(status)),
    CANCELLABLE_STATUSES
  );

  assert.deepEqual(Object.keys(VALID_TRANSITIONS).toSorted(), [...CANONICAL_STATUSES].toSorted());
  for (const status of CANONICAL_STATUSES) {
    assert.deepEqual(VALID_TRANSITIONS[status], LEGAL_TRANSITIONS[status], `transition targets for ${status}`);
    for (const nextStatus of LEGAL_TRANSITIONS[status]) {
      assert.doesNotThrow(() => validateTransition(status, nextStatus));
    }
  }

  for (const [current, next] of [
    ['completed', 'running'],
    ['cancelling', 'completed'],
    ['unknown_async_status', 'running'],
    ['pending', 'unknown_async_status']
  ]) {
    assert.throws(
      () => validateTransition(current, next),
      (error) => error.code === 'INVALID_TRANSITION' && error.current === current && error.next === next
    );
  }
});

function executableSql(sql) {
  return sql
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/--[^\n\r]*/g, '');
}

function namedSqlValues(sql, pattern, artifactName) {
  const matches = [...sql.matchAll(pattern)];
  assert.equal(matches.length, 1, `expected exactly one executable ${artifactName}`);
  return [...matches[0][1].matchAll(/'((?:''|[^'])*)'/g)].map((match) => match[1].replaceAll("''", "'"));
}

/**
 * bbx-c12-07
 * fn-async-operation-migration-parity
 * OpenSpec fix-c12-async-status-vocabulary — Status constraint matches the catalog
 * OpenSpec fix-c12-async-status-vocabulary — Active partial index matches the active subset
 */
test('bbx-c12-07 | immutable migration 076 mirrors the canonical and active status sets', () => {
  const sql = executableSql(readFileSync(MIGRATION_076_URL, 'utf8'));
  const persistedStatuses = namedSqlValues(
    sql,
    /ADD\s+CONSTRAINT\s+async_operations_status_check\s+CHECK\s*\(\s*status\s+IN\s*\(([\s\S]*?)\)\s*\)/gi,
    'async_operations_status_check constraint'
  );
  const indexedStatuses = namedSqlValues(
    sql,
    /CREATE\s+INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+idx_async_ops_status_updated\b[\s\S]*?WHERE\s+status\s+IN\s*\(([\s\S]*?)\)\s*;/gi,
    'idx_async_ops_status_updated partial index'
  );

  assert.deepEqual(persistedStatuses, CANONICAL_STATUSES);
  assert.deepEqual(indexedStatuses.toSorted(), [...ACTIVE_STATUSES].toSorted());
});

const CANCELLING_ROW = Object.freeze({
  operation_id: OPERATION_ID,
  status: 'cancelling',
  operation_type: 'workspace.provision',
  tenant_id: TENANT_ID,
  workspace_id: 'workspace-c12',
  actor_id: 'operator-c12',
  actor_type: 'tenant-operator',
  correlation_id: 'correlation-c12',
  idempotency_key: null,
  saga_id: null,
  created_at: CREATED_AT,
  updated_at: UPDATED_AT,
  error_summary: null,
  result: { summary: 'must not project while cancelling' },
  completed_at: STALE_COMPLETED_AT
});

class ReadOnlyCancellingOperationAdapter {
  constructor() {
    this.calls = [];
    this.writeAttempts = 0;
  }

  async query(statement, values = []) {
    this.calls.push({ statement, values: clone(values) });
    if (!/^\s*SELECT\b/i.test(statement)) {
      this.writeAttempts += 1;
      throw new Error('The C-12 black-box adapter permits read-only SELECT statements only');
    }

    const tenantPlaceholder = statement.match(/\btenant_id\s*=\s*\$(\d+)/i);
    const operationPlaceholder = statement.match(/\boperation_id\s*=\s*\$(\d+)/i);
    const tenantMatches = !tenantPlaceholder
      || values[Number(tenantPlaceholder[1]) - 1] === CANCELLING_ROW.tenant_id;
    const operationMatches = !operationPlaceholder
      || values[Number(operationPlaceholder[1]) - 1] === CANCELLING_ROW.operation_id;
    const visibleRows = tenantMatches && operationMatches ? [CANCELLING_ROW] : [];

    if (/SELECT\s+COUNT\(\*\)::int\s+AS\s+total/i.test(statement)) {
      return { rows: [{ total: visibleRows.length }] };
    }

    return { rows: clone(visibleRows) };
  }
}

function trustedRequest(queryType) {
  return {
    queryType,
    operationId: queryType === 'list' ? undefined : OPERATION_ID,
    filters: { tenantId: TENANT_ID },
    pagination: { limit: 20, offset: 0 },
    __ow_headers: {
      'x-auth-subject': 'operator-c12',
      'x-actor-type': 'tenant-operator',
      'x-tenant-id': TENANT_ID,
      'x-correlation-id': 'request-correlation-c12'
    }
  };
}

/**
 * bbx-c12-08
 * fn-async-operation-query-runtime
 * OpenSpec fix-c12-async-status-vocabulary — Read-only projection under existing authorization
 * C-11 compatibility control: cancelling remains a pending result with no completion projection.
 */
test('bbx-c12-08 | public query runtime projects cancelling unchanged for list, detail, and result', async () => {
  const db = new ReadOnlyCancellingOperationAdapter();
  const publications = [];
  const completionLogs = [];
  const overrides = {
    db,
    producer: {
      async send(publication) {
        publications.push(clone(publication));
      }
    },
    log(entry) {
      completionLogs.push(entry);
    }
  };

  const list = await queryAsyncOperations(trustedRequest('list'), overrides);
  const detail = await queryAsyncOperations(trustedRequest('detail'), overrides);
  const result = await queryAsyncOperations(trustedRequest('result'), overrides);

  assert.equal(list.statusCode, 200);
  assert.equal(list.body.items[0].status, 'cancelling');
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.body.status, 'cancelling');
  assert.equal(result.statusCode, 200);
  assert.deepEqual(
    {
      status: result.body.status,
      resultType: result.body.resultType,
      summary: result.body.summary,
      failureReason: result.body.failureReason,
      retryable: result.body.retryable,
      completedAt: result.body.completedAt
    },
    {
      status: 'cancelling',
      resultType: 'pending',
      summary: null,
      failureReason: null,
      retryable: null,
      completedAt: null
    }
  );

  assert.equal(validateQueryResponse(list.body), true, schemaFailure(validateQueryResponse.errors));
  assert.equal(validateQueryResponse(detail.body), true, schemaFailure(validateQueryResponse.errors));
  assert.equal(validateQueryResponse(result.body), true, schemaFailure(validateQueryResponse.errors));
  assert.equal(db.writeAttempts, 0);
  assert.equal(publications.length, 3, 'one access-audit publication per successful read');
  assert.equal(completionLogs.length, 3, 'one completion log per successful read');
  assert.equal(
    publications.every((publication) => publication.topic === 'console.async-operation.accessed'),
    true
  );
});
