import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../../services/provisioning-orchestrator/src/actions/async-operation-intervention-notify.mjs';

const flag = { flag_id: 'flag', operation_id: 'op', tenant_id: 't', actor_id: 'actor', last_error_summary: 'boom' };

test('first notification emits two events', async () => {
  const sent = [];
  const result = await main({ operation_id: 'op' }, { db: {}, findByOperationId: async () => flag, findByIdAnyTenant: async () => ({ operation_type: 'create-workspace', failure_suggested_actions: ['retry'], correlation_id: 'corr' }), updateLastNotificationAt: async () => {}, publishInterventionNotificationEvent: async (_p, payload) => sent.push(payload) });
  assert.equal(result.statusCode, 200); assert.equal(sent.length, 2);
});

test('within debounce window emits no event', async () => {
  const sent = [];
  const result = await main({ operation_id: 'op' }, { db: {}, findByOperationId: async () => ({ ...flag, last_notification_at: new Date().toISOString() }), publishInterventionNotificationEvent: async (_p, payload) => sent.push(payload) });
  assert.equal(result.statusCode, 202); assert.equal(sent.length, 0);
});

test('past debounce window emits again', async () => {
  const sent = [];
  const result = await main({ operation_id: 'op' }, { db: {}, findByOperationId: async () => ({ ...flag, last_notification_at: new Date(Date.now() - 16 * 60_000).toISOString() }), findByIdAnyTenant: async () => ({ operation_type: 'x', correlation_id: 'corr' }), updateLastNotificationAt: async () => {}, publishInterventionNotificationEvent: async (_p, payload) => sent.push(payload) });
  assert.equal(result.statusCode, 200); assert.equal(sent.length, 2);
});

test('tenant actor missing still emits superadmin notification', async () => {
  const sent = [];
  const result = await main({ operation_id: 'op' }, { db: {}, findByOperationId: async () => ({ ...flag, actor_id: null }), findByIdAnyTenant: async () => ({ operation_type: 'x', correlation_id: 'corr' }), updateLastNotificationAt: async () => {}, publishInterventionNotificationEvent: async (_p, payload) => sent.push(payload) });
  assert.equal(result.statusCode, 200); assert.equal(sent.length, 1);
});

test('debounce 0 always emits', async () => {
  process.env.INTERVENTION_NOTIFICATION_DEBOUNCE_MINUTES = '0';
  const sent = [];
  await main({ operation_id: 'op' }, { db: {}, findByOperationId: async () => ({ ...flag, last_notification_at: new Date().toISOString() }), findByIdAnyTenant: async () => ({ operation_type: 'x', correlation_id: 'corr' }), updateLastNotificationAt: async () => {}, publishInterventionNotificationEvent: async (_p, payload) => sent.push(payload) });
  assert.equal(sent.length, 2);
  delete process.env.INTERVENTION_NOTIFICATION_DEBOUNCE_MINUTES;
});
