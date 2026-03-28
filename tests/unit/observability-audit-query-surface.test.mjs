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
  normalizeAuditRecordQuery,
  queryWorkspaceAuditRecords
} from '../../apps/control-plane/src/observability-audit-query.mjs';

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
