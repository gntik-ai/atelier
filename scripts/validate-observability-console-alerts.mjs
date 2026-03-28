import { collectObservabilityConsoleAlertViolations } from './lib/observability-console-alerts.mjs';

const violations = collectObservabilityConsoleAlertViolations();

if (violations.length > 0) {
  console.error('Observability console alerts validation failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log('Observability console alerts validation passed.');
}
