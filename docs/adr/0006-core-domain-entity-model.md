# ADR 0006: Canonical core domain entity model

- Status: Accepted
- Date: 2026-03-23
- Deciders: In Atelier platform architecture baseline
- Related backlog item: US-DOM-01
- Related ADRs:
  - ADR 0002: PostgreSQL tenant isolation model
  - ADR 0003: Control-plane service map
  - ADR 0004: Public-domain environment topology
  - ADR 0005: Contextual authorization model

## Context

The repository already defines:

- internal service boundaries and shared internal contracts
- deployment topology and environment profiles
- contextual authorization for platform, tenant, and workspace scopes

What is still missing is a canonical product domain model. Without one, later modules would likely invent overlapping but incompatible shapes for the same concepts: user, tenant, workspace, app registration, service account, and managed resource. That would fragment lifecycle semantics, audit behavior, contract design, and test fixtures.

The next delivery increments need one stable domain baseline that is:

- tenant- and workspace-safe
- compatible with the existing authorization vocabulary
- compatible with the deployment topology environment catalog
- explicit about relationships and business integrity rules
- reusable by OpenAPI, orchestration, audit, and future persistence layers

## Decision

Adopt one shared **core domain model** stored in `services/internal-contracts/src/domain-model.json`.

That model is the canonical source of truth for:

1. the six core entity types:
   - `platform_user`
   - `tenant`
   - `workspace`
   - `external_application`
   - `service_account`
   - `managed_resource`
2. shared identifiers, slug rules, lifecycle states, timestamps, and metadata limits
3. parent-child and membership relationships
4. global business invariants and entity-specific integrity rules
5. lifecycle transition vocabulary and emitted lifecycle event names
6. OpenAPI mapping metadata for canonical read/write contracts
7. seed fixture profiles for starter, growth, and enterprise/dedicated examples

## Entity model rules

### Shared baseline

All canonical entities share these baseline rules:

- stable identifier format: `<prefix>_<ulid>`
- lowercase URL-safe slugs
- common lifecycle states: `draft`, `provisioning`, `active`, `suspended`, `soft_deleted`
- required timestamps: `created_at`, `updated_at`
- optional lifecycle timestamps: `activated_at`, `suspended_at`, `deleted_at`
- metadata is additive and non-secret
- soft delete is logical first and preserves identifier reservation

### Entity boundaries

- `platform_user` is the only human actor entity in the canonical domain model.
- `tenant` is the root business/customer boundary and carries placement + plan metadata.
- `workspace` is the delegated delivery/runtime boundary inside one tenant.
- `external_application` is the workspace-owned app/client registration.
- `service_account` is the workspace-owned non-human identity.
- `managed_resource` is the workspace-owned backing resource registry for `database`, `bucket`, `topic`, and `function` kinds.

### Relationship rules

- tenant → workspace is required one-to-many
- workspace → external_application/service_account/managed_resource is one-to-many
- platform_user → tenant/workspace uses explicit membership relationships
- cross-tenant or cross-workspace references are invalid by default
- descendant entities cannot remain active when an ancestor is suspended or soft-deleted

## Lifecycle rules

The shared transition vocabulary is:

- `create`
- `activate`
- `suspend`
- `soft_delete`

Each core entity must publish one canonical lifecycle event per transition, for example:

- `tenant.created`
- `workspace.activated`
- `service_account.suspended`
- `managed_resource.soft_deleted`

Lifecycle events carry tenant/workspace bindings, correlation id, actor, and before/after state so audit and orchestration consumers can reuse one consistent envelope.

## Contract design implications

### Public API

The control-plane OpenAPI contract must expose canonical read/write schemas for the six entities. Write operations remain contract-first and can stay asynchronous, but they must reference the shared entity and lifecycle vocabulary.

### Authorization alignment

The domain model does not replace ADR 0005. Instead it aligns with it:

- tenant/workspace remain the root enforcement boundaries
- `external_application` is the canonical entity behind the `app` authorization resource type
- `managed_resource.kind` is constrained to authorization resource types that are workspace-owned (`database`, `bucket`, `topic`, `function`)

### Deployment alignment

The workspace environment catalog must stay aligned with deployment-topology environments (`dev`, `sandbox`, `staging`, `prod`).

### Persistence alignment

The canonical model is provider-agnostic. It may reference placement or provider metadata, but provider credentials and mutable secrets remain outside the entity model.

## Consequences

### Positive

- Downstream modules can reuse one domain vocabulary instead of inventing parallel models.
- OpenAPI, orchestration, authorization, audit, and fixtures stay aligned.
- Lifecycle semantics become explicit before runtime implementation.
- Seed data for demos/tests now reflects realistic tenant/workspace sizes.

### Negative / trade-offs

- Early canonical naming raises the cost of later breaking changes.
- Some provider-specific edge cases must be translated outside the domain model.
- The baseline is intentionally broad enough to cover future modules, so some fields will be consumed later rather than immediately.

## Follow-up guidance

- Extend the machine-readable contract before adding new entity consumers.
- Preserve prefix, slug, and soft-delete semantics unless a deliberate migration path is documented.
- Treat cross-tenant or cross-workspace reference expansion as an architecture decision, not an incidental code change.
