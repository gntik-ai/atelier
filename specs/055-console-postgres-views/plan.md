# Plan técnico de implementación — US-UI-03-T01

**Feature Branch**: `055-console-postgres-views`  
**Task ID**: US-UI-03-T01  
**Epic**: EP-15 — Consola de administración: dominios funcionales  
**Historia padre**: US-UI-03 — Consola de gestión de PostgreSQL, MongoDB, Kafka, Functions y Storage  
**Fecha del plan**: 2026-03-29  
**Estado**: Ready for tasks

---

## 1. Objetivo y alcance estricto de T01

Construir, dentro de `apps/web-console/`, una nueva vista protegida de **PostgreSQL** que exponga la jerarquía completa de recursos del dominio relacional (bases → esquemas → tablas → columnas / índices / políticas RLS, y vistas / vistas materializadas) más un panel de preview DDL. La entrega cubre:

1. **Navegación jerárquica** base de datos → esquema → tabla y base de datos → esquema → vista(s).  
2. **Secciones de detalle read-only** por entidad: columnas, índices, políticas RLS, seguridad de tabla.  
3. **Preview DDL** invocado con `executionMode=preview` para recursos que lo soporten, mostrando `ddlPreview`, `preExecutionWarnings` y `riskProfile`. Estrictamente de lectura; sin affordance para ejecutar la mutación.  
4. **Reactividad de contexto**: recarga automática al cambiar tenant o workspace activo.

### Fuera de alcance en T01

- CRUD de bases, esquemas, tablas, columnas, índices, vistas, políticas.
- MongoDB, Kafka, Functions, Storage (T02–T05).
- E2E multi-servicio (T06).
- Cambios en `apps/control-plane/`, family files OpenAPI, base de datos, Helm o infraestructura.

---

## 2. Estado actual relevante del repositorio

### Baseline disponible

Las tareas previas del EP-14 dejaron operativos:

- `ConsoleContextProvider` con `activeTenant`, `activeTenantId`, `activeWorkspace`, `activeWorkspaceId` y persistencia por usuario (`console-context.tsx`).
- Shell protegido con selector de tenant/workspace, navegación lateral y panel de estado contextual (`ConsoleShellLayout.tsx`).
- Patrón de carga de datos: llamadas directas con `requestConsoleSessionJson()` desde la página, estados locales por sección, y errores aislados. Consolidado en `ConsoleAuthPage.tsx` y `ConsoleMembersPage.tsx`.
- Rutas hijas del shell ya definidas en `router.tsx`.

### Rutas existentes relevantes

| Ruta | Página | Estado |
|---|---|---|
| `/console/auth` | `ConsoleAuthPage` | Activa |
| `/console/members` | `ConsoleMembersPage` | Activa |

La nueva ruta `/console/postgres` se añade como ruta hija más en el shell, sin tocar las rutas existentes.

### Contratos disponibles en `postgres.openapi.json`

Todos los endpoints `GET` necesarios existen:

| Endpoint | Respuesta |
|---|---|
| `GET /v1/postgres/databases` | `PostgresDatabaseCollection` |
| `GET /v1/postgres/databases/{db}/schemas` | `PostgresSchemaCollection` |
| `GET /v1/postgres/databases/{db}/schemas/{schema}/tables` | `PostgresTableCollection` |
| `GET /v1/postgres/databases/{db}/schemas/{schema}/tables/{table}/columns` | `PostgresColumnCollection` |
| `GET /v1/postgres/databases/{db}/schemas/{schema}/tables/{table}/indexes` | `PostgresIndexCollection` |
| `GET /v1/postgres/databases/{db}/schemas/{schema}/tables/{table}/policies` | `PostgresPolicyCollection` |
| `GET /v1/postgres/databases/{db}/schemas/{schema}/tables/{table}/security` | `PostgresTableSecurity` |
| `GET /v1/postgres/databases/{db}/schemas/{schema}/views` | `PostgresViewCollection` |
| `GET /v1/postgres/databases/{db}/schemas/{schema}/materialized-views` | `PostgresMaterializedViewCollection` |

El preview DDL se obtiene mediante `PUT` (o el endpoint de escritura equivalente) con `executionMode=preview`. Dado que T01 es **estrictamente read-only**, el panel DDL sólo se activa si el family file expone una operación de preview segura sin side-effects; en caso contrario, el panel mostrará el resultado de la última respuesta `ddlPreview` embebida en `PostgresAdminMutationAccepted` que el backend devolvería ante una petición de prueba. Se documenta la integración exacta en la subtarea de tasks.

---

## 3. Decisiones técnicas

| Decisión | Elección | Justificación |
|---|---|---|
| Ruta de consola | `/console/postgres` con `ConsolePostgresPage` | Semántica del shell; separación limpia del dominio relacional. |
| Ítem de navegación | `PostgreSQL` entre `Auth` y `Functions` con icono `Database` (ya importado en shell) | Consistencia con la lista de ítems existentes; `Database` ya está importado. |
| Estado de navegación | `selectedDatabase`, `selectedSchema`, `selectedTable`, `detailTab` como `useState` local en la página | El breadcrumb es UI-only; no requiere store ni URL params en T01. Mantiene el patrón existente. |
| Carga de datos | `requestConsoleSessionJson()` directo desde la página con `useEffect` reactivo a los IDs seleccionados | Idéntico al patrón de `ConsoleAuthPage` y `ConsoleMembersPage`. No introduce stores ni módulos de datos nuevos. |
| Paginación | `page[size]=100` en todas las colecciones | Sigue el patrón consolidado en T04/T03. Evita paginación interactiva en esta entrega. |
| Estados por sección | Estado local separado por colección (`databases`, `schemas`, `tables`, `columns`, `indexes`, `policies`, `security`, `views`, `matViews`, `ddlPreview`) con flag `loading`, dato y `error` por cada uno | Permite degradación parcial por fallo de una sección sin colapsar la página. |
| Vistas vs vistas materializadas | Renderizadas en tabs separadas dentro de la sección "Vistas" del esquema | Diferenciación visual clara sin duplicar el nivel de navegación. |
| Detalle de tabla | Tabs `Columns`, `Indexes`, `Policies`, `Security` dentro de la sección de tabla | Patrón tab idéntico al usado en otras páginas del shell con shadcn/ui. |
| DDL Preview | Panel colapsable activado por botón `Preview DDL` en el detalle de tabla/vista | Read-only estricto; sin botón de ejecución. Muestra `statements`, `preExecutionWarnings` y `riskProfile`. |
| Aislamiento de contexto | Reset de todos los estados de selección y de datos al cambiar `activeTenantId` o `activeWorkspaceId` | Evita mezclar datos de contextos distintos. |
| Accesibilidad | Tablas semánticas `<table>`, `role="alert"` en errores, breadcrumb con `<nav aria-label>`, botones de retry con etiquetas descriptivas | Alineado con FR-021 y patrones del shell. |
| Permisos | Confiar en errores `401/403` del backend por sección | Sin reimplementar autorización en frontend. |

---

## 4. Arquitectura objetivo

```text
ConsoleContextProvider (existente)
  └─► expone activeTenantId, activeWorkspaceId

ConsolePostgresPage (/console/postgres)
  │
  ├─► [nivel 1] loadDatabases(tenantId)
  │     └─► GET /v1/postgres/databases?page[size]=100
  │           └─► lista de PostgresDatabase
  │
  ├─► [nivel 2 — al seleccionar database] loadSchemas(databaseName)
  │     └─► GET /v1/postgres/databases/{db}/schemas?page[size]=100
  │           └─► lista de PostgresSchema
  │
  ├─► [nivel 3a — al seleccionar schema] loadTables(db, schema)
  │     └─► GET /v1/postgres/databases/{db}/schemas/{schema}/tables?page[size]=100
  │           └─► lista de PostgresTable
  │
  ├─► [nivel 3b — al seleccionar schema] loadViews(db, schema)
  │     └─► GET /v1/postgres/databases/{db}/schemas/{schema}/views?page[size]=100
  │           └─► lista de PostgresView
  │
  ├─► [nivel 3c — al seleccionar schema] loadMatViews(db, schema)
  │     └─► GET /v1/postgres/databases/{db}/schemas/{schema}/materialized-views?page[size]=100
  │           └─► lista de PostgresMaterializedView
  │
  └─► [nivel 4 — al seleccionar table] (paralelo)
        ├─► GET .../columns?page[size]=100    → PostgresColumnCollection
        ├─► GET .../indexes?page[size]=100    → PostgresIndexCollection
        ├─► GET .../policies?page[size]=100   → PostgresPolicyCollection
        └─► GET .../security                  → PostgresTableSecurity

DDL Preview panel (bajo demanda, activado por botón en tabla o vista)
  └─► Invocación segura con executionMode=preview; muestra ddlPreview, preExecutionWarnings, riskProfile
```

### Límites entre componentes

| Componente | Responsabilidad | Fuera de alcance |
|---|---|---|
| `console-context.tsx` | Mantener tenant/workspace activos | Sin cambios |
| `ConsoleShellLayout.tsx` | Navegación lateral persistente | Solo se añade un ítem |
| `router.tsx` | Registrar ruta protegida | Solo se añade una ruta hija |
| `ConsolePostgresPage.tsx` | Nueva página autocontenida de PostgreSQL | Sin escrituras ni formularios |
| Páginas existentes | Sin cambios | No se toca ninguna página previa |

---

## 5. Cambios propuestos por artefacto o carpeta

### 5.1 `apps/web-console/src/pages/ConsolePostgresPage.tsx` (nuevo)

Página única autocontenida. Estructura interna:

#### 5.1.1 Tipos locales (inline en el archivo, sin módulo separado)

```ts
// Subset de los schemas del family file relevantes para la UI
type PgDatabase = { databaseName: string; state: string; ownerRoleName: string; placementMode: string; tenantId: string; workspaceId?: string }
type PgSchema   = { schemaName: string; state: string; ownerRoleName: string; objectCounts?: { tables: number; views: number; materializedViews: number; indexes: number } }
type PgTable    = { tableName: string; state: string; columnCount: number }
type PgColumn   = { columnName: string; dataType: { typeName: string }; nullable: boolean; defaultExpression?: string; ordinalPosition?: number }
type PgIndex    = { indexName: string; indexMethod: string; unique?: boolean; keys?: Array<{ columnName: string }>; includeColumns?: string[] }
type PgPolicy   = { policyName: string; policyMode: string; state: string; appliesTo?: { command?: string; roles?: string[] }; usingExpression?: string; withCheckExpression?: string }
type PgSecurity = { rlsEnabled: boolean; forceRls: boolean; policyCount?: number; sharedTableClassification?: string; state: string }
type PgView     = { viewName: string; state: string; columns?: string[]; query?: string; securityBarrier?: boolean }
type PgMatView  = { viewName: string; state: string; columns?: string[]; withData?: boolean; refreshPolicy?: string; integrityProfile?: { populationState?: string } }
type PgDdlStatement = { ordinal: number; category: string; destructive: boolean; sql: string }
type PgDdlPreview   = { executionMode: string; statementCount: number; statements: PgDdlStatement[]; transactionMode: string; safeGuards?: string[]; lockTargets?: string[] }
type PgWarning      = { warningCode: string; severity: string; category: string; summary: string; impactLevel: string; requiresAcknowledgement: boolean; detail?: string }
type PgRiskProfile  = { riskLevel: string; statementCount: number; lockTargetCount: number; blockingLikely: boolean; destructive: boolean; acknowledgementRequired: boolean }
type CollectionOf<T> = { items: T[]; page?: { total?: number } }
```

#### 5.1.2 Estado de la página

```ts
// Contexto activo
activeTenantId, activeWorkspaceId  (de useConsoleContext)

// Selección de navegación
selectedDatabase:  string | null
selectedSchema:    string | null
selectedTable:     string | null
tableDetailTab:    'columns' | 'indexes' | 'policies' | 'security'
schemaTab:         'tables' | 'views' | 'matviews'

// Datos y estados por sección (patrón repetido: { data, loading, error })
databases:    { data: PgDatabase[]; loading: boolean; error: string | null }
schemas:      { data: PgSchema[];   loading: boolean; error: string | null }
tables:       { data: PgTable[];    loading: boolean; error: string | null }
columns:      { data: PgColumn[];   loading: boolean; error: string | null }
indexes:      { data: PgIndex[];    loading: boolean; error: string | null }
policies:     { data: PgPolicy[];   loading: boolean; error: string | null }
security:     { data: PgSecurity | null; loading: boolean; error: string | null }
views:        { data: PgView[];     loading: boolean; error: string | null }
matViews:     { data: PgMatView[];  loading: boolean; error: string | null }

// DDL Preview
ddlPreviewOpen:    boolean
ddlPreviewTarget:  { kind: 'table' | 'view' | 'matview'; name: string } | null
ddlPreview:        { data: PgDdlPreview | null; warnings: PgWarning[]; riskProfile: PgRiskProfile | null; loading: boolean; error: string | null }
```

#### 5.1.3 Efectos reactivos

- `useEffect([activeTenantId])` → resetea toda la selección y recarga databases.
- `useEffect([selectedDatabase])` → resetea esquemas/tablas/vistas/detalle y carga schemas si `selectedDatabase !== null`.
- `useEffect([selectedSchema])` → resetea tablas/vistas/detalle; carga tables, views y matviews en paralelo si `selectedSchema !== null`.
- `useEffect([selectedTable])` → carga columns, indexes, policies y security en paralelo si `selectedTable !== null`.
- `useEffect([activeWorkspaceId, selectedDatabase])` → recarga schemas cuando cambia workspace (schemas son workspace-scoped).

#### 5.1.4 Composición visual

```text
ConsolePostgresPage
├── Header (badge "PostgreSQL", tenant/workspace activos, descripción)
├── Breadcrumb nav (DB > Schema > Table/View)
├── [sin tenant] → EmptyState "Selecciona un tenant"
├── DatabasesPanel
│   ├── loading spinner | error+retry | empty state
│   └── tabla semántica: databaseName, state badge, ownerRoleName, placementMode
│       └── fila clickable → selectDatabase(db.databaseName)
├── [database seleccionada] SchemasPanel
│   ├── loading | error+retry | empty state
│   └── tabla: schemaName, state, ownerRoleName, counts (tables/views/matviews/indexes)
│       └── fila clickable → selectSchema(schema.schemaName)
├── [schema seleccionado] SchemaDetailPanel (tabs: "Tablas" | "Vistas" | "Vistas materializadas")
│   ├── TablasTabulada
│   │   ├── loading | error+retry | empty state
│   │   └── tabla: tableName, state, columnCount
│   │       └── fila clickable → selectTable(table.tableName)
│   ├── VistasTab
│   │   ├── loading | error+retry | empty state
│   │   └── tabla: viewName, state, columns joined, securityBarrier
│   │       └── botón "Preview DDL" → openDdlPreview('view', name)
│   └── VistasMatTab
│       ├── loading | error+retry | empty state
│       └── tabla: viewName, state, withData badge, refreshPolicy, integrityProfile.populationState
│           └── botón "Preview DDL" → openDdlPreview('matview', name)
└── [tabla seleccionada] TableDetailPanel (tabs: "Columns" | "Indexes" | "Policies" | "Security")
    ├── ColumnsTab: tabla columnName, dataType.typeName, nullable, defaultExpression, ordinalPosition
    ├── IndexesTab: tabla indexName, indexMethod, unique, keys mapped, includeColumns
    ├── PoliciesTab: tabla policyName, policyMode, appliesTo.command, appliesTo.roles, usingExpression truncada
    ├── SecurityTab: cards rlsEnabled, forceRls, policyCount, sharedTableClassification, state
    └── botón "Preview DDL" en el header del panel → openDdlPreview('table', tableName)

DdlPreviewDrawer (panel colapsable / modal)
├── loading | error legible
├── RiskProfile card (riskLevel badge coloreado, destructive, blockingLikely, acknowledgementRequired)
├── PreExecutionWarnings list (badge de severidad coloreado, summary, detail)
└── DDL Statements list (ordinal, category badge, destructive indicator, <pre><code> sql)
    └── Sin botón de ejecutar
```

#### 5.1.5 Estados vacíos y de error

- Sin tenant activo → empty state global con mensaje "Selecciona un tenant para explorar las bases de datos PostgreSQL."
- Sin workspace activo → databases visible; schemas/tables/views → empty state contextual "Selecciona un workspace para ver esquemas."
- Colección vacía → empty state específico por nivel (p. ej. "Este esquema no tiene tablas definidas.").
- Error de API → `role="alert"`, mensaje del `error.message` de la respuesta, botón `Reintentar`.
- Error parcial (p. ej. falla `indexes` pero `columns` responde) → cada tab muestra su propio error de forma aislada.

---

### 5.2 `apps/web-console/src/router.tsx` (modificar)

- Importar `ConsolePostgresPage` (lazy).
- Añadir ruta hija `{ path: 'postgres', element: <ConsolePostgresPage /> }` dentro de `ConsoleShellLayout`.

### 5.3 `apps/web-console/src/layouts/ConsoleShellLayout.tsx` (modificar)

- Añadir ítem al array `consoleNavigationItems`:

```ts
{
  label: 'PostgreSQL',
  to: '/console/postgres',
  icon: Database,          // ya importado de lucide-react
  description: 'Bases de datos, esquemas, tablas, índices, vistas y preview DDL.'
}
```

- Posición: entre `Auth` y `Functions` (índice 5 en el array actual).
- Sin cambios en el resto del layout.

### 5.4 Tests

| Archivo | Tipo | Qué cubre |
|---|---|---|
| `apps/web-console/src/pages/ConsolePostgresPage.test.tsx` | Integración ligera (vitest + testing-library) | Ver §8 |
| `apps/web-console/src/layouts/ConsoleShellLayout.test.tsx` | Integración ligera | Presencia y destino del link `PostgreSQL` |

No se necesitan cambios de contrato ni nuevos tests de control-plane.

---

## 6. Modelo de datos y contratos UI

### Endpoints consumidos (solo GET y preview)

| Operación | Parámetros clave | Scoping |
|---|---|---|
| `GET /v1/postgres/databases` | `page[size]=100` | tenant-scoped (header de sesión) |
| `GET /v1/postgres/databases/{db}/schemas` | `page[size]=100` | workspace-scoped |
| `GET /v1/postgres/databases/{db}/schemas/{schema}/tables` | `page[size]=100` | workspace-scoped |
| `GET .../tables/{table}/columns` | `page[size]=100` | workspace-scoped |
| `GET .../tables/{table}/indexes` | `page[size]=100` | workspace-scoped |
| `GET .../tables/{table}/policies` | `page[size]=100` | workspace-scoped |
| `GET .../tables/{table}/security` | — | workspace-scoped |
| `GET .../schemas/{schema}/views` | `page[size]=100` | workspace-scoped |
| `GET .../schemas/{schema}/materialized-views` | `page[size]=100` | workspace-scoped |
| Preview DDL | `executionMode=preview` o `dryRun=true` según family file | workspace-scoped, read-only efectivo |

### Normalización mínima en UI

No se crea módulo de normalización; la página deriva localmente:
- `dataType` display: `column.dataType.typeName` si está; fallback `"unknown"`.
- `nullable` display: badge "NULL" / "NOT NULL".
- `appliesTo.command` display: uppercase.
- `appliesTo.roles`: joined con coma; si vacío: `"(todos los roles)"`.
- `riskLevel` color: `low` → verde, `medium` → amarillo, `high` → naranja, `critical` → rojo.
- `severity` de warning color: igual que riskLevel.
- SQL statements: `<pre><code>` con fuente monoespaciada; sin highlighting de sintaxis en T01.

---

## 7. Seguridad, aislamiento, compatibilidad y rollback

### Seguridad y permisos

- Todas las llamadas usan `requestConsoleSessionJson()` con la sesión activa; autorización real en backend.
- Errores `401`/`403`/`404` se muestran por sección con el `message` del API; no se infieren permisos adicionales.
- No se persisten datos de PostgreSQL fuera de estado React en memoria.
- El panel de preview DDL no expone ningún affordance de ejecución en T01.

### Aislamiento multi-tenant / multi-workspace

- Al cambiar `activeTenantId`: reset completo + recarga de databases.
- Al cambiar `activeWorkspaceId`: reset de selección de schema en adelante + recarga de schemas (si hay database seleccionada).
- Uso de flags de cancelación en `useEffect` (variable `cancelled` / `AbortController`) para ignorar respuestas en vuelo de un contexto superado.

### Compatibilidad

- No se modifican contratos públicos ni family files.
- No se altera `ConsoleContextProvider`, páginas existentes ni rutas existentes.
- El diff queda acotado a `apps/web-console/src/` y `specs/055-console-postgres-views/`.

### Rollback

Revertir la rama elimina la ruta `/console/postgres`, el ítem de navegación y la página `ConsolePostgresPage.tsx`, sin side effects en datos persistidos ni en otras páginas.

---

## 8. Estrategia de pruebas y validación

### 8.1 `ConsolePostgresPage.test.tsx`

Cobertura mínima obligatoria (vitest + @testing-library/react, mocks de `requestConsoleSessionJson`):

1. **Sin tenant activo** → se muestra empty state global.
2. **Sin workspace activo** → se muestran databases; la sección de esquemas muestra estado contextual.
3. **Carga de bases de datos**: render de tabla con `databaseName`, `state`, `ownerRoleName`.
4. **Selección de base de datos**: llama a `/schemas` y renderiza la lista de esquemas.
5. **Selección de esquema**: llama a `tables`, `views` y `materialized-views` en paralelo; renderiza tabla de tablas.
6. **Selección de tabla**: llama a `columns`, `indexes`, `policies` y `security` en paralelo.
7. **Tab Columns**: muestra `columnName`, tipo, nullable, default.
8. **Tab Indexes**: muestra `indexName`, método, unicidad.
9. **Tab Policies**: muestra `policyName`, `policyMode`, command, roles.
10. **Tab Security**: muestra `rlsEnabled`, `forceRls`, `policyCount`, estado RLS.
11. **Tab Vistas**: muestra `viewName`, estado, columnas expuestas.
12. **Tab Vistas materializadas**: muestra `viewName`, `withData`, diferenciación visual respecto a vistas.
13. **Panel DDL Preview**: al hacer clic en "Preview DDL", llama al endpoint preview y renderiza statements + warnings + riskProfile.
14. **Warnings de alto riesgo**: warnings con `severity=critical` o `severity=high` se resaltan visualmente (clase CSS diferenciada presente en DOM).
15. **Error parcial en una colección** (p. ej. indexes falla): tab `Indexes` muestra error aislado; otras tabs siguen operativas.
16. **Empty state por sección**: tabla sin índices → empty state específico en tab Indexes.
17. **Reset al cambiar tenant**: al cambiar `activeTenantId`, la selección se descarta y se recarga la lista de databases.
18. **Reset al cambiar workspace**: al cambiar `activeWorkspaceId` con database seleccionada, se recargan los esquemas.
19. **Retry**: botón de reintentar en error de databases relanza la llamada.

### 8.2 `ConsoleShellLayout.test.tsx`

Cobertura incremental (los tests existentes no se modifican):

1. El ítem `PostgreSQL` aparece en el sidebar.
2. El link apunta a `/console/postgres`.

### 8.3 Validaciones del paquete

```sh
# Mínimo antes de PR:
corepack pnpm --filter @in-falcone/web-console test
corepack pnpm --filter @in-falcone/web-console typecheck
corepack pnpm --filter @in-falcone/web-console build

# Completar antes de merge:
corepack pnpm lint
corepack pnpm test
```

---

## 9. Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Número elevado de columnas (>100) en una tabla | Media | UX degradada | Scroll vertical con altura máxima en el contenedor de la tabla; no se pagina en T01 pero el diseño lo soporta. |
| Respuestas parciales o lentas en carga paralela | Media | UX confusa | Cada sección tiene su propio estado `loading`; las tabs se muestran aunque una aún cargue. |
| Preview DDL requiere payload de mutación ficticio | Media | Complejidad extra | Revisar family file en tasks: si el endpoint `preview` admite `GET` con query param o si requiere `PUT/POST` con `executionMode=preview`; documentar la estrategia exacta en T02 de tasks. |
| Reset de contexto deja artefactos en vuelo | Alta | Datos mezclados de contextos distintos | `AbortController` por efecto o flag `cancelled` local para ignorar respuestas obsoletas. |
| Tabla sin RLS habilitado + políticas vacías | Alta | Confusión para el operador | Tab Policies muestra estado vacío + badge explícito de RLS status derivado de `security.rlsEnabled`. |
| Base de datos sin esquemas visibles para el workspace | Media | Confusión | Empty state específico en panel de esquemas con mensaje "No hay esquemas visibles para el workspace activo en esta base de datos." |
| Cambio de tenant mientras se ve el detalle de una tabla | Media | Datos obsoletos visibles | `useEffect([activeTenantId])` resetea la selección completa de forma inmediata antes de recargar. |

---

## 10. Dependencias previas y secuencia recomendada

### Dependencias confirmadas

- `US-UI-01` ✅ — shell y contexto activo (ConsoleShellLayout, ConsoleContextProvider)
- `US-UI-02-T01` ✅ — contexto tenant/workspace persistido
- `US-UI-02-T02` ✅ — shell operativo con navegación lateral

No existe dependencia en el backend: todos los endpoints `GET /v1/postgres/...` ya están especificados en `postgres.openapi.json`.

### Secuencia recomendada de implementación

1. Añadir ítem `PostgreSQL` en `ConsoleShellLayout.tsx` y ruta `/console/postgres` en `router.tsx`.
2. Crear `ConsolePostgresPage.tsx` con el scaffold mínimo: empty states y header.
3. Implementar `DatabasesPanel` con carga y render de tabla de bases de datos.
4. Implementar `SchemasPanel` reactivo a `selectedDatabase`.
5. Implementar `SchemaDetailPanel` (tabs tables/views/matviews) reactivo a `selectedSchema`.
6. Implementar `TableDetailPanel` con tabs Columns/Indexes/Policies/Security reactivo a `selectedTable`.
7. Implementar `DdlPreviewDrawer` con visualización de statements, warnings y riskProfile.
8. Implementar manejo de reset al cambiar tenant/workspace con `AbortController`.
9. Completar tests en `ConsolePostgresPage.test.tsx` cubriendo los 19 escenarios del §8.
10. Añadir test incremental en `ConsoleShellLayout.test.tsx`.
11. Ejecutar validaciones del paquete y del repo.

Los pasos 2–6 son paralelizables si se trabaja en ramas de feature dentro de la misma historia, pero deben mergearse en orden para respetar la jerarquía de datos.

---

## 11. Criterios de done verificables

La tarea queda cerrada cuando exista evidencia de que:

1. `/console/postgres` existe dentro del shell protegido y el ítem `PostgreSQL` aparece en la navegación lateral.
2. Un operador autenticado con tenant activo ve la lista de bases de datos PostgreSQL en ≤ 2 clics desde cualquier otra página del shell.
3. Desde la lista de bases de datos, el operador navega hasta columnas de una tabla en exactamente 3 selecciones (base → esquema → tabla).
4. Los esquemas y sub-recursos se recargan automáticamente al cambiar workspace activo.
5. Los estados carga, vacío y error están cubiertos por test automatizado por cada nivel de la jerarquía (databases, schemas, tables, columns, indexes, policies, views, matviews).
6. Las tabs Columns, Indexes, Policies y Security de la vista de tabla están cubiertas por tests automatizados con mocks del family file.
7. El panel DDL Preview muestra statements, warnings y riskProfile sin ningún affordance de ejecución.
8. Los warnings con `severity=high` o `severity=critical` tienen una clase CSS diferenciada verificable en el DOM del test.
9. La página es estrictamente read-only: no existe ningún `<form>`, `<button type="submit">` ni acción de mutación salvo el trigger de preview.
10. `corepack pnpm --filter @in-falcone/web-console test`, `typecheck`, `build`, `corepack pnpm lint` y `corepack pnpm test` quedan en verde.
11. La rama `055-console-postgres-views` se publica, la PR pasa CI y termina mergeada a `main`.

### Evidencia esperada al terminar

- Diff acotado a `apps/web-console/src/` (3 archivos modificados + 2 nuevos) y `specs/055-console-postgres-views/`.
- Validaciones locales verdes del paquete web-console y del repo raíz.
- Sin cambios en `apps/control-plane/`, family files OpenAPI, infra o datos persistidos.
- Commit, PR, checks verdes y merge registrados.
