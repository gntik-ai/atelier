/**
 * Black-box regression suite for spec change fix-metrics-quotas-500
 * (live E2E campaign 2026-06-17, finding F4).
 *
 * Drives the control-plane runtime schema setup and the console metrics handlers
 * (apps/control-plane/{tenant-store,metrics-handlers}.mjs) through their public interface.
 * Deterministic: a recording fake pool captures the DDL and a fake pool drives the handler; no
 * live database is required.
 *
 * Defect: GET /v1/metrics/tenants/{id}/quotas 500'd. tenantLimits() delegated to the real
 * tenant-effective-entitlements action, whose quantitative query read quota_dimension_catalog /
 * quota_overrides / plans.quota_type_config (none provisioned in this runtime → 42P01) and whose
 * stricter actor-type allow-list threw FORBIDDEN for an authorized same-tenant non-owner — either
 * bubbled to a 500. workspaceLimits() already degraded gracefully; tenantLimits() did not.
 *
 * Fix: (1) ensureSchema provisions quota_dimension_catalog + quota_overrides and adds
 * plans.quota_type_config (mirroring migrations 098/103), so the entitlements query resolves real
 * limits; (2) tenantLimits() degrades to an empty (healthy) posture on any error, like
 * workspaceLimits(), so the Quotas page returns 200 instead of 500.
 *
 * (Verified against the real tests/env Postgres: the entitlements action resolves a real
 * effectiveValue post-schema with no 42P01; the handler returns 200 in every case.)
 *
 * Scenario coverage (capability: tenant-lifecycle / spec.md):
 *   bbx-f4-01  ensureSchema provisions the quota catalog/override relations + plans.quota_type_config
 *   bbx-f4-02  metrics quotas/overview/usage return 200 and degrade gracefully (never 500)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureSchema } from '../../apps/control-plane/tenant-store.mjs';
import { METRICS_HANDLERS } from '../../apps/control-plane/metrics-handlers.mjs';

/** Fake pool that records every SQL string. ensureSchema issues only DDL/UPDATE (reads no rows). */
function recordingPool() {
  const sql = [];
  return { sql, query: async (text) => { sql.push(String(text)); return { rows: [] }; } };
}

/** Fake pool for the handler: connect() yields a releasable client. The handler's entitlements
 *  import (an image-only /repo path) fails to resolve locally, exercising the graceful path. */
function handlerPool() {
  const query = async (sql, params = []) => {
    if (/\bFROM\s+tenants\b/i.test(String(sql))) {
      return {
        rows: params[0] === 'tnt_a' ? [{
          id: 'tnt_a',
          slug: 'tenant-a',
          display_name: 'Tenant A',
          status: 'active',
          iam_realm: 'tenant-a',
          created_at: '2026-06-17T00:00:00.000Z',
          created_by: 'blackbox'
        }] : []
      };
    }
    return { rows: [] };
  };
  return { query, connect: async () => ({ query, release() {} }) };
}

// -------------------------------------------------------------------------
// bbx-f4-01: the runtime schema setup provisions the quota relations
// -------------------------------------------------------------------------
test('bbx-f4-01: ensureSchema provisions quota_dimension_catalog/overrides + plans.quota_type_config', async () => {
  const pool = recordingPool();
  await ensureSchema(pool);
  const joined = pool.sql.join('\n;;\n');

  assert.match(joined, /CREATE TABLE IF NOT EXISTS\s+quota_dimension_catalog\b/i, 'must create quota_dimension_catalog');
  assert.match(joined, /CREATE TABLE IF NOT EXISTS\s+quota_overrides\b/i, 'must create quota_overrides');
  // the entitlements quantitative query reads plans.quota_type_config
  assert.match(joined, /ALTER TABLE plans ADD COLUMN IF NOT EXISTS quota_type_config\b/i, 'must add plans.quota_type_config');
  // quota_overrides keys to the catalog dimension
  assert.match(joined, /dimension_key[\s\S]*REFERENCES quota_dimension_catalog\(dimension_key\)/i, 'quota_overrides must FK the catalog dimension');
});

// -------------------------------------------------------------------------
// bbx-f4-02: the quotas/overview/usage endpoints return 200 and never 500
// -------------------------------------------------------------------------
test('bbx-f4-02: metrics quotas/overview/usage return 200 and degrade gracefully', async () => {
  // server.mjs always injects ctx.identity (from the verified JWT) on authenticated
  // routes; an authorized same-tenant operator reaches the handler and degrades to 200.
  const ctx = {
    pool: handlerPool(),
    identity: { sub: 'u', actorType: 'tenant_admin', tenantId: 'tnt_a', roles: ['tenant_admin'], scopes: [] },
    callerContext: { actor: { id: 'u', type: 'tenant_admin', tenantId: 'tnt_a' } },
    params: { tenantId: 'tnt_a' },
  };

  const q = await METRICS_HANDLERS.metricsTenantQuotas(ctx);
  assert.equal(q.statusCode, 200, 'quotas must return 200 (was 500 when the inner path errored)');
  assert.ok(Array.isArray(q.body.dimensions), 'quotas body carries a dimensions array');
  assert.deepEqual(q.body.hardLimitBreaches, [], 'an unavailable limits source has no breaches');

  const o = await METRICS_HANDLERS.metricsTenantOverview(ctx);
  assert.equal(o.statusCode, 200, 'overview must return 200');
  assert.equal(o.body.overallPosture, 'evidence_unavailable', 'degraded posture is reported honestly');

  const u = await METRICS_HANDLERS.metricsTenantUsage(ctx);
  assert.equal(u.statusCode, 200, 'usage must return 200');
  assert.ok(Array.isArray(u.body.dimensions), 'usage body carries a dimensions array');
});
