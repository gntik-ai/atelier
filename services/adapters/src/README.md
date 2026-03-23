# Service Adapters

Workspace reserved for integrations with external providers.

Adapter expectations:

- each adapter should expose a narrow contract
- provider-specific code stays isolated from domain logic
- retries, timeouts, and credential handling must remain explicit
- shared provider-port metadata should flow from `provider-catalog.mjs`
- propagated tenant/workspace authorization context must remain explicit and scoped for every downstream call

Current baseline providers:

- Keycloak
- PostgreSQL
- MongoDB
- Kafka
- OpenWhisk
- storage

Current authorization scaffolding:

- `provider-catalog.mjs` exposes baseline provider ports and shared adapter contracts
- `authorization-policy.mjs` exposes the adapter-facing enforcement surfaces and projection targets for contextual authorization
