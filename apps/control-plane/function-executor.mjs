// Function executor (kind deploy) — KNATIVE-backed.
//
// A function = a Knative Service (ksvc) running the fn-runtime image with the
// source injected via FN_SRC. Deploy creates/updates the ksvc (new revision on
// code change; cluster-local, scale-to-zero). Invoke is an HTTP POST to the ksvc's
// cluster-internal URL (Knative scales it from zero, runs main(params), returns
// { status, result, logs }). Talks to the k8s API with the in-cluster SA token+CA
// via node:https (no SDK); the control-plane SA is granted ksvc + jobs RBAC.
//
// Replaces the earlier Job-per-invoke executor (and the OpenWhisk attempt, whose
// Python2/ansible init images are incompatible with this host kernel).
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const SA = '/var/run/secrets/kubernetes.io/serviceaccount';
export const NS = (() => { try { return fs.readFileSync(`${SA}/namespace`, 'utf8').trim(); } catch { return 'falcone'; } })();
const CA = (() => { try { return fs.readFileSync(`${SA}/ca.crt`); } catch { return undefined; } })();
const readToken = () => { try { return fs.readFileSync(`${SA}/token`, 'utf8').trim(); } catch { return ''; } };
const HOST = process.env.KUBERNETES_SERVICE_HOST || 'kubernetes.default.svc';
const PORT = process.env.KUBERNETES_SERVICE_PORT || '443';
// The runtime image each function ksvc runs (Harbor path in prod; in-cluster registry on kind).
export const FN_RUNTIME_IMAGE = process.env.FN_RUNTIME_IMAGE || 'localhost:30500/in-falcone-fn-runtime:0.1.0';
export const FUNCTION_OWNERSHIP_LABELS = Object.freeze({
  tenant: 'in-falcone.io/tenant',
  functionResource: 'in-falcone.io/function-resource',
});

const KUBERNETES_LABEL_VALUE = /^(([A-Za-z0-9][-A-Za-z0-9_.]*)?[A-Za-z0-9])$/;
const KUBERNETES_SERVICE_NAME = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/;

function k8s(method, path, body, { contentType = 'application/json' } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const req = https.request({
      host: HOST, port: PORT, path, method, ca: CA,
      headers: {
        authorization: `Bearer ${readToken()}`, accept: 'application/json',
        ...(data ? { 'content-type': contentType, 'content-length': Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      let buf = ''; res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        if (res.statusCode >= 400) { const e = new Error(`k8s ${method} ${path} -> ${res.statusCode}: ${buf.slice(0, 300)}`); e.statusCode = res.statusCode; return reject(e); }
        try { resolve(buf ? JSON.parse(buf) : {}); } catch { resolve({}); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// DNS-1035 service name (lowercase alnum + '-', start with a letter, <=63).
export function ksvcName(workspaceSlug, actionName) {
  let v = `fn-${workspaceSlug || 'ws'}-${actionName || 'a'}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  if (!/^[a-z]/.test(v)) v = `fn-${v}`;
  return v.slice(0, 63).replace(/-+$/, '');
}

// Knative Service name for a function, GLOBALLY UNIQUE per (tenant, workspace).
// Two tenants frequently share a workspace slug (e.g. both "app-staging");
// deriving the ksvc name from the slug + action alone collided their same-named
// actions on ONE shared ksvc, so one tenant's deploy clobbered — and its invoke
// could run — the other tenant's code (P0 ISO-FUNCTIONS). We append a short,
// stable hash of `tenantId:workspaceId` (each globally unique) so same-named
// workspaces across tenants get distinct ksvcs, while keeping the slug for human
// readability. Deterministic, so a redeploy/invoke resolves the same caller-scoped
// ksvc. DNS-1035 still holds (<=63, lowercase alnum + '-', starts with a letter).
export function ksvcNameForWorkspace(workspace = {}, actionName) {
  const tenantId = workspace.tenant_id ?? workspace.tenantId ?? '';
  const workspaceId = workspace.id ?? workspace.workspaceId ?? '';
  const slug = workspace.slug ?? (workspaceId ? String(workspaceId).slice(0, 8) : '');
  const disc = createHash('sha256').update(`${tenantId}:${workspaceId}`).digest('hex').slice(0, 10);
  let base = `fn-${slug || 'ws'}-${actionName || 'a'}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  if (!/^[a-z]/.test(base)) base = `fn-${base}`;
  // Reserve room for the "-<disc>" suffix within the 63-char DNS-1035 limit.
  base = base.slice(0, 63 - disc.length - 1).replace(/-+$/, '');
  return `${base}-${disc}`;
}
export const ksvcHost = (name) => `${name}.${NS}.svc.cluster.local`;

function ownershipLabelValue(value, fieldName) {
  const text = typeof value === 'string' ? value : '';
  if (!text) throw new TypeError(`${fieldName} is required for Function runtime ownership`);
  if (text.length <= 63 && KUBERNETES_LABEL_VALUE.test(text)) return text;
  // Preserve ordinary Falcone IDs for operability. IDs outside the Kubernetes label-value grammar
  // receive a deterministic collision-resistant representation that remains selector-safe.
  return `sha256-${createHash('sha256').update(text).digest('hex').slice(0, 56)}`;
}

export function buildFunctionOwnershipLabels({ tenantId, functionResourceId } = {}) {
  return {
    [FUNCTION_OWNERSHIP_LABELS.tenant]: ownershipLabelValue(tenantId, 'tenantId'),
    [FUNCTION_OWNERSHIP_LABELS.functionResource]: ownershipLabelValue(
      functionResourceId,
      'functionResourceId',
    ),
  };
}

function hasFunctionOwnershipLabels(resource, expectedLabels) {
  const actual = resource?.metadata?.labels ?? {};
  return Object.entries(expectedLabels).every(([key, value]) => actual[key] === value);
}

function ownershipRetentionError(reason) {
  return Object.assign(
    new Error('Knative Service ownership could not be verified; the resource was retained'),
    {
      code: 'FN_RUNTIME_OWNERSHIP_MISMATCH',
      statusCode: 409,
      retained: true,
      reason,
    },
  );
}

function servicePath(name) {
  const value = String(name ?? '');
  if (!KUBERNETES_SERVICE_NAME.test(value)) {
    throw new TypeError('name must be a Kubernetes-valid Function Service name');
  }
  return `/apis/serving.knative.dev/v1/namespaces/${encodeURIComponent(NS)}/services/${encodeURIComponent(value)}`;
}

export function buildFunctionKsvcManifest(
  name,
  source,
  { tenantId, functionResourceId, memoryMb = 256, timeoutMs = 60000, secretEnv = [] } = {},
) {
  // Workspace secrets resolved from Vault (add-vault-secret-consumption, #612) are injected as plain
  // env vars alongside FN_SRC. The values are read server-side at deploy from the caller's own
  // tenant/workspace Vault path; only the names a function declares are injected.
  const env = [{ name: 'FN_SRC', value: source }, ...(Array.isArray(secretEnv) ? secretEnv : [])];
  const ownershipLabels = buildFunctionOwnershipLabels({ tenantId, functionResourceId });
  return {
    apiVersion: 'serving.knative.dev/v1', kind: 'Service',
    metadata: {
      name,
      namespace: NS,
      labels: {
        'networking.knative.dev/visibility': 'cluster-local',
        'in-falcone.function': 'true',
        ...ownershipLabels,
      },
    },
    spec: {
      template: {
        metadata: {
          annotations: {
            'autoscaling.knative.dev/min-scale': '0',
            'autoscaling.knative.dev/max-scale': '5',
          },
          labels: ownershipLabels,
        },
        spec: {
          containerConcurrency: 10,
          timeoutSeconds: Math.min(Math.ceil(timeoutMs / 1000) + 5, 300),
          containers: [{
            image: FN_RUNTIME_IMAGE,
            env,
            resources: { limits: { cpu: '1', memory: `${memoryMb}Mi` }, requests: { cpu: '50m', memory: '64Mi' } },
            // OpenShift-friendly: runAsNonRoot, no fixed uid (image USER 1000 on kind; SCC assigns on OCP).
            securityContext: { runAsNonRoot: true, allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] }, seccompProfile: { type: 'RuntimeDefault' } }
          }]
        }
      }
    }
  };
}

// Create or update the function's Knative Service (a code change -> new revision).
export async function deployKnativeService(name, source, opts = {}) {
  const { request = k8s, ...manifestOptions } = opts;
  const manifest = buildFunctionKsvcManifest(name, source, manifestOptions);
  const expectedLabels = buildFunctionOwnershipLabels(manifestOptions);
  const namedServicePath = servicePath(name);
  try {
    await request('POST', `/apis/serving.knative.dev/v1/namespaces/${encodeURIComponent(NS)}/services`, manifest);
  } catch (e) {
    if (e.statusCode !== 409) throw e;
    // Never adopt or roll a same-named Service unless Kubernetes confirms both ownership labels.
    // resourceVersion makes the subsequent patch fail if the verified object is replaced first.
    const existing = await request('GET', namedServicePath);
    if (!hasFunctionOwnershipLabels(existing, expectedLabels)
      || typeof existing?.metadata?.resourceVersion !== 'string') {
      throw Object.assign(
        new Error('existing Knative Service ownership does not match this tenant and Function'),
        { code: 'FN_RUNTIME_OWNERSHIP_MISMATCH', statusCode: 409 },
      );
    }
    await request('PATCH', namedServicePath, {
      metadata: {
        resourceVersion: existing.metadata?.resourceVersion,
        labels: manifest.metadata.labels,
      },
      spec: manifest.spec,
    }, { contentType: 'application/merge-patch+json' });
  }
  return ksvcHost(name);
}

export async function deleteKnativeService(
  name,
  { tenantId, functionResourceId, request = k8s } = {},
) {
  const expectedLabels = buildFunctionOwnershipLabels({ tenantId, functionResourceId });
  const namedServicePath = servicePath(name);
  let existing;
  try {
    existing = await request('GET', namedServicePath);
  } catch (error) {
    if (error.statusCode === 404) {
      return { deleted: false, retained: false, reason: 'not_found' };
    }
    throw error;
  }

  if (!hasFunctionOwnershipLabels(existing, expectedLabels)) {
    throw ownershipRetentionError('ownership_mismatch');
  }

  const uid = existing?.metadata?.uid;
  const resourceVersion = existing?.metadata?.resourceVersion;
  if (typeof uid !== 'string' || !uid || typeof resourceVersion !== 'string' || !resourceVersion) {
    throw ownershipRetentionError('verification_incomplete');
  }

  // The named delete is not authorized by namespace+name alone: Kubernetes must match both the UID
  // and resourceVersion of the object whose tenant+Function labels were just verified. Replacement
  // or label mutation between GET and DELETE therefore fails closed instead of deleting by name.
  try {
    await request('DELETE', namedServicePath, {
      apiVersion: 'v1',
      kind: 'DeleteOptions',
      propagationPolicy: 'Background',
      preconditions: { uid, resourceVersion },
    });
  } catch (error) {
    if (error.statusCode === 404) {
      return { deleted: false, retained: false, reason: 'not_found' };
    }
    throw error;
  }
  return { deleted: true, retained: false, reason: 'deleted' };
}

// Wait until the ksvc reports Ready (best-effort; invoke also tolerates cold start).
export async function waitKsvcReady(name, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const svc = await k8s('GET', `/apis/serving.knative.dev/v1/namespaces/${NS}/services/${name}`).catch(() => null);
    const ready = (svc?.status?.conditions ?? []).find((c) => c.type === 'Ready');
    if (ready?.status === 'True') return true;
    if (ready?.status === 'False' && ready?.reason && ready.reason !== 'Deploying' && ready.reason !== 'Unknown') return false;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

// Build the POST headers for a function invocation. The VERIFIED caller context
// (from the control-plane JWT identity, never the request body) is injected as
// X-Falcone-* headers so the fn-runtime can expose it to user code out-of-band
// from the user-controlled params. Absent/empty fields are omitted (not sent
// blank); no `caller` -> only the content headers (unchanged behaviour). Exported
// as the deterministic unit-test seam (invokeKnative itself opens a real socket).
export function buildInvokeHeaders(payload, caller = null) {
  const headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) };
  if (caller) {
    const set = (name, value) => { if (typeof value === 'string' && value.length) headers[name] = value; };
    set('x-falcone-tenant-id', caller.tenantId);
    set('x-falcone-workspace-id', caller.workspaceId);
    set('x-falcone-principal', caller.principal);
    set('x-falcone-actor-type', caller.actorType);
    const roles = Array.isArray(caller.roles) ? caller.roles.filter(Boolean) : [];
    if (roles.length) headers['x-falcone-roles'] = roles.join(',');
  }
  return headers;
}

// Invoke a function over its ksvc cluster-internal URL (Knative scales from zero).
// `caller` (verified identity) is delivered to the runtime as X-Falcone-* headers.
export function invokeKnative(host, params, { timeoutMs = 60000, caller = null } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const payload = JSON.stringify(params ?? {});
    const req = http.request({
      host, port: 80, path: '/', method: 'POST',
      headers: buildInvokeHeaders(payload, caller), timeout: timeoutMs
    }, (res) => {
      let buf = ''; res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        const durationMs = Date.now() - started;
        let parsed; try { parsed = JSON.parse(buf); } catch { parsed = null; }
        if (res.statusCode >= 200 && res.statusCode < 300 && parsed) {
          resolve({ status: parsed.status === 'success' ? 'success' : 'failure', result: parsed.result ?? {}, logs: parsed.logs ?? [], durationMs, statusCode: parsed.status === 'success' ? 200 : 502 });
        } else {
          resolve({ status: 'failure', result: { error: `runtime HTTP ${res.statusCode}: ${buf.slice(0, 200)}` }, logs: [], durationMs, statusCode: 502 });
        }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 'failure', result: { error: 'invocation timed out' }, logs: [], durationMs: Date.now() - started, statusCode: 504 }); });
    req.on('error', (e) => resolve({ status: 'failure', result: { error: String(e.message ?? e) }, logs: [], durationMs: Date.now() - started, statusCode: 502 }));
    req.write(payload); req.end();
  });
}
