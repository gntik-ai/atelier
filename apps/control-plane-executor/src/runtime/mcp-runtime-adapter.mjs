import { buildCustomServerDeployment } from '../mcp-custom-hosting.mjs';

export function createMcpRuntimeAdapter({ fetchImpl = globalThis.fetch, apiBase = process.env.KUBERNETES_API_BASE, token = process.env.KUBERNETES_TOKEN, runtimeImage = process.env.MCP_RUNTIME_IMAGE, runtimeImageDigest = process.env.MCP_RUNTIME_IMAGE_DIGEST } = {}) {
  const image = runtimeImageDigest ? `${runtimeImage}@${runtimeImageDigest}` : runtimeImage;
  const headers = { authorization: token ? `Bearer ${token}` : undefined, 'content-type': 'application/json' };
  return {
    async apply({ tenantId, workspaceId, serverId, correlationId }) {
      if (!apiBase || !image) throw Object.assign(new Error('MCP runtime adapter unavailable'), { statusCode: 503 });
      const built = buildCustomServerDeployment({ tenantId, serverId, image, namespace: tenantId });
      if (!built.manifest) throw new Error('Unable to build hosted MCP manifest');
      const url = `${apiBase}/apis/serving.knative.dev/v1/namespaces/${encodeURIComponent(tenantId)}/services/mcp-${encodeURIComponent(serverId)}`;
      const response = await fetchImpl(url, { method: 'PUT', headers, body: JSON.stringify(built.manifest) });
      if (!response.ok) throw Object.assign(new Error(`MCP runtime apply failed: ${response.status}`), { statusCode: response.status });
      return { status: 'accepted', tenantId, workspaceId, serverId, correlationId };
    },
    async invoke({ tenantId, serverId, tool, args }) {
      const response = await fetchImpl(`http://mcp-${serverId}.${tenantId}.svc.cluster.local/tools/call`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: tool, arguments: args }) });
      return response.json();
    },
  };
}
