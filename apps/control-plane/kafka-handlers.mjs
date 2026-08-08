// Console Events/Kafka handlers — REAL Kafka (kind deploy).
//
// Kafka runs as `falcone-kafka:9092` (KRaft, single broker, PLAINTEXT — no auth).
// The web-console Kafka page browses a workspace's topic inventory, topic detail,
// access policy, live metadata, publishes test events, polls messages, and streams
// a live consume (SSE). We use `kafkajs` (added to the image). Topics are
// addressed by a stable `resourceId` mapped to the physical Kafka topic via
// `workspace_topics` (provisioned through this control plane). ACLs: the broker
// has no authorizer configured, so the access policy is reported as
// empty/native-unsupported (honest).
import { randomUUID } from 'node:crypto';
import { Kafka, logLevel } from 'kafkajs';
import * as store from './tenant-store.mjs';
import { resolveKafkaSecurity } from './transport-security.mjs';
import { callerTenantScope, canManageTenant } from './tenant-scope.mjs';

const BROKERS = (process.env.KAFKA_BROKERS || 'falcone-kafka:9092').split(',').map((s) => s.trim());
const ok = (statusCode, body) => ({ statusCode, body });
const err = (statusCode, code, message) => ({ statusCode, body: { code, message } });
const nowIso = () => new Date().toISOString();
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 200);
const safeParse = (s) => { try { return JSON.parse(s); } catch { return s; } };
const staleMetadataCodes = new Set([3, 5, 6]);
const staleMetadataPatterns = [
  /UNKNOWN_TOPIC_OR_PARTITION/i,
  /LEADER_NOT_AVAILABLE/i,
  /NOT_LEADER_FOR_PARTITION/i,
  /KAFKAJS_METADATA_NOT_LOADED/i,
  /does not host this topic-partition/i,
  /not leader for partition/i,
  /leader.*not available/i,
  /metadata.*not.*loaded/i,
  /metadata.*stale/i,
  /stale.*metadata/i
];
const topicAlreadyExistsPatterns = [
  /TOPIC_ALREADY_EXISTS/i,
  /topic.*already exists/i,
  /already exists.*topic/i
];

// Physical Kafka topic name for a workspace's logical topic. Derived from the
// GLOBALLY-UNIQUE workspace id — NOT the per-tenant `slug`, which is not unique
// across tenants and made two same-slug workspaces collide on one physical topic
// (P1 ISO-EVENTS: first tenant's `workspace_topics` row hijacked, second tenant
// locked out). This matches the executor data-plane (`events-executor.mjs` ->
// `evt.<workspaceId>.<topic>`) so the JWT (control-plane) and apiKey (executor)
// paths resolve to the SAME physical topic.
export function physicalTopicName(workspaceId, topicName) {
  return `evt.${workspaceId}.${topicName}`;
}

function defaultKafkaFactory() {
  return new Kafka({ clientId: 'in-falcone-console', brokers: BROKERS, logLevel: logLevel.NOTHING, retry: { retries: 3 }, ...resolveKafkaSecurity() });
}

let kafka = null;
let kafkaFactory = defaultKafkaFactory;
let storeApi = store;

function getKafka() {
  if (!kafka) kafka = kafkaFactory();
  return kafka;
}
let adminP = null, producerP = null;
async function admin() {
  if (!adminP) { const a = getKafka().admin(); adminP = a.connect().then(() => a).catch((e) => { adminP = null; throw e; }); }
  return adminP;
}

// Strict configuration adapter for the C-08 Kafka metrics projection.  Unlike the
// console detail endpoint's best-effort metadata, callers of this adapter need real
// retention/compaction values to satisfy the public metrics contract; dependency errors
// therefore propagate and are rendered as an explicit 503 by the C-08 handler.
export async function describeTopicConfigsStrict(physicalTopicNames, { adminClient = null } = {}) {
  const names = [...new Set((physicalTopicNames ?? []).filter(Boolean).map(String))];
  if (names.length === 0) return new Map();
  const client = adminClient ?? await admin();
  const described = await client.describeConfigs({
    resources: names.map((name) => ({ type: 2, name })),
    includeSynonyms: false
  });
  const byName = new Map();
  for (const resource of described?.resources ?? []) {
    const entries = new Map((resource.configEntries ?? []).map((entry) => [entry.configName, entry.configValue]));
    const retentionMs = Number(entries.get('retention.ms'));
    const cleanupPolicy = String(entries.get('cleanup.policy') ?? '');
    if (!Number.isFinite(retentionMs) || retentionMs < 0 || !cleanupPolicy) {
      throw Object.assign(new Error(`Kafka config incomplete for ${resource.resourceName}`), {
        code: 'KAFKA_TOPIC_CONFIG_INCOMPLETE'
      });
    }
    byName.set(resource.resourceName, {
      retentionHours: Math.floor(retentionMs / 3_600_000),
      compactionEnabled: cleanupPolicy.split(',').map((value) => value.trim()).includes('compact')
    });
  }
  for (const name of names) {
    if (!byName.has(name)) throw Object.assign(new Error(`Kafka config missing for ${name}`), { code: 'KAFKA_TOPIC_CONFIG_MISSING' });
  }
  return byName;
}
async function producer() {
  if (!producerP) { const p = getKafka().producer(); producerP = p.connect().then(() => p).catch((e) => { producerP = null; throw e; }); }
  return producerP;
}

function getStore() {
  return storeApi;
}

function errorValues(e) {
  if (!e || typeof e !== 'object') return [e];
  return [e.name, e.type, e.code, e.errorCode, e.message, String(e)];
}

function matchesError(e, patterns, seen = new Set()) {
  if (e == null) return false;
  if (typeof e === 'object') {
    if (seen.has(e)) return false;
    seen.add(e);
    for (const value of errorValues(e)) {
      if (value != null && patterns.some((pattern) => pattern.test(String(value)))) return true;
    }
    for (const nested of [e.cause, e.originalError, e.error]) {
      if (matchesError(nested, patterns, seen)) return true;
    }
    if (Array.isArray(e.errors) && e.errors.some((nested) => matchesError(nested, patterns, seen))) return true;
    return false;
  }
  return patterns.some((pattern) => pattern.test(String(e)));
}

export function isStaleKafkaMetadataError(e, seen = new Set()) {
  if (e == null) return false;
  if (typeof e === 'object') {
    if (seen.has(e)) return false;
    seen.add(e);
    const code = Number(e.code ?? e.errorCode);
    if (staleMetadataCodes.has(code)) return true;
    if (errorValues(e).some((value) => value != null && staleMetadataPatterns.some((pattern) => pattern.test(String(value))))) return true;
    for (const nested of [e.cause, e.originalError, e.error]) {
      if (isStaleKafkaMetadataError(nested, seen)) return true;
    }
    if (Array.isArray(e.errors) && e.errors.some((nested) => isStaleKafkaMetadataError(nested, seen))) return true;
    return false;
  }
  return staleMetadataPatterns.some((pattern) => pattern.test(String(e)));
}

function isTopicAlreadyExistsError(e) {
  return matchesError(e, topicAlreadyExistsPatterns);
}

async function resetAdminClient() {
  const cached = adminP;
  adminP = null;
  if (!cached) return;
  try { await (await cached).disconnect(); } catch { /* ignore reconnect cleanup */ }
}

async function resetProducerClient() {
  const cached = producerP;
  producerP = null;
  if (!cached) return;
  try { await (await cached).disconnect(); } catch { /* ignore reconnect cleanup */ }
}

async function withStaleMetadataRecovery(getClient, resetClient, operation, options = {}) {
  try {
    return await operation(await getClient());
  } catch (e) {
    if (!isStaleKafkaMetadataError(e)) throw e;
    await resetClient();
    try {
      return await operation(await getClient());
    } catch (retryError) {
      if (options.treatTopicAlreadyExistsAfterRecoveryAsSuccess && isTopicAlreadyExistsError(retryError)) return false;
      throw retryError;
    }
  }
}

export async function __setKafkaHandlersTestHooks({ kafka: kafkaOverride, kafkaFactory: nextKafkaFactory, store: storeOverride } = {}) {
  await resetProducerClient();
  await resetAdminClient();
  kafka = null;
  kafkaFactory = nextKafkaFactory ?? (kafkaOverride ? () => kafkaOverride : defaultKafkaFactory);
  storeApi = storeOverride ? { ...store, ...storeOverride } : store;
}

export async function __resetKafkaHandlersTestHooks() {
  await resetProducerClient();
  await resetAdminClient();
  kafka = null;
  kafkaFactory = defaultKafkaFactory;
  storeApi = store;
}

// Best-effort physical topic teardown for tenant purge (#501). Missing topics are ignored.
export async function deleteTopics(physicalNames) {
  const topics = (physicalNames ?? []).filter(Boolean);
  if (topics.length === 0) return;
  const a = await admin();
  try { await a.deleteTopics({ topics }); } catch (e) { if (!/UNKNOWN_TOPIC_OR_PARTITION|does not exist/i.test(String(e.message ?? e))) throw e; }
}

// Resolve a workspace and enforce that the caller's verified tenant owns it.
// Platform callers (scope null = superadmin/internal) may reach any workspace;
// a cross-tenant id is reported as 404 (no existence leak), mirroring the
// executor's workspace-ownership guard.
async function resolveOwnedWorkspace(ctx) {
  const ws = await getStore().getWorkspace(ctx.pool, ctx.params.workspaceId);
  if (!ws) return { error: err(404, 'WORKSPACE_NOT_FOUND', `workspace ${ctx.params.workspaceId} not found`) };
  const scope = callerTenantScope(ctx.identity);
  if (scope != null && ws.tenant_id !== scope) return { error: err(404, 'WORKSPACE_NOT_FOUND', `workspace ${ctx.params.workspaceId} not found`) };
  return { ws };
}

function topicResponseRecord(t) {
  return {
    topic: t.topic_name,
    partitions: t.partitions,
    resourceId: t.id,
    topicName: t.topic_name
  };
}

function decodeRouteParam(value) {
  try { return decodeURIComponent(String(value ?? '')); } catch { return String(value ?? ''); }
}

async function resolveWorkspaceTopic(ctx) {
  const rw = await resolveOwnedWorkspace(ctx); if (rw.error) return rw;
  const topicName = slug(decodeRouteParam(ctx.params.topic));
  if (!topicName) return { error: err(404, 'TOPIC_NOT_FOUND', 'topic not found') };
  const topics = await getStore().listTopicsForWorkspace(ctx.pool, rw.ws.id);
  const t = topics.find((row) => row.topic_name === topicName);
  if (!t) return { error: err(404, 'TOPIC_NOT_FOUND', `topic ${topicName} not found`) };
  return { ws: rw.ws, t };
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(Object(obj), key);
}

function publishValueFromBody(body = {}) {
  if (hasOwn(body, 'payload')) {
    const payload = body.payload;
    return typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
  }
  if (hasOwn(body, 'value')) {
    const value = body.value;
    return typeof value === 'string' ? value : JSON.stringify(value ?? {});
  }
  return JSON.stringify({});
}

async function publishToTopicRecord(ctx, t) {
  if (!canManageTenant(ctx.identity, t.tenant_id)) {
    return err(403, 'FORBIDDEN', 'requires superadmin or tenant owner/admin');
  }
  const body = ctx.body ?? {};
  const value = publishValueFromBody(body);
  try {
    const headers = {};
    if (body.eventType) headers.eventType = String(body.eventType);
    if (body.contentType) headers.contentType = String(body.contentType);
    const res = await withStaleMetadataRecovery(
      producer,
      resetProducerClient,
      (p) => p.send({ topic: t.physical_topic_name, messages: [{ key: body.key != null && body.key !== '' ? String(body.key) : null, value, headers }] })
    );
    const md = res[0] ?? {};
    const partition = md.partition ?? 0;
    const offset = md.baseOffset ?? md.offset;
    return ok(202, {
      publicationId: `pub_${randomUUID().slice(0, 12)}`, status: 'accepted', acceptedAt: nowIso(),
      topicName: t.topic_name, topic: t.topic_name, acceptedPartition: partition, partition, offset, key: body.key,
      payloadSizeBytes: Buffer.byteLength(value), deliverySemantics: 'at_least_once', correlationId: randomUUID()
    });
  } catch (e) {
    return err(502, 'PUBLISH_FAILED', String(e.message ?? e));
  }
}

function boundedNumber(value, fallback, { min = 1, max = 100 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

async function consumeTopicMessages(t, { maxMessages = 10, timeoutMs = 3000 } = {}) {
  const consumer = getKafka().consumer({ groupId: `console-messages-${randomUUID().slice(0, 8)}` });
  const limit = boundedNumber(maxMessages, 10, { min: 1, max: 100 });
  const timeout = boundedNumber(timeoutMs, 3000, { min: 100, max: 30000 });
  const items = [];
  let runError = null;
  try {
    await consumer.connect();
    await consumer.subscribe({ topic: t.physical_topic_name, fromBeginning: true });
    await new Promise((resolve) => {
      let done = false;
      let timer = null;
      const finish = () => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        resolve();
      };
      timer = setTimeout(finish, timeout);
      Promise.resolve(consumer.run({
        eachMessage: async ({ message, partition }) => {
          if (done) return;
          items.push({
            key: message.key?.toString() ?? null,
            value: safeParse(message.value?.toString() ?? ''),
            partition,
            offset: message.offset,
            timestamp: message.timestamp
          });
          if (items.length >= limit) finish();
        }
      })).catch((e) => { runError = e; finish(); });
    });
    if (runError) throw runError;
    return items.slice(0, limit);
  } finally {
    try { await consumer.disconnect(); } catch { /* ignore */ }
  }
}

// GET /v1/events/workspaces/{workspaceId}/topics
async function eventsListTopics(ctx) {
  const rw = await resolveOwnedWorkspace(ctx); if (rw.error) return rw.error;
  const topics = await getStore().listTopicsForWorkspace(ctx.pool, rw.ws.id);
  return ok(200, { items: topics.map(topicResponseRecord) });
}

// GET /v1/events/workspaces/{workspaceId}/inventory
async function eventsInventory(ctx) {
  const r = await resolveOwnedWorkspace(ctx); if (r.error) return r.error;
  const workspaceId = ctx.params.workspaceId;
  const topics = await getStore().listTopicsForWorkspace(ctx.pool, workspaceId);
  let byName = {};
  if (topics.length) {
    try {
      const a = await admin();
      const meta = await a.fetchTopicMetadata({ topics: topics.map((t) => t.physical_topic_name) });
      byName = Object.fromEntries(meta.topics.map((t) => [t.name, t]));
    } catch { /* metadata best-effort */ }
  }
  const items = topics.map((t) => ({
    resourceId: t.id, topicName: t.topic_name, physicalTopicName: t.physical_topic_name, status: 'active',
    provisioning: { state: 'active' }, cleanupPolicy: 'delete',
    partitionCount: byName[t.physical_topic_name]?.partitions?.length ?? t.partitions, retentionHours: 168
  }));
  return ok(200, {
    workspaceId, tenantId: topics[0]?.tenant_id ?? null, brokerMode: 'shared', isolationMode: 'prefix',
    items, counts: { total: items.length, active: items.length, provisioning: 0, degraded: 0, topics: items.length },
    namingPolicy: { topicPrefix: 'evt.', topicNameGovernance: 'managed' },
    tenantIsolation: { mode: 'prefix', crossTenantAccessPrevented: true }, observedAt: nowIso(), snapshotId: randomUUID()
  });
}

// POST /v1/events/workspaces/{workspaceId}/topics  — provision a real topic + map.
async function eventsProvisionTopic(ctx) {
  const rw = await resolveOwnedWorkspace(ctx); if (rw.error) return rw.error;
  const ws = rw.ws;
  if (!canManageTenant(ctx.identity, ws.tenant_id)) {
    return err(403, 'FORBIDDEN', 'requires superadmin or tenant owner/admin');
  }
  const topicName = slug(ctx.body?.name);
  if (!topicName) return err(400, 'VALIDATION_ERROR', 'topic name is required');
  const partitions = Number(ctx.body?.partitions ?? 1) || 1;
  const physical = physicalTopicName(ws.id, topicName);
  const resourceId = `res_topic_${randomUUID().slice(0, 8)}`;
  try {
    await withStaleMetadataRecovery(
      admin,
      resetAdminClient,
      (a) => a.createTopics({ topics: [{ topic: physical, numPartitions: partitions, replicationFactor: 1 }], waitForLeaders: true }),
      { treatTopicAlreadyExistsAfterRecoveryAsSuccess: true }
    );
    const rec = await getStore().insertTopic(ctx.pool, { id: resourceId, workspaceId: ws.id, tenantId: ws.tenant_id, topicName, physicalTopicName: physical, partitions });
    return ok(201, { resourceId: rec.id, topic: rec.topic_name, topicName: rec.topic_name, physicalTopicName: rec.physical_topic_name, partitionCount: partitions, partitions, status: 'active' });
  } catch (e) {
    return err(e.statusCode && e.statusCode < 500 ? e.statusCode : 502, 'TOPIC_PROVISION_FAILED', String(e.message ?? e));
  }
}

async function resolveTopic(ctx) {
  const t = await getStore().getTopicByResourceId(ctx.pool, ctx.params.topicId);
  if (!t) return { error: err(404, 'TOPIC_NOT_FOUND', `topic ${ctx.params.topicId} not found`) };
  // Enforce the caller's verified tenant owns the topic. A cross-tenant resource
  // id resolves to 404 (no existence leak) — closing the Events/Kafka IDOR where
  // a tenant could read/publish/consume another tenant's topic (P0 ISO-EVENTS).
  const scope = callerTenantScope(ctx.identity);
  if (scope != null && t.tenant_id !== scope) return { error: err(404, 'TOPIC_NOT_FOUND', `topic ${ctx.params.topicId} not found`) };
  return { t };
}

// GET /v1/events/topics/{resourceId}
async function eventsTopicDetail(ctx) {
  const r = await resolveTopic(ctx); if (r.error) return r.error;
  const t = r.t;
  let partitionCount = t.partitions, replicationFactor = 1, retentionHours = 168, cleanupPolicy = 'delete';
  try {
    const a = await admin();
    const meta = await a.fetchTopicMetadata({ topics: [t.physical_topic_name] });
    const tm = meta.topics[0];
    if (tm) { partitionCount = tm.partitions.length; replicationFactor = tm.partitions[0]?.replicas?.length ?? 1; }
    const cfg = await a.describeConfigs({ resources: [{ type: 2, name: t.physical_topic_name }], includeSynonyms: false });
    const entries = cfg.resources[0]?.configEntries ?? [];
    const ret = entries.find((e) => e.configName === 'retention.ms');
    const cp = entries.find((e) => e.configName === 'cleanup.policy');
    if (ret && Number(ret.configValue) > 0) retentionHours = Math.round(Number(ret.configValue) / 3600000);
    if (cp) cleanupPolicy = cp.configValue;
  } catch { /* best-effort */ }
  return ok(200, {
    resourceId: t.id, topicName: t.topic_name, physicalTopicName: t.physical_topic_name,
    partitionCount, replicationFactor, retentionHours, cleanupPolicy, deliverySemantics: 'at_least_once',
    status: 'active', allowedTransports: ['kafka'], provisioning: { state: 'active' },
    timestamps: { createdAt: t.created_at }, tenantId: t.tenant_id, workspaceId: t.workspace_id
  });
}

// GET /v1/events/topics/{resourceId}/access
async function eventsTopicAccess(ctx) {
  const r = await resolveTopic(ctx); if (r.error) return r.error;
  return ok(200, {
    resourceId: r.t.id, topicName: r.t.topic_name, physicalTopicName: r.t.physical_topic_name,
    aclBindings: [], auditMode: 'disabled',
    providerCompatibility: { provider: 'kafka', nativeAclSupport: false, managedPrincipals: false }
  });
}

// GET /v1/events/topics/{resourceId}/metadata
async function eventsTopicMetadata(ctx) {
  const r = await resolveTopic(ctx); if (r.error) return r.error;
  const t = r.t;
  const partitionMetadata = {};
  try {
    const a = await admin();
    const meta = await a.fetchTopicMetadata({ topics: [t.physical_topic_name] });
    const offsets = await a.fetchTopicOffsets(t.physical_topic_name);
    const offByP = Object.fromEntries(offsets.map((o) => [String(o.partition), o]));
    for (const p of meta.topics[0]?.partitions ?? []) {
      const o = offByP[String(p.partitionId)];
      partitionMetadata[String(p.partitionId)] = {
        logStartOffset: o ? Number(o.low) : undefined, logEndOffset: o ? Number(o.high) : undefined,
        replicaCount: p.replicas?.length, leader: p.leader, inSync: (p.isr?.length ?? 0) >= (p.replicas?.length ?? 1)
      };
    }
  } catch { /* best-effort */ }
  return ok(200, {
    resourceId: t.id, sampledAt: nowIso(), partitionMetadata,
    retention: { retentionHours: 168, effectivePolicy: 'delete', available: true },
    compaction: { enabled: false, cleanupPolicy: 'delete', available: true }
  });
}

// POST /v1/events/topics/{resourceId}/publish
async function eventsTopicPublish(ctx) {
  const r = await resolveTopic(ctx); if (r.error) return r.error;
  return publishToTopicRecord(ctx, r.t);
}

// POST /v1/events/workspaces/{workspaceId}/topics/{topic}/publish
async function eventsWorkspaceTopicPublish(ctx) {
  const r = await resolveWorkspaceTopic(ctx); if (r.error) return r.error;
  return publishToTopicRecord(ctx, r.t);
}

// GET /v1/events/workspaces/{workspaceId}/topics/{topic}/messages
async function eventsWorkspaceTopicMessages(ctx) {
  const r = await resolveWorkspaceTopic(ctx); if (r.error) return r.error;
  try {
    const items = await consumeTopicMessages(r.t, {
      maxMessages: ctx.query?.maxMessages,
      timeoutMs: ctx.query?.timeoutMs
    });
    return ok(200, { items });
  } catch (e) {
    return err(502, 'CONSUME_FAILED', String(e.message ?? e));
  }
}

// GET /v1/events/topics/{resourceId}/stream  (SSE — owns the response)
async function eventsTopicStream(ctx, res) {
  const t = await getStore().getTopicByResourceId(ctx.pool, ctx.params.topicId);
  // Same tenant boundary as resolveTopic — a cross-tenant id must not open an SSE
  // consumer onto another tenant's topic (P0 ISO-EVENTS).
  const scope = callerTenantScope(ctx.identity);
  if (!t || (scope != null && t.tenant_id !== scope)) {
    return ctx.sendJson(404, { code: 'TOPIC_NOT_FOUND', message: 'Topic not found' }, ctx.cors ?? {});
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', ...(ctx.cors ?? {}) });
  res.write(': connected\n\n');
  const consumer = getKafka().consumer({ groupId: `console-stream-${randomUUID().slice(0, 8)}` });
  let closed = false;
  const heartbeat = setInterval(() => { if (!closed) res.write(': ping\n\n'); }, 15000);
  const cleanup = async () => {
    if (closed) return; closed = true; clearInterval(heartbeat);
    try { await consumer.disconnect(); } catch { /* ignore */ }
    try { res.end(); } catch { /* ignore */ }
  };
  ctx.req.on('close', cleanup);
  try {
    await consumer.connect();
    await consumer.subscribe({ topic: t.physical_topic_name, fromBeginning: true });
    await consumer.run({
      eachMessage: async ({ message, partition }) => {
        if (closed) return;
        const ev = {
          key: message.key?.toString() ?? null,
          eventType: message.headers?.eventType?.toString(),
          payload: safeParse(message.value?.toString() ?? ''),
          partition, offset: message.offset, timestamp: message.timestamp
        };
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
      }
    });
  } catch (e) {
    if (!closed) res.write(`data: ${JSON.stringify({ error: String(e.message ?? e) })}\n\n`);
    await cleanup();
  }
}

export const KAFKA_HANDLERS = {
  eventsInventory, eventsListTopics, eventsProvisionTopic, eventsTopicDetail, eventsTopicAccess, eventsTopicMetadata,
  eventsTopicPublish, eventsWorkspaceTopicPublish, eventsWorkspaceTopicMessages, eventsTopicStream
};
