# Research: Reintentos Idempotentes con Deduplicación por Idempotency Key

**Feature Branch**: `075-idempotent-retry-dedup`  
**Task**: US-UIB-02-T03  
**Phase**: Phase 0 output — todas las NEEDS CLARIFICATION resueltas

---

## R-001 — Resolución de concurrencia en PostgreSQL para idempotency keys

**Decision**: `INSERT INTO idempotency_key_records (...) ON CONFLICT (tenant_id, idempotency_key) DO NOTHING RETURNING *` con re-fetch posterior si el INSERT no retorna fila.

**Rationale**:
- PostgreSQL garantiza atomicidad del INSERT bajo constraint UNIQUE incluso bajo nivel de aislamiento `READ COMMITTED` (default).
- El patrón `INSERT … ON CONFLICT DO NOTHING` es el estándar de la industria para deduplicación sin locks explícitos (usado por Stripe, GitHub, AWS).
- No requiere `SERIALIZABLE` ni advisory locks, que añadirían overhead significativo.

**Alternatives considered**:
- Advisory locks (`pg_try_advisory_xact_lock`): mayor complejidad, riesgo de deadlock, no portables.
- `SERIALIZABLE` isolation: overhead excesivo (~3x más lento) para este volumen de operaciones.
- Redis SETNX: introduce dependencia nueva no contemplada en el stack.
- Optimistic locking con version column: requiere retry loop en aplicación; más complejo.

**Implementation note**: Si `ON CONFLICT DO NOTHING` resulta en 0 filas (`result.rowCount === 0`), otro worker ganó la carrera. El código DEBE hacer un SELECT inmediato con `SELECT * FROM idempotency_key_records WHERE tenant_id = $1 AND idempotency_key = $2` para recuperar y retornar el registro existente.

---

## R-002 — Estructura de almacenamiento de intentos de reintento

**Decision**: Tabla separada `retry_attempts` referenciada desde `async_operations` via FK.

**Rationale**:
- La operación original mantiene su identidad y `operation_id` permanente — crítico para trazabilidad.
- Cada intento tiene su propio `correlation_id`, timestamps y estado independientes.
- Permite consultar el historial completo de intentos sin mutar la operación base.
- Consistente con el patrón `async_operation_transitions` ya existente en el proyecto.

**Alternatives considered**:
- Array JSONB en `async_operations`: pierde índices, búsquedas ineficientes, difícil de consultar.
- Columnas `attempt_count/last_retry_at` sin tabla separada: no preserva historial completo, no cumple SC-005 (traza completa de intentos).
- Nueva operación independiente por reintento: rompe la identidad de la operación original, incompatible con FR-009.

---

## R-003 — Ventana de validez de idempotency keys (TTL)

**Decision**: TTL por defecto de 48 horas, configurable via variable de entorno `IDEMPOTENCY_KEY_TTL_HOURS`. Campo `expires_at TIMESTAMPTZ` en `idempotency_key_records`. Verificación en query de lookup (`WHERE expires_at > NOW()`).

**Rationale**:
- 48h cubre todos los flujos normales de consola (sesiones de trabajo, reintentos de red con backoff).
- La expiración via campo de timestamp en PostgreSQL es simple, eficiente y no requiere jobs externos en este scope.
- Registros expirados son "invisibles" en lookups pero permanecen en tabla — purga futura corresponde a T04 o job de mantenimiento.
- El índice `(expires_at)` soporta queries de purga eficientes cuando se implementen.

**Alternatives considered**:
- TTL via Redis: introduce dependencia nueva.
- Purga activa en este scope: fuera de alcance de T03; la purga sin coordinar puede causar ventanas de inconsistencia.
- TTL de 24h: demasiado corto para procesos de aprovisionamiento con reintentos manuales.
- TTL de 7d: acumulación excesiva de registros sin impacto real en funcionalidad.

---

## R-004 — Límite máximo de reintentos y configurabilidad por tipo

**Decision**: Valor por defecto de 5 reintentos, configurable via variable de entorno `OPERATION_DEFAULT_MAX_RETRIES`. La columna `max_retries` en `async_operations` permite override por operación (nullable = usar default del sistema).

**Rationale**:
- 5 reintentos es un valor conservador que cubre fallos transitorios sin riesgo de bucles infinitos.
- La columna `max_retries` nullable en `async_operations` ya existe en la spec de T01 (campo extendido en T03), permitiendo granularidad por operación sin complejidad de tabla de configuración separada.
- Configurabilidad via env var sigue el patrón del proyecto (12-factor app, Helm values).

**Alternatives considered**:
- Tabla `operation_type_config` con max_retries por tipo: más flexible pero aumenta complejidad de configuración y requiere migración adicional; diferible a T04.
- Hardcoded en código: no configurable, no Helm-friendly.
- Sin límite: riesgo de bucles infinitos en fallos persistentes.

---

## R-005 — Topics Kafka para eventos auditables

**Decision**: Dos topics nuevos separados del topic de estado:
- `console.async-operation.deduplicated` — evento de deduplicación  
- `console.async-operation.retry-requested` — evento de solicitud de reintento

**Rationale**:
- Separación de responsabilidades: los consumidores de auditoría no necesitan procesar todos los eventos de estado.
- Consistente con la arquitectura de topics del proyecto (naming: `console.{entity}.{event}`).
- Permite consumidores independientes (audit service, observabilidad) sin contaminar el flujo de estado principal.
- Particiones: 3 (mismo que otros topics del proyecto); retención: 7 días.

**Alternatives considered**:
- Reutilizar `console.async-operation.state-changed`: contamina el flujo de estado con eventos de meta-operación; consumidores de estado deberían ignorarlos.
- Topic único `console.async-operation.audit`: demasiado genérico, dificulta routing y consumo selectivo.

---

## R-006 — Hash de parámetros para detección de discrepancias (FR-005)

**Decision**: SHA-256 hex de JSON serializado con keys ordenadas (determinístico). Almacenar solo el hash, no los parámetros completos.

**Rationale**:
- Privacy by design: no almacenar datos de aprovisionamiento en la tabla de idempotency keys.
- SHA-256 es suficientemente resistente a colisiones para detectar discrepancias con alta fiabilidad.
- JSON con keys ordenadas (`JSON.stringify(sortedParams)`) garantiza determinismo independiente del orden de inserción.
- El hash es un `TEXT` fijo de 64 chars, eficiente en storage.

**Implementation**:
```javascript
import { createHash } from 'node:crypto';

function hashParams(params) {
  const sorted = Object.fromEntries(
    Object.entries(params ?? {}).sort(([a], [b]) => a.localeCompare(b))
  );
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}
```

---

## R-007 — Compatibilidad hacia atrás con operaciones sin idempotency key

**Decision**: `idempotency_key` en `async_operations` ya es nullable desde T01. Las solicitudes sin Idempotency-Key header se procesan por el flujo original sin deduplicación. No hay cambios en el comportamiento actual.

**Rationale**:
- FR-006 requiere explícitamente que solicitudes sin key creen nueva operación (compatibilidad hacia atrás).
- El campo `idempotency_key` nullable en `async_operations` ya existe en la migración 073; no requiere cambio de schema.
- La extensión de `async-operation-create.mjs` es condicional: `if (params.idempotency_key) { ... dedup logic ... }`.

---

## Conclusión

Todas las NEEDS CLARIFICATION han sido resueltas. No se requieren cambios de stack. El plan técnico puede proceder a Phase 1.
