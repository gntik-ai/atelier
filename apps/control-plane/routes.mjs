// Seed route table for the control-plane server (Phase 1 — proven routes).
//
// These are the action mappings already validated end-to-end in tests/env
// (9 families). They exist to prove the server engine — JWT validation,
// callerContext from verified claims, DI, dispatch — against the real kind
// stack BEFORE the full console-driven route map (route-map.json, produced by
// the discovery agent) is merged in Phase 2.
//
// `module` paths resolve under /repo (the repo subset COPYd into the image).
const PO = '/repo/packages/provisioning-orchestrator/src/actions';

export const routes = [
  // Platform-wide Knative dependency status. This route is deliberately GET-only: the selected
  // mode and readiness record come from installer/chart configuration, never a tenant API write.
  { method: 'GET', path: '/v1/platform/runtime/knative', localHandler: 'getKnativeRuntimeStatus', auth: 'knative_status' },
  // plan catalog (superadmin)
  { method: 'GET',  path: '/v1/plans', module: `${PO}/plan-list.mjs`, export: 'main',
    invoke: 'callercontext-overrides', deps: ['db'], auth: 'superadmin', mergeQueryIntoParams: true },
  { method: 'POST', path: '/v1/plans', module: `${PO}/plan-create.mjs`, export: 'main',
    invoke: 'callercontext-overrides', deps: ['db'], auth: 'superadmin', mergeBodyIntoParams: true },
  { method: 'POST', path: '/v1/plans/{planId}/lifecycle', module: `${PO}/plan-lifecycle.mjs`, export: 'main',
    invoke: 'callercontext-overrides', deps: ['db'], auth: 'superadmin', mergeBodyIntoParams: true },
  { method: 'DELETE', path: '/v1/plans/{planId}', module: `${PO}/plan-delete.mjs`, export: 'main',
    invoke: 'callercontext-overrides', deps: ['db'], auth: 'superadmin' },
  { method: 'GET',  path: '/v1/plans/change-history', module: `${PO}/plan-change-history-query.mjs`, export: 'main',
    invoke: 'callercontext-overrides', deps: ['db'], auth: 'superadmin', mergeQueryIntoParams: true },

  // quota dimension catalog (superadmin)
  { method: 'GET',  path: '/v1/quota-dimensions', module: `${PO}/quota-dimension-catalog-list.mjs`, export: 'main',
    invoke: 'callercontext-overrides', deps: ['db'], auth: 'superadmin' },

  // tenant effective entitlements (tenant-scoped; superadmin may cross-scope)
  { method: 'GET',  path: '/v1/tenant/entitlements', module: `${PO}/tenant-effective-entitlements-get.mjs`, export: 'main',
    invoke: 'callercontext-overrides', deps: ['db'], auth: 'tenant_owner', mergeQueryIntoParams: true },

  // own-tenant plan API (tenant-scoped; operators read their OWN plan — no superadmin collection needed)
  // /v1/tenant/plan/effective-entitlements — full entitlement + consumption profile for the operator's tenant
  { method: 'GET',  path: '/v1/tenant/plan/effective-entitlements', module: `${PO}/tenant-effective-entitlements-get.mjs`, export: 'main',
    invoke: 'callercontext-overrides', deps: ['db'], auth: 'tenant_owner', mergeQueryIntoParams: true },
  // /v1/tenant/effective-capabilities — plan-derived capability flags for the operator's tenant
  { method: 'GET',  path: '/v1/tenant/effective-capabilities', module: `${PO}/tenant-effective-capabilities-get.mjs`, export: 'main',
    invoke: 'callercontext-overrides', deps: ['db'], auth: 'tenant_owner', mergeQueryIntoParams: true },

  // workspace sub-quotas (tenant-scoped write + list)
  { method: 'POST', path: '/v1/workspace-sub-quotas', module: `${PO}/workspace-sub-quota-set.mjs`, export: 'main',
    invoke: 'callercontext-overrides', deps: ['db'], auth: 'tenant_owner', mergeBodyIntoParams: true },
  { method: 'GET',  path: '/v1/workspace-sub-quotas', module: `${PO}/workspace-sub-quota-list.mjs`, export: 'main',
    invoke: 'callercontext-overrides', deps: ['db'], auth: 'tenant_owner', mergeQueryIntoParams: true },

  // ---- domain B: tenant lifecycle + user management (LOCAL handlers) --------
  // Real implementations (kc-admin + tenant-store) of what the repo stubs.
  // Console whoami (any authenticated principal) — was referenced by the SPA but unrouted (404).
  { method: 'GET',  path: '/v1/console/session', localHandler: 'consoleSession', auth: 'authenticated' },
  { method: 'POST', path: '/v1/tenants', localHandler: 'createTenant', auth: 'superadmin' },
  { method: 'GET',  path: '/v1/tenants', localHandler: 'listTenants', auth: 'superadmin' },
  { method: 'GET',  path: '/v1/tenants/{tenantId}', localHandler: 'getTenant', auth: 'authenticated' },
  { method: 'DELETE', path: '/v1/tenants/{tenantId}', localHandler: 'deleteTenant', auth: 'superadmin' },
  { method: 'POST', path: '/v1/tenants/{tenantId}/purge', localHandler: 'purgeTenant', auth: 'superadmin' },
  { method: 'GET',  path: '/v1/tenants/{tenantId}/environments', localHandler: 'listEnvironments', auth: 'authenticated' },
  // Tenant configuration export (#683): a READ-ONLY snapshot of the tenant's portable configuration
  // (tenant metadata, its workspaces with slugs/environments/databases, and resolved quota limits).
  // Own-tenant gated (cross-tenant → 404, no existence leak). Deliberately EXCLUDES every secret,
  // credential, BYOK key, and service-account material — only non-sensitive config is emitted.
  { method: 'POST', path: '/v1/tenants/{tenantId}/exports', localHandler: 'exportTenantConfiguration', auth: 'authenticated' },
  { method: 'POST', path: '/v1/tenants/{tenantId}/users', localHandler: 'createTenantUser', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/tenants/{tenantId}/users', localHandler: 'listTenantUsers', auth: 'authenticated' },
  // Invite-by-email members (#759): the public API route is tenant-addressed, while a workspace
  // invite carries body.workspaceId. The local handler persists a masked/hash invitation record and
  // authorizes tenant owner/admin or workspace owner/admin for the verified target workspace.
  { method: 'POST', path: '/v1/tenants/{tenantId}/invitations', localHandler: 'createInvitation', auth: 'authenticated' },

  // project auth-config (#568): owner enables auth methods + social IdPs for THEIR OWN project's
  // realm (handler authorizes own-tenant; cross-tenant → 403). Were NO_ROUTE (KC-admin only).
  { method: 'GET',    path: '/v1/tenants/{tenantId}/auth-config', localHandler: 'getAuthConfig', auth: 'authenticated' },
  { method: 'PUT',    path: '/v1/tenants/{tenantId}/auth-config', localHandler: 'setAuthConfig', auth: 'authenticated' },
  { method: 'PUT',    path: '/v1/tenants/{tenantId}/auth-config/identity-providers/{alias}', localHandler: 'setSocialProvider', auth: 'authenticated' },
  { method: 'DELETE', path: '/v1/tenants/{tenantId}/auth-config/identity-providers/{alias}', localHandler: 'deleteSocialProvider', auth: 'authenticated' },

  // ---- domain B: workspaces (LOCAL) ----------------------------------------
  { method: 'POST', path: '/v1/tenants/{tenantId}/workspaces', localHandler: 'createWorkspace', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/tenants/{tenantId}/workspaces', localHandler: 'listTenantWorkspaces', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/workspaces', localHandler: 'listWorkspaces', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/workspaces/{workspaceId}', localHandler: 'getWorkspace', auth: 'authenticated' },
  // Workspace realtime config (#788): ConsoleRealtimePage calls this workspace-addressed route.
  // The handler verifies the workspace belongs to the caller's tenant and returns the exact
  // metadata shape the page consumes. An owned workspace with no realtime channel rows returns
  // 200 + empty dataSources/realtime:false, not 404 NO_ROUTE.
  { method: 'GET',  path: '/v1/workspaces/{workspaceId}/realtime', localHandler: 'getWorkspaceRealtime', auth: 'authenticated' },
  // Workspace external applications + federation providers (#781): the public route catalog and
  // `/console/auth` already advertise these routes. Serve them in the kind control-plane with a
  // durable workspace-scoped JSONB registry so list/create/update/provider actions reach handlers
  // instead of falling through to 404 NO_ROUTE. The handlers own tenant read/write gates.
  { method: 'GET',  path: '/v1/workspaces/{workspaceId}/applications', localHandler: 'listExternalApplications', auth: 'authenticated' },
  { method: 'POST', path: '/v1/workspaces/{workspaceId}/applications', localHandler: 'createExternalApplication', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/workspaces/{workspaceId}/applications/templates', localHandler: 'listExternalApplicationStarterTemplates', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/workspaces/{workspaceId}/applications/{applicationId}', localHandler: 'getExternalApplication', auth: 'authenticated' },
  { method: 'PUT',  path: '/v1/workspaces/{workspaceId}/applications/{applicationId}', localHandler: 'updateExternalApplication', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/workspaces/{workspaceId}/applications/{applicationId}/federation/providers', localHandler: 'listExternalApplicationFederatedProviders', auth: 'authenticated' },
  { method: 'POST', path: '/v1/workspaces/{workspaceId}/applications/{applicationId}/federation/providers', localHandler: 'createExternalApplicationFederatedProvider', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/workspaces/{workspaceId}/applications/{applicationId}/federation/providers/{providerId}', localHandler: 'getExternalApplicationFederatedProvider', auth: 'authenticated' },
  { method: 'PUT',  path: '/v1/workspaces/{workspaceId}/applications/{applicationId}/federation/providers/{providerId}', localHandler: 'updateExternalApplicationFederatedProvider', auth: 'authenticated' },
  // Single-workspace cascading teardown (#562): owner-of-the-workspace's-tenant OR superadmin
  // (handler authorizes own-tenant; cross-tenant → 404). The per-workspace counterpart of
  // POST /v1/tenants/{tenantId}/purge — drops the wsdb_* DB, deletes the bucket(s)/topic(s), and
  // removes the workspace + its service-account/api-key rows. Was NO_ROUTE (only tenant purge cascaded).
  { method: 'DELETE', path: '/v1/workspaces/{workspaceId}', localHandler: 'deleteWorkspace', auth: 'authenticated' },
  // Environment promotion (#641, completes #503/#502): promote a source workspace's promotable
  // definition (its registered functions) into a target workspace in a DIFFERENT environment of the
  // same tenant. Copies the function registry only — never secrets/credentials/service-accounts
  // (stage-scoped) and never the source. Handler authorizes own-tenant on BOTH ends (404 on a
  // cross-tenant/missing source or target — no existence leak).
  { method: 'POST', path: '/v1/workspaces/{workspaceId}/promotions', localHandler: 'promoteWorkspace', auth: 'authenticated' },
  // Workspace clone (#683): reproduce a source workspace's resources into a NEW target workspace in
  // the SAME tenant. Own-tenant gated on the source (404 cross-tenant). Copies the function-definition
  // registry per the clone policy; NEVER copies secrets/credentials/service-accounts
  // (resetCredentialReferences). A clone to (or from) another tenant is impossible — the new target
  // is always created under the source's verified tenant.
  { method: 'POST', path: '/v1/workspaces/{workspaceId}/clone', localHandler: 'cloneWorkspace', auth: 'authenticated' },

  // Workspace documentation / developer onboarding (#795): route the console documentation page
  // to the real workspace-docs action instead of leaving the path as NO_ROUTE. The action owns
  // workspace role checks for note mutations; this server supplies the verified console identity
  // and the shared Postgres client.
  { method: 'GET', path: '/v1/workspaces/{workspaceId}/docs', module: '/repo/packages/workspace-docs-service/actions/workspace-docs.mjs', export: 'main',
    invoke: 'params-auth-overrides', deps: ['db'], auth: 'authenticated' },
  { method: 'POST', path: '/v1/workspaces/{workspaceId}/docs/notes', module: '/repo/packages/workspace-docs-service/actions/workspace-docs.mjs', export: 'main',
    invoke: 'params-auth-overrides', deps: ['db'], auth: 'authenticated' },
  { method: 'PUT', path: '/v1/workspaces/{workspaceId}/docs/notes/{noteId}', module: '/repo/packages/workspace-docs-service/actions/workspace-docs.mjs', export: 'main',
    invoke: 'params-auth-overrides', deps: ['db'], auth: 'authenticated' },
  { method: 'DELETE', path: '/v1/workspaces/{workspaceId}/docs/notes/{noteId}', module: '/repo/packages/workspace-docs-service/actions/workspace-docs.mjs', export: 'main',
    invoke: 'params-auth-overrides', deps: ['db'], auth: 'authenticated' },

  // ---- domain B: service accounts + credentials (LOCAL) --------------------
  { method: 'POST', path: '/v1/workspaces/{workspaceId}/service-accounts', localHandler: 'createServiceAccount', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/workspaces/{workspaceId}/service-accounts', localHandler: 'listServiceAccounts', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}', localHandler: 'getServiceAccount', auth: 'authenticated' },
  { method: 'POST', path: '/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-issuance', localHandler: 'issueCredential', auth: 'authenticated' },
  { method: 'POST', path: '/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-rotations', localHandler: 'rotateCredential', auth: 'authenticated' },
  { method: 'POST', path: '/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-revocations', localHandler: 'revokeCredential', auth: 'authenticated' },
  // Granular service-account delete (#687): revoke only DISABLES the KC client + flips PG
  // status='revoked' (the row + client persist forever, so revoked SAs accumulate in both stores).
  // DELETE fully removes the service account — its Keycloak client AND its PG row — so they no longer
  // accumulate and the SA disappears from list results. Was NO_ROUTE (404). Idempotent: a 2nd DELETE
  // (or a GET) on the removed SA → 404 SA_NOT_FOUND. Works for an active OR a revoked SA.
  { method: 'DELETE', path: '/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}', localHandler: 'deleteServiceAccount', auth: 'authenticated' },

  // ---- domain B: workspace data plane (DB provisioning + function registry) --
  { method: 'POST', path: '/v1/workspaces/{workspaceId}/database', localHandler: 'provisionDatabase', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/workspaces/{workspaceId}/database', localHandler: 'getDatabase', auth: 'authenticated' },
  { method: 'POST', path: '/v1/workspaces/{workspaceId}/database/credential-rotations', localHandler: 'rotateDatabaseCredential', auth: 'authenticated' },
  { method: 'POST', path: '/v1/workspaces/{workspaceId}/functions', localHandler: 'registerFunction', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/workspaces/{workspaceId}/functions', localHandler: 'listFunctions', auth: 'authenticated' },

  // ---- domain B: fine-grained IAM (platform admin; realmId in path) ---------
  // Realm CRUD (fix-iam-route-wiring #598): list is superadmin-only (every tenant realm);
  // get/update are owner-of-realm OR superadmin (handler authorizes). Were NO_ROUTE (404).
  { method: 'GET',  path: '/v1/iam/realms', localHandler: 'iamListRealms', auth: 'superadmin' },
  { method: 'GET',  path: '/v1/iam/realms/{realmId}', localHandler: 'iamGetRealm', auth: 'authenticated' },
  { method: 'PUT',  path: '/v1/iam/realms/{realmId}', localHandler: 'iamUpdateRealm', auth: 'authenticated' },
  // GET users: owner-of-realm OR superadmin (handler authorizes via authorizeRealmManage)
  // so a tenant_owner can list its OWN app end-users (BUG-ENDUSER-OWNER-403). Cross-tenant
  // is denied in the handler.
  { method: 'GET',  path: '/v1/iam/realms/{realmId}/users', localHandler: 'iamListUsers', auth: 'authenticated' },
  // GET one user: owner-of-realm OR superadmin (handler authorizes). Was NO_ROUTE (404).
  { method: 'GET',  path: '/v1/iam/realms/{realmId}/users/{userId}', localHandler: 'iamGetUser', auth: 'authenticated' },
  { method: 'POST', path: '/v1/iam/realms/{realmId}/users', localHandler: 'iamCreateUser', auth: 'superadmin' },
  // app end-user lifecycle (#567): owner-of-realm OR superadmin (handler authorizes); were NO_ROUTE.
  { method: 'DELETE', path: '/v1/iam/realms/{realmId}/users/{userId}', localHandler: 'iamDeleteUser', auth: 'authenticated' },
  { method: 'PATCH',  path: '/v1/iam/realms/{realmId}/users/{userId}/status', localHandler: 'iamSetUserStatus', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/iam/realms/{realmId}/roles', localHandler: 'iamListRoles', auth: 'superadmin' },
  { method: 'POST', path: '/v1/iam/realms/{realmId}/roles', localHandler: 'iamCreateRole', auth: 'superadmin' },
  // GET/DELETE one role by name (fix-iam-route-wiring #598): were NO_ROUTE (404).
  { method: 'GET',    path: '/v1/iam/realms/{realmId}/roles/{roleName}', localHandler: 'iamGetRole', auth: 'superadmin' },
  { method: 'DELETE', path: '/v1/iam/realms/{realmId}/roles/{roleName}', localHandler: 'iamDeleteRole', auth: 'superadmin' },
  { method: 'GET',  path: '/v1/iam/realms/{realmId}/groups', localHandler: 'iamListGroups', auth: 'superadmin' },
  { method: 'POST', path: '/v1/iam/realms/{realmId}/groups', localHandler: 'iamCreateGroup', auth: 'superadmin' },
  { method: 'GET',  path: '/v1/iam/realms/{realmId}/clients', localHandler: 'iamListClients', auth: 'superadmin' },
  // fine-grained: role assignment to users + group membership
  { method: 'GET',    path: '/v1/iam/realms/{realmId}/users/{userId}/roles', localHandler: 'iamListUserRoles', auth: 'superadmin' },
  { method: 'POST',   path: '/v1/iam/realms/{realmId}/users/{userId}/role-assignments', localHandler: 'iamAssignUserRoles', auth: 'superadmin' },
  { method: 'DELETE', path: '/v1/iam/realms/{realmId}/users/{userId}/role-assignments', localHandler: 'iamRemoveUserRoles', auth: 'superadmin' },
  { method: 'GET',    path: '/v1/iam/realms/{realmId}/users/{userId}/groups', localHandler: 'iamListUserGroups', auth: 'superadmin' },
  { method: 'PUT',    path: '/v1/iam/realms/{realmId}/users/{userId}/groups/{groupId}', localHandler: 'iamAddUserToGroup', auth: 'superadmin' },
  { method: 'DELETE', path: '/v1/iam/realms/{realmId}/users/{userId}/groups/{groupId}', localHandler: 'iamRemoveUserFromGroup', auth: 'superadmin' },
  { method: 'GET',    path: '/v1/iam/realms/{realmId}/groups/{groupId}/members', localHandler: 'iamListGroupMembers', auth: 'superadmin' },

  // ---- scope-enforcement denial ingest (#557) ------------------------------
  // Sidecar for the gateway scope-enforcement plugin: records denials into
  // scope_enforcement_denials so the scope-enforcement audit query returns them.
  { method: 'POST', path: '/v1/internal/scope-enforcement/denials', localHandler: 'recordScopeEnforcementDenial', auth: 'superadmin' },

  // ---- domain B: console metrics (Quotas + Observability) -------------------
  // Synthesized from real entitlements/consumption (limits+usage); series/audit
  // are empty (no metrics data plane / audit store deployed).
  { method: 'GET',  path: '/v1/metrics/tenants/{tenantId}/quotas', localHandler: 'metricsTenantQuotas', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/metrics/tenants/{tenantId}/overview', localHandler: 'metricsTenantOverview', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/metrics/tenants/{tenantId}/usage', localHandler: 'metricsTenantUsage', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/metrics/tenants/{tenantId}/series', localHandler: 'metricsTenantSeries', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/metrics/tenants/{tenantId}/audit-records', localHandler: 'metricsTenantAudit', auth: 'authenticated' },
  { method: 'POST', path: '/v1/metrics/tenants/{tenantId}/audit-exports', localHandler: 'metricsTenantAuditExport', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/metrics/workspaces/{workspaceId}/quotas', localHandler: 'metricsWorkspaceQuotas', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/metrics/workspaces/{workspaceId}/overview', localHandler: 'metricsWorkspaceOverview', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/metrics/workspaces/{workspaceId}/usage', localHandler: 'metricsWorkspaceUsage', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/metrics/workspaces/{workspaceId}/series', localHandler: 'metricsWorkspaceSeries', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/metrics/workspaces/{workspaceId}/audit-records', localHandler: 'metricsWorkspaceAudit', auth: 'authenticated' },
  { method: 'POST', path: '/v1/metrics/workspaces/{workspaceId}/audit-exports', localHandler: 'metricsWorkspaceAuditExport', auth: 'authenticated' },

  // ---- domain B: PostgreSQL data browser (REAL pg catalogs, read-only) ------
  { method: 'GET', path: '/v1/postgres/databases', localHandler: 'pgListDatabases', auth: 'authenticated' },
  { method: 'GET', path: '/v1/postgres/databases/{db}/schemas', localHandler: 'pgListSchemas', auth: 'authenticated' },
  { method: 'GET', path: '/v1/postgres/databases/{db}/schemas/{schema}/tables', localHandler: 'pgListTables', auth: 'authenticated' },
  { method: 'GET', path: '/v1/postgres/databases/{db}/schemas/{schema}/tables/{table}/columns', localHandler: 'pgColumns', auth: 'authenticated' },
  { method: 'GET', path: '/v1/postgres/databases/{db}/schemas/{schema}/tables/{table}/indexes', localHandler: 'pgIndexes', auth: 'authenticated' },
  { method: 'GET', path: '/v1/postgres/databases/{db}/schemas/{schema}/tables/{table}/policies', localHandler: 'pgPolicies', auth: 'authenticated' },
  { method: 'GET', path: '/v1/postgres/databases/{db}/schemas/{schema}/tables/{table}/security', localHandler: 'pgSecurity', auth: 'authenticated' },
  { method: 'GET', path: '/v1/postgres/databases/{db}/schemas/{schema}/views', localHandler: 'pgViews', auth: 'authenticated' },
  { method: 'GET', path: '/v1/postgres/databases/{db}/schemas/{schema}/materialized-views', localHandler: 'pgMatViews', auth: 'authenticated' },
  // Table data export / import (#683). WORKSPACE-addressed; the database must be owned by the
  // caller's workspace (404 otherwise, no existence leak). SQL-injection-safe: schema/table/column
  // identifiers are validated against information_schema for THAT database and double-quote-escaped
  // (never string-interpolated raw), and every value is bound via a parameter placeholder.
  { method: 'POST', path: '/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/exports', localHandler: 'pgDataExport', auth: 'authenticated' },
  { method: 'POST', path: '/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/imports', localHandler: 'pgDataImport', auth: 'authenticated' },

  // ---- domain B: MongoDB document store (REAL mongodb driver) ---------------
  { method: 'GET',  path: '/v1/mongo/databases', localHandler: 'mongoListDatabases', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/mongo/databases/{db}/collections', localHandler: 'mongoListCollections', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/mongo/databases/{db}/collections/{col}', localHandler: 'mongoCollectionDetail', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/mongo/databases/{db}/collections/{col}/indexes', localHandler: 'mongoIndexes', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/mongo/databases/{db}/views', localHandler: 'mongoViews', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/mongo/workspaces/{workspaceId}/data/{db}/collections/{col}/documents', localHandler: 'mongoDocuments', auth: 'authenticated' },
  // Document export / import (#683). WORKSPACE-addressed; ownership-gated on the workspace (404
  // cross-tenant). Export reads documents stamped with BOTH the workspace's tenantId AND its
  // workspaceId (the same scope mongoDocuments reads, #632/#661) — never another workspace's docs.
  // Import stamps that SAME verified scope onto every inserted document, ignoring any tenantId/
  // workspaceId in the request body, so an import can never write into another tenant/workspace.
  { method: 'POST', path: '/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/exports', localHandler: 'mongoDataExport', auth: 'authenticated' },
  { method: 'POST', path: '/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/imports', localHandler: 'mongoDataImport', auth: 'authenticated' },
  // engine-dispatched DB provisioning (postgresql | mongodb) — the SPA wizard target
  { method: 'POST', path: '/v1/workspaces/{workspaceId}/databases', localHandler: 'provisionDatabaseGeneric', auth: 'authenticated' },

  // ---- domain B: object storage (REAL SeaweedFS/S3 via SigV4) ---------------
  { method: 'GET',  path: '/v1/storage/buckets', localHandler: 'storageListBuckets', auth: 'authenticated' },
  { method: 'POST', path: '/v1/storage/workspaces/{workspaceId}/buckets', localHandler: 'storageProvisionBucket', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/storage/workspaces/{workspaceId}/usage', localHandler: 'storageWorkspaceUsage', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/storage/buckets/{bucketId}/objects', localHandler: 'storageListObjects', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/storage/buckets/{bucketId}/objects/{objectKey}/metadata', localHandler: 'storageObjectMetadata', auth: 'authenticated' },
  // Per-bucket delete (#676): remove ONE bucket the caller owns (was NO_ROUTE — the only way to
  // remove a bucket was deleting the whole workspace or purging the tenant). Ownership-gated like
  // object I/O (non-owner → 404). Drops the physical bucket + registry row + scoped credentials.
  { method: 'DELETE', path: '/v1/storage/buckets/{bucketId}', localHandler: 'storageDeleteBucket', auth: 'authenticated' },
  // Object I/O — upload/download/delete a single object (#500: previously NO_ROUTE).
  { method: 'PUT',    path: '/v1/storage/buckets/{bucketId}/objects/{objectKey}', localHandler: 'storagePutObject', auth: 'authenticated' },
  // GET supports HTTP Range / partial reads (#676): a `Range: bytes=...` request returns 206
  // Partial Content with Content-Range; no Range returns the full body (200). Same path.
  { method: 'GET',    path: '/v1/storage/buckets/{bucketId}/objects/{objectKey}', localHandler: 'storageGetObject', auth: 'authenticated' },
  { method: 'DELETE', path: '/v1/storage/buckets/{bucketId}/objects/{objectKey}', localHandler: 'storageDeleteObject', auth: 'authenticated' },
  // Presigned/temporary URL issuance (#676): a time-limited, scope-limited SigV4 query-presigned
  // URL for ONE object operation (download GET / upload PUT). Ownership-gated; the URL grants no
  // cross-bucket/-tenant access. A DISTINCT sub-path (not `?presign`) — query strings are ignored.
  { method: 'POST',   path: '/v1/storage/buckets/{bucketId}/objects/{objectKey}/presign', localHandler: 'storagePresignObject', auth: 'authenticated' },
  // Multipart / resumable upload (#676): initiate → upload-part(s) → complete (or abort). DISTINCT
  // sub-paths (a PUT `?uploads` is a plain PUT here). Every route re-gates bucket ownership; the
  // uploadId is opaque/S3-managed. Complete re-applies the per-workspace byte quota (no bypass).
  { method: 'POST',   path: '/v1/storage/buckets/{bucketId}/objects/{objectKey}/multipart', localHandler: 'storageMultipartInitiate', auth: 'authenticated' },
  { method: 'PUT',    path: '/v1/storage/buckets/{bucketId}/objects/{objectKey}/multipart/{uploadId}/parts/{partNumber}', localHandler: 'storageMultipartUploadPart', auth: 'authenticated' },
  { method: 'POST',   path: '/v1/storage/buckets/{bucketId}/objects/{objectKey}/multipart/{uploadId}/complete', localHandler: 'storageMultipartComplete', auth: 'authenticated' },
  { method: 'DELETE', path: '/v1/storage/buckets/{bucketId}/objects/{objectKey}/multipart/{uploadId}', localHandler: 'storageMultipartAbort', auth: 'authenticated' },
  // Per-bucket storage credential rotate/revoke (#673). Bucket-keyed (consistent with the
  // object routes above); kind-only, NOT in the public route catalog (which carries only
  // storage OBJECT routes), so there is no SDK codegen drift. Ownership-gated like object I/O.
  { method: 'POST',   path: '/v1/storage/buckets/{bucketId}/credentials', localHandler: 'storageRotateCredential', auth: 'authenticated' },
  { method: 'DELETE', path: '/v1/storage/buckets/{bucketId}/credentials', localHandler: 'storageRevokeCredential', auth: 'authenticated' },
  // Bucket export / import (#683, data-export-import-clone). Bounded, synchronous, inline-artifact
  // object movement, ownership-gated on BOTH the workspace AND the bucket (a workspace/bucket the
  // caller does not own → 404, no existence leak). Export returns a manifest with inline base64
  // object bodies (per-object + total size caps → 413). The manifest is ALSO persisted as a reserved
  // `.falcone/exports/<manifestId>.json` object in the SAME bucket so GET .../exports/{manifestId}
  // can read it back (no new table, naturally tenant/bucket-scoped). Import accepts that same manifest
  // shape, re-validates every entry against the TARGET tenant (path-traversal / cross-tenant /
  // protected-key → skipped), and PUTs decoded bodies into the owned target bucket.
  { method: 'POST', path: '/v1/storage/workspaces/{workspaceId}/buckets/{bucketId}/exports', localHandler: 'storageBucketExport', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/storage/workspaces/{workspaceId}/buckets/{bucketId}/exports/{manifestId}', localHandler: 'storageBucketExportManifestGet', auth: 'authenticated' },
  { method: 'POST', path: '/v1/storage/workspaces/{workspaceId}/buckets/{bucketId}/imports', localHandler: 'storageBucketImport', auth: 'authenticated' },

  // ---- domain B: Functions (REAL execution via ephemeral k8s Jobs) ----------
  { method: 'GET',  path: '/v1/functions/workspaces/{workspaceId}/inventory', localHandler: 'fnInventory', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/functions/workspaces/{workspaceId}/actions', localHandler: 'fnListActions', auth: 'authenticated' },
  // Function-definition export / import (#683). Export emits a self-contained bundle (source, runtime,
  // entrypoint, parameters, metadata) for ONE action the caller's tenant owns, or for every action
  // in a package within an owned workspace. Import re-scopes the bundle to the caller's verified
  // tenant/workspace (rejecting any cross-scope bundle, IMPORT_SCOPE_VIOLATION) and upserts the
  // fn_action registry row(s). Ownership-gated (action by tenant; workspace by ownedWorkspace → 404).
  { method: 'GET',  path: '/v1/functions/actions/{resourceId}/definition-export', localHandler: 'fnDefinitionExport', auth: 'authenticated' },
  { method: 'POST', path: '/v1/functions/workspaces/{workspaceId}/definition-imports', localHandler: 'fnDefinitionImport', auth: 'authenticated' },
  { method: 'POST', path: '/v1/functions/workspaces/{workspaceId}/package-definition-imports', localHandler: 'fnPackageDefinitionImport', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/functions/workspaces/{workspaceId}/packages/{packageName}/definition-export', localHandler: 'fnPackageDefinitionExport', auth: 'authenticated' },
  // Workspace secrets-as-a-service backed by OpenBao (add-vault-secret-consumption, #612; console
  // convergence add-console-secrets-management, #723). POST = create-only (409 on conflict),
  // PUT = replace — matching the published 5 function_workspace_secret catalog routes.
  { method: 'POST',   path: '/v1/functions/workspaces/{workspaceId}/secrets', localHandler: 'secretSet', auth: 'authenticated' },
  { method: 'GET',    path: '/v1/functions/workspaces/{workspaceId}/secrets', localHandler: 'secretList', auth: 'authenticated' },
  { method: 'GET',    path: '/v1/functions/workspaces/{workspaceId}/secrets/{secretName}', localHandler: 'secretGet', auth: 'authenticated' },
  { method: 'PUT',    path: '/v1/functions/workspaces/{workspaceId}/secrets/{secretName}', localHandler: 'secretReplace', auth: 'authenticated' },
  { method: 'DELETE', path: '/v1/functions/workspaces/{workspaceId}/secrets/{secretName}', localHandler: 'secretDelete', auth: 'authenticated' },
  { method: 'POST', path: '/v1/functions/actions', localHandler: 'fnDeploy', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/functions/actions/{actionId}', localHandler: 'fnActionDetail', auth: 'authenticated' },
  { method: 'PATCH', path: '/v1/functions/actions/{actionId}', localHandler: 'fnDeploy', auth: 'authenticated' },
  { method: 'DELETE', path: '/v1/functions/actions/{actionId}', localHandler: 'fnDelete', auth: 'authenticated' },
  { method: 'POST', path: '/v1/functions/actions/{actionId}/invocations', localHandler: 'fnInvoke', auth: 'authenticated' },
  { method: 'POST', path: '/v1/functions/actions/{actionId}/rollback', localHandler: 'fnRollback', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/functions/actions/{actionId}/versions', localHandler: 'fnVersions', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/functions/actions/{actionId}/activations', localHandler: 'fnActivations', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/functions/actions/{actionId}/activations/{activationId}', localHandler: 'fnActivation', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/functions/actions/{actionId}/activations/{activationId}/logs', localHandler: 'fnActivationLogs', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/functions/actions/{actionId}/activations/{activationId}/result', localHandler: 'fnActivationResult', auth: 'authenticated' },
  { method: 'POST', path: '/v1/functions/actions/{actionId}/activations/{activationId}/rerun', localHandler: 'fnActivationRerun', auth: 'authenticated' },

  // ---- domain B: Events / Kafka (REAL kafkajs; PLAINTEXT broker) ------------
  { method: 'GET',  path: '/v1/events/workspaces/{workspaceId}/inventory', localHandler: 'eventsInventory', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/events/workspaces/{workspaceId}/topics', localHandler: 'eventsListTopics', auth: 'authenticated' },
  { method: 'POST', path: '/v1/events/workspaces/{workspaceId}/topics', localHandler: 'eventsProvisionTopic', auth: 'authenticated' },
  { method: 'POST', path: '/v1/events/workspaces/{workspaceId}/topics/{topic}/publish', localHandler: 'eventsWorkspaceTopicPublish', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/events/workspaces/{workspaceId}/topics/{topic}/messages', localHandler: 'eventsWorkspaceTopicMessages', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/events/topics/{topicId}', localHandler: 'eventsTopicDetail', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/events/topics/{topicId}/access', localHandler: 'eventsTopicAccess', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/events/topics/{topicId}/metadata', localHandler: 'eventsTopicMetadata', auth: 'authenticated' },
  { method: 'POST', path: '/v1/events/topics/{topicId}/publish', localHandler: 'eventsTopicPublish', auth: 'authenticated' },
  { method: 'GET',  path: '/v1/events/topics/{topicId}/stream', localHandler: 'eventsTopicStream', auth: 'authenticated', stream: true },

  // ---- domain B: Webhooks (outbound events management plane) ----------------
  // Wires the code-complete webhook-engine management action onto the runtime
  // (#643). All routes dispatch to the single `webhookManage` local handler,
  // which wraps webhook-management.mjs::main and parses the sub-path itself.
  // Delivery EXECUTION (dispatcher/worker/retry on platform events) is follow-up.
  { method: 'GET',    path: '/v1/webhooks/event-types', localHandler: 'webhookManage', auth: 'authenticated' },
  { method: 'POST',   path: '/v1/webhooks/subscriptions', localHandler: 'webhookManage', auth: 'authenticated' },
  { method: 'GET',    path: '/v1/webhooks/subscriptions', localHandler: 'webhookManage', auth: 'authenticated' },
  { method: 'GET',    path: '/v1/webhooks/subscriptions/{subscriptionId}', localHandler: 'webhookManage', auth: 'authenticated' },
  { method: 'PATCH',  path: '/v1/webhooks/subscriptions/{subscriptionId}', localHandler: 'webhookManage', auth: 'authenticated' },
  { method: 'DELETE', path: '/v1/webhooks/subscriptions/{subscriptionId}', localHandler: 'webhookManage', auth: 'authenticated' },
  { method: 'POST',   path: '/v1/webhooks/subscriptions/{subscriptionId}/pause', localHandler: 'webhookManage', auth: 'authenticated' },
  { method: 'POST',   path: '/v1/webhooks/subscriptions/{subscriptionId}/resume', localHandler: 'webhookManage', auth: 'authenticated' },
  { method: 'POST',   path: '/v1/webhooks/subscriptions/{subscriptionId}/rotate-secret', localHandler: 'webhookManage', auth: 'authenticated' },
  { method: 'GET',    path: '/v1/webhooks/subscriptions/{subscriptionId}/deliveries', localHandler: 'webhookManage', auth: 'authenticated' },
  { method: 'GET',    path: '/v1/webhooks/subscriptions/{subscriptionId}/deliveries/{deliveryId}', localHandler: 'webhookManage', auth: 'authenticated' },

  // Workspace-addressed form (primary): workspace from the PATH (consistent with
  // functions/storage/events), authorized against the caller's verified tenant in
  // the handler. Reachable by a tenant_owner (whose JWT carries no workspace_id)
  // and rides the existing gateway route /v1/workspaces/* (no APISIX change).
  { method: 'GET',    path: '/v1/workspaces/{workspaceId}/webhooks/event-types', localHandler: 'webhookManage', auth: 'authenticated' },
  { method: 'POST',   path: '/v1/workspaces/{workspaceId}/webhooks/subscriptions', localHandler: 'webhookManage', auth: 'authenticated' },
  { method: 'GET',    path: '/v1/workspaces/{workspaceId}/webhooks/subscriptions', localHandler: 'webhookManage', auth: 'authenticated' },
  { method: 'GET',    path: '/v1/workspaces/{workspaceId}/webhooks/subscriptions/{subscriptionId}', localHandler: 'webhookManage', auth: 'authenticated' },
  { method: 'PATCH',  path: '/v1/workspaces/{workspaceId}/webhooks/subscriptions/{subscriptionId}', localHandler: 'webhookManage', auth: 'authenticated' },
  { method: 'DELETE', path: '/v1/workspaces/{workspaceId}/webhooks/subscriptions/{subscriptionId}', localHandler: 'webhookManage', auth: 'authenticated' },
  { method: 'POST',   path: '/v1/workspaces/{workspaceId}/webhooks/subscriptions/{subscriptionId}/pause', localHandler: 'webhookManage', auth: 'authenticated' },
  { method: 'POST',   path: '/v1/workspaces/{workspaceId}/webhooks/subscriptions/{subscriptionId}/resume', localHandler: 'webhookManage', auth: 'authenticated' },
  { method: 'POST',   path: '/v1/workspaces/{workspaceId}/webhooks/subscriptions/{subscriptionId}/rotate-secret', localHandler: 'webhookManage', auth: 'authenticated' },
  { method: 'GET',    path: '/v1/workspaces/{workspaceId}/webhooks/subscriptions/{subscriptionId}/deliveries', localHandler: 'webhookManage', auth: 'authenticated' },
  { method: 'GET',    path: '/v1/workspaces/{workspaceId}/webhooks/subscriptions/{subscriptionId}/deliveries/{deliveryId}', localHandler: 'webhookManage', auth: 'authenticated' },

  // ---- domain B: console auth (PUBLIC — these mint/verify the session) ------
  { method: 'POST',   path: '/v1/auth/login-sessions', localHandler: 'login', auth: 'public' },
  { method: 'POST',   path: '/v1/auth/signups', localHandler: 'signup', auth: 'public' },
  { method: 'POST',   path: '/v1/auth/login-sessions/{sessionId}/refresh', localHandler: 'refresh', auth: 'public' },
  { method: 'DELETE', path: '/v1/auth/login-sessions/{sessionId}', localHandler: 'logout', auth: 'authenticated' },
  { method: 'GET',    path: '/v1/auth/status-views/{statusViewId}', localHandler: 'getConsoleAccountStatusView', auth: 'public' },
  { method: 'GET',    path: '/v1/auth/signups/policy', localHandler: 'signupPolicy', auth: 'public' }
];
