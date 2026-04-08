# ADR 0007: Membership, invitation, plan, and capability-governance baseline

- Status: Accepted
- Date: 2026-03-23
- Deciders: In Falcone platform architecture baseline
- Related backlog item: US-DOM-02
- Related ADRs:
  - ADR 0003: Control-plane service map
  - ADR 0004: Public-domain environment topology
  - ADR 0005: Contextual authorization model
  - ADR 0006: Canonical core domain entity model

## Context

`US-DOM-01` established the core product entities, but the repository still lacked one auditable baseline for how the platform governs:

- tenant and workspace memberships
- invitations into tenant/workspace scope
- commercial plans and quota policies
- deployment profiles and provider-backed capabilities
- effective capability resolution per tenant and workspace

Without that baseline, later identity, billing, quota, and provisioning stories would likely invent different shapes for the same concepts. That would make plan changes unsafe, capability exposure inconsistent, and observability blind to why one tenant or workspace can or cannot access a feature.

A follow-on model must preserve:

- multi-tenant and multi-workspace isolation
- explicit auditability of grants, invitations, and plan changes
- clear separation of control, data, identity, and observability planes
- room for `US-PLAN-01` to refine commercial/billing behavior later without redefining the core governance contract

## Decision

Adopt the governance extensions recorded in `services/internal-contracts/src/domain-model.json` as the canonical baseline for:

1. `tenant_membership` and `workspace_membership` as first-class auditable entities
2. `invitation` as the canonical onboarding record for tenant/workspace grants
3. `plan`, `quota_policy`, `deployment_profile`, and `provider_capability` as the reusable plan-governance catalog
4. business state machines for membership, invitation, plan, and quota-governance status
5. serialized effective-capability resolution contracts for tenant and workspace scope
6. plan-change scenarios that prove upgrades and downgrades alter limits and enabled capabilities safely

## Governance model rules

### Memberships and invitations

- Memberships are explicit records, not inferred side effects.
- Workspace membership remains tenant-safe and cannot widen tenant authority.
- Invitations store masked or hashed recipient identity material only; raw secrets remain outside the canonical domain model.
- Revoked or expired invitations cannot mint memberships without a new invitation record.

### Plans, quotas, and deployment profiles

- Every commercial plan references exactly one quota policy and one default deployment profile.
- Quota policies define deterministic metric limits and enforcement mode.
- Deployment profiles capture control/data/identity/observability plane bindings and supported environments.
- Provider capabilities describe the technical features a profile can surface, including support level and degradation state.

### Effective capability resolution

Effective capability resolution is the intersection of:

1. commercial plan entitlements
2. quota policy limits
3. deployment-profile topology support
4. provider capability availability

A capability is effectively enabled only if all four layers agree. Workspace resolution may narrow the tenant result based on environment or provider constraints, but it may not widen the tenant entitlement without an explicit audited override.

### Safe plan changes

Plan changes must be evaluated before they apply:

- upgrades may add capabilities and relax limits
- downgrades may remove capabilities and tighten limits
- if current usage would exceed the target plan, the change returns a remediation-required outcome instead of silently applying destructive limits

## Consequences

### Positive

- Identity, billing, quota, and provisioning work now share one machine-readable governance vocabulary.
- Effective capability resolution becomes inspectable and testable before runtime implementation.
- Plan changes can be reasoned about safely with explicit blocking metrics and capability deltas.
- Observability can label control/data/identity/observability effects consistently.

### Negative / trade-offs

- The catalog is intentionally broader than the current runtime implementation.
- Pending commercial detail from `US-PLAN-01` may refine plan packaging later, but must reuse this baseline rather than replace it.
- Some provider-specific nuance still belongs in adapters or future runtime packages, not in the canonical governance contract.

## Follow-up guidance

- Extend the machine-readable catalogs before adding new plan-aware consumers.
- Keep invitations and memberships auditable and tenant-safe.
- Preserve plane labels in every effective-capability result and operator-facing explanation.
- Treat destructive downgrades as remediation workflows, not implicit data loss.
