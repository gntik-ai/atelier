/**
 * C-14 hermetic public-HTTP coverage for the privilege-domain denial history.
 *
 * The tests drive only the exported production listener and HTTP surface. The
 * route is sourced from the shipped executable route map, JWT verification is
 * deterministic and local, and the injected database is an isolated recorder.
 * No external network, PostgreSQL, APISIX, SPA, or Kubernetes process is used.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createControlPlaneHttpServer } from '../../apps/control-plane/server.mjs';

const CANONICAL_METHOD = 'GET';
const CANONICAL_PATH = '/v1/workspaces/{workspaceId}/privilege-domains/audit';
const ACTION_MODULE = '/repo/packages/provisioning-orchestrator/src/actions/privilege-domain-audit-query.mjs';
const FN_ID = 'fn-privilege-domain-audit-query';
const TENANT_A = 'ten-c14-a';
const TENANT_B = 'ten-c14-b';
const WORKSPACE_A = 'wrk-c14-a';
const UNKNOWN_WORKSPACE = 'wrk-c14-unknown';
const JWT_SECRET = Buffer.from('c14-hermetic-http-verifier-secret', 'utf8');
const REQUEST_HEADERS = {
  'x-request-id': 'req-c14-blackbox-0001',
  'x-correlation-id': 'corr-c14-blackbox-0001'
};

const runtimeMapJson = process.env.C14_RUNTIME_ROUTE_MAP_JSON
  ?? readFileSync('apps/control-plane/route-map.runtime.json', 'utf8');
const runtimeMap = JSON.parse(runtimeMapJson);
const canonicalEntries = runtimeMap.filter((entry) => (
  entry.method === CANONICAL_METHOD && entry.path === CANONICAL_PATH
));
assert.equal(canonicalEntries.length, 1, 'the executable map must contain the one canonical C-14 route');
const canonicalEntry = canonicalEntries[0];
assert.deepEqual(
  {
    module: canonicalEntry.module,
    export: canonicalEntry.export,
    invoke: canonicalEntry.invoke,
    deps: canonicalEntry.deps,
    auth: canonicalEntry.auth,
    mergeQueryIntoParams: canonicalEntry.mergeQueryIntoParams
  },
  {
    module: ACTION_MODULE,
    export: 'main',
    invoke: 'params-auth-overrides',
    deps: ['db'],
    auth: 'authenticated',
    mergeQueryIntoParams: true
  },
  'the HTTP test must dispatch through the canonical privilege-domain-audit-query entry'
);

const OPENAPI = JSON.parse(readFileSync('apps/control-plane-executor/openapi/control-plane.openapi.json', 'utf8'));
const ERROR_RESPONSE = OPENAPI.components.schemas.ErrorResponse;

const DENIAL_ROW = {
  id: 'd14d14d1-0000-4000-8000-000000000014',
  tenant_id: TENANT_A,
  workspace_id: WORKSPACE_A,
  actor_id: 'usr-c14-actor',
  actor_type: 'workspace_admin',
  credential_domain: null,
  required_domain: 'structural_admin',
  http_method: 'DELETE',
  request_path: `/v1/workspaces/${WORKSPACE_A}/members/usr-c14-target`,
  source_ip: null,
  correlation_id: 'corr-c14-denial-0001',
  denied_at: '2026-08-05T10:30:00.000Z'
};

const PROJECT_ROOT = resolve('.');

function localModuleUrl(repoModule) {
  assert.match(repoModule, /^\/repo\//, 'runtime modules use the container /repo root');
  const absolute = resolve(PROJECT_ROOT, repoModule.slice('/repo/'.length));
  assert.ok(absolute.startsWith(`${PROJECT_ROOT}${sep}`), 'runtime module stays inside the repository');
  return pathToFileURL(absolute).href;
}

function compileRouteTemplate(template) {
  const names = [];
  const source = template.split(/(\{[A-Za-z0-9_]+\})/).map((part) => {
    const parameter = /^\{([A-Za-z0-9_]+)\}$/.exec(part);
    if (parameter) {
      names.push(parameter[1]);
      return '([^/]+)';
    }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return { names, expression: new RegExp(`^${source}/?$`) };
}

function routeTableFromCanonicalEntry() {
  const route = { ...canonicalEntry, module: localModuleUrl(canonicalEntry.module) };
  const { names, expression } = compileRouteTemplate(canonicalEntry.path);
  return {
    size: () => 1,
    matchRoute(method, path) {
      if (method !== canonicalEntry.method) return null;
      const match = expression.exec(path);
      if (!match) return null;
      const params = Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(match[index + 1])]));
      return { route, params };
    }
  };
}

function encodePart(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function jwtFor({ sub, roles, tenantId }) {
  const header = encodePart({ alg: 'HS256', typ: 'JWT' });
  const payload = encodePart({
    iss: 'https://issuer.invalid/realms/c14-hermetic',
    aud: 'falcone-control-plane',
    sub,
    ...(tenantId ? { tenant_id: tenantId } : {}),
    realm_access: { roles },
    iat: 1_786_000_000,
    exp: 4_102_444_800
  });
  const input = `${header}.${payload}`;
  const signature = createHmac('sha256', JWT_SECRET).update(input).digest('base64url');
  return `${input}.${signature}`;
}

function deterministicJwtVerifier() {
  const calls = [];
  return {
    calls,
    async verify(token) {
      calls.push(token);
      const parts = String(token).split('.');
      if (parts.length !== 3) throw new Error('malformed test JWT');
      const input = `${parts[0]}.${parts[1]}`;
      const expected = createHmac('sha256', JWT_SECRET).update(input).digest();
      const received = Buffer.from(parts[2], 'base64url');
      if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
        throw new Error('invalid test JWT signature');
      }
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      return {
        payload,
        trust: payload.tenant_id
          ? { kind: 'tenant', realm: payload.tenant_id }
          : { kind: 'platform', realm: 'in-falcone-platform' }
      };
    }
  };
}

function recordingDatabase({ rows = [], total = rows.length } = {}) {
  const actionQueries = [];
  const listenerQueries = [];
  let connections = 0;
  let releases = 0;

  const actionClient = {
    async query(sql, params = []) {
      const query = { sql: String(sql), params: [...params] };
      actionQueries.push(query);
      if (/^\s*SELECT\s+COUNT\(\*\)::int\s+AS\s+total\s+FROM\s+privilege_domain_denials\b/i.test(query.sql)) {
        return { rows: [{ total }] };
      }
      if (/^\s*SELECT\s+\*\s+FROM\s+privilege_domain_denials\b/i.test(query.sql)) {
        return { rows: rows.map((row) => ({ ...row })) };
      }
      throw new Error(`unexpected action database operation: ${query.sql}`);
    },
    release() {
      releases += 1;
    }
  };

  return {
    actionQueries,
    listenerQueries,
    get connections() { return connections; },
    get releases() { return releases; },
    clearActionQueries() { actionQueries.length = 0; },
    async connect() {
      connections += 1;
      return actionClient;
    },
    async query(sql, params = []) {
      // The production listener may perform best-effort generic metric-scope enrichment
      // after an authorized/400 response. Keep it observable and separate from the
      // dedicated client injected into privilege-domain-audit-query.
      listenerQueries.push({ sql: String(sql), params: [...params] });
      return { rows: [] };
    }
  };
}

async function startFixture(databaseOptions) {
  const pool = recordingDatabase(databaseOptions);
  const jwtVerifier = deterministicJwtVerifier();
  const server = createControlPlaneHttpServer({
    pool,
    jwtVerifier,
    routeTable: routeTableFromCanonicalEntry(),
    logger: { error() {} },
    port: 0
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    pool,
    jwtVerifier,
    async close() {
      if (!server.listening) return;
      await new Promise((resolveClose, rejectClose) => {
        server.close((error) => error ? rejectClose(error) : resolveClose());
      });
    }
  };
}

async function requestJson(fixture, path, token) {
  const response = await fetch(`${fixture.baseUrl}${path}`, {
    method: 'GET',
    headers: {
      ...REQUEST_HEADERS,
      authorization: `Bearer ${token}`
    }
  });
  assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/i);
  const text = await response.text();
  assert.doesNotMatch(text, /<!doctype|<html|NO_ROUTE/i, 'the canonical operation returns JSON from the action, not SPA/NO_ROUTE content');
  return { response, body: JSON.parse(text) };
}

function assertSuccessEnvelope(response, body, expected) {
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(body).sort(), ['denials', 'limit', 'offset', 'total']);
  assert.deepEqual(body, expected);
}

function assertPublicError(response, body, expectedStatus, expectedCode) {
  assert.equal(response.status, expectedStatus);
  assert.deepEqual(
    ERROR_RESPONSE.required.filter((field) => !Object.hasOwn(body, field)),
    [],
    'the public C-02 ErrorResponse envelope is complete'
  );
  assert.deepEqual(
    Object.keys(body).filter((field) => !Object.hasOwn(ERROR_RESPONSE.properties, field)),
    [],
    'the error contains no undeclared envelope fields'
  );
  assert.equal(body.status, expectedStatus);
  assert.equal(body.code, expectedCode);
  assert.equal(body.requestId, REQUEST_HEADERS['x-request-id']);
  assert.equal(body.correlationId, REQUEST_HEADERS['x-correlation-id']);
  assert.equal(new Date(body.timestamp).toISOString(), body.timestamp);
}

function assertOnlyHistoryReads(queries) {
  assert.equal(queries.length, 2, 'authorized history requests issue one count and one list query');
  for (const { sql } of queries) {
    assert.match(sql, /^\s*SELECT\b/i);
    assert.match(sql, /\bFROM\s+privilege_domain_denials\b/i);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/i);
    assert.doesNotMatch(sql, /\b(?:tenants|workspaces|quota|audit_events)\b/i);
  }
}

/**
 * bbx-c14-001 | fn-privilege-domain-audit-query
 * OpenSpec #### Scenario: Platform administrator supplies a tenant
 * OpenSpec #### Scenario: Authorized request supplies all existing filters
 * OpenSpec #### Scenario: Requested limit exceeds the existing cap
 * OpenSpec #### Scenario: Matching denial rows are returned
 */
test(`[bbx-c14-001] ${FN_ID}: canonical platform-admin GET reaches the audit query with filters and envelope`, async () => {
  const fixture = await startFixture({ rows: [DENIAL_ROW], total: 3 });
  try {
    const token = jwtFor({ sub: 'usr-c14-platform-admin', roles: ['platform_admin'] });
    const search = new URLSearchParams({
      tenantId: TENANT_A,
      requiredDomain: 'structural_admin',
      actorId: DENIAL_ROW.actor_id,
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-05T23:59:59.999Z',
      limit: '999',
      offset: '7'
    });
    const { response, body } = await requestJson(
      fixture,
      `/v1/workspaces/${WORKSPACE_A}/privilege-domains/audit?${search}`,
      token
    );

    assertSuccessEnvelope(response, body, {
      denials: [{
        id: DENIAL_ROW.id,
        tenantId: TENANT_A,
        workspaceId: WORKSPACE_A,
        actorId: DENIAL_ROW.actor_id,
        actorType: DENIAL_ROW.actor_type,
        credentialDomain: null,
        requiredDomain: DENIAL_ROW.required_domain,
        httpMethod: DENIAL_ROW.http_method,
        requestPath: DENIAL_ROW.request_path,
        sourceIp: null,
        correlationId: DENIAL_ROW.correlation_id,
        deniedAt: DENIAL_ROW.denied_at
      }],
      total: 3,
      limit: 200,
      offset: 7
    });
    assert.equal(fixture.jwtVerifier.calls.length, 1);
    assertOnlyHistoryReads(fixture.pool.actionQueries);

    const [countQuery, listQuery] = fixture.pool.actionQueries;
    assert.deepEqual(countQuery.params, [
      TENANT_A,
      WORKSPACE_A,
      'structural_admin',
      DENIAL_ROW.actor_id,
      '2026-08-01T00:00:00.000Z',
      '2026-08-05T23:59:59.999Z'
    ]);
    assert.deepEqual(listQuery.params, [...countQuery.params, 200, 7]);
    for (const sql of [countQuery.sql, listQuery.sql]) {
      assert.match(sql, /tenant_id\s*=\s*\$1/i);
      assert.match(sql, /workspace_id\s*=\s*\$2/i);
      assert.match(sql, /required_domain\s*=\s*\$3/i);
      assert.match(sql, /actor_id\s*=\s*\$4/i);
      assert.match(sql, /denied_at\s*>=\s*\$5/i);
      assert.match(sql, /denied_at\s*<=\s*\$6/i);
    }
    assert.match(listQuery.sql, /ORDER\s+BY\s+denied_at\s+DESC\s+LIMIT\s+\$7\s+OFFSET\s+\$8/i);
    assert.equal(fixture.pool.connections, 1);
    assert.equal(fixture.pool.releases, 1);
  } finally {
    await fixture.close();
  }
});

/**
 * bbx-c14-002 | fn-privilege-domain-audit-query
 * OpenSpec #### Scenario: Platform administrator omits a tenant
 * OpenSpec #### Scenario: Dual allowed-role principal follows platform branch
 * OpenSpec #### Scenario: Any authorization or validation denial completes
 */
test(`[bbx-c14-002] ${FN_ID}: platform tenant validation and dual-role precedence run before history queries`, async () => {
  const fixture = await startFixture();
  try {
    for (const roles of [['platform_admin'], ['tenant_owner', 'platform_admin']]) {
      fixture.pool.clearActionQueries();
      const token = jwtFor({ sub: `usr-c14-${roles.join('-')}`, roles, tenantId: TENANT_A });
      const { response, body } = await requestJson(
        fixture,
        `/v1/workspaces/${WORKSPACE_A}/privilege-domains/audit`,
        token
      );
      assertPublicError(response, body, 400, 'GW_VALIDATION_ERROR');
      assert.equal(fixture.pool.actionQueries.length, 0, `${roles.join('+')} must not query denial history`);
    }
  } finally {
    await fixture.close();
  }
});

/**
 * bbx-c14-003 | fn-privilege-domain-audit-query
 * OpenSpec #### Scenario: Tenant owner queries its trusted tenant
 */
test(`[bbx-c14-003] ${FN_ID}: tenant owner is forced to its verified tenant with or without the same explicit tenant`, async () => {
  const fixture = await startFixture({ rows: [DENIAL_ROW], total: 1 });
  try {
    const token = jwtFor({ sub: 'usr-c14-tenant-owner', roles: ['tenant_owner'], tenantId: TENANT_A });
    for (const suffix of ['?limit=25&offset=2', `?tenantId=${TENANT_A}&limit=25&offset=2`]) {
      fixture.pool.clearActionQueries();
      const { response, body } = await requestJson(
        fixture,
        `/v1/workspaces/${WORKSPACE_A}/privilege-domains/audit${suffix}`,
        token
      );
      assertSuccessEnvelope(response, body, {
        denials: [{
          id: DENIAL_ROW.id,
          tenantId: TENANT_A,
          workspaceId: WORKSPACE_A,
          actorId: DENIAL_ROW.actor_id,
          actorType: DENIAL_ROW.actor_type,
          credentialDomain: null,
          requiredDomain: DENIAL_ROW.required_domain,
          httpMethod: DENIAL_ROW.http_method,
          requestPath: DENIAL_ROW.request_path,
          sourceIp: null,
          correlationId: DENIAL_ROW.correlation_id,
          deniedAt: DENIAL_ROW.denied_at
        }],
        total: 1,
        limit: 25,
        offset: 2
      });
      assertOnlyHistoryReads(fixture.pool.actionQueries);
      assert.deepEqual(fixture.pool.actionQueries[0].params, [TENANT_A, WORKSPACE_A]);
      assert.deepEqual(fixture.pool.actionQueries[1].params, [TENANT_A, WORKSPACE_A, 25, 2]);
    }
  } finally {
    await fixture.close();
  }
});

/**
 * bbx-c14-004 | fn-privilege-domain-audit-query
 * OpenSpec #### Scenario: Tenant owner requests another tenant
 * OpenSpec #### Scenario: Tenant owner lacks trusted tenant context
 * OpenSpec #### Scenario: Any authorization or validation denial completes
 */
test(`[bbx-c14-004] ${FN_ID}: tenant-owner mismatch or missing verified tenant returns 403 before history queries`, async () => {
  const fixture = await startFixture();
  try {
    const cases = [
      {
        token: jwtFor({ sub: 'usr-c14-owner-a', roles: ['tenant_owner'], tenantId: TENANT_A }),
        path: `/v1/workspaces/${WORKSPACE_A}/privilege-domains/audit?tenantId=${TENANT_B}`
      },
      {
        token: jwtFor({ sub: 'usr-c14-owner-unbound', roles: ['tenant_owner'] }),
        path: `/v1/workspaces/${WORKSPACE_A}/privilege-domains/audit`
      }
    ];
    for (const scenario of cases) {
      fixture.pool.clearActionQueries();
      const { response, body } = await requestJson(fixture, scenario.path, scenario.token);
      assertPublicError(response, body, 403, 'GW_FORBIDDEN');
      assert.equal(fixture.pool.actionQueries.length, 0);
    }
  } finally {
    await fixture.close();
  }
});

/**
 * bbx-c14-005 | fn-privilege-domain-audit-query
 * OpenSpec #### Scenario: Non-allowed administrative or workspace role calls the public operation
 */
test(`[bbx-c14-005] ${FN_ID}: every representative non-allowed role is denied before history queries`, async () => {
  const fixture = await startFixture();
  try {
    const deniedRoles = [
      'superadmin',
      'platform_auditor',
      'tenant_admin',
      'tenant_viewer',
      'workspace_owner',
      'workspace_admin',
      'workspace_auditor',
      'custom_non_allowed_role'
    ];
    for (const role of deniedRoles) {
      fixture.pool.clearActionQueries();
      const token = jwtFor({ sub: `usr-c14-${role}`, roles: [role], tenantId: TENANT_A });
      const { response, body } = await requestJson(
        fixture,
        `/v1/workspaces/${WORKSPACE_A}/privilege-domains/audit?tenantId=${TENANT_A}`,
        token
      );
      assertPublicError(response, body, 403, 'GW_FORBIDDEN');
      assert.equal(fixture.pool.actionQueries.length, 0, `${role} must not reach denial-history SQL`);
    }
  } finally {
    await fixture.close();
  }
});

/**
 * bbx-c14-006 | fn-privilege-domain-audit-query
 * OpenSpec #### Scenario: Authorized query addresses an unknown workspace
 * OpenSpec #### Scenario: Cross-tenant owner combines mismatch with unknown workspace
 */
test(`[bbx-c14-006] ${FN_ID}: unknown workspace is empty 200 for own tenant but mismatch stays pre-query 403`, async () => {
  const fixture = await startFixture();
  try {
    const ownerToken = jwtFor({ sub: 'usr-c14-owner-unknown-workspace', roles: ['tenant_owner'], tenantId: TENANT_A });
    let result = await requestJson(
      fixture,
      `/v1/workspaces/${UNKNOWN_WORKSPACE}/privilege-domains/audit?limit=17&offset=4`,
      ownerToken
    );
    assertSuccessEnvelope(result.response, result.body, {
      denials: [],
      total: 0,
      limit: 17,
      offset: 4
    });
    assertOnlyHistoryReads(fixture.pool.actionQueries);
    assert.deepEqual(fixture.pool.actionQueries[0].params, [TENANT_A, UNKNOWN_WORKSPACE]);
    assert.deepEqual(fixture.pool.actionQueries[1].params, [TENANT_A, UNKNOWN_WORKSPACE, 17, 4]);

    fixture.pool.clearActionQueries();
    result = await requestJson(
      fixture,
      `/v1/workspaces/${UNKNOWN_WORKSPACE}/privilege-domains/audit?tenantId=${TENANT_B}`,
      ownerToken
    );
    assertPublicError(result.response, result.body, 403, 'GW_FORBIDDEN');
    assert.equal(fixture.pool.actionQueries.length, 0, 'mismatch must not become a workspace-existence oracle');
  } finally {
    await fixture.close();
  }
});
