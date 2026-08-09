# Storage object I/O: presigned URLs, range reads, multipart upload, per-bucket delete

Falcone's object-store API exposes the full object-I/O surface a BaaS storage service is expected to
provide. Beyond the basic bucket list/provision, per-workspace usage, and single-object
PUT/GET/DELETE/metadata, the control-plane storage handlers also serve **presigned/temporary URLs**,
**HTTP range/partial reads**, **multipart/resumable upload**, and **per-bucket delete**.

All of these operations are **tenant-scoped**: the bucket-ownership gate runs **before** any
storage-backend call, so a caller that is neither superadmin/internal nor the owning tenant of the
target bucket receives `404 BUCKET_NOT_FOUND` with no existence leak. A presigned URL or a multipart
session for a bucket the caller does not own is impossible, and the raw S3/SeaweedFS error payload
and the physical bucket path are never echoed to the caller.

All routes ride the gateway under `/v1/storage/*` and require an authenticated principal.

## Single-object body envelope (write and read)

The JSON body of `PUT /v1/storage/buckets/{bucketId}/objects/{objectKey}` is
`StorageObjectWriteRequest`: `contentBase64` is **required** and the schema is
`additionalProperties: false`, so **`contentBase64` is the field to write** and it carries the
payload base64-encoded. An upload may alternatively send a raw/binary request body under any
non-JSON content type, in which case the exact request bytes are stored.

| Body | Behaviour |
| --- | --- |
| `{ contentBase64, contentType, … }` | The decoded bytes are stored exactly. This is the contract-conformant form. |
| `{ content, encoding: "base64", contentType }` | **Legacy fallback**, still accepted (the web console ships it). Same bytes. |
| `{ content, contentType }` (no `encoding`) | **Legacy fallback**: the string is stored as UTF-8. |
| A raw/binary request body (any non-JSON content type) | The exact request bytes are stored. |
| `contentBase64` present but not a string | `400 STORAGE_INVALID_BODY` — nothing is written. |
| `contentBase64` present but not unambiguous base64 | `400 STORAGE_INVALID_BODY` — nothing is written. |
| No `contentBase64` and no `content` | `400 STORAGE_INVALID_BODY` — nothing is written. |
| `contentBase64: ""`, `{ content: "" }`, or a **zero-length request body** | `201` with `sizeBytes: 0` — an explicitly empty object. |
| A zero-length body under an **explicit** `application/json` (or `+json`) content type | `400 STORAGE_INVALID_BODY` — a client that declares an envelope and sends nothing failed to serialize. An *absent* content type is not a declaration, so a bodyless `curl -X PUT` still writes an empty object. |

The stored content type is the envelope's `contentType`, defaulting to `application/octet-stream`.
The request's `Content-Type` header is **not** a fallback for it: that header describes the
*envelope*, not the payload, so honouring it would store a binary object as `application/json` — and
that is what a later `GET` reports and what a browser receives from a presigned URL. A raw/binary
upload has no envelope, so there the request header *is* the payload's type.

Both `400`s are raised **before** any storage-backend call, and both come **after** the
bucket-ownership and role gates — so a caller who does not own the bucket still gets
`404 BUCKET_NOT_FOUND` whatever the body looks like, and an unusable body never reveals that a
bucket exists.

`contentBase64` is accepted in any form that decodes to exactly one byte string, which is wider
than RFC 4648 §3.2's canonical encoding on purpose: the contract-*mandated* field must not be
stricter than the legacy `content` field it replaces. ASCII whitespace — tab, newline, form feed,
carriage return, space, and nothing else — is stripped first (so newline-wrapped output from
`openssl base64` or Python's `base64.encodebytes()` is fine, while a stray NBSP or BOM is still a
`400`, since no base64 encoder emits one). Padding is
optional (Go's `RawStdEncoding` and JWT-style encoders omit it) but must complete its 4-character
quantum when present, and either the standard (`+/`) or URL-safe (`-_`) alphabet is accepted — but
not a mix of the two, which is valid in neither and is the signal a payload is corrupt. Anything
else is a `400`, because `Buffer.from(x, 'base64')` silently **drops** out-of-alphabet characters
and would otherwise store a truncated object under a `201`. A non-string `contentBase64` is refused
on its type: `String(true)` is `"true"`, which is valid base64, so coercion would store 3 bytes the
client never sent.

`contentBase64` **wins whenever both fields are present**, which is what makes GET → PUT lossless:
the read envelope carries `contentBase64` + `encoding: "base64"`, so a read response replayed
verbatim as a write body reproduces the object byte-identically (the copy/backup/restore pattern).

The read envelope of `GET …/objects/{objectKey}` carries exactly one payload representation —
`contentBase64` — plus `encoding`, `contentType`, `sizeBytes` and the object/bucket identifiers.
It deliberately does **not** carry a `content` text field: a UTF-8 view of arbitrary stored bytes is
a lossy conversion (every invalid sequence becomes U+FFFD) and returning it next to the exact field,
on an HTTP 200, was silent corruption for any client that read the obvious field first (#966). A
representation that cannot reproduce the stored bytes is omitted rather than degraded.

Before this was fixed (#994, the write half; #966, the read half) the handler read only
`content`/`encoding` — the fields the schema forbids — so the only contract-conformant write stored
**0 bytes and returned 201**, and replaying a read response as a write body base64-decoded the lossy
`content` while ignoring the exact `contentBase64`. Both halves are one envelope contract, which is
why they are documented and tested together (`tests/blackbox/storage-object-write-envelope.test.mjs`).

### Operator note: objects a pre-fix deployment stored empty

The fix cannot recover bytes the platform never received. Any object a client wrote with a
contract-conformant `{contentBase64}` body against a **pre-fix** deployment is **0 bytes on disk**,
and the client was told `201`. There is nothing to back-fill: the payload was discarded at the
handler before the backend call. Affected objects are identifiable by
`sizeBytes: 0` / `etag: d41d8cd98f00b204e9800998ecf8427e` (the MD5 of the empty string) in
`GET /v1/storage/buckets/{bucketId}/objects` — though a deliberately empty object looks identical,
so the list is a candidate set, not a defect list. Only the writing client can re-upload.

## Range / partial reads (HTTP 206)

`GET /v1/storage/buckets/{bucketId}/objects/{objectKey}` honours an HTTP `Range` request header.

- **WHEN** the request carries a satisfiable `Range` (e.g. `Range: bytes=0-3`), the response is
  `206 Partial Content` with a `Content-Range` header, an `Accept-Ranges: bytes` header, and only the
  requested byte range. The JSON body's `sizeBytes` reflects the **partial** length and
  `partial: true` is set; the bytes are carried (base64) in `contentBase64`.
- **WHEN** no `Range` header is present, the response is the unchanged `200` with the full body (and
  `Accept-Ranges: bytes` is still advertised so clients know the object is range-capable).
- An **unsatisfiable** range returns a clean `416` with code `STORAGE_RANGE_NOT_SATISFIABLE`.

```bash
curl -s -H "authorization: Bearer $TOKEN" -H "Range: bytes=0-3" \
  "$GATEWAY/v1/storage/buckets/$BUCKET/objects/report.csv"
# -> HTTP 206, Content-Range: bytes 0-3/2048, body contains only the first 4 bytes
```

## Presigned / temporary URLs

`POST /v1/storage/buckets/{bucketId}/objects/{objectKey}/presign` returns a time-limited, scope-limited
SigV4 query-presigned URL that authorises **exactly one** operation on **exactly that** bucket+object —
so the URL can be handed to an external client (browser, `curl`, an SDK) with **no Falcone credential**.

Request body:

| Field | Required | Meaning |
| --- | --- | --- |
| `operation` | yes | `download` (signs a `GET`) or `upload` (signs a `PUT`). |
| `ttlSeconds` | no | Requested lifetime; **clamped** to the platform maximum (see below). |

Response (mirrors the product `StoragePresignedUrlRecord` shape):

```json
{
  "url": "https://s3.example.com/<bucket>/<key>?X-Amz-Algorithm=AWS4-HMAC-SHA256&...&X-Amz-Signature=...",
  "operation": "download",
  "bucketName": "<bucket>",
  "objectKey": "<key>",
  "expiresAt": "2026-06-22T00:05:00.000Z",
  "ttlSeconds": 300,
  "ttlClamped": false
}
```

The URL is bound to the bucket, the object key, the HTTP verb, the host, and the expiry — it cannot be
repointed at another bucket/key/operation without invalidating the signature. The SigV4 **signing
secret never appears** in the URL or the response (only the derived HMAC signature does).

### `STORAGE_S3_PUBLIC_ENDPOINT` (important operator caveat)

The control plane reaches the S3 gateway over the **in-cluster** ClusterIP (`STORAGE_S3_ENDPOINT`,
e.g. `http://<release>-seaweedfs-s3:8333`; the default release renders
`http://falcone-seaweedfs-s3:8333`), which is **not resolvable from outside the cluster**.
A presigned URL signed against that internal host would be useless to an external client.

Set **`STORAGE_S3_PUBLIC_ENDPOINT`** to the externally-routable S3 gateway address; presigned URLs are
then signed and built against that host while the control plane keeps using the internal endpoint for
its own traffic. Because SigV4 is host-bound (`SignedHeaders=host`), `STORAGE_S3_PUBLIC_ENDPOINT`
**must** be the host the client actually connects to, or the signature will not verify. When unset, it
defaults to `STORAGE_S3_ENDPOINT` (so the in-cluster default is unchanged).

| Variable | Default | Meaning |
| --- | --- | --- |
| `STORAGE_S3_PUBLIC_ENDPOINT` | = `STORAGE_S3_ENDPOINT` | Host baked into presigned URLs handed to callers; point at the external gateway. |
| `STORAGE_PRESIGN_MAX_TTL_SECONDS` | `3600` | Platform maximum presigned-URL lifetime (hard-capped at the SigV4 7-day ceiling). Requests above this are clamped (`ttlClamped: true`). |

## Multipart / resumable upload

Large objects are uploaded in parts via initiate → upload-part(s) → complete (or abort). Each route
re-checks bucket ownership; the `uploadId` is opaque and provider-managed (it grants nothing on its
own).

| Step | Route |
| --- | --- |
| Initiate | `POST /v1/storage/buckets/{bucketId}/objects/{objectKey}/multipart` → `{ uploadId, bucketName, objectKey }` |
| Upload part | `PUT /v1/storage/buckets/{bucketId}/objects/{objectKey}/multipart/{uploadId}/parts/{partNumber}` (raw body) → `{ partNumber, etag }` |
| Complete | `POST /v1/storage/buckets/{bucketId}/objects/{objectKey}/multipart/{uploadId}/complete` with `{ "parts": [{ "partNumber": 1, "etag": "..." }, ...] }` → assembled object summary |
| Abort | `DELETE /v1/storage/buckets/{bucketId}/objects/{objectKey}/multipart/{uploadId}` |

The completion part list must be **non-empty, strictly ordered, gap-free, and unique** (starting at
part 1); an invalid list is rejected `400 INVALID_PART_LIST` before the backend call.

**Quota:** completion re-applies the same per-workspace byte-quota admission a single-request upload
applies (see [storage capacity quotas](./storage-capacity-quotas.md)). If `STORAGE_MAX_BYTES` is
configured and the assembled object would exceed the workspace's limit, the completion is rejected
`409 STORAGE_QUOTA_EXCEEDED` and the just-assembled object is removed — multipart cannot bypass the
quota.

## Per-bucket delete

`DELETE /v1/storage/buckets/{bucketId}` removes a **single** bucket the caller owns, making bucket
lifecycle symmetric with provision (previously the only way to remove a bucket was deleting the whole
workspace or purging the tenant). On success (`200 { "bucket": "<bucket>", "deleted": true }`) it
removes:

1. the physical SeaweedFS bucket and its objects (idempotent),
2. the `workspace_buckets` registry row, and
3. (best-effort) the per-bucket and legacy per-workspace SeaweedFS identities, so no orphaned
   credential survives.

A non-owner receives `404 BUCKET_NOT_FOUND` (no existence leak) and nothing is deleted.

## Web console

The console storage page (`Storage`) surfaces most of this object-I/O surface directly:

- Select an object and use the **Presigned URLs** tab to "Generar URL de descarga prefirmada".
- **Create a bucket**: the Buckets card's "Nuevo bucket" control opens a small form (an optional
  bucket-name hint) that calls `POST /v1/storage/workspaces/{workspaceId}/buckets`. Because the
  control plane derives a DNS-safe, workspace-scoped physical name (`deriveBucketName`), the console
  states that the effective name may differ from the hint and always echoes back the bucket name the
  backend actually created. A workspace with zero buckets renders an actionable empty state with a
  "Crear bucket" call to action that opens the same form, so a new workspace is never a dead end. A
  409 (per-workspace bucket-count quota reached) is surfaced through the shared, localized
  `describeConsoleError` mapper — never the raw backend message.
- **Upload an object**: the Objetos tab's "Subir objeto" control opens a form (an optional object-key
  override + a file picker) that reads the selected file in-browser and calls
  `PUT /v1/storage/buckets/{bucketId}/objects/{objectKey}` with the JSON envelope
  `{ content: <base64>, contentType, encoding: "base64" }` — the legacy form `resolveObjectBody`
  still accepts (see "Single-object body envelope" above; new clients should send `contentBase64`),
  so binary content round-trips byte-faithfully. An empty
  bucket's object list renders an actionable "Subir el primer objeto" empty state that opens the same
  form. A 409 (per-workspace byte-quota reached) is surfaced through `describeConsoleError`.
- **Delete a bucket** (per-row **Eliminar** action): this is a **CRITICAL, confirmation-gated**
  destructive operation (issue #758) — clicking it opens the shared destructive-confirmation dialog,
  which states that deleting the bucket removes every object inside it and requires the operator to
  type the bucket's exact name before the `DELETE /v1/storage/buckets/{bucketId}` request is sent. The
  request never fires on a single click.

A full multipart upload UI is not provided in the console (see the "Multipart / resumable upload"
section above); the console's upload affordance is a single-request `PUT`.
