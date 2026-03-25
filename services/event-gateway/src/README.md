# Event Gateway

This workspace is reserved for the gateway-managed HTTP, SSE, and WebSocket event surface.

Initial responsibility boundaries:

- accept versioned HTTP publish requests without exposing native Kafka clients
- negotiate SSE and WebSocket subscriptions with tenant/workspace-safe replay cursors
- enforce throughput ceilings, bounded in-flight delivery, and backpressure before broker interaction
- preserve auditability and gateway metrics for publish acceptance, denials, lag, and stream lifecycle changes

Runtime behavior in this package must not bypass `services/internal-contracts`, APISIX-first routing, or the shared adapter ports in `services/adapters`.

Current scaffolding:

- `contract-boundary.mjs` exposes the publish and subscription contract slices
- `runtime.mjs` models publish validation, queue-aware subscriptions, replay policy, reconnect windows, and relative-order summaries for `US-EVT-02`
