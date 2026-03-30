# Implementation Plan: Reintentos Idempotentes con Deduplicación por Idempotency Key

**Branch**: `075-idempotent-retry-dedup` | **Date**: 2026-03-30 | **Spec**: [spec.md](./spec.md)  
**Task**: US-UIB-02-T03 | **Epic**: EP-16 | **Historia**: US-UIB-02 | **Prioridad**: P0

## Summary

Implementar deduplicación de solicitudes de aprovisionamiento mediante idempotency keys scoped por tenant, y un mecanismo de reintento seguro para operaciones en estado `failed`. Extiende el modelo de operaciones asíncronas establecido en T01/T02 con: (1) una tabla de registro de idempotency keys con TTL configurable, (2) resolución atómica de concurrencia via `INSERT ... ON CONFLICT`, (3) una acción OpenWhisk `async-operation-retry` que crea un nuevo intento vinculado a la operación original, y (4) un sistema de eventos auditables para deduplicaciones y reintentos.

## Technical Context

**Language/Version**: Node.js 20+ ESM (`"type": "module"`, pnpm workspaces)  
**Primary Dependencies**: `pg` (PostgreSQL), `kafkajs` (Kafka broker), Apache OpenWhisk action wrapper patterns establecidos en T01/T02  
**Storage**: PostgreSQL (idempotency_key_records, retry_attempts + extensión de async_operations), Kafka (eventos auditables)  
**Testing**: Node.js built-in `node:test`, mocks de dependencias via inyección (patrón existente en el proyecto)  
**Target Platform**: Apache OpenWhisk (actions), Kubernetes/OpenShift (Helm), APISIX (API Gateway)  
**Project Type**: Backend BaaS multi-tenant — servicio de orquestación de aprovisionamiento  
**Performance Goals**: resolución de deduplicación < 50ms p95 (query PostgreSQL + índice único), reintento < 3s SC-003  
**Constraints**: idempotencia obligatoria, aislamiento multi-tenant en todas las queries, secretos nunca en repo, no cambiar stack  
**Scale/Scope**: Todos los tenants/workspaces de la plataforma; volumen esperado acorde con operaciones de consola administrativa

## Constitution Check

*GATE: Evaluado antes de Phase 0. Re-evaluado tras Phase 1.*

| Principio | Estado | Observación |
|-----------|--------|-------------|
| I. Monorepo SoC | ✅ PASS | Todo código nuevo va bajo `services/provisioning-orchestrator/src/`. Sin nuevos top-level dirs. |
| II. Incremental Delivery | ✅ PASS | Cambios aditivos: nueva tabla, nuevas actions, nuevos módulos. Nada se rompe en T01/T02. |
| III. K8s/OpenShift compat | ✅ PASS | Sin cambios de infraestructura directa; Helm values nuevos son aditivos. |
| IV. Quality Gates at Root | ✅ PASS | Tests nuevos siguen el patrón `node:test` existente; se ejecutan desde root. |
| V. Docs as part of change | ✅ PASS | `plan.md` + `data-model.md` + `contracts/` son parte de esta entrega. |
| Secrets | ✅ PASS | Sin secretos en código; configuración via env vars / Helm values. |
| pnpm workspaces | ✅ PASS | Sin nuevas dependencias externas; reutiliza `pg`, `kafkajs` ya presentes. |

**Resultado**: Sin violaciones. Se puede continuar.

## Project Structure

### Documentation (esta feature)

```text
specs/075-idempotent-retry-dedup/
├── spec.md                         # Especificación funcional (entregada)
├── plan.md                         # Este archivo
├── research.md                     # Phase 0 output
├── data-model.md                   # Phase 1 output
├── contracts/
│   ├── idempotency-key-record.json         # Schema entidad
│   ├── retry-attempt.json                  # Schema entidad
│   ├── async-operation-retry-request.json  # Contrato entrada acción retry
│   ├── async-operation-retry-response.json # Contrato salida acción retry
│   ├── idempotency-dedup-event.json        # Schema evento auditable deduplicación
│   └── operation-retry-event.json          # Schema evento auditable reintento
└── tasks.md                        # Phase 2 output (speckit.tasks — NO creado aquí)
```

### Source Code (repository root)

```text
services/provisioning-orchestrator/
├── package.json
└── src/
    ├── models/
    │   ├── async-operation.mjs                  # EXTENDER: idempotency_key, attempt_count, max_retries
    │   ├── async-operation-states.mjs           # SIN CAMBIO (transiciones ya definidas)
    │   ├── idempotency-key-record.mjs           # NUEVO: modelo de dominio del registro de idempotency key
    │   └── retry-attempt.mjs                    # NUEVO: modelo de dominio del intento de reintento
    ├── repositories/
    │   ├── async-operation-repo.mjs             # EXTENDER: findByIdempotencyKey, updateAttemptCount
    │   ├── async-operation-query-repo.mjs       # SIN CAMBIO
    │   ├── idempotency-key-repo.mjs             # NUEVO: upsert atómico, lookup, TTL check
    │   └── retry-attempt-repo.mjs               # NUEVO: create, findByOperationId
    ├── actions/
    │   ├── async-operation-create.mjs           # EXTENDER: deduplicación por idempotency key previa a persist
    │   ├── async-operation-retry.mjs            # NUEVO: acción OpenWhisk para reintento seguro
    │   ├── async-operation-transition.mjs       # SIN CAMBIO
    │   └── async-operation-query.mjs            # SIN CAMBIO
    ├── events/
    │   ├── async-operation-events.mjs           # EXTENDER: buildDeduplicationEvent, buildRetryEvent
    ├── migrations/
    │   ├── 073-async-operation-tables.sql       # SIN CAMBIO
    │   ├── 074-async-operation-log-entries.sql  # SIN CAMBIO
    │   └── 075-idempotency-retry-tables.sql     # NUEVO: tablas idempotency_key_records + retry_attempts + ALTER
    ├── authorization-context.mjs                # SIN CAMBIO
    └── contract-boundary.mjs                    # EXTENDER: exports de los nuevos schemas

services/internal-contracts/src/
    ├── idempotency-dedup-event.json             # NUEVO: schema Kafka para evento deduplicación
    ├── operation-retry-event.json               # NUEVO: schema Kafka para evento reintento
    └── index.mjs                                # EXTENDER: exportar nuevos schemas

tests/
├── unit/
│   ├── idempotency-key-record.test.mjs          # NUEVO
│   ├── retry-attempt.test.mjs                   # NUEVO
│   └── async-operation-retry.test.mjs           # NUEVO
├── integration/
│   ├── idempotency-dedup.test.mjs               # NUEVO: deduplicación en PostgreSQL real / mock
│   └── retry-safe.test.mjs                      # NUEVO: reintento en estado failed
└── contract/
    ├── idempotency-dedup-event.contract.test.mjs # NUEVO
    └── operation-retry-event.contract.test.mjs   # NUEVO
```

**Structure Decision**: Se sigue Option 1 (single project) con la estructura ya establecida en T01/T02 bajo `services/provisioning-orchestrator/src/`. No se crean nuevos top-level folders. El código de tests sigue la estructura `tests/{unit,integration,contract}` del proyecto.

---

## Phase 0: Research

### R-001 — Resolución de concurrencia en PostgreSQL para idempotency keys

**Decision**: `INSERT INTO idempotency_key_records (...) ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING *` + posterior SELECT si el INSERT no retorna fila.  
**Rationale**: PostgreSQL garantiza atomicidad del INSERT bajo la constraint UNIQUE. El patrón `INSERT … ON CONFLICT DO NOTHING` es el estándar para deduplicación sin bloqueos explícitos. Sin `SERIALIZABLE`, el nivel `READ COMMITTED` es suficiente porque el UNIQUE constraint actúa como barrera de concurrencia.  
**Alternatives considered**: advisory locks (mayor complejidad, más lento), `SERIALIZABLE` isolation (overhead excesivo para este volumen), Redis SETNX (introduciría dependencia nueva no en el stack).  
**Conclusión**: Sin NEEDS CLARIFICATION. PostgreSQL con UNIQUE constraint es la solución correcta y ya disponible.

---

### R-002 — Estructura de retry_attempts vs extensión de async_operations

**Decision**: Tabla separada `retry_attempts` vinculada a `async_operations` via `operation_id` + `attempt_number`.  
**Rationale**: La operación original mantiene su identidad (`operation_id`, `idempotency_key`). Cada intento es un registro independiente con su propio `correlation_id`, `status`, `created_at`. Esto preserva la traza completa del ciclo de vida sin mutar el registro original.  
**Alternatives considered**: array JSONB en `async_operations` (pierde índices, trazabilidad débil), columnas `attempt_count/last_retry_at` sin tabla separada (no preserva historial de intentos).  
**Conclusión**: Tabla `retry_attempts` separada es la opción correcta.

---

### R-003 — Ventana de validez de idempotency keys (TTL)

**Decision**: TTL por defecto de 48 horas, configurable via variable de entorno `IDEMPOTENCY_KEY_TTL_HOURS`. Verificación via `expires_at TIMESTAMPTZ` en la tabla; no se usa job de purga en este scope (T04 podrá añadirlo).  
**Rationale**: 48h cubre todos los flujos normales de consola. La expiración se verifica en la query de lookup (`WHERE expires_at > NOW()`). Registros expirados son invisibles y se sobreescriben en el próximo INSERT con la misma key.  
**Conclusión**: Sin NEEDS CLARIFICATION.

---

### R-004 — Límite máximo de reintentos

**Decision**: Configurable por `operation_type` via tabla de configuración `operation_type_config` (JSON) o variable de entorno. Valor por defecto: 5 reintentos. Almacenado en `async_operations.max_retries` (nullable; null = valor por defecto del sistema).  
**Rationale**: Diferente tipos de operación (create-workspace vs enable-service) pueden requerir límites diferentes. El valor por defecto de 5 es conservador y evita bucles infinitos.  
**Conclusión**: Sin NEEDS CLARIFICATION.

---

### R-005 — Topics Kafka para eventos auditables

**Decision**: Dos topics nuevos:
- `console.async-operation.deduplicated` — evento de deduplicación  
- `console.async-operation.retry-requested` — evento de reintento  
**Rationale**: Separarlos del topic `console.async-operation.state-changed` (T01) permite consumidores independientes para auditoría sin contaminar el flujo de estado. Consistente con la arquitectura de topics del proyecto.  
**Conclusión**: Sin NEEDS CLARIFICATION.

---

## Phase 1: Design & Contracts

### Data Model

Ver [data-model.md](./data-model.md) para DDL completo. Resumen:

#### Nueva tabla: `idempotency_key_records`

```sql
CREATE TABLE idempotency_key_records (
  record_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         TEXT        NOT NULL,
  idempotency_key   TEXT        NOT NULL,
  operation_id      UUID        NOT NULL REFERENCES async_operations(operation_id),
  operation_type    TEXT        NOT NULL,
  params_hash       TEXT        NOT NULL,   -- SHA-256 hex de los parámetros (para detección de discrepancia)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ NOT NULL,
  CONSTRAINT uq_idempotency_key_tenant UNIQUE (tenant_id, idempotency_key)
);
```

**Índices**: `(tenant_id, idempotency_key)` (UNIQUE), `(expires_at)` parcial para purga futura.

**Scoping**: La UNIQUE constraint opera sobre `(tenant_id, idempotency_key)`, garantizando aislamiento multi-tenant.

#### Nueva tabla: `retry_attempts`

```sql
CREATE TABLE retry_attempts (
  attempt_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id      UUID        NOT NULL REFERENCES async_operations(operation_id),
  tenant_id         TEXT        NOT NULL,
  attempt_number    INT         NOT NULL,
  correlation_id    TEXT        NOT NULL,
  actor_id          TEXT        NOT NULL,
  actor_type        TEXT        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'pending',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ,
  metadata          JSONB,
  CONSTRAINT uq_retry_attempt_number UNIQUE (operation_id, attempt_number),
  CONSTRAINT retry_attempt_status_check CHECK (status IN ('pending', 'running', 'completed', 'failed'))
);
```

**Índices**: `(operation_id, attempt_number)` (UNIQUE), `(tenant_id, status)`.

#### Extensión de `async_operations` (ALTER TABLE)

```sql
ALTER TABLE async_operations
  ADD COLUMN IF NOT EXISTS attempt_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_retries   INT;
```

`max_retries NULL` significa "usar valor por defecto del sistema". `attempt_count` se incrementa atómicamente al crear un `retry_attempt`.

#### Restricción de formato de idempotency_key

- Longitud: 1–128 caracteres  
- Caracteres permitidos: `[a-zA-Z0-9_\-]` (sin espacios, sin caracteres especiales)  
- Validación en capa de modelo (Node.js) antes de la query

---

### Arquitectura y Flujo

```text
Actor/Console
    │
    ▼ POST /operations  (con o sin Idempotency-Key header)
APISIX Gateway
    │  (valida JWT Keycloak, extrae tenant_id + actor_id)
    ▼
OpenWhisk Action: async-operation-create (EXTENDIDO)
    │
    ├─► [idempotency_key presente?]
    │       │
    │       ▼ YES
    │   idempotency-key-repo.findActive(tenant_id, key)
    │       │
    │       ├─► [FOUND & válido]  ──► retornar operación existente
    │       │                         + evento "deduplicated" en Kafka
    │       │                         + header X-Idempotent-Replayed: true
    │       │
    │       └─► [NOT FOUND o expirado]
    │               │
    │               ▼
    │           INSERT async_operations (nueva operación)
    │           INSERT idempotency_key_records (ON CONFLICT DO NOTHING)
    │           ├─► [conflict] → re-fetch (carrera ganada por otro worker)
    │           └─► [ok] → publicar estado_changed + retornar nueva operación
    │
    └─► [sin idempotency_key] → flujo original T01 (sin cambios)

─────────────────────────────────────────────────────────────────

Actor/Console
    │
    ▼ POST /operations/{operation_id}/retry
APISIX Gateway
    ▼
OpenWhisk Action: async-operation-retry (NUEVO)
    │
    ├─► Verificar tenant ownership (aislamiento multi-tenant)
    ├─► Cargar operación original (findById)
    ├─► Validar estado = 'failed'  ──[no]──► 409 Conflict
    ├─► Verificar attempt_count < max_retries  ──[no]──► 422 Unprocessable
    ├─► BEGIN TRANSACTION
    │       INSERT retry_attempts (attempt_number = attempt_count + 1, nuevo correlation_id)
    │       UPDATE async_operations SET status='pending', attempt_count++, updated_at=NOW()
    │       INSERT async_operation_transitions
    │   COMMIT
    ├─► Publicar evento retry-requested en Kafka
    └─► Retornar { attemptId, operationId, attemptNumber, correlationId, status: 'pending' }
```

---

### Módulos implicados y límites entre componentes

| Módulo | Rol | Dependencias |
|--------|-----|--------------|
| `models/idempotency-key-record.mjs` | Crear/validar registros de idempotency key | `node:crypto` (SHA-256 hash) |
| `models/retry-attempt.mjs` | Crear/validar intentos de reintento | `node:crypto` (UUID), `async-operation.mjs` (generateCorrelationId) |
| `repositories/idempotency-key-repo.mjs` | Persistencia de idempotency keys (INSERT ON CONFLICT, SELECT) | `pg` |
| `repositories/retry-attempt-repo.mjs` | Persistencia de intentos de reintento | `pg` |
| `repositories/async-operation-repo.mjs` | EXTENDER: atomicIncrementAttemptCount, resetToRetry | `pg` |
| `actions/async-operation-create.mjs` | EXTENDER: deduplicación pre-persist | repos, events, models |
| `actions/async-operation-retry.mjs` | Nueva acción OpenWhisk para reintento | repos, events, models |
| `events/async-operation-events.mjs` | EXTENDER: buildDeduplicationEvent, buildRetryEvent, publishDeduplication, publishRetry | `kafkajs` |
| `internal-contracts/src/idempotency-dedup-event.json` | Schema Kafka evento deduplicación | — |
| `internal-contracts/src/operation-retry-event.json` | Schema Kafka evento reintento | — |
| `migrations/075-idempotency-retry-tables.sql` | DDL nuevas tablas + ALTER | PostgreSQL |

---

### Contratos de API

#### POST /operations (extensión del contrato existente)

**Request** — header adicional (opcional):

```text
Idempotency-Key: <string 1-128 chars [a-zA-Z0-9_-]>
```

**Response 200** — operación creada o deduplicada:

```json
{
  "operationId": "uuid",
  "status": "pending",
  "correlationId": "op:tenant:ts:hash",
  "createdAt": "ISO8601",
  "idempotent": false
}
```

**Response 200** — deduplicada (operación existente retornada):

```json
{
  "operationId": "uuid",
  "status": "pending|running|completed|failed",
  "correlationId": "op:tenant:ts:hash",
  "createdAt": "ISO8601",
  "idempotent": true,
  "paramsMismatch": false
}
```

Header adicional en respuesta deduplicada: `X-Idempotent-Replayed: true`

**Response 409** — conflict (misma key, tipo distinto):

```json
{
  "error": "IDEMPOTENCY_KEY_CONFLICT",
  "message": "Idempotency key already associated with a different operation type",
  "existingOperationType": "create-workspace"
}
```

**Response 400** — idempotency key inválida:

```json
{
  "error": "INVALID_IDEMPOTENCY_KEY",
  "message": "Idempotency key exceeds maximum length or contains invalid characters"
}
```

---

#### POST /operations/{operation_id}/retry (nuevo endpoint)

**Request**:

```json
{}
```

*(sin body; los parámetros se preservan de la operación original)*

**Response 200** — reintento creado:

```json
{
  "attemptId": "uuid",
  "operationId": "uuid",
  "attemptNumber": 2,
  "correlationId": "op:tenant:ts:newhash",
  "status": "pending",
  "createdAt": "ISO8601"
}
```

**Response 409** — operación no está en estado `failed`:

```json
{
  "error": "INVALID_OPERATION_STATE",
  "message": "Only operations in 'failed' state can be retried",
  "currentStatus": "running"
}
```

**Response 422** — límite de reintentos alcanzado:

```json
{
  "error": "MAX_RETRIES_EXCEEDED",
  "message": "Maximum retry attempts reached for this operation type",
  "maxRetries": 5,
  "attemptCount": 5
}
```

**Response 403** — aislamiento multi-tenant:

```json
{
  "error": "FORBIDDEN",
  "message": "Operation belongs to a different tenant"
}
```

---

### Schemas de eventos Kafka

#### Topic: `console.async-operation.deduplicated`

```json
{
  "eventId": "uuid",
  "eventType": "async_operation.deduplicated",
  "operationId": "uuid",
  "tenantId": "string",
  "actorId": "string",
  "actorType": "string",
  "idempotencyKey": "string",
  "paramsMismatch": false,
  "occurredAt": "ISO8601",
  "correlationId": "string"
}
```

#### Topic: `console.async-operation.retry-requested`

```json
{
  "eventId": "uuid",
  "eventType": "async_operation.retry_requested",
  "operationId": "uuid",
  "tenantId": "string",
  "actorId": "string",
  "actorType": "string",
  "attemptId": "uuid",
  "attemptNumber": 2,
  "previousCorrelationId": "string",
  "newCorrelationId": "string",
  "occurredAt": "ISO8601"
}
```

---

## Estrategia de Pruebas

### Unitarias (`tests/unit/`)

| Test | Cobertura |
|------|-----------|
| `idempotency-key-record.test.mjs` | createIdempotencyKeyRecord (campos requeridos, hash de params, expires_at, validación de key format), isExpired |
| `retry-attempt.test.mjs` | createRetryAttempt (campos requeridos, nuevo correlationId), incremento attempt_number |
| `async-operation-retry.test.mjs` | main() con mocks: estado failed→ok, estado running→409, límite reintentos→422, tenant mismatch→403, tenant desactivado→400 |
| `idempotency-dedup-in-create.test.mjs` | Extensión de async-operation-create: key duplicada→retorna existente, key nueva→crea, key con tipo diferente→409, key con params distintos→200+paramsMismatch |

**Coverage objetivo**: 100% de ramas críticas en modelos y actions nuevas.

### Integración (`tests/integration/`)

| Test | Cobertura |
|------|-----------|
| `idempotency-dedup.test.mjs` | INSERT ON CONFLICT DO NOTHING en PostgreSQL; dos requests simultáneas con misma key producen exactamente una operación (SC-002) |
| `retry-safe.test.mjs` | Ciclo completo: create→transition to failed→retry→nuevo intento pending; validación de attempt_count; rechazo de reintento en completed |
| `idempotency-key-expiry.test.mjs` | Key expirada permite nueva operación (SC-007) |

**Nota**: Tests de integración usan PostgreSQL en Docker (patrón existente del proyecto) o un mock de pg con tablas en memoria según la convención del proyecto.

### Contrato (`tests/contract/`)

| Test | Cobertura |
|------|-----------|
| `idempotency-dedup-event.contract.test.mjs` | Valida que `buildDeduplicationEvent` produce un objeto conforme al schema `idempotency-dedup-event.json` |
| `operation-retry-event.contract.test.mjs` | Valida que `buildRetryEvent` produce un objeto conforme al schema `operation-retry-event.json` |

### E2E / Validaciones operativas

- **SC-001**: POST dos veces con la misma Idempotency-Key → segunda respuesta tiene `idempotent: true` y mismo `operationId`.
- **SC-002**: Carga concurrente (10 requests simultáneas con misma key) → exactamente 1 operación creada en BD.
- **SC-003**: Operación fallida → POST retry → `status: pending` en < 3s.
- **SC-005**: Verificar que existe evento en topic Kafka tras cada deduplicación y reintento.
- **SC-006**: Actor de tenant B no puede reintentar operación de tenant A.

---

## Modelo de Datos Completo (resumen)

Ver [data-model.md](./data-model.md) para DDL completo con comentarios.

### Migración 075 (`services/provisioning-orchestrator/src/migrations/075-idempotency-retry-tables.sql`)

1. `CREATE TABLE IF NOT EXISTS idempotency_key_records (...)` con UNIQUE (tenant_id, idempotency_key)
2. `CREATE TABLE IF NOT EXISTS retry_attempts (...)` con UNIQUE (operation_id, attempt_number)
3. `ALTER TABLE async_operations ADD COLUMN IF NOT EXISTS attempt_count INT NOT NULL DEFAULT 0`
4. `ALTER TABLE async_operations ADD COLUMN IF NOT EXISTS max_retries INT`
5. Índices: `idx_ikey_tenant_key`, `idx_ikey_expires_at`, `idx_retry_attempts_operation`, `idx_retry_attempts_tenant_status`

**Idempotencia de la migración**: Todos los statements usan `IF NOT EXISTS` / `IF NOT EXISTS` (ADD COLUMN IF NOT EXISTS). Rollback: `DROP TABLE retry_attempts; DROP TABLE idempotency_key_records; ALTER TABLE async_operations DROP COLUMN IF EXISTS attempt_count, DROP COLUMN IF EXISTS max_retries;`

### Aislamiento multi-tenant

Todas las queries incluyen `tenant_id = $1` como filtro obligatorio. El repositorio `idempotency-key-repo.mjs` nunca expone una query sin `tenant_id`. La UNIQUE constraint `(tenant_id, idempotency_key)` hace que el aislamiento sea estructural, no solo de aplicación.

### Hash de parámetros

`params_hash` en `idempotency_key_records` es un SHA-256 hex del JSON serializado (keys ordenadas) de `params`. Permite detectar discrepancias sin almacenar los parámetros originales completos (privacidad / tamaño). La discrepancia es un warning, no un error (FR-005).

---

## Observabilidad y Auditoría

| Métrica | Nombre | Labels |
|---------|--------|--------|
| Deduplicaciones exitosas | `async_operation_deduplicated_total` | tenant, operation_type |
| Conflictos de tipo con misma key | `async_operation_idempotency_conflict_total` | tenant |
| Reintentos solicitados | `async_operation_retry_requested_total` | tenant, operation_type |
| Reintentos rechazados (estado inválido) | `async_operation_retry_rejected_total` | tenant, reason |
| Reintentos rechazados (max excedido) | `async_operation_max_retries_exceeded_total` | tenant, operation_type |

**Logs estructurados**: Todos los logs siguen el patrón JSON existente del proyecto con `level`, `event`, `operation_id`, `tenant_id`, `correlation_id`, `metrics[]`.

**Eventos auditables en Kafka**: `console.async-operation.deduplicated` y `console.async-operation.retry-requested` son consumibles por el pipeline de auditoría existente (ver `consoleWorkflowAuditPolicy` en `internal-contracts`).

---

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Race condition en INSERT concurrent de idempotency key | Media | Alta | UNIQUE constraint + `ON CONFLICT DO NOTHING` + re-fetch; probado con concurrency test |
| Creación de operación exitosa pero fallo en INSERT de idempotency key (estado inconsistente) | Baja | Media | Wrapping en transacción PostgreSQL; si falla, la operación completa hace rollback |
| Reintento de operación con tenant desactivado ejecuta pasos del workflow | Baja | Alta | Verificación de estado del tenant en `async-operation-retry.mjs` antes de crear el intento |
| Acumulación ilimitada de `idempotency_key_records` expiradas | Media | Baja | `expires_at` indexado; purga futura (T04 o job separado); no bloquea operación |
| Discrepancia de parámetros silenciosa (warning no visible) | Media | Media | Header `X-Idempotent-Params-Mismatch: true` + campo `paramsMismatch` en response; log de warning |
| `max_retries` configurado a 0 accidentalmente | Baja | Media | Validación: `max_retries` debe ser >= 1 si se especifica; default del sistema es 5 |
| Rollback de migración 075 en producción con datos | Baja | Alta | Migración es aditiva; rollback = DROP de tablas nuevas + DROP COLUMN; safe si no hay FKs dependientes externos |

---

## Dependencias y Secuencia de Implementación

### Dependencias previas confirmadas

- ✅ US-UIB-02-T01: Modelo de operaciones asíncronas (`async_operations`, `async_operation_transitions`) — disponible en `services/provisioning-orchestrator/src/`
- ✅ US-UIB-02-T02: Repositorios y actions de consulta — disponibles (`async-operation-query.mjs`, `async-operation-query-repo.mjs`)
- ✅ US-UIB-01: IAM (Keycloak) provee `tenant_id` y `actor_id` verificados via APISIX

### Secuencia recomendada (orden de implementación)

```text
Paso 1: Migración 075 DDL
  └─ 075-idempotency-retry-tables.sql

Paso 2: Modelos de dominio (sin dependencias externas, fácil TDD)
  ├─ models/idempotency-key-record.mjs
  └─ models/retry-attempt.mjs

Paso 3: Repositorios
  ├─ repositories/idempotency-key-repo.mjs
  └─ repositories/retry-attempt-repo.mjs
  └─ repositories/async-operation-repo.mjs (extensión: resetToRetry, incrementAttemptCount)

Paso 4: Schemas de eventos Kafka
  ├─ internal-contracts/src/idempotency-dedup-event.json
  └─ internal-contracts/src/operation-retry-event.json

Paso 5: Extensión de eventos
  └─ events/async-operation-events.mjs (buildDeduplicationEvent, buildRetryEvent, publish*)

Paso 6: Acción de creación extendida (deduplicación)
  └─ actions/async-operation-create.mjs (EXTENDER)

Paso 7: Acción de reintento (nueva)
  └─ actions/async-operation-retry.mjs

Paso 8: Tests unitarios y de contrato
  ├─ tests/unit/idempotency-key-record.test.mjs
  ├─ tests/unit/retry-attempt.test.mjs
  ├─ tests/unit/async-operation-retry.test.mjs
  ├─ tests/contract/idempotency-dedup-event.contract.test.mjs
  └─ tests/contract/operation-retry-event.contract.test.mjs

Paso 9: Tests de integración
  ├─ tests/integration/idempotency-dedup.test.mjs
  ├─ tests/integration/retry-safe.test.mjs
  └─ tests/integration/idempotency-key-expiry.test.mjs

Paso 10: Actualizar contract-boundary.mjs y internal-contracts/src/index.mjs
Paso 11: Actualizar AGENTS.md
```

### Paralelización posible

- Pasos 2 y 4 son independientes y pueden desarrollarse en paralelo.
- Pasos 3, 5 y 6 pueden iniciarse en paralelo una vez Paso 2 esté completo.
- Tests (Paso 8) pueden escribirse en paralelo con la implementación (TDD).

---

## Configuración e Infraestructura

### Variables de entorno / Helm values nuevos

| Variable | Descripción | Default |
|----------|-------------|---------|
| `IDEMPOTENCY_KEY_TTL_HOURS` | Ventana de validez de idempotency keys en horas | `48` |
| `OPERATION_DEFAULT_MAX_RETRIES` | Límite por defecto de reintentos por operación | `5` |
| `IDEMPOTENCY_KEY_MAX_LENGTH` | Longitud máxima de idempotency key | `128` |

Estos valores se inyectan como variables de entorno en el Helm chart existente de `provisioning-orchestrator`. No se crean nuevos charts.

### Topics Kafka nuevos

| Topic | Particiones | Retención | Uso |
|-------|-------------|-----------|-----|
| `console.async-operation.deduplicated` | 3 | 7d | Auditoría de deduplicaciones |
| `console.async-operation.retry-requested` | 3 | 7d | Auditoría de reintentos |

Configuración añadida al manifiesto Kafka del Helm chart existente.

### Secrets

Sin nuevos secrets. Se reutilizan las credenciales PostgreSQL y Kafka ya presentes en los Helm values.

---

## Criterios de Done (Verificables)

| ID | Criterio | Evidencia esperada |
|----|----------|--------------------|
| DoD-01 | Migración 075 idempotente aplicada y rollback documentado | `psql -c '\d idempotency_key_records'` muestra tabla; `psql -c '\d retry_attempts'` muestra tabla |
| DoD-02 | `idempotency-key-repo.mjs` persiste y recupera registros con aislamiento tenant | Test de integración verde |
| DoD-03 | Dos requests con misma key → un solo `operation_id` (SC-001, SC-002) | Test unitario + integración verde |
| DoD-04 | Request con key de tipo diferente → 409 con `IDEMPOTENCY_KEY_CONFLICT` | Test unitario verde |
| DoD-05 | `async-operation-retry.mjs` crea nuevo intento con `attempt_number` correcto en < 3s | Test integración + SC-003 |
| DoD-06 | Reintento de operación en `running` o `completed` → 409 (SC-004) | Test unitario verde |
| DoD-07 | Reintento con `attempt_count >= max_retries` → 422 | Test unitario verde |
| DoD-08 | Actor de tenant B no puede reintentar operación de tenant A (SC-006) | Test integración verde |
| DoD-09 | Evento `async_operation.deduplicated` publicado en Kafka tras deduplicación (SC-005) | Test contrato verde |
| DoD-10 | Evento `async_operation.retry_requested` publicado en Kafka tras reintento (SC-005) | Test contrato verde |
| DoD-11 | Keys expiradas permiten nueva operación con misma key (SC-007) | Test integración verde |
| DoD-12 | `node:test` pasa sin errores desde root (`pnpm test` o equivalente) | CI verde |
| DoD-13 | `specs/075-idempotent-retry-dedup/data-model.md` y `contracts/` completos y revisados | Archivos presentes en branch |
| DoD-14 | `AGENTS.md` actualizado con nuevas tecnologías/patrones de esta feature | Commit en branch |

---

## Notas de Implementación

1. **Transaccionalidad en create + idempotency key**: el INSERT de `async_operations` y el INSERT de `idempotency_key_records` DEBEN estar dentro de la misma transacción PostgreSQL. Si uno falla, el otro hace rollback, evitando estados inconsistentes.

2. **Comportamiento ante carrera ganada por otro worker**: si `INSERT ... ON CONFLICT DO NOTHING` no retorna filas (otra transacción concurrente ganó), el código DEBE hacer un SELECT inmediato para recuperar el registro existente y retornarlo como respuesta deduplicada.

3. **Generación de `params_hash`**: usar `createHash('sha256').update(JSON.stringify(sortedParams)).digest('hex')`. Los parámetros deben normalizarse (keys ordenadas, null/undefined eliminados) antes de hashear para garantizar determinismo.

4. **`attempt_count` en `async_operations`**: se incrementa atómicamente con `UPDATE async_operations SET attempt_count = attempt_count + 1, status = 'pending', updated_at = NOW() WHERE operation_id = $1 AND tenant_id = $2 AND status = 'failed' RETURNING *`. Si el UPDATE no afecta filas, la operación cambió de estado entre la verificación y la actualización → retornar 409.

5. **Compatibilidad hacia atrás**: `idempotency_key` en `async_operations` ya existe como columna nullable desde T01. `attempt_count` y `max_retries` son aditivos. Las operaciones existentes sin idempotency_key siguen funcionando sin cambios.

6. **Seguridad en `params_hash`**: no almacenar parámetros en claro en `idempotency_key_records`. El hash es suficiente para detectar discrepancias sin exponer datos sensibles de aprovisionamiento.
