# US-EVT-03 — Kafka bridges, Kafka-triggered functions, topic metadata, dashboards, and Kafka-admin audit coverage

## Scope delivered

This increment completes the managed Kafka integration surface for the `events`, `functions`, `storage`, and `metrics` families without exposing native broker clients or unrestricted broker enumeration to tenant workloads.

Delivered artifacts:

- Kafka bridge and trigger helpers in `services/event-gateway/src/kafka-integrations.mjs`
- extended event-gateway contract boundary exports in `services/event-gateway/src/contract-boundary.mjs`
- control-plane helper coverage for bridges, topic metadata, and dashboards in `apps/control-plane/src/events-admin.mjs`
- public OpenAPI expansion for event bridges, topic metadata, Kafka-triggered OpenWhisk execution, Kafka topic metrics, and workspace event dashboards
- internal contract enrichment for `event_bridge_request`, `event_bridge_status`, `kafka_function_trigger_request`, `kafka_function_trigger_result`, `postgres_data_change_event`, `storage_object_event`, and `openwhisk_activation_event`
- service-map updates that connect PostgreSQL, MongoDB, storage, OpenWhisk, IAM, Kafka, audit, and dashboard projection flows
- architecture and task documentation for managed bridges, trigger policy, lag/retention/compaction exposure, and Kafka-admin auditability
- unit and contract coverage for bridge validation, OpenWhisk trigger policy, topic metadata exposure, dashboard widgets, and route publication

## Main decisions

### Event sources are bridged through one managed abstraction

The public control-plane now exposes workspace-scoped bridge resources under `/v1/events/workspaces/{workspaceId}/bridges`.

Supported source classes are modeled explicitly:

- PostgreSQL data-change envelopes
- MongoDB change-stream envelopes
- storage object events
- OpenWhisk activation events
- IAM lifecycle events

This keeps source-specific provider behavior normalized while preserving tenant/workspace ownership, correlation context, and append-only audit linkage.

### Kafka-triggered functions stay gateway-managed

Kafka-triggered execution is defined as a managed function-trigger policy under `/v1/functions/actions/{resourceId}/kafka-triggers`.

The contract makes the following explicit:

- bounded `deliveryMode`
- bounded `batchSize`
- bounded `maxParallelInvocations`
- dead-letter topic routing
- filter expressions
- append-only audit metadata

OpenWhisk execution remains indirect through the event-gateway boundary so workloads do not create raw broker consumers.

### Topic metadata is exposed only when technically possible

`GET /v1/events/topics/{resourceId}/metadata` publishes partition, lag, retention, and compaction data behind one normalized response.

Each subsection carries availability state so the platform can distinguish:

- data that is visible and safe to expose
- data blocked by provider limitations
- data blocked by policy or tenant-safety restrictions

### Observability is workspace-scoped and dashboard-friendly

The metrics family now includes:

- `/v1/metrics/workspaces/{workspaceId}/kafka-topics`
- `/v1/metrics/workspaces/{workspaceId}/event-dashboards`

These routes publish the safe projection layer for:

- topic throughput
- consumer lag
- bridge health
- function-trigger health
- Kafka-admin audit volume

### Kafka administrative operations remain auditable

Kafka topic / ACL administration, bridge mutations, and function-trigger mutations retain append-only audit linkage.

The internal model now keeps actor, correlation, authorization, target resource, and evidence-pointer continuity without persisting raw event payloads or credentials.

## Validation

Primary validation entry points:

```bash
node scripts/generate-public-api-artifacts.mjs
npm run validate:public-api
npm run validate:service-map
npm run test:unit
npm run test:contracts
```

## Residual implementation note

This increment defines and tests the contract surface, routing metadata, and normalized runtime helpers for managed Kafka bridges and triggers. It still does not claim a live broker deployment, physical CDC replication, or production dashboard materialization against a running cluster.
