// Per-BUCKET SeaweedFS identity issuance for the kind control-plane (#553, #673).
//
// In filer-mode (chart: seaweedfs.s3.enableAuth=false + -iam.readOnly=false), the s3
// gateway loads IAM identities from the filer and picks up changes dynamically. Each
// physical bucket gets its OWN identity scoped to ONLY that bucket via
// `weed shell s3.configure -apply` — so a credential can access exactly the one bucket
// it was provisioned for and is AccessDenied on every other bucket (verified live
// 2026-06-18), instead of everyone sharing the broad admin/master key.
//
// #673 — why per-BUCKET and not per-WORKSPACE: `s3.configure -apply` MERGES into the
// named identity (it does not replace), so a single per-workspace identity reused
// across every bucket provision ACCUMULATED a grant for EVERY bucket in the workspace
// AND a fresh access key per provision (one identity held 15 bucket grants + 5 live
// keys live), letting a credential "scoped to bucket A" list/read buckets B and C in
// the same workspace (intra-workspace least-privilege + credential-lifecycle defect;
// cross-TENANT isolation was always fine). The fix keys the identity on the physical
// bucket name — itself globally unique and workspace-embedding (see
// storage-handlers deriveBucketName: `ws-<wsHash12>-<nameFrag40>`) — and makes every
// (re)provision a clean delete-then-apply so a bucket identity carries EXACTLY ONE
// active key scoped to ONLY its bucket; nothing accumulates. The shippable product
// adapters already do this (packages/adapters/src/seaweedfs-s3-identities-config.mjs
// expands every action to `Action:bucket`; storage-programmatic-credentials.mjs has
// rotate/revoke); this kind runtime is brought in line.
//
// The control-plane (node) has no `weed` binary, so it runs a one-shot k8s Job
// (seaweedfs image) that execs the weed-shell seed against the master, then the
// filer-mode gateway authenticates the new key without a restart. The generated keys
// are returned to the caller ONCE (the secret is never persisted here).
//
// NOTE (kind simplification): the seed Job receives the access/secret key via env.
// The shippable product path (packages/adapters storage-tenant-context +
// provisionWorkspaceStorageBoundary, wired by wf-con-003) uses the full credential
// builder + one-time secret envelope; this kind runtime mirrors only what the live
// data-plane needs.
import https from 'node:https';
import fs from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';

const SA = '/var/run/secrets/kubernetes.io/serviceaccount';
const NS = (() => { try { return fs.readFileSync(`${SA}/namespace`, 'utf8').trim(); } catch { return 'falcone'; } })();
const CA = (() => { try { return fs.readFileSync(`${SA}/ca.crt`); } catch { return undefined; } })();
const readToken = () => { try { return fs.readFileSync(`${SA}/token`, 'utf8').trim(); } catch { return ''; } };

// Whether we are running inside a Kubernetes pod with a usable serviceaccount token
// (the only way to POST a one-shot Job). Local/test runs have no SA token, so any
// in-cluster Job action (e.g. the legacy-identity cleanup at boot) must skip cleanly
// rather than fail trying to reach the API server. Pure (token read is injectable).
export function isInCluster(token = readToken()) {
  return Boolean(token && String(token).trim());
}
const HOST = process.env.KUBERNETES_SERVICE_HOST || 'kubernetes.default.svc';
const PORT = process.env.KUBERNETES_SERVICE_PORT || '443';
const DEFAULT_SW_IMAGE = 'chrislusf/seaweedfs@sha256:f0b358973e81f884304737645dd3b278c590c2c9d47d60089729d46324f70495';
const IMAGE_PULL_POLICIES = new Set(['Always', 'IfNotPresent', 'Never']);
const K8S_SECRET_NAME_RE = /^[a-z0-9](?:[-a-z0-9.]*[a-z0-9])?$/;

function imagePullPolicy(value) {
  const policy = String(value ?? 'IfNotPresent').trim();
  if (!IMAGE_PULL_POLICIES.has(policy)) {
    throw new Error(`invalid SEAWEEDFS_IMAGE_PULL_POLICY: ${policy}`);
  }
  return policy;
}

function imagePullSecrets(value) {
  if (!Array.isArray(value)) {
    throw new Error('SEAWEEDFS_IMAGE_PULL_SECRETS must be a JSON array');
  }
  return [...new Set(value.map((entry) => {
    const name = String(typeof entry === 'string' ? entry : entry?.name ?? '').trim();
    if (!name || name.length > 253 || !K8S_SECRET_NAME_RE.test(name)) {
      throw new Error('SEAWEEDFS_IMAGE_PULL_SECRETS contains an invalid Kubernetes Secret name');
    }
    return name;
  }))];
}

function imagePullSecretsFromEnv(value = '[]') {
  try {
    return imagePullSecrets(JSON.parse(value || '[]'));
  } catch (error) {
    throw new Error(`invalid SEAWEEDFS_IMAGE_PULL_SECRETS: ${error.message}`);
  }
}

function booleanEnv(name, value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be "true" or "false"`);
}

const SW_IMAGE = process.env.SEAWEEDFS_IMAGE || DEFAULT_SW_IMAGE;
const SW_IMAGE_PULL_POLICY = imagePullPolicy(process.env.SEAWEEDFS_IMAGE_PULL_POLICY);
const SW_IMAGE_PULL_SECRETS = imagePullSecretsFromEnv(process.env.SEAWEEDFS_IMAGE_PULL_SECRETS);
const SW_OPENSHIFT_RESTRICTED = booleanEnv(
  'SEAWEEDFS_OPENSHIFT_RESTRICTED',
  process.env.SEAWEEDFS_OPENSHIFT_RESTRICTED,
);
const SW_MASTER = process.env.SEAWEEDFS_MASTER || `falcone-seaweedfs-master.${NS}:9333`;
const SW_FILER = process.env.SEAWEEDFS_FILER || `falcone-seaweedfs-filer.${NS}:8888`;

function restrictedJobPodSecurityContext() {
  return { seccompProfile: { type: 'RuntimeDefault' } };
}

function restrictedJobContainerSecurityContext({ openshiftRestricted = false } = {}) {
  return {
    allowPrivilegeEscalation: false,
    capabilities: { drop: ['ALL'] },
    readOnlyRootFilesystem: true,
    runAsNonRoot: true,
    ...(!openshiftRestricted ? { runAsUser: 1000, runAsGroup: 1000 } : {}),
  };
}

function restrictedJobPodSpec({
  container,
  pullSecrets = SW_IMAGE_PULL_SECRETS,
}) {
  const names = imagePullSecrets(pullSecrets);
  return {
    restartPolicy: 'Never',
    securityContext: restrictedJobPodSecurityContext(),
    ...(names.length > 0
      ? { imagePullSecrets: names.map((name) => ({ name })) }
      : {}),
    containers: [container],
  };
}

function k8s(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      host: HOST, port: PORT, path, method, ca: CA,
      headers: {
        authorization: `Bearer ${readToken()}`, accept: 'application/json',
        ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let buf = ''; res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        if (res.statusCode >= 400) { const e = new Error(`k8s ${method} ${path} -> ${res.statusCode}: ${buf.slice(0, 300)}`); e.statusCode = res.statusCode; return reject(e); }
        try { resolve(buf ? JSON.parse(buf) : {}); } catch { resolve({}); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// DNS-/identity-safe per-WORKSPACE identity name (mirrors the product's legacy
// deriveWorkspaceStorageIdentityName: falcone-ws-<workspaceId>). Pure.
//
// RETAINED for backward compatibility only — the per-workspace name was the #673 root
// cause (one identity accumulated every bucket grant), so the issuer NO LONGER uses it.
// The issuer keys on bucketIdentityName(bucket) instead. Kept exported in case a caller
// still references it; do not seed identities with it.
export function workspaceIdentityName(workspaceId) {
  const id = String(workspaceId ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return `falcone-ws-${id}`.slice(0, 63);
}

// Deterministic, DNS-/identity-safe PER-BUCKET identity name (#673). The physical
// bucket name (`ws-<wsHash12>-<nameFrag40>` from storage-handlers deriveBucketName) is
// already globally unique and embeds the workspace, so it is the natural key: same
// bucket -> same identity (idempotent re-provision); distinct buckets -> distinct
// identities (no accumulation). We hash it to a fixed-length, always-DNS-safe label so
// the result is <=63 chars regardless of the (already bounded) bucket name. Pure.
//
// Shape: `falcone-s3-<sha256(bucket).slice(0,40)>` (11 + 40 = 51 chars, well under 63).
export function bucketIdentityName(bucket) {
  const b = String(bucket ?? '').trim();
  if (!b) throw new Error('bucketIdentityName requires a bucket');
  const hash = createHash('sha256').update(`bucket:${b}`).digest('hex').slice(0, 40);
  return `falcone-s3-${hash}`;
}

// Generate a fresh access/secret key pair for a bucket identity. Pure (injectable rand).
export function generateStorageKeys(rand = randomBytes) {
  return { accessKey: `flcs3${rand(12).toString('hex')}`, secretKey: rand(24).toString('hex') };
}

// Build the one-shot seed Job manifest (pure, testable). The identity is keyed on the
// physical bucket and scoped to ONLY `bucket` with `actions` — never a wildcard/global
// grant, so it cannot reach another bucket (intra- or cross-workspace). The seed first
// DELETEs any prior identity of the same name then APPLYs a single fresh key, so a
// re-provision is a clean rotate: keys/grants never accumulate (#673). `s3.configure
// -delete -apply` is the canonical delete-and-live-reload (matches the shippable
// packages/adapters/src/seaweedfs-iam-client.mjs delete path).
export function seedJobManifest({
  ns,
  name,
  image = SW_IMAGE,
  imagePullPolicy: pullPolicy = SW_IMAGE_PULL_POLICY,
  imagePullSecrets: pullSecrets = SW_IMAGE_PULL_SECRETS,
  openshiftRestricted = SW_OPENSHIFT_RESTRICTED,
  master = SW_MASTER,
  filer = SW_FILER,
  identityName,
  accessKey,
  secretKey,
  bucket,
  actions = ['Read', 'Write', 'List'],
}) {
  if (!bucket) throw new Error('seedJobManifest requires a bucket (refusing an unscoped identity)');
  const resolvedPullPolicy = imagePullPolicy(pullPolicy);
  // Delete any prior identity of this name (idempotent — a missing identity is fine),
  // then apply exactly one key scoped to the one bucket. `|| true` on the delete keeps
  // a first-ever provision (nothing to delete) from failing the Job.
  const seedCmd = [
    'printf \'s3.configure -delete -apply -user %s\\n\' "$ID_NAME" | weed shell -master="$SW_MASTER" -filer="$SW_FILER" || true;',
    'printf \'s3.configure -apply -user %s -access_key %s -secret_key %s -buckets %s -actions %s\\n\'',
    '"$ID_NAME" "$AK" "$SK" "$BUCKET" "$ACTIONS"',
    '| weed shell -master="$SW_MASTER" -filer="$SW_FILER"',
    '| grep -q "$ID_NAME"',
  ].join(' ');
  return {
    apiVersion: 'batch/v1', kind: 'Job',
    metadata: { name, namespace: ns, labels: { app: 'falcone-ws-identity-seed' } },
    spec: {
      backoffLimit: 4, ttlSecondsAfterFinished: 300,
      template: {
        metadata: { labels: { 'app.kubernetes.io/name': 'seaweedfs', role: 'ws-identity-seed' } },
        spec: restrictedJobPodSpec({
          pullSecrets,
          container: {
            name: 'seed', image, imagePullPolicy: resolvedPullPolicy,
            env: [
              { name: 'ID_NAME', value: identityName }, { name: 'AK', value: accessKey },
              { name: 'SK', value: secretKey }, { name: 'BUCKET', value: bucket },
              { name: 'ACTIONS', value: actions.join(',') }, { name: 'SW_MASTER', value: master },
              { name: 'SW_FILER', value: filer },
            ],
            command: ['/bin/sh', '-ec', seedCmd],
            securityContext: restrictedJobContainerSecurityContext({ openshiftRestricted }),
          },
        }),
      },
    },
  };
}

// Build the one-shot REVOKE Job manifest (pure, testable). Runs `s3.configure -delete
// -apply -user <identityName>` so the identity AND all of its keys are removed and the
// gateway reloads live — the prior access key no longer authenticates (#673). No keys
// are needed (delete by name only); fail-closed on a missing identity name.
export function revokeJobManifest({
  ns,
  name,
  image = SW_IMAGE,
  imagePullPolicy: pullPolicy = SW_IMAGE_PULL_POLICY,
  imagePullSecrets: pullSecrets = SW_IMAGE_PULL_SECRETS,
  openshiftRestricted = SW_OPENSHIFT_RESTRICTED,
  master = SW_MASTER,
  filer = SW_FILER,
  identityName,
}) {
  if (!identityName) throw new Error('revokeJobManifest requires an identityName (nothing to revoke)');
  const resolvedPullPolicy = imagePullPolicy(pullPolicy);
  const revokeCmd = [
    'printf \'s3.configure -delete -apply -user %s\\n\' "$ID_NAME"',
    '| weed shell -master="$SW_MASTER" -filer="$SW_FILER"',
  ].join(' ');
  return {
    apiVersion: 'batch/v1', kind: 'Job',
    metadata: { name, namespace: ns, labels: { app: 'falcone-ws-identity-revoke' } },
    spec: {
      backoffLimit: 4, ttlSecondsAfterFinished: 300,
      template: {
        metadata: { labels: { 'app.kubernetes.io/name': 'seaweedfs', role: 'ws-identity-revoke' } },
        spec: restrictedJobPodSpec({
          pullSecrets,
          container: {
            name: 'revoke', image, imagePullPolicy: resolvedPullPolicy,
            env: [
              { name: 'ID_NAME', value: identityName }, { name: 'SW_MASTER', value: master },
              { name: 'SW_FILER', value: filer },
            ],
            command: ['/bin/sh', '-ec', revokeCmd],
            securityContext: restrictedJobContainerSecurityContext({ openshiftRestricted }),
          },
        }),
      },
    },
  };
}

// The legacy per-WORKSPACE identity name prefix. Identities of this shape
// (`falcone-ws-<workspaceId>`, produced by the pre-fix issuer via workspaceIdentityName)
// are the #673 defect: one identity accumulated a grant + a fresh key for EVERY bucket
// in the workspace, so any one of its keys reaches every (current or RE-CREATED) bucket
// in the workspace. The new per-BUCKET identities are `falcone-s3-<hash>` and are NEVER
// matched by this prefix. The static SeaweedFS admin identity has no `falcone-ws-` prefix
// either. Used both to grep the live config in the cleanup Job and (exported) for tests.
export const LEGACY_WS_IDENTITY_PREFIX = 'falcone-ws-';
// Regex matching a legacy per-workspace identity NAME. workspaceIdentityName lowercases
// and collapses to [a-z0-9-], so the name charset is [a-z0-9-]; we also tolerate '_' in
// case a hand-seeded legacy name used one. Anchored to the prefix so `falcone-s3-*`
// (the new per-bucket identities) and bucket names (`ws-<hash>-…`) never match.
export const LEGACY_WS_IDENTITY_RE = /falcone-ws-[a-z0-9_-]+/g;

// Build the one-shot LEGACY-CLEANUP Job manifest (pure, testable) — the #673 forward
// migration. It DUMPS the live SeaweedFS identity config (`s3.configure` with no args,
// which the gateway returns as a JSON document `{ "identities": [ { "name": "...", … } ] }`
// — verified semantics, packages/adapters/src/seaweedfs-iam-client.mjs::parseWeedShellConfig
// + the weed-shell transport test), greps EVERY `falcone-ws-*` identity NAME out of it
// (enumerating from the LIVE config, not the DB, so it also catches ORPHANED legacy
// identities whose workspace/buckets were already deleted — the exact leak the verifier
// found), de-dupes, and deletes each with `s3.configure -delete -apply -user <name>` so the
// gateway reloads live and every pre-fix key is rejected. A no-op when none exist (the grep
// matches nothing → the loop body never runs). Best-effort: `|| true` keeps a partial/empty
// run from failing the Job. NEVER introduces a wildcard/Admin grant (delete-only).
export function legacyCleanupJobManifest({
  ns,
  name,
  image = SW_IMAGE,
  imagePullPolicy: pullPolicy = SW_IMAGE_PULL_POLICY,
  imagePullSecrets: pullSecrets = SW_IMAGE_PULL_SECRETS,
  openshiftRestricted = SW_OPENSHIFT_RESTRICTED,
  master = SW_MASTER,
  filer = SW_FILER,
}) {
  const resolvedPullPolicy = imagePullPolicy(pullPolicy);
  // 1) dump the config; 2) extract legacy identity names (grep -oE), unique; 3) for each,
  // emit a `s3.configure -delete -apply -user <name>` line and pipe the whole batch into a
  // single `weed shell` invocation. The grep prefix MUST stay in lock-step with
  // LEGACY_WS_IDENTITY_PREFIX / workspaceIdentityName.
  const cleanupCmd = [
    // Dump once; tolerate a transiently-unreachable master without failing the Job.
    "DUMP=$(printf 's3.configure\\n' | weed shell -master=\"$SW_MASTER\" -filer=\"$SW_FILER\" 2>/dev/null || true);",
    // Extract unique legacy identity names from the JSON dump.
    "NAMES=$(printf '%s' \"$DUMP\" | grep -oE 'falcone-ws-[a-z0-9_-]+' | sort -u || true);",
    // No legacy identities -> clean no-op.
    'if [ -z "$NAMES" ]; then echo "no legacy falcone-ws-* identities to remove"; exit 0; fi;',
    // Delete each legacy identity (delete-and-live-reload); best-effort per name.
    'for N in $NAMES; do',
    'printf \'s3.configure -delete -apply -user %s\\n\' "$N" | weed shell -master="$SW_MASTER" -filer="$SW_FILER" || true;',
    'echo "removed legacy identity $N";',
    'done',
  ].join(' ');
  return {
    apiVersion: 'batch/v1', kind: 'Job',
    metadata: { name, namespace: ns, labels: { app: 'falcone-ws-identity-legacy-cleanup' } },
    spec: {
      backoffLimit: 2, ttlSecondsAfterFinished: 300,
      template: {
        metadata: { labels: { 'app.kubernetes.io/name': 'seaweedfs', role: 'ws-identity-legacy-cleanup' } },
        spec: restrictedJobPodSpec({
          pullSecrets,
          container: {
            name: 'legacy-cleanup', image, imagePullPolicy: resolvedPullPolicy,
            env: [{ name: 'SW_MASTER', value: master }, { name: 'SW_FILER', value: filer }],
            command: ['/bin/sh', '-ec', cleanupCmd],
            securityContext: restrictedJobContainerSecurityContext({ openshiftRestricted }),
          },
        }),
      },
    },
  };
}

async function waitJobComplete(ns, name, { client, attempts = 30, delayMs = 2000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  for (let i = 0; i < attempts; i++) {
    const job = await client('GET', `/apis/batch/v1/namespaces/${ns}/jobs/${name}`).catch(() => null);
    const s = job?.status ?? {};
    if (Number(s.succeeded) >= 1) return true;
    if (Number(s.failed) >= (job?.spec?.backoffLimit ?? 4) + 1) throw new Error(`seed Job ${name} failed`);
    await sleep(delayMs);
  }
  throw new Error(`seed Job ${name} did not complete in time`);
}

// Build a DNS-safe k8s Job name from a stable prefix + the bucket-identity hash (so two
// concurrent provisions of distinct buckets never collide on a Job name) + a random
// suffix (so a re-provision of the SAME bucket gets a fresh Job rather than a name clash
// with a not-yet-GC'd prior Job). Bounded to 63 chars.
function jobNameFor(prefix, identityName, suffix) {
  const idFrag = String(identityName).replace(/[^a-z0-9-]/g, '-').slice(-24);
  return `${prefix}-${idFrag}-${suffix}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
}

/**
 * Issue a per-BUCKET SeaweedFS identity scoped to `bucket`. Deletes any prior identity
 * of the same (bucket-derived) name then applies exactly one fresh key (delete-then-
 * apply in one Job), so a (re)provision yields EXACTLY ONE active key scoped to ONLY
 * that bucket — keys/grants never accumulate (#673). Waits for the Job and returns the
 * one-time credential. Injectable client/keys for tests. `workspaceId` is accepted for
 * backward-compatible call sites but no longer drives the identity name; the bucket
 * does.
 * @returns {Promise<{identityName:string, bucket:string, accessKey:string, secretKey:string, actions:string[]}>}
 */
export async function issueBucketIdentity({
  bucket,
  workspaceId,
  actions = ['Read', 'Write', 'List'],
  ns = NS,
  master = SW_MASTER,
  filer = SW_FILER,
  image = SW_IMAGE,
  imagePullPolicy: pullPolicy = SW_IMAGE_PULL_POLICY,
  imagePullSecrets: pullSecrets = SW_IMAGE_PULL_SECRETS,
  openshiftRestricted = SW_OPENSHIFT_RESTRICTED,
  client = k8s,
  keys,
  jobSuffix,
  wait = true,
}) {
  if (!bucket) throw new Error('issueBucketIdentity requires a bucket');
  const identityName = bucketIdentityName(bucket);
  const cred = keys ?? generateStorageKeys();
  const suffix = (jobSuffix ?? randomBytes(4).toString('hex')).toLowerCase();
  const jobName = jobNameFor('bktid', identityName, suffix);
  const manifest = seedJobManifest({
    ns,
    name: jobName,
    image,
    imagePullPolicy: pullPolicy,
    imagePullSecrets: pullSecrets,
    openshiftRestricted,
    master,
    filer,
    identityName,
    accessKey: cred.accessKey,
    secretKey: cred.secretKey,
    bucket,
    actions,
  });
  await client('POST', `/apis/batch/v1/namespaces/${ns}/jobs`, manifest);
  if (wait) await waitJobComplete(ns, jobName, { client });
  return { identityName, bucket, accessKey: cred.accessKey, secretKey: cred.secretKey, actions };
}

/**
 * Backward-compatible alias kept for existing call sites/tests. Now routes through the
 * per-BUCKET issuer (the per-workspace name caused the #673 accumulation), so the
 * returned `identityName` is the bucket-derived name.
 */
export async function issueWorkspaceIdentity(opts = {}) {
  return issueBucketIdentity(opts);
}

/**
 * Revoke (delete) a SeaweedFS identity BY NAME so the identity AND all its keys are
 * removed and the gateway reloads live (the prior access key is rejected). The low-level
 * primitive used both for per-bucket revoke and for deleting a single legacy
 * per-workspace identity on rotate/revoke (#673). Runs a one-shot delete Job; injectable
 * client for tests. Fail-closed on an empty name.
 * @returns {Promise<{identityName:string, revoked:true}>}
 */
export async function revokeIdentityByName({
  identityName,
  jobPrefix = 'idrm',
  ns = NS,
  master = SW_MASTER,
  filer = SW_FILER,
  image = SW_IMAGE,
  imagePullPolicy: pullPolicy = SW_IMAGE_PULL_POLICY,
  imagePullSecrets: pullSecrets = SW_IMAGE_PULL_SECRETS,
  openshiftRestricted = SW_OPENSHIFT_RESTRICTED,
  client = k8s,
  jobSuffix,
  wait = true,
}) {
  if (!identityName) throw new Error('revokeIdentityByName requires an identityName');
  const suffix = (jobSuffix ?? randomBytes(4).toString('hex')).toLowerCase();
  const jobName = jobNameFor(jobPrefix, identityName, suffix);
  const manifest = revokeJobManifest({
    ns,
    name: jobName,
    image,
    imagePullPolicy: pullPolicy,
    imagePullSecrets: pullSecrets,
    openshiftRestricted,
    master,
    filer,
    identityName,
  });
  await client('POST', `/apis/batch/v1/namespaces/${ns}/jobs`, manifest);
  if (wait) await waitJobComplete(ns, jobName, { client });
  return { identityName, revoked: true };
}

/**
 * Revoke (delete) the SeaweedFS identity for `bucket` so the identity AND all its keys
 * are removed and the prior access key is rejected (#673). Runs a one-shot delete Job.
 * Injectable client for tests. Returns the deleted identity name.
 * @returns {Promise<{identityName:string, bucket:string, revoked:true}>}
 */
export async function revokeBucketIdentity({
  bucket,
  ns = NS,
  master = SW_MASTER,
  filer = SW_FILER,
  image = SW_IMAGE,
  imagePullPolicy: pullPolicy = SW_IMAGE_PULL_POLICY,
  imagePullSecrets: pullSecrets = SW_IMAGE_PULL_SECRETS,
  openshiftRestricted = SW_OPENSHIFT_RESTRICTED,
  client = k8s,
  jobSuffix,
  wait = true,
}) {
  if (!bucket) throw new Error('revokeBucketIdentity requires a bucket');
  const identityName = bucketIdentityName(bucket);
  const { revoked } = await revokeIdentityByName({
    identityName,
    jobPrefix: 'bktrm',
    ns,
    master,
    filer,
    image,
    imagePullPolicy: pullPolicy,
    imagePullSecrets: pullSecrets,
    openshiftRestricted,
    client,
    jobSuffix,
    wait,
  });
  return { identityName, bucket, revoked };
}

/**
 * ONE-SHOT FORWARD MIGRATION (#673): delete EVERY legacy per-workspace identity
 * (`falcone-ws-*`) so no pre-fix, over-granted, multi-key credential keeps authenticating
 * after the deploy. Posts a single best-effort k8s Job (legacyCleanupJobManifest) that
 * enumerates the legacy identities from the LIVE SeaweedFS config (catching orphaned ones
 * whose buckets were deleted) and deletes each. Designed to run at every boot:
 *   - Idempotent: once the legacy identities are gone the Job is a clean no-op.
 *   - NON-FATAL: it NEVER throws. Local/test runs (no in-cluster SA token) skip cleanly;
 *     an API-server error while posting the Job is logged and swallowed. Boot must not be
 *     blocked or crashed by storage-credential hygiene.
 * `wait` defaults to FALSE here (fire-and-forget at boot — we don't gate listen() on the
 * Job completing). Returns a small status object for logging; never rejects.
 * @returns {Promise<{posted:boolean, jobName?:string, skipped?:string, error?:string}>}
 */
export async function cleanupLegacyWorkspaceIdentities({
  ns = NS,
  master = SW_MASTER,
  filer = SW_FILER,
  image = SW_IMAGE,
  imagePullPolicy: pullPolicy = SW_IMAGE_PULL_POLICY,
  imagePullSecrets: pullSecrets = SW_IMAGE_PULL_SECRETS,
  openshiftRestricted = SW_OPENSHIFT_RESTRICTED,
  client = k8s,
  token,
  jobSuffix,
  wait = false,
} = {}) {
  try {
    // Skip cleanly when not in a pod with a usable SA token (local/test/dev runs): we
    // cannot post a Job, and that must be a logged no-op, not a crash.
    if (!isInCluster(token)) {
      return { posted: false, skipped: 'not-in-cluster' };
    }
    const suffix = (jobSuffix ?? randomBytes(4).toString('hex')).toLowerCase();
    const jobName = jobNameFor('ws-legacy-cleanup', 'falcone-ws', suffix);
    const manifest = legacyCleanupJobManifest({
      ns,
      name: jobName,
      image,
      imagePullPolicy: pullPolicy,
      imagePullSecrets: pullSecrets,
      openshiftRestricted,
      master,
      filer,
    });
    await client('POST', `/apis/batch/v1/namespaces/${ns}/jobs`, manifest);
    if (wait) await waitJobComplete(ns, jobName, { client });
    return { posted: true, jobName };
  } catch (e) {
    // Best-effort: never block or crash boot on a cleanup failure.
    return { posted: false, error: String(e?.message ?? e) };
  }
}
