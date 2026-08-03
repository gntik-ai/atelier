import assert from 'node:assert/strict';
import test from 'node:test';

import { main } from '../../packages/provisioning-orchestrator/src/actions/async-operation-query.mjs';

const TENANT_A = 'tenant-c13-a';
const TENANT_B = 'tenant-c13-b';
const WORKSPACE_A = 'workspace-c13-a';
const WORKSPACE_B = 'workspace-c13-b';
const OPERATION_TYPE = 'workspace.provision';

const OPERATIONS = Object.freeze([
  operation({
    operationId: 'op-c13-running-in-scope',
    status: 'running',
    tenantId: TENANT_A,
    workspaceId: WORKSPACE_A,
    operationType: OPERATION_TYPE,
    createdAt: '2026-07-29T10:06:00.000Z'
  }),
  operation({
    operationId: 'op-c13-pending-in-scope',
    status: 'pending',
    tenantId: TENANT_A,
    workspaceId: WORKSPACE_A,
    operationType: OPERATION_TYPE,
    createdAt: '2026-07-29T10:05:00.000Z'
  }),
  operation({
    operationId: 'op-c13-completed-in-scope',
    status: 'completed',
    tenantId: TENANT_A,
    workspaceId: WORKSPACE_A,
    operationType: OPERATION_TYPE,
    createdAt: '2026-07-29T10:04:00.000Z'
  }),
  operation({
    operationId: 'op-c13-running-other-type',
    status: 'running',
    tenantId: TENANT_A,
    workspaceId: WORKSPACE_A,
    operationType: 'tenant.backup',
    createdAt: '2026-07-29T10:03:00.000Z'
  }),
  operation({
    operationId: 'op-c13-pending-other-workspace',
    status: 'pending',
    tenantId: TENANT_A,
    workspaceId: WORKSPACE_B,
    operationType: OPERATION_TYPE,
    createdAt: '2026-07-29T10:02:00.000Z'
  }),
  operation({
    operationId: 'op-c13-running-other-tenant',
    status: 'running',
    tenantId: TENANT_B,
    workspaceId: WORKSPACE_A,
    operationType: OPERATION_TYPE,
    createdAt: '2026-07-29T10:01:00.000Z'
  })
]);

function operation({ operationId, status, tenantId, workspaceId, operationType, createdAt }) {
  return Object.freeze({
    operation_id: operationId,
    status,
    operation_type: operationType,
    tenant_id: tenantId,
    workspace_id: workspaceId,
    actor_id: 'fixture-actor',
    actor_type: 'tenant-operator',
    created_at: createdAt,
    updated_at: createdAt,
    correlation_id: `correlation-${operationId}`
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * A hermetic PostgreSQL-semantic adapter for the public action's DB port.
 *
 * PostgreSQL infers the parameter in `text_column = $n` as text. node-postgres
 * serializes a JavaScript array as a PostgreSQL array literal, so equality
 * compares the column with text such as `{"running","pending"}` and matches no
 * status. `= ANY($n::text[])` instead applies set-membership semantics.
 */
class HermeticPostgresAdapter {
  constructor(rows) {
    this.rows = clone(rows);
    this.initialRows = clone(rows);
    this.queryCount = 0;
    this.writeAttempts = 0;
  }

  async query(statement, values = []) {
    this.queryCount += 1;

    if (!/^\s*SELECT\b/i.test(statement)) {
      this.writeAttempts += 1;
      throw new Error('The black-box DB adapter accepts read-only SELECT statements only');
    }

    let resultRows = this.rows.filter((row) => matchesWhere(row, statement, values));

    if (/ORDER\s+BY\s+created_at\s+DESC/i.test(statement)) {
      resultRows = resultRows.toSorted((left, right) => right.created_at.localeCompare(left.created_at));
    }

    if (/SELECT\s+COUNT\(\*\)::int\s+AS\s+total/i.test(statement)) {
      return { rows: [{ total: resultRows.length }] };
    }

    const limit = placeholderValue(statement, values, /\bLIMIT\s+\$(\d+)/i, resultRows.length);
    const offset = placeholderValue(statement, values, /\bOFFSET\s+\$(\d+)/i, 0);
    return { rows: clone(resultRows.slice(offset, offset + limit)) };
  }
}

function matchesWhere(row, statement, values) {
  if (/\bWHERE\b[\s\S]*\b(?:FALSE|1\s*=\s*0)\b/i.test(statement)) {
    return false;
  }

  if (!matchesScalarColumn(row.tenant_id, statement, values, /\btenant_id\s*=\s*\$(\d+)/i)) {
    return false;
  }

  if (!matchesScalarColumn(row.operation_type, statement, values, /\boperation_type\s*=\s*\$(\d+)/i)) {
    return false;
  }

  if (!matchesScalarColumn(row.workspace_id, statement, values, /\bworkspace_id\s*=\s*\$(\d+)/i)) {
    return false;
  }

  const anyStatus = statement.match(/\bstatus\s*=\s*ANY\s*\(\s*\$(\d+)(?:::\s*text\[\])?\s*\)/i);
  if (anyStatus) {
    const requestedStatuses = values[Number(anyStatus[1]) - 1];
    return Array.isArray(requestedStatuses) && requestedStatuses.includes(row.status);
  }

  return matchesScalarColumn(row.status, statement, values, /\bstatus\s*=\s*\$(\d+)/i, postgresText);
}

function matchesScalarColumn(columnValue, statement, values, pattern, serialize = String) {
  const predicate = statement.match(pattern);
  if (!predicate) {
    return true;
  }

  const parameterValue = values[Number(predicate[1]) - 1];
  return String(columnValue) === serialize(parameterValue);
}

function postgresText(value) {
  if (!Array.isArray(value)) {
    return String(value);
  }

  const elements = value.map((item) => `"${String(item).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`);
  return `{${elements.join(',')}}`;
}

function placeholderValue(statement, values, pattern, fallback) {
  const placeholder = statement.match(pattern);
  return placeholder ? Number(values[Number(placeholder[1]) - 1]) : fallback;
}

function createHarness(rows = OPERATIONS) {
  const db = new HermeticPostgresAdapter(rows);
  const publications = [];
  const logs = [];
  const producer = {
    async send(publication) {
      publications.push(clone(publication));
    }
  };

  return {
    db,
    publications,
    logs,
    overrides: {
      db,
      producer,
      log(entry) {
        logs.push(entry);
      }
    }
  };
}

function trustedListRequest(filters) {
  return {
    __ow_headers: {
      'x-auth-subject': 'operator-c13',
      'x-actor-type': 'tenant-operator',
      'x-tenant-id': TENANT_A,
      'x-correlation-id': 'request-correlation-c13'
    },
    queryType: 'list',
    filters,
    pagination: { limit: 100, offset: 0 }
  };
}

function assertOneAuditPublication(harness) {
  assert.equal(harness.publications.length, 1, 'one successful request must publish audit exactly once');
  assert.equal(harness.publications[0].topic, 'console.async-operation.accessed');
  assert.equal(harness.publications[0].messages.length, 1);

  const event = JSON.parse(harness.publications[0].messages[0].value);
  assert.equal(event.actorId, 'operator-c13');
  assert.equal(event.tenantId, TENANT_A);
  assert.equal(event.queryType, 'list');
}

function assertReadOnly(harness) {
  assert.equal(harness.db.writeAttempts, 0, 'status filtering must remain read-only');
  assert.deepEqual(harness.db.rows, harness.db.initialRows, 'status filtering must not mutate operation state');
}

function operationIds(response) {
  return response.body.items.map((item) => item.operationId);
}

/**
 * bbx-c13-01
 * fn-async-operation-query-status-array
 * OpenSpec fix-c13-async-status-array — #### Scenario: Multi-status arrays use set membership while tenant, workspace and type remain AND-scoped
 */
test('bbx-c13-01 | running ∪ pending excludes completed and preserves all scope filters', async () => {
  const harness = createHarness();

  const response = await main(
    trustedListRequest({
      tenantId: TENANT_A,
      status: ['running', 'pending'],
      workspaceId: WORKSPACE_A,
      operationType: OPERATION_TYPE
    }),
    harness.overrides
  );

  assert.equal(response.statusCode, 200);
  assertOneAuditPublication(harness);
  assertReadOnly(harness);
  assert.deepEqual(operationIds(response), ['op-c13-running-in-scope', 'op-c13-pending-in-scope']);
  assert.equal(response.body.total, 2);
});

/**
 * bbx-c13-02
 * fn-async-operation-query-status-array
 * OpenSpec fix-c13-async-status-array — #### Scenario: A singleton status array is equivalent to the same scalar status
 */
test('bbx-c13-02 | singleton array and scalar status return the same observable page', async () => {
  const filters = {
    tenantId: TENANT_A,
    workspaceId: WORKSPACE_A,
    operationType: OPERATION_TYPE
  };
  const scalarHarness = createHarness();
  const arrayHarness = createHarness();

  const scalarResponse = await main(
    trustedListRequest({ ...filters, status: 'completed' }),
    scalarHarness.overrides
  );
  const arrayResponse = await main(
    trustedListRequest({ ...filters, status: ['completed'] }),
    arrayHarness.overrides
  );

  assert.equal(scalarResponse.statusCode, 200);
  assert.equal(arrayResponse.statusCode, 200);
  assertOneAuditPublication(scalarHarness);
  assertOneAuditPublication(arrayHarness);
  assertReadOnly(scalarHarness);
  assertReadOnly(arrayHarness);
  assert.deepEqual(arrayResponse.body, scalarResponse.body);
  assert.deepEqual(operationIds(arrayResponse), ['op-c13-completed-in-scope']);
});

/**
 * bbx-c13-03
 * fn-async-operation-query-status-array
 * OpenSpec fix-c13-async-status-array — #### Scenario: An empty status array is explicitly false and never widens the listing
 */
test('bbx-c13-03 | empty status array returns a safe empty page', async () => {
  const harness = createHarness();

  const response = await main(
    trustedListRequest({
      tenantId: TENANT_A,
      status: [],
      workspaceId: WORKSPACE_A,
      operationType: OPERATION_TYPE
    }),
    harness.overrides
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(operationIds(response), []);
  assert.equal(response.body.total, 0);
  assertOneAuditPublication(harness);
  assertReadOnly(harness);
});

/**
 * bbx-c13-04
 * fn-async-operation-query-tenant-isolation
 * OpenSpec fix-c13-async-status-array — #### Scenario: A cross-tenant filter mismatch is forbidden before querying
 */
test('bbx-c13-04 | cross-tenant mismatch returns 403 without querying or publishing audit', async () => {
  const harness = createHarness();

  await assert.rejects(
    main(
      trustedListRequest({
        tenantId: TENANT_B,
        status: ['running', 'pending'],
        workspaceId: WORKSPACE_A,
        operationType: OPERATION_TYPE
      }),
      harness.overrides
    ),
    (error) => {
      assert.equal(error.statusCode, 403);
      assert.equal(error.code, 'TENANT_ISOLATION_VIOLATION');
      return true;
    }
  );

  assert.equal(harness.db.queryCount, 0);
  assert.equal(harness.db.writeAttempts, 0);
  assert.equal(harness.publications.length, 0);
  assert.deepEqual(harness.db.rows, harness.db.initialRows);
});
