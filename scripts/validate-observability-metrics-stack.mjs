import { collectObservabilityMetricsStackViolations } from './lib/observability-metrics-stack.mjs';

const violations = collectObservabilityMetricsStackViolations();

if (violations.length > 0) {
  console.error('Observability metrics stack validation failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log('Observability metrics stack validation passed.');
}
