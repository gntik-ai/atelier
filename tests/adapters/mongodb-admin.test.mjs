import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MONGO_ADMIN_CAPABILITY_MATRIX,
  MONGO_ADMIN_SEGREGATION_MODELS,
  MONGO_DEDICATED_CLUSTER_ALLOWED_ROLE_BINDINGS,
  MONGO_SHARED_CLUSTER_ALLOWED_ROLE_BINDINGS,
  SUPPORTED_MONGO_VERSION_RANGES,
  buildMongoAdminAdapterCall,
  buildMongoAdminMetadataRecord,
  buildMongoInventorySnapshot,
  isMongoVersionSupported,
  normalizeMongoAdminError,
  normalizeMongoAdminResource,
  resolveMongoAdminProfile,
  validateMongoAdminRequest
} from '../../services/adapters/src/mongodb-admin.mjs';

test('mongodb admin adapter exports supported versions, structural resource coverage, and segregation-aware profile guardrails', () => {
  const sharedProfile = resolveMongoAdminProfile({
    tenantId: 'ten_01starteralpha',
    workspaceId: 'wrk_01starterdev',
    planId: 'pln_01growth'
  });
  const dedicatedProfile = resolveMongoAdminProfile({
    tenantId: 'ten_01enterprisealpha',
    workspaceId: 'wrk_01enterpriseprod',
    planId: 'pln_01enterprise',
    isolationMode: 'dedicated_cluster',
    clusterTopology: 'sharded_cluster',
    segregationModel: 'tenant_database'
  });

  assert.deepEqual(Object.keys(MONGO_ADMIN_CAPABILITY_MATRIX), ['database', 'collection', 'index', 'view', 'template', 'user', 'role_binding']);
  assert.deepEqual(MONGO_ADMIN_SEGREGATION_MODELS, ['workspace_database', 'tenant_database']);
  assert.equal(SUPPORTED_MONGO_VERSION_RANGES.length, 3);
  assert.equal(isMongoVersionSupported('6.0.15'), true);
  assert.equal(isMongoVersionSupported('7.0.9'), true);
  assert.equal(isMongoVersionSupported('8.0.1'), true);
  assert.equal(isMongoVersionSupported('5.0.20'), false);
  assert.deepEqual(sharedProfile.allowedRoleBindings, MONGO_SHARED_CLUSTER_ALLOWED_ROLE_BINDINGS);
  assert.deepEqual(dedicatedProfile.allowedRoleBindings, MONGO_DEDICATED_CLUSTER_ALLOWED_ROLE_BINDINGS);
  assert.equal(sharedProfile.segregationModel, 'workspace_database');
  assert.equal(dedicatedProfile.segregationModel, 'tenant_database');
  assert.equal(dedicatedProfile.supportedClusterTopologies.includes('sharded_cluster'), true);
  assert.equal(dedicatedProfile.supportedSegregationModels.includes('tenant_database'), true);
});

test('mongodb admin adapter normalizes databases, collections, indexes, views, templates, users, and role bindings into stable BaaS-native shapes', () => {
  const database = normalizeMongoAdminResource(
    'database',
    {
      databaseName: '01starterdev_app',
      segregationModel: 'workspace_database',
      stats: { collections: 4, views: 1, indexes: 6, users: 2, documents: 3210, storageBytes: 524288 },
      metadata: { owner: 'workspace-admin' }
    },
    {
      tenantId: 'ten_01starteralpha',
      workspaceId: 'wrk_01starterdev',
      planId: 'pln_01growth'
    }
  );
  const collection = normalizeMongoAdminResource(
    'collection',
    {
      databaseName: '01starterdev_app',
      collectionName: 'customer_profiles',
      collectionType: 'standard',
      validation: { level: 'strict', action: 'error', schemaRef: 'schema://customer-profile/v1' },
      clustered: { enabled: true, key: { _id: 1 } },
      prePostImages: { enabled: true, captureMode: 'when_available' },
      indexes: [
        { name: 'idx_customer_email', key: { email: 1 }, unique: true },
        { name: 'idx_customer_expiry', key: { expiresAt: 1 }, ttlSeconds: 3600 }
      ],
      templateBinding: { templateId: 'CustomerProfile', version: '2026-03-25' },
      metadataSummary: { size: { documentCount: 123, storageBytes: 4096, indexBytes: 1024 } }
    },
    {
      tenantId: 'ten_01starteralpha',
      workspaceId: 'wrk_01starterdev',
      planId: 'pln_01growth',
      providerVersion: '7.0.9'
    }
  );
  const index = normalizeMongoAdminResource(
    'index',
    {
      databaseName: '01starterdev_app',
      collectionName: 'customer_profiles',
      indexName: 'idx_customer_expiry',
      key: { expiresAt: 1 },
      ttlSeconds: 3600,
      rebuild: { strategy: 'rolling_shadow', approvalToken: 'approve-ttl-1', maxParallelCollections: 1 },
      metadataSummary: { lastRebuildOutcome: 'success' }
    },
    {
      tenantId: 'ten_01starteralpha',
      workspaceId: 'wrk_01starterdev',
      planId: 'pln_01growth'
    }
  );
  const view = normalizeMongoAdminResource(
    'view',
    {
      databaseName: '01starterdev_app',
      viewName: 'customer_profiles_public',
      sourceCollectionName: 'customer_profiles',
      pipeline: [{ $project: { email: 1, country: 1 } }]
    },
    {
      tenantId: 'ten_01starteralpha',
      workspaceId: 'wrk_01starterdev',
      planId: 'pln_01growth'
    }
  );
  const template = normalizeMongoAdminResource(
    'template',
    {
      templateId: 'CustomerProfile',
      description: 'Onboard customer profile collections with TTL and validation.',
      defaults: {
        validation: { level: 'strict', action: 'error', schemaRef: 'schema://customer-profile/v1' },
        indexes: [{ name: 'idx_customer_email', key: { email: 1 }, unique: true }]
      },
      variables: [{ name: 'collectionSuffix', required: true }]
    },
    {
      tenantId: 'ten_01starteralpha',
      workspaceId: 'wrk_01starterdev',
      planId: 'pln_01growth'
    }
  );
  const user = normalizeMongoAdminResource(
    'user',
    {
      databaseName: '01starterdev_app',
      username: '01starterdev_reader',
      passwordBinding: {
        mode: 'managed_secret_ref',
        credentialScope: 'internal',
        serviceAccountId: 'svc_wrk_01starterdev_mongo_reader',
        secretRef: 'sec_mongo_reader',
        lifecycle: { lifecycleState: 'active', maxLifetimeHours: 72 }
      },
      roleBindings: [{ roleName: 'readWrite', databaseName: '01starterdev_app' }]
    },
    {
      tenantId: 'ten_01starteralpha',
      workspaceId: 'wrk_01starterdev',
      planId: 'pln_01growth'
    }
  );
  const roleBinding = normalizeMongoAdminResource(
    'role_binding',
    {
      username: '01starterdev_reader',
      databaseName: '01starterdev_app',
      collectionName: 'customer_profiles',
      roleName: 'read'
    },
    {
      tenantId: 'ten_01starteralpha',
      workspaceId: 'wrk_01starterdev',
      planId: 'pln_01growth'
    }
  );

  assert.equal(database.resourceType, 'mongo_database');
  assert.equal(database.stats.collectionCount, 4);
  assert.equal(database.stats.viewCount, 1);
  assert.equal(database.segregationModel, 'workspace_database');
  assert.equal(database.providerCompatibility.provider, 'mongodb');

  assert.equal(collection.resourceType, 'mongo_collection');
  assert.equal(collection.configuration.validation.schemaRef, 'schema://customer-profile/v1');
  assert.equal(collection.configuration.clustered.enabled, true);
  assert.equal(collection.configuration.prePostImages.enabled, true);
  assert.equal(collection.indexDefinitions[1].ttlSeconds, 3600);
  assert.equal(collection.metadataSummary.indexSummary.ttlManagedCount, 1);
  assert.equal(collection.tenantIsolation.segregationModel, 'workspace_database');

  assert.equal(index.resourceType, 'mongo_index');
  assert.equal(index.definition.ttlSeconds, 3600);
  assert.equal(index.rebuildPolicy.strategy, 'rolling_shadow');

  assert.equal(view.resourceType, 'mongo_view');
  assert.equal(view.metadataSummary.stageCount, 1);
  assert.equal(view.readonly, true);

  assert.equal(template.resourceType, 'mongo_collection_template');
  assert.equal(template.defaults.indexes[0].name, 'idx_customer_email');
  assert.equal(template.variables[0].name, 'collectionSuffix');

  assert.equal(user.resourceType, 'mongo_user');
  assert.equal(user.passwordBinding.secretRef, 'sec_mongo_reader');
  assert.equal(user.passwordBinding.credentialScope, 'internal');
  assert.equal(user.passwordBinding.lifecycle.maxLifetimeHours, 72);
  assert.equal(user.roleBindings[0].roleName, 'readWrite');
  assert.equal(roleBinding.resourceType, 'mongo_role_binding');
  assert.equal(roleBinding.scope, 'collection');
});

test('mongodb admin adapter validates bounded collection options, TTL/index rebuilds, views, templates, quotas, and privilege guardrails before building provider calls', () => {
  const invalidCollection = validateMongoAdminRequest({
    resourceKind: 'collection',
    action: 'create',
    context: {
      tenantId: 'ten_01starteralpha',
      workspaceId: 'wrk_01starterdev',
      planId: 'pln_01growth',
      databaseName: '01starterdev_app',
      providerVersion: '7.0.9',
      currentTenantCollectionCount: 96
    },
    payload: {
      databaseName: '01starterdev_app',
      collectionName: 'system_profile',
      collectionType: 'timeseries',
      capped: true,
      timeseries: {},
      clustered: { enabled: true },
      prePostImages: { enabled: true },
      indexes: [{ name: 'idx_dup', key: { a: 1 } }, { name: 'idx_dup', key: { b: 1 } }]
    }
  });
  const invalidIndex = validateMongoAdminRequest({
    resourceKind: 'index',
    action: 'rebuild',
    context: {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01growthdev',
      planId: 'pln_01growth',
      databaseName: '01growthdev_app',
      collectionName: 'events'
    },
    payload: {
      indexName: 'idx_events_ttl',
      rebuild: { strategy: 'foreground', maxParallelCollections: 2 }
    }
  });
  const invalidView = validateMongoAdminRequest({
    resourceKind: 'view',
    action: 'create',
    context: {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01growthdev',
      planId: 'pln_01growth',
      databaseName: '01growthdev_app'
    },
    payload: {
      viewName: 'events_unsafe',
      sourceCollectionName: 'events',
      pipeline: [{ $merge: { into: 'events_archive' } }]
    }
  });
  const invalidTemplate = validateMongoAdminRequest({
    resourceKind: 'template',
    action: 'create',
    context: {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01growthdev',
      planId: 'pln_01growth',
      currentTemplateCount: 12
    },
    payload: {
      templateId: '1bad-template',
      variables: [{ name: 'suffix' }, { name: 'suffix' }],
      defaults: { collectionType: 'timeseries', clustered: { enabled: true } }
    }
  });
  const invalidUser = validateMongoAdminRequest({
    resourceKind: 'user',
    action: 'create',
    context: {
      tenantId: 'ten_01starteralpha',
      workspaceId: 'wrk_01starterdev',
      planId: 'pln_01growth',
      databaseName: '01starterdev_app'
    },
    payload: {
      databaseName: '01starterdev_app',
      username: 'reader',
      password: 'plain-text-not-allowed',
      passwordBinding: { mode: 'managed_secret_ref', credentialScope: 'internal', lifecycle: { maxLifetimeHours: 999 } },
      roleBindings: [{ roleName: 'dbOwner', databaseName: '01starterdev_app' }]
    }
  });
  const invalidRoleBinding = validateMongoAdminRequest({
    resourceKind: 'role_binding',
    action: 'assign',
    context: {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01enterpriseprod',
      planId: 'pln_01enterprise',
      isolationMode: 'shared_cluster',
      clusterTopology: 'sharded_cluster',
      databaseName: '01enterpriseprod_app'
    },
    payload: {
      username: '01enterpriseprod_admin',
      databaseName: '01enterpriseprod_app',
      roleName: 'dbOwner'
    }
  });

  assert.equal(invalidCollection.ok, false);
  assert.equal(invalidCollection.violations.some((violation) => violation.includes('timeseries collections cannot also be configured as capped')), true);
  assert.equal(invalidCollection.violations.some((violation) => violation.includes('timeseries.timeField is required')), true);
  assert.equal(invalidCollection.violations.some((violation) => violation.includes('cannot declare clustered collection options explicitly')), true);
  assert.equal(invalidCollection.violations.some((violation) => violation.includes('pre/post images are not supported')), true);
  assert.equal(invalidCollection.violations.some((violation) => violation.includes('unique names')), true);
  assert.equal(invalidCollection.violations.some((violation) => violation.includes('tenant collection quota exceeded')), true);

  assert.equal(invalidIndex.ok, false);
  assert.equal(invalidIndex.violations.some((violation) => violation.includes('controlled index rebuilds require approvalToken')), true);
  assert.equal(invalidIndex.violations.some((violation) => violation.includes('allowed values: drop_and_recreate, rolling_shadow')), true);
  assert.equal(invalidIndex.violations.some((violation) => violation.includes('serialize one collection at a time')), true);

  assert.equal(invalidView.ok, false);
  assert.equal(invalidView.violations.some((violation) => violation.includes('not allowed through the tenant control surface')), true);

  assert.equal(invalidTemplate.ok, false);
  assert.equal(invalidTemplate.violations.some((violation) => violation.includes('templateId must start with a letter')), true);
  assert.equal(invalidTemplate.violations.some((violation) => violation.includes('template quota exceeded')), true);
  assert.equal(invalidTemplate.violations.some((violation) => violation.includes('variables must use unique names')), true);
  assert.equal(invalidTemplate.violations.some((violation) => violation.includes('cannot combine time-series collections with explicit clustered options')), true);

  assert.equal(invalidUser.ok, false);
  assert.equal(invalidUser.violations.some((violation) => violation.includes('Raw passwords are not allowed')), true);
  assert.equal(invalidUser.violations.some((violation) => violation.includes('passwordBinding.serviceAccountId is required')), true);
  assert.equal(invalidUser.violations.some((violation) => violation.includes('passwordBinding.lifecycle.maxLifetimeHours exceeds')), true);
  assert.equal(invalidUser.violations.some((violation) => violation.includes('must start with prefix 01starterdev_')), true);
  assert.equal(invalidUser.violations.some((violation) => violation.includes('role dbOwner is not allowed')), true);

  assert.equal(invalidRoleBinding.ok, false);
  assert.equal(invalidRoleBinding.violations.some((violation) => violation.includes('Sharded cluster topology requires dedicated_cluster isolation')), true);
  assert.equal(invalidRoleBinding.violations.some((violation) => violation.includes('role dbOwner is not allowed')), true);
});

test('mongodb admin adapter builds stable adapter envelopes, inventory snapshots, and normalized dependency errors for structural resources', () => {
  const adapterCall = buildMongoAdminAdapterCall({
    resourceKind: 'index',
    action: 'rebuild',
    callId: 'call_01mongoindexrebuild',
    tenantId: 'ten_01enterprisealpha',
    workspaceId: 'wrk_01enterpriseprod',
    planId: 'pln_01enterprise',
    correlationId: 'corr-mongo-001',
    authorizationDecisionId: 'authz-mongo-001',
    idempotencyKey: 'idem-mongo-001',
    requestedAt: '2026-03-25T10:15:00Z',
    context: {
      scope: 'workspace',
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01enterpriseprod',
      planId: 'pln_01enterprise',
      isolationMode: 'dedicated_cluster',
      clusterTopology: 'sharded_cluster',
      segregationModel: 'tenant_database',
      databaseName: '01enterprisealpha_shared',
      collectionName: '01enterpriseprod_customer_profiles',
      providerVersion: '8.0.0',
      adminCredential: {
        credentialScope: 'tenant',
        serviceAccountRef: 'svc:ten_01enterprisealpha:mongo-admin',
        secretRef: 'sec_mongo_admin_enterprise',
        lifecycleState: 'rotation_required',
        maxLifetimeHours: 120,
        rotationPolicy: 'scheduled'
      }
    },
    payload: {
      databaseName: '01enterprisealpha_shared',
      collectionName: '01enterpriseprod_customer_profiles',
      indexName: 'idx_customer_expiry',
      key: { expiresAt: 1 },
      ttlSeconds: 3600,
      rebuild: {
        strategy: 'rolling_shadow',
        approvalToken: 'approve-idx-rebuild',
        maxParallelCollections: 1,
        allowWritesDuringBuild: true
      }
    },
    scopes: ['data.mongodb.admin.write'],
    effectiveRoles: ['workspace_admin']
  });
  const inventory = buildMongoInventorySnapshot({
    snapshotId: 'mis_01enterpriseprod',
    tenantId: 'ten_01enterprisealpha',
    workspaceId: 'wrk_01enterpriseprod',
    planId: 'pln_01enterprise',
    context: {
      isolationMode: 'dedicated_cluster',
      clusterTopology: 'sharded_cluster',
      segregationModel: 'tenant_database'
    },
    databases: [{ databaseName: '01enterprisealpha_shared' }],
    collections: [
      {
        databaseName: '01enterprisealpha_shared',
        collectionName: '01enterpriseprod_customer_profiles',
        collectionType: 'standard',
        configuration: { validation: { level: 'strict' } },
        metadataSummary: { size: { documentCount: 42, storageBytes: 2048 } }
      }
    ],
    indexes: [
      { databaseName: '01enterprisealpha_shared', collectionName: '01enterpriseprod_customer_profiles', indexName: 'idx_customer_expiry', ttlSeconds: 3600 }
    ],
    views: [
      { databaseName: '01enterprisealpha_shared', viewName: 'customer_profiles_public', sourceCollectionName: '01enterpriseprod_customer_profiles' }
    ],
    templates: [{ templateId: 'CustomerProfile', state: 'active' }],
    users: [{ databaseName: '01enterprisealpha_shared', username: '01enterpriseprod_admin' }],
    roleBindings: [{ roleName: 'dbOwner' }]
  });
  const metadataRecord = buildMongoAdminMetadataRecord({
    resourceKind: 'index',
    action: 'rebuild',
    resource: adapterCall.payload.normalizedResource,
    adminCredentialBinding: adapterCall.payload.adminCredentialBinding,
    preExecutionWarnings: adapterCall.payload.preExecutionWarnings,
    auditSummary: adapterCall.payload.auditSummary,
    correlationContext: adapterCall.payload.correlationContext,
    adminEvent: adapterCall.payload.adminEvent,
    recoveryGuidance: adapterCall.payload.recoveryGuidance,
    minimumPermissionGuidance: adapterCall.payload.minimumPermissionGuidance,
    tenantId: 'ten_01enterprisealpha',
    workspaceId: 'wrk_01enterpriseprod',
    observedAt: '2026-03-25T10:15:01Z'
  });
  const normalizedError = normalizeMongoAdminError(
    {
      classification: 'conflict',
      status: 409,
      message: 'MongoDB index already exists.',
      providerError: 'IndexOptionsConflict'
    },
    {
      resourceKind: 'index',
      action: 'create',
      targetRef: 'index:01enterprisealpha_shared.01enterpriseprod_customer_profiles.idx_customer_expiry',
      databaseName: '01enterprisealpha_shared',
      collectionName: '01enterpriseprod_customer_profiles',
      indexName: 'idx_customer_expiry'
    }
  );

  assert.equal(adapterCall.ok, undefined);
  assert.equal(adapterCall.adapter_id, 'mongodb');
  assert.equal(adapterCall.capability, 'mongo_index_rebuild');
  assert.equal(adapterCall.payload.normalizedResource.resourceType, 'mongo_index');
  assert.equal(adapterCall.payload.context.clusterTopology, 'sharded_cluster');
  assert.equal(adapterCall.payload.context.segregationModel, 'tenant_database');
  assert.equal(adapterCall.contract_version, '2026-03-25');
  assert.equal(adapterCall.requested_at, '2026-03-25T10:15:00Z');
  assert.equal(adapterCall.target_tenant_id, 'ten_01enterprisealpha');
  assert.equal(adapterCall.payload.adminCredentialBinding.credentialScope, 'tenant');
  assert.equal(adapterCall.payload.adminCredentialBinding.lifecycleState, 'rotation_required');
  assert.equal(adapterCall.payload.auditSummary.capturesCredentialBinding, true);
  assert.equal(adapterCall.payload.preExecutionWarnings.some((warning) => warning.includes('credential rotation is requested')), true);
  assert.equal(adapterCall.payload.adminEvent.eventType, 'mongo.admin.index.accepted');
  assert.equal(adapterCall.payload.recoveryGuidance.recoveryClass, 'rotation');
  assert.equal(adapterCall.payload.minimumPermissionGuidance.executionIdentity, 'tenant_scoped_internal_service_account');

  assert.equal(inventory.counts.databases, 1);
  assert.equal(inventory.counts.collections, 1);
  assert.equal(inventory.counts.indexes, 1);
  assert.equal(inventory.counts.views, 1);
  assert.equal(inventory.counts.templates, 1);
  assert.equal(inventory.clusterTopology, 'sharded_cluster');
  assert.equal(inventory.segregationModel, 'tenant_database');
  assert.equal(inventory.minimumEnginePolicy.forbiddenBuiltinRoles.includes('root'), true);
  assert.equal(inventory.minimumEnginePolicy.executionIdentity, 'tenant_scoped_internal_service_account');
  assert.equal(inventory.credentialPosture.adminCredentialBinding.lifecycleState, 'active');
  assert.equal(inventory.auditCoverage.correlationRichEvents, true);
  assert.equal(inventory.collectionRefs[0].validationEnabled, true);

  assert.equal(metadataRecord.metadata.credentialLifecycleState, 'rotation_required');
  assert.equal(metadataRecord.adminEvent.eventType, 'mongo.admin.index.accepted');
  assert.equal(metadataRecord.minimumPermissionGuidance.maximumCredentialLifetimeHours, 336);

  assert.equal(normalizedError.status, 409);
  assert.equal(normalizedError.code, 'GW_MONGO_CONFLICT');
  assert.equal(normalizedError.detail.resourceKind, 'index');
  assert.equal(normalizedError.detail.indexName, 'idx_customer_expiry');
  assert.equal(normalizedError.retryable, false);
});

test('mongodb create validation exposes structured quotaDecision metadata at hard limits', () => {
  const result = validateMongoAdminRequest({
    resourceKind: 'database',
    action: 'create',
    context: {
      tenantId: 'ten_01starteralpha',
      workspaceId: 'wrk_01starterdev',
      planId: 'pln_01growth',
      currentDatabaseCount: 4,
      currentTenantDatabaseCount: 10
    },
    payload: {
      databaseName: 'tenant_alpha_workspace_dev'
    }
  });

  assert.equal(result.quotaDecision.errorCode, 'QUOTA_HARD_LIMIT_REACHED');
  assert.equal(result.quotaDecision.dimensionId, 'logical_databases');
  assert.equal(result.quotaDecision.scopeType, 'workspace');
});
