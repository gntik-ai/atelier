/**
 * IAM (Keycloak) domain analyzer for preflight conflict check.
 * Read-only: never writes to Keycloak.
 * @module preflight/analyzers/iam-analyzer
 */

import { emptyDomainResult, DOMAIN_ANALYSIS_STATUSES } from '../types.mjs';
import { processResourceArray, aggregateDomainResults } from './analyzer-helpers.mjs';

const DOMAIN_KEY = 'iam';
const TIMESTAMP_KEYS = ['createdTimestamp', 'lastModifiedTimestamp', 'created_at', 'updated_at', 'lastRefresh', 'lastImport'];

/**
 * @param {string} tenantId
 * @param {Object} domainData
 * @param {Object} options
 * @returns {Promise<import('../types.mjs').DomainAnalysisResult>}
 */
export async function analyze(tenantId, domainData, options = {}) {
  const { credentials = {}, log = console } = options;

  if (!domainData || _isEmpty(domainData)) {
    return emptyDomainResult(DOMAIN_KEY, DOMAIN_ANALYSIS_STATUSES.NO_CONFLICTS);
  }

  const keycloakUrl = credentials.keycloakUrl ?? process.env.CONFIG_EXPORT_KEYCLOAK_URL;
  const clientId = credentials.clientId ?? process.env.CONFIG_EXPORT_KEYCLOAK_ADMIN_CLIENT_ID;
  const clientSecret = credentials.clientSecret ?? process.env.CONFIG_EXPORT_KEYCLOAK_ADMIN_SECRET;
  const realm = domainData.realm ?? tenantId;

  const getAdminToken = credentials.getAdminToken ?? (async () => {
    const tokenUrl = `${keycloakUrl}/realms/master/protocol/openid-connect/token`;
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
    });
    const data = await res.json();
    return data.access_token;
  });

  const kcApi = credentials.kcApi ?? (async (method, path) => {
    const token = await getAdminToken();
    const url = `${keycloakUrl}/admin/realms/${encodeURIComponent(realm)}${path}`;
    const res = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Keycloak API ${method} ${path} returned ${res.status}`);
    return res.json();
  });

  try {
    const results = [];

    // Roles
    results.push(await processResourceArray({
      domain: DOMAIN_KEY,
      resourceType: 'role',
      items: domainData.roles,
      fetchExisting: async (item) => {
        try { return await kcApi('GET', `/roles/${encodeURIComponent(item.name)}`); }
        catch { return null; }
      },
      getResourceName: (item) => item.name ?? 'unknown',
      ignoreKeys: ['id', ...TIMESTAMP_KEYS],
      log,
    }));

    // Groups
    results.push(await processResourceArray({
      domain: DOMAIN_KEY,
      resourceType: 'group',
      items: domainData.groups,
      fetchExisting: async (item) => {
        try {
          const groups = await kcApi('GET', `/groups?search=${encodeURIComponent(item.name)}&exact=true`);
          return Array.isArray(groups) && groups.length > 0 ? groups[0] : null;
        } catch { return null; }
      },
      getResourceName: (item) => item.name ?? item.path ?? 'unknown',
      ignoreKeys: ['id', 'subGroups', ...TIMESTAMP_KEYS],
      log,
    }));

    // Client scopes
    results.push(await processResourceArray({
      domain: DOMAIN_KEY,
      resourceType: 'client_scope',
      items: domainData.client_scopes,
      fetchExisting: async (item) => {
        try {
          const scopes = await kcApi('GET', '/client-scopes');
          if (!Array.isArray(scopes)) return null;
          return scopes.find(s => s.name === item.name) ?? null;
        } catch { return null; }
      },
      getResourceName: (item) => item.name ?? 'unknown',
      ignoreKeys: ['id', ...TIMESTAMP_KEYS],
      log,
    }));

    // Identity providers
    results.push(await processResourceArray({
      domain: DOMAIN_KEY,
      resourceType: 'identity_provider',
      items: domainData.identity_providers,
      fetchExisting: async (item) => {
        try { return await kcApi('GET', `/identity-provider/instances/${encodeURIComponent(item.alias)}`); }
        catch { return null; }
      },
      getResourceName: (item) => item.alias ?? item.name ?? 'unknown',
      ignoreKeys: ['internalId', ...TIMESTAMP_KEYS],
      log,
    }));

    return aggregateDomainResults(DOMAIN_KEY, results);
  } catch (err) {
    log.error?.({ event: 'preflight_iam_analyzer_error', error: err.message });
    return emptyDomainResult(DOMAIN_KEY, DOMAIN_ANALYSIS_STATUSES.ERROR, err.message);
  }
}

function _isEmpty(data) {
  if (!data) return true;
  return (!data.roles || data.roles.length === 0) &&
    (!data.groups || data.groups.length === 0) &&
    (!data.client_scopes || data.client_scopes.length === 0) &&
    (!data.identity_providers || data.identity_providers.length === 0);
}
