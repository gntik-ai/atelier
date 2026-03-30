import test from 'node:test';
import assert from 'node:assert/strict';
import * as audit from '../../services/webhook-engine/src/webhook-audit.mjs';

const ctx = { tenantId: 't1', workspaceId: 'w1', actorId: 'u1' };

test('audit builders contain required fields and no secrets', () => {
  for (const fn of Object.values(audit)) {
    const event = fn(ctx, 'r1');
    assert.equal(event.tenantId, 't1');
    assert.equal(event.workspaceId, 'w1');
    assert.equal(event.actorId, 'u1');
    assert.equal(event.resourceId, 'r1');
    assert.ok(event.action);
    assert.ok(event.timestamp);
    assert.equal('signingSecret' in event, false);
    assert.equal('rawPayload' in event, false);
  }
});
