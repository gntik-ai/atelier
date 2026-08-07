import { buildCustomServerDeployment } from '../mcp-custom-hosting.mjs';
import { readFileSync } from 'node:fs';

export function createMcpRuntimeAdapter({ fetchImpl = globalThis.fetch, apiBase = process.env.KUBERNETES_API_BASE ?? (process.env.KUBERNETES_SERVICE_HOST ? `https://${process.env.KUBERNETES_SERVICE_HOST}:${process.env.KUBERNETES_SERVICE_PORT_HTTPS ?? 443}` : undefined), token = process.env.KUBERNETES_TOKEN ?? (() => { try { return readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8').trim(); } catch { return undefined; } })(), runtimeImage = process.env.MCP_RUNTIME_IMAGE, runtimeImageDigest = process.env.MCP_RUNTIME_IMAGE_DIGEST } = {}) {
  const image = runtimeImageDigest ? `${runtimeImage}@${runtimeImageDigest}` : runtimeImage;
  const headers = { authorization: token ? `Bearer ${token}` : undefined, 'content-type': 'application/json' };
  return {
    async apply({ tenantId, workspaceId, serverId, correlationId }) {
      if (!apiBase || !image) throw Object.assign(new Error('MCP runtime adapter unavailable'), { statusCode: 503 });
      const built = buildCustomServerDeployment({ tenantId, serverId, image, namespace: tenantId });
      if (!built.manifest) throw new Error('Unable to build hosted MCP manifest');
      const url = `${apiBase}/apis/serving.knative.dev/v1/namespaces/${encodeURIComponent(tenantId)}/services/mcp-${encodeURIComponent(serverId)}`;
      let response = await fetchImpl(`${apiBase}/apis/serving.knative.dev/v1/namespaces/${encodeURIComponent(tenantId)}/services`, { method: 'POST', headers, body: JSON.stringify(built.manifest) });
      if (response.status === 409) {
        const current = await fetchImpl(url, { method: 'GET', headers });
        const existing = await current.json();
        const labels = existing.metadata?.labels ?? {};
        if (labels['in-falcone.io/tenant'] !== tenantId || labels['in-falcone.io/mcp-server'] !== serverId || !existing.metadata?.resourceVersion) throw Object.assign(new Error('MCP runtime ownership conflict'), { statusCode: 409 });
        response = await fetchImpl(url, { method: 'PATCH', headers: { ...headers, 'content-type': 'application/merge-patch+json' }, body: JSON.stringify({ metadata: { resourceVersion: existing.metadata.resourceVersion }, spec: built.manifest.spec }) });
      }
      if (!response.ok) throw Object.assign(new Error(`MCP runtime apply failed: ${response.status}`), { statusCode: response.status });
      return { status: 'accepted', tenantId, workspaceId, serverId, correlationId };
    },
    async invoke({ tenantId, serverId, tool, args }) {
      const response = await fetchImpl(`http://mcp-${serverId}.${tenantId}.svc.cluster.local/tools/call`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: tool, arguments: args }) });
      if (!response.ok) return { content: [{ type: 'text', text: 'hosted MCP runtime unavailable' }], isError: true };
      return response.json();
    },
  };
}
