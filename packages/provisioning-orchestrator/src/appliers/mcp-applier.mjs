/**
 * MCP (server hosting) domain applier for tenant teardown
 * (change: add-mcp-runtime-deployment, issue #388; ADR-12).
 *
 * Symmetric with workflows-applier / functions-applier: exports
 * `teardown(tenantId, domainData, { dryRun, credentials, log })` returning a DomainResult
 * `{ status, resource_results, counts }`. The TEARDOWN_PLAN in tenant-purge-sweep.mjs appends
 * `{ domain:'mcp', dataKey:'mcp', teardownKey:'mcpTeardown' }` so a tenant purge cascades to the
 * MCP domain with the SAME partial-failure semantics as the other domains (any error →
 * counts.errors>0 → the sweep does NOT finalize and emits purge.failed).
 *
 * On the reuse-Knative runtime model (ADR-12), a tenant's MCP servers are Knative ksvcs labeled
 * `in-falcone.io/component: mcp-server` + tenant. Teardown therefore:
 *   1. deletes the tenant's MCP-server ksvcs (injected `deleteTenantMcpServers`) so no orphaned
 *      compute survives the tenant,
 *   2. deletes the tenant's MCP metadata rows (server registry, versions, tools, OAuth clients)
 *      from Postgres. Those tables are created by sibling changes (Instant-MCP #392, registry
 *      #396, OAuth #390); until they exist a missing-table (42P01) is treated as "already gone /
 *      not yet provisioned", not an error — exactly like workflows-applier.
 *
 * Idempotent: a second run deletes nothing (ksvcs already gone, rows already gone) and still
 * returns a non-error result — re-purging a tenant never errors.
 *
 * All I/O is dependency-injected and defaults to safe no-ops so the unit is fully testable with
 * fakes: `credentials.db` is `{ query(sql, params) }`; `credentials.deleteTenantMcpServers(tenantId)`
 * performs the Knative ksvc bulk-delete.
 */

import { zeroCounts } from '../reprovision/types.mjs';

const POSTGRES_TARGETS = [
  // FK-safe order: children (versions / tools / oauth clients) before the server head.
  { resourceType: 'mcp_server_versions', table: 'mcp_server_versions' },
  { resourceType: 'mcp_tools', table: 'mcp_tools' },
  { resourceType: 'mcp_oauth_clients', table: 'mcp_oauth_clients' },
  { resourceType: 'mcp_servers', table: 'mcp_servers' },
];

/**
 * @param {string} tenantId
 * @param {Object} domainData         the `mcp` section of tenant.domains (may be empty)
 * @param {Object} options
 * @param {boolean} [options.dryRun]
 * @param {Object} [options.credentials]
 *        - db: { query(sql, params) } — Postgres client for the MCP metadata rows
 *        - deleteTenantMcpServers(tenantId): Promise<{deleted:number}> — Knative ksvc bulk-delete
 *        - deferTenantMcpServers({tenantId, correlationId}): atomically persists hosted cleanup
 * @param {Console} [options.log]
 * @returns {Promise<import('../reprovision/types.mjs').DomainResult>}
 */
export async function teardown(tenantId, domainData = {}, options = {}) {
  const { dryRun = false, credentials = {}, log = console } = options;
  const domain_key = 'mcp';
  const counts = zeroCounts();
  const resource_results = [];

  const db = credentials.db ?? null;
  const deleteTenantMcpServers = credentials.deleteTenantMcpServers ?? null;
  const deferTenantMcpServers = credentials.deferTenantMcpServers ?? null;
  let cleanupPending = false;

  // 1. Delete the tenant's MCP-server ksvcs (reuse-Knative model). No orphaned compute.
  try {
    let deleted = 0;
    if (!dryRun && typeof deleteTenantMcpServers === 'function') {
      const r = await deleteTenantMcpServers(tenantId);
      if (r?.status === 'deletion_pending') {
        cleanupPending = true;
        throw Object.assign(new Error('Hosted MCP cleanup is pending runtime recovery'), {
          code: 'KNATIVE_UNAVAILABLE', correlationId: r.correlationId,
        });
      }
      deleted = Number(r?.deleted ?? 0);
    }
    resource_results.push({
      resource_type: 'mcp_servers_ksvc',
      resource_name: `tenantId=${tenantId}`,
      resource_id: tenantId,
      action: dryRun ? 'would_remove' : 'removed',
      message: dryRun ? null : `${deleted} MCP server(s) deleted`,
      warnings: [],
      diff: null,
    });
  } catch (err) {
    if (err?.code === 'KNATIVE_UNAVAILABLE' && !dryRun && typeof deferTenantMcpServers === 'function') {
      const pending = await deferTenantMcpServers({
        tenantId,
        correlationId: err.correlationId ?? credentials.correlationId,
      });
      cleanupPending = true;
      resource_results.push({
        resource_type: 'mcp_servers_ksvc',
        resource_name: `tenantId=${tenantId}`,
        resource_id: tenantId,
        action: 'error',
        message: `deletion_pending correlationId=${pending?.correlationId ?? err.correlationId ?? 'unavailable'}`,
        warnings: [],
        diff: null,
      });
      counts.errors++;
    } else {
    resource_results.push({
      resource_type: 'mcp_servers_ksvc',
      resource_name: `tenantId=${tenantId}`,
      resource_id: tenantId,
      action: 'error',
      message: err.message,
      warnings: [],
      diff: null,
    });
    counts.errors++;
    }
  }

  // The tenant purge sweep interprets errors as retryable aggregate incompletion. Do not delete
  // logical metadata while the durable runtime obligation is pending: doing so would make recovery
  // lose the tenant/server ownership boundary needed for safe cleanup.
  if (cleanupPending) {
    return { domain_key, status: 'error', resource_results, counts, message: 'Hosted MCP teardown is deletion_pending.' };
  }

  // 2. Delete the tenant's MCP metadata rows. RLS does not apply here — the purge runs as a
  // privileged sweep (BYPASSRLS), so the DELETE is tenant-scoped by the explicit `tenant_id = $1`
  // predicate. A missing table (42P01) means MCP was never provisioned for this tenant (or the
  // sibling change that creates it has not shipped): idempotent / not-an-error.
  if (typeof db?.query === 'function') {
    for (const target of POSTGRES_TARGETS) {
      try {
        let removed = 0;
        if (!dryRun) {
          const res = await db.query(`DELETE FROM ${target.table} WHERE tenant_id = $1`, [tenantId]);
          removed = res?.rowCount ?? 0;
        }
        resource_results.push({
          resource_type: target.resourceType,
          resource_name: `tenantId=${tenantId}`,
          resource_id: tenantId,
          action: dryRun ? 'would_remove' : 'removed',
          message: dryRun ? null : `${removed} row(s) removed`,
          warnings: [],
          diff: null,
        });
      } catch (err) {
        if (err?.code === '42P01') {
          resource_results.push({
            resource_type: target.resourceType,
            resource_name: `tenantId=${tenantId}`,
            resource_id: tenantId,
            action: dryRun ? 'would_skip' : 'skipped',
            message: 'table absent',
            warnings: [],
            diff: null,
          });
          continue;
        }
        resource_results.push({
          resource_type: target.resourceType,
          resource_name: `tenantId=${tenantId}`,
          resource_id: tenantId,
          action: 'error',
          message: err.message,
          warnings: [],
          diff: null,
        });
        counts.errors++;
      }
    }
  }

  const status = counts.errors > 0 ? 'error' : (dryRun ? 'would_apply' : 'applied');
  return { domain_key, status, resource_results, counts, message: null };
}
