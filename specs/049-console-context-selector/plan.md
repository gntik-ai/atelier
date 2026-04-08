# Plan técnico de implementación — US-UI-02-T01

**Feature Branch**: `049-console-context-selector`
**Task ID**: US-UI-02-T01
**Epic**: EP-14 — Consola de administración: shell, acceso y contexto
**Historia padre**: US-UI-02 — Contexto de tenant/workspace, members y gestión Auth/IAM en consola
**Fecha del plan**: 2026-03-28
**Estado**: Ready for tasks

---

## 1. Objetivo y alcance estricto de T01

Entregar en `apps/web-console/` la primera capa operativa de **contexto multi-tenant** para la consola autenticada:

- selector de tenant en el shell protegido
- selector de workspace dependiente del tenant activo
- carga de opciones desde contratos públicos ya publicados
- persistencia del último contexto válido por usuario en el navegador
- restauración defensiva del contexto al recargar la SPA o volver a iniciar sesión
- exposición reactiva del contexto activo a cualquier pantalla hija del shell

La entrega debe dejar lista la base funcional para que las siguientes tareas de la historia se apoyen en un contexto estable, sin reabrir todavía:

- visualización extendida del estado del tenant/workspace en páginas de dominio (`T02`)
- vistas de members, invitaciones, roles y permisos (`T03`)
- vistas Auth/IAM completas (`T04`)
- gestión de aplicaciones externas del workspace (`T05`)
- E2E completos de cambio de contexto (`T06`)

---

## 2. Estado actual relevante del repositorio

### Baseline entregado por T04–T05

`apps/web-console/` ya dispone de:

- `ConsoleShellLayout` y árbol `/console/*`
- sesión local persistida para el shell (`console-session.ts`)
- wrapper autenticado `requestConsoleSessionJson()` para consumir APIs con bearer y refresh controlado
- logout remoto/local y guards de rutas ya resueltos
- placeholders navegables para `overview`, `tenants`, `workspaces`, `functions`, `storage`, `observability`, `profile` y `settings`

### Contratos públicos relevantes para T01

Según los family files publicados:

- `apps/control-plane/openapi/families/tenants.openapi.json`
  - `GET /v1/tenants` devuelve `TenantCollectionResponse`
  - cada `Tenant` expone al menos `tenantId`, `displayName`, `slug`, `state`, `planId`, `placement`, `metadata` y `governance`
- `apps/control-plane/openapi/families/workspaces.openapi.json`
  - `GET /v1/workspaces` requiere `filter[tenantId]`
  - devuelve `WorkspaceCollectionResponse`
  - cada `Workspace` expone al menos `workspaceId`, `tenantId`, `displayName`, `slug`, `environment`, `state`, `metadata` y `apiSurface`

### Restricción de arquitectura elegida

Para T01 **no hace falta cambiar backend ni contratos**: la consola puede consumir los endpoints públicos ya existentes mediante el runtime auth entregado en T05.

---

## 3. Decisiones técnicas

| Decisión | Elección | Justificación |
|---|---|---|
| Fuente de tenants | Consumir `GET /v1/tenants` vía `requestConsoleSessionJson()` | Evita inventar un backend específico y reutiliza contratos públicos ya validados. |
| Fuente de workspaces | Consumir `GET /v1/workspaces?filter[tenantId]=...` | El family workspace ya modela el filtro tenant obligatorio y refleja el scope correcto. |
| Estado global de contexto | Crear `ConsoleContextProvider` + hook `useConsoleContext()` en `apps/web-console/src/lib/console-context.tsx` | Entrega estado reactivo reutilizable por el shell y por futuras páginas sin reimplementar selección. |
| Persistencia | Guardar el contexto en `localStorage` con clave propia y asociación al `userId` autenticado | Permite restauración tras recarga y posteriores logins del mismo usuario sin mezclar contextos entre cuentas. |
| Restauración | Restaurar solo si tenant/workspace persistidos siguen presentes en los listados accesibles | Evita contexto zombie tras revocaciones, borrados o cambios de permisos. |
| UX de selección inicial | Auto-seleccionar solo cuando exista una única opción válida; si hay múltiples, dejar selección vacía hasta elección explícita o contexto persistido | Respeta el alcance incremental y evita asumir un tenant/workspace arbitrario para usuarios multi-scope. |
| Selector UI | Usar `<select>` nativos estilizados en el header del shell | Maximiza accesibilidad y minimiza superficie nueva frente a introducir un componente select complejo no existente en baseline. |
| Filtrado adicional cliente | Si `principal.tenantIds` / `principal.workspaceIds` existen en la sesión, usarlos solo como restricción adicional defensiva | La autorización real sigue en backend, pero el cliente puede endurecer la restauración del contexto. |
| Estado de error | Mostrar error inline + acción de reintento en el shell, sin redirigir | Un fallo de carga de contexto no equivale a fallo de autenticación; el usuario debe poder reintentar. |
| Alcance de pruebas | Cobertura de provider + storage + layout con mocking de fetch | Es la capa realmente modificada en T01; router y login no requieren cambios funcionales. |

---

## 4. Arquitectura objetivo

```text
ConsoleShellLayout
  └─► ConsoleContextProvider(session)
        ├─► loadTenants()
        │     └─► GET /v1/tenants
        ├─► resolveInitialTenant()
        │     ├─► persisted tenant if still valid
        │     ├─► only tenant if collection length = 1
        │     └─► null if multiple choices without persisted context
        ├─► loadWorkspaces(activeTenantId)
        │     └─► GET /v1/workspaces?filter[tenantId]=...
        ├─► resolveInitialWorkspace()
        │     ├─► persisted workspace if still valid in active tenant
        │     ├─► only workspace if collection length = 1
        │     └─► null otherwise
        ├─► persistContext(userId, tenantId, workspaceId)
        └─► expose hook useConsoleContext()

Header shell
  ├─► selector tenant
  ├─► selector workspace
  ├─► loading / empty / error states
  └─► mantiene navegación actual sin recargar la ruta

Future page / component
  └─► useConsoleContext()
        └─► { activeTenant, activeWorkspace, ids, loading, errors, reload }
```

### Límites entre componentes

| Componente | Responsabilidad | Fuera de alcance |
|---|---|---|
| `console-context.tsx` | Tipos de contexto, lectura/escritura en storage, carga REST de tenants/workspaces, provider y hook global | Render visual completo del shell, logout, guards auth |
| `ConsoleShellLayout.tsx` | Renderizar selectores, wiring con el provider, feedback visual de carga/error/empty state | Consumir el contexto desde páginas de negocio o persistir tokens |
| `console-session.ts` | Mantener sesión autenticada y request auth wrapper existente | Resolver la selección de tenant/workspace |
| OpenAPI family files | Fuente contractual para fields y shape de collections | No se modifican en esta tarea |

---

## 5. Cambios propuestos por artefacto o carpeta

### 5.1 `apps/web-console/src/lib/console-context.tsx` (nuevo)

Crear un módulo nuevo que concentre:

- tipos ligeros para las opciones de selector (`ConsoleTenantOption`, `ConsoleWorkspaceOption`)
- snapshot persistido por usuario (`userId`, `tenantId`, `workspaceId`, `updatedAt`)
- helpers de storage para leer, validar, persistir y limpiar contexto
- helpers REST:
  - `listAccessibleTenants()` con `GET /v1/tenants`
  - `listAccessibleWorkspaces(tenantId)` con `GET /v1/workspaces?filter[tenantId]=...`
- normalización mínima de datos UI (`id`, `label`, `secondary`, `state`)
- `ConsoleContextProvider`
- `useConsoleContext()`

Comportamientos obligatorios del provider:

- requiere un `ConsoleShellSession` o `principal.userId`
- carga tenants al montar
- restaura tenant persistido solo si sigue accesible
- al cambiar tenant, reinicia workspace y carga workspaces del nuevo tenant
- restaura workspace persistido solo si pertenece al tenant activo y sigue accesible
- persiste cada cambio válido de contexto
- expone `reloadTenants()` y `reloadWorkspaces()` para retry inline

### 5.2 `apps/web-console/src/layouts/ConsoleShellLayout.tsx`

Modificar el shell para:

- envolver el contenido del layout en `ConsoleContextProvider`
- añadir un bloque de contexto en el header (o línea superior del contenido del header) con:
  - label/heading breve (`Contexto`)
  - selector de tenant
  - selector de workspace
  - estados disabled, loading y error
- mantener intactos avatar, dropdown, navegación lateral y logout
- no forzar navegación al cambiar de tenant/workspace; la ruta actual debe mantenerse
- dejar listo el árbol visual para que T02 pueda reutilizar el contexto sin rediseñar el header

### 5.3 `apps/web-console/src/lib/console-context.test.tsx` (nuevo)

Crear pruebas para cubrir al menos:

1. snapshot persistido inválido => `null`
2. snapshot de otro usuario => no se restaura
3. tenant persistido válido => se restaura tras cargar la colección
4. tenant persistido inexistente/revocado => se limpia
5. workspace persistido fuera del tenant activo => se limpia
6. auto-selección cuando solo hay un tenant / un workspace
7. no auto-selección cuando hay múltiples opciones y no existe contexto previo

### 5.4 `apps/web-console/src/layouts/ConsoleShellLayout.test.tsx`

Ajustar tests del shell para cubrir al menos:

1. render de ambos selectores con sesión persistida
2. carga de tenants y workspaces vía fetch mockeado
3. cambio de tenant resetea el workspace previo y mantiene la ruta actual
4. cambio de workspace persiste contexto
5. estado vacío sin tenants accesibles
6. estado de error con acción de reintento

### 5.5 Sin cambios de contrato/backend

No se prevén cambios en:

- `apps/control-plane/src/**`
- openapi público (salvo regeneración futura si otra tarea sí modifica contratos)
- infraestructura Helm/OpenShift
- IAM/Keycloak
- sesiones/login/logout ya entregados

---

## 6. Modelo de datos, metadata y políticas

### Datos cliente nuevos

Snapshot persistido de contexto, por ejemplo:

```json
{
  "userId": "usr_abc123",
  "tenantId": "ten_123",
  "workspaceId": "wrk_456",
  "updatedAt": "2026-03-28T22:59:00.000Z"
}
```

### Reglas de validez

- `tenantId` solo es válido si aparece en la colección accesible cargada para el usuario actual
- `workspaceId` solo es válido si aparece en la colección del tenant activo
- un snapshot cuyo `userId` no coincide con el usuario autenticado actual se ignora
- si el usuario pierde acceso a tenant/workspace, el snapshot se corrige automáticamente

### Seguridad y aislamiento

- la UI no debe asumir que el storage concede permisos
- la autorización efectiva sigue en backend en cada request posterior
- el storage del contexto no debe contener tokens ni secretos
- los selectores deben exponer únicamente opciones accesibles por los endpoints autenticados

### Auditoría / observabilidad

- T01 no introduce eventos backend específicos ni cambios de auditoría
- opcionalmente puede dejar puntos centralizados para futura instrumentación front (`context_selected`, `context_restore_failed`) sin implementarla aún

---

## 7. Estrategia de pruebas

### Unit / integration ligera

**`console-context.test.tsx`** debe validar:

1. persistencia y restauración por `userId`
2. restauración defensiva ante snapshots corruptos
3. resolución inicial con única opción vs múltiples opciones
4. limpieza de workspace al cambiar tenant
5. retry de colecciones tras error

**`ConsoleShellLayout.test.tsx`** debe validar:

1. render del shell existente + bloque de contexto
2. selectores disabled durante carga
3. selectores con opciones tras respuestas exitosas
4. `tenant` change => `workspace` reset + nueva carga de workspaces
5. persistencia del valor elegido
6. estado empty/error sin romper el resto del shell

### Validaciones operativas

Ejecutar como mínimo:

- `corepack pnpm --filter @in-falcone/web-console test`
- `corepack pnpm --filter @in-falcone/web-console typecheck`
- `corepack pnpm --filter @in-falcone/web-console build`

Opcional según estabilidad del árbol global:

- `corepack pnpm lint`

---

## 8. Riesgos, compatibilidad y rollback

### Riesgos

- **Asumir dataset pequeño**: `GET /v1/tenants` puede crecer. Mitigación: T01 usa selector base; si la cardinalidad real crece, T02/T03 podrán evolucionar a búsqueda o picker avanzado.
- **Contexto persistido obsoleto**: un tenant/workspace puede desaparecer o dejar de ser accesible. Mitigación: restauración solo tras validar pertenencia en las colecciones actuales.
- **Ruido visual en header**: añadir dos selectores puede saturar el shell actual. Mitigación: versión compacta y alineada con header existente, sin reabrir layout completo.
- **Tests frágiles por fetch múltiple**: tenant/workspace introducen más requests en montaje. Mitigación: mocks explícitos y asserts por endpoint.

### Compatibilidad

- no cambia contratos backend
- no toca el flujo de auth entregado en T05
- mantiene las rutas y placeholders actuales
- deja preparado un hook reutilizable para T02–T05

### Rollback

- la funcionalidad está encapsulada en `web-console`
- revertir la feature elimina provider/selectores sin migraciones ni efectos persistentes críticos
- el snapshot de contexto en `localStorage` es inocuo y puede ignorarse tras revertir

---

## 9. Secuencia recomendada de implementación

1. Crear `console-context.tsx` con tipos, storage y helpers REST.
2. Implementar `ConsoleContextProvider` y hook `useConsoleContext()`.
3. Integrar el provider y los selectores en `ConsoleShellLayout.tsx`.
4. Crear tests de `console-context.test.tsx`.
5. Ajustar `ConsoleShellLayout.test.tsx` para los nuevos flujos.
6. Ejecutar test + typecheck + build y corregir regresiones.

Paralelización posible:

- provider/storage y tests de módulo pueden hacerse en paralelo parcial
- la integración visual del shell debe venir después de estabilizar el contrato del provider

---

## 10. Criterios de done verificables

La tarea podrá cerrarse cuando exista evidencia de que:

1. El shell autenticado muestra selector de tenant y selector de workspace.
2. Las opciones se cargan desde `GET /v1/tenants` y `GET /v1/workspaces?filter[tenantId]=...`.
3. El cambio de tenant limpia el workspace previo y no rompe la ruta actual.
4. El contexto persiste por usuario entre navegación y recarga.
5. Un contexto persistido inválido se limpia automáticamente.
6. Cualquier componente hijo puede consumir `useConsoleContext()` sin reimplementar estado local.
7. Las pruebas del paquete web-console quedan en verde para la feature.
8. `typecheck` y `build` del paquete web-console finalizan correctamente.

### Evidencia esperada al terminar

- diff acotado a `apps/web-console/` y `specs/049-console-context-selector/`
- salida verde de `test`, `typecheck` y `build` para `@in-falcone/web-console`
- commit en rama `049-console-context-selector`
- PR abierta, CI verificada y merge posterior como parte del flujo de implementación
