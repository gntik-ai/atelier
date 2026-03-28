import { createHash } from 'node:crypto';

import { buildStorageProviderProfile } from './storage-provider-profile.mjs';
import {
  STORAGE_LOGICAL_ORGANIZATION_ERROR_CODES,
  buildStorageLogicalOrganization,
  buildStorageObjectOrganization
} from './storage-logical-organization.mjs';
import { buildTenantStorageContextRecord } from './storage-tenant-context.mjs';

const DEFAULT_NOW = '2026-03-27T00:00:00Z';
const DEFAULT_REGION = 'us-east-1';
const STORAGE_CAPABILITY_KEY = 'data.storage.bucket';
const DEFAULT_OBJECT_CONTENT_TYPE = 'application/octet-stream';
const DEFAULT_OBJECT_STORAGE_CLASS = 'standard';
const DEFAULT_OBJECT_ENCODING = 'base64';
const DEFAULT_OBJECT_DOWNLOAD_DISPOSITION = 'attachment';
const BUCKET_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{1,61}[a-z0-9])?$/;

export const STORAGE_BUCKET_OBJECT_ERROR_CODES = Object.freeze({
  INVALID_BUCKET_NAME: 'INVALID_BUCKET_NAME',
  INVALID_OBJECT_KEY: 'INVALID_OBJECT_KEY',
  CONTEXT_INACTIVE: 'CONTEXT_INACTIVE',
  CAPABILITY_UNAVAILABLE: 'CAPABILITY_UNAVAILABLE',
  BUCKET_NOT_EMPTY: 'BUCKET_NOT_EMPTY',
  BUCKET_PROTECTED: 'BUCKET_PROTECTED',
  OBJECT_NOT_FOUND: 'OBJECT_NOT_FOUND',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  ...STORAGE_LOGICAL_ORGANIZATION_ERROR_CODES
});

function hashSeed(seed, length = 16) {
  return createHash('sha256').update(seed).digest('hex').slice(0, length);
}

function buildResourceId(seed) {
  return `res_${hashSeed(seed, 18)}`;
}

function buildObjectBodySeed(bucketName, objectKey) {
  return Buffer.from(`storage-object:${bucketName}:${objectKey}`, 'utf8').toString('base64');
}

function assertBucketName(bucketName) {
  if (typeof bucketName !== 'string' || !BUCKET_NAME_PATTERN.test(bucketName)) {
    throw new Error(STORAGE_BUCKET_OBJECT_ERROR_CODES.INVALID_BUCKET_NAME);
  }
}

function assertObjectKey(objectKey) {
  if (
    typeof objectKey !== 'string'
    || !objectKey.trim()
    || objectKey.startsWith('/')
    || objectKey.length > 1024
  ) {
    throw new Error(STORAGE_BUCKET_OBJECT_ERROR_CODES.INVALID_OBJECT_KEY);
  }
}

function buildPageInfo({ size, after = undefined, nextCursor = undefined }) {
  return {
    size,
    ...(after ? { after } : {}),
    ...(nextCursor ? { nextCursor } : {})
  };
}

function resolveTenantStorageContext(input = {}) {
  if (input.tenantStorageContext?.entityType === 'tenant_storage_context') {
    return input.tenantStorageContext;
  }

  if (input.bucket?.tenantStorageContext?.entityType === 'tenant_storage_context') {
    return input.bucket.tenantStorageContext;
  }

  if (input.tenant?.tenantId) {
    return buildTenantStorageContextRecord({
      tenant: input.tenant,
      planId: input.planId ?? input.tenant.planId,
      storage: input.storage ?? {},
      now: input.now ?? DEFAULT_NOW,
      correlationId: input.correlationId ?? null
    });
  }

  return null;
}

function resolveProviderProfile({ tenantStorageContext, storage = {}, region = DEFAULT_REGION }) {
  return buildStorageProviderProfile({
    providerType: tenantStorageContext?.providerType ?? storage.providerType,
    storage: {
      ...storage,
      config: storage.config ?? {
        inline: {
          providerType: tenantStorageContext?.providerType ?? storage.providerType ?? 'minio',
          region
        }
      }
    }
  });
}

function resolveContextOutcome(tenantStorageContext) {
  if (!tenantStorageContext) {
    return {
      ok: false,
      errorCode: STORAGE_BUCKET_OBJECT_ERROR_CODES.CONTEXT_INACTIVE,
      reason: 'Tenant storage context is required before bucket/object operations can proceed.'
    };
  }

  if (tenantStorageContext.quotaAssignment?.capabilityAvailable === false) {
    return {
      ok: false,
      errorCode: STORAGE_BUCKET_OBJECT_ERROR_CODES.CAPABILITY_UNAVAILABLE,
      reason: 'Storage capability is unavailable for this tenant context.'
    };
  }

  if (tenantStorageContext.state !== 'active' || tenantStorageContext.bucketProvisioningAllowed === false) {
    return {
      ok: false,
      errorCode: STORAGE_BUCKET_OBJECT_ERROR_CODES.CONTEXT_INACTIVE,
      reason: 'Tenant storage context is not active.'
    };
  }

  return { ok: true, errorCode: null, reason: null };
}

function buildBucketProvisioningState({ bucket, providerProfile, now, outcome }) {
  return {
    resourceKey: bucket.bucketName,
    resourceType: 'storage_bucket',
    scope: 'workspace',
    displayName: bucket.bucketName,
    provider: providerProfile.providerType ?? 'storage',
    gatingMode: 'capability_gated',
    requiredCapabilityKey: STORAGE_CAPABILITY_KEY,
    status: outcome.ok ? 'provisioned' : 'failed',
    attemptCount: 1,
    lastAttemptAt: now,
    providerReference: `bucket://${bucket.namespace}/${bucket.bucketName}`,
    ...(outcome.ok
      ? {}
      : {
          failureClass: outcome.errorCode === STORAGE_BUCKET_OBJECT_ERROR_CODES.CAPABILITY_UNAVAILABLE
            ? 'validation_error'
            : 'retryable_dependency_failure'
        }),
    visibleInConsole: true
  };
}

function normalizeObjectStats({ objectCount = 0, totalBytes = 0 }) {
  return {
    objectCount,
    totalBytes,
    empty: objectCount === 0
  };
}

export function buildStorageBucketRecord({
  tenantId,
  workspaceId,
  workspaceSlug = null,
  bucketName,
  region = DEFAULT_REGION,
  tenantStorageContext,
  tenant,
  storage = {},
  now = DEFAULT_NOW,
  status = 'active',
  objectCount = 0,
  totalBytes = 0,
  managed = false,
  managedResourceKey = null,
  objectLockMode = 'disabled',
  eventNotifications = null,
  existingBucket = null,
  organization = null,
  policyAttachment = null
} = {}) {
  if (!workspaceId) {
    throw new Error('workspaceId is required to build a storage bucket record.');
  }

  assertBucketName(bucketName);

  const context = resolveTenantStorageContext({ tenantStorageContext, tenant, storage, now });
  const providerProfile = resolveProviderProfile({ tenantStorageContext: context, storage, region });
  const contextOutcome = resolveContextOutcome(context);
  const effectiveTenantId = tenantId ?? context?.tenantId ?? tenant?.tenantId;

  if (!effectiveTenantId) {
    throw new Error('tenantId or tenant context is required to build a storage bucket record.');
  }

  const logicalOrganization = organization?.strategy
    ? organization
    : buildStorageLogicalOrganization({
        tenantId: effectiveTenantId,
        workspaceId,
        workspaceSlug,
        tenantStorageContext: context
      });

  const bucket = {
    resourceId: existingBucket?.resourceId ?? buildResourceId(`${effectiveTenantId}:${workspaceId}:${bucketName}`),
    tenantId: effectiveTenantId,
    workspaceId,
    bucketName,
    region,
    status,
    namespace: context?.namespace ?? null,
    providerType: context?.providerType ?? providerProfile.providerType,
    providerDisplayName: context?.providerDisplayName ?? providerProfile.displayName ?? providerProfile.providerType,
    objectLockMode,
    managed,
    managedResourceKey,
    objectStats: normalizeObjectStats({ objectCount, totalBytes }),
    timestamps: {
      createdAt: existingBucket?.timestamps?.createdAt ?? now,
      updatedAt: now,
      ...(status === 'active' ? { activatedAt: existingBucket?.timestamps?.activatedAt ?? now } : {}),
      ...(status === 'suspended' ? { suspendedAt: now } : {}),
      ...(status === 'deleted' ? { deletedAt: now } : {})
    },
    eventBridgeSummary: eventNotifications,
    organization: logicalOrganization,
    tenantStorageContext: context,
    ...(policyAttachment ? { policyAttachment: JSON.parse(JSON.stringify(policyAttachment)) } : {}),
    operationEligibility: {
      canWriteObjects: contextOutcome.ok,
      canDeleteBucket: contextOutcome.ok && objectCount === 0 && !(managed && managedResourceKey === 'default_storage_bucket'),
      contextErrorCode: contextOutcome.errorCode
    }
  };

  return {
    ...bucket,
    provisioning: buildBucketProvisioningState({ bucket, providerProfile, now, outcome: contextOutcome })
  };
}

export function buildStorageBucketSummary(input = {}) {
  const bucket = input.resourceId ? input : buildStorageBucketRecord(input);

  return {
    resourceId: bucket.resourceId,
    tenantId: bucket.tenantId,
    workspaceId: bucket.workspaceId,
    bucketName: bucket.bucketName,
    region: bucket.region,
    status: bucket.status,
    namespace: bucket.namespace,
    providerType: bucket.providerType,
    providerDisplayName: bucket.providerDisplayName,
    objectStats: { ...bucket.objectStats },
    timestamps: { ...bucket.timestamps },
    provisioning: { ...bucket.provisioning },
    ...(bucket.organization ? { organization: JSON.parse(JSON.stringify(bucket.organization)) } : {}),
    ...(bucket.eventBridgeSummary ? { eventBridgeSummary: { ...bucket.eventBridgeSummary } } : {}),
    ...(bucket.policyAttachment ? { policyAttachment: JSON.parse(JSON.stringify(bucket.policyAttachment)) } : {})
  };
}

export function buildStorageBucketCollection({ items = [], page = {} } = {}) {
  const summaries = items.map((item) => buildStorageBucketSummary(item));
  return {
    items: summaries,
    page: buildPageInfo({ size: summaries.length || page.size || 1, after: page.after, nextCursor: page.nextCursor })
  };
}

export function previewStorageBucketDeletion({ bucket, now = DEFAULT_NOW } = {}) {
  const record = bucket?.resourceId ? bucket : buildStorageBucketRecord(bucket ?? {});
  const protectedDefaultBucket = record.managed === true && record.managedResourceKey === 'default_storage_bucket';
  const nonEmpty = (record.objectStats?.objectCount ?? 0) > 0;

  return {
    bucket: buildStorageBucketSummary(record),
    accepted: !(protectedDefaultBucket || nonEmpty),
    requestedState: protectedDefaultBucket || nonEmpty ? 'blocked' : 'accepted',
    reasonCode: protectedDefaultBucket
      ? STORAGE_BUCKET_OBJECT_ERROR_CODES.BUCKET_PROTECTED
      : nonEmpty
        ? STORAGE_BUCKET_OBJECT_ERROR_CODES.BUCKET_NOT_EMPTY
        : null,
    observedAt: now
  };
}

export function buildStorageObjectRecord({
  bucket,
  objectKey,
  applicationId = null,
  applicationSlug = null,
  requestedPrefix = null,
  sizeBytes = 0,
  contentType = DEFAULT_OBJECT_CONTENT_TYPE,
  metadata = {},
  checksumSha256 = null,
  etag = null,
  contentBase64 = null,
  storageClass = DEFAULT_OBJECT_STORAGE_CLASS,
  now = DEFAULT_NOW,
  updatedAt = now,
  versionId = null,
  organization = null
} = {}) {
  const bucketRecord = bucket?.resourceId ? bucket : buildStorageBucketRecord(bucket ?? {});
  assertObjectKey(objectKey);
  const logicalOrganization = organization?.strategy
    ? organization
    : buildStorageObjectOrganization({
        bucket: bucketRecord,
        organization: bucketRecord.organization,
        objectKey,
        applicationId,
        applicationSlug,
        requestedPrefix
      });

  return {
    resourceId: buildResourceId(`${bucketRecord.resourceId}:${objectKey}`),
    tenantId: bucketRecord.tenantId,
    workspaceId: bucketRecord.workspaceId,
    bucketResourceId: bucketRecord.resourceId,
    bucketName: bucketRecord.bucketName,
    objectKey,
    applicationId: logicalOrganization.applicationId ?? null,
    namespace: bucketRecord.namespace,
    providerType: bucketRecord.providerType,
    contentType,
    sizeBytes,
    checksumSha256,
    etag: etag ?? hashSeed(`${bucketRecord.resourceId}:${objectKey}:etag`, 24),
    versionId,
    metadata: { ...metadata },
    storageClass,
    organization: logicalOrganization,
    timestamps: {
      createdAt: now,
      updatedAt,
      lastModifiedAt: updatedAt
    },
    contentBase64: contentBase64 ?? buildObjectBodySeed(bucketRecord.bucketName, objectKey),
    encoding: DEFAULT_OBJECT_ENCODING,
    downloadDisposition: DEFAULT_OBJECT_DOWNLOAD_DISPOSITION
  };
}

export function buildStorageObjectMetadata(input = {}) {
  const object = input.resourceId ? input : buildStorageObjectRecord(input);

  return {
    resourceId: object.resourceId,
    tenantId: object.tenantId,
    workspaceId: object.workspaceId,
    bucketResourceId: object.bucketResourceId,
    bucketName: object.bucketName,
    objectKey: object.objectKey,
    ...(object.applicationId ? { applicationId: object.applicationId } : {}),
    namespace: object.namespace,
    providerType: object.providerType,
    contentType: object.contentType,
    sizeBytes: object.sizeBytes,
    checksumSha256: object.checksumSha256,
    etag: object.etag,
    versionId: object.versionId,
    metadata: { ...object.metadata },
    storageClass: object.storageClass,
    ...(object.organization ? { organization: JSON.parse(JSON.stringify(object.organization)) } : {}),
    timestamps: { ...object.timestamps }
  };
}

export function buildStorageObjectCollection({ items = [], page = {} } = {}) {
  const summaries = items.map((item) => buildStorageObjectMetadata(item));
  return {
    items: summaries,
    page: buildPageInfo({ size: summaries.length || page.size || 1, after: page.after, nextCursor: page.nextCursor })
  };
}

export function previewStorageObjectUpload({ bucket, object, requestedAt = DEFAULT_NOW } = {}) {
  const bucketRecord = bucket?.resourceId ? bucket : buildStorageBucketRecord(bucket ?? {});
  const objectRecord = object?.resourceId ? object : buildStorageObjectRecord({ bucket: bucketRecord, ...(object ?? {}) });

  return {
    accepted: true,
    observedAt: requestedAt,
    bucket: buildStorageBucketSummary(bucketRecord),
    object: buildStorageObjectMetadata(objectRecord)
  };
}

export function previewStorageObjectDownload({ bucket, object, requestedAt = DEFAULT_NOW } = {}) {
  const bucketRecord = bucket?.resourceId ? bucket : buildStorageBucketRecord(bucket ?? {});
  const objectRecord = object?.resourceId ? object : buildStorageObjectRecord({ bucket: bucketRecord, ...(object ?? {}) });

  return {
    observedAt: requestedAt,
    metadata: buildStorageObjectMetadata(objectRecord),
    payload: {
      contentBase64: objectRecord.contentBase64,
      encoding: objectRecord.encoding,
      disposition: objectRecord.downloadDisposition,
      contentType: objectRecord.contentType,
      sizeBytes: objectRecord.sizeBytes
    }
  };
}

export function previewStorageObjectDeletion({ bucket, object, requestedAt = DEFAULT_NOW } = {}) {
  const bucketRecord = bucket?.resourceId ? bucket : buildStorageBucketRecord(bucket ?? {});
  const objectRecord = object?.resourceId ? object : buildStorageObjectRecord({ bucket: bucketRecord, ...(object ?? {}) });

  return {
    accepted: true,
    observedAt: requestedAt,
    bucket: buildStorageBucketSummary(bucketRecord),
    object: buildStorageObjectMetadata(objectRecord)
  };
}

export function buildStorageMutationEvent({
  operation,
  bucket,
  object = null,
  occurredAt = DEFAULT_NOW,
  actorUserId = null,
  correlationId = null,
  outcome = 'accepted'
} = {}) {
  const bucketRecord = bucket?.resourceId ? bucket : buildStorageBucketRecord(bucket ?? {});
  const objectRecord = object ? (object.resourceId ? object : buildStorageObjectRecord({ bucket: bucketRecord, ...object })) : null;

  return {
    eventType: `storage.${operation}`,
    entityType: objectRecord ? 'bucket_object' : 'bucket',
    tenantId: bucketRecord.tenantId,
    workspaceId: bucketRecord.workspaceId,
    bucketResourceId: bucketRecord.resourceId,
    bucketName: bucketRecord.bucketName,
    ...(objectRecord
      ? {
          objectResourceId: objectRecord.resourceId,
          objectKey: objectRecord.objectKey,
          sizeBytes: objectRecord.sizeBytes,
          contentType: objectRecord.contentType
        }
      : {}),
    auditEnvelope: {
      actorUserId,
      correlationId,
      outcome,
      occurredAt
    }
  };
}
