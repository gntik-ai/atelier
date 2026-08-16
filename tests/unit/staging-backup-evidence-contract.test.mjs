import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const contract = JSON.parse(readFileSync(
  new URL('../../scripts/operations/staging-backup-evidence-contract.json', import.meta.url),
  'utf8',
));

test('staging backup evidence is pinned to the approved target and PostgreSQL coverage', () => {
  assert.equal(contract.apiVersion, 'falcone.gntik.ai/v1');
  assert.equal(contract.kind, 'FalconeStagingBackupEvidenceContract');
  assert.deepEqual(contract.target, {
    context: 'default',
    namespace: 'in-falcone-staging',
    release: 'falcone',
  });
  assert.deepEqual(contract.requiredCoverage, ['postgresql']);
});

test('staging evidence contract fails closed on restore, parity, expiry and coverage', () => {
  const fields = new Set(contract.evidence.requiredFields);
  for (const field of [
    'target.helmRevision',
    'target.chart',
    'source.commit',
    'coverage.unverified',
    'backup.verified',
    'backup.reference',
    'backup.sha256',
    'restore.verified',
    'parity.verified',
    'parity.sourceInventory',
    'parity.restoredInventory',
    'observedAt',
    'validUntil',
  ]) {
    assert.equal(fields.has(field), true, `missing evidence field: ${field}`);
  }
  assert.equal(contract.evidence.maximumValidityHours <= 24, true);
  assert.equal(contract.evidence.secretMaterialAllowed, false);
  assert.match(contract.evidence.truthRequirements['restore.verified'], /isolated/i);
  assert.match(contract.evidence.truthRequirements['parity.verified'], /equal/i);
  assert.match(contract.evidence.truthRequirements['coverage.unverified'], /empty/i);
});
