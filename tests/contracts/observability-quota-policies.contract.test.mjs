import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import SwaggerParser from '@apidevtools/swagger-parser';

import {
  OBSERVABILITY_QUOTA_POLICIES_VERSION,
  getPublicRoute,
  getQuotaEvaluationAuditContract,
  getQuotaEvaluationDefaults,
  getQuotaPolicyScope,
  getQuotaPostureState,
  getQuotaThresholdType,
  listQuotaPolicyScopes,
  listQuotaPostureStates,
  listQuotaThresholdTypes,
  readAuthorizationModel,
  readObservabilityQuotaPolicies
} from '../../services/internal-contracts/src/index.mjs';
import { OPENAPI_PATH } from '../../scripts/lib/quality-gates.mjs';
import { listQuotaPolicyRoutes, summarizeObservabilityQuotaPolicies } from '../../apps/control-plane/src/observability-admin.mjs';

test('observability quota policies contract is exposed through shared readers', () => {
  const contract = readObservabilityQuotaPolicies();
  const tenantScope = getQuotaPolicyScope('tenant');
  const workspaceScope = getQuotaPolicyScope('workspace');
  const warningThreshold = getQuotaThresholdType('warning_threshold');
  const hardLimitState = getQuotaPostureState('hard_limit_reached');
  const defaults = getQuotaEvaluationDefaults();
  const auditContract = getQuotaEvaluationAuditContract();

  assert.equal(contract.version, '2026-03-28');
  assert.equal(OBSERVABILITY_QUOTA_POLICIES_VERSION, '2026-03-28');
  assert.equal(listQuotaPolicyScopes().length, 2);
  assert.equal(listQuotaThresholdTypes().length, 3);
  assert.equal(listQuotaPostureStates().length >= 7, true);
  assert.equal(tenantScope.route_operation_id, 'getTenantQuotaPosture');
  assert.equal(workspaceScope.required_permission, 'workspace.quota.read');
  assert.equal(warningThreshold.comparison_rule, 'greater_than_or_equal');
  assert.equal(hardLimitState.blocks_new_resource_creation, true);
  assert.equal(defaults.hard_limit_status, 'hard_limit_reached');
  assert.equal(auditContract.subsystem_id, 'quota_metering');
});

test('observability quota routes and schemas exist in the unified OpenAPI document', async () => {
  const document = await SwaggerParser.validate(OPENAPI_PATH);
  const tenantRoute = document.paths['/v1/metrics/tenants/{tenantId}/quotas'].get;
  const workspaceRoute = document.paths['/v1/metrics/workspaces/{workspaceId}/quotas'].get;

  assert.ok(tenantRoute);
  assert.ok(workspaceRoute);
  assert.equal(tenantRoute['x-family'], 'metrics');
  assert.equal(tenantRoute['x-resource-type'], 'tenant_quota_posture');
  assert.equal(workspaceRoute['x-resource-type'], 'workspace_quota_posture');
  assert.ok(document.components.schemas.QuotaThresholdPolicy);
  assert.ok(document.components.schemas.QuotaDimensionPosture);
  assert.ok(document.components.schemas.QuotaEvaluationAudit);
  assert.ok(document.components.schemas.QuotaPosture);
});

test('route catalog, authorization model, and helper route list stay aligned for quota policies', () => {
  const tenantRoute = getPublicRoute('getTenantQuotaPosture');
  const workspaceRoute = getPublicRoute('getWorkspaceQuotaPosture');
  const authorizationModel = readAuthorizationModel();
  const tenantActions = new Set(authorizationModel.resource_actions.tenant ?? []);
  const workspaceActions = new Set(authorizationModel.resource_actions.workspace ?? []);
  const routeIds = new Set(listQuotaPolicyRoutes().map((route) => route.operationId));
  const summary = summarizeObservabilityQuotaPolicies();

  assert.equal(tenantRoute.path, '/v1/metrics/tenants/{tenantId}/quotas');
  assert.equal(tenantRoute.resourceType, 'tenant_quota_posture');
  assert.equal(workspaceRoute.path, '/v1/metrics/workspaces/{workspaceId}/quotas');
  assert.equal(workspaceRoute.resourceType, 'workspace_quota_posture');
  assert.equal(tenantActions.has('tenant.quota.read'), true);
  assert.equal(workspaceActions.has('workspace.quota.read'), true);
  assert.equal(routeIds.has('getTenantQuotaPosture'), true);
  assert.equal(routeIds.has('getWorkspaceQuotaPosture'), true);
  assert.equal(summary.scopes.some((scope) => scope.requiredPermission === 'workspace.quota.read'), true);
});

test('architecture README and task summary document the quota-policy baseline', () => {
  const architectureIndex = readFileSync('docs/reference/architecture/README.md', 'utf8');
  const taskSummary = readFileSync('docs/tasks/us-obs-03.md', 'utf8');

  assert.equal(architectureIndex.includes('observability-quota-policies.json'), true);
  assert.equal(architectureIndex.includes('observability-quota-policies.md'), true);
  assert.equal(taskSummary.includes('US-OBS-03-T02'), true);
  assert.equal(taskSummary.includes('validate:observability-quota-policies'), true);
});
