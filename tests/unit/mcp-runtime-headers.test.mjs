import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { BASE_SCOPE } from '../../apps/control-plane-executor/src/mcp-official-catalog.mjs';

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address()));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function postJson(url, body, headers = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json(),
  };
}

test('mcp runtime parses trusted scope headers without synthesizing base scope', async () => {
  const mod = await import(`../../apps/mcp-runtime/server.mjs?headers=${Date.now()}`);
  assert.deepEqual(mod.headerList('mcp:invoke,mcp:falcone:workspaces:write  custom:read'), [
    'mcp:invoke',
    'mcp:falcone:workspaces:write',
    'custom:read',
  ]);

  const ctx = mod.contextFromHeaders({
    'x-auth-scopes': 'tenant:read, workspace:read',
    'x-falcone-scopes': 'mcp:falcone:workspaces:write extra:scope',
    'x-actor-roles': 'tenant_owner platform_admin',
  });

  assert.deepEqual(ctx.grantedScopes.sort(), [
    'extra:scope',
    'mcp:falcone:workspaces:write',
    'tenant:read',
    'workspace:read',
  ]);
  assert.equal(ctx.grantedScopes.includes(BASE_SCOPE), false);
  assert.deepEqual(ctx.roles, ['tenant_owner', 'platform_admin']);
});

test('mcp runtime refuses tool calls when trusted headers omit the base scope', async () => {
  const upstream = http.createServer((_req, res) => {
    assert.fail('runtime must not call upstream without the base scope');
    res.end();
  });
  const upstreamAddr = await listen(upstream);
  process.env.FALCONE_API_BASE_URL = `http://${upstreamAddr.address}:${upstreamAddr.port}`;
  const mod = await import(`../../apps/mcp-runtime/server.mjs?missing-base=${Date.now()}`);
  const runtimeAddr = await listen(mod.server);

  try {
    const response = await postJson(`http://${runtimeAddr.address}:${runtimeAddr.port}/`, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'list_workspaces', arguments: {} },
    }, {
      'x-falcone-tenant-id': 'ten-a',
      'x-falcone-scopes': 'mcp:falcone:workspaces:write',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.error?.code, -32001);
    assert.match(response.body.error?.message, new RegExp(BASE_SCOPE));
  } finally {
    await close(mod.server);
    await close(upstream);
    delete process.env.FALCONE_API_BASE_URL;
  }
});

test('mcp runtime accepts whitespace scopes and preserves downstream Authorization forwarding', async () => {
  let captured;
  const upstream = http.createServer(async (req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      captured = {
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        apiVersion: req.headers['x-api-version'],
        correlationId: req.headers['x-correlation-id'],
        body: body ? JSON.parse(body) : undefined,
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  const upstreamAddr = await listen(upstream);
  process.env.FALCONE_API_BASE_URL = `http://${upstreamAddr.address}:${upstreamAddr.port}`;
  const mod = await import(`../../apps/mcp-runtime/server.mjs?forward=${Date.now()}`);
  const runtimeAddr = await listen(mod.server);

  try {
    const response = await postJson(`http://${runtimeAddr.address}:${runtimeAddr.port}/`, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'create_workspace', arguments: { slug: 'demo', environment: 'dev' } },
    }, {
      authorization: 'Bearer forwarded-token',
      'x-correlation-id': 'corr-mcp-runtime-forward-001',
      'x-falcone-tenant-id': 'ten-a',
      'x-falcone-scopes': `${BASE_SCOPE} mcp:falcone:workspaces:write`,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.error, undefined);
    assert.equal(captured.method, 'POST');
    assert.equal(captured.url, '/v1/tenants/ten-a/workspaces');
    assert.equal(captured.authorization, 'Bearer forwarded-token');
    assert.equal(captured.apiVersion, '2026-03-26');
    assert.equal(captured.correlationId, 'corr-mcp-runtime-forward-001');
    assert.deepEqual(captured.body, { slug: 'demo', environment: 'dev' });
  } finally {
    await close(mod.server);
    await close(upstream);
    delete process.env.FALCONE_API_BASE_URL;
  }
});
