import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectDeploymentTopologyViolations,
  deepMerge,
  readDeploymentSmokeMatrix,
  readDeploymentTopology,
  resolveValues
} from '../../scripts/lib/deployment-topology.mjs';
import { OPENAPI_PATH, readJson } from '../../scripts/lib/quality-gates.mjs';

test('deployment topology package remains internally consistent', () => {
  const violations = collectDeploymentTopologyViolations(
    readDeploymentTopology(),
    readDeploymentSmokeMatrix(),
    readJson(OPENAPI_PATH)
  );

  assert.deepEqual(violations, []);
});

test('deepMerge preserves layered inheritance order for nested values', () => {
  const merged = deepMerge(
    {
      publicSurface: {
        hostnames: { api: 'api.dev.example.com' },
        routePrefixes: { controlPlane: '/control-plane' }
      }
    },
    {
      publicSurface: {
        hostnames: { api: 'api.staging.example.com', console: 'console.staging.example.com' }
      }
    }
  );

  assert.equal(merged.publicSurface.hostnames.api, 'api.staging.example.com');
  assert.equal(merged.publicSurface.hostnames.console, 'console.staging.example.com');
  assert.equal(merged.publicSurface.routePrefixes.controlPlane, '/control-plane');
});

test('resolveValues applies environment and platform overlays deterministically', () => {
  const resolved = resolveValues('prod', 'openshift');

  assert.equal(resolved.global.environment, 'prod');
  assert.equal(resolved.environmentProfile.id, 'prod');
  assert.equal(resolved.platform.target, 'openshift');
  assert.equal(resolved.platform.network.exposureKind, 'Route');
  assert.equal(resolved.publicSurface.hostnames.api, 'api.in-falcone.example.com');
  assert.equal(resolved.bootstrap.enabled, true);
  assert.equal(resolved.bootstrap.reconcile.apisix.routes.length >= 16, true);
  assert.equal(resolved.gatewayPolicy.passthrough.mode, 'disabled');
});

test('deployment topology includes optional profile, exposure, and operational constraint metadata', () => {
  const topology = readDeploymentTopology();

  assert.deepEqual(topology.configuration_policy.optional_helm_value_layers, ['profile']);
  assert.deepEqual(topology.exposure_matrix.supported_tls_modes, ['clusterManaged', 'external']);
  assert.equal(topology.exposure_matrix.kubernetes.loadBalancer_tls_mode, 'external');
  assert.equal(topology.upgrade_guardrails.default_strategy, 'rolling');
  assert.equal(topology.operational_constraints.network_policy.length >= 1, true);
  assert.equal(topology.operational_constraints.corporate_proxy.length >= 1, true);
});

test('collectDeploymentTopologyViolations flags route-prefix drift and missing smoke coverage', () => {
  const topology = readDeploymentTopology();
  const brokenTopology = structuredClone(topology);
  brokenTopology.public_surface.route_prefixes.control_plane = '/api';
  brokenTopology.exposure_matrix.kubernetes.loadBalancer_tls_mode = 'clusterManaged';

  const smokeMatrix = readDeploymentSmokeMatrix();
  const brokenSmokeMatrix = structuredClone(smokeMatrix);
  brokenSmokeMatrix.smoke_scenarios = brokenSmokeMatrix.smoke_scenarios.filter(
    (scenario) => !(scenario.environment === 'prod' && scenario.platform === 'openshift')
  );

  const violations = collectDeploymentTopologyViolations(
    brokenTopology,
    brokenSmokeMatrix,
    readJson(OPENAPI_PATH)
  );

  assert.ok(violations.some((violation) => violation.includes('route prefix control_plane')));
  assert.ok(violations.some((violation) => violation.includes('loadBalancer_tls_mode')));
  assert.ok(violations.some((violation) => violation.includes('must cover prod/openshift')));
});

test('collectDeploymentTopologyViolations flags bootstrap policy drift', () => {
  const brokenTopology = structuredClone(readDeploymentTopology());
  brokenTopology.bootstrap_policy.supported_secret_strategies = ['kubernetesSecret'];

  const violations = collectDeploymentTopologyViolations(
    brokenTopology,
    readDeploymentSmokeMatrix(),
    readJson(OPENAPI_PATH)
  );

  assert.ok(violations.some((violation) => violation.includes('bootstrap_policy.supported_secret_strategies')));
});
