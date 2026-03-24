# External Application Federation

## Overview

US-IAM-05 extends the canonical workspace IAM surface so external applications can be modeled with:

- OIDC and SAML protocols
- explicit authentication flows
- login and logout callback policies
- application scopes and roles
- federated identity providers
- attribute-mapper validation
- starter templates and plan-aware limits

The canonical product boundary remains workspace-scoped even when the underlying Keycloak implementation expands into tenant-realm clients and brokered identity providers.

## Console views

| View id | Purpose |
| --- | --- |
| `workspace-applications-list` | Browse workspace applications, protocol, flow, and validation status. |
| `workspace-application-editor` | Create or edit login/logout settings, scopes, roles, and client bindings. |
| `workspace-federation-providers` | Manage OIDC/SAML provider aliases, metadata, certificates, and requested scopes. |
| `workspace-application-templates` | Start from SPA, confidential backend, or B2B SAML defaults. |
| `workspace-application-validation` | Review redirect, certificate, metadata, mapper, and plan-limit validation output. |

## Supported authentication flows

| Flow id | Protocol | Typical client type | Notes |
| --- | --- | --- | --- |
| `oidc_authorization_code_pkce` | OIDC | `public` | Browser/mobile interactive login without client secret. |
| `oidc_authorization_code_client_secret` | OIDC | `confidential` | Server-side web/backend interactive login with client secret. |
| `oidc_client_credentials` | OIDC | `confidential` | Machine-to-machine automation flow without browser redirects. |
| `saml_sp_initiated` | SAML | `confidential` | Service-provider initiated browser federation. |
| `saml_idp_initiated` | SAML | `confidential` | Partner-initiated federation with RelayState handling. |

## Starter templates

| Template id | Pattern | Protocol | Intended use |
| --- | --- | --- | --- |
| `tpl_spa_oidc_pkce` | SPA | OIDC | Frontend/browser and mobile-first applications. |
| `tpl_backend_oidc_confidential` | Confidential backend | OIDC | Server-side web apps and API backends. |
| `tpl_b2b_saml` | B2B SAML | SAML | Enterprise partner and directory federation. |

## Plan-aware limits

| Plan | Protocols | Flows | Starter templates | Key limits |
| --- | --- | --- | --- | --- |
| Starter | OIDC | PKCE | SPA | 3 apps, 2 providers/app, 10 attribute mappers/app |
| Growth | OIDC | PKCE, auth-code + secret, client-credentials | SPA, confidential backend | 10 apps, 5 providers/app, 20 attribute mappers/app |
| Regulated | OIDC, SAML | Growth + SAML SP-initiated | SPA, confidential backend, B2B SAML | 20 apps, 8 providers/app, 40 attribute mappers/app |
| Enterprise | OIDC, SAML | Regulated + SAML IdP-initiated | Full template catalog | 40 apps, 16 providers/app, 80 attribute mappers/app |

## Validation rules

- Login and logout callbacks must be explicit HTTPS URIs; wildcard redirects are rejected.
- Template protocol and requested authentication flows must match.
- OIDC PKCE requires a `public` client type.
- OIDC confidential flows require a `confidential` client type.
- SAML requires metadata or explicit SSO/SLO endpoints plus at least one signing certificate.
- Attribute mappers may optionally target one specific provider, but provider references must resolve inside the same application.
- Application/provider counts and supported flows are checked against the plan-limit catalog.
