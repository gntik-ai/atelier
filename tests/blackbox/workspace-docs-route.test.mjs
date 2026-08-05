import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';

const registry = {};

function createDocsDb() {
  return {
    async query(sql, values) {
      if (/FROM workspace_docs_service\.workspace_doc_notes/.test(sql)) {
        return { rows: [] };
      }
      if (/INSERT INTO workspace_docs_service\.workspace_doc_access_log/.test(sql)) {
        assert.deepEqual(values, ['ws-docs-route', 'tenant-owner-1']);
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected workspace docs query: ${sql}`);
    }
  };
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

test('bbx-795-01: tenant owner GET /v1/workspaces/{workspaceId}/docs reaches runtime route and returns docs', async () => {
  const server = createControlPlaneServer({
    registry,
    workspaceDocsDb: createDocsDb(),
    logger: { error() {} }
  });
  const baseUrl = await listen(server);
  try {
    const res = await fetch(`${baseUrl}/v1/workspaces/ws-docs-route/docs`, {
      headers: {
        'X-API-Version': '2026-03-26',
        'X-Correlation-Id': 'corr-docs-route',
        'X-Tenant-Id': 'tenant-docs-route',
        'X-Auth-Subject': 'tenant-owner-1',
        'X-Actor-Roles': 'tenant_owner'
      }
    });

    assert.equal(res.status, 200, 'workspace docs must not return 404 NO_ROUTE or 403 for tenant_owner');
    const body = await res.json();
    assert.equal(body.workspaceId, 'ws-docs-route');
    assert.equal(body.tenantId, 'tenant-docs-route');
    assert.match(body.baseUrl, /^http:\/\/127\.0\.0\.1:/);
    assert.equal(body.authInstructions.method, 'bearer_oidc');
    assert.equal(body.stale, false);
    assert.ok(body.enabledServices.some((service) => service.serviceKey === 'postgres-database'));
    assert.deepEqual(body.customNotes, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('bbx-795-02: docs route rejects a trusted workspace header that does not match the path workspace', async () => {
  const server = createControlPlaneServer({
    registry,
    workspaceDocsDb: createDocsDb(),
    logger: { error() {} }
  });
  const baseUrl = await listen(server);
  try {
    const res = await fetch(`${baseUrl}/v1/workspaces/ws-path/docs`, {
      headers: {
        'X-API-Version': '2026-03-26',
        'X-Correlation-Id': 'corr-docs-mismatch',
        'X-Tenant-Id': 'tenant-docs-route',
        'X-Workspace-Id': 'ws-header',
        'X-Auth-Subject': 'tenant-owner-1',
        'X-Actor-Roles': 'tenant_owner'
      }
    });

    assert.equal(res.status, 403, 'workspace docs must not return docs for the header workspace when path and header differ');
    assert.equal((await res.json()).code, 'GW_FORBIDDEN');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
