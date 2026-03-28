import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
} from '../../services/internal-contracts/src/index.mjs';
import { OPENAPI_PATH } from '../../scripts/lib/quality-gates.mjs';
import { buildAuditExplorerView, listAuditQueryRoutes } from '../../apps/control-plane/src/observability-audit-query.mjs';

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

test('architecture README and task summary document the audit query surface baseline', () => {
  const architectureIndex = readFileSync('docs/reference/architecture/README.md', 'utf8');
  const taskSummary = readFileSync('docs/tasks/us-obs-02.md', 'utf8');

  assert.equal(architectureIndex.includes('observability-audit-query-surface.md'), true);
  assert.equal(architectureIndex.includes('US-OBS-02-T03'), true);
  assert.equal(taskSummary.includes('US-OBS-02-T03'), true);
  assert.equal(taskSummary.includes('validate:observability-audit-query-surface'), true);
});
