# US-IAM-05 — Federación OIDC/SAML y gestión IAM de aplicaciones externas

## Scope delivered

- External-application contracts now cover login/logout policies, redirect URIs, scopes, roles, authentication flows, federated identity providers, and attribute mappers.
- Workspace-scoped IAM management now models both OIDC and SAML federation shapes for external applications backed by the tenant/workspace Keycloak boundary.
- Public API coverage now includes list/update operations for external applications, nested federated-provider CRUD entry points, and starter-template discovery endpoints.
- Validation rules now cover redirect URIs, logout callbacks, SAML metadata and certificates, provider aliases, attribute-mapper references, and plan-specific flow support.
- Starter templates now document SPA + PKCE, confidential backend + OIDC, and B2B SAML federation patterns.
- Supported authentication flows and plan limits are now documented in the canonical reference catalog and exposed through reusable helper functions.

## Contract changes

- OpenAPI bumped to `1.6.0` with collection/update routes for external applications, nested `/federation/providers` routes, and starter-template discovery.
- Domain model enriched with external-application federation catalogs for supported flows, starter templates, and plan-limit envelopes.
- Authorization model extended with explicit application federation, attribute-mapper, logout, and template-read actions.
- Internal service map expanded with a dedicated `workspace_application_federation` orchestration flow and extra Keycloak adapter capabilities.
- Reference fixtures now include validated OIDC examples plus an enterprise B2B SAML application.

## Console views represented

- `workspace-applications-list`: inventory of workspace applications, protocol, flow, and validation state.
- `workspace-application-editor`: create/edit form for login/logout, scopes, roles, client bindings, and plan-aware validation.
- `workspace-federation-providers`: nested view for OIDC/SAML provider aliases, metadata, certificates, and mapper references.
- `workspace-application-templates`: starter-template picker for SPA, confidential backend, and B2B SAML patterns.
- `workspace-application-validation`: validation summary pane for redirect, certificate, metadata, and attribute-mapper checks.

## Validation intent

- Keep federation configuration additive, auditable, and tenant/workspace scoped.
- Reject wildcard redirects, invalid provider metadata, malformed certificates, and orphaned attribute mappers before activation.
- Document plan-aware limits without embedding raw secrets or mutable provider-side credentials in canonical contracts.
