local core = require("apisix.core")
local lrucache = require("resty.lrucache")

local plugin_name = "scope-enforcement"
local _M = { version = 0.1, priority = 2900, name = plugin_name }
local requirements_cache = lrucache.new(200)

local schema = {
  type = "object",
  properties = {
    required_scopes = { type = "array", items = { type = "string" } },
    required_entitlements = { type = "array", items = { type = "string" } },
    workspace_scoped = { type = "boolean", default = true }
  }
}

_M.schema = schema

local function split_scopes(scope_claim)
  if type(scope_claim) == "table" then return scope_claim end
  local scopes = {}
  if type(scope_claim) ~= "string" then return scopes end
  for token in string.gmatch(scope_claim, "%S+") do table.insert(scopes, token) end
  return scopes
end

local function get_claims(ctx)
  local claims = (ctx.var and ctx.var.jwt_claims) or ctx.jwt_auth_payload or ctx.authenticated_consumer and ctx.authenticated_consumer.claims
  if not claims then return nil end
  return {
    scopes = split_scopes(claims.scope or claims.scp or {}),
    workspace_id = claims.workspace_id,
    tenant_id = claims.tenant_id,
    plan_id = claims.plan_id,
    role = claims.role,
    actor_id = claims.sub or claims.client_id or "anonymous",
    actor_type = claims.actor_type or "user"
  }
end

local function array_to_set(items)
  local set = {}
  for _, item in ipairs(items or {}) do set[item] = true end
  return set
end

local function missing_items(have_items, need_items)
  local set = array_to_set(have_items)
  local missing = {}
  for _, item in ipairs(need_items or {}) do if not set[item] then table.insert(missing, item) end end
  return missing
end

local function extract_workspace_id(ctx)
  local uri = (ctx.var and ctx.var.uri) or ""
  return string.match(uri, "/workspaces/([^/]+)")
end

local function deny(ctx, status, code, detail)
  core.response.set_header("Content-Type", "application/json")
  return status, {
    status = status,
    code = code,
    message = detail and detail.message or code,
    detail = detail or {},
    requestId = (ctx.var and ctx.var.request_id) or "",
    correlationId = (ctx.var and (ctx.var.http_x_correlation_id or ctx.var.request_id)) or "",
    timestamp = os.date("!%Y-%m-%dT%H:%M:%SZ"),
    resource = (ctx.var and ctx.var.uri) or ""
  }
end

local function resolve_requirements(conf, ctx)
  if conf.required_scopes and #conf.required_scopes > 0 then return conf end
  local cache_key = ((ctx.var and ctx.var.request_method) or "GET") .. ":" .. ((ctx.var and ctx.var.uri) or "")
  local cached = requirements_cache:get(cache_key)
  if cached then return cached end
  return nil
end

local function emit_denial_event(_, payload)
  local http = require("resty.http")
  local client = http.new()
  client:set_timeout(200)
  client:request_uri(os.getenv("SCOPE_ENFORCEMENT_SIDECAR_URL") or "http://127.0.0.1:19092/denials", { method = "POST", body = core.json.encode(payload), headers = { ["Content-Type"] = "application/json" } })
end

function _M.check_schema(conf)
  return core.schema.check(schema, conf)
end

function _M.access(conf, ctx)
  local claims = get_claims(ctx)
  if not claims then
    return core.response.exit(401, deny(ctx, 401, "UNAUTHENTICATED", { message = "Authentication claims missing" }))
  end

  local req = resolve_requirements(conf, ctx)
  if not req then
    local payload = { denial_type = "CONFIG_ERROR", tenant_id = claims.tenant_id, actor_id = claims.actor_id, actor_type = claims.actor_type, http_method = ctx.var.request_method, request_path = ctx.var.uri, presented_scopes = claims.scopes, source_ip = ctx.var.remote_addr, correlation_id = ctx.var.http_x_correlation_id or ctx.var.request_id, denied_at = os.date("!%Y-%m-%dT%H:%M:%SZ") }
    ngx.timer.at(0, emit_denial_event, payload)
    return core.response.exit(403, deny(ctx, 403, "CONFIG_ERROR", { message = "Endpoint scope requirements not declared" }))
  end

  local missing_scopes = missing_items(claims.scopes, req.required_scopes or {})
  if #missing_scopes > 0 then
    ngx.timer.at(0, emit_denial_event, { denial_type = "SCOPE_INSUFFICIENT", tenant_id = claims.tenant_id, workspace_id = claims.workspace_id, actor_id = claims.actor_id, actor_type = claims.actor_type, http_method = ctx.var.request_method, request_path = ctx.var.uri, required_scopes = req.required_scopes or {}, presented_scopes = claims.scopes, missing_scopes = missing_scopes, source_ip = ctx.var.remote_addr, correlation_id = ctx.var.http_x_correlation_id or ctx.var.request_id, denied_at = os.date("!%Y-%m-%dT%H:%M:%SZ") })
    return core.response.exit(403, deny(ctx, 403, "SCOPE_INSUFFICIENT", { required_scopes = req.required_scopes or {}, presented_scopes = claims.scopes, missing_scopes = missing_scopes, message = "Token scopes do not satisfy the requirements for this resource." }))
  end

  if req.workspace_scoped ~= false then
    local requested_workspace_id = extract_workspace_id(ctx)
    if requested_workspace_id and claims.role ~= "platform_admin" and claims.workspace_id and requested_workspace_id ~= claims.workspace_id then
      ngx.timer.at(0, emit_denial_event, { denial_type = "WORKSPACE_SCOPE_MISMATCH", tenant_id = claims.tenant_id, workspace_id = requested_workspace_id, actor_id = claims.actor_id, actor_type = claims.actor_type, http_method = ctx.var.request_method, request_path = ctx.var.uri, presented_scopes = claims.scopes, source_ip = ctx.var.remote_addr, correlation_id = ctx.var.http_x_correlation_id or ctx.var.request_id, denied_at = os.date("!%Y-%m-%dT%H:%M:%SZ") })
      return core.response.exit(403, deny(ctx, 403, "WORKSPACE_SCOPE_MISMATCH", { token_workspace_id = claims.workspace_id, requested_workspace_id = requested_workspace_id, message = "Token is not authorized for the requested workspace." }))
    end
  end

  local plan_entitlements = core.table.clone((ctx.scope_plan_entitlements or {}))
  local missing_entitlements = missing_items(plan_entitlements, req.required_entitlements or {})
  if #missing_entitlements > 0 then
    ngx.timer.at(0, emit_denial_event, { denial_type = "PLAN_ENTITLEMENT_DENIED", tenant_id = claims.tenant_id, workspace_id = claims.workspace_id, actor_id = claims.actor_id, actor_type = claims.actor_type, http_method = ctx.var.request_method, request_path = ctx.var.uri, required_scopes = req.required_scopes or {}, presented_scopes = claims.scopes, required_entitlement = missing_entitlements[1], current_plan_id = claims.plan_id, source_ip = ctx.var.remote_addr, correlation_id = ctx.var.http_x_correlation_id or ctx.var.request_id, denied_at = os.date("!%Y-%m-%dT%H:%M:%SZ") })
    return core.response.exit(403, deny(ctx, 403, "PLAN_ENTITLEMENT_DENIED", { required_entitlement = missing_entitlements[1], current_plan_id = claims.plan_id, message = "Your current plan does not include this capability." }))
  end

  core.request.set_header(ctx, "X-Enforcement-Verified", "true")
  core.request.set_header(ctx, "X-Verified-Tenant-Id", claims.tenant_id or "")
  core.request.set_header(ctx, "X-Verified-Workspace-Id", claims.workspace_id or "")
end

return _M
