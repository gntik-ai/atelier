# Gateway realtime, SSE/WebSocket, and HTTP event gateway

## Intent

This document records the gateway baseline for APISIX metrics, versioned realtime channels, and the controlled event-gateway surface introduced by `US-GW-04`.

## Scope

The supported surface keeps APISIX as the first trust boundary and exposes event publish/subscribe behavior without exposing native Kafka brokers or client libraries.

Covered capabilities:

- Prometheus-compatible APISIX metrics for gateway and realtime success criteria
- versioned realtime channels over `/realtime/*` with WebSocket upgrades enabled
- HTTP publish through `/v1/events/*`
- SSE subscribe through `/v1/events/*/stream`
- WebSocket session negotiation through `/v1/websockets/*`
- tenant-safe auth context, bounded backpressure, uniform audit, and correlation continuity

## Transport model

### HTTP publish

Clients publish with `POST /v1/events/topics/{resourceId}/publish` using JSON or CloudEvents JSON.

Required controls:

- `Authorization`, `X-API-Version`, and `X-Correlation-Id`
- `Idempotency-Key` on publish mutations
- tenant/workspace bindings resolved from gateway-managed auth context
- plan capability `data.kafka.topics`

The gateway accepts one logical publication and translates it into one Kafka-facing publish intent with audit metadata.

### SSE subscribe

Clients subscribe with `GET /v1/events/topics/{resourceId}/stream`.

Supported hints:

- replay cursor / `Last-Event-ID`-style checkpoint
- bounded batch size
- heartbeat interval
- standard error envelope for auth, rate-limit, and gateway failures

### WebSocket subscribe

Clients negotiate one session with `POST /v1/websockets/sessions` and then connect to the returned realtime URL.

Versioned channel pattern:

- `wss://{realtime-host}/realtime/v1/channels/{channel}`

WebSocket routes remain gateway-managed and do not bypass APISIX policy, auth propagation, or audit.

## Message contract

Event delivery remains envelope-based.

Required delivery metadata:

- `eventId`
- `eventType`
- `topicName`
- `channel`
- `partition`
- `offset`
- `sequence`
- `publishedAt`
- `correlationId`
- `contentType`

Supported message formats:

- `application/json`
- `application/cloudevents+json`

## Backpressure and throughput

The baseline is intentionally explicit and conservative:

- publish QoS profile: `event_gateway`
- stream/session QoS profile: `realtime`
- publish request budget: 180 requests/minute with burst 60
- subscribe/session budget: 180 requests/minute with burst 80
- publish payload limit: 256 KiB
- transport policy exposes bounded in-flight windows and explicit overflow action

When backpressure is hit, the gateway rejects new work predictably instead of allowing unbounded buffering.

## Audit and tenant isolation

The gateway must:

- strip spoofable downstream auth headers from client input
- rehydrate trusted context from APISIX-managed claims only
- keep tenant/workspace bindings explicit on publish and subscribe paths
- record publish acceptance, denial, session lifecycle, and transport policy changes in append-only audit evidence
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

Success criteria tracked from those series:

- active WebSocket and SSE connection counts are visible by environment
- accepted vs rejected publishes are measurable
- backpressure rejections are explicit
- gateway latency and lag windows can be inspected without reading raw broker state

## External consumer guidance

### Front-end consumers

Prefer:

1. negotiate a websocket session through `/v1/websockets/sessions`
2. use SSE when browser/network policy prefers simpler long-lived HTTP streams
3. treat `429` as a transport or quota signal, not as an invitation to spin faster retries

### Back-end consumers

Prefer:

1. HTTP publish through `/v1/events/topics/{resourceId}/publish`
2. stable `Idempotency-Key` values on retries
3. topic and channel naming that stays inside workspace-owned prefixes

Do not connect directly to Kafka from tenant-facing workloads through this public surface.

## Residual risk and dependency note

Residual risk remains against dependency `US-EVT-02`.

Current contract assumptions are intentionally documented but may tighten when the broader event-platform story finalizes:

- canonical broker topic taxonomy
- replay retention guarantees
- consumer-group naming and lag semantics
- any broker-specific partitioning edge cases

Until `US-EVT-02` lands, this story keeps the HTTP/SSE/WebSocket gateway contract stable and auditable while treating broker-internal semantics as an implementation detail behind the adapter boundary.
