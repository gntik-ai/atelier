import { randomUUID } from 'node:crypto';
import { detectEnforcementMode } from './lib/enforcement-mode.mjs';
import { createIsolatedFixture, teardownFixture } from './lib/fixtures.mjs';
import { exitCode, generateReport, printReport, resetResults, writeReport } from './lib/reporter.mjs';
import { runFunctionPrivilegeSuite } from './suites/function-privilege.test.mjs';
import { runPlanRestrictionSuite } from './suites/plan-restriction.test.mjs';
import { runPrivilegeDomainSuite } from './suites/privilege-domain.test.mjs';
import { runScopeEnforcementSuite } from './suites/scope-enforcement.test.mjs';
import { runSecretLifecycleSuite } from './suites/secret-lifecycle.test.mjs';
import { runTenantIsolationSuite } from './suites/tenant-isolation.test.mjs';

const runId = randomUUID();
const startedAt = new Date();

console.log(`[HARDENING] Run ID: ${runId}`);
console.log(`[HARDENING] Started At: ${startedAt.toISOString()}`);

resetResults();

const environment = await detectEnforcementMode();
let fixture;

try {
  fixture = await createIsolatedFixture(runId);
} catch (error) {
  console.error('[HARDENING] FATAL: fixture provision failed:', error.message);
  process.exit(1);
}

try {
  await runSecretLifecycleSuite({ fixture, environment });
  await runScopeEnforcementSuite({ fixture, environment });
  await runPlanRestrictionSuite({ fixture, environment });
  await runPrivilegeDomainSuite({ fixture, environment });
  await runFunctionPrivilegeSuite({ fixture, environment });
  await runTenantIsolationSuite({ fixture, environment });
} finally {
  await teardownFixture(runId).catch((error) => {
    console.warn('[HARDENING] WARN: teardown error (ignored):', error.message);
  });
}

const report = generateReport({ runId, startedAt, environment });
printReport(report);
const reportPath = await writeReport(report);
console.log(`[HARDENING] Report written to: ${reportPath}`);
process.exit(exitCode());
