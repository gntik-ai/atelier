# Tasks — US-BKP-01-T01: Visibilidad del Estado de Backup de Componentes Gestionados

**Rama**: `109-backup-status-visibility` | **Fecha**: 2026-03-31\
**Derivado de**: `plan.md` (secuencia de implementación, fases T-01 a T-09)\
**Contexto de implementación**: El agente implementador recibe **únicamente** `plan.md` y este fichero (`tasks.md`). No tiene acceso al `spec.md` ni a otros artefactos de la carpeta `specs/`. Todo el contexto técnico necesario está incluido aquí o referenciado a `plan.md`.

---

## Reglas de carry-forward para el agente implementador

1. **Leer primero**: `specs/109-backup-status-visibility/plan.md` completo antes de comenzar cualquier tarea.
2. **No modificar** ningún fichero fuera del mapa de ficheros listado en cada tarea.
3. **No crear** ficheros nuevos que no estén en el mapa de ficheros de la tarea en curso.
4. **No borrar** ficheros existentes no listados en el mapa.
5. Ejecutar los quality gates al final de cada tarea (ver sección de validación al final de este documento).
6. Si una tarea depende de una tarea anterior, verificar que los artefactos de esa tarea están presentes antes de comenzar.
7. **Preservar ficheros no relacionados**: no tocar artefactos de otras specs ni ningún fichero fuera del scope.
8. Cada tarea es atómica: debe poder mergearse de forma independiente sin romper el build.
9. El orden de las tareas es el orden correcto de implementación; respetar dependencias.
10. **Esta es una feature de solo lectura**: no se implementan endpoints de escritura, no se inician ni cancelan backups.

---

## Resumen de tareas

| # | Tarea | Fase | Depende de | Tipo |
|---|---|---|---|---|
| T-01 | Migración de base de datos (tabla `backup_status_snapshots`) | 1 | — | NUEVO fichero |
| T-02 | Repository DAL (acceso a datos en PostgreSQL) | 1 | T-01 | NUEVO fichero |
| T-03 | Interfaz de adaptador y registro (`types.ts`, `registry.ts`) | 1 | — | NUEVO ficheros |
| T-04 | Adaptador concreto PostgreSQL (MVP) | 2 | T-03 | NUEVO fichero |
| T-05 | Stubs de adaptadores MongoDB, S3, Keycloak, Kafka | 2 | T-03 | NUEVO ficheros |
| T-06 | Acción OpenWhisk: colector periódico | 3 | T-02, T-03, T-04, T-05 | NUEVO fichero |
| T-07 | Acción OpenWhisk: API handler REST | 3 | T-02, T-03 | NUEVO ficheros |
| T-08 | Rutas APISIX y scopes Keycloak | 3 | T-07 | NUEVO ficheros |
| T-09 | Helm chart: despliegue de acciones, cron alarm, secret | 3 | T-06, T-07, T-08 | NUEVO ficheros |
| T-10 | Frontend: hook `useBackupStatus` y cliente API | 4 | T-07 | NUEVO ficheros |
| T-11 | Frontend: componentes React de backup (admin) | 4 | T-10 | NUEVO ficheros |
| T-12 | Frontend: componentes React de backup (tenant) y páginas | 4 | T-10, T-11 | NUEVO ficheros |
| T-13 | Tests unitarios (adaptadores, colector, API handler) | 5 | T-04, T-05, T-06, T-07 | NUEVO ficheros |
| T-14 | Tests de integración y contrato | 5 | T-07, T-08 | NUEVO fichero |
| T-15 | Shared helpers: `deployment-profile.ts` y `audit.ts` | 1 | — | NUEVO ficheros |

> **Nota**: T-15 se lista al final por claridad pero debe implementarse junto a T-01/T-03, ya que T-06 y T-07 dependen de él.

---

## T-01 — Migración de base de datos: tabla `backup_status_snapshots`

### Alcance

Crear la migración SQL que añade la tabla principal de snapshots de estado de backup. Solo añade, no modifica tablas existentes.

### Criterios de aceptación

- [ ] El fichero `services/backup-status/src/db/migrations/001_backup_status_snapshots.sql` existe y es ejecutable con `psql`.
- [ ] La tabla `backup_status_snapshots` tiene todas las columnas descritas en `plan.md` § "Tabla principal: `backup_status_snapshots`".
- [ ] El constraint `UNIQUE (tenant_id, component_type, instance_id)` está definido.
- [ ] Existen los dos índices (`idx_backup_snapshots_tenant`, `idx_backup_snapshots_status`).
- [ ] La migración es idempotente: usar `CREATE TABLE IF NOT EXISTS` y `CREATE INDEX IF NOT EXISTS`.
- [ ] El script incluye un bloque de rollback comentado: `-- ROLLBACK: DROP TABLE IF EXISTS backup_status_snapshots;`
- [ ] Ejecutar la migración en un entorno local con PostgreSQL no produce errores.

### Notas de implementación

- Usar `gen_random_uuid()` para la columna `id` (requiere la extensión `pgcrypto` o PostgreSQL 13+).
- Los valores posibles de `status` están documentados en `plan.md` § "Tipos de estado permitidos" — añadir un `CHECK` constraint opcional para validación en DB.
- El campo `adapter_metadata JSONB` no tiene schema fijo; es para uso interno del colector.

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `services/backup-status/src/db/migrations/001_backup_status_snapshots.sql` | **WRITE** (crear) |
| `specs/109-backup-status-visibility/plan.md` | READ |

---

## T-02 — Repository DAL (acceso a datos)

### Alcance

Crear el data access layer que encapsula todas las operaciones sobre `backup_status_snapshots`. Es el único módulo que conoce la estructura de la tabla.

### Criterios de aceptación

- [ ] El fichero `services/backup-status/src/db/repository.ts` existe y compila sin errores TypeScript.
- [ ] Exporta `upsertSnapshot(snapshot: SnapshotInput): Promise<void>` que hace INSERT ... ON CONFLICT DO UPDATE (usando la constraint UNIQUE).
- [ ] Exporta `getByTenant(tenantId: string, options?: { includeShared?: boolean }): Promise<BackupSnapshot[]>`.
- [ ] Exporta `getAll(options?: { includeShared?: boolean }): Promise<BackupSnapshot[]>` para superadmin/SRE.
- [ ] Exporta los tipos `SnapshotInput` y `BackupSnapshot` (que coinciden con el modelo de `plan.md`).
- [ ] `getByTenant` filtra por `tenant_id`; nunca devuelve filas de otros tenants cuando `includeShared=false`.
- [ ] Todas las funciones usan parámetros preparados; no hay interpolación de strings SQL.
- [ ] El módulo obtiene la conexión de una variable de entorno `DB_URL` (no hardcodeada).

### Notas de implementación

- Usar el cliente PostgreSQL ya disponible en el monorepo (verificar `package.json` del monorepo para `pg` o `postgres`).
- `upsertSnapshot` debe actualizar `last_checked_at`, `status`, `last_successful_backup_at`, `detail` y `adapter_metadata` en el ON CONFLICT. No actualiza `tenant_id`, `component_type` ni `instance_id` (son la clave natural).
- El campo `is_shared_instance` es parte de `SnapshotInput`; el colector lo pasa basándose en la información del perfil de despliegue.

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `services/backup-status/src/db/repository.ts` | **WRITE** (crear) |
| `services/backup-status/src/db/migrations/001_backup_status_snapshots.sql` | READ |
| `specs/109-backup-status-visibility/plan.md` | READ |

---

## T-03 — Interfaz de adaptador y registro

### Alcance

Definir el contrato común `BackupAdapter` y el registro que mapea `componentType → adapter`. Este módulo es la base del modelo extensible de adaptadores.

### Criterios de aceptación

- [ ] El fichero `services/backup-status/src/adapters/types.ts` existe con los tipos `BackupStatus`, `AdapterContext`, `BackupCheckResult` e `BackupAdapter` exactamente como están definidos en `plan.md` § "Interfaz de adaptadores (TypeScript)".
- [ ] El fichero `services/backup-status/src/adapters/registry.ts` existe y exporta `AdapterRegistry`.
- [ ] `AdapterRegistry.register(adapter: BackupAdapter): void` registra un adaptador por su `componentType`.
- [ ] `AdapterRegistry.get(componentType: string): BackupAdapter` devuelve el adaptador registrado o un adaptador de fallback cuyo `check()` siempre devuelve `{ status: 'not_available' }`.
- [ ] `AdapterRegistry.getAll(): BackupAdapter[]` devuelve todos los adaptadores registrados.
- [ ] El registry es singleton (instancia exportada, no clase que se instancia externamente).
- [ ] El módulo compila sin errores TypeScript.

### Notas de implementación

- El adaptador de fallback (para componentes sin adaptador registrado) debe tener `componentType: 'unknown'` y `instanceLabel: 'Componente desconocido'`. Devuelve `{ status: 'not_available' }` inmediatamente sin llamadas externas.
- El registro de adaptadores concretos (T-04, T-05) se hace en el punto de entrada del colector y del API handler, no en el registry.

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `services/backup-status/src/adapters/types.ts` | **WRITE** (crear) |
| `services/backup-status/src/adapters/registry.ts` | **WRITE** (crear) |
| `specs/109-backup-status-visibility/plan.md` | READ |

---

## T-04 — Adaptador concreto PostgreSQL (MVP)

### Alcance

Implementar el adaptador de PostgreSQL, el único obligatorio para demostrar la capacidad con datos reales. Implementa la estrategia de detección multi-nivel descrita en `plan.md`.

### Criterios de aceptación

- [ ] El fichero `services/backup-status/src/adapters/postgresql.adapter.ts` existe.
- [ ] Implementa la interfaz `BackupAdapter` de `types.ts`.
- [ ] `componentType = 'postgresql'` y `instanceLabel = 'Base de datos relacional'`.
- [ ] El método `check()` implementa la estrategia en orden de preferencia (según `plan.md` § "Adaptador MVP: PostgreSQL"):
  1. Velero VolumeSnapshot API (K8s CRD `volumesnapshots.snapshot.storage.k8s.io`)
  2. Barman/CloudNativePG API (`/api/v1/backups`)
  3. Anotación K8s `backup.kubernetes.io/last-success-timestamp`
  4. Fallback a `not_configured`
- [ ] Si la estrategia activa retorna un timestamp de último backup exitoso mayor al umbral configurable (`BACKUP_STALENESS_HOURS`, default `25`), el estado es `failure`.
- [ ] El adaptador tiene un timeout interno de `adapter_timeout_ms` (obtenido de la config). Si expira → `not_available`.
- [ ] El adaptador no lanza excepciones al consumidor; todas las excepciones internas se capturan y devuelven un `BackupCheckResult` apropiado.
- [ ] El código compila sin errores TypeScript.

### Notas de implementación

- Para consultar los CRDs de K8s, usar la K8s API con el token de servicio montado en el pod (`/var/run/secrets/kubernetes.io/serviceaccount/token`). El endpoint es `https://kubernetes.default.svc/apis/snapshot.storage.k8s.io/v1/namespaces/${namespace}/volumesnapshots`.
- La detección de qué estrategia usar es "auto": intentar la primera, si responde 404 o connection refused, pasar a la siguiente.
- Respetar `AdapterContext.k8sNamespace` para filtrar VolumeSnapshots por namespace.
- Si el despliegue no está en K8s (p. ej., desarrollo local), las llamadas a K8s API fallarán y el fallback será `not_configured`.

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `services/backup-status/src/adapters/postgresql.adapter.ts` | **WRITE** (crear) |
| `services/backup-status/src/adapters/types.ts` | READ |
| `specs/109-backup-status-visibility/plan.md` | READ |

---

## T-05 — Stubs de adaptadores MongoDB, S3, Keycloak, Kafka

### Alcance

Crear los stubs de adaptadores para los componentes que no tienen un mecanismo de backup observable en MVP. Cada stub implementa la interfaz y devuelve `not_configured` o `not_available` según el estado del despliegue.

### Criterios de aceptación

- [ ] Existen los 4 ficheros de adaptador stub: `mongodb.adapter.ts`, `s3.adapter.ts`, `keycloak.adapter.ts`, `kafka.adapter.ts`.
- [ ] Cada uno implementa `BackupAdapter` con su `componentType` correcto (`'mongodb'`, `'s3'`, `'keycloak'`, `'kafka'`).
- [ ] Cada uno tiene su `instanceLabel` funcional: `'Base de datos documental'`, `'Almacenamiento de objetos'`, `'Servicio de identidad'`, `'Bus de mensajería'`.
- [ ] Si la variable de entorno `BACKUP_ADAPTER_{COMPONENT}_ENABLED` es `false` (o no está definida), el `check()` devuelve `{ status: 'not_configured', detail: 'adapter_disabled_in_deployment' }`.
- [ ] Si la variable es `true`, el stub devuelve `{ status: 'not_available', detail: 'adapter_not_implemented' }` (indicando que está habilitado pero aún sin implementación real).
- [ ] Los stubs tienen comentarios indicando dónde añadir la implementación real en el futuro.
- [ ] El código compila sin errores TypeScript.

### Notas de implementación

- Los stubs son placeholders extensibles, no implementaciones temporales que se eliminarán. Deben tener la estructura correcta para cuando alguien implemente el adaptador real.
- Los `instanceLabel` se usan en la respuesta de la API para los tenant owners; deben ser textos funcionales claros en español.

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `services/backup-status/src/adapters/mongodb.adapter.ts` | **WRITE** (crear) |
| `services/backup-status/src/adapters/s3.adapter.ts` | **WRITE** (crear) |
| `services/backup-status/src/adapters/keycloak.adapter.ts` | **WRITE** (crear) |
| `services/backup-status/src/adapters/kafka.adapter.ts` | **WRITE** (crear) |
| `services/backup-status/src/adapters/types.ts` | READ |
| `specs/109-backup-status-visibility/plan.md` | READ |

---

## T-06 — Acción OpenWhisk: colector periódico

### Alcance

Implementar la acción OpenWhisk que orquesta el ciclo de recolección: itera las instancias gestionadas, llama a cada adaptador, persiste los snapshots en DB y emite el evento operacional en Kafka.

### Criterios de aceptación

- [ ] El fichero `services/backup-status/src/collector/collector.action.ts` existe.
- [ ] El fichero `services/backup-status/src/collector/collector.config.ts` existe con la interfaz de configuración (frecuencia, timeouts, adaptadores habilitados).
- [ ] La función `main(params)` exportada es el entrypoint de la acción OpenWhisk.
- [ ] El colector llama a `deploymentProfile.getManagedInstances()` para obtener la lista de instancias (ver T-15).
- [ ] Para cada instancia, llama al adaptador correspondiente via `AdapterRegistry.get(componentType).check(...)`.
- [ ] Cada llamada al adaptador está envuelta en un `Promise.race` con un timeout configurable (`adapter_timeout_ms`).
- [ ] Si el adaptador lanza excepción o hace timeout, el colector guarda `{ status: 'not_available' }` en el snapshot y continúa con la siguiente instancia (no falla toda la ejecución).
- [ ] Al final de cada ciclo, llama a `kafka.produce('platform.backup.collector.events', ...)` con el resumen del ciclo (ver `plan.md` § "Flujo del colector").
- [ ] El colector registra un evento de auditoría del ciclo (no de acceso humano) con `audit.logCollectionCycle()`.
- [ ] La función devuelve `{ ok: true, processed: N }` si el ciclo completa sin errores fatales, o `{ ok: false, error: '...' }` si hay un error fatal.
- [ ] El código compila sin errores TypeScript.

### Notas de implementación

- La configuración del colector (`collector.config.ts`) lee de variables de entorno: `BACKUP_COLLECTOR_INTERVAL_MS`, `BACKUP_ADAPTER_TIMEOUT_MS`, `BACKUP_STALE_THRESHOLD_MINUTES`.
- El módulo Kafka a usar es el ya disponible en el monorepo; verificar el patrón de producción existente en otros módulos.
- Si Kafka no está disponible, loguear el error y continuar (el ciclo de recolección no se bloquea por fallos de Kafka).

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `services/backup-status/src/collector/collector.action.ts` | **WRITE** (crear) |
| `services/backup-status/src/collector/collector.config.ts` | **WRITE** (crear) |
| `services/backup-status/src/collector/collector.types.ts` | **WRITE** (crear) |
| `services/backup-status/src/adapters/registry.ts` | READ |
| `services/backup-status/src/adapters/types.ts` | READ |
| `services/backup-status/src/db/repository.ts` | READ |
| `services/backup-status/src/shared/deployment-profile.ts` | READ |
| `services/backup-status/src/shared/audit.ts` | READ |
| `specs/109-backup-status-visibility/plan.md` | READ |

---

## T-07 — Acción OpenWhisk: API handler REST

### Alcance

Implementar el handler REST que procesa `GET /v1/backup/status`, aplica la lógica de RBAC, consulta la DB y serializa la respuesta según el schema versionado.

### Criterios de aceptación

- [ ] El fichero `services/backup-status/src/api/backup-status.action.ts` existe.
- [ ] El fichero `services/backup-status/src/api/backup-status.schema.ts` existe con el schema JSON versionado `v1` de la respuesta (ver `plan.md` § "Esquema de respuesta API (v1)").
- [ ] El fichero `services/backup-status/src/api/backup-status.auth.ts` existe con la lógica de validación JWT y enforcement de scopes.
- [ ] La función `main(params)` exportada es el entrypoint de la acción OpenWhisk.
- [ ] El handler implementa la lógica de enforcement descrita en `plan.md` § "Lógica de enforcement":
  - [ ] Extrae y valida el JWT del header `Authorization`.
  - [ ] Si el request incluye `?tenant_id=X`: permite solo si el scope global está presente O si el tenant del token coincide.
  - [ ] Si el request NO incluye `?tenant_id`: requiere scope global; si no → `403`.
  - [ ] Aplica el filtro `is_shared_instance`: instancias shared solo visibles con scope `technical`.
  - [ ] Filtra los campos de respuesta según el scope `technical` (tenant owners no ven `instance_id`, `detail` interno ni `adapter_metadata`).
- [ ] El handler llama a `audit.logAccessEvent(...)` con el actor y tenant consultado (ver T-15).
- [ ] La respuesta incluye `schema_version: "1"`, `tenant_id`, `queried_at`, `components[]` y `deployment_backup_available`.
- [ ] El campo `stale: true` se calcula como `NOW() - last_checked_at > stale_threshold_ms`.
- [ ] La respuesta para `deployment_backup_available: false` incluye `components: []` y un mensaje explicativo.
- [ ] El handler devuelve status HTTP correcto: `200`, `403`, `404`, `500`.
- [ ] Si el JWT es inválido o expirado → `401`.
- [ ] No expone información interna en errores de `500`.

### Notas de implementación

- La validación JWT se hace verificando la firma con las JWKS de Keycloak (`KEYCLOAK_JWKS_URL`). Usar la librería disponible en el monorepo para verificación JWT.
- `backup-status.auth.ts` exporta `validateToken(token: string): Promise<TokenClaims>` y `enforceScope(claims: TokenClaims, requiredScope: string): void`.
- Para el campo `deployment_backup_available`: es `true` si hay al menos un adaptador habilitado (no en estado `not_available`) para el despliegue actual.

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `services/backup-status/src/api/backup-status.action.ts` | **WRITE** (crear) |
| `services/backup-status/src/api/backup-status.schema.ts` | **WRITE** (crear) |
| `services/backup-status/src/api/backup-status.auth.ts` | **WRITE** (crear) |
| `services/backup-status/src/db/repository.ts` | READ |
| `services/backup-status/src/shared/audit.ts` | READ |
| `specs/109-backup-status-visibility/plan.md` | READ |

---

## T-08 — Rutas APISIX y scopes Keycloak

### Alcance

Declarar la ruta APISIX para el endpoint de backup status y los nuevos scopes de Keycloak con su asignación a roles.

### Criterios de aceptación

**Ruta APISIX:**
- [ ] El fichero `services/gateway-config/routes/backup-status-routes.yaml` existe.
- [ ] Declara la ruta `GET /v1/backup/status` hacia el upstream `openwhisk-backup-status`.
- [ ] Incluye el plugin `openid-connect` con `required_scopes: ["backup-status:read:own"]`.
- [ ] Incluye `Cache-Control: no-store` en la respuesta.
- [ ] Incluye rate limiting (`limit-req`) con valores conservadores (10 req/s, burst 20).
- [ ] El método `POST`, `PUT`, `DELETE`, `PATCH` en la misma URI devuelve 405 (configurar en la ruta o upstream).

**Scopes Keycloak:**
- [ ] El fichero `services/keycloak-config/scopes/backup-status-scopes.yaml` existe.
- [ ] Declara los 3 scopes: `backup-status:read:own`, `backup-status:read:global`, `backup-status:read:technical`.
- [ ] Declara el mapping de scopes a roles según `plan.md` § "Mapping rol → scope".
- [ ] Incluye la credencial de servicio `service_account_collector` (sin scopes de API pública).

### Notas de implementación

- Verificar que el formato YAML sigue las convenciones de los otros ficheros de rutas en `services/gateway-config/routes/`.
- Si el upstream `openwhisk-backup-status` no está definido en otro fichero, crearlo en el mismo YAML de la ruta.
- El formato de scopes Keycloak sigue las convenciones del fichero de scopes de la spec 107 (capabilities).

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `services/gateway-config/routes/backup-status-routes.yaml` | **WRITE** (crear) |
| `services/keycloak-config/scopes/backup-status-scopes.yaml` | **WRITE** (crear) |
| `specs/109-backup-status-visibility/plan.md` | READ |

---

## T-09 — Helm chart: despliegue de acciones, cron alarm y secret

### Alcance

Crear el Helm chart que despliega las dos acciones OpenWhisk (colector y API handler), el cron alarm con trigger y rule para el colector, y el secret con las credenciales del colector.

### Criterios de aceptación

- [ ] El directorio `helm/charts/backup-status/` existe con `Chart.yaml`, `values.yaml` y los templates listados.
- [ ] `Chart.yaml` tiene `name: backup-status`, `version: 0.1.0`, `appVersion: 1.0.0`.
- [ ] `values.yaml` incluye todas las variables configurables: `collector.enabled`, `collector.schedule`, `collector.stale_threshold_minutes`, `collector.adapter_timeout_ms`, `collector.adapters.*`.
- [ ] `templates/openwhisk-alarm.yaml` declara el cron alarm con el schedule de `values.yaml`.
- [ ] `templates/openwhisk-trigger.yaml` declara el trigger asociado.
- [ ] `templates/openwhisk-rule.yaml` declara la rule que conecta alarm → trigger → acción colector.
- [ ] `templates/openwhisk-actions.yaml` declara las dos acciones (colector y API handler) con sus variables de entorno referenciando el secret.
- [ ] `templates/secret.yaml` declara el secret con las credenciales del service account del colector (`DB_URL`, `KAFKA_BROKERS`, credenciales K8s del adaptador PostgreSQL).
- [ ] Si `collector.enabled: false`, los templates de alarm/trigger/rule se omiten (usar `if` en Helm).

### Notas de implementación

- Seguir el patrón de otros Helm charts del monorepo para la estructura de templates.
- Las variables de entorno sensibles van en el Secret y se referencian como `secretKeyRef` en los templates de actions.
- El schedule de la alarm sigue formato cron estándar (`"*/5 * * * *"` por defecto).

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `helm/charts/backup-status/Chart.yaml` | **WRITE** (crear) |
| `helm/charts/backup-status/values.yaml` | **WRITE** (crear) |
| `helm/charts/backup-status/templates/openwhisk-alarm.yaml` | **WRITE** (crear) |
| `helm/charts/backup-status/templates/openwhisk-trigger.yaml` | **WRITE** (crear) |
| `helm/charts/backup-status/templates/openwhisk-rule.yaml` | **WRITE** (crear) |
| `helm/charts/backup-status/templates/openwhisk-actions.yaml` | **WRITE** (crear) |
| `helm/charts/backup-status/templates/secret.yaml` | **WRITE** (crear) |
| `specs/109-backup-status-visibility/plan.md` | READ |

---

## T-10 — Frontend: hook `useBackupStatus` y cliente API

### Alcance

Implementar el cliente HTTP para el endpoint de backup y el hook React que lo consume, con auto-refresco periódico.

### Criterios de aceptación

**Cliente API:**
- [ ] El fichero `apps/console/src/lib/api/backup-status.api.ts` existe.
- [ ] Exporta `getBackupStatus(tenantId?: string, token: string): Promise<BackupStatusResponse>`.
- [ ] El tipo `BackupStatusResponse` refleja exactamente el schema `v1` de `plan.md`.
- [ ] Si la respuesta es `403` o `401`, lanza un error tipado (no genérico).
- [ ] No hace logging de tokens ni de credenciales.

**Hook:**
- [ ] El fichero `apps/console/src/hooks/useBackupStatus.ts` existe.
- [ ] Exporta `useBackupStatus(tenantId?: string)` que devuelve `{ data, loading, error, refetch }`.
- [ ] El hook hace auto-refresco configurable: `refreshIntervalMs` como parámetro opcional (default `5 * 60 * 1000` para admin, `15 * 60 * 1000` para tenant).
- [ ] Si el auto-refresco devuelve un error, el hook mantiene el último estado válido y expone el error.
- [ ] El hook limpia el intervalo de refresco al desmontarse el componente (cleanup en `useEffect`).

### Notas de implementación

- Seguir el patrón de hooks existentes en `apps/console/src/hooks/`.
- El token JWT se obtiene del contexto de autenticación existente en la consola (no se pasa manualmente en producción).
- El tipo `BackupStatusResponse` debe ser un tipo TypeScript exportado desde el cliente API para reutilización.

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `apps/console/src/lib/api/backup-status.api.ts` | **WRITE** (crear) |
| `apps/console/src/hooks/useBackupStatus.ts` | **WRITE** (crear) |
| `specs/109-backup-status-visibility/plan.md` | READ |

---

## T-11 — Frontend: componentes React de backup (vista admin)

### Alcance

Implementar los componentes React para la vista técnica de superadmin/SRE: tabla de componentes con badges de estado, panel de detalle e indicador de no disponibilidad.

### Criterios de aceptación

**`BackupStatusBadge`:**
- [ ] El fichero `apps/console/src/components/backup/BackupStatusBadge.tsx` existe.
- [ ] Recibe `status: BackupStatus` como prop.
- [ ] Renderiza con colores diferenciados: `success` → verde, `failure` → rojo, `partial` → naranja, `in_progress` → azul, `not_configured` → gris, `not_available` → gris atenuado, `pending` → amarillo claro.
- [ ] Usa los primitivos de shadcn/ui (`Badge` o equivalente).
- [ ] Incluye un indicador visual adicional si `stale: true` (p. ej., icono de reloj o texto "Actualizado hace Xm").

**`BackupStatusTable`:**
- [ ] El fichero `apps/console/src/components/backup/BackupStatusTable.tsx` existe.
- [ ] Recibe `components: BackupStatusComponent[]` como prop.
- [ ] Renderiza una tabla con columnas: componente (tipo + etiqueta), instancia (solo con scope técnico), estado (`BackupStatusBadge`), último backup exitoso (timestamp formateado), última comprobación, detalles (expandible).
- [ ] Soporta filtrado por `status` (combo o tabs).
- [ ] Es accesible (usa `<table>` semántico o el componente de tabla de shadcn/ui con `aria-label`).

**`BackupStatusDetail`:**
- [ ] El fichero `apps/console/src/components/backup/BackupStatusDetail.tsx` existe.
- [ ] Muestra el detalle de una instancia: todos los campos visibles según el scope del actor.
- [ ] Si `stale: true`, muestra un banner de advertencia con `stale_since` timestamp.

**`BackupNotAvailable`:**
- [ ] El fichero `apps/console/src/components/backup/BackupNotAvailable.tsx` existe.
- [ ] Renderiza un mensaje explícito cuando `deployment_backup_available: false`.
- [ ] El mensaje no dice "error" sino que indica claramente que la funcionalidad de visibilidad de backup no está habilitada en este perfil de despliegue.

### Notas de implementación

- Usar los componentes de shadcn/ui disponibles en el proyecto (verificar `apps/console/src/components/ui/`).
- Los timestamps se muestran en formato local del navegador pero se almacenan en UTC (el hook devuelve UTC; los componentes formatean).
- `BackupStatusTable` debe ser usable tanto por la vista admin (con identificadores técnicos) como por la vista tenant (sin ellos), controlado por una prop `showTechnicalIdentifiers: boolean`.

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `apps/console/src/components/backup/BackupStatusBadge.tsx` | **WRITE** (crear) |
| `apps/console/src/components/backup/BackupStatusTable.tsx` | **WRITE** (crear) |
| `apps/console/src/components/backup/BackupStatusDetail.tsx` | **WRITE** (crear) |
| `apps/console/src/components/backup/BackupNotAvailable.tsx` | **WRITE** (crear) |
| `apps/console/src/hooks/useBackupStatus.ts` | READ |
| `specs/109-backup-status-visibility/plan.md` | READ |

---

## T-12 — Frontend: componentes de resumen y páginas

### Alcance

Implementar el componente de resumen funcional para tenant owners y las dos páginas de la consola (admin y tenant).

### Criterios de aceptación

**`BackupSummaryCard`:**
- [ ] El fichero `apps/console/src/components/backup/BackupSummaryCard.tsx` existe.
- [ ] Recibe `components: BackupStatusComponent[]` y `tenantName: string`.
- [ ] Usa lenguaje funcional: `instanceLabel` en lugar de `instance_id`.
- [ ] No renderiza ningún identificador técnico de infraestructura.
- [ ] Para cada componente muestra: etiqueta funcional, estado en lenguaje natural ("Protegido", "Advertencia", "Sin configurar", "No disponible") y timestamp del último backup en formato relativo ("hace 3 horas").
- [ ] Si algún componente tiene `status: 'failure'`, la tarjeta resalta con un indicador de alerta visible.
- [ ] Si `deployment_backup_available: false`, muestra el componente `BackupNotAvailable`.

**`BackupStatusPage` (admin):**
- [ ] El fichero `apps/console/src/pages/admin/BackupStatusPage.tsx` existe.
- [ ] Usa `useBackupStatus()` sin `tenantId` (vista global).
- [ ] Incluye un selector de tenant para filtrar la tabla.
- [ ] Muestra `BackupStatusTable` con `showTechnicalIdentifiers: true`.
- [ ] Incluye botón de refresco manual.
- [ ] Muestra el timestamp de última actualización.

**`BackupSummaryPage` (tenant):**
- [ ] El fichero `apps/console/src/pages/tenant/BackupSummaryPage.tsx` existe.
- [ ] Usa `useBackupStatus(tenantId)` con el tenant del contexto autenticado.
- [ ] Muestra `BackupSummaryCard` con `showTechnicalIdentifiers: false`.
- [ ] Si el endpoint devuelve `403` → muestra un mensaje de "No disponible" (no un error genérico).

### Notas de implementación

- Las páginas deben integrarse en el router existente de la consola (verificar `apps/console/src/router.tsx` o equivalente). Si la integración en el router requiere modificar un fichero existente, incluirlo en el mapa de ficheros de esta tarea.
- El formato de timestamp relativo puede usar la librería ya disponible en el proyecto (`date-fns`, `dayjs`, etc.).

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `apps/console/src/components/backup/BackupSummaryCard.tsx` | **WRITE** (crear) |
| `apps/console/src/pages/admin/BackupStatusPage.tsx` | **WRITE** (crear) |
| `apps/console/src/pages/tenant/BackupSummaryPage.tsx` | **WRITE** (crear) |
| `apps/console/src/components/backup/BackupNotAvailable.tsx` | READ |
| `apps/console/src/components/backup/BackupStatusTable.tsx` | READ |
| `apps/console/src/hooks/useBackupStatus.ts` | READ |
| `apps/console/src/router.tsx` (o equivalente) | **EDIT** (añadir rutas de las páginas) |
| `specs/109-backup-status-visibility/plan.md` | READ |

---

## T-13 — Tests unitarios

### Alcance

Implementar los tests unitarios para los módulos de backend: adaptadores, colector y API handler.

### Criterios de aceptación

**Tests del adaptador PostgreSQL:**
- [ ] El fichero `services/backup-status/test/unit/adapters/postgresql.adapter.test.ts` existe.
- [ ] Cubre los 5 escenarios de `plan.md` § "Test unitario del adaptador PostgreSQL":
  - [ ] `success` cuando VolumeSnapshot `readyToUse=true`
  - [ ] `in_progress` cuando VolumeSnapshot `readyToUse=false`
  - [ ] `not_configured` cuando no hay CRD de VolumeSnapshot
  - [ ] `not_available` en timeout
  - [ ] `failure` cuando último backup exitoso supera el umbral de antigüedad
- [ ] Mockea las llamadas HTTP a la K8s API; no hace llamadas reales.

**Tests del colector:**
- [ ] El fichero `services/backup-status/test/unit/collector/collector.action.test.ts` existe.
- [ ] Verifica que el colector llama a cada adaptador y persiste el snapshot.
- [ ] Verifica que si un adaptador lanza excepción, el colector guarda `not_available` y continúa (no falla todo el ciclo).
- [ ] Verifica que si un adaptador hace timeout, el resultado es `not_available`.
- [ ] Verifica que el evento Kafka se emite al final del ciclo con el resumen correcto.

**Tests del API handler:**
- [ ] El fichero `services/backup-status/test/unit/api/backup-status.action.test.ts` existe.
- [ ] Verifica `403` cuando tenant owner solicita vista global (sin `tenant_id`).
- [ ] Verifica `403` cuando tenant owner solicita `tenant_id` de otro tenant.
- [ ] Verifica `200` cuando superadmin solicita vista global.
- [ ] Verifica que instancias `is_shared_instance=true` no aparecen en respuestas sin scope `technical`.
- [ ] Verifica que `instance_id` no aparece en respuestas sin scope `technical`.
- [ ] Verifica que el payload no incluye campos prohibidos (credenciales, rutas internas, `adapter_metadata`).
- [ ] Verifica que `stale: true` se calcula correctamente basado en el timestamp.

### Notas de implementación

- Usar Vitest (verificar configuración del monorepo) o el framework de tests TypeScript ya disponible.
- Todos los tests usan mocks para DB y Kafka; no requieren servicios externos.
- Los mocks se definen en el mismo fichero de test o en `test/unit/__mocks__/`.

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `services/backup-status/test/unit/adapters/postgresql.adapter.test.ts` | **WRITE** (crear) |
| `services/backup-status/test/unit/collector/collector.action.test.ts` | **WRITE** (crear) |
| `services/backup-status/test/unit/api/backup-status.action.test.ts` | **WRITE** (crear) |
| `services/backup-status/src/adapters/postgresql.adapter.ts` | READ |
| `services/backup-status/src/collector/collector.action.ts` | READ |
| `services/backup-status/src/api/backup-status.action.ts` | READ |

---

## T-14 — Tests de integración y contrato

### Alcance

Implementar el test de integración que valida el endpoint REST contra una DB real (o mockeada a nivel de repository), y el test de contrato que verifica el schema de respuesta.

### Criterios de aceptación

**Test de integración:**
- [ ] El fichero `services/backup-status/test/integration/backup-status-api.test.mjs` existe.
- [ ] Verifica CA-01: `GET /v1/backup/status?tenant_id=X` con snapshot `success` en DB → `200` con campos correctos.
- [ ] Verifica CA-02: componente con `not_configured` en DB aparece en respuesta con ese estado.
- [ ] Verifica CA-04: aislamiento multi-tenant — token tenant-A solo ve componentes de tenant-A.
- [ ] Verifica CA-05: token tenant owner sin scope global + `GET /v1/backup/status` sin `tenant_id` → `403`.
- [ ] Verifica CA-08: si `deployment_backup_available: false` → respuesta incluye mensaje explicativo y `components: []`.
- [ ] Verifica CA-09: snapshot con `stale: true` (timestamp antiguo) aparece con `stale: true` en respuesta.
- [ ] Cada test usa datos de prueba aislados (prefijo `test-bkp-01-{uuid}`); teardown elimina los datos.

**Test de contrato:**
- [ ] El fichero `services/backup-status/test/contract/backup-status-response.contract.ts` existe.
- [ ] Valida que la respuesta del endpoint cumple el schema JSON `v1` definido en `backup-status.schema.ts`.
- [ ] Verifica específicamente que la respuesta NO contiene los campos prohibidos: `adapter_metadata`, cadenas que parezcan credenciales, cadenas con `/var/`, `/etc/`, prefijos de K8s namespace internos.
- [ ] Cubre CA-11 del spec.

### Notas de implementación

- Los tests de integración pueden usar `node:test` nativo con ESM (patrón de spec 108).
- Las variables de entorno necesarias: `DB_URL` (PostgreSQL de test), `KEYCLOAK_URL`, tokens de prueba.
- Si el entorno de test no tiene Keycloak disponible, mockear la validación JWT en el API handler con una variable `TEST_MODE=true`.

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `services/backup-status/test/integration/backup-status-api.test.mjs` | **WRITE** (crear) |
| `services/backup-status/test/contract/backup-status-response.contract.ts` | **WRITE** (crear) |
| `services/backup-status/src/api/backup-status.schema.ts` | READ |
| `specs/109-backup-status-visibility/plan.md` | READ |

---

## T-15 — Shared helpers: `deployment-profile.ts` y `audit.ts`

### Alcance

Crear los dos módulos shared que abstraen dependencias externas: el perfil de despliegue (US-DEP-03) y el pipeline de auditoría (US-OBS-01).

### Criterios de aceptación

**`deployment-profile.ts`:**
- [ ] El fichero `services/backup-status/src/shared/deployment-profile.ts` existe.
- [ ] Exporta `getCurrent(): Promise<string>` que devuelve el slug del perfil de despliegue activo.
- [ ] Exporta `getManagedInstances(): Promise<ManagedInstance[]>` que devuelve la lista de instancias gestionadas con `{ id, tenantId, componentType, label, isSharedInstance }`.
- [ ] Si US-DEP-03 no está disponible (variable `DEPLOYMENT_PROFILE_API_URL` no configurada), devuelve una lista provisional hardcodeada con instancias de tipo `postgresql` como stub.
- [ ] El stub provisional está documentado con un comentario `// TODO: reemplazar por integración real con US-DEP-03`.
- [ ] Exporta el tipo `ManagedInstance`.

**`audit.ts`:**
- [ ] El fichero `services/backup-status/src/shared/audit.ts` existe.
- [ ] Exporta `logAccessEvent({ actor, tenantId, timestamp, action }): Promise<void>` para registrar accesos de actores humanos al endpoint.
- [ ] Exporta `logCollectionCycle({ timestamp, processed, errors }): Promise<void>` para registrar ciclos de recolección.
- [ ] Si Kafka no está disponible (`KAFKA_BROKERS` no configurado), ambas funciones loguean en consola en lugar de fallar.
- [ ] El módulo no lanza excepciones al consumidor; todos los errores internos se capturan y loguean localmente.

### Notas de implementación

- `audit.ts` usa el topic `platform.audit.events` para accesos humanos (patrón de US-OBS-01) y `platform.backup.collector.events` para ciclos de recolección.
- La lista de instancias provisional en `deployment-profile.ts` debe ser útil para desarrollo y demostración del MVP, con al menos una instancia de PostgreSQL por tenant de prueba.

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `services/backup-status/src/shared/deployment-profile.ts` | **WRITE** (crear) |
| `services/backup-status/src/shared/audit.ts` | **WRITE** (crear) |
| `specs/109-backup-status-visibility/plan.md` | READ |

---

## Validación post-tarea

Al completar cada tarea, el agente implementador debe ejecutar:

```bash
# 1. Verificar compilación TypeScript (para tareas de backend)
cd services/backup-status && npx tsc --noEmit

# 2. Verificar ficheros fuera del scope no han sido modificados
git diff --name-only | grep -v '^services/backup-status/' \
  | grep -v '^apps/console/src/' \
  | grep -v '^services/gateway-config/routes/backup-status' \
  | grep -v '^services/keycloak-config/scopes/backup-status' \
  | grep -v '^helm/charts/backup-status/' \
  | grep -v '^specs/109-backup-status-visibility/'
# La salida debe estar vacía (excepto por la modificación del router de la consola en T-12)

# 3. Verificar que tests unitarios pasan (cuando T-13 esté completo)
cd services/backup-status && npx vitest run test/unit/

# 4. Verificar que no hay campos prohibidos en el schema
grep -r "adapter_metadata\|connection_string\|/var/\|/etc/" \
  services/backup-status/src/api/backup-status.schema.ts
# La salida debe estar vacía
```

---

## Cobertura de criterios de aceptación del spec

| CA | Test(s) que lo cubren |
|---|---|
| CA-01 (endpoint devuelve estado con tenant) | T-14 (`backup-status-api.test.mjs`) |
| CA-02 (`not_configured` para componente sin backup) | T-14 (`backup-status-api.test.mjs`) |
| CA-03 (`not_available` para componente sin adaptador) | T-13 (`backup-status.action.test.ts` — lógica del registry) |
| CA-04 (aislamiento multi-tenant) | T-14 (`backup-status-api.test.mjs`) |
| CA-05 (403 para tenant owner en vista global) | T-13 (`backup-status.action.test.ts`) + T-14 (`backup-status-api.test.mjs`) |
| CA-06 (badges en consola admin) | T-11 (componentes React) + verificación manual/E2E |
| CA-07 (resumen funcional en consola tenant) | T-12 (componentes React) + verificación manual/E2E |
| CA-08 (mensaje explícito no disponible) | T-12 (`BackupNotAvailable`) + T-14 (integración) |
| CA-09 (degradación informativa ante timeout) | T-13 (`collector.action.test.ts`) + T-14 (`stale: true`) |
| CA-10 (ciclo de recolección actualiza estado) | T-13 (`collector.action.test.ts`) |
| CA-11 (payload no expone info sensible) | T-14 (`backup-status-response.contract.ts`) |

---

*Documento generado para el stage `speckit.tasks` — US-BKP-01-T01 | Rama: `109-backup-status-visibility`*
