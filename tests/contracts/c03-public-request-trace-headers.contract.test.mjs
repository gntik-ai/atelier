import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import {
  PUBLIC_CORS_ALLOW_HEADERS,
  PUBLIC_CORS_EXPOSE_HEADERS
} from '../../apps/shared/error-envelope.mjs';

const catalog = JSON.parse(readFileSync('packages/internal-contracts/src/public-route-catalog.json', 'utf8'));
const openapi = JSON.parse(readFileSync('apps/control-plane-executor/openapi/control-plane.openapi.json', 'utf8'));
const routing = readFileSync('deploy/gateway-config/base/public-api-routing.yaml', 'utf8');
const routingConfig = YAML.parse(routing);
const apisix = readFileSync('deploy/kind/apisix/apisix.yaml', 'utf8');
const apisixConfig = YAML.parse(apisix);
const gatewayFragments = [
  'deploy/gateway-config/openapi-fragments/workspace-docs.openapi.json',
  'deploy/gateway-config/openapi-fragments/workspace-openapi-sdk.openapi.json'
].map((path) => [path, JSON.parse(readFileSync(path, 'utf8'))]);

test('C-03 public contracts pin API version and make correlation generated/returned', () => {
  assert.equal(openapi.components.parameters.XApiVersion.required, true);
  assert.equal(openapi.components.parameters.XApiVersion.schema.const, '2026-03-26');
  assert.equal(openapi.components.parameters.XCorrelationId.required, false);
  assert.match(openapi.components.headers.XCorrelationId.schema.pattern, /A-Za-z0-9/);
  for (const pathItem of Object.values(openapi.paths)) {
    for (const operation of Object.values(pathItem)) {
      if (!operation?.responses) continue;
      for (const [status, response] of Object.entries(operation.responses)) {
        if (response.$ref) continue;
        assert.deepEqual(
          response.headers?.['X-Correlation-Id'],
          { $ref: '#/components/headers/XCorrelationId' },
          `${operation.operationId} response ${status}`
        );
      }
    }
  }
  assert.equal(catalog.version, '2026-03-26');
  assert.ok(catalog.routes.length > 0);
  for (const route of catalog.routes) {
    assert.ok(route.requiredHeaders.includes('X-API-Version'), route.operationId);
    assert.equal(route.requiredHeaders.includes('X-Correlation-Id'), false, route.operationId);
    assert.equal(route.correlationIdRequired, false, route.operationId);
    assert.equal(route.correlationIdGeneratedWhenMissing, true, route.operationId);
  }
  assert.match(routing, /versionHeader:\n\s+name: X-API-Version\n\s+required: true/);
  assert.match(routing, /correlationHeader:\n\s+name: X-Correlation-Id\n\s+required: false/);
  assert.match(routing, /generateWhenMissing: true/);
  assert.match(routing, /responseHeader: X-Correlation-Id/);
});

test('C-03 hand-maintained gateway OpenAPI fragments advertise only the canonical version', () => {
  for (const [path, fragment] of gatewayFragments) {
    assert.equal(fragment.info.version, '2026-03-26', path);
    for (const pathItem of Object.values(fragment.paths)) {
      for (const operation of Object.values(pathItem)) {
        assert.match(operation.description, /Accepted X-API-Version: 2026-03-26(?:\s|\||$)/, path);
        assert.doesNotMatch(operation.description, /2026-03-(?:01|25|30)/, path);
      }
    }
  }
});

test('C-03 APISIX product routes defer CORS to the route-aware runtimes', () => {
  const blocks = apisix.split(/^  - id: /m).slice(1).filter((block) => block.includes('uri: "/v1/') && /cors:/.test(block));
  assert.ok(blocks.length > 0);
  for (const block of blocks) {
    assert.match(block, /cors:\n\s+_meta:\n\s+disable: true/);
    assert.match(block, /allow_headers: .*X-API-Version/);
    assert.match(block, /allow_headers: .*X-Correlation-Id/);
    assert.match(block, /expose_headers: "X-Correlation-Id(?:,|")/);
  }

  const contractHeaderNames = Object.values(openapi.components.parameters)
    .filter((parameter) => parameter.in === 'header')
    .map((parameter) => parameter.name.toLowerCase());
  const expectedCorsHeaders = new Set([
    ...contractHeaderNames,
    'authorization',
    'content-type',
    'x-requested-with',
    'apikey',
    'x-api-key',
    'last-event-id',
    'x-request-id',
    'range',
    'if-match',
    'if-none-match'
  ]);
  const contractResponseHeaders = new Set();
  for (const pathItem of Object.values(openapi.paths)) {
    for (const operation of Object.values(pathItem)) {
      for (const response of Object.values(operation?.responses ?? {})) {
        for (const header of Object.keys(response?.headers ?? {})) contractResponseHeaders.add(header.toLowerCase());
      }
    }
  }
  const expectedExposedHeaders = new Set([
    ...contractResponseHeaders,
    'x-idempotency-replayed',
    'x-ratelimit-limit',
    'x-ratelimit-remaining',
    'x-ratelimit-reset'
  ]);
  assert.deepEqual(new Set(PUBLIC_CORS_ALLOW_HEADERS), expectedCorsHeaders);
  assert.deepEqual(new Set(PUBLIC_CORS_EXPOSE_HEADERS), expectedExposedHeaders);
  assert.deepEqual(
    new Set(routingConfig.spec.allowedRequestHeaders.map((header) => header.toLowerCase())),
    expectedCorsHeaders
  );
  assert.deepEqual(
    new Set(routingConfig.spec.corsProfiles.product_api.exposeHeaders.map((header) => header.toLowerCase())),
    expectedExposedHeaders
  );
  const productRoutes = apisixConfig.routes.filter((route) => String(route.uri).startsWith('/v1/'));
  for (const route of productRoutes.filter((route) => route.plugins?.cors)) {
    const configuredHeaders = new Set(
      String(route.plugins.cors.allow_headers).toLowerCase().split(',').map((header) => header.trim())
    );
    assert.deepEqual(configuredHeaders, expectedCorsHeaders, `APISIX route ${route.id} CORS allow-list`);
    const configuredExposedHeaders = new Set(
      String(route.plugins.cors.expose_headers).toLowerCase().split(',').map((header) => header.trim())
    );
    assert.deepEqual(configuredExposedHeaders, expectedExposedHeaders, `APISIX route ${route.id} CORS expose-list`);
  }

  for (const family of ['2005', '2006', '2007', '2008']) {
    const preflight = apisixConfig.routes.find((route) => route.id === `${family}-key-preflight`);
    const keyRoute = apisixConfig.routes.find((route) => route.id === `${family}-key`);
    const bearerRoute = apisixConfig.routes.find((route) => route.id === family);
    assert.ok(preflight, `${family} has a header-value-independent preflight route`);
    assert.deepEqual(preflight.methods, ['OPTIONS']);
    assert.equal(preflight.vars, undefined);
    assert.ok(preflight.priority > keyRoute.priority);
    assert.ok(preflight.priority > bearerRoute.priority);
    assert.equal(keyRoute.methods.includes('OPTIONS'), false);
    assert.match(Object.keys(preflight.upstream.nodes)[0], /control-plane-executor/);
  }

  for (const route of productRoutes.filter((route) => route.plugins?.['limit-count'])) {
    const pre = route.plugins['serverless-pre-function'];
    const post = route.plugins['serverless-post-function'];
    assert.equal(pre?.phase, 'rewrite', `${route.id} resolves safe correlation before limit-count`);
    assert.equal(post?.phase, 'header_filter', `${route.id} finalizes correlation after limit-count`);
    const preSource = pre.functions.join('\n');
    const postSource = post.functions.join('\n');
    assert.match(preSource, /type\(raw\) == "string"/);
    assert.match(preSource, /\^\[A-Za-z0-9\._:-\]\{8,128\}\$/);
    assert.match(preSource, /ctx\.c03_correlation_id = valid and raw or ngx\.var\.request_id/);
    assert.match(preSource, /if raw == nil/);
    assert.match(postSource, /local current = ngx\.header\["X-Correlation-Id"\]/);
    assert.match(postSource, /ctx\.c03_correlation_id or ngx\.var\.request_id/);
  }
});
