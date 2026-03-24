# US-TEN-01 — Alta automática de tenant y aprovisionamiento inicial de recursos

## Scope delivered

- Signup activation now models the creation of the initial tenant, the default workspace, and the first owner bindings as one traceable bootstrap workflow.
- Provisioning contracts now distinguish always-created bootstrap resources from profile-gated resources and keep per-resource state visible for API and console consumers.
- The canonical domain/governance catalog now includes an initial tenant bootstrap template set and an enterprise-gated MongoDB capability.
- Bootstrap state is now explicitly retry-aware so partially failed runs can resume idempotently instead of replaying already converged resources.
- Reference scaffolding now covers the end-to-end signup-to-operational-tenant journey plus partial-bootstrap recovery expectations.

## Contract changes

- OpenAPI bumped to `1.8.0` and now exposes `ProvisioningSummary` / `ProvisioningResourceState` contracts on signup activation, signup registrations, tenant/workspace reads, managed-resource reads, and provider-specific bootstrap resources.
- `ConsoleSignupActivationDecision` now carries the resulting tenant, default workspace, owner memberships, and bootstrap progress envelope.
- `services/internal-contracts` now exposes initial tenant bootstrap templates plus a pure `resolveInitialTenantBootstrap(...)` helper derived from plans, deployment profiles, and provider capabilities.
- Internal provisioning contracts now require owner-binding metadata, resource blueprints, per-resource result state, and retry lineage.

## Validation intent

- Keep signup approval idempotent even when bootstrap finishes only partially.
- Preserve tenant/workspace isolation while surfacing enough bootstrap detail for auditability and operator UX.
- Make the difference between always-created resources and profile-gated resources explicit enough that later runtime implementation cannot silently widen or shrink tenant bootstrap behavior.
