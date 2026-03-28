import { collectAuditExportSurfaceViolations, readObservabilityAuditExportSurface } from './lib/observability-audit-export-surface.mjs';

const contract = readObservabilityAuditExportSurface();
const violations = collectAuditExportSurfaceViolations(contract);

if (violations.length > 0) {
  console.error('Observability audit export surface validation failed:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

console.log('Observability audit export surface contract is valid and aligned.');
