import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUDIT_FILTER_DESCRIPTORS,
  AUDIT_QUERY_ERROR_CODES,
  auditQueryFingerprint,
  decodeAuditCursor,
  encodeAuditCursor,
  normalizeAuditEventQuery,
  queryAuditEvents
} from '../../apps/control-plane/audit-store.mjs';
import { METRICS_HANDLERS } from '../../apps/control-plane/metrics-handlers.mjs';
import { normalizeAuditRecordQuery } from '../../apps/control-plane-executor/src/observability-audit-query.mjs';

const TENANT = '11111111-1111-1111-1111-111111111111';
const WORKSPACE = '33333333-3333-3333-3333-333333333333';
const POSITION = {
  createdAt: '2026-08-04T12:00:00.000Z',
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
};

function capturingDb(rows = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params: [...params] });
      return { rows };
    }
  };
}

const IDENTITY = {
  sub: 'user-a',
  tenantId: TENANT,
  workspaceId: null,
  actorType: 'tenant_owner',
  roles: ['tenant_owner'],
  scopes: []
};

function tenantAuditContext(pool, query = {}) {
  return {
    pool,
    params: { tenantId: TENANT },
    query,
    body: {},
    identity: IDENTITY,
    callerContext: {
      actor: { id: IDENTITY.sub, type: IDENTITY.actorType },
      tenantId: TENANT
    }
  };
}

function comparableTimestamp(value) {
  const match = String(value).match(/^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/);
  assert.ok(match, `test datastore received a non-RFC3339 timestamp: ${value}`);
  return `${match[1]}.${(match[2] ?? '').padEnd(9, '0')}Z`;
}

function microsecondPagingDb() {
  const rows = [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
      action_type: 'tenant.user.create',
      action_category: 'access_control_modification',
      subsystem_id: 'tenant_control_plane',
      actor_type: 'tenant_user',
      actor_id: IDENTITY.sub,
      tenant_id: TENANT,
      workspace_id: null,
      resource_type: 'tenant',
      resource_id: TENANT,
      origin_surface: 'control_api',
      previous_state: null,
      new_state: {},
      outcome: 'succeeded',
      correlation_id: 'corr-micro-500',
      created_at: '2026-08-04T12:00:00.000500Z',
      prev_hash: '',
      row_hash: ''
    },
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
      action_type: 'tenant.user.create',
      action_category: 'access_control_modification',
      subsystem_id: 'tenant_control_plane',
      actor_type: 'tenant_user',
      actor_id: IDENTITY.sub,
      tenant_id: TENANT,
      workspace_id: null,
      resource_type: 'tenant',
      resource_id: TENANT,
      origin_surface: 'control_api',
      previous_state: null,
      new_state: {},
      outcome: 'succeeded',
      correlation_id: 'corr-micro-400',
      created_at: '2026-08-04T12:00:00.000400Z',
      prev_hash: '',
      row_hash: ''
    }
  ];
  const calls = [];

  return {
    calls,
    async query(sql, params) {
      const statement = String(sql).replace(/\s+/g, ' ').trim();
      calls.push({ sql: statement, params: [...params] });
      let selected = rows.filter((row) => row.tenant_id === params[0]);
      const occurredAfter = statement.match(/created_at\s*>=\s*\$(\d+)/);
      if (occurredAfter) {
        const boundary = comparableTimestamp(params[Number(occurredAfter[1]) - 1]);
        selected = selected.filter((row) => comparableTimestamp(row.created_at) >= boundary);
      }
      const cursor = statement.match(/\(created_at, id\)\s*([<>])\s*\(\$(\d+)::timestamptz, \$(\d+)\)/);
      if (cursor) {
        const [, operator, timestampNumber, idNumber] = cursor;
        const cursorTimestamp = comparableTimestamp(params[Number(timestampNumber) - 1]);
        const cursorId = String(params[Number(idNumber) - 1]);
        selected = selected.filter((row) => {
          const positionComparison = comparableTimestamp(row.created_at).localeCompare(cursorTimestamp)
            || row.id.localeCompare(cursorId);
          return operator === '<' ? positionComparison < 0 : positionComparison > 0;
        });
      }

      const ascending = /ORDER BY created_at ASC, id ASC/.test(statement);
      selected.sort((left, right) => {
        const positionComparison = comparableTimestamp(left.created_at).localeCompare(comparableTimestamp(right.created_at))
          || left.id.localeCompare(right.id);
        return ascending ? positionComparison : -positionComparison;
      });
      const limitMatch = statement.match(/LIMIT \$(\d+)/);
      const limit = limitMatch ? Number(params[Number(limitMatch[1]) - 1]) : selected.length;
      return {
        rows: selected.slice(0, limit).map((row) => ({
          ...row,
          cursor_created_at: row.created_at
        }))
      };
    }
  };
}

test('C-09 cursor v1 is deterministic, strict, and page-size independent', () => {
  const base = {
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    queryScope: 'workspace',
    filters: { actor_id: 'actor-01', outcome: 'succeeded' },
    sort: '-eventTimestamp'
  };
  const fingerprint = auditQueryFingerprint(base);
  assert.equal(fingerprint, auditQueryFingerprint({ ...base, pageSize: 1 }));
  assert.equal(fingerprint, auditQueryFingerprint({ ...base, pageSize: 200 }));

  const cursor = encodeAuditCursor({ position: POSITION, fingerprint });
  assert.match(cursor, /^[A-Za-z0-9_-]+$/);
  assert.equal(cursor.includes('='), false);
  assert.equal(cursor, encodeAuditCursor({ position: POSITION, fingerprint }));
  assert.deepEqual(decodeAuditCursor(cursor), { v: 1, position: POSITION, fingerprint });

  const withExtraField = Buffer.from(JSON.stringify({
    v: 1,
    position: POSITION,
    fingerprint,
    tenantId: TENANT
  })).toString('base64url');
  assert.throws(
    () => decodeAuditCursor(withExtraField),
    (error) => error.code === AUDIT_QUERY_ERROR_CODES.INVALID_CURSOR
  );
});

test('C-09 normalized continuation binds scope, filters and sort but accepts a changed page size', () => {
  const first = normalizeAuditEventQuery({
    'page[size]': '1',
    sort: '-eventTimestamp',
    'filter[actorId]': 'actor-01'
  }, { tenantId: TENANT, queryScope: 'tenant' });
  const cursor = encodeAuditCursor({ position: POSITION, fingerprint: first.fingerprint });

  const continuation = normalizeAuditEventQuery({
    'page[size]': '200',
    sort: '-eventTimestamp',
    'filter[actorId]': 'actor-01',
    'page[after]': cursor
  }, { tenantId: TENANT, queryScope: 'tenant' });
  assert.equal(continuation.pageSize, 200);
  assert.deepEqual(continuation.cursorPosition, POSITION);

  for (const incompatible of [
    [{ 'page[after]': cursor, sort: 'eventTimestamp', 'filter[actorId]': 'actor-01' }, { tenantId: TENANT, queryScope: 'tenant' }],
    [{ 'page[after]': cursor, sort: '-eventTimestamp', 'filter[actorId]': 'actor-02' }, { tenantId: TENANT, queryScope: 'tenant' }],
    [{ 'page[after]': cursor, sort: '-eventTimestamp', 'filter[actorId]': 'actor-01' }, { tenantId: 'tenant-other', queryScope: 'tenant' }]
  ]) {
    assert.throws(
      () => normalizeAuditEventQuery(...incompatible),
      (error) => error.code === AUDIT_QUERY_ERROR_CODES.INVALID_CURSOR
    );
  }
});

test('C-09 normalization rejects missing or incoherent scope with a coded error', () => {
  for (const scope of [
    {},
    { tenantId: '', queryScope: 'tenant' },
    { tenantId: TENANT, queryScope: 'workspace' },
    { tenantId: TENANT, workspaceId: '', queryScope: 'workspace' },
    { tenantId: TENANT, queryScope: 'global' }
  ]) {
    assert.throws(
      () => normalizeAuditEventQuery({}, scope),
      (error) => error.code === AUDIT_QUERY_ERROR_CODES.SCOPE_VIOLATION,
      JSON.stringify(scope)
    );
  }
});

test('C-09 normalizers reject sub-millisecond reversed RFC3339 windows, including offsets', () => {
  const windows = [
    ['2026-08-04T12:00:00.000500Z', '2026-08-04T12:00:00.000400Z'],
    ['2026-08-04T14:00:00.000500+02:00', '2026-08-04T07:00:00.000400-05:00']
  ];
  for (const [occurredAfter, occurredBefore] of windows) {
    assert.throws(
      () => normalizeAuditEventQuery({
        'filter[occurredAfter]': occurredAfter,
        'filter[occurredBefore]': occurredBefore
      }, { tenantId: TENANT, queryScope: 'tenant' }),
      (error) => error.code === AUDIT_QUERY_ERROR_CODES.INVALID_TIME_WINDOW
    );
    assert.throws(
      () => normalizeAuditRecordQuery('tenant', { tenantId: TENANT }, { occurredAfter, occurredBefore }),
      (error) => error.code === AUDIT_QUERY_ERROR_CODES.INVALID_TIME_WINDOW
    );
  }
});

test('C-09 store binds every individual canonical filter after mandatory tenant/workspace scope', async () => {
  const values = {
    occurred_after: '2026-08-04T11:59:00.000Z',
    occurred_before: '2026-08-04T12:01:00.000Z',
    subsystem: 'tenant_control_plane',
    action_category: 'secret_rotation',
    action_id: 'workspace.database.rotate',
    outcome: 'succeeded',
    actor_type: 'service_account',
    actor_id: 'actor-01',
    resource_type: 'database',
    resource_id: 'db-01',
    origin_surface: 'control_api',
    correlation_id: 'corr-01'
  };

  for (const descriptor of AUDIT_FILTER_DESCRIPTORS) {
    const db = capturingDb();
    await queryAuditEvents(db, {
      tenantId: TENANT,
      workspaceId: WORKSPACE,
      pageSize: 25,
      filters: { [descriptor.id]: values[descriptor.id] }
    });
    assert.equal(db.calls.length, 1, descriptor.id);
    const [{ sql, params }] = db.calls;
    assert.match(sql, /tenant_id = \$1/);
    assert.match(sql, /new_state->>'workspaceId' = \$2/);
    assert.deepEqual(params, [TENANT, WORKSPACE, values[descriptor.id], 26], descriptor.id);
    assert.match(sql, /LIMIT \$4/);
  }
});

test('C-09 store emits mandatory scope, twelve bound filters, keyset direction and limit-plus-one', async () => {
  const db = capturingDb();
  const filters = Object.fromEntries(AUDIT_FILTER_DESCRIPTORS.map((descriptor) => [descriptor.id, ({
    occurred_after: '2026-08-04T11:59:00.000Z',
    occurred_before: '2026-08-04T12:01:00.000Z',
    subsystem: 'tenant_control_plane',
    action_category: 'secret_rotation',
    action_id: 'workspace.database.rotate',
    outcome: 'succeeded',
    actor_type: 'service_account',
    actor_id: 'actor-01',
    resource_type: 'database',
    resource_id: "db' OR 1=1 -- %_()",
    origin_surface: 'control_api',
    correlation_id: 'corr-01'
  })[descriptor.id]]));

  await queryAuditEvents(db, {
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    pageSize: 25,
    sort: 'eventTimestamp',
    cursorPosition: POSITION,
    filters
  });

  assert.equal(db.calls.length, 1);
  const [{ sql, params }] = db.calls;
  assert.match(sql, /tenant_id = \$1/);
  assert.match(sql, /new_state->>'workspaceId' = \$2/);
  assert.match(sql, /\(created_at, id\) > \(\$15::timestamptz, \$16\)/);
  assert.match(sql, /ORDER BY created_at ASC, id ASC LIMIT \$17/);
  assert.equal(params[0], TENANT);
  assert.equal(params[1], WORKSPACE);
  assert.deepEqual(params.slice(2, 14), Object.values(filters));
  assert.equal(params[11], "db' OR 1=1 -- %_()");
  assert.equal(sql.includes("db' OR 1=1 -- %_()"), false);
  assert.deepEqual(params.slice(14, 16), [POSITION.createdAt, POSITION.id]);
  assert.equal(params[16], 26);
});

test('C-09 store rejects invalid scope before db.query and retains both workspace predicates on DESC continuation', async () => {
  const absent = capturingDb();
  await assert.rejects(
    queryAuditEvents(absent, { pageSize: 25 }),
    (error) => error.code === AUDIT_QUERY_ERROR_CODES.SCOPE_VIOLATION
  );
  assert.equal(absent.calls.length, 0);

  const missingWorkspace = capturingDb();
  await assert.rejects(
    queryAuditEvents(missingWorkspace, { tenantId: TENANT, queryScope: 'workspace', pageSize: 25 }),
    (error) => error.code === AUDIT_QUERY_ERROR_CODES.SCOPE_VIOLATION
  );
  assert.equal(missingWorkspace.calls.length, 0);

  const workspace = capturingDb();
  await queryAuditEvents(workspace, {
    tenantId: TENANT,
    workspaceId: WORKSPACE,
    pageSize: 2,
    sort: '-eventTimestamp',
    cursorPosition: POSITION,
    filters: {}
  });
  const [{ sql, params }] = workspace.calls;
  assert.match(sql, /tenant_id = \$1/);
  assert.match(sql, /new_state->>'workspaceId' = \$2/);
  assert.match(sql, /\(created_at, id\) < \(\$3::timestamptz, \$4\)/);
  assert.match(sql, /ORDER BY created_at DESC, id DESC LIMIT \$5/);
  assert.deepEqual(params, [TENANT, WORKSPACE, POSITION.createdAt, POSITION.id, 3]);
});

// bbx-c09-12 | fn-observability-audit-record-query | #### Scenario: Occurred-after filter is applied; #### Scenario: Occurred-before filter is applied
test('bbx-c09-12 [fn-observability-audit-record-query] RFC3339 fractions with four through nine digits reach SQL without truncation', async () => {
  const observed = [];
  const expected = [];
  for (const [publicParam, canonicalId] of [
    ['filter[occurredAfter]', 'occurred_after'],
    ['filter[occurredBefore]', 'occurred_before']
  ]) {
    for (let digits = 4; digits <= 9; digits += 1) {
      const fraction = '123456789'.slice(0, digits);
      const timestamp = `2026-08-04T12:00:00.${fraction}Z`;
      const db = capturingDb();
      const response = await METRICS_HANDLERS.metricsTenantAudit(tenantAuditContext(db, {
        [publicParam]: timestamp
      }));
      assert.equal(response.statusCode, 200, JSON.stringify(response.body));
      assert.equal(db.calls.length, 1);
      observed.push([canonicalId, db.calls[0].params[1]]);
      expected.push([canonicalId, timestamp]);
    }
  }

  assert.deepEqual(observed, expected, 'validated RFC3339 precision must be bound unchanged');
});

// bbx-c09-13 | fn-observability-audit-record-query | #### Scenario: Descending continuation is applied; #### Scenario: Ascending continuation is applied; #### Scenario: Multiple pages contain tied timestamps
test('bbx-c09-13 [fn-observability-audit-record-query] microsecond-separated rows paginate in both directions without gaps or duplicates', async (t) => {
  const cases = [
    {
      label: 'descending',
      sort: '-eventTimestamp',
      expectedIds: [
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'
      ],
      expectedCursorTimestamp: '2026-08-04T12:00:00.000500Z'
    },
    {
      label: 'ascending',
      sort: 'eventTimestamp',
      expectedIds: [
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5'
      ],
      expectedCursorTimestamp: '2026-08-04T12:00:00.000400Z'
    }
  ];

  for (const { label, sort, expectedIds, expectedCursorTimestamp } of cases) {
    await t.test(label, async () => {
      const db = microsecondPagingDb();
      const first = await METRICS_HANDLERS.metricsTenantAudit(tenantAuditContext(db, {
        'page[size]': '1',
        sort
      }));
      assert.equal(first.statusCode, 200, JSON.stringify(first.body));
      assert.equal(first.body.page.hasMore, true);
      assert.equal(typeof first.body.page.nextCursor, 'string');
      const cursorPosition = decodeAuditCursor(first.body.page.nextCursor).position;

      const second = await METRICS_HANDLERS.metricsTenantAudit(tenantAuditContext(db, {
        'page[size]': '1',
        sort,
        'page[after]': first.body.page.nextCursor
      }));
      assert.equal(second.statusCode, 200, JSON.stringify(second.body));

      assert.deepEqual({
        ids: [
          ...first.body.items.map(({ eventId }) => eventId),
          ...second.body.items.map(({ eventId }) => eventId)
        ],
        firstCursor: cursorPosition,
        secondPage: second.body.page
      }, {
        ids: expectedIds,
        firstCursor: {
          createdAt: expectedCursorTimestamp,
          id: expectedIds[0]
        },
        secondPage: {
          size: 1,
          hasMore: false
        }
      });
      assert.equal(db.calls.length, 2);
    });
  }
});

// bbx-c09-14 | fn-observability-audit-record-query | #### Scenario: Occurred-after filter is applied; #### Scenario: Sort direction changes
test('bbx-c09-14 [fn-observability-audit-record-query] public event timestamps preserve the stored sub-millisecond instant', async () => {
  const db = microsecondPagingDb();
  const unfiltered = await METRICS_HANDLERS.metricsTenantAudit(tenantAuditContext(db, {
    'page[size]': '2',
    sort: '-eventTimestamp'
  }));
  const filtered = await METRICS_HANDLERS.metricsTenantAudit(tenantAuditContext(db, {
    'page[size]': '2',
    sort: '-eventTimestamp',
    'filter[occurredAfter]': '2026-08-04T12:00:00.000500Z'
  }));

  assert.equal(unfiltered.statusCode, 200, JSON.stringify(unfiltered.body));
  assert.equal(filtered.statusCode, 200, JSON.stringify(filtered.body));
  assert.deepEqual({
    unfiltered: unfiltered.body.items.map(({ eventId, eventTimestamp }) => ({ eventId, eventTimestamp })),
    filtered: filtered.body.items.map(({ eventId, eventTimestamp }) => ({ eventId, eventTimestamp }))
  }, {
    unfiltered: [
      {
        eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
        eventTimestamp: '2026-08-04T12:00:00.000500Z'
      },
      {
        eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4',
        eventTimestamp: '2026-08-04T12:00:00.000400Z'
      }
    ],
    filtered: [
      {
        eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
        eventTimestamp: '2026-08-04T12:00:00.000500Z'
      }
    ]
  });
});

// bbx-c09-15 | fn-observability-audit-record-query | #### Scenario: Timestamp is not RFC 3339; #### Scenario: Enumerated value is unknown; #### Scenario: Valid free-form value has no match
test('bbx-c09-15 [fn-observability-audit-record-query] present empty filters fail 400 before audit SELECT', async (t) => {
  for (const publicParam of [
    'filter[occurredAfter]',
    'filter[outcome]',
    'filter[actorId]'
  ]) {
    await t.test(publicParam, async () => {
      const db = capturingDb();
      const response = await METRICS_HANDLERS.metricsTenantAudit(tenantAuditContext(db, {
        [publicParam]: ''
      }));

      assert.deepEqual({
        statusCode: response.statusCode,
        auditSelectCount: db.calls.length
      }, {
        statusCode: 400,
        auditSelectCount: 0
      }, JSON.stringify(response.body));
    });
  }
});

// bbx-c09-16 | fn-observability-audit-record-query | #### Scenario: Authorized workspace audit query; #### Scenario: Required tenant scope is absent at store boundary
test('bbx-c09-16 [fn-observability-audit-record-query] executor normalization rejects absent or mismatched tenant scope', () => {
  const observedCodes = [
    ['workspace without tenant', ['workspace', { workspaceId: WORKSPACE }, {}]],
    ['path tenant differs from caller tenant', [
      'tenant',
      { tenantId: TENANT },
      { tenantId: '22222222-2222-2222-2222-222222222222' }
    ]]
  ].map(([label, args]) => {
    try {
      normalizeAuditRecordQuery(...args);
      return [label, 'NO_ERROR'];
    } catch (error) {
      return [label, error.code];
    }
  });

  assert.deepEqual(observedCodes, [
    ['workspace without tenant', AUDIT_QUERY_ERROR_CODES.SCOPE_VIOLATION],
    ['path tenant differs from caller tenant', AUDIT_QUERY_ERROR_CODES.SCOPE_VIOLATION]
  ]);
});
