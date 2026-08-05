import assert from 'node:assert/strict';
import test from 'node:test';

import { main } from '../../packages/provisioning-orchestrator/src/actions/async-operation-query.mjs';

const TENANT_A = 'tenant-c17-a';
const TENANT_B = 'tenant-c17-b';
const EXISTING_OPERATION_ID = '11111111-1111-4111-8111-111111111111';
const UNKNOWN_OPERATION_ID = '99999999-9999-4999-8999-999999999999';
const FOREIGN_OPERATION_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const UPPERCASE_OPERATION_ID = 'ABCDEF12-ABCD-4BCD-8BCD-ABCDEF123456';
const NIL_OPERATION_ID = '00000000-0000-0000-0000-000000000000';
const UNRESTRICTED_NIBBLES_OPERATION_ID = '12345678-1234-f234-7234-123456789abc';
const LOG_ENTRY_ID = '22222222-2222-4222-8222-222222222222';
const CREATED_AT = '2026-08-05T10:00:00.000Z';
const COMPLETED_AT = '2026-08-05T10:05:00.000Z';

const EXISTING_OPERATION = Object.freeze({
  operation_id: EXISTING_OPERATION_ID,
  status: 'completed',
  operation_type: 'workspace.provision',
  tenant_id: TENANT_A,
  workspace_id: 'workspace-c17-a',
  actor_id: 'operator-c17',
  actor_type: 'tenant-operator',
  params: {},
  correlation_id: 'operation-correlation-c17',
  idempotency_key: null,
  saga_id: null,
  created_at: CREATED_AT,
  updated_at: COMPLETED_AT,
  error_summary: null,
  result: { summary: 'Workspace provisioning completed' },
  completed_at: COMPLETED_AT
});

const FOREIGN_OPERATION = Object.freeze({
  ...EXISTING_OPERATION,
  operation_id: FOREIGN_OPERATION_ID,
  tenant_id: TENANT_B,
  workspace_id: 'workspace-c17-b',
  correlation_id: 'foreign-operation-correlation-c17'
});

const EXISTING_LOG = Object.freeze({
  log_entry_id: LOG_ENTRY_ID,
  operation_id: EXISTING_OPERATION_ID,
  level: 'info',
  message: 'Workspace provisioning completed',
  occurred_at: COMPLETED_AT,
  metadata: {}
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPostgresUuidInput(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const unwrapped = value.startsWith('{') && value.endsWith('}')
    ? value.slice(1, -1)
    : value;
  return /^[0-9a-f-]+$/i.test(unwrapped)
    && unwrapped.replaceAll('-', '').length === 32;
}

/**
 * Hermetic adapter for the action's public database port.
 *
 * PostgreSQL evaluates async-operation identifiers through UUID predicates. The
 * adapter deliberately raises PostgreSQL's observable SQLSTATE 22P02 when a
 * malformed value reaches such a predicate, making the regression fail unless
 * the public action rejects malformed identifiers before touching persistence.
 */
class FaithfulPostgresAdapter {
  constructor({ operations = [EXISTING_OPERATION], logEntries = [EXISTING_LOG] } = {}) {
    this.operations = clone(operations);
    this.initialOperations = clone(operations);
    this.logEntries = clone(logEntries);
    this.calls = [];
    this.writeAttempts = 0;
  }

  get queryCount() {
    return this.calls.length;
  }

  async query(statement, values = []) {
    this.calls.push({ statement, values: clone(values) });

    if (!/^\s*SELECT\b/i.test(statement)) {
      this.writeAttempts += 1;
      throw new Error('The C-17 black-box adapter is read-only');
    }

    this.#enforceUuidPredicates(statement, values);

    if (/\bFROM\s+async_operation_log_entries\b/i.test(statement)) {
      const operationId = this.#predicateValue(statement, values, /\boperation_id\s*=\s*\$(\d+)/i);
      const tenantId = this.#predicateValue(statement, values, /\btenant_id\s*=\s*\$(\d+)/i);
      const operationVisible = this.operations.some(
        (operation) => operation.operation_id === operationId && operation.tenant_id === tenantId
      );
      const entries = operationVisible
        ? this.logEntries.filter((entry) => entry.operation_id === operationId)
        : [];

      if (/\bCOUNT\(\*\)::int\s+AS\s+total\b/i.test(statement)) {
        return { rows: [{ total: entries.length }] };
      }

      const limit = this.#predicateValue(statement, values, /\bLIMIT\s+\$(\d+)/i) ?? entries.length;
      const offset = this.#predicateValue(statement, values, /\bOFFSET\s+\$(\d+)/i) ?? 0;
      return { rows: clone(entries.slice(offset, offset + limit)) };
    }

    if (/\bFROM\s+async_operations\b/i.test(statement)) {
      const operationId = this.#predicateValue(statement, values, /\boperation_id\s*=\s*\$(\d+)/i);
      const tenantId = this.#predicateValue(statement, values, /\btenant_id\s*=\s*\$(\d+)/i);
      let rows = this.operations;

      if (operationId !== undefined) {
        rows = rows.filter((operation) => operation.operation_id === operationId);
      }
      if (tenantId !== undefined) {
        rows = rows.filter((operation) => operation.tenant_id === tenantId);
      }

      if (/\bCOUNT\(\*\)::int\s+AS\s+total\b/i.test(statement)) {
        return { rows: [{ total: rows.length }] };
      }

      const limit = this.#predicateValue(statement, values, /\bLIMIT\s+\$(\d+)/i) ?? rows.length;
      const offset = this.#predicateValue(statement, values, /\bOFFSET\s+\$(\d+)/i) ?? 0;
      return { rows: clone(rows.slice(offset, offset + limit)) };
    }

    throw new Error(`Unexpected SELECT through the public DB port: ${statement}`);
  }

  #enforceUuidPredicates(statement, values) {
    const uuidPredicates = statement.matchAll(/\boperation_id\s*=\s*\$(\d+)/gi);
    for (const predicate of uuidPredicates) {
      const value = values[Number(predicate[1]) - 1];
      if (!isPostgresUuidInput(value)) {
        throw Object.assign(
          new Error(`invalid input syntax for type uuid: "${String(value)}"`),
          { code: '22P02', routine: 'string_to_uuid' }
        );
      }
    }
  }

  #predicateValue(statement, values, pattern) {
    const predicate = statement.match(pattern);
    return predicate ? values[Number(predicate[1]) - 1] : undefined;
  }
}

function trustedHeaders() {
  return {
    'x-auth-subject': 'operator-c17',
    'x-actor-type': 'tenant-operator',
    'x-tenant-id': TENANT_A,
    'x-correlation-id': 'request-correlation-c17'
  };
}

function operationRequest(queryType, operationId = EXISTING_OPERATION_ID, extra = {}) {
  return {
    queryType,
    operationId,
    pagination: { limit: 10, offset: 0 },
    __ow_headers: trustedHeaders(),
    ...extra
  };
}

function createHarness(options) {
  const db = new FaithfulPostgresAdapter(options);
  const publications = [];
  const completionLogs = [];

  return {
    db,
    publications,
    completionLogs,
    overrides: {
      db,
      producer: {
        async send(publication) {
          publications.push(clone(publication));
        }
      },
      log(entry) {
        completionLogs.push(entry);
      }
    }
  };
}

async function captureOutcome(promise) {
  try {
    return { response: await promise, error: null };
  } catch (error) {
    return { response: null, error };
  }
}

function observedFailureBoundary(outcome, harness) {
  return {
    responseStatusCode: outcome.response?.statusCode,
    errorCode: outcome.error?.code,
    errorStatusCode: outcome.error?.statusCode,
    databaseCalls: harness.db.queryCount,
    auditPublications: harness.publications.length,
    completionLogs: harness.completionLogs.length,
    writeAttempts: harness.db.writeAttempts,
    storageUnchanged: harness.db.operations,
  };
}

function expectedFailureBoundary() {
  return {
    responseStatusCode: undefined,
    errorCode: 'VALIDATION_ERROR',
    errorStatusCode: 400,
    databaseCalls: 0,
    auditPublications: 0,
    completionLogs: 0,
    writeAttempts: 0,
    storageUnchanged: clone([EXISTING_OPERATION]),
  };
}

const malformedCases = [
  { id: 'missing', omit: true },
  { id: 'blank', value: '' },
  { id: 'whitespace', value: '   \t' },
  { id: 'null', value: null },
  { id: 'array', value: [EXISTING_OPERATION_ID] },
  { id: 'object', value: { id: EXISTING_OPERATION_ID } },
  { id: 'number', value: 42 },
  { id: 'non_uuid', value: 'not-an-operation-uuid' },
  { id: 'truncated', value: '11111111-1111-1111-1111-11111111111' },
  { id: 'noncanonical_braces', value: `{${EXISTING_OPERATION_ID}}` },
  { id: 'no_hyphens', value: '11111111111141118111111111111111' },
  { id: 'sql_like', value: `${EXISTING_OPERATION_ID}' OR '1'='1` },
  { id: 'overlong', value: `${EXISTING_OPERATION_ID}-unexpected-suffix` }
];

const malformedQueries = [
  {
    queryType: 'detail',
    bbxStart: 1,
    scenario(malformed) {
      return ['non_uuid', 'truncated', 'noncanonical_braces', 'no_hyphens', 'sql_like', 'overlong']
        .includes(malformed.id)
        ? 'P1 detail rejects a malformed identifier'
        : 'Invalid detail stops before every backing layer';
    }
  },
  {
    queryType: 'logs',
    bbxStart: 14,
    scenario(malformed) {
      return ['missing', 'blank', 'whitespace', 'null', 'array', 'object', 'number']
        .includes(malformed.id)
        ? 'P3 logs rejects blank and wrong-type identifiers'
        : 'Invalid logs and result share the same no-side-effect outcome';
    }
  },
  {
    queryType: 'result',
    bbxStart: 27,
    scenario() {
      return 'P10 result uses the same validation boundary';
    }
  }
];

/**
 * bbx-c17-001 through bbx-c17-039
 * fn-async-operation-id-validation
 * OpenSpec C-17 — #### Scenario: P1 detail rejects a malformed identifier
 * OpenSpec C-17 — #### Scenario: Invalid detail stops before every backing layer
 * OpenSpec C-17 — #### Scenario: P3 logs rejects blank and wrong-type identifiers
 * OpenSpec C-17 — #### Scenario: Invalid logs and result share the same no-side-effect outcome
 * OpenSpec C-17 — #### Scenario: P10 result uses the same validation boundary
 */
for (const { queryType, bbxStart, scenario } of malformedQueries) {
  for (const [caseIndex, malformed] of malformedCases.entries()) {
    const bbx = `bbx-c17-${String(bbxStart + caseIndex).padStart(3, '0')}`;
    test(`${bbx}.${queryType}.${malformed.id} | fn-async-operation-id-validation | Scenario: ${scenario(malformed)}`, async () => {
      const harness = createHarness();
      const request = operationRequest(queryType);
      if (malformed.omit) {
        delete request.operationId;
      } else {
        request.operationId = malformed.value;
      }
      const outcome = await captureOutcome(
        main(request, harness.overrides)
      );

      assert.deepEqual(
        observedFailureBoundary(outcome, harness),
        expectedFailureBoundary(),
        `${queryType} must reject ${malformed.id} operationId at the public validation boundary`
      );
    });
  }
}

/**
 * bbx-c17-040 through bbx-c17-042
 * fn-async-operation-id-validation
 * OpenSpec C-17 — #### Scenario: Canonical unknown identifier remains 404
 */
for (const [index, queryType] of ['detail', 'logs', 'result'].entries()) {
  const bbx = `bbx-c17-${String(40 + index).padStart(3, '0')}`;
  test(`${bbx}.${queryType} | fn-async-operation-id-validation | Scenario: Canonical unknown identifier remains 404`, async () => {
    const harness = createHarness();

    await assert.rejects(
      main(operationRequest(queryType, UNKNOWN_OPERATION_ID), harness.overrides),
      (error) => {
        assert.equal(error.code, 'NOT_FOUND');
        assert.equal(error.statusCode, 404);
        return true;
      }
    );

    assert.equal(harness.db.queryCount, 1, 'a valid-shaped identifier must reach the scoped lookup');
    assert.equal(harness.db.writeAttempts, 0);
    assert.equal(harness.publications.length, 0);
    assert.equal(harness.completionLogs.length, 0);
    assert.deepEqual(harness.db.operations, harness.db.initialOperations);
  });
}

/**
 * bbx-c17-043
 * fn-async-operation-id-validation
 * OpenSpec C-17 — #### Scenario: P13 valid foreign identifier is non-leaking
 */
test('bbx-c17-043.foreign_tenant | fn-async-operation-id-validation | Scenario: P13 valid foreign identifier is non-leaking', async () => {
  const harness = createHarness({ operations: [EXISTING_OPERATION, FOREIGN_OPERATION] });

  await assert.rejects(
    main(operationRequest('detail', FOREIGN_OPERATION_ID), harness.overrides),
    (error) => {
      assert.equal(error.code, 'NOT_FOUND');
      assert.equal(error.statusCode, 404);
      assert.doesNotMatch(error.message, new RegExp(TENANT_B, 'i'));
      return true;
    }
  );

  assert.equal(harness.db.queryCount, 1, 'a foreign valid UUID follows the same scoped lookup as an absent UUID');
  assert.equal(harness.db.writeAttempts, 0);
  assert.equal(harness.publications.length, 0);
  assert.equal(harness.completionLogs.length, 0);
  assert.deepEqual(harness.db.operations, harness.db.initialOperations);
});

const successfulQueryCases = [
  {
    bbx: 'bbx-c17-044',
    queryType: 'detail',
    expectedQueryCount: 1,
    expectedBody: {
      queryType: 'detail',
      operationId: EXISTING_OPERATION_ID,
      status: 'completed',
      operationType: 'workspace.provision',
      tenantId: TENANT_A,
      workspaceId: 'workspace-c17-a',
      actorId: 'operator-c17',
      actorType: 'tenant-operator',
      correlationId: 'operation-correlation-c17',
      idempotencyKey: null,
      sagaId: null,
      createdAt: CREATED_AT,
      updatedAt: COMPLETED_AT,
      errorSummary: null
    }
  },
  {
    bbx: 'bbx-c17-045',
    queryType: 'logs',
    expectedQueryCount: 3,
    expectedBody: {
      queryType: 'logs',
      operationId: EXISTING_OPERATION_ID,
      entries: [{
        logEntryId: LOG_ENTRY_ID,
        level: 'info',
        message: 'Workspace provisioning completed',
        occurredAt: COMPLETED_AT
      }],
      total: 1,
      pagination: { limit: 10, offset: 0 }
    }
  },
  {
    bbx: 'bbx-c17-046',
    queryType: 'result',
    expectedQueryCount: 2,
    expectedBody: {
      queryType: 'result',
      operationId: EXISTING_OPERATION_ID,
      status: 'completed',
      resultType: 'success',
      summary: 'Workspace provisioning completed',
      failureReason: null,
      retryable: null,
      completedAt: COMPLETED_AT
    }
  }
];

/**
 * bbx-c17-044 through bbx-c17-046
 * fn-async-operation-query
 * OpenSpec C-17 — #### Scenario: P1 and P3 existing reads remain compatible
 */
for (const queryCase of successfulQueryCases) {
  test(`${queryCase.bbx}.${queryCase.queryType} | fn-async-operation-query | Scenario: P1 and P3 existing reads remain compatible`, async () => {
    const harness = createHarness();
    const response = await main(
      operationRequest(queryCase.queryType),
      harness.overrides
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['X-Correlation-Id'], 'operation-correlation-c17');
    assert.deepEqual(response.body, queryCase.expectedBody);
    assert.equal(harness.db.queryCount, queryCase.expectedQueryCount);
    assert.equal(harness.db.writeAttempts, 0);
    assert.equal(harness.publications.length, 1);
    assert.equal(harness.completionLogs.length, 1);
    assert.match(harness.completionLogs[0], /"event":"async_operation_query_completed"/);
    assert.deepEqual(harness.db.operations, harness.db.initialOperations);
  });
}

const unauthorizedCases = [
  {
    bbx: 'bbx-c17-047',
    id: 'missing_identity',
    request: operationRequest('detail', 'not-a-uuid', { __ow_headers: {} })
  },
  {
    bbx: 'bbx-c17-048',
    id: 'untrusted_body_identity',
    request: operationRequest('detail', { forged: EXISTING_OPERATION_ID }, {
      __ow_headers: {},
      callerContext: {
        actor: { id: 'forged-c17', type: 'superadmin' },
        tenantId: TENANT_A
      }
    })
  }
];

/**
 * bbx-c17-047 and bbx-c17-048
 * fn-async-operation-query-authentication
 * OpenSpec C-17 — #### Scenario: Authentication retains precedence over malformed input
 */
for (const unauthorized of unauthorizedCases) {
  test(`${unauthorized.bbx}.${unauthorized.id} | fn-async-operation-query-authentication | Scenario: Authentication retains precedence over malformed input`, async () => {
    const harness = createHarness();
    const response = await main(unauthorized.request, harness.overrides);

    assert.equal(response.statusCode, 401);
    assert.equal(response.body.code, 'UNAUTHORIZED');
    assert.equal(harness.db.queryCount, 0);
    assert.equal(harness.db.writeAttempts, 0);
    assert.equal(harness.publications.length, 0);
    assert.equal(harness.completionLogs.length, 0);
    assert.deepEqual(harness.db.operations, harness.db.initialOperations);
  });
}

/**
 * bbx-c17-049
 * fn-async-operation-query-tenant-isolation
 * OpenSpec C-17 — #### Scenario: Valid explicit cross-tenant filter retains 403
 */
test('bbx-c17-049.cross_tenant | fn-async-operation-query-tenant-isolation | Scenario: Valid explicit cross-tenant filter retains 403', async () => {
  const harness = createHarness();

  await assert.rejects(
    main(
      operationRequest('detail', EXISTING_OPERATION_ID, { filters: { tenantId: TENANT_B } }),
      harness.overrides
    ),
    (error) => {
      assert.equal(error.code, 'TENANT_ISOLATION_VIOLATION');
      assert.equal(error.statusCode, 403);
      return true;
    }
  );

  assert.equal(harness.db.queryCount, 0);
  assert.equal(harness.db.writeAttempts, 0);
  assert.equal(harness.publications.length, 0);
  assert.equal(harness.completionLogs.length, 0);
  assert.deepEqual(harness.db.operations, harness.db.initialOperations);
});

/**
 * bbx-c17-050
 * fn-async-operation-query-list
 * OpenSpec C-17 — #### Scenario: P3 list without operation identifier is unchanged
 */
test('bbx-c17-050.list | fn-async-operation-query-list | Scenario: P3 list without operation identifier is unchanged', async () => {
  const harness = createHarness();
  const response = await main(
    {
      queryType: 'list',
      filters: { tenantId: TENANT_A },
      pagination: { limit: 10, offset: 0 },
      __ow_headers: trustedHeaders()
    },
    harness.overrides
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    queryType: 'list',
    items: [{
      operationId: EXISTING_OPERATION_ID,
      status: 'completed',
      operationType: 'workspace.provision',
      tenantId: TENANT_A,
      workspaceId: 'workspace-c17-a',
      actorId: 'operator-c17',
      actorType: 'tenant-operator',
      createdAt: CREATED_AT,
      updatedAt: COMPLETED_AT,
      correlationId: 'operation-correlation-c17'
    }],
    total: 1,
    pagination: { limit: 10, offset: 0 }
  });
  assert.equal(harness.db.queryCount, 2);
  assert.equal(harness.db.writeAttempts, 0);
  assert.equal(harness.publications.length, 1);
  assert.equal(harness.completionLogs.length, 1);
  assert.deepEqual(harness.db.operations, harness.db.initialOperations);
});

/**
 * bbx-c17-051
 * fn-async-operation-query-list
 * OpenSpec C-17 — #### Scenario: Irrelevant list identifier does not create a new contract
 */
test('bbx-c17-051.list_irrelevant_id | fn-async-operation-query-list | Scenario: Irrelevant list identifier does not create a new contract', async () => {
  const baselineHarness = createHarness();
  const malformedIdHarness = createHarness();
  const request = {
    queryType: 'list',
    filters: { tenantId: TENANT_A },
    pagination: { limit: 10, offset: 0 },
    __ow_headers: trustedHeaders()
  };

  const baselineResponse = await main(request, baselineHarness.overrides);
  const malformedIdResponse = await main(
    { ...request, operationId: 'not-an-operation-uuid' },
    malformedIdHarness.overrides
  );

  assert.deepEqual(malformedIdResponse, baselineResponse);
  for (const harness of [baselineHarness, malformedIdHarness]) {
    assert.equal(harness.db.queryCount, 2);
    assert.equal(harness.db.writeAttempts, 0);
    assert.equal(harness.publications.length, 1);
    assert.equal(harness.completionLogs.length, 1);
    assert.deepEqual(harness.db.operations, harness.db.initialOperations);
  }
});

const canonicalUuidCases = [
  {
    bbx: 'bbx-c17-052',
    id: 'lowercase_existing',
    operationId: EXISTING_OPERATION_ID,
    expectedStatus: 200
  },
  {
    bbx: 'bbx-c17-053',
    id: 'uppercase_unknown',
    operationId: UPPERCASE_OPERATION_ID,
    expectedStatus: 404
  },
  {
    bbx: 'bbx-c17-054',
    id: 'nil_unknown',
    operationId: NIL_OPERATION_ID,
    expectedStatus: 404
  },
  {
    bbx: 'bbx-c17-055',
    id: 'unrestricted_version_variant_unknown',
    operationId: UNRESTRICTED_NIBBLES_OPERATION_ID,
    expectedStatus: 404
  }
];

/**
 * bbx-c17-052 through bbx-c17-055
 * fn-async-operation-id-validation
 * OpenSpec C-17 — #### Scenario: Canonical UUID syntax is version-neutral
 */
for (const canonicalCase of canonicalUuidCases) {
  test(`${canonicalCase.bbx}.${canonicalCase.id} | fn-async-operation-id-validation | Scenario: Canonical UUID syntax is version-neutral`, async () => {
    const harness = createHarness();
    const outcome = await captureOutcome(
      main(operationRequest('detail', canonicalCase.operationId), harness.overrides)
    );

    assert.equal(harness.db.queryCount, 1, 'every canonical UUID reaches the tenant-scoped lookup');
    assert.equal(harness.db.writeAttempts, 0);
    assert.deepEqual(harness.db.operations, harness.db.initialOperations);

    if (canonicalCase.expectedStatus === 200) {
      assert.equal(outcome.error, null);
      assert.equal(outcome.response.statusCode, 200);
      assert.equal(outcome.response.body.operationId, canonicalCase.operationId);
      assert.equal(harness.publications.length, 1);
      assert.equal(harness.completionLogs.length, 1);
      return;
    }

    assert.equal(outcome.response, null);
    assert.equal(outcome.error?.code, 'NOT_FOUND');
    assert.equal(outcome.error?.statusCode, 404);
    assert.equal(harness.publications.length, 0);
    assert.equal(harness.completionLogs.length, 0);
  });
}
