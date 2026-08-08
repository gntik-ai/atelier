/**
 * Custom (bring-your-own) MCP server hosting — deployment-spec builder
 * (change: add-mcp-custom-hosting, #394; epic #386; ADR-12).
 *
 * Pure function: turn a tenant-provided container image into the Knative Service (ksvc) that hosts
 * it as an internal-only, scale-to-zero, OpenShift-safe MCP server in the tenant's namespace. The
 * ksvc carries stable workload labels so its exact, namespaced NetworkPolicy can be reconciled
 * before the workload. Supply-chain validation rejects disallowed registries and unpinned/`latest`
 * images. No I/O here — the apply rides the runtime RBAC + Knative.
 */
import { runtimeTenantOwnership, validateRuntimeNamespace } from './runtime/mcp-runtime-namespace.mjs';

// Knative ingress and Activator traffic enters the Revision pod through queue-proxy, not through
// the user-container port. These are the stable backend listener ports in the supported Knative
// Serving contract; allowing only 8080 makes an otherwise healthy hosted service unreachable when
// the cluster CNI enforces NetworkPolicy.
const KNATIVE_QUEUE_PROXY_INGRESS_PORTS = Object.freeze([8012, 8112]);

/** Parse an image ref into { registry, name, tag, digest }. */
export function parseImageRef(ref = '') {
  let digest = null;
  let rest = String(ref);
  const at = rest.indexOf('@');
  if (at >= 0) { digest = rest.slice(at + 1); rest = rest.slice(0, at); }
  let registry = null;
  let remainder = rest;
  const firstSlash = rest.indexOf('/');
  if (firstSlash >= 0) {
    const first = rest.slice(0, firstSlash);
    if (first.includes('.') || first.includes(':') || first === 'localhost') {
      registry = first;
      remainder = rest.slice(firstSlash + 1);
    }
  }
  let tag = null;
  let name = remainder;
  const colon = remainder.lastIndexOf(':');
  if (colon >= 0 && remainder.indexOf('/', colon) < 0) {
    tag = remainder.slice(colon + 1);
    name = remainder.slice(0, colon);
  }
  return { registry, name, tag, digest };
}

/** Pinned = referenced by a digest, or by a concrete non-`latest` tag. */
export function isPinnedImage(ref) {
  const { tag, digest } = parseImageRef(ref);
  if (digest) return true;
  return !!tag && tag !== 'latest';
}

function violation(code, message, field) {
  return { code, severity: 'error', message, field };
}

/**
 * @param {Object} input
 * @param {string} input.tenantId
 * @param {string} input.serverId
 * @param {string} input.image
 * @param {string} input.namespace tenant namespace returned by the authoritative
 *   tenant-to-runtime-namespace resolver. Application tenant identifiers are never namespace
 *   defaults.
 * @param {number} [input.port]
 * @param {Array<{name:string,value:string}>} [input.env]
 * @param {{maxScale?:number}} [input.planLimits]
 * @param {string[]} [input.allowedRegistries]  if non-empty, the image registry must be in it
 * @returns {{ manifest: object|null, violations: Array }}
 */
export function buildCustomServerDeployment({ tenantId, serverId, image, namespace, port = 8080, env = [], planLimits = {}, allowedRegistries = [] } = {}) {
  const violations = [];
  let resolvedNamespace;
  if (!tenantId) violations.push(violation('missing_tenant', 'tenantId is required.', 'tenantId'));
  if (!serverId) violations.push(violation('missing_server_id', 'serverId is required.', 'serverId'));
  if (!image) violations.push(violation('missing_image', 'A container image is required.', 'image'));
  if (!namespace) {
    violations.push(violation('missing_namespace', 'An authoritative runtime namespace is required.', 'namespace'));
  } else {
    try {
      resolvedNamespace = validateRuntimeNamespace(namespace);
    } catch {
      violations.push(violation('invalid_namespace', 'Runtime namespace must be a valid Kubernetes DNS label.', 'namespace'));
    }
  }

  if (image) {
    const { registry } = parseImageRef(image);
    if (allowedRegistries.length > 0 && !allowedRegistries.includes(registry)) {
      violations.push(violation('registry_not_allowed', `Image registry "${registry ?? '(docker hub)'}" is not on the allow-list.`, 'image'));
    }
    if (!isPinnedImage(image)) {
      violations.push(violation('image_not_pinned', 'Image must be pinned to a digest or a concrete (non-"latest") tag.', 'image'));
    }
  }
  if (typeof planLimits.maxScale === 'number' && planLimits.maxScale < 1) {
    violations.push(violation('invalid_plan_max_scale', 'planLimits.maxScale must be >= 1.', 'planLimits'));
  }

  if (violations.length > 0) return { manifest: null, violations };

  const tenantOwner = runtimeTenantOwnership(tenantId);
  const labels = {
    'in-falcone.io/component': 'mcp-server',
    'in-falcone.io/tenant': tenantOwner,
    'in-falcone.io/mcp-server': serverId,
    'app.kubernetes.io/part-of': 'mcp-hosting',
    'networking.knative.dev/visibility': 'cluster-local',
  };
  return {
    manifest: {
      apiVersion: 'serving.knative.dev/v1',
      kind: 'Service',
      metadata: { name: `mcp-${serverId}`, namespace: resolvedNamespace, labels },
      spec: {
        template: {
          metadata: {
            annotations: {
              'autoscaling.knative.dev/min-scale': '0',
              'autoscaling.knative.dev/max-scale': String(planLimits.maxScale ?? 3),
            },
            labels: {
              'in-falcone.io/component': 'mcp-server',
              'in-falcone.io/tenant': tenantOwner,
              'in-falcone.io/mcp-server': serverId,
            },
          },
          spec: {
            automountServiceAccountToken: false,
            containers: [{
              image,
              ports: [{ containerPort: port }],
              imagePullPolicy: 'IfNotPresent',
              env,
              readinessProbe: { httpGet: { path: '/healthz' } },
              securityContext: {
                runAsNonRoot: true,
                allowPrivilegeEscalation: false,
                capabilities: { drop: ['ALL'] },
                seccompProfile: { type: 'RuntimeDefault' },
              },
            }],
          },
        },
      },
    },
    violations: [],
  };
}

export function buildCustomServerNetworkPolicy({
  tenantId,
  serverId,
  namespace,
  ingressNamespaces = [],
  egressNamespaces = [],
  dnsNamespaces = [],
} = {}) {
  const tenantOwner = runtimeTenantOwnership(tenantId);
  const workloadLabels = {
    'in-falcone.io/component': 'mcp-server',
    'in-falcone.io/tenant': tenantOwner,
    'in-falcone.io/mcp-server': serverId,
  };
  return {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'NetworkPolicy',
    metadata: {
      name: `mcp-${serverId}-ingress`,
      namespace,
      labels: {
        ...workloadLabels,
        'app.kubernetes.io/part-of': 'mcp-hosting',
      },
    },
    spec: {
      podSelector: { matchLabels: workloadLabels },
      policyTypes: ['Ingress', 'Egress'],
      ingress: [{
        from: ingressNamespaces.map((allowedNamespace) => ({
          namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': allowedNamespace } },
        })),
        ports: KNATIVE_QUEUE_PROXY_INGRESS_PORTS.map((port) => ({ protocol: 'TCP', port })),
      }],
      egress: [
        {
          to: dnsNamespaces.map((allowedNamespace) => ({
            namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': allowedNamespace } },
          })),
          ports: [{ protocol: 'UDP', port: 53 }, { protocol: 'TCP', port: 53 }],
        },
        {
          to: egressNamespaces.map((allowedNamespace) => ({
            namespaceSelector: { matchLabels: { 'kubernetes.io/metadata.name': allowedNamespace } },
          })),
        },
      ],
    },
  };
}
