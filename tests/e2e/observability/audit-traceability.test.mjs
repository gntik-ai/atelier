import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectCoveredRequirementRefs,
  listScenariosByCategory,
  readAuditTraceabilityMatrix,
  REQUIRED_RF_OBS_REFS,
  REQUIRED_TRACEABILITY_CATEGORY_IDS
} from '../../../scripts/lib/audit-traceability.mjs';
import {
  readObservabilityAuditCorrelationSurface,
  readObservabilityAuditExportSurface,
  readObservabilityAuditPipeline,
  readObservabilityAuditQuerySurface
} from '../../../services/internal-contracts/src/index.mjs';
import {
  AUDIT_CORRELATION_ERROR_CODES,
  traceTenantAuditCorrelation,
  traceWorkspaceAuditCorrelation
} from '../../../apps/control-plane/src/observability-audit-correlation.mjs';
import {
  AUDIT_EXPORT_ERROR_CODES,
  exportTenantAuditRecordsPreview,
  exportWorkspaceAuditRecordsPreview
} from '../../../apps/control-plane/src/observability-audit-export.mjs';
import {
  AUDIT_QUERY_ERROR_CODES,
  queryTenantAuditRecords,
  queryWorkspaceAuditRecords
} from '../../../apps/control-plane/src/observability-audit-query.mjs';

const traceabilityMatrix = readAuditTraceabilityMatrix();

function toSortedArray(values) {
  return Array.from(new Set(values ?? [])).sort();
}

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

function buildDownstreamEvent(overrides = {}) {
  return {
    id: 'evt_downstream_01',
    sourceContractId: 'mongo_admin_result',
    eventTimestamp: '2026-03-28T14:00:05Z',
    subsystemId: 'mongodb',
    actionId: 'cluster.apply',
    outcome: 'succeeded',
    auditRecordId: 'evt_audit_01',
    safeRef: 'evidence://mongo/change/01',
    ...overrides
  };
}

function buildScopedLoader(records = []) {
  return (query) => {
    const items = records.filter((record) => {
      const tenantMatches = !query.tenantId || record.scope?.tenantId === query.tenantId;
      const workspaceMatches = !query.workspaceId || record.scope?.workspaceId === query.workspaceId;
      const correlationMatches = !query.filters?.correlation_id || record.correlationId === query.filters.correlation_id;
      return tenantMatches && workspaceMatches && correlationMatches;
    });

    return {
      items,
      page: {
        size: items.length,
        hasMore: false
      }
    };
  };
}

function hasPermission(permissionSet, permissionId) {
  return permissionSet.has(permissionId);
}

test('audit traceability matrix anchors to the current audit contracts and shared expectations', () => {
  const auditPipeline = readObservabilityAuditPipeline();
  const auditQuerySurface = readObservabilityAuditQuerySurface();
  const auditExportSurface = readObservabilityAuditExportSurface();
  const auditCorrelationSurface = readObservabilityAuditCorrelationSurface();

  assert.equal(traceabilityMatrix.version, auditCorrelationSurface.version);
  assert.equal(traceabilityMatrix.surface_contracts.pipeline, 'observability_audit_pipeline');
  assert.equal(traceabilityMatrix.surface_contracts.schema, 'observability_audit_event_schema');
  assert.equal(traceabilityMatrix.surface_contracts.consultation, 'observability_audit_query_surface');
  assert.equal(traceabilityMatrix.surface_contracts.export, 'observability_audit_export_surface');
  assert.equal(traceabilityMatrix.surface_contracts.correlation, 'observability_audit_correlation_surface');
  assert.deepEqual(
    toSortedArray(traceabilityMatrix.shared_expectations.required_correlation_statuses),
    toSortedArray((auditCorrelationSurface.trace_statuses ?? []).map((status) => status.id))
  );
  assert.deepEqual(
    toSortedArray(traceabilityMatrix.shared_expectations.required_audit_scopes),
    toSortedArray((auditQuerySurface.supported_query_scopes ?? []).map((scope) => scope.id))
  );
  assert.deepEqual(
    toSortedArray(traceabilityMatrix.shared_expectations.required_audit_scopes),
    toSortedArray((auditExportSurface.supported_export_scopes ?? []).map((scope) => scope.id))
  );
  assert.deepEqual(
    toSortedArray(traceabilityMatrix.shared_expectations.required_audit_scopes),
    toSortedArray((auditCorrelationSurface.supported_trace_scopes ?? []).map((scope) => scope.id))
  );
  assert.deepEqual(
    toSortedArray(traceabilityMatrix.shared_expectations.required_subsystems),
    toSortedArray((auditPipeline.subsystem_roster ?? []).map((subsystem) => subsystem.id))
  );
  assert.deepEqual(
    toSortedArray(traceabilityMatrix.shared_expectations.required_masking_categories),
    toSortedArray((auditExportSurface.sensitive_field_rules ?? []).map((rule) => rule.id))
  );
});

test('audit traceability matrix covers every required category and RF-OBS reference', () => {
  for (const categoryId of REQUIRED_TRACEABILITY_CATEGORY_IDS) {
    assert.equal(listScenariosByCategory(traceabilityMatrix, categoryId).length >= 1, true, `missing category ${categoryId}`);
  }

  assert.deepEqual(toSortedArray(collectCoveredRequirementRefs(traceabilityMatrix)), toSortedArray(REQUIRED_RF_OBS_REFS));
});

test('full-chain traceability scenarios stay coherent across consultation, export, and correlation projections', () => {
  const chainScenarios = new Set(listScenariosByCategory(traceabilityMatrix, 'full_chain_traceability').map((scenario) => scenario.id));

  assert.equal(chainScenarios.has('TRACE-CHAIN-001'), true);
  assert.equal(chainScenarios.has('TRACE-CHAIN-002'), true);
  assert.equal(chainScenarios.has('TRACE-CHAIN-003'), true);

  const baseRecord = buildAuditRecord({
    eventId: 'evt_chain_01',
    correlationId: 'corr_chain_01'
  });
  const consultation = queryWorkspaceAuditRecords(
    {
      tenantId: 'ten_01a',
      workspaceId: 'wrk_01a',
      queryAuditRecords: buildScopedLoader([baseRecord])
    },
    {
      workspaceId: 'wrk_01a',
      correlationId: 'corr_chain_01'
    }
  );
  const exportPreview = exportWorkspaceAuditRecordsPreview(
    {
      tenantId: 'ten_01a',
      workspaceId: 'wrk_01a'
    },
    {
      workspaceId: 'wrk_01a',
      correlationId: 'corr_chain_01',
      records: [baseRecord]
    }
  );
  const completeTrace = traceWorkspaceAuditCorrelation(
    {
      tenantId: 'ten_01a',
      workspaceId: 'wrk_01a',
      targetCorrelationId: 'corr_chain_01'
    },
    {
      auditRecords: [baseRecord],
      downstreamEvents: [buildDownstreamEvent({ id: 'evt_chain_down_01', auditRecordId: 'evt_chain_01' })],
      expectedSubsystemIds: ['mongodb']
    }
  );

  assert.equal(consultation.items[0].correlationId, 'corr_chain_01');
  assert.equal(exportPreview.items[0].correlationId, 'corr_chain_01');
  assert.equal(completeTrace.correlationId, 'corr_chain_01');
  assert.equal(completeTrace.traceStatus, 'complete');
  assert.deepEqual(
    completeTrace.timeline.map((entry) => entry.eventTimestamp),
    ['2026-03-28T14:00:00Z', '2026-03-28T14:00:05Z']
  );
  assert.equal(completeTrace.timeline.every((entry) => Boolean(entry.subsystemId)), true);

  const failedTenantRecord = buildAuditRecord({
    eventId: 'evt_chain_02',
    correlationId: 'corr_chain_02',
    scope: { tenantId: 'ten_01a' },
    origin: { originSurface: 'control_api', emittingService: 'control_api' },
    result: { outcome: 'failed', errorCode: 'PROVIDER_REJECTED' }
  });
  const failedTrace = traceTenantAuditCorrelation(
    {
      tenantId: 'ten_01a',
      targetCorrelationId: 'corr_chain_02'
    },
    {
      auditRecords: [failedTenantRecord]
    }
  );

  assert.equal(failedTrace.traceStatus, 'broken');
  assert.equal(failedTrace.auditRecords[0].result.outcome, 'failed');
  assert.equal(failedTrace.missingLinks.includes('downstream_system_effect_missing'), true);

  const orderedTrace = traceWorkspaceAuditCorrelation(
    {
      tenantId: 'ten_01a',
      workspaceId: 'wrk_01a',
      targetCorrelationId: 'corr_chain_03'
    },
    {
      auditRecords: [
        buildAuditRecord({
          eventId: 'evt_chain_03_console',
          correlationId: 'corr_chain_03',
          eventTimestamp: '2026-03-28T14:00:00Z',
          origin: { originSurface: 'console_backend', emittingService: 'control_api' }
        }),
        buildAuditRecord({
          eventId: 'evt_chain_03_control',
          correlationId: 'corr_chain_03',
          eventTimestamp: '2026-03-28T14:00:03Z',
          origin: { originSurface: 'control_api', emittingService: 'control_api' },
          result: { outcome: 'accepted' }
        }),
        buildAuditRecord({
          eventId: 'evt_chain_03_provider',
          correlationId: 'corr_chain_03',
          eventTimestamp: '2026-03-28T14:00:04Z',
          origin: { originSurface: 'provider_adapter', emittingService: 'provisioning_orchestrator' },
          resource: { subsystemId: 'mongodb', resourceType: 'cluster' },
          result: { outcome: 'succeeded' }
        })
      ],
      downstreamEvents: [buildDownstreamEvent({ id: 'evt_chain_03_downstream', eventTimestamp: '2026-03-28T14:00:05Z' })],
      expectedSubsystemIds: ['mongodb']
    }
  );

  assert.deepEqual(
    orderedTrace.timeline.map((entry) => entry.phase),
    ['console_initiation', 'control_plane_execution', 'downstream_system_effect', 'downstream_system_effect']
  );
});

test('masking consistency scenarios preserve protected-field masking across consultation, export, and correlation', () => {
  const maskScenarios = new Set(listScenariosByCategory(traceabilityMatrix, 'masking_consistency').map((scenario) => scenario.id));
  assert.equal(maskScenarios.has('TRACE-MASK-001'), true);
  assert.equal(maskScenarios.has('TRACE-MASK-002'), true);
  assert.equal(maskScenarios.has('TRACE-MASK-003'), true);
  assert.equal(maskScenarios.has('TRACE-MASK-004'), true);

  const maskedRecord = buildAuditRecord({
    eventId: 'evt_mask_01',
    correlationId: 'corr_mask_01',
    detail: {
      password: 'super-secret',
      raw_endpoint: 'https://provider.internal.example/token',
      safeValue: 'keep-me'
    }
  });
  const consultation = queryWorkspaceAuditRecords(
    {
      tenantId: 'ten_01a',
      workspaceId: 'wrk_01a',
      queryAuditRecords: buildScopedLoader([maskedRecord])
    },
    {
      workspaceId: 'wrk_01a',
      correlationId: 'corr_mask_01'
    }
  );
  const exportPreview = exportWorkspaceAuditRecordsPreview(
    {
      tenantId: 'ten_01a',
      workspaceId: 'wrk_01a'
    },
    {
      workspaceId: 'wrk_01a',
      correlationId: 'corr_mask_01',
      records: [maskedRecord]
    }
  );
  const correlation = traceWorkspaceAuditCorrelation(
    {
      tenantId: 'ten_01a',
      workspaceId: 'wrk_01a',
      targetCorrelationId: 'corr_mask_01'
    },
    {
      auditRecords: [maskedRecord],
      downstreamEvents: [buildDownstreamEvent({ id: 'evt_mask_down_01', auditRecordId: 'evt_mask_01', safeRef: 'evidence://storage/object/01' })],
      expectedSubsystemIds: ['mongodb']
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

  assert.equal(correlation.evidencePointers[0].safeRef.startsWith('evidence://'), true);
  assert.equal(correlation.evidencePointers[0].safeRef.includes('provider.internal.example'), false);
  assert.equal(correlation.evidencePointers[0].safeRef.includes('super-secret'), false);
});

test('tenant and workspace isolation scenarios reject cross-scope access and keep bounded projections', () => {
  const tenantScenarios = new Set(listScenariosByCategory(traceabilityMatrix, 'tenant_isolation').map((scenario) => scenario.id));
  const workspaceScenarios = new Set(listScenariosByCategory(traceabilityMatrix, 'workspace_isolation').map((scenario) => scenario.id));

  assert.equal(tenantScenarios.has('TRACE-TENANT-001'), true);
  assert.equal(tenantScenarios.has('TRACE-TENANT-002'), true);
  assert.equal(workspaceScenarios.has('TRACE-WS-001'), true);
  assert.equal(workspaceScenarios.has('TRACE-WS-002'), true);

  const tenantARecord = buildAuditRecord({
    eventId: 'evt_tenant_a',
    correlationId: 'corr_tenant_a',
    scope: { tenantId: 'ten_01a' }
  });
  const tenantBRecord = buildAuditRecord({
    eventId: 'evt_tenant_b',
    correlationId: 'corr_tenant_b',
    scope: { tenantId: 'ten_01b' }
  });
  const tenantConsultation = queryTenantAuditRecords(
    {
      tenantId: 'ten_01a',
      queryAuditRecords: buildScopedLoader([tenantARecord, tenantBRecord])
    },
    {
      tenantId: 'ten_01a',
      correlationId: 'corr_tenant_a'
    }
  );
  const tenantExport = exportTenantAuditRecordsPreview(
    {
      tenantId: 'ten_01a'
    },
    {
      tenantId: 'ten_01a',
      correlationId: 'corr_tenant_a',
      records: [tenantARecord]
    }
  );

  assert.deepEqual(tenantConsultation.items.map((item) => item.scope.tenantId), ['ten_01a']);
  assert.deepEqual(tenantExport.items.map((item) => item.scope.tenantId), ['ten_01a']);
  assert.throws(
    () => traceTenantAuditCorrelation({ tenantId: 'ten_01a', targetCorrelationId: 'corr_tenant_b' }, { tenantId: 'ten_01b' }),
    (error) => error.code === AUDIT_CORRELATION_ERROR_CODES.SCOPE_VIOLATION
  );
  assert.throws(
    () => queryTenantAuditRecords({ tenantId: 'ten_01a' }, { tenantId: 'ten_01b' }),
    (error) => error.code === AUDIT_QUERY_ERROR_CODES.SCOPE_VIOLATION
  );
  assert.throws(
    () => exportTenantAuditRecordsPreview({ tenantId: 'ten_01a' }, { tenantId: 'ten_01b', format: 'jsonl' }),
    (error) => error.code === AUDIT_EXPORT_ERROR_CODES.SCOPE_VIOLATION
  );

  const workspaceW1Record = buildAuditRecord({
    eventId: 'evt_ws_01',
    correlationId: 'corr_ws_01',
    scope: { tenantId: 'ten_01a', workspaceId: 'wrk_01a' }
  });
  const workspaceW2Record = buildAuditRecord({
    eventId: 'evt_ws_02',
    correlationId: 'corr_ws_02',
    scope: { tenantId: 'ten_01a', workspaceId: 'wrk_01b' }
  });
  const workspaceConsultation = queryWorkspaceAuditRecords(
    {
      tenantId: 'ten_01a',
      workspaceId: 'wrk_01a',
      queryAuditRecords: buildScopedLoader([workspaceW1Record, workspaceW2Record])
    },
    {
      workspaceId: 'wrk_01a',
      correlationId: 'corr_ws_01'
    }
  );

  assert.deepEqual(workspaceConsultation.items.map((item) => item.scope.workspaceId), ['wrk_01a']);
  assert.throws(
    () => queryWorkspaceAuditRecords({ tenantId: 'ten_01a', workspaceId: 'wrk_01a' }, { workspaceId: 'wrk_01b' }),
    (error) => error.code === AUDIT_QUERY_ERROR_CODES.SCOPE_VIOLATION
  );
  assert.throws(
    () => exportWorkspaceAuditRecordsPreview({ tenantId: 'ten_01a', workspaceId: 'wrk_01a' }, { workspaceId: 'wrk_01b', format: 'jsonl' }),
    (error) => error.code === AUDIT_EXPORT_ERROR_CODES.SCOPE_VIOLATION
  );
  assert.throws(
    () => traceWorkspaceAuditCorrelation({ tenantId: 'ten_01a', workspaceId: 'wrk_01a', targetCorrelationId: 'corr_ws_02' }, { workspaceId: 'wrk_01b' }),
    (error) => error.code === AUDIT_CORRELATION_ERROR_CODES.SCOPE_VIOLATION
  );
});

test('permission boundary scenarios require explicit audit permissions per surface', () => {
  const querySurface = readObservabilityAuditQuerySurface();
  const exportSurface = readObservabilityAuditExportSurface();
  const correlationSurface = readObservabilityAuditCorrelationSurface();

  const tenantReadPermission = querySurface.supported_query_scopes.find((scope) => scope.id === 'tenant').required_permission;
  const workspaceExportPermission = exportSurface.supported_export_scopes.find((scope) => scope.id === 'workspace').required_permission;
  const tenantExportPermission = exportSurface.supported_export_scopes.find((scope) => scope.id === 'tenant').required_permission;
  const tenantCorrelationPermission = correlationSurface.supported_trace_scopes.find((scope) => scope.id === 'tenant').required_permission;
  const workspaceCorrelationPermission = correlationSurface.supported_trace_scopes.find((scope) => scope.id === 'workspace').required_permission;

  const tenantReadOnly = new Set([tenantReadPermission]);
  const workspaceExportOnly = new Set([workspaceExportPermission]);
  const tenantCorrelationOnly = new Set([tenantCorrelationPermission]);
  const noAuditPermissions = new Set(['workspace.read']);

  assert.equal(hasPermission(tenantReadOnly, tenantReadPermission), true);
  assert.equal(hasPermission(tenantReadOnly, tenantCorrelationPermission), false);

  assert.equal(hasPermission(workspaceExportOnly, workspaceExportPermission), true);
  assert.equal(hasPermission(workspaceExportOnly, workspaceCorrelationPermission), false);

  assert.equal(hasPermission(tenantCorrelationOnly, tenantCorrelationPermission), true);
  assert.equal(hasPermission(tenantCorrelationOnly, tenantExportPermission), false);

  for (const permissionId of traceabilityMatrix.shared_expectations.required_audit_permissions) {
    assert.equal(hasPermission(noAuditPermissions, permissionId), false, `expected ${permissionId} to stay denied`);
  }
});

test('trace-state diagnostic scenarios classify broken, partial, and not_found consistently', () => {
  const traceStateScenarios = new Set(listScenariosByCategory(traceabilityMatrix, 'trace_state_diagnostics').map((scenario) => scenario.id));

  assert.equal(traceStateScenarios.has('TRACE-STATE-001'), true);
  assert.equal(traceStateScenarios.has('TRACE-STATE-002'), true);
  assert.equal(traceStateScenarios.has('TRACE-STATE-003'), true);
  assert.equal(traceStateScenarios.has('TRACE-STATE-004'), true);

  const brokenMissingDownstream = traceWorkspaceAuditCorrelation(
    {
      tenantId: 'ten_01a',
      workspaceId: 'wrk_01a',
      targetCorrelationId: 'corr_state_01'
    },
    {
      auditRecords: [buildAuditRecord({ eventId: 'evt_state_01', correlationId: 'corr_state_01' })]
    }
  );

  assert.equal(brokenMissingDownstream.traceStatus, 'broken');
  assert.equal(brokenMissingDownstream.missingLinks.includes('downstream_system_effect_missing'), true);

  const brokenMissingRoot = traceWorkspaceAuditCorrelation(
    {
      tenantId: 'ten_01a',
      workspaceId: 'wrk_01a',
      targetCorrelationId: 'corr_state_02'
    },
    {
      downstreamEvents: [buildDownstreamEvent({ id: 'evt_state_02', auditRecordId: 'evt_state_missing_root' })]
    }
  );

  assert.equal(brokenMissingRoot.traceStatus, 'broken');
  assert.equal(brokenMissingRoot.missingLinks.includes('console_initiation_missing'), true);

  const notFound = traceWorkspaceAuditCorrelation(
    {
      tenantId: 'ten_01a',
      workspaceId: 'wrk_01a',
      targetCorrelationId: 'corr_state_03'
    },
    {}
  );

  assert.equal(notFound.traceStatus, 'not_found');
  assert.deepEqual(notFound.missingLinks, ['correlation_trace_not_found']);

  const partial = traceWorkspaceAuditCorrelation(
    {
      tenantId: 'ten_01a',
      workspaceId: 'wrk_01a',
      targetCorrelationId: 'corr_state_04'
    },
    {
      auditRecords: [buildAuditRecord({ eventId: 'evt_state_04', correlationId: 'corr_state_04' })],
      downstreamEvents: [buildDownstreamEvent({ id: 'evt_state_04_down', auditRecordId: 'evt_state_04', subsystemId: 'mongodb' })],
      expectedSubsystemIds: ['mongodb', 'storage']
    }
  );

  assert.equal(partial.traceStatus, 'partial');
  assert.equal(partial.missingLinks.includes('subsystem_missing:storage'), true);
  assert.deepEqual(partial.subsystems, ['mongodb', 'tenant_control_plane']);
});
