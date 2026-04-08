import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STORAGE_AUDIT_COVERAGE_CATEGORIES,
  STORAGE_AUDIT_ERROR_CODES,
  STORAGE_AUDIT_OPERATION_TYPES,
  buildStorageAccessDeniedAuditEvent,
  buildStorageAdminAuditEvent,
  buildStorageAuditCoverageReport,
  buildStorageCredentialLifecycleAuditEvent,
  buildStorageMetaAuditEvent,
  buildStorageUnifiedAuditEvent,
  normalizeStorageAuditEvent,
  queryStorageAuditTrail
} from '../../services/adapters/src/storage-audit-ops.mjs';
import { STORAGE_NORMALIZED_ERROR_CODES, buildStorageErrorAuditEvent } from '../../services/adapters/src/storage-error-taxonomy.mjs';
import { buildStorageBucketRecord, buildStorageMutationEvent, buildStorageObjectRecord } from '../../services/adapters/src/storage-bucket-object-ops.mjs';
import { buildStorageEventNotificationAuditEvent, buildStorageEventNotificationRule, STORAGE_EVENT_NOTIFICATION_AUDIT_ACTIONS, STORAGE_EVENT_NOTIFICATION_DESTINATION_TYPES, STORAGE_EVENT_NOTIFICATION_EVENT_TYPES } from '../../services/adapters/src/storage-event-notifications.mjs';
import { buildStorageUsageAuditEvent } from '../../services/adapters/src/storage-usage-reporting.mjs';
import { buildStorageImportExportAuditEvent } from '../../services/adapters/src/storage-import-export.mjs';

function collectStrings(value, results = []) {
  if (typeof value === 'string') {
    results.push(value);
    return results;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectStrings(entry, results);
    }
    return results;
  }

  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) {
      collectStrings(entry, results);
    }
  }

  return results;
}

function assertNoUndefinedDeep(value) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      assertNoUndefinedDeep(entry);
    }
    return;
  }

  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      assert.notEqual(entry, undefined, `field ${key} should not be undefined`);
      assertNoUndefinedDeep(entry);
    }
  }
}

function makeBucket() {
  return buildStorageBucketRecord({
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    workspaceSlug: 'falcone',
    bucketName: 'falcone-assets',
    now: '2026-03-28T00:00:00Z'
  });
}

function makeObject(bucket = makeBucket()) {
  return buildStorageObjectRecord({
    bucket,
    objectKey: 'uploads/logo.png',
    applicationId: 'app_01',
    applicationSlug: 'console',
    sizeBytes: 128,
    contentType: 'image/png',
    checksumSha256: 'abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd',
    now: '2026-03-28T00:00:00Z'
  });
}

test('STORAGE_AUDIT_OPERATION_TYPES is frozen and exposes the full unique catalog', () => {
  const values = Object.values(STORAGE_AUDIT_OPERATION_TYPES);

  assert.equal(Object.isFrozen(STORAGE_AUDIT_OPERATION_TYPES), true);
  assert.equal(values.length, 24);
  assert.equal(new Set(values).size, 24);
  assert.equal(values.every((value) => typeof value === 'string' && value.length > 0), true);
  assert.equal(values.every((value) => /^[a-z_]+(\.[a-z_]+)+$/.test(value)), true);
});

test('STORAGE_AUDIT_ERROR_CODES is frozen, complete, and does not collide with normalized storage errors', () => {
  const values = Object.values(STORAGE_AUDIT_ERROR_CODES);
  const normalizedValues = new Set(Object.values(STORAGE_NORMALIZED_ERROR_CODES));

  assert.equal(Object.isFrozen(STORAGE_AUDIT_ERROR_CODES), true);
  assert.deepEqual(values.sort(), [
    'AUDIT_COVERAGE_UNAVAILABLE',
    'AUDIT_QUERY_INVALID',
    'AUDIT_SCOPE_UNAUTHORIZED'
  ]);
  assert.equal(values.every((value) => /^[A-Z0-9_]+$/.test(value)), true);
  assert.equal(values.every((value) => !normalizedValues.has(value)), true);
});

test('STORAGE_AUDIT_COVERAGE_CATEGORIES is frozen and contains the expected 15 categories', () => {
  assert.equal(Object.isFrozen(STORAGE_AUDIT_COVERAGE_CATEGORIES), true);
  assert.equal(STORAGE_AUDIT_COVERAGE_CATEGORIES.length, 15);
  assert.equal(new Set(STORAGE_AUDIT_COVERAGE_CATEGORIES).size, 15);
  assert.equal(STORAGE_AUDIT_COVERAGE_CATEGORIES.includes('access.denied'), true);
  assert.deepEqual(STORAGE_AUDIT_COVERAGE_CATEGORIES, [
    'object.read',
    'object.write',
    'object.delete',
    'object.list',
    'bucket.create',
    'bucket.delete',
    'bucket_policy.change',
    'credential.lifecycle',
    'quota.change',
    'tenant_context.lifecycle',
    'access.denied',
    'import_export',
    'usage_report',
    'event_notification.lifecycle',
    'error'
  ]);
});

test('buildStorageUnifiedAuditEvent sanitizes strings, defaults optional fields to null, and freezes the output', () => {
  const event = buildStorageUnifiedAuditEvent({
    eventType: 'storage.object.put',
    operationCategory: 'data_plane',
    operationType: 'object.put',
    actorId: 'user-https://example.com/secret',
    actorType: 'user',
    outcome: 'success',
    correlationId: 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4',
    resourceScope: {
      tenantId: 'ten_01',
      workspaceId: 'wrk_01',
      bucketId: 'bucket_01',
      objectKey: 'https://example.com/secret'
    }
  });

  assert.equal(event.eventId.startsWith('sevt_'), true);
  assert.equal(typeof event.occurredAt, 'string');
  assert.equal(Number.isNaN(Date.parse(event.occurredAt)), false);
  assert.equal(Object.isFrozen(event), true);
  assert.equal(Object.isFrozen(event.resourceScope), true);
  assert.deepEqual(Object.keys(event.resourceScope), ['tenantId', 'workspaceId', 'bucketId', 'objectKey']);
  assert.equal(event.actorId.includes('[redacted-url]'), true);
  assert.equal(event.resourceScope.objectKey, '[redacted-url]');
  assert.equal(event.credentialId, null);
  assert.equal(event.changeSummary, null);
  assert.equal(event.errorCode, null);
  assert.equal(event.policySource, null);
  assert.equal(event.triggerSource, null);
  assert.equal(event.cascadeTriggered, null);
  assert.equal(event.cascadeScope, null);
});

test('buildStorageAdminAuditEvent enforces administrative categories and policy/lifecycle guards', () => {
  const policyEvent = buildStorageAdminAuditEvent('bucket_policy.update', {
    actorId: 'usr_01',
    actorType: 'user',
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    correlationId: 'cor_01'
  }, {
    bucketId: 'bucket_01',
    outcome: 'success',
    changeSummary: {
      statementsAdded: 1,
      statementsRemoved: 0,
      statementsModified: 2,
      leakedPolicy: { full: true }
    }
  });
  const systemEvent = buildStorageAdminAuditEvent('tenant_context.provision', {
    actorId: 'system:lifecycle-cascade',
    actorType: 'system',
    tenantId: 'ten_01',
    workspaceId: 'wrk_01'
  }, {
    outcome: 'success'
  });

  assert.equal(policyEvent.operationCategory, 'administrative');
  assert.equal(policyEvent.eventType.startsWith('storage.'), true);
  assert.deepEqual(policyEvent.changeSummary, {
    statementsAdded: 1,
    statementsRemoved: 0,
    statementsModified: 2
  });
  assert.equal(systemEvent.actorType, 'system');
  assert.throws(
    () => buildStorageAdminAuditEvent('unknown.operation', { actorId: 'usr_01', actorType: 'user' }, { outcome: 'success' }),
    /Unsupported storage administrative audit operation/
  );
  assert.throws(
    () => buildStorageAdminAuditEvent('tenant_context.suspend', { actorId: 'usr_01', actorType: 'user', tenantId: 'ten_01', workspaceId: 'wrk_01' }, { outcome: 'success', cascadeTriggered: true }),
    /cascadeScope/
  );
});

test('buildStorageAccessDeniedAuditEvent encodes denied access without accepting full policy documents', () => {
  const withoutCredential = buildStorageAccessDeniedAuditEvent({
    actorId: 'usr_01',
    actorType: 'user',
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    correlationId: 'cor_denied_01'
  }, {
    requestedAction: 'object.get',
    targetResource: { bucketId: 'bucket_01', objectKey: 'private.txt' },
    policySource: 'bucket_policy',
    statementId: 'stmt_01'
  });
  const withCredential = buildStorageAccessDeniedAuditEvent({
    actorId: 'usr_01',
    actorType: 'user',
    credentialId: 'cred_01',
    tenantId: 'ten_01',
    workspaceId: 'wrk_01'
  }, {
    requestedAction: 'object.get',
    targetResource: { bucketId: 'bucket_01' },
    policySource: 'workspace_default'
  });

  assert.equal(withoutCredential.outcome, 'denied');
  assert.equal(withoutCredential.operationType, 'access.denied');
  assert.equal(withoutCredential.policySource, 'bucket_policy');
  assert.equal(withoutCredential.credentialId, null);
  assert.equal(withCredential.credentialId, 'cred_01');
  assert.throws(
    () => buildStorageAccessDeniedAuditEvent({ actorId: 'usr_01', actorType: 'user', tenantId: 'ten_01', workspaceId: 'wrk_01' }, {
      requestedAction: 'object.get',
      targetResource: { bucketId: 'bucket_01' },
      policySource: 'bucket_policy',
      policyDocument: { full: true }
    }),
    /must not include full policy documents/
  );
});

test('buildStorageCredentialLifecycleAuditEvent validates required credential fields and supported operation types', () => {
  const operationTypes = [
    'credential.create',
    'credential.rotate',
    'credential.revoke',
    'credential.expire'
  ];

  for (const operationType of operationTypes) {
    const event = buildStorageCredentialLifecycleAuditEvent({
      actorId: 'usr_01',
      actorType: 'user',
      tenantId: 'ten_01',
      workspaceId: 'wrk_01'
    }, {
      credentialId: 'cred_01',
      operationType,
      outcome: 'success'
    });

    assert.equal(event.operationCategory, 'administrative');
    assert.equal(event.operationType, operationType);
    assert.equal(event.credentialId, 'cred_01');
  }

  assert.throws(
    () => buildStorageCredentialLifecycleAuditEvent({ actorId: 'usr_01', actorType: 'user' }, { credentialId: null, operationType: 'credential.create', outcome: 'success' }),
    /credentialId is required/
  );
  assert.throws(
    () => buildStorageCredentialLifecycleAuditEvent({ actorId: 'usr_01', actorType: 'user' }, { credentialId: 'cred_01', operationType: 'credential.invalid', outcome: 'success' }),
    /Unsupported storage credential lifecycle operation/
  );
});

test('buildStorageMetaAuditEvent keeps only structural filter fields and excludes query results or pagination controls', () => {
  const metaEvent = buildStorageMetaAuditEvent({
    actorId: 'usr_01',
    actorType: 'workspace_admin',
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    correlationId: 'cor_meta_01'
  }, {
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    actorId: 'usr_01',
    operationType: 'object.get',
    outcome: 'success',
    fromTimestamp: '2026-03-01T00:00:00Z',
    toTimestamp: '2026-03-28T00:00:00Z',
    cursor: 'next-page',
    limit: 25,
    items: [{ leaked: true }]
  });

  assert.equal(metaEvent.operationType, 'audit.query');
  assert.equal(metaEvent.operationCategory, 'administrative');
  assert.deepEqual(metaEvent.changeSummary, {
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    actorId: 'usr_01',
    operationType: 'object.get',
    outcome: 'success',
    fromTimestamp: '2026-03-01T00:00:00Z',
    toTimestamp: '2026-03-28T00:00:00Z'
  });
  assert.equal('cursor' in metaEvent.changeSummary, false);
  assert.equal('limit' in metaEvent.changeSummary, false);
  assert.equal(JSON.stringify(metaEvent).includes('leaked'), false);
});

test('normalizeStorageAuditEvent maps heterogeneous source events into a frozen unified shape', () => {
  const bucket = makeBucket();
  const object = makeObject(bucket);
  const mutationSource = buildStorageMutationEvent({
    operation: 'object.deleted',
    bucket,
    object,
    actorUserId: 'usr_01',
    correlationId: 'cor_mutation_01',
    occurredAt: '2026-03-28T00:00:00Z'
  });
  const errorSource = buildStorageErrorAuditEvent({
    providerCode: 'Quota_Exceeded',
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    operation: 'object.put',
    bucketName: 'falcone-assets',
    objectKey: 'uploads/logo.png',
    observedAt: '2026-03-28T00:00:01Z'
  });
  const rule = buildStorageEventNotificationRule({
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    bucketId: 'bucket_01',
    destinationType: STORAGE_EVENT_NOTIFICATION_DESTINATION_TYPES.KAFKA_TOPIC,
    destinationRef: 'storage.audit.topic',
    eventTypes: [STORAGE_EVENT_NOTIFICATION_EVENT_TYPES.OBJECT_CREATED]
  });
  const notificationSource = buildStorageEventNotificationAuditEvent({
    action: STORAGE_EVENT_NOTIFICATION_AUDIT_ACTIONS.RULE_CREATED,
    outcome: 'allowed',
    rule,
    occurredAt: '2026-03-28T00:00:02Z'
  });
  const usageSource = buildStorageUsageAuditEvent({
    actorPrincipal: { id: 'usr_01', type: 'user' },
    scopeType: 'workspace',
    scopeId: 'wrk_01',
    tenantId: 'ten_01',
    timestamp: '2026-03-28T00:00:03Z'
  });
  const importExportSource = buildStorageImportExportAuditEvent({
    operationType: 'import',
    actingPrincipal: { id: 'usr_01', type: 'user' },
    manifestId: 'smf_01',
    targetBucketId: 'bucket_01',
    targetWorkspaceId: 'wrk_01',
    targetTenantId: 'ten_01',
    conflictPolicy: 'skip',
    importedCount: 1,
    skippedCount: 0,
    failedCount: 0,
    totalBytesImported: 64,
    outcome: 'success',
    timestamp: '2026-03-28T00:00:04Z'
  });

  const mutation = normalizeStorageAuditEvent(mutationSource);
  const error = normalizeStorageAuditEvent(errorSource);
  const notification = normalizeStorageAuditEvent(notificationSource);
  const usage = normalizeStorageAuditEvent(usageSource);
  const importExport = normalizeStorageAuditEvent(importExportSource);
  const unknown = normalizeStorageAuditEvent({ eventType: 'storage.custom.unknown', tenantId: 'ten_01' });

  assert.equal(mutation.operationCategory, 'data_plane');
  assert.equal(error.operationCategory, 'error');
  assert.equal(notification.operationCategory, 'lifecycle');
  assert.equal(usage.operationCategory, 'administrative');
  assert.equal(importExport.operationCategory, 'data_plane');
  assert.equal(unknown.operationCategory, 'data_plane');
  for (const event of [mutation, error, notification, usage, importExport, unknown]) {
    assert.equal(Object.isFrozen(event), true);
    assert.equal(Object.isFrozen(event.resourceScope), true);
    assertNoUndefinedDeep(event);
  }
});

test('queryStorageAuditTrail enforces actor scope and query validation', async () => {
  await assert.rejects(
    () => queryStorageAuditTrail({
      actorId: 'usr_dev',
      actorType: 'developer',
      tenantId: 'ten_01',
      workspaceId: 'wrk_01',
      publishAuditEvent() {},
      queryAuditRecords: async () => ({ items: [], cursor: null, total: 0 })
    }, {
      tenantId: 'ten_01',
      workspaceId: 'wrk_01',
      actorId: 'usr_other'
    }),
    (error) => error.code === 'AUDIT_SCOPE_UNAUTHORIZED'
  );

  await assert.rejects(
    () => queryStorageAuditTrail({
      actorId: 'usr_admin',
      actorType: 'workspace_admin',
      tenantId: 'ten_01',
      workspaceId: 'wrk_01',
      publishAuditEvent() {},
      queryAuditRecords: async () => ({ items: [], cursor: null, total: 0 })
    }, {
      tenantId: 'ten_01',
      workspaceId: 'wrk_02'
    }),
    (error) => error.code === 'AUDIT_SCOPE_UNAUTHORIZED'
  );

  await assert.rejects(
    () => queryStorageAuditTrail({
      actorId: 'usr_owner',
      actorType: 'tenant_owner',
      tenantId: 'ten_01',
      workspaceId: 'wrk_01',
      publishAuditEvent() {},
      queryAuditRecords: async () => ({ items: [], cursor: null, total: 0 })
    }, {
      tenantId: 'ten_other'
    }),
    (error) => error.code === 'AUDIT_SCOPE_UNAUTHORIZED'
  );

  await assert.doesNotReject(() => queryStorageAuditTrail({
    actorId: 'usr_root',
    actorType: 'user',
    isSuperadmin: true,
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    publishAuditEvent() {},
    queryAuditRecords: async () => ({ items: [], cursor: null, total: 0 })
  }, {
    tenantId: 'ten_other',
    workspaceId: 'wrk_other',
    actorId: 'usr_other'
  }));

  await assert.rejects(
    () => queryStorageAuditTrail({
      actorId: 'usr_admin',
      actorType: 'workspace_admin',
      tenantId: 'ten_01',
      workspaceId: 'wrk_01',
      publishAuditEvent() {},
      queryAuditRecords: async () => ({ items: [], cursor: null, total: 0 })
    }, {
      tenantId: 'ten_01',
      limit: 501
    }),
    (error) => error.code === 'AUDIT_QUERY_INVALID'
  );

  await assert.rejects(
    () => queryStorageAuditTrail({
      actorId: 'usr_admin',
      actorType: 'workspace_admin',
      tenantId: 'ten_01',
      workspaceId: 'wrk_01',
      publishAuditEvent() {},
      queryAuditRecords: async () => ({ items: [], cursor: null, total: 0 })
    }, {
      tenantId: 'ten_01',
      fromTimestamp: 'not-an-iso-date'
    }),
    (error) => error.code === 'AUDIT_QUERY_INVALID'
  );
});

test('queryStorageAuditTrail emits one meta-audit event, filters cross-tenant data, and returns applied filters', async () => {
  const published = [];
  const keptEvent = buildStorageUnifiedAuditEvent({
    eventType: 'storage.object.get',
    operationCategory: 'data_plane',
    operationType: 'object.get',
    actorId: 'usr_01',
    actorType: 'user',
    outcome: 'success',
    resourceScope: { tenantId: 'ten_01', workspaceId: 'wrk_01', bucketId: 'bucket_01', objectKey: 'safe.txt' }
  });
  const leakedEvent = buildStorageUnifiedAuditEvent({
    eventType: 'storage.object.get',
    operationCategory: 'data_plane',
    operationType: 'object.get',
    actorId: 'usr_02',
    actorType: 'user',
    outcome: 'success',
    resourceScope: { tenantId: 'ten_02', workspaceId: 'wrk_02', bucketId: 'bucket_02', objectKey: 'leak.txt' }
  });
  const result = await queryStorageAuditTrail({
    actorId: 'usr_admin',
    actorType: 'workspace_admin',
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    correlationId: 'cor_query_01',
    publishAuditEvent(topic, event) {
      published.push({ topic, event });
    },
    async queryAuditRecords() {
      return {
        items: [keptEvent, leakedEvent, keptEvent],
        cursor: 'next-page-token',
        total: 3
      };
    }
  }, {
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    limit: 25
  });

  assert.equal(result.items.length, 2);
  assert.equal(result.cursor, 'next-page-token');
  assert.equal(result.appliedFilters.limit, 25);
  assert.equal(result.appliedFilters.sortOrder, 'desc');
  assert.equal(published.length, 1);
  assert.equal(published[0].event.operationType, 'audit.query');
});

test('buildStorageAuditCoverageReport returns all coverage categories and enforces platform authorization', async () => {
  const gapReport = await buildStorageAuditCoverageReport({
    actorId: 'usr_owner',
    actorType: 'tenant_owner',
    tenantId: 'ten_01',
    isSuperadmin: false,
    async queryCoverage() {
      return { lastEventAt: null };
    }
  }, {
    scopeType: 'tenant'
  });
  const coveredReport = await buildStorageAuditCoverageReport({
    actorId: 'usr_root',
    actorType: 'superadmin',
    tenantId: null,
    isSuperadmin: true,
    async queryCoverage() {
      return { lastEventAt: '2026-03-01T00:00:00Z' };
    }
  }, {
    scopeType: 'platform',
    windowDays: 14
  });

  assert.equal(gapReport.categories.length, 15);
  assert.equal(gapReport.categories.every((entry) => ['covered', 'gap'].includes(entry.coverageStatus)), true);
  assert.equal(gapReport.categories.every((entry) => Array.isArray(entry.exampleOperationTypes)), true);
  assert.equal(gapReport.categories.every((entry) => entry.coverageStatus === 'gap'), true);
  assert.equal(coveredReport.categories.every((entry) => entry.coverageStatus === 'covered'), true);
  assert.equal(coveredReport.windowDays, 14);

  await assert.rejects(
    () => buildStorageAuditCoverageReport({
      actorId: 'usr_owner',
      actorType: 'tenant_owner',
      tenantId: 'ten_01',
      isSuperadmin: false,
      async queryCoverage() {
        return { lastEventAt: null };
      }
    }, {
      scopeType: 'platform'
    }),
    (error) => error.code === 'AUDIT_COVERAGE_UNAVAILABLE'
  );
});
