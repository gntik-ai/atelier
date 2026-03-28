import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStorageEventGovernanceProfile,
  buildStorageEventNotificationAuditEvent,
  buildStorageEventNotificationRule,
  checkStorageEventNotificationCapability,
  evaluateStorageEventNotifications,
  matchStorageEventNotificationRule,
  storageEventNotificationAuditActions,
  storageEventNotificationCapabilityId,
  storageEventNotificationDestinationTypes,
  storageEventNotificationErrorCodes,
  storageEventNotificationEventTypes,
  validateStorageEventNotificationRule
} from '../../services/adapters/src/provider-catalog.mjs';
import { buildStorageProviderProfile } from '../../services/adapters/src/storage-provider-profile.mjs';

function makeSupportedProfile() {
  const profile = buildStorageProviderProfile({ providerType: 'minio' });
  profile.capabilityDetails = [
    ...profile.capabilityDetails,
    {
      capabilityId: storageEventNotificationCapabilityId,
      required: false,
      state: 'satisfied',
      summary: 'Storage event notifications are supported.',
      constraints: []
    }
  ];
  return profile;
}

test('provider catalog exposes storage event notification exports', () => {
  for (const value of [
    buildStorageEventGovernanceProfile,
    buildStorageEventNotificationRule,
    buildStorageEventNotificationAuditEvent,
    checkStorageEventNotificationCapability,
    validateStorageEventNotificationRule,
    matchStorageEventNotificationRule,
    evaluateStorageEventNotifications,
    storageEventNotificationDestinationTypes,
    storageEventNotificationEventTypes,
    storageEventNotificationAuditActions,
    storageEventNotificationErrorCodes,
    storageEventNotificationCapabilityId
  ]) {
    assert.notEqual(value, undefined);
  }
});

test('provider catalog validates and evaluates notification rules through additive wrappers', () => {
  const providerProfile = makeSupportedProfile();
  const governance = buildStorageEventGovernanceProfile({
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    allowedDestinationTypes: ['kafka_topic', 'openwhisk_action'],
    maxTenantRules: 5,
    currentTenantRuleCount: 0,
    maxWorkspaceRules: 5,
    currentWorkspaceRuleCount: 0
  });
  const validation = validateStorageEventNotificationRule({
    ruleInput: {
      tenantId: 'ten_01',
      workspaceId: 'wrk_01',
      bucketId: 'bucket_01',
      destinationType: storageEventNotificationDestinationTypes.KAFKA_TOPIC,
      destinationRef: 'topic.storage.events',
      eventTypes: [storageEventNotificationEventTypes.OBJECT_CREATED]
    },
    providerProfile,
    governanceProfile: governance
  });
  const match = matchStorageEventNotificationRule({
    rule: validation.rule,
    event: {
      tenantId: 'ten_01',
      workspaceId: 'wrk_01',
      bucketId: 'bucket_01',
      eventType: storageEventNotificationEventTypes.OBJECT_CREATED,
      objectKey: 'uploads/file.jpg'
    },
    providerProfile
  });
  const evaluation = evaluateStorageEventNotifications({
    rules: [validation.rule],
    event: {
      tenantId: 'ten_01',
      workspaceId: 'wrk_01',
      bucketId: 'bucket_01',
      eventType: storageEventNotificationEventTypes.OBJECT_CREATED,
      objectKey: 'uploads/file.jpg'
    },
    providerProfile
  });

  assert.equal(checkStorageEventNotificationCapability({ providerProfile }).allowed, true);
  assert.equal(validation.valid, true);
  assert.equal(match.matched, true);
  assert.equal(evaluation.matches.length, 1);
});

test('Garage event-notification capability degrades predictably when unsupported', () => {
  const providerProfile = buildStorageProviderProfile({ providerType: 'garage' });
  const capability = checkStorageEventNotificationCapability({ providerProfile });
  const rule = buildStorageEventNotificationRule({
    ruleId: 'sen_garage_01',
    tenantId: 'ten_01',
    workspaceId: 'wrk_01',
    bucketId: 'bucket_01',
    destinationType: storageEventNotificationDestinationTypes.KAFKA_TOPIC,
    destinationRef: 'topic.storage.events',
    eventTypes: [storageEventNotificationEventTypes.OBJECT_CREATED]
  });
  const evaluation = evaluateStorageEventNotifications({
    rules: [rule],
    event: {
      tenantId: 'ten_01',
      workspaceId: 'wrk_01',
      bucketId: 'bucket_01',
      eventType: storageEventNotificationEventTypes.OBJECT_CREATED,
      objectKey: 'uploads/file.jpg'
    },
    providerProfile
  });

  assert.equal(capability.allowed, false);
  assert.equal(capability.satisfactionState, 'unsatisfied');
  assert.equal(capability.errorEnvelope.code, 'CAPABILITY_NOT_AVAILABLE');
  assert.equal(capability.errorEnvelope.httpStatus, 501);
  assert.equal(capability.errorEnvelope.missingCapabilityId, storageEventNotificationCapabilityId);
  assert.equal(evaluation.supported, false);
  assert.equal(evaluation.allowed, false);
  assert.equal(evaluation.matches.length, 0);
  assert.deepEqual(evaluation.nonMatches, [{ ruleId: 'sen_garage_01', reasons: ['capability_not_available'] }]);
});
