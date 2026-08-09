// Console storage (object store) handlers — REAL SeaweedFS/S3 (kind deploy).
//
// SeaweedFS exposes an S3-compatible gateway at `falcone-seaweedfs-s3:8333`. The
// web-console Storage page reads buckets, objects, object metadata, and per-workspace
// usage over the S3 REST API with AWS Signature V4 (pure node:crypto — no SDK).
// Buckets are mapped to a workspace via the `workspace_buckets` table (provisioned
// through this control plane), so the page's `bucket.workspaceId === activeWorkspaceId`
// filter works and usage is workspace-scoped.
import crypto from 'node:crypto';
import * as store from './tenant-store.mjs';
import { issueBucketIdentity, revokeBucketIdentity, revokeIdentityByName, workspaceIdentityName } from './seaweedfs-identity.mjs';
import { checkBucketQuota, checkByteQuota, usageLimits, dimensionStatus, STORAGE_QUOTA_EXCEEDED } from './storage-quota.mjs';
import { canManageTenant } from './tenant-scope.mjs';

// Provider-neutral S3 endpoint/credentials (SeaweedFS S3 gateway port 8333, or any
// S3-compatible backend). Legacy MINIO_* names remain as backward-compatible fallbacks;
// a single startup deprecation notice fires when they are used.
const ENDPOINT = (process.env.STORAGE_S3_ENDPOINT || process.env.MINIO_ENDPOINT || 'http://falcone-seaweedfs-s3:8333').replace(/\/+$/, '');
const ACCESS = process.env.STORAGE_S3_ACCESS_KEY || process.env.MINIO_ACCESS_KEY || '';
const SECRET = process.env.STORAGE_S3_SECRET_KEY || process.env.MINIO_SECRET_KEY || '';
const REGION = process.env.STORAGE_S3_REGION || process.env.MINIO_REGION || 'us-east-1';
// Endpoint baked into PRESIGNED URLs handed back to the CALLER (#676). The control plane
// reaches the S3 gateway over the in-cluster ClusterIP (ENDPOINT, e.g.
// http://falcone-seaweedfs-s3:8333), which is NOT resolvable from outside the cluster — a
// presigned URL signed against it would be useless to an external app. STORAGE_S3_PUBLIC_ENDPOINT
// lets an operator point presigned URLs at an externally-routable S3 gateway address while
// the control plane keeps using the internal endpoint for its own SigV4 traffic. The SigV4
// signature is host-bound (SignedHeaders=host), so the public endpoint MUST be the host the
// client actually connects to or the signature will not verify. Defaults to ENDPOINT (so the
// in-cluster default is unchanged when no external endpoint is configured).
const PUBLIC_ENDPOINT = (process.env.STORAGE_S3_PUBLIC_ENDPOINT || ENDPOINT).replace(/\/+$/, '');
// Platform maximum TTL (seconds) for a presigned URL. Mirrors the product preview builder's
// DEFAULT_TTL_SECONDS (packages/adapters/src/storage-multipart-presigned.mjs) and the SigV4
// hard ceiling of 7 days; an operator may lower it via STORAGE_PRESIGN_MAX_TTL_SECONDS.
const PRESIGN_MAX_TTL_SECONDS = (() => {
  const n = Number(process.env.STORAGE_PRESIGN_MAX_TTL_SECONDS);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 604800) : 3600;
})();
const PRESIGN_DEFAULT_TTL_SECONDS = Math.min(3600, PRESIGN_MAX_TTL_SECONDS);
const EMPTY_SHA = crypto.createHash('sha256').update('').digest('hex');

if (!process.env.STORAGE_S3_ENDPOINT && process.env.MINIO_ENDPOINT) {
  console.warn('[storage] MINIO_ENDPOINT is deprecated; set STORAGE_S3_ENDPOINT (and STORAGE_S3_ACCESS_KEY / STORAGE_S3_SECRET_KEY) instead. Falling back to MINIO_* for now.');
}

const ok = (statusCode, body) => ({ statusCode, body });
const err = (statusCode, code, message) => ({ statusCode, body: { code, message } });
// An object write whose body carries no usable payload (#994) — rejected before any backend call.
export const STORAGE_INVALID_BODY = 'STORAGE_INVALID_BODY';
const nowIso = () => new Date().toISOString();

// Map an S3-backend failure thrown by `s3()` to a CLEAN, tenant-facing error — never echoing
// the raw backend payload. The thrown error embeds the literal backend body and the INTERNAL
// physical bucket path in `e.message` (`s3 <METHOD> <path> -> <status>: <xml…>`) and the full
// raw text in `e.body`; surfacing either to the caller leaks SeaweedFS internals (the S3 XML
// `NoSuchKey`/`<Resource>`/`<RequestId>` and the `ws-<hash>-…` physical bucket name) — #675.
//
// For object I/O the bucket-ownership gate (denyUnlessBucketOwner / the inline registry check)
// ALWAYS runs BEFORE the S3 call, so a 404 here is unambiguously a MISSING OBJECT (NoSuchKey)
// on a bucket the caller owns — mapped to the canonical `404 OBJECT_NOT_FOUND` with the exact
// stable message from packages/adapters/src/storage-error-taxonomy.mjs (duplicated inline
// because this kind-runtime image cannot import the services package). Any other backend
// failure keeps the operation-specific failure code but with a generic message — the upstream
// detail is logged server-side (operators only), never returned. `fallbackCode` is e.g.
// 'STORAGE_GET_FAILED' / 'STORAGE_HEAD_FAILED'.
function storageFailure(e, fallbackCode) {
  // 404 from the backend, after the ownership gate has passed → the object does not exist.
  if (e?.statusCode === 404) {
    console.error(`[storage] backend 404 mapped to OBJECT_NOT_FOUND: ${String(e?.message ?? e)}`);
    return err(404, 'OBJECT_NOT_FOUND', 'The requested storage object was not found.');
  }
  // Any other backend failure: preserve a sane status but NEVER echo the raw payload/path.
  const status = e?.statusCode && e.statusCode < 500 ? e.statusCode : 502;
  console.error(`[storage] backend failure (${fallbackCode}, status ${status}): ${String(e?.message ?? e)}`);
  return err(status, fallbackCode, 'Storage backend request failed.');
}

const sha256hex = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

// Physical, DNS-safe bucket name for a workspace's logical bucket. The name embeds
// a stable hash of the GLOBALLY-UNIQUE workspace id, so two tenants' same-slug
// workspaces (or two tenants both requesting the bucket name `assets`) get DISTINCT
// physical buckets (P1: the old slug-derived `ws-<slug>-assets` collided across
// tenants and `insertBucket`'s ON CONFLICT hijacked the first tenant's registry
// row). Mirrors the shippable product's hash-based `deriveWorkspaceBucketName`
// (packages/adapters/src/seaweedfs-s3-identities-config.mjs); duplicated inline
// because this kind-runtime image cannot import the services package. Pure +
// deterministic, so a given (workspace, name) always maps to the same bucket
// (idempotent provisioning; the per-workspace S3 identity can reference it).
export function deriveBucketName(workspaceId, requestedName) {
  const wsHash = crypto.createHash('sha256').update(`workspace:${String(workspaceId ?? '')}`).digest('hex').slice(0, 12);
  const nameFrag = String(requestedName ?? 'assets').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  const bucket = `ws-${wsHash}-${nameFrag || 'assets'}`.replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63).replace(/-+$/g, '');
  return bucket;
}

// Whether to issue a per-workspace (scoped) SeaweedFS identity on bucket provision.
// DEFAULT-ON: enabled unless explicitly disabled (STORAGE_TENANT_IDENTITIES=0/false).
// Defaulting on (rather than requiring =1) means it cannot be silently lost when a
// Helm values overlay REPLACES the control-plane env list — the failure mode that left
// the live deploy on a single shared admin S3 credential (P1 tenant-isolation).
export function tenantIdentitiesEnabled(env = process.env) {
  const v = String(env.STORAGE_TENANT_IDENTITIES ?? '').toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off' && v !== 'no';
}
// AWS RFC3986 encoding (encodeURIComponent + the extra reserved chars AWS escapes).
const enc = (s) => encodeURIComponent(s).replace(/[!*'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

function amzDates() {
  const d = new Date();
  const amzDate = d.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

// Signed S3 request (path-style). `path` is the raw path incl. leading '/'
// (e.g. '/', '/bucket', '/bucket/key'); `query` is an object of query params.
async function s3(method, path, { query = {}, headers = {}, body } = {}) {
  const url = new URL(ENDPOINT);
  const host = url.host;
  const payload = body ?? '';
  const payloadHash = body ? sha256hex(body) : EMPTY_SHA;
  const { amzDate, dateStamp } = amzDates();

  const canonicalUri = path.split('/').map((seg, i) => (i === 0 ? seg : enc(seg))).join('/') || '/';
  const canonicalQuery = Object.keys(query).sort()
    .map((k) => `${enc(k)}=${enc(String(query[k]))}`).join('&');

  const hdrs = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const signedHeaders = Object.keys(hdrs).sort().join(';');
  const canonicalHeaders = Object.keys(hdrs).sort().map((k) => `${k}:${hdrs[k]}\n`).join('');
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const scope = `${dateStamp}/${REGION}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const kDate = hmac('AWS4' + SECRET, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, 's3');
  const signingKey = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${ACCESS}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const qs = canonicalQuery ? `?${canonicalQuery}` : '';
  const res = await fetch(`${ENDPOINT}${canonicalUri}${qs}`, {
    method,
    headers: { ...headers, authorization, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate },
    body: body ?? undefined
  });
  // Read the body once as raw bytes, then derive text from it — so binary objects round-trip
  // byte-identically (await res.text() would lossily UTF-8-decode an octet stream). Real fetch
  // always exposes arrayBuffer(); fall back to text() only for minimal mocks/runtimes.
  const buffer = method === 'HEAD'
    ? Buffer.alloc(0)
    : typeof res.arrayBuffer === 'function'
      ? Buffer.from(await res.arrayBuffer())
      : Buffer.from(await res.text());
  const text = buffer.toString('utf8');
  if (!res.ok) {
    const e = new Error(`s3 ${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
    e.statusCode = res.status; e.body = text;
    throw e;
  }
  return { status: res.status, headers: res.headers, text, buffer };
}

// Build a SigV4 QUERY-presigned URL (AWS4-HMAC-SHA256, path-style) for a single object
// operation (#676). Unlike s3()'s header-signed path, the credential + signature ride in the
// query string so the URL alone authorizes the request — a tenant can hand it to an external
// client (browser/curl/SDK) with no Falcone credential. The signature is bound to exactly:
//   - method (GET for download / PUT for upload),
//   - canonical URI `/{bucket}/{key}` (so the URL cannot be repointed at another bucket/key
//     without invalidating the signature),
//   - host (SignedHeaders=host), and
//   - X-Amz-Expires (TTL).
// payloadHash is the literal `UNSIGNED-PAYLOAD` so the body need not be known at signing time
// (required for an upload PUT). The host comes from PUBLIC_ENDPOINT so the URL targets the
// externally-routable gateway; the signature verifies because we sign the same host. The
// SECRET never appears in the URL — only the derived HMAC signature does (standard SigV4).
function presignS3Url(method, bucket, key, expiresSeconds) {
  const url = new URL(PUBLIC_ENDPOINT);
  const host = url.host;
  const { amzDate, dateStamp } = amzDates();
  const scope = `${dateStamp}/${REGION}/s3/aws4_request`;
  const canonicalUri = `/${bucket}/${key}`.split('/').map((seg, i) => (i === 0 ? seg : enc(seg))).join('/');
  const queryParams = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${ACCESS}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': 'host'
  };
  const canonicalQuery = Object.keys(queryParams).sort()
    .map((k) => `${enc(k)}=${enc(queryParams[k])}`).join('&');
  const canonicalHeaders = `host:${host}\n`;
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const kDate = hmac('AWS4' + SECRET, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, 's3');
  const signingKey = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return `${PUBLIC_ENDPOINT}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

// minimal XML helpers for the (simple, known) S3 list responses.
// Entity-aware + CDATA-tolerant: SeaweedFS (and other gateways) may encode characters
// in bucket names / object keys (`&amp; &lt; &gt; &quot; &#34;`) or wrap text in
// <![CDATA[...]]>. We decode the common entity set and strip CDATA wrappers before
// returning tag content, while staying byte-compatible with the real SeaweedFS 4.33
// envelopes captured in the adr-spike (`&#34;`-quoted ETags, NextContinuationToken).
const stripCdata = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
const decodeXmlEntities = (s) => s
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#34;/g, '"')
  .replace(/&#x22;/gi, '"')
  .replace(/&apos;/g, '\'')
  .replace(/&#39;/g, '\'')
  .replace(/&amp;/g, '&'); // ampersand last so we don't double-decode
const decodeTagContent = (s) => (s == null ? null : decodeXmlEntities(stripCdata(s)));
const allTags = (xml, tag) => {
  const out = []; const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'); let m;
  while ((m = re.exec(xml))) out.push(decodeTagContent(m[1]));
  return out;
};
const oneTag = (xml, tag) => { const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)); return m ? decodeTagContent(m[1]) : null; };

export async function listBuckets() {
  const { text } = await s3('GET', '/');
  return allTags(text, 'Bucket').map((b) => ({ name: oneTag(b, 'Name'), creationDate: oneTag(b, 'CreationDate') }));
}
export async function listObjects(bucket, { maxKeys = 50, after } = {}) {
  const query = { 'list-type': '2', 'max-keys': String(maxKeys) };
  if (after) query['continuation-token'] = after;
  const { text } = await s3('GET', `/${bucket}`, { query });
  const objects = allTags(text, 'Contents').map((c) => ({
    key: oneTag(c, 'Key'), size: Number(oneTag(c, 'Size') ?? 0), etag: (oneTag(c, 'ETag') ?? '').replace(/&quot;|&#34;|"/g, ''),
    lastModified: oneTag(c, 'LastModified'), storageClass: oneTag(c, 'StorageClass') ?? 'STANDARD'
  }));
  const truncated = oneTag(text, 'IsTruncated') === 'true';
  return { objects, nextToken: truncated ? oneTag(text, 'NextContinuationToken') : null };
}
export async function headObject(bucket, key) {
  const { headers } = await s3('HEAD', `/${bucket}/${key}`);
  return {
    contentType: headers.get('content-type') ?? null,
    size: Number(headers.get('content-length') ?? 0),
    etag: (headers.get('etag') ?? '').replace(/"/g, ''),
    lastModified: headers.get('last-modified') ?? null
  };
}
export async function createBucket(bucket) {
  try { await s3('PUT', `/${bucket}`); }
  catch (e) { if (!/BucketAlreadyOwnedByYou|BucketAlreadyExists/.test(e.body ?? '')) throw e; }
}
// Delete a bucket (best-effort teardown for tenant purge, #501). SeaweedFS removes the bucket
// and its objects; a missing bucket (already gone / never created) is treated as success.
export async function deleteBucket(bucket) {
  try { await s3('DELETE', `/${bucket}`); }
  catch (e) { if (!/NoSuchBucket|404/.test(String(e.body ?? e.message ?? ''))) throw e; }
}
export async function putObject(bucket, key, body, contentType = 'application/octet-stream') {
  await s3('PUT', `/${bucket}/${key}`, { headers: { 'content-type': contentType }, body });
}
// Download an object's body (add-wire-advertised-public-routes, #500 — object I/O was NO_ROUTE).
// Returns the exact bytes only. It used to also return `content: buffer.toString('utf8')`, a
// best-effort UTF-8 view that the handlers emitted as a first-class response field — a lossy
// conversion replacing every invalid sequence with U+FFFD on an HTTP 200 (#966). Callers use
// `bytes` (or its base64 encoding on the wire), which is always exact.
// When `range` is set (an HTTP Range header value, e.g. 'bytes=0-3'), it is forwarded to the S3
// backend (#676 partial reads): SeaweedFS replies 206 with only the requested bytes plus a
// Content-Range header. `status`/`contentRange` are surfaced so the handler can emit 206. An
// unsatisfiable range yields a backend 416, which s3() throws (status 416) and the handler maps
// to a clean 416.
export async function getObject(bucket, key, { range } = {}) {
  const headersIn = range ? { range } : {};
  const { buffer, headers, status } = await s3('GET', `/${bucket}/${key}`, { headers: headersIn });
  return {
    bytes: buffer,
    contentType: headers.get('content-type') ?? 'application/octet-stream',
    sizeBytes: Number(headers.get('content-length') ?? buffer.length),
    status,
    contentRange: headers.get('content-range') ?? null
  };
}
export async function deleteObject(bucket, key) {
  await s3('DELETE', `/${bucket}/${key}`);
}

// ---- multipart upload backend helpers (#676) -------------------------------
// Thin wrappers over the S3 multipart upload API (CreateMultipartUpload / UploadPart /
// CompleteMultipartUpload / AbortMultipartUpload), all path-style and signed by s3(). The
// uploadId is opaque + S3-managed; isolation comes from the handler re-checking bucket
// ownership on EVERY call (the uploadId alone grants nothing without an owned bucket).
export async function createMultipartUpload(bucket, key, contentType = 'application/octet-stream') {
  const { text } = await s3('POST', `/${bucket}/${key}`, { query: { uploads: '' }, headers: { 'content-type': contentType } });
  const uploadId = oneTag(text, 'UploadId');
  if (!uploadId) { const e = new Error('multipart initiate returned no UploadId'); e.statusCode = 502; throw e; }
  return { uploadId };
}
export async function uploadPart(bucket, key, uploadId, partNumber, body) {
  const { headers } = await s3('PUT', `/${bucket}/${key}`, { query: { partNumber: String(partNumber), uploadId }, body });
  const etag = (headers.get('etag') ?? '').replace(/"/g, '');
  return { partNumber: Number(partNumber), etag };
}
// Build the CompleteMultipartUpload XML body from an ordered part list ({partNumber, etag}).
function buildCompleteMultipartXml(parts) {
  const items = parts.map((p) => {
    const etag = String(p.etag ?? '').replace(/"/g, '');
    return `<Part><PartNumber>${Number(p.partNumber)}</PartNumber><ETag>&#34;${etag}&#34;</ETag></Part>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${items}</CompleteMultipartUpload>`;
}
export async function completeMultipartUpload(bucket, key, uploadId, parts) {
  const body = Buffer.from(buildCompleteMultipartXml(parts), 'utf8');
  const { text } = await s3('POST', `/${bucket}/${key}`, { query: { uploadId }, headers: { 'content-type': 'application/xml' }, body });
  return { etag: (oneTag(text, 'ETag') ?? '').replace(/&quot;|&#34;|"/g, ''), location: oneTag(text, 'Location') ?? null };
}
export async function abortMultipartUpload(bucket, key, uploadId) {
  await s3('DELETE', `/${bucket}/${key}`, { query: { uploadId } });
}

// Ownership gate: returns true for superadmin/internal (cross-tenant allowed),
// false for all other actors so each handler can enforce a 404 (no-existence-leak).
function isSuperOrInternal(identity) {
  return identity.actorType === 'superadmin' || identity.actorType === 'internal';
}

// Shared bucket-ownership gate for object I/O: superadmin/internal bypass; others must own the
// bucket (else 404, no existence leak). Returns an error response to short-circuit, or null.
async function denyUnlessBucketOwner(ctx, bucket) {
  if (isSuperOrInternal(ctx.identity)) return null;
  const rec = await store.getBucketRecord(ctx.pool, bucket);
  if (!rec || rec.tenant_id !== ctx.identity.tenantId) return err(404, 'BUCKET_NOT_FOUND', `bucket ${bucket} not found`);
  return null;
}

function denyUnlessStructuralAdmin(ctx, tenantId) {
  if (canManageTenant(ctx.identity, tenantId)) return null;
  return err(403, 'FORBIDDEN', 'requires superadmin or tenant owner/admin');
}

async function requireOwnedBucketForStructuralWrite(ctx, bucket) {
  const deny = await denyUnlessBucketOwner(ctx, bucket);
  if (deny) return { error: deny };
  const rec = await store.getBucketRecord(ctx.pool, bucket);
  if (!rec) return { error: err(404, 'BUCKET_NOT_FOUND', `bucket ${bucket} not found`) };
  const roleDeny = denyUnlessStructuralAdmin(ctx, rec.tenant_id);
  if (roleDeny) return { error: roleDeny };
  return { rec };
}

// Decode + validate a single object key from the route param, applying the SAME policy as the
// platform storage adapter (packages/adapters/src/storage-bucket-object-ops.mjs::assertObjectKey):
// reject traversal ('..' segments), a leading '/', backslashes, control characters, an empty/too-
// long key, and malformed percent-encoding — with a clean 400 BEFORE any S3 backend call. Without
// this, a traversal probe (e.g. `..%2F..%2Fetc%2Fpasswd`) reached the backend, which rejected the
// malformed path, and that surfaced to the caller as a 5xx STORAGE_*_FAILED (502) instead of a 4xx
// (#638). No data escapes the bucket either way, but a 5xx for malicious client input is a defect.
const OBJECT_KEY_MAX_LEN = 1024;
function decodeObjectKey(rawKey) {
  let key;
  try { key = decodeURIComponent(rawKey); }
  catch { return { error: err(400, 'INVALID_OBJECT_KEY', 'object key is not valid percent-encoding') }; }
  const invalid = (msg) => ({ error: err(400, 'INVALID_OBJECT_KEY', msg) });
  if (typeof key !== 'string' || !key.trim()) return invalid('object key is required');
  if (key.length > OBJECT_KEY_MAX_LEN) return invalid(`object key exceeds ${OBJECT_KEY_MAX_LEN} characters`);
  if (key.startsWith('/')) return invalid('object key must not start with "/"');
  if (key.includes('\\')) return invalid('object key must not contain a backslash');
  for (let i = 0; i < key.length; i += 1) {
    const code = key.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return invalid('object key must not contain control characters');
  }
  if (key.split('/').some((seg) => seg === '..')) return invalid('object key must not contain ".." path segments');
  return { key };
}

// ---- handlers (ctx = { params, query, body, identity, pool, callerContext }) ----
// Object I/O — upload/download/delete a single object (#500). Tenant-scoped via the bucket owner
// gate. Objects are stored byte-faithfully: an upload may carry EITHER a raw/binary request body
// (any non-JSON content-type → ctx.rawBody) OR a JSON envelope. Download returns contentBase64,
// so binary round-trips byte-identically over the JSON API.
//
// #994 — the JSON write envelope. The published contract (StorageObjectWriteRequest) declares
// `contentBase64` REQUIRED with `additionalProperties: false`, so contentBase64 is THE mandated
// write field and content/encoding are forbidden by the schema. This resolver read only
// content/encoding, which made the only contract-conformant write store 0 bytes and return 201 —
// and because the read envelope carried BOTH fields, replaying a GET response as a PUT body
// base64-decoded the lossy `content` and ignored the exact `contentBase64`, corrupting the object
// on a success status. contentBase64 now wins whenever present; the legacy { content, encoding? }
// envelope stays accepted (the web console and existing clients ship it) but is the fallback.
// A body with no readable payload field is a 400 — never a silent empty object on a 201.
const BASE64_STRICT = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
export function resolveObjectBody(ctx) {
  // Raw binary upload: the server kept the exact request bytes (non-JSON content-type).
  if (ctx.rawBodyIsBinary && Buffer.isBuffer(ctx.rawBody)) {
    return { bytes: ctx.rawBody, contentType: ctx.contentType || 'application/octet-stream' };
  }
  const env = ctx.body ?? {};
  const contentType = env.contentType ?? 'application/octet-stream';
  // The contract-mandated field. Validated strictly: Buffer.from(x, 'base64') silently DROPS
  // characters outside the alphabet, so an unusable value would otherwise be stored as a
  // truncated object under a 201 — exactly the failure mode this issue is about.
  if (env.contentBase64 != null) {
    const encoded = String(env.contentBase64);
    if (!BASE64_STRICT.test(encoded)) {
      return { error: err(400, STORAGE_INVALID_BODY, 'contentBase64 must be valid base64') };
    }
    return { bytes: Buffer.from(encoded, 'base64'), contentType };
  }
  // Legacy envelope: { content, contentType, encoding? }. base64 decodes to exact bytes; otherwise
  // the string is stored as UTF-8 (the existing text/JSON-blob behavior).
  if (env.content != null) {
    const bytes = env.encoding === 'base64'
      ? Buffer.from(String(env.content), 'base64')
      : Buffer.from(String(env.content), 'utf8');
    return { bytes, contentType };
  }
  return {
    error: err(400, STORAGE_INVALID_BODY,
      'object write body must carry contentBase64 (base64-encoded payload); a body with no readable payload field is never stored as an empty object')
  };
}
// Sum the CURRENT stored bytes across every bucket of the workspace that owns `bucket`
// (#674 byte-quota admission). Mirrors storageWorkspaceUsage's per-bucket listObjects scan;
// scoped strictly to the owning workspace (no cross-tenant read). Used only when a byte
// limit is configured, so the upload hot-path pays this cost only on opt-in.
async function workspaceCurrentBytes(ctx, bucket) {
  const rec = await store.getBucketRecord(ctx.pool, bucket);
  if (!rec) return 0;
  const mapped = await store.listBucketsForWorkspace(ctx.pool, rec.workspace_id);
  let total = 0;
  for (const row of mapped) {
    try {
      const { objects } = await listObjects(row.bucket_name, { maxKeys: 1000 });
      total += objects.filter((o) => !isReservedKey(o.key)).reduce((s, o) => s + o.size, 0);
    } catch { /* a transient per-bucket list failure must not falsely block an upload */ }
  }
  return total;
}
async function storagePutObject(ctx) {
  const { key, error } = decodeObjectKey(ctx.params.objectKey); if (error) return error;
  const bucket = ctx.params.bucketId; const gate = await requireOwnedBucketForStructuralWrite(ctx, bucket); if (gate.error) return gate.error;
  const { bytes, contentType, error: bodyError } = resolveObjectBody(ctx); if (bodyError) return bodyError;
  // Per-workspace total-bytes quota admission (#674). Enforced ONLY when STORAGE_MAX_BYTES is
  // configured (default unlimited) — usageLimits().maxBytes == null short-circuits BEFORE any
  // usage scan, so the upload hot-path is unchanged unless an operator opts in. The body is
  // already buffered (bytes.length), so the incoming size is known at the CP layer. Fails OPEN
  // if the quota model is unavailable.
  if (usageLimits().maxBytes != null) {
    const currentBytes = await workspaceCurrentBytes(ctx, bucket);
    const byteDecision = checkByteQuota(currentBytes, bytes.length, {});
    if (!byteDecision.allowed) {
      return err(409, STORAGE_QUOTA_EXCEEDED,
        `storage byte quota would be exceeded for this workspace: ${currentBytes + bytes.length}/${byteDecision.limit} bytes`);
    }
  }
  try {
    await putObject(bucket, key, bytes, contentType);
    return ok(201, { objectKey: key, bucketName: bucket, sizeBytes: bytes.length, contentType });
  } catch (e) { return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'STORAGE_PUT_FAILED', String(e.message ?? e)); }
}
async function storageGetObject(ctx) {
  const { key, error } = decodeObjectKey(ctx.params.objectKey); if (error) return error;
  const bucket = ctx.params.bucketId; const deny = await denyUnlessBucketOwner(ctx, bucket); if (deny) return deny;
  // HTTP Range / partial read (#676): when the client sends a Range header, forward it to the
  // backend and return 206 Partial Content with ONLY the requested bytes plus a Content-Range
  // header. Without a Range header behavior is unchanged (200, full body) — we still advertise
  // Accept-Ranges: bytes so clients know the resource is range-capable. An unsatisfiable range
  // (e.g. start beyond EOF) makes the backend reply 416, which s3() throws (status 416) and we
  // map to a clean 416 here (never echoing the raw S3 XML — #675).
  const range = ctx.req?.headers?.range;
  try {
    const o = await getObject(bucket, key, range ? { range } : {});
    // Treat as partial only when the client asked for a range AND the backend honored it (206 +
    // Content-Range). If the backend ignored the range (returned 200), fall through to the full body.
    if (range && (o.status === 206 || o.contentRange)) {
      return {
        statusCode: 206,
        headers: { 'content-range': o.contentRange ?? undefined, 'accept-ranges': 'bytes' },
        body: { objectKey: key, bucketName: bucket, contentBase64: o.bytes.toString('base64'), encoding: 'base64', contentType: o.contentType, sizeBytes: o.bytes.length, contentRange: o.contentRange, partial: true }
      };
    }
    return { statusCode: 200, headers: { 'accept-ranges': 'bytes' }, body: { objectKey: key, bucketName: bucket, contentBase64: o.bytes.toString('base64'), encoding: 'base64', contentType: o.contentType, sizeBytes: o.sizeBytes } };
  } catch (e) {
    // A 416 from the backend is a malformed/unsatisfiable Range — return a clean 416, not a 502.
    if (e?.statusCode === 416) return err(416, 'STORAGE_RANGE_NOT_SATISFIABLE', 'The requested range is not satisfiable for this object.');
    return storageFailure(e, 'STORAGE_GET_FAILED');
  }
}
async function storageDeleteObject(ctx) {
  const { key, error } = decodeObjectKey(ctx.params.objectKey); if (error) return error;
  const bucket = ctx.params.bucketId; const gate = await requireOwnedBucketForStructuralWrite(ctx, bucket); if (gate.error) return gate.error;
  try {
    await deleteObject(bucket, key);
    return ok(200, { objectKey: key, bucketName: bucket, deleted: true });
  } catch (e) { return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'STORAGE_DELETE_FAILED', String(e.message ?? e)); }
}
async function storageListBuckets(ctx) {
  const all = await listBuckets();
  const map = await store.bucketWorkspaceMap(ctx.pool);
  const isSuperadmin = isSuperOrInternal(ctx.identity);
  const items = all
    .map((b) => {
      const m = map[b.name];
      return {
        resourceId: b.name, bucketName: b.name,
        tenantId: m?.tenant_id ?? null, workspaceId: m?.workspace_id ?? null,
        region: REGION, status: 'active',
        timestamps: { createdAt: m?.created_at ?? b.creationDate, lastModifiedAt: b.creationDate }
      };
    })
    // Non-superadmin callers see only their own tenant's buckets.
    .filter((item) => isSuperadmin || item.tenantId === ctx.identity.tenantId);
  return ok(200, { items, page: { size: items.length } });
}
async function storageListObjects(ctx) {
  const bucket = ctx.params.bucketId;
  // Ownership check: look up the bucket's owning tenant and compare to caller.
  // Superadmin/internal bypass the check. Non-owners get 404 (no existence leak).
  if (!isSuperOrInternal(ctx.identity)) {
    const rec = await store.getBucketRecord(ctx.pool, bucket);
    if (!rec || rec.tenant_id !== ctx.identity.tenantId) {
      return err(404, 'BUCKET_NOT_FOUND', `bucket ${bucket} not found`);
    }
  }
  const max = Number(ctx.query['page[size]'] ?? 50) || 50;
  const after = ctx.query['page[after]'] || undefined;
  try {
    const { objects, nextToken } = await listObjects(bucket, { maxKeys: max, after });
    // Hide the reserved export-manifest namespace (#683): `.falcone/exports/*` objects are
    // platform-internal export artifacts, not tenant object data, so they never appear in the
    // bucket's object listing.
    const items = objects.filter((o) => !isReservedKey(o.key)).map((o) => ({
      objectKey: o.key, bucketName: bucket, sizeBytes: o.size, etag: o.etag,
      storageClass: o.storageClass, timestamps: { lastModifiedAt: o.lastModified }
    }));
    return ok(200, { items, page: { size: items.length, nextCursor: nextToken ?? undefined, after: nextToken ?? undefined } });
  } catch (e) {
    return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'STORAGE_LIST_FAILED', String(e.message ?? e));
  }
}
async function storageObjectMetadata(ctx) {
  const { key, error } = decodeObjectKey(ctx.params.objectKey); if (error) return error;
  const bucket = ctx.params.bucketId;
  // Ownership check: same pattern as storageListObjects.
  if (!isSuperOrInternal(ctx.identity)) {
    const rec = await store.getBucketRecord(ctx.pool, bucket);
    if (!rec || rec.tenant_id !== ctx.identity.tenantId) {
      return err(404, 'BUCKET_NOT_FOUND', `bucket ${bucket} not found`);
    }
  }
  try {
    const meta = await headObject(bucket, key);
    return ok(200, { objectKey: key, bucketName: bucket, contentType: meta.contentType,
      sizeBytes: meta.size, etag: meta.etag, timestamps: { lastModifiedAt: meta.lastModified } });
  } catch (e) {
    return storageFailure(e, 'STORAGE_HEAD_FAILED');
  }
}
async function storageWorkspaceUsage(ctx) {
  const workspaceId = ctx.params.workspaceId;
  // Ownership check: verify the workspace belongs to the caller's tenant.
  // Superadmin/internal bypass the check. Non-owners get 404 (no existence leak).
  if (!isSuperOrInternal(ctx.identity)) {
    const ws = await store.getWorkspace(ctx.pool, workspaceId);
    if (!ws || ws.tenant_id !== ctx.identity.tenantId) {
      return err(404, 'WORKSPACE_NOT_FOUND', `workspace ${workspaceId} not found`);
    }
  }
  const mapped = await store.listBucketsForWorkspace(ctx.pool, workspaceId);
  let totalBytes = 0, objectCount = 0; const bucketEntries = [];
  for (const row of mapped) {
    try {
      const { objects: raw } = await listObjects(row.bucket_name, { maxKeys: 1000 });
      // Exclude reserved export-manifest objects (#683) from usage/quota accounting.
      const objects = raw.filter((o) => !isReservedKey(o.key));
      const bytes = objects.reduce((s, o) => s + o.size, 0);
      totalBytes += bytes; objectCount += objects.length;
      bucketEntries.push({ bucketId: row.bucket_name, totalBytes: bytes, objectCount: objects.length,
        largestObjectSizeBytes: objects.reduce((mx, o) => Math.max(mx, o.size), 0) });
    } catch { bucketEntries.push({ bucketId: row.bucket_name, totalBytes: 0, objectCount: 0, largestObjectSizeBytes: 0 }); }
  }
  // Report the EFFECTIVE per-workspace limit + remaining capacity per dimension (#674): the
  // bucket-count limit always applies (default 8), and the byte limit applies to totalBytes/
  // objectSizeBytes only when STORAGE_MAX_BYTES is configured (otherwise null = unlimited).
  // dimensionStatus fills remaining = max(limit-used,0) and utilizationPercent = round(used/
  // limit*100), or leaves them null when the dimension is unlimited (so the API never reports
  // a perpetual null when a limit is set). objectCount has no configured limit → unlimited.
  const { maxBuckets, maxBytes } = usageLimits();
  return ok(200, {
    collectionMethod: 'live', collectionStatus: 'complete', snapshotAt: nowIso(), cacheSnapshotAt: null,
    dimensions: {
      totalBytes: { dimension: 'totalBytes', ...dimensionStatus(totalBytes, maxBytes) },
      bucketCount: { dimension: 'bucketCount', ...dimensionStatus(mapped.length, maxBuckets) },
      objectCount: { dimension: 'objectCount', ...dimensionStatus(objectCount, null) },
      objectSizeBytes: { dimension: 'objectSizeBytes', ...dimensionStatus(totalBytes, maxBytes) }
    },
    buckets: bucketEntries
  });
}
// POST /v1/storage/workspaces/{workspaceId}/buckets — provision a real bucket + map it.
async function storageProvisionBucket(ctx) {
  const workspaceId = ctx.params.workspaceId;
  const ws = await store.getWorkspace(ctx.pool, workspaceId);
  if (!ws) return err(404, 'WORKSPACE_NOT_FOUND', `workspace ${workspaceId} not found`);
  // Ownership check: only superadmin/internal or the workspace-owning tenant may provision.
  if (!isSuperOrInternal(ctx.identity) && ws.tenant_id !== ctx.identity.tenantId) {
    return err(404, 'WORKSPACE_NOT_FOUND', `workspace ${workspaceId} not found`);
  }
  const roleDeny = denyUnlessStructuralAdmin(ctx, ws.tenant_id);
  if (roleDeny) return roleDeny;
  // Per-workspace bucket-count quota admission (#674). Count THIS workspace's buckets (the
  // same tenant-scoped read the usage handler uses) and deny a provision that would exceed
  // the effective limit (STORAGE_MAX_BUCKETS, default 8). Runs AFTER the ownership 404 gate
  // so a non-owner still gets 404 (no existence leak), and BEFORE any backend call so no
  // physical bucket is created on a denial. Fails OPEN if the quota model is unavailable.
  const existingBuckets = await store.listBucketsForWorkspace(ctx.pool, ws.id);
  const bucketDecision = checkBucketQuota(existingBuckets.length, {});
  if (!bucketDecision.allowed) {
    return err(409, STORAGE_QUOTA_EXCEEDED,
      `storage bucket quota reached for this workspace: ${existingBuckets.length}/${bucketDecision.limit}`);
  }
  // DNS-safe, workspace-id-scoped bucket name. deriveBucketName embeds a stable hash
  // of the globally-unique workspace id so two same-slug workspaces across tenants
  // (or two tenants both requesting `assets`) NEVER collide on one physical bucket
  // or one registry row (P1 tenant-isolation). The DNS rule ([a-z0-9-], 3..63) is the
  // canonical one from packages/provisioning-orchestrator/src/utils/bucket-name-validator.mjs.
  const bucket = deriveBucketName(ws.id, ctx.body?.name);
  // Reject before any backend call if the derived name still violates the contract.
  if (!/^[a-z0-9-]{3,63}$/.test(bucket)) {
    return err(400, 'STORAGE_INVALID_BUCKET_NAME', `derived bucket name '${bucket}' is not DNS-safe ([a-z0-9-], 3..63)`);
  }
  try {
    await createBucket(bucket);
    const rec = await store.insertBucket(ctx.pool, { workspaceId: ws.id, tenantId: ws.tenant_id, bucketName: bucket, region: REGION });
    // Issue a per-BUCKET SeaweedFS identity scoped to ONLY this bucket (#553, #673), so
    // the tenant gets a credential that can't reach ANY other bucket — not another
    // tenant's bucket AND not a sibling bucket in the same workspace — instead of sharing
    // the broad admin/master key. Keyed on the (globally-unique, workspace-embedding)
    // physical bucket name; the issuer does delete-then-apply so a re-provision is a clean
    // rotate (exactly one active key, no accumulation) — fixing #673, where a single
    // per-workspace identity accumulated a grant + a new key for EVERY bucket so a cred
    // "scoped to bucket A" could list buckets B/C in the same workspace. Best-effort: a
    // failure here must not fail the provision (the bucket is still usable via the
    // tenant-gated REST API); the credential can be re-issued via the rotate endpoint.
    // Enabled by DEFAULT (filer-mode) — see tenantIdentitiesEnabled: gating only on
    // STORAGE_TENANT_IDENTITIES=1 meant a values overlay that REPLACED the control-plane
    // env list silently dropped the flag, so every provision returned storageCredential:
    // null and a single shared admin cred served all tenants (P1 tenant-isolation, live
    // 2026-06-18). It can still be turned off explicitly (='0').
    let storageCredential = null;
    if (tenantIdentitiesEnabled()) {
      try {
        const issued = await issueBucketIdentity({ bucket, workspaceId: ws.id });
        // Return the one-time secret to the caller; never persist the plaintext secret.
        storageCredential = { identityName: issued.identityName, accessKey: issued.accessKey, secretKey: issued.secretKey, bucket: issued.bucket, actions: issued.actions };
      } catch (e) {
        console.error('[storage] per-bucket identity issuance failed (bucket provisioned without a scoped credential):', e?.message ?? e);
      }
    }
    return ok(201, { bucket: { resourceId: bucket, bucketName: bucket, workspaceId: ws.id, tenantId: ws.tenant_id, region: REGION, status: 'active' }, record: rec, storageCredential });
  } catch (e) {
    return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'STORAGE_PROVISION_FAILED', String(e.message ?? e));
  }
}

// POST /v1/storage/buckets/{bucketId}/credentials — ROTATE the bucket's storage
// credential (#673). Re-issues the per-bucket identity (delete-then-apply), so the
// PRIOR access key for this bucket no longer authenticates and a single fresh key
// scoped to ONLY this bucket is returned. Bucket-keyed (not product credentialId-keyed)
// to match the existing kind storage routes; the response is the same `storageCredential`
// shape `storageProvisionBucket` returns. Ownership-gated exactly like object I/O.
async function storageRotateCredential(ctx) {
  const bucket = ctx.params.bucketId;
  const gate = await requireOwnedBucketForStructuralWrite(ctx, bucket); if (gate.error) return gate.error;
  const rec = gate.rec;
  if (!tenantIdentitiesEnabled()) {
    return err(409, 'STORAGE_IDENTITIES_DISABLED', 'per-bucket storage identities are disabled (STORAGE_TENANT_IDENTITIES=0)');
  }
  try {
    // ctx.seaweedClient is an OPTIONAL test seam (the in-pod default is the real k8s
    // client inside seaweedfs-identity.mjs); production passes nothing → real client.
    const clientOpt = ctx.seaweedClient ? { client: ctx.seaweedClient } : {};
    const issued = await issueBucketIdentity({ bucket, workspaceId: rec.workspace_id, ...clientOpt });
    // ALSO delete the LEGACY per-workspace identity for this bucket's workspace (#673): a
    // pre-fix `falcone-ws-<wsId>` identity still accumulated a grant for this bucket, so
    // unless we remove it the rotated per-bucket key would NOT be the only key reaching the
    // bucket. The startup migration sweeps these too; doing it here makes a single rotate
    // between deploys immediately invalidate every key that can reach the bucket. Best-effort
    // — the per-bucket re-issue above is the primary action; a failure here must not fail the
    // rotate (and a missing legacy identity is a clean no-op).
    await revokeLegacyWorkspaceIdentity(rec.workspace_id, ctx.seaweedClient);
    return ok(200, { storageCredential: { identityName: issued.identityName, accessKey: issued.accessKey, secretKey: issued.secretKey, bucket: issued.bucket, actions: issued.actions } });
  } catch (e) {
    return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'STORAGE_CREDENTIAL_ROTATE_FAILED', String(e.message ?? e));
  }
}

// Best-effort delete of the legacy per-WORKSPACE identity (`falcone-ws-<wsId>`) on
// rotate/revoke (#673). The per-bucket action is the primary fix; this also removes the
// over-granted legacy identity so it can no longer reach the bucket. Never throws (a
// missing identity or a transient Job-post failure must not fail the caller's operation);
// only logs. Skips when there is no workspace id.
async function revokeLegacyWorkspaceIdentity(workspaceId, seaweedClient) {
  if (!workspaceId) return;
  try {
    const identityName = workspaceIdentityName(workspaceId);
    await revokeIdentityByName({ identityName, jobPrefix: 'wsrm', ...(seaweedClient ? { client: seaweedClient } : {}) });
  } catch (e) {
    console.error(`[storage] best-effort legacy per-workspace identity delete failed (workspace ${workspaceId}):`, e?.message ?? e);
  }
}

// DELETE /v1/storage/buckets/{bucketId}/credentials — REVOKE the bucket's storage
// credential (#673). Deletes the per-bucket SeaweedFS identity (and all its keys) so the
// prior access key is rejected. Idempotent (revoking when no identity exists still
// succeeds). Ownership-gated exactly like object I/O.
async function storageRevokeCredential(ctx) {
  const bucket = ctx.params.bucketId;
  const gate = await requireOwnedBucketForStructuralWrite(ctx, bucket); if (gate.error) return gate.error;
  const rec = gate.rec;
  try {
    // ctx.seaweedClient is an OPTIONAL test seam (see storageRotateCredential).
    await revokeBucketIdentity({ bucket, ...(ctx.seaweedClient ? { client: ctx.seaweedClient } : {}) });
    // ALSO delete the LEGACY per-workspace identity (`falcone-ws-<wsId>`) for this bucket's
    // workspace (#673): a pre-fix shared identity also held a grant for this bucket, so a
    // revoke that only deleted the per-bucket identity would leave that legacy key still
    // able to reach the (deterministically-named, possibly re-created) bucket. Best-effort
    // — the per-bucket delete above is the primary; a missing legacy identity is a no-op.
    await revokeLegacyWorkspaceIdentity(rec.workspace_id, ctx.seaweedClient);
    return ok(200, { bucket, revoked: true });
  } catch (e) {
    return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'STORAGE_CREDENTIAL_REVOKE_FAILED', String(e.message ?? e));
  }
}

// DELETE /v1/storage/buckets/{bucketId} — delete a SINGLE bucket the caller owns (#676). The
// only prior way to remove a bucket was deleting the whole workspace (deleteWorkspace) or
// purging the tenant; deleteBucket() existed but was wired only into those cascades. This
// makes bucket lifecycle symmetric (provision ↔ delete one bucket). Ownership-gated exactly
// like object I/O: non-owner → 404 BUCKET_NOT_FOUND (no existence leak). Removes the physical
// SeaweedFS bucket (and its objects), the workspace_buckets registry row, and — best-effort —
// the per-bucket + legacy per-workspace SeaweedFS identities so no orphaned credential survives.
async function storageDeleteBucket(ctx) {
  const bucket = ctx.params.bucketId;
  const gate = await requireOwnedBucketForStructuralWrite(ctx, bucket); if (gate.error) return gate.error;
  const rec = gate.rec;
  try {
    // 1) Physical bucket + objects (idempotent: a missing bucket is treated as success).
    await deleteBucket(bucket);
    // 2) Registry row (the source of truth for the tenant→bucket mapping).
    await store.deleteBucketRecord(ctx.pool, bucket);
    // 3) Best-effort credential cleanup — a failure here must not fail the delete (the bucket
    //    and its row are already gone; a dangling identity grants access to nothing).
    try { await revokeBucketIdentity({ bucket, ...(ctx.seaweedClient ? { client: ctx.seaweedClient } : {}) }); }
    catch (e) { console.error('[storage] best-effort per-bucket identity delete failed on bucket delete:', e?.message ?? e); }
    await revokeLegacyWorkspaceIdentity(rec.workspace_id, ctx.seaweedClient);
    return ok(200, { bucket, deleted: true });
  } catch (e) {
    return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'STORAGE_BUCKET_DELETE_FAILED', String(e.message ?? e));
  }
}

// POST /v1/storage/buckets/{bucketId}/objects/{objectKey}/presign — issue a time-limited,
// scope-limited SigV4 query-presigned URL for ONE object operation (#676). Body:
// { operation: 'download'|'upload', ttlSeconds? }. The TTL is clamped to PRESIGN_MAX_TTL_SECONDS
// (mirrors validateStoragePresignedTtl in packages/adapters/src/storage-multipart-presigned.mjs).
// The returned URL is bound to exactly this bucket+key+operation (the signature covers the
// canonical URI and method) so it grants NO cross-bucket/-tenant access — and only the requested
// verb (GET for download, PUT for upload). Ownership-gated like object I/O; a non-owner gets 404
// BEFORE any URL is minted, so a presigned URL for a bucket the caller does not own is impossible.
// Response shape mirrors buildStoragePresignedUrlRecord: { url, operation, bucketName, objectKey,
// expiresAt, ttlSeconds, ttlClamped }. The SigV4 SECRET never appears in the URL or response.
async function storagePresignObject(ctx) {
  const { key, error } = decodeObjectKey(ctx.params.objectKey); if (error) return error;
  const bucket = ctx.params.bucketId; const gate = await requireOwnedBucketForStructuralWrite(ctx, bucket); if (gate.error) return gate.error;
  const operation = String(ctx.body?.operation ?? 'download').toLowerCase();
  if (operation !== 'download' && operation !== 'upload') {
    return err(400, 'INVALID_PRESIGN_OPERATION', "operation must be 'download' or 'upload'");
  }
  // Clamp the requested TTL to the platform max (mirrors validateStoragePresignedTtl). A
  // missing/invalid TTL falls back to the default; a value over the max is silently clamped.
  const requested = Number(ctx.body?.ttlSeconds);
  const requestedTtl = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : PRESIGN_DEFAULT_TTL_SECONDS;
  const ttlClamped = requestedTtl > PRESIGN_MAX_TTL_SECONDS;
  const ttlSeconds = ttlClamped ? PRESIGN_MAX_TTL_SECONDS : requestedTtl;
  const httpMethod = operation === 'upload' ? 'PUT' : 'GET';
  const url = presignS3Url(httpMethod, bucket, key, ttlSeconds);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  return ok(200, { url, operation, bucketName: bucket, objectKey: key, expiresAt, ttlSeconds, ttlClamped });
}

// ---- multipart upload handlers (#676) --------------------------------------
// Large/resumable uploads via initiate → upload-part(s) → complete (or abort). Every route
// re-runs the bucket ownership/admin-role gate + decodeObjectKey: the uploadId is opaque/S3-managed
// and grants nothing on its own, so isolation comes from re-checking that the CALLER owns the bucket
// and may structurally write on each call. A multipart session for a bucket the caller does not own
// is impossible (404 before any S3 call). On COMPLETE the SAME per-workspace byte-quota admission
// storagePutObject applies is enforced against the assembled object's real size, so multipart cannot
// bypass the quota.

// POST .../objects/{objectKey}/multipart — CreateMultipartUpload. Returns the opaque uploadId.
async function storageMultipartInitiate(ctx) {
  const { key, error } = decodeObjectKey(ctx.params.objectKey); if (error) return error;
  const bucket = ctx.params.bucketId; const gate = await requireOwnedBucketForStructuralWrite(ctx, bucket); if (gate.error) return gate.error;
  const contentType = ctx.body?.contentType ?? 'application/octet-stream';
  try {
    const { uploadId } = await createMultipartUpload(bucket, key, contentType);
    return ok(201, { uploadId, bucketName: bucket, objectKey: key, state: 'active' });
  } catch (e) { return storageFailure(e, 'STORAGE_MULTIPART_INITIATE_FAILED'); }
}

// PUT .../objects/{objectKey}/multipart/{uploadId}/parts/{partNumber} — UploadPart. The part
// body is the raw/binary request body (resolveObjectBody handles the JSON-envelope form too).
async function storageMultipartUploadPart(ctx) {
  const { key, error } = decodeObjectKey(ctx.params.objectKey); if (error) return error;
  const bucket = ctx.params.bucketId; const gate = await requireOwnedBucketForStructuralWrite(ctx, bucket); if (gate.error) return gate.error;
  const uploadId = ctx.params.uploadId;
  const partNumber = Number(ctx.params.partNumber);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
    return err(400, 'INVALID_PART_NUMBER', 'partNumber must be an integer in 1..10000');
  }
  const { bytes, error: bodyError } = resolveObjectBody(ctx); if (bodyError) return bodyError;
  try {
    const part = await uploadPart(bucket, key, uploadId, partNumber, bytes);
    return ok(200, { partNumber: part.partNumber, etag: part.etag, sizeBytes: bytes.length });
  } catch (e) { return storageFailure(e, 'STORAGE_MULTIPART_UPLOAD_PART_FAILED'); }
}

// POST .../objects/{objectKey}/multipart/{uploadId}/complete — CompleteMultipartUpload. Body:
// { parts: [{ partNumber, etag }, ...] }. The part list is validated for a strictly-ordered,
// gap-free, non-empty sequence (mirrors validateStoragePartList) BEFORE the backend call.
async function storageMultipartComplete(ctx) {
  const { key, error } = decodeObjectKey(ctx.params.objectKey); if (error) return error;
  const bucket = ctx.params.bucketId; const gate = await requireOwnedBucketForStructuralWrite(ctx, bucket); if (gate.error) return gate.error;
  const uploadId = ctx.params.uploadId;
  const parts = Array.isArray(ctx.body?.parts) ? ctx.body.parts : null;
  // Validate the ordered part list inline (mirrors validateStoragePartList): non-empty, every
  // partNumber a positive integer, strictly increasing with no gaps, unique.
  const validation = validatePartListInline(parts);
  if (!validation.valid) return err(400, 'INVALID_PART_LIST', validation.errors[0]);
  try {
    const result = await completeMultipartUpload(bucket, key, uploadId, validation.parts);
    // Per-workspace byte-quota admission AFTER assembly (#674/#676): multipart must not be a
    // quota bypass. Enforced only when STORAGE_MAX_BYTES is configured (usageLimits().maxBytes
    // != null short-circuits otherwise, so the hot path is unchanged). HEAD the assembled object
    // for its real size, then check it against the workspace's other buckets' current bytes. If
    // it would exceed the limit, delete the just-assembled object and return 409 — the bytes do
    // not persist. Fails OPEN if the quota model / size lookup is unavailable.
    if (usageLimits().maxBytes != null) {
      let assembledBytes = 0;
      try { const meta = await headObject(bucket, key); assembledBytes = Number(meta.size) || 0; } catch { /* size unknown → fail open */ }
      if (assembledBytes > 0) {
        const currentBytes = await workspaceCurrentBytes(ctx, bucket);
        // currentBytes already includes the just-completed object; compare prior usage + this object.
        const priorBytes = Math.max(currentBytes - assembledBytes, 0);
        const decision = checkByteQuota(priorBytes, assembledBytes, {});
        if (!decision.allowed) {
          try { await deleteObject(bucket, key); } catch { /* best-effort rollback */ }
          return err(409, STORAGE_QUOTA_EXCEEDED,
            `storage byte quota would be exceeded for this workspace: ${priorBytes + assembledBytes}/${decision.limit} bytes`);
        }
      }
    }
    return ok(200, { objectKey: key, bucketName: bucket, etag: result.etag, parts: validation.parts.length, completed: true });
  } catch (e) { return storageFailure(e, 'STORAGE_MULTIPART_COMPLETE_FAILED'); }
}

// DELETE .../objects/{objectKey}/multipart/{uploadId} — AbortMultipartUpload (cleanup of an
// in-progress session and its already-uploaded parts).
async function storageMultipartAbort(ctx) {
  const { key, error } = decodeObjectKey(ctx.params.objectKey); if (error) return error;
  const bucket = ctx.params.bucketId; const gate = await requireOwnedBucketForStructuralWrite(ctx, bucket); if (gate.error) return gate.error;
  const uploadId = ctx.params.uploadId;
  try {
    await abortMultipartUpload(bucket, key, uploadId);
    return ok(200, { objectKey: key, bucketName: bucket, uploadId, aborted: true });
  } catch (e) { return storageFailure(e, 'STORAGE_MULTIPART_ABORT_FAILED'); }
}

// Inline ordered-part-list validation (mirrors validateStoragePartList in
// packages/adapters/src/storage-multipart-presigned.mjs; duplicated because the kind-runtime
// image cannot import the services package). Requires a non-empty list of { partNumber, etag }
// with strictly-increasing, gap-free, unique partNumbers starting at 1. Returns the normalized
// part list on success.
function validatePartListInline(parts) {
  if (!Array.isArray(parts) || parts.length === 0) {
    return { valid: false, errors: ['Multipart completion requires a non-empty part list.'] };
  }
  const normalized = [];
  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i] ?? {};
    const partNumber = p.partNumber;
    const etag = String(p.etag ?? '').replace(/"/g, '');
    if (!Number.isInteger(partNumber) || partNumber < 1) {
      return { valid: false, errors: [`Invalid part number at index ${i}.`] };
    }
    if (!etag) return { valid: false, errors: [`Part ${partNumber} is missing an etag.`] };
    if (partNumber !== i + 1) {
      return { valid: false, errors: [`Multipart part list has a gap or misordering at expected part ${i + 1}.`] };
    }
    normalized.push({ partNumber, etag });
  }
  return { valid: true, errors: [], parts: normalized };
}

// ---- bucket export / import (#683, data-export-import-clone) ----------------
// Bounded, synchronous, self-contained object movement. Export lists a bucket's objects, downloads
// each, and returns a manifest with inline base64 object bodies; import accepts that same manifest
// shape and PUTs the (decoded) objects into a target bucket the caller owns. v1 limits (no async
// pipeline, no streaming): a per-object and a total inline-body cap (413 over either), and a maximum
// object count per operation. The manifest is ALSO persisted as a reserved object in the SAME bucket
// so a later GET can read it back — no new persistence table, naturally bucket/tenant-scoped.
//
// Reserved manifest key prefix. Mirrors the platform adapter's protected `_platform/` namespace
// concept (packages/adapters storage-import-export validateImportManifestEntry) but uses a Falcone-
// owned prefix that the import validator also refuses to write, so an import can never overwrite an
// export manifest or smuggle data under the reserved namespace.
const EXPORT_MANIFEST_PREFIX = '.falcone/exports/';
// v1 bounded-size limits (override-able via env for operators). Defaults keep a single export/import
// modest so the synchronous inline path stays within request/memory limits.
const EXPORT_MAX_OBJECTS = (() => { const n = Number(process.env.STORAGE_EXPORT_MAX_OBJECTS); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1000; })();
const EXPORT_MAX_OBJECT_BYTES = (() => { const n = Number(process.env.STORAGE_EXPORT_MAX_OBJECT_BYTES); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 10 * 1024 * 1024; })();
const EXPORT_MAX_TOTAL_BYTES = (() => { const n = Number(process.env.STORAGE_EXPORT_MAX_TOTAL_BYTES); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 64 * 1024 * 1024; })();

// Deterministic id helper (mirrors packages/adapters storage-import-export buildDeterministicId:
// `<prefix>_<sha18>`). Pure; used for manifestId / importId so a given (tenant,bucket,time,nonce)
// is stable and carries no caller-controlled text.
function manifestHashId(prefix, seed) {
  return `${prefix}_${crypto.createHash('sha256').update(String(seed)).digest('hex').slice(0, 18)}`;
}

// Is a key reserved (the export-manifest namespace)? Such keys are hidden from export entries and
// refused by import — they are platform-internal, not tenant object data.
function isReservedKey(key) {
  return String(key ?? '').startsWith(EXPORT_MANIFEST_PREFIX) || /(^|\/)_platform\//.test(String(key ?? ''));
}

// Resolve + gate a workspace-addressed bucket: the bucket must exist, belong to the caller's tenant,
// AND be mapped to the workspace in the path (so the workspace param is meaningful, not decorative).
// Superadmin/internal bypass. Returns { error } to short-circuit (404, no existence leak) or { rec }.
async function ownedWorkspaceBucket(ctx, workspaceId, bucket) {
  const rec = await store.getBucketRecord(ctx.pool, bucket);
  if (isSuperOrInternal(ctx.identity)) {
    if (!rec) return { error: err(404, 'BUCKET_NOT_FOUND', `bucket ${bucket} not found`) };
    return { rec };
  }
  if (!rec || rec.tenant_id !== ctx.identity.tenantId || (workspaceId && rec.workspace_id !== workspaceId)) {
    return { error: err(404, 'BUCKET_NOT_FOUND', `bucket ${bucket} not found`) };
  }
  return { rec };
}

// Validate a single import manifest entry against the TARGET tenant. Mirrors packages/adapters
// storage-import-export::validateImportManifestEntry (duplicated inline — the services package is not
// in this image): reject an invalid/traversal key (INVALID_OBJECT_KEY), the reserved/protected
// namespace (OBJECT_PROTECTED), and a body whose recorded source tenant differs from the target
// (CROSS_TENANT_VIOLATION) — so a manifest exported from tenant A can never be imported into tenant B.
function validateImportEntryInline(entry, targetTenantId) {
  const decoded = decodeObjectKey(String(entry?.objectKey ?? ''));
  if (decoded.error) return { valid: false, reason: 'INVALID_OBJECT_KEY' };
  if (isReservedKey(entry?.objectKey)) return { valid: false, reason: 'OBJECT_PROTECTED' };
  const srcTenant = entry?.bodyReference?.tenantId;
  if (srcTenant && targetTenantId && srcTenant !== targetTenantId) {
    return { valid: false, reason: 'CROSS_TENANT_VIOLATION' };
  }
  return { valid: true, reason: null, key: decoded.key };
}

// Acting-principal projection for a manifest (no secrets — just the verified identity).
function actingPrincipalOf(identity) {
  return {
    principalId: identity?.sub ?? null,
    principalType: identity?.actorType ?? null,
    tenantId: identity?.tenantId ?? null
  };
}

// POST /v1/storage/workspaces/{workspaceId}/buckets/{bucketId}/exports
async function storageBucketExport(ctx) {
  const workspaceId = ctx.params.workspaceId;
  const bucket = ctx.params.bucketId;
  const { error, rec } = await ownedWorkspaceBucket(ctx, workspaceId, bucket);
  if (error) return error;
  const roleDeny = denyUnlessStructuralAdmin(ctx, rec.tenant_id);
  if (roleDeny) return roleDeny;
  const prefix = typeof ctx.body?.prefix === 'string' && ctx.body.prefix ? ctx.body.prefix : null;
  // List (bounded) then download each object's bytes inline. Reserved keys are excluded.
  let listing;
  try { listing = await listObjects(bucket, { maxKeys: EXPORT_MAX_OBJECTS }); }
  catch (e) { return storageFailure(e, 'STORAGE_LIST_FAILED'); }
  const candidates = listing.objects
    .filter((o) => !isReservedKey(o.key))
    .filter((o) => (prefix ? String(o.key).startsWith(prefix) : true));
  if (candidates.length > EXPORT_MAX_OBJECTS) {
    return err(413, 'STORAGE_EXPORT_TOO_LARGE', `export exceeds the ${EXPORT_MAX_OBJECTS}-object limit`);
  }
  const entries = [];
  let totalBytes = 0;
  for (const obj of candidates) {
    let got;
    try { got = await getObject(bucket, obj.key); }
    catch (e) { return storageFailure(e, 'STORAGE_GET_FAILED'); }
    if (got.bytes.length > EXPORT_MAX_OBJECT_BYTES) {
      return err(413, 'STORAGE_EXPORT_TOO_LARGE', `object exceeds the ${EXPORT_MAX_OBJECT_BYTES}-byte per-object export limit`);
    }
    totalBytes += got.bytes.length;
    if (totalBytes > EXPORT_MAX_TOTAL_BYTES) {
      return err(413, 'STORAGE_EXPORT_TOO_LARGE', `export exceeds the ${EXPORT_MAX_TOTAL_BYTES}-byte total limit`);
    }
    entries.push({
      entityType: 'storage_export_manifest_entry',
      objectKey: obj.key,
      sizeBytes: got.bytes.length,
      contentType: got.contentType ?? 'application/octet-stream',
      contentEncoding: 'base64',
      storageClass: obj.storageClass ?? 'standard',
      customMetadata: {},
      lastModifiedAt: obj.lastModified ?? nowIso(),
      // The inline body lives under bodyReference (open object in the OpenAPI schema). tenantId binds
      // the body to the SOURCE tenant so import can detect a cross-tenant manifest.
      bodyReference: { tenantId: rec.tenant_id, encoding: 'base64', inlineBase64: got.bytes.toString('base64') }
    });
  }
  const exportedAt = nowIso();
  const manifestId = manifestHashId('smf', `${rec.tenant_id}:${bucket}:${exportedAt}:${entries.length}`);
  const manifest = {
    entityType: 'storage_export_manifest',
    manifestId,
    formatVersion: 1,
    sourceBucketId: bucket,
    sourceWorkspaceId: rec.workspace_id,
    sourceTenantId: rec.tenant_id,
    actingPrincipal: actingPrincipalOf(ctx.identity),
    exportedAt,
    filterCriteria: { prefix, metadataFilter: null },
    totalObjects: entries.length,
    totalBytes,
    entries
  };
  // Persist the manifest as a reserved object in the SAME bucket so GET .../exports/{manifestId}
  // can read it back. Best-effort: a persistence failure does not fail the export (the manifest is
  // already returned inline); the GET endpoint then 404s for that id.
  try {
    await putObject(bucket, `${EXPORT_MANIFEST_PREFIX}${manifestId}.json`, Buffer.from(JSON.stringify(manifest), 'utf8'), 'application/json');
  } catch (e) { console.error(`[storage] export manifest persist failed (non-fatal): ${String(e?.message ?? e)}`); }
  return ok(200, manifest);
}

// GET /v1/storage/workspaces/{workspaceId}/buckets/{bucketId}/exports/{manifestId}
async function storageBucketExportManifestGet(ctx) {
  const workspaceId = ctx.params.workspaceId;
  const bucket = ctx.params.bucketId;
  const { error } = await ownedWorkspaceBucket(ctx, workspaceId, bucket);
  if (error) return error;
  const manifestId = String(ctx.params.manifestId ?? '');
  // Only accept the deterministic id shape (no traversal into arbitrary reserved keys).
  if (!/^smf_[0-9a-f]{18}$/.test(manifestId)) return err(404, 'EXPORT_MANIFEST_NOT_FOUND', 'export manifest not found');
  let got;
  try { got = await getObject(bucket, `${EXPORT_MANIFEST_PREFIX}${manifestId}.json`); }
  catch (e) { if (e?.statusCode === 404) return err(404, 'EXPORT_MANIFEST_NOT_FOUND', 'export manifest not found'); return storageFailure(e, 'STORAGE_GET_FAILED'); }
  try { return ok(200, JSON.parse(got.bytes.toString('utf8'))); }
  catch { return err(404, 'EXPORT_MANIFEST_NOT_FOUND', 'export manifest not found'); }
}

// POST /v1/storage/workspaces/{workspaceId}/buckets/{bucketId}/imports
async function storageBucketImport(ctx) {
  const workspaceId = ctx.params.workspaceId;
  const bucket = ctx.params.bucketId;
  const { error, rec } = await ownedWorkspaceBucket(ctx, workspaceId, bucket);
  if (error) return error;
  const roleDeny = denyUnlessStructuralAdmin(ctx, rec.tenant_id);
  if (roleDeny) return roleDeny;
  const manifest = ctx.body?.manifest ?? ctx.body;
  if (!manifest || typeof manifest !== 'object' || manifest.formatVersion !== 1 || !Array.isArray(manifest.entries)) {
    return err(400, 'INVALID_IMPORT_MANIFEST', 'a formatVersion:1 manifest with an entries array is required');
  }
  if (manifest.entries.length > EXPORT_MAX_OBJECTS) {
    return err(413, 'STORAGE_IMPORT_TOO_LARGE', `import exceeds the ${EXPORT_MAX_OBJECTS}-object limit`);
  }
  const conflictPolicy = ['overwrite', 'skip', 'fail'].includes(ctx.body?.conflictPolicy) ? ctx.body.conflictPolicy : 'overwrite';
  const targetTenantId = isSuperOrInternal(ctx.identity) ? rec.tenant_id : ctx.identity.tenantId;
  const outcomes = [];
  let totalBytesImported = 0;
  for (const entry of manifest.entries) {
    const verdict = validateImportEntryInline(entry, targetTenantId);
    if (!verdict.valid) {
      outcomes.push({ entityType: 'storage_import_entry_outcome', objectKey: entry?.objectKey ?? null, status: 'failed', reason: verdict.reason, sizeBytes: 0 });
      continue;
    }
    const ref = entry.bodyReference ?? {};
    const bytes = ref.encoding === 'base64' || ref.inlineBase64
      ? Buffer.from(String(ref.inlineBase64 ?? ''), 'base64')
      : Buffer.from(String(ref.inline ?? ''), 'utf8');
    if (bytes.length > EXPORT_MAX_OBJECT_BYTES) {
      outcomes.push({ entityType: 'storage_import_entry_outcome', objectKey: verdict.key, status: 'failed', reason: 'OBJECT_TOO_LARGE', sizeBytes: bytes.length });
      continue;
    }
    // skip → leave an existing object untouched; fail → refuse the entry (never overwrite).
    if (conflictPolicy === 'skip' || conflictPolicy === 'fail') {
      let exists = false;
      try { await headObject(bucket, verdict.key); exists = true; }
      catch (e) { if (e?.statusCode !== 404) { outcomes.push({ entityType: 'storage_import_entry_outcome', objectKey: verdict.key, status: 'failed', reason: 'BACKEND_ERROR', sizeBytes: 0 }); continue; } }
      if (exists) {
        outcomes.push(conflictPolicy === 'skip'
          ? { entityType: 'storage_import_entry_outcome', objectKey: verdict.key, status: 'skipped', reason: 'OBJECT_EXISTS', sizeBytes: 0 }
          : { entityType: 'storage_import_entry_outcome', objectKey: verdict.key, status: 'failed', reason: 'OBJECT_EXISTS', sizeBytes: 0 });
        continue;
      }
    }
    try {
      await putObject(bucket, verdict.key, bytes, entry.contentType ?? 'application/octet-stream');
      totalBytesImported += bytes.length;
      outcomes.push({ entityType: 'storage_import_entry_outcome', objectKey: verdict.key, status: 'imported', reason: null, sizeBytes: bytes.length });
    } catch (e) {
      outcomes.push({ entityType: 'storage_import_entry_outcome', objectKey: verdict.key, status: 'failed', reason: 'BACKEND_ERROR', sizeBytes: 0 });
      console.error(`[storage] import put failed for an object (status ${e?.statusCode}): ${String(e?.message ?? e)}`);
    }
  }
  const importedAt = nowIso();
  return ok(200, {
    entityType: 'storage_import_result_summary',
    importId: manifestHashId('sir', `${targetTenantId}:${bucket}:${importedAt}:${conflictPolicy}:${outcomes.length}`),
    targetBucketId: bucket,
    targetWorkspaceId: rec.workspace_id,
    targetTenantId,
    actingPrincipal: actingPrincipalOf(ctx.identity),
    importedAt,
    conflictPolicy,
    totalEntries: outcomes.length,
    importedCount: outcomes.filter((o) => o.status === 'imported').length,
    skippedCount: outcomes.filter((o) => o.status === 'skipped').length,
    failedCount: outcomes.filter((o) => o.status === 'failed').length,
    totalBytesImported,
    outcomes
  });
}

export const STORAGE_HANDLERS = {
  storageListBuckets, storageListObjects, storageObjectMetadata, storageWorkspaceUsage, storageProvisionBucket,
  storagePutObject, storageGetObject, storageDeleteObject, storageDeleteBucket,
  storagePresignObject,
  storageMultipartInitiate, storageMultipartUploadPart, storageMultipartComplete, storageMultipartAbort,
  storageRotateCredential, storageRevokeCredential,
  storageBucketExport, storageBucketExportManifestGet, storageBucketImport
};
