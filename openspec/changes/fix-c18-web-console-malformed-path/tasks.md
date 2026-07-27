## 1. Preserve the bounded OpenSpec contract

- [x] 1.1 Keep the proposal and `web-console` delta aligned with C-18 / DEVOPS-01: exact `400`
  containment for malformed static pathnames, same-process recovery, valid static/SPA
  compatibility, raw `/v1` precedence, non-disclosure, and unchanged identity, isolation, data,
  quota, observability, and packaging boundaries.
  - Paths: `openspec/changes/fix-c18-web-console-malformed-path/proposal.md`,
    `openspec/changes/fix-c18-web-console-malformed-path/specs/web-console/spec.md`.
  - Result: the proposal and delta were retained unchanged and strict validation passed after
    implementation.
- [x] 1.2 Keep implementation work limited to the shared static runtime, deterministic
  process-boundary tests, and the focused static asset delivery reference; do not add a
  `design.md` unless OpenSpec validation proves it is required.
  - Result: implementation is limited to the named runtime, test, reference, and this task ledger;
    no `design.md` or out-of-scope product/deployment file was added.

## 2. Contain malformed paths in the shared server runtime

- [x] 2.1 In the shared request handler, retain exact `/healthz` and raw `/v1` or `/v1/*`
  classification before any static-path validation, decoding, normalization, file read, or SPA
  fallback.
  - Path: `apps/web-console/static-server.mjs`.
  - Result: both existing branches remain before pathname extraction and decoding.
- [x] 2.2 Isolate the static pathname from its query, detect invalid or incomplete percent escapes
  and invalid encoded URI byte sequences, and complete those requests with exact status `400`
  before filesystem or SPA-fallback work.
  - The response must be fixed, non-reflective, and non-sensitive.
  - It must not expose the raw/decoded target, filesystem paths, file or SPA bodies, stacks,
    exception text, environment, credentials, or tenant/workspace data.
  - Result: static decoding now runs in a request-local `try`/`catch` and returns fixed
    `text/plain; charset=utf-8` body `Bad Request` with status `400`.
- [x] 2.3 Make malformed-path handling request-local so sequential bad requests cannot produce an
  uncaught exception/rejection, reset, `5xx`, hang, process exit, listener shutdown, or restart.
  - Result: three sequential malformed requests completed with `400`; the original PID emitted no
    stderr and remained available for all recovery requests.
- [x] 2.4 Preserve valid percent-encoded path handling, valid assets, `/`, `/index.html`, SPA
  fallback, query behavior, MIME types, compression, cache controls, and security headers without
  broad path-traversal or distribution-error refactoring.
  - Result: existing static/header cases still pass, with added valid `%20` asset and malformed
    query-only asset/SPA coverage.
- [x] 2.5 Preserve the current raw `/v1` proxy contract, including `/v1/%ZZ`, full
  method/path+query/header/body forwarding, upstream status/header/body relay, and
  `GATEWAY_UNREACHABLE` `502` behavior.
  - Result: the local gateway test preserves exact `/v1`, raw `/v1/%ZZ?query=%&mode=raw`, POST
    headers/body, and upstream `207` headers/body; the focused unreachable test retains
    `502 GATEWAY_UNREACHABLE`.
- [x] 2.6 Confirm both existing Dockerfiles still copy and execute
  `apps/web-console/static-server.mjs` as the single shared Node runtime; do not introduce an
  alternate server or divergent image-specific handler.
  - Paths: `apps/web-console/Dockerfile`, `deploy/kind/web-console/Dockerfile`.
  - Result: both Node 22 Dockerfiles still copy the shared entrypoint and use
    `CMD ["node", "static-server.mjs"]`; neither Dockerfile was edited.

## 3. Add deterministic process-boundary regression tests

- [x] 3.1 Extend the existing unit test to spawn the real shared server in a child process with a
  temporary static root and `PORT=0`, and send raw malformed static requests for `/%ZZ`, `/%`, and
  invalid encoded UTF-8.
  - Path: `tests/unit/web-console-static-server.test.mjs`.
  - Result: the child-process case sends `/%ZZ`, `/%`, and `/%C3%28` through the real entrypoint.
- [x] 3.2 Assert each malformed request completes with exact `400`, never returns a static file or
  SPA shell, exposes no request/internal/sensitive detail, and causes no reset, `5xx`, or hang.
  - Result: each response completes within the request timeout with exact status/body/length and
    assertions against target, root, static, runtime, credential, and tenant detail disclosure.
- [x] 3.3 Send at least two malformed requests sequentially, retain the original child PID, and
  prove that same PID then serves `/healthz` as `200` with `ok`, `/`, a valid asset, a valid SPA
  route, and a representative `/v1` proxy request.
  - Result: after all three malformed requests, the original live PID serves health, root, asset,
    SPA fallback, exact `/v1`, and `/v1/%ZZ` proxy requests.
- [x] 3.4 Cover valid percent-encoded asset behavior and malformed percent syntax confined to a
  query, while retaining the existing root/index, asset, SPA, compression, cache, and security
  header assertions.
  - Result: `%20` asset delivery retains gzip, immutable caching, and security headers; invalid
    percent syntax in asset and SPA query strings does not reject their valid pathnames.
- [x] 3.5 Use an ephemeral-port local mock gateway to prove request method, raw path and query,
  headers, and body plus upstream status, headers, and body are preserved, including
  `/v1/%ZZ`; retain focused coverage for the current unreachable-gateway `502` contract.
  - Result: request and response semantics are asserted against a local ephemeral gateway, and a
    closed ephemeral port proves the existing `502` JSON code while the child remains healthy.
- [x] 3.6 Keep the regression hermetic: no fixed ports, Docker, external network, repository
  writes, or Kubernetes.
  - Result: fixtures use a temporary root plus console/gateway port `0`; only loopback networking
    is used and temporary fixtures are removed by test cleanup.

## 4. Update the focused runtime reference

- [x] 4.1 Update the static asset delivery reference to state that malformed static pathnames
  return `400`, never enter static-file or SPA fallback delivery, do not terminate the shared
  process, and do not alter raw `/v1` precedence.
  - Path: `docs/reference/architecture/web-console-static-asset-delivery.md`.
  - Result: the reference now describes route precedence, fixed non-disclosing `400`, same-process
    containment, valid encoding/query behavior, and both Dockerfiles' shared entrypoint.
- [x] 4.2 Document
  `node --test tests/unit/web-console-static-server.test.mjs` as the deterministic local
  verification command and keep the existing Node 22 runtime scope.
  - Result: the command, hermetic fixture boundaries, Node 22 image scope, and newer-local-Node
    non-expansion note are documented.

## 5. Validate the bounded change

- [x] 5.1 Run `node --test tests/unit/web-console-static-server.test.mjs` and record the focused
  child-process result.
  - Result: PASS on local Node `v26.0.0`: 6 tests passed, 0 failed/skipped/cancelled/todo; both
    `node --check` commands also passed. The shipped runtime remains the Dockerfile-pinned Node 22.
- [x] 5.2 Run `openspec validate fix-c18-web-console-malformed-path --strict` and resolve every
  validation error.
  - Result: PASS — `Change 'fix-c18-web-console-malformed-path' is valid`.
- [x] 5.3 Review the final diff and confirm it contains only this OpenSpec change, the shared
  static-server runtime fix, its focused process tests, and the static asset delivery reference;
  confirm public API, gateway/backend, persistence, authorization, quota, audit/metrics, rendered
  UI, and cluster configuration remain unchanged.
  - Result: `git diff --check` passed; the tracked diff against `origin/codex-integration` contains
    only the runtime, focused test, and existing reference. The three ignored OpenSpec files are
    the only added change artifacts. Public contracts, gateway/backend, persistence, auth, quota,
    audit/metrics, React UI, Dockerfiles, and cluster configuration are unchanged.
    `markdownlint-cli2` `0.22.0` passed with zero errors for the focused documentation and OpenSpec
    files (and the repository paths selected by the existing lint configuration).

> **Live/cluster verification: NOT RUN BY REQUEST.** Do not run Docker, deploy the console, access
> Kubernetes, mutate the test environment, or use an external network for this remediation.

## 6. Independent verification and review

- [x] 6.1 Give an independent verifier the change artifacts, implementation diff, and reproduction
  cases; require it to rerun the focused process suite and independently confirm exact `400`,
  same-PID recovery, valid static/SPA behavior, raw `/v1` compatibility, non-disclosure, and shared
  runtime packaging without live or cluster access.
  - Result: PASS — the verifier first reproduced the base crash, then found the historical crash
    `NOT_CONFIRMED` on the fix in two fresh child processes. The exact fixed `400`, same-PID
    recovery, non-disclosure, valid encoding/query controls, raw `/v1/%ZZ` fidelity, existing
    `502 GATEWAY_UNREACHABLE`, shared Dockerfile entrypoint, and focused 6/6 suite all passed.
- [x] 6.2 Give a different independent reviewer the requirements, diff, and verifier evidence;
  require approval of scope, runtime correctness, security/isolation boundary preservation,
  deterministic tests, focused documentation, and strict OpenSpec validation before handoff.
  - Result: `APPROVE`, with no blocking findings. The reviewer independently reproduced the base
    crash, reran the 6/6 fixed suite, confirmed the bounded root-cause fix and complete applicable
    chain, and accepted live/container/cluster execution as an explicit residual risk under the
    user's no-deployment constraint.
