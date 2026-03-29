# Implementation Plan: Console Backend Workflow Catalog

**Branch**: `067-console-workflow-catalog` | **Date**: 2026-03-29 | **Spec**: `specs/067-console-workflow-catalog/spec.md`
**Task**: US-UIB-01-T01
**Input**: Feature specification from `/specs/067-console-workflow-catalog/spec.md`

## Summary

Produce a single, authoritative repository-native artifact — the Console Backend Workflow Catalog — that enumerates every console operation classified as a backend workflow running in Apache OpenWhisk, defines the reusable classification criteria that drove each decision, provides per-entry structured metadata (actors, affected services, tenant isolation, idempotency expectation, audit classification, privilege level), establishes an explicit exclusion list for out-of-scope operations, and documents governance rules for lifecycle management of the catalog going forward. The catalog is a pure design/specification artifact: no runtime code, no migrations, and no schema changes are introduced by this task. Downstream tasks T02–T06 consume this catalog as their stable implementation scope anchor.

## Technical Context

**Language/Version**: Markdown (repository-native documentation artifact); no runtime code introduced.
**Primary Dependencies**: Existing spec artifacts in `specs/004-console-openwhisk-backend/`, `specs/us-arc-01-t01/`, constitution at `.specify/memory/constitution.md`; no software dependencies.
**Storage**: Repository file system only — `specs/067-console-workflow-catalog/`.
**Testing**: Manual reviewability test (a new contributor can classify an operation in <10 minutes); downstream task traceability check (each sibling task T02–T06 maps to catalog entries); security review pass (no credential/provisioning/multi-service operation left client-side).
**Target Platform**: GitHub / repository browser and local markdown reader.
**Project Type**: Design artifact / specification document within the BaaS multi-tenant platform monorepo.
**Performance Goals**: N/A (document artifact).
**Constraints**: Must remain compatible with `004-console-openwhisk-backend` (US-FN-03-T04) decisions. Must not absorb scope from T02–T06. Must be consumable without external tooling (pure Markdown or structured data). Must respect multi-tenancy, audit, security, and quota governance already established in the constitution and earlier specs.
**Scale/Scope**: One catalog document; five named workflows; representative exclusion set; governance rules; classification criteria. No new code files.

## Constitution Check

- **Monorepo Separation of Concerns**: PASS — the catalog lives under `specs/067-console-workflow-catalog/` as a documentation artifact, consistent with all prior spec-based tasks. No `apps/`, `services/`, or `charts/` directories are touched.
- **Incremental Delivery First**: PASS — the catalog is a minimal, bounded artifact that unlocks T02–T06 without introducing infrastructure or framework complexity.
- **Kubernetes and OpenShift Compatibility**: PASS — no deployment artifacts are introduced or modified.
- **Quality Gates at the Root**: PASS — reviewability and traceability criteria are verifiable through repository inspection without new root scripts.
- **Documentation as Part of the Change**: PASS — the catalog and this plan are the change; the `docs/` tree is not impacted because this is a feature-scoped spec artifact.
- **API Symmetry**: N/A — no API surfaces are introduced by this task.

## Project Structure

### Documentation (this feature)

```text
specs/067-console-workflow-catalog/
├── spec.md              ← already created (input to this plan)
├── plan.md              ← this file
└── catalog.md           ← Phase 1 output: the deliverable artifact
```

No source code, contract JSON, or test files are produced by this task. All implementation artifacts belong to T02–T06.

**Structure Decision**: The catalog is delivered as `catalog.md` co-located with `spec.md` and `plan.md` inside the feature spec directory. This keeps the artifact discoverable alongside the specification that commissioned it and mirrors the pattern used by other spec-only tasks in this repo (e.g., `specs/us-arc-01-t01/`). A single Markdown file (rather than a YAML/JSON structured data file) is chosen because FR-008 requires it to be "consumable without external tooling" and the existing repo convention for reference documents is Markdown. The governance rules section within `catalog.md` covers versioning expectations for the catalog itself.

---

## Phase 0: Research Findings

All inputs are available in the repository. No external research is required. The following decisions are resolved from existing artifacts:

### Decision 1 — Classification criteria basis
**Decision**: Adopt five binary criteria derived from the spec (FR-002): (1) multi-service mutation, (2) credential/secret handling, (3) asynchronous or long-running processing, (4) privilege escalation, (5) atomicity/consistency requirement. An operation qualifies as a backend workflow if it satisfies **any one** of the five criteria.  
**Rationale**: The spec mandates exactly these five. Using a disjunctive rule (any-one-of) maximizes recall of sensitive operations. The criteria align with security rationale in the spec's User Story 2.  
**Alternatives considered**: Scoring/weighting model (rejected — adds subjective judgement without reducing ambiguity); AND-combination (rejected — would exclude genuinely sensitive single-criterion operations like async provisioning).

### Decision 2 — Catalog format
**Decision**: Markdown tables + fenced-code-block metadata sections within `catalog.md`. No JSON/YAML data file is generated by this task.  
**Rationale**: FR-008 requires the artifact to be consumable without external tooling. Existing repo convention for design documents is Markdown. T02+ will reference entries by name, which works equally well with Markdown anchors.  
**Alternatives considered**: YAML structured file alongside Markdown (deferred to a governance amendment if machine consumption is needed in a later task).

### Decision 3 — Scope of included workflows
**Decision**: Include the five operations explicitly named in the story scope (user approval, tenant provisioning, workspace creation, credential generation, multi-service orchestration), plus an additional cross-cutting "Service Account Lifecycle" workflow identified during analysis of the platform services. Explicitly exclude simple reads and user-preference mutations as representative non-qualifying operations.  
**Rationale**: FR-001 mandates 100% coverage of named operations. The service account lifecycle workflow was identified in `004-console-openwhisk-backend` (actor type `workspace_service_account`) and is required by the Keycloak/credential lifecycle criteria; omitting it would leave a security gap for T02.  
**Alternatives considered**: Restricting to the five named operations only (rejected — leaves a known security-relevant operation unclassified and creates scope ambiguity for T02).

### Decision 4 — Privilege tier model
**Decision**: Introduce two privilege tiers: `tenant-scoped` (default; operations scoped to a single tenant and its workspaces) and `superadmin` (cross-tenant or platform-level operations). FR-007 requires distinct flagging for elevated-privilege workflows.  
**Rationale**: Consistent with the authorization model in `services/internal-contracts/src/authorization-model.json` which already distinguishes `superadmin` from `workspace_service_account` actor types.  
**Alternatives considered**: Three tiers with a "platform-internal" tier (deferred to governance amendment if needed for future audit service workflows).

### Decision 5 — Idempotency expectation model
**Decision**: Two values: `required` (mutating operations that modify persistent state across services) and `not-required` (read-only or intrinsically idempotent status queries). All catalog entries in this initial set are `required` except job-status reads.  
**Rationale**: The spec mandates idempotency as a required metadata field. Binary classification is sufficient for T02 implementation decisions; a finer-grained retry policy model belongs to T04 (saga/compensation).

---

## Phase 1: Design Artifacts

### Artifact: `specs/067-console-workflow-catalog/catalog.md`

This is the sole deliverable. Its structure is:

1. **Preamble** — version, date, owning task, relationship to sibling tasks.
2. **Classification Criteria** — the five criteria with definitions and examples.
3. **Workflow Entries** (one section per workflow) — structured metadata table + narrative description.
4. **Exclusion List** — representative non-qualifying operations with criteria not met.
5. **Shared Sub-Workflows** — cross-cutting steps identified across multiple entries (e.g., Keycloak realm operations shared by tenant provisioning and workspace creation).
6. **Governance Rules** — proposal/classification process, required metadata, deprecation/retirement, versioning.

#### Catalog Entry Schema (per workflow)

Each entry includes the following metadata fields as a Markdown table:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `workflow_id` | string | yes | Stable identifier for cross-referencing by T02–T06 |
| `name` | string | yes | Human-readable name |
| `description` | string | yes | One-paragraph functional description |
| `triggering_actors` | list | yes | e.g., `tenant_owner`, `workspace_admin`, `superadmin` |
| `affected_services` | list | yes | Subset of: Keycloak, PostgreSQL, MongoDB, Kafka, OpenWhisk, S3, APISIX |
| `tenant_isolation` | enum | yes | `tenant-scoped` or `superadmin` |
| `idempotency_expectation` | enum | yes | `required` or `not-required` |
| `audit_classification` | enum | yes | `sensitive` (credential/privilege) or `standard` |
| `classification_criteria_met` | list | yes | Which of the five criteria triggered inclusion |
| `provisional` | boolean | no | `true` if dependent service not yet implemented |
| `sibling_task_scope` | list | no | Which of T02–T06 this entry is in scope for |

#### Planned Workflow Entries

| Workflow ID | Name | Privilege Tier | Classification Criteria |
|---|---|---|---|
| `WF-CON-001` | User Approval | `tenant-scoped` | Privilege escalation; multi-service mutation (Keycloak role assignment + PostgreSQL user record) |
| `WF-CON-002` | Tenant Provisioning | `superadmin` | Multi-service mutation (Keycloak realm + PostgreSQL schema + Kafka topic + APISIX route config); privilege escalation |
| `WF-CON-003` | Workspace Creation | `tenant-scoped` | Multi-service mutation (Keycloak client + PostgreSQL workspace record + S3 bucket prefix); async processing |
| `WF-CON-004` | Credential Generation | `tenant-scoped` | Credential/secret handling; multi-service mutation (Keycloak client secret + APISIX key + PostgreSQL key record) |
| `WF-CON-005` | Multi-Service Orchestration (Generic) | `tenant-scoped` | Multi-service mutation; atomicity/consistency requirement |
| `WF-CON-006` | Service Account Lifecycle | `tenant-scoped` | Credential/secret handling; privilege escalation (workspace service account scoping) |

#### Planned Exclusion Entries (representative)

| Operation | Criteria Not Met | Notes |
|---|---|---|
| Read user profile | No multi-service mutation; no credential handling; no async; no privilege escalation; no atomicity requirement | Single-service read from PostgreSQL/Keycloak |
| List workspace members | Same as above | Single-service read |
| Update user display name | Single-service mutation; no credential or privilege implications | Standard PATCH to PostgreSQL |
| Fetch function execution logs | Single-service read (OpenWhisk activation query) | Read-only; no state mutation |
| Check quota usage | Single-service read (quota store) | Stateless read |

#### Planned Shared Sub-Workflows

| Sub-Workflow | Consumed By | Description |
|---|---|---|
| `SWF-CON-A` | WF-CON-002, WF-CON-003 | Keycloak realm/client provisioning sub-steps |
| `SWF-CON-B` | WF-CON-001, WF-CON-006 | Keycloak role assignment and scope binding |
| `SWF-CON-C` | WF-CON-003, WF-CON-004 | PostgreSQL record creation with idempotency key |

*Note: shared sub-workflows are documented for implementation awareness by T02; decomposition into reusable OpenWhisk sequences is a T02 concern, not a catalog concern.*

---

## Data Model and Metadata Impact

No database tables, schema migrations, event schemas, or OpenAPI contract files are created or modified by this task. The catalog is a pure documentation artifact. The `internal-service-map.json` and `authorization-model.json` contracts referenced in `004-console-openwhisk-backend` are not modified; they will be extended by T02 when actual workflow actions are implemented.

---

## API and UX Considerations

Not applicable. This task produces no API endpoints, no UI components, and no configuration changes. The catalog itself is the UX: it must be readable by platform engineers, security reviewers, product managers, and operations teams without requiring any tooling beyond a Markdown reader.

---

## Testing Strategy

Because the deliverable is a documentation artifact, the verification strategy is review-based rather than automated.

### Completeness Check (manual, by task author)
- Confirm all five story-named operations (user approval, tenant provisioning, workspace creation, credential generation, multi-service orchestration) have catalog entries.
- Confirm `WF-CON-006` (service account lifecycle) is included as the additionally identified workflow.
- Confirm every entry has all required metadata fields populated with no placeholders.

### Classification Consistency Check (peer review)
- A second reviewer selects any two catalog entries and verifies the stated criteria are met by the operation description.
- A second reviewer selects any two exclusion entries and verifies the criteria not met are accurate.

### Sibling Task Traceability Check (manual, by scrum master or tech lead)
- For each of T02–T06, confirm at least one catalog entry is in scope for that task's work.
- SC-004 is satisfied when this mapping is documented in the Done evidence below.

### Security Review Pass (security reviewer)
- Confirm SC-005: every operation involving credential generation, multi-service mutation, or privilege escalation is classified as a backend workflow.
- Confirm no operation involving secret material is present in the exclusion list.

### Governance Usability Test (product manager or new contributor)
- Follow the governance rules in the catalog to classify a hypothetical new operation ("Send a welcome email on workspace creation").
- Verify classification reaches a deterministic result in under 10 minutes.

---

## Risks, Compatibility, and Rollback

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| New console operation discovered post-catalog that should have been included | Medium | Medium | Governance rules cover reclassification; catalog versioning allows additive amendments without invalidating T02–T06 scope already committed |
| T02 implementation discovers a workflow decomposition that requires splitting a catalog entry | Low | Low | Catalog entries are implementation-agnostic; a split is a governance amendment, not a breaking change |
| Shared sub-workflow documentation pre-empts or conflicts with T02 decomposition decisions | Low | Low | Sub-workflows are explicitly scoped as "implementation awareness only"; T02 retains decomposition authority |
| Keycloak or PostgreSQL service scope changes before T02 begins | Low | Medium | `provisional` flag mechanism covers entries dependent on services not yet fully implemented |
| Catalog treated as implementation spec rather than classification artifact | Medium | Medium | Plan summary and spec preamble explicitly state this is a classification artifact; Done criteria require this distinction to be visible in the catalog preamble |

**Rollback**: Not applicable for a documentation artifact. The branch can be reverted without side effects if the catalog is rejected during review. No database changes, no service changes, no deployed artifacts.

**Idempotency**: The catalog is a static document. Re-generating it from the same inputs produces the same content. Governance rules include a versioning field to distinguish amendments.

---

## Dependencies and Sequencing

### Declared Story Dependencies (already delivered or in progress)
- **US-FN-03**: Delivers governed OpenWhisk function execution surface and `workspace_service_account` actor type. Required for correct actor classification in catalog entries. ✓ Delivered via `004-console-openwhisk-backend`.
- **US-UI-01**: Delivers React console foundation and routing. Referenced for understanding which console operations exist. ✓ Available via `specs/043-react-console-foundation/` and related specs.
- **US-TEN-01**: Delivers tenant provisioning IAM and PostgreSQL schema foundations. Required for accurate service list in `WF-CON-002`. Referenced from `specs/us-arc-01-t01/`.

### Internal Task Sequencing (within US-UIB-01)
- **US-UIB-01-T01** (this task): No prerequisites within the story. Produces the catalog.
- **US-UIB-01-T02**: Depends on this catalog for implementation scope. Cannot start without a completed catalog.
- **US-UIB-01-T03 through T06**: All depend on T02 or on the catalog directly. The catalog provides the stable anchor for all of them.

### Parallelization
- This task has no internal parallelizable work — it is a single-author documentation task.
- The catalog can be produced in one writing session once the researcher/architect has reviewed the spec and existing plans (004-console-openwhisk-backend, us-arc-01-t01).

### Recommended Sequence
1. Author reads `spec.md`, this `plan.md`, and `004-console-openwhisk-backend/plan.md` for context on actor types and authorization model.
2. Author drafts `catalog.md` in the order: classification criteria → workflow entries → exclusion list → shared sub-workflows → governance rules.
3. Peer review (classification consistency + security review pass).
4. Merge to branch. T02 author picks up catalog as their scope anchor.

---

## Criteria of Done and Expected Evidence

| Criterion | Verification Method | Expected Evidence |
|---|---|---|
| `catalog.md` exists at `specs/067-console-workflow-catalog/catalog.md` | File present in repo | `ls specs/067-console-workflow-catalog/` shows `spec.md`, `plan.md`, `catalog.md` |
| All five story-named operations are catalogued (SC-001) | Manual inspection of catalog entries | Six entries present (five named + service account lifecycle), no `[PLACEHOLDER]` values |
| Every entry has all required metadata fields (SC-003) | Manual inspection of entry tables | Each entry table has all nine required fields populated |
| Classification criteria are self-sufficient for a new contributor (SC-002) | Governance usability test | Reviewer documents classification of a test case in <10 minutes |
| Sibling tasks T02–T06 can map their scope to catalog entries (SC-004) | Traceability matrix in Done notes | Each of T02–T06 identifies ≥1 catalog entry in their scope |
| No sensitive operation is left client-side-eligible (SC-005) | Security review pass | Sign-off in PR review confirming credential/provisioning/multi-service operations are all backend-classified |
| Catalog preamble clearly states this is a classification artifact, not an implementation spec | Manual inspection | Preamble section present with explicit scope statement |
| Governance rules cover: proposal, required metadata, deprecation, versioning | Manual inspection of governance section | All four lifecycle phases documented |
