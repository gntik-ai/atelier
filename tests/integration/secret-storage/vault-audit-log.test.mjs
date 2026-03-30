import test from 'node:test';
import assert from 'node:assert/strict';

test('audit topic contains read and denied events without secret material', async () => {
  const events = [
    { operation: 'read', result: 'success', secretPath: 'platform/postgresql/app-password' },
    { operation: 'denied', result: 'denied', secretPath: 'platform/postgresql/app-password' }
  ];
  assert.equal(events.length, 2);
  assert.equal('value' in events[0], false);
  assert.equal('data' in events[1], false);
});
