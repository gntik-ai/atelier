import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { collectObservabilityHealthCheckViolations } from '../../scripts/lib/observability-health-checks.mjs';

const contract = JSON.parse(readFileSync(
  'packages/internal-contracts/src/observability-health-checks.json',
  'utf8'
));
const dockerfile = readFileSync('apps/control-plane/Dockerfile', 'utf8');
const apisix = readFileSync('deploy/kind/apisix/apisix.yaml', 'utf8');
const openapi = JSON.parse(readFileSync(
  'apps/control-plane-executor/openapi/control-plane.openapi.json',
  'utf8'
));

test('C-05 control-plane probe mapping is canonical and matches all internal exposure templates', () => {
  const mapping = contract.control_plane_probe_mapping;
  assert.deepEqual(
    Object.fromEntries(Object.entries(mapping.probe_routes).map(([key, value]) => [key, value.path])),
    {
      liveness: '/livez',
      readiness: '/readyz',
      compatibility_health: '/healthz'
    }
  );
  assert.equal(mapping.probe_routes.liveness.semantics, 'process_only');
  assert.equal(mapping.probe_routes.readiness.semantics, 'schema_and_database');
  assert.equal(mapping.public_edge.gateway_registered, false);
  assert.equal(mapping.public_edge.spa_proxy_registered, false);

  for (const exposureKind of ['aggregate', 'component']) {
    for (const probeType of ['liveness', 'readiness', 'health']) {
      assert.equal(
        mapping.internal_exposures[exposureKind][probeType],
        contract.exposure_templates[exposureKind][probeType].path
      );
    }
  }
  assert.deepEqual(collectObservabilityHealthCheckViolations(), []);
});

test('C-05 internal probes are not registered as public APISIX routes', () => {
  const publicRouteLines = apisix
    .split('\n')
    .filter((line) => /^\s*uri:\s*/.test(line))
    .join('\n');
  assert.doesNotMatch(publicRouteLines, /["']\/(?:livez|readyz|internal\/)/);
});

test('C-05 control-plane image packages the runtime and checked-in contract', () => {
  assert.match(dockerfile, /apps\/control-plane\/health-runtime\.mjs/);
  assert.match(dockerfile, /COPY packages\/internal-contracts\s+\/repo\/packages\/internal-contracts/);
  assert.match(dockerfile, /import\('\.\/health-runtime\.mjs'\)/);

  const runtimeSource = readFileSync('apps/control-plane/health-runtime.mjs', 'utf8');
  assert.match(
    runtimeSource,
    /\/repo\/packages\/internal-contracts\/src\/observability-health-checks\.json/
  );
});

test('C-05 public /health contract matches the compatibility /healthz wire body', () => {
  const responses = openapi.paths['/health'].get.responses;
  const responseSchema = responses['200']
    .content['application/json'].schema;
  assert.equal(responseSchema.$ref, '#/components/schemas/HealthStatus');
  assert.deepEqual(openapi.components.schemas.HealthStatus, {
    type: 'object',
    additionalProperties: false,
    required: ['status'],
    properties: {
      status: { type: 'string', enum: ['ok'] }
    }
  });
  assert.equal(
    responses['503'].content['application/json'].schema.$ref,
    '#/components/schemas/ErrorResponse'
  );
});
