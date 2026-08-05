// Black-box test suite for change add-flow-schedule-management-api (#680).
//
// Drives the PUBLIC HTTP surface of the flow schedule-management plane:
//   GET    /v1/flows/workspaces/{ws}/schedules                      -> list (prefix-isolated)
//   GET    /v1/flows/workspaces/{ws}/flows/{flowId}/schedule        -> get   (404 if none)
//   POST   /v1/flows/workspaces/{ws}/flows/{flowId}/schedule/pause  -> pause (paused=true)
//   POST   /v1/flows/workspaces/{ws}/flows/{flowId}/schedule/resume -> resume (paused=false)
//   POST   /v1/flows/workspaces/{ws}/flows/{flowId}/schedule/trigger-> trigger (202)
//
// Boots the REAL control-plane server in-process with the REAL flow executor + trigger registry,
// wired to a FAKE @temporalio/client whose `.schedule` ScheduleClient supports
// create/getHandle(describe/pause/unpause/trigger/delete/update) and list() — exactly the no-infra
// mode the blackbox suite must stay green in. Public interface only.
//
// Tests: bbx-flows-sched-01 .. bbx-flows-sched-12
import test from 'node:test';
import assert from 'node:assert/strict';

import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createConnectionRegistry } from '../../apps/control-plane-executor/src/runtime/connection-registry.mjs';
import { createFlowExecutor } from '../../apps/control-plane-executor/src/runtime/flow-executor.mjs';
import { createFlowTriggerRegistry } from '../../apps/control-plane-executor/src/runtime/flow-trigger-registry.mjs';

const TEN_A = 'ten_sched_a';
const WS_A = 'ws_sched_a';
const TEN_B = 'ten_sched_b';
const WS_B = 'ws_sched_b';

const headersFor = (tenantId, workspaceId) => ({
  'content-type': 'application/json',
  'x-tenant-id': tenantId,
  'x-workspace-id': workspaceId,
  'x-auth-subject': `admin-${tenantId}`,
});

// A not-found error shaped like the REAL @temporalio/client@1.18.1 `ScheduleNotFoundError`, so the
// suite would have CAUGHT a brittle isScheduleNotFound (which is the SOLE cross-tenant/no-schedule
// -> 404 mechanism). Faithfully reproduces the adversarial-but-realistic wire shape:
//   - the class is LITERALLY named `ScheduleNotFoundError`, so `err.constructor.name` is right (the
//     robust signal the hardened mapper relies on);
//   - it does NOT set `this.name`, so `err.name` stays the default `'Error'` (models the real SDK's
//     gRPC re-wrap path + any copy/serialisation that drops the prototype-defined name — exactly the
//     case the OLD mapper, which keyed off `err.name === 'ScheduleNotFoundError'`, would miss);
//   - it carries a CUSTOM, non-default `message`/`details` (the server's gRPC `err.details`), so the
//     narrow message probe does NOT match either;
//   - it has NO `code` (the SDK drops the gRPC code 5 in the re-wrap).
// The OLD mapper would classify this as a 500; the hardened mapper (constructor-name) maps it to 404.
class ScheduleNotFoundError extends Error {
  constructor(message, scheduleId) {
    super(message);
    // Deliberately NOT setting this.name — left as the inherited default 'Error'.
    this.scheduleId = scheduleId;
    this.details = message;
  }
}
// Build a real-SDK-shaped not-found error (custom details, no name, no code).
const notFound = (scheduleId) =>
  new ScheduleNotFoundError(`workflow schedule for id '${scheduleId}' was not present in namespace`, scheduleId);

const CRON_DEF = {
  apiVersion: 'v1.0',
  name: 'cron-flow',
  triggers: [{ kind: 'cron', schedule: '*/5 * * * *', options: { overlap: 'skip', catchupWindow: '5m' } }],
  nodes: [{ id: 'step-1', type: 'task', taskType: 'fetch-record' }],
};

const NO_TRIGGER_DEF = {
  apiVersion: 'v1.0',
  name: 'plain-flow',
  nodes: [{ id: 'step-1', type: 'task', taskType: 'fetch-record' }],
};

// A fake @temporalio/client whose `.schedule` ScheduleClient supports the FULL management surface:
// create / getHandle(describe/pause/unpause/trigger/delete/update) and list(). Each schedule holds
// real mutable state (paused/note/triggers) so a pause is observable on a subsequent describe and a
// trigger is recorded — the handler must genuinely reflect what Temporal reports.
function makeFakeTemporal() {
  const handles = new Map();
  const started = [];
  const schedules = new Map(); // scheduleId -> { spec, action, policies, paused, note, triggers: [] }
  const scheduleOps = [];

  function handleFor(workflowId, searchAttributes) {
    return {
      workflowId,
      firstExecutionRunId: `run-${workflowId.slice(-6)}`,
      _searchAttributes: searchAttributes ?? { flowVersion: ['1'] },
      _status: 'Running',
      async describe() { return { status: { name: this._status }, searchAttributes: this._searchAttributes }; },
      async fetchHistory() { return { events: [] }; },
      async cancel() { this._status = 'Cancelled'; },
      async signal() {},
    };
  }

  // Build the ScheduleDescription-shaped object the gateway's describe()/pause()/unpause() return.
  function describeOf(scheduleId) {
    const s = schedules.get(scheduleId);
    if (!s) throw notFound(scheduleId);
    return {
      scheduleId,
      // Mirror the REAL SDK: describe() returns a ScheduleSpecDescription that has COMPILED the cron
      // into structured `calendars` and OMITS `cronExpressions` entirely (it is always undefined).
      // So the handler must NOT depend on it for `cron` — the value comes from the stored definition.
      spec: { calendars: [{ minute: [{ step: 5 }] }] },
      state: { paused: s.paused === true, note: s.note ?? undefined },
      info: {
        nextActionTimes: s.paused ? [] : [new Date('2026-06-22T12:00:00.000Z')],
        recentActions: (s.triggers ?? []).map((t) => ({
          scheduledAt: new Date(t.at),
          takenAt: new Date(t.at),
          action: { type: 'startWorkflow', workflow: { workflowId: `${scheduleId}#trig-${t.seq}`, firstExecutionRunId: 'r' } },
        })),
      },
    };
  }

  function scheduleHandle(scheduleId) {
    return {
      scheduleId,
      async describe() { return describeOf(scheduleId); },
      async update(fn) {
        const prev = schedules.get(scheduleId) ?? {};
        const next = fn(prev);
        schedules.set(scheduleId, { ...prev, spec: next.spec, action: next.action, policies: next.policies });
        scheduleOps.push({ op: 'update', scheduleId });
      },
      async delete() {
        if (!schedules.has(scheduleId)) throw notFound(scheduleId);
        schedules.delete(scheduleId);
        scheduleOps.push({ op: 'delete', scheduleId });
      },
      async pause(note) {
        const s = schedules.get(scheduleId);
        if (!s) throw notFound(scheduleId);
        s.paused = true; s.note = note ?? s.note;
        scheduleOps.push({ op: 'pause', scheduleId });
      },
      async unpause(note) {
        const s = schedules.get(scheduleId);
        if (!s) throw notFound(scheduleId);
        s.paused = false; s.note = note ?? s.note;
        scheduleOps.push({ op: 'unpause', scheduleId });
      },
      async trigger(overlap) {
        const s = schedules.get(scheduleId);
        if (!s) throw notFound(scheduleId);
        s.triggers = s.triggers ?? [];
        s.triggers.push({ at: Date.now(), seq: s.triggers.length + 1, overlap });
        scheduleOps.push({ op: 'trigger', scheduleId });
      },
    };
  }

  return {
    started,
    schedules,
    scheduleOps,
    workflow: {
      async start(type, opts) {
        const h = handleFor(opts.workflowId, opts.searchAttributes);
        handles.set(opts.workflowId, h);
        started.push({ type, workflowId: opts.workflowId, opts });
        return h;
      },
      getHandle(id) { return handles.get(id) ?? handleFor(id, { flowVersion: ['1'] }); },
      async *list() { for (const h of handles.values()) yield { workflowId: h.workflowId, runId: h.firstExecutionRunId, status: { name: h._status } }; },
    },
    schedule: {
      async create(opts) {
        if (schedules.has(opts.scheduleId)) throw Object.assign(new Error('schedule already running'), { name: 'ScheduleAlreadyRunning' });
        schedules.set(opts.scheduleId, { spec: opts.spec, action: opts.action, policies: opts.policies, paused: false, note: null, triggers: [] });
        scheduleOps.push({ op: 'create', scheduleId: opts.scheduleId });
        return scheduleHandle(opts.scheduleId);
      },
      getHandle(scheduleId) { return scheduleHandle(scheduleId); },
      // ScheduleClient.list() yields a summary per schedule across the WHOLE namespace — the
      // handler must prefix-filter to the caller's `{tenant}:{ws}:` scope.
      async *list() {
        for (const [scheduleId, s] of schedules.entries()) {
          yield {
            scheduleId,
            // Real SDK: the list summary's spec carries structured `calendars`, NOT `cronExpressions`
            // (the handler sources `cron` from the stored definition, never from this).
            spec: { calendars: [{ minute: [{ step: 5 }] }] },
            state: { paused: s.paused === true, note: s.note ?? undefined },
            info: { nextActionTimes: s.paused ? [] : [new Date('2026-06-22T12:00:00.000Z')], recentActions: [] },
          };
        }
      },
    },
  };
}

function makeRegistry() {
  return createConnectionRegistry({ resolveConnection: () => ({ dsn: 'postgres://unused/none' }) });
}

// Boot the server with an executor + a wired-in trigger registry sharing the SAME fake Temporal.
async function withScheduleServer(fn, { temporal } = {}) {
  const t = temporal ?? makeFakeTemporal();
  const registry = makeRegistry();
  const flowExecutor = createFlowExecutor({ temporalClient: t, temporalAddress: 'fake:7233' });
  const triggerRegistry = createFlowTriggerRegistry({
    temporalClient: t,
    startTriggeredExecution: (args) => flowExecutor.startTriggeredExecution(args),
    logger: { error() {} },
  });
  flowExecutor.setTriggerRegistry(triggerRegistry);
  const server = createControlPlaneServer({ registry, flowExecutor, logger: { error() {} } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn({ baseUrl, flowExecutor, triggerRegistry, temporal: t });
  } finally {
    await new Promise((r) => server.close(r));
    await registry.end().catch(() => {});
    await flowExecutor.close().catch(() => {});
  }
}

const flowsBase = (ws) => `/v1/flows/workspaces/${ws}/flows`;
const schedulesBase = (ws) => `/v1/flows/workspaces/${ws}/schedules`;

// Create + publish a cron flow in (tenantId, ws); returns its flowId (and so its scheduleId).
async function publishCronFlow(baseUrl, tenantId, ws, name = 'Cron Flow', def = CRON_DEF) {
  const hdrs = headersFor(tenantId, ws);
  const create = await fetch(`${baseUrl}${flowsBase(ws)}`, { method: 'POST', headers: hdrs, body: JSON.stringify({ name, definition: def }) });
  const { flowId } = await create.json();
  const pub = await fetch(`${baseUrl}${flowsBase(ws)}/${flowId}/versions`, { method: 'POST', headers: hdrs });
  assert.equal(pub.status, 201, 'cron flow publishes');
  return { flowId, scheduleId: `${tenantId}:${ws}:${flowId}` };
}

// ---- list + get ----

// bbx-flows-sched-01: a published cron flow is listed with paused=false and a next-fire time.
test('bbx-flows-sched-01: list schedules returns the published cron schedule (paused=false, next-fire)', async () => {
  await withScheduleServer(async ({ baseUrl }) => {
    const { flowId, scheduleId } = await publishCronFlow(baseUrl, TEN_A, WS_A);
    const res = await fetch(`${baseUrl}${schedulesBase(WS_A)}`, { headers: headersFor(TEN_A, WS_A) });
    assert.equal(res.status, 200);
    const { items } = await res.json();
    const entry = items.find((s) => s.scheduleId === scheduleId);
    assert.ok(entry, 'the published flow schedule is listed');
    assert.equal(entry.flowId, flowId, 'flowId derived back from the schedule id');
    assert.equal(entry.workspaceId, WS_A);
    assert.equal(entry.paused, false, 'a fresh schedule is not paused');
    assert.ok(Array.isArray(entry.nextActionTimes) && entry.nextActionTimes.length >= 1, 'reports a next-fire time');
    assert.deepEqual(entry.cron, ['*/5 * * * *'], 'cron expression surfaced from the spec');
  });
});

// bbx-flows-sched-02: get a single flow's schedule returns the normalized resource.
test('bbx-flows-sched-02: get a flow schedule returns the normalized resource', async () => {
  await withScheduleServer(async ({ baseUrl }) => {
    const { flowId, scheduleId } = await publishCronFlow(baseUrl, TEN_A, WS_A);
    const res = await fetch(`${baseUrl}${flowsBase(WS_A)}/${flowId}/schedule`, { headers: headersFor(TEN_A, WS_A) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.scheduleId, scheduleId);
    assert.equal(body.flowId, flowId);
    assert.equal(body.workspaceId, WS_A);
    assert.equal(body.paused, false);
    assert.deepEqual(body.cron, ['*/5 * * * *']);
  });
});

// ---- pause / resume (idempotent, no flow deletion) ----

// bbx-flows-sched-03: pausing a schedule reports paused=true and a subsequent get reflects it.
test('bbx-flows-sched-03: pause reports paused=true and is reflected on a later get', async () => {
  await withScheduleServer(async ({ baseUrl, temporal }) => {
    const { flowId, scheduleId } = await publishCronFlow(baseUrl, TEN_A, WS_A);
    const pause = await fetch(`${baseUrl}${flowsBase(WS_A)}/${flowId}/schedule/pause`, { method: 'POST', headers: headersFor(TEN_A, WS_A) });
    assert.equal(pause.status, 200);
    assert.equal((await pause.json()).paused, true, 'pause returns paused=true');
    // The flow DEFINITION is NOT deleted (the schedule still exists in Temporal).
    assert.ok(temporal.schedules.has(scheduleId), 'pause does not delete the schedule');
    const get = await fetch(`${baseUrl}${flowsBase(WS_A)}/${flowId}/schedule`, { headers: headersFor(TEN_A, WS_A) });
    const body = await get.json();
    assert.equal(body.paused, true, 'a later get reflects the pause');
    assert.deepEqual(body.nextActionTimes, [], 'a paused schedule reports no upcoming fire');
  });
});

// bbx-flows-sched-04: resume re-enables a paused schedule (paused=false), flow still present.
test('bbx-flows-sched-04: resume re-enables a paused schedule', async () => {
  await withScheduleServer(async ({ baseUrl, temporal }) => {
    const { flowId, scheduleId } = await publishCronFlow(baseUrl, TEN_A, WS_A);
    await fetch(`${baseUrl}${flowsBase(WS_A)}/${flowId}/schedule/pause`, { method: 'POST', headers: headersFor(TEN_A, WS_A) });
    const resume = await fetch(`${baseUrl}${flowsBase(WS_A)}/${flowId}/schedule/resume`, { method: 'POST', headers: headersFor(TEN_A, WS_A) });
    assert.equal(resume.status, 200);
    assert.equal((await resume.json()).paused, false, 'resume returns paused=false');
    assert.ok(temporal.schedules.has(scheduleId), 'resume does not delete the schedule');
  });
});

// bbx-flows-sched-05: pause is idempotent — pausing an already-paused schedule stays 200 paused=true.
test('bbx-flows-sched-05: pausing an already-paused schedule is idempotent (200, paused=true)', async () => {
  await withScheduleServer(async ({ baseUrl }) => {
    const { flowId } = await publishCronFlow(baseUrl, TEN_A, WS_A);
    const first = await fetch(`${baseUrl}${flowsBase(WS_A)}/${flowId}/schedule/pause`, { method: 'POST', headers: headersFor(TEN_A, WS_A) });
    const second = await fetch(`${baseUrl}${flowsBase(WS_A)}/${flowId}/schedule/pause`, { method: 'POST', headers: headersFor(TEN_A, WS_A) });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200, 'second pause is still 200 (idempotent)');
    assert.equal((await second.json()).paused, true);
  });
});

// ---- trigger ----

// bbx-flows-sched-06: trigger requests an immediate run (202) and the fake records it.
test('bbx-flows-sched-06: trigger acks an ad-hoc run (202) and records it', async () => {
  await withScheduleServer(async ({ baseUrl, temporal }) => {
    const { flowId, scheduleId } = await publishCronFlow(baseUrl, TEN_A, WS_A);
    const res = await fetch(`${baseUrl}${flowsBase(WS_A)}/${flowId}/schedule/trigger`, { method: 'POST', headers: headersFor(TEN_A, WS_A) });
    assert.equal(res.status, 202);
    const body = await res.json();
    assert.equal(body.status, 'triggered');
    assert.equal(body.scheduleId, scheduleId);
    assert.equal(temporal.scheduleOps.filter((o) => o.op === 'trigger' && o.scheduleId === scheduleId).length, 1, 'exactly one trigger recorded');
    assert.equal((temporal.schedules.get(scheduleId).triggers ?? []).length, 1, 'the fake recorded one triggered run');
  });
});

// ---- isolation (cross-tenant denied) ----

// bbx-flows-sched-07: tenant B cannot get tenant A's flow schedule (cross-tenant -> 404).
test('bbx-flows-sched-07: cross-tenant get of another tenant flow schedule is 404 (not 403-leak, not 500)', async () => {
  await withScheduleServer(async ({ baseUrl }) => {
    const { flowId } = await publishCronFlow(baseUrl, TEN_A, WS_A);
    // Tenant B references tenant A's flowId but under B's OWN workspace path (the request gate
    // allows it: B owns WS_B). The schedule id resolves to B's namespace -> not found -> 404.
    const res = await fetch(`${baseUrl}${flowsBase(WS_B)}/${flowId}/schedule`, { headers: headersFor(TEN_B, WS_B) });
    assert.equal(res.status, 404, 'a foreign flowId resolves to a non-existent schedule -> 404');
    assert.equal((await res.json()).code, 'GW_SCHEDULE_NOT_FOUND');
  });
});

// bbx-flows-sched-08: tenant B's list does NOT include tenant A's schedule (prefix isolation).
test('bbx-flows-sched-08: list is prefix-isolated — tenant B never sees tenant A schedules', async () => {
  await withScheduleServer(async ({ baseUrl, temporal }) => {
    const a = await publishCronFlow(baseUrl, TEN_A, WS_A, 'A Flow');
    const b = await publishCronFlow(baseUrl, TEN_B, WS_B, 'B Flow');
    // The fake holds BOTH schedules in the one namespace.
    assert.ok(temporal.schedules.has(a.scheduleId) && temporal.schedules.has(b.scheduleId));
    const res = await fetch(`${baseUrl}${schedulesBase(WS_B)}`, { headers: headersFor(TEN_B, WS_B) });
    assert.equal(res.status, 200);
    const { items } = await res.json();
    const ids = items.map((s) => s.scheduleId);
    assert.ok(ids.includes(b.scheduleId), "B's own schedule is listed");
    assert.ok(!ids.includes(a.scheduleId), "A's schedule is NOT in B's list (prefix isolation)");
    assert.ok(ids.every((id) => id.startsWith(`${TEN_B}:${WS_B}:`)), 'every listed id is in the B tenant/workspace scope');
  });
});

// bbx-flows-sched-09: tenant B cannot pause/resume/trigger tenant A's schedule (404 each).
test('bbx-flows-sched-09: cross-tenant pause/resume/trigger of another tenant schedule is 404', async () => {
  await withScheduleServer(async ({ baseUrl, temporal }) => {
    const { flowId, scheduleId } = await publishCronFlow(baseUrl, TEN_A, WS_A);
    for (const op of ['pause', 'resume', 'trigger']) {
      const res = await fetch(`${baseUrl}${flowsBase(WS_B)}/${flowId}/schedule/${op}`, { method: 'POST', headers: headersFor(TEN_B, WS_B) });
      assert.equal(res.status, 404, `cross-tenant ${op} -> 404`);
    }
    // A's schedule is untouched (still present, never paused/triggered by B).
    assert.equal(temporal.schedules.get(scheduleId).paused, false, "A's schedule state untouched by B");
    assert.equal((temporal.schedules.get(scheduleId).triggers ?? []).length, 0, "A's schedule never triggered by B");
  });
});

// ---- no-schedule (flow without a cron trigger) ----

// bbx-flows-sched-10: get/pause/resume/trigger on a flow with NO cron schedule -> 404 SCHEDULE_NOT_FOUND.
test('bbx-flows-sched-10: a flow without a cron schedule yields 404 SCHEDULE_NOT_FOUND on all per-flow ops', async () => {
  await withScheduleServer(async ({ baseUrl }) => {
    // Publish a flow with NO triggers -> no Temporal Schedule is created.
    const hdrs = headersFor(TEN_A, WS_A);
    const create = await fetch(`${baseUrl}${flowsBase(WS_A)}`, { method: 'POST', headers: hdrs, body: JSON.stringify({ name: 'Plain', definition: NO_TRIGGER_DEF }) });
    const { flowId } = await create.json();
    await fetch(`${baseUrl}${flowsBase(WS_A)}/${flowId}/versions`, { method: 'POST', headers: hdrs });
    const get = await fetch(`${baseUrl}${flowsBase(WS_A)}/${flowId}/schedule`, { headers: hdrs });
    assert.equal(get.status, 404);
    assert.equal((await get.json()).code, 'GW_SCHEDULE_NOT_FOUND');
    for (const op of ['pause', 'resume', 'trigger']) {
      const res = await fetch(`${baseUrl}${flowsBase(WS_A)}/${flowId}/schedule/${op}`, { method: 'POST', headers: hdrs });
      assert.equal(res.status, 404, `${op} on a flow with no schedule -> 404`);
      assert.equal((await res.json()).code, 'GW_SCHEDULE_NOT_FOUND');
    }
  });
});

// ---- auth ----

// bbx-flows-sched-11: unauthenticated (no tenant) schedule access is 401.
test('bbx-flows-sched-11: unauthenticated schedule access is 401', async () => {
  await withScheduleServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}${schedulesBase(WS_A)}`, { headers: { 'content-type': 'application/json' } });
    assert.equal(res.status, 401);
  });
});

// bbx-flows-sched-12: an entirely-unknown flowId's schedule is a clean 404 (never a 500).
test('bbx-flows-sched-12: an unknown flowId schedule is a clean 404', async () => {
  await withScheduleServer(async ({ baseUrl }) => {
    const res = await fetch(`${baseUrl}${flowsBase(WS_A)}/does-not-exist/schedule`, { headers: headersFor(TEN_A, WS_A) });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).code, 'GW_SCHEDULE_NOT_FOUND');
  });
});

// bbx-flows-sched-13: spoofing x-workspace-id to a victim's workspace does NOT reach the victim's
// schedule — the verified tenant prefix (the caller's own tenant) is the hard boundary, so the
// derived schedule id is `{attackerTenant}:{victimWorkspace}:{flowId}`, which does not exist.
test('bbx-flows-sched-13: x-workspace-id spoof cannot reach a foreign tenant schedule (tenant prefix is the boundary)', async () => {
  await withScheduleServer(async ({ baseUrl, temporal }) => {
    const a = await publishCronFlow(baseUrl, TEN_A, WS_A);
    // Tenant B targets A's flowId AND spoofs x-workspace-id = WS_A, but keeps its own verified tenant.
    const spoofed = { ...headersFor(TEN_B, WS_B), 'x-workspace-id': WS_A };
    const res = await fetch(`${baseUrl}${flowsBase(WS_B)}/${a.flowId}/schedule`, { headers: spoofed });
    assert.equal(res.status, 404, 'the verified tenant prefix keeps the schedule id off A’s namespace -> 404');
    assert.equal((await res.json()).code, 'GW_SCHEDULE_NOT_FOUND');
    // A's real schedule is untouched and was never read into B's response.
    assert.ok(temporal.schedules.has(a.scheduleId));
    assert.equal(temporal.schedules.get(a.scheduleId).paused, false);
  });
});

// ---- real-SDK not-found shape (isScheduleNotFound robustness; revert-proof for the hardening) ----

// First, prove the fake's not-found error really IS shaped like the production SDK error — i.e. that
// the ONLY reliable discriminator is the constructor name. If this guard ever relaxes (e.g. someone
// re-adds `name`/`code`), the cross-tenant/no-schedule -> 404 tests below would stop proving the
// hardening, so we pin the shape here.
test('bbx-flows-sched-14: the fake not-found error matches the real @temporalio/client shape (constructor-name only)', () => {
  const err = notFound('ten:ws:flow');
  assert.equal(err.constructor.name, 'ScheduleNotFoundError', 'class name is retained (the robust signal)');
  assert.equal(err.name, 'Error', "err.name is NOT 'ScheduleNotFoundError' (mirrors the SDK re-wrap/serialisation loss)");
  assert.equal(err.code, undefined, 'no gRPC code 5 (the SDK drops it on re-wrap)');
  assert.ok(!/schedule not found|no schedule/i.test(err.message), 'custom details: the narrow message probe does NOT match');
  // Therefore: an isScheduleNotFound that relied on err.name / err.code / the message probe would
  // classify THIS as a non-not-found fault -> 500. Only a constructor.name check maps it to 404.
});

// The cross-tenant 404 must hold when Temporal raises the REAL-shaped not-found error. With the OLD
// isScheduleNotFound (err.name === 'ScheduleNotFoundError' || code 5 || message probe) this surfaces
// as a 500 (existence-revealing AND an unexpected server error); with the hardened mapper it is 404.
// This is the revert-proof: it FAILS against the un-hardened helper and PASSES against the hardened
// one. Exercised across get + pause + resume + trigger so every handle method is covered.
test('bbx-flows-sched-15: a REAL-SDK-shaped not-found maps to 404 across get/pause/resume/trigger (not 500)', async () => {
  await withScheduleServer(async ({ baseUrl }) => {
    const { flowId } = await publishCronFlow(baseUrl, TEN_A, WS_A);
    // Tenant B (own workspace) references A's flowId -> derived id `ten_B:ws_B:flowId` does not exist
    // -> the fake throws the real-SDK-shaped ScheduleNotFoundError. Must be a clean 404, never 500.
    const hdrs = headersFor(TEN_B, WS_B);
    const get = await fetch(`${baseUrl}${flowsBase(WS_B)}/${flowId}/schedule`, { headers: hdrs });
    assert.equal(get.status, 404, 'get of a real-not-found schedule -> 404 (NOT 500)');
    assert.equal((await get.json()).code, 'GW_SCHEDULE_NOT_FOUND');
    for (const op of ['pause', 'resume', 'trigger']) {
      const res = await fetch(`${baseUrl}${flowsBase(WS_B)}/${flowId}/schedule/${op}`, { method: 'POST', headers: hdrs });
      assert.equal(res.status, 404, `${op} of a real-not-found schedule -> 404 (NOT 500)`);
      assert.equal((await res.json()).code, 'GW_SCHEDULE_NOT_FOUND');
    }
  });
});

// ---- cron truthfulness (sourced from the published definition, not echoed from Temporal) ----

// The real SDK describe()/list() omit cronExpressions (cron is compiled into structured calendars),
// so `cron` MUST come from the authoritative published flow definition. The fake now returns the real
// shape (structured `calendars`, no `cronExpressions`), so this asserts the PRODUCTION behavior: the
// response still carries the user's published cron string even though Temporal surfaces none.
test('bbx-flows-sched-16: cron is sourced from the published definition even when Temporal omits cronExpressions', async () => {
  await withScheduleServer(async ({ baseUrl, temporal }) => {
    const { flowId, scheduleId } = await publishCronFlow(baseUrl, TEN_A, WS_A);
    // Sanity: the fake schedule description genuinely has NO cronExpressions (real-SDK shape).
    const desc = temporal.schedule.getHandle(scheduleId);
    const described = await desc.describe();
    assert.equal(described.spec.cronExpressions, undefined, 'fake describe() omits cronExpressions (real SDK shape)');
    assert.ok(Array.isArray(described.spec.calendars), 'fake describe() carries structured calendars');
    // get: cron is the published value, not the (absent) Temporal cronExpressions.
    const get = await (await fetch(`${baseUrl}${flowsBase(WS_A)}/${flowId}/schedule`, { headers: headersFor(TEN_A, WS_A) })).json();
    assert.deepEqual(get.cron, ['*/5 * * * *'], 'get cron comes from the published definition');
    // list: same authoritative cron per entry.
    const { items } = await (await fetch(`${baseUrl}${schedulesBase(WS_A)}`, { headers: headersFor(TEN_A, WS_A) })).json();
    const entry = items.find((s) => s.scheduleId === scheduleId);
    assert.deepEqual(entry.cron, ['*/5 * * * *'], 'list cron comes from the published definition');
  });
});
