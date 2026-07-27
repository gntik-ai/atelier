import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createSchemaReadiness } from '../../apps/control-plane/schema-readiness.mjs';

test('schema readiness gates /readyz and mapped routes until bootstrap succeeds', () => {
  const readiness = createSchemaReadiness();

  assert.equal(readiness.isReady(), false);
  assert.deepEqual(readiness.responseForReadyProbe(), {
    statusCode: 503,
    body: { status: 'schema_not_ready' }
  });
  assert.deepEqual(readiness.responseForMappedRoute(), {
    statusCode: 503,
    body: {
      code: 'SCHEMA_NOT_READY',
      message: 'Control-plane schema is not ready'
    }
  });

  readiness.markReady();

  assert.equal(readiness.isReady(), true);
  assert.equal(readiness.responseForReadyProbe(), null);
  assert.equal(readiness.responseForMappedRoute(), null);
});

test('control-plane keeps health liveness separate and marks readiness after recovery', async () => {
  const source = await readFile(
    new URL('../../apps/control-plane/server.mjs', import.meta.url),
    'utf8'
  );

  assert.match(
    source,
    /if \(path === '\/readyz'\)[\s\S]*responseForReadyProbe\(\)[\s\S]*pool\.query\('SELECT 1'\)/
  );
  assert.match(
    source,
    /if \(path === '\/healthz'\)[\s\S]*pool\.query\('SELECT 1'\)/
  );
  assert.match(
    source,
    /matchRoute\(method, path\)[\s\S]*responseForMappedRoute\(\)/
  );
  assert.match(
    source,
    /await recoverSagas\(pool\);[\s\S]*schemaReadiness\.markReady\(\)/
  );
  assert.match(
    source,
    /schema\/recovery permanently failed; exiting for restart[\s\S]*process\.exit\(1\)/
  );
});
