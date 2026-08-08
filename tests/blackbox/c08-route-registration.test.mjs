import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { routes as seedRoutes } from '../../apps/control-plane/routes.mjs';
import { createControlPlaneHttpServer } from '../../apps/control-plane/server.mjs';

const publicCatalog = JSON.parse(readFileSync(
  new URL('../../packages/internal-contracts/src/public-route-catalog.json', import.meta.url),
  'utf8'
));
const runtimeRoutes = JSON.parse(readFileSync(
  new URL('../../apps/control-plane/route-map.runtime.json', import.meta.url),
  'utf8'
));
const kindApisix = readFileSync(
  new URL('../../deploy/kind/apisix/apisix.yaml', import.meta.url),
  'utf8'
);
const gatewayRouting = readFileSync(
  new URL('../../deploy/gateway-config/base/public-api-routing.yaml', import.meta.url),
  'utf8'
);

const C08_OPERATIONS = Object.freeze([
  ['getFunctionAuditCoverage', 'GET', '/v1/admin/functions/audit/coverage'],
  ['listFunctionDeploymentAudit', 'GET', '/v1/functions/workspaces/{workspaceId}/audit'],
  ['listFunctionQuotaEnforcement', 'GET', '/v1/functions/workspaces/{workspaceId}/audit/quota-enforcement'],
  ['listFunctionRollbackEvidence', 'GET', '/v1/functions/workspaces/{workspaceId}/audit/rollback-evidence'],
  ['getTenantAuditCorrelation', 'GET', '/v1/metrics/tenants/{tenantId}/audit-correlations/{correlationId}'],
  ['getWorkspaceAuditCorrelation', 'GET', '/v1/metrics/workspaces/{workspaceId}/audit-correlations/{correlationId}'],
  ['getWorkspaceEventDashboards', 'GET', '/v1/metrics/workspaces/{workspaceId}/event-dashboards'],
  ['getWorkspaceGatewayStreamMetrics', 'GET', '/v1/metrics/workspaces/{workspaceId}/gateway-streams'],
  ['getWorkspaceKafkaTopicMetrics', 'GET', '/v1/metrics/workspaces/{workspaceId}/kafka-topics'],
  ['listBillingUsageRecords', 'GET', '/v1/platform/billing/usage'],
  ['listTenantBillingUsageRecords', 'GET', '/v1/platform/billing/usage/{tenantId}'],
  ['createDeploymentProfileRecord', 'POST', '/v1/platform/deployment-profiles'],
  ['getDeploymentProfileRecord', 'GET', '/v1/platform/deployment-profiles/{deploymentProfileId}'],
  ['createCommercialPlan', 'POST', '/v1/platform/plans'],
  ['getCommercialPlan', 'GET', '/v1/platform/plans/{planId}'],
  ['createQuotaPolicy', 'POST', '/v1/platform/plans/{planId}/quota-policies'],
  ['getQuotaPolicy', 'GET', '/v1/platform/plans/{planId}/quota-policies/{quotaPolicyId}'],
  ['createProviderCapabilityRecord', 'POST', '/v1/platform/provider-capabilities'],
  ['getProviderCapabilityRecord', 'GET', '/v1/platform/provider-capabilities/{providerCapabilityId}'],
  ['getRouteCatalog', 'GET', '/v1/platform/route-catalog'],
  ['getStorageProviderIntrospection', 'GET', '/v1/platform/storage/provider'],
  ['listTopologyRegions', 'GET', '/v1/platform/topology/regions'],
  ['createPlatformUser', 'POST', '/v1/platform/users'],
  ['getPlatformUser', 'GET', '/v1/platform/users/{userId}'],
  ['getTenantGovernanceDashboard', 'GET', '/v1/tenants/{tenantId}/dashboard']
]);

function normalizePath(path) {
  return path.replace(/\{[^}]+\}/g, '{}');
}

function routeKey(method, path) {
  return `${method.toUpperCase()} ${normalizePath(path)}`;
}

function productionHandlerProblem(route) {
  if (!route) return 'not registered';
  if (route.module === 'NONE' || route.localHandler === 'NONE') return 'handler is NONE';
  if (!route.localHandler && (!route.module || !route.export)) return 'no localHandler or module export';
  if (String(route.module ?? '').includes('/tests/')) return 'handler points into tests';
  return null;
}

test('C-08 exact inventory remains 25 unique published operations (20 GET, 5 POST)', () => {
  assert.equal(C08_OPERATIONS.length, 25);
  assert.equal(new Set(C08_OPERATIONS.map(([operationId]) => operationId)).size, 25);
  assert.equal(new Set(C08_OPERATIONS.map(([, method, path]) => routeKey(method, path))).size, 25);
  assert.equal(C08_OPERATIONS.filter(([, method]) => method === 'GET').length, 20);
  assert.equal(C08_OPERATIONS.filter(([, method]) => method === 'POST').length, 5);

  const publishedById = new Map(publicCatalog.routes.map((route) => [route.operationId, route]));
  const drift = [];
  for (const [operationId, method, path] of C08_OPERATIONS) {
    const published = publishedById.get(operationId);
    if (!published) {
      drift.push(`${operationId}: absent from public route catalog`);
      continue;
    }
    if (published.method !== method || published.path !== path) {
      drift.push(`${operationId}: expected ${method} ${path}, published ${published.method} ${published.path}`);
    }
  }
  assert.deepEqual(drift, []);
});

test('C-08 published operations resolve to production handlers in the deployable route assembly', () => {
  // Production merges the optional runtime overlay before seed routes and lets
  // the seed win on duplicate METHOD/path keys (server.mjs::createRouteTable).
  const assembled = new Map();
  for (const route of [...runtimeRoutes, ...seedRoutes]) {
    assembled.set(routeKey(route.method, route.path), route);
  }

  const failures = C08_OPERATIONS.flatMap(([operationId, method, path]) => {
    const problem = productionHandlerProblem(assembled.get(routeKey(method, path)));
    return problem ? [`${operationId} (${method} ${path}): ${problem}`] : [];
  });

  assert.deepEqual(
    failures,
    [],
    `Every C-08 public operation must dispatch before authentication/domain handling.\n${failures.join('\n')}`
  );
});

test('C-08 platform Function audit coverage crosses the deployable gateway boundary', () => {
  assert.match(gatewayRouting, /id: functions[\s\S]*additionalPathPrefixes:[\s\S]*- \/v1\/admin\/functions/);
  assert.match(
    kindApisix,
    /id: "2008-admin-function-audit"[\s\S]*uri: "\/v1\/admin\/functions\/audit\/coverage"[\s\S]*"falcone-control-plane\.falcone\.svc\.cluster\.local:8080"/,
    'the platform audit path must beat the SPA catch-all and target control-plane'
  );
  const routeStart = kindApisix.indexOf('id: "2008-admin-function-audit"');
  const catchAllStart = kindApisix.indexOf('id: "1004"');
  assert.ok(routeStart >= 0 && catchAllStart >= 0);
  assert.match(kindApisix.slice(routeStart, routeStart + 240), /priority: 432/);
});

function concretePath(path) {
  return path
    .replace('{workspaceId}', 'ws-c08-regression')
    .replace('{tenantId}', 'tenant-c08-regression')
    .replace('{correlationId}', 'corr-c08-regression')
    .replace('{deploymentProfileId}', 'profile-c08-regression')
    .replace('{planId}', 'plan-c08-regression')
    .replace('{quotaPolicyId}', 'quota-c08-regression')
    .replace('{providerCapabilityId}', 'provider-c08-regression')
    .replace('{userId}', 'user-c08-regression');
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function governancePool() {
  const state = { entityEffects: 0, commandEffects: 0, auditEffects: 0, receipt: null, command: null };
  const client = {
    state,
    async query(sql, params = []) {
      const text = String(sql);
      if (/SELECT c\.\*, i\.request_fingerprint/.test(text)) {
        return { rows: state.receipt ? [{
          ...state.command,
          replay_fingerprint: state.receipt.fingerprint,
          replay_response_body: state.receipt.response
        }] : [] };
      }
      if (/SELECT row_hash FROM platform_governance_audit/.test(text)) return { rows: [] };
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
    },
    release() {}
  };
  return { state, query: client.query.bind(client), connect: async () => client };
}

test('C-08 requests cross the production HTTP route boundary instead of returning GW_NO_ROUTE', async () => {
  // Missing credentials are intentional: authentication runs immediately after
  // a successful route match, so 401 proves dispatch occurred without invoking
  // any family-specific repository or mutation handler.
  const server = createControlPlaneHttpServer({
    pool: {
      async query() { return { rows: [], rowCount: 0 }; }
    },
    jwtVerifier: {
      async verify() { throw new Error('the missing-bearer case must not invoke JWT verification'); }
    },
    logger: { error() {} }
  });
  const baseUrl = await listen(server);

  try {
    const failures = [];
    for (const [operationId, method, path] of C08_OPERATIONS) {
      const response = await fetch(`${baseUrl}${concretePath(path)}`, {
        method,
        headers: { 'content-type': 'application/json' }
      });
      const body = await response.json();
      if (response.status !== 401 || body.code !== 'GW_UNAUTHENTICATED') {
        failures.push(`${operationId}: expected 401 GW_UNAUTHENTICATED, got ${response.status} ${body.code}`);
      }
      assert.notEqual(body.code, 'GW_NO_ROUTE', `${operationId} must not fall through route dispatch`);
    }
    assert.deepEqual(failures, []);
  } finally {
    await close(server);
  }
});

test('C-08 governance replay exposes the exact canonical response header at the HTTP boundary', async () => {
  const pool = governancePool();
  const server = createControlPlaneHttpServer({
    pool,
    jwtVerifier: {
      async verify() {
        return {
          payload: { sub: 'usr_c08_admin', realm_access: { roles: ['superadmin'] } },
          trust: { kind: 'platform', realm: 'in-falcone-platform' }
        };
      }
    },
    logger: { error() {}, warn() {} }
  });
  const baseUrl = await listen(server);
  const request = () => fetch(`${baseUrl}/v1/platform/provider-capabilities`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer hermetic-c08-token',
      'content-type': 'application/json',
      'idempotency-key': 'idem-c08-http-0001',
      'x-correlation-id': 'cor_c08_http_0001'
    },
    body: JSON.stringify({
      entityType: 'provider_capability', provider: 'kafka', capabilityKey: 'data.kafka.topics',
      plane: 'data', capabilityStatus: 'available', supportLevel: 'ga',
      allowedEnvironments: ['dev', 'prod'], desiredState: 'active', metadata: { owner: 'platform' }
    })
  });
  try {
    const first = await request();
    assert.equal(first.status, 202);
    assert.equal(first.headers.get('x-idempotency-replayed'), 'false');
    const replay = await request();
    assert.equal(replay.status, 202);
    assert.equal(replay.headers.get('x-idempotency-replayed'), 'true');
    assert.equal(pool.state.entityEffects, 1);
    assert.equal(pool.state.commandEffects, 1);
    assert.equal(pool.state.auditEffects, 1);
  } finally {
    await close(server);
  }
});
