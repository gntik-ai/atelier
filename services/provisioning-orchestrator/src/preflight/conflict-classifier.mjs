/**
 * Severity classification for preflight conflicts.
 * Implemented as a data table — not conditional branches — for evolvability.
 * @module preflight/conflict-classifier
 */

import { SEVERITY_LEVELS } from './types.mjs';

/**
 * SEVERITY_TABLE[domain][resource_type][diff_key] → severity
 * @type {Record<string, Record<string, Record<string, 'low'|'medium'|'high'|'critical'>>>}
 */
export const SEVERITY_TABLE = {
  iam: {
    role: {
      composites: 'medium',
      attributes: 'low',
      description: 'low',
    },
    group: {
      attributes: 'low',
      path: 'high',
    },
    client_scope: {
      protocolMappers: 'medium',
      protocol: 'high',
    },
    identity_provider: {
      config: 'medium',
      providerId: 'critical',
    },
  },
  postgres_metadata: {
    table: {
      columns: 'high',
      constraints: 'high',
      indexes: 'medium',
    },
    schema: {
      exists: 'low',
    },
    view: {
      definition: 'medium',
    },
    extension: {
      version: 'medium',
    },
    grant: {
      privilege: 'medium',
    },
  },
  mongo_metadata: {
    collection: {
      validator: 'high',
    },
    index: {
      key: 'critical',
      unique: 'high',
      options: 'medium',
    },
    sharding: {
      config: 'critical',
    },
  },
  kafka: {
    topic: {
      numPartitions: 'high',
      replicationFactor: 'medium',
      configEntries: 'medium',
      retentionMs: 'medium',
      cleanupPolicy: 'medium',
    },
    acl: {
      permission: 'medium',
      operation: 'medium',
    },
  },
  functions: {
    action: {
      runtime: 'high',
      exec: 'high',
      code: 'medium',
      limits: 'medium',
      parameters: 'low',
    },
    package: {
      binding: 'medium',
    },
    trigger: {
      feed: 'medium',
    },
    rule: {
      action: 'medium',
      trigger: 'medium',
    },
  },
  storage: {
    bucket: {
      versioning: 'medium',
      lifecycle: 'medium',
      policy: 'medium',
      cors: 'low',
    },
  },
};

/** Fallback severity when the (resource_type, diff_key) pair is not in the table. */
export const SEVERITY_FALLBACK = 'medium';

const severityIndex = Object.fromEntries(SEVERITY_LEVELS.map((s, i) => [s, i]));

/**
 * Classify the severity of a conflict.
 *
 * @param {string} domain
 * @param {string} resource_type
 * @param {string[]} diffKeys
 * @returns {'low'|'medium'|'high'|'critical'}
 */
export function classifySeverity(domain, resource_type, diffKeys) {
  const domainEntry = SEVERITY_TABLE[domain];
  const resourceEntry = domainEntry?.[resource_type];

  let maxIdx = -1;

  for (const key of diffKeys) {
    const severity = resourceEntry?.[key] ?? SEVERITY_FALLBACK;
    const idx = severityIndex[severity] ?? severityIndex[SEVERITY_FALLBACK];
    if (idx > maxIdx) maxIdx = idx;
  }

  if (maxIdx < 0) return SEVERITY_FALLBACK;
  return SEVERITY_LEVELS[maxIdx];
}

/**
 * Compute the global risk level from all conflict entries.
 * Returns 'low' when there are no conflicts.
 *
 * @param {import('./types.mjs').ConflictEntry[]} allConflicts
 * @returns {'low'|'medium'|'high'|'critical'}
 */
export function computeGlobalRiskLevel(allConflicts) {
  if (!allConflicts || allConflicts.length === 0) return 'low';

  let maxIdx = 0; // 'low'
  for (const c of allConflicts) {
    const idx = severityIndex[c.severity] ?? 0;
    if (idx > maxIdx) maxIdx = idx;
  }
  return SEVERITY_LEVELS[maxIdx];
}
