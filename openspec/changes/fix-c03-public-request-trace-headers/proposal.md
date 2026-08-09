# Change: enforce the public request/response trace-header contract

## Why

Confirmed finding C-03 shows that Falcone publishes a required API-version header and an end-to-end
correlation contract without enforcing or returning them. The newest audit evidence captured authenticated
requests to a real `/v1` route succeeding without either header; a valid caller correlation was not
returned. A clean, pre-edit hermetic reproduction against `createControlPlaneHttpServer` produced the
same result twice: `200` without headers and no `X-Correlation-Id`, and `200` with valid headers but no
returned correlation.

The defect spans contract, ingress declaration, both public runtimes, proxy/stream paths, SDK/client
behavior, and documentation. Fixing only the visible console would leave direct and machine clients on a
false public contract.

## What changes

- Require exactly `X-API-Version: 2026-03-26` on matched, non-exempt public `/v1` requests after
  authentication and before authorization/domain work. Missing and unsupported values return canonical
  C-02 `400` errors `GW_API_VERSION_REQUIRED` and `GW_UNSUPPORTED_API_VERSION`.
- Make external `X-Correlation-Id` optional. Generate it when absent, preserve one valid value, reject
  malformed or comma-combined input as `GW_INVALID_CORRELATION_ID`, and never reflect hostile input.
- Return the resolved correlation on JSON success/error responses, executor proxy responses, and SSE
  handshakes. C-02 error bodies carry the identical value.
- Align the canonical OpenAPI/taxonomy, generated family contracts and route catalog, base gateway policy,
  in-repo APISIX/runtime CORS boundary, validators, SDK assembly, both runtimes, the stale internal caller fallback, the
  console JSON/SSE clients, tests, and documentation.
- Preserve authentication precedence, unmatched-route behavior, existing authorization and isolation for
  valid requests, success bodies, stream frames, audit/metric shape, and infra/CORS exemptions.
- Perform repository-only validation. Do not edit the sibling production chart or deploy to a cluster.

## Personas and observable outcomes

- P3/P9 operators can retain the returned correlation and join a client outcome to existing logs/audit
  without exposing credentials or tenant data.
- P11 read-only callers see the same header contract without gaining mutation or scope.
- P12 machine/adversarial callers can construct a compliant request and branch on three deterministic
  errors; malformed trace input creates no identity, authorization, tenant, or existence capability.

## Scope

In scope are the shared C-02 boundary helper, control-plane and executor listeners, executor proxy/SSE,
canonical/generated public contracts, gateway declaration and in-repo CORS render, first-party HTTP/SSE
clients, SDK assembly, validators, regression tests, docs, and this OpenSpec change.

Out of scope are roles/permissions, route and method registration, success schemas, domain behavior,
datastores/migrations, tracing backends, new audit/metric surfaces, external charts, cluster rollout, live
validation, and every finding other than C-03.

## Acceptance

- Clean pre-edit regression tests fail for the reproduced behavior and pass after the implementation.
- Missing/current/unsupported version and absent/valid/invalid correlation are covered at the public HTTP
  boundary; header rejection performs no domain work and authentication remains `401` first.
- Response correlation is continuous through JSON errors, success, proxy, and SSE handshakes; CORS exposes
  that header to browser callers on non-preflight public responses.
- OpenAPI/taxonomy/gateway/catalog/SDK/clients agree and generation plus relevant validators pass.
- Unit, contract, relevant black-box, frontend, and focused SDK tests pass; unrelated baseline failures are
  reported rather than hidden.
- OpenSpec strict validation and `git diff --check` pass; independent maker/checker review completes.
- The commit contains no loop-state, evidence, credentials, kubeconfigs, Playwright output, runtime agent
  assets, or deployment result, and the PR is draft against `codex-integration`.

## Risks

- Enforcing the published version can reject permissive external clients during a future deployment;
  client coordination and an ordered rollout remain necessary.
- The external production chart is outside this repository and can drift until separately updated.
- The fetch-based SSE transport must preserve reconnect/cancel semantics; focused parser and service tests
  constrain that change.

Rollback is a single code/config/contract revert and requires no data migration.
