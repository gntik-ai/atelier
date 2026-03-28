import {
  buildAuditExplorerView,
  listAuditQueryRoutes,
  queryTenantAuditRecords,
  queryWorkspaceAuditRecords
} from '../../control-plane/src/observability-audit-query.mjs';

export function listConsoleAuditRoutes() {
  return listAuditQueryRoutes();
}

export function buildConsoleAuditExplorer(options = {}) {
  return buildAuditExplorerView(options);
}

export function previewTenantAuditQuery(context = {}, params = {}) {
  return queryTenantAuditRecords(context, params);
}

export function previewWorkspaceAuditQuery(context = {}, params = {}) {
  return queryWorkspaceAuditRecords(context, params);
}
