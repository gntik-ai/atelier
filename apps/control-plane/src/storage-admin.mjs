import {
  filterPublicRoutes,
  getApiFamily,
  getPublicRoute
} from '../../../services/internal-contracts/src/index.mjs';
import {
  STORAGE_PROVIDER_ERROR_CODES,
  STORAGE_PROVIDER_CAPABILITY_BASELINE_VERSION,
  STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES,
  STORAGE_PROVIDER_CAPABILITY_FIELDS,
  STORAGE_PROVIDER_CAPABILITY_IDS,
  STORAGE_PROVIDER_CAPABILITY_MANIFEST_VERSION,
  buildStorageCapabilityBaseline,
  buildStorageCapabilityDetails,
  buildStorageProviderProfile,
  listSupportedStorageProviders,
  summarizeStorageProviderCompatibility
} from '../../../services/adapters/src/storage-provider-profile.mjs';
import {
  TENANT_STORAGE_CONTEXT_ERROR_CODES,
  buildTenantStorageContextIntrospection,
  buildTenantStorageContextRecord,
  buildTenantStorageProvisioningEvent,
  previewWorkspaceStorageBootstrap,
  rotateTenantStorageContextCredential
} from '../../../services/adapters/src/storage-tenant-context.mjs';
import {
  STORAGE_BUCKET_OBJECT_ERROR_CODES,
  buildStorageBucketCollection,
  buildStorageBucketRecord,
  buildStorageBucketSummary,
  buildStorageMutationEvent,
  buildStorageObjectCollection,
  buildStorageObjectMetadata,
  buildStorageObjectRecord,
  previewStorageBucketDeletion,
  previewStorageObjectDeletion,
  previewStorageObjectDownload,
  previewStorageObjectUpload
} from '../../../services/adapters/src/storage-bucket-object-ops.mjs';
import {
  STORAGE_LOGICAL_ORGANIZATION_ERROR_CODES,
  buildStorageLogicalOrganization,
  buildStorageObjectOrganization,
  isStorageReservedPrefix
} from '../../../services/adapters/src/storage-logical-organization.mjs';
import {
  STORAGE_ERROR_RETRYABILITY,
  STORAGE_NORMALIZED_ERROR_CODES,
  buildNormalizedStorageError,
  buildStorageErrorAuditEvent,
  buildStorageErrorEnvelope,
  buildStorageInternalErrorRecord,
  listStorageNormalizedErrorDefinitions
} from '../../../services/adapters/src/storage-error-taxonomy.mjs';
import {
  STORAGE_PROGRAMMATIC_CREDENTIAL_ALLOWED_ACTIONS,
  STORAGE_PROGRAMMATIC_CREDENTIAL_ERROR_CODES,
  STORAGE_PROGRAMMATIC_CREDENTIAL_STATES,
  STORAGE_PROGRAMMATIC_CREDENTIAL_TYPES,
  buildStorageProgrammaticCredentialCollection,
  buildStorageProgrammaticCredentialRecord,
  buildStorageProgrammaticCredentialSecretEnvelope,
  revokeStorageProgrammaticCredential,
  rotateStorageProgrammaticCredential
} from '../../../services/adapters/src/storage-programmatic-credentials.mjs';

export const storageApiFamily = getApiFamily('storage');
export const STORAGE_ADMIN_ERROR_CODES = STORAGE_PROVIDER_ERROR_CODES;
export const TENANT_STORAGE_ERROR_CODES = TENANT_STORAGE_CONTEXT_ERROR_CODES;
export const STORAGE_BUCKET_OBJECT_ERRORS = STORAGE_BUCKET_OBJECT_ERROR_CODES;
export const STORAGE_LOGICAL_ORGANIZATION_ERRORS = STORAGE_LOGICAL_ORGANIZATION_ERROR_CODES;
export const STORAGE_PROVIDER_CAPABILITIES = STORAGE_PROVIDER_CAPABILITY_FIELDS;
export const STORAGE_PROVIDER_CAPABILITY_IDS_CATALOG = STORAGE_PROVIDER_CAPABILITY_IDS;
export const STORAGE_PROVIDER_CAPABILITY_ENTRY_STATE_CATALOG = STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES;
export const STORAGE_PROVIDER_CAPABILITY_MANIFEST_SCHEMA_VERSION = STORAGE_PROVIDER_CAPABILITY_MANIFEST_VERSION;
export const STORAGE_PROVIDER_CAPABILITY_BASELINE_SCHEMA_VERSION = STORAGE_PROVIDER_CAPABILITY_BASELINE_VERSION;
export const STORAGE_NORMALIZED_ERROR_CATALOG = STORAGE_NORMALIZED_ERROR_CODES;
export const STORAGE_ERROR_RETRYABILITY_CATALOG = STORAGE_ERROR_RETRYABILITY;
export const STORAGE_PROGRAMMATIC_CREDENTIAL_TYPE_CATALOG = STORAGE_PROGRAMMATIC_CREDENTIAL_TYPES;
export const STORAGE_PROGRAMMATIC_CREDENTIAL_STATE_CATALOG = STORAGE_PROGRAMMATIC_CREDENTIAL_STATES;
export const STORAGE_PROGRAMMATIC_CREDENTIAL_ALLOWED_ACTION_CATALOG = STORAGE_PROGRAMMATIC_CREDENTIAL_ALLOWED_ACTIONS;
export const STORAGE_PROGRAMMATIC_CREDENTIAL_ERROR_CATALOG = STORAGE_PROGRAMMATIC_CREDENTIAL_ERROR_CODES;

function matchesRouteFilters(route, filters = {}) {
  return Object.entries(filters).every(([key, value]) => route?.[key] === value);
}

export function listStorageAdminRoutes(filters = {}) {
  const storageRoutes = filterPublicRoutes({ family: 'storage' });
  const providerRoute = getPublicRoute('getStorageProviderIntrospection');
  const tenantContextRoute = getPublicRoute('getTenantStorageContext');
  const tenantRotationRoute = getPublicRoute('rotateTenantStorageContextCredential');
  const storageCredentialRoutes = [
    getPublicRoute('listStorageProgrammaticCredentials'),
    getPublicRoute('createStorageProgrammaticCredential'),
    getPublicRoute('getStorageProgrammaticCredential'),
    getPublicRoute('rotateStorageProgrammaticCredential'),
    getPublicRoute('revokeStorageProgrammaticCredential')
  ];
  const combinedRoutes = [
    ...storageRoutes,
    providerRoute,
    tenantContextRoute,
    tenantRotationRoute,
    ...storageCredentialRoutes
  ].filter(Boolean);

  return combinedRoutes.filter((route) => matchesRouteFilters(route, filters));
}

export const storageAdminRoutes = listStorageAdminRoutes();

export function getStorageAdminRoute(operationId) {
  const route = getPublicRoute(operationId);
  return route && (route.family === 'storage' || ['storage_provider', 'tenant_storage_context', 'bucket_object', 'storage_credential'].includes(route.resourceType))
    ? route
    : undefined;
}

export function summarizeStorageProviderSupport(input = {}) {
  return buildStorageProviderProfile(input);
}

export function summarizeStorageProviderIntrospection(input = {}) {
  const route = getStorageAdminRoute('getStorageProviderIntrospection');
  const profile = summarizeStorageProviderSupport(input);

  return {
    route,
    profile,
    supportedProviders: listSupportedStorageProviders(),
    capabilityFields: [...STORAGE_PROVIDER_CAPABILITY_FIELDS]
  };
}

export function getStorageCompatibilitySummary(input = {}) {
  const compatibility = summarizeStorageProviderCompatibility(input);
  const providerRoute = getStorageAdminRoute('getStorageProviderIntrospection');

  return {
    ...compatibility,
    routeIds: providerRoute ? [providerRoute.operationId] : [],
    publicBucketRoutes: storageAdminRoutes
      .filter((route) => route.resourceType === 'bucket')
      .map((route) => route.operationId),
    publicObjectRoutes: storageAdminRoutes
      .filter((route) => route.resourceType === 'bucket_object')
      .map((route) => route.operationId),
    publicCredentialRoutes: storageAdminRoutes
      .filter((route) => route.resourceType === 'storage_credential')
      .map((route) => route.operationId)
  };
}

export function summarizeStorageCapabilityBaseline(input = {}) {
  return buildStorageCapabilityBaseline(input.providerType ?? input);
}

export function summarizeStorageCapabilityDetails(input = {}) {
  return buildStorageCapabilityDetails(input.providerType ?? input);
}

export function listStorageNormalizedErrors() {
  return listStorageNormalizedErrorDefinitions();
}

export function previewStorageNormalizedError(input = {}) {
  return buildNormalizedStorageError(input);
}

export function previewStorageErrorEnvelope(input = {}) {
  return buildStorageErrorEnvelope(input);
}

export function previewStorageInternalErrorRecord(input = {}) {
  return buildStorageInternalErrorRecord(input);
}

export function buildStorageErrorEvent(input = {}) {
  return buildStorageErrorAuditEvent(input);
}

export function previewTenantStorageContext(input = {}) {
  return buildTenantStorageContextRecord(input);
}

export function summarizeTenantStorageContext(input = {}) {
  const context = previewTenantStorageContext(input);
  const route = getStorageAdminRoute('getTenantStorageContext');

  return {
    route,
    context: buildTenantStorageContextIntrospection(context)
  };
}

export function rotateTenantStorageCredentialPreview(input = {}) {
  const rotatedContext = rotateTenantStorageContextCredential(input);
  const route = getStorageAdminRoute('rotateTenantStorageContextCredential');

  return {
    route,
    context: buildTenantStorageContextIntrospection(rotatedContext)
  };
}

export function previewStorageProgrammaticCredential(input = {}) {
  return buildStorageProgrammaticCredentialRecord(input);
}

export function issueStorageProgrammaticCredentialPreview(input = {}) {
  const route = getStorageAdminRoute('createStorageProgrammaticCredential');

  return {
    route,
    envelope: buildStorageProgrammaticCredentialSecretEnvelope(input)
  };
}

export function listStorageProgrammaticCredentialsPreview(input = {}) {
  const route = getStorageAdminRoute('listStorageProgrammaticCredentials');

  return {
    route,
    collection: buildStorageProgrammaticCredentialCollection(input)
  };
}

export function summarizeStorageProgrammaticCredential(input = {}) {
  const route = getStorageAdminRoute('getStorageProgrammaticCredential');
  const credential = input.credentialId ? input : buildStorageProgrammaticCredentialRecord(input);

  return {
    route,
    credential
  };
}

export function rotateStorageProgrammaticCredentialPreview(input = {}) {
  const route = getStorageAdminRoute('rotateStorageProgrammaticCredential');

  return {
    route,
    envelope: rotateStorageProgrammaticCredential(input)
  };
}

export function revokeStorageProgrammaticCredentialPreview(input = {}) {
  const route = getStorageAdminRoute('revokeStorageProgrammaticCredential');

  return {
    route,
    credential: revokeStorageProgrammaticCredential(input)
  };
}

export function buildTenantStorageEvent(input = {}) {
  return buildTenantStorageProvisioningEvent(input);
}

export function previewWorkspaceStorageBootstrapContext(input = {}) {
  return previewWorkspaceStorageBootstrap(input);
}

export function previewStorageLogicalOrganization(input = {}) {
  return buildStorageLogicalOrganization(input);
}

export function previewStorageObjectOrganization(input = {}) {
  return buildStorageObjectOrganization(input);
}

export function previewReservedStoragePrefix(input = {}) {
  return isStorageReservedPrefix(input);
}

export function previewStorageBucket(input = {}) {
  return buildStorageBucketRecord(input);
}

export function summarizeStorageBucket(input = {}) {
  const bucket = input.resourceId ? input : previewStorageBucket(input);
  const route = getStorageAdminRoute('getStorage');

  return {
    route,
    bucket: buildStorageBucketSummary(bucket)
  };
}

export function listStorageBucketsPreview(input = {}) {
  const route = getStorageAdminRoute('listStorage');
  const items = (input.items ?? []).map((item) => item.resourceId ? item : buildStorageBucketRecord(item));

  return {
    route,
    collection: buildStorageBucketCollection({ items, page: input.page })
  };
}

export function deleteStorageBucketPreview(input = {}) {
  const route = getStorageAdminRoute('deleteStorage');
  const bucket = input.bucket?.resourceId ? input.bucket : buildStorageBucketRecord(input.bucket ?? input);

  return {
    route,
    ...previewStorageBucketDeletion({ bucket, now: input.now })
  };
}

export function previewStorageObject(input = {}) {
  return buildStorageObjectRecord(input);
}

export function summarizeStorageObjectMetadata(input = {}) {
  const object = input.resourceId ? input : previewStorageObject(input);
  const route = getStorageAdminRoute('getStorageObjectMetadata');

  return {
    route,
    object: buildStorageObjectMetadata(object)
  };
}

export function listStorageObjectsPreview(input = {}) {
  const route = getStorageAdminRoute('listStorageObjects');
  const items = (input.items ?? []).map((item) => item.resourceId ? item : buildStorageObjectRecord(item));

  return {
    route,
    collection: buildStorageObjectCollection({ items, page: input.page })
  };
}

export function uploadStorageObjectPreviewResult(input = {}) {
  const route = getStorageAdminRoute('uploadStorageObject');
  const bucket = input.bucket?.resourceId ? input.bucket : buildStorageBucketRecord(input.bucket ?? {});
  const object = input.object?.resourceId ? input.object : buildStorageObjectRecord({ bucket, ...(input.object ?? input) });

  return {
    route,
    ...previewStorageObjectUpload({ bucket, object, requestedAt: input.requestedAt })
  };
}

export function downloadStorageObjectPreviewResult(input = {}) {
  const route = getStorageAdminRoute('downloadStorageObject');
  const bucket = input.bucket?.resourceId ? input.bucket : buildStorageBucketRecord(input.bucket ?? {});
  const object = input.object?.resourceId ? input.object : buildStorageObjectRecord({ bucket, ...(input.object ?? input) });

  return {
    route,
    ...previewStorageObjectDownload({ bucket, object, requestedAt: input.requestedAt })
  };
}

export function deleteStorageObjectPreviewResult(input = {}) {
  const route = getStorageAdminRoute('deleteStorageObject');
  const bucket = input.bucket?.resourceId ? input.bucket : buildStorageBucketRecord(input.bucket ?? {});
  const object = input.object?.resourceId ? input.object : buildStorageObjectRecord({ bucket, ...(input.object ?? input) });

  return {
    route,
    ...previewStorageObjectDeletion({ bucket, object, requestedAt: input.requestedAt })
  };
}

export function buildStorageOperationEvent(input = {}) {
  return buildStorageMutationEvent(input);
}
