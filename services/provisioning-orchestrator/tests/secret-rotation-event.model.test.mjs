import test from 'node:test';
import assert from 'node:assert/strict';
import { createRotationEventRecord, validateRotationEvent } from '../src/models/secret-rotation-event.mjs';

test('validateRotationEvent accepts all known types', () => {
  for (const eventType of ['initiated','grace_started','consumer_reload_requested','consumer_reload_confirmed','consumer_reload_timeout','grace_expired','revoked','revoke_confirmed','rotation_failed']) {
    assert.equal(validateRotationEvent({ secretPath: 'platform/a', domain: 'platform', eventType, actorId: 'u1', detail: {} }), true);
  }
});

test('validateRotationEvent rejects unknown type', () => {
  assert.throws(() => validateRotationEvent({ secretPath: 'platform/a', domain: 'platform', eventType: 'nope', actorId: 'u1', detail: {} }));
});

test('createRotationEventRecord returns normalized record', () => {
  const record = createRotationEventRecord({ secretPath: 'platform/a', domain: 'platform', eventType: 'initiated', actorId: 'u1', detail: {} });
  assert.equal(record.eventType, 'initiated');
});
