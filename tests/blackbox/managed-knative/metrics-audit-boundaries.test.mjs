/**
 * Observable metrics/audit boundary regressions for issue #933.
 *
 * Exercises only exported metrics rendering and the established public metrics
 * handler seam. No private state or implementation helpers are inspected.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import * as controlMetrics from '../../../apps/control-plane/metrics-registry.mjs';
import * as executorMetrics from '../../../apps/control-plane-executor/src/runtime/metrics-registry.mjs';
import { METRICS_HANDLERS } from '../../../apps/control-plane/metrics-handlers.mjs';

const SENTINELS = [
  'ten-secret-933',
  'wrk-secret-933',
  'fn-secret-933',
  'mcp-secret-933',
  'corr-secret-933',
  'actor-secret-933',
];

function recordResourceBearingRequests(registry) {
  for (let index = 0; index < 24; index += 1) {
    registry.recordHttp({
      method: 'GET',
      route: `/v1/functions/actions/f${index}`,
      status: 200,
      durationSeconds: 0.001,
      tenantId: SENTINELS[0],
      workspaceId: SENTINELS[1],
      resourceId: SENTINELS[2],
      correlationId: SENTINELS[4],
      actorId: SENTINELS[5],
    });
  }
  registry.recordHttp({
    method: 'POST',
    route: `/v1/mcp/workspaces/${SENTINELS[1]}/servers/${SENTINELS[3]}`,
    status: 503,
    durationSeconds: 0.001,
    tenantId: SENTINELS[0],
    workspaceId: SENTINELS[1],
    resourceId: SENTINELS[3],
    correlationId: SENTINELS[4],
    actorId: SENTINELS[5],
  });
}

function routeLabels(rendered) {
  return new Set([...rendered.matchAll(/\broute="([^"]+)"/g)].map((match) => match[1]));
}

/**
 * bbx-933-metrics-nondisclosure-23 | fn-knative-secret-safe-observability
 * OpenSpec #### Scenario: Adjacent tenant cannot use dependency status to enumerate workloads
 * OpenSpec #### Scenario: Adjacent tenant learns no hosted-server state
 */
test('bbx-933-metrics-nondisclosure-23: /metrics exposes no tenant-controlled or correlation identifiers', () => {
  for (const registry of [controlMetrics, executorMetrics]) {
    recordResourceBearingRequests(registry);
    const rendered = registry.renderMetrics();

    for (const sentinel of SENTINELS) {
      assert.equal(rendered.includes(sentinel), false, `Prometheus output leaked ${sentinel}`);
    }
    for (const forbiddenLabel of ['tenant_id', 'workspace_id', 'resource_id', 'function_id', 'server_id', 'correlation_id', 'actor_id']) {
      assert.equal(rendered.includes(`${forbiddenLabel}=`), false, `Prometheus output exposed ${forbiddenLabel}`);
    }
  }
});

/**
 * bbx-933-metrics-cardinality-24 | fn-knative-secret-safe-observability
 * OpenSpec #### Scenario: Unavailable deploy has correlated evidence
 * OpenSpec #### Scenario: Hosted-server outage is correlated without secrets
 */
test('bbx-933-metrics-cardinality-24: resource-bearing HTTP paths collapse to bounded route templates', () => {
  for (const registry of [controlMetrics, executorMetrics]) {
    recordResourceBearingRequests(registry);
    const labels = routeLabels(registry.renderMetrics());
    assert.ok(labels.has('/v1/functions/actions/:id'), `missing bounded Function route in ${JSON.stringify([...labels])}`);
    assert.ok(labels.has('/v1/mcp/workspaces/:id/servers/:id'), `missing bounded MCP route in ${JSON.stringify([...labels])}`);
    assert.ok(labels.size <= 2, `expected at most two bounded route series, got ${labels.size}`);
  }
});

const WS_A = {
  id: 'wrk_a', tenant_id: 'ten_a', slug: 'app', display_name: 'App', status: 'active', environment: 'staging',
};

function fakePool() {
  return {
    async query(sql, params = []) {
      if (sql.includes('FROM workspaces')) return { rows: params[0] === WS_A.id ? [WS_A] : [] };
      return { rows: [] };
    },
    async connect() { return { query: this.query.bind(this), release() {} }; },
  };
}

function identity({ trustKind, role, tenantId = null, workspaceId = null }) {
  return {
    sub: `${trustKind}-${role}`,
    tenantId,
    workspaceId,
    actorType: 'internal',
    roles: [role],
    scopes: [],
    trustKind,
  };
}

function ctx(actor, params, query = {}) {
  return {
    pool: fakePool(),
    params,
    query,
    body: {},
    identity: actor,
    callerContext: {
      actor: { id: actor.sub, type: actor.actorType },
      tenantId: actor.tenantId,
      workspaceId: actor.workspaceId,
      trustKind: actor.trustKind,
    },
  };
}

/**
 * bbx-933-metrics-trust-25 | fn-knative-secret-safe-observability
 * OpenSpec #### Scenario: Read-only status does not grant mutation
 * OpenSpec #### Scenario: Lifecycle mutation is audited without secrets
 */
test('bbx-933-metrics-trust-25: platform-trusted operators/auditors can read metrics and audit, copied tenant-realm roles cannot', async () => {
  for (const role of ['platform_operator', 'platform_auditor']) {
    const platformActor = identity({ trustKind: 'platform', role });
    for (const handlerName of ['metricsTenantQuotas', 'metricsTenantAudit']) {
      const allowed = await METRICS_HANDLERS[handlerName](ctx(platformActor, { tenantId: 'ten_a' }));
      assert.equal(allowed.statusCode, 200, `${role} ${handlerName}: ${JSON.stringify(allowed.body)}`);
    }

    const copiedTenantActor = identity({
      trustKind: 'tenant', role, tenantId: 'ten_b', workspaceId: 'wrk_b',
    });
    for (const handlerName of ['metricsTenantQuotas', 'metricsTenantAudit']) {
      const denied = await METRICS_HANDLERS[handlerName](ctx(copiedTenantActor, { tenantId: 'ten_a' }));
      assert.equal(denied.statusCode, 403, `${role} copied into a tenant realm must not cross scope`);
    }
  }
});

/**
 * bbx-933-metrics-scope-26 | fn-knative-secret-safe-observability
 * OpenSpec #### Scenario: Adjacent tenant cannot use dependency status to enumerate workloads
 */
test('bbx-933-metrics-scope-26: tenant-scoped series rejects a platform-global aggregate metric key', async () => {
  const tenantActor = identity({
    trustKind: 'tenant', role: 'workspace_viewer', tenantId: 'ten_a', workspaceId: WS_A.id,
  });
  const response = await METRICS_HANDLERS.metricsWorkspaceSeries(ctx(
    tenantActor,
    { workspaceId: WS_A.id },
    { metricKey: 'falcone_http_requests_total', window: '1h' },
  ));
  assert.ok(
    [400, 403].includes(response.statusCode),
    `global aggregate series must be rejected, got ${response.statusCode} (${JSON.stringify(response.body)})`,
  );
});
