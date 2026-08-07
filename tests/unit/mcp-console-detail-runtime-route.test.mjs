import test from 'node:test';
import assert from 'node:assert/strict';

import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';

const identityHeaders = {
  'x-tenant-id': 'ten-a',
  'x-auth-subject': 'usr-a',
  'x-actor-roles': 'tenant_owner',
  'content-type': 'application/json',
};

function fakeMcpEngine() {
  const calls = [];
  return {
    calls,
    async assertOwnedServer(params) {
      calls.push({ operation: 'assert_owned_server', ...params });
    },
    async executeMcp(params) {
      calls.push(params);
      if (params.operation === 'get_server') {
        return {
          serverId: params.serverId,
          name: 'Acme Orders',
          endpoint: `https://gw.example.test/v1/mcp/workspaces/${params.workspaceId}/servers/${params.serverId}`,
          activeVersion: 'v1',
          status: 'published',
          tools: [{ name: 'list_orders', description: 'list', mutates: false }],
        };
      }
      if (params.operation === 'call_tool') {
        return { result: { content: [{ type: 'text', text: 'ok' }] }, toolName: params.body.name };
      }
      throw Object.assign(new Error(`unexpected operation ${params.operation}`), { statusCode: 500 });
    },
  };
}

async function withServer(run) {
  const mcpEngine = fakeMcpEngine();
  const server = createControlPlaneServer({ registry: {}, mcpEngine, logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await run(baseUrl, mcpEngine);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('MCP console detail route returns server detail on the workspace-scoped path', async () => {
  await withServer(async (baseUrl, mcpEngine) => {
    const response = await fetch(`${baseUrl}/v1/mcp/workspaces/ws-a/servers/srv-a`, {
      headers: identityHeaders,
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.serverId, 'srv-a');
    assert.equal(body.activeVersion, 'v1');
    assert.equal(body.endpoint, 'https://gw.example.test/v1/mcp/workspaces/ws-a/servers/srv-a');
    assert.deepEqual(body.tools, [{ name: 'list_orders', description: 'list', mutates: false }]);
    assert.deepEqual(mcpEngine.calls.at(-1), {
      operation: 'get_server',
      identity: {
        tenantId: 'ten-a',
        workspaceId: 'ws-a',
        actorId: 'usr-a',
        roleName: 'falcone_app',
        roles: ['tenant_owner'],
      },
      workspaceId: 'ws-a',
      serverId: 'srv-a',
      runtimeDependency: {
        mode: 'external',
        state: 'ready',
        reason: 'READY',
        ready: true,
      },
    });
  });
});

test('MCP playground route invokes tools on the workspace-scoped tool-calls path', async () => {
  await withServer(async (baseUrl, mcpEngine) => {
    const response = await fetch(`${baseUrl}/v1/mcp/workspaces/ws-a/servers/srv-a/tool-calls`, {
      method: 'POST',
      headers: identityHeaders,
      body: JSON.stringify({ name: 'list_orders', arguments: { limit: 5 } }),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.toolName, 'list_orders');
    assert.equal(body.result.content[0].text, 'ok');
    assert.equal(mcpEngine.calls.at(-1).operation, 'call_tool');
    assert.equal(mcpEngine.calls.at(-1).workspaceId, 'ws-a');
    assert.equal(mcpEngine.calls.at(-1).serverId, 'srv-a');
    assert.deepEqual(mcpEngine.calls.at(-1).body, { name: 'list_orders', arguments: { limit: 5 } });
  });
});

test('old unscoped MCP detail and playground routes remain unrouted', async () => {
  await withServer(async (baseUrl) => {
    const detail = await fetch(`${baseUrl}/v1/mcp/servers/srv-a`, { headers: identityHeaders });
    const playground = await fetch(`${baseUrl}/v1/mcp/servers/srv-a/playground/tool-calls`, {
      method: 'POST',
      headers: identityHeaders,
      body: JSON.stringify({ name: 'list_orders', arguments: {} }),
    });

    assert.equal(detail.status, 404);
    assert.equal((await detail.json()).code, 'NO_ROUTE');
    assert.equal(playground.status, 404);
    assert.equal((await playground.json()).code, 'NO_ROUTE');
  });
});
