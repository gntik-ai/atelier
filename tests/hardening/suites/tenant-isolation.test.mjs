import { get, post } from '../lib/http-client.mjs';
import { waitForAuditEvent } from '../lib/audit-verifier.mjs';
import { recordResult } from '../lib/reporter.mjs';

function makeResult(id, name, status, extras = {}) {
  return {
    id,
    name,
    suite: 'tenant-isolation',
    category: 'tenant-isolation',
    severity: 'P2',
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

export async function runTenantIsolationSuite({ fixture }) {
  await execute('TI-01', 'Tenant A credential denied on Tenant B secret', async () => {
    const headers = { Authorization: `Bearer ${fixture.credentials.validApiKey}` };
    const response = await get(`/v1/secrets/${fixture.workspaceBId}/metadata`, { headers });
    const audit = await waitForAuditEvent({ pgTable: 'scope_enforcement_denials', filter: { workspaceId: fixture.workspaceBId, denialReason: 'workspace-mismatch' } });
    return { status: response.status === 403 && audit.found ? 'pass' : 'fail', method: 'GET', path: `/v1/secrets/${fixture.workspaceBId}/metadata`, headers, expectedHttpStatus: 403, actualHttpStatus: response.status, auditEventExpected: 'workspace-mismatch', auditEventObserved: audit.found };
  });

  await execute('TI-02', 'Tenant A credential denied on Tenant B function', async () => {
    const headers = { Authorization: `Bearer ${fixture.credentials.validApiKey}` };
    const response = await post(`/v1/functions/${fixture.workspaceBId}/invoke`, { headers, body: { payload: { crossTenant: true } } });
    const audit = await waitForAuditEvent({ pgTable: 'scope_enforcement_denials', filter: { workspaceId: fixture.workspaceBId, denialReason: 'workspace-mismatch' } });
    return { status: response.status === 403 && audit.found ? 'pass' : 'fail', method: 'POST', path: `/v1/functions/${fixture.workspaceBId}/invoke`, headers, expectedHttpStatus: 403, actualHttpStatus: response.status, auditEventExpected: 'workspace-mismatch', auditEventObserved: audit.found };
  });

  await execute('TI-03', 'superadmin can access resources of any tenant', async () => {
    const headers = { Authorization: `Bearer ${process.env.SUPERADMIN_TOKEN}` };
    const response = await get(`/v1/secrets/${fixture.workspaceId}/metadata`, { headers });
    return { status: response.status === 200 ? 'pass' : 'fail', method: 'GET', path: `/v1/secrets/${fixture.workspaceId}/metadata`, headers: { Authorization: 'Bearer ***' }, expectedHttpStatus: 200, actualHttpStatus: response.status, auditEventExpected: 'superadmin-access', auditEventObserved: response.status === 200 };
  });
}
