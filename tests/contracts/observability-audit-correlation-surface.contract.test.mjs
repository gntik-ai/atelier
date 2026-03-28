import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import SwaggerParser from '@apidevtools/swagger-parser';

import {
  OBSERVABILITY_AUDIT_CORRELATION_SURFACE_VERSION,
  getAuditCorrelationConsoleSurface,
  getAuditCorrelationMaskingCompatibility,
  getAuditCorrelationScope,
  getAuditCorrelationStatus,
  getAuditCorrelationTimelinePhase,
  getPublicRoute,
  readAuthorizationModel,
  readObservabilityAuditCorrelationSurface
} from '../../services/internal-contracts/src/index.mjs';
import { OPENAPI_PATH } from '../../scripts/lib/quality-gates.mjs';
import { buildAuditCorrelationConsoleView, listAuditCorrelationRoutes } from '../../apps/control-plane/src/observability-audit-correlation.mjs';

test('observability audit correlation surface contract is exposed through shared readers', () => {
  const contract = readObservabilityAuditCorrelationSurface();
  const tenantScope = getAuditCorrelationScope('tenant');
  const workspaceScope = getAuditCorrelationScope('workspace');
  const partialStatus = getAuditCorrelationStatus('partial');
  const downstreamPhase = getAuditCorrelationTimelinePhase('downstream_system_effect');
  const maskingCompatibility = getAuditCorrelationMaskingCompatibility();
  const consoleSurface = getAuditCorrelationConsoleSurface();

  assert.equal(contract.version, '2026-03-28');
  assert.equal(OBSERVABILITY_AUDIT_CORRELATION_SURFACE_VERSION, '2026-03-28');
  assert.equal(tenantScope.route_operation_id, 'getTenantAuditCorrelation');
  assert.equal(workspaceScope.required_permission, 'workspace.audit.correlate');
  assert.equal(partialStatus.label, 'Partial trace');
  assert.equal(downstreamPhase.label, 'Downstream system effect');
  assert.equal(maskingCompatibility.source_profile_id, 'default_masked');
  assert.equal(consoleSurface.entry_scopes.includes('workspace'), true);
});

test('observability audit correlation routes exist in the unified OpenAPI document', async () => {
  const document = await SwaggerParser.validate(OPENAPI_PATH);
  const tenantRoute = document.paths['/v1/metrics/tenants/{tenantId}/audit-correlations/{correlationId}'].get;
  const workspaceRoute = document.paths['/v1/metrics/workspaces/{workspaceId}/audit-correlations/{correlationId}'].get;

  assert.ok(tenantRoute);
  assert.ok(workspaceRoute);
  assert.equal(tenantRoute['x-family'], 'metrics');
  assert.equal(tenantRoute['x-resource-type'], 'tenant_audit_correlation');
  assert.equal(workspaceRoute['x-resource-type'], 'workspace_audit_correlation');
  assert.ok(document.components.schemas.AuditCorrelationTrace);
  assert.ok(document.components.schemas.AuditCorrelationTimelineEntry);
  assert.ok(document.components.schemas.AuditCorrelationEvidencePointer);
});

test('route catalog, authorization model, and console correlation view stay aligned for audit correlation', () => {
  const tenantRoute = getPublicRoute('getTenantAuditCorrelation');
  const workspaceRoute = getPublicRoute('getWorkspaceAuditCorrelation');
  const authorizationModel = readAuthorizationModel();
  const tenantActions = new Set(authorizationModel.resource_actions.tenant ?? []);
  const workspaceActions = new Set(authorizationModel.resource_actions.workspace ?? []);
  const correlationView = buildAuditCorrelationConsoleView({ scopeId: 'workspace' });
  const routeIds = new Set(listAuditCorrelationRoutes().map((route) => route.operationId));

  assert.equal(tenantRoute.tenantBinding, 'required');
  assert.equal(workspaceRoute.workspaceBinding, 'required');
  assert.equal(tenantActions.has('tenant.audit.correlate'), true);
  assert.equal(workspaceActions.has('workspace.audit.correlate'), true);
  assert.equal(routeIds.has('getTenantAuditCorrelation'), true);
  assert.equal(routeIds.has('getWorkspaceAuditCorrelation'), true);
  assert.equal(correlationView.statusBadges.some((badge) => badge.id === 'broken'), true);
  assert.equal(correlationView.phases.some((phase) => phase.id === 'console_initiation'), true);
});

test('architecture README and task summary document the audit correlation surface baseline', () => {
  const architectureIndex = readFileSync('docs/reference/architecture/README.md', 'utf8');
  const taskSummary = readFileSync('docs/tasks/us-obs-02.md', 'utf8');

  assert.equal(architectureIndex.includes('observability-audit-correlation-surface.md'), true);
  assert.equal(architectureIndex.includes('US-OBS-02-T05'), true);
  assert.equal(taskSummary.includes('US-OBS-02-T05'), true);
  assert.equal(taskSummary.includes('validate:observability-audit-correlation-surface'), true);
});
