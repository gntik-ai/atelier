import { createHash } from 'node:crypto';

const DNS_LABEL = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/;
const LABEL_VALUE = /^(?:[A-Za-z0-9](?:[-_.A-Za-z0-9]{0,61}[A-Za-z0-9])?)?$/;

function namespaceError(message, code = 'MCP_RUNTIME_NAMESPACE_INVALID') {
  return Object.assign(new Error(message), { code, statusCode: 503 });
}

export function validateRuntimeNamespace(value) {
  const namespace = String(value ?? '').trim();
  if (!DNS_LABEL.test(namespace)) {
    throw namespaceError('Resolved MCP runtime namespace is not a valid Kubernetes DNS label');
  }
  return namespace;
}

export function validateRuntimeServerId(value) {
  const serverId = String(value ?? '').trim();
  if (!DNS_LABEL.test(serverId) || `mcp-${serverId}-ingress`.length > 63) {
    throw Object.assign(new Error('serverId is not a safe Kubernetes name'), {
      code: 'MCP_RUNTIME_SERVER_ID_INVALID',
      statusCode: 422,
    });
  }
  return serverId;
}

// Preserve the existing ownership label contract when the application tenant identifier is a safe
// Kubernetes label value. Non-label-safe identifiers are represented by a stable fingerprint;
// neither form participates in DNS or namespace resolution.
export function runtimeTenantOwnership(tenantId) {
  const value = String(tenantId ?? '');
  if (!value) throw namespaceError('tenantId is required to resolve an MCP runtime namespace');
  if (value.length <= 63 && LABEL_VALUE.test(value)) return value;
  return `t-${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
}

function parseNamespaceMap(env) {
  const source = env.MCP_RUNTIME_NAMESPACE_MAP;
  if (!source) return Object.create(null);
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw namespaceError('MCP_RUNTIME_NAMESPACE_MAP must be a JSON object', 'MCP_RUNTIME_NAMESPACE_MAP_INVALID');
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw namespaceError('MCP_RUNTIME_NAMESPACE_MAP must be a JSON object', 'MCP_RUNTIME_NAMESPACE_MAP_INVALID');
  }
  return parsed;
}

/**
 * Build the default runtime namespace authority from configuration.
 *
 * There is deliberately no identity fallback: tenant identifiers are application identifiers,
 * not Kubernetes names. Production may instead inject a database-backed resolver with the same
 * `{ tenantId } -> namespace` contract.
 */
export function createRuntimeNamespaceResolver({ env = process.env } = {}) {
  let namespaceMap;
  return ({ tenantId } = {}) => {
    const key = String(tenantId ?? '');
    if (!key) throw namespaceError('tenantId is required to resolve an MCP runtime namespace');
    namespaceMap ??= parseNamespaceMap(env);
    if (!Object.hasOwn(namespaceMap, key)) {
      throw namespaceError('No authoritative MCP runtime namespace mapping exists', 'MCP_RUNTIME_NAMESPACE_UNMAPPED');
    }
    return validateRuntimeNamespace(namespaceMap[key]);
  };
}

export async function resolveMappedRuntimeNamespace(resolveRuntimeNamespace, tenantId) {
  if (typeof resolveRuntimeNamespace !== 'function') {
    throw namespaceError('MCP runtime namespace resolver is unavailable', 'MCP_RUNTIME_NAMESPACE_UNMAPPED');
  }
  return validateRuntimeNamespace(await resolveRuntimeNamespace({ tenantId }));
}
