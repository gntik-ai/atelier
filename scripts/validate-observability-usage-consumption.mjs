import { collectObservabilityUsageConsumptionViolations, readObservabilityUsageConsumption } from './lib/observability-usage-consumption.mjs';

const contract = readObservabilityUsageConsumption();
const violations = collectObservabilityUsageConsumptionViolations(contract);

if (violations.length > 0) {
  console.error('Observability usage consumption validation failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('Observability usage consumption contract is valid and aligned.');
