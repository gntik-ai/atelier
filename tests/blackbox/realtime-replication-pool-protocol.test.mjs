// Black-box tests for change fix-realtime-replication-pool-protocol (#626).
//
// Live symptom: an SSE subscription to a realtime change-stream opened (200) but every frame was
// `event: error / {"code":"08P01"}`, and the DocumentDB log showed
// `extended query protocol not supported in a replication connection`.
//
// Root cause: createRealtimeExecutor built its PROVISIONING pool as new pg.Pool(engineConnectionConfig).
// When the engine URL carried `replication=database` (the live-campaign secret did), the pool's
// connections were replication connections, so the parameterized provisioning queries
// (`SELECT 1 FROM pg_publication WHERE pubname = $1`, ...) were rejected by Postgres with 08P01 — thrown
// synchronously inside subscribe() and surfaced to the client as the 08P01 SSE error frame.
//
// The fix sanitizes the engine config for the pool (strips any `replication` flag); the replication
// CONSUMER is unchanged (the pg-logical-replication client sets `replication: 'database'` itself).
//
// bbx-626-01..03: nonReplicationConfig strips the replication flag (object + connectionString) and is
//                 otherwise lossless.
// bbx-626-04:     the executor builds its provisioning pool from a sanitized (non-replication) config.
// bbx-626-05:     a realtime SSE error frame carries the underlying error message, not only the code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRealtimeExecutor,
  nonReplicationConfig,
} from '../../apps/control-plane-executor/src/runtime/realtime-executor.mjs';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createConnectionRegistry } from '../../apps/control-plane-executor/src/runtime/connection-registry.mjs';

const REPL_URL = 'postgres://falcone_cdc_repl:pw@falcone-documentdb:5432/postgres?sslmode=disable&replication=database';

// ---------------------------------------------------------------------------
// bbx-626-01: a replication query param is stripped from connectionString (other params preserved)
// ---------------------------------------------------------------------------
test('bbx-626-01: nonReplicationConfig strips replication= from a connectionString URL', () => {
  const out = nonReplicationConfig({ connectionString: REPL_URL });
  assert.ok(!/[?&]replication=/.test(out.connectionString), `replication param must be removed: ${out.connectionString}`);
  assert.match(out.connectionString, /sslmode=disable/, 'other query params must be preserved');
  assert.match(out.connectionString, /falcone-documentdb:5432/, 'host/port must be preserved');
});

// ---------------------------------------------------------------------------
// bbx-626-02: a top-level replication key is stripped from an object config
// ---------------------------------------------------------------------------
test('bbx-626-02: nonReplicationConfig strips a top-level replication key', () => {
  const out = nonReplicationConfig({ host: 'h', port: 5432, database: 'db', replication: 'database' });
  assert.ok(!('replication' in out), 'the replication key must be removed');
  assert.equal(out.host, 'h');
  assert.equal(out.database, 'db');
});

// ---------------------------------------------------------------------------
// bbx-626-03: a config with no replication flag is returned unchanged in substance
// ---------------------------------------------------------------------------
test('bbx-626-03: nonReplicationConfig leaves a clean config intact', () => {
  const clean = 'postgres://u:p@h:5432/db?sslmode=disable';
  const out = nonReplicationConfig({ connectionString: clean });
  assert.match(out.connectionString, /sslmode=disable/);
  assert.ok(!/replication/.test(out.connectionString));
});

// ---------------------------------------------------------------------------
// bbx-626-04: the executor builds its provisioning pool from a NON-replication config
// (proves the sanitizer is wired into pool creation — the actual 08P01 root cause).
// ---------------------------------------------------------------------------
test('bbx-626-04: createRealtimeExecutor sanitizes the engine pool config (no replication mode)', async () => {
  const captured = [];
  const exec = createRealtimeExecutor({
    engineConnectionConfig: { connectionString: REPL_URL },
    poolFactory: (cfg) => {
      captured.push(cfg);
      return { query: async () => ({ rows: [] }), end: async () => {} };
    },
  });
  try {
    assert.equal(captured.length, 1, 'the executor must create exactly one provisioning pool');
    const cfg = captured[0];
    assert.ok(!('replication' in cfg), 'pool config must not carry a replication key');
    assert.ok(
      !cfg.connectionString || !/[?&]replication=/.test(cfg.connectionString),
      `pool connectionString must not request replication mode: ${cfg.connectionString}`,
    );
  } finally {
    await exec.close().catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// bbx-626-05: a realtime SSE error carries the underlying message, not just the code
// ---------------------------------------------------------------------------
test('bbx-626-05: realtime SSE error frame includes the underlying error message', async () => {
  const registry = createConnectionRegistry({ resolveConnection: () => { throw new Error('registry must not be reached'); } });
  // A realtime executor whose subscribe() fails the way the live bug did.
  const realtimeExecutor = {
    async subscribe() { throw Object.assign(new Error('extended query protocol not supported'), { code: '08P01' }); },
    async close() {},
  };
  // An anon API key (data:read) bound to the requested workspace — survives scope enforcement.
  const apiKeyStore = {
    async ensureSchema() {},
    async verifyKey() {
      return { tenantId: 'ten_rt', workspaceId: 'ws_rt', keyType: 'anon', roleName: 'falcone_anon', dbRole: 'falcone_anon', scopes: ['data:read'] };
    },
  };
  const server = createControlPlaneServer({ registry, realtimeExecutor, apiKeyStore, logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${baseUrl}/v1/realtime/workspaces/ws_rt/data/capdb/collections/default/changes?apikey=flc_anon_test`, {
      headers: {
        'x-api-version': '2026-03-26',
        'x-correlation-id': 'corr-bbx-realtime-protocol',
      },
    });
    assert.equal(res.status, 200, 'SSE route opens with 200 before streaming the error');
    const text = await res.text();
    const errLine = text.split('\n').find((l) => l.startsWith('data:') && l.includes('08P01'));
    assert.ok(errLine, `expected an error frame carrying the code, got:\n${text}`);
    const payload = JSON.parse(errLine.slice('data:'.length).trim());
    assert.equal(payload.code, '08P01', 'the frame keeps the error code');
    assert.ok(payload.message && payload.message.length > 0, `the frame must include a message, got: ${JSON.stringify(payload)}`);
  } finally {
    await new Promise((r) => server.close(r));
    await registry.end().catch(() => {});
  }
});
