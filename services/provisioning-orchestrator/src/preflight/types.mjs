/**
 * Shared types and constants for the preflight conflict check feature.
 * @module preflight/types
 */

/** @type {readonly string[]} */
export const KNOWN_DOMAINS = ['iam', 'postgres_metadata', 'mongo_metadata', 'kafka', 'functions', 'storage'];

/** @type {readonly string[]} */
export const SKIPPABLE_DOMAIN_STATUSES = ['error', 'not_available', 'not_requested'];

export const REDACTED_MARKER = '***REDACTED***';

/** Severity levels in ascending order. */
export const SEVERITY_LEVELS = /** @type {const} */ (['low', 'medium', 'high', 'critical']);

export const PREFLIGHT_RESOURCE_STATUSES = /** @type {const} */ ({
  COMPATIBLE: 'compatible',
  COMPATIBLE_REDACTED: 'compatible_with_redacted_fields',
  CONFLICT: 'conflict',
});

export const DOMAIN_ANALYSIS_STATUSES = /** @type {const} */ ({
  ANALYZED: 'analyzed',
  NO_CONFLICTS: 'no_conflicts',
  SKIPPED: 'skipped_not_exportable',
  ERROR: 'analysis_error',
});

/**
 * @typedef {Object} ConflictEntry
 * @property {string} resource_type
 * @property {string} resource_name
 * @property {string|null} resource_id
 * @property {'low'|'medium'|'high'|'critical'} severity
 * @property {Object|null} diff
 * @property {string} recommendation
 */

/**
 * @typedef {Object} CompatibleWithRedactedEntry
 * @property {string} resource_type
 * @property {string} resource_name
 * @property {string|null} resource_id
 * @property {string[]} redacted_fields
 */

/**
 * @typedef {Object} DomainAnalysisResult
 * @property {string} domain_key
 * @property {'analyzed'|'no_conflicts'|'skipped_not_exportable'|'analysis_error'} status
 * @property {number} resources_analyzed
 * @property {number} compatible_count
 * @property {number} compatible_with_redacted_count
 * @property {ConflictEntry[]} conflicts
 * @property {CompatibleWithRedactedEntry[]} compatible_with_redacted
 * @property {string|null} analysis_error_message
 */

/**
 * @typedef {Object} PreflightSummary
 * @property {'low'|'medium'|'high'|'critical'} risk_level
 * @property {number} total_resources_analyzed
 * @property {number} compatible
 * @property {number} compatible_with_redacted_fields
 * @property {{ low: number, medium: number, high: number, critical: number }} conflict_counts
 * @property {boolean} incomplete_analysis
 * @property {string[]} domains_analyzed
 * @property {string[]} domains_skipped
 */

/**
 * @typedef {Object} PreflightReport
 * @property {string} correlation_id
 * @property {string} source_tenant_id
 * @property {string} target_tenant_id
 * @property {string} format_version
 * @property {string} analyzed_at
 * @property {PreflightSummary} summary
 * @property {DomainAnalysisResult[]} domains
 * @property {boolean} [needs_confirmation]
 * @property {Object|null} [identifier_map_proposal]
 */

/**
 * Build a zero-value DomainAnalysisResult for skip/error/empty cases.
 * @param {string} domainKey
 * @param {string} status
 * @param {string|null} [errorMessage]
 * @returns {DomainAnalysisResult}
 */
export function emptyDomainResult(domainKey, status, errorMessage = null) {
  return {
    domain_key: domainKey,
    status,
    resources_analyzed: 0,
    compatible_count: 0,
    compatible_with_redacted_count: 0,
    conflicts: [],
    compatible_with_redacted: [],
    analysis_error_message: errorMessage,
  };
}
