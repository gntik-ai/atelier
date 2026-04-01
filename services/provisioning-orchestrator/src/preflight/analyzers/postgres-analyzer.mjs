/**
 * PostgreSQL metadata domain analyzer for preflight conflict check.
 * Read-only: only SELECT queries.
 * @module preflight/analyzers/postgres-analyzer
 */

import { emptyDomainResult, DOMAIN_ANALYSIS_STATUSES } from '../types.mjs';
import { processResourceArray, aggregateDomainResults } from './analyzer-helpers.mjs';

const DOMAIN_KEY = 'postgres_metadata';

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

  const pgClient = credentials.pgClient ?? null;
  const schemaName = domainData.schema ?? tenantId.replace(/-/g, '_');

  const query = credentials.query ?? (async (sql, params) => {
    if (!pgClient) throw new Error('PostgreSQL client not available');
    const result = await pgClient.query(sql, params);
    return result.rows;
  });

  try {
    const results = [];

    // Schemas
    results.push(await processResourceArray({
      domain: DOMAIN_KEY,
      resourceType: 'schema',
      items: domainData.schemas,
      fetchExisting: async (item) => {
        const rows = await query(
          `SELECT schema_name FROM information_schema.schemata WHERE schema_name = $1`,
          [item.name],
        );
        return rows.length > 0 ? { name: rows[0].schema_name } : null;
      },
      getResourceName: (item) => item.name ?? 'unknown',
      log,
    }));

    // Tables
    results.push(await processResourceArray({
      domain: DOMAIN_KEY,
      resourceType: 'table',
      items: domainData.tables,
      fetchExisting: async (item) => {
        const cols = await query(
          `SELECT column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = $2
           ORDER BY ordinal_position`,
          [schemaName, item.name],
        );
        if (cols.length === 0) return null;
        return { name: item.name, columns: cols };
      },
      getResourceName: (item) => item.name ?? 'unknown',
      ignoreKeys: ['oid'],
      log,
    }));

    // Views
    results.push(await processResourceArray({
      domain: DOMAIN_KEY,
      resourceType: 'view',
      items: domainData.views,
      fetchExisting: async (item) => {
        const rows = await query(
          `SELECT viewname, definition FROM pg_views WHERE schemaname = $1 AND viewname = $2`,
          [schemaName, item.name],
        );
        return rows.length > 0 ? { name: rows[0].viewname, definition: rows[0].definition?.trim()?.toLowerCase() } : null;
      },
      getResourceName: (item) => item.name ?? 'unknown',
      log,
    }));

    // Extensions
    results.push(await processResourceArray({
      domain: DOMAIN_KEY,
      resourceType: 'extension',
      items: domainData.extensions,
      fetchExisting: async (item) => {
        const rows = await query(
          `SELECT extname, extversion FROM pg_extension WHERE extname = $1`,
          [item.name],
        );
        return rows.length > 0 ? { name: rows[0].extname, version: rows[0].extversion } : null;
      },
      getResourceName: (item) => item.name ?? 'unknown',
      log,
    }));

    // Grants
    results.push(await processResourceArray({
      domain: DOMAIN_KEY,
      resourceType: 'grant',
      items: domainData.grants,
      fetchExisting: async (item) => {
        const rows = await query(
          `SELECT grantee, privilege_type, table_name
           FROM information_schema.role_table_grants
           WHERE table_schema = $1 AND grantee = $2 AND table_name = $3`,
          [schemaName, item.grantee ?? item.name, item.table_name ?? item.object],
        );
        return rows.length > 0 ? { name: item.name ?? item.grantee, privilege: rows.map(r => r.privilege_type).sort().join(',') } : null;
      },
      getResourceName: (item) => item.name ?? item.grantee ?? 'unknown',
      log,
    }));

    return aggregateDomainResults(DOMAIN_KEY, results);
  } catch (err) {
    log.error?.({ event: 'preflight_postgres_analyzer_error', error: err.message });
    return emptyDomainResult(DOMAIN_KEY, DOMAIN_ANALYSIS_STATUSES.ERROR, err.message);
  }
}

function _isEmpty(data) {
  if (!data) return true;
  return (!data.schemas || data.schemas.length === 0) &&
    (!data.tables || data.tables.length === 0) &&
    (!data.views || data.views.length === 0) &&
    (!data.extensions || data.extensions.length === 0) &&
    (!data.grants || data.grants.length === 0);
}
