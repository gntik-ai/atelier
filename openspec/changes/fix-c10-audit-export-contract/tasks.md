## 1. Write failing public-handler and isolation tests

- [x] 1.1 Add public black-box export tests for both the tenant and workspace routes proving a valid `format` (`jsonl`/`csv`) with `pageSize` 1, 201, 500, and 10000 succeeds and exports at most the requested number of records within `ctx.resolvedScope`.
- [x] 1.2 Add public-handler tests proving an omitted `pageSize` normalizes to 500 and that a request body naming another tenant or workspace cannot widen, override, or cross the resolved scope.
- [x] 1.3 Add public-handler tests proving a missing or invalid `format` and an invalid `pageSize` (0, 10001, fractional, non-numeric/string, empty) return HTTP `400` before the datastore spy is called and never produce a successful fallback export.
- [x] 1.4 Add public-handler parity tests proving the principal and fallback paths receive one normalized request, scope, export limit, and masking profile, and that a contractual error is rejected whether or not the principal builder resolves.
- [x] 1.5 Add public-handler authorization, denial-ordering, masking, and side-effect controls proving P1/P4/P10 succeed within scope, a constrained persona without export permission is denied, P13 is denied before body/format validation on a foreign path, no successful export leaks a secret, and a successful export invokes no writer, quota, event, or persistence.

## 2. Write failing store export-mode tests

- [x] 2.1 Add store tests proving the export read mode returns up to 10000 rows within the authorized scope and does not truncate to 200.
- [x] 2.2 Add store tests proving the audit-records list query path keeps its page-size maximum of 200 unchanged by the export mode.
- [x] 2.3 Add store tests proving the export mode retains the mandatory tenant predicate and the exact-workspace predicate for a workspace export and executes no unscoped SELECT without a resolved tenant.

## 3. Write failing contract and console tests

- [x] 3.1 Add or extend contract tests binding the internal export-surface contract and both OpenAPI operations to the runtime for the required `format` enum, `pageSize` default 500 and range 1..10000, and the `AuditExportManifest`/`AuditExportedRecord` shapes.
- [x] 3.2 Add response-conformance tests proving a successful manifest from both the principal and the fallback path keeps the C-01 required fields and item projection; prove malformed input uses the existing coded handler 4xx response before SQL without asserting global `ErrorResponse` conformance, which remains C-02.
- [x] 3.3 Add a console client test proving the export request serializes an explicit `format=jsonl`, `pageSize=500`, and the default masking profile alongside the existing filter controls.

## 4. Implement strict export request normalization

- [x] 4.1 Normalize the export request from the contractual source after `guarded()` authorization and before any datastore or adapter call: require an explicit `format` of `jsonl` or `csv`, default an omitted `pageSize` to 500, and require an integer `pageSize` from 1 through 10000.
- [x] 4.1a Validate canonical sort (`eventTimestamp`/`-eventTimestamp`) and every public filter, allowing a single valid timestamp bound, before SQL; propagate the handler's bounded 4xx envelope (global ErrorResponse alignment is C-02).
- [x] 4.2 Reject a missing or invalid `format` and an invalid `pageSize` with a stable coded HTTP `400` before SQL; remove the silent default-to-200, clamp-to-200, and swallow-to-fallback behavior.
- [x] 4.3 Bind scope only to `ctx.resolvedScope` for the store and builder and treat every request-body scope field as inert.

## 5. Implement the store export mode and shared execution paths

- [x] 5.1 Add an export read mode/cap to `queryAuditEvents` bounded at 10000 that retains mandatory tenant and exact-workspace predicates, without altering the audit-records list query or its 200 maximum.
- [x] 5.2 Pass the one normalized request, resolved scope, export limit, and masking profile to both the principal builder and the inline fallback, keeping the fallback no less conservative than the principal.
- [x] 5.3 Separate contractual validation failures from operational datastore failures so neither is converted into a successful empty export, preserving the C-01 manifest and projection on both paths.

## 6. Align the console client and keep contracts covered

- [x] 6.1 Update the console export client to serialize explicit format `jsonl`, pageSize 500, and maskingProfileId `default_masked` with its existing controls.
- [x] 6.2 Keep the internal export-surface contract and both OpenAPI operations canonical and covered by conformance tests so neither route declares a field the runtime ignores nor enforces a bound the contract does not declare.
- [x] 6.2a Ensure family and aggregate OpenAPI declarations state pageSize default 500.

## 7. Run focused validation and independent checks

- [x] 7.1 Run the focused public export-handler, store export-mode, contract-conformance, and console client tests; fix regressions only within the C-10 audit-export scope.
- [x] 7.2 Run a focused authorization/isolation/read-only checker over P1, P4, P10, P12, and P13 scenarios, including foreign-body and denial-ordering controls and datastore-spy assertions.
- [x] 7.3 Run `openspec validate fix-c10-audit-export-contract --strict` and verify the proposal, design, spec, and task artifacts are consistent and implementation-ready.
- [x] 7.4 Confirm the final diff contains no C-01 manifest/masking, C-02 error-envelope, C-08, C-09 list-query, role/permission, producer/event/persistence, migration, Helm, deployment, cluster, credential, evidence, loop-state, or agent-asset changes; do not run a cluster test for this change.
