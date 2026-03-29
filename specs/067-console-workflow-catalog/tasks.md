# Tasks: Console Backend Workflow Catalog

**Feature Branch**: `067-console-workflow-catalog`
**Task ID**: US-UIB-01-T01
**Epic**: Console Backend Workflow Catalog
**Input artifacts**: `specs/067-console-workflow-catalog/spec.md`, `specs/067-console-workflow-catalog/plan.md`
**Date**: 2026-03-29
**Status**: Ready for implementation

---

## File map

> Read only these files during implementation. No broad repo exploration.
> **Do not** read `apps/`, `services/`, or any source file outside the paths listed below.

```text
specs/067-console-workflow-catalog/plan.md         ← READ (primary context — already read)
specs/067-console-workflow-catalog/spec.md         ← READ only if a field description or
                                                      governance rule requires clarification
                                                      beyond plan.md; skip if not needed
specs/067-console-workflow-catalog/catalog.md      ← CREATE (sole deliverable of T01)
```

No source code, OpenAPI contracts, test files, or configuration files are touched by this task.

---

## Objective and strict scope of T01

Produce `specs/067-console-workflow-catalog/catalog.md` — a single authoritative Markdown
document that:

1. States classification criteria (five binary criteria; disjunctive inclusion rule).
2. Catalogues six workflows (WF-CON-001 through WF-CON-006) with full per-entry metadata.
3. Documents an exclusion list of representative non-qualifying operations.
4. Defines shared sub-workflows (SWF-CON-A, SWF-CON-B, SWF-CON-C) for implementation awareness.
5. Establishes governance rules (proposal process, required metadata, deprecation, versioning).

This is a pure documentation artifact. No runtime code, migrations, schema changes, or
deployment artifacts are produced.

### Explicitly out of scope for T01

- Any implementation work (OpenWhisk actions, API routes, UI components).
- Modifications to `apps/`, `services/`, `charts/`, or any existing contract files.
- Tasks T02–T06 (they consume this catalog; they do not belong here).
- Machine-readable YAML/JSON export of the catalog (deferred to a governance amendment).

---

## Tasks

### T01-001 — Draft Classification Criteria section

**What**: Write the "Classification Criteria" section of `catalog.md`.

**Content requirements**:
- Version header, date (`2026-03-29`), owning task (`US-UIB-01-T01`), preamble that
  explicitly states this is a classification artifact, not an implementation spec.
- Five named criteria with definitions and one concrete example each:
  1. Multi-service mutation
  2. Credential/secret handling
  3. Asynchronous or long-running processing
  4. Privilege escalation
  5. Atomicity/consistency requirement
- Inclusion rule: an operation qualifies as a backend workflow if it satisfies **any one**
  of the five criteria (disjunctive rule).

**Done when**: Section is self-sufficient — a new contributor can apply the criteria to
classify a hypothetical operation without reading any other document.

---

### T01-002 — Author Workflow Entries (WF-CON-001 through WF-CON-006)

**What**: Write one section per workflow entry inside `catalog.md`, using the schema below.

**Entry schema** (Markdown table per entry):

| Field | Value |
|---|---|
| `workflow_id` | Stable ID (e.g., `WF-CON-001`) |
| `name` | Human-readable name |
| `description` | One-paragraph functional description |
| `triggering_actors` | e.g., `tenant_owner`, `workspace_admin`, `superadmin` |
| `affected_services` | Subset of: Keycloak, PostgreSQL, MongoDB, Kafka, OpenWhisk, S3, APISIX |
| `tenant_isolation` | `tenant-scoped` or `superadmin` |
| `idempotency_expectation` | `required` or `not-required` |
| `audit_classification` | `sensitive` or `standard` |
| `classification_criteria_met` | Which of the five criteria triggered inclusion |
| `provisional` | `true` / `false` (omit field if `false`) |
| `sibling_task_scope` | Which of T02–T06 this entry is in scope for |

**Required entries**:

| Workflow ID | Name | Privilege Tier | Criteria |
|---|---|---|---|
| WF-CON-001 | User Approval | `tenant-scoped` | Privilege escalation; multi-service mutation (Keycloak role + PostgreSQL user record) |
| WF-CON-002 | Tenant Provisioning | `superadmin` | Multi-service mutation (Keycloak realm + PostgreSQL schema + Kafka topic + APISIX route config); privilege escalation |
| WF-CON-003 | Workspace Creation | `tenant-scoped` | Multi-service mutation (Keycloak client + PostgreSQL workspace record + S3 bucket prefix); async processing |
| WF-CON-004 | Credential Generation | `tenant-scoped` | Credential/secret handling; multi-service mutation (Keycloak client secret + APISIX key + PostgreSQL key record) |
| WF-CON-005 | Multi-Service Orchestration (Generic) | `tenant-scoped` | Multi-service mutation; atomicity/consistency requirement |
| WF-CON-006 | Service Account Lifecycle | `tenant-scoped` | Credential/secret handling; privilege escalation (workspace service account scoping) |

**Done when**: All six entries are present, every required metadata field is populated,
no `[PLACEHOLDER]` values remain.

---

### T01-003 — Write Exclusion List section

**What**: Write the "Exclusion List" section of `catalog.md`.

**Content requirements** — at minimum the five representative exclusions from the plan:

| Operation | Criteria Not Met | Notes |
|---|---|---|
| Read user profile | None of the five criteria met | Single-service read (PostgreSQL/Keycloak) |
| List workspace members | None of the five criteria met | Single-service read |
| Update user display name | Single-service mutation; no credential or privilege implications | Standard PATCH to PostgreSQL |
| Fetch function execution logs | None of the five criteria met | Read-only; no state mutation |
| Check quota usage | None of the five criteria met | Stateless read (quota store) |

**Done when**: Each exclusion entry states which criteria are not met and why, using the
same terminology as the Classification Criteria section.

---

### T01-004 — Document Shared Sub-Workflows section

**What**: Write the "Shared Sub-Workflows" section of `catalog.md`.

**Content requirements** — three sub-workflow entries:

| Sub-Workflow ID | Consumed By | Description |
|---|---|---|
| SWF-CON-A | WF-CON-002, WF-CON-003 | Keycloak realm/client provisioning sub-steps |
| SWF-CON-B | WF-CON-001, WF-CON-006 | Keycloak role assignment and scope binding |
| SWF-CON-C | WF-CON-003, WF-CON-004 | PostgreSQL record creation with idempotency key |

Include an explicit note: *"Shared sub-workflows are documented for implementation
awareness only. Decomposition into reusable OpenWhisk sequences is a T02 concern."*

**Done when**: Three entries present, consumed-by cross-references point to valid
WF-CON-xxx IDs, scope-limitation note is present.

---

### T01-005 — Write Governance Rules section

**What**: Write the "Governance Rules" section of `catalog.md`.

**Content requirements** — must cover all four lifecycle phases:

1. **Proposal process**: How to propose a new workflow for inclusion (required metadata,
   who approves, PR process).
2. **Required metadata**: The eleven fields from the entry schema; no entry may be merged
   with missing required fields.
3. **Deprecation/retirement**: How an entry transitions from `active` → `deprecated`
   → `retired`; minimum notice period; sibling-task impact assessment required.
4. **Versioning**: Catalog carries a `version` field in its preamble (semver);
   additive changes (new entries, new exclusions) bump minor; breaking changes (criteria
   redefinition) bump major; governance amendments that do not change existing entries are
   patch.

**Done when**: All four lifecycle phases are documented; a new contributor can classify
a hypothetical new operation using governance rules alone in under ten minutes.

---

### T01-006 — Self-review and completeness check

**What**: Before marking T01 done, verify the following against `catalog.md`:

- [ ] `catalog.md` file exists at `specs/067-console-workflow-catalog/catalog.md`
- [ ] Preamble explicitly states this is a classification artifact, not an implementation spec
- [ ] All six workflow entries present (WF-CON-001 through WF-CON-006)
- [ ] No entry has a `[PLACEHOLDER]` or empty required field
- [ ] Five exclusion entries present (or more)
- [ ] Three shared sub-workflow entries present (SWF-CON-A, SWF-CON-B, SWF-CON-C)
- [ ] Governance rules cover: proposal, required metadata, deprecation, versioning
- [ ] Classification criteria section is self-sufficient (no external doc required to apply it)
- [ ] `sibling_task_scope` field populated for each workflow entry (maps to T02–T06)

No automated tests. No CI changes. No source file changes.

---

## Recommended authoring sequence

1. Write catalog preamble + classification criteria (T01-001).
2. Write all six workflow entries (T01-002) — most time-consuming step.
3. Write exclusion list (T01-003).
4. Write shared sub-workflows (T01-004).
5. Write governance rules (T01-005).
6. Run self-review checklist (T01-006).

Total estimated effort: single writing session (~2–3 hours).

---

## Criteria of Done

| Criterion | Verification |
|---|---|
| `catalog.md` exists in the feature spec directory | `ls specs/067-console-workflow-catalog/` shows `spec.md`, `plan.md`, `catalog.md` |
| All six workflows catalogued (SC-001) | Six entries present, no placeholders |
| Classification criteria self-sufficient (SC-002) | Governance usability test passes (<10 min for new contributor) |
| Every entry has all required metadata fields (SC-003) | Manual inspection: eleven fields per entry, all populated |
| Sibling tasks T02–T06 can map their scope to catalog entries (SC-004) | Each of T02–T06 identifies ≥1 catalog entry via `sibling_task_scope` |
| No sensitive operation left client-side-eligible (SC-005) | Security review: all credential/provisioning/multi-service ops classified as backend |
| Governance section covers all four lifecycle phases | Manual inspection of governance section |
| Catalog preamble states classification-artifact scope | Preamble section present with explicit statement |
