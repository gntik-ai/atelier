package.loaded["apisix.core"] = {
  json = { encode = function(payload) return payload end },
  schema = { check = function() return true end },
  response = { set_header = function() end, exit = function(status, body) return { status = status, body = body } end },
  request = { set_header = function(ctx, name, value) ctx.headers = ctx.headers or {}; ctx.headers[name] = value end },
  table = { clone = function(tbl) return tbl end }
}
package.loaded["resty.lrucache"] = { new = function() local data = {}; return { get = function(_, k) return data[k] end, set = function(_, k, v) data[k] = v end, flush_all = function() data = {} end } end }
package.loaded["resty.http"] = { new = function() return { set_timeout = function() end, request_uri = function() return { status = 202 } end } end }
ngx = { timer = { at = function(_, fn, payload) _G.last_event = payload; if fn then fn(nil, payload) end end } }

local plugin = dofile('/root/projects/falcone/services/gateway-config/plugins/scope-enforcement.lua')

local function ctx(method, path, role, domain)
  return {
    var = { request_method = method, uri = path, request_id = 'req-1' },
    jwt_auth_payload = { scope = 'docs:read', tenant_id = 'tenant-1', workspace_id = 'ws-1', role = role or 'tenant_owner', sub = 'actor-1', actor_type = 'user', privilege_domain = domain },
    scope_plan_entitlements = {},
    headers = {}
  }
end

describe('scope-enforcement privilege-domain', function()
  it('passes when credential domain matches required domain', function()
    plugin.fetch_endpoint_privilege_domain = function() return 'data_access' end
    local result = plugin.evaluate_privilege_domain(ctx('GET', '/v1/collections/a/documents', 'tenant_owner', 'data_access'), { tenant_id = 'tenant-1', workspace_id = 'ws-1', role = 'tenant_owner', actor_id = 'actor-1', actor_type = 'user', privilege_domain = 'data_access' })
    assert.is_nil(result)
  end)

  it('blocks mismatch when enforcement enabled', function()
    os.setenv('PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED', 'true')
    plugin.fetch_endpoint_privilege_domain = function() return 'structural_admin' end
    local result = plugin.evaluate_privilege_domain(ctx('POST', '/v1/schemas', 'tenant_owner', 'data_access'), { tenant_id = 'tenant-1', workspace_id = 'ws-1', role = 'tenant_owner', actor_id = 'actor-1', actor_type = 'user', privilege_domain = 'data_access' })
    assert.equals(403, result.status)
    os.setenv('PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED', 'false')
  end)

  it('allows mismatch in log-only mode', function()
    plugin.fetch_endpoint_privilege_domain = function() return 'structural_admin' end
    local request = ctx('POST', '/v1/schemas', 'tenant_owner', 'data_access')
    local result = plugin.evaluate_privilege_domain(request, { tenant_id = 'tenant-1', workspace_id = 'ws-1', role = 'tenant_owner', actor_id = 'actor-1', actor_type = 'user', privilege_domain = 'data_access' })
    assert.is_nil(result)
    assert.equals('data_access', request.headers['X-Privilege-Domain'])
  end)

  it('blocks unclassified endpoint when enforcement enabled', function()
    os.setenv('PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED', 'true')
    plugin.fetch_endpoint_privilege_domain = function() return nil end
    local result = plugin.evaluate_privilege_domain(ctx('GET', '/v1/unknown', 'tenant_owner', 'data_access'), { tenant_id = 'tenant-1', workspace_id = 'ws-1', role = 'tenant_owner', actor_id = 'actor-1', actor_type = 'user', privilege_domain = 'data_access' })
    assert.equals(403, result.status)
    os.setenv('PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED', 'false')
  end)

  it('bypasses platform admin', function()
    plugin.fetch_endpoint_privilege_domain = function() return 'structural_admin' end
    local request = ctx('POST', '/v1/schemas', 'platform_admin', 'data_access')
    local result = plugin.evaluate_privilege_domain(request, { tenant_id = 'tenant-1', workspace_id = 'ws-1', role = 'platform_admin', actor_id = 'actor-1', actor_type = 'user', privilege_domain = 'data_access' })
    assert.is_nil(result)
    assert.equals('platform_admin', request.headers['X-Privilege-Domain'])
  end)

  it('treats missing domain claim as none', function()
    os.setenv('PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED', 'true')
    plugin.fetch_endpoint_privilege_domain = function() return 'data_access' end
    local result = plugin.evaluate_privilege_domain(ctx('GET', '/v1/collections/a/documents', 'tenant_owner', nil), { tenant_id = 'tenant-1', workspace_id = 'ws-1', role = 'tenant_owner', actor_id = 'actor-1', actor_type = 'user' })
    assert.equals(403, result.status)
    os.setenv('PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED', 'false')
  end)

  it('uses cache hit without refetching', function()
    local calls = 0
    plugin.fetch_endpoint_privilege_domain = function() calls = calls + 1; return 'data_access' end
    plugin.resolve_required_domain('GET', '/v1/collections/a/documents')
    plugin.resolve_required_domain('GET', '/v1/collections/a/documents')
    assert.equals(1, calls)
  end)

  it('invalidates cache', function()
    plugin.fetch_endpoint_privilege_domain = function() return 'data_access' end
    plugin.resolve_required_domain('GET', '/v1/collections/a/documents')
    plugin.invalidate_privilege_domain_cache()
    local _, cache_hit = plugin.resolve_required_domain('GET', '/v1/collections/a/documents')
    assert.is_false(cache_hit)
  end)
end)
