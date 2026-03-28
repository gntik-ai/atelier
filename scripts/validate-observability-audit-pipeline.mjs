import { collectAuditPipelineViolations } from './lib/observability-audit-pipeline.mjs';

const violations = collectAuditPipelineViolations();

if (violations.length > 0) {
  console.error('Observability audit pipeline validation failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log('Observability audit pipeline validation passed.');
}
