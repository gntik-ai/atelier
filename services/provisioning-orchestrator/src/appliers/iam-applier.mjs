/**
 * IAM (Keycloak) domain applier for tenant config reprovision.
 * @module appliers/iam-applier
 */

import { compareResources, resolveAction, buildDiff } from '../reprovision/diff.mjs';
import { REDACTED_MARKER, zeroCounts } from '../reprovision/types.mjs';
import { buildServiceUrl, encodePathSegment, normalizeServiceBaseUrl } from '../http/safe-url.mjs';

const RESOURCE_TYPES = ['roles', 'groups', 'client_scopes', 'identity_providers'];
const TIMESTAMP_KEYS = ['createdTimestamp', 'lastModifiedTimestamp', 'created_at', 'updated_at'];

/**
 * @param {string} tenantId - destination tenant
 * @param {Object} domainData - iam section data (identifiers already substituted)
 * @param {Object} options
 * @param {boolean} options.dryRun
 * @param {Object} [options.credentials]
 * @param {Console} [options.log]
 * @returns {Promise<import('../reprovision/types.mjs').DomainResult>}
 */
export async function apply(tenantId, domainData, options = {}) {
  const { dryRun = false, credentials = {}, log = console } = options;
  const domain_key = 'iam';

  if (!domainData || _isEmpty(domainData)) {
    return { domain_key, status: 'applied', resource_results: [], counts: zeroCounts(), message: 'empty domain' };
  }

  const counts = zeroCounts();
  const resource_results = [];
  let hasWarnings = false;

  const keycloakUrl = credentials.keycloakUrl ?? process.env.CONFIG_IMPORT_KEYCLOAK_URL;
  const clientId = credentials.clientId ?? process.env.CONFIG_IMPORT_KEYCLOAK_ADMIN_CLIENT_ID;
  const clientSecret = credentials.clientSecret ?? process.env.CONFIG_IMPORT_KEYCLOAK_ADMIN_SECRET;
  const realm = domainData.realm ?? tenantId;

  // Helper to get an admin token for Keycloak
  const getAdminToken = credentials.getAdminToken ?? (async () => {
    const normalizedKeycloakUrl = normalizeServiceBaseUrl(keycloakUrl, 'CONFIG_IMPORT_KEYCLOAK_URL', {
      allowBareInternalHttp: true,
    });
    const tokenUrl = buildServiceUrl(normalizedKeycloakUrl, 'realms/master/protocol/openid-connect/token');
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
    });
    const data = await res.json();
    return data.access_token;
  });

  // Helper for Keycloak API calls
  const kcApi = credentials.kcApi ?? (async (method, path, body) => {
    const token = await getAdminToken();
    const normalizedKeycloakUrl = normalizeServiceBaseUrl(keycloakUrl, 'CONFIG_IMPORT_KEYCLOAK_URL', {
      allowBareInternalHttp: true,
    });
    const realmPath = encodePathSegment(realm, 'realm');
    const url = buildServiceUrl(normalizedKeycloakUrl, `admin/realms/${realmPath}${path}`);
    const opts = { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(url, opts);
  });

  for (const resourceType of RESOURCE_TYPES) {
    const items = domainData[resourceType];
    if (!Array.isArray(items)) continue;

    for (const item of items) {
      try {
        const result = await _processResource(resourceType, item, { dryRun, kcApi, realm, log });
        resource_results.push(result);
        _updateCounts(counts, result.action);
        if (result.warnings.length > 0) hasWarnings = true;
      } catch (err) {
        const errorResult = {
          resource_type: resourceType,
          resource_name: item.name ?? item.alias ?? 'unknown',
          resource_id: null,
          action: 'error',
          message: err.message,
          warnings: [],
          diff: null,
        };
        resource_results.push(errorResult);
        counts.errors++;
      }
    }
  }

  const status = _resolveStatus(counts, dryRun, hasWarnings);
  return { domain_key, status, resource_results, counts, message: null };
}

async function _processResource(resourceType, item, { dryRun, kcApi, realm, log }) {
  const name = item.name ?? item.alias ?? 'unknown';
  const warnings = [];

  // Strip redacted values
  const cleanedItem = _stripRedacted(item, warnings, name);

  // Check existence in target
  let existing = null;
  const lookupPath = _getLookupPath(resourceType, item);
  if (lookupPath) {
    try {
      const res = await kcApi('GET', lookupPath);
      if (res.ok) existing = await res.json();
    } catch { /* not found or error — treat as not existing */ }
  }

  const existsInTarget = existing !== null;
  const comparison = existsInTarget ? compareResources(existing, cleanedItem, TIMESTAMP_KEYS) : 'different';
  const action = resolveAction(existsInTarget, comparison, dryRun);

  if (action === 'created' && !dryRun) {
    const createPath = _getCreatePath(resourceType);
    await kcApi('POST', createPath, cleanedItem);
  }

  const diff = action === 'conflict' || action === 'would_conflict'
    ? buildDiff(existing, cleanedItem)
    : null;

  const finalAction = warnings.length > 0 && (action === 'created' || action === 'would_create')
    ? (dryRun ? 'would_create' : 'applied_with_warnings')
    : action;

  return { resource_type: resourceType, resource_name: name, resource_id: null, action: finalAction, message: null, warnings, diff };
}

function _getLookupPath(resourceType, item) {
  switch (resourceType) {
    case 'roles': return `/roles/${encodeURIComponent(item.name)}`;
    case 'groups': return `/groups?search=${encodeURIComponent(item.name)}&exact=true`;
    case 'client_scopes': return `/client-scopes?search=${encodeURIComponent(item.name)}`;
    case 'identity_providers': return `/identity-provider/instances/${encodeURIComponent(item.alias)}`;
    default: return null;
  }
}

function _getCreatePath(resourceType) {
  switch (resourceType) {
    case 'roles': return '/roles';
    case 'groups': return '/groups';
    case 'client_scopes': return '/client-scopes';
    case 'identity_providers': return '/identity-provider/instances';
    default: return `/${resourceType}`;
  }
}

function _stripRedacted(item, warnings, resourceName) {
  const clone = structuredClone(item);
  _walkAndStrip(clone, [], warnings, resourceName);
  return clone;
}

function _walkAndStrip(obj, path, warnings, resourceName) {
  if (!obj || typeof obj !== 'object') return;
  for (const [key, val] of Object.entries(obj)) {
    if (val === REDACTED_MARKER) {
      delete obj[key];
      warnings.push(`Redacted field '${[...path, key].join('.')}' omitted for resource '${resourceName}'`);
    } else if (typeof val === 'object' && val !== null) {
      _walkAndStrip(val, [...path, key], warnings, resourceName);
    }
  }
}

function _isEmpty(domainData) {
  for (const rt of RESOURCE_TYPES) {
    if (Array.isArray(domainData[rt]) && domainData[rt].length > 0) return false;
  }
  return true;
}

function _updateCounts(counts, action) {
  if (action === 'created' || action === 'would_create' || action === 'applied_with_warnings') counts.created++;
  else if (action === 'skipped' || action === 'would_skip') counts.skipped++;
  else if (action === 'conflict' || action === 'would_conflict') counts.conflicts++;
  else if (action === 'error') counts.errors++;
}

function _resolveStatus(counts, dryRun, hasWarnings) {
  if (counts.errors > 0 && counts.created === 0 && counts.skipped === 0 && counts.conflicts === 0) return 'error';
  if (counts.conflicts > 0 && counts.created === 0) {
    return dryRun ? 'would_conflict' : 'conflict';
  }
  if (hasWarnings) return dryRun ? 'would_apply_with_warnings' : 'applied_with_warnings';
  if (counts.created > 0) return dryRun ? 'would_apply' : 'applied';
  return dryRun ? 'would_skip' : 'skipped';
}
