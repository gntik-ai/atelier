import {
  collectObservabilityHardLimitEnforcementViolations,
  readObservabilityHardLimitEnforcement
} from './lib/observability-hard-limit-enforcement.mjs';

const contract = readObservabilityHardLimitEnforcement();
const violations = collectObservabilityHardLimitEnforcementViolations(contract);

if (violations.length > 0) {
  console.error('Observability hard-limit enforcement validation failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('Observability hard-limit enforcement contract is valid and aligned.');
