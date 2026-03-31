import fs from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { seedFixturePlans } from './fixtures/seed-plans.mjs';
import { teardownAll } from './fixtures/teardown.mjs';
import { createConsumer, disconnectConsumer } from './helpers/kafka-consumer.mjs';
import { assertVerificationResultShape } from './helpers/assertion-helpers.mjs';

const requiredEnv = ['TEST_API_BASE_URL', 'TEST_SUPERADMIN_TOKEN', 'TEST_PG_DSN'];
const runId = randomUUID();
const scenarioResults = [];
let consumer = null;

for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.warn(`warning: ${key} is not set; full E2E scenarios will self-skip until the integration environment is configured.`);
  }
}

before(async () => {
  if (process.env.TEST_SUPERADMIN_TOKEN && process.env.TEST_API_BASE_URL) {
    await seedFixturePlans(process.env.TEST_SUPERADMIN_TOKEN);
  }
  consumer = await createConsumer();
});

after(async () => {
  if (process.env.TEST_SUPERADMIN_TOKEN && process.env.TEST_API_BASE_URL) {
    await teardownAll([], process.env.TEST_SUPERADMIN_TOKEN);
  }
  await disconnectConsumer(consumer);
  const summary = {
    runId,
    timestamp: new Date().toISOString(),
    scenarios: scenarioResults,
    summary: {
      total: scenarioResults.length,
      passed: scenarioResults.filter((item) => item.result === 'PASS').length,
      failed: scenarioResults.filter((item) => item.result === 'FAIL').length
    }
  };
  assertVerificationResultShape(summary);
  const text = `${JSON.stringify(summary, null, 2)}\n`;
  if (process.env.TEST_RESULT_OUTPUT_PATH) {
    await fs.mkdir(new URL('.', `file://${process.env.TEST_RESULT_OUTPUT_PATH}`).pathname, { recursive: true }).catch(() => {});
    await fs.writeFile(process.env.TEST_RESULT_OUTPUT_PATH, text, 'utf8');
  } else {
    process.stdout.write(text);
  }
});

test('suite metadata', () => {
  scenarioResults.push({ id: 'suite-metadata', result: 'PASS', durationMs: 0 });
});

await import('./scenarios/upgrade-preserves-resources.test.mjs');
await import('./scenarios/downgrade-surfaces-overlimit.test.mjs');
await import('./scenarios/audit-trail-verification.test.mjs');
await import('./scenarios/multitenant-isolation.test.mjs');
await import('./scenarios/round-trip-transition.test.mjs');
await import('./scenarios/edge-cases.test.mjs');
