import test from 'node:test';
import assert from 'node:assert/strict';

// Mock APISIX dependencies before loading the plugin
const auditEvents = [];
const metrics = [];

function resetMocks() {
  auditEvents.length = 0;
  metrics.length = 0;
}

// Simulate the Lua plugin logic in JS for unit testing
// (follows the same pattern as scope-enforcement tests in this repo)

function createCapabilityEnforcement() {
  let routeMap = {};
  let cache = new Map();
  let resolutionHandler = null;

  function matchRoute(method, uri) {
    const exact = routeMap[`${method}:${uri}`] || routeMap[`*:${uri}`];
    if (exact) return exact;
    for (const [key, capability] of Object.entries(routeMap)) {
      const [routeMethod, routePath] = key.split(':');
      if (routeMethod !== '*' && routeMethod !== method) continue;
      const pattern = new RegExp('^' + routePath.replace(/\*/g, '[^/]+') + '$');
      if (pattern.test(uri)) return capability;
    }
    return null;
  }

  function deny(ctx, status, code, detail) {
    return {
      status,
      body: {
        status,
        code,
        message: detail?.message || code,
        detail: detail || {},
        requestId: ctx.requestId || '',
        correlationId: ctx.correlationId || '',
        timestamp: new Date().toISOString(),
        resource: ctx.uri || '',
        retryable: status === 503
      }
    };
  }

  return {
    setRouteMap(map) { routeMap = map; },
    setCache(c) { cache = c; },
    setResolutionHandler(fn) { resolutionHandler = fn; },
    clearCache() { cache.clear(); },

    evaluate(ctx, conf = {}) {
      const method = ctx.method || 'GET';
      const uri = ctx.uri || '';
      const capability = matchRoute(method, uri);
      if (!capability) return { action: 'pass' };

      const tenantId = ctx.tenantId;
      if (!tenantId) {
        return deny(ctx, 403, 'GW_CAPABILITY_NOT_ENTITLED', {
          message: 'Your current plan does not include this capability.',
          capability,
          reason: 'plan_restriction',
          upgradePath: conf.upgrade_path_url || '/plans/upgrade'
        });
      }

      let capabilities = cache.get(tenantId);
      if (!capabilities) {
        if (!resolutionHandler) {
          const denyOnFailure = conf.deny_on_resolution_failure ?? true;
          if (denyOnFailure) {
            return deny(ctx, 503, 'GW_CAPABILITY_RESOLUTION_DEGRADED', {
              message: 'Capability resolution is temporarily unavailable. Please retry.'
            });
          }
          return { action: 'pass' };
        }
        const resolved = resolutionHandler(tenantId);
        if (!resolved) {
          const denyOnFailure = conf.deny_on_resolution_failure ?? true;
          if (denyOnFailure) {
            return deny(ctx, 503, 'GW_CAPABILITY_RESOLUTION_DEGRADED', {
              message: 'Capability resolution is temporarily unavailable. Please retry.'
            });
          }
          return { action: 'pass' };
        }
        capabilities = resolved;
        cache.set(tenantId, capabilities);
      }

      if (capabilities[capability] === true) {
        metrics.push({ result: 'allow', capability });
        return { action: 'pass' };
      }

      metrics.push({ result: 'deny', capability });
      return deny(ctx, 403, 'GW_CAPABILITY_NOT_ENTITLED', {
        message: 'Your current plan does not include this capability.',
        capability,
        reason: 'plan_restriction',
        upgradePath: conf.upgrade_path_url || '/plans/upgrade'
      });
    }
  };
}

test('capability-enforcement: route not gated → PASS without evaluation', () => {
  resetMocks();
  const plugin = createCapabilityEnforcement();
  plugin.setRouteMap({ '*:/v1/workspaces/*/webhooks': 'webhooks' });
  const result = plugin.evaluate({ method: 'GET', uri: '/v1/tenants', tenantId: 'ten_1' });
  assert.deepStrictEqual(result, { action: 'pass' });
});

test('capability-enforcement: route gated + capability true → PASS', () => {
  resetMocks();
  const plugin = createCapabilityEnforcement();
  plugin.setRouteMap({ '*:/v1/workspaces/*/webhooks': 'webhooks' });
  plugin.setResolutionHandler(() => ({ webhooks: true }));
  const result = plugin.evaluate({ method: 'GET', uri: '/v1/workspaces/ws1/webhooks', tenantId: 'ten_1' });
  assert.deepStrictEqual(result, { action: 'pass' });
});

test('capability-enforcement: route gated + capability false → 403', () => {
  resetMocks();
  const plugin = createCapabilityEnforcement();
  plugin.setRouteMap({ '*:/v1/workspaces/*/webhooks': 'webhooks' });
  plugin.setResolutionHandler(() => ({ webhooks: false }));
  const result = plugin.evaluate({ method: 'POST', uri: '/v1/workspaces/ws1/webhooks', tenantId: 'ten_1' });
  assert.equal(result.status, 403);
  assert.equal(result.body.code, 'GW_CAPABILITY_NOT_ENTITLED');
  assert.equal(result.body.detail.capability, 'webhooks');
});

test('capability-enforcement: resolution failure + deny_on_resolution_failure true → 503', () => {
  resetMocks();
  const plugin = createCapabilityEnforcement();
  plugin.setRouteMap({ '*:/v1/workspaces/*/webhooks': 'webhooks' });
  plugin.setResolutionHandler(() => null);
  const result = plugin.evaluate(
    { method: 'GET', uri: '/v1/workspaces/ws1/webhooks', tenantId: 'ten_1' },
    { deny_on_resolution_failure: true }
  );
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'GW_CAPABILITY_RESOLUTION_DEGRADED');
  assert.equal(result.body.retryable, true);
});

test('capability-enforcement: cache hit → does not call resolution endpoint', () => {
  resetMocks();
  let callCount = 0;
  const plugin = createCapabilityEnforcement();
  plugin.setRouteMap({ '*:/v1/workspaces/*/webhooks': 'webhooks' });
  plugin.setResolutionHandler(() => { callCount++; return { webhooks: true }; });

  plugin.evaluate({ method: 'GET', uri: '/v1/workspaces/ws1/webhooks', tenantId: 'ten_1' });
  assert.equal(callCount, 1);
  plugin.evaluate({ method: 'GET', uri: '/v1/workspaces/ws1/webhooks', tenantId: 'ten_1' });
  assert.equal(callCount, 1); // cached, not called again
});

test('capability-enforcement: cache miss → calls endpoint and stores result', () => {
  resetMocks();
  let callCount = 0;
  const plugin = createCapabilityEnforcement();
  plugin.setRouteMap({ '*:/v1/workspaces/*/webhooks': 'webhooks' });
  plugin.setResolutionHandler(() => { callCount++; return { webhooks: false }; });

  const result = plugin.evaluate({ method: 'GET', uri: '/v1/workspaces/ws1/webhooks', tenantId: 'ten_1' });
  assert.equal(callCount, 1);
  assert.equal(result.status, 403);
});

test('capability-enforcement: override additive (plan false, override true) → PASS', () => {
  resetMocks();
  const plugin = createCapabilityEnforcement();
  plugin.setRouteMap({ '*:/v1/workspaces/*/webhooks': 'webhooks' });
  // Simulates resolved capabilities where override made it true despite plan being false
  plugin.setResolutionHandler(() => ({ webhooks: true }));
  const result = plugin.evaluate({ method: 'GET', uri: '/v1/workspaces/ws1/webhooks', tenantId: 'ten_1' });
  assert.deepStrictEqual(result, { action: 'pass' });
});

test('capability-enforcement: override restrictive (plan true, override false) → 403', () => {
  resetMocks();
  const plugin = createCapabilityEnforcement();
  plugin.setRouteMap({ '*:/v1/workspaces/*/webhooks': 'webhooks' });
  // Simulates resolved capabilities where override made it false despite plan being true
  plugin.setResolutionHandler(() => ({ webhooks: false }));
  const result = plugin.evaluate({ method: 'GET', uri: '/v1/workspaces/ws1/webhooks', tenantId: 'ten_1' });
  assert.equal(result.status, 403);
  assert.equal(result.body.code, 'GW_CAPABILITY_NOT_ENTITLED');
});
