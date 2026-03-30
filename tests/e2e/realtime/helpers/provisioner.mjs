function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const PROVISIONING_API_BASE_URL = requireEnv('PROVISIONING_API_BASE_URL');
const PROVISIONING_ADMIN_TOKEN = requireEnv('PROVISIONING_ADMIN_TOKEN');

function createHeaders(extra = {}) {
  return {
    accept: 'application/json',
    authorization: `Bearer ${PROVISIONING_ADMIN_TOKEN}`,
    ...extra
  };
}

async function parseResponse(response) {
  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function createProvisioner({ logger = console } = {}) {
  const resources = {
    tenants: new Set(),
    workspaces: new Set(),
    channels: new Set()
  };

  async function request(path, init = {}, { swallowError = false } = {}) {
    const response = await fetch(`${PROVISIONING_API_BASE_URL}${path}`, init);
    if (!response.ok) {
      const body = await parseResponse(response);
      const error = new Error(`Provisioner request failed (${response.status}) ${path}: ${JSON.stringify(body)}`);
      if (swallowError) {
        logger.warn(error.message);
        return null;
      }
      throw error;
    }
    return parseResponse(response);
  }

  return {
    resources,
    async createTestTenant(label) {
      const payload = { label, purpose: 'realtime-e2e' };
      const body = await request('/tenants', {
        method: 'POST',
        headers: createHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify(payload)
      });
      resources.tenants.add(body.tenantId);
      return { tenantId: body.tenantId, adminToken: body.adminToken };
    },
    async createTestWorkspace(tenantId) {
      const body = await request('/workspaces', {
        method: 'POST',
        headers: createHeaders({ 'content-type': 'application/json', 'x-tenant-id': tenantId }),
        body: JSON.stringify({ tenantId, purpose: 'realtime-e2e' })
      });
      resources.workspaces.add(body.workspaceId);
      return { workspaceId: body.workspaceId };
    },
    async registerPgDataSource({ workspaceId, tables }) {
      const body = await request('/channels/postgres', {
        method: 'POST',
        headers: createHeaders({ 'content-type': 'application/json', 'x-workspace-id': workspaceId }),
        body: JSON.stringify({ workspaceId, tables })
      });
      resources.channels.add(body.channelId);
      return { channelId: body.channelId };
    },
    async registerMongoDataSource({ workspaceId, collections }) {
      const body = await request('/channels/mongodb', {
        method: 'POST',
        headers: createHeaders({ 'content-type': 'application/json', 'x-workspace-id': workspaceId }),
        body: JSON.stringify({ workspaceId, collections })
      });
      resources.channels.add(body.channelId);
      return { channelId: body.channelId };
    },
    async deleteSubscription(subscriptionId) {
      await request(`/subscriptions/${subscriptionId}`, {
        method: 'DELETE',
        headers: createHeaders()
      }, { swallowError: true });
    },
    async getSubscription(subscriptionId) {
      return request(`/subscriptions/${subscriptionId}`, {
        method: 'GET',
        headers: createHeaders()
      });
    },
    async createSubscription({ token, workspaceId, channelId, filter }) {
      return request('/subscriptions', {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ workspaceId, channelId, filter })
      });
    },
    async deprovisionWorkspace(workspaceId) {
      await request(`/workspaces/${workspaceId}`, {
        method: 'DELETE',
        headers: createHeaders()
      }, { swallowError: true });
      resources.workspaces.delete(workspaceId);
    },
    async deprovisionTenant(tenantId) {
      await request(`/tenants/${tenantId}`, {
        method: 'DELETE',
        headers: createHeaders()
      }, { swallowError: true });
      resources.tenants.delete(tenantId);
    }
  };
}

export default createProvisioner;
