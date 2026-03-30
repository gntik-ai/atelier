# secret-audit-handler

Publishes sanitized Vault audit events to Kafka.

## Environment variables

- `VAULT_AUDIT_LOG_PATH` (default `/vault/audit/vault-audit.log`)
- `KAFKA_BROKERS`
- `SECRET_AUDIT_KAFKA_TOPIC` (default `console.secrets.audit`)

## Deployment notes

- Intended to run as a Vault sidecar.
- Mount the shared audit volume read-only.

## Security invariants

- Never publish `value`, `data`, `secret`, `password`, `token`, or `key` fields.
