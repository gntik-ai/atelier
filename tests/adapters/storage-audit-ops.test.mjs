import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STORAGE_AUDIT_TOPIC,
  buildStorageAuditCoverageReport,
  buildStorageMetaAuditEvent,
  buildStorageUnifiedAuditEvent,
  emitStorageAuditEvent,
  normalizeStorageAuditEvent,
  queryStorageAuditTrail
} from '../../services/adapters/src/storage-audit-ops.mjs';
import { buildStorageBucketRecord, buildStorageMutationEvent, buildStorageObjectRecord } from '../../services/adapters/src/storage-bucket-object-ops.mjs';
import { buildStorageErrorAuditEvent } from '../../services/adapters/src/storage-error-taxonomy.mjs';
import { buildStorageEventNotificationAuditEvent, buildStorageEventNotificationRule, STORAGE_EVENT_NOTIFICATION_AUDIT_ACTIONS, STORAGE_EVENT_NOTIFICATION_DESTINATION_TYPES, STORAGE_EVENT_NOTIFICATION_EVENT_TYPES } from '../../services/adapters/src/storage-event-notifications.mjs';
import { buildStorageUsageAuditEvent } from '../../services/adapters/src/storage-usage-reporting.mjs';
import { buildStorageImportExportAuditEvent } from '../../services/adapters/src/storage-import-export.mjs';

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

test('normalizeStorageAuditEvent round-trips the five existing storage audit source builders', () => {
  const bucket = makeBucket();
  const object = makeObject(bucket);
  const mutationSource = buildStorageMutationEvent({
    operation: 'object.put',
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
  const notificationRule = buildStorageEventNotificationRule({
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    bucketId: 'bucket_01',
    destinationType: STORAGE_EVENT_NOTIFICATION_DESTINATION_TYPES.KAFKA_TOPIC,
    destinationRef: 'storage.audit.topic',
    eventTypes: [STORAGE_EVENT_NOTIFICATION_EVENT_TYPES.OBJECT_CREATED]
  });
  const notificationSource = buildStorageEventNotificationAuditEvent({
    action: STORAGE_EVENT_NOTIFICATION_AUDIT_ACTIONS.RULE_UPDATED,
    outcome: 'allowed',
    rule: notificationRule,
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
    operationType: 'export',
    actingPrincipal: { id: 'usr_01', type: 'user' },
    manifestId: 'smf_01',
    sourceBucketId: 'bucket_01',
    sourceWorkspaceId: 'wrk_01',
    sourceTenantId: 'ten_01',
    filterCriteria: { prefix: 'uploads/' },
    objectCount: 1,
    totalBytes: 128,
    outcome: 'success',
    timestamp: '2026-03-28T00:00:04Z'
  });

  const normalized = [
    normalizeStorageAuditEvent(mutationSource),
    normalizeStorageAuditEvent(errorSource),
    normalizeStorageAuditEvent(notificationSource),
    normalizeStorageAuditEvent(usageSource),
    normalizeStorageAuditEvent(importExportSource)
  ];
  const categories = normalized.map((event) => event.operationCategory);

  assert.deepEqual(categories, ['data_plane', 'error', 'lifecycle', 'administrative', 'data_plane']);
  for (const event of normalized) {
    assert.equal(Object.isFrozen(event), true);
    assert.equal(event.eventType.startsWith('storage.'), true);
    assert.equal(Object.isFrozen(event.resourceScope), true);
    assert.deepEqual(Object.keys(event.resourceScope), ['tenantId', 'workspaceId', 'bucketId', 'objectKey']);
    assertNoUndefinedDeep(event);
  }
});

test('emitStorageAuditEvent publishes normal events and skips meta-audit events', () => {
  const published = [];
  const normalEvent = buildStorageUnifiedAuditEvent({
    eventType: 'storage.object.put',
    operationCategory: 'data_plane',
    operationType: 'object.put',
    actorId: 'usr_01',
    actorType: 'user',
    outcome: 'success',
    resourceScope: { tenantId: 'ten_01', workspaceId: 'wrk_01', bucketId: 'bucket_01', objectKey: 'uploads/logo.png' }
  });
  const metaEvent = buildStorageMetaAuditEvent({
    actorId: 'usr_01',
    actorType: 'workspace_admin',
    tenantId: 'ten_01',
    workspaceId: 'wrk_01'
  }, {
    tenantId: 'ten_01',
    workspaceId: 'wrk_01'
  });

  emitStorageAuditEvent(normalEvent, {
    publishAuditEvent(topic, event) {
      published.push({ topic, event });
    }
  });
  emitStorageAuditEvent(metaEvent, {
    publishAuditEvent(topic, event) {
      published.push({ topic, event });
    }
  });

  assert.equal(published.length, 1);
  assert.equal(published[0].topic, STORAGE_AUDIT_TOPIC);
  assert.equal(published[0].event, normalEvent);
});

test('queryStorageAuditTrail returns paged results and emits one meta-audit event before the query loader', async () => {
  const calls = [];
  const event = buildStorageUnifiedAuditEvent({
    eventType: 'storage.object.get',
    operationCategory: 'data_plane',
    operationType: 'object.get',
    actorId: 'usr_01',
    actorType: 'user',
    outcome: 'success',
    resourceScope: { tenantId: 'ten_01', workspaceId: 'wrk_01', bucketId: 'bucket_01', objectKey: 'safe.txt' }
  });

  const result = await queryStorageAuditTrail({
    actorId: 'usr_admin',
    actorType: 'workspace_admin',
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    publishAuditEvent(topic, auditEvent) {
      calls.push({ kind: 'publish', topic, auditEvent });
    },
    async queryAuditRecords(normalizedParams) {
      calls.push({ kind: 'query', normalizedParams });
      return {
        items: [event, event, event, event, event],
        cursor: 'next-page-token',
        total: 42
      };
    }
  }, {
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    limit: 5,
    sortOrder: 'asc'
  });

  assert.equal(result.items.length, 5);
  assert.equal(result.cursor, 'next-page-token');
  assert.equal(result.total, 42);
  assert.equal(result.appliedFilters.limit, 5);
  assert.equal(result.appliedFilters.sortOrder, 'asc');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].kind, 'publish');
  assert.equal(calls[0].topic, STORAGE_AUDIT_TOPIC);
  assert.equal(calls[0].auditEvent.operationType, 'audit.query');
  assert.equal(calls[1].kind, 'query');
});

test('buildStorageAuditCoverageReport aggregates covered and gap categories', async () => {
  const report = await buildStorageAuditCoverageReport({
    actorId: 'usr_owner',
    actorType: 'tenant_owner',
    tenantId: 'ten_01',
    isSuperadmin: false,
    async queryCoverage({ category }) {
      return {
        lastEventAt: category === 'error' ? null : '2026-03-01T00:00:00Z'
      };
    }
  }, {
    scopeType: 'tenant'
  });

  assert.equal(report.entityType, 'storage_audit_coverage_report');
  assert.equal(Number.isNaN(Date.parse(report.generatedAt)), false);
  assert.equal(report.categories.length, 15);
  assert.equal(report.categories.filter((entry) => entry.coverageStatus === 'covered').length, 14);
  assert.equal(report.categories.filter((entry) => entry.coverageStatus === 'gap').length, 1);
});

test('buildStorageUnifiedAuditEvent sanitizes url and base64-like secrets across all string fields', () => {
  const event = buildStorageUnifiedAuditEvent({
    eventType: 'storage.object.put',
    operationCategory: 'data_plane',
    operationType: 'object.put',
    actorId: 'user-https://evil.com/leak',
    actorType: 'user',
    credentialId: 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4',
    outcome: 'success',
    resourceScope: {
      tenantId: 'ten_01',
      workspaceId: 'wrk_01',
      bucketId: 'bucket_01',
      objectKey: 'https://evil.com/leak'
    },
    changeSummary: {
      reason: 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4',
      link: 'https://evil.com/leak'
    },
    correlationId: 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4'
  });
  const strings = collectStrings(event);

  assert.equal(strings.some((value) => value.includes('https://')), false);
  assert.equal(strings.some((value) => value.includes('YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4')), false);
  assert.equal(strings.some((value) => value.includes('[redacted-url]')), true);
  assert.equal(strings.some((value) => value.includes('[redacted]')), true);
});

test('queryStorageAuditTrail drops cross-tenant results for tenant-scoped callers', async () => {
  const t1 = buildStorageUnifiedAuditEvent({
    eventType: 'storage.object.get',
    operationCategory: 'data_plane',
    operationType: 'object.get',
    actorId: 'usr_01',
    actorType: 'user',
    outcome: 'success',
    resourceScope: { tenantId: 'T1', workspaceId: 'W1', bucketId: 'B1', objectKey: 'safe.txt' }
  });
  const t2 = buildStorageUnifiedAuditEvent({
    eventType: 'storage.object.get',
    operationCategory: 'data_plane',
    operationType: 'object.get',
    actorId: 'usr_02',
    actorType: 'user',
    outcome: 'success',
    resourceScope: { tenantId: 'T2', workspaceId: 'W2', bucketId: 'B2', objectKey: 'leak.txt' }
  });

  const result = await queryStorageAuditTrail({
    actorId: 'usr_owner',
    actorType: 'tenant_owner',
    tenantId: 'T1',
    workspaceId: 'W1',
    publishAuditEvent() {},
    async queryAuditRecords() {
      return {
        items: [t1, t2, t1],
        cursor: null,
        total: 3
      };
    }
  }, {
    tenantId: 'T1'
  });

  assert.equal(result.items.length, 2);
  assert.equal(result.items.every((item) => item.resourceScope.tenantId === 'T1'), true);
  assert.equal(result.items.some((item) => item.resourceScope.tenantId === 'T2'), false);
});
