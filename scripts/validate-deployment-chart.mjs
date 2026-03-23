import { collectDeploymentChartViolations, readRootChart, readRootValues, readWrapperChart } from './lib/deployment-chart.mjs';
import { readDeploymentTopology } from './lib/deployment-topology.mjs';

const violations = collectDeploymentChartViolations(
  readRootChart(),
  readRootValues(),
  readDeploymentTopology(),
  readWrapperChart()
);

if (violations.length > 0) {
  console.error('Deployment chart validation failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('Deployment chart dependencies, values layers, and packaging guidance are internally consistent.');
