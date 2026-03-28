import { collectObservabilityQuotaPolicyViolations, readObservabilityQuotaPolicies } from './lib/observability-quota-policies.mjs';

const contract = readObservabilityQuotaPolicies();
const violations = collectObservabilityQuotaPolicyViolations(contract);

if (violations.length > 0) {
  console.error('Observability quota policies validation failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('Observability quota policies contract is valid and aligned.');
