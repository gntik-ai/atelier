/**
 * C-17 HTTP-boundary regression.
 *
 * Drives the public createControlPlaneHttpServer seam through loopback HTTP and
 * routes to the real async-operation-query action. No cluster, credentials,
 * external network, or live database are required.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import Ajv from 'ajv';

import { createControlPlaneHttpServer } from '../../apps/control-plane/server.mjs';

const HTTP_FETCH = globalThis.fetch.bind(globalThis);
const OPENAPI = JSON.parse(readFileSync('apps/control-plane-executor/openapi/control-plane.openapi.json', 'utf8'));
const ERROR_SCHEMA = OPENAPI.components.schemas.ErrorResponse;
const DETAIL_SCHEMA = OPENAPI.components.schemas.ErrorDetail;
const RESOURCE_SCHEMA = OPENAPI.components.schemas.ErrorResource;
const ajv = new Ajv({ allErrors: true, strict: false });
ajv.addFormat('date-time', {
  type: 'string',
  validate: (value) => Number.isFinite(Date.parse(value)) && /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
});
const errorResponseWithResolvedComponents = JSON.parse(
  JSON.stringify({
    ...structuredClone(ERROR_SCHEMA),
    $defs: {
      ErrorDetail: structuredClone(DETAIL_SCHEMA),
      ErrorResource: structuredClone(RESOURCE_SCHEMA)
    }
  }).replaceAll('#/components/schemas/', '#/$defs/')
);
const validateErrorResponse = ajv.compile(errorResponseWithResolvedComponents);

const ROUTE_PATH = '/v1/async-operation-query';
const ACTION_MODULE = new URL(
  '../../packages/provisioning-orchestrator/src/actions/async-operation-query.mjs',
  import.meta.url
).href;
const VALID_BEARER = 'c17-http-valid-operator-token';
const REQUEST_ID = 'req-c17-http-malformed-001';
const CORRELATION_ID = 'corr-c17-http-malformed-001';
const MALFORMED_OPERATION_ID = 'not-a-uuid';
const INTERNAL_DIAGNOSTIC = /22P02|sqlstate|postgres(?:ql)?|async_operations|select\s|stack|invalid input syntax|string_to_uuid/i;

const ASYNC_OPERATION_ROUTE = Object.freeze({
  method: 'POST',
  path: ROUTE_PATH,
  module: ACTION_MODULE,
  export: 'main',
  invoke: 'params-overrides',
  deps: ['db'],
  auth: 'authenticated',
  mergeBodyIntoParams: true,
  mergeQueryIntoParams: true
});

function minimalRouteTable() {
  return {
    matchRoute(method, path) {
      return method === ASYNC_OPERATION_ROUTE.method && path === ASYNC_OPERATION_ROUTE.path
        ? { route: ASYNC_OPERATION_ROUTE, params: {} }
        : null;
    },
    size() {
      return 1;
    }
  };
}

function recordingPostgresPool() {
  const calls = [];
  const pool = {
    calls,
    connectCalls: 0,
    releases: 0,
    async query(statement, values = []) {
      const sql = String(statement);
      calls.push({ sql, values: [...values] });

      if (/\basync_operations\b/i.test(sql)) {
        const operationId = values[0];
        if (operationId === MALFORMED_OPERATION_ID) {
          throw Object.assign(
            new Error(`invalid input syntax for type uuid: "${operationId}"`),
            { code: '22P02', routine: 'string_to_uuid' }
          );
        }
        return { rows: [] };
      }

      // The public listener may perform bounded best-effort attribution or
      // metrics work; it is outside the async-operation persistence boundary.
      return { rows: [] };
    },
    async connect() {
      pool.connectCalls += 1;
      return {
        query: pool.query.bind(pool),
        release() {
          pool.releases += 1;
        }
      };
    }
  };
  return pool;
}

function recordingJwtVerifier() {
  const calls = [];
  return {
    calls,
    async verify(token) {
      calls.push(token);
      if (token !== VALID_BEARER) {
        throw new Error('untrusted C-17 HTTP bearer');
      }
      return {
        payload: {
          sub: 'operator-c17-http',
          tenant_id: 'tenant-c17-http-a',
          realm_access: { roles: ['tenant_operator'] },
          scope: ''
        },
        trust: { kind: 'tenant', realm: 'tenant-c17-http-a' }
      };
    }
  };
}

function assertCanonicalC02Envelope(body, {
  status,
  code,
  requestId,
  correlationId,
  path = ROUTE_PATH
}) {
  assert.equal(
    validateErrorResponse(body),
    true,
    `response must validate against OpenAPI ErrorResponse with resolved ErrorDetail/ErrorResource: ${JSON.stringify(validateErrorResponse.errors)}`
  );
  assert.equal(body.status, status);
  assert.equal(body.code, code);
  assert.equal(body.requestId, requestId);
  assert.equal(body.correlationId, correlationId);
  assert.equal(typeof body.message, 'string');
  assert.ok(body.detail && typeof body.detail === 'object' && !Array.isArray(body.detail));
  assert.ok(body.resource && typeof body.resource === 'object' && !Array.isArray(body.resource));
  assert.equal(body.resource.path, path);
  assert.equal(new Date(body.timestamp).toISOString(), body.timestamp);

  const serialized = JSON.stringify(body);
  assert.doesNotMatch(serialized, INTERNAL_DIAGNOSTIC);
  assert.doesNotMatch(serialized, new RegExp(MALFORMED_OPERATION_ID, 'i'));
}

function asyncOperationQueries(pool) {
  return pool.calls.filter(({ sql }) => /\basync_operations\b/i.test(sql));
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

const pool = recordingPostgresPool();
const jwtVerifier = recordingJwtVerifier();
const serverErrors = [];
const server = createControlPlaneHttpServer({
  pool,
  jwtVerifier,
  routeTable: minimalRouteTable(),
  logger: {
    error(...args) {
      serverErrors.push(args);
    }
  }
});
let baseUrl;

test.before(async () => {
  baseUrl = await listen(server);
});

test.after(async () => {
  await close(server);
});

/**
 * bbx-c17-http-001
 * fn-async-operation-id-validation
 * OpenSpec C-17 — #### Scenario: HTTP response is canonical and provider-safe
 */
test('bbx-c17-http-001 | fn-async-operation-id-validation | Scenario: HTTP response is canonical and provider-safe', async () => {
  const response = await HTTP_FETCH(`${baseUrl}${ROUTE_PATH}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${VALID_BEARER}`,
      'content-type': 'application/json',
      'x-request-id': REQUEST_ID,
      'x-correlation-id': CORRELATION_ID
    },
    body: JSON.stringify({
      queryType: 'detail',
      operationId: MALFORMED_OPERATION_ID
    })
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assertCanonicalC02Envelope(body, {
    status: 400,
    code: 'GW_VALIDATION_ERROR',
    requestId: REQUEST_ID,
    correlationId: CORRELATION_ID
  });
  assert.deepEqual(asyncOperationQueries(pool), [], 'malformed input never queries async_operations');
  assert.equal(jwtVerifier.calls.filter((token) => token === VALID_BEARER).length, 1);
  assert.equal(pool.connectCalls, 1, 'the listener may acquire the action DB port before action validation');
  assert.equal(pool.releases, 1, 'the acquired action DB port is released after validation rejects');
});

/**
 * bbx-c17-http-002
 * fn-async-operation-query-authentication
 * OpenSpec C-17 — #### Scenario: Authentication retains precedence over malformed input
 */
test('bbx-c17-http-002 | fn-async-operation-query-authentication | Scenario: Authentication retains precedence over malformed input', async () => {
  const verifierCallsBefore = jwtVerifier.calls.length;
  const connectCallsBefore = pool.connectCalls;
  const response = await HTTP_FETCH(`${baseUrl}${ROUTE_PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-request-id': 'req-c17-http-unauthorized-001',
      'x-correlation-id': 'corr-c17-http-unauthorized-001'
    },
    body: JSON.stringify({
      queryType: 'detail',
      operationId: MALFORMED_OPERATION_ID
    })
  });
  const body = await response.json();

  assert.equal(response.status, 401);
  assertCanonicalC02Envelope(body, {
    status: 401,
    code: 'GW_UNAUTHENTICATED',
    requestId: 'req-c17-http-unauthorized-001',
    correlationId: 'corr-c17-http-unauthorized-001'
  });
  assert.equal(jwtVerifier.calls.length, verifierCallsBefore, 'missing bearer stops before token verification');
  assert.equal(pool.connectCalls, connectCallsBefore, 'missing bearer stops before acquiring an action DB port');
  assert.deepEqual(asyncOperationQueries(pool), [], 'unauthenticated malformed input never queries async_operations');
});
