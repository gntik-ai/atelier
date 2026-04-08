# Tasks: Plan Transition & Limit Excess Policies

**Input**: Design documents from `/specs/102-plan-transition-limit-policies/`  
**Feature Branch**: `102-plan-transition-limit-policies`  
**Task ID**: US-PLAN-01-T06 | **Epic**: EP-19 | **Story**: US-PLAN-01  
**Prerequisites**: plan.md ✅, spec.md ✅  
**Depends on**: 097-plan-entity-tenant-assignment, 098-plan-base-limits, 099-plan-management-api-console, 100-plan-change-impact-history, 101 (upgrade/downgrade tests)

**Organization**: Tasks grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no shared in-progress dependencies)
- **[Story]**: Which user story owns this task (US1–US6)
- Exact file paths included in every task description

---

## Phase 1: Setup (Specification Documentation Artifacts)

**Purpose**: Generate spec-layer documentation artifacts required before implementation work begins. These artifacts are listed in plan.md as outputs; they must exist for the later constrained implement step.

- [ ] T001 Create `specs/102-plan-transition-limit-policies/research.md` documenting Phase 0 resolved decisions (policy resolution order, grace period escalation mechanism, consumption data sourcing, concurrent transition guard, direction classification algorithm, wildcard syntax) per plan.md Phase 0 section
- [ ] T002 [P] Create `specs/102-plan-transition-limit-policies/data-model.md` with full DDL for all 6 new tables: `plan_transition_compatibility_rules`, `plan_excess_policy_config`, `tenant_grace_period_records`, `tenant_over_limit_conditions`, `plan_transition_audit_events`, `tenant_transitions_in_progress`, plus the `plan_audit_events.action_type` extension per plan.md Phase 1 Data Model section
- [ ] T003 [P] Create `specs/102-plan-transition-limit-policies/contracts/transition-rule-api.json` — OpenAPI JSON schema for `POST /v1/admin/plan-transition-rules`, `GET /v1/admin/plan-transition-rules`, `DELETE /v1/admin/plan-transition-rules/:id`
- [ ] T004 [P] Create `specs/102-plan-transition-limit-policies/contracts/excess-policy-api.json` — OpenAPI JSON schema for `PUT /v1/admin/excess-policy`, `GET /v1/admin/excess-policy`, `POST /v1/admin/excess-policy/evaluate`
- [ ] T005 [P] Create `specs/102-plan-transition-limit-policies/contracts/grace-period-api.json` — OpenAPI JSON schema for `GET /v1/admin/tenants/:tenantId/grace-periods` and `GET /v1/tenant/plan/over-limit-status`
- [ ] T006 [P] Create `specs/102-plan-transition-limit-policies/contracts/policy-evaluation-api.json` — OpenAPI JSON schema for the `plan-assign` action response body including `policyEvaluationSummary`, `overLimitDimensions[]`, and `finalOutcome` fields
- [ ] T007 [P] Create `specs/102-plan-transition-limit-policies/contracts/kafka-events.json` — JSON Schema for all 7 Kafka event types: `console.plan.transition.evaluated`, `console.plan.transition.blocked`, `console.plan.excess.detected`, `console.plan.grace_period.started`, `console.plan.grace_period.expired`, `console.plan.grace_period.resolved`, `console.plan.creation.blocked`
- [ ] T008 [P] Create `specs/102-plan-transition-limit-policies/quickstart.md` with local dev quickstart instructions: how to run migrations against a dev PostgreSQL instance, how to invoke the new OpenWhisk actions locally, and how to run the integration test suite

**Checkpoint**: All documentation artifacts present in `specs/102-plan-transition-limit-policies/` — implementation phases can now proceed.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Database schema, shared models, repositories, event infrastructure, and environment configuration that MUST be complete before any user story implementation begins.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T009 Create PostgreSQL migration `services/provisioning-orchestrator/src/migrations/102-plan-transition-policies.sql` with DDL for all 6 new tables in dependency order: (1) `plan_transition_compatibility_rules`, (2) `plan_excess_policy_config`, (3) `plan_transition_audit_events`, (4) `tenant_transitions_in_progress`, (5) `tenant_grace_period_records`, (6) `tenant_over_limit_conditions`; include `UNIQUE INDEX uq_ttip_tenant_active` partial index, `uq_tgpr_tenant_dimension_active`, `uq_tolc_tenant_dimension_active`, all CHECK constraints, and the `plan_audit_events.action_type` CHECK constraint extension with new values
- [ ] T010 [P] Create `services/provisioning-orchestrator/src/models/transitionCompatibilityRule.mjs` — ESM model class representing a `plan_transition_compatibility_rules` row with fields: `id`, `sourcePlanId` (nullable), `targetPlanId` (nullable), `disposition` (`allowed` | `allowed_with_approval` | `blocked`), `justification`, `createdBy`, `createdAt`, `updatedAt`
- [ ] T011 [P] Create `services/provisioning-orchestrator/src/models/limitExcessPolicy.mjs` — ESM model class for `plan_excess_policy_config` rows with fields: `id`, `scopeType` (`platform_default` | `transition` | `dimension`), `sourcePlanId`, `targetPlanId`, `dimensionKey`, `policyMode` (`grace_period` | `block_creation` | `block_transition`), `gracePeriodDays`
- [ ] T012 [P] Create `services/provisioning-orchestrator/src/models/gracePeriodRecord.mjs` — ESM model class for `tenant_grace_period_records` rows with fields: `id`, `tenantId`, `dimensionKey`, `transitionId`, `effectiveLimit`, `observedConsumption`, `startedAt`, `expiresAt`, `status` (`active` | `expired_escalated` | `resolved`), `resolvedAt`, `escalatedAt`
- [ ] T013 [P] Create `services/provisioning-orchestrator/src/models/overLimitCondition.mjs` — ESM model class for `tenant_over_limit_conditions` rows with fields: `id`, `tenantId`, `dimensionKey`, `transitionId`, `effectiveLimit`, `observedConsumption`, `policyMode`, `evaluationStatus` (`active` | `deferred` | `resolved`), `createdAt`, `updatedAt`
- [ ] T014 Create `services/provisioning-orchestrator/src/repositories/transitionCompatibilityRuleRepository.mjs` — ESM repository with methods: `create(rule)`, `list({ sourcePlanId, targetPlanId })`, `findMatchingRule(sourcePlanId, targetPlanId)` (implements wildcard precedence: exact+exact > exact+wildcard > wildcard+exact > wildcard+wildcard, tiebreak by `created_at DESC`), `deleteById(id)`
- [ ] T015 [P] Create `services/provisioning-orchestrator/src/repositories/limitExcessPolicyRepository.mjs` — ESM repository with methods: `setPolicy(policyConfig)` (upsert), `getByScope({ scopeType, sourcePlanId, targetPlanId, dimensionKey })`, `getPlatformDefault()`, `getTransitionOverride(sourcePlanId, targetPlanId)`, `getDimensionOverride(dimensionKey)`, `deleteById(id)`, `list()`
- [ ] T016 [P] Create `services/provisioning-orchestrator/src/repositories/gracePeriodRepository.mjs` — ESM repository with methods: `create(record)`, `findActiveByTenantDimension(tenantId, dimensionKey)`, `listByTenant(tenantId)`, `listExpired(batchSize)` (WHERE `status = 'active'` AND `expires_at < NOW()`), `markEscalated(id, escalatedAt)`, `markResolved(id, resolvedAt)`
- [ ] T017 Create `services/provisioning-orchestrator/src/events/transitionPolicyEventEmitter.mjs` — ESM module exporting async functions: `emitTransitionEvaluated(payload)`, `emitTransitionBlocked(payload)`, `emitExcessDetected(payload)`, `emitGracePeriodStarted(payload)`, `emitGracePeriodExpired(payload)`, `emitGracePeriodResolved(payload)`, `emitCreationBlocked(payload)`; each reads the corresponding `PLAN_TRANSITION_KAFKA_TOPIC_*` env var and publishes using `kafkajs` with the standard envelope from plan.md; fire-and-forget (no await in callers)
- [ ] T018 Add new environment variables to `services/provisioning-orchestrator/helm/values.yaml` (or equivalent Helm values file): `TRANSITION_POLICY_DEFAULT_GRACE_DAYS=14`, `TRANSITION_POLICY_DEFAULT_MODE=grace_period`, `TRANSITION_POLICY_FALLBACK_ON_MISSING_RULE=allow`, `TRANSITION_POLICY_ENFORCEMENT_ENABLED=false`, `GRACE_PERIOD_SWEEP_BATCH_SIZE=50`, `GRACE_PERIOD_SWEEP_KAFKA_TOPIC_EXPIRED=console.plan.grace_period.expired`, `PLAN_TRANSITION_KAFKA_TOPIC_EVALUATED=console.plan.transition.evaluated`, `PLAN_TRANSITION_KAFKA_TOPIC_BLOCKED=console.plan.transition.blocked`, `PLAN_EXCESS_KAFKA_TOPIC_DETECTED=console.plan.excess.detected`, `PLAN_CREATION_BLOCKED_KAFKA_TOPIC=console.plan.creation.blocked`

**Checkpoint**: Foundation complete — migration exists, models/repositories/events scaffolded, env vars declared. User story implementation can now begin.

---

## Phase 3: User Story 1 — Transition Compatibility Rules (Priority: P1) 🎯 MVP

**Goal**: Superadmins can define transition compatibility rules between plans. The `plan-assign` action enforces them: blocked transitions are rejected before any DB mutation; approval-required transitions gate on an explicit acknowledgment flag.

**Independent Test**: Create transition rules for allowed, allowed-with-approval, and blocked dispositions; attempt assignments matching each rule; verify the system enforces each outcome correctly. Verify concurrent assignment for the same tenant returns 409. Verify same-plan reassignment returns no-op.

### Implementation for User Story 1

- [ ] T019 [US1] Create `services/provisioning-orchestrator/src/services/transitionPolicyEvaluator.mjs` — ESM service implementing: (1) `classifyDirection(sourcePlan, targetPlan)` returning `upgrade` | `downgrade` | `lateral` | `initial_assignment` | `equivalent` per the algorithm in plan.md Decision 5; (2) `evaluateCompatibility(sourcePlanId, targetPlanId, direction, acknowledgmentFlag)` querying `transitionCompatibilityRuleRepository.findMatchingRule` and returning `{ disposition, ruleId, requiresAcknowledgment }` with fallback to `TRANSITION_POLICY_FALLBACK_ON_MISSING_RULE` env var; (3) `isUpgrade(sourcePlan, targetPlan)` boolean helper; (4) `isEquivalent(sourcePlanId, targetPlanId)` boolean helper
- [ ] T020 [P] [US1] Create `services/provisioning-orchestrator/src/actions/transition-rule-create.mjs` — OpenWhisk action that validates `structural_admin` scope, validates request body (sourcePlanId nullable, targetPlanId nullable, disposition enum, optional justification), calls `transitionCompatibilityRuleRepository.create()`, emits `plan_audit_events` row with `action_type = 'transition.rule.created'`, returns 201 with created rule; rejects duplicate exact-pair rules with 409
- [ ] T021 [P] [US1] Create `services/provisioning-orchestrator/src/actions/transition-rule-list.mjs` — OpenWhisk action that validates `structural_admin` scope, accepts optional query params `sourcePlanId` and `targetPlanId`, calls `transitionCompatibilityRuleRepository.list()`, returns 200 with paginated rule array
- [ ] T022 [P] [US1] Create `services/provisioning-orchestrator/src/actions/transition-rule-delete.mjs` — OpenWhisk action that validates `structural_admin` scope, calls `transitionCompatibilityRuleRepository.deleteById(id)`, emits `plan_audit_events` row with `action_type = 'transition.rule.deleted'`, returns 204; returns 404 if rule not found
- [ ] T023 [US1] Modify `services/provisioning-orchestrator/src/actions/plan-assign.mjs` (existing from 097) to add the policy evaluation pipeline (gated by `TRANSITION_POLICY_ENFORCEMENT_ENABLED` env var) per the sequence in plan.md Phase 1 Sequence section steps 1–5, 9 (partial): (a) INSERT into `tenant_transitions_in_progress`, conflict → 409 `TRANSITION_IN_PROGRESS`; (b) load source + target plans; (c) classify direction via `transitionPolicyEvaluator.classifyDirection`; (d) detect equivalent → no-op, mark complete, return 200 `NO_OP`; (e) check compatibility rule → blocked → INSERT `plan_transition_audit_events` (blocked_by_rule), mark complete, return 422 `TRANSITION_BLOCKED`; (f) allowed-with-approval without acknowledgment flag → return 422 `APPROVAL_REQUIRED`; (g) clean upgrade → skip excess evaluation, proceed to commit (step 9); transaction commits or rolls back atomically; mark `tenant_transitions_in_progress.completed_at` in finally block
- [ ] T024 [P] [US1] Write unit tests for `transitionPolicyEvaluator.mjs` in `tests/unit/102-plan-transition-policies/transitionPolicyEvaluator.test.mjs` covering: direction classification for upgrade/downgrade/lateral/initial/equivalent; wildcard rule matching precedence (8 combinations); feature-flag bypass when `TRANSITION_POLICY_ENFORCEMENT_ENABLED=false`
- [ ] T025 [US1] Write integration test `tests/integration/102-plan-transition-policies/transition-rule-enforcement.test.mjs` covering: create rule → allowed transition proceeds; create rule → approval-required without flag returns 422; create rule → blocked returns 422 with no DB mutation to `tenant_plan_assignments`; no-matching-rule fallback via `TRANSITION_POLICY_FALLBACK_ON_MISSING_RULE`
- [ ] T026 [US1] Write integration test `tests/integration/102-plan-transition-policies/concurrent-transition-guard.test.mjs` covering: two concurrent `plan-assign` calls for the same tenant → exactly one succeeds (200), the other returns 409 `TRANSITION_IN_PROGRESS`; verify `tenant_transitions_in_progress` row has `completed_at` set after the successful transition

**Checkpoint**: US1 complete — transition compatibility rules are enforced on every plan assignment. Concurrent guard active. No-op detection active.

---

## Phase 4: User Story 2 — Limit Excess Policy Enforcement on Downgrade (Priority: P1)

**Goal**: When a downgrade creates over-limit conditions on any quota dimension, the platform evaluates the configured limit excess policy per dimension and applies the correct response: grace period (tenant keeps resources, deadline recorded), block-creation (creation blocked for that dimension), or block-transition (assignment rejected entirely). Grace periods auto-escalate to block-creation on expiry via a scheduled sweep.

**Independent Test**: Create a tenant with usage exceeding the target plan's limits. Attempt downgrade with each of the three policy modes (`grace_period`, `block_creation`, `block_transition`). Verify grace period rows, over-limit rows, and Kafka events are created correctly. Trigger sweep and verify escalation.

### Implementation for User Story 2

- [ ] T027 [US2] Create `services/provisioning-orchestrator/src/services/excessConditionDetector.mjs` — ESM service implementing: (1) `detectExcessConditions(sourcePlan, targetPlan, tenantId)` — for each dimension where target value < source effective value, calls the consumption collector abstraction from 100 (`QuotaImpactLineItem.observedUsage`) to read current usage; returns array of `{ dimensionKey, effectiveLimit, observedConsumption, isExcess, evaluationStatus }` where `evaluationStatus` is `active` or `deferred` if consumption data unavailable; (2) handles special sentinels per plan.md sentinel table: unlimited-to-finite (`-1` → positive), finite-to-unlimited (clean), zero-limit (`0` target with any usage > 0), absent dimension defaults
- [ ] T028 [US2] Extend `services/provisioning-orchestrator/src/services/transitionPolicyEvaluator.mjs` with `resolveExcessPolicy(sourcePlanId, targetPlanId, dimensionKey)` implementing the three-tier resolution algorithm from plan.md Phase 1 Policy Resolution Algorithm: dimension-level override → transition-level override → platform default → built-in fallback (`TRANSITION_POLICY_DEFAULT_MODE`, `TRANSITION_POLICY_DEFAULT_GRACE_DAYS`)
- [ ] T029 [US2] Extend the `plan-assign.mjs` modification (T023) to add excess evaluation steps 6–11 from plan.md sequence: (a) if upgrade → skip excess evaluation; (b) call `excessConditionDetector.detectExcessConditions`; (c) for each excess dimension call `transitionPolicyEvaluator.resolveExcessPolicy`; (d) if any dimension has `block_transition` → INSERT `plan_transition_audit_events` (blocked_by_excess), mark complete, return 422 `EXCESS_BLOCK_TRANSITION` with dimension breakdown; (e) within DB transaction: commit assignment (097 pattern), INSERT `plan_transition_audit_events` (allowed), INSERT `tenant_grace_period_records` for grace-period dimensions, INSERT `tenant_over_limit_conditions` for block-creation and grace-period dimensions, INSERT `plan_change_history_entry` (100 pattern); (f) publish Kafka events fire-and-forget; (g) mark complete
- [ ] T030 [P] [US2] Create `services/provisioning-orchestrator/src/actions/grace-period-sweep.mjs` — OpenWhisk action designed to be called by an alarm trigger every 10 minutes; reads `GRACE_PERIOD_SWEEP_BATCH_SIZE` env var; calls `gracePeriodRepository.listExpired(batchSize)`; for each record: within a single DB transaction calls `gracePeriodRepository.markEscalated(id)` and UPSERTs `tenant_over_limit_conditions` with `policy_mode = 'block_creation'`; publishes `console.plan.grace_period.expired` Kafka event; returns summary `{ processed, escalated, errors }`
- [ ] T031 [P] [US2] Write unit tests for `excessConditionDetector.mjs` in `tests/unit/102-plan-transition-policies/excessConditionDetector.test.mjs` covering: unlimited-to-finite detection; finite-to-unlimited clean path; zero-limit detection; `deferred` status when consumption data unavailable; multi-dimension mixed results; absent dimension inherits catalog default
- [ ] T032 [P] [US2] Write unit tests for `resolveExcessPolicy` in `tests/unit/102-plan-transition-policies/policyResolutionHierarchy.test.mjs` covering all 8 policy layer combination cases: D>T>P, D>T (no platform), D>P (no transition), T>P (no dimension), D only, T only, P only, none (built-in fallback)
- [ ] T033 [US2] Write integration test `tests/integration/102-plan-transition-policies/limit-excess-grace-period.test.mjs` covering: downgrade with `grace_period` policy → `tenant_grace_period_records` row created with correct `expires_at`, `tenant_over_limit_conditions` row created with `policy_mode = 'grace_period'`, Kafka `console.plan.excess.detected` event emitted, tenant retains existing resources
- [ ] T034 [P] [US2] Write integration test `tests/integration/102-plan-transition-policies/limit-excess-block-creation.test.mjs` covering: downgrade with `block_creation` policy → `tenant_over_limit_conditions` row with `policy_mode = 'block_creation'`, no grace period record created, assignment succeeds, existing resources unaffected
- [ ] T035 [P] [US2] Write integration test `tests/integration/102-plan-transition-policies/limit-excess-block-transition.test.mjs` covering: downgrade with `block_transition` policy → 422 `EXCESS_BLOCK_TRANSITION` response, zero mutations to `tenant_plan_assignments`, zero over-limit records created (SC-005)
- [ ] T036 [US2] Write integration test `tests/integration/102-plan-transition-policies/grace-period-expiry-sweep.test.mjs` covering: insert an active grace period with `expires_at` in the past → call sweep action → verify `status = 'expired_escalated'`, `tenant_over_limit_conditions.policy_mode = 'block_creation'`, Kafka event emitted; verify already-escalated records are not reprocessed

**Checkpoint**: US2 complete — all three limit excess policy modes enforced on downgrade. Grace period sweep active. Zero partial mutations possible on blocked transitions.

---

## Phase 5: User Story 3 — Policy Configuration & Hypothetical Evaluation (Priority: P1)

**Goal**: Superadmins can configure the platform-wide default limit excess policy, add per-transition and per-dimension overrides, and query the effective policy for any hypothetical transition without triggering side effects.

**Independent Test**: Configure default policy, add per-transition and per-dimension overrides, query `excess-policy-evaluate` for various combinations, verify the three-tier resolution hierarchy produces the expected result at each layer.

### Implementation for User Story 3

- [ ] T037 [US3] Create `services/provisioning-orchestrator/src/actions/excess-policy-set.mjs` — OpenWhisk action that validates `structural_admin` scope; accepts body with `scopeType`, optional `sourcePlanId`/`targetPlanId` (for transition scope), optional `dimensionKey` (for dimension scope), `policyMode`, optional `gracePeriodDays`; validates CHECK constraints (grace_period requires gracePeriodDays > 0); upserts into `plan_excess_policy_config`; emits `plan_audit_events` row with `action_type = 'excess.policy.set'` including previous value snapshot; warns in API response if `policyMode = 'block_transition'` and `scopeType = 'platform_default'` (per plan.md Risk: admin misconfiguration)
- [ ] T038 [P] [US3] Create `services/provisioning-orchestrator/src/actions/excess-policy-get.mjs` — OpenWhisk action that validates `structural_admin` scope; accepts optional query params `scopeType`, `sourcePlanId`, `targetPlanId`, `dimensionKey`; returns matching policy config rows or all rows if no filter; returns 200 with array
- [ ] T039 [P] [US3] Create `services/provisioning-orchestrator/src/actions/excess-policy-evaluate.mjs` — OpenWhisk action (dry-run, no side effects) that validates `structural_admin` scope; accepts body with `sourcePlanId`, `targetPlanId`, and optional `tenantId` for simulated consumption data; calls `transitionPolicyEvaluator.resolveExcessPolicy` for each quota dimension in the target plan; returns resolved policy per dimension with `governingLayer` field (`dimension_override` | `transition_override` | `platform_default` | `built_in_fallback`) and the matched policy details; never writes to any table
- [ ] T040 [P] [US3] Create `services/provisioning-orchestrator/src/actions/grace-period-list.mjs` — OpenWhisk action that validates `structural_admin` scope; accepts `tenantId` path param and optional `status` query param; calls `gracePeriodRepository.listByTenant(tenantId)`; returns 200 with array of grace period records
- [ ] T041 [US3] Write integration test `tests/integration/102-plan-transition-policies/policy-resolution-hierarchy.test.mjs` covering: configure platform default → evaluate → returns platform default; add transition override → evaluate same scenario → returns transition override; add dimension override → evaluate → returns dimension override for that dimension, transition override for others; delete dimension override → reverts to transition override; verify `governingLayer` field in all responses

**Checkpoint**: US3 complete — superadmins can configure and audit the full policy hierarchy. Hypothetical evaluation available without side effects.

---

## Phase 6: User Story 4 — Tenant Owner Communication & Creation Blocking (Priority: P2)

**Goal**: Tenant owners see over-limit status in the console: which dimensions are over-limit, the applicable policy (grace deadline or creation block), current consumption vs limit, and suggested remediation. Resource creation attempts for over-limit dimensions are blocked at the action layer with a clear, actionable error.

**Independent Test**: Trigger a downgrade creating over-limit conditions. Load the tenant over-limit status endpoint and console page — verify all dimensions, deadlines, and suggested actions are shown. Attempt to create a resource of an over-limit type — verify 403 with correct `OVER_LIMIT_CREATION_BLOCKED` body.

### Implementation for User Story 4

- [ ] T042 [US4] Create `services/provisioning-orchestrator/src/actions/over-limit-status-get.mjs` — OpenWhisk action scoped to tenant-owner JWT; queries `tenant_over_limit_conditions WHERE tenant_id = :tenantId AND evaluation_status = 'active'`; joins with `tenant_grace_period_records` for grace period deadlines; returns per-dimension status including `dimensionKey`, `effectiveLimit`, `observedConsumption`, `policyMode`, `gracePeriodExpiresAt` (if applicable), `suggestedAction` string; enforces tenant-scoped isolation (never returns another tenant's data)
- [ ] T043 [US4] Add over-limit creation guard to resource creation actions: create `services/provisioning-orchestrator/src/services/overLimitCreationGuard.mjs` — ESM module exporting `assertCreationAllowed(tenantId, dimensionKey, pool)` that queries `tenant_over_limit_conditions WHERE tenant_id = :tenantId AND dimension_key = :dimensionKey AND evaluation_status = 'active' AND policy_mode IN ('block_creation', 'grace_period_escalated')`; throws structured error `{ code: 'OVER_LIMIT_CREATION_BLOCKED', message, dimension, currentUsage, effectiveLimit, policyMode }` if a blocking condition exists; call this guard from resource creation actions where scope enforcement applies (workspace creation, API key creation, etc.)
- [ ] T044 [P] [US4] Create `apps/web-console/src/pages/ConsoleTenantOverLimitStatusPage.tsx` — React 18 + Tailwind CSS + shadcn/ui page accessible at `/console/plan/over-limit`; calls `over-limit-status-get` action; displays over-limit dimensions using `OverLimitDimensionList` component; shows grace period countdown using `GracePeriodCountdown` component; shows suggested actions per dimension; empty state when no active conditions
- [ ] T045 [P] [US4] Create `apps/web-console/src/components/GracePeriodCountdown.tsx` — React component displaying a countdown to grace period expiry given `expiresAt: string` prop; uses `date-fns` or equivalent; renders as a badge with days remaining; urgent styling when < 7 days; expired styling when past deadline
- [ ] T046 [P] [US4] Create `apps/web-console/src/components/OverLimitDimensionList.tsx` — React component rendering a table of over-limit dimensions given an array of `{ dimensionKey, effectiveLimit, observedConsumption, policyMode, gracePeriodExpiresAt, suggestedAction }` props; uses `ExcessPolicyBadge` for policyMode display
- [ ] T047 [P] [US4] Create `apps/web-console/src/components/ExcessPolicyBadge.tsx` — React component rendering a colored badge for `policyMode` prop values: `grace_period` (yellow), `block_creation` (orange), `block_transition` (red); accepts optional `gracePeriodExpiresAt` to show deadline in tooltip

**Checkpoint**: US4 complete — tenant owners can see and act on over-limit conditions. Resource creation is blocked with clear messaging for `block_creation` dimensions.

---

## Phase 7: User Story 5 — Superadmin Audit Trail & Console (Priority: P2)

**Goal**: Superadmins and compliance officers can review the full audit trail for plan transitions including compatibility rule evaluation, excess conditions detected, policies applied, and grace period escalations. Superadmin console pages allow rule catalog management and policy configuration.

**Independent Test**: Perform allowed, blocked-by-rule, and blocked-by-excess transitions plus a grace period escalation. Query `plan_transition_audit_events` via API — verify each entry contains complete policy evaluation details. Load superadmin console pages — verify rule catalog and policy configuration are rendered.

### Implementation for User Story 5

- [ ] T048 [US5] Create APISIX route file `services/gateway-config/routes/plan-transition-policy-routes.yaml` defining upstream routes for all 8 new endpoints: `POST /v1/admin/plan-transition-rules`, `GET /v1/admin/plan-transition-rules`, `DELETE /v1/admin/plan-transition-rules/:id`, `PUT /v1/admin/excess-policy`, `GET /v1/admin/excess-policy`, `POST /v1/admin/excess-policy/evaluate`, `GET /v1/admin/tenants/:tenantId/grace-periods`, `GET /v1/tenant/plan/over-limit-status`; apply `structural_admin` scope enforcement on admin routes; apply tenant-owner scope on `/v1/tenant/plan/over-limit-status`
- [ ] T049 [P] [US5] Create `apps/web-console/src/pages/ConsolePlanTransitionRulesPage.tsx` — React 18 + Tailwind CSS + shadcn/ui page at `/console/admin/plans/transition-rules`; calls `transition-rule-list`, renders `TransitionRuleTable` component; includes Add Rule modal (calls `transition-rule-create`) and Delete confirmation (calls `transition-rule-delete`); shows source/target plan names with wildcard display for null values; optimistic updates with toast notifications
- [ ] T050 [P] [US5] Create `apps/web-console/src/pages/ConsolePlanExcessPolicyPage.tsx` — React 18 + Tailwind CSS + shadcn/ui page at `/console/admin/plans/excess-policy`; calls `excess-policy-get`; renders platform default, transition overrides, and dimension overrides in separate sections; includes Edit Policy modal with `scopeType` selector (calls `excess-policy-set`); includes Dry-Run Evaluate panel (calls `excess-policy-evaluate` with plan pair input); shows `governingLayer` badges per dimension in dry-run results
- [ ] T051 [P] [US5] Create `apps/web-console/src/components/TransitionRuleTable.tsx` — React component rendering a sortable table of `plan_transition_compatibility_rules` rows with columns: Source Plan, Target Plan, Disposition badge, Justification, Created By, Created At, Delete action; handles wildcard (null) values as "Any Plan" display; uses shadcn/ui `Table` and `Badge` components
- [ ] T052 [US5] Write integration test for audit trail completeness covering all outcome types in `tests/integration/102-plan-transition-policies/transition-rule-enforcement.test.mjs` (extend existing): (a) verify every transition attempt produces a `plan_transition_audit_events` row; (b) blocked-by-rule row has `final_outcome = 'blocked_by_rule'` and `compatibility_rule_id` set; (c) blocked-by-excess row has `final_outcome = 'blocked_by_excess'` and `over_limit_dimensions` JSONB populated; (d) allowed row has `final_outcome = 'allowed'` and `policy_evaluation_detail` populated; (e) no-op row has `final_outcome = 'no_op'`

**Checkpoint**: US5 complete — full audit trail persisted and queryable. Superadmin console pages functional.

---

## Phase 8: User Story 6 — Upgrade Clean Path (Priority: P3)

**Goal**: Upgrade transitions (all dimensions equal or higher) complete immediately with no excess evaluation, no over-limit records, and no grace periods. New dimensions introduced by the target plan take effect immediately. The audit record is marked as a clean upgrade.

**Independent Test**: Upgrade a tenant to a plan with strictly higher limits. Verify zero `tenant_over_limit_conditions` rows created, zero `tenant_grace_period_records` rows created, `plan_transition_audit_events.final_outcome = 'allowed'` with empty `over_limit_dimensions`, and no Kafka excess events emitted.

### Implementation for User Story 6

- [ ] T053 [US6] Write unit tests for `transitionPolicyEvaluator.classifyDirection` in `tests/unit/102-plan-transition-policies/transitionPolicyEvaluator.test.mjs` (extend T024) covering: pure upgrade (all dims ≥); pure downgrade (at least one dim <); mixed (some dims increase, some decrease → `downgrade`); new dimension introduced in target (no source value → clean, not excess); dimension removed in target; unlimited source + finite target → `downgrade`; finite source + unlimited target → `upgrade`; same plan both sides → `equivalent`
- [ ] T054 [US6] Write integration test `tests/integration/102-plan-transition-policies/upgrade-clean-path.test.mjs` covering: upgrade to higher-limit plan → assignment succeeds, zero `tenant_over_limit_conditions` rows for this tenant, zero `tenant_grace_period_records` rows, `plan_transition_audit_events.over_limit_dimensions = '[]'`, `final_outcome = 'allowed'`; upgrade introducing a new quota dimension → new dimension effective immediately, no excess evaluated for it; verify no `console.plan.excess.detected` Kafka event emitted

**Checkpoint**: US6 complete — upgrade path is noise-free in audit trail and never triggers excess evaluation machinery.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Contract validation, AGENTS.md update, feature flag verification, and operational correctness checks.

- [ ] T055 [P] Write contract test suite `tests/integration/102-plan-transition-policies/contracts.test.mjs` — for each endpoint in `contracts/*.json`, call the live action and validate the response shape against the OpenAPI JSON schema using `@in-falcone/internal-contracts` validation patterns; for each Kafka event type in `contracts/kafka-events.json`, capture emitted event payloads during integration tests and validate against schema
- [ ] T056 [P] Add feature flag integration test: verify that with `TRANSITION_POLICY_ENFORCEMENT_ENABLED=false` all plan-assign calls proceed as if no policy evaluation occurred — no `plan_transition_audit_events` rows created, no `tenant_transitions_in_progress` rows, blocked rules ignored, excess conditions not evaluated
- [ ] T057 [P] Add AGENTS.md entry for feature 102 documenting: new tables (6), new actions (9), new Kafka topics (7), new env vars (10), new console pages (3), key behaviors (three-tier hierarchy, grace period sweep, concurrent guard, feature flag)
- [ ] T058 [P] Operational validation script in `specs/102-plan-transition-limits-policies/quickstart.md` (extend T008): add post-migration checks: `SELECT COUNT(*) FROM plan_excess_policy_config` returns 0 (no default pre-configured — fallback env vars apply); no `tenant_grace_period_records` with `status = 'active'` AND `expires_at < NOW()` after first sweep; all `plan_transition_audit_events` rows have non-null `final_outcome`
- [ ] T059 Run full integration test suite via `pnpm test` from repo root and confirm all tests in `tests/integration/102-plan-transition-policies/` pass with zero failures

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — documentation artifacts, start immediately
- **Phase 2 (Foundational)**: No code dependencies — can start immediately; blocks Phases 3–8
- **Phase 3 (US1)**: Requires Phase 2 complete
- **Phase 4 (US2)**: Requires Phase 2 complete; Phase 3 must be complete (extends `plan-assign.mjs` from T023)
- **Phase 5 (US3)**: Requires Phase 2 complete; benefits from Phase 4 (uses same evaluator)
- **Phase 6 (US4)**: Requires Phase 4 complete (needs `tenant_over_limit_conditions` rows to exist)
- **Phase 7 (US5)**: Requires Phase 3 and Phase 4 complete (audit events produced by both)
- **Phase 8 (US6)**: Requires Phase 3 complete (extends same evaluator unit tests)
- **Phase 9 (Polish)**: Requires all prior phases complete

### User Story Dependencies

- **US1 (P1)**: Starts after Phase 2. No dependency on other user stories.
- **US2 (P1)**: Starts after Phase 2. Requires US1 plan-assign modification complete (T023) to extend it (T029).
- **US3 (P1)**: Starts after Phase 2. Runs in parallel with US1/US2 (separate actions, shared evaluator service).
- **US4 (P2)**: Requires US2 complete (needs `tenant_over_limit_conditions` table populated).
- **US5 (P2)**: Requires US1 and US2 complete (needs `plan_transition_audit_events` rows from both).
- **US6 (P3)**: Requires US1 complete (extends evaluator). Fully independent of US2–US5.

### Critical Path

```text
Phase 2 → T023 (plan-assign US1) → T029 (plan-assign US2) → T042 (over-limit-status US4)
                                                           → T052 (audit trail US5)
```

---

## Parallel Execution Examples

### Phase 2 Parallel Batch

```text
Parallel: T010, T011, T012, T013 (models — independent files)
Parallel: T015, T016, T017 (repositories — independent files)
Then sequential: T014 (rule repo — uses models), T018 (Helm values)
```

### Phase 3 Parallel Batch (after T009 migration complete)

```text
Parallel: T020 (rule-create action), T021 (rule-list action), T022 (rule-delete action)
Parallel with above: T024 (unit tests for evaluator)
Then sequential: T019 (evaluator service), T023 (plan-assign modification)
Then: T025, T026 (integration tests)
```

### Phase 4 Parallel Batch (after T023 complete)

```text
Parallel: T031 (excess detector unit tests), T032 (policy resolution unit tests)
Sequential: T027 (excess detector), T028 (resolveExcessPolicy in evaluator)
Then: T029 (plan-assign extension)
Parallel: T030 (sweep action), T033, T034, T035, T036 (integration tests)
```

### Phase 5 + Phase 8 Parallel (after Phase 4 foundation ready)

```text
Phase 5: T037 (policy-set), T038 (policy-get), T039 (policy-evaluate), T040 (grace-period-list) — all parallel
Phase 8: T053 (unit tests), T054 (integration test) — parallel with Phase 5
```

---

## Implementation Strategy

### MVP First (P1 User Stories Only)

1. Complete Phase 1: Documentation artifacts
2. Complete Phase 2: Foundational — migration, models, repos, events, env vars
3. Complete Phase 3: US1 — Transition compatibility rules + plan-assign enforcement
4. **VALIDATE**: Test US1 independently — rule enforcement, concurrent guard, no-op
5. Complete Phase 4: US2 — Limit excess enforcement + grace period sweep
6. **VALIDATE**: Test US2 independently — all three policy modes, sweep escalation
7. Complete Phase 5: US3 — Policy configuration API
8. **VALIDATE**: Test US3 independently — policy CRUD, dry-run evaluate, hierarchy
9. **STOP / DEMO**: All P1 stories complete — safe to deploy with `TRANSITION_POLICY_ENFORCEMENT_ENABLED=false`

### Incremental Delivery

1. Foundation + US1 → deploy (flag off) → validate → enable flag
2. Add US2 → deploy → validate grace period and creation blocking
3. Add US3 → deploy → ops team can configure policies via API
4. Add US4 → deploy → tenant console over-limit visibility
5. Add US5 → deploy → superadmin audit trail and console
6. Add US6 → deploy → upgrade path clean (was already implicit, now tested)
7. Phase 9 polish → final CI gate

---

## Notes

- All tasks follow `[Checkbox] [TaskID] [P?] [Story?] Description with file path` format
- `[P]` tasks can run in parallel within their phase (different files, no in-progress dependencies)
- `[Story]` label maps each task to a specific user story for traceability and independent testing
- Feature flag `TRANSITION_POLICY_ENFORCEMENT_ENABLED=false` allows shadow deployment before activation
- The `plan-assign.mjs` modification (T023 + T029) is the only change to an existing tracked action; all other tasks create new files
- Grace period sweep (T030) must be registered as an OpenWhisk alarm trigger after deployment; the cron registration is operational work, not a code task
- `tenant_transitions_in_progress.completed_at` must be set in a `finally` block to avoid permanently locking a tenant if the action crashes mid-flight
- Consumption data from 100's collector abstraction is the authoritative source for excess detection; if unavailable, mark `deferred` and never block the transition for that dimension alone
