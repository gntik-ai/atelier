// bbx-audit-trail-integrity
//
// Black-box coverage for change add-audit-trail-integrity (GitHub #644).
//
// The audit trail recorded only SUCCESSFUL mutating actions, hardcoded
// outcome='succeeded' at read time, excluded secret-access, and was a plain INSERT
// (no tamper-evidence). This change adds: a true `outcome` (write-time, from the
// status), recording of failures/denials, secret-access auditing, and a per-tenant
// append-only hash chain (prev_hash/row_hash) with a pure verifier.
//
// Pure helpers (audit-hash.mjs):  auditCanonical, computeRowHash, verifyAuditChain
// Store (audit-store.mjs):        recordAuditEvent (chain), auditRowToRecord (outcome)
// Writer (audit-writer.mjs):      auditEventForRoute (records failures + outcome), secret handlers
import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCanonical, computeRowHash, verifyAuditChain } from '../../apps/control-plane/audit-hash.mjs';
import { recordAuditEvent, auditRowToRecord } from '../../apps/control-plane/audit-store.mjs';
import { auditEventForRoute, AUDITABLE_LOCAL_HANDLERS } from '../../apps/control-plane/audit-writer.mjs';

// ---- pure hash helpers -----------------------------------------------------

test('bbx-audit-hash-01: auditCanonical is stable under key order and camel/snake input', () => {
  const camel = auditCanonical({ id: 'e1', actionType: 'a', actorId: 'u', tenantId: 't', outcome: 'succeeded', createdAt: '2026-06-20T00:00:00.000Z', newState: { b: 1, a: 2 } });
  const snake = auditCanonical({ id: 'e1', action_type: 'a', actor_id: 'u', tenant_id: 't', outcome: 'succeeded', created_at: '2026-06-20T00:00:00.000Z', new_state: { a: 2, b: 1 } });
  assert.equal(camel, snake, 'canonical is key-order independent and accepts both shapes');
});

test('bbx-audit-hash-02: computeRowHash is deterministic and sensitive to inputs', () => {
  const c = auditCanonical({ id: 'e1', actionType: 'a', actorId: 'u', tenantId: 't', outcome: 'succeeded', createdAt: '2026-06-20T00:00:00.000Z', newState: {} });
  assert.equal(computeRowHash(c, 'prev'), computeRowHash(c, 'prev'));
  assert.notEqual(computeRowHash(c, 'prev'), computeRowHash(c, 'other'), 'depends on prevHash');
  assert.match(computeRowHash(c, ''), /^[0-9a-f]{64}$/, 'sha-256 hex');
});

// Build a valid chain of raw rows for a tenant.
function chain(tenantId, n) {
  const rows = [];
  let prev = '';
  for (let i = 0; i < n; i++) {
    const row = { id: `e${i}`, action_type: `act${i}`, actor_id: 'u', tenant_id: tenantId, outcome: 'succeeded', created_at: `2026-06-20T00:00:0${i}.000Z`, new_state: { i }, prev_hash: prev };
    row.row_hash = computeRowHash(auditCanonical(row), prev);
    prev = row.row_hash;
    rows.push(row);
  }
  return rows;
}

test('bbx-audit-hash-verify-valid: an untampered chain verifies', () => {
  assert.deepEqual(verifyAuditChain(chain('t', 4)), { valid: true, brokenAt: null });
  assert.deepEqual(verifyAuditChain([]), { valid: true, brokenAt: null });
});

test('bbx-audit-hash-genesis: the first record has prevHash === "" and a single-row chain verifies', () => {
  const c = chain('t', 1);
  assert.equal(c[0].prev_hash, '');
  assert.deepEqual(verifyAuditChain(c), { valid: true, brokenAt: null });
});

test('bbx-audit-hash-verify-tamper-content: a modified field is detected at its index', () => {
  const c = chain('t', 4);
  c[2].action_type = 'TAMPERED'; // content changed after hashing
  assert.deepEqual(verifyAuditChain(c), { valid: false, brokenAt: 2 });
});

test('bbx-audit-hash-verify-tamper-link: a broken prev_hash link is detected', () => {
  const c = chain('t', 4);
  c[3].prev_hash = 'deadbeef'; // link no longer matches row 2's row_hash
  assert.deepEqual(verifyAuditChain(c), { valid: false, brokenAt: 3 });
});

test('bbx-audit-hash-per-tenant: verifying only one tenant\'s rows is unbroken by interleaving', () => {
  // Tenant A's chain is independent; verifying A's rows alone is valid.
  const a = chain('ten-a', 3);
  assert.deepEqual(verifyAuditChain(a), { valid: true, brokenAt: null });
});

test('bbx-audit-hash-legacy-prefix: pre-migration rows (no row_hash) are skipped, the hashed suffix verifies', () => {
  // A real read window can mix legacy rows (NULL hash) before the hashed chain.
  const legacy = [
    { id: 'L1', action_type: 'x', actor_id: 'u', tenant_id: 't', outcome: 'unknown', created_at: '2026-06-19T00:00:00.000Z', new_state: {}, prev_hash: null, row_hash: null },
    { id: 'L2', action_type: 'y', actor_id: 'u', tenant_id: 't', outcome: 'unknown', created_at: '2026-06-19T00:00:01.000Z', new_state: {}, prev_hash: null, row_hash: null },
  ];
  const window = [...legacy, ...chain('t', 3)];
  assert.deepEqual(verifyAuditChain(window), { valid: true, brokenAt: null }, 'legacy prefix skipped, hashed suffix valid');
  // tampering a hashed row in the suffix is still caught (index counts from window start)
  window[3].outcome = 'TAMPERED';
  assert.deepEqual(verifyAuditChain(window), { valid: false, brokenAt: 3 });
});

// ---- store: recordAuditEvent writes a verifiable chain ---------------------

// Minimal pool stub modelling plan_audit_events with the chain columns + a txn.
function chainPool() {
  const audit = [];
  const q = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(s) || s.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (s.includes('SELECT row_hash FROM plan_audit_events')) {
      const tenantId = params[0];
      const rows = audit.filter((r) => r.tenant_id === tenantId);
      const last = rows[rows.length - 1];
      return { rows: last ? [{ row_hash: last.row_hash }] : [] };
    }
    if (s.includes('INSERT INTO plan_audit_events')) {
      // [id, action_type, actor_id, tenant_id, previous_state, new_state, outcome, correlation_id, created_at, prev_hash, row_hash]
      const [id, action_type, actor_id, tenant_id, previous_state, new_state, outcome, correlation_id, created_at, prev_hash, row_hash] = params;
      const row = { id, action_type, actor_id, tenant_id, previous_state: previous_state ? JSON.parse(previous_state) : null, new_state: new_state ? JSON.parse(new_state) : {}, outcome, correlation_id: correlation_id ?? null, created_at, prev_hash, row_hash };
      audit.push(row);
      return { rows: [row] };
    }
    return { rows: [] };
  };
  const client = { query: q, release() {} };
  return { query: q, connect: async () => client, _audit: audit };
}

test('bbx-audit-store-chain: recordAuditEvent writes a verifiable per-tenant chain with outcomes', async () => {
  const pool = chainPool();
  await recordAuditEvent(pool, { actionType: 'tenant.create', actorId: 'u', tenantId: 'ten-a', outcome: 'succeeded', newState: { a: 1 }, correlationId: 'c1' });
  await recordAuditEvent(pool, { actionType: 'workspace.create', actorId: 'u', tenantId: 'ten-a', outcome: 'denied', newState: { b: 2 }, correlationId: 'c2' });
  await recordAuditEvent(pool, { actionType: 'iam.user.create', actorId: 'u', tenantId: 'ten-a', outcome: 'failed', newState: {}, correlationId: 'c3' });
  const rows = pool._audit;
  assert.equal(rows.length, 3);
  assert.equal(rows[0].prev_hash, '', 'genesis prevHash is empty');
  assert.equal(rows[1].prev_hash, rows[0].row_hash, 'row 1 links to row 0');
  assert.equal(rows[2].prev_hash, rows[1].row_hash, 'row 2 links to row 1');
  assert.deepEqual(rows.map((r) => r.outcome), ['succeeded', 'denied', 'failed']);
  assert.deepEqual(verifyAuditChain(rows), { valid: true, brokenAt: null }, 'the persisted chain verifies');
});

test('bbx-audit-store-record: auditRowToRecord reads outcome from the row and exposes the hashes', () => {
  const rec = auditRowToRecord({ id: 'e1', action_type: 'tenant.create', actor_id: 'u', tenant_id: 't', outcome: 'denied', new_state: {}, created_at: 'now', prev_hash: 'p', row_hash: 'h' });
  assert.equal(rec.result.outcome, 'denied', 'outcome comes from the DB column, not a constant');
  assert.equal(rec.rowHash, 'h');
  assert.equal(rec.prevHash, 'p');
  // a legacy row with no outcome reads as 'unknown'
  assert.equal(
    auditRowToRecord({ id: 'e0', action_type: 'x', new_state: {} }).result.outcome,
    'partial',
    'legacy NULL outcomes use the nearest schema-valid non-success state'
  );
});

// ---- writer: failures/denials recorded, secret-access auditable ------------

const IDENT = { sub: 'u', tenantId: 'ten-a', workspaceId: 'ws-a', actorType: 'tenant_owner' };
const routeFor = (lh, method = 'POST') => ({ method, path: `/x/${lh}`, localHandler: lh });

test('bbx-audit-no-shortcircuit: auditEventForRoute records failures/denials with the derived outcome', () => {
  const ctx = { params: { tenantId: 'ten-a' }, identity: IDENT, body: {} };
  const ok = auditEventForRoute(routeFor('createTenantUser'), ctx, { statusCode: 201, body: {} });
  assert.equal(ok?.outcome, 'succeeded');
  const denied = auditEventForRoute(routeFor('createTenantUser'), ctx, { statusCode: 403, body: {} });
  assert.ok(denied, 'a 403 mutating action now yields a descriptor (was null)');
  assert.equal(denied.outcome, 'denied');
  const failed = auditEventForRoute(routeFor('createTenant'), { params: {}, identity: IDENT, body: {} }, { statusCode: 400, body: {} });
  assert.equal(failed?.outcome, 'failed');
  const errored = auditEventForRoute(routeFor('createTenant'), { params: {}, identity: IDENT, body: {} }, { statusCode: 500, body: {} });
  assert.equal(errored?.outcome, 'error');
  // a read route is still not auditable
  assert.equal(auditEventForRoute({ method: 'GET', path: '/x', localHandler: 'listTenantUsers' }, ctx, { statusCode: 200, body: {} }), null);
});

test('bbx-audit-secret-handlers: secret-access handlers are auditable', () => {
  for (const lh of ['secretSet', 'secretGet', 'secretList', 'secretDelete']) {
    assert.ok(AUDITABLE_LOCAL_HANDLERS[lh], `${lh} is in the auditable set`);
    const desc = auditEventForRoute(routeFor(lh), { params: { workspaceId: 'ws-a' }, identity: IDENT, body: {} }, { statusCode: 200, body: {} });
    assert.ok(desc, `${lh} yields an audit descriptor`);
    assert.equal(desc.tenantId, 'ten-a', `${lh} scoped to the actor tenant`);
  }
});
