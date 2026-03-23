import { collectDeploymentTopologyViolations, readDeploymentSmokeMatrix, readDeploymentTopology } from './lib/deployment-topology.mjs';

const topology = readDeploymentTopology();
const smokeMatrix = readDeploymentSmokeMatrix();
const violations = collectDeploymentTopologyViolations(topology, smokeMatrix);

if (violations.length > 0) {
  console.error('Deployment topology validation failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('Deployment topology contract, overlays, and smoke matrix are internally consistent.');
