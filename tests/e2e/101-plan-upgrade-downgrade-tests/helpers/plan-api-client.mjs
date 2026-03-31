function baseUrl(inputBaseUrl = process.env.TEST_API_BASE_URL) {
  if (!inputBaseUrl) throw new Error('TEST_API_BASE_URL is required');
  return inputBaseUrl.replace(/\/$/, '');
}

function buildHeaders(token, extra = {}) {
  return {
    accept: 'application/json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...extra
  };
}

async function parseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function invoke(method, path, { token, body, query, baseUrl: inputBaseUrl } = {}) {
  const url = new URL(`${baseUrl(inputBaseUrl)}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    method,
    headers: buildHeaders(token, body ? { 'content-type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  const parsed = await parseBody(response);
  const result = { status: response.status, body: parsed };
  if (response.status >= 400) {
    const code = parsed?.code ?? parsed?.error?.code ?? 'HTTP_ERROR';
    return { ...result, code, error: true };
  }
  return result;
}

export function getFixturePlanPayloads() {
  return {
    starter: {
      slug: 'test-starter',
      name: 'Test Starter (E2E fixture — do not use in production)',
      lifecycle_state: 'active',
      quota_dimensions: {
        max_workspaces: 3,
        max_postgres_databases: 2,
        max_mongo_databases: 2,
        max_kafka_topics: 5,
        max_functions: 10,
        max_storage_bytes: 104857600,
        max_api_keys: 5,
        max_members: 5
      },
      capabilities: {
        realtime_enabled: false,
        custom_domains_enabled: false,
        audit_log_export_enabled: false
      }
    },
    professional: {
      slug: 'test-professional',
      name: 'Test Professional (E2E fixture — do not use in production)',
      lifecycle_state: 'active',
      quota_dimensions: {
        max_workspaces: 10,
        max_postgres_databases: 8,
        max_mongo_databases: 8,
        max_kafka_topics: 20,
        max_functions: 50,
        max_storage_bytes: 1073741824,
        max_api_keys: 20,
        max_members: 20
      },
      capabilities: {
        realtime_enabled: true,
        custom_domains_enabled: true,
        audit_log_export_enabled: true
      }
    }
  };
}

export async function assignPlan(tenantId, planSlug, token, options = {}) {
  return invoke('POST', `/v1/tenants/${tenantId}/plan`, { token, baseUrl: options.baseUrl, body: { planSlug, planId: options.planId, assignedBy: options.assignedBy ?? 'e2e-suite', assignmentMetadata: options.assignmentMetadata ?? { source: 'tests/e2e/101-plan-upgrade-downgrade-tests' } } });
}

export async function getEffectiveEntitlements(tenantId, token, options = {}) {
  return invoke('GET', `/v1/tenants/${tenantId}/plan/effective-entitlements`, { token, baseUrl: options.baseUrl });
}

export async function getPlanChangeHistory(tenantId, token, params = {}, options = {}) {
  return invoke('GET', `/v1/tenants/${tenantId}/plan/history-impact`, { token, baseUrl: options.baseUrl, query: params });
}

export async function createPlan(payload, token, options = {}) {
  return invoke('POST', '/v1/plans', { token, baseUrl: options.baseUrl, body: payload });
}

export async function getPlan(planIdOrSlug, token, options = {}) {
  return invoke('GET', `/v1/plans/${planIdOrSlug}`, { token, baseUrl: options.baseUrl });
}

export async function deletePlan(planSlug, token, options = {}) {
  return invoke('DELETE', `/v1/plans/${planSlug}`, { token, baseUrl: options.baseUrl });
}

export async function createTenant(tenantPayload, token, options = {}) {
  const path = options.createTenantPath ?? process.env.TEST_TENANT_CREATE_PATH;
  if (!path) return { status: 501, code: 'TENANT_CREATE_PATH_NOT_CONFIGURED', body: { message: 'Set TEST_TENANT_CREATE_PATH for tenant provisioning in E2E runs' }, error: true };
  return invoke('POST', path, { token, baseUrl: options.baseUrl, body: tenantPayload });
}

export async function deleteTenant(tenantId, token, options = {}) {
  const template = options.deleteTenantPathTemplate ?? process.env.TEST_TENANT_DELETE_PATH_TEMPLATE;
  if (!template) return { status: 501, code: 'TENANT_DELETE_PATH_NOT_CONFIGURED', body: { message: 'Set TEST_TENANT_DELETE_PATH_TEMPLATE for tenant teardown in E2E runs' }, error: true };
  return invoke('DELETE', template.replace('{tenantId}', tenantId), { token, baseUrl: options.baseUrl });
}
