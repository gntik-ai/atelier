# privilege-domain-audit-route — spec delta for fix-c14-privilege-domain-audit-route

## ADDED Requirements

### Requirement: Privilege-domain denial history has one canonical public route

The system SHALL publish exactly one privilege-domain denial history operation as
`GET /v1/workspaces/{workspaceId}/privilege-domains/audit` with operation ID
`queryPrivilegeDomainAudit`. The unified OpenAPI, generated workspace-family OpenAPI, generated
public route catalog, generated public API documentation, discovery route map, executable runtime
route map, and console audit client SHALL agree on that method and route template. The operation
SHALL use the workspace public family and workspace scope while continuing to invoke the existing
`privilege-domain-audit-query.mjs::main` action.

The system SHALL NOT publish, map, call, redirect, or proxy a C-14 alias under `/api`, including
`/api/workspaces/{workspaceId}/privilege-domains/audit` and
`/api/security/privilege-domains/denials`.

#### Scenario: Canonical operation is discoverable on every public and runtime surface

- **WHEN** a contract or runtime checker discovers `queryPrivilegeDomainAudit`
- **THEN** unified OpenAPI, the generated workspace family, the generated public route catalog and
  docs, both control-plane maps, and the console client identify it as
  `GET /v1/workspaces/{workspaceId}/privilege-domains/audit`
- **AND** the executable entry targets the existing action's `main` export through the existing
  parameter/auth override invocation and database dependency

#### Scenario: Old unversioned route is not retained

- **WHEN** a checker searches the C-14 OpenAPI, generated artifacts, maps, docs, and client for an
  audit alias under `/api`
- **THEN** neither legacy audit path is present and no redirect or compatibility alias is declared

#### Scenario: Canonical workspace request follows existing gateway precedence

- **WHEN** the browser edge receives a request for
  `/v1/workspaces/wrk-a/privilege-domains/audit`
- **THEN** the existing `/v1` edge classification forwards it to the gateway, the existing APISIX
  `/v1/workspaces/*` or `/v1/*` control-plane route takes precedence over SPA `/*`, and no new
  C-14-specific APISIX route or rewrite is required

### Requirement: Public contract describes the existing denial query surface

The canonical operation SHALL declare required path parameter `workspaceId`, the existing query
parameters `tenantId`, `requiredDomain`, `actorId`, `from`, `to`, `limit`, and `offset`, and the
repository-standard version and correlation headers. It SHALL declare the existing success body as
an object containing `denials`, `total`, `limit`, and `offset`. Each denial SHALL retain the existing
projection: `id`, `tenantId`, nullable `workspaceId`, `actorId`, `actorType`, nullable
`credentialDomain`, `requiredDomain`, `httpMethod`, `requestPath`, nullable `sourceIp`,
`correlationId`, and `deniedAt`.

The operation SHALL use the existing canonical public error boundary without adding a C-02
envelope change. It SHALL NOT declare a resource-not-found response for an authorized query whose
history predicate matches no rows.

#### Scenario: Contract consumer inspects the success schema

- **WHEN** a consumer resolves the success response for `queryPrivilegeDomainAudit`
- **THEN** it finds the exact four-field collection envelope and the existing denial-record
  projection, including the nullable workspace, credential-domain, and source-IP fields

#### Scenario: Contract consumer inspects current query behavior

- **WHEN** a consumer resolves the operation parameters
- **THEN** it finds the path workspace plus the existing tenant, domain, actor, time, limit, and
  offset query surface, with documentation that `tenantId` remains required for a
  `platform_admin` and the trusted auth tenant remains authoritative for a `tenant_owner`

#### Scenario: Empty history is not contracted as resource absence

- **WHEN** a checker inspects the canonical operation responses
- **THEN** it finds no C-14 `404` for a row-less or unknown workspace history query and finds the
  existing public error schema for applicable non-success outcomes

### Requirement: Runtime dispatch preserves the exact action authorization boundary

The runtime route SHALL remain coarse `authenticated` dispatch and SHALL pass trusted
`params.auth`, the path workspace, and flattened query parameters to the existing action through
`params-auth-overrides`. The action authorization boundary SHALL allow a role list containing
`platform_admin` or `tenant_owner` and SHALL NOT independently allow `superadmin`,
`platform_auditor`, another tenant role, or a workspace role.

The existing branch order SHALL be preserved: `platform_admin` SHALL take precedence when both
allowed role tokens are present. A `platform_admin` SHALL still require requested `tenantId` and
SHALL receive status `400` before repository access when it is absent. A `tenant_owner` SHALL use
the tenant from trusted authentication context; absent trusted tenant or an explicitly different
requested tenant SHALL remain status `403` before repository access. Every other denied role set
SHALL remain status `403` before repository access.

#### Scenario: Platform administrator supplies a tenant

- **WHEN** an authenticated principal whose role list contains `platform_admin` requests the
  canonical route with `tenantId=ten-a`
- **THEN** the action queries denial history with tenant `ten-a` and the workspace from the path

#### Scenario: Platform administrator omits a tenant

- **WHEN** an authenticated principal whose role list contains `platform_admin` requests the
  canonical route without `tenantId`
- **THEN** the request returns status `400` under the existing public error boundary before any
  repository count or list query

#### Scenario: Dual allowed-role principal follows platform branch

- **WHEN** the trusted role list contains both `platform_admin` and `tenant_owner` but the request
  omits `tenantId`
- **THEN** the platform-admin branch retains precedence and returns status `400` before any
  repository query

#### Scenario: Tenant owner queries its trusted tenant

- **WHEN** an authenticated `tenant_owner` with trusted tenant `ten-a` requests the canonical route
  with no tenant override or with `tenantId=ten-a`
- **THEN** the action queries only tenant `ten-a` and the workspace from the path

#### Scenario: Tenant owner requests another tenant

- **WHEN** an authenticated `tenant_owner` with trusted tenant `ten-a` supplies
  `tenantId=ten-b`
- **THEN** the request returns status `403` before any repository count or list query

#### Scenario: Tenant owner lacks trusted tenant context

- **WHEN** a role list contains `tenant_owner` but trusted authentication context has no tenant
- **THEN** the request returns status `403` before any repository query

#### Scenario: Non-allowed administrative or workspace role calls the public operation

- **WHEN** the role list contains only `superadmin`, `platform_auditor`, `tenant_admin`,
  `workspace_owner`, `workspace_admin`, `workspace_auditor`, or another non-allowed role
- **THEN** the action returns status `403` before any repository query and no role alias broadens it
  to `platform_admin` or `tenant_owner`

### Requirement: Authorized denial queries preserve filter, pagination, and envelope behavior

For an authorized request, the system SHALL pass the effective tenant, path workspace, and existing
optional `requiredDomain`, `actorId`, `from`, and `to` values to
`privilege-domain-repository.mjs::queryDenials`. It SHALL preserve the current limit default and
upper clamp, offset conversion and offset pagination, descending denial-time order, and count/list
query behavior. Both repository queries SHALL apply the same parameterized tenant/workspace and
optional filter predicates. The response SHALL remain
`{ denials: result.denials, total: result.total, limit, offset }`.

C-14 SHALL NOT add input validation, a cursor, a new sort, a filter redesign, a response-envelope
redesign, data masking, or a different pagination algorithm.

#### Scenario: Authorized request supplies all existing filters

- **WHEN** an allowed caller supplies tenant scope, workspace path, required domain, actor, lower
  time, upper time, limit, and offset
- **THEN** the count and list queries use parameterized conjunctive predicates for those effective
  values and the list retains descending denial-time order with the existing limit and offset

#### Scenario: Requested limit exceeds the existing cap

- **WHEN** an allowed caller supplies a limit above the current upper cap
- **THEN** the action returns and queries with the existing clamped limit rather than introducing a
  new validation response

#### Scenario: Matching denial rows are returned

- **WHEN** the authorized tenant/workspace/filter predicate matches stored denial rows
- **THEN** status is `200` and the body contains the existing projected rows, total, effective
  limit, and offset without additional or renamed fields

### Requirement: Historical unknown-workspace behavior remains stable and isolated

The denial-history action SHALL treat `workspaceId` as a historical row predicate, not as a request
to resolve a live workspace resource. After authorization, the system SHALL query
`privilege_domain_denials` with both effective tenant and path workspace predicates. If no rows
match, including when the workspace identifier is unknown to live workspace registries, it SHALL
return status `200` with `denials: []` and `total: 0` under the current limit/offset envelope.

C-14 SHALL NOT add a tenant or workspace registry lookup, status `404`, a different authorization
action, or C-16 scoped-resource-existence semantics. Tenant-owner mismatch authorization SHALL
still terminate before the historical query, so the empty result SHALL NOT provide a cross-tenant
existence oracle.

#### Scenario: Authorized query addresses an unknown workspace

- **WHEN** an allowed caller requests an unknown workspace inside its effective tenant and no
  denial rows match the tenant-plus-workspace predicate
- **THEN** the repository count and list queries complete and the response is status `200` with an
  empty denial array, zero total, and current limit/offset
- **AND** no workspace registry lookup or `404` occurs

#### Scenario: Known workspace has no denial history

- **WHEN** an allowed caller requests a known workspace whose tenant/workspace predicate matches no
  denial rows
- **THEN** the observable response is the same empty `200` as for an unknown workspace

#### Scenario: Cross-tenant owner combines mismatch with unknown workspace

- **WHEN** a `tenant_owner` bound to `ten-a` requests any workspace while explicitly requesting
  `ten-b`
- **THEN** status is `403` before count, list, or workspace lookup and the response reveals no
  denial count or workspace-existence distinction

### Requirement: The canonical GET remains read-only and governance-neutral

Serving the canonical GET SHALL read only the existing denial history required for its count and
list. It SHALL NOT create, update, or delete application data; emit a new audit or denial event;
consume or enforce quota; initiate an assignment or enforcement action; or add a dedicated C-14
metric. C-14 SHALL NOT change existing generic HTTP transport/error behavior or generic request
telemetry.

#### Scenario: Any authorized denial-history query completes

- **WHEN** the canonical GET succeeds with matching or empty history
- **THEN** only denial count/list reads occur and no application mutation, audit write, quota
  operation, assignment, enforcement action, or C-14-specific metric is produced

#### Scenario: Any authorization or validation denial completes

- **WHEN** the action returns its existing `400` or `403`
- **THEN** no denial-history query or new write/audit/quota/metric side effect is triggered by C-14

### Requirement: Fresh boot creates only the denial-history schema dependency

The governance bootstrap SHALL apply one dedicated forward migration that creates
`privilege_domain_denials` with the existing column types, nullability, UUID primary-key default,
denial-time default, actor/domain checks, and unique correlation constraint. It SHALL create only
the directly associated tenant/time, non-null-workspace/time, and required-domain/time indexes.
The migration SHALL be dependency-safe, SHALL use idempotent table/index DDL, and SHALL be registered
in `GOVERNANCE_MIGRATIONS` after its prerequisites.

The bootstrap SHALL NOT register, execute, rewrite, or copy
`094-admin-data-privilege-separation.sql`. The dedicated migration SHALL NOT create or alter
`privilege_domain_assignments`, `privilege_domain_assignment_history`,
`workspace_structural_admin_count`, `api_keys`, or `endpoint_scope_requirements`; SHALL NOT seed
endpoint classifications; and SHALL NOT insert, update, delete, truncate, drop, backfill, or clean
up data.

#### Scenario: Fresh control-plane schema is bootstrapped

- **WHEN** governance bootstrap runs against a fresh isolated schema after its declared
  prerequisites
- **THEN** `privilege_domain_denials`, its existing constraints, and the three directly associated
  indexes exist and the canonical denial count/list query does not fail with missing relation

#### Scenario: Governance bootstrap reruns

- **WHEN** the same dedicated migration is applied a second time
- **THEN** it succeeds without duplicate-object errors, schema drift, backfill, deletion, or row
  mutation

#### Scenario: Correct denial table already contains history

- **WHEN** governance bootstrap runs over a pre-existing correct `privilege_domain_denials` table
  containing sentinel rows
- **THEN** boot succeeds, required named indexes are present, and every pre-existing row remains
  unchanged

#### Scenario: Bootstrap scope is inspected for broad migration effects

- **WHEN** a checker examines the dedicated migration and the registered governance sequence
- **THEN** migration `094`, assignment/history/view objects, API-key and endpoint-scope alterations,
  endpoint seed updates, backfill, deletion, and drop statements are absent

### Requirement: Console audit client uses the authenticated canonical URL

`queryPrivilegeDomainDenials` SHALL use `requestConsoleSessionJson` and SHALL construct
`/v1/workspaces/${encodeURIComponent(activeWorkspaceId)}/privilege-domains/audit`. It SHALL include
the active tenant as `tenantId` and SHALL serialize the existing non-scope filters, limit, and offset
without allowing a free-form workspace query value to replace the path scope. The request SHALL
inherit the console session's bearer authorization, API-version and correlation headers, and
existing refresh behavior.

C-14 SHALL NOT change the transport or URLs of adjacent privilege-domain assignment/list/update
clients.

#### Scenario: Platform administrator page issues an authenticated audit request

- **WHEN** the page has active tenant `ten-a`, active workspace `wrk/a`, current filters, and a
  usable console session
- **THEN** the client calls
  `/v1/workspaces/wrk%2Fa/privilege-domains/audit` with `tenantId=ten-a` and the current filters
- **AND** the request carries the console bearer plus repository-standard API-version and
  correlation headers

#### Scenario: Tenant owner page issues an authenticated audit request

- **WHEN** a same-tenant owner has complete active context
- **THEN** the same canonical authenticated URL is used and the active tenant agrees with trusted
  owner context

#### Scenario: Audit client surface is checked for legacy transport

- **WHEN** a client regression inspects or executes `queryPrivilegeDomainDenials`
- **THEN** it finds no bare audit `fetch`, no `/api/security/privilege-domains/denials`, and no old
  `/api/workspaces/.../audit` request while adjacent assignment functions remain out of scope

### Requirement: Console route and navigation use the exact action-role predicate

The console SHALL mount the existing audit page at `/console/privilege-domain-audit` behind one
shared access predicate whose complete condition is that the trusted session role list contains
`platform_admin` or `tenant_owner`. The navigation item SHALL use the same predicate. The predicate
SHALL NOT include or derive access from `superadmin`, `platform_auditor`, another tenant role, a
workspace role, a generic administration flag, platform inventory access, write permission, or a
plan capability.

When the predicate is false, the navigation item SHALL be absent and direct navigation SHALL render
an access-denied state without mounting the audit page. Consequently, a denied principal SHALL NOT
issue a background denial-history request.

#### Scenario: Platform administrator opens the console audit page

- **WHEN** the session role list contains `platform_admin`
- **THEN** the navigation item is visible and the guarded console route may mount the audit page

#### Scenario: Tenant owner opens the console audit page

- **WHEN** the session role list contains `tenant_owner`
- **THEN** the same navigation item is visible and the guarded route may mount the audit page

#### Scenario: Disallowed principal uses normal navigation

- **WHEN** the role list contains only `superadmin`, `platform_auditor`, another tenant role, or a
  workspace role
- **THEN** the privilege-domain audit navigation item is absent

#### Scenario: Disallowed principal enters the console URL directly

- **WHEN** a disallowed principal navigates directly to `/console/privilege-domain-audit`
- **THEN** an access-denied state is rendered, the audit page is not mounted, and no denial-history
  request is issued

### Requirement: Console audit scope requires active context and clears prior-scope data

For an allowed role, the page SHALL obtain authoritative `activeTenantId` and
`activeWorkspaceId` from console context and SHALL require both before querying. If either is
absent, it SHALL render a context-required state and SHALL NOT issue a denial-history request.

When active tenant or active workspace changes, the page SHALL synchronously clear prior rows,
total, 24-hour row contribution, and row-derived CSV content before starting the new request. If the
current request fails, those data SHALL remain cleared while the error is shown. A response from a
superseded tenant/workspace/filter request SHALL be ignored or aborted and SHALL NOT restore prior
rows or CSV content.

#### Scenario: Active tenant is absent

- **WHEN** an allowed principal opens the page with no active tenant
- **THEN** the page presents a context-required state, displays no prior denial data, and issues no
  audit request

#### Scenario: Active workspace is absent

- **WHEN** an allowed principal has an active tenant but no active workspace
- **THEN** the page presents a workspace-context-required state, displays no prior denial data, and
  issues no audit request

#### Scenario: Active context is complete

- **WHEN** an allowed principal has both active tenant and active workspace
- **THEN** the page requests the canonical route using exactly that tenant/workspace scope and may
  render only the current response rows

#### Scenario: Tenant context changes

- **WHEN** rows for tenant `ten-a` are visible and active tenant changes to `ten-b`
- **THEN** the `ten-a` rows, total, badge contribution, and downloadable CSV records disappear
  before the `ten-b` request starts

#### Scenario: Workspace context changes

- **WHEN** rows for workspace `wrk-a` are visible and active workspace changes to `wrk-b`
- **THEN** the `wrk-a` rows, total, badge contribution, and downloadable CSV records disappear
  before the `wrk-b` request starts

#### Scenario: Current-scope request fails

- **WHEN** a request for the current active tenant/workspace fails
- **THEN** the page shows the error while rows, total, badge contribution, and row-derived CSV from
  every previous scope remain cleared

#### Scenario: Superseded response arrives late

- **WHEN** a previous tenant/workspace/filter request resolves after a newer request has started
- **THEN** the previous response is discarded and cannot repopulate rows, total, badge, or CSV

### Requirement: Existing audit-page features remain bounded and compatible

The console SHALL retain the existing denial table fields, visible required-domain and actor filter
behavior, client forwarding of optional `from`/`to`, offset previous/next pagination, 24-hour badge
calculation, CSV column order and escaping, loading/error/empty states, and current visual structure
except for binding tenant/workspace scope to the shell's active context and adding the required
route/navigation/guard states. C-14 SHALL NOT add filter controls or redesign filters, pagination,
the table, or CSV export.

#### Scenario: User changes an existing non-scope filter

- **WHEN** an allowed user with complete active context changes the existing visible required-domain
  or actor filter
- **THEN** the next canonical request retains active tenant/workspace, resets offset according to
  current page behavior, and uses the selected filter without changing the filter design

#### Scenario: User pages through denial history

- **WHEN** the current total permits a next or previous offset page
- **THEN** the existing controls adjust offset by the current limit and request the same active
  scope and filters

#### Scenario: User exports current denial rows

- **WHEN** current-scope rows are present and the user activates CSV export
- **THEN** the existing CSV columns and escaping contain only those current-scope rows and no row
  from a previous or failed scope

### Requirement: C-14 regression proof is public, layered, deterministic, and local

Automated C-14 proof SHALL include a production-shaped public HTTP black-box test, gateway/runtime
parity checker, unified/generated contract tests, action/repository authorization and isolation
tests, fresh/rerun/pre-existing schema tests over the actual dedicated migration, authenticated
client URL tests, router/navigation/guard tests, context/state/CSV tests, and documentation checks.
The public test SHALL exercise the real control-plane listener seam over loopback with the canonical
runtime-map entry, deterministic verified identities, and a recording database.

The proof SHALL cover both allowed roles, all named denied role classes, pre-query `400`/`403`,
cross-tenant isolation, filter/limit/offset/envelope preservation, unknown-workspace empty `200`,
narrow schema scope, encoded authenticated client URL, denied-role and missing-context no-request
behavior, context/error clearing, and stale response rejection. Tests and checkers SHALL use
ephemeral/local resources only and SHALL NOT require an external network, live/shared database,
APISIX process, deployment, Helm, or Kubernetes.

#### Scenario: Maintainer runs the focused local C-14 suite

- **WHEN** the focused public, parity, contract, authorization/isolation, schema, client, router, and
  page tests run in the local repository
- **THEN** every required success, denial, empty-history, migration-state, URL, guard, and state
  transition is exercised without cluster access

#### Scenario: Public and runtime paths drift

- **WHEN** OpenAPI, a generated artifact, either map, documentation, or the client differs from the
  canonical method/path or introduces an `/api` alias
- **THEN** an automated parity or contract checker fails

#### Scenario: Narrow migration scope drifts

- **WHEN** the dedicated migration or bootstrap sequence includes an excluded `094` object, data
  statement, backfill, deletion, or broad migration registration
- **THEN** an automated schema checker fails

### Requirement: Focused documentation and validators describe the bounded route accurately

Generated public API documentation and focused existing runtime/migration references SHALL describe
the canonical `/v1` GET, exact role boundary, historical empty-workspace behavior, and dedicated
denial-table bootstrap. Documentation SHALL NOT advertise an `/api` alias, claim that C-14 grants
other roles, or claim that the broad `094` migration is executed by governance boot.

OpenAPI validation, public API generation/validation, focused tests, strict OpenSpec validation,
and independent verification and review SHALL pass before handoff. Independent checkers SHALL
review the implementation diff for route parity, authorization/isolation, schema narrowness,
context/CSV isolation, adjacent-finding exclusions, and absence of cluster or agent-asset changes.

#### Scenario: Operator reads the focused runtime and migration references

- **WHEN** an operator consults generated public API docs, the kind runtime reference, or the
  required-migration inventory
- **THEN** the canonical route and dedicated denial-only bootstrap are stated accurately and broad
  migration `094` is not represented as a C-14 boot dependency

#### Scenario: Repository validators run

- **WHEN** a maintainer regenerates public API artifacts and runs OpenAPI/public API validation,
  focused C-14 tests, and
  `openspec validate fix-c14-privilege-domain-audit-route --strict`
- **THEN** all commands pass and a second public API generation is deterministic

#### Scenario: Independent verification and review complete

- **WHEN** one independent verifier reruns the local proof and a different independent reviewer
  evaluates the requirements, diff, and verifier result
- **THEN** both confirm the canonical-only route, exact roles, pre-query isolation, stable empty
  history, narrow idempotent bootstrap, client/guard/context behavior, focused docs, and bounded diff
  without using Kubernetes or modifying loop/evidence/agent assets
