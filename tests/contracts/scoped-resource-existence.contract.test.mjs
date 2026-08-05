/**
 * C-16 contract regression: the published metrics surface must declare a canonical
 * `404 ErrorResponse` for exactly the eleven tenant/workspace scope reads that can now
 * terminate as not-found, the pre-existing metrics/storage `404` declarations must be
 * preserved, the runtime-only tenant metric series must stay unpublished, and the
 * generated metrics family must not drift from the unified OpenAPI source.
 *
 * The runtime-bridge section proves each newly declared `404` corresponds to a real
 * handler outcome (TENANT_NOT_FOUND / WORKSPACE_NOT_FOUND for a missing scope), so the
 * contract addition is not a phantom that the code never produces. Discovery is by
 * operationId and by set comparison — never by line position.
 */
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import { METRICS_HANDLERS } from '../../apps/control-plane/metrics-handlers.mjs';
import { STORAGE_HANDLERS } from '../../apps/control-plane/storage-handlers.mjs';

const UNIFIED_PATH = 'apps/control-plane-executor/openapi/control-plane.openapi.json';
const FAMILY_PATH = 'apps/control-plane-executor/openapi/families/metrics.openapi.json';
const ROUTE_CATALOG_PATH = 'packages/internal-contracts/src/public-route-catalog.json';
const PUBLIC_API_DOCS_PATH = 'docs/reference/architecture/public-api-surface.md';

const ERROR_REF = '#/components/schemas/ErrorResponse';

const unified = JSON.parse(readFileSync(UNIFIED_PATH, 'utf8'));
const family = JSON.parse(readFileSync(FAMILY_PATH, 'utf8'));
const routeCatalog = JSON.parse(readFileSync(ROUTE_CATALOG_PATH, 'utf8'));
const publicApiDocs = readFileSync(PUBLIC_API_DOCS_PATH, 'utf8');

// The exactly eleven published operations C-16 gives a canonical 404, mapped to the
// runtime handler each is served by (the runtime-only tenant series is intentionally absent).
const C16_TENANT_OPS = Object.freeze({
  getTenantQuotaPosture: 'metricsTenantQuotas',
  getTenantQuotaUsageOverview: 'metricsTenantOverview',
  getTenantUsageSnapshot: 'metricsTenantUsage',
  listTenantAuditRecords: 'metricsTenantAudit',
  exportTenantAuditRecords: 'metricsTenantAuditExport'
});
const C16_WORKSPACE_OPS = Object.freeze({
  getWorkspaceQuotaPosture: 'metricsWorkspaceQuotas',
  getWorkspaceQuotaUsageOverview: 'metricsWorkspaceOverview',
  getWorkspaceUsageSnapshot: 'metricsWorkspaceUsage',
  getWorkspaceMetricSeries: 'metricsWorkspaceSeries',
  listWorkspaceAuditRecords: 'metricsWorkspaceAudit',
  exportWorkspaceAuditRecords: 'metricsWorkspaceAuditExport'
});
const C16_OPERATION_IDS = Object.freeze([
  ...Object.keys(C16_TENANT_OPS),
  ...Object.keys(C16_WORKSPACE_OPS)
]);
// Metrics 404s that predate C-16 and must remain byte-for-semantics unchanged.
const PRESERVED_METRICS_404 = Object.freeze(['getTenantAuditCorrelation', 'getWorkspaceAuditCorrelation']);
const STORAGE_USAGE_OP = 'getWorkspaceStorageUsage';

function findOperation(document, operationId) {
  for (const item of Object.values(document.paths ?? {})) {
    for (const operation of Object.values(item)) {
      if (operation && typeof operation === 'object' && operation.operationId === operationId) {
        return operation;
      }
    }
  }
  return null;
}

function notFoundRef(operation) {
  return operation?.responses?.['404']?.content?.['application/json']?.schema?.$ref ?? null;
}

function operationsWith404(document) {
  const ids = new Set();
  for (const item of Object.values(document.paths ?? {})) {
    for (const operation of Object.values(item)) {
      if (operation && typeof operation === 'object' && operation.operationId
        && Object.prototype.hasOwnProperty.call(operation.responses ?? {}, '404')) {
        ids.add(operation.operationId);
      }
    }
  }
  return ids;
}

function tenantSeriesPaths(document) {
  return Object.keys(document.paths ?? {}).filter((path) => /\/metrics\/tenants\/\{[^}]+\}\/series/.test(path));
}

// C-16 is exactly eleven operations. This asserts the diff's size at the contract layer.
assert.equal(C16_OPERATION_IDS.length, 11, 'C-16 must publish 404 for exactly eleven operations');

// bbx-c16-contract-001 | The eleven C-16 operations declare a canonical 404 in the unified OpenAPI.
for (const operationId of C16_OPERATION_IDS) {
  test(`bbx-c16-contract-001.${operationId} | unified OpenAPI declares canonical 404`, () => {
    const operation = findOperation(unified, operationId);
    assert.ok(operation, `${operationId} must exist in the unified OpenAPI`);
    assert.equal(
      notFoundRef(operation),
      ERROR_REF,
      `${operationId} must declare a 404 JSON response referencing the canonical ErrorResponse`
    );
  });
}

// bbx-c16-contract-002 | The generated metrics family mirrors the unified 404 (no generation drift).
for (const operationId of C16_OPERATION_IDS) {
  test(`bbx-c16-contract-002.${operationId} | generated metrics family mirrors the 404`, () => {
    const operation = findOperation(family, operationId);
    assert.ok(operation, `${operationId} must appear in the generated metrics family`);
    assert.equal(
      notFoundRef(operation),
      ERROR_REF,
      `${operationId} 404 must survive generation into the metrics family without drift`
    );
    assert.deepEqual(
      findOperation(family, operationId).responses['404'],
      findOperation(unified, operationId).responses['404'],
      `${operationId} 404 must be byte-for-semantics identical between unified source and generated family`
    );
  });
}

// bbx-c16-contract-003 | Pre-existing metrics 404 contracts are preserved unchanged.
for (const operationId of PRESERVED_METRICS_404) {
  test(`bbx-c16-contract-003.${operationId} | pre-existing metrics 404 preserved`, () => {
    assert.equal(notFoundRef(findOperation(unified, operationId)), ERROR_REF,
      `${operationId} must retain its pre-existing 404 in the unified OpenAPI`);
    assert.equal(notFoundRef(findOperation(family, operationId)), ERROR_REF,
      `${operationId} must retain its pre-existing 404 in the metrics family`);
  });
}

// bbx-c16-contract-004 | The metrics family's exact 404 set is the eleven C-16 ops plus the two
// pre-existing audit-correlation ops — nothing more (guards against accidental over-addition) and
// nothing less (guards against a missing op).
test('bbx-c16-contract-004 | metrics family 404 set equals the eleven C-16 ops plus the two preserved ops', () => {
  const actual = [...operationsWith404(family)].sort();
  const expected = [...C16_OPERATION_IDS, ...PRESERVED_METRICS_404].sort();
  assert.deepEqual(actual, expected, 'no metrics operation outside the C-16 + preserved set may declare a 404');
});

// bbx-c16-contract-005 | The workspace storage-usage 404 is preserved and untouched by C-16.
test('bbx-c16-contract-005 | getWorkspaceStorageUsage retains its canonical 404', () => {
  assert.equal(notFoundRef(findOperation(unified, STORAGE_USAGE_OP)), ERROR_REF,
    'getWorkspaceStorageUsage must retain its pre-existing canonical 404');
  // Storage usage belongs to the storage family, so it must NOT appear in the metrics family.
  assert.equal(findOperation(family, STORAGE_USAGE_OP), null,
    'getWorkspaceStorageUsage is a storage operation and must not enter the metrics family');
});

// bbx-c16-contract-006 | The runtime-only tenant metric series stays unpublished everywhere.
test('bbx-c16-contract-006 | tenant metric series is absent from all published surfaces', () => {
  assert.deepEqual(tenantSeriesPaths(unified), [], 'no tenant metric-series path may appear in the unified OpenAPI');
  assert.deepEqual(tenantSeriesPaths(family), [], 'no tenant metric-series path may appear in the metrics family');
  assert.equal(findOperation(unified, 'getTenantMetricSeries'), null, 'no tenant metric-series operation id may be published');
  const catalogTenantSeries = (routeCatalog.routes ?? []).filter((route) => /\/metrics\/tenants\/\{[^}]+\}\/series/.test(route.path ?? ''));
  assert.deepEqual(catalogTenantSeries, [], 'no tenant metric-series route may appear in the public route catalog');
  assert.ok((routeCatalog.routes ?? []).some((route) => route.operationId === 'getWorkspaceMetricSeries'),
    'positive control: the published workspace metric-series route must be present');
  assert.equal(/\/metrics\/tenants\/\{[^}]+\}\/series/.test(publicApiDocs), false,
    'no tenant metric-series row may appear in the generated public API surface doc');
});

// bbx-c16-contract-007 | The canonical closed ErrorResponse envelope is the referenced schema in
// both the unified source and the generated family (C-16 adds no alternate envelope/taxonomy).
test('bbx-c16-contract-007 | the referenced 404 schema is the canonical closed ErrorResponse', () => {
  for (const document of [unified, family]) {
    const schema = document.components?.schemas?.ErrorResponse;
    assert.ok(schema, 'ErrorResponse must be defined in components.schemas');
    assert.equal(schema.additionalProperties, false, 'ErrorResponse must remain a closed envelope');
  }
});

// ---- runtime ↔ contract bridge ---------------------------------------------
// Each newly declared 404 must be a real handler outcome for a missing scope, not a phantom
// contract. An empty registry makes every addressed tenant/workspace absent.
const SUPERADMIN = Object.freeze({
  sub: 'svc_c16_contract',
  tenantId: null,
  workspaceId: null,
  actorType: 'superadmin',
  roles: ['superadmin'],
  scopes: []
});

function emptyRegistryPool() {
  return {
    async query() {
      return { rows: [] };
    },
    async connect() {
      return { query: async () => ({ rows: [] }), release() {} };
    }
  };
}

function tenantCtx() {
  return {
    pool: emptyRegistryPool(),
    params: { tenantId: 'ten_c16_contract_missing' },
    query: {},
    body: { format: 'jsonl', pageSize: 1 },
    identity: SUPERADMIN,
    callerContext: { actor: { id: SUPERADMIN.sub, type: 'superadmin' }, correlationId: 'corr_c16_contract' },
    nowMs: () => 0
  };
}

function workspaceCtx() {
  return {
    pool: emptyRegistryPool(),
    params: { workspaceId: 'wrk_c16_contract_missing' },
    query: {},
    body: { format: 'jsonl', pageSize: 1 },
    identity: SUPERADMIN,
    callerContext: { actor: { id: SUPERADMIN.sub, type: 'superadmin' }, correlationId: 'corr_c16_contract' },
    nowMs: () => 0
  };
}

// bbx-c16-contract-008 | Every published tenant metrics op returns 404 TENANT_NOT_FOUND for a missing tenant.
for (const [operationId, handlerName] of Object.entries(C16_TENANT_OPS)) {
  test(`bbx-c16-contract-008.${operationId} | runtime returns 404 TENANT_NOT_FOUND for a missing tenant`, async () => {
    const result = await METRICS_HANDLERS[handlerName](tenantCtx());
    assert.equal(result.statusCode, 404, `${operationId}: missing tenant must be 404, got ${result.statusCode}`);
    assert.equal(result.body.code, 'TENANT_NOT_FOUND');
  });
}

// bbx-c16-contract-009 | Every published workspace metrics op returns 404 WORKSPACE_NOT_FOUND for a missing workspace.
for (const [operationId, handlerName] of Object.entries(C16_WORKSPACE_OPS)) {
  test(`bbx-c16-contract-009.${operationId} | runtime returns 404 WORKSPACE_NOT_FOUND for a missing workspace`, async () => {
    const result = await METRICS_HANDLERS[handlerName](workspaceCtx());
    assert.equal(result.statusCode, 404, `${operationId}: missing workspace must be 404, got ${result.statusCode}`);
    assert.equal(result.body.code, 'WORKSPACE_NOT_FOUND');
  });
}

// bbx-c16-contract-010 | The storage-usage op returns 404 WORKSPACE_NOT_FOUND for a missing workspace,
// including for a privileged actor (the C-16 behavior the pre-existing declaration now truthfully covers).
test('bbx-c16-contract-010 | getWorkspaceStorageUsage returns 404 WORKSPACE_NOT_FOUND for a missing workspace', async () => {
  const result = await STORAGE_HANDLERS.storageWorkspaceUsage(workspaceCtx());
  assert.equal(result.statusCode, 404, `missing workspace storage usage must be 404, got ${result.statusCode}`);
  assert.equal(result.body.code, 'WORKSPACE_NOT_FOUND');
});
