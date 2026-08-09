/**
 * MCP observability + audit (change: add-mcp-observability-audit, #398; epic #386).
 *
 * Pure shaping of the telemetry and audit a hosted MCP server produces, aligned with the
 * internal-contracts observability families:
 *   - mcpToolCallTelemetry: per-tool-call usage metric (in_falcone_mcp_tool_invocations_total,
 *     business domain mcp_tool_usage) + tool latency on the normalized component-latency family
 *     (in_falcone_component_operation_duration_seconds, subsystem=mcp) + a structured log line —
 *     all attributed to tenant / workspace / server / tool / oauth-client, with NO high-cardinality
 *     or PII labels (the metrics-stack forbidden-label policy).
 *   - mcpAuditEvent: a per-OAuth-client audit event for the `mcp` audit subsystem
 *     (actor, scope envelope, resource, action, result) per observability-audit-event-schema.
 *   - buildTenantScopedMcpAuditQuery / filterAuditRecordsForTenant: the audit trail is ALWAYS
 *     tenant-scoped (ADR-2) — a cross-tenant probe returns nothing.
 *
 * No I/O: the runtime/gateway emit the OTel/Prometheus signals; this module defines their shape and
 * the tenant-safe query, and is unit-tested against the contract.
 */

const SUBSYSTEM = 'mcp';
const COLLECTION_MODE = 'push';

// Labels the metrics-stack / business-metrics contracts forbid (cardinality + PII). MCP telemetry
// must never carry these; oauth_client is a bounded client *id*, which is allowed.
const FORBIDDEN_LABELS = new Set([
  'user_id', 'request_id', 'session_id', 'email', 'api_key_id', 'authorization_header',
  'raw_path', 'raw_query', 'object_key', 'workspace_slug', 'tenant_slug', 'arguments',
  'result', 'error', 'token', 'secret',
]);

const OUTCOME_CLASSES = new Set(['success', 'error', 'denied']);

function statusClass(status) {
  if (!OUTCOME_CLASSES.has(status)) {
    throw new Error('MCP telemetry status must be exactly success, error, or denied.');
  }
  return status;
}

function metricScope(tenantId, workspaceId) {
  if (!tenantId) throw new Error('MCP telemetry requires a verified tenant scope.');
  if (workspaceId) return 'workspace';
  return 'tenant';
}

function assertNoForbiddenLabels(labels) {
  for (const key of Object.keys(labels)) {
    if (FORBIDDEN_LABELS.has(key)) throw new Error(`MCP telemetry must not carry forbidden label "${key}".`);
  }
  return labels;
}

/** Drop null/undefined label values so optional tenant_id/workspace_id are simply absent. */
function compact(labels) {
  return Object.fromEntries(Object.entries(labels).filter(([, v]) => v != null && v !== ''));
}

/**
 * Build the telemetry for a single MCP tool call: a usage-counter increment, a latency observation,
 * and a structured log line — attributed to tenant/workspace/server/tool/oauth-client.
 * @param {{tenantId:string, workspaceId?:string, serverId:string, toolName:string,
 *          oauthClientId?:string, latencyMs:number, status:'success'|'error'|'denied', environment?:string}} input
 */
export function mcpToolCallTelemetry({ tenantId, workspaceId, serverId, toolName, oauthClientId, latencyMs, status, environment = 'production' } = {}) {
  const scope = metricScope(tenantId, workspaceId);
  const sc = statusClass(status);
  if (typeof serverId !== 'string' || !serverId) throw new Error('MCP telemetry requires a canonical server id.');
  if (typeof toolName !== 'string' || !toolName) throw new Error('MCP telemetry requires a canonical tool name.');
  if (typeof environment !== 'string' || !environment) throw new Error('MCP telemetry requires an environment.');
  if (!Number.isFinite(latencyMs) || latencyMs < 0) throw new Error('MCP telemetry latencyMs must be finite and non-negative.');
  const baseLabels = compact({
    environment,
    subsystem: SUBSYSTEM,
    metric_scope: scope,
    collection_mode: COLLECTION_MODE,
    tenant_id: tenantId ?? null,
    workspace_id: workspaceId ?? null,
    server: serverId,
    tool_name: toolName,
    oauth_client: oauthClientId,
    status_class: sc,
  });

  const metric = {
    name: 'in_falcone_mcp_tool_invocations_total',
    kind: 'counter',
    value: 1,
    labels: assertNoForbiddenLabels({
      ...baseLabels,
      domain: 'mcp_tool_usage',
      metric_type: 'usage',
      feature_area: SUBSYSTEM,
      operation_family: 'execute',
    }),
  };

  // Latency rides the normalized component-latency family with subsystem=mcp + bounded dimensions.
  const latency = {
    name: 'in_falcone_component_operation_duration_seconds',
    kind: 'histogram',
    observedSeconds: latencyMs / 1000,
    labels: assertNoForbiddenLabels({ ...baseLabels, operation: 'tool_call' }),
  };

  const log = {
    message: 'mcp.tool_call',
    tenant_id: tenantId ?? null,
    workspace_id: workspaceId ?? null,
    server: serverId,
    tool: toolName,
    oauth_client: oauthClientId,
    latency_ms: latencyMs,
    status: sc,
  };

  return { metric, latency, log };
}

const AUDIT_CATEGORY_BY_ACTION = {
  client_registered: 'resource_creation',
  client_revoked: 'resource_deletion',
  scopes_changed: 'configuration_change',
  consent_granted: 'access_control_modification',
  consent_revoked: 'access_control_modification',
  server_published: 'resource_creation',
  server_unpublished: 'resource_deletion',
};

/**
 * Build a per-OAuth-client MCP audit event for the `mcp` audit subsystem, conforming to
 * observability-audit-event-schema (actor / scope envelope / resource / action / result).
 * @param {{tenantId:string, workspaceId?:string, oauthClientId:string, action:string,
 *          outcome?:string, serverId?:string, correlationId:string, eventId:string,
 *          eventTimestamp:string, emittingService?:string}} input
 */
export function mcpAuditEvent({ tenantId, workspaceId, oauthClientId, action, outcome = 'succeeded', serverId, correlationId, eventId, eventTimestamp, emittingService = 'control-plane' } = {}) {
  if (!tenantId) throw new Error('MCP audit event requires a tenant scope (ADR-2).');
  const category = AUDIT_CATEGORY_BY_ACTION[action];
  if (!category) throw new Error(`Unknown MCP audit action "${action}".`);
  const mode = workspaceId ? 'tenant_workspace' : 'tenant';
  return {
    event_id: eventId,
    event_timestamp: eventTimestamp,
    actor: { actor_id: oauthClientId, actor_type: 'oauth_client' },
    scope: compact({ mode, tenant_id: tenantId, workspace_id: workspaceId ?? null }),
    resource: compact({ subsystem: SUBSYSTEM, resource_type: 'mcp_oauth_client', resource_id: oauthClientId, mcp_server_id: serverId ?? null }),
    action: { category, id: `mcp.${action}` },
    result: { outcome },
    correlation_id: correlationId,
    origin: { origin_surface: 'control_api', emitting_service: emittingService },
    detail: compact({ mcp_server_id: serverId ?? null }),
  };
}

/**
 * Build a tenant-scoped audit query for the MCP subsystem. The tenant filter is ALWAYS pinned from
 * the verified context — never from the caller's free input — so the query cannot read another
 * tenant's records. Optionally narrows to a single OAuth client.
 * @param {{tenantId:string, oauthClientId?:string, occurredAfter?:string, occurredBefore?:string}} ctx
 */
export function buildTenantScopedMcpAuditQuery({ tenantId, oauthClientId, occurredAfter, occurredBefore } = {}) {
  if (!tenantId) throw new Error('A tenant-scoped MCP audit query requires the verified tenant id.');
  return compact({
    scope: 'tenant',
    tenant_id: tenantId, // pinned — authoritative over any caller-supplied tenant
    'filter[subsystem]': SUBSYSTEM,
    'filter[actor_type]': 'oauth_client',
    'filter[actor_id]': oauthClientId ?? null,
    'filter[occurred_after]': occurredAfter ?? null,
    'filter[occurred_before]': occurredBefore ?? null,
  });
}

/**
 * Defense-in-depth: drop any record not belonging to the requesting tenant. A cross-tenant record
 * is never returned even if the upstream store mistakenly included it.
 */
export function filterAuditRecordsForTenant(records = [], tenantId) {
  if (!tenantId) return [];
  return records.filter((r) => (r?.scope?.tenant_id ?? r?.tenant_id) === tenantId);
}
