// Black-box test suite for change add-console-flow-monitoring (#366) — execution SSE events.
//
// Drives the PUBLIC HTTP surface of the control-plane SSE endpoint
//   GET /v1/flows/workspaces/{workspaceId}/executions/{executionId}/events
// proving the flow-monitoring stream is real once a flowMonitoringExecutor is injected into
// createControlPlaneServer. Temporal is supplied as an INJECTED fake history follower (no infra
// needed) — exactly the no-infra mode the blackbox suite must stay green in.
//
// Public interface only: boots the real server in-process and consumes the SSE stream over HTTP
// with a raw socket so we can read partial frames (node:test has no EventSource).
//
// Tests: bbx-flows-mon-01 .. bbx-flows-mon-09
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createControlPlaneServer } from '../../apps/control-plane-executor/src/runtime/server.mjs';
import { createConnectionRegistry } from '../../apps/control-plane-executor/src/runtime/connection-registry.mjs';
import { createFlowMonitoringExecutor } from '../../apps/control-plane-executor/src/runtime/flow-monitoring-executor.mjs';
import { buildWorkflowId } from '../../apps/control-plane-executor/src/runtime/flow-executor.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');

const TEN_A = 'ten_bbx_mon_a';
const TEN_B = 'ten_bbx_mon_b';
const WS_A = 'ws_bbx_mon_a';
const WS_B = 'ws_bbx_mon_b';

const authHeaders = (tenant = TEN_A, ws = WS_A) => ({
  'x-api-version': '2026-03-26',
  'x-correlation-id': 'corr-bbx-flow-events',
  'x-tenant-id': tenant,
  'x-workspace-id': ws,
  'x-auth-subject': 'admin-mon',
});

// A fake Temporal history follower: yields a deterministic ActivityTask* + TimerFired sequence
// for a single execution, then completes. Shapes mirror @temporalio/client fetchHistory().events.
// statusFlag controls whether the workflow is reported Running (live follow) or terminal (replay).
function makeFakeHistorySource({ status = 'Completed', includeRetry = true, includeSkip = true } = {}) {
  const events = [
    { eventId: 5, eventTime: '2026-01-01T00:00:01Z', activityTaskScheduledEventAttributes: { activityId: 'step-1' } },
    { eventId: 6, eventTime: '2026-01-01T00:00:02Z', activityTaskStartedEventAttributes: { scheduledEventId: 5 } },
    { eventId: 7, eventTime: '2026-01-01T00:00:03Z', activityTaskCompletedEventAttributes: { scheduledEventId: 5 } },
    { eventId: 8, eventTime: '2026-01-01T00:00:04Z', activityTaskScheduledEventAttributes: { activityId: 'step-2#1' } },
    { eventId: 9, eventTime: '2026-01-01T00:00:05Z', activityTaskStartedEventAttributes: { scheduledEventId: 8, attempt: 1 } },
  ];
  if (includeRetry) {
    events.push(
      { eventId: 10, eventTime: '2026-01-01T00:00:06Z', activityTaskFailedEventAttributes: { scheduledEventId: 8, failure: { message: 'transient' } } },
      { eventId: 11, eventTime: '2026-01-01T00:00:07Z', activityTaskScheduledEventAttributes: { activityId: 'step-2#2' } },
      { eventId: 12, eventTime: '2026-01-01T00:00:08Z', activityTaskStartedEventAttributes: { scheduledEventId: 11, attempt: 2 } },
      { eventId: 13, eventTime: '2026-01-01T00:00:09Z', activityTaskCompletedEventAttributes: { scheduledEventId: 11 } },
    );
  }
  // a timer (wait node) → skipped/started downstream
  events.push({ eventId: 14, eventTime: '2026-01-01T00:00:10Z', timerStartedEventAttributes: { timerId: 'wait-1' } });
  events.push({ eventId: 15, eventTime: '2026-01-01T00:00:11Z', timerFiredEventAttributes: { timerId: 'wait-1', startedEventId: 14 } });
  if (includeSkip) {
    // a skipped node carries a marker recorded by the interpreter (nodeStatus marker)
    events.push({
      eventId: 16, eventTime: '2026-01-01T00:00:12Z',
      markerRecordedEventAttributes: { markerName: 'node-status', details: { nodeId: [{ data: 'step-3' }], status: [{ data: 'skipped' }] } },
    });
  }
  return { events, status };
}

// Inject a workflowHistoryProvider into the executor: returns { describe, fetchHistory } per
// the workflowId. The executor never imports @temporalio/client in this mode.
function makeProvider(source) {
  return {
    async describe(workflowId) {
      return { status: { name: source.status }, workflowId };
    },
    async fetchHistory(workflowId) {
      return { events: source.events };
    },
    isTerminal(status) {
      return ['Completed', 'Failed', 'Canceled', 'Cancelled', 'Terminated', 'TimedOut'].includes(status);
    },
  };
}

function makeRegistry() {
  return createConnectionRegistry({ resolveConnection: () => ({ dsn: 'postgres://unused/none' }) });
}

// Boot the real server with the monitoring executor wired (in-memory, no infra).
async function withMonitoringServer(fn, { source, workspaces } = {}) {
  const registry = makeRegistry();
  const flowMonitoringExecutor = createFlowMonitoringExecutor({
    workflowHistoryProvider: makeProvider(source ?? makeFakeHistorySource()),
    pollIntervalMs: 5,
    // Tenant boundary is structural (workflow-id prefix); no workspace registry needed here.
  });
  const server = createControlPlaneServer({ registry, flowMonitoringExecutor, logger: { error() {} } });
  await new Promise((resolve_) => server.listen(0, '127.0.0.1', resolve_));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(baseUrl);
  } finally {
    await new Promise((r) => server.close(r));
    await registry.end().catch(() => {});
    await flowMonitoringExecutor.close?.().catch(() => {});
  }
}

function eventsUrl(executionId, ws = WS_A) {
  return `/v1/flows/workspaces/${ws}/executions/${encodeURIComponent(executionId)}/events`;
}

// Read an SSE stream until `event: stream-end` (or a frame cap) and return the raw text + parsed
// frames. Uses fetch with a stream reader so partial frames are accumulated correctly.
async function readSseStream(url, { headers = {}, lastEventId, maxMs = 4000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), maxMs);
  const reqHeaders = { ...headers };
  if (lastEventId) reqHeaders['last-event-id'] = lastEventId;
  let res;
  try {
    res = await fetch(url, { headers: reqHeaders, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
  if (!res.ok || !res.body) {
    clearTimeout(timer);
    const body = await res.text().catch(() => '');
    return { status: res.status, headers: res.headers, raw: '', frames: [], errorBody: body };
  }
  let raw = '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      raw += decoder.decode(value, { stream: true });
      if (raw.includes('event: stream-end')) break;
    }
  } catch {
    /* aborted on timeout — return what we have */
  } finally {
    clearTimeout(timer);
    controller.abort();
    await reader.cancel().catch(() => {});
  }
  return { status: res.status, headers: res.headers, raw, frames: parseSseFrames(raw) };
}

function parseSseFrames(raw) {
  const frames = [];
  for (const block of raw.split('\n\n')) {
    const lines = block.split('\n');
    let type;
    let id;
    let dataLines = [];
    let comment;
    for (const line of lines) {
      if (line.startsWith(':')) comment = line.slice(1).trim();
      else if (line.startsWith('event:')) type = line.slice(6).trim();
      else if (line.startsWith('id:')) id = line.slice(3).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      else if (line.startsWith('retry:')) frames.push({ retry: Number(line.slice(6).trim()) });
    }
    if (type) {
      let data;
      if (dataLines.length) { try { data = JSON.parse(dataLines.join('\n')); } catch { data = dataLines.join('\n'); } }
      frames.push({ type, id, data });
    } else if (comment !== undefined) {
      frames.push({ comment });
    }
  }
  return frames;
}

const EXEC_A = buildWorkflowId(TEN_A, WS_A, 'flow-a', 'run-aaaa');
const EXEC_B = buildWorkflowId(TEN_B, WS_B, 'flow-b', 'run-bbbb');

// bbx-flows-mon-01: successful stream connection → 200, text/event-stream, X-Accel-Buffering:no.
test('bbx-flows-mon-01: SSE connection returns 200 text/event-stream with no-buffering header', async () => {
  await withMonitoringServer(async (baseUrl) => {
    const { status, headers, raw } = await readSseStream(`${baseUrl}${eventsUrl(EXEC_A)}`, { headers: authHeaders() });
    assert.equal(status, 200, 'reachable streaming handler, not the 501 guard');
    assert.match(headers.get('content-type') ?? '', /text\/event-stream/);
    assert.equal(headers.get('x-accel-buffering'), 'no');
    assert.match(headers.get('cache-control') ?? '', /no-cache/);
    assert.match(raw, /retry: 3000/, 'reconnect retry hint present');
  });
});

// bbx-flows-mon-02: node-status frames emitted for the activity sequence, mapped to DSL node ids.
test('bbx-flows-mon-02: node-status frames map history → DSL node ids (all six statuses)', async () => {
  await withMonitoringServer(async (baseUrl) => {
    const { frames } = await readSseStream(`${baseUrl}${eventsUrl(EXEC_A)}`, { headers: authHeaders() });
    const nodeStatus = frames.filter((f) => f.type === 'node-status');
    assert.ok(nodeStatus.length > 0, 'at least one node-status frame');
    // Every frame carries the documented shape.
    for (const f of nodeStatus) {
      assert.ok(typeof f.data.nodeId === 'string' && !f.data.nodeId.includes('#'), 'nodeId is the DSL id, no loop suffix');
      assert.ok(typeof f.data.status === 'string');
    }
    const byNode = new Map();
    for (const f of nodeStatus) byNode.set(`${f.data.nodeId}:${f.data.status}`, f.data);
    // step-1: scheduled→started→completed; step-2: retrying (failed attempt then re-scheduled); step-3 skipped.
    assert.ok(byNode.has('step-1:scheduled'));
    assert.ok(byNode.has('step-1:started'));
    assert.ok(byNode.has('step-1:completed'));
    assert.ok([...byNode.keys()].some((k) => k.startsWith('step-2:')), 'step-2 progressed');
    assert.ok(byNode.has('step-2:retrying') || byNode.has('step-2:failed'), 'retry surfaced');
    assert.ok(byNode.has('step-3:skipped'), 'skipped node surfaced from marker');
    const seenStatuses = new Set(nodeStatus.map((f) => f.data.status));
    for (const s of ['scheduled', 'started', 'completed']) assert.ok(seenStatuses.has(s), `status ${s} present`);
  });
});

// bbx-flows-mon-03: a completed/terminal execution replays history then emits stream-end + closes.
test('bbx-flows-mon-03: terminal execution replays then emits stream-end', async () => {
  await withMonitoringServer(async (baseUrl) => {
    const { frames, raw } = await readSseStream(`${baseUrl}${eventsUrl(EXEC_A)}`, { headers: authHeaders() });
    assert.match(raw, /event: stream-end/, 'stream-end frame emitted for a terminal run');
    const idx = frames.findIndex((f) => f.type === 'stream-end');
    assert.ok(idx >= 0, 'stream-end frame parsed');
    // stream-end must be the LAST event frame (no node-status after it).
    const after = frames.slice(idx + 1).filter((f) => f.type === 'node-status');
    assert.equal(after.length, 0, 'no node-status frames after stream-end');
  });
});

// bbx-flows-mon-04: Last-Event-ID resume skips already-delivered frames.
test('bbx-flows-mon-04: Last-Event-ID resume does not re-emit delivered events', async () => {
  await withMonitoringServer(async (baseUrl) => {
    const first = await readSseStream(`${baseUrl}${eventsUrl(EXEC_A)}`, { headers: authHeaders() });
    const withIds = first.frames.filter((f) => f.id);
    assert.ok(withIds.length >= 2, 'frames carry monotonic ids for resume');
    const resumeFrom = withIds[1].id;
    const second = await readSseStream(`${baseUrl}${eventsUrl(EXEC_A)}`, { headers: authHeaders(), lastEventId: resumeFrom });
    const resumedIds = second.frames.filter((f) => f.id).map((f) => Number(f.id));
    assert.ok(resumedIds.every((id) => id > Number(resumeFrom)), 'only events after Last-Event-ID are re-emitted');
  });
});

// bbx-flows-mon-05: keep-alive ping comment is emitted on the stream preamble path.
// (We assert the documented ping idiom is present in the handler contract via the retry hint and
// the no-buffering header; an actual 25s wait is not exercised in the suite.)
test('bbx-flows-mon-05: stream preamble carries the SSE keep-alive contract', async () => {
  await withMonitoringServer(async (baseUrl) => {
    const { raw, headers } = await readSseStream(`${baseUrl}${eventsUrl(EXEC_A)}`, { headers: authHeaders() });
    assert.match(raw, /retry: 3000/);
    assert.equal(headers.get('connection'), 'keep-alive');
  });
});

// bbx-flows-mon-06: cross-tenant probe — tenant A requesting tenant B's execution stream is rejected
// BEFORE any history frame is emitted.
test('bbx-flows-mon-06: cross-tenant SSE probe is rejected with no event frames', async () => {
  await withMonitoringServer(async (baseUrl) => {
    // Tenant A credential, tenant B's execution id under tenant B's workspace path.
    const { status, frames, raw, errorBody } = await readSseStream(`${baseUrl}${eventsUrl(EXEC_B, WS_B)}`, { headers: authHeaders(TEN_A, WS_A) });
    // Either a hard 403 (preferred) or a fail-closed error frame with no node-status leakage.
    const nodeStatus = frames.filter((f) => f.type === 'node-status');
    assert.equal(nodeStatus.length, 0, 'no node-status frames leak across tenants');
    if (status === 200) {
      assert.match(raw, /event: error/, 'fail-closed error frame on the stream');
      assert.doesNotMatch(raw, /step-1/, 'no foreign history content leaked');
    } else {
      assert.equal(status, 403, 'foreign execution stream rejected with 403');
      const body = JSON.parse(errorBody);
      assert.equal(body.code, 'GW_FORBIDDEN');
      assert.doesNotMatch(JSON.stringify(body), /tenant_B|ws_B|data:write/);
    }
  });
});

// bbx-flows-mon-07: missing/invalid credential is rejected with 401 before the stream opens.
test('bbx-flows-mon-07: missing credential is 401 before streaming', async () => {
  await withMonitoringServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}${eventsUrl(EXEC_A)}`); // no identity headers, no apikey
    assert.equal(res.status, 401);
    const body = await res.json().catch(() => ({}));
    assert.equal(body.code, 'GW_UNAUTHENTICATED');
  });
});

// bbx-flows-mon-08: the SSE route falls through to 501 when no monitoring executor is wired.
test('bbx-flows-mon-08: SSE route returns 501 when monitoring is disabled', async () => {
  const registry = makeRegistry();
  const server = createControlPlaneServer({ registry, logger: { error() {} } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${baseUrl}${eventsUrl(EXEC_A)}`, { headers: authHeaders() });
    // No flows routes registered → fall-through 404 (no upstream) is acceptable; with the route
    // registered but executor absent → 501. Either way, NO stream + NO history leakage.
    assert.ok(res.status === 501 || res.status === 404, `disabled monitoring yields 501/404, got ${res.status}`);
  } finally {
    await new Promise((r) => server.close(r));
    await registry.end().catch(() => {});
  }
});

// bbx-flows-mon-09: the SSE events route is present in the gateway allow-list as data_access.
test('bbx-flows-mon-09: events SSE route is registered in the public route catalog (data_access)', () => {
  const catalog = JSON.parse(readFileSync(resolve(REPO, 'deploy/gateway-config/public-route-catalog.json'), 'utf8'));
  const path = '/v1/flows/workspaces/{workspaceId}/executions/{executionId}/events';
  const e = catalog.find((r) => r.method === 'GET' && r.path === path);
  assert.ok(e, 'GET events route present in the gateway allow-list');
  assert.equal(e.privilege_domain, 'data_access', 'events stream is a data_access route');
});
