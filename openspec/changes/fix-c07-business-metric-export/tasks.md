# Tasks

## Tests first (black-box / unit)

- [ ] Add a failing unit test on the executor registry asserting `renderMetrics()` emits `in_falcone_mcp_tool_invocations_total` (counter, with `# HELP`/`# TYPE`) and the `subsystem="mcp"` slice of `in_falcone_component_operation_duration_seconds` (histogram with cumulative `_bucket`/`le="+Inf"`/`_sum`/`_count`) only after a recorded invocation.
- [ ] Add a failing engine test asserting a completed `call_tool` (and the JSON-RPC `tools/call` path) records exactly one counter increment and one latency observation, for both success and tool-error outcomes.
- [ ] Add a test proving telemetry export is fail-safe: a forced recording error (e.g. label-policy violation) does not fail the tool result or corrupt other series.
- [ ] Add a test proving attribution (`tenant_id`/`workspace_id`/`metric_scope`) is taken from the verified identity/resolved server and never from a spoofed JSON-RPC message hint (P13), and that no forbidden/PII label appears.
- [ ] Add a test proving legacy `falcone_*` families are unchanged and no zero/synthetic series is emitted for inactive label sets or other catalog families.
- [ ] Add coverage for restart/reset semantics (fresh baseline; no fabricated carry-over) via an isolated registry instance.

## Backend

- [ ] Add bounded record entry points to `apps/control-plane-executor/src/runtime/metrics-registry.mjs` for the MCP counter and the component-latency histogram, aggregating in-process by the bounded label tuple and reusing `LE`, `escPrometheusLabel`, and `# HELP`/`# TYPE` emission.
- [ ] Extend `renderMetrics()` to append the two families after the existing HTTP/process families, as valid Prometheus text, without altering the legacy blocks.
- [ ] Inject an optional, bounded metrics sink into `createMcpEngine({ ... })` (alongside `store`/`clock`/`fetchImpl`) and forward `telemetry.metric` and `telemetry.latency` exactly once per completed invocation at `mcp-engine.mjs:364`, wrapped so recording errors are contained.
- [ ] Wire the sink from the runtime composition (`apps/control-plane-executor/src/runtime/main.mjs`) into the engine so live invocations feed the registry that backs `/metrics`.

## Wire / contract

- [ ] Verify the emitted label sets reconcile with `packages/internal-contracts/src/observability-business-metrics.json` and `observability-metrics-stack.json` (required labels present; additional dimensions bounded and non-PII; histogram buckets equal `latency_histogram_buckets_seconds`).
- [ ] Confirm the export reuses the existing unauthenticated `/metrics` endpoint and `METRICS_CONTENT_TYPE`; no new endpoint/listener/route/auth.

## Frontend

- [ ] None — no UI change (the console does not consume the Prometheus scrape surface).

## Docs

- [ ] Update operator observability documentation (P17): describe the two families, labels/scopes, that they are produced only by real MCP tool invocations (`MCP_ENABLED`), how to verify/troubleshoot absence, and the additive rollback.

## Verify

- [ ] Run the black-box/contract/unit slice touched by this change and the new tests; ensure the legacy metrics tests still pass.
- [ ] Run `openspec validate fix-c07-business-metric-export --strict` and fix any issue.
- [ ] Hand to the independent critic/reviewer; do not deploy to a cluster.
