import { collectObservabilityThresholdAlertViolations, readObservabilityThresholdAlerts } from './lib/observability-threshold-alerts.mjs';

const contract = readObservabilityThresholdAlerts();
const violations = collectObservabilityThresholdAlertViolations(contract);

if (violations.length > 0) {
  console.error('Observability threshold alerts validation failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('Observability threshold alerts contract is valid and aligned.');
