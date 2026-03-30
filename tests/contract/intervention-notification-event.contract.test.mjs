import test from 'node:test';
import assert from 'node:assert/strict';
import schema from '../../services/internal-contracts/src/intervention-notification-event.json' with { type: 'json' };
import { buildInterventionNotificationEvent } from '../../services/provisioning-orchestrator/src/events/async-operation-events.mjs';

function validate(event) { for (const key of schema.required) assert.notEqual(event[key], undefined); assert.ok(Array.isArray(event.suggestedActions)); }
for (const role of ['tenant_owner', 'superadmin']) {
  test(`notification event validates ${role}`, () => validate(buildInterventionNotificationEvent({ operationId: '11111111-1111-1111-1111-111111111111', flagId: '22222222-2222-2222-2222-222222222222', tenantId: 't', recipientActorId: 'u', recipientRole: role, operationType: 'create-workspace', failureSummary: 'boom', suggestedActions: ['fix'], correlationId: 'c' })));
}
