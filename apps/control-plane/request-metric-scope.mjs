// Canonical request-metric attribution for workspace-scoped control-plane routes.
//
// A workspace path segment is client input until the existing route authorization has succeeded
// and the workspace store has resolved it. Keep this logic separate from the HTTP registry so the
// registry remains a dumb renderer and cannot accidentally promote headers, bodies, or raw paths
// into Prometheus labels.

const canonicalScopes = new WeakMap();

function canonicalScope(scope, expectedWorkspaceId) {
  const tenantId = scope?.tenantId ?? scope?.tenant_id;
  const workspaceId = scope?.workspaceId ?? scope?.id;
  if (!tenantId || !workspaceId || String(workspaceId) !== String(expectedWorkspaceId)) return null;
  return { tenantId: String(tenantId), workspaceId: String(workspaceId) };
}

function identityOwnsScope(identity, scope) {
  if (!identity || !scope) return false;
  if (identity.actorType === 'superadmin' || identity.actorType === 'internal') return true;
  return identity.tenantId != null && String(identity.tenantId) === scope.tenantId;
}

export function applyCanonicalWorkspaceMetric(metric, scope, expectedWorkspaceId = scope?.workspaceId ?? scope?.id) {
  if (!metric || typeof metric !== 'object') return false;
  const canonical = canonicalScope(scope, expectedWorkspaceId);
  if (!canonical) return false;

  metric.tenantId = canonical.tenantId;
  metric.workspaceId = canonical.workspaceId;
  canonicalScopes.set(metric, canonical);
  return true;
}

export async function attachCanonicalWorkspaceMetric({
  metric,
  workspaceId,
  statusCode,
  pool,
  resolvedScope,
  getWorkspace,
  identity,
  resolutionAttempted = false
}) {
  if (!metric || !workspaceId) return false;

  const prior = canonicalScopes.get(metric);
  if (prior?.workspaceId === String(workspaceId)) return true;

  // A handler-provided scope is canonical only after that handler has completed its existing
  // lookup and authorization boundary. Preserve it for every final status so the all-request and
  // 5xx series do not silently discard authorized 4xx/5xx outcomes.
  const alreadyResolved = canonicalScope(resolvedScope, workspaceId);
  if (alreadyResolved) {
    return applyCanonicalWorkspaceMetric(metric, alreadyResolved, workspaceId);
  }

  // The handler owns the authoritative existence/authorization lookup for C-16 routes. Once it
  // reports that boundary was attempted, a terminal 404 or registry exception must never trigger
  // a telemetry-only re-probe. In particular, the raw path id is still untrusted here.
  if (resolutionAttempted) return false;

  // A bare path plus same-tenant identity is not proof that the request passed its role or
  // membership boundary. Handlers that authorize and resolve a scope attach it above; otherwise a
  // 401/403 must stay workspace-unscoped. Authorized validation/internal failures can still use
  // the best-effort canonical lookup below so their 400/500 request telemetry remains attributable.
  if (statusCode === 401 || statusCode === 403) return false;

  if (typeof getWorkspace !== 'function') return false;
  try {
    const workspace = await getWorkspace(pool, workspaceId);
    const canonical = canonicalScope(workspace, workspaceId);
    // The matched path becomes a metric label only when the verified identity owns the
    // canonical tenant or is an existing platform actor. Foreign and unknown paths stay
    // unlabeled even when their final response is a 4xx/5xx.
    if (!identityOwnsScope(identity, canonical)) return false;
    return applyCanonicalWorkspaceMetric(metric, canonical, workspaceId);
  } catch {
    // Telemetry enrichment is best-effort and must not change the route response.
    return false;
  }
}

export function createControlPlaneMetricAttribution({
  method,
  pool,
  getWorkspace
}) {
  const metric = { method, route: 'unmatched', tenantId: '', workspaceId: '' };
  let workspaceId = null;
  let authenticatedIdentity = null;
  let workspaceResolutionAttempted = false;
  let completion = null;

  return {
    metric,

    bindAuthenticatedRoute(identity, params = {}) {
      metric.tenantId = identity?.tenantId ?? '';
      authenticatedIdentity = identity ?? null;
      // A JWT workspace claim and client identity headers are intentionally absent here. The
      // matched path is only a candidate until complete() receives handler-resolved scope or
      // verifies canonical ownership through the workspace store.
      workspaceId = params.workspaceId ?? null;
    },

    markWorkspaceResolutionAttempted() {
      workspaceResolutionAttempted = true;
    },

    complete(statusCode, resolvedScope) {
      // server.mjs completes local handlers explicitly and again from res.finish. Share one
      // promise so metric enrichment and its datastore fallback happen at most once per request.
      if (!completion) {
        completion = attachCanonicalWorkspaceMetric({
          metric,
          workspaceId,
          statusCode,
          pool,
          resolvedScope,
          getWorkspace,
          identity: authenticatedIdentity,
          resolutionAttempted: workspaceResolutionAttempted
        });
      }
      return completion;
    }
  };
}
