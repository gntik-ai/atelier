import {
  buildAuditExportConsoleView,
  exportTenantAuditRecordsPreview,
  exportWorkspaceAuditRecordsPreview
} from '../../../control-plane/src/observability-audit-export.mjs';

export function getAuditExportConsoleView(options = {}) {
  return buildAuditExportConsoleView(options);
}

export function previewTenantAuditExport(input = {}) {
  return exportTenantAuditRecordsPreview(input.context ?? {}, input.request ?? {});
}

export function previewWorkspaceAuditExport(input = {}) {
  return exportWorkspaceAuditRecordsPreview(input.context ?? {}, input.request ?? {});
}
