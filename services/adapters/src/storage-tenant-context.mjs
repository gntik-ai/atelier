import { createHash } from 'node:crypto';

import {
  getCommercialPlan,
  getQuotaPolicy,
  resolveTenantEffectiveCapabilities
} from '../../internal-contracts/src/index.mjs';
import {
  STORAGE_PROVIDER_ERROR_CODES,
  buildStorageProviderProfile
} from './storage-provider-profile.mjs';

const STORAGE_CAPABILITY_KEY = 'data.storage.bucket';
const STORAGE_BYTES_METRIC_KEY = 'tenant.storage.bytes.max';
const STORAGE_BUCKETS_METRIC_KEY = 'tenant.storage.buckets.max';
const NAMESPACE_HASH_SUFFIX_LENGTH = 12;
const DEFAULT_STORAGE_CAPACITY_BYTES = 10 * 1024 * 1024 * 1024;
const DEFAULT_STORAGE_BUCKET_LIMIT = 8;

export const TENANT_STORAGE_CONTEXT_STATES = Object.freeze([
  'draft',
  'provisioning',
  'active',
  'suspended',
  'soft_deleted'
]);

export const TENANT_STORAGE_CONTEXT_ERROR_CODES = Object.freeze({
  CAPABILITY_NOT_AVAILABLE: 'CAPABILITY_NOT_AVAILABLE',
  CONTEXT_MISSING: 'CONTEXT_MISSING',
  CONTEXT_PENDING: 'CONTEXT_PENDING',
  CONTEXT_SUSPENDED: 'CONTEXT_SUSPENDED',
  CONTEXT_SOFT_DELETED: 'CONTEXT_SOFT_DELETED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  PROVIDER_BASELINE_UNSATISFIED: 'PROVIDER_BASELINE_UNSATISFIED'
});

function slugify(value, fallback = 'tenant') {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);

  return normalized || fallback;
}

function hashNamespaceSeed(seed) {
  return createHash('sha256').update(seed).digest('hex').slice(0, NAMESPACE_HASH_SUFFIX_LENGTH);
}

function findQuotaLimit(quotaPolicy, metricKey) {
  return (quotaPolicy?.defaultLimits ?? []).find((limit) => limit.metricKey === metricKey)?.limit ?? null;
}

function hasStorageCapability(resolution) {
  return (resolution?.capabilities ?? []).some((capability) => capability.capabilityKey === STORAGE_CAPABILITY_KEY);
}

function normalizeCredentialHealth(state, provisioningStatus) {
  if (state === 'suspended') {
    return 'revoked';
  }

  if (state === 'soft_deleted') {
    return 'permanently_revoked';
  }

  if (provisioningStatus === 'capability_unavailable') {
    return 'not_issued';
  }

  return 'healthy';
}

function normalizeProvisioningStatus({ capabilityAvailable, providerStatus, providerBaselineEligible, tenantState }) {
  if (!capabilityAvailable) {
    return { status: 'capability_unavailable', retryable: false, reasonCode: TENANT_STORAGE_CONTEXT_ERROR_CODES.CAPABILITY_NOT_AVAILABLE };
  }

  if (providerStatus !== 'ready') {
    return {
      status: 'retryable_failure',
      retryable: true,
      reasonCode: TENANT_STORAGE_CONTEXT_ERROR_CODES.PROVIDER_UNAVAILABLE
    };
  }

  if (providerBaselineEligible === false) {
    return {
      status: 'blocked',
      retryable: false,
      reasonCode: TENANT_STORAGE_CONTEXT_ERROR_CODES.PROVIDER_BASELINE_UNSATISFIED
    };
  }

  if (tenantState === 'suspended') {
    return { status: 'suspended', retryable: false, reasonCode: null };
  }

  if (tenantState === 'deleted') {
    return { status: 'soft_deleted', retryable: false, reasonCode: null };
  }

  if (tenantState === 'pending_activation') {
    return { status: 'pending', retryable: false, reasonCode: null };
  }

  return { status: 'provisioned', retryable: false, reasonCode: null };
}

export function deriveTenantStorageNamespace({ tenantId, tenantSlug, providerType = 'storage' }) {
  if (!tenantId) {
    throw new Error('tenantId is required to derive a tenant storage namespace.');
  }

  const slugHint = slugify(tenantSlug ?? tenantId.replace(/^ten_?/, ''), 'tenant');
  const suffix = hashNamespaceSeed(`${providerType}:${tenantId}:tenant-storage-context`);

  return `tctx-${slugHint}-${suffix}`;
}

export function buildTenantStorageQuotaAssignment({ tenantId = null, planId, resolvedAt = '2026-03-27T00:00:00Z' }) {
  const plan = getCommercialPlan(planId);
  if (!plan) {
    throw new Error(`Unknown plan ${planId}.`);
  }

  const resolution = resolveTenantEffectiveCapabilities({ tenantId, planId, resolvedAt });
  const quotaPolicy = getQuotaPolicy(plan.quotaPolicyId);

  return {
    tenantId,
    planId: plan.planId,
    quotaPolicyId: plan.quotaPolicyId,
    capabilityKey: STORAGE_CAPABILITY_KEY,
    capabilityAvailable: hasStorageCapability(resolution),
    storageCapacityBytes: findQuotaLimit(quotaPolicy, STORAGE_BYTES_METRIC_KEY) ?? DEFAULT_STORAGE_CAPACITY_BYTES,
    maxBuckets: findQuotaLimit(quotaPolicy, STORAGE_BUCKETS_METRIC_KEY) ?? DEFAULT_STORAGE_BUCKET_LIMIT,
    source: 'governance_catalog',
    resolvedAt
  };
}

export function buildTenantStorageContextRecord({
  tenant,
  planId = tenant?.planId,
  storage = {},
  existingContext = null,
  now = '2026-03-27T00:00:00Z',
  correlationId = null,
  lifecycleTrigger = 'tenant_activation'
}) {
  if (!tenant?.tenantId) {
    throw new Error('tenant.tenantId is required to build a tenant storage context record.');
  }

  if (!planId) {
    throw new Error('planId is required to build a tenant storage context record.');
  }

  const providerProfile = buildStorageProviderProfile({ ...storage, storage });
  const quotaAssignment = buildTenantStorageQuotaAssignment({ tenantId: tenant.tenantId, planId, resolvedAt: now });
  const capabilityAvailable = quotaAssignment.capabilityAvailable;
  const providerBaselineEligible = providerProfile.capabilityBaseline?.eligible !== false;
  const provisioning = normalizeProvisioningStatus({
    capabilityAvailable,
    providerStatus: providerProfile.status,
    providerBaselineEligible,
    tenantState: tenant.state
  });
  const namespace = deriveTenantStorageNamespace({
    tenantId: tenant.tenantId,
    tenantSlug: tenant.slug,
    providerType: providerProfile.providerType ?? storage.providerType ?? 'storage'
  });
  const credentialVersion = existingContext?.credentialReference?.version ?? 1;
  const state = !capabilityAvailable
    ? 'draft'
    : tenant.state === 'suspended'
      ? 'suspended'
      : tenant.state === 'deleted'
        ? 'soft_deleted'
        : tenant.state === 'active' && providerProfile.status === 'ready' && providerBaselineEligible
          ? 'active'
          : tenant.state === 'pending_activation'
            ? 'draft'
            : 'provisioning';

  return {
    entityType: 'tenant_storage_context',
    tenantId: tenant.tenantId,
    namespace,
    namespaceBindingMode: 'tenant_isolated',
    state,
    providerType: providerProfile.providerType,
    providerDisplayName: providerProfile.displayName ?? providerProfile.providerType,
    providerStatus: providerProfile.status,
    providerConfiguredVia: providerProfile.configuredVia,
    providerRouteId: 'getStorageProviderIntrospection',
    providerCapabilities: {
      manifestVersion: providerProfile.capabilityManifestVersion,
      manifest: { ...providerProfile.capabilityManifest },
      details: providerProfile.capabilityDetails.map((entry) => ({
        capabilityId: entry.capabilityId,
        required: entry.required,
        state: entry.state,
        summary: entry.summary,
        constraints: entry.constraints.map((constraint) => ({ ...constraint }))
      })),
      baseline: {
        version: providerProfile.capabilityBaseline.version,
        checkedAt: providerProfile.capabilityBaseline.checkedAt,
        eligible: providerProfile.capabilityBaseline.eligible,
        requiredCapabilities: [...providerProfile.capabilityBaseline.requiredCapabilities],
        optionalCapabilities: [...providerProfile.capabilityBaseline.optionalCapabilities],
        missingCapabilities: providerProfile.capabilityBaseline.missingCapabilities.map((entry) => ({ ...entry })),
        insufficientCapabilities: providerProfile.capabilityBaseline.insufficientCapabilities.map((entry) => ({
          ...entry,
          constraints: (entry.constraints ?? []).map((constraint) => ({ ...constraint }))
        }))
      }
    },
    bucketProvisioningAllowed: state === 'active' && capabilityAvailable && providerProfile.status === 'ready' && providerBaselineEligible,
    quotaAssignment,
    credentialReference: {
      secretRef: existingContext?.credentialReference?.secretRef ?? `secret://tenants/${tenant.tenantId}/storage/context`,
      version: credentialVersion,
      health: normalizeCredentialHealth(state, provisioning.status),
      lastRotatedAt: existingContext?.credentialReference?.lastRotatedAt ?? now,
      lastValidatedAt: existingContext?.credentialReference?.lastValidatedAt ?? now
    },
    provisioning: {
      status: provisioning.status,
      retryable: provisioning.retryable,
      reasonCode:
        provisioning.reasonCode
        ?? (providerProfile.status !== 'ready' ? providerProfile.errorCode ?? STORAGE_PROVIDER_ERROR_CODES.STORAGE_UNAVAILABLE : null),
      lifecycleTrigger,
      idempotencyKey: `tenant-storage-context-${tenant.tenantId}`,
      correlationId,
      updatedAt: now
    },
    lifecycle: {
      tenantState: tenant.state,
      cascadesCredentialRevocation: ['suspended', 'soft_deleted'].includes(state)
    },
    managedResourceDependency: {
      resourceKey: 'default_storage_bucket',
      requiredState: 'active',
      satisfied: state === 'active' && capabilityAvailable && providerProfile.status === 'ready' && providerBaselineEligible
    },
    observedAt: now
  };
}

export function buildTenantStorageContextIntrospection(input) {
  const context = input?.entityType === 'tenant_storage_context' ? input : buildTenantStorageContextRecord(input ?? {});

  return {
    tenantId: context.tenantId,
    state: context.state,
    namespace: context.namespace,
    namespaceBindingMode: context.namespaceBindingMode,
    providerType: context.providerType,
    providerDisplayName: context.providerDisplayName,
    providerStatus: context.providerStatus,
    providerRouteId: context.providerRouteId,
    providerCapabilities: {
      manifestVersion: context.providerCapabilities.manifestVersion,
      manifest: { ...context.providerCapabilities.manifest },
      details: context.providerCapabilities.details.map((entry) => ({
        capabilityId: entry.capabilityId,
        required: entry.required,
        state: entry.state,
        summary: entry.summary,
        constraints: entry.constraints.map((constraint) => ({ ...constraint }))
      })),
      baseline: {
        version: context.providerCapabilities.baseline.version,
        checkedAt: context.providerCapabilities.baseline.checkedAt,
        eligible: context.providerCapabilities.baseline.eligible,
        requiredCapabilities: [...context.providerCapabilities.baseline.requiredCapabilities],
        optionalCapabilities: [...context.providerCapabilities.baseline.optionalCapabilities],
        missingCapabilities: context.providerCapabilities.baseline.missingCapabilities.map((entry) => ({ ...entry })),
        insufficientCapabilities: context.providerCapabilities.baseline.insufficientCapabilities.map((entry) => ({
          ...entry,
          constraints: (entry.constraints ?? []).map((constraint) => ({ ...constraint }))
        }))
      }
    },
    bucketProvisioningAllowed: context.bucketProvisioningAllowed,
    provisioning: { ...context.provisioning },
    quotaAssignment: { ...context.quotaAssignment },
    credential: {
      health: context.credentialReference.health,
      version: context.credentialReference.version,
      lastRotatedAt: context.credentialReference.lastRotatedAt,
      lastValidatedAt: context.credentialReference.lastValidatedAt,
      secretReferencePresent: Boolean(context.credentialReference.secretRef)
    },
    managedResourceDependency: { ...context.managedResourceDependency },
    observedAt: context.observedAt
  };
}

export function rotateTenantStorageContextCredential({
  storageContext,
  requestedAt = '2026-03-27T00:00:00Z',
  actorUserId = null,
  correlationId = null,
  reason = 'operator_rotation'
}) {
  const context = storageContext?.entityType === 'tenant_storage_context'
    ? storageContext
    : buildTenantStorageContextRecord(storageContext ?? {});

  const nextVersion = (context.credentialReference?.version ?? 1) + 1;
  const suffix = hashNamespaceSeed(`${context.tenantId}:${nextVersion}:rotation`);

  return {
    ...context,
    credentialReference: {
      ...context.credentialReference,
      secretRef: `secret://tenants/${context.tenantId}/storage/context/${suffix}`,
      version: nextVersion,
      health: context.state === 'active' ? 'rotated' : normalizeCredentialHealth(context.state, context.provisioning?.status),
      lastRotatedAt: requestedAt,
      lastValidatedAt: requestedAt
    },
    provisioning: {
      ...context.provisioning,
      updatedAt: requestedAt,
      lastRotationActorUserId: actorUserId,
      lastRotationReason: reason,
      correlationId: correlationId ?? context.provisioning?.correlationId ?? null
    },
    observedAt: requestedAt
  };
}

export function buildTenantStorageProvisioningEvent({
  storageContext,
  transition,
  occurredAt = '2026-03-27T00:00:00Z',
  actorUserId = null,
  correlationId = null,
  outcome = 'accepted'
}) {
  const context = storageContext?.entityType === 'tenant_storage_context'
    ? storageContext
    : buildTenantStorageContextRecord(storageContext ?? {});

  return {
    eventType: `tenant_storage_context.${transition}`,
    entityType: 'tenant_storage_context',
    entityId: `tsc_${context.tenantId}`,
    tenantId: context.tenantId,
    transition,
    state: context.state,
    namespace: context.namespace,
    providerType: context.providerType,
    credentialHealth: context.credentialReference.health,
    quotaAssignment: {
      storageCapacityBytes: context.quotaAssignment.storageCapacityBytes,
      maxBuckets: context.quotaAssignment.maxBuckets,
      planId: context.quotaAssignment.planId,
      quotaPolicyId: context.quotaAssignment.quotaPolicyId
    },
    auditEnvelope: {
      actorUserId,
      correlationId: correlationId ?? context.provisioning?.correlationId ?? null,
      outcome,
      occurredAt
    }
  };
}

export function previewWorkspaceStorageBootstrap({
  tenantId,
  workspaceId,
  workspaceSlug,
  storageContext,
  now = '2026-03-27T00:00:00Z'
}) {
  const bucketNameHint = `${slugify(workspaceSlug ?? workspaceId ?? 'workspace', 'workspace')}-default`;

  if (!storageContext) {
    return {
      tenantId,
      workspaceId,
      requestedState: 'dependency_wait',
      reasonCode: TENANT_STORAGE_CONTEXT_ERROR_CODES.CONTEXT_MISSING,
      dependency: {
        entityType: 'tenant_storage_context',
        tenantId,
        requiredState: 'active',
        currentState: 'missing'
      },
      bucketNameHint,
      namespace: null,
      observedAt: now
    };
  }

  const currentState = storageContext.state ?? 'draft';
  if (currentState === 'active' && storageContext.bucketProvisioningAllowed !== false) {
    return {
      tenantId: storageContext.tenantId ?? tenantId,
      workspaceId,
      requestedState: 'pending',
      reasonCode: null,
      dependency: {
        entityType: 'tenant_storage_context',
        tenantId: storageContext.tenantId ?? tenantId,
        requiredState: 'active',
        currentState
      },
      bucketNameHint,
      namespace: storageContext.namespace,
      providerType: storageContext.providerType,
      observedAt: now
    };
  }

  const reasonCode = currentState === 'suspended'
    ? TENANT_STORAGE_CONTEXT_ERROR_CODES.CONTEXT_SUSPENDED
    : currentState === 'soft_deleted'
      ? TENANT_STORAGE_CONTEXT_ERROR_CODES.CONTEXT_SOFT_DELETED
      : storageContext.provisioning?.reasonCode === TENANT_STORAGE_CONTEXT_ERROR_CODES.CAPABILITY_NOT_AVAILABLE
        ? TENANT_STORAGE_CONTEXT_ERROR_CODES.CAPABILITY_NOT_AVAILABLE
        : storageContext.provisioning?.reasonCode === TENANT_STORAGE_CONTEXT_ERROR_CODES.PROVIDER_BASELINE_UNSATISFIED
          ? TENANT_STORAGE_CONTEXT_ERROR_CODES.PROVIDER_BASELINE_UNSATISFIED
          : TENANT_STORAGE_CONTEXT_ERROR_CODES.CONTEXT_PENDING;

  return {
    tenantId: storageContext.tenantId ?? tenantId,
    workspaceId,
    requestedState: ['suspended', 'soft_deleted'].includes(currentState)
      || reasonCode === TENANT_STORAGE_CONTEXT_ERROR_CODES.CAPABILITY_NOT_AVAILABLE
      || reasonCode === TENANT_STORAGE_CONTEXT_ERROR_CODES.PROVIDER_BASELINE_UNSATISFIED
      ? 'blocked'
      : 'dependency_wait',
    reasonCode,
    dependency: {
      entityType: 'tenant_storage_context',
      tenantId: storageContext.tenantId ?? tenantId,
      requiredState: 'active',
      currentState
    },
    bucketNameHint,
    namespace: storageContext.namespace ?? null,
    providerType: storageContext.providerType ?? null,
    observedAt: now
  };
}

// ── T02 provisional workflow helpers (guarded stubs) ─────────────────────────

export async function provisionWorkspaceStorageBoundary() {
  const error = new Error('NOT_YET_IMPLEMENTED: provisionWorkspaceStorageBoundary');
  error.code = 'NOT_YET_IMPLEMENTED';
  throw error;
}
