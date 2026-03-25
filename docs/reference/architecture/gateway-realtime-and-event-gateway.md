# Gateway realtime, SSE/WebSocket, and HTTP event gateway

## Intent

This document records the gateway baseline for APISIX metrics, versioned realtime channels, and the controlled event-gateway surface introduced by `US-GW-04`, `US-EVT-01`, and completed in `US-EVT-02`.

## Scope

The supported surface keeps APISIX as the first trust boundary and exposes event publish/subscribe behavior without exposing native Kafka brokers or client libraries.

Covered capabilities:

- Prometheus-compatible APISIX metrics for gateway and realtime success criteria
- versioned realtime channels over `/realtime/*` with WebSocket upgrades enabled
- Kafka topic governance through `/v1/events/topics`, `/v1/events/topics/{resourceId}/access`, and `/v1/events/workspaces/{workspaceId}/inventory`
- HTTP publish through `/v1/events/topics/{resourceId}/publish`
- SSE subscribe through `/v1/events/topics/{resourceId}/stream`
- WebSocket session negotiation through `/v1/websockets/sessions`
- workspace-scoped notification queues, controlled replay, reconnect policies, and relative-order guarantees
- tenant-safe auth context, bounded backpressure, uniform audit, and correlation continuity

## Transport model

### HTTP publish

Clients publish with `POST /v1/events/topics/{resourceId}/publish` using a logical topic reference plus a gateway envelope.

Required controls:

- `Authorization`, `X-API-Version`, and `X-Correlation-Id`
- `Idempotency-Key` on publish mutations
- tenant/workspace bindings resolved from gateway-managed auth context
- plan capability `data.kafka.topics`
- explicit `contentType`, `payloadEncoding`, optional `key`, optional `timestamp`, and optional `partition` only when topic policy allows caller hints

Supported payload encodings:

- `json`
- `base64`

Supported content families:

- `application/json`
- `application/cloudevents+json`
- bounded binary payloads such as `application/octet-stream`

The gateway accepts one logical publication and translates it into one Kafka-facing publish intent with audit metadata, payload-size accounting, policy snapshots, and queue fanout hints.

### SSE subscribe

Clients subscribe with `GET /v1/events/topics/{resourceId}/stream`.

Supported hints:

- replay cursor / `Last-Event-ID`-style checkpoint
- `replayMode`, optional timestamp/window controls, and bounded `maxEvents`
- bounded batch size and `maxInFlight`
- heartbeat interval
- optional logical notification queue binding for front-end apps
- standard error envelope for auth, rate-limit, and gateway failures

### WebSocket subscribe

Clients negotiate one session with `POST /v1/websockets/sessions` and then connect to the returned realtime URL.

Versioned channel pattern:

- `wss://{realtime-host}/realtime/v1/channels/{channel}`

WebSocket routes remain gateway-managed and do not bypass APISIX policy, auth propagation, or audit.

Session contracts expose:

- workspace scope
- subscriptions with replay and queue configuration
- bounded heartbeat and backpressure policies
- reconnect grace periods
- relative order scope for resumed deliveries

## Message contract

Event delivery remains envelope-based.

Required delivery metadata:

- `eventId`
- `eventType`
- `topicName`
- `topicResourceId`
- `channel`
- `partition`
- `offset`
- `sequence`
- `publishedAt`
- `correlationId`
- `contentType`
- `payloadEncoding`

Supported message formats:

- `application/json`
- `application/cloudevents+json`
- bounded base64 binary payloads

Delivery envelopes may also carry:

- `key`
- forwarded headers after gateway sanitization
- queue metadata for notification queues
- replay metadata for retained deliveries
- delivery metadata describing resumed sessions and relative order scope

## Notification queues, replay, and relative order

`US-EVT-02` formalizes logical notification queues for front-end consumers without exposing raw broker consumer-group behavior.

Supported queue types:

- `broadcast`
- `workspace`
- `user`
- `session`

Queue semantics:

- queues stay workspace-scoped even when they target one user or one browser session
- queue depth is bounded by plan-aware policy
- ack mode stays explicit in enterprise plans and implicit elsewhere by default
- delivery mode stays visible as `fanout` or `competing_consumers`

Controlled replay rules:

- replay is only available when topic retention and policy allow it
- replay windows are bounded by `replayWindowHours`
- replay requests can target `latest`, `earliest`, `last_event_id`, `from_timestamp`, or `window`
- replay batch size is plan-aware and explicitly capped

Relative order guarantees:

- ordering is guaranteed relative to key within one partition
- resumed sessions use cursor-based recovery first and replay only when needed
- order violations are observable and test-covered rather than treated as silent implementation detail

## Backpressure and throughput

The baseline is intentionally explicit and conservative:

- publish QoS profile: `event_gateway`
- stream/session QoS profile: `realtime`
- publish request budget: 180 requests/minute with burst 60
- subscribe/session budget: 180 requests/minute with burst 80
- publish payload limit: 256 KiB
- transport policy exposes bounded in-flight windows and explicit overflow action
- JSON and base64 payload sizes are validated against plan-aware limits before broker handoff

When backpressure is hit, the gateway rejects new work predictably instead of allowing unbounded buffering.

## Kafka topic governance and KRaft posture

Administrative topic creation and ACL reconciliation stay on the control-plane surface:

- `POST /v1/events/topics` accepts logical topic requests and generates the physical Kafka topic name from workspace-safe naming policy.
- `GET|PUT /v1/events/topics/{resourceId}/access` exposes and reconciles service-account ACL bindings without allowing cross-workspace principals.
- `GET /v1/events/workspaces/{workspaceId}/inventory` exposes quota usage, naming policy, ACL counts, payload policy, replay policy, notification policy, and KRaft compatibility guidance without live broker enumeration for every console read.

Governance requirements inherited from `US-EVT-01` and extended in `US-EVT-02`:

- KRaft-only guidance; ZooKeeper-era admin flows are intentionally unsupported.
- physical topic names and consumer-group prefixes stay provider-generated from tenant/workspace context.
- ACLs stay bound to workspace-scoped service-account prefixes and must not permit cross-tenant reuse.
- quota visibility is explicit for `workspace.kafka_topics.max`, partitions-per-topic, publish throughput, concurrent subscription ceilings, replay batch ceilings, and notification-queue depth.
- partition selection policy is explicit: provider-managed by default, caller hints only when the topic policy allows it.

## Audit and tenant isolation

The gateway must:

- strip spoofable downstream auth headers from client input
- rehydrate trusted context from APISIX-managed claims only
- keep tenant/workspace bindings explicit on publish and subscribe paths
- record publish acceptance, denial, session lifecycle, queue policy, replay policy, and reconnect policy changes in append-only audit evidence
- avoid storing raw payload bodies in audit; metadata-only evidence is preferred

## Observability and APISIX metrics

APISIX Prometheus metrics are enabled through the gateway policy contract.

Canonical scrape path:

- `/apisix/prometheus/metrics`

Required gateway/realtime metric families:

- `apisix_http_status`
- `apisix_nginx_http_current_connections`
- `in_atelier_event_gateway_active_ws_connections`
- `in_atelier_event_gateway_active_sse_streams`
- `in_atelier_event_gateway_publish_total`
- `in_atelier_event_gateway_backpressure_rejections_total`

Additional runtime signals expected from the public contract:

- replay accepted/denied rates
- reconnect attempts and resumptions
- relative order violations
- notification queue depth and lag windows

Success criteria tracked from those series:

- active WebSocket and SSE connection counts are visible by environment
- accepted vs rejected publishes are measurable
- backpressure rejections are explicit
- controlled replay activity is visible without raw broker inspection
- gateway latency, lag, queue depth, and reconnect windows can be inspected without reading raw broker state

## External consumer guidance

### Front-end consumers

Prefer:

1. negotiate a websocket session through `/v1/websockets/sessions`
2. use SSE when browser/network policy prefers simpler long-lived HTTP streams
3. bind one logical notification queue per app surface when fanout semantics matter
4. treat `429` as a transport or quota signal, not as an invitation to spin faster retries

### Back-end consumers

Prefer:

1. HTTP publish through `/v1/events/topics/{resourceId}/publish`
2. stable `Idempotency-Key` values on retries
3. explicit `key` values when relative ordering matters
4. topic and channel naming that stays inside workspace-owned prefixes

Do not connect directly to Kafka from tenant-facing workloads through this public surface.

## Delivered note for `US-EVT-02`

`US-EVT-02` closes the remaining contract gap for publish, subscribe/stream, binary support, logical notification queues, controlled replay, and reconnection/relative-order coverage.

The runtime remains provider-abstracted, but the public and internal contracts now make the following explicit and testable:

- publish key/timestamp/partition behavior
- workspace-scoped WebSocket and SSE subscription policy
- JSON and base64/binary payload limits
- notification queues for front-end apps
- replay authorization and retention bounds
- reconnect windows and relative-order expectations
