// Control-plane HTTP service (changes: add-control-plane-executor, add-postgres-ddl-execute,
// add-postgres-data-crud-execute).
//
// The real, runnable control-plane the gateway routes /v1/* to. It trusts the identity
// headers APISIX injects from the verified credential (x-tenant-id / x-workspace-id /
// x-auth-subject / x-actor-roles), matches the request against a small route table, and
// runs it through the executors (which build adapter plans and execute them against the
// workspace database). Wires the Postgres data-row family (CRUD + bulk) and the Postgres
// DDL family (schema/table/column/index); other OpenAPI families plug into the same table.
import http from 'node:http';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import { recordHttp, recordMcpDependency, renderMetrics, normalizeRoute, METRICS_CONTENT_TYPE } from './metrics-registry.mjs';
import { executePostgresData } from './postgres-data-executor.mjs';
import { executePostgresDdl } from './postgres-ddl-executor.mjs';
import { handleMcpMessage } from '../mcp-official-server.mjs';
import { BASE_SCOPE } from '../mcp-official-catalog.mjs';
import { mcpConfigStore } from '../mcp-config.mjs';
import { knativeUnavailableResponse } from '../../../../apps/control-plane/knative-runtime.mjs';
import { main as workspaceDocsAction } from '../../../../packages/workspace-docs-service/actions/workspace-docs.mjs';
// Shared write-capable admin role set — the single source of truth for both the API-key
// management gate (here) and the flow-definition write gate (flow-executor.mjs, #760) so they
// cannot drift. This module imports nothing from the runtime → no import cycle.
import { WRITE_CAPABLE_ADMIN_ROLES, hasWriteCapableRole } from './auth-roles.mjs';

// Roles that may change the first-party MCP configuration AND always retain base-scope access so a
// disabled server can be re-enabled (must match SUPERADMIN_ROLES in mcp-official-server.mjs).
const MCP_SUPERADMIN_ROLES = new Set(['superadmin', 'platform_admin']);

const META_QUERY_KEYS = new Set(['select', 'order', 'page[size]', 'page[after]', 'countMode']);

function sendJson(res, statusCode, body, headers = {}) {
  const responseHeaders = { ...headers };
  delete responseHeaders['content-type'];
  delete responseHeaders['Content-Type'];
  delete responseHeaders['content-length'];
  delete responseHeaders['Content-Length'];
  const payload = body == null ? '' : JSON.stringify(body);
  if (statusCode === 204) {
    res.writeHead(statusCode, responseHeaders);
    res.end();
    return;
  }
  res.writeHead(statusCode, {
    ...responseHeaders,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

// Reverse-proxy a request the executor does not itself serve to the control-plane upstream.
// The executor only handles the data-plane + DDL slice; every other path under the data
// prefixes (browse/inventory/management) is served by the legacy control-plane. The request
// stream is piped through untouched (method/path/query/headers/body) and the upstream response
// is streamed back, so this never buffers the body.
//
// SSRF-safe by construction: protocol/host/port are pinned to the operator-configured
// `upstream` (a URL parsed at startup); ONLY the path+query are taken from the request. A
// hostile request-target (absolute- or protocol-relative form, e.g. `//169.254.169.254/…`)
// therefore cannot redirect the proxy off the configured control-plane host.
const PROXY_TIMEOUT_MS = 30000;
function proxyRequest(req, res, upstream, logger) {
  const incoming = new URL(req.url, 'http://upstream.invalid');
  const client = upstream.protocol === 'https:' ? https : http;
  const headers = { ...req.headers, host: upstream.host };
  delete headers.connection;
  const upstreamReq = client.request(
    {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port,
      method: req.method,
      path: `${incoming.pathname}${incoming.search}`,
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstreamReq.setTimeout(PROXY_TIMEOUT_MS, () => upstreamReq.destroy(Object.assign(new Error('upstream timeout'), { code: 'ETIMEDOUT' })));
  upstreamReq.on('error', (err) => {
    logger.error?.('[control-plane] upstream proxy failed:', err);
    if (!res.headersSent) sendJson(res, 502, { code: 'UPSTREAM_UNAVAILABLE', message: 'Control-plane upstream unavailable' });
    else res.destroy();
  });
  req.pipe(upstreamReq);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 4e6) req.destroy(); });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(Object.assign(new Error('Body is not valid JSON'), { statusCode: 400, code: 'INVALID_JSON' })); }
    });
    req.on('error', reject);
  });
}

// Read the RAW request body (string). Webhook trigger ingestion needs the exact bytes the sender
// signed over — JSON.parse + re-stringify would change the byte sequence and break HMAC. The parsed
// JSON (best-effort) is forwarded as the flow input.
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 4e6) req.destroy(); });
    req.on('end', () => resolve(raw));
    req.on('error', reject);
  });
}

function identityFromHeaders(headers, pathWorkspaceId) {
  // x-auth-scopes is injected by the gateway from the verified token (space- or comma-separated).
  // x-actor-scopes is accepted as a compatibility alias for direct tests/older route config.
  const rawScopes = headers['x-auth-scopes'] || headers['x-actor-scopes'];
  const scopes = typeof rawScopes === 'string'
    ? rawScopes.split(/[ ,]+/).map((s) => s.trim()).filter(Boolean)
    : undefined;
  // x-actor-roles is injected by the gateway from the verified token; surfaced so role-gated handlers
  // (e.g. API-key management) enforce on the trust-header path too (#624). It was declared in the
  // gateway contract but previously never read by the executor.
  const rawRoles = headers['x-actor-roles'];
  const roles = typeof rawRoles === 'string'
    ? rawRoles.split(/[ ,]+/).map((s) => s.trim()).filter(Boolean)
    : undefined;
  const rawWorkspaceIds = headers['x-actor-workspace-ids'] || headers['x-workspace-ids'];
  const workspaceIds = typeof rawWorkspaceIds === 'string'
    ? rawWorkspaceIds.split(/[ ,]+/).map((s) => s.trim()).filter(Boolean)
    : undefined;
  const credentialWorkspaceId = headers['x-workspace-id'] || undefined;
  return {
    tenantId: headers['x-tenant-id'],
    workspaceId: credentialWorkspaceId || pathWorkspaceId,
    // A trusted gateway header is an explicit singular credential binding just like an API key or
    // JWT workspace_id claim. Keeping this distinct from the path fallback prevents a caller whose
    // verified header names workspace B from addressing workspace A through any hosted MCP route.
    ...(credentialWorkspaceId ? { credentialWorkspaceId } : {}),
    actorId: headers['x-auth-subject'],
    roleName: headers['x-pg-role'] || 'falcone_app',
    ...(scopes ? { scopes } : {}),
    ...(roles ? { roles } : {}),
    ...(workspaceIds ? { workspaceIds } : {}),
  };
}

// Extract a presented API key from the request headers (Supabase-style):
//   Authorization: ApiKey flc_... | Authorization: Bearer flc_... | apikey: flc_... | x-api-key: flc_...
function apiKeyFromHeaders(headers) {
  const auth = headers['authorization'];
  if (auth) {
    const m = /^(?:ApiKey|Bearer)\s+(flc_\S+)$/i.exec(auth);
    if (m) return m[1];
  }
  const direct = headers['apikey'] || headers['x-api-key'];
  return typeof direct === 'string' && direct.startsWith('flc_') ? direct : undefined;
}

// Extract a Bearer JWT (NOT an flc_ api-key, which apiKeyFromHeaders handles).
function bearerJwtFromHeaders(headers) {
  const m = /^Bearer\s+(\S+)$/i.exec(headers['authorization'] ?? '');
  if (!m || m[1].startsWith('flc_')) return undefined;
  return m[1];
}

// Resolve identity, in precedence order — each authoritative credential derives the
// tenant/workspace from the credential itself, never from spoofable request headers:
//   1. API key (Supabase-style) → tenant/workspace from the verified key (RLS dbRole).
//   2. Bearer JWT (when a verifier is configured) → identity from verified token claims.
//      This lets admin/user requests authenticate WITHOUT the gateway injecting x-tenant-id,
//      so e.g. API-key issuance works through an OIDC-less gateway (kind standalone).
//   3. Gateway-injected identity headers — ONLY when a mutually-authenticated trust signal
//      is present. The trust signal is one of:
//        a. x-gateway-auth header matches the operator-configured gatewaySharedSecret.
//        b. No gatewaySharedSecret is configured at all (dev/test mode — headers trusted
//           unconditionally; identical to the legacy behaviour before this fix).
//      When a secret IS configured but the header is absent or wrong → 401 fail-closed.
//      This ensures that a client cannot impersonate a tenant by setting x-tenant-id
//      without going through an authenticated gateway, closing the GW-1 exploit.
// A presented-but-invalid key or JWT, or a wrong/absent trust signal, fails closed (401).
async function resolveIdentity(headers, pathWorkspaceId, apiKeyStore, jwtVerifier, queryApiKey, gatewaySharedSecret) {
  // queryApiKey is only supplied for SSE routes: a browser EventSource cannot set headers,
  // so the (low-privilege, read-only) anon key arrives as ?apikey=. Header still wins.
  const key = apiKeyFromHeaders(headers) ?? (typeof queryApiKey === 'string' && queryApiKey.startsWith('flc_') ? queryApiKey : undefined);
  if (key) {
    const resolved = apiKeyStore ? await apiKeyStore.verifyKey(key) : undefined;
    if (resolved) {
      return {
        tenantId: resolved.tenantId,
        workspaceId: resolved.workspaceId,
        // credentialWorkspaceId is the workspace this key is explicitly bound to.
        // It is used by the workspace binding check (path↔credential) and is always
        // set for API keys (a key is always issued for a specific workspace).
        credentialWorkspaceId: resolved.workspaceId,
        actorId: `apikey:${resolved.keyType}`,
        roleName: resolved.roleName,
        dbRole: resolved.dbRole, // assumed via SET LOCAL ROLE → RLS enforced for anon keys
        scopes: resolved.scopes,
      };
    }
    return { tenantId: undefined }; // key presented but invalid/unverifiable → 401, fail closed
  }
  const jwt = bearerJwtFromHeaders(headers);
  if (jwt && jwtVerifier) {
    const verified = await jwtVerifier.verify(jwt, pathWorkspaceId).catch(() => undefined);
    return verified ?? { tenantId: undefined }; // invalid JWT → 401, fail closed
  }
  // No authoritative credential. Fall through to header-based identity ONLY when the
  // gateway trust signal is valid. When gatewaySharedSecret is set (production), the
  // x-gateway-auth header MUST match; an absent/wrong header → 401, fail-closed.
  // When no secret is configured (dev/test), headers are trusted unconditionally
  // (legacy behaviour: the caller is responsible for security at that layer).
  if (gatewaySharedSecret) {
    const presented = headers['x-gateway-auth'];
    if (!presented || presented !== gatewaySharedSecret) {
      return { tenantId: undefined }; // missing or wrong trust signal → 401
    }
  }
  return identityFromHeaders(headers, pathWorkspaceId); // gateway-injected → trust
}

function primaryKeyFromQuery(searchParams) {
  const pk = {};
  for (const [k, v] of searchParams.entries()) if (!META_QUERY_KEYS.has(k)) pk[k] = v;
  return Object.keys(pk).length > 0 ? pk : undefined;
}

function pageFromQuery(searchParams) {
  const size = searchParams.get('page[size]');
  const after = searchParams.get('page[after]');
  if (size == null && after == null) return undefined;
  return { size: size != null ? Number(size) : undefined, after: after ?? undefined };
}

const FILTER_OPERATORS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'like', 'ilike', 'json_path_eq']);

// Coerce a query-string scalar so numeric/boolean comparisons reach Postgres with the right
// type (e.g. age=gte.18 → 18, not "18").
function coerceScalar(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw !== '' && /^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

// PostgREST-style list filters: each non-meta query param `column=operator.value`
// (e.g. ?status=eq.active&age=gte.18&id=in.(1,2,3)). Bare `column=value` defaults to eq.
function filtersFromQuery(searchParams) {
  const filters = [];
  for (const [k, v] of searchParams.entries()) {
    if (META_QUERY_KEYS.has(k)) continue;
    const m = /^([a-z_]+)\.(.*)$/s.exec(v);
    if (m && FILTER_OPERATORS.has(m[1])) {
      const operator = m[1];
      const rest = m[2];
      const value = operator === 'in'
        ? rest.replace(/^\(|\)$/g, '').split(',').map((entry) => coerceScalar(entry.trim()))
        : coerceScalar(rest);
      filters.push({ columnName: k, operator, value });
    } else {
      filters.push({ columnName: k, operator: 'eq', value: coerceScalar(v) });
    }
  }
  return filters.length > 0 ? filters : undefined;
}

// Parse a JSON value from a query param (e.g. Mongo ?filter={...}); 400 on malformed JSON.
function jsonQueryParam(searchParams, key) {
  const raw = searchParams.get(key);
  if (raw == null || raw === '') return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error(`Query parameter ${key} must be valid JSON`), { statusCode: 400, code: 'INVALID_QUERY_JSON' });
  }
}

// Roles permitted to manage API keys (issue/list/rotate/revoke). A non-admin role (e.g.
// tenant_developer) is denied; an API key never manages keys. See requestGate role check (#624).
// This is the shared write-capable admin set (auth-roles.mjs) — the SAME roles the flow-definition
// write gate enforces (#760); aliased here to keep the existing identifier and the gate at L1057
// byte-identical.
const KEY_MGMT_ADMIN_ROLES = WRITE_CAPABLE_ADMIN_ROLES;

// Executor-side data-plane scope requirements (#624), enforced for API-key credentials as
// defense-in-depth when the gateway scope-enforcement plugin is not wired. Mirrors the API-key scope
// vocabulary (api-keys.mjs SCOPES_BY_TYPE): data:write gates data writes, ddl:write gates DDL. These are
// the privilege-escalation paths the bug exposed (a data:read key could write / run DDL). Reads are the
// baseline capability every key carries (data:read) and are not gated here; the POST-but-read vector
// search route is likewise a read. The billable BYOK LLM completion route
// (POST /llm/completions, #640) is also scope-gated here (#662): it spends the workspace's BYOK
// quota, so it requires data:write (the existing billable-write scope) — a data:read-only or
// scopeless/anon key is denied 403 before provider resolution. It is gated by an exact
// `/llm/completions` match so the hyphenated config/usage routes (/llm-provider, /llm-usage) are
// untouched. Routes not covered (events/functions/embedding/flows/mcp/realtime) are not gated by
// this check. The path patterns mirror the prefixes declared in buildRoutes.
const SCOPE_DDL_RE = /^\/v1\/postgres\/databases\/[^/]+\/schemas(?:\/|$)/;
const SCOPE_PG_DATA_RE = /^\/v1\/postgres\/workspaces\/[^/]+\/data\/[^/]+\/schemas\/[^/]+\/tables\/[^/]+/;
const SCOPE_MONGO_DOC_RE = /^\/v1\/mongo\/workspaces\/[^/]+\/data\/[^/]+\/collections\/[^/]+\/documents/;
// Matches ONLY the completion route — NOT /llm-provider or /llm-usage (hyphenated config/usage).
const SCOPE_LLM_COMPLETIONS_RE = /^\/v1\/workspaces\/[^/]+\/llm\/completions(?:\/|$)/;
function requiredDataScope(method, pathname) {
  if (SCOPE_DDL_RE.test(pathname)) return 'ddl:write';
  if (SCOPE_LLM_COMPLETIONS_RE.test(pathname)) return 'data:write'; // billable BYOK completion (#662)
  if (SCOPE_PG_DATA_RE.test(pathname) || SCOPE_MONGO_DOC_RE.test(pathname)) {
    if (method === 'GET') return null; // reads are not scope-gated (every key carries data:read)
    if (method === 'POST' && /\/search$/.test(pathname)) return null; // vector search is a read
    return 'data:write'; // POST/PATCH/PUT/DELETE writes
  }
  return null;
}

const BROAD_STRUCTURAL_ADMIN_ROLES = new Set(['tenant_owner', 'tenant_admin', 'platform_admin', 'superadmin']);

function hasBroadStructuralAdminRole(roles) {
  return Array.isArray(roles) && roles.some((r) => BROAD_STRUCTURAL_ADMIN_ROLES.has(r));
}

function workspaceScopeDeniesStructuralWrite(identity, workspaceId) {
  if (!workspaceId || !Array.isArray(identity?.workspaceIds)) return false;
  if (hasBroadStructuralAdminRole(identity.roles)) return false;
  return !identity.workspaceIds.includes(workspaceId);
}

function isApiKeyIdentity(identity) {
  return Boolean(identity?.dbRole || String(identity?.actorId ?? '').startsWith('apikey:'));
}

function structuralWriteDenyMessage(identity) {
  if (isApiKeyIdentity(identity)) return 'API keys cannot perform structural writes';
  if (!hasWriteCapableRole(identity?.roles)) return 'Caller role may not perform structural writes';
  return null;
}

function workspaceIdFromPath(pathname) {
  return /\/workspaces\/([^/]+)/.exec(pathname)?.[1];
}

function isHostedMcpWorkspaceRequest(pathname) {
  return /^\/v1\/mcp\/workspaces\/[^/]+\/servers(?:\/|$)/.test(pathname);
}

function isHostedMcpRpcRequest(pathname) {
  return /^\/v1\/mcp\/workspaces\/[^/]+\/servers\/[^/]+\/rpc$/.test(pathname);
}

function isStructuralWriteRequest(method, pathname) {
  if (method === 'GET') return false;
  if (/^\/v1\/workspaces\/[^/]+\/api-keys(?:\/|$)/.test(pathname)) {
    return method === 'POST' || method === 'DELETE';
  }
  if (/^\/v1\/workspaces\/[^/]+\/(?:embedding-provider|llm-provider)$/.test(pathname)) {
    return method === 'PUT' || method === 'DELETE';
  }
  if (/^\/v1\/postgres\/workspaces\/[^/]+\/data\/[^/]+\/schemas\/[^/]+\/tables\/[^/]+\/embedding-mapping$/.test(pathname)) {
    return method === 'PUT' || method === 'DELETE';
  }
  if (/^\/v1\/events\/workspaces\/[^/]+\/topics$/.test(pathname)) return method === 'POST';
  if (/^\/v1\/events\/workspaces\/[^/]+\/topics\/[^/]+\/publish$/.test(pathname)) return method === 'POST';
  if (/^\/v1\/mcp\/workspaces\/[^/]+\/servers$/.test(pathname)) return method === 'POST';
  if (/^\/v1\/mcp\/workspaces\/[^/]+\/servers\/[^/]+$/.test(pathname)) return method === 'DELETE';
  if (/^\/v1\/mcp\/workspaces\/[^/]+\/servers\/[^/]+\/curations$/.test(pathname)) return method === 'POST';
  if (/^\/v1\/mcp\/workspaces\/[^/]+\/servers\/[^/]+\/versions$/.test(pathname)) return method === 'POST';
  if (/^\/v1\/mcp\/workspaces\/[^/]+\/servers\/[^/]+\/versions\/[^/]+\/approval$/.test(pathname)) return method === 'POST';
  if (/^\/v1\/flows\/workspaces\/[^/]+\/flows$/.test(pathname)) return method === 'POST';
  if (/^\/v1\/flows\/workspaces\/[^/]+\/flows\/[^/]+$/.test(pathname)) return method === 'PATCH' || method === 'DELETE';
  if (/^\/v1\/flows\/workspaces\/[^/]+\/flows\/[^/]+\/versions$/.test(pathname)) return method === 'POST';
  return false;
}

function headerValue(headers, name) {
  const value = headers?.[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

function requestBaseUrl(headers = {}) {
  const forwardedProto = headerValue(headers, 'x-forwarded-proto');
  const forwardedHost = headerValue(headers, 'x-forwarded-host');
  const proto = String(forwardedProto ?? 'http').split(',')[0].trim() || 'http';
  const host = String(forwardedHost ?? headerValue(headers, 'host') ?? 'localhost').split(',')[0].trim() || 'localhost';
  return `${proto}://${host}`;
}

function workspaceDocsInternalClient(c, capabilities = {}) {
  const baseUrl = requestBaseUrl(c.headers);
  const tokenEndpoint = process.env.KEYCLOAK_TOKEN_ENDPOINT ?? process.env.OIDC_TOKEN_ENDPOINT ?? null;
  return {
    getApiSurface: async (workspaceId) => ({
      workspaceId,
      baseUrl,
      authMethod: 'bearer_oidc',
      tokenEndpoint,
      scopeHint: 'openid profile'
    }),
    getEffectiveCapabilities: async (workspaceId) => ({
      workspaceId,
      baseUrl,
      capabilities: [
        {
          key: 'postgres-database',
          endpoint: `${baseUrl}/v1/postgres/workspaces/${workspaceId}`,
          name: 'workspace data'
        },
        ...(capabilities.mongoExecutor ? [{
          key: 'mongo-collection',
          endpoint: `${baseUrl}/v1/mongo/workspaces/${workspaceId}`,
          name: 'documents'
        }] : []),
        ...(capabilities.functionsExecutor ? [{
          key: 'serverless-function',
          endpoint: `${baseUrl}/v1/functions/workspaces/${workspaceId}`,
          name: 'actions'
        }] : []),
        ...(capabilities.realtimeExecutor || capabilities.pgRealtimeExecutor ? [{
          key: 'realtime-subscription',
          endpoint: `${baseUrl}/v1/realtime/workspaces/${workspaceId}`,
          realtimeEndpoint: baseUrl.replace(/^http/, 'ws'),
          name: 'changes'
        }] : [])
      ]
    })
  };
}

async function runWorkspaceDocs(workspaceDocsDb, c, capabilities, pathWorkspaceId) {
  if (!workspaceDocsDb?.query) {
    throw Object.assign(new Error('Workspace docs are not enabled'), { statusCode: 501, code: 'WORKSPACE_DOCS_DISABLED' });
  }
  const result = await workspaceDocsAction({
    method: c.method,
    path: c.url.pathname,
    workspaceId: pathWorkspaceId,
    body: c.body ?? {},
    headers: c.headers,
    auth: {
      tenantId: c.identity.tenantId,
      workspaceId: c.identity.workspaceId,
      actorId: c.identity.actorId,
      subject: c.identity.actorId,
      roles: c.identity.roles ?? []
    },
    db: workspaceDocsDb,
    internalClient: workspaceDocsInternalClient(c, capabilities)
  });
  return { status: result.statusCode ?? 200, body: result.body, headers: result.headers ?? {} };
}

// Route table: [method, RegExp(pathname) with capture groups, handler(groups, {url, identity, body, registry})].
// Data routes are workspace/data-scoped; DDL routes are database-scoped (workspace via header).
function buildRoutes(registry, apiKeyStore, mongoExecutor, eventsExecutor, functionsExecutor, realtimeExecutor, pgRealtimeExecutor, embeddingExecutor, llmExecutor, mappingStore, flowExecutor, flowMonitoringExecutor, mcpEngine, controlPlaneUpstream, mcpSelfBaseUrl, mcpConfig, workspaceDocsDb, knativeRuntime, mcpRuntimeCleaner) {
  const data = '^/v1/postgres/workspaces/([^/]+)/data/([^/]+)/schemas/([^/]+)/tables/([^/]+)';
  const ddl = '^/v1/postgres/databases/([^/]+)/schemas';
  const keys = '^/v1/workspaces/([^/]+)/api-keys';
  const emb = '^/v1/workspaces/([^/]+)/embedding-provider';
  const wdocs = '^/v1/workspaces/([^/]+)/docs';
  // BYOK LLM completion plane (change: add-llm-agent-flow-task / #640) — sibling of the
  // embedding-provider config under the same workspace prefix. Served by THIS executor (the
  // dedicated APISIX route forwards these subpaths here, like 2003-embedding).
  const llmp = '^/v1/workspaces/([^/]+)/llm-provider';
  const llmc = '^/v1/workspaces/([^/]+)/llm/completions';
  const llmu = '^/v1/workspaces/([^/]+)/llm-usage';
  const mdoc = '^/v1/mongo/workspaces/([^/]+)/data/([^/]+)/collections/([^/]+)/documents';
  const evt = '^/v1/events/workspaces/([^/]+)/topics';
  const fn = '^/v1/functions/workspaces/([^/]+)/actions';
  const rt = '^/v1/realtime/workspaces/([^/]+)/data/([^/]+)/collections/([^/]+)/changes';
  const pgrt = '^/v1/realtime/workspaces/([^/]+)/data/([^/]+)/schemas/([^/]+)/tables/([^/]+)/changes';
  // Flows: registered ONLY when a flowExecutor is injected (TEMPORAL_ADDRESS set). When absent,
  // these tuples are omitted and a flows path falls through to 404 / upstream proxy unchanged.
  const fl = '^/v1/flows/workspaces/([^/]+)/flows';
  // Workspace-level schedule collection (change: add-flow-schedule-management-api / #680): lists
  // the cron schedules of the workspace's flows. A sibling of /flows under the same workspace
  // prefix; the per-flow schedule operations nest under `${fl}/{flowId}/schedule...`.
  const fls = '^/v1/flows/workspaces/([^/]+)/schedules';
  // Task-type catalog (palette source for the console flow designer): a sibling of the
  // /flows collection under the same workspace prefix. Static first-party descriptors.
  const flt = '^/v1/flows/workspaces/([^/]+)/task-types';
  // Inbound webhook trigger ingestion (change: add-flows-triggers). HMAC-authenticated, NOT OIDC:
  // the per-trigger secret is the credential. The gateway still injects the workspace's tenant
  // context (x-tenant-id/x-workspace-id) so the secret lookup is tenant-scoped.
  const fwh = '^/v1/flows/workspaces/([^/]+)/triggers/webhooks/([^/]+)';
  // MCP server hosting management API — registered ONLY when an mcpEngine is injected (MCP_ENABLED).
  // The MCP runtime/engine is internal-only; all tenant access goes through these control-plane
  // routes, which derive the tenant from the verified identity exactly like every other route.
  const mcp = '^/v1/mcp/workspaces/([^/]+)/servers';
  return [
    ['GET', /^\/(healthz|readyz)$/, () => ({ status: 200, body: { status: 'ok' } }), { noAuth: true }],

    // ---- Workspace API keys (issue/list/rotate/revoke) — admin (JWT) identity ----
    ['POST', new RegExp(`${keys}$`), ([w], c) =>
      requireStore(apiKeyStore).issueKey({ tenantId: c.identity.tenantId, workspaceId: w, keyType: c.body.keyType, scopes: c.body.scopes }).then((r) => ({ status: 201, body: r }))],
    ['GET', new RegExp(`${keys}$`), ([w]) =>
      requireStore(apiKeyStore).listKeys(w).then((items) => ({ status: 200, body: { items } }))],
    ['POST', new RegExp(`${keys}/([^/]+)/rotations$`), ([w, id], c) =>
      requireStore(apiKeyStore).rotateKey({ id, workspaceId: w }).then((r) => ({ status: 201, body: r }))],
    ['DELETE', new RegExp(`${keys}/([^/]+)$`), ([w, id]) =>
      requireStore(apiKeyStore).revokeKey({ id, workspaceId: w }).then((r) => ({ status: 200, body: r }))],

    // ---- Workspace documentation (console docs page + custom notes) ----
    // The docs page is a control-plane route, not a data-plane route; keep it in the runtime route
    // table so deployed executor images do not fall through to NO_ROUTE when the gateway forwards
    // /v1/workspaces/{workspaceId}/docs here (#795).
    ['GET', new RegExp(`${wdocs}$`), ([w], c) =>
      runWorkspaceDocs(workspaceDocsDb, c, { mongoExecutor, functionsExecutor, realtimeExecutor, pgRealtimeExecutor }, w)],
    ['POST', new RegExp(`${wdocs}/notes$`), ([w], c) =>
      runWorkspaceDocs(workspaceDocsDb, c, { mongoExecutor, functionsExecutor, realtimeExecutor, pgRealtimeExecutor }, w)],
    ['PUT', new RegExp(`${wdocs}/notes/([^/]+)$`), ([w], c) =>
      runWorkspaceDocs(workspaceDocsDb, c, { mongoExecutor, functionsExecutor, realtimeExecutor, pgRealtimeExecutor }, w)],
    ['DELETE', new RegExp(`${wdocs}/notes/([^/]+)$`), ([w], c) =>
      runWorkspaceDocs(workspaceDocsDb, c, { mongoExecutor, functionsExecutor, realtimeExecutor, pgRealtimeExecutor }, w)],

    // ---- Postgres data rows (CRUD + bulk) ----
    ['GET', new RegExp(`${data}/rows$`), ([w, db, s, t], c) =>
      run(registry, executePostgresData, { workspaceId: w, databaseName: db, schemaName: s, tableName: t, identity: c.identity, operation: 'list',
        select: c.url.searchParams.get('select') ?? undefined,
        order: c.url.searchParams.get('order') ?? undefined,
        filters: filtersFromQuery(c.url.searchParams),
        page: pageFromQuery(c.url.searchParams),
        countMode: c.url.searchParams.get('countMode') ?? undefined }, 200)],
    // Insert/bulk-insert/update thread embeddingExecutor + mappingStore so the write-path
    // auto-embed hook fires when a per-collection mapping is configured (no-op otherwise).
    ['POST', new RegExp(`${data}/rows$`), ([w, db, s, t], c) =>
      run(registry, executePostgresData, { workspaceId: w, databaseName: db, schemaName: s, tableName: t, identity: c.identity, operation: 'insert', values: c.body.row ?? c.body.values ?? c.body, embeddingExecutor, mappingStore }, 201)],
    // The public route catalog documents bulk insert at `.../tables/{t}/bulk/insert`; accept both
    // that and the `.../rows/bulk/insert` form so a gateway-proxied catalog path does not 404.
    ['POST', new RegExp(`${data}/(?:rows/)?bulk/insert$`), ([w, db, s, t], c) =>
      run(registry, executePostgresData, { workspaceId: w, databaseName: db, schemaName: s, tableName: t, identity: c.identity, operation: 'bulk_insert', rows: c.body.rows ?? c.body.items, embeddingExecutor, mappingStore }, 201)],
    ['GET', new RegExp(`${data}/rows/by-primary-key$`), ([w, db, s, t], c) =>
      run(registry, executePostgresData, { workspaceId: w, databaseName: db, schemaName: s, tableName: t, identity: c.identity, operation: 'get', primaryKey: primaryKeyFromQuery(c.url.searchParams) }, 200)],
    ['PATCH', new RegExp(`${data}/rows/by-primary-key$`), ([w, db, s, t], c) =>
      run(registry, executePostgresData, { workspaceId: w, databaseName: db, schemaName: s, tableName: t, identity: c.identity, operation: 'update', primaryKey: primaryKeyFromQuery(c.url.searchParams), changes: c.body.changes ?? c.body, embeddingExecutor, mappingStore }, 200)],
    ['DELETE', new RegExp(`${data}/rows/by-primary-key$`), ([w, db, s, t], c) =>
      run(registry, executePostgresData, { workspaceId: w, databaseName: db, schemaName: s, tableName: t, identity: c.identity, operation: 'delete', primaryKey: primaryKeyFromQuery(c.url.searchParams) }, 200)],

    // ---- Vector search (KNN over a vector(N) column) ----
    // queryVector OR queryText (in-platform embedding); RLS-scoped under falcone_app.
    ['POST', new RegExp(`${data}/search$`), ([w, db, s, t], c) =>
      run(registry, executePostgresData, {
        workspaceId: w, databaseName: db, schemaName: s, tableName: t, identity: c.identity, operation: 'knn_search',
        queryVector: c.body.queryVector, queryText: c.body.queryText, vectorColumn: c.body.vectorColumn,
        metric: c.body.metric, topK: c.body.topK, filter: c.body.filter ?? c.body.filters, select: c.body.select,
        embeddingExecutor,
      }, 200)],

    // ---- Postgres DDL (schema/table/column/index) ----
    ['POST', new RegExp(`${ddl}$`), ([db], c) =>
      runDdl(registry, 'schema', { databaseName: db, schemaName: c.body.schemaName ?? c.body.name }, c)],
    ['POST', new RegExp(`${ddl}/([^/]+)/tables$`), ([db, s], c) =>
      runDdl(registry, 'table', { databaseName: db, schemaName: s, ...c.body }, c)],
    ['POST', new RegExp(`${ddl}/([^/]+)/tables/([^/]+)/columns$`), ([db, s, t], c) =>
      runDdl(registry, 'column', { databaseName: db, schemaName: s, tableName: t, ...c.body }, c)],
    ['POST', new RegExp(`${ddl}/([^/]+)/tables/([^/]+)/indexes$`), ([db, s, t], c) =>
      runDdl(registry, 'index', { databaseName: db, schemaName: s, tableName: t, ...c.body }, c)],
    // Vector index management → the same DDL executor (structural index plan with
    // indexMethod hnsw|ivfflat + metric → opclass). Create + delete.
    ['POST', new RegExp(`${ddl}/([^/]+)/tables/([^/]+)/vector-indexes$`), ([db, s, t], c) =>
      runDdl(registry, 'index', { databaseName: db, schemaName: s, tableName: t, indexMethod: c.body.indexType ?? c.body.indexMethod ?? 'hnsw', ...c.body }, c)],
    ['DELETE', new RegExp(`${ddl}/([^/]+)/tables/([^/]+)/vector-indexes/([^/]+)$`), ([db, s, t, idx], c) =>
      runDdlAction(registry, 'index', 'delete', { databaseName: db, schemaName: s, tableName: t, indexName: idx }, c)],
    ['POST', new RegExp(`${ddl}/([^/]+)/tables/([^/]+)/policies$`), ([db, s, t], c) =>
      runDdl(registry, 'policy', { databaseName: db, schemaName: s, tableName: t, ...c.body }, c)],
    ['POST', new RegExp(`${ddl}/([^/]+)/tables/([^/]+)/security$`), ([db, s, t], c) =>
      runDdl(registry, 'table_security', { databaseName: db, schemaName: s, tableName: t, ...c.body }, c)],

    // ---- MongoDB documents (CRUD) ----
    ['GET', new RegExp(`${mdoc}$`), ([w, db, coll], c) =>
      runMongo(mongoExecutor, { workspaceId: w, databaseName: db, collectionName: coll, identity: c.identity, operation: 'list',
        filter: jsonQueryParam(c.url.searchParams, 'filter'),
        sort: jsonQueryParam(c.url.searchParams, 'sort'),
        page: pageFromQuery(c.url.searchParams) }, 200)],
    ['POST', new RegExp(`${mdoc}$`), ([w, db, coll], c) =>
      runMongo(mongoExecutor, { workspaceId: w, databaseName: db, collectionName: coll, identity: c.identity, operation: 'insert', payload: { document: c.body.document ?? c.body } }, 201)],
    ['GET', new RegExp(`${mdoc}/([^/]+)$`), ([w, db, coll, id], c) =>
      runMongo(mongoExecutor, { workspaceId: w, databaseName: db, collectionName: coll, identity: c.identity, operation: 'get', documentId: id }, 200)],
    ['PATCH', new RegExp(`${mdoc}/([^/]+)$`), ([w, db, coll, id], c) =>
      runMongo(mongoExecutor, { workspaceId: w, databaseName: db, collectionName: coll, identity: c.identity, operation: 'update', documentId: id, payload: { update: c.body.update ?? c.body } }, 200)],
    ['PUT', new RegExp(`${mdoc}/([^/]+)$`), ([w, db, coll, id], c) =>
      runMongo(mongoExecutor, { workspaceId: w, databaseName: db, collectionName: coll, identity: c.identity, operation: 'replace', documentId: id, payload: { document: c.body.document ?? c.body } }, 200)],
    ['DELETE', new RegExp(`${mdoc}/([^/]+)$`), ([w, db, coll, id], c) =>
      runMongo(mongoExecutor, { workspaceId: w, databaseName: db, collectionName: coll, identity: c.identity, operation: 'delete', documentId: id }, 200)],

    // ---- Events (Kafka): topics + publish + consume (workspace-scoped) ----
    ['GET', new RegExp(`${evt}$`), ([w], c) =>
      runEvents(eventsExecutor, { workspaceId: w, identity: c.identity, operation: 'list_topics' }, 200)],
    ['POST', new RegExp(`${evt}$`), ([w], c) =>
      runEvents(eventsExecutor, { workspaceId: w, identity: c.identity, operation: 'create_topic', topic: c.body.name ?? c.body.topic, payload: c.body }, 201)],
    ['POST', new RegExp(`${evt}/([^/]+)/publish$`), ([w, topic], c) =>
      runEvents(eventsExecutor, { workspaceId: w, identity: c.identity, operation: 'publish', topic, payload: c.body }, 202)],
    ['GET', new RegExp(`${evt}/([^/]+)/messages$`), ([w, topic], c) =>
      runEvents(eventsExecutor, { workspaceId: w, identity: c.identity, operation: 'consume', topic, payload: { maxMessages: Number(c.url.searchParams.get('maxMessages') ?? 10), timeoutMs: Number(c.url.searchParams.get('timeoutMs') ?? 3000) } }, 200)],

    // ---- Functions: deploy / list / get / invoke / activations (workspace-scoped) ----
    ['GET', new RegExp(`${fn}$`), ([w], c) =>
      runFunctions(functionsExecutor, { workspaceId: w, identity: c.identity, operation: 'list' }, 200)],
    ['POST', new RegExp(`${fn}$`), ([w], c) =>
      runFunctions(functionsExecutor, { workspaceId: w, identity: c.identity, operation: 'deploy', name: c.body.name, payload: c.body }, 201)],
    ['GET', new RegExp(`${fn}/([^/]+)$`), ([w, name], c) =>
      runFunctions(functionsExecutor, { workspaceId: w, identity: c.identity, operation: 'get', name }, 200)],
    ['POST', new RegExp(`${fn}/([^/]+)/invocations$`), ([w, name], c) =>
      runFunctions(functionsExecutor, { workspaceId: w, identity: c.identity, operation: 'invoke', name, payload: c.body }, 200)],
    ['GET', new RegExp(`${fn}/([^/]+)/activations$`), ([w, name], c) =>
      runFunctions(functionsExecutor, { workspaceId: w, identity: c.identity, operation: 'activations', name }, 200)],

    // ---- Embedding provider (workspace-scoped): set / remove (structural admin) ----
    // The verified identity's tenantId is injected so the Postgres-backed store keys the
    // record by (tenant_id, workspace_id) — never trusting a tenantId in the request body.
    ['PUT', new RegExp(`${emb}$`), ([w], c) =>
      runEmbeddingProvider(embeddingExecutor, 'set', { workspaceId: w, tenantId: c.identity.tenantId, config: c.body }, 200)],
    ['GET', new RegExp(`${emb}$`), ([w], c) =>
      runEmbeddingProvider(embeddingExecutor, 'get', { workspaceId: w, tenantId: c.identity.tenantId }, 200)],
    ['DELETE', new RegExp(`${emb}$`), ([w], c) =>
      runEmbeddingProvider(embeddingExecutor, 'remove', { workspaceId: w, tenantId: c.identity.tenantId }, 200)],

    // ---- BYOK LLM provider config + completion + usage (workspace-scoped) — change #640 ----
    // The verified identity's tenantId is injected so the store keys the record by
    // (tenant_id, workspace_id) and usage is metered per tenant — never trusting a body tenantId.
    ['PUT', new RegExp(`${llmp}$`), ([w], c) =>
      runLlmProvider(llmExecutor, 'set', { workspaceId: w, tenantId: c.identity.tenantId, config: c.body }, 200)],
    ['GET', new RegExp(`${llmp}$`), ([w], c) =>
      runLlmProvider(llmExecutor, 'get', { workspaceId: w, tenantId: c.identity.tenantId }, 200)],
    ['DELETE', new RegExp(`${llmp}$`), ([w], c) =>
      runLlmProvider(llmExecutor, 'remove', { workspaceId: w, tenantId: c.identity.tenantId }, 200)],
    ['GET', new RegExp(`${llmu}$`), ([w], c) =>
      runLlmUsage(llmExecutor, { workspaceId: w, tenantId: c.identity.tenantId }, 200)],
    // The completion route OWNS the response so it can stream SSE when `stream:true` and otherwise
    // write a single JSON body. { sse: true } routes the dispatcher to pass (req,res) to the handler.
    ['POST', new RegExp(`${llmc}$`), ([w], c) =>
      runLlmComplete(llmExecutor, { workspaceId: w, tenantId: c.identity.tenantId }, c), { sse: true }],

    // ---- Per-collection embedding mapping (table-scoped): set / get / remove (structural
    // admin). The verified identity's tenantId is injected so the Postgres-backed store keys
    // the record by (tenant_id, workspace_id, schema, table, target_column) — never trusting a
    // tenantId in the request body.
    ['PUT', new RegExp(`${data}/embedding-mapping$`), ([w, db, s, t], c) =>
      runEmbeddingMapping(mappingStore, 'set', { workspaceId: w, tenantId: c.identity.tenantId, schemaName: s, tableName: t, config: c.body }, 200)],
    ['GET', new RegExp(`${data}/embedding-mapping$`), ([w, db, s, t], c) =>
      runEmbeddingMapping(mappingStore, 'get', { workspaceId: w, tenantId: c.identity.tenantId, schemaName: s, tableName: t, targetColumn: c.url.searchParams.get('targetColumn') ?? undefined }, 200)],
    ['DELETE', new RegExp(`${data}/embedding-mapping$`), ([w, db, s, t], c) =>
      runEmbeddingMapping(mappingStore, 'remove', { workspaceId: w, tenantId: c.identity.tenantId, schemaName: s, tableName: t, targetColumn: c.url.searchParams.get('targetColumn') ?? undefined }, 200)],

    // ---- Realtime: subscribe to tenant-scoped changes (SSE stream) ----
    // Mongo collection change stream:
    ['GET', new RegExp(`${rt}$`), ([w, db, coll], c) =>
      runRealtimeSse(realtimeExecutor, { workspaceId: w, databaseName: db, collectionName: coll }, c), { sse: true }],
    // Postgres table change capture (trigger + LISTEN/NOTIFY):
    ['GET', new RegExp(`${pgrt}$`), ([w, db, s, t], c) =>
      runRealtimeSse(pgRealtimeExecutor, { workspaceId: w, databaseName: db, schemaName: s, tableName: t }, c), { sse: true }],

    // ---- Flows (Temporal-backed authoring + execution) — only when flowExecutor is wired ----
    // Definition management (control class). Identity (tenant/workspace) comes ONLY from
    // resolveIdentity; the workspaceId path segment is the public-surface address, never the
    // tenant authority.
    ...(flowExecutor ? [
      // Task-type catalog — the designer palette source (driven by the activity registry).
      ['GET', new RegExp(`${flt}$`), ([w], c) =>
        runFlows(flowExecutor, { operation: 'list_task_types', identity: c.identity }, 200)],
      ['GET', new RegExp(`${fl}$`), ([w], c) =>
        runFlows(flowExecutor, { operation: 'list_definitions', identity: c.identity }, 200)],
      ['POST', new RegExp(`${fl}$`), ([w], c) =>
        runFlows(flowExecutor, { operation: 'create_definition', identity: c.identity, body: c.body }, 201)],
      ['GET', new RegExp(`${fl}/([^/]+)$`), ([w, f], c) =>
        runFlows(flowExecutor, { operation: 'get_definition', identity: c.identity, flowId: f }, 200)],
      ['PATCH', new RegExp(`${fl}/([^/]+)$`), ([w, f], c) =>
        runFlows(flowExecutor, { operation: 'update_definition', identity: c.identity, flowId: f, body: c.body }, 200)],
      ['DELETE', new RegExp(`${fl}/([^/]+)$`), ([w, f], c) =>
        runFlows(flowExecutor, { operation: 'delete_definition', identity: c.identity, flowId: f }, 200)],
      ['POST', new RegExp(`${fl}/([^/]+)/validate$`), ([w, f], c) =>
        runFlows(flowExecutor, { operation: 'validate', identity: c.identity, flowId: f }, 200)],
      ['POST', new RegExp(`${fl}/([^/]+)/versions$`), ([w, f], c) =>
        runFlows(flowExecutor, { operation: 'publish_version', identity: c.identity, flowId: f }, 201)],
      ['GET', new RegExp(`${fl}/([^/]+)/versions$`), ([w, f], c) =>
        runFlows(flowExecutor, { operation: 'list_versions', identity: c.identity, flowId: f }, 200)],
      ['GET', new RegExp(`${fl}/([^/]+)/versions/([^/]+)$`), ([w, f, v], c) =>
        runFlows(flowExecutor, { operation: 'get_version', identity: c.identity, flowId: f, version: Number(v) }, 200)],

      // Execution lifecycle (data-control class).
      ['POST', new RegExp(`${fl}/([^/]+)/executions$`), ([w, f], c) =>
        runFlows(flowExecutor, { operation: 'start_execution', identity: c.identity, flowId: f, version: c.body.version, input: c.body.input }, 201)],
      ['GET', new RegExp(`${fl}/([^/]+)/executions$`), ([w, f], c) =>
        runFlows(flowExecutor, {
          operation: 'list_executions', identity: c.identity, flowId: f,
          status: c.url.searchParams.get('status') ?? undefined,
          // A client-supplied visibility query/filter is captured but NEVER trusted: the executor
          // strips any tenantId/workspaceId clause and AND-joins its own tenant boundary (D2).
          query: c.url.searchParams.get('query') ?? c.url.searchParams.get('filter') ?? undefined,
        }, 200)],
      ['GET', new RegExp(`${fl}/([^/]+)/executions/([^/]+)$`), ([w, f, e], c) =>
        runFlows(flowExecutor, { operation: 'get_execution', identity: c.identity, flowId: f, executionId: decodeURIComponent(e) }, 200)],
      ['POST', new RegExp(`${fl}/([^/]+)/executions/([^/]+)/cancellations$`), ([w, f, e], c) =>
        runFlows(flowExecutor, { operation: 'cancel_execution', identity: c.identity, flowId: f, executionId: decodeURIComponent(e) }, 202)],
      ['POST', new RegExp(`${fl}/([^/]+)/executions/([^/]+)/retries$`), ([w, f, e], c) =>
        runFlows(flowExecutor, { operation: 'retry_execution', identity: c.identity, flowId: f, executionId: decodeURIComponent(e) }, 201)],
      ['POST', new RegExp(`${fl}/([^/]+)/executions/([^/]+)/signals/([^/]+)$`), ([w, f, e, s], c) =>
        runFlows(flowExecutor, { operation: 'send_signal', identity: c.identity, flowId: f, executionId: decodeURIComponent(e), signalName: decodeURIComponent(s), payload: c.body }, 202)],

      // ---- Flow schedule management (change: add-flow-schedule-management-api / #680) ----
      // Operate in place on a flow's cron Temporal Schedule (created on publish): list / get /
      // pause / resume / trigger an ad-hoc run, WITHOUT deleting the flow definition. Identity
      // (tenant) comes ONLY from resolveIdentity; the workspaceId path segment is validated to
      // belong to the caller's tenant by the request gate BEFORE the handler runs. The executor
      // builds the schedule id from the verified tenant + validated workspace, so a foreign flowId
      // resolves to a non-existent id -> 404 SCHEDULE_NOT_FOUND (no cross-tenant exposure). The
      // list op filters Temporal's namespace-wide listing by the `{tenant}:{ws}:` id prefix.
      ['GET', new RegExp(`${fls}$`), ([w], c) =>
        runFlows(flowExecutor, { operation: 'list_schedules', identity: c.identity }, 200)],
      ['GET', new RegExp(`${fl}/([^/]+)/schedule$`), ([w, f], c) =>
        runFlows(flowExecutor, { operation: 'get_schedule', identity: c.identity, flowId: f }, 200)],
      ['POST', new RegExp(`${fl}/([^/]+)/schedule/pause$`), ([w, f], c) =>
        runFlows(flowExecutor, { operation: 'pause_schedule', identity: c.identity, flowId: f }, 200)],
      ['POST', new RegExp(`${fl}/([^/]+)/schedule/resume$`), ([w, f], c) =>
        runFlows(flowExecutor, { operation: 'resume_schedule', identity: c.identity, flowId: f }, 200)],
      ['POST', new RegExp(`${fl}/([^/]+)/schedule/trigger$`), ([w, f], c) =>
        runFlows(flowExecutor, { operation: 'trigger_schedule', identity: c.identity, flowId: f }, 202)],

      // ---- Inbound webhook trigger ingestion (HMAC-authenticated) ----
      // The handler verifies the per-trigger HMAC over the RAW body BEFORE any Temporal call; an
      // invalid/missing signature is 401 (no run started). A valid signature starts the bound flow
      // (202); a replayed delivery id is an idempotent 202 (no second run). { webhook:true } makes
      // the dispatcher read the raw body + signature/delivery headers instead of the JSON path.
      ['POST', new RegExp(`${fwh}$`), ([w, t], c) =>
        runFlows(flowExecutor, {
          operation: 'webhook_trigger', identity: c.identity, triggerId: decodeURIComponent(t),
          rawBody: c.rawBody, signatureHeader: c.signatureHeader, deliveryId: c.deliveryId, payload: c.payload,
        }, 202), { webhook: true }],
    ] : []),

    // ---- Flow execution monitoring (SSE stream) — only when a flowMonitoringExecutor is wired ----
    // Follows a single Temporal execution's history and streams node-status / log-line frames to
    // the console run view. { sse: true } activates ?apikey= query auth (EventSource can't set
    // headers) and the streaming response path. Tenant isolation is enforced fail-closed IN the
    // executor (workflow-id prefix check) BEFORE any history is fetched — see runFlowMonitoringSse.
    // The path mirrors the addressing under /v1/flows/workspaces/{ws}/executions/{executionId}.
    ...(flowMonitoringExecutor ? [
      ['GET', /^\/v1\/flows\/workspaces\/([^/]+)\/executions\/([^/]+)\/events$/, ([w, e], c) =>
        runFlowMonitoringSse(flowMonitoringExecutor, { workspaceId: w, executionId: decodeURIComponent(e) }, c), { sse: true }],
    ] : []),

    // ---- MCP server hosting management (create → curate → publish → approve → call → observe) ----
    // Registered only when an mcpEngine is injected (MCP_ENABLED). Tenant/workspace come from the
    // verified identity (resolveIdentity), never from tool arguments; the engine keys all state by
    // identity.tenantId so a cross-tenant read/call/audit resolves to 404 / empty.
    ...(mcpEngine ? [
      ['GET', new RegExp(`${mcp}$`), ([w], c) =>
        runMcp(mcpEngine, { operation: 'list_servers', identity: c.identity, workspaceId: w }, 200, knativeRuntime, mcpRuntimeCleaner)],
      ['POST', new RegExp(`${mcp}$`), ([w], c) =>
        runMcp(mcpEngine, { operation: 'create_server', identity: c.identity, workspaceId: w, body: c.body, correlationId: c.headers['x-correlation-id'] }, 202, knativeRuntime, mcpRuntimeCleaner)],
      ['GET', new RegExp(`${mcp}/([^/]+)$`), ([w, s], c) =>
        runMcp(mcpEngine, { operation: 'get_server', identity: c.identity, workspaceId: w, serverId: s }, 200, knativeRuntime, mcpRuntimeCleaner)],
      ['DELETE', new RegExp(`${mcp}/([^/]+)$`), ([w, s], c) =>
        runMcp(mcpEngine, { operation: 'delete_server', identity: c.identity, workspaceId: w, serverId: s, correlationId: c.headers['x-correlation-id'] }, 200, knativeRuntime, mcpRuntimeCleaner)],
      ['POST', new RegExp(`${mcp}/([^/]+)/curations$`), ([w, s], c) =>
        runMcp(mcpEngine, { operation: 'curate_server', identity: c.identity, workspaceId: w, serverId: s, body: c.body }, 200, knativeRuntime, mcpRuntimeCleaner)],
      ['POST', new RegExp(`${mcp}/([^/]+)/versions$`), ([w, s], c) =>
        runMcp(mcpEngine, { operation: 'publish_version', identity: c.identity, workspaceId: w, serverId: s, version: c.body.version, body: { ...c.body, correlationId: c.headers['x-correlation-id'] }, correlationId: c.headers['x-correlation-id'] }, 201, knativeRuntime, mcpRuntimeCleaner)],
      ['POST', new RegExp(`${mcp}/([^/]+)/versions/([^/]+)/approval$`), ([w, s, v], c) =>
        runMcp(mcpEngine, { operation: 'approve_version', identity: c.identity, workspaceId: w, serverId: s, version: decodeURIComponent(v), correlationId: c.headers['x-correlation-id'] }, 200, knativeRuntime, mcpRuntimeCleaner)],
      ['POST', new RegExp(`${mcp}/([^/]+)/tool-calls$`), ([w, s], c) =>
        runMcp(mcpEngine, { operation: 'call_tool', identity: c.identity, workspaceId: w, serverId: s, body: c.body, correlationId: c.headers['x-correlation-id'] }, 200, knativeRuntime, mcpRuntimeCleaner)],
      // Standard MCP wire protocol (JSON-RPC 2.0 over HTTP POST) for an external MCP client
      // (add-mcp-jsonrpc-protocol, #608). The request body is the JSON-RPC message; the server is
      // resolved from the credential-derived identity + the URL serverId (cross-tenant → 404 in the
      // engine). Distinct from the REST tool-calls route above; covered by the same gateway
      // /v1/mcp/* route, so no APISIX change is needed.
      ['POST', new RegExp(`${mcp}/([^/]+)/rpc$`), ([w, s], c) =>
        runMcpRpc(mcpEngine, { identity: c.identity, workspaceId: w, serverId: s, message: c.body, correlationId: c.headers['x-correlation-id'] }, knativeRuntime)],
      ['GET', new RegExp(`${mcp}/([^/]+)/audit$`), ([w, s], c) =>
        runMcp(mcpEngine, { operation: 'list_audit', identity: c.identity, workspaceId: w, serverId: s }, 200, knativeRuntime, mcpRuntimeCleaner)],
    ] : []),

    // ---- Platform (first-party) MCP server — JSON-RPC over HTTP (add-platform-mcp-http-route;
    //      completeness add-control-mcp-completeness, #642) ----
    // A single Streamable-HTTP JSON-RPC endpoint that exposes the official Falcone management tools
    // (mcp-official-catalog.mjs) so an MCP client can manage projects/resources. Registered only when
    // a control-plane upstream is configured (so the executor can fall through to it). Tool calls are
    // dispatched against THIS executor's own loopback base (`mcpSelfBaseUrl`): routes the executor
    // serves (api-keys, embedding, flows, mcp-hosting) are handled locally and everything else falls
    // through to the control-plane (server.mjs:proxyRequest) — so EVERY management family is reachable
    // through one path. The tenant is credential-derived (resolveIdentity) — NEVER from tool
    // arguments. Distinct from the workspace MCP-hosting routes (/v1/mcp/workspaces/...).
    ...(controlPlaneUpstream ? [
      ['POST', /^\/v1\/mcp\/rpc$/, (_groups, c) => runPlatformMcp(c, mcpSelfBaseUrl ?? controlPlaneUpstream, mcpConfig ?? mcpConfigStore)],
    ] : []),
  ];
}

// Platform MCP JSON-RPC dispatcher: hand the request message to the first-party MCP handler with a
// control-plane client bound to the caller's own credential, so every tool call the MCP makes is
// authorized + tenant-scoped exactly as if the caller had hit the API directly. The bearer token is
// forwarded so the served route re-verifies the same identity.
//
// Scopes: the verified identity's scopes plus an auto-granted BASE_SCOPE — reaching this endpoint
// means the caller is an authenticated principal, so the base "may use the MCP server" scope is
// granted when the server is enabled (or always for a superadmin, so a disabled server can be
// re-enabled). Mutating tools still require their explicit mcp:falcone:* scope from the token.
// Always 200 at the HTTP layer — JSON-RPC carries success/errors in the response envelope.
async function runPlatformMcp(c, upstream, config) {
  const scopes = new Set(Array.isArray(c.identity?.scopes) ? c.identity.scopes : []);
  const roles = Array.isArray(c.identity?.roles) ? c.identity.roles : [];
  const isSuperadmin = roles.some((r) => MCP_SUPERADMIN_ROLES.has(r));
  if (config.isServerEnabled() || isSuperadmin) scopes.add(BASE_SCOPE);
  const callFalcone = async (method, path, body) => {
    // SSRF-safe: `upstream` host/port are fixed (this executor's loopback / the control-plane); the
    // path is a first-party catalog template, encodeURIComponent'd per segment in the handler.
    const target = new URL(path, upstream);
    const resp = await fetch(target, {
      method,
      headers: {
        ...(c.authorization ? { authorization: c.authorization } : {}),
        'content-type': 'application/json',
      },
      body: body !== undefined && body !== null ? JSON.stringify(body) : undefined,
    });
    const text = await resp.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    // Surface the upstream status alongside the body so the MCP tool result is self-describing
    // (a 401/403/404 from the served route reaches the MCP client as content, not a 500).
    return resp.ok ? parsed : { error: { status: resp.status, body: parsed } };
  };
  const result = await handleMcpMessage(c.body, {
    grantedScopes: [...scopes], roles, tenantId: c.identity?.tenantId, callFalcone, config,
  });
  return { status: 200, body: result };
}

// Stream a single Temporal execution's history to the client as Server-Sent Events. Like
// runRealtimeSse it owns the response (no sendJson) and cleans up on client disconnect; it adds
// an `id:` line per frame (Last-Event-ID resume) and a terminal `event: stream-end` frame. The
// fail-closed tenant check lives in the executor's subscribe() and throws BEFORE any history is
// touched: a 403 on a foreign workflow id is propagated as a hard HTTP 403 (no stream opened).
async function runFlowMonitoringSse(flowMonitoringExecutor, target, c) {
  if (!flowMonitoringExecutor) throw Object.assign(new Error('Flow monitoring is not enabled'), { statusCode: 501, code: 'FLOW_MONITORING_DISABLED' });
  const { req, res, identity } = c;
  const lastEventId = req.headers['last-event-id'];
  const controller = new AbortController();
  let started = false;
  let sub;
  let ping;
  const stop = () => { if (ping) clearInterval(ping); controller.abort(); void sub?.close?.(); };
  req.on('close', stop);

  const ensureStarted = () => {
    if (started) return;
    started = true;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no', // ask proxies (nginx/APISIX) not to buffer the stream
    });
    res.write('retry: 3000\n\n');
    ping = setInterval(() => res.write(': ping\n\n'), 25000);
  };

  try {
    sub = await flowMonitoringExecutor.subscribe({
      ...target,
      identity,
      lastEventId,
      signal: controller.signal,
      onEvent: (event) => {
        // The tenant check passed (subscribe did not throw) → safe to open the stream.
        ensureStarted();
        const idLine = event.id != null ? `id: ${event.id}\n` : '';
        res.write(`event: ${event.type}\n${idLine}data: ${JSON.stringify(event)}\n\n`);
        if (event.type === 'stream-end') { stop(); res.end(); }
      },
      onError: () => {
        ensureStarted();
        res.write('event: error\ndata: {"code":"FLOW_MONITORING_STREAM_ERROR"}\n\n');
      },
    });
    if (controller.signal.aborted) void sub.close?.();
  } catch (err) {
    // A pre-stream rejection (403 foreign workflow id / 401 identity) must surface as an HTTP
    // status, NOT a 200 stream — the stream was never opened (ensureStarted not called).
    if (!started && !res.headersSent) {
      const statusCode = err.statusCode ?? 500;
      const payload = JSON.stringify({ code: err.code ?? 'FLOW_MONITORING_ERROR', message: statusCode >= 500 ? 'Internal server error' : err.message });
      res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) });
      res.end(payload);
    } else {
      res.write(`event: error\ndata: ${JSON.stringify({ code: err.code ?? 'FLOW_MONITORING_ERROR' })}\n\n`);
      stop();
      res.end();
    }
  }
}

// Dispatch a flows operation through the flow executor. A FLOW_VALIDATION_FAILED error carries
// a node-scoped `errors` array which is surfaced on the 422 envelope (see the error handler).
async function runFlows(flowExecutor, params, successStatus) {
  if (!flowExecutor) throw Object.assign(new Error('Flows are not enabled'), { statusCode: 501, code: 'FLOWS_DISABLED' });
  const result = await flowExecutor.executeFlows(params);
  return { status: successStatus, body: result };
}

// Dispatch an MCP management operation through the engine. Quota/rate-limit breaches throw with
// { statusCode, code, dimension } — surfaced by the central error handler (which already echoes
// err.dimension on the 429 envelope). Cross-tenant reads surface as 404 (MCP_SERVER_NOT_FOUND).
const MCP_RUNTIME_OPERATION = Object.freeze({ publish_version: 'publish', approve_version: 'activate', call_tool: 'invoke', delete_server: 'delete' });

function mcpRuntimeDependency(runtime) {
  const status = runtime.status();
  return { mode: status.mode, state: status.state, reason: status.reason, ready: runtime.canServeWorkloads(status) };
}

async function recordMcpUnavailable(mcpEngine, params, status, correlationId, operation, action = 'runtime_unavailable', outcome = 'failed') {
  await mcpEngine.executeMcp({
    operation: 'record_dependency_event',
    identity: params.identity,
    workspaceId: params.workspaceId,
    serverId: params.serverId,
    body: { action, outcome, operation, correlationId, runtime: status },
  });
  recordMcpDependency({ operation, outcome: action === 'cleanup_deferred' ? 'deferred' : 'unavailable', ...status });
}

async function runMcp(mcpEngine, params, successStatus, runtime, runtimeCleaner) {
  if (!mcpEngine) throw Object.assign(new Error('MCP hosting is not enabled'), { statusCode: 501, code: 'MCP_DISABLED' });
  const operation = MCP_RUNTIME_OPERATION[params.operation];
  if (operation || params.serverId) await mcpEngine.assertOwnedServer(params);
  const dependency = mcpRuntimeDependency(runtime);
  if (!operation) {
    const result = await mcpEngine.executeMcp({ ...params, runtimeDependency: dependency });
    if (params.operation === 'create_server') {
      const correlationId = params.correlationId ?? randomUUID();
      return { status: 202, body: { acceptedAt: new Date().toISOString(), correlationId, family: 'mcp', requestId: correlationId, resourceId: result.serverId, resourceType: 'mcp_server', status: 'accepted' } };
    }
    return { status: successStatus, body: result };
  }

  // Server ownership is resolved before dependency status so adjacent tenants cannot use an outage
  // to discover that a foreign hosted server exists.
  if (!dependency.ready) {
    const correlationId = params.correlationId ?? randomUUID();
    if (params.operation === 'delete_server') {
      const pending = await mcpEngine.deferServerDeletion({ ...params, correlationId, runtime: dependency });
      recordMcpDependency({ operation: 'delete', outcome: 'deferred', ...dependency });
      return { status: 202, body: pending };
    }
    await recordMcpUnavailable(mcpEngine, params, dependency, correlationId, operation);
    return { status: 503, body: knativeUnavailableResponse(dependency, correlationId) };
  }
  if (params.operation === 'delete_server' && runtimeCleaner?.deleteOwnedRuntimeResources) {
    try {
      await runtimeCleaner.deleteOwnedRuntimeResources({
        tenantId: params.identity.tenantId,
        workspaceId: params.workspaceId,
        resourceId: params.serverId,
        runtimeResourceName: `mcp-${params.serverId}`,
      });
    } catch (cleanupError) {
      // A Kubernetes authorization/transport error, unsafe object identity, replacement conflict,
      // or failed absence verification must never remove the logical owner. Persist the same
      // idempotent obligation used for outage deletion before acknowledging the request as pending.
      const correlationId = params.correlationId ?? randomUUID();
      try {
        const pending = await mcpEngine.deferServerDeletion({
          ...params,
          correlationId,
          runtime: {
            ...dependency,
            reason: cleanupError.code ?? 'MCP_RUNTIME_CLEANUP_UNVERIFIED',
          },
        });
        recordMcpDependency({ operation: 'delete', outcome: 'deferred', ...dependency });
        return { status: 202, body: pending };
      } catch (storageError) {
        cleanupError.cause = storageError;
        throw cleanupError;
      }
    }
  }
  const result = await mcpEngine.executeMcp(params);
  if (params.operation === 'call_tool') return { status: successStatus, body: { content: result.content ?? [], isError: result.result?.isError === true } };
  if (params.operation === 'create_server') {
    const correlationId = params.correlationId ?? randomUUID();
    return { status: 202, body: {
      acceptedAt: new Date().toISOString(), correlationId,
      family: 'mcp', requestId: correlationId, resourceId: result.serverId,
      resourceType: 'mcp_server', status: 'accepted',
    } };
  }
  return { status: result?.status === 'deletion_pending' ? 202 : successStatus, body: result };
}

// Hosted-server MCP JSON-RPC dispatcher (add-mcp-jsonrpc-protocol, #608). Always 200 at the HTTP
// layer for a request (id present) — JSON-RPC carries success/errors in the envelope; a notification
// (no id) is acknowledged with 202 and no body. Unauthenticated/cross-tenant access is rejected by
// the dispatch identity gate (401) and the engine's per-tenant server lookup before reaching here.
async function runMcpRpc(mcpEngine, params, runtime) {
  if (!mcpEngine) throw Object.assign(new Error('MCP hosting is not enabled'), { statusCode: 501, code: 'MCP_DISABLED' });
  if (params.identity?.hostedMcpWorkspaceBindingDenied) {
    // Preserve JSON-RPC's HTTP transport semantics while denying the singular workspace mismatch
    // before server lookup, dependency probing, or tool dispatch. The response is tenant-safe and
    // indistinguishable from another unavailable-to-this-principal server.
    if (params.message?.id === undefined || params.message?.id === null) return { status: 202, body: null };
    return {
      status: 200,
      body: {
        jsonrpc: '2.0',
        id: params.message.id,
        error: { code: -32001, message: 'No such MCP server for this tenant/workspace.' },
      },
    };
  }
  const result = await mcpEngine.executeMcpRpc({
    ...params,
    beforeDispatch: async () => {
      const dependency = mcpRuntimeDependency(runtime);
      if (dependency.ready) return;
      const correlationId = params.correlationId ?? randomUUID();
      await recordMcpUnavailable(mcpEngine, params, dependency, correlationId, 'invoke');
      throw Object.assign(new Error('Hosted MCP runtime is unavailable.'), {
        rpcCode: -32005,
        rpcMessage: 'Hosted MCP runtime is unavailable.',
        rpcData: {
          code: 'KNATIVE_UNAVAILABLE',
          state: dependency.state,
          reason: dependency.reason,
          correlationId,
        },
      });
    },
  });
  if (result === null || result === undefined) return { status: 202, body: null };
  return { status: 200, body: result };
}

// Stream a tenant-scoped Mongo change stream to the client as Server-Sent Events. The handler
// owns the response (no sendJson); it cleans up the subscription when the client disconnects.
async function runRealtimeSse(realtimeExecutor, target, c) {
  if (!realtimeExecutor) throw Object.assign(new Error('Realtime is not enabled'), { statusCode: 501, code: 'REALTIME_DISABLED' });
  const { req, res, identity } = c;
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no', // ask proxies (nginx/APISIX) not to buffer the stream
  });
  res.write('retry: 3000\n\n');
  const controller = new AbortController();
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  let sub;
  const stop = () => { clearInterval(ping); controller.abort(); void sub?.close?.(); };
  req.on('close', stop);
  try {
    sub = await realtimeExecutor.subscribe({
      ...target,
      identity,
      signal: controller.signal,
      onChange: (event) => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
      // Carry the underlying message (not only the code) so a stream failure is diagnosable client-side.
      onError: (err) => res.write(`event: error\ndata: ${JSON.stringify({ code: err?.code ?? 'REALTIME_STREAM_ERROR', message: err?.message ?? 'realtime stream error' })}\n\n`),
    });
    // The client may have already disconnected while we were connecting.
    if (controller.signal.aborted) void sub.close?.();
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ code: err.code ?? 'REALTIME_ERROR', message: err.message ?? 'realtime subscription error' })}\n\n`);
    stop();
    res.end();
  }
}

async function runFunctions(functionsExecutor, params, successStatus) {
  if (!functionsExecutor) throw Object.assign(new Error('Functions are not enabled'), { statusCode: 501, code: 'FUNCTIONS_DISABLED' });
  const result = await functionsExecutor.executeFunctions(params);
  return { status: successStatus, body: result };
}

async function runMongo(mongoExecutor, params, successStatus) {
  if (!mongoExecutor) throw Object.assign(new Error('MongoDB is not enabled'), { statusCode: 501, code: 'MONGO_DISABLED' });
  const result = await mongoExecutor.executeMongoData(params);
  return { status: successStatus, body: result };
}

async function runEvents(eventsExecutor, params, successStatus) {
  if (!eventsExecutor) throw Object.assign(new Error('Events are not enabled'), { statusCode: 501, code: 'EVENTS_DISABLED' });
  const result = await eventsExecutor.executeEvents(params);
  return { status: successStatus, body: result };
}

function requireStore(apiKeyStore) {
  if (!apiKeyStore) throw Object.assign(new Error('API keys are not enabled'), { statusCode: 501, code: 'API_KEYS_DISABLED' });
  return apiKeyStore;
}

async function run(registry, fn, params, successStatus) {
  const result = await fn(registry, params);
  return { status: successStatus, body: result };
}

async function runDdl(registry, resourceKind, payload, c) {
  const result = await executePostgresDdl(registry, {
    resourceKind, action: 'create', payload, identity: c.identity,
    executionMode: c.url.searchParams.get('mode') === 'preview' || payload.dryRun ? 'preview' : 'execute',
  });
  return { status: result.executed === false ? 200 : 201, body: result };
}

async function runDdlAction(registry, resourceKind, action, payload, c) {
  const result = await executePostgresDdl(registry, {
    resourceKind, action, payload, identity: c.identity,
    executionMode: c.url.searchParams.get('mode') === 'preview' || payload.dryRun ? 'preview' : 'execute',
  });
  return { status: 200, body: result };
}

async function runEmbeddingProvider(embeddingExecutor, action, params, successStatus) {
  if (!embeddingExecutor) throw Object.assign(new Error('Embedding provider is not enabled'), { statusCode: 501, code: 'EMBEDDING_DISABLED' });
  if (action === 'set') {
    // The tenantId comes from the verified identity (never the body); the store keys the
    // record by (tenant_id, workspace_id). The executor's GUARDED deployProvider confines the
    // secretRef to the reserved-prefix allow-list + SSRF-validates the endpoint BEFORE persisting
    // (#659), then the store strips any plaintext apiKey/secret. Falls back to store.deployProvider
    // only for a legacy executor that predates the guarded method.
    const deploy = embeddingExecutor.deployProvider
      ? embeddingExecutor.deployProvider.bind(embeddingExecutor)
      : embeddingExecutor.store.deployProvider.bind(embeddingExecutor.store);
    const result = await deploy(params.workspaceId, { ...(params.config ?? {}), tenantId: params.tenantId });
    return { status: successStatus, body: result };
  }
  if (action === 'get') {
    // Read-back of the workspace's provider config, scoped to the verified identity's tenantId so
    // a workspaceId shared across tenants resolves THIS tenant's record only. The stored record
    // carries a `secretRef` ONLY — the plaintext key is never persisted, so GET cannot leak it (#635).
    const record = await embeddingExecutor.store.getProvider(params.workspaceId, params.tenantId);
    if (!record) throw Object.assign(new Error('No embedding provider configured for this workspace'), { statusCode: 404, code: 'EMBEDDING_PROVIDER_NOT_FOUND' });
    return { status: successStatus, body: record };
  }
  const result = await embeddingExecutor.store.removeProvider(params.workspaceId, params.tenantId);
  return { status: successStatus, body: result };
}

// BYOK LLM provider config plane (change: add-llm-agent-flow-task / #640). Mirrors
// runEmbeddingProvider: tenantId from the verified identity (never the body), GET returns the
// stored record (which carries a `secretRef` ONLY — the plaintext key is never persisted).
async function runLlmProvider(llmExecutor, action, params, successStatus) {
  if (!llmExecutor) throw Object.assign(new Error('LLM provider is not enabled'), { statusCode: 501, code: 'LLM_DISABLED' });
  if (action === 'set') {
    const result = await llmExecutor.setProvider(params.workspaceId, { ...(params.config ?? {}), tenantId: params.tenantId });
    return { status: successStatus, body: result };
  }
  if (action === 'get') {
    const record = await llmExecutor.getProvider(params.workspaceId, params.tenantId);
    if (!record) throw Object.assign(new Error('No LLM provider configured for this workspace'), { statusCode: 404, code: 'LLM_PROVIDER_NOT_FOUND' });
    return { status: successStatus, body: record };
  }
  const result = await llmExecutor.removeProvider(params.workspaceId, params.tenantId);
  return { status: successStatus, body: result };
}

// Token-usage rollup, scoped to the verified identity's tenantId so a workspaceId shared across
// tenants reports THIS tenant's usage only (no cross-tenant aggregation).
async function runLlmUsage(llmExecutor, params, successStatus) {
  if (!llmExecutor) throw Object.assign(new Error('LLM provider is not enabled'), { statusCode: 501, code: 'LLM_DISABLED' });
  const rollup = await llmExecutor.getUsage(params.workspaceId, { tenantId: params.tenantId });
  return { status: successStatus, body: rollup };
}

// LLM chat completion. This is an `{ sse: true }` route, so the handler OWNS the response: it
// reads the JSON body itself, then either streams SSE frames (`stream: true`) or writes a single
// JSON body. Errors raised BEFORE the first byte (no provider / disallowed model / unresolved
// secret) surface as HTTP error envelopes; once the stream is open, a late error is emitted as a
// terminal SSE `error` frame (headers are already sent).
async function runLlmComplete(llmExecutor, { workspaceId, tenantId }, c) {
  const { req, res } = c;
  if (!llmExecutor) {
    return sendJson(res, 501, { code: 'LLM_DISABLED', message: 'LLM provider is not enabled' });
  }
  let body;
  try { body = await readJsonBody(req); } catch { body = {}; }
  const request = {
    tenantId,
    model: body.model,
    messages: body.messages,
    prompt: body.prompt,
    system: body.system,
    maxTokens: body.maxTokens,
    temperature: body.temperature,
  };

  if (!body.stream) {
    // Non-streaming: a thrown clientError propagates to the dispatcher's catch (headers not yet
    // sent) and becomes a JSON error envelope with the right status + code.
    const result = await llmExecutor.complete(workspaceId, request);
    return sendJson(res, 200, result);
  }

  // Streaming: prime the generator so a pre-stream error surfaces as an HTTP status BEFORE any
  // SSE header is written (mirrors the flow-monitoring SSE handler's ensureStarted discipline).
  const iter = llmExecutor.completeStream(workspaceId, request)[Symbol.asyncIterator]();
  let current;
  try {
    current = await iter.next();
  } catch (err) {
    const statusCode = err.statusCode ?? 500;
    return sendJson(res, statusCode, { code: err.code ?? 'LLM_PROVIDER_ERROR', message: statusCode >= 500 ? 'Internal server error' : err.message });
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  try {
    for (; !current.done; current = await iter.next()) {
      res.write(`data: ${JSON.stringify(current.value)}\n\n`);
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', code: err.code ?? 'LLM_PROVIDER_ERROR' })}\n\n`);
  }
  res.end();
}

function requireMappingStore(mappingStore) {
  if (!mappingStore) throw Object.assign(new Error('Embedding mapping is not enabled'), { statusCode: 501, code: 'MAPPING_STORE_DISABLED' });
  return mappingStore;
}

// Resolve the target column for a single-mapping GET/DELETE when none is supplied: a table
// usually has exactly one vector column, so the unqualified resource addresses that mapping.
async function resolveSingleTargetColumn(store, { workspaceId, tenantId, schemaName, tableName, targetColumn }) {
  if (targetColumn) return targetColumn;
  const mappings = await store.getMappings(workspaceId, { tenantId, schemaName, tableName });
  return mappings.length > 0 ? mappings[0].targetColumn : undefined;
}

async function runEmbeddingMapping(mappingStore, action, params, successStatus) {
  const store = requireMappingStore(mappingStore);
  // The tenantId comes from the verified identity (never the body); the store keys the record
  // by (tenant_id, workspace_id, schema, table, target_column).
  if (action === 'set') {
    const cfg = params.config ?? {};
    const result = await store.deployMapping(params.workspaceId, {
      tenantId: params.tenantId,
      schemaName: params.schemaName,
      tableName: params.tableName,
      sourceColumn: cfg.sourceColumn,
      targetColumn: cfg.targetColumn,
    });
    return { status: successStatus, body: result };
  }
  const targetColumn = await resolveSingleTargetColumn(store, params);
  if (action === 'get') {
    const got = targetColumn
      ? await store.getMapping(params.workspaceId, {
          tenantId: params.tenantId, schemaName: params.schemaName, tableName: params.tableName, targetColumn,
        })
      : null;
    if (!got) throw Object.assign(new Error('Embedding mapping not found'), { statusCode: 404, code: 'MAPPING_NOT_FOUND' });
    return { status: successStatus, body: got };
  }
  // remove
  const result = targetColumn
    ? await store.removeMapping(params.workspaceId, {
        tenantId: params.tenantId, schemaName: params.schemaName, tableName: params.tableName, targetColumn,
      })
    : { removed: false };
  return { status: successStatus, body: result };
}

export function createControlPlaneServer({ registry, apiKeyStore, mongoExecutor, eventsExecutor, functionsExecutor, realtimeExecutor, pgRealtimeExecutor, embeddingExecutor, llmExecutor, mappingStore, flowExecutor, flowMonitoringExecutor, mcpEngine, controlPlaneUpstream, mcpSelfBaseUrl, mcpConfig = mcpConfigStore, jwtVerifier, gatewaySharedSecret, resolveWorkspaceTenant, workspaceDocsDb, knativeRuntime, mcpRuntimeCleaner, logger = console } = {}) {
  if (!registry) throw new TypeError('createControlPlaneServer requires a connection registry');
  // Parse + validate the upstream at startup (fail-fast). Host/port are fixed here so the
  // per-request proxy can never be steered to a different host (SSRF).
  const upstream = controlPlaneUpstream ? new URL(controlPlaneUpstream) : undefined;
  // The first-party MCP dispatches tool calls against this executor's own loopback base (so its
  // local routes + the control-plane fallthrough reach every family). Validate it once (SSRF).
  const mcpSelf = mcpSelfBaseUrl ? new URL(mcpSelfBaseUrl).toString() : undefined;
  // Production injects the chart-backed source. The ready fallback preserves direct/unit embedding
  // of this server by callers that do not configure hosted-runtime lifecycle management.
  const hostedRuntime = knativeRuntime ?? {
    status: () => ({ mode: 'external', state: 'ready', reason: 'READY' }),
    canServeWorkloads: () => true,
  };
  const routes = buildRoutes(registry, apiKeyStore, mongoExecutor, eventsExecutor, functionsExecutor, realtimeExecutor, pgRealtimeExecutor, embeddingExecutor, llmExecutor, mappingStore, flowExecutor, flowMonitoringExecutor, mcpEngine, controlPlaneUpstream, mcpSelf, mcpConfig, workspaceDocsDb, hostedRuntime, mcpRuntimeCleaner);

  return http.createServer(async (req, res) => {
    const method = (req.method ?? 'GET').toUpperCase();
    // Prometheus scrape endpoint (no auth) — exposes this process's HTTP metrics (#499).
    if (method === 'GET' && (req.url === '/metrics' || req.url === '/metrics/')) {
      res.writeHead(200, { 'content-type': METRICS_CONTENT_TYPE });
      return res.end(renderMetrics());
    }
    // Record every request on completion (final status, regardless of code path).
    const startNs = process.hrtime.bigint();
    const metric = { method, route: 'unmatched', tenantId: '' };
    res.on('finish', () => recordHttp({ ...metric, status: res.statusCode, durationSeconds: Number(process.hrtime.bigint() - startNs) / 1e9 }));
    try {
      const url = new URL(req.url, 'http://control-plane.local');
      metric.route = normalizeRoute(url.pathname);

      const match = routes.find(([m, re]) => m === method && re.test(url.pathname));
      if (!match) {
        // Not part of the executor's data-plane/DDL slice → fall through to the control-plane
        // (browse/inventory/management routes under the same prefixes) when an upstream is set.
        if (upstream) return proxyRequest(req, res, upstream, logger);
        return sendJson(res, 404, { code: 'NO_ROUTE', message: `No route for ${method} ${url.pathname}` });
      }
      const [, re, handler, opts] = match;
      const groups = re.exec(url.pathname).slice(1);

      // SSE routes accept the anon key via ?apikey= (EventSource can't set headers).
      const queryApiKey = opts?.sse ? url.searchParams.get('apikey') : undefined;
      const identity = await resolveIdentity(req.headers, groups[0], apiKeyStore, jwtVerifier, queryApiKey, gatewaySharedSecret);
      metric.tenantId = identity.tenantId ?? '';
      if (!opts?.noAuth && !identity.tenantId) {
        return sendJson(res, 401, { code: 'UNAUTHENTICATED', message: 'Missing tenant identity' });
      }
      const workspaceInPath = workspaceIdFromPath(url.pathname);
      const structuralWrite = !opts?.noAuth && isStructuralWriteRequest(method, url.pathname);
      // Credential workspace binding check: when the authenticated credential explicitly
      // binds a workspace (identity.credentialWorkspaceId is set — from an API key or a JWT
      // with a workspace_id claim), the workspace in the URL path MUST match. A mismatch
      // means the caller is using a credential bound to workspace B to access workspace A's
      // resources — cross-tenant/cross-workspace IDOR — and is rejected with 403 before any
      // handler or executor runs. Credentials without a workspace binding (tenant-only JWTs,
      // gateway-injected identity headers) are not subject to this check.
      if (!opts?.noAuth && identity.credentialWorkspaceId) {
        if (workspaceInPath && workspaceInPath !== identity.credentialWorkspaceId) {
          if (isHostedMcpRpcRequest(url.pathname)) {
            identity.hostedMcpWorkspaceBindingDenied = true;
          } else {
            return sendJson(res, 403, { code: 'FORBIDDEN', message: 'Credential workspace does not match the requested workspace' });
          }
        }
      }
      // Hosted MCP has both read and dispatch routes whose dependency status and stored metadata are
      // sensitive. A verified plural workspace claim therefore binds every hosted MCP route, not
      // just structural writes, and is enforced before the handler can inspect runtime readiness.
      if (!opts?.noAuth && workspaceInPath && isHostedMcpWorkspaceRequest(url.pathname)
          && Array.isArray(identity.workspaceIds) && !identity.workspaceIds.includes(workspaceInPath)) {
        return sendJson(res, 403, { code: 'FORBIDDEN', message: 'Caller workspace scope does not include the requested workspace' });
      }
      let owningTenantId;
      let checkedWorkspaceTenant = false;
      const workspaceToCheck = workspaceInPath || identity.workspaceId;
      // Workspace-ownership check (fix-executor-apikey-cross-tenant-idor, #517): a caller may only
      // operate on a workspace owned by its own tenant. This closes a cross-tenant IDOR that the
      // credential-binding check above misses — a tenant-only admin JWT (no workspace binding)
      // could mint/manage api-keys and reach the data plane in ANOTHER tenant's workspace. When the
      // path names a workspace whose owning tenant is known and differs from the caller's verified
      // tenant, reject before any handler runs. Non-structural paths with no ownership record are
      // left to RLS (which scopes them to the caller's own tenant), so they are not a cross-tenant
      // exposure; structural writes below reject unknown workspaces before any side effect.
      if (!opts?.noAuth && resolveWorkspaceTenant && identity.tenantId) {
        // Prefer the workspace named in the path; fall back to the credential's
        // workspace for routes that target a workspace's resources WITHOUT a
        // /workspaces/ path segment — notably the DDL routes
        // (/v1/postgres/databases/{db}/schemas...), which resolve their connection
        // from identity.workspaceId. Without this fallback a forged trust-header
        // request (x-workspace-id = a foreign tenant's workspace) could run DDL on
        // that workspace's database (fix-executor-ddl-db-ownership-guard, B3).
        if (workspaceToCheck) {
          owningTenantId = await resolveWorkspaceTenant(workspaceToCheck);
          checkedWorkspaceTenant = true;
          if (owningTenantId && owningTenantId !== identity.tenantId) {
            return sendJson(res, 403, { code: 'CROSS_TENANT_VIOLATION', message: "Workspace does not belong to the caller's tenant" });
          }
        }
      }
      // Key management must not be performed with an anon/service API key — admin (JWT) only.
      const isKeyMgmt = url.pathname.includes('/api-keys');
      if (isKeyMgmt && identity.dbRole) {
        return sendJson(res, 403, { code: 'FORBIDDEN', message: 'API keys cannot manage API keys' });
      }
      // Key management is an admin-role operation (#624). When the caller's roles are KNOWN (verified
      // JWT or gateway-injected x-actor-roles) and contain no admin role, deny — a non-admin (e.g.
      // tenant_developer) cannot mint/manage API keys. The broader structural-write gate below is
      // stricter for executor structural/admin writes: API-key identities and empty-role JWT/header
      // identities must not mutate structural state.
      if (!opts?.noAuth && isKeyMgmt && Array.isArray(identity.roles) && identity.roles.length > 0
          && !identity.roles.some((r) => KEY_MGMT_ADMIN_ROLES.has(r))) {
        return sendJson(res, 403, { code: 'FORBIDDEN', message: 'Caller role may not manage API keys' });
      }
      const structuralDenyMessage = structuralWrite ? structuralWriteDenyMessage(identity) : null;
      if (structuralDenyMessage) {
        return sendJson(res, 403, { code: 'FORBIDDEN', message: structuralDenyMessage });
      }
      if (structuralWrite && workspaceScopeDeniesStructuralWrite(identity, workspaceInPath)) {
        return sendJson(res, 403, { code: 'FORBIDDEN', message: 'Caller workspace scope does not include the requested workspace' });
      }
      if (structuralWrite && resolveWorkspaceTenant && workspaceToCheck && checkedWorkspaceTenant && !owningTenantId) {
        return sendJson(res, 404, { code: 'WORKSPACE_NOT_FOUND', message: `workspace ${workspaceToCheck} not found` });
      }
      // API-key scope enforcement (#624): a scoped credential may only perform operations its scopes
      // permit (data:write for writes, ddl:write for DDL). Defense-in-depth for profiles where the gateway
      // scope-enforcement plugin is not wired. Applies ONLY to API-key credentials (identity.dbRole
      // present); JWT/admin/gateway-header identities are governed by roles + RLS, not data-plane scopes.
      if (!opts?.noAuth && identity.dbRole) {
        const requiredScope = requiredDataScope(method, url.pathname);
        if (requiredScope && !(Array.isArray(identity.scopes) && identity.scopes.includes(requiredScope))) {
          return sendJson(res, 403, { code: 'INSUFFICIENT_SCOPE', message: 'Credential scope does not permit this operation', requiredScope });
        }
      }
      // SSE routes own the response (streaming); pass req/res and skip the JSON path.
      if (opts?.sse) {
        await handler(groups, { url, identity, registry, req, res });
        return;
      }
      // Webhook trigger ingestion needs the RAW body (HMAC is computed over the exact bytes the
      // sender signed) plus the signature + delivery-id headers; the parsed JSON is a best-effort
      // flow input. The signature is the credential, so this path bypasses the OIDC identity gate
      // (the gateway still injects the workspace's tenant context for the secret lookup).
      if (opts?.webhook) {
        const rawBody = await readRawBody(req);
        let payload;
        try { payload = rawBody ? JSON.parse(rawBody) : {}; } catch { payload = { raw: rawBody }; }
        const ctx = {
          url, identity, registry,
          rawBody,
          payload,
          signatureHeader: req.headers['x-platform-webhook-signature'],
          deliveryId: req.headers['x-platform-webhook-id'],
        };
        const { status, body: out } = await handler(groups, ctx);
        return sendJson(res, status, out);
      }
      const body = method === 'GET' || method === 'DELETE' ? {} : await readJsonBody(req);

      // `authorization` is threaded through for handlers that must call the control-plane on the
      // caller's behalf (the platform MCP JSON-RPC route forwards the bearer token to the upstream,
      // the only credential the control-plane accepts).
      const { status, body: out, headers } = await handler(groups, { method, url, identity, body, registry, headers: req.headers, authorization: req.headers.authorization });
      return sendJson(res, status, out, headers);
    } catch (err) {
      const statusCode = err.statusCode ?? 500;
      if (statusCode >= 500) logger.error?.('[control-plane] request failed:', err);
      const envelope = {
        code: err.code ?? 'CONTROL_PLANE_ERROR',
        message: statusCode >= 500 ? 'Internal server error' : err.message,
      };
      // Flow validation failures carry a node-scoped error array (FLW-E codes + nodeId) — surface
      // it on the 422 envelope so the console can highlight the offending canvas nodes.
      if (Array.isArray(err.errors) && statusCode < 500) envelope.errors = err.errors;
      // Quota breaches (429 QUOTA_EXCEEDED) carry the breached dimension so the caller can show
      // which limit was hit (spec: body indicates the breached dimension).
      if (err.dimension && statusCode < 500) envelope.dimension = err.dimension;
      return sendJson(res, statusCode, envelope);
    }
  });
}
