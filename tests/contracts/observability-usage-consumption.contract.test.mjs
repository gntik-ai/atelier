import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import SwaggerParser from '@apidevtools/swagger-parser';

import {
  OBSERVABILITY_USAGE_CONSUMPTION_VERSION,
  getPublicRoute,
  getUsageCalculationAuditContract,
  getUsageConsumptionScope,
  getUsageFreshnessState,
  getUsageMeteredDimension,
  getUsageRefreshPolicy,
  listUsageConsumptionScopes,
  listUsageFreshnessStates,
  listUsageMeteredDimensions,
  readAuthorizationModel,
  readObservabilityUsageConsumption
} from '../../services/internal-contracts/src/index.mjs';
import { OPENAPI_PATH } from '../../scripts/lib/quality-gates.mjs';
import { listUsageConsumptionRoutes, summarizeObservabilityUsageConsumption } from '../../apps/control-plane/src/observability-admin.mjs';

test('observability usage consumption contract is exposed through shared readers', () => {
  const contract = readObservabilityUsageConsumption();
  const tenantScope = getUsageConsumptionScope('tenant');
  const workspaceScope = getUsageConsumptionScope('workspace');
  const apiRequests = getUsageMeteredDimension('api_requests');
  const degraded = getUsageFreshnessState('degraded');
  const refreshPolicy = getUsageRefreshPolicy();
  const auditContract = getUsageCalculationAuditContract();

  assert.equal(contract.version, '2026-03-28');
  assert.equal(OBSERVABILITY_USAGE_CONSUMPTION_VERSION, '2026-03-28');
  assert.equal(listUsageConsumptionScopes().length, 2);
  assert.equal(listUsageFreshnessStates().length, 3);
  assert.equal(listUsageMeteredDimensions().length, 9);
  assert.equal(tenantScope.route_operation_id, 'getTenantUsageSnapshot');
  assert.equal(workspaceScope.required_permission, 'workspace.usage.read');
  assert.equal(apiRequests.source_ref, 'api_requests_total');
  assert.equal(degraded.label, 'Degraded');
  assert.equal(refreshPolicy.default_cadence_seconds, 300);
  assert.equal(auditContract.subsystem_id, 'quota_metering');
});

test('observability usage routes and schemas exist in the unified OpenAPI document', async () => {
  const document = await SwaggerParser.validate(OPENAPI_PATH);
  const tenantRoute = document.paths['/v1/metrics/tenants/{tenantId}/usage'].get;
  const workspaceRoute = document.paths['/v1/metrics/workspaces/{workspaceId}/usage'].get;

  assert.ok(tenantRoute);
  assert.ok(workspaceRoute);
  assert.equal(tenantRoute['x-family'], 'metrics');
  assert.equal(tenantRoute['x-resource-type'], 'tenant_usage_snapshot');
  assert.equal(workspaceRoute['x-resource-type'], 'workspace_usage_snapshot');
  assert.ok(document.components.schemas.UsageDimensionSnapshot);
  assert.ok(document.components.schemas.UsageObservationWindow);
  assert.ok(document.components.schemas.UsageCalculationCycleAudit);
  assert.ok(document.components.schemas.UsageSnapshot);
});

test('route catalog, authorization model, and helper route list stay aligned for usage consumption', () => {
  const tenantRoute = getPublicRoute('getTenantUsageSnapshot');
  const workspaceRoute = getPublicRoute('getWorkspaceUsageSnapshot');
  const authorizationModel = readAuthorizationModel();
  const tenantActions = new Set(authorizationModel.resource_actions.tenant ?? []);
  const workspaceActions = new Set(authorizationModel.resource_actions.workspace ?? []);
  const routeIds = new Set(listUsageConsumptionRoutes().map((route) => route.operationId));
  const summary = summarizeObservabilityUsageConsumption();

  assert.equal(tenantRoute.path, '/v1/metrics/tenants/{tenantId}/usage');
  assert.equal(tenantRoute.resourceType, 'tenant_usage_snapshot');
  assert.equal(workspaceRoute.path, '/v1/metrics/workspaces/{workspaceId}/usage');
  assert.equal(workspaceRoute.resourceType, 'workspace_usage_snapshot');
  assert.equal(tenantActions.has('tenant.usage.read'), true);
  assert.equal(workspaceActions.has('workspace.usage.read'), true);
  assert.equal(routeIds.has('getTenantUsageSnapshot'), true);
  assert.equal(routeIds.has('getWorkspaceUsageSnapshot'), true);
  assert.equal(summary.scopes.some((scope) => scope.requiredPermission === 'workspace.usage.read'), true);
});

test('architecture README and task summary document the usage-consumption baseline', () => {
  const architectureIndex = readFileSync('docs/reference/architecture/README.md', 'utf8');
  const taskSummary = readFileSync('docs/tasks/us-obs-03.md', 'utf8');

  assert.equal(architectureIndex.includes('observability-usage-consumption.json'), true);
  assert.equal(architectureIndex.includes('observability-usage-consumption.md'), true);
  assert.equal(taskSummary.includes('US-OBS-03-T01'), true);
  assert.equal(taskSummary.includes('validate:observability-usage-consumption'), true);
});
