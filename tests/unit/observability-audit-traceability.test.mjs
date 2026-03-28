import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectMatrixAlignmentViolations,
  readAuditTraceabilityMatrix
} from '../../scripts/lib/audit-traceability.mjs';
import {
  AUDIT_CORRELATION_ERROR_CODES,
  traceWorkspaceAuditCorrelation
} from '../../apps/control-plane/src/observability-audit-correlation.mjs';
import { exportWorkspaceAuditRecordsPreview } from '../../apps/control-plane/src/observability-audit-export.mjs';
import { queryWorkspaceAuditRecords } from '../../apps/control-plane/src/observability-audit-query.mjs';

function buildAuditRecord(overrides = {}) {
  return {
    eventId: 'evt_audit_01',
    eventTimestamp: '2026-03-28T14:00:00Z',
    actor: {
      actorId: 'usr_admin_01',
      actorType: 'workspace_user'
    },
    scope: {
      tenantId: 'ten_01a',
      workspaceId: 'wrk_01a'
    },
    resource: {
      subsystemId: 'tenant_control_plane',
      resourceType: 'workspace'
    },
    action: {
      actionId: 'workspace.update',
      category: 'configuration_change'
    },
    result: {
      outcome: 'accepted'
    },
    correlationId: 'corr_target_01',
    origin: {
      originSurface: 'console_backend',
      emittingService: 'control_api'
    },
    detail: {
      password: 'super-secret',
      raw_endpoint: 'https://provider.internal.example/token',
      safeValue: 'keep-me'
    },
    ...overrides
  };
}

test('readAuditTraceabilityMatrix returns a versioned matrix with verification scenarios', () => {
  const matrix = readAuditTraceabilityMatrix();

  assert.equal(matrix.version, '2026-03-28');
  assert.equal(Array.isArray(matrix.verification_scenarios), true);
  assert.equal(matrix.verification_scenarios.length >= 6, true);
});

test('audit traceability matrix stays aligned with the published audit contracts', () => {
  const violations = collectMatrixAlignmentViolations();
  assert.deepEqual(violations, []);
});

test('collectMatrixAlignmentViolations reports unknown contract surfaces', () => {
  const matrix = structuredClone(readAuditTraceabilityMatrix());
  matrix.verification_scenarios[0].contract_surfaces.push('unknown_surface');

  const violations = collectMatrixAlignmentViolations(matrix);

  assert.equal(
    violations.includes('Audit traceability scenario TRACE-CHAIN-001 references unknown contract surface unknown_surface.'),
    true
  );
});

test('collectMatrixAlignmentViolations reports unknown RF references', () => {
  const matrix = structuredClone(readAuditTraceabilityMatrix());
  matrix.verification_scenarios[0].requirement_refs.push('RF-OBS-999');

  const violations = collectMatrixAlignmentViolations(matrix);

  assert.equal(
    violations.includes('Audit traceability scenario TRACE-CHAIN-001 references unknown requirement RF-OBS-999.'),
    true
  );
});

test('consultation, export, and correlation projections mask protected audit fields consistently', () => {
  const record = buildAuditRecord();
  const consultation = queryWorkspaceAuditRecords(
    {
      tenantId: 'ten_01a',
      workspaceId: 'wrk_01a',
      queryAuditRecords: () => ({
        items: [record],
        page: {
          size: 1,
          hasMore: false
        }
      })
    },
    {
      workspaceId: 'wrk_01a',
      correlationId: 'corr_target_01'
    }
  );
  const exportPreview = exportWorkspaceAuditRecordsPreview(
    {
      tenantId: 'ten_01a',
      workspaceId: 'wrk_01a'
    },
    {
      workspaceId: 'wrk_01a',
      correlationId: 'corr_target_01',
      records: [record]
    }
  );
  const correlation = traceWorkspaceAuditCorrelation(
    {
      tenantId: 'ten_01a',
      workspaceId: 'wrk_01a',
      targetCorrelationId: 'corr_target_01'
    },
    {
      auditRecords: [record],
      downstreamEvents: [
        {
          id: 'evt_downstream_01',
          sourceContractId: 'mongo_admin_result',
          eventTimestamp: '2026-03-28T14:00:05Z',
          subsystemId: 'mongodb',
          actionId: 'cluster.apply',
          outcome: 'succeeded',
          auditRecordId: 'evt_audit_01',
          safeRef: 'evidence://mongo/change/01'
        }
      ]
    }
  );

  const consultationRecord = consultation.items[0];
  const exportRecord = exportPreview.items[0];
  const correlatedRecord = correlation.auditRecords[0];

  for (const projected of [consultationRecord, exportRecord, correlatedRecord]) {
    assert.equal(projected.detail.password, '[MASKED]');
    assert.equal(projected.detail.raw_endpoint, '[MASKED]');
    assert.equal(projected.detail.safeValue, 'keep-me');
    assert.equal(projected.maskingApplied, true);
    assert.equal(projected.maskedFieldRefs.includes('detail.password'), true);
    assert.equal(projected.maskedFieldRefs.includes('detail.raw_endpoint'), true);
    assert.equal(projected.sensitivityCategories.includes('credential_material'), true);
    assert.equal(projected.sensitivityCategories.includes('provider_locator'), true);
  }
});

test('traceWorkspaceAuditCorrelation rejects workspace scope mismatches with a coded error', () => {
  assert.throws(
    () =>
      traceWorkspaceAuditCorrelation(
        {
          tenantId: 'ten_01a',
          workspaceId: 'wrk_01a',
          targetCorrelationId: 'corr_target_01'
        },
        {
          workspaceId: 'wrk_01b'
        }
      ),
    (error) => error.code === AUDIT_CORRELATION_ERROR_CODES.SCOPE_VIOLATION
  );
});

test('traceWorkspaceAuditCorrelation derives a bounded not_found state when no evidence exists', () => {
  const trace = traceWorkspaceAuditCorrelation(
    {
      tenantId: 'ten_01a',
      workspaceId: 'wrk_01a',
      targetCorrelationId: 'corr_missing_01'
    },
    {}
  );

  assert.equal(trace.traceStatus, 'not_found');
  assert.deepEqual(trace.auditRecords, []);
  assert.deepEqual(trace.evidencePointers, []);
  assert.deepEqual(trace.missingLinks, ['correlation_trace_not_found']);
});
