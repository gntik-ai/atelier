import test from 'node:test';
import assert from 'node:assert/strict';

import { readDeploymentSmokeMatrix, readDeploymentTopology, resolveValues } from '../../../scripts/lib/deployment-topology.mjs';

test('deployment smoke scaffold covers every environment on Kubernetes and OpenShift', () => {
  const smokeMatrix = readDeploymentSmokeMatrix();
  const combinations = new Set(smokeMatrix.smoke_scenarios.map((scenario) => `${scenario.environment}:${scenario.platform}`));

  for (const environment of ['dev', 'sandbox', 'staging', 'prod']) {
    for (const platform of ['kubernetes', 'openshift']) {
      assert.equal(combinations.has(`${environment}:${platform}`), true, `missing smoke scenario ${environment}/${platform}`);
    }
  }
});

test('platform smoke scaffold keeps the same logical surface while swapping only the exposure primitive', () => {
  const topology = readDeploymentTopology();

  for (const environment of topology.environment_profiles.map((profile) => profile.id)) {
    const kubernetesValues = resolveValues(environment, 'kubernetes');
    const openshiftValues = resolveValues(environment, 'openshift');

    assert.deepEqual(kubernetesValues.publicSurface.hostnames, openshiftValues.publicSurface.hostnames);
    assert.deepEqual(kubernetesValues.publicSurface.routePrefixes, openshiftValues.publicSurface.routePrefixes);
    assert.equal(kubernetesValues.platform.network.exposureKind, 'Ingress');
    assert.equal(openshiftValues.platform.network.exposureKind, 'Route');
  }
});
