# Console Authentication and Registration

This reference records the US-IAM-03 baseline for console login, self-service signup, superadmin activation, and password recovery.

## What changed

- the public auth family now exposes explicit contracts for login, refresh, logout, signup, activation decisions, password recovery, and status views
- self-service signups normalize into `platform_user` records that can remain in `pending_activation` until policy or a superadmin activates them
- approved signup activations now carry the initial tenant/workspace bootstrap summary, owner bindings, and per-resource provisioning state needed by console flows
- chart values expose a single `webConsole.auth` block so operators can control client wiring and signup policy by global mode, environment, and plan

## Public auth routes

- `POST /v1/auth/login-sessions` — authenticate with username/password and mint the SPA session envelope
- `POST /v1/auth/login-sessions/{sessionId}/refresh` — rotate access tokens from the refresh lifecycle
- `DELETE /v1/auth/login-sessions/{sessionId}` — terminate the current console session
- `POST /v1/auth/signups` — create a self-service signup
- `GET /v1/auth/signups/policy` — resolve the effective signup policy
- `GET /v1/auth/signups/{registrationId}` — inspect current activation status
- `POST /v1/auth/signups/{registrationId}/activation-decisions` — approve or reject pending signups as a superadmin
- `POST /v1/auth/password-recovery-requests` — request password recovery
- `POST /v1/auth/password-recovery-requests/{recoveryRequestId}/confirmations` — confirm the reset token and complete the password change
- `GET /v1/auth/status-views/{statusViewId}` — resolve canonical UX copy for login edge states

## Policy model

The effective signup mode is resolved in this order:

1. global `webConsole.auth.autoSignupPolicy.globalMode`
2. environment override under `environmentModes`
3. plan override under `planModes`

Supported modes:

- `disabled`
- `approval_required`
- `auto_activate`

## Bootstrap behavior after approval

When a pending signup is approved, the activation decision and signup-registration read model may now return:

- the created tenant identifier
- the default workspace identifier
- the initial tenant/workspace owner memberships
- one `provisioning` summary with per-resource states for IAM context, PostgreSQL, storage, and any profile-gated MongoDB/Kafka/OpenWhisk resources

This keeps the first-login and post-approval console experience auditable: the operator can show whether the tenant is ready, still provisioning, or partially failed and waiting for an idempotent retry.

## UX states

The console test strategy now treats these states as first-class screens:

- `unauthenticated`
- `pending_activation`
- `account_suspended`
- `credentials_expired`

These are intentionally separate from the happy-path role-based views so the SPA cannot silently drop users back to a generic login loop.
