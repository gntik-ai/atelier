import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VERIFICATION_FAILURE_TYPES,
  VERIFICATION_SCENARIO_CATEGORIES,
  VERIFICATION_VERDICT,
  buildCapabilityBaselineVerificationResult,
  buildErrorTaxonomyConsistencyResult,
  buildTenantIsolationVerificationResult,
  buildVerificationReport,
  buildVerificationResult,
  buildVerificationRun,
  buildVerificationScenario,
  classifyVerificationFailure,
  summarizeVerificationReport
} from '../../services/adapters/src/storage-provider-verification.mjs';

const REQUIRED_CATEGORIES = [
  'bucket.create',
  'bucket.delete',
  'bucket.list',
  'object.put',
  'object.get',
  'object.delete',
  'object.list',
  'object.metadata.get',
  'object.conditional.if_match',
  'object.conditional.if_none_match',
  'object.list.pagination',
  'object.content_type.preserve',
  'object.integrity.etag_or_checksum',
  'error.object_not_found',
  'error.bucket_not_found',
  'error.bucket_already_exists',
  'error.access_denied',
  'error.invalid_request',
  'capability.baseline.validation',
  'isolation.cross_tenant_bucket_access',
  'isolation.listing_exclusion',
  'boundary.large_object_upload',
  'boundary.pagination_multi_page'
];

test('buildVerificationRun creates a single-provider run without leaking credentials', () => {
  const run = buildVerificationRun({
    providers: [{
      providerType: 'minio',
      endpoint: 'https://minio.internal',
      accessKey: 'minio',
      secretRef: 'secret://providers/minio'
    }],
    startedAt: '2026-03-27T21:30:00Z'
  });

  assert.match(run.runId, /^svr_/);
  assert.equal(run.startedAt, '2026-03-27T21:30:00Z');
  assert.equal(run.configuration.providers.length, 1);
  assert.deepEqual(Object.keys(run.configuration.providers[0]).sort(), ['backendFamily', 'displayName', 'providerType']);
  assert.equal(run.configuration.providers[0].providerType, 'minio');
  assert.deepEqual(run.scenarios, []);
  assert.equal(JSON.stringify(run).includes('secret://'), false);
  assert.equal(JSON.stringify(run).includes('https://minio.internal'), false);
});

test('buildVerificationRun creates unique run ids for equivalent two-provider inputs', () => {
  const input = {
    providers: ['minio', 'garage'],
    startedAt: '2026-03-27T21:31:00Z'
  };

  const firstRun = buildVerificationRun(input);
  const secondRun = buildVerificationRun(input);

  assert.equal(firstRun.configuration.providers.length, 2);
  assert.equal(secondRun.configuration.providers.length, 2);
  assert.notEqual(firstRun.runId, secondRun.runId);
});

test('buildVerificationScenario creates structurally valid records for representative categories', () => {
  for (const category of [
    'bucket.create',
    'object.put',
    'error.object_not_found',
    'capability.baseline.validation',
    'isolation.cross_tenant_bucket_access',
    'boundary.large_object_upload'
  ]) {
    const scenario = buildVerificationScenario({
      category,
      providerType: 'garage',
      operation: category,
      expectedOutcome: 'scenario completed',
      observedAt: '2026-03-27T21:32:00Z'
    });

    assert.match(scenario.scenarioId, /^svs_/);
    assert.equal(scenario.category, category);
    assert.equal(scenario.providerType, 'garage');
    assert.equal(scenario.operation, category);
  }
});

test('buildVerificationResult omits failure data for passing scenarios', () => {
  const result = buildVerificationResult({
    category: 'bucket.create',
    providerType: 'minio',
    operation: 'bucket.create',
    expectedOutcome: 'accepted',
    status: 'passed',
    retryCount: 0,
    observedAt: '2026-03-27T21:33:00Z'
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.retryCount, 0);
  assert.equal('failureType' in result, false);
  assert.equal('actualOutcome' in result, false);
});

test('classifyVerificationFailure marks zero-retry failures as deterministic', () => {
  const result = buildVerificationResult({
    category: 'object.get',
    providerType: 'minio',
    operation: 'object.get',
    expectedOutcome: 'download succeeds',
    actualOutcome: 'normalized to OBJECT_NOT_FOUND',
    status: 'failed',
    retryCount: 0,
    observedAt: '2026-03-27T21:34:00Z'
  });

  assert.equal(classifyVerificationFailure(result), VERIFICATION_FAILURE_TYPES.DETERMINISTIC);
  assert.equal(result.failureType, VERIFICATION_FAILURE_TYPES.DETERMINISTIC);
  assert.equal(result.actualOutcome, 'normalized to OBJECT_NOT_FOUND');
});

test('classifyVerificationFailure marks failed-after-retry results with prior pass as transient', () => {
  const failureType = classifyVerificationFailure({
    status: 'failed',
    retryCount: 2,
    hadPassingAttempt: true
  });

  assert.equal(failureType, VERIFICATION_FAILURE_TYPES.TRANSIENT);
});

test('buildVerificationReport returns pass when both providers pass all scenarios', () => {
  const report = buildVerificationReport({
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
    crossProviderEquivalenceAssessments: [
      {
        operation: 'bucket.create',
        equivalent: true,
        providers: ['minio', 'garage']
      }
    ],
    errorTaxonomyConsistencyResults: [],
    capabilityBaselineResults: [],
    tenantIsolationResults: []
  });

  assert.equal(report.overallVerdict, VERIFICATION_VERDICT.PASS);
  assert.equal(report.verdicts.minio, VERIFICATION_VERDICT.PASS);
  assert.equal(report.verdicts.garage, VERIFICATION_VERDICT.PASS);
  assert.deepEqual(report.divergences, []);
});

test('buildVerificationReport returns partial when one provider fails a scenario', () => {
  const report = buildVerificationReport({
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
        actualOutcome: 'bucket creation blocked',
        status: 'failed',
        retryCount: 0
      }
    ],
    errorTaxonomyConsistencyResults: [],
    capabilityBaselineResults: [],
    tenantIsolationResults: []
  });

  assert.equal(report.overallVerdict, VERIFICATION_VERDICT.PARTIAL);
  assert.equal(report.verdicts.minio, VERIFICATION_VERDICT.PASS);
  assert.equal(report.verdicts.garage, VERIFICATION_VERDICT.FAIL);
  assert.equal(report.divergences.length, 1);
  assert.equal(report.divergences[0].operation, 'bucket.create');
});

test('buildCapabilityBaselineVerificationResult marks MinIO as eligible', () => {
  const result = buildCapabilityBaselineVerificationResult({ providerType: 'minio' });

  assert.equal(result.eligible, true);
  assert.deepEqual(result.missingCapabilities, []);
  assert.equal(result.satisfiedCapabilities.length > 0, true);
});

test('buildCapabilityBaselineVerificationResult exposes missing pagination capability for negative fixtures', () => {
  const result = buildCapabilityBaselineVerificationResult({
    providerType: 'minio',
    baseline: {
      version: 'v1',
      checkedAt: '2026-03-27T21:35:00Z',
      eligible: false,
      requiredCapabilities: ['object.list.pagination.deterministic', 'bucket.create'],
      missingCapabilities: [{ capabilityId: 'object.list.pagination.deterministic' }],
      insufficientCapabilities: []
    }
  });

  assert.equal(result.eligible, false);
  assert.equal(result.missingCapabilities.includes('object.list.pagination.deterministic'), true);
});

test('buildErrorTaxonomyConsistencyResult is consistent for all required normalized error codes across MinIO and Garage', () => {
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
    assert.equal(new Set(result.providerResults.map((entry) => entry.httpStatus)).size, 1);
    assert.equal(new Set(result.providerResults.map((entry) => entry.retryability)).size, 1);
  }
});

test('buildErrorTaxonomyConsistencyResult surfaces diverging provider HTTP status values', () => {
  const result = buildErrorTaxonomyConsistencyResult({
    errorCode: 'OBJECT_NOT_FOUND',
    providers: ['minio', 'garage'],
    providerResultOverrides: {
      minio: {
        code: 'OBJECT_NOT_FOUND',
        httpStatus: 404,
        retryability: 'not_retryable'
      },
      garage: {
        code: 'OBJECT_NOT_FOUND',
        httpStatus: 403,
        retryability: 'not_retryable'
      }
    }
  });

  assert.equal(result.consistent, false);
  assert.equal(result.providerResults.length, 2);
  assert.deepEqual(result.providerResults.map((entry) => entry.httpStatus).sort(), [403, 404]);
});

test('buildTenantIsolationVerificationResult records denied cross-tenant access with anonymized tenant ids', () => {
  const result = buildTenantIsolationVerificationResult({
    providerType: 'garage',
    scenario: 'cross_tenant_bucket_access'
  });

  assert.equal(result.passed, true);
  assert.equal(result.denialErrorCode, 'STORAGE_ACCESS_DENIED');
  assert.match(result.tenantA, /^tctx-/);
  assert.match(result.tenantB, /^tctx-/);
  assert.equal(result.tenantA.includes('verification'), false);
  assert.equal(result.tenantB.includes('verification'), false);
});

test('summarizeVerificationReport redacts secret and URL-like content', () => {
  const summary = summarizeVerificationReport(buildVerificationReport({
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
        actualOutcome: 'accepted via https://minio.internal with accessKey=minio',
        status: 'failed'
      }
    ],
    errorTaxonomyConsistencyResults: [],
    capabilityBaselineResults: [],
    tenantIsolationResults: []
  }));
  const serialized = JSON.stringify(summary);

  assert.equal(serialized.includes('secret://'), false);
  assert.equal(serialized.includes('http://'), false);
  assert.equal(serialized.includes('https://'), false);
  assert.equal(serialized.includes('accessKey='), false);
  assert.equal(serialized.includes('sessionKey='), false);
  assert.equal(serialized.includes('password='), false);
});

test('verification catalogs include all required entries and remain frozen', () => {
  for (const category of REQUIRED_CATEGORIES) {
    assert.equal(VERIFICATION_SCENARIO_CATEGORIES.includes(category), true);
  }

  assert.deepEqual(Object.values(VERIFICATION_VERDICT).sort(), ['fail', 'partial', 'pass']);
  assert.equal(Object.isFrozen(VERIFICATION_SCENARIO_CATEGORIES), true);
  assert.equal(Object.isFrozen(VERIFICATION_VERDICT), true);
  assert.throws(() => {
    VERIFICATION_SCENARIO_CATEGORIES.push('mutate-me');
  }, TypeError);
  assert.throws(() => {
    VERIFICATION_VERDICT.PASS = 'broken';
  }, TypeError);
});
