# Control Plane

Reserved for the control plane application.

Initial responsibility boundaries:

- public control-plane APIs and versioning
- tenant and workspace metadata
- contextual authorization resolution and access-check contracts
- canonical core-domain entity read/write contracts and lifecycle event alignment
- platform configuration workflows
- translation into internal control/provisioning contracts
- internal health and readiness endpoints

Scaffolding added by `US-ARC-01-T01` and `US-ARC-03`:

- `internal-service-map.mjs` exposes the control API slice of the shared contract package
- `authorization-model.mjs` exposes the shared security-context and access-decision baseline
- `domain-model.mjs` exposes the canonical entity, write-envelope, and lifecycle-event baseline
- provider-specific implementation remains out of this workspace
