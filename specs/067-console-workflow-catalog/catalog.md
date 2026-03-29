# Console Backend Workflow Catalog

**Version**: 1.0.0  
**Date**: 2026-03-29  
**Owning Task**: US-UIB-01-T01  
**Branch**: `067-console-workflow-catalog`  
**Status**: Draft — pending peer review and security sign-off

> **Scope statement**: This document is a **classification artifact**, not an implementation specification. It defines which console operations must execute as backend workflows in Apache OpenWhisk, the criteria used to classify them, the metadata each workflow entry must carry, representative exclusions, shared sub-workflows for implementation awareness, and governance rules for keeping the catalog current. It does **not** define runtime decomposition, OpenWhisk action design, API contracts, deployment details, or UI behavior; those belong to sibling tasks T02–T06.

---

## 1. Classification Criteria

A console operation **qualifies as a backend workflow** if it satisfies **any one** of the five criteria below. The rule is deliberately **disjunctive**: meeting one criterion is sufficient for inclusion.

| ID | Criterion | Definition | Concrete example |
|---|---|---|---|
| `C-1` | Multi-service mutation | The operation creates, updates, deletes, or coordinates state across **two or more** platform services as one logical user action. | Approving a user updates a PostgreSQL membership record and assigns a Keycloak role. |
| `C-2` | Credential / secret handling | The operation generates, rotates, reveals once, stores metadata for, revokes, or otherwise handles secrets, API keys, passwords, tokens, or service credentials. | Generating a workspace API credential creates a Keycloak secret, registers it with APISIX, and records metadata in PostgreSQL. |
| `C-3` | Asynchronous or long-running processing | The operation can exceed the normal lifetime of a synchronous HTTP request, requires polling/job tracking, or must wait for external systems to finish provisioning. | Creating a tenant may require multiple provisioning steps across Keycloak, PostgreSQL, Kafka, and APISIX, some of which may complete asynchronously. |
| `C-4` | Privilege escalation | The operation grants, elevates, constrains, or removes roles/permissions in a way that changes what another principal is authorized to do. | Approving a pending workspace member grants access they did not previously have. |
| `C-5` | Atomicity / consistency requirement | The operation must behave as all-or-nothing across multiple resources so that partial success does not leave the platform in an inconsistent state. | Workspace creation must not leave behind a Keycloak client if the PostgreSQL workspace record or S3 storage setup fails. |

### Inclusion rule

Use the following decision rule when classifying an operation:

- If the operation satisfies **at least one** of `C-1` through `C-5`, classify it as a **backend workflow**.
- If the operation satisfies **none** of `C-1` through `C-5`, it is **not** a backend workflow and remains a direct single-service console/API interaction.

### How a new contributor should apply the criteria

1. State the console action as **actor + verb + object**.
2. Check `C-1` through `C-5` in order.
3. Stop at the first matched criterion only if you are deciding inclusion; record **all** matched criteria in the entry metadata once inclusion is confirmed.
4. If no criterion matches, add the operation to the exclusion list rather than forcing it into the catalog.

This section is intentionally self-sufficient so a new contributor can classify a hypothetical operation without consulting any other document.

---

## 2. Workflow Entries

Each workflow entry carries the same metadata schema:

| Field | Purpose |
|---|---|
| `workflow_id` | Stable identifier for cross-reference by sibling tasks |
| `name` | Human-readable workflow name |
| `description` | One-paragraph functional summary |
| `triggering_actors` | Allowed initiating actor types |
| `affected_services` | Platform services touched by the workflow |
| `tenant_isolation` | `tenant-scoped` or `superadmin` |
| `idempotency_expectation` | `required` or `not-required` |
| `audit_classification` | `sensitive` or `standard` |
| `classification_criteria_met` | One or more of `C-1` through `C-5` |
| `provisional` | `true` if future-facing or not fully specified; `false` otherwise |
| `sibling_task_scope` | Which of T02–T06 directly consume the entry |

### WF-CON-001 — User Approval

| Field | Value |
|---|---|
| `workflow_id` | `WF-CON-001` |
| `name` | User Approval |
| `description` | Approves a pending user access request by granting the appropriate role and synchronizing membership state so the user becomes active in the target workspace or tenant context. |
| `triggering_actors` | `workspace_admin`, `tenant_owner` |
| `affected_services` | `Keycloak`, `PostgreSQL` |
| `tenant_isolation` | `tenant-scoped` |
| `idempotency_expectation` | `required` |
| `audit_classification` | `sensitive` |
| `classification_criteria_met` | `C-1`, `C-4` |
| `provisional` | `false` |
| `sibling_task_scope` | `T02`, `T04`, `T05`, `T06` |

A workspace admin or tenant owner approves a pending access request. The workflow assigns the required Keycloak role and updates the PostgreSQL membership/user state from pending to active. It qualifies because it mutates more than one service (`C-1`) and grants permissions the target user previously did not have (`C-4`). The browser must not attempt to coordinate those state changes itself because partial success would produce inconsistent authorization behavior.

### WF-CON-002 — Tenant Provisioning

| Field | Value |
|---|---|
| `workflow_id` | `WF-CON-002` |
| `name` | Tenant Provisioning |
| `description` | Creates a new tenant by provisioning its identity domain, data boundary, event namespace, and gateway configuration as one governed platform operation. |
| `triggering_actors` | `superadmin` |
| `affected_services` | `Keycloak`, `PostgreSQL`, `Kafka`, `APISIX` |
| `tenant_isolation` | `superadmin` |
| `idempotency_expectation` | `required` |
| `audit_classification` | `sensitive` |
| `classification_criteria_met` | `C-1`, `C-3`, `C-4`, `C-5` |
| `provisional` | `false` |
| `sibling_task_scope` | `T02`, `T03`, `T04`, `T05`, `T06` |

A superadmin creates a tenant by provisioning a Keycloak realm, a PostgreSQL tenant boundary, Kafka topic namespace, and APISIX route configuration. It is a backend workflow because it coordinates multiple services (`C-1`), can be long-running (`C-3`), exercises cross-tenant platform authority (`C-4`), and must avoid leaving partially provisioned tenant infrastructure behind (`C-5`). Shared sub-workflow `SWF-CON-A` applies here.

### WF-CON-003 — Workspace Creation

| Field | Value |
|---|---|
| `workflow_id` | `WF-CON-003` |
| `name` | Workspace Creation |
| `description` | Creates a workspace inside an existing tenant, including identity, persistence, and storage resources required for that workspace to function. |
| `triggering_actors` | `tenant_owner` |
| `affected_services` | `Keycloak`, `PostgreSQL`, `S3` |
| `tenant_isolation` | `tenant-scoped` |
| `idempotency_expectation` | `required` |
| `audit_classification` | `standard` |
| `classification_criteria_met` | `C-1`, `C-3`, `C-5` |
| `provisional` | `false` |
| `sibling_task_scope` | `T02`, `T04`, `T05`, `T06` |

A tenant owner creates a workspace by provisioning a Keycloak client, writing the PostgreSQL workspace record, and creating or reserving the workspace's S3 storage boundary. It qualifies because it mutates multiple services (`C-1`), may involve storage provisioning latency (`C-3`), and must maintain consistency across identity, metadata, and storage state (`C-5`). Shared sub-workflows `SWF-CON-A` and `SWF-CON-C` apply here.

### WF-CON-004 — Credential Generation

| Field | Value |
|---|---|
| `workflow_id` | `WF-CON-004` |
| `name` | Credential Generation |
| `description` | Generates, rotates, or revokes workspace-scoped credentials and synchronizes the resulting secret metadata across the platform control plane. |
| `triggering_actors` | `workspace_admin`, `tenant_owner` |
| `affected_services` | `Keycloak`, `APISIX`, `PostgreSQL` |
| `tenant_isolation` | `tenant-scoped` |
| `idempotency_expectation` | `required` |
| `audit_classification` | `sensitive` |
| `classification_criteria_met` | `C-1`, `C-2`, `C-5` |
| `provisional` | `false` |
| `sibling_task_scope` | `T02`, `T04`, `T05`, `T06` |

A workspace admin or tenant owner generates, rotates, or revokes credentials such as client secrets or API keys. The workflow updates Keycloak credential state, synchronizes APISIX consumer/key material, and records credential metadata in PostgreSQL. It qualifies because it handles secrets directly (`C-2`), mutates multiple services (`C-1`), and must avoid inconsistent states where one system accepts a credential that another system does not track correctly (`C-5`). Shared sub-workflow `SWF-CON-C` applies here.

### WF-CON-005 — Multi-Service Orchestration (Generic)

| Field | Value |
|---|---|
| `workflow_id` | `WF-CON-005` |
| `name` | Multi-Service Orchestration (Generic) |
| `description` | Placeholder catalog entry for future console operations that coordinate two or more platform services but are not yet specialized enough to warrant their own named workflow entry. |
| `triggering_actors` | `workspace_admin`, `tenant_owner`, `superadmin` |
| `affected_services` | `Keycloak`, `PostgreSQL`, `MongoDB`, `Kafka`, `OpenWhisk`, `S3`, `APISIX` |
| `tenant_isolation` | `tenant-scoped` |
| `idempotency_expectation` | `required` |
| `audit_classification` | `standard` |
| `classification_criteria_met` | `C-1`, `C-5` |
| `provisional` | `true` |
| `sibling_task_scope` | `T02`, `T03`, `T04`, `T05` |

This generic entry captures future console operations that require server-side orchestration across multiple services but are not yet individually specified. It exists to prevent an implementation gap where an engineer might otherwise treat a new multi-service console action as client-side coordination. It remains provisional until a future story replaces or refines it with a specific workflow entry. If a future instance introduces credential handling or privilege changes, its dedicated successor entry should also capture `C-2` and/or `C-4` as appropriate.

### WF-CON-006 — Service Account Lifecycle

| Field | Value |
|---|---|
| `workflow_id` | `WF-CON-006` |
| `name` | Service Account Lifecycle |
| `description` | Creates, scopes, rotates, deactivates, or deletes workspace service accounts and their associated permissions/credentials. |
| `triggering_actors` | `workspace_admin`, `tenant_owner` |
| `affected_services` | `Keycloak`, `PostgreSQL` |
| `tenant_isolation` | `tenant-scoped` |
| `idempotency_expectation` | `required` |
| `audit_classification` | `sensitive` |
| `classification_criteria_met` | `C-2`, `C-4` |
| `provisional` | `false` |
| `sibling_task_scope` | `T02`, `T04`, `T05`, `T06` |

A workspace admin or tenant owner manages the lifecycle of a workspace service account, including creation, scoping, rotation, deactivation, and deletion. The workflow updates the Keycloak client/service-account identity and the PostgreSQL record that binds the account to the workspace and tracks its state. It qualifies because it handles service credentials (`C-2`) and changes what a machine principal is authorized to do (`C-4`). Shared sub-workflow `SWF-CON-B` applies here.

---

## 3. Exclusion List

The following representative operations do **not** qualify as backend workflows because they satisfy **none** of `C-1` through `C-5`, or because they remain simple single-service mutations without security or orchestration implications.

| Operation | Criteria not met | Notes |
|---|---|---|
| Read user profile | Does **not** meet `C-1`, `C-2`, `C-3`, `C-4`, or `C-5` | Single-service read from PostgreSQL or Keycloak; no mutation, no secret handling, no privilege change. |
| List workspace members | Does **not** meet `C-1`, `C-2`, `C-3`, `C-4`, or `C-5` | Read-only membership query; no state mutation. |
| Update user display name | Does **not** meet `C-1`, `C-2`, `C-3`, `C-4`, or `C-5` | Single-service PostgreSQL mutation; no credential, privilege, async, or atomic multi-service concerns. |
| Fetch function execution logs | Does **not** meet `C-1`, `C-2`, `C-3`, `C-4`, or `C-5` | Read-only OpenWhisk activation/log lookup; no state mutation. |
| Check quota usage | Does **not** meet `C-1`, `C-2`, `C-3`, `C-4`, or `C-5` | Stateless or single-store read of quota/usage information. |

> **Boundary rule**: If a future version of one of the excluded operations begins coordinating multiple services, handling secrets, changing privileges, becoming asynchronous, or requiring all-or-nothing consistency, it must be re-evaluated under Section 5 and promoted into the catalog if any criterion is met.

---

## 4. Shared Sub-Workflows

Shared sub-workflows are documented for implementation awareness only. **Decomposition into reusable OpenWhisk sequences is a T02 concern.**

| Sub-Workflow ID | Consumed By | Description |
|---|---|---|
| `SWF-CON-A` | `WF-CON-002`, `WF-CON-003` | Keycloak realm/client provisioning sub-steps, including creation and baseline configuration of tenant/workspace identity artifacts. |
| `SWF-CON-B` | `WF-CON-001`, `WF-CON-006` | Keycloak role assignment and scope binding for human or service principals. |
| `SWF-CON-C` | `WF-CON-003`, `WF-CON-004` | PostgreSQL record creation with idempotency key to make retries safe for workspace/credential state writes. |

---

## 5. Governance Rules

### 5.1 Proposal process

A new workflow entry is proposed through a pull request that updates this catalog and includes enough information for reviewers to classify the operation without consulting implementation code.

1. Describe the operation as **actor + verb + object**.
2. Evaluate the operation against `C-1` through `C-5`.
3. If **no** criterion matches, add or update an exclusion entry instead of a workflow entry.
4. If **any** criterion matches, add a workflow entry with all required metadata fields populated.
5. Link the proposal to the sibling task(s) that will consume the entry.
6. Obtain review from the story owner or tech lead; obtain security review when `audit_classification` is `sensitive`.
7. Merge only after the catalog version and date are updated.

### 5.2 Required metadata

No entry may be merged unless all **eleven** fields from the catalog entry schema are present and populated:

1. `workflow_id`
2. `name`
3. `description`
4. `triggering_actors`
5. `affected_services`
6. `tenant_isolation`
7. `idempotency_expectation`
8. `audit_classification`
9. `classification_criteria_met`
10. `provisional`
11. `sibling_task_scope`

Additional governance rules for required metadata:

- `workflow_id` must follow the `WF-CON-NNN` pattern.
- `affected_services` must list concrete platform services from the approved service set: `Keycloak`, `PostgreSQL`, `MongoDB`, `Kafka`, `OpenWhisk`, `S3`, `APISIX`.
- `audit_classification` must be `sensitive` for workflows involving credentials or privilege changes.
- `sibling_task_scope` must identify at least one of `T02`–`T06`.
- Placeholder text, empty values, or implied fields are not allowed.

### 5.3 Deprecation and retirement

Workflow lifecycle states are governed as follows:

- **Active**: the default state for an in-force catalog entry.
- **Deprecated**: the workflow remains documented but should not receive new implementation investment except for compatibility or migration work.
- **Retired**: the workflow is no longer active and is preserved only as historical reference, or removed after review if historical retention is not needed.

Deprecation/retirement procedure:

1. Open a PR that explains the reason for deprecation or retirement.
2. Assess sibling-task impact (`T02`–`T06`) and document whether code, tests, or audit behavior depend on the entry.
3. Mark the entry as deprecated in the PR narrative and keep it in the catalog for a **minimum notice period of one release cycle** before retirement, unless the entry was never implemented.
4. Retire the entry only after confirming no active downstream implementation or test still depends on it.
5. If an excluded operation becomes qualifying later, move it from the exclusion list to a new or existing workflow entry rather than editing history in place.

### 5.4 Versioning

The catalog preamble carries a semantic version:

- **Patch** (`x.y.Z`): editorial clarifications or governance amendments that do not change existing workflow meaning.
- **Minor** (`x.Y.z`): additive changes such as new workflow entries, new exclusion entries, new shared sub-workflows, or deprecations.
- **Major** (`X.y.z`): breaking changes such as redefining classification criteria, changing entry schema semantics, or materially changing the meaning/scope of existing workflow entries.

Every version change must also update the `Date` field in the preamble.

### 5.5 Ten-minute classification test

To keep the catalog usable by a new contributor in under ten minutes:

1. Read Section 1.
2. Describe the proposed operation in one sentence.
3. Check the five criteria.
4. Record all matched criteria.
5. Choose workflow entry vs. exclusion entry.
6. Populate all required metadata if included.

If a reviewer cannot complete those steps deterministically in under ten minutes, the proposal must add clarification to the criteria or governance text before merge.

---

## 6. Sibling Task Scope Mapping

| Sibling Task | Entries in scope | Why it depends on the catalog |
|---|---|---|
| `T02` | `WF-CON-001` through `WF-CON-006` | T02 implements backend workflows and needs the catalog as the authoritative scope list. |
| `T03` | `WF-CON-002`, `WF-CON-005`, plus the exclusion list boundary | T03 uses the catalog to separate backend-orchestrated console actions from direct single-service interactions. |
| `T04` | `WF-CON-001`, `WF-CON-002`, `WF-CON-003`, `WF-CON-004`, `WF-CON-005`, `WF-CON-006` | T04 applies saga/compensation behavior to workflows with multi-step consistency concerns. |
| `T05` | `WF-CON-001` through `WF-CON-006` | T05 attaches audit/correlation behavior across all backend workflows, with stronger controls on `sensitive` entries. |
| `T06` | `WF-CON-001`, `WF-CON-002`, `WF-CON-003`, `WF-CON-004`, `WF-CON-006` | T06 validates the fully specified workflows end to end, including failure handling. |

---

## 7. Self-Review Checklist

- [x] `catalog.md` exists at `specs/067-console-workflow-catalog/catalog.md`
- [x] Preamble explicitly states this is a classification artifact, not an implementation spec
- [x] All six workflow entries are present (`WF-CON-001` through `WF-CON-006`)
- [x] No entry contains placeholder text or empty required fields
- [x] Five exclusion entries are present
- [x] Three shared sub-workflow entries are present (`SWF-CON-A`, `SWF-CON-B`, `SWF-CON-C`)
- [x] Governance rules cover proposal, required metadata, deprecation, and versioning
- [x] Classification criteria are self-sufficient
- [x] `sibling_task_scope` is populated for each workflow entry

---

*Catalog file: `specs/067-console-workflow-catalog/catalog.md`*
