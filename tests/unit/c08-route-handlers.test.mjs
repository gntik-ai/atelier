import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

import { C08_HANDLERS } from '../../apps/control-plane/c08-handlers.mjs';
import { C08_GOVERNANCE_HANDLERS, validatePlanCapabilities } from '../../apps/control-plane/c08-governance-handlers.mjs';
import { acceptEntityCommand, GovernanceConflictError } from '../../apps/control-plane/platform-governance-store.mjs';
import { canonicalC08Entities } from '../../apps/control-plane/c08-schema.mjs';
import { validateC08Schema } from '../../apps/control-plane/c08-contracts.mjs';
import { isPlatformTeam, canMutatePlatform } from '../../apps/control-plane/c08-authz.mjs';

const PLATFORM_ADMIN = { actorType: 'superadmin', sub: 'usr_admin', roles: ['platform_admin'] };
const PLATFORM_AUDITOR = { actorType: 'tenant_member', sub: 'usr_auditor', roles: ['platform_auditor'] };
const TENANT_OWNER = { actorType: 'tenant_owner', sub: 'usr_owner', tenantId: 'ten_a', roles: ['tenant_owner'], workspaceIds: [] };
const WORKSPACE_OWNER = { actorType: 'workspace_admin', sub: 'usr_ws', tenantId: 'ten_a', roles: ['workspace_owner'], workspaceIds: ['wrk_a'] };

function fakePool(handler) {
  const calls = [];
  const pool = {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      return handler ? handler(String(sql), params) : { rows: [], rowCount: 0 };
    },
    async connect() { return { query: pool.query.bind(pool), release() {} }; }
  };
  return pool;
}

function ctx({ identity = PLATFORM_ADMIN, pool = fakePool(), params = {}, query = {}, headers = {}, extra = {} } = {}) {
  return {
    identity, pool, params, query,
    searchParams: new URLSearchParams(query),
    req: { headers },
    callerContext: { correlationId: 'cor_c08_00000001', actor: { id: identity.sub, type: identity.actorType } },
    ...extra
  };
}

test('fresh-install canonical governance projections all validate against unified OpenAPI', () => {
  const domain = JSON.parse(fs.readFileSync(new URL('../../packages/internal-contracts/src/domain-model.json', import.meta.url)));
  const schema = {
    deployment_profile: 'DeploymentProfileRecord',
    plan: 'CommercialPlan',
    quota_policy: 'QuotaPolicy',
    provider_capability: 'ProviderCapabilityRecord'
  };
  const rows = canonicalC08Entities(domain, '2026-08-08T00:00:00.000Z');
  assert.equal(rows.length, 24);
  for (const row of rows) {
    const result = validateC08Schema(schema[row.entityType], row.projection);
    assert.equal(result.valid, true, `${row.entityId}: ${JSON.stringify(result.errors)}`);
  }
});

test('platform permissions distinguish read/audit from mutations', () => {
  assert.equal(isPlatformTeam(PLATFORM_AUDITOR), true);
  assert.equal(canMutatePlatform(PLATFORM_AUDITOR), false);
  assert.equal(canMutatePlatform(PLATFORM_ADMIN), true);
  assert.equal(isPlatformTeam(TENANT_OWNER), false);
});

test('workspace audit masks foreign existence and requires advertised workspace roles', async () => {
  const pool = fakePool((sql) => /FROM workspaces/.test(sql)
    ? { rows: [{ id: 'wrk_a', tenant_id: 'ten_a', slug: 'a', status: 'active', environment: 'dev' }] }
    : { rows: [], rowCount: 0 });
  const foreign = await C08_HANDLERS.listFunctionDeploymentAudit(ctx({
    identity: { ...WORKSPACE_OWNER, tenantId: 'ten_b' }, pool, params: { workspaceId: 'wrk_a' }
  }));
  assert.equal(foreign.statusCode, 404);
  const tenantOwner = await C08_HANDLERS.listFunctionDeploymentAudit(ctx({
    identity: TENANT_OWNER, pool, params: { workspaceId: 'wrk_a' }
  }));
  assert.equal(tenantOwner.statusCode, 403);
});

test('function deployment audit maps durable evidence to AuditPage', async () => {
  const pool = fakePool((sql) => {
    if (/FROM workspaces/.test(sql)) return { rows: [{ id: 'wrk_a', tenant_id: 'ten_a', slug: 'a', status: 'active', environment: 'dev' }] };
    if (/FROM plan_audit_events/.test(sql)) return { rows: [{
      id: '11111111-1111-1111-1111-111111111111', action_type: 'function.deployed',
      actor_id: 'usr_ws', tenant_id: 'ten_a', workspace_id: 'wrk_a',
      new_state: { workspaceId: 'wrk_a', resourceId: 'fn_a', deploymentNature: 'create', originSurface: 'control_api' },
      correlation_id: 'cor_function_1', outcome: 'succeeded', created_at: '2026-08-08T00:00:00.000Z'
    }] };
    return { rows: [] };
  });
  const response = await C08_HANDLERS.listFunctionDeploymentAudit(ctx({
    identity: WORKSPACE_OWNER, pool, params: { workspaceId: 'wrk_a' }
  }));
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.items[0].actionType, 'function.deployed');
  assert.equal(response.body.items[0].functionId, 'fn_a');
  assert.equal(validateC08Schema('AuditPage', response.body).valid, true);
  const auditQuery = pool.calls.find((call) => /FROM plan_audit_events/.test(call.sql));
  assert.match(auditQuery.sql, /new_state->>'workspaceId' = \$2/);
  assert.doesNotMatch(auditQuery.sql, /plan_audit_events[\s\S]*\bworkspace_id\s*=/,
    'plan_audit_events stores workspace scope in new_state JSONB, not a physical workspace_id column');
});

test('function audit coverage counts workspace scope from the authoritative JSONB field', async () => {
  const pool = fakePool((sql) => {
    if (/FROM fn_actions/.test(sql)) return { rows: [{ count: 1 }] };
    if (/FROM plan_audit_events/.test(sql)) return { rows: [] };
    if (/FROM quota_enforcement_log/.test(sql)) return { rows: [{ covered: 0 }] };
    return { rows: [] };
  });
  const response = await C08_HANDLERS.getFunctionAuditCoverage(ctx({
    identity: PLATFORM_AUDITOR, pool
  }));
  assert.equal(response.statusCode, 200);
  const auditQuery = pool.calls.find((call) => /FROM plan_audit_events/.test(call.sql));
  assert.match(auditQuery.sql, /COUNT\(DISTINCT new_state->>'workspaceId'\)/);
  assert.match(auditQuery.sql, /new_state->>'workspaceId' IS NOT NULL/);
  assert.doesNotMatch(auditQuery.sql, /COUNT\(DISTINCT workspace_id\)/);
});

test('audit correlation returns 404 when the real scoped query has no evidence', async () => {
  const pool = fakePool((sql) => {
    if (/FROM tenants/.test(sql)) return { rows: [{ id: 'ten_a', tenant_id: 'ten_a', status: 'active' }] };
    return { rows: [] };
  });
  const response = await C08_HANDLERS.getTenantAuditCorrelation(ctx({
    identity: TENANT_OWNER, pool, params: { tenantId: 'ten_a', correlationId: 'cor_missing' }
  }));
  assert.equal(response.statusCode, 404);
});

test('event dashboard uses the canonical widget queries and real Prometheus series counts', async () => {
  const pool = fakePool((sql) => /FROM workspaces/.test(sql)
    ? { rows: [{ id: 'wrk_a', tenant_id: 'ten_a', slug: 'a', status: 'active', environment: 'dev' }] }
    : { rows: [] });
  const widgets = [
    ['topic_throughput', 'Topic', 'q1'], ['consumer_lag', 'Lag', 'q2'],
    ['bridge_health', 'Bridge', 'q3'], ['function_trigger_health', 'Trigger', 'q4'],
    ['admin_audit_volume', 'Audit', 'q5']
  ].map(([type, title, query]) => ({ type, title, query, seriesCount: 0 }));
  const response = await C08_HANDLERS.getWorkspaceEventDashboards(ctx({
    identity: TENANT_OWNER,
    pool,
    params: { workspaceId: 'wrk_a' },
    query: { window: '1h' },
    extra: {
      buildWorkspaceEventDashboard: () => ({ widgets }),
      prometheusQuery: async (query) => query === 'q1' ? [{ value: [0, '1'] }, { value: [0, '2'] }] : [{ value: [0, '1'] }]
    }
  }));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.coverage, { topicMetrics: 3, bridges: 1, functionTriggers: 1, auditSeries: 1 });
  assert.equal(validateC08Schema('WorkspaceEventDashboardResponse', response.body).valid, true);
});

test('gateway metrics fail honestly when a required Prometheus series is missing', async () => {
  const pool = fakePool((sql) => /FROM workspaces/.test(sql)
    ? { rows: [{ id: 'wrk_a', tenant_id: 'ten_a', slug: 'a', status: 'active', environment: 'dev' }] }
    : { rows: [] });
  const response = await C08_HANDLERS.getWorkspaceGatewayStreamMetrics(ctx({
    identity: TENANT_OWNER, pool, params: { workspaceId: 'wrk_a' }, query: { window: '5m' },
    extra: { prometheusQuery: async () => [] }
  }));
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.code, 'METRICS_SERIES_UNAVAILABLE');
});

test('Kafka metrics returns a schema-valid real empty inventory without opening Kafka', async () => {
  const pool = fakePool((sql) => /FROM workspaces/.test(sql)
    ? { rows: [{ id: 'wrk_a', tenant_id: 'ten_a', slug: 'a', status: 'active', environment: 'dev' }] }
    : { rows: [] });
  const response = await C08_HANDLERS.getWorkspaceKafkaTopicMetrics(ctx({
    identity: TENANT_OWNER, pool, params: { workspaceId: 'wrk_a' }, query: { window: '24h' },
    extra: {
      topicStore: { listTopicsForWorkspace: async () => [] },
      describeTopicConfigs: async () => new Map()
    }
  }));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.topics, []);
  assert.equal(validateC08Schema('KafkaTopicMetricsResponse', response.body).valid, true);
});

function commandClient() {
  const state = { entityEffects: 0, commandEffects: 0, auditEffects: 0, receipt: null, command: null };
  return {
    state,
    async query(sql, params = []) {
      const text = String(sql);
      if (/SELECT c\.\*, i\.request_fingerprint/.test(text)) {
        return { rows: state.receipt ? [{ ...state.command, replay_fingerprint: state.receipt.fingerprint, replay_response_body: state.receipt.response }] : [] };
      }
      if (/SELECT row_hash FROM platform_governance_audit/.test(text)) return { rows: [] };
      if (/SELECT 1 FROM platform_governance_entities/.test(text)) return { rows: [{ exists: 1 }] };
      if (/INSERT INTO platform_governance_entities/.test(text)) { state.entityEffects += 1; return { rows: [] }; }
      if (/INSERT INTO platform_governance_commands/.test(text)) {
        state.commandEffects += 1;
        state.command = {
          command_id: params[0], operation_id: params[1], request_id: params[2],
          idempotency_key: params[3], entity_type: params[4], entity_id: params[5],
          parent_id: params[6], request_fingerprint: params[7], response_body: JSON.parse(params[8]),
          accepted_event_type: params[9], desired_state: params[10], correlation_id: params[11],
          actor_id: params[12], accepted_at: params[13], expires_at: params[14]
        };
        return { rows: [] };
      }
      if (/INSERT INTO platform_governance_idempotency/.test(text)) {
        state.receipt = { fingerprint: params[4], response: JSON.parse(params[5]) };
        return { rows: [] };
      }
      if (/INSERT INTO platform_governance_audit/.test(text)) { state.auditEffects += 1; return { rows: [] }; }
      return { rows: [] };
    }
  };
}

const providerBody = Object.freeze({
  entityType: 'provider_capability', provider: 'kafka', capabilityKey: 'data.kafka.topics',
  plane: 'data', capabilityStatus: 'available', supportLevel: 'ga',
  allowedEnvironments: ['dev', 'prod'], desiredState: 'active', metadata: { owner: 'platform' }
});

const governanceFixtures = Object.freeze([
  ['deployment_profile', 'createDeploymentProfileRecord', {
    entityType: 'deployment_profile', slug: 'c08-shared', displayName: 'C08 shared',
    profileClass: 'shared', supportedEnvironments: ['dev'],
    planeBindings: { control: 'control_api', data: 'data_api', identity: 'identity_api', observability: 'metrics_api' },
    providerCapabilityIds: [], desiredState: 'active', metadata: { owner: 'platform' }
  }],
  ['plan', 'createCommercialPlan', {
    entityType: 'plan', slug: 'c08-plan', displayName: 'C08 plan', planFamily: 'standard',
    planStatus: 'active', deploymentProfileId: 'dpf_reference', quotaPolicyId: 'qta_reference',
    capabilityKeys: [], desiredState: 'active', metadata: { owner: 'platform' }
  }],
  ['quota_policy', 'createQuotaPolicy', {
    entityType: 'quota_policy', slug: 'c08-quota', displayName: 'C08 quota',
    quotaScope: 'tenant_and_workspace', enforcementMode: 'hard_stop', defaultLimits: [],
    desiredState: 'active', metadata: { owner: 'platform' }
  }],
  ['provider_capability', 'createProviderCapabilityRecord', providerBody],
  ['platform_user', 'createPlatformUser', {
    entityType: 'platform_user', username: 'c08-admin', displayName: 'C08 admin',
    primaryEmail: 'c08-admin@example.test', identitySubject: 'keycloak-c08-admin',
    platformRoles: ['platform_admin'], desiredState: 'active', metadata: { owner: 'platform' }
  }]
]);

test('each governance POST has one entity/command/audit effect and exact idempotent replay', async () => {
  for (const [entityType, operationId, body] of governanceFixtures) {
    const client = commandClient();
    const args = {
      entityType, operationId, body,
      parentId: entityType === 'quota_policy' ? 'pln_reference' : null,
      entityIdOverride: entityType === 'quota_policy' ? 'qta_reference' : null,
      idempotencyKey: `idem-${entityType}-0001`, correlationId: 'cor-c08-00000001', actorId: 'usr_admin',
      now: () => '2026-08-08T00:00:00.000Z'
    };
    const first = await acceptEntityCommand(client, args);
    const replay = await acceptEntityCommand(client, {
      ...args, body: structuredClone(body), correlationId: 'cor-c08-00000002',
      now: () => '2026-08-08T00:01:00.000Z'
    });
    assert.equal(first.replayed, false, operationId);
    assert.equal(replay.replayed, true, operationId);
    assert.deepEqual(replay.envelope, first.envelope, operationId);
    assert.equal(client.state.entityEffects, 1, operationId);
    assert.equal(client.state.commandEffects, 1, operationId);
    assert.equal(client.state.auditEffects, 1, operationId);
    assert.equal(validateC08Schema('MutationAccepted', first.envelope).valid, true, operationId);
  }
});

test('governance POST returns the canonical X-Idempotency-Replayed response header', async () => {
  const client = commandClient();
  client.release = () => {};
  const pool = { connect: async () => client };
  const request = () => ctx({
    pool,
    headers: { 'idempotency-key': 'idem-provider-header-0001' },
    extra: { body: providerBody }
  });
  const first = await C08_GOVERNANCE_HANDLERS.createProviderCapabilityRecord(request());
  const replay = await C08_GOVERNANCE_HANDLERS.createProviderCapabilityRecord(request());
  assert.equal(first.statusCode, 202);
  assert.equal(first.headers['X-Idempotency-Replayed'], 'false');
  assert.equal(replay.statusCode, 202);
  assert.equal(replay.headers['X-Idempotency-Replayed'], 'true');
  assert.equal(first.headers['Idempotency-Replayed'], undefined);
  assert.equal(client.state.entityEffects, 1);
  assert.equal(client.state.commandEffects, 1);
  assert.equal(client.state.auditEffects, 1);
});

test('commercial plan capabilities must be active, available, and bound by its deployment profile', async () => {
  const profile = {
    providerCapabilityIds: ['pvc_kafka'],
    supportedEnvironments: ['dev', 'prod']
  };
  const client = {
    async query(sql) {
      if (/entity_type = 'deployment_profile'/.test(sql)) return { rows: [{ projection: profile }] };
      if (/entity_type = 'provider_capability'/.test(sql)) return { rows: [{ projection: {
        capabilityKey: 'data.kafka.topics', capabilityStatus: 'available', state: 'active',
        allowedEnvironments: ['dev', 'prod']
      } }] };
      return { rows: [] };
    }
  };
  await assert.doesNotReject(() => validatePlanCapabilities(client, {
    deploymentProfileId: 'dpf_reference', capabilityKeys: ['data.kafka.topics']
  }));
  await assert.rejects(
    () => validatePlanCapabilities(client, {
      deploymentProfileId: 'dpf_reference', capabilityKeys: ['data.storage.bucket']
    }),
    (error) => error.code === 'PLAN_CAPABILITY_UNSUPPORTED'
  );
  const unavailableClient = {
    query: async (sql) => /deployment_profile/.test(sql)
      ? { rows: [{ projection: profile }] }
      : { rows: [{ projection: {
          capabilityKey: 'data.kafka.topics', capabilityStatus: 'unavailable', state: 'active',
          allowedEnvironments: ['dev', 'prod']
        } }] }
  };
  await assert.rejects(
    () => validatePlanCapabilities(unavailableClient, {
      deploymentProfileId: 'dpf_reference', capabilityKeys: ['data.kafka.topics']
    }),
    (error) => error.code === 'PLAN_CAPABILITY_UNSUPPORTED'
  );
});

test('each governance POST denies a read-only platform actor before database access', async () => {
  for (const [entityType, operationId, body] of governanceFixtures) {
    const pool = fakePool();
    const response = await C08_GOVERNANCE_HANDLERS[operationId](ctx({
      identity: PLATFORM_AUDITOR,
      pool,
      params: entityType === 'quota_policy' ? { planId: 'pln_reference' } : {},
      headers: { 'idempotency-key': `idem-${entityType}-deny` },
      extra: { body }
    }));
    assert.equal(response.statusCode, 403, operationId);
    assert.equal(pool.calls.length, 0, operationId);
  }
});

test('idempotency key reuse with different semantic request conflicts without another effect', async () => {
  const client = commandClient();
  const args = {
    entityType: 'provider_capability', operationId: 'createProviderCapabilityRecord', body: providerBody,
    idempotencyKey: 'idem-c08-0002', correlationId: 'cor-c08-00000001', actorId: 'usr_admin',
    now: () => '2026-08-08T00:00:00.000Z'
  };
  await acceptEntityCommand(client, args);
  await assert.rejects(
    acceptEntityCommand(client, { ...args, body: { ...providerBody, capabilityStatus: 'limited' } }),
    (error) => error instanceof GovernanceConflictError && error.code === 'IDEMPOTENCY_KEY_CONFLICT'
  );
  assert.equal(client.state.entityEffects, 1);
  assert.equal(client.state.auditEffects, 1);
});

test('HTTP governance handler rejects missing idempotency and sensitive metadata before an effect', async () => {
  const pool = fakePool();
  const missing = await C08_GOVERNANCE_HANDLERS.createProviderCapabilityRecord(ctx({
    pool, headers: {}, extra: { body: providerBody }
  }));
  assert.equal(missing.statusCode, 400);
  const sensitive = await C08_GOVERNANCE_HANDLERS.createProviderCapabilityRecord(ctx({
    pool, headers: { 'idempotency-key': 'idem-c08-0003' },
    extra: { body: { ...providerBody, metadata: { api_key: 'must-not-store' } } }
  }));
  assert.equal(sensitive.statusCode, 400);
  assert.equal(sensitive.body.code, 'SENSITIVE_METADATA_REJECTED');
  assert.equal(pool.calls.some((call) => /INSERT INTO/.test(call.sql)), false);
});
