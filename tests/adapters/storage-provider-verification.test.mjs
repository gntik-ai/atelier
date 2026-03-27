import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCrossProviderEquivalenceAssessment,
  buildStorageVerificationEvent,
  buildStorageVerificationReport,
  buildStorageVerificationRun,
  buildStorageVerificationScenario,
  getStorageProviderCapabilityBaseline,
  storageVerificationFailureTypes,
  storageVerificationScenarioCategories,
  storageVerificationVerdicts,
  summarizeStorageVerificationReport
} from '../../services/adapters/src/provider-catalog.mjs';
import {
  buildCapabilityBaselineVerificationResult,
  buildErrorTaxonomyConsistencyResult
} from '../../services/adapters/src/storage-provider-verification.mjs';

test('MinIO baseline verification is eligible', () => {
  const baseline = getStorageProviderCapabilityBaseline({ providerType: 'minio' });
  const result = buildCapabilityBaselineVerificationResult({
    providerType: 'minio',
    baseline
  });

  assert.equal(result.eligible, true);
  assert.equal(result.satisfiedCapabilities.length > 0, true);
});

test('Garage baseline verification is eligible', () => {
  const baseline = getStorageProviderCapabilityBaseline({ providerType: 'garage' });
  const result = buildCapabilityBaselineVerificationResult({
    providerType: 'garage',
    baseline
  });

  assert.equal(result.eligible, true);
});

test('negative baseline fixtures surface missing required capabilities', () => {
  const result = buildCapabilityBaselineVerificationResult({
    providerType: 'synthetic-provider',
    baseline: {
      version: 'v1',
      checkedAt: '2026-03-27T22:00:00Z',
      eligible: false,
      requiredCapabilities: ['bucket.create', 'object.list.pagination.deterministic'],
      missingCapabilities: [{ capabilityId: 'object.list.pagination.deterministic' }],
      insufficientCapabilities: []
    }
  });

  assert.equal(result.eligible, false);
  assert.deepEqual(result.missingCapabilities, ['object.list.pagination.deterministic']);
});

test('error taxonomy consistency remains true for MinIO vs Garage across required codes', () => {
  for (const errorCode of [
    'OBJECT_NOT_FOUND',
    'BUCKET_NOT_FOUND',
    'BUCKET_ALREADY_EXISTS',
    'STORAGE_ACCESS_DENIED',
    'STORAGE_INVALID_REQUEST'
  ]) {
    const result = buildErrorTaxonomyConsistencyResult({
      errorCode,
      providers: ['minio', 'garage']
    });

    assert.equal(result.consistent, true);
    assert.equal(result.providerResults.length, 2);
  }
});

test('cross-provider equivalence assessments expose divergent provider outcomes', () => {
  const assessment = buildCrossProviderEquivalenceAssessment({
    operation: 'object.get',
    results: [
      {
        category: 'object.get',
        providerType: 'minio',
        operation: 'object.get',
        expectedOutcome: 'download succeeds',
        status: 'passed'
      },
      {
        category: 'object.get',
        providerType: 'garage',
        operation: 'object.get',
        expectedOutcome: 'download succeeds',
        actualOutcome: 'returned 403 instead of 404',
        status: 'failed'
      }
    ]
  });

  assert.equal(assessment.equivalent, false);
  assert.equal(assessment.divergences.length, 1);
  assert.equal(assessment.divergences[0].operation, 'object.get');
  assert.equal(assessment.divergences[0].providerResults.length, 2);
});

test('buildStorageVerificationReport returns the expected top-level fields', () => {
  const report = buildStorageVerificationReport({
    providers: ['minio', 'garage'],
    scenarioResults: [
      {
        category: 'bucket.create',
        providerType: 'minio',
        operation: 'bucket.create',
        expectedOutcome: 'accepted',
        status: 'passed'
      },
      {
        category: 'bucket.create',
        providerType: 'garage',
        operation: 'bucket.create',
        expectedOutcome: 'accepted',
        status: 'passed'
      }
    ],
    errorTaxonomyConsistencyResults: [],
    capabilityBaselineResults: [],
    tenantIsolationResults: []
  });

  for (const field of [
    'runId',
    'startedAt',
    'providers',
    'scenarioResults',
    'crossProviderEquivalenceAssessments',
    'errorTaxonomyConsistencyResults',
    'capabilityBaselineResults',
    'tenantIsolationResults',
    'verdicts',
    'overallVerdict'
  ]) {
    assert.equal(field in report, true);
  }
});

test('summaries from provider catalog do not leak secret references', () => {
  const summary = summarizeStorageVerificationReport(buildStorageVerificationReport({
    providers: [{
      providerType: 'minio',
      endpoint: 'https://minio.internal',
      secretRef: 'secret://providers/minio'
    }],
    scenarioResults: [
      {
        category: 'bucket.create',
        providerType: 'minio',
        operation: 'bucket.create',
        expectedOutcome: 'accepted',
        actualOutcome: 'failure routed to https://minio.internal using accessKey=minio',
        status: 'failed'
      }
    ],
    errorTaxonomyConsistencyResults: [],
    capabilityBaselineResults: [],
    tenantIsolationResults: []
  }));

  assert.equal(JSON.stringify(summary).includes('secret://'), false);
  assert.equal(JSON.stringify(summary).includes('https://'), false);
});

test('provider-catalog verification exports are defined', () => {
  assert.equal(typeof buildStorageVerificationRun, 'function');
  assert.equal(typeof buildStorageVerificationScenario, 'function');
  assert.equal(typeof buildStorageVerificationReport, 'function');
  assert.equal(typeof buildCrossProviderEquivalenceAssessment, 'function');
  assert.equal(typeof summarizeStorageVerificationReport, 'function');
  assert.equal(typeof buildStorageVerificationEvent, 'function');
  assert.ok(storageVerificationScenarioCategories.includes('bucket.create'));
  assert.equal(storageVerificationFailureTypes.DETERMINISTIC, 'deterministic');
  assert.equal(storageVerificationVerdicts.PASS, 'pass');
});
