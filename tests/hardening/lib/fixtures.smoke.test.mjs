import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createIsolatedFixture, teardownFixture } from './fixtures.mjs';

const infraConfigured = Boolean(process.env.APISIX_BASE_URL && process.env.SUPERADMIN_TOKEN) && process.env.HARDENING_SKIP_INFRA !== 'true';

test('smoke: createIsolatedFixture retorna estructura correcta', { skip: infraConfigured ? false : 'infrastructure not configured' }, async () => {
  const runId = randomUUID();
  const fixture = await createIsolatedFixture(runId);
  assert.equal(fixture.runId, runId);
  assert.ok(fixture.tenantId);
  assert.ok(fixture.workspaceId);
  assert.ok(fixture.credentials.validApiKey);
  assert.ok(fixture.secrets.activeSecretPath);
  await teardownFixture(runId);
});

test('smoke: teardownFixture completa sin errores tras create', { skip: infraConfigured ? false : 'infrastructure not configured' }, async () => {
  const runId = randomUUID();
  await createIsolatedFixture(runId);
  await teardownFixture(runId);
  await teardownFixture(runId);
});

test('smoke: teardownFixture es no-op si fixture no existe', async () => {
  await teardownFixture(randomUUID());
});
