import { get, post } from '../lib/http-client.mjs';
import { waitForAuditEvent, waitForKafkaEvent } from '../lib/audit-verifier.mjs';
import { recordResult } from '../lib/reporter.mjs';

function buildResult({ id, name, status, actualHttpStatus = null, expectedHttpStatus, auditEventObserved = false, durationMs, skipReason = null, error = null, path, headers = {}, auditEventExpected = null }) {
  return {
    id,
    name,
    suite: 'secret-lifecycle',
    category: 'secrets',
    severity: 'P1',
    status,
    skipReason,
    request: { method: 'GET', path, headers },
    expectedHttpStatus,
    actualHttpStatus,
    auditEventExpected,
    auditEventObserved,
    durationMs,
    timestamp: new Date().toISOString(),
    error,
  };
}

async function runCase(definition) {
  const startedAt = Date.now();
  try {
    const result = await definition();
    return { durationMs: Date.now() - startedAt, ...result };
  } catch (error) {
    return { durationMs: Date.now() - startedAt, status: 'fail', error: error.message };
  }
}

export async function runSecretLifecycleSuite({ fixture, environment }) {
  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  {
    const outcome = await runCase(async () => {
      const response = await get('/v1/storage/buckets', { headers: auth(fixture.credentials.validApiKey) });
      return { status: response.status === 200 ? 'pass' : 'fail', actualHttpStatus: response.status };
    });
    recordResult(buildResult({ id: 'SL-01', name: 'valid API key grants access', expectedHttpStatus: 200, path: '/v1/storage/buckets', headers: auth(fixture.credentials.validApiKey), ...outcome }));
  }

  {
    const outcome = await runCase(async () => {
      const response = await get('/v1/storage/buckets', { headers: auth(fixture.credentials.rotatedOldKey) });
      const deprecated = response.headers['x-credential-deprecated'] === 'true' || response.headers.deprecation === 'true';
      return { status: response.status === 200 && deprecated ? 'pass' : 'fail', actualHttpStatus: response.status };
    });
    recordResult(buildResult({ id: 'SL-02', name: 'rotated-in-grace API key succeeds with deprecation header', expectedHttpStatus: 200, path: '/v1/storage/buckets', headers: auth(fixture.credentials.rotatedOldKey), ...outcome }));
  }

  {
    const outcome = await runCase(async () => {
      await new Promise((resolve) => setTimeout(resolve, Number(process.env.HARDENING_SECRET_GRACE_WAIT_MS ?? 1100)));
      const response = await get('/v1/storage/buckets', { headers: auth(fixture.credentials.rotatedOldKey) });
      const audit = await waitForAuditEvent({ pgTable: 'secret_version_states', filter: { secretPath: fixture.secrets.rotatedSecretPath, state: 'grace_expired' } });
      return {
        status: [401, 403].includes(response.status) && audit.found ? 'pass' : 'fail',
        actualHttpStatus: response.status,
        auditEventObserved: audit.found,
      };
    });
    recordResult(buildResult({ id: 'SL-03', name: 'post-grace API key is rejected with audit event', expectedHttpStatus: 403, path: '/v1/storage/buckets', headers: auth(fixture.credentials.rotatedOldKey), auditEventExpected: 'secret_version_states.grace_expired', ...outcome }));
  }

  {
    const outcome = await runCase(async () => {
      const response = await get('/v1/storage/buckets', { headers: auth(fixture.credentials.revokedApiKey) });
      return { status: [401, 403].includes(response.status) ? 'pass' : 'fail', actualHttpStatus: response.status };
    });
    recordResult(buildResult({ id: 'SL-04', name: 'explicitly revoked API key is rejected immediately', expectedHttpStatus: 403, path: '/v1/storage/buckets', headers: auth(fixture.credentials.revokedApiKey), ...outcome }));
  }

  {
    const outcome = await runCase(async () => {
      const response = await post('/v1/webhooks/deliveries/test', {
        headers: { 'X-Hub-Signature-256': fixture.credentials.rotatedOldKey },
        body: { webhookSigningSecretId: fixture.secrets.webhookSigningSecretId, event: 'hardening.delivery' },
      });
      return { status: response.status >= 400 && response.status < 500 ? 'pass' : 'fail', actualHttpStatus: response.status };
    });
    recordResult(buildResult({ id: 'SL-05', name: 'webhook signing secret post-grace fails delivery validation', expectedHttpStatus: 401, path: '/v1/webhooks/deliveries/test', headers: {}, ...outcome }));
  }

  if (!environment.vaultReachable) {
    recordResult(buildResult({ id: 'SL-06', name: 'Vault credential post-grace is rejected', status: 'skip', expectedHttpStatus: 403, path: '/v1/storage/buckets', skipReason: 'infrastructure-unavailable', durationMs: 0, auditEventExpected: 'secret_version_states.revoked' }));
  } else {
    const outcome = await runCase(async () => {
      const response = await get('/v1/storage/buckets', { headers: auth(fixture.credentials.rotatedOldKey) });
      const audit = await waitForKafkaEvent({ topic: 'console.secrets.rotation.revoked', filter: { secretPath: fixture.secrets.rotatedSecretPath } });
      return {
        status: [401, 403].includes(response.status) && audit.found ? 'pass' : 'fail',
        actualHttpStatus: response.status,
        auditEventObserved: audit.found,
      };
    });
    recordResult(buildResult({ id: 'SL-06', name: 'Vault credential post-grace is rejected', expectedHttpStatus: 403, path: '/v1/storage/buckets', headers: auth(fixture.credentials.rotatedOldKey), auditEventExpected: 'console.secrets.rotation.revoked', ...outcome }));
  }
}
