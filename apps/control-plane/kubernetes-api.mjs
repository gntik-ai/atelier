import https from 'node:https';
import { readFile } from 'node:fs/promises';

const TOKEN_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/token';
const CA_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';
const NAMESPACE_PATH = '/var/run/secrets/kubernetes.io/serviceaccount/namespace';

function safeKubeError(code) {
  const error = new Error('Kubernetes lifecycle operation failed');
  error.code = code;
  return error;
}

async function inClusterIdentity(env = process.env) {
  const host = env.KUBERNETES_SERVICE_HOST;
  const port = env.KUBERNETES_SERVICE_PORT_HTTPS ?? env.KUBERNETES_SERVICE_PORT ?? '443';
  if (!host) throw safeKubeError('KUBE_CONFIG_UNAVAILABLE');
  const [token, ca, namespace] = await Promise.all([
    readFile(env.KUBERNETES_SERVICEACCOUNT_TOKEN_FILE ?? TOKEN_PATH, 'utf8'),
    readFile(env.KUBERNETES_SERVICEACCOUNT_CA_FILE ?? CA_PATH),
    readFile(env.KUBERNETES_NAMESPACE_FILE ?? NAMESPACE_PATH, 'utf8'),
  ]);
  return { host, port, token: token.trim(), ca, namespace: namespace.trim() };
}

function encode(value) {
  return encodeURIComponent(String(value));
}

export async function createKubernetesApi(env = process.env) {
  const identity = await inClusterIdentity(env);

  async function request(method, path, body, contentType = 'application/json') {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: identity.host,
        port: identity.port,
        path,
        method,
        ca: identity.ca,
        headers: {
          authorization: `Bearer ${identity.token}`,
          accept: 'application/json',
          ...(payload ? { 'content-type': contentType, 'content-length': payload.length } : {}),
        },
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          const status = Number(res.statusCode ?? 500);
          if (status === 404) return resolve({ status, body: null });
          if (status < 200 || status >= 300) return reject(safeKubeError(`KUBE_HTTP_${status}`));
          try {
            const raw = Buffer.concat(chunks).toString('utf8');
            return resolve({ status, body: raw ? JSON.parse(raw) : null });
          } catch {
            return reject(safeKubeError('KUBE_RESPONSE_INVALID'));
          }
        });
      });
      req.on('error', () => reject(safeKubeError('KUBE_REQUEST_FAILED')));
      if (payload) req.write(payload);
      req.end();
    });
  }

  const ns = encode(identity.namespace);
  return Object.freeze({
    namespace: identity.namespace,
    async getSecret(name) {
      const result = await request('GET', `/api/v1/namespaces/${ns}/secrets/${encode(name)}`);
      return result.status === 404 ? null : result.body;
    },
    async createSecret(secret) {
      return (await request('POST', `/api/v1/namespaces/${ns}/secrets`, secret)).body;
    },
    async deleteSecret(name) {
      return (await request('DELETE', `/api/v1/namespaces/${ns}/secrets/${encode(name)}`, {
        apiVersion: 'v1', kind: 'DeleteOptions', propagationPolicy: 'Background',
      })).body;
    },
    async getDeployment(name) {
      const result = await request('GET', `/apis/apps/v1/namespaces/${ns}/deployments/${encode(name)}`);
      return result.status === 404 ? null : result.body;
    },
    async scaleDeployment(name, replicas) {
      return (await request(
        'PATCH',
        `/apis/apps/v1/namespaces/${ns}/deployments/${encode(name)}/scale`,
        { spec: { replicas } },
        'application/merge-patch+json',
      )).body;
    },
  });
}

export async function waitForDeploymentDrain(api, name, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs ?? 120_000);
  const intervalMs = Number(opts.intervalMs ?? 2_000);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const deployment = await api.getDeployment(name);
    const replicas = Number(deployment?.status?.replicas ?? 0);
    const available = Number(deployment?.status?.availableReplicas ?? 0);
    if (deployment && replicas === 0 && available === 0) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw safeKubeError('KUBE_DRAIN_TIMEOUT');
}
