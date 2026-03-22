# Service Adapters

Workspace reserved for integrations with external providers.

Adapter expectations:

- each adapter should expose a narrow contract
- provider-specific code stays isolated from domain logic
- retries, timeouts, and credential handling must remain explicit
