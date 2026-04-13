import test from 'node:test';
import assert from 'node:assert/strict';

process.env.EFFECTIVE_CAPABILITIES_BASE_URL = 'http://capabilities:8080';

const { fetchEnabledCapabilities } = await import('../src/capability-manifest-client.mjs');

test('fetchEnabledCapabilities encodes workspace ids in the request path', async () => {
  let requestedUrl = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return {
      ok: true,
      json: async () => ({ capabilities: ['webhooks'] }),
    };
  };

  try {
    const result = await fetchEnabledCapabilities('workspace/alpha', 'token');
    assert.equal(requestedUrl, 'http://capabilities:8080/v1/workspaces/workspace%2Falpha/effective-capabilities');
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
