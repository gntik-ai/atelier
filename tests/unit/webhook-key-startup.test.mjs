import test from 'node:test';
import assert from 'node:assert/strict';
import { listenAfterRequiredGates } from '../../apps/control-plane/control-plane-startup.mjs';
import { sanitizedWebhookBootstrapError } from '../../apps/control-plane/webhook-key-runtime.mjs';
import { TEST_WEBHOOK_KEY_CONTEXT } from '../helpers/webhook-key.mjs';

test('schema and verified key context complete before listen exactly once', async () => {
  const order = [];
  let configured;
  await listenAfterRequiredGates({
    applySchema: async () => order.push('schema'),
    resolveWebhookKey: async () => { order.push('key'); return TEST_WEBHOOK_KEY_CONTEXT; },
    configureWebhookKey: (context) => { configured = context; order.push('configure'); },
    listen: async () => order.push('listen'),
  });
  assert.deepEqual(order, ['schema', 'key', 'configure', 'listen']);
  assert.strictEqual(configured, TEST_WEBHOOK_KEY_CONTEXT);
});

test('schema or key failure prevents configure and listen', async () => {
  for (const failureAt of ['schema', 'key']) {
    const calls = [];
    await assert.rejects(listenAfterRequiredGates({
      applySchema: async () => { calls.push('schema'); if (failureAt === 'schema') throw new Error('raw database detail'); },
      resolveWebhookKey: async () => { calls.push('key'); throw Object.assign(new Error('raw key detail'), { code: 'WEBHOOK_KEY_FORMAT_INVALID' }); },
      configureWebhookKey: () => calls.push('configure'),
      listen: async () => calls.push('listen'),
    }));
    assert.equal(calls.includes('configure'), false);
    assert.equal(calls.includes('listen'), false);
  }
});

test('bootstrap error sanitizer never returns raw database, key, or environment detail', () => {
  assert.equal(sanitizedWebhookBootstrapError({ code: 'WEBHOOK_KEY_FORMAT_INVALID', message: 'material' }), 'WEBHOOK_KEY_FORMAT_INVALID');
  assert.equal(sanitizedWebhookBootstrapError({ code: 'WEBHOOK_KEY_CONTEXT_NOT_VERIFIED', message: 'state detail' }), 'WEBHOOK_KEY_CONTEXT_NOT_VERIFIED');
  assert.equal(sanitizedWebhookBootstrapError({ code: 'WEBHOOK_DATABASE_PRINCIPALS_INVALID', message: 'role details' }), 'WEBHOOK_DATABASE_PRINCIPALS_INVALID');
  assert.equal(sanitizedWebhookBootstrapError({ code: 'WEBHOOK_DATABASE_PRINCIPALS_REQUIRED', message: 'DSN detail' }), 'WEBHOOK_DATABASE_PRINCIPALS_REQUIRED');
  assert.equal(sanitizedWebhookBootstrapError({ code: 'WEBHOOK_POSTGRESQL_16_REQUIRED', message: 'catalog detail' }), 'WEBHOOK_POSTGRESQL_16_REQUIRED');
  assert.equal(sanitizedWebhookBootstrapError({ code: '23505', message: 'SQL and parameters' }), 'WEBHOOK_KEY_BOOTSTRAP_FAILED');
  assert.equal(sanitizedWebhookBootstrapError(new Error('raw environment value')), 'WEBHOOK_KEY_BOOTSTRAP_FAILED');
});
