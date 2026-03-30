# Implementation Plan: Semántica de Reintento y Casos de Intervención Manual

**Branch**: `078-retry-semantics-manual-intervention` | **Date**: 2026-03-30 | **Spec**: [spec.md](./spec.md)
**Task**: US-UIB-02-T06 | **Epic**: EP-16 | **Historia**: US-UIB-02 | **Prioridad**: P0

## Summary

Definir y materializar la **semántica de reintento** como contrato verificable en el proyecto BaaS multi-tenant: clasificar fallos por retryabilidad (`transient`, `permanent`, `requires_intervention`, `unknown`), señalizar operaciones que agotan reintentos con el indicador "requiere intervención manual", controlar el acceso al reintento extraordinario por parte del superadmin, emitir notificaciones y eventos auditables por cada transición de intervención, y exponer un perfil de semántica por tipo de operación consultable tanto por consola como por sistemas internos.

Construye sobre las capas establecidas en T01 (modelo de operaciones asíncronas), T02 (endpoints de consulta de progreso), T03 (reintentos idempotentes con deduplicación), T04 (políticas de timeout/cancelación/recuperación) y T05 (reconexión de consola y relectura de estado).

## Technical Context

**Language/Version**: Node.js 20+ ESM (`"type": "module"`, pnpm workspaces)
**Primary Dependencies**: `pg` (PostgreSQL), `kafkajs` (Kafka broker), Apache OpenWhisk action wrapper patterns establecidos en T01–T05
**Storage**: PostgreSQL (extensión de `async_operations`, nueva tabla `retry_semantics_profiles`, nueva tabla `manual_intervention_flags`, nueva tabla `retry_overrides`), Kafka (eventos auditables de clasificación, intervención y override)
**Testing**: Node.js built-in `node:test`, mocks de dependencias via inyección (patrón existente)
**Target Platform**: Apache OpenWhisk (actions), Kubernetes/OpenShift (Helm), APISIX (API Gateway), React + Tailwind CSS + shadcn/ui (consola)
**Project Type**: Backend BaaS multi-tenant — orquestación de aprovisionamiento con semántica de reintentos verificable
**Performance Goals**: clasificación de fallo visible en consola < 3 s tras consultar detalle (SC-001); generación de notificación de intervención < 5 s tras transición (SC-004)
**Constraints**: idempotencia obligatoria; aislamiento multi-tenant en todas las queries; secretos nunca en repositorio; no cambiar stack
**Scale/Scope**: Todos los tenants/workspaces de la plataforma; perfiles de semántica típicamente < 50 tipos de operación registrados

## Constitution Check

*GATE: Evaluado antes de Phase 0. Re-evaluado tras Phase 1.*

| Principio | Estado | Observación |
|-----------|--------|-------------|
| I. Monorepo SoC | ✅ PASS | Todo código nuevo bajo `services/provisioning-orchestrator/src/`. Sin nuevos top-level dirs. |
| II. Incremental Delivery | ✅ PASS | Cambios aditivos: nuevas tablas, nuevas actions, nuevos módulos. No rompe T01–T05. |
| III. K8s/OpenShift compat | ✅ PASS | Sin cambios de infraestructura directa; Helm values nuevos son aditivos. |
| IV. Quality Gates at Root | ✅ PASS | Tests nuevos siguen el patrón `node:test` existente; ejecutables desde root. |
| V. Docs as part of change | ✅ PASS | `plan.md`, `data-model.md`, `contracts/` son parte de esta entrega. |
| Secrets | ✅ PASS | Sin secretos en código; configuración via env vars / Helm values. |
| pnpm workspaces | ✅ PASS | Sin nuevas dependencias externas; reutiliza `pg`, `kafkajs` ya presentes. |

**Resultado**: Sin violaciones. Se puede continuar.

## Project Structure

### Documentation (esta feature)

```text
specs/078-retry-semantics-manual-intervention/
├── spec.md                                         # Especificación funcional (entregada)
├── plan.md                                         # Este archivo
├── research.md                                     # Phase 0 output
├── data-model.md                                   # Phase 1 output
├── contracts/
│   ├── retry-semantics-profile.json               # Schema entidad perfil de semántica por tipo
│   ├── failure-classification.json                # Schema clasificación de fallo
│   ├── manual-intervention-flag.json              # Schema indicador de intervención manual
│   ├── retry-override.json                        # Schema override de superadmin
│   ├── failure-classified-event.json              # Schema evento auditable clasificación
│   ├── manual-intervention-required-event.json    # Schema evento auditable intervención manual
│   ├── retry-override-event.json                  # Schema evento auditable override superadmin
│   ├── intervention-notification-event.json       # Schema evento notificación
│   └── retry-semantics-profile-query-response.json # Contrato respuesta consulta de semántica
└── tasks.md                                        # Phase 2 output (speckit.tasks — NO creado aquí)
```

### Source Code (repository root)

```text
services/provisioning-orchestrator/
├── package.json
└── src/
    ├── models/
    │   ├── async-operation.mjs                      # EXTENDER: failure_category, manual_intervention_required
    │   ├── async-operation-states.mjs               # SIN CAMBIO (estados ya definidos en T01/T04)
    │   ├── failure-classification.mjs               # NUEVO: modelo de dominio de clasificación de fallo
    │   ├── retry-semantics-profile.mjs              # NUEVO: modelo de dominio del perfil de semántica de reintento
    │   ├── manual-intervention-flag.mjs             # NUEVO: modelo de dominio del indicador de intervención manual
    │   └── retry-override.mjs                       # NUEVO: modelo de dominio del override de superadmin
    ├── repositories/
    │   ├── async-operation-repo.mjs                 # EXTENDER: updateFailureCategory, setManualIntervention
    │   ├── retry-semantics-profile-repo.mjs         # NUEVO: findByOperationType, findDefault, upsert
    │   ├── manual-intervention-flag-repo.mjs        # NUEVO: create, findByOperationId, findPendingByTenant
    │   └── retry-override-repo.mjs                  # NUEVO: create, findByOperationId
    ├── actions/
    │   ├── async-operation-transition.mjs           # EXTENDER: clasificar fallo en transición a 'failed'
    │   ├── async-operation-retry.mjs                # EXTENDER (T03): validar manual_intervention_required antes de retry
    │   ├── async-operation-retry-override.mjs       # NUEVO: acción OpenWhisk para override de superadmin
    │   ├── async-operation-retry-semantics.mjs      # NUEVO: acción OpenWhisk para consulta de perfil de semántica
    │   └── async-operation-intervention-notify.mjs  # NUEVO: acción OpenWhisk para emitir notificación de intervención
    ├── events/
    │   └── async-operation-events.mjs               # EXTENDER: buildFailureClassifiedEvent, buildManualInterventionEvent, buildRetryOverrideEvent, buildInterventionNotificationEvent
    ├── migrations/
    │   ├── 073-async-operation-tables.sql           # SIN CAMBIO
    │   ├── 074-async-operation-log-entries.sql      # SIN CAMBIO
    │   ├── 075-idempotency-retry-tables.sql         # SIN CAMBIO
    │   ├── 076-timeout-cancel-recovery.sql          # SIN CAMBIO
    │   ├── 077-reconnect-job-state-reread.sql       # SIN CAMBIO (si aplica)
    │   └── 078-retry-semantics-intervention.sql     # NUEVO: tablas + ALTER para clasificación e intervención
    ├── authorization-context.mjs                    # SIN CAMBIO
    └── contract-boundary.mjs                        # EXTENDER: exports de nuevos schemas

services/internal-contracts/src/
    ├── failure-classified-event.json               # NUEVO: schema Kafka evento clasificación de fallo
    ├── manual-intervention-required-event.json     # NUEVO: schema Kafka evento intervención manual
    ├── retry-override-event.json                   # NUEVO: schema Kafka evento override
    ├── intervention-notification-event.json        # NUEVO: schema Kafka evento notificación
    └── index.mjs                                   # EXTENDER: exportar nuevos schemas

tests/
├── unit/
│   ├── failure-classification.test.mjs             # NUEVO: modelo de clasificación, mapeo de códigos de error
│   ├── retry-semantics-profile.test.mjs            # NUEVO: perfil por tipo + herencia de defaults
│   ├── manual-intervention-flag.test.mjs           # NUEVO: creación, verificación de indicador
│   ├── retry-override.test.mjs                     # NUEVO: creación, validación de campos
│   ├── async-operation-retry-override.test.mjs     # NUEVO: mocks de override (ok, ya resuelta→409, concurrencia→409)
│   └── async-operation-retry-semantics.test.mjs    # NUEVO: consulta de perfil + default fallback
├── integration/
│   ├── failure-classification-mapping.test.mjs     # NUEVO: mapeo de códigos a categorías en PostgreSQL
│   ├── manual-intervention-lifecycle.test.mjs      # NUEVO: ciclo fallo→reintentos→intervención→override
│   └── retry-semantics-profile-query.test.mjs      # NUEVO: consulta de perfil por tipo + defaults
└── contract/
    ├── failure-classified-event.contract.test.mjs  # NUEVO
    ├── manual-intervention-required-event.contract.test.mjs # NUEVO
    ├── retry-override-event.contract.test.mjs      # NUEVO
    └── intervention-notification-event.contract.test.mjs    # NUEVO
```

**Structure Decision**: Se sigue la estructura establecida en T01–T05 bajo `services/provisioning-orchestrator/src/`. No se crean nuevos top-level folders. Los tests siguen la estructura `tests/{unit,integration,contract}` del proyecto.

---

## Phase 0: Research

### R-001 — Clasificación de fallos y mapeo de códigos de error

**Decision**: Tabla de mapeo `failure_code_mappings` en PostgreSQL con columnas `(error_code_pattern TEXT, operation_type TEXT NULLABLE, failure_category TEXT, description TEXT, suggested_actions JSONB)`. Evaluación por coincidencia exacta primero; si no hay coincidencia, se usa el valor `unknown`. Configuración cargada al arranque de la acción OpenWhisk y cacheada en memoria para la vida del contenedor.

**Rationale**: El mapeo en base de datos permite actualizar la clasificación sin redespliegue. La carga en memoria al arranque evita una query por cada transición a `failed`. El patrón de coincidencia exacta es suficiente para la mayoría de los códigos de error estructurados (HTTP status, códigos de OpenWhisk, errores PostgreSQL); los patrones más complejos (regex) se pueden añadir en una iteración futura.

**Alternatives considered**: Fichero de configuración en YAML/JSON en el repositorio (no actualizable en caliente sin redespliegue), mapeo hardcoded en código (imposible de mantener a escala), consulta a tabla por cada transición sin caché (overhead de latencia innecesario).

**Conclusión**: Tabla `failure_code_mappings` con carga en memoria al inicio del contenedor OpenWhisk.

---

### R-002 — Indicador de intervención manual: columna en `async_operations` vs tabla separada

**Decision**: Columna `manual_intervention_required BOOLEAN NOT NULL DEFAULT FALSE` en `async_operations` + tabla separada `manual_intervention_flags` para el historial con motivo, timestamp y número de intentos en el momento del marcado.

**Rationale**: La columna en `async_operations` permite queries directas (`WHERE manual_intervention_required = TRUE`) con índice, necesario para la vista de consola de operaciones pendientes de intervención. La tabla separada preserva el historial completo incluyendo la resolución por override.

**Alternatives considered**: Solo columna en `async_operations` (sin historial de motivo ni de resolución), solo tabla separada (obliga a JOIN en todas las consultas de lista de operaciones).

**Conclusión**: Combinación de columna en `async_operations` + tabla `manual_intervention_flags`.

---

### R-003 — Perfiles de semántica de reintento por tipo de operación

**Decision**: Tabla `retry_semantics_profiles` con columnas `(profile_id UUID, operation_type TEXT UNIQUE, max_retries INT, backoff_strategy TEXT, backoff_base_seconds INT, intervention_conditions JSONB, failure_categories JSONB, is_default BOOLEAN)`. Un perfil con `operation_type = '__default__'` actúa como fallback del sistema.

**Rationale**: La tabla permite consulta por tipo de operación en < 1 ms con índice UNIQUE sobre `operation_type`. El perfil `__default__` garantiza que siempre hay una respuesta incluso para tipos no registrados explícitamente (FR-010). El campo `intervention_conditions` en JSONB es suficientemente flexible para condiciones heterogéneas sin requerir un schema fijo.

**Alternatives considered**: Fichero de configuración JSON (no consultable por API sin lógica extra), variables de entorno por tipo (explosión combinatoria), tabla relacional normalizada (sobreingeniería para el volumen esperado).

**Conclusión**: Tabla `retry_semantics_profiles` con perfil `__default__` y consulta UNIQUE.

---

### R-004 — Override de superadmin: concurrencia y race condition

**Decision**: `INSERT INTO retry_overrides (...) WHERE NOT EXISTS (SELECT 1 FROM retry_overrides WHERE operation_id = $1 AND status = 'pending')` combinado con un UPDATE optimista sobre `manual_intervention_flags`. Si el INSERT falla por la condición WHERE, se retorna 409 con `OVERRIDE_IN_PROGRESS`. El override queda en estado `pending` hasta que el reintento completado o fallado lo transiciona a `resolved`.

**Rationale**: El patrón `INSERT ... WHERE NOT EXISTS` con transacción `READ COMMITTED` es suficiente para serializar overrides concurrentes sobre la misma operación. No se requiere `SERIALIZABLE` porque el volumen de overrides simultáneos sobre la misma operación es extremadamente bajo.

**Alternatives considered**: Advisory locks de PostgreSQL (mayor complejidad, bloqueos explícitos innecesarios), UNIQUE constraint sobre `(operation_id, status)` (no válido porque status cambia), Redis SETNX (nueva dependencia no justificada).

**Conclusión**: `INSERT WHERE NOT EXISTS` en transacción, con respuesta 409 si hay override en curso.

---

### R-005 — Notificaciones de intervención: consolidación de alertas

**Decision**: Tabla `notification_debounce_window` (en memoria, via estado de OpenWhisk Scheduler) o campo `last_notification_at TIMESTAMPTZ` en `manual_intervention_flags` para evitar saturación. Si `last_notification_at` está dentro de los últimos N minutos (configurable via `INTERVENTION_NOTIFICATION_DEBOUNCE_MINUTES`, default 15), se acumula en lugar de emitir una notificación individual. La consolidación se emite al final de la ventana.

**Rationale**: Evita saturación del actor cuando múltiples operaciones del mismo tenant requieren intervención en un burst. El campo en PostgreSQL evita estado compartido externo y es consultable.

**Alternatives considered**: Cola de debounce en Redis (nueva dependencia), job separado de consolidación (complejidad operativa innecesaria), sin consolidación (riesgo de saturación, FR-012).

**Conclusión**: Campo `last_notification_at` en `manual_intervention_flags` + ventana de debounce configurable.

---

### R-006 — Topics Kafka para eventos auditables de esta tarea

**Decision**: Cuatro topics nuevos:
- `console.async-operation.failure-classified` — evento de clasificación de fallo
- `console.async-operation.manual-intervention-required` — evento de marcado de intervención
- `console.async-operation.retry-override` — evento de override de superadmin
- `console.async-operation.intervention-notification` — evento de notificación al actor/superadmin

**Rationale**: Topics separados permiten consumidores independientes para cada tipo de evento sin contaminar los topics de estado existentes. Consistente con la arquitectura de topics de T03.

**Conclusión**: Sin NEEDS CLARIFICATION.

---

## Phase 1: Design & Contracts

### Modelo de Datos

Ver [data-model.md](./data-model.md) para DDL completo. Resumen:

#### Extensión de `async_operations` (ALTER TABLE)

```sql
ALTER TABLE async_operations
  ADD COLUMN IF NOT EXISTS failure_category         TEXT,
  ADD COLUMN IF NOT EXISTS failure_error_code       TEXT,
  ADD COLUMN IF NOT EXISTS failure_description      TEXT,
  ADD COLUMN IF NOT EXISTS failure_suggested_actions JSONB,
  ADD COLUMN IF NOT EXISTS manual_intervention_required BOOLEAN NOT NULL DEFAULT FALSE;
```

**Índice**: `idx_async_op_manual_intervention ON async_operations (tenant_id) WHERE manual_intervention_required = TRUE`

**`failure_category`** valores válidos: `'transient'`, `'permanent'`, `'requires_intervention'`, `'unknown'` (CHECK constraint).

---

#### Nueva tabla: `failure_code_mappings`

```sql
CREATE TABLE failure_code_mappings (
  mapping_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  error_code        TEXT        NOT NULL,
  operation_type    TEXT,                      -- NULL = aplica a todos los tipos
  failure_category  TEXT        NOT NULL CHECK (failure_category IN ('transient', 'permanent', 'requires_intervention', 'unknown')),
  description       TEXT        NOT NULL,
  suggested_actions JSONB       NOT NULL DEFAULT '[]',
  priority          INT         NOT NULL DEFAULT 100,  -- menor = mayor prioridad
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_failure_code_operation UNIQUE (error_code, operation_type)
);
```

**Índices**: `(error_code, operation_type)` (UNIQUE), `(failure_category)`.

---

#### Nueva tabla: `retry_semantics_profiles`

```sql
CREATE TABLE retry_semantics_profiles (
  profile_id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_type          TEXT        NOT NULL UNIQUE,   -- '__default__' para el perfil global
  max_retries             INT         NOT NULL DEFAULT 5,
  backoff_strategy        TEXT        NOT NULL DEFAULT 'exponential' CHECK (backoff_strategy IN ('fixed', 'linear', 'exponential')),
  backoff_base_seconds    INT         NOT NULL DEFAULT 30,
  intervention_conditions JSONB       NOT NULL DEFAULT '[]',
  failure_categories      JSONB       NOT NULL DEFAULT '{}',
  is_default              BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Seed obligatorio**: INSERT del perfil `__default__` (max_retries=5, backoff_strategy='exponential', backoff_base_seconds=30, is_default=TRUE) en la migración.

---

#### Nueva tabla: `manual_intervention_flags`

```sql
CREATE TABLE manual_intervention_flags (
  flag_id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id          UUID        NOT NULL REFERENCES async_operations(operation_id),
  tenant_id             TEXT        NOT NULL,
  actor_id              TEXT        NOT NULL,           -- actor que originó la operación
  reason                TEXT        NOT NULL,
  attempt_count_at_flag INT         NOT NULL,
  last_error_code       TEXT,
  last_error_summary    TEXT,
  status                TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  last_notification_at  TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at           TIMESTAMPTZ,
  resolved_by           TEXT,                           -- superadmin_id o actor_id
  resolution_method     TEXT CHECK (resolution_method IN ('override', 'manual_fix', 'auto', NULL))
);
```

**Índices**: `(operation_id)` UNIQUE (una operación solo puede tener un flag activo), `(tenant_id, status)`, `(last_notification_at)`.

---

#### Nueva tabla: `retry_overrides`

```sql
CREATE TABLE retry_overrides (
  override_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id    UUID        NOT NULL REFERENCES async_operations(operation_id),
  flag_id         UUID        NOT NULL REFERENCES manual_intervention_flags(flag_id),
  tenant_id       TEXT        NOT NULL,
  superadmin_id   TEXT        NOT NULL,
  justification   TEXT        NOT NULL,
  attempt_number  INT         NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);
```

**Índices**: `(operation_id, status)`, `(tenant_id)`.

---

### Arquitectura y Flujo Objetivo

```text
─── Flujo de clasificación de fallo ──────────────────────────────────────────────

Actor/Sistema inicia operación
    │
    ▼ Operación falla (transición a 'failed' por cualquier causa)
async-operation-transition.mjs (EXTENDIDO)
    │
    ├─► Cargar failure_code_mappings (cache en memoria)
    ├─► classifyFailure(error_code, operation_type) → { category, description, suggested_actions }
    ├─► UPDATE async_operations SET failure_category=?, failure_error_code=?, ...
    ├─► Verificar attempt_count vs max_retries del perfil de semántica
    │       │
    │       ├─► [attempt_count >= max_retries OR category = 'requires_intervention']
    │       │       ├─► UPDATE async_operations SET manual_intervention_required = TRUE
    │       │       ├─► INSERT manual_intervention_flags (reason, attempt_count_at_flag, ...)
    │       │       └─► EMIT evento manual-intervention-required en Kafka
    │       │
    │       └─► [attempt_count < max_retries AND category != 'requires_intervention']
    │               └─► (no se marca intervención; reintentos disponibles)
    │
    └─► EMIT evento failure-classified en Kafka

─── Flujo de notificación proactiva ──────────────────────────────────────────────

EMIT manual-intervention-required
    │
    ▼ (consumer / OpenWhisk trigger)
async-operation-intervention-notify.mjs (NUEVO)
    │
    ├─► Cargar flag de intervención + operación + tenant
    ├─► Verificar debounce (last_notification_at + DEBOUNCE_MINUTES)
    │       │
    │       ├─► [dentro de ventana] → acumular; NO emitir notificación individual
    │       └─► [fuera de ventana o primera notificación]
    │               ├─► UPDATE manual_intervention_flags SET last_notification_at = NOW()
    │               └─► EMIT evento intervention-notification-event en Kafka
    │                   (destinatarios: actor_id, superadmin del tenant)

─── Flujo de reintento bloqueado para actor regular ─────────────────────────────

Actor intenta POST /operations/{operation_id}/retry
    │
    ▼ async-operation-retry.mjs (EXTENDIDO desde T03)
    │
    ├─► Carga operación → verifica manual_intervention_required
    │       │
    │       └─► [TRUE] → 422 MANUAL_INTERVENTION_REQUIRED
    │                     { error, operation_id, flag_id, hint: "contact superadmin or use override" }
    │
    └─► [FALSE] → flujo de reintento normal de T03

─── Flujo de override de superadmin ─────────────────────────────────────────────

Superadmin POST /operations/{operation_id}/retry-override
    │
    ▼ async-operation-retry-override.mjs (NUEVO)
    │
    ├─► Verificar rol superadmin (IAM/Keycloak)
    ├─► Cargar operación → verificar manual_intervention_required = TRUE
    ├─► Verificar no hay override en curso (INSERT WHERE NOT EXISTS)
    │       │
    │       └─► [override ya en curso] → 409 OVERRIDE_IN_PROGRESS
    │
    ├─► BEGIN TRANSACTION
    │       INSERT retry_overrides (status = 'pending')
    │       INSERT retry_attempts (nuevo intento, nuevo correlation_id)
    │       UPDATE async_operations SET status='pending', attempt_count++, manual_intervention_required=FALSE
    │       UPDATE manual_intervention_flags SET status='resolved', resolved_by=superadmin_id, resolution_method='override'
    │   COMMIT
    ├─► EMIT evento retry-override-event en Kafka
    └─► Retornar { overrideId, attemptId, operationId, attemptNumber, status: 'pending' }

─── Flujo de consulta de semántica de reintento ─────────────────────────────────

Actor/Sistema GET /operations/retry-semantics?operationType=create-workspace
    │
    ▼ async-operation-retry-semantics.mjs (NUEVO)
    │
    ├─► findByOperationType('create-workspace') || findDefault()
    └─► Retornar perfil: { operationType, maxRetries, backoffStrategy, backoffBaseSeconds,
                           interventionConditions, failureCategories }
```

---

### Módulos implicados y límites entre componentes

| Módulo | Rol | Dependencias |
|--------|-----|--------------|
| `models/failure-classification.mjs` | Crear/validar clasificaciones; classifyByErrorCode con mapeo cacheado | `node:crypto` |
| `models/retry-semantics-profile.mjs` | Crear/validar perfiles; resolveProfile (específico o default) | — |
| `models/manual-intervention-flag.mjs` | Crear/validar indicadores; verificar debounce de notificación | — |
| `models/retry-override.mjs` | Crear/validar overrides de superadmin | — |
| `repositories/retry-semantics-profile-repo.mjs` | findByOperationType, findDefault, upsert | `pg` |
| `repositories/manual-intervention-flag-repo.mjs` | create, findByOperationId, findPendingByTenant, resolveFlag | `pg` |
| `repositories/retry-override-repo.mjs` | createIfNotInProgress (INSERT WHERE NOT EXISTS), findByOperationId | `pg` |
| `repositories/async-operation-repo.mjs` | EXTENDER: updateFailureCategory, setManualIntervention, clearManualIntervention | `pg` |
| `actions/async-operation-transition.mjs` | EXTENDER: clasificar fallo y evaluar intervención tras transición a 'failed' | repos, models, events |
| `actions/async-operation-retry.mjs` | EXTENDER: bloquear reintento si manual_intervention_required = TRUE | repos |
| `actions/async-operation-retry-override.mjs` | Nueva acción OpenWhisk para override de superadmin | repos, events, models |
| `actions/async-operation-retry-semantics.mjs` | Nueva acción OpenWhisk para consulta de perfil | repos |
| `actions/async-operation-intervention-notify.mjs` | Nueva acción OpenWhisk para notificación; respeta debounce | repos, events |
| `events/async-operation-events.mjs` | EXTENDER: build + publish para los 4 nuevos eventos | `kafkajs` |
| `internal-contracts/src/*.json` | 4 nuevos schemas Kafka | — |
| `migrations/078-retry-semantics-intervention.sql` | DDL: 3 nuevas tablas + ALTER async_operations + seed default profile + seed mappings base | PostgreSQL |

---

### Contratos de API

#### PATCH /operations/{operation_id} — respuesta extendida (ya existente)

Los campos `failure_category`, `failure_error_code`, `failure_description`, `failure_suggested_actions` y `manual_intervention_required` se añaden al payload de respuesta de la operación. Sin cambio en el endpoint; el contrato se extiende de forma no-breaking.

```json
{
  "operationId": "uuid",
  "status": "failed",
  "failureCategory": "transient",
  "failureErrorCode": "DOWNSTREAM_TIMEOUT",
  "failureDescription": "El servicio downstream no respondió en el tiempo esperado.",
  "failureSuggestedActions": ["Reintentar la operación", "Verificar disponibilidad del servicio"],
  "manualInterventionRequired": false,
  "attemptCount": 2,
  "maxRetries": 5
}
```

---

#### POST /operations/{operation_id}/retry — respuesta extendida (T03, ahora bloqueada si intervención)

**Response 422** — intervención manual requerida (NUEVO):

```json
{
  "error": "MANUAL_INTERVENTION_REQUIRED",
  "message": "This operation has exhausted its automatic retry limit and requires manual intervention.",
  "operationId": "uuid",
  "flagId": "uuid",
  "hint": "Contact your administrator or request a retry override."
}
```

---

#### POST /operations/{operation_id}/retry-override (NUEVO endpoint)

**Request**:

```json
{
  "justification": "Dependencia external recuperada tras incidente; reintento seguro."
}
```

**Response 200** — override creado:

```json
{
  "overrideId": "uuid",
  "attemptId": "uuid",
  "operationId": "uuid",
  "attemptNumber": 6,
  "correlationId": "op:tenant:ts:newhash",
  "status": "pending",
  "createdAt": "ISO8601"
}
```

**Response 403** — no es superadmin:

```json
{
  "error": "FORBIDDEN",
  "message": "Retry override requires superadmin role."
}
```

**Response 404** — operación no marcada como intervención:

```json
{
  "error": "NOT_APPLICABLE",
  "message": "Operation does not have manual_intervention_required flag set."
}
```

**Response 409** — override en curso:

```json
{
  "error": "OVERRIDE_IN_PROGRESS",
  "message": "A retry override is already in progress for this operation.",
  "existingOverrideId": "uuid"
}
```

---

#### GET /operations/retry-semantics (NUEVO endpoint)

**Query params**: `operationType` (opcional; si se omite, retorna el perfil default)

**Response 200**:

```json
{
  "operationType": "create-workspace",
  "maxRetries": 5,
  "backoffStrategy": "exponential",
  "backoffBaseSeconds": 30,
  "interventionConditions": [
    { "condition": "attempt_count >= max_retries", "action": "require_intervention" },
    { "condition": "failure_category == requires_intervention", "action": "require_intervention" }
  ],
  "failureCategories": {
    "DOWNSTREAM_TIMEOUT": "transient",
    "RESOURCE_ALREADY_EXISTS": "permanent",
    "QUOTA_EXCEEDED": "permanent",
    "INFRA_FAILURE": "requires_intervention"
  },
  "isDefault": false
}
```

---

### Schemas de eventos Kafka

#### Topic: `console.async-operation.failure-classified`

```json
{
  "eventId": "uuid",
  "eventType": "async_operation.failure_classified",
  "operationId": "uuid",
  "tenantId": "string",
  "actorId": "string",
  "failureCategory": "transient|permanent|requires_intervention|unknown",
  "errorCode": "string",
  "attemptCount": 2,
  "maxRetries": 5,
  "occurredAt": "ISO8601",
  "correlationId": "string"
}
```

#### Topic: `console.async-operation.manual-intervention-required`

```json
{
  "eventId": "uuid",
  "eventType": "async_operation.manual_intervention_required",
  "operationId": "uuid",
  "flagId": "uuid",
  "tenantId": "string",
  "actorId": "string",
  "reason": "string",
  "attemptCountAtFlag": 5,
  "lastErrorCode": "string",
  "occurredAt": "ISO8601",
  "correlationId": "string"
}
```

#### Topic: `console.async-operation.retry-override`

```json
{
  "eventId": "uuid",
  "eventType": "async_operation.retry_override",
  "overrideId": "uuid",
  "operationId": "uuid",
  "flagId": "uuid",
  "tenantId": "string",
  "superadminId": "string",
  "justification": "string",
  "attemptNumber": 6,
  "newCorrelationId": "string",
  "occurredAt": "ISO8601"
}
```

#### Topic: `console.async-operation.intervention-notification`

```json
{
  "eventId": "uuid",
  "eventType": "async_operation.intervention_notification",
  "operationId": "uuid",
  "flagId": "uuid",
  "tenantId": "string",
  "recipientActorId": "string",
  "recipientRole": "tenant_owner|superadmin",
  "operationType": "string",
  "failureSummary": "string",
  "suggestedActions": ["string"],
  "occurredAt": "ISO8601",
  "correlationId": "string"
}
```

---

## Estrategia de Pruebas

### Unitarias (`tests/unit/`)

| Test | Cobertura |
|------|-----------|
| `failure-classification.test.mjs` | classifyByErrorCode (mapeo exacto, no mapeado→unknown, operation_type específico vs genérico, prioridad) |
| `retry-semantics-profile.test.mjs` | resolveProfile (tipo específico, fallback a default, defaults de campos) |
| `manual-intervention-flag.test.mjs` | crear flag, verificar debounce (dentro/fuera de ventana), resolver flag |
| `retry-override.test.mjs` | crear override, campos obligatorios (superadmin_id, justification), transición de status |
| `async-operation-retry-override.test.mjs` | main() con mocks: ok→200, sin flag→404, no superadmin→403, override en curso→409, operación resuelta→409 |
| `async-operation-retry-semantics.test.mjs` | consulta tipo específico, consulta sin tipo→default, tipo no registrado→default |

**Coverage objetivo**: 100% de ramas en modelos nuevos y actions críticas.

### Integración (`tests/integration/`)

| Test | Cobertura |
|------|-----------|
| `failure-classification-mapping.test.mjs` | INSERT de mappings base; classifyFailure en PostgreSQL real/mock; código desconocido→unknown |
| `manual-intervention-lifecycle.test.mjs` | Ciclo completo: fallo con max_retries→marcado intervención→override de superadmin→reintento→resolución flag; validar que actor regular recibe 422 tras marcado |
| `retry-semantics-profile-query.test.mjs` | findByOperationType con tipo conocido; fallback a default; upsert de nuevo perfil |

### Contrato (`tests/contract/`)

| Test | Cobertura |
|------|-----------|
| `failure-classified-event.contract.test.mjs` | buildFailureClassifiedEvent conforme al schema |
| `manual-intervention-required-event.contract.test.mjs` | buildManualInterventionEvent conforme al schema |
| `retry-override-event.contract.test.mjs` | buildRetryOverrideEvent conforme al schema |
| `intervention-notification-event.contract.test.mjs` | buildInterventionNotificationEvent conforme al schema |

### E2E / Validaciones operativas

- **SC-001**: Operación fallida → consulta detalle → `failureCategory` presente en < 3 s.
- **SC-002**: Operación con `attempt_count == max_retries` → marcada `manualInterventionRequired = true` en respuesta API y en consola.
- **SC-003**: Actor regular POST retry sobre operación con flag → 422 MANUAL_INTERVENTION_REQUIRED.
- **SC-004**: Transición a intervención → evento de notificación en topic Kafka con destinatarios correctos.
- **SC-005**: Superadmin POST retry-override → evento `retry-override` auditable con superadmin_id + justification.
- **SC-006**: GET retry-semantics?operationType=create-workspace → perfil con categorías de fallo + límite de reintentos.

---

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Código de error no mapeado clasifica como `unknown` en producción, confundiendo al usuario | Alta | Media | Seed de mappings base cubre HTTP 5xx, timeouts, y códigos OpenWhisk comunes; `unknown` muestra recomendación de no reintentar y escalar |
| Race condition entre dos superadmins que hacen override simultáneo | Baja | Alta | `INSERT WHERE NOT EXISTS` en transacción serializada; 409 en el segundo |
| Debounce de notificación muy largo oculta intervenciones urgentes | Media | Media | Configurable via `INTERVENTION_NOTIFICATION_DEBOUNCE_MINUTES` (default 15); superadmins pueden reducirlo a 0 |
| Migración 078 en producción con datos existentes en `async_operations` | Baja | Media | ALTER TABLE solo añade columnas con DEFAULT; rollback es DROP de tablas nuevas + DROP COLUMN IF EXISTS; safe |
| Perfil de semántica desactualizado para un tipo de operación nuevo | Media | Baja | Fallback obligatorio a perfil `__default__`; operadores pueden añadir nuevos perfiles sin redespliegue |
| Override crea un intento adicional que también falla, dejando `manual_intervention_required = FALSE` sin resolución real | Media | Media | Tras fallo del intento de override: acción de transición reclasifica y re-evalúa si debe re-marcar intervención; lógica defensiva en `async-operation-transition.mjs` |
| Clasificación de fallo basada en caché desactualizada | Baja | Media | Cache se recarga al inicio del contenedor OpenWhisk; TTL de contenedores < 60 min; cambios urgentes obligan warm-up nuevo |

---

## Modelo de Datos Completo (resumen)

Ver [data-model.md](./data-model.md) para DDL completo con comentarios y rollback.

### Migración 078 (`services/provisioning-orchestrator/src/migrations/078-retry-semantics-intervention.sql`)

1. `ALTER TABLE async_operations ADD COLUMN IF NOT EXISTS failure_category TEXT CHECK (...)` (+ 4 columnas más)
2. `CREATE TABLE IF NOT EXISTS failure_code_mappings (...)` con UNIQUE (error_code, operation_type)
3. `CREATE TABLE IF NOT EXISTS retry_semantics_profiles (...)` con UNIQUE (operation_type)
4. `CREATE TABLE IF NOT EXISTS manual_intervention_flags (...)` con UNIQUE (operation_id)
5. `CREATE TABLE IF NOT EXISTS retry_overrides (...)` con índice (operation_id, status)
6. **Seed**: INSERT de perfil `__default__` en `retry_semantics_profiles`
7. **Seed**: INSERT de mappings base en `failure_code_mappings` (HTTP 5xx → transient, 4xx client errors → permanent, INFRA_FAILURE → requires_intervention, etc.)
8. Índices: `idx_async_op_manual_intervention`, `idx_manual_int_tenant_status`, `idx_retry_override_op_status`

**Idempotencia**: Todos los statements usan `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`. Seed con `ON CONFLICT DO NOTHING`.

**Rollback**:
```sql
DROP TABLE IF EXISTS retry_overrides;
DROP TABLE IF EXISTS manual_intervention_flags;
DROP TABLE IF EXISTS retry_semantics_profiles;
DROP TABLE IF EXISTS failure_code_mappings;
ALTER TABLE async_operations
  DROP COLUMN IF EXISTS failure_category,
  DROP COLUMN IF EXISTS failure_error_code,
  DROP COLUMN IF EXISTS failure_description,
  DROP COLUMN IF EXISTS failure_suggested_actions,
  DROP COLUMN IF EXISTS manual_intervention_required;
```

---

## Observabilidad y Auditoría

| Métrica | Nombre | Labels |
|---------|--------|--------|
| Fallos clasificados | `async_operation_failure_classified_total` | tenant, operation_type, failure_category |
| Operaciones marcadas como intervención | `async_operation_manual_intervention_total` | tenant, operation_type, reason |
| Overrides de superadmin | `async_operation_retry_override_total` | tenant, operation_type |
| Overrides rechazados | `async_operation_retry_override_rejected_total` | tenant, reason |
| Notificaciones de intervención emitidas | `async_operation_intervention_notification_total` | tenant, recipient_role |
| Notificaciones consolidadas por debounce | `async_operation_intervention_notification_debounced_total` | tenant |

**Logs estructurados**: JSON con `level`, `event`, `operation_id`, `tenant_id`, `correlation_id` en todas las actions.

**Eventos Kafka auditables**: Los 4 topics nuevos son consumibles por el pipeline de auditoría existente.

---

## Configuración e Infraestructura

### Variables de entorno / Helm values nuevos

| Variable | Descripción | Default |
|----------|-------------|---------|
| `FAILURE_CLASSIFICATION_CACHE_TTL_SECONDS` | TTL de caché de mapeos de clasificación en OpenWhisk | `3600` |
| `INTERVENTION_NOTIFICATION_DEBOUNCE_MINUTES` | Ventana de consolidación de notificaciones | `15` |
| `RETRY_OVERRIDE_REQUIRES_JUSTIFICATION` | Exige campo `justification` en override | `true` |

### Topics Kafka nuevos

| Topic | Particiones | Retención | Uso |
|-------|-------------|-----------|-----|
| `console.async-operation.failure-classified` | 3 | 30d | Auditoría de clasificaciones |
| `console.async-operation.manual-intervention-required` | 3 | 30d | Auditoría de intervenciones |
| `console.async-operation.retry-override` | 3 | 30d | Auditoría de overrides |
| `console.async-operation.intervention-notification` | 3 | 7d | Entrega de notificaciones |

---

## Dependencias y Secuencia de Implementación

### Dependencias previas confirmadas

- ✅ T01: Modelo `async_operations` + `async_operation_transitions` disponible
- ✅ T02: Repos y actions de consulta de progreso disponibles
- ✅ T03: `async-operation-retry.mjs` disponible (se extiende aquí)
- ✅ T04: Estados `timed_out`, `cancelled`, `cancelling` + políticas de timeout disponibles
- ✅ T05: Reconexión y relectura de estado disponibles
- ✅ US-UIB-01: IAM (Keycloak) provee `tenant_id`, `actor_id`, roles verificados

### Secuencia recomendada de implementación

```text
Paso 1: Migración 078 DDL + seed
  └─ 078-retry-semantics-intervention.sql

Paso 2: Modelos de dominio (TDD, sin dependencias externas)
  ├─ models/failure-classification.mjs
  ├─ models/retry-semantics-profile.mjs
  ├─ models/manual-intervention-flag.mjs
  └─ models/retry-override.mjs

Paso 3: Repositorios
  ├─ repositories/retry-semantics-profile-repo.mjs
  ├─ repositories/manual-intervention-flag-repo.mjs
  ├─ repositories/retry-override-repo.mjs
  └─ repositories/async-operation-repo.mjs (extender)

Paso 4: Schemas de eventos Kafka (internal-contracts)
  ├─ failure-classified-event.json
  ├─ manual-intervention-required-event.json
  ├─ retry-override-event.json
  └─ intervention-notification-event.json

Paso 5: Extensión de eventos
  └─ events/async-operation-events.mjs (build + publish para 4 nuevos eventos)

Paso 6: Extensión de actions existentes
  ├─ actions/async-operation-transition.mjs (clasificación de fallo + marcado intervención)
  └─ actions/async-operation-retry.mjs (bloqueo si manual_intervention_required = TRUE)

Paso 7: Nuevas actions
  ├─ actions/async-operation-retry-override.mjs
  ├─ actions/async-operation-retry-semantics.mjs
  └─ actions/async-operation-intervention-notify.mjs

Paso 8: Tests unitarios y de contrato
  ├─ tests/unit/failure-classification.test.mjs
  ├─ tests/unit/retry-semantics-profile.test.mjs
  ├─ tests/unit/manual-intervention-flag.test.mjs
  ├─ tests/unit/retry-override.test.mjs
  ├─ tests/unit/async-operation-retry-override.test.mjs
  ├─ tests/unit/async-operation-retry-semantics.test.mjs
  ├─ tests/contract/failure-classified-event.contract.test.mjs
  ├─ tests/contract/manual-intervention-required-event.contract.test.mjs
  ├─ tests/contract/retry-override-event.contract.test.mjs
  └─ tests/contract/intervention-notification-event.contract.test.mjs

Paso 9: Tests de integración
  ├─ tests/integration/failure-classification-mapping.test.mjs
  ├─ tests/integration/manual-intervention-lifecycle.test.mjs
  └─ tests/integration/retry-semantics-profile-query.test.mjs

Paso 10: Actualizar contract-boundary.mjs + internal-contracts/src/index.mjs
Paso 11: Actualizar AGENTS.md
```

### Paralelización posible

- Pasos 2 y 4 son independientes; pueden ejecutarse en paralelo.
- Pasos 3 y 5 pueden iniciarse en paralelo una vez el Paso 2 esté completo.
- Pasos 8 (tests unitarios) pueden escribirse en paralelo con la implementación (TDD).

---

## Criterios de Done (Verificables)

| ID | Criterio | Evidencia esperada |
|----|----------|--------------------|
| DoD-01 | Migración 078 idempotente aplicada y rollback documentado | `psql -c '\d failure_code_mappings'`, `'\d retry_semantics_profiles'`, `'\d manual_intervention_flags'`, `'\d retry_overrides'` muestran tablas; seed presente |
| DoD-02 | Operación fallida muestra `failure_category` en respuesta API | Test unitario + integración verde para classifyByErrorCode |
| DoD-03 | Operación con `attempt_count >= max_retries` → `manual_intervention_required = TRUE` en BD y API (SC-002) | Test integración verde |
| DoD-04 | Actor regular recibe 422 MANUAL_INTERVENTION_REQUIRED al reintentar operación con flag (SC-003) | Test unitario + integración verde |
| DoD-05 | Superadmin POST retry-override → override creado, flag resuelto, intento nuevo en pending | Test integración verde |
| DoD-06 | Dos superadmins simultáneos en override → solo uno procede; segundo recibe 409 (R-004) | Test integración verde |
| DoD-07 | GET retry-semantics?operationType=X → perfil con categorías + límites; tipo desconocido → default (SC-006) | Test unitario + integración verde |
| DoD-08 | Evento `failure_classified` publicado en Kafka tras cada fallo clasificado | Test contrato verde |
| DoD-09 | Evento `manual_intervention_required` publicado en Kafka tras marcado de intervención (SC-004) | Test contrato verde |
| DoD-10 | Evento `retry_override` auditable publicado con superadmin_id + justification (SC-005) | Test contrato verde |
| DoD-11 | Evento `intervention-notification` emitido con destinatarios correctos (actor + superadmin del tenant) | Test contrato verde |
| DoD-12 | Debounce de notificación respeta `INTERVENTION_NOTIFICATION_DEBOUNCE_MINUTES` | Test unitario de manual-intervention-flag.mjs verde |
| DoD-13 | `node:test` pasa sin errores desde root | CI verde |
| DoD-14 | Contratos (`specs/078-*/contracts/*.json`) presentes y validados contra eventos generados | Archivos presentes en branch + tests contrato verdes |
| DoD-15 | `AGENTS.md` actualizado con nuevos patrones de clasificación de fallos e intervención manual | Commit en branch |

---

## Notas de Implementación

1. **Caché de `failure_code_mappings`**: cargar en memoria al inicio del contenedor OpenWhisk con `SELECT * FROM failure_code_mappings ORDER BY priority ASC`. La función `classifyFailure(errorCode, operationType)` primero busca coincidencia específica por `(error_code, operation_type)`, luego genérica por `(error_code, NULL)`, y finalmente devuelve `{ category: 'unknown', ... }`.

2. **Extensión de `async-operation-transition.mjs`**: la clasificación y el marcado de intervención deben ocurrir dentro de la misma transacción que cambia el estado de la operación a `failed`. Si el marcado de intervención falla (p. ej. constraint de UNIQUE ya existe por flag anterior), se registra un warning en logs y se continúa sin relanzar la excepción.

3. **Compatibilidad hacia atrás en `async-operation-retry.mjs` (T03)**: la verificación de `manual_intervention_required` se añade como primer check, antes de cualquier otra validación. Si el campo es NULL (operaciones anteriores a la migración 078), se trata como FALSE.

4. **Seguridad del override**: la acción `async-operation-retry-override.mjs` DEBE verificar el rol `superadmin` via el contexto de autorización de Keycloak antes de cualquier acceso a datos. El campo `justification` es obligatorio (longitud mínima: 10 caracteres).

5. **Aislamiento multi-tenant en notificaciones**: la acción `async-operation-intervention-notify.mjs` NUNCA mezcla datos de tenants distintos. El evento de notificación emite un mensaje por destinatario, con el `tenantId` del actor en cada payload.

6. **Fallo del intento iniciado por override**: si el reintento extraordinario también falla, `async-operation-transition.mjs` reclasifica el nuevo fallo y re-evalúa si el fallo acumulado supera `max_retries` para decidir si vuelve a marcar `manual_intervention_required = TRUE`. El override resuelto no impide re-marcar la intervención en fallos subsiguientes.
