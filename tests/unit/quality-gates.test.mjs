import test from 'node:test';
import assert from 'node:assert/strict';

import { collectContractViolations, isSemver, validateImagePolicy } from '../../scripts/lib/quality-gates.mjs';

test('isSemver accepts stable and prerelease versions', () => {
  assert.equal(isSemver('0.1.0'), true);
  assert.equal(isSemver('1.2.3-rc1'), true);
  assert.equal(isSemver('v1'), false);
  assert.equal(isSemver('latest'), false);
});

test('validateImagePolicy rejects mutable tags and missing repositories', () => {
  const violations = validateImagePolicy({
    controlPlane: {
      enabled: true,
      image: {
        repository: '',
        tag: 'latest'
      }
    }
  });

  assert.deepEqual(violations, [
    'controlPlane must define image.repository.',
    "controlPlane image tag must not use the mutable 'latest' tag.",
    'controlPlane image tag must be semver-like (for example 0.1.0 or 0.1.0-rc1); received latest.'
  ]);
});

test('collectContractViolations flags missing versioning and operation metadata', () => {
  const violations = collectContractViolations({
    info: { version: 'draft' },
    paths: {
      '/tenants/{tenantId}': {
        get: {
          responses: {
            '200': {
              description: 'ok'
            }
          }
        }
      }
    }
  });

  assert.deepEqual(violations, [
    'OpenAPI info.version must be semver; received draft',
    'GET /tenants/{tenantId} is missing operationId.',
    'GET /tenants/{tenantId} must use the /v1/ URI prefix for the current contract generation.',
    'GET /tenants/{tenantId} must require the X-API-Version header.',
    'GET /tenants/{tenantId} must require the X-Correlation-Id header.',
    'GET /tenants/{tenantId} must declare at least one 4xx/5xx/default error response contract.',
    'GET /tenants/{tenantId} must declare a 403 authorization error response.'
  ]);
});
