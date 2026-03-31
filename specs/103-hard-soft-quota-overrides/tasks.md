# Tasks: Hard & Soft Quotas with Superadmin Override

**Branch**: `103-hard-soft-quota-overrides` | **Generated**: 2026-03-31  
**Task ID**: US-PLAN-02-T01 | **Epic**: EP-19 | **Story**: US-PLAN-02  
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)  
**Depends on**: US-PLAN-01 (`097-plan-entity-tenant-assignment`, `098-plan-base-limits`), US-OBS-03 (metering infrastructure)

---

## File Path Map

> All paths are relative to `/root/projects/atelier`.
> During `speckit.implement`, read only the paths listed here plus `plan.md` and `tasks.md`.
> **TARGETED FILE READS ONLY**: do not broaden beyond these files.
> **NO FULL OPENAPI**: never read `apps/control-plane/openapi/control-plane.openapi.json` directly; only read a relevant family file under `apps/control-plane/openapi/families/` if a route surface absolutely needs it.
> **MINIMAL SPEC CONTEXT**: the later implement step will receive only `plan.md` and `tasks.md`, not `spec.md`, `research.md`, `data-model.md`, or `quickstart.md`.
> Use **focused helper reads** and **focused test reads** only; no exploratory browsing.
> Preserve unrelated untracked artifacts exactly as-is:
> - `specs/070-saga-compensation-workflows/plan.md`
> - `specs/070-saga-compensation-workflows/tasks.md`
> - `specs/072-workflow-e2e-compensation/tasks.md`

### Documentation / contracts

| Alias | Path | Status |
|---|---|---|
| TASKS | `specs/103-hard-soft-quota-overrides/tasks.md` | MODIFY |
| PLAN | `specs/103-hard-soft-quota-overrides/plan.md` | READ |
| DATA_MODEL | `specs/103-hard-soft-quota-overrides/data-model.md` | UPDATE |
| QUICKSTART | `specs/103-hard-soft-quota-overrides/quickstart.md` | UPDATE |
| CONTRACT_CREATE | `specs/103-hard-soft-quota-overrides/contracts/quota-override-create.json` | UPDATE |
| CONTRACT_MODIFY | `specs/103-hard-soft-quota-overrides/contracts/quota-override-modify.json` | UPDATE |
| CONTRACT_REVOKE | `specs/103-hard-soft-quota-overrides/contracts/quota-override-revoke.json` | UPDATE |
| CONTRACT_LIST | `specs/103-hard-soft-quota-overrides/contracts/quota-override-list.json` | UPDATE |
| CONTRACT_EFFECTIVE_LIMITS | `specs/103-hard-soft-quota-overrides/contracts/quota-effective-limits-get.json` | UPDATE |
| CONTRACT_ENFORCE | `specs/103-hard-soft-quota-overrides/contracts/quota-enforce.json` | UPDATE |
| CONTRACT_AUDIT_QUERY | `specs/103-hard-soft-quota-overrides/contracts/quota-audit-query.json` | CREATE |

### Source code to create or update

| Alias | Path | Status |
|---|---|---|
| MIGRATION_103 | `services/provisioning-orchestrator/src/migrations/103-hard-soft-quota-overrides.sql` | CREATE |
| MODEL_QUOTA_DIMENSION | `services/provisioning-orchestrator/src/models/quota-dimension.mjs` | MODIFY |
| MODEL_QUOTA_OVERRIDE | `services/provisioning-orchestrator/src/models/quota-override.mjs` | CREATE |
| MODEL_QUOTA_ENFORCEMENT | `services/provisioning-orchestrator/src/models/quota-enforcement.mjs` | CREATE |
| REPO_QUOTA_OVERRIDE | `services/provisioning-orchestrator/src/repositories/quota-override-repository.mjs` | CREATE |
| REPO_QUOTA_ENFORCEMENT | `services/provisioning-orchestrator/src/repositories/quota-enforcement-repository.mjs` | CREATE |
| REPO_QUOTA_AUDIT | `services/provisioning-orchestrator/src/repositories/quota-audit-repository.mjs` | CREATE |
| EVENTS_QUOTA_OVERRIDE | `services/provisioning-orchestrator/src/events/quota-override-events.mjs` | CREATE |
| EVENTS_QUOTA_ENFORCEMENT | `services/provisioning-orchestrator/src/events/quota-enforcement-events.mjs` | CREATE |
| ACTION_PLAN_LIMITS_SET | `services/provisioning-orchestrator/src/actions/plan-limits-set.mjs` | MODIFY |
| ACTION_PLAN_LIMITS_PROFILE_GET | `services/provisioning-orchestrator/src/actions/plan-limits-profile-get.mjs` | MODIFY |
| ACTION_PLAN_LIMITS_TENANT_GET | `services/provisioning-orchestrator/src/actions/plan-limits-tenant-get.mjs` | MODIFY |
| ACTION_QUOTA_OVERRIDE_CREATE | `services/provisioning-orchestrator/src/actions/quota-override-create.mjs` | CREATE |
| ACTION_QUOTA_EFFECTIVE_LIMITS_GET | `services/provisioning-orchestrator/src/actions/quota-effective-limits-get.mjs` | CREATE |
| ACTION_QUOTA_OVERRIDE_MODIFY | `services/provisioning-orchestrator/src/actions/quota-override-modify.mjs` | CREATE |
| ACTION_QUOTA_OVERRIDE_REVOKE | `services/provisioning-orchestrator/src/actions/quota-override-revoke.mjs` | CREATE |
| ACTION_QUOTA_OVERRIDE_LIST | `services/provisioning-orchestrator/src/actions/quota-override-list.mjs` | CREATE |
| ACTION_QUOTA_OVERRIDE_EXPIRY_SWEEP | `services/provisioning-orchestrator/src/actions/quota-override-expiry-sweep.mjs` | CREATE |
| ACTION_QUOTA_ENFORCE | `services/provisioning-orchestrator/src/actions/quota-enforce.mjs` | CREATE |
| ACTION_QUOTA_AUDIT_QUERY | `services/provisioning-orchestrator/src/actions/quota-audit-query.mjs` | CREATE |

### Test fixtures and automated tests

| Alias | Path | Status |
|---|---|---|
| FIXTURE_PLANS | `tests/integration/103-hard-soft-quota-overrides/fixtures/seed-plans-with-quota-types.mjs` | CREATE |
| FIXTURE_OVERRIDES | `tests/integration/103-hard-soft-quota-overrides/fixtures/seed-overrides.mjs` | CREATE |
| FIXTURE_TENANTS | `tests/integration/103-hard-soft-quota-overrides/fixtures/seed-tenants.mjs` | CREATE |
| FIXTURE_USAGE | `tests/integration/103-hard-soft-quota-overrides/fixtures/seed-usage.mjs` | CREATE |
| TEST_CLASSIFICATION | `tests/integration/103-hard-soft-quota-overrides/quota-type-classification.test.mjs` | CREATE |
| TEST_OVERRIDE_CRUD | `tests/integration/103-hard-soft-quota-overrides/quota-override-crud.test.mjs` | CREATE |
| TEST_OVERRIDE_EXPIRY | `tests/integration/103-hard-soft-quota-overrides/quota-override-expiry.test.mjs` | CREATE |
| TEST_ENFORCEMENT | `tests/integration/103-hard-soft-quota-overrides/quota-enforcement.test.mjs` | CREATE |
| TEST_AUDIT | `tests/integration/103-hard-soft-quota-overrides/quota-audit.test.mjs` | CREATE |
| TEST_ISOLATION | `tests/integration/103-hard-soft-quota-overrides/quota-isolation.test.mjs` | CREATE |
| TEST_CONTRACTS | `tests/contract/103-hard-soft-quota-overrides/quota-contracts.test.mjs` | CREATE |

### Read-only reference files for focused implementation

| Alias | Path | Purpose |
|---|---|---|
| REF_MIGRATION_097 | `services/provisioning-orchestrator/src/migrations/097-plan-entity-tenant-assignment.sql` | Existing `plans` / `plan_audit_events` schema |
| REF_MIGRATION_098 | `services/provisioning-orchestrator/src/migrations/098-plan-base-limits.sql` | Existing `quota_dimension_catalog` / `plans.quota_dimensions` semantics |
| REF_PLAN_LIMITS_REPO | `services/provisioning-orchestrator/src/repositories/plan-limits-repository.mjs` | Existing plan-limits repository pattern |
| REF_QUOTA_CATALOG_REPO | `services/provisioning-orchestrator/src/repositories/quota-dimension-catalog-repository.mjs` | Existing catalog lookup pattern |
| REF_USAGE_SNAPSHOT_REPO | `services/provisioning-orchestrator/src/repositories/tenant-usage-snapshot-repository.mjs` | Existing metering/usage retrieval pattern |
| REF_PLAN_LIMITS_SET | `services/provisioning-orchestrator/src/actions/plan-limits-set.mjs` | Existing action shape and auth pattern |
| REF_PLAN_LIMITS_PROFILE_GET | `services/provisioning-orchestrator/src/actions/plan-limits-profile-get.mjs` | Existing profile read pattern |
| REF_PLAN_LIMITS_TENANT_GET | `services/provisioning-orchestrator/src/actions/plan-limits-tenant-get.mjs` | Existing tenant-scoped profile pattern |
| REF_QUOTA_CATALOG_LIST | `services/provisioning-orchestrator/src/actions/quota-dimension-catalog-list.mjs` | Existing catalog-list action shape |
| REF_PLAN_LIMIT_EVENTS | `services/provisioning-orchestrator/src/events/plan-limit-events.mjs` | Existing Kafka event envelope pattern |
| REF_SCOPE_AUDIT_QUERY | `services/provisioning-orchestrator/src/actions/scope-enforcement-audit-query.mjs` | Existing audit-query pattern |
| REF_PRIVILEGE_AUDIT_QUERY | `services/provisioning-orchestrator/src/actions/privilege-domain-audit-query.mjs` | Existing tenant-scoped audit query pattern |
| REF_PRIVILEGE_EVENT_RECORDER | `services/provisioning-orchestrator/src/actions/privilege-domain-event-recorder.mjs` | Existing event-recorder pattern for audit ingestion |
| REF_PLAN_LIMITS_SET_TEST | `tests/integration/098-plan-base-limits/plan-limits-set.test.mjs` | Existing integration-test style for plan limits writes |
| REF_PLAN_LIMITS_PROFILE_TEST | `tests/integration/098-plan-base-limits/plan-limits-profile.test.mjs` | Existing profile/response assertions pattern |
| REF_PLAN_AUDIT_TEST | `tests/integration/097-plan-entity-tenant-assignment/plan-audit.test.mjs` | Existing audit-table assertions pattern |
| REF_SCOPE_AUDIT_TEST | `tests/scope-enforcement/audit-query.integration.test.mjs` | Existing audit-query coverage pattern |

---

## Execution Order

Follow this order. Do not skip ahead.

### Phase 1 — Schema and shared domain foundation

**Goal**: Establish the quota override schema, plan quota-type metadata, and reusable domain helpers.

**Independent test criteria**: the migration applies cleanly, domain helpers validate hard/soft/unlimited values, and enforcement logic can be exercised without the higher-level actions.

- [ ] T001 Create `services/provisioning-orchestrator/src/migrations/103-hard-soft-quota-overrides.sql` with `plans.quota_type_config`, `quota_overrides`, and `quota_enforcement_log`, including the indexes, partial unique constraint, and seed/validation rules described in `data-model.md`.
- [ ] T002 Create `services/provisioning-orchestrator/src/models/quota-dimension.mjs` and `services/provisioning-orchestrator/src/models/quota-override.mjs` with the limit-sentinel helpers, quota-type/grace validation, expiry/justification checks, and lifecycle-state normalization used by the repositories and actions.
- [ ] T003 Create `services/provisioning-orchestrator/src/models/quota-enforcement.mjs` with effective-limit normalization, hard vs soft decision logic, grace-ceiling calculation, unlimited handling, and fail-closed metering error normalization.

**Checkpoint**: Schema + reusable domain logic are ready for repository and action implementation.

### Phase 2 — Repositories and event emitters

**Goal**: Build the persistence and Kafka primitives used by all user stories.

**Independent test criteria**: override CRUD can persist and list records, enforcement logs can be written and queried, and Kafka envelopes are emitted with the expected event payloads.

- [ ] T004 Create `services/provisioning-orchestrator/src/repositories/quota-override-repository.mjs` with create, supersede, modify, revoke, expiry-sweep, and paginated list/query helpers over `quota_overrides`.
- [ ] T005 Create `services/provisioning-orchestrator/src/repositories/quota-enforcement-repository.mjs` with effective-limit resolution, enforcement-log persistence, and query helpers for tenant, dimension, actor, and time-range filtering.
- [ ] T006 [P] Create `services/provisioning-orchestrator/src/events/quota-override-events.mjs` for `quota.override.created`, `quota.override.modified`, `quota.override.revoked`, `quota.override.expired`, and `quota.override.superseded` Kafka envelopes.
- [ ] T007 [P] Create `services/provisioning-orchestrator/src/events/quota-enforcement-events.mjs` for `console.quota.hard_limit.blocked` and `console.quota.soft_limit.exceeded` Kafka envelopes.

**Checkpoint**: Lower-level persistence and event primitives are ready.

### Phase 3 — User Story 1 — Superadmin classifies quota dimensions as hard or soft per plan (Priority: P1)

**Goal**: Persist plan-level hard/soft classification and grace margins, while keeping the default behavior hard when metadata is absent.

**Independent test criteria**: a plan can be saved with hard and soft dimensions, missing metadata defaults to hard/0, and the profile APIs expose the effective classification consistently.

- [ ] T008 [US1] Update `services/provisioning-orchestrator/src/repositories/plan-limits-repository.mjs`, `services/provisioning-orchestrator/src/actions/plan-limits-set.mjs`, `services/provisioning-orchestrator/src/actions/plan-limits-profile-get.mjs`, and `services/provisioning-orchestrator/src/actions/plan-limits-tenant-get.mjs` to read/write `plans.quota_type_config`, validate soft grace margins, default absent dimensions to hard, and surface quota-type/grace metadata in plan profile responses.
- [ ] T009 [P] [US1] Add `tests/integration/103-hard-soft-quota-overrides/quota-type-classification.test.mjs` plus `tests/integration/103-hard-soft-quota-overrides/fixtures/seed-plans-with-quota-types.mjs` to verify hard-vs-soft persistence, default-hard fallback, and the zero-grace soft edge case.

**Checkpoint**: Plan-level hard/soft classification is persisted and queryable.

### Phase 4 — User Story 2 — Superadmin creates a tenant quota override (Priority: P1)

**Goal**: Create per-tenant overrides with mandatory justification and return effective limits with source metadata.

**Independent test criteria**: an override can be created, a missing justification is rejected, a superseding override replaces the previous active one, and effective-limit queries reflect override > plan > catalog-default resolution.

- [ ] T010 [US2] Create `services/provisioning-orchestrator/src/actions/quota-override-create.mjs` to validate tenant/dimension/value/justification/expiry, enforce the single-active-override rule, persist `quota_overrides`, write the audit row, and emit `quota.override.created`.
- [ ] T011 [P] [US2] Create `services/provisioning-orchestrator/src/actions/quota-effective-limits-get.mjs` to resolve effective limits for a tenant, include source metadata and override metadata for superadmin callers, and hide override-only details for tenant-owner callers.
- [ ] T012 [P] [US2] Add `tests/integration/103-hard-soft-quota-overrides/quota-override-crud.test.mjs` and `tests/integration/103-hard-soft-quota-overrides/fixtures/seed-overrides.mjs` to cover create, missing-justification rejection, supersession, effective-limit resolution, and the tenant/dimension list filters used by superadmins.

**Checkpoint**: Superadmins can create overrides and inspect effective limits.

### Phase 5 — User Story 3 — Superadmin revokes or modifies an existing override (Priority: P2)

**Goal**: Support override lifecycle management, including modify, revoke, list, and expiry cleanup.

**Independent test criteria**: an active override can be modified or revoked, only one active override per tenant/dimension exists at a time, the list endpoint is paginated and filterable, and expired overrides stop affecting enforcement within one sweep cycle.

- [ ] T013 [P] [US3] Create `services/provisioning-orchestrator/src/actions/quota-override-modify.mjs` to update an active override, capture previous and new state, preserve audit history, and emit `quota.override.modified`.
- [ ] T014 [P] [US3] Create `services/provisioning-orchestrator/src/actions/quota-override-revoke.mjs` to revoke an active override with mandatory justification, revert the effective value, and emit `quota.override.revoked`.
- [ ] T015 [P] [US3] Create `services/provisioning-orchestrator/src/actions/quota-override-list.mjs` and `services/provisioning-orchestrator/src/actions/quota-override-expiry-sweep.mjs` to provide paginated superadmin listing and periodic expiry transitions for active overrides.
- [ ] T016 [P] [US3] Add `tests/integration/103-hard-soft-quota-overrides/quota-override-expiry.test.mjs` and, if needed, extend `tests/integration/103-hard-soft-quota-overrides/quota-override-crud.test.mjs` to verify modify/revoke flow, expiry sweep behavior, and query-time exclusion of expired overrides.

**Checkpoint**: Override lifecycle management is complete.

### Phase 6 — User Story 4 — System enforces hard vs soft quotas at resource creation time (Priority: P1)

**Goal**: Resolve the effective quota and apply the correct hard/soft/unlimited decision at runtime.

**Independent test criteria**: hard limits block at threshold, soft limits allow within grace and warn, grace exhaustion blocks, overrides change the runtime ceiling, unlimited skips checks, and metering failures fail closed.

- [ ] T017 [US4] Create `services/provisioning-orchestrator/src/actions/quota-enforce.mjs` to resolve current usage, apply hard/soft/unlimited rules, fail closed on metering unavailability, persist enforcement logs, and emit the correct Kafka topic for the decision.
- [ ] T018 [P] [US4] Add `tests/integration/103-hard-soft-quota-overrides/quota-enforcement.test.mjs` plus `tests/integration/103-hard-soft-quota-overrides/fixtures/seed-usage.mjs` and `tests/integration/103-hard-soft-quota-overrides/fixtures/seed-tenants.mjs` to verify hard-block, soft-grace-allow, grace-exhausted, override-effective-limit, unlimited-sentinel, zero-grace, and metering-unavailable cases.

**Checkpoint**: Runtime enforcement behaves correctly for hard, soft, unlimited, and override scenarios.

### Phase 7 — User Story 5 — Audit trail for quota and override operations (Priority: P2)

**Goal**: Provide a queryable audit trail for override lifecycle events and enforcement decisions with tenant-safe scoping.

**Independent test criteria**: override lifecycle and enforcement records are queryable by tenant/dimension/actor/time range, superadmins can query across tenants, tenant owners are scoped to their own tenant, and sensitive override metadata is redacted from tenant-owner results.

- [ ] T019 [US5] Create `services/provisioning-orchestrator/src/actions/quota-audit-query.mjs` and `services/provisioning-orchestrator/src/repositories/quota-audit-repository.mjs` to query `plan_audit_events` plus `quota_enforcement_log` with tenant, dimension, actor, and time-range filters and the correct authorization scoping.
- [ ] T020 [P] [US5] Add `tests/integration/103-hard-soft-quota-overrides/quota-audit.test.mjs` and `tests/integration/103-hard-soft-quota-overrides/quota-isolation.test.mjs` to verify audit completeness, Kafka emission coverage, cross-tenant isolation, and tenant-owner redaction rules.

**Checkpoint**: Audit and isolation behavior is verified.

### Phase 8 — Contracts, docs, and validation

**Goal**: Keep the API schemas, docs, and repo-level metadata aligned with the implementation.

**Independent test criteria**: contracts validate against the final action payloads, docs describe the final data model and runbook, and AGENTS reflects the new feature slice and read constraints.

- [ ] T021 [P] Update `specs/103-hard-soft-quota-overrides/contracts/` by keeping the six existing JSON contracts aligned with the final action shapes and creating `specs/103-hard-soft-quota-overrides/contracts/quota-audit-query.json` for the new audit query action.
- [ ] T022 [P] Create `tests/contract/103-hard-soft-quota-overrides/quota-contracts.test.mjs` to validate the quota override, effective-limit, enforcement, and audit-query contracts against the JSON files in `specs/103-hard-soft-quota-overrides/contracts/`.
- [ ] T023 [P] Update `specs/103-hard-soft-quota-overrides/data-model.md` and `specs/103-hard-soft-quota-overrides/quickstart.md` so they match the final migration, Kafka topics, env vars, query flows, and operator steps.
- [ ] T024 Update `AGENTS.md` with the `103-hard-soft-quota-overrides` section describing `plans.quota_type_config`, `quota_overrides`, `quota_enforcement_log`, the new env vars, and the targeted implement-read constraints for this branch.

---

## Dependency Graph

```text
T001 (schema)
 ├─► T002 (domain models)
 │    └─► T003 (enforcement model)
 └─► T004 / T005 / T006 / T007

T004 + T005 + T006 + T007
 ├─► T008 (plan classification)
 ├─► T010 (override create)
 ├─► T011 (effective limits)
 ├─► T013 / T014 / T015 (override lifecycle)
 ├─► T017 (runtime enforcement)
 └─► T019 (audit query)

T008 ──► T009
T010 ──► T012
T013 / T014 / T015 ──► T016
T017 ──► T018
T019 ──► T020
T021 / T022 / T023 / T024 can proceed once the relevant source actions stabilize.
```

## Parallel Execution Opportunities

- `T006` and `T007` can run in parallel after the schema/model foundation is in place.
- `T011` and `T012` can run in parallel once `T010` is stable enough to define the payload shape.
- `T013`, `T014`, and `T015` can run in parallel after `T004`/`T006` are available.
- `T018`, `T020`, `T022`, and `T023` can be worked in parallel once their corresponding source files stabilize.

## Implementation Strategy

**MVP first**: complete `T001`–`T012` and `T017`–`T018` so the platform can classify plan quotas, create tenant overrides, resolve effective limits, and enforce hard/soft/unlimited behavior at runtime.

**Next increment**: complete `T013`–`T016` so overrides can be modified, revoked, listed, and expired safely.

**Final increment**: complete `T019`–`T024` to make the audit trail queryable, lock down isolation rules, and finish the docs/contracts/metadata.

---

## Summary

- **Total tasks**: 24
- **Tasks per user story**: US1=2 · US2=3 · US3=4 · US4=2 · US5=2 · Setup/Foundational=7 · Docs/Contracts=4
- **Parallel opportunities**: 8+ tasks have safe parallel windows once the schema and repositories are in place
- **Suggested MVP**: T001–T012 + T017–T018
- **Validation note**: all tasks follow the required checklist format (`- [ ] T### [P] [US?] ...`) and include explicit file paths
