import { readFileSync } from 'node:fs';
import https from 'node:https';

const DEFAULT_TOKEN_FILE = '/var/run/secrets/kubernetes.io/serviceaccount/token';
const DEFAULT_CA_FILE = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';
const DNS_LABEL = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/;

function safeSegment(value, label) {
  const text = String(value ?? '').toLowerCase();
  if (!DNS_LABEL.test(text)) throw new Error(`${label} is not a safe Kubernetes name`);
  return text;
}

function defaultApiBase(env) {
  const host = env.KUBERNETES_SERVICE_HOST;
  const port = env.KUBERNETES_SERVICE_PORT_HTTPS ?? env.KUBERNETES_SERVICE_PORT ?? '443';
  if (!host) return null;
  return `https://${host}:${port}`;
}

// DeleteCollection is always narrowed by namespace plus both Falcone ownership labels. This means
// a same-named server in an adjacent tenant cannot be touched. Revisions and Routes are included as
// an orphan-safety sweep; normally Kubernetes garbage collection removes them with the ksvc.
export function createMcpRuntimeCleaner({
  env = process.env,
  fetchImpl,
  readFile = (path) => readFileSync(path),
  apiBase = defaultApiBase(env),
} = {}) {
  const request = fetchImpl ?? ((url, init) => new Promise((resolve, reject) => {
    const request = https.request(new URL(url), {
      method: init.method,
      headers: init.headers,
      ca: init.ca,
      rejectUnauthorized: true,
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode ?? 500, body }));
    });
    request.on('error', reject);
    request.end(init.body);
  }));

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
    if (!apiBase) throw new Error('Kubernetes API is unavailable for hosted MCP cleanup');
    const namespace = safeSegment(tenantId, 'tenantId');
    const serverId = safeSegment(resourceId, 'serverId');
    const selector = encodeURIComponent(`in-falcone.io/tenant=${namespace},in-falcone.io/mcp-server=${serverId}`);
    const token = String(readFile(env.KUBERNETES_TOKEN_FILE ?? DEFAULT_TOKEN_FILE)).trim();
    const ca = readFile(env.KUBERNETES_CA_FILE ?? DEFAULT_CA_FILE);
    const resources = [
      `/apis/serving.knative.dev/v1/namespaces/${namespace}/services`,
      `/apis/serving.knative.dev/v1/namespaces/${namespace}/revisions`,
      `/apis/serving.knative.dev/v1/namespaces/${namespace}/routes`,
      `/apis/rbac.authorization.k8s.io/v1/namespaces/${namespace}/roles`,
      `/apis/rbac.authorization.k8s.io/v1/namespaces/${namespace}/rolebindings`,
      `/apis/networking.k8s.io/v1/namespaces/${namespace}/networkpolicies`,
    ];
    for (const path of resources) {
      const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
      const listUrl = `${apiBase}${path}?labelSelector=${selector}`;
      const listed = await parseListResponse(await request(listUrl, { method: 'GET', headers, ca }));
      const ownedItems = listed.items.filter((item) => {
        const labels = item.metadata?.labels ?? {};
        return labels['in-falcone.io/tenant'] === namespace && labels['in-falcone.io/mcp-server'] === serverId;
      });
      if (ownedItems.length === 0) continue;
      for (const item of ownedItems) {
        if (!item.metadata?.name || !item.metadata?.uid || !item.metadata?.resourceVersion) {
          throw Object.assign(new Error('Kubernetes hosted MCP resource lacks deletion preconditions'), {
            code: 'MCP_RUNTIME_DELETE_PRECONDITION_MISSING',
            statusCode: 409,
          });
        }
        const name = encodeURIComponent(item.metadata.name);
        const response = await request(`${apiBase}${path}/${name}`, {
          method: 'DELETE', headers, ca,
          body: JSON.stringify({ apiVersion: 'v1', kind: 'DeleteOptions', propagationPolicy: 'Background', preconditions: { uid: item.metadata.uid, resourceVersion: item.metadata.resourceVersion } }),
        });
        const status = statusOf(response);
        if (status === 409) throw Object.assign(new Error('MCP runtime replacement conflict; retained for retry'), { code: 'MCP_RUNTIME_DELETE_CONFLICT', statusCode: 409 });
        if (status !== 404 && (status < 200 || status >= 300)) throw kubernetesError('delete', status, 'MCP_RUNTIME_DELETE_FAILED');
      }

      // Kubernetes may acknowledge an asynchronous deletion or return 404 after a race. Re-list the
      // exact ownership selector and finalize only when absence is independently verified.
      const verified = await parseListResponse(await request(listUrl, { method: 'GET', headers, ca }));
      const remaining = verified.items.some((item) => {
        const labels = item.metadata?.labels ?? {};
        return labels['in-falcone.io/tenant'] === namespace && labels['in-falcone.io/mcp-server'] === serverId;
      });
      if (remaining) {
        throw Object.assign(new Error('Kubernetes hosted MCP resource deletion is not yet verified'), {
          code: 'MCP_RUNTIME_DELETE_UNVERIFIED',
          statusCode: 409,
        });
      }
    }
    return { deleted: true, tenantId: namespace, serverId };
  }

  return { deleteOwnedRuntimeResources };
}
