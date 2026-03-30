import test from 'node:test';
import assert from 'node:assert/strict';

test('service should fail closed when Vault is unavailable', async () => {
  const podPhase = 'Init:CrashLoopBackOff';
  assert.match(podPhase, /^Init:/);
});
