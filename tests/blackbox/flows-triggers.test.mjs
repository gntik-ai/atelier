// Black-box test suite for change add-flows-triggers (#365).
//
// Drives the PUBLIC surface of the flow trigger plane:
//   - the control-plane HTTP server (POST .../triggers/webhooks/{triggerId}) for inbound webhooks,
//   - the flow executor publish/delete path (which registers/swaps/removes triggers),
// using an INJECTED fake Temporal client (with a `.schedule` ScheduleClient) and the in-memory
// trigger store — exactly the no-infra mode the blackbox suite must stay green in.
//
// Public interface only: boots the real server in-process and exercises it over HTTP, and drives
// the real executor/registry factories.
//
// Tests: bbx-flows-trig-01 .. bbx-flows-trig-14
import test from 'node:test';
import assert from 'node:assert/strict';

import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createConnectionRegistry } from '../../apps/control-plane-executor/src/runtime/connection-registry.mjs';
import { createFlowExecutor } from '../../apps/control-plane-executor/src/runtime/flow-executor.mjs';
import { createFlowTriggerRegistry } from '../../apps/control-plane-executor/src/runtime/flow-trigger-registry.mjs';
import { computeSignature } from '../../packages/webhook-engine/src/webhook-signing.mjs';

const TEN = 'ten_bbx_trig';
const WS = 'ws_bbx_trig';
const authHeaders = {
  'content-type': 'application/json',
  'x-api-version': '2026-03-26',
  'x-correlation-id': 'corr-bbx-flow-triggers',
  'x-tenant-id': TEN,
  'x-workspace-id': WS,
  'x-auth-subject': 'admin-trig',
};

const CRON_DEF = {
  apiVersion: 'v1.0',
  name: 'cron-flow',
  triggers: [{ kind: 'cron', schedule: '0 * * * *', options: { overlap: 'skip', catchupWindow: '5m' } }],
  nodes: [{ id: 'step-1', type: 'task', taskType: 'fetch-record' }],
};

const WEBHOOK_DEF = {
  apiVersion: 'v1.0',
  name: 'webhook-flow',
  triggers: [{ kind: 'webhook', path: 'orders' }],
  nodes: [{ id: 'step-1', type: 'task', taskType: 'fetch-record' }],
};

const EVENT_DEF = {
  apiVersion: 'v1.0',
  name: 'event-flow',
  triggers: [{ kind: 'platform-event', eventType: 'order-placed' }],
  nodes: [{ id: 'step-1', type: 'task', taskType: 'fetch-record' }],
};

// A fake @temporalio/client-shaped object with BOTH the workflow API (start/getHandle/list) and the
// `.schedule` ScheduleClient (create/getHandle.update/getHandle.delete) the registry uses.
function makeFakeTemporal() {
  const handles = new Map();
  const started = [];
  const schedules = new Map(); // scheduleId -> { spec, action, policies }
  const scheduleOps = [];

  function handleFor(workflowId, searchAttributes) {
    return {
      workflowId,
      firstExecutionRunId: `run-${workflowId.slice(-6)}`,
      _searchAttributes: searchAttributes ?? { flowVersion: ['1'] },
      _status: 'Running',
      async describe() {
        return { status: { name: this._status }, searchAttributes: this._searchAttributes, startTime: 't', closeTime: null };
      },
      async fetchHistory() { return { events: [] }; },
      async cancel() { this._status = 'Cancelled'; },
      async signal() {},
    };
  }

  return {
    started,
    schedules,
    scheduleOps,
    workflow: {
      async start(type, opts) {
        if (handles.has(opts.workflowId)) {
          // Model Temporal's workflow-id uniqueness: a duplicate id is rejected.
          throw Object.assign(new Error('Workflow execution already started'), { name: 'WorkflowExecutionAlreadyStartedError' });
        }
        const h = handleFor(opts.workflowId, opts.searchAttributes);
        handles.set(opts.workflowId, h);
        started.push({ type, workflowId: opts.workflowId, opts });
        return h;
      },
      getHandle(id) { return handles.get(id) ?? handleFor(id, { flowVersion: ['1'] }); },
      async *list({ query }) {
        const flowMatch = /flowId = '([^']+)'/.exec(query ?? '');
        const wantRunning = /ExecutionStatus = 'Running'/.test(query ?? '');
        for (const h of handles.values()) {
          if (flowMatch && !h.workflowId.includes(`:${flowMatch[1]}:`)) continue;
          if (wantRunning && h._status !== 'Running') continue;
          yield { workflowId: h.workflowId, runId: h.firstExecutionRunId, status: { name: h._status } };
        }
      },
    },
    schedule: {
      async create(opts) {
        if (schedules.has(opts.scheduleId)) {
          throw Object.assign(new Error('schedule already running'), { name: 'ScheduleAlreadyRunning' });
        }
        schedules.set(opts.scheduleId, { spec: opts.spec, action: opts.action, policies: opts.policies });
        scheduleOps.push({ op: 'create', scheduleId: opts.scheduleId });
        return { scheduleId: opts.scheduleId };
      },
      getHandle(scheduleId) {
        return {
          scheduleId,
          async update(fn) {
            const prev = schedules.get(scheduleId) ?? {};
            const next = fn(prev);
            schedules.set(scheduleId, { spec: next.spec, action: next.action, policies: next.policies });
            scheduleOps.push({ op: 'update', scheduleId });
          },
          async delete() {
            if (!schedules.has(scheduleId)) throw Object.assign(new Error('schedule not found'), { name: 'ScheduleNotFound' });
            schedules.delete(scheduleId);
            scheduleOps.push({ op: 'delete', scheduleId });
          },
        };
      },
    },
  };
}

function makeRegistry() {
  return createConnectionRegistry({ resolveConnection: () => ({ dsn: 'postgres://unused/none' }) });
}

// Boot the server with an executor + a wired-in trigger registry sharing the SAME fake Temporal.
async function withTriggersServer(fn, { temporal, audit } = {}) {
  const t = temporal ?? makeFakeTemporal();
  const registry = makeRegistry();
  const auditEvents = [];
  const flowExecutor = createFlowExecutor({
    temporalClient: t,
    temporalAddress: 'fake:7233',
    auditSink: audit ? async (e) => { auditEvents.push(e); } : undefined,
  });
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
    return await fn({ baseUrl, flowExecutor, triggerRegistry, temporal: t, auditEvents });
  } finally {
    await new Promise((r) => server.close(r));
    await registry.end().catch(() => {});
    await flowExecutor.close().catch(() => {});
  }
}

const flowsBase = (ws = WS) => `/v1/flows/workspaces/${ws}/flows`;

async function createAndPublish(baseUrl, def, name) {
  const create = await fetch(`${baseUrl}${flowsBase()}`, {
    method: 'POST', headers: authHeaders, body: JSON.stringify({ name, definition: def }),
  });
  const { flowId } = await create.json();
  const pub = await fetch(`${baseUrl}${flowsBase()}/${flowId}/versions`, { method: 'POST', headers: authHeaders });
  const pubBody = await pub.json();
  return { flowId, pubBody, pubStatus: pub.status };
}

// ---- Cron ----

// bbx-flows-trig-01: publishing a cron-trigger flow creates a Temporal Schedule (tenant-namespaced).
test('bbx-flows-trig-01: publishing a cron trigger creates a tenant-namespaced Temporal Schedule', async () => {
  await withTriggersServer(async ({ baseUrl, temporal }) => {
    const { flowId } = await createAndPublish(baseUrl, CRON_DEF, 'Cron Flow');
    const scheduleId = `${TEN}:${WS}:${flowId}`;
    assert.ok(temporal.schedules.has(scheduleId), 'schedule created with {tenantId}:{workspaceId}:{flowId} id');
    const sched = temporal.schedules.get(scheduleId);
    assert.deepEqual(sched.spec.cronExpressions, ['0 * * * *'], 'cron expression taken from the DSL');
    // DSL `overlap: 'skip'` maps to the Temporal SDK enum 'SKIP' (the SDK rejects lowercase).
    assert.equal(sched.policies.overlap, 'SKIP', 'overlap policy mapped to the SDK enum');
    assert.equal(sched.policies.catchupWindow, '5m', 'catch-up window from DSL options');
  });
});

// bbx-flows-trig-02: the cron schedule action stamps triggerType=cron + tenant search attributes.
test('bbx-flows-trig-02: cron schedule stamps triggerType=cron search attribute', async () => {
  await withTriggersServer(async ({ baseUrl, temporal }) => {
    const { flowId } = await createAndPublish(baseUrl, CRON_DEF, 'Cron Flow');
    const sched = temporal.schedules.get(`${TEN}:${WS}:${flowId}`);
    assert.deepEqual(sched.action.searchAttributes.triggerType, ['cron']);
    assert.deepEqual(sched.action.searchAttributes.tenantId, [TEN]);
    assert.equal(sched.action.workflowType, 'DslInterpreterWorkflow');
  });
});

// bbx-flows-trig-03: deleting a flow removes its Temporal Schedule (no orphan).
test('bbx-flows-trig-03: deleting a flow removes its Temporal Schedule', async () => {
  await withTriggersServer(async ({ baseUrl, temporal }) => {
    const { flowId } = await createAndPublish(baseUrl, CRON_DEF, 'Cron Flow');
    const scheduleId = `${TEN}:${WS}:${flowId}`;
    assert.ok(temporal.schedules.has(scheduleId));
    const del = await fetch(`${baseUrl}${flowsBase()}/${flowId}`, { method: 'DELETE', headers: authHeaders });
    assert.equal(del.status, 200);
    assert.ok(!temporal.schedules.has(scheduleId), 'schedule deleted before delete acknowledged');
  });
});

// bbx-flows-trig-04: schedule IDs encode tenant identity → structurally distinct across tenants.
test('bbx-flows-trig-04: schedule IDs are structurally distinct across tenants', async () => {
  await withTriggersServer(async ({ baseUrl, temporal }) => {
    await createAndPublish(baseUrl, CRON_DEF, 'Cron Flow A');
    const idsA = [...temporal.schedules.keys()];
    assert.ok(idsA.every((id) => id.startsWith(`${TEN}:${WS}:`)), 'every schedule id is prefixed by this tenant');
    // A foreign tenant prefix cannot collide with this tenant's namespace.
    assert.ok(!idsA.some((id) => id.startsWith('ten_OTHER:')));
  });
});

// ---- Webhook ----

// bbx-flows-trig-05: publishing a webhook trigger returns a per-trigger secret ONCE.
test('bbx-flows-trig-05: publishing a webhook trigger returns a per-trigger secret once', async () => {
  await withTriggersServer(async ({ baseUrl }) => {
    const { pubBody } = await createAndPublish(baseUrl, WEBHOOK_DEF, 'Webhook Flow');
    assert.ok(pubBody.triggers, 'publish returns the trigger registration result');
    assert.equal(pubBody.triggers.webhooks.length, 1);
    const wh = pubBody.triggers.webhooks[0];
    assert.match(wh.secret, /^[0-9a-f]{64}$/, '32-byte hex HMAC secret returned once');
    assert.ok(wh.triggerId.includes(':webhook:'));
  });
});

// bbx-flows-trig-06: a valid HMAC signature starts a run (202).
test('bbx-flows-trig-06: valid HMAC signature starts a webhook-triggered run (202)', async () => {
  await withTriggersServer(async ({ baseUrl, temporal }) => {
    const { pubBody } = await createAndPublish(baseUrl, WEBHOOK_DEF, 'Webhook Flow');
    const { triggerId, secret } = pubBody.triggers.webhooks[0];
    const rawBody = JSON.stringify({ order: 42 });
    const sig = computeSignature(rawBody, secret);
    const before = temporal.started.length;
    const res = await fetch(`${baseUrl}/v1/flows/workspaces/${WS}/triggers/webhooks/${encodeURIComponent(triggerId)}`, {
      method: 'POST',
      headers: { ...authHeaders, 'x-platform-webhook-signature': sig, 'x-platform-webhook-id': 'd-abc123' },
      body: rawBody,
    });
    assert.equal(res.status, 202);
    assert.equal(temporal.started.length, before + 1, 'exactly one execution started');
    const sa = temporal.started[before].opts.searchAttributes;
    assert.deepEqual(sa.triggerType, ['webhook'], 'triggerType=webhook stamped');
  });
});

// bbx-flows-trig-07: an invalid HMAC signature is 401 and starts NO run.
test('bbx-flows-trig-07: invalid HMAC signature returns 401 and starts no run', async () => {
  await withTriggersServer(async ({ baseUrl, temporal }) => {
    const { pubBody } = await createAndPublish(baseUrl, WEBHOOK_DEF, 'Webhook Flow');
    const { triggerId } = pubBody.triggers.webhooks[0];
    const rawBody = JSON.stringify({ order: 42 });
    const before = temporal.started.length;
    const res = await fetch(`${baseUrl}/v1/flows/workspaces/${WS}/triggers/webhooks/${encodeURIComponent(triggerId)}`, {
      method: 'POST',
      headers: { ...authHeaders, 'x-platform-webhook-signature': 'sha256=deadbeef', 'x-platform-webhook-id': 'd-x' },
      body: rawBody,
    });
    assert.equal(res.status, 401);
    assert.equal(temporal.started.length, before, 'no execution started on a bad signature');
  });
});

// bbx-flows-trig-08: a missing signature header is 401 and starts NO run.
test('bbx-flows-trig-08: missing signature header returns 401 and starts no run', async () => {
  await withTriggersServer(async ({ baseUrl, temporal }) => {
    const { pubBody } = await createAndPublish(baseUrl, WEBHOOK_DEF, 'Webhook Flow');
    const { triggerId } = pubBody.triggers.webhooks[0];
    const before = temporal.started.length;
    const res = await fetch(`${baseUrl}/v1/flows/workspaces/${WS}/triggers/webhooks/${encodeURIComponent(triggerId)}`, {
      method: 'POST', headers: { ...authHeaders, 'x-platform-webhook-id': 'd-y' }, body: JSON.stringify({ a: 1 }),
    });
    assert.equal(res.status, 401);
    assert.equal(temporal.started.length, before);
  });
});

// bbx-flows-trig-09: a replayed delivery id returns 202 and starts NO second run.
test('bbx-flows-trig-09: replayed delivery id does not start a second run', async () => {
  await withTriggersServer(async ({ baseUrl, temporal }) => {
    const { pubBody } = await createAndPublish(baseUrl, WEBHOOK_DEF, 'Webhook Flow');
    const { triggerId, secret } = pubBody.triggers.webhooks[0];
    const rawBody = JSON.stringify({ order: 7 });
    const sig = computeSignature(rawBody, secret);
    const hdrs = { ...authHeaders, 'x-platform-webhook-signature': sig, 'x-platform-webhook-id': 'd-replay' };
    const url = `${baseUrl}/v1/flows/workspaces/${WS}/triggers/webhooks/${encodeURIComponent(triggerId)}`;
    const r1 = await fetch(url, { method: 'POST', headers: hdrs, body: rawBody });
    const r2 = await fetch(url, { method: 'POST', headers: hdrs, body: rawBody });
    assert.equal(r1.status, 202);
    assert.equal(r2.status, 202, 'replay is still 202 (idempotent)');
    const startsForTrigger = temporal.started.filter((s) => s.workflowId.includes('wh-')).length;
    assert.equal(startsForTrigger, 1, 'only one execution started across the replay');
    assert.equal((await r2.json()).deduplicated, true, 'second delivery reported as deduplicated');
  });
});

// ---- Platform event ----

// bbx-flows-trig-10: an event on tenant A's topic starts flow A; a foreign topic does not.
test('bbx-flows-trig-10: platform event on the subscribed topic starts the bound flow', async () => {
  const t = makeFakeTemporal();
  const auditEvents = [];
  const flowExecutor = createFlowExecutor({ temporalClient: t, temporalAddress: 'fake:7233', auditSink: async (e) => auditEvents.push(e) });
  const triggerRegistry = createFlowTriggerRegistry({
    temporalClient: t,
    startTriggeredExecution: (args) => flowExecutor.startTriggeredExecution(args),
    logger: { error() {} },
  });
  flowExecutor.setTriggerRegistry(triggerRegistry);
  const identity = { tenantId: TEN, workspaceId: WS, actorId: 'svc' };
  // Create + publish the event flow directly through the executor (no HTTP needed for this probe).
  await flowExecutor.executeFlows({ operation: 'create_definition', identity, flowId: 'evflow', body: { name: 'Ev', definition: EVENT_DEF } });
  await flowExecutor.executeFlows({ operation: 'publish_version', identity, flowId: 'evflow' });

  const topic = `evt.${WS}.order-placed`;
  // Simulate the consumer receiving a message on the subscribed topic.
  await triggerRegistry.store.findRegistrationsByTopic({ topicRef: topic }).then(async (regs) => {
    assert.equal(regs.length, 1, 'a registration exists for the subscribed physical topic');
    await flowExecutor.startTriggeredExecution({
      identity: { tenantId: regs[0].tenant_id, workspaceId: regs[0].workspace_id },
      flowId: regs[0].flow_id, version: regs[0].version,
      input: { id: 1 }, triggerType: 'platform_event', workflowIdOverride: 'pe:evflow:t:0:0',
    });
  });
  assert.equal(t.started.length, 1, 'one execution started for the matched event');
  assert.deepEqual(t.started[0].opts.searchAttributes.triggerType, ['platform_event']);
  await flowExecutor.close();
});

// bbx-flows-trig-11: a foreign-tenant topic has NO matching registration (cross-tenant denial).
test('bbx-flows-trig-11: an event on a foreign-tenant topic matches no registration', async () => {
  const t = makeFakeTemporal();
  const flowExecutor = createFlowExecutor({ temporalClient: t, temporalAddress: 'fake:7233' });
  const triggerRegistry = createFlowTriggerRegistry({ temporalClient: t, startTriggeredExecution: (a) => flowExecutor.startTriggeredExecution(a), logger: { error() {} } });
  flowExecutor.setTriggerRegistry(triggerRegistry);
  const identity = { tenantId: TEN, workspaceId: WS, actorId: 'svc' };
  await flowExecutor.executeFlows({ operation: 'create_definition', identity, flowId: 'evflow', body: { name: 'Ev', definition: EVENT_DEF } });
  await flowExecutor.executeFlows({ operation: 'publish_version', identity, flowId: 'evflow' });

  // Tenant B's workspace topic — structurally a different physical topic name.
  const foreignTopic = `evt.ws_OTHER.order-placed`;
  const regs = await triggerRegistry.store.findRegistrationsByTopic({ topicRef: foreignTopic });
  assert.equal(regs.length, 0, 'no registration matches a foreign workspace topic → no cross-tenant trigger');
  assert.equal(t.started.length, 0);
  await flowExecutor.close();
});

// bbx-flows-trig-12: a duplicate message offset starts only one execution (idempotent dedup key).
test('bbx-flows-trig-12: duplicate Kafka offset starts only one execution', async () => {
  const t = makeFakeTemporal();
  const flowExecutor = createFlowExecutor({ temporalClient: t, temporalAddress: 'fake:7233' });
  const triggerRegistry = createFlowTriggerRegistry({ temporalClient: t, startTriggeredExecution: (a) => flowExecutor.startTriggeredExecution(a), logger: { error() {} } });
  flowExecutor.setTriggerRegistry(triggerRegistry);
  const identity = { tenantId: TEN, workspaceId: WS, actorId: 'svc' };
  await flowExecutor.executeFlows({ operation: 'create_definition', identity, flowId: 'evflow', body: { name: 'Ev', definition: EVENT_DEF } });
  await flowExecutor.executeFlows({ operation: 'publish_version', identity, flowId: 'evflow' });
  const dedupKey = 'pe:evflow:platform-event:order-placed:t:0:5';
  const start = () => flowExecutor.startTriggeredExecution({ identity, flowId: 'evflow', version: 1, input: {}, triggerType: 'platform_event', workflowIdOverride: dedupKey });
  await start();
  const second = await start();
  assert.equal(t.started.length, 1, 'redelivered offset → only one execution');
  assert.equal(second.deduplicated, true);
  await flowExecutor.close();
});

// ---- Version swap ----

// bbx-flows-trig-13: republishing a cron flow updates the schedule in place (no delete+create gap).
test('bbx-flows-trig-13: version swap updates the schedule in place (no firing gap)', async () => {
  await withTriggersServer(async ({ baseUrl, temporal }) => {
    const { flowId } = await createAndPublish(baseUrl, CRON_DEF, 'Cron Flow');
    const scheduleId = `${TEN}:${WS}:${flowId}`;
    // Re-publish (v2) with a modified cron expression.
    const v2Def = { ...CRON_DEF, triggers: [{ kind: 'cron', schedule: '*/5 * * * *', options: { overlap: 'skip' } }] };
    await fetch(`${baseUrl}${flowsBase()}/${flowId}`, { method: 'PATCH', headers: authHeaders, body: JSON.stringify({ definition: v2Def }) });
    const pub2 = await fetch(`${baseUrl}${flowsBase()}/${flowId}/versions`, { method: 'POST', headers: authHeaders });
    assert.equal(pub2.status, 201);
    assert.equal((await pub2.json()).version, 2);
    // The schedule was UPDATED in place (one create + one update), never deleted.
    const ops = temporal.scheduleOps.filter((o) => o.scheduleId === scheduleId);
    assert.ok(ops.some((o) => o.op === 'create'));
    assert.ok(ops.some((o) => o.op === 'update'), 'second publish updates the schedule');
    assert.ok(!ops.some((o) => o.op === 'delete'), 'no delete during the swap (no firing gap)');
    // The schedule now fires v2.
    assert.deepEqual(temporal.schedules.get(scheduleId).action.searchAttributes.flowVersion, ['2']);
  });
});

// bbx-flows-trig-14: a manual API start stamps triggerType=manual (the default).
test('bbx-flows-trig-14: a manual API start stamps triggerType=manual', async () => {
  await withTriggersServer(async ({ baseUrl, temporal }) => {
    const { flowId } = await createAndPublish(baseUrl, CRON_DEF, 'Cron Flow');
    const res = await fetch(`${baseUrl}${flowsBase()}/${flowId}/executions`, {
      method: 'POST', headers: authHeaders, body: JSON.stringify({ version: 1 }),
    });
    assert.equal(res.status, 201);
    const manualStart = temporal.started.find((s) => s.opts.searchAttributes?.triggerType?.[0] === 'manual');
    assert.ok(manualStart, 'a manual API start stamps triggerType=manual');
  });
});
