# ADR: Secure secret storage with Vault + ESO

- Date: 2026-03-30
- Status: Accepted

## Context

Plaintext cluster credentials create unacceptable operational and security risk.

## Decision

Use Vault OSS as the source of truth and External Secrets Operator to synchronize Kubernetes Secrets.

## Alternatives considered

- Sealed Secrets
- Kubernetes native Secrets only
- AWS Secrets Manager

## Consequences

- Improved auditability and domain isolation.
- Added operational responsibility for Vault bootstrap, TLS, and unseal workflows.
