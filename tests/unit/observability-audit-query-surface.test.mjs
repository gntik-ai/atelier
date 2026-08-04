import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectAuditQuerySurfaceViolations,
  readAuthorizationModel,
  readObservabilityAuditEventSchema,
  readObservabilityAuditPipeline,
  readObservabilityAuditQuerySurface,
  readPublicApiTaxonomy,
  readPublicRouteCatalog
} from '../../scripts/lib/observability-audit-query-surface.mjs';
import {
  AUDIT_QUERY_ERROR_CODES,
  encodeAuditRecordQueryCursor,
  normalizeAuditRecordQuery,
  queryTenantAuditRecords,
  queryWorkspaceAuditRecords
} from '../../apps/control-plane-executor/src/observability-audit-query.mjs';

test('observability audit query surface contract remains internally consistent', () => {
  const violations = collectAuditQuerySurfaceViolations();
  assert.deepEqual(violations, []);
});

test('collectAuditQuerySurfaceViolations reports a missing required route id', () => {
  const routeCatalog = structuredClone(readPublicRouteCatalog());
  routeCatalog.routes = routeCatalog.routes.filter((route) => route.operationId !== 'listWorkspaceAuditRecords');

  const violations = collectAuditQuerySurfaceViolations(readObservabilityAuditQuerySurface(), {
    auditPipeline: readObservabilityAuditPipeline(),
    auditEventSchema: readObservabilityAuditEventSchema(),
    authorizationModel: readAuthorizationModel(),
    routeCatalog,
    publicApiTaxonomy: readPublicApiTaxonomy()
  });

  assert.equal(
    violations.includes('Observability audit query surface requires public route catalog operation listWorkspaceAuditRecords.'),
    true
  );
});

test('collectAuditQuerySurfaceViolations reports a missing required filter', () => {
  const contract = structuredClone(readObservabilityAuditQuerySurface());
  contract.filter_dimensions = contract.filter_dimensions.filter((filter) => filter.id !== 'correlation_id');

  const violations = collectAuditQuerySurfaceViolations(contract, {
    auditPipeline: readObservabilityAuditPipeline(),
    auditEventSchema: readObservabilityAuditEventSchema(),
    authorizationModel: readAuthorizationModel(),
    routeCatalog: readPublicRouteCatalog(),
    publicApiTaxonomy: readPublicApiTaxonomy()
  });

  assert.equal(
    violations.includes('Observability audit query surface must define filter correlation_id.'),
    true
  );
});

test('normalizeAuditRecordQuery rejects unsupported sort keys', () => {
  assert.throws(
    () => normalizeAuditRecordQuery('tenant', { tenantId: 'ten_01a' }, { sort: 'actorId' }),
    (error) => error.code === AUDIT_QUERY_ERROR_CODES.INVALID_SORT
  );
});

test('normalizeAuditRecordQuery rejects invalid time windows', () => {
  assert.throws(
    () =>
      normalizeAuditRecordQuery('tenant', { tenantId: 'ten_01a' }, {
        occurredAfter: '2026-03-29T00:00:00Z',
        occurredBefore: '2026-03-28T00:00:00Z'
      }),
    (error) => error.code === AUDIT_QUERY_ERROR_CODES.INVALID_TIME_WINDOW
  );
});

test('queryWorkspaceAuditRecords rejects workspace scope mismatches with a coded error', () => {
  assert.throws(
    () => queryWorkspaceAuditRecords({ tenantId: 'ten_01a', workspaceId: 'wrk_01a' }, { workspaceId: 'wrk_01b' }),
    (error) => error.code === AUDIT_QUERY_ERROR_CODES.SCOPE_VIOLATION
  );
});

test('normalizeAuditRecordQuery enforces max page size', () => {
  assert.throws(
    () => normalizeAuditRecordQuery('tenant', { tenantId: 'ten_01a' }, { limit: 201 }),
    (error) => error.code === AUDIT_QUERY_ERROR_CODES.LIMIT_EXCEEDED
  );
});

test('C-09 internal query contract declares all canonical filters, enum allowlists, defaults and cursor v1', () => {
  const contract = readObservabilityAuditQuerySurface();
  assert.deepEqual(contract.filter_dimensions.map(({ id }) => id), [
    'occurred_after', 'occurred_before', 'subsystem', 'action_category', 'action_id', 'outcome',
    'actor_type', 'actor_id', 'resource_type', 'resource_id', 'origin_surface', 'correlation_id'
  ]);
  assert.deepEqual(contract.filter_dimensions.find(({ id }) => id === 'subsystem').allowed_values, [
    'iam', 'postgresql', 'mongodb', 'kafka', 'openwhisk', 'storage', 'quota_metering',
    'tenant_control_plane', 'mcp'
  ]);
  assert.equal(contract.filter_dimensions.find(({ id }) => id === 'action_category').allowed_values.length, 10);
  assert.equal(contract.pagination.default_limit, 25);
  assert.equal(contract.pagination.max_limit, 200);
  assert.deepEqual(contract.pagination.allowed_sort_values, ['-eventTimestamp', 'eventTimestamp']);
  assert.equal(contract.pagination.cursor.version, 1);
  assert.equal(contract.pagination.cursor.fingerprint_algorithm, 'sha256');
  assert.equal(contract.pagination.cursor.page_size_in_fingerprint, false);
  assert.equal(contract.pagination.cursor.authorization_boundary, false);
});

test('C-09 executor normalization validates single RFC3339 bounds, enums, integer page sizes and cursor compatibility', () => {
  const context = { tenantId: 'ten_01a' };
  const normalized = normalizeAuditRecordQuery('tenant', context, {
    pageSize: '1',
    sort: '-eventTimestamp',
    occurredAfter: '2026-08-04T10:00:00Z',
    subsystem: 'mcp',
    actorId: 'actor-01'
  });
  assert.equal(normalized.limit, 1);
  assert.equal(normalized.filters.occurred_after, '2026-08-04T10:00:00Z');
  assert.equal(normalized.filters.subsystem, 'mcp');

  for (const params of [
    { pageSize: '1.5' },
    { pageSize: ['1', '2'] },
    { occurredAfter: '2026-08-04' },
    { subsystem: 'control-plane' },
    { actorType: 'human' }
  ]) {
    assert.throws(() => normalizeAuditRecordQuery('tenant', context, params));
  }

  const cursor = encodeAuditRecordQueryCursor({
    position: {
      createdAt: '2026-08-04T12:00:00Z',
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
    },
    fingerprint: normalized.cursorFingerprint
  });
  const continuation = normalizeAuditRecordQuery('tenant', context, {
    pageSize: 200,
    sort: normalized.sort,
    occurredAfter: '2026-08-04T10:00:00Z',
    subsystem: 'mcp',
    actorId: 'actor-01',
    cursor
  });
  assert.equal(continuation.limit, 200);
  assert.deepEqual(continuation.cursor, {
    createdAt: '2026-08-04T12:00:00Z',
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
  });
  assert.throws(
    () => normalizeAuditRecordQuery('tenant', context, { ...continuation.filters, cursor, sort: 'eventTimestamp' }),
    (error) => error.code === AUDIT_QUERY_ERROR_CODES.INVALID_CURSOR
  );
});

test('C-09 executor response builder reports the actual empty size and omits terminal cursor', () => {
  const response = queryTenantAuditRecords({ tenantId: 'ten_01a' });
  assert.deepEqual(response.items, []);
  assert.deepEqual(response.page, { size: 0, hasMore: false });
  assert.equal(Object.hasOwn(response.page, 'nextCursor'), false);
});
