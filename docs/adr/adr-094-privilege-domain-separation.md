# ADR-094: Admin–Data Privilege Separation

## Status

Accepted

## Context

A single compromised administrative credential can expose both control-plane capabilities and tenant application data in a multi-tenant BaaS. The platform needs a hard privilege-plane boundary so structural administration does not automatically imply data access, and vice versa.

## Decision

Implement exactly two top-level privilege domains (`structural_admin` / `data_access`):
- Every platform permission is classified into exactly one domain.
- Enforcement is implemented by extending the existing APISIX scope-enforcement plugin (T03).
- Domain claims are carried in Keycloak JWTs (`privilege_domain`) and in the `api_keys.privilege_domain` column.
- PostgreSQL stores `privilege_domain_assignments`, `privilege_domain_denials`, and `privilege_domain_assignment_history`.
- Feature flag `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED` supports log-only rollout before hard enforcement.

## Consequences

- Positive: hard security boundary and lower blast radius for compromised credentials.
- Negative: operational overhead to classify legacy API keys during migration.
- Mitigation: grace period (`APIKEY_DOMAIN_MIGRATION_GRACE_PERIOD_DAYS`) and `pending_classification` state.

## Alternatives Considered

- ABAC per-row policies: out of scope and too granular for this feature.
- Separate APISIX plugin: rejected to avoid duplicating claim extraction and cache logic from T03.
- Three domains including observability: deferred as a future extension.
