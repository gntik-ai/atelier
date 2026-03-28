import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectAuditCorrelationSurfaceViolations,
  readAuthorizationModel,
  readInternalServiceMap,
  readObservabilityAuditCorrelationSurface,
  readObservabilityAuditEventSchema,
  readObservabilityAuditExportSurface,
  readObservabilityAuditQuerySurface,
  readPublicApiTaxonomy,
  readPublicRouteCatalog
} from '../../scripts/lib/observability-audit-correlation-surface.mjs';
import {
  AUDIT_CORRELATION_ERROR_CODES,
  buildAuditCorrelationConsoleView,
  normalizeAuditCorrelationRequest,
  traceWorkspaceAuditCorrelation
} from '../../apps/control-plane/src/observability-audit-correlation.mjs';

test('observability audit correlation surface contract remains internally consistent', () => {
  const violations = collectAuditCorrelationSurfaceViolations();
  assert.deepEqual(violations, []);
});

test('collectAuditCorrelationSurfaceViolations reports a missing required route id', () => {
  const routeCatalog = structuredClone(readPublicRouteCatalog());
  routeCatalog.routes = routeCatalog.routes.filter((route) => route.operationId !== 'getWorkspaceAuditCorrelation');

  const violations = collectAuditCorrelationSurfaceViolations(readObservabilityAuditCorrelationSurface(), {
    auditEventSchema: readObservabilityAuditEventSchema(),
    auditQuerySurface: readObservabilityAuditQuerySurface(),
    auditExportSurface: readObservabilityAuditExportSurface(),
    authorizationModel: readAuthorizationModel(),
    internalServiceMap: readInternalServiceMap(),
    routeCatalog,
    publicApiTaxonomy: readPublicApiTaxonomy()
  });

  assert.equal(
    violations.includes('Observability audit correlation surface requires public route catalog operation getWorkspaceAuditCorrelation.'),
    true
  );
});

test('collectAuditCorrelationSurfaceViolations reports missing internal contract linkage fields', () => {
  const internalServiceMap = structuredClone(readInternalServiceMap());
  delete internalServiceMap.contracts.mongo_admin_result.required_fields;

  const violations = collectAuditCorrelationSurfaceViolations(readObservabilityAuditCorrelationSurface(), {
    auditEventSchema: readObservabilityAuditEventSchema(),
    auditQuerySurface: readObservabilityAuditQuerySurface(),
    auditExportSurface: readObservabilityAuditExportSurface(),
    authorizationModel: readAuthorizationModel(),
    internalServiceMap,
    routeCatalog: readPublicRouteCatalog(),
    publicApiTaxonomy: readPublicApiTaxonomy()
  });

  assert.equal(
    violations.includes('Observability audit correlation source mongo_admin_result requires internal contract field correlation_id.'),
    true
  );
});

test('normalizeAuditCorrelationRequest rejects missing target correlation ids', () => {
  assert.throws(
    () => normalizeAuditCorrelationRequest('tenant', { tenantId: 'ten_01a' }, {}),
    (error) => error.code === AUDIT_CORRELATION_ERROR_CODES.MISSING_CORRELATION_ID
  );
});

test('normalizeAuditCorrelationRequest rejects oversized maxItems values', () => {
  assert.throws(
    () => normalizeAuditCorrelationRequest('tenant', { tenantId: 'ten_01a', targetCorrelationId: 'corr_target' }, { maxItems: 201 }),
    (error) => error.code === AUDIT_CORRELATION_ERROR_CODES.LIMIT_EXCEEDED
  );
});

test('traceWorkspaceAuditCorrelation rejects workspace scope mismatches with a coded error', () => {
  assert.throws(
    () => traceWorkspaceAuditCorrelation({ tenantId: 'ten_01a', workspaceId: 'wrk_01a', targetCorrelationId: 'corr_target' }, { workspaceId: 'wrk_01b' }),
    (error) => error.code === AUDIT_CORRELATION_ERROR_CODES.SCOPE_VIOLATION
  );
});

test('traceWorkspaceAuditCorrelation derives complete traces and masks protected fields', () => {
  const trace = traceWorkspaceAuditCorrelation(
    { tenantId: 'ten_01a', workspaceId: 'wrk_01a', targetCorrelationId: 'corr_target' },
    {
      auditRecords: [
        {
          eventId: 'evt_console',
          eventTimestamp: '2026-03-28T10:00:00Z',
          actor: { actorId: 'usr_01' },
          scope: { tenantId: 'ten_01a', workspaceId: 'wrk_01a' },
          resource: { subsystemId: 'tenant_control_plane', resourceType: 'workspace' },
          action: { actionId: 'workspace.update' },
          result: { outcome: 'accepted' },
          correlationId: 'corr_target',
          origin: { originSurface: 'console_backend' },
          detail: {
            password: 'do-not-leak',
            safeValue: 'keep-me'
          }
        }
      ],
      downstreamEvents: [
        {
          id: 'chg_01',
          sourceContractId: 'mongo_admin_result',
          eventTimestamp: '2026-03-28T10:00:05Z',
          subsystemId: 'mongodb',
          actionId: 'cluster.apply',
          outcome: 'succeeded',
          auditRecordId: 'evt_console',
          safeRef: 'evidence://mongo/change/01'
        }
      ]
    }
  );

  assert.equal(trace.traceStatus, 'complete');
  assert.equal(trace.consoleSummary.initiatedFromConsole, true);
  assert.deepEqual(trace.subsystems, ['mongodb', 'tenant_control_plane']);
  assert.equal(trace.auditRecords[0].maskingApplied, true);
  assert.deepEqual(trace.auditRecords[0].maskedFieldRefs, ['detail.password']);
  assert.equal(trace.auditRecords[0].detail.password, '[MASKED]');
  assert.equal(trace.auditRecords[0].detail.safeValue, 'keep-me');
});

test('traceWorkspaceAuditCorrelation marks console-only traces as broken', () => {
  const trace = traceWorkspaceAuditCorrelation(
    { tenantId: 'ten_01a', workspaceId: 'wrk_01a', targetCorrelationId: 'corr_target' },
    {
      auditRecords: [
        {
          eventId: 'evt_console',
          eventTimestamp: '2026-03-28T10:00:00Z',
          actor: { actorId: 'usr_01' },
          scope: { tenantId: 'ten_01a', workspaceId: 'wrk_01a' },
          resource: { subsystemId: 'tenant_control_plane', resourceType: 'workspace' },
          action: { actionId: 'workspace.update' },
          result: { outcome: 'accepted' },
          correlationId: 'corr_target',
          origin: { originSurface: 'console_backend' },
          detail: {}
        }
      ]
    }
  );

  assert.equal(trace.traceStatus, 'broken');
  assert.deepEqual(trace.missingLinks, ['downstream_system_effect_missing']);
});

test('traceWorkspaceAuditCorrelation returns not_found when no scoped evidence exists', () => {
  const trace = traceWorkspaceAuditCorrelation(
    { tenantId: 'ten_01a', workspaceId: 'wrk_01a', targetCorrelationId: 'corr_target' },
    {}
  );

  assert.equal(trace.traceStatus, 'not_found');
  assert.deepEqual(trace.missingLinks, ['correlation_trace_not_found']);
});

test('buildAuditCorrelationConsoleView exposes statuses and phases for workspace consumers', () => {
  const view = buildAuditCorrelationConsoleView({ scopeId: 'workspace' });

  assert.equal(view.statuses.some((status) => status.id === 'complete'), true);
  assert.equal(view.phases.some((phase) => phase.id === 'downstream_system_effect'), true);
  assert.equal(view.showEvidencePointersByDefault, true);
});
