# Tasks: Fix C-14 privilege-domain audit route and bootstrap

> Scope is local implementation and verification only. Do not run `kubectl`, Helm, a deployment,
> or any live/shared gateway, database, or Kubernetes check. Do not modify audit loop state,
> evidence bundles, `.claude`, `.codex`, `.agents`, `.agent-runtime`, or other agent assets.

## 1. Freeze the C-14 boundary and preserved behavior

- [x] 1.1 Review this proposal, design, and spec delta before implementation and keep the change
  limited to the canonical denial-audit GET, its public/runtime/console wiring, the dedicated denial
  table bootstrap, focused references, and focused regression proof.
- [x] 1.2 Record the current action/repository behavior as the implementation invariant: only
  `platform_admin` and `tenant_owner`; platform-admin `tenantId` omission is `400`; tenant-owner
  trusted-tenant absence or explicit mismatch is `403`; other roles are `403`; denied paths make no
  repository call; authorized queries preserve filters, limit clamp, offset, projection, and
  `{ denials, total, limit, offset }`.
- [x] 1.3 Confirm that C-14 requires no behavior edit to
  `packages/provisioning-orchestrator/src/actions/privilege-domain-audit-query.mjs` or
  `packages/provisioning-orchestrator/src/repositories/privilege-domain-repository.mjs`; do not
  refactor them, add a registry lookup, add `404`, or change the action name.
- [x] 1.4 Keep adjacent findings out: do not repair privilege-domain assignment/list/update `/api`
  clients or routes, validation/pagination/C-02/RBAC/C-16, enforcement/denial producers, or any other
  audit finding.

## 2. Publish one canonical public contract and align route maps

- [x] 2.1 Add `GET /v1/workspaces/{workspaceId}/privilege-domains/audit` with operation ID
  `queryPrivilegeDomainAudit` to
  `apps/control-plane-executor/openapi/control-plane.openapi.json` under the `workspaces` family.
  Declare the required workspace path, existing query fields (`tenantId`, `requiredDomain`,
  `actorId`, `from`, `to`, `limit`, `offset`), required public headers, existing success envelope and
  denial item fields, current error boundary, exact role semantics in the description, and the
  authorized empty-history `200` behavior. Do not declare a C-14 `404`.
- [x] 2.2 Run `npm run generate:public-api` and retain only the deterministic generated changes for
  `apps/control-plane-executor/openapi/families/workspaces.openapi.json`,
  `packages/internal-contracts/src/public-route-catalog.json`, and
  `docs/reference/architecture/public-api-surface.md`; verify the generated operation is semantically
  identical to the unified source.
- [x] 2.3 Change only the denial-audit entries in `apps/control-plane/route-map.json` and
  `apps/control-plane/route-map.runtime.json` to the canonical method/path. Preserve the existing
  module/export, `params-auth-overrides`, database dependency, coarse `authenticated` route auth,
  query flattening, and action-owned authorization.
- [x] 2.4 Remove the old denial-audit `/api/workspaces/{workspaceId}/privilege-domains/audit` map
  entry rather than retaining an alias. Do not add `/api/security/privilege-domains/denials`, an
  `/api` redirect, or an APISIX/SPA rewrite.
- [x] 2.5 Add a deterministic parity checker that discovers the operation by method/path or
  operation ID and compares unified OpenAPI, generated workspace family, generated public route
  catalog/docs, both maps, and the console client. It must reject every C-14 `/api` alias and verify
  the runtime entry still targets the existing action contract.
- [x] 2.6 In the same local checker, prove the shipped static edge classifies `/v1` before SPA
  fallback and the shipped APISIX configuration gives `/v1/workspaces/*` or the `/v1/*` fallback
  precedence over `/*` to the control plane. Do not change APISIX behavior and do not contact a
  gateway or cluster.

## 3. Preserve authorization, isolation, data, and historical absence semantics

- [x] 3.1 Extend focused action-level regressions for `platform_admin` success, missing-tenant `400`,
  `tenant_owner` own-tenant success, trusted-tenant absence `403`, and explicit tenant mismatch
  `403`. Record repository calls and assert every denied result occurs before any count/list query.
- [x] 3.2 Add exact denied-role controls for role lists containing only `superadmin`,
  `platform_auditor`, another tenant role, or each representative workspace role. Do not normalize
  or alias those tokens to either allowed role.
- [x] 3.3 Preserve and test the existing branch precedence for a principal carrying both
  `platform_admin` and `tenant_owner`: it follows the platform-admin branch and still requires an
  explicit `tenantId`.
- [x] 3.4 Prove authorized count and list SQL both contain parameterized tenant and workspace
  predicates and retain existing optional `requiredDomain`, `actorId`, `from`, and `to` filters,
  `denied_at DESC`, limit clamp, and offset behavior. Keep the projected denial object and success
  envelope unchanged.
- [x] 3.5 Add the stable historical-absence control: an authorized same-tenant request for an unknown
  workspace executes the tenant-plus-workspace history query and returns `200` with
  `denials: []`, `total: 0`, and current limit/offset. Assert no tenant/workspace registry lookup,
  `404`, or changed action occurs.
- [x] 3.6 Add the adversarial ordering control: the same unknown workspace combined with a
  cross-tenant `tenant_owner` request returns `403` before any query and discloses no row, count, or
  workspace-existence distinction.
- [x] 3.7 Assert the canonical GET makes no mutation and adds no quota read/write, denial/audit event,
  C-14-specific metric, or other side effect. Do not alter existing cross-cutting transport
  normalization or generic request telemetry.

## 4. Bootstrap only `privilege_domain_denials`

- [x] 4.1 Add one next-order, dedicated, forward migration under
  `packages/provisioning-orchestrator/src/migrations/` that defines only
  `privilege_domain_denials` with the existing `094` column types, nullability, defaults, primary
  key, actor/domain checks, and unique `correlation_id` contract.
- [x] 4.2 Add only the existing directly associated idempotent indexes: tenant plus descending
  denial time, the non-null workspace plus descending denial time partial index, and required domain
  plus descending denial time. Use stable names and `IF NOT EXISTS`.
- [x] 4.3 Make the migration DDL idempotent and data-preserving. It must contain no `INSERT`,
  `UPDATE`, `DELETE`, `TRUNCATE`, `DROP`, backfill, or cleanup and no statement for
  `privilege_domain_assignments`, `privilege_domain_assignment_history`,
  `workspace_structural_admin_count`, `api_keys`, or `endpoint_scope_requirements`.
- [x] 4.4 Register the dedicated migration in `GOVERNANCE_MIGRATIONS` after its prerequisites and
  retain the existing per-migration search-path reset. Do not register, execute, copy, or rewrite
  `094-admin-data-privilege-separation.sql`.
- [ ] 4.5 Add local schema regressions over the actual migration for all three states: a fresh schema
  creates the exact denial table/constraints/indexes; a second application succeeds without
  duplicates or row changes; and a pre-existing correct denial table with a sentinel row remains
  intact while required named indexes are present.
- [x] 4.6 Add negative schema assertions over the actual bootstrap sequence proving no `094`-only
  assignment/history/view/API-key/endpoint-scope object or seed/update statement enters boot, and
  prove the canonical action can issue its empty count/list query against the boot-created table
  without `42P01`.
- [x] 4.7 Keep every schema regression isolated and local. Use a disposable local PostgreSQL schema
  or an equivalently executable repository-supported SQL harness; never use a shared database or
  Kubernetes.

## 5. Move only the audit client onto authenticated canonical transport

- [x] 5.1 Change only `queryPrivilegeDomainDenials` in
  `apps/web-console/src/services/privilege-domain-api.ts` to use
  `requestConsoleSessionJson`; leave adjacent privilege-domain assignment methods untouched.
- [x] 5.2 Make the client accept the authoritative active workspace separately, encode it with
  `encodeURIComponent`, and request
  `/v1/workspaces/{encodedWorkspaceId}/privilege-domains/audit`. Include the active `tenantId` plus
  current non-scope filters, limit, and offset in the query. Do not emit a `workspaceId` query that
  can replace the path scope and do not retain either old audit `/api` URL.
- [x] 5.3 Add client regression coverage that exercises the actual console-session transport and
  proves the exact encoded URL, bearer authorization, API-version and correlation headers, current
  filter serialization, and no bare `fetch`/`/api` audit request. Preserve the request helper's
  existing refresh behavior rather than reimplementing auth.

## 6. Mount and guard the existing console page

- [x] 6.1 Add one shared privilege-domain-audit access helper whose complete predicate is
  `roles.includes('platform_admin') || roles.includes('tenant_owner')`. Do not compose it with a
  generic superadmin, platform inventory, auditor, tenant-admin, workspace-role, capability, or
  write-access helper.
- [x] 6.2 Mount `ConsolePrivilegeDomainAuditPage` at `/console/privilege-domain-audit` behind a route
  guard using that helper. A denied direct navigation must render an access-denied state without
  rendering/mounting the page component.
- [x] 6.3 Add one navigation item using the same helper. It is visible for `platform_admin` and
  `tenant_owner` and absent for principals with only `superadmin`, `platform_auditor`, another tenant
  role, or workspace roles.
- [x] 6.4 Read `activeTenantId` and `activeWorkspaceId` from `useConsoleContext` in the page. Require
  both before any request; show a context-required state when either is absent. Make shell context,
  not editable free-form tenant/workspace input, authoritative while leaving the existing non-scope
  filters, table fields, pagination, badge, and CSV format otherwise unchanged.
- [x] 6.5 On active tenant or workspace change, synchronously clear rows, total, and row-derived CSV
  before starting the next request. On request failure, keep them cleared and show the current error.
  Ignore or abort a response belonging to a superseded tenant/workspace/filter request.
- [x] 6.6 Add router/navigation/guard regressions for both allowed roles and every denied role class.
  Prove denied direct routes do not mount the page and issue zero audit requests.
- [x] 6.7 Add page/context regressions for missing tenant, missing workspace, complete active scope,
  tenant change, workspace change, request failure, and out-of-order prior response. Assert exact
  request scope and that no previous row, total, badge contribution, or downloadable CSV record
  remains after scope change/error.
- [x] 6.8 Retain focused regressions for the existing visible required-domain and actor filters,
  existing client forwarding of optional `from`/`to`, previous/next offset pagination, table
  projection, 24-hour badge, and CSV column/escaping behavior; do not add filter controls or redesign
  these features under C-14.

## 7. Add production-shaped public and contract regressions

- [x] 7.1 Add a local public HTTP black-box test using the real control-plane listener seam, a
  route table sourced from the canonical runtime-map entry, deterministic verified JWT identities,
  and an isolated recording database. Send the canonical GET over loopback and assert it resolves to
  the existing action rather than SPA content, `NO_ROUTE`, or an `/api` handler.
- [x] 7.2 In the public black-box suite, cover success/envelope/filter forwarding for
  `platform_admin` and same-tenant `tenant_owner`; missing platform tenant; cross-tenant owner;
  denied role classes; unknown-workspace empty `200`; and query-call ordering. Account for the
  existing public error normalizer without changing C-02.
- [x] 7.3 Add contract regressions that compare the unified and generated workspace operation,
  required path/query/header definitions, response schema and denial projection, generated catalog
  entry, and generated documentation row. Assert no C-14 `404` and no `/api` alias in any checked
  artifact.
- [x] 7.4 Make all new HTTP/edge tests hermetic: loopback only, ephemeral ports, deterministic token
  verifier and database doubles, temporary resources only, no external network, and no Kubernetes.

## 8. Align focused references and run validators

- [x] 8.1 Update focused existing migration/runtime documentation, including the stale
  `deploy/kind/README.md` statement that broad `094` failure necessarily leaves the audit route
  unusable and the migration inventory in `apps/control-plane/required-migrations.txt`, to name the
  canonical route and dedicated denial-table bootstrap accurately. Do not document or imply an
  `/api` alias or claim that unrelated `094` objects are bootstrapped.
- [x] 8.2 Regenerate public API artifacts and run `npm run validate:openapi` and
  `npm run validate:public-api`; ensure a second generation produces no diff.
- [x] 8.3 Run the focused public HTTP, route parity, contract, action/repository, schema, client,
  router/navigation, and page/context suites. Run relevant service-catalog/structure/type/lint checks
  in proportion to the files changed and resolve every C-14 regression.
- [x] 8.4 Run `openspec validate fix-c14-privilege-domain-audit-route --strict` and resolve every
  validation error without weakening a requirement.
- [x] 8.5 Run `git diff --check` and review the final diff against `codex-integration`. Confirm it
  contains only the bounded C-14 implementation, generated artifacts, focused references/tests, and
  this OpenSpec change; confirm the action/repository, adjacent `/api` findings, RBAC/C-02/C-16,
  APISIX behavior, Kubernetes, unrelated docs/tests, loop/evidence, and agent assets are untouched.

## 9. Independent verification and review

- [x] 9.1 Give an independent verifier the requirements, implementation diff, canonical/legacy
  reproduction URLs, role matrix, unknown-workspace control, schema negative list, and focused local
  commands. Require it to rerun the public/contract/auth/schema/client/router checks and validators,
  verify no `/api` alias or forbidden migration object exists, and use no Kubernetes.
- [x] 9.2 Give a different independent reviewer the requirements, diff, and verifier result. Require
  explicit approval of canonical route parity, exact role preservation, pre-query tenant isolation,
  stable empty-history semantics, narrow idempotent bootstrap, context/CSV isolation, adjacent-scope
  exclusions, documentation, and strict OpenSpec validation before handoff.

> **Live/cluster verification: NOT PART OF C-14.** Do not deploy, inspect pods, run `kubectl`, use
> Helm, or query a live APISIX/control-plane/PostgreSQL endpoint for this remediation.
