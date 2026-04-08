# Plan técnico de implementación — US-UI-02-T02

**Feature Branch**: `050-console-context-status`
**Task ID**: US-UI-02-T02
**Epic**: EP-14 — Consola de administración: shell, acceso y contexto
**Historia padre**: US-UI-02 — Contexto de tenant/workspace, members y gestión Auth/IAM en consola
**Fecha del plan**: 2026-03-28
**Estado**: Ready for tasks

---

## 1. Objetivo y alcance estricto de T02

Extender el contexto multi-tenant entregado en `US-UI-02-T01` para que el shell autenticado y las páginas protegidas muestren, sin navegación adicional:

- estado operativo del tenant activo (lifecycle + gobernanza)
- estado operativo del workspace activo (lifecycle + entorno + provisioning)
- resumen compacto de cuotas del tenant activo
- resumen compacto de inventario del tenant activo
- banners de advertencia cuando el contexto activo está degradado para operar

La entrega debe seguir siendo **frontend-only en `apps/web-console/`**, reutilizando los contratos públicos existentes y sin introducir nuevos endpoints, backend específico ni cambios de infraestructura.

Fuera de alcance explícito para T02:

- vistas CRUD de cuotas, gobernanza o inventario
- refresh en tiempo real por WebSocket/SSE
- nuevas rutas protegidas o rediseño completo del shell
- permisos/miembros/Auth/IAM de `US-UI-02-T03+`
- acciones correctivas desde los banners o indicadores

---

## 2. Estado actual relevante del repositorio

### Baseline ya disponible

`US-UI-02-T01` dejó operativos:

- `ConsoleContextProvider` y `useConsoleContext()` en `apps/web-console/src/lib/console-context.tsx`
- carga autenticada de `GET /v1/tenants` y `GET /v1/workspaces?filter[tenantId]=...`
- persistencia por usuario de tenant/workspace activos
- shell protegido con selector de tenant/workspace en `ConsoleShellLayout.tsx`
- placeholders navegables para `overview`, `tenants`, `workspaces`, `functions`, `storage`, `observability`, `profile` y `settings`

### Contratos ya disponibles para esta tarea

Sin cambiar backend ni OpenAPI, la consola ya puede obtener desde las colecciones públicas:

- `Tenant.state`
- `Tenant.governance.governanceStatus`
- `Tenant.provisioning.status`
- `Tenant.quotaProfile.limits[]`
- `Tenant.inventorySummary`
- `Workspace.state`
- `Workspace.environment`
- `Workspace.provisioning.status`

Esto permite resolver T02 consumiendo únicamente los family files `tenants.openapi.json` y `workspaces.openapi.json` y los requests ya autenticados del shell.

---

## 3. Decisiones técnicas

| Decisión | Elección | Justificación |
|---|---|---|
| Fuente de estado tenant | Reutilizar `GET /v1/tenants` | Ya devuelve lifecycle, governance, quota profile e inventory summary sin crear endpoints nuevos. |
| Fuente de estado workspace | Reutilizar `GET /v1/workspaces?filter[tenantId]=...` | Ya devuelve lifecycle, environment y provisioning del workspace seleccionado. |
| Modelo reactivo | Enriquecer `ConsoleTenantOption` y `ConsoleWorkspaceOption` dentro de `console-context.tsx` | Mantiene un único estado global de contexto y evita fetches duplicados desde cada página. |
| Derivados UI | Calcular en frontend severidades y mensajes operativos reutilizables | Permite mostrar badges, resúmenes y banners desde un único origen reactivo. |
| Indicadores del shell | Añadir una banda/resumen global del contexto dentro de `ConsoleShellLayout` por encima del `Outlet` | Hace visible el estado en todas las páginas protegidas sin rediseñar el header fijo. |
| Banners degradados | Generar banners desde reglas derivadas del contexto activo | Centraliza la lógica de “operable vs degradado” y la vuelve coherente entre páginas. |
| Resumen de cuotas/inventario | Renderizarlo en `ConsolePlaceholderPage.tsx` con `details/summary` accesibles | Entrega información visible y expandible en las páginas actuales sin introducir UI compleja adicional. |
| Accesibilidad | Usar `role="status"` para indicadores y `role="alert"` para degradaciones | Alinea la entrega con FR-014 y mantiene feedback legible por tecnologías de asistencia. |
| Scope técnico | No tocar backend, router ni contratos | La tarea es incremental sobre el shell de consola ya existente. |

---

## 4. Arquitectura objetivo

```text
ConsoleContextProvider
  ├─► listAccessibleTenants()
  │     └─► Tenant[] enriquecido a ConsoleTenantOption con:
  │           - lifecycle
  │           - governance status
  │           - provisioning status
  │           - quota summary derivado
  │           - inventory summary
  ├─► listAccessibleWorkspaces(activeTenantId)
  │     └─► Workspace[] enriquecido a ConsoleWorkspaceOption con:
  │           - lifecycle
  │           - environment
  │           - provisioning status
  ├─► deriveOperationalFlags(activeTenant, activeWorkspace)
  │     └─► badges, labels, degraded banners y mensajes
  └─► expose hook useConsoleContext()

ConsoleShellLayout
  ├─► mantiene selector tenant/workspace de T01
  ├─► añade resumen global del contexto activo
  └─► muestra banners de degradación antes del contenido de página

ConsolePlaceholderPage
  ├─► lee useConsoleContext()
  ├─► muestra resumen de cuotas del tenant
  ├─► muestra resumen de inventario del tenant
  └─► contextualiza el placeholder con tenant/workspace activos
```

### Límites entre componentes

| Componente | Responsabilidad | Fuera de alcance |
|---|---|---|
| `console-context.tsx` | Tipos enriquecidos, normalización de contratos, derivación de status/quota/inventory y exposición reactiva | Render visual del shell/páginas |
| `ConsoleShellLayout.tsx` | Indicadores globales del shell, bandas de estado y banners degradados | Detalle amplio de inventario/cuotas por dominio |
| `ConsolePlaceholderPage.tsx` | Resumen visible y expandible de cuotas/inventario en páginas actuales | CRUD de gobernanza, cuotas o inventario |
| OpenAPI family files | Fuente contractual de shapes y enums | No se modifican en T02 |

---

## 5. Cambios propuestos por artefacto o carpeta

### 5.1 `apps/web-console/src/lib/console-context.tsx`

Extender el provider para modelar y exponer datos de estado ricos:

- ampliar interfaces internas `Tenant` y `Workspace` con los campos realmente consumidos del contrato
- ampliar `ConsoleTenantOption` con:
  - `governanceStatus`
  - `provisioningStatus`
  - `quotaSummary`
  - `inventorySummary`
- ampliar `ConsoleWorkspaceOption` con:
  - `environment`
  - `provisioningStatus`
  - `resourceCounts` si resulta útil para el resumen visual
- añadir helpers puros para:
  - derivar severidad visual del tenant (`healthy`, `warning`, `restricted`)
  - derivar severidad visual del workspace (`ready`, `provisioning`, `restricted`, `degraded`)
  - resumir cuotas (`nominal`, `warning`, `blocked`, detalle por métrica)
  - construir mensajes de banner cuando haya degradación operativa
- exponer estos datos en `ConsoleContextValue` para que shell y páginas no recalculen desde cero

### 5.2 `apps/web-console/src/layouts/ConsoleShellLayout.tsx`

Mantener la integración de T01 y añadir:

- bloque global de estado del contexto debajo del header fijo y antes del `Outlet`
- indicadores compactos para:
  - tenant activo
  - estado de lifecycle/gobernanza del tenant
  - workspace activo
  - estado/env/provisioning del workspace
- banners visibles cuando ocurra cualquiera de estas condiciones:
  - tenant no activo
  - governance del tenant distinta de `nominal`
  - workspace no activo
  - provisioning del workspace `in_progress` o `partially_failed`
  - al menos una cuota bloqueada
- textos de ayuda accesibles y consistentes con estados de carga/error ya existentes

### 5.3 `apps/web-console/src/pages/ConsolePlaceholderPage.tsx`

Convertir el placeholder base en una página contextual mínima:

- mantener `badge`, `title` y `description`
- añadir resumen del contexto activo con tenant/workspace seleccionados
- añadir card/resumen de cuotas del tenant si hay datos disponibles
- añadir card/resumen de inventario del tenant si hay datos disponibles
- permitir expandir detalle con `details/summary` accesibles
- omitir secciones si el backend no devuelve esa información o el rol no tiene visibilidad

### 5.4 `apps/web-console/src/lib/console-context.test.tsx`

Añadir cobertura para:

- enriquecimiento de tenant con governance/provisioning/quota/inventory
- derivación de severidad de cuotas (nominal, warning, blocked)
- limpieza/actualización del contexto cuando cambian tenant/workspace
- exposición de banderas de degradación desde el provider

### 5.5 `apps/web-console/src/layouts/ConsoleShellLayout.test.tsx`

Ampliar cobertura para validar:

- render del resumen global de estado del contexto
- badges/labels del tenant y del workspace activos
- banner de tenant suspendido
- banner de workspace con provisioning degradado
- banner por cuota bloqueada
- ausencia de banners en estado sano

### 5.6 `apps/web-console/src/pages/ConsolePlaceholderPage.test.tsx` (nuevo)

Crear pruebas de presentación mínima para:

- resumen de cuotas visible cuando existe `quotaSummary`
- resumen de inventario visible cuando existe `inventorySummary`
- ocultación defensiva cuando no hay datos disponibles
- contexto activo reflejado en la página

---

## 6. Modelo de datos y reglas derivadas

### Tenant enriquecido en cliente

El tenant activo deberá exponer al menos:

- `tenantId`
- `label`
- `slug`
- `state`
- `governanceStatus`
- `provisioningStatus`
- `quotaSummary`
  - `totals.nominal`
  - `totals.warning`
  - `totals.blocked`
  - `items[]` con `metricKey`, `scope`, `used`, `limit`, `remaining`, `utilizationPercent`, `severity`
- `inventorySummary`
  - `workspaceCount`
  - `applicationCount`
  - `managedResourceCount`
  - `serviceAccountCount`
  - `workspaces[]`

### Workspace enriquecido en cliente

El workspace activo deberá exponer al menos:

- `workspaceId`
- `tenantId`
- `label`
- `environment`
- `state`
- `provisioningStatus`

### Reglas derivadas de cuotas

Como `TenantQuotaProfile.limits[]` expone uso/límite/restante pero no trae una severidad explícita por item, la consola derivará una severidad visual estable para el resumen:

- `blocked` cuando `remaining <= 0` o `used >= limit`
- `warning` cuando el límite existe y la utilización es alta (umbral visual conservador: `utilizationPercent >= 80`)
- `nominal` en el resto de casos

Esta severidad es **solo de presentación en consola** y no sustituye la política efectiva del backend.

### Reglas de degradación operativa

Habrá degradación visible si se cumple cualquiera de estas condiciones:

- tenant `pending_activation`, `suspended` o `deleted`
- governance `warning`, `suspended`, `retention` o `purge_pending`
- workspace `draft`, `provisioning`, `pending_activation`, `suspended`, `soft_deleted` o `deleted`
- provisioning de workspace `in_progress` o `partially_failed`
- cualquier quota item `blocked`

---

## 7. Seguridad, aislamiento, compatibilidad y rollback

### Seguridad y aislamiento

- la consola sigue leyendo solo el tenant/workspace seleccionados y ya autorizados por la API
- no se añaden secretos ni storage sensible nuevo
- las secciones de cuotas/inventario deben ocultarse si los campos no llegan en la respuesta
- la UI no infiere permisos extra; solo presenta datos disponibles

### Compatibilidad

- no cambia rutas ni contratos públicos
- no rompe el selector de T01
- no requiere migraciones, seeds ni cambios de Helm/OpenShift
- deja el shell preparado para T03–T06 sin rehacer el contexto

### Rollback

- el cambio queda encapsulado en `apps/web-console/` y en `specs/050-console-context-status/`
- revertir la feature elimina indicadores/banners/resúmenes sin tocar datos persistidos sensibles

---

## 8. Estrategia de pruebas y validación

### Unitarias / integración ligera

**`console-context.test.tsx`**

- normalización de tenant con governance/provisioning/quota/inventory
- derivación de warning/blocked para quotas
- actualización reactiva al cambiar tenant/workspace
- persistencia sin perder el comportamiento de T01

**`ConsoleShellLayout.test.tsx`**

- render del resumen global de contexto
- indicadores del tenant y workspace activos
- banners degradados según lifecycle/provisioning/quota
- ausencia de banners cuando el estado es saludable

**`ConsolePlaceholderPage.test.tsx`**

- resumen de cuotas
- resumen de inventario
- ocultación defensiva por falta de datos

### Validaciones operativas mínimas

Ejecutar al menos:

- `corepack pnpm --filter @in-falcone/web-console test`
- `corepack pnpm --filter @in-falcone/web-console typecheck`
- `corepack pnpm --filter @in-falcone/web-console build`

### Validaciones finales del flujo implement

Antes de cerrar la unidad, el implement stage también debe completar:

- commit en `050-console-context-status`
- push
- PR contra `main`
- seguimiento de CI
- fixes si aparecen regresiones
- merge cuando los checks queden en verde

---

## 9. Secuencia recomendada de implementación

1. Enriquecer `console-context.tsx` con modelos y derivadores de estado.
2. Exponer en el hook los datos listos para shell y páginas.
3. Integrar el resumen global y los banners en `ConsoleShellLayout.tsx`.
4. Integrar cuotas/inventario/contexto activo en `ConsolePlaceholderPage.tsx`.
5. Ajustar y ampliar tests del provider y del shell.
6. Crear test específico de placeholder contextual.
7. Ejecutar validaciones del paquete web-console.
8. Completar git/PR/CI/merge dentro del mismo stage de implementación.

---

## 10. Criterios de done verificables

La tarea quedará cerrada cuando exista evidencia de que:

1. El shell protegido muestra el estado del tenant activo y del workspace activo con señales visibles.
2. Las páginas protegidas muestran banners cuando el contexto activo está degradado.
3. Las páginas placeholder actuales muestran un resumen accesible de cuotas e inventario del tenant cuando esos datos están disponibles.
4. No se muestran errores ni estados saludables falsos cuando faltan datos opcionales.
5. El cambio de tenant/workspace sigue actualizando correctamente la información mostrada.
6. `corepack pnpm --filter @in-falcone/web-console test`, `typecheck` y `build` quedan en verde.
7. La rama `050-console-context-status` se publica, la PR se valida en CI y termina mergeada a `main`.

### Evidencia esperada al terminar

- diff acotado a `apps/web-console/` y `specs/050-console-context-status/`
- plan/tasks/materialización Spec Kit completa para la unidad
- salida verde de validaciones del paquete web-console
- commit, PR, checks verdes y merge registrados en el flujo
