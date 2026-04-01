/**
 * S3-compatible storage domain analyzer for preflight conflict check.
 * Read-only: only GetBucket* operations.
 * @module preflight/analyzers/storage-analyzer
 */

import { emptyDomainResult, DOMAIN_ANALYSIS_STATUSES } from '../types.mjs';
import { processResourceArray, aggregateDomainResults } from './analyzer-helpers.mjs';

const DOMAIN_KEY = 'storage';

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

  const getBucket = credentials.getBucket ?? (async () => {
    throw new Error('S3 client not available');
  });

  try {
    const results = [];

    // Buckets
    results.push(await processResourceArray({
      domain: DOMAIN_KEY,
      resourceType: 'bucket',
      items: domainData.buckets,
      fetchExisting: async (item) => {
        try { return await getBucket(item.name); }
        catch { return null; }
      },
      getResourceName: (item) => item.name ?? 'unknown',
      log,
    }));

    return aggregateDomainResults(DOMAIN_KEY, results);
  } catch (err) {
    log.error?.({ event: 'preflight_storage_analyzer_error', error: err.message });
    return emptyDomainResult(DOMAIN_KEY, DOMAIN_ANALYSIS_STATUSES.ERROR, err.message);
  }
}

function _isEmpty(data) {
  if (!data) return true;
  return (!data.buckets || data.buckets.length === 0);
}
