# ADR 0005: Contextual authorization model for multi-tenant and multi-workspace control

- **Status**: Accepted
- **Date**: 2026-03-23
- **Decision owners**: Architecture / platform bootstrap
- **Related task**: `US-ARC-03`

## Context

The repository already defines the control-plane service split, PostgreSQL isolation baseline, and deployment-topology rules, but it still lacked one source of truth for how authorization context must be resolved and propagated across the product.

That gap is risky because the platform spans multiple planes and resource types:

- platform and control-plane APIs
- tenant and workspace administration
- PostgreSQL/MongoDB data surfaces
- Kafka topics and ACLs
- OpenWhisk function activations
- object storage buckets, objects, and presigned URLs

Without an explicit contextual-authorization model, later implementation work would risk:

- treating tenant identity as sufficient without verifying workspace membership
- propagating inconsistent role or scope data across adapters and audit records
- allowing resource-specific semantics to drift between database, bucket, topic, function, and app workflows
- creating privilege-escalation paths through delegation, replay, or plan/quota mismatches

The story depends conceptually on domain and IAM work that is not fully implemented yet, so the baseline must be precise enough to guide later code while remaining compatible with incremental delivery.

## Decision

Adopt a machine-readable authorization baseline in `services/internal-contracts/src/authorization-model.json`, backed by consumer helper exports, public API contract updates, repository validators, and negative-coverage tests.

### 1. Common security context

Every sensitive request must resolve one normalized security context containing at least:

- actor
- tenant identifier
- workspace identifier (nullable only when the resource is not workspace-scoped)
- tenant plan identifier
- granted scopes
- effective roles
- correlation identifier

Resolution is deny-by-default and must verify tenant binding before workspace binding.

### 2. Reusable authorization decision model

All enforcement surfaces must consume the same `authorization_decision` contract shape, even if enforcement happens through different runtime mechanisms:

- control-plane request handling
- data-plane sessions and RLS-compatible context
- function invocation metadata
- event headers and ACLs
- object-storage policy or presign metadata

### 3. Resource ownership and delegation semantics

Ownership is modeled by resource type:

- `tenant` is tenant-owned with audited platform override
- `workspace` is tenant-owned with workspace delegates
- `database`, `bucket`, `topic`, `function`, and `app` are workspace-owned resources

Delegation is explicit and limited to declared delegable actions. Delegation must never expand scopes or roles beyond the original chain.

### 4. Initial permission matrix by scope

Define an initial role catalog and permission matrix for:

- platform roles
- tenant roles
- workspace roles

The matrix is permissive only where explicitly listed. Missing actions are denied.

### 5. Context propagation and auditability

The resolved authorization context must propagate into internal control-plane contracts and downstream integration metadata through explicit targets such as:

- `control_api_command`
- `provisioning_request`
- `adapter_call`
- `audit_record`
- Kafka headers
- OpenWhisk activation annotations
- storage presign context

Audit evidence must preserve decision identifiers, correlation, role context, and delegation chain metadata without storing raw credentials.

## Consequences

### Positive

- Establishes one auditable source of truth for contextual authorization.
- Makes workspace scope a first-class part of the model instead of an implicit tenant sub-field.
- Keeps later IAM/domain implementation work aligned across control, data, function, event, and storage planes.
- Enables machine-checkable validation of permission matrices, propagation targets, and negative-coverage expectations.

### Trade-offs

- Adds another contract artifact that must remain aligned with the internal service map, OpenAPI, and tests.
- Documents more policy detail before live provider integrations exist.
- Leaves runtime enforcement mechanisms intentionally open while still constraining their observable behavior.

## Deferred work

This ADR does not implement:

- concrete Keycloak realm/group/client configuration
- persistence schema for memberships, invitations, or delegated grants
- live policy engines or middleware libraries
- end-user console screens for every new workspace role
- runtime quota calculators or billing ledgers

Those concerns must extend this baseline instead of inventing a parallel authorization model.
