# Implementation Plan: US-OBS-02-T02 — Canonical Audit Event Schema

**Feature Branch**: `032-observability-audit-schema`
**Spec**: `specs/032-observability-audit-schema/spec.md`
**Task**: `US-OBS-02-T02`
**Created**: 2026-03-28
**Status**: Planned

---

## 1. Technical Objective

Deliver the bounded T02 baseline for `US-OBS-02` by adding a machine-readable **canonical audit event schema contract** plus deterministic validation, shared readers, documentation, and tests.

This increment must standardize the required event envelope for:

- event identity,
- timestamp,
- actor,
- scope,
- resource,
- action,
- result,
- correlation id,
- origin,
- and a bounded subsystem-specific detail extension.

The increment must remain strictly below query/export/masking/correlation implementation work. No runtime emitters, APIs, Kafka topics, storage adapters, or UI behavior are introduced here.

---

## 2. Architecture and Scope Boundaries

### 2.1 Position in the audit story

- `US-OBS-02-T01` defined **where** audit events flow and which subsystems must participate.
- `US-OBS-02-T02` defines **what one canonical audit event looks like**.
- `US-OBS-02-T03` and later tasks will consume this schema to implement filtering, export, masking, and correlation.

### 2.2 Bounded architecture slice

This task adds only **contract-layer artifacts**:

```text
observability-audit-pipeline (T01)
        ↓ provides required event categories + scope rules
observability-audit-event-schema (T02)
        ↓ provides canonical event envelope + vocabularies
future audit query/export/correlation tasks (T03–T06)
```

### 2.3 Source contracts consumed

The new schema contract should validate against:

- `services/internal-contracts/src/observability-audit-pipeline.json` for category and scope compatibility.
- `services/internal-contracts/src/authorization-model.json` for actor/scope/correlation naming alignment.

### 2.4 Explicit non-goals

This task will not:

- add or modify audit query routes,
- define export file formats,
- decide masking execution rules,
- implement correlation chains or causation graphs,
- write adapter/runtime emitters,
- modify Kafka/storage/provider code,
- or add database persistence behavior.

---

## 3. Target Contract Shape

### 3.1 New contract artifact

Add `services/internal-contracts/src/observability-audit-event-schema.json` as the machine-readable source of truth.

Recommended top-level structure:

```json
{
  "version": "2026-03-28",
  "scope": "US-OBS-02-T02",
  "system": "in-falcone-observability-plane",
  "source_audit_pipeline_contract": "2026-03-28",
  "source_authorization_contract": "<authorization-model version>",
  "required_top_level_fields": [...],
  "event_identity": {...},
  "actor": {...},
  "scope_envelope": {...},
  "resource": {...},
  "action": {...},
  "result": {...},
  "origin": {...},
  "detail_extension": {...},
  "governance": {...}
}
```

### 3.2 Required top-level field inventory

The contract should expose an explicit ordered inventory such as:

- `event_id`
- `event_timestamp`
- `actor`
- `scope`
- `resource`
- `action`
- `result`
- `correlation_id`
- `origin`
- `detail`

The first nine are canonical envelope fields. `detail` remains the bounded extension area.

### 3.3 Event identity section

Define:

- stable event id requirement,
- schema version requirement,
- timestamp semantics,
- record immutability expectations.

### 3.4 Actor section

Define normalized actor fields and vocabulary:

- required fields: `actor_id`, `actor_type`
- optional fields: `display_name`, `service_account_id`, `effective_role_scope`
- bounded actor types: e.g. `platform_user`, `tenant_user`, `workspace_user`, `service_account`, `system`, `provider_adapter`

This must align with the authorization model naming without reworking the authorization contract itself.

### 3.5 Scope section

Define scope rules:

- tenant-scoped events require `tenant_id`
- workspace attribution is optional unless the emitting subsystem is workspace-aware
- platform-scoped events must declare a scope mode that allows missing tenant/workspace ids without ambiguity
- no default tenant/workspace fabrication allowed

### 3.6 Resource section

Define normalized resource identity fields:

- `subsystem_id`
- `resource_type`
- `resource_id`
- optional `resource_display_name`
- optional `parent_resource_id`

The contract should state when `resource_id` may be omitted and what substitute reference is allowed.

### 3.7 Action section

Define:

- required `action_id`
- normalized `category`
- optional `change_type`
- optional `requested_operation`

The category vocabulary must cover every category required by the T01 pipeline contract, including at least:

- `resource_creation`
- `resource_deletion`
- `configuration_change`
- `access_control_modification`
- `quota_adjustment`

Additional bounded categories may be included if needed for completeness, but avoid scope creep.

### 3.8 Result section

Define a normalized outcome vocabulary such as:

- `succeeded`
- `failed`
- `denied`
- `partial`
- `accepted`

Also define optional `error_code`, `failure_reason`, or `policy_basis` fields without prescribing query/export semantics.

### 3.9 Origin section

Define a bounded normalized origin vocabulary for where the action came from, for example:

- `control_api`
- `console_backend`
- `internal_reconciler`
- `provider_adapter`
- `bootstrap_job`
- `scheduled_operation`

This section should also carry the producing service identifier or execution surface, but must stay implementation-agnostic.

### 3.10 Detail extension section

Reserve a bounded `detail` extension area with rules:

- canonical envelope fields may not be moved into `detail`
- subsystem-specific extra fields belong in `detail`
- masking/export/correlation rules are deferred to later tasks

---

## 4. Artifact-by-Artifact Change Plan

### 4.1 `services/internal-contracts/src/observability-audit-event-schema.json` (new)

Add the canonical schema contract with:

- `version: "2026-03-28"`
- `scope: "US-OBS-02-T02"`
- `source_audit_pipeline_contract`
- `source_authorization_contract`
- `required_top_level_fields`
- sections for `event_identity`, `actor`, `scope_envelope`, `resource`, `action`, `result`, `origin`, `detail_extension`, and `governance`

### 4.2 `services/internal-contracts/src/index.mjs`

Add:

- `OBSERVABILITY_AUDIT_EVENT_SCHEMA_URL`
- cached reader state
- `readObservabilityAuditEventSchema()`
- `OBSERVABILITY_AUDIT_EVENT_SCHEMA_VERSION`
- accessors:
  - `getAuditEventRequiredFields()`
  - `getAuditActorSchema()`
  - `getAuditScopeEnvelope()`
  - `getAuditResourceSchema()`
  - `getAuditActionSchema()`
  - `getAuditResultSchema()`
  - `getAuditOriginSchema()`

Follow the established observability reader/export pattern exactly.

### 4.3 `scripts/lib/observability-audit-event-schema.mjs` (new)

Add helper exports:

- `readObservabilityAuditEventSchema()`
- `readObservabilityAuditPipeline()`
- `readAuthorizationModel()`
- `collectAuditEventSchemaViolations(contract, auditPipeline, authorizationModel)`

Deterministic validation should cover at minimum:

1. version is non-empty
2. `source_audit_pipeline_contract` matches T01 contract version
3. `source_authorization_contract` matches authorization model version
4. all required top-level envelope fields are present
5. actor required fields include `actor_id` and `actor_type`
6. scope rules preserve `tenant_id` semantics and workspace optionality
7. action category vocabulary covers all categories required by T01
8. result vocabulary includes the bounded normalized outcomes
9. `correlation_id` is required at the top level
10. origin vocabulary and required fields are present

### 4.4 `scripts/validate-observability-audit-event-schema.mjs` (new)

CLI entry point that:

- loads the new schema contract,
- loads T01 audit pipeline and authorization model,
- runs `collectAuditEventSchemaViolations`,
- prints each violation,
- exits non-zero on any failure.

### 4.5 `package.json`

Add:

- `validate:observability-audit-event-schema`

Wire it into `validate:repo` adjacent to the existing observability validation scripts.

### 4.6 `docs/reference/architecture/observability-audit-event-schema.md` (new)

Human-readable architecture companion describing:

- canonical envelope sections,
- required vs conditional fields,
- normalized vocabularies,
- alignment with T01,
- explicit scope boundary versus T03–T06.

### 4.7 `docs/reference/architecture/README.md`

Add discoverability entries for the new machine-readable contract and human-readable audit-event-schema architecture note.

### 4.8 `docs/tasks/us-obs-02.md`

Append a new `US-OBS-02-T02` section summarizing:

- canonical event schema baseline,
- reader/validator additions,
- downstream dependency note for query/export/masking/correlation work.

### 4.9 `specs/032-observability-audit-schema/{spec,plan,tasks}.md`

Materialize the bounded Spec Kit artifacts for T02.

---

## 5. Data, Security, and Compatibility Considerations

### 5.1 Data and schema compatibility

This is a **contract-only** increment. No persistence migration, storage format migration, or emitted runtime payload migration is introduced.

### 5.2 Multi-tenant safety

The schema must preserve the T01 tenant isolation model by making scope requirements explicit.

### 5.3 Forward compatibility

The contract should be additive so later tasks can extend behavior without renaming or weakening the canonical envelope.

### 5.4 Sensitive data posture

Do not define masking rules here. Instead, ensure the schema separates common envelope fields from subsystem-specific detail payloads so T04 can classify sensitive fields later.

### 5.5 Rollback

Rollback is trivial and low-risk because the increment is confined to static contract artifacts, validation helpers, docs, and tests.

---

## 6. Testing Strategy

### 6.1 Unit tests

Add `tests/unit/observability-audit-event-schema.test.mjs` covering deterministic helper behavior. Minimum assertions:

- valid contract returns `[]`
- removing a required top-level field returns a targeted violation
- removing `actor_id` or `actor_type` returns a targeted violation
- removing `correlation_id` from the required field inventory returns a targeted violation
- changing `source_audit_pipeline_contract` returns a version mismatch violation
- removing a required T01 action category from the schema vocabulary returns a targeted violation

### 6.2 Contract tests

Add `tests/contracts/observability-audit-event-schema.contract.test.mjs` covering:

- reader resolves
- version export matches contract `version`
- required field accessor returns the canonical inventory
- actor/scope/resource/action/result/origin accessors return the expected sections
- docs and package wiring expose the new baseline
- validation script is wired into `validate:repo`

### 6.3 Operational validation

Run at minimum:

```bash
npm run validate:observability-audit-event-schema
node --test tests/unit/observability-audit-event-schema.test.mjs
node --test tests/contracts/observability-audit-event-schema.contract.test.mjs
npm run lint:md -- docs/reference/architecture/README.md docs/reference/architecture/observability-audit-event-schema.md docs/tasks/us-obs-02.md specs/032-observability-audit-schema/spec.md specs/032-observability-audit-schema/plan.md specs/032-observability-audit-schema/tasks.md
```

Then run broader confidence validation before PR/merge:

```bash
npm run lint
npm test
```

---

## 7. Sequence of Implementation

1. Materialize `spec.md`, `plan.md`, and `tasks.md`.
2. Add `observability-audit-event-schema.json`.
3. Extend `services/internal-contracts/src/index.mjs` readers and accessors.
4. Add validation helper and CLI script.
5. Wire the package script.
6. Add architecture doc and task-summary update.
7. Add unit and contract tests.
8. Run targeted validation/test commands.
9. Run full `npm run lint` and `npm test`.
10. Inspect diff, commit, push, open PR, monitor CI, fix deterministic failures, and merge.

---

## 8. Done Criteria and Evidence

This increment is done when all of the following are true:

- `services/internal-contracts/src/observability-audit-event-schema.json` exists and is validatable.
- Shared readers/accessors expose the contract and main sections.
- A deterministic validator exists and fails on structural mismatches.
- Targeted unit and contract tests pass.
- Touched markdown passes markdown lint.
- Full repo lint and full test suite pass locally.
- The branch is committed, pushed, reviewed by CI, and merged to `main`.
- Orchestrator state advances from `US-OBS-02-T02` to `US-OBS-02-T03`.

Expected evidence:

- green output from `validate:observability-audit-event-schema`
- green targeted audit-schema unit/contract suites
- green `npm run lint`
- green `npm test`
- merged PR referencing `US-OBS-02-T02`

---

## 9. Risks and Mitigations

### Risk: schema vocabulary drifts from the T01 pipeline categories

**Mitigation**: validate action-category coverage against `observability-audit-pipeline.json` rather than duplicating categories by hand without checks.

### Risk: actor/scope field names drift from the authorization model

**Mitigation**: validate source contract version alignment and reuse authorization-model naming in the schema sections.

### Risk: this increment accidentally absorbs query/export/correlation behavior

**Mitigation**: keep artifacts limited to contract, readers, validation, docs, and tests; explicitly reject new routes, storage logic, and masking/correlation workflows in the final diff review.

### Risk: platform-scoped versus tenant-scoped events become ambiguous

**Mitigation**: define a dedicated scope mode and validation rules that prevent silent tenant/workspace fabrication.
