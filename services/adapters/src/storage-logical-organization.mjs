import { buildTenantStorageContextRecord } from './storage-tenant-context.mjs';

const ORGANIZATION_STRATEGY = 'tenant-workspace-application-prefix-v1';
const ORGANIZATION_LAYOUT_VERSION = 'v1';
const RESERVED_PLATFORM_ROOT = '_platform';

export const STORAGE_LOGICAL_ORGANIZATION_ERROR_CODES = Object.freeze({
  INVALID_WORKSPACE_SCOPE: 'INVALID_WORKSPACE_SCOPE',
  INVALID_APPLICATION_SCOPE: 'INVALID_APPLICATION_SCOPE',
  RESERVED_PREFIX_CONFLICT: 'RESERVED_PREFIX_CONFLICT'
});

const RESERVED_PREFIX_DEFINITIONS = Object.freeze([
  {
    key: 'presigned',
    suffix: `${RESERVED_PLATFORM_ROOT}/presigned/`,
    purpose: 'Platform-managed keyspace for presigned URL orchestration and evidence.'
  },
  {
    key: 'multipart',
    suffix: `${RESERVED_PLATFORM_ROOT}/multipart/`,
    purpose: 'Platform-managed keyspace for multipart upload coordination and staging.'
  },
  {
    key: 'events',
    suffix: `${RESERVED_PLATFORM_ROOT}/events/`,
    purpose: 'Platform-managed keyspace for storage event delivery, buffering, or evidence.'
  }
]);

function trimSlash(value) {
  return String(value).replace(/^\/+|\/+$/g, '');
}

function ensureScopeValue(value, errorCode, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(errorCode ?? `${label} is required.`);
  }

  return value.trim();
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
      now: input.now,
      correlationId: input.correlationId ?? null
    });
  }

  return null;
}

function resolveTenantId(input = {}, tenantStorageContext = null) {
  return input.tenantId
    ?? input.bucket?.tenantId
    ?? tenantStorageContext?.tenantId
    ?? input.tenant?.tenantId
    ?? null;
}

function resolveWorkspaceId(input = {}) {
  return input.workspaceId ?? input.bucket?.workspaceId ?? null;
}

function buildTenantRootPrefix(tenantId) {
  return `tenants/${tenantId}/`;
}

function buildWorkspaceRootPrefix(tenantId, workspaceId) {
  return `${buildTenantRootPrefix(tenantId)}workspaces/${workspaceId}/`;
}

function buildReservedPrefixes(workspaceRootPrefix) {
  return RESERVED_PREFIX_DEFINITIONS.map((definition) => ({
    key: definition.key,
    prefix: `${workspaceRootPrefix}${definition.suffix}`,
    purpose: definition.purpose
  }));
}

function assertRequestedPrefixAllowed(requestedPrefix, reservedPrefixes) {
  if (!requestedPrefix) {
    return;
  }

  const normalizedRequestedPrefix = trimSlash(requestedPrefix);
  const matchedReservedPrefix = reservedPrefixes.find((reservedPrefix) => normalizedRequestedPrefix === trimSlash(reservedPrefix.prefix)
    || normalizedRequestedPrefix.startsWith(trimSlash(reservedPrefix.prefix)));

  if (matchedReservedPrefix) {
    throw new Error(STORAGE_LOGICAL_ORGANIZATION_ERROR_CODES.RESERVED_PREFIX_CONFLICT);
  }
}

export function buildStorageLogicalOrganization(input = {}) {
  const tenantStorageContext = resolveTenantStorageContext(input);
  const tenantId = ensureScopeValue(
    resolveTenantId(input, tenantStorageContext),
    STORAGE_LOGICAL_ORGANIZATION_ERROR_CODES.INVALID_WORKSPACE_SCOPE,
    'tenantId'
  );
  const workspaceId = ensureScopeValue(
    resolveWorkspaceId(input),
    STORAGE_LOGICAL_ORGANIZATION_ERROR_CODES.INVALID_WORKSPACE_SCOPE,
    'workspaceId'
  );
  const workspaceRootPrefix = buildWorkspaceRootPrefix(tenantId, workspaceId);
  const reservedPrefixes = buildReservedPrefixes(workspaceRootPrefix);

  return {
    strategy: ORGANIZATION_STRATEGY,
    layoutVersion: ORGANIZATION_LAYOUT_VERSION,
    tenantRootPrefix: buildTenantRootPrefix(tenantId),
    workspaceRootPrefix,
    workspaceSharedPrefix: `${workspaceRootPrefix}shared/`,
    applicationRootPrefixTemplate: `${workspaceRootPrefix}apps/{applicationId}/data/`,
    reservedPrefixes,
    quotaAttributionMode: 'tenant>workspace>application',
    auditScopeMode: 'tenant_workspace_application',
    slugIndependent: true,
    ...(input.workspaceSlug ? { workspaceSlug: input.workspaceSlug } : {}),
    ...(tenantStorageContext?.namespace ? { namespace: tenantStorageContext.namespace } : {})
  };
}

export function buildStorageObjectOrganization(input = {}) {
  const organization = input.organization?.strategy ? input.organization : buildStorageLogicalOrganization(input);
  const workspaceId = ensureScopeValue(
    resolveWorkspaceId(input),
    STORAGE_LOGICAL_ORGANIZATION_ERROR_CODES.INVALID_WORKSPACE_SCOPE,
    'workspaceId'
  );
  const objectKey = ensureScopeValue(input.objectKey ?? input.object?.objectKey, undefined, 'objectKey');
  const applicationId = input.applicationId ?? input.object?.applicationId ?? null;

  if (applicationId !== null && (typeof applicationId !== 'string' || !applicationId.trim())) {
    throw new Error(STORAGE_LOGICAL_ORGANIZATION_ERROR_CODES.INVALID_APPLICATION_SCOPE);
  }

  assertRequestedPrefixAllowed(input.requestedPrefix ?? input.objectPrefix, organization.reservedPrefixes ?? []);

  const normalizedObjectKey = trimSlash(objectKey);
  const objectPrefix = applicationId
    ? organization.applicationRootPrefixTemplate.replace('{applicationId}', applicationId.trim())
    : organization.workspaceSharedPrefix;
  const canonicalObjectPath = `${objectPrefix}${normalizedObjectKey}`;

  return {
    strategy: organization.strategy,
    layoutVersion: organization.layoutVersion,
    placementType: applicationId ? 'application' : 'workspace_shared',
    tenantRootPrefix: organization.tenantRootPrefix,
    workspaceRootPrefix: organization.workspaceRootPrefix,
    objectPrefix,
    canonicalObjectPath,
    quotaAttributionKey: applicationId ? `application:${applicationId.trim()}` : `workspace:${workspaceId}`,
    auditResourceKey: applicationId ? `storage.application.${applicationId.trim()}` : `storage.workspace.${workspaceId}`,
    ...(applicationId
      ? {
          applicationId: applicationId.trim(),
          applicationRootPrefix: objectPrefix,
          ...(input.applicationSlug ? { applicationSlug: input.applicationSlug } : {})
        }
      : {
          workspaceSharedPrefix: organization.workspaceSharedPrefix
        })
  };
}

export function isStorageReservedPrefix(input = {}) {
  const organization = input.organization?.strategy ? input.organization : buildStorageLogicalOrganization(input);
  const candidate = input.candidatePrefix ?? input.requestedPrefix ?? input.objectPrefix ?? '';
  const normalizedCandidate = trimSlash(candidate);

  return (organization.reservedPrefixes ?? []).some((reservedPrefix) => normalizedCandidate === trimSlash(reservedPrefix.prefix)
    || normalizedCandidate.startsWith(trimSlash(reservedPrefix.prefix)));
}
