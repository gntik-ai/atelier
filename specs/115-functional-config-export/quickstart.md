# Quickstart — US-BKP-02-T01: Exportación de configuración funcional de tenants

## Prerrequisitos

- Node.js 20+ instalado
- pnpm instalado
- PostgreSQL accesible (`DATABASE_URL` configurada)
- Variables de entorno configuradas (ver sección abajo)

---

## Ejecutar la migración

```bash
psql "$DATABASE_URL" \
  -f services/provisioning-orchestrator/src/migrations/115-functional-config-export.sql
```

## Verificar la migración

```sql
-- Tabla de auditoría creada
\d config_export_audit_log;

-- Índices presentes
SELECT indexname FROM pg_indexes
WHERE tablename = 'config_export_audit_log';
-- Esperado: idx_config_export_tenant, idx_config_export_actor, idx_config_export_corr_id
```

---

## Variables de entorno requeridas

```bash
# PostgreSQL — auditoría
export DATABASE_URL="postgresql://user:password@localhost:5432/falcone"

# Keycloak Admin API (recolector IAM)
export CONFIG_EXPORT_KEYCLOAK_ADMIN_URL="http://localhost:8080"
export CONFIG_EXPORT_KEYCLOAK_REALM="master"
export CONFIG_EXPORT_KEYCLOAK_CLIENT_ID="export-service"
export CONFIG_EXPORT_KEYCLOAK_CLIENT_SECRET="<secret>"

# PostgreSQL tenant metadata (recolector PG)
export CONFIG_EXPORT_PG_DATABASE_URL="$DATABASE_URL"

# Kafka (recolector Kafka)
export CONFIG_EXPORT_KAFKA_BROKERS="localhost:9092"
export CONFIG_EXPORT_KAFKA_ADMIN_SASL_USERNAME="admin"
export CONFIG_EXPORT_KAFKA_ADMIN_SASL_PASSWORD="<password>"

# S3 (recolector storage)
export CONFIG_EXPORT_S3_ENDPOINT="http://localhost:9000"
export CONFIG_EXPORT_S3_ACCESS_KEY_ID="minioadmin"
export CONFIG_EXPORT_S3_SECRET_ACCESS_KEY="<secret>"

# Componentes opcionales (desactivados por defecto en dev)
export CONFIG_EXPORT_OW_ENABLED="false"
export CONFIG_EXPORT_MONGO_ENABLED="false"

# Ajustes de comportamiento
export CONFIG_EXPORT_COLLECTOR_TIMEOUT_MS="8000"
export CONFIG_EXPORT_MAX_ARTIFACT_BYTES="10485760"
export CONFIG_EXPORT_KAFKA_TOPIC_COMPLETED="console.config.export.completed"
export CONFIG_EXPORT_DEPLOYMENT_PROFILE="standard"
```

---

## Ejecutar tests unitarios de recolectores

```bash
cd services/provisioning-orchestrator

# Todos los tests de collectors
node --test src/collectors/*.test.mjs

# Test de un recolector específico
node --test src/collectors/iam-collector.test.mjs
node --test src/collectors/kafka-collector.test.mjs

# Test de la acción principal de exportación
node --test src/actions/tenant-config-export.test.mjs
node --test src/actions/tenant-config-export-domains.test.mjs
```

## Ejecutar tests de integración

```bash
# Requiere PostgreSQL, Kafka, y APISIX accesibles
node --test tests/integration/115-functional-config-export/export-api.test.mjs
node --test tests/integration/115-functional-config-export/domains-api.test.mjs

# Suite completa de integración
node --test tests/integration/115-functional-config-export/
```

## Ejecutar tests de consola

```bash
cd apps/web-console

# Tests de componentes de exportación
pnpm vitest run src/__tests__/ConfigExportDomainSelector.test.tsx
pnpm vitest run src/__tests__/ConfigExportResultPanel.test.tsx
pnpm vitest run src/__tests__/ConsoleTenantConfigExportPage.test.tsx

# Todos los tests de consola
pnpm vitest run
```

---

## Invocar la exportación manualmente (vía curl)

### Exportar todos los dominios disponibles

```bash
TOKEN=$(curl -s -X POST \
  "${CONFIG_EXPORT_KEYCLOAK_ADMIN_URL}/realms/master/protocol/openid-connect/token" \
  -d "grant_type=client_credentials" \
  -d "client_id=${CONFIG_EXPORT_KEYCLOAK_CLIENT_ID}" \
  -d "client_secret=${CONFIG_EXPORT_KEYCLOAK_CLIENT_SECRET}" \
  | jq -r '.access_token')

curl -s -X POST \
  "http://localhost:9080/v1/admin/tenants/acme-corp/config/export" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  | jq .
```

### Exportar solo IAM y Kafka

```bash
curl -s -X POST \
  "http://localhost:9080/v1/admin/tenants/acme-corp/config/export" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"domains": ["iam", "kafka"]}' \
  | jq .
```

### Consultar dominios exportables

```bash
curl -s \
  "http://localhost:9080/v1/admin/tenants/acme-corp/config/export/domains" \
  -H "Authorization: Bearer $TOKEN" \
  | jq .
```

---

## Activar componentes opcionales en desarrollo

### Activar MongoDB

```bash
export CONFIG_EXPORT_MONGO_ENABLED="true"
export CONFIG_EXPORT_MONGO_URI="mongodb://localhost:27017"
```

### Activar OpenWhisk

```bash
export CONFIG_EXPORT_OW_ENABLED="true"
export CONFIG_EXPORT_OW_API_HOST="http://localhost:3233"
export CONFIG_EXPORT_OW_AUTH_TOKEN="<admin-token>"
```

---

## Verificar el evento Kafka de auditoría

```bash
# Consumir el topic de auditoría (requiere kcat o kafka-console-consumer)
kcat -b localhost:9092 \
  -t console.config.export.completed \
  -o end -e -C \
  | jq .
```

---

## Verificar la tabla de auditoría en PostgreSQL

```sql
SELECT
  tenant_id,
  actor_type,
  domains_requested,
  domains_exported,
  domains_failed,
  result_status,
  artifact_bytes,
  export_ended_at - export_started_at AS duration
FROM config_export_audit_log
ORDER BY export_started_at DESC
LIMIT 10;
```
