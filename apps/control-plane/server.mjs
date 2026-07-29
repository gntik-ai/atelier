// Falcone control-plane HTTP server (kind deploy).
//
// The repo ships many control-plane capabilities as action-style modules
// (main(params, overrides) -> {statusCode, body}) behind APISIX. This server is
// the runnable kind runtime for those modules: it
//   1) validates the incoming Bearer JWT against the Keycloak realm JWKS,
//   2) derives a TRUSTED identity (callerContext + x-* headers) from the verified
//      claims (so the request body can never spoof identity),
//   3) dispatches (method, path) to the real product action module via a
//      data-driven route table, injecting the dependencies each action needs
//      (pg Pool today; more added per family),
//   4) maps the action's {statusCode, body} back to HTTP, with CORS for the SPA.
//
// It is the production-shaped sibling of tests/env/action-runner (which trusts
// gateway-injected headers); here we self-validate the JWT so it works
// regardless of APISIX plugin configuration.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createMultiRealmVerifier, deriveRealmTopology } from './jwt-verify.mjs';
import { routes as seedRoutes } from './routes.mjs';
import { LOCAL_HANDLERS } from './b-handlers.mjs';
import { ensureSchema } from './tenant-store.mjs';
import * as tenantStore from './tenant-store.mjs';
import { createSaRevocationCheck } from './sa-revocation.mjs';
import { ensureSagaSchema, recoverSagas } from './saga.mjs';
import { runWithRetry, migrationRetryConfig } from './schema-retry.mjs';
import { createSchemaReadiness } from './schema-readiness.mjs';
import { applyGovernanceSchema } from './governance-schema.mjs';
import { applyWebhookSchema } from './webhook-schema.mjs';
import { tenantIdentitiesEnabled } from './storage-handlers.mjs';
import { cleanupLegacyWorkspaceIdentities } from './seaweedfs-identity.mjs';
import { recordHttp, renderMetrics, normalizeRoute, METRICS_CONTENT_TYPE } from './metrics-registry.mjs';
import { recordRouteAudit, recordRouteDenial } from './audit-writer.mjs';
import { withPostgresSsl } from './transport-security.mjs';
import { normalizeJsonBody } from './request-body.mjs';
import { buildActionParams } from './action-params.mjs';
import { createControlPlaneMetricAttribution } from './request-metric-scope.mjs';

const { Pool } = pg;

const PORT = Number(process.env.PORT ?? 8080);
// DB_URL wins if set; otherwise the pg driver reads standard PG* env vars
// (PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGPORT) — the secure path, with PGPASSWORD
// injected from the postgres Secret via secretKeyRef (no plaintext password).
const DB_URL = process.env.DB_URL || null;
const JWKS_URL = process.env.KEYCLOAK_JWKS_URL
  ?? 'http://falcone-keycloak:8080/realms/in-falcone-platform/protocol/openid-connect/certs';
const ISSUER = process.env.KEYCLOAK_ISSUER || null;   // optional exact-match check
const AUDIENCE = process.env.KEYCLOAK_AUDIENCE || null;
const ROUTE_MAP_FILE = process.env.ROUTE_MAP_FILE || null; // optional JSON merged over seedRoutes

const pool = DB_URL
  ? new Pool(withPostgresSsl({ connectionString: DB_URL, max: 12 }))
  : new Pool(withPostgresSsl({ max: 12 }));
const schemaReadiness = createSchemaReadiness();
// Multi-realm JWT verifier (parity with apps/control-plane-executor/src/runtime/jwt-verify.mjs, #622): trusts
// tokens from the platform realm AND from any per-tenant realm under the same Keycloak base (derived
// from JWKS_URL/ISSUER), fetching each realm's JWKS on demand. For a tenant-realm token the tenant id
// comes from the cryptographically-verified issuer (the realm name), not a forgeable claim.
const ALLOW_TENANT_REALMS = process.env.KEYCLOAK_ALLOW_TENANT_REALMS !== '0';
// Service-account revocation/rotation propagation (fix-sa-credential-revocation-invalidate-tokens,
// #684). After offline JWT validation, reject any service-account access token whose credential has
// been revoked (service_accounts.status='revoked') or rotated (its `iat` predates
// credentials_invalidated_at). The lookup is SCOPED by the realm (== tenant id) derived from the
// verified issuer — the SA client id is not globally unique — using the SAME Keycloak topology the
// verifier derives (deriveRealmTopology). Per-(realm,client-id) lookups are cached for
// SA_REVOCATION_CACHE_MS, also the upper bound on the propagation window (default 10000 → ≤10s; 0 = no
// cache = immediate). Non-SA (user/owner) tokens never reach the DB — pre-filtered on the `sa-` prefix.
const { realmsBase: SA_REALMS_BASE, platformRealm: SA_PLATFORM_REALM } = deriveRealmTopology(ISSUER, JWKS_URL);
// Env parse that treats unset/blank as "use the default" (Number('') === 0 would silently disable the
// cache); only an explicit finite number overrides.
const numEnv = (v, dflt) => (v == null || v === '' || !Number.isFinite(Number(v)) ? dflt : Number(v));
const SA_REVOCATION_CACHE_MS = numEnv(process.env.SA_REVOCATION_CACHE_MS, 10_000);
// Small clock-skew allowance (seconds) for the rotate watermark — distinct from the JWT exp/nbf clock
// tolerance. Keep it ≤1 so the natural mint→rotate→probe flow (gap ≥2s) always rejects a pre-rotation
// token; see docs (a same-second-as-rotation token is an inherent <1s blind spot of second-grained iat).
const SA_REVOCATION_SKEW_SEC = numEnv(process.env.SA_REVOCATION_SKEW_SEC, 1);
const saRevocationCheck = createSaRevocationCheck({
  pool,
  store: tenantStore,
  realmsBase: SA_REALMS_BASE,
  platformRealm: SA_PLATFORM_REALM,
  cacheMs: SA_REVOCATION_CACHE_MS,
  skewSec: SA_REVOCATION_SKEW_SEC,
});
const jwtVerifier = createMultiRealmVerifier({
  jwksUrl: JWKS_URL,
  issuer: ISSUER,
  audience: AUDIENCE,
  allowTenantRealms: ALLOW_TENANT_REALMS,
  revocationCheck: saRevocationCheck,
});

// ---- route table -----------------------------------------------------------
// Each route: { method, path, module, export, invoke, deps?, auth?,
//   mergeBodyIntoParams?, mergeQueryIntoParams?, defaults?, setClientModule? }.
// `path` is an Express-ish template: `{param}` -> named capture, trailing `/*`
// or `*` -> match-rest. Compiled to a RegExp with named groups once at load.
function compilePath(tmpl) {
  const rx = tmpl
    .replace(/[.+^${}()|[\]\\]/g, (m) => '\\' + m)         // escape regex metas (our { } handled next)
    .replace(/\\\{([a-zA-Z0-9_]+)\\\}/g, '(?<$1>[^/]+)')    // {param} -> named group
    .replace(/\/\\\*$/, '(?:/.*)?')                          // trailing /* -> optional rest
    .replace(/\\\*/g, '.*');                                 // bare * -> rest
  return new RegExp('^' + rx + '/?$');
}

let ROUTES = [];
function loadRoutes(extra = []) {
  // Dedupe by `METHOD path`. Seed routes (curated: domain B local handlers +
  // proven A routes) take precedence over the generated runtime map on collision.
  const byKey = new Map();
  for (const r of [...extra, ...seedRoutes]) byKey.set(`${r.method} ${r.path}`, r);
  ROUTES = [...byKey.values()].map((r) => ({ ...r, _rx: compilePath(r.path) }));
  // Most-specific first: more path segments win; wildcard routes sink.
  ROUTES.sort((a, b) => (b.path.split('/').length - a.path.split('/').length)
    || ((a.path.includes('*') ? 1 : 0) - (b.path.includes('*') ? 1 : 0)));
}

function matchRoute(method, path) {
  for (const r of ROUTES) {
    if (r.method !== method && r.method !== 'ANY') continue;
    const m = r._rx.exec(path);
    if (m) return { route: r, params: m.groups ?? {} };
  }
  return null;
}

// ---- helpers (shared shape with tests/env/action-runner) -------------------
function lowercaseHeaders(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw)) out[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : v;
  return out;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let len = 0;
    req.on('data', (c) => { const b = Buffer.isBuffer(c) ? c : Buffer.from(c); chunks.push(b); len += b.length; if (len > 8e6) req.destroy(); });
    req.on('end', () => resolve(Buffer.concat(chunks))); req.on('error', reject);
  });
}
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'authorization,content-type,x-correlation-id,idempotency-key',
  'Access-Control-Max-Age': '600'
};
function sendJson(res, statusCode, body, extra = {}) {
  const payload = body == null ? '' : JSON.stringify(body);
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload), ...CORS, ...extra });
  res.end(payload);
}

// ---- identity: verify the Bearer JWT, derive trusted claims ----------------
const KNOWN_ROLE_TO_ACTORTYPE = [
  ['superadmin', 'superadmin'], ['platform_admin', 'superadmin'], ['platform_operator', 'internal'],
  ['tenant_owner', 'tenant_owner'], ['tenant_admin', 'tenant_owner'],
  ['workspace_admin', 'workspace_admin'], ['workspace_owner', 'workspace_admin']
];
function deriveActorType(claims) {
  if (claims.actor_type) return claims.actor_type;
  const roles = claims?.realm_access?.roles ?? [];
  for (const [role, type] of KNOWN_ROLE_TO_ACTORTYPE) if (roles.includes(role)) return type;
  return 'tenant_member';
}
function workspaceIdsFromClaims(claims) {
  if (Array.isArray(claims.workspace_ids)) return claims.workspace_ids.map(String).filter(Boolean);
  if (typeof claims.workspace_ids === 'string') return claims.workspace_ids.split(/[ ,]+/).map((s) => s.trim()).filter(Boolean);
  if (claims.workspace_id) return [String(claims.workspace_id)];
  return [];
}
async function authenticate(headers) {
  const auth = headers['authorization'];
  if (!auth || !/^bearer\s+/i.test(auth)) return null;
  const token = auth.replace(/^bearer\s+/i, '');
  const { payload, trust } = await jwtVerifier.verify(token);
  const roles = payload?.realm_access?.roles ?? [];
  const scopes = typeof payload.scope === 'string' ? payload.scope.split(' ').filter(Boolean)
    : (Array.isArray(payload.scopes) ? payload.scopes : []);
  // For a per-tenant realm token the tenant id IS the verified issuer's realm name — it is
  // cryptographically bound to the signature and cannot be forged by a claim, so a tenant-A token
  // can never act as tenant B. Platform/legacy tokens keep the tenant_id claim.
  const tenantId = trust.kind === 'tenant' ? trust.realm : (payload.tenant_id ?? null);
  const workspaceIds = workspaceIdsFromClaims(payload);
  return {
    sub: payload.sub,
    tenantId,
    workspaceId: payload.workspace_id ?? null,
    workspaceIds,
    actorType: deriveActorType(payload),
    roles, scopes,
    // The trusted x-* headers a Falcone action / buildCallerContext expects.
    trustedHeaders: {
      'x-auth-subject': payload.sub ?? '',
      'x-tenant-id': tenantId ?? '',
      'x-workspace-id': payload.workspace_id ?? '',
      'x-actor-type': deriveActorType(payload),
      'x-actor-roles': roles.join(','),
      'x-actor-scopes': scopes.join(',')
    }
  };
}
function callerContextFrom(identity, correlationId) {
  return {
    actor: { id: identity.sub, type: identity.actorType, tenantId: identity.tenantId,
      roles: identity.roles, scopes: identity.scopes },
    tenantId: identity.tenantId, workspaceId: identity.workspaceId, correlationId: correlationId ?? null
  };
}
function authzOk(route, identity) {
  const need = route.auth;
  if (!need || need === 'public' || need === 'authenticated') return true;
  if (need === 'superadmin') return identity.actorType === 'superadmin' || identity.actorType === 'internal'
    || identity.roles.includes('superadmin') || identity.roles.includes('platform_admin');
  if (need === 'tenant_owner') return ['tenant_owner', 'tenant_admin', 'superadmin', 'internal'].includes(identity.actorType)
    || identity.roles.some((r) => ['tenant_owner', 'tenant_admin', 'superadmin', 'platform_admin'].includes(r));
  return true; // unknown -> defer to the action's own check
}

// ---- dependency injection + invoke (mirrors the proven shim) ----------------
const setClientDone = new Set();
async function ensureSetClient(route) {
  const mod = route.setClientModule;
  if (!mod || setClientDone.has(mod)) return;
  const imported = await import(mod);
  if (typeof imported.setClient === 'function') imported.setClient(pool);
  setClientDone.add(mod);
}
function routeNeedsDb(route) {
  return (route.deps ?? []).some((d) => d === 'db' || d === 'pg') || (route.invoke === 'params-pg');
}
function buildOverrides(route, db) {
  const o = {};
  for (const dep of route.deps ?? []) {
    if (dep === 'db' || dep === 'pg') o.db = db;
    // kafka/minio/vault are optional: the actions no-op event emission when their
    // producer is absent, and the few minio/vault writers degrade gracefully.
  }
  return o;
}
// Build the `params.auth` object the params-auth* actions read, from the verified
// identity (subject/tenant/roles/scopes/actorType).
function authFrom(identity) {
  return {
    subject: identity.sub, sub: identity.sub,
    tenantId: identity.tenantId, workspaceId: identity.workspaceId,
    actorType: identity.actorType, roles: identity.roles, scopes: identity.scopes
  };
}
const handlerCache = new Map();
async function loadHandler(route) {
  const key = route.module + '#' + route.export;
  if (!handlerCache.has(key)) {
    const mod = await import(route.module);
    const fn = mod[route.export];
    if (typeof fn !== 'function') throw Object.assign(new Error(`route ${route.path} export ${route.export} not a function`), { statusCode: 500 });
    handlerCache.set(key, fn);
  }
  return handlerCache.get(key);
}
// `db` is a DEDICATED pooled client (not the Pool) for routes that need it, so
// the actions' multi-statement transactions (BEGIN/INSERT/COMMIT) run on one
// connection. Released by the caller after the handler resolves.
async function invokeRoute(route, handler, params, callerContext, identity, db) {
  switch (route.invoke ?? 'callercontext-overrides') {
    case 'params-pg': return handler({ ...params, pg: db });
    case 'params-only': return handler(params);
    case 'params-overrides': return handler(params, buildOverrides(route, db));
    case 'callercontext-overrides':
      return handler({ ...params, callerContext }, buildOverrides(route, db));
    case 'owhttp-overrides':
      return handler({ ...params, __ow_method: String(params.__ow_method ?? '').toLowerCase() }, buildOverrides(route, db));
    case 'params-auth':
      return handler({ ...params, auth: identity ? authFrom(identity) : null });
    case 'params-auth-overrides':
      return handler({ ...params, auth: identity ? authFrom(identity) : null }, buildOverrides(route, db));
    case 'owhttp':
      await ensureSetClient(route);
      return handler({ ...params, __ow_method: String(params.__ow_method ?? '').toLowerCase() });
    default:
      throw Object.assign(new Error(`route ${route.path} unknown invoke ${route.invoke}`), { statusCode: 500 });
  }
}

// ---- request handler -------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const method = (req.method ?? 'GET').toUpperCase();
  // Prometheus scrape endpoint (no auth) — this process's HTTP metrics (#499).
  if (method === 'GET' && (req.url === '/metrics' || req.url === '/metrics/')) {
    res.writeHead(200, { 'content-type': METRICS_CONTENT_TYPE });
    return res.end(renderMetrics());
  }
  const startNs = process.hrtime.bigint();
  const metricAttribution = createControlPlaneMetricAttribution({
    method,
    pool,
    getWorkspace: tenantStore.getWorkspace
  });
  const metric = metricAttribution.metric;
  res.on('finish', () => {
    const durationSeconds = Number(process.hrtime.bigint() - startNs) / 1e9;
    void metricAttribution.complete(res.statusCode).finally(() => {
      recordHttp({
        ...metric,
        status: res.statusCode,
        durationSeconds
      });
    });
  });
  try {
    const parsed = new URL(req.url, `http://localhost:${PORT}`);
    const path = parsed.pathname;
    metric.route = normalizeRoute(path);

    if (method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    if (path === '/readyz') {
      const notReady = schemaReadiness.responseForReadyProbe();
      if (notReady) return sendJson(res, notReady.statusCode, notReady.body);
      try { await pool.query('SELECT 1'); return sendJson(res, 200, { status: 'ok' }); }
      catch (e) { console.error('[control-plane] readyz db check failed:', e); return sendJson(res, 503, { status: 'db_unavailable' }); }
    }
    if (path === '/healthz') {
      try { await pool.query('SELECT 1'); return sendJson(res, 200, { status: 'ok' }); }
      catch (e) { console.error('[control-plane] healthz db check failed:', e); return sendJson(res, 503, { status: 'db_unavailable' }); }
    }
    if (path === '/') return sendJson(res, 200, { service: 'in-falcone-control-plane', routes: ROUTES.length });

    const matched = matchRoute(method, path);
    if (!matched) return sendJson(res, 404, { code: 'NO_ROUTE', message: `No action mapped for ${method} ${path}` });
    const schemaUnavailable = schemaReadiness.responseForMappedRoute();
    if (schemaUnavailable) {
      return sendJson(res, schemaUnavailable.statusCode, schemaUnavailable.body);
    }
    const route = matched.route;

    const headers = lowercaseHeaders(req.headers);
    const correlationId = headers['x-correlation-id'] ?? null;

    let identity = null;
    if (route.auth !== 'public') {
      try { identity = await authenticate(headers); }
      catch (e) { console.error('[control-plane] token verification failed:', e); return sendJson(res, 401, { code: 'INVALID_TOKEN', message: 'Token verification failed' }); }
      if (!identity) return sendJson(res, 401, { code: 'UNAUTHENTICATED', message: 'Missing or invalid Bearer token' });
      if (!authzOk(route, identity)) return sendJson(res, 403, { code: 'FORBIDDEN', message: `requires ${route.auth}` });
    }
    metricAttribution.bindAuthenticatedRoute(identity, matched.params);

    const query = Object.fromEntries(parsed.searchParams.entries());
    const rawBody = await readBody(req);
    const contentType = String(req.headers['content-type'] ?? '').toLowerCase();
    // A non-JSON content-type carries an opaque/binary body (e.g. object uploads): keep the exact
    // bytes for the handler instead of rejecting with INVALID_JSON. JSON (or an unspecified type,
    // for backward compatibility) is parsed as before.
    const isJsonBody = contentType.includes('application/json') || contentType.includes('+json') || contentType === '';
    let body = {};
    let rawBodyIsBinary = false;
    if (rawBody.length) {
      if (isJsonBody) {
        // Parse + validate the JSON body in one place: unparseable bytes -> 400 INVALID_JSON,
        // a body that parses to a non-object (null, array, scalar) -> 400 VALIDATION_ERROR.
        // Rejecting here, before handler dispatch, keeps a malformed body from reaching a
        // handler that derefs body.<field> and throwing an opaque 500 (#666).
        const parsedBody = normalizeJsonBody(rawBody);
        if (!parsedBody.ok) return sendJson(res, parsedBody.statusCode, parsedBody.error);
        body = parsedBody.body;
      } else {
        rawBodyIsBinary = true;
      }
    }

    // Domain B: local control-plane handlers (tenant lifecycle, user management)
    // — real implementations of what the repo only stubs. Dispatched directly,
    // not via the /repo action loader.
    if (route.localHandler) {
      const fn = LOCAL_HANDLERS[route.localHandler];
      if (typeof fn !== 'function') return sendJson(res, 500, { code: 'NO_HANDLER', message: `local handler ${route.localHandler} missing` });
      const ctx = {
        params: matched.params,
        query,
        searchParams: parsed.searchParams,
        body,
        rawBody,
        contentType,
        rawBodyIsBinary,
        identity,
        pool,
        callerContext: identity ? callerContextFrom(identity, correlationId) : null,
        metric,
        req,
        res,
        cors: CORS
      };
      // Streaming routes (e.g. SSE consume) own the response: the handler writes
      // to `res` directly and ends it; we don't sendJson() after.
      if (route.stream) { await fn(ctx, res); return; }
      const result = await fn(ctx);
      await metricAttribution.complete(result?.statusCode ?? 200, ctx.resolvedScope);
      // Audit WRITER (#557): record a mutating action into the audit store WITH the
      // request correlation id, scoped to the action's owning tenant. Best-effort and
      // non-blocking — auditing must never fail or slow the action it describes.
      void recordRouteAudit(pool, route, ctx, result, correlationId);
      // Enforcement audit (#594): a 403 from a local handler (e.g. cross-tenant access) is
      // recorded as a scope-enforcement denial so the table is not silently empty.
      void recordRouteDenial(pool, route, ctx, result, correlationId);
      // Forward any response headers a local handler chose to set (e.g. Content-Range /
      // Accept-Ranges for a 206 partial read — #676). Mirrors the OW-proxied path below;
      // skip content-type/content-length (sendJson owns those). Backward-safe: existing
      // handlers don't set `.headers`, so this is a no-op for them.
      const localRespHeaders = {};
      for (const [k, v] of Object.entries(result?.headers ?? {})) {
        if (v == null) continue;
        const lk = k.toLowerCase();
        if (lk === 'content-type' || lk === 'content-length') continue;
        localRespHeaders[k] = String(v);
      }
      return sendJson(res, result?.statusCode ?? 200, result?.body ?? null, localRespHeaders);
    }

    // Inject the TRUSTED identity headers derived from the verified JWT, having
    // first dropped any client-supplied x-* identity header (anti-spoofing).
    const owHeaders = { ...headers };
    for (const k of Object.keys(owHeaders)) {
      if (k === 'x-tenant-id' || k === 'x-workspace-id' || k === 'x-auth-subject' || k.startsWith('x-actor-')) delete owHeaders[k];
    }
    if (identity) Object.assign(owHeaders, identity.trustedHeaders);

    const params = buildActionParams({
      route,
      method,
      path,
      query,
      body,
      matchedParams: matched.params,
      owHeaders
    });
    const callerContext = identity ? callerContextFrom(identity, correlationId) : null;

    const handler = await loadHandler(route);
    // Give transactional actions a dedicated connection (a Pool spreads
    // BEGIN/INSERT/COMMIT across connections -> writes silently roll back).
    let client = null, result;
    try {
      if (routeNeedsDb(route)) client = await pool.connect();
      result = await invokeRoute(route, handler, params, callerContext, identity, client ?? pool);
    } finally {
      if (client) client.release();
    }
    await metricAttribution.complete(result?.statusCode ?? 200);
    const respHeaders = {};
    for (const [k, v] of Object.entries(result?.headers ?? {})) {
      if (v == null) continue;
      const lk = k.toLowerCase();
      if (lk === 'content-type' || lk === 'content-length') continue;
      respHeaders[k] = String(v);
    }
    sendJson(res, result?.statusCode ?? 200, result?.body ?? null, respHeaders);
  } catch (err) {
    // Log the full error (incl. stack) server-side only; never echo an exception's
    // message/stack to the client (stack-trace exposure). Return the stable code.
    console.error('[control-plane] request failed:', err);
    const statusCode = err?.statusCode ?? (err?.code === 'FORBIDDEN' ? 403 : 500);
    // Never surface a backend-specific code (e.g. a raw Postgres SQLSTATE like "23505") on a 5xx —
    // those are unmapped internal errors and the SQLSTATE leaks the storage engine (#634). Only echo
    // the stable application code for deliberately mapped client errors (< 500).
    const code = statusCode >= 500 ? 'CONTROL_PLANE_ERROR' : (err?.code ?? 'CONTROL_PLANE_ERROR');
    sendJson(res, statusCode, { code, message: statusCode >= 500 ? 'Internal server error' : code });
  }
});

loadRoutes();
// Domain B needs the `tenants` registry + saga tables (no in-repo migration
// creates them). After the schema is ready, sweep any saga left 'running' by a
// prior crash and run its durable compensations (rollback survives a restart).
// Postgres may not be ready when we start (fresh install / rolling restart). Retry the
// schema/recovery with exponential backoff (D5); without it an ECONNREFUSED left the
// `tenants` table uncreated and every tenant op 500'd until a manual pod restart. If the DB
// is still unreachable after the timeout, exit non-zero so Kubernetes restarts the pod and
// retries — never serve indefinitely against a missing schema.
runWithRetry(async (attempt) => {
  await ensureSchema(pool);
  await ensureSagaSchema(pool);
  // Apply the provisioning-orchestrator migration set required by served real actions
  // (async operations, plans / quota dimensions / change-history / quota overrides /
  // boolean capabilities / scope-enforcement) so the wireable routes resolve instead
  // of 500'ing on 42P01 (#555, #736).
  await applyGovernanceSchema(pool);
  // Webhook management plane (#643): create webhook_subscriptions/_signing_secrets/
  // _deliveries/_delivery_attempts (migrations 001+002) so /v1/webhooks/* has durable
  // tenant-scoped storage. Idempotent; RLS (003) deferred — see webhook-schema.mjs.
  await applyWebhookSchema(pool);
  const n = await recoverSagas(pool);
  schemaReadiness.markReady();
  console.log(`[control-plane] schema ready; recovered ${n} orphaned saga(s) (attempt ${attempt})`);
  return n;
}, migrationRetryConfig()).catch((e) => {
  console.error('[control-plane] schema/recovery permanently failed; exiting for restart:', e?.message ?? e);
  process.exit(1);
});
// One-shot forward migration for #673: invalidate ALL legacy per-WORKSPACE SeaweedFS
// identities (`falcone-ws-*`). Pre-fix, one identity per workspace accumulated a grant +
// a fresh key for every bucket, so any of its keys reached every (current or RE-CREATED)
// bucket in the workspace — and orphaned legacy identities (workspace/buckets deleted)
// still authenticated against a re-created, deterministically-named bucket. Switching the
// issuer to per-bucket identities is forward-only and does NOT remove those live legacy
// keys; this cleanup does. It is BEST-EFFORT and NON-FATAL: it never blocks or crashes
// boot (independent of the DB schema retry above), is idempotent (a no-op once the legacy
// identities are gone, so running at every boot is harmless), and skips cleanly when not
// in-cluster (local/test runs have no SA token to post the Job). Gated on the same flag
// as per-bucket issuance — if identities are disabled there is nothing to migrate.
if (tenantIdentitiesEnabled()) {
  cleanupLegacyWorkspaceIdentities()
    .then((r) => {
      if (r.posted) console.log(`[control-plane] #673 legacy per-workspace identity cleanup Job posted: ${r.jobName}`);
      else if (r.skipped) console.log(`[control-plane] #673 legacy identity cleanup skipped (${r.skipped})`);
      else if (r.error) console.warn(`[control-plane] #673 legacy identity cleanup could not post a Job (non-fatal): ${r.error}`);
    })
    .catch((e) => console.warn('[control-plane] #673 legacy identity cleanup unexpected error (non-fatal):', e?.message ?? e));
}
if (ROUTE_MAP_FILE) {
  readFile(ROUTE_MAP_FILE, 'utf8').then((txt) => {
    try { const extra = JSON.parse(txt); loadRoutes(Array.isArray(extra) ? extra : []); console.log(`[control-plane] loaded ${ROUTES.length} routes (seed + ${ROUTE_MAP_FILE})`); }
    catch (e) { console.error('[control-plane] route map parse failed:', e.message); }
  }).catch(() => {});
}
server.listen(PORT, () => console.log(`[control-plane] listening on :${PORT}; routes=${ROUTES.length}; jwks=${JWKS_URL}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => pool.end().finally(() => process.exit(0))));
