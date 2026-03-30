import test from 'node:test';
import assert from 'node:assert/strict';
import { main } from '../src/actions/secret-rotation-propagation-timeout-sweep.mjs';

test('timeout sweep marks old pending rows', async () => {
  let timeouts = 0;
  const events = [];
  const result = await main({
    db: {},
    repo: {
      async listTimedOutPropagations() { return [{ id: '1', consumer_id: 'apisix', secret_path: 'platform/a', vault_version: 1 }]; },
      async markPropagationTimeout() { timeouts += 1; },
      async getVersionByVaultVersion() { return { domain: 'platform', tenant_id: null }; },
      async insertRotationEvent() {}
    },
    publishEvent: async (name) => events.push(name)
  });
  assert.equal(result.processed, 1);
  assert.equal(timeouts, 1);
  assert.equal(events[0], 'console.secrets.consumer.reload-timeout');
});
