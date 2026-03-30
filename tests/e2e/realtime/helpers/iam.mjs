function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const KEYCLOAK_BASE_URL = requireEnv('KEYCLOAK_BASE_URL');
const KEYCLOAK_REALM = requireEnv('KEYCLOAK_REALM');
const KEYCLOAK_ADMIN_CLIENT_ID = requireEnv('KEYCLOAK_ADMIN_CLIENT_ID');
const KEYCLOAK_ADMIN_SECRET = requireEnv('KEYCLOAK_ADMIN_SECRET');

let adminTokenCache;

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

async function keycloakFetch(path, init = {}, { auth = true } = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('accept', 'application/json');

  if (auth) {
    const token = await getAdminAccessToken();
    headers.set('authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${KEYCLOAK_BASE_URL}${path}`, {
    ...init,
    headers
  });

  if (!response.ok) {
    const body = await parseResponse(response);
    throw new Error(`Keycloak request failed (${response.status}) ${path}: ${JSON.stringify(body)}`);
  }

  return parseResponse(response);
}

async function getAdminAccessToken() {
  const now = Date.now();
  if (adminTokenCache && adminTokenCache.expiresAt > now) {
    return adminTokenCache.token;
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: KEYCLOAK_ADMIN_CLIENT_ID,
    client_secret: KEYCLOAK_ADMIN_SECRET
  });

  const response = await fetch(
    `${KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    }
  );

  if (!response.ok) {
    throw new Error(`Unable to obtain Keycloak admin token (${response.status})`);
  }

  const payload = await response.json();
  adminTokenCache = {
    token: payload.access_token,
    expiresAt: now + Math.max((payload.expires_in - 10) * 1000, 5_000)
  };
  return adminTokenCache.token;
}

function buildUserPayload(tenantId, username, password) {
  return {
    username,
    enabled: true,
    emailVerified: true,
    attributes: {
      tenantId: [tenantId]
    },
    credentials: [
      {
        type: 'password',
        value: password,
        temporary: false
      }
    ]
  };
}

export async function createTestUser({ tenantId, scopes = [] }) {
  const username = `rt-e2e-${tenantId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const password = `Rt!${Math.random().toString(36).slice(2)}A9`;

  await keycloakFetch(`/admin/realms/${KEYCLOAK_REALM}/users`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildUserPayload(tenantId, username, password))
  });

  const users = await keycloakFetch(
    `/admin/realms/${KEYCLOAK_REALM}/users?username=${encodeURIComponent(username)}&exact=true`
  );
  const userId = users?.[0]?.id;
  if (!userId) {
    throw new Error(`Unable to resolve Keycloak userId for ${username}`);
  }

  for (const scope of scopes) {
    await assignScope({ userId, scope });
  }

  return { userId, username, password };
}

export async function getToken({ username, password, scope }) {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: KEYCLOAK_ADMIN_CLIENT_ID,
    client_secret: KEYCLOAK_ADMIN_SECRET,
    username,
    password
  });
  if (scope) {
    body.set('scope', scope);
  }

  const response = await fetch(
    `${KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    }
  );

  if (!response.ok) {
    throw new Error(`Unable to obtain Keycloak user token (${response.status})`);
  }

  const payload = await response.json();
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresIn: payload.expires_in
  };
}

export async function refreshToken({ refreshToken }) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: KEYCLOAK_ADMIN_CLIENT_ID,
    client_secret: KEYCLOAK_ADMIN_SECRET,
    refresh_token: refreshToken
  });

  const response = await fetch(
    `${KEYCLOAK_BASE_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    }
  );

  if (!response.ok) {
    throw new Error(`Unable to refresh Keycloak token (${response.status})`);
  }

  const payload = await response.json();
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token
  };
}

async function getClientByClientId(clientId) {
  const clients = await keycloakFetch(
    `/admin/realms/${KEYCLOAK_REALM}/clients?clientId=${encodeURIComponent(clientId)}`
  );
  const client = clients?.[0];
  if (!client?.id) {
    throw new Error(`Keycloak client not found for clientId=${clientId}`);
  }
  return client;
}

async function getClientRole(clientId, roleName) {
  const client = await getClientByClientId(clientId);
  const role = await keycloakFetch(`/admin/realms/${KEYCLOAK_REALM}/clients/${client.id}/roles/${encodeURIComponent(roleName)}`);
  return { client, role };
}

export async function assignScope({ userId, scope }) {
  const { client, role } = await getClientRole(KEYCLOAK_ADMIN_CLIENT_ID, scope);
  await keycloakFetch(`/admin/realms/${KEYCLOAK_REALM}/users/${userId}/role-mappings/clients/${client.id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify([{ id: role.id, name: role.name }])
  });
}

export async function revokeScope({ userId, scope }) {
  const { client, role } = await getClientRole(KEYCLOAK_ADMIN_CLIENT_ID, scope);
  await keycloakFetch(`/admin/realms/${KEYCLOAK_REALM}/users/${userId}/role-mappings/clients/${client.id}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify([{ id: role.id, name: role.name }])
  });
}

export async function revokeUserSessions(userId) {
  await keycloakFetch(`/admin/realms/${KEYCLOAK_REALM}/users/${userId}/logout`, { method: 'POST' });
}

export async function deleteTestUser(userId) {
  await keycloakFetch(`/admin/realms/${KEYCLOAK_REALM}/users/${userId}`, { method: 'DELETE' });
}
