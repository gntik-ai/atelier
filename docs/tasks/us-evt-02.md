# US-EVT-02 — Publish API, subscribe/stream API, logical queues, and controlled replay

## Scope delivered

This increment completes the runtime contract for the `events` family without exposing native Kafka clients to tenant workloads.

Delivered artifacts:

- event-gateway runtime helpers in `services/event-gateway/src/runtime.mjs`
- control-plane helper coverage in `apps/control-plane/src/events-admin.mjs`
- public OpenAPI schema expansion for publish, stream, websocket, replay, notification queue, reconnect, and observability metadata
- internal contract enrichment for `event_gateway_publish_request`, `event_gateway_publish_result`, `event_gateway_subscription_request`, and `event_gateway_subscription_status`
- architecture and task documentation for queue, replay, binary payload, and relative-order semantics
- resilience fixtures covering bounded load, reconnect, replay, and relative-order detection
- unit, contract, and resilience coverage for publish/subscribe validation and recovery behavior

## Main decisions

### Publish stays HTTP-first and policy-bound

The runtime contract now accepts:

- logical topic reference via the route path
- `key`
- `headers`
- `payload`
- `timestamp`
- optional `partition` only when topic policy allows caller hints
- `payloadEncoding` so JSON and binary deliveries stay explicit

The gateway always validates payload size, headers, and partition policy before producing an internal publish intent.

### Subscribe and stream remain workspace-scoped

SSE and WebSocket contracts now make the following explicit:

- transport-specific backpressure settings
- replay request parameters
- logical notification queue binding
- reconnect grace periods
- relative-order scope on delivery

Workspace scope remains mandatory even when one queue is user- or session-oriented.

### Binary payload support is bounded and auditable

Binary payloads are represented as base64 with declared content type.

Consequences:

- payload size can be measured deterministically before broker handoff
- audit evidence can stay metadata-only
- OpenAPI contracts can represent both JSON and binary-safe envelopes under one versioned surface

### Notification queues are logical, not broker-native

Front-end consumers receive queue semantics through gateway-managed descriptors such as `broadcast`, `workspace`, `user`, and `session`.

This keeps the public API stable while preventing direct exposure of broker-specific consumer-group topology.

### Replay and reconnection are policy-driven

Replay is only available when topic retention and topic policy allow it.

Recovery order:

1. resume by cursor when reconnect stays inside the grace window
2. fall back to bounded replay when retention allows it
3. surface order guarantees as relative-to-key-within-partition, not global total order

## Validation

Primary validation entry points:

```bash
npm run generate:public-api
npm run validate:public-api
npm run validate:service-map
npm run test:unit
npm run test:contracts
npm run test:resilience
```

## Residual implementation note

This increment defines and tests the runtime gateway contract. It still does not claim a live broker deployment, end-to-end consumer lag measurements, or physical queue materialization inside a running cluster.
