# Plan de Implementación: US-BKP-01-T03 — Auditoría completa de acciones de recuperación

**Branch**: `111-backup-audit-trail` | **Fecha**: 2026-04-01 | **Spec**: `specs/111-backup-audit-trail/spec.md`\
**Input**: Especificación US-BKP-01-T03 | **Tamaño**: M | **Prioridad**: P1\
**Dependencias**: US-BKP-01-T01 ✅ (rama `109-backup-status-visibility`) | US-BKP-01-T02 ✅ (rama `110-backup-admin-endpoints`)

---

## Resumen ejecutivo

Extender el módulo `backup-status` con un sistema de auditoría completo, inmutable y consultable para toda acción de backup o restauración iniciada desde la plataforma. La solución añade:

- Una tabla `backup_audit_events` en PostgreSQL para almacenamiento persistente y fallback de eventos.
- Un módulo `audit-trail.ts` que reemplaza y extiende `audit.ts`, enriqueciendo cada evento con el contexto de sesión (IP, user-agent, session ID) y publicando en el topic Kafka `platform.backup.audit.events`.
- Hooks de emisión en todos los puntos de mutación de T02 (endpoints de trigger y el dispatcher de estados).
- Un nuevo endpoint REST `GET /v1/backup/audit` para consulta paginada de eventos con filtros.
- Dos nuevas vistas en la consola React: historial administrativo completo (superadmin/SRE) e historial resumido para el tenant owner.
- Un mecanismo de fallback con reintento exponencial cuando el pipeline Kafka de US-OBS-01 no está disponible.

El trail de auditoría es **append-only**: no se exponen operaciones de mutación sobre los eventos. Cada solicitud rechazada (HTTP 403/422/409) también genera su evento correspondiente, de modo que el historial es completo e inviolable.

---

## Contexto técnico

- **Lenguaje/Runtime**: Node.js 20+ ESM, TypeScript (acciones OpenWhisk), React 18 + Tailwind + shadcn/ui (consola)
- **Infraestructura de compute**: OpenWhisk (nuevas acciones para consulta de auditoría; hooks integrados en acciones existentes de T02)
- **Base de datos**: PostgreSQL — tablas existentes de T01/T02 + nueva tabla `backup_audit_events`
- **Gateway**: Apache APISIX (nueva ruta para el endpoint de consulta de auditoría)
- **IAM**: Keycloak (nuevo scope `backup-audit:read:global` + scope reducido para tenant owner)
- **Mensajería**: Kafka — nuevo topic `platform.backup.audit.events`
- **Monorepo**: `/root/projects/falcone` — extensión de `services/backup-status/`
- **Dependencias funcionales**: US-BKP-01-T01, US-BKP-01-T02, US-OBS-01

---

## Verificación de constitución

- **Inmutabilidad**: PASS — Los eventos de auditoría son append-only. La API no expone PUT, PATCH ni DELETE sobre eventos.
- **No bloqueo de operaciones por fallo de auditoría**: PASS — El módulo de auditoría opera en modo fire-and-forget con fallback local; los endpoints de mutación no esperan confirmación de publicación Kafka.
- **Aislamiento multi-tenant**: PASS — Todo evento contiene `tenant_id`; el endpoint de consulta filtra estrictamente por tenant cuando el rol es `tenant_owner`.
- **Separación de concerns**: PASS — El módulo `audit-trail.ts` es independiente de la lógica de negocio de operaciones. Los handlers de T02 lo invocan como efecto secundario.
- **Entrega incremental**: PASS — Cada subsistema (schema DB, módulo de auditoría, hooks en T02, endpoint API, frontend) se entrega en commits atómicos.

---

## Estructura del proyecto

### Documentación (esta feature)

```text
specs/111-backup-audit-trail/
├── spec.md
├── plan.md          ← este fichero
└── tasks.md
```

### Código fuente — extensiones sobre `services/backup-status/`

```text
services/backup-status/
├── src/
│   ├── audit/
│   │   ├── audit-trail.ts                        # NUEVO — Módulo central de auditoría:
│   │   │                                         #   emite AuditEvent, Kafka + fallback DB
│   │   ├── audit-trail.types.ts                  # NUEVO — AuditEvent, AuditEventType,
│   │   │                                         #   SessionContext, AuditQueryFilters
│   │   ├── audit-trail.repository.ts             # NUEVO — DAL para backup_audit_events
│   │   └── audit-trail.fallback.ts               # NUEVO — Lógica de reintento con backoff
│   │                                             #   exponencial para eventos pendientes
│   ├── operations/
│   │   ├── trigger-backup.action.ts              # MODIFICADO — Añadir hook de auditoría
│   │   │                                         #   al aceptar/rechazar solicitud
│   │   ├── trigger-restore.action.ts             # MODIFICADO — Añadir hook de auditoría
│   │   │                                         #   al aceptar/rechazar solicitud
│   │   ├── operation-dispatcher.ts               # MODIFICADO — Emitir eventos de auditoría
│   │   │                                         #   en cada transición de estado
│   │   └── query-audit.action.ts                 # NUEVO — Acción OpenWhisk:
│   │                                             #   GET /v1/backup/audit
│   ├── db/
│   │   └── migrations/
│   │       └── 003_backup_audit_events.sql       # NUEVO — Tabla backup_audit_events + índices
│   └── shared/
│       └── audit.ts                              # EXISTENTE — se mantiene sin cambios
│                                                 #   (T01: logAccessEvent, logCollectionCycle)
├── test/
│   ├── unit/
│   │   └── audit/
│   │       ├── audit-trail.test.ts               # NUEVO — Emisión, fallback, esquema
│   │       ├── audit-trail.repository.test.ts    # NUEVO — CRUD de backup_audit_events
│   │       ├── audit-trail.fallback.test.ts      # NUEVO — Reintento exponencial
│   │       └── query-audit.action.test.ts        # NUEVO — Filtros, paginación, RBAC
│   ├── integration/
│   │   └── backup-audit-api.test.mjs             # NUEVO — E2E: emitir evento → consultar API
│   └── contract/
│       └── audit-event.contract.ts               # NUEVO — Validación del schema JSON v1

services/gateway-config/
└── routes/
    └── backup-audit-routes.yaml                  # NUEVO — Ruta APISIX para GET /v1/backup/audit

services/keycloak-config/
└── scopes/
    └── backup-audit-scopes.yaml                  # NUEVO — Scopes de lectura de auditoría

apps/console/
└── src/
    ├── pages/
    │   ├── admin/
    │   │   └── BackupAuditPage.tsx               # NUEVO — Vista de historial de auditoría
    │   │                                         #   para SRE/superadmin (detalle completo)
    │   └── tenant/
    │       └── BackupAuditSummaryPage.tsx         # NUEVO — Vista resumida para tenant owner
    ├── components/backup/
    │   ├── AuditEventTable.tsx                   # NUEVO — Tabla de eventos con columnas
    │   │                                         #   configurables por rol
    │   ├── AuditEventDetail.tsx                  # NUEVO — Panel expandible de detalle
    │   │                                         #   de un evento (IP, user-agent, sesión)
    │   ├── AuditEventFilters.tsx                 # NUEVO — Formulario de filtros
    │   │                                         #   (tenant, tipo, actor, rango, resultado)
    │   └── AuditEventTypeBadge.tsx               # NUEVO — Badge de tipo de evento
    │                                             #   con color semántico
    ├── hooks/
    │   └── useAuditEvents.ts                     # NUEVO — Query hook para GET /v1/backup/audit
    └── lib/api/
        └── backup-audit.api.ts                   # NUEVO — Cliente HTTP para el endpoint de auditoría

helm/
└── charts/backup-status/
    ├── values.yaml                               # MODIFICADO — Añadir sección audit:
    └── templates/
        └── openwhisk-audit-actions.yaml          # NUEVO — Deploy de la acción query-audit

```

---

## Arquitectura y flujo de datos

### Diagrama de flujo: emisión de evento de auditoría

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│  EMISIÓN DE EVENTO DE AUDITORÍA                                                  │
│                                                                                  │
│  [Punto de emisión: trigger-backup.action / trigger-restore.action]              │
│    │                                                                              │
│    ├── (1) Solicitud rechazada (403/422/409)                                     │
│    │         └─► emitAuditEvent({ type: 'backup.rejected' | 'restore.rejected',  │
│    │               correlationId: gen_uuid(), sessionContext, motivo })           │
│    │                                                                              │
│    └── (2) Solicitud aceptada → operation_id creado                              │
│              └─► emitAuditEvent({ type: 'backup.requested' | 'restore.requested',│
│                    operationId, sessionContext })                                 │
│                                                                                  │
│  [Punto de emisión: operation-dispatcher.ts]                                     │
│    ├── accepted → in_progress                                                    │
│    │     └─► emitAuditEvent({ type: 'backup.started' | 'restore.started',        │
│    │           operationId })                                                    │
│    ├── in_progress → completed                                                   │
│    │     └─► emitAuditEvent({ type: 'backup.completed' | 'restore.completed',    │
│    │           operationId })                                                    │
│    └── in_progress → failed                                                      │
│          └─► emitAuditEvent({ type: 'backup.failed' | 'restore.failed',          │
│                operationId, failureReason })                                     │
│                                                                                  │
│  [audit-trail.ts: emitAuditEvent(event)]                                         │
│    │                                                                              │
│    ├── (A) Persistir en backup_audit_events (PostgreSQL) — síncrono              │
│    │         └─► garantiza que el evento existe aunque Kafka falle               │
│    │                                                                              │
│    └── (B) Publicar en Kafka topic: platform.backup.audit.events — asíncrono    │
│              │                                                                    │
│              ├── Éxito: marcar evento como published_at = NOW()                  │
│              └── Fallo: dejar published_at = NULL                                │
│                            └─► audit-trail.fallback.ts detecta y reintenta       │
│                                  con backoff exponencial                         │
│                                  └─► genera alerta operacional si falla N veces  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Diagrama de flujo: consulta de auditoría

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│  CONSULTA DE HISTORIAL DE AUDITORÍA                                              │
│                                                                                  │
│  Client ──► APISIX (JWT auth, scope check) ──► query-audit.action               │
│                │                                                                  │
│                ▼                                                                  │
│    1. Validar JWT (Keycloak)                                                     │
│    2. Extraer rol + scopes del token                                             │
│    3. Determinar nivel de acceso:                                                │
│         a. SRE/superadmin (backup-audit:read:global):                           │
│              → puede consultar cualquier tenant, todos los campos               │
│         b. Tenant owner (backup-audit:read:own):                                │
│              → solo su tenant, campos resumidos (sin IP, user-agent, session)   │
│         c. Sin scope válido → HTTP 403                                          │
│    4. Construir query con filtros aplicados:                                    │
│         tenant_id, event_type, actor_id, desde, hasta, resultado, operation_id  │
│    5. Ejecutar AuditTrailRepository.query(filters, pagination)                  │
│    6. Serializar: omitir campos sensibles si rol es tenant_owner                │
│    7. Responder HTTP 200 { events: [...], pagination: { ... } }                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### Componentes y responsabilidades

| Componente | Responsabilidad |
|---|---|
| `audit-trail.ts` | Módulo central: construye el `AuditEvent`, persiste en PostgreSQL y publica en Kafka. Nunca bloquea al invocador. |
| `audit-trail.types.ts` | Tipos TypeScript: `AuditEventType`, `AuditEvent`, `SessionContext`, `AuditQueryFilters`, `AuditEventPage` |
| `audit-trail.repository.ts` | DAL sobre `backup_audit_events`: `insert`, `markPublished`, `findPendingPublish`, `query` |
| `audit-trail.fallback.ts` | Bucle de reintento: consulta eventos con `published_at IS NULL` y los republica en Kafka con backoff exponencial. Genera alerta operacional si los reintentos se agotan. |
| `query-audit.action` | Handler REST `GET /v1/backup/audit`: aplica RBAC, construye filtros, pagina resultados, serializa respuesta diferenciada por rol |
| `trigger-backup.action` (modificado) | Extrae `SessionContext` del request HTTP y lo pasa a `emitAuditEvent` al aceptar o rechazar |
| `trigger-restore.action` (modificado) | Idem para solicitudes de restore |
| `operation-dispatcher.ts` (modificado) | Llama a `emitAuditEvent` en cada transición de estado con el `operation_id` |

---

## Modelo de datos

### Migración 003: tabla `backup_audit_events`

```sql
-- services/backup-status/src/db/migrations/003_backup_audit_events.sql

CREATE TYPE backup_audit_event_type AS ENUM (
  'backup.requested',
  'backup.started',
  'backup.completed',
  'backup.failed',
  'backup.rejected',
  'restore.requested',
  'restore.started',
  'restore.completed',
  'restore.failed',
  'restore.rejected'
);

CREATE TABLE backup_audit_events (
  -- Identificación del evento
  id                    UUID                      PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_version        TEXT                      NOT NULL DEFAULT '1',
  event_type            backup_audit_event_type   NOT NULL,

  -- Correlación con la operación de T02
  operation_id          UUID,                     -- NULL si la solicitud fue rechazada antes de crear operación
  correlation_id        UUID                      NOT NULL DEFAULT gen_random_uuid(),
  -- Para eventos rejected sin operation_id, correlation_id es el identificador del intento

  -- Contexto del recurso afectado
  tenant_id             TEXT                      NOT NULL,
  component_type        TEXT                      NOT NULL,
  instance_id           TEXT                      NOT NULL,
  snapshot_id           TEXT,                     -- solo para eventos de restore

  -- Identidad del actor
  actor_id              TEXT                      NOT NULL,  -- sub del JWT
  actor_role            TEXT                      NOT NULL,  -- rol Keycloak en el momento del evento

  -- Contexto de sesión (disponible en eventos emitidos desde endpoints HTTP)
  session_id            TEXT,
  source_ip             TEXT,
  user_agent            TEXT,
  session_context_status TEXT NOT NULL DEFAULT 'full',
  -- Valores: 'full' | 'partial' | 'not_applicable'
  -- 'not_applicable' cuando la solicitud viene de un servicio automatizado sin sesión HTTP

  -- Resultado / motivo
  result                TEXT,
  -- 'accepted', 'rejected', 'started', 'completed', 'failed'
  rejection_reason      TEXT,
  -- código semántico del motivo del rechazo/fallo (solo visible SRE/superadmin)
  rejection_reason_public TEXT,
  -- mensaje genérico para tenant owner

  -- Metadatos del evento
  detail                TEXT,
  -- detalle textual opcional; truncado si excede MAX_DETAIL_BYTES (4096)
  detail_truncated      BOOLEAN                   NOT NULL DEFAULT FALSE,
  destructive           BOOLEAN                   NOT NULL DEFAULT FALSE,
  -- TRUE para eventos de tipo restore.*

  -- Timestamps
  occurred_at           TIMESTAMPTZ               NOT NULL DEFAULT NOW(),
  -- timestamp UTC del momento en que ocurrió el evento

  -- Estado de publicación en pipeline (fallback)
  published_at          TIMESTAMPTZ,
  -- NULL mientras no se haya confirmado la publicación en Kafka
  publish_attempts      INTEGER                   NOT NULL DEFAULT 0,
  publish_last_error    TEXT
);

-- Índice principal: historial de auditoría de un tenant ordenado cronológicamente
CREATE INDEX idx_audit_tenant_time
  ON backup_audit_events(tenant_id, occurred_at DESC);

-- Índice para correlación con operaciones de T02
CREATE INDEX idx_audit_operation
  ON backup_audit_events(operation_id)
  WHERE operation_id IS NOT NULL;

-- Índice para el fallback: eventos pendientes de publicación en Kafka
CREATE INDEX idx_audit_pending_publish
  ON backup_audit_events(publish_attempts, occurred_at)
  WHERE published_at IS NULL;

-- Índice para consultas por actor (auditoría de actividad de un usuario)
CREATE INDEX idx_audit_actor
  ON backup_audit_events(actor_id, occurred_at DESC);

-- Índice para consultas por tipo de evento
CREATE INDEX idx_audit_event_type
  ON backup_audit_events(event_type, occurred_at DESC);
```

> **Nota de rollback**: La migración solo añade una nueva tabla y un tipo ENUM. No modifica estructuras existentes.
> Rollback:
> ```sql
> DROP TABLE backup_audit_events;
> DROP TYPE backup_audit_event_type;
> ```

### Ciclo de vida de un evento de auditoría

```text
[Punto de emisión]
      │
      ▼
  INSERT INTO backup_audit_events
  (published_at = NULL, publish_attempts = 0)
      │
      ├── Kafka OK  → UPDATE SET published_at = NOW()
      │
      └── Kafka FAIL → published_at sigue NULL
                          │
                          └── audit-trail.fallback.ts (cron cada 60s)
                                │
                                ├── Intento 1 → espera 60s
                                ├── Intento 2 → espera 120s
                                ├── Intento 3 → espera 240s
                                ├── ...
                                └── Intento N (MAX_PUBLISH_ATTEMPTS) →
                                      emitir alerta operacional
                                      (platform.audit.alerts topic)
```

---

## Esquema del evento de auditoría (JSON v1)

### Evento completo (SRE/superadmin)

```json
{
  "schema_version": "1",
  "id": "e7a3f291-0ab4-4c1e-b923-1d2e5f6a7b8c",
  "event_type": "restore.requested",
  "correlation_id": "d1e2f3a4-...",
  "operation_id": "b3a7f2e1-...",
  "tenant_id": "tenant-abc",
  "component_type": "postgresql",
  "instance_id": "pg-cluster-12",
  "snapshot_id": "snap-20260401-180000",
  "actor_id": "user-sre-01",
  "actor_role": "sre",
  "session_id": "sess-xyz-789",
  "source_ip": "192.168.1.100",
  "user_agent": "Mozilla/5.0 (Macintosh; ...) Chrome/120.0.0.0",
  "session_context_status": "full",
  "result": "accepted",
  "rejection_reason": null,
  "rejection_reason_public": null,
  "detail": null,
  "detail_truncated": false,
  "destructive": true,
  "occurred_at": "2026-04-01T10:00:00.000Z"
}
```

### Evento de rechazo con motivo

```json
{
  "schema_version": "1",
  "id": "f9b1c2d3-...",
  "event_type": "restore.rejected",
  "correlation_id": "a0b1c2d3-...",
  "operation_id": null,
  "tenant_id": "tenant-abc",
  "component_type": "postgresql",
  "instance_id": "pg-cluster-12",
  "snapshot_id": null,
  "actor_id": "user-tenant-owner-01",
  "actor_role": "tenant_owner",
  "session_id": "sess-abc-123",
  "source_ip": "10.0.0.5",
  "user_agent": "okhttp/4.12.0",
  "session_context_status": "full",
  "result": "rejected",
  "rejection_reason": "insufficient_permissions",
  "rejection_reason_public": "No tiene permisos para realizar esta acción.",
  "detail": null,
  "detail_truncated": false,
  "destructive": false,
  "occurred_at": "2026-04-01T10:01:00.000Z"
}
```

### Evento resumido para tenant owner (campos omitidos)

El serializer para tenant owner omite: `session_id`, `source_ip`, `user_agent`, `session_context_status`, `rejection_reason` (técnico), `detail`. Solo incluye `rejection_reason_public` en lugar del campo técnico.

```json
{
  "schema_version": "1",
  "id": "e7a3f291-...",
  "event_type": "restore.requested",
  "correlation_id": "d1e2f3a4-...",
  "operation_id": "b3a7f2e1-...",
  "tenant_id": "tenant-abc",
  "component_type": "postgresql",
  "result": "accepted",
  "rejection_reason_public": null,
  "destructive": true,
  "occurred_at": "2026-04-01T10:00:00.000Z"
}
```

---

## Tipos TypeScript (`audit/audit-trail.types.ts`)

```typescript
// services/backup-status/src/audit/audit-trail.types.ts

export type AuditEventType =
  | 'backup.requested'
  | 'backup.started'
  | 'backup.completed'
  | 'backup.failed'
  | 'backup.rejected'
  | 'restore.requested'
  | 'restore.started'
  | 'restore.completed'
  | 'restore.failed'
  | 'restore.rejected'

export type SessionContextStatus = 'full' | 'partial' | 'not_applicable'

export interface SessionContext {
  sessionId?: string | null
  sourceIp?: string | null
  userAgent?: string | null
  status: SessionContextStatus
}

export interface AuditEventInput {
  eventType: AuditEventType
  operationId?: string | null    // UUID de la operación de T02; null para rejected sin operación
  correlationId?: string         // auto-generado si no se proporciona
  tenantId: string
  componentType: string
  instanceId: string
  snapshotId?: string | null
  actorId: string
  actorRole: string
  sessionContext: SessionContext
  result: string                 // 'accepted' | 'rejected' | 'started' | 'completed' | 'failed'
  rejectionReason?: string | null          // código técnico
  rejectionReasonPublic?: string | null    // mensaje genérico
  detail?: string | null
  destructive?: boolean
}

export interface AuditEvent extends AuditEventInput {
  id: string
  schemaVersion: '1'
  occurredAt: Date
  detailTruncated: boolean
  publishedAt?: Date | null
  publishAttempts: number
}

export interface AuditQueryFilters {
  tenantId?: string
  eventType?: AuditEventType | AuditEventType[]
  actorId?: string
  operationId?: string
  result?: string
  from?: Date
  to?: Date
  limit?: number    // default: 50, max: 200
  cursor?: string   // cursor opaco de paginación
}

export interface AuditEventPage {
  schemaVersion: '1'
  events: AuditEventPublic[] | AuditEventAdmin[]
  pagination: {
    limit: number
    nextCursor: string | null
    total?: number   // solo si la query incluye count (opt-in por parámetro)
  }
}

// Vista completa para SRE/superadmin
export interface AuditEventAdmin {
  schema_version: '1'
  id: string
  event_type: AuditEventType
  correlation_id: string
  operation_id: string | null
  tenant_id: string
  component_type: string
  instance_id: string
  snapshot_id: string | null
  actor_id: string
  actor_role: string
  session_id: string | null
  source_ip: string | null
  user_agent: string | null
  session_context_status: SessionContextStatus
  result: string
  rejection_reason: string | null
  rejection_reason_public: string | null
  detail: string | null
  detail_truncated: boolean
  destructive: boolean
  occurred_at: string  // ISO 8601 UTC
}

// Vista resumida para tenant owner
export interface AuditEventPublic {
  schema_version: '1'
  id: string
  event_type: AuditEventType
  correlation_id: string
  operation_id: string | null
  tenant_id: string
  component_type: string
  result: string
  rejection_reason_public: string | null
  destructive: boolean
  occurred_at: string  // ISO 8601 UTC
}
```

---

## Módulo central: `audit-trail.ts`

```typescript
// services/backup-status/src/audit/audit-trail.ts

import { v4 as uuidv4 } from 'uuid'
import type { AuditEventInput, AuditEvent } from './audit-trail.types.js'
import { AuditTrailRepository } from './audit-trail.repository.js'
import { scheduleRetry } from './audit-trail.fallback.js'

const KAFKA_TOPIC = process.env.AUDIT_KAFKA_TOPIC ?? 'platform.backup.audit.events'
const MAX_DETAIL_BYTES = 4096

/**
 * Emite un evento de auditoría de backup/restore.
 *
 * El evento se persiste en PostgreSQL de forma síncrona (garantía de no-pérdida)
 * y se publica en Kafka de forma asíncrona (fire-and-forget con fallback).
 *
 * Esta función NO lanza excepción al invocador aunque falle internamente.
 * Los errores se registran en el log estructurado y el evento queda pendiente
 * de publicación en el fallback loop.
 */
export async function emitAuditEvent(input: AuditEventInput): Promise<void> {
  try {
    const event = buildEvent(input)
    await AuditTrailRepository.insert(event)
    publishToKafka(event).catch(() => {
      // El fallback loop detectará el evento por published_at IS NULL
    })
  } catch (err) {
    // El fallo de auditoría nunca bloquea la operación de negocio.
    console.error('[audit-trail] emitAuditEvent failed:', err)
  }
}

function buildEvent(input: AuditEventInput): AuditEvent {
  const rawDetail = input.detail ?? null
  const truncated = rawDetail !== null && Buffer.byteLength(rawDetail, 'utf8') > MAX_DETAIL_BYTES
  return {
    ...input,
    id: uuidv4(),
    schemaVersion: '1',
    correlationId: input.correlationId ?? uuidv4(),
    destructive: input.destructive ?? false,
    occurredAt: new Date(),
    detail: truncated ? rawDetail.slice(0, MAX_DETAIL_BYTES) : rawDetail,
    detailTruncated: truncated,
    publishedAt: null,
    publishAttempts: 0,
  }
}

async function publishToKafka(event: AuditEvent): Promise<void> {
  // En producción: usar el cliente Kafka del monorepo.
  // En desarrollo sin Kafka: KAFKA_BROKERS vacío → log local.
  if (!process.env.KAFKA_BROKERS) {
    console.log('[audit-trail] kafka unavailable, event persisted locally:', event.id)
    return
  }
  // Produce al topic y marca como publicado en DB.
  // Si falla: el fallback loop reintentará.
  await produceKafkaMessage(KAFKA_TOPIC, event)
  await AuditTrailRepository.markPublished(event.id)
}
```

---

## Módulo de fallback y reintento (`audit-trail.fallback.ts`)

```typescript
// services/backup-status/src/audit/audit-trail.fallback.ts

const MAX_PUBLISH_ATTEMPTS = 5
const BASE_BACKOFF_MS = 60_000    // 60 segundos
const ALERT_TOPIC = 'platform.audit.alerts'

/**
 * Ejecutado periódicamente (p. ej., cada 60s vía alarm de OpenWhisk).
 * Consulta eventos de auditoría pendientes de publicación y los reintenta
 * con backoff exponencial.
 */
export async function retryPendingAuditEvents(): Promise<void> {
  const pending = await AuditTrailRepository.findPendingPublish(MAX_PUBLISH_ATTEMPTS)
  for (const event of pending) {
    try {
      await publishToKafka(event)
      await AuditTrailRepository.markPublished(event.id)
    } catch (err) {
      const newAttempts = event.publishAttempts + 1
      await AuditTrailRepository.incrementPublishAttempt(event.id, String(err))
      if (newAttempts >= MAX_PUBLISH_ATTEMPTS) {
        await emitOperationalAlert(event)
      }
    }
  }
}

async function emitOperationalAlert(event: AuditEvent): Promise<void> {
  console.error('[audit-trail] max publish attempts reached for event:', event.id)
  try {
    await produceKafkaMessage(ALERT_TOPIC, {
      type: 'audit_event_publish_failed',
      event_id: event.id,
      tenant_id: event.tenantId,
      event_type: event.eventType,
      occurred_at: event.occurredAt.toISOString(),
      attempts: event.publishAttempts,
    })
  } catch {
    // La alerta en sí no debe propagarse como excepción.
    console.error('[audit-trail] failed to emit operational alert for event:', event.id)
  }
}
```

### Backoff exponencial

| Intento | Espera antes del siguiente reintento |
|---|---|
| 1 | 60 s |
| 2 | 120 s |
| 3 | 240 s |
| 4 | 480 s |
| 5 (MAX) | — Se emite alerta operacional |

La alarm de OpenWhisk para el fallback se configura con un intervalo de **60 segundos** y es independiente del flujo de operaciones de backup/restore.

---

## Modificaciones en módulos existentes de T02

### `trigger-backup.action.ts` — Extracción de `SessionContext` y hooks de auditoría

```typescript
// Añadir al inicio del handler, tras validar el JWT:

import { emitAuditEvent } from '../audit/audit-trail.js'
import type { SessionContext } from '../audit/audit-trail.types.js'

function extractSessionContext(req: OpenWhiskRequest): SessionContext {
  const headers = req.headers ?? {}
  const sessionId = headers['x-session-id'] ?? null
  const sourceIp = headers['x-forwarded-for']?.split(',')[0]?.trim()
              ?? headers['x-real-ip']
              ?? null
  const userAgent = headers['user-agent'] ?? null
  const status =
    sessionId || sourceIp ? 'full'
    : 'not_applicable'
  return { sessionId, sourceIp, userAgent, status }
}

// Al rechazar la solicitud (403, 422, 409) — ANTES de retornar la respuesta HTTP:
await emitAuditEvent({
  eventType: 'backup.rejected',
  operationId: null,
  tenantId: body.tenant_id,
  componentType: body.component_type,
  instanceId: body.instance_id,
  actorId: token.sub,
  actorRole: primaryRole,
  sessionContext: extractSessionContext(req),
  result: 'rejected',
  rejectionReason: rejectionCode,         // p. ej., 'insufficient_permissions'
  rejectionReasonPublic: publicMessage,
  destructive: false,
})

// Al aceptar la solicitud (tras crear el registro en backup_operations):
await emitAuditEvent({
  eventType: 'backup.requested',
  operationId: operation.id,
  tenantId: body.tenant_id,
  componentType: body.component_type,
  instanceId: body.instance_id,
  actorId: token.sub,
  actorRole: primaryRole,
  sessionContext: extractSessionContext(req),
  result: 'accepted',
  destructive: false,
})
```

### `trigger-restore.action.ts` — Ídem con `destructive: true`

Mismo patrón que trigger-backup, pero:
- `eventType: 'restore.rejected'` / `'restore.requested'`
- `destructive: true` en todos los eventos de restore
- `snapshotId: body.snapshot_id` incluido en eventos de restore

### `operation-dispatcher.ts` — Emisión en transiciones de estado

```typescript
// Añadir hooks en cada transición de estado:

// Transición accepted → in_progress:
await emitAuditEvent({
  eventType: `${operationType}.started` as AuditEventType,
  operationId: operation.id,
  tenantId: operation.tenantId,
  componentType: operation.componentType,
  instanceId: operation.instanceId,
  snapshotId: operation.snapshotId,
  actorId: operation.requesterId,
  actorRole: operation.requesterRole,
  sessionContext: { status: 'not_applicable' },  // dispatcher asíncrono, sin HTTP context
  result: 'started',
  destructive: operation.type === 'restore',
})

// Transición in_progress → completed:
await emitAuditEvent({
  eventType: `${operationType}.completed` as AuditEventType,
  operationId: operation.id,
  tenantId: operation.tenantId,
  componentType: operation.componentType,
  instanceId: operation.instanceId,
  snapshotId: operation.snapshotId,
  actorId: operation.requesterId,
  actorRole: operation.requesterRole,
  sessionContext: { status: 'not_applicable' },
  result: 'completed',
  destructive: operation.type === 'restore',
})

// Transición in_progress → failed:
await emitAuditEvent({
  eventType: `${operationType}.failed` as AuditEventType,
  operationId: operation.id,
  tenantId: operation.tenantId,
  componentType: operation.componentType,
  instanceId: operation.instanceId,
  snapshotId: operation.snapshotId,
  actorId: operation.requesterId,
  actorRole: operation.requesterRole,
  sessionContext: { status: 'not_applicable' },
  result: 'failed',
  rejectionReason: error.message,
  rejectionReasonPublic: 'La operación no pudo completarse. Contacte al administrador.',
  destructive: operation.type === 'restore',
})
```

---

## API endpoint de consulta de auditoría

### GET /v1/backup/audit

**Scope requerido**: `backup-audit:read:global` (SRE/superadmin) o `backup-audit:read:own` (tenant owner, solo su tenant con campos resumidos)

**Query params**:

| Parámetro | Tipo | Descripción |
|---|---|---|
| `tenant_id` | string | Requerido para tenant owner; opcional para admin (sin valor = todos los tenants) |
| `event_type` | string (enum, multi) | Filtrar por tipo de evento; acepta múltiples separados por coma |
| `actor_id` | string | Filtrar por actor (sub del JWT) |
| `operation_id` | UUID | Filtrar por operación específica |
| `result` | string | `accepted`, `rejected`, `started`, `completed`, `failed` |
| `from` | ISO 8601 | Inicio del rango temporal (UTC) |
| `to` | ISO 8601 | Fin del rango temporal (UTC) |
| `limit` | integer | Número de resultados (default: 50, máx: 200) |
| `cursor` | string | Cursor de paginación opaco |

**Flujo de validación**:
1. Validar JWT.
2. Si no tiene scope `backup-audit:read:global` ni `backup-audit:read:own` → `HTTP 403`.
3. Si tiene solo `backup-audit:read:own`:
   - Si `tenant_id` no se proporciona o no coincide con `token.tenant_id` → `HTTP 403`.
4. Aplicar límite máximo de rango temporal: si `to - from > MAX_AUDIT_RANGE_DAYS` → `HTTP 422` con `range_too_wide`.
5. Construir filtros y paginar.
6. Serializar usando `AuditEventAdmin` (admin) o `AuditEventPublic` (tenant owner).
7. Responder `HTTP 200 { events, pagination }`.

**Respuesta (admin)**:

```json
{
  "schema_version": "1",
  "events": [
    {
      "schema_version": "1",
      "id": "e7a3f291-...",
      "event_type": "restore.requested",
      "correlation_id": "d1e2f3a4-...",
      "operation_id": "b3a7f2e1-...",
      "tenant_id": "tenant-abc",
      "component_type": "postgresql",
      "instance_id": "pg-cluster-12",
      "snapshot_id": "snap-20260401-180000",
      "actor_id": "user-sre-01",
      "actor_role": "sre",
      "session_id": "sess-xyz-789",
      "source_ip": "192.168.1.100",
      "user_agent": "Mozilla/5.0 ...",
      "session_context_status": "full",
      "result": "accepted",
      "rejection_reason": null,
      "rejection_reason_public": null,
      "detail": null,
      "detail_truncated": false,
      "destructive": true,
      "occurred_at": "2026-04-01T10:00:00.000Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "next_cursor": "eyJvY2N1cnJlZF9hdCI6IjIwMjYtMDQtMDFUMTA...",
    "total": null
  }
}
```

**Restricciones de la API (no mutación)**:

- No se exponen `PUT`, `PATCH`, `DELETE` ni `POST` sobre eventos.
- Un intento de `PUT /v1/backup/audit/:id` devuelve `HTTP 405 Method Not Allowed`.

---

## Permisos y RBAC

### Nuevos scopes de Keycloak

| Scope | Descripción |
|---|---|
| `backup-audit:read:global` | Consultar historial de auditoría completo (todos los tenants, todos los campos). Asignado a SRE y superadmin. |
| `backup-audit:read:own` | Consultar historial de auditoría del propio tenant con vista resumida. Asignado a tenant_owner. |

### Mapping rol → scopes (actualizado para T03)

| Rol Keycloak | Scopes de T01/T02 (existentes) | Nuevos scopes de T03 |
|---|---|---|
| `tenant_owner` | `backup-status:read:own`, `backup:write:own` | `backup-audit:read:own` |
| `workspace_admin` | `backup-status:read:own` | — |
| `sre` | `backup-status:read:own`, `backup-status:read:global`, `backup-status:read:technical`, `backup:write:global`, `backup:restore:global` | `backup-audit:read:global` |
| `superadmin` | (idem SRE) | `backup-audit:read:global` |

### Enforcement en APISIX

```yaml
# GET /v1/backup/audit
required_scopes: ["backup-audit:read:own"]   # mínimo; el handler distingue own vs global
```

---

## Ruta APISIX

```yaml
# services/gateway-config/routes/backup-audit-routes.yaml

- id: backup-audit-get
  uri: /v1/backup/audit
  methods: [GET]
  upstream_id: openwhisk-query-audit
  plugins:
    openid-connect:
      discovery: "${KEYCLOAK_DISCOVERY_URL}"
      required_scopes: ["backup-audit:read:own"]
    limit-req:
      rate: 20
      burst: 40
      key: consumer_name
    response-rewrite:
      headers:
        Cache-Control: "no-store, no-cache"
        X-Content-Type-Options: "nosniff"
```

---

## Configuración Helm (valores nuevos)

```yaml
# helm/charts/backup-status/values.yaml — sección añadida

audit:
  enabled: true
  kafka_topic: "platform.backup.audit.events"
  alert_topic: "platform.audit.alerts"
  fallback:
    retry_interval_seconds: 60
    max_attempts: 5
    base_backoff_ms: 60000
  query:
    max_range_days: 90          # rango máximo de consulta para evitar queries destructivas
    default_limit: 50
    max_limit: 200
  detail:
    max_bytes: 4096             # tamaño máximo del campo detail; se trunca si excede
```

---

## Vistas de consola

### Vista de auditoría administrativa (`BackupAuditPage`)

Accesible desde: `/admin/tenants/{tenantId}/backup/audit` (superadmin/SRE) y `/admin/backup/audit` (vista global sin filtro de tenant).

**Secciones**:

1. **`AuditEventFilters`**: formulario de filtros con campos:
   - Selector de tenant (modo global) o etiqueta fija del tenant (modo tenant específico)
   - Selector de tipo de evento (multi-select con `AuditEventTypeBadge`)
   - Campo de actor ID (búsqueda libre)
   - Rango temporal (date-picker desde/hasta)
   - Selector de resultado
2. **`AuditEventTable`** (columnas para admin): timestamp, tipo de evento (`AuditEventTypeBadge`), actor, tenant, componente, resultado, IP de origen.
3. **`AuditEventDetail`** (panel expandible por fila): muestra todos los campos del evento incluyendo `session_id`, `user_agent`, `source_ip`, `rejection_reason` técnico, y enlace a la operación en `GET /v1/backup/operations/:id` si `operation_id` no es null.
4. **Paginación**: cursor-based, 50 eventos por página.

### Vista de auditoría del tenant owner (`BackupAuditSummaryPage`)

Accesible desde: `/backup/audit` en la consola del tenant.

**Secciones**:

1. Filtros simplificados: rango temporal, tipo de acción (backup/restore), resultado.
2. Tabla resumida con columnas: fecha, tipo de acción, resultado, mensaje (de `rejection_reason_public` si aplica).
3. **Sin columnas de**: IP, user-agent, session ID, nombre técnico del componente, `rejection_reason` técnico.

### Componentes compartidos

| Componente | Descripción |
|---|---|
| `AuditEventTypeBadge` | Badge con color semántico: `requested`/`started` (azul), `completed` (verde), `rejected`/`failed` (rojo/naranja) |
| `AuditEventTable` | Tabla con columnas configurables por rol; columnas sensibles se incluyen solo si el rol es admin |
| `AuditEventDetail` | Panel expandible, renderiza todos los campos disponibles para el rol del actor; enlaza a la operación si `operation_id` existe |
| `AuditEventFilters` | Formulario controlado con debounce para filtros de texto; date-picker para rango temporal; multi-select para tipo de evento |
| `useAuditEvents` | Hook de React Query que llama a `GET /v1/backup/audit` con los filtros activos; gestiona paginación por cursor |

---

## Estrategia de tests

### Pirámide de testing

| Capa | Framework | Foco | Ficheros |
|---|---|---|---|
| **Unit** | Vitest (TS) | Módulo audit-trail, repository, fallback, handler query-audit, serialización diferenciada por rol | `test/unit/audit/**/*.test.ts` |
| **Integration** | `node:test` nativo | E2E: emitir evento de backup/restore → consultar por API → verificar campos y filtros | `test/integration/backup-audit-api.test.mjs` |
| **Contract** | Vitest + JSON Schema | Payload del evento cumple el schema v1; campos omitidos para tenant owner; `schema_version` presente | `test/contract/audit-event.contract.ts` |
| **Component (React)** | Vitest + React Testing Library | `AuditEventTable` renderiza columnas según rol; `BackupAuditSummaryPage` omite campos sensibles | `apps/console/src/components/backup/*.test.tsx` |
| **E2E** | Playwright (opcional) | Flujo completo: iniciar backup → ver evento en BackupAuditPage → verificar detalle | `apps/console/e2e/backup-audit.spec.ts` |

### Cobertura por criterio de aceptación del spec

| CA | Descripción | Test |
|---|---|---|
| CA-01 | Evento `backup.requested` al aceptar backup bajo demanda | Integration: POST /trigger → consultar /audit → evento presente con campos correctos |
| CA-02 | Evento `restore.requested` al aceptar restore | Integration: POST /restore → consultar /audit → evento con `snapshot_id` y `destructive: true` |
| CA-03 | Tres eventos de auditoría para ciclo de vida completo | Integration: crear operación → dispatchar → consultar /audit?operation_id=... → 3 eventos |
| CA-04 | Evento `restore.rejected` con `insufficient_permissions` | Integration: token tenant_owner → POST /restore → 403 → /audit muestra evento rejected |
| CA-05 | Fallback ante fallo de Kafka | Unit: mock Kafka.produce lanza error → evento persiste en DB → published_at IS NULL → fallback reintenta |
| CA-06 | Consulta con filtros y paginación | Integration: insertar 100 eventos → GET /audit?limit=10&from=...&to=... → 10 eventos, cursor presente |
| CA-07 | Aislamiento multi-tenant para tenant owner | Integration: token tenant-A → GET /audit?tenant_id=tenant-B → 403 |
| CA-08 | Vista global solo para roles privilegiados | Integration: token tenant_owner → GET /audit sin tenant_id → 403 |
| CA-09 | Consola admin muestra historial con campos de sesión | Component: render BackupAuditPage con admin token → columna "IP origen" visible |
| CA-10 | Consola tenant muestra historial resumido | Component: render BackupAuditSummaryPage con tenant_owner token → sin columna IP, user-agent |
| CA-11 | Eventos inmutables — API no expone mutación | Integration: PUT /v1/backup/audit/:id → 405; DELETE → 405 |
| CA-12 | Esquema versionado (`schema_version` presente) | Contract: inspeccionar payload → campo `schema_version: "1"` presente |
| CA-13 | Correlación por `operation_id` | Integration: GET /audit?operation_id=... → todos los eventos del ciclo de vida de esa operación |

### Casos unitarios clave

```typescript
// test/unit/audit/audit-trail.test.ts

describe('emitAuditEvent()', () => {
  it('persists event in DB with published_at = null before Kafka publish', async () => { ... })
  it('marks event as published after successful Kafka produce', async () => { ... })
  it('does NOT throw when Kafka produce fails', async () => { ... })
  it('truncates detail field when it exceeds MAX_DETAIL_BYTES', async () => { ... })
  it('sets detail_truncated = true when detail is truncated', async () => { ... })
  it('sets session_context_status = not_applicable when no HTTP context', async () => { ... })
  it('sets session_context_status = partial when only IP is available', async () => { ... })
})

// test/unit/audit/audit-trail.fallback.test.ts

describe('retryPendingAuditEvents()', () => {
  it('retries events with published_at = null', async () => { ... })
  it('applies exponential backoff between attempts', async () => { ... })
  it('emits operational alert after MAX_PUBLISH_ATTEMPTS', async () => { ... })
  it('does NOT retry events that have already reached MAX_PUBLISH_ATTEMPTS', async () => { ... })
})

// test/unit/audit/query-audit.action.test.ts

describe('query-audit.action', () => {
  it('returns HTTP 403 when token lacks backup-audit scopes', async () => { ... })
  it('returns HTTP 403 when tenant_owner queries another tenant', async () => { ... })
  it('returns HTTP 403 when tenant_owner omits tenant_id (global query)', async () => { ... })
  it('omits session_id, source_ip, user_agent for tenant_owner role', async () => { ... })
  it('includes all fields for SRE role', async () => { ... })
  it('returns HTTP 422 when date range exceeds MAX_AUDIT_RANGE_DAYS', async () => { ... })
  it('paginates results using cursor', async () => { ... })
  it('filters by operation_id correctly', async () => { ... })
  it('filters by event_type list (comma-separated)', async () => { ... })
})
```

---

## Dependencias entre módulos de esta tarea

```text
T-A (Migración DB: 003_backup_audit_events.sql)
      │
      ▼
T-B (AuditTrailRepository DAL)
      │
      ├──► T-C (audit-trail.types.ts)
      │           │
      │           ▼
      ├──► T-D (audit-trail.ts — módulo central de emisión)
      │           │
      │           ├──► T-E (audit-trail.fallback.ts — reintento exponencial)
      │           │
      │           ├──► T-F (Modificar trigger-backup.action.ts — hooks de auditoría)
      │           ├──► T-G (Modificar trigger-restore.action.ts — hooks de auditoría)
      │           └──► T-H (Modificar operation-dispatcher.ts — hooks de transición)
      │
      └──► T-I (query-audit.action.ts — endpoint REST)
                  │
                  └──► T-J (APISIX route + Keycloak scopes + Helm)
                              │
                              ▼
                         T-K (Frontend: BackupAuditPage, BackupAuditSummaryPage,
                                        AuditEventTable, AuditEventDetail,
                                        AuditEventFilters, AuditEventTypeBadge,
                                        useAuditEvents, backup-audit.api.ts)
                              │
                              ▼
                         T-L (Tests: unit + integration + contract + component + E2E)
```

### Paralelización posible

- **T-D, T-E** pueden desarrollarse en paralelo una vez T-B y T-C están completos.
- **T-F, T-G, T-H** pueden desarrollarse en paralelo con T-D una vez que los tipos (T-C) están definidos.
- **T-I** (endpoint de consulta) puede desarrollarse en paralelo con T-F/T-G/T-H.
- **T-K** (frontend) puede comenzar con mocks del API en cuanto T-C y los schemas de respuesta estén definidos.
- **T-J** (infraestructura) puede comenzar en paralelo con T-D/T-I.

---

## Riesgos y mitigaciones

| ID | Descripción | Probabilidad | Impacto | Mitigación |
|---|---|---|---|---|
| R-01 | El pipeline de US-OBS-01 no está disponible durante períodos de alta carga o mantenimiento | Media | Medio | El evento siempre se persiste en PostgreSQL antes de intentar publicar en Kafka. El fallback loop garantiza eventual consistencia. |
| R-02 | El log de fallback (`backup_audit_events` con `published_at IS NULL`) crece sin límite si Kafka está caído por tiempo prolongado | Baja | Alto | Alerta operacional al alcanzar `MAX_PUBLISH_ATTEMPTS`. El proceso de reconciliación manual puede republica batch desde la tabla. La retención de la tabla es independiente de Kafka. |
| R-03 | El contexto de sesión (IP, user-agent) no está disponible en eventos emitidos desde el dispatcher asíncrono | Alta | Bajo | Los eventos del dispatcher se emiten con `session_context_status: 'not_applicable'`. Esto es esperado y documentado en el spec. Los campos de sesión son opcionales. |
| R-04 | Volumen alto de operaciones automatizadas genera presión en `backup_audit_events` | Media | Medio | Índices optimizados para las queries más frecuentes. La política de retención de la tabla se hereda de la política general de PostgreSQL del sistema (ej. particionado por mes si el volumen lo requiere). |
| R-05 | La consulta con rango temporal amplio (`MAX_AUDIT_RANGE_DAYS = 90`) puede generar queries costosas | Baja | Medio | El endpoint impone `MAX_AUDIT_RANGE_DAYS` configurable. La paginación cursor-based limita el tamaño del resultado. Los índices por `(tenant_id, occurred_at DESC)` soportan el patrón de consulta más frecuente. |
| R-06 | Un actor manipula el header `X-Forwarded-For` para falsear la IP de origen | Media | Bajo | La plataforma debe configurar APISIX para sobrescribir (no confiar ciegamente en) el header `X-Forwarded-For`. La IP registrada es la que APISIX determina, no la que el cliente declara. Esto es configuración de infraestructura, no de esta tarea. Se documenta como supuesto. |

---

## Compatibilidad, rollback e idempotencia

### Rollback completo

```text
1. Eliminar ruta APISIX: backup-audit-get
2. Revertir scopes Keycloak: backup-audit:read:global, backup-audit:read:own
3. Revertir modificaciones en trigger-backup.action.ts, trigger-restore.action.ts, operation-dispatcher.ts
   (eliminar las llamadas a emitAuditEvent)
4. Revertir migración DB:
   DROP TABLE backup_audit_events;
   DROP TYPE backup_audit_event_type;
5. Desplegar versión anterior del chart Helm (sin audit-trail.ts, query-audit.action)
6. Las acciones de T01/T02 siguen funcionando sin cambios
```

### Compatibilidad hacia atrás

- Las tablas `backup_status_snapshots` y `backup_operations` (T01/T02) **no se modifican**.
- El módulo `shared/audit.ts` (T01: `logAccessEvent`, `logCollectionCycle`) **no se modifica**. Los nuevos eventos de auditoría usan el módulo `audit/audit-trail.ts`.
- Los endpoints de T01 y T02 no cambian su contrato de respuesta; solo se añaden llamadas a `emitAuditEvent` como efectos secundarios.
- El topic Kafka `platform.backup.operation.events` (T02) sigue activo y sin cambios. El nuevo topic `platform.backup.audit.events` es adicional.

### Idempotencia

- Cada llamada a `emitAuditEvent` genera un evento con un `id` UUID único. No hay duplicación por reintento del invocador, ya que los hooks se invocan exactamente una vez por punto de emisión.
- El fallback loop no re-inserta eventos; solo reintenta publicar en Kafka los ya insertados.
- Si el handler de `trigger-backup` falla después de emitir el evento de auditoría pero antes de devolver la respuesta HTTP, puede producirse un evento `backup.requested` sin `operation_id` si la operación no llegó a crearse. En ese caso, el `correlation_id` sirve para identificar el intento.

---

## Observabilidad y seguridad

### Observabilidad

- **Kafka topic** `platform.backup.audit.events`: stream en tiempo real de todos los eventos de auditoría. Consumible por SIEM, herramientas de análisis o pipelines de alertas.
- **Kafka topic** `platform.audit.alerts`: eventos de alerta cuando un evento de auditoría alcanza `MAX_PUBLISH_ATTEMPTS` sin publicarse.
- **Métricas sugeridas** (Prometheus): `backup_audit_events_emitted_total{event_type}`, `backup_audit_events_pending_publish`, `backup_audit_publish_failures_total`, `backup_audit_query_duration_ms`.
- **Log estructurado**: cada emisión y cada reintento emite una línea de log con `event_id`, `event_type`, `tenant_id`, `operation_id`, `publish_attempt`.

### Seguridad

- Los eventos de auditoría **no contienen** credenciales, tokens JWT completos, contraseñas, connection strings ni rutas internas de almacenamiento.
- El campo `session_id` registra el identificador opaco de sesión de Keycloak, no el token JWT en sí.
- El endpoint `GET /v1/backup/audit` es **read-only**: no expone mutación sobre los eventos.
- La tabla `backup_audit_events` debe tener permisos de escritura restringidos al usuario de aplicación del servicio `backup-status`. No debe ser accesible directamente vía conexión de cliente.
- El campo `rejection_reason` (detalle técnico del rechazo) solo se incluye en respuestas de la API cuando el token del solicitante tiene scope `backup-audit:read:global` (SRE/superadmin). El tenant owner solo recibe `rejection_reason_public`.
- Los headers de respuesta del endpoint incluyen `Cache-Control: no-store, no-cache` para evitar que proxies intermedios almacenen respuestas de auditoría.

---

## Criterios de completado con evidencia verificable

| Criterio | Evidencia |
|---|---|
| La migración `003_backup_audit_events.sql` se ejecuta sin errores | `psql` muestra la tabla `backup_audit_events` con todas las columnas, índices y el tipo ENUM `backup_audit_event_type` |
| `POST /v1/backup/trigger` genera un evento `backup.requested` en la DB | Test de integración: POST con token SRE → consultar `backup_audit_events` → fila con `event_type = 'backup.requested'` y `operation_id` correcto |
| `POST /v1/backup/restore` genera un evento `restore.requested` con `destructive = true` | Test de integración: POST /restore → consultar DB → `destructive = true`, `snapshot_id` correcto |
| Solicitud rechazada genera evento `*.rejected` con `rejection_reason` | Test de integración: POST /restore con token tenant_owner → 403 → DB tiene `restore.rejected` con `rejection_reason = 'insufficient_permissions'` |
| El dispatcher emite 3 eventos para un ciclo de vida completo | Test de integración: crear operación + dispatch completo → GET /audit?operation_id=... → 3 eventos ordenados cronológicamente |
| Fallback: evento persiste en DB cuando Kafka falla | Test unitario: mock Kafka lanza error → DB tiene evento con `published_at IS NULL` y `publish_attempts = 0` |
| Fallback: alerta operacional tras MAX_PUBLISH_ATTEMPTS | Test unitario: simular N intentos fallidos → spy en produceKafkaMessage para alert topic → llamada con `type: 'audit_event_publish_failed'` |
| GET /v1/backup/audit filtra por tenant, tipo y rango | Test de integración: insertar eventos mixtos → GET con filtros → solo eventos que cumplen los filtros |
| Tenant owner no ve campos sensibles en la respuesta | Test de contrato: respuesta con token tenant_owner → sin `session_id`, `source_ip`, `user_agent` en ningún evento |
| Tenant owner no puede consultar auditoría de otro tenant | Test de integración: token tenant-A → GET /audit?tenant_id=tenant-B → 403 |
| API no expone mutación sobre eventos | Test de integración: PUT /v1/backup/audit/:id → 405 |
| Esquema `schema_version: "1"` presente en todos los eventos | Test de contrato: inspeccionar payload de respuesta → `schema_version: "1"` en todos los eventos |
| Consola admin muestra columnas sensibles (IP, user-agent) | Test de componente: render con admin token → columnas IP y user-agent visibles en `AuditEventTable` |
| Consola tenant omite columnas sensibles | Test de componente: render `BackupAuditSummaryPage` con tenant_owner token → sin columnas de sesión en el DOM |

---

*Documento generado para el stage `speckit.plan` — US-BKP-01-T03 | Rama: `111-backup-audit-trail`*
