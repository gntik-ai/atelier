import test from 'node:test';
import assert from 'node:assert/strict';
import schema from '../../services/internal-contracts/src/manual-intervention-required-event.json' with { type: 'json' };
import { buildManualInterventionRequiredEvent } from '../../services/provisioning-orchestrator/src/events/async-operation-events.mjs';

function validate(event) { for (const key of schema.required) assert.notEqual(event[key], undefined); }

test('manual intervention event validates', () => validate(buildManualInterventionRequiredEvent({ operationId: '11111111-1111-1111-1111-111111111111', flagId: '22222222-2222-2222-2222-222222222222', tenantId: 't', actorId: 'a', reason: 'need help', attemptCountAtFlag: 5, lastErrorCode: 'E', correlationId: 'c' })));
test('missing required field throws', () => assert.throws(() => validate({})));