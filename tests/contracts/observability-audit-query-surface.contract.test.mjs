import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import SwaggerParser from '@apidevtools/swagger-parser';

import {
  OBSERVABILITY_AUDIT_QUERY_SURFACE_VERSION,
  getAuditConsoleSurface,
  getAuditQueryFilter,
  getAuditQueryPaginationPolicy,
  getAuditQueryScope,
  getPublicRoute,
  listAuditQueryFilters,
  readAuthorizationModel,
  readObservabilityAuditQuerySurface
} from '../../packages/internal-contracts/src/index.mjs';
import { OPENAPI_PATH } from '../../scripts/lib/quality-gates.mjs';
import { buildAuditExplorerView, listAuditQueryRoutes } from '../../apps/control-plane-executor/src/observability-audit-query.mjs';

test('observability audit query surface contract is exposed through shared readers', () => {
  const contract = readObservabilityAuditQuerySurface();
  const tenantScope = getAuditQueryScope('tenant');
  const workspaceScope = getAuditQueryScope('workspace');
  const correlationFilter = getAuditQueryFilter('correlation_id');
  const pagination = getAuditQueryPaginationPolicy();
  const consoleSurface = getAuditConsoleSurface();

  assert.equal(contract.version, '2026-03-28');
  assert.equal(OBSERVABILITY_AUDIT_QUERY_SURFACE_VERSION, '2026-03-28');
  assert.equal(tenantScope.route_operation_id, 'listTenantAuditRecords');
  assert.equal(workspaceScope.required_permission, 'workspace.audit.read');
  assert.equal(correlationFilter.param, 'filter[correlationId]');
  assert.equal(pagination.max_limit, 200);
  assert.equal(consoleSurface.entry_scopes.includes('workspace'), true);
});

test('observability audit query routes exist in the unified OpenAPI document', async () => {
  const document = await SwaggerParser.validate(OPENAPI_PATH);
  const tenantRoute = document.paths['/v1/metrics/tenants/{tenantId}/audit-records'].get;
  const workspaceRoute = document.paths['/v1/metrics/workspaces/{workspaceId}/audit-records'].get;

  assert.ok(tenantRoute);
  assert.ok(workspaceRoute);
  assert.equal(tenantRoute['x-family'], 'metrics');
  assert.equal(tenantRoute['x-resource-type'], 'tenant_audit_record');
  assert.equal(workspaceRoute['x-resource-type'], 'workspace_audit_record');
  assert.ok(document.components.schemas.AuditRecordCollectionResponse);
  assert.ok(document.components.schemas.AuditRecord);
});

test('C-09 tenant and workspace OpenAPI audit queries match the canonical internal surface', async () => {
  const document = await SwaggerParser.validate(OPENAPI_PATH);
  const contract = readObservabilityAuditQuerySurface();
  const operations = [
    document.paths['/v1/metrics/tenants/{tenantId}/audit-records'].get,
    document.paths['/v1/metrics/workspaces/{workspaceId}/audit-records'].get
  ];
  const expectedFilterParams = contract.filter_dimensions.map(({ param }) => param);

  for (const operation of operations) {
    const queryParameters = operation.parameters.filter(({ in: location }) => location === 'query');
    const byName = new Map(queryParameters.map((parameter) => [parameter.name, parameter]));
    assert.deepEqual(queryParameters.filter(({ name }) => name.startsWith('filter[')).map(({ name }) => name), expectedFilterParams);
    assert.deepEqual(byName.get('page[size]').schema, { type: 'integer', minimum: 1, maximum: 200, default: 25 });
    assert.deepEqual(byName.get('sort').schema.enum, contract.pagination.allowed_sort_values);
    assert.equal(byName.get('sort').schema.default, contract.pagination.default_sort);
    assert.equal(byName.get('page[after]').schema.minLength, 1);
    assert.match(byName.get('page[after]').description, /not authorization/i);
    for (const filter of contract.filter_dimensions) {
      const parameter = byName.get(filter.param);
      assert.ok(parameter, `missing ${filter.param}`);
      if (filter.type === 'date-time') assert.equal(parameter.schema.format, 'date-time');
      if (filter.allowed_values) assert.deepEqual(parameter.schema.enum, filter.allowed_values);
      if (filter.min_length) assert.equal(parameter.schema.minLength, filter.min_length);
    }
    assert.ok(operation.responses['400']);
  }

  const page = document.components.schemas.AuditRecordCollectionResponse.properties.page;
  assert.deepEqual(page.required, ['size', 'hasMore']);
  assert.deepEqual(page.properties.size, { type: 'integer', minimum: 0, maximum: 200 });
  assert.equal(page.properties.nextCursor.minLength, 1);
});

test('route catalog, authorization model, and console explorer stay aligned for audit queries', () => {
  const tenantRoute = getPublicRoute('listTenantAuditRecords');
  const workspaceRoute = getPublicRoute('listWorkspaceAuditRecords');
  const authorizationModel = readAuthorizationModel();
  const workspaceActions = new Set(authorizationModel.resource_actions.workspace ?? []);
  const explorer = buildAuditExplorerView({ scopeId: 'workspace', currentCorrelationId: 'corr_01' });
  const routeIds = new Set(listAuditQueryRoutes().map((route) => route.operationId));

  assert.equal(tenantRoute.tenantBinding, 'required');
  assert.equal(workspaceRoute.workspaceBinding, 'required');
  assert.equal(workspaceActions.has('workspace.audit.read'), true);
  assert.equal(routeIds.has('listTenantAuditRecords'), true);
  assert.equal(routeIds.has('listWorkspaceAuditRecords'), true);
  assert.equal(explorer.presets.some((preset) => preset.id === 'current_correlation_id'), true);
  assert.equal(explorer.availableFilters.length, listAuditQueryFilters().length);
});

test('architecture README and task summary document the audit query surface baseline', { skip: !existsSync('docs/reference/architecture/README.md') || !existsSync('docs/tasks/us-obs-02.md') }, () => {
  const architectureIndex = readFileSync('docs/reference/architecture/README.md', 'utf8');
  const taskSummary = readFileSync('docs/tasks/us-obs-02.md', 'utf8');

  assert.equal(architectureIndex.includes('observability-audit-query-surface.md'), true);
  assert.equal(architectureIndex.includes('US-OBS-02-T03'), true);
  assert.equal(taskSummary.includes('US-OBS-02-T03'), true);
  assert.equal(taskSummary.includes('validate:observability-audit-query-surface'), true);
});
