# Tasks: Normalize both runtimes' JSON errors to the canonical ErrorResponse envelope

Checkboxes record the state of the implementation worktree at authoring time. The shared helper, both
runtimes' wiring, the SDK template, the console clients, the docs, the packaging, and the first unit and
black-box/contract suites are in place; the local validation is complete, and only the remaining
independent review and PR delivery stay unchecked until those steps finish.

## 1. Keep C-02 isolated

- [x] Limit the change to buffered (non-streaming) JSON error serialization in
  `apps/control-plane/server.mjs` and `apps/control-plane-executor/src/runtime/server.mjs`, the shared
  helper `apps/shared/error-envelope.mjs`, both Dockerfiles, the SDK base template, the affected console
  clients, tests, and docs.
- [x] Do not change authentication, authorization, role/permission/membership, scope enforcement,
  tenant/workspace isolation, routes, methods, status codes, or rate-limit classes; the normalization
  runs only after the existing boundary has decided the status.
- [x] Do not change any success (`2xx`) body or schema, the canonical `control-plane.openapi.json` error
  schema, streaming/SSE/JSON-RPC frames, post-header writes, or the executor proxy pass-through.
- [x] Make no cluster, chart, credential, kubeconfig, loop-state, database-migration, or evidence change.
  Do not touch C-03, C-08, or any other finding.

## 2. Inventory every in-scope error seam

- [x] Confirm both runtimes funnel every buffered error through one `sendJson` per runtime (control-plane
  `~149`, executor `~30`), covering `404 NO_ROUTE`, `401 INVALID_TOKEN`/`UNAUTHENTICATED`, the `403`
  gates (control-plane `FORBIDDEN`; executor `FORBIDDEN`/`CROSS_TENANT_VIOLATION`/`INSUFFICIENT_SCOPE`),
  the `400` `normalizeJsonBody` result, `404 WORKSPACE_NOT_FOUND`, `500 NO_HANDLER`, the `501 *_DISABLED`
  gates, and both central catches.
- [x] Confirm streaming/SSE and JSON-RPC frames plus the executor proxy pass-through remain excluded;
  route buffered JSON failures emitted before a stream opens through the shared normalizer.

## 3. Implement the shared canonical helper

- [x] Add the pure `apps/shared/error-envelope.mjs::normalizeErrorResponse(statusCode, input, context)`
  producing a schema-valid `ErrorResponse`; no I/O, no ambient state.
- [x] Derive a `code` matching `^GW_[A-Z0-9_]+$` deterministically from the response condition; carry the
  class token only, never a tenant id, scope/role/credential-scope value, dimension value, secret, or
  attacker text.
- [x] Produce a public `message` (generic for `5xx`) filtered of stack/SQL/URL/token/secret markers, with
  field-level specifics only in `detail`.
- [x] Build `detail` as public content only (`reason`, `violations`), empty for `5xx`, dropping any
  stack/exception/SQL/SQLSTATE/URL/header/token/credential/secret.
- [x] Validate `requestId`/`correlationId` against the id shape and otherwise generate with
  `randomUUID()`; echo `correlationId` in the body; emit an RFC3339 `timestamp`.
- [x] Derive `resource.path` from the request pathname with query/fragment data and controls excluded,
  cap it, and redact recognized identifier forms without inferring any server-side identifier.
- [x] Reduce every remaining `4xx` message that still embeds a specific authorization scope/role or a
  probed identifier (for example `requires <scope>`, `workspace <id> not found`) to a class-appropriate
  public string so no scope/role/probed-id value survives (the P13 guarantee).

## 4. Wire both runtimes at the `sendJson` seam

- [x] Import and apply `normalizeErrorResponse` inside each runtime's `sendJson` for `statusCode >= 400`,
  leaving `< 400` serialization unchanged.
- [x] Set `res._errorContext = { requestId, correlationId, resource: pathname }` early per request so the
  context is available regardless of which seam emits the error.
- [x] Ensure the executor's top-level `errors`/`dimension` no longer appear at the top level of the closed
  envelope (folded into `detail` or dropped) and normalization runs exactly once per response.

## 5. Align the SDK/OpenAPI template

- [x] Rewrite the base-template `ErrorResponse` to `additionalProperties: false` with the eight required
  fields, the `GW_` `code` pattern, and the id bounds, and add `ErrorDetail`/`ErrorResource`.
- [x] Do not edit the canonical `control-plane.openapi.json` error schema; treat it as the conformance
  oracle.
- [x] Run `npm run validate:openapi` and `npm run validate:public-api` and confirm no unexpected drift.

## 6. Align the web console

- [x] Update the error-consuming config/backup clients that inspected the legacy body to read the
  canonical envelope; align the shared reader `http.ts` while retaining rolling-rollback compatibility.
- [x] Keep `describeConsoleError` (status-based) and the `409` auth status-view funnel working; verify
  page-level `code` branches still resolve their class under the `GW_` prefix.
- [x] Add focused Vitest coverage for the canonical envelope, the `GW_` class resolution, and the legacy
  `{ code, message }` fallback.

## 7. Add public-interface regression coverage

- [x] Unit-test the helper (`tests/unit/error-envelope.test.mjs`): `GW_` code, `5xx` generic message and
  empty detail, secret/SQL/URL sanitization, id validation/regeneration, `violations`, safe resource.
- [x] Black-box the real executor server (`tests/blackbox/error-envelope-http-contract.test.mjs`): `404`
  and `401` envelope shape, id regeneration, and unchanged `200` success.
- [x] Ajv contract test (`tests/contracts/error-envelope.contract.test.mjs`): canonical
  `ErrorResponse`/`ErrorDetail`/`ErrorResource` conformance; reject the legacy shape.
- [x] Extend coverage across both runtimes for `400`/`403` (control-plane and executor), the P13 no-leak
  properties (no scope/role/denial subtype, recognized identifier redaction, and equal resource values
  for the same path), P10 read-only, correlation propagation, audit/metrics continuity, and parity.

## 8. Package and document

- [x] `COPY apps/shared/error-envelope.mjs` into both images (`apps/control-plane/Dockerfile`,
  `apps/control-plane-executor/Dockerfile`); guard with `tests/unit/error-envelope-packaging.test.mjs`.
- [x] Document the envelope, the `GW_` code, the sanitization and id/correlation/timestamp rules, the safe
  resource, and the console compatibility/migration in
  `docs/reference/architecture/public-api-surface.md`.

## 9. Validate locally without deployment

- [x] Run `openspec validate fix-c02-error-response-envelope --strict` and record the result.
- [x] Run the C-02 unit, black-box, contract, packaging, and console suites.
- [x] Run `npm run validate:openapi`, `npm run validate:public-api`, markdownlint, and `git diff --check`.
- [x] Record the repository-wide web-console typecheck baseline if pre-existing unrelated errors remain;
  no C-02-modified file may appear in its diagnostics.

## 10. Independent checks and delivery

- [x] Obtain independent contract, authorization, persona/journey, accessibility, verifier, docs, and
  final-review verdicts without accessing or deploying to the cluster; confirm the P13 no-leak guarantee
  on both runtimes.
- [x] Force-add and validate this ignored OpenSpec directory, staging no runtime evidence, loop-state,
  credentials, kubeconfigs, or Playwright results.
- [ ] Commit and push `fix/audit-c02-error-response-envelope` and open a draft PR; do not merge.
