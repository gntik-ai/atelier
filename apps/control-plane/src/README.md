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

Scaffolding added by `US-ARC-01-T01`, `US-ARC-03`, and `US-GW-01`:

- `internal-service-map.mjs` exposes the control API slice of the shared contract package
- `authorization-model.mjs` exposes the shared security-context and access-decision baseline
- `domain-model.mjs` exposes the canonical entity, write-envelope, and lifecycle-event baseline
- `public-api-catalog.mjs` exposes the generated family/route discovery catalog that backs the `/v1/platform/route-catalog` contract
- `iam-admin.mjs` exposes the normalized `/v1/iam/*` administrative family metadata and compatibility summary for Keycloak-backed IAM resources
- `console-auth.mjs` exposes the normalized `/v1/auth/*` login, signup, activation, recovery, and status-view surface for the console
- `workspace-management.mjs` exposes the enriched `/v1/workspaces/*` CRUD, cloning, lifecycle, inheritance, and API-surface helpers
- `postgres-admin.mjs` exposes the normalized `/v1/postgres/*` administrative family metadata, compatibility summary, and structural table/column/type surface
- provider-specific implementation remains out of this workspace
