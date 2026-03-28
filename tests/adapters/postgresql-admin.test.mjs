import test from 'node:test';
import assert from 'node:assert/strict';

import {
  POSTGRES_ADMIN_CAPABILITY_MATRIX,
  POSTGRES_ADMIN_MINIMUM_ENGINE_POLICY,
  RESERVED_POSTGRES_DATABASE_NAMES,
  SUPPORTED_POSTGRES_VERSION_RANGES,
  buildAllowedPostgresTypeCatalog,
  buildPostgresAdminAdapterCall,
  buildPostgresAdminInventorySnapshot,
  buildPostgresAdminMetadataRecord,
  buildPostgresAdministrativeSqlPlan,
  buildPostgresGovernanceSqlPlan,
  buildPostgresStructuralSqlPlan,
  evaluatePostgresDataApiAccess,
  isPostgresVersionSupported,
  normalizePostgresAdminError,
  normalizePostgresAdminResource,
  resolvePostgresAdminProfile,
  validatePostgresAdminRequest
} from '../../services/adapters/src/postgresql-admin.mjs';

test('postgres admin adapter exports the expanded capability matrix and profile baseline', () => {
  const growthProfile = resolvePostgresAdminProfile({ planId: 'pln_01growth' });
  const enterpriseProfile = resolvePostgresAdminProfile({ planId: 'pln_01enterprise' });

  assert.deepEqual(Object.keys(POSTGRES_ADMIN_CAPABILITY_MATRIX), [
    'role',
    'user',
    'database',
    'schema',
    'table',
    'column',
    'type',
    'constraint',
    'index',
    'view',
    'materialized_view',
    'function',
    'procedure',
    'table_security',
    'policy',
    'grant',
    'extension',
    'template'
  ]);
  assert.deepEqual(POSTGRES_ADMIN_CAPABILITY_MATRIX.table, ['list', 'get', 'create', 'update', 'delete']);
  assert.deepEqual(POSTGRES_ADMIN_CAPABILITY_MATRIX.column, ['list', 'get', 'create', 'update', 'delete']);
  assert.deepEqual(POSTGRES_ADMIN_CAPABILITY_MATRIX.type, ['list', 'get']);
  assert.deepEqual(POSTGRES_ADMIN_CAPABILITY_MATRIX.materialized_view, ['list', 'get', 'create', 'update', 'delete']);
  assert.deepEqual(POSTGRES_ADMIN_CAPABILITY_MATRIX.function, ['list', 'get', 'create', 'update', 'delete']);
  assert.deepEqual(POSTGRES_ADMIN_CAPABILITY_MATRIX.table_security, ['get', 'update']);
  assert.deepEqual(POSTGRES_ADMIN_CAPABILITY_MATRIX.policy, ['list', 'get', 'create', 'update', 'delete']);
  assert.deepEqual(POSTGRES_ADMIN_CAPABILITY_MATRIX.grant, ['list', 'get', 'create', 'update', 'delete']);
  assert.deepEqual(POSTGRES_ADMIN_CAPABILITY_MATRIX.extension, ['list', 'get', 'create', 'update', 'delete']);
  assert.deepEqual(POSTGRES_ADMIN_CAPABILITY_MATRIX.template, ['list', 'get', 'create', 'update', 'delete']);
  assert.equal(SUPPORTED_POSTGRES_VERSION_RANGES.length, 3);
  assert.equal(isPostgresVersionSupported('15.6'), true);
  assert.equal(isPostgresVersionSupported('16.3'), true);
  assert.equal(isPostgresVersionSupported('17.0'), true);
  assert.equal(isPostgresVersionSupported('14.11'), false);
  assert.equal(growthProfile.placementMode, 'schema_per_tenant');
  assert.equal(growthProfile.databaseMutationsSupported, false);
  assert.equal(growthProfile.tableMutationsSupported, true);
  assert.equal(growthProfile.columnMutationsSupported, true);
  assert.equal(growthProfile.constraintMutationsSupported, true);
  assert.equal(growthProfile.materializedViewMutationsSupported, true);
  assert.equal(growthProfile.functionMutationsSupported, true);
  assert.equal(growthProfile.tableSecurityMutationsSupported, true);
  assert.equal(growthProfile.policyMutationsSupported, true);
  assert.equal(growthProfile.grantMutationsSupported, true);
  assert.equal(growthProfile.extensionMutationsSupported, true);
  assert.equal(growthProfile.templateCatalogSupported, true);
  assert.equal(growthProfile.typeCatalogSupported, true);
  assert.equal(growthProfile.authorizedExtensions.some((entry) => entry.extensionName === 'pgcrypto'), true);
  assert.equal(enterpriseProfile.placementMode, 'database_per_tenant');
  assert.equal(enterpriseProfile.databaseMutationsSupported, true);
  assert.equal(POSTGRES_ADMIN_MINIMUM_ENGINE_POLICY.database_per_tenant.requiresCreatedb, true);
  assert.equal(POSTGRES_ADMIN_MINIMUM_ENGINE_POLICY.schema_per_tenant.allowedCapabilities.includes('create_workspace_materialized_views'), true);
  assert.equal(POSTGRES_ADMIN_MINIMUM_ENGINE_POLICY.database_per_tenant.allowedCapabilities.includes('create_workspace_routines'), true);
  assert.equal(RESERVED_POSTGRES_DATABASE_NAMES.includes('postgres'), true);
});

test('postgres admin adapter normalizes provider payloads into safe resource shapes for structural and programmable objects', () => {
  const role = normalizePostgresAdminResource(
    'role',
    {
      roleName: 'alpha_dev_readwrite',
      memberOf: ['alpha_dev_runtime'],
      metadata: { source: 'console' }
    },
    {
      tenantId: 'ten_01starteralpha',
      workspaceId: 'wrk_01alphadev',
      planId: 'pln_01growth'
    }
  );
  const index = normalizePostgresAdminResource(
    'index',
    {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      tableName: 'customer_orders',
      indexName: 'customer_orders_status_created_at_idx',
      indexMethod: 'btree',
      unique: false,
      keys: [{ columnName: 'status' }, { columnName: 'created_at', order: 'desc' }],
      predicateExpression: "status <> 'archived'"
    },
    {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      planId: 'pln_01enterprise'
    }
  );
  const materializedView = normalizePostgresAdminResource(
    'materialized_view',
    {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      viewName: 'customer_order_rollups',
      query: 'select customer_id, count(*) as order_count from alpha_prod_app.customer_orders group by customer_id',
      refreshPolicy: 'manual',
      indexes: [
        {
          indexName: 'customer_order_rollups_customer_id_idx',
          indexMethod: 'btree',
          keys: [{ columnName: 'customer_id' }]
        }
      ]
    },
    {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      planId: 'pln_01enterprise'
    }
  );
  const fn = normalizePostgresAdminResource(
    'function',
    {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      routineName: 'get_customer_order',
      language: 'sql',
      arguments: [{ name: 'input_order_id', dataType: 'uuid' }],
      returnsType: 'jsonb',
      body: 'select to_jsonb(customer_orders) from alpha_prod_app.customer_orders where id = input_order_id',
      documentation: { summary: 'Fetch one order.' }
    },
    {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      planId: 'pln_01enterprise'
    }
  );
  const tableSecurity = normalizePostgresAdminResource(
    'table_security',
    {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      tableName: 'customer_orders',
      rlsEnabled: true,
      forceRls: true,
      policyCount: 2
    },
    {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      planId: 'pln_01enterprise'
    }
  );
  const grant = normalizePostgresAdminResource(
    'grant',
    {
      granteeRoleName: 'alpha_prod_runtime',
      target: {
        databaseName: 'tenant_alpha_main',
        schemaName: 'alpha_prod_app',
        objectType: 'table',
        objectName: 'customer_orders'
      },
      privileges: ['select']
    },
    {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      planId: 'pln_01enterprise'
    }
  );
  const extension = normalizePostgresAdminResource(
    'extension',
    {
      databaseName: 'tenant_alpha_main',
      extensionName: 'pgcrypto',
      schemaName: 'public',
      requestedVersion: '1.3'
    },
    {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      planId: 'pln_01enterprise'
    }
  );
  const template = normalizePostgresAdminResource(
    'template',
    {
      templateId: 'pg_schema_shared_v1',
      templateScope: 'schema',
      description: 'Shared-schema bootstrap',
      documentation: { summary: 'Shared-schema tenant bootstrap.' },
      defaults: { extensions: ['pgcrypto'] }
    },
    {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      planId: 'pln_01enterprise'
    }
  );
  const allowedType = normalizePostgresAdminResource(
    'type',
    {
      schemaName: 'pg_catalog',
      typeName: 'jsonb'
    },
    {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      planId: 'pln_01enterprise'
    }
  );

  assert.equal(role.resourceType, 'postgres_role');
  assert.deepEqual(role.memberOf, ['alpha_dev_runtime']);
  assert.equal(role.providerCompatibility.provider, 'postgresql');

  assert.equal(index.resourceType, 'postgres_index');
  assert.equal(index.performanceProfile.supportsCompound, true);
  assert.equal(index.performanceProfile.supportsPartial, true);
  assert.equal(index.keys[1].order, 'desc');

  assert.equal(materializedView.resourceType, 'postgres_materialized_view');
  assert.equal(materializedView.integrityProfile.indexCount, 1);
  assert.equal(materializedView.integrityProfile.refreshPolicy, 'manual');

  assert.equal(fn.resourceType, 'postgres_function');
  assert.equal(fn.signature, 'get_customer_order(uuid)');
  assert.equal(fn.documentation.summary, 'Fetch one order.');

  assert.equal(tableSecurity.resourceType, 'postgres_table_security');
  assert.equal(tableSecurity.forceRls, true);

  assert.equal(grant.resourceType, 'postgres_grant');
  assert.equal(grant.privileges[0], 'select');

  assert.equal(extension.resourceType, 'postgres_extension');
  assert.equal(extension.authorized, true);

  assert.equal(template.resourceType, 'postgres_template');
  assert.equal(template.templateScope, 'schema');

  assert.equal(allowedType.resourceType, 'postgres_type');
  assert.equal(allowedType.typeName, 'jsonb');
  assert.equal(allowedType.category, 'built_in');
});

test('postgres admin adapter validates profile guardrails, dependency safety, tenant routine policies, and allowed types', () => {
  const sharedDatabaseMutation = validatePostgresAdminRequest({
    resourceKind: 'database',
    action: 'create',
    context: {
      tenantId: 'ten_01starteralpha',
      workspaceId: 'wrk_01alphadev',
      planId: 'pln_01growth',
      tenantNamePrefix: 'tenant_alpha'
    },
    payload: {
      databaseName: 'tenant_alpha_extra',
      ownerRoleName: 'tenant_alpha_owner'
    }
  });
  const unsafeUser = validatePostgresAdminRequest({
    resourceKind: 'user',
    action: 'create',
    context: {
      tenantId: 'ten_01starteralpha',
      workspaceId: 'wrk_01alphadev',
      planId: 'pln_01growth',
      workspaceNamePrefix: 'alpha_dev_',
      currentInventory: {
        counts: {
          users: 64
        }
      }
    },
    payload: {
      userName: 'wrongprefix_api',
      memberOf: ['platform_provisioner', 'platform_provisioner'],
      password: 'plain-text-is-forbidden'
    }
  });
  const incompatibleColumnUpdate = validatePostgresAdminRequest({
    resourceKind: 'column',
    action: 'update',
    context: {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      planId: 'pln_01enterprise',
      currentTable: {
        nullValueCountByColumn: {
          status: 3
        }
      },
      currentColumn: {
        columnName: 'status',
        nullable: true,
        dataType: { fullName: 'varchar(64)' }
      }
    },
    payload: {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      tableName: 'customer_orders',
      columnName: 'status',
      dataType: 'varchar(16)',
      nullable: false
    }
  });
  const blockedConstraint = validatePostgresAdminRequest({
    resourceKind: 'constraint',
    action: 'create',
    context: {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      planId: 'pln_01enterprise',
      currentTable: {
        columns: [{ columnName: 'status' }],
        nullValueCountByColumn: { status: 2 }
      }
    },
    payload: {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      tableName: 'customer_orders',
      constraintType: 'not_null',
      columnName: 'status'
    }
  });
  const blockedTableDelete = validatePostgresAdminRequest({
    resourceKind: 'table',
    action: 'delete',
    context: {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      planId: 'pln_01enterprise',
      currentTable: {
        dependentViews: [{ reference: 'tenant_alpha_main.alpha_prod_app.customer_order_projection' }],
        dependentIndexes: [{ reference: 'tenant_alpha_main.alpha_prod_app.customer_orders_status_idx' }]
      }
    },
    payload: {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      tableName: 'customer_orders'
    }
  });
  const blockedIndexDelete = validatePostgresAdminRequest({
    resourceKind: 'index',
    action: 'delete',
    context: {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      planId: 'pln_01enterprise',
      currentIndex: {
        indexName: 'customer_orders_pkey_idx',
        backingConstraintName: 'customer_orders_pkey'
      }
    },
    payload: {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      tableName: 'customer_orders',
      indexName: 'customer_orders_pkey_idx'
    }
  });
  const blockedView = validatePostgresAdminRequest({
    resourceKind: 'view',
    action: 'create',
    context: {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      planId: 'pln_01enterprise',
      availableRelations: [{ databaseName: 'tenant_alpha_main', schemaName: 'alpha_prod_app', relationName: 'customer_orders' }]
    },
    payload: {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      viewName: 'unsafe_projection',
      query: 'delete from alpha_prod_app.customer_orders'
    }
  });
  const blockedRoutine = validatePostgresAdminRequest({
    resourceKind: 'function',
    action: 'create',
    context: {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      planId: 'pln_01enterprise'
    },
    payload: {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      routineName: 'escalate_privileges',
      language: 'sql',
      returnsType: 'uuid',
      body: 'select pg_read_file(\'/etc/passwd\')',
      documentation: { summary: 'Unsafe.' }
    }
  });
  const disallowedType = validatePostgresAdminRequest({
    resourceKind: 'column',
    action: 'create',
    context: {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      planId: 'pln_01enterprise',
      allowedTypeCatalog: buildAllowedPostgresTypeCatalog({ enabledExtensions: [] })
    },
    payload: {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      tableName: 'customer_orders',
      columnName: 'embedding',
      dataType: 'public.vector',
      nullable: true
    }
  });
  const unsafeRlsDisable = validatePostgresAdminRequest({
    resourceKind: 'table_security',
    action: 'update',
    context: {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      planId: 'pln_01enterprise',
      currentPolicies: [{ policyName: 'customer_orders_tenant_isolation' }],
      currentTable: { sharedTableClassification: 'tenant_scoped' }
    },
    payload: {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      tableName: 'customer_orders',
      rlsEnabled: false
    }
  });
  const unsafeGrant = validatePostgresAdminRequest({
    resourceKind: 'grant',
    action: 'create',
    context: {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      planId: 'pln_01enterprise'
    },
    payload: {
      granteeRoleName: 'postgres',
      target: {
        databaseName: 'tenant_alpha_main',
        schemaName: 'alpha_prod_app',
        objectType: 'table',
        objectName: 'customer_orders'
      },
      privileges: ['execute']
    }
  });
  const unauthorizedExtension = validatePostgresAdminRequest({
    resourceKind: 'extension',
    action: 'create',
    context: {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      planId: 'pln_01enterprise',
      authorizedExtensions: ['pgcrypto']
    },
    payload: {
      databaseName: 'tenant_alpha_main',
      extensionName: 'postgis'
    }
  });
  const missingTemplate = validatePostgresAdminRequest({
    resourceKind: 'schema',
    action: 'create',
    context: {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      planId: 'pln_01enterprise',
      tenantDatabaseName: 'tenant_alpha_main',
      templateCatalog: []
    },
    payload: {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      ownerRoleName: 'alpha_prod_owner',
      workspaceBindings: ['wrk_01alphaprod'],
      templateId: 'pg_schema_shared_v1'
    }
  });
  const projectedColumnQuota = validatePostgresAdminRequest({
    resourceKind: 'table',
    action: 'create',
    context: {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      planId: 'pln_01enterprise',
      currentInventory: {
        counts: {
          columns: 2046
        }
      }
    },
    payload: {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      tableName: 'customer_order_shadow',
      columns: [
        { columnName: 'tenant_id', dataType: 'uuid', nullable: false },
        { columnName: 'workspace_id', dataType: 'uuid', nullable: false },
        { columnName: 'payload', dataType: 'jsonb', nullable: false }
      ]
    }
  });
  const projectedMaterializedViewIndexQuota = validatePostgresAdminRequest({
    resourceKind: 'materialized_view',
    action: 'create',
    context: {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      planId: 'pln_01enterprise',
      currentInventory: {
        counts: {
          indexes: 1535
        }
      }
    },
    payload: {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      materializedViewName: 'customer_order_rollups',
      query: 'SELECT tenant_id, count(*) AS total_orders FROM alpha_prod_app.customer_orders GROUP BY tenant_id',
      indexes: [
        {
          indexName: 'customer_order_rollups_tenant_idx',
          indexMethod: 'btree',
          keys: [{ columnName: 'tenant_id' }]
        },
        {
          indexName: 'customer_order_rollups_total_idx',
          indexMethod: 'btree',
          keys: [{ columnName: 'total_orders' }]
        }
      ]
    }
  });

  assert.equal(sharedDatabaseMutation.ok, false);
  assert.equal(
    sharedDatabaseMutation.violations.some((violation) => violation.includes('Database mutations are not supported for placement mode schema_per_tenant')),
    true
  );

  assert.equal(unsafeUser.ok, false);
  assert.equal(unsafeUser.violations.some((violation) => violation.includes('Unsafe engine field password')), true);
  assert.equal(unsafeUser.violations.some((violation) => violation.includes('must start with alpha_dev_')), true);
  assert.equal(unsafeUser.violations.some((violation) => violation.includes('cannot target reserved platform or engine roles')), true);
  assert.equal(unsafeUser.violations.some((violation) => violation.includes('would be exceeded')), true);

  assert.equal(incompatibleColumnUpdate.ok, false);
  assert.equal(incompatibleColumnUpdate.violations.some((violation) => violation.includes('narrower precision')), true);
  assert.equal(incompatibleColumnUpdate.violations.some((violation) => violation.includes('while null values still exist')), true);

  assert.equal(blockedConstraint.ok, false);
  assert.equal(blockedConstraint.violations.some((violation) => violation.includes('cannot be made NOT NULL while null values still exist')), true);

  assert.equal(blockedTableDelete.ok, false);
  assert.equal(blockedTableDelete.violations.some((violation) => violation.includes('dependent objects still reference it')), true);

  assert.equal(blockedIndexDelete.ok, false);
  assert.equal(blockedIndexDelete.violations.some((violation) => violation.includes('managed by constraint')), true);

  assert.equal(blockedView.ok, false);
  assert.equal(blockedView.violations.some((violation) => violation.includes('read-only SELECT/WITH statements')), true);

  assert.equal(blockedRoutine.ok, false);
  assert.equal(blockedRoutine.violations.some((violation) => violation.includes('safe tenant-exposed routine subset')), true);

  assert.equal(disallowedType.ok, false);
  assert.equal(disallowedType.violations.some((violation) => violation.includes('allowed type catalog')), true);

  assert.equal(unsafeRlsDisable.ok, false);
  assert.equal(unsafeRlsDisable.violations.some((violation) => violation.includes('acknowledgeTenantIsolationImpact')), true);
  assert.equal(unsafeRlsDisable.violations.some((violation) => violation.includes('Tenant-scoped shared tables')), true);

  assert.equal(unsafeGrant.ok, false);
  assert.equal(unsafeGrant.violations.some((violation) => violation.includes('reserved PostgreSQL roles')), true);
  assert.equal(unsafeGrant.violations.some((violation) => violation.includes('not supported for table targets')), true);

  assert.equal(unauthorizedExtension.ok, false);
  assert.equal(unauthorizedExtension.violations.some((violation) => violation.includes('authorized extension catalog')), true);

  assert.equal(missingTemplate.ok, false);
  assert.equal(missingTemplate.violations.some((violation) => violation.includes('workspace template catalog')), true);

  assert.equal(projectedColumnQuota.ok, false);
  assert.equal(projectedColumnQuota.violations.some((violation) => violation.includes('Quota table.postgres.columns.max')), true);

  assert.equal(projectedMaterializedViewIndexQuota.ok, false);
  assert.equal(projectedMaterializedViewIndexQuota.violations.some((violation) => violation.includes('materialized-view index')), true);
});

test('postgres admin adapter exposes common and advanced type catalogs when cluster features are enabled', () => {
  const baseline = buildAllowedPostgresTypeCatalog();
  const advanced = buildAllowedPostgresTypeCatalog({
    enableRangeTypes: true,
    enableNetworkTypes: true,
    enableTextSearchTypes: true,
    enabledExtensions: ['vector'],
    extensionTypes: [{ schemaName: 'public', typeName: 'vector', extensionName: 'vector', kind: 'scalar', typeClass: 'base' }],
    userDefinedTypes: [{ schemaName: 'alpha_prod_app', typeName: 'order_status', kind: 'enum', typeClass: 'enum', enumLabels: ['draft', 'paid'] }]
  });

  assert.equal(baseline.some((entry) => entry.typeName === 'uuid'), true);
  assert.equal(baseline.some((entry) => entry.typeName === 'jsonb'), true);
  assert.equal(baseline.some((entry) => entry.typeName === 'integer[]'), true);
  assert.equal(advanced.some((entry) => entry.typeName === 'inet'), true);
  assert.equal(advanced.some((entry) => entry.typeName === 'daterange'), true);
  assert.equal(advanced.some((entry) => entry.typeName === 'tsvector'), true);
  assert.equal(advanced.some((entry) => entry.fullName === 'public.vector'), true);
  assert.equal(advanced.some((entry) => entry.fullName === 'alpha_prod_app.order_status'), true);
});

test('postgres admin adapter builds stable adapter envelopes, inventory projections, SQL plans, and normalized dependency errors for advanced objects', () => {
  const adapterCall = buildPostgresAdminAdapterCall({
    resourceKind: 'materialized_view',
    action: 'create',
    callId: 'call_01pgmatviewcreate',
    tenantId: 'ten_01enterprisealpha',
    workspaceId: 'wrk_01alphaprod',
    planId: 'pln_01enterprise',
    correlationId: 'corr-pgadm-001',
    authorizationDecisionId: 'authz-pgadm-001',
    idempotencyKey: 'idem-pgadm-001',
    targetRef: 'database:tenant_alpha_main/schema:alpha_prod_app/materialized_view:customer_order_rollups',
    context: {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      planId: 'pln_01enterprise',
      availableRelations: [{ databaseName: 'tenant_alpha_main', schemaName: 'alpha_prod_app', relationName: 'customer_orders' }]
    },
    payload: {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      viewName: 'customer_order_rollups',
      query: 'select customer_id, count(*) as order_count from alpha_prod_app.customer_orders group by customer_id',
      refreshPolicy: 'manual',
      indexes: [
        {
          indexName: 'customer_order_rollups_customer_id_idx',
          indexMethod: 'btree',
          keys: [{ columnName: 'customer_id' }]
        }
      ]
    },
    scopes: ['database.admin'],
    effectiveRoles: ['workspace_admin']
  });
  const routineCall = buildPostgresAdminAdapterCall({
    resourceKind: 'function',
    action: 'create',
    callId: 'call_01pgfunctioncreate',
    tenantId: 'ten_01enterprisealpha',
    workspaceId: 'wrk_01alphaprod',
    planId: 'pln_01enterprise',
    correlationId: 'corr-pgadm-002',
    authorizationDecisionId: 'authz-pgadm-002',
    idempotencyKey: 'idem-pgadm-002',
    targetRef: 'database:tenant_alpha_main/schema:alpha_prod_app/function:get_customer_order',
    context: {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      planId: 'pln_01enterprise',
      availableRelations: [{ databaseName: 'tenant_alpha_main', schemaName: 'alpha_prod_app', relationName: 'customer_orders' }]
    },
    payload: {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      routineName: 'get_customer_order',
      language: 'sql',
      arguments: [{ name: 'input_order_id', dataType: 'uuid' }],
      returnsType: 'jsonb',
      body: 'select to_jsonb(customer_orders) from alpha_prod_app.customer_orders where id = input_order_id',
      documentation: { summary: 'Fetch one order.' }
    },
    scopes: ['database.admin'],
    effectiveRoles: ['workspace_admin']
  });
  const tableSecurityCall = buildPostgresAdminAdapterCall({
    resourceKind: 'table_security',
    action: 'update',
    callId: 'call_01pgrlsupdate',
    tenantId: 'ten_01enterprisealpha',
    workspaceId: 'wrk_01alphaprod',
    planId: 'pln_01enterprise',
    correlationId: 'corr-pgadm-003',
    authorizationDecisionId: 'authz-pgadm-003',
    idempotencyKey: 'idem-pgadm-003',
    targetRef: 'database:tenant_alpha_main/schema:alpha_prod_app/table:customer_orders/security',
    context: {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      planId: 'pln_01enterprise',
      currentPolicies: [{ policyName: 'customer_orders_tenant_isolation' }],
      currentTable: { sharedTableClassification: 'workspace_local' }
    },
    payload: {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      tableName: 'customer_orders',
      rlsEnabled: true,
      forceRls: true
    },
    scopes: ['database.admin'],
    effectiveRoles: ['workspace_admin']
  });
  const previewCall = buildPostgresAdminAdapterCall({
    resourceKind: 'column',
    action: 'update',
    callId: 'call_01pgcolumnpreview',
    tenantId: 'ten_01enterprisealpha',
    workspaceId: 'wrk_01alphaprod',
    planId: 'pln_01enterprise',
    correlationId: 'corr-pgadm-004',
    authorizationDecisionId: 'authz-pgadm-004',
    idempotencyKey: 'idem-pgadm-004',
    targetRef: 'database:tenant_alpha_main/schema:alpha_prod_app/table:customer_orders/column:status',
    context: {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      planId: 'pln_01enterprise',
      currentTable: { rowEstimate: 125000 },
      currentColumn: {
        columnName: 'status',
        dataType: { typeName: 'text', fullName: 'pg_catalog.text' },
        nullable: true,
        defaultExpression: null
      }
    },
    payload: {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      tableName: 'customer_orders',
      columnName: 'status',
      dataType: 'text',
      nullable: false,
      dryRun: true
    },
    scopes: ['database.admin'],
    effectiveRoles: ['workspace_admin']
  });
  const destructiveGrantCall = buildPostgresAdminAdapterCall({
    resourceKind: 'grant',
    action: 'create',
    callId: 'call_01pggrantwarn',
    tenantId: 'ten_01enterprisealpha',
    workspaceId: 'wrk_01alphaprod',
    planId: 'pln_01enterprise',
    correlationId: 'corr-pgadm-005',
    authorizationDecisionId: 'authz-pgadm-005',
    idempotencyKey: 'idem-pgadm-005',
    targetRef: 'database:tenant_alpha_main/schema:alpha_prod_app/table:customer_orders/grant:alpha_prod_runtime',
    context: {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      planId: 'pln_01enterprise'
    },
    payload: {
      granteeRoleName: 'alpha_prod_runtime',
      target: {
        databaseName: 'tenant_alpha_main',
        schemaName: 'alpha_prod_app',
        objectType: 'table',
        objectName: 'customer_orders'
      },
      privileges: ['select', 'update']
    },
    scopes: ['database.admin'],
    effectiveRoles: ['workspace_admin']
  });
  const grantPlan = buildPostgresGovernanceSqlPlan({
    resourceKind: 'grant',
    action: 'create',
    payload: {
      granteeRoleName: 'alpha_prod_runtime',
      target: {
        databaseName: 'tenant_alpha_main',
        schemaName: 'alpha_prod_app',
        objectType: 'table',
        objectName: 'customer_orders'
      },
      privileges: ['select']
    },
    context: {
      profile: resolvePostgresAdminProfile({ planId: 'pln_01enterprise' })
    }
  });
  const schemaPlan = buildPostgresAdministrativeSqlPlan({
    resourceKind: 'schema',
    action: 'update',
    payload: {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      ownerRoleName: 'alpha_prod_owner',
      comment: 'Tenant schema',
      documentation: { summary: 'Tenant schema for workspace alpha.' }
    },
    context: {
      planId: 'pln_01enterprise',
      profile: resolvePostgresAdminProfile({ planId: 'pln_01enterprise' })
    }
  });
  const inventory = buildPostgresAdminInventorySnapshot({
    tenantId: 'ten_01enterprisealpha',
    workspaceId: 'wrk_01alphaprod',
    planId: 'pln_01enterprise',
    roles: [{ roleName: 'alpha_prod_owner' }],
    users: [{ userName: 'alpha_prod_api' }],
    databases: [{ databaseName: 'tenant_alpha_main' }],
    schemas: [{ databaseName: 'tenant_alpha_main', schemaName: 'alpha_prod_app', workspaceBindings: ['wrk_01alphaprod'], comment: 'Tenant schema' }],
    tables: [{ databaseName: 'tenant_alpha_main', schemaName: 'alpha_prod_app', tableName: 'customer_orders', columnCount: 2, documentation: { summary: 'Orders table.' } }],
    sequences: [{ databaseName: 'tenant_alpha_main', schemaName: 'alpha_prod_app', sequenceName: 'customer_orders_id_seq', ownedByTableName: 'customer_orders', ownedByColumnName: 'id' }],
    tableSecurity: [{ databaseName: 'tenant_alpha_main', schemaName: 'alpha_prod_app', tableName: 'customer_orders', rlsEnabled: true, forceRls: true, policyCount: 1 }],
    policies: [{ databaseName: 'tenant_alpha_main', schemaName: 'alpha_prod_app', tableName: 'customer_orders', policyName: 'customer_orders_tenant_isolation', appliesTo: { command: 'select' }, policyMode: 'restrictive' }],
    grants: [{ grantId: 'tenant_alpha_main__alpha_prod_app__table__customer_orders__alpha_prod_runtime', granteeRoleName: 'alpha_prod_runtime', target: { databaseName: 'tenant_alpha_main', schemaName: 'alpha_prod_app', objectType: 'table', objectName: 'customer_orders' }, privileges: ['select'] }],
    extensions: [{ databaseName: 'tenant_alpha_main', extensionName: 'pgcrypto', schemaName: 'public', authorized: true, requestedVersion: '1.3' }],
    templates: [{ templateId: 'pg_schema_shared_v1', templateScope: 'schema', description: 'Shared-schema bootstrap', defaults: { extensions: ['pgcrypto'] } }],
    constraints: [{ databaseName: 'tenant_alpha_main', schemaName: 'alpha_prod_app', tableName: 'customer_orders', constraintName: 'customer_orders_pkey', constraintType: 'primary_key' }],
    indexes: [{ databaseName: 'tenant_alpha_main', schemaName: 'alpha_prod_app', tableName: 'customer_orders', indexName: 'customer_orders_status_idx', indexMethod: 'btree' }],
    views: [{ databaseName: 'tenant_alpha_main', schemaName: 'alpha_prod_app', viewName: 'customer_order_projection', dependencySummary: { readsFrom: [{ relationName: 'customer_orders' }] } }],
    materializedViews: [{ databaseName: 'tenant_alpha_main', schemaName: 'alpha_prod_app', viewName: 'customer_order_rollups', refreshPolicy: 'manual', indexes: [{ indexName: 'customer_order_rollups_customer_id_idx' }] }],
    functions: [{ databaseName: 'tenant_alpha_main', schemaName: 'alpha_prod_app', routineName: 'get_customer_order', signature: 'get_customer_order(uuid)' }],
    procedures: [{ databaseName: 'tenant_alpha_main', schemaName: 'alpha_prod_app', routineName: 'refresh_customer_order_rollups', signature: 'refresh_customer_order_rollups()' }]
  });
  const indexPlan = buildPostgresStructuralSqlPlan({
    resourceKind: 'index',
    action: 'create',
    payload: {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      tableName: 'customer_orders',
      indexName: 'customer_orders_status_created_at_idx',
      indexMethod: 'btree',
      keys: [{ columnName: 'status' }, { columnName: 'created_at', order: 'desc' }],
      predicateExpression: "status <> 'archived'"
    },
    context: {
      profile: resolvePostgresAdminProfile({ planId: 'pln_01enterprise' }),
      currentTable: {
        columns: [{ columnName: 'status' }, { columnName: 'created_at' }]
      }
    }
  });
  const metadataRecord = buildPostgresAdminMetadataRecord({
    resourceKind: 'grant',
    action: 'create',
    executionMode: destructiveGrantCall.payload.executionMode,
    tenantId: 'ten_01enterprisealpha',
    workspaceId: 'wrk_01alphaprod',
    resource: destructiveGrantCall.payload.normalizedResource,
    ddlPreview: destructiveGrantCall.payload.ddlPreview,
    preExecutionWarnings: destructiveGrantCall.payload.preExecutionWarnings,
    riskProfile: destructiveGrantCall.payload.riskProfile,
    auditSummary: destructiveGrantCall.payload.auditSummary
  });
  const normalizedError = normalizePostgresAdminError(
    {
      classification: 'quota_exceeded',
      status: 422,
      message: 'Materialized view quota exceeded.',
      providerError: 'limit reached'
    },
    {
      resourceKind: 'materialized_view',
      action: 'create',
      resourceId: 'tenant_alpha_main.alpha_prod_app.customer_order_rollups',
      placementMode: 'database_per_tenant'
    }
  );
  const dataApiDecision = evaluatePostgresDataApiAccess({
    actorRoleName: 'alpha_prod_runtime',
    command: 'select',
    schemaGrants: [
      {
        granteeRoleName: 'alpha_prod_runtime',
        privileges: ['usage'],
        target: { schemaName: 'alpha_prod_app' }
      }
    ],
    objectGrants: [
      {
        granteeRoleName: 'alpha_prod_runtime',
        privileges: ['select'],
        target: { schemaName: 'alpha_prod_app', objectName: 'customer_orders' }
      }
    ],
    tableSecurity: { rlsEnabled: true },
    policies: [
      {
        appliesTo: { command: 'select', roles: ['alpha_prod_runtime'] },
        runtimePredicate: { kind: 'session_equals_row', sessionKey: 'tenantId', columnName: 'tenantId' }
      }
    ],
    sessionContext: { tenantId: 'ten_01enterprisealpha' },
    row: { tenantId: 'ten_01enterprisealpha' },
    resource: { schemaName: 'alpha_prod_app', tableName: 'customer_orders' }
  });

  assert.equal(adapterCall.adapter_id, 'postgresql');
  assert.equal(adapterCall.capability, 'postgres_materialized_view_create');
  assert.equal(adapterCall.payload.resourceKind, 'materialized_view');
  assert.equal(adapterCall.payload.placementProfile.placementMode, 'database_per_tenant');
  assert.equal(adapterCall.payload.normalizedResource.resourceType, 'postgres_materialized_view');
  assert.equal(adapterCall.payload.ddlPlan.statements[0].includes('CREATE MATERIALIZED VIEW'), true);
  assert.equal(adapterCall.payload.ddlPlan.statements.some((statement) => statement.includes('CREATE INDEX')), true);
  assert.equal(adapterCall.payload.ddlPreview.statementCount, 2);
  assert.equal(adapterCall.payload.auditSummary.operationClass, 'structural_ddl');
  assert.equal(adapterCall.contract_version, '2026-03-24');

  assert.equal(routineCall.capability, 'postgres_function_create');
  assert.equal(routineCall.payload.ddlPlan.statements[0].includes('CREATE OR REPLACE FUNCTION'), true);
  assert.equal(routineCall.payload.ddlPlan.statements.some((statement) => statement.includes('COMMENT ON FUNCTION')), true);

  assert.equal(tableSecurityCall.capability, 'postgres_table_security_update');
  assert.equal(tableSecurityCall.payload.ddlPlan.statements.some((statement) => statement.includes('ENABLE ROW LEVEL SECURITY')), true);
  assert.equal(tableSecurityCall.payload.normalizedResource.tenantIsolation.policyEnforcement, 'optional_for_dedicated_databases');

  assert.equal(previewCall.payload.executionMode, 'preview');
  assert.equal(previewCall.payload.ddlPreview.executionMode, 'preview');
  assert.equal(previewCall.payload.ddlPreview.statementFingerprint.length, 24);
  assert.equal(previewCall.payload.preExecutionWarnings.some((warning) => warning.warningCode === 'preview_only'), true);
  assert.equal(previewCall.payload.preExecutionWarnings.some((warning) => warning.warningCode === 'ddl_lock_risk'), true);
  assert.equal(previewCall.payload.preExecutionWarnings.some((warning) => warning.warningCode === 'table_rewrite_or_scan'), true);
  assert.equal(previewCall.payload.riskProfile.acknowledgementRequired, true);

  assert.equal(destructiveGrantCall.payload.preExecutionWarnings.some((warning) => warning.warningCode === 'tenant_isolation_review'), true);
  assert.equal(destructiveGrantCall.payload.auditSummary.capturesTenantIsolation, true);

  assert.equal(grantPlan.statements[0].includes('GRANT SELECT ON TABLE'), true);
  assert.equal(schemaPlan.statements.some((statement) => statement.includes('COMMENT ON SCHEMA')), true);

  assert.equal(inventory.placementMode, 'database_per_tenant');
  assert.equal(inventory.counts.schemas, 1);
  assert.equal(inventory.counts.tables, 1);
  assert.equal(inventory.counts.sequences, 1);
  assert.equal(inventory.counts.tableSecurityProfiles, 1);
  assert.equal(inventory.counts.policies, 1);
  assert.equal(inventory.counts.grants, 1);
  assert.equal(inventory.counts.extensions, 1);
  assert.equal(inventory.counts.templates, 1);
  assert.equal(inventory.counts.constraints, 1);
  assert.equal(inventory.counts.indexes, 1);
  assert.equal(inventory.counts.materializedViews, 1);
  assert.equal(inventory.counts.functions, 1);
  assert.equal(inventory.counts.procedures, 1);
  assert.equal(inventory.documentationRefs.length >= 2, true);
  assert.equal(inventory.byDatabase.tenant_alpha_main.sequenceCount, 1);
  assert.equal(inventory.byDatabase.tenant_alpha_main.policyCount, 1);
  assert.equal(inventory.byDatabase.tenant_alpha_main.grantCount, 1);
  assert.equal(inventory.byDatabase.tenant_alpha_main.extensionCount, 1);
  assert.equal(inventory.byDatabase.tenant_alpha_main.materializedViewCount, 1);
  assert.equal(inventory.tenantIsolation.isolationBoundary, 'database');
  assert.equal(inventory.minimumEnginePolicy.forbiddenAttributes.includes('SUPERUSER'), true);

  assert.equal(indexPlan.statements[0].includes('CREATE INDEX'), true);
  assert.equal(indexPlan.statements[0].includes('USING BTREE'), true);
  assert.equal(indexPlan.statements[0].includes('WHERE status <>'), true);
  assert.equal(indexPlan.transactionMode, 'transactional_ddl');

  assert.equal(metadataRecord.metadata.statementFingerprint, destructiveGrantCall.payload.ddlPreview.statementFingerprint);
  assert.equal(metadataRecord.metadata.riskLevel, destructiveGrantCall.payload.riskProfile.riskLevel);
  assert.equal(metadataRecord.metadata.rowAccessModel, 'boundary_first');
  assert.equal(metadataRecord.auditSummary.operationClass, 'governance_ddl');

  assert.equal(normalizedError.status, 422);
  assert.equal(normalizedError.code, 'GW_PGADM_QUOTA_EXCEEDED');
  assert.equal(normalizedError.detail.resourceKind, 'materialized_view');
  assert.equal(normalizedError.retryable, false);

  assert.equal(dataApiDecision.allowed, true);
  assert.equal(dataApiDecision.reason, 'grant_and_rls_allow');
});

test('postgres create validation exposes structured quotaDecision metadata at hard limits', () => {
  const result = validatePostgresAdminRequest({
    resourceKind: 'database',
    action: 'create',
    context: {
      tenantId: 'ten_01growthalpha',
      workspaceId: 'wrk_01alphadev',
      tenantNamePrefix: 'tenant_alpha',
      planId: 'pln_01growth',
      currentInventory: {
        counts: { databases: 3 }
      }
    },
    payload: {
      databaseName: 'tenant_alpha_reporting',
      ownerRoleName: 'workspace_owner'
    }
  });

  assert.ok(result.quotaDecision);
  assert.equal(result.quotaDecision.errorCode, 'QUOTA_HARD_LIMIT_REACHED');
  assert.equal(result.quotaDecision.dimensionId, 'logical_databases');
});
