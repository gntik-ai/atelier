# Tasks: enforce public request trace headers

This change remediates only confirmed finding C-03. It is repository-only: no cluster, credential,
kubeconfig, evidence, loop-state, datastore, or sibling-chart mutation is authorized.

## 1. Reproduce and pin the boundary

- [x] Reproduce the defect against the real hermetic control-plane listener before editing: missing and
  valid trace headers are accepted and no response correlation is returned.
- [x] Add black-box regressions for authentication precedence, required/current API version, optional and
  validated correlation, response/body continuity, CORS advertisement, health exemptions, and absence of domain work
  on header rejection.
- [x] Add unit and contract regressions for both runtimes, proxy forwarding, SSE handshakes, generated
  contracts, gateway policy, and first-party clients.

## 2. Align the canonical contract and gateway policy

- [x] Keep `X-API-Version` required and pinned to `2026-03-26`; make inbound
  `X-Correlation-Id` optional/generated, declare its response header, and register the three canonical
  `GW_` error codes in the taxonomy.
- [x] Regenerate the OpenAPI family documents, route catalog, and public API reference; align the SDK
  template and validators so subsequent generation cannot silently revert the semantics.
- [x] Mark API version required and correlation optional/generated/returned in the base gateway policy;
  document both trace headers on every in-repo APISIX `/v1` route, disable its short-circuiting CORS
  plugin, serve/expose the complete public CORS header set from the route-aware runtimes, and route
  API-key-family `OPTIONS` to the executor without requiring an `apikey` value. Admit registered
  realtime/flow SSE preflights and finalize a safe correlation on APISIX-owned rate-limit responses.
  Keep preflight itself exempt from the correlation-return guarantee.
  Keep runtime enforcement authoritative so authentication precedence and C-02 JSON errors are preserved.

## 3. Enforce the contract in both runtimes

- [x] Reuse the shared C-02 boundary module to resolve a safe correlation before any response and validate
  trace headers after authentication but before authorization and domain work on matched public routes.
- [x] Return the resolved correlation on JSON success/error responses, executor proxy responses, and SSE
  handshakes; forward one stable value through the executor proxy without changing response bodies or
  stream frames.
- [x] Preserve unmatched-route, authentication, authorization, tenant/workspace isolation, and infra/CORS
  exemptions; replace the stale internal `2026-03-25` caller fallback with `2026-03-26`.

## 4. Keep first-party clients compatible

- [x] Continue sending both trace headers from the shared console HTTP client and expose returned response
  metadata to the session layer.
- [x] Route every first-party raw `/v1` caller, including Kafka SSE, downloads, custom config/backup
  clients, capability catalog, SDK fetches, and secret rotation, through `publicApiFetch`; add a contract
  inventory that fails when a new direct public fetch bypasses the canonical headers.
- [x] Replace the two browser-native `EventSource` callers with a tested `fetch`/`ReadableStream` adapter
  that can send headers and preserves named events, fragmented/CRLF frames, `Last-Event-ID` reconnect,
  terminal events, and abort-based close behavior.
- [x] Align SDK-generated operations with the required request parameters and response correlation header.

## 5. Document and verify without deployment

- [x] Document required version, optional/generated correlation, error codes, ordering, CORS visibility,
  SSE transport, safe diagnostic use, exemptions, and the fact that no live rollout was performed.
- [x] Run the focused red/green regressions, complete unit/contract/black-box/frontend suites, SDK tests,
  public API/gateway/observability validators, OpenSpec strict validation, and `git diff --check`.
- [x] Record the existing frontend typecheck baseline separately and confirm it names no C-03-modified
  file; do not hide or broaden unrelated cleanup into this finding.
- [x] Obtain independent journey, contract, authorization, documentation, verifier, and final reviewer
  verdicts; then commit only the scoped code/spec/tests/docs and open a draft PR against
  `codex-integration` without merging.
