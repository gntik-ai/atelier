import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { handleMcpMessage } from '../control-plane-executor/src/mcp-official-server.mjs';
import { BASE_SCOPE } from '../control-plane-executor/src/mcp-official-catalog.mjs';

const PORT = Number(process.env.PORT || 8080);
const FALCONE_API_BASE_URL = process.env.FALCONE_API_BASE_URL || 'http://falcone-control-plane:8080';
const RUNTIME_VERSION = process.env.FALCONE_VERSION || '0.3.0';
const HOSTED_VERSION = process.env.FALCONE_MCP_VERSION || null;
const RECONCILE_OPERATION = process.env.FALCONE_MCP_OPERATION || null;

function hostedManifestFromEnv(value = process.env.FALCONE_MCP_MANIFEST_JSON) {
  if (!value) return null;
  try {
    const manifest = JSON.parse(value);
    return manifest?.status === 'published' && Array.isArray(manifest.tools) ? manifest : null;
  } catch {
    return null;
  }
}

const HOSTED_MANIFEST = hostedManifestFromEnv();

export function headerList(value) {
  if (!value) return [];
  const raw = Array.isArray(value) ? value.join(',') : String(value);
  return raw.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
}

export function contextFromHeaders(headers = {}) {
  const scopes = new Set([...headerList(headers['x-auth-scopes']), ...headerList(headers['x-falcone-scopes'])]);
  return {
    tenantId: headers['x-tenant-id'] || headers['x-falcone-tenant-id'] || null,
    workspaceId: headers['x-workspace-id'] || headers['x-falcone-workspace-id'] || null,
    roles: [...headerList(headers['x-actor-roles']), ...headerList(headers['x-falcone-roles'])],
    grantedScopes: [...scopes],
  };
}

function rpc(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function stripOwnershipArguments(args = {}) {
  const {
    tenantId: _tenantId,
    tenant_id: _tenantIdSnake,
    workspaceId: _workspaceId,
    workspace_id: _workspaceIdSnake,
    ...safeArgs
  } = args ?? {};
  return safeArgs;
}

function resolveHostedCall(tool, context, args = {}) {
  const safeArgs = stripOwnershipArguments(args);
  const workspace = encodeURIComponent(context.workspaceId ?? '');
  let path = String(tool.path ?? '').replace('{workspaceId}', workspace);
  const method = tool.method ?? 'GET';
  const source = tool.source ?? {};

  switch (source.type) {
    case 'postgres':
      return { method, path, body: method === 'GET' ? undefined : { row: safeArgs.row ?? safeArgs.values ?? safeArgs } };
    case 'function':
      return { method, path, body: { parameters: safeArgs.parameters ?? safeArgs.payload ?? safeArgs } };
    case 'storage':
      if (!safeArgs.key) return { error: 'object key is required' };
      path = path.replace('{objectKey}', encodeURIComponent(safeArgs.key));
      return { method, path, body: method === 'PUT' ? { content: safeArgs.content ?? '' } : undefined };
    case 'events':
      if (!safeArgs.topic) return { error: 'topic is required' };
      path = path.replace('{topic}', encodeURIComponent(safeArgs.topic));
      return { method, path, body: method === 'GET' ? undefined : (safeArgs.payload ?? {}) };
    case 'flow':
      return { method, path, body: { input: safeArgs } };
    default: {
      path = path.replace('{tenantId}', encodeURIComponent(context.tenantId ?? ''))
        .replace('{id}', workspace);
      const missing = [];
      path = path.replace(/\{(\w+)\}/g, (_match, name) => {
        const value = safeArgs[name];
        if (value === undefined || value === null || value === '') {
          missing.push(name);
          return '';
        }
        delete safeArgs[name];
        return encodeURIComponent(String(value));
      });
      if (missing.length > 0) return { error: `missing required argument: ${missing.join(', ')}` };
      return { method, path, body: method === 'GET' || method === 'DELETE' ? undefined : safeArgs };
    }
  }
}

export async function handleHostedMcpMessage(message, context, manifest = HOSTED_MANIFEST, version = HOSTED_VERSION) {
  const { id, method, params } = message ?? {};
  if (!manifest) return handleMcpMessage(message, context);
  if (method === 'initialize') {
    return rpc(id, {
      protocolVersion: '2025-11-25',
      serverInfo: { name: 'falcone-hosted-mcp', version: version ?? '0.0.0' },
      capabilities: { tools: {} },
    });
  }
  if (method === 'tools/list') {
    return rpc(id, {
      tools: manifest.tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? '',
        inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
      })),
    });
  }
  if (method === 'ping') return rpc(id, {});
  if (method !== 'tools/call') return rpcError(id, -32601, `method not found: ${method ?? ''}`);

  const tool = manifest.tools.find((candidate) => candidate.name === params?.name);
  if (!tool) return rpcError(id, -32602, `unknown tool: ${params?.name}`);
  const grantedScopes = new Set(context.grantedScopes ?? []);
  if (!grantedScopes.has(BASE_SCOPE)) return rpcError(id, -32001, `missing required scope: ${BASE_SCOPE}`);
  const requiredScope = tool.scope ?? tool.suggestedScope ?? null;
  if (tool.mutates && (!requiredScope || !grantedScopes.has(requiredScope))) {
    return rpcError(id, -32002, requiredScope
      ? `mutating tool "${tool.name}" requires scope: ${requiredScope}`
      : `mutating tool "${tool.name}" has no required scope`);
  }
  if (!context.tenantId || !context.workspaceId) return rpcError(id, -32004, 'trusted tenant/workspace context is required');
  if (typeof context.callFalcone !== 'function') return rpcError(id, -32003, 'control-plane client not available');

  const call = resolveHostedCall(tool, context, params?.arguments ?? {});
  if (call.error) return rpcError(id, -32602, call.error);
  try {
    const result = await context.callFalcone(call.method, call.path, call.body);
    return rpc(id, { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }], isError: false });
  } catch (error) {
    return rpcError(id, error.rpcCode ?? -32003, error.message ?? 'control-plane call failed');
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(Object.assign(new Error('request body too large'), { statusCode: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error('invalid JSON body'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function writeJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function callFalconeFrom(req, method, path, body) {
  const headers = {
    accept: 'application/json',
    'content-type': 'application/json',
  };
  for (const name of ['authorization', 'x-correlation-id', 'x-tenant-id', 'x-workspace-id', 'x-auth-scopes', 'x-actor-roles']) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await fetch(new URL(path, FALCONE_API_BASE_URL), init);
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!response.ok) {
    const status = Number(response.status) || 502;
    throw Object.assign(new Error(`control-plane call failed with HTTP ${status}`), {
      statusCode: status,
      code: 'MCP_CONTROL_PLANE_CALL_FAILED',
      rpcCode: status === 401 || status === 403 ? -32001 : -32003,
    });
  }
  return parsed;
}

export const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/healthz' || req.url === '/readyz')) {
    return writeJson(res, 200, {
      status: 'ready',
      runtime: 'mcp',
      version: RUNTIME_VERSION,
      ...(HOSTED_VERSION ? { serverVersion: HOSTED_VERSION } : {}),
      ...(RECONCILE_OPERATION ? { reconcileOperation: RECONCILE_OPERATION } : {}),
    });
  }
  if (req.method !== 'POST') {
    return writeJson(res, 405, { error: 'method_not_allowed' });
  }
  try {
    const message = await readJson(req);
    const context = {
      ...contextFromHeaders(req.headers),
      callFalcone: (method, path, body) => callFalconeFrom(req, method, path, body),
    };
    const result = await handleHostedMcpMessage(message, context);
    writeJson(res, 200, result);
  } catch (error) {
    writeJson(res, error.statusCode || 500, { error: error.message || 'mcp runtime error' });
  }
});

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) server.listen(PORT, () => console.log(`mcp-runtime listening on :${PORT}`));
