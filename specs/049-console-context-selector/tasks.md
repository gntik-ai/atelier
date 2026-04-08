# Tareas de implementación — US-UI-02-T01

**Feature Branch**: `049-console-context-selector`
**Task ID**: US-UI-02-T01
**Epic**: EP-14 — Consola de administración: shell, acceso y contexto
**Historia padre**: US-UI-02 — Contexto de tenant/workspace, members y gestión Auth/IAM en consola
**Fecha**: 2026-03-28
**Estado**: Ready for implementation

---

## Archivos que la implementación tocará

> Mapa de lectura para la implementación. **Lee solo estos archivos** y los family files OpenAPI indicados. **No leas** `apps/control-plane/openapi/control-plane.openapi.json`.

```text
apps/control-plane/openapi/families/tenants.openapi.json         ← LEER solo path /v1/tenants y schemas TenantCollectionResponse, Tenant, PageInfo, ErrorResponse
apps/control-plane/openapi/families/workspaces.openapi.json      ← LEER solo path /v1/workspaces y schemas WorkspaceCollectionResponse, Workspace, WorkspaceEnvironment, PageInfo, ErrorResponse
apps/web-console/src/lib/console-session.ts                      ← LEER solo exports/helpers necesarios; reutilizar requestConsoleSessionJson() y sesión actual
apps/web-console/src/lib/console-context.tsx                     ← CREAR
apps/web-console/src/lib/console-context.test.tsx                ← CREAR
apps/web-console/src/layouts/ConsoleShellLayout.tsx              ← MODIFICAR
apps/web-console/src/layouts/ConsoleShellLayout.test.tsx         ← MODIFICAR
```

### Reglas obligatorias para lectura durante implement

1. Leer `plan.md` y `tasks.md` como único contexto Spec Kit.
2. Del family `tenants.openapi.json`, leer solo:
   - path `/v1/tenants`
   - schemas `TenantCollectionResponse`, `Tenant`, `PageInfo`, `ErrorResponse`
3. Del family `workspaces.openapi.json`, leer solo:
   - path `/v1/workspaces`
   - schemas `WorkspaceCollectionResponse`, `Workspace`, `WorkspaceEnvironment`, `PageInfo`, `ErrorResponse`
4. **No leer** `apps/control-plane/openapi/control-plane.openapi.json`.
5. Para `console-session.ts`, leer primero solo el bloque inicial (exports, tipos, storage keys y helpers principales) y luego solo el tramo concreto donde viva `requestConsoleSessionJson()` o la lectura de sesión necesaria para integrarse.
6. Para patrones de test existentes, leer en `ConsoleShellLayout.test.tsx` solo imports + el primer test case antes de ampliar cobertura.
7. No explorar el repo con `find`, `ls` amplios ni búsquedas ad hoc. Este mapa es suficiente.

---

## Fase 1 — Runtime de contexto y contratos consumidos

### T01-P1-01 · Crear `console-context.tsx`

Crear `apps/web-console/src/lib/console-context.tsx`.

Debe incluir:

- tipos ligeros para tenant/workspace visibles en UI
- snapshot persistido por usuario (`userId`, `tenantId`, `workspaceId`, `updatedAt`)
- helpers de storage para leer, persistir y limpiar contexto
- `ConsoleContextProvider`
- hook `useConsoleContext()`
- helpers REST autenticados para:
  - `GET /v1/tenants`
  - `GET /v1/workspaces?filter[tenantId]=...`

Requisitos de comportamiento:

- cargar tenants al montar con una sesión válida
- restaurar tenant persistido solo si sigue accesible
- auto-seleccionar tenant solo cuando exista una única opción válida
- al cambiar tenant, limpiar workspace previo y cargar los workspaces del nuevo tenant
- restaurar workspace persistido solo si pertenece al tenant activo y sigue accesible
- auto-seleccionar workspace solo cuando exista una única opción válida
- exponer loading, error, retry y selección activa al resto de la app

Restricciones:

- no persistir tokens ni datos sensibles
- no asumir permisos desde el storage local
- mantener la autorización real en backend a través de los endpoints existentes

---

### T01-P1-02 · Consumir solo los contratos OpenAPI ya publicados

Implementar el runtime usando exclusivamente:

- `GET /v1/tenants`
- `GET /v1/workspaces` con `filter[tenantId]`

No introducir:

- nuevos endpoints
- cambios en backend
- cambios en OpenAPI
- lógica de mock permanente en producción

---

## Fase 2 — Integración en shell

### T01-P2-01 · Integrar provider + selectores en `ConsoleShellLayout.tsx`

Modificar `apps/web-console/src/layouts/ConsoleShellLayout.tsx` para:

- envolver el shell en `ConsoleContextProvider`
- renderizar un bloque compacto de `Contexto` en el header
- mostrar selector de tenant
- mostrar selector de workspace dependiente del tenant activo
- conservar avatar, dropdown, sidebar, logout y navegación existentes

Comportamiento esperado:

- si la carga está en progreso, los selectores aparecen deshabilitados con feedback visible
- si hay error al cargar tenants o workspaces, mostrar mensaje inline y acción de reintento
- si no hay tenants accesibles, mostrar estado vacío claro y deshabilitar workspace
- cambiar tenant o workspace no cambia la ruta actual ni rompe la navegación actual

Restricciones:

- no rediseñar el shell completo
- no mover navegación principal a otro sitio
- no mostrar todavía métricas/estado rico del tenant/workspace (eso es T02)

---

## Fase 3 — Tests

### T01-P3-01 · Crear `console-context.test.tsx`

Crear `apps/web-console/src/lib/console-context.test.tsx`.

Cobertura mínima obligatoria:

1. snapshot persistido inválido => ignorado
2. snapshot de otro usuario => ignorado
3. restauración válida de tenant/workspace persistidos
4. limpieza de contexto persistido cuando ya no existe acceso
5. auto-selección con un único tenant / único workspace
6. ausencia de auto-selección cuando hay múltiples opciones sin contexto previo
7. cambio de tenant => limpieza del workspace previo

---

### T01-P3-02 · Ajustar `ConsoleShellLayout.test.tsx`

Modificar `apps/web-console/src/layouts/ConsoleShellLayout.test.tsx`.

Cobertura mínima obligatoria:

1. render del bloque `Contexto` con shell autenticado
2. carga de tenants/workspaces con fetch mockeado
3. cambio de tenant mantiene la ruta y resetea workspace
4. cambio de workspace persiste contexto
5. estado vacío sin tenants accesibles
6. estado de error con reintento

---

## Fase 4 — Validación y entrega

### T01-P4-01 · Validación del paquete web-console

Ejecutar:

- `corepack pnpm --filter @in-falcone/web-console test`
- `corepack pnpm --filter @in-falcone/web-console typecheck`
- `corepack pnpm --filter @in-falcone/web-console build`

Corregir cualquier fallo relacionado con la feature antes de cerrar la tarea.

---

### T01-P4-02 · Git / PR / merge

Completar el flujo estándar de la feature:

- commit en `049-console-context-selector`
- push
- PR contra `main`
- esperar/checkear CI
- corregir fallos si aparecen
- merge cuando CI quede verde

Mantener el alcance estrictamente acotado a T01.
