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
  const requestDelete = fetchImpl ?? ((url, init) => new Promise((resolve, reject) => {
    const request = https.request(new URL(url), {
      method: init.method,
      headers: init.headers,
      ca: init.ca,
      rejectUnauthorized: true,
    }, (response) => {
      response.resume();
      response.on('end', () => resolve({ status: response.statusCode ?? 500 }));
    });
    request.on('error', reject);
    request.end(init.body);
  }));

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
      const response = await requestDelete(`${apiBase}${path}?labelSelector=${selector}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ apiVersion: 'v1', kind: 'DeleteOptions', propagationPolicy: 'Background' }),
        ca,
      });
      if (![200, 202, 404].includes(response.status)) {
        throw Object.assign(new Error(`Kubernetes hosted MCP cleanup failed with ${response.status}`), {
          code: 'MCP_RUNTIME_DELETE_FAILED',
          statusCode: response.status,
        });
      }
    }
    return { deleted: true, tenantId: namespace, serverId };
  }

  return { deleteOwnedRuntimeResources };
}
