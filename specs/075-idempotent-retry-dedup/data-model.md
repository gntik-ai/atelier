# Data Model: Reintentos Idempotentes con Deduplicación por Idempotency Key

**Feature Branch**: `075-idempotent-retry-dedup`  
**Task**: US-UIB-02-T03  
**Phase**: Phase 1 output

---

## Entidades del Dominio

### 1. IdempotencyKeyRecord

Representa la asociación entre una idempotency key, un tenant y una operación existente. Permite deduplicar solicitudes dentro de la ventana de validez.

**Campos**:

| Campo | Tipo | Nullable | Descripción |
|-------|------|----------|-------------|
| `record_id` | UUID | NO | PK generado automáticamente |
| `tenant_id` | TEXT | NO | Tenant al que pertenece la key (scoping multi-tenant) |
| `idempotency_key` | TEXT | NO | Key opaca proporcionada por el cliente (1-128 chars, `[a-zA-Z0-9_-]`) |
| `operation_id` | UUID | NO | FK → `async_operations.operation_id` |
| `operation_type` | TEXT | NO | Tipo de operación asociada (para detección de conflicto de tipo) |
| `params_hash` | TEXT | NO | SHA-256 hex de los parámetros (para detección de discrepancia, FR-005) |
| `created_at` | TIMESTAMPTZ | NO | Timestamp de creación del registro |
| `expires_at` | TIMESTAMPTZ | NO | Timestamp de expiración (TTL configurable, default 48h) |

**Constraint de unicidad**: `UNIQUE (tenant_id, idempotency_key)` — garantiza aislamiento multi-tenant y deduplicación estructural.

**Validaciones**:
- `idempotency_key` longitud 1-128, caracteres `[a-zA-Z0-9_-]`
- `expires_at > created_at`

**Estado tras expiración**: registros con `expires_at <= NOW()` son tratados como inexistentes por el lookup. Una nueva solicitud con la misma key puede sobreescribir el registro expirado (INSERT con conflict update o DELETE+INSERT).

---

### 2. RetryAttempt

Representa un intento de ejecución de una operación fallida. Vinculado a la operación original.

**Campos**:

| Campo | Tipo | Nullable | Descripción |
|-------|------|----------|-------------|
| `attempt_id` | UUID | NO | PK generado automáticamente |
| `operation_id` | UUID | NO | FK → `async_operations.operation_id` |
| `tenant_id` | TEXT | NO | Tenant (desnormalizado para queries eficientes) |
| `attempt_number` | INT | NO | Número de intento (1-indexed, incrementado por `attempt_count` en `async_operations`) |
| `correlation_id` | TEXT | NO | Nuevo correlation_id generado para este intento |
| `actor_id` | TEXT | NO | Actor que solicitó el reintento |
| `actor_type` | TEXT | NO | Tipo de actor |
| `status` | TEXT | NO | Estado del intento: `pending`, `running`, `completed`, `failed` |
| `created_at` | TIMESTAMPTZ | NO | Timestamp de creación del intento |
| `completed_at` | TIMESTAMPTZ | YES | Timestamp de finalización (null si no completado) |
| `metadata` | JSONB | YES | Metadata adicional (causa del fallo, notas, etc.) |

**Constraint de unicidad**: `UNIQUE (operation_id, attempt_number)` — evita números de intento duplicados por operación.

**Check constraint**: `status IN ('pending', 'running', 'completed', 'failed')`

---

### 3. AsyncOperation (extensión de T01)

Las columnas `attempt_count` y `max_retries` se añaden a la tabla existente `async_operations`.

| Campo añadido | Tipo | Nullable | Default | Descripción |
|---------------|------|----------|---------|-------------|
| `attempt_count` | INT | NO | 0 | Contador de intentos de reintento realizados |
| `max_retries` | INT | YES | NULL | Límite máximo de reintentos (NULL = usar default del sistema) |

**Nota**: `idempotency_key` ya existe en `async_operations` desde la migración 073 (T01). No se modifica.

**Transición de estado en reintento**:
- Operación en `failed` → `pending` (al crear un retry_attempt)
- `attempt_count` se incrementa atómicamente con la transición de estado

---

## DDL Completo — Migración 075

**Archivo**: `services/provisioning-orchestrator/src/migrations/075-idempotency-retry-tables.sql`

```sql
-- Migration 075: idempotency_key_records + retry_attempts + async_operations extensions
-- Adds idempotency key deduplication and safe retry capabilities (US-UIB-02-T03).
-- Idempotent: CREATE TABLE IF NOT EXISTS + ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Rollback:
--   DROP TABLE IF EXISTS retry_attempts;
--   DROP TABLE IF EXISTS idempotency_key_records;
--   ALTER TABLE async_operations DROP COLUMN IF EXISTS attempt_count;
--   ALTER TABLE async_operations DROP COLUMN IF EXISTS max_retries;

-- 1. Idempotency key records table
CREATE TABLE IF NOT EXISTS idempotency_key_records (
  record_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         TEXT        NOT NULL,
  idempotency_key   TEXT        NOT NULL,
  operation_id      UUID        NOT NULL REFERENCES async_operations(operation_id),
  operation_type    TEXT        NOT NULL,
  params_hash       TEXT        NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ NOT NULL,
  CONSTRAINT uq_idempotency_key_tenant UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_ikey_expires_at
  ON idempotency_key_records (expires_at)
  WHERE expires_at > NOW();

-- 2. Retry attempts table
CREATE TABLE IF NOT EXISTS retry_attempts (
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

CREATE INDEX IF NOT EXISTS idx_retry_attempts_operation
  ON retry_attempts (operation_id, attempt_number);

CREATE INDEX IF NOT EXISTS idx_retry_attempts_tenant_status
  ON retry_attempts (tenant_id, status);

-- 3. Extend async_operations with attempt tracking
ALTER TABLE async_operations
  ADD COLUMN IF NOT EXISTS attempt_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_retries   INT;
```

---

## Reglas de Negocio y Transiciones de Estado

### Deduplicación

```text
Solicitud recibida con idempotency_key
  │
  ▼
SELECT FROM idempotency_key_records
  WHERE tenant_id = $1 AND idempotency_key = $2 AND expires_at > NOW()
  │
  ├─► [encontrado, mismo tipo] ──► retornar operación existente (idempotent: true)
  │      verificar params_hash → si difiere: paramsMismatch: true (warning)
  │
  ├─► [encontrado, tipo diferente] ──► ERROR IDEMPOTENCY_KEY_CONFLICT (409)
  │
  └─► [no encontrado o expirado]
         │
         ▼
       BEGIN TRANSACTION
         INSERT async_operations (nueva operación)
         INSERT idempotency_key_records ON CONFLICT DO NOTHING
       COMMIT
         │
         ├─► [INSERT ok] ──► retornar nueva operación (idempotent: false)
         └─► [conflict] ──► re-fetch → retornar operación ganadora (idempotent: true)
```

### Reintento

```text
POST /operations/{id}/retry
  │
  ▼
findById(operation_id, tenant_id)
  │
  ├─► [no encontrada] ──► 404 Not Found
  ├─► [tenant mismatch] ──► 403 Forbidden
  │
  ▼
¿status === 'failed'?
  │
  ├─► [NO] ──► 409 Conflict (INVALID_OPERATION_STATE)
  │
  ▼
¿attempt_count < (max_retries ?? OPERATION_DEFAULT_MAX_RETRIES)?
  │
  ├─► [NO] ──► 422 Unprocessable (MAX_RETRIES_EXCEEDED)
  │
  ▼
BEGIN TRANSACTION
  INSERT retry_attempts (attempt_number = attempt_count + 1, nuevo correlation_id)
  INSERT async_operation_transitions (failed → pending)
  UPDATE async_operations SET
    status = 'pending',
    attempt_count = attempt_count + 1,
    error_summary = NULL,
    updated_at = NOW()
  WHERE operation_id = $1 AND tenant_id = $2 AND status = 'failed'  -- optimistic lock
COMMIT
  │
  ├─► [UPDATE 0 rows] ──► 409 (estado cambió entre verificación y update)
  └─► [ok] ──► publicar retry-requested event → retornar attempt
```

---

## Índices y Rendimiento

| Índice | Tabla | Columnas | Propósito |
|--------|-------|----------|-----------|
| `uq_idempotency_key_tenant` | `idempotency_key_records` | `(tenant_id, idempotency_key)` | UNIQUE + deduplicación atómica |
| `idx_ikey_expires_at` | `idempotency_key_records` | `(expires_at)` WHERE activo | Purga futura + filtrado de expirados |
| `uq_retry_attempt_number` | `retry_attempts` | `(operation_id, attempt_number)` | UNIQUE + ordinalidad |
| `idx_retry_attempts_operation` | `retry_attempts` | `(operation_id, attempt_number)` | Historial de intentos por operación |
| `idx_retry_attempts_tenant_status` | `retry_attempts` | `(tenant_id, status)` | Queries multi-tenant por estado |

---

## Aislamiento Multi-Tenant

Todas las queries de repositorio incluyen `tenant_id` como filtro obligatorio:

- `idempotency-key-repo.mjs`: `WHERE tenant_id = $1 AND idempotency_key = $2`
- `retry-attempt-repo.mjs`: `WHERE operation_id = $1 AND tenant_id = $2`
- La UNIQUE constraint `(tenant_id, idempotency_key)` garantiza que dos tenants pueden usar la misma key sin colisión — el aislamiento es estructural.

---

## Compatibilidad y Migraciones

### Compatibilidad hacia atrás

- `attempt_count` tiene `DEFAULT 0` — operaciones existentes no se ven afectadas.
- `max_retries` es nullable — operaciones existentes usan el default del sistema.
- `idempotency_key` en `async_operations` ya era nullable desde T01 — sin cambio.
- `retry_attempts` es una tabla nueva; no modifica lógica existente de operaciones.

### Rollback

```sql
DROP TABLE IF EXISTS retry_attempts;
DROP TABLE IF EXISTS idempotency_key_records;
ALTER TABLE async_operations
  DROP COLUMN IF EXISTS attempt_count,
  DROP COLUMN IF EXISTS max_retries;
```

Safe si no hay FKs externas dependientes de las nuevas tablas.
