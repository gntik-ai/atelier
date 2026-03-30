import test from 'node:test';
import assert from 'node:assert/strict';
import schema from '../../services/internal-contracts/src/failure-classified-event.json' with { type: 'json' };
import { buildFailureClassifiedEvent } from '../../services/provisioning-orchestrator/src/events/async-operation-events.mjs';

function validate(event, schemaDef) { for (const key of schemaDef.required) assert.notEqual(event[key], undefined); }
for (const category of ['transient', 'permanent', 'requires_intervention', 'unknown']) {
  test(`failure classified event schema validates ${category}`, () => validate(buildFailureClassifiedEvent({ operationId: '11111111-1111-1111-1111-111111111111', tenantId: 't', actorId: 'a', failureCategory: category, errorCode: 'E', attemptCount: 1, maxRetries: 5, correlationId: 'c' }), schema));
}
test('missing required field throws through validator', () => { assert.throws(() => validate({ eventType: 'x' }, schema)); });
