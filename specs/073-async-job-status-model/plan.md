# Implementation Plan: Modelo de Job/Operation Status para Workflows Asíncronos

**Branch**: `073-async-job-status-model` | **Date**: 2026-03-30 | **Spec**: [spec.md](./spec.md)
**Task ID**: US-UIB-02-T01 | **Epic**: EP-16 | **Historia**: US-UIB-02
**Input**: Feature specification from `/specs/073-async-job-status-model/spec.md`

---

## Summary

Esta tarea establece el **modelo fundacional de job/operation status**: la entidad `async_operation` en PostgreSQL, su máquina de estados (`pending → running → completed|failed`), el evento auditable publicado en Kafka en cada transición, y la lógica de dominio pura —sin endpoints HTTP— que crean, persisten y transicionan operaciones desde OpenWhisk. Sienta la base sobre la que US-UIB-02-T02 (endpoints de consulta) y US-UIB-02-T03 (reintentos e idempotencia) se apoyan.

---

## Technical Context

**Language/Version**: Node.js 20+ (ESM modules)
**Primary Dependencies**: PostgreSQL client (`pg`), Kafka producer (`kafkajs`), OpenWhisk action runtime
**Storage**: PostgreSQL (registro de operaciones y log de transiciones) + Kafka (eventos de auditoría)
**Testing**: Node.js built-in `node:test` + assertions
**Target Platform**: OpenWhisk (acciones) sobre Kubernetes/OpenShift
**Project Type**: Service library + OpenWhisk actions
**Performance Goals**: Creación de operación < 2 s (p95); transición de estado < 500 ms (p95)
**Constraints**: Sin endpoints HTTP propios en esta tarea (T02 los añade); multi-tenancy estricto; secrets fuera del repo
**Scale/Scope**: 1 000 – 10 000 operaciones activas concurrentes estimadas al inicio del proyecto

---

## Constitution Check

*GATE: evaluado antes de Phase 0. Re-evaluado tras Phase 1.*

| Principio | Verificación | Estado |
|-----------|-------------|--------|
| I — Monorepo SoC | Lógica de dominio en `services/provisioning-orchestrator`; contrato público en `services/internal-contracts` | ✅ |
| II — Incremental Delivery | Solo modelo, DDL, dominio y tests; sin endpoints ni UI en esta tarea | ✅ |
| III — K8s/OpenShift compat. | Sin security contexts propietarios; secrets vía K8s Secrets / env vars | ✅ |
| IV — Quality Gates at Root | Se añaden scripts de lint/test al paquete; los CI root gates ya los invocan con `pnpm -r test` | ✅ |
| V — Docs as Part of Change | `docs/adr/073-async-job-status-model.md` se crea junto al código | ✅ |
| Additional — pnpm workspaces | Se usa `pnpm` y workspace existente | ✅ |
| Additional — Secrets | Credenciales PG y Kafka no se commitean; se usan variables de entorno | ✅ |

**Veredicto**: sin violaciones. No se requiere tabla de Complexity Tracking.

---

## Phase 0 — Research

### Decisión 1: Relación entre `async_operation` y `saga_instances`

- **Decisión**: `async_operation` es una entidad de primer nivel, independiente de `saga_instances`.
- **Rationale**: `saga_instances` es la tabla interna del motor de sagas (ciclo de vida compensación, pasos). `async_operation` es la vista pública del ciclo de vida de una operación de cara a la consola; su ciclo de vida es más simple (`pending → running → completed|failed`). La desacoplación permite que T02–T06 evolucionen el modelo de operación sin tocar la saga.
- **Alternativa rechazada**: reutilizar `saga_instances` directamente — rechazado porque expone semántica interna de la saga (compensación, pasos) al modelo de consola, violando separación de responsabilidades.

### Decisión 2: Almacenamiento de log de transiciones

- **Decisión**: Tabla `async_operation_transitions` en el mismo esquema PostgreSQL.
- **Rationale**: Permite consulta histórica del ciclo de vida de una operación sin Kafka; Kafka se usa para propagación de eventos al sistema de auditoría, no como source of truth.
- **Alternativa rechazada**: solo Kafka — rechazado porque Kafka no garantiza consulta histórica ad-hoc ni aislamiento tenant en lecturas.

### Decisión 3: Generación del `correlation_id`

- **Decisión**: Si el caller provee `correlationId` en `callerContext`, se propaga. Si no, se genera con el patrón `op:{tenantId}:{timestamp_base36}:{random8}`, alineado con la política definida en `console-workflow-audit-policy.json`.
- **Rationale**: Mantiene consistencia con el contrato de trazabilidad ya ratificado en US-UIB-01-T05.

### Decisión 4: Evento Kafka de transición

- **Decisión**: Topic `console.async-operation.state-changed` (nuevo). Payload: schema `async-operation-state-changed` definido en `services/internal-contracts`.
- **Rationale**: Separa el stream de operaciones de consola de los eventos de saga ya existentes. Permite suscripción diferenciada desde el módulo de auditoría (T futura).

### Decisión 5: Capa de dominio en OpenWhisk

- **Decisión**: Dos acciones OpenWhisk: `async-operation/create` y `async-operation/transition`. Exportan también módulos ESM reutilizables para uso interno desde otros workflows.
- **Rationale**: Cumple restricción del stack — "la lógica backend compleja de la consola debe poder ejecutarse en OpenWhisk". Las acciones son wrappers delgados sobre módulos ESM puros.

---

## Phase 1 — Design & Contracts

### Data Model

Ver artefacto completo en [`data-model.md`](./data-model.md) (generado a continuación como sección en este plan).

#### Tabla `async_operations`

```sql
CREATE TABLE IF NOT EXISTS async_operations (
  operation_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        TEXT        NOT NULL,
  actor_id         TEXT        NOT NULL,
  actor_type       TEXT        NOT NULL,
  -- enum: workspace_admin | tenant_owner | superadmin | tenant_member
  workspace_id     TEXT,
  operation_type   TEXT        NOT NULL,
  -- e.g. 'WF-CON-001', 'WF-CON-002', custom provisioning type
  status           TEXT        NOT NULL DEFAULT 'pending',
  -- enum: pending | running | completed | failed
  error_summary    JSONB,
  -- structure: { code: string, message: string, failedStep: string|null }
  -- null unless status = 'failed'
  correlation_id   TEXT        NOT NULL,
  idempotency_key  TEXT,
  -- nullable; deduplication is T03 responsibility
  saga_id          UUID,
  -- nullable; links to saga_instances when backed by a saga
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT async_operations_status_check
    CHECK (status IN ('pending', 'running', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_async_ops_tenant_status
  ON async_operations(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_async_ops_correlation
  ON async_operations(correlation_id);
CREATE INDEX IF NOT EXISTS idx_async_ops_idempotency
  ON async_operations(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_async_ops_saga
  ON async_operations(saga_id)
  WHERE saga_id IS NOT NULL;
```

#### Tabla `async_operation_transitions`

```sql
CREATE TABLE IF NOT EXISTS async_operation_transitions (
  transition_id    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id     UUID        NOT NULL REFERENCES async_operations(operation_id),
  tenant_id        TEXT        NOT NULL,
  actor_id         TEXT        NOT NULL,
  previous_status  TEXT        NOT NULL,
  new_status       TEXT        NOT NULL,
  transitioned_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata         JSONB
  -- optional: {reason, triggeredBy, ...}
);

CREATE INDEX IF NOT EXISTS idx_async_op_transitions_operation
  ON async_operation_transitions(operation_id, transitioned_at);
```

#### Máquina de estados válida

```text
pending  → running
running  → completed
running  → failed
```

Los estados `completed` y `failed` son **terminales**: cualquier intento de transición desde ellos produce error `INVALID_TRANSITION`.

---

### Contrato Interno: `async-operation-state-changed` (Kafka event)

Archivo: `services/internal-contracts/src/async-operation-state-changed.json`

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "async-operation-state-changed",
  "title": "Async Operation State Changed Event",
  "type": "object",
  "required": [
    "eventId",
    "eventType",
    "operationId",
    "tenantId",
    "actorId",
    "previousStatus",
    "newStatus",
    "occurredAt",
    "correlationId"
  ],
  "properties": {
    "eventId":         { "type": "string", "format": "uuid" },
    "eventType":       { "type": "string", "const": "async_operation.state_changed" },
    "operationId":     { "type": "string", "format": "uuid" },
    "tenantId":        { "type": "string" },
    "workspaceId":     { "type": ["string", "null"] },
    "actorId":         { "type": "string" },
    "actorType":       { "type": "string" },
    "operationType":   { "type": "string" },
    "previousStatus":  { "type": "string", "enum": ["pending", "running", "completed", "failed"] },
    "newStatus":       { "type": "string", "enum": ["pending", "running", "completed", "failed"] },
    "errorSummary":    {
      "oneOf": [
        { "$ref": "#/definitions/errorSummary" },
        { "type": "null" }
      ]
    },
    "occurredAt":      { "type": "string", "format": "date-time" },
    "correlationId":   { "type": "string" }
  },
  "definitions": {
    "errorSummary": {
      "type": "object",
      "required": ["code", "message"],
      "properties": {
        "code":       { "type": "string" },
        "message":    { "type": "string" },
        "failedStep": { "type": ["string", "null"] }
      }
    }
  },
  "additionalProperties": false
}
```

Topic: `console.async-operation.state-changed`
Partición: por `tenantId` (garantiza ordenación por tenant).
Retention: alineado con política de auditoría del sistema (mínimo 30 días).

---

### Estructura de archivos nuevos / modificados

```text
services/
  provisioning-orchestrator/
    src/
      models/
        async-operation.mjs          # Entidad + validación de dominio
        async-operation-states.mjs   # FSM: VALID_TRANSITIONS, isTerminal(), validateTransition()
      repositories/
        async-operation-repo.mjs     # CRUD + query multi-tenant sobre PostgreSQL
      events/
        async-operation-events.mjs   # Constructor + publicador de eventos Kafka
      actions/
        async-operation-create.mjs   # OpenWhisk action: create
        async-operation-transition.mjs # OpenWhisk action: transition
      migrations/
        073-async-operation-tables.sql  # DDL (tablas + índices arriba definidos)

  internal-contracts/
    src/
      async-operation-state-changed.json  # Contrato evento Kafka (schema arriba)
      index.mjs                           # Añadir export de nuevo contrato

tests/
  unit/
    async-operation-states.test.mjs       # Tests FSM pura
    async-operation.test.mjs              # Tests entidad/validación
  integration/
    async-operation-repo.test.mjs         # Tests PostgreSQL (requiere DB test)
  contract/
    async-operation-state-changed.test.mjs # Valida payload contra schema JSON

docs/
  adr/
    073-async-job-status-model.md         # ADR: decisiones de esta tarea
```

---

## Project Structure

**Decision**: Single-service layout bajo `services/provisioning-orchestrator` (Option 1 del template). El modelo de job es parte del dominio de orquestación de aprovisionamiento. No se crea nuevo paquete pnpm.

```text
services/provisioning-orchestrator/
├── package.json                    (actualizado: añadir pg, kafkajs devDeps)
└── src/
    ├── models/
    │   ├── async-operation.mjs
    │   └── async-operation-states.mjs
    ├── repositories/
    │   └── async-operation-repo.mjs
    ├── events/
    │   └── async-operation-events.mjs
    ├── actions/
    │   ├── async-operation-create.mjs
    │   └── async-operation-transition.mjs
    └── migrations/
        ├── 070-saga-state-tables.sql   (existente)
        └── 073-async-operation-tables.sql (nuevo)

services/internal-contracts/src/
    ├── async-operation-state-changed.json  (nuevo)
    └── index.mjs                           (modificado)

tests/
    ├── unit/
    │   ├── async-operation-states.test.mjs
    │   └── async-operation.test.mjs
    ├── integration/
    │   └── async-operation-repo.test.mjs
    └── contract/
        └── async-operation-state-changed.test.mjs

docs/adr/
    └── 073-async-job-status-model.md
```

---

## Implementation — Module Specifications

### `async-operation-states.mjs`

```js
// Estado del FSM — sin dependencias externas
export const VALID_TRANSITIONS = Object.freeze({
  pending: ['running'],
  running: ['completed', 'failed'],
  completed: [],
  failed: [],
});

export const TERMINAL_STATES = Object.freeze(new Set(['completed', 'failed']));

export function isTerminal(status) {
  return TERMINAL_STATES.has(status);
}

export function validateTransition(current, next) {
  const allowed = VALID_TRANSITIONS[current] ?? [];
  if (!allowed.includes(next)) {
    throw Object.assign(new Error(
      `Invalid transition: ${current} → ${next}. Allowed: [${allowed.join(', ') || 'none'}]`
    ), { code: 'INVALID_TRANSITION', current, next });
  }
}
```

### `async-operation.mjs` — Entidad y fábrica

```js
import { randomUUID } from 'node:crypto';
import { validateTransition } from './async-operation-states.mjs';

const REQUIRED_CREATE_FIELDS = ['tenant_id', 'actor_id', 'actor_type', 'operation_type'];
const ACTOR_TYPES = new Set(['workspace_admin', 'tenant_owner', 'superadmin', 'tenant_member']);

export function createOperation({ tenant_id, actor_id, actor_type, workspace_id,
                                   operation_type, correlation_id, idempotency_key, saga_id } = {}) {
  for (const f of REQUIRED_CREATE_FIELDS) {
    if (!arguments[0]?.[f]) {
      throw Object.assign(new Error(`Missing required field: ${f}`),
        { code: 'VALIDATION_ERROR', field: f });
    }
  }
  if (!ACTOR_TYPES.has(actor_type)) {
    throw Object.assign(new Error(`Invalid actor_type: ${actor_type}`),
      { code: 'VALIDATION_ERROR', field: 'actor_type' });
  }

  const now = new Date().toISOString();
  return {
    operation_id: randomUUID(),
    tenant_id,
    actor_id,
    actor_type,
    workspace_id: workspace_id ?? null,
    operation_type,
    status: 'pending',
    error_summary: null,
    correlation_id: correlation_id ?? generateCorrelationId(tenant_id),
    idempotency_key: idempotency_key ?? null,
    saga_id: saga_id ?? null,
    created_at: now,
    updated_at: now,
  };
}

export function applyTransition(operation, { new_status, error_summary } = {}) {
  validateTransition(operation.status, new_status);
  if (new_status === 'failed' && !error_summary) {
    throw Object.assign(new Error('error_summary is required when transitioning to failed'),
      { code: 'VALIDATION_ERROR', field: 'error_summary' });
  }
  return {
    ...operation,
    status: new_status,
    error_summary: new_status === 'failed' ? error_summary : null,
    updated_at: new Date().toISOString(),
  };
}

function generateCorrelationId(tenantId) {
  const ts = Date.now().toString(36);
  const rand = randomUUID().replace(/-/g, '').slice(0, 8);
  return `op:${tenantId}:${ts}:${rand}`;
}
```

### `async-operation-repo.mjs` — PostgreSQL

Contrato funcional del repositorio (implementación completa en código real):

```js
// createOperation(db, operation)  → stored operation
// transitionOperation(db, { operation_id, tenant_id, new_status, actor_id, error_summary })
//   → { updatedOperation, transition }
// findById(db, { operation_id, tenant_id })  → operation | null  (tenant isolation)
// findByTenant(db, { tenant_id, status?, limit, offset })  → { items, total }
// findAll(db, { status?, limit, offset })  → { items, total }  (superadmin only — caller enforces)
```

**Tenant isolation**: todas las queries excepto `findAll` filtran por `tenant_id`. `findAll` es privado al módulo y solo invocado desde contextos verificados como superadmin.

**Transición atómica**: `transitionOperation` usa una transacción PG: (1) `SELECT FOR UPDATE` de la fila, (2) validación de FSM en aplicación, (3) `UPDATE async_operations`, (4) `INSERT async_operation_transitions`. Rollback si falla cualquier paso.

### `async-operation-events.mjs` — Kafka

```js
// publishStateChanged(producer, operation, previousStatus)
//   → publica en topic 'console.async-operation.state-changed'
//   → payload validado contra schema async-operation-state-changed.json
//   → clave de partición: tenantId
```

El publisher es **best-effort**: el fallo de publicación Kafka no revierte la transición de PG pero sí se registra en los logs de trazabilidad y produce una métrica de alerta (`async_operation_event_publish_failures_total`).

### Acciones OpenWhisk

**`async-operation-create.mjs`**:
- Input: `{ callerContext, operation_type, workspace_id?, correlation_id?, idempotency_key?, saga_id? }`
- Valida `callerContext.tenantId` y `callerContext.actor` obligatorios.
- Llama `createOperation()` → `repo.createOperation()` → `events.publishStateChanged()`.
- Output: `{ operationId, status, correlationId, createdAt }`
- Error codes: `VALIDATION_ERROR` (400), `DATABASE_ERROR` (500)

**`async-operation-transition.mjs`**:
- Input: `{ callerContext, operation_id, new_status, error_summary? }`
- Resuelve `tenantId` desde `callerContext`; superadmin puede omitir tenant filter si `callerContext.actorType === 'superadmin'`.
- Llama `repo.transitionOperation()` → `events.publishStateChanged()`.
- Output: `{ operationId, previousStatus, newStatus, updatedAt }`
- Error codes: `NOT_FOUND` (404), `INVALID_TRANSITION` (409), `VALIDATION_ERROR` (400), `TENANT_ISOLATION_VIOLATION` (403)

---

## Testing Strategy

### Unit Tests (`tests/unit/`)

| Archivo | Cobertura |
|---------|-----------|
| `async-operation-states.test.mjs` | Todas las transiciones válidas; todas las inválidas; estados terminales |
| `async-operation.test.mjs` | `createOperation` con campos válidos; rechazos por campos faltantes; `applyTransition` válido/inválido; generación de correlation_id |

### Integration Tests (`tests/integration/`)

| Archivo | Cobertura |
|---------|-----------|
| `async-operation-repo.test.mjs` | Crear operación en PG; transición atómica; tenant isolation (actor de tenant A no puede ver tenant B); `findById` con tenant_id incorrecto retorna null; transición inválida no corrompe estado |

Requiere: instancia PostgreSQL de test (Docker Compose o CI service). La migración se aplica antes de los tests.

### Contract Tests (`tests/contract/`)

| Archivo | Cobertura |
|---------|-----------|
| `async-operation-state-changed.test.mjs` | Valida payload de evento contra JSON Schema usando `ajv`; cubre caso pending→running, running→completed, running→failed |

### Acceptance Tests (criterios verificables en integración)

| ID | Escenario | Evidencia esperada |
|----|-----------|-------------------|
| AC-01 | Crear operación con callerContext válido | Registro en DB con status=pending, todos los campos requeridos presentes |
| AC-02 | Transición pending→running | DB actualizada; evento Kafka publicado |
| AC-03 | Transición running→completed | DB actualizada; evento Kafka publicado |
| AC-04 | Transición running→failed con error_summary | DB actualizada; error_summary almacenado |
| AC-05 | Transición desde estado terminal (completed→running) | Error INVALID_TRANSITION; estado en DB sin cambios |
| AC-06 | Tenant isolation | Actor de tenant A no puede leer/modificar operaciones de tenant B |
| AC-07 | Superadmin cross-tenant | Superadmin puede leer operaciones de cualquier tenant |
| AC-08 | Crear operación sin tenant_id | Error VALIDATION_ERROR; ningún registro creado |

---

## Migration Plan

Archivo: `services/provisioning-orchestrator/src/migrations/073-async-operation-tables.sql`

Contenido: DDL completo de `async_operations` y `async_operation_transitions` con índices (ver sección Data Model arriba).

**Aplicación**: manual vía script de migración existente o CI job. No hay datos previos que migrar. Las tablas son `CREATE TABLE IF NOT EXISTS` → idempotente.

**Rollback**: `DROP TABLE IF EXISTS async_operation_transitions; DROP TABLE IF EXISTS async_operations;` — seguro en pre-producción; requiere aprobación en producción.

---

## Risks, Observability & Security

### Riesgos

| Riesgo | Probabilidad | Mitigación |
|--------|-------------|-----------|
| PG connection pool agotado bajo carga | Media | Reutilizar pool compartido del orquestador; máximo 10 conexiones por instancia OW |
| Kafka producer lento bloquea transición | Baja | Publicación asíncrona (fire-and-forget con timeout); la transición ya está committed en PG |
| Estado inconsistente si OW action falla tras PG commit y antes de Kafka publish | Baja | El evento Kafka se puede regenerar desde `async_operation_transitions` en un job de reconciliación (T04) |
| Tenant isolation bypass por omisión de `tenant_id` en query | Media | Lint rule + revisión de código; tests de aislamiento en CI |

### Observabilidad

- Métricas (Prometheus): `async_operation_created_total{tenant, operation_type}`, `async_operation_transition_total{from, to}`, `async_operation_event_publish_failures_total`
- Logs estructurados: cada create y transition emite log JSON con `operation_id`, `tenant_id`, `correlation_id`, `status`
- Correlación: `correlation_id` propagado en header `X-Correlation-Id` de respuesta OW

### Seguridad

- `error_summary.message` debe omitir stack traces, connection strings y datos de usuario; solo mensajes legibles de negocio.
- `tenant_id` se toma siempre del `callerContext` verificado por IAM (Keycloak); nunca de la payload de input del cliente.
- Superadmin cross-tenant: verificado por `actorType === 'superadmin'` en `callerContext`; nunca por flag en payload.

---

## Dependencies & Sequencing

### Prerequisitos externos

- **US-UIB-01** (IAM/Keycloak): provee `callerContext` con `tenant_id` y `actor_id` verificados. ✅ Declarada en spec.

### Secuencia de implementación recomendada

```text
1. DDL migration (073-async-operation-tables.sql)
2. async-operation-states.mjs + unit tests
3. async-operation.mjs (entity) + unit tests
4. async-operation-repo.mjs + integration tests
5. async-operation-events.mjs + contract tests
6. async-operation-create.mjs (OW action)
7. async-operation-transition.mjs (OW action)
8. internal-contracts: async-operation-state-changed.json + index.mjs export
9. docs/adr/073-async-job-status-model.md
10. Update AGENTS.md y package.json scripts
```

Pasos 2–3 paralelizables con 4–5 si hay dos revisores.

### Dependencias de tareas siguientes

- **T02** (endpoints consulta): depende de `async-operation-repo.mjs` y el schema de `console-workflow-job-status.json` ya existente.
- **T03** (reintentos + idempotencia): depende de `idempotency_key` en `async_operations` y del modelo de transición.
- **T04** (timeout + cancelación): depende de `async_operation_transitions` para detectar operaciones stuck en `pending`/`running`.

---

## Criteria of Done

| ID | Criterio | Evidencia |
|----|----------|-----------|
| DOD-01 | `async_operations` y `async_operation_transitions` existen en DB con todos los índices | `\d+ async_operations` en psql |
| DOD-02 | Unit tests de FSM pasan al 100% | `pnpm -r test` verde; cobertura FSM 100% |
| DOD-03 | Integration tests de repo pasan | Tests de aislamiento tenant pasan; transición inválida no corrompe estado |
| DOD-04 | Contract test de evento Kafka pasa | AJV valida payload contra schema sin errores |
| DOD-05 | Acciones OW `async-operation/create` y `async-operation/transition` ejecutan sin error en entorno local | `wsk action invoke` con payload válido retorna 200 con campos esperados |
| DOD-06 | Tenant isolation verificado: actor tenant A no accede a operaciones tenant B | Test de integración DOD-03 cubre este caso |
| DOD-07 | `async-operation-state-changed.json` exportado desde `internal-contracts` | Import exitoso en test de contrato |
| DOD-08 | ADR `073-async-job-status-model.md` commit junto al código | Presente en `docs/adr/` en el mismo PR |
| DOD-09 | `pnpm -r lint`, `pnpm -r typecheck`, `pnpm -r test` pasan en CI desde root | Pipeline CI verde |
| DOD-10 | SC-001: operación creada < 2 s p95 | Medido en test de integración con timer |
| DOD-11 | SC-002: transiciones inválidas rechazadas 100% | Tests de FSM |
| DOD-12 | SC-003: aislamiento tenant 100% | Tests de repo |
| DOD-13 | SC-004 + SC-005: evento auditable y campos de trazabilidad | Tests de contrato + integración |

---

*Plan generado por `/speckit.plan` — US-UIB-02-T01 — 2026-03-30*
