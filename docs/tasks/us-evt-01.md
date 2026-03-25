# US-EVT-01 — Kafka topic governance, ACL isolation, naming, and quota visibility

## Scope delivered

This increment formalizes the Kafka administrative surface behind the `events` family without exposing broker-native clients or ad-hoc topic names.

Delivered artifacts:

- Kafka admin adapter helpers in `services/adapters/src/kafka-admin.mjs`
- control-plane helper coverage in `apps/control-plane/src/events-admin.mjs`
- public OpenAPI routes for topic governance, ACL reconciliation, and workspace inventory
- public API taxonomy/resource mappings for `topic_acl` and `event_inventory`
- internal contracts for `kafka_admin_request`, `kafka_admin_result`, `kafka_inventory_snapshot`, and `kafka_admin_event`
- interaction-flow and service-map updates for control-plane → orchestrator → Kafka adapter sequencing
- architecture documentation for KRaft-only posture, workspace naming policy, ACL isolation, and quota visibility
- unit, adapter, contract, and validation coverage for multiple tenants/workspaces/service accounts

## Main decisions

### Topic names stay logical at the API boundary

The public API accepts logical topic names and derives the physical Kafka topic from tenant/workspace/environment context.

Governance consequences:

- callers do not supply arbitrary broker topic prefixes
- consumer-group prefixes are generated from the same workspace-safe namespace
- service-account principals are constrained to workspace-scoped prefixes

### ACL management is explicit and workspace-scoped

The `events` family now exposes:

- `POST /v1/events/topics`
- `GET /v1/events/topics/{resourceId}`
- `GET|PUT /v1/events/topics/{resourceId}/access`
- `GET /v1/events/workspaces/{workspaceId}/inventory`

ACL bindings are validated against workspace-owned service-account prefixes and cannot escape tenant/workspace scope.

### KRaft is the only supported governance posture

The adapter/profile contract documents Kafka administration as KRaft-only.

Explicitly unsupported through this surface:

- ZooKeeper-era governance assumptions
- raw broker credentials
- arbitrary cross-tenant ACL principals
- unmanaged physical topic names

### Quota visibility is part of the API contract

Topic inventory and normalized topic resources expose:

- `workspace.kafka_topics.max`
- used vs remaining topic capacity
- partitions-per-topic limits
- publish throughput ceiling
- concurrent subscription ceiling

This keeps plan-aware limits visible in console/control-plane reads without live broker enumeration for every request.

## Validation

Primary validation entry points:

```bash
npm run generate:public-api
npm run validate:public-api
npm run validate:service-map
npm run test:unit
npm run test:adapters
npm run test:contracts
```

## Residual implementation note

This increment defines the governance/control-plane contract, not a runtime broker implementation. Direct native Kafka connectivity, live broker reconciliation loops, and broader event-platform semantics remain behind later execution stories such as `US-EVT-02`.
