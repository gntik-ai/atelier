# Change: Fix audit-export request contract, page-size bound, and path parity

## Why

C-10 / OBS-CONTRACT-10 is a confirmed audit-export contract defect. The tenant and workspace
`audit-exports` routes publish a strict request surface through the internal export contract
(`packages/internal-contracts/src/observability-audit-export-surface.json`) and the unified OpenAPI
document (`apps/control-plane-executor/openapi/families/metrics.openapi.json`:
`exportTenantAuditRecords` / `exportWorkspaceAuditRecords`, whose `AuditExportRequest` marks `format`
required with an enum of `jsonl`/`csv` and bounds `pageSize` to `1..10000`). The internal contract
declares `request_contract.required_fields: ["format"]`, `default_page_size: 500`, and
`max_page_size: 10000`. The live handler does not honor that surface.

On this branch's base, `apps/control-plane/metrics-handlers.mjs::auditExport` (lines 584-646):

- Computes `const limit = Math.min(Math.max(Number(ctx.body?.pageSize ?? ctx.body?.filters?.pageSize
  ?? 200) || 200, 1), 200)`. It defaults an omitted `pageSize` to `200` (the contract default is
  `500`) and clamps any larger request down to `200` (the contract maximum is `10000`), so a caller
  asking for up to 10000 records is silently truncated to 200, and an invalid `pageSize` (`0`,
  `10001`, `1.5`, `"abc"`) is silently coerced into range with no error.
- Never validates `format`. `ctx.body?.format` is passed straight to the builder. The builder's
  `normalizeFormat` (`apps/control-plane-executor/src/observability-audit-export.mjs`) defaults an
  **absent** format to the contract default `jsonl` instead of rejecting it even though the contract
  marks `format` **required**, and an **unsupported** format makes the builder throw
  `AUDIT_EXPORT_INVALID_FORMAT` — which the handler's `catch (e) { console.error(...) }` swallows,
  falling through to the inline fallback that coerces `format` to `csv|jsonl` and returns HTTP `200`.
  A missing or invalid format therefore silently produces a successful export.
- Runs the datastore query first inside `try { rows = await queryAuditEvents(...) } catch { rows =
  [] }`, so validation never precedes SQL and any datastore failure is masked as an empty successful
  export.

The store (`apps/control-plane/audit-store.mjs::queryAuditEvents`, lines 454-517) caps the export's
legacy `limit` branch at 200 (`Math.min(Math.max(Number(limit) || 50, 1), 200)`) — the same 200
bound the audit-records **list** uses — so the store cannot honor an export up to 10000 even when the
handler asks for it. The console export client
(`apps/web-console/src/lib/console-metrics.ts::exportAuditRecords`, lines 463-479) posts only
`{ filters }` with no `format` and no `pageSize`, so once the API enforces the contract's
`format`-required rule the console export would be rejected.

The defect degrades every governed export consumer. A privileged platform/superadmin administrator
(P1) and a platform auditor (P4) cannot obtain a full-fidelity export up to the contractual 10000 and
receive a silent truncation to 200 instead. A workspace auditor and scoped viewer/auditor (P10)
receive ambiguous exports whose format was never confirmed. An actor from another tenant (P13) is the
adversarial isolation control that must gain nothing through the request body or a swallowed error.

## What Changes

- Normalize the export request from the contractual source before any datastore or adapter call:
  `format` must be present and one of the contract's supported ids (`jsonl`, `csv`); `sort` must be
  `eventTimestamp` or `-eventTimestamp`, every public filter must validate (including a valid
  one-sided timestamp), and `pageSize` must
  be an integer from 1 through 10000, defaulting to 500. Reject a missing or invalid `format` and an
  invalid `pageSize` with a stable coded client error (HTTP `400`) before SQL, never coercing,
  truncating, or converting them into a successful fallback export.
- Bind the export strictly to `ctx.resolvedScope` — the tenant, and for the workspace route the exact
  workspace, that `guarded()` already authorized. The request body SHALL NOT widen, override, or
  cross that scope.
- Add an export read mode/cap to the store so `queryAuditEvents` honors an export size up to 10000
  within the authorized scope, without changing the audit-records **list** query path, which keeps
  its maximum of 200.
- Make the principal builder path and the inline fallback path share one normalized request (the
  validated `format` and page limit), the same resolved scope, and the same masking profile. A
  contractual validation error is surfaced rather than swallowed into a successful fallback, and an
  operational datastore failure is not reported as an empty successful export.
- Keep the C-01 `AuditExportManifest` shape and `AuditExportedRecord` projection and masking intact;
  no unmasked credential or provider-locator value ever appears in a successful export from either
  path, and the fallback stays no less conservative than the principal.
- Update the console export client to serialize an explicit `format=jsonl` and `pageSize=500` with
  the default masking profile alongside its existing filter controls, so an authorized console export
  satisfies the contract.
- Keep the internal export-surface contract and both OpenAPI operations canonical and covered by
  conformance tests; neither route declares a request field its runtime ignores nor enforces a bound
  its contract does not declare.
- Prove the fix through the public handler harness and an in-memory audit dataset, plus focused store
  and contract assertions. Live PostgreSQL and cluster verification remain outside this local-only
  remediation run.

## Personas and Observable Outcomes

- P1 (privileged platform/superadmin administrator) and P4 (platform auditor) obtain a full-fidelity
  masked export of up to 10000 records within an authorized scope; a missing or invalid `format` or
  `pageSize` is a clear client error, not a surprise truncation or silent fallback.
- P10 (workspace auditor, primary; tenant/workspace viewer or developer, constrained) exports
  read-only within its existing allowed scope only, gaining no write, permission, quota, or
  cross-scope capability; a constrained persona without the export permission keeps its existing
  denial.
- P5/P6 (tenant owner/admin) and P7 (workspace owner/admin) are adjacent: their authorization is
  unchanged and the export honors the same required-format, bounded-page-size contract.
- P12 (machine / service-account client) is bound by the identical contract; there is no
  persona-specific bypass of the required `format` or the page-size range.
- P13 (actor from another tenant) is denied in existing authorization order — before any body,
  `format`, or `pageSize` validation — when it targets a foreign path scope or names a foreign
  tenant/workspace in the body, and gains no foreign record, count, or existence signal.

## Non-Goals

- No C-01 manifest or projection or masking remediation. C-10 keeps the `AuditExportManifest` shape,
  the `AuditExportedRecord` projection, and per-field masking compatible; it does not re-specify them.
- No C-02 `ErrorResponse` envelope repair, no C-08 change, and no C-09 audit-record list
  query-semantics change. The audit-records list keeps its page-size maximum of 200.
- No new role, permission, membership, or authorization decision. The existing own-tenant guard
  (`canManageTenant`) and the route auth are unchanged; the request body never becomes scope
  authority.
- No new audit event producer, domain event, artifact or export persistence, durable export
  distribution, or database migration, column, index, constraint, trigger, or default.
- No streaming, chunked, or asynchronous export redesign. The export remains a single synchronous
  masked preview bounded by the validated `pageSize`.
- No new public route, gateway policy, or SDK surface. The `audit-exports` routes, `format`, and
  `pageSize` are already published; C-10 makes the runtime honor them.
- No change to the other metrics handlers (quotas, overview, usage, series, audit-records list) or to
  any audit finding other than C-10.
- No shared, staging, or production deployment, no Helm/chart change, no Kubernetes access, and no
  loop-state or audit-evidence change.

## Exit Criteria

- Both `audit-exports` routes require an explicit `format` of `jsonl` or `csv` and reject a missing or
  invalid format with a stable coded HTTP `400` before any datastore call and without a successful
  fallback.
- `pageSize` defaults to 500 when omitted, is accepted as an integer at 1, 201, 500, and 10000, and
  is rejected with HTTP `400` before the datastore for 0, 10001, fractional, non-numeric, empty, or
  otherwise non-integer values, with no silent clamp or truncation.
- The store honors an export up to 10000 within the authorized scope through a distinct export
  mode/cap, while the audit-records list query keeps its maximum of 200 unchanged.
- The principal builder and the inline fallback receive one normalized request, the same resolved
  scope, and the same masking profile; a contractual error is never converted into a successful
  export, and an operational datastore failure is never reported as an empty successful export.
- The export binds only to `ctx.resolvedScope`; a request body that names another tenant or workspace
  cannot widen, override, or cross scope, and a cross-tenant caller is denied in existing
  authorization order before body validation or SQL.
- The export remains side-effect-free — no application write, domain-audit write, artifact/export
  persistence, domain event, quota mutation, or permission change — and no successful export from
  either path exposes an unmasked credential or provider-locator value.
- The console export client sends explicit `format=jsonl` and `pageSize=500` with the default masking
  profile, and the internal contract, both OpenAPI operations, and the runtime agree on the required
  format, default and maximum page size, and manifest shape.
- `openspec validate fix-c10-audit-export-contract --strict` passes.

## Risks and Rollback

The primary risk is response size: a maximum export of 10000 masked records is a materially larger
synchronous payload than the previous 200-row cap, increasing latency and control-plane memory for a
single request. This change deliberately keeps the export synchronous and bounded by `pageSize`; a
streaming or asynchronous distribution redesign is explicitly out of scope and remains future work,
and the risk is documented rather than mitigated by a new delivery mechanism.

The second risk is a validation regression: tightening `format` and `pageSize` from silent coercion
and swallowed fallback to coded rejection changes responses for previously tolerated malformed input.
The change updates the console to send contract-valid `format` and `pageSize` so the primary console
path is unaffected, and specifies that well-formed requests succeed while only missing/invalid input
returns `400`.

The third risk is masking or manifest regression across the two paths. The change requires the
principal and fallback to share the normalized request and masking profile, keeps the fallback no
less conservative than the principal, and preserves the C-01 manifest/projection so no export path
emits an unmasked sensitive value or an off-contract manifest.

Rollback reverts the handler, store export mode, console client, and focused tests. There is no
schema, datastore, migration, or published-contract change to reverse; reverting simply reintroduces
the C-10 default-200, clamp-200, unvalidated-format, swallow-to-fallback behavior. This change makes
no edit that would create scope creep into C-01 (manifest/masking), C-02 (error envelope), C-08, or
C-09 (list query semantics).
