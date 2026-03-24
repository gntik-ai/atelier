# Public API Surface

Version: v1 (header 2026-03-24, OpenAPI 1.13.0)

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

Workspace- and tenant-aware PostgreSQL control, structural administration, and inventory routes exposed through safe BaaS contracts.

| Method | Path | Scope | Resource | Summary |
| --- | --- | --- | --- | --- |
| GET | `/v1/postgres/databases` | tenant | postgres_database | List tenant-scoped PostgreSQL databases exposed by the bounded administrative surface |
| POST | `/v1/postgres/databases` | tenant | postgres_database | Create one tenant-scoped PostgreSQL database when the placement profile supports database-per-tenant administration |
| DELETE | `/v1/postgres/databases/{databaseName}` | tenant | postgres_database | Delete one tenant-scoped PostgreSQL database through the bounded administrative surface |
| GET | `/v1/postgres/databases/{databaseName}` | tenant | postgres_database | Fetch one tenant-scoped PostgreSQL database contract |
| PUT | `/v1/postgres/databases/{databaseName}` | tenant | postgres_database | Update one tenant-scoped PostgreSQL database through the bounded administrative surface |
| GET | `/v1/postgres/databases/{databaseName}/schemas` | workspace | postgres_schema | List workspace-scoped PostgreSQL schemas inside one managed database |
| POST | `/v1/postgres/databases/{databaseName}/schemas` | workspace | postgres_schema | Create one workspace-scoped PostgreSQL schema inside a managed database |
| DELETE | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}` | workspace | postgres_schema | Delete one workspace-scoped PostgreSQL schema through the bounded administrative surface |
| GET | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}` | workspace | postgres_schema | Fetch one workspace-scoped PostgreSQL schema contract |
| PUT | `/v1/postgres/databases/{databaseName}/schemas/{schemaName}` | workspace | postgres_schema | Update one workspace-scoped PostgreSQL schema through the bounded administrative surface |
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
| GET | `/v1/postgres/workspaces/{workspaceId}/inventory` | workspace | postgres_inventory | Fetch the persisted PostgreSQL administrative inventory projection for one workspace |
| GET | `/v1/postgres/workspaces/{workspaceId}/types` | workspace | postgres_type | List PostgreSQL types currently allowed for one workspace and target cluster profile |

## Mongo

Workspace-scoped document database control and discovery routes exposed through the public gateway.

| Method | Path | Scope | Resource | Summary |
| --- | --- | --- | --- | --- |
| POST | `/v1/mongo/databases` | workspace | document_database | Submit a workspace-scoped MongoDB database provisioning request through the unified mongo family |
| GET | `/v1/mongo/databases/{resourceId}` | workspace | document_database | Fetch one workspace-scoped MongoDB database contract under the mongo family |

## Events

Workspace-scoped event topics with controlled HTTP publish, SSE delivery, replay windows, and audit-friendly gateway semantics.

| Method | Path | Scope | Resource | Summary |
| --- | --- | --- | --- | --- |
| POST | `/v1/events/topics` | workspace | topic | Submit a workspace-scoped event topic and gateway policy provisioning request through the unified events family |
| GET | `/v1/events/topics/{resourceId}` | workspace | topic | Fetch one workspace-scoped event topic contract, transport policy, and replay window under the events family |
| POST | `/v1/events/topics/{resourceId}/publish` | workspace | event_publication | Publish one event through the HTTP event gateway without exposing native Kafka clients |
| GET | `/v1/events/topics/{resourceId}/stream` | workspace | event_stream | Consume one topic through the HTTP SSE event gateway with replay and backpressure hints |

## Functions

Workspace-scoped serverless function management and invocation contracts routed by the gateway.

| Method | Path | Scope | Resource | Summary |
| --- | --- | --- | --- | --- |
| POST | `/v1/functions/actions` | workspace | function | Submit a workspace-scoped function action provisioning request through the unified functions family |
| GET | `/v1/functions/actions/{resourceId}` | workspace | function | Fetch one workspace-scoped function action contract under the functions family |

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
| GET | `/v1/metrics/workspaces/{workspaceId}/gateway-streams` | workspace | gateway_stream_metrics | Fetch gateway publish, connection, lag, and backpressure metrics for one workspace |
| GET | `/v1/metrics/workspaces/{workspaceId}/series` | workspace | metric_series | Fetch one workspace metric series window through the unified metrics family |

## WebSockets

Realtime websocket session negotiation and channel subscriptions for workspace-scoped event delivery through the gateway.

| Method | Path | Scope | Resource | Summary |
| --- | --- | --- | --- | --- |
| POST | `/v1/websockets/sessions` | workspace | websocket_session | Negotiate one websocket session for gateway-managed topic subscriptions |
| GET | `/v1/websockets/sessions/{sessionId}` | workspace | websocket_session | Fetch one negotiated websocket session descriptor, subscriptions, and backpressure policy |
