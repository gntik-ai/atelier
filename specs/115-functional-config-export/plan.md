# Plan de Implementación: US-BKP-02-T01 — Exportación de configuración funcional de tenants

**Branch**: `115-functional-config-export` | **Fecha**: 2026-04-01 | **Spec**: `specs/115-functional-config-export/spec.md`
**Task ID**: US-BKP-02-T01 | **Epic**: EP-20 | **Story**: US-BKP-02
**Prioridad**: P1 | **Tamaño**: M
**Depende de**: US-TEN-04 (modelo de tenants), US-BKP-01 (visibilidad de backup — perfil de despliegue)
**Tareas hermanas** (excluidas de este alcance): US-BKP-02-T02–T06
**Input**: Especificación de feature desde `specs/115-functional-config-export/spec.md`

---

## Resumen ejecutivo

Implementar la capa de exportación de configuración funcional de tenants en el BaaS multi-tenant. La solución implementa un modelo de recolectores (collectors) independientes por dominio (IAM/Keycloak, metadata PostgreSQL, metadata MongoDB, Kafka topics/ACLs, funciones OpenWhisk, buckets S3-compatible), una acción OpenWhisk `tenant-config-export` que los orquesta, degradación parcial ante fallos de recolectores, y un endpoint REST expuesto vía APISIX con autenticación JWT Keycloak.

El artefacto de exportación es un documento JSON estructurado con metadata de exportación (timestamp, tenant_id, format_version, deployment_profile, dominios incluidos con su estado) y una sección por dominio. Los secretos son redactados en origen por cada recolector. La exportación opera siempre en el contexto de un único tenant_id y es una operación de solo lectura.

Decisiones de diseño clave:
- **Los recolectores son independientes y no transaccionales entre sí**: cada dominio se exporta de forma aislada; los timestamps por sección permiten al consumidor evaluar la ventana temporal.
- **La orquestación usa `Promise.allSettled`**: un recolector que falla no aborta los demás; el resultado por dominio captura `ok`, `empty`, `error` o `not_available`.
- **El formato inicial (`format_version: "1.0"`) no es el formato versionado definitivo**: US-BKP-02-T02 lo formalizará; esta tarea produce el contrato mínimo funcional.
- **El código fuente de funciones OpenWhisk se incluye en el artefacto** codificado en base64, para que el artefacto sea autocontenido. Si el tamaño supera el límite configurable `EXPORT_MAX_ARTIFACT_BYTES` (default 10 MB), se devuelve error 422 con sugerencia de filtrar por dominio.
- **Exportación síncrona en esta fase**: dado que M-sized, el procesamiento encaja en el timeout de OpenWhisk (60 s). La exportación asíncrona se difiere (P-03 de spec).

---

## Contexto técnico

- **Lenguaje/Runtime**: Node.js 20+ ESM (`"type": "module"`, pnpm workspaces) / React 18 + TypeScript (consola)
- **Compute**: Apache OpenWhisk (acciones serverless)
- **Base de datos**: PostgreSQL (auditoria de exportación); no se introduce nueva tabla de estado —el artefacto se devuelve directamente al llamante
- **Gateway**: Apache APISIX (routing, auth JWT, rate limiting)
- **IAM**: Keycloak Admin REST API (recolector IAM; autenticación del endpoint)
- **Broker de eventos**: Kafka (eventos de auditoría de exportación)
- **Storage**: API S3-compatible (recolector de buckets)
- **Serverless**: OpenWhisk REST API (recolector de funciones)
- **Base de datos documental**: MongoDB (recolector de metadata)
- **Plataforma de despliegue**: Kubernetes / OpenShift vía Helm
- **Monorepo**: `in-falcone` (estructura existente, convenciones de specs 097–114)
- **Dependencias funcionales**: US-OBS-01 (pipeline de auditoría), US-DEP-03 (perfil de despliegue), US-TEN-04 (modelo de tenants)
- **Testing**: `node:test` + `node:assert` (backend), `vitest` + React Testing Library (consola), `undici` (contract/integration HTTP)

---

## Verificación de constitución

| Principio | Estado | Notas |
|-----------|--------|-------|
| I. Separación de concerns en monorepo | ✅ PASS | Acciones en `services/provisioning-orchestrator/src/actions/`; recolectores en `services/provisioning-orchestrator/src/collectors/`; migración de auditoría en `services/provisioning-orchestrator/src/migrations/`; consola en `apps/web-console/`; contratos en `specs/115-functional-config-export/contracts/` |
| II. Entrega incremental | ✅ PASS | Los recolectores son independientes y se implementan por dominio; la acción de orquestación puede desplegarse parcialmente con recolectores stub |
| III. Compatibilidad K8s/OpenShift | ✅ PASS | Acciones OpenWhisk; migración como Helm hook; rutas APISIX en fichero de rutas existente |
| IV. Quality Gates en raíz | ✅ PASS | Tests de integración en `tests/integration/115-functional-config-export/`; tests unitarios de recolectores; tests de componentes de consola |
| V. Documentación como parte del cambio | ✅ PASS | Este plan.md, research.md, data-model.md, quickstart.md, contracts/ |

---

## Estructura del proyecto

### Documentación (esta feature)

```text
specs/115-functional-config-export/
├── spec.md                                          ← Especificación (ya existe)
├── checklist.md                                     ← Checklist de spec (ya existe)
├── plan.md                                          ← Este fichero
├── research.md                                      ← Resolución de dependencias externas
├── data-model.md                                    ← Modelo de datos, contratos de dominio, tipos
├── quickstart.md                                    ← Guía de desarrollo y tests locales
└── contracts/
    ├── tenant-config-export.json                    ← OpenAPI: endpoint de exportación
    ├── tenant-config-export-domains.json            ← OpenAPI: endpoint de dominios exportables
    └── config-export-audit-event.json               ← Schema Kafka: evento de auditoría de exportación
```

### Backend (provisioning-orchestrator)

```text
services/provisioning-orchestrator/src/
├── migrations/
│   └── 115-functional-config-export.sql             ← DDL tabla de auditoría de exportaciones
├── collectors/
│   ├── types.mjs                                    ← Interfaz CollectorResult, DomainStatus, ExportArtifact
│   ├── registry.mjs                                 ← Registro de recolectores por domain_key
│   ├── iam-collector.mjs                            ← Recolector Keycloak Admin REST API
│   ├── postgres-collector.mjs                       ← Recolector pg_catalog / information_schema
│   ├── mongo-collector.mjs                          ← Recolector MongoDB admin commands
│   ├── kafka-collector.mjs                          ← Recolector Kafka AdminClient
│   ├── functions-collector.mjs                      ← Recolector OpenWhisk REST API
│   └── s3-collector.mjs                             ← Recolector S3 API (ListBuckets, GetBucketPolicy, etc.)
├── actions/
│   ├── tenant-config-export.mjs                     ← Acción principal: orquesta recolectores + auditoría
│   └── tenant-config-export-domains.mjs             ← Acción auxiliar: dominios exportables del tenant
├── repositories/
│   └── config-export-audit-repository.mjs           ← Data access para tabla de auditoría
└── events/
    └── config-export-events.mjs                     ← Publicación de evento Kafka de auditoría
```

### Consola (web-console)

```text
apps/web-console/src/
├── pages/
│   └── ConsoleTenantConfigExportPage.tsx            ← Página de exportación de configuración
├── components/
│   ├── ConfigExportDomainSelector.tsx               ← Selector de dominios a exportar
│   └── ConfigExportResultPanel.tsx                  ← Panel de resultado / descarga del artefacto
├── api/
│   └── configExportApi.ts                           ← Funciones fetch + tipos TypeScript del endpoint
└── __tests__/
    ├── ConfigExportDomainSelector.test.tsx
    ├── ConfigExportResultPanel.test.tsx
    └── ConsoleTenantConfigExportPage.test.tsx
```

### Gateway y IAM

```text
services/gateway-config/routes/
└── backup-admin-routes.yaml                         ← EXTENDER: añadir rutas de config-export

services/keycloak-config/scopes/
└── backup-scopes.yaml                               ← EXTENDER: añadir scopes de config-export
```

### Tests de integración

```text
tests/integration/115-functional-config-export/
├── export-api.test.mjs                              ← Test E2E del endpoint de exportación
├── domains-api.test.mjs                             ← Test del endpoint de dominios exportables
├── fixtures/
│   ├── tenant-seed.sql                              ← Datos de fixture para tenant de test
│   └── keycloak-realm-seed.json                     ← Realm de test para recolector IAM
└── helpers/
    └── mock-collectors.mjs                          ← Stubs de recolectores para pruebas de orquestación
```

---

## Modelo de datos

### Tabla `config_export_audit_log`

```sql
-- Véase data-model.md para DDL completo
CREATE TABLE IF NOT EXISTS config_export_audit_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        TEXT NOT NULL,
  actor_id         TEXT NOT NULL,
  actor_type       TEXT NOT NULL CHECK (actor_type IN ('superadmin', 'sre', 'service_account')),
  domains_requested TEXT[] NOT NULL,
  domains_exported  TEXT[] NOT NULL,
  domains_failed    TEXT[] NOT NULL DEFAULT '{}',
  result_status    TEXT NOT NULL CHECK (result_status IN ('ok', 'partial', 'failed')),
  artifact_bytes   INT,
  format_version   TEXT NOT NULL DEFAULT '1.0',
  correlation_id   TEXT NOT NULL,
  export_started_at TIMESTAMPTZ NOT NULL,
  export_ended_at   TIMESTAMPTZ NOT NULL,
  error_detail     TEXT
);

CREATE INDEX IF NOT EXISTS idx_config_export_tenant ON config_export_audit_log(tenant_id, export_started_at DESC);
CREATE INDEX IF NOT EXISTS idx_config_export_actor  ON config_export_audit_log(actor_id, export_started_at DESC);
CREATE INDEX IF NOT EXISTS idx_config_export_corrId ON config_export_audit_log(correlation_id);
```

El artefacto de exportación **no se almacena** en base de datos; se devuelve como cuerpo de respuesta HTTP.

### Estructura del artefacto de exportación (JSON)

```json
{
  "export_timestamp": "2026-04-01T12:00:00.000Z",
  "tenant_id": "acme-corp",
  "format_version": "1.0",
  "deployment_profile": "standard",
  "correlation_id": "req-lx4k3a-7f2z1q",
  "domains": [
    {
      "domain_key": "iam",
      "status": "ok",
      "exported_at": "2026-04-01T12:00:01.100Z",
      "items_count": 12,
      "data": { /* recolector IAM */ }
    },
    {
      "domain_key": "postgres_metadata",
      "status": "empty",
      "exported_at": "2026-04-01T12:00:01.300Z",
      "items_count": 0,
      "data": {}
    },
    {
      "domain_key": "mongo_metadata",
      "status": "error",
      "exported_at": "2026-04-01T12:00:01.500Z",
      "error": "Connection timeout after 5000ms",
      "data": null
    },
    {
      "domain_key": "kafka",
      "status": "ok",
      "exported_at": "2026-04-01T12:00:01.700Z",
      "items_count": 5,
      "data": { /* recolector Kafka */ }
    },
    {
      "domain_key": "functions",
      "status": "not_available",
      "exported_at": "2026-04-01T12:00:01.800Z",
      "reason": "Component not present in active deployment profile: standard",
      "data": null
    },
    {
      "domain_key": "storage",
      "status": "ok",
      "exported_at": "2026-04-01T12:00:02.000Z",
      "items_count": 3,
      "data": { /* recolector S3 */ }
    }
  ]
}
```

### Evento Kafka de auditoría

**Topic**: `console.config.export.completed` (retención: 90 días)

```json
{
  "event_type": "config.export.completed",
  "correlation_id": "req-lx4k3a-7f2z1q",
  "tenant_id": "acme-corp",
  "actor_id": "admin@example.com",
  "actor_type": "superadmin",
  "domains_requested": ["iam", "postgres_metadata", "mongo_metadata", "kafka", "functions", "storage"],
  "domains_exported": ["iam", "kafka", "storage", "postgres_metadata"],
  "domains_failed": ["mongo_metadata"],
  "domains_not_available": ["functions"],
  "result_status": "partial",
  "artifact_bytes": 48230,
  "format_version": "1.0",
  "export_started_at": "2026-04-01T12:00:00.000Z",
  "export_ended_at": "2026-04-01T12:00:02.000Z"
}
```

### Variables de entorno nuevas

| Variable | Default | Descripción |
|---|---|---|
| `CONFIG_EXPORT_KEYCLOAK_ADMIN_URL` | — | URL base de Keycloak Admin REST API |
| `CONFIG_EXPORT_KEYCLOAK_REALM` | — | Realm de la plataforma |
| `CONFIG_EXPORT_KEYCLOAK_CLIENT_ID` | — | Client ID para credenciales de servicio del recolector IAM |
| `CONFIG_EXPORT_KEYCLOAK_CLIENT_SECRET` | — | Client secret (redactado; nunca en artefacto) |
| `CONFIG_EXPORT_PG_DATABASE_URL` | — | DSN PostgreSQL (lectura) para recolector PG |
| `CONFIG_EXPORT_MONGO_URI` | — | URI MongoDB (lectura) para recolector Mongo |
| `CONFIG_EXPORT_KAFKA_BROKERS` | — | Lista de brokers Kafka para recolector Kafka |
| `CONFIG_EXPORT_KAFKA_ADMIN_SASL_USERNAME` | — | SASL username para Kafka AdminClient |
| `CONFIG_EXPORT_KAFKA_ADMIN_SASL_PASSWORD` | — | SASL password (redactado en artefacto) |
| `CONFIG_EXPORT_OW_API_HOST` | — | Host OpenWhisk para recolector de funciones |
| `CONFIG_EXPORT_OW_AUTH_TOKEN` | — | Token de admin OpenWhisk (read-only; redactado en artefacto) |
| `CONFIG_EXPORT_S3_ENDPOINT` | — | Endpoint S3-compatible para recolector de storage |
| `CONFIG_EXPORT_S3_ACCESS_KEY_ID` | — | Access key S3 (lectura) |
| `CONFIG_EXPORT_S3_SECRET_ACCESS_KEY` | — | Secret key S3 (redactado en artefacto) |
| `CONFIG_EXPORT_COLLECTOR_TIMEOUT_MS` | `8000` | Timeout por recolector individual (ms) |
| `CONFIG_EXPORT_MAX_ARTIFACT_BYTES` | `10485760` | Límite de tamaño del artefacto (10 MB) |
| `CONFIG_EXPORT_KAFKA_TOPIC_COMPLETED` | `console.config.export.completed` | Topic Kafka de auditoría |
| `CONFIG_EXPORT_DEPLOYMENT_PROFILE` | `standard` | Perfil de despliegue activo (hasta US-DEP-03) |
| `CONFIG_EXPORT_OW_ENABLED` | `false` | Activa el recolector de funciones OpenWhisk |
| `CONFIG_EXPORT_MONGO_ENABLED` | `false` | Activa el recolector MongoDB |

---

## Contratos de API

Los contratos completos en formato OpenAPI 3.0 están en `specs/115-functional-config-export/contracts/`.

### `POST /v1/admin/tenants/{tenant_id}/config/export`

- **Auth**: JWT Keycloak (`Authorization: Bearer <token>`)
- **Roles permitidos**: `superadmin`, `sre`, `service_account` con scope `platform:admin:config:export`
- **Body** (opcional):

  ```json
  { "domains": ["iam", "kafka", "storage"] }
  ```

- **Respuestas**:
  - `200 OK` — exportación completa
  - `207 Multi-Status` — exportación parcial (al menos un dominio fallido)
  - `403 Forbidden` — rol insuficiente
  - `404 Not Found` — tenant inexistente
  - `422 Unprocessable Entity` — artefacto supera `EXPORT_MAX_ARTIFACT_BYTES`
  - `429 Too Many Requests` — rate limit superado

### `GET /v1/admin/tenants/{tenant_id}/config/export/domains`

- **Auth**: misma auth que exportación
- **Respuesta**:

  ```json
  {
    "tenant_id": "acme-corp",
    "deployment_profile": "standard",
    "domains": [
      { "domain_key": "iam", "availability": "available", "description": "IAM configuration (Keycloak)" },
      { "domain_key": "functions", "availability": "not_available", "reason": "OpenWhisk not in profile 'standard'" }
    ]
  }
  ```

---

## Estrategia de pruebas

### Unitarias (por recolector)

- `iam-collector.test.mjs`: mock de Keycloak Admin API, verifica redacción de secrets, tenant isolation
- `postgres-collector.test.mjs`: mock de pg client, verifica extracción de schemas/tablas/grants
- `mongo-collector.test.mjs`: mock de MongoClient, verifica extracción de colecciones/índices
- `kafka-collector.test.mjs`: mock de kafkajs Admin, verifica topics y ACLs filtrados por tenant
- `functions-collector.test.mjs`: mock de OpenWhisk REST API, verifica redacción de env vars secretas
- `s3-collector.test.mjs`: mock de S3 client, verifica buckets + políticas filtrados por tenant
- `tenant-config-export.action.test.mjs`: orquestador con collectors mock, verifica degradación parcial, formato de artefacto, generación de correlation_id

### Contrato / integración (undici + real services en CI)

- `export-api.test.mjs`: invoca el endpoint real de APISIX, verifica estructura del artefacto, CA-12
- `domains-api.test.mjs`: verifica respuesta de dominios exportables

### Validación de CA

| CA | Test |
|----|------|
| CA-01 | `export-api.test.mjs` — exportación completa |
| CA-02 | `export-api.test.mjs` — body con `domains: ["iam","functions"]` |
| CA-03 | `export-api.test.mjs` — perfil sin OpenWhisk |
| CA-04 | `functions-collector.test.mjs` — tenant sin funciones |
| CA-05 | `functions-collector.test.mjs` + `export-api.test.mjs` — redacción de env vars |
| CA-06 | `tenant-config-export.action.test.mjs` — mongo collector timeout → 207 |
| CA-07 | `iam-collector.test.mjs` — filtrado por tenant_id |
| CA-08 | `export-api.test.mjs` — tenant owner → 403 |
| CA-09 | `export-api.test.mjs` — verificar evento Kafka emitido |
| CA-10 | `domains-api.test.mjs` — OpenWhisk not_available |
| CA-11 | `export-api.test.mjs` — dos exportaciones consecutivas sin cambios → contenido idéntico |
| CA-12 | `export-api.test.mjs` — inspeccion de metadata raíz |

---

## Secuencia de implementación recomendada

### Paso 1: Infraestructura compartida (sin dependencias externas)

1. `services/provisioning-orchestrator/src/collectors/types.mjs` — tipos compartidos
2. `services/provisioning-orchestrator/src/collectors/registry.mjs` — registro de recolectores
3. `services/provisioning-orchestrator/src/migrations/115-functional-config-export.sql` — tabla de auditoría
4. `services/provisioning-orchestrator/src/repositories/config-export-audit-repository.mjs`
5. `services/provisioning-orchestrator/src/events/config-export-events.mjs`

### Paso 2: Acción de orquestación (con collectors stub)

1. `tenant-config-export.mjs` — acción principal con `Promise.allSettled`, auth, artefacto, auditoría
2. `tenant-config-export-domains.mjs` — acción auxiliar
3. Tests unitarios del orquestador con collectors mock

### Paso 3: Recolectores por orden de complejidad creciente

1. `iam-collector.mjs` (Keycloak Admin REST API — bien documentada)
2. `s3-collector.mjs` (API S3 estándar)
3. `kafka-collector.mjs` (kafkajs AdminClient ya en uso en el proyecto)
4. `postgres-collector.mjs` (pg + information_schema — ya hay patrones en el proyecto)
5. `functions-collector.mjs` (OpenWhisk REST API + code base64)
6. `mongo-collector.mjs` (MongoClient — mayor heterogeneidad de entornos)

### Paso 4: Rutas APISIX, scopes Keycloak y consola

1. Extensión de `backup-admin-routes.yaml`
2. Extensión de `backup-scopes.yaml`
3. Componentes de consola: `ConfigExportDomainSelector`, `ConfigExportResultPanel`, `ConsoleTenantConfigExportPage`

### Paso 5: Tests de integración y artefactos de spec

1. Tests E2E en `tests/integration/115-functional-config-export/`
2. Actualización de AGENTS.md

---

## Riesgos y mitigaciones

| ID | Riesgo | Mitigación |
|----|--------|-----------|
| R-01 | Credenciales de servicio no configuradas para algún subsistema | Recolector hace fallback a `not_available` con mensaje descriptivo; no bloquea la exportación global |
| R-02 | APIs administrativas con comportamientos heterogéneos | Contrato de salida común (`CollectorResult`) independiente de la implementación de extracción; recolectores probados con mocks |
| R-03 | Artefactos grandes por gran volumen de configuración | `EXPORT_MAX_ARTIFACT_BYTES` configurable; filtrado por dominio como mitigación operativa; error 422 claro |
| R-04 | Fuga de secretos si la heurística de redacción falla | Lista explícita de campos sensibles por tipo de objeto en cada recolector; complementada con pattern matching en `types.mjs` (`redactSensitiveFields`); revisión de seguridad en checklist de done |
| R-05 | Inconsistencia temporal cross-domain | Timestamps por sección en el artefacto; documentado en spec como comportamiento esperado (snapshot best-effort) |

---

## Criterios de done

- [ ] Migración `115-functional-config-export.sql` aplicable con `psql` sin errores
- [ ] Seis recolectores implementados (IAM, PG, Mongo, Kafka, Functions, S3) con sus tests unitarios
- [ ] `tenant-config-export.mjs` orquesta recolectores con `Promise.allSettled`; degradación parcial verificada
- [ ] `tenant-config-export-domains.mjs` devuelve lista de dominios con `availability` correcta según perfil
- [ ] Artefacto JSON cumple estructura RF-T01-08: metadata raíz + secciones por dominio
- [ ] Redacción de secretos verificada en tests (CA-05)
- [ ] Aislamiento multi-tenant verificado (CA-07)
- [ ] Autorización 403 para tenant owner verificada (CA-08)
- [ ] Evento Kafka `console.config.export.completed` emitido y consumible
- [ ] Rutas APISIX documentadas y extendidas en `backup-admin-routes.yaml`
- [ ] Página de consola `ConsoleTenantConfigExportPage` con tests de componentes
- [ ] Tests de integración en `tests/integration/115-functional-config-export/` pasan
- [ ] AGENTS.md actualizado con sección de Functional Config Export
- [ ] Ningún secreto en texto plano en artefactos de test ni en el repositorio

---

## Dependencias externas y fallbacks

| Dependencia | Estado | Fallback |
|---|---|---|
| US-TEN-04 (modelo de tenants) | Asumido disponible (convención: namespace/prefix por subsistema) | Recolectores documentan la convención de scoping usada; si no hay registro centralizado, usan prefijo configurado vía env var |
| US-BKP-01 (perfil de despliegue) | Disponible parcialmente (`deployment_profile_registry` de spec 114) | `CONFIG_EXPORT_DEPLOYMENT_PROFILE` env var con valor manual hasta US-DEP-03 |
| US-OBS-01 (pipeline de auditoría) | Disponible (topic Kafka) | El evento de auditoría de exportación publica en un topic propio; compatible con el pipeline OBS-01 |
| `backup-admin-routes.yaml` | Verificar si existe | Si no existe, crear; si existe, añadir secciones de config-export |
| OpenWhisk en entorno de desarrollo | Puede no estar disponible | `CONFIG_EXPORT_OW_ENABLED=false` → recolector devuelve `not_available` sin error |
| MongoDB en entorno de desarrollo | Puede no estar disponible | `CONFIG_EXPORT_MONGO_ENABLED=false` → recolector devuelve `not_available` sin error |

---

*Plan generado para el stage `speckit.plan` — US-BKP-02-T01 | Rama: `115-functional-config-export`*
