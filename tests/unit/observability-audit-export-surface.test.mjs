import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectAuditExportSurfaceViolations,
  readAuthorizationModel,
  readObservabilityAuditEventSchema,
  readObservabilityAuditExportSurface,
  readObservabilityAuditPipeline,
  readObservabilityAuditQuerySurface,
  readPublicApiTaxonomy,
  readPublicRouteCatalog
} from '../../scripts/lib/observability-audit-export-surface.mjs';
import {
  applyAuditExportMasking,
  AUDIT_EXPORT_ERROR_CODES,
  exportWorkspaceAuditRecordsPreview,
  normalizeAuditExportRequest
} from '../../apps/control-plane/src/observability-audit-export.mjs';

test('observability audit export surface contract remains internally consistent', () => {
  const violations = collectAuditExportSurfaceViolations();
  assert.deepEqual(violations, []);
});

test('collectAuditExportSurfaceViolations reports a missing required route id', () => {
  const routeCatalog = structuredClone(readPublicRouteCatalog());
  routeCatalog.routes = routeCatalog.routes.filter((route) => route.operationId !== 'exportWorkspaceAuditRecords');

  const violations = collectAuditExportSurfaceViolations(readObservabilityAuditExportSurface(), {
    auditPipeline: readObservabilityAuditPipeline(),
    auditEventSchema: readObservabilityAuditEventSchema(),
    auditQuerySurface: readObservabilityAuditQuerySurface(),
    authorizationModel: readAuthorizationModel(),
    routeCatalog,
    publicApiTaxonomy: readPublicApiTaxonomy()
  });

  assert.equal(
    violations.includes('Observability audit export surface requires public route catalog operation exportWorkspaceAuditRecords.'),
    true
  );
});

test('collectAuditExportSurfaceViolations reports missing protected field coverage', () => {
  const contract = structuredClone(readObservabilityAuditExportSurface());
  contract.sensitive_field_rules = contract.sensitive_field_rules.filter((rule) => rule.id !== 'provider_locator');

  const violations = collectAuditExportSurfaceViolations(contract, {
    auditPipeline: readObservabilityAuditPipeline(),
    auditEventSchema: readObservabilityAuditEventSchema(),
    auditQuerySurface: readObservabilityAuditQuerySurface(),
    authorizationModel: readAuthorizationModel(),
    routeCatalog: readPublicRouteCatalog(),
    publicApiTaxonomy: readPublicApiTaxonomy()
  });

  assert.equal(
    violations.includes('Observability audit export surface must cover protected field raw_hostname from the audit pipeline masking policy.'),
    true
  );
});

test('normalizeAuditExportRequest rejects unsupported formats', () => {
  assert.throws(
    () => normalizeAuditExportRequest('tenant', { tenantId: 'ten_01a', correlationId: 'corr_01' }, { format: 'zip' }),
    (error) => error.code === AUDIT_EXPORT_ERROR_CODES.INVALID_FORMAT
  );
});

test('normalizeAuditExportRequest rejects oversized page sizes', () => {
  assert.throws(
    () => normalizeAuditExportRequest('tenant', { tenantId: 'ten_01a', correlationId: 'corr_01' }, { format: 'jsonl', pageSize: 10001 }),
    (error) => error.code === AUDIT_EXPORT_ERROR_CODES.LIMIT_EXCEEDED
  );
});

test('normalizeAuditExportRequest rejects invalid time windows', () => {
  assert.throws(
    () => normalizeAuditExportRequest('tenant', { tenantId: 'ten_01a', correlationId: 'corr_01' }, {
      format: 'jsonl',
      filters: {
        occurredAfter: '2026-04-30T00:00:00Z',
        occurredBefore: '2026-03-28T00:00:00Z'
      }
    }),
    (error) => error.code === AUDIT_EXPORT_ERROR_CODES.INVALID_TIME_WINDOW
  );
});

test('normalizeAuditExportRequest rejects unknown masking profiles', () => {
  assert.throws(
    () => normalizeAuditExportRequest('tenant', { tenantId: 'ten_01a', correlationId: 'corr_01' }, { format: 'jsonl', maskingProfileId: 'raw' }),
    (error) => error.code === AUDIT_EXPORT_ERROR_CODES.UNKNOWN_MASKING_PROFILE
  );
});

test('exportWorkspaceAuditRecordsPreview rejects workspace scope mismatches with a coded error', () => {
  assert.throws(
    () => exportWorkspaceAuditRecordsPreview({ tenantId: 'ten_01a', workspaceId: 'wrk_01a', correlationId: 'corr_01' }, { format: 'jsonl', workspaceId: 'wrk_01b' }),
    (error) => error.code === AUDIT_EXPORT_ERROR_CODES.SCOPE_VIOLATION
  );
});

test('applyAuditExportMasking masks protected detail fields and keeps safe fields', () => {
  const masked = applyAuditExportMasking({
    eventId: 'evt_01',
    eventTimestamp: '2026-03-28T00:00:00Z',
    actor: { actorId: 'usr_01' },
    scope: { tenantId: 'ten_01a' },
    resource: { subsystemId: 'storage' },
    action: { actionId: 'bucket.export' },
    result: { outcome: 'succeeded' },
    correlationId: 'corr_01',
    origin: { originSurface: 'control_api' },
    detail: {
      password: 'super-secret',
      raw_endpoint: 'https://sensitive.example',
      safeValue: 'keep-me'
    }
  });

  assert.equal(masked.maskingApplied, true);
  assert.deepEqual(masked.maskedFieldRefs.sort(), ['detail.password', 'detail.raw_endpoint']);
  assert.deepEqual(masked.sensitivityCategories, ['credential_material', 'provider_locator']);
  assert.equal(masked.detail.password, '[MASKED]');
  assert.equal(masked.detail.raw_endpoint, '[MASKED]');
  assert.equal(masked.detail.safeValue, 'keep-me');
});
