# Environment Variables

The runnable control-plane / executor service (`apps/control-plane-executor/src/runtime`) is configured by environment variables. In a chart deployment these are populated from the component config + `secretRefs`; for local runs you set them directly.

## HTTP

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | HTTP listen port |
| `CONTROL_PLANE_UPSTREAM` | — | Upstream for paths the executor proxies (pinned for SSRF safety) |

## PostgreSQL (data + control DB)

The Postgres DSN is built from discrete vars, or supplied whole:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATA_DB_URL` / `DB_URL` | — | Existing global control-plane DSN (takes precedence over the discrete vars); it retains tenant/workspace, saga, governance, and workspace-database creation responsibilities and is not a webhook schema/writer/lifecycle credential |
| `PGHOST` | `localhost` | Host |
| `PGPORT` | `5432` | Port |
| `PGUSER` | — | Existing global control-plane `LOGIN`; it is independent of the four webhook-only logins and may retain the deployment's existing `CREATEDB` capability for workspace-database provisioning |
| `PGPASSWORD` | — | Password |
| `PGDATABASE` | `falcone` | Database |
| `CONTROL_DB_URL` | falls back to the data DSN | Pool for API-key storage |
| `WEBHOOK_SCHEMA_DATABASE_URL` | — (required by C-25 control-plane bootstrap) | Bounded schema-owner DSN used only for application DDL and final graph verification, then closed; it must not be a superuser, role administrator, runtime principal, writer/lifecycle member, or startup-role alias |
| `WEBHOOK_RUNTIME_DATABASE_URL` | — (required by C-25 control-plane bootstrap) | Dedicated ordinary-webhook runtime DSN; its bounded LOGIN inherits `falcone_app`, cannot `SET ROLE` to it, and is the only pool injected into ordinary webhook adapters |
| `WEBHOOK_KEY_WRITE_DATABASE_URL` | — (required by C-25 control-plane bootstrap) | Dedicated encrypted-writer DSN; its unprivileged LOGIN is the only login bound to `falcone_webhook_key_writer` |
| `WEBHOOK_KEY_LIFECYCLE_DATABASE_URL` | — (required by C-25 control-plane bootstrap and lifecycle CLI) | Dedicated maintenance DSN; its unprivileged LOGIN is the only login bound to `falcone_webhook_key_lifecycle` |
| `WEBHOOK_SCHEMA_DATABASE_ROLE` | — (required by C-25 control-plane bootstrap and lifecycle CLI) | Expected authenticated bounded schema-owner LOGIN name |
| `WEBHOOK_RUNTIME_DATABASE_ROLE` | — (required by C-25 control-plane bootstrap) | Expected authenticated LOGIN behind `WEBHOOK_RUNTIME_DATABASE_URL`; must be distinct, bounded, and not an object owner |
| `WEBHOOK_KEY_WRITE_DATABASE_ROLE` | — (required by C-25 control-plane bootstrap) | Expected authenticated writer LOGIN name |
| `WEBHOOK_KEY_LIFECYCLE_DATABASE_ROLE` | — (required by C-25 control-plane bootstrap and lifecycle CLI) | Expected authenticated lifecycle LOGIN name |
| `WEBHOOK_DATABASE_AUTHORITY_GRANTOR_ROLE` | — (required by C-25 control-plane bootstrap and lifecycle CLI) | Durable PostgreSQL administrator role recorded as the grantor of all three exact webhook membership edges; its DSN is used only by the chart's one-shot bootstrap and is never injected into the application |

> [!IMPORTANT]
> Do not replace `DB_URL`/`PG*` with `WEBHOOK_RUNTIME_DATABASE_URL`. The former remains the global
> control-plane/admin-capable application path, including workspace `CREATE DATABASE`; the latter is
> a bounded webhook-only path. The fixed `falcone_app` authority is `NOLOGIN`, and the four webhook
> sessions are rejected if any is a superuser or `BYPASSRLS`.

The four authenticated users behind the webhook schema, runtime, writer, and lifecycle pools must be
pairwise distinct. For every pool, the first application query requires
`session_user = current_user`; a superuser DSN plus `options=-c role=...`, `SET ROLE`, or another
startup alias is rejected. All four are
`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`. The schema login owns and
alters only the enumerated webhook tables/functions and is closed after migration and verification.
It is not a runtime principal and has no membership in `falcone_app`,
`falcone_webhook_key_writer`, or `falcone_webhook_key_lifecycle`.

A separate chart one-shot PostgreSQL bootstrap, authenticated from the bundled database
administrator Secret as the declared durable grantor, owns global role creation,
legacy-membership repair, credential generation, and the exact PostgreSQL 16 bindings:

- `falcone_app` → runtime LOGIN: `ADMIN FALSE, INHERIT TRUE, SET FALSE`;
- `falcone_webhook_key_writer` → writer LOGIN: `ADMIN FALSE, INHERIT FALSE, SET TRUE`;
- `falcone_webhook_key_lifecycle` → lifecycle LOGIN:
  `ADMIN FALSE, INHERIT FALSE, SET TRUE`.

No other membership touching a fixed authority or bounded webhook principal is allowed. The grantor
must remain an administrator distinct from every fixed authority and bounded/global application
principal; its credential is mounted only into that Job and never into the control-plane Deployment
or lifecycle Job. PostgreSQL 16 is the minimum supported version because the verifier requires the
catalogued `inherit_option`, `set_option`, and grantor identity.

Supply four dedicated webhook DSNs from four persisted Kubernetes `Secret` keys, in addition to the
unchanged global `DB_URL`/`PG*` contract, with
server-certificate and hostname verification under the same PostgreSQL CA policy. Generated
passwords are reused across idempotent hook replay; they must not appear in Helm values, rendered
manifests, command arguments, logs, Events, or annotations.

## Document store (FerretDB / DocumentDB)

The `MONGO_*` variables are retained and now point at the **FerretDB gateway** (which speaks the MongoDB wire protocol over a DocumentDB-on-PostgreSQL engine), so the existing MongoDB driver and data API are unchanged.

| Variable | Default | Purpose |
| --- | --- | --- |
| `MONGO_URI` | — | Full URI (takes precedence); points at the FerretDB gateway (`mongodb://…@<release>-ferretdb:27017/`) |
| `MONGO_HOST` | — | Host (used to build the URI) |
| `MONGO_USER` / `MONGO_PASSWORD` | — | Credentials |
| `MONGO_AUTH_SOURCE` | `admin` | Auth source when a user is set |
| `MONGO_BACKEND` | — | Set to `ferretdb` so the data API rejects unsupported multi-document `transaction` ops at the boundary (HTTP 501) |

There is **no replica set** — FerretDB v2 has no change streams, so realtime/CDC is served from a Postgres **logical-replication** slot on the DocumentDB engine (`wal_level=logical`), not from a `?replicaSet=rs0` connection. See the [FerretDB Document-Store Runbook](/architecture/ferretdb).

## Events & functions

| Variable | Default | Purpose |
| --- | --- | --- |
| `KAFKA_BROKERS` | — | Comma-separated brokers; events executor is enabled only when set |
| `FN_BACKEND` | — | Set to `off` to disable the functions executor |

## Flows (Temporal) *(Preview)*

The Flows API is registered **only when `TEMPORAL_ADDRESS` is set** (the executor is the sole Temporal client).

| Variable | Default | Purpose |
| --- | --- | --- |
| `TEMPORAL_ADDRESS` | — | Temporal frontend `host:port`; **enables Flows** when set |
| `TEMPORAL_NAMESPACE` | `falcone-flows` | Shared Temporal namespace |
| `TEMPORAL_TASK_QUEUE` | `flows-main` | Worker task queue |
| `FLOW_QUOTA_ENFORCE_URL` | — | Quota-evaluator endpoint; when set, hard-limit breaches → `429` |
| `FLOW_AUDIT_TOPIC` | `falcone.audit.flow-lifecycle` | Kafka topic for flow lifecycle audit (best-effort) |
| `FLOW_TRIGGER_SECRET_KEY` | — | Master key for per-trigger webhook signing secrets |
| `FLOWS_ENABLED` | — | Set to `false` to keep the Flows API but suppress the monitoring SSE endpoint |

## MCP server hosting *(Preview)*

The MCP management API (`/v1/mcp`) is part of the core install; the chart sets
`MCP_ENABLED=true`. Setting it to `false` is a local diagnostic override, not a supported
fresh-install baseline.

| Variable | Default | Purpose |
| --- | --- | --- |
| `MCP_ENABLED` | `true` in Helm values | Runtime gate for the MCP management API |
| `MCP_SELF_BASE_URL` | `http://127.0.0.1:$PORT` | Base URL the engine self-calls to mediate tool calls |
| `MCP_GATEWAY_BASE_URL` | (self URL) | Public base URL used to compute a server's endpoint |
| `MCP_RUNTIME_IMAGE` | — | Platform MCP runtime image (digest-pinned for the registry) |
| `MCP_RUNTIME_IMAGE_DIGEST` | — | `sha256:` digest of the runtime image |

## Identity (JWT verification)

| Variable | Purpose |
| --- | --- |
| `KEYCLOAK_JWKS_URL` | JWKS endpoint to fetch signing keys |
| `KEYCLOAK_ISSUER` | Expected token issuer |
| `KEYCLOAK_AUDIENCE` | Expected token audience |

When these are set, Bearer JWTs are verified locally and their claims become the identity (precedence #2). When unset, the service trusts gateway-injected identity headers (precedence #3).

## Where values come from in a chart install

`values.yaml → config.secretRefs` maps Kubernetes Secrets to the credentials above. On fresh installs
the pre-install credential bootstrap hook creates/adopts these Secrets inside the cluster, and OpenBao
plus ESO reconcile the same keys after the secret backend is ready:

| `secretRefs` entry | Keys | Feeds |
| --- | --- | --- |
| `postgresCredentials` | `POSTGRESQL_USERNAME`, `POSTGRESQL_PASSWORD`, `POSTGRESQL_POSTGRES_PASSWORD` | `PG*` |
| `mongoCredentials` | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `MONGO_*` |
| `kafkaCredentials` | `KAFKA_CFG_NODE_ID`, `KAFKA_CFG_PROCESS_ROLES`, `KAFKA_CFG_CONTROLLER_LISTENER_NAMES`, `KAFKA_CFG_CONTROLLER_QUORUM_VOTERS`, `KAFKA_CFG_LISTENERS`, `KAFKA_CFG_ADVERTISED_LISTENERS`, `KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP` | Kafka |
| `objectStorageCredentials` | `s3_access_key`, `s3_secret_key` | Storage |
| `identityClient` | `client-id`, `client-secret` | Keycloak client |
| `gatewayTls` | `tls.crt`, `tls.key` | Gateway TLS |

See [Secret Management](/operations/secret-management).

`WEBHOOK_SIGNING_KEY` is a reserved exception: never name it in `controlPlane.env`,
`global.transportSecurity.env`, or `controlPlane.config.inline`, and never set it directly. Chart
`0.3.1` injects one required Secret reference from `global.webhookSigningKey` and rejects every
chart-inspectable direct override. External `envFromSecrets` and `envFromConfigMaps` references
remain valid because Helm cannot inspect their keys; the dedicated explicit environment entry is
authoritative. Its non-secret identity/mode and lifecycle are documented in the
[Webhook Signing Master-Key Lifecycle Runbook](/operations/webhook-signing-key-lifecycle).
