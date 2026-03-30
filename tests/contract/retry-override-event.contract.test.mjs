import test from 'node:test';
import assert from 'node:assert/strict';
import schema from '../../services/internal-contracts/src/retry-override-event.json' with { type: 'json' };
import { buildRetryOverrideEvent } from '../../services/provisioning-orchestrator/src/events/async-operation-events.mjs';

function validate(event) { for (const key of schema.required) assert.notEqual(event[key], undefined); }

test('retry override event validates', () => validate(buildRetryOverrideEvent({ overrideId: '11111111-1111-1111-1111-111111111111', operationId: '22222222-2222-2222-2222-222222222222', flagId: '33333333-3333-3333-3333-333333333333', tenantId: 't', superadminId: 'sa', justification: 'long enough justification', attemptNumber: 6, newCorrelationId: 'corr' })));
test('all required fields exist', () => assert.throws(() => validate({})));