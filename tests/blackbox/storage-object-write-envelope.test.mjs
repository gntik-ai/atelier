// Storage object body envelope — #994 (write half, parent) + #966 (read half).
//
// The published contract (apps/control-plane-executor/openapi/families/storage.openapi.json,
// `StorageObjectWriteRequest`) declares `contentBase64` REQUIRED with `additionalProperties:
// false`, so `contentBase64` is *the* mandated write field and `content`/`encoding` are
// forbidden by the schema. The handler read only `content`/`encoding`: the only
// contract-conformant write stored 0 bytes and returned 201, and replaying a GET response as a
// PUT body base64-decoded the LOSSY `content` field while ignoring the exact `contentBase64`
// one — silent data corruption on a success status.
//
// The read envelope is the other half: `content` was `buffer.toString('utf8')`, a lossy
// conversion that turns any non-UTF-8 byte into U+FFFD with no error and no warning, emitted
// as a first-class field next to the lossless `contentBase64`. `StorageObjectPayload` forbids
// it too.
//
// These tests drive the PUBLIC storage handlers over a fake S3 fetch seam (same pattern as
// storage-object-io-completeness.test.mjs) — they prove HANDLER LOGIC, not SeaweedFS.

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { STORAGE_HANDLERS, resolveObjectBody } from '../../apps/control-plane/storage-handlers.mjs';

const { storagePutObject, storageGetObject, storageMultipartUploadPart } = STORAGE_HANDLERS;

const TENANT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const WS_A = 'ws-aaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BUCKET_A = 'ws-abc123def456-assets';

const BUCKET_ROWS = {
  [BUCKET_A]: { id: 'id-a', workspace_id: WS_A, tenant_id: TENANT_A, bucket_name: BUCKET_A, region: 'us-east-1', created_at: '2026-01-01T00:00:00Z' }
};

function makeMockPool({ buckets = { ...BUCKET_ROWS } } = {}) {
  return {
    query(sql, params) {
      const s = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (s.includes('from workspace_buckets') && s.includes('where bucket_name')) {
        const row = buckets[params[0]] ?? null;
        return Promise.resolve({ rows: row ? [row] : [] });
      }
      if (s.includes('from workspace_buckets') && s.includes('where workspace_id')) {
        return Promise.resolve({ rows: Object.values(buckets).filter((r) => r.workspace_id === params[0]) });
      }
      if (s.includes('from workspace_buckets')) return Promise.resolve({ rows: Object.values(buckets) });
      return Promise.resolve({ rows: [] });
    }
  };
}

const tenantAIdentity = { sub: 'user-a', tenantId: TENANT_A, workspaceId: WS_A, actorType: 'tenant_owner' };

function ctxFor(params, { body = {}, pool, range } = {}) {
  return { params, query: {}, body, identity: tenantAIdentity, pool, req: { headers: range ? { range } : {} } };
}

function s3Response({ status = 200, headers = {}, body = '' } = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    text: async () => buf.toString('utf8')
  };
}

// Stub globalThis.fetch with a one-object in-memory S3: PUT records the exact bytes the handler
// sent to the backend, GET replays them. This is what makes "stored 0 bytes" observable.
function withFakeS3(fn) {
  const original = globalThis.fetch;
  const store = new Map();
  const puts = [];
  globalThis.fetch = async (url, opts = {}) => {
    const path = new URL(String(url)).pathname;
    const method = (opts.method ?? 'GET').toUpperCase();
    if (method === 'PUT') {
      const body = Buffer.isBuffer(opts.body) ? Buffer.from(opts.body) : Buffer.from(String(opts.body ?? ''));
      store.set(path, { body, contentType: opts.headers?.['content-type'] ?? 'application/octet-stream' });
      puts.push({ path, body });
      return s3Response({ status: 200, headers: { etag: `"${crypto.createHash('md5').update(body).digest('hex')}"` } });
    }
    const rec = store.get(path);
    if (!rec) return s3Response({ status: 404, body: '<Error><Code>NoSuchKey</Code></Error>' });
    return s3Response({
      status: 200,
      headers: { 'content-type': rec.contentType, 'content-length': String(rec.body.length) },
      body: rec.body
    });
  };
  return Promise.resolve().then(() => fn({ store, puts })).finally(() => { globalThis.fetch = original; });
}

// ===========================================================================
// #994 scenario 1 — the contract-mandated write field is honoured
// ===========================================================================
test('bbx-stor-env-01: a contract-conformant write ({contentBase64}) stores the decoded bytes, not 0', async () => {
  const pool = makeMockPool();
  await withFakeS3(async ({ store }) => {
    const res = await storagePutObject(ctxFor({ bucketId: BUCKET_A, objectKey: 'conformant.bin' }, {
      pool,
      // Exactly the body StorageObjectWriteRequest requires — no forbidden `content`/`encoding`.
      body: { tenantId: 'ten_a', workspaceId: 'wrk_a', contentType: 'application/octet-stream', contentBase64: 'SEVMTE8=' }
    }));
    assert.equal(res.statusCode, 201, `expected 201, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.sizeBytes, 5, 'the 5 decoded bytes are reported, not 0');
    const stored = store.get(`/${BUCKET_A}/conformant.bin`).body;
    assert.equal(stored.toString('utf8'), 'HELLO', 'the backend received the decoded bytes');
  });
});

test('bbx-stor-env-02: contentBase64 wins over content when both are present (a replayed GET body)', () => {
  // The read envelope carries content + contentBase64 + encoding:'base64' together. Decoding the
  // lossy `content` field there is exactly the GET->PUT corruption; the exact field must win.
  const bin = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x48, 0x49]);
  const { bytes } = resolveObjectBody({
    body: {
      content: bin.toString('utf8'),          // lossy: U+FFFD for every invalid sequence
      contentBase64: bin.toString('base64'),  // exact
      encoding: 'base64',
      contentType: 'application/octet-stream'
    }
  });
  assert.deepEqual([...bytes], [...bin], 'the exact contentBase64 bytes are stored');
});

// ===========================================================================
// #994 scenario 2 — GET -> PUT is lossless (the original reproduction)
// ===========================================================================
test('bbx-stor-env-03: replaying a GET response as a PUT body round-trips byte-identically', async () => {
  const pool = makeMockPool();
  const original = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x48, 0x49]);
  await withFakeS3(async ({ store }) => {
    store.set(`/${BUCKET_A}/roundtrip.bin`, { body: original, contentType: 'application/octet-stream' });

    const read = await storageGetObject(ctxFor({ bucketId: BUCKET_A, objectKey: 'roundtrip.bin' }, { pool }));
    assert.equal(read.statusCode, 200);

    // The natural copy/backup/restore pattern: feed the response envelope straight back as a body.
    const copy = await storagePutObject(ctxFor({ bucketId: BUCKET_A, objectKey: 'roundtrip-copy.bin' }, { pool, body: read.body }));
    assert.equal(copy.statusCode, 201, `expected 201, got ${copy.statusCode}: ${JSON.stringify(copy.body)}`);
    assert.equal(copy.body.sizeBytes, original.length, `copy is ${copy.body.sizeBytes} bytes, original is ${original.length}`);

    const stored = store.get(`/${BUCKET_A}/roundtrip-copy.bin`).body;
    assert.equal(
      crypto.createHash('sha256').update(stored).digest('hex'),
      crypto.createHash('sha256').update(original).digest('hex'),
      'GET -> PUT is byte-identical (no silent truncation/corruption on 201)'
    );
  });
});

// ===========================================================================
// #994 scenario 3 — an unusable body is refused, never stored as an empty object
// ===========================================================================
test('bbx-stor-env-04: a body carrying no readable content field is 400, not 201 with sizeBytes 0', async () => {
  const pool = makeMockPool();
  for (const body of [
    { tenantId: 'ten_a', workspaceId: 'wrk_a', contentType: 'text/plain' },  // contract fields only, no payload
    { data: 'HELLO' },                                                        // wrong field name
    { body: 'HELLO' },
    {}
  ]) {
    await withFakeS3(async ({ puts }) => {
      const res = await storagePutObject(ctxFor({ bucketId: BUCKET_A, objectKey: 'unusable.bin' }, { pool, body }));
      assert.equal(res.statusCode, 400, `${JSON.stringify(body)} must be rejected, got ${res.statusCode} ${JSON.stringify(res.body)}`);
      assert.equal(res.body.code, 'STORAGE_INVALID_BODY');
      assert.equal(puts.length, 0, 'nothing is written to the backend for an unusable body');
    });
  }
});

test('bbx-stor-env-05: a malformed contentBase64 is 400, not a silently truncated object', async () => {
  const pool = makeMockPool();
  await withFakeS3(async ({ puts }) => {
    const res = await storagePutObject(ctxFor({ bucketId: BUCKET_A, objectKey: 'bad-b64.bin' }, {
      pool,
      body: { contentType: 'application/octet-stream', contentBase64: 'not valid base64!!' }
    }));
    assert.equal(res.statusCode, 400, `expected 400, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.code, 'STORAGE_INVALID_BODY');
    assert.equal(puts.length, 0);
  });
});

// A non-string contentBase64 must be refused on its TYPE, before any decode. String() coercion
// turns `true` into "true" and `["SEVMTE8="]` into its element — both valid base64 — so a coerced
// value would be stored as bytes the client never sent: the same class of defect as the 0-byte
// write, and reachable through the very field this fix made authoritative.
test('bbx-stor-env-05b: a non-string contentBase64 is 400, never coerced into phantom bytes', async () => {
  const pool = makeMockPool();
  for (const value of [true, false, 1234, 0, ['SEVMTE8='], { v: 'SEVMTE8=' }]) {
    await withFakeS3(async ({ puts }) => {
      const res = await storagePutObject(ctxFor({ bucketId: BUCKET_A, objectKey: 'typed.bin' }, {
        pool, body: { contentType: 'application/octet-stream', contentBase64: value }
      }));
      assert.equal(res.statusCode, 400, `contentBase64: ${JSON.stringify(value)} must be 400, got ${res.statusCode} ${JSON.stringify(res.body)}`);
      assert.equal(res.body.code, 'STORAGE_INVALID_BODY');
      assert.equal(puts.length, 0, 'nothing is written for a non-string contentBase64');
    });
  }
});

// The contract-mandated field must not be STRICTER than the schema-forbidden `content` one: every
// encoding below decodes to exactly one byte string, and each is what a mainstream encoder emits.
test('bbx-stor-env-05c: contentBase64 accepts every unambiguous base64 encoding of the same bytes', () => {
  const expected = [...Buffer.from('HELLO')];
  for (const [label, value] of [
    ['canonical padded', 'SEVMTE8='],
    ['unpadded (Go RawStdEncoding, JWT-style)', 'SEVMTE8'],
    ['newline-wrapped (openssl base64, Python encodebytes)', 'SEVM\nTE8='],
    ['surrounding whitespace', '  SEVMTE8=\n'],
    ['unpadded + wrapped', 'SEVM\nTE8']
  ]) {
    const { bytes, error } = resolveObjectBody({ body: { contentBase64: value } });
    assert.equal(error, undefined, `${label} must be accepted, got ${JSON.stringify(error?.body)}`);
    assert.deepEqual([...bytes], expected, `${label} decodes to the same bytes`);
  }
  // URL-safe alphabet decodes unambiguously too; a MIX of the two alphabets is valid in neither.
  const urlSafe = resolveObjectBody({ body: { contentBase64: '-_8=' } });
  assert.equal(urlSafe.error, undefined, 'URL-safe alphabet is accepted');
  assert.deepEqual([...urlSafe.bytes], [0xfb, 0xff]);
  for (const mixed of ['-+8=', 'a/b_c']) {
    assert.equal(resolveObjectBody({ body: { contentBase64: mixed } }).error?.statusCode, 400, `${mixed} mixes alphabets and is refused`);
  }
  // A length ≡ 1 (mod 4) cannot be a base64 sequence, and padding must complete its quantum.
  for (const impossible of ['SEVMT', 'SEVMTE8==', 'SEVM=', 'A=']) {
    assert.equal(resolveObjectBody({ body: { contentBase64: impossible } }).error?.statusCode, 400, `${impossible} is refused`);
  }
});

// server.mjs only sets rawBodyIsBinary when the body is NON-empty (`if (rawBody.length)`), so a
// zero-length upload reaches the resolver as body `{}` whatever its content type. That is an
// explicit "store nothing", not an unusable envelope, and it must not be swept up by the new 400.
test('bbx-stor-env-05d: a zero-length request body still writes an empty object (201), not 400', async () => {
  const pool = makeMockPool();
  await withFakeS3(async ({ store }) => {
    const res = await storagePutObject({
      ...ctxFor({ bucketId: BUCKET_A, objectKey: 'touch.bin' }, { pool }),
      rawBody: Buffer.alloc(0), contentType: 'application/octet-stream'
    });
    assert.equal(res.statusCode, 201, `expected 201, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.sizeBytes, 0);
    assert.equal(store.get(`/${BUCKET_A}/touch.bin`).body.length, 0);
  });
});

test('bbx-stor-env-06: an explicitly empty contentBase64 is an explicit empty object (201)', async () => {
  const pool = makeMockPool();
  await withFakeS3(async () => {
    const res = await storagePutObject(ctxFor({ bucketId: BUCKET_A, objectKey: 'empty.bin' }, {
      pool,
      body: { contentType: 'application/octet-stream', contentBase64: '' }
    }));
    assert.equal(res.statusCode, 201, 'an empty payload the client explicitly asked for is allowed');
    assert.equal(res.body.sizeBytes, 0);
  });
});

// ===========================================================================
// Backward compatibility — the legacy envelope the web console ships stays accepted
// ===========================================================================
test('bbx-stor-env-07: the legacy {content, encoding:"base64"} envelope still stores exact bytes', async () => {
  const pool = makeMockPool();
  const bin = crypto.randomBytes(64);
  await withFakeS3(async ({ store }) => {
    // ConsoleStoragePage uploads exactly this shape (readFileAsBase64 -> {content, encoding}).
    const res = await storagePutObject(ctxFor({ bucketId: BUCKET_A, objectKey: 'legacy.bin' }, {
      pool,
      body: { content: bin.toString('base64'), encoding: 'base64', contentType: 'application/octet-stream' }
    }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.sizeBytes, bin.length);
    assert.deepEqual([...store.get(`/${BUCKET_A}/legacy.bin`).body], [...bin]);
  });
});

test('bbx-stor-env-08: the legacy plain-text {content} envelope still stores UTF-8 bytes', async () => {
  const pool = makeMockPool();
  await withFakeS3(async ({ store }) => {
    const res = await storagePutObject(ctxFor({ bucketId: BUCKET_A, objectKey: 'legacy.txt' }, {
      pool, body: { content: 'HELLO', contentType: 'text/plain' }
    }));
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.sizeBytes, 5);
    assert.equal(store.get(`/${BUCKET_A}/legacy.txt`).body.toString('utf8'), 'HELLO');
  });
});

// ===========================================================================
// The multipart part upload is the second resolveObjectBody caller — same envelope, same guard.
// Pre-fix, a part sent as {contentBase64} uploaded an EMPTY part under a 200, so a completed
// multipart object could be 0 bytes with success statuses throughout.
// ===========================================================================
test('bbx-stor-env-12: a multipart part sent as contentBase64 uploads the decoded bytes', async () => {
  const pool = makeMockPool();
  const part = crypto.randomBytes(32);
  await withFakeS3(async ({ puts }) => {
    const res = await storageMultipartUploadPart(ctxFor(
      { bucketId: BUCKET_A, objectKey: 'mp.bin', uploadId: 'upload-1', partNumber: '1' },
      { pool, body: { contentType: 'application/octet-stream', contentBase64: part.toString('base64') } }
    ));
    assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.sizeBytes, part.length, 'the part is not empty');
    assert.deepEqual([...puts.at(-1).body], [...part], 'the backend received the decoded part bytes');
  });
});

test('bbx-stor-env-13: an unusable multipart part body is 400 before any backend call', async () => {
  const pool = makeMockPool();
  await withFakeS3(async ({ puts }) => {
    const res = await storageMultipartUploadPart(ctxFor(
      { bucketId: BUCKET_A, objectKey: 'mp.bin', uploadId: 'upload-1', partNumber: '1' },
      { pool, body: { contentType: 'application/octet-stream' } }
    ));
    assert.equal(res.statusCode, 400, `expected 400, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.code, 'STORAGE_INVALID_BODY');
    assert.equal(puts.length, 0);
  });
});

test('bbx-stor-env-14: a zero-length multipart part body is still accepted (unchanged)', async () => {
  const pool = makeMockPool();
  await withFakeS3(async ({ puts }) => {
    const res = await storageMultipartUploadPart({
      ...ctxFor({ bucketId: BUCKET_A, objectKey: 'mp.bin', uploadId: 'upload-1', partNumber: '1' }, { pool }),
      rawBody: Buffer.alloc(0), contentType: 'application/octet-stream'
    });
    assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.sizeBytes, 0);
    assert.equal(puts.length, 1);
  });
});

// ===========================================================================
// #966 — the read envelope never returns a silently lossy payload representation
// ===========================================================================
test('bbx-stor-env-09: a binary read returns no lossy `content` field, and contentBase64 is exact', async () => {
  const pool = makeMockPool();
  const bin = crypto.randomBytes(2048);   // the original reproduction's payload size
  const sha = crypto.createHash('sha256').update(bin).digest('hex');
  await withFakeS3(async ({ store }) => {
    store.set(`/${BUCKET_A}/random.bin`, { body: bin, contentType: 'application/octet-stream' });
    const res = await storageGetObject(ctxFor({ bucketId: BUCKET_A, objectKey: 'random.bin' }, { pool }));
    assert.equal(res.statusCode, 200);
    assert.equal(
      Object.prototype.hasOwnProperty.call(res.body, 'content'), false,
      'no `content` field: a representation that cannot reproduce the stored bytes is omitted, not degraded'
    );
    assert.equal(crypto.createHash('sha256').update(Buffer.from(res.body.contentBase64, 'base64')).digest('hex'), sha);
    assert.equal(res.body.sizeBytes, bin.length);
  });
});

test('bbx-stor-env-10: a text read also omits `content` (one payload field, always exact)', async () => {
  const pool = makeMockPool();
  await withFakeS3(async ({ store }) => {
    store.set(`/${BUCKET_A}/plain.txt`, { body: Buffer.from('HELLO', 'utf8'), contentType: 'text/plain' });
    const res = await storageGetObject(ctxFor({ bucketId: BUCKET_A, objectKey: 'plain.txt' }, { pool }));
    assert.equal(res.statusCode, 200);
    assert.equal(Object.prototype.hasOwnProperty.call(res.body, 'content'), false);
    assert.equal(Buffer.from(res.body.contentBase64, 'base64').toString('utf8'), 'HELLO');
  });
});

test('bbx-stor-env-11: a partial (206) read omits `content` too', async () => {
  const pool = makeMockPool();
  const original = globalThis.fetch;
  globalThis.fetch = async () => s3Response({
    status: 206,
    headers: { 'content-type': 'application/octet-stream', 'content-length': '4', 'content-range': 'bytes 0-3/20' },
    body: Buffer.from([0xff, 0xfe, 0x00, 0x01])
  });
  try {
    const res = await storageGetObject(ctxFor({ bucketId: BUCKET_A, objectKey: 'range20.bin' }, { pool, range: 'bytes=0-3' }));
    assert.equal(res.statusCode, 206);
    assert.equal(Object.prototype.hasOwnProperty.call(res.body, 'content'), false);
    assert.deepEqual([...Buffer.from(res.body.contentBase64, 'base64')], [0xff, 0xfe, 0x00, 0x01]);
  } finally {
    globalThis.fetch = original;
  }
});
