# Tasks: Fix workspace metric-series selection and scope

## 1. Preserve the bounded C-04 contract

- [x] 1.1 Keep the proposal, design, and `observability` delta aligned with C-04 /
  OBS-CONTRACT-04 only: supported HTTP request/error rates, exact windows, tenant-plus-workspace
  scope, schema-valid degradation, compatible producers, unchanged authorization, and unchanged
  console UX.
  - Paths: `openspec/changes/fix-c04-workspace-metric-series/`.
- [x] 1.2 Keep `storage_bytes` and every business/storage/component metric family out of the
  implementation; do not absorb C-07, other C-01 schemas, or the C-02 global error envelope.
- [x] 1.3 Do not change roles, permissions, workspace membership, gateway policy, quota behavior,
  dashboards, charts, datastore schemas, deployment configuration, or any other audit finding.

## 2. Correct the workspace series handler and provider contract

- [x] 2.1 Refactor the workspace series path in
  `apps/control-plane/metrics-handlers.mjs` to use required `query.metricKey` and `query.window`
  rather than `query.metric` or defaults.
- [x] 2.2 Define a closed key map:
  - `api_requests` selects the summed per-second rate of all
    `falcone_http_requests_total` samples for the resolved tenant/workspace;
  - `api_errors` selects the same rate restricted to status `5xx`; and
  - no request value is interpolated as a raw metric name, label selector, or PromQL expression.
- [x] 2.3 Define the exact window map:
  - `5m`: range 300 seconds, step 5 seconds;
  - `1h`: range 3,600 seconds, step 15 seconds;
  - `24h`: range 86,400 seconds, step 300 seconds;
  - `7d`: range 604,800 seconds, step 1,800 seconds; and
  - `30d`: range 2,592,000 seconds, step 7,200 seconds.
- [x] 2.4 Capture one integer end timestamp per request, calculate the exact start from the map,
  and prevent query/body/header overrides of start, end, step, key, tenant, workspace, or PromQL.
- [x] 2.5 Reject missing, empty, repeated/ambiguous, malformed, or unsupported `metricKey` and
  `window` values with a stable HTTP `400` before provider access.
  - Explicitly cover `storage_bytes`, legacy `http_requests_per_second`, and PromQL-like input.
  - Keep the current bounded runtime error style; do not repair shared `ErrorResponse` under C-04.
- [x] 2.6 Make the guarded workspace route pass the canonically resolved owner tenant and workspace
  to the series logic after the existing lookup and authorization decision.
  - Do not substitute identity tenant alone.
  - Do not change current missing-workspace, foreign-workspace, role, or superadmin behavior.
- [x] 2.7 Construct exact `tenant_id` and `workspace_id` Prometheus matchers with correct escaping
  for backslash, double quote, and line breaks, then encode the complete query through URL search
  parameters.
- [x] 2.8 Map only valid real provider samples to RFC 3339 timestamp plus finite numeric value.
  Preserve provider order; do not synthesize zeroes, interpolate gaps, or merge unlabeled legacy
  samples.
- [x] 2.9 Return `tenantId`, `workspaceId`, `metricKey`, `window`, `points`, and optional
  `unit: requests_per_second` for every `200`. Remove `source` and every other undeclared field.
- [x] 2.10 Degrade timeout/unreachability, provider non-success, invalid JSON, unsuccessful
  payload, absent result, and unusable samples to the same scoped response with `points: []`.
  - Do not expose provider URL, response content, error text, query, or labels.

## 3. Add trusted workspace labels to both HTTP metric producers

- [x] 3.1 Extend `apps/control-plane/metrics-registry.mjs` so `recordHttp` accepts an optional
  trusted `workspaceId`, keys workspace-scoped counter series distinctly, and renders
  `workspace_id` only when non-empty.
- [x] 3.2 Extend
  `apps/control-plane-executor/src/runtime/metrics-registry.mjs` with identical counter-key,
  escaping, rendering, and omission behavior.
- [x] 3.3 Thread the canonical workspace and its owning tenant to the control-plane request metric
  only after the existing authentication/authorization boundary and canonical lookup, regardless
  of final HTTP status; never trust identity alone, query/body values, raw path IDs, or
  client-supplied identity headers.
- [x] 3.4 Thread a workspace to the executor request metric only from its trusted resolved identity
  after existing route and workspace scope enforcement.
  - When the canonical ownership resolver runs and returns no owner, omit `workspace_id` instead
    of falling back to a gateway identity candidate.
  - Keep public `healthz` and `readyz` counters workspace-unscoped even when identity input contains
    a gateway-trusted, credential-bound, or legacy-mode workspace.
- [x] 3.5 Preserve the current tenant, normalized route, method, status, duration histogram,
  process uptime, scrape content type, and anonymous behavior.
  - Platform, tenant-only, anonymous, health, unmatched, and otherwise unscoped counters omit
    `workspace_id`; do not render empty or `anonymous` workspace values.
- [x] 3.6 Confirm the new label is bounded to trusted/resolved workspace IDs and that no credential,
  subject, raw header, query string, provider payload, response content, or arbitrary label enters
  metric output.

## 4. Align the public wire contract

- [x] 4.1 Update the canonical `getWorkspaceMetricSeries` OpenAPI parameter schema so
  `metricKey` is required and enumerates exactly `api_requests` and `api_errors`.
- [x] 4.2 Retain required `window` with exactly `5m`, `1h`, `24h`, `7d`, and `30d`.
- [x] 4.3 Retain the closed `MetricSeriesResponse` with required `tenantId`, `workspaceId`,
  `metricKey`, `window`, and `points`, optional `unit`, closed point objects, and no `source`.
- [x] 4.4 Regenerate public API artifacts only if the repository's canonical generation workflow
  requires enum propagation; inspect and exclude unrelated generated drift.
- [x] 4.5 Keep the route, method, operation ID, SDK operation, rate-limit class, auth declaration,
  and existing `400` reference unchanged.

## 5. Preserve the frontend behavior

- [x] 5.1 Keep `apps/web-console/src/lib/console-metrics.ts` requesting
  `metricKey=api_requests` with the selected supported workspace window.
- [x] 5.2 Retain the current `24h`, `7d`, and `30d` workspace preset mapping and existing point
  normalization/empty-series handling.
- [x] 5.3 Do not add a metric picker, custom series date range, new call, retry loop, page,
  interaction, copy, accessibility, or visual change.
- [x] 5.4 Update or retain focused client tests proving the exact request URL changes with the
  selected window and that conforming populated/empty responses are consumed without `source`.

## 6. Add focused handler and isolation regression tests

- [x] 6.1 Add a focused handler test with injected/fake Prometheus fetch and deterministic time so
  no external network or clock race is required.
- [x] 6.2 Assert `api_requests` and `api_errors` produce their exact allowlisted PromQL, including
  both resolved labels and only the error query's `status=~"5.."` matcher.
- [x] 6.3 Assert all five windows produce the exact start/end difference and step from the design
  table and that no supported window becomes the old fixed one-hour/60-second query.
- [x] 6.4 Resolve two sibling workspaces under one tenant and assert their selectors differ by
  exact `workspace_id`; provider results from one selector cannot populate the other's response.
- [x] 6.5 Add escaping cases proving quote, backslash, and line-break content remains data inside
  exact label matchers and cannot alter PromQL.
- [x] 6.6 Assert missing, empty, repeated/ambiguous, unsupported, and PromQL-like keys/windows
  return stable `400` before fetch, including `storage_bytes`.
- [x] 6.7 Assert usable provider data returns exact response fields and real points, while
  timeout, rejected fetch, non-`2xx`, invalid JSON, unsuccessful payload, missing result, and
  unusable samples each return a conforming empty response.
- [x] 6.8 Assert no success/degradation response has `source`, provider detail, raw query, or
  additional properties.
- [x] 6.9 Retain same-tenant success and existing missing/foreign/cross-tenant controls. Assert
  denied or unknown workspace requests do not fetch Prometheus and reveal no tenant, labels,
  points, counts, query, or provider information.
- [x] 6.10 Assert the GET path performs no application write and emits no domain audit event while
  normal HTTP request metrics remain active.

## 7. Add producer, contract, and console regression tests

- [x] 7.1 Extend `tests/unit/metrics-registry.test.mjs` or add equally focused tests that import
  each registry independently and prove:
  - workspace samples include escaped `workspace_id`;
  - sibling workspace series stay distinct;
  - tenant-only and anonymous samples omit the label; and
  - existing counter, histogram, route-normalization, uptime, and content-type assertions remain.
- [x] 7.2 Add a request-runtime regression for each server proving only trusted/resolved workspace
  context reaches `recordHttp`; a spoofed/untrusted workspace header never becomes a label.
  - For the control-plane, cover tenant-only JWT, workspace-bound JWT, privileged cross-tenant
    access, authorized `400`/`500` outcomes, foreign denial, spoofed header, unmatched route, and
    tenant-only route controls.
  - For the executor, cover an authenticated gateway identity whose path/header workspace is
    unknown to the canonical ownership resolver and therefore remains unlabeled, plus public
    probes carrying gateway, credential, and legacy-mode workspace identity input.
- [x] 7.3 Add a contract test that loads the canonical OpenAPI operation, asserts both parameter
  enums, and validates real handler success and every degradation body against
  `MetricSeriesResponse`, including `additionalProperties: false`.
- [x] 7.4 Retain or extend `apps/web-console/src/lib/console-metrics.test.ts` to cover
  `api_requests`, selected windows, populated points, and empty degradation without a `source`
  dependency.
- [x] 7.5 Keep all focused tests hermetic: no fixed ports, external network, Prometheus, Docker,
  credentials, browser, repository-writing fixture, or Kubernetes.

## 8. Update the focused reference

- [x] 8.1 Update
  `docs/reference/architecture/observability-metrics-time-range.md` with the supported keys,
  request-rate and `5xx`-rate meanings, and exact range/step table.
- [x] 8.2 Document tenant-plus-workspace matching, PromQL label escaping, conditional producer
  labels, and the rollout warm-up boundary that intentionally excludes legacy samples without
  `workspace_id`.
- [x] 8.3 Document schema-valid empty degradation, no fabricated values, unchanged console
  presets, GET/no-domain-audit/no-quota semantics, and focused local validation commands.
- [x] 8.4 Do not claim live verification or add evidence, loop-state, dashboard, chart, datastore,
  deployment, or broad observability documentation.

## 9. Validate the bounded implementation

- [x] 9.1 Run the focused backend handler test command selected by the implementation, expected to
  be:

  ```text
  node --test tests/unit/workspace-metric-series.test.mjs
  ```

- [x] 9.2 Run both registry suites, including:

  ```text
  node --test tests/unit/metrics-registry.test.mjs
  ```

- [x] 9.3 Run the focused OpenAPI/response contract test, expected to be:

  ```text
  node --test tests/contracts/workspace-metric-series.contract.test.mjs
  ```

- [x] 9.4 Run the focused console client test:

  ```text
  pnpm --dir apps/web-console exec vitest run src/lib/console-metrics.test.ts
  ```

- [x] 9.5 Validate canonical OpenAPI and public artifacts:

  ```text
  npm run validate:openapi
  npm run validate:public-api
  ```

- [x] 9.6 Validate the OpenSpec change and Markdown:

  ```text
  openspec validate fix-c04-workspace-metric-series --strict
  pnpm exec markdownlint-cli2 \
    "openspec/changes/fix-c04-workspace-metric-series/**/*.md" \
    "docs/reference/architecture/observability-metrics-time-range.md"
  ```

- [x] 9.7 Run `git diff --check` and review the final diff against
  `origin/codex-integration`. Confirm it contains only the C-04 handler/producer/wire/client tests,
  focused docs, and this OpenSpec change, with no other finding or implementation surface.
- [x] 9.8 Record live and cluster verification as **NOT RUN BY REQUEST**. Do not deploy, run
  Playwright, obtain credentials, capture evidence, modify loop-state, start Docker, access
  Kubernetes, change charts, migrate a datastore, or run external-provider probes.

## 10. Rollout and rollback review

- [x] 10.1 Confirm producer and reader changes are releasable together and document that
  workspace series may be empty or partial while new `workspace_id` samples warm up.
- [x] 10.2 Confirm workspace queries never fall back to legacy tenant-only samples and no
  migration or backfill is introduced.
- [x] 10.3 Confirm rollback is limited to code, OpenAPI/docs, and focused tests; existing
  workspace-labeled Prometheus samples require no cleanup and expire under normal retention.

## Implementation record

Implemented paths:

- `apps/control-plane/metrics-handlers.mjs`
- `apps/control-plane/request-metric-scope.mjs`
- `apps/control-plane/server.mjs`
- `apps/control-plane/metrics-registry.mjs`
- `apps/control-plane-executor/src/runtime/server.mjs`
- `apps/control-plane-executor/src/runtime/metrics-registry.mjs`
- `apps/control-plane-executor/openapi/control-plane.openapi.json`
- `apps/control-plane-executor/openapi/families/metrics.openapi.json` (generated)
- `apps/web-console/src/lib/console-metrics.ts`
- `apps/web-console/src/lib/console-metrics.test.ts`
- `tests/unit/workspace-metric-series.test.mjs`
- `tests/unit/metrics-registry.test.mjs`
- `tests/unit/metrics-runtime-workspace-propagation.test.mjs`
- `tests/contracts/workspace-metric-series.contract.test.mjs`
- `docs/reference/architecture/observability-metrics-time-range.md`

Focused handler, authorization, registry, runtime propagation, contract, and console tests passed.
`validate:repo`, `validate:openapi`, `validate:public-api`, strict OpenSpec validation, targeted
Markdown lint, syntax checks, and `git diff --check` passed. The full unit wildcard was attempted
but could not complete in this isolated worktree: most of its 68 failures cannot resolve baseline
package-local dependencies such as `cel-js` and `jose`; 460 tests passed. That attempt also caught
an executor identity-shape regression introduced by the first C-04 draft. The regression was
removed, and the affected identity/MCP tests plus the complete C-04 regression set passed
afterward. The broader console typecheck also remains blocked by pre-existing errors outside the
C-04 files. Live, browser, Docker, deployment, credential, external-provider, and cluster
verification: **NOT RUN BY REQUEST**.
