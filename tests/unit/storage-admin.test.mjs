import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STORAGE_ADMIN_ERROR_CODES,
  STORAGE_IMPORT_CONFLICT_POLICIES,
  STORAGE_IMPORT_ENTRY_STATUSES,
  STORAGE_IMPORT_EXPORT_ERROR_CODES,
  STORAGE_IMPORT_EXPORT_MANIFEST_VERSION,
  STORAGE_IMPORT_EXPORT_OPERATION_DEFAULTS,
  STORAGE_BUCKET_OBJECT_ERRORS,
  STORAGE_LOGICAL_ORGANIZATION_ERRORS,
  STORAGE_NORMALIZED_ERROR_CATALOG,
  STORAGE_PROGRAMMATIC_CREDENTIAL_ALLOWED_ACTION_CATALOG,
  STORAGE_PROGRAMMATIC_CREDENTIAL_STATE_CATALOG,
  STORAGE_PROGRAMMATIC_CREDENTIAL_TYPE_CATALOG,
  STORAGE_USAGE_COLLECTION_METHODS,
  STORAGE_USAGE_COLLECTION_STATUSES,
  STORAGE_USAGE_ERROR_CODES,
  STORAGE_USAGE_THRESHOLD_DEFAULTS,
  STORAGE_USAGE_THRESHOLD_SEVERITIES,
  STORAGE_PROVIDER_CAPABILITIES,
  STORAGE_PROVIDER_CAPABILITY_BASELINE_SCHEMA_VERSION,
  STORAGE_PROVIDER_CAPABILITY_ENTRY_STATE_CATALOG,
  STORAGE_PROVIDER_CAPABILITY_IDS_CATALOG,
  STORAGE_PROVIDER_CAPABILITY_MANIFEST_SCHEMA_VERSION,
  STORAGE_ERROR_RETRYABILITY_CATALOG,
  STORAGE_AUDIT_OPERATION_TYPES,
  STORAGE_AUDIT_COVERAGE_CATEGORIES,
  TENANT_STORAGE_ERROR_CODES,
  buildStorageAccessDeniedAuditEvent,
  buildStorageAdminAuditEvent,
  buildStorageAuditCoverageReport,
  buildStorageCredentialLifecycleAuditEvent,
  buildStorageErrorEvent,
  buildStorageOperationEvent,
  buildTenantStorageEvent,
  deleteStorageBucketPreview,
  deleteStorageObjectPreviewResult,
  downloadStorageObjectPreviewResult,
  emitStorageAuditEvent,
  getStorageAdminRoute,
  getStorageCompatibilitySummary,
  listStorageAdminRoutes,
  listStorageBucketsPreview,
  listStorageObjectsPreview,
  previewReservedStoragePrefix,
  previewStorageBucket,
  queryStorageAuditTrail,
  previewStorageErrorEnvelope,
  previewStorageInternalErrorRecord,
  previewStorageExportManifest,
  previewStorageImportResult,
  previewStorageLogicalOrganization,
  previewStorageObject,
  previewStorageNormalizedError,
  previewStorageObjectOrganization,
  previewBucketStorageUsage,
  previewCrossTenantStorageUsage,
  previewStorageProgrammaticCredential,
  validateStorageImportManifest,
  checkStorageImportExportLimit,
  previewTenantStorageContext,
  previewTenantStorageUsage,
  previewWorkspaceStorageBootstrapContext,
  previewWorkspaceStorageUsage,
  rankWorkspaceBucketsByUsage,
  revokeStorageProgrammaticCredentialPreview,
  rotateStorageProgrammaticCredentialPreview,
  listStorageAuditRoutes,
  rotateTenantStorageCredentialPreview,
  summarizeStorageBucket,
  summarizeStorageCapabilityBaseline,
  summarizeStorageCapabilityDetails,
  summarizeStorageObjectMetadata,
  summarizeStorageProgrammaticCredential,
  summarizeStorageProviderIntrospection,
  summarizeStorageProviderSupport,
  summarizeTenantStorageContext,
  issueStorageProgrammaticCredentialPreview,
  listStorageProgrammaticCredentialsPreview,
  uploadStorageObjectPreviewResult
} from '../../apps/control-plane/src/storage-admin.mjs';

test('storage admin helper exposes bucket/object routes and provider introspection routes', () => {
  const routes = listStorageAdminRoutes();
  const createRoute = getStorageAdminRoute('createStorage');
  const listRoute = getStorageAdminRoute('listStorage');
  const getRoute = getStorageAdminRoute('getStorage');
  const deleteRoute = getStorageAdminRoute('deleteStorage');
  const listObjectsRoute = getStorageAdminRoute('listStorageObjects');
  const uploadRoute = getStorageAdminRoute('uploadStorageObject');
  const downloadRoute = getStorageAdminRoute('downloadStorageObject');
  const metadataRoute = getStorageAdminRoute('getStorageObjectMetadata');
  const deleteObjectRoute = getStorageAdminRoute('deleteStorageObject');
  const providerRoute = getStorageAdminRoute('getStorageProviderIntrospection');
  const listCredentialsRoute = getStorageAdminRoute('listStorageProgrammaticCredentials');
  const createCredentialRoute = getStorageAdminRoute('createStorageProgrammaticCredential');
  const getCredentialRoute = getStorageAdminRoute('getStorageProgrammaticCredential');
  const rotateCredentialRoute = getStorageAdminRoute('rotateStorageProgrammaticCredential');
  const revokeCredentialRoute = getStorageAdminRoute('revokeStorageProgrammaticCredential');

  assert.ok(routes.some((route) => route.operationId === 'createStorage'));
  assert.ok(routes.some((route) => route.operationId === 'listStorage'));
  assert.ok(routes.some((route) => route.operationId === 'deleteStorage'));
  assert.ok(routes.some((route) => route.operationId === 'listStorageObjects'));
  assert.ok(routes.some((route) => route.operationId === 'uploadStorageObject'));
  assert.ok(routes.some((route) => route.operationId === 'downloadStorageObject'));
  assert.ok(routes.some((route) => route.operationId === 'getStorageObjectMetadata'));
  assert.ok(routes.some((route) => route.operationId === 'deleteStorageObject'));
  assert.ok(routes.some((route) => route.operationId === 'getStorageProviderIntrospection'));
  assert.ok(routes.some((route) => route.operationId === 'listStorageProgrammaticCredentials'));
  assert.ok(routes.some((route) => route.operationId === 'createStorageProgrammaticCredential'));
  assert.ok(routes.some((route) => route.operationId === 'getStorageProgrammaticCredential'));
  assert.ok(routes.some((route) => route.operationId === 'rotateStorageProgrammaticCredential'));
  assert.ok(routes.some((route) => route.operationId === 'revokeStorageProgrammaticCredential'));
  assert.ok(routes.some((route) => route.operationId === 'listStorageAuditTrail'));
  assert.ok(routes.some((route) => route.operationId === 'getStorageAuditCoverage'));
  assert.equal(createRoute.resourceType, 'bucket');
  assert.equal(listRoute.resourceType, 'bucket');
  assert.equal(getRoute.resourceType, 'bucket');
  assert.equal(deleteRoute.resourceType, 'bucket');
  assert.equal(listObjectsRoute.resourceType, 'bucket_object');
  assert.equal(uploadRoute.resourceType, 'bucket_object');
  assert.equal(downloadRoute.resourceType, 'bucket_object');
  assert.equal(metadataRoute.resourceType, 'bucket_object');
  assert.equal(deleteObjectRoute.resourceType, 'bucket_object');
  assert.equal(providerRoute.resourceType, 'storage_provider');
  assert.equal(listCredentialsRoute.resourceType, 'storage_credential');
  assert.equal(createCredentialRoute.resourceType, 'storage_credential');
  assert.equal(getCredentialRoute.resourceType, 'storage_credential');
  assert.equal(rotateCredentialRoute.resourceType, 'storage_credential');
  assert.equal(revokeCredentialRoute.resourceType, 'storage_credential');
});

test('storage provider support normalizes explicit provider selection into a ready provider profile', () => {
  const profile = summarizeStorageProviderSupport({
    storage: {
      config: {
        inline: {
          providerType: 'ceph_rgw',
          accessKey: 'should-not-leak'
        }
      }
    }
  });
  const compatibility = getStorageCompatibilitySummary({
    storage: {
      config: {
        inline: {
          providerType: 'minio'
        }
      }
    }
  });
  const baseline = summarizeStorageCapabilityBaseline({ providerType: 'minio' });
  const details = summarizeStorageCapabilityDetails({ providerType: 'ceph-rgw' });

  assert.equal(profile.providerType, 'ceph-rgw');
  assert.equal(profile.status, 'ready');
  assert.equal(profile.configured, true);
  assert.equal(profile.configuredVia, 'storage.config.inline.providerType');
  assert.deepEqual(Object.keys(profile.capabilityManifest), STORAGE_PROVIDER_CAPABILITIES);
  assert.equal(profile.capabilityManifestVersion, STORAGE_PROVIDER_CAPABILITY_MANIFEST_SCHEMA_VERSION);
  assert.equal(profile.capabilityManifest.bucketOperations, true);
  assert.equal(profile.capabilityManifest.objectCrud, true);
  assert.equal(profile.capabilityManifest.bucketPolicies, true);
  assert.equal(profile.capabilityManifest.bucketLifecycle, false);
  assert.equal(profile.capabilityManifest.objectLock, false);
  assert.equal(profile.capabilityManifest.eventNotifications, false);
  assert.equal(profile.capabilityBaseline.version, STORAGE_PROVIDER_CAPABILITY_BASELINE_SCHEMA_VERSION);
  assert.equal(profile.capabilityBaseline.eligible, true);
  assert.equal(profile.capabilityDetails.length, STORAGE_PROVIDER_CAPABILITY_IDS_CATALOG.length);
  assert.equal(profile.capabilityDetails.some((entry) => entry.capabilityId === 'bucket.policy'), true);
  assert.equal(profile.capabilityDetails.some((entry) => entry.capabilityId === 'bucket.lifecycle'), true);
  assert.equal(profile.capabilityDetails.some((entry) => entry.capabilityId === 'object.lock'), true);
  assert.equal(profile.capabilityDetails.some((entry) => entry.capabilityId === 'bucket.event_notifications'), true);
  assert.equal(profile.supportedProviderTypes.includes('minio'), true);
  assert.equal(profile.supportedProviderTypes.includes('ceph-rgw'), true);
  assert.equal(JSON.stringify(profile).includes('should-not-leak'), false);

  assert.equal(baseline.eligible, true);
  assert.equal(details.find((entry) => entry.capabilityId === 'object.versioning').state, STORAGE_PROVIDER_CAPABILITY_ENTRY_STATE_CATALOG.PARTIALLY_SATISFIED);
  assert.equal(details.find((entry) => entry.capabilityId === 'bucket.event_notifications').state, STORAGE_PROVIDER_CAPABILITY_ENTRY_STATE_CATALOG.PARTIALLY_SATISFIED);
  assert.equal(details.find((entry) => entry.capabilityId === 'object.lock').state, STORAGE_PROVIDER_CAPABILITY_ENTRY_STATE_CATALOG.PARTIALLY_SATISFIED);

  assert.equal(compatibility.providerType, 'minio');
  assert.equal(compatibility.status, 'ready');
  assert.equal(compatibility.capabilityManifest.bucketPolicies, true);
  assert.equal(compatibility.capabilityManifest.bucketLifecycle, true);
  assert.equal(compatibility.capabilityManifest.objectLock, true);
  assert.equal(compatibility.capabilityManifest.eventNotifications, true);
  assert.equal(compatibility.routeIds.includes('getStorageProviderIntrospection'), true);
  assert.equal(compatibility.publicBucketRoutes.includes('createStorage'), true);
  assert.equal(compatibility.publicBucketRoutes.includes('listStorage'), true);
  assert.equal(compatibility.publicBucketRoutes.includes('getStorage'), true);
  assert.equal(compatibility.publicBucketRoutes.includes('deleteStorage'), true);
  assert.equal(compatibility.publicObjectRoutes.includes('listStorageObjects'), true);
  assert.equal(compatibility.publicObjectRoutes.includes('uploadStorageObject'), true);
  assert.equal(compatibility.publicObjectRoutes.includes('downloadStorageObject'), true);
});

test('storage provider support fails safely for missing, unknown, and ambiguous provider selection', () => {
  const missing = summarizeStorageProviderSupport({});
  const unknown = summarizeStorageProviderSupport({ providerType: 'unknown-provider' });
  const ambiguous = summarizeStorageProviderSupport({
    providerType: 'minio',
    storage: {
      config: {
        inline: {
          providerType: 'garage'
        }
      }
    }
  });
  const introspection = summarizeStorageProviderIntrospection({ providerType: 'minio' });

  assert.equal(missing.status, 'unavailable');
  assert.equal(missing.errorCode, STORAGE_ADMIN_ERROR_CODES.MISSING_PROVIDER_TYPE);
  assert.equal(Object.values(missing.capabilityManifest).every((value) => value === false), true);

  assert.equal(unknown.status, 'unavailable');
  assert.equal(unknown.errorCode, STORAGE_ADMIN_ERROR_CODES.UNKNOWN_PROVIDER_TYPE);

  assert.equal(ambiguous.status, 'unavailable');
  assert.equal(ambiguous.errorCode, STORAGE_ADMIN_ERROR_CODES.AMBIGUOUS_PROVIDER_SELECTION);
  assert.equal(Array.isArray(ambiguous.configuredVia), true);

  assert.equal(introspection.route.operationId, 'getStorageProviderIntrospection');
  assert.equal(introspection.supportedProviders.length >= 2, true);
  assert.equal(introspection.profile.capabilityManifestVersion, STORAGE_PROVIDER_CAPABILITY_MANIFEST_SCHEMA_VERSION);
  assert.equal(introspection.profile.capabilityBaseline.version, STORAGE_PROVIDER_CAPABILITY_BASELINE_SCHEMA_VERSION);
  assert.deepEqual(introspection.capabilityFields, STORAGE_PROVIDER_CAPABILITIES);
});

test('storage admin summaries preserve canonical capability ordering and stable unavailable fallback shape', () => {
  const profiles = [
    summarizeStorageProviderSupport({ providerType: 'minio' }),
    summarizeStorageProviderSupport({ providerType: 'ceph-rgw' }),
    summarizeStorageProviderSupport({ providerType: 'garage' }),
    summarizeStorageProviderSupport({ providerType: 'unknown-provider' })
  ];
  const introspection = summarizeStorageProviderIntrospection({ providerType: 'unknown-provider' });
  const expectedEntryKeys = ['capabilityId', 'required', 'state', 'summary', 'constraints'];
  const allowedStates = Object.values(STORAGE_PROVIDER_CAPABILITY_ENTRY_STATE_CATALOG);

  for (const profile of profiles) {
    assert.deepEqual(profile.capabilityDetails.map((entry) => entry.capabilityId), STORAGE_PROVIDER_CAPABILITY_IDS_CATALOG);
    assert.equal(profile.capabilityDetails.every((entry) => JSON.stringify(Object.keys(entry)) === JSON.stringify(expectedEntryKeys)), true);
    assert.equal(profile.capabilityDetails.every((entry) => allowedStates.includes(entry.state)), true);
  }

  assert.equal(profiles[3].status, 'unavailable');
  assert.equal(Object.values(profiles[3].capabilityManifest).every((value) => value === false), true);
  assert.equal(profiles[3].capabilityDetails.every((entry) => entry.state === STORAGE_PROVIDER_CAPABILITY_ENTRY_STATE_CATALOG.UNSATISFIED), true);
  assert.deepEqual(introspection.profile.capabilityDetails.map((entry) => entry.capabilityId), STORAGE_PROVIDER_CAPABILITY_IDS_CATALOG);
  assert.equal(Object.values(introspection.profile.capabilityManifest).every((value) => value === false), true);
});

test('tenant storage context summary is tenant-isolated, introspectable, and secret-safe', () => {
  const preview = previewTenantStorageContext({
    tenant: {
      tenantId: 'ten_01falcone',
      slug: 'falcone',
      state: 'active',
      planId: 'pln_01growth'
    },
    storage: {
      config: {
        inline: {
          providerType: 'minio'
        }
      }
    },
    correlationId: 'cor_storage_ctx_01',
    now: '2026-03-27T20:40:00Z'
  });
  const summary = summarizeTenantStorageContext({
    tenant: {
      tenantId: 'ten_01falcone',
      slug: 'falcone',
      state: 'active',
      planId: 'pln_01growth'
    },
    storage: {
      config: {
        inline: {
          providerType: 'minio'
        }
      }
    },
    correlationId: 'cor_storage_ctx_01',
    now: '2026-03-27T20:40:00Z'
  });
  const event = buildTenantStorageEvent({
    storageContext: preview,
    transition: 'succeeded',
    actorUserId: 'usr_01owner',
    correlationId: 'cor_storage_ctx_01',
    occurredAt: '2026-03-27T20:40:05Z'
  });

  assert.equal(getStorageAdminRoute('getTenantStorageContext').resourceType, 'tenant_storage_context');
  assert.equal(preview.state, 'active');
  assert.equal(preview.bucketProvisioningAllowed, true);
  assert.equal(preview.namespace.startsWith('tctx-falcone-'), true);
  assert.equal(summary.route.operationId, 'getTenantStorageContext');
  assert.equal(summary.context.quotaAssignment.capabilityAvailable, true);
  assert.equal(summary.context.providerCapabilities.manifestVersion, STORAGE_PROVIDER_CAPABILITY_MANIFEST_SCHEMA_VERSION);
  assert.equal(summary.context.providerCapabilities.baseline.eligible, true);
  assert.equal(summary.context.credential.secretReferencePresent, true);
  assert.equal(JSON.stringify(summary).includes('secret://tenants/'), false);
  assert.equal(event.eventType, 'tenant_storage_context.succeeded');
  assert.equal(event.quotaAssignment.maxBuckets >= 8, true);
});

test('storage programmatic credential previews stay workspace-scoped, secret-safe, rotatable, and revocable', () => {
  const issuance = issueStorageProgrammaticCredentialPreview({
    tenantId: 'ten_01falconeactive',
    workspaceId: 'wrk_01falconeactive',
    displayName: 'CI uploader',
    principal: {
      principalType: 'service_account',
      principalId: 'svc_01uploader',
      displayName: 'Uploader service account'
    },
    scopes: [{
      workspaceId: 'wrk_01falconeactive',
      bucketId: 'bucket_01assets',
      bucketName: 'falcone-assets',
      objectPrefix: 'uploads/ci/',
      allowedActions: [
        STORAGE_PROGRAMMATIC_CREDENTIAL_ALLOWED_ACTION_CATALOG[0],
        STORAGE_PROGRAMMATIC_CREDENTIAL_ALLOWED_ACTION_CATALOG[1],
        STORAGE_PROGRAMMATIC_CREDENTIAL_ALLOWED_ACTION_CATALOG[4]
      ]
    }],
    actorId: 'usr_01owner',
    actorType: 'user',
    originSurface: 'admin_console',
    correlationId: 'cor_storage_cred_01',
    ttlSeconds: 7200,
    now: '2026-03-28T01:00:00Z'
  });
  const preview = previewStorageProgrammaticCredential({
    tenantId: 'ten_01falconeactive',
    workspaceId: 'wrk_01falconeactive',
    displayName: 'Report reader',
    principal: {
      principalType: 'user',
      principalId: 'usr_01reporter'
    },
    scopes: [{
      workspaceId: 'wrk_01falconeactive',
      allowedActions: [STORAGE_PROGRAMMATIC_CREDENTIAL_ALLOWED_ACTION_CATALOG[3]]
    }],
    now: '2026-03-28T01:01:00Z'
  });
  const listed = listStorageProgrammaticCredentialsPreview({
    items: [issuance.envelope.credential, preview]
  });
  const summary = summarizeStorageProgrammaticCredential(issuance.envelope.credential);
  const rotated = rotateStorageProgrammaticCredentialPreview({
    credential: issuance.envelope.credential,
    actorId: 'usr_01owner',
    actorType: 'user',
    requestedAt: '2026-03-28T01:05:00Z'
  });
  const revoked = revokeStorageProgrammaticCredentialPreview({
    credential: rotated.envelope.credential,
    actorId: 'usr_01owner',
    actorType: 'user',
    requestedAt: '2026-03-28T01:06:00Z'
  });

  assert.equal(STORAGE_PROGRAMMATIC_CREDENTIAL_TYPE_CATALOG.ACCESS_KEY, 'access_key');
  assert.equal(STORAGE_PROGRAMMATIC_CREDENTIAL_STATE_CATALOG.ACTIVE, 'active');
  assert.equal(issuance.route.operationId, 'createStorageProgrammaticCredential');
  assert.equal(issuance.envelope.credential.credentialType, 'access_key');
  assert.equal(issuance.envelope.credential.principal.principalType, 'service_account');
  assert.equal(issuance.envelope.credential.scopes[0].bucketId, 'bucket_01assets');
  assert.equal(issuance.envelope.credential.scopes[0].objectPrefix, 'uploads/ci/');
  assert.equal(issuance.envelope.credential.accessKeyIdMasked.includes('…'), true);
  assert.equal(typeof issuance.envelope.secretAccessKey, 'string');
  assert.equal(issuance.envelope.secretDelivery, 'one_time');
  assert.equal(summary.route.operationId, 'getStorageProgrammaticCredential');
  assert.equal(listed.route.operationId, 'listStorageProgrammaticCredentials');
  assert.equal(listed.collection.items.length, 2);
  assert.equal(rotated.route.operationId, 'rotateStorageProgrammaticCredential');
  assert.equal(rotated.envelope.credential.secretVersion, 2);
  assert.equal(rotated.envelope.credential.lastRotatedAt, '2026-03-28T01:05:00.000Z');
  assert.equal(revoked.route.operationId, 'revokeStorageProgrammaticCredential');
  assert.equal(revoked.credential.state, 'revoked');
  assert.equal(revoked.credential.revokedAt, '2026-03-28T01:06:00.000Z');
});

test('storage logical organization previews are deterministic and reserve platform prefixes', () => {
  const activeContext = previewTenantStorageContext({
    tenant: {
      tenantId: 'ten_01layoutactive',
      slug: 'layout-active',
      state: 'active',
      planId: 'pln_01starter'
    },
    storage: {
      config: {
        inline: {
          providerType: 'minio'
        }
      }
    },
    now: '2026-03-27T20:44:00Z'
  });
  const organization = previewStorageLogicalOrganization({
    tenantStorageContext: activeContext,
    workspaceId: 'wrk_01layoutactive',
    workspaceSlug: 'layout-dev'
  });
  const appPlacement = previewStorageObjectOrganization({
    tenantStorageContext: activeContext,
    workspaceId: 'wrk_01layoutactive',
    workspaceSlug: 'layout-dev',
    applicationId: 'app_01layoutactive',
    applicationSlug: 'console-app',
    objectKey: 'avatars/logo.png'
  });
  const sharedPlacement = previewStorageObjectOrganization({
    tenantStorageContext: activeContext,
    workspaceId: 'wrk_01layoutactive',
    workspaceSlug: 'layout-dev',
    objectKey: 'shared/logo.png'
  });

  assert.equal(STORAGE_LOGICAL_ORGANIZATION_ERRORS.RESERVED_PREFIX_CONFLICT, 'RESERVED_PREFIX_CONFLICT');
  assert.equal(organization.strategy, 'tenant-workspace-application-prefix-v1');
  assert.equal(organization.workspaceRootPrefix, 'tenants/ten_01layoutactive/workspaces/wrk_01layoutactive/');
  assert.equal(organization.workspaceSharedPrefix, 'tenants/ten_01layoutactive/workspaces/wrk_01layoutactive/shared/');
  assert.equal(organization.reservedPrefixes.length, 3);
  assert.equal(previewReservedStoragePrefix({ organization, candidatePrefix: 'tenants/ten_01layoutactive/workspaces/wrk_01layoutactive/_platform/multipart/' }), true);
  assert.equal(previewReservedStoragePrefix({ organization, candidatePrefix: 'tenants/ten_01layoutactive/workspaces/wrk_01layoutactive/shared/' }), false);
  assert.equal(appPlacement.placementType, 'application');
  assert.equal(appPlacement.applicationRootPrefix, 'tenants/ten_01layoutactive/workspaces/wrk_01layoutactive/apps/app_01layoutactive/data/');
  assert.equal(appPlacement.canonicalObjectPath, 'tenants/ten_01layoutactive/workspaces/wrk_01layoutactive/apps/app_01layoutactive/data/avatars/logo.png');
  assert.equal(sharedPlacement.placementType, 'workspace_shared');
  assert.equal(sharedPlacement.workspaceSharedPrefix, 'tenants/ten_01layoutactive/workspaces/wrk_01layoutactive/shared/');
});

test('bucket and object previews stay scope-bound and expose bounded metadata/download surfaces', () => {
  const activeContext = previewTenantStorageContext({
    tenant: {
      tenantId: 'ten_01falconeactive',
      slug: 'falcone-active',
      state: 'active',
      planId: 'pln_01starter'
    },
    storage: {
      config: {
        inline: {
          providerType: 'minio'
        }
      }
    },
    now: '2026-03-27T20:45:00Z'
  });
  const bucket = previewStorageBucket({
    workspaceId: 'wrk_01falconeactive',
    workspaceSlug: 'falcone-live',
    bucketName: 'falcone-assets',
    region: 'us-east-1',
    tenantStorageContext: activeContext,
    objectCount: 1,
    totalBytes: 128,
    now: '2026-03-27T20:45:00Z'
  });
  const bucketSummary = summarizeStorageBucket(bucket);
  const bucketList = listStorageBucketsPreview({ items: [bucket] });
  const objectRecord = previewStorageObject({
    bucket,
    objectKey: 'avatars/logo.png',
    applicationId: 'app_01falconeactive',
    applicationSlug: 'console-app',
    sizeBytes: 128,
    contentType: 'image/png',
    metadata: {
      label: 'logo'
    },
    checksumSha256: 'abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd',
    now: '2026-03-27T20:45:10Z'
  });
  const metadata = summarizeStorageObjectMetadata(objectRecord);
  const objectList = listStorageObjectsPreview({ items: [objectRecord] });
  const upload = uploadStorageObjectPreviewResult({ bucket, object: objectRecord, requestedAt: '2026-03-27T20:45:12Z' });
  const download = downloadStorageObjectPreviewResult({ bucket, object: objectRecord, requestedAt: '2026-03-27T20:45:13Z' });
  const objectDelete = deleteStorageObjectPreviewResult({ bucket, object: objectRecord, requestedAt: '2026-03-27T20:45:14Z' });
  const event = buildStorageOperationEvent({
    operation: 'object.deleted',
    bucket,
    object: objectRecord,
    actorUserId: 'usr_01falcone',
    correlationId: 'cor_storage_object_01',
    occurredAt: '2026-03-27T20:45:14Z'
  });

  assert.equal(bucketSummary.route.operationId, 'getStorage');
  assert.equal(bucketSummary.bucket.objectStats.objectCount, 1);
  assert.equal(bucketSummary.bucket.organization.workspaceSharedPrefix, 'tenants/ten_01falconeactive/workspaces/wrk_01falconeactive/shared/');
  assert.equal(bucketList.route.operationId, 'listStorage');
  assert.equal(bucketList.collection.items.length, 1);
  assert.equal(metadata.route.operationId, 'getStorageObjectMetadata');
  assert.equal(metadata.object.objectKey, 'avatars/logo.png');
  assert.equal(metadata.object.applicationId, 'app_01falconeactive');
  assert.equal(metadata.object.organization.placementType, 'application');
  assert.equal(metadata.object.organization.canonicalObjectPath, 'tenants/ten_01falconeactive/workspaces/wrk_01falconeactive/apps/app_01falconeactive/data/avatars/logo.png');
  assert.equal(Object.prototype.hasOwnProperty.call(metadata.object, 'contentBase64'), false);
  assert.equal(objectList.route.operationId, 'listStorageObjects');
  assert.equal(objectList.collection.items.length, 1);
  assert.equal(upload.route.operationId, 'uploadStorageObject');
  assert.equal(upload.accepted, true);
  assert.equal(download.route.operationId, 'downloadStorageObject');
  assert.equal(download.payload.encoding, 'base64');
  assert.equal(download.payload.contentType, 'image/png');
  assert.equal(typeof download.payload.contentBase64, 'string');
  assert.equal(objectDelete.route.operationId, 'deleteStorageObject');
  assert.equal(objectDelete.accepted, true);
  assert.equal(event.entityType, 'bucket_object');
  assert.equal(event.objectKey, 'avatars/logo.png');
});

test('storage error previews normalize provider failures without leaking provider secrets', () => {
  const normalized = previewStorageNormalizedError({
    providerCode: 'NoSuchBucket',
    providerMessage: 'NoSuchBucket returned from https://minio.internal for secret://tenants/ten_01unit/storage/context',
    requestId: 'req_unit_storage_01',
    tenantId: 'ten_01unit',
    workspaceId: 'wrk_01unit',
    operation: 'bucket.get',
    bucketName: 'missing-bucket',
    observedAt: '2026-03-27T20:47:00Z'
  });
  const envelope = previewStorageErrorEnvelope({
    providerCode: 'AccessDenied',
    providerMessage: 'Access denied by https://garage.internal using accessKey=abc123',
    requestId: 'req_unit_storage_02',
    tenantId: 'ten_01unit',
    workspaceId: 'wrk_01unit',
    operation: 'object.delete',
    bucketName: 'missing-bucket',
    objectKey: 'private/file.txt',
    observedAt: '2026-03-27T20:47:01Z'
  });
  const internal = previewStorageInternalErrorRecord({
    providerCode: 'TimeoutError',
    providerMessage: 'timeout against https://garage.internal using sessionKey=xyz123',
    requestId: 'req_unit_storage_03',
    tenantId: 'ten_01unit',
    workspaceId: 'wrk_01unit',
    operation: 'object.put',
    bucketName: 'missing-bucket',
    objectKey: 'private/file.txt',
    observedAt: '2026-03-27T20:47:02Z'
  });
  const event = buildStorageErrorEvent({
    providerCode: 'Quota_Exceeded',
    requestId: 'req_unit_storage_04',
    tenantId: 'ten_01unit',
    workspaceId: 'wrk_01unit',
    operation: 'object.put',
    bucketName: 'missing-bucket',
    objectKey: 'private/file.txt',
    observedAt: '2026-03-27T20:47:03Z'
  });

  assert.equal(STORAGE_NORMALIZED_ERROR_CATALOG.BUCKET_NOT_FOUND, 'BUCKET_NOT_FOUND');
  assert.equal(STORAGE_ERROR_RETRYABILITY_CATALOG.CONDITIONALLY_RETRYABLE, 'conditionally_retryable');
  assert.equal(normalized.code, STORAGE_NORMALIZED_ERROR_CATALOG.BUCKET_NOT_FOUND);
  assert.equal(normalized.httpStatus, 404);
  assert.equal(envelope.error.code, STORAGE_NORMALIZED_ERROR_CATALOG.STORAGE_ACCESS_DENIED);
  assert.equal(JSON.stringify(envelope).includes('https://garage.internal'), false);
  assert.equal(JSON.stringify(envelope).includes('accessKey=abc123'), false);
  assert.equal(internal.code, STORAGE_NORMALIZED_ERROR_CATALOG.STORAGE_PROVIDER_TIMEOUT);
  assert.equal(internal.diagnostics.providerMessage.includes('[redacted-url]'), true);
  assert.equal(internal.diagnostics.providerMessage.includes('[redacted]'), true);
  assert.equal(event.eventType, 'storage.error.normalized');
  assert.equal(event.errorCode, STORAGE_NORMALIZED_ERROR_CATALOG.STORAGE_QUOTA_EXCEEDED);
});

test('storage usage previews expose usage routes constants and threshold helpers', () => {
  const workspacePreview = previewWorkspaceStorageUsage({
    tenantId: 'ten_01usage',
    workspaceId: 'wrk_01usage',
    buckets: [
      { bucketId: 'b1', totalBytes: 90, objectCount: 9, largestObjectSizeBytes: 20 },
      { bucketId: 'b2', totalBytes: 5, objectCount: 1, largestObjectSizeBytes: 5 }
    ],
    totalBytesLimit: 100,
    bucketCountLimit: 5,
    objectCountLimit: 20,
    largestObjectSizeBytesLimit: 50,
    snapshotAt: '2026-03-28T00:00:00Z'
  });
  const tenantPreview = previewTenantStorageUsage({
    tenantId: 'ten_01usage',
    workspaces: [{
      workspaceId: 'wrk_01usage',
      tenantId: 'ten_01usage',
      totalBytes: 95,
      objectCount: 10,
      bucketCount: 2,
      buckets: [
        { bucketId: 'b1', workspaceId: 'wrk_01usage', tenantId: 'ten_01usage', totalBytes: 90, objectCount: 9, largestObjectSizeBytes: 20 },
        { bucketId: 'b2', workspaceId: 'wrk_01usage', tenantId: 'ten_01usage', totalBytes: 5, objectCount: 1, largestObjectSizeBytes: 5 }
      ]
    }],
    totalBytesLimit: 200,
    bucketCountLimit: 10,
    objectCountLimit: 40,
    largestObjectSizeBytesLimit: 100,
    snapshotAt: '2026-03-28T00:00:00Z'
  });
  const bucketPreview = previewBucketStorageUsage({ tenantId: 'ten_01usage', bucketId: 'b1', totalBytes: 90, objectCount: 9, largestObjectSizeBytes: 20, snapshotAt: '2026-03-28T00:00:00Z' });
  const crossTenantPreview = previewCrossTenantStorageUsage({ tenantSnapshots: [tenantPreview.snapshot] });
  const ranked = rankWorkspaceBucketsByUsage({ workspaceSnapshot: workspacePreview.snapshot, sortDimension: 'total_bytes', topN: 1 });
  const routes = listStorageAdminRoutes();

  assert.equal(workspacePreview.snapshot.scopeType, 'workspace');
  assert.equal(Array.isArray(workspacePreview.thresholdBreaches), true);
  assert.equal(workspacePreview.auditEvent.eventType, 'storage.usage.queried');
  assert.equal(tenantPreview.snapshot.scopeType, 'tenant');
  assert.equal(tenantPreview.snapshot.breakdown[0].entityType, 'storage_workspace_usage_entry');
  assert.equal(bucketPreview.snapshot.scopeType, 'bucket');
  assert.equal('thresholdBreaches' in bucketPreview, false);
  assert.equal(crossTenantPreview.summary.entityType, 'storage_cross_tenant_usage_summary');
  assert.deepEqual(ranked.map((entry) => entry.bucketId), ['b1']);
  assert.ok(routes.some((route) => route.operationId === 'getTenantStorageUsage'));
  assert.ok(routes.some((route) => route.operationId === 'getWorkspaceStorageUsage'));
  assert.ok(routes.some((route) => route.operationId === 'getBucketStorageUsage'));
  assert.ok(routes.some((route) => route.operationId === 'listCrossTenantStorageUsage'));
  for (const catalog of [STORAGE_USAGE_COLLECTION_METHODS, STORAGE_USAGE_COLLECTION_STATUSES, STORAGE_USAGE_THRESHOLD_SEVERITIES, STORAGE_USAGE_THRESHOLD_DEFAULTS, STORAGE_USAGE_ERROR_CODES]) {
    assert.equal(Object.keys(catalog).length > 0, true);
    assert.equal(Object.isFrozen(catalog), true);
  }
});

test('storage credential previews preserve scope during rotation and block unsafe reactivation after revocation', () => {
  const issuance = issueStorageProgrammaticCredentialPreview({
    tenantId: 'ten_01secure',
    workspaceId: 'wrk_01secure',
    displayName: 'Deploy bot',
    principal: {
      principalType: 'service_account',
      principalId: 'svc_01deploy'
    },
    scopes: [{
      workspaceId: 'wrk_01secure',
      bucketId: 'bucket_01deploy',
      objectPrefix: 'releases/',
      allowedActions: ['object.list', 'object.get', 'object.put', 'object.head']
    }],
    actorId: 'usr_01owner',
    actorType: 'user',
    now: '2026-03-28T00:10:00Z'
  });
  const rotated = rotateStorageProgrammaticCredentialPreview({
    credential: issuance.envelope.credential,
    actorId: 'usr_01owner',
    actorType: 'user',
    requestedAt: '2026-03-28T00:11:00Z'
  });
  const revoked = revokeStorageProgrammaticCredentialPreview({
    credential: rotated.envelope.credential,
    actorId: 'usr_01security',
    actorType: 'user',
    requestedAt: '2026-03-28T00:12:00Z'
  });

  assert.equal(rotated.envelope.credential.workspaceId, issuance.envelope.credential.workspaceId);
  assert.deepEqual(rotated.envelope.credential.scopes, issuance.envelope.credential.scopes);
  assert.notEqual(rotated.envelope.accessKeyId, issuance.envelope.accessKeyId);
  assert.equal(revoked.credential.state, 'revoked');
  assert.equal(revoked.credential.issuer.actorId, 'usr_01security');
  assert.throws(() => rotateStorageProgrammaticCredentialPreview({
    credential: revoked.credential,
    requestedAt: '2026-03-28T00:13:00Z'
  }), /INVALID_STATE/);
});

test('storage usage previews make degraded collection explicit while keeping audit-safe summaries', () => {
  const workspacePreview = previewWorkspaceStorageUsage({
    tenantId: 'ten_01degraded',
    workspaceId: 'wrk_01degraded',
    buckets: [{ bucketId: 'b1', totalBytes: 120, objectCount: 12, largestObjectSizeBytes: 30 }],
    totalBytesLimit: 100,
    bucketCountLimit: 5,
    objectCountLimit: 20,
    largestObjectSizeBytesLimit: 40,
    collectionMethod: STORAGE_USAGE_COLLECTION_METHODS.CACHED_SNAPSHOT,
    collectionStatus: STORAGE_USAGE_COLLECTION_STATUSES.PROVIDER_UNAVAILABLE,
    cacheSnapshotAt: null,
    snapshotAt: '2026-03-28T00:15:00Z',
    actorPrincipal: 'usr_01ops'
  });
  const tenantPreview = previewTenantStorageUsage({
    tenantId: 'ten_01degraded',
    workspaces: [{
      workspaceId: 'wrk_01degraded',
      tenantId: 'ten_01degraded',
      totalBytes: 120,
      objectCount: 12,
      bucketCount: 1,
      buckets: [
        { bucketId: 'b1', workspaceId: 'wrk_01degraded', tenantId: 'ten_01degraded', totalBytes: 120, objectCount: 12, largestObjectSizeBytes: 30 }
      ]
    }],
    collectionMethod: STORAGE_USAGE_COLLECTION_METHODS.PROVIDER_ADMIN_API,
    collectionStatus: STORAGE_USAGE_COLLECTION_STATUSES.PARTIAL,
    status: 'degraded',
    snapshotAt: '2026-03-28T00:15:00Z'
  });
  const crossTenantPreview = previewCrossTenantStorageUsage({
    tenantSnapshots: [tenantPreview.snapshot],
    generatedAt: '2026-03-28T00:16:00Z'
  });

  assert.deepEqual(workspacePreview.snapshot.breakdown, []);
  assert.equal(workspacePreview.thresholdBreaches.length >= 1, true);
  assert.equal(workspacePreview.auditEvent.actorPrincipal, 'usr_01ops');
  assert.equal('totalBytes' in workspacePreview.auditEvent, false);
  assert.equal(tenantPreview.snapshot.collectionStatus, 'partial');
  assert.equal(crossTenantPreview.summary.tenants[0].status, 'degraded');
  assert.equal(crossTenantPreview.auditEvent.scopeId, 'cross-tenant');
});

test('storage import/export previews are discoverable and bounded', () => {
  const exportPreview = previewStorageExportManifest({
    sourceBucketId: 'bucket_01',
    sourceWorkspaceId: 'wrk_01',
    sourceTenantId: 'ten_01',
    actingPrincipal: { type: 'user', id: 'usr_01' },
    exportedAt: '2026-03-28T00:00:00Z',
    entries: []
  });
  const importPreview = previewStorageImportResult({
    targetBucketId: 'bucket_02',
    targetWorkspaceId: 'wrk_02',
    targetTenantId: 'ten_01',
    actingPrincipal: { type: 'user', id: 'usr_01' },
    importedAt: '2026-03-28T00:00:00Z',
    conflictPolicy: STORAGE_IMPORT_CONFLICT_POLICIES.SKIP,
    outcomes: [{ objectKey: 'a.txt', status: STORAGE_IMPORT_ENTRY_STATUSES.IMPORTED, reason: null, sizeBytes: 10 }]
  });
  const manifestValidation = validateStorageImportManifest({
    manifest: { formatVersion: STORAGE_IMPORT_EXPORT_MANIFEST_VERSION, entries: [{ objectKey: 'a.txt' }] },
    maxObjectsPerOperation: STORAGE_IMPORT_EXPORT_OPERATION_DEFAULTS.maxObjectsPerOperation
  });
  const limit = checkStorageImportExportLimit({ objectCount: STORAGE_IMPORT_EXPORT_OPERATION_DEFAULTS.maxObjectsPerOperation + 1 });
  const routes = listStorageAdminRoutes();

  assert.equal(exportPreview.manifest.entityType, 'storage_export_manifest');
  assert.equal(exportPreview.auditEvent.operationType, 'export');
  assert.equal(exportPreview.auditEvent.outcome, 'export_empty_result');
  assert.equal(importPreview.summary.entityType, 'storage_import_result_summary');
  assert.equal(importPreview.auditEvent.operationType, 'import');
  assert.equal(importPreview.auditEvent.outcome, 'success');
  assert.deepEqual(manifestValidation, { valid: true, errors: [] });
  assert.deepEqual(limit, { allowed: false, appliedLimit: STORAGE_IMPORT_EXPORT_OPERATION_DEFAULTS.maxObjectsPerOperation });
  assert.ok(routes.some((route) => route.operationId === 'exportStorageBucketObjects'));
  assert.ok(routes.some((route) => route.operationId === 'importStorageBucketObjects'));
  assert.ok(routes.some((route) => route.operationId === 'getStorageBucketExportManifest'));
  for (const catalog of [STORAGE_IMPORT_CONFLICT_POLICIES, STORAGE_IMPORT_ENTRY_STATUSES, STORAGE_IMPORT_EXPORT_ERROR_CODES, STORAGE_IMPORT_EXPORT_OPERATION_DEFAULTS]) {
    assert.equal(Object.keys(catalog).length > 0, true);
  }
});

test('tenant storage context lifecycle gating and bucket deletion rules block unsafe operations', () => {
  const pendingContext = previewTenantStorageContext({
    tenant: {
      tenantId: 'ten_01falconepending',
      slug: 'falcone-pending',
      state: 'pending_activation',
      planId: 'pln_01starter'
    },
    storage: {
      config: {
        inline: {
          providerType: 'minio'
        }
      }
    },
    now: '2026-03-27T20:45:00Z'
  });
  const blocked = previewWorkspaceStorageBootstrapContext({
    tenantId: 'ten_01falconepending',
    workspaceId: 'wrk_01falconepending',
    workspaceSlug: 'falcone-dev',
    storageContext: pendingContext,
    now: '2026-03-27T20:45:00Z'
  });
  const activeContext = previewTenantStorageContext({
    tenant: {
      tenantId: 'ten_01falconeactive',
      slug: 'falcone-active',
      state: 'active',
      planId: 'pln_01starter'
    },
    storage: {
      config: {
        inline: {
          providerType: 'minio'
        }
      }
    },
    now: '2026-03-27T20:45:00Z'
  });
  const ready = previewWorkspaceStorageBootstrapContext({
    tenantId: 'ten_01falconeactive',
    workspaceId: 'wrk_01falconeactive',
    workspaceSlug: 'falcone-live',
    storageContext: activeContext,
    now: '2026-03-27T20:45:00Z'
  });
  const rotated = rotateTenantStorageCredentialPreview({
    storageContext: activeContext,
    actorUserId: 'usr_01owner',
    requestedAt: '2026-03-27T20:46:00Z',
    reason: 'scheduled_rotation'
  });
  const blockedBucketDelete = deleteStorageBucketPreview({
    bucket: previewStorageBucket({
      workspaceId: 'wrk_01falconeactive',
      bucketName: 'falcone-retained',
      tenantStorageContext: activeContext,
      objectCount: 2,
      totalBytes: 256,
      now: '2026-03-27T20:46:00Z'
    }),
    now: '2026-03-27T20:46:10Z'
  });
  const protectedBucketDelete = deleteStorageBucketPreview({
    bucket: previewStorageBucket({
      workspaceId: 'wrk_01falconeactive',
      bucketName: 'default-storage-bucket',
      tenantStorageContext: activeContext,
      managed: true,
      managedResourceKey: 'default_storage_bucket',
      objectCount: 0,
      totalBytes: 0,
      now: '2026-03-27T20:46:00Z'
    }),
    now: '2026-03-27T20:46:10Z'
  });
  const allowedBucketDelete = deleteStorageBucketPreview({
    bucket: previewStorageBucket({
      workspaceId: 'wrk_01falconeactive',
      bucketName: 'falcone-empty',
      tenantStorageContext: activeContext,
      objectCount: 0,
      totalBytes: 0,
      now: '2026-03-27T20:46:00Z'
    }),
    now: '2026-03-27T20:46:10Z'
  });

  assert.equal(blocked.requestedState, 'dependency_wait');
  assert.equal(blocked.reasonCode, TENANT_STORAGE_ERROR_CODES.CONTEXT_PENDING);
  assert.equal(ready.requestedState, 'pending');
  assert.equal(ready.namespace, activeContext.namespace);
  assert.equal(rotated.route.operationId, 'rotateTenantStorageContextCredential');
  assert.equal(rotated.context.credential.version, 2);
  assert.equal(rotated.context.credential.health, 'rotated');
  assert.equal(blockedBucketDelete.route.operationId, 'deleteStorage');
  assert.equal(blockedBucketDelete.accepted, false);
  assert.equal(blockedBucketDelete.reasonCode, STORAGE_BUCKET_OBJECT_ERRORS.BUCKET_NOT_EMPTY);
  assert.equal(protectedBucketDelete.accepted, false);
  assert.equal(protectedBucketDelete.reasonCode, STORAGE_BUCKET_OBJECT_ERRORS.BUCKET_PROTECTED);
  assert.equal(allowedBucketDelete.accepted, true);
});
