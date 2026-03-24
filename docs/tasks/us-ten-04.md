# US-TEN-04 — Estados de tenant, cuotas, etiquetas, exportación e inventario

## Scope delivered

- Tenants now expose an explicit lifecycle state machine with `pending_activation`, `active`, `suspended`, and `deleted`, plus auditable transition semantics for suspension, reactivation, and logical deletion.
- Tenant governance now treats soft delete, retention, and definitive purge as separate steps with elevated approval, reinforced confirmation, export checkpointing, and operator-visible safeguards.
- Canonical tenant contracts now surface labels/tags, tenant-level quota posture, workspace subquotas, governance retention controls, and recovery-export metadata.
- The public API now includes tenant listing, update, logical deletion, reactivation, purge, governance dashboard, inventory, and configuration-export surfaces under the existing tenants family.
- Internal helper modules for control-plane and web-console consumers now summarize tenant governance dashboards, inventory snapshots, export previews, and purge/lifecycle checklists from the contract layer.
- Reference fixtures and verification now model quota visibility, label-driven reporting, suspension/reactivation impacts, logical deletion propagation, and purge gating expectations across affected resources.

## Contract changes

- OpenAPI bumped to `1.11.0` with `GET /v1/tenants`, `PUT|DELETE /v1/tenants/{tenantId}`, `GET /v1/tenants/{tenantId}/dashboard`, `GET /v1/tenants/{tenantId}/inventory`, `POST /v1/tenants/{tenantId}/exports`, `POST /v1/tenants/{tenantId}/reactivation`, and `POST /v1/tenants/{tenantId}/purge`.
- Tenant read/write models now carry `labels`, `quotaProfile`, `governance`, `inventorySummary`, and `exportProfile` while keeping secret material out of the canonical export path.
- The domain model now includes a dedicated `tenant_lifecycle` state machine and stronger invariants around logical deletion, retention, tenant-scoped quotas, and cross-tenant isolation.
- Generated family documents, route catalog, and public API surface docs now expose the tenant governance routes and their gateway protection metadata.

## Validation intent

- Keep tenant lifecycle transitions deterministic, auditable, and explicit about descendant workspace/resource impacts.
- Preserve strict tenant isolation when filtering labels, exposing quota posture, generating inventory, or preparing exports and purges.
- Require logical-delete-first semantics plus elevated confirmation before definitive purge.
- Make dashboards and listings operator-usable enough to explain lifecycle state, quota pressure, retention posture, and recovery readiness without needing runtime-only joins.
