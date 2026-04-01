/**
 * MongoDB metadata domain analyzer for preflight conflict check.
 * Read-only: only listCollections / listIndexes.
 * @module preflight/analyzers/mongo-analyzer
 */

import { emptyDomainResult, DOMAIN_ANALYSIS_STATUSES } from '../types.mjs';
import { processResourceArray, aggregateDomainResults } from './analyzer-helpers.mjs';

const DOMAIN_KEY = 'mongo_metadata';

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

  const dbName = domainData.database ?? tenantId.replace(/-/g, '_');

  const listCollections = credentials.listCollections ?? (async () => {
    throw new Error('MongoDB client not available');
  });

  const listIndexes = credentials.listIndexes ?? (async () => {
    throw new Error('MongoDB client not available');
  });

  try {
    const results = [];

    // Collections (with validators)
    results.push(await processResourceArray({
      domain: DOMAIN_KEY,
      resourceType: 'collection',
      items: domainData.collections,
      fetchExisting: async (item) => {
        try {
          const collections = await listCollections(dbName, { name: item.name });
          if (!Array.isArray(collections) || collections.length === 0) return null;
          const coll = collections[0];
          return { name: coll.name, validator: coll.options?.validator ?? null };
        } catch { return null; }
      },
      getResourceName: (item) => item.name ?? 'unknown',
      ignoreKeys: ['idIndex'],
      log,
    }));

    // Indexes
    results.push(await processResourceArray({
      domain: DOMAIN_KEY,
      resourceType: 'index',
      items: domainData.indexes,
      fetchExisting: async (item) => {
        try {
          const indexes = await listIndexes(dbName, item.collection ?? item.ns);
          if (!Array.isArray(indexes)) return null;
          const match = indexes.find(idx => idx.name === item.name);
          return match ?? null;
        } catch { return null; }
      },
      getResourceName: (item) => item.name ?? 'unknown',
      ignoreKeys: ['v', 'ns'],
      log,
    }));

    return aggregateDomainResults(DOMAIN_KEY, results);
  } catch (err) {
    log.error?.({ event: 'preflight_mongo_analyzer_error', error: err.message });
    return emptyDomainResult(DOMAIN_KEY, DOMAIN_ANALYSIS_STATUSES.ERROR, err.message);
  }
}

function _isEmpty(data) {
  if (!data) return true;
  return (!data.collections || data.collections.length === 0) &&
    (!data.indexes || data.indexes.length === 0);
}
