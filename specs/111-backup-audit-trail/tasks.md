# Tasks — US-BKP-01-T03: Auditoría completa de acciones de recuperación

**Branch**: `111-backup-audit-trail` | **Fecha**: 2026-04-01\
**Spec**: `specs/111-backup-audit-trail/spec.md` | **Plan**: `specs/111-backup-audit-trail/plan.md`\
**Dependencias externas**: US-BKP-01-T01 ✅ | US-BKP-01-T02 ✅ | US-OBS-01 ✅

---

## Mapa de rutas de ficheros

> Sección obligatoria para el agente de implementación. Lista completa de ficheros a leer y/o escribir.

### Ficheros a CREAR (nuevos)

| Ruta desde la raíz del repo | Tarea |
|---|---|
| `services/backup-status/src/db/migrations/003_backup_audit_events.sql` | T-01 |
| `services/backup-status/src/audit/audit-trail.types.ts` | T-02 |
| `services/backup-status/src/audit/audit-trail.repository.ts` | T-03 |
| `services/backup-status/src/audit/audit-trail.ts` | T-04 |
| `services/backup-status/src/audit/audit-trail.fallback.ts` | T-05 |
| `services/backup-status/src/operations/query-audit.action.ts` | T-09 |
| `services/gateway-config/routes/backup-audit-routes.yaml` | T-10 |
| `services/keycloak-config/scopes/backup-audit-scopes.yaml` | T-10 |
| `helm/charts/backup-status/templates/openwhisk-audit-actions.yaml` | T-10 |
| `apps/console/src/pages/admin/BackupAuditPage.tsx` | T-11 |
| `apps/console/src/pages/tenant/BackupAuditSummaryPage.tsx` | T-11 |
| `apps/console/src/components/backup/AuditEventTable.tsx` | T-11 |
| `apps/console/src/components/backup/AuditEventDetail.tsx` | T-11 |
| `apps/console/src/components/backup/AuditEventFilters.tsx` | T-11 |
| `apps/console/src/components/backup/AuditEventTypeBadge.tsx` | T-11 |
| `apps/console/src/hooks/useAuditEvents.ts` | T-11 |
| `apps/console/src/lib/api/backup-audit.api.ts` | T-11 |
| `services/backup-status/test/unit/audit/audit-trail.test.ts` | T-12 |
| `services/backup-status/test/unit/audit/audit-trail.repository.test.ts` | T-12 |
| `services/backup-status/test/unit/audit/audit-trail.fallback.test.ts` | T-12 |
| `services/backup-status/test/unit/audit/query-audit.action.test.ts` | T-12 |
| `services/backup-status/test/integration/backup-audit-api.test.mjs` | T-12 |
| `services/backup-status/test/contract/audit-event.contract.ts` | T-12 |

### Ficheros a MODIFICAR (existentes)

| Ruta desde la raíz del repo | Tarea | Cambio |
|---|---|---|
| `services/backup-status/src/operations/trigger-backup.action.ts` | T-06 | Añadir extracción de `SessionContext` y hooks de auditoría |
| `services/backup-status/src/operations/trigger-restore.action.ts` | T-07 | Añadir extracción de `SessionContext` y hooks de auditoría |
| `services/backup-status/src/operations/operation-dispatcher.ts` | T-08 | Añadir hooks de auditoría en cada transición de estado |
| `helm/charts/backup-status/values.yaml` | T-10 | Añadir sección `audit:` con la configuración del módulo |

### Ficheros a LEER (contexto de implementación, no modificar)

| Ruta desde la raíz del repo | Para qué |
|---|---|
| `services/backup-status/src/shared/audit.ts` | Referencia de patrón existente (T01); NO modificar |
| `services/backup-status/src/operations/trigger-backup.action.ts` | Leer estructura actual antes de T-06 |
| `services/backup-status/src/operations/trigger-restore.action.ts` | Leer estructura actual antes de T-07 |
| `services/backup-status/src/operations/operation-dispatcher.ts` | Leer estructura actual antes de T-08 |
| `services/backup-status/src/db/migrations/001_*.sql` | Referencia de estilo de migración |
| `services/backup-status/src/db/migrations/002_*.sql` | Referencia de estilo de migración |
| `apps/control-plane/openapi/families/backup.yaml` | Referencia de contratos API existentes |
| `services/gateway-config/routes/backup-routes.yaml` | Referencia de estilo de ruta APISIX |
| `services/keycloak-config/scopes/backup-scopes.yaml` | Referencia de estilo de scopes Keycloak |
| `helm/charts/backup-status/values.yaml` | Leer estructura actual antes de T-10 |
| `helm/charts/backup-status/templates/openwhisk-actions.yaml` | Referencia de estilo para T-10 |

---

## Grafo de dependencias entre tareas

```
T-01 (Migración DB)
  └─► T-03 (Repository DAL)
        ├─► T-04 (Módulo central audit-trail.ts)
        │     ├─► T-05 (Módulo fallback)
        │     ├─► T-06 (Hook trigger-backup)
        │     ├─► T-07 (Hook trigger-restore)
        │     └─► T-08 (Hook operation-dispatcher)
        └─► T-09 (query-audit.action)
              └─► T-10 (Infraestructura: APISIX + Keycloak + Helm)
                    └─► T-11 (Frontend)

T-02 (Tipos TS) — depende de nada; bloquea T-03, T-04, T-05, T-06, T-07, T-08, T-09, T-11

T-12 (Tests) — depende de T-01..T-11 completos
```

**Paralelización posible**:
- T-01 y T-02 pueden desarrollarse en paralelo (no tienen dependencias entre sí).
- T-05, T-06, T-07, T-08 y T-09 pueden desarrollarse en paralelo una vez T-02, T-03 y T-04 estén completos.
- T-10 puede comenzar en paralelo con T-04..T-09.
- T-11 puede comenzar con mocks del API en cuanto T-02 y T-09 estén definidos.

---

## T-01 — Migración de base de datos: tabla `backup_audit_events`

### Ficheros a crear

- `services/backup-status/src/db/migrations/003_backup_audit_events.sql`

### Descripción

Crear la migración SQL que añade el tipo ENUM `backup_audit_event_type` y la tabla `backup_audit_events` con todas las columnas, restricciones e índices definidos en el plan. La migración es append-only: no modifica ninguna tabla ni tipo existente.

### Contenido esperado del fichero

El fichero debe contener exactamente (en orden):

1. Declaración del tipo ENUM `backup_audit_event_type` con los 10 valores:
   `backup.requested`, `backup.started`, `backup.completed`, `backup.failed`, `backup.rejected`,
   `restore.requested`, `restore.started`, `restore.completed`, `restore.failed`, `restore.rejected`.

2. Creación de la tabla `backup_audit_events` con las columnas:
   `id` (UUID PK, default `gen_random_uuid()`), `schema_version` (TEXT NOT NULL, default `'1'`),
   `event_type` (ENUM, NOT NULL), `operation_id` (UUID, nullable), `correlation_id` (UUID NOT NULL, default `gen_random_uuid()`),
   `tenant_id` (TEXT NOT NULL), `component_type` (TEXT NOT NULL), `instance_id` (TEXT NOT NULL),
   `snapshot_id` (TEXT, nullable), `actor_id` (TEXT NOT NULL), `actor_role` (TEXT NOT NULL),
   `session_id` (TEXT, nullable), `source_ip` (TEXT, nullable), `user_agent` (TEXT, nullable),
   `session_context_status` (TEXT NOT NULL, default `'full'`), `result` (TEXT, nullable),
   `rejection_reason` (TEXT, nullable), `rejection_reason_public` (TEXT, nullable),
   `detail` (TEXT, nullable), `detail_truncated` (BOOLEAN NOT NULL, default `FALSE`),
   `destructive` (BOOLEAN NOT NULL, default `FALSE`), `occurred_at` (TIMESTAMPTZ NOT NULL, default `NOW()`),
   `published_at` (TIMESTAMPTZ, nullable), `publish_attempts` (INTEGER NOT NULL, default `0`),
   `publish_last_error` (TEXT, nullable).

3. Cinco índices:
   - `idx_audit_tenant_time` sobre `(tenant_id, occurred_at DESC)`
   - `idx_audit_operation` sobre `(operation_id)` WHERE `operation_id IS NOT NULL`
   - `idx_audit_pending_publish` sobre `(publish_attempts, occurred_at)` WHERE `published_at IS NULL`
   - `idx_audit_actor` sobre `(actor_id, occurred_at DESC)`
   - `idx_audit_event_type` sobre `(event_type, occurred_at DESC)`

4. Comentario de rollback al final del fichero:
   ```sql
   -- Rollback: DROP TABLE backup_audit_events; DROP TYPE backup_audit_event_type;
   ```

### Criterios de aceptación

- [ ] El fichero `003_backup_audit_events.sql` existe en `services/backup-status/src/db/migrations/`.
- [ ] La migración se ejecuta sin errores contra PostgreSQL vacío (`psql -f 003_backup_audit_events.sql`).
- [ ] `\d backup_audit_events` muestra todas las columnas con los tipos y defaults correctos.
- [ ] `\di backup_audit_events*` muestra los cinco índices esperados.
- [ ] `\dT backup_audit_event_type` muestra los 10 valores del ENUM.
- [ ] La migración no modifica ninguna tabla existente (`backup_operations`, `backup_status_snapshots`).

### Dependencias

Ninguna.

---

## T-02 — Tipos TypeScript del sistema de auditoría

### Ficheros a crear

- `services/backup-status/src/audit/audit-trail.types.ts`

### Descripción

Definir todos los tipos TypeScript necesarios para el módulo de auditoría. Este fichero es el contrato compartido entre todos los módulos de T-03 a T-11.

### Tipos a declarar

- `AuditEventType` — union literal de los 10 tipos de evento ENUM.
- `SessionContextStatus` — union `'full' | 'partial' | 'not_applicable'`.
- `SessionContext` — interfaz con `sessionId?`, `sourceIp?`, `userAgent?`, `status`.
- `AuditEventInput` — payload de entrada para `emitAuditEvent()`: `eventType`, `operationId?`, `correlationId?`, `tenantId`, `componentType`, `instanceId`, `snapshotId?`, `actorId`, `actorRole`, `sessionContext`, `result`, `rejectionReason?`, `rejectionReasonPublic?`, `detail?`, `destructive?`.
- `AuditEvent` — extiende `AuditEventInput` con los campos persistidos: `id`, `schemaVersion: '1'`, `occurredAt`, `detailTruncated`, `publishedAt?`, `publishAttempts`.
- `AuditQueryFilters` — interfaz de filtros para el endpoint de consulta: `tenantId?`, `eventType?`, `actorId?`, `operationId?`, `result?`, `from?`, `to?`, `limit?`, `cursor?`.
- `AuditEventPage` — respuesta paginada: `schemaVersion: '1'`, `events`, `pagination`.
- `AuditEventAdmin` — vista completa para SRE/superadmin (todos los campos en formato snake_case JSON).
- `AuditEventPublic` — vista resumida para tenant owner (sin `session_id`, `source_ip`, `user_agent`, `session_context_status`, `rejection_reason`, `detail`, `instance_id`, `snapshot_id`).

### Criterios de aceptación

- [ ] El fichero `audit-trail.types.ts` existe en `services/backup-status/src/audit/`.
- [ ] Compila sin errores con `tsc --noEmit` en el contexto del proyecto.
- [ ] `AuditEventAdmin` incluye todos los campos de la tabla `backup_audit_events` excepto los campos de estado de publicación Kafka (`published_at`, `publish_attempts`, `publish_last_error`).
- [ ] `AuditEventPublic` omite: `session_id`, `source_ip`, `user_agent`, `session_context_status`, `rejection_reason`, `detail`, `detail_truncated`, `instance_id`, `snapshot_id`.
- [ ] El campo `schemaVersion` tiene tipo literal `'1'` (no `string`).
- [ ] `AuditQueryFilters.limit` tiene valor máximo documentado en comentario (`default: 50, max: 200`).

### Dependencias

Ninguna.

---

## T-03 — Repositorio DAL: `AuditTrailRepository`

### Ficheros a crear

- `services/backup-status/src/audit/audit-trail.repository.ts`

### Ficheros a leer

- `services/backup-status/src/audit/audit-trail.types.ts` (T-02)
- `services/backup-status/src/db/migrations/003_backup_audit_events.sql` (T-01, para referencia de columnas)

### Descripción

Implementar la capa de acceso a datos (DAL) sobre la tabla `backup_audit_events`. Este módulo es el único punto de acceso a PostgreSQL para el módulo de auditoría.

### Métodos a implementar

- `insert(event: AuditEvent): Promise<void>` — inserta un evento en la tabla.
- `markPublished(eventId: string): Promise<void>` — actualiza `published_at = NOW()` para el evento dado.
- `incrementPublishAttempt(eventId: string, error: string): Promise<void>` — incrementa `publish_attempts` y actualiza `publish_last_error`.
- `findPendingPublish(maxAttempts: number): Promise<AuditEvent[]>` — devuelve eventos con `published_at IS NULL` y `publish_attempts < maxAttempts`, ordenados por `occurred_at ASC`.
- `query(filters: AuditQueryFilters): Promise<AuditEventPage>` — consulta paginada con filtros; aplica los índices apropiados. Implementa cursor-based pagination sobre `(occurred_at, id)`.

### Criterios de aceptación

- [ ] El fichero `audit-trail.repository.ts` existe en `services/backup-status/src/audit/`.
- [ ] Compila sin errores con `tsc --noEmit`.
- [ ] `insert()` persiste todos los campos de `AuditEvent` en la tabla, incluyendo `published_at = NULL` y `publish_attempts = 0`.
- [ ] `markPublished()` solo actualiza `published_at` sin modificar otros campos.
- [ ] `findPendingPublish()` no devuelve eventos con `publish_attempts >= maxAttempts`.
- [ ] `query()` aplica todos los filtros de `AuditQueryFilters` si están presentes.
- [ ] `query()` respeta `limit` máximo de 200 aunque el llamador pase un valor mayor.
- [ ] La paginación cursor devuelve `nextCursor = null` si no hay más resultados.

### Dependencias

- T-01 (tabla en DB)
- T-02 (tipos)

---

## T-04 — Módulo central de emisión: `audit-trail.ts`

### Ficheros a crear

- `services/backup-status/src/audit/audit-trail.ts`

### Ficheros a leer

- `services/backup-status/src/audit/audit-trail.types.ts` (T-02)
- `services/backup-status/src/audit/audit-trail.repository.ts` (T-03)

### Descripción

Implementar la función pública `emitAuditEvent(input: AuditEventInput): Promise<void>` que:

1. Construye el `AuditEvent` completo (`buildEvent`): genera `id` UUID, establece `schemaVersion: '1'`, `occurredAt: new Date()`, trunca `detail` si excede `MAX_DETAIL_BYTES` (4096), establece `detailTruncated`, genera `correlationId` si no se proporciona.
2. Persiste el evento en PostgreSQL vía `AuditTrailRepository.insert()` — operación síncrona.
3. Publica en Kafka topic `platform.backup.audit.events` — operación asíncrona (fire-and-forget): si falla, deja `published_at = NULL` para que el fallback loop actúe; no propaga la excepción.
4. **Nunca lanza excepción al invocador** — captura todos los errores internamente y los registra en log estructurado.

La constante `KAFKA_TOPIC` debe leerse de la variable de entorno `AUDIT_KAFKA_TOPIC` con fallback a `'platform.backup.audit.events'`. Si `KAFKA_BROKERS` no está definida, opera en modo local (log únicamente, sin intentar publicar).

### Criterios de aceptación

- [ ] El fichero `audit-trail.ts` existe en `services/backup-status/src/audit/`.
- [ ] Compila sin errores.
- [ ] `emitAuditEvent()` **no lanza excepción** aunque PostgreSQL o Kafka fallen (verificable en tests unitarios).
- [ ] El evento se persiste en DB antes de intentar publicar en Kafka.
- [ ] Si Kafka falla, el evento queda en DB con `published_at = NULL`.
- [ ] Si Kafka tiene éxito, se llama a `AuditTrailRepository.markPublished()`.
- [ ] El campo `detail` se trunca a `MAX_DETAIL_BYTES` (4096 bytes UTF-8) y `detail_truncated` se establece a `true` en ese caso.
- [ ] `correlationId` se auto-genera con UUID v4 si el input no lo proporciona.
- [ ] `destructive` tiene valor por defecto `false` si el input no lo proporciona.

### Dependencias

- T-02 (tipos)
- T-03 (repositorio)

---

## T-05 — Módulo de fallback y reintento: `audit-trail.fallback.ts`

### Ficheros a crear

- `services/backup-status/src/audit/audit-trail.fallback.ts`

### Ficheros a leer

- `services/backup-status/src/audit/audit-trail.types.ts` (T-02)
- `services/backup-status/src/audit/audit-trail.repository.ts` (T-03)

### Descripción

Implementar la función `retryPendingAuditEvents(): Promise<void>` que:

1. Consulta `AuditTrailRepository.findPendingPublish(MAX_PUBLISH_ATTEMPTS)` para obtener eventos con `published_at IS NULL` y `publish_attempts < MAX_PUBLISH_ATTEMPTS`.
2. Para cada evento pendiente, intenta publicar en Kafka.
3. Si la publicación tiene éxito: llama a `markPublished()`.
4. Si falla: llama a `incrementPublishAttempt()`. Si el nuevo número de intentos alcanza `MAX_PUBLISH_ATTEMPTS`, emite una alerta operacional al topic `platform.audit.alerts` con el payload `{ type: 'audit_event_publish_failed', event_id, tenant_id, event_type, occurred_at, attempts }`.
5. La alerta operacional no propaga excepción aunque falle.

Constantes configurables vía entorno:
- `MAX_PUBLISH_ATTEMPTS` (default: `5`)
- `ALERT_TOPIC` (default: `'platform.audit.alerts'`)

Esta función debe ser exportada para invocación periódica desde una alarm de OpenWhisk (cada 60 segundos).

### Tabla de backoff exponencial esperado

| Intento | Espera mínima entre ciclos |
|---|---|
| 1 | 60 s |
| 2 | 120 s |
| 3 | 240 s |
| 4 | 480 s |
| 5 (MAX) | — Alerta operacional |

> Nota: el backoff se implementa a nivel del ciclo de la alarm de OpenWhisk, no como `setTimeout` interno. La función `retryPendingAuditEvents` procesa lo que encuentra en cada ejecución.

### Criterios de aceptación

- [ ] El fichero `audit-trail.fallback.ts` existe en `services/backup-status/src/audit/`.
- [ ] Compila sin errores.
- [ ] Eventos con `published_at IS NULL` y `publish_attempts < MAX_PUBLISH_ATTEMPTS` son procesados.
- [ ] Eventos con `publish_attempts >= MAX_PUBLISH_ATTEMPTS` **no** son reintentados.
- [ ] Al alcanzar `MAX_PUBLISH_ATTEMPTS`, se emite una alerta al topic `platform.audit.alerts`.
- [ ] La alerta operacional incluye: `event_id`, `tenant_id`, `event_type`, `occurred_at`, `attempts`.
- [ ] La función no lanza excepción aunque tanto Kafka como el topic de alertas fallen.

### Dependencias

- T-02 (tipos)
- T-03 (repositorio)
- T-04 (función `publishToKafka` o cliente Kafka compartido)

---

## T-06 — Hooks de auditoría en `trigger-backup.action.ts`

### Ficheros a modificar

- `services/backup-status/src/operations/trigger-backup.action.ts`

### Ficheros a leer

- `services/backup-status/src/operations/trigger-backup.action.ts` (estado actual)
- `services/backup-status/src/audit/audit-trail.ts` (T-04)
- `services/backup-status/src/audit/audit-trail.types.ts` (T-02)

### Descripción

Añadir en el handler de `trigger-backup.action.ts`:

1. **Función `extractSessionContext(req)`**: extrae del objeto request los headers `x-session-id`, `x-forwarded-for` (primer elemento), `x-real-ip` y `user-agent`. Determina `session_context_status`:
   - `'full'` si `session_id` o `source_ip` están presentes.
   - `'not_applicable'` si ninguno está disponible.

2. **Al rechazar la solicitud** (retorno con código HTTP 400, 403, 409, 422): ANTES de devolver la respuesta, invocar `emitAuditEvent()` con:
   - `eventType: 'backup.rejected'`
   - `operationId: null`
   - `tenantId`, `componentType`, `instanceId` del body de la solicitud
   - `actorId: token.sub`, `actorRole`: rol primario del JWT
   - `sessionContext`: resultado de `extractSessionContext(req)`
   - `result: 'rejected'`, `rejectionReason`: código semántico interno, `rejectionReasonPublic`: mensaje genérico
   - `destructive: false`

3. **Al aceptar la solicitud** (tras crear el registro en `backup_operations`): invocar `emitAuditEvent()` con:
   - `eventType: 'backup.requested'`
   - `operationId`: ID de la operación recién creada
   - Resto de campos igual al punto 2
   - `result: 'accepted'`

La llamada a `emitAuditEvent()` es siempre **fire-and-forget** (`void`): no se `await` su resultado ni se envuelve en try/catch (ya lo gestiona el propio módulo).

### Criterios de aceptación

- [ ] El handler importa `emitAuditEvent` y `SessionContext` desde `../audit/audit-trail.js`.
- [ ] La función `extractSessionContext` está implementada localmente en el fichero.
- [ ] Una solicitud rechazada genera un evento `backup.rejected` en la tabla `backup_audit_events` (verificable en test de integración).
- [ ] Una solicitud aceptada genera un evento `backup.requested` con el `operation_id` correcto.
- [ ] Los tests de integración existentes de `trigger-backup` siguen pasando (no se altera el contrato de respuesta HTTP).
- [ ] No se añade latencia observable: las llamadas a `emitAuditEvent` son asíncronas no bloqueantes.

### Dependencias

- T-02 (tipos)
- T-04 (módulo de emisión)

---

## T-07 — Hooks de auditoría en `trigger-restore.action.ts`

### Ficheros a modificar

- `services/backup-status/src/operations/trigger-restore.action.ts`

### Ficheros a leer

- `services/backup-status/src/operations/trigger-restore.action.ts` (estado actual)
- `services/backup-status/src/audit/audit-trail.ts` (T-04)
- `services/backup-status/src/audit/audit-trail.types.ts` (T-02)

### Descripción

Mismos pasos que T-06 pero para el handler de restore. Diferencias específicas:

- Tipo de evento base: `'restore.rejected'` / `'restore.requested'`.
- `destructive: true` en **todos** los eventos de restore (rechazados o aceptados).
- Incluir `snapshotId: body.snapshot_id` en todos los eventos de restore donde el body lo proporcione.
- La función `extractSessionContext` puede reutilizarse o importarse de una utilidad compartida si T-06 la extrae a un módulo helper.

### Criterios de aceptación

- [ ] Una solicitud de restore rechazada genera un evento `restore.rejected` con `destructive: true`.
- [ ] Una solicitud de restore aceptada genera un evento `restore.requested` con `destructive: true` y `snapshot_id` correcto.
- [ ] Los tests de integración existentes de `trigger-restore` siguen pasando.
- [ ] No se añade latencia observable.

### Dependencias

- T-02 (tipos)
- T-04 (módulo de emisión)
- T-06 (patrón de `extractSessionContext`; puede reutilizarse)

---

## T-08 — Hooks de auditoría en `operation-dispatcher.ts`

### Ficheros a modificar

- `services/backup-status/src/operations/operation-dispatcher.ts`

### Ficheros a leer

- `services/backup-status/src/operations/operation-dispatcher.ts` (estado actual)
- `services/backup-status/src/audit/audit-trail.ts` (T-04)
- `services/backup-status/src/audit/audit-trail.types.ts` (T-02)

### Descripción

Añadir llamadas a `emitAuditEvent()` en cada transición de estado del dispatcher:

| Transición | Tipo de evento emitido |
|---|---|
| `accepted` → `in_progress` | `backup.started` o `restore.started` |
| `in_progress` → `completed` | `backup.completed` o `restore.completed` |
| `in_progress` → `failed` | `backup.failed` o `restore.failed` |

En todos los casos:
- `sessionContext: { status: 'not_applicable' }` — el dispatcher es asíncrono y no tiene contexto HTTP.
- `actorId` y `actorRole`: tomados de los campos almacenados en el registro de `backup_operations` (de T02).
- `destructive`: `true` para eventos de tipo restore, `false` para backup.
- Para eventos `*.failed`: incluir `rejectionReason: error.message`, `rejectionReasonPublic: 'La operación no pudo completarse. Contacte al administrador.'`.
- El tipo de evento se construye dinámicamente: `` `${operation.type}.started` as AuditEventType ``.

### Criterios de aceptación

- [ ] Una operación de backup que completa el ciclo `accepted → in_progress → completed` genera exactamente tres eventos de auditoría con el mismo `operation_id`.
- [ ] Una operación de restore que falla en `in_progress` genera un evento `restore.failed` con `rejectionReason` y `destructive: true`.
- [ ] Los eventos del dispatcher tienen `session_context_status: 'not_applicable'`.
- [ ] Los tests de integración existentes del dispatcher siguen pasando.

### Dependencias

- T-02 (tipos)
- T-04 (módulo de emisión)

---

## T-09 — Endpoint REST de consulta: `query-audit.action.ts`

### Ficheros a crear

- `services/backup-status/src/operations/query-audit.action.ts`

### Ficheros a leer

- `services/backup-status/src/audit/audit-trail.types.ts` (T-02)
- `services/backup-status/src/audit/audit-trail.repository.ts` (T-03)
- `apps/control-plane/openapi/families/backup.yaml` (referencia de contratos API existentes)

### Descripción

Implementar el handler REST `GET /v1/backup/audit` como acción OpenWhisk. El handler:

1. Valida el JWT de Keycloak.
2. Determina el nivel de acceso:
   - `backup-audit:read:global` → acceso global, serialización admin (`AuditEventAdmin`).
   - `backup-audit:read:own` → solo el propio tenant, serialización pública (`AuditEventPublic`).
   - Sin scope válido → `HTTP 403`.
3. Para rol `tenant_owner`:
   - Si `tenant_id` query param está ausente o no coincide con `token.tenant_id` → `HTTP 403`.
4. Valida el rango temporal: si `to - from > MAX_AUDIT_RANGE_DAYS` → `HTTP 422` con body `{ error: 'range_too_wide', max_days: MAX_AUDIT_RANGE_DAYS }`.
5. Construye `AuditQueryFilters` desde los query params: `tenant_id`, `event_type` (acepta lista separada por comas), `actor_id`, `operation_id`, `result`, `from`, `to`, `limit` (default 50, máx 200), `cursor`.
6. Llama a `AuditTrailRepository.query(filters)`.
7. Serializa la respuesta usando `AuditEventAdmin` (admin) o `AuditEventPublic` (tenant owner).
8. Responde `HTTP 200` con `{ schema_version: '1', events: [...], pagination: { limit, next_cursor, total: null } }`.

**Restricción de mutación**: el handler solo responde a `GET`. Cualquier otro método devuelve `HTTP 405 Method Not Allowed`.

Constante configurable: `MAX_AUDIT_RANGE_DAYS` desde `process.env.AUDIT_MAX_RANGE_DAYS` con fallback a `90`.

### Criterios de aceptación

- [ ] El fichero `query-audit.action.ts` existe en `services/backup-status/src/operations/`.
- [ ] Compila sin errores.
- [ ] `GET /v1/backup/audit` sin token → `HTTP 401`.
- [ ] `GET /v1/backup/audit` con token sin scope → `HTTP 403`.
- [ ] Tenant owner que consulta otro `tenant_id` → `HTTP 403`.
- [ ] Tenant owner sin `tenant_id` param → `HTTP 403`.
- [ ] Rango temporal > `MAX_AUDIT_RANGE_DAYS` → `HTTP 422`.
- [ ] `PUT /v1/backup/audit/:id` → `HTTP 405`.
- [ ] Respuesta para admin incluye `session_id`, `source_ip`, `user_agent`.
- [ ] Respuesta para tenant owner **no** incluye `session_id`, `source_ip`, `user_agent`, `rejection_reason`, `detail`, `instance_id`, `snapshot_id`.
- [ ] Todos los eventos en la respuesta tienen `schema_version: '1'`.
- [ ] La respuesta incluye `pagination.next_cursor` opaco; `null` si no hay más resultados.

### Dependencias

- T-02 (tipos)
- T-03 (repositorio)

---

## T-10 — Infraestructura: APISIX, Keycloak y Helm

### Ficheros a crear

- `services/gateway-config/routes/backup-audit-routes.yaml`
- `services/keycloak-config/scopes/backup-audit-scopes.yaml`
- `helm/charts/backup-status/templates/openwhisk-audit-actions.yaml`

### Ficheros a modificar

- `helm/charts/backup-status/values.yaml`

### Ficheros a leer

- `services/gateway-config/routes/backup-routes.yaml` (referencia de estilo)
- `services/keycloak-config/scopes/backup-scopes.yaml` (referencia de estilo)
- `helm/charts/backup-status/templates/openwhisk-actions.yaml` (referencia de estilo)
- `helm/charts/backup-status/values.yaml` (estado actual)

### Descripción

**`backup-audit-routes.yaml`** (APISIX):
- Ruta `backup-audit-get`: método `GET`, URI `/v1/backup/audit`, upstream `openwhisk-query-audit`.
- Plugin `openid-connect`: `discovery` desde `${KEYCLOAK_DISCOVERY_URL}`, `required_scopes: ["backup-audit:read:own"]`.
- Plugin `limit-req`: `rate: 20`, `burst: 40`, `key: consumer_name`.
- Plugin `response-rewrite`: headers `Cache-Control: "no-store, no-cache"`, `X-Content-Type-Options: "nosniff"`.

**`backup-audit-scopes.yaml`** (Keycloak):
- Scope `backup-audit:read:global`: descripción, asignado a roles `sre` y `superadmin`.
- Scope `backup-audit:read:own`: descripción, asignado a rol `tenant_owner`.

**`openwhisk-audit-actions.yaml`** (Helm template):
- Definición del despliegue de la acción `query-audit` en OpenWhisk, siguiendo el mismo patrón que las acciones existentes.

**`values.yaml`** (sección añadida):
```yaml
audit:
  enabled: true
  kafka_topic: "platform.backup.audit.events"
  alert_topic: "platform.audit.alerts"
  fallback:
    retry_interval_seconds: 60
    max_attempts: 5
    base_backoff_ms: 60000
  query:
    max_range_days: 90
    default_limit: 50
    max_limit: 200
  detail:
    max_bytes: 4096
```

### Criterios de aceptación

- [ ] `backup-audit-routes.yaml` existe y define la ruta APISIX con los tres plugins requeridos.
- [ ] `backup-audit-scopes.yaml` existe y define los dos scopes con sus asignaciones de rol.
- [ ] `openwhisk-audit-actions.yaml` existe y referencia los valores de `values.yaml` para el nombre y configuración de la acción.
- [ ] `values.yaml` incluye la sección `audit:` con todos los campos documentados.
- [ ] El YAML es sintácticamente válido (verificable con `yamllint` o `helm lint`).

### Dependencias

- T-09 (acción query-audit a desplegar)

---

## T-11 — Frontend: páginas y componentes de auditoría en consola

### Ficheros a crear

- `apps/console/src/pages/admin/BackupAuditPage.tsx`
- `apps/console/src/pages/tenant/BackupAuditSummaryPage.tsx`
- `apps/console/src/components/backup/AuditEventTable.tsx`
- `apps/console/src/components/backup/AuditEventDetail.tsx`
- `apps/console/src/components/backup/AuditEventFilters.tsx`
- `apps/console/src/components/backup/AuditEventTypeBadge.tsx`
- `apps/console/src/hooks/useAuditEvents.ts`
- `apps/console/src/lib/api/backup-audit.api.ts`

### Ficheros a leer

- `apps/console/src/lib/api/backup.api.ts` (referencia de estilo del cliente HTTP)
- `apps/console/src/hooks/useBackupOperations.ts` (referencia de patrón de query hook, si existe)
- `apps/console/src/components/backup/` (componentes existentes para referencia de estilo)

### Descripción

#### `backup-audit.api.ts`

Cliente HTTP para `GET /v1/backup/audit`. Acepta `AuditQueryFilters` y devuelve `AuditEventPage`. Gestiona el token JWT de la sesión activa.

#### `useAuditEvents.ts`

Hook de React Query que encapsula `backup-audit.api.ts`. Acepta `AuditQueryFilters` como entrada. Gestiona la paginación cursor-based (función `fetchNextPage`). Expone: `events`, `isLoading`, `hasNextPage`, `fetchNextPage`, `error`.

#### `AuditEventTypeBadge.tsx`

Badge con color semántico según el tipo de evento:
- Azul: `*.requested`, `*.started`
- Verde: `*.completed`
- Rojo/naranja: `*.failed`, `*.rejected`

#### `AuditEventTable.tsx`

Tabla de eventos con columnas configurables por rol mediante prop `role: 'admin' | 'tenant_owner'`:
- Columnas siempre visibles: timestamp (`occurred_at`), tipo de evento (`AuditEventTypeBadge`), actor (`actor_id`), tenant (`tenant_id`), resultado (`result`).
- Columnas solo para admin: IP de origen (`source_ip`), componente (`component_type`, `instance_id`).
- Cada fila es expandible para mostrar `AuditEventDetail`.

#### `AuditEventDetail.tsx`

Panel expandible que muestra todos los campos disponibles según rol:
- Admin: `session_id`, `user_agent`, `source_ip`, `rejection_reason`, `detail`, enlace a operación si `operation_id` no es null.
- Tenant owner: `rejection_reason_public` (si aplica), resultado.

#### `AuditEventFilters.tsx`

Formulario controlado con debounce (300 ms) para filtros de texto. Campos:
- Admin: selector de tenant (si vista global), multi-select de tipo de evento (`AuditEventTypeBadge`), campo de actor ID, date-picker desde/hasta, selector de resultado.
- Tenant owner: date-picker, selector de tipo de acción (backup/restore), selector de resultado.

#### `BackupAuditPage.tsx`

Página administrativa (`/admin/backup/audit`). Compone: `AuditEventFilters` + `AuditEventTable` (role=`'admin'`) + paginación. Accesible para SRE y superadmin.

#### `BackupAuditSummaryPage.tsx`

Página del tenant owner (`/backup/audit`). Compone: `AuditEventFilters` (simplificado) + `AuditEventTable` (role=`'tenant_owner'`) + paginación. Sin columnas de sesión ni identificadores técnicos.

### Criterios de aceptación

- [ ] Todos los ficheros existen en sus rutas correctas.
- [ ] Compilan sin errores con el compilador TypeScript del proyecto.
- [ ] `AuditEventTable` con `role='admin'` muestra columna de IP de origen.
- [ ] `AuditEventTable` con `role='tenant_owner'` no renderiza columna de IP, user-agent ni session ID en el DOM.
- [ ] `BackupAuditSummaryPage` no renderiza `session_id`, `source_ip` ni `user_agent` para ningún evento.
- [ ] `AuditEventTypeBadge` aplica el color correcto para cada familia de tipo de evento.
- [ ] `useAuditEvents` gestiona la paginación cursor-based correctamente.
- [ ] `backup-audit.api.ts` serializa los `AuditQueryFilters` como query params correctamente.

### Dependencias

- T-02 (tipos: `AuditEventPage`, `AuditEventAdmin`, `AuditEventPublic`, `AuditQueryFilters`)
- T-09 (endpoint API disponible o mockeado para desarrollo)

---

## T-12 — Tests: unitarios, integración, contrato y componente

### Ficheros a crear

- `services/backup-status/test/unit/audit/audit-trail.test.ts`
- `services/backup-status/test/unit/audit/audit-trail.repository.test.ts`
- `services/backup-status/test/unit/audit/audit-trail.fallback.test.ts`
- `services/backup-status/test/unit/audit/query-audit.action.test.ts`
- `services/backup-status/test/integration/backup-audit-api.test.mjs`
- `services/backup-status/test/contract/audit-event.contract.ts`

### Cobertura de criterios de aceptación del spec

| CA del spec | Test que lo cubre | Tipo |
|---|---|---|
| CA-01 | `backup-audit-api.test.mjs`: POST /trigger → GET /audit → evento `backup.requested` | Integration |
| CA-02 | `backup-audit-api.test.mjs`: POST /restore → GET /audit → evento `restore.requested` con `snapshot_id` y `destructive: true` | Integration |
| CA-03 | `backup-audit-api.test.mjs`: ciclo de vida completo → GET /audit?operation_id=... → 3 eventos | Integration |
| CA-04 | `backup-audit-api.test.mjs`: token tenant_owner → POST /restore → 403 → `restore.rejected` en DB | Integration |
| CA-05 | `audit-trail.test.ts`: mock Kafka falla → DB tiene evento con `published_at IS NULL` | Unit |
| CA-05 (fallback) | `audit-trail.fallback.test.ts`: spy en Kafka → alerta operacional tras MAX intentos | Unit |
| CA-06 | `query-audit.action.test.ts` + integración: filtros + paginación | Unit + Integration |
| CA-07 | `query-audit.action.test.ts`: token tenant-A → GET ?tenant_id=tenant-B → 403 | Unit |
| CA-08 | `query-audit.action.test.ts`: token tenant_owner sin tenant_id → 403 | Unit |
| CA-09 | Test de componente (Vitest + RTL): `BackupAuditPage` con admin token → columnas sensibles visibles | Component |
| CA-10 | Test de componente: `BackupAuditSummaryPage` con tenant_owner → sin columnas sensibles en DOM | Component |
| CA-11 | `backup-audit-api.test.mjs`: PUT /v1/backup/audit/:id → 405 | Integration |
| CA-12 | `audit-event.contract.ts`: payload contiene `schema_version: "1"` | Contract |
| CA-13 | `backup-audit-api.test.mjs`: GET /audit?operation_id=... → todos los eventos del ciclo de vida | Integration |

### Casos unitarios clave a implementar

**`audit-trail.test.ts`**:
- `emitAuditEvent` persiste en DB antes de publicar en Kafka.
- `emitAuditEvent` no lanza excepción cuando Kafka falla.
- `emitAuditEvent` trunca `detail` cuando excede `MAX_DETAIL_BYTES`.
- `emitAuditEvent` establece `detail_truncated: true` cuando trunca.
- `emitAuditEvent` establece `session_context_status: 'not_applicable'` cuando no hay contexto HTTP.

**`audit-trail.fallback.test.ts`**:
- `retryPendingAuditEvents` reintenta eventos con `published_at IS NULL`.
- Emite alerta operacional al alcanzar `MAX_PUBLISH_ATTEMPTS`.
- No reintenta eventos que ya alcanzaron `MAX_PUBLISH_ATTEMPTS`.

**`query-audit.action.test.ts`**:
- `HTTP 403` sin scope válido.
- `HTTP 403` cuando tenant_owner consulta otro tenant.
- `HTTP 403` cuando tenant_owner omite `tenant_id`.
- `HTTP 422` cuando el rango temporal supera `MAX_AUDIT_RANGE_DAYS`.
- Respuesta para SRE incluye `session_id`, `source_ip`, `user_agent`.
- Respuesta para tenant_owner omite esos campos.
- Paginación cursor funciona correctamente.
- Filtro por lista de tipos de evento (`event_type=backup.requested,backup.completed`).

**`audit-event.contract.ts`**:
- Payload del evento (admin) cumple el schema JSON v1 con todos los campos requeridos.
- Payload del evento (tenant_owner) no contiene los campos excluidos.
- Campo `schema_version` es siempre `"1"` (string, no número).

### Criterios de aceptación de esta tarea

- [ ] Todos los ficheros de test existen en sus rutas correctas.
- [ ] Los tests unitarios y de contrato pasan con `vitest run` (o el runner configurado en el proyecto).
- [ ] Los tests de integración pasan contra un entorno PostgreSQL real (o en memoria con pg-mem si el proyecto lo soporta).
- [ ] La cobertura de línea del módulo `services/backup-status/src/audit/` es ≥ 85%.
- [ ] Ningún test existente de T01 o T02 regresa en rojo.

### Dependencias

- T-01..T-11 completos (todos los módulos implementados).

---

## Orden de implementación recomendado

```
Fase 1 (paralelo): T-01, T-02
Fase 2 (paralelo, requiere T-01+T-02): T-03, T-10 (valores Helm iniciales)
Fase 3 (paralelo, requiere T-02+T-03): T-04, T-09
Fase 4 (paralelo, requiere T-04): T-05, T-06, T-07, T-08
Fase 5 (paralelo, requiere T-09+T-10): T-10 (rutas APISIX + Keycloak), T-11
Fase 6 (requiere T-01..T-11): T-12
```

---

*Documento generado para el stage `speckit.tasks` — US-BKP-01-T03 | Rama: `111-backup-audit-trail`*
