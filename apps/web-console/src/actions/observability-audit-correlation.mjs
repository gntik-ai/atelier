import {
  buildAuditCorrelationConsoleView,
  listAuditCorrelationRoutes,
  traceTenantAuditCorrelation,
  traceWorkspaceAuditCorrelation
} from '../../../control-plane/src/observability-audit-correlation.mjs';

export function getTenantAuditCorrelationView(options = {}) {
  return buildAuditCorrelationConsoleView({ scopeId: 'tenant', ...options });
}

export function getWorkspaceAuditCorrelationView(options = {}) {
  return buildAuditCorrelationConsoleView({ scopeId: 'workspace', ...options });
}

export function previewTenantAuditCorrelation(context = {}, input = {}) {
  return traceTenantAuditCorrelation(context, input);
}

export function previewWorkspaceAuditCorrelation(context = {}, input = {}) {
  return traceWorkspaceAuditCorrelation(context, input);
}

export { listAuditCorrelationRoutes };
