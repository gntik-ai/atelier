import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runWebhookCredentialLifecycle } from '../../apps/control-plane/webhook-key-credential-cli.mjs';
import { runWebhookLifecycle } from '../../apps/control-plane/webhook-key-lifecycle-cli.mjs';
import { deriveWebhookKeyId, formatCanonicalWebhookKey, parseCanonicalWebhookKey } from '../../packages/webhook-engine/src/webhook-master-key.mjs';

const baseEnv = {
  WEBHOOK_KEY_CREDENTIAL_ACTION: 'ensure',
  WEBHOOK_SECRET_NAME: 'webhook-master-key',
  WEBHOOK_SECRET_KEY: 'key',
  WEBHOOK_KEY_CREATE: 'true',
  WEBHOOK_KEY_IS_UPGRADE: 'false',
  WEBHOOK_KEY_LIFECYCLE_ACTION: 'none',
  WEBHOOK_SIGNING_KEY_MODE: 'canonical-v1',
  RELEASE_NAME: 'falcone',
  RELEASE_NAMESPACE: 'falcone-test',
  APP_NAME: 'in-falcone',
};

function fakeApi(existing = null) {
  const calls = [];
  return {
    namespace: 'falcone-test', calls,
    async getSecret(name) { calls.push({ action: 'get', name }); return existing; },
    async createSecret(secret) { calls.push({ action: 'create', secret }); return secret; },
    async deleteSecret(name) { calls.push({ action: 'delete', name }); },
  };
}

test('credential ensure generates canonical material only inside the Secret API request', async () => {
  const api = fakeApi();
  const result = await runWebhookCredentialLifecycle(baseEnv, { api, argv: ['node', 'cli'] });
  assert.equal(result.created, true);
  assert.equal(result.custody, 'managed');
  assert.doesNotMatch(JSON.stringify(result), /v1:[A-Za-z0-9_-]{43}/);
  const created = api.calls.find((call) => call.action === 'create').secret;
  const material = Buffer.from(created.data.key, 'base64').toString('utf8');
  assert.equal(parseCanonicalWebhookKey(material).length, 32);
  assert.equal(created.immutable, true);
  assert.equal(created.metadata.annotations['helm.sh/resource-policy'], 'keep');
});

test('external Secret validation is read-only and managed missing ordinary upgrade fails closed', async () => {
  const material = formatCanonicalWebhookKey(Buffer.alloc(32, 0x22));
  const external = { metadata: { name: 'webhook-master-key' }, immutable: false, data: { key: Buffer.from(material).toString('base64') } };
  const api = fakeApi(external);
  const result = await runWebhookCredentialLifecycle({ ...baseEnv, WEBHOOK_KEY_CREATE: 'false' }, { api, argv: ['node', 'cli'] });
  assert.equal(result.custody, 'external');
  assert.deepEqual(api.calls.map((call) => call.action), ['get']);

  await assert.rejects(
    runWebhookCredentialLifecycle({ ...baseEnv, WEBHOOK_KEY_IS_UPGRADE: 'true' }, { api: fakeApi(), argv: ['node', 'cli'] }),
    { code: 'CREDENTIAL_MANAGED_SECRET_MISSING' },
  );
});

test('ordinary managed upgrade validates and reuses the existing bytes without mutation', async () => {
  const material = formatCanonicalWebhookKey(Buffer.alloc(32, 0x23));
  const expectedKeyId = deriveWebhookKeyId(
    'falcone-test',
    baseEnv.WEBHOOK_SECRET_NAME,
    baseEnv.WEBHOOK_SECRET_KEY,
  );
  const existing = {
    immutable: true,
    metadata: {
      labels: {
        'in-falcone.io/webhook-key-managed': 'true',
        'app.kubernetes.io/instance': baseEnv.RELEASE_NAME,
      },
      annotations: {
        'meta.helm.sh/release-name': baseEnv.RELEASE_NAME,
        'meta.helm.sh/release-namespace': baseEnv.RELEASE_NAMESPACE,
        'in-falcone.io/webhook-key-id': expectedKeyId,
      },
    },
    data: { key: Buffer.from(material).toString('base64') },
  };
  const api = fakeApi(existing);
  const result = await runWebhookCredentialLifecycle({
    ...baseEnv, WEBHOOK_KEY_IS_UPGRADE: 'true',
  }, { api, argv: ['node', 'cli'] });
  assert.equal(result.created, false);
  assert.deepEqual(api.calls.map(({ action }) => action), ['get']);

  await assert.rejects(runWebhookCredentialLifecycle({
    ...baseEnv, WEBHOOK_KEY_IS_UPGRADE: 'true',
  }, {
    api: fakeApi({ ...existing, data: { key: Buffer.from('malformed').toString('base64') } }),
    argv: ['node', 'cli'],
  }), { code: 'WEBHOOK_KEY_FORMAT_INVALID' });
});

test('ordinary managed ensure rejects absent or mismatched opaque identity metadata', async () => {
  const material = formatCanonicalWebhookKey(Buffer.alloc(32, 0x24));
  const expectedKeyId = deriveWebhookKeyId(
    'falcone-test',
    baseEnv.WEBHOOK_SECRET_NAME,
    baseEnv.WEBHOOK_SECRET_KEY,
  );
  const existing = {
    immutable: true,
    metadata: {
      labels: {
        'in-falcone.io/webhook-key-managed': 'true',
        'app.kubernetes.io/instance': baseEnv.RELEASE_NAME,
      },
      annotations: {
        'meta.helm.sh/release-name': baseEnv.RELEASE_NAME,
        'meta.helm.sh/release-namespace': baseEnv.RELEASE_NAMESPACE,
        'in-falcone.io/webhook-key-id': expectedKeyId,
      },
    },
    data: { key: Buffer.from(material).toString('base64') },
  };

  for (const annotations of [
    {
      'meta.helm.sh/release-name': baseEnv.RELEASE_NAME,
      'meta.helm.sh/release-namespace': baseEnv.RELEASE_NAMESPACE,
    },
    {
      ...existing.metadata.annotations,
      'in-falcone.io/webhook-key-id': `wk1:${'f'.repeat(64)}`,
    },
  ]) {
    const api = fakeApi({
      ...existing,
      metadata: { ...existing.metadata, annotations },
    });
    await assert.rejects(
      runWebhookCredentialLifecycle({
        ...baseEnv,
        WEBHOOK_KEY_IS_UPGRADE: 'true',
      }, { api, argv: ['node', 'cli'] }),
      (caught) => {
        assert.equal(caught.code, 'CREDENTIAL_MANAGED_IDENTITY_CONFLICT');
        assert.equal(caught.message, 'managed identity conflict');
        assert.doesNotMatch(
          caught.message,
          /wk1:|webhook-master-key|falcone-test/,
        );
        return true;
      },
    );
    assert.deepEqual(api.calls.map(({ action }) => action), ['get']);
  }
});

test('finalization never deletes current or external Secret identities', async () => {
  const currentId = `wk1:${'a'.repeat(64)}`;
  await assert.rejects(runWebhookCredentialLifecycle({
    ...baseEnv,
    WEBHOOK_KEY_CREDENTIAL_ACTION: 'finalize',
    WEBHOOK_SOURCE_SECRET_NAME: baseEnv.WEBHOOK_SECRET_NAME,
    WEBHOOK_SOURCE_SECRET_KEY: baseEnv.WEBHOOK_SECRET_KEY,
    WEBHOOK_EXPECTED_RECOVERY_KEY_ID: currentId,
  }, { api: fakeApi(), argv: ['node', 'cli'] }), { code: 'CREDENTIAL_DELETE_CURRENT_FORBIDDEN' });

  const external = { metadata: { name: 'old', labels: {}, annotations: {} }, immutable: true, data: { key: 'unused' } };
  const api = fakeApi(external);
  const externalId = deriveWebhookKeyId(api.namespace, 'old', 'key');
  const result = await runWebhookCredentialLifecycle({
    ...baseEnv,
    WEBHOOK_KEY_CREDENTIAL_ACTION: 'finalize',
    WEBHOOK_SOURCE_SECRET_NAME: 'old',
    WEBHOOK_SOURCE_SECRET_KEY: 'key',
    WEBHOOK_EXPECTED_RECOVERY_KEY_ID: externalId,
  }, { api, argv: ['node', 'cli'] });
  assert.equal(result.deleted, false);
  assert.equal(api.calls.some((call) => call.action === 'delete'), false);
});

test('finalization deletes only the exact immutable recovery identity owned by this release', async () => {
  const sourceName = 'old-managed-key';
  const api = fakeApi();
  const sourceId = deriveWebhookKeyId(api.namespace, sourceName, 'key');
  const owned = {
    immutable: true,
    metadata: {
      name: sourceName,
      labels: {
        'in-falcone.io/webhook-key-managed': 'true',
        'app.kubernetes.io/instance': baseEnv.RELEASE_NAME,
      },
      annotations: {
        'meta.helm.sh/release-name': baseEnv.RELEASE_NAME,
        'meta.helm.sh/release-namespace': baseEnv.RELEASE_NAMESPACE,
        'in-falcone.io/webhook-key-id': sourceId,
      },
    },
  };
  const ownedApi = fakeApi(owned);
  const result = await runWebhookCredentialLifecycle({
    ...baseEnv,
    WEBHOOK_KEY_CREDENTIAL_ACTION: 'finalize',
    WEBHOOK_SOURCE_SECRET_NAME: sourceName,
    WEBHOOK_SOURCE_SECRET_KEY: 'key',
    WEBHOOK_EXPECTED_RECOVERY_KEY_ID: sourceId,
    WEBHOOK_RECOVERY_MANAGED: 'true',
  }, { api: ownedApi, argv: ['node', 'cli'] });
  assert.equal(result.deleted, true);
  assert.deepEqual(ownedApi.calls.map(({ action }) => action), ['get', 'delete']);

  await assert.rejects(runWebhookCredentialLifecycle({
    ...baseEnv,
    WEBHOOK_KEY_CREDENTIAL_ACTION: 'finalize',
    WEBHOOK_SOURCE_SECRET_NAME: sourceName,
    WEBHOOK_SOURCE_SECRET_KEY: 'key',
    WEBHOOK_EXPECTED_RECOVERY_KEY_ID: deriveWebhookKeyId(api.namespace, 'different', 'key'),
    WEBHOOK_RECOVERY_MANAGED: 'true',
  }, { api: fakeApi(owned), argv: ['node', 'cli'] }), { code: 'CREDENTIAL_RECOVERY_IDENTITY_CONFLICT' });
});

test('status output excludes verification ciphertext and all supplied key material', async () => {
  const keyMaterial = formatCanonicalWebhookKey(Buffer.alloc(32, 0x33));
  const pool = {
    async query(sql) {
      if (/FROM webhook_master_key_state/.test(sql)) return { rows: [{
        singleton_id: 1, lifecycle_state: 'serving', current_key_id: `wk1:${'a'.repeat(64)}`,
        current_mode: 'canonical-v1', current_managed: true,
        current_verification_cipher: 'verification-cipher-must-not-appear', current_verification_iv: 'iv-must-not-appear',
        recovery_key_id: null, updated_at: '2026-01-01T00:00:00Z',
      }] };
      return { rows: [{ request_id: 'request-1', action: 'rotate', lifecycle_state: 'completed', affected_count: 2, verified_count: 2 }] };
    },
    async end() {},
  };
  const result = await runWebhookLifecycle(
    { WEBHOOK_KEY_LIFECYCLE_ACTION: 'status', WEBHOOK_SIGNING_KEY: keyMaterial },
    { pool, argv: ['node', 'cli'], applySchema: async () => {} },
  );
  const output = JSON.stringify(result);
  assert.doesNotMatch(output, /verification-cipher|iv-must-not-appear/);
  assert.equal(output.includes(keyMaterial), false);
});

test('pre-commit lifecycle failure restores the observed source deployment replica count', async () => {
  const scales = [];
  let drained = false;
  const api = {
    namespace: 'falcone-test',
    async getDeployment() {
      return { spec: { replicas: drained ? 0 : 3 }, status: drained ? {} : { replicas: 3, availableReplicas: 3 } };
    },
    async scaleDeployment(_name, replicas) {
      scales.push(replicas);
      drained = replicas === 0;
    },
  };
  await assert.rejects(runWebhookLifecycle({
    WEBHOOK_KEY_LIFECYCLE_ACTION: 'adopt',
    WEBHOOK_CONTROL_PLANE_DEPLOYMENT: 'falcone-control-plane',
    WEBHOOK_CONTROL_PLANE_REPLICAS: '2',
  }, {
    api,
    pool: { async query() { return { rows: [] }; } },
    argv: ['node', 'cli'],
    applySchema: async () => {},
  }), { code: 'WEBHOOK_LIFECYCLE_INPUT_INVALID' });
  assert.deepEqual(scales, [0, 3]);
});

function rotationEnv(overrides = {}) {
  return {
    WEBHOOK_KEY_LIFECYCLE_ACTION: 'rotate',
    WEBHOOK_CONTROL_PLANE_DEPLOYMENT: 'falcone-control-plane',
    WEBHOOK_CONTROL_PLANE_REPLICAS: '2',
    WEBHOOK_SIGNING_KEY: formatCanonicalWebhookKey(Buffer.alloc(32, 0x55)),
    WEBHOOK_SIGNING_KEY_ID: `wk1:${'b'.repeat(64)}`,
    WEBHOOK_SIGNING_KEY_MANAGED: 'true',
    WEBHOOK_SOURCE_SIGNING_KEY: 'synthetic-cli-legacy-fixture',
    WEBHOOK_SOURCE_SIGNING_KEY_ID: `wk1:${'a'.repeat(64)}`,
    WEBHOOK_LIFECYCLE_REQUEST_ID: 'rotate-cli-retry',
    WEBHOOK_LIFECYCLE_ROTATION_ID: 'rotation-cli-retry',
    WEBHOOK_RECOVERY_WINDOW_SECONDS: '3600',
    ...overrides,
  };
}

function zeroReplicaApi() {
  const calls = [];
  return {
    calls,
    namespace: 'falcone-test',
    async getDeployment() {
      calls.push('get');
      return { spec: { replicas: 0 }, status: { replicas: 0, availableReplicas: 0 } };
    },
    async scaleDeployment(_name, replicas) { calls.push(`scale:${replicas}`); },
  };
}

test('committed Helm retry reconciles an already-zero deployment and returns the target-apply handoff', async () => {
  const api = zeroReplicaApi();
  const calls = [];
  const repository = {
    async authorizeQuiescedReplay(binding) {
      calls.push({ action: 'authorize', binding });
      return { state: 'recovery_required' };
    },
    async getResolutionState() { return { current_mode: 'legacy' }; },
    async rotate(request) {
      calls.push({ action: 'rotate', request });
      return { action: 'rotate', requestId: request.requestId, state: 'completed', affectedCount: 2, verifiedCount: 2 };
    },
  };
  const result = await runWebhookLifecycle(rotationEnv(), {
    api,
    pool: { async query() { return { rows: [] }; } },
    repository,
    argv: ['node', 'cli'],
    applySchema: async () => {},
  });
  assert.equal(result.reconciledFromZero, true);
  assert.equal(result.workloadAction, 'apply-target');
  assert.deepEqual(api.calls, ['get']);
  assert.equal(calls.filter(({ action }) => action === 'rotate').length, 1);
  assert.deepEqual(calls[0].binding, {
    requestId: 'rotate-cli-retry',
    action: 'rotate',
    rotationId: 'rotation-cli-retry',
    sourceKeyId: `wk1:${'a'.repeat(64)}`,
    targetKeyId: `wk1:${'b'.repeat(64)}`,
    targetManaged: true,
    recoveryWindowSeconds: 3600,
  });
});

test('changed target custody cannot authorize an already-zero lifecycle replay', async () => {
  const api = zeroReplicaApi();
  let transformed = false;
  let observedBinding = null;
  const repository = {
    async authorizeQuiescedReplay(binding) {
      observedBinding = binding;
      if (binding.targetManaged !== true) {
        throw Object.assign(new Error('bounded conflict'), {
          code: 'WEBHOOK_LIFECYCLE_REQUEST_CONFLICT',
        });
      }
      return { state: 'completed' };
    },
    async rotate() { transformed = true; },
  };

  await assert.rejects(runWebhookLifecycle(rotationEnv({
    WEBHOOK_SIGNING_KEY_MANAGED: 'false',
  }), {
    api,
    pool: { async query() { return { rows: [] }; } },
    repository,
    argv: ['node', 'cli'],
    applySchema: async () => {},
  }), { code: 'WEBHOOK_LIFECYCLE_REQUEST_CONFLICT' });

  assert.equal(observedBinding.targetManaged, false);
  assert.equal(transformed, false);
  assert.deepEqual(api.calls, ['get']);
});

test('new or conflicting lifecycle request stays fail-closed while deployment is unexpectedly zero', async () => {
  for (const authorization of ['missing', 'conflict']) {
    const api = zeroReplicaApi();
    let transformed = false;
    const repository = {
      async authorizeQuiescedReplay() {
        if (authorization === 'conflict') {
          throw Object.assign(new Error('bounded conflict'), { code: 'WEBHOOK_LIFECYCLE_REQUEST_CONFLICT' });
        }
        return null;
      },
      async rotate() { transformed = true; },
    };
    await assert.rejects(runWebhookLifecycle(rotationEnv({
      WEBHOOK_LIFECYCLE_REQUEST_ID: `rotate-${authorization}`,
    }), {
      api,
      pool: { async query() { return { rows: [] }; } },
      repository,
      argv: ['node', 'cli'],
      applySchema: async () => {},
    }), {
      code: authorization === 'conflict'
        ? 'WEBHOOK_LIFECYCLE_REQUEST_CONFLICT'
        : 'KUBE_DEPLOYMENT_STATE_INVALID',
    });
    assert.equal(transformed, false);
    assert.deepEqual(api.calls, ['get']);
  }
});

test('failed completed-finalize verification cannot reach managed recovery Secret deletion', async () => {
  const api = zeroReplicaApi();
  api.deleteSecret = async (name) => api.calls.push(`delete:${name}`);
  api.getSecret = async (name) => {
    api.calls.push(`secret:${name}`);
    return { metadata: { name } };
  };
  const verificationFailure = Object.assign(
    new Error('bounded verification failure'),
    { code: 'WEBHOOK_KEY_VERIFICATION_FAILED' },
  );
  const repository = {
    async authorizeQuiescedReplay() { return { state: 'completed' }; },
    async getResolutionState() { return { current_mode: 'canonical-v1' }; },
    async finalize() { throw verificationFailure; },
  };
  await assert.rejects(runWebhookLifecycle({
    WEBHOOK_KEY_LIFECYCLE_ACTION: 'finalize',
    WEBHOOK_CONTROL_PLANE_DEPLOYMENT: 'falcone-control-plane',
    WEBHOOK_CONTROL_PLANE_REPLICAS: '2',
    WEBHOOK_SIGNING_KEY: formatCanonicalWebhookKey(Buffer.alloc(32, 0x55)),
    WEBHOOK_SIGNING_KEY_ID: `wk1:${'b'.repeat(64)}`,
    WEBHOOK_SOURCE_SIGNING_KEY_ID: `wk1:${'a'.repeat(64)}`,
    WEBHOOK_LIFECYCLE_REQUEST_ID: 'finalize-cli-retry',
    WEBHOOK_SOURCE_SECRET_NAME: 'managed-recovery-key',
    WEBHOOK_SOURCE_SECRET_KEY: 'key',
    WEBHOOK_RECOVERY_MANAGED: 'true',
    RELEASE_NAME: 'falcone',
    RELEASE_NAMESPACE: 'falcone-test',
  }, {
    api,
    pool: { async query() { return { rows: [] }; } },
    repository,
    argv: ['node', 'cli'],
    applySchema: async () => {},
  }), { code: 'WEBHOOK_KEY_VERIFICATION_FAILED' });
  assert.deepEqual(api.calls, ['get']);
});

test('verified completed-finalize replay can retry exact managed recovery Secret deletion', async () => {
  const sourceName = 'managed-recovery-key';
  const sourceKeyId = deriveWebhookKeyId('falcone-test', sourceName, 'key');
  const api = zeroReplicaApi();
  const owned = {
    immutable: true,
    metadata: {
      name: sourceName,
      labels: {
        'in-falcone.io/webhook-key-managed': 'true',
        'app.kubernetes.io/instance': 'falcone',
      },
      annotations: {
        'meta.helm.sh/release-name': 'falcone',
        'meta.helm.sh/release-namespace': 'falcone-test',
        'in-falcone.io/webhook-key-id': sourceKeyId,
      },
    },
  };
  api.getSecret = async (name) => {
    api.calls.push(`secret:${name}`);
    return owned;
  };
  api.deleteSecret = async (name) => api.calls.push(`delete:${name}`);
  const repository = {
    async authorizeQuiescedReplay() { return { state: 'completed' }; },
    async getResolutionState() { return { current_mode: 'canonical-v1' }; },
    async finalize() {
      return {
        action: 'finalize',
        requestId: 'finalize-cli-retry',
        state: 'completed',
        sourceKeyId,
        sourceManaged: true,
      };
    },
  };
  const result = await runWebhookLifecycle({
    WEBHOOK_KEY_LIFECYCLE_ACTION: 'finalize',
    WEBHOOK_CONTROL_PLANE_DEPLOYMENT: 'falcone-control-plane',
    WEBHOOK_CONTROL_PLANE_REPLICAS: '2',
    WEBHOOK_SIGNING_KEY: formatCanonicalWebhookKey(Buffer.alloc(32, 0x55)),
    WEBHOOK_SIGNING_KEY_ID: `wk1:${'b'.repeat(64)}`,
    WEBHOOK_SOURCE_SIGNING_KEY_ID: sourceKeyId,
    WEBHOOK_LIFECYCLE_REQUEST_ID: 'finalize-cli-retry',
    WEBHOOK_SECRET_NAME: 'current-key',
    WEBHOOK_SECRET_KEY: 'key',
    WEBHOOK_SOURCE_SECRET_NAME: sourceName,
    WEBHOOK_SOURCE_SECRET_KEY: 'key',
    WEBHOOK_RECOVERY_MANAGED: 'true',
    RELEASE_NAME: 'falcone',
    RELEASE_NAMESPACE: 'falcone-test',
  }, {
    api,
    pool: { async query() { return { rows: [] }; } },
    repository,
    argv: ['node', 'cli'],
    applySchema: async () => {},
  });
  assert.equal(result.credential.deleted, true);
  assert.deepEqual(api.calls, [
    'get',
    `secret:${sourceName}`,
    `delete:${sourceName}`,
  ]);
});

test('lost commit acknowledgement leaves the deployment stopped for exact Helm reconciliation', async () => {
  const scales = [];
  let drained = false;
  const api = {
    namespace: 'falcone-test',
    async getDeployment() {
      return {
        spec: { replicas: drained ? 0 : 3 },
        status: drained ? { replicas: 0, availableReplicas: 0 } : { replicas: 3, availableReplicas: 3 },
      };
    },
    async scaleDeployment(_name, replicas) {
      scales.push(replicas);
      drained = replicas === 0;
    },
  };
  const repository = {
    async getResolutionState() { return { current_mode: 'legacy' }; },
    async rotate() {
      throw Object.assign(new Error('sanitized ambiguous state'), { code: 'WEBHOOK_KEY_STATE_AMBIGUOUS' });
    },
  };
  await assert.rejects(runWebhookLifecycle(rotationEnv(), {
    api,
    pool: { async query() { return { rows: [] }; } },
    repository,
    argv: ['node', 'cli'],
    applySchema: async () => {},
  }), { code: 'WEBHOOK_KEY_STATE_AMBIGUOUS' });
  assert.deepEqual(scales, [0]);
});

test('master-key lifecycle has no HTTP/OpenAPI route', async () => {
  const paths = ['apps/control-plane/routes.mjs', 'openapi/openapi.yaml'];
  const sources = [];
  for (const path of paths) {
    try { sources.push(await readFile(path, 'utf8')); } catch { /* not every checkout has the assembled path */ }
  }
  const published = sources.join('\n');
  assert.doesNotMatch(published, /webhook[^\n]*(master.?key|lifecycle|finalize)/i);
});
