# Tasks — US-BKP-01-T02: Puntos de entrada administrativos para iniciar backups o restauraciones

**Branch**: `110-backup-admin-endpoints` | **Spec**: `specs/110-backup-admin-endpoints/spec.md` | **Plan**: `specs/110-backup-admin-endpoints/plan.md`

---

## Instrucciones para el agente de implementación

> **Lee ÚNICAMENTE `plan.md` + `tasks.md` para obtener contexto de implementación.** No es necesario leer el fichero `spec.md` completo: el plan ya incorpora toda la información técnica relevante.

- **Lecturas de ficheros**: usa lecturas dirigidas y acotadas. **No hagas escaneos amplios de directorios** ni leas OpenAPI completo. Lee solo los ficheros indicados en cada tarea (`Ficheros de entrada`).
- **Responsabilidades end-to-end**: el agente es propietario del código, las pruebas, los commits, la apertura del PR, la corrección de fallos en CI y el merge. No delegues estos pasos a otros agentes.
- **Artefactos no relacionados**: preserva en todo momento los artefactos no rastreados de las series `070` y `072` (`specs/070-*`, `specs/072-*` y cualquier fichero staged/unstaged asociado). **No los toques, no los incluyas en commits y no los borres.**
- **Orden de ejecución**: las tareas están numeradas con sus dependencias explícitas. Ejecuta en ese orden salvo que se indique que pueden paralelizarse.
- **Sin pruebas en vivo durante la generación de código**: no ejecutes la suite de tests hasta la tarea T-11. Primero implementa todo el código y luego ejecuta los tests.

---

## Tareas de implementación

---

### T-01 — Migración de base de datos: tabla `backup_operations`

**Descripción**
Crear la migración SQL `002_backup_operations.sql` que añade la tabla `backup_operations`, los tipos ENUM `backup_operation_type` y `backup_operation_status`, y los tres índices necesarios (por tenant, por operaciones activas y por solicitante). La migración debe ser aditiva: no modifica ninguna tabla ni tipo existente de T01.

**Ficheros de entrada**
- `specs/110-backup-admin-endpoints/plan.md` — sección "Modelo de datos / Migración 002"
- `services/backup-status/src/db/migrations/001_backup_status_snapshots.sql` — referencia de convención de nombres y estructura

**Ficheros de salida**
- `services/backup-status/src/db/migrations/002_backup_operations.sql` ← NUEVO

**Criterios de aceptación**
- El fichero SQL contiene `CREATE TYPE backup_operation_type`, `CREATE TYPE backup_operation_status` y `CREATE TABLE backup_operations` con todas las columnas especificadas en el plan.
- Incluye los tres índices: `idx_backup_ops_tenant`, `idx_backup_ops_active` (parcial, con `WHERE status IN ('accepted','in_progress')`), `idx_backup_ops_requester`.
- Incluye comentario de rollback con el SQL inverso (`DROP TABLE`, `DROP TYPE`).
- El fichero no altera `backup_status_snapshots` ni ningún otro objeto existente.

**Dependencias**
- Ninguna.

---

### T-02 — Tipos TypeScript de operaciones (`operations.types.ts`)

**Descripción**
Crear el fichero de tipos `operations/operations.types.ts` con las interfaces y enums que representan el ciclo de vida de una operación: `OperationType`, `OperationStatus`, `OperationRecord` y el schema de respuesta v1 (`OperationResponse`, `OperationResponseV1`).

**Ficheros de entrada**
- `specs/110-backup-admin-endpoints/plan.md` — secciones "Modelo de datos / Estados del ciclo de vida" y "Esquema de respuesta de operación (v1)"

**Ficheros de salida**
- `services/backup-status/src/operations/operations.types.ts` ← NUEVO

**Criterios de aceptación**
- `OperationStatus` es un enum o union literal con los valores: `'accepted'`, `'in_progress'`, `'completed'`, `'failed'`, `'rejected'`.
- `OperationType` es un enum o union literal con los valores: `'backup'`, `'restore'`.
- `OperationRecord` incluye todos los campos de la tabla `backup_operations`: `id`, `type`, `tenantId`, `componentType`, `instanceId`, `status`, `requesterId`, `requesterRole`, `snapshotId?`, `failureReason?`, `failureReasonPublic?`, `adapterOperationId?`, `acceptedAt`, `inProgressAt?`, `completedAt?`, `failedAt?`, `metadata?`.
- `OperationResponseV1` refleja el schema JSON de respuesta del plan (con `schema_version: '1'` y el objeto `operation`).

**Dependencias**
- T-01 (los tipos reflejan la estructura de la tabla).

---

### T-03 — Repositorio DAL: `OperationsRepository`

**Descripción**
Crear `operations/operations.repository.ts`, el Data Access Layer sobre la tabla `backup_operations`. Debe implementar los métodos: `create`, `findById`, `findActive`, `updateStatus` y `listByTenant`.

**Ficheros de entrada**
- `specs/110-backup-admin-endpoints/plan.md` — sección "Componentes y responsabilidades / OperationsRepository"
- `services/backup-status/src/operations/operations.types.ts` (T-02)
- `services/backup-status/src/db/` — convenciones existentes de conexión a PostgreSQL

**Ficheros de salida**
- `services/backup-status/src/operations/operations.repository.ts` ← NUEVO

**Criterios de aceptación**
- `create(record)`: inserta una fila con `status = 'accepted'` y `accepted_at = NOW()`, devuelve el `OperationRecord` completo.
- `findById(id)`: devuelve `OperationRecord | null`.
- `findActive(tenantId, componentType, instanceId, type)`: busca operaciones con `status IN ('accepted', 'in_progress')` para la combinación dada. Devuelve `OperationRecord | null`.
- `updateStatus(id, status, opts?)`: actualiza `status` y el timestamp correspondiente (`in_progress_at`, `completed_at`, `failed_at`) según el estado; opcionalmente actualiza `failure_reason`, `failure_reason_public` y `adapter_operation_id`.
- `listByTenant(tenantId, limit?)`: devuelve operaciones ordenadas por `accepted_at DESC`, con límite configurable (default 20).
- Todos los métodos usan el cliente de BD existente del servicio; no crean conexiones propias.

**Dependencias**
- T-01 (tabla existe antes de que el DAL pueda escribir contra ella).
- T-02 (tipos).

---

### T-04 — Extensión del contrato de adaptadores (`adapters/types.ts` + `adapters/registry.ts`)

**Descripción**
Extender el fichero de tipos de adaptadores de T01 con las interfaces `AdapterCapabilities`, `SnapshotInfo`, `TriggerResult` y `BackupActionAdapter`. Extender el registro de adaptadores (`registry.ts`) con la función `getCapabilities(componentType)` y el type guard `isActionAdapter`.

**Ficheros de entrada**
- `specs/110-backup-admin-endpoints/plan.md` — sección "Extensión del contrato de adaptadores"
- `services/backup-status/src/adapters/types.ts` — fichero existente (leer solo las primeras 80 líneas para ver la interfaz `BackupAdapter`)
- `services/backup-status/src/adapters/registry.ts` — fichero existente (leer para ver la función `get`)

**Ficheros de salida**
- `services/backup-status/src/adapters/types.ts` ← MODIFICADO (añadir interfaces nuevas al final)
- `services/backup-status/src/adapters/registry.ts` ← MODIFICADO (añadir `getCapabilities` e `isActionAdapter`)

**Criterios de aceptación**
- `BackupActionAdapter` extiende `BackupAdapter` (interfaz de T01) con los métodos `capabilities()`, `triggerBackup()`, `triggerRestore()` y `listSnapshots()` con las firmas exactas del plan.
- `getCapabilities(componentType)` devuelve `{ triggerBackup: false, triggerRestore: false, listSnapshots: false }` para adaptadores que no implementan `BackupActionAdapter`.
- No se modifica ninguna firma existente de `BackupAdapter`, `get()` ni ningún otro símbolo exportado del fichero `registry.ts`.
- TypeScript compila sin errores en el módulo `adapters/`.

**Dependencias**
- Ninguna (es independiente de T-01 a T-03; puede desarrollarse en paralelo).

---

### T-05 — Adaptador PostgreSQL: implementación de acciones (`postgresql.adapter.ts`)

**Descripción**
Extender el adaptador PostgreSQL existente para implementar `BackupActionAdapter`: los métodos `capabilities()`, `triggerBackup()`, `triggerRestore()` y `listSnapshots()`. La estrategia de `triggerBackup` usa el operador CloudNativePG (crea objeto `Backup` vía K8s API). La estrategia de `triggerRestore` crea un nuevo cluster desde el backup indicado. `listSnapshots` consulta los objetos `Backup` del namespace del cluster.

Los adaptadores de MongoDB, S3, Keycloak y Kafka reciben únicamente un stub que devuelve `capabilities()` con todas las capacidades en `false`.

**Ficheros de entrada**
- `specs/110-backup-admin-endpoints/plan.md` — secciones "Adaptador PostgreSQL extendido" y "Extensión del contrato de adaptadores"
- `services/backup-status/src/adapters/types.ts` (T-04, nuevo contenido)
- `services/backup-status/src/adapters/postgresql.adapter.ts` — leer solo los primeros 60 líneas para ver estructura actual
- `services/backup-status/src/adapters/mongodb.adapter.ts` — primeras 20 líneas (para ver patrón de stub)

**Ficheros de salida**
- `services/backup-status/src/adapters/postgresql.adapter.ts` ← MODIFICADO
- `services/backup-status/src/adapters/mongodb.adapter.ts` ← MODIFICADO (stub `capabilities`)
- `services/backup-status/src/adapters/s3.adapter.ts` ← MODIFICADO (stub `capabilities`)
- `services/backup-status/src/adapters/keycloak.adapter.ts` ← MODIFICADO (stub `capabilities`)
- `services/backup-status/src/adapters/kafka.adapter.ts` ← MODIFICADO (stub `capabilities`)

**Criterios de aceptación**
- `PostgresAdapter.capabilities()` devuelve `{ triggerBackup: true, triggerRestore: true, listSnapshots: true }` cuando el CRD de CloudNativePG está disponible; `false` en todos los campos cuando no lo está.
- `triggerBackup()` crea un objeto `Backup` en el K8s API del namespace del cluster y devuelve `TriggerResult` con `adapterOperationId`.
- `triggerBackup()` lanza un error con código `adapter_no_backup_mechanism` cuando ninguna estrategia está disponible.
- `triggerRestore()` crea un cluster CloudNativePG con `bootstrap.recovery.backup.name = snapshotId` y devuelve `TriggerResult`.
- `triggerRestore()` lanza error `adapter_no_restore_mechanism` cuando no puede ejecutar la estrategia.
- `listSnapshots()` devuelve objetos `Backup` con estado `completed` como `available: true` y el resto como `available: false`.
- Los adaptadores de MongoDB, S3, Keycloak y Kafka implementan `capabilities()` devolviendo todas las capacidades en `false`; no implementan los demás métodos (o lanzan `not_implemented`).
- No se modifica ninguna lógica existente de consulta de estado (T01).

**Dependencias**
- T-04 (tipos e interfaz `BackupActionAdapter`).

---

### T-06 — `OperationDispatcher`: despacho asíncrono de operaciones

**Descripción**
Crear `operations/operation-dispatcher.ts`. Este módulo gestiona el ciclo de vida asíncrono de una operación: transiciona de `accepted` → `in_progress`, invoca el adaptador correspondiente con timeout configurable y transiciona a `completed` o `failed`. Emite eventos Kafka en cada transición significativa. Implementa la estrategia de invocación no bloqueante (Opción A del plan: auto-invocación como activación OpenWhisk `non-blocking`).

**Ficheros de entrada**
- `specs/110-backup-admin-endpoints/plan.md` — sección "Despacho asíncrono de operaciones"
- `services/backup-status/src/operations/operations.repository.ts` (T-03)
- `services/backup-status/src/adapters/registry.ts` (T-04, función `getCapabilities` y `get`)
- `services/backup-status/src/adapters/types.ts` (T-04)
- `services/backup-status/src/shared/audit.ts` — primeras 40 líneas (para ver la firma de `emitAuditEvent`)

**Ficheros de salida**
- `services/backup-status/src/operations/operation-dispatcher.ts` ← NUEVO

**Criterios de aceptación**
- `dispatch(operationId)` recupera la operación de la DB, obtiene el adaptador y llama al método correcto (`triggerBackup` o `triggerRestore`) según `operation.type`.
- Antes de despachar verifica que la operación sigue en estado `accepted`; si ya está `in_progress` o terminal, no vuelve a llamar al adaptador.
- Transiciona a `in_progress` antes de invocar el adaptador, y a `completed` o `failed` según el resultado.
- El timeout del adaptador usa el valor del perfil de despliegue (`dispatcher_timeout_seconds` / `restore_timeout_seconds`). Al expirar, transiciona a `failed` con `failure_reason: 'adapter_timeout'`.
- En caso de fallo, `failure_reason` contiene el mensaje técnico del error y `failure_reason_public` contiene el mensaje genérico para tenant owners.
- Emite evento Kafka al `kafka_topic` configurado en cada transición `completed` y `failed`, con el payload: `{ type, operation_id, tenant_id, component_type, status, timestamp }`.
- Los fallos de emisión Kafka no bloquean la transición de estado (fallback a log local).

**Dependencias**
- T-03 (`OperationsRepository`).
- T-04 (tipos e interfaz `BackupActionAdapter`).
- T-05 (adaptadores con métodos de acción).

---

### T-07 — Acciones OpenWhisk de mutación: `trigger-backup` y `trigger-restore`

**Descripción**
Crear las acciones OpenWhisk `trigger-backup.action.ts` y `trigger-restore.action.ts`. Cada acción implementa el handler REST completo: validación de JWT, extracción de actor y scopes, verificación de capacidades del adaptador, verificación de operación concurrente, validación del perfil de despliegue, creación del registro de operación y disparo asíncrono del dispatcher. Devuelve HTTP 202 con `{ operation_id, status: 'accepted', accepted_at }`.

**Ficheros de entrada**
- `specs/110-backup-admin-endpoints/plan.md` — secciones "API endpoints / POST /v1/backup/trigger" y "POST /v1/backup/restore"
- `services/backup-status/src/operations/operations.repository.ts` (T-03)
- `services/backup-status/src/operations/operations.types.ts` (T-02)
- `services/backup-status/src/adapters/registry.ts` (T-04)
- `services/backup-status/src/shared/deployment-profile.ts` — primeras 30 líneas
- `services/backup-status/src/shared/audit.ts` — primeras 40 líneas
- Patrón de acción existente: `services/backup-status/src/` — buscar un fichero `*.action.ts` de T01 y leer solo las primeras 50 líneas para ver la estructura del handler OpenWhisk

**Ficheros de salida**
- `services/backup-status/src/operations/trigger-backup.action.ts` ← NUEVO
- `services/backup-status/src/operations/trigger-restore.action.ts` ← NUEVO

**Criterios de aceptación**

**trigger-backup.action**:
- Extrae `sub`, `tenant_id` y `scopes` del JWT validado.
- Si el token solo tiene `backup:write:own`, verifica que `tenant_id` del body coincide con `token.tenant_id`; si no → HTTP 403.
- Llama a `getCapabilities(component_type)`. Si `triggerBackup === false` → HTTP 422 con código `adapter_capability_not_supported`.
- Llama a `OperationsRepository.findActive(tenantId, componentType, instanceId, 'backup')`. Si existe → HTTP 409 con `{ conflict_operation_id }`.
- Llama a `deploymentProfile.isBackupEnabled()`. Si no → HTTP 501 con código `backup_not_enabled_in_deployment`.
- Crea registro con `OperationsRepository.create(...)` y `status = 'accepted'`.
- Dispara `OperationDispatcher.dispatch(operationId)` como activación `non-blocking`.
- Emite evento de auditoría con `audit.ts`.
- Responde HTTP 202 `{ operation_id, status: 'accepted', accepted_at }`.

**trigger-restore.action**:
- Si el token no contiene `backup:restore:global` → HTTP 403 sin información adicional del recurso.
- Llama a `getCapabilities(component_type)`. Si `triggerRestore === false` → HTTP 422.
- Llama a `OperationsRepository.findActive(tenantId, componentType, instanceId, 'restore')`. Si existe → HTTP 409 con `{ conflict_operation_id }`.
- Valida el `snapshot_id` llamando a `adapter.listSnapshots(...)`. Si el snapshot no existe o `available === false` → HTTP 422 con código `snapshot_not_available`.
- Crea registro con `type = 'restore'`, `snapshot_id` incluido.
- Dispara dispatcher `non-blocking`.
- Emite evento de auditoría con `destructive: true`.
- Responde HTTP 202 `{ operation_id, status: 'accepted', accepted_at }`.

**Dependencias**
- T-03 (`OperationsRepository`).
- T-04 (`getCapabilities`, `AdapterCapabilities`).
- T-05 (adaptadores con `listSnapshots`).
- T-06 (`OperationDispatcher`).

---

### T-08 — Acciones OpenWhisk de consulta: `get-operation` y `list-snapshots`

**Descripción**
Crear las acciones OpenWhisk `get-operation.action.ts` y `list-snapshots.action.ts`. `get-operation` implementa el handler para `GET /v1/backup/operations/:id` con verificación de propiedad/rol y serialización diferenciada de `failure_reason` según el scope del token. `list-snapshots` implementa `GET /v1/backup/snapshots` delegando en el adaptador y filtrando datos de infraestructura interna.

**Ficheros de entrada**
- `specs/110-backup-admin-endpoints/plan.md` — secciones "API endpoints / GET /v1/backup/operations/:id" y "GET /v1/backup/snapshots"
- `services/backup-status/src/operations/operations.repository.ts` (T-03)
- `services/backup-status/src/operations/operations.types.ts` (T-02)
- `services/backup-status/src/adapters/registry.ts` (T-04)

**Ficheros de salida**
- `services/backup-status/src/operations/get-operation.action.ts` ← NUEVO
- `services/backup-status/src/operations/list-snapshots.action.ts` ← NUEVO

**Criterios de aceptación**

**get-operation.action**:
- Llama a `OperationsRepository.findById(id)`. Si no existe → HTTP 404.
- Si `token.sub !== operation.requesterId` y el token no tiene `backup:read:global` → HTTP 403.
- En la respuesta: si el token tiene `backup-status:read:technical` → incluye `failure_reason`; si no, omite `failure_reason` y devuelve solo `failure_reason_public`.
- Los campos `adapterOperationId` y `metadata` no se incluyen en la respuesta pública.
- Responde HTTP 200 con el schema `OperationResponseV1`.

**list-snapshots.action**:
- Query params requeridos: `tenant_id`, `component_type`, `instance_id`.
- Si el token no tiene `backup-status:read:global` → HTTP 403.
- Llama a `getCapabilities(component_type)`. Si `listSnapshots === false` → HTTP 422 con código `adapter_capability_not_supported`.
- Llama a `adapter.listSnapshots(instanceId, tenantId, context)`.
- Filtra de la respuesta cualquier dato interno (rutas de fichero, namespaces, credenciales, connection strings).
- Responde HTTP 200 con el schema de snapshots v1 del plan.

**Dependencias**
- T-03 (`OperationsRepository`).
- T-04 (tipos y `getCapabilities`).
- T-05 (adaptadores con `listSnapshots`).

---

### T-09 — Infraestructura: rutas APISIX, scopes Keycloak y valores Helm

**Descripción**
Crear los ficheros de configuración de infraestructura: rutas APISIX para los cuatro endpoints nuevos, nuevos scopes de Keycloak y valores Helm para la sección `operations`. También actualizar el template Helm para desplegar las cuatro acciones OpenWhisk de mutación/consulta.

**Ficheros de entrada**
- `specs/110-backup-admin-endpoints/plan.md` — secciones "Rutas APISIX", "Permisos y RBAC / Nuevos scopes de Keycloak" y "Configuración Helm"
- `services/gateway-config/routes/` — leer solo un fichero de ruta YAML existente (primeras 30 líneas) para ver la convención de nombres
- `services/keycloak-config/scopes/` — leer solo un fichero de scope YAML existente (primeras 20 líneas) para ver la convención
- `helm/charts/backup-status/values.yaml` — leer la sección existente (primeras 50 líneas) para ver la estructura de secciones

**Ficheros de salida**
- `services/gateway-config/routes/backup-operations-routes.yaml` ← NUEVO
- `services/keycloak-config/scopes/backup-operations-scopes.yaml` ← NUEVO
- `helm/charts/backup-status/values.yaml` ← MODIFICADO (añadir sección `operations:`)
- `helm/charts/backup-status/templates/openwhisk-operations-actions.yaml` ← NUEVO

**Criterios de aceptación**
- `backup-operations-routes.yaml` define las cuatro rutas exactas del plan: `POST /v1/backup/trigger`, `POST /v1/backup/restore`, `GET /v1/backup/operations/*`, `GET /v1/backup/snapshots`, con los scopes, rate limits y headers de `Cache-Control: no-store` del plan.
- `backup-operations-scopes.yaml` define los tres scopes nuevos: `backup:write:own`, `backup:write:global`, `backup:restore:global`, con sus descripciones y asignaciones de rol.
- `values.yaml` añade la sección `operations:` con todos los campos del plan (sin alterar secciones existentes).
- `openwhisk-operations-actions.yaml` despliega las cuatro acciones OpenWhisk referenciando los valores de `operations:` del chart.
- No se modifica ninguna ruta APISIX ni scope Keycloak existente de T01.

**Dependencias**
- T-07 y T-08 (los nombres de las acciones OpenWhisk deben coincidir).

---

### T-10 — Frontend: componentes, páginas y hooks de consola

**Descripción**
Implementar todos los componentes React, páginas y hooks necesarios para las dos superficies de consola: el panel de operaciones administrativo (`BackupOperationsPage`) para superadmin/SRE y la modificación condicional de `BackupSummaryPage` para el tenant owner. Incluye los cinco componentes nuevos, los cuatro hooks y el cliente API.

**Ficheros de entrada**
- `specs/110-backup-admin-endpoints/plan.md` — sección "Vistas de consola"
- `apps/console/src/pages/admin/` — listar solo nombres de ficheros para ver convención de nomenclatura (sin leer contenido completo)
- `apps/console/src/pages/tenant/BackupSummaryPage.tsx` — leer solo la sección de render (últimas 60 líneas) para ver el punto de inserción del botón
- `apps/console/src/lib/api/` — leer primeras 20 líneas de un fichero existente para ver patrón del cliente HTTP

**Ficheros de salida**
- `apps/console/src/pages/admin/BackupOperationsPage.tsx` ← NUEVO
- `apps/console/src/pages/tenant/BackupSummaryPage.tsx` ← MODIFICADO
- `apps/console/src/components/backup/TriggerBackupButton.tsx` ← NUEVO
- `apps/console/src/components/backup/TriggerRestoreDialog.tsx` ← NUEVO
- `apps/console/src/components/backup/OperationStatusBadge.tsx` ← NUEVO
- `apps/console/src/components/backup/OperationHistoryPanel.tsx` ← NUEVO
- `apps/console/src/components/backup/SnapshotSelector.tsx` ← NUEVO
- `apps/console/src/hooks/useTriggerBackup.ts` ← NUEVO
- `apps/console/src/hooks/useTriggerRestore.ts` ← NUEVO
- `apps/console/src/hooks/useOperationStatus.ts` ← NUEVO
- `apps/console/src/hooks/useSnapshots.ts` ← NUEVO
- `apps/console/src/lib/api/backup-operations.api.ts` ← NUEVO

**Criterios de aceptación**

**`backup-operations.api.ts`**: cliente HTTP que expone `triggerBackup(body)`, `triggerRestore(body)`, `getOperation(id)` y `listSnapshots(params)`, apuntando a los cuatro endpoints del plan.

**Hooks**:
- `useTriggerBackup`: mutation hook que llama a `POST /v1/backup/trigger` y expone `{ trigger, isLoading, error, operationId }`.
- `useTriggerRestore`: mutation hook para `POST /v1/backup/restore`.
- `useOperationStatus(operationId)`: hook de polling que llama a `GET /v1/backup/operations/:id` cada 5 segundos mientras `status` sea `accepted` o `in_progress`; detiene el polling al llegar a estado terminal.
- `useSnapshots(tenantId, componentType, instanceId)`: hook de fetching para `GET /v1/backup/snapshots`.

**Componentes**:
- `TriggerBackupButton`: botón que abre modal de confirmación con información del componente/tenant. Llama a `useTriggerBackup`. Solo se renderiza si `capabilities.triggerBackup === true`.
- `TriggerRestoreDialog`: diálogo que carga `useSnapshots`, muestra `SnapshotSelector`, incluye aviso visible de operación destructiva e irreversible, requiere checkbox + confirmación antes de llamar a `useTriggerRestore`.
- `OperationStatusBadge`: badge visual que refleja el estado de la operación con colores diferenciados por estado.
- `OperationHistoryPanel`: lista hasta 20 operaciones recientes del tenant con columnas: tipo, componente, actor, estado y timestamps. Cada fila es enlazable al detalle de operación.
- `SnapshotSelector`: dropdown/lista de snapshots con identificador, fecha y disponibilidad. Los snapshots con `available: false` se muestran deshabilitados.

**`BackupOperationsPage`**:
- Muestra tabla de componentes con capacidades + botón "Iniciar backup" (solo si `triggerBackup: true`) + botón "Restaurar" (solo si `triggerRestore: true`).
- Incluye `OperationHistoryPanel` al pie.
- Hace polling de operaciones en curso con `useOperationStatus`.

**`BackupSummaryPage` (modificada)**:
- Añade botón "Solicitar backup" solo si se cumplen las tres condiciones: `allow_tenant_owner_backup: true` en perfil de despliegue, token contiene `backup:write:own`, y `capabilities.triggerBackup === true`.
- Si alguna condición no se cumple, el botón **no aparece en el DOM** (no se muestra deshabilitado).
- **Nunca** muestra `TriggerRestoreDialog` en esta página, independientemente del rol.
- El resto de la página queda idéntico a T01.

**Dependencias**
- T-07 y T-08 (endpoints que consume el cliente API).
- T-09 (rutas APISIX configuradas para que el cliente pueda alcanzar los endpoints).

---

### T-11 — Pruebas: unitarias, de integración, de contrato y de componente

**Descripción**
Crear todos los ficheros de prueba del plan: tests unitarios para los handlers, el dispatcher y la extensión del adaptador PostgreSQL; test de integración E2E contra DB real; tests de contrato de schemas de respuesta; y tests de componente React para las condiciones de renderizado de los botones de acción.

**Ficheros de entrada**
- `specs/110-backup-admin-endpoints/plan.md` — sección completa "Estrategia de tests"
- Todos los ficheros de implementación de T-02 a T-10 (según necesidad puntual de cada test).

**Ficheros de salida**
- `services/backup-status/test/unit/adapters/postgresql-actions.adapter.test.ts` ← NUEVO
- `services/backup-status/test/unit/operations/trigger-backup.action.test.ts` ← NUEVO
- `services/backup-status/test/unit/operations/trigger-restore.action.test.ts` ← NUEVO
- `services/backup-status/test/unit/operations/get-operation.action.test.ts` ← NUEVO
- `services/backup-status/test/unit/operations/list-snapshots.action.test.ts` ← NUEVO
- `services/backup-status/test/unit/operations/operation-dispatcher.test.ts` ← NUEVO
- `services/backup-status/test/integration/backup-operations-api.test.mjs` ← NUEVO
- `services/backup-status/test/contract/backup-operations-response.contract.ts` ← NUEVO
- `apps/console/e2e/backup-operations.spec.ts` ← NUEVO (Playwright)

**Criterios de aceptación**

**Tests unitarios del dispatcher** (`operation-dispatcher.test.ts`):
- `accepted → in_progress → completed` cuando el adaptador tiene éxito.
- `accepted → in_progress → failed` cuando el adaptador lanza error.
- `failed` con `failure_reason: 'adapter_timeout'` cuando el adaptador excede el timeout.
- `failure_reason` recibe el mensaje técnico y `failure_reason_public` el mensaje genérico.
- Evento Kafka emitido en `completed` y en `failed` con el payload correcto.

**Tests unitarios del adaptador PostgreSQL** (`postgresql-actions.adapter.test.ts`):
- `capabilities()` → `triggerBackup: true` cuando el CRD de CloudNativePG está disponible.
- `capabilities()` → `triggerBackup: false` cuando no hay mecanismo de backup configurado.
- `triggerBackup()` crea objeto `Backup` en K8s y devuelve `adapterOperationId`.
- `triggerBackup()` lanza `adapter_no_backup_mechanism` cuando el CRD no está disponible.
- `triggerRestore()` crea cluster de recovery desde `snapshotId`.
- `triggerRestore()` lanza error cuando `snapshotId` no corresponde a un `Backup` K8s válido.
- `listSnapshots()` devuelve backups completados como `available: true` y el resto como `available: false`.

**Tests unitarios de los handlers** (un fichero por action):
- CA-01: POST /trigger con token superadmin → 202 + operation_id.
- CA-03: POST /restore con token tenant_owner → 403.
- CA-06: POST /trigger sobre componente sin soporte → 422 con código semántico.
- CA-07: Segundo POST /trigger con operación activa → 409 con `conflict_operation_id`.
- CA-08: POST /restore con snapshot inexistente → 422 con `snapshot_not_available`.
- CA-09: token tenant_owner intenta operar sobre tenant ajeno → 403.
- CA-12: GET /operations/:id con token técnico incluye `failure_reason`; con token tenant_owner lo omite.
- CA-13: `deploymentProfile.isBackupEnabled() === false` → 501 con código semántico.

**Tests de integración** (`backup-operations-api.test.mjs`):
- CA-01: POST /trigger → 202 + id; GET /operations/:id → `accepted`.
- CA-02: POST /restore → 202 + id.
- CA-04: crear operación + transiciones → GET /operations/:id → estado final con timestamps.
- CA-05: GET /snapshots → respuesta con schema v1 (mock de `listSnapshots`).
- CA-07: crear operación activa → POST nuevo → 409 con id correcto.

**Tests de contrato** (`backup-operations-response.contract.ts`):
- Respuesta de `GET /operations/:id` con token sin scope técnico: no contiene `failure_reason`, no contiene `adapterOperationId`, no contiene `metadata`.
- Respuesta de `GET /snapshots`: cada snapshot tiene `snapshot_id`, `created_at`, `available` y ninguno contiene rutas de almacenamiento, namespaces ni credenciales.

**Tests de componente React / E2E Playwright**:
- `BackupOperationsPage` con `capabilities = { triggerBackup: true, triggerRestore: true }` → botones "Iniciar backup" y "Restaurar" presentes en el DOM.
- `BackupOperationsPage` con `capabilities = { triggerBackup: false, triggerRestore: false }` → ninguno de los botones de acción presente.
- `BackupSummaryPage` con `allow_tenant_owner_backup: true` + scope `backup:write:own` + `triggerBackup: true` → botón "Solicitar backup" presente.
- `BackupSummaryPage` con `allow_tenant_owner_backup: false` → botón "Solicitar backup" ausente del DOM.
- `BackupSummaryPage` con rol tenant_owner → `TriggerRestoreDialog` ausente del DOM en cualquier condición.

**Dependencias**
- T-02 a T-10 (todos los módulos de implementación deben existir antes de ejecutar los tests).

---

## Resumen de dependencias

```text
T-01 (Migración DB)
  └─► T-03 (OperationsRepository)

T-02 (Tipos de operaciones)
  └─► T-03 (OperationsRepository)

T-04 (Extensión contrato adaptadores)
  ├─► T-05 (PostgresAdapter acciones)
  ├─► T-06 (OperationDispatcher)
  ├─► T-07 (trigger-backup, trigger-restore actions)
  └─► T-08 (get-operation, list-snapshots actions)

T-03 (OperationsRepository)
  ├─► T-06 (OperationDispatcher)
  ├─► T-07 (trigger-backup, trigger-restore actions)
  └─► T-08 (get-operation action)

T-05 (PostgresAdapter acciones)
  ├─► T-06 (OperationDispatcher)
  ├─► T-07 (trigger-restore valida snapshot)
  └─► T-08 (list-snapshots action)

T-06 (OperationDispatcher)
  └─► T-07 (acciones de mutación)

T-07 + T-08 (acciones OpenWhisk)
  └─► T-09 (infraestructura APISIX/Keycloak/Helm)

T-09 (infraestructura)
  └─► T-10 (frontend, cliente API)

T-02 a T-10
  └─► T-11 (tests)

```

**Paralelización posible**: una vez completado T-04, las tareas T-05, T-06, T-07 y T-08 pueden desarrollarse en paralelo. T-10 (frontend) puede comenzar con mocks del API en cuanto los schemas de respuesta de T-02 estén definidos, sin esperar a T-09.

---

*Documento generado para el stage `speckit.tasks` — US-BKP-01-T02 | Rama: `110-backup-admin-endpoints`*
