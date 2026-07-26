import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWebhookMasterKeyRepository,
} from '../../packages/webhook-engine/src/webhook-master-key-lifecycle.mjs';
import {
  createCanonicalWebhookKeyContext,
  createLifecycleWebhookKeyContext,
  deriveWebhookKeyId,
  formatCanonicalWebhookKey,
} from '../../packages/webhook-engine/src/webhook-master-key.mjs';
import { computeSignature, decryptSecret, encryptSecret } from '../../packages/webhook-engine/src/webhook-signing.mjs';

const legacyId = deriveWebhookKeyId('ns', 'legacy-key', 'key');
const targetId = deriveWebhookKeyId('ns', 'canonical-key', 'key');
const alternateId = deriveWebhookKeyId('ns', 'canonical-key-alternate', 'key');
const legacyMaterial = 'synthetic historical fixture';
const targetMaterial = formatCanonicalWebhookKey(Buffer.alloc(32, 0x42));
const alternateMaterial = formatCanonicalWebhookKey(Buffer.alloc(32, 0x44));

function copy(value) {
  return structuredClone(value);
}

class MemoryPg {
  constructor({ state = null, rows = [] } = {}) {
    this.state = state;
    this.rows = copy(rows);
    this.ledgers = [];
    this.calls = [];
    this.snapshot = null;
    this.loseCommitAckOnce = false;
    this.releaseCount = 0;
  }

  async connect() { return this; }
  release() { this.releaseCount += 1; }

  async query(text, params = []) {
    const sql = String(text).replace(/\s+/g, ' ').trim();
    this.calls.push({ sql, params: copy(params) });
    if (sql === 'BEGIN'
        || sql === 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY') {
      this.snapshot = copy({ state: this.state, rows: this.rows, ledgers: this.ledgers });
      return { rows: [] };
    }
    if (sql === 'COMMIT') {
      this.snapshot = null;
      if (this.loseCommitAckOnce) {
        this.loseCommitAckOnce = false;
        throw new Error('synthetic lost commit acknowledgement');
      }
      return { rows: [] };
    }
    if (sql === 'ROLLBACK') {
      if (this.snapshot) Object.assign(this, copy(this.snapshot));
      this.snapshot = null;
      return { rows: [] };
    }
    if (/^SET LOCAL |^SELECT pg_advisory_xact_lock/.test(sql)) return { rows: [] };

    if (/SELECT \* FROM webhook_master_key_state WHERE singleton_id = 1/.test(sql)) {
      return { rows: this.state ? [copy(this.state)] : [] };
    }
    if (/SELECT count\(\*\)::int AS count FROM webhook_signing_secrets WHERE encryption_key_id IS DISTINCT FROM/.test(sql)) {
      return { rows: [{ count: this.rows.filter((row) => row.encryption_key_id !== params[0]).length }] };
    }
    if (sql === 'SELECT count(*)::int AS count FROM webhook_signing_secrets') {
      return { rows: [{ count: this.rows.length }] };
    }
    if (/SELECT id, subscription_id, tenant_id, workspace_id, secret_cipher/.test(sql)) {
      return { rows: copy(this.rows).sort((a, b) => a.id.localeCompare(b.id)) };
    }
    if (/FROM webhook_master_key_rotations WHERE request_id = \$1/.test(sql)) {
      const row = this.ledgers.find((item) => item.request_id === params[0]);
      return { rows: row ? [copy(row)] : [] };
    }
    if (/SELECT request_id FROM webhook_master_key_rotations WHERE rotation_id = \$1/.test(sql)) {
      return { rows: copy(this.ledgers.filter((item) => item.rotation_id === params[0]).map(({ request_id }) => ({ request_id }))) };
    }
    if (/FROM webhook_master_key_rotations ORDER BY started_at DESC LIMIT 20/.test(sql)) {
      return { rows: copy(this.ledgers.slice(-20).reverse()) };
    }

    if (/INSERT INTO webhook_master_key_state/.test(sql) && /ON CONFLICT \(singleton_id\) DO NOTHING/.test(sql)) {
      if (this.state) return { rows: [] };
      this.state = {
        singleton_id: 1, lifecycle_state: 'serving', current_key_id: params[0],
        current_mode: 'canonical-v1', current_managed: params[1],
        current_verification_cipher: params[2], current_verification_iv: params[3],
        recovery_key_id: null, recovery_mode: null, recovery_managed: null,
        recovery_verification_cipher: null, recovery_verification_iv: null,
        recovery_deadline: null, active_request_id: null, active_rotation_id: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      return { rows: [copy(this.state)] };
    }
    if (/INSERT INTO webhook_master_key_state/.test(sql)) {
      this.state = {
        singleton_id: 1, lifecycle_state: 'serving', current_key_id: params[0],
        current_mode: 'legacy', current_managed: params[1],
        current_verification_cipher: params[2], current_verification_iv: params[3],
        recovery_key_id: null, recovery_mode: null, recovery_managed: null,
        recovery_verification_cipher: null, recovery_verification_iv: null,
        recovery_deadline: null, active_request_id: params[4], active_rotation_id: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      return { rows: [] };
    }
    if (/UPDATE webhook_signing_secrets SET encryption_key_id = \$1 WHERE encryption_key_id IS NULL/.test(sql)) {
      let rowCount = 0;
      for (const row of this.rows) if (row.encryption_key_id == null) { row.encryption_key_id = params[0]; rowCount += 1; }
      return { rows: [], rowCount };
    }
    if (/UPDATE webhook_signing_secrets SET secret_cipher = \$2, secret_iv = \$3, encryption_key_id = \$4/.test(sql)) {
      const row = this.rows.find((item) => item.id === params[0] && item.encryption_key_id === params[4]);
      if (!row) return { rows: [], rowCount: 0 };
      row.secret_cipher = params[1]; row.secret_iv = params[2]; row.encryption_key_id = params[3];
      return { rows: [], rowCount: 1 };
    }
    if (/UPDATE webhook_master_key_state SET lifecycle_state = 'serving', current_key_id = \$1/.test(sql)) {
      const previous = copy(this.state);
      Object.assign(this.state, {
        lifecycle_state: 'serving', current_key_id: params[0], current_mode: 'canonical-v1',
        current_managed: params[1], current_verification_cipher: params[2], current_verification_iv: params[3],
        recovery_key_id: params[4], recovery_mode: params[5], recovery_managed: previous.current_managed,
        recovery_verification_cipher: previous.current_verification_cipher,
        recovery_verification_iv: previous.current_verification_iv,
        recovery_deadline: params[6], active_request_id: params[7], active_rotation_id: params[8],
      });
      return { rows: [] };
    }
    if (/UPDATE webhook_master_key_state SET lifecycle_state = 'serving', current_key_id = recovery_key_id/.test(sql)) {
      const previous = copy(this.state);
      Object.assign(this.state, {
        lifecycle_state: 'serving', current_key_id: previous.recovery_key_id,
        current_mode: previous.recovery_mode, current_managed: previous.recovery_managed,
        current_verification_cipher: previous.recovery_verification_cipher,
        current_verification_iv: previous.recovery_verification_iv,
        recovery_key_id: params[0], recovery_mode: params[1], recovery_managed: previous.current_managed,
        recovery_verification_cipher: previous.current_verification_cipher,
        recovery_verification_iv: previous.current_verification_iv,
        recovery_deadline: params[2], active_request_id: params[3], active_rotation_id: params[4],
      });
      return { rows: [] };
    }
    if (/UPDATE webhook_master_key_state SET recovery_key_id = NULL/.test(sql)) {
      Object.assign(this.state, {
        recovery_key_id: null, recovery_mode: null, recovery_managed: null,
        recovery_verification_cipher: null, recovery_verification_iv: null,
        recovery_deadline: null, active_request_id: params[0], active_rotation_id: null,
      });
      return { rows: [] };
    }
    if (/UPDATE webhook_master_key_state SET lifecycle_state = 'recovery_required'/.test(sql)) {
      if (this.state?.active_request_id === params[0]) this.state.lifecycle_state = 'recovery_required';
      return { rows: [], rowCount: this.state?.active_request_id === params[0] ? 1 : 0 };
    }
    if (/UPDATE webhook_master_key_state SET lifecycle_state = 'serving'/.test(sql)) {
      if (this.state?.active_request_id === params[0]) this.state.lifecycle_state = 'serving';
      return { rows: [], rowCount: this.state?.active_request_id === params[0] ? 1 : 0 };
    }
    if (/UPDATE webhook_master_key_rotations SET lifecycle_state = 'recovery_required'/.test(sql)) {
      const ledger = this.ledgers.find((item) => item.request_id === params[0] && item.lifecycle_state === 'completed');
      if (ledger) ledger.lifecycle_state = 'recovery_required';
      return { rows: [], rowCount: ledger ? 1 : 0 };
    }
    if (/UPDATE webhook_master_key_rotations SET lifecycle_state = 'completed'/.test(sql)) {
      const ledger = this.ledgers.find((item) => item.request_id === params[0] && item.lifecycle_state === 'recovery_required');
      if (ledger) ledger.lifecycle_state = 'completed';
      return { rows: ledger ? [copy(ledger)] : [], rowCount: ledger ? 1 : 0 };
    }

    if (/INSERT INTO webhook_master_key_rotations/.test(sql) && /'completed'/.test(sql)) {
      const row = {
        request_id: params[0], action: params[1], rotation_id: params[2],
        source_key_id: params[3], target_key_id: params[4], source_mode: params[5], target_mode: params[6],
        source_managed: params[7], target_managed: params[8],
        lifecycle_state: 'completed', affected_count: params[9] ?? 0, verified_count: params[10] ?? 0,
        recovery_window_seconds: params[11], recovery_deadline: params[12], error_code: null,
        started_at: new Date().toISOString(), completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      const existing = this.ledgers.findIndex((item) => item.request_id === row.request_id);
      if (existing >= 0) this.ledgers[existing] = row; else this.ledgers.push(row);
      return { rows: [copy(row)] };
    }
    if (/INSERT INTO webhook_master_key_rotations/.test(sql) && /'failed'/.test(sql)) {
      if (!this.ledgers.some((item) => item.request_id === params[0])) {
        this.ledgers.push({
          request_id: params[0], action: params[1], rotation_id: params[2],
          source_key_id: params[3], target_key_id: params[4], source_mode: params[5], target_mode: params[6],
          source_managed: params[7], target_managed: params[8],
          lifecycle_state: 'failed', affected_count: 0, verified_count: 0,
          recovery_window_seconds: params[9], recovery_deadline: null,
          error_code: params[10], error_message: params[11], started_at: new Date().toISOString(), completed_at: new Date().toISOString(),
        });
      }
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`MemoryPg does not implement SQL: ${sql}`);
  }
}

function legacyRows() {
  const context = createLifecycleWebhookKeyContext({ material: legacyMaterial, keyId: legacyId, mode: 'legacy', purpose: 'adopt' });
  return [
    { id: 'row-a', subscription_id: 'sub-a', tenant_id: 'tenant-a', workspace_id: 'ws-a', status: 'active', grace_expires_at: null, revoked_at: null, created_at: '2026-01-01T00:00:00Z', ...rename(encryptSecret('shared-secret-a', context)) },
    { id: 'row-b', subscription_id: 'sub-b', tenant_id: 'tenant-b', workspace_id: 'ws-b', status: 'grace', grace_expires_at: '2027-01-01T00:00:00Z', revoked_at: null, created_at: '2026-01-02T00:00:00Z', ...rename(encryptSecret('shared-secret-b', context)) },
    { id: 'row-c', subscription_id: 'sub-c', tenant_id: 'tenant-a', workspace_id: 'ws-c', status: 'revoked', grace_expires_at: null, revoked_at: '2026-02-01T00:00:00Z', created_at: '2026-01-03T00:00:00Z', ...rename(encryptSecret('shared-secret-c', context)) },
  ];
}

function rename(encrypted) {
  return { secret_cipher: encrypted.cipher, secret_iv: encrypted.iv, encryption_key_id: null };
}

test('empty database initializes once and changed bytes at the same identity fail verification', async () => {
  const pg = new MemoryPg();
  const repository = buildWebhookMasterKeyRepository(pg);
  const first = await repository.initializeOrVerify({ material: targetMaterial, keyId: targetId, mode: 'canonical-v1', managed: true });
  const second = await repository.initializeOrVerify({ material: targetMaterial, keyId: targetId, mode: 'canonical-v1', managed: true });
  assert.equal(first.keyId, targetId);
  assert.strictEqual(second.keyId, first.keyId);
  const assumedRole = pg.calls.findIndex(
    ({ sql }) => sql === 'SET LOCAL ROLE falcone_webhook_key_lifecycle',
  );
  const exclusiveFence = pg.calls.findIndex(
    ({ sql }) => /SELECT pg_advisory_xact_lock\(\$1, \$2\)/.test(sql),
  );
  assert.ok(assumedRole > 0 && exclusiveFence > assumedRole);
  const wrong = formatCanonicalWebhookKey(Buffer.alloc(32, 0x43));
  await assert.rejects(
    repository.initializeOrVerify({ material: wrong, keyId: targetId, mode: 'canonical-v1', managed: true }),
    { code: 'WEBHOOK_KEY_VERIFICATION_FAILED' },
  );
});

test('populated legacy database never auto-initializes or guesses an identity', async () => {
  const pg = new MemoryPg({ rows: legacyRows() });
  const repository = buildWebhookMasterKeyRepository(pg);
  await assert.rejects(
    repository.initializeOrVerify({ material: targetMaterial, keyId: targetId, mode: 'canonical-v1' }),
    { code: 'WEBHOOK_ADOPTION_REQUIRED' },
  );
  assert.equal(pg.state, null);
  assert.ok(pg.rows.every((row) => row.encryption_key_id == null));
});

test('legacy adoption is atomic, preserves ciphertext/plaintext metadata, and request replay is idempotent', async () => {
  const before = legacyRows();
  const pg = new MemoryPg({ rows: before });
  const repository = buildWebhookMasterKeyRepository(pg);
  const adopted = await repository.adopt({ material: legacyMaterial, keyId: legacyId, managed: false, requestId: 'adopt-001' });
  assert.equal(adopted.state, 'completed');
  assert.equal(adopted.affectedCount, 3);
  assert.equal(pg.state.current_mode, 'legacy');
  for (let i = 0; i < before.length; i += 1) {
    assert.equal(pg.rows[i].encryption_key_id, legacyId);
    assert.equal(pg.rows[i].secret_cipher, before[i].secret_cipher);
    assert.equal(pg.rows[i].secret_iv, before[i].secret_iv);
    for (const field of ['id', 'subscription_id', 'tenant_id', 'workspace_id', 'status', 'grace_expires_at', 'created_at', 'revoked_at']) {
      assert.equal(pg.rows[i][field], before[i][field]);
    }
  }
  const updates = pg.calls.filter(({ sql }) => /SET encryption_key_id/.test(sql)).length;
  assert.deepEqual(await repository.adopt({ material: legacyMaterial, keyId: legacyId, requestId: 'adopt-001' }), adopted);
  assert.equal(pg.calls.filter(({ sql }) => /SET encryption_key_id/.test(sql)).length, updates);
  await assert.rejects(
    repository.adopt({
      material: legacyMaterial,
      keyId: legacyId,
      managed: true,
      requestId: 'adopt-001',
    }),
    { code: 'WEBHOOK_LIFECYCLE_REQUEST_CONFLICT' },
  );
  await assert.rejects(
    repository.adopt({ material: legacyMaterial, keyId: targetId, requestId: 'adopt-001' }),
    { code: 'WEBHOOK_LIFECYCLE_REQUEST_CONFLICT' },
  );
});

test('one incompatible legacy row rolls adoption back and records only a bounded failure', async () => {
  const rows = legacyRows();
  const target = createCanonicalWebhookKeyContext(targetMaterial, targetId);
  Object.assign(rows[1], rename(encryptSecret('incompatible-row', target)));
  const before = copy(rows);
  const pg = new MemoryPg({ rows });
  const repository = buildWebhookMasterKeyRepository(pg);
  await assert.rejects(
    repository.adopt({ material: legacyMaterial, keyId: legacyId, requestId: 'adopt-incompatible' }),
    { code: 'WEBHOOK_LIFECYCLE_FAILED' },
  );
  assert.equal(pg.state, null);
  assert.deepEqual(pg.rows, before);
  const failure = pg.ledgers.find((row) => row.request_id === 'adopt-incompatible');
  assert.equal(failure.lifecycle_state, 'failed');
  assert.equal(failure.error_message, 'Webhook key lifecycle operation failed');
  assert.doesNotMatch(JSON.stringify(failure), /incompatible-row|v1:[A-Za-z0-9_-]{43}/);
});

test('canonical rotation and forward recovery preserve exact plaintext, scope, status, and public signature', async () => {
  const pg = new MemoryPg({ rows: legacyRows() });
  const repository = buildWebhookMasterKeyRepository(pg);
  await repository.adopt({ material: legacyMaterial, keyId: legacyId, requestId: 'adopt-rotate' });
  const nonKeyBefore = pg.rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !['secret_cipher', 'secret_iv', 'encryption_key_id'].includes(key))));
  const signatureBefore = computeSignature('payload', 'shared-secret-a');
  const rotated = await repository.rotate({
    sourceMaterial: legacyMaterial, sourceKeyId: legacyId, sourceMode: 'legacy',
    targetMaterial, targetKeyId: targetId, targetManaged: true,
    requestId: 'rotate-001', rotationId: 'rotation-001', recoveryWindowSeconds: 3600, quiesced: true,
  });
  assert.equal(rotated.verifiedCount, 3);
  assert.equal(pg.state.current_key_id, targetId);
  assert.equal(pg.state.recovery_key_id, legacyId);
  const target = createCanonicalWebhookKeyContext(targetMaterial, targetId);
  assert.equal(decryptSecret(pg.rows[0].secret_cipher, pg.rows[0].secret_iv, target), 'shared-secret-a');
  assert.equal(decryptSecret(pg.rows[1].secret_cipher, pg.rows[1].secret_iv, target), 'shared-secret-b');
  assert.equal(decryptSecret(pg.rows[2].secret_cipher, pg.rows[2].secret_iv, target), 'shared-secret-c');
  assert.deepEqual(pg.rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !['secret_cipher', 'secret_iv', 'encryption_key_id'].includes(key)))), nonKeyBefore);
  assert.equal(computeSignature('payload', 'shared-secret-a'), signatureBefore);
  await assert.rejects(repository.rotate({
    sourceMaterial: legacyMaterial, sourceKeyId: legacyId, sourceMode: 'legacy',
    targetMaterial, targetKeyId: targetId, targetManaged: false,
    requestId: 'rotate-001', rotationId: 'rotation-001',
    recoveryWindowSeconds: 3600, quiesced: true,
  }), { code: 'WEBHOOK_LIFECYCLE_REQUEST_CONFLICT' });
  await assert.rejects(repository.rotate({
    sourceMaterial: legacyMaterial, sourceKeyId: legacyId, sourceMode: 'legacy',
    targetMaterial: alternateMaterial, targetKeyId: alternateId,
    requestId: 'rotate-001', rotationId: 'rotation-001', recoveryWindowSeconds: 3600, quiesced: true,
  }), { code: 'WEBHOOK_LIFECYCLE_REQUEST_CONFLICT' });
  await assert.rejects(repository.rotate({
    sourceMaterial: targetMaterial, sourceKeyId: targetId, sourceMode: 'canonical-v1',
    targetMaterial: alternateMaterial, targetKeyId: alternateId,
    requestId: 'rotate-conflicting-id', rotationId: 'rotation-001', recoveryWindowSeconds: 3600, quiesced: true,
  }), { code: 'WEBHOOK_ROTATION_ID_CONFLICT' });
  await assert.rejects(repository.finalize({ material: targetMaterial, keyId: targetId, mode: 'canonical-v1', recoveryKeyId: legacyId, requestId: 'finalize-early' }), { code: 'WEBHOOK_FINALIZE_TOO_EARLY' });

  const recovered = await repository.recover({
    currentMaterial: targetMaterial, currentKeyId: targetId, currentMode: 'canonical-v1',
    targetMaterial: legacyMaterial, targetKeyId: legacyId, targetMode: 'legacy',
    targetManaged: false,
    requestId: 'recover-001', rotationId: 'rotation-recover-001', recoveryWindowSeconds: 3600, quiesced: true,
  });
  assert.equal(recovered.state, 'completed');
  assert.equal(recovered.sourceManaged, true);
  assert.equal(recovered.targetManaged, false);
  assert.equal(pg.state.current_key_id, legacyId);
  assert.equal(pg.state.current_managed, false);
  assert.equal(pg.state.recovery_managed, true);
  const legacy = createLifecycleWebhookKeyContext({ material: legacyMaterial, keyId: legacyId, mode: 'legacy', purpose: 'recover' });
  assert.equal(decryptSecret(pg.rows[0].secret_cipher, pg.rows[0].secret_iv, legacy), 'shared-secret-a');
  assert.deepEqual(pg.rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !['secret_cipher', 'secret_iv', 'encryption_key_id'].includes(key)))), nonKeyBefore);

  pg.state.recovery_deadline = '2020-01-01T00:00:00.000Z';
  const finalized = await repository.finalize({ material: legacyMaterial, keyId: legacyId, mode: 'legacy', recoveryKeyId: targetId, requestId: 'finalize-001', now: new Date('2026-01-01T00:00:00Z') });
  assert.equal(finalized.state, 'completed');
  assert.equal(finalized.sourceKeyId, targetId);
  assert.equal(finalized.sourceManaged, true);
  assert.equal(pg.state.recovery_key_id, null);
  assert.equal(pg.rows.length, 3);
});

async function rotatedFixture(requestSuffix, {
  currentManaged = true,
  recoveryManaged = false,
  auditWriter = null,
} = {}) {
  const pg = new MemoryPg({ rows: legacyRows() });
  const repository = buildWebhookMasterKeyRepository(pg, { auditWriter });
  await repository.adopt({
    material: legacyMaterial,
    keyId: legacyId,
    managed: recoveryManaged,
    requestId: `adopt-deadline-${requestSuffix}`,
  });
  await repository.rotate({
    sourceMaterial: legacyMaterial,
    sourceKeyId: legacyId,
    sourceMode: 'legacy',
    targetMaterial,
    targetKeyId: targetId,
    targetManaged: currentManaged,
    requestId: `rotate-deadline-${requestSuffix}`,
    rotationId: `rotation-deadline-${requestSuffix}`,
    recoveryWindowSeconds: 3600,
    quiesced: true,
  });
  return { pg, repository };
}

const custodyDirections = [
  { name: 'external-to-external', currentManaged: false, recoveryManaged: false },
  { name: 'external-to-managed', currentManaged: false, recoveryManaged: true },
  { name: 'managed-to-external', currentManaged: true, recoveryManaged: false },
  { name: 'managed-to-managed', currentManaged: true, recoveryManaged: true },
];

test('recovery swaps durable custody for every managed/external direction and binds custody to every replay', async () => {
  for (const direction of custodyDirections) {
    const suffix = `custody-${direction.name}`;
    const events = [];
    const { pg, repository } = await rotatedFixture(suffix, {
      ...direction,
      auditWriter: async (_client, event) => events.push(copy(event)),
    });
    assert.equal(pg.state.current_managed, direction.currentManaged);
    assert.equal(pg.state.recovery_managed, direction.recoveryManaged);

    const adoptBinding = {
      requestId: `adopt-deadline-${suffix}`,
      action: 'adopt',
      targetKeyId: legacyId,
      targetManaged: direction.recoveryManaged,
    };
    assert.equal(
      (await repository.authorizeQuiescedReplay(adoptBinding)).targetManaged,
      direction.recoveryManaged,
    );
    await assert.rejects(
      repository.authorizeQuiescedReplay({
        ...adoptBinding,
        targetManaged: !direction.recoveryManaged,
      }),
      { code: 'WEBHOOK_LIFECYCLE_REQUEST_CONFLICT' },
    );

    const rotateBinding = {
      requestId: `rotate-deadline-${suffix}`,
      action: 'rotate',
      rotationId: `rotation-deadline-${suffix}`,
      sourceKeyId: legacyId,
      targetKeyId: targetId,
      targetManaged: direction.currentManaged,
      recoveryWindowSeconds: 3600,
    };
    assert.equal(
      (await repository.authorizeQuiescedReplay(rotateBinding)).targetManaged,
      direction.currentManaged,
    );
    await assert.rejects(
      repository.authorizeQuiescedReplay({
        ...rotateBinding,
        targetManaged: !direction.currentManaged,
      }),
      { code: 'WEBHOOK_LIFECYCLE_REQUEST_CONFLICT' },
    );

    const recoverRequest = {
      currentMaterial: targetMaterial,
      currentKeyId: targetId,
      currentMode: 'canonical-v1',
      targetMaterial: legacyMaterial,
      targetKeyId: legacyId,
      targetMode: 'legacy',
      targetManaged: direction.recoveryManaged,
      requestId: `recover-${suffix}`,
      rotationId: `recovery-${suffix}`,
      recoveryWindowSeconds: 3600,
      quiesced: true,
    };
    const recovered = await repository.recover(recoverRequest);
    assert.equal(recovered.sourceManaged, direction.currentManaged);
    assert.equal(recovered.targetManaged, direction.recoveryManaged);
    assert.equal(pg.state.current_managed, direction.recoveryManaged);
    assert.equal(pg.state.recovery_managed, direction.currentManaged);
    const ledger = pg.ledgers.find((row) => row.request_id === recoverRequest.requestId);
    assert.equal(ledger.source_managed, direction.currentManaged);
    assert.equal(ledger.target_managed, direction.recoveryManaged);
    const audit = events.find(
      (event) => event.correlationId === recoverRequest.requestId
        && event.outcome === 'succeeded',
    );
    assert.equal(audit.newState.sourceManaged, direction.currentManaged);
    assert.equal(audit.newState.targetManaged, direction.recoveryManaged);

    const recoverBinding = {
      requestId: recoverRequest.requestId,
      action: 'recover',
      rotationId: recoverRequest.rotationId,
      sourceKeyId: targetId,
      targetKeyId: legacyId,
      targetManaged: direction.recoveryManaged,
      recoveryWindowSeconds: 3600,
    };
    assert.equal(
      (await repository.authorizeQuiescedReplay(recoverBinding)).targetManaged,
      direction.recoveryManaged,
    );
    await assert.rejects(
      repository.authorizeQuiescedReplay({
        ...recoverBinding,
        targetManaged: !direction.recoveryManaged,
      }),
      { code: 'WEBHOOK_LIFECYCLE_REQUEST_CONFLICT' },
    );
    await assert.rejects(
      repository.recover({
        ...recoverRequest,
        targetManaged: !direction.recoveryManaged,
      }),
      { code: 'WEBHOOK_LIFECYCLE_REQUEST_CONFLICT' },
    );
  }
});

test('recovery custody mismatch fails before row locks or transforms and preserves durable state', async () => {
  for (const recoveryManaged of [false, true]) {
    const suffix = `custody-mismatch-${recoveryManaged ? 'managed' : 'external'}`;
    const { pg, repository } = await rotatedFixture(suffix, {
      currentManaged: !recoveryManaged,
      recoveryManaged,
    });
    const before = copy({ state: pg.state, rows: pg.rows });
    const transformsBefore = pg.calls.filter(
      ({ sql }) => /UPDATE webhook_signing_secrets SET secret_cipher/.test(sql),
    ).length;
    const rowLocksBefore = pg.calls.filter(({ sql }) => /ORDER BY id FOR UPDATE/.test(sql)).length;
    const requestId = `recover-${suffix}`;

    await assert.rejects(repository.recover({
      currentMaterial: targetMaterial,
      currentKeyId: targetId,
      currentMode: 'canonical-v1',
      targetMaterial: legacyMaterial,
      targetKeyId: legacyId,
      targetMode: 'legacy',
      targetManaged: !recoveryManaged,
      requestId,
      rotationId: `recovery-${suffix}`,
      recoveryWindowSeconds: 3600,
      quiesced: true,
    }), { code: 'WEBHOOK_KEY_CUSTODY_CONFLICT' });

    assert.deepEqual(pg.state, before.state);
    assert.deepEqual(pg.rows, before.rows);
    assert.equal(
      pg.calls.filter(({ sql }) => /UPDATE webhook_signing_secrets SET secret_cipher/.test(sql)).length,
      transformsBefore,
    );
    assert.equal(
      pg.calls.filter(({ sql }) => /ORDER BY id FOR UPDATE/.test(sql)).length,
      rowLocksBefore,
    );
    const failure = pg.ledgers.find((row) => row.request_id === requestId);
    assert.equal(failure.error_code, 'WEBHOOK_KEY_CUSTODY_CONFLICT');
    assert.equal(
      failure.error_message,
      'Webhook key custody conflicts with durable lifecycle state',
    );
    assert.equal(failure.target_managed, !recoveryManaged);
    assert.doesNotMatch(
      JSON.stringify(failure),
      /synthetic historical fixture|v1:[A-Za-z0-9_-]{43}/,
    );
  }
});

test('lifecycle read paths use bounded read-only role transactions and release on rollback', async () => {
  const suffix = 'bounded-read-authority';
  const { pg, repository } = await rotatedFixture(suffix);
  const replayBinding = {
    requestId: `rotate-deadline-${suffix}`,
    action: 'rotate',
    rotationId: `rotation-deadline-${suffix}`,
    sourceKeyId: legacyId,
    targetKeyId: targetId,
    targetManaged: true,
    recoveryWindowSeconds: 3600,
  };
  pg.calls.length = 0;
  const releasesBefore = pg.releaseCount;

  assert.equal((await repository.getResolutionState()).current_key_id, targetId);
  assert.equal((await repository.status()).state.currentKeyId, targetId);
  assert.equal(
    (await repository.authorizeQuiescedReplay(replayBinding)).requestId,
    replayBinding.requestId,
  );
  await assert.rejects(
    repository.authorizeQuiescedReplay({
      ...replayBinding,
      targetManaged: false,
    }),
    { code: 'WEBHOOK_LIFECYCLE_REQUEST_CONFLICT' },
  );

  const beginSql = 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY';
  const begins = pg.calls
    .map(({ sql }, index) => ({ sql, index }))
    .filter(({ sql }) => sql === beginSql);
  assert.equal(begins.length, 4);
  for (let operation = 0; operation < begins.length; operation += 1) {
    const start = begins[operation].index;
    const end = operation + 1 < begins.length
      ? begins[operation + 1].index
      : pg.calls.length;
    const transaction = pg.calls.slice(start, end).map(({ sql }) => sql);
    assert.equal(transaction[1], 'SET LOCAL ROLE falcone_webhook_key_lifecycle');
    assert.ok(transaction.some((sql) => /^SELECT /.test(sql)));
    assert.ok(!transaction.some((sql) => /pg_advisory_xact_lock/.test(sql)));
  }
  assert.equal(
    pg.calls.filter(({ sql }) => sql === 'COMMIT').length,
    3,
  );
  assert.equal(
    pg.calls.filter(({ sql }) => sql === 'ROLLBACK').length,
    1,
  );
  assert.equal(pg.releaseCount - releasesBefore, 4);
});

test('recovery deadline is enforced before, at, and after the transaction-consistent clock boundary', async () => {
  const deadline = new Date('2026-07-23T12:00:00.000Z');
  const attempts = [
    { suffix: 'before', now: new Date(deadline.getTime() - 1), allowed: true },
    { suffix: 'at', now: deadline, allowed: false },
    { suffix: 'after', now: new Date(deadline.getTime() + 1), allowed: false },
  ];
  for (const attempt of attempts) {
    const { pg, repository } = await rotatedFixture(attempt.suffix);
    pg.state.recovery_deadline = deadline.toISOString();
    const before = copy({ state: pg.state, rows: pg.rows });
    const operation = repository.recover({
      currentMaterial: targetMaterial,
      currentKeyId: targetId,
      currentMode: 'canonical-v1',
      targetMaterial: legacyMaterial,
      targetKeyId: legacyId,
      targetMode: 'legacy',
      targetManaged: false,
      requestId: `recover-deadline-${attempt.suffix}`,
      rotationId: `recovery-deadline-${attempt.suffix}`,
      recoveryWindowSeconds: 3600,
      quiesced: true,
      now: attempt.now,
    });
    if (attempt.allowed) {
      const result = await operation;
      assert.equal(result.state, 'completed');
      assert.equal(
        new Date(pg.state.recovery_deadline).toISOString(),
        new Date(attempt.now.getTime() + 3_600_000).toISOString(),
      );
    } else {
      await assert.rejects(operation, { code: 'WEBHOOK_RECOVERY_WINDOW_EXPIRED' });
      assert.deepEqual(pg.state, before.state);
      assert.deepEqual(pg.rows, before.rows);
      const failure = pg.ledgers.find((row) => row.request_id === `recover-deadline-${attempt.suffix}`);
      assert.equal(failure.error_code, 'WEBHOOK_RECOVERY_WINDOW_EXPIRED');
      assert.doesNotMatch(JSON.stringify(failure), /synthetic historical fixture|v1:[A-Za-z0-9_-]{43}/);
    }
  }
});

test('finalize locks and verifies every current row before clearing recovery metadata', async () => {
  for (const mismatch of ['mixed', 'unlabeled']) {
    const { pg, repository } = await rotatedFixture(`finalize-${mismatch}`);
    pg.state.recovery_deadline = '2026-07-23T11:00:00.000Z';
    pg.rows[1].encryption_key_id = mismatch === 'mixed' ? alternateId : null;
    const before = copy({ state: pg.state, rows: pg.rows });
    await assert.rejects(repository.finalize({
      material: targetMaterial,
      keyId: targetId,
      mode: 'canonical-v1',
      recoveryKeyId: legacyId,
      requestId: `finalize-${mismatch}`,
      now: new Date('2026-07-23T12:00:00.000Z'),
    }), { code: 'WEBHOOK_ROW_KEY_MISMATCH' });
    assert.deepEqual(pg.state, before.state);
    assert.deepEqual(pg.rows, before.rows);
  }

  const { pg, repository } = await rotatedFixture('finalize-current');
  pg.state.recovery_deadline = '2026-07-23T11:00:00.000Z';
  const result = await repository.finalize({
    material: targetMaterial,
    keyId: targetId,
    mode: 'canonical-v1',
    recoveryKeyId: legacyId,
    requestId: 'finalize-current',
    now: new Date('2026-07-23T12:00:00.000Z'),
  });
  assert.equal(result.affectedCount, pg.rows.length);
  assert.equal(result.verifiedCount, pg.rows.length);
  assert.equal(pg.state.recovery_key_id, null);
  const lockIndex = pg.calls.findIndex(({ sql }) => /ORDER BY id FOR UPDATE/.test(sql));
  const clearIndex = pg.calls.findIndex(({ sql }) => /SET recovery_key_id = NULL/.test(sql));
  assert.ok(lockIndex >= 0 && clearIndex > lockIndex);
});

test('internal platform-maintenance audit is sanitized and transaction-coupled to transforms', async () => {
  const pg = new MemoryPg({ rows: legacyRows() });
  const events = [];
  const repository = buildWebhookMasterKeyRepository(pg, {
    auditWriter: async (_client, event) => events.push(copy(event)),
  });
  await repository.adopt({
    material: legacyMaterial,
    keyId: legacyId,
    managed: false,
    requestId: 'adopt-audited',
  });
  const event = events.at(-1);
  assert.equal(event.actionType, 'webhook.master-key.adopt');
  assert.equal(event.actorId, 'falcone:platform-maintenance');
  assert.equal(event.tenantId, null);
  assert.equal(event.newState.source, 'platform-maintenance');
  assert.equal(event.newState.requestId, 'adopt-audited');
  assert.equal(event.newState.targetKeyId, legacyId);
  assert.equal(event.newState.affectedCount, 3);
  assert.doesNotMatch(JSON.stringify(event), /synthetic historical fixture|secret_cipher|secret_iv|v1:[A-Za-z0-9_-]{43}/);

  const failedPg = new MemoryPg({ rows: legacyRows() });
  const before = copy(failedPg.rows);
  const failedRepository = buildWebhookMasterKeyRepository(failedPg, {
    auditWriter: async () => { throw new Error('synthetic internal audit outage'); },
  });
  await assert.rejects(failedRepository.adopt({
    material: legacyMaterial,
    keyId: legacyId,
    requestId: 'adopt-audit-outage',
  }), { code: 'WEBHOOK_LIFECYCLE_FAILED' });
  assert.equal(failedPg.state, null);
  assert.deepEqual(failedPg.rows, before);
});

test('rotation refuses active consumers and same-identity targets before row access', async () => {
  const pg = new MemoryPg({ rows: legacyRows() });
  const repository = buildWebhookMasterKeyRepository(pg);
  await repository.adopt({ material: legacyMaterial, keyId: legacyId, requestId: 'adopt-guards' });
  await assert.rejects(repository.rotate({
    sourceMaterial: legacyMaterial, sourceKeyId: legacyId, sourceMode: 'legacy',
    targetMaterial, targetKeyId: targetId, requestId: 'rotate-active', rotationId: 'rotation-active',
    recoveryWindowSeconds: 3600, quiesced: false,
  }), { code: 'WEBHOOK_CONSUMERS_NOT_QUIESCED' });
  await assert.rejects(repository.rotate({
    sourceMaterial: legacyMaterial, sourceKeyId: legacyId, sourceMode: 'legacy',
    targetMaterial, targetKeyId: legacyId, requestId: 'rotate-same', rotationId: 'rotation-same',
    recoveryWindowSeconds: 3600, quiesced: true,
  }), { code: 'WEBHOOK_KEY_IDENTITY_CONFLICT' });
});

test('mid-row rotation failure rolls back every prior transformation and preserves source state', async () => {
  const pg = new MemoryPg({ rows: legacyRows() });
  const repository = buildWebhookMasterKeyRepository(pg);
  await repository.adopt({ material: legacyMaterial, keyId: legacyId, requestId: 'adopt-rollback' });
  const target = createCanonicalWebhookKeyContext(targetMaterial, targetId);
  Object.assign(pg.rows[1], rename(encryptSecret('incompatible-rotation-row', target)), { encryption_key_id: legacyId });
  const before = copy({ state: pg.state, rows: pg.rows });

  await assert.rejects(repository.rotate({
    sourceMaterial: legacyMaterial, sourceKeyId: legacyId, sourceMode: 'legacy',
    targetMaterial, targetKeyId: targetId, requestId: 'rotate-rollback', rotationId: 'rotation-rollback',
    recoveryWindowSeconds: 3600, quiesced: true,
  }), { code: 'WEBHOOK_LIFECYCLE_FAILED' });
  assert.deepEqual(pg.state, before.state);
  assert.deepEqual(pg.rows, before.rows);
  const failure = pg.ledgers.find((row) => row.request_id === 'rotate-rollback');
  assert.equal(failure.error_message, 'Webhook key lifecycle operation failed');
});

test('lost rotation commit acknowledgement records recovery-required and identical retry resumes without re-encryption', async () => {
  const pg = new MemoryPg({ rows: legacyRows() });
  const repository = buildWebhookMasterKeyRepository(pg);
  await repository.adopt({ material: legacyMaterial, keyId: legacyId, requestId: 'adopt-ambiguous' });
  pg.loseCommitAckOnce = true;
  const request = {
    sourceMaterial: legacyMaterial, sourceKeyId: legacyId, sourceMode: 'legacy',
    targetMaterial, targetKeyId: targetId, targetManaged: true,
    requestId: 'rotate-ambiguous', rotationId: 'rotation-ambiguous',
    recoveryWindowSeconds: 3600, quiesced: true,
  };
  await assert.rejects(repository.rotate(request), { code: 'WEBHOOK_KEY_STATE_AMBIGUOUS' });
  assert.equal(pg.state.lifecycle_state, 'recovery_required');
  assert.equal(pg.state.current_key_id, targetId);
  assert.equal(pg.ledgers.find((row) => row.request_id === request.requestId).lifecycle_state, 'recovery_required');
  const replayBinding = {
    requestId: request.requestId,
    action: 'rotate',
    rotationId: request.rotationId,
    sourceKeyId: legacyId,
    targetKeyId: targetId,
    targetManaged: true,
    recoveryWindowSeconds: 3600,
  };
  assert.equal(
    (await repository.authorizeQuiescedReplay(replayBinding)).state,
    'recovery_required',
  );
  await assert.rejects(
    repository.authorizeQuiescedReplay({
      ...replayBinding,
      targetManaged: false,
    }),
    { code: 'WEBHOOK_LIFECYCLE_REQUEST_CONFLICT' },
  );
  await assert.rejects(
    repository.rotate({ ...request, targetManaged: false }),
    { code: 'WEBHOOK_LIFECYCLE_REQUEST_CONFLICT' },
  );
  const transformations = pg.calls.filter(({ sql }) => /UPDATE webhook_signing_secrets SET secret_cipher/.test(sql)).length;

  const resumed = await repository.rotate(request);
  assert.equal(resumed.state, 'completed');
  assert.equal(pg.state.lifecycle_state, 'serving');
  assert.equal(pg.calls.filter(({ sql }) => /UPDATE webhook_signing_secrets SET secret_cipher/.test(sql)).length, transformations);
});
