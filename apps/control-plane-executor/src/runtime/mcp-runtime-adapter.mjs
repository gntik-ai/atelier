import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Agent } from 'undici';

import { buildCustomServerDeployment, buildCustomServerNetworkPolicy } from '../mcp-custom-hosting.mjs';
import {
  createRuntimeNamespaceResolver,
  resolveMappedRuntimeNamespace,
  runtimeTenantOwnership,
  validateRuntimeNamespace,
  validateRuntimeServerId,
} from './mcp-runtime-namespace.mjs';

const DEFAULT_TOKEN_FILE = '/var/run/secrets/kubernetes.io/serviceaccount/token';
const DEFAULT_CA_FILE = '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt';

function responseStatus(response) {
  const status = Number(response?.status ?? response?.statusCode);
  return Number.isFinite(status) ? status : undefined;
}

function responseSucceeded(response) {
  const status = responseStatus(response);
  if (status !== undefined) return status >= 200 && status < 300;
  return response?.ok === true;
}

async function responseJson(response) {
  if (typeof response?.json === 'function') return response.json();
  if (typeof response?.body === 'string') return JSON.parse(response.body);
  return response?.body ?? response;
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

function delegatedAuthorization(value) {
  const authorization = String(value ?? '').trim();
  if (!/^(?:Bearer|ApiKey)\s+\S+$/i.test(authorization)) {
    throw Object.assign(new Error('Hosted MCP invocation requires a delegated caller credential'), {
      statusCode: 401,
      code: 'MCP_RUNTIME_DELEGATED_CREDENTIAL_REQUIRED',
    });
  }
  return authorization;
}

function runtimeContractEnv({ workspaceId, manifest, version, operation }) {
  return [
    { name: 'FALCONE_MCP_WORKSPACE_ID', value: String(workspaceId) },
    { name: 'FALCONE_MCP_VERSION', value: String(version) },
    { name: 'FALCONE_MCP_OPERATION', value: String(operation) },
    { name: 'FALCONE_MCP_MANIFEST_JSON', value: JSON.stringify(manifest) },
  ];
}

function defaultApiBase(env) {
  const host = env.KUBERNETES_SERVICE_HOST;
  const port = env.KUBERNETES_SERVICE_PORT_HTTPS ?? env.KUBERNETES_SERVICE_PORT ?? '443';
  return host ? `https://${host}:${port}` : undefined;
}

function loadServiceAccountCredentials({ env, readFile, token, ca }) {
  try {
    const resolvedToken = String(token ?? readFile(env.KUBERNETES_TOKEN_FILE ?? DEFAULT_TOKEN_FILE)).trim();
    const resolvedCa = ca ?? readFile(env.KUBERNETES_CA_FILE ?? DEFAULT_CA_FILE);
    if (resolvedToken && resolvedCa && resolvedCa.length !== 0) return { token: resolvedToken, ca: resolvedCa };
  } catch (cause) {
    throw Object.assign(new Error('Kubernetes serviceaccount credentials are unavailable'), {
      code: 'MCP_RUNTIME_KUBERNETES_CREDENTIALS_UNAVAILABLE', statusCode: 503, cause,
    });
  }
  throw Object.assign(new Error('Kubernetes serviceaccount credentials are unavailable'), {
    code: 'MCP_RUNTIME_KUBERNETES_CREDENTIALS_UNAVAILABLE', statusCode: 503,
  });
}

function namespaceAllowList(value, defaults = []) {
  return [...new Set([
    ...defaults,
    ...String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean),
  ].map(validateRuntimeNamespace))];
}

function ownershipMatches(metadata, { tenantId, tenantOwner, serverId, namespace, name }) {
  const labels = metadata?.labels ?? {};
  // `tenantOwner` preserves the historical raw label when it is label-safe and fingerprints only
  // identifiers that Kubernetes cannot represent. The raw comparison supports an old object read.
  const tenantMatches = labels['in-falcone.io/tenant'] === tenantOwner
    || labels['in-falcone.io/tenant'] === tenantId;
  return tenantMatches
    && labels['in-falcone.io/mcp-server'] === serverId
    && (!metadata?.namespace || metadata.namespace === namespace)
    && (!metadata?.name || metadata.name === name)
    && Boolean(metadata?.resourceVersion);
}

export function createMcpRuntimeAdapter({
  env = process.env,
  fetchImpl = globalThis.fetch,
  apiBase = defaultApiBase(env),
  token,
  ca,
  readFile = (path) => readFileSync(path),
  resolveRuntimeNamespace = createRuntimeNamespaceResolver({ env }),
  runtimeImage = env.MCP_RUNTIME_IMAGE,
  runtimeImageDigest = env.MCP_RUNTIME_IMAGE_DIGEST,
} = {}) {
  const image = runtimeImageDigest ? `${runtimeImage}@${runtimeImageDigest}` : runtimeImage;

  async function reconcile({ manifest, collectionPath, resourcePath, tenantId, tenantOwner, namespace, serverId, dispatcher, serviceAccountToken }) {
    const headers = { authorization: `Bearer ${serviceAccountToken}`, 'content-type': 'application/json' };
    let response = await fetchImpl(`${apiBase}${collectionPath}`, {
      method: 'POST', headers, dispatcher, body: JSON.stringify(manifest),
    });
    if (responseStatus(response) === 409) {
      const current = await fetchImpl(`${apiBase}${resourcePath}`, { method: 'GET', headers, dispatcher });
      if (!responseSucceeded(current)) {
        const status = responseStatus(current) ?? 502;
        throw Object.assign(new Error(`MCP runtime ownership read failed: ${status}`), { statusCode: status });
      }
      const existing = await responseJson(current);
      if (!ownershipMatches(existing?.metadata, {
        tenantId, tenantOwner, namespace, serverId, name: manifest.metadata.name,
      })) {
        throw Object.assign(new Error('MCP runtime ownership conflict'), { statusCode: 409 });
      }
      response = await fetchImpl(`${apiBase}${resourcePath}`, {
        method: 'PATCH',
        headers: { ...headers, 'content-type': 'application/merge-patch+json' },
        dispatcher,
        body: JSON.stringify({
          metadata: {
            resourceVersion: existing.metadata.resourceVersion,
            labels: manifest.metadata.labels,
            ...(manifest.metadata.annotations ? { annotations: manifest.metadata.annotations } : {}),
          },
          spec: manifest.spec,
        }),
      });
    }
    if (!responseSucceeded(response)) {
      const status = responseStatus(response) ?? 502;
      throw Object.assign(new Error(`MCP runtime apply failed: ${status}`), { statusCode: status });
    }
  }

  return {
    async apply({ tenantId, workspaceId, serverId, correlationId, manifest, version, operation }) {
      if (!apiBase || !image || typeof fetchImpl !== 'function') {
        throw Object.assign(new Error('MCP runtime adapter unavailable'), { statusCode: 503 });
      }
      if (!workspaceId || !version || !operation || !manifest || !Array.isArray(manifest.tools)) {
        throw Object.assign(new Error('MCP runtime deployment contract is incomplete'), {
          statusCode: 422,
          code: 'MCP_RUNTIME_CONTRACT_INVALID',
        });
      }
      const namespace = await resolveMappedRuntimeNamespace(resolveRuntimeNamespace, tenantId);
      const safeServerId = validateRuntimeServerId(serverId);
      const tenantOwner = runtimeTenantOwnership(tenantId);
      const built = buildCustomServerDeployment({
        tenantId,
        serverId: safeServerId,
        image,
        namespace,
        env: runtimeContractEnv({ workspaceId, manifest, version, operation }),
      });
      if (!built.manifest) throw new Error('Unable to build hosted MCP manifest');
      built.manifest.metadata.annotations = {
        'in-falcone.io/mcp-version': String(version),
        'in-falcone.io/mcp-operation': String(operation),
      };
      const platformNamespaces = namespaceAllowList(env.MCP_RUNTIME_PLATFORM_NAMESPACES, [namespace]);
      const networkPolicy = buildCustomServerNetworkPolicy({
        tenantId,
        serverId: safeServerId,
        namespace,
        ingressNamespaces: namespaceAllowList(env.MCP_RUNTIME_INGRESS_NAMESPACES, [
          ...platformNamespaces,
          env.KNATIVE_SERVING_NAMESPACE ?? 'knative-serving',
          env.KNATIVE_INGRESS_NAMESPACE ?? 'kourier-system',
        ]),
        egressNamespaces: namespaceAllowList(env.MCP_RUNTIME_EGRESS_NAMESPACES, platformNamespaces),
        dnsNamespaces: namespaceAllowList(env.MCP_RUNTIME_DNS_NAMESPACES, ['kube-system', 'openshift-dns']),
      });
      const credentials = loadServiceAccountCredentials({ env, readFile, token, ca });
      const dispatcher = new Agent({ connect: { ca: credentials.ca, rejectUnauthorized: true } });
      const namespacePath = `/namespaces/${encodeURIComponent(namespace)}`;
      try {
        // Reconcile isolation first. If the ksvc reconciliation later fails, the owned policy is a
        // safe, retryable leftover instead of a temporarily exposed workload.
        await reconcile({
          manifest: networkPolicy,
          collectionPath: `/apis/networking.k8s.io/v1${namespacePath}/networkpolicies`,
          resourcePath: `/apis/networking.k8s.io/v1${namespacePath}/networkpolicies/${encodeURIComponent(networkPolicy.metadata.name)}`,
          tenantId, tenantOwner, namespace, serverId: safeServerId, dispatcher,
          serviceAccountToken: credentials.token,
        });
        await reconcile({
          manifest: built.manifest,
          collectionPath: `/apis/serving.knative.dev/v1${namespacePath}/services`,
          resourcePath: `/apis/serving.knative.dev/v1${namespacePath}/services/${encodeURIComponent(built.manifest.metadata.name)}`,
          tenantId, tenantOwner, namespace, serverId: safeServerId, dispatcher,
          serviceAccountToken: credentials.token,
        });
      } finally {
        await dispatcher.close();
      }
      return { status: 'accepted', tenantId, workspaceId, serverId, version, operation, correlationId };
    },

    async invoke({ tenantId, workspaceId, serverId, version, tool, args, roles = [], scopes = [], correlationId, authorization }) {
      if (typeof fetchImpl !== 'function') {
        throw Object.assign(new Error('MCP runtime adapter unavailable'), { statusCode: 503 });
      }
      const namespace = await resolveMappedRuntimeNamespace(resolveRuntimeNamespace, tenantId);
      const safeServerId = validateRuntimeServerId(serverId);
      const requestId = correlationId ?? randomUUID();
      const callerAuthorization = delegatedAuthorization(authorization);
      const response = await fetchImpl(`http://mcp-${safeServerId}.${namespace}.svc.cluster.local/tools/call`, {
        method: 'POST',
        headers: {
          authorization: callerAuthorization,
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
      const payload = await responseJson(response);
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
