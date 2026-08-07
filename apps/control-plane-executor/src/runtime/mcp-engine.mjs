// MCP control-plane engine (change: add-mcp-control-plane-runtime).
//
// The integration layer that makes the live runtime serve the MCP management API. It COMPOSES the
// already-built, reviewed pure MCP modules (apps/control-plane-executor/src/mcp-*.mjs) — it does not
// reimplement them:
//   - mcp-instant-generator / mcp-official-catalog  → a DRAFT tool set per source
//   - mcp-curation                                  → enable/disable + scopes + the publish gate
//   - mcp-registry                                  → digest-pinned versions, diff, review, rollback
//   - mcp-quota                                     → per-tenant server/tool quotas + rate limits
//   - mcp-observability                             → per-OAuth-client audit trail + tool-call telemetry
//   - mcp-official-server                           → JSON-RPC scope enforcement reference
//
// Tenancy: every operation is keyed by the credential-derived identity.tenantId (the same identity
// the rest of the runtime resolves from the gateway headers). The registry accessors reject
// cross-tenant reads, so a server created by tenant A is invisible/unreachable to tenant B.
//
// State: process-local maps with an optional durable store. The default executor wires a Postgres
// store on the control-plane metadata pool. State-changing operations are run through the store's
// row-locked transaction API when present, so multiple executor replicas reload the latest snapshot
// before writing and cannot clobber each other's MCP servers, versions, audit records, or rate
// windows with stale whole-snapshot saves.
import { randomUUID } from 'node:crypto';
import { generateInstantManifest } from '../mcp-instant-generator.mjs';
import { OFFICIAL_TOOLS, BASE_SCOPE } from '../mcp-official-catalog.mjs';
import { applyCuration, publishManifest } from '../mcp-curation.mjs';
import { createRegistry, registerVersion, getServer, listVersions, activateVersion } from '../mcp-registry.mjs';
import { MCP_QUOTA_DEFAULTS, evaluateServerCountQuota, evaluateToolCallRate, rateLimitKey } from '../mcp-quota.mjs';
import { mcpToolCallTelemetry, mcpAuditEvent, filterAuditRecordsForTenant } from '../mcp-observability.mjs';

const SAMPLE_POSTGRES = { database: 'default', name: 'public', tables: [{ name: 'items', columns: [{ name: 'id', type: 'int' }, { name: 'label', type: 'text' }] }] };

// MCP wire protocol version exposed over JSON-RPC (matches the platform MCP server,
// mcp-official-server.mjs). Bumped together if the protocol revision changes.
const PROTOCOL_VERSION = '2025-11-25';

function httpError(statusCode, code, message, extra = {}) {
  return Object.assign(new Error(message), { statusCode, code, ...extra });
}

function rpc(id, result) { return { jsonrpc: '2.0', id: id ?? null, result }; }
function rpcErr(id, code, message) { return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }; }

function slug(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'server';
}

/** Build a curation-ready DRAFT for the requested source (instant generators or the official catalog). */
function draftForSource(serverId, source, resources) {
  if (source === 'official') {
    // Normalize the official catalog into the draft shape curation expects (scope → suggestedScope).
    // Only PROXY tools are re-hostable: the in-process meta-tools (plan_project, *_mcp_config) have
    // no method/path and the config-set tool is role-gated rather than scope-bound, so they belong to
    // the direct /v1/mcp/rpc server only — not a hosted re-export (#642).
    const tools = OFFICIAL_TOOLS.filter((t) => t.kind === 'proxy').map((t) => ({
      name: t.name, description: t.description, inputSchema: t.inputSchema,
      mutates: t.mutates, suggestedScope: t.scope ?? null, method: t.method, path: t.path,
    }));
    return { serverId, status: 'draft', requiresCuration: true, generatedFrom: ['official'], tools };
  }
  // 'instant' (default): generate from the tenant's resources (a sample schema when none supplied).
  return generateInstantManifest(serverId, resources ?? { postgres: SAMPLE_POSTGRES });
}

export function createMcpEngine({
  selfBaseUrl = process.env.MCP_SELF_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 8080}`,
  gatewayBaseUrl = process.env.MCP_GATEWAY_BASE_URL ?? selfBaseUrl,
  runtimeImage = process.env.MCP_RUNTIME_IMAGE ?? 'ghcr.io/gntik-ai/in-falcone-mcp-runtime:0.3.0',
  runtimeImageDigest = process.env.MCP_RUNTIME_IMAGE_DIGEST,
  plan = MCP_QUOTA_DEFAULTS[process.env.MCP_PLAN ?? 'standard'] ?? MCP_QUOTA_DEFAULTS.standard,
  fetchImpl = globalThis.fetch,
  clock = () => Date.now(),
  store,
  cleanupRepository,
  mcpRuntimeAdapter,
  auditSink,
} = {}) {
  const registry = createRegistry();
  const servers = new Map(); // `${tenantId}::${serverId}` -> { serverId, name, source, tenantId, workspaceId, draft, curated }
  const auditLog = []; // audit events (each carries scope.tenant_id)
  const rateWindows = new Map(); // rateKey -> { count, windowStart }
  const pinnedImage = runtimeImageDigest ?? runtimeImage;
  const registryImage = runtimeImageDigest ? `${runtimeImage}@${runtimeImageDigest}` : runtimeImage;
  const key = (tid, sid) => `${tid}::${sid}`;
  let loaded = false;
  let dirty = false;
  let inStoreTransaction = false;
  const mutatingOperations = new Set([
    'create_server',
    'curate_server',
    'publish_version',
    'approve_version',
    'call_tool',
    'delete_server',
    'record_dependency_event',
  ]);

  function snapshot() {
    return {
      registry,
      servers: [...servers.values()],
      auditLog,
      rateWindows: [...rateWindows.entries()],
    };
  }

  function hydrate(state = {}) {
    registry.servers = state.registry?.servers ?? {};
    servers.clear();
    for (const entry of state.servers ?? []) {
      if (entry?.tenantId && entry?.serverId) servers.set(key(entry.tenantId, entry.serverId), entry);
    }
    auditLog.splice(0, auditLog.length, ...(state.auditLog ?? []));
    rateWindows.clear();
    for (const [k, v] of state.rateWindows ?? []) rateWindows.set(k, v);
  }

  async function ensureLoaded() {
    if (!store || inStoreTransaction) return;
    if (loaded && !store.withStateTransaction) return;
    const state = await store.loadState();
    hydrate(state ?? {});
    loaded = true;
  }

  async function persistIfDirty() {
    if (!store || !dirty) return;
    if (inStoreTransaction) return;
    await store.saveState(snapshot());
    dirty = false;
  }

  async function changed(result) {
    dirty = true;
    await persistIfDirty();
    return result;
  }

  function tenantServers(identity, workspaceId) {
    return [...servers.values()].filter((s) => s.tenantId === identity.tenantId && (!workspaceId || s.workspaceId === workspaceId));
  }

  function requireServer(identity, serverId, workspaceId) {
    const entry = servers.get(key(identity.tenantId, serverId));
    if (!entry || entry.tenantId !== identity.tenantId || (workspaceId && entry.workspaceId !== workspaceId)) throw httpError(404, 'MCP_SERVER_NOT_FOUND', 'No such MCP server for this tenant/workspace.');
    return entry;
  }

  function endpointFor(workspaceId, serverId) {
    return `${gatewayBaseUrl}/v1/mcp/workspaces/${encodeURIComponent(workspaceId)}/servers/${encodeURIComponent(serverId)}`;
  }

  function recordAudit(event) {
    auditLog.push(event);
    if (auditSink) {
      const sinkEvent = { ...event,
        tenantId: event.scope?.tenant_id, workspaceId: event.scope?.workspace_id,
        correlationId: event.correlation_id, actionType: event.action?.id,
      };
      void auditSink(sinkEvent);
    }
  }

  function enforceRate(identity, serverId, scope, oauthClientId) {
    const k = rateLimitKey({ tenantId: identity.tenantId, serverId, oauthClientId, scope });
    const now = clock();
    const w = rateWindows.get(k);
    const window = !w || now - w.windowStart >= 60_000 ? { count: 0, windowStart: now } : w;
    window.count += 1;
    rateWindows.set(k, window);
    const decision = evaluateToolCallRate({ plan, scope, windowCount: window.count, windowSeconds: 60 });
    if (!decision.allowed) throw httpError(decision.httpStatus, decision.code, decision.message, { dimension: decision.dimension, retryAfterSeconds: decision.retryAfterSeconds });
  }

  function viewServer(identity, entry, runtimeDependency) {
    const registered = getServer(registry, identity.tenantId, entry.serverId);
    const activeVersion = registered?.activeVersion ?? null;
    const activeRecord = registered?.versions?.find((v) => v.version === activeVersion);
    const status = activeVersion ? 'published' : (entry.curated ? 'curated' : 'draft');
    const tools = activeRecord?.tools ?? entry.curated?.tools ?? entry.draft?.tools ?? [];
    const dependency = runtimeDependency ? {
      mode: runtimeDependency.mode,
      state: runtimeDependency.state,
      reason: runtimeDependency.reason,
      ready: runtimeDependency.ready === true,
    } : undefined;
    return {
      serverId: entry.serverId, name: entry.name, source: entry.source, status,
      lifecycleStatus: entry.lifecycleStatus ?? 'active',
      endpoint: endpointFor(entry.workspaceId, entry.serverId), version: activeVersion, activeVersion,
      tools: tools.map((t) => ({ name: t.name, description: t.description ?? null, mutates: !!t.mutates, scope: t.scope ?? t.suggestedScope ?? null })),
      ...(dependency ? { runtimeDependency: dependency, runtimeReady: dependency.ready } : {}),
    };
  }

  function runtimeAudit(identity, workspaceId, serverId, action, correlationId, runtime = {}, outcome = 'failed', operation) {
    recordAudit(mcpAuditEvent({
      tenantId: identity.tenantId,
      workspaceId,
      oauthClientId: identity.actorId ?? 'system',
      action,
      outcome,
      serverId,
      correlationId,
      eventId: randomUUID(),
      eventTimestamp: new Date(clock()).toISOString(),
      detail: {
        runtime_mode: runtime.mode,
        runtime_state: runtime.state,
        runtime_reason: runtime.reason,
        runtime_operation: operation,
      },
    }));
  }

  // Resolve a tool's method/path/body for the real executor (data plane) or control-plane (proxied)
  // route. The workspace ALWAYS comes from the credential-bound server context (entry.workspaceId);
  // the tenant from identity — NEVER from args. Per-call dynamic path segments (object key, topic,
  // flow input) come from args and are stripped of any tenant/workspace the caller tried to smuggle.
  // Returns { method, path, body } or { error } when a required arg is missing.
  function resolveCall(entry, tool, args = {}) {
    const ws = encodeURIComponent(entry.workspaceId);
    const source = tool.source ?? {};
    let path = String(tool.path ?? '').replace('{workspaceId}', ws);
    const method = tool.method ?? 'GET';
    // Defence in depth: a caller must not steer routing by smuggling tenant/workspace in args.
    const { tenantId: _t, workspaceId: _w, ...safeArgs } = args ?? {};

    switch (source.type) {
      case 'postgres': {
        // …/tables/{table}/rows — GET lists (no body), POST inserts {row:{...}}.
        const body = method === 'GET' ? undefined : { row: safeArgs.row ?? safeArgs.values ?? safeArgs };
        return { method, path, body };
      }
      case 'function': {
        // POST …/actions/{name}/invocations — the executor binds invocationInput; send the
        // documented {parameters:{...}} envelope (a bare map is also accepted upstream).
        const parameters = safeArgs.parameters ?? safeArgs.payload ?? safeArgs;
        return { method, path, body: { parameters } };
      }
      case 'storage': {
        // …/objects/{objectKey} — the key is per-call from args; refuse if absent.
        if (!safeArgs.key) return { error: 'object key is required' };
        path = path.replace('{objectKey}', encodeURIComponent(safeArgs.key));
        const body = method === 'PUT' ? { content: safeArgs.content ?? '' } : undefined;
        return { method, path, body };
      }
      case 'events': {
        // …/topics/{topic}/(publish|messages) — topic is per-call from args; refuse if absent.
        if (!safeArgs.topic) return { error: 'topic is required' };
        path = path.replace('{topic}', encodeURIComponent(safeArgs.topic));
        const body = method === 'GET' ? undefined : (safeArgs.payload ?? {});
        return { method, path, body };
      }
      case 'flow': {
        // POST …/flows/{flowId}/executions — args become the flow input ({input:{...}}); the
        // flowId is baked into the tool path, the workspace from the credential context.
        return { method, path, body: { input: safeArgs } };
      }
      default: {
        // Official/platform control-plane tools (proxied upstream). The tenant + workspace come from
        // the credential-bound server context, NEVER from args: {tenantId}→entry.tenantId,
        // {workspaceId} (above) and {id}→ws. Any remaining named segment (e.g. {serviceAccountId},
        // {keyId}) is a per-call resource id taken from the (tenant/workspace-stripped) args.
        path = path.replace('{tenantId}', encodeURIComponent(entry.tenantId ?? ''))
          .replace('{id}', ws);
        const missing = [];
        path = path.replace(/\{(\w+)\}/g, (_, name) => {
          const v = safeArgs[name];
          if (v === undefined || v === null || v === '') { missing.push(name); return ''; }
          delete safeArgs[name];
          return encodeURIComponent(String(v));
        });
        if (missing.length) return { error: `missing required argument: ${missing.join(', ')}` };
        const body = method === 'GET' || method === 'DELETE' ? undefined : safeArgs;
        return { method, path, body };
      }
    }
  }

  // Mediate a tool call: resolve the tool in the active published manifest, enforce its scope, and
  // self-call the runtime using the tool's REAL executor/control-plane route (workspace from the
  // credential context, NEVER from args). Returns an MCP-style result envelope (tool-level errors
  // live in content).
  async function invokeTool(identity, entry, registered, toolName, args = {}, correlationId) {
    const activeRecord = registered.versions.find((v) => v.version === registered.activeVersion);
    const tool = (activeRecord?.tools ?? []).find((t) => t.name === toolName);
    if (!tool) return { content: [{ type: 'text', text: `unknown tool: ${toolName}` }], isError: true };
    // Hosted MCP calls must enforce the caller's actual granted scopes. The server owner controls
    // what tools are published, but publication must not synthesize authority for a later caller.
    const toolScope = tool.scope ?? tool.suggestedScope ?? null;
    const granted = new Set(Array.isArray(identity.scopes) ? identity.scopes : []);
    if (!granted.has(BASE_SCOPE)) return { content: [{ type: 'text', text: `missing required scope: ${BASE_SCOPE}` }], isError: true };
    if (tool.mutates && !toolScope) return { content: [{ type: 'text', text: 'mutating tool is missing an explicit required scope' }], isError: true };
    if (tool.mutates && toolScope && !granted.has(toolScope)) return { content: [{ type: 'text', text: `mutating tool requires scope: ${toolScope}` }], isError: true };

    if (mcpRuntimeAdapter?.invoke) {
      const hosted = await mcpRuntimeAdapter.invoke({ tenantId: entry.tenantId, workspaceId: entry.workspaceId, serverId: entry.serverId,
        version: registered.activeVersion, tool: toolName, args, manifest: activeRecord, correlationId });
      return { content: hosted?.content ?? [], isError: hosted?.isError === true, ...hosted };
    }

    const call = resolveCall(entry, tool, args);
    if (call.error) return { content: [{ type: 'text', text: call.error }], isError: true };
    const headers = {
      'x-tenant-id': identity.tenantId,
      'x-workspace-id': entry.workspaceId,
      'x-auth-subject': identity.actorId ?? 'mcp',
      'x-pg-role': identity.roleName ?? 'falcone_app',
      ...(Array.isArray(identity.scopes) ? { 'x-actor-scopes': identity.scopes.join(' ') } : {}),
      ...(Array.isArray(identity.roles) ? { 'x-actor-roles': identity.roles.join(',') } : {}),
      'content-type': 'application/json',
      accept: 'application/json',
    };
    const init = { method: call.method, headers };
    if (call.body !== undefined) init.body = JSON.stringify(call.body);
    try {
      const res = await fetchImpl(`${selfBaseUrl}${call.path}`, init);
      let body; try { body = await res.json(); } catch { body = null; }
      return { content: [{ type: 'text', text: typeof body === 'string' ? body : JSON.stringify(body) }], status: res.status };
    } catch (err) {
      return { content: [{ type: 'text', text: `tool backend unavailable: ${err.message}` }], isError: true };
    }
  }

  async function executeMcp(params = {}) {
    if (
      store?.withStateTransaction &&
      mutatingOperations.has(params.operation) &&
      !inStoreTransaction
    ) {
      return store.withStateTransaction(async (state) => {
        hydrate(state ?? {});
        loaded = true;
        dirty = false;
        inStoreTransaction = true;
        try {
          const result = await executeMcp(params);
          const next = snapshot();
          dirty = false;
          return { state: next, result };
        } finally {
          inStoreTransaction = false;
        }
      });
    }
    await ensureLoaded();
    const { operation, identity, workspaceId, serverId, version, body = {}, runtimeDependency } = params;
    const tid = identity?.tenantId;
    if (!tid) throw httpError(401, 'UNAUTHENTICATED', 'Missing tenant identity');
    const audit = (action, extra = {}) => recordAudit(mcpAuditEvent({
      tenantId: tid, workspaceId, oauthClientId: identity.actorId ?? 'system', action,
      serverId: extra.serverId ?? serverId, correlationId: randomUUID(), eventId: randomUUID(), eventTimestamp: new Date(clock()).toISOString(),
    }));

    switch (operation) {
      case 'list_servers':
        return {
          items: tenantServers(identity, workspaceId).map((s) => viewServer(identity, s, runtimeDependency)),
          ...(runtimeDependency ? { runtimeDependency } : {}),
        };

      case 'create_server': {
        const decision = evaluateServerCountQuota({ plan, currentServers: tenantServers(identity).length });
        if (!decision.allowed) throw httpError(decision.httpStatus, decision.code, decision.message, { dimension: decision.dimension });
        const source = body.source ?? 'instant';
        const sid = `srv-${slug(body.name ?? source)}-${randomUUID().slice(0, 8)}`;
        const draft = draftForSource(sid, source, body.resources);
        servers.set(key(tid, sid), { serverId: sid, name: body.name ?? sid, source, tenantId: tid, workspaceId, draft, curated: null });
        return changed({ serverId: sid, status: 'draft', name: body.name ?? sid, generatedFrom: draft.generatedFrom });
      }

      case 'get_server':
        return viewServer(identity, requireServer(identity, serverId, workspaceId), runtimeDependency);

      case 'curate_server': {
        const entry = requireServer(identity, serverId, workspaceId);
        entry.curated = applyCuration(entry.draft, body ?? {});
        return changed({ serverId, status: 'curated', tools: entry.curated.tools, violations: entry.curated.violations });
      }

      case 'publish_version': {
        const entry = requireServer(identity, serverId, workspaceId);
        const curated = body.curation || !entry.curated ? applyCuration(entry.draft, body.curation ?? {}) : entry.curated;
        entry.curated = curated;
        const pub = publishManifest(curated);
        if (!pub.ok) throw httpError(422, 'MCP_PUBLISH_REJECTED', 'Manifest failed the curation gate.', { errors: pub.violations });
        const v = version ?? body.version ?? `v${(listVersions(registry, tid, serverId).length || 0) + 1}`;
        const reg = registerVersion(registry, { tenantId: tid, serverId, version: v, image: registryImage, manifest: pub.manifest, source: entry.source === 'official' ? 'official' : entry.source === 'custom' ? 'custom' : 'instant', signatureVerified: true });
        if (!reg.ok) throw httpError(reg.violations?.[0]?.code === 'duplicate_version' ? 409 : 422, 'MCP_VERSION_REJECTED', reg.violations?.[0]?.message ?? 'Version rejected.', { errors: reg.violations });
        const record = reg.version;
        let activated = false;
        if (!record.requiresReview) { activateVersion(registry, tid, serverId, v, { approved: false }); activated = true; }
        if (mcpRuntimeAdapter?.apply) {
          await mcpRuntimeAdapter.apply({ tenantId: tid, workspaceId: entry.workspaceId, serverId,
            operation: 'publish', version: v, runtimeImage: pinnedImage, manifest: pub.manifest,
            correlationId: body.correlationId ?? randomUUID() });
        }
        audit('server_published', { serverId });
        const active = getServer(registry, tid, serverId)?.activeVersion ?? null;
        return changed({ serverId, version: v, requiresReview: record.requiresReview, status: record.requiresReview ? 'requires_review' : 'active', activeVersion: active, activated });
      }

      case 'approve_version': {
        requireServer(identity, serverId, workspaceId);
        const result = activateVersion(registry, tid, serverId, version, { approved: true });
        if (!result.ok) throw httpError(404, 'MCP_VERSION_NOT_FOUND', result.violations?.[0]?.message ?? 'Version not found.', { errors: result.violations });
        audit('scopes_changed', { serverId });
        return changed({ serverId, approvedVersion: version, activeVersion: getServer(registry, tid, serverId)?.activeVersion ?? null });
      }

      case 'call_tool': {
        const entry = requireServer(identity, serverId, workspaceId);
        const registered = getServer(registry, tid, serverId);
        if (!registered?.activeVersion) throw httpError(409, 'MCP_SERVER_NOT_CONNECTABLE', 'Server has no active published version.');
        const oauthClientId = identity.actorId ?? 'mcp';
        enforceRate(identity, serverId, 'server', oauthClientId);
        enforceRate(identity, serverId, 'oauth_client', oauthClientId);
        const started = clock();
        const result = await invokeTool(identity, entry, registered, body.name, body.arguments ?? {}, params.correlationId ?? randomUUID());
        const telemetry = mcpToolCallTelemetry({ tenantId: tid, workspaceId: entry.workspaceId, serverId, toolName: body.name, oauthClientId, latencyMs: clock() - started, status: result.isError ? 'error' : 'ok' });
        recordAudit({ ...mcpAuditEvent({ tenantId: tid, workspaceId: entry.workspaceId, oauthClientId, action: 'scopes_changed', serverId, correlationId: randomUUID(), eventId: randomUUID(), eventTimestamp: new Date(clock()).toISOString() }), action: { category: 'tool_invocation', id: `mcp.tool_call.${body.name}` }, detail: telemetry.log });
        return changed({ result, content: result.content, toolName: body.name });
      }

      case 'list_audit': {
        requireServer(identity, serverId, workspaceId);
        const items = filterAuditRecordsForTenant(auditLog, tid)
          .filter((e) => (e.resource?.mcp_server_id ?? e.resource?.resource_id) === serverId || e.detail?.server === serverId);
        return { items, ...(runtimeDependency ? { runtimeDependency } : {}) };
      }

      case 'record_dependency_event': {
        requireServer(identity, serverId, workspaceId);
        runtimeAudit(
          identity,
          workspaceId,
          serverId,
          body.action ?? 'runtime_unavailable',
          body.correlationId ?? randomUUID(),
          body.runtime,
          body.outcome ?? 'failed',
          body.operation,
        );
        return changed({ recorded: true, correlationId: body.correlationId });
      }

      case 'delete_server': {
        const entry = requireServer(identity, serverId, workspaceId);
        if (mcpRuntimeAdapter?.listOwned && mcpRuntimeAdapter?.deleteOwned) {
          const observed = await mcpRuntimeAdapter.listOwned({ tenantId: tid, workspaceId: entry.workspaceId, serverId });
          for (const resource of observed ?? []) {
            const deleted = await mcpRuntimeAdapter.deleteOwned({ tenantId: tid, workspaceId: entry.workspaceId, serverId,
              kind: resource.kind, namespace: resource.namespace, name: resource.name, uid: resource.uid, resourceVersion: resource.resourceVersion });
            if (deleted?.status === 409 || deleted?.code === 'PRECONDITION_CONFLICT') {
              entry.lifecycleStatus = 'deletion_pending';
              entry.deletionRequestedAt ??= new Date(clock()).toISOString();
              return changed({ serverId, status: 'deletion_pending', correlationId: randomUUID() });
            }
          }
        }
        servers.delete(key(tid, serverId));
        const reg = registry.servers[key(tid, serverId)];
        if (reg) delete registry.servers[key(tid, serverId)];
        audit('server_unpublished', { serverId: entry.serverId });
        return changed({ serverId, deleted: true });
      }

      default:
        throw httpError(400, 'MCP_UNKNOWN_OPERATION', `Unknown MCP operation: ${operation}`);
    }
  }

  async function assertOwnedServer({ identity, serverId, workspaceId } = {}) {
    await ensureLoaded();
    if (!identity?.tenantId) throw httpError(401, 'UNAUTHENTICATED', 'Missing tenant identity');
    return requireServer(identity, serverId, workspaceId);
  }

  async function deferHostedServers({ identity, tenantId, workspaceId, serverId, correlationId, runtime = {}, reason = 'delete', allTenants = false } = {}) {
    const tid = tenantId ?? identity?.tenantId;
    if (!tid && !allTenants) throw httpError(401, 'UNAUTHENTICATED', 'Missing tenant identity');
    if (!store?.withStateTransaction || !cleanupRepository?.deferMcpDeletion) {
      throw httpError(503, 'MCP_CLEANUP_STORE_UNAVAILABLE', 'Hosted MCP cleanup storage is unavailable.');
    }
    return store.withStateTransaction(async (state, client) => {
      hydrate(state ?? {});
      loaded = true;
      dirty = false;
      const scopedIdentity = identity ?? { tenantId: tid, actorId: 'system' };
      const targets = allTenants
        ? [...servers.values()].filter((entry) => !workspaceId || entry.workspaceId === workspaceId)
        : serverId
          ? [requireServer(scopedIdentity, serverId, workspaceId)]
          : tenantServers(scopedIdentity, workspaceId);
      const pending = [];
      for (const entry of targets) {
        entry.lifecycleStatus = 'deletion_pending';
        entry.deletionRequestedAt ??= new Date(clock()).toISOString();
        const obligation = await cleanupRepository.deferMcpDeletion({
          tenantId: entry.tenantId,
          workspaceId: entry.workspaceId,
          resourceId: entry.serverId,
          runtimeResourceName: `mcp-${entry.serverId}`,
          correlationId,
        }, client);
        runtimeAudit({ ...scopedIdentity, tenantId: entry.tenantId }, entry.workspaceId, entry.serverId, 'cleanup_deferred', obligation.correlationId, runtime, 'succeeded', reason);
        pending.push({
          serverId: entry.serverId,
          status: 'deletion_pending',
          correlationId: obligation.correlationId,
          obligationId: obligation.obligationId,
        });
      }
      dirty = false;
      return { state: snapshot(), result: serverId ? pending[0] : { status: 'deletion_pending', items: pending } };
    });
  }

  async function completeDeferredDeletion(obligation) {
    if (!store?.withStateTransaction || !cleanupRepository?.completeMcpDeletion) {
      throw new Error('Hosted MCP cleanup storage is unavailable.');
    }
    return store.withStateTransaction(async (state, client) => {
      hydrate(state ?? {});
      loaded = true;
      const entry = servers.get(key(obligation.tenantId, obligation.resourceId));
      if (entry && entry.lifecycleStatus !== 'deletion_pending') {
        throw new Error('MCP server cleanup obligation does not match pending state.');
      }
      servers.delete(key(obligation.tenantId, obligation.resourceId));
      delete registry.servers[key(obligation.tenantId, obligation.resourceId)];
      await cleanupRepository.completeMcpDeletion({
        obligationId: obligation.obligationId,
        tenantId: obligation.tenantId,
        resourceId: obligation.resourceId,
      }, client);
      runtimeAudit(
        { tenantId: obligation.tenantId, actorId: 'system' },
        obligation.workspaceId,
        obligation.resourceId,
        'cleanup_recovered',
        obligation.correlationId,
        { mode: 'managed', state: 'ready', reason: 'READY' },
        'succeeded',
        'cleanup',
      );
      return { state: snapshot(), result: { serverId: obligation.resourceId, deleted: true } };
    });
  }

  // Standard MCP wire protocol (JSON-RPC 2.0) for a HOSTED per-workspace server, so an external MCP
  // client can `initialize` → `tools/list` → `tools/call` against a tenant's published server. The
  // server is ALWAYS resolved from the credential-derived identity + the URL serverId (requireServer
  // rejects a cross-tenant id with 404); the tenant/workspace are NEVER taken from the message. This
  // reuses the same engine internals as the management API: `tools/list` reads the active published
  // manifest, `tools/call` goes through `executeMcp('call_tool')` (quota/rate/scope/telemetry/audit
  // all unchanged). Scope failures surface as a tool-level `isError` result (MCP convention), not a
  // JSON-RPC error. Notifications (no id) are acknowledged with no body.
  //   Deferred (tracked, not in this change): Streamable-HTTP SSE transport, sessions, resources/*,
  //   prompts/* — a standard client can list+call tools over plain JSON-RPC POST without them.
  async function executeMcpRpc({ identity, workspaceId, serverId, message, beforeDispatch } = {}) {
    await ensureLoaded();
    const { id, method, params } = message ?? {};
    const isNotification = id === undefined || id === null;
    if (!identity?.tenantId) throw httpError(401, 'UNAUTHENTICATED', 'Missing tenant identity');
    const tid = identity.tenantId;
    try {
      // Resolve the credential-scoped server before invoking the dependency hook. This preserves
      // tenant-safe not-found behavior even when the shared Knative runtime is unavailable.
      const entry = requireServer(identity, serverId, workspaceId);
      if (beforeDispatch) await beforeDispatch({ entry, isNotification, method });
      switch (method) {
        case 'initialize': {
          const registered = getServer(registry, tid, serverId);
          return rpc(id, {
            protocolVersion: PROTOCOL_VERSION,
            serverInfo: { name: entry.name, version: registered?.activeVersion ?? '0.0.0' },
            capabilities: { tools: {} },
          });
        }
        case 'notifications/initialized':
        case 'notifications/cancelled':
          return null; // JSON-RPC notification — acknowledged, no response body
        case 'ping':
          return rpc(id, {});
        case 'tools/list': {
          requireServer(identity, serverId, workspaceId);
          const registered = getServer(registry, tid, serverId);
          const active = registered?.versions?.find((v) => v.version === registered.activeVersion);
          const tools = (active?.tools ?? []).map((t) => ({
            name: t.name,
            description: t.description ?? '',
            inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
          }));
          return rpc(id, { tools });
        }
        case 'tools/call': {
          if (!params?.name) return rpcErr(id, -32602, 'tools/call requires params.name');
          const out = await executeMcp({
            operation: 'call_tool', identity, workspaceId, serverId,
            body: { name: params.name, arguments: params.arguments ?? {} },
          });
          return rpc(id, { content: out.content ?? [], isError: !!out.result?.isError });
        }
        default:
          return rpcErr(id, -32601, `method not found: ${method ?? ''}`);
      }
    } catch (err) {
      if (isNotification) return null; // never answer a notification, even on error
      const code = err.rpcCode ?? (err.statusCode === 429 ? -32003 : -32001);
      const response = rpcErr(id, code, err.rpcMessage ?? err.message ?? 'MCP error');
      if (err.rpcData) response.error.data = err.rpcData;
      return response;
    }
  }

  return {
    executeMcp,
    executeMcpRpc,
    assertOwnedServer,
    deferServerDeletion: (params) => deferHostedServers(params),
    deferTenantTeardown: (params) => deferHostedServers({ ...params, reason: 'tenant_teardown' }),
    deferCapabilityDisable: (params) => deferHostedServers({ ...params, reason: 'capability_disable', allTenants: true }),
    completeDeferredDeletion,
    ensureSchema: () => store?.ensureSchema?.() ?? Promise.resolve(),
  };
}
