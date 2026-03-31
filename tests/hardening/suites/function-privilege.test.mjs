import { post, put } from '../lib/http-client.mjs';
import { waitForAuditEvent, waitForKafkaEvent } from '../lib/audit-verifier.mjs';
import { recordResult } from '../lib/reporter.mjs';

function makeResult(id, name, status, extras = {}) {
  return {
    id,
    name,
    suite: 'function-privilege',
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

async function waitForPrivilegeEvent(filter) {
  const pgResult = await waitForAuditEvent({ pgTable: 'privilege_domain_denials', filter });
  if (pgResult.found) return pgResult;
  return waitForKafkaEvent({ topic: 'console.security.privilege-domain-denied', filter });
}

export async function runFunctionPrivilegeSuite({ fixture, environment }) {
  if (!environment.privilegeDomain) {
    for (const [id, name] of [
      ['FP-01', 'deploy-only credential cannot invoke function'],
      ['FP-02', 'invoke-only credential cannot deploy function'],
      ['FP-03', 'full-function credential can deploy and invoke'],
    ]) {
      recordResult(makeResult(id, name, 'skip', { skipReason: 'enforcement-disabled' }));
    }
    return;
  }

  await execute('FP-01', 'deploy-only credential cannot invoke function', async () => {
    const headers = { Authorization: `Bearer ${fixture.credentials.functionsDeployOnly}` };
    const response = await post(`/v1/functions/${fixture.workspaceId}/invoke`, { headers, body: { payload: { ping: true } } });
    const audit = await waitForPrivilegeEvent({ attemptedDomain: 'function_invocation' });
    return { status: response.status === 403 && audit.found ? 'pass' : 'fail', method: 'POST', path: `/v1/functions/${fixture.workspaceId}/invoke`, headers, expectedHttpStatus: 403, actualHttpStatus: response.status, auditEventExpected: 'function-privilege-denied', auditEventObserved: audit.found };
  });

  await execute('FP-02', 'invoke-only credential cannot deploy function', async () => {
    const headers = { Authorization: `Bearer ${fixture.credentials.functionsInvokeOnly}` };
    const response = await put(`/v1/functions/${fixture.workspaceId}`, { headers, body: { runtime: 'nodejs20', image: 'ghcr.io/in-atelier/test:latest' } });
    const audit = await waitForPrivilegeEvent({ attemptedDomain: 'function_deployment' });
    return { status: response.status === 403 && audit.found ? 'pass' : 'fail', method: 'PUT', path: `/v1/functions/${fixture.workspaceId}`, headers, expectedHttpStatus: 403, actualHttpStatus: response.status, auditEventExpected: 'function-privilege-denied', auditEventObserved: audit.found };
  });

  await execute('FP-03', 'full-function credential can deploy and invoke', async () => {
    const headers = { Authorization: `Bearer ${fixture.credentials.fullFunctionCredential}` };
    const deploy = await put(`/v1/functions/${fixture.workspaceId}`, { headers, body: { runtime: 'nodejs20', image: 'ghcr.io/in-atelier/test:latest' } });
    const invoke = await post(`/v1/functions/${fixture.workspaceId}/invoke`, { headers, body: { payload: { ping: true } } });
    return { status: deploy.status === 200 && invoke.status === 200 ? 'pass' : 'fail', method: 'PUT', path: `/v1/functions/${fixture.workspaceId}`, headers, expectedHttpStatus: 200, actualHttpStatus: deploy.status };
  });
}
