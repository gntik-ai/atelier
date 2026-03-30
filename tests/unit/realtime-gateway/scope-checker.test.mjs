import test from 'node:test';
import assert from 'node:assert/strict';
import { createScopeChecker } from '../../../services/realtime-gateway/src/auth/scope-checker.mjs';
import { getScopeMappings, upsertScopeMapping } from '../../../services/realtime-gateway/src/repositories/scope-mapping-repository.mjs';

const env = () => ({
  KEYCLOAK_JWKS_URL: 'https://keycloak.example/certs',
  KEYCLOAK_INTROSPECTION_URL: 'https://keycloak.example/introspect',
  KEYCLOAK_INTROSPECTION_CLIENT_ID: 'client-id',
  KEYCLOAK_INTROSPECTION_CLIENT_SECRET: 'client-secret',
  DATABASE_URL: 'postgres://example',
  KAFKA_BROKERS: ['broker:9092'],
  JWKS_CACHE_TTL_SECONDS: 300,
  SCOPE_REVALIDATION_INTERVAL_SECONDS: 30,
  TOKEN_EXPIRY_GRACE_SECONDS: 30,
  MAX_FILTER_PREDICATES: 10,
  MAX_SUBSCRIPTIONS_PER_WORKSPACE: 50,
  AUDIT_KAFKA_TOPIC_AUTH_GRANTED: 'granted',
  AUDIT_KAFKA_TOPIC_AUTH_DENIED: 'denied',
  AUDIT_KAFKA_TOPIC_SESSION_SUSPENDED: 'suspended',
  AUDIT_KAFKA_TOPIC_SESSION_RESUMED: 'resumed',
  REALTIME_AUTH_ENABLED: true
});

function buildClaims(overrides = {}) {
  return {
    tenant_id: 'tenant-1',
    scopes: ['realtime:read'],
    authorizedWorkspaces: ['workspace-1'],
    ...overrides
  };
}

test('checkScopes allows default realtime:read access when no mappings exist', async () => {
  const checkScopes = createScopeChecker({
    envProvider: env,
    getScopeMappingsFn: async () => []
  });

  const result = await checkScopes(buildClaims(), 'workspace-1', 'postgresql-changes', {});
  assert.equal(result.allowed, true);
  assert.equal(result.requiredScope, 'realtime:read');
});

test('checkScopes allows channel access when a custom mapping matches', async () => {
  const checkScopes = createScopeChecker({
    envProvider: env,
    getScopeMappingsFn: async () => [{ scope_name: 'realtime:read:postgres', channel_type: 'postgresql-changes' }]
  });

  const result = await checkScopes(buildClaims({ scopes: ['realtime:read:postgres'] }), 'workspace-1', 'postgresql-changes', {});
  assert.equal(result.allowed, true);
  assert.equal(result.requiredScope, 'realtime:read:postgres');
});

test('checkScopes denies access when required mapping scope is missing', async () => {
  const checkScopes = createScopeChecker({
    envProvider: env,
    getScopeMappingsFn: async () => [{ scope_name: 'realtime:read:postgres', channel_type: 'postgresql-changes' }]
  });

  const result = await checkScopes(buildClaims({ scopes: ['realtime:read'] }), 'workspace-1', 'postgresql-changes', {});
  assert.equal(result.allowed, false);
  assert.equal(result.missingScope, 'realtime:read:postgres');
});

test('checkScopes rejects cross-workspace requests before hitting the repository', async () => {
  let repositoryCalls = 0;
  const checkScopes = createScopeChecker({
    envProvider: env,
    getScopeMappingsFn: async () => {
      repositoryCalls += 1;
      return [];
    }
  });

  const result = await checkScopes(buildClaims({ authorizedWorkspaces: ['workspace-2'] }), 'workspace-1', 'postgresql-changes', {});
  assert.equal(result.allowed, false);
  assert.equal(result.missingScope, 'workspace-access');
  assert.equal(repositoryCalls, 0);
});

test('checkScopes rejects claims without tenant_id', async () => {
  const checkScopes = createScopeChecker({
    envProvider: env,
    getScopeMappingsFn: async () => {
      throw new Error('should not be called');
    }
  });

  const result = await checkScopes(buildClaims({ tenant_id: undefined }), 'workspace-1', 'postgresql-changes', {});
  assert.equal(result.allowed, false);
  assert.equal(result.missingScope, 'tenant_id');
});

test('scope mapping repository queries always parameterize tenant_id', async () => {
  const calls = [];
  const db = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ tenant_id: params[0], workspace_id: params[1], scope_name: params[2], channel_type: params[3], created_by: params[4] }] };
    }
  };

  await getScopeMappings(db, 'tenant-1', 'workspace-1');
  await upsertScopeMapping(db, {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    scopeName: 'realtime:read',
    channelType: '*',
    createdBy: 'tester'
  });

  assert.match(calls[0].sql, /WHERE tenant_id = \$1\s+AND workspace_id = \$2/);
  assert.deepEqual(calls[0].params, ['tenant-1', 'workspace-1']);
  assert.match(calls[1].sql, /ON CONFLICT \(tenant_id, workspace_id, scope_name, channel_type\)/);
  assert.equal(calls[1].params[0], 'tenant-1');
});
