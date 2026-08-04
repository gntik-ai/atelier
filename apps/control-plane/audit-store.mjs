// Action-audit store (domain B, kind deploy) — the WRITER side of the
// Observability audit-records surface (add-audit-write-and-scope-enforcement-store, #557).
//
// The live 2-tenant campaign found that after real control-plane actions (create
// users / workspaces / etc.) the audit-records query returned ZERO entries: nothing
// wrote an audit record, and the metrics audit handler returned a hardcoded empty
// page. This module records each mutating action into `plan_audit_events` (the table
// already created at boot in tenant-store.mjs, carrying a correlation_id column) and
// reads it back, TENANT-SCOPED, for the metrics audit-records handler.
//
// Isolation (cardinal rule, multitenant BaaS): every record carries tenant_id (and,
// when applicable, the owning workspace under new_state.workspaceId); reads are
// filtered by the path-resolved tenant (and workspace) so a tenant only ever sees its
// own action history. The metrics handler additionally guards cross-tenant access
// before calling in.
//
// plan_audit_events columns (see tenant-store.mjs::ensureSchema):
//   id, action_type, actor_id, tenant_id, plan_id, previous_state, new_state,
//   correlation_id, created_at. We reuse it as the generic action-audit log: the
//   workspace id (when present) is carried in new_state.workspaceId so the workspace
//   read can filter without a schema change.

import { randomUUID } from 'node:crypto';
import { auditCanonical, computeRowHash } from './audit-hash.mjs';

const ACTION_CATEGORY_BY_TYPE = Object.freeze({
  'tenant.create': 'resource_creation',
  'tenant.delete': 'resource_deletion',
  'tenant.purge': 'resource_deletion',
  'tenant.user.create': 'access_control_modification',
  'tenant.auth-config.update': 'access_control_modification',
  'tenant.social-provider.upsert': 'access_control_modification',
  'tenant.social-provider.delete': 'access_control_modification',
  'workspace.create': 'resource_creation',
  'workspace.promote': 'configuration_change',
  'workspace.service-account.create': 'access_control_modification',
  'workspace.service-account.credential.issue': 'access_control_modification',
  'workspace.service-account.credential.rotate': 'configuration_change',
  'workspace.service-account.credential.revoke': 'access_control_modification',
  'workspace.database.provision': 'resource_creation',
  'workspace.database.credential.rotate': 'configuration_change',
  'workspace.function.register': 'resource_creation',
  'workspace.secret.set': 'configuration_change',
  'workspace.secret.get': 'configuration_change',
  'workspace.secret.list': 'configuration_change',
  'workspace.secret.delete': 'configuration_change',
  'iam.user.create': 'access_control_modification',
  'iam.user.delete': 'access_control_modification',
  'iam.user.status': 'access_control_modification',
  'iam.role.create': 'access_control_modification',
  'iam.group.create': 'access_control_modification',
  'iam.user.role-assign': 'access_control_modification',
  'iam.user.role-remove': 'access_control_modification',
  'iam.user.group-add': 'access_control_modification',
  'iam.user.group-remove': 'access_control_modification',
  'quota.override.created': 'quota_adjustment',
  'quota.override.modified': 'quota_adjustment',
  'quota.override.revoked': 'quota_adjustment',
  'quota.override.superseded': 'quota_adjustment',
  'quota.override.expired': 'quota_adjustment',
  'quota.sub_quota.set': 'quota_adjustment',
  'quota.sub_quota.removed': 'quota_adjustment',
  'plan.limit.set': 'quota_adjustment',
  'plan.limit.removed': 'quota_adjustment',
  'plan.capability.enabled': 'configuration_change',
  'plan.capability.disabled': 'configuration_change',
  'plan.created': 'configuration_change',
  'plan.updated': 'configuration_change',
  'plan.lifecycle_transitioned': 'configuration_change',
  'plan.change_impact_recorded': 'configuration_change',
  'assignment.created': 'configuration_change',
  'assignment.superseded': 'configuration_change'
});
const CONTRACTUAL_ACTION_CATEGORIES = new Set([
  'resource_creation',
  'resource_deletion',
  'configuration_change',
  'access_control_modification',
  'quota_adjustment',
  'privilege_escalation',
  'secret_rotation',
  'policy_override',
  'backup_restore',
  'provider_reconciliation'
]);

const ACTION_CATEGORY_SQL = `COALESCE(
  NULLIF(new_state->>'actionCategory', ''),
  NULLIF(new_state->>'action_category', ''),
  CASE action_type
    ${Object.entries(ACTION_CATEGORY_BY_TYPE).map(([actionType, category]) => `WHEN '${actionType}' THEN '${category}'`).join('\n    ')}
    ELSE 'configuration_change'
  END
)`;

function filterValue(value) {
  if (value === undefined || value === null || value === '') return null;
  return String(value);
}

export function auditActionCategoryForType(actionType, explicitCategory = null) {
  const explicit = filterValue(explicitCategory);
  if (explicit && CONTRACTUAL_ACTION_CATEGORIES.has(explicit)) return explicit;
  const key = filterValue(actionType);
  return ACTION_CATEGORY_BY_TYPE[key] ?? 'configuration_change';
}

// Record a single action-audit event. Best-effort by design: auditing must NEVER
// fail the action it describes, so callers wrap this and swallow errors.
//
// The row carries the TRUE `outcome` (succeeded/denied/failed/error) and is linked
// into a per-tenant append-only HASH CHAIN (#644): within one transaction holding a
// per-tenant advisory lock (to serialize concurrent audit writes for the tenant), we
// read the tenant's latest row_hash as prev_hash, generate id + created_at in-app so
// they are covered by the hash, compute row_hash, and INSERT atomically.
export async function recordAuditEvent(db, {
  actionType, actorId, tenantId = null, workspaceId = null, outcome = 'succeeded',
  previousState = null, newState = {}, correlationId = null
} = {}) {
  const merged = workspaceId ? { ...(newState ?? {}), workspaceId } : (newState ?? {});
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const at = String(actionType ?? 'action').slice(0, 64);
  const actor = String(actorId ?? 'unknown');
  const tid = tenantId ?? null;

  const usePooled = typeof db.connect === 'function';
  const client = usePooled ? await db.connect() : db;
  try {
    await client.query('BEGIN');
    // Serialize per-tenant chain appends so two concurrent writes can't fork it.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1)::int8)', [`audit:${tid ?? 'global'}`]);
    const prev = await client.query(
      'SELECT row_hash FROM plan_audit_events WHERE tenant_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1',
      [tid]
    );
    const prevHash = prev.rows[0]?.row_hash ?? '';
    const rowHash = computeRowHash(auditCanonical({ id, actionType: at, actorId: actor, tenantId: tid, outcome, createdAt, newState: merged }), prevHash);
    const res = await client.query(
      `INSERT INTO plan_audit_events (id, action_type, actor_id, tenant_id, plan_id, previous_state, new_state, outcome, correlation_id, created_at, prev_hash, row_hash)
       VALUES ($1,$2,$3,$4,NULL,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11)
       RETURNING id, action_type, actor_id, tenant_id, previous_state, new_state, outcome, correlation_id, created_at, prev_hash, row_hash`,
      [id, at, actor, tid, previousState == null ? null : JSON.stringify(previousState), JSON.stringify(merged ?? {}), outcome, correlationId ?? null, createdAt, prevHash, rowHash]
    );
    await client.query('COMMIT');
    return res.rows[0] ?? null;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally {
    if (usePooled) client.release?.();
  }
}

// Read action-audit events for a scope, NEWEST first. Always filtered by tenant_id;
// when workspaceId is given, additionally filter to events whose new_state.workspaceId
// matches (workspace-scoped read). Optional audit filters are SQL predicates, so an
// unmatched value narrows to an empty page rather than falling back to the full set.
// `tenantId` is required — never return cross-tenant.
export async function queryAuditEvents(db, {
  tenantId,
  workspaceId = null,
  limit = 50,
  outcome = null,
  actionCategory = null,
  actorId = null,
  occurredAfter = null,
  occurredBefore = null
} = {}) {
  if (!tenantId) return [];
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const params = [tenantId];
  const where = ['tenant_id = $1'];
  if (workspaceId) {
    params.push(workspaceId);
    where.push(`new_state->>'workspaceId' = $${params.length}`);
  }
  const outcomeFilter = filterValue(outcome);
  if (outcomeFilter) {
    params.push(outcomeFilter);
    where.push(`outcome = $${params.length}`);
  }
  const actionCategoryFilter = filterValue(actionCategory);
  if (actionCategoryFilter) {
    params.push(actionCategoryFilter);
    where.push(`(${ACTION_CATEGORY_SQL} = $${params.length} OR action_type = $${params.length})`);
  }
  const actorFilter = filterValue(actorId);
  if (actorFilter) {
    params.push(actorFilter);
    where.push(`actor_id = $${params.length}`);
  }
  const afterFilter = filterValue(occurredAfter);
  if (afterFilter) {
    params.push(afterFilter);
    where.push(`created_at >= $${params.length}::timestamptz`);
  }
  const beforeFilter = filterValue(occurredBefore);
  if (beforeFilter) {
    params.push(beforeFilter);
    where.push(`created_at <= $${params.length}::timestamptz`);
  }
  params.push(safeLimit);
  const sql = `SELECT id, action_type, ${ACTION_CATEGORY_SQL} AS action_category,
              actor_id, tenant_id, new_state->>'workspaceId' AS workspace_id,
              previous_state, new_state, outcome, correlation_id, created_at, prev_hash, row_hash
         FROM plan_audit_events
         WHERE ${where.join(' AND ')}
         ORDER BY created_at DESC, id DESC LIMIT $${params.length}`;
  const res = await db.query(sql, params);
  return res.rows ?? [];
}

// Map a plan_audit_events row -> the Observability audit-record shape the console
// audit-records page consumes (eventId/eventTimestamp/actor/scope/action/result/
// correlationId). Mirrors apps/control-plane-executor/src/observability-audit-query.mjs's
// normalizeAuditRecord so the kind read is shape-compatible with the product.
export function auditRowToRecord(row = {}) {
  const newState = row.new_state && typeof row.new_state === 'object' && !Array.isArray(row.new_state)
    ? row.new_state
    : {};
  const eventId = String(row.id ?? `legacy-${row.created_at ?? 'event'}`);
  const parsedTimestamp = new Date(row.created_at ?? 0);
  const eventTimestamp = Number.isFinite(parsedTimestamp.valueOf())
    ? parsedTimestamp.toISOString()
    : new Date(0).toISOString();
  const workspaceId = row.workspace_id ?? newState.workspaceId ?? null;
  const storedOutcome = row.outcome === 'error' ? 'failed' : row.outcome;
  const actionCategory = auditActionCategoryForType(
    row.action_type,
    row.action_category ?? newState.actionCategory ?? newState.action_category
  );
  return {
    eventId,
    eventTimestamp,
    actor: {
      actorId: String(row.actor_id ?? 'unknown'),
      actorType: row.actor_id ? (workspaceId ? 'workspace_user' : 'tenant_user') : 'system'
    },
    scope: {
      scopeMode: workspaceId ? 'tenant_workspace' : 'tenant',
      tenantId: String(row.tenant_id ?? 'unknown'),
      ...(workspaceId ? { workspaceId: String(workspaceId) } : {})
    },
    resource: {
      subsystemId: 'control-plane',
      resourceType: String(row.action_type ?? 'action').split('.')[0] || 'action'
    },
    action: { actionId: String(row.action_type ?? 'unknown_action'), category: actionCategory },
    actionType: row.action_type ?? null,
    // True outcome from the stored column (#644); legacy NULL rows are conservatively partial.
    result: {
      outcome: ['succeeded', 'denied', 'failed', 'partial', 'accepted'].includes(storedOutcome)
        ? storedOutcome
        : 'partial'
    },
    correlationId: String(row.correlation_id ?? `legacy-${eventId}`),
    origin: { originSurface: 'control_api', emittingService: 'control-plane' },
    // Tamper-evidence: expose the per-tenant hash-chain links so a client can verify.
    rowHash: row.row_hash ?? null,
    prevHash: row.prev_hash ?? null,
    detail: newState
  };
}
