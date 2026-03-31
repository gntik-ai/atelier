import { get, put } from '../lib/http-client.mjs';
import { waitForAuditEvent } from '../lib/audit-verifier.mjs';
import { recordResult } from '../lib/reporter.mjs';

function makeResult(id, name, status, extras = {}) {
  return {
    id,
    name,
    suite: 'plan-restriction',
    category: 'plan',
    severity: 'P1',
    status,
    skipReason: extras.skipReason ?? null,
    request: { method: extras.method ?? 'GET', path: extras.path ?? '', headers: extras.headers ?? {} },
    expectedHttpStatus: extras.expectedHttpStatus ?? null,
    actualHttpStatus: extras.actualHttpStatus ?? null,
    auditEventExpected: extras.auditEventExpected ?? null,
    auditEventObserved: extras.auditEventObserved ?? false,
    durationMs: extras.durationMs ?? 0,
    timestamp: new Date().toISOString(),
    error: extras.error ?? null,
  };
}

async function execute(id, name, fn) {
  const startedAt = Date.now();
  try {
    const result = await fn();
    recordResult(makeResult(id, name, result.status, { ...result, durationMs: Date.now() - startedAt }));
  } catch (error) {
    recordResult(makeResult(id, name, 'fail', { error: error.message, durationMs: Date.now() - startedAt }));
  }
}

export async function runPlanRestrictionSuite({ fixture }) {
  await execute('PR-01', 'free plan cannot access enterprise endpoint', async () => {
    const headers = { Authorization: `Bearer ${fixture.credentials.freePlanToken}` };
    const response = await get('/v1/enterprise/feature', { headers });
    const audit = await waitForAuditEvent({ pgTable: 'scope_enforcement_denials', filter: { denialReason: 'plan-denied' } });
    return { status: response.status === 403 && audit.found ? 'pass' : 'fail', method: 'GET', path: '/v1/enterprise/feature', headers, expectedHttpStatus: 403, actualHttpStatus: response.status, auditEventExpected: 'plan-denied', auditEventObserved: audit.found };
  });

  await execute('PR-02', 'enterprise plan can access professional endpoint (superset)', async () => {
    const headers = { Authorization: `Bearer ${fixture.credentials.enterprisePlanToken}` };
    const response = await get('/v1/professional/feature', { headers });
    return { status: response.status === 200 ? 'pass' : 'fail', method: 'GET', path: '/v1/professional/feature', headers, expectedHttpStatus: 200, actualHttpStatus: response.status };
  });

  await execute('PR-03', 'recently downgraded tenant is denied after cache expiry', async () => {
    const adminHeaders = { Authorization: `Bearer ${process.env.SUPERADMIN_TOKEN}` };
    await put(`/v1/admin/tenants/${fixture.tenantId}/plan`, { headers: adminHeaders, body: { planTier: 'free' } });
    const headers = { Authorization: `Bearer ${fixture.credentials.enterprisePlanToken}` };
    const bypassHeader = process.env.PLAN_CACHE_BYPASS_HEADER;
    if (bypassHeader) headers[bypassHeader] = 'true';
    else await new Promise((resolve) => setTimeout(resolve, Number(process.env.SCOPE_ENFORCEMENT_PLAN_CACHE_TTL_SECONDS ?? 31) * 1000 + 1000));
    const response = await get('/v1/enterprise/feature', { headers });
    const audit = await waitForAuditEvent({ pgTable: 'scope_enforcement_denials', filter: { denialReason: 'plan-denied' } });
    return { status: response.status === 403 && audit.found ? 'pass' : 'fail', method: 'GET', path: '/v1/enterprise/feature', headers, expectedHttpStatus: 403, actualHttpStatus: response.status, auditEventExpected: 'plan-denied', auditEventObserved: audit.found };
  });

  await execute('PR-04', 'endpoint with invalid plan tier config → fail-closed', async () => {
    const adminHeaders = { Authorization: `Bearer ${process.env.SUPERADMIN_TOKEN}` };
    await put('/v1/admin/security/plan-requirements/test-invalid-plan', { headers: adminHeaders, body: { planTier: 'ultra-enterprise-max' } });
    const headers = { Authorization: `Bearer ${fixture.credentials.enterprisePlanToken}` };
    const response = await get('/v1/test/invalid-plan-feature', { headers });
    const audit = await waitForAuditEvent({ pgTable: 'scope_enforcement_denials', filter: { denialReason: 'config-error' } });
    return { status: response.status === 403 && audit.found ? 'pass' : 'fail', method: 'GET', path: '/v1/test/invalid-plan-feature', headers, expectedHttpStatus: 403, actualHttpStatus: response.status, auditEventExpected: 'config-error', auditEventObserved: audit.found };
  });
}
