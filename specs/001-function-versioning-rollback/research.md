# Research: Function Versioning and Rollback for Governed OpenWhisk Actions

## Decision Drivers

1. **Recoverability without destructive updates** — operators need a safe path to restore a previously known-good function state.
2. **Multi-tenant isolation** — version history and rollback must stay bounded to the tenant/workspace serverless context.
3. **Incremental compatibility** — the feature must extend the current governed `functions` surface without forcing secrets, quota, or console-backend work from sibling tasks.
4. **Audit-ready lifecycle clarity** — operators must understand what changed, what is active now, and what remains restorable after rollback.
5. **Forward compatibility with later tasks** — the design must leave room for secrets, quotas, import/export, and richer audit/reporting work.

## Options Compared

### Option A — In-place overwrite with best-effort rollback metadata

**Summary**: Keep one mutable function record, overwrite it on update, and attach lightweight rollback hints to the latest record.

**Strengths**
- Lowest immediate implementation effort.
- Minimal contract expansion if version history remains mostly implicit.
- Fewer new entities to document.

**Risks**
- Rollback becomes ambiguous because the prior deployable state is not an immutable first-class record.
- Concurrent updates and rollback are hard to reason about safely.
- Operators cannot inspect a trustworthy lifecycle timeline.
- Later audit, import/export, and quota work would need to reconstruct missing history.

### Option B — Immutable function versions with current-version pointer and rollback action

**Summary**: Each publish produces an immutable function version record. The function action keeps a pointer to the active version. Rollback selects one previous version and promotes it back to active use while preserving the full timeline.

**Strengths**
- Cleanly matches the product requirement for lifecycle controls equivalent to a real serverless product.
- Preserves history across publish and rollback operations.
- Makes rollback eligibility, timeline display, and future audit integration straightforward.
- Supports controlled API and console experiences without exposing native provider administration.

**Risks**
- Requires new contract shapes for version listing/detail and rollback mutation.
- Introduces more metadata and test cases than a mutable-only model.
- Needs explicit decisions for how rollback appears in the timeline.

### Option C — Alias/tag-based deployment channels without explicit version records

**Summary**: Use mutable labels such as `current`, `candidate`, or `previous` instead of explicit immutable versions.

**Strengths**
- Potentially familiar to teams used to deployment aliases.
- Can simplify a narrow promote/demote workflow.

**Risks**
- Poor fit for a product surface that must explain lifecycle history to multiple operator roles.
- Hidden state transitions make audit and console visibility weaker.
- Aliases alone do not satisfy the need for durable inspectable revision history.

## Recommendation

Adopt **Option B — Immutable function versions with a current-version pointer and explicit rollback action**.

## Key Decisions

### 1. Version creation semantics

**Decision**: Every governed function publish that changes deployable state creates a new immutable version record linked to the logical function action.

**Rationale**: This preserves recoverability and gives the product a durable lifecycle object that later tasks can enrich with secrets, quotas, and audit metadata.

**Alternatives considered**: Mutable overwrites were rejected because they weaken rollback integrity and timeline clarity.

### 2. Rollback semantics

**Decision**: Rollback is modeled as an explicit product action that promotes a selected prior version back to active use while preserving all historical versions and recording the restore event in the version timeline.

**Rationale**: Operators need a clean restore action rather than a hidden pointer swap. The timeline must remain understandable before and after rollback.

**Alternatives considered**: Silent reactivation without a restore event was rejected because it makes operational reasoning and future audit work harder.

### 3. Product contract shape

**Decision**: Extend the governed `functions` API with version-specific subresources and a dedicated rollback mutation instead of overloading the existing action `GET`/`PATCH` routes.

**Rationale**: Version history is a distinct lifecycle concern with its own permissions, list/detail views, and invalid-target edge cases. Separate subresources keep the API explicit and testable.

**Alternatives considered**: Embedding the entire timeline inside the base `FunctionAction` response was rejected because pagination, detail lookup, and rollback targeting become awkward.

### 4. Permission model

**Decision**: Version history is readable by the same audience that can read governed function action details in the workspace scope. Rollback uses the same or stricter mutation audience as governed action updates.

**Rationale**: This matches the current public functions surface and keeps permissions understandable until later policy hardening tasks add more nuance.

**Alternatives considered**: Restricting version reads to admins only was rejected for now because it would reduce observability for legitimate workspace developers without a stated product requirement.

### 5. Rollback payload scope

**Decision**: Rollback targets a previously recorded version identifier and returns an accepted mutation envelope aligned with the current control-plane mutation pattern.

**Rationale**: The repo already models governed function changes as accepted asynchronous mutations. Reusing that pattern reduces contract drift.

**Alternatives considered**: Synchronous rollback completion was rejected because the current functions surface already leans on accepted/queued mutation semantics.

## Implications for Later Tasks

- Secret references can later attach to specific function versions without rewriting the lifecycle model.
- Quota tasks can count versions separately from logical actions if the product decides to expose retention or storage ceilings.
- Console-backend execution work can depend on the same version timeline and rollback model.
- Audit/reporting tasks can attach deployment and rollback evidence to explicit lifecycle events instead of reverse-engineering them.
