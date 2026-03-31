import { get, put } from '../lib/http-client.mjs';
import { waitForAuditEvent } from '../lib/audit-verifier.mjs';
import { recordResult } from '../lib/reporter.mjs';

function makeResult(id, name, status, extras = {}) {
  return {
    id,
    name,
    suite: 'privilege-domain',
    category: 'privilege-domain',
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

export async function runPrivilegeDomainSuite({ fixture, environment }) {
  if (!environment.privilegeDomain) {
    for (const [id, name] of [
      ['PD-01', 'data_access credential denied on structural_admin operation'],
      ['PD-02', 'structural_admin credential denied on data read'],
      ['PD-03', 'dual-domain credential succeeds on both domain operations'],
    ]) {
      recordResult(makeResult(id, name, 'skip', { skipReason: 'enforcement-disabled' }));
    }
    return;
  }

  await execute('PD-01', 'data_access credential denied on structural_admin operation', async () => {
    const headers = { Authorization: `Bearer ${fixture.credentials.dataAccessOnly}` };
    const response = await put(`/v1/workspaces/${fixture.workspaceId}/config`, { headers, body: { displayName: `hardening-${fixture.runId}` } });
    const audit = await waitForAuditEvent({ pgTable: 'privilege_domain_denials', filter: { attemptedDomain: 'structural_admin' } });
    return { status: response.status === 403 && audit.found ? 'pass' : 'fail', method: 'PUT', path: `/v1/workspaces/${fixture.workspaceId}/config`, headers, expectedHttpStatus: 403, actualHttpStatus: response.status, auditEventExpected: 'privilege-domain-denied', auditEventObserved: audit.found };
  });

  await execute('PD-02', 'structural_admin credential denied on data read', async () => {
    const headers = { Authorization: `Bearer ${fixture.credentials.structuralAdminOnly}` };
    const response = await get(`/v1/data/collections/${fixture.workspaceId}/items`, { headers });
    const audit = await waitForAuditEvent({ pgTable: 'privilege_domain_denials', filter: { attemptedDomain: 'data_access' } });
    return { status: response.status === 403 && audit.found ? 'pass' : 'fail', method: 'GET', path: `/v1/data/collections/${fixture.workspaceId}/items`, headers, expectedHttpStatus: 403, actualHttpStatus: response.status, auditEventExpected: 'privilege-domain-denied', auditEventObserved: audit.found };
  });

  await execute('PD-03', 'dual-domain credential succeeds on both domain operations', async () => {
    const headers = { Authorization: `Bearer ${fixture.credentials.dualDomainCredential}` };
    const update = await put(`/v1/workspaces/${fixture.workspaceId}/config`, { headers, body: { displayName: `hardening-${fixture.runId}` } });
    const read = await get(`/v1/data/collections/${fixture.workspaceId}/items`, { headers });
    return { status: update.status === 200 && read.status === 200 ? 'pass' : 'fail', method: 'PUT', path: `/v1/workspaces/${fixture.workspaceId}/config`, headers, expectedHttpStatus: 200, actualHttpStatus: update.status };
  });
}
