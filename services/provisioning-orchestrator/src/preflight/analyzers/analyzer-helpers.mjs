/**
 * Shared helpers for domain analyzers.
 * @module preflight/analyzers/analyzer-helpers
 */

import { compareResources, buildDiff } from '../../reprovision/diff.mjs';
import { REDACTED_MARKER, DOMAIN_ANALYSIS_STATUSES, emptyDomainResult } from '../types.mjs';
import { classifySeverity } from '../conflict-classifier.mjs';
import { getRecommendation } from '../recommendation-engine.mjs';

/**
 * Determine whether a value (at any depth) is or contains the redacted marker.
 * @param {unknown} val
 * @returns {boolean}
 */
export function isRedactedValue(val) {
  if (val === REDACTED_MARKER) return true;
  if (val === null || val === undefined) return false;
  if (typeof val !== 'object') return false;
  if (Array.isArray(val)) return val.some(isRedactedValue);
  return Object.values(val).some(isRedactedValue);
}

/**
 * Check whether a value contains ONLY non-redacted content (no redacted markers anywhere).
 * @param {unknown} val
 * @returns {boolean}
 */
function hasNoRedacted(val) {
  if (val === REDACTED_MARKER) return false;
  if (val === null || val === undefined) return true;
  if (typeof val !== 'object') return true;
  if (Array.isArray(val)) return val.every(hasNoRedacted);
  return Object.values(val).every(hasNoRedacted);
}

/**
 * Check if ALL diff keys contain only redacted values on the desired (artifact) side.
 * A diff entry is "only redacted" if the desired side contains a REDACTED_MARKER
 * and the existing side doesn't contain any REDACTED_MARKER (meaning the only
 * reason for the diff is that the artifact has a redacted field).
 * @param {Object} diff - output from buildDiff
 * @returns {boolean}
 */
export function isOnlyRedactedDiff(diff) {
  if (!diff) return false;
  for (const key of Object.keys(diff)) {
    const entry = diff[key];
    // If the desired side contains redacted values AND the existing side doesn't, it's a redacted diff
    if (isRedactedValue(entry?.desired) && hasNoRedacted(entry?.existing)) {
      continue; // This key is a redacted-only diff
    }
    // If neither side has redacted values, it's a real diff
    return false;
  }
  return true;
}

/**
 * Extract the list of redacted fields from a diff.
 * @param {Object} diff
 * @returns {string[]}
 */
export function extractRedactedFields(diff) {
  if (!diff) return [];
  const fields = [];
  for (const key of Object.keys(diff)) {
    if (isRedactedValue(diff[key]?.desired)) fields.push(key);
  }
  return fields;
}

/**
 * Filter a diff to only non-redacted entries.
 * Returns null if no non-redacted diff remains.
 * @param {Object} diff
 * @returns {Object|null}
 */
export function filterRedactedFromDiff(diff) {
  if (!diff) return null;
  const filtered = {};
  for (const key of Object.keys(diff)) {
    const entry = diff[key];
    if (!isRedactedValue(entry?.desired) && !isRedactedValue(entry?.existing)) {
      filtered[key] = {
        artifact: entry.desired,
        destination: entry.existing,
      };
    }
  }
  return Object.keys(filtered).length > 0 ? filtered : null;
}

/**
 * Compare a single resource and return classification result.
 *
 * @param {Object} params
 * @param {string} params.domain
 * @param {string} params.resourceType
 * @param {string} params.resourceName
 * @param {string|null} params.resourceId
 * @param {Object|null} params.existing - current state in subsystem (null if not exists)
 * @param {Object} params.desired - from artifact
 * @param {string[]} [params.ignoreKeys]
 * @returns {{ status: string, conflict?: import('../types.mjs').ConflictEntry, redactedEntry?: import('../types.mjs').CompatibleWithRedactedEntry }}
 */
export function classifyResource({ domain, resourceType, resourceName, resourceId, existing, desired, ignoreKeys = [] }) {
  // Resource does not exist in target → compatible
  if (existing === null || existing === undefined) {
    return { status: 'compatible' };
  }

  const comparison = compareResources(existing, desired, ignoreKeys);
  if (comparison === 'equal') {
    return { status: 'compatible' };
  }

  // Different — build diff
  const diff = buildDiff(existing, desired);
  if (!diff) {
    return { status: 'compatible' };
  }

  // Check if all diffs are just redacted fields
  if (isOnlyRedactedDiff(diff)) {
    return {
      status: 'compatible_with_redacted_fields',
      redactedEntry: {
        resource_type: resourceType,
        resource_name: resourceName,
        resource_id: resourceId,
        redacted_fields: extractRedactedFields(diff),
      },
    };
  }

  // Real conflict — classify
  const nonRedactedDiff = filterRedactedFromDiff(diff);
  const diffKeys = nonRedactedDiff ? Object.keys(nonRedactedDiff) : Object.keys(diff);
  const severity = classifySeverity(domain, resourceType, diffKeys);
  const recommendation = getRecommendation(domain, resourceType, severity, resourceName);

  return {
    status: 'conflict',
    conflict: {
      resource_type: resourceType,
      resource_name: resourceName,
      resource_id: resourceId,
      severity,
      diff: nonRedactedDiff,
      recommendation,
    },
  };
}

/**
 * Process an array of items for a given resource type within a domain analyzer.
 * Returns the individual results for aggregation.
 *
 * @param {Object} params
 * @param {string} params.domain
 * @param {string} params.resourceType
 * @param {Array} params.items - artifact items
 * @param {Function} params.fetchExisting - async (item) => existing or null
 * @param {Function} params.getResourceName - (item) => string
 * @param {Function} [params.getResourceId] - (item) => string|null
 * @param {string[]} [params.ignoreKeys]
 * @param {Console} [params.log]
 * @returns {Promise<{compatible: number, redacted: number, conflicts: import('../types.mjs').ConflictEntry[], redactedEntries: import('../types.mjs').CompatibleWithRedactedEntry[]}>}
 */
export async function processResourceArray({ domain, resourceType, items, fetchExisting, getResourceName, getResourceId, ignoreKeys = [], log = console }) {
  let compatible = 0;
  let redacted = 0;
  const conflicts = [];
  const redactedEntries = [];

  if (!Array.isArray(items)) return { compatible, redacted, conflicts, redactedEntries };

  for (const item of items) {
    const resourceName = getResourceName(item);
    const resourceId = getResourceId ? getResourceId(item) : null;

    try {
      const existing = await fetchExisting(item);
      const result = classifyResource({
        domain,
        resourceType,
        resourceName,
        resourceId,
        existing,
        desired: item,
        ignoreKeys,
      });

      if (result.status === 'compatible') {
        compatible++;
      } else if (result.status === 'compatible_with_redacted_fields') {
        redacted++;
        if (result.redactedEntry) redactedEntries.push(result.redactedEntry);
      } else if (result.status === 'conflict' && result.conflict) {
        conflicts.push(result.conflict);
      }
    } catch (err) {
      // Single resource error — report as high-severity conflict
      log.error?.({ event: 'preflight_resource_error', domain, resourceType, resourceName, error: err.message });
      const severity = 'high';
      conflicts.push({
        resource_type: resourceType,
        resource_name: resourceName,
        resource_id: resourceId,
        severity,
        diff: null,
        recommendation: `Error al analizar el recurso «${resourceName}»: ${err.message}. Verificar manualmente antes de reaprovisionar.`,
      });
    }
  }

  return { compatible, redacted, conflicts, redactedEntries };
}

/**
 * Aggregate processResourceArray results into a DomainAnalysisResult.
 *
 * @param {string} domainKey
 * @param {Array<{compatible: number, redacted: number, conflicts: import('../types.mjs').ConflictEntry[], redactedEntries: import('../types.mjs').CompatibleWithRedactedEntry[]}>} results
 * @returns {import('../types.mjs').DomainAnalysisResult}
 */
export function aggregateDomainResults(domainKey, results) {
  let totalAnalyzed = 0;
  let totalCompatible = 0;
  let totalRedacted = 0;
  const allConflicts = [];
  const allRedacted = [];

  for (const r of results) {
    totalCompatible += r.compatible;
    totalRedacted += r.redacted;
    totalAnalyzed += r.compatible + r.redacted + r.conflicts.length;
    allConflicts.push(...r.conflicts);
    allRedacted.push(...r.redactedEntries);
  }

  const status = allConflicts.length > 0 ? DOMAIN_ANALYSIS_STATUSES.ANALYZED : DOMAIN_ANALYSIS_STATUSES.NO_CONFLICTS;

  return {
    domain_key: domainKey,
    status,
    resources_analyzed: totalAnalyzed,
    compatible_count: totalCompatible,
    compatible_with_redacted_count: totalRedacted,
    conflicts: allConflicts,
    compatible_with_redacted: allRedacted,
    analysis_error_message: null,
  };
}
