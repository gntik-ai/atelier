import { get, put } from '../lib/http-client.mjs';
import { waitForAuditEvent } from '../lib/audit-verifier.mjs';
import { recordResult } from '../lib/reporter.mjs';

function resultBase(id, name, status, extras = {}) {
  return {
    id,
    name,
    suite: 'scope-enforcement',
    category: 'scopes',
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

async function execute(id, name, fn, meta) {
  const startedAt = Date.now();
  try {
    const extras = await fn();
    recordResult(resultBase(id, name, extras.status, { ...meta, ...extras, durationMs: Date.now() - startedAt }));
  } catch (error) {
    recordResult(resultBase(id, name, 'fail', { ...meta, durationMs: Date.now() - startedAt, error: error.message }));
  }
}

export async function runScopeEnforcementSuite({ fixture, environment }) {
  if (!environment.scopeEnforcement) {
    for (const [id, name] of [
      ['SE-01', 'insufficient scope (read→write) is denied'],
      ['SE-02', 'wrong sub-domain scope (invoke→deploy) is denied'],
      ['SE-03', 'scope removed from requirements → fail-closed'],
      ['SE-04', 'endpoint with no scope requirement → fail-closed'],
      ['SE-05', 'correct scope grants access'],
      ['SE-06', 'scope enforcement disabled → tests skipped'],
    ]) {
      recordResult(resultBase(id, name, 'skip', { skipReason: 'enforcement-disabled', severity: 'P1' }));
    }
    return;
  }

  await execute('SE-01', 'insufficient scope (read→write) is denied', async () => {
    const headers = { Authorization: `Bearer ${fixture.credentials.storageReadOnly}` };
    const response = await put(`/v1/storage/buckets/${fixture.workspaceId}`, { headers, body: { name: `hardening-${fixture.runId}` } });
    const audit = await waitForAuditEvent({ pgTable: 'scope_enforcement_denials', filter: { actorId: fixture.workspaceId, endpointPath: `/v1/storage/buckets/${fixture.workspaceId}` } });
    return { status: response.status === 403 && audit.found ? 'pass' : 'fail', method: 'PUT', path: `/v1/storage/buckets/${fixture.workspaceId}`, headers, expectedHttpStatus: 403, actualHttpStatus: response.status, auditEventExpected: 'scope-denied', auditEventObserved: audit.found };
  });

  await execute('SE-02', 'wrong sub-domain scope (invoke→deploy) is denied', async () => {
    const headers = { Authorization: `Bearer ${fixture.credentials.functionsInvokeOnly}` };
    const response = await put(`/v1/functions/${fixture.workspaceId}`, { headers, body: { image: 'ghcr.io/in-atelier/test:latest' } });
    const audit = await waitForAuditEvent({ pgTable: 'scope_enforcement_denials', filter: { actorId: fixture.workspaceId, endpointPath: `/v1/functions/${fixture.workspaceId}` } });
    return { status: response.status === 403 && audit.found ? 'pass' : 'fail', method: 'PUT', path: `/v1/functions/${fixture.workspaceId}`, headers, expectedHttpStatus: 403, actualHttpStatus: response.status, auditEventExpected: 'scope-denied', auditEventObserved: audit.found };
  });

  await execute('SE-03', 'scope removed from requirements → fail-closed', async () => {
    const headers = { Authorization: `Bearer ${process.env.SUPERADMIN_TOKEN}` };
    const response = await put('/v1/admin/security/endpoint-scope-requirements/test-storage-bucket', { headers, body: { scopes: [] } });
    const denied = await get('/v1/test/unscoped-endpoint', { headers: { Authorization: `Bearer ${fixture.credentials.storageReadWrite}` } });
    const audit = await waitForAuditEvent({ pgTable: 'scope_enforcement_denials', filter: { denialReason: 'config-error' } });
    return { status: response.status < 300 && denied.status === 403 && audit.found ? 'pass' : 'fail', method: 'GET', path: '/v1/test/unscoped-endpoint', headers: { Authorization: 'Bearer ***' }, expectedHttpStatus: 403, actualHttpStatus: denied.status, auditEventExpected: 'config-error', auditEventObserved: audit.found };
  });

  await execute('SE-04', 'endpoint with no scope requirement → fail-closed', async () => {
    const headers = { Authorization: `Bearer ${fixture.credentials.storageReadWrite}` };
    const response = await get('/v1/test/unregistered-scope-endpoint', { headers });
    const audit = await waitForAuditEvent({ pgTable: 'scope_enforcement_denials', filter: { denialReason: 'config-error' } });
    return { status: response.status === 403 && audit.found ? 'pass' : 'fail', method: 'GET', path: '/v1/test/unregistered-scope-endpoint', headers, expectedHttpStatus: 403, actualHttpStatus: response.status, auditEventExpected: 'config-error', auditEventObserved: audit.found };
  });

  await execute('SE-05', 'correct scope grants access', async () => {
    const headers = { Authorization: `Bearer ${fixture.credentials.storageReadWrite}` };
    const response = await put(`/v1/storage/buckets/${fixture.workspaceId}`, { headers, body: { name: `hardening-${fixture.runId}` } });
    return { status: response.status === 200 ? 'pass' : 'fail', method: 'PUT', path: `/v1/storage/buckets/${fixture.workspaceId}`, headers, expectedHttpStatus: 200, actualHttpStatus: response.status };
  });

  recordResult(resultBase('SE-06', 'scope enforcement disabled → tests skipped', 'skip', { skipReason: 'enforcement-disabled' }));
}
