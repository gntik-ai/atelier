import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeErrorResponse } from '../../apps/shared/error-envelope.mjs';

test('canonical envelope sanitizes ids, code, details and 5xx message', () => {
  const out = normalizeErrorResponse(500, { code: 'SQLSTATE 42P01', message: 'select password from users', detail: 'https://db/internal' }, { requestId: 'bad id', correlationId: 'corr-1', resource: '/v1/workspaces/acme/items' });
  assert.equal(out.code, 'GW_CONTROL_PLANE_ERROR');
  assert.equal(out.message, 'Internal server error');
  assert.deepEqual(out.detail, {});
  assert.match(out.timestamp, /^\d{4}-\d\d-\d\dT/);
  assert.match(out.requestId, /^[0-9a-f-]{36}$/);
  assert.match(out.correlationId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(out.resource, { path: '/v1/workspaces/acme/items' });
});

test('validation detail keeps public field information', () => {
  const out = normalizeErrorResponse(400, { code: 'INVALID_INPUT', message: 'invalid', errors: [{ code: 'REQUIRED', fieldPath: 'name', nodeId: 'node-1', message: 'name is required' }] });
  assert.equal(out.code, 'GW_INVALID_INPUT');
  assert.deepEqual(out.detail, {
    reason: 'INVALID_INPUT',
    errors: [{ code: 'REQUIRED', fieldPath: 'name', nodeId: 'node-1', message: 'name is required' }],
    violations: ['name is required']
  });
});

test('legacy error field, retryability and sensitive detail values normalize safely', () => {
  const out = normalizeErrorResponse(429, {
    error: 'RATE_LIMITED',
    message: 'try again',
    retryable: true,
    requestId: 'request-source-001',
    correlationId: 'correlation-source-001',
    detail: { reason: 'safe reason', message: 'https://provider.invalid/private' }
  });
  assert.equal(out.code, 'GW_RATE_LIMITED');
  assert.equal(out.retryable, true);
  assert.notEqual(out.requestId, 'request-source-001');
  assert.notEqual(out.correlationId, 'correlation-source-001');
  assert.match(out.requestId, /^[0-9a-f-]{36}$/);
  assert.match(out.correlationId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(out.detail, { reason: 'safe reason' });
});

test('empty and storage-specific source codes use non-sensitive public fallbacks', () => {
  const empty = normalizeErrorResponse(400, { code: '', message: 'bad input' });
  assert.equal(empty.code, 'GW_CONTROL_PLANE_ERROR');
  assert.equal(empty.detail.reason, 'CONTROL_PLANE_ERROR');

  const storage = normalizeErrorResponse(400, { code: 'SQLSTATE_42P01', message: 'bad input' });
  assert.equal(storage.code, 'GW_INVALID_REQUEST');
  assert.equal(storage.detail.reason, 'INVALID_REQUEST');
  assert.doesNotMatch(JSON.stringify(storage), /SQLSTATE|42P01/i);
});

test('free-text legacy error values never become codes or detail reasons', () => {
  const tenant = normalizeErrorResponse(404, { error: "Tenant 'tenant-victim-42' not found" });
  assert.equal(tenant.code, 'GW_NOT_FOUND');
  assert.equal(tenant.detail.reason, 'NOT_FOUND');
  assert.doesNotMatch(JSON.stringify(tenant), /tenant-victim-42/);

  const attacker = normalizeErrorResponse(400, { error: 'Unknown domain ATTACKER_VALUE' });
  assert.equal(attacker.code, 'GW_INVALID_REQUEST');
  assert.equal(attacker.detail.reason, 'INVALID_REQUEST');
  assert.doesNotMatch(JSON.stringify(attacker), /ATTACKER_VALUE/);

  for (const source of [{ code: 'ATTACKER_VALUE' }, { error: 'ATTACKER_VALUE' }]) {
    const classShaped = normalizeErrorResponse(400, source);
    assert.equal(classShaped.code, 'GW_INVALID_REQUEST');
    assert.equal(classShaped.detail.reason, 'INVALID_REQUEST');
    assert.doesNotMatch(JSON.stringify(classShaped), /ATTACKER_VALUE/);
  }
});

test('forbidden detail never discloses the internal denial cause', () => {
  const out = normalizeErrorResponse(403, {
    code: 'FORBIDDEN',
    detail: { reason: 'requires billing:write for workspace ws_foreign' }
  });
  assert.equal(out.code, 'GW_FORBIDDEN');
  assert.deepEqual(out.detail, { reason: 'FORBIDDEN' });
  assert.doesNotMatch(JSON.stringify(out), /billing:write|ws_foreign/);
});

test('registered control-plane action classes remain approved public classes', () => {
  const routes = JSON.parse(fs.readFileSync(new URL('../../apps/control-plane/route-map.runtime.json', import.meta.url)));
  const modules = [...new Set(routes.map((route) => route.module).filter(Boolean))];
  const expectedClasses = new Set();
  for (const modulePath of modules) {
    const source = fs.readFileSync(new URL(`../../${modulePath.replace(/^\/repo\//, '')}`, import.meta.url), 'utf8');
    for (const match of source.matchAll(/\b(?:code|error)\s*:\s*['"]([A-Z][A-Z0-9_]+)['"]/g)) {
      expectedClasses.add(match[1]);
    }
    for (const block of source.matchAll(/(?:ERROR_STATUS_CODES|STATUS_BY_CODE)\s*=\s*\{([\s\S]*?)\}/g)) {
      for (const match of block[1].matchAll(/\b([A-Z][A-Z0-9_]+)\s*:/g)) {
        expectedClasses.add(match[1]);
      }
    }
  }
  for (const code of expectedClasses) {
    assert.equal(normalizeErrorResponse(400, { code }).code, `GW_${code}`, code);
  }
});

test('public messages never echo probed identifiers, roles, scopes, or credentials', () => {
  const cases = [
    [400, 'invalid value tenant-secret'],
    [403, 'workspace_admin requires billing:write for ws_foreign'],
    [404, 'workspace ws_foreign does not exist'],
    [422, 'provider credential for tenant-secret is invalid']
  ];
  for (const [status, message] of cases) {
    const out = normalizeErrorResponse(status, { code: 'PUBLIC_CLASS', message });
    assert.doesNotMatch(out.message, /tenant-secret|workspace_admin|billing:write|ws_foreign|credential/i);
  }
});

test('resource path drops query data and collapses tenant-scoped identifiers', () => {
  const out = normalizeErrorResponse(404, { code: 'NOT_FOUND' }, {
    resource: '/v1/tenants/ten_foreign/workspaces/wrk_foreign/executions/tenant_B%3Aws_B%3Arun_123?apikey=secret'
  });
  assert.deepEqual(out.resource, {
    path: '/v1/tenants/{id}/workspaces/{id}/executions/{id}'
  });
});

test('correlation ids preserve every first character allowed by the canonical pattern', () => {
  for (const prefix of ['.', '-', '_', ':']) {
    const correlationId = `${prefix}correlation-edge-001`;
    const out = normalizeErrorResponse(404, { code: 'NOT_FOUND' }, { correlationId });
    assert.equal(out.correlationId, correlationId);
  }
});
