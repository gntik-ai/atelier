// Unit tests for MCP observability + audit shaping (change add-mcp-observability-audit, #398).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mcpToolCallTelemetry, mcpAuditEvent, buildTenantScopedMcpAuditQuery, filterAuditRecordsForTenant,
} from './mcp-observability.mjs';

const call = { tenantId: 'ten-a', workspaceId: 'ws-1', serverId: 'srv_acme', toolName: 'list_orders', oauthClientId: 'oac_123', latencyMs: 42, status: 'success' };

const COUNTER_LABEL_KEYS = [
  'collection_mode', 'domain', 'environment', 'feature_area', 'metric_scope', 'metric_type',
  'oauth_client', 'operation_family', 'server', 'status_class', 'subsystem', 'tenant_id',
  'tool_name', 'workspace_id',
];
const HISTOGRAM_LABEL_KEYS = [
  'collection_mode', 'environment', 'metric_scope', 'oauth_client', 'operation', 'server',
  'status_class', 'subsystem', 'tenant_id', 'tool_name', 'workspace_id',
];

test('mcpToolCallTelemetry: tool-call metric attributed to tenant/workspace/server/tool/oauth-client', () => {
  const { metric, latency } = mcpToolCallTelemetry(call);
  assert.equal(metric.name, 'in_falcone_mcp_tool_invocations_total');
  assert.equal(metric.kind, 'counter');
  assert.equal(metric.value, 1);
  assert.deepEqual(metric.labels, {
    environment: 'production', subsystem: 'mcp', metric_scope: 'workspace',
    collection_mode: 'push', tenant_id: 'ten-a', workspace_id: 'ws-1', server: 'srv_acme',
    tool_name: 'list_orders', oauth_client: 'oac_123', status_class: 'success',
    domain: 'mcp_tool_usage', metric_type: 'usage', feature_area: 'mcp',
    operation_family: 'execute',
  });
  assert.deepEqual(Object.keys(metric.labels).sort(), COUNTER_LABEL_KEYS);
  assert.deepEqual(Object.keys(latency.labels).sort(), HISTOGRAM_LABEL_KEYS);
});

test('mcpToolCallTelemetry: latency rides the normalized component-latency family (subsystem=mcp)', () => {
  const { latency } = mcpToolCallTelemetry(call);
  assert.equal(latency.name, 'in_falcone_component_operation_duration_seconds');
  assert.equal(latency.kind, 'histogram');
  assert.equal(latency.labels.operation, 'tool_call');
  assert.equal(latency.labels.subsystem, 'mcp');
  assert.equal(latency.observedSeconds, 0.042);
});

test('mcpToolCallTelemetry: emits a structured log line with the call attribution', () => {
  const { log } = mcpToolCallTelemetry(call);
  assert.equal(log.message, 'mcp.tool_call');
  assert.deepEqual(
    { tenant: log.tenant_id, server: log.server, tool: log.tool, oauth: log.oauth_client, ms: log.latency_ms, status: log.status },
    { tenant: 'ten-a', server: 'srv_acme', tool: 'list_orders', oauth: 'oac_123', ms: 42, status: 'success' }
  );
});

test('mcpToolCallTelemetry: never carries a forbidden (PII/high-cardinality) label', () => {
  // Extra inputs cannot smuggle labels; the helper emits only its exact fixed allowlist.
  const { metric, latency } = mcpToolCallTelemetry({
    ...call,
    user_id: 'usr-secret', request_id: 'req-secret', session_id: 'session-secret',
    email: 'person@example.test', api_key_id: 'key-secret', raw_path: '/private',
    raw_query: 'token=secret', arguments: { secret: 'value' }, result: 'private result',
  });
  for (const labels of [metric.labels, latency.labels]) {
    for (const forbidden of ['user_id', 'request_id', 'session_id', 'raw_path', 'raw_query', 'object_key', 'email', 'api_key_id', 'arguments', 'result', 'error', 'token', 'secret']) {
      assert.equal(forbidden in labels, false);
    }
  }
});

test('mcpToolCallTelemetry: accepts only the internal success/error/denied outcome enum', () => {
  assert.equal(mcpToolCallTelemetry(call).metric.labels.status_class, 'success');
  assert.equal(mcpToolCallTelemetry({ ...call, status: 'denied' }).metric.labels.status_class, 'denied');
  assert.equal(mcpToolCallTelemetry({ ...call, status: 'error' }).metric.labels.status_class, 'error');
  for (const status of [undefined, 'ok', 'succeeded', 'failed', 'timeout', 'forbidden', 'unauthorized']) {
    assert.throws(() => mcpToolCallTelemetry({ ...call, status }), /exactly success, error, or denied/);
  }
});

test('mcpToolCallTelemetry: rejects a call with no verified tenant/workspace scope (never platform)', () => {
  assert.throws(() => mcpToolCallTelemetry({ ...call, tenantId: undefined, workspaceId: undefined }), /verified tenant scope/);
  assert.throws(() => mcpToolCallTelemetry({ ...call, tenantId: undefined }), /verified tenant scope/);

  const { metric, latency } = mcpToolCallTelemetry({ ...call, workspaceId: undefined, oauthClientId: undefined });
  assert.equal(metric.labels.metric_scope, 'tenant');
  assert.equal(latency.labels.metric_scope, 'tenant');
  for (const labels of [metric.labels, latency.labels]) {
    assert.equal('workspace_id' in labels, false);
    assert.equal('oauth_client' in labels, false);
    assert.notEqual(labels.metric_scope, 'platform');
  }
});

test('mcpToolCallTelemetry: rejects incomplete attribution and invalid observations', () => {
  assert.throws(() => mcpToolCallTelemetry({ ...call, serverId: '' }), /canonical server id/);
  assert.throws(() => mcpToolCallTelemetry({ ...call, toolName: '' }), /canonical tool name/);
  assert.equal(mcpToolCallTelemetry({ ...call, environment: 'test' }).metric.labels.environment, 'test');
  assert.equal(mcpToolCallTelemetry({ ...call, environment: 'staging' }).latency.labels.environment, 'staging');
  for (const environment of ['', ' leading', 'has space', 'x'.repeat(65), 'line\nbreak']) {
    assert.throws(() => mcpToolCallTelemetry({ ...call, environment }), /bounded environment/);
  }
  for (const latencyMs of [NaN, Infinity, -1, '42']) {
    assert.throws(() => mcpToolCallTelemetry({ ...call, latencyMs }), /finite and non-negative/);
  }
});

test('mcpAuditEvent: per-OAuth-client event for the mcp subsystem, tenant-scoped', () => {
  const ev = mcpAuditEvent({ tenantId: 'ten-a', workspaceId: 'ws-1', oauthClientId: 'oac_123', action: 'consent_granted', serverId: 'srv_acme', correlationId: 'corr_1', eventId: 'evt_1', eventTimestamp: '2026-06-13T00:00:00Z' });
  assert.equal(ev.resource.subsystem, 'mcp');
  assert.equal(ev.actor.actor_type, 'oauth_client');
  assert.equal(ev.actor.actor_id, 'oac_123');
  assert.equal(ev.scope.mode, 'tenant_workspace');
  assert.equal(ev.scope.tenant_id, 'ten-a');
  assert.equal(ev.action.category, 'access_control_modification'); // a category in the audit-event-schema
  assert.equal(ev.action.id, 'mcp.consent_granted');
  assert.equal(ev.result.outcome, 'succeeded');
  assert.equal(ev.origin.origin_surface, 'control_api');
});

test('mcpAuditEvent: maps lifecycle actions to schema categories; rejects unknown/anon', () => {
  assert.equal(mcpAuditEvent({ tenantId: 't', oauthClientId: 'c', action: 'client_registered', correlationId: 'x', eventId: 'e', eventTimestamp: 's' }).action.category, 'resource_creation');
  assert.equal(mcpAuditEvent({ tenantId: 't', oauthClientId: 'c', action: 'client_revoked', correlationId: 'x', eventId: 'e', eventTimestamp: 's' }).action.category, 'resource_deletion');
  assert.equal(mcpAuditEvent({ tenantId: 't', oauthClientId: 'c', action: 'scopes_changed', correlationId: 'x', eventId: 'e', eventTimestamp: 's' }).action.category, 'configuration_change');
  assert.throws(() => mcpAuditEvent({ tenantId: 't', oauthClientId: 'c', action: 'nope', correlationId: 'x', eventId: 'e', eventTimestamp: 's' }), /Unknown MCP audit action/);
  assert.throws(() => mcpAuditEvent({ oauthClientId: 'c', action: 'client_registered', correlationId: 'x', eventId: 'e', eventTimestamp: 's' }), /tenant scope/);
});

test('buildTenantScopedMcpAuditQuery: always pins the verified tenant + mcp subsystem', () => {
  const q = buildTenantScopedMcpAuditQuery({ tenantId: 'ten-a', oauthClientId: 'oac_123' });
  assert.equal(q.tenant_id, 'ten-a');
  assert.equal(q['filter[subsystem]'], 'mcp');
  assert.equal(q['filter[actor_id]'], 'oac_123');
  assert.throws(() => buildTenantScopedMcpAuditQuery({}), /verified tenant/);
});

test('filterAuditRecordsForTenant: cross-tenant records are never returned (isolation)', () => {
  const records = [
    { scope: { tenant_id: 'ten-a' }, action: { id: 'mcp.consent_granted' } },
    { scope: { tenant_id: 'ten-b' }, action: { id: 'mcp.client_revoked' } }, // other tenant
    { tenant_id: 'ten-a', action: { id: 'mcp.scopes_changed' } },
  ];
  const visibleToA = filterAuditRecordsForTenant(records, 'ten-a');
  assert.equal(visibleToA.length, 2);
  assert.equal(visibleToA.some((r) => (r.scope?.tenant_id ?? r.tenant_id) === 'ten-b'), false);
  assert.deepEqual(filterAuditRecordsForTenant(records, undefined), []);
});
