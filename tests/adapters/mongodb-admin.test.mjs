import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MONGO_ADMIN_CAPABILITY_MATRIX,
  MONGO_DEDICATED_CLUSTER_ALLOWED_ROLE_BINDINGS,
  MONGO_SHARED_CLUSTER_ALLOWED_ROLE_BINDINGS,
  SUPPORTED_MONGO_VERSION_RANGES,
  buildMongoAdminAdapterCall,
  buildMongoInventorySnapshot,
  isMongoVersionSupported,
  normalizeMongoAdminError,
  normalizeMongoAdminResource,
  resolveMongoAdminProfile,
  validateMongoAdminRequest
} from '../../services/adapters/src/mongodb-admin.mjs';

test('mongodb admin adapter exports supported versions, resource coverage, and profile guardrails', () => {
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
    clusterTopology: 'sharded_cluster'
  });

  assert.deepEqual(Object.keys(MONGO_ADMIN_CAPABILITY_MATRIX), ['database', 'collection', 'user', 'role_binding']);
  assert.equal(SUPPORTED_MONGO_VERSION_RANGES.length, 3);
  assert.equal(isMongoVersionSupported('6.0.15'), true);
  assert.equal(isMongoVersionSupported('7.0.9'), true);
  assert.equal(isMongoVersionSupported('8.0.1'), true);
  assert.equal(isMongoVersionSupported('5.0.20'), false);
  assert.deepEqual(sharedProfile.allowedRoleBindings, MONGO_SHARED_CLUSTER_ALLOWED_ROLE_BINDINGS);
  assert.deepEqual(dedicatedProfile.allowedRoleBindings, MONGO_DEDICATED_CLUSTER_ALLOWED_ROLE_BINDINGS);
  assert.equal(dedicatedProfile.supportedClusterTopologies.includes('sharded_cluster'), true);
});

test('mongodb admin adapter normalizes databases, collections, users, and role bindings into stable BaaS-native shapes', () => {
  const database = normalizeMongoAdminResource(
    'database',
    {
      databaseName: '01starterdev_app',
      stats: { collections: 4, users: 2, documents: 3210, storageBytes: 524288 },
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
      capped: false,
      validation: { level: 'strict', action: 'error', schemaRef: 'schema://customer-profile/v1' },
      indexes: [{ name: 'idx_customer_email', key: { email: 1 }, unique: true }]
    },
    {
      tenantId: 'ten_01starteralpha',
      workspaceId: 'wrk_01starterdev',
      planId: 'pln_01growth',
      databaseName: '01starterdev_app'
    }
  );
  const user = normalizeMongoAdminResource(
    'user',
    {
      databaseName: '01starterdev_app',
      username: '01starterdev_reader',
      passwordBinding: { mode: 'managed_secret_ref', secretRef: 'sec_mongo_reader' },
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
  assert.equal(database.providerCompatibility.provider, 'mongodb');
  assert.equal(collection.resourceType, 'mongo_collection');
  assert.equal(collection.configuration.validation.schemaRef, 'schema://customer-profile/v1');
  assert.equal(collection.indexDefinitions[0].name, 'idx_customer_email');
  assert.equal(user.resourceType, 'mongo_user');
  assert.equal(user.passwordBinding.secretRef, 'sec_mongo_reader');
  assert.equal(user.roleBindings[0].roleName, 'readWrite');
  assert.equal(roleBinding.resourceType, 'mongo_role_binding');
  assert.equal(roleBinding.scope, 'collection');
});

test('mongodb admin adapter validates naming, quota, topology, and privilege guardrails before building provider calls', () => {
  const invalidDatabase = validateMongoAdminRequest({
    resourceKind: 'database',
    action: 'create',
    context: {
      tenantId: 'ten_01starteralpha',
      workspaceId: 'wrk_01starterdev',
      planId: 'pln_01growth',
      currentDatabaseCount: 3
    },
    payload: {
      databaseName: 'admin'
    }
  });
  const invalidCollection = validateMongoAdminRequest({
    resourceKind: 'collection',
    action: 'create',
    context: {
      tenantId: 'ten_01starteralpha',
      workspaceId: 'wrk_01starterdev',
      planId: 'pln_01growth',
      databaseName: '01starterdev_app'
    },
    payload: {
      databaseName: '01starterdev_app',
      collectionName: 'system.profile',
      collectionType: 'timeseries',
      capped: true,
      indexes: [{ name: 'idx_dup', key: { a: 1 } }, { name: 'idx_dup', key: { b: 1 } }]
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

  assert.equal(invalidDatabase.ok, false);
  assert.equal(invalidDatabase.violations.some((violation) => violation.includes('reserved')), true);
  assert.equal(invalidDatabase.violations.some((violation) => violation.includes('database quota exceeded')), true);

  assert.equal(invalidCollection.ok, false);
  assert.equal(invalidCollection.violations.some((violation) => violation.includes('system.* collections')), true);
  assert.equal(invalidCollection.violations.some((violation) => violation.includes('cannot also be configured as capped')), true);
  assert.equal(invalidCollection.violations.some((violation) => violation.includes('unique names')), true);

  assert.equal(invalidUser.ok, false);
  assert.equal(invalidUser.violations.some((violation) => violation.includes('passwordBinding or rotatePassword')), true);
  assert.equal(invalidUser.violations.some((violation) => violation.includes('must start with prefix 01starterdev_')), true);
  assert.equal(invalidUser.violations.some((violation) => violation.includes('role dbOwner is not allowed')), true);

  assert.equal(invalidRoleBinding.ok, false);
  assert.equal(invalidRoleBinding.violations.some((violation) => violation.includes('Sharded cluster topology requires dedicated_cluster isolation')), true);
  assert.equal(invalidRoleBinding.violations.some((violation) => violation.includes('role dbOwner is not allowed')), true);
});

test('mongodb admin adapter builds stable adapter envelopes, inventory snapshots, and normalized dependency errors', () => {
  const adapterCall = buildMongoAdminAdapterCall({
    resourceKind: 'user',
    action: 'create',
    callId: 'call_01mongousercreate',
    tenantId: 'ten_01enterprisealpha',
    workspaceId: 'wrk_01enterpriseprod',
    planId: 'pln_01enterprise',
    correlationId: 'corr-mongo-001',
    authorizationDecisionId: 'authz-mongo-001',
    idempotencyKey: 'idem-mongo-001',
    context: {
      scope: 'workspace',
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01enterpriseprod',
      planId: 'pln_01enterprise',
      isolationMode: 'dedicated_cluster',
      clusterTopology: 'sharded_cluster',
      databaseName: '01enterpriseprod_app',
      providerVersion: '8.0.0'
    },
    payload: {
      databaseName: '01enterpriseprod_app',
      username: '01enterpriseprod_admin',
      passwordBinding: { mode: 'managed_secret_ref', secretRef: 'sec_mongo_admin' },
      roleBindings: [{ roleName: 'dbOwner', databaseName: '01enterpriseprod_app' }]
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
      clusterTopology: 'sharded_cluster'
    },
    databases: [{ databaseName: '01enterpriseprod_app' }],
    collections: [{ databaseName: '01enterpriseprod_app', collectionName: 'customer_profiles' }],
    users: [{ databaseName: '01enterpriseprod_app', username: '01enterpriseprod_admin' }],
    roleBindings: [{ roleName: 'dbOwner' }]
  });
  const normalizedError = normalizeMongoAdminError(
    {
      classification: 'conflict',
      status: 409,
      message: 'MongoDB user already exists.',
      providerError: 'DuplicateUser'
    },
    {
      resourceKind: 'user',
      action: 'create',
      targetRef: 'user:01enterpriseprod_app.01enterpriseprod_admin',
      databaseName: '01enterpriseprod_app',
      username: '01enterpriseprod_admin'
    }
  );

  assert.equal(adapterCall.ok, undefined);
  assert.equal(adapterCall.adapter_id, 'mongodb');
  assert.equal(adapterCall.capability, 'mongo_user_create');
  assert.equal(adapterCall.payload.normalizedResource.resourceType, 'mongo_user');
  assert.equal(adapterCall.payload.context.clusterTopology, 'sharded_cluster');
  assert.equal(adapterCall.contract_version, '2026-03-24');

  assert.equal(inventory.counts.databases, 1);
  assert.equal(inventory.counts.collections, 1);
  assert.equal(inventory.clusterTopology, 'sharded_cluster');
  assert.equal(inventory.minimumEnginePolicy.forbiddenBuiltinRoles.includes('root'), true);

  assert.equal(normalizedError.status, 409);
  assert.equal(normalizedError.code, 'GW_MONGO_CONFLICT');
  assert.equal(normalizedError.detail.resourceKind, 'user');
  assert.equal(normalizedError.retryable, false);
});
