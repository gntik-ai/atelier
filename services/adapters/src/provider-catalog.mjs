import {
  getContract,
  listAdapterPorts,
  listAdapterPortsForConsumer
} from '../../internal-contracts/src/index.mjs';
import {
  SUPPORTED_STORAGE_PROVIDER_TYPES,
  STORAGE_PROVIDER_CAPABILITY_BASELINE_VERSION,
  STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES,
  STORAGE_PROVIDER_CAPABILITY_IDS,
  STORAGE_PROVIDER_CAPABILITY_MANIFEST_VERSION,
  buildStorageCapabilityBaseline,
  buildStorageCapabilityDetails,
  buildStorageProviderProfile,
  listSupportedStorageProviders,
  summarizeStorageProviderCompatibility
} from './storage-provider-profile.mjs';
import {
  buildTenantStorageContextIntrospection,
  buildTenantStorageContextRecord,
  buildTenantStorageProvisioningEvent,
  previewWorkspaceStorageBootstrap,
  rotateTenantStorageContextCredential
} from './storage-tenant-context.mjs';
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
} from './storage-bucket-object-ops.mjs';
import {
  STORAGE_LOGICAL_ORGANIZATION_ERROR_CODES,
  buildStorageLogicalOrganization,
  buildStorageObjectOrganization,
  isStorageReservedPrefix
} from './storage-logical-organization.mjs';
import {
  STORAGE_ERROR_RETRYABILITY,
  STORAGE_NORMALIZED_ERROR_CODES,
  buildNormalizedStorageError,
  buildStorageErrorAuditEvent,
  buildStorageErrorEnvelope,
  buildStorageInternalErrorRecord,
  listStorageNormalizedErrorDefinitions
} from './storage-error-taxonomy.mjs';
import {
  VERIFICATION_FAILURE_TYPES,
  VERIFICATION_SCENARIO_CATEGORIES,
  VERIFICATION_VERDICT,
  buildCrossProviderEquivalenceAssessment as buildStorageVerificationCrossProviderEquivalenceAssessment,
  buildStorageVerificationAuditEvent,
  buildVerificationReport,
  buildVerificationRun,
  buildVerificationScenario,
  summarizeVerificationReport
} from './storage-provider-verification.mjs';
import {
  MULTIPART_LIFECYCLE_TRANSITIONS,
  MULTIPART_NORMALIZED_ERROR_CODES,
  MULTIPART_SESSION_STATES,
  PRESIGNED_URL_OPERATIONS,
  buildCapabilityNotAvailableError,
  buildMultipartAbortPreview,
  buildMultipartCompletionPreview,
  buildMultipartLifecycleAuditEvent,
  buildMultipartPartReceipt,
  buildMultipartSessionSummary,
  buildMultipartUploadList,
  buildMultipartUploadSession,
  buildPresignedUrlAuditEvent,
  buildPresignedUrlRecord,
  buildStaleSessionCleanupRecord,
  checkMultipartCapability,
  checkPresignedUrlCapability,
  evaluateMultipartSessionStaleness,
  validateMultipartObjectKey,
  validatePartList,
  validatePresignedTtl
} from './storage-multipart-presigned.mjs';
import {
  STORAGE_POLICY_ACTIONS,
  STORAGE_POLICY_CONDITION_TYPES,
  STORAGE_POLICY_EFFECTS,
  STORAGE_POLICY_NORMALIZED_ERROR_CODES,
  STORAGE_POLICY_PRINCIPAL_TYPES,
  STORAGE_POLICY_SOURCES,
  applyTenantStorageTemplateToWorkspace as applyTenantStorageTemplateToWorkspaceImpl,
  buildBuiltInWorkspaceStorageDefaults as buildBuiltInWorkspaceStorageDefaultsImpl,
  buildStorageBucketPolicy as buildStorageBucketPolicyImpl,
  buildStoragePolicyAttachmentSummary as buildStoragePolicyAttachmentSummaryImpl,
  buildStoragePolicyDecisionAuditEvent as buildStoragePolicyDecisionAuditEventImpl,
  buildStoragePolicyMutationAuditEvent as buildStoragePolicyMutationAuditEventImpl,
  buildStoragePolicyStatement as buildStoragePolicyStatementImpl,
  buildSuperadminBucketPolicyOverride as buildSuperadminBucketPolicyOverrideImpl,
  buildTenantStoragePermissionTemplate as buildTenantStoragePermissionTemplateImpl,
  buildWorkspaceStoragePermissionSet as buildWorkspaceStoragePermissionSetImpl,
  evaluateStorageAccessDecision as evaluateStorageAccessDecisionImpl,
  evaluateStoragePolicy as evaluateStoragePolicyImpl,
  matchStoragePolicyCondition as matchStoragePolicyConditionImpl,
  matchStoragePolicyPrincipal as matchStoragePolicyPrincipalImpl,
  matchStoragePolicyStatement as matchStoragePolicyStatementImpl,
  validateStoragePolicyDocument as validateStoragePolicyDocumentImpl,
  validateStoragePolicyStatement as validateStoragePolicyStatementImpl
} from './storage-access-policy.mjs';

export const providerAdapterCatalog = listAdapterPorts();
export const adapterCallContract = getContract('adapter_call');
export const adapterResultContract = getContract('adapter_result');
export const supportedStorageProviderTypes = SUPPORTED_STORAGE_PROVIDER_TYPES;
export const storageProviderCapabilityIds = STORAGE_PROVIDER_CAPABILITY_IDS;
export const storageProviderCapabilityManifestVersion = STORAGE_PROVIDER_CAPABILITY_MANIFEST_VERSION;
export const storageProviderCapabilityBaselineVersion = STORAGE_PROVIDER_CAPABILITY_BASELINE_VERSION;
export const storageProviderCapabilityEntryStates = STORAGE_PROVIDER_CAPABILITY_ENTRY_STATES;
export const storageBucketObjectErrorCodes = STORAGE_BUCKET_OBJECT_ERROR_CODES;
export const storageLogicalOrganizationErrorCodes = STORAGE_LOGICAL_ORGANIZATION_ERROR_CODES;
export const storageNormalizedErrorCodes = STORAGE_NORMALIZED_ERROR_CODES;
export const storageErrorRetryabilityModes = STORAGE_ERROR_RETRYABILITY;
export const storageVerificationScenarioCategories = VERIFICATION_SCENARIO_CATEGORIES;
export const storageVerificationFailureTypes = VERIFICATION_FAILURE_TYPES;
export const storageVerificationVerdicts = VERIFICATION_VERDICT;
export const storageMultipartSessionStates = MULTIPART_SESSION_STATES;
export const storageMultipartLifecycleTransitions = MULTIPART_LIFECYCLE_TRANSITIONS;
export const storagePresignedUrlOperations = PRESIGNED_URL_OPERATIONS;
export const storageMultipartNormalizedErrorCodes = MULTIPART_NORMALIZED_ERROR_CODES;
export const storagePolicyEffects = STORAGE_POLICY_EFFECTS;
export const storagePolicyPrincipalTypes = STORAGE_POLICY_PRINCIPAL_TYPES;
export const storagePolicyActions = STORAGE_POLICY_ACTIONS;
export const storagePolicySources = STORAGE_POLICY_SOURCES;
export const storagePolicyConditionTypes = STORAGE_POLICY_CONDITION_TYPES;
export const storagePolicyNormalizedErrorCodes = STORAGE_POLICY_NORMALIZED_ERROR_CODES;

export function listProvisioningAdapters() {
  return listAdapterPortsForConsumer('provisioning_orchestrator');
}

export function listAuditAdapters() {
  return listAdapterPortsForConsumer('audit_module');
}

export function listStorageProviderProfiles() {
  return listSupportedStorageProviders();
}

export function getStorageProviderProfile(input = {}) {
  return buildStorageProviderProfile(input);
}

export function getStorageProviderCompatibilitySummary(input = {}) {
  return summarizeStorageProviderCompatibility(input);
}

export function getStorageProviderCapabilityDetails(input = {}) {
  return buildStorageCapabilityDetails(input.providerType ?? input);
}

export function getStorageProviderCapabilityBaseline(input = {}) {
  return buildStorageCapabilityBaseline(input.providerType ?? input);
}

export function getTenantStorageContextRecord(input = {}) {
  return buildTenantStorageContextRecord(input);
}

export function getTenantStorageContextSummary(input = {}) {
  return buildTenantStorageContextIntrospection(input);
}

export function buildTenantStorageEvent(input = {}) {
  return buildTenantStorageProvisioningEvent(input);
}

export function getWorkspaceStorageBootstrapPreview(input = {}) {
  return previewWorkspaceStorageBootstrap(input);
}

export function rotateTenantStorageCredential(input = {}) {
  return rotateTenantStorageContextCredential(input);
}

export function getStorageLogicalOrganization(input = {}) {
  return buildStorageLogicalOrganization(input);
}

export function getStorageObjectOrganization(input = {}) {
  return buildStorageObjectOrganization(input);
}

export function isReservedStoragePrefix(input = {}) {
  return isStorageReservedPrefix(input);
}

export function getStorageBucketRecord(input = {}) {
  return buildStorageBucketRecord(input);
}

export function getStorageBucketSummary(input = {}) {
  return buildStorageBucketSummary(input);
}

export function listStorageBuckets(input = {}) {
  return buildStorageBucketCollection(input);
}

export function deleteStorageBucketPreview(input = {}) {
  return previewStorageBucketDeletion(input);
}

export function getStorageObjectRecord(input = {}) {
  return buildStorageObjectRecord(input);
}

export function getStorageObjectMetadata(input = {}) {
  return buildStorageObjectMetadata(input);
}

export function listStorageObjects(input = {}) {
  return buildStorageObjectCollection(input);
}

export function uploadStorageObjectPreview(input = {}) {
  return previewStorageObjectUpload(input);
}

export function downloadStorageObjectPreview(input = {}) {
  return previewStorageObjectDownload(input);
}

export function deleteStorageObjectPreview(input = {}) {
  return previewStorageObjectDeletion(input);
}

export function buildStorageOperationEvent(input = {}) {
  return buildStorageMutationEvent(input);
}

export function listStorageNormalizedErrors() {
  return listStorageNormalizedErrorDefinitions();
}

export function getStorageNormalizedError(input = {}) {
  return buildNormalizedStorageError(input);
}

export function getStorageErrorEnvelope(input = {}) {
  return buildStorageErrorEnvelope(input);
}

export function getStorageInternalErrorRecord(input = {}) {
  return buildStorageInternalErrorRecord(input);
}

export function buildStorageErrorEvent(input = {}) {
  return buildStorageErrorAuditEvent(input);
}

export function buildStorageVerificationRun(input = {}) {
  return buildVerificationRun(input);
}

export function buildStorageVerificationScenario(input = {}) {
  return buildVerificationScenario(input);
}

export function buildStorageVerificationReport(input = {}) {
  return buildVerificationReport(input);
}

export function buildCrossProviderEquivalenceAssessment(input = {}) {
  return buildStorageVerificationCrossProviderEquivalenceAssessment(input);
}

export function summarizeStorageVerificationReport(input = {}) {
  return summarizeVerificationReport(input);
}

export function buildStorageVerificationEvent(input = {}) {
  return buildStorageVerificationAuditEvent(input);
}

export function buildStorageMultipartSession(input = {}) {
  return buildMultipartUploadSession(input);
}

export function buildStorageMultipartPartReceipt(input = {}) {
  return buildMultipartPartReceipt(input);
}

export function buildStorageMultipartCompletionPreview(input = {}) {
  return buildMultipartCompletionPreview(input);
}

export function buildStorageMultipartAbortPreview(input = {}) {
  return buildMultipartAbortPreview(input);
}

export function buildStorageMultipartUploadList(input = {}) {
  return buildMultipartUploadList(input);
}

export function buildStorageMultipartSessionSummary(input = {}) {
  return buildMultipartSessionSummary(input);
}

export function buildStorageMultipartLifecycleEvent(input = {}) {
  return buildMultipartLifecycleAuditEvent(input);
}

export function evaluateStorageMultipartStaleness(input = {}) {
  return evaluateMultipartSessionStaleness(input);
}

export function buildStorageStaleSessionCleanupRecord(input = {}) {
  return buildStaleSessionCleanupRecord(input);
}

export function validateStoragePartList(input = {}) {
  return validatePartList(input);
}

export function validateStorageMultipartObjectKey(input = {}) {
  return validateMultipartObjectKey(input);
}

export function buildStoragePresignedUrlRecord(input = {}) {
  return buildPresignedUrlRecord(input);
}

export function buildStoragePresignedUrlAuditEvent(input = {}) {
  return buildPresignedUrlAuditEvent(input);
}

export function validateStoragePresignedTtl(input = {}) {
  return validatePresignedTtl(input);
}

export function checkStorageMultipartCapability(input = {}) {
  return checkMultipartCapability(input);
}

export function checkStoragePresignedUrlCapability(input = {}) {
  return checkPresignedUrlCapability(input);
}

export function buildStorageCapabilityNotAvailableError(input = {}) {
  return buildCapabilityNotAvailableError(input);
}

export function buildStoragePolicyStatement(input = {}) {
  return buildStoragePolicyStatementImpl(input);
}

export function buildStorageBucketPolicy(input = {}) {
  return buildStorageBucketPolicyImpl(input);
}

export function buildWorkspaceStoragePermissionSet(input = {}) {
  return buildWorkspaceStoragePermissionSetImpl(input);
}

export function buildTenantStoragePermissionTemplate(input = {}) {
  return buildTenantStoragePermissionTemplateImpl(input);
}

export function buildSuperadminBucketPolicyOverride(input = {}) {
  return buildSuperadminBucketPolicyOverrideImpl(input);
}

export function buildStoragePolicyAttachmentSummary(input = {}) {
  return buildStoragePolicyAttachmentSummaryImpl(input);
}

export function buildBuiltInWorkspaceStorageDefaults(input = {}) {
  return buildBuiltInWorkspaceStorageDefaultsImpl(input);
}

export function applyTenantStorageTemplateToWorkspace(input = {}) {
  return applyTenantStorageTemplateToWorkspaceImpl(input);
}

export function validateStoragePolicyStatement(input = {}) {
  return validateStoragePolicyStatementImpl(input);
}

export function validateStoragePolicyDocument(input = {}) {
  return validateStoragePolicyDocumentImpl(input);
}

export function matchStoragePolicyPrincipal(input = {}) {
  return matchStoragePolicyPrincipalImpl(input);
}

export function matchStoragePolicyCondition(input = {}) {
  return matchStoragePolicyConditionImpl(input);
}

export function matchStoragePolicyStatement(input = {}) {
  return matchStoragePolicyStatementImpl(input);
}

export function evaluateStoragePolicy(input = {}) {
  return evaluateStoragePolicyImpl(input);
}

export function evaluateStorageAccessDecision(input = {}) {
  return evaluateStorageAccessDecisionImpl(input);
}

export function buildStoragePolicyDecisionAuditEvent(input = {}) {
  return buildStoragePolicyDecisionAuditEventImpl(input);
}

export function buildStoragePolicyMutationAuditEvent(input = {}) {
  return buildStoragePolicyMutationAuditEventImpl(input);
}
