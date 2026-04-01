/**
 * OpenWhisk action: Tenant config pre-flight conflict check.
 * POST /v1/admin/tenants/{tenant_id}/config/reprovision/preflight
 * Read-only: never modifies any subsystem. Does NOT acquire the reprovision lock.
 * @module actions/tenant-config-preflight
 */

import { randomUUID } from 'node:crypto';
import { KNOWN_DOMAINS, SKIPPABLE_DOMAIN_STATUSES, DOMAIN_ANALYSIS_STATUSES, emptyDomainResult } from '../preflight/types.mjs';
import { buildProposedIdentifierMap, validateIdentifierMap, applyIdentifierMap } from '../reprovision/identifier-map.mjs';
import { getAnalyzerRegistry, ANALYZER_ORDER } from '../preflight/analyzer-registry.mjs';
import { computeGlobalRiskLevel } from '../preflight/conflict-classifier.mjs';
import { insertPreflightAuditLog } from '../repositories/config-preflight-audit-repository.mjs';
import { publishPreflightAuditEvent } from '../events/config-preflight-events.mjs';
import { isSameMajor } from '../schemas/index.mjs';

const SUPPORTED_FORMAT_MAJOR = process.env.CONFIG_PREFLIGHT_SUPPORTED_FORMAT_MAJOR ?? '1';
const DEFAULT_ANALYZER_TIMEOUT_MS = Number(process.env.CONFIG_PREFLIGHT_ANALYZER_TIMEOUT_MS) || 10_000;

/**
 * Extract and validate JWT claims. Identical to reprovision action pattern.
 */
function extractAuth(params) {
  const authHeader = params?.__ow_headers?.authorization ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return null;

  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf-8'));
    const roles = payload.realm_access?.roles ?? [];
    const scopes = (payload.scope ?? '').split(' ').filter(Boolean);
    let actor_type = null;
    if (roles.includes('superadmin')) actor_type = 'superadmin';
    else if (roles.includes('sre')) actor_type = 'sre';
    else if (payload.azp && !roles.includes('tenant_owner') && scopes.includes('platform:admin:config:reprovision')) actor_type = 'service_account';
    return actor_type ? { actor_id: payload.sub ?? payload.preferred_username ?? 'unknown', actor_type, scopes } : null;
  } catch {
    return null;
  }
}

/**
 * Race a promise against a timeout.
 */
function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Analyzer '${label}' timed out after ${ms}ms`)), ms);
    promise.then(
      val => { clearTimeout(timer); resolve(val); },
      err => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * @param {Object} params - OpenWhisk action params
 * @param {Object} [overrides] - DI overrides for testing
 * @returns {Promise<{statusCode: number, headers?: object, body: object}>}
 */
export async function main(params = {}, overrides = {}) {
  const log = overrides.log ?? console;
  const db = overrides.db ?? params.db;
  const kafkaProducer = overrides.kafkaProducer ?? params.kafkaProducer ?? null;
  const registryFn = overrides.getAnalyzerRegistry ?? getAnalyzerRegistry;
  const auditFn = overrides.insertPreflightAuditLog ?? insertPreflightAuditLog;
  const publishFn = overrides.publishPreflightAuditEvent ?? publishPreflightAuditEvent;
  const tenantExistsFn = overrides.tenantExists ?? (async () => true);
  const isSameMajorFn = overrides.isSameMajor ?? isSameMajor;
  const analyzerCredentials = overrides.analyzerCredentials ?? {};

  const startedAt = Date.now();
  const correlationId = `pf-${randomUUID().slice(0, 12)}`;
  const analyzedAt = new Date().toISOString();

  // --- Auth ---
  const auth = overrides.auth ?? extractAuth(params);
  if (!auth) {
    return { statusCode: 403, body: { error: 'Forbidden: insufficient role or missing scope platform:admin:config:reprovision' } };
  }
  if (!auth.scopes?.includes('platform:admin:config:reprovision') && !overrides.auth) {
    return { statusCode: 403, body: { error: 'Forbidden: missing scope platform:admin:config:reprovision' } };
  }

  // --- Tenant ---
  const tenantId = params.tenant_id ?? params.__ow_path?.split('/').find((_, i, arr) => arr[i - 1] === 'tenants');
  if (!tenantId) {
    return { statusCode: 400, body: { error: 'tenant_id is required' } };
  }

  const exists = await tenantExistsFn(tenantId);
  if (!exists) {
    return { statusCode: 404, body: { error: `Tenant '${tenantId}' not found` } };
  }

  // --- Parse body ---
  const artifact = params.artifact;
  if (!artifact) {
    return { statusCode: 400, body: { error: 'artifact is required in the request body' } };
  }

  const requestedDomains = params.domains ?? null;
  let identifierMap = params.identifier_map ?? null;

  // --- Validate format_version ---
  const artifactVersion = artifact.format_version;
  if (!artifactVersion) {
    return { statusCode: 422, body: { error: 'artifact.format_version is required' } };
  }

  const artifactMajor = String(artifactVersion).split('.')[0];
  if (artifactMajor !== SUPPORTED_FORMAT_MAJOR && !(isSameMajorFn(artifactVersion, `${SUPPORTED_FORMAT_MAJOR}.0.0`))) {
    return { statusCode: 422, body: { error: `Incompatible format_version '${artifactVersion}'. Server supports major version ${SUPPORTED_FORMAT_MAJOR}. Migrate the artifact first.` } };
  }

  // --- Validate domains filter ---
  if (requestedDomains) {
    if (!Array.isArray(requestedDomains)) {
      return { statusCode: 400, body: { error: 'domains must be an array' } };
    }
    const unknownDomains = requestedDomains.filter(d => !KNOWN_DOMAINS.includes(d));
    if (unknownDomains.length > 0) {
      return { statusCode: 400, body: { error: `Unknown domain(s): ${unknownDomains.join(', ')}` } };
    }
  }

  // --- Identifier map handling ---
  const sourceTenantId = artifact.tenant_id;

  if (sourceTenantId && sourceTenantId !== tenantId) {
    if (!identifierMap) {
      // Need to return proposal without running analysis
      const proposal = buildProposedIdentifierMap(artifact, tenantId);

      // Audit the needs_confirmation call too
      try {
        await auditFn(db, {
          tenant_id: tenantId,
          source_tenant_id: sourceTenantId,
          actor_id: auth.actor_id,
          actor_type: auth.actor_type,
          domains_requested: requestedDomains ?? [],
          risk_level: 'low',
          format_version: artifactVersion,
          correlation_id: correlationId,
          executed_at: analyzedAt,
          identifier_map_provided: false,
        });
      } catch (err) {
        log.error?.({ event: 'preflight_audit_error', error: err.message });
      }

      try {
        await publishFn(kafkaProducer, {
          correlation_id: correlationId,
          actor_id: auth.actor_id,
          actor_type: auth.actor_type,
          tenant_id: tenantId,
          source_tenant_id: sourceTenantId,
          format_version: artifactVersion,
          needs_confirmation: true,
          duration_ms: Date.now() - startedAt,
        }, log);
      } catch (err) {
        log.error?.({ event: 'preflight_publish_error', error: err.message });
      }

      return {
        statusCode: 200,
        body: {
          correlation_id: correlationId,
          source_tenant_id: sourceTenantId,
          target_tenant_id: tenantId,
          format_version: artifactVersion,
          analyzed_at: analyzedAt,
          needs_confirmation: true,
          identifier_map_proposal: proposal,
          summary: {
            risk_level: 'low',
            total_resources_analyzed: 0,
            compatible: 0,
            compatible_with_redacted_fields: 0,
            conflict_counts: { low: 0, medium: 0, high: 0, critical: 0 },
            incomplete_analysis: false,
            domains_analyzed: [],
            domains_skipped: [],
          },
          domains: [],
        },
      };
    }

    // Validate the provided identifier_map
    try {
      validateIdentifierMap(identifierMap);
    } catch (err) {
      return { statusCode: 400, body: { error: err.message, details: err.details } };
    }
  }

  // --- Apply identifier map ---
  let processedArtifact = artifact;
  if (identifierMap) {
    processedArtifact = applyIdentifierMap(artifact, identifierMap);
  }

  // --- Build domain map ---
  const domainMap = new Map();
  if (Array.isArray(processedArtifact.domains)) {
    for (const d of processedArtifact.domains) {
      domainMap.set(d.domain_key, d);
    }
  }

  // --- Filter domains ---
  const targetDomainKeys = requestedDomains ?? ANALYZER_ORDER;
  const domainsToAnalyze = [];
  const skippedDomainResults = [];

  for (const dk of targetDomainKeys) {
    const domainEntry = domainMap.get(dk);
    if (!domainEntry) {
      skippedDomainResults.push(emptyDomainResult(dk, DOMAIN_ANALYSIS_STATUSES.SKIPPED, 'domain not present in artifact'));
      continue;
    }
    if (SKIPPABLE_DOMAIN_STATUSES.includes(domainEntry.status)) {
      skippedDomainResults.push(emptyDomainResult(dk, DOMAIN_ANALYSIS_STATUSES.SKIPPED, `domain status: ${domainEntry.status}`));
      continue;
    }
    domainsToAnalyze.push({ key: dk, data: domainEntry.data });
  }

  // --- Execute analyzers in parallel ---
  const registry = registryFn();
  const timeoutMs = overrides.analyzerTimeoutMs ?? DEFAULT_ANALYZER_TIMEOUT_MS;

  const analyzerPromises = domainsToAnalyze.map(({ key, data }) => {
    const analyzerFn = registry.get(key);
    if (!analyzerFn) {
      return Promise.resolve(emptyDomainResult(key, DOMAIN_ANALYSIS_STATUSES.SKIPPED, 'analyzer_not_enabled'));
    }
    return withTimeout(
      analyzerFn(tenantId, data, { credentials: analyzerCredentials[key] ?? {}, timeoutMs, log }),
      timeoutMs,
      key,
    );
  });

  const settled = await Promise.allSettled(analyzerPromises);
  const analyzerResults = settled.map((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    return emptyDomainResult(domainsToAnalyze[i].key, DOMAIN_ANALYSIS_STATUSES.ERROR, result.reason?.message ?? 'Unknown error');
  });

  // --- Combine domain results ---
  const allDomainResults = [...skippedDomainResults, ...analyzerResults];

  // --- Build summary ---
  const allConflicts = [];
  let totalAnalyzed = 0;
  let totalCompatible = 0;
  let totalRedacted = 0;
  const domainsAnalyzed = [];
  const domainsSkipped = [];

  for (const dr of allDomainResults) {
    if (dr.status === DOMAIN_ANALYSIS_STATUSES.ANALYZED || dr.status === DOMAIN_ANALYSIS_STATUSES.NO_CONFLICTS) {
      domainsAnalyzed.push(dr.domain_key);
      totalAnalyzed += dr.resources_analyzed;
      totalCompatible += dr.compatible_count;
      totalRedacted += dr.compatible_with_redacted_count;
      allConflicts.push(...dr.conflicts);
    } else {
      domainsSkipped.push(dr.domain_key);
    }
  }

  const conflictCounts = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const c of allConflicts) {
    conflictCounts[c.severity] = (conflictCounts[c.severity] ?? 0) + 1;
  }

  const incompleteAnalysis = allDomainResults.some(dr => dr.status === DOMAIN_ANALYSIS_STATUSES.ERROR);
  const riskLevel = computeGlobalRiskLevel(allConflicts);

  const summary = {
    risk_level: riskLevel,
    total_resources_analyzed: totalAnalyzed,
    compatible: totalCompatible,
    compatible_with_redacted_fields: totalRedacted,
    conflict_counts: conflictCounts,
    incomplete_analysis: incompleteAnalysis,
    domains_analyzed: domainsAnalyzed,
    domains_skipped: domainsSkipped,
  };

  const report = {
    correlation_id: correlationId,
    source_tenant_id: sourceTenantId ?? tenantId,
    target_tenant_id: tenantId,
    format_version: artifactVersion,
    analyzed_at: analyzedAt,
    summary,
    domains: allDomainResults,
  };

  // --- Audit ---
  try {
    await auditFn(db, {
      tenant_id: tenantId,
      source_tenant_id: sourceTenantId ?? tenantId,
      actor_id: auth.actor_id,
      actor_type: auth.actor_type,
      domains_requested: requestedDomains ?? ANALYZER_ORDER,
      domains_analyzed: domainsAnalyzed,
      domains_skipped: domainsSkipped,
      risk_level: riskLevel,
      conflict_count_low: conflictCounts.low,
      conflict_count_medium: conflictCounts.medium,
      conflict_count_high: conflictCounts.high,
      conflict_count_critical: conflictCounts.critical,
      compatible_count: totalCompatible,
      compatible_with_redacted_count: totalRedacted,
      total_resources_analyzed: totalAnalyzed,
      incomplete_analysis: incompleteAnalysis,
      identifier_map_provided: !!identifierMap,
      format_version: artifactVersion,
      correlation_id: correlationId,
      executed_at: analyzedAt,
    });
  } catch (err) {
    log.error?.({ event: 'preflight_audit_error', correlation_id: correlationId, error: err.message });
  }

  // --- Publish Kafka event ---
  try {
    await publishFn(kafkaProducer, {
      correlation_id: correlationId,
      actor_id: auth.actor_id,
      actor_type: auth.actor_type,
      tenant_id: tenantId,
      source_tenant_id: sourceTenantId ?? tenantId,
      format_version: artifactVersion,
      risk_level: riskLevel,
      incomplete_analysis: incompleteAnalysis,
      needs_confirmation: false,
      domains_analyzed: domainsAnalyzed,
      domains_skipped: domainsSkipped,
      conflict_counts: conflictCounts,
      total_resources_analyzed: totalAnalyzed,
      duration_ms: Date.now() - startedAt,
    }, log);
  } catch (err) {
    log.error?.({ event: 'preflight_publish_error', correlation_id: correlationId, error: err.message });
  }

  return { statusCode: 200, body: report };
}
