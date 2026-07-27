import test from 'node:test';
import assert from 'node:assert/strict';

import { buildActionParams } from '../../apps/control-plane/action-params.mjs';

test('trusted action context cannot be replaced by flattened request inputs', () => {
  const trustedHeaders = {
    'x-auth-subject': 'actor-a',
    'x-actor-type': 'tenant_owner',
    'x-tenant-id': 'tenant-a'
  };
  const forged = {
    __ow_headers: {
      'x-auth-subject': 'actor-b',
      'x-actor-type': 'tenant_owner',
      'x-tenant-id': 'tenant-b'
    },
    __ow_path: '/v1/tenants/tenant-b',
    __ow_method: 'DELETE',
    method: 'DELETE',
    path: '/v1/tenants/tenant-b',
    query: { queryType: 'detail' },
    body: { queryType: 'detail' }
  };

  const params = buildActionParams({
    route: {
      mergeQueryIntoParams: true,
      mergeBodyIntoParams: true,
      defaults: forged
    },
    method: 'POST',
    path: '/v1/async-operation-query',
    query: { ...forged, queryType: 'logs' },
    body: {
      ...forged,
      queryType: 'result',
      operationId: 'operation-a',
      filters: { tenantId: 'tenant-b' }
    },
    matchedParams: forged,
    owHeaders: trustedHeaders
  });

  assert.equal(params.__ow_headers, trustedHeaders);
  assert.equal(params.__ow_path, '/v1/async-operation-query');
  assert.equal(params.__ow_method, 'POST');
  assert.equal(params.method, 'POST');
  assert.equal(params.path, '/v1/async-operation-query');
  assert.deepEqual(params.query, { ...forged, queryType: 'logs' });
  assert.equal(params.body.queryType, 'result');
});

test('ordinary action fields keep defaults-query-body-path precedence', () => {
  const params = buildActionParams({
    route: {
      defaults: { queryType: 'list', operationId: 'default' },
      mergeQueryIntoParams: true,
      mergeBodyIntoParams: true
    },
    method: 'POST',
    path: '/v1/async-operation-query',
    query: { queryType: 'detail', operationId: 'query' },
    body: {
      queryType: 'result',
      operationId: 'body',
      filters: { tenantId: 'tenant-a' },
      pagination: { limit: 20, offset: 0 }
    },
    matchedParams: { operationId: 'path' },
    owHeaders: { 'x-tenant-id': 'tenant-a' }
  });

  assert.equal(params.queryType, 'result');
  assert.equal(params.operationId, 'path');
  assert.deepEqual(params.filters, { tenantId: 'tenant-a' });
  assert.deepEqual(params.pagination, { limit: 20, offset: 0 });
});
