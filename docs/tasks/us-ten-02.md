# US-TEN-02 — Gestión de workspaces y API propia por workspace

## Scope delivered

- The canonical workspace surface now covers full CRUD, lifecycle mutation, configuration cloning, and workspace-specific API-surface discovery.
- Workspace IAM configuration now includes an explicit key-policy baseline so applications and service accounts can inherit secret-isolation defaults without leaking material into canonical entities.
- Workspace inheritance now models tenant logical resources and shared-resource specialization without duplicating tenant-safe backing resources.
- Reference fixtures now cover tenant-shared resources consumed by multiple workspaces while keeping external applications and service-account credentials independent per workspace.

## Contract changes

- OpenAPI bumped to `1.9.0` and now exposes `GET /v1/workspaces`, `PUT /v1/workspaces/{workspaceId}`, `DELETE /v1/workspaces/{workspaceId}`, `POST /v1/workspaces/{workspaceId}/clone`, and `GET /v1/workspaces/{workspaceId}/api-surface`.
- Workspace read/write contracts now include `resourceInheritance`, `apiSurface`, clone lineage, and the enriched `WorkspaceIamBoundary.keyPolicy` descriptor.
- Managed resources now declare logical-resource keys plus optional tenant-shared bindings (`sharingScope`, `consumerWorkspaceIds`, authorized application/service-account sets).
- `services/internal-contracts` now exposes pure helpers for workspace API-surface resolution, inheritance summarization, and clone-draft generation.
- Control-plane and web-console scaffolding now include `workspace-management.mjs` helpers for route discovery, lifecycle awareness, endpoint cards, and clone-form defaults.

## Validation intent

- Preserve per-tenant uniqueness for workspace names and slugs while allowing multiple environments per tenant.
- Keep shared tenant resources reusable across workspaces without collapsing workspace-local IAM, credentials, or application ownership.
- Make workspace endpoint discovery deterministic enough for console and external-client onboarding before runtime implementations exist.
