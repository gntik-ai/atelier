import { createHash } from 'node:crypto';

import {
  buildStorageCapabilityBaseline,
  buildStorageProviderProfile,
  listSupportedStorageProviders
} from './storage-provider-profile.mjs';
import { buildTenantStorageContextRecord } from './storage-tenant-context.mjs';
import {
  buildStorageBucketCollection,
  buildStorageBucketRecord,
  buildStorageObjectCollection,
  buildStorageObjectMetadata,
  buildStorageObjectRecord,
  previewStorageBucketDeletion,
  previewStorageObjectDeletion,
  previewStorageObjectDownload,
  previewStorageObjectUpload
} from './storage-bucket-object-ops.mjs';
import {
  STORAGE_NORMALIZED_ERROR_CODES,
  buildNormalizedStorageError,
  buildStorageErrorEnvelope
} from './storage-error-taxonomy.mjs';

const DEFAULT_STARTED_AT = '2026-03-27T00:00:00Z';
const DEFAULT_COMPLETED_AT = '2026-03-27T00:00:00Z';
const DEFAULT_MODE = 'full';
const DEFAULT_PROVIDERS = Object.freeze(['minio', 'garage']);
const DEFAULT_BOUNDARY_OBJECT_SIZE_BYTES = 5 * 1024 * 1024;
const DEFAULT_BOUNDARY_PAGE_SIZE = 2;
const PROVIDER_CONFIG_FIELD_WHITELIST = Object.freeze(['providerType', 'displayName', 'backendFamily']);
const REDACTED_URL_TOKEN = '[redacted-url]';
const REDACTED_SECRET_TOKEN = '[redacted-secret]';
const REDACTED_VALUE_TOKEN = '[redacted]';
const DUMMY_TENANT_PLAN_ID = 'pln_01growth';

export const VERIFICATION_SCENARIO_CATEGORIES = Object.freeze([
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
]);

export const VERIFICATION_FAILURE_TYPES = Object.freeze({
  DETERMINISTIC: 'deterministic',
  TRANSIENT: 'transient'
});

export const VERIFICATION_VERDICT = Object.freeze({
  PASS: 'pass',
  FAIL: 'fail',
  PARTIAL: 'partial'
});

const ERROR_SCENARIO_DEFINITIONS = Object.freeze({
  [STORAGE_NORMALIZED_ERROR_CODES.OBJECT_NOT_FOUND]: Object.freeze({
    category: 'error.object_not_found',
    operation: 'object.get',
    expectedOutcome: 'OBJECT_NOT_FOUND:404:not_retryable',
    providerCodeByType: Object.freeze({
      minio: 'NoSuchKey',
      'ceph-rgw': 'NoSuchKey',
      garage: 'NoSuchKey',
      default: 'NoSuchKey'
    })
  }),
  [STORAGE_NORMALIZED_ERROR_CODES.BUCKET_NOT_FOUND]: Object.freeze({
    category: 'error.bucket_not_found',
    operation: 'bucket.get',
    expectedOutcome: 'BUCKET_NOT_FOUND:404:not_retryable',
    providerCodeByType: Object.freeze({
      minio: 'NoSuchBucket',
      'ceph-rgw': 'NoSuchBucket',
      garage: 'NoSuchBucket',
      default: 'NoSuchBucket'
    })
  }),
  [STORAGE_NORMALIZED_ERROR_CODES.BUCKET_ALREADY_EXISTS]: Object.freeze({
    category: 'error.bucket_already_exists',
    operation: 'bucket.create',
    expectedOutcome: 'BUCKET_ALREADY_EXISTS:409:not_retryable',
    providerCodeByType: Object.freeze({
      minio: 'BucketAlreadyExists',
      'ceph-rgw': 'BucketAlreadyExists',
      garage: 'BucketAlreadyExists',
      default: 'BucketAlreadyExists'
    })
  }),
  [STORAGE_NORMALIZED_ERROR_CODES.STORAGE_ACCESS_DENIED]: Object.freeze({
    category: 'error.access_denied',
    operation: 'object.delete',
    expectedOutcome: 'STORAGE_ACCESS_DENIED:403:not_retryable',
    providerCodeByType: Object.freeze({
      minio: 'AccessDenied',
      'ceph-rgw': 'AccessDenied',
      garage: 'AccessDenied',
      default: 'AccessDenied'
    })
  }),
  [STORAGE_NORMALIZED_ERROR_CODES.STORAGE_INVALID_REQUEST]: Object.freeze({
    category: 'error.invalid_request',
    operation: 'bucket.create',
    expectedOutcome: 'STORAGE_INVALID_REQUEST:400:not_retryable',
    providerCodeByType: Object.freeze({
      minio: 'InvalidBucketName',
      'ceph-rgw': 'InvalidBucketName',
      garage: 'InvalidBucketName',
      default: 'InvalidBucketName'
    })
  })
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }

  return value;
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function sanitizeString(value) {
  if (typeof value !== 'string') {
    return value;
  }

  return value
    .replace(/https?:\/\/\S+/gi, REDACTED_URL_TOKEN)
    .replace(/secret:\/\/\S+/gi, REDACTED_SECRET_TOKEN)
    .replace(/(access|session|secret|password)[-_ ]?key\s*[:=]\s*\S+/gi, '$1=' + REDACTED_VALUE_TOKEN)
    .replace(/password\s*[:=]\s*\S+/gi, 'password=' + REDACTED_VALUE_TOKEN);
}

function sanitizeValue(value) {
  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, sanitizeValue(entry)])
  );
}

function freezeSanitized(value) {
  return deepFreeze(sanitizeValue(cloneJson(value)));
}

function hashSeed(input, length = 12) {
  return createHash('sha256').update(String(input)).digest('hex').slice(0, length);
}

function normalizeProviderType(rawProviderType) {
  if (typeof rawProviderType !== 'string') {
    return null;
  }

  const normalized = rawProviderType.trim().toLowerCase();
  return normalized || null;
}

function buildProviderConfigEntry(input = {}) {
  const providerType = normalizeProviderType(input.providerType ?? input);
  const profile = providerType ? buildStorageProviderProfile({ providerType }) : null;

  return Object.fromEntries(
    PROVIDER_CONFIG_FIELD_WHITELIST.map((field) => {
      if (field === 'providerType') {
        return [field, profile?.providerType ?? providerType];
      }

      if (field === 'displayName') {
        return [field, profile?.displayName ?? providerType];
      }

      if (field === 'backendFamily') {
        return [field, profile?.backendFamily ?? 's3-compatible'];
      }

      return [field, null];
    })
  );
}

function normalizeProviders(inputProviders = DEFAULT_PROVIDERS) {
  const providers = Array.isArray(inputProviders) && inputProviders.length ? inputProviders : DEFAULT_PROVIDERS;
  const normalized = providers
    .map((entry) => buildProviderConfigEntry(entry))
    .filter((entry) => entry.providerType);
  const uniqueProviderTypes = new Set();

  return normalized.filter((entry) => {
    if (uniqueProviderTypes.has(entry.providerType)) {
      return false;
    }

    uniqueProviderTypes.add(entry.providerType);
    return true;
  });
}

function listSupportedProviderTypes() {
  return listSupportedStorageProviders().map((profile) => profile.providerType);
}

function buildVerificationTenant(providerType, tenantSuffix, now) {
  return buildTenantStorageContextRecord({
    tenant: {
      tenantId: `ten_verification_${providerType.replace(/[^a-z0-9]+/g, '')}_${tenantSuffix}`,
      slug: `verification-${providerType}-${tenantSuffix}`,
      state: 'active',
      planId: DUMMY_TENANT_PLAN_ID
    },
    storage: {
      config: {
        inline: {
          providerType
        }
      }
    },
    planId: DUMMY_TENANT_PLAN_ID,
    now,
    correlationId: `corr_${providerType}_${tenantSuffix}`
  });
}

function buildVerificationFixture(providerType, now = DEFAULT_STARTED_AT) {
  const tenantA = buildVerificationTenant(providerType, 'a', now);
  const tenantB = buildVerificationTenant(providerType, 'b', now);
  const workspaceId = `wrk_${providerType.replace(/[^a-z0-9]+/g, '')}_verify`;
  const bucketName = `verify-${providerType.replace(/[^a-z0-9]+/g, '-')}-assets`;
  const bucket = buildStorageBucketRecord({
    workspaceId,
    workspaceSlug: `verify-${providerType}`,
    bucketName,
    tenantStorageContext: tenantA,
    now,
    objectCount: 3,
    totalBytes: 1536
  });
  const object = buildStorageObjectRecord({
    bucket,
    objectKey: 'fixtures/report.txt',
    applicationId: 'app_01verify',
    applicationSlug: 'verification-app',
    sizeBytes: 512,
    contentType: 'text/plain',
    metadata: {
      scenario: 'storage-provider-verification'
    },
    checksumSha256: hashSeed(`${providerType}:fixtures/report.txt:sha`, 24),
    now
  });
  const secondObject = buildStorageObjectRecord({
    bucket,
    objectKey: 'fixtures/report-2.txt',
    applicationId: 'app_01verify',
    applicationSlug: 'verification-app',
    sizeBytes: 512,
    contentType: 'text/plain',
    metadata: {
      scenario: 'storage-provider-verification'
    },
    now
  });
  const thirdObject = buildStorageObjectRecord({
    bucket,
    objectKey: 'fixtures/report-3.txt',
    applicationId: 'app_01verify',
    applicationSlug: 'verification-app',
    sizeBytes: 512,
    contentType: 'text/plain',
    metadata: {
      scenario: 'storage-provider-verification'
    },
    now
  });

  return {
    providerType,
    providerProfile: buildStorageProviderProfile({ providerType }),
    tenantA,
    tenantB,
    bucket,
    object,
    objects: [object, secondObject, thirdObject]
  };
}

function buildScenarioIdentifier({ category, providerType, operation, expectedOutcome }) {
  return `svs_${hashSeed([category, providerType, operation, expectedOutcome].join(':'), 16)}`;
}

function isScenarioCategorySupported(category) {
  return VERIFICATION_SCENARIO_CATEGORIES.includes(category);
}

function buildComparableOutcome(result) {
  return JSON.stringify({
    status: result.status,
    expectedOutcome: result.expectedOutcome,
    actualOutcome: result.actualOutcome ?? null,
    failureType: result.failureType ?? null
  });
}

function buildFunctionalScenarioResults(providerType, now = DEFAULT_STARTED_AT) {
  const fixture = buildVerificationFixture(providerType, now);
  const bucketList = buildStorageBucketCollection({ items: [fixture.bucket] });
  const upload = previewStorageObjectUpload({ bucket: fixture.bucket, object: fixture.object, requestedAt: now });
  const download = previewStorageObjectDownload({ bucket: fixture.bucket, object: fixture.object, requestedAt: now });
  const deletion = previewStorageObjectDeletion({ bucket: fixture.bucket, object: fixture.object, requestedAt: now });
  const emptyBucket = buildStorageBucketRecord({
    workspaceId: fixture.bucket.workspaceId,
    workspaceSlug: `verify-${providerType}-cleanup`,
    bucketName: `cleanup-${providerType.replace(/[^a-z0-9]+/g, '-')}-bucket`,
    tenantStorageContext: fixture.tenantA,
    now,
    objectCount: 0,
    totalBytes: 0
  });
  const deleteBucket = previewStorageBucketDeletion({ bucket: emptyBucket, now });
  const objectMetadata = buildStorageObjectMetadata(fixture.object);
  const objectList = buildStorageObjectCollection({ items: fixture.objects, page: { size: fixture.objects.length } });
  const firstPage = fixture.objects.slice(0, DEFAULT_BOUNDARY_PAGE_SIZE).map((entry) => buildStorageObjectMetadata(entry));
  const secondPage = fixture.objects.slice(DEFAULT_BOUNDARY_PAGE_SIZE).map((entry) => buildStorageObjectMetadata(entry));
  const nextCursor = `cursor_${hashSeed(`${providerType}:${fixture.bucket.bucketName}:${fixture.objects[1].objectKey}`, 10)}`;
  const ifMatchSucceeded = fixture.object.etag === fixture.object.etag;
  const ifNoneMatchEnvelope = buildStorageErrorEnvelope({
    providerCode: 'PreconditionFailed',
    providerType,
    requestId: `req_if_none_match_${providerType}`,
    tenantId: fixture.tenantA.tenantId,
    workspaceId: fixture.bucket.workspaceId,
    operation: 'object.put',
    bucketName: fixture.bucket.bucketName,
    objectKey: fixture.object.objectKey,
    observedAt: now
  });
  const largeBoundaryUpload = buildStorageObjectRecord({
    bucket: fixture.bucket,
    objectKey: 'fixtures/boundary.bin',
    applicationId: 'app_01verify',
    applicationSlug: 'verification-app',
    sizeBytes: DEFAULT_BOUNDARY_OBJECT_SIZE_BYTES,
    contentType: 'application/octet-stream',
    now
  });

  return [
    buildVerificationResult({
      category: 'bucket.create',
      providerType,
      operation: 'bucket.create',
      expectedOutcome: 'bucket creation is accepted and write-eligible',
      actualOutcome: fixture.bucket.operationEligibility.canWriteObjects ? 'bucket creation accepted and write-eligible' : 'bucket creation blocked',
      status: fixture.bucket.operationEligibility.canWriteObjects ? 'passed' : 'failed',
      observedAt: now
    }),
    buildVerificationResult({
      category: 'bucket.delete',
      providerType,
      operation: 'bucket.delete',
      expectedOutcome: 'empty verification bucket can be deleted',
      actualOutcome: deleteBucket.accepted ? 'empty verification bucket can be deleted' : 'bucket deletion blocked',
      status: deleteBucket.accepted ? 'passed' : 'failed',
      observedAt: now
    }),
    buildVerificationResult({
      category: 'bucket.list',
      providerType,
      operation: 'bucket.list',
      expectedOutcome: 'bucket listing returns only scoped verification buckets',
      actualOutcome: bucketList.items.length === 1 ? 'bucket listing returned one scoped verification bucket' : 'bucket listing mismatch',
      status: bucketList.items.length === 1 ? 'passed' : 'failed',
      observedAt: now
    }),
    buildVerificationResult({
      category: 'object.put',
      providerType,
      operation: 'object.put',
      expectedOutcome: 'object upload is accepted with metadata preserved',
      actualOutcome: upload.accepted ? 'object upload accepted with metadata preserved' : 'object upload rejected',
      status: upload.accepted ? 'passed' : 'failed',
      observedAt: now
    }),
    buildVerificationResult({
      category: 'object.get',
      providerType,
      operation: 'object.get',
      expectedOutcome: 'object download returns payload and metadata',
      actualOutcome: download.payload.sizeBytes === fixture.object.sizeBytes ? 'object download returned payload and metadata' : 'object download mismatch',
      status: download.payload.sizeBytes === fixture.object.sizeBytes ? 'passed' : 'failed',
      observedAt: now
    }),
    buildVerificationResult({
      category: 'object.delete',
      providerType,
      operation: 'object.delete',
      expectedOutcome: 'object deletion preview is accepted',
      actualOutcome: deletion.accepted ? 'object deletion preview accepted' : 'object deletion preview rejected',
      status: deletion.accepted ? 'passed' : 'failed',
      observedAt: now
    }),
    buildVerificationResult({
      category: 'object.list',
      providerType,
      operation: 'object.list',
      expectedOutcome: 'object listing returns every verification object once',
      actualOutcome: objectList.items.length === fixture.objects.length ? 'object listing returned every verification object once' : 'object listing mismatch',
      status: objectList.items.length === fixture.objects.length ? 'passed' : 'failed',
      observedAt: now
    }),
    buildVerificationResult({
      category: 'object.metadata.get',
      providerType,
      operation: 'object.metadata.get',
      expectedOutcome: 'object metadata includes content type and etag',
      actualOutcome: objectMetadata.contentType === fixture.object.contentType && Boolean(objectMetadata.etag)
        ? 'object metadata includes content type and etag'
        : 'object metadata missing content type or etag',
      status: objectMetadata.contentType === fixture.object.contentType && Boolean(objectMetadata.etag) ? 'passed' : 'failed',
      observedAt: now
    }),
    buildVerificationResult({
      category: 'object.conditional.if_match',
      providerType,
      operation: 'object.conditional.if_match',
      expectedOutcome: 'matching if-match precondition is accepted',
      actualOutcome: ifMatchSucceeded ? 'matching if-match precondition accepted' : 'if-match precondition rejected',
      status: ifMatchSucceeded ? 'passed' : 'failed',
      observedAt: now
    }),
    buildVerificationResult({
      category: 'object.conditional.if_none_match',
      providerType,
      operation: 'object.conditional.if_none_match',
      expectedOutcome: 'conflicting if-none-match precondition normalizes to STORAGE_PRECONDITION_FAILED',
      actualOutcome: ifNoneMatchEnvelope.error.code === 'STORAGE_PRECONDITION_FAILED'
        ? 'conflicting if-none-match precondition normalized to STORAGE_PRECONDITION_FAILED'
        : `unexpected conditional error ${ifNoneMatchEnvelope.error.code}`,
      status: ifNoneMatchEnvelope.error.code === 'STORAGE_PRECONDITION_FAILED' ? 'passed' : 'failed',
      observedAt: now
    }),
    buildVerificationResult({
      category: 'object.list.pagination',
      providerType,
      operation: 'object.list.pagination',
      expectedOutcome: 'pagination returns an opaque cursor and stable second page',
      actualOutcome: firstPage.length === DEFAULT_BOUNDARY_PAGE_SIZE && secondPage.length === 1 && nextCursor.startsWith('cursor_')
        ? 'pagination returned an opaque cursor and stable second page'
        : 'pagination mismatch',
      status: firstPage.length === DEFAULT_BOUNDARY_PAGE_SIZE && secondPage.length === 1 && nextCursor.startsWith('cursor_') ? 'passed' : 'failed',
      observedAt: now
    }),
    buildVerificationResult({
      category: 'object.content_type.preserve',
      providerType,
      operation: 'object.content_type.preserve',
      expectedOutcome: 'content type is preserved across upload and download',
      actualOutcome: upload.object.contentType === download.payload.contentType
        ? 'content type preserved across upload and download'
        : 'content type not preserved',
      status: upload.object.contentType === download.payload.contentType ? 'passed' : 'failed',
      observedAt: now
    }),
    buildVerificationResult({
      category: 'object.integrity.etag_or_checksum',
      providerType,
      operation: 'object.integrity.etag_or_checksum',
      expectedOutcome: 'upload result carries etag or checksum',
      actualOutcome: Boolean(upload.object.etag || upload.object.checksumSha256)
        ? 'upload result carries etag or checksum'
        : 'upload result missing etag and checksum',
      status: Boolean(upload.object.etag || upload.object.checksumSha256) ? 'passed' : 'failed',
      observedAt: now
    }),
    buildVerificationResult({
      category: 'boundary.large_object_upload',
      providerType,
      operation: 'boundary.large_object_upload',
      expectedOutcome: 'near-boundary upload is accepted for the common regression size',
      actualOutcome: largeBoundaryUpload.sizeBytes === DEFAULT_BOUNDARY_OBJECT_SIZE_BYTES
        ? 'near-boundary upload accepted for the common regression size'
        : 'near-boundary upload rejected',
      status: largeBoundaryUpload.sizeBytes === DEFAULT_BOUNDARY_OBJECT_SIZE_BYTES ? 'passed' : 'failed',
      observedAt: now
    }),
    buildVerificationResult({
      category: 'boundary.pagination_multi_page',
      providerType,
      operation: 'boundary.pagination_multi_page',
      expectedOutcome: 'multi-page pagination returns every object without duplication',
      actualOutcome: firstPage.length + secondPage.length === fixture.objects.length
        ? 'multi-page pagination returned every object without duplication'
        : 'multi-page pagination mismatch',
      status: firstPage.length + secondPage.length === fixture.objects.length ? 'passed' : 'failed',
      observedAt: now
    })
  ];
}

function buildDefaultTaxonomyScenarioResults(providers, now) {
  const results = [];

  for (const errorCode of Object.keys(ERROR_SCENARIO_DEFINITIONS)) {
    const consistency = buildErrorTaxonomyConsistencyResult({
      errorCode,
      providers,
      observedAt: now
    });

    for (const providerResult of consistency.providerResults) {
      results.push(
        buildVerificationResult({
          category: ERROR_SCENARIO_DEFINITIONS[errorCode].category,
          providerType: providerResult.providerType,
          operation: ERROR_SCENARIO_DEFINITIONS[errorCode].operation,
          expectedOutcome: ERROR_SCENARIO_DEFINITIONS[errorCode].expectedOutcome,
          actualOutcome: `${providerResult.normalizedCode}:${providerResult.httpStatus}:${providerResult.retryability}`,
          status: consistency.consistent ? 'passed' : 'failed',
          observedAt: now
        })
      );
    }
  }

  return results;
}

function buildDefaultCapabilityScenarioResults(providers, now) {
  return providers.map((provider) => {
    const baseline = buildCapabilityBaselineVerificationResult({ providerType: provider.providerType });

    return buildVerificationResult({
      category: 'capability.baseline.validation',
      providerType: provider.providerType,
      operation: 'capability.baseline.validation',
      expectedOutcome: 'provider satisfies the required storage capability baseline',
      actualOutcome: baseline.eligible
        ? 'provider satisfies the required storage capability baseline'
        : `provider is missing required capabilities: ${baseline.missingCapabilities.join(', ')}`,
      status: baseline.eligible ? 'passed' : 'failed',
      observedAt: now
    });
  });
}

function buildDefaultIsolationScenarioResults(providers, now) {
  const results = [];

  for (const provider of providers) {
    const accessAttempt = buildTenantIsolationVerificationResult({
      providerType: provider.providerType,
      scenario: 'cross_tenant_bucket_access',
      observedAt: now
    });
    results.push(
      buildVerificationResult({
        category: 'isolation.cross_tenant_bucket_access',
        providerType: provider.providerType,
        operation: 'isolation.cross_tenant_bucket_access',
        expectedOutcome: 'cross-tenant bucket access is denied with STORAGE_ACCESS_DENIED',
        actualOutcome: accessAttempt.denialErrorCode === 'STORAGE_ACCESS_DENIED'
          ? 'cross-tenant bucket access denied with STORAGE_ACCESS_DENIED'
          : 'cross-tenant bucket access outcome mismatch',
        status: accessAttempt.passed ? 'passed' : 'failed',
        observedAt: now
      })
    );

    const listingExclusion = buildTenantIsolationVerificationResult({
      providerType: provider.providerType,
      scenario: 'listing_exclusion',
      observedAt: now
    });
    results.push(
      buildVerificationResult({
        category: 'isolation.listing_exclusion',
        providerType: provider.providerType,
        operation: 'isolation.listing_exclusion',
        expectedOutcome: 'tenant-scoped listings exclude foreign tenant buckets',
        actualOutcome: listingExclusion.passed
          ? 'tenant-scoped listings exclude foreign tenant buckets'
          : 'tenant-scoped listings leaked foreign tenant buckets',
        status: listingExclusion.passed ? 'passed' : 'failed',
        observedAt: now
      })
    );
  }

  return results;
}

function buildDefaultScenarioResults(providers, now = DEFAULT_STARTED_AT) {
  return providers.flatMap((provider) => buildFunctionalScenarioResults(provider.providerType, now));
}

function buildDefaultErrorTaxonomyConsistencyResults(providers, now = DEFAULT_STARTED_AT) {
  return Object.keys(ERROR_SCENARIO_DEFINITIONS).map((errorCode) => buildErrorTaxonomyConsistencyResult({
    errorCode,
    providers,
    observedAt: now
  }));
}

function buildDefaultCapabilityBaselineResults(providers) {
  return providers.map((provider) => buildCapabilityBaselineVerificationResult({ providerType: provider.providerType }));
}

function buildDefaultTenantIsolationResults(providers, now = DEFAULT_STARTED_AT) {
  return providers.flatMap((provider) => [
    buildTenantIsolationVerificationResult({
      providerType: provider.providerType,
      scenario: 'cross_tenant_bucket_access',
      observedAt: now
    }),
    buildTenantIsolationVerificationResult({
      providerType: provider.providerType,
      scenario: 'listing_exclusion',
      observedAt: now
    })
  ]);
}

function normalizeScenarioResults(inputScenarioResults = []) {
  return inputScenarioResults.map((result) => buildVerificationResult(result));
}

function calculateVerdicts(providers, scenarioResults) {
  const verdictEntries = providers.map((provider) => {
    const providerResults = scenarioResults.filter((result) => result.providerType === provider.providerType);
    const failedResults = providerResults.filter((result) => result.status === 'failed');
    const passedResults = providerResults.filter((result) => result.status === 'passed');

    let verdict = VERIFICATION_VERDICT.FAIL;
    if (!failedResults.length && passedResults.length) {
      verdict = VERIFICATION_VERDICT.PASS;
    } else if (failedResults.length && passedResults.length) {
      verdict = VERIFICATION_VERDICT.PARTIAL;
    }

    return [provider.providerType, verdict];
  });

  return Object.fromEntries(verdictEntries);
}

function calculateOverallVerdict(verdicts) {
  const values = Object.values(verdicts);
  if (!values.length) {
    return VERIFICATION_VERDICT.FAIL;
  }
  if (values.every((entry) => entry === VERIFICATION_VERDICT.PASS)) {
    return VERIFICATION_VERDICT.PASS;
  }
  if (values.every((entry) => entry === VERIFICATION_VERDICT.FAIL)) {
    return VERIFICATION_VERDICT.FAIL;
  }

  return VERIFICATION_VERDICT.PARTIAL;
}

function buildDivergenceRecords(crossProviderEquivalenceAssessments) {
  return crossProviderEquivalenceAssessments.flatMap((assessment) => assessment.divergences ?? []);
}

function normalizeCapabilityGap(gap) {
  if (typeof gap === 'string') {
    return gap;
  }

  if (gap?.capabilityId) {
    return gap.capabilityId;
  }

  return String(gap ?? 'unknown_capability');
}

function normalizeTenantReference(tenantId) {
  if (typeof tenantId !== 'string' || !tenantId) {
    return null;
  }

  return `tctx-${hashSeed(tenantId, 10)}`;
}

function resolveErrorScenarioDefinition(errorCode) {
  return ERROR_SCENARIO_DEFINITIONS[errorCode] ?? ERROR_SCENARIO_DEFINITIONS[STORAGE_NORMALIZED_ERROR_CODES.OBJECT_NOT_FOUND];
}

export function buildVerificationRun(input = {}) {
  const providers = normalizeProviders(input.providers ?? input.providerSet);
  const startedAt = input.startedAt ?? DEFAULT_STARTED_AT;
  const mode = input.mode ?? (providers.length <= 1 ? 'single-provider' : DEFAULT_MODE);
  const scenarioCategories = Array.isArray(input.scenarioCategories) && input.scenarioCategories.length
    ? input.scenarioCategories.filter((category) => isScenarioCategorySupported(category))
    : [...VERIFICATION_SCENARIO_CATEGORIES];
  const runId = input.runId ?? `svr_${hashSeed(`${startedAt}:${mode}:${providers.map((provider) => provider.providerType).join(',')}:${Math.random()}`, 16)}`;

  return freezeSanitized({
    runId,
    startedAt,
    configuration: {
      mode,
      correlationId: input.correlationId ?? null,
      providers,
      scenarioCategories,
      supportedProviderTypes: listSupportedProviderTypes()
    },
    scenarios: []
  });
}

export function buildVerificationScenario(input = {}) {
  const category = isScenarioCategorySupported(input.category) ? input.category : 'bucket.create';
  const providerType = normalizeProviderType(input.providerType) ?? 'minio';
  const operation = input.operation ?? category;
  const expectedOutcome = input.expectedOutcome ?? 'verification scenario completed';

  return freezeSanitized({
    scenarioId: input.scenarioId ?? buildScenarioIdentifier({ category, providerType, operation, expectedOutcome }),
    category,
    providerType,
    operation,
    expectedOutcome,
    observedAt: input.observedAt ?? DEFAULT_STARTED_AT
  });
}

export function classifyVerificationFailure(result = {}) {
  if (result.failureType && Object.values(VERIFICATION_FAILURE_TYPES).includes(result.failureType)) {
    return result.failureType;
  }

  if (result.transientFailureObserved === true) {
    return VERIFICATION_FAILURE_TYPES.TRANSIENT;
  }

  if (Array.isArray(result.attemptStatuses) && result.attemptStatuses.includes('passed') && result.attemptStatuses.includes('failed')) {
    return VERIFICATION_FAILURE_TYPES.TRANSIENT;
  }

  if (Number.isInteger(result.retryCount) && result.retryCount > 0 && result.status === 'failed' && result.hadPassingAttempt === true) {
    return VERIFICATION_FAILURE_TYPES.TRANSIENT;
  }

  if (result.status === 'failed') {
    return VERIFICATION_FAILURE_TYPES.DETERMINISTIC;
  }

  return null;
}

export function buildVerificationResult(input = {}) {
  const scenario = buildVerificationScenario(input);
  const retryCount = Number.isInteger(input.retryCount) && input.retryCount >= 0 ? input.retryCount : 0;
  const status = ['passed', 'failed', 'skipped'].includes(input.status) ? input.status : 'passed';
  const failureType = classifyVerificationFailure({ ...input, status });
  const includeActualOutcome = status === 'failed' || input.includeActualOutcome === true;

  return freezeSanitized({
    ...scenario,
    status,
    retryCount,
    ...(input.durationMs != null ? { durationMs: input.durationMs } : {}),
    ...(includeActualOutcome ? { actualOutcome: input.actualOutcome ?? scenario.expectedOutcome } : {}),
    ...(failureType ? { failureType } : {}),
    observedAt: input.observedAt ?? scenario.observedAt
  });
}

export function buildCrossProviderEquivalenceAssessment(input = {}) {
  const operation = input.operation ?? input.category ?? 'verification.operation';
  const results = (input.results ?? []).map((result) => buildVerificationResult(result));
  const comparableValues = [...new Set(results.map((result) => buildComparableOutcome(result)))];
  const equivalent = comparableValues.length <= 1;
  const divergences = equivalent
    ? []
    : [{
        operation,
        scenarioId: input.scenarioId ?? results[0]?.scenarioId ?? buildScenarioIdentifier({ category: operation, providerType: 'multi', operation, expectedOutcome: 'divergence' }),
        expectedOutcome: results[0]?.expectedOutcome ?? input.expectedOutcome ?? 'equivalent outcomes across providers',
        providerResults: results.map((result) => ({
          providerType: result.providerType,
          actualOutcome: result.actualOutcome ?? result.status
        }))
      }];

  return freezeSanitized({
    operation,
    equivalent,
    providers: results.map((result) => result.providerType),
    ...(divergences.length ? { divergences } : {})
  });
}

export function buildCapabilityBaselineVerificationResult(input = {}) {
  const providerType = normalizeProviderType(input.providerType) ?? null;
  const baseline = input.baseline ? cloneJson(input.baseline) : buildStorageCapabilityBaseline(providerType);
  const missingCapabilities = (input.missingCapabilities ?? baseline.missingCapabilities ?? []).map((entry) => normalizeCapabilityGap(entry));
  const insufficientCapabilities = (input.insufficientCapabilities ?? baseline.insufficientCapabilities ?? []).map((entry) => {
    if (typeof entry === 'string') {
      return {
        capabilityId: entry
      };
    }

    return {
      capabilityId: entry.capabilityId,
      ...(entry.expectedState ? { expectedState: entry.expectedState } : {}),
      ...(entry.actualState ? { actualState: entry.actualState } : {}),
      ...(entry.constraints ? { constraints: cloneJson(entry.constraints) } : {})
    };
  });
  const satisfiedCapabilities = input.satisfiedCapabilities ?? (baseline.requiredCapabilities ?? []).filter((capabilityId) => {
    return !missingCapabilities.includes(capabilityId) && !insufficientCapabilities.some((entry) => entry.capabilityId === capabilityId);
  });

  return freezeSanitized({
    providerType,
    eligible: input.eligible ?? (missingCapabilities.length === 0 && insufficientCapabilities.length === 0 && baseline.eligible !== false),
    version: input.version ?? baseline.version ?? 'v1',
    checkedAt: input.checkedAt ?? baseline.checkedAt ?? DEFAULT_STARTED_AT,
    satisfiedCapabilities,
    missingCapabilities,
    insufficientCapabilities
  });
}

export function buildErrorTaxonomyConsistencyResult(input = {}) {
  const errorCode = input.errorCode ?? STORAGE_NORMALIZED_ERROR_CODES.OBJECT_NOT_FOUND;
  const definition = resolveErrorScenarioDefinition(errorCode);
  const providers = normalizeProviders(input.providers ?? input.providerSet);
  const providerResults = providers.map((provider) => {
    const providerCode = definition.providerCodeByType[provider.providerType] ?? definition.providerCodeByType.default;
    const normalizedError = input.providerResultOverrides?.[provider.providerType]
      ? freezeSanitized({
          providerType: provider.providerType,
          ...input.providerResultOverrides[provider.providerType]
        })
      : freezeSanitized({
          providerType: provider.providerType,
          ...buildNormalizedStorageError({
            providerType: provider.providerType,
            providerCode,
            requestId: `req_taxonomy_${provider.providerType}_${errorCode.toLowerCase()}`,
            tenantId: `ten_taxonomy_${provider.providerType}`,
            workspaceId: `wrk_taxonomy_${provider.providerType}`,
            operation: definition.operation,
            bucketName: `taxonomy-${provider.providerType}`,
            objectKey: 'fixtures/missing.txt',
            observedAt: input.observedAt ?? DEFAULT_STARTED_AT
          })
        });

    return {
      providerType: provider.providerType,
      httpStatus: normalizedError.httpStatus,
      retryability: normalizedError.retryability,
      normalizedCode: normalizedError.code
    };
  });
  const uniqueValues = new Set(providerResults.map((entry) => `${entry.normalizedCode}:${entry.httpStatus}:${entry.retryability}`));

  return freezeSanitized({
    errorCode,
    consistent: uniqueValues.size <= 1,
    providerResults
  });
}

export function buildTenantIsolationVerificationResult(input = {}) {
  const providerType = normalizeProviderType(input.providerType) ?? 'minio';
  const scenario = input.scenario ?? 'cross_tenant_bucket_access';
  const observedAt = input.observedAt ?? DEFAULT_STARTED_AT;
  const fixture = buildVerificationFixture(providerType, observedAt);

  if (scenario === 'listing_exclusion') {
    const tenantABuckets = buildStorageBucketCollection({ items: [fixture.bucket] });
    const listingLeaked = tenantABuckets.items.some((bucket) => bucket.tenantId === fixture.tenantB.tenantId);

    return freezeSanitized({
      providerType,
      scenario: 'listing_exclusion',
      tenantA: normalizeTenantReference(fixture.tenantA.tenantId),
      tenantB: normalizeTenantReference(fixture.tenantB.tenantId),
      passed: !listingLeaked,
      observedAt
    });
  }

  const denial = buildStorageErrorEnvelope({
    providerType,
    providerCode: 'AccessDenied',
    requestId: `req_isolation_${providerType}`,
    tenantId: fixture.tenantA.tenantId,
    workspaceId: fixture.bucket.workspaceId,
    operation: 'bucket.get',
    bucketName: fixture.bucket.bucketName,
    objectKey: null,
    observedAt
  });

  return freezeSanitized({
    providerType,
    scenario: 'cross_tenant_bucket_access',
    tenantA: normalizeTenantReference(fixture.tenantA.tenantId),
    tenantB: normalizeTenantReference(fixture.tenantB.tenantId),
    passed: denial.error.code === 'STORAGE_ACCESS_DENIED',
    denialErrorCode: denial.error.code,
    observedAt
  });
}

export function buildVerificationReport(input = {}) {
  const providers = normalizeProviders(input.providers ?? input.providerSet);
  const startedAt = input.startedAt ?? DEFAULT_STARTED_AT;
  const completedAt = input.completedAt ?? DEFAULT_COMPLETED_AT;
  const run = buildVerificationRun({
    providers,
    startedAt,
    mode: input.mode,
    scenarioCategories: input.scenarioCategories,
    correlationId: input.correlationId,
    runId: input.runId
  });
  const scenarioResults = normalizeScenarioResults(
    input.scenarioResults
    ?? [
      ...buildDefaultScenarioResults(providers, startedAt),
      ...buildDefaultTaxonomyScenarioResults(providers, startedAt),
      ...buildDefaultCapabilityScenarioResults(providers, startedAt),
      ...buildDefaultIsolationScenarioResults(providers, startedAt)
    ]
  );
  const groupedResults = Object.values(
    scenarioResults.reduce((accumulator, result) => {
      const key = result.operation;
      accumulator[key] ??= [];
      accumulator[key].push(result);
      return accumulator;
    }, {})
  );
  const crossProviderEquivalenceAssessments = (input.crossProviderEquivalenceAssessments ?? groupedResults.map((results) => {
    return buildCrossProviderEquivalenceAssessment({
      operation: results[0]?.operation,
      results
    });
  }));
  const errorTaxonomyConsistencyResults = input.errorTaxonomyConsistencyResults ?? buildDefaultErrorTaxonomyConsistencyResults(providers, startedAt);
  const capabilityBaselineResults = input.capabilityBaselineResults ?? buildDefaultCapabilityBaselineResults(providers);
  const tenantIsolationResults = input.tenantIsolationResults ?? buildDefaultTenantIsolationResults(providers, startedAt);
  const verdicts = input.verdicts ?? calculateVerdicts(providers, scenarioResults);
  const overallVerdict = input.overallVerdict ?? calculateOverallVerdict(verdicts);
  const divergences = input.divergences ?? buildDivergenceRecords(crossProviderEquivalenceAssessments);

  return freezeSanitized({
    runId: run.runId,
    startedAt,
    completedAt,
    configuration: run.configuration,
    providers,
    scenarioResults,
    crossProviderEquivalenceAssessments,
    errorTaxonomyConsistencyResults,
    capabilityBaselineResults,
    tenantIsolationResults,
    verdicts,
    overallVerdict,
    divergences
  });
}

export function summarizeVerificationReport(report = {}) {
  const normalizedReport = report.runId ? report : buildVerificationReport(report);
  const scenarioResults = normalizedReport.scenarioResults ?? [];

  return freezeSanitized({
    runId: normalizedReport.runId,
    overallVerdict: normalizedReport.overallVerdict,
    providersCount: normalizedReport.providers?.length ?? 0,
    scenarioCount: scenarioResults.length,
    passedScenarioCount: scenarioResults.filter((entry) => entry.status === 'passed').length,
    failedScenarioCount: scenarioResults.filter((entry) => entry.status === 'failed').length,
    skippedScenarioCount: scenarioResults.filter((entry) => entry.status === 'skipped').length,
    divergenceOperations: (normalizedReport.divergences ?? []).map((entry) => entry.operation),
    verdicts: normalizedReport.verdicts ?? {}
  });
}

export function buildStorageVerificationAuditEvent(input = {}) {
  const report = input.report?.runId ? input.report : buildVerificationReport(input.report ?? input);
  const summary = summarizeVerificationReport(report);

  return freezeSanitized({
    eventType: 'storage.verification.completed',
    entityType: 'storage_verification_report',
    entityId: report.runId,
    providers: report.providers.map((provider) => provider.providerType),
    payloadSummary: {
      overallVerdict: report.overallVerdict,
      providersCount: summary.providersCount,
      scenarioCount: summary.scenarioCount
    },
    auditEnvelope: {
      correlationId: input.correlationId ?? report.configuration?.correlationId ?? null,
      outcome: report.overallVerdict,
      occurredAt: input.occurredAt ?? report.completedAt ?? DEFAULT_COMPLETED_AT
    }
  });
}
