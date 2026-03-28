import { collectAuditCorrelationSurfaceViolations, readObservabilityAuditCorrelationSurface } from './lib/observability-audit-correlation-surface.mjs';

const contract = readObservabilityAuditCorrelationSurface();
const violations = collectAuditCorrelationSurfaceViolations(contract);

if (violations.length > 0) {
  console.error('Observability audit correlation surface validation failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('Observability audit correlation surface contract is valid and aligned.');
