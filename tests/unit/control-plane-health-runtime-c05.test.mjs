import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  HEALTH_COMPONENT_IDS,
  aggregateProbeResults,
  assertHealthContract,
  createHealthCorrelationId,
  createHealthRuntime,
  validateComponentProbeResult,
  validatePlatformProbeRollup
} from '../../apps/control-plane/health-runtime.mjs';

const OBSERVED_AT = '2026-08-06T12:00:00.000Z';

function readySchema() {
  return { responseForReadyProbe: () => null };
}

function fakePool(query = async () => ({ rows: [{ ok: 1 }] })) {
  const calls = [];
  return {
    calls,
    async query(...args) {
      calls.push(args);
      return query(...args);
    }
  };
}

function component(status) {
  return { status };
}

test('C-05 aggregate precedence follows the canonical contract for every probe type', () => {
  assert.equal(
    aggregateProbeResults([component('live'), component('unknown')], 'liveness', 'corr', OBSERVED_AT).status,
    'unknown'
  );
  assert.equal(
    aggregateProbeResults([component('unknown'), component('dead')], 'liveness', 'corr', OBSERVED_AT).status,
    'dead'
  );
  assert.equal(
    aggregateProbeResults([component('unknown'), component('degraded')], 'readiness', 'corr', OBSERVED_AT).status,
    'degraded'
  );
  assert.equal(
    aggregateProbeResults([component('degraded'), component('not_ready')], 'readiness', 'corr', OBSERVED_AT).status,
    'not_ready'
  );
  assert.equal(
    aggregateProbeResults([component('unknown'), component('stale')], 'health', 'corr', OBSERVED_AT).status,
    'stale'
  );
  assert.equal(
    aggregateProbeResults([component('stale'), component('degraded')], 'health', 'corr', OBSERVED_AT).status,
    'degraded'
  );
  assert.equal(
    aggregateProbeResults([component('degraded'), component('unavailable')], 'health', 'corr', OBSERVED_AT).status,
    'unavailable'
  );
  assert.equal(
    aggregateProbeResults([component('healthy'), component('inherited')], 'health', 'corr', OBSERVED_AT).status,
    'inherited'
  );
});

test('C-05 correlation IDs share the canonical 8-128 character envelope boundary', () => {
  assert.equal(createHealthCorrelationId('valid.correlation-01'), 'valid.correlation-01');
  assert.equal(createHealthCorrelationId('12345678'), '12345678');
  assert.equal(createHealthCorrelationId('x'.repeat(128)), 'x'.repeat(128));
  assert.equal(createHealthCorrelationId('a', () => 'generated-id'), 'generated-id');
  assert.equal(createHealthCorrelationId('x'.repeat(7), () => 'generated-id'), 'generated-id');
  assert.equal(createHealthCorrelationId('x'.repeat(129), () => 'generated-id'), 'generated-id');
  assert.equal(createHealthCorrelationId('unsafe correlation', () => 'generated-id'), 'generated-id');
});

test('C-05 component evaluation is selective and control-plane liveness never queries PostgreSQL', async () => {
  const pool = fakePool(async () => { throw new Error('must not run'); });
  const runtime = createHealthRuntime({
    pool,
    schemaReadiness: readySchema(),
    clock: () => new Date(OBSERVED_AT),
    correlationIdFactory: () => 'generated-id'
  });

  const result = await runtime.evaluate('liveness', {
    componentId: 'control_plane',
    correlationId: 'client-correlation'
  });
  assert.equal(result.status, 'live');
  assert.equal(result.correlation_id, 'client-correlation');
  assert.equal(pool.calls.length, 0);
  assert.equal(validateComponentProbeResult(result), true);
});

test('C-05 adapter timeout is bounded, sanitized, and cannot fabricate health', async () => {
  const rawSecret = 'postgresql://operator:secret@db.internal/private';
  const runtime = createHealthRuntime({
    pool: fakePool(),
    schemaReadiness: readySchema(),
    componentAdapters: {
      kafka: async () => new Promise(() => {
        void rawSecret;
      })
    },
    probeTimeoutMs: 10,
    clock: () => new Date(OBSERVED_AT),
    correlationIdFactory: () => 'generated-id'
  });

  const started = Date.now();
  const result = await runtime.evaluate('health', { componentId: 'kafka' });
  assert.ok(Date.now() - started < 500, 'probe timeout must stay bounded');
  assert.equal(result.status, 'unknown');
  assert.equal(result.summary, 'Probe timed out before evidence was available');
  assert.equal(JSON.stringify(result).includes(rawSecret), false);
});

test('C-05 adapter timeout remains live when it is the process only referenced handle', () => {
  const moduleUrl = new URL('../../apps/control-plane/health-runtime.mjs', import.meta.url).href;
  const script = `
    import { createHealthRuntime } from ${JSON.stringify(moduleUrl)};
    const runtime = createHealthRuntime({
      pool: { query: async () => ({ rows: [{ ok: 1 }] }) },
      schemaReadiness: { responseForReadyProbe: () => null },
      componentAdapters: { kafka: async () => new Promise(() => {}) },
      probeTimeoutMs: 10
    });
    const result = await runtime.evaluate('health', { componentId: 'kafka' });
    console.log(result.status);
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    timeout: 1_000
  });

  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.signal, null);
  assert.equal(child.stdout.trim(), 'unknown');
});

test('C-05 custom adapter payloads are normalized and raw summaries are not reflected', async () => {
  const runtime = createHealthRuntime({
    pool: fakePool(),
    schemaReadiness: readySchema(),
    componentAdapters: {
      kafka: async () => ({
        status: 'healthy',
        summary: 'token=raw-secret host=db.internal.example'
      })
    },
    clock: () => new Date(OBSERVED_AT),
    correlationIdFactory: () => 'generated-id'
  });

  const result = await runtime.evaluate('health', { componentId: 'kafka' });
  assert.equal(result.status, 'healthy');
  assert.equal(result.summary, 'Probe reported healthy');
  assert.equal(JSON.stringify(result).includes('raw-secret'), false);
  assert.equal(JSON.stringify(result).includes('db.internal.example'), false);
});

test('C-05 complete rollups contain exactly the canonical components and validate', async () => {
  const runtime = createHealthRuntime({
    pool: fakePool(),
    schemaReadiness: readySchema(),
    clock: () => new Date(OBSERVED_AT),
    correlationIdFactory: () => 'generated-id'
  });
  const rollup = await runtime.evaluate('health');

  assert.deepEqual(
    rollup.component_results.map((result) => result.component_id),
    [...HEALTH_COMPONENT_IDS]
  );
  assert.equal(rollup.status, 'unknown');
  assert.equal(validatePlatformProbeRollup(rollup), true);
});

test('C-05 packaged runtime fails closed when its route mapping is stale', () => {
  const staleContract = structuredClone(assertHealthContract());
  staleContract.control_plane_probe_mapping.internal_exposures.aggregate.health = '/stale/health';
  assert.throws(
    () => assertHealthContract(staleContract),
    /aggregate health exposure mapping is stale/
  );
});

test('C-05 rollup validation rejects duplicate catalogs and correlation or probe drift', async () => {
  const runtime = createHealthRuntime({
    pool: fakePool(),
    schemaReadiness: readySchema(),
    clock: () => new Date(OBSERVED_AT),
    correlationIdFactory: () => 'generated-correlation'
  });
  const valid = await runtime.evaluate('health');
  assert.equal(validatePlatformProbeRollup(valid), true);

  const duplicateCatalog = structuredClone(valid);
  duplicateCatalog.component_results = duplicateCatalog.component_results.map((result) => ({
    ...result,
    component_id: 'control_plane'
  }));
  assert.equal(validatePlatformProbeRollup(duplicateCatalog), false);

  const missingRollupCorrelation = structuredClone(valid);
  missingRollupCorrelation.correlation_id = null;
  assert.equal(validatePlatformProbeRollup(missingRollupCorrelation), false);

  const componentCorrelationDrift = structuredClone(valid);
  componentCorrelationDrift.component_results[0].correlation_id = 'different-correlation';
  assert.equal(validatePlatformProbeRollup(componentCorrelationDrift), false);

  const componentProbeDrift = structuredClone(valid);
  componentProbeDrift.component_results[0].probe_type = 'readiness';
  componentProbeDrift.component_results[0].status = 'ready';
  assert.equal(validatePlatformProbeRollup(componentProbeDrift), false);

  const unboundedShape = structuredClone(valid);
  unboundedShape.extra = 'not contract-owned';
  assert.equal(validatePlatformProbeRollup(unboundedShape), false);

  const untypedOptionalSection = structuredClone(valid);
  untypedOptionalSection.component_results[0].dependencies = 'not-an-object';
  assert.equal(validatePlatformProbeRollup(untypedOptionalSection), false);
});

test('C-05 rollup validation rejects an aggregate status that contradicts its components', async () => {
  const runtime = createHealthRuntime({
    pool: fakePool(),
    schemaReadiness: readySchema(),
    clock: () => new Date(OBSERVED_AT),
    correlationIdFactory: () => 'generated-correlation'
  });

  for (const [probeType, fabricatedStatus] of [
    ['liveness', 'live'],
    ['readiness', 'ready'],
    ['health', 'healthy']
  ]) {
    const rollup = await runtime.evaluate(probeType);
    assert.notEqual(rollup.status, fabricatedStatus);
    rollup.status = fabricatedStatus;
    assert.equal(validatePlatformProbeRollup(rollup), false, probeType);
  }
});
