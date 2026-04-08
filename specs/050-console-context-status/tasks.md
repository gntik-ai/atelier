# Tareas de implementación — US-UI-02-T02

**Feature Branch**: `050-console-context-status`
**Task ID**: US-UI-02-T02
**Epic**: EP-14 — Consola de administración: shell, acceso y contexto
**Historia padre**: US-UI-02 — Contexto de tenant/workspace, members y gestión Auth/IAM en consola
**Fecha**: 2026-03-28
**Estado**: Ready for implementation

---

## Archivos que la implementación tocará

> Mapa de lectura para la implementación. **Lee solo estos archivos** y los family files OpenAPI indicados. **No leas** `apps/control-plane/openapi/control-plane.openapi.json`.

```text
apps/control-plane/openapi/families/tenants.openapi.json          ← LEER solo path /v1/tenants y schemas TenantCollectionResponse, Tenant, TenantGovernanceProfile, TenantGovernanceStatus, TenantQuotaProfile, TenantQuotaLimit, TenantInventoryResponse, TenantInventoryWorkspaceSummary, ProvisioningSummary, ProvisioningRunStatus, TenantLifecycleState, PageInfo, ErrorResponse
apps/control-plane/openapi/families/workspaces.openapi.json       ← LEER solo path /v1/workspaces y schemas WorkspaceCollectionResponse, Workspace, WorkspaceEnvironment, ProvisioningSummary, ProvisioningRunStatus, EntityState, PageInfo, ErrorResponse
apps/web-console/src/lib/console-session.ts                       ← LEER solo exports/helpers necesarios; reutilizar requestConsoleSessionJson()
apps/web-console/src/lib/console-context.tsx                      ← MODIFICAR
apps/web-console/src/lib/console-context.test.tsx                 ← MODIFICAR
apps/web-console/src/layouts/ConsoleShellLayout.tsx               ← MODIFICAR
apps/web-console/src/layouts/ConsoleShellLayout.test.tsx          ← MODIFICAR
apps/web-console/src/pages/ConsolePlaceholderPage.tsx             ← MODIFICAR
apps/web-console/src/pages/ConsolePlaceholderPage.test.tsx        ← CREAR
specs/050-console-context-status/plan.md                          ← LEER
specs/050-console-context-status/tasks.md                         ← LEER
```

### Reglas obligatorias para lectura durante implement

1. Leer `plan.md` y `tasks.md` como único contexto Spec Kit.
2. Del family `tenants.openapi.json`, leer solo:
   - path `/v1/tenants`
   - schemas `TenantCollectionResponse`, `Tenant`, `TenantGovernanceProfile`, `TenantGovernanceStatus`, `TenantQuotaProfile`, `TenantQuotaLimit`, `TenantInventoryResponse`, `TenantInventoryWorkspaceSummary`, `ProvisioningSummary`, `ProvisioningRunStatus`, `TenantLifecycleState`, `PageInfo`, `ErrorResponse`
3. Del family `workspaces.openapi.json`, leer solo:
   - path `/v1/workspaces`
   - schemas `WorkspaceCollectionResponse`, `Workspace`, `WorkspaceEnvironment`, `ProvisioningSummary`, `ProvisioningRunStatus`, `EntityState`, `PageInfo`, `ErrorResponse`
4. **No leer** `apps/control-plane/openapi/control-plane.openapi.json`.
5. Para `console-session.ts`, leer primero solo el bloque inicial y luego solo el tramo donde viva `requestConsoleSessionJson()`.
6. Para tests existentes, leer solo imports + el primer test case antes de ampliar cobertura.
7. No explorar el repo con `find`, `ls` amplios ni búsquedas ad hoc. Este mapa es suficiente.

---

## Fase 1 — Runtime de estado del contexto

### T02-P1-01 · Enriquecer `console-context.tsx`

Actualizar `apps/web-console/src/lib/console-context.tsx` para que el provider exponga estado operativo rico del tenant/workspace activos.

Debe incluir:

- extensión de tipos internos `Tenant` y `Workspace` con los campos contractuales usados por T02
- extensión de `ConsoleTenantOption` con:
  - `governanceStatus`
  - `provisioningStatus`
  - `quotaSummary`
  - `inventorySummary`
- extensión de `ConsoleWorkspaceOption` con:
  - `environment`
  - `provisioningStatus`
- helpers puros para derivar:
  - tono/estado visual del tenant
  - tono/estado visual del workspace
  - resumen de cuotas con conteos `nominal` / `warning` / `blocked`
  - mensajes de degradación operativa para banners

Requisitos de comportamiento:

- seguir cargando tenants y workspaces desde las colecciones públicas actuales
- no romper la persistencia y restauración entregadas en T01
- mantener la ausencia de datos opcionales como un caso válido (sin error visible)
- exponer al resto de la app los datos ya listos para renderizar

---

### T02-P1-02 · Derivar severidad visual de cuotas

Dentro del runtime de contexto, derivar una severidad de presentación por item de cuota a partir de `TenantQuotaProfile.limits[]`.

Reglas mínimas:

- `blocked` si `remaining <= 0` o `used >= limit`
- `warning` si la utilización es alta (`utilizationPercent >= 80`)
- `nominal` en el resto de casos

Además:

- exponer conteos agregados por severidad
- conservar el detalle de cada métrica para el resumen expandible de la UI
- dejar claro en nombres/comentarios que es una derivación visual del frontend, no una decisión de enforcement backend

---

## Fase 2 — Shell global y banners

### T02-P2-01 · Añadir resumen global de estado en `ConsoleShellLayout.tsx`

Modificar `apps/web-console/src/layouts/ConsoleShellLayout.tsx` para renderizar, antes del `Outlet`, una banda global del contexto activo con:

- tenant activo y su estado de lifecycle/gobernanza
- workspace activo y su estado/env/provisioning
- feedback accesible de carga/error si el contexto todavía se está resolviendo

Restricciones:

- no rediseñar el header de T01
- no romper avatar, menú, sidebar ni navegación principal
- mantener la experiencia actual si no hay tenant o workspace seleccionados

---

### T02-P2-02 · Mostrar banners de degradación operativa

En el mismo `ConsoleShellLayout.tsx`, mostrar banners con `role="alert"` cuando ocurra cualquiera de estas condiciones:

- tenant no activo (`pending_activation`, `suspended`, `deleted`)
- governance del tenant distinta de `nominal`
- workspace no activo
- provisioning del workspace `in_progress` o `partially_failed`
- al menos una cuota `blocked`

Comportamiento esperado:

- si no hay degradación, no aparece ningún banner
- si hay varias condiciones, pueden aparecer varios banners compactos o una lista única clara
- los textos deben explicar la causa operativa, no solo el enum técnico

---

## Fase 3 — Páginas relevantes

### T02-P3-01 · Enriquecer `ConsolePlaceholderPage.tsx`

Modificar `apps/web-console/src/pages/ConsolePlaceholderPage.tsx` para que las páginas protegidas actuales muestren contexto operativo útil, además del placeholder existente.

Debe incluir:

- resumen del tenant y workspace activos
- resumen de cuotas del tenant con conteos por severidad
- detalle expandible por cuota (`metricKey`, `scope`, `used`, `limit`, `remaining`, `utilizationPercent`, `severity`)
- resumen de inventario (`workspaceCount`, `applicationCount`, `managedResourceCount`, `serviceAccountCount`)
- detalle expandible por workspace cuando `inventorySummary.workspaces[]` esté disponible

Restricciones:

- si no hay `quotaSummary` o `inventorySummary`, ocultar esa sección sin error
- mantener el contenido original del placeholder como baseline de la página
- usar presentación accesible y compacta (por ejemplo `details/summary`, badges y cards simples)

---

## Fase 4 — Tests

### T02-P4-01 · Ampliar `console-context.test.tsx`

Modificar `apps/web-console/src/lib/console-context.test.tsx`.

Cobertura mínima obligatoria:

1. tenant enriquecido con governance/provisioning/quota/inventory
2. derivación `warning` / `blocked` para cuotas
3. exposición de datos derivados del tenant activo tras la carga
4. exposición de `provisioningStatus` del workspace activo
5. mantenimiento de persistencia/cambio de tenant sin romper T01

---

### T02-P4-02 · Ampliar `ConsoleShellLayout.test.tsx`

Modificar `apps/web-console/src/layouts/ConsoleShellLayout.test.tsx`.

Cobertura mínima obligatoria:

1. render del resumen global de contexto
2. badge/label de estado del tenant activo
3. badge/label de estado del workspace activo y su entorno
4. banner cuando el tenant está suspendido
5. banner cuando el workspace tiene `partially_failed`
6. banner cuando existe una cuota `blocked`
7. ausencia de banners degradados en estado nominal

---

### T02-P4-03 · Crear `ConsolePlaceholderPage.test.tsx`

Crear `apps/web-console/src/pages/ConsolePlaceholderPage.test.tsx`.

Cobertura mínima obligatoria:

1. render del resumen de cuotas cuando existen datos
2. render del resumen de inventario cuando existen datos
3. ocultación de secciones opcionales cuando faltan datos
4. reflejo del tenant/workspace activos dentro de la página

---

## Fase 5 — Validación y entrega

### T02-P5-01 · Validación del paquete web-console

Ejecutar como mínimo:

- `corepack pnpm --filter @in-falcone/web-console test`
- `corepack pnpm --filter @in-falcone/web-console typecheck`
- `corepack pnpm --filter @in-falcone/web-console build`

Corregir cualquier fallo directamente relacionado con la feature antes de cerrar la tarea.

---

### T02-P5-02 · Git / PR / merge

Completar el flujo estándar de la feature:

- commit en `050-console-context-status`
- push
- PR contra `main`
- esperar/checkear CI
- corregir fallos si aparecen
- merge cuando CI quede verde

Mantener el alcance estrictamente acotado a T02.
