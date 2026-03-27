import test from 'node:test';
import assert from 'node:assert/strict';

import SwaggerParser from '@apidevtools/swagger-parser';
import { getContextPropagationTarget, getPublicRoute } from '../../services/internal-contracts/src/index.mjs';
import { OPENAPI_PATH } from '../../scripts/lib/quality-gates.mjs';
import { summarizeFunctionsAdminSurface } from '../../apps/control-plane/src/functions-admin.mjs';
import { readDomainModel } from '../../scripts/lib/domain-model.mjs';
import { queryAuditRecords } from '../../apps/control-plane/src/functions-audit.mjs';

test('functions audit OpenAPI contract exposes additive audit query surfaces and schemas', async () => {
  const document = await SwaggerParser.validate(OPENAPI_PATH);
  const audit = document.paths['/v1/functions/workspaces/{workspaceId}/audit'].get;
  const rollback = document.paths['/v1/functions/workspaces/{workspaceId}/audit/rollback-evidence'].get;
  const quota = document.paths['/v1/functions/workspaces/{workspaceId}/audit/quota-enforcement'].get;
  const coverage = document.paths['/v1/admin/functions/audit/coverage'].get;

  assert.ok(audit);
  assert.ok(rollback);
  assert.ok(quota);
  assert.ok(coverage);
  assert.equal(audit['x-resource-type'], 'function_audit');
  assert.equal(coverage['x-resource-type'], 'function_audit_coverage');
  assert.ok(document.components.schemas.DeploymentAuditEntry);
  assert.ok(document.components.schemas.RollbackEvidenceRecord);
  assert.equal(document.components.schemas.QuotaEnforcementRecord.allOf[1].properties.decision.enum.includes('denied'), true);
});

test('functions audit contracts preserve route bindings, authorization propagation, domain entities, and admin surface discoverability', () => {
  const auditRoute = getPublicRoute('listFunctionDeploymentAudit');
  const rollbackRoute = getPublicRoute('listFunctionRollbackEvidence');
  const quotaRoute = getPublicRoute('listFunctionQuotaEnforcement');
  const coverageRoute = getPublicRoute('getFunctionAuditCoverage');
  const auditProjection = getContextPropagationTarget('audit_query_context');
  const surface = summarizeFunctionsAdminSurface();
  const domain = readDomainModel();
  const entityIds = new Set(domain.entities.map((entity) => entity.id));
  const invariantIds = new Set((domain.business_invariants ?? []).map((entry) => entry.id));

  assert.equal(auditRoute.tenantBinding, 'required');
  assert.equal(rollbackRoute.workspaceBinding, 'required');
  assert.equal(quotaRoute.workspaceBinding, 'required');
  assert.equal(coverageRoute.tenantBinding, 'none');
  assert.equal(coverageRoute.workspaceBinding, 'none');
  assert.equal(auditProjection.required_fields.includes('query_scope'), true);
  assert.equal(surface.some((entry) => entry.resourceKind === 'function_deployment_audit'), true);
  assert.equal(surface.some((entry) => entry.resourceKind === 'function_rollback_evidence'), true);
  assert.equal(surface.some((entry) => entry.resourceKind === 'function_quota_enforcement_audit'), true);
  for (const entityId of ['function_audit_record', 'function_deployment_audit_entry', 'function_admin_action_audit_entry', 'function_rollback_evidence_record', 'function_quota_enforcement_record']) {
    assert.equal(entityIds.has(entityId), true);
  }
  for (const invariantId of ['BI-FN-AUD-001', 'BI-FN-AUD-002', 'BI-FN-AUD-003']) {
    assert.equal(invariantIds.has(invariantId), true);
  }
});

test('functions audit scope violations return a gateway-compatible coded error', () => {
  try {
    queryAuditRecords({ tenantId: 'ten_01a', workspaceId: 'wrk_01a' }, { tenantId: 'ten_01b' });
    assert.fail('expected scope violation');
  } catch (error) {
    const response = {
      code: `GW_${error.code}`,
      message: error.message
    };
    assert.match(response.code, /^GW_/);
    assert.equal(response.code, 'GW_AUDIT_SCOPE_VIOLATION');
  }
});
