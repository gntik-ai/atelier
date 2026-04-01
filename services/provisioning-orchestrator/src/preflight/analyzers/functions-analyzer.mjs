/**
 * OpenWhisk functions domain analyzer for preflight conflict check.
 * Read-only: only GET requests.
 * @module preflight/analyzers/functions-analyzer
 */

import { emptyDomainResult, DOMAIN_ANALYSIS_STATUSES } from '../types.mjs';
import { processResourceArray, aggregateDomainResults } from './analyzer-helpers.mjs';

const DOMAIN_KEY = 'functions';

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

  const namespace = domainData.namespace ?? tenantId;

  const owApi = credentials.owApi ?? (async () => {
    throw new Error('OpenWhisk client not available');
  });

  try {
    const results = [];

    // Actions
    results.push(await processResourceArray({
      domain: DOMAIN_KEY,
      resourceType: 'action',
      items: domainData.actions,
      fetchExisting: async (item) => {
        try { return await owApi('GET', `/actions/${encodeURIComponent(item.name)}`); }
        catch { return null; }
      },
      getResourceName: (item) => item.name ?? 'unknown',
      ignoreKeys: ['namespace', 'version', 'updated', 'publish'],
      log,
    }));

    // Packages
    results.push(await processResourceArray({
      domain: DOMAIN_KEY,
      resourceType: 'package',
      items: domainData.packages,
      fetchExisting: async (item) => {
        try { return await owApi('GET', `/packages/${encodeURIComponent(item.name)}`); }
        catch { return null; }
      },
      getResourceName: (item) => item.name ?? 'unknown',
      ignoreKeys: ['namespace', 'version', 'updated', 'publish'],
      log,
    }));

    // Triggers
    results.push(await processResourceArray({
      domain: DOMAIN_KEY,
      resourceType: 'trigger',
      items: domainData.triggers,
      fetchExisting: async (item) => {
        try { return await owApi('GET', `/triggers/${encodeURIComponent(item.name)}`); }
        catch { return null; }
      },
      getResourceName: (item) => item.name ?? 'unknown',
      ignoreKeys: ['namespace', 'version', 'updated', 'publish'],
      log,
    }));

    // Rules
    results.push(await processResourceArray({
      domain: DOMAIN_KEY,
      resourceType: 'rule',
      items: domainData.rules,
      fetchExisting: async (item) => {
        try { return await owApi('GET', `/rules/${encodeURIComponent(item.name)}`); }
        catch { return null; }
      },
      getResourceName: (item) => item.name ?? 'unknown',
      ignoreKeys: ['namespace', 'version', 'updated', 'publish', 'status'],
      log,
    }));

    return aggregateDomainResults(DOMAIN_KEY, results);
  } catch (err) {
    log.error?.({ event: 'preflight_functions_analyzer_error', error: err.message });
    return emptyDomainResult(DOMAIN_KEY, DOMAIN_ANALYSIS_STATUSES.ERROR, err.message);
  }
}

function _isEmpty(data) {
  if (!data) return true;
  return (!data.actions || data.actions.length === 0) &&
    (!data.packages || data.packages.length === 0) &&
    (!data.triggers || data.triggers.length === 0) &&
    (!data.rules || data.rules.length === 0);
}
