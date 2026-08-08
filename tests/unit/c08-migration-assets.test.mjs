import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';

import { GOVERNANCE_MIGRATIONS, forwardMigration } from '../../apps/control-plane/governance-schema.mjs';

const execFileAsync = promisify(execFile);
const root = new URL('../../', import.meta.url);

test('C-08 migration is additive in the authoritative boot list after billing storage', async () => {
  const migration = 'packages/provisioning-orchestrator/src/migrations/123-c08-platform-governance-registry.sql';
  assert.ok(GOVERNANCE_MIGRATIONS.includes('packages/provisioning-orchestrator/src/migrations/119-billing-usage-records.sql'));
  assert.ok(GOVERNANCE_MIGRATIONS.includes(migration));
  assert.ok(GOVERNANCE_MIGRATIONS.indexOf(migration) > GOVERNANCE_MIGRATIONS.indexOf('packages/provisioning-orchestrator/src/migrations/119-billing-usage-records.sql'));
  const sql = await readFile(new URL(`../../${migration}`, import.meta.url), 'utf8');
  const up = forwardMigration(sql);
  assert.match(up, /CREATE TABLE IF NOT EXISTS platform_governance_entities/);
  assert.match(up, /CREATE TABLE IF NOT EXISTS platform_governance_idempotency/);
  assert.match(up, /CREATE TABLE IF NOT EXISTS platform_governance_audit/);
  assert.match(up, /CREATE TABLE IF NOT EXISTS function_audit_outbox/);
  assert.match(up, /idx_function_audit_outbox_pending/);
  assert.match(up, /CREATE TABLE IF NOT EXISTS function_audit_intents/);
  assert.match(up, /idx_function_audit_intents_recovery/);
  assert.doesNotMatch(up, /DROP TABLE/i);
});

test('migration assistant defaults to a no-database dry run', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    'scripts/c08-platform-governance-migration.mjs'
  ], { cwd: root, env: { ...process.env, DATABASE_URL: '' } });
  assert.equal(stderr, '');
  const output = JSON.parse(stdout);
  assert.equal(output.mode, 'dry-run');
  assert.equal(output.databaseConnected, false);
  assert.equal(output.clusterApplied, false);
});

test('runtime overlay and image package every C-08 local module', async () => {
  const overlay = JSON.parse(await readFile(new URL('../../apps/control-plane/route-map.runtime.json', import.meta.url), 'utf8'));
  const c08 = overlay.filter((route) => [
    'getFunctionAuditCoverage', 'listFunctionDeploymentAudit', 'listFunctionQuotaEnforcement',
    'listFunctionRollbackEvidence', 'getTenantAuditCorrelation', 'getWorkspaceAuditCorrelation',
    'getWorkspaceEventDashboards', 'getWorkspaceGatewayStreamMetrics', 'getWorkspaceKafkaTopicMetrics',
    'listBillingUsageRecords', 'listTenantBillingUsageRecords', 'createDeploymentProfileRecord',
    'getDeploymentProfileRecord', 'createCommercialPlan', 'getCommercialPlan', 'createQuotaPolicy',
    'getQuotaPolicy', 'createProviderCapabilityRecord', 'getProviderCapabilityRecord', 'getRouteCatalog',
    'getStorageProviderIntrospection', 'listTopologyRegions', 'createPlatformUser', 'getPlatformUser',
    'getTenantGovernanceDashboard'
  ].includes(route.operationId));
  assert.equal(c08.length, 25);
  assert.ok(c08.every((route) => route.auth === 'authenticated' && route.localHandler));
  const dockerfile = await readFile(new URL('../../apps/control-plane/Dockerfile', import.meta.url), 'utf8');
  for (const file of [
    'c08-authz.mjs', 'c08-contracts.mjs', 'c08-schema.mjs', 'c08-governance-handlers.mjs',
    'c08-observability-handlers.mjs', 'c08-function-audit-handlers.mjs',
    'c08-dashboard-handler.mjs', 'platform-discovery-handlers.mjs', 'platform-governance-store.mjs'
  ]) assert.match(dockerfile, new RegExp(file.replaceAll('.', '\\.')));
  assert.match(dockerfile, /COPY packages\/adapters/);
  assert.match(dockerfile, /COPY packages\/event-gateway/);
  assert.match(dockerfile, /ln -sfn \/repo\/packages \/packages/);
});
