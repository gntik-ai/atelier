import { collectObservabilityHealthCheckViolations } from './lib/observability-health-checks.mjs';

const violations = collectObservabilityHealthCheckViolations();

if (violations.length > 0) {
  console.error('Observability health checks validation failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log('Observability health checks validation passed.');
}
