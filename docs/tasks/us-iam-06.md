# US-IAM-06 — Eventos IAM, suspensión de tenant y auditoría avanzada

## Scope delivered

- IAM lifecycle activity now has a canonical event envelope that can be linked to append-only audit evidence and forwarded to Kafka-compatible streams.
- Tenant IAM access can now be suspended or reactivated explicitly, with semantics that block both human logins and service-account access without conflating that state with user disablement or client revocation.
- BaaS-managed IAM administrative operations now require actor, origin-surface, and tenant/workspace context fields in both request and audit contracts.
- Query surfaces now expose tenant- and workspace-scoped IAM activity timelines so operators and auditors can trace login, invitation, credential, suspension, and reactivation changes end to end.
- Reference test scaffolding now models suspension/reactivation verification and lifecycle-event observability as first-class scenarios.

## Contract changes

- OpenAPI bumped to `1.7.0` with `PATCH /v1/tenants/{tenantId}/iam-access` plus `GET /v1/iam/tenants/{tenantId}/activity` and `GET /v1/iam/workspaces/{workspaceId}/activity`.
- Tenant and service-account schemas now expose IAM access posture projections so suspension side effects stay explicit in the contract layer.
- Internal service-map contracts now define `iam_lifecycle_event` and require richer actor/context fields on IAM admin and audit envelopes.
- Generated route catalog and family contracts now surface the IAM traceability endpoints under the existing contract-first public API inventory.

## Validation intent

- Keep lifecycle events replay-safe, additive, and correlated to one audit record plus one Kafka-compatible delivery key.
- Preserve tenant/workspace isolation when tracing or enforcing IAM access posture.
- Make the semantic difference between user disablement, tenant suspension, and application revocation explicit enough that later runtime work cannot collapse them into one opaque state.
