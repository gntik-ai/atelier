# Contextual authorization baseline

This note is the human-readable companion to `services/internal-contracts/src/authorization-model.json` introduced by `US-ARC-03`.

## Goal

Give the platform one consistent way to resolve and propagate authorization for multi-tenant, multi-workspace operations so that control-plane handlers, adapters, audit, and future runtime implementations all speak the same language.

## Common security context

Every sensitive operation resolves a normalized context with these required fields:

- `actor`
- `tenant_id`
- `workspace_id`
- `plan_id`
- `scopes`
- `effective_roles`
- `correlation_id`

The repository baseline treats missing or ambiguous context as a denial condition, not a warning.

## Resolution order

1. Authenticate the actor and classify the credential source.
2. Resolve the target tenant.
3. Resolve the target workspace and prove it belongs to the tenant.
4. Merge platform, tenant, and workspace bindings into one effective role set.
5. Intersect effective roles with scopes and plan guardrails.
6. Reuse one correlation identifier across control, adapters, events, functions, storage, and audit.

## Enforcement surfaces

The same decision contract is consumed across five surfaces:

- `control_api`
- `data_api`
- `functions_runtime`
- `event_bus`
- `object_storage`

This keeps the decision vocabulary stable even when enforcement differs by plane, for example HTTP middleware, RLS session settings, event ACLs, or presigned URL policy.

## Ownership and delegation

### Tenant resource

- tenant-scoped resource
- may be overridden by audited platform roles
- may delegate tenant membership, workspace creation, and usage-read workflows only when explicitly allowed

### Workspace resource

- tenant-owned resource with workspace delegates
- workspace membership is not interchangeable across workspaces in the same tenant

### Workspace-owned resources

The following resource types inherit the workspace boundary and must never be accessed without matching workspace context:

- database
- bucket
- topic
- function
- app

## Initial role scopes

### Platform roles

- `platform_admin`
- `platform_operator`
- `platform_auditor`

### Tenant roles

- `tenant_admin`
- `tenant_operator`
- `tenant_billing_admin`
- `auditor`

### Workspace roles

- `workspace_admin`
- `workspace_developer`
- `workspace_operator`
- `workspace_auditor`
- `workspace_viewer`

The machine-readable permission matrix is allow-list based. Any action not explicitly granted is denied by default.

## Propagation rules

The resolved context must survive the following hops without silent loss of tenant/workspace/correlation semantics:

- control API -> internal command
- control API -> provisioning request
- provisioning -> adapter call
- edge/orchestration -> audit record
- event publication -> Kafka headers
- function invocation -> OpenWhisk activation metadata
- storage access -> presign context

Raw credentials and tokens are explicitly redacted from downstream projections.

## Negative coverage baseline

The repository now requires coverage for at least these abuse classes:

- cross-tenant access
- workspace mismatch
- delegation escalation
- storage ACL bypass
- event replay with mismatched headers
- plan guardrail violations

Later stories may add more scenarios, but they should extend the baseline rather than weaken it.
