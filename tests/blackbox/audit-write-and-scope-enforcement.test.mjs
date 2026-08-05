/**
 * Black-box tests for the audit WRITER + scope-enforcement denial writer
 * (add-audit-write-and-scope-enforcement-store, #557, epic #541).
 *
 * Live 2-tenant E2E (2026-06-18): after performing real actions (create
 * users/workspaces/etc.) the audit-records query returned ZERO entries — no
 * action audit records were written, and none carried correlation ids; the
 * scope-enforcement audit query did not surface any denials.
 *
 * This suite drives the PUBLIC surfaces only:
 *   - the kind control-plane audit store (recordAuditEvent / queryAuditEvents),
 *   - the metrics audit-records read handler (METRICS_HANDLERS.metricsTenantAudit
 *     / metricsWorkspaceAudit), which must surface written records tenant-scoped,
 *   - the scope-enforcement denial writer (recordScopeDenial) feeding the product
 *     scope-enforcement-audit-query action.
 *
 * bbx-audit-write-01: a recorded action surfaces in the tenant audit-records read WITH its correlation id
 * bbx-audit-write-02: audit-records reads are own-tenant scoped (tenant B never sees tenant A's records)
 * bbx-audit-write-03: a workspace action surfaces in the workspace audit-records read
 * bbx-audit-write-04: the dispatch-level writer records a mutating local action with the request correlation id
 * bbx-audit-write-05: a recorded scope-enforcement denial is returned by the scope-enforcement audit query (no 500)
 * bbx-audit-write-06: scope-enforcement denials are tenant-scoped (a tenant owner sees only its own)
 * bbx-audit-filter-07: outcome filters narrow tenant audit records and impossible values return empty
 * bbx-audit-filter-08: actionCategory and actorId filters narrow tenant audit records
 * bbx-audit-filter-09: occurredAfter/occurredBefore filters narrow tenant audit records
 * bbx-audit-filter-10: derived action categories stay in the audit event schema vocabulary
 * bbx-c09-01..11: fn-observability-audit-record-query — C-09 query-semantics scenarios
 */
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import { METRICS_HANDLERS } from '../../apps/control-plane/metrics-handlers.mjs';
import {
  auditActionCategoryForType,
  auditQueryFingerprint,
  recordAuditEvent
} from '../../apps/control-plane/audit-store.mjs';
import { recordScopeDenial, auditEventForRoute } from '../../apps/control-plane/audit-writer.mjs';
import { main as scopeAuditQuery } from '../../packages/provisioning-orchestrator/src/actions/scope-enforcement-audit-query.mjs';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const WS_A = '33333333-3333-3333-3333-333333333333';
const WS_B = '44444444-4444-4444-4444-444444444444';

const WS_A_ROW = { id: WS_A, tenant_id: TENANT_A, slug: 'app-staging', display_name: 'App Staging', status: 'active', environment: 'staging' };
const WS_B_ROW = { id: WS_B, tenant_id: TENANT_B, slug: 'other-production', display_name: 'Other Production', status: 'active', environment: 'production' };
const TENANT_A_ROW = { id: TENANT_A, slug: 'tenant-a', display_name: 'Tenant A', status: 'active', iam_realm: 'tenant-a', created_at: '2026-06-18T00:00:00.000Z', created_by: 'blackbox' };
const TENANT_B_ROW = { id: TENANT_B, slug: 'tenant-b', display_name: 'Tenant B', status: 'active', iam_realm: 'tenant-b', created_at: '2026-06-18T00:00:00.000Z', created_by: 'blackbox' };
const AUDIT_EVENT_SCHEMA = JSON.parse(readFileSync(new URL('../../packages/internal-contracts/src/observability-audit-event-schema.json', import.meta.url), 'utf8'));
const AUDIT_ACTION_CATEGORIES = new Set(AUDIT_EVENT_SCHEMA.action.categories);
const C09_FILTER_IDS = [
  'occurred_after', 'occurred_before', 'subsystem', 'action_category', 'action_id', 'outcome',
  'actor_type', 'actor_id', 'resource_type', 'resource_id', 'origin_surface', 'correlation_id'
];

function auditUuid(sequence) {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${String(sequence).padStart(12, '0')}`;
}

function normalizedSql(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

function sqlParameterIndex(sql, pattern) {
  const match = sql.match(pattern);
  return match ? Number(match[1]) - 1 : -1;
}

function canonicalAuditValues(row) {
  const state = row.new_state ?? {};
  return new Set([
    row.subsystem ?? state.subsystem ?? state.subsystemId ?? 'tenant_control_plane',
    auditActionCategoryForType(row.action_type, row.action_category ?? state.actionCategory ?? state.action_category),
    row.action_id ?? row.action_type,
    row.outcome,
    row.actor_type ?? state.actorType ?? state.actor_type ?? (row.workspace_id ? 'workspace_user' : 'tenant_user'),
    row.actor_id,
    row.resource_type ?? state.resourceType ?? state.resource_type ?? (row.workspace_id ? 'workspace' : 'tenant'),
    row.resource_id ?? state.resourceId ?? state.resource_id ?? row.workspace_id ?? row.tenant_id,
    row.origin_surface ?? state.originSurface ?? state.origin_surface ?? 'control_api',
    row.correlation_id ?? `legacy-${row.id}`
  ].filter((value) => value !== null && value !== undefined));
}

// In-memory pool that emulates the plan_audit_events + scope_enforcement_denials
// tables. It honours the WHERE tenant_id / workspace + ORDER BY / column shape the
// real handlers use, so we exercise tenant-scoping through the public read path.
function memPool() {
  const audit = [];
  const denials = [];
  const queries = [];
  const query = async (sql, params = []) => {
    const s = normalizedSql(sql);
    queries.push({ sql: s, params: [...params] });
    // #644: recordAuditEvent now runs in a per-tenant transaction (advisory lock +
    // prev-hash read + chained INSERT). The stub honours those statements.
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(s) || s.includes('pg_advisory_xact_lock')) return { rows: [] };
    if (s.includes('SELECT row_hash FROM plan_audit_events')) {
      const tenantId = params[0];
      const rows = audit.filter((r) => r.tenant_id === tenantId);
      const last = rows[rows.length - 1];
      return { rows: last ? [{ row_hash: last.row_hash }] : [] };
    }
    if (s.includes('INSERT INTO plan_audit_events')) {
      // #644 INSERT params: [id, action_type, actor_id, tenant_id, previous_state, new_state, outcome, correlation_id, created_at, prev_hash, row_hash]
      const [id, action_type, actor_id, tenant_id, previous_state, new_state, outcome, correlation_id, created_at, prev_hash, row_hash] = params;
      const parsedNew = new_state ? JSON.parse(new_state) : {};
      const row = {
        id, action_type, actor_id, tenant_id,
        workspace_id: parsedNew.workspaceId ?? null,
        previous_state: previous_state ? JSON.parse(previous_state) : null,
        new_state: parsedNew, outcome, correlation_id: correlation_id ?? null,
        created_at, prev_hash, row_hash
      };
      audit.push(row);
      return { rows: [row] };
    }
    if (s.includes('FROM plan_audit_events')) {
      // The public handler owns SQL construction. This fake datastore observes its
      // parameters and evaluates the selected predicates against an isolated dataset.
      const tenantId = params[0];
      let nextParam = 1;
      const workspaceId = s.includes("new_state->>'workspaceId' =") ? params[nextParam++] : null;
      let rows = audit.filter((r) => r.tenant_id === tenantId);
      if (workspaceId) rows = rows.filter((r) => r.workspace_id === workspaceId);

      const afterIndex = sqlParameterIndex(s, /created_at\s*>=\s*\$(\d+)/i);
      const beforeIndex = sqlParameterIndex(s, /created_at\s*<=\s*\$(\d+)/i);
      if (afterIndex >= 0) {
        rows = rows.filter((r) => new Date(r.created_at).valueOf() >= new Date(params[afterIndex]).valueOf());
      }
      if (beforeIndex >= 0) {
        rows = rows.filter((r) => new Date(r.created_at).valueOf() <= new Date(params[beforeIndex]).valueOf());
      }

      const cursorMatch = s.match(/\(?\s*created_at\s*,\s*id\s*\)?\s*([<>])\s*\(\s*\$(\d+)(?:::[^, )]+)?\s*,\s*\$(\d+)/i);
      const cursorIndexes = new Set();
      if (cursorMatch) {
        const [, operator, timestampNumber, idNumber] = cursorMatch;
        const timestampIndex = Number(timestampNumber) - 1;
        const idIndex = Number(idNumber) - 1;
        cursorIndexes.add(timestampIndex);
        cursorIndexes.add(idIndex);
        const cursorTimestamp = String(params[timestampIndex]);
        const cursorId = String(params[idIndex]);
        rows = rows.filter((row) => {
          const comparison = String(row.created_at).localeCompare(cursorTimestamp)
            || String(row.id).localeCompare(cursorId);
          return operator === '<' ? comparison < 0 : comparison > 0;
        });
      }

      const limitIndex = sqlParameterIndex(s, /LIMIT\s+\$(\d+)/i);
      const nonFilterIndexes = new Set([0, afterIndex, beforeIndex, limitIndex, ...cursorIndexes]);
      if (workspaceId) nonFilterIndexes.add(1);
      const exactFilterValues = params.filter((_, index) => index >= nextParam && !nonFilterIndexes.has(index));
      for (const filterValue of exactFilterValues) {
        rows = rows.filter((row) => canonicalAuditValues(row).has(filterValue));
      }

      const ascending = /ORDER BY\s+created_at\s+ASC\s*,\s*id\s+ASC/i.test(s);
      rows = rows.slice().sort((a, b) => {
        const comparison = String(a.created_at).localeCompare(String(b.created_at))
          || String(a.id).localeCompare(String(b.id));
        return ascending ? comparison : -comparison;
      });
      const limit = limitIndex >= 0 ? Number(params[limitIndex]) : rows.length;
      return {
        rows: rows.slice(0, limit).map((r) => ({
          ...r,
          action_category: auditActionCategoryForType(r.action_type, r.action_category ?? r.new_state?.actionCategory ?? r.new_state?.action_category),
          canonical_correlation_id: r.correlation_id ?? `legacy-${r.id}`,
          cursor_created_at: r.created_at
        }))
      };
    }
    if (s.includes('FROM tenants')) {
      const tenant = [TENANT_A_ROW, TENANT_B_ROW].find((row) => row.id === params[0] || row.slug === params[0]);
      return { rows: tenant ? [tenant] : [] };
    }
    if (s.includes('FROM workspaces')) {
      const workspace = [WS_A_ROW, WS_B_ROW].find((row) => row.id === params[0]);
      return { rows: workspace ? [workspace] : [] };
    }
    if (s.includes('INSERT INTO scope_enforcement_denials')) {
      const row = {
        id: params[0], tenant_id: params[1], workspace_id: params[2], actor_id: params[3], actor_type: params[4],
        denial_type: params[5], http_method: params[6], request_path: params[7], correlation_id: params[14], denied_at: params[15]
      };
      // honour ON CONFLICT (correlation_id, denied_at) DO NOTHING
      if (denials.some((d) => d.correlation_id === row.correlation_id && d.denied_at === row.denied_at)) return { rows: [] };
      denials.push(row);
      return { rows: [row] };
    }
    if (s.includes('FROM scope_enforcement_denials')) {
      const tenantId = s.includes('tenant_id = $3') ? params[2] : null;
      let rows = denials.filter((d) => !tenantId || d.tenant_id === tenantId);
      if (s.includes('COUNT(*)')) return { rows: [{ total: rows.length }] };
      return { rows };
    }
    return { rows: [] };
  };
  const client = { query, release() {} };
  return { query, connect: async () => client, _audit: audit, _denials: denials, _queries: queries };
}

const IDENTITY_A = { sub: 'user-a', tenantId: TENANT_A, workspaceId: WS_A, actorType: 'tenant_owner', roles: ['tenant_owner'], scopes: [] };
const IDENTITY_B = { sub: 'user-b', tenantId: TENANT_B, workspaceId: null, actorType: 'tenant_owner', roles: ['tenant_owner'], scopes: [] };
const IDENTITY_SA = { sub: 'sa', tenantId: null, workspaceId: null, actorType: 'superadmin', roles: ['superadmin'], scopes: [] };

function metricsCtx(pool, identity, params = {}, query = {}) {
  return { pool, params, query, body: {}, identity, callerContext: { actor: { id: identity.sub, type: identity.actorType }, tenantId: identity.tenantId } };
}

function seedAuditRow(pool, row) {
  pool._audit.push({
    id: row.id,
    action_type: row.action_type,
    action_category: row.action_category ?? row.new_state?.actionCategory ?? row.new_state?.action_category ?? null,
    subsystem: row.subsystem ?? row.new_state?.subsystem ?? null,
    subsystem_id: row.subsystem_id ?? row.subsystem ?? row.new_state?.subsystem ?? null,
    actor_type: row.actor_type ?? row.new_state?.actorType ?? row.new_state?.actor_type ?? null,
    actor_id: row.actor_id,
    tenant_id: row.tenant_id,
    workspace_id: row.workspace_id ?? row.new_state?.workspaceId ?? null,
    resource_type: row.resource_type ?? row.new_state?.resourceType ?? row.new_state?.resource_type ?? null,
    resource_id: row.resource_id ?? row.new_state?.resourceId ?? row.new_state?.resource_id ?? null,
    origin_surface: row.origin_surface ?? row.new_state?.originSurface ?? row.new_state?.origin_surface ?? null,
    previous_state: row.previous_state ?? null,
    new_state: row.new_state ?? {},
    outcome: row.outcome ?? 'succeeded',
    correlation_id: row.correlation_id ?? null,
    created_at: row.created_at,
    prev_hash: row.prev_hash ?? '',
    row_hash: row.row_hash ?? ''
  });
}

function auditSelects(pool) {
  return pool._queries.filter(({ sql }) => /\bSELECT\b/i.test(sql) && sql.includes('FROM plan_audit_events'));
}

function writeStatements(pool) {
  return pool._queries.filter(({ sql }) => /^(?:INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE)\b/i.test(sql));
}

function c09AuditRow(overrides = {}) {
  const workspaceId = overrides.workspace_id === undefined ? WS_A : overrides.workspace_id;
  return {
    id: 'evt-c09-target',
    action_type: 'workspace.database.rotate',
    action_category: 'secret_rotation',
    subsystem: 'tenant_control_plane',
    subsystem_id: 'tenant_control_plane',
    actor_type: 'service_account',
    actor_id: 'actor-c09',
    tenant_id: TENANT_A,
    workspace_id: workspaceId,
    resource_type: 'database',
    resource_id: 'db-c09',
    origin_surface: 'control_api',
    outcome: 'succeeded',
    correlation_id: 'corr-c09',
    created_at: '2026-08-04T12:00:00.000Z',
    new_state: {
      workspaceId,
      actorType: 'service_account',
      resourceType: 'database',
      resourceId: 'db-c09',
      originSurface: 'control_api',
      subsystem: 'tenant_control_plane'
    },
    ...overrides
  };
}

test('bbx-audit-write-01: a recorded action surfaces in the tenant audit-records read WITH its correlation id', async () => {
  const pool = memPool();
  await recordAuditEvent(pool, {
    actionType: 'tenant.user.create', actorId: 'user-a', tenantId: TENANT_A,
    newState: { username: 'alice' }, correlationId: 'corr-aaa'
  });
  const r = await METRICS_HANDLERS.metricsTenantAudit(metricsCtx(pool, IDENTITY_A, { tenantId: TENANT_A }));
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.items.length, 1, `expected 1 audit item, got ${JSON.stringify(r.body.items)}`);
  const item = r.body.items[0];
  assert.equal(item.correlationId, 'corr-aaa', `correlationId missing: ${JSON.stringify(item)}`);
  assert.equal(item.action?.actionId ?? item.actionType, 'tenant.user.create');
});

test('bbx-audit-write-02: audit-records reads are own-tenant scoped (B never sees A)', async () => {
  const pool = memPool();
  await recordAuditEvent(pool, { actionType: 'tenant.create', actorId: 'sa', tenantId: TENANT_A, newState: {}, correlationId: 'corr-a' });
  // Tenant B reading its OWN tenant sees nothing of A.
  const r = await METRICS_HANDLERS.metricsTenantAudit(metricsCtx(pool, IDENTITY_B, { tenantId: TENANT_B }));
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.items.length, 0, `tenant B leaked A's records: ${JSON.stringify(r.body.items)}`);
  // Tenant B reading tenant A's scope is forbidden at the guard.
  const cross = await METRICS_HANDLERS.metricsTenantAudit(metricsCtx(pool, IDENTITY_B, { tenantId: TENANT_A }));
  assert.equal(cross.statusCode, 403, JSON.stringify(cross.body));
});

test('bbx-audit-write-03: a workspace action surfaces in the workspace audit-records read', async () => {
  const pool = memPool();
  await recordAuditEvent(pool, {
    actionType: 'workspace.create', actorId: 'user-a', tenantId: TENANT_A, workspaceId: WS_A,
    newState: { slug: 'app-staging' }, correlationId: 'corr-ws'
  });
  // an unrelated tenant-only event that must NOT appear in the workspace read
  await recordAuditEvent(pool, { actionType: 'tenant.create', actorId: 'sa', tenantId: TENANT_A, newState: {}, correlationId: 'corr-t' });
  const r = await METRICS_HANDLERS.metricsWorkspaceAudit(metricsCtx(pool, IDENTITY_A, { workspaceId: WS_A }));
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.items.length, 1, `expected only the workspace event, got ${JSON.stringify(r.body.items)}`);
  assert.equal(r.body.items[0].correlationId, 'corr-ws');
});

test('bbx-audit-filter-07: outcome filters narrow tenant audit records and unknown enums fail closed', async () => {
  const pool = memPool();
  await recordAuditEvent(pool, {
    actionType: 'tenant.user.create', actorId: 'actor-a', tenantId: TENANT_A, outcome: 'failed',
    newState: { username: 'bad' }, correlationId: 'corr-failed-a'
  });
  await recordAuditEvent(pool, {
    actionType: 'tenant.user.create', actorId: 'actor-a', tenantId: TENANT_A, outcome: 'succeeded',
    newState: { username: 'good' }, correlationId: 'corr-succeeded-a'
  });
  await recordAuditEvent(pool, {
    actionType: 'tenant.user.create', actorId: 'actor-b', tenantId: TENANT_B, outcome: 'failed',
    newState: { username: 'foreign' }, correlationId: 'corr-failed-b'
  });

  const r = await METRICS_HANDLERS.metricsTenantAudit(metricsCtx(
    pool,
    IDENTITY_A,
    { tenantId: TENANT_A },
    { 'page[size]': '50', 'filter[outcome]': 'failed' }
  ));
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.items.length, 1, `outcome filter must narrow to tenant A failed records: ${JSON.stringify(r.body.items)}`);
  assert.equal(r.body.items[0].result.outcome, 'failed');
  assert.equal(r.body.items[0].scope.tenantId, TENANT_A);
  assert.equal(r.body.items[0].correlationId, 'corr-failed-a');

  const none = await METRICS_HANDLERS.metricsTenantAudit(metricsCtx(
    pool,
    IDENTITY_A,
    { tenantId: TENANT_A },
    { 'page[size]': '50', 'filter[outcome]': 'zzz' }
  ));
  assert.equal(none.statusCode, 400, JSON.stringify(none.body));
});

test('bbx-audit-filter-08: actionCategory and actorId filters narrow tenant audit records', async () => {
  const pool = memPool();
  await recordAuditEvent(pool, {
    actionType: 'tenant.user.create', actorId: 'actor-target', tenantId: TENANT_A,
    newState: { actionCategory: 'access_control_modification', username: 'alice' }, correlationId: 'corr-access'
  });
  await recordAuditEvent(pool, {
    actionType: 'workspace.create', actorId: 'actor-other', tenantId: TENANT_A,
    newState: { actionCategory: 'resource_creation', slug: 'app' }, correlationId: 'corr-resource'
  });

  const byCategory = await METRICS_HANDLERS.metricsTenantAudit(metricsCtx(
    pool,
    IDENTITY_A,
    { tenantId: TENANT_A },
    { 'page[size]': '50', 'filter[actionCategory]': 'access_control_modification' }
  ));
  assert.equal(byCategory.statusCode, 200, JSON.stringify(byCategory.body));
  assert.equal(byCategory.body.items.length, 1, `category filter must narrow: ${JSON.stringify(byCategory.body.items)}`);
  assert.equal(byCategory.body.items[0].action.actionId, 'tenant.user.create');
  assert.equal(byCategory.body.items[0].action.category, 'access_control_modification');

  const byActionId = await METRICS_HANDLERS.metricsTenantAudit(metricsCtx(
    pool,
    IDENTITY_A,
    { tenantId: TENANT_A },
    { 'page[size]': '50', 'filter[actionId]': 'tenant.user.create' }
  ));
  assert.equal(byActionId.statusCode, 200, JSON.stringify(byActionId.body));
  assert.equal(byActionId.body.items.length, 1, `action ID filter must narrow: ${JSON.stringify(byActionId.body.items)}`);
  assert.equal(byActionId.body.items[0].correlationId, 'corr-access');

  const byActor = await METRICS_HANDLERS.metricsTenantAudit(metricsCtx(
    pool,
    IDENTITY_A,
    { tenantId: TENANT_A },
    { 'page[size]': '50', 'filter[actorId]': 'actor-other' }
  ));
  assert.equal(byActor.statusCode, 200, JSON.stringify(byActor.body));
  assert.equal(byActor.body.items.length, 1, `actor filter must narrow: ${JSON.stringify(byActor.body.items)}`);
  assert.equal(byActor.body.items[0].actor.actorId, 'actor-other');
  assert.equal(byActor.body.items[0].correlationId, 'corr-resource');
});

test('bbx-audit-filter-09: occurredAfter/occurredBefore filters narrow tenant audit records', async () => {
  const pool = memPool();
  seedAuditRow(pool, {
    id: 'old', action_type: 'tenant.create', actor_id: 'actor-old', tenant_id: TENANT_A,
    correlation_id: 'corr-old', created_at: '2026-06-01T00:00:00.000Z'
  });
  seedAuditRow(pool, {
    id: 'mid', action_type: 'workspace.create', actor_id: 'actor-mid', tenant_id: TENANT_A,
    correlation_id: 'corr-mid', created_at: '2026-06-15T00:00:00.000Z'
  });
  seedAuditRow(pool, {
    id: 'late', action_type: 'tenant.delete', actor_id: 'actor-late', tenant_id: TENANT_A,
    correlation_id: 'corr-late', created_at: '2026-06-30T00:00:00.000Z'
  });
  seedAuditRow(pool, {
    id: 'foreign-mid', action_type: 'workspace.create', actor_id: 'actor-foreign', tenant_id: TENANT_B,
    correlation_id: 'corr-foreign-mid', created_at: '2026-06-15T00:00:00.000Z'
  });

  const r = await METRICS_HANDLERS.metricsTenantAudit(metricsCtx(
    pool,
    IDENTITY_A,
    { tenantId: TENANT_A },
    {
      'page[size]': '50',
      'filter[occurredAfter]': '2026-06-10T00:00:00.000Z',
      'filter[occurredBefore]': '2026-06-20T00:00:00.000Z'
    }
  ));
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.items.map((item) => item.correlationId), ['corr-mid']);
  assert.equal(r.body.items[0].scope.tenantId, TENANT_A);
});

test('bbx-audit-filter-10: derived action categories stay in the audit event schema vocabulary', async () => {
  const pool = memPool();
  [
    ['cred-rotate', 'workspace.service-account.credential.rotate'],
    ['db-rotate', 'workspace.database.credential.rotate'],
    ['secret-set', 'workspace.secret.set'],
    ['secret-delete', 'workspace.secret.delete']
  ].forEach(([id, action_type], index) => seedAuditRow(pool, {
    id, action_type, actor_id: 'actor-secret', tenant_id: TENANT_A,
    correlation_id: `corr-${id}`, created_at: `2026-06-30T00:00:0${index}.000Z`
  }));

  const r = await METRICS_HANDLERS.metricsTenantAudit(metricsCtx(pool, IDENTITY_A, { tenantId: TENANT_A }, { 'page[size]': '50' }));
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.items.length, 4, JSON.stringify(r.body.items));
  for (const item of r.body.items) {
    assert.ok(
      AUDIT_ACTION_CATEGORIES.has(item.action.category),
      `derived category ${item.action.category} for ${item.action.actionId} is outside the audit event schema vocabulary`
    );
    assert.equal(item.action.category, 'configuration_change');
  }
});

test('bbx-audit-write-04: the dispatch-level writer records a mutating local action with the request correlation id', async () => {
  const pool = memPool();
  // auditEventForRoute derives the audit descriptor a mutating route produces; null
  // for non-auditable (read) routes so the writer no-ops on GETs.
  const desc = auditEventForRoute(
    { method: 'POST', path: '/v1/tenants/{tenantId}/users', localHandler: 'createTenantUser' },
    { params: { tenantId: TENANT_A }, identity: IDENTITY_A, body: { username: 'bob' } },
    { statusCode: 201, body: { userId: 'u1', username: 'bob' } }
  );
  assert.ok(desc, 'a successful mutating action must yield an audit descriptor');
  await recordAuditEvent(pool, { ...desc, correlationId: 'corr-dispatch' });
  const r = await METRICS_HANDLERS.metricsTenantAudit(metricsCtx(pool, IDENTITY_A, { tenantId: TENANT_A }));
  assert.equal(r.body.items.length, 1, JSON.stringify(r.body.items));
  assert.equal(r.body.items[0].correlationId, 'corr-dispatch');

  // a GET (read) route is NOT auditable
  const none = auditEventForRoute(
    { method: 'GET', path: '/v1/tenants/{tenantId}/users', localHandler: 'listTenantUsers' },
    { params: { tenantId: TENANT_A }, identity: IDENTITY_A, body: {} },
    { statusCode: 200, body: { items: [] } }
  );
  assert.equal(none, null, 'read routes must not produce audit records');

  // a FAILED mutation (>=400) IS now recorded (#644), distinguished by outcome — not dropped.
  const failed = auditEventForRoute(
    { method: 'POST', path: '/v1/tenants/{tenantId}/users', localHandler: 'createTenantUser' },
    { params: { tenantId: TENANT_A }, identity: IDENTITY_A, body: {} },
    { statusCode: 400, body: { code: 'VALIDATION_ERROR' } }
  );
  assert.ok(failed, 'failed mutations are now audited (#644)');
  assert.equal(failed.outcome, 'failed', 'recorded with outcome=failed, not silently dropped');
});

test('bbx-audit-write-05: a recorded scope-enforcement denial is returned by the scope-enforcement audit query (no 500)', async () => {
  const pool = memPool();
  await recordScopeDenial(pool, {
    tenantId: TENANT_A, workspaceId: WS_A, actorId: 'user-a', actorType: 'user',
    denialType: 'SCOPE_INSUFFICIENT', httpMethod: 'POST', requestPath: '/v1/functions/1/deploy',
    requiredScopes: ['functions:deploy'], presentedScopes: [], missingScopes: ['functions:deploy'],
    correlationId: 'corr-denial'
  });
  const from = new Date(Date.now() - 3600_000).toISOString();
  const to = new Date(Date.now() + 3600_000).toISOString();
  const res = await scopeAuditQuery(
    { from, to, callerContext: { actor: { type: 'tenant_owner' }, tenantId: TENANT_A } },
    { db: pool }
  );
  assert.equal(res.statusCode, 200, `scope-enforcement audit must not 500: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.denials.length, 1, JSON.stringify(res.body.denials));
  assert.equal(res.body.denials[0].correlation_id, 'corr-denial');
  assert.equal(res.body.denials[0].tenant_id, TENANT_A);
});

test('bbx-audit-write-06: scope-enforcement denials are tenant-scoped (owner sees only its own)', async () => {
  const pool = memPool();
  await recordScopeDenial(pool, { tenantId: TENANT_A, actorId: 'a', actorType: 'user', denialType: 'SCOPE_INSUFFICIENT', httpMethod: 'GET', requestPath: '/v1/db/collections', correlationId: 'corr-a' });
  await recordScopeDenial(pool, { tenantId: TENANT_B, actorId: 'b', actorType: 'user', denialType: 'CONFIG_ERROR', httpMethod: 'GET', requestPath: '/v1/db/collections', correlationId: 'corr-b' });
  const from = new Date(Date.now() - 3600_000).toISOString();
  const to = new Date(Date.now() + 3600_000).toISOString();
  const res = await scopeAuditQuery(
    { from, to, callerContext: { actor: { type: 'tenant_owner' }, tenantId: TENANT_A } },
    { db: pool }
  );
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.denials.length, 1, `tenant A must see only its own denial: ${JSON.stringify(res.body.denials)}`);
  assert.equal(res.body.denials[0].tenant_id, TENANT_A);
});

const C09_PUBLIC_FILTERS = {
  'filter[occurredAfter]': '2026-08-04T11:59:00.000Z',
  'filter[occurredBefore]': '2026-08-04T12:01:00.000Z',
  'filter[subsystem]': 'tenant_control_plane',
  'filter[actionCategory]': 'secret_rotation',
  'filter[actionId]': 'workspace.database.rotate',
  'filter[outcome]': 'succeeded',
  'filter[actorType]': 'service_account',
  'filter[actorId]': 'actor-c09',
  'filter[resourceType]': 'database',
  'filter[resourceId]': 'db-c09',
  'filter[originSurface]': 'control_api',
  'filter[correlationId]': 'corr-c09'
};

const C09_APPLIED_FILTERS = {
  occurred_after: C09_PUBLIC_FILTERS['filter[occurredAfter]'],
  occurred_before: C09_PUBLIC_FILTERS['filter[occurredBefore]'],
  subsystem: C09_PUBLIC_FILTERS['filter[subsystem]'],
  action_category: C09_PUBLIC_FILTERS['filter[actionCategory]'],
  action_id: C09_PUBLIC_FILTERS['filter[actionId]'],
  outcome: C09_PUBLIC_FILTERS['filter[outcome]'],
  actor_type: C09_PUBLIC_FILTERS['filter[actorType]'],
  actor_id: C09_PUBLIC_FILTERS['filter[actorId]'],
  resource_type: C09_PUBLIC_FILTERS['filter[resourceType]'],
  resource_id: C09_PUBLIC_FILTERS['filter[resourceId]'],
  origin_surface: C09_PUBLIC_FILTERS['filter[originSurface]'],
  correlation_id: C09_PUBLIC_FILTERS['filter[correlationId]']
};

function seedC09ConjunctionDataset(pool) {
  seedAuditRow(pool, c09AuditRow());
  [
    { id: 'decoy-after', created_at: '2026-08-04T11:58:00.000Z' },
    { id: 'decoy-before', created_at: '2026-08-04T12:02:00.000Z' },
    { id: 'decoy-subsystem', subsystem: 'iam', subsystem_id: 'iam' },
    { id: 'decoy-category', action_category: 'resource_creation' },
    { id: 'decoy-action', action_type: 'workspace.database.create' },
    { id: 'decoy-outcome', outcome: 'failed' },
    { id: 'decoy-actor-type', actor_type: 'tenant_user' },
    { id: 'decoy-actor-id', actor_id: 'actor-other' },
    { id: 'decoy-resource-type', resource_type: 'bucket' },
    { id: 'decoy-resource-id', resource_id: 'db-other' },
    { id: 'decoy-origin', origin_surface: 'console_backend' },
    { id: 'decoy-correlation', correlation_id: 'corr-other' }
  ].forEach((override) => seedAuditRow(pool, c09AuditRow(override)));
}

const C09_INDIVIDUAL_FILTER_CASES = [
  ['occurred_after', 'filter[occurredAfter]', { created_at: '2026-08-04T11:58:00.000Z' }],
  ['occurred_before', 'filter[occurredBefore]', { created_at: '2026-08-04T12:02:00.000Z' }],
  ['subsystem', 'filter[subsystem]', { subsystem: 'iam', subsystem_id: 'iam' }],
  ['action_category', 'filter[actionCategory]', { action_category: 'resource_creation' }],
  ['action_id', 'filter[actionId]', { action_type: 'workspace.database.create' }],
  ['outcome', 'filter[outcome]', { outcome: 'failed' }],
  ['actor_type', 'filter[actorType]', { actor_type: 'tenant_user' }],
  ['actor_id', 'filter[actorId]', { actor_id: 'actor-other' }],
  ['resource_type', 'filter[resourceType]', { resource_type: 'bucket' }],
  ['resource_id', 'filter[resourceId]', { resource_id: 'db-other' }],
  ['origin_surface', 'filter[originSurface]', { origin_surface: 'console_backend' }],
  ['correlation_id', 'filter[correlationId]', { correlation_id: 'corr-other' }]
];

// bbx-c09-01 | fn-observability-audit-record-query | #### Scenario: Filters are combined
test('bbx-c09-01 [fn-observability-audit-record-query] all twelve exact filters are conjunctive on both routes', async (t) => {
  const routes = [
    ['tenant', 'metricsTenantAudit', IDENTITY_A, { tenantId: TENANT_A }],
    ['workspace', 'metricsWorkspaceAudit', IDENTITY_A, { workspaceId: WS_A }]
  ];

  for (const [scope, handler, identity, params] of routes) {
    await t.test(scope, async () => {
      const pool = memPool();
      seedC09ConjunctionDataset(pool);
      const response = await METRICS_HANDLERS[handler](metricsCtx(pool, identity, params, {
        ...C09_PUBLIC_FILTERS,
        'page[size]': '25',
        sort: '-eventTimestamp'
      }));

      assert.equal(response.statusCode, 200, JSON.stringify(response.body));
      assert.deepEqual(response.body.items.map(({ eventId }) => eventId), ['evt-c09-target']);
      assert.equal(response.body.queryScope, scope);
      assert.deepEqual(response.body.appliedFilters, C09_APPLIED_FILTERS);
      assert.deepEqual(response.body.availableFilters.map(({ id }) => id), C09_FILTER_IDS);
      assert.deepEqual(
        response.body.availableFilters.map(({ id, param }) => [id, param]),
        C09_FILTER_IDS.map((id) => [id, {
          occurred_after: 'filter[occurredAfter]', occurred_before: 'filter[occurredBefore]',
          subsystem: 'filter[subsystem]', action_category: 'filter[actionCategory]',
          action_id: 'filter[actionId]', outcome: 'filter[outcome]', actor_type: 'filter[actorType]',
          actor_id: 'filter[actorId]', resource_type: 'filter[resourceType]',
          resource_id: 'filter[resourceId]', origin_surface: 'filter[originSurface]',
          correlation_id: 'filter[correlationId]'
        }[id]])
      );

      const [select] = auditSelects(pool);
      assert.ok(select, 'authorized query must execute one bounded audit SELECT');
      for (const value of Object.values(C09_PUBLIC_FILTERS)) {
        assert.ok(select.params.includes(value), `missing exact filter parameter ${value}`);
      }
    });
  }
});

test('bbx-c09-01b [fn-observability-audit-record-query] each canonical filter independently narrows by exact value', async (t) => {
  for (const [id, param, decoyOverride] of C09_INDIVIDUAL_FILTER_CASES) {
    await t.test(id, async () => {
      const pool = memPool();
      seedAuditRow(pool, c09AuditRow());
      seedAuditRow(pool, c09AuditRow({ id: `decoy-${id}`, ...decoyOverride }));
      const response = await METRICS_HANDLERS.metricsTenantAudit(metricsCtx(
        pool,
        IDENTITY_A,
        { tenantId: TENANT_A },
        { [param]: C09_PUBLIC_FILTERS[param] }
      ));
      assert.equal(response.statusCode, 200, JSON.stringify(response.body));
      assert.deepEqual(response.body.items.map(({ eventId }) => eventId), ['evt-c09-target']);
      assert.deepEqual(response.body.appliedFilters, { [id]: C09_APPLIED_FILTERS[id] });
      const [select] = auditSelects(pool);
      assert.equal(select.params.filter((value) => value === C09_PUBLIC_FILTERS[param]).length, 1);
    });
  }
});

test('bbx-c09-01c [fn-observability-audit-record-query] omitted defaults are identical on tenant and workspace routes', async (t) => {
  const routes = [
    ['tenant', 'metricsTenantAudit', { tenantId: TENANT_A }],
    ['workspace', 'metricsWorkspaceAudit', { workspaceId: WS_A }]
  ];
  for (const [label, handler, params] of routes) {
    await t.test(label, async () => {
      const pool = memPool();
      for (let minute = 0; minute < 26; minute += 1) {
        seedAuditRow(pool, c09AuditRow({
          id: auditUuid(minute),
          created_at: `2026-08-04T12:${String(minute).padStart(2, '0')}:00.000Z`
        }));
      }
      const response = await METRICS_HANDLERS[handler](metricsCtx(pool, IDENTITY_A, params));
      assert.equal(response.statusCode, 200, JSON.stringify(response.body));
      assert.equal(response.body.items.length, 25);
      assert.deepEqual(response.body.page.size, 25);
      assert.equal(response.body.page.hasMore, true);
      const [select] = auditSelects(pool);
      assert.match(select.sql, /ORDER BY\s+created_at\s+DESC\s*,\s*id\s+DESC/i);
      assert.ok(select.params.includes(26));
    });
  }
});

// bbx-c09-02 | fn-observability-audit-record-query | #### Scenario: Valid free-form value has no match
test('bbx-c09-02 [fn-observability-audit-record-query] valid unmatched free-form filter returns an empty 200', async () => {
  const pool = memPool();
  seedAuditRow(pool, c09AuditRow());
  const response = await METRICS_HANDLERS.metricsTenantAudit(metricsCtx(
    pool,
    IDENTITY_A,
    { tenantId: TENANT_A },
    { 'filter[actionId]': 'valid.action.with.no.match' }
  ));

  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.deepEqual(response.body.items, []);
  assert.deepEqual(response.body.page, { size: 0, hasMore: false });
  assert.equal(Object.hasOwn(response.body.page, 'nextCursor'), false);
  assert.deepEqual(response.body.appliedFilters, { action_id: 'valid.action.with.no.match' });
  assert.deepEqual(response.body.availableFilters.map(({ id }) => id), C09_FILTER_IDS);
});

// bbx-c09-03 | fn-observability-audit-record-query | #### Scenario: Query parameters are omitted; #### Scenario: Ascending order includes a timestamp tie; #### Scenario: Descending order includes a timestamp tie
test('bbx-c09-03 [fn-observability-audit-record-query] defaults and both total sort directions use the event-ID tie breaker', async () => {
  const defaultPool = memPool();
  for (let minute = 0; minute < 26; minute += 1) {
    seedAuditRow(defaultPool, c09AuditRow({
      id: auditUuid(minute),
      created_at: `2026-08-04T12:${String(minute).padStart(2, '0')}:00.000Z`
    }));
  }
  const defaults = await METRICS_HANDLERS.metricsTenantAudit(metricsCtx(defaultPool, IDENTITY_A, { tenantId: TENANT_A }));
  assert.equal(defaults.statusCode, 200, JSON.stringify(defaults.body));
  assert.equal(defaults.body.items.length, 25, 'omitted page[size] must default to 25');
  assert.equal(defaults.body.page.size, 25);
  assert.equal(defaults.body.page.hasMore, true);
  assert.equal(typeof defaults.body.page.nextCursor, 'string');
  const [defaultSelect] = auditSelects(defaultPool);
  assert.match(defaultSelect.sql, /ORDER BY\s+created_at\s+DESC\s*,\s*id\s+DESC/i);
  assert.ok(defaultSelect.params.includes(26), 'default page must use a 25 + 1 lookahead');

  const tiedPool = memPool();
  [
    ['evt-b', '2026-08-04T12:00:00.000Z'],
    ['evt-a', '2026-08-04T12:00:00.000Z'],
    ['evt-c', '2026-08-04T12:01:00.000Z']
  ].forEach(([id, created_at]) => seedAuditRow(tiedPool, c09AuditRow({ id, created_at })));
  const ascending = await METRICS_HANDLERS.metricsTenantAudit(metricsCtx(
    tiedPool, IDENTITY_A, { tenantId: TENANT_A }, { 'page[size]': '10', sort: 'eventTimestamp' }
  ));
  const descending = await METRICS_HANDLERS.metricsTenantAudit(metricsCtx(
    tiedPool, IDENTITY_A, { tenantId: TENANT_A }, { 'page[size]': '10', sort: '-eventTimestamp' }
  ));
  assert.deepEqual(ascending.body.items.map(({ eventId }) => eventId), ['evt-a', 'evt-b', 'evt-c']);
  assert.deepEqual(descending.body.items.map(({ eventId }) => eventId), ['evt-c', 'evt-b', 'evt-a']);
});

// bbx-c09-04 | fn-observability-audit-record-query | #### Scenario: Multiple pages contain tied timestamps
test('bbx-c09-04 [fn-observability-audit-record-query] keyset pages of size two are truthful and contain no gaps or duplicates', async () => {
  const pool = memPool();
  [
    [auditUuid(5), '2026-08-04T12:02:00.000Z'],
    [auditUuid(4), '2026-08-04T12:01:00.000Z'],
    [auditUuid(3), '2026-08-04T12:01:00.000Z'],
    [auditUuid(2), '2026-08-04T12:01:00.000Z'],
    [auditUuid(1), '2026-08-04T12:00:00.000Z']
  ].forEach(([id, created_at]) => seedAuditRow(pool, c09AuditRow({ id, created_at })));

  const seen = [];
  const pages = [];
  let cursor;
  for (let pageNumber = 0; pageNumber < 3; pageNumber += 1) {
    const query = { 'page[size]': '2', sort: '-eventTimestamp' };
    if (cursor) query['page[after]'] = cursor;
    const response = await METRICS_HANDLERS.metricsTenantAudit(metricsCtx(pool, IDENTITY_A, { tenantId: TENANT_A }, query));
    assert.equal(response.statusCode, 200, JSON.stringify(response.body));
    pages.push(response.body.page);
    seen.push(...response.body.items.map(({ eventId }) => eventId));
    cursor = response.body.page.nextCursor;
  }

  assert.deepEqual(seen, [5, 4, 3, 2, 1].map(auditUuid));
  assert.equal(new Set(seen).size, 5);
  assert.deepEqual(pages.map(({ size, hasMore }) => ({ size, hasMore })), [
    { size: 2, hasMore: true },
    { size: 2, hasMore: true },
    { size: 1, hasMore: false }
  ]);
  assert.equal(typeof pages[0].nextCursor, 'string');
  assert.equal(typeof pages[1].nextCursor, 'string');
  assert.equal(Object.hasOwn(pages[2], 'nextCursor'), false);
  assert.equal(auditSelects(pool).length, 3);
  for (const select of auditSelects(pool)) assert.ok(select.params.includes(3), 'page[size]=2 must select limit+1');
  assert.match(auditSelects(pool)[1].sql, /\(?\s*created_at\s*,\s*id\s*\)?\s*</i);
});

// bbx-c09-05 | fn-observability-audit-record-query | #### Scenario: Cursor encoding or shape is invalid; #### Scenario: Cursor filter or sort is incompatible; #### Scenario: Cursor scope is incompatible
test('bbx-c09-05 [fn-observability-audit-record-query] malformed and incompatible cursors fail 400 before audit SELECT', async (t) => {
  const malformed = [
    ['not base64url JSON', '%%%not-a-cursor%%%'],
    ['unsupported version and shape', Buffer.from(JSON.stringify({ v: 99, extra: true })).toString('base64url')]
  ];
  for (const [label, cursor] of malformed) {
    await t.test(label, async () => {
      const pool = memPool();
      const response = await METRICS_HANDLERS.metricsTenantAudit(metricsCtx(
        pool, IDENTITY_A, { tenantId: TENANT_A }, { 'page[after]': cursor }
      ));
      assert.equal(response.statusCode, 400, JSON.stringify(response.body));
      assert.equal(auditSelects(pool).length, 0);
    });
  }

  const pool = memPool();
  for (let index = 0; index < 3; index += 1) {
    seedAuditRow(pool, c09AuditRow({ id: auditUuid(index), created_at: `2026-08-04T12:0${index}:00.000Z` }));
  }
  const first = await METRICS_HANDLERS.metricsTenantAudit(metricsCtx(pool, IDENTITY_A, { tenantId: TENANT_A }, {
    'page[size]': '1', sort: '-eventTimestamp', 'filter[actorId]': 'actor-c09'
  }));
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  assert.equal(typeof first.body.page.nextCursor, 'string');
  const mintedCursor = first.body.page.nextCursor;
  const initialSelects = auditSelects(pool).length;

  const incompatibleRequests = [
    [IDENTITY_A, { tenantId: TENANT_A }, { 'page[after]': mintedCursor, sort: 'eventTimestamp', 'filter[actorId]': 'actor-c09' }],
    [IDENTITY_A, { tenantId: TENANT_A }, { 'page[after]': mintedCursor, sort: '-eventTimestamp', 'filter[actorId]': 'actor-other' }],
    [IDENTITY_B, { tenantId: TENANT_B }, { 'page[after]': mintedCursor, sort: '-eventTimestamp', 'filter[actorId]': 'actor-c09' }],
    [IDENTITY_A, { workspaceId: WS_A }, { 'page[after]': mintedCursor, sort: '-eventTimestamp', 'filter[actorId]': 'actor-c09' }, 'metricsWorkspaceAudit']
  ];
  for (const [identity, params, query, handler = 'metricsTenantAudit'] of incompatibleRequests) {
    const response = await METRICS_HANDLERS[handler](metricsCtx(pool, identity, params, query));
    assert.equal(response.statusCode, 400, JSON.stringify(response.body));
    assert.equal(Object.hasOwn(response.body, 'items'), false, '400 must expose no audit collection metadata');
    assert.equal(auditSelects(pool).length, initialSelects, 'incompatible cursor must not reach audit SELECT');
  }
});

// bbx-c09-06 | fn-observability-audit-record-query | #### Scenario: Page size is not an integer in range; #### Scenario: Sort is invalid; #### Scenario: Timestamp is not RFC 3339; #### Scenario: Time window is reversed; #### Scenario: Enumerated value is unknown
test('bbx-c09-06 [fn-observability-audit-record-query] invalid query matrix returns 400 without audit SELECT', async (t) => {
  const invalidQueries = [
    ['page zero', { 'page[size]': '0' }],
    ['page above maximum', { 'page[size]': '201' }],
    ['page not an integer', { 'page[size]': '1.5' }],
    ['unknown sort', { sort: 'createdAt' }],
    ['invalid timestamp', { 'filter[occurredAfter]': '2026-08-04' }],
    ['reversed window', { 'filter[occurredAfter]': '2026-08-05T00:00:00Z', 'filter[occurredBefore]': '2026-08-04T00:00:00Z' }],
    ['unknown subsystem', { 'filter[subsystem]': 'control-plane' }],
    ['unknown action category', { 'filter[actionCategory]': 'read' }],
    ['unknown outcome', { 'filter[outcome]': 'ok' }],
    ['unknown actor type', { 'filter[actorType]': 'human' }],
    ['unknown origin surface', { 'filter[originSurface]': 'web' }]
  ];

  for (const [label, query] of invalidQueries) {
    await t.test(label, async () => {
      const pool = memPool();
      const response = await METRICS_HANDLERS.metricsTenantAudit(metricsCtx(pool, IDENTITY_A, { tenantId: TENANT_A }, query));
      assert.equal(response.statusCode, 400, JSON.stringify(response.body));
      assert.equal(auditSelects(pool).length, 0, 'validation must occur before audit datastore access');
    });
  }
});

// bbx-c09-07 | fn-observability-audit-record-query | #### Scenario: P13 requests a foreign path scope; #### Scenario: Authorized workspace audit query
test('bbx-c09-07 [fn-observability-audit-record-query] tenant/workspace isolation and foreign denial reveal no audit metadata', async () => {
  const siblingWorkspace = '55555555-5555-5555-5555-555555555555';
  const pool = memPool();
  seedAuditRow(pool, c09AuditRow({ id: 'tenant-a-workspace-a' }));
  seedAuditRow(pool, c09AuditRow({ id: 'tenant-a-workspace-sibling', workspace_id: siblingWorkspace, new_state: { workspaceId: siblingWorkspace } }));
  seedAuditRow(pool, c09AuditRow({ id: 'tenant-a-only', workspace_id: null, new_state: {} }));
  seedAuditRow(pool, c09AuditRow({ id: 'tenant-b-only', tenant_id: TENANT_B, workspace_id: WS_B, new_state: { workspaceId: WS_B } }));

  const foreignTenant = await METRICS_HANDLERS.metricsTenantAudit(metricsCtx(pool, IDENTITY_B, { tenantId: TENANT_A }));
  assert.equal(foreignTenant.statusCode, 403, JSON.stringify(foreignTenant.body));
  for (const key of ['items', 'page', 'queryScope', 'appliedFilters', 'availableFilters']) {
    assert.equal(Object.hasOwn(foreignTenant.body, key), false, `denial leaked ${key}`);
  }
  assert.equal(auditSelects(pool).length, 0);

  const ownTenant = await METRICS_HANDLERS.metricsTenantAudit(metricsCtx(pool, IDENTITY_B, { tenantId: TENANT_B }));
  assert.deepEqual(ownTenant.body.items.map(({ eventId }) => eventId), ['tenant-b-only']);

  const ownWorkspace = await METRICS_HANDLERS.metricsWorkspaceAudit(metricsCtx(pool, IDENTITY_A, { workspaceId: WS_A }));
  assert.deepEqual(ownWorkspace.body.items.map(({ eventId }) => eventId), ['tenant-a-workspace-a']);
  const auditSelectCount = auditSelects(pool).length;

  const foreignWorkspace = await METRICS_HANDLERS.metricsWorkspaceAudit(metricsCtx(pool, IDENTITY_A, { workspaceId: WS_B }));
  assert.equal(foreignWorkspace.statusCode, 403, JSON.stringify(foreignWorkspace.body));
  for (const key of ['items', 'page', 'queryScope', 'appliedFilters', 'availableFilters']) {
    assert.equal(Object.hasOwn(foreignWorkspace.body, key), false, `denial leaked ${key}`);
  }
  assert.equal(auditSelects(pool).length, auditSelectCount);
});

// bbx-c09-08 | fn-observability-audit-record-query | #### Scenario: SQL-like filter text is supplied; #### Scenario: Successful GET is observed for writes
test('bbx-c09-08 [fn-observability-audit-record-query] SQL-like text remains a literal parameter and audit GET performs no writes', async () => {
  const pool = memPool();
  seedAuditRow(pool, c09AuditRow());
  const before = JSON.stringify(pool._audit);
  const payload = "db' OR 1=1 -- %_()";
  const response = await METRICS_HANDLERS.metricsTenantAudit(metricsCtx(
    pool, IDENTITY_A, { tenantId: TENANT_A }, { 'filter[resourceId]': payload }
  ));

  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.deepEqual(response.body.items, [], 'SQL-looking exact value must neither match nor widen scope');
  const [select] = auditSelects(pool);
  assert.ok(select, 'valid free-form filter must reach one bounded SELECT');
  assert.equal(select.sql.includes(payload), false, 'request value must not be interpolated into SQL');
  assert.equal(select.params.filter((value) => value === payload).length, 1, 'full request value must be one exact parameter');
  assert.equal(select.params[0], TENANT_A, 'mandatory authorized tenant scope must remain the first bound value');
  assert.equal(writeStatements(pool).length, 0, 'GET must not execute writes');
  assert.equal(JSON.stringify(pool._audit), before, 'GET must not mutate audit rows');
});

// bbx-c09-09 | fn-observability-audit-record-query | #### Scenario: Page size is not an integer in range; #### Scenario: Sort is invalid; #### Scenario: Enumerated value is unknown
test('bbx-c09-09 [fn-observability-audit-record-query] duplicate raw HTTP query controls fail 400 before audit SELECT', async (t) => {
  const cases = [
    [
      'page[size]',
      { 'page[size]': '2' },
      [['page[size]', '1'], ['page[size]', '2']]
    ],
    [
      'sort',
      { sort: '-eventTimestamp' },
      [['sort', 'eventTimestamp'], ['sort', '-eventTimestamp']]
    ],
    [
      'filter[outcome]',
      { 'filter[outcome]': 'failed' },
      [['filter[outcome]', 'succeeded'], ['filter[outcome]', 'failed']]
    ]
  ];

  for (const [label, flattenedQuery, rawEntries] of cases) {
    await t.test(label, async () => {
      const pool = memPool();
      const context = metricsCtx(pool, IDENTITY_A, { tenantId: TENANT_A }, flattenedQuery);
      // This is the closest public-handler seam to the HTTP server. `query`
      // deliberately models the server's current flattened view while
      // `searchParams` preserves the duplicate-aware raw request representation.
      context.searchParams = new URLSearchParams(rawEntries);

      const response = await METRICS_HANDLERS.metricsTenantAudit(context);

      assert.deepEqual({
        statusCode: response.statusCode,
        auditSelectCount: auditSelects(pool).length
      }, {
        statusCode: 400,
        auditSelectCount: 0
      }, JSON.stringify(response.body));
    });
  }
});

// bbx-c09-10 | fn-observability-audit-record-query | #### Scenario: Cursor encoding or shape is invalid
test('bbx-c09-10 [fn-observability-audit-record-query] cursor with a non-UUID audit event position fails 400 before audit SELECT', async () => {
  const pool = memPool();
  const fingerprint = auditQueryFingerprint({
    tenantId: TENANT_A,
    queryScope: 'tenant',
    filters: {},
    sort: '-eventTimestamp'
  });
  const cursor = Buffer.from(JSON.stringify({
    v: 1,
    position: {
      createdAt: '2026-08-04T12:00:00.123456Z',
      id: 'not-a-plan-audit-event-uuid'
    },
    fingerprint
  })).toString('base64url');

  const response = await METRICS_HANDLERS.metricsTenantAudit(metricsCtx(
    pool,
    IDENTITY_A,
    { tenantId: TENANT_A },
    { 'page[after]': cursor }
  ));

  assert.deepEqual({
    statusCode: response.statusCode,
    auditSelectCount: auditSelects(pool).length
  }, {
    statusCode: 400,
    auditSelectCount: 0
  }, JSON.stringify(response.body));
});

// bbx-c09-11 | fn-observability-audit-record-query | #### Scenario: Action-category filter is applied; #### Scenario: Correlation-ID filter is applied
test('bbx-c09-11 [fn-observability-audit-record-query] legacy rows filter by the same canonical category and correlation ID they expose', async (t) => {
  await t.test('non-contractual stored action category falls back to the derived canonical category for projection and filtering', async () => {
    const pool = memPool();
    const eventId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    seedAuditRow(pool, c09AuditRow({
      id: eventId,
      action_type: 'tenant.user.create',
      action_category: 'legacy_admin_change',
      new_state: {
        actorType: 'tenant_user',
        resourceType: 'tenant',
        resourceId: TENANT_A,
        originSurface: 'control_api',
        subsystem: 'tenant_control_plane',
        actionCategory: 'legacy_admin_change'
      }
    }));

    const unfiltered = await METRICS_HANDLERS.metricsTenantAudit(metricsCtx(
      pool, IDENTITY_A, { tenantId: TENANT_A }
    ));
    assert.equal(unfiltered.statusCode, 200, JSON.stringify(unfiltered.body));
    assert.equal(unfiltered.body.items[0].action.category, 'access_control_modification');

    const filtered = await METRICS_HANDLERS.metricsTenantAudit(metricsCtx(
      pool,
      IDENTITY_A,
      { tenantId: TENANT_A },
      { 'filter[actionCategory]': 'access_control_modification' }
    ));
    assert.equal(filtered.statusCode, 200, JSON.stringify(filtered.body));
    assert.deepEqual(filtered.body.items.map(({ eventId: id }) => id), [eventId]);
  });

  await t.test('legacy synthesized correlation ID is filterable by the exact value exposed in the response', async () => {
    const pool = memPool();
    const eventId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    const legacyCorrelationId = `legacy-${eventId}`;
    seedAuditRow(pool, c09AuditRow({
      id: eventId,
      correlation_id: null
    }));

    const unfiltered = await METRICS_HANDLERS.metricsTenantAudit(metricsCtx(
      pool, IDENTITY_A, { tenantId: TENANT_A }
    ));
    assert.equal(unfiltered.statusCode, 200, JSON.stringify(unfiltered.body));
    assert.equal(unfiltered.body.items[0].correlationId, legacyCorrelationId);

    const filtered = await METRICS_HANDLERS.metricsTenantAudit(metricsCtx(
      pool,
      IDENTITY_A,
      { tenantId: TENANT_A },
      { 'filter[correlationId]': legacyCorrelationId }
    ));
    assert.equal(filtered.statusCode, 200, JSON.stringify(filtered.body));
    assert.deepEqual(filtered.body.items.map(({ eventId: id }) => id), [eventId]);
  });
});
