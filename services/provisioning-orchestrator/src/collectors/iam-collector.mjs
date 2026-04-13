/**
 * IAM (Keycloak) configuration collector.
 * Extracts realm settings, roles, groups, clients, client scopes, identity providers, and role mappings.
 * @module collectors/iam-collector
 */

import { redactSensitiveFields } from './types.mjs';
import { buildServiceUrl, encodePathSegment, normalizeServiceBaseUrl } from '../http/safe-url.mjs';

const DOMAIN_KEY = 'iam';

/**
 * Fetches JSON from Keycloak Admin API.
 * @param {string} url
 * @param {string} accessToken
 * @param {typeof globalThis.fetch} [fetchFn]
 * @returns {Promise<unknown>}
 */
async function kcGet(url, accessToken, fetchFn = globalThis.fetch) {
  const res = await fetchFn(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Keycloak API ${res.status}: ${url}`);
  return res.json();
}

/**
 * Obtain a service-account token from Keycloak.
 */
async function getServiceToken(baseUrl, clientId, clientSecret, fetchFn = globalThis.fetch) {
  const tokenUrl = buildServiceUrl(baseUrl, 'realms/master/protocol/openid-connect/token');
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await fetchFn(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Keycloak token request failed: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

/**
 * @param {string} tenantId
 * @param {Object} [options]
 * @param {typeof globalThis.fetch} [options.fetchFn] - injectable for testing
 * @returns {Promise<import('./types.mjs').CollectorResult>}
 */
export async function collect(tenantId, options = {}) {
  const exportedAt = new Date().toISOString();
  const fetchFn = options.fetchFn ?? globalThis.fetch;

  const adminUrl = process.env.CONFIG_EXPORT_KEYCLOAK_ADMIN_URL;
  const clientId = process.env.CONFIG_EXPORT_KEYCLOAK_CLIENT_ID;
  const clientSecret = process.env.CONFIG_EXPORT_KEYCLOAK_CLIENT_SECRET;

  if (!adminUrl || !clientId || !clientSecret) {
    return { domain_key: DOMAIN_KEY, status: 'not_available', exported_at: exportedAt, reason: 'Keycloak credentials not configured', data: null };
  }

  try {
    const normalizedAdminUrl = normalizeServiceBaseUrl(adminUrl, 'CONFIG_EXPORT_KEYCLOAK_ADMIN_URL', {
      allowBareInternalHttp: true,
    });
    const token = await getServiceToken(normalizedAdminUrl, clientId, clientSecret, fetchFn);
    const realm = tenantId; // convention: realm name = tenant ID
    const base = buildServiceUrl(normalizedAdminUrl, `admin/realms/${encodePathSegment(realm, 'tenantId')}`);

    // Fetch all sections in parallel
    const [realmSettings, roles, groups, clients, clientScopes, identityProviders] = await Promise.all([
      kcGet(base, token, fetchFn),
      kcGet(`${base}/roles`, token, fetchFn),
      kcGet(`${base}/groups`, token, fetchFn),
      kcGet(`${base}/clients`, token, fetchFn),
      kcGet(`${base}/client-scopes`, token, fetchFn),
      kcGet(`${base}/identity-provider/instances`, token, fetchFn).catch(() => []),
    ]);

    const realmConfig = {
      displayName: realmSettings.displayName,
      sslRequired: realmSettings.sslRequired,
      loginTheme: realmSettings.loginTheme,
      emailTheme: realmSettings.emailTheme,
      ssoSessionIdleTimeout: realmSettings.ssoSessionIdleTimeout,
      ssoSessionMaxLifespan: realmSettings.ssoSessionMaxLifespan,
      accessTokenLifespan: realmSettings.accessTokenLifespan,
    };

    const data = {
      realm: realm,
      realm_settings: realmConfig,
      roles: roles,
      groups: groups,
      clients: clients,
      client_scopes: clientScopes,
      identity_providers: identityProviders,
    };

    const itemsCount = (roles?.length ?? 0) + (groups?.length ?? 0) + (clients?.length ?? 0) +
      (clientScopes?.length ?? 0) + (identityProviders?.length ?? 0);

    if (itemsCount === 0) {
      return { domain_key: DOMAIN_KEY, status: 'empty', exported_at: exportedAt, items_count: 0, data: {} };
    }

    const redacted = redactSensitiveFields(data);
    return { domain_key: DOMAIN_KEY, status: 'ok', exported_at: exportedAt, items_count: itemsCount, data: redacted };
  } catch (err) {
    return { domain_key: DOMAIN_KEY, status: 'error', exported_at: exportedAt, error: err.message, data: null };
  }
}
