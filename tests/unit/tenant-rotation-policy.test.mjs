import test from 'node:test';
import assert from 'node:assert/strict';
import { enforceRotationPolicy } from '../../services/provisioning-orchestrator/src/models/tenant-rotation-policy.mjs';

test('enforceRotationPolicy rejects values above the configured max', () => {
  assert.throws(() => enforceRotationPolicy({ max_grace_period_seconds: 60 }, 61), /exceeds policy limit/);
});

test('enforceRotationPolicy allows values within the configured max', () => {
  assert.doesNotThrow(() => enforceRotationPolicy({ max_grace_period_seconds: 60 }, 60));
  assert.doesNotThrow(() => enforceRotationPolicy(null, 3600));
});
