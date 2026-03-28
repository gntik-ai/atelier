import { collectObservabilityBusinessMetricViolations } from './lib/observability-business-metrics.mjs';

const violations = collectObservabilityBusinessMetricViolations();

if (violations.length > 0) {
  console.error('Observability business metrics validation failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log('Observability business metrics validation passed.');
}
