import { collectAuditQuerySurfaceViolations, readObservabilityAuditQuerySurface } from './lib/observability-audit-query-surface.mjs';

const contract = readObservabilityAuditQuerySurface();
const violations = collectAuditQuerySurfaceViolations(contract);

if (violations.length > 0) {
  console.error('Observability audit query surface validation failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('Observability audit query surface contract is valid and aligned.');
