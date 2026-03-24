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

test('postgres admin adapter exports the supported compatibility matrix and profile baseline', () => {
  const growthProfile = resolvePostgresAdminProfile({ planId: 'pln_01growth' });
  const enterpriseProfile = resolvePostgresAdminProfile({ planId: 'pln_01enterprise' });

  assert.deepEqual(Object.keys(POSTGRES_ADMIN_CAPABILITY_MATRIX), ['role', 'user', 'database', 'schema', 'table', 'column', 'type']);
  assert.deepEqual(POSTGRES_ADMIN_CAPABILITY_MATRIX.table, ['list', 'get', 'create', 'update', 'delete']);
  assert.deepEqual(POSTGRES_ADMIN_CAPABILITY_MATRIX.column, ['list', 'get', 'create', 'update', 'delete']);
  assert.deepEqual(POSTGRES_ADMIN_CAPABILITY_MATRIX.type, ['list', 'get']);
  assert.equal(SUPPORTED_POSTGRES_VERSION_RANGES.length, 3);
  assert.equal(isPostgresVersionSupported('15.6'), true);
  assert.equal(isPostgresVersionSupported('16.3'), true);
  assert.equal(isPostgresVersionSupported('17.0'), true);
  assert.equal(isPostgresVersionSupported('14.11'), false);
  assert.equal(growthProfile.placementMode, 'schema_per_tenant');
  assert.equal(growthProfile.databaseMutationsSupported, false);
  assert.equal(growthProfile.tableMutationsSupported, true);
  assert.equal(growthProfile.columnMutationsSupported, true);
  assert.equal(growthProfile.typeCatalogSupported, true);
  assert.equal(enterpriseProfile.placementMode, 'database_per_tenant');
  assert.equal(enterpriseProfile.databaseMutationsSupported, true);
  assert.equal(POSTGRES_ADMIN_MINIMUM_ENGINE_POLICY.database_per_tenant.requiresCreatedb, true);
  assert.equal(POSTGRES_ADMIN_MINIMUM_ENGINE_POLICY.schema_per_tenant.allowedCapabilities.includes('create_workspace_tables'), true);
  assert.equal(RESERVED_POSTGRES_DATABASE_NAMES.includes('postgres'), true);
});

test('postgres admin adapter normalizes provider payloads into safe BaaS resource shapes', () => {
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
  const table = normalizePostgresAdminResource(
    'table',
    {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      tableName: 'customer_orders',
      comment: 'Bounded admin table',
      columns: [
        { columnName: 'id', dataType: 'uuid', nullable: false, defaultExpression: 'gen_random_uuid()', constraints: { primaryKey: true } },
        { columnName: 'payload', dataType: 'jsonb', nullable: false, defaultExpression: "'{}'::jsonb" }
      ]
    },
    {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      planId: 'pln_01enterprise'
    }
  );
  const column = normalizePostgresAdminResource(
    'column',
    {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      tableName: 'customer_orders',
      columnName: 'status',
      dataType: 'varchar(32)',
      nullable: false,
      comment: 'Order state',
      constraints: { unique: true }
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

  assert.equal(table.resourceType, 'postgres_table');
  assert.equal(table.columnCount, 2);
  assert.equal(table.columns[0].constraints.primaryKey, true);
  assert.equal(table.columns[1].dataType.fullName, 'jsonb');

  assert.equal(column.resourceType, 'postgres_column');
  assert.equal(column.comment, 'Order state');
  assert.equal(column.dataType.fullName, 'varchar(32)');

  assert.equal(allowedType.resourceType, 'postgres_type');
  assert.equal(allowedType.typeName, 'jsonb');
  assert.equal(allowedType.category, 'built_in');
});

test('postgres admin adapter validates profile guardrails, unsafe engine details, incompatible changes, and allowed types', () => {
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

test('postgres admin adapter builds stable adapter envelopes, inventory projections, safe SQL plans, and normalized dependency errors', () => {
  const adapterCall = buildPostgresAdminAdapterCall({
    resourceKind: 'table',
    action: 'create',
    callId: 'call_01pgtablecreate',
    tenantId: 'ten_01enterprisealpha',
    workspaceId: 'wrk_01alphaprod',
    planId: 'pln_01enterprise',
    correlationId: 'corr-pgadm-001',
    authorizationDecisionId: 'authz-pgadm-001',
    idempotencyKey: 'idem-pgadm-001',
    targetRef: 'database:tenant_alpha_main/schema:alpha_prod_app/table:customer_orders',
    context: {
      tenantId: 'ten_01enterprisealpha',
      workspaceId: 'wrk_01alphaprod',
      planId: 'pln_01enterprise'
    },
    payload: {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      tableName: 'customer_orders',
      comment: 'Bounded admin table',
      columns: [
        { columnName: 'id', dataType: 'uuid', nullable: false, defaultExpression: 'gen_random_uuid()', constraints: { primaryKey: true } },
        { columnName: 'payload', dataType: 'jsonb', nullable: false, defaultExpression: "'{}'::jsonb" }
      ]
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
    tables: [{ databaseName: 'tenant_alpha_main', schemaName: 'alpha_prod_app', tableName: 'customer_orders', columnCount: 2 }]
  });
  const sqlPlan = buildPostgresStructuralSqlPlan({
    resourceKind: 'column',
    action: 'update',
    payload: {
      databaseName: 'tenant_alpha_main',
      schemaName: 'alpha_prod_app',
      tableName: 'customer_orders',
      columnName: 'payload',
      dataType: 'jsonb',
      nullable: false,
      comment: 'JSON payload'
    },
    context: {
      profile: resolvePostgresAdminProfile({ planId: 'pln_01enterprise' }),
      currentColumn: {
        columnName: 'payload',
        nullable: true,
        dataType: { fullName: 'jsonb' }
      }
    }
  });
  const normalizedError = normalizePostgresAdminError(
    {
      classification: 'quota_exceeded',
      status: 422,
      message: 'Schema quota exceeded.',
      providerError: 'limit reached'
    },
    {
      resourceKind: 'schema',
      action: 'create',
      resourceId: 'tenant_alpha_main.alpha_prod_app',
      placementMode: 'database_per_tenant'
    }
  );

  assert.equal(adapterCall.adapter_id, 'postgresql');
  assert.equal(adapterCall.capability, 'postgres_table_create');
  assert.equal(adapterCall.payload.resourceKind, 'table');
  assert.equal(adapterCall.payload.placementProfile.placementMode, 'database_per_tenant');
  assert.equal(adapterCall.payload.normalizedResource.resourceType, 'postgres_table');
  assert.equal(adapterCall.payload.ddlPlan.statements[0].includes('CREATE TABLE'), true);
  assert.equal(adapterCall.contract_version, '2026-03-24');

  assert.equal(inventory.placementMode, 'database_per_tenant');
  assert.equal(inventory.counts.schemas, 1);
  assert.equal(inventory.counts.tables, 1);
  assert.equal(inventory.counts.columns, 2);
  assert.equal(inventory.byDatabase.tenant_alpha_main.schemaCount, 1);
  assert.equal(inventory.minimumEnginePolicy.forbiddenAttributes.includes('SUPERUSER'), true);

  assert.equal(sqlPlan.statements.some((statement) => statement.includes('SET NOT NULL')), true);
  assert.equal(sqlPlan.statements.some((statement) => statement.includes('COMMENT ON COLUMN')), true);
  assert.equal(sqlPlan.transactionMode, 'transactional_ddl');

  assert.equal(normalizedError.status, 422);
  assert.equal(normalizedError.code, 'GW_PGADM_QUOTA_EXCEEDED');
  assert.equal(normalizedError.detail.resourceKind, 'schema');
  assert.equal(normalizedError.retryable, false);
});
