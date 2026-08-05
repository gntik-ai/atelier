// Internal contract for the public control-plane HTTP seam (C-16).
//
// createControlPlaneHttpServer() is the single production listener factory that the
// hermetic blackbox HTTP suite and the direct entrypoint both build on. These unit
// checks pin the constructor contract the blackbox suite assumes: strict dependency
// injection, a real Node http.Server return, an inert import (no auto-listen), and a
// default schema-readiness gate that is already open so mapped seed routes serve.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { createControlPlaneHttpServer } from '../../apps/control-plane/server.mjs';

function fakePool() {
  const calls = [];
  return {
    calls,
    async query(sql) { calls.push(String(sql)); return { rows: [{ ok: 1 }] }; }
  };
}
function fakeVerifier() {
  return { async verify() { throw new Error('unused in this suite'); } };
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

test('createControlPlaneHttpServer is a public function on server.mjs', () => {
  assert.equal(typeof createControlPlaneHttpServer, 'function');
});

test('importing server.mjs is inert: no server auto-listens without an explicit call', () => {
  // A constructed-but-unstarted server proves the module did not bind a port at import.
  const server = createControlPlaneHttpServer({ pool: fakePool(), jwtVerifier: fakeVerifier() });
  assert.ok(server instanceof http.Server, 'returns a Node http.Server');
  assert.equal(server.listening, false, 'the returned server is not listening until .listen() is called');
});

test('createControlPlaneHttpServer requires an injected pool with query()', () => {
  assert.throws(() => createControlPlaneHttpServer(), TypeError);
  assert.throws(() => createControlPlaneHttpServer({ jwtVerifier: fakeVerifier() }), TypeError);
  assert.throws(
    () => createControlPlaneHttpServer({ pool: {}, jwtVerifier: fakeVerifier() }),
    TypeError
  );
});

test('createControlPlaneHttpServer requires an injected jwtVerifier with verify()', () => {
  assert.throws(() => createControlPlaneHttpServer({ pool: fakePool() }), TypeError);
  assert.throws(
    () => createControlPlaneHttpServer({ pool: fakePool(), jwtVerifier: {} }),
    TypeError
  );
});

test('the seam serves unauthenticated infra routes from the injected dependencies', async () => {
  const pool = fakePool();
  const server = createControlPlaneHttpServer({ pool, jwtVerifier: fakeVerifier(), logger: { error() {} } });
  const base = await listen(server);
  try {
    // `/` needs neither auth nor the pool: it proves the default route table is loaded.
    const root = await fetch(`${base}/`);
    assert.equal(root.status, 200);
    const rootBody = await root.json();
    assert.equal(rootBody.service, 'in-falcone-control-plane');
    assert.ok(Number.isInteger(rootBody.routes) && rootBody.routes > 0, 'seed routes are loaded');

    // `/healthz` proves the injected pool is the one wired into the listener.
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });
    assert.ok(pool.calls.some((sql) => /select\s+1/i.test(sql)), 'healthz probed the injected pool');
  } finally {
    await close(server);
  }
});

test('the default schema-readiness gate is open so a mapped route reaches auth, not 503', async () => {
  const server = createControlPlaneHttpServer({ pool: fakePool(), jwtVerifier: fakeVerifier(), logger: { error() {} } });
  const base = await listen(server);
  try {
    // No bearer -> the mapped, authenticated metrics route must reach the 401 auth gate
    // rather than the schema-not-ready 503 the production readiness gate emits at boot.
    const res = await fetch(`${base}/v1/metrics/tenants/ten_seam_probe/quotas`);
    assert.equal(res.status, 401);
  } finally {
    await close(server);
  }
});
