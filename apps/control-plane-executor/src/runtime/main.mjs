// Control-plane service entrypoint (container CMD).
//
// Wires the connection registry + HTTP server and listens. Phase 0 uses a shared-database
// connection strategy: every workspace resolves to the configured data DSN, queried as the
// non-superuser application role (per-workspace DSNs from the data-plane provisioner are the
// tracked follow-up in add-workspace-db-connection-registry). Connection details come from
// the environment so no secrets are baked into the image.
import pg from 'pg';
import { createConnectionRegistry } from './connection-registry.mjs';
import { createWorkspaceDsnResolver, createWorkspaceTenantResolver } from './workspace-dsn-resolver.mjs';
import { createControlPlaneServer } from './server.mjs';
import { createApiKeyStore } from './api-keys.mjs';
import { createMongoExecutor } from './mongo-data-executor.mjs';
import { createRealtimeExecutor } from './realtime-executor.mjs';
import { createPostgresRealtimeExecutor } from './postgres-realtime-executor.mjs';
import { createEventsExecutor } from './events-executor.mjs';
import { createFunctionsExecutor } from './functions-executor.mjs';
import { createEmbeddingProviderStore, createEmbeddingExecutor, createEmbeddingMappingStore } from './embedding-executor.mjs';
import { createLlmExecutor, createLlmProviderStore, createLlmUsageStore } from './llm-executor.mjs';
import { parseAllowedSecretPrefixes } from './byok-provider-guard.mjs';
import { createFlowExecutor, createFlowStore } from './flow-executor.mjs';
import { createFlowMonitoringExecutor, createTemporalHistoryProvider } from './flow-monitoring-executor.mjs';
import { wireFlowTriggers, createTriggerStore } from './flow-trigger-registry.mjs';
import { createFlowQuotaGate } from './flow-quota-gate.mjs';
import { createJwtVerifier, deriveRealmTopology } from './jwt-verify.mjs';
import { createSaRevocationCheck } from './sa-revocation.mjs';
import { createMcpEngine } from './mcp-engine.mjs';
import { createMcpPostgresStore } from './mcp-pg-store.mjs';
import { createMcpRuntimeCleaner } from './mcp-runtime-cleaner.mjs';
import { createMcpRuntimeAdapter } from './mcp-runtime-adapter.mjs';
import { recordAuditEvent } from '../../../../apps/control-plane/audit-store.mjs';
import { createKnativeRuntimeSource } from '../../../../apps/control-plane/knative-runtime.mjs';
import { createRuntimeCleanupRepository, recoverMcpCleanupObligations } from '../../../../apps/control-plane/runtime-cleanup-repository.mjs';
import { withPostgresSsl, resolveKafkaSecurity } from '../../../../packages/internal-contracts/src/transport-security.mjs';
// Temporal-FREE list of first-party task-type names (add-flows-activity-catalog / #360).
// Feeds the flows validate/publish endpoints' FLW-E006 check so a flow definition that
// references an unknown taskType is rejected (422 FLOW_VALIDATION_FAILED). The full activity
// registry (with @temporalio/activity) lives in the worker; only the names cross here.
import { TASK_TYPE_NAMES } from '../../../../apps/workflow-worker/src/activities/catalog-names.mjs';

const { Pool } = pg;
const PORT = Number(process.env.PORT ?? 8080);

function mongoUri() {
  if (process.env.MONGO_URI) return process.env.MONGO_URI;
  const host = process.env.MONGO_HOST;
  if (!host) return undefined; // Mongo disabled when no URI/host configured
  const auth = process.env.MONGO_USER ? `${process.env.MONGO_USER}:${process.env.MONGO_PASSWORD ?? ''}@` : '';
  // When authenticating, default the auth db to admin (where root users live, e.g. Bitnami);
  // override with MONGO_AUTH_SOURCE.
  const authSource = process.env.MONGO_USER ? `/?authSource=${process.env.MONGO_AUTH_SOURCE ?? 'admin'}` : '';
  return `mongodb://${auth}${host}${authSource}`;
}

function dataDsn() {
  if (process.env.DATA_DB_URL) return process.env.DATA_DB_URL;
  if (process.env.DB_URL) return process.env.DB_URL;
  const user = process.env.PGUSER ?? 'falcone_app';
  const pw = process.env.PGPASSWORD ?? '';
  const host = process.env.PGHOST ?? 'localhost';
  const port = process.env.PGPORT ?? '5432';
  const db = process.env.PGDATABASE ?? 'falcone';
  const auth = pw ? `${user}:${pw}` : user;
  return `postgres://${auth}@${host}:${port}/${db}`;
}

const dsn = dataDsn();

// Control-plane metadata pool (workspace_databases registry, api keys, embedding config, ...).
// Defaults to the data DSN when CONTROL_DB_URL is unset (the kind deploy shares in_falcone).
// Defined here (ahead of the registry) because per-workspace DSN routing reads the registry.
const keyPool = new Pool(withPostgresSsl({ connectionString: process.env.CONTROL_DB_URL ?? dsn, max: 4 }));

// Route each data-plane connection to the requesting workspace's own provisioned database
// (fix-workspace-db-provisioning-saga, #502); falls back to the shared DSN when a workspace has
// no database yet. See workspace-dsn-resolver.mjs for the rationale (credential/role topology).
const resolveConnection = createWorkspaceDsnResolver({ pool: keyPool, baseDsn: dsn });
const registry = createConnectionRegistry({ resolveConnection });

// Workspace → owning-tenant resolver (fix-executor-apikey-cross-tenant-idor, #517): lets the
// request dispatch reject cross-tenant access to a workspace (e.g. minting an api-key in another
// tenant's workspace). Reads workspace_databases.tenant_id on the same metadata pool.
const resolveWorkspaceTenant = createWorkspaceTenantResolver({ pool: keyPool });

// Postgres realtime executor (trigger + LISTEN/NOTIFY; needs a connection that can create
// the capture trigger — the executor's role is a superuser in the data plane).
const pgRealtimeExecutor = createPostgresRealtimeExecutor({ resolveConnection });

// API-key store on the control-plane metadata DB (keyPool defined above for DSN routing).
const apiKeyStore = createApiKeyStore({ pool: keyPool });

// BYOK provider secret confinement (#659). The resolved secret is read ONLY from an env var
// whose name carries an operator-controlled reserved prefix (BYOK_SECRET_ALLOWED_PREFIXES,
// default `BYOK_`), and the provider endpoint is validated against an SSRF guard — both at
// config-deploy time and at request time. Parsed once and passed into BOTH BYOK executors so
// each defaults its own confined secretResolver and the deploy-time validation is active.
const byokSecretPrefixes = parseAllowedSecretPrefixes(process.env);

// Embedding-provider executor (in-platform embedding for KNN queryText). The provider
// store is Postgres-backed on the SAME metadata pool as the API-key store, so provider
// configuration survives a restart and is shared across all control-plane replicas.
// The executor DEFAULTS a confined secretResolver from byokSecretPrefixes: ESO/Vault mounts the
// resolved key as an env var named by secretRef.name, but ONLY an allow-listed name is ever read
// (no plaintext is persisted; a non-allow-listed name fails closed).
const embeddingStore = createEmbeddingProviderStore({ pool: keyPool });
const embeddingExecutor = createEmbeddingExecutor({
  store: embeddingStore,
  secretPrefixes: byokSecretPrefixes,
});

// Per-collection embedding mapping store (write-time auto-embedding). Postgres-backed on the
// SAME metadata pool as the API-key + provider stores, so mapping configuration survives a
// restart and is shared across all control-plane replicas. keyPool.end() in shutdown() covers it.
const mappingStore = createEmbeddingMappingStore({ pool: keyPool });

// BYOK LLM completion plane (change: add-llm-agent-flow-task / #640). Provider config + per-tenant
// token-usage metering are Postgres-backed on the SAME metadata pool. The executor DEFAULTS a
// confined secretResolver from byokSecretPrefixes (mirrors the embedding executor): the resolved
// key is read fresh per completion (rotation is live) but ONLY from an allow-listed env-var name,
// and the endpoint is SSRF-validated at config-deploy + request time (#659).
const llmProviderStore = createLlmProviderStore({ pool: keyPool });
const llmUsageStore = createLlmUsageStore({ pool: keyPool });
const llmExecutor = createLlmExecutor({
  providerStore: llmProviderStore,
  usageStore: llmUsageStore,
  secretPrefixes: byokSecretPrefixes,
});

// Mongo executor (enabled when a MONGO_URI/MONGO_HOST is configured).
const mUri = mongoUri();

// Per-tenant DocumentDB credential resolution (FerretDB migration #458). When a per-tenant
// FerretDB credential has been provisioned (documentdb-identity-applier) and ESO/Vault has
// mounted it as env `FERRETDB_TENANT_URI__<sanitizedTenantId>`, the executor authenticates
// with that least-privilege credential (per-tenant audit trail). Otherwise it falls back to
// the shared MONGO_URI for pre-migration / back-fill-window tenants.
//
// IMPORTANT: tenant ISOLATION is enforced by the adapter's tenantId scoping
// (packages/adapters/src/mongodb-data-api.mjs applyTenantScopeToFilter/injectTenantIntoDocument),
// NOT by this credential — ADR-14 disproved per-database role scoping at FerretDB v2.7.0,
// so the per-tenant credential is least-privilege auth/audit only, never the isolation boundary.
function resolveMongoUriForTenant(workspaceId, identity = {}) {
  const tenantId = identity?.tenantId;
  if (tenantId) {
    const envName = `FERRETDB_TENANT_URI__${String(tenantId).replace(/[^A-Za-z0-9]+/g, '_')}`;
    const perTenantUri = process.env[envName];
    if (perTenantUri) return perTenantUri;
  }
  return mUri; // shared fallback (pre-migration / back-fill window)
}

// Backend capability profile (FerretDB cutover, add-ferretdb-data-access-cutover #459).
// MONGO_BACKEND=ferretdb signals the FerretDB gateway, which does NOT support multi-document
// transactions — supportsTransactions=false makes the data-API reject `transaction` ops at the
// boundary (501 TRANSACTION_NOT_SUPPORTED) before any op persists non-atomically. Any other
// value (or unset) leaves it unconstrained (MongoDB 7 / rollback). Only transaction and
// change_stream ops consult this; CRUD/aggregate are unaffected.
const mongoTopology = process.env.MONGO_BACKEND === 'ferretdb' ? { supportsTransactions: false } : {};
const mongoExecutor = mUri ? createMongoExecutor({ resolveUri: resolveMongoUriForTenant, topology: mongoTopology }) : undefined;

// Realtime executor (FerretDB cutover #460): FerretDB v2 has no change streams, so SSE consumes a
// pgoutput logical replication slot on the DocumentDB engine. The engine is a SEPARATE Postgres from
// the data-plane DSN above; REALTIME_DOCUMENTDB_URL is a REPLICATION-privileged connection to it
// (distinct from falcone_app). The slot is per-process — each replica gets a distinct name.
const realtimeDocumentDbUrl = process.env.REALTIME_DOCUMENTDB_URL ?? process.env.DOCUMENTDB_REPLICATION_URL;
const realtimeSlotName = process.env.REALTIME_SLOT_NAME
  ?? `falcone_rt_${String(process.env.HOSTNAME ?? 'local').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 40)}`;
const realtimeExecutor = realtimeDocumentDbUrl
  ? createRealtimeExecutor({
      engineConnectionConfig: { connectionString: realtimeDocumentDbUrl },
      publicationName: process.env.REALTIME_PUBLICATION ?? 'falcone_cdc_pub',
      slotName: realtimeSlotName,
    })
  : undefined;

// Events executor (enabled when KAFKA_BROKERS is configured).
const eventsExecutor = process.env.KAFKA_BROKERS ? createEventsExecutor({ brokers: process.env.KAFKA_BROKERS }) : undefined;

// Functions executor. Default backend is the local worker_threads runner (DEV/TEST only —
// runs user code in-thread); production injects a Knative backend (FN_BACKEND=knative).
const functionsExecutor = process.env.FN_BACKEND === 'off' ? undefined : createFunctionsExecutor();

// Bearer-JWT verifier (Keycloak/OIDC). Enabled when KEYCLOAK_JWKS_URL is set; lets the
// executor authenticate admin/user requests directly (e.g. API-key issuance) without the
// gateway injecting x-tenant-id. Unset → the executor trusts gateway-injected identity headers.
// Service-account revocation/rotation propagation (fix-sa-credential-revocation-invalidate-tokens,
// #684), parity with the kind control-plane. After offline JWT validation, reject any service-account
// access token whose credential was revoked or rotated. The check reads the `service_accounts` table
// on keyPool (the same `in_falcone` platform DB the kind CP owns the table in) and caches per-client-
// id lookups for SA_REVOCATION_CACHE_MS — also the propagation-window upper bound (default 10000 →
// ≤10s; 0 = immediate). Non-SA (user/owner) tokens never reach the DB (pre-filtered on `sa-` prefix).
// Env parse that treats unset/blank as "use the default" (Number('') === 0 would silently disable the
// cache); only an explicit finite number overrides.
const saNumEnv = (v, dflt) => (v == null || v === '' || !Number.isFinite(Number(v)) ? dflt : Number(v));
const saRevocationCacheMs = saNumEnv(process.env.SA_REVOCATION_CACHE_MS, 10_000);
const saRevocationSkewSec = saNumEnv(process.env.SA_REVOCATION_SKEW_SEC, 1);
// Same Keycloak realm topology the verifier derives — used to scope the revocation lookup by the
// realm (== tenant id) from the verified issuer, so a non-globally-unique SA client id cannot resolve
// another tenant's row.
const { realmsBase: saRealmsBase, platformRealm: saPlatformRealm } =
  deriveRealmTopology(process.env.KEYCLOAK_ISSUER, process.env.KEYCLOAK_JWKS_URL);
const jwtVerifier = createJwtVerifier({
  jwksUrl: process.env.KEYCLOAK_JWKS_URL,
  issuer: process.env.KEYCLOAK_ISSUER,
  audience: process.env.KEYCLOAK_AUDIENCE,
  revocationCheck: createSaRevocationCheck({
    pool: keyPool,
    realmsBase: saRealmsBase,
    platformRealm: saPlatformRealm,
    cacheMs: saRevocationCacheMs,
    skewSec: saRevocationSkewSec,
  }),
});

// Flow executor (Temporal-backed flows API). Enabled ONLY when TEMPORAL_ADDRESS is configured;
// it is the SOLE holder of the Temporal client (lazy-connect). Definitions/versions persist on
// the SAME metadata pool as the API-key + embedding stores (design.md OQ1). When unset, no flows
// routes are registered and a flows path falls through to 404 / upstream proxy unchanged.
// Flow quota gate (change: add-flows-tenancy-isolation-limits). Wired only when a quota
// evaluator endpoint is configured (FLOW_QUOTA_ENFORCE_URL); the evaluator calls the
// provisioning-orchestrator quota-enforce action over HTTP and maps a hard-limit decision to a
// 429. When unset the flows API is unmetered (dev/test) — a breach never silently allows in prod
// because production always sets the URL.
const flowQuotaGate = process.env.FLOW_QUOTA_ENFORCE_URL
  ? createFlowQuotaGate({
      evaluate: async ({ dimensionKey, tenantId, workspaceId, currentUsage }) => {
        const res = await fetch(process.env.FLOW_QUOTA_ENFORCE_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ dimensionKey, tenantId, workspaceId, currentUsage }),
        });
        if (!res.ok) throw Object.assign(new Error(`quota evaluator ${res.status}`), { status: res.status });
        return res.json();
      },
    })
  : undefined;

// Flow audit sink (change: add-flows-tenancy-isolation-limits). Best-effort: emits each flow
// lifecycle event to the audit Kafka topic via the events executor when configured; otherwise a
// no-op (definitions/executions still work; production wires Kafka). NEVER fails a flow request.
const flowAuditTopic = process.env.FLOW_AUDIT_TOPIC ?? 'falcone.audit.flow-lifecycle';
const flowAuditSink = eventsExecutor
  ? async (event) => {
      try {
        await eventsExecutor.executeEvents({
          operation: 'publish', topic: flowAuditTopic,
          identity: { tenantId: event.tenantId, workspaceId: event.workspaceId },
          payload: { messages: [{ key: event.tenantId, value: event }] },
        });
      } catch (err) { console.error('[control-plane] flow audit publish failed:', err?.message ?? err); }
    }
  : undefined;

const flowExecutor = process.env.TEMPORAL_ADDRESS
  ? createFlowExecutor({
      store: createFlowStore({ pool: keyPool }),
      temporalAddress: process.env.TEMPORAL_ADDRESS,
      temporalNamespace: process.env.TEMPORAL_NAMESPACE ?? 'falcone-flows',
      temporalTaskQueue: process.env.TEMPORAL_TASK_QUEUE ?? 'flows-main',
      // Enforce FLW-E006: validate/publish reject any taskType not in the catalog.
      taskTypeCatalog: TASK_TYPE_NAMES,
      quotaGate: flowQuotaGate,
      auditSink: flowAuditSink,
    })
  : undefined;

// Flow trigger registry (change: add-flows-triggers). Enabled WITH the flow executor: it holds the
// Temporal ScheduleClient (lazy-connect over the same address) and a Kafka consumer for
// platform-event triggers (enabled only when KAFKA_BROKERS is set). It calls back into the
// executor's startTriggeredExecution for platform-event-initiated starts. The trigger registration
// store persists on the SAME metadata pool as the flow definition store.
// Boot wiring for the trigger plane (change: add-event-trigger-integration / #564). Defined as an
// async boot step (invoked from the ensureSchema chain below, AFTER the trigger-store table exists)
// so the on-boot consumer subscription can query already-persisted platform-event registrations. The
// previous inline wiring constructed the registry but NEVER started the consumer on boot — a flow
// published in a prior process left a dormant consumer, so a matching event started no execution
// (the live-campaign gap). wireFlowTriggers() refreshes the subscription to existing registrations.
// Single trigger store on the metadata pool, shared by the boot-time schema init and
// the trigger wiring. Its ensureSchema() creates flow_trigger_registrations /
// flow_trigger_secrets — previously NOTHING called it (the boot ensureSchema chain
// omitted it), so publishing a flow with a platform-event/webhook trigger 502'd with
// `relation "flow_trigger_registrations" does not exist` (fix-flow-trigger-schema, C3).
const triggerStore = createTriggerStore({ pool: keyPool });
let scheduleClientP = null;
async function bootFlowTriggers() {
  if (!flowExecutor) return;
  await wireFlowTriggers({
    flowExecutor,
    store: triggerStore,
    temporalTaskQueue: process.env.TEMPORAL_TASK_QUEUE ?? 'flows-main',
    secretMasterKey: process.env.FLOW_TRIGGER_SECRET_KEY,
    // Lazy Temporal client (its `.schedule` is the ScheduleClient). Shares the connection lifetime
    // with the executor's gateway in production; here a dedicated lazy connect keeps the boundary.
    getTemporalClient: async () => {
      if (!scheduleClientP) {
        scheduleClientP = (async () => {
          const { Connection, Client } = await import('@temporalio/client');
          const connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS });
          return new Client({ connection, namespace: process.env.TEMPORAL_NAMESPACE ?? 'falcone-flows' });
        })();
      }
      return scheduleClientP;
    },
    // Platform-event consumer: a single KafkaJS consumer group subscribing to the union of
    // registered tenant-scoped physical topics. Enabled only when a broker is configured.
    kafkaConsumerFactory: process.env.KAFKA_BROKERS
      ? async () => {
          const { Kafka, logLevel } = await import('kafkajs');
          const kafka = new Kafka({ clientId: 'flows-trigger-consumer', brokers: process.env.KAFKA_BROKERS.split(',').map((b) => b.trim()).filter(Boolean), logLevel: logLevel.NOTHING, ...resolveKafkaSecurity() });
          const consumer = kafka.consumer({ groupId: process.env.FLOW_TRIGGER_CONSUMER_GROUP ?? 'flows-trigger-consumer' });
          await consumer.connect();
          return {
            subscribe: ({ topics }) => Promise.all(topics.map((topic) => consumer.subscribe({ topic, fromBeginning: false }))),
            run: ({ eachMessage }) => consumer.run({ eachMessage }),
            stop: () => consumer.stop().catch(() => {}),
            disconnect: () => consumer.disconnect().catch(() => {}),
          };
        }
      : undefined,
  });
}

// Flow-monitoring executor (change: add-console-flow-monitoring / #366). The execution
// observability SSE stream: follows a single Temporal execution's history and emits node-status
// / log-line frames to the console run view. Wired WITH the flow executor (it needs a Temporal
// client) and gated on the same TEMPORAL_ADDRESS guard; FLOWS_ENABLED=false force-disables it so
// an operator can keep the flows API while suppressing the streaming endpoint (which then falls
// through to the 501 guard). The history provider lazily connects its own Temporal client over the
// same address — mirroring the trigger registry's lazy-connect boundary.
let monitoringClientP = null;
const flowMonitoringExecutor = flowExecutor && process.env.FLOWS_ENABLED !== 'false'
  ? createFlowMonitoringExecutor({
      workflowHistoryProvider: createTemporalHistoryProvider({
        getClient: async () => {
          if (!monitoringClientP) {
            monitoringClientP = (async () => {
              const { Connection, Client } = await import('@temporalio/client');
              const connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS });
              return new Client({ connection, namespace: process.env.TEMPORAL_NAMESPACE ?? 'falcone-flows' });
            })();
          }
          return monitoringClientP;
        },
      }),
      pollIntervalMs: Number(process.env.FLOW_MONITORING_POLL_MS ?? 1000),
    })
  : undefined;

// MCP server hosting management engine (change: add-mcp-control-plane-runtime). Enabled when
// MCP_ENABLED=true; it composes the pure MCP control-plane modules with a Postgres-backed per-tenant
// store on the metadata pool and self-calls this runtime to mediate tool calls.
// When unset, no /v1/mcp routes are registered and an MCP path falls through to 404 / upstream proxy.
const mcpStateStore = createMcpPostgresStore({ pool: keyPool });
const knativeRuntime = createKnativeRuntimeSource();
const runtimeCleanupRepository = createRuntimeCleanupRepository(keyPool);
const mcpRuntimeCleaner = createMcpRuntimeCleaner();
const mcpRuntimeAdapter = createMcpRuntimeAdapter();
const mcpEngine = process.env.MCP_ENABLED === 'true'
  ? createMcpEngine({
      selfBaseUrl: process.env.MCP_SELF_BASE_URL ?? `http://127.0.0.1:${PORT}`,
      gatewayBaseUrl: process.env.MCP_GATEWAY_BASE_URL,
      runtimeImage: process.env.MCP_RUNTIME_IMAGE,
      runtimeImageDigest: process.env.MCP_RUNTIME_IMAGE_DIGEST,
      store: mcpStateStore,
      cleanupRepository: runtimeCleanupRepository,
      mcpRuntimeAdapter,
      auditSink: async (event) => { try { await recordAuditEvent(keyPool, { actionType: String(event.actionType ?? 'mcp.runtime').slice(0, 64), actorId: event.actor?.actor_id, tenantId: event.tenantId, workspaceId: event.workspaceId, outcome: event.result?.outcome ?? 'succeeded', correlationId: event.correlationId, newState: { subsystem: 'mcp', serverId: event.resource?.mcp_server_id } }); } catch (err) { console.error('[mcp-audit] write failed', err.code ?? err.message); } },
    })
  : undefined;

// When the executor fronts the data-family wildcard (gateway route-split), it serves the
// data-plane + DDL slice itself and proxies every other path under those prefixes
// (browse/inventory/management) to the legacy control-plane at CONTROL_PLANE_UPSTREAM.
// Unset → unmatched paths return 404 (standalone/pure-executor mode).
//
// GATEWAY_SHARED_SECRET: when set, the executor only trusts x-tenant-id/x-workspace-id
// identity headers that arrive together with a matching x-gateway-auth header (injected
// by the APISIX gateway after authentication). Without this value the executor runs in
// legacy dev/test mode: header-only identity is trusted unconditionally. Production MUST
// set this secret; the gateway injects the matching x-gateway-auth on every forwarded
// request so that legitimate gateway-authenticated traffic continues to work while
// unauthenticated client-supplied identity headers are rejected with 401.
const server = createControlPlaneServer({
  registry, apiKeyStore, mongoExecutor, eventsExecutor, functionsExecutor, realtimeExecutor, pgRealtimeExecutor, embeddingExecutor, llmExecutor, mappingStore, flowExecutor, flowMonitoringExecutor, mcpEngine, jwtVerifier,
  resolveWorkspaceTenant,
  workspaceDocsDb: keyPool,
  controlPlaneUpstream: process.env.CONTROL_PLANE_UPSTREAM,
  // First-party MCP dispatches tool calls against this executor's own loopback base, so its local
  // routes + the control-plane fallthrough reach every management family (#642).
  mcpSelfBaseUrl: process.env.MCP_SELF_BASE_URL ?? `http://127.0.0.1:${PORT}`,
  gatewaySharedSecret: process.env.GATEWAY_SHARED_SECRET || undefined,
  knativeRuntime,
  mcpRuntimeCleaner,
});

const mcpCleanupIntervalMs = Math.max(5_000, Math.min(Number(process.env.MCP_CLEANUP_INTERVAL_MS) || 30_000, 300_000));
let mcpCleanupTimer;
async function recoverHostedMcpCleanup() {
  if (!mcpEngine) return;
  const result = await recoverMcpCleanupObligations({
    runtime: knativeRuntime,
    repository: runtimeCleanupRepository,
    deleteOwnedRuntimeResources: (obligation) => mcpRuntimeCleaner.deleteOwnedRuntimeResources(obligation),
    completeDeferredDeletion: (obligation) => mcpEngine.completeDeferredDeletion(obligation),
    onRecovered: (obligation) => {
      console.info('[control-plane] hosted MCP cleanup recovered', {
        tenantId: obligation.tenantId,
        workspaceId: obligation.workspaceId,
        serverId: obligation.resourceId,
        correlationId: obligation.correlationId,
      });
    },
  });
  if (result.recovered > 0) console.info('[control-plane] hosted MCP cleanup batch complete', result);
}

// Initialise all metadata schemas (they share keyPool) before listening.
Promise.all([apiKeyStore.ensureSchema(), embeddingStore.ensureSchema(), mappingStore.ensureSchema(), llmExecutor.ensureSchema(), flowExecutor?.ensureSchema() ?? Promise.resolve(), flowExecutor ? triggerStore.ensureSchema() : Promise.resolve(), mcpEngine?.ensureSchema() ?? Promise.resolve()])
  .catch((error) => console.error('[control-plane] metadata schema init failed:', error))
  // Wire + START the platform-event trigger consumer AFTER the schemas exist, so the on-boot
  // subscription can read already-persisted registrations (a flow published in a prior process).
  // Best-effort: a Temporal/Kafka outage at boot never blocks the HTTP server from listening.
  .then(() => bootFlowTriggers())
  .catch((error) => console.error('[control-plane] flow-trigger boot wiring failed:', error))
  .finally(() => {
    server.listen(PORT, () => console.log(`[control-plane] listening on :${PORT}`));
    void recoverHostedMcpCleanup().catch((error) => console.error('[control-plane] hosted MCP cleanup failed:', error?.message ?? error));
    mcpCleanupTimer = setInterval(() => {
      void recoverHostedMcpCleanup().catch((error) => console.error('[control-plane] hosted MCP cleanup failed:', error?.message ?? error));
    }, mcpCleanupIntervalMs);
    mcpCleanupTimer.unref?.();
  });

async function shutdown(signal) {
  console.log(`[control-plane] ${signal} received, shutting down`);
  if (mcpCleanupTimer) clearInterval(mcpCleanupTimer);
  server.close(() => {});
  await registry.end().catch(() => {});
  // keyPool backs BOTH apiKeyStore and embeddingStore; ending it once covers both.
  await keyPool.end().catch(() => {});
  await mongoExecutor?.close().catch(() => {});
  await realtimeExecutor?.close().catch(() => {});
  await pgRealtimeExecutor?.close().catch(() => {});
  await eventsExecutor?.close().catch(() => {});
  await flowExecutor?.close().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
