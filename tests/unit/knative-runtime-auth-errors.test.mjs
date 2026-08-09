import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  knativeRuntimeAuthenticationError,
  knativeRuntimeAuthorizationError,
} from '../../apps/control-plane/knative-runtime-handlers.mjs';

const SERVER = readFileSync(new URL('../../apps/control-plane/server.mjs', import.meta.url), 'utf8');

test('knative-runtime-auth-errors-01: status authentication failures use the exact bounded route schema', () => {
  assert.deepEqual(
    knativeRuntimeAuthenticationError('INVALID_TOKEN', 'corr-runtime-01'),
    {
      code: 'INVALID_TOKEN',
      message: 'Token verification failed',
      correlationId: 'corr-runtime-01',
    },
  );
  assert.deepEqual(
    knativeRuntimeAuthenticationError('UNAUTHENTICATED', 'corr-runtime-02'),
    {
      code: 'UNAUTHENTICATED',
      message: 'Missing or invalid Bearer token',
      correlationId: 'corr-runtime-02',
    },
  );
});

test('knative-runtime-auth-errors-02: status authorization failures and generated IDs remain exact and bounded', () => {
  assert.deepEqual(
    knativeRuntimeAuthorizationError('corr-runtime-03'),
    {
      code: 'FORBIDDEN',
      message: 'Caller lacks a platform observer role',
      correlationId: 'corr-runtime-03',
    },
  );

  const generated = knativeRuntimeAuthorizationError('bad');
  assert.deepEqual(Object.keys(generated).sort(), ['code', 'correlationId', 'message']);
  assert.match(generated.correlationId, /^[A-Za-z0-9._:-]{8,128}$/);
});

test('knative-runtime-auth-errors-03: only the Knative status auth branch emits route-specific errors', () => {
  assert.match(SERVER, /route\.auth\s*===\s*['"]knative_status['"]/);
  assert.match(SERVER, /knativeRuntimeAuthenticationError\(\s*['"]INVALID_TOKEN['"]/);
  assert.match(SERVER, /knativeRuntimeAuthenticationError\(\s*['"]UNAUTHENTICATED['"]/);
  assert.match(SERVER, /knativeRuntimeAuthorizationError\(/);
});
