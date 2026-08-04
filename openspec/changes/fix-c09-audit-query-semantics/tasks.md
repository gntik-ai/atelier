## 1. Write failing public-handler and isolation tests

- [x] 1.1 Extend the public black-box audit-record tests to exercise identical tenant and workspace route semantics with the omitted defaults `page[size]=25` and `sort=-eventTimestamp`.
- [x] 1.2 Add table-driven public-handler tests for each of the twelve filters, a conjunctive all-filter request, and a valid unmatched free-form value returning an empty HTTP `200` with canonical `appliedFilters`.
- [x] 1.3 Add public-handler tests proving duplicate raw controls, empty filters, invalid page sizes, sort, RFC 3339 bounds/window, enum values, cursor encoding/version/shape/UUID, and incompatible cursors return HTTP `400` before the datastore spy is called.
- [x] 1.4 Add public-handler pagination tests for ASC/DESC timestamp ties, truthful first/middle/final page metadata, changed valid page size, and multiple pages without duplicate or skipped event IDs.
- [x] 1.5 Add public-handler authorization and side-effect controls proving P10 stays read-only, P13 receives no data from a foreign path or replayed foreign cursor, cursor content never authorizes scope, and GET invokes no audit writer or other mutation.

## 2. Write failing store and cursor tests

- [x] 2.1 Add store tests that capture literal SQL and parameters for mandatory tenant/workspace scope plus each individual canonical filter and all twelve filters combined.
- [x] 2.2 Add SQL-injection controls proving quotes, wildcard characters, comments, parentheses, and SQL keywords remain exact parameter values and never alter SQL text, predicates, comparator, or order direction.
- [x] 2.3 Add store tests for literal `created_at, id` ASC/DESC ordering, direction-correct tuple comparisons, timestamp ties, `page[size] + 1`, and first/middle/terminal page assembly.
- [x] 2.4 Add cursor unit tests for deterministic base64url version-1 round trips, bounded strict object validation, canonical scope/filter/sort fingerprints, page-size independence, unsupported versions, non-UUID or malformed positions, microsecond preservation, and incompatible scope/filter/sort rejection.
- [x] 2.5 Add store-boundary tests proving an absent tenant executes no unscoped SELECT and every workspace continuation retains both owning-tenant and exact-workspace predicates.

## 3. Write failing contract and response tests

- [x] 3.1 Extend internal audit-query contract tests to require the twelve canonical filters, full enum allowlists, RFC 3339 bounds, default/maximum page sizes, both sort values, and versioned cursor semantics.
- [x] 3.2 Extend OpenAPI contract tests to compare `listTenantAuditRecords` and `listWorkspaceAuditRecords` against the internal contract, including the `mcp` subsystem, parameter defaults/formats/enums, HTTP `400`, and complete pagination schema.
- [x] 3.3 Add response-conformance tests for first-page, continuation, filtered-empty, and terminal HTTP `200` bodies; for malformed-input HTTP `400`, assert the stable code/message and absence of collection metadata without expanding into the separate C-02 error-envelope repair.
- [x] 3.4 Add response metadata tests requiring exactly twelve canonical `availableFilters`, only effective snake-case `appliedFilters`, actual `page.size`, truthful `hasMore`, and `nextCursor` only when another page exists.

## 4. Write failing console tests

- [x] 4.1 Extend `console-metrics` hook tests to retain server `hasMore`/`nextCursor`, send `page[after]`, append an accepted continuation in server order, and preserve the existing five filter mappings.
- [x] 4.2 Add hook race tests for tenant/workspace, filter, and explicit-reload resets under the console's fixed descending sort; late first/next-page response rejection; duplicate continuation suppression; defensive event-ID de-duplication; and retry without cursor advancement.
- [x] 4.3 Extend `ConsoleObservabilityPage` tests for a keyboard-focusable named continuation button, busy/disabled behavior, live appended-count/error feedback, terminal-page disappearance, and existing-record preservation on continuation failure.
- [x] 4.4 Retain permission-aware console tests proving a persona without the existing audit-read grant sees no audit affordance and triggers no background audit-record request.

## 5. Implement strict canonical request normalization

- [x] 5.1 Define or reuse one canonical twelve-filter descriptor set, including public names, snake-case IDs, types, labels, and complete contractual enum allowlists.
- [x] 5.2 Implement strict raw-query parsing for one unambiguous integer page size from 1 through 200, the two sort tokens, complete RFC 3339 timestamps with a non-reversed inclusive window, enum values, and free-form exact strings.
- [x] 5.3 Implement version-1 cursor encode/decode and canonical scope/filter/sort fingerprint comparison while keeping page size outside the fingerprint and treating decoded cursor fields as untrusted continuation input only.
- [x] 5.4 Wire the same normalized query and validation errors through tenant and workspace handlers after existing scope authorization and before every store call; remove silent clamping, ignored controls, and catch-to-empty handling of invalid requests.

## 6. Implement parameterized keyset query and honest pages

- [x] 6.1 Align `auditRowToRecord` canonical subsystem, action, result, actor, resource, origin, timestamp, and stored-or-legacy correlation projections with reusable SQL expressions for their filter dimensions without a migration or backfill.
- [x] 6.2 Extend `queryAuditEvents` to accept all twelve canonical filters, normalized sort, validated cursor position, and page size while retaining mandatory tenant and optional exact-workspace scope predicates.
- [x] 6.3 Build every filter and cursor comparison with driver parameters and choose only implementation-owned literal ASC/DESC order and tuple comparator branches.
- [x] 6.4 Query `page[size] + 1`, return at most the requested rows, and compute actual size, truthful `hasMore`, and a next cursor positioned at the last returned row only when lookahead proves another page.
- [x] 6.5 Update the live collection builder to return the canonical records, all twelve `availableFilters`, effective canonical `appliedFilters`, and the store's page metadata on both routes.

## 7. Align contracts and console runtime

- [x] 7.1 Update the internal audit-query surface and executor-side normalizer/response builder so their validation, canonical names, cursor rules, defaults, filters, sort, and pagination match the live control-plane path.
- [x] 7.2 Update both OpenAPI operations and `AuditRecordCollectionResponse` to match the canonical enum, default, format, HTTP `400`, and `hasMore`/`nextCursor` semantics without changing unrelated error-envelope work.
- [x] 7.3 Extend the console audit response type and hook state with actual page metadata, active query generation, first-page reset, safe continuation append, duplicate-request suppression, and retryable continuation errors.
- [x] 7.4 Add the accessible continuation control and live feedback to the existing audit page while preserving Actor, Category, Result, From, To, permission gating, and current table/detail interactions.

## 8. Update reference material

- [x] 8.1 Update the audit-record query reference to list both routes, the twelve exact conjunctive filters and enum allowlists, strict HTTP `400` validation, defaults, total order, versioned query-bound cursor, `limit + 1`, and truthful response metadata.
- [x] 8.2 Document explicitly that the cursor is not authentication or authorization, valid unmatched free-form filters return an empty HTTP `200`, the authorized path scope remains mandatory, and GET is read-only.
- [x] 8.3 Update console guidance for the existing five controls, accessible continuation, reset/anti-stale behavior, and terminal/error states without documenting advanced visual filters, migration, Helm, deployment, or cluster procedures.

## 9. Run focused validation and independent checks

- [x] 9.1 Run the focused public black-box handler, audit store/cursor, internal/OpenAPI contract, and success-schema tests; fix regressions only within the C-09 query-semantics scope.
- [x] 9.2 Run the focused web-console hook and page tests, verify accessible continuation behavior in the component harness, and run the repository type-check while distinguishing unrelated pre-existing failures from touched-module failures.
- [x] 9.3 Run a focused authorization/isolation/read-only checker over P1, P10, P4, and P13 scenarios, including foreign first-page and cursor replay controls and SQL parameter capture.
- [x] 9.4 Run `openspec validate fix-c09-audit-query-semantics --strict` and verify all proposal, design, spec, and task artifacts are consistent and implementation-ready.
- [x] 9.5 Confirm the final diff contains no C-02, C-08, C-10, role/permission, producer/backfill, advanced-filter UI, migration, Helm, deployment, cluster, credential, evidence, loop-state, or agent-asset changes; do not run a cluster test for this change.
