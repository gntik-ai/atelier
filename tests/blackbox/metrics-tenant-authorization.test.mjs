/**
 * Black-box tests for cross-tenant metrics authorization in the control-plane
 * metrics routes (fix-metrics-tenant-authorization, P0 ISO-METRICS).
 *
 * The bug: /v1/metrics/{tenants|workspaces}/{id}/* accepted ANY id, so a tenant
 * operator could read another tenant's quotas/overview/usage/series/audit, and
 * even a non-existent id returned 200. The fix applies the own-tenant guard
 * (tenant owners/admins → their own tenant only; superadmin/internal → any).
 *
 * Drives the public METRICS_HANDLERS interface only. The inner limit loaders
 * import /repo/* modules absent in the black-box env and degrade to empty (200),
 * so own-tenant positives are 200-with-empty; cross-tenant is rejected first.
 *
 * bbx-metrics-authz-01: tenant B reads tenant A quotas → 403
 * bbx-metrics-authz-02: tenant B reads tenant A overview/usage/series/audit → 403
 * bbx-metrics-authz-03: tenant operator reads a non-existent tenant id → 403 (was 200)
 * bbx-metrics-authz-04: tenant B reads tenant A WORKSPACE metrics → 403
 * bbx-metrics-authz-05: tenant A reads its own tenant metrics → 200
 * bbx-metrics-authz-06: tenant A reads its own workspace metrics → 200
 * bbx-metrics-authz-07: superadmin reads any tenant's metrics → 200
 * bbx-metrics-authz-08: unknown workspace id → 404
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { METRICS_HANDLERS } from '../../apps/control-plane/metrics-handlers.mjs';

const TENANTS = {
  'tenant-a': { id: 'tenant-a', slug: 'tenant-a', display_name: 'Tenant A', status: 'active' },
  'tenant-b': { id: 'tenant-b', slug: 'tenant-b', display_name: 'Tenant B', status: 'active' }
};
const WS_A = { id: 'ws-a', tenant_id: 'tenant-a', slug: 'app-staging', display_name: 'App Staging', status: 'active', environment: 'staging' };

function fakePool() {
  const query = async (sql, params = []) => {
    if (sql.includes('FROM tenants')) {
      return { rows: TENANTS[params[0]] ? [TENANTS[params[0]]] : [] };
    }
    if (sql.includes('FROM workspaces')) {
      return { rows: params[0] === 'ws-a' ? [WS_A] : [] };
    }
    return { rows: [] };
  };
  return { query, connect: async () => ({ query, release() {} }) };
}

const IDENTITY_A = { sub: 'user-a', tenantId: 'tenant-a', workspaceId: 'ws-a', actorType: 'tenant_owner', roles: ['tenant_owner'], scopes: [] };
const IDENTITY_B = { sub: 'user-b', tenantId: 'tenant-b', workspaceId: 'ws-b', actorType: 'tenant_owner', roles: ['tenant_owner'], scopes: [] };
const IDENTITY_SA = { sub: 'sa', tenantId: null, workspaceId: null, actorType: 'superadmin', roles: ['superadmin'], scopes: [] };

function ctx(identity, params = {}) {
  return { pool: fakePool(), params, query: {}, body: {}, identity, callerContext: { actor: { id: identity.sub, type: identity.actorType }, tenantId: identity.tenantId } };
}

test('bbx-metrics-authz-01: tenant B → tenant A quotas → 403', async () => {
  const r = await METRICS_HANDLERS.metricsTenantQuotas(ctx(IDENTITY_B, { tenantId: 'tenant-a' }));
  assert.equal(r.statusCode, 403, `got ${r.statusCode} (${JSON.stringify(r.body)})`);
});

test('bbx-metrics-authz-02: tenant B → tenant A overview/usage/series/audit → 403', async () => {
  for (const h of ['metricsTenantOverview', 'metricsTenantUsage', 'metricsTenantSeries', 'metricsTenantAudit']) {
    const r = await METRICS_HANDLERS[h](ctx(IDENTITY_B, { tenantId: 'tenant-a' }));
    assert.equal(r.statusCode, 403, `${h}: got ${r.statusCode} (${JSON.stringify(r.body)})`);
  }
});

test('bbx-metrics-authz-03: tenant operator → non-existent tenant id → 403 (not 200)', async () => {
  const r = await METRICS_HANDLERS.metricsTenantQuotas(ctx(IDENTITY_A, { tenantId: 'tenant-does-not-exist' }));
  assert.equal(r.statusCode, 403, `got ${r.statusCode} (${JSON.stringify(r.body)})`);
});

test('bbx-metrics-authz-04: tenant B → tenant A workspace metrics → 403', async () => {
  const r = await METRICS_HANDLERS.metricsWorkspaceSeries(ctx(IDENTITY_B, { workspaceId: 'ws-a' }));
  assert.equal(r.statusCode, 403, `got ${r.statusCode} (${JSON.stringify(r.body)})`);
});

test('bbx-metrics-authz-05: tenant A → own tenant metrics → 200', async () => {
  const r = await METRICS_HANDLERS.metricsTenantQuotas(ctx(IDENTITY_A, { tenantId: 'tenant-a' }));
  assert.equal(r.statusCode, 200, `got ${r.statusCode} (${JSON.stringify(r.body)})`);
});

test('bbx-metrics-authz-06: tenant A → own workspace metrics → 200', async () => {
  const r = await METRICS_HANDLERS.metricsWorkspaceQuotas(ctx(IDENTITY_A, { workspaceId: 'ws-a' }));
  assert.equal(r.statusCode, 200, `got ${r.statusCode} (${JSON.stringify(r.body)})`);
});

test('bbx-metrics-authz-07: superadmin → any tenant metrics → 200', async () => {
  const r = await METRICS_HANDLERS.metricsTenantQuotas(ctx(IDENTITY_SA, { tenantId: 'tenant-b' }));
  assert.equal(r.statusCode, 200, `got ${r.statusCode} (${JSON.stringify(r.body)})`);
});

test('bbx-metrics-authz-08: unknown workspace id → 404', async () => {
  const r = await METRICS_HANDLERS.metricsWorkspaceQuotas(ctx(IDENTITY_SA, { workspaceId: 'ws-unknown' }));
  assert.equal(r.statusCode, 404, `got ${r.statusCode} (${JSON.stringify(r.body)})`);
});
