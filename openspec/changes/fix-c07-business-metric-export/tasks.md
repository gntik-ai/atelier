# Tasks

## 1. Lock the contract and failure reproduction

- [ ] 1.1 Add a focused regression that records the current C07 baseline: the executor's existing
  `/metrics` exposes the five legacy `falcone_*` sample names and no `in_falcone_*` sample after a
  real MCP tool invocation because `telemetry.metric` and `telemetry.latency` are discarded.
- [ ] 1.2 Add contract assertions for the only two in-scope outputs:
  `in_falcone_mcp_tool_invocations_total` as a counter and the `subsystem="mcp"`,
  `operation="tool_call"` slice of `in_falcone_component_operation_duration_seconds` as a
  histogram.
- [ ] 1.3 Update the `mcp_tool_invocations_total` entry in
  `packages/internal-contracts/src/observability-business-metrics.json`: set `supported_scopes` to
  exactly tenant/workspace; require `tenant_id`, `server`, `tool_name`, and bounded
  `status_class`; require `workspace_id` exactly for workspace scope; allow `oauth_client` only for
  a verified non-secret client id; and encode the fixed values plus canonical source/omission
  rules in a validator-enforced family policy. Do not retain or add platform emission.
- [ ] 1.4 Constrain `status_class` to exactly `success`, `error`, and `denied`; add deterministic
  validator and contract-test coverage that rejects an undeclared label, platform scope, an
  unknown outcome, or a drift between the manifest and runtime descriptor.
- [ ] 1.5 Add an explicit validator-enforced slice policy to the
  `component_operation_duration_seconds` entry in `observability-metrics-stack.json`, matched only
  by `subsystem="mcp"` and `operation="tool_call"`. Require the stack base labels plus `tenant_id`,
  `server`, `tool_name`, and `status_class`; make `workspace_id` conditional on workspace scope and
  `oauth_client` conditional on verified identity; constrain scope/status/fixed values and exact
  buckets. Reject those optional labels on every other slice instead of adding them to a generic
  normalized-family allowlist.
- [ ] 1.6 Tighten the contract validators so a scope identifier may be family-required or
  explicitly conditional, and so the exact counter policy and MCP histogram slice are compared to
  runtime descriptors. Prove tenant scope omits workspace, workspace scope requires it, no MCP
  tuple is platform-scoped, and no unrelated histogram slice inherits MCP labels.

## 2. Add registry tests before implementation

- [ ] 2.1 Extend the executor metrics-registry unit suite through its single pair operation with one
  valid MCP telemetry pair and assert exactly one counter increment plus exactly one histogram
  observation become visible together for the same canonical label tuple.
- [ ] 2.2 Assert exact Prometheus rendering: one `HELP` and `TYPE` per new family, fixed counter and
  histogram kinds, deterministic labels, a terminating newline, and the unchanged
  `text/plain; version=0.0.4; charset=utf-8` response contract.
- [ ] 2.3 Assert label escaping for backslash, double quote, LF, and CR/LF values and prove no
  escaping case can inject a label, sample, `HELP`, or `TYPE` line.
- [ ] 2.4 Assert the histogram buckets are cumulative at `0.005`, `0.01`, `0.025`, `0.05`, `0.1`,
  `0.25`, `0.5`, `1`, `2.5`, `5`, and `10`, followed by `+Inf == _count`, finite `_sum`, and
  exact `_count`.
- [ ] 2.5 Assert the empty registry emits no MCP sample line or fake zero for any label tuple.
  Static `HELP`/`TYPE` metadata is allowed and is not treated as a sample.
- [ ] 2.6 Assert pair atomicity and policy rejection: snapshot the combined MCP aggregate and only
  the two MCP family blocks, force failures in validation, cloning, counter calculation, and
  histogram calculation, and prove each snapshot remains byte-for-byte unchanged. Also reject an
  unknown metric/kind/label/status, platform/invalid scope, untrusted identifier, or
  non-finite/negative observation before the single commit.
- [ ] 2.7 Assert the registry exposes no separately callable MCP counter or histogram mutation and
  that one successful pair operation performs one final combined-state publication.
- [ ] 2.8 Assert all five legacy `falcone_*` sample families keep their exact names, labels,
  values, HELP/TYPE meaning, and parsing behavior before and after MCP activity.
- [ ] 2.9 Cover restart/reset using a fresh module process or isolated registry fixture: old MCP
  samples do not carry over, no zero is pre-seeded, and the first post-start invocation begins a
  fresh monotonic lifetime.

## 3. Implement the bounded executor registry sink

- [ ] 3.1 Add MCP-specific record entry points to
  `apps/control-plane-executor/src/runtime/metrics-registry.mjs` as one
  `recordMcpToolCallPair({ counter, histogram })`-style mutation; do not expose separate half
  mutations or add a request-driven generic metric-name/arbitrary-label registration API.
- [ ] 3.2 Validate the immutable pair, clone the current combined tuple entry, and calculate the
  next counter plus all histogram fields in detached state. After all fallible work, publish both
  through one final state replacement with no fallible recording step after it.
- [ ] 3.3 Reuse the metrics-stack latency bucket vector and Prometheus label escaping, reject
  unexpected/non-finite data, and preserve deterministic rendering.
- [ ] 3.4 Append the two family blocks to `renderMetrics()` without changing the existing legacy
  blocks, route, handler, listener, or content type. Emit no MCP sample for an inactive tuple and no
  other catalog family.

## 4. Instrument one canonical MCP invocation seam

- [ ] 4.1 Resolve a canonical tool from the active published server manifest before starting MCP
  invocation accounting. Do not use a missing/unknown raw tool name as a metric label or create a
  series for authentication, foreign/unknown-server, inactive-server, malformed-message, or other
  pre-attribution rejection.
- [ ] 4.2 Make `invokeTool` return `{ result, outcomeClass }`. Return `null` outcome for an unknown
  requested tool; `denied` when the caller lacks `BASE_SCOPE` or the canonical mutating tool's
  declared scope; `error` when a mutating tool declares no required scope, call-shape validation
  fails, the backend returns outside HTTP 200-299, or the backend is unavailable; and `success`
  only for HTTP 200-299. Never derive the class from caller-visible text or audit detail.
- [ ] 4.3 Add an optional metrics sink to `createMcpEngine` through its dependency-injection seam.
  Submit one descriptor pair only from shared `executeMcp(call_tool)` completion so the management
  and JSON-RPC transports cannot double count.
- [ ] 4.4 Measure finite non-negative invocation seconds and submit exactly once for each non-null
  internal outcome. Submit nothing for an unknown tool or another pre-attribution hard rejection,
  and do not permit a platform-scoped pair.
- [ ] 4.5 Contain shaping and sink exceptions around the entire telemetry path. Perform no retry,
  return the original tool/JSON-RPC result, preserve existing audit behavior, and leave no partial
  metric pair.
- [ ] 4.6 Wire the executor registry sink into the MCP engine from
  `apps/control-plane-executor/src/runtime/main.mjs`. Keep the engine functional with no sink and
  do not modify or mirror data into `apps/control-plane/metrics-registry.mjs`.

## 5. Prove engine accounting and safe attribution

- [ ] 5.1 Add engine tests with a spy sink proving one management `call_tool` success causes one
  submission containing one counter increment and one latency observation.
- [ ] 5.2 Add the equivalent JSON-RPC `tools/call` success test and prove the wrapper causes no
  second submission.
- [ ] 5.3 Cover every `invokeTool` return path: missing `BASE_SCOPE`; missing canonical mutating-tool
  scope; mutating tool with no declared scope; call-shape validation failure; backend non-success;
  unavailable backend; and backend success. Assert the exact internal `denied`/`error`/`success`
  mapping and prove neither result nor error text determines a label.
- [ ] 5.4 Cover unauthenticated, foreign/unknown-server, inactive-server, missing/unknown-tool, and
  applicable pre-boundary rate-limit failures; assert no fabricated MCP invocation pair and no
  client-chosen tool label. Assert an unknown requested tool returns a null internal outcome.
- [ ] 5.5 Inject a throwing sink and malformed telemetry descriptor; prove the successful/error
  caller-visible result is identical to the no-failure control, the sink is not retried, and
  existing metric state remains intact.
- [ ] 5.6 Assert `tenant_id` comes from credential verification, `workspace_id` and `server` from
  tenant-scoped server resolution, `tool_name` from the active manifest, and `oauth_client` only
  from a verified non-secret client identity. Omit an unverified optional client identifier rather
  than inventing a fallback label; emit tenant/workspace scope only and reject platform scope.
- [ ] 5.7 Assert the exact allowed label-key set and prove it never includes a token, secret, raw
  OAuth claim, `user_id`, `request_id`, `session_id`, email, `api_key_id`, raw path/query, raw tool
  argument, error, or result data.

## 6. Add public black-box and isolation coverage

- [ ] 6.1 Start the real executor HTTP server with an in-memory MCP fixture on ephemeral loopback
  ports. Invoke one published tool through the public management HTTP operation, then scrape public
  `/metrics` and assert exactly one counter/histogram pair plus intact legacy metrics.
- [ ] 6.2 Repeat through public JSON-RPC `tools/call`; prove one additional invocation increments
  the counter and histogram count by exactly one, with no transport duplication.
- [ ] 6.3 Exercise public known-tool error and observable tool-level denial outcomes and assert the
  `error`/`denied` series while preserving their existing HTTP/JSON-RPC response semantics.
- [ ] 6.4 Send caller/message tenant and workspace hints plus a tenant-B request for a tenant-A
  server. Prove the hints cannot affect labels, the foreign request retains its existing
  non-enumerating outcome, and no tenant-A/workspace-A sample or existence detail is emitted by
  the attempt (P13).
- [ ] 6.5 Scrape before activity and from a fresh child process to prove the empty/reset contract:
  no sample placeholder, no carried state, and new samples only after real post-start activity.
- [ ] 6.6 Keep the black-box suite hermetic: temporary/in-memory fixtures, port `0`, and loopback
  only; no fixed port, Docker, external network, repository write, shared service, or Kubernetes.

## 7. Validate exposition and contract compatibility

- [ ] 7.1 Parse populated and empty `/metrics` output with a Prometheus text parser or
  `promtool check metrics` when installed. Provide a deterministic CI fallback that verifies the
  same HELP/TYPE, escaping, sample, histogram, finite-number, and duplicate-family rules.
- [ ] 7.2 Run the focused existing registry, workspace-metric, MCP engine/observability, public
  server, and legacy metrics tests and resolve every regression.
- [ ] 7.3 Run `npm run validate:observability-business-metrics` and
  `npm run validate:observability-metrics-stack` plus their focused contract/unit suites; prove the
  counter family policy, exact MCP histogram slice, runtime descriptors, outcome enum, supported
  scopes, and bucket source remain aligned without granting MCP labels to another slice.
- [ ] 7.4 Review the runtime/static route tables and final diff to confirm `/metrics`, `/metrics/`,
  method handling, listener, content type, authentication/network trust boundary, and control-plane
  registry are unchanged and no new route or scrape target exists.
- [ ] 7.5 Assert no metric family beyond the two named MCP outputs was added and no zero, audit,
  log, HTTP, catalog, or quota proxy series was created.

## 8. Document operation, troubleshooting, and rollback

- [ ] 8.1 Update the focused operator observability reference for P1/P3/P4/P7/P9/P10/P12/P17 with
  the two family names, exact meanings, outcome classes, labels, scopes, histogram buckets, and the
  verified/canonical attribution rules.
- [ ] 8.2 Document that sample series exist only after a real canonical MCP tool invocation while
  MCP is enabled, and that static HELP/TYPE metadata is not a zero sample.
- [ ] 8.3 Add a bounded troubleshooting flow for MCP disabled, no post-start calls, wrong scrape
  target (control-plane instead of executor), recent executor restart, telemetry rejection, and
  malformed exposition; include local verification commands and no cluster command.
- [ ] 8.4 Document normal Prometheus counter-reset interpretation, the lack of persistence/backfill,
  the unchanged internal scrape trust boundary, and the additive rollback that removes only the
  two-family export wiring.
- [ ] 8.5 State explicitly that all other cataloged families remain unimplemented by this change
  until a real producer is separately wired; do not suggest treating their absence as zero.

## 9. Complete local validation and handoff

- [ ] 9.1 Run `openspec validate fix-c07-business-metric-export --strict` and resolve every error.
- [ ] 9.2 Run `git diff --check` and the repository's focused Markdown checks on the change and
  operator reference.
- [ ] 9.3 Record exact commands and pass/fail/skip totals for unit, public black-box, contract,
  Prometheus-format, observability-validator, and OpenSpec checks. A missing optional `promtool`
  must use the deterministic fallback rather than silently skip format validation.
- [ ] 9.4 Review the final diff against the isolated C07 scope: two real MCP families only, no
  product surface expansion, no UI/OpenAPI/gateway/deployment/cluster changes, and no unrelated
  finding remediation.
- [ ] 9.5 Obtain independent verifier/reviewer approval of exactly-once semantics, best-effort
  containment, canonical label sources, P13 isolation/trust-boundary preservation, empty/reset
  behavior, legacy compatibility, docs, and strict validation without accessing a cluster.

> **Cluster verification is intentionally out of scope.** Do not deploy, run Kubernetes, mutate a
> shared environment, or add deployment/chart changes for this remediation.
