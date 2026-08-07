# Capability inventory
INIT SKELETON — if falcone-loop-state/ already exists from a previous
campaign, DO NOT overwrite it; merge instead. The loop's discovery
(DISCOVER=1) expands this file every iteration.

Areas to inventory:
- Identity & tenancy (Keycloak, tenants/workspaces, roles, service accounts, OAuth applications)
- Data (PostgreSQL, document API)
- Object storage
- Events (Kafka) & realtime delivery
- Functions (Knative path)
- Webhooks (signed, retried) & scheduling
- Flows (Temporal: durability, cancel, retry, signals, SSE, quotas, audit)
- Secrets (OpenBao write-only workspace secrets)
- LLM & embeddings (executor, provider record, allow-list, streaming, pgvector)
- MCP hosting
- Quotas / plans / metering
- Audit
- Backup & operations
