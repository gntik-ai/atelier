# Public API Surface

Version: v1 (header 2026-03-24, OpenAPI 1.3.0)

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
| POST | `/v1/tenants` | tenant | tenant | Submit a canonical tenant write request |
| GET | `/v1/tenants/{tenantId}` | tenant | tenant | Fetch one canonical tenant entity |
| GET | `/v1/tenants/{tenantId}/effective-capabilities` | tenant | tenant_capabilities | Resolve effective capabilities for one tenant |
| POST | `/v1/tenants/{tenantId}/invitations` | tenant | invitation | Submit an invitation write request |
| GET | `/v1/tenants/{tenantId}/invitations/{invitationId}` | tenant | invitation | Fetch one invitation record |
| POST | `/v1/tenants/{tenantId}/memberships` | tenant | tenant_membership | Submit a tenant membership write request |
| GET | `/v1/tenants/{tenantId}/memberships/{tenantMembershipId}` | tenant | tenant_membership | Fetch one tenant membership record |

## Workspaces

Workspace lifecycle, application inventory, workload identities, and managed-resource control surfaces.

| Method | Path | Scope | Resource | Summary |
| --- | --- | --- | --- | --- |
| POST | `/v1/workspaces` | workspace | workspace | Submit a canonical workspace write request under the workspaces family |
| GET | `/v1/workspaces/{workspaceId}` | workspace | workspace | Fetch one canonical workspace entity under the workspaces family |
| POST | `/v1/workspaces/{workspaceId}/applications` | workspace | application | Submit a canonical external application write request under the workspaces family |
| GET | `/v1/workspaces/{workspaceId}/applications/{applicationId}` | workspace | application | Fetch one canonical external application entity under the workspaces family |
| GET | `/v1/workspaces/{workspaceId}/effective-capabilities` | workspace | workspace_capabilities | Resolve effective capabilities for one workspace |
| POST | `/v1/workspaces/{workspaceId}/managed-resources` | workspace | managed_resource | Submit a canonical managed resource write request |
| GET | `/v1/workspaces/{workspaceId}/managed-resources/{resourceId}` | workspace | managed_resource | Fetch one canonical managed resource entity |
| POST | `/v1/workspaces/{workspaceId}/memberships` | workspace | workspace_membership | Submit a workspace membership write request |
| GET | `/v1/workspaces/{workspaceId}/memberships/{workspaceMembershipId}` | workspace | workspace_membership | Fetch one workspace membership record |
| POST | `/v1/workspaces/{workspaceId}/service-accounts` | workspace | service_account | Submit a canonical service account write request |
| GET | `/v1/workspaces/{workspaceId}/service-accounts/{serviceAccountId}` | workspace | service_account | Fetch one canonical service account entity |

## Auth

Contextual authorization checks, scope resolution, and token-safe gateway decisions.

| Method | Path | Scope | Resource | Summary |
| --- | --- | --- | --- | --- |
| POST | `/v1/auth/access-checks` | workspace | authorization_decision | Resolve a contextual authorization decision under the auth family |

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

## Postgres

Workspace-scoped relational data control and discovery routes exposed through the public gateway.

| Method | Path | Scope | Resource | Summary |
| --- | --- | --- | --- | --- |
| POST | `/v1/postgres/instances` | workspace | database | Submit a workspace-scoped PostgreSQL instance provisioning request through the unified postgres family |
| GET | `/v1/postgres/instances/{resourceId}` | workspace | database | Fetch one workspace-scoped PostgreSQL instance contract under the postgres family |

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
