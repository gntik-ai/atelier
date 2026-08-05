# Change: Publish and wire the privilege-domain denial audit route

## Why

C-14 is the confirmed E6 privilege-domain audit routing and bootstrap defect. The repository has a
real read-only action and repository query for privilege-domain denial history, and the web console
already contains a page intended to display that history, but no deployed browser request can reach
the action through one coherent public contract.

On the `codex-integration` base of this branch:

- `apps/web-console/src/services/privilege-domain-api.ts` calls
  `/api/security/privilege-domains/denials` with bare `fetch`, so it neither uses the authenticated
  console-session request path nor addresses a registered action route.
- The web-console static edge proxies only exact `/v1` and `/v1/*`. APISIX gives `/v1/workspaces/*`
  precedence over the SPA catch-all, while an `/api/*` browser request falls through to the SPA.
- `apps/control-plane/route-map.json` and `apps/control-plane/route-map.runtime.json` register the
  audit action at `/api/workspaces/{workspaceId}/privilege-domains/audit`, which disagrees with the
  client, the versioned public surface, and the gateway/runtime path family.
- `ConsolePrivilegeDomainAuditPage` exists, but `apps/web-console/src/router.tsx` and
  `ConsoleShellLayout.tsx` expose neither a route nor a navigation item for it.
- `privilege-domain-repository.mjs::queryDenials` reads `privilege_domain_denials`, but
  `GOVERNANCE_MIGRATIONS` does not apply migration `094-admin-data-privilege-separation.sql`.
  Applying `094` wholesale is not a safe fix: besides the denial table, it creates assignment and
  history objects, alters `api_keys` and `endpoint_scope_requirements`, and seeds endpoint
  classifications that are outside C-14.

The result is a public reachability failure for the two roles the existing action authorizes:
`platform_admin` and `tenant_owner`. It is not an authorization-policy defect and must not be used
to broaden the reader set. In particular, `superadmin`, `platform_auditor`, tenant roles other than
`tenant_owner`, and every workspace role remain unauthorized unless the same principal also carries
one of the two exact allowed role tokens.

## What Changes

- Publish exactly one canonical operation:
  `GET /v1/workspaces/{workspaceId}/privilege-domains/audit`. Add it to the unified OpenAPI source,
  regenerate the workspace-family OpenAPI, public route catalog, and public API reference, and align
  both control-plane maps to the same method and path. Do not publish or retain an `/api` alias.
- Preserve the current action invocation contract and behavior: authenticated dispatch through
  `params-auth-overrides`, the existing `platform_admin` and `tenant_owner` checks, tenant mismatch
  handling, tenant/workspace/filter predicates, limit clamp, offset pagination, denial projection,
  and `{ denials, total, limit, offset }` success envelope remain unchanged.
- Preserve the existing authorization edge cases exactly. A `tenant_owner` is forced to the tenant
  in trusted authentication context and an explicit mismatch remains `403` before any repository
  query. A `platform_admin` may address a tenant but still must supply `tenantId`; omission remains
  `400`. The `platform_admin` branch retains its current precedence for a principal carrying both
  allowed role tokens.
- Preserve the historical unknown-workspace behavior. The denial query remains a tenant-plus-
  workspace predicate over history; if no row matches an unknown or row-less workspace, it returns
  `200` with an empty `denials` array and `total: 0`. C-14 adds no workspace lookup, `404`, scoped-
  existence policy, or action change. A cross-tenant owner is still rejected before either count or
  list SQL runs.
- Make only the audit client use `requestConsoleSessionJson` and the canonical `/v1` route, with the
  active workspace identifier encoded as a path segment and the active tenant supplied as the
  request tenant scope. Other privilege-domain `/api` clients are adjacent findings and remain out
  of scope.
- Mount the existing audit page at one console route and add one navigation item guarded by a shared
  exact role predicate: the role list contains `platform_admin` or `tenant_owner`. The page is
  hidden and not mounted for every other role, including `superadmin`, `platform_auditor`, and
  workspace roles, so those roles issue no background audit request even through direct navigation.
- Require both an active tenant and an active workspace before the page queries. Make the shell
  context authoritative for scope, preserve the current visual/filter/pagination/24-hour badge/CSV
  feature set, and clear prior rows, totals, and row-derived CSV state immediately on scope change
  and on request failure. A stale response from a previous scope must not restore those rows.
- Add one dependency-safe, forward, idempotent bootstrap migration containing only
  `privilege_domain_denials` and the indexes and constraints directly required by its existing
  reader/writer contract. Register that dedicated migration in `GOVERNANCE_MIGRATIONS`; do not
  execute or rewrite `094` and do not create or alter assignments, assignment history, API keys, or
  endpoint scope requirements. The migration performs no backfill or deletion.
- Prove the complete path with local deterministic regressions: public HTTP black-box behavior,
  gateway/runtime/map parity, generated contract parity, exact authorization and tenant isolation,
  fresh/rerun/pre-existing schema behavior, authenticated client URL construction, router/nav/guard
  and context transitions, state/CSV clearing, and documentation alignment. Verification uses no
  Kubernetes or live cluster.

## Personas and Observable Outcomes

- A `platform_admin` can select an active tenant and workspace in the console, open the denial audit
  page, and receive the existing filtered/paginated denial envelope through the authenticated
  canonical `/v1` request. Omitting `tenantId` at the public API still returns `400`.
- A same-tenant `tenant_owner` can open the same page and read only rows satisfying the trusted
  tenant plus active-workspace predicates. Supplying another tenant remains `403` before SQL.
- A principal whose roles contain only `superadmin`, `platform_auditor`, `tenant_admin`, a workspace
  role, or any other non-allowed role sees no navigation entry, cannot mount the data page through a
  direct console URL, and causes no background denial query. The public action returns `403` before
  repository access.
- An adversarial cross-tenant owner cannot learn denial counts or workspace existence. An unknown
  workspace within an otherwise authorized tenant produces the stable empty `200` history response,
  while a tenant mismatch terminates before the datastore.
- An installer gets the exact denial table required by the served read action without taking on the
  unrelated DDL and data changes in migration `094`; rerunning boot or booting over the already
  correct table preserves existing rows.

## Non-Goals

- No new `/api` compatibility route, redirect, proxy rule, or client alias. C-14 publishes only the
  canonical `/v1` GET.
- No repair of the adjacent privilege-domain assignment/list/update `/api` clients or routes, no
  privilege-domain assignment UX, and no changes to denial production or enforcement plugins.
- No role, permission, RBAC, scope, or authorization-model expansion. In particular, no access for
  `superadmin`, `platform_auditor`, `tenant_admin`, `workspace_owner`, `workspace_admin`,
  `workspace_auditor`, or other workspace roles by virtue of C-14.
- No action/repository semantic refactor: no new tenant/workspace resolver, no resource lookup, no
  `404`, no action-name change, and no C-16 scoped-resource-existence behavior.
- No stricter validation, cursor work, new pagination model, filter redesign, limit/offset repair, or
  response-envelope repair. C-02, validation, and pagination findings remain independent.
- No redesign of the existing table, filters, 24-hour badge, pagination controls, or CSV export and
  no new privilege-domain dashboard.
- No execution, modification, or replacement of `094-admin-data-privilege-separation.sql`; no
  `privilege_domain_assignments`, `privilege_domain_assignment_history`,
  `workspace_structural_admin_count`, `api_keys`, or `endpoint_scope_requirements` change.
- No historical backfill, row rewrite, deletion, cleanup, or migration rollback that removes
  denial records.
- No mutation, quota consumption/enforcement, new audit event, dedicated C-14 metric, or other side
  effect from this GET. Existing cross-cutting request transport behavior remains unchanged.
- No Helm/chart redesign, deployment, shared/staging/production mutation, Docker rollout, external
  network dependency, or Kubernetes access.
- No remediation of another audit finding; no audit loop state, evidence bundle, `.claude`, `.codex`,
  `.agents`, `.agent-runtime`, or other agent asset change.

## Exit Criteria

- Unified OpenAPI, the generated workspace-family document, generated public route catalog,
  generated public API reference, `route-map.json`, and `route-map.runtime.json` agree on exactly
  `GET /v1/workspaces/{workspaceId}/privilege-domains/audit`; none exposes a C-14 `/api` alias.
- The canonical runtime entry continues to invoke
  `privilege-domain-audit-query.mjs::main` with `params-auth-overrides`, a database dependency,
  authenticated coarse routing, path/query merge semantics, and the existing action-level role
  checks.
- `platform_admin` and `tenant_owner` retain their current success and failure behavior;
  `superadmin`, `platform_auditor`, other tenant roles, and workspace roles remain `403` without a
  repository call. A tenant-owner mismatch is `403` before SQL, and a platform admin without
  `tenantId` is `400` before SQL.
- Authorized requests preserve the same filter forwarding, upper limit clamp, offset, denial item
  projection, count/list behavior, and `{ denials, total, limit, offset }` envelope.
- An authorized tenant/workspace query with no matching historical rows, including an unknown
  workspace identifier, returns `200` with an empty collection and zero total, with no registry
  lookup, `404`, or changed authorization action.
- The audit client uses `requestConsoleSessionJson` and constructs the canonical path with the
  encoded active workspace. Both active tenant and active workspace are required, and the active
  tenant is supplied for the existing platform-admin requirement.
- The console route and navigation item use one shared exact
  `platform_admin || tenant_owner` predicate. Unauthorized principals cannot mount the page and
  trigger no audit request. Missing context also triggers no request.
- Scope changes and errors clear old rows, totals, and row-derived CSV immediately; superseded
  responses cannot repopulate data from the previous scope. The existing non-scope filters,
  pagination, badge, table, and CSV behavior are otherwise unchanged.
- A dedicated idempotent migration creates only `privilege_domain_denials` and its directly required
  constraints/indexes, is registered after its prerequisites in `GOVERNANCE_MIGRATIONS`, succeeds
  on fresh install and rerun, preserves a pre-existing correct table and rows, and never runs or
  rewrites `094`.
- Public black-box, contract, action/repository isolation, schema bootstrap, client, router/nav,
  guard/context/state, and documentation regressions pass locally. OpenAPI/public API validators and
  independent verification/review checkers pass without Kubernetes.
- `openspec validate fix-c14-privilege-domain-audit-route --strict` passes.

## Risks and Rollback

The highest security risk is accidental role broadening while making the page reachable. Several
console helpers treat `superadmin` as a broad platform administrator, but this action deliberately
does not. C-14 therefore uses a dedicated exact predicate shared by the route guard and navigation,
and retains the action as the final authority. Role-matrix regressions must prove that
`superadmin`, `platform_auditor`, and workspace roles neither query nor render history.

The second risk is historical scope leakage in the browser. The existing page retains rows when a
request fails, so changing active tenant/workspace could leave prior rows and their CSV export
visible. The repair clears row-derived state before a new scope request and on failure, and ignores
superseded responses. Tests exercise tenant change, workspace change, request failure, and an
out-of-order old response.

The third risk is overreaching schema bootstrap. Running `094` would silently activate unrelated
assignment/history/API-key/endpoint-classification changes. The dedicated migration repeats only
the already-defined denial-table contract, uses idempotent DDL, is registered after prerequisites,
and has negative tests for every excluded object and statement family.

The fourth risk is contract/runtime drift. The route spans a unified OpenAPI source, generated
artifacts, two runtime/discovery maps, the console client, the web-console `/v1` edge, and APISIX's
workspace route. One parity regression compares these surfaces by method, canonical template, and
operation identity and rejects `/api` aliases.

Rollback removes the console route/nav/client wiring, the canonical map/OpenAPI operation and its
regenerated artifacts, and the dedicated migration from future boot. The denial table must not be
dropped and existing denial rows must not be deleted during rollback. The unchanged action and
repository require no behavioral rollback. Reverting the route reintroduces C-14 reachability
failure but does not require or authorize running migration `094`.
