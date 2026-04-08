# Environment Variables

Reference for all environment variables used across In Falcone services.

## Bootstrap

| Variable | Service | Description |
|----------|---------|-------------|
| `KEYCLOAK_ADMIN_USER` | Bootstrap | Keycloak admin username |
| `KEYCLOAK_ADMIN_PASSWORD` | Bootstrap | Keycloak admin password |
| `APISIX_ADMIN_KEY` | Bootstrap | APISIX admin API key |

## Control Plane

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `production` | Node.js environment |
| `PORT` | `8080` | HTTP listen port |
| `LOG_LEVEL` | `info` | Log level (debug, info, warn, error) |
| `DEPLOYMENT_PROFILE` | `standard` | Deployment profile name |
| `DATABASE_URL` | — | PostgreSQL connection string |
| `MONGODB_URL` | — | MongoDB connection string |
| `KAFKA_BROKERS` | — | Comma-separated Kafka broker addresses |
| `KEYCLOAK_URL` | — | Keycloak base URL |
| `KEYCLOAK_REALM` | `in-falcone-platform` | Platform realm name |
| `OPENWHISK_API_HOST` | — | OpenWhisk API endpoint |
| `MINIO_ENDPOINT` | — | MinIO S3 endpoint |
| `MINIO_ACCESS_KEY` | — | MinIO access key |
| `MINIO_SECRET_KEY` | — | MinIO secret key |

## Web Console

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `production` | Environment |
| `PUBLIC_BASE_PATH` | `/` | Base path for the SPA |
| `VITE_CONSOLE_AUTH_REALM` | `in-falcone-platform` | Keycloak realm |
| `VITE_CONSOLE_AUTH_CLIENT_ID` | `in-falcone-console` | OAuth 2.0 client ID |
| `VITE_CONSOLE_AUTH_LOGIN_PATH` | `/login` | Login route |
| `VITE_CONSOLE_AUTH_SIGNUP_PATH` | `/signup` | Signup route |
| `VITE_CONSOLE_AUTH_TITLE` | `Accede a In Falcone Console` | Login page title |
| `VITE_CONSOLE_SIGNUP_TITLE` | `Crea tu acceso a In Falcone Console` | Signup page title |

## Provisioning Orchestrator

| Variable | Default | Description |
|----------|---------|-------------|
| `PO_DATABASE_URL` | — | PostgreSQL connection for orchestrator |
| `PO_KEYCLOAK_URL` | — | Keycloak admin API URL |
| `PO_OPENWHISK_URL` | — | OpenWhisk API URL |
| `PO_MONGODB_URL` | — | MongoDB admin connection |
| `PO_KAFKA_BROKERS` | — | Kafka broker addresses |
| `PO_S3_ENDPOINT` | — | S3/MinIO endpoint |
| `PO_VAULT_ADDR` | — | Vault API address |

## Realtime Gateway

| Variable | Default | Description |
|----------|---------|-------------|
| `RG_PORT` | `8080` | WebSocket listen port |
| `RG_KEYCLOAK_JWKS_URL` | — | JWKS endpoint for JWT validation |
| `RG_KEYCLOAK_INTROSPECTION_URL` | — | Token introspection URL |
| `RG_KAFKA_BROKERS` | — | Kafka broker addresses |
| `RG_KAFKA_GROUP_ID` | `realtime-gateway` | Kafka consumer group |
| `RG_MAX_SUBSCRIPTIONS` | `100` | Max subscriptions per connection |

## Event Gateway

| Variable | Default | Description |
|----------|---------|-------------|
| `EG_PORT` | `8080` | HTTP listen port |
| `EG_KAFKA_BROKERS` | — | Kafka broker addresses |
| `EG_KAFKA_CLIENT_ID` | `event-gateway` | Kafka producer client ID |

## PostgreSQL CDC Bridge

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | — | PostgreSQL connection (with replication) |
| `PG_CDC_KAFKA_BROKERS` | — | Kafka broker addresses |
| `PG_CDC_KAFKA_TOPIC` | `console.pg-capture.lifecycle` | Output Kafka topic |
| `PG_CDC_CACHE_TTL_SECONDS` | `30` | CDC event cache TTL |
| `WAL_KEEP_THRESHOLD_MB` | `512` | WAL retention threshold |
| `MAX_EVENTS_PER_SECOND` | `1000` | Rate limit for CDC events |

## Backup Status

| Variable | Default | Description |
|----------|---------|-------------|
| `BS_DATABASE_URL` | — | PostgreSQL connection |
| `BS_KAFKA_BROKERS` | — | Kafka broker addresses |
| `BS_MFA_ENABLED` | `true` | MFA required for restore confirmations |
| `BS_OPERATIONAL_HOURS_START` | `09:00` | Start of operational window |
| `BS_OPERATIONAL_HOURS_END` | `18:00` | End of operational window |

## Vault

| Variable | Default | Description |
|----------|---------|-------------|
| `VAULT_ADDR` | — | Vault API address |
| `VAULT_NAMESPACE` | `admin` | Vault namespace |
| `VAULT_TOKEN` | — | Vault authentication token |
| `VAULT_CACERT` | — | Path to Vault CA certificate |

## Infrastructure

### PostgreSQL

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_USER` | `postgres` | Superuser username |
| `POSTGRES_PASSWORD` | — | Superuser password |
| `POSTGRES_DB` | `falcone` | Default database |
| `PGDATA` | `/bitnami/postgresql/data` | Data directory |

### MongoDB

| Variable | Default | Description |
|----------|---------|-------------|
| `MONGODB_ROOT_USER` | `root` | Root username |
| `MONGODB_ROOT_PASSWORD` | — | Root password |

### Kafka

| Variable | Default | Description |
|----------|---------|-------------|
| `KAFKA_CFG_AUTO_CREATE_TOPICS_ENABLE` | `false` | Auto topic creation |
| `KAFKA_CFG_LISTENERS` | `PLAINTEXT://:9092` | Listener configuration |
| `KAFKA_CFG_NUM_PARTITIONS` | `3` | Default partition count |

### MinIO

| Variable | Default | Description |
|----------|---------|-------------|
| `MINIO_ROOT_USER` | — | Root access key |
| `MINIO_ROOT_PASSWORD` | — | Root secret key |
| `MINIO_BROWSER_REDIRECT_URL` | — | Console redirect URL |
