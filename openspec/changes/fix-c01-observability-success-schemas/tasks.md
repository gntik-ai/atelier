# Tasks: Make observability success bodies conform

Checkboxes record the state of the implementation worktree at review time. Completed implementation,
test, documentation, and local-validation work is checked; independent review and PR delivery remain
unchecked until those steps finish.

## 1. Keep C-01 isolated

- [x] Limit the change to quota posture, quota/usage overview, usage snapshot, audit-record
  collections, and audit-export success bodies for tenant and workspace scopes.
- [x] Preserve the existing guard, routes, status codes, datastore, permissions, and read-only
  behavior. Do not change C-02, C-04, C-09, C-10, or C-16.
- [x] Make no cluster, chart, credential, kubeconfig, loop-state, or evidence change.

## 2. Correct quota, overview, and usage serializers

- [x] Derive `queryScope`, `tenantId`, and `workspaceId` only from the post-guard
  `ctx.resolvedScope`.
- [x] Emit the full `QuotaPosture`, scoped closed overview, and `UsageSnapshot` shapes with all
  required nested fields and canonical names.
- [x] Apply the published posture precedence and visual-state mapping while retaining
  `freshnessStatus` and `degradedDimensions` for stale evidence.
- [x] Treat an empty limit result conservatively as `evidence_unavailable`; never invent healthy
  posture, provisioning readiness, or zero-valued dimensions.
- [x] Keep the optional limit-reader test seam behind the existing authorization/scope guard.

## 3. Correct audit projections and exports

- [x] Normalize legacy rows to schema-valid actor, scope, resource, action, result, correlation, and
  origin objects; map `error` to `failed` and an absent/unrecognized outcome to `partial`.
- [x] Allow-list audit-record collection items so raw `detail` and hash extras are not returned by
  list operations; emit the required page, scope, applied-filter, available-filter, and console
  metadata without `nextCursor: null`.
- [x] Pass requested `jsonl`/`csv` format and resolved scope to the shared export builder.
- [x] Make the inline export fallback emit the same manifest/record contract and conservatively mask
  the entire detail object with populated masking metadata.

## 4. Align the web console

- [x] Consume canonical `snapshotTimestamp`, `currentUsage`, `value`, and `overallStatus` fields,
  retaining only harmless read compatibility with older responses.
- [x] Preserve current page structure, navigation, permissions, and visual behavior.
- [x] Add focused Vitest coverage for canonical field precedence and timestamp handling.

## 5. Add public-interface regression coverage

- [x] Add a hermetic real-handler Ajv suite for populated, degraded, unavailable, tenant, and
  workspace quota/overview/usage responses.
- [x] Cover legacy `error`/NULL audit rows, list allow-listing, primary and fallback exports,
  `jsonl`/`csv`, per-item masking, and sensitive-value non-disclosure.
- [x] Preserve C-04 as a closed-schema control and assert cross-tenant `403`, unknown-workspace
  `404`, and that rejected scopes never invoke the injected reader.
- [x] Update the existing audit integrity expectation from invalid `unknown` to contractual
  `partial`.

## 6. Document the behavior

- [x] Add `docs/reference/architecture/observability-success-response-contracts.md` with the endpoint
  to schema map, honest-degradation semantics, audit fallbacks/masking, frontend compatibility,
  isolation boundary, non-goals, and local validation commands.

## 7. Validate locally without deployment

- [x] Run the focused C-01/degradation/audit-integrity black-box tests.
- [x] Run the affected observability contract and metrics authorization suites.
- [x] Run the focused web-console Vitest suite.
- [x] Run `npm run validate:openapi` and
  `openspec validate fix-c01-observability-success-schemas --strict`.
- [x] Run syntax checks and `git diff --check`.
- [x] Record the repository-wide web-console typecheck as a baseline limitation if its unrelated
  pre-existing errors remain; no C-01-modified file may appear in its diagnostics.
- [x] Review Docker `COPY` coverage and run a static import check; do not build or deploy unless
  needed to resolve a packaging doubt.

## 8. Independent checks and delivery

- [x] Obtain independent contract, authorization, persona/journey, accessibility, verifier, docs,
  and final-review verdicts without accessing or deploying to the cluster.
- [x] Force-add and validate this ignored OpenSpec directory, while staging no runtime evidence,
  loop-state, credentials, kubeconfigs, or Playwright results.
- [x] Commit and push `fix/audit-c01-metrics-success-schema` and open a draft PR against
  `codex-integration`; do not merge.
