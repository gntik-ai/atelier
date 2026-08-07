import { buildCustomServerDeployment } from '../mcp-custom-hosting.mjs';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

function responseStatus(response) {
  const status = Number(response?.status ?? response?.statusCode);
  return Number.isFinite(status) ? status : undefined;
}

function responseSucceeded(response) {
  const status = responseStatus(response);
  if (status !== undefined) return status >= 200 && status < 300;
  return response?.ok === true;
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

function runtimeContractEnv({ workspaceId, manifest, version, operation }) {
  return [
    { name: 'FALCONE_MCP_WORKSPACE_ID', value: String(workspaceId) },
    { name: 'FALCONE_MCP_VERSION', value: String(version) },
    { name: 'FALCONE_MCP_OPERATION', value: String(operation) },
    { name: 'FALCONE_MCP_MANIFEST_JSON', value: JSON.stringify(manifest) },
  ];
}

export function createMcpRuntimeAdapter({ fetchImpl = globalThis.fetch, apiBase = process.env.KUBERNETES_API_BASE ?? (process.env.KUBERNETES_SERVICE_HOST ? `https://${process.env.KUBERNETES_SERVICE_HOST}:${process.env.KUBERNETES_SERVICE_PORT_HTTPS ?? 443}` : undefined), token = process.env.KUBERNETES_TOKEN ?? (() => { try { return readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8').trim(); } catch { return undefined; } })(), runtimeImage = process.env.MCP_RUNTIME_IMAGE, runtimeImageDigest = process.env.MCP_RUNTIME_IMAGE_DIGEST } = {}) {
  const image = runtimeImageDigest ? `${runtimeImage}@${runtimeImageDigest}` : runtimeImage;
  const headers = { authorization: token ? `Bearer ${token}` : undefined, 'content-type': 'application/json' };
  return {
    async apply({ tenantId, workspaceId, serverId, correlationId, manifest, version, operation }) {
      if (!apiBase || !image) throw Object.assign(new Error('MCP runtime adapter unavailable'), { statusCode: 503 });
      if (!workspaceId || !version || !operation || !manifest || !Array.isArray(manifest.tools)) {
        throw Object.assign(new Error('MCP runtime deployment contract is incomplete'), {
          statusCode: 422,
          code: 'MCP_RUNTIME_CONTRACT_INVALID',
        });
      }
      const built = buildCustomServerDeployment({
        tenantId,
        serverId,
        image,
        namespace: tenantId,
        env: runtimeContractEnv({ workspaceId, manifest, version, operation }),
      });
      if (!built.manifest) throw new Error('Unable to build hosted MCP manifest');
      built.manifest.metadata.annotations = {
        'in-falcone.io/mcp-version': String(version),
        'in-falcone.io/mcp-operation': String(operation),
      };
      const url = `${apiBase}/apis/serving.knative.dev/v1/namespaces/${encodeURIComponent(tenantId)}/services/mcp-${encodeURIComponent(serverId)}`;
      let response = await fetchImpl(`${apiBase}/apis/serving.knative.dev/v1/namespaces/${encodeURIComponent(tenantId)}/services`, { method: 'POST', headers, body: JSON.stringify(built.manifest) });
      if (responseStatus(response) === 409) {
        const current = await fetchImpl(url, { method: 'GET', headers });
        if (!responseSucceeded(current)) throw Object.assign(new Error(`MCP runtime ownership read failed: ${responseStatus(current) ?? 'unknown'}`), { statusCode: responseStatus(current) ?? 502 });
        const existing = await current.json();
        const labels = existing.metadata?.labels ?? {};
        if (labels['in-falcone.io/tenant'] !== tenantId || labels['in-falcone.io/mcp-server'] !== serverId || !existing.metadata?.resourceVersion) throw Object.assign(new Error('MCP runtime ownership conflict'), { statusCode: 409 });
        response = await fetchImpl(url, { method: 'PATCH', headers: { ...headers, 'content-type': 'application/merge-patch+json' }, body: JSON.stringify({ metadata: { resourceVersion: existing.metadata.resourceVersion, annotations: built.manifest.metadata.annotations }, spec: built.manifest.spec }) });
      }
      if (!responseSucceeded(response)) {
        const status = responseStatus(response) ?? 502;
        throw Object.assign(new Error(`MCP runtime apply failed: ${status}`), { statusCode: status });
      }
      return { status: 'accepted', tenantId, workspaceId, serverId, version, operation, correlationId };
    },
    async invoke({ tenantId, workspaceId, serverId, version, tool, args, roles = [], scopes = [], correlationId }) {
      const requestId = correlationId ?? randomUUID();
      const response = await fetchImpl(`http://mcp-${serverId}.${tenantId}.svc.cluster.local/tools/call`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-tenant-id': tenantId,
          'x-workspace-id': workspaceId,
          'x-actor-roles': Array.isArray(roles) ? roles.join(',') : '',
          'x-auth-scopes': Array.isArray(scopes) ? scopes.join(' ') : '',
          'x-correlation-id': requestId,
          ...(version ? { 'x-falcone-mcp-version': String(version) } : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: requestId,
          method: 'tools/call',
          params: { name: tool, arguments: stripOwnershipArguments(args) },
        }),
      });
      if (!responseSucceeded(response)) {
        const status = responseStatus(response) ?? 502;
        throw Object.assign(new Error(`Hosted MCP runtime invocation failed: ${status}`), {
          statusCode: status,
          code: 'MCP_RUNTIME_INVOKE_FAILED',
        });
      }
      const payload = await response.json();
      if (payload?.error) {
        throw Object.assign(new Error(payload.error.message ?? 'Hosted MCP runtime JSON-RPC error'), {
          statusCode: 502,
          code: 'MCP_RUNTIME_RPC_ERROR',
          rpcCode: payload.error.code,
          rpcData: payload.error.data,
        });
      }
      return payload?.jsonrpc === '2.0' ? payload.result : payload;
    },
  };
}
