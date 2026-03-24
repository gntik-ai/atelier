# IAM Administration

This document describes the normalized IAM administration surface introduced by `US-IAM-02`.

## Goals

- expose Keycloak admin operations through BaaS-native contracts
- keep request/response envelopes stable across supported Keycloak versions
- prevent invalid IAM combinations before they reach the provider
- document operator and developer entry points for API and console flows

## Public API family

All productized IAM administration routes live under `/v1/iam/*` and require:

- `Authorization: Bearer ...`
- `X-API-Version: 2026-03-24`
- `X-Correlation-Id: <stable trace id>`
- `Idempotency-Key: <stable replay key>` for `POST`, `PUT`, `PATCH`, and `DELETE`

### Examples

Create a tenant realm:

```bash
curl -X POST https://api.in-atelier.example.com/v1/iam/realms \
  -H 'Authorization: Bearer <token>' \
  -H 'X-API-Version: 2026-03-24' \
  -H 'X-Correlation-Id: corr-iam-001' \
  -H 'Idempotency-Key: idem-iam-001' \
  -H 'Content-Type: application/json' \
  -d '{
    "realmId": "tenant-acme-prod",
    "displayName": "Acme Production",
    "enabled": true,
    "defaultScopes": ["openid", "profile"],
    "optionalScopes": ["offline_access"]
  }'
```

Create a workspace client inside one tenant realm:

```bash
curl -X POST https://api.in-atelier.example.com/v1/iam/realms/tenant-acme-prod/clients \
  -H 'Authorization: Bearer <token>' \
  -H 'X-API-Version: 2026-03-24' \
  -H 'X-Correlation-Id: corr-iam-002' \
  -H 'Idempotency-Key: idem-iam-002' \
  -H 'Content-Type: application/json' \
  -d '{
    "clientId": "acme-prod-web-console",
    "protocol": "openid-connect",
    "accessType": "confidential",
    "standardFlowEnabled": true,
    "serviceAccountsEnabled": false,
    "redirectUris": ["https://console.acme.example.com/callback"],
    "defaultScopes": ["openid", "profile", "email"],
    "optionalScopes": ["offline_access"]
  }'
```

Reset a user password and require password update:

```bash
curl -X POST https://api.in-atelier.example.com/v1/iam/realms/tenant-acme-prod/users/7dc3f95c-20a1-46d4-b1a7-ef8f919f2e87/credential-resets \
  -H 'Authorization: Bearer <token>' \
  -H 'X-API-Version: 2026-03-24' \
  -H 'X-Correlation-Id: corr-iam-003' \
  -H 'Idempotency-Key: idem-iam-003' \
  -H 'Content-Type: application/json' \
  -d '{
    "temporaryPassword": "Temp-Password-2026!",
    "requiredActions": ["UPDATE_PASSWORD"],
    "sendEmail": true
  }'
```

Deactivate a client without deleting it:

```bash
curl -X PATCH https://api.in-atelier.example.com/v1/iam/realms/tenant-acme-prod/clients/acme-prod-web-console/status \
  -H 'Authorization: Bearer <token>' \
  -H 'X-API-Version: 2026-03-24' \
  -H 'X-Correlation-Id: corr-iam-004' \
  -H 'Idempotency-Key: idem-iam-004' \
  -H 'Content-Type: application/json' \
  -d '{
    "enabled": false,
    "reason": "Workspace archived"
  }'
```

## Console path guidance

The administrative API is designed to back the following console navigation paths:

- `/console/platform/iam/realms`
- `/console/tenants/:tenantId/iam/realms/:realmId`
- `/console/workspaces/:workspaceId/iam/clients`
- `/console/tenants/:tenantId/iam/roles`
- `/console/tenants/:tenantId/iam/scopes`
- `/console/tenants/:tenantId/iam/users`
- `/console/tenants/:tenantId/iam/users/:iamUserId/reset-credentials`

These paths are intentionally documented now so later console work can preserve route naming and user expectations without changing the product API.

## Business validation guardrails

The normalized IAM layer rejects unsafe combinations before the provider call is built. Examples:

- reserved realms such as `master` and `in-atelier-platform` are blocked outside platform scope
- public clients cannot enable service accounts
- bearer-only clients cannot use redirect URIs or browser flows
- default and optional scopes must remain disjoint
- reserved role and scope names cannot be reused casually
- user group paths are normalized and deduplicated
- temporary passwords must be at least 12 characters long

## Supported Keycloak versions

The administrative baseline is contract-tested for:

- `24.x`
- `25.x`
- `26.x`

The BaaS contract remains stable across those versions even if provider-native response details drift.
