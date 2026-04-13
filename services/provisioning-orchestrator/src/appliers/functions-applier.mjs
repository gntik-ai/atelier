/**
 * OpenWhisk functions domain applier for tenant config reprovision.
 * @module appliers/functions-applier
 */

import { compareResources, resolveAction, buildDiff } from '../reprovision/diff.mjs';
import { REDACTED_MARKER, zeroCounts } from '../reprovision/types.mjs';
import { buildServiceUrl, encodePathSegment, normalizeServiceBaseUrl } from '../http/safe-url.mjs';

const RESOURCE_TYPES = ['packages', 'actions', 'triggers', 'rules'];

/**
 * @param {string} tenantId
 * @param {Object} domainData
 * @param {Object} options
 * @returns {Promise<import('../reprovision/types.mjs').DomainResult>}
 */
export async function apply(tenantId, domainData, options = {}) {
  const { dryRun = false, credentials = {}, log = console } = options;
  const domain_key = 'functions';

  if (!domainData || _isEmpty(domainData)) {
    return { domain_key, status: 'applied', resource_results: [], counts: zeroCounts(), message: 'empty domain' };
  }

  const counts = zeroCounts();
  const resource_results = [];
  let hasWarnings = false;

  const owApiHost = credentials.owApiHost ?? process.env.CONFIG_IMPORT_OW_API_HOST;
  const owApiKey = credentials.owApiKey ?? process.env.CONFIG_IMPORT_OW_API_KEY;
  const namespace = domainData.namespace ?? tenantId;

  const owApi = credentials.owApi ?? (async (method, path, body) => {
    const normalizedOwApiHost = normalizeServiceBaseUrl(owApiHost, 'CONFIG_IMPORT_OW_API_HOST', {
      allowBareInternalHttp: true,
    });
    const namespacePath = encodePathSegment(namespace, 'namespace');
    const url = buildServiceUrl(normalizedOwApiHost, `api/v1/namespaces/${namespacePath}${path}`);
    const authHeader = `Basic ${Buffer.from(owApiKey).toString('base64')}`;
    const opts = { method, headers: { Authorization: authHeader, 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(url, opts);
  });

  for (const resourceType of RESOURCE_TYPES) {
    const items = domainData[resourceType];
    if (!Array.isArray(items)) continue;

    for (const item of items) {
      try {
        const result = await _processResource(resourceType, item, { dryRun, owApi, namespace, log });
        resource_results.push(result);
        _updateCounts(counts, result.action);
        if (result.warnings.length > 0) hasWarnings = true;
      } catch (err) {
        resource_results.push({
          resource_type: resourceType,
          resource_name: item.name ?? 'unknown',
          resource_id: null,
          action: 'error',
          message: err.message,
          warnings: [],
          diff: null,
        });
        counts.errors++;
      }
    }
  }

  const status = _resolveStatus(counts, dryRun, hasWarnings);
  return { domain_key, status, resource_results, counts, message: null };
}

async function _processResource(resourceType, item, { dryRun, owApi, namespace, log }) {
  const name = item.name ?? 'unknown';
  const warnings = [];
  const cleanedItem = _stripRedacted(item, warnings, name);

  const lookupPath = _getLookupPath(resourceType, name);
  let existing = null;

  try {
    const res = await owApi('GET', lookupPath);
    if (res.ok) existing = await res.json();
  } catch { /* not found */ }

  const existsInTarget = existing !== null;
  let comparison = 'different';

  if (existsInTarget) {
    switch (resourceType) {
      case 'actions':
        comparison = compareResources(
          { name: existing.name, exec: { kind: existing.exec?.kind }, limits: existing.limits },
          { name: cleanedItem.name, exec: { kind: cleanedItem.exec?.kind ?? cleanedItem.runtime }, limits: cleanedItem.limits },
          ['version', 'updated', 'publish', 'namespace', 'annotations']
        );
        break;
      case 'packages':
        comparison = compareResources(
          { name: existing.name, binding: existing.binding },
          { name: cleanedItem.name, binding: cleanedItem.binding },
          ['version', 'updated', 'publish', 'namespace', 'annotations']
        );
        break;
      case 'triggers':
        comparison = compareResources(
          { name: existing.name },
          { name: cleanedItem.name },
          ['version', 'updated', 'publish', 'namespace', 'annotations']
        );
        break;
      case 'rules':
        comparison = compareResources(
          { name: existing.name, trigger: existing.trigger, action: existing.action },
          { name: cleanedItem.name, trigger: cleanedItem.trigger, action: cleanedItem.action },
          ['version', 'updated', 'publish', 'namespace', 'status']
        );
        break;
    }
  }

  const action = resolveAction(existsInTarget, comparison, dryRun);

  if (action === 'created' && !dryRun) {
    const createPath = _getCreatePath(resourceType, name);
    const body = _buildCreateBody(resourceType, cleanedItem);
    await owApi('PUT', createPath, body);
  }

  const diff = (action === 'conflict' || action === 'would_conflict') ? buildDiff(existing, cleanedItem) : null;
  const finalAction = warnings.length > 0 && (action === 'created' || action === 'would_create')
    ? (dryRun ? 'would_create' : 'applied_with_warnings')
    : action;

  return { resource_type: resourceType, resource_name: name, resource_id: null, action: finalAction, message: null, warnings, diff };
}

function _getLookupPath(resourceType, name) {
  switch (resourceType) {
    case 'actions': return `/actions/${encodeURIComponent(name)}`;
    case 'packages': return `/packages/${encodeURIComponent(name)}`;
    case 'triggers': return `/triggers/${encodeURIComponent(name)}`;
    case 'rules': return `/rules/${encodeURIComponent(name)}`;
    default: return `/${resourceType}/${encodeURIComponent(name)}`;
  }
}

function _getCreatePath(resourceType, name) {
  switch (resourceType) {
    case 'actions': return `/actions/${encodeURIComponent(name)}?overwrite=false`;
    case 'packages': return `/packages/${encodeURIComponent(name)}?overwrite=false`;
    case 'triggers': return `/triggers/${encodeURIComponent(name)}?overwrite=false`;
    case 'rules': return `/rules/${encodeURIComponent(name)}?overwrite=false`;
    default: return `/${resourceType}/${encodeURIComponent(name)}`;
  }
}

function _buildCreateBody(resourceType, item) {
  switch (resourceType) {
    case 'actions':
      return {
        name: item.name,
        exec: item.exec ?? { kind: item.runtime, code: item.code ?? '' },
        limits: item.limits,
        parameters: item.parameters,
        annotations: item.annotations,
      };
    case 'packages':
      return { name: item.name, binding: item.binding, parameters: item.parameters, annotations: item.annotations };
    case 'triggers':
      return { name: item.name, parameters: item.parameters, annotations: item.annotations };
    case 'rules':
      return { name: item.name, trigger: item.trigger, action: item.action };
    default:
      return item;
  }
}

function _stripRedacted(item, warnings, resourceName) {
  const clone = structuredClone(item);
  _walk(clone, [], warnings, resourceName);
  return clone;
}

function _walk(obj, path, warnings, resourceName) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    // Filter out array items that are entirely redacted strings
    for (let i = obj.length - 1; i >= 0; i--) {
      if (obj[i] === REDACTED_MARKER) {
        warnings.push(`Redacted array item at '${[...path, i].join('.')}' removed for resource '${resourceName}'`);
        obj.splice(i, 1);
      } else if (typeof obj[i] === 'object' && obj[i] !== null) {
        _walk(obj[i], [...path, i], warnings, resourceName);
      }
    }
    return;
  }
  for (const [key, val] of Object.entries(obj)) {
    if (val === REDACTED_MARKER) {
      delete obj[key];
      warnings.push(`Redacted field '${[...path, key].join('.')}' omitted for resource '${resourceName}'`);
    } else if (typeof val === 'object' && val !== null) {
      _walk(val, [...path, key], warnings, resourceName);
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
  if (counts.conflicts > 0 && counts.created === 0) return dryRun ? 'would_conflict' : 'conflict';
  if (hasWarnings) return dryRun ? 'would_apply_with_warnings' : 'applied_with_warnings';
  if (counts.created > 0) return dryRun ? 'would_apply' : 'applied';
  return dryRun ? 'would_skip' : 'skipped';
}
