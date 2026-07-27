/**
 * Black-box tests for change fix-storage-per-bucket-credential-scope (#673).
 *
 * Defect (confirmed live build head-20260620): the kind control-plane issued ONE
 * per-WORKSPACE SeaweedFS identity (`falcone-ws-<workspaceId>`) and every bucket
 * provision ran `s3.configure -apply -user <that identity> -buckets <newBucket>`.
 * SeaweedFS `-apply` MERGES, so the single identity accumulated a grant for EVERY
 * bucket in the workspace AND a fresh access key each provision — nothing revoked. A
 * credential advertised as scoped to bucket A could ListObjectsV2 buckets B and C in
 * the same workspace (HTTP 200; spec requires 403). Cross-TENANT isolation was fine.
 *
 * Fix: the identity is keyed on the physical BUCKET name (globally unique, workspace-
 * embedding), seeded via delete-then-apply so a (re)provision yields exactly one active
 * key scoped to ONLY that bucket; plus explicit rotate (POST) / revoke (DELETE) routes.
 *
 * This suite drives the PUBLIC surface only:
 *   - seaweedfs-identity.mjs (per-bucket name, seed/revoke Job manifests, issue/revoke)
 *   - STORAGE_HANDLERS.storageRotateCredential / storageRevokeCredential
 *
 * Acceptance scenarios encoded (from the issue):
 *   - "Per-bucket scope enforced": distinct buckets get DISTINCT identities, each seeded
 *     scoped to ONLY its own bucket (the S3-gateway AccessDenied is then a consequence of
 *     the per-bucket identity; the live 403 is proven in the consolidated kind run).
 *   - "Credential revocation": a rotate re-issues so the prior identity/key is deleted
 *     first; a revoke deletes the identity (and all its keys) so the prior key no longer
 *     authenticates; stale keys do not accumulate.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  bucketIdentityName,
  workspaceIdentityName,
  seedJobManifest,
  revokeJobManifest,
  legacyCleanupJobManifest,
  cleanupLegacyWorkspaceIdentities,
  issueBucketIdentity,
  revokeBucketIdentity,
  isInCluster,
  LEGACY_WS_IDENTITY_PREFIX,
  LEGACY_WS_IDENTITY_RE,
} from '../../apps/control-plane/seaweedfs-identity.mjs';
import { STORAGE_HANDLERS } from '../../apps/control-plane/storage-handlers.mjs';

const { storageRotateCredential, storageRevokeCredential } = STORAGE_HANDLERS;

// ---------------------------------------------------------------------------
// Fixtures (mirror storage-bucket-ownership-idor.test.mjs)
// ---------------------------------------------------------------------------
const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const WS_A = 'ws-aaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const WS_B = 'ws-bbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
// Two distinct physical buckets in the SAME workspace (the #673 intra-workspace case).
const BUCKET_A1 = 'ws-hashaaa1-assets';
const BUCKET_A2 = 'ws-hashaaa1-uploads';
const BUCKET_B1 = 'ws-hashbbb1-assets';

const BUCKET_ROWS = {
  [BUCKET_A1]: { id: 'id-a1', workspace_id: WS_A, tenant_id: TENANT_A, bucket_name: BUCKET_A1, region: 'us-east-1', created_at: '2026-01-01T00:00:00Z' },
  [BUCKET_A2]: { id: 'id-a2', workspace_id: WS_A, tenant_id: TENANT_A, bucket_name: BUCKET_A2, region: 'us-east-1', created_at: '2026-01-01T00:00:00Z' },
  [BUCKET_B1]: { id: 'id-b1', workspace_id: WS_B, tenant_id: TENANT_B, bucket_name: BUCKET_B1, region: 'us-east-1', created_at: '2026-01-01T00:00:00Z' },
};

function makeMockPool({ buckets = BUCKET_ROWS } = {}) {
  return {
    query(sql, params) {
      const s = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (s.includes('from workspace_buckets') && s.includes('where bucket_name')) {
        const row = buckets[params[0]] ?? null;
        return Promise.resolve({ rows: row ? [row] : [] });
      }
      return Promise.resolve({ rows: [] });
    },
  };
}

// An injectable k8s client that records the Jobs the issuer/revoker post and reports
// each Job as immediately complete (so waitJobComplete resolves without real polling).
function recordingClient() {
  const calls = [];
  const client = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'POST') return { metadata: { name: body.metadata.name } };
    if (method === 'GET') return { status: { succeeded: 1 }, spec: { backoffLimit: 4 } };
    return {};
  };
  return { calls, client };
}

const tenantAIdentity = { sub: 'user-a', tenantId: TENANT_A, workspaceId: WS_A, actorType: 'tenant_owner' };
const tenantBIdentity = { sub: 'user-b', tenantId: TENANT_B, workspaceId: WS_B, actorType: 'tenant_owner' };
const superadminIdentity = { sub: 'sa', tenantId: null, actorType: 'superadmin' };

// Extract the posted Job's container env as a {NAME: value} map.
const jobEnv = (manifest) => Object.fromEntries(manifest.spec.template.spec.containers[0].env.map((e) => [e.name, e.value]));
const jobCmd = (manifest) => manifest.spec.template.spec.containers[0].command.join(' ');
const assertRestrictedJob = (manifest, { openshiftRestricted = false } = {}) => {
  assert.deepEqual(
    manifest.spec.template.spec.securityContext,
    { seccompProfile: { type: 'RuntimeDefault' } },
    'the one-shot pod satisfies restricted Pod Security',
  );
  assert.deepEqual(
    manifest.spec.template.spec.containers[0].securityContext,
    {
      allowPrivilegeEscalation: false,
      capabilities: { drop: ['ALL'] },
      readOnlyRootFilesystem: true,
      runAsNonRoot: true,
      ...(!openshiftRestricted ? { runAsUser: 1000, runAsGroup: 1000 } : {}),
    },
    'the one-shot container is non-root, immutable, and drops all capabilities',
  );
};

// ===========================================================================
// Scenario "Per-bucket scope enforced" — distinct buckets get distinct identities,
// each scoped to ONLY its own bucket (no accumulation across the workspace).
// ===========================================================================
test('bbx-673-01: distinct buckets in the SAME workspace get DISTINCT identities', () => {
  const idA1 = bucketIdentityName(BUCKET_A1);
  const idA2 = bucketIdentityName(BUCKET_A2);
  assert.notEqual(idA1, idA2, 'two buckets in one workspace must not share an identity (the #673 accumulation)');
  // deterministic + DNS-safe + bounded
  assert.equal(idA1, bucketIdentityName(BUCKET_A1), 'same bucket -> same identity (idempotent re-provision)');
  assert.match(idA1, /^[a-z0-9-]{3,63}$/);
  assert.ok(idA1.length <= 63);
});

test('bbx-673-02: each bucket identity is seeded scoped to ONLY its own bucket', () => {
  const m = seedJobManifest({ ns: 'falcone', name: 'bktid-a1', identityName: bucketIdentityName(BUCKET_A1), accessKey: 'flcs3test', secretKey: 'sectest', bucket: BUCKET_A1 });
  const env = jobEnv(m);
  assert.equal(env.BUCKET, BUCKET_A1, 'the seed grant names ONLY this bucket');
  assert.equal(env.ACTIONS, 'Read,Write,List');
  assert.doesNotMatch(env.ACTIONS, /Admin/, 'no Admin');
  const cmd = jobCmd(m);
  assert.ok(cmd.includes('-buckets %s') && cmd.includes('"$BUCKET"'), 'grant is -buckets scoped (no wildcard/global)');
  assert.doesNotMatch(cmd, /-buckets\s+\*/, 'no wildcard bucket');
  assert.ok(cmd.includes('-filer="$SW_FILER"'), 'the IAM client receives the explicit filer endpoint');
  assert.equal(
    m.spec.template.spec.containers[0].image,
    'chrislusf/seaweedfs@sha256:f0b358973e81f884304737645dd3b278c590c2c9d47d60089729d46324f70495',
    'the standalone fallback is immutable rather than a mutable public tag',
  );
  assertRestrictedJob(m);
});

// ===========================================================================
// Scenario "Credential revocation / rotation" — the seed Job deletes the prior
// identity BEFORE applying a fresh single key (so keys never accumulate), and the
// revoke Job deletes the identity (and all its keys) so the prior key is rejected.
// ===========================================================================
test('bbx-673-03: seed Job deletes the prior identity then applies ONE fresh key (no accumulation)', () => {
  const cmd = jobCmd(seedJobManifest({ ns: 'falcone', name: 'x', identityName: 'falcone-s3-abc', accessKey: 'flcs3test', secretKey: 'sectest', bucket: BUCKET_A1 }));
  assert.ok(cmd.includes('-delete -apply -user'), 'a re-provision deletes the prior identity first');
  // ordering: the delete precedes the apply that writes the new access/secret key
  assert.ok(cmd.indexOf('-delete -apply -user') < cmd.indexOf('-access_key'), 'delete precedes the fresh apply');
});

test('bbx-673-04: revoke Job deletes the identity by name (and carries no key material)', () => {
  const m = revokeJobManifest({ ns: 'falcone', name: 'bktrm-a1', identityName: bucketIdentityName(BUCKET_A1) });
  const cmd = jobCmd(m);
  assert.ok(cmd.includes('-delete -apply -user'), 'revoke is a delete-and-reload');
  const env = jobEnv(m);
  assert.ok(!('AK' in env) && !('SK' in env), 'revoke carries no access/secret key');
  assert.equal(env.ID_NAME, bucketIdentityName(BUCKET_A1));
  assert.equal(m.spec.template.metadata.labels['app.kubernetes.io/name'], 'seaweedfs', 'labelled for the netpol');
  assert.ok(cmd.includes('-filer="$SW_FILER"'), 'the IAM client receives the explicit filer endpoint');
  assertRestrictedJob(m);
});

test('bbx-673-05: revokeBucketIdentity refuses an empty bucket (fail-closed)', async () => {
  await assert.rejects(() => revokeBucketIdentity({ bucket: '' }), /bucket/);
  assert.throws(() => revokeJobManifest({ ns: 'falcone', name: 'x', identityName: '' }), /identityName/);
});

test('bbx-673-05b: every runtime IAM Job inherits Harbor pull policy/secrets and restricted-v2 UID assignment', () => {
  const runtime = {
    ns: 'falcone-prod',
    image: 'harbor.example.com/falcone/chrislusf/seaweedfs@sha256:f0b358973e81f884304737645dd3b278c590c2c9d47d60089729d46324f70495',
    imagePullPolicy: 'Always',
    imagePullSecrets: ['harbor-pull', 'harbor-pull', 'backup-pull'],
    openshiftRestricted: true,
    master: 'release-seaweedfs-master.falcone-prod:9333',
    filer: 'release-seaweedfs-filer.falcone-prod:8888',
  };
  const manifests = [
    seedJobManifest({
      ...runtime,
      name: 'seed',
      identityName: bucketIdentityName(BUCKET_A1),
      accessKey: 'ak',
      secretKey: 'sk',
      bucket: BUCKET_A1,
    }),
    revokeJobManifest({
      ...runtime,
      name: 'revoke',
      identityName: bucketIdentityName(BUCKET_A1),
    }),
    legacyCleanupJobManifest({ ...runtime, name: 'cleanup' }),
  ];

  for (const manifest of manifests) {
    const pod = manifest.spec.template.spec;
    const container = pod.containers[0];
    assert.equal(container.image, runtime.image);
    assert.equal(container.imagePullPolicy, 'Always');
    assert.deepEqual(
      pod.imagePullSecrets,
      [{ name: 'harbor-pull' }, { name: 'backup-pull' }],
      'pull Secret names are normalized and de-duplicated',
    );
    assertRestrictedJob(manifest, { openshiftRestricted: true });
    assert.equal('runAsUser' in container.securityContext, false, 'restricted-v2 assigns the UID');
    assert.equal('runAsGroup' in container.securityContext, false, 'restricted-v2 assigns the GID');
  }

  assert.throws(
    () => revokeJobManifest({ ...runtime, name: 'bad-policy', identityName: 'identity', imagePullPolicy: 'Sometimes' }),
    /invalid SEAWEEDFS_IMAGE_PULL_POLICY/,
  );
  assert.throws(
    () => legacyCleanupJobManifest({ ...runtime, name: 'bad-secret', imagePullSecrets: ['NOT_A_SECRET'] }),
    /invalid Kubernetes Secret name/,
  );
});

// ===========================================================================
// Handler-level: rotate + revoke, ownership-gated, with an injected k8s client.
// ===========================================================================
test('bbx-673-06: storageRotateCredential returns a FRESH cred + posts a delete-then-apply Job', async () => {
  const pool = makeMockPool();
  const { calls, client } = recordingClient();
  const ctx = { params: { bucketId: BUCKET_A1 }, query: {}, identity: tenantAIdentity, pool, seaweedClient: client };
  const res = await storageRotateCredential(ctx);
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
  const cred = res.body.storageCredential;
  // same shape as provision (identityName/accessKey/secretKey/bucket/actions)
  assert.equal(cred.bucket, BUCKET_A1);
  assert.equal(cred.identityName, bucketIdentityName(BUCKET_A1));
  assert.ok(cred.accessKey && cred.secretKey, 'fresh key material returned once');
  assert.deepEqual(cred.actions, ['Read', 'Write', 'List']);
  // the posted Job is a delete-then-apply scoped to ONLY this bucket
  const post = calls.find((c) => c.method === 'POST');
  assert.ok(post, 'a Job was posted');
  const cmd = jobCmd(post.body);
  assert.ok(cmd.includes('-delete -apply -user'), 'rotation deletes the prior identity first (prior key rejected)');
  assert.equal(jobEnv(post.body).BUCKET, BUCKET_A1);
});

test('bbx-673-07: storageRevokeCredential posts a DELETE Job and reports revoked', async () => {
  const pool = makeMockPool();
  const { calls, client } = recordingClient();
  const ctx = { params: { bucketId: BUCKET_A1 }, query: {}, identity: tenantAIdentity, pool, seaweedClient: client };
  const res = await storageRevokeCredential(ctx);
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.revoked, true);
  assert.equal(res.body.bucket, BUCKET_A1);
  const post = calls.find((c) => c.method === 'POST');
  assert.ok(post, 'a revoke Job was posted');
  assert.ok(jobCmd(post.body).includes('-delete -apply -user'), 'the identity is deleted (prior key rejected)');
  assert.equal(jobEnv(post.body).ID_NAME, bucketIdentityName(BUCKET_A1));
});

test('bbx-673-08: rotate DENIES a non-owning tenant with 404 (no existence leak, no Job)', async () => {
  const pool = makeMockPool();
  const { calls, client } = recordingClient();
  // Tenant B targets Tenant A's bucket.
  const ctx = { params: { bucketId: BUCKET_A1 }, query: {}, identity: tenantBIdentity, pool, seaweedClient: client };
  const res = await storageRotateCredential(ctx);
  assert.equal(res.statusCode, 404, `cross-tenant rotate must 404, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
  assert.equal(calls.length, 0, 'no Job may be posted for a denied caller');
  // and the denial must not leak that the bucket exists / belongs to another tenant
  assert.ok(!JSON.stringify(res.body).includes(TENANT_A), 'no owner leak');
});

test('bbx-673-09: revoke DENIES a non-owning tenant with 404 (no Job)', async () => {
  const pool = makeMockPool();
  const { calls, client } = recordingClient();
  const ctx = { params: { bucketId: BUCKET_A1 }, query: {}, identity: tenantBIdentity, pool, seaweedClient: client };
  const res = await storageRevokeCredential(ctx);
  assert.equal(res.statusCode, 404, `cross-tenant revoke must 404, got ${res.statusCode}`);
  assert.equal(calls.length, 0, 'no Job may be posted for a denied caller');
});

test('bbx-673-10: rotate/revoke on a non-existent bucket → 404', async () => {
  const pool = makeMockPool();
  const { calls, client } = recordingClient();
  const ctx = { params: { bucketId: 'ws-nope-missing' }, query: {}, identity: tenantAIdentity, pool, seaweedClient: client };
  assert.equal((await storageRotateCredential(ctx)).statusCode, 404);
  assert.equal((await storageRevokeCredential(ctx)).statusCode, 404);
  assert.equal(calls.length, 0, 'no Job for a missing bucket');
});

test('bbx-673-11: superadmin may rotate any tenant bucket (cross-tenant bypass)', async () => {
  const pool = makeMockPool();
  const { calls, client } = recordingClient();
  const ctx = { params: { bucketId: BUCKET_B1 }, query: {}, identity: superadminIdentity, pool, seaweedClient: client };
  const res = await storageRotateCredential(ctx);
  assert.equal(res.statusCode, 200, `superadmin rotate should succeed, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.storageCredential.identityName, bucketIdentityName(BUCKET_B1));
  assert.ok(calls.some((c) => c.method === 'POST'), 'a Job was posted for the superadmin rotate');
});

// Direct issuer round-trip: re-issuing the SAME bucket keeps the SAME identity name
// (idempotent) while each call posts its own delete-then-apply Job (clean rotate).
test('bbx-673-12: re-issuing a bucket keeps one identity name and always delete-then-applies', async () => {
  const { calls, client } = recordingClient();
  const first = await issueBucketIdentity({ bucket: BUCKET_A1, workspaceId: WS_A, ns: 'falcone', client, keys: { accessKey: 'flcs3test', secretKey: 'sectest' }, jobSuffix: 'aaaa' });
  const second = await issueBucketIdentity({ bucket: BUCKET_A1, workspaceId: WS_A, ns: 'falcone', client, keys: { accessKey: 'flcs3test2', secretKey: 'sectest2' }, jobSuffix: 'bbbb' });
  assert.equal(first.identityName, second.identityName, 'same bucket -> stable identity name');
  const posts = calls.filter((c) => c.method === 'POST');
  assert.equal(posts.length, 2, 'each re-issue posts its own Job');
  for (const p of posts) assert.ok(jobCmd(p.body).includes('-delete -apply -user'), 'every (re)issue deletes the prior identity first');
});

// ===========================================================================
// Scenario "Legacy over-granted credential invalidated on upgrade" (#673) — the
// FORWARD migration. Switching the issuer to per-bucket identities is forward-only and
// leaves the pre-existing per-WORKSPACE identities (`falcone-ws-<wsId>`) LIVE in
// SeaweedFS, where they keep authenticating with cross-bucket access (including against a
// re-created, deterministically-named bucket). These tests pin the cleanup that actually
// invalidates them on deploy.
// ===========================================================================
test('bbx-673-13: legacyCleanupJobManifest deletes EVERY falcone-ws-* identity via s3.configure -delete -apply (no wildcard/Admin)', () => {
  const m = legacyCleanupJobManifest({
    ns: 'falcone',
    name: 'ws-legacy-cleanup-x',
    master: 'release-seaweedfs-master.falcone:9333',
    filer: 'release-seaweedfs-filer.falcone:8888',
  });
  const cmd = jobCmd(m);
  // enumerates legacy identities from the LIVE config dump (catches orphaned ones), not the DB
  assert.ok(cmd.includes('s3.configure') && cmd.includes('weed shell'), 'dumps the live identity config via weed shell s3.configure');
  assert.ok(/grep -oE ['"]?falcone-ws-/.test(cmd), 'greps the legacy falcone-ws- identity names out of the dump');
  // deletes each matched identity with the canonical delete-and-live-reload
  assert.ok(cmd.includes('-delete -apply -user'), 'deletes each legacy identity (delete-and-reload)');
  // it must NEVER introduce a grant: no apply-with-keys, no wildcard, no Admin
  assert.ok(!cmd.includes('-access_key') && !cmd.includes('-secret_key'), 'cleanup carries NO key material (delete-only)');
  assert.doesNotMatch(cmd, /-buckets\s+\*/, 'no wildcard bucket grant introduced');
  assert.doesNotMatch(cmd, /-actions[^|]*Admin/, 'no Admin grant introduced');
  // targets ONLY the legacy prefix — the new per-bucket identities (falcone-s3-*) are not matched
  assert.ok(!/falcone-s3-/.test(cmd), 'the cleanup never targets the new per-bucket identities');
  // labelled for the SeaweedFS NetworkPolicy, like the seed/revoke Jobs
  assert.equal(m.spec.template.metadata.labels['app.kubernetes.io/name'], 'seaweedfs');
  const env = jobEnv(m);
  assert.equal(env.SW_MASTER, 'release-seaweedfs-master.falcone:9333', 'master endpoint wired via env');
  assert.equal(env.SW_FILER, 'release-seaweedfs-filer.falcone:8888', 'filer endpoint wired explicitly so IAM calls do not hang on discovery');
  assert.ok(cmd.includes('-filer="$SW_FILER"'), 'every IAM shell call uses the explicit filer');
  assertRestrictedJob(m);
});

test('bbx-673-13b: the legacy-identity matcher catches every workspaceIdentityName (and the dump format) but NOT per-bucket identities', () => {
  // The JS regex documents the same names the cleanup Job greps for. It must match every
  // name workspaceIdentityName produces (the legacy issuer) and NOT the new per-bucket
  // identities — keeping the in-code matcher and the shell grep in lock-step.
  for (const ws of [WS_A, WS_B, 'ws-orphan-9', 'Ws_Mixed-Case']) {
    const legacy = workspaceIdentityName(ws);
    assert.ok(legacy.startsWith(LEGACY_WS_IDENTITY_PREFIX), `${legacy} carries the legacy prefix`);
    assert.match(legacy, new RegExp(`^${LEGACY_WS_IDENTITY_RE.source}$`), `${legacy} matches the legacy matcher`);
  }
  // a new per-bucket identity must NOT be matched as legacy
  assert.doesNotMatch(bucketIdentityName(BUCKET_A1), new RegExp(`^${LEGACY_WS_IDENTITY_RE.source}$`));
  // applied to the VERIFIED weed-shell dump shape, the matcher extracts exactly the legacy names
  const dump = JSON.stringify({ identities: [
    { name: 'anvAdmin', actions: ['Admin'] },
    { name: workspaceIdentityName(WS_A), actions: ['Read:' + BUCKET_A1, 'Read:' + BUCKET_A2] },
    { name: 'falcone-ws-ws-orphan-9', actions: ['Read:ws-h9-gone'] },
    { name: bucketIdentityName(BUCKET_A1), actions: ['Read:' + BUCKET_A1] },
  ] });
  const found = [...new Set(dump.match(LEGACY_WS_IDENTITY_RE) ?? [])].sort();
  assert.deepEqual(found, [workspaceIdentityName(WS_A), 'falcone-ws-ws-orphan-9'].sort(),
    'enumerating from the live dump yields the legacy names only (incl. the orphan), excluding admin + per-bucket');
});

test('bbx-673-14: cleanupLegacyWorkspaceIdentities posts the cleanup Job (in-cluster) and waits when asked', async () => {
  const { calls, client } = recordingClient();
  const res = await cleanupLegacyWorkspaceIdentities({ ns: 'falcone', client, token: 'fake-sa-token', jobSuffix: 'abcd', wait: true });
  assert.equal(res.posted, true, `expected the Job to be posted, got ${JSON.stringify(res)}`);
  const post = calls.find((c) => c.method === 'POST');
  assert.ok(post, 'a cleanup Job was posted');
  assert.match(post.path, /\/apis\/batch\/v1\/namespaces\/falcone\/jobs$/);
  assert.equal(post.body.metadata.labels.app, 'falcone-ws-identity-legacy-cleanup');
  assert.ok(jobCmd(post.body).includes('-delete -apply -user'), 'the posted Job deletes legacy identities');
});

test('bbx-673-15: cleanupLegacyWorkspaceIdentities is a NON-FATAL no-op when not in-cluster (no SA token)', async () => {
  const { calls, client } = recordingClient();
  // No token → not in a pod → it must NOT throw and must NOT post a Job (local/test runs).
  let res;
  await assert.doesNotReject(async () => { res = await cleanupLegacyWorkspaceIdentities({ ns: 'falcone', client, token: '', jobSuffix: 'abcd' }); });
  assert.equal(res.posted, false);
  assert.equal(res.skipped, 'not-in-cluster');
  assert.equal(calls.length, 0, 'no Job posted when not in-cluster');
  // isInCluster reflects the token presence
  assert.equal(isInCluster(''), false);
  assert.equal(isInCluster('   '), false);
  assert.equal(isInCluster('tok'), true);
});

test('bbx-673-16: cleanupLegacyWorkspaceIdentities NEVER throws even if the client errors (best-effort)', async () => {
  const throwingClient = async () => { throw new Error('apiserver exploded'); };
  let res;
  await assert.doesNotReject(async () => { res = await cleanupLegacyWorkspaceIdentities({ ns: 'falcone', client: throwingClient, token: 'fake-sa-token', jobSuffix: 'abcd' }); });
  assert.equal(res.posted, false, 'a failed post is reported, not thrown');
  assert.match(res.error, /apiserver exploded/);
});

// ===========================================================================
// Revoke / rotate must ALSO delete the LEGACY per-workspace identity (#673) so a single
// revoke/rotate between deploys kills EVERY key that can reach the bucket — not just the
// per-bucket identity the post-fix issuer created.
// ===========================================================================
test('bbx-673-17: storageRevokeCredential deletes BOTH the per-bucket AND the legacy falcone-ws-<wsId> identity', async () => {
  const pool = makeMockPool();
  const { calls, client } = recordingClient();
  const ctx = { params: { bucketId: BUCKET_A1 }, query: {}, identity: tenantAIdentity, pool, seaweedClient: client };
  const res = await storageRevokeCredential(ctx);
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
  const deletedNames = calls.filter((c) => c.method === 'POST').map((c) => jobEnv(c.body).ID_NAME);
  assert.ok(deletedNames.includes(bucketIdentityName(BUCKET_A1)), 'the per-bucket identity is deleted (primary)');
  assert.ok(deletedNames.includes(workspaceIdentityName(WS_A)), 'the LEGACY per-workspace identity is ALSO deleted (the #673 over-granted key)');
  for (const c of calls.filter((c) => c.method === 'POST')) {
    assert.ok(jobCmd(c.body).includes('-delete -apply -user'), 'each is a delete-and-reload');
  }
});

test('bbx-673-18: storageRotateCredential ALSO removes the legacy falcone-ws-<wsId> identity (rotated key is the only one reaching the bucket)', async () => {
  const pool = makeMockPool();
  const { calls, client } = recordingClient();
  const ctx = { params: { bucketId: BUCKET_A1 }, query: {}, identity: tenantAIdentity, pool, seaweedClient: client };
  const res = await storageRotateCredential(ctx);
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
  const posts = calls.filter((c) => c.method === 'POST');
  // the fresh per-bucket identity is (re)applied (delete-then-apply, carries key material)
  assert.ok(posts.some((c) => jobEnv(c.body).ID_NAME === bucketIdentityName(BUCKET_A1) && 'AK' in jobEnv(c.body)), 'a fresh per-bucket key is applied');
  // the legacy per-workspace identity is deleted (no key material on that Job)
  const legacyDelete = posts.find((c) => jobEnv(c.body).ID_NAME === workspaceIdentityName(WS_A));
  assert.ok(legacyDelete, 'the LEGACY per-workspace identity is deleted on rotate');
  assert.ok(!('AK' in jobEnv(legacyDelete.body)), 'the legacy delete carries no key material');
});

test('bbx-673-19: a best-effort legacy delete failure does NOT fail the revoke/rotate (per-bucket action is primary)', async () => {
  const pool = makeMockPool();
  // A client that succeeds for the per-bucket Job but throws for the legacy per-workspace one.
  const wsName = workspaceIdentityName(WS_A);
  const calls = [];
  const flakyClient = async (method, path, body) => {
    calls.push({ method, path, body });
    if (method === 'POST' && body && jobEnv(body).ID_NAME === wsName) throw new Error('legacy delete failed');
    if (method === 'POST') return { metadata: { name: body.metadata.name } };
    if (method === 'GET') return { status: { succeeded: 1 }, spec: { backoffLimit: 4 } };
    return {};
  };
  const ctx = { params: { bucketId: BUCKET_A1 }, query: {}, identity: tenantAIdentity, pool, seaweedClient: flakyClient };
  const revoked = await storageRevokeCredential(ctx);
  assert.equal(revoked.statusCode, 200, 'revoke still succeeds even if the best-effort legacy delete throws');
  const rotated = await storageRotateCredential({ ...ctx, params: { bucketId: BUCKET_A1 } });
  assert.equal(rotated.statusCode, 200, 'rotate still succeeds even if the best-effort legacy delete throws');
  assert.ok(calls.some((c) => c.method === 'POST' && jobEnv(c.body).ID_NAME === wsName), 'the legacy delete was attempted');
});
