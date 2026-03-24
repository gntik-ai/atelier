# Event Gateway

This workspace is reserved for the gateway-managed HTTP, SSE, and WebSocket event surface.

Initial responsibility boundaries:

- accept versioned HTTP publish requests without exposing native Kafka clients
- negotiate SSE and WebSocket subscriptions with tenant/workspace-safe replay cursors
- enforce throughput ceilings, bounded in-flight delivery, and backpressure before broker interaction
- preserve auditability and gateway metrics for publish acceptance, denials, lag, and stream lifecycle changes

Future tasks should implement runtime behavior here without bypassing `services/internal-contracts`, APISIX-first routing, or the shared adapter ports in `services/adapters`.

Current scaffolding:

- `contract-boundary.mjs` exposes the publish and subscription contract slices
- residual dependency risk remains explicitly documented against `US-EVT-02` until the final broker event taxonomy and replay semantics are ratified
