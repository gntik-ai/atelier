# Implementation Plan: US-OBS-03-T04 — Hard-Limit Quota Enforcement on Resource Creation

**Feature Branch**: `040-quota-hard-limit-enforcement`
**Spec**: `specs/040-quota-hard-limit-enforcement/spec.md`
**Task**: `US-OBS-03-T04`
**Created**: 2026-03-28
**Status**: Planned

---

## 1. Technical Objective

`US-OBS-03-T04` turns the observational posture/alert baseline from `US-OBS-03-T01`–`T03`
into an **actionable hard-stop enforcement surface** for resource-creation flows.

The increment must add one shared contract and one deterministic helper surface that:

- define the canonical hard-limit enforcement decision envelope for creation-time admission,
- translate quota posture / quota-guardrail evidence into a single structured denial payload with
  `error_code=QUOTA_HARD_LIMIT_REACHED`,
- resolve tenant-vs-workspace precedence by denying on the strictest breached scope,
- expose deterministic audit/event evidence for both allowed and denied evaluations,
- integrate the shared decision shape into the governed creation surfaces already implemented in
  the repo (storage bucket admission preview, OpenWhisk functions, Kafka topics, PostgreSQL, and
  MongoDB),
- update the affected public family OpenAPI documents so create endpoints document the structured
  hard-limit denial contract,
- and remain hot-reload compatible with policy updates by taking explicit usage/limit inputs rather
  than caching decisions inside adapters.

This task does **not** implement console visualization (`T05`) or cross-module scenario coverage
(`T06`). It is the bounded enforcement baseline that downstream work builds upon.

---

## 2. Architecture and Scope Boundaries

### 2.1 Position in `US-OBS-03`

```text
T01 — usage-consumption baseline (already delivered)
T02 — quota policy contract + posture evaluation (already delivered)
T03 — threshold alert / event emission (already delivered)
T04 — THIS TASK: hard-limit blocking/resource-creation enforcement
T05 — console usage-vs-quota and provisioning state
T06 — cross-module consumption/enforcement tests
```

### 2.2 Inputs reused from existing baselines

This task reuses and must remain additive to the current observability and adapter baselines:

- `services/internal-contracts/src/observability-usage-consumption.json`
- `services/internal-contracts/src/observability-quota-policies.json`
- `services/internal-contracts/src/observability-threshold-alerts.json`
- `services/internal-contracts/src/public-api-taxonomy.json`
- `services/internal-contracts/src/index.mjs`
- `apps/control-plane/src/observability-admin.mjs`
- `services/adapters/src/openwhisk-admin.mjs`
- `services/adapters/src/kafka-admin.mjs`
- `services/adapters/src/postgresql-admin.mjs`
- `services/adapters/src/mongodb-admin.mjs`
- `services/adapters/src/storage-capacity-quotas.mjs`
- family OpenAPI sources under `apps/control-plane/openapi/families/`

The full aggregated OpenAPI source must only be regenerated after changes; it is not an LLM input.

### 2.3 Target architecture

```text
T01 usage + T02 quota posture + T03 threshold alerts
        ↓
services/internal-contracts/src/observability-hard-limit-enforcement.json
        ↓ shared readers + accessors
services/internal-contracts/src/index.mjs
        ↓ deterministic decision + error/audit builders
apps/control-plane/src/observability-admin.mjs
        ↓ adapter-specific wrappers / create-route mappings
storage-capacity-quotas | openwhisk-admin | kafka-admin | postgresql-admin | mongodb-admin
        ↓
public family OpenAPI denial docs + contract/unit tests + repo validation
```

### 2.4 Incremental implementation rule

Follow the same bounded pattern used by prior observability increments:

- the new helper surface accepts explicit scope, usage, limit, and action inputs,
- adapters expose additive `quotaDecision` / `hardLimitDecision` metadata instead of changing
  existing return shapes incompatibly,
- the shared helper is the single source for canonical denial payload fields,
- per-adapter logic only maps native quota evidence into the shared decision shape,
- public OpenAPI changes stay limited to the affected family files,
- and no UI or notification work from `T05`/`T06` is absorbed here.

### 2.5 Core enforcement decisions

| Concern | Decision |
| --- | --- |
| Canonical error code | `QUOTA_HARD_LIMIT_REACHED` |
| Public HTTP status | `429` for gateway-style hard-stop admission denials |
| Shared response fields | `error_code`, `dimension_id`, `scope_type`, `scope_id`, `current_usage`, `hard_limit`, `blocking_action`, `retryable`, `message` |
| Scope precedence | deny on the most restrictive breached scope; if both breach, prefer workspace for workspace-scoped creates, else tenant |
| Allowed-path audit | supported and deterministic |
| Denied-path audit | required and deterministic |
| Policy hot reload | enforced by explicit limit/usage inputs on every evaluation |
| OpenAPI updates | family files only; regenerate aggregate spec afterwards |

### 2.6 Explicit non-goals

This task will **not**:

- add console views or tenant dashboards (`T05`),
- add cross-module workflow/e2e suites beyond bounded unit/contract coverage (`T06`),
- change alert routing, acknowledgment, or notification semantics from `T03`,
- replace existing adapter quota validation messages; instead it augments them with structured
  decisions,
- or introduce global policy caches requiring restarts.

---

## 3. Artifact-by-Artifact Change Plan

### 3.1 `services/internal-contracts/src/observability-hard-limit-enforcement.json` (new)

Add one machine-readable contract that defines:

- source-contract versions for usage consumption, quota policies, threshold alerts, and public API,
- the canonical hard-limit denial/error contract,
- supported enforceable dimensions and aliases from the backlog language:
  - `api_requests`
  - `serverless_functions`
  - `storage_buckets`
  - `logical_databases`
  - `kafka_topics`
  - `collections_tables`
  - `realtime_connections`
  - `error_budget`
- dimension-to-surface mappings for currently implemented create/admission flows,
- scope precedence and decision ordering rules,
- audit evidence requirements for allowed/denied evaluations,
- fail-closed posture when evidence is missing,
- policy-refresh / propagation expectations,
- explicit downstream boundaries to `T05` and `T06`.

### 3.2 `services/internal-contracts/src/index.mjs` (update)

Expose the new contract through shared readers/accessors:

- `readObservabilityHardLimitEnforcement()`
- `OBSERVABILITY_HARD_LIMIT_ENFORCEMENT_VERSION`
- `listHardLimitDimensions()` / `getHardLimitDimension(id)`
- `listHardLimitSurfaceMappings()`
- `getHardLimitErrorContract()`
- `getHardLimitAuditContract()`
- `getHardLimitEnforcementPolicy()`

### 3.3 `scripts/lib/observability-hard-limit-enforcement.mjs` (new)

Add deterministic validation helpers that:

- assert source-version alignment with installed contracts,
- assert all backlog-named dimensions exist and are unique,
- assert each currently implemented create/admission surface has a mapping,
- assert the error contract includes all required fields,
- assert audit requirements cover both allowed and denied evaluations,
- assert downstream boundaries to `T05` and `T06` remain explicit,
- and assert no full OpenAPI dependency is introduced.

### 3.4 `scripts/validate-observability-hard-limit-enforcement.mjs` + `package.json` (new/update)

Add a dedicated validator entry point and wire:

- `validate:observability-hard-limit-enforcement`
- inclusion into `validate:repo`

### 3.5 `apps/control-plane/src/observability-admin.mjs` (update)

Extend the observability helper surface with additive hard-limit helpers:

**Contract / catalog**
- `summarizeObservabilityHardLimitEnforcement()`
- `listEnforceableQuotaDimensions()`
- `getHardLimitErrorResponseSchema()`

**Decision builders**
- `buildQuotaHardLimitDecision(input)` — canonical structured decision for allow/deny.
- `pickStrictestHardLimitDecision(decisions)` — resolves precedence between tenant/workspace hits.
- `buildQuotaHardLimitErrorResponse(decision, context)` — canonical structured denial payload.
- `buildQuotaHardLimitAuditEvent(decision, context)` — canonical audit evidence envelope.

**Mapping helpers**
- `mapAdapterQuotaDecisionToEnforcementDecision(input)` — maps adapter-native quota evidence into
  the shared contract.
- `isQuotaHardLimitReached(decision)` — convenience predicate for callers/tests.

### 3.6 Adapter integrations (updates)

Make bounded additive integrations to existing create/admission surfaces:

- `services/adapters/src/storage-capacity-quotas.mjs`
  - expose / preserve bucket-admission hard-stop evidence in the shared structured shape.
- `services/adapters/src/openwhisk-admin.mjs`
  - include a `quotaDecision` for create-function hard-limit denials derived from existing
    `validateFunctionQuotaGuardrails()` evidence.
- `services/adapters/src/kafka-admin.mjs`
  - include a `quotaDecision` for topic-create denials.
- `services/adapters/src/postgresql-admin.mjs`
  - include a `quotaDecision` for create operations whose quota limit is exhausted.
- `services/adapters/src/mongodb-admin.mjs`
  - include a `quotaDecision` for database / collection create denials.

### 3.7 Public family OpenAPI updates (bounded)

Update only the relevant family files so the create/admission routes document the structured hard-limit denial payload:

- `apps/control-plane/openapi/families/functions.openapi.json`
- `apps/control-plane/openapi/families/events.openapi.json`
- `apps/control-plane/openapi/families/postgres.openapi.json`
- `apps/control-plane/openapi/families/mongo.openapi.json`
- `apps/control-plane/openapi/families/storage.openapi.json`

Use family-file edits only and regenerate the aggregate public API afterward.

### 3.8 Docs

Add one architecture note and task-summary updates:

- `docs/reference/architecture/observability-hard-limit-enforcement.md`
- `docs/reference/architecture/README.md`
- `docs/tasks/us-obs-03.md`

### 3.9 Tests

Add bounded tests for:

- contract/reader validity,
- shared decision/error/audit helpers,
- adapter integration metadata for storage/functions/events/postgres/mongo,
- and public-family denial docs where practical.

---

## 4. Implementation Sequence

1. Materialize the new hard-limit enforcement contract + shared readers.
2. Add repo validator + package wiring.
3. Extend `observability-admin.mjs` with shared decision/error/audit helpers.
4. Integrate bounded additive `quotaDecision` metadata into storage/functions/events/postgres/mongo paths.
5. Update relevant family OpenAPI files with the structured denial contract.
6. Add architecture/task docs.
7. Run validators/tests, then regenerate public API.
8. Commit, push, open PR, monitor CI, fix, merge.

---

## 5. Verification Strategy

Minimum green set for this increment:

- `npm run validate:observability-hard-limit-enforcement`
- `node --test tests/unit/observability-hard-limit-enforcement.test.mjs`
- `node --test tests/contracts/observability-hard-limit-enforcement.contract.test.mjs`
- targeted adapter tests for storage/functions/events/postgres/mongo quota decisions
- `npm run generate:public-api`
- `npm run lint`
- `npm test`

---

## 6. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Existing adapters expose only string violations | Keep current strings intact and add structured `quotaDecision` metadata additively. |
| Dimension names in backlog differ from current observability contracts | Add alias/mapping catalog in the new enforcement contract instead of mutating T01/T02 contracts. |
| Multiple family OpenAPI files drift | Keep denial schema additive and regenerate aggregate spec once after all family-file edits. |
| Storage / functions / events / database modules use different quota semantics | Centralize the final decision envelope in `observability-admin.mjs`; adapters only provide normalized inputs. |

---

## 7. Done Criteria

This task is done when:

- the new hard-limit enforcement contract, readers, validator, docs, and tests exist,
- the shared observability helper surface can build deterministic allow/deny decisions and
  structured hard-limit denial responses,
- storage bucket, function, topic, PostgreSQL, and MongoDB create/admission flows expose additive
  structured `quotaDecision` metadata,
- affected family OpenAPI files document the structured hard-limit denial contract,
- aggregate public API is regenerated,
- all validation/tests/lint pass,
- and the branch is delivered through commit → push → PR → CI green → merge.
