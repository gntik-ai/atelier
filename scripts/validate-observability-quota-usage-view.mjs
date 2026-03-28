import { collectObservabilityQuotaUsageViewViolations, readObservabilityQuotaUsageView } from './lib/observability-quota-usage-view.mjs';

const contract = readObservabilityQuotaUsageView();
const violations = collectObservabilityQuotaUsageViewViolations(contract);

if (violations.length > 0) {
  console.error('Observability quota usage view validation failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('Observability quota usage view contract is valid and aligned.');
