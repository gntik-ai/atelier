import test from 'node:test';
import assert from 'node:assert/strict';

process.env.EFFECTIVE_CAPABILITIES_BASE_URL = 'http://capabilities:8080';

const { fetchEnabledCapabilities } = await import('../src/capability-manifest-client.mjs');

test('fetchEnabledCapabilities encodes workspace ids in the request path', async () => {
  let requestedUrl = null;
  let requestedHeaders = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    requestedUrl = String(url);
    requestedHeaders = new Headers(init?.headers);
    return {
      ok: true,
      json: async () => ({ capabilities: ['webhooks'] }),
    };
  };

  try {
    const result = await fetchEnabledCapabilities('workspace/alpha', 'token');
    assert.equal(requestedUrl, 'http://capabilities:8080/v1/workspaces/workspace%2Falpha/effective-capabilities');
    assert.equal(requestedHeaders.get('authorization'), 'Bearer token');
    assert.equal(requestedHeaders.get('x-api-version'), '2026-03-26');
    assert.match(requestedHeaders.get('x-correlation-id'), /^[A-Za-z0-9._:-]{8,128}$/);
    assert.deepEqual([...result], ['webhooks']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchEnabledCapabilities rejects empty workspace ids', async () => {
  await assert.rejects(
    () => fetchEnabledCapabilities('', 'token'),
    /workspaceId must be a non-empty string/
  );
});
