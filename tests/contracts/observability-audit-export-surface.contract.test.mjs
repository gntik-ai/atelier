import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import SwaggerParser from '@apidevtools/swagger-parser';

import {
  OBSERVABILITY_AUDIT_EXPORT_SURFACE_VERSION,
  getAuditExportConsoleSurface,
  getAuditExportFormat,
  getAuditExportMaskingProfile,
  getAuditExportScope,
  getAuditExportSensitiveFieldRules,
  getPublicRoute,
  readAuthorizationModel,
  readObservabilityAuditExportSurface
} from '../../services/internal-contracts/src/index.mjs';
import { OPENAPI_PATH } from '../../scripts/lib/quality-gates.mjs';
import { buildAuditExportConsoleView, listAuditExportRoutes } from '../../apps/control-plane/src/observability-audit-export.mjs';

test('observability audit export surface contract is exposed through shared readers', () => {
  const contract = readObservabilityAuditExportSurface();
  const tenantScope = getAuditExportScope('tenant');
  const workspaceScope = getAuditExportScope('workspace');
  const jsonlFormat = getAuditExportFormat('jsonl');
  const defaultProfile = getAuditExportMaskingProfile('default_masked');
  const sensitiveRules = getAuditExportSensitiveFieldRules();
  const consoleSurface = getAuditExportConsoleSurface();

  assert.equal(contract.version, '2026-03-28');
  assert.equal(OBSERVABILITY_AUDIT_EXPORT_SURFACE_VERSION, '2026-03-28');
  assert.equal(tenantScope.route_operation_id, 'exportTenantAuditRecords');
  assert.equal(workspaceScope.required_permission, 'workspace.audit.export');
  assert.equal(jsonlFormat.media_type, 'application/x-ndjson');
  assert.equal(defaultProfile.is_default, true);
  assert.equal(sensitiveRules.some((rule) => rule.id === 'provider_locator'), true);
  assert.equal(consoleSurface.entry_scopes.includes('workspace'), true);
});

test('observability audit export routes exist in the unified OpenAPI document', async () => {
  const document = await SwaggerParser.validate(OPENAPI_PATH);
  const tenantRoute = document.paths['/v1/metrics/tenants/{tenantId}/audit-exports'].post;
  const workspaceRoute = document.paths['/v1/metrics/workspaces/{workspaceId}/audit-exports'].post;

  assert.ok(tenantRoute);
  assert.ok(workspaceRoute);
  assert.equal(tenantRoute['x-family'], 'metrics');
  assert.equal(tenantRoute['x-resource-type'], 'tenant_audit_export');
  assert.equal(workspaceRoute['x-resource-type'], 'workspace_audit_export');
  assert.ok(document.components.schemas.AuditExportRequest);
  assert.ok(document.components.schemas.AuditExportManifest);
  assert.ok(document.components.schemas.AuditExportedRecord);
});

test('route catalog, authorization model, and console export view stay aligned for audit exports', () => {
  const tenantRoute = getPublicRoute('exportTenantAuditRecords');
  const workspaceRoute = getPublicRoute('exportWorkspaceAuditRecords');
  const authorizationModel = readAuthorizationModel();
  const tenantActions = new Set(authorizationModel.resource_actions.tenant ?? []);
  const workspaceActions = new Set(authorizationModel.resource_actions.workspace ?? []);
  const exportView = buildAuditExportConsoleView({ scopeId: 'workspace' });
  const routeIds = new Set(listAuditExportRoutes().map((route) => route.operationId));

  assert.equal(tenantRoute.tenantBinding, 'required');
  assert.equal(workspaceRoute.workspaceBinding, 'required');
  assert.equal(tenantActions.has('tenant.audit.export'), true);
  assert.equal(workspaceActions.has('workspace.audit.export'), true);
  assert.equal(routeIds.has('exportTenantAuditRecords'), true);
  assert.equal(routeIds.has('exportWorkspaceAuditRecords'), true);
  assert.equal(exportView.maskingProfiles.some((profile) => profile.id === 'default_masked'), true);
  assert.equal(exportView.formats.some((format) => format.id === 'csv'), true);
});

test('architecture README and task summary document the audit export surface baseline', () => {
  const architectureIndex = readFileSync('docs/reference/architecture/README.md', 'utf8');
  const taskSummary = readFileSync('docs/tasks/us-obs-02.md', 'utf8');

  assert.equal(architectureIndex.includes('observability-audit-export-surface.md'), true);
  assert.equal(architectureIndex.includes('US-OBS-02-T04'), true);
  assert.equal(taskSummary.includes('US-OBS-02-T04'), true);
  assert.equal(taskSummary.includes('validate:observability-audit-export-surface'), true);
});
