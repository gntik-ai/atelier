# Plan de Implementación: US-BKP-01-T02 — Puntos de entrada administrativos para iniciar backups o restauraciones

**Branch**: `110-backup-admin-endpoints` | **Fecha**: 2026-04-01 | **Spec**: `specs/110-backup-admin-endpoints/spec.md`\
**Input**: Especificación de feature US-BKP-01-T02 | **Tamaño**: M | **Prioridad**: P1\
**Dependencia**: US-BKP-01-T01 completada (rama `109-backup-status-visibility`)

---

## Resumen ejecutivo

Extender el servicio `backup-status` (creado en T01) con capacidades de mutación: iniciar backups bajo demanda, solicitar restauraciones a un snapshot previo y consultar el ciclo de vida de esas operaciones. La solución añade una tabla de operaciones en PostgreSQL, extiende el contrato de adaptadores con métodos `triggerBackup`, `triggerRestore` y `listSnapshots`, expone cuatro nuevos endpoints REST (protegidos vía Keycloak/APISIX con scopes diferenciados por rol), y añade dos nuevas superficies en la consola React: un panel de operaciones para superadmin/SRE y una vista condicionada de solicitud de backup para el tenant owner. El restore queda restringido exclusivamente a SRE y superadmin. Todas las operaciones son asíncronas: la API acepta la solicitud, devuelve un `operation_id` y el solicitante consulta el estado mediante polling.

---

## Contexto técnico

- **Lenguaje/Runtime**: Node.js 20+ ESM, TypeScript (acciones OpenWhisk), React 18 + Tailwind + shadcn/ui (consola)
- **Infraestructura de compute**: OpenWhisk (nuevas acciones para los handlers de mutación)
- **Base de datos**: PostgreSQL — tabla existente `backup_status_snapshots` (T01) + nueva tabla `backup_operations`
- **Gateway**: Apache APISIX (nuevas rutas para los endpoints de mutación)
- **IAM**: Keycloak (nuevos scopes `backup:write:own`, `backup:write:global`, `backup:restore:global`)
- **Eventos**: Kafka (eventos de ciclo de vida de operaciones)
- **Monorepo**: `/root/projects/falcone` — extensión de `services/backup-status/`
- **Dependencias funcionales**: US-BKP-01-T01 (estado de solo lectura, modelo de adaptadores, registro de instancias), US-OBS-01 (pipeline de auditoría), US-DEP-03 (perfil de despliegue)

---

## Verificación de constitución

- **Separación de concerns**: PASS — Las mutaciones se implementan como acciones OpenWhisk separadas de la acción de consulta de T01; no se modifica lógica existente
- **Entrega incremental**: PASS — Cada subsistema (schema, extensión de adaptadores, acciones API, frontend) se entrega como commits atómicos
- **Compatibilidad K8s/OpenShift**: PASS — Las acciones de mutación son stateless; el estado persiste en PostgreSQL
- **Multi-tenant**: PASS — Todo registro de operación incluye `tenant_id`; el aislamiento se aplica en la capa de gateway y en el handler
- **Modelo asíncrono**: PASS — La API acepta, no bloquea; el ciclo de vida de la operación es rastreable mediante polling

---

## Estructura del proyecto

### Documentación (esta feature)

```text
specs/110-backup-admin-endpoints/
├── spec.md
├── plan.md          ← este fichero
└── tasks.md

```

### Código fuente — extensiones sobre `services/backup-status/`

```text
services/backup-status/
├── src/
│   ├── adapters/
│   │   ├── types.ts                                # MODIFICADO — Añadir BackupActionAdapter,
│   │   │                                           #   SnapshotInfo, TriggerResult, AdapterCapabilities
│   │   ├── registry.ts                             # MODIFICADO — Exponer getCapabilities(componentType)
│   │   ├── postgresql.adapter.ts                   # MODIFICADO — Implementar triggerBackup,
│   │   │                                           #   triggerRestore, listSnapshots
│   │   ├── mongodb.adapter.ts                      # MODIFICADO — Stub: capabilities vacías
│   │   ├── s3.adapter.ts                           # MODIFICADO — Stub: capabilities vacías
│   │   ├── keycloak.adapter.ts                     # MODIFICADO — Stub: capabilities vacías
│   │   └── kafka.adapter.ts                        # MODIFICADO — Stub: capabilities vacías
│   ├── operations/
│   │   ├── operations.repository.ts                # NUEVO — DAL para backup_operations
│   │   ├── operations.types.ts                     # NUEVO — OperationRecord, OperationStatus, OperationType
│   │   ├── trigger-backup.action.ts                # NUEVO — Acción OpenWhisk: POST /v1/backup/trigger
│   │   ├── trigger-restore.action.ts               # NUEVO — Acción OpenWhisk: POST /v1/backup/restore
│   │   ├── get-operation.action.ts                 # NUEVO — Acción OpenWhisk: GET /v1/backup/operations/:id
│   │   ├── list-snapshots.action.ts                # NUEVO — Acción OpenWhisk: GET /v1/backup/snapshots
│   │   └── operation-dispatcher.ts                 # NUEVO — Despacha la operación al adaptador
│   │                                               #   y gestiona transiciones de estado
│   ├── db/
│   │   └── migrations/
│   │       └── 002_backup_operations.sql           # NUEVO — Tabla backup_operations + índices
│   └── shared/
│       ├── audit.ts                                # EXISTENTE — se reutiliza sin cambios
│       └── deployment-profile.ts                   # EXISTENTE — se reutiliza sin cambios
├── test/
│   ├── unit/
│   │   ├── adapters/
│   │   │   └── postgresql-actions.adapter.test.ts  # NUEVO — triggerBackup, triggerRestore, listSnapshots
│   │   └── operations/
│   │       ├── trigger-backup.action.test.ts       # NUEVO
│   │       ├── trigger-restore.action.test.ts      # NUEVO
│   │       ├── get-operation.action.test.ts        # NUEVO
│   │       ├── list-snapshots.action.test.ts       # NUEVO
│   │       └── operation-dispatcher.test.ts        # NUEVO
│   ├── integration/
│   │   └── backup-operations-api.test.mjs          # NUEVO — Pruebas E2E contra DB real
│   └── contract/
│       └── backup-operations-response.contract.ts  # NUEVO — Validación de schemas de response

services/gateway-config/
└── routes/
    └── backup-operations-routes.yaml               # NUEVO — Rutas APISIX para los 4 endpoints

services/keycloak-config/
└── scopes/
    └── backup-operations-scopes.yaml               # NUEVO — Nuevos scopes de escritura/restore

apps/console/
└── src/
    ├── pages/
    │   ├── admin/
    │   │   └── BackupOperationsPage.tsx             # NUEVO — Panel de operaciones admin (SRE/superadmin)
    │   └── tenant/
    │       └── BackupSummaryPage.tsx                # MODIFICADO — Añadir botón "Solicitar backup"
    │                                               #   condicionado a capacidades y permisos
    ├── components/backup/
    │   ├── TriggerBackupButton.tsx                  # NUEVO — Botón + modal de confirmación
    │   ├── TriggerRestoreDialog.tsx                 # NUEVO — Diálogo de selección de snapshot + confirmación
    │   ├── OperationStatusBadge.tsx                 # NUEVO — Badge de estado de operación
    │   ├── OperationHistoryPanel.tsx                # NUEVO — Lista de operaciones recientes
    │   └── SnapshotSelector.tsx                     # NUEVO — Selector de snapshots disponibles
    ├── hooks/
    │   ├── useTriggerBackup.ts                      # NUEVO — Mutation hook para POST /trigger
    │   ├── useTriggerRestore.ts                     # NUEVO — Mutation hook para POST /restore
    │   ├── useOperationStatus.ts                    # NUEVO — Polling hook GET /operations/:id
    │   └── useSnapshots.ts                          # NUEVO — Hook GET /snapshots
    └── lib/api/
        └── backup-operations.api.ts                 # NUEVO — Cliente HTTP para los 4 endpoints

helm/
└── charts/backup-status/
    ├── values.yaml                                  # MODIFICADO — Añadir sección operations:
    └── templates/
        └── openwhisk-operations-actions.yaml        # NUEVO — Deploy de las acciones de mutación

```

---

## Arquitectura y flujo de datos

### Diagrama de flujo (ASCII)

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│  FLUJO DE MUTACIÓN: iniciar backup / solicitar restore                       │
│                                                                              │
│  Client ──► APISIX (JWT auth, scope check) ──► trigger-backup.action        │
│                                                 trigger-restore.action       │
│                          │                                                   │
│                          ▼                                                   │
│                  1. Validar JWT + scope (backup:write:* o backup:restore:*)  │
│                  2. Extraer actor_id, tenant_id del token                    │
│                  3. Verificar capacidades del adaptador                      │
│                     AdapterRegistry.getCapabilities(componentType)           │
│                  4. Verificar que no hay operación activa (idempotencia)     │
│                     OperationsRepository.findActive(tenantId, instanceId,    │
│                       type)                                                  │
│                  5. Crear registro de operación con estado 'accepted'        │
│                     OperationsRepository.create(...)                         │
│                  6. Emitir evento de auditoría (US-OBS-01)                   │
│                  7. Responder HTTP 202 { operation_id }                      │
│                                                                              │
│                          │ (asíncrono, en background)                        │
│                          ▼                                                   │
│                  OperationDispatcher.dispatch(operationId)                   │
│                          │                                                   │
│                  ┌───────┴──────────────────────────────┐                   │
│                  │  Transition: accepted → in_progress   │                   │
│                  │  adapter.triggerBackup(...)            │                  │
│                  │     o adapter.triggerRestore(...)      │                  │
│                  └───────────────────┬───────────────────┘                   │
│                                      │                                       │
│                          ┌───────────▼──────────────┐                       │
│                          │  Resultado del adaptador  │                       │
│                          │  (success / failure)      │                       │
│                          └───────────┬──────────────┘                       │
│                                      │                                       │
│                  Transition: in_progress → completed / failed                │
│                  OperationsRepository.updateStatus(operationId, status,      │
│                    failureReason?)                                           │
│                  Kafka: platform.backup.operation.events                     │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│  FLUJO DE CONSULTA: GET /v1/backup/operations/:id                            │
│                                                                              │
│  Client ──► APISIX (JWT auth) ──► get-operation.action                      │
│                                        │                                     │
│                               1. Validar JWT                                 │
│                               2. OperationsRepository.findById(id)           │
│                               3. Verificar que el actor tiene acceso         │
│                                  (requester_id == token.sub ó scope global)  │
│                               4. Serializar: motivo técnico solo para SRE+  │
│                               5. Responder { operation }                     │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│  FLUJO DE CONSULTA: GET /v1/backup/snapshots                                 │
│                                                                              │
│  Client ──► APISIX (JWT auth, scope backup:read:global) ──► list-snapshots  │
│                                        │                                     │
│                               1. Validar JWT + scope global                  │
│                               2. AdapterRegistry.get(componentType)          │
│                               3. adapter.listSnapshots(instanceId, tenantId) │
│                               4. Filtrar identificadores internos            │
│                               5. Responder { snapshots: [...] }              │
└──────────────────────────────────────────────────────────────────────────────┘

```

### Componentes y responsabilidades

| Componente | Responsabilidad |
|---|---|
| `trigger-backup.action` | Handler REST para `POST /v1/backup/trigger`; valida JWT, verifica capacidades, crea operación, despacha al adaptador de forma asíncrona |
| `trigger-restore.action` | Handler REST para `POST /v1/backup/restore`; igual que trigger-backup pero requiere scope `backup:restore:global`; valida snapshot existente antes de aceptar |
| `get-operation.action` | Handler REST para `GET /v1/backup/operations/:id`; verifica propiedad o rol privilegiado; serializa motivo técnico solo para SRE/superadmin |
| `list-snapshots.action` | Handler REST para `GET /v1/backup/snapshots`; requiere scope `backup:read:global`; delega en el adaptador del componente |
| `OperationDispatcher` | Módulo interno que transiciona la operación de `accepted` → `in_progress`, invoca el adaptador con timeout, y transiciona a `completed` o `failed`; emite evento Kafka |
| `OperationsRepository` | DAL sobre la tabla `backup_operations`; métodos: `create`, `findById`, `findActive`, `updateStatus`, `listByTenant` |
| `BackupActionAdapter` (interfaz extendida) | Extiende `BackupAdapter` (T01) con: `capabilities()`, `triggerBackup()`, `triggerRestore()`, `listSnapshots()` |
| `AdapterRegistry` (extendido) | Añade `getCapabilities(componentType)` para que el handler valide antes de aceptar la solicitud |

---

## Modelo de datos

### Migración 002: tabla `backup_operations`

```sql
-- services/backup-status/src/db/migrations/002_backup_operations.sql

CREATE TYPE backup_operation_type AS ENUM ('backup', 'restore');
CREATE TYPE backup_operation_status AS ENUM (
  'accepted',
  'in_progress',
  'completed',
  'failed',
  'rejected'
);

CREATE TABLE backup_operations (
  id                   UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  type                 backup_operation_type   NOT NULL,
  tenant_id            TEXT                    NOT NULL,
  component_type       TEXT                    NOT NULL,
  instance_id          TEXT                    NOT NULL,
  status               backup_operation_status NOT NULL DEFAULT 'accepted',
  requester_id         TEXT                    NOT NULL,
  -- sub (user id) del JWT del solicitante
  requester_role       TEXT                    NOT NULL,
  -- rol Keycloak del solicitante en el momento de la solicitud
  snapshot_id          TEXT,
  -- solo para restore; identificador del snapshot destino
  failure_reason       TEXT,
  -- motivo técnico de fallo (solo visible para SRE/superadmin)
  failure_reason_public TEXT,
  -- mensaje de fallo para tenant owner (genérico, sin detalles técnicos)
  adapter_operation_id TEXT,
  -- identificador nativo de la operación en el sistema de backup del componente
  accepted_at          TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
  in_progress_at       TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  failed_at            TIMESTAMPTZ,
  metadata             JSONB
  -- datos adicionales del adaptador (no expuestos en API pública)
);

-- Índice para consultas por tenant (historial de operaciones de un tenant)
CREATE INDEX idx_backup_ops_tenant
  ON backup_operations(tenant_id, accepted_at DESC);

-- Índice para detección de operaciones activas (constraint de concurrencia)
CREATE INDEX idx_backup_ops_active
  ON backup_operations(tenant_id, component_type, instance_id, type, status)
  WHERE status IN ('accepted', 'in_progress');

-- Índice para consultas por solicitante (un actor consulta sus propias operaciones)
CREATE INDEX idx_backup_ops_requester
  ON backup_operations(requester_id, accepted_at DESC);

```

> **Nota de rollback**: La migración solo añade una nueva tabla y dos tipos ENUM. El rollback es:
>
> ```sql
> DROP TABLE backup_operations;
> DROP TYPE backup_operation_type;
> DROP TYPE backup_operation_status;
> ```
>
> No afecta a `backup_status_snapshots` ni a ninguna tabla existente.

### Estados del ciclo de vida de una operación

```text
[creación] ──► accepted ──► in_progress ──► completed
                  │                  └──────► failed
                  └──► rejected  (validación fallida antes de despachar)

```

| Estado | Descripción |
|---|---|
| `accepted` | La solicitud pasó todas las validaciones y fue registrada. El despacho al adaptador está pendiente o en cola. |
| `in_progress` | El adaptador ha recibido la solicitud y la operación está ejecutándose en el sistema de backup del componente. |
| `completed` | El adaptador reportó finalización exitosa. |
| `failed` | El adaptador reportó fallo, o se agotó el timeout, o el adaptador no respondió. El campo `failure_reason` (solo SRE/superadmin) contiene el detalle técnico. |
| `rejected` | La validación post-creación detectó un problema (p. ej., snapshot no encontrado al intentar despachar). Se usa para casos donde la validación asíncrona descarta la operación. En el flujo síncrono, el rechazo ocurre antes de crear el registro. |

### Esquema de respuesta de operación (v1)

```json
{
  "schema_version": "1",
  "operation": {
    "id": "b3a7f2e1-...",
    "type": "backup",
    "tenant_id": "tenant-abc",
    "component_type": "postgresql",
    "instance_id": "pg-cluster-12",
    "status": "completed",
    "requester_id": "user-sre-01",
    "accepted_at": "2026-04-01T10:00:00Z",
    "in_progress_at": "2026-04-01T10:00:02Z",
    "completed_at": "2026-04-01T10:04:37Z",
    "failed_at": null,
    "snapshot_id": null,
    "failure_reason": null,
    "failure_reason_public": null
  }
}

```

> `failure_reason` (detalle técnico) solo se incluye en la respuesta si el token del solicitante tiene el scope `backup-status:read:technical` (SRE/superadmin). Para tenant owners, `failure_reason` se omite y se devuelve únicamente `failure_reason_public`.

### Esquema de respuesta de snapshots (v1)

```json
{
  "schema_version": "1",
  "tenant_id": "tenant-abc",
  "component_type": "postgresql",
  "instance_id": "pg-cluster-12",
  "snapshots": [
    {
      "snapshot_id": "snap-20260401-180000",
      "created_at": "2026-04-01T18:00:00Z",
      "available": true,
      "size_bytes": 1073741824,
      "label": "Backup automático diario"
    },
    {
      "snapshot_id": "snap-20260331-180000",
      "created_at": "2026-03-31T18:00:00Z",
      "available": false,
      "size_bytes": null,
      "label": "Backup automático diario (expirado)"
    }
  ]
}

```

---

## Extensión del contrato de adaptadores

### Tipos nuevos (`adapters/types.ts`)

```typescript
// Añadir al fichero existente services/backup-status/src/adapters/types.ts

export interface AdapterCapabilities {
  triggerBackup: boolean;
  triggerRestore: boolean;
  listSnapshots: boolean;
}

export interface SnapshotInfo {
  snapshotId: string;
  createdAt: Date;
  available: boolean;
  sizeBytes?: number;
  label?: string;
}

export interface TriggerResult {
  /** Identificador nativo de la operación en el sistema de backup del componente (si aplica) */
  adapterOperationId?: string;
  /** Detalle adicional del adaptador para registrar en metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Extensión de BackupAdapter para adaptadores que soportan acciones de mutación.
 * Los adaptadores que implementan esta interfaz declaran también BackupAdapter (T01).
 */
export interface BackupActionAdapter extends BackupAdapter {
  /**
   * Declara qué acciones de mutación soporta este adaptador.
   * Debe responder de forma síncrona (no hace llamadas externas).
   */
  capabilities(): AdapterCapabilities;

  /**
   * Inicia un backup bajo demanda del componente-instancia para el tenant indicado.
   * Se invoca desde OperationDispatcher. La operación ya está registrada en la DB.
   * @throws Error con mensaje descriptivo si la operación no puede iniciarse.
   */
  triggerBackup(
    instanceId: string,
    tenantId: string,
    context: AdapterContext,
  ): Promise<TriggerResult>;

  /**
   * Solicita la restauración del componente-instancia al snapshot indicado.
   * Se invoca desde OperationDispatcher. La operación ya está registrada en la DB.
   * @throws Error con mensaje descriptivo si la operación no puede iniciarse.
   */
  triggerRestore(
    instanceId: string,
    tenantId: string,
    snapshotId: string,
    context: AdapterContext,
  ): Promise<TriggerResult>;

  /**
   * Lista los snapshots disponibles para restauración del componente-instancia.
   * Se invoca desde list-snapshots.action.
   */
  listSnapshots(
    instanceId: string,
    tenantId: string,
    context: AdapterContext,
  ): Promise<SnapshotInfo[]>;
}

```

### Extensión del registro (`adapters/registry.ts`)

```typescript
// Añadir a services/backup-status/src/adapters/registry.ts

import type { AdapterCapabilities, BackupActionAdapter } from './types.js';

/**
 * Devuelve las capacidades de acción para un tipo de componente.
 * Si el adaptador no implementa BackupActionAdapter, devuelve capacidades vacías.
 */
export function getCapabilities(componentType: string): AdapterCapabilities {
  const adapter = get(componentType);
  if (isActionAdapter(adapter)) {
    return adapter.capabilities();
  }
  return { triggerBackup: false, triggerRestore: false, listSnapshots: false };
}

function isActionAdapter(adapter: unknown): adapter is BackupActionAdapter {
  return (
    adapter !== null &&
    typeof adapter === 'object' &&
    typeof (adapter as BackupActionAdapter).capabilities === 'function'
  );
}

```

### Adaptador PostgreSQL extendido

El adaptador PostgreSQL (MVP) implementa `BackupActionAdapter` con las siguientes estrategias por método:

**`triggerBackup`**:
- Si el operador CloudNativePG está disponible: llama al endpoint `POST /apis/postgresql.cnpg.io/v1/namespaces/{ns}/clusters/{cluster}/backup` del API de Kubernetes para crear un objeto `Backup`.
- Fallback (Velero): crea un objeto `VolumeSnapshot` sobre los PVCs del cluster.
- Si ninguna estrategia está disponible: lanza error `adapter_no_backup_mechanism`.

**`triggerRestore`**:
- Invoca el mecanismo nativo de restauración del operador (p. ej., crea un nuevo cluster CloudNativePG desde el backup indicado como `bootstrap.recovery.backup.name`).
- El `snapshotId` debe corresponder a un nombre de recurso `Backup` válido en Kubernetes.
- Si la estrategia no aplica: lanza error `adapter_no_restore_mechanism`.

**`listSnapshots`**:
- Consulta la lista de objetos `Backup` en el namespace del cluster vía K8s API.
- Filtra por estado `completed` para `available: true`; resto son `available: false`.
- Devuelve metadatos del objeto: `createdAt`, `completionTime`, tamaño si disponible.

Los adaptadores de MongoDB, S3, Keycloak y Kafka implementan `capabilities()` devolviendo `{ triggerBackup: false, triggerRestore: false, listSnapshots: false }` hasta que se instrumenten en tareas futuras.

---

## API endpoints

### 1. POST /v1/backup/trigger — Iniciar backup bajo demanda

**Scope requerido**: `backup:write:own` (para tenant owner sobre su propio tenant) o `backup:write:global` (para SRE/superadmin sobre cualquier tenant)

**Request body**:

```json
{
  "tenant_id": "tenant-abc",
  "component_type": "postgresql",
  "instance_id": "pg-cluster-12"
}

```

**Flujo de validación**:
1. Validar JWT y extraer `sub`, roles y scopes.
2. Si el token solo tiene `backup:write:own`, verificar que `tenant_id == token.tenant_id`.
3. Verificar que `getCapabilities(component_type).triggerBackup === true`. Si no → `HTTP 422` con código `adapter_capability_not_supported`.
4. Verificar que no hay operación de tipo `backup` en estado `accepted` o `in_progress` para `(tenant_id, component_type, instance_id)`. Si la hay → `HTTP 409` con `{ conflict_operation_id }`.
5. Verificar que el perfil de despliegue tiene backup habilitado. Si no → `HTTP 501` con código `backup_not_enabled_in_deployment`.
6. Crear registro en `backup_operations` con `status = 'accepted'`.
7. Despachar de forma asíncrona (no bloquear la respuesta) mediante `OperationDispatcher.dispatch(operationId)`.
8. Emitir evento de auditoría.
9. Responder `HTTP 202 { operation_id, status: 'accepted', accepted_at }`.

### 2. POST /v1/backup/restore — Solicitar restauración

**Scope requerido**: `backup:restore:global` (solo SRE/superadmin; no disponible para tenant owner)

**Request body**:

```json
{
  "tenant_id": "tenant-abc",
  "component_type": "postgresql",
  "instance_id": "pg-cluster-12",
  "snapshot_id": "snap-20260401-180000"
}

```

**Flujo de validación**:
1. Validar JWT. Si el token no tiene `backup:restore:global` → `HTTP 403`.
2. Verificar que `getCapabilities(component_type).triggerRestore === true`. Si no → `HTTP 422`.
3. Verificar que no hay operación de tipo `restore` en estado activo para `(tenant_id, component_type, instance_id)`. Si la hay → `HTTP 409`.
4. Verificar que el snapshot `snapshot_id` existe y está disponible via `adapter.listSnapshots(...)`. Si no existe → `HTTP 422` con `snapshot_not_available`.
5. Crear registro en `backup_operations` con `type = 'restore'`, `snapshot_id`, `status = 'accepted'`.
6. Despachar de forma asíncrona.
7. Emitir evento de auditoría con flag `destructive: true`.
8. Responder `HTTP 202 { operation_id, status: 'accepted', accepted_at }`.

### 3. GET /v1/backup/operations/:id — Consultar estado de operación

**Scope requerido**: autenticación válida (cualquier rol puede consultar si es dueño de la operación; SRE/superadmin pueden consultar cualquier operación)

**Flujo**:
1. Validar JWT.
2. `OperationsRepository.findById(id)` → si no existe → `HTTP 404`.
3. Si `token.sub !== operation.requester_id` y el token no tiene scope `backup:read:global` → `HTTP 403`.
4. Serializar: incluir `failure_reason` solo si el token tiene `backup-status:read:technical`; en otro caso incluir solo `failure_reason_public`.
5. Responder `HTTP 200 { operation }`.

### 4. GET /v1/backup/snapshots — Listar snapshots disponibles

**Query params**: `tenant_id`, `component_type`, `instance_id` (todos requeridos)

**Scope requerido**: `backup-status:read:global` (SRE/superadmin)

**Flujo**:
1. Validar JWT + scope global. Si no tiene scope global → `HTTP 403`.
2. Verificar que `getCapabilities(component_type).listSnapshots === true`. Si no → `HTTP 422`.
3. Invocar `adapter.listSnapshots(instanceId, tenantId, context)`.
4. Filtrar datos internos de infraestructura (rutas, credenciales, namespaces).
5. Responder `HTTP 200 { snapshots: [...] }`.

---

## Permisos y RBAC

### Nuevos scopes de Keycloak

| Scope | Descripción |
|---|---|
| `backup:write:own` | Iniciar backup bajo demanda sobre el propio tenant (tenant owner, condicionado al despliegue) |
| `backup:write:global` | Iniciar backup bajo demanda sobre cualquier tenant (SRE, superadmin) |
| `backup:restore:global` | Solicitar restauración sobre cualquier tenant (SRE, superadmin exclusivamente) |

> Los scopes de lectura `backup-status:read:own`, `backup-status:read:global`, `backup-status:read:technical` ya existen desde T01 y se reutilizan en los endpoints de consulta.

### Mapping rol → scopes (actualizado para T02)

| Rol Keycloak | Scopes de T01 (existentes) | Nuevos scopes de T02 |
|---|---|---|
| `tenant_owner` | `backup-status:read:own` | `backup:write:own` (condicionado al feature flag del despliegue) |
| `workspace_admin` | `backup-status:read:own` | — |
| `sre` | `backup-status:read:own`, `backup-status:read:global`, `backup-status:read:technical` | `backup:write:global`, `backup:restore:global` |
| `superadmin` | `backup-status:read:own`, `backup-status:read:global`, `backup-status:read:technical` | `backup:write:global`, `backup:restore:global` |

> **Scope `backup:write:own` para tenant_owner**: se asigna al rol `tenant_owner` solo si el helm value `operations.allow_tenant_owner_backup: true` está activo. Por defecto es `false`. Si no está activo, el scope no se incluye en el token y el endpoint devuelve `HTTP 403`.

### Enforcement en APISIX

```yaml
# POST /v1/backup/trigger
required_scopes: ["backup:write:own"]   # mínimo; el handler distingue own vs global

# POST /v1/backup/restore
required_scopes: ["backup:restore:global"]

# GET /v1/backup/operations/:id
required_scopes: []   # solo JWT válido; enforcement en el handler

# GET /v1/backup/snapshots
required_scopes: ["backup-status:read:global"]

```

---

## Rutas APISIX

```yaml
# services/gateway-config/routes/backup-operations-routes.yaml

- id: backup-trigger-post
  uri: /v1/backup/trigger
  methods: [POST]
  upstream_id: openwhisk-backup-trigger
  plugins:
    openid-connect:
      discovery: "${KEYCLOAK_DISCOVERY_URL}"
      required_scopes: ["backup:write:own"]
    limit-req:
      rate: 5
      burst: 10
      key: consumer_name
    response-rewrite:
      headers:
        Cache-Control: "no-store"

- id: backup-restore-post
  uri: /v1/backup/restore
  methods: [POST]
  upstream_id: openwhisk-backup-restore
  plugins:
    openid-connect:
      discovery: "${KEYCLOAK_DISCOVERY_URL}"
      required_scopes: ["backup:restore:global"]
    limit-req:
      rate: 2
      burst: 5
      key: consumer_name
    response-rewrite:
      headers:
        Cache-Control: "no-store"

- id: backup-operation-get
  uri: /v1/backup/operations/*
  methods: [GET]
  upstream_id: openwhisk-get-operation
  plugins:
    openid-connect:
      discovery: "${KEYCLOAK_DISCOVERY_URL}"
      required_scopes: []
    limit-req:
      rate: 20
      burst: 40
      key: consumer_name

- id: backup-snapshots-get
  uri: /v1/backup/snapshots
  methods: [GET]
  upstream_id: openwhisk-list-snapshots
  plugins:
    openid-connect:
      discovery: "${KEYCLOAK_DISCOVERY_URL}"
      required_scopes: ["backup-status:read:global"]
    limit-req:
      rate: 10
      burst: 20
      key: consumer_name

```

---

## Despacho asíncrono de operaciones (`OperationDispatcher`)

Las acciones OpenWhisk de mutación son síncronas para la parte de validación y creación del registro, pero el despacho al adaptador es inherentemente asíncrono. El modelo es:

```text
POST /v1/backup/trigger
  └─► [síncrono] Validar → Crear registro (accepted) → Responder 202
  └─► [asíncrono, OpenWhisk activation] OperationDispatcher.dispatch(operationId)
          │
          ▼
      Transicionar → in_progress
      adapter.triggerBackup(...) con timeout configurable (default: 300s)
          │
    ┌─────▼──────────────────────────────┐
    │  Éxito: Transicionar → completed   │
    │  Fallo: Transicionar → failed      │
    │         failure_reason = err.msg   │
    │         failure_reason_public =    │
    │           "La operación no pudo    │
    │            completarse. Contacte   │
    │            al administrador."      │
    └────────────────────────────────────┘
          │
          ▼
      Kafka: platform.backup.operation.events
        { type: 'backup_operation_completed' | 'backup_operation_failed',
          operation_id, tenant_id, component_type, status, timestamp }

```

**Opciones de implementación del despacho asíncrono en OpenWhisk**:

Opción A (recomendada): La acción de mutación crea el registro en estado `accepted` y retorna `202`. A continuación dispara otra activación OpenWhisk auto-invocándose como `non-blocking` (`openwhisk.invokeAction('backup-dispatcher', { operation_id }, { blocking: false })`). El dispatcher actualiza el estado en PostgreSQL.

Opción B: La acción de mutación lanza la operación en background mediante una promesa no esperada antes de responder. Solo válido si el runtime OpenWhisk garantiza tiempo de vida suficiente para que la acción se complete.

Se implementa Opción A por mayor fiabilidad y separación de responsabilidades.

---

## Vistas de consola

### Panel de operaciones administrativo (`BackupOperationsPage`)

Accesible desde: `/admin/tenants/{tenantId}/backup/operations` (superadmin/SRE).

**Secciones**:

1. **Componentes con capacidades**: tabla de instancias del tenant con columnas de estado de backup (datos de T01) + columnas de capacidades (`triggerBackup`, `triggerRestore`, `listSnapshots`) obtenidas del endpoint de capacidades.
2. **Botón "Iniciar backup"**: visible solo si el adaptador del componente declara `triggerBackup: true`. Al pulsar abre un modal de confirmación simple con información del componente y tenant afectados.
3. **Botón "Restaurar"**: visible solo si el adaptador declara `triggerRestore: true`. Al pulsar abre `TriggerRestoreDialog`, que:
   - Carga la lista de snapshots disponibles (`useSnapshots`).
   - Muestra un selector con `SnapshotSelector` (identificador, fecha, disponibilidad).
   - Incluye un aviso visible: "⚠️ Esta operación es destructiva e irreversible. El componente volverá al estado del snapshot seleccionado."
   - Requiere confirmación explícita (checkbox + botón confirmado).
4. **Panel de operaciones recientes**: `OperationHistoryPanel` con las últimas 20 operaciones del tenant (tipo, componente, actor, estado, timestamps). Cada fila tiene enlace a `GET /v1/backup/operations/:id`.
5. **Polling de operaciones en curso**: `useOperationStatus` hace polling cada 5s mientras haya operaciones en estado `accepted` o `in_progress`.

### Vista de backup del tenant owner (`BackupSummaryPage` modificada)

El botón "Solicitar backup" en la consola del tenant solo se renderiza si se cumplen **todas** las condiciones siguientes:
- El perfil de despliegue tiene `allow_tenant_owner_backup: true`.
- El token del usuario tiene el scope `backup:write:own`.
- El adaptador del componente declara `triggerBackup: true`.

Si alguna condición no se cumple, el botón no aparece (no se muestra deshabilitado con tooltip; simplemente no existe en el DOM). Esto evita elementos de interfaz que sugieran una acción inoperativa.

La vista del tenant **nunca** muestra el botón de "Restaurar" ni el `TriggerRestoreDialog`, independientemente del rol.

---

## Configuración Helm (valores nuevos)

```yaml
# helm/charts/backup-status/values.yaml — sección añadida

operations:
  enabled: true
  allow_tenant_owner_backup: false     # por defecto, backup bajo demanda solo para SRE/superadmin
  dispatcher_timeout_seconds: 300      # timeout del adaptador para operaciones de backup
  restore_timeout_seconds: 600         # timeout del adaptador para operaciones de restore
  max_active_operations_per_instance: 1 # máximo de operaciones activas simultáneas por (tenant, component, instance, type)
  kafka_topic: "platform.backup.operation.events"

```

---

## Estrategia de tests

### Pirámide de testing

| Capa | Framework | Foco | Ficheros |
|---|---|---|---|
| **Unit** | Vitest (TS) | Handlers de acción, dispatcher, operations repository, extensión de adaptadores, enforcement de permisos | `test/unit/**/*.test.ts` |
| **Integration** | `node:test` nativo | API E2E contra DB real: crear operación, transicionar estado, consultar, listar snapshots | `test/integration/backup-operations-api.test.mjs` |
| **Contract** | Vitest + JSON Schema validator | Payloads de response para operación y snapshots cumplen el schema `v1`; campos prohibidos ausentes | `test/contract/backup-operations-response.contract.ts` |
| **E2E** | Playwright (opcional) | Panel de operaciones muestra botones según capacidades; restore dialog lista snapshots; polling actualiza badge | `apps/console/e2e/backup-operations.spec.ts` |

### Cobertura por criterio de aceptación del spec

| CA | Test |
|---|---|
| CA-01 (POST /trigger → 202 + operation_id) | integration: POST con token superadmin + adaptador con triggerBackup:true → 202 + id |
| CA-02 (POST /restore → 202 + operation_id) | integration: POST con token SRE + snapshot válido → 202 + id |
| CA-03 (tenant owner no puede restore → 403) | integration: POST /restore con token tenant_owner → 403 |
| CA-04 (GET /operations/:id devuelve estado con timestamps) | integration: crear operación + transition → consultar → estado correcto |
| CA-05 (GET /snapshots devuelve lista con id, created_at, available) | integration: mock adaptador.listSnapshots → respuesta conforme al schema |
| CA-06 (backup sobre componente sin soporte → 422) | unit: handler llama getCapabilities → false → devuelve error semántico |
| CA-07 (operación concurrente duplicada → 409 con conflict_operation_id) | integration: crear operación activa → nuevo POST → 409 con id correcto |
| CA-08 (snapshot inexistente → 422) | unit: adapter.listSnapshots no incluye snapshotId → rechazo antes de crear registro |
| CA-09 (aislamiento multi-tenant tenant_owner → 403) | integration: token tenant-A intenta operar sobre tenant-B → 403 |
| CA-10 (consola admin muestra botones según capacidades) | unit/Playwright: render BackupOperationsPage con capabilities mock → botones visibles/ocultos |
| CA-11 (consola tenant muestra backup condicionado) | unit/Playwright: render BackupSummaryPage con allow_tenant_owner_backup false → botón ausente del DOM |
| CA-12 (fallo muestra motivo diferenciado por rol) | unit: serializer → token técnico incluye failure_reason; token tenant_owner omite y muestra genérico |
| CA-13 (despliegue sin backup → 501) | unit: deploymentProfile.isBackupEnabled() false → handler devuelve 501 con código semántico |

### Casos unitarios clave para el dispatcher

```typescript
// test/unit/operations/operation-dispatcher.test.ts

describe('OperationDispatcher.dispatch()', () => {
  it('transitions accepted → in_progress → completed on adapter success', async () => { ... });
  it('transitions accepted → in_progress → failed on adapter error', async () => { ... });
  it('transitions to failed with adapter_timeout when adapter exceeds timeout', async () => { ... });
  it('sets failure_reason to technical message and failure_reason_public to generic message', async () => { ... });
  it('emits Kafka event on completion', async () => { ... });
  it('emits Kafka event on failure', async () => { ... });
});

```

### Casos unitarios para la extensión del adaptador PostgreSQL

```typescript
// test/unit/adapters/postgresql-actions.adapter.test.ts

describe('PostgresAdapter actions', () => {
  it('capabilities() returns triggerBackup: true when CloudNativePG CRD is available', async () => { ... });
  it('capabilities() returns triggerBackup: false when no backup mechanism is configured', async () => { ... });
  it('triggerBackup() creates Backup object in Kubernetes and returns adapterOperationId', async () => { ... });
  it('triggerBackup() throws adapter_no_backup_mechanism when CRD not available', async () => { ... });
  it('triggerRestore() creates recovery cluster from snapshotId', async () => { ... });
  it('triggerRestore() throws when snapshotId does not match a known Backup resource', async () => { ... });
  it('listSnapshots() returns completed backups as available: true', async () => { ... });
  it('listSnapshots() returns non-completed backups as available: false', async () => { ... });
});

```

---

## Riesgos y mitigaciones

| ID | Descripción | Probabilidad | Impacto | Mitigación |
|---|---|---|---|---|
| R-01 | Las operaciones de restore son destructivas y US-BKP-01-T04 (prechecks y confirmaciones reforzadas) aún no está implementada | Alta | Crítico | Restringir restore exclusivamente a SRE/superadmin. Mostrar aviso de operación destructiva en el diálogo. Documentar en la consola y en el README que US-BKP-01-T04 añadirá prechecks adicionales. Planificar T04 como tarea inmediatamente posterior. |
| R-02 | El modelo de despacho asíncrono en OpenWhisk puede perder activaciones en situaciones de alta carga o reinicio del runtime | Media | Alto | Implementar un mecanismo de recuperación: las operaciones en estado `accepted` durante más de N minutos sin transicionar a `in_progress` se marcan como `failed` con `failure_reason: dispatcher_lost`. Un colector periódico (cron alarm de bajo costo) verifica y limpia operaciones huérfanas. |
| R-03 | Las credenciales del adaptador para backup/restore requieren permisos adicionales sobre el cluster K8s (create/delete para `Backup`, `Cluster`) más allá de los permisos de solo lectura de T01 | Alta | Alto | Definir un ServiceAccount separado `backup-mutator` con RBAC granular (solo create/get sobre `backups.postgresql.cnpg.io` en los namespaces de los clusters). No reutilizar las credenciales del colector de T01. |
| R-04 | Un tenant owner con acceso a `POST /v1/backup/trigger` puede agotar recursos del sistema con múltiples solicitudes | Media | Medio | Rate limiting en APISIX más estricto para el scope `backup:write:own`. La constraint de una operación activa por instancia-tenant previene la mayoría de los casos. Helm value `allow_tenant_owner_backup: false` por defecto. |
| R-05 | El adaptador de restauración de PostgreSQL crea un nuevo cluster (no restaura in-place), lo que puede implicar cambio de endpoint de conexión para las aplicaciones del tenant | Alta | Alto | Documentar en la especificación que el restore no es in-place en el MVP. Reservar la restauración in-place para US-BKP-01-T04 o una tarea específica. El aviso en el diálogo de restore debe indicar que el tenant puede perder conectividad hasta que el nuevo cluster esté listo. |
| R-06 | La propagación del evento de auditoría a Kafka puede fallar en entornos de desarrollo o sin US-OBS-01 | Media | Bajo | El módulo `audit.ts` (de T01) ya tiene fallback a log local. Los endpoints de mutación no se bloquean por fallos de auditoría. |

---

## Compatibilidad, rollback e idempotencia

### Rollback completo

```text
1. Eliminar rutas APISIX: backup-trigger-post, backup-restore-post, backup-operation-get, backup-snapshots-get
2. Desvincular scopes Keycloak: backup:write:own, backup:write:global, backup:restore:global
3. Revertir migración DB: DROP TABLE backup_operations; DROP TYPE backup_operation_type; DROP TYPE backup_operation_status;
4. Desplegar versión anterior del chart Helm (sin las acciones OpenWhisk de mutación)
5. Las acciones de T01 (colector, API de solo lectura) no se ven afectadas

```

### Compatibilidad hacia atrás

- Los endpoints de T01 (`GET /v1/backup/status`) no se modifican ni se mueven.
- La tabla `backup_status_snapshots` no se altera en esta migración.
- Los adaptadores de T01 que no implementan `BackupActionAdapter` siguen funcionando para las consultas de estado. El registro los expone como `capabilities: { triggerBackup: false, triggerRestore: false, listSnapshots: false }`.
- La consola del tenant en la vista existente (`BackupSummaryPage`) solo añade el botón condicionado; si no se cumplen las condiciones, la vista queda idéntica a T01.

### Idempotencia

- El constraint de operación activa única por `(tenant_id, component_type, instance_id, type)` previene duplicados en caso de doble envío por parte del cliente.
- El `OperationDispatcher` verifica el estado de la operación antes de despachar: si ya está `in_progress` o `completed`, no rellama al adaptador.
- La respuesta `HTTP 409` incluye el `conflict_operation_id` para que el cliente pueda hacer polling del estado de la operación ya existente.

---

## Observabilidad y seguridad

### Observabilidad

- **Eventos Kafka** (`platform.backup.operation.events`): emitidos en cada transición de estado significativa (`accepted`, `in_progress`, `completed`, `failed`). Cada evento incluye `operation_id`, `type`, `tenant_id`, `component_type`, `status`, `timestamp`.
- **Evento de auditoría de acceso** (US-OBS-01): cada solicitud de mutación (POST /trigger, POST /restore) genera un evento con `actor`, `tenant_id`, `component_type`, `operation_type`, `timestamp` y flag `destructive` (true para restore).
- **Log estructurado**: los handlers y el dispatcher emiten logs con `operation_id`, `tenant_id`, `component_type`, `status`, `duration_ms` y (en caso de fallo) `failure_reason`.
- **Métricas sugeridas** (via Prometheus): `backup_operations_total{type, status}`, `backup_dispatcher_duration_ms{type}`, `backup_adapter_timeout_total{component_type}`.

### Seguridad

- Las credenciales del adaptador para mutaciones (`backup-mutator` ServiceAccount) se almacenan en un Secret de Kubernetes separado del ServiceAccount de solo lectura usado por el colector de T01.
- Los campos `failure_reason` (detalle técnico) y `adapter_operation_id` no se incluyen en respuestas a tokens sin scope `backup-status:read:technical`.
- Los identificadores de snapshots no pueden contener ni exponer rutas internas de almacenamiento, namespaces de Kubernetes, credenciales ni connection strings. El adaptador es responsable de sanitizar los datos antes de devolverlos al handler.
- El endpoint de restore valida el `snapshot_id` contra la lista real de snapshots del adaptador antes de crear el registro de operación. Esto previene que un actor use un ID fabricado para disparar un restore sobre un estado inexistente.
- El rate limiting en APISIX para los endpoints de mutación es más restrictivo que para los de consulta (5 req/s para trigger, 2 req/s para restore vs 10–20 req/s para consultas).
- La acción `trigger-restore.action` no tiene fallback de permisos: si el scope `backup:restore:global` no está presente en el token, la acción devuelve `HTTP 403` sin ninguna información adicional sobre el recurso.

---

## Dependencias entre módulos de esta tarea

```text
T-A (Migración DB: backup_operations) ──► T-B (OperationsRepository DAL)
                                               │
         ┌─────────────────────────────────────┘
         │
         ▼
T-C (Extensión de types.ts + registry.ts)
         │
         ├──► T-D (PostgresAdapter: triggerBackup, triggerRestore, listSnapshots)
         │
         ├──► T-E (trigger-backup.action + trigger-restore.action)
         │          │
         │          └──► T-F (OperationDispatcher)
         │
         ├──► T-G (get-operation.action)
         │
         ├──► T-H (list-snapshots.action)
         │
         └──► T-I (APISIX routes + Keycloak scopes + Helm)
                   │
                   ▼
              T-J (Frontend: BackupOperationsPage, TriggerBackupButton,
                             TriggerRestoreDialog, SnapshotSelector,
                             OperationHistoryPanel, useOperationStatus)
                   │
                   ▼
              T-K (Tests: unit + integration + contract + E2E)

```

### Paralelización posible

- **T-D, T-E, T-F, T-G, T-H** pueden desarrollarse en paralelo una vez que T-C está completo.
- **T-J** (frontend) puede comenzar con mocks del API en cuanto T-C y los schemas de respuesta estén definidos.
- **T-I** (infraestructura) puede comenzar en paralelo con T-D/T-E si hay disponibilidad.

---

## Criterios de completado con evidencia verificable

| Criterio | Evidencia |
|---|---|
| La migración `002_backup_operations.sql` se ejecuta sin errores | `psql` muestra la tabla `backup_operations` con todas las columnas, índices y tipos ENUM |
| `POST /v1/backup/trigger` crea una operación y retorna 202 | Test de integración: respuesta `{ operation_id, status: 'accepted' }` con código HTTP 202 |
| `POST /v1/backup/restore` rechaza a tenant_owner con 403 | Test de integración: token con rol `tenant_owner` → 403 sin information leakage |
| La operación transiciona a `completed` o `failed` correctamente | Test de integración: consultar `GET /operations/:id` tras despacho → estado final con timestamps |
| El aislamiento multi-tenant funciona para mutaciones | Test de integración: tenant_owner intenta operar sobre tenant ajeno → 403 |
| El endpoint de restore rechaza snapshot inexistente con 422 semántico | Test unitario del handler + test de integración |
| El conflict check devuelve 409 con `conflict_operation_id` | Test de integración: crear operación activa → POST nuevo → 409 con id correcto |
| El motivo técnico no se expone al tenant_owner | Test de contrato: respuesta con token tenant_owner no incluye `failure_reason` |
| La consola muestra botones solo cuando el adaptador declara la capacidad | Test de componente React: render con capabilities mock → botones visibles/ocultos según esperado |
| El botón de restore no aparece en la consola del tenant owner | Test de componente React: render BackupSummaryPage con rol tenant_owner → DOM sin TriggerRestoreDialog |
| El dispatcher emite evento Kafka en cada transición | Test unitario del dispatcher: spy en kafka.produce → llamada con payload correcto |
| Los endpoints de T01 siguen funcionando sin cambios | Test de regresión: `GET /v1/backup/status` responde con schema `v1` idéntico al de T01 |

---

*Documento generado para el stage `speckit.plan` — US-BKP-01-T02 | Rama: `110-backup-admin-endpoints`*
