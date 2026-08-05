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

test('control-plane module import is inert and the injected HTTP factory does not listen', async () => {
  const signalCounts = new Map(
    ['SIGINT', 'SIGTERM'].map((signal) => [signal, process.listenerCount(signal)])
  );
  let poolQueries = 0;
  let verifierCalls = 0;

  const { createControlPlaneHttpServer } = await import(
    `../../apps/control-plane/server.mjs?unit-inert=${Date.now()}`
  );
  assert.equal(typeof createControlPlaneHttpServer, 'function');
  const server = createControlPlaneHttpServer({
    pool: {
      async query() {
        poolQueries += 1;
        return { rows: [] };
      }
    },
    jwtVerifier: {
      async verify() {
        verifierCalls += 1;
        throw new Error('unused verifier');
      }
    },
    logger: { error() {} }
  });

  assert.equal(server.listening, false);
  assert.equal(poolQueries, 0, 'import/factory creation must not run migrations or readiness probes');
  assert.equal(verifierCalls, 0, 'import/factory creation must not authenticate');
  for (const [signal, count] of signalCounts) {
    assert.equal(process.listenerCount(signal), count, `import must not install a ${signal} listener`);
  }
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
