import test from 'node:test';
import assert from 'node:assert/strict';
import * as audit from '../../services/scheduling-engine/src/audit.mjs';

const builders = [
  audit.jobCreatedEvent,
  audit.jobUpdatedEvent,
  audit.jobPausedEvent,
  audit.jobResumedEvent,
  audit.jobDeletedEvent,
  audit.jobErroredEvent,
  audit.executionSucceededEvent,
  audit.executionFailedEvent,
  audit.executionTimedOutEvent,
  audit.executionMissedEvent,
  audit.capabilityToggledEvent,
  audit.quotaExceededEvent,
];

test('all audit builders return required fields and no payload leakage', () => {
  for (const builder of builders) {
    const event = builder({ tenantId: 't1', workspaceId: 'w1', actorId: 'u1', resourceId: 'r1', metadata: { enabled: true, pausedJobCount: 2 } });
    assert.ok(event.timestamp);
    assert.equal(event.tenantId, 't1');
    assert.equal(event.workspaceId, 'w1');
    assert.equal(event.actorId, 'u1');
    assert.equal(event.resourceId, 'r1');
    assert.equal('payload' in event, false);
  }
});
