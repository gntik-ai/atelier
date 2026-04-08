# Plan de implementación — US-BKP-01-T04: Confirmaciones reforzadas y prechecks antes de restauraciones destructivas

| Campo              | Valor                                                              |
|--------------------|--------------------------------------------------------------------|
| **Task ID**        | US-BKP-01-T04                                                      |
| **Spec**           | `specs/112-backup-restore-confirmations/spec.md`                   |
| **Rama**           | `112-backup-restore-confirmations`                                 |
| **Servicio**       | `services/backup-status` (`@in-falcone/backup-status`)             |
| **Frontend**       | `apps/web-console`                                                 |
| **Dependencias**   | PR#156 (T01), PR#157 (T02), PR#158 (T03) — todas merged           |

---

## 1. Decisiones de arquitectura

### 1.1 Interceptación del flujo de restore: modelo de solicitud pendiente

El flujo de restauración se divide en **dos pasos explícitos** en lugar de despachar directamente al adaptador. Este modelo aplica tanto en la consola como en la API:

**Paso 1 — Inicio:** `POST /v1/backup/restore` ejecuta prechecks, crea un registro `restore_confirmation_requests` con estado `pending_confirmation`, y devuelve el resumen de prechecks + un token opaco. **No despacha al adaptador.**

**Paso 2 — Confirmación:** `POST /v1/backup/restore/confirm` recibe el token + `confirmed: true`, revalida el snapshot, y sólo entonces registra la operación en `backup_operations` y despacha al adaptador.

Este modelo garantiza el cumplimiento de RN-01 (ninguna restauración se despacha sin confirmación) tanto para flujos de consola como para automatizaciones vía API.

### 1.2 Persistencia del token de confirmación

El token se genera con `crypto.randomBytes(32)` (CSPRNG), se codifica en base64url, y **sólo se almacena su hash SHA-256** en base de datos. El valor en texto plano se devuelve una sola vez al solicitante (en la respuesta del Paso 1). Esto implementa RN-06 y la seguridad de sección 5.4.

### 1.3 Ejecución de prechecks

Los prechecks se ejecutan en el Paso 1, antes de crear el token de confirmación. Si algún precheck retorna `blocking_error`, la solicitud se rechaza sin generar token (CA-03, RF-T04-01). Los prechecks son funciones independientes en un módulo `confirmations/prechecks/`, cada una retorna `{result: 'ok'|'warning'|'blocking_error', code: string, message: string}`.

La ejecución de todos los prechecks se hace en paralelo con `Promise.allSettled` para respetar el timeout máximo configurable (por defecto 10 s). Si `allSettled` detecta un precheck que no resolvió, se registra como `warning` con código `precheck_timeout` y el nivel de riesgo sube automáticamente a `elevated`.

### 1.4 Cálculo del nivel de riesgo

El nivel de riesgo (`normal`, `elevated`, `critical`) se calcula en una función pura `calculateRiskLevel(scope, precheckResults, snapshotAgeMs, requestedAt, config)`:

- **critical**: alcance completo (todos los componentes de un tenant) **o** ≥ 3 advertencias simultáneas.
- **elevated**: snapshot más antiguo que `PRECHECK_SNAPSHOT_AGE_WARNING_MS`, ≥ 1 advertencia presente, solicitud fuera del horario operativo, o prechecks incompletos por timeout.
- **normal**: todo lo demás.

### 1.5 Confirmación deliberada proporcional al riesgo

El nivel de riesgo determina los controles requeridos en la confirmación (RN-04):

| Nivel    | Controles requeridos                                                                              |
|----------|---------------------------------------------------------------------------------------------------|
| normal   | Campo de texto con nombre del tenant (coincidencia exacta)                                        |
| elevated | Campo de texto + checkbox de reconocimiento de advertencias                                       |
| critical | Campo de texto + checkbox + OTP de sesión MFA activa **o** aprobación de segundo actor superadmin |

### 1.6 Riesgo crítico — segundo actor

Cuando `risk_level = critical`, el endpoint de confirmación acepta una de dos variantes:

- `second_factor_type: 'otp'` + `otp_code`: se valida contra Keycloak (`/auth/realms/{realm}/protocol/openid-connect/token/introspect` con el TOTP code).
- `second_factor_type: 'second_actor'` + `second_actor_token`: un JWT válido de un superadmin distinto del solicitante.

Si MFA no está habilitado en el despliegue (var `MFA_ENABLED=false`), la opción OTP no está disponible y se requiere obligatoriamente el segundo actor. Esto se refleja en la respuesta del Paso 1 (`available_second_factors`).

### 1.7 Expiración automática de solicitudes pendientes

Un job periódico (o función lazy en cada petición de confirmación) marca como `expired` las solicitudes cuyo `expires_at < NOW()`. La expiración genera un evento de auditoría con `confirmation_decision: 'expired'` (RF-T04-05, CA-07).

En producción, el job de expiración se ejecuta como acción programada en el scheduling-engine (similar al patrón de `collector.action.ts`). En desarrollo/test, la expiración se evalúa de forma lazy en el endpoint de confirmación.

### 1.8 Registro en auditoría

La capa de auditoría existente (`services/backup-status/src/audit/audit-trail.ts`) se extiende con nuevos tipos de evento y nuevos campos opcionales. No se modifica el esquema existente de `backup_audit_events`; los campos adicionales se almacenan en la columna `detail` (JSON serializado, límite 4096 bytes ya gestionado por `audit-trail.ts`).

Los nuevos tipos de evento de auditoría son:
- `restore.confirmation_pending` — Paso 1 aceptado, token generado.
- `restore.confirmed` — Confirmación exitosa, operación despachada.
- `restore.aborted` — El actor canceló desde el diálogo.
- `restore.confirmation_expired` — TTL expiró sin confirmación.

### 1.9 Aislamiento multi-tenant

El token de confirmación incluye `tenant_id` en el registro de la DB. El endpoint de confirmación valida que el `tenant_id` del actor coincida con el del token (o que sea superadmin con acceso global). Ningún precheck cruza información entre tenants (RN-08, CA-11).

---

## 2. Migración de base de datos

### Archivo: `services/backup-status/src/db/migrations/004_restore_confirmations.sql`

```sql
-- Migration: 004_restore_confirmations
-- Feature: US-BKP-01-T04 — Confirmaciones reforzadas y prechecks antes de restauraciones
-- Date: 2026-04-01

-- Nuevos tipos de evento de auditoría para el trail existente
ALTER TYPE backup_audit_event_type ADD VALUE IF NOT EXISTS 'restore.confirmation_pending';
ALTER TYPE backup_audit_event_type ADD VALUE IF NOT EXISTS 'restore.confirmed';
ALTER TYPE backup_audit_event_type ADD VALUE IF NOT EXISTS 'restore.aborted';
ALTER TYPE backup_audit_event_type ADD VALUE IF NOT EXISTS 'restore.confirmation_expired';

-- Tabla de solicitudes de confirmación pendientes
CREATE TYPE restore_confirmation_status AS ENUM (
  'pending_confirmation',
  'confirmed',
  'aborted',
  'expired',
  'rejected'
);

CREATE TYPE restore_risk_level AS ENUM (
  'normal',
  'elevated',
  'critical'
);

CREATE TYPE restore_confirmation_decision AS ENUM (
  'confirmed',
  'aborted',
  'expired'
);

CREATE TABLE restore_confirmation_requests (
  id                    UUID                          PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash            TEXT                          NOT NULL UNIQUE,  -- SHA-256 del token en hex
  tenant_id             TEXT                          NOT NULL,
  component_type        TEXT                          NOT NULL,
  instance_id           TEXT                          NOT NULL,
  snapshot_id           TEXT                          NOT NULL,
  requester_id          TEXT                          NOT NULL,
  requester_role        TEXT                          NOT NULL,
  scope                 TEXT                          NOT NULL DEFAULT 'partial', -- 'partial' | 'full'
  risk_level            restore_risk_level            NOT NULL DEFAULT 'normal',
  status                restore_confirmation_status   NOT NULL DEFAULT 'pending_confirmation',
  prechecks_result      JSONB                         NOT NULL DEFAULT '[]',
  warnings_shown        JSONB                         NOT NULL DEFAULT '[]',
  available_second_factors JSONB                      NOT NULL DEFAULT '[]',
  decision              restore_confirmation_decision,
  decision_at           TIMESTAMPTZ,
  second_factor_type    TEXT,
  second_actor_id       TEXT,
  operation_id          UUID,   -- FK a backup_operations, sólo tras confirmación exitosa
  expires_at            TIMESTAMPTZ                   NOT NULL,
  created_at            TIMESTAMPTZ                   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rcr_token_hash
  ON restore_confirmation_requests(token_hash);

CREATE INDEX idx_rcr_tenant_pending
  ON restore_confirmation_requests(tenant_id, status, expires_at)
  WHERE status = 'pending_confirmation';

CREATE INDEX idx_rcr_requester
  ON restore_confirmation_requests(requester_id, created_at DESC);

CREATE INDEX idx_rcr_expires_pending
  ON restore_confirmation_requests(expires_at)
  WHERE status = 'pending_confirmation';

-- Rollback:
-- DROP TABLE restore_confirmation_requests;
-- DROP TYPE restore_confirmation_decision;
-- DROP TYPE restore_risk_level;
-- DROP TYPE restore_confirmation_status;
-- NOTA: no se puede revertir ADD VALUE en un ENUM en PostgreSQL sin recrear el tipo.
-- Ver rollback manual en sección 9.
```

**Notas sobre el rollback del ENUM:** PostgreSQL no soporta `REMOVE VALUE` en enumerados existentes. El rollback de los valores de `backup_audit_event_type` requiere recrear el tipo con los valores originales, actualizar las columnas dependientes y los índices. El procedimiento completo se documenta en la sección 9 (Plan de rollback).

---

## 3. Estructura de módulos

Todos los archivos nuevos o modificados están dentro de `services/backup-status/src/` salvo indicación explícita.

```text
services/backup-status/src/
├── confirmations/                           ← NUEVO módulo principal
│   ├── confirmations.types.ts               ← Tipos TS: RiskLevel, PrecheckResult, ConfirmationRequest, etc.
│   ├── confirmations.repository.ts          ← CRUD sobre restore_confirmation_requests
│   ├── confirmations.service.ts             ← Orquestador: initiate(), confirm(), abort(), expireStale()
│   ├── risk-calculator.ts                   ← Función pura calculateRiskLevel()
│   ├── prechecks/
│   │   ├── index.ts                         ← runAllPrechecks(): ejecuta todos en paralelo con timeout
│   │   ├── precheck.types.ts                ← PrecheckResult, PrecheckResultCode
│   │   ├── active-restore.precheck.ts       ← Comprueba restore activo concurrente
│   │   ├── snapshot-exists.precheck.ts      ← Valida que el snapshot existe y está disponible
│   │   ├── snapshot-age.precheck.ts         ← Antigüedad del snapshot vs. umbral configurado
│   │   ├── newer-snapshots.precheck.ts      ← Detecta snapshots más recientes que el seleccionado
│   │   ├── active-connections.precheck.ts   ← Consulta al adaptador operaciones activas (degradable)
│   │   └── operational-hours.precheck.ts   ← Horario operativo vs. configuración
│   ├── second-factor/
│   │   ├── otp-verifier.ts                  ← Validación OTP via Keycloak
│   │   └── second-actor-verifier.ts         ← Validación JWT segundo actor
│   └── expiry-job.action.ts                 ← Acción OpenWhisk para marcar expired solicitudes vencidas
├── api/
│   ├── backup-status.action.ts              ← Sin cambios (T01)
│   ├── backup-status.auth.ts                ← Sin cambios
│   ├── backup-status.schema.ts              ← Sin cambios
│   ├── initiate-restore.action.ts           ← NUEVO: reemplaza trigger-restore.action.ts (renombrado)
│   └── confirm-restore.action.ts            ← NUEVO: Paso 2 del flujo
├── operations/
│   ├── trigger-restore.action.ts            ← MODIFICADO: ahora llama a confirmations.service.initiate()
│   └── ...                                  ← resto sin cambios
├── audit/
│   └── audit-trail.types.ts                 ← MODIFICADO: añade 4 nuevos AuditEventType
└── ...

apps/web-console/src/
├── components/backup/
│   ├── RestoreConfirmationDialog.tsx         ← NUEVO: modal de confirmación reforzada
│   ├── PrecheckResultList.tsx               ← NUEVO: lista de resultados de precheck con iconos
│   ├── RiskLevelBadge.tsx                   ← NUEVO: badge de nivel de riesgo
│   ├── TenantNameInput.tsx                  ← NUEVO: input de confirmación deliberada
│   ├── CriticalConfirmationPanel.tsx        ← NUEVO: panel OTP / segundo actor (sólo riesgo crítico)
│   └── TriggerBackupButton.tsx              ← Sin cambios
├── hooks/
│   ├── useTriggerRestore.ts                 ← MODIFICADO: ahora inicia Paso 1, expone prechecks
│   ├── useConfirmRestore.ts                 ← NUEVO: ejecuta Paso 2
│   └── useAbortRestore.ts                   ← NUEVO: abort de solicitud pendiente
└── services/
    └── backupOperationsApi.ts               ← MODIFICADO: nuevos métodos initiateRestore(), confirmRestore(), abortRestore()
```

---

## 4. Contrato de API

### 4.1 `POST /v1/backup/restore` — Iniciar solicitud de restore (Paso 1)

**Cambio respecto a T02:** este endpoint ya no despacha al adaptador. Ejecuta prechecks y retorna un token de confirmación.

**Request body** (sin cambios estructurales):

```json
{
  "tenant_id": "tenant-abc",
  "component_type": "postgresql",
  "instance_id": "pg-main-001",
  "snapshot_id": "snap-20260401-001",
  "scope": "partial"
}
```

`scope` es opcional; por defecto `partial`. El valor `full` activa lógica de riesgo crítico automáticamente.

**Response 202** (solicitud pendiente de confirmación):

```json
{
  "schema_version": "2",
  "confirmation_token": "<base64url-opaque-token>",
  "confirmation_request_id": "<uuid>",
  "expires_at": "2026-04-01T09:26:00Z",
  "ttl_seconds": 300,
  "risk_level": "elevated",
  "available_second_factors": [],
  "prechecks": [
    {
      "code": "active_restore_check",
      "result": "ok",
      "message": "No hay operaciones de restauración activas para este componente."
    },
    {
      "code": "snapshot_exists_check",
      "result": "ok",
      "message": "El snapshot existe y está disponible."
    },
    {
      "code": "snapshot_age_check",
      "result": "warning",
      "message": "El snapshot tiene 72 horas de antigüedad, superior al umbral de 48 horas configurado.",
      "metadata": { "age_hours": 72, "threshold_hours": 48 }
    },
    {
      "code": "newer_snapshots_check",
      "result": "warning",
      "message": "Existen 2 snapshots más recientes que el seleccionado.",
      "metadata": { "newer_count": 2 }
    },
    {
      "code": "active_connections_check",
      "result": "ok",
      "message": "No se detectan conexiones activas inusuales."
    },
    {
      "code": "operational_hours_check",
      "result": "ok",
      "message": "La solicitud se realiza dentro del horario operativo."
    }
  ],
  "warnings": [
    "El snapshot tiene 72 horas de antigüedad, superior al umbral configurado.",
    "Existen snapshots más recientes que el seleccionado."
  ],
  "target": {
    "tenant_id": "tenant-abc",
    "tenant_name": "Tenant ABC",
    "component_type": "postgresql",
    "instance_id": "pg-main-001",
    "snapshot_id": "snap-20260401-001",
    "snapshot_created_at": "2026-03-29T09:00:00Z",
    "snapshot_age_hours": 72
  }
}
```

**Response 422** (precheck bloqueante — no se genera token):

```json
{
  "schema_version": "2",
  "error": "blocking_precheck_failed",
  "blocking_checks": [
    {
      "code": "active_restore_check",
      "result": "blocking_error",
      "message": "Ya existe una operación de restauración activa para este componente.",
      "metadata": { "conflict_operation_id": "<uuid>" }
    }
  ]
}
```

**Response 400/401/403/500**: igual que en T02.

**Compatibilidad hacia atrás:** el campo `schema_version` pasa de `"1"` implícito a `"2"` explícito. Los consumidores de T02 que lean `operation_id` directamente en la respuesta 202 deberán actualizarse. Se documenta el breaking change en el CHANGELOG del servicio.

---

### 4.2 `POST /v1/backup/restore/confirm` — Confirmar o abortar (Paso 2)

**Request body — confirmar (riesgo normal o elevated):**

```json
{
  "confirmation_token": "<base64url-opaque-token>",
  "confirmed": true,
  "tenant_name_confirmation": "Tenant ABC",
  "acknowledge_warnings": true
}
```

**Request body — confirmar (riesgo crítico, vía OTP):**

```json
{
  "confirmation_token": "<base64url-opaque-token>",
  "confirmed": true,
  "tenant_name_confirmation": "Tenant ABC",
  "acknowledge_warnings": true,
  "second_factor_type": "otp",
  "otp_code": "123456"
}
```

**Request body — confirmar (riesgo crítico, vía segundo actor):**

```json
{
  "confirmation_token": "<base64url-opaque-token>",
  "confirmed": true,
  "tenant_name_confirmation": "Tenant ABC",
  "acknowledge_warnings": true,
  "second_factor_type": "second_actor",
  "second_actor_token": "<bearer-jwt-superadmin>"
}
```

**Request body — abortar:**

```json
{
  "confirmation_token": "<base64url-opaque-token>",
  "confirmed": false
}
```

**Response 202** (confirmación exitosa, operación despachada):

```json
{
  "schema_version": "2",
  "operation_id": "<uuid>",
  "status": "accepted",
  "accepted_at": "2026-04-01T09:21:00Z"
}
```

**Response 200** (abort registrado):

```json
{
  "schema_version": "2",
  "status": "aborted",
  "confirmation_request_id": "<uuid>"
}
```

**Response 409** — token ya utilizado o solicitud no en estado `pending_confirmation`:

```json
{ "error": "confirmation_request_not_pending", "status": "confirmed" }
```

**Response 410** — token expirado:

```json
{ "error": "confirmation_token_expired", "expired_at": "2026-04-01T09:26:00Z" }
```

**Response 422** — revalidación fallida al confirmar (snapshot ya no existe):

```json
{ "error": "snapshot_no_longer_available", "snapshot_id": "snap-20260401-001" }
```

**Response 422** — nombre del tenant incorrecto:

```json
{ "error": "tenant_name_confirmation_mismatch" }
```

**Response 422** — OTP inválido o segundo actor no autorizado:

```json
{ "error": "second_factor_verification_failed", "detail": "otp_invalid" }
```

---

### 4.3 `GET /v1/backup/restore/confirm/:confirmation_request_id` — Consulta estado de solicitud pendiente

Permite a la consola o al solicitante consultar el estado actual de una solicitud pendiente (útil para polling ligero desde la consola mientras el modal está abierto).

**Response 200:**

```json
{
  "schema_version": "2",
  "id": "<uuid>",
  "status": "pending_confirmation",
  "risk_level": "elevated",
  "expires_at": "2026-04-01T09:26:00Z",
  "created_at": "2026-04-01T09:21:00Z"
}
```

Acceso restringido: sólo el solicitante o un superadmin con acceso al tenant.

---

## 5. Configuración de infraestructura

### 5.1 Variables de entorno nuevas para `backup-status`

| Variable                               | Tipo    | Default      | Descripción                                                                 |
|----------------------------------------|---------|--------------|-----------------------------------------------------------------------------|
| `CONFIRMATION_TTL_SECONDS`             | integer | `300`        | TTL del token de confirmación en segundos (5 min por defecto).              |
| `PRECHECK_TIMEOUT_MS`                  | integer | `10000`      | Timeout máximo para la ejecución de todos los prechecks (ms).               |
| `PRECHECK_SNAPSHOT_AGE_WARNING_HOURS`  | integer | `48`         | Umbral de antigüedad del snapshot para generar advertencia (horas).         |
| `PRECHECK_OPERATIONAL_HOURS_START`     | string  | `"08:00"`    | Inicio del horario operativo (formato HH:MM, UTC).                          |
| `PRECHECK_OPERATIONAL_HOURS_END`       | string  | `"20:00"`    | Fin del horario operativo (formato HH:MM, UTC).                             |
| `PRECHECK_OPERATIONAL_HOURS_ENABLED`   | boolean | `true`       | Activar/desactivar la verificación de horario operativo.                    |
| `MFA_ENABLED`                          | boolean | `true`       | Si es `false`, la opción OTP no está disponible; se requiere segundo actor. |
| `KEYCLOAK_OTP_VERIFY_URL`              | string  | —            | URL del endpoint de Keycloak para verificar TOTP codes.                     |
| `EXPIRY_JOB_ENABLED`                   | boolean | `true`       | Activar el job de expiración de solicitudes vencidas.                       |
| `EXPIRY_JOB_INTERVAL_SECONDS`          | integer | `60`         | Intervalo de ejecución del job de expiración.                               |
| `CRITICAL_RISK_MULTI_WARNING_THRESHOLD`| integer | `3`          | Número de advertencias simultáneas que elevan el riesgo a `critical`.       |

### 5.2 ConfigMap / Secret en Helm

Se añade al chart `helm/backup-status/` (o al chart unificado si existe) un bloque de `env` con las variables anteriores. Las que contienen credenciales (`KEYCLOAK_OTP_VERIFY_URL` con credenciales embebidas si aplica) se referencian desde un `Secret`.

### 5.3 Acción de expiración en scheduling-engine

Se registra una nueva acción OpenWhisk `backup-status/expire-restore-confirmations` con schedule `*/1 * * * *` (cada minuto) en el manifiesto del scheduling-engine. La acción llama a `expiry-job.action.ts`, que ejecuta `confirmations.service.expireStale()` y emite eventos de auditoría por cada solicitud expirada.

---

## 6. Componentes frontend

### 6.1 `RestoreConfirmationDialog.tsx`

Modal bloqueante que se muestra al iniciar un restore. Recibe como props la respuesta del Paso 1 (`precheckResponse`) y callbacks `onConfirm` / `onAbort`.

**Estructura interna del modal:**
- **Cabecera**: título "Confirmar restauración destructiva" + badge `RiskLevelBadge`.
- **Bloque de objetivo**: tenant, componente, instancia, snapshot (timestamp + antigüedad en horas legible).
- **Bloque de prechecks**: componente `PrecheckResultList` con cada precheck y su icono (✅ OK / ⚠️ advertencia / 🚫 error bloqueante).
- **Bloque de confirmación deliberada**: componente `TenantNameInput` (riesgo normal en adelante) + checkbox de reconocimiento (riesgo elevated en adelante) + `CriticalConfirmationPanel` (solo riesgo crítico).
- **Pie**: botón "Cancelar" (siempre activo) + botón "Confirmar restauración" (deshabilitado si hay blocking_errors o campos incompletos).

El botón de confirmación **permanece deshabilitado** mientras:
- existan prechecks con `result: 'blocking_error'`,
- el campo de nombre del tenant no coincida exactamente con `target.tenant_name`,
- el checkbox de advertencias no esté marcado (riesgo elevated o crítico),
- el campo OTP esté vacío o el segundo actor no haya dado su aprobación (riesgo crítico).

### 6.2 `PrecheckResultList.tsx`

Lista de resultados de prechecks. Cada ítem muestra: icono de estado (OK/warning/blocking), código legible localizado, mensaje descriptivo, y metadata adicional si existe (p.ej., "72 horas / umbral 48 horas"). Los ítems bloqueantes se destacan con fondo rojo claro.

### 6.3 `RiskLevelBadge.tsx`

Badge de color según nivel de riesgo:
- `normal` → verde/gris (sin énfasis)
- `elevated` → naranja/ámbar
- `critical` → rojo con icono de advertencia

### 6.4 `TenantNameInput.tsx`

Input controlado que valida en tiempo real si el texto introducido coincide exactamente con `target.tenant_name`. Muestra un check verde cuando coincide. No es case-insensitive: la coincidencia es exacta para evitar errores de fat-finger (RN-04).

### 6.5 `CriticalConfirmationPanel.tsx`

Panel visible sólo cuando `risk_level === 'critical'`. Muestra las opciones disponibles según `available_second_factors`:
- Tab "Código MFA (OTP)": input numérico de 6 dígitos.
- Tab "Aprobación de segundo administrador": instrucciones + campo para que el segundo actor introduzca su credencial (token de sesión, o flujo de aprobación asíncrona — MVP: token).

En MVP, el flujo de segundo actor es síncrono: el segundo superadmin debe estar presente y proporcionar su token JWT activo. Una iteración posterior puede implementar el flujo de aprobación asíncrona (notificación + aprobación remota).

### 6.6 Modificación de `useTriggerRestore.ts`

El hook se refactoriza para manejar el flujo de dos pasos:

```typescript
// Estado expuesto
interface UseTriggerRestoreResult {
  initiate: (body: InitiateRestoreBody, token: string) => Promise<void>
  confirm: (opts: ConfirmRestoreOpts) => Promise<void>
  abort: () => Promise<void>
  phase: 'idle' | 'loading' | 'pending_confirmation' | 'confirming' | 'dispatched' | 'error'
  precheckResponse: InitiateRestoreResponse | null
  operationId: string | null
  error: Error | null
}
```

El estado `pending_confirmation` activa la apertura del `RestoreConfirmationDialog`. El estado `dispatched` cierra el modal y muestra la notificación de éxito con el `operationId`.

### 6.7 Integración en `BackupStatusDetail.tsx`

El componente existente `BackupStatusDetail.tsx` llama al hook refactorizado. Cuando `phase === 'pending_confirmation'`, renderiza `<RestoreConfirmationDialog>` superpuesto. Nada más cambia en la lógica de navegación existente.

---

## 7. Estrategia de tests

### 7.1 Tests unitarios (`services/backup-status/test/`)

| Archivo de test                                   | Cubre                                                                           |
|---------------------------------------------------|---------------------------------------------------------------------------------|
| `confirmations/risk-calculator.test.ts`           | `calculateRiskLevel()` con todas las combinaciones de parámetros.               |
| `confirmations/prechecks/active-restore.test.ts`  | Precheck de restore activo con mock del repositorio.                            |
| `confirmations/prechecks/snapshot-exists.test.ts` | Snapshot existente, no existente, no disponible.                                |
| `confirmations/prechecks/snapshot-age.test.ts`    | Snapshot reciente (OK), antigüedad en umbral (OK), superando umbral (warning).  |
| `confirmations/prechecks/newer-snapshots.test.ts` | Sin snapshots más recientes (OK), con snapshots más recientes (warning).        |
| `confirmations/prechecks/operational-hours.test.ts`| Dentro del horario (OK), fuera del horario (warning), feature flag desactivado. |
| `confirmations/prechecks/index.test.ts`           | Ejecución en paralelo, timeout parcial → warning `precheck_timeout`.            |
| `confirmations/confirmations.service.test.ts`     | `initiate()`, `confirm()`, `abort()`, `expireStale()` con mocks de repo y audit.|
| `confirmations/second-factor/otp-verifier.test.ts`| OTP válido, OTP inválido, Keycloak no disponible.                               |
| `confirmations/second-factor/second-actor.test.ts`| JWT válido de superadmin, mismo actor rechazado, rol insuficiente rechazado.    |

### 7.2 Tests de integración (`services/backup-status/test/integration/`)

Requieren una instancia de PostgreSQL de test (Docker Compose de la suite de tests existente).

| Escenario                                                              | CA cubiertos        |
|------------------------------------------------------------------------|---------------------|
| Flujo completo: initiate → confirm (riesgo normal)                     | CA-01, CA-02, CA-05 |
| Initiate con precheck bloqueante → no se genera token                  | CA-03               |
| Initiate con advertencias → confirm con acknowledge_warnings           | CA-04               |
| Confirm con token expirado → error 410                                 | CA-07               |
| Confirm → revalidación falla (snapshot eliminado) → error 422          | CA-08               |
| Flujo completo: initiate → confirm (riesgo crítico, OTP)               | CA-06               |
| Flujo completo: initiate → confirm (riesgo crítico, segundo actor)     | CA-06               |
| Initiate → abort → auditoría con decision=aborted                      | CA-10               |
| Verificación de aislamiento: prechecks no cruzan tenants               | CA-11               |
| Trigger backup → no pasa por flujo de confirmación                     | CA-12               |
| Cada decisión genera evento de auditoría con campos obligatorios        | CA-09               |

### 7.3 Tests E2E (`tests/e2e/` o suite Playwright existente)

| Escenario E2E                                                          | CA cubiertos        |
|------------------------------------------------------------------------|---------------------|
| Iniciar restore desde BackupStatusDetail → modal aparece antes del despacho | CA-01          |
| Campo de nombre de tenant bloquea botón si es incorrecto               | CA-05               |
| Advertencias visibles en modal, proceder con acknowledge               | CA-04               |
| Precheck bloqueante → botón deshabilitado, sin despacho                | CA-03               |
| Abort desde modal → evento de auditoría visible en consola             | CA-10               |
| Backup bajo demanda → no aparece modal de confirmación                 | CA-12               |

Los tests E2E usan mocks de la API REST (MSW o similar) para simular respuestas de prechecks con distintos niveles de riesgo sin necesidad de una instancia de backend real.

### 7.4 Cobertura mínima esperada

- Módulo `confirmations/`: ≥ 90% líneas.
- Módulo `api/` (endpoints nuevos): ≥ 85% líneas.
- Componentes React nuevos: ≥ 80% líneas (vitest + @testing-library/react).

---

## 8. Mapeo de criterios de aceptación a implementación

| CA   | Criterio                                                                                     | Implementado en                                                                                                                    |
|------|----------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------|
| CA-01 | Diálogo de confirmación antes del despacho al adaptador                                    | `trigger-restore.action.ts` refactorizado → llama a `confirmations.service.initiate()` sin despachar; frontend abre modal         |
| CA-02 | API devuelve token + prechecks sin despachar; despacha sólo tras confirmación              | `POST /v1/backup/restore` (Paso 1) + `POST /v1/backup/restore/confirm` (Paso 2)                                                   |
| CA-03 | Precheck bloqueante → botón deshabilitado, API no genera token                             | `runAllPrechecks()` + lógica en `confirmations.service.initiate()` + `RestoreConfirmationDialog` (botón disabled)                 |
| CA-04 | Advertencias no bloqueantes → actor puede proceder con confirmación deliberada             | `PrecheckResultList` muestra warnings; `acknowledge_warnings` checkbox; `confirmations.service.confirm()` acepta si no hay blocking |
| CA-05 | Confirmación requiere nombre del tenant exacto                                             | `TenantNameInput` + validación en `confirmations.service.confirm()` (server-side)                                                 |
| CA-06 | Riesgo crítico no se despacha sin segundo factor                                           | `confirmations.service.confirm()` verifica `risk_level === 'critical'` → llama `otp-verifier` o `second-actor-verifier`          |
| CA-07 | Token expira tras TTL; confirmación con token expirado → rechazo                          | `restore_confirmation_requests.expires_at` + validación en `confirmations.service.confirm()` → 410                               |
| CA-08 | Revalidación del snapshot al confirmar                                                     | `confirmations.service.confirm()` llama `snapshot-exists.precheck` antes de crear la operación                                   |
| CA-09 | Cada decisión genera evento de auditoría con campos obligatorios                           | `emitAuditEvent()` con `detail` JSON serializado (prechecks, risk_level, warnings, decision) en cada transición                  |
| CA-10 | Abort genera auditoría con decision=aborted y advertencias presentadas                    | `confirmations.service.abort()` → `emitAuditEvent` con `eventType: 'restore.aborted'`                                           |
| CA-11 | Prechecks no revelan info de otros tenants                                                 | Todos los prechecks reciben `tenant_id` explícito y filtran por él; token vinculado a `tenant_id`                                |
| CA-12 | Backups bajo demanda no pasan por flujo de confirmación                                   | `trigger-backup.action.ts` no se modifica; `useTriggerBackup.ts` no se modifica                                                  |

---

## 9. Plan de rollback

### 9.1 Rollback de código

El rollback de código es estándar: revertir los commits de esta rama en `main` y redesplegar `backup-status` y `web-console` desde el estado anterior.

Dado que el Paso 1 del nuevo flujo retorna `schema_version: "2"` y el endpoint `POST /v1/backup/restore` ya no despacha directamente, los consumidores API construidos sobre T02 que esperen `operation_id` en la respuesta 202 del restore recibirán un error hasta que sean actualizados o hasta que se revierta el servicio. Se documenta el breaking change.

### 9.2 Rollback de migraciones de DB

**Tabla `restore_confirmation_requests`:**

```sql
DROP TABLE IF EXISTS restore_confirmation_requests;
DROP TYPE IF EXISTS restore_confirmation_decision;
DROP TYPE IF EXISTS restore_risk_level;
DROP TYPE IF EXISTS restore_confirmation_status;
```

**Valores añadidos al ENUM `backup_audit_event_type`:**

PostgreSQL no soporta `REMOVE VALUE` en enumerados. Si es necesario eliminar los cuatro valores añadidos, el procedimiento es:

```sql
-- 1. Crear el nuevo tipo sin los valores T04
CREATE TYPE backup_audit_event_type_v2 AS ENUM (
  'backup.requested', 'backup.started', 'backup.completed', 'backup.failed', 'backup.rejected',
  'restore.requested', 'restore.started', 'restore.completed', 'restore.failed', 'restore.rejected'
);

-- 2. Eliminar los eventos de auditoría con tipos T04 (o reclasificarlos)
DELETE FROM backup_audit_events
WHERE event_type IN (
  'restore.confirmation_pending', 'restore.confirmed',
  'restore.aborted', 'restore.confirmation_expired'
);

-- 3. Cambiar el tipo de la columna
ALTER TABLE backup_audit_events
  ALTER COLUMN event_type TYPE backup_audit_event_type_v2
  USING event_type::TEXT::backup_audit_event_type_v2;

-- 4. Eliminar el tipo original y renombrar el nuevo
DROP TYPE backup_audit_event_type;
ALTER TYPE backup_audit_event_type_v2 RENAME TO backup_audit_event_type;
```

Este procedimiento requiere una ventana de mantenimiento breve (lock sobre `backup_audit_events`). En producción, coordinar con el equipo de plataforma.

### 9.3 Feature flag de emergencia

Se añade la variable de entorno `RESTORE_CONFIRMATION_ENABLED` (boolean, default `true`). Si se establece a `false`, `trigger-restore.action.ts` vuelve al comportamiento de T02: despacha directamente sin prechecks ni token. Este flag es **sólo para emergencias operativas**; su uso se registra en auditoría con un campo adicional `confirmation_bypassed: true`.

---

## 10. Consideraciones operativas y de monitorización

- **Alerta de solicitudes expiradas acumuladas**: si la cola de solicitudes en estado `pending_confirmation` supera 50 registros, emitir alerta. Puede indicar que el job de expiración no está corriendo.
- **Métrica de tasa de abort**: registrar el ratio `aborts / (confirms + aborts)` por semana. Un ratio superior al 30% puede indicar que los prechecks generan demasiada fricción o que los umbrales de riesgo son demasiado agresivos.
- **Tasa de advertencias por tipo de precheck**: exportar métricas por `precheck_code` para detectar prechecks que generan ruido sistemático (candidatos a ajuste de umbral).
- **Latencia de prechecks**: percentil p99 de `runAllPrechecks()` debe mantenerse por debajo del `PRECHECK_TIMEOUT_MS` configurado. Si supera el umbral habitualmente, revisar el precheck más lento.

---

## 11. Orden de implementación recomendado

1. **DB migration** (`004_restore_confirmations.sql`) — ejecutar en entorno de desarrollo.
2. **`confirmations.types.ts`** — definir todos los tipos TypeScript antes de implementar el resto.
3. **`confirmations.repository.ts`** — CRUD sobre la nueva tabla.
4. **`prechecks/`** — cada precheck individual + `index.ts` con timeout.
5. **`risk-calculator.ts`** — función pura, sin dependencias de DB.
6. **`second-factor/`** — verificadores OTP y segundo actor.
7. **`confirmations.service.ts`** — orquestador que integra todo lo anterior.
8. **`api/initiate-restore.action.ts`** y **`api/confirm-restore.action.ts`** — endpoints HTTP.
9. **Modificar `operations/trigger-restore.action.ts`** — delegar a `confirmations.service.initiate()`.
10. **Modificar `audit/audit-trail.types.ts`** — añadir nuevos AuditEventType.
11. **`expiry-job.action.ts`** — job de expiración.
12. **Tests unitarios y de integración** — en paralelo con los pasos 3-11.
13. **Frontend**: `backupOperationsApi.ts` → hooks → componentes → integración en `BackupStatusDetail`.
14. **Tests E2E** — tras integrar el frontend.
15. **Documentación de breaking change** en `CHANGELOG.md` del servicio.
