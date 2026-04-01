# Tasks — US-BKP-01-T04: Confirmaciones reforzadas y prechecks antes de restauraciones destructivas

| Campo              | Valor                                                              |
|--------------------|--------------------------------------------------------------------|
| **Task ID**        | US-BKP-01-T04                                                      |
| **Spec**           | `specs/112-backup-restore-confirmations/spec.md`                   |
| **Plan**           | `specs/112-backup-restore-confirmations/plan.md`                   |
| **Rama**           | `112-backup-restore-confirmations`                                 |
| **Servicio**       | `services/backup-status` (`@in-atelier/backup-status`)             |
| **Frontend**       | `apps/web-console`                                                 |
| **Dependencias**   | PR#156 (T01), PR#157 (T02), PR#158 (T03) — todas merged           |

---

## Fase 1 — Migración de base de datos

- [ ] T-01 Crear el archivo de migración SQL `services/backup-status/src/db/migrations/004_restore_confirmations.sql` con:
  - Extensión del ENUM `backup_audit_event_type` con los cuatro nuevos valores: `restore.confirmation_pending`, `restore.confirmed`, `restore.aborted`, `restore.confirmation_expired`.
  - Definición del ENUM `restore_confirmation_status` (`pending_confirmation`, `confirmed`, `aborted`, `expired`, `rejected`).
  - Definición del ENUM `restore_risk_level` (`normal`, `elevated`, `critical`).
  - Definición del ENUM `restore_confirmation_decision` (`confirmed`, `aborted`, `expired`).
  - Creación de la tabla `restore_confirmation_requests` con todas las columnas especificadas en la sección 2 del plan (incluyendo `id`, `token_hash`, `tenant_id`, `component_type`, `instance_id`, `snapshot_id`, `requester_id`, `requester_role`, `scope`, `risk_level`, `status`, `prechecks_result`, `warnings_shown`, `available_second_factors`, `decision`, `decision_at`, `second_factor_type`, `second_actor_id`, `operation_id`, `expires_at`, `created_at`).
  - Índices: `idx_rcr_token_hash`, `idx_rcr_tenant_pending`, `idx_rcr_requester`, `idx_rcr_expires_pending`.
  - Comentario de rollback documentado al final del archivo.

- [ ] T-02 Ejecutar la migración `004_restore_confirmations.sql` en el entorno de desarrollo local y verificar que la tabla y los tipos se crean correctamente sin errores.

- [ ] T-03 Actualizar el registro de migraciones del servicio (p.ej., `services/backup-status/src/db/migrations/index.ts` o el fichero equivalente que lista las migraciones conocidas) para incluir la entrada `004_restore_confirmations`.

---

## Fase 2 — Tipos TypeScript

- [ ] T-04 Crear `services/backup-status/src/confirmations/precheck.types.ts` con:
  - Tipo `PrecheckResultCode` (unión de todos los códigos posibles: `active_restore_check`, `snapshot_exists_check`, `snapshot_age_check`, `newer_snapshots_check`, `active_connections_check`, `operational_hours_check`, `precheck_timeout`).
  - Interfaz `PrecheckResult` con campos `result: 'ok' | 'warning' | 'blocking_error'`, `code: PrecheckResultCode`, `message: string`, `metadata?: Record<string, unknown>`.
  - Tipo `PrecheckSummary` (array de `PrecheckResult`).

- [ ] T-05 Crear `services/backup-status/src/confirmations/confirmations.types.ts` con:
  - Tipo `RiskLevel`: `'normal' | 'elevated' | 'critical'`.
  - Tipo `ConfirmationStatus`: `'pending_confirmation' | 'confirmed' | 'aborted' | 'expired' | 'rejected'`.
  - Tipo `ConfirmationDecision`: `'confirmed' | 'aborted' | 'expired'`.
  - Tipo `SecondFactorType`: `'otp' | 'second_actor'`.
  - Interfaz `RestoreConfirmationRequest` que modela la fila completa de `restore_confirmation_requests`.
  - Interfaz `InitiateRestorePayload` (body del Paso 1: `tenant_id`, `component_type`, `instance_id`, `snapshot_id`, `scope?`).
  - Interfaz `InitiateRestoreResponse` (respuesta 202 del Paso 1 tal como está definida en la sección 4.1 del plan, incluyendo `schema_version`, `confirmation_token`, `confirmation_request_id`, `expires_at`, `ttl_seconds`, `risk_level`, `available_second_factors`, `prechecks`, `warnings`, `target`).
  - Interfaz `ConfirmRestorePayload` con todos los campos del Paso 2 (incluyendo variantes para OTP, segundo actor y abort).
  - Interfaz `ConfirmRestoreResponse` (respuesta 202 de confirmación exitosa y 200 de abort).
  - Interfaz `ConfirmationStatusResponse` (respuesta del GET de estado de solicitud pendiente).
  - Interfaz `RiskCalculatorInput` con `scope`, `precheckResults`, `snapshotAgeMs`, `requestedAt`, `config`.
  - Interfaz `RiskCalculatorConfig` con `snapshotAgeWarningMs`, `criticalMultiWarningThreshold`, `operationalHoursEnabled`, `operationalHoursStart`, `operationalHoursEnd`.

---

## Fase 3 — Repositorio

- [ ] T-06 Crear `services/backup-status/src/confirmations/confirmations.repository.ts` con los métodos:
  - `create(data: Omit<RestoreConfirmationRequest, 'id' | 'created_at'>): Promise<RestoreConfirmationRequest>` — inserta una nueva fila en `restore_confirmation_requests`.
  - `findByTokenHash(tokenHash: string): Promise<RestoreConfirmationRequest | null>` — busca por `token_hash`.
  - `findById(id: string): Promise<RestoreConfirmationRequest | null>` — busca por `id` (UUID).
  - `updateStatus(id: string, patch: Partial<Pick<RestoreConfirmationRequest, 'status' | 'decision' | 'decision_at' | 'second_factor_type' | 'second_actor_id' | 'operation_id'>>): Promise<void>` — actualiza estado y campos de decisión.
  - `findExpiredPending(now: Date): Promise<RestoreConfirmationRequest[]>` — retorna todas las filas con `status = 'pending_confirmation'` y `expires_at < now`.
  - `countPendingByTenantAndComponent(tenantId: string, componentType: string, instanceId: string): Promise<number>` — usado por el precheck de restore activo concurrente.

---

## Fase 4 — Módulo de prechecks

- [ ] T-07 Crear `services/backup-status/src/confirmations/prechecks/active-restore.precheck.ts`:
  - Función `activeRestorePrecheck(tenantId, componentType, instanceId, repo)` que consulta operaciones activas de restore para el mismo componente-instancia-tenant.
  - Retorna `blocking_error` con código `active_restore_check` si existe una operación activa, `ok` en caso contrario.
  - El campo `metadata` incluye `conflict_operation_id` cuando hay bloqueo.

- [ ] T-08 Crear `services/backup-status/src/confirmations/prechecks/snapshot-exists.precheck.ts`:
  - Función `snapshotExistsPrecheck(tenantId, componentType, instanceId, snapshotId, adapterClient)` que valida que el snapshot existe y está en estado disponible.
  - Retorna `blocking_error` con código `snapshot_exists_check` si no existe o no está disponible, `ok` si existe.
  - Si el adaptador no responde, retorna `warning` con código `snapshot_exists_check` y mensaje descriptivo (degradación).

- [ ] T-09 Crear `services/backup-status/src/confirmations/prechecks/snapshot-age.precheck.ts`:
  - Función `snapshotAgePrecheck(snapshotCreatedAt, thresholdMs)` que calcula la antigüedad del snapshot.
  - Retorna `warning` con código `snapshot_age_check` si la antigüedad supera el umbral, `ok` en caso contrario.
  - El campo `metadata` incluye `age_hours` y `threshold_hours`.

- [ ] T-10 Crear `services/backup-status/src/confirmations/prechecks/newer-snapshots.precheck.ts`:
  - Función `newerSnapshotsPrecheck(tenantId, componentType, instanceId, snapshotId, snapshotCreatedAt, adapterClient)` que detecta snapshots más recientes que el seleccionado.
  - Retorna `warning` con código `newer_snapshots_check` si existen snapshots más recientes, `ok` en caso contrario.
  - El campo `metadata` incluye `newer_count`.

- [ ] T-11 Crear `services/backup-status/src/confirmations/prechecks/active-connections.precheck.ts`:
  - Función `activeConnectionsPrecheck(tenantId, componentType, instanceId, adapterClient)` que consulta al adaptador las operaciones activas o conexiones del componente.
  - Retorna `warning` con código `active_connections_check` si se detectan conexiones inusuales, `ok` si no hay.
  - Si el adaptador no responde, retorna `warning` con mensaje de degradación (no bloquea).

- [ ] T-12 Crear `services/backup-status/src/confirmations/prechecks/operational-hours.precheck.ts`:
  - Función `operationalHoursPrecheck(requestedAt, config)` que verifica si la solicitud se realiza dentro del horario operativo configurado.
  - Retorna `warning` con código `operational_hours_check` si está fuera del horario, `ok` si está dentro o si el feature está desactivado (`PRECHECK_OPERATIONAL_HOURS_ENABLED=false`).

- [ ] T-13 Crear `services/backup-status/src/confirmations/prechecks/index.ts`:
  - Función `runAllPrechecks(input, deps)` que ejecuta todos los prechecks en paralelo con `Promise.allSettled`.
  - Aplica un timeout global configurable (`PRECHECK_TIMEOUT_MS`). Si un precheck no resuelve antes del timeout, se registra como `warning` con código `precheck_timeout`.
  - Retorna `PrecheckSummary` (array de `PrecheckResult`) con el resultado de todos los prechecks ejecutados.

---

## Fase 5 — Calculador de nivel de riesgo

- [ ] T-14 Crear `services/backup-status/src/confirmations/risk-calculator.ts`:
  - Función pura `calculateRiskLevel(input: RiskCalculatorInput): RiskLevel` sin dependencias de DB ni de red.
  - Implementar la lógica de clasificación especificada en la sección 1.4 del plan:
    - `critical`: alcance `full` (todos los componentes de un tenant) **o** ≥ `CRITICAL_RISK_MULTI_WARNING_THRESHOLD` advertencias simultáneas.
    - `elevated`: snapshot más antiguo que `snapshotAgeWarningMs`, ≥ 1 advertencia, solicitud fuera del horario operativo, o prechecks incompletos por timeout.
    - `normal`: todo lo demás.
  - La función debe ser determinista y testeable sin efectos secundarios.

---

## Fase 6 — Verificadores de segundo factor

- [ ] T-15 Crear `services/backup-status/src/confirmations/second-factor/otp-verifier.ts`:
  - Función `verifyOtp(requesterId, otpCode, keycloakConfig)` que valida el código OTP contra el endpoint de Keycloak configurado en `KEYCLOAK_OTP_VERIFY_URL`.
  - Retorna `{ valid: true }` si el OTP es correcto.
  - Retorna `{ valid: false, detail: 'otp_invalid' | 'keycloak_unavailable' }` en caso de fallo.
  - Si `MFA_ENABLED=false`, la función lanza un error de configuración indicando que OTP no está disponible.

- [ ] T-16 Crear `services/backup-status/src/confirmations/second-factor/second-actor-verifier.ts`:
  - Función `verifySecondActor(requesterId, secondActorToken, tenantId)` que valida el JWT del segundo actor.
  - Verifica que el JWT es válido, que el actor tiene rol superadmin, y que el `second_actor_id` es distinto del `requesterId`.
  - Verifica que el segundo actor tiene permisos sobre `tenantId`.
  - Retorna `{ valid: true, secondActorId: string }` si la validación es correcta.
  - Retorna `{ valid: false, detail: 'same_actor' | 'insufficient_role' | 'token_invalid' | 'no_tenant_access' }` en caso de fallo.

---

## Fase 7 — Servicio de confirmaciones (orquestador)

- [ ] T-17 Crear `services/backup-status/src/confirmations/confirmations.service.ts` con los métodos:
  - `initiate(payload: InitiateRestorePayload, actor: ActorContext): Promise<InitiateRestoreResponse>`:
    - Ejecuta `runAllPrechecks()`.
    - Si hay `blocking_error`, rechaza con 422 sin generar token.
    - Calcula `risk_level` con `calculateRiskLevel()`.
    - Genera el token con `crypto.randomBytes(32)` codificado en base64url.
    - Almacena el hash SHA-256 del token en `restore_confirmation_requests` (TTL = `CONFIRMATION_TTL_SECONDS`).
    - Emite evento de auditoría `restore.confirmation_pending`.
    - Determina `available_second_factors` según `MFA_ENABLED` y `risk_level`.
    - Retorna la respuesta 202 con el token en texto plano (única vez).
  - `confirm(payload: ConfirmRestorePayload, actor: ActorContext): Promise<ConfirmRestoreResponse>`:
    - Busca la solicitud por hash del token recibido.
    - Valida que el estado es `pending_confirmation` y que no ha expirado (→ 409/410 si falla).
    - Valida que `tenant_id` del actor coincide con el de la solicitud (o actor es superadmin con acceso global).
    - Si `confirmed: false`, delega a `abort()`.
    - Valida `tenant_name_confirmation` (coincidencia exacta) → 422 si no coincide.
    - Si `risk_level === 'elevated'`, valida `acknowledge_warnings: true`.
    - Si `risk_level === 'critical'`, llama a `verifyOtp()` o `verifySecondActor()` según `second_factor_type` → 422 si falla.
    - Revalida snapshot con `snapshotExistsPrecheck()` → 422 si ya no existe.
    - Crea la operación en `backup_operations` y despacha al adaptador.
    - Actualiza `restore_confirmation_requests` con `status='confirmed'`, `decision_at`, `operation_id`.
    - Emite evento de auditoría `restore.confirmed`.
    - Retorna respuesta 202 con `operation_id`.
  - `abort(confirmationRequestId: string, actor: ActorContext): Promise<void>`:
    - Valida que la solicitud existe y está en estado `pending_confirmation`.
    - Actualiza `status='aborted'`, `decision='aborted'`, `decision_at=NOW()`.
    - Emite evento de auditoría `restore.aborted` con `warnings_shown`.
  - `expireStale(now: Date): Promise<number>`:
    - Llama a `confirmations.repository.findExpiredPending(now)`.
    - Para cada solicitud expirada, actualiza `status='expired'`, `decision='expired'`, `decision_at=now`.
    - Emite evento de auditoría `restore.confirmation_expired` por cada una.
    - Retorna el número de solicitudes expiradas procesadas.
  - `getStatus(confirmationRequestId: string, actor: ActorContext): Promise<ConfirmationStatusResponse>`:
    - Busca la solicitud por ID.
    - Valida que el actor es el solicitante o un superadmin con acceso al tenant.
    - Retorna `ConfirmationStatusResponse`.

---

## Fase 8 — Endpoints API

- [ ] T-18 Crear `services/backup-status/src/api/initiate-restore.action.ts`:
  - Handler para `POST /v1/backup/restore` (Paso 1 del flujo de dos pasos).
  - Valida el body de la request contra el schema definido (campos: `tenant_id`, `component_type`, `instance_id`, `snapshot_id`, `scope?`).
  - Extrae el contexto de actor desde el token de autenticación (rol, ID, `tenant_id`).
  - Llama a `confirmations.service.initiate()`.
  - Retorna 202 con `InitiateRestoreResponse` si prechecks OK.
  - Retorna 422 con `blocking_checks` si hay precheck bloqueante.
  - Retorna 400/401/403/500 según corresponda.

- [ ] T-19 Crear `services/backup-status/src/api/confirm-restore.action.ts`:
  - Handler para `POST /v1/backup/restore/confirm` (Paso 2 del flujo).
  - Valida el body de la request (campos: `confirmation_token`, `confirmed`, `tenant_name_confirmation?`, `acknowledge_warnings?`, `second_factor_type?`, `otp_code?`, `second_actor_token?`).
  - Llama a `confirmations.service.confirm()`.
  - Retorna 202 si confirmación exitosa, 200 si abort.
  - Retorna 409 si token ya utilizado o no en estado `pending_confirmation`.
  - Retorna 410 si token expirado.
  - Retorna 422 si revalidación falla, nombre de tenant incorrecto, o segundo factor inválido.

- [ ] T-20 Crear o extender el handler para `GET /v1/backup/restore/confirm/:confirmation_request_id`:
  - Valida que el actor tiene acceso a la solicitud (solicitante o superadmin con acceso al tenant).
  - Llama a `confirmations.service.getStatus()`.
  - Retorna 200 con `ConfirmationStatusResponse`.
  - Retorna 403/404 según corresponda.

- [ ] T-21 Modificar `services/backup-status/src/operations/trigger-restore.action.ts` para delegar a `confirmations.service.initiate()` en lugar de despachar directamente al adaptador. El flujo de despacho directo se mueve al `confirmations.service.confirm()`. Añadir soporte para el feature flag `RESTORE_CONFIRMATION_ENABLED`: si `false`, mantener el comportamiento de T02 y registrar `confirmation_bypassed: true` en auditoría.

- [ ] T-22 Actualizar el router de la API (p.ej., `services/backup-status/src/api/router.ts` o el fichero equivalente) para registrar las nuevas rutas:
  - `POST /v1/backup/restore` → `initiate-restore.action.ts`
  - `POST /v1/backup/restore/confirm` → `confirm-restore.action.ts`
  - `GET /v1/backup/restore/confirm/:confirmation_request_id` → handler de estado

- [ ] T-23 Actualizar el schema de validación de la API (`services/backup-status/src/api/backup-status.schema.ts` o fichero equivalente) con los schemas Zod/Joi/JSON Schema para los nuevos bodies de request y response de los endpoints de Paso 1 y Paso 2. Incluir el campo `schema_version: "2"` en las respuestas.

---

## Fase 9 — Auditoría y tipos de auditoría

- [ ] T-24 Modificar `services/backup-status/src/audit/audit-trail.types.ts` para añadir los cuatro nuevos `AuditEventType`:
  - `'restore.confirmation_pending'`
  - `'restore.confirmed'`
  - `'restore.aborted'`
  - `'restore.confirmation_expired'`
  - Añadir interfaz o tipo `RestoreConfirmationAuditDetail` con los campos adicionales del plan sección 5.3: `prechecks_result`, `risk_level`, `warnings_shown`, `confirmation_decision`, `confirmation_timestamp`, `second_factor_method?`, `second_actor_id?`, `confirmation_bypassed?`.

---

## Fase 10 — Job de expiración

- [ ] T-25 Crear `services/backup-status/src/confirmations/expiry-job.action.ts`:
  - Handler OpenWhisk/serverless para la acción `backup-status/expire-restore-confirmations`.
  - Respeta el feature flag `EXPIRY_JOB_ENABLED`: si `false`, retorna sin hacer nada.
  - Llama a `confirmations.service.expireStale(new Date())`.
  - Registra en log el número de solicitudes expiradas.
  - Maneja errores sin crashear el job (retorna error en el payload de respuesta).

---

## Fase 11 — Infraestructura (Helm / APISIX / Keycloak)

- [ ] T-26 Actualizar el chart Helm `helm/backup-status/` (o el chart unificado equivalente) para añadir las nuevas variables de entorno en el bloque `env` del deployment:
  - `CONFIRMATION_TTL_SECONDS` (valor por defecto: `300`)
  - `PRECHECK_TIMEOUT_MS` (valor por defecto: `10000`)
  - `PRECHECK_SNAPSHOT_AGE_WARNING_HOURS` (valor por defecto: `48`)
  - `PRECHECK_OPERATIONAL_HOURS_START` (valor por defecto: `"08:00"`)
  - `PRECHECK_OPERATIONAL_HOURS_END` (valor por defecto: `"20:00"`)
  - `PRECHECK_OPERATIONAL_HOURS_ENABLED` (valor por defecto: `"true"`)
  - `MFA_ENABLED` (valor por defecto: `"true"`)
  - `EXPIRY_JOB_ENABLED` (valor por defecto: `"true"`)
  - `EXPIRY_JOB_INTERVAL_SECONDS` (valor por defecto: `60`)
  - `CRITICAL_RISK_MULTI_WARNING_THRESHOLD` (valor por defecto: `3`)
  - `RESTORE_CONFIRMATION_ENABLED` (valor por defecto: `"true"`)
  - Las variables sensibles (p.ej., `KEYCLOAK_OTP_VERIFY_URL` si contiene credenciales) deben referenciarse desde un `Secret` de Kubernetes, no hardcodeadas en el ConfigMap.

- [ ] T-27 Registrar la acción de expiración en el manifiesto del scheduling-engine con schedule `*/1 * * * *`:
  - Acción: `backup-status/expire-restore-confirmations`
  - Schedule: cada minuto
  - Verificar que el patrón sigue la convención existente del scheduling-engine (similar a `collector.action.ts`).

- [ ] T-28 Verificar/actualizar la configuración de APISIX (si aplica) para que las nuevas rutas `POST /v1/backup/restore/confirm` y `GET /v1/backup/restore/confirm/:id` estén expuestas con las mismas políticas de autenticación (Keycloak JWT) que las rutas existentes del servicio `backup-status`. No deben ser accesibles sin autenticación válida.

---

## Fase 12 — Frontend: servicios y hooks

- [ ] T-29 Modificar `apps/web-console/src/services/backupOperationsApi.ts` para añadir los tres nuevos métodos:
  - `initiateRestore(body: InitiateRestorePayload, token: string): Promise<InitiateRestoreResponse>` — llama a `POST /v1/backup/restore`.
  - `confirmRestore(body: ConfirmRestorePayload, token: string): Promise<ConfirmRestoreResponse>` — llama a `POST /v1/backup/restore/confirm`.
  - `abortRestore(confirmationToken: string, authToken: string): Promise<void>` — llama a `POST /v1/backup/restore/confirm` con `confirmed: false`.

- [ ] T-30 Refactorizar `apps/web-console/src/hooks/useTriggerRestore.ts` para manejar el flujo de dos pasos. El hook debe exponer la interfaz `UseTriggerRestoreResult` definida en la sección 6.6 del plan, incluyendo:
  - `initiate(body, token)`: llama a `initiateRestore()`, actualiza `phase` a `pending_confirmation` y almacena `precheckResponse`.
  - `confirm(opts)`: llama a `confirmRestore()`, actualiza `phase` a `dispatched` y almacena `operationId`.
  - `abort()`: llama a `abortRestore()`, resetea el estado a `idle`.
  - Estados del ciclo de vida: `'idle' | 'loading' | 'pending_confirmation' | 'confirming' | 'dispatched' | 'error'`.

- [ ] T-31 Crear `apps/web-console/src/hooks/useConfirmRestore.ts` (si se extrae como hook independiente del refactoring de T-30):
  - Encapsula la llamada a `confirmRestore()`.
  - Gestiona estado de carga y error para el Paso 2.

- [ ] T-32 Crear `apps/web-console/src/hooks/useAbortRestore.ts` (si se extrae como hook independiente):
  - Encapsula la llamada a `abortRestore()`.
  - Gestiona estado de carga y error para el abort.

---

## Fase 13 — Frontend: componentes

- [ ] T-33 Crear `apps/web-console/src/components/backup/RiskLevelBadge.tsx`:
  - Componente que acepta `riskLevel: RiskLevel` como prop.
  - Renderiza badge de color verde/gris para `normal`, naranja/ámbar para `elevated`, y rojo con icono de advertencia para `critical`.
  - Debe ser accesible (texto alternativo o `aria-label` descriptivo).

- [ ] T-34 Crear `apps/web-console/src/components/backup/PrecheckResultList.tsx`:
  - Componente que acepta `prechecks: PrecheckResult[]` como prop.
  - Renderiza cada precheck con: icono de estado (✅ `ok` / ⚠️ `warning` / 🚫 `blocking_error`), código localizado, mensaje descriptivo, y metadata adicional si existe.
  - Los ítems con `result: 'blocking_error'` se destacan con fondo rojo claro.
  - Los ítems con `result: 'warning'` se destacan con fondo ámbar claro.

- [ ] T-35 Crear `apps/web-console/src/components/backup/TenantNameInput.tsx`:
  - Input controlado que acepta `expectedName: string` y `value: string` y `onChange` como props.
  - Valida en tiempo real si el texto introducido coincide exactamente con `expectedName` (case-sensitive, coincidencia exacta según RN-04).
  - Muestra un check verde cuando coincide, sin indicador cuando está vacío, y sin indicador negativo mientras se escribe (para no ser agresivo).
  - Expone prop `onMatch(isMatch: boolean)` para que el padre pueda habilitar/deshabilitar el botón de confirmación.

- [ ] T-36 Crear `apps/web-console/src/components/backup/CriticalConfirmationPanel.tsx`:
  - Panel visible sólo cuando `riskLevel === 'critical'`.
  - Acepta `availableSecondFactors: string[]` como prop para determinar qué tabs mostrar.
  - Tab "Código MFA (OTP)": input numérico de 6 dígitos, visible solo si `availableSecondFactors` incluye `'otp'`.
  - Tab "Aprobación de segundo administrador": instrucciones + campo para que el segundo actor introduzca su JWT activo.
  - Expone `onSecondFactorReady(type: SecondFactorType, value: string)` cuando el factor está completo.
  - Expone `onSecondFactorClear()` cuando se limpia el campo.

- [ ] T-37 Crear `apps/web-console/src/components/backup/RestoreConfirmationDialog.tsx`:
  - Modal bloqueante (overlay) que se muestra cuando `phase === 'pending_confirmation'`.
  - Acepta como props: `precheckResponse: InitiateRestoreResponse`, `onConfirm: (opts: ConfirmRestoreOpts) => void`, `onAbort: () => void`.
  - Estructura interna según la sección 6.1 del plan:
    - Cabecera: título + `<RiskLevelBadge riskLevel={...} />`.
    - Bloque de objetivo: tenant, componente, instancia, snapshot (timestamp + antigüedad en horas legible).
    - Bloque de prechecks: `<PrecheckResultList prechecks={...} />`.
    - Bloque de confirmación deliberada: `<TenantNameInput />` siempre visible + checkbox de reconocimiento de advertencias si `riskLevel !== 'normal'` + `<CriticalConfirmationPanel />` si `riskLevel === 'critical'`.
    - Pie: botón "Cancelar" (siempre activo, llama `onAbort`) + botón "Confirmar restauración" (lógica de deshabilitado según condiciones de la sección 6.1).
  - El botón de confirmación permanece deshabilitado mientras:
    - existan prechecks con `result: 'blocking_error'`,
    - `TenantNameInput` no indique coincidencia exacta,
    - el checkbox de advertencias no esté marcado cuando `riskLevel !== 'normal'`,
    - el campo de segundo factor esté incompleto cuando `riskLevel === 'critical'`.

- [ ] T-38 Modificar `apps/web-console/src/components/backup/BackupStatusDetail.tsx` (o el componente equivalente que contiene el botón de restore):
  - Importar y usar el hook `useTriggerRestore` refactorizado.
  - Cuando `phase === 'pending_confirmation'`, renderizar `<RestoreConfirmationDialog>` superpuesto al contenido existente.
  - Cuando `phase === 'dispatched'`, cerrar el modal y mostrar la notificación de éxito con el `operationId`.
  - Cuando `phase === 'error'`, mostrar el mensaje de error sin romper el resto de la UI.
  - No modificar la lógica de navegación existente ni otros botones del componente.

---

## Fase 14 — Tests unitarios

- [ ] T-39 Crear `services/backup-status/test/confirmations/risk-calculator.test.ts`:
  - Tests para `calculateRiskLevel()` con todas las combinaciones de parámetros relevantes:
    - Scope `full` → `critical` independientemente de las advertencias.
    - ≥ `criticalMultiWarningThreshold` advertencias → `critical`.
    - Snapshot antiguo → `elevated`.
    - Advertencia presente → `elevated`.
    - Solicitud fuera del horario operativo → `elevated`.
    - Prechecks incompletos por timeout → `elevated`.
    - Todos los parámetros "normales" → `normal`.

- [ ] T-40 Crear `services/backup-status/test/confirmations/prechecks/active-restore.test.ts`:
  - Test: no hay restore activo → `ok`.
  - Test: hay restore activo → `blocking_error` con `conflict_operation_id` en metadata.

- [ ] T-41 Crear `services/backup-status/test/confirmations/prechecks/snapshot-exists.test.ts`:
  - Test: snapshot existe y disponible → `ok`.
  - Test: snapshot no existe → `blocking_error`.
  - Test: snapshot existe pero no disponible → `blocking_error`.
  - Test: adaptador no responde → `warning` (degradación).

- [ ] T-42 Crear `services/backup-status/test/confirmations/prechecks/snapshot-age.test.ts`:
  - Test: antigüedad < umbral → `ok`.
  - Test: antigüedad = umbral → `ok` (límite no bloqueante).
  - Test: antigüedad > umbral → `warning` con `age_hours` y `threshold_hours` en metadata.

- [ ] T-43 Crear `services/backup-status/test/confirmations/prechecks/newer-snapshots.test.ts`:
  - Test: no hay snapshots más recientes → `ok`.
  - Test: hay 1 snapshot más reciente → `warning` con `newer_count: 1`.
  - Test: hay múltiples snapshots más recientes → `warning` con `newer_count` correcto.

- [ ] T-44 Crear `services/backup-status/test/confirmations/prechecks/operational-hours.test.ts`:
  - Test: solicitud dentro del horario operativo → `ok`.
  - Test: solicitud fuera del horario operativo → `warning`.
  - Test: `PRECHECK_OPERATIONAL_HOURS_ENABLED=false` → `ok` independientemente de la hora.

- [ ] T-45 Crear `services/backup-status/test/confirmations/prechecks/index.test.ts`:
  - Test: todos los prechecks resuelven antes del timeout → retorna resultados correctos.
  - Test: un precheck excede el timeout → ese precheck aparece como `warning` con código `precheck_timeout`; los demás se procesan normalmente.
  - Test: precheck lanza excepción → se captura y se reporta como `warning`.

- [ ] T-46 Crear `services/backup-status/test/confirmations/second-factor/otp-verifier.test.ts`:
  - Test: OTP válido → `{ valid: true }`.
  - Test: OTP inválido → `{ valid: false, detail: 'otp_invalid' }`.
  - Test: Keycloak no disponible → `{ valid: false, detail: 'keycloak_unavailable' }`.
  - Test: `MFA_ENABLED=false` → la función lanza error de configuración.

- [ ] T-47 Crear `services/backup-status/test/confirmations/second-factor/second-actor.test.ts`:
  - Test: JWT válido de superadmin distinto del solicitante con acceso al tenant → `{ valid: true, secondActorId }`.
  - Test: mismo actor como segundo factor → `{ valid: false, detail: 'same_actor' }`.
  - Test: actor sin rol superadmin → `{ valid: false, detail: 'insufficient_role' }`.
  - Test: JWT inválido o expirado → `{ valid: false, detail: 'token_invalid' }`.
  - Test: actor sin acceso al tenant → `{ valid: false, detail: 'no_tenant_access' }`.

- [ ] T-48 Crear `services/backup-status/test/confirmations/confirmations.service.test.ts` con mocks de repositorio, auditoría, prechecks y segundo factor:
  - Test `initiate()`: prechecks OK → retorna token y respuesta 202, emite evento de auditoría.
  - Test `initiate()`: precheck bloqueante → lanza error, no genera token.
  - Test `confirm()`: confirmación exitosa (riesgo normal) → despacha operación, emite evento de auditoría.
  - Test `confirm()`: token expirado → lanza error 410.
  - Test `confirm()`: token ya utilizado → lanza error 409.
  - Test `confirm()`: nombre de tenant incorrecto → lanza error 422.
  - Test `confirm()`: riesgo crítico sin segundo factor → rechaza.
  - Test `confirm()`: riesgo crítico con OTP válido → despacha.
  - Test `confirm()`: riesgo crítico con segundo actor válido → despacha.
  - Test `abort()`: solicitud en estado `pending_confirmation` → actualiza estado, emite auditoría.
  - Test `expireStale()`: varias solicitudes expiradas → las marca, emite eventos de auditoría por cada una, retorna recuento.

---

## Fase 15 — Tests de integración

- [ ] T-49 Crear `services/backup-status/test/integration/restore-confirmation-flow.test.ts` con instancia PostgreSQL de test (Docker Compose):
  - Escenario: flujo completo `initiate → confirm` (riesgo normal) — cubre CA-01, CA-02, CA-05.
  - Escenario: `initiate` con precheck bloqueante → no se genera token — cubre CA-03.
  - Escenario: `initiate` con advertencias → `confirm` con `acknowledge_warnings: true` — cubre CA-04.
  - Escenario: `confirm` con token expirado → error 410 — cubre CA-07.
  - Escenario: `confirm` → revalidación falla (snapshot eliminado entre pasos) → error 422 — cubre CA-08.
  - Escenario: flujo completo (riesgo crítico, OTP) — cubre CA-06.
  - Escenario: flujo completo (riesgo crítico, segundo actor) — cubre CA-06.
  - Escenario: `initiate → abort` → evento de auditoría con `decision='aborted'` — cubre CA-10.
  - Escenario: aislamiento multi-tenant → prechecks no revelan datos de otro tenant — cubre CA-11.
  - Escenario: trigger backup bajo demanda → no pasa por flujo de confirmación — cubre CA-12.
  - Escenario: cada decisión (confirm, abort, expire) genera evento de auditoría con todos los campos obligatorios — cubre CA-09.

---

## Fase 16 — Tests E2E (frontend)

- [ ] T-50 Crear o extender suite Playwright/Cypress en `tests/e2e/`:
  - Test E2E: iniciar restore desde `BackupStatusDetail` → verificar que el diálogo de confirmación aparece antes de cualquier despacho — cubre CA-01.
  - Test E2E: campo `TenantNameInput` con texto incorrecto → botón de confirmación deshabilitado — cubre CA-05.
  - Test E2E: precheck de advertencia → advertencia visible en `PrecheckResultList`, flujo puede continuar tras marcar acknowledge — cubre CA-04.
  - Test E2E: precheck bloqueante → botón de confirmación deshabilitado, mensaje de error visible — cubre CA-03.
  - Test E2E: abort desde modal → evento de auditoría visible en consola de auditoría — cubre CA-10.
  - Test E2E: iniciar backup bajo demanda → no aparece modal de confirmación — cubre CA-12.
  - Los tests usan mocks de API REST (MSW o equivalent) para simular respuestas de prechecks con distintos niveles de riesgo.

---

## Fase 17 — Tests de componentes React

- [ ] T-51 Crear `apps/web-console/src/components/backup/__tests__/RiskLevelBadge.test.tsx`:
  - Renderiza correctamente para `normal`, `elevated` y `critical`.
  - Verifica clases CSS o estilos de color asociados a cada nivel.

- [ ] T-52 Crear `apps/web-console/src/components/backup/__tests__/PrecheckResultList.test.tsx`:
  - Renderiza correctamente la lista de prechecks OK, warning y blocking_error.
  - Los ítems blocking_error tienen el estilo de fondo rojo claro.
  - El metadata adicional se muestra cuando existe.

- [ ] T-53 Crear `apps/web-console/src/components/backup/__tests__/TenantNameInput.test.tsx`:
  - Input vacío → no muestra indicador de match ni de error.
  - Input con texto incorrecto → `onMatch(false)`.
  - Input con texto exacto → `onMatch(true)` y check verde.
  - La comparación es case-sensitive (coincidencia exacta).

- [ ] T-54 Crear `apps/web-console/src/components/backup/__tests__/CriticalConfirmationPanel.test.tsx`:
  - Renderiza tab OTP cuando `availableSecondFactors` incluye `'otp'`.
  - No renderiza tab OTP cuando `availableSecondFactors` no incluye `'otp'`.
  - Input OTP de 6 dígitos completo → llama `onSecondFactorReady('otp', '123456')`.
  - Campo segundo actor con JWT → llama `onSecondFactorReady('second_actor', token)`.

- [ ] T-55 Crear `apps/web-console/src/components/backup/__tests__/RestoreConfirmationDialog.test.tsx`:
  - Botón de confirmación deshabilitado si hay `blocking_error` en prechecks.
  - Botón habilitado solo cuando todas las condiciones están satisfechas (nombre correcto + checkbox marcado si elevated/critical + segundo factor si critical).
  - Clic en "Cancelar" llama `onAbort`.
  - Clic en "Confirmar restauración" (cuando habilitado) llama `onConfirm` con los campos correctos.

---

## Fase 18 — Documentación y CHANGELOG

- [ ] T-56 Añadir entrada en `services/backup-status/CHANGELOG.md` (o crear el fichero si no existe) documentando el breaking change de esta tarea:
  - `POST /v1/backup/restore` ya no despacha directamente: ahora devuelve `schema_version: "2"` con token de confirmación. Los consumidores que esperaban `operation_id` en la respuesta 202 directa deben actualizarse para usar el flujo de dos pasos.
  - Nuevas rutas disponibles: `POST /v1/backup/restore/confirm` y `GET /v1/backup/restore/confirm/:id`.
  - Feature flag de emergencia `RESTORE_CONFIRMATION_ENABLED=false` para recuperación operativa.

---

## Criterios de aceptación → cobertura de tareas

| CA    | Cubierto por                                                                                             |
|-------|----------------------------------------------------------------------------------------------------------|
| CA-01 | T-21, T-37, T-38, T-50                                                                                   |
| CA-02 | T-18, T-19, T-49                                                                                         |
| CA-03 | T-07, T-13, T-17, T-18, T-37, T-48, T-49, T-50                                                          |
| CA-04 | T-13, T-17, T-35, T-37, T-49, T-50                                                                       |
| CA-05 | T-17, T-35, T-37, T-49, T-50, T-53                                                                       |
| CA-06 | T-15, T-16, T-17, T-36, T-37, T-46, T-47, T-48, T-49                                                    |
| CA-07 | T-17, T-19, T-25, T-48, T-49                                                                             |
| CA-08 | T-08, T-17, T-19, T-41, T-49                                                                             |
| CA-09 | T-17, T-24, T-49                                                                                         |
| CA-10 | T-17, T-29, T-32, T-37, T-38, T-48, T-49, T-50                                                          |
| CA-11 | T-07, T-17, T-49                                                                                         |
| CA-12 | T-21, T-49, T-50                                                                                         |

## Cobertura mínima esperada

| Módulo                              | Cobertura mínima |
|-------------------------------------|-----------------|
| `confirmations/` (backend)          | ≥ 90% líneas    |
| `api/` endpoints nuevos (backend)   | ≥ 85% líneas    |
| Componentes React nuevos (frontend) | ≥ 80% líneas    |
