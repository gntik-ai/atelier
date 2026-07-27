## Why

C-18 / DEVOPS-01 confirmed that an unauthenticated malformed static request such as `/%ZZ`
reaches `decodeURIComponent` outside the web-console server's filesystem and SPA-fallback error
boundary. The resulting `URIError` terminates the single Node process, so one request-local client
error removes the console, same-origin API edge, and `/healthz` listener until the runtime is
restarted.

Both the release and kind compatibility images copy and run
`apps/web-console/static-server.mjs` as their single Node command. Platform operators (P3) and
release engineers (P18) therefore need malformed static paths to be contained in that shared
runtime without changing valid static delivery, SPA routing, health checks, or `/v1` proxy
semantics.

## What Changes

- Keep exact `/healthz` and raw `/v1` or `/v1/*` classification ahead of static-path decoding.
- Validate only the static pathname component for invalid or incomplete percent escapes and
  invalid encoded URI byte sequences, returning a complete HTTP `400` response before any file
  read or SPA fallback.
- Use a fixed, non-reflective, non-sensitive malformed-path response and contain all such failures
  within the request so repeated malformed requests cannot terminate the process or listener.
- Preserve valid percent-encoded static paths, valid assets, `/`, `/index.html`, SPA fallbacks,
  query handling, compression, cache and security headers, `/healthz`, and the complete existing
  `/v1` request/response proxy behavior.
- Add deterministic child-process regression coverage with a temporary static root, ephemeral
  ports, and a local mock gateway, including same-PID recovery after sequential malformed
  requests.
- Update the existing web-console static asset delivery reference with the malformed-path
  behavior and focused verification command.
- Keep both existing Dockerfiles on the same shared Node entrypoint; no divergent runtime is
  introduced.

## Non-Goals

- No cluster deployment or change to probes, replicas, PodDisruptionBudgets, autoscaling, or other
  Kubernetes configuration.
- No gateway, public OpenAPI, SDK, generated contract, backend, persistence, or data-model change.
- No authentication, authorization, role, tenant/workspace context, or static-asset isolation
  change. Static assets remain non-tenant-scoped, and raw `/v1` requests remain the upstream
  gateway's responsibility.
- No quota, audit-event, metric, or broader observability contract change; the existing
  `/healthz` behavior is preserved.
- No broad URL/path-traversal hardening, missing or corrupt distribution handling, dependency or
  base-image change, alternate server, or unrelated runtime refactor.
- No rendered React UI, client-side behavior, visual design, or accessibility change.
  Rendered-UI persona P16 is therefore not applicable; P13 applies only as a
  shared-availability, leakage, and proxy-boundary lens, and P11 is the external HTTP consumer.
- No Docker execution, external-network dependency, repository-writing test fixture, or
  Kubernetes access in the deterministic regression test.

## Exit Criteria

- Static pathnames `/%ZZ`, `/%`, and a path containing invalid encoded UTF-8 each receive a
  complete `400` with no file or SPA body, reflection, sensitive details, reset, `5xx`, or hang.
- After two sequential malformed requests, the same child PID remains alive and serves `/healthz`
  as `200` with `ok`, `/`, a valid asset, a valid SPA route, and a representative `/v1` proxy
  round trip.
- Malformed syntax only in a query does not trigger static-path rejection; valid percent-encoded
  paths and existing static, fallback, compression, cache, and security-header behavior remain
  covered.
- Exact `/v1` and `/v1/*`, including `/v1/%ZZ`, remain raw proxy routes with method, raw path and
  query, headers, body, upstream status, headers, and body preserved, along with the current
  `GATEWAY_UNREACHABLE` `502` behavior.
- `node --test tests/unit/web-console-static-server.test.mjs` passes using only temporary local
  resources and ephemeral ports.
- `docs/reference/architecture/web-console-static-asset-delivery.md` documents the bounded
  malformed-path contract and focused verification command.
- `openspec validate fix-c18-web-console-malformed-path --strict` passes.
- Live and cluster verification are recorded as not run by request.

## Risks and Rollback

The primary compatibility risk is rejecting a valid encoded static pathname or decoding a raw
`/v1` target before proxying it. Focused process-boundary cases pin both sides of that boundary,
including query-only malformed syntax, valid encoding, `/v1/%ZZ`, and complete proxy
request/response preservation. The shipped runtime remains Node 22; reproduction under Node 26
does not widen the supported runtime scope.

Rollback is a straight revert of the shared static-server containment change, its focused unit
tests, this OpenSpec change, and the static asset delivery reference. The Dockerfiles, public API,
backend, data, authorization, quotas, audit/metrics, and cluster configuration require no rollback
because they are unchanged.
