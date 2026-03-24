# ADR 0009: Keycloak platform and tenant IAM model

- Status: Accepted
- Date: 2026-03-24
- Deciders: In Atelier platform architecture baseline
- Related backlog item: US-IAM-01
- Related ADRs:
  - ADR 0003: Control-plane service map
  - ADR 0005: Contextual authorization model
  - ADR 0006: Canonical core domain entity model

## Context

The repository already defined:

- a control-plane service split with a provisioning orchestrator and provider adapters
- contextual authorization for platform, tenant, and workspace scopes
- a canonical domain model for platform users, tenants, workspaces, applications, and service accounts
- a deployment topology that exposes Keycloak through the shared public identity surface

What remained implicit was the IAM topology itself.

That gap was risky because later stories need one consistent answer for all of the following:

- where console operators authenticate
- where tenant end users authenticate
- how tenant activation provisions IAM state automatically
- how workspace applications map to Keycloak clients
- how service accounts and machine credentials stay isolated per workspace
- which realm attributes, roles, client scopes, and protocol mappers the control plane expects

Without a machine-readable IAM baseline, downstream work would likely drift across charts, control-plane contracts, APISIX gateway configuration, and provisioning flows.

## Decision

Adopt one explicit Keycloak IAM model that separates the **platform realm** from **tenant IAM contexts** and threads that model through contracts, deployment artifacts, and tests.

### 1. Platform realm for console operators

Use one stable platform realm, `in-atelier-platform`, for:

- platform operators and auditors
- tenant/workspace console administrators
- APISIX / console OIDC integration bootstrap
- platform-level realm roles and control-plane claim projections

Console identities are never reused as tenant end-user records.

### 2. Tenant IAM contexts for end users and workspace identities

Every tenant exposes one `identityContext` with at least:

- platform realm reference
- tenant realm identifier
- realm strategy (`realm_per_tenant`, `shared_realm_partition`, or `brokered_tenant_realm`)
- explicit separation between console realm and end-user realm

The initial deployment-profile baseline keeps `realm_per_tenant` as the default for shared and dedicated plans, while federated profiles may attach a brokered tenant realm.

### 3. Workspace client and service-account namespace

Inside each tenant IAM context:

- every workspace owns its own client namespace
- external applications map to one or more Keycloak clients in that namespace
- service accounts map to confidential clients / service-account users in the same workspace boundary
- client identifiers and credential references must remain deterministic and audit-friendly

### 4. Automatic provisioning on tenant activation

Tenant activation is not complete until provisioning reconciles:

- tenant realm existence or attachment
- required realm roles
- required client scopes
- required protocol mappers
- workspace application and service-account templates used by later onboarding flows

The provisioning contract therefore carries an `identity_blueprint_ref` so retries and audits can refer to one immutable IAM baseline snapshot.

### 5. Control-plane-required Keycloak metadata

The Keycloak baseline must publish the claim and metadata fields required by the control plane and gateway, including:

- `tenant_id`
- `workspace_id`
- `plan_id`
- workspace role projections
- realm attributes that identify platform vs tenant scope

## Consequences

### Positive

- The repository now has one auditable IAM vocabulary across domain, authorization, service-map, OpenAPI, and Helm artifacts.
- Tenant activation and workspace onboarding can evolve without inventing parallel Keycloak assumptions.
- APISIX claim propagation, control-plane contracts, and bootstrap payloads share the same mapper/client-scope baseline.
- Multi-workspace and multi-client tenant examples are now explicit in reference fixtures.

### Trade-offs

- The contract baseline becomes stricter, so later breaking changes to realm strategy or mapper naming require a documented migration.
- The repository models production-shaped IAM artifacts before live runtime controllers fully exist.
- Federated profiles still need future implementation detail around broker configuration and external directory trust.

## Follow-up guidance

- Extend the shared `identity_blueprint` contract instead of creating ad-hoc Keycloak payload shapes.
- Keep secrets out of canonical entities and values files; only secret references belong in the repo.
- Treat realm/client naming changes as architecture migrations, not incidental refactors.
