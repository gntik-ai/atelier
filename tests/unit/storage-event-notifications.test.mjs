import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STORAGE_EVENT_NOTIFICATION_AUDIT_ACTIONS,
  STORAGE_EVENT_NOTIFICATION_CAPABILITY_ID,
  STORAGE_EVENT_NOTIFICATION_DESTINATION_TYPES,
  STORAGE_EVENT_NOTIFICATION_ERROR_CODES,
  STORAGE_EVENT_NOTIFICATION_EVENT_TYPES,
  buildStorageEventGovernanceProfile,
  buildStorageEventNotificationAuditEvent,
  buildStorageEventNotificationRule,
  checkStorageEventNotificationCapability,
  evaluateStorageEventNotifications,
  matchStorageEventNotificationRule,
  validateStorageEventNotificationRule
} from '../../services/adapters/src/storage-event-notifications.mjs';
import { STORAGE_NORMALIZED_ERROR_CODES } from '../../services/adapters/src/storage-error-taxonomy.mjs';
import { buildStorageProviderProfile } from '../../services/adapters/src/storage-provider-profile.mjs';

function makeSupportedProfile() {
  const profile = buildStorageProviderProfile({ providerType: 'minio' });
  profile.capabilityDetails = [
    ...profile.capabilityDetails,
    {
      capabilityId: STORAGE_EVENT_NOTIFICATION_CAPABILITY_ID,
      required: false,
      state: 'satisfied',
      summary: 'Storage event notifications are supported.',
      constraints: []
    }
  ];
  return profile;
}

function makeUnsupportedProfile() {
  return buildStorageProviderProfile({ providerType: 'minio' });
}

test('storage event notification catalogs are frozen and additive', () => {
  assert.equal(Object.isFrozen(STORAGE_EVENT_NOTIFICATION_DESTINATION_TYPES), true);
  assert.equal(Object.isFrozen(STORAGE_EVENT_NOTIFICATION_EVENT_TYPES), true);
  assert.equal(Object.isFrozen(STORAGE_EVENT_NOTIFICATION_AUDIT_ACTIONS), true);
  assert.equal(Object.isFrozen(STORAGE_EVENT_NOTIFICATION_ERROR_CODES), true);
  assert.equal(STORAGE_EVENT_NOTIFICATION_CAPABILITY_ID, 'bucket.event_notifications');
  assert.equal(STORAGE_EVENT_NOTIFICATION_ERROR_CODES.CAPABILITY_NOT_AVAILABLE.normalizedCode, STORAGE_NORMALIZED_ERROR_CODES.STORAGE_PRECONDITION_FAILED);
  assert.equal(STORAGE_EVENT_NOTIFICATION_ERROR_CODES.DESTINATION_NOT_ALLOWED.normalizedCode, STORAGE_NORMALIZED_ERROR_CODES.STORAGE_ACCESS_DENIED);
  assert.equal(STORAGE_EVENT_NOTIFICATION_ERROR_CODES.RULE_LIMIT_EXCEEDED.normalizedCode, STORAGE_NORMALIZED_ERROR_CODES.STORAGE_QUOTA_EXCEEDED);
  assert.equal(STORAGE_EVENT_NOTIFICATION_ERROR_CODES.INVALID_RULE.normalizedCode, STORAGE_NORMALIZED_ERROR_CODES.STORAGE_INVALID_REQUEST);
});

test('capability check allows explicit satisfied capability and rejects missing capability', () => {
  const allowed = checkStorageEventNotificationCapability({ providerProfile: makeSupportedProfile() });
  const denied = checkStorageEventNotificationCapability({ providerProfile: makeUnsupportedProfile() });

  assert.equal(allowed.allowed, true);
  assert.equal(denied.allowed, false);
  assert.equal(denied.errorEnvelope.missingCapabilityId, STORAGE_EVENT_NOTIFICATION_CAPABILITY_ID);
  assert.equal(denied.errorEnvelope.httpStatus, 501);
});

test('governance profile computes destination entitlements and remaining rules', () => {
  const profile = buildStorageEventGovernanceProfile({
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    allowedDestinationTypes: ['kafka_topic', 'openwhisk_action', 'invalid'],
    maxTenantRules: 5,
    currentTenantRuleCount: 2,
    maxWorkspaceRules: 3,
    currentWorkspaceRuleCount: 1
  });

  assert.deepEqual(profile.allowedDestinationTypes, ['kafka_topic', 'openwhisk_action']);
  assert.equal(profile.tenantLimits.remainingRules, 3);
  assert.equal(profile.workspaceLimits.remainingRules, 2);
  assert.equal(Object.isFrozen(profile), true);
});

test('validateStorageEventNotificationRule accepts a supported Kafka rule', () => {
  const result = validateStorageEventNotificationRule({
    ruleInput: {
      tenantId: 'ten_01',
      workspaceId: 'wrk_01',
      bucketId: 'bucket_01',
      destinationType: 'kafka_topic',
      destinationRef: 'topic.storage.events',
      eventTypes: ['object.created'],
      filters: { prefix: 'uploads/' },
      actorRef: 'usr_01'
    },
    providerProfile: makeSupportedProfile(),
    governanceProfile: buildStorageEventGovernanceProfile({
      tenantId: 'ten_01',
      workspaceId: 'wrk_01',
      allowedDestinationTypes: ['kafka_topic'],
      maxTenantRules: 10,
      currentTenantRuleCount: 2,
      maxWorkspaceRules: 10,
      currentWorkspaceRuleCount: 1
    })
  });

  assert.equal(result.valid, true);
  assert.equal(result.rule.destinationType, STORAGE_EVENT_NOTIFICATION_DESTINATION_TYPES.KAFKA_TOPIC);
  assert.deepEqual(result.rule.eventTypes, [STORAGE_EVENT_NOTIFICATION_EVENT_TYPES.OBJECT_CREATED]);
});

test('validateStorageEventNotificationRule rejects disallowed destination and quota exhaustion', () => {
  const result = validateStorageEventNotificationRule({
    ruleInput: {
      tenantId: 'ten_01',
      workspaceId: 'wrk_01',
      bucketId: 'bucket_01',
      destinationType: 'openwhisk_action',
      destinationRef: 'pkg/process-image',
      eventTypes: ['multipart.completed']
    },
    providerProfile: makeSupportedProfile(),
    governanceProfile: buildStorageEventGovernanceProfile({
      tenantId: 'ten_01',
      workspaceId: 'wrk_01',
      allowedDestinationTypes: ['kafka_topic'],
      maxTenantRules: 1,
      currentTenantRuleCount: 1,
      maxWorkspaceRules: 1,
      currentWorkspaceRuleCount: 1
    })
  });

  assert.equal(result.valid, false);
  assert.equal(result.violations.some((entry) => entry.code === 'DESTINATION_NOT_ALLOWED'), true);
  assert.equal(result.violations.some((entry) => entry.code === 'RULE_LIMIT_EXCEEDED'), true);
});

test('matchStorageEventNotificationRule enforces scope and filters', () => {
  const rule = buildStorageEventNotificationRule({
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    bucketId: 'bucket_01',
    destinationType: 'kafka_topic',
    destinationRef: 'topic.storage.events',
    eventTypes: ['object.created'],
    filters: { prefix: 'uploads/', suffix: '.jpg' }
  });

  const match = matchStorageEventNotificationRule({
    rule,
    event: {
      tenantId: 'ten_01',
      workspaceId: 'wrk_01',
      bucketId: 'bucket_01',
      eventType: 'object.created',
      objectKey: 'uploads/photo.jpg'
    },
    providerProfile: makeSupportedProfile()
  });
  const miss = matchStorageEventNotificationRule({
    rule,
    event: {
      tenantId: 'ten_01',
      workspaceId: 'wrk_01',
      bucketId: 'bucket_01',
      eventType: 'object.created',
      objectKey: 'uploads/photo.png'
    },
    providerProfile: makeSupportedProfile()
  });

  assert.equal(match.matched, true);
  assert.equal(miss.matched, false);
  assert.equal(miss.reasons.includes('key_filter_mismatch'), true);
});

test('evaluateStorageEventNotifications returns stable delivery previews for matching rules', () => {
  const rules = [
    buildStorageEventNotificationRule({
      ruleId: 'sen_01',
      tenantId: 'ten_01',
      workspaceId: 'wrk_01',
      bucketId: 'bucket_01',
      destinationType: 'kafka_topic',
      destinationRef: 'topic.storage.events',
      eventTypes: ['object.created']
    }),
    buildStorageEventNotificationRule({
      ruleId: 'sen_02',
      tenantId: 'ten_01',
      workspaceId: 'wrk_01',
      bucketId: 'bucket_01',
      destinationType: 'openwhisk_action',
      destinationRef: 'pkg/process-image',
      eventTypes: ['object.created'],
      filters: { prefix: 'uploads/' }
    }),
    buildStorageEventNotificationRule({
      ruleId: 'sen_03',
      tenantId: 'ten_01',
      workspaceId: 'wrk_01',
      bucketId: 'bucket_02',
      destinationType: 'kafka_topic',
      destinationRef: 'topic.other',
      eventTypes: ['object.created']
    })
  ];

  const result = evaluateStorageEventNotifications({
    rules,
    event: {
      tenantId: 'ten_01',
      workspaceId: 'wrk_01',
      bucketId: 'bucket_01',
      eventType: 'object.created',
      objectKey: 'uploads/photo.jpg',
      correlationId: 'cor_01',
      occurredAt: '2026-03-28T00:10:00Z'
    },
    providerProfile: makeSupportedProfile(),
    evaluatedAt: '2026-03-28T00:10:01Z'
  });

  assert.equal(result.supported, true);
  assert.equal(result.matches.length, 2);
  assert.deepEqual(result.matches.map((entry) => entry.ruleId), ['sen_01', 'sen_02']);
  assert.equal(result.nonMatches.some((entry) => entry.ruleId === 'sen_03'), true);
});

test('buildStorageEventNotificationAuditEvent redacts url-like and secret-like values', () => {
  const rule = buildStorageEventNotificationRule({
    ruleId: 'sen_01',
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    bucketId: 'bucket_01',
    destinationType: 'kafka_topic',
    destinationRef: 'https://broker.internal/topic.storage.events',
    eventTypes: ['object.created'],
    actorRef: 'user https://internal',
    correlationId: 'secret://corr/01'
  });
  const evaluation = evaluateStorageEventNotifications({
    rules: [rule],
    event: {
      tenantId: 'ten_01',
      workspaceId: 'wrk_01',
      bucketId: 'bucket_01',
      eventType: 'object.created',
      objectKey: 'uploads/file.jpg',
      actorRef: 'secret://user/01',
      correlationId: 'https://corr/id'
    },
    providerProfile: makeSupportedProfile()
  });
  const event = buildStorageEventNotificationAuditEvent({
    action: STORAGE_EVENT_NOTIFICATION_AUDIT_ACTIONS.DELIVERY_PREVIEWED,
    deliveryPreview: evaluation.matches[0],
    rule,
    actorRef: 'https://sensitive.example/user',
    correlationId: 'secret://trace/01'
  });
  const payload = JSON.stringify(event);

  assert.equal(/https?:\/\//.test(payload), false);
  assert.equal(/secret:\/\//.test(payload), false);
  assert.equal(Object.isFrozen(event), true);
});
