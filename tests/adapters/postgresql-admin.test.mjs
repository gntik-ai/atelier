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
  buildPostgresStructuralSqlPlan,
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
    'procedure'
  ]);
  assert.deepEqual(POSTGRES_ADMIN_CAPABILITY_MATRIX.table, ['list', 'get', 'create', 'update', 'delete']);
  assert.deepEqual(POSTGRES_ADMIN_CAPABILITY_MATRIX.column, ['list', 'get', 'create', 'update', 'delete']);
  assert.deepEqual(POSTGRES_ADMIN_CAPABILITY_MATRIX.type, ['list', 'get']);
  assert.deepEqual(POSTGRES_ADMIN_CAPABILITY_MATRIX.materialized_view, ['list', 'get', 'create', 'update', 'delete']);
  assert.deepEqual(POSTGRES_ADMIN_CAPABILITY_MATRIX.function, ['list', 'get', 'create', 'update', 'delete']);
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
  assert.equal(growthProfile.typeCatalogSupported, true);
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
  const inventory = buildPostgresAdminInventorySnapshot({
    tenantId: 'ten_01enterprisealpha',
    workspaceId: 'wrk_01alphaprod',
    planId: 'pln_01enterprise',
    roles: [{ roleName: 'alpha_prod_owner' }],
    users: [{ userName: 'alpha_prod_api' }],
    databases: [{ databaseName: 'tenant_alpha_main' }],
    schemas: [{ databaseName: 'tenant_alpha_main', schemaName: 'alpha_prod_app', workspaceBindings: ['wrk_01alphaprod'] }],
    tables: [{ databaseName: 'tenant_alpha_main', schemaName: 'alpha_prod_app', tableName: 'customer_orders', columnCount: 2 }],
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

  assert.equal(adapterCall.adapter_id, 'postgresql');
  assert.equal(adapterCall.capability, 'postgres_materialized_view_create');
  assert.equal(adapterCall.payload.resourceKind, 'materialized_view');
  assert.equal(adapterCall.payload.placementProfile.placementMode, 'database_per_tenant');
  assert.equal(adapterCall.payload.normalizedResource.resourceType, 'postgres_materialized_view');
  assert.equal(adapterCall.payload.ddlPlan.statements[0].includes('CREATE MATERIALIZED VIEW'), true);
  assert.equal(adapterCall.payload.ddlPlan.statements.some((statement) => statement.includes('CREATE INDEX')), true);
  assert.equal(adapterCall.contract_version, '2026-03-24');

  assert.equal(routineCall.capability, 'postgres_function_create');
  assert.equal(routineCall.payload.ddlPlan.statements[0].includes('CREATE OR REPLACE FUNCTION'), true);
  assert.equal(routineCall.payload.ddlPlan.statements.some((statement) => statement.includes('COMMENT ON FUNCTION')), true);

  assert.equal(inventory.placementMode, 'database_per_tenant');
  assert.equal(inventory.counts.schemas, 1);
  assert.equal(inventory.counts.tables, 1);
  assert.equal(inventory.counts.constraints, 1);
  assert.equal(inventory.counts.indexes, 1);
  assert.equal(inventory.counts.materializedViews, 1);
  assert.equal(inventory.counts.functions, 1);
  assert.equal(inventory.counts.procedures, 1);
  assert.equal(inventory.byDatabase.tenant_alpha_main.materializedViewCount, 1);
  assert.equal(inventory.minimumEnginePolicy.forbiddenAttributes.includes('SUPERUSER'), true);

  assert.equal(indexPlan.statements[0].includes('CREATE INDEX'), true);
  assert.equal(indexPlan.statements[0].includes('USING BTREE'), true);
  assert.equal(indexPlan.statements[0].includes('WHERE status <>'), true);
  assert.equal(indexPlan.transactionMode, 'transactional_ddl');

  assert.equal(normalizedError.status, 422);
  assert.equal(normalizedError.code, 'GW_PGADM_QUOTA_EXCEEDED');
  assert.equal(normalizedError.detail.resourceKind, 'materialized_view');
  assert.equal(normalizedError.retryable, false);
});
