import { randomBytes, randomUUID } from 'node:crypto';
import { del, get, post } from './http-client.mjs';

const fixtureState = new Map();

function authHeaders() {
  const token = process.env.SUPERADMIN_TOKEN;
  if (!token) {
    throw new Error('SUPERADMIN_TOKEN is required to provision hardening fixtures');
  }
  return { Authorization: `Bearer ${token}` };
}

function randomSecret() {
  return randomBytes(32).toString('hex');
}

async function createResource(path, body) {
  const response = await post(path, { headers: authHeaders(), body });
  if (response.status === 409) {
    return response.body;
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Failed to create resource at ${path}: HTTP ${response.status}`);
  }
  return response.body;
}

async function deleteResource(path) {
  const response = await del(path, { headers: authHeaders() });
  if ([200, 202, 204, 404].includes(response.status)) {
    return;
  }
  throw new Error(`Failed to delete resource at ${path}: HTTP ${response.status}`);
}

async function createApiKey(workspaceId, payload) {
  const body = {
    workspaceId,
    name: payload.name,
    scopes: payload.scopes,
    privilegeDomains: payload.privilegeDomains,
    planTier: payload.planTier,
    tags: payload.tags,
    secret: randomSecret(),
  };
  const response = await createResource('/v1/admin/api-keys', body);
  return response.apiKey ?? response.token ?? response.secret ?? body.secret;
}

async function seedVaultSecrets(tenantId, runId) {
  if (!process.env.VAULT_ADDR || !process.env.VAULT_TOKEN) {
    return {
      activeSecretPath: `tenant/${tenantId}/hardening-${runId}/active`,
      rotatedSecretPath: `tenant/${tenantId}/hardening-${runId}/rotated`,
      webhookSigningSecretId: `hardening-webhook-${runId}`,
    };
  }

  const { default: vaultFactory } = await import('node-vault');
  const vault = vaultFactory({
    endpoint: process.env.VAULT_ADDR,
    token: process.env.VAULT_TOKEN,
  });

  const basePath = `tenant/${tenantId}/hardening-${runId}`;
  await vault.write(basePath, {
    active: randomSecret(),
    rotated: randomSecret(),
    webhook: randomSecret(),
  }).catch(() => {});

  return {
    activeSecretPath: `${basePath}/active`,
    rotatedSecretPath: `${basePath}/rotated`,
    webhookSigningSecretId: `${basePath}/webhook`,
  };
}

export async function createIsolatedFixture(runId) {
  if (!process.env.APISIX_BASE_URL) {
    throw new Error('APISIX_BASE_URL is required to provision hardening fixtures');
  }

  const tag = `hardening-run-${runId}`;
  const tenant = await createResource('/v1/admin/tenants', {
    name: `hardening-${runId}`,
    tags: [tag],
    planTier: 'enterprise',
  });

  const tenantId = tenant.id ?? tenant.tenantId ?? `tenant-${runId}`;
  const workspace = await createResource('/v1/admin/workspaces', {
    tenantId,
    name: `hardening-${runId}`,
    tags: [tag],
  });
  const workspaceId = workspace.id ?? workspace.workspaceId ?? `workspace-${runId}`;

  const tenantB = await createResource('/v1/admin/tenants', {
    name: `hardening-${runId}-b`,
    tags: [tag],
    planTier: 'free',
  });
  const tenantBId = tenantB.id ?? tenantB.tenantId ?? `tenant-b-${runId}`;
  const workspaceB = await createResource('/v1/admin/workspaces', {
    tenantId: tenantBId,
    name: `hardening-${runId}-b`,
    tags: [tag],
  });
  const workspaceBId = workspaceB.id ?? workspaceB.workspaceId ?? `workspace-b-${runId}`;

  const tags = [tag];
  const credentials = {
    validApiKey: await createApiKey(workspaceId, { name: `valid-${runId}`, scopes: ['storage:read'], privilegeDomains: ['data_access'], planTier: 'enterprise', tags }),
    rotatedOldKey: await createApiKey(workspaceId, { name: `rotated-old-${runId}`, scopes: ['storage:read'], privilegeDomains: ['data_access'], planTier: 'enterprise', tags }),
    revokedApiKey: await createApiKey(workspaceId, { name: `revoked-${runId}`, scopes: ['storage:read'], privilegeDomains: ['data_access'], planTier: 'enterprise', tags }),
    storageReadOnly: await createApiKey(workspaceId, { name: `storage-ro-${runId}`, scopes: ['storage:read'], privilegeDomains: ['data_access'], planTier: 'enterprise', tags }),
    storageReadWrite: await createApiKey(workspaceId, { name: `storage-rw-${runId}`, scopes: ['storage:read', 'storage:write'], privilegeDomains: ['data_access'], planTier: 'enterprise', tags }),
    functionsInvokeOnly: await createApiKey(workspaceId, { name: `fn-invoke-${runId}`, scopes: ['functions:invoke'], privilegeDomains: ['function_invocation'], planTier: 'enterprise', tags }),
    functionsDeployOnly: await createApiKey(workspaceId, { name: `fn-deploy-${runId}`, scopes: ['functions:deploy'], privilegeDomains: ['function_deployment'], planTier: 'enterprise', tags }),
    structuralAdminOnly: await createApiKey(workspaceId, { name: `struct-admin-${runId}`, scopes: ['workspaces:write'], privilegeDomains: ['structural_admin'], planTier: 'enterprise', tags }),
    dataAccessOnly: await createApiKey(workspaceId, { name: `data-access-${runId}`, scopes: ['data:read'], privilegeDomains: ['data_access'], planTier: 'enterprise', tags }),
    freePlanToken: await createApiKey(workspaceBId, { name: `free-${runId}`, scopes: ['enterprise:read'], privilegeDomains: ['data_access'], planTier: 'free', tags }),
    enterprisePlanToken: await createApiKey(workspaceId, { name: `enterprise-${runId}`, scopes: ['professional:read', 'enterprise:read'], privilegeDomains: ['data_access'], planTier: 'enterprise', tags }),
    tenantBToken: await createApiKey(workspaceBId, { name: `tenant-b-${runId}`, scopes: ['storage:read', 'functions:invoke'], privilegeDomains: ['data_access', 'function_invocation'], planTier: 'free', tags }),
    dualDomainCredential: await createApiKey(workspaceId, { name: `dual-domain-${runId}`, scopes: ['data:read', 'workspaces:write'], privilegeDomains: ['data_access', 'structural_admin'], planTier: 'enterprise', tags }),
    fullFunctionCredential: await createApiKey(workspaceId, { name: `full-function-${runId}`, scopes: ['functions:deploy', 'functions:invoke'], privilegeDomains: ['function_deployment', 'function_invocation'], planTier: 'enterprise', tags }),
  };

  const secrets = await seedVaultSecrets(tenantId, runId);
  const fixture = {
    runId,
    tenantId,
    workspaceId,
    tenantBId,
    workspaceBId,
    credentials,
    secrets,
  };

  fixtureState.set(runId, fixture);
  return fixture;
}

export async function teardownFixture(runId) {
  const fixture = fixtureState.get(runId) ?? { runId };
  const tag = `hardening-run-${runId}`;

  if (process.env.VAULT_ADDR && process.env.VAULT_TOKEN && fixture.tenantId) {
    const { default: vaultFactory } = await import('node-vault');
    const vault = vaultFactory({ endpoint: process.env.VAULT_ADDR, token: process.env.VAULT_TOKEN });
    await vault.delete(`tenant/${fixture.tenantId}/hardening-${runId}`).catch(() => {});
  }

  if (!process.env.APISIX_BASE_URL || !process.env.SUPERADMIN_TOKEN) {
    fixtureState.delete(runId);
    return;
  }

  const apiKeys = await get(`/v1/admin/api-keys?tag=${tag}`, { headers: authHeaders() }).catch(() => ({ status: 404, body: { items: [] } }));
  const keyItems = apiKeys.body?.items ?? [];
  for (const item of keyItems) {
    await deleteResource(`/v1/admin/api-keys/${item.id ?? item.apiKeyId ?? item.name}`).catch(() => {});
  }

  if (fixture.workspaceBId) await deleteResource(`/v1/admin/workspaces/${fixture.workspaceBId}`).catch(() => {});
  if (fixture.workspaceId) await deleteResource(`/v1/admin/workspaces/${fixture.workspaceId}`).catch(() => {});
  if (fixture.tenantBId) await deleteResource(`/v1/admin/tenants/${fixture.tenantBId}`).catch(() => {});
  if (fixture.tenantId) await deleteResource(`/v1/admin/tenants/${fixture.tenantId}`).catch(() => {});
  fixtureState.delete(runId);
}
