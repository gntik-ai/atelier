<!-- markdownlint-disable MD024 MD031 -->
# Tasks — US-UIB-02-T02: Endpoints y Componentes UI para Progreso de Operaciones Asíncronas

**Feature Branch**: `074-async-job-progress-ui`
**Task ID**: US-UIB-02-T02
**Estado**: Ready for implement
**Fecha**: 2026-03-30

---

## Resumen ejecutivo

Entregar la capa de consulta pública sobre el modelo de operaciones asíncronas (T01):

1. **Migración DDL** — nueva tabla `async_operation_log_entries` con índices.
2. **Repositorio de consulta** — `async-operation-query-repo.mjs` (SELECT-only, multi-tenant).
3. **Acción OpenWhisk** — `async-operation-query.mjs` con enrutado por `queryType`.
4. **Contrato JSON** — `async-operation-query-response.json` + export en `internal-contracts`.
5. **Hooks React Query** — `console-operations.ts` con polling adaptativo.
6. **Componentes React** — 4 componentes atómicos + 2 páginas + integración en shell.
7. **Tests** — unitarios, integración, contrato y frontend.
8. **ADR** — `docs/adr/074-async-job-progress-ui.md`.

---

## Mapa de archivos de implementación

### Archivos a crear

| Archivo | Acción |
|---|---|
| `services/provisioning-orchestrator/src/migrations/074-async-operation-log-entries.sql` | Crear |
| `services/provisioning-orchestrator/src/repositories/async-operation-query-repo.mjs` | Crear |
| `services/provisioning-orchestrator/src/actions/async-operation-query.mjs` | Crear |
| `services/internal-contracts/src/async-operation-query-response.json` | Crear |
| `apps/web-console/src/lib/console-operations.ts` | Crear |
| `apps/web-console/src/components/console/OperationStatusBadge.tsx` | Crear |
| `apps/web-console/src/components/console/OperationLogEntriesList.tsx` | Crear |
| `apps/web-console/src/components/console/OperationResultSummary.tsx` | Crear |
| `apps/web-console/src/components/console/ActiveOperationsIndicator.tsx` | Crear |
| `apps/web-console/src/pages/ConsoleOperationsPage.tsx` | Crear |
| `apps/web-console/src/pages/ConsoleOperationDetailPage.tsx` | Crear |
| `tests/unit/async-operation-query-repo.test.mjs` | Crear |
| `tests/integration/async-operation-query-integration.test.mjs` | Crear |
| `tests/contract/async-operation-query-response.test.mjs` | Crear |
| `apps/web-console/src/components/console/OperationStatusBadge.test.tsx` | Crear |
| `apps/web-console/src/components/console/OperationLogEntriesList.test.tsx` | Crear |
| `apps/web-console/src/components/console/OperationResultSummary.test.tsx` | Crear |
| `apps/web-console/src/components/console/ActiveOperationsIndicator.test.tsx` | Crear |
| `apps/web-console/src/pages/ConsoleOperationsPage.test.tsx` | Crear |
| `apps/web-console/src/pages/ConsoleOperationDetailPage.test.tsx` | Crear |
| `apps/web-console/src/lib/console-operations.test.ts` | Crear |
| `docs/adr/074-async-job-progress-ui.md` | Crear |

### Archivos a modificar

| Archivo | Cambio |
|---|---|
| `services/internal-contracts/src/index.mjs` | Añadir export de `async-operation-query-response.json` |
| `apps/web-console/src/router.tsx` | Añadir rutas `/console/operations` y `/console/operations/:operationId` |
| `apps/web-console/src/layouts/ConsoleShellLayout.tsx` | Añadir nav item "Operations" y montar `ActiveOperationsIndicator` |
| `AGENTS.md` | Añadir entrada para 074-async-job-progress-ui en Recent Changes |

### Archivos de referencia obligatoria (solo lectura)

| Archivo | Por qué se necesita |
|---|---|
| `services/provisioning-orchestrator/src/repositories/async-operation-repo.mjs` | Patrón de repositorio PG ESM; imports de `pg`, estructura de funciones |
| `services/provisioning-orchestrator/src/actions/job-status.mjs` | Patrón de acción OpenWhisk existente; extracción de `callerContext` |
| `services/provisioning-orchestrator/src/models/async-operation.mjs` | Tipos de estado (`pending`, `running`, `completed`, `failed`) y campos de `async_operations` |
| `services/internal-contracts/src/index.mjs` | Punto de export actual para añadir el nuevo contrato |
| `apps/web-console/src/router.tsx` | Estructura de rutas existente y uso de `ProtectedRoute` |
| `apps/web-console/src/layouts/ConsoleShellLayout.tsx` | Estructura actual del shell para insertar nav + indicator |
| `apps/web-console/src/lib/http.ts` | Función base para llamadas HTTP autenticadas con Keycloak |

> **Regla token-optimization**: el implement debe leer ÚNICAMENTE los archivos de las tablas anteriores. No leer el schema completo de OpenAPI ni otros repositorios no listados.

---

## Tarea T1 — Migración DDL: `async_operation_log_entries`

### Archivo

`services/provisioning-orchestrator/src/migrations/074-async-operation-log-entries.sql`

### Contenido completo

```sql
-- Migration 074: async_operation_log_entries
-- Adds the log entries table for async operation progress (US-UIB-02-T02).
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Rollback: DROP TABLE IF EXISTS async_operation_log_entries;

CREATE TABLE IF NOT EXISTS async_operation_log_entries (
  log_entry_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id   UUID        NOT NULL REFERENCES async_operations(operation_id) ON DELETE CASCADE,
  tenant_id      TEXT        NOT NULL,
  level          TEXT        NOT NULL DEFAULT 'info',
  message        TEXT        NOT NULL,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata       JSONB,
  CONSTRAINT async_op_log_entries_level_check
    CHECK (level IN ('info', 'warning', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_async_op_log_entries_operation
  ON async_operation_log_entries(operation_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_async_op_log_entries_tenant
  ON async_operation_log_entries(tenant_id);
```

### Notas

- `level` values: `'info'`, `'warning'`, `'error'`.
- `message` es texto orientado al usuario; sin stack traces ni datos de conexión.
- `metadata` JSONB reservado para contexto adicional estructurado.
- La escritura de entradas es responsabilidad del workflow que ejecuta la operación (fuera de este alcance). Esta tarea solo expone la consulta.

---

## Tarea T2 — Repositorio de consulta: `async-operation-query-repo.mjs`

### Archivo

`services/provisioning-orchestrator/src/repositories/async-operation-query-repo.mjs`

### Interfaz de funciones

```js
/**
 * List operations for a tenant with optional filters and pagination.
 * @param {import('pg').Pool} db
 * @param {{ tenant_id: string|null, status?: string, operationType?: string,
 *           workspaceId?: string, limit?: number, offset?: number,
 *           isSuperadmin?: boolean }} params
 * @returns {Promise<{ items: object[], total: number }>}
 */
export async function listOperations(db, params) {}

/**
 * Get a single operation by ID, enforcing tenant isolation.
 * @param {import('pg').Pool} db
 * @param {{ operation_id: string, tenant_id: string|null, isSuperadmin?: boolean }} params
 * @returns {Promise<object|null>}  null if not found or belongs to another tenant
 */
export async function getOperationById(db, params) {}

/**
 * Get paginated log entries for an operation, enforcing tenant isolation.
 * @param {import('pg').Pool} db
 * @param {{ operation_id: string, tenant_id: string, limit?: number, offset?: number }} params
 * @returns {Promise<{ entries: object[], total: number }>}
 */
export async function getOperationLogs(db, params) {}

/**
 * Get the final result projection for a terminal (or any) operation.
 * @param {import('pg').Pool} db
 * @param {{ operation_id: string, tenant_id: string }} params
 * @returns {Promise<object|null>}
 */
export async function getOperationResult(db, params) {}
```

### Reglas de implementación

- **Tenant isolation invariant**: `listOperations`, `getOperationById`, `getOperationLogs` y `getOperationResult` SIEMPRE filtran por `tenant_id`. Si `tenant_id` es `null` y `isSuperadmin` no es `true`, lanzar `Error('TENANT_ISOLATION_VIOLATION')`.
- **Paginación**: `limit` máximo 100, por defecto 20. `offset` por defecto 0. Devolver siempre el campo `total` con `COUNT(*)`.
- **`getOperationLogs`**: JOIN implícito con `async_operations` para verificar `tenant_id` antes de devolver los logs. Usar `idx_async_op_log_entries_operation`.
- **`getOperationResult`**: proyectar campos `status`, `result` (JSONB), `error_summary` (JSONB) de `async_operations`. Derivar `resultType`:
  - `status = 'completed'` → `resultType: 'success'`
  - `status = 'failed'` → `resultType: 'failure'`
  - `status = 'pending'|'running'` → `resultType: 'pending'`
- **`listOperations`**: ordenar por `created_at DESC`. Filtros opcionales `status`, `operationType`, `workspaceId` añaden cláusulas `AND` al WHERE.
- Módulo ESM puro: sin efectos secundarios en import. Todas las funciones reciben `db` como primer argumento.

---

## Tarea T3 — Acción OpenWhisk: `async-operation-query.mjs`

### Archivo

`services/provisioning-orchestrator/src/actions/async-operation-query.mjs`

### Flujo de ejecución

```text
Input: { queryType, operationId?, filters?, pagination?, ...callerContext injected by OW }

1. Extraer tenant_id y actorType de callerContext (IAM-verified; nunca del payload)
2. Validar queryType ∈ { 'list', 'detail', 'logs', 'result' } → VALIDATION_ERROR si inválido
3. Para queryType ∈ { 'detail', 'logs', 'result' }: verificar que operationId está presente → VALIDATION_ERROR
4. Resolver isSuperadmin = (actorType === 'superadmin')
   - Si isSuperadmin: tenant_id puede venir de filters.tenantId del payload
   - Si no: tenant_id siempre del callerContext; ignorar cualquier tenantId del payload
5. Delegar a función correspondiente de async-operation-query-repo.mjs
6. Para queryType = 'result': si resultType === 'pending' → responder { resultType: 'pending' } sin error OPERATION_NOT_TERMINAL
7. Auditoría (async, best-effort, no bloquea): publicar evento Kafka 'console.async-operation.accessed'
   con campos: { actorId, tenantId, operationId?, queryType, timestamp }
8. Retornar payload formateado según queryType
```

### Errores

| Código | Condición |
|---|---|
| `VALIDATION_ERROR` | `queryType` inválido u `operationId` faltante para detail/logs/result |
| `NOT_FOUND` | Operación no existe o no pertenece al tenant |
| `FORBIDDEN` | Actor sin permisos sobre el recurso |
| `TENANT_ISOLATION_VIOLATION` | Intento cross-tenant sin ser superadmin |

### Observabilidad

- Emitir log JSON estructurado por invocación: `{ operation_id, tenant_id, actor_id, queryType, durationMs }`.
- Publicar métrica `async_operation_query_total{queryType}` y `async_operation_query_duration_seconds{queryType}`.

---

## Tarea T4 — Contrato JSON: `async-operation-query-response.json`

### Archivo

`services/internal-contracts/src/async-operation-query-response.json`

### Estructura

JSON Schema Draft-07 con `oneOf` discriminado por `queryType`. Cuatro variantes:

**Variante `list`**:
```json
{
  "properties": {
    "items": { "type": "array", "items": { "$ref": "#/definitions/OperationSummary" } },
    "total": { "type": "integer" },
    "pagination": { "$ref": "#/definitions/Pagination" }
  },
  "required": ["items", "total", "pagination"]
}
```

**Variante `detail`**:
```json
{
  "properties": {
    "operationId": { "type": "string", "format": "uuid" },
    "status": { "type": "string", "enum": ["pending", "running", "completed", "failed"] },
    "operationType": { "type": "string" },
    "tenantId": { "type": "string" },
    "workspaceId": { "type": ["string", "null"] },
    "actorId": { "type": "string" },
    "actorType": { "type": "string" },
    "correlationId": { "type": "string" },
    "idempotencyKey": { "type": ["string", "null"] },
    "sagaId": { "type": ["string", "null"] },
    "createdAt": { "type": "string", "format": "date-time" },
    "updatedAt": { "type": "string", "format": "date-time" },
    "errorSummary": { "type": ["object", "null"] }
  },
  "required": ["operationId", "status", "operationType", "tenantId", "actorId", "actorType", "createdAt", "updatedAt"]
}
```

**Variante `logs`**:
```json
{
  "properties": {
    "operationId": { "type": "string", "format": "uuid" },
    "entries": {
      "type": "array",
      "items": {
        "properties": {
          "logEntryId": { "type": "string", "format": "uuid" },
          "level": { "type": "string", "enum": ["info", "warning", "error"] },
          "message": { "type": "string" },
          "occurredAt": { "type": "string", "format": "date-time" }
        },
        "required": ["logEntryId", "level", "message", "occurredAt"]
      }
    },
    "total": { "type": "integer" },
    "pagination": { "$ref": "#/definitions/Pagination" }
  },
  "required": ["operationId", "entries", "total", "pagination"]
}
```

**Variante `result`**:
```json
{
  "properties": {
    "operationId": { "type": "string", "format": "uuid" },
    "status": { "type": "string", "enum": ["pending", "running", "completed", "failed"] },
    "resultType": { "type": "string", "enum": ["success", "failure", "pending"] },
    "summary": { "type": ["string", "null"] },
    "failureReason": { "type": ["string", "null"] },
    "retryable": { "type": ["boolean", "null"] },
    "completedAt": { "type": ["string", "null"], "format": "date-time" }
  },
  "required": ["operationId", "status", "resultType"]
}
```

### Modificación a `services/internal-contracts/src/index.mjs`

Añadir al export existente:

```js
export { default as asyncOperationQueryResponseSchema } from './async-operation-query-response.json' assert { type: 'json' };
```

---

## Tarea T5 — Hooks React Query: `console-operations.ts`

### Archivo

`apps/web-console/src/lib/console-operations.ts`

### Hooks a exportar

```typescript
// Filters for list query
export interface OperationFilters {
  status?: 'pending' | 'running' | 'completed' | 'failed'
  operationType?: string
  workspaceId?: string
}

export interface PaginationParams {
  limit?: number
  offset?: number
}

/**
 * List operations with optional filters. Polls every 30s when any item is pending/running.
 */
export function useOperations(filters?: OperationFilters, pagination?: PaginationParams)
// returns { data: OperationListResponse | undefined, isLoading: boolean, error: Error | null, refetch: () => void }

/**
 * Get detail of a single operation.
 */
export function useOperationDetail(operationId: string | undefined)
// returns { data: OperationDetailResponse | undefined, isLoading: boolean, error: Error | null }

/**
 * Get paginated log entries for an operation.
 */
export function useOperationLogs(operationId: string | undefined, pagination?: PaginationParams)
// returns { data: OperationLogsResponse | undefined, isLoading: boolean, error: Error | null }

/**
 * Get final result of an operation (terminal or pending).
 */
export function useOperationResult(operationId: string | undefined)
// returns { data: OperationResultResponse | undefined, isLoading: boolean, error: Error | null }

/**
 * Count of active (pending|running) operations for the current tenant.
 * Polls every 15s. Stops interval when count is 0.
 */
export function useActiveOperationsCount()
// returns { count: number, isLoading: boolean }
```

### Reglas de implementación

- Todas las llamadas usan la función `http` de `apps/web-console/src/lib/http.ts` con el token de sesión Keycloak.
- Las peticiones se dirigen a la acción OW `async-operation-query` vía APISIX gateway.
- `useOperations`: `refetchInterval` = `30_000` si algún item tiene `status` en `['pending', 'running']`; `false` si no.
- `useActiveOperationsCount`: `refetchInterval` = `15_000`. Se implementa como `useOperations({ status: 'running' }, { limit: 1 })` + un segundo query para `pending`, combinando los `total`. Cuando `count === 0`, `refetchInterval` se establece a `false` hasta la siguiente carga de página.
- Usar `@tanstack/react-query` con `queryKey` estables.

---

## Tarea T6 — Componentes atómicos React

### T6a — `OperationStatusBadge.tsx`

**Archivo**: `apps/web-console/src/components/console/OperationStatusBadge.tsx`

Props:
```typescript
interface OperationStatusBadgeProps {
  status: 'pending' | 'running' | 'completed' | 'failed'
  className?: string
}
```

Colores (shadcn/ui `Badge` variant o className custom):
- `pending` → gris / `secondary`
- `running` → azul animado (pulse) / `default` + `animate-pulse`
- `completed` → verde / `outline` + clase `text-green-600 border-green-600`
- `failed` → rojo / `destructive`

Texto: capitalizar el estado en el idioma del producto (español): `pending` → "Pendiente", `running` → "En curso", `completed` → "Completada", `failed` → "Fallida".

---

### T6b — `OperationLogEntriesList.tsx`

**Archivo**: `apps/web-console/src/components/console/OperationLogEntriesList.tsx`

Props:
```typescript
interface OperationLogEntriesListProps {
  operationId: string
}
```

Comportamiento:
- Usa `useOperationLogs(operationId)`.
- Muestra cada `LogEntry` con: badge de nivel (`info` → azul, `warning` → amarillo, `error` → rojo), mensaje de usuario, timestamp relativo (e.g., `hace 2 min`).
- Estado vacío: `<p role="status">La operación aún no ha comenzado a ejecutarse.</p>`.
- Paginación: botones "Anterior" / "Siguiente" con offset/limit.
- Durante carga: skeleton de 3 filas.

---

### T6c — `OperationResultSummary.tsx`

**Archivo**: `apps/web-console/src/components/console/OperationResultSummary.tsx`

Props:
```typescript
interface OperationResultSummaryProps {
  operationId: string
}
```

Comportamiento:
- Usa `useOperationResult(operationId)`.
- `resultType === 'success'`: muestra `summary` en texto, `completedAt` formateado.
- `resultType === 'failure'`: muestra `failureReason` en lenguaje claro + indicador `retryable` ("Esta operación puede reintentarse" / "Esta operación no puede reintentarse").
- `resultType === 'pending'`: muestra `<p role="status">La operación aún está en curso.</p>`.

---

### T6d — `ActiveOperationsIndicator.tsx`

**Archivo**: `apps/web-console/src/components/console/ActiveOperationsIndicator.tsx`

Comportamiento:
- Usa `useActiveOperationsCount()`.
- Si `count > 0`: renderiza `<Link to="/console/operations"><Badge>{count}</Badge></Link>` con `aria-label="Operaciones activas: {count}"`.
- Si `count === 0`: renderiza `null` (sin elemento en DOM).
- Icono: `Activity` de `lucide-react`.

---

## Tarea T7 — Páginas React

### T7a — `ConsoleOperationsPage.tsx`

**Archivo**: `apps/web-console/src/pages/ConsoleOperationsPage.tsx`

Comportamiento:
- Usa `useOperations(filters, pagination)`.
- Tabla con columnas: Tipo de operación, Estado (`OperationStatusBadge`), Actor, Workspace, Creada.
- Filtros: `<Select>` para `status` y `operationType`; `<Input>` para `workspaceId`.
- Paginación: botones Anterior/Siguiente.
- Click en fila → navegar a `/console/operations/:operationId`.
- Estado vacío: "No hay operaciones registradas para este tenant."
- Estado de error: `<Alert role="alert">` + botón "Reintentar".
- `<h1>Operaciones</h1>` como heading principal.

---

### T7b — `ConsoleOperationDetailPage.tsx`

**Archivo**: `apps/web-console/src/pages/ConsoleOperationDetailPage.tsx`

Comportamiento:
- Extrae `operationId` de `useParams()`.
- Usa `useOperationDetail(operationId)`.
- Renderiza:
  - `<h1>Detalle de operación</h1>` con `OperationStatusBadge` inline.
  - Tabla de metadatos: tipo, actor, workspace, tenant, fechas.
  - Sección "Logs resumidos" con `OperationLogEntriesList`.
  - Sección "Resultado" con `OperationResultSummary`.
- Ruta: `/console/operations/:operationId`.
- 404: si `useOperationDetail` retorna null → `<p>Operación no encontrada o no disponible.</p>`.

---

## Tarea T8 — Rutas y Shell

### T8a — Rutas en `router.tsx`

Añadir en la sección de rutas protegidas:

```tsx
{
  path: '/console/operations',
  element: (
    <ProtectedRoute>
      <Suspense fallback={<PageSkeleton />}>
        <ConsoleOperationsPage />
      </Suspense>
    </ProtectedRoute>
  ),
},
{
  path: '/console/operations/:operationId',
  element: (
    <ProtectedRoute>
      <Suspense fallback={<PageSkeleton />}>
        <ConsoleOperationDetailPage />
      </Suspense>
    </ProtectedRoute>
  ),
},
```

Imports lazy:
```tsx
const ConsoleOperationsPage = lazy(() => import('./pages/ConsoleOperationsPage'))
const ConsoleOperationDetailPage = lazy(() => import('./pages/ConsoleOperationDetailPage'))
```

---

### T8b — `ConsoleShellLayout.tsx`

Añadir:
1. Item de navegación `{ label: 'Operaciones', icon: Activity, path: '/console/operations' }` en el array/config de nav items.
2. Montar `<ActiveOperationsIndicator />` en la barra superior (header), junto a los controles de sesión existentes.

---

## Tarea T9 — Tests

### T9a — Unit tests: `tests/unit/async-operation-query-repo.test.mjs`

Usando `node:test` + `assert`. DB mockeada como objeto `{ query: async (sql, params) => { ... } }`.

Escenarios a cubrir:

| ID | Función | Escenario |
|---|---|---|
| U01 | `listOperations` | Retorna items filtrados por `tenant_id` |
| U02 | `listOperations` | Filtro adicional `status=running` reduce resultados |
| U03 | `listOperations` | `tenant_id=null` sin `isSuperadmin` lanza `TENANT_ISOLATION_VIOLATION` |
| U04 | `listOperations` | Paginación: `limit=5, offset=10` pasa correctamente al query |
| U05 | `getOperationById` | Retorna operación cuando `tenant_id` coincide |
| U06 | `getOperationById` | Retorna `null` cuando `tenant_id` no coincide |
| U07 | `getOperationLogs` | Retorna entradas en orden cronológico |
| U08 | `getOperationLogs` | Retorna `{ entries: [], total: 0 }` cuando no hay entradas |
| U09 | `getOperationResult` | `status=completed` → `resultType: 'success'` |
| U10 | `getOperationResult` | `status=failed` → `resultType: 'failure'`, `retryable` presente |
| U11 | `getOperationResult` | `status=running` → `resultType: 'pending'` |
| U12 | `listOperations` | `limit` se capa a 100 si se pasa > 100 |

---

### T9b — Integration tests: `tests/integration/async-operation-query-integration.test.mjs`

Requiere: instancia PostgreSQL de test. Migración `074-async-operation-log-entries.sql` aplicada antes de los tests.

| ID | Escenario | Evidencia |
|---|---|---|
| I01 | `listOperations` contra PG real con `tenant_id` correcto | Retorna solo ops del tenant |
| I02 | Actor de tenant A no puede ver ops de tenant B | Resultado vacío o error `TENANT_ISOLATION_VIOLATION` |
| I03 | Superadmin puede ver ops de cualquier tenant | Retorna ops del tenant B cuando `isSuperadmin=true` |
| I04 | Listado con 500 registros ficticios responde en < 3 s p95 | `durationMs < 3000` |
| I05 | `getOperationLogs` con join de `tenant_id` | No retorna logs de operación de otro tenant |
| I06 | Paginación correcta: `offset=20, limit=10` devuelve el slice correcto | `items.length === 10` |

---

### T9c — Contract tests: `tests/contract/async-operation-query-response.test.mjs`

Usando `node:test` + AJV (JSON Schema Draft-07).

| ID | `queryType` | Escenario |
|---|---|---|
| C01 | `list` | Payload válido pasa validación AJV |
| C02 | `list` | Payload sin `pagination` falla validación |
| C03 | `detail` | Payload válido con todos los campos requeridos pasa |
| C04 | `detail` | Payload sin `operationId` falla validación |
| C05 | `logs` | Payload con `entries: []` válido pasa |
| C06 | `logs` | Entry con `level` fuera de enum falla |
| C07 | `result` | Payload `resultType: 'success'` pasa |
| C08 | `result` | Payload `resultType: 'failure'` pasa |
| C09 | `result` | Payload `resultType: 'pending'` pasa |
| C10 | `result` | Payload sin `resultType` falla |

---

### T9d — Frontend tests

#### `OperationStatusBadge.test.tsx`

| ID | Escenario |
|---|---|
| F01 | `status='pending'` renderiza texto "Pendiente" y clase/variante gris |
| F02 | `status='running'` renderiza texto "En curso" y contiene `animate-pulse` |
| F03 | `status='completed'` renderiza texto "Completada" y clase verde |
| F04 | `status='failed'` renderiza texto "Fallida" y variante destructive |

#### `OperationLogEntriesList.test.tsx`

| ID | Escenario |
|---|---|
| F05 | Renderiza 2 entradas de log con mensaje y nivel correctos |
| F06 | Estado vacío muestra "La operación aún no ha comenzado a ejecutarse" |
| F07 | Botón "Siguiente" activa paginación |

#### `OperationResultSummary.test.tsx`

| ID | Escenario |
|---|---|
| F08 | `resultType='success'` muestra `summary` y `completedAt` |
| F09 | `resultType='failure'` muestra `failureReason` y texto de reintentabilidad |
| F10 | `resultType='pending'` muestra "La operación aún está en curso" |

#### `ActiveOperationsIndicator.test.tsx`

| ID | Escenario |
|---|---|
| F11 | `count=3` renderiza badge con "3" y link a `/console/operations` |
| F12 | `count=0` no renderiza ningún elemento visible |

#### `ConsoleOperationsPage.test.tsx`

| ID | Escenario |
|---|---|
| F13 | Renderiza tabla con datos mocked (2 operaciones) |
| F14 | Filtro por `status=failed` llama a `useOperations` con parámetro correcto |
| F15 | Estado vacío renderiza "No hay operaciones registradas para este tenant" |
| F16 | Click en fila navega a `/console/operations/:operationId` |

#### `ConsoleOperationDetailPage.test.tsx`

| ID | Escenario |
|---|---|
| F17 | Renderiza heading "Detalle de operación" con `OperationStatusBadge` |
| F18 | Muestra sección "Logs resumidos" con `OperationLogEntriesList` |
| F19 | Muestra sección "Resultado" con `OperationResultSummary` |
| F20 | Operación no encontrada renderiza "Operación no encontrada o no disponible" |

#### `console-operations.test.ts`

| ID | Escenario |
|---|---|
| F21 | `useOperations` activa polling (refetchInterval=30000) cuando hay ops `running` |
| F22 | `useOperations` desactiva polling (refetchInterval=false) cuando todas son `completed` |
| F23 | `useActiveOperationsCount` devuelve suma de `pending` + `running` |
| F24 | `useActiveOperationsCount` devuelve 0 y desactiva polling cuando no hay activas |

---

## Tarea T10 — ADR

### Archivo

`docs/adr/074-async-job-progress-ui.md`

### Contenido mínimo

```markdown
# ADR 074 — Async Job Progress UI: Consulta de operaciones asíncronas

**Fecha**: 2026-03-30
**Estado**: Accepted
**Task**: US-UIB-02-T02

## Decisiones

### D1: Almacenamiento de logs resumidos en PostgreSQL
Tabla `async_operation_log_entries` en PG. Rechazado: MongoDB (inconsistencia operacional sin beneficio para caso tabular).

### D2: Acción OpenWhisk unificada con `queryType`
Una sola acción `async-operation-query` con enrutado interno. Rechazado: 4 acciones separadas (overhead de despliegue sin ganancia).

### D3: Polling con React Query en lugar de WebSocket
Intervalo 15 s para indicador activo; 30 s para listado. Rechazado: SSE/WebSocket (requiere infraestructura adicional no justificada en este alcance).

### D4: `tenant_id` siempre del `callerContext` IAM-verified
Superadmin puede pasar `tenantId` en payload; actores regulares no. Rechazado: `tenant_id` desde payload del cliente (riesgo de escalada de privilegios).

### D5: Resultado final desde campos JSONB existentes en `async_operations`
`result` (éxito) y `error_summary` (fallo) ya reservados por T01. Rechazado: tabla adicional `operation_results` (redundancia).
```

---

## Secuencia de implementación recomendada

```text
1.  T1  — DDL migration: 074-async-operation-log-entries.sql
2.  T2  — async-operation-query-repo.mjs + T9a (unit tests)
3.  T4  — async-operation-query-response.json + export en internal-contracts/index.mjs
4.  T3  — async-operation-query.mjs + T9c (contract tests)
5.  T9b — integration tests (requieren PG de test; se pueden ejecutar en paralelo desde paso 2)
6.  T5  — console-operations.ts + T9d/F21-F24
7.  T6a — OperationStatusBadge + T9d/F01-F04
8.  T6b — OperationLogEntriesList + T9d/F05-F07
9.  T6c — OperationResultSummary + T9d/F08-F10
10. T6d — ActiveOperationsIndicator + T9d/F11-F12
11. T7a — ConsoleOperationsPage + T9d/F13-F16
12. T7b — ConsoleOperationDetailPage + T9d/F17-F20
13. T8a — Rutas en router.tsx
14. T8b — ConsoleShellLayout.tsx (nav item + ActiveOperationsIndicator)
15. T10 — docs/adr/074-async-job-progress-ui.md
16.     — Actualizar AGENTS.md
```

Pasos 2–5 (backend) son paralelizables con 6–10 (frontend hooks + componentes atómicos) una vez que T4 está disponible como referencia de tipos.

---

## Criterios de done

| ID | Criterio | Verificación |
|---|---|---|
| DOD-01 | Tabla `async_operation_log_entries` existe con todos los índices | `\d+ async_operation_log_entries` en psql |
| DOD-02 | Acción OW ejecuta sin error para los 4 queryTypes | `wsk action invoke async-operation-query` con payload válido retorna 200 |
| DOD-03 | Tenant isolation: actor tenant A no accede a ops tenant B | Test I02 pasa en integración |
| DOD-04 | Superadmin cross-tenant read funciona | Test I03 pasa en integración |
| DOD-05 | Contract tests de los 4 queryTypes pasan con AJV | `pnpm -r test` verde en `tests/contract/` |
| DOD-06 | `ConsoleOperationsPage` renderiza listado con datos mocked | Tests F13–F16 verdes |
| DOD-07 | `ConsoleOperationDetailPage` renderiza detalle + logs + resultado | Tests F17–F20 verdes |
| DOD-08 | `ActiveOperationsIndicator` muestra count correcto y oculto con 0 | Tests F11–F12 verdes |
| DOD-09 | Rutas `/console/operations` y `/console/operations/:operationId` accesibles | Test router + verificación manual en dev |
| DOD-10 | Listado < 3 s p95 con 500 operaciones | Test I04 pasa |
| DOD-11 | Logs < 5 s p95 | Medido en test de integración I05/I06 |
| DOD-12 | 100% aislamiento tenant | Tests I01, I02 pasan |
| DOD-13 | Indicador de operaciones activas se actualiza sin recarga | Tests F23–F24 + verificación manual |
| DOD-14 | 500 operaciones históricas sin degradación | Test I04 |
| DOD-15 | Auditoría de accesos generada (evento Kafka) | Verificado en T9c contract test C01 + log estructurado en T9a |
| DOD-16 | `pnpm -r lint`, `pnpm -r typecheck`, `pnpm -r test` pasan en CI | Pipeline CI verde |
| DOD-17 | ADR `074-async-job-progress-ui.md` commit junto al código | Presente en `docs/adr/` en el mismo PR |

---

## Trazabilidad RF / AC

| Tarea / Test | RF / SC spec | AC plan |
|---|---|---|
| T2 `listOperations` + tenant isolation | FR-001, FR-005 | AC-01, AC-02, AC-03 |
| T2 `getOperationLogs` | FR-003, FR-012 | AC-04 |
| T2 `getOperationResult` | FR-004 | AC-05, AC-06, AC-07 |
| T3 action RBAC | FR-006 | AC-01, AC-02, AC-03 |
| T3 auditoría Kafka | FR-010 | AC-10 |
| T6b `OperationLogEntriesList` empty state | FR-011, FR-003 | AC-04 |
| T7a `ConsoleOperationsPage` | FR-007, FR-012 | AC-08 |
| T7b `ConsoleOperationDetailPage` | FR-008 | AC-05, AC-06, AC-07 |
| T6d `ActiveOperationsIndicator` | FR-009 | AC-09 |
| T9b I04 perf | SC-001, SC-006 | AC-08 |
