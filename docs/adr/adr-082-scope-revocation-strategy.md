# ADR-082: Scope Revocation Strategy for Realtime Sessions

## Status

Accepted

## Context

The realtime gateway establishes long-lived developer sessions that continue to receive workspace-scoped events after the initial handshake. That creates a governance gap: an access token can expire or a user's granted scopes can narrow after the websocket or subscription has already been created. For this feature, the platform must stop delivery quickly enough to satisfy the security controls for token expiry and scope revocation without introducing a custom Keycloak extension or a tightly coupled control-plane push channel.

The required behavior is practical and strict at the same time. Delivery must stop within the configured token-expiry grace window and scope narrowing must be enforced within sixty seconds. The solution also has to work in the current deployment model, where Keycloak is available as an external identity provider and the realtime gateway is a separate service deployed through Helm. We want predictable behavior, minimal moving parts, and an implementation path that can be validated in CI with deterministic tests.

## Decision

We will use polling-based scope re-validation driven by the realtime session manager. Every active session is re-checked on a fixed interval controlled by `SCOPE_REVALIDATION_INTERVAL_SECONDS`, with an initial default of thirty seconds. Each poll performs token introspection and compares the resulting active state and effective scopes with the subscription's required workspace and channel access. If the token is inactive, expired, or no longer authorizes the requested channel, the session is marked `SUSPENDED`, event delivery is paused, and an immutable audit event is published.

## Alternatives Considered

1. **Keycloak event-listener SPI with Kafka push events**: attractive because it can reduce revocation latency, but it requires building and operating a custom Keycloak extension that is not currently in scope for this delivery.
2. **APISIX revocation list only**: useful for coarse token invalidation at the gateway edge, but insufficient for mid-session scope narrowing and too limited for workspace/channel-specific enforcement.

## Consequences

This choice gives us a predictable worst-case revocation window and keeps the implementation inside the gateway codebase and Helm deployment artifacts. The trade-off is recurring introspection traffic proportional to the number of active sessions. That cost is acceptable for v1 because the interval is configurable, the policy is easy to reason about, and the implementation produces explicit audit records whenever a session is suspended or resumed.
