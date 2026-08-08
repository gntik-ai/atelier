import { readFileSync } from 'node:fs';
import { Agent } from 'undici';

import {
  createRuntimeNamespaceResolver,
  resolveMappedRuntimeNamespace,
  runtimeTenantOwnership,
  validateRuntimeServerId,
} from './mcp-runtime-namespace.mjs';

const DEFAULT_TOKEN_FILE = '/var/run/secrets/kubernetes.io/serviceaccount/token';
const DEFAULT_CA_FILE = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';

function defaultApiBase(env) {
  const host = env.KUBERNETES_SERVICE_HOST;
  const port = env.KUBERNETES_SERVICE_PORT_HTTPS ?? env.KUBERNETES_SERVICE_PORT ?? '443';
  if (!host) return null;
  return `https://${host}:${port}`;
}

// Every list and delete is narrowed by the mapped namespace plus stable ownership labels.
// Revisions and Routes are included as an orphan-safety sweep; normally Kubernetes garbage
// collection removes them with the ksvc.
export function createMcpRuntimeCleaner({
  env = process.env,
  fetchImpl = globalThis.fetch,
  readFile = (path) => readFileSync(path),
  apiBase = defaultApiBase(env),
  resolveRuntimeNamespace = createRuntimeNamespaceResolver({ env }),
} = {}) {
  function statusOf(response) {
    const status = Number(response?.status ?? response?.statusCode);
    return Number.isFinite(status) ? status : 500;
  }

  function kubernetesError(operation, status, code = 'MCP_RUNTIME_KUBERNETES_FAILED') {
    return Object.assign(new Error(`Kubernetes hosted MCP ${operation} failed with ${status}`), {
      code,
      statusCode: status,
    });
  }

  async function parseListResponse(response) {
    const status = statusOf(response);
    if (status === 404) return { status, items: [] };
    if (status < 200 || status >= 300) throw kubernetesError('list', status, 'MCP_RUNTIME_LIST_FAILED');

    let payload;
    try {
      if (typeof response?.json === 'function') payload = await response.json();
      else if (typeof response?.body === 'string') payload = response.body ? JSON.parse(response.body) : null;
      else payload = response?.body ?? response;
    } catch (error) {
      throw Object.assign(new Error('Kubernetes hosted MCP list returned invalid JSON'), {
        code: 'MCP_RUNTIME_LIST_INVALID',
        statusCode: 502,
        cause: error,
      });
    }
    if (!payload || !Array.isArray(payload.items)) {
      throw Object.assign(new Error('Kubernetes hosted MCP list omitted items'), {
        code: 'MCP_RUNTIME_LIST_INVALID',
        statusCode: 502,
      });
    }
    return { status, items: payload.items };
  }

  async function deleteOwnedRuntimeResources({ tenantId, resourceId }) {
    if (!apiBase || typeof fetchImpl !== 'function') {
      throw new Error('Kubernetes API is unavailable for hosted MCP cleanup');
    }
    const namespace = await resolveMappedRuntimeNamespace(resolveRuntimeNamespace, tenantId);
    const serverId = validateRuntimeServerId(resourceId);
    const tenantOwner = runtimeTenantOwnership(tenantId);
    const selector = encodeURIComponent(`in-falcone.io/tenant=${tenantOwner},in-falcone.io/mcp-server=${serverId}`);
    let token;
    let ca;
    try {
      token = String(readFile(env.KUBERNETES_TOKEN_FILE ?? DEFAULT_TOKEN_FILE)).trim();
      ca = readFile(env.KUBERNETES_CA_FILE ?? DEFAULT_CA_FILE);
    } catch (cause) {
      throw Object.assign(new Error('Kubernetes serviceaccount credentials are unavailable'), {
        code: 'MCP_RUNTIME_KUBERNETES_CREDENTIALS_UNAVAILABLE', statusCode: 503, cause,
      });
    }
    if (!token || !ca || ca.length === 0) {
      throw Object.assign(new Error('Kubernetes serviceaccount credentials are unavailable'), {
        code: 'MCP_RUNTIME_KUBERNETES_CREDENTIALS_UNAVAILABLE', statusCode: 503,
      });
    }
    const dispatcher = new Agent({ connect: { ca, rejectUnauthorized: true } });
    const namespacePath = `/namespaces/${encodeURIComponent(namespace)}`;
    const resources = [
      `/apis/serving.knative.dev/v1${namespacePath}/services`,
      `/apis/serving.knative.dev/v1${namespacePath}/revisions`,
      `/apis/serving.knative.dev/v1${namespacePath}/routes`,
      `/apis/rbac.authorization.k8s.io/v1${namespacePath}/roles`,
      `/apis/rbac.authorization.k8s.io/v1${namespacePath}/rolebindings`,
      `/apis/networking.k8s.io/v1${namespacePath}/networkpolicies`,
    ];
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const isOwned = (item) => {
      const labels = item.metadata?.labels ?? {};
      const matchingTenant = labels['in-falcone.io/tenant'] === tenantOwner
        || labels['in-falcone.io/tenant'] === tenantId;
      return matchingTenant && labels['in-falcone.io/mcp-server'] === serverId;
    };
    try {
      for (const path of resources) {
        const listUrl = `${apiBase}${path}?labelSelector=${selector}`;
        const listed = await parseListResponse(await fetchImpl(listUrl, {
          method: 'GET', headers, dispatcher,
        }));
        const ownedItems = listed.items.filter(isOwned);
        if (ownedItems.length === 0) continue;
        for (const item of ownedItems) {
          if (!item.metadata?.name || !item.metadata?.uid || !item.metadata?.resourceVersion) {
            throw Object.assign(new Error('Kubernetes hosted MCP resource lacks deletion preconditions'), {
              code: 'MCP_RUNTIME_DELETE_PRECONDITION_MISSING',
              statusCode: 409,
            });
          }
          if (item.metadata.namespace && item.metadata.namespace !== namespace) {
            throw Object.assign(new Error('Kubernetes hosted MCP resource escaped its mapped namespace'), {
              code: 'MCP_RUNTIME_OWNERSHIP_CONFLICT', statusCode: 409,
            });
          }
          const name = encodeURIComponent(item.metadata.name);
          const response = await fetchImpl(`${apiBase}${path}/${name}`, {
            method: 'DELETE', headers, dispatcher,
            body: JSON.stringify({
              apiVersion: 'v1',
              kind: 'DeleteOptions',
              propagationPolicy: 'Background',
              preconditions: { uid: item.metadata.uid, resourceVersion: item.metadata.resourceVersion },
            }),
          });
          const status = statusOf(response);
          if (status === 409) {
            throw Object.assign(new Error('MCP runtime replacement conflict; retained for retry'), {
              code: 'MCP_RUNTIME_DELETE_CONFLICT', statusCode: 409,
            });
          }
          if (status !== 404 && (status < 200 || status >= 300)) {
            throw kubernetesError('delete', status, 'MCP_RUNTIME_DELETE_FAILED');
          }
        }

        const verified = await parseListResponse(await fetchImpl(listUrl, {
          method: 'GET', headers, dispatcher,
        }));
        if (verified.items.some(isOwned)) {
          throw Object.assign(new Error('Kubernetes hosted MCP resource deletion is not yet verified'), {
            code: 'MCP_RUNTIME_DELETE_UNVERIFIED',
            statusCode: 409,
          });
        }
      }
      return { deleted: true, tenantId, namespace, serverId };
    } finally {
      await dispatcher.close();
    }
  }

  return { deleteOwnedRuntimeResources };
}
