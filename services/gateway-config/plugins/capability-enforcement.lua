local core = require("apisix.core")
local lrucache = require("resty.lrucache")
local http = require("resty.http")
local yaml = require("tinyyaml")

local plugin_name = "capability-enforcement"
local _M = { version = 0.1, priority = 2850, name = plugin_name }

local capability_cache
local route_map = {}
local route_map_loaded = false

local schema = {
  type = "object",
  properties = {
    capability_resolution_url = { type = "string" },
    cache_ttl_seconds = { type = "integer", default = 120, minimum = 10 },
    cache_max_entries = { type = "integer", default = 500, minimum = 50 },
    deny_on_resolution_failure = { type = "boolean", default = true },
    audit_sidecar_url = { type = "string" },
    upgrade_path_url = { type = "string", default = "/plans/upgrade" }
  }
}

_M.schema = schema

local function get_env(name, default_val)
  return os.getenv(name) or default_val
end

local function load_route_map(file_path)
  local path = file_path or get_env("CAPABILITY_GATED_ROUTES_PATH", "/etc/apisix/capability-gates/capability-gated-routes.yaml")
  local f = io.open(path, "r")
  if not f then return {} end
  local content = f:read("*a")
  f:close()
  local parsed = yaml.parse(content)
  if not parsed or not parsed.capability_gates then return {} end

  local map = {}
  for _, gate in ipairs(parsed.capability_gates) do
    for _, route in ipairs(gate.routes or {}) do
      local key = (route.method or "*") .. ":" .. (route.path or "")
      map[key] = gate.capability
    end
  end
  return map
end

local function match_route(method, uri, map)
  -- Try exact match first
  local exact = map[method .. ":" .. uri] or map["*:" .. uri]
  if exact then return exact end

  -- Try wildcard matching (convert APISIX radixtree patterns)
  for key, capability in pairs(map) do
    local route_method, route_path = key:match("^([^:]+):(.+)$")
    if route_method and (route_method == "*" or route_method == method) then
      local pattern = "^" .. route_path:gsub("%*", "[^/]+") .. "$"
      if uri:match(pattern) then return capability end
    end
  end
  return nil
end

local function get_claims(ctx)
  local claims = (ctx.var and ctx.var.jwt_claims) or ctx.jwt_auth_payload
    or (ctx.authenticated_consumer and ctx.authenticated_consumer.claims)
  if not claims then return nil end
  return {
    tenant_id = claims.tenant_id,
    actor_id = claims.sub or claims.client_id or "anonymous",
    actor_type = claims.actor_type or "user",
    plan_id = claims.plan_id
  }
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
    resource = (ctx.var and ctx.var.uri) or "",
    retryable = status == 503
  }
end

local function emit_audit_event(conf, ctx, claims, capability, reason)
  local sidecar_url = conf.audit_sidecar_url or get_env("CAPABILITY_AUDIT_SIDECAR_URL", "http://127.0.0.1:19092/denials")
  local event = {
    eventType = "capability_enforcement_denied",
    tenantId = claims and claims.tenant_id or "",
    workspaceId = nil,
    actorId = claims and claims.actor_id or "anonymous",
    actorType = claims and claims.actor_type or "user",
    capability = capability,
    reason = reason,
    channel = "gateway",
    resourcePath = (ctx.var and ctx.var.uri) or "",
    httpMethod = (ctx.var and ctx.var.request_method) or "",
    requestId = (ctx.var and ctx.var.request_id) or "",
    correlationId = (ctx.var and (ctx.var.http_x_correlation_id or ctx.var.request_id)) or "",
    sourceIp = (ctx.var and ctx.var.remote_addr) or "",
    occurredAt = os.date("!%Y-%m-%dT%H:%M:%SZ")
  }
  -- Fire-and-forget via ngx.timer
  if ngx and ngx.timer and ngx.timer.at then
    ngx.timer.at(0, function(_, payload)
      local httpc = http.new()
      httpc:set_timeout(2000)
      pcall(function()
        httpc:request_uri(sidecar_url, {
          method = "POST",
          body = core.json.encode(payload),
          headers = { ["Content-Type"] = "application/json" }
        })
      end)
    end, event)
  end
end

local function emit_metric(result, capability)
  -- Prometheus metric stub: capability_enforcement_total{result,capability}
  -- In production, this hooks into the APISIX prometheus plugin shared dict
  if _M._metric_callback then
    _M._metric_callback(result, capability)
  end
end

local function resolve_capabilities(conf, tenant_id)
  local resolution_url = conf.capability_resolution_url or get_env("CAPABILITY_RESOLUTION_URL", "http://provisioning-orchestrator:8080")
  local url = resolution_url .. "/v1/tenant/effective-capabilities?tenantId=" .. tenant_id
  local httpc = http.new()
  httpc:set_timeout(5000)
  local res, err = httpc:request_uri(url, { method = "GET", headers = { ["Content-Type"] = "application/json" } })
  if not res or res.status ~= 200 then
    return nil, err or ("HTTP " .. (res and res.status or "unknown"))
  end
  local body = core.json.decode(res.body)
  if not body or not body.capabilities then
    return nil, "invalid response body"
  end
  return body, nil
end

function _M.access(conf, ctx)
  local enforcement_enabled = get_env("CAPABILITY_ENFORCEMENT_ENABLED", "false")
  if enforcement_enabled ~= "true" then return end

  if not route_map_loaded then
    route_map = load_route_map(conf.route_map_path)
    local cache_max = conf.cache_max_entries or tonumber(get_env("CAPABILITY_CACHE_MAX_ENTRIES", "500")) or 500
    capability_cache = lrucache.new(cache_max)
    route_map_loaded = true
  end

  local method = (ctx.var and ctx.var.request_method) or "GET"
  local uri = (ctx.var and ctx.var.uri) or ""
  local required_capability = match_route(method, uri, route_map)
  if not required_capability then
    return -- not gated, PASS
  end

  local claims = get_claims(ctx)
  if not claims or not claims.tenant_id then
    emit_metric("deny", required_capability)
    return deny(ctx, 403, "GW_CAPABILITY_NOT_ENTITLED", {
      message = "Your current plan does not include this capability.",
      capability = required_capability,
      reason = "plan_restriction",
      upgradePath = conf.upgrade_path_url or get_env("CAPABILITY_UPGRADE_PATH_URL", "/plans/upgrade")
    })
  end

  local cache_ttl = conf.cache_ttl_seconds or tonumber(get_env("CAPABILITY_CACHE_TTL_SECONDS", "120")) or 120
  local cached = capability_cache and capability_cache:get(claims.tenant_id)
  local capabilities

  if cached then
    capabilities = cached
  else
    local resolved, resolve_err = resolve_capabilities(conf, claims.tenant_id)
    if not resolved then
      local deny_on_failure = conf.deny_on_resolution_failure
      if deny_on_failure == nil then deny_on_failure = true end
      emit_audit_event(conf, ctx, claims, required_capability, "plan_unresolvable")
      emit_metric("degraded", required_capability)
      if deny_on_failure then
        return deny(ctx, 503, "GW_CAPABILITY_RESOLUTION_DEGRADED", {
          message = "Capability resolution is temporarily unavailable. Please retry."
        })
      else
        return -- emergency pass
      end
    end
    capabilities = resolved.capabilities
    if capability_cache then
      capability_cache:set(claims.tenant_id, capabilities, cache_ttl)
    end
  end

  local enabled = capabilities[required_capability]
  if enabled == true then
    emit_metric("allow", required_capability)
    return -- PASS
  end

  -- Determine reason
  local reason = "plan_restriction"
  -- If we had override info we could set "override_restriction" but the
  -- resolved capabilities endpoint returns a flat map, so we default to plan_restriction.

  emit_audit_event(conf, ctx, claims, required_capability, reason)
  emit_metric("deny", required_capability)
  return deny(ctx, 403, "GW_CAPABILITY_NOT_ENTITLED", {
    message = "Your current plan does not include this capability.",
    capability = required_capability,
    reason = reason,
    upgradePath = conf.upgrade_path_url or get_env("CAPABILITY_UPGRADE_PATH_URL", "/plans/upgrade"),
    currentPlanId = claims.plan_id
  })
end

-- Expose internals for testing
_M.load_route_map = load_route_map
_M.match_route = match_route
_M.resolve_capabilities = resolve_capabilities
_M._set_route_map = function(map) route_map = map; route_map_loaded = true end
_M._set_cache = function(cache) capability_cache = cache end
_M._reset = function() route_map = {}; route_map_loaded = false; capability_cache = nil end

return _M
