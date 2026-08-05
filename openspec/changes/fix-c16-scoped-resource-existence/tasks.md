# Tasks: Confirm scoped resource existence before metrics and storage usage

This checklist records the independently reviewed implementation and delivery state for C-16.
Unchecked items remain pending and are not claimed complete.

## 1. Preserve the C-16 boundary

- [x] 1.1 Re-read `proposal.md`, `design.md`, and `specs/observability/spec.md`; resolve any independent
  spec-critic blocking issue before changing product code.
- [x] 1.2 Limit the implementation diff to the existing metrics scope guard, workspace storage-usage
  handler, registered-route resource/telemetry sanitization, unified OpenAPI and generated public-API
  family/catalog/reference, affected console error state, focused tests, detailed docs, and this
  OpenSpec change.
- [x] 1.3 Confirm the change adds no role, permission, route, operation id, store, persistence schema,
  migration, domain audit event, metric family, quota/metering mutation, rate-limit rule, gateway/Helm
  configuration, production UI redesign, C-02 envelope/schema/taxonomy change, or remediation for
  C-01/C-04/C-09/C-10.
- [x] 1.4 Keep all validation local and hermetic; do not deploy to or mutate a Kubernetes/OpenShift
  cluster and do not create credentials, kubeconfigs, runtime evidence, loop-state, Playwright results,
  or deployment artifacts.

## 2. Establish pre-fix black-box failures

- [x] 2.1 Add `tests/blackbox/scoped-resource-existence-c16.test.mjs` (or the repository's focused C-16
  equivalent) against public handler/HTTP interfaces and run it before the production fix to record
  the expected red failures for fabricated unknown-scope `200` responses; do not commit raw logs.
- [x] 2.2 Cover all six tenant handler families—quota posture, overview, usage snapshot, runtime-only
  series, audit records, and audit export—with an authorized unknown tenant returning
  `404 TENANT_NOT_FOUND` and spies proving no limits/default/provider/audit/export dependency ran.
- [x] 2.3 Add a hermetic real control-plane HTTP/server-seam suite for absent and invalid bearer
  credentials across all six tenant metrics handlers and workspace storage usage; prove `401` occurs
  before registry/downstream work, and prove audit-export authentication precedes generic JSON parsing
  while a parsed request reaches handler scope gates before C-10 leaf validation/export work.
- [x] 2.4 Extend `tests/blackbox/metrics-tenant-authorization.test.mjs` or the focused C-16 suite to prove
  constrained foreign-existing and unrelated-unknown tenants both return indistinguishable
  `403 FORBIDDEN` without `getTenant`, downstream registry/provider work, or target-scope metric attribution
  derived from the addressed identifier; preserve bounded request telemetry and existing attributable
  `scope_enforcement_denials` writes.
- [x] 2.5 Add workspace-metrics preservation cases proving unknown workspace `404`, known foreign
  workspace `403`, authorized existing workspace success, and no separate owning-tenant registry
  re-probe.
- [x] 2.6 Add storage-usage cases proving privileged unknown workspace `404`, constrained foreign-
  existing and unknown workspaces both opaque `404`, and zero bucket-registry/S3/quota/default calls
  after a terminal scope result.

## 3. Implement backend scope resolution

- [x] 3.1 In `apps/control-plane/metrics-handlers.mjs`, add exactly one
  `tenant-store.getTenant` confirmation for tenant paths after `canManageTenant` succeeds and before
  `ctx.resolvedScope`, scope attribution, handler-level semantic validation, or leaf-handler
  invocation. Generic HTTP body parsing remains at the server boundary.
- [x] 3.2 Return the existing handler-level `err(404, 'TENANT_NOT_FOUND', ...)` for a null/absent tenant
  row across all six shared-guard handlers; do not swallow a datastore exception into `404` or a
  degraded `200`.
- [x] 3.3 Add handler and normalized-HTTP cases where `getTenant` fails: prove the local handler rejects
  with the original registry exception, the HTTP boundary converts it to the sanitized canonical
  `500 GW_CONTROL_PLANE_ERROR`, neither surface returns tenant not-found or `200`, and no limits/
  provider/audit/export dependency runs.
- [x] 3.4 Preserve the tenant authorization short-circuit and the complete workspace metrics branch,
  including workspace lookup, unknown `404`, known-foreign `403`, canonical owning-tenant scope, and
  provider behavior.
- [x] 3.5 In `apps/control-plane/storage-handlers.mjs`, resolve the workspace for every
  `storageWorkspaceUsage` actor, return `WORKSPACE_NOT_FOUND` on absence, apply the existing opaque
  ownership `404` for constrained callers, and use the canonical resolved workspace id downstream.
- [x] 3.6 Ensure both terminal storage `404` paths return before `listBucketsForWorkspace`,
  `listObjects`, object total calculations, `usageLimits`, and default resolution; preserve current
  results and calculations after a positive authorized lookup.
- [x] 3.7 Add handler and normalized-HTTP cases where `getWorkspace` fails for workspace metrics and
  storage usage: prove the local handler rejects with the original registry exception, the HTTP
  boundary converts it to the sanitized canonical `500 GW_CONTROL_PLANE_ERROR`, neither surface
  returns workspace not-found or zero/degraded `200`, and no limits/provider/audit/export/bucket/S3/
  quota/default dependency runs.
- [x] 3.8 Keep the implementation in already packaged modules with no new runtime dependency; if a
  helper extraction becomes unavoidable, add explicit Docker packaging coverage and obtain scope
  review before proceeding.

## 4. Publish the precise OpenAPI contract

- [x] 4.1 Add a JSON `404` response referencing `#/components/schemas/ErrorResponse` in
  `apps/control-plane-executor/openapi/control-plane.openapi.json` for tenant operations
  `getTenantQuotaPosture`, `getTenantQuotaUsageOverview`, `getTenantUsageSnapshot`,
  `listTenantAuditRecords`, and `exportTenantAuditRecords`.
- [x] 4.2 Add the same canonical response for workspace operations `getWorkspaceQuotaPosture`,
  `getWorkspaceQuotaUsageOverview`, `getWorkspaceUsageSnapshot`, `getWorkspaceMetricSeries`,
  `listWorkspaceAuditRecords`, and `exportWorkspaceAuditRecords`.
- [x] 4.3 Assert that no tenant series operation is published, `getWorkspaceStorageUsage` retains its
  existing canonical `404`, and no other response, path, method, operation id, schema, security rule,
  tag, or rate-limit extension changes.
- [x] 4.4 Run `npm run generate:public-api` and inspect the generated metrics family, public route
  catalog, and public API reference for only the expected source-derived changes.
- [x] 4.5 Add a focused contract test that discovers operations by operation id, compares the exact set
  of eleven operation ids whose `404` is newly modified by C-16, validates each `$ref`, proves tenant
  series remains absent, preserves storage `404` and every pre-existing metrics `404` (including both
  audit-correlation operations), and fails on generated-artifact drift.
- [x] 4.6 Exercise the resulting HTTP `404` responses against the existing C-02 closed
  `ErrorResponse`; assert the local `TENANT_NOT_FOUND`/`WORKSPACE_NOT_FOUND` classes and canonical
  normalized on-wire codes without introducing an alternate envelope or taxonomy.
- [x] 4.7 Use arbitrary short tenant/workspace targets across all thirteen affected HTTP operations
  and prove terminal `401`, `403`, `404`, and registry-failure `500` error resources retain C-02
  `{id}` placeholders while request counter and histogram labels use bounded registered route
  templates; neither surface may contain a raw target. For constrained tenant callers, compare a short
  foreign-existing target with a different short unknown target and prove identical `403` disclosure,
  no registry lookup, and no downstream work. Add an outside-C-16 compatibility control.

## 5. Preserve authorized real-resource successes

- [x] 5.1 Update tenant metrics fixtures to create an authoritative tenant row before any test that
  intentionally exercises a real scope; remove accidental reliance on a path id with no registry row.
- [x] 5.2 Prove an existing tenant with no configured limits or provider evidence still returns its
  schema-valid honest empty/degraded `200` for quota posture, overview, usage, and series.
- [x] 5.3 Prove an existing tenant with no matching audit rows still returns the current schema-valid
  empty audit collection and export manifest at `200`.
- [x] 5.4 Update storage fixtures to create an authoritative workspace row and prove a real workspace
  with no buckets or objects keeps its truthful zero-valued usage snapshot and existing quota/default
  math at `200`.
- [x] 5.5 Retain populated tenant/workspace fixtures that compare every affected success schema,
  resolved scope field, provider-derived value, degradation rule, storage total, and remaining-capacity
  calculation with the pre-C-16 behavior.

## 6. Add console stale/error regressions

- [x] 6.1 Extend `apps/web-console/src/lib/console-quotas.test.ts` with a success-to-scope-`404`
  transition proving both tenant and workspace posture are cleared and the existing retry/error state
  is exposed.
- [x] 6.2 Extend `apps/web-console/src/lib/console-metrics.test.ts` with success-to-`404` cases proving
  overview, usage, and series state is cleared rather than retained or normalized into a healthy empty
  result.
- [x] 6.3 Cover audit list and export `404`: records/pagination are cleared, no empty-history success or
  export manifest is fabricated, and the existing error feedback remains available.
- [x] 6.4 Extend `ConsoleStoragePage` tests with a workspace-selection or reload transition from a real
  usage snapshot to `404`, proving stale/zero usage is cleared and the existing unavailable/error state
  renders.
- [x] 6.5 Make only the minimal client/hook/page state-reset correction exposed by these regressions;
  retain the shared canonical error reader, localized existing affordances, accessibility semantics,
  navigation, layout, and visual design.

## 7. Write detailed documentation

- [x] 7.1 Add a detailed architecture reference for scoped resource existence covering the complete
  affected-operation inventory, tenant authentication→authorization→existence order, workspace-metrics
  `404`/`403` order, storage existence→opaque-ownership order, and the security rationale for their
  deliberate asymmetry.
- [x] 7.2 Document the local handler classes and canonical C-02 on-wire envelope, the exact eleven
  OpenAPI `404` declarations, the unpublished tenant series, and the unchanged storage declaration so
  API and SDK consumers know which outcomes to handle.
- [x] 7.3 Document real-empty versus absent examples for quota/usage/series/audit/export/storage,
  downstream short-circuits, route-derived error-resource and request-telemetry sanitization (including
  short targets and pre-authentication failures), read-only data-governance/telemetry/quota behavior,
  console stale-state handling, compatibility, rollback, and focused local troubleshooting/validation
  commands.
- [x] 7.4 Update or cross-link the observability success, storage capacity, and generated public API
  references as appropriate; include no secrets, raw evidence, environment-specific credentials,
  cluster mutation instructions, or unrelated product claims.

## 8. Validate locally without deployment

- [x] 8.1 Re-run the C-16 black-box suite after the fix and verify every pre-fix red case is green,
  including call-order and zero-downstream-work assertions.
- [x] 8.2 Run the existing tenant authorization, metrics degradation/success-schema, audit contract,
  storage quota/usage, and focused OpenAPI/public-interface regression suites affected by fixture or
  ordering changes.
- [x] 8.3 Run the focused web-console quotas, metrics/audit, observability page, and storage page Vitest
  suites; run the console typecheck and record only unrelated pre-existing baseline failures, with no
  C-16-modified file in a diagnostic.
- [x] 8.4 Run `npm run generate:public-api`, verify a clean second generation, then run
  `npm run validate:public-api` and `npm run validate:openapi`.
- [x] 8.5 Run markdownlint on all changed Markdown, applicable syntax/lint checks, and
  `git diff --check`; repair every C-16-owned failure.
- [x] 8.6 Run `openspec validate fix-c16-scoped-resource-existence --strict` and repair every issue
  before checker handoff.
- [x] 8.7 Confirm no cluster deployment or shared environment mutation was performed and no deployment,
  credential, evidence, loop-state, kubeconfig, test-result, or Playwright artifact entered the diff.

## 9. Obtain independent checks and deliver

- [x] 9.1 Give an independent OpenSpec critic the analyst requirements, architect design, C-16 artifacts,
  and strict-validation command; resolve every blocking precision, completeness, or delta-scope issue
  before implementation begins.
- [x] 9.2 Have an independent verifier reproduce the pre-fix finding and then confirm the fixed
  authorized-missing, constrained opacity, workspace-preservation, storage short-circuit, and real-
  resource success outcomes from fresh local fixtures.
- [x] 9.3 Obtain independent contract and authorization/isolation verdicts for the exact eleven-operation
  C-16 diff, preservation of pre-existing metrics `404` responses, C-02 envelope reuse, P10/P13
  boundaries, and absence of tenant enumeration.
- [x] 9.4 Obtain independent persona/journey, console UX/accessibility, and documentation verdicts for
  P1/P3/P4/P9 primary flows and P7/P10/P12/P13 adjacent/adversarial controls, without cluster access.
- [x] 9.5 Give a final reviewer the requirements, implementation diff, fresh commands/results, and prior
  checker verdicts; address every blocking item and rerun affected checks without maker self-approval.
- [x] 9.6 Inspect `git status` and the staged diff; force-add only the ignored
  `openspec/changes/fix-c16-scoped-resource-existence/**` artifacts plus reviewed implementation files,
  excluding `.claude`, `.codex`, `.agents`, `.agent-runtime`, loop-state, evidence, credentials,
  kubeconfigs, test-results, and Playwright artifacts.
- [ ] 9.7 Make focused commits with no unrelated or other-agent change reverted, push the approved
  `fix/audit-c16-scoped-resource-existence` branch, and open a draft PR with the requirement/scenario
  mapping and validation evidence; do not merge.
