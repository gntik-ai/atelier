/**
 * Kafka domain analyzer for preflight conflict check.
 * Read-only: only describeTopics / describeAcls.
 * @module preflight/analyzers/kafka-analyzer
 */

import { emptyDomainResult, DOMAIN_ANALYSIS_STATUSES } from '../types.mjs';
import { processResourceArray, aggregateDomainResults } from './analyzer-helpers.mjs';

const DOMAIN_KEY = 'kafka';

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

  const describeTopic = credentials.describeTopic ?? (async () => {
    throw new Error('Kafka admin client not available');
  });

  const describeAcls = credentials.describeAcls ?? (async () => {
    throw new Error('Kafka admin client not available');
  });

  try {
    const results = [];

    // Topics
    results.push(await processResourceArray({
      domain: DOMAIN_KEY,
      resourceType: 'topic',
      items: domainData.topics,
      fetchExisting: async (item) => {
        try {
          const topicInfo = await describeTopic(item.name);
          return topicInfo ?? null;
        } catch { return null; }
      },
      getResourceName: (item) => item.name ?? 'unknown',
      ignoreKeys: ['topicId', 'isInternal'],
      log,
    }));

    // ACLs
    results.push(await processResourceArray({
      domain: DOMAIN_KEY,
      resourceType: 'acl',
      items: domainData.acls,
      fetchExisting: async (item) => {
        try {
          const acls = await describeAcls(item);
          if (!Array.isArray(acls) || acls.length === 0) return null;
          return acls[0];
        } catch { return null; }
      },
      getResourceName: (item) => item.name ?? item.principal ?? 'unknown',
      log,
    }));

    return aggregateDomainResults(DOMAIN_KEY, results);
  } catch (err) {
    log.error?.({ event: 'preflight_kafka_analyzer_error', error: err.message });
    return emptyDomainResult(DOMAIN_KEY, DOMAIN_ANALYSIS_STATUSES.ERROR, err.message);
  }
}

function _isEmpty(data) {
  if (!data) return true;
  return (!data.topics || data.topics.length === 0) &&
    (!data.acls || data.acls.length === 0);
}
