package.loaded["apisix.core"] = {
  json = { encode = function(payload) return payload end },
  schema = { check = function() return true end },
  response = { set_header = function() end, exit = function(status, body) return { status = status, body = body } end },
  request = { set_header = function(ctx, name, value) ctx.headers = ctx.headers or {}; ctx.headers[name] = value end },
  table = { clone = function(tbl) return tbl end }
}
package.loaded["resty.lrucache"] = { new = function() local data = {}; return { get = function(_, k) return data[k] end, set = function(_, k, v) data[k] = v end, flush_all = function() data = {} end } end }
package.loaded["resty.http"] = { new = function() return { set_timeout = function() end, request_uri = function() return { status = 202 } end } end }
ngx = { timer = { at = function(_, fn, payload) _G.last_function_event = payload; if fn then fn(nil, payload) end end } }

local plugin = dofile('/root/projects/falcone/services/gateway-config/plugins/scope-enforcement.lua')

local function ctx(method, path, domain, subdomains)
  return {
    var = { request_method = method, uri = path, request_id = 'req-1' },
    jwt_auth_payload = { scope = 'docs:read', tenant_id = 'tenant-1', workspace_id = 'ws-1', role = 'tenant_owner', sub = 'actor-1', actor_type = 'service_account', privilege_domain = domain, function_privileges = subdomains or {} },
    scope_plan_entitlements = {},
    headers = {}
  }
end

describe('scope-enforcement function subdomain', function()
  it('deploy-only blocks invoke path when enforcement enabled', function()
    os.setenv('FUNCTION_PRIVILEGE_ENFORCEMENT_ENABLED', 'true')
    plugin.fetch_endpoint_function_subdomain = function() return 'function_invocation' end
    local request = ctx('POST', '/v1/functions/actions/fn-1/invocations', 'data_access', { 'function_deployment' })
    local result = plugin.evaluate_function_subdomain(request, { tenant_id = 'tenant-1', workspace_id = 'ws-1', actor_id = 'actor-1', actor_type = 'service_account', privilege_domain = 'data_access', function_subdomains = { 'function_deployment' } })
    assert.equals(403, result.status)
    assert.equals('function_invocation', result.body.requiredSubdomain)
    os.setenv('FUNCTION_PRIVILEGE_ENFORCEMENT_ENABLED', 'false')
  end)

  it('invoke-only blocks deploy path when enforcement enabled', function()
    os.setenv('FUNCTION_PRIVILEGE_ENFORCEMENT_ENABLED', 'true')
    plugin.fetch_endpoint_function_subdomain = function() return 'function_deployment' end
    local request = ctx('POST', '/v1/functions/workspaces/ws-1/packages', 'structural_admin', { 'function_invocation' })
    local result = plugin.evaluate_function_subdomain(request, { tenant_id = 'tenant-1', workspace_id = 'ws-1', actor_id = 'actor-1', actor_type = 'service_account', privilege_domain = 'structural_admin', function_subdomains = { 'function_invocation' } })
    assert.equals(403, result.status)
    assert.equals('function_deployment', result.body.requiredSubdomain)
    os.setenv('FUNCTION_PRIVILEGE_ENFORCEMENT_ENABLED', 'false')
  end)

  it('dual-role passes both classes of path', function()
    plugin.fetch_endpoint_function_subdomain = function() return 'function_invocation' end
    local request = ctx('POST', '/v1/functions/actions/fn-1/invocations', 'data_access', { 'function_deployment', 'function_invocation' })
    local result = plugin.evaluate_function_subdomain(request, { tenant_id = 'tenant-1', workspace_id = 'ws-1', actor_id = 'actor-1', actor_type = 'service_account', privilege_domain = 'data_access', function_subdomains = { 'function_deployment', 'function_invocation' } })
    assert.is_nil(result)
    assert.equals('function_invocation', request.headers['X-Function-Privilege-Subdomain'])
  end)

  it('top-level domain can be correct but subdomain still denied', function()
    os.setenv('FUNCTION_PRIVILEGE_ENFORCEMENT_ENABLED', 'true')
    plugin.fetch_endpoint_function_subdomain = function() return 'function_invocation' end
    local request = ctx('POST', '/v1/functions/actions/fn-1/invocations', 'data_access', {})
    local result = plugin.evaluate_function_subdomain(request, { tenant_id = 'tenant-1', workspace_id = 'ws-1', actor_id = 'actor-1', actor_type = 'user', privilege_domain = 'data_access', function_subdomains = {} })
    assert.equals(403, result.status)
    os.setenv('FUNCTION_PRIVILEGE_ENFORCEMENT_ENABLED', 'false')
  end)

  it('unclassified function endpoint does not regress', function()
    plugin.fetch_endpoint_function_subdomain = function() return nil end
    local request = ctx('GET', '/v1/functions/workspaces/ws-1/actions', 'data_access', {})
    local result = plugin.evaluate_function_subdomain(request, { tenant_id = 'tenant-1', workspace_id = 'ws-1', actor_id = 'actor-1', actor_type = 'user', privilege_domain = 'data_access', function_subdomains = {} })
    assert.is_nil(result)
  end)
end)
