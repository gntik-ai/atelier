## Design

### Seam

The change is confined to the executor MCP path plus its metrics registry. `mcp-engine.mjs` already computes `telemetry = mcpToolCallTelemetry({ tenantId, workspaceId, serverId, toolName, oauthClientId, latencyMs, status })` on each completed `call_tool` (`mcp-engine.mjs:364`). Both entry points converge here: the management API `executeMcp({ operation: 'call_tool' })` and the JSON-RPC `tools/call` handler, which itself calls `executeMcp({ operation: 'call_tool' })` (`mcp-engine.mjs:~433`). A single sink at this point therefore covers both surfaces with no duplication.

Inject an optional, bounded **metrics sink** into `createMcpEngine({ ... })` alongside the existing `store` / `clock` / `fetchImpl` dependency-injection seam. On each completed invocation the engine forwards `telemetry.metric` (the `in_falcone_mcp_tool_invocations_total` counter, value 1) and `telemetry.latency` (the `in_falcone_component_operation_duration_seconds` histogram observation) to the sink **exactly once**, immediately after `invokeTool` resolves — for both success and tool-error outcomes. The sink is a thin entry point (e.g. `recordMcpToolInvocation` / `observeComponentOperation`) added to `runtime/metrics-registry.mjs`, aggregating in-process by the bounded label tuple. `renderMetrics()` gains one counter block and one histogram block appended after the existing families, reusing `LE` (identical to the contract `latency_histogram_buckets_seconds`), `escPrometheusLabel`, and `# HELP`/`# TYPE` emission.

### Attribution and cardinality

Tenant/workspace/scope are pinned from the credential-verified identity and the resolved server — `tid = identity.tenantId`, `entry.workspaceId`, `oauth_client = identity.actorId` — never from the JSON-RPC message body. A P13 tenant-B caller can only be resolved to its own server via `requireServer` (cross-tenant id → 404), so it can never attribute activity to tenant A. Labels stay within the business-metrics (`observability-business-metrics.json`) and metrics-stack (`observability-metrics-stack.json`) contracts and the forbidden-label policy already enforced by `assertNoForbiddenLabels` (no `user_id`, `request_id`, `email`, `api_key_id`, `object_key`, `raw_path`, raw arguments). `server`, `tool_name`, `oauth_client`, and `status_class` remain bounded identifiers. The emitted label set must reconcile with the contracts; where the telemetry module already adds bounded attribution dimensions beyond a family's `allowed_optional_labels`, the fixer verifies they remain bounded and non-PII (or narrows them) rather than introducing new unbounded ones.

### Fail-safe and lifecycle

The current `mcpToolCallTelemetry(...)` call can throw via the forbidden-label guard; recording must be wrapped so any sink/registry error is swallowed (best-effort, optionally logged) and the tool result / JSON-RPC response is returned unchanged. Series are in-process and additive: a series appears only after ≥1 real invocation for its label set — no pre-seeded, zero-fabricated, or synthetic series — and resets to a fresh baseline on process restart, which downstream consumers already handle as a counter reset via `rate()`. The five legacy `falcone_*` families keep their exact names, labels, semantics, ordering independence, and `METRICS_CONTENT_TYPE`.

### Persona lens

P1/P3/P4/P7/P9/P10 read MCP tool usage and latency on the same plane as HTTP/process signals; P12 (the MCP OAuth client / AI agent) produces attributable, credential-bound activity with no secret exposure; P13 gains no cross-tenant series or existence disclosure; P17 receives operator documentation, absence-troubleshooting, and an additive rollback.

### Alternatives and rollback

Alternatives considered and rejected for this scope: (a) exporting the full business-metrics catalog — rejected, no real producers wired and would require synthetic series (a separate effort); (b) a new dedicated MCP metrics endpoint — rejected, the contracted surface is the existing `/metrics`; (c) pushing metrics to an external collector — rejected, out of the zero-dependency in-process model. Rollback is fully additive: remove the sink wiring and the two `renderMetrics()` blocks; the legacy exposition and all other behavior are untouched.

### Out of scope

Other business/component families, collection-health/lag, UI, OpenAPI/clients, gateway/APISIX, new endpoint/listener, authentication, and any cluster/Helm change. The REST `/v1/metrics/*` API (C04) and the APISIX scrape route (C06) are separate changes.
