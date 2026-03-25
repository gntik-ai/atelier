# Public API Surface

Version: v1 (header 2026-03-26, OpenAPI 1.21.0)

## Product API vs native passthrough

This document describes the supported product API under `/v1/*`.

Native operator passthrough routes under `/_native/*` are documented separately in `docs/reference/architecture/gateway-authentication-and-passthrough.md` and are intentionally not part of the normal product surface.

## Versioning strategy

- The URI major version remains pinned at /v1 while additive evolution is announced through the X-API-Version header.
- Gateway QoS, request hardening, and response-envelope improvements may add optional metadata and response codes within v1 when they preserve current semantics and authorization boundaries.
- Generated family contracts and the route catalog must be refreshed from the unified contract on every published change.
- Breaking request/response, authentication, or authorization changes require a new URI family such as /v2 and an explicit coexistence window.
- Deprecated routes remain cataloged with a sunset marker until the replacement family is published and documented.
- Gateway routing, family contracts, and published docs must all advertise the same deprecation and removal dates.

## Shared HTTP conventions

- URI prefix: `/v1`
- Discovery route: `/v1/platform/route-catalog`
- Required headers: X-API-Version, X-Correlation-Id
- Gateway correlation continuity: X-Correlation-Id is preserved end-to-end and may be backfilled for downstream continuity when recovery requires it.
- Idempotency header for mutations: Idempotency-Key
- Idempotency replay header: X-Idempotency-Replayed
- Pagination: page[after] + page[size]
- Filter prefix: `filter[...]`
- Error schema: `ErrorResponse` with required fields status, code, message, detail, requestId, correlationId, timestamp, resource
- Retryable gateway statuses: 429, 502, 503, 504

## Gateway protection matrix

| Family | QoS profile | Validation profile | Max body bytes | Timeout profile | Retry profile |
| --- | --- | --- | ---: | --- | --- |
| platform | platform_control | platform_control | 262144 | control_plane | mutations |
| tenants | tenant_control | tenant_control | 262144 | control_plane | mutations |
| workspaces | workspace_control | workspace_control | 262144 | control_plane | mutations |
| auth | auth_control | auth_control | 131072 | control_plane | mutations |
| iam | tenant_control | tenant_control | 262144 | control_plane | mutations |
| postgres | provisioning | provisioning | 1048576 | provisioning | mutations |
| mongo | provisioning | provisioning | 1048576 | provisioning | mutations |
| events | event_gateway | event_gateway | 262144 | event_gateway | mutations |
| functions | provisioning | provisioning | 1048576 | provisioning | mutations |
| storage | provisioning | provisioning | 1048576 | provisioning | mutations |
| metrics | observability | observability | 65536 | observability | safe_reads |
| websockets | realtime | realtime | 131072 | realtime | mutations |

## Families

## Platform

Cross-tenant platform governance, catalog, and operator discovery surfaces.

| Method | Path | Scope | Resource | Summary |
| --- | --- | --- | --- | --- |
| POST | `/v1/platform/deployment-profiles` | platform | deployment_profile | Submit a deployment profile write request |
| GET | `/v1/platform/deployment-profiles/{deploymentProfileId}` | platform | deployment_profile | Fetch one deployment profile |
| POST | `/v1/platform/plans` | platform | plan | Submit a commercial plan write request |
| GET | `/v1/platform/plans/{planId}` | platform | plan | Fetch one commercial plan |
| POST | `/v1/platform/plans/{planId}/quota-policies` | platform | plan | Submit a quota policy write request |
| GET | `/v1/platform/plans/{planId}/quota-policies/{quotaPolicyId}` | platform | plan | Fetch one quota policy |
| POST | `/v1/platform/provider-capabilities` | platform | provider_capability | Submit a provider capability write request |
| GET | `/v1/platform/provider-capabilities/{providerCapabilityId}` | platform | provider_capability | Fetch one provider capability record |
| GET | `/v1/platform/route-catalog` | platform | route_catalog | List public gateway routes and filter them by family, scope, resource type, method, audience, or visibility |
| POST | `/v1/platform/users` | platform | platform_user | Submit a canonical platform user write request under the platform family |
| GET | `/v1/platform/users/{userId}` | platform | platform_user | Fetch one canonical platform user entity under the platform family |

## Tenants

Tenant lifecycle, membership, invitation, quota, and tenant-level capability surfaces.

| Method | Path | Scope | Resource | Summary |
| --- | --- | --- | --- | --- |
| GET | `/v1/tenants` | platform | tenant_collection | List tenants with lifecycle, quota, label, placement, and governance filters |
| POST | `/v1/tenants` | tenant | tenant | Submit a canonical tenant write request with governance labels, quotas, and lifecycle controls |
| DELETE | `/v1/tenants/{tenantId}` | tenant | tenant | Logically delete one tenant while preserving retention, auditability, and purge preconditions |
| GET | `/v1/tenants/{tenantId}` | tenant | tenant | Fetch one canonical tenant with governance labels, quotas, retention posture, and export metadata |
| PUT | `/v1/tenants/{tenantId}` | tenant | tenant | Update one canonical tenant including lifecycle, quota, label, and retention governance settings |
| GET | `/v1/tenants/{tenantId}/dashboard` | tenant | tenant_dashboard | Fetch tenant governance dashboard data including quotas, labels, provisioning state, and allowed actions |
| GET | `/v1/tenants/{tenantId}/effective-capabilities` | tenant | tenant_capabilities | Resolve effective capabilities for one tenant |
| POST | `/v1/tenants/{tenantId}/exports` | tenant | tenant_export | Create a recovery-oriented functional configuration export for one tenant |
| PATCH | `/v1/tenants/{tenantId}/iam-access` | tenant | tenant | Suspend or reactivate all tenant-managed IAM access for users and service accounts. |
| GET | `/v1/tenants/{tenantId}/inventory` | tenant | tenant_inventory | Fetch one tenant inventory snapshot covering workspaces, applications, service accounts, and managed resources |
| POST | `/v1/tenants/{tenantId}/invitations` | tenant | invitation | Submit an invitation write request |
| GET | `/v1/tenants/{tenantId}/invitations/{invitationId}` | tenant | invitation | Fetch one invitation record |
| POST | `/v1/tenants/{tenantId}/invitations/{invitationId}/acceptance` | tenant | invitation | Accept a tenant or workspace invitation while it is still pending. |
| POST | `/v1/tenants/{tenantId}/invitations/{invitationId}/revocation` | tenant | invitation | Revoke a pending invitation before it is accepted or expires. |
| POST | `/v1/tenants/{tenantId}/memberships` | tenant | tenant_membership | Submit a tenant membership write request |
| GET | `/v1/tenants/{tenantId}/memberships/{tenantMembershipId}` | tenant | tenant_membership | Fetch one tenant membership record |
| POST | `/v1/tenants/{tenantId}/ownership-transfers` | tenant | tenant | Initiate a secure tenant ownership transfer that requires acceptance by the designated target owner. |
| GET | `/v1/tenants/{tenantId}/ownership-transfers/{ownershipTransferId}` | tenant | tenant | Fetch one tenant ownership transfer record. |
| POST | `/v1/tenants/{tenantId}/ownership-transfers/{ownershipTransferId}/acceptance` | tenant | tenant | Accept a pending tenant ownership transfer before it expires. |
| GET | `/v1/tenants/{tenantId}/permission-recalculations/{permissionRecalculationId}` | tenant | tenant | Fetch one tenant-scoped effective-permission recalculation record. |
| POST | `/v1/tenants/{tenantId}/purge` | tenant | tenant_purge | Definitively purge one logically deleted tenant after retention and elevated confirmation checks |
| POST | `/v1/tenants/{tenantId}/reactivation` | tenant | tenant | Reactivate one suspended tenant and restore descendant access controls under audit |

## Workspaces

Workspace lifecycle, application inventory, workload identities, and managed-resource control surfaces.

| Method | Path | Scope | Resource | Summary |
| --- | --- | --- | --- | --- |
| GET | `/v1/workspaces` | tenant | workspace_collection | List workspaces for one tenant with lifecycle, environment, slug, and display-name filters |
| POST | `/v1/workspaces` | workspace | workspace | Submit a canonical workspace write request under the workspaces family |
| DELETE | `/v1/workspaces/{workspaceId}` | workspace | workspace | Soft-delete one canonical workspace while preserving audit and clone lineage metadata |
| GET | `/v1/workspaces/{workspaceId}` | workspace | workspace | Fetch one canonical workspace entity under the workspaces family |
| PUT | `/v1/workspaces/{workspaceId}` | workspace | workspace | Update one canonical workspace including IAM, lifecycle, and inheritance policy settings |
| GET | `/v1/workspaces/{workspaceId}/api-surface` | workspace | workspace_api_surface | Fetch workspace-specific base URLs and application endpoint bindings for external clients |
| GET | `/v1/workspaces/{workspaceId}/applications` | workspace | application | List canonical external applications, authentication flows, and validation status for one workspace |
| POST | `/v1/workspaces/{workspaceId}/applications` | workspace | application | Submit a canonical external application write request under the workspaces family |
| GET | `/v1/workspaces/{workspaceId}/applications/{applicationId}` | workspace | application | Fetch one canonical external application entity under the workspaces family |
| PUT | `/v1/workspaces/{workspaceId}/applications/{applicationId}` | workspace | application | Update one canonical external application including federation, logout, scope, and role settings |
| GET | `/v1/workspaces/{workspaceId}/applications/{applicationId}/federation/providers` | workspace | application | List federated OIDC and SAML identity providers attached to one external application |
| POST | `/v1/workspaces/{workspaceId}/applications/{applicationId}/federation/providers` | workspace | application | Create one federated identity provider for an external application |
| GET | `/v1/workspaces/{workspaceId}/applications/{applicationId}/federation/providers/{providerId}` | workspace | application | Fetch one federated identity provider attached to an external application |
| PUT | `/v1/workspaces/{workspaceId}/applications/{applicationId}/federation/providers/{providerId}` | workspace | application | Update one federated identity provider including metadata, certificates, and mapper bindings |
| GET | `/v1/workspaces/{workspaceId}/applications/templates` | workspace | application | List starter templates for SPA, confidential backend, and B2B SAML external applications |
| POST | `/v1/workspaces/{workspaceId}/clone` | workspace | workspace | Clone one workspace baseline into a new environment with optional application and credential reset policies |
| GET | `/v1/workspaces/{workspaceId}/effective-capabilities` | workspace | workspace_capabilities | Resolve effective capabilities for one workspace |
| POST | `/v1/workspaces/{workspaceId}/managed-resources` | workspace | managed_resource | Submit a canonical managed resource write request |
| GET | `/v1/workspaces/{workspaceId}/managed-resources/{resourceId}` | workspace | managed_resource | Fetch one canonical managed resource entity |
| POST | `/v1/workspaces/{workspaceId}/memberships` | workspace | workspace_membership | Submit a workspace membership write request |
| GET | `/v1/workspaces/{workspaceId}/memberships/{workspaceMembershipId}` | workspace | workspace_membership | Fetch one workspace membership record |
| GET | `/v1/workspaces/{workspaceId}/permission-recalculations/{permissionRecalculationId}` | workspace | workspace | Fetch one workspace-scoped effective-permission recalculation record. |
| POST | `/v1/workspaces/{workspaceId}/service-accounts` | workspace | service_account | Submit a canonical service account write request |
| GET | `/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}` | workspace | service_account | Fetch one canonical service account entity |
| POST | `/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-issuance` | workspace | service_account | Issue a new secret-free credential reference for one workspace service account. |
| POST | `/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-revocations` | workspace | service_account | Revoke one or all active credential references for a workspace service account. |
| POST | `/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}/credential-rotations` | workspace | service_account | Rotate the active credential reference for one workspace service account. |

## Auth

Console login, signup, activation, password recovery, and contextual authorization decisions.

| Method | Path | Scope | Resource | Summary |
| --- | --- | --- | --- | --- |
| POST | `/v1/auth/access-checks` | workspace | authorization_decision | Resolve a contextual authorization decision under the auth family |
| POST | `/v1/auth/login-sessions` | platform | auth_session | Authenticate a console operator with username/password and mint the SPA session envelope. |
| DELETE | `/v1/auth/login-sessions/{sessionId}` | platform | auth_session | Invalidate an active console session and revoke its refresh lifecycle. |
| POST | `/v1/auth/login-sessions/{sessionId}/refresh` | platform | auth_session | Rotate the console access token set from a refresh token without replaying username/password. |
| POST | `/v1/auth/password-recovery-requests` | platform | password_recovery | Start password recovery for a console operator without leaking whether the account exists. |
| POST | `/v1/auth/password-recovery-requests/{recoveryRequestId}/confirmations` | platform | password_recovery | Confirm a password-reset token and return the next status view for the console account. |
| POST | `/v1/auth/signups` | platform | console_signup | Create a self-service console signup and return whether activation is automatic or pending approval. |
| GET | `/v1/auth/signups/{registrationId}` | platform | console_signup | Inspect the current signup registration status for pending activation, activation, or rejection messaging. |
| POST | `/v1/auth/signups/{registrationId}/activation-decisions` | platform | console_signup | Approve or reject a pending self-service signup as a platform superadmin workflow. |
| GET | `/v1/auth/signups/policy` | platform | signup_policy | Resolve the effective self-service signup mode across global, environment, and plan overrides. |
| GET | `/v1/auth/status-views/{statusViewId}` | platform | account_status_view | Resolve the canonical status-screen copy and next actions for console auth edge states. |

## IAM

Tenant-scoped IAM administration for Keycloak realms, clients, roles, scopes, and users through normalized BaaS contracts.

| Method | Path | Scope | Resource | Summary |
| --- | --- | --- | --- | --- |
| GET | `/v1/iam/realms` | tenant | iam_realm | List managed IAM realms through the normalized BaaS surface |
| POST | `/v1/iam/realms` | tenant | iam_realm | Create one managed IAM realm with normalized validation and audit semantics |
| DELETE | `/v1/iam/realms/{realmId}` | tenant | iam_realm | Delete one managed IAM realm through the asynchronous control-plane surface |
| GET | `/v1/iam/realms/{realmId}` | tenant | iam_realm | Fetch one managed IAM realm |
| PUT | `/v1/iam/realms/{realmId}` | tenant | iam_realm | Replace the mutable IAM realm settings exposed by the BaaS contract |
| GET | `/v1/iam/realms/{realmId}/clients` | workspace | iam_client | List managed clients inside one IAM realm |
| POST | `/v1/iam/realms/{realmId}/clients` | workspace | iam_client | Create one managed client inside a tenant realm |
| DELETE | `/v1/iam/realms/{realmId}/clients/{clientId}` | workspace | iam_client | Delete one managed IAM client |
| GET | `/v1/iam/realms/{realmId}/clients/{clientId}` | workspace | iam_client | Fetch one managed IAM client |
| PUT | `/v1/iam/realms/{realmId}/clients/{clientId}` | workspace | iam_client | Replace the mutable settings of one managed IAM client |
| PATCH | `/v1/iam/realms/{realmId}/clients/{clientId}/status` | workspace | iam_client | Activate or deactivate one managed IAM client |
| GET | `/v1/iam/realms/{realmId}/roles` | tenant | iam_role | List managed realm roles |
| POST | `/v1/iam/realms/{realmId}/roles` | tenant | iam_role | Create one managed realm role |
| DELETE | `/v1/iam/realms/{realmId}/roles/{roleName}` | tenant | iam_role | Delete one managed realm role |
| GET | `/v1/iam/realms/{realmId}/roles/{roleName}` | tenant | iam_role | Fetch one managed realm role |
| PUT | `/v1/iam/realms/{realmId}/roles/{roleName}` | tenant | iam_role | Replace the mutable settings of one managed realm role |
| GET | `/v1/iam/realms/{realmId}/scopes` | tenant | iam_scope | List managed client scopes inside one realm |
| POST | `/v1/iam/realms/{realmId}/scopes` | tenant | iam_scope | Create one managed client scope |
| DELETE | `/v1/iam/realms/{realmId}/scopes/{scopeName}` | tenant | iam_scope | Delete one managed client scope |
| GET | `/v1/iam/realms/{realmId}/scopes/{scopeName}` | tenant | iam_scope | Fetch one managed client scope |
| PUT | `/v1/iam/realms/{realmId}/scopes/{scopeName}` | tenant | iam_scope | Replace the mutable settings of one managed client scope |
| PATCH | `/v1/iam/realms/{realmId}/status` | tenant | iam_realm | Activate or deactivate one managed IAM realm |
| GET | `/v1/iam/realms/{realmId}/users` | tenant | iam_user | List managed IAM users inside one realm |
| POST | `/v1/iam/realms/{realmId}/users` | tenant | iam_user | Create one managed IAM user with optional bootstrap credentials, attributes, roles, and groups |
| DELETE | `/v1/iam/realms/{realmId}/users/{iamUserId}` | tenant | iam_user | Delete one managed IAM user |
| GET | `/v1/iam/realms/{realmId}/users/{iamUserId}` | tenant | iam_user | Fetch one managed IAM user |
| PUT | `/v1/iam/realms/{realmId}/users/{iamUserId}` | tenant | iam_user | Replace the mutable settings of one managed IAM user |
| POST | `/v1/iam/realms/{realmId}/users/{iamUserId}/credential-resets` | tenant | iam_user | Reset one managed IAM user password or required actions without exposing provider-native payloads |
| PATCH | `/v1/iam/realms/{realmId}/users/{iamUserId}/status` | tenant | iam_user | Activate or deactivate one managed IAM user |
| GET | `/v1/iam/tenants/{tenantId}/activity` | tenant | tenant | Query actor-rich IAM lifecycle activity for one tenant. |
| GET | `/v1/iam/workspaces/{workspaceId}/activity` | workspace | workspace | Query actor-rich IAM lifecycle activity for one workspace context. |

## Postgres

Workspace- and tenant-aware PostgreSQL control, structural administration, inventory, and Data API routes exposed through safe BaaS contracts. Includes CRUD/query, bulk ops, import/export, scoped credentials, saved queries, stable endpoints, workspace-scoped RPC routines, and a restricted admin SQL channel.

| Method | Path | Scope | Resource | Summary |
| --- | --- | --- | --- | --- |
| GET | `/v1/postgres/databases` | tenant | postgres_database | List tenant-scoped PostgreSQL databases exposed by the bounded administrative surface |
| POST | `/v1/postgres/databases` | tenant | postgres_database | Create one tenant-scoped PostgreSQL database when the placement profile supports database-per-tenant administration |
| DELETE | `/v1/postgres/databases/{databaseName}` | tenant | postgres_database | Delete one tenant-scoped PostgreSQL database through the bounded administrative surface |
| GET | `/v1/postgres/databases/{databaseName}` | tenant | postgres_database | Fetch one tenant-scoped PostgreSQL database contract |
| PUT | `/v1/postgres/databases/{databaseName}` | tenant | postgres_database | Update one tenant-scoped PostgreSQL database through the bounded administrative surface |
| GET | `/v1/postgres/databases/{databaseName}/extensions` | workspace | postgres_extension | List authorized PostgreSQL extensions for one managed database |
| POST | `/v1/postgres/databases/{databaseName}/extensions` | workspace | postgres_extension | Enable one authorized PostgreSQL extension for a managed database |
| DELETE | `/v1/postgres/databases/{databaseName}/extensions/{extensionName}` | workspace | postgres_extension | Disable one authorized PostgreSQL extension for a managed database |
| GET | `/v1/postgres/databases/{databaseName}/extensions/{extensionName}` | workspace | postgres_extension | Fetch one authorized PostgreSQL extension record for a managed database |
| PUT | `/v1/postgres/databases/{databaseName}/extensions/{extensionName}` | workspace | postgres_extension | Update one authorized PostgreSQL extension record for a managed database |
| GET | `/v1/postgres/databases/{databaseName}/schemas` | workspace | postgres_schema | List workspace-scoped PostgreSQL schemas inside one managed database |
| POST | `/v1/postgres/databases/{databaseName}/schemas` | workspace | postgres_schema | Create one workspace-scoped PostgreSQL schema inside a managed database |
| DELETE | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}` | workspace | postgres_schema | Delete one workspace-scoped PostgreSQL schema through the bounded administrative surface |
| GET | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}` | workspace | postgres_schema | Fetch one workspace-scoped PostgreSQL schema contract |
| PUT | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}` | workspace | postgres_schema | Update one workspace-scoped PostgreSQL schema through the bounded administrative surface |
| GET | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/functions` | workspace | postgres_function | List workspace-scoped tenant-exposed PostgreSQL functions inside one managed schema |
| POST | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/functions` | workspace | postgres_function | Create one workspace-scoped tenant-exposed PostgreSQL function inside a managed schema |
| DELETE | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/functions/{routineName}` | workspace | postgres_function | Delete one workspace-scoped PostgreSQL function through the bounded administrative surface |
| GET | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/functions/{routineName}` | workspace | postgres_function | Fetch one workspace-scoped PostgreSQL function contract |
| PUT | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/functions/{routineName}` | workspace | postgres_function | Update one workspace-scoped PostgreSQL function through the bounded administrative surface |
| GET | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/materialized-views` | workspace | postgres_materialized_view | List workspace-scoped PostgreSQL materialized views inside one managed schema |
| POST | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/materialized-views` | workspace | postgres_materialized_view | Create one workspace-scoped PostgreSQL materialized view inside a managed schema |
| DELETE | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/materialized-views/{viewName}` | workspace | postgres_materialized_view | Delete one workspace-scoped PostgreSQL materialized view through the bounded administrative surface |
| GET | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/materialized-views/{viewName}` | workspace | postgres_materialized_view | Fetch one workspace-scoped PostgreSQL materialized view contract |
| PUT | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/materialized-views/{viewName}` | workspace | postgres_materialized_view | Update one workspace-scoped PostgreSQL materialized view through the bounded administrative surface |
| GET | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/procedures` | workspace | postgres_procedure | List workspace-scoped tenant-exposed PostgreSQL procedures inside one managed schema |
| POST | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/procedures` | workspace | postgres_procedure | Create one workspace-scoped tenant-exposed PostgreSQL procedure inside a managed schema |
| DELETE | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/procedures/{routineName}` | workspace | postgres_procedure | Delete one workspace-scoped PostgreSQL procedure through the bounded administrative surface |
| GET | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/procedures/{routineName}` | workspace | postgres_procedure | Fetch one workspace-scoped PostgreSQL procedure contract |
| PUT | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/procedures/{routineName}` | workspace | postgres_procedure | Update one workspace-scoped PostgreSQL procedure through the bounded administrative surface |
| GET | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables` | workspace | postgres_table | List workspace-scoped PostgreSQL tables inside one managed schema |
| POST | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables` | workspace | postgres_table | Create one workspace-scoped PostgreSQL table inside a managed schema |
| DELETE | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}` | workspace | postgres_table | Delete one workspace-scoped PostgreSQL table through the bounded administrative surface |
| GET | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}` | workspace | postgres_table | Fetch one workspace-scoped PostgreSQL table contract |
| PUT | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}` | workspace | postgres_table | Update one workspace-scoped PostgreSQL table through the bounded administrative surface |
| GET | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/columns` | workspace | postgres_column | List workspace-scoped PostgreSQL columns inside one managed table |
| POST | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/columns` | workspace | postgres_column | Create one workspace-scoped PostgreSQL column inside a managed table |
| DELETE | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/columns/{columnName}` | workspace | postgres_column | Delete one workspace-scoped PostgreSQL column through the bounded administrative surface |
| GET | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/columns/{columnName}` | workspace | postgres_column | Fetch one workspace-scoped PostgreSQL column contract |
| PUT | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/columns/{columnName}` | workspace | postgres_column | Update one workspace-scoped PostgreSQL column through the bounded administrative surface |
| GET | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/constraints` | workspace | postgres_constraint | List workspace-scoped PostgreSQL constraints inside one managed table |
| POST | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/constraints` | workspace | postgres_constraint | Create one workspace-scoped PostgreSQL constraint inside a managed table |
| DELETE | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/constraints/{constraintName}` | workspace | postgres_constraint | Delete one workspace-scoped PostgreSQL constraint through the bounded administrative surface |
| GET | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/constraints/{constraintName}` | workspace | postgres_constraint | Fetch one workspace-scoped PostgreSQL constraint contract |
| PUT | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/constraints/{constraintName}` | workspace | postgres_constraint | Update one workspace-scoped PostgreSQL constraint through the bounded administrative surface |
| GET | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/indexes` | workspace | postgres_index | List workspace-scoped PostgreSQL indexes inside one managed table |
| POST | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/indexes` | workspace | postgres_index | Create one workspace-scoped PostgreSQL index inside a managed table |
| DELETE | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/indexes/{indexName}` | workspace | postgres_index | Delete one workspace-scoped PostgreSQL index through the bounded administrative surface |
| GET | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/indexes/{indexName}` | workspace | postgres_index | Fetch one workspace-scoped PostgreSQL index contract |
| PUT | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/indexes/{indexName}` | workspace | postgres_index | Update one workspace-scoped PostgreSQL index through the bounded administrative surface |
| GET | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/policies` | workspace | postgres_policy | List declarative PostgreSQL row-level-security policies for one managed table |
| POST | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/policies` | workspace | postgres_policy | Create one declarative PostgreSQL row-level-security policy for a managed table |
| DELETE | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/policies/{policyName}` | workspace | postgres_policy | Delete one declarative PostgreSQL row-level-security policy for a managed table |
| GET | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/policies/{policyName}` | workspace | postgres_policy | Fetch one declarative PostgreSQL row-level-security policy for a managed table |
| PUT | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/policies/{policyName}` | workspace | postgres_policy | Update one declarative PostgreSQL row-level-security policy for a managed table |
| GET | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/security` | workspace | postgres_table_security | Fetch the effective PostgreSQL row-level-security posture for one managed table |
| PUT | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/tables/{tableName}/security` | workspace | postgres_table_security | Update the PostgreSQL row-level-security posture for one managed table |
| GET | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/views` | workspace | postgres_view | List workspace-scoped PostgreSQL views inside one managed schema |
| POST | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/views` | workspace | postgres_view | Create one workspace-scoped PostgreSQL view inside a managed schema |
| DELETE | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/views/{viewName}` | workspace | postgres_view | Delete one workspace-scoped PostgreSQL view through the bounded administrative surface |
| GET | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/views/{viewName}` | workspace | postgres_view | Fetch one workspace-scoped PostgreSQL view contract |
| PUT | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}/views/{viewName}` | workspace | postgres_view | Update one workspace-scoped PostgreSQL view through the bounded administrative surface |
| POST | `/v1/postgres/instances` | workspace | database | Submit a workspace-scoped PostgreSQL instance provisioning request through the unified postgres family |
| GET | `/v1/postgres/instances/{resourceId}` | workspace | database | Fetch one workspace-scoped PostgreSQL instance contract under the postgres family |
| GET | `/v1/postgres/roles` | workspace | postgres_role | List workspace-scoped PostgreSQL roles through the normalized administrative surface |
| POST | `/v1/postgres/roles` | workspace | postgres_role | Create one workspace-scoped PostgreSQL role through the bounded administrative surface |
| DELETE | `/v1/postgres/roles/{postgresRoleName}` | workspace | postgres_role | Delete one workspace-scoped PostgreSQL role through the bounded administrative surface |
| GET | `/v1/postgres/roles/{postgresRoleName}` | workspace | postgres_role | Fetch one workspace-scoped PostgreSQL role contract |
| PUT | `/v1/postgres/roles/{postgresRoleName}` | workspace | postgres_role | Update one workspace-scoped PostgreSQL role through the bounded administrative surface |
| GET | `/v1/postgres/users` | workspace | postgres_user | List workspace-scoped PostgreSQL users through the normalized administrative surface |
| POST | `/v1/postgres/users` | workspace | postgres_user | Create one workspace-scoped PostgreSQL user through the bounded administrative surface |
| DELETE | `/v1/postgres/users/{postgresUserName}` | workspace | postgres_user | Delete one workspace-scoped PostgreSQL user through the bounded administrative surface |
| GET | `/v1/postgres/users/{postgresUserName}` | workspace | postgres_user | Fetch one workspace-scoped PostgreSQL user contract |
| PUT | `/v1/postgres/users/{postgresUserName}` | workspace | postgres_user | Update one workspace-scoped PostgreSQL user through the bounded administrative surface |
| POST | `/v1/postgres/workspaces/{workspaceId}/admin/{databaseName}/sql` | workspace | postgres_admin_sql | Preview or execute one restricted administrative PostgreSQL SQL statement outside the public data API channel |
| GET | `/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/credentials` | workspace | postgres_data_credential | List scoped PostgreSQL Data API credentials for one logical database |
| POST | `/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/credentials` | workspace | postgres_data_credential | Create one scoped PostgreSQL Data API credential limited to declared logical database, schema, table, routine, saved-query, or endpoint scope |
| DELETE | `/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/credentials/{credentialId}` | workspace | postgres_data_credential | Revoke one scoped PostgreSQL Data API credential |
| GET | `/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/credentials/{credentialId}` | workspace | postgres_data_credential | Fetch one scoped PostgreSQL Data API credential definition without reissuing the secret value |
| GET | `/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/endpoints` | workspace | postgres_data_endpoint | List stable PostgreSQL endpoints backed by saved queries, views, or routines |
| POST | `/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/endpoints` | workspace | postgres_data_endpoint | Create one stable PostgreSQL endpoint backed by a saved query, view, or routine |
| DELETE | `/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/endpoints/{endpointId}` | workspace | postgres_data_endpoint | Delete one stable PostgreSQL endpoint definition |
| GET | `/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/endpoints/{endpointId}` | workspace | postgres_data_endpoint | Fetch one stable PostgreSQL endpoint definition |
| PATCH | `/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/endpoints/{endpointId}` | workspace | postgres_data_endpoint | Update one stable PostgreSQL endpoint definition |
| POST | `/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/published/{endpointSlug}` | workspace | postgres_data_endpoint | Invoke one stable PostgreSQL endpoint backed by a saved query, view, or routine |
| GET | `/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/saved-queries` | workspace | postgres_data_saved_query | List reusable PostgreSQL saved queries for one logical database |
| POST | `/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/saved-queries` | workspace | postgres_data_saved_query | Create one reusable PostgreSQL saved query with stable response options and parameter bindings |
| DELETE | `/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/saved-queries/{savedQueryId}` | workspace | postgres_data_saved_query | Delete one reusable PostgreSQL saved query definition |
| GET | `/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/saved-queries/{savedQueryId}` | workspace | postgres_data_saved_query | Fetch one reusable PostgreSQL saved query definition |
| PATCH | `/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/saved-queries/{savedQueryId}` | workspace | postgres_data_saved_query | Update one reusable PostgreSQL saved query definition |
| POST | `/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/saved-queries/{savedQueryId}/execute` | workspace | postgres_data_saved_query | Execute one reusable PostgreSQL saved query with optional count and pagination metadata |
| POST | `/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/rpc/{routineName}` | workspace | postgres_data_rpc | Execute one reusable PostgreSQL function as an RPC-style data endpoint with parameter binding |
| POST | `/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/bulk/delete` | workspace | postgres_data_bulk | Delete multiple PostgreSQL rows in one bounded bulk request with configurable limits and shared RLS enforcement |
| POST | `/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/bulk/insert` | workspace | postgres_data_bulk | Insert multiple PostgreSQL rows in one bounded bulk request with configurable limits and shared RLS enforcement |
| POST | `/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/bulk/update` | workspace | postgres_data_bulk | Update multiple PostgreSQL rows in one bounded bulk request with configurable limits and shared RLS enforcement |
| POST | `/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/exports` | workspace | postgres_data_transfer | Export PostgreSQL rows in JSON or CSV with optional count metadata and restore-friendly validation hints |
| POST | `/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/imports` | workspace | postgres_data_transfer | Import PostgreSQL rows in JSON or CSV while preserving validation, restore, and traceability expectations |
| GET | `/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/rows` | workspace | postgres_data_rows | List rows from one workspace-scoped PostgreSQL table with filters, projection, ordering, pagination, and controlled one-hop relations |
| POST | `/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/rows` | workspace | postgres_data_rows | Insert one row into one workspace-scoped PostgreSQL table while preserving effective-role, grants, and RLS guardrails |
| DELETE | `/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/rows/by-primary-key` | workspace | postgres_data_row | Delete one PostgreSQL row by primary-key selector while preserving effective-role, grants, and RLS guardrails |
| GET | `/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/rows/by-primary-key` | workspace | postgres_data_row | Fetch one PostgreSQL row by primary-key selector with optional projection and controlled one-hop relations |
| PATCH | `/v1/postgres/workspaces/{workspaceId}/data/{databaseName}/schemas/{schemaName}/tables/{tableName}/rows/by-primary-key` | workspace | postgres_data_row | Update one PostgreSQL row by primary-key selector while preserving effective-role, grants, and RLS guardrails |
| GET | `/v1/postgres/workspaces/{workspaceId}/grants` | workspace | postgres_grant | List effective PostgreSQL grants for one workspace inventory projection |
| POST | `/v1/postgres/workspaces/{workspaceId}/grants` | workspace | postgres_grant | Create one declarative PostgreSQL privilege grant for a workspace-managed object |
| DELETE | `/v1/postgres/workspaces/{workspaceId}/grants/{grantId}` | workspace | postgres_grant | Delete one declarative PostgreSQL privilege grant for a workspace-managed object |
| GET | `/v1/postgres/workspaces/{workspaceId}/grants/{grantId}` | workspace | postgres_grant | Fetch one declarative PostgreSQL privilege grant for a workspace-managed object |
| PUT | `/v1/postgres/workspaces/{workspaceId}/grants/{grantId}` | workspace | postgres_grant | Update one declarative PostgreSQL privilege grant for a workspace-managed object |
| GET | `/v1/postgres/workspaces/{workspaceId}/inventory` | workspace | postgres_inventory | Fetch the persisted PostgreSQL administrative inventory projection for one workspace |
| GET | `/v1/postgres/workspaces/{workspaceId}/templates` | workspace | postgres_template | List PostgreSQL database and schema onboarding templates for one workspace |
| POST | `/v1/postgres/workspaces/{workspaceId}/templates` | workspace | postgres_template | Create one PostgreSQL database or schema onboarding template for a workspace |
| DELETE | `/v1/postgres/workspaces/{workspaceId}/templates/{templateId}` | workspace | postgres_template | Delete one PostgreSQL database or schema onboarding template for a workspace |
| GET | `/v1/postgres/workspaces/{workspaceId}/templates/{templateId}` | workspace | postgres_template | Fetch one PostgreSQL database or schema onboarding template for a workspace |
| PUT | `/v1/postgres/workspaces/{workspaceId}/templates/{templateId}` | workspace | postgres_template | Update one PostgreSQL database or schema onboarding template for a workspace |
| GET | `/v1/postgres/workspaces/{workspaceId}/types` | workspace | postgres_type | List PostgreSQL types currently allowed for one workspace and target cluster profile |

## Mongo

Workspace-scoped document database control, discovery, and tenant-safe Data API routes exposed through the public gateway. Includes document CRUD, validated query controls, bounded bulk write, controlled aggregation, JSON import/export, topology-aware transactions, change-stream bridge registration, and collection-validation-aware mutation semantics.

| Method | Path | Scope | Resource | Summary |
| --- | --- | --- | --- | --- |
| GET | `/v1/mongo/databases` | workspace | mongo_database | List tenant-owned MongoDB logical databases through the normalized administrative surface |
| POST | `/v1/mongo/databases` | workspace | mongo_database | Create one tenant-owned MongoDB logical database with naming, quota, and isolation guardrails |
| DELETE | `/v1/mongo/databases/{databaseName}` | workspace | mongo_database | Delete one tenant-owned MongoDB logical database through the bounded administrative surface |
| GET | `/v1/mongo/databases/{databaseName}` | workspace | mongo_database | Fetch one normalized MongoDB database contract including dbStats projection |
| GET | `/v1/mongo/databases/{databaseName}/collections` | workspace | mongo_collection | List normalized MongoDB collections for one tenant-owned logical database |
| POST | `/v1/mongo/databases/{databaseName}/collections` | workspace | mongo_collection | Create one MongoDB collection with bounded validation, capped, time-series, and index configuration |
| DELETE | `/v1/mongo/databases/{databaseName}/collections/{collectionName}` | workspace | mongo_collection | Delete one MongoDB collection through the bounded administrative surface |
| GET | `/v1/mongo/databases/{databaseName}/collections/{collectionName}` | workspace | mongo_collection | Fetch one normalized MongoDB collection contract |
| PUT | `/v1/mongo/databases/{databaseName}/collections/{collectionName}` | workspace | mongo_collection | Update one MongoDB collection through the bounded administrative surface |
| GET | `/v1/mongo/databases/{databaseName}/collections/{collectionName}/indexes` | workspace | mongo_index | List normalized MongoDB indexes for one managed collection |
| POST | `/v1/mongo/databases/{databaseName}/collections/{collectionName}/indexes` | workspace | mongo_index | Create one MongoDB index with bounded TTL, partial filter, and rebuild metadata |
| DELETE | `/v1/mongo/databases/{databaseName}/collections/{collectionName}/indexes/{indexName}` | workspace | mongo_index | Delete one MongoDB index from a managed collection |
| GET | `/v1/mongo/databases/{databaseName}/collections/{collectionName}/indexes/{indexName}` | workspace | mongo_index | Fetch one normalized MongoDB index contract |
| PUT | `/v1/mongo/databases/{databaseName}/collections/{collectionName}/indexes/{indexName}` | workspace | mongo_index | Update one MongoDB index definition with bounded structural metadata |
| POST | `/v1/mongo/databases/{databaseName}/collections/{collectionName}/indexes/{indexName}/rebuild` | workspace | mongo_index | Request one controlled MongoDB index rebuild with explicit approval evidence |
| GET | `/v1/mongo/databases/{databaseName}/users` | workspace | mongo_user | List normalized MongoDB users for one tenant-owned logical database |
| POST | `/v1/mongo/databases/{databaseName}/users` | workspace | mongo_user | Create one MongoDB user with secret-indirected credentials and bounded role bindings |
| DELETE | `/v1/mongo/databases/{databaseName}/users/{mongoUserName}` | workspace | mongo_user | Delete one MongoDB user through the bounded administrative surface |
| GET | `/v1/mongo/databases/{databaseName}/users/{mongoUserName}` | workspace | mongo_user | Fetch one normalized MongoDB user contract |
| PUT | `/v1/mongo/databases/{databaseName}/users/{mongoUserName}` | workspace | mongo_user | Update one MongoDB user through the bounded administrative surface |
| POST | `/v1/mongo/databases/{databaseName}/users/{mongoUserName}/role-bindings` | workspace | mongo_role_binding | Assign one bounded MongoDB role binding to a tenant-owned user |
| DELETE | `/v1/mongo/databases/{databaseName}/users/{mongoUserName}/role-bindings/{roleBindingId}` | workspace | mongo_role_binding | Revoke one bounded MongoDB role binding from a tenant-owned user |
| GET | `/v1/mongo/databases/{databaseName}/views` | workspace | mongo_view | List normalized MongoDB views inside one managed database |
| POST | `/v1/mongo/databases/{databaseName}/views` | workspace | mongo_view | Create one MongoDB view with a bounded read-only aggregation pipeline |
| DELETE | `/v1/mongo/databases/{databaseName}/views/{viewName}` | workspace | mongo_view | Delete one MongoDB view from a managed database |
| GET | `/v1/mongo/databases/{databaseName}/views/{viewName}` | workspace | mongo_view | Fetch one normalized MongoDB view contract |
| PUT | `/v1/mongo/databases/{databaseName}/views/{viewName}` | workspace | mongo_view | Update one MongoDB view pipeline while preserving read-only safeguards |
| POST | `/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/aggregations` | workspace | mongo_data_aggregation | Execute one controlled MongoDB aggregation pipeline with tenant-aware stage injection and bounded planner limits |
| POST | `/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/bulk/write` | workspace | mongo_data_bulk | Execute one bounded MongoDB bulk write request with configurable operation-count and payload-size limits |
| POST | `/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/change-streams` | workspace | mongo_data_change_stream | Register one topology-aware MongoDB change-stream bridge request for gateway-managed realtime delivery |
| GET | `/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/documents` | workspace | mongo_data_documents | List workspace-scoped MongoDB documents with validated JSON filters, projection, deterministic sorting, and cursor pagination |
| POST | `/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/documents` | workspace | mongo_data_documents | Insert one tenant-scoped MongoDB document while preserving collection validation and logical tenant segregation |
| DELETE | `/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/documents/{documentId}` | workspace | mongo_data_document | Delete one tenant-scoped MongoDB document by identifier |
| GET | `/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/documents/{documentId}` | workspace | mongo_data_document | Fetch one tenant-scoped MongoDB document by identifier with optional projection |
| PATCH | `/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/documents/{documentId}` | workspace | mongo_data_document | Apply one bounded partial-update document against one tenant-scoped MongoDB document |
| PUT | `/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/documents/{documentId}` | workspace | mongo_data_document | Replace one tenant-scoped MongoDB document with full collection-validation-aware payload checks |
| POST | `/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/exports` | workspace | mongo_data_export | Export one bounded JSON document set from a MongoDB collection with restore-ready manifest metadata |
| POST | `/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/collections/{collectionName}/imports` | workspace | mongo_data_import | Import one bounded JSON document batch into a MongoDB collection with validation-first restore semantics |
| GET | `/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/credentials` | workspace | mongo_data_credential | List scoped MongoDB Data API credentials for one logical database |
| POST | `/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/credentials` | workspace | mongo_data_credential | Create one scoped MongoDB Data API credential limited to declared database and collection scope |
| DELETE | `/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/credentials/{credentialId}` | workspace | mongo_data_credential | Revoke one scoped MongoDB Data API credential |
| GET | `/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/credentials/{credentialId}` | workspace | mongo_data_credential | Fetch one scoped MongoDB Data API credential definition without reissuing the secret value |
| POST | `/v1/mongo/workspaces/{workspaceId}/data/{databaseName}/transactions` | workspace | mongo_data_transaction | Execute one topology-aware MongoDB multi-collection transaction with bounded tenant-safe document operations |
| GET | `/v1/mongo/workspaces/{workspaceId}/inventory` | workspace | mongo_inventory | Fetch the persisted MongoDB administrative inventory projection for one workspace |
| GET | `/v1/mongo/workspaces/{workspaceId}/templates` | workspace | mongo_template | List MongoDB collection onboarding templates for one workspace |
| POST | `/v1/mongo/workspaces/{workspaceId}/templates` | workspace | mongo_template | Create one MongoDB collection onboarding template with bounded defaults and variables |
| DELETE | `/v1/mongo/workspaces/{workspaceId}/templates/{templateId}` | workspace | mongo_template | Delete one MongoDB collection onboarding template from a workspace |
| GET | `/v1/mongo/workspaces/{workspaceId}/templates/{templateId}` | workspace | mongo_template | Fetch one MongoDB collection onboarding template for a workspace |
| PUT | `/v1/mongo/workspaces/{workspaceId}/templates/{templateId}` | workspace | mongo_template | Update one MongoDB collection onboarding template for a workspace |

## Events

Workspace-scoped event topics with controlled HTTP publish, SSE delivery, replay windows, and audit-friendly gateway semantics.

| Method | Path | Scope | Resource | Summary |
| --- | --- | --- | --- | --- |
| POST | `/v1/events/topics` | workspace | topic | Submit a workspace-scoped Kafka topic governance request with managed naming, ACL isolation, and quota-aware provisioning |
| GET | `/v1/events/topics/{resourceId}` | workspace | topic | Fetch one workspace-scoped Kafka topic contract with naming, ACL, isolation, quota, and KRaft governance metadata |
| GET | `/v1/events/topics/{resourceId}/access` | workspace | topic_acl | Fetch one Kafka topic access policy with workspace-scoped ACL bindings and service-account isolation |
| PUT | `/v1/events/topics/{resourceId}/access` | workspace | topic_acl | Update one Kafka topic access policy with managed ACL convergence and service-account isolation |
| GET | `/v1/events/topics/{resourceId}/metadata` | workspace | topic_metadata | Fetch topic partitions, lag, retention, and compaction metadata when provider APIs and policy allow visibility |
| POST | `/v1/events/topics/{resourceId}/publish` | workspace | event_publication | Publish one event through the HTTP event gateway without exposing native Kafka clients |
| GET | `/v1/events/topics/{resourceId}/stream` | workspace | event_stream | Consume one topic through the HTTP SSE event gateway with replay and backpressure hints |
| POST | `/v1/events/workspaces/{workspaceId}/bridges` | workspace | event_bridge | Register a workspace-scoped managed event bridge from PostgreSQL, MongoDB, storage, OpenWhisk, or IAM into Kafka |
| GET | `/v1/events/workspaces/{workspaceId}/bridges/{bridgeId}` | workspace | event_bridge | Fetch the normalized state for one managed event bridge |
| GET | `/v1/events/workspaces/{workspaceId}/inventory` | workspace | event_inventory | Fetch one workspace Kafka topic inventory with naming, ACL, quota, and KRaft governance visibility |

## Functions

Workspace-scoped OpenWhisk-governed serverless package, trigger, rule, action, and inventory contracts routed by the gateway.

| Method | Path | Scope | Resource | Summary |
| --- | --- | --- | --- | --- |
| POST | `/v1/functions/actions` | workspace | function | Submit a workspace-scoped function action provisioning request through the unified functions family |
| GET | `/v1/functions/actions/{resourceId}` | workspace | function | Fetch one workspace-scoped function action contract under the functions family |
| POST | `/v1/functions/actions/{resourceId}/kafka-triggers` | workspace | function_kafka_trigger | Register a Kafka-triggered OpenWhisk execution policy for one managed action |
| GET | `/v1/functions/actions/{resourceId}/kafka-triggers/{triggerId}` | workspace | function_kafka_trigger | Fetch one normalized Kafka-triggered function execution policy |
| GET | `/v1/functions/workspaces/{workspaceId}/inventory` | workspace | function_inventory | Fetch one workspace OpenWhisk serverless inventory with logical namespace, subject, package, trigger, and rule visibility |
| GET | `/v1/functions/workspaces/{workspaceId}/packages` | workspace | function_package | List governed OpenWhisk packages for one workspace logical serverless context |
| POST | `/v1/functions/workspaces/{workspaceId}/packages` | workspace | function_package | Create one governed OpenWhisk package inside the workspace logical serverless context |
| DELETE | `/v1/functions/workspaces/{workspaceId}/packages/{packageName}` | workspace | function_package | Delete one governed OpenWhisk package from the workspace logical serverless context |
| GET | `/v1/functions/workspaces/{workspaceId}/packages/{packageName}` | workspace | function_package | Fetch one governed OpenWhisk package for the workspace logical serverless context |
| PATCH | `/v1/functions/workspaces/{workspaceId}/packages/{packageName}` | workspace | function_package | Update one governed OpenWhisk package without exposing native namespace or subject administration |
| GET | `/v1/functions/workspaces/{workspaceId}/rules` | workspace | function_rule | List governed OpenWhisk rules for one workspace logical serverless context |
| POST | `/v1/functions/workspaces/{workspaceId}/rules` | workspace | function_rule | Create one governed OpenWhisk rule that binds a workspace trigger to a workspace action |
| DELETE | `/v1/functions/workspaces/{workspaceId}/rules/{ruleName}` | workspace | function_rule | Delete one governed OpenWhisk rule from the workspace logical serverless context |
| GET | `/v1/functions/workspaces/{workspaceId}/rules/{ruleName}` | workspace | function_rule | Fetch one governed OpenWhisk rule for the workspace logical serverless context |
| PATCH | `/v1/functions/workspaces/{workspaceId}/rules/{ruleName}` | workspace | function_rule | Update one governed OpenWhisk rule without exposing native namespace or subject administration |
| GET | `/v1/functions/workspaces/{workspaceId}/triggers` | workspace | function_trigger | List governed OpenWhisk triggers for one workspace logical serverless context |
| POST | `/v1/functions/workspaces/{workspaceId}/triggers` | workspace | function_trigger | Create one governed OpenWhisk trigger for the workspace logical serverless context |
| DELETE | `/v1/functions/workspaces/{workspaceId}/triggers/{triggerName}` | workspace | function_trigger | Delete one governed OpenWhisk trigger from the workspace logical serverless context |
| GET | `/v1/functions/workspaces/{workspaceId}/triggers/{triggerName}` | workspace | function_trigger | Fetch one governed OpenWhisk trigger for the workspace logical serverless context |
| PATCH | `/v1/functions/workspaces/{workspaceId}/triggers/{triggerName}` | workspace | function_trigger | Update one governed OpenWhisk trigger without exposing native namespace or subject administration |

## Storage

Workspace-scoped object storage discovery, bucket control, and presign-safe surfaces.

| Method | Path | Scope | Resource | Summary |
| --- | --- | --- | --- | --- |
| POST | `/v1/storage/buckets` | workspace | bucket | Submit a workspace-scoped storage bucket provisioning request through the unified storage family |
| GET | `/v1/storage/buckets/{resourceId}` | workspace | bucket | Fetch one workspace-scoped storage bucket contract under the storage family |

## Metrics

Workspace-scoped usage, quota, gateway-stream, and observability series exposed through the unified gateway.

| Method | Path | Scope | Resource | Summary |
| --- | --- | --- | --- | --- |
| GET | `/v1/metrics/workspaces/{workspaceId}/event-dashboards` | workspace | event_dashboard | Fetch workspace-scoped Kafka bridge and trigger dashboard widgets |
| GET | `/v1/metrics/workspaces/{workspaceId}/gateway-streams` | workspace | gateway_stream_metrics | Fetch gateway publish, connection, lag, and backpressure metrics for one workspace |
| GET | `/v1/metrics/workspaces/{workspaceId}/kafka-topics` | workspace | kafka_topic_metrics | Fetch topic throughput, lag, retention, compaction, bridge, and trigger metrics for one workspace |
| GET | `/v1/metrics/workspaces/{workspaceId}/series` | workspace | metric_series | Fetch one workspace metric series window through the unified metrics family |

## WebSockets

Realtime websocket session negotiation and channel subscriptions for workspace-scoped event delivery through the gateway.

| Method | Path | Scope | Resource | Summary |
| --- | --- | --- | --- | --- |
| POST | `/v1/websockets/sessions` | workspace | websocket_session | Negotiate one websocket session for gateway-managed topic subscriptions |
| GET | `/v1/websockets/sessions/{sessionId}` | workspace | websocket_session | Fetch one negotiated websocket session descriptor, subscriptions, and backpressure policy |
