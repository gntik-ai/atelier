# Tasks — US-UI-03-T01: Vistas de consola para PostgreSQL

**Feature Branch**: `055-console-postgres-views`  
**Task ID**: US-UI-03-T01  
**Epic**: EP-15 — Consola de administración: dominios funcionales  
**Plan de referencia**: `specs/055-console-postgres-views/plan.md`  
**Estado**: Ready for implement  
**Fecha**: 2026-03-29

---

## Mapa de archivos para implement

El agente de implementación debe leer **únicamente** estos archivos antes de ejecutar:

| Archivo | Rol |
|---|---|
| `specs/055-console-postgres-views/plan.md` | Plan técnico completo (decisiones, arquitectura, tipos, tests) |
| `specs/055-console-postgres-views/tasks.md` | Este archivo |
| `apps/control-plane/openapi/families/postgres.openapi.json` | Contratos API de PostgreSQL (GET + preview DDL) |
| `apps/web-console/src/router.tsx` | Rutas actuales del shell (para añadir la nueva) |
| `apps/web-console/src/layouts/ConsoleShellLayout.tsx` | Layout y array `consoleNavigationItems` |
| `apps/web-console/src/layouts/ConsoleShellLayout.test.tsx` | Tests existentes del shell (no modificar; solo añadir) |
| `apps/web-console/src/pages/ConsoleAuthPage.tsx` | Referencia de patrón: tipos inline, `requestConsoleSessionJson`, estado por sección |
| `apps/web-console/src/pages/ConsoleMembersPage.tsx` | Referencia de patrón: `useEffect` reactivos, empty states, retry |
| `apps/web-console/src/pages/ConsoleMembersPage.test.tsx` | Referencia de patrón de test: mocks, fixtures, estructura describe/it |

> **NO leer**: `apps/control-plane/openapi/control-plane.openapi.json`  
> **NO tocar**: ningún archivo fuera de `apps/web-console/src/` y `specs/055-console-postgres-views/`

---

## Tareas ordenadas

### T01.1 — Añadir ruta `/console/postgres` en `router.tsx`

- [ ] Importar `ConsolePostgresPage` con `React.lazy` junto al resto de imports de páginas.
- [ ] Añadir dentro del bloque `children` de `ConsoleShellLayout` la ruta hija:

  ```ts
  { path: 'postgres', element: <ConsolePostgresPage /> }
  ```

- [ ] Posición en el array: después de la ruta `auth` y antes de `functions` (o al final si no existen esas rutas todavía).
- [ ] No tocar ninguna ruta ni import existente.

**Archivos modificados**: `apps/web-console/src/router.tsx`

---

### T01.2 — Añadir ítem `PostgreSQL` en `ConsoleShellLayout.tsx`

- [ ] Localizar el array `consoleNavigationItems` en `apps/web-console/src/layouts/ConsoleShellLayout.tsx`.
- [ ] Insertar el siguiente ítem entre `Auth` (índice 4) y `Functions` (índice 5):

  ```ts
  {
    label: 'PostgreSQL',
    to: '/console/postgres',
    icon: Database,          // ya importado de lucide-react
    description: 'Bases de datos, esquemas, tablas, índices, vistas y preview DDL.'
  }
  ```

- [ ] Verificar que `Database` ya está importado en el encabezado del archivo; no añadir imports duplicados.
- [ ] No alterar el resto del layout ni los ítems existentes.

**Archivos modificados**: `apps/web-console/src/layouts/ConsoleShellLayout.tsx`

---

### T01.3 — Crear `ConsolePostgresPage.tsx` — scaffold y tipos locales

Crear `apps/web-console/src/pages/ConsolePostgresPage.tsx`.

- [ ] Añadir imports React (`useCallback`, `useEffect`, `useState`), componentes shadcn/ui (`Badge`, `Button`), y helpers de contexto/sesión (`useConsoleContext`, `requestConsoleSessionJson`).
- [ ] Declarar **inline** (sin módulo separado) todos los tipos locales del §5.1.1 del plan:
  - `PgDatabase`, `PgSchema`, `PgTable`, `PgColumn`, `PgIndex`, `PgPolicy`, `PgSecurity`
  - `PgView`, `PgMatView`
  - `PgDdlStatement`, `PgDdlPreview`, `PgWarning`, `PgRiskProfile`
  - `CollectionOf<T>`
- [ ] Añadir helper `getApiErrorMessage(rawError, fallback)` (copia del patrón de `ConsoleMembersPage`).
- [ ] Declarar las funciones de carga (`loadDatabases`, `loadSchemas`, `loadTables`, `loadViews`, `loadMatViews`, `loadColumns`, `loadIndexes`, `loadPolicies`, `loadSecurity`) con las URLs exactas:
  - `GET /v1/postgres/databases?page[size]=100`
  - `GET /v1/postgres/databases/{db}/schemas?page[size]=100`
  - `GET /v1/postgres/databases/{db}/schemas/{schema}/tables?page[size]=100`
  - `GET /v1/postgres/databases/{db}/schemas/{schema}/tables/{table}/columns?page[size]=100`
  - `GET /v1/postgres/databases/{db}/schemas/{schema}/tables/{table}/indexes?page[size]=100`
  - `GET /v1/postgres/databases/{db}/schemas/{schema}/tables/{table}/policies?page[size]=100`
  - `GET /v1/postgres/databases/{db}/schemas/{schema}/tables/{table}/security`
  - `GET /v1/postgres/databases/{db}/schemas/{schema}/views?page[size]=100`
  - `GET /v1/postgres/databases/{db}/schemas/{schema}/materialized-views?page[size]=100`
- [ ] Exportar la función `ConsolePostgresPage()` con el scaffolding mínimo: header con badge "PostgreSQL" + empty state global "Selecciona un tenant para explorar las bases de datos PostgreSQL."

**Archivos nuevos**: `apps/web-console/src/pages/ConsolePostgresPage.tsx`

---

### T01.4 — Implementar estado completo y efectos reactivos

Dentro de `ConsolePostgresPage`:

- [ ] Inicializar todos los estados de navegación:
  - `selectedDatabase: string | null` (null)
  - `selectedSchema: string | null` (null)
  - `selectedTable: string | null` (null)
  - `tableDetailTab: 'columns' | 'indexes' | 'policies' | 'security'` ('columns')
  - `schemaTab: 'tables' | 'views' | 'matviews'` ('tables')
- [ ] Inicializar todos los estados de datos con la forma `{ data, loading: false, error: null }`:
  - `databases`, `schemas`, `tables`, `columns`, `indexes`, `policies`, `security`, `views`, `matViews`
- [ ] Inicializar estado de DDL Preview:
  - `ddlPreviewOpen: boolean` (false)
  - `ddlPreviewTarget: { kind: 'table' | 'view' | 'matview'; name: string } | null` (null)
  - `ddlPreview: { data, warnings, riskProfile, loading, error }`
- [ ] Implementar los cuatro `useEffect` reactivos con `AbortController` (flag `cancelled` o `controller.signal`):
  1. `[activeTenantId]` → reset completo + `loadDatabases`
  2. `[selectedDatabase]` → reset schemas/tables/vistas/detalle + `loadSchemas` si `selectedDatabase !== null`
  3. `[selectedSchema]` → reset tablas/vistas/detalle; `loadTables` + `loadViews` + `loadMatViews` en paralelo (`Promise.all`)
  4. `[selectedTable]` → `loadColumns` + `loadIndexes` + `loadPolicies` + `loadSecurity` en paralelo (`Promise.all`)
- [ ] Efecto adicional `[activeWorkspaceId, selectedDatabase]` → recarga schemas cuando cambia workspace.
- [ ] Cada efecto que inicia carga debe ignorar respuestas obsoletas mediante el flag `cancelled`.

---

### T01.5 — Implementar `DatabasesPanel`

Dentro de `ConsolePostgresPage`, sección superior:

- [ ] Si no hay `activeTenantId`: renderizar empty state global (ver T01.3).
- [ ] Spinner de carga `databases.loading`.
- [ ] Si `databases.error`: alerta `role="alert"` con el mensaje + botón "Reintentar" que relanza `loadDatabases`.
- [ ] Si `databases.data.length === 0` y no loading ni error: empty state "No hay bases de datos disponibles para este tenant."
- [ ] Tabla semántica `<table>` con columnas: `databaseName`, `state` (Badge), `ownerRoleName`, `placementMode`.
- [ ] Cada fila es clickable (`onClick`) → `setSelectedDatabase(db.databaseName)`.
- [ ] Fila activa resaltada (clase CSS diferenciada; p. ej. `bg-muted` o similar al patrón existente).

---

### T01.6 — Implementar `SchemasPanel`

Visible solo cuando `selectedDatabase !== null`:

- [ ] Breadcrumb `<nav aria-label="Navegación PostgreSQL">`: `{selectedDatabase}` con flecha.
- [ ] Botón "← Volver" o clic en breadcrumb → `setSelectedDatabase(null)`.
- [ ] Spinner / error (con retry) / empty state "No hay esquemas visibles para el workspace activo en esta base de datos."
- [ ] Tabla semántica: `schemaName`, `state` (Badge), `ownerRoleName`, counts (`tables` / `views` / `materializedViews` / `indexes` de `objectCounts`; mostrar `—` si `objectCounts` es undefined).
- [ ] Cada fila clickable → `setSelectedSchema(schema.schemaName)`.

---

### T01.7 — Implementar `SchemaDetailPanel` con tabs (Tablas / Vistas / Vistas materializadas)

Visible solo cuando `selectedSchema !== null`:

- [ ] Breadcrumb ampliado: `{selectedDatabase}` › `{selectedSchema}`.
- [ ] Tabs con valores `['tables', 'views', 'matviews']` controlados por `schemaTab`.

**Tab "Tablas"**:
- [ ] Spinner / error / empty state "Este esquema no tiene tablas definidas."
- [ ] Tabla semántica: `tableName`, `state` (Badge), `columnCount`.
- [ ] Fila clickable → `setSelectedTable(table.tableName)`.

**Tab "Vistas"**:
- [ ] Spinner / error / empty state "Este esquema no tiene vistas definidas."
- [ ] Tabla semántica: `viewName`, `state` (Badge), columnas (joined con coma o "—"), `securityBarrier` (badge "Sí"/"No").
- [ ] Botón "Preview DDL" por fila → `openDdlPreview('view', view.viewName)`.

**Tab "Vistas materializadas"**:
- [ ] Spinner / error / empty state "Este esquema no tiene vistas materializadas definidas."
- [ ] Tabla semántica: `viewName`, `state` (Badge), `withData` (badge), `refreshPolicy`, `integrityProfile.populationState`.
- [ ] Botón "Preview DDL" por fila → `openDdlPreview('matview', view.viewName)`.

---

### T01.8 — Implementar `TableDetailPanel` con tabs (Columns / Indexes / Policies / Security)

Visible solo cuando `selectedTable !== null`:

- [ ] Breadcrumb ampliado: `{selectedDatabase}` › `{selectedSchema}` › `{selectedTable}`.
- [ ] Botón "Preview DDL" en el header del panel → `openDdlPreview('table', selectedTable)`.
- [ ] Tabs controlados por `tableDetailTab`.

**Tab "Columns"**:
- [ ] Spinner / error / empty state "Esta tabla no tiene columnas definidas."
- [ ] Tabla semántica: `columnName`, `dataType.typeName` (fallback `"unknown"`), nullable (badge "NULL"/"NOT NULL"), `defaultExpression` (o "—"), `ordinalPosition`.

**Tab "Indexes"**:
- [ ] Spinner / error (aislado) / empty state "Esta tabla no tiene índices definidos."
- [ ] Tabla semántica: `indexName`, `indexMethod`, `unique` (badge "Único"/"—"), `keys` (column names joined), `includeColumns` (joined o "—").

**Tab "Policies"**:
- [ ] Spinner / error (aislado) / empty state con badge de `rlsEnabled` de `security.data` si disponible: "RLS deshabilitado — no hay políticas." o "No hay políticas definidas."
- [ ] Tabla semántica: `policyName`, `policyMode`, `appliesTo.command` (uppercase o "—"), `appliesTo.roles` (joined; si vacío: "(todos los roles)"), `usingExpression` (truncada a 60 chars + "…").

**Tab "Security"**:
- [ ] Spinner / error (aislado) / empty state "Información de seguridad no disponible."
- [ ] Cards o grid: `rlsEnabled` (badge verde/rojo), `forceRls` (badge), `policyCount`, `sharedTableClassification` (o "—"), `state` (Badge).

---

### T01.9 — Implementar `DdlPreviewDrawer`

Panel colapsable (modal o drawer shadcn/ui) activado por `ddlPreviewOpen`:

- [ ] Función `openDdlPreview(kind, name)`: setea `ddlPreviewTarget`, `ddlPreviewOpen=true`, llama al endpoint preview.

**Estrategia de invocación DDL preview** (verificar en `postgres.openapi.json`):
- [ ] Revisar si existe un endpoint `GET` con query param `executionMode=preview` para el recurso objetivo.
- [ ] Si no existe endpoint GET con preview: usar `PUT` del recurso con `?executionMode=preview` o `{"executionMode":"preview"}` en body; el backend devuelve `PostgresAdminMutationAccepted` con `ddlPreview`, `preExecutionWarnings`, `riskProfile` sin ejecutar cambios.
- [ ] Documentar en un comentario inline en el código qué variante se usó y por qué.

**Render del drawer**:
- [ ] Encabezado: "Preview DDL — {ddlPreviewTarget.name}" y botón de cierre.
- [ ] `ddlPreview.loading`: spinner.
- [ ] `ddlPreview.error`: alerta `role="alert"` + botón "Reintentar".
- [ ] **RiskProfile card**: `riskLevel` badge coloreado (`low`→verde, `medium`→amarillo, `high`→naranja, `critical`→rojo), `statementCount`, `destructive` (badge), `blockingLikely` (badge), `acknowledgementRequired` (badge).
- [ ] **PreExecutionWarnings list**: por cada warning, badge de `severity` con mismo esquema de color que riskLevel; `summary` en negrita; `detail` en texto regular; `requiresAcknowledgement` badge.
  - Warnings con `severity=high` o `severity=critical` deben tener una clase CSS diferenciada (p. ej. `data-severity="high"` o `className="warning-high"`) verificable en el DOM del test.
- [ ] **DDL Statements list**: por cada statement, `ordinal`, `category` (Badge), `destructive` indicator, bloque `<pre><code className="font-mono text-sm">` con el SQL.
- [ ] **Sin botón de ejecutar**: el drawer es estrictamente read-only. No debe existir ningún `<form>`, `<button type="submit">` ni acción de mutación.

---

### T01.10 — Implementar reset de contexto con `AbortController`

- [ ] Cada `useEffect` que dispara carga de datos debe crear un `AbortController` local.
- [ ] Antes de actualizar estado, verificar `!controller.signal.aborted` (o flag `cancelled`).
- [ ] El cleanup del `useEffect` debe llamar `controller.abort()`.
- [ ] Efecto `[activeTenantId]` debe resetear **todos** los estados de selección y datos antes de recargar.
- [ ] Efecto `[activeWorkspaceId, selectedDatabase]` debe resetear `selectedSchema`, `selectedTable`, y todos los datos de esquemas en adelante.

---

### T01.11 — Escribir tests en `ConsolePostgresPage.test.tsx`

Crear `apps/web-console/src/pages/ConsolePostgresPage.test.tsx`.

Seguir el patrón de `ConsoleMembersPage.test.tsx`:
- `vi.mock('@/lib/console-session', ...)` con `requestConsoleSessionJsonMock`
- `vi.mock('@/lib/console-context', ...)` con `useConsoleContextMock`
- Helper `renderPage()` con `<MemoryRouter>`
- Fixtures: `dbFixture()`, `schemaFixture()`, `tableFixture()`, `columnFixture()`, `indexFixture()`, `policyFixture()`, `securityFixture()`, `viewFixture()`, `matViewFixture()`, `ddlPreviewFixture()`, `warningFixture()`

Cubrir los 19 escenarios del §8.1 del plan:

- [ ] **T01.11.01** Sin tenant activo → empty state global visible.
- [ ] **T01.11.02** Sin workspace activo → databases visibles; sección de esquemas muestra estado contextual.
- [ ] **T01.11.03** Carga de databases: renderiza tabla con `databaseName`, `state`, `ownerRoleName`.
- [ ] **T01.11.04** Clic en database: llama a `/schemas` y renderiza lista de esquemas.
- [ ] **T01.11.05** Clic en schema: llama a `tables`, `views` y `materialized-views`; renderiza tabla de tablas.
- [ ] **T01.11.06** Clic en tabla: llama a `columns`, `indexes`, `policies` y `security` en paralelo.
- [ ] **T01.11.07** Tab Columns: muestra `columnName`, tipo, nullable, default.
- [ ] **T01.11.08** Tab Indexes: muestra `indexName`, método, unicidad.
- [ ] **T01.11.09** Tab Policies: muestra `policyName`, `policyMode`, command, roles.
- [ ] **T01.11.10** Tab Security: muestra `rlsEnabled`, `forceRls`, `policyCount`, estado.
- [ ] **T01.11.11** Tab Vistas: muestra `viewName`, estado, columnas expuestas.
- [ ] **T01.11.12** Tab Vistas materializadas: muestra `viewName`, `withData`, diferenciación visual respecto a vistas.
- [ ] **T01.11.13** Panel DDL Preview: clic en "Preview DDL" → llama al endpoint preview; renderiza statements + warnings + riskProfile.
- [ ] **T01.11.14** Warnings con `severity=critical` o `severity=high`: clase CSS diferenciada presente en el DOM.
- [ ] **T01.11.15** Error parcial en indexes: tab Indexes muestra error aislado; tabs Columns y Policies operativos.
- [ ] **T01.11.16** Tabla sin índices: empty state específico en tab Indexes.
- [ ] **T01.11.17** Reset al cambiar `activeTenantId`: selección descartada + recarga databases.
- [ ] **T01.11.18** Reset al cambiar `activeWorkspaceId` con database seleccionada: recarga esquemas.
- [ ] **T01.11.19** Retry: botón "Reintentar" en error de databases relanza la llamada.

**Archivos nuevos**: `apps/web-console/src/pages/ConsolePostgresPage.test.tsx`

---

### T01.12 — Añadir tests incrementales en `ConsoleShellLayout.test.tsx`

- [ ] Abrir `apps/web-console/src/layouts/ConsoleShellLayout.test.tsx`.
- [ ] No modificar ningún `describe`/`it` existente.
- [ ] Añadir al bloque de navegación existente (o crear uno nuevo `describe('PostgreSQL nav item')` al final):
  - El ítem `PostgreSQL` aparece en el sidebar.
  - El link del ítem apunta a `/console/postgres`.

**Archivos modificados**: `apps/web-console/src/layouts/ConsoleShellLayout.test.tsx`

---

### T01.13 — Validar el paquete `web-console`

Ejecutar en orden desde la raíz del repo:

```sh
corepack pnpm --filter @in-falcone/web-console typecheck
corepack pnpm --filter @in-falcone/web-console test
corepack pnpm --filter @in-falcone/web-console build
```

- [ ] `typecheck` sin errores.
- [ ] `test` con los 19 + 2 escenarios nuevos en verde; ningún test previo regresa rojo.
- [ ] `build` sin errores ni warnings críticos.

---

### T01.14 — Validar el repo raíz

```sh
corepack pnpm lint
corepack pnpm test
```

- [ ] `lint` sin nuevas infracciones.
- [ ] `test` global en verde.

---

## Resumen de artefactos del diff

| Archivo | Operación |
|---|---|
| `apps/web-console/src/router.tsx` | Modificar: import lazy + ruta hija `postgres` |
| `apps/web-console/src/layouts/ConsoleShellLayout.tsx` | Modificar: añadir ítem `PostgreSQL` al array `consoleNavigationItems` |
| `apps/web-console/src/pages/ConsolePostgresPage.tsx` | Crear: página principal autocontenida |
| `apps/web-console/src/pages/ConsolePostgresPage.test.tsx` | Crear: 19 escenarios de test |
| `apps/web-console/src/layouts/ConsoleShellLayout.test.tsx` | Modificar: 2 asserts incrementales |
| `specs/055-console-postgres-views/tasks.md` | Este archivo |

> Total: 3 archivos modificados + 2 nuevos en `apps/web-console/src/`. Sin cambios en `apps/control-plane/`, family files, infra o datos persistidos.

---

## Criterios de done

La tarea queda cerrada cuando:

1. `/console/postgres` existe en el shell protegido y el ítem `PostgreSQL` aparece en el sidebar.
2. Un operador con tenant activo ve las databases en ≤ 2 clics desde cualquier otra página del shell.
3. La navegación completa `database → schema → table → columns` funciona en 3 selecciones.
4. Esquemas y sub-recursos se recargan al cambiar workspace activo.
5. Los 19 escenarios del test de la página y los 2 del shell están en verde.
6. El panel DDL Preview muestra statements + warnings + riskProfile sin ningún affordance de ejecución.
7. Warnings `severity=high` / `severity=critical` tienen clase CSS diferenciada en el DOM del test.
8. La página es estrictamente read-only: no existe `<form>`, `<button type="submit">` ni acción de mutación.
9. `typecheck`, `test`, `build`, `lint` y `test` global quedan en verde.
10. Diff acotado a los 5 archivos de `apps/web-console/src/` listados arriba.
