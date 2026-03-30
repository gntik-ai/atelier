# Implementation Plan: Políticas de Timeout, Cancelación y Recuperación para Aprovisionamientos Complejos

**Task ID**: US-UIB-02-T04  
**Feature Branch**: `076-timeout-cancel-recovery-policies`  
**Spec**: `specs/076-timeout-cancel-recovery-policies/spec.md`  
**Created**: 2026-03-30  
**Status**: Ready for Implementation

---

## 1. Objetivo del Plan

Extender el modelo de operaciones asíncronas ya existente (T01/T02/T03) con tres capacidades ortogonales:

1. **Timeout automático**: un proceso periódico en OpenWhisk detecta operaciones `running` que han excedido su duración máxima y las transiciona a `timed_out`.
2. **Cancelación voluntaria**: una nueva acción OpenWhisk permite que un actor autorizado solicite la cancelación de una operación `pending` o `running`, introduciendo el estado transitorio `cancelling`.
3. **Recuperación de huérfanos**: un proceso periódico detecta operaciones bloqueadas sin progreso (`running`/`pending`/`cancelling` por encima del umbral) y les aplica la acción de recuperación configurada.

---

## 2. Arquitectura y Flujo Objetivo

### 2.1 Ciclo de vida extendido

```text
pending ──► running ──► completed
   │            │
   │            ├──► timed_out   (terminal)
   │            └──► cancelling ──► cancelled  (terminal)
   │                            └──► failed    (terminal, si cancelling falla)
   └──────────────────────────────► cancelled  (terminal, cancelación directa desde pending)
   └──────────────────────────────► failed     (terminal, recuperación de huérfano stale)
```

Estados terminales: `completed`, `failed`, `timed_out`, `cancelled`  
Estado transitorio nuevo: `cancelling`

### 2.2 Componentes implicados

| Componente | Rol |
|---|---|
| `async-operation-states.mjs` | Registra las nuevas transiciones válidas y estados terminales |
| `async-operation.mjs` (modelo) | Extiende `applyTransition` para soportar nuevos estados; añade campos de cancelación |
| `async-operation-repo.mjs` | Nuevas queries: `findTimedOut`, `findOrphans`, `findStaleCancelling`, `atomicTransitionSystem` |
| `async-operation-cancel.mjs` (nueva acción OpenWhisk) | Punto de entrada para cancelación de operaciones por actor |
| `async-operation-timeout-sweep.mjs` (nueva acción OpenWhisk) | Proceso periódico que detecta y aplica timeouts |
| `async-operation-orphan-sweep.mjs` (nueva acción OpenWhisk) | Proceso periódico que detecta y recupera operaciones huérfanas |
| `async-operation-events.mjs` | Nuevos topics Kafka para timeout, cancelación y recuperación |
| `076-timeout-cancel-recovery.sql` (migración) | Extiende `async_operations`, añade tabla `operation_policies` |
| `async-operation-state-changed.json` (contrato interno) | Extensión del esquema para nuevos estados/motivos |
| `operation-cancel-event.json` (contrato nuevo) | Esquema del evento de cancelación |
| `operation-timeout-event.json` (contrato nuevo) | Esquema del evento de timeout |
| `operation-recovery-event.json` (contrato nuevo) | Esquema del evento de recuperación de huérfano |

### 2.3 Límites de componentes

- **No se modifica** la lógica de `async-operation-create.mjs`, `async-operation-query.mjs`, ni `async-operation-retry.mjs` salvo imports que deban reflejar los nuevos estados terminales.
- Las nuevas acciones de sweep se invocan como **trigger de OpenWhisk + alarm feed** (cron interno de OW), sin dependencia de scheduler externo.
- La cancelación de una operación `running` genera `cancelling` y luego el sweep de huérfanos fuerza `cancelled` si la señal no es procesada dentro del umbral; no requiere IPC síncrono con el procesador de workflow.

---

## 3. Cambios por Artefacto

### 3.1 Migración PostgreSQL — `076-timeout-cancel-recovery.sql`

**Ruta**: `services/provisioning-orchestrator/src/migrations/076-timeout-cancel-recovery.sql`

Cambios sobre el schema existente:

```sql
-- (a) Nuevos estados en el CHECK de async_operations
ALTER TABLE async_operations
  DROP CONSTRAINT IF EXISTS async_operations_status_check;

ALTER TABLE async_operations
  ADD CONSTRAINT async_operations_status_check
    CHECK (status IN (
      'pending','running','completed','failed',
      'timed_out','cancelling','cancelled'
    ));

-- (b) Nuevas columnas de cancelación/timeout en async_operations
ALTER TABLE async_operations
  ADD COLUMN IF NOT EXISTS cancelled_by       TEXT,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS timeout_policy_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS policy_applied_at  TIMESTAMPTZ;

-- (c) Índices de soporte para los sweeps
CREATE INDEX IF NOT EXISTS idx_async_ops_status_updated
  ON async_operations (status, updated_at)
  WHERE status IN ('running','pending','cancelling');

-- (d) Tabla de políticas por tipo de operación
CREATE TABLE IF NOT EXISTS operation_policies (
  policy_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_type     TEXT NOT NULL UNIQUE,
  timeout_minutes    INT  NOT NULL,
  orphan_threshold_minutes INT NOT NULL,
  cancelling_timeout_minutes INT NOT NULL DEFAULT 5,
  recovery_action    TEXT NOT NULL DEFAULT 'fail',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Política por defecto (tipo '*' = fallback global)
INSERT INTO operation_policies
  (operation_type, timeout_minutes, orphan_threshold_minutes, cancelling_timeout_minutes)
  VALUES ('*', 60, 30, 5)
  ON CONFLICT (operation_type) DO NOTHING;

-- (e) Rollback
-- ALTER TABLE async_operations
--   DROP COLUMN IF EXISTS cancelled_by,
--   DROP COLUMN IF EXISTS cancellation_reason,
--   DROP COLUMN IF EXISTS timeout_policy_snapshot,
--   DROP COLUMN IF EXISTS policy_applied_at;
-- DROP TABLE IF EXISTS operation_policies;
-- DROP INDEX IF EXISTS idx_async_ops_status_updated;
-- ALTER TABLE async_operations DROP CONSTRAINT IF EXISTS async_operations_status_check;
-- ALTER TABLE async_operations
--   ADD CONSTRAINT async_operations_status_check
--     CHECK (status IN ('pending','running','completed','failed'));
```

### 3.2 Modelo de estados — `async-operation-states.mjs`

**Ruta**: `services/provisioning-orchestrator/src/models/async-operation-states.mjs`

Cambios:
- Añadir `timed_out`, `cancelling`, `cancelled` a `VALID_TRANSITIONS`.
- Añadir los cuatro nuevos estados a `TERMINAL_STATES` (excepto `cancelling`).
- Nueva constante `CANCELLABLE_STATES = ['pending','running']`.

Transiciones añadidas:

```js
running:    [...existentes, 'timed_out', 'cancelling'],
pending:    [...existentes, 'cancelled'],
cancelling: ['cancelled', 'failed'],
```

### 3.3 Modelo de operación — `async-operation.mjs`

**Ruta**: `services/provisioning-orchestrator/src/models/async-operation.mjs`

Cambios:
- `createOperation`: acepta `timeout_policy_snapshot` (JSONB opcional) y `cancelled_by` (null por defecto).
- `applyTransition`: cuando `new_status === 'cancelling'`, registra `cancelled_by` y `cancellation_reason` desde `input`; cuando `new_status === 'timed_out'`, registra `cancellation_reason = 'timeout exceeded'`.
- Nueva función `isCancellable(status)` que retorna `CANCELLABLE_STATES.has(status)`.

### 3.4 Repositorio — `async-operation-repo.mjs`

**Ruta**: `services/provisioning-orchestrator/src/repositories/async-operation-repo.mjs`

Nuevas funciones exportadas:

```js
// Operaciones running cuyo updated_at + timeout ha expirado (según política)
export async function findTimedOutCandidates(db, { nowIso } = {})

// Operaciones running/pending sin actualización desde hace más del orphan_threshold
export async function findOrphanCandidates(db, { nowIso } = {})

// Operaciones cancelling que llevan más del cancelling_timeout sin avanzar
export async function findStaleCancellingCandidates(db, { nowIso } = {})

// Transición atómica iniciada por el sistema (actor_id = 'system')
export async function atomicTransitionSystem(db, { operation_id, tenant_id, new_status, reason, cancelled_by })

// Política por tipo de operación (con fallback a '*')
export async function findPolicyForType(db, { operation_type })
```

`atomicTransitionSystem` usa `FOR UPDATE` igual que `transitionOperation` y registra en `async_operation_transitions` con `actor_id = 'system'`.

### 3.5 Nueva acción OpenWhisk — `async-operation-cancel.mjs`

**Ruta**: `services/provisioning-orchestrator/src/actions/async-operation-cancel.mjs`

Flujo:
1. Extrae `callerContext` (actor, tenantId, roles) de `params`.
2. Resuelve `tenant_id` con la misma lógica de `async-operation-transition.mjs` (superadmin puede especificar tenant_id externo; resto usa callerContext.tenantId).
3. Carga la operación con `findById` — si no existe, `404`.
4. Verifica que `isCancellable(operation.status)` — si no, error `409` con mensaje descriptivo.
5. Verifica aislamiento multi-tenant: el actor debe ser del mismo tenant O superadmin.
6. Si `status === 'pending'`: transiciona directamente a `cancelled` con `transitionOperation`.
7. Si `status === 'running'`: transiciona a `cancelling` con `transitionOperation` registrando `cancelled_by` y `cancellation_reason`.
8. Publica evento Kafka en `console.async-operation.cancelled`.
9. Retorna `{ statusCode: 200, body: { operationId, previousStatus, newStatus, updatedAt } }`.

Errores mapeados:
- `NOT_FOUND` → 404
- `INVALID_TRANSITION` / `NOT_CANCELLABLE` → 409
- `TENANT_ISOLATION_VIOLATION` → 403
- `VALIDATION_ERROR` → 400

### 3.6 Nueva acción OpenWhisk — `async-operation-timeout-sweep.mjs`

**Ruta**: `services/provisioning-orchestrator/src/actions/async-operation-timeout-sweep.mjs`

Flujo:
1. Lee la política para cada `operation_type` via `findPolicyForType`.
2. Llama a `findTimedOutCandidates(db, { nowIso: new Date().toISOString() })`.
3. Para cada candidato, ejecuta `atomicTransitionSystem(db, { ..., new_status: 'timed_out', reason: 'timeout exceeded' })`.
4. Publica evento `console.async-operation.timed-out` por cada operación afectada.
5. Retorna `{ swept: N, errors: [...] }` para observabilidad (errores por operación no abortan el loop).

Esta acción se registra en OpenWhisk como `async-operation-timeout-sweep` y se invoca con un alarm trigger configurado en Helm (`values.yaml` del chart de provisioning-orchestrator).

### 3.7 Nueva acción OpenWhisk — `async-operation-orphan-sweep.mjs`

**Ruta**: `services/provisioning-orchestrator/src/actions/async-operation-orphan-sweep.mjs`

Flujo:
1. Llama a `findOrphanCandidates` y `findStaleCancellingCandidates`.
2. Para cada huérfano `running`/`pending`:
   - `atomicTransitionSystem` → `failed` con `reason: 'orphaned — no progress detected'` (running) o `'stale — never started'` (pending).
   - Publica evento `console.async-operation.recovered`.
3. Para cada `cancelling` estancado:
   - `atomicTransitionSystem` → `cancelled` con `reason: 'cancellation forced — timeout'`.
   - Publica evento `console.async-operation.cancelled`.
4. Retorna `{ orphansRecovered: N, cancellingForced: M, errors: [...] }`.

### 3.8 Eventos Kafka — `async-operation-events.mjs`

**Ruta**: `services/provisioning-orchestrator/src/events/async-operation-events.mjs`

Nuevos topics y builders:

```js
export const ASYNC_OPERATION_CANCELLED_TOPIC   = 'console.async-operation.cancelled';
export const ASYNC_OPERATION_TIMED_OUT_TOPIC   = 'console.async-operation.timed-out';
export const ASYNC_OPERATION_RECOVERED_TOPIC   = 'console.async-operation.recovered';

export function buildCancelledEvent(operation, cancelledBy)
export function buildTimedOutEvent(operation)
export function buildRecoveredEvent(operation, recoveryReason)
```

Todos los builders siguen el patrón ya establecido: `eventId` (UUID), `eventType`, `operationId`, `tenantId`, `actorId` (o `'system'`), `occurredAt`, `correlationId`.

### 3.9 Contratos internos — `services/internal-contracts/src/`

Tres nuevos archivos JSON de esquema:

**`operation-cancel-event.json`**:

```json
{
  "type": "object",
  "required": ["eventId","eventType","operationId","tenantId","actorId","cancelledBy","previousStatus","occurredAt","correlationId"],
  "properties": { ... }
}
```

**`operation-timeout-event.json`**:

```json
{
  "type": "object",
  "required": ["eventId","eventType","operationId","tenantId","previousStatus","timeoutReason","occurredAt","correlationId"],
  "properties": { ... }
}
```

**`operation-recovery-event.json`**:

```json
{
  "type": "object",
  "required": ["eventId","eventType","operationId","tenantId","previousStatus","recoveryAction","recoveryReason","occurredAt","correlationId"],
  "properties": { ... }
}
```

Actualización de `services/internal-contracts/src/index.mjs` para exportar los tres nuevos schemas.

---

## 4. Modelo de Datos

### 4.1 Columnas añadidas a `async_operations`

| Columna | Tipo | Descripción |
|---|---|---|
| `cancelled_by` | `TEXT NULL` | actor_id que solicitó la cancelación |
| `cancellation_reason` | `TEXT NULL` | Motivo legible (timeout exceeded / cancellation requested / orphaned…) |
| `timeout_policy_snapshot` | `JSONB NULL` | Snapshot de la política de timeout aplicada al crear la operación |
| `policy_applied_at` | `TIMESTAMPTZ NULL` | Timestamp de cuándo se tomó el snapshot de política |

### 4.2 Nueva tabla `operation_policies`

| Columna | Tipo | Descripción |
|---|---|---|
| `policy_id` | `UUID PK` | Identificador |
| `operation_type` | `TEXT UNIQUE` | Tipo de operación (`*` para fallback global) |
| `timeout_minutes` | `INT` | Duración máxima en minutos |
| `orphan_threshold_minutes` | `INT` | Umbral de inactividad para detección de huérfanos |
| `cancelling_timeout_minutes` | `INT` | Umbral máximo en estado `cancelling` |
| `recovery_action` | `TEXT` | Acción: `'fail'` (único soportado en esta iteración) |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | Auditoría |

### 4.3 Multi-tenancy y seguridad de datos

- `operation_policies` es una tabla de configuración de la plataforma (no tenant-scoped): solo modificable por superadmin.
- Las nuevas columnas de `async_operations` están bajo las mismas políticas de acceso por `tenant_id` que las existentes.
- `cancelled_by` y `cancellation_reason` no exponen datos sensibles (solo actor_id y mensajes controlados).

### 4.4 Idempotencia de los sweeps

Los `atomicTransitionSystem` usan `FOR UPDATE` + verificación de estado actual: si la operación ya fue transicionada por otro proceso concurrente, el `validateTransition` rechaza la transición y el sweep la descarta (sin error fatal). Esto garantiza que el timeout/recovery no sobreescriba un `completed` legítimo.

---

## 5. Variables de Entorno

| Variable | Default | Descripción |
|---|---|---|
| `OPERATION_DEFAULT_TIMEOUT_MINUTES` | `60` | Timeout global cuando no hay política específica |
| `OPERATION_DEFAULT_ORPHAN_THRESHOLD_MINUTES` | `30` | Umbral de huérfano global |
| `OPERATION_DEFAULT_CANCELLING_TIMEOUT_MINUTES` | `5` | Tiempo máximo en `cancelling` |
| `TIMEOUT_SWEEP_INTERVAL_CRON` | `*/5 * * * *` | Cron del alarm trigger de OW para timeout sweep |
| `ORPHAN_SWEEP_INTERVAL_CRON` | `*/10 * * * *` | Cron del alarm trigger de OW para orphan sweep |

Añadir al `values.yaml` del chart Helm `provisioning-orchestrator` bajo `env:`.

---

## 6. Estrategia de Pruebas

### 6.1 Tests unitarios (node:test, sin dependencias externas)

**`tests/models/async-operation-states.test.mjs`**
- Verificar que `validateTransition` acepta `running → timed_out`, `running → cancelling`, `pending → cancelled`, `cancelling → cancelled`, `cancelling → failed`.
- Verificar que `validateTransition` rechaza `timed_out → *`, `cancelled → *`, `cancelling → running`, `cancelling → completed`.

**`tests/models/async-operation.test.mjs`**
- `applyTransition` a `timed_out` y `cancelling` actualiza los campos correctos.
- `isCancellable` retorna true para `pending`/`running` y false para el resto.

**`tests/actions/async-operation-cancel.test.mjs`**
- Cancelación de `pending` → `cancelled` directamente.
- Cancelación de `running` → `cancelling`.
- Rechazo de cancelación de estados terminales con `409`.
- Rechazo de cancelación cross-tenant con `403`.
- Superadmin puede cancelar operación de cualquier tenant.

**`tests/actions/async-operation-timeout-sweep.test.mjs`**
- Sweep procesa N operaciones candidatas, publica eventos y retorna `swept: N`.
- Si `atomicTransitionSystem` lanza `INVALID_TRANSITION` (race condition), el sweep no falla sino que registra el error y continúa.

**`tests/actions/async-operation-orphan-sweep.test.mjs`**
- Huérfanos `running` → `failed` con motivo correcto.
- Huérfanos `pending` → `failed` con motivo `stale`.
- `cancelling` estancado → `cancelled` forzado.
- Genera eventos auditables por cada operación afectada.

### 6.2 Tests de integración (PostgreSQL real en CI)

**`tests/repositories/async-operation-timeout-candidates.test.mjs`**
- Inserta operación `running` con `updated_at` en el pasado; verifica que `findTimedOutCandidates` la devuelve.
- Inserta operación `running` reciente; verifica que NO aparece.

**`tests/repositories/async-operation-orphan-candidates.test.mjs`**
- Verifica `findOrphanCandidates` y `findStaleCancellingCandidates` con datos reales.
- Verifica `atomicTransitionSystem` con concurrencia: dos llamadas simultáneas, solo una triunfa.

### 6.3 Tests de contrato (validación JSON Schema)

**`tests/contracts/operation-cancel-event.test.mjs`**  
**`tests/contracts/operation-timeout-event.test.mjs`**  
**`tests/contracts/operation-recovery-event.test.mjs`**

Verifican que los builders de eventos producen objetos válidos conforme a los JSON Schemas nuevos.

### 6.4 Tests de regresión

**`tests/models/async-operation-states-regression.test.mjs`**
- Las transiciones originales (`pending→running`, `running→completed`, `running→failed`) siguen funcionando exactamente como antes.

---

## 7. Eventos Kafka — Topics nuevos

| Topic | Productor | Consumidores esperados |
|---|---|---|
| `console.async-operation.cancelled` | `async-operation-cancel.mjs` / `async-operation-orphan-sweep.mjs` | Audit pipeline, UI realtime feed |
| `console.async-operation.timed-out` | `async-operation-timeout-sweep.mjs` | Audit pipeline, alertas |
| `console.async-operation.recovered` | `async-operation-orphan-sweep.mjs` | Audit pipeline |

Los tres nuevos topics siguen la misma estructura de clave (tenant_id) y valor (JSON) que los topics existentes de T01/T02/T03.

---

## 8. Configuración Helm / Kubernetes

**Chart**: `helm/provisioning-orchestrator/`

Añadir en `values.yaml`:

```yaml
timeoutSweep:
  enabled: true
  schedule: "*/5 * * * *"  # cron del alarm feed de OpenWhisk

orphanSweep:
  enabled: true
  schedule: "*/10 * * * *"

env:
  OPERATION_DEFAULT_TIMEOUT_MINUTES: "60"
  OPERATION_DEFAULT_ORPHAN_THRESHOLD_MINUTES: "30"
  OPERATION_DEFAULT_CANCELLING_TIMEOUT_MINUTES: "5"
```

Los sweeps se registran como OpenWhisk actions con alarm triggers; el chart gestiona la creación de triggers y rules via el `wsk` CLI en el hook `post-install`.

---

## 9. Riesgos, Compatibilidad y Rollback

### 9.1 Compatibilidad hacia atrás

- La migración `076` modifica el `CHECK` de `async_operations` añadiendo nuevos valores; esto es retrocompatible (las filas existentes con valores originales son válidas).
- Las nuevas columnas son todas `NULL`able; las operaciones existentes no necesitan migración de datos.
- Los consumers Kafka que sólo escuchan `state-changed` no se ven afectados; los nuevos topics son additive.

### 9.2 Race condition timeout vs. completado

Mitigado por `FOR UPDATE` en `atomicTransitionSystem`: si la operación ya está en `completed`, `validateTransition` lanza `INVALID_TRANSITION` y el sweep registra el conflicto sin aplicar `timed_out`. La transición `completed` gana por haber ocurrido primero.

### 9.3 Cancelación de operación en workflow multi-step (saga)

Si `saga_id != null`, la cancelación a `cancelling` actúa como señal al motor de sagas. La compensación real es responsabilidad de las specs 070/072 y no se implementa aquí. Esta tarea garantiza únicamente que el estado de la operación refleja `cancelling` → `cancelled`.

### 9.4 Rollback del deploy

1. Eliminar los tres nuevos topics Kafka (sin consumidores críticos aún).
2. Desactivar los alarm triggers de OW en el chart.
3. Revertir la migración `076` (ver sección rollback del SQL).
4. Hacer rollback del código de acción.

---

## 10. Observabilidad

Anotaciones de métricas (siguiendo el patrón `metricAnnotation` existente):

| Métrica | Labels |
|---|---|
| `async_operation_timeout_sweep_total` | `swept`, `errors` |
| `async_operation_orphan_sweep_total` | `recovered`, `forced_cancelled`, `errors` |
| `async_operation_cancellation_total` | `from_status`, `tenant` |
| `async_operation_transition_total` | ya existente — añadir `timed_out`, `cancelling`, `cancelled` |

Logs estructurados en cada acción siguiendo el patrón JSON ya establecido en `async-operation-transition.mjs`.

---

## 11. Dependencias y Secuencia de Implementación

### Dependencias previas requeridas

| Dependencia | Estado esperado |
|---|---|
| T01 — modelo de operaciones, `async_operations` + `async_operation_transitions` | Entregado |
| T02 — endpoints de consulta de progreso | Entregado |
| T03 — reintentos idempotentes, `retry_attempts`, `idempotency_key_records` | Entregado |

### Secuencia recomendada

```text
Paso 1: Migración 076-timeout-cancel-recovery.sql
Paso 2: async-operation-states.mjs — extensión de transiciones
Paso 3: async-operation.mjs — nuevos campos y applyTransition extendido
Paso 4: async-operation-repo.mjs — nuevas queries de sweep
Paso 5: async-operation-events.mjs — nuevos builders y topics
Paso 6: Contratos internos (3 JSON schemas + index.mjs)
Paso 7: async-operation-cancel.mjs (acción de cancelación)
Paso 8: async-operation-timeout-sweep.mjs
Paso 9: async-operation-orphan-sweep.mjs
Paso 10: Tests unitarios (paralelo con 7-9)
Paso 11: Tests de integración y contrato
Paso 12: Helm values.yaml (alarm triggers)
```

Los pasos 7, 8 y 9 son independientes entre sí y pueden desarrollarse en paralelo una vez listos los pasos 1–6.

---

## 12. Criterios de Done

| Criterio | Evidencia verificable |
|---|---|
| Migración aplica sin errores sobre schema existente | `psql -c \d async_operations` muestra nuevas columnas; `\d operation_policies` existe |
| `async-operation-states.mjs` cubre las 5 nuevas transiciones | Tests unitarios de estados pasan en verde |
| Acción `async-operation-cancel.mjs` acepta y rechaza correctamente | Tests de unidad de cancelación con mocks de repo y events pasan |
| Sweep de timeout procesa candidatos y publica eventos | Test de integración: operación `running` con `updated_at` expirado transiciona a `timed_out` |
| Sweep de orphan recupera operaciones bloqueadas | Test de integración: operación `pending` sin progreso transiciona a `failed` con motivo correcto |
| Race condition cancelación vs. completado no deja estado inconsistente | Test de concurrencia en integración: dos transiciones simultáneas, una gana, la otra es rechazada con `INVALID_TRANSITION` |
| Operaciones pre-076 siguen funcionando | Tests de regresión de transiciones originales pasan sin modificaciones |
| Tres nuevos eventos Kafka cumplen sus JSON Schemas | Tests de contrato en verde |
| `operation_policies` tiene fila `'*'` por defecto | Seed de migración verificado en test de integración |
| Variables de entorno documentadas en Helm values.yaml | `helm lint` pasa sin warnings sobre valores desconocidos |
