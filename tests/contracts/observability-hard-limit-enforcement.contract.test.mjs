import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  OBSERVABILITY_HARD_LIMIT_ENFORCEMENT_VERSION,
  getHardLimitAuditContract,
  getHardLimitDimension,
  getHardLimitEnforcementPolicy,
  getHardLimitErrorContract,
  listHardLimitDimensions,
  listHardLimitSurfaceMappings,
  readObservabilityHardLimitEnforcement
} from '../../services/internal-contracts/src/index.mjs';

test('observability hard-limit enforcement contract is exposed through shared readers', () => {
  const contract = readObservabilityHardLimitEnforcement();
  const storageBuckets = getHardLimitDimension('storage_buckets');
  const errorContract = getHardLimitErrorContract();
  const auditContract = getHardLimitAuditContract();
  const policy = getHardLimitEnforcementPolicy();

  assert.equal(contract.version, '2026-03-28');
  assert.equal(OBSERVABILITY_HARD_LIMIT_ENFORCEMENT_VERSION, '2026-03-28');
  assert.equal(listHardLimitDimensions().length >= 8, true);
  assert.equal(listHardLimitSurfaceMappings().some((mapping) => mapping.id === 'functions.action.create'), true);
  assert.equal(storageBuckets.blocking_mode, 'resource_creation');
  assert.equal(errorContract.error_code, 'QUOTA_HARD_LIMIT_REACHED');
  assert.equal(auditContract.event_type, 'quota.hard_limit.evaluated');
  assert.equal(policy.fail_closed_on_missing_evidence, true);
});

test('architecture index and task summary document the hard-limit enforcement baseline', () => {
  const architectureIndex = readFileSync('docs/reference/architecture/README.md', 'utf8');
  const taskSummary = readFileSync('docs/tasks/us-obs-03.md', 'utf8');
  const architectureGuide = readFileSync('docs/reference/architecture/observability-hard-limit-enforcement.md', 'utf8');

  assert.equal(architectureIndex.includes('observability-hard-limit-enforcement.json'), true);
  assert.equal(architectureIndex.includes('observability-hard-limit-enforcement.md'), true);
  assert.equal(taskSummary.includes('US-OBS-03-T04'), true);
  assert.equal(taskSummary.includes('validate:observability-hard-limit-enforcement'), true);
  assert.equal(architectureGuide.includes('QUOTA_HARD_LIMIT_REACHED'), true);
  assert.equal(architectureGuide.includes('T05'), true);
  assert.equal(architectureGuide.includes('T06'), true);
});
