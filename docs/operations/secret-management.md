# Secret management runbook

## Operator workflows

- Read/write through Vault with audited identities only.
- Use `/v1/secrets/inventory` for metadata-only discovery.

## Troubleshooting

- **Vault sealed**: inspect `vault status`, unseal with authorized key holders.
- **ESO sync failure**: inspect `ExternalSecret` conditions and Vault auth role bindings.
- **Fail-closed pod loop**: verify synced Secret exists and mounted files are non-empty.

## Audit

- Kafka topic: `console.secrets.audit`
- Query with a consumer and verify no secret material fields exist.

## Environment variables

- `VAULT_ADDR`
- `VAULT_NAMESPACE`
- `VAULT_SKIP_VERIFY`
- `SECRET_AUDIT_KAFKA_TOPIC`
- `SECRET_AUDIT_KAFKA_BROKERS`
- `VAULT_UNSEAL_METHOD`
- `VAULT_INIT_SHARES`
- `VAULT_INIT_THRESHOLD`
