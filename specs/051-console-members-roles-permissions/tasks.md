# Tareas de implementación — US-UI-02-T03

**Feature Branch**: `051-console-members-roles-permissions`
**Task ID**: US-UI-02-T03
**Epic**: EP-14 — Consola de administración: shell, acceso y contexto
**Historia padre**: US-UI-02 — Contexto de tenant/workspace, members y gestión Auth/IAM en consola
**Fecha**: 2026-03-29
**Estado**: Ready for implementation

---

## Archivos que la implementación tocará

> Mapa de lectura para la implementación. **Lee solo estos archivos** y los family files OpenAPI indicados.
> **No leas** `apps/control-plane/openapi/control-plane.openapi.json`.
> **No existe `plan.md`** para esta tarea; usa únicamente `tasks.md` como contexto Spec Kit.

```text
apps/control-plane/openapi/families/iam.openapi.json              ← LEER solo paths /v1/iam/realms/{realmId}/users y /v1/iam/realms/{realmId}/roles;
                                                                       schemas IamUser, IamUserCollectionResponse, IamRole, IamRoleCollectionResponse,
                                                                       IamAttributes, IamRequiredAction, IamProviderCompatibility, EntityState, PageInfo, ErrorResponse
apps/control-plane/openapi/families/tenants.openapi.json          ← LEER solo schema TenantIdentityContext (campo consoleUserRealm)
apps/web-console/src/lib/console-session.ts                       ← LEER solo requestConsoleSessionJson(); no leer el resto del módulo
apps/web-console/src/lib/console-context.tsx                      ← MODIFICAR
apps/web-console/src/lib/console-context.test.tsx                 ← MODIFICAR
apps/web-console/src/layouts/ConsoleShellLayout.tsx               ← MODIFICAR
apps/web-console/src/layouts/ConsoleShellLayout.test.tsx          ← MODIFICAR
apps/web-console/src/pages/ConsoleMembersPage.tsx                 ← CREAR
apps/web-console/src/pages/ConsoleMembersPage.test.tsx            ← CREAR
apps/web-console/src/router.tsx                                   ← MODIFICAR
specs/051-console-members-roles-permissions/tasks.md              ← LEER
```

### Reglas obligatorias para lectura durante implement

1. Leer únicamente `tasks.md` como contexto Spec Kit (no hay `plan.md`).
2. Del family `iam.openapi.json`, leer solo:
   - paths `/v1/iam/realms/{realmId}/users` y `/v1/iam/realms/{realmId}/roles`
   - schemas `IamUser`, `IamUserCollectionResponse`, `IamRole`, `IamRoleCollectionResponse`, `IamAttributes`, `IamRequiredAction`, `IamProviderCompatibility`, `EntityState`, `PageInfo`, `ErrorResponse`
3. Del family `tenants.openapi.json`, leer solo el schema `TenantIdentityContext` para obtener el tipo del campo `consoleUserRealm`.
4. **No leer** `apps/control-plane/openapi/control-plane.openapi.json`.
5. Para `console-session.ts`, leer primero solo el bloque inicial y luego solo el tramo donde viva `requestConsoleSessionJson()`.
6. Para tests existentes, leer solo imports + primer test case antes de ampliar cobertura.
7. No explorar el repo con `find`, `ls` amplios ni búsquedas ad hoc. Este mapa es suficiente.

---

## Objetivo y alcance estricto de T03

Entregar en `apps/web-console/` la vista de **miembros y roles** del tenant activo, basada en el contexto IAM resuelto en T01/T02.

La entrega añade:

- exposición de `consoleUserRealm` (realmId del realm de consola del tenant activo) en el contexto global de la app
- nueva sección de navegación **"Members"** en el shell
- página `ConsoleMembersPage` con dos secciones: listado de usuarios IAM y listado de roles del realm
- presentación accesible de roles asignados a cada usuario (campo `realmRoles`)

La entrega es **read-only**: no hay CRUD de usuarios ni roles en T03. Las acciones de gestión (invitaciones, edición, activación/suspensión, asignación de roles) son alcance de T04+.

**Fuera de alcance explícito para T03:**

- creación, edición o borrado de usuarios, roles o scopes IAM
- gestión de clientes IAM (`/v1/iam/realms/{realmId}/clients`)
- actividad IAM (`/v1/iam/tenants/{tenantId}/activity`)
- vistas Auth/IAM completas (`US-UI-02-T04+`)
- paginación avanzada (cargar con `page[size]=100` como las colecciones de T01/T02)
- invitaciones de nuevos miembros

---

## Contexto previo relevante

El selector y el estado contextual (T01/T02) dejan disponibles en `useConsoleContext()`:

- `activeTenant.tenantId` — ID del tenant activo
- `activeTenant` — incluye los campos del tenant tal como los normaliza `normalizeTenantOptions()`

La interfaz interna `Tenant` en `console-context.tsx` **no incluye todavía `identityContext`**. T03 añade ese campo para exponer `consoleUserRealm` como parte normalizada del tenant option.

---

## Fase 1 — Extensión del contexto: exponer `consoleUserRealm`

### T03-P1-01 · Añadir `identityContext` al tipo `Tenant` interno y extender `ConsoleTenantOption`

Modificar `apps/web-console/src/lib/console-context.tsx`.

Cambios necesarios:

1. Añadir interfaz interna `TenantIdentityContext` con al menos `consoleUserRealm?: string`.
2. Añadir campo `identityContext?: TenantIdentityContext` a la interfaz interna `Tenant`.
3. Añadir campo `consoleUserRealm: string | null` a la interfaz exportada `ConsoleTenantOption`.
4. En `normalizeTenantOptions()`, mapear `consoleUserRealm` desde `tenant.identityContext?.consoleUserRealm ?? null`.

Restricciones:

- no romper ningún campo existente de `ConsoleTenantOption`
- tratar la ausencia de `identityContext` (tenant sin realm IAM configurado) como un caso válido: `consoleUserRealm: null`
- no hacer fetches adicionales; el campo viene en la colección `/v1/tenants` ya cargada en T01/T02

---

## Fase 2 — Página `ConsoleMembersPage`

### T03-P2-01 · Crear `ConsoleMembersPage.tsx`

Crear `apps/web-console/src/pages/ConsoleMembersPage.tsx`.

La página consume `useConsoleContext()` para obtener `activeTenant.consoleUserRealm` y, si existe, carga:

- `GET /v1/iam/realms/{consoleUserRealm}/users?page[size]=100` → sección de miembros
- `GET /v1/iam/realms/{consoleUserRealm}/roles?page[size]=100` → sección de roles

Ambas peticiones se realizan con `requestConsoleSessionJson()`.

**Sección Miembros (usuarios IAM):**

Muestra una tabla o lista compacta de usuarios. Columnas/campos mínimos por usuario:

- `username`
- `email` (si presente)
- `enabled` (badge Activo / Desactivado)
- `state` (`EntityState` formateado con `formatConsoleEnumLabel`)
- `realmRoles` — lista de roles asignados al usuario (badges o pills compactos)
- `requiredActions` — si no está vacío, indicar pendiente de acción (ej. "UPDATE_PASSWORD")

**Sección Roles:**

Muestra una tabla o lista compacta de roles. Campos mínimos por rol:

- `roleName`
- `description` (si presente)
- `composite` — indicar si es un rol compuesto (badge o icono)
- `compositeRoles` — si es compuesto y tiene roles hijo, listarlos en formato compacto

**Estados de la página:**

- sin tenant activo → mensaje: "Selecciona un tenant para gestionar sus miembros y roles."
- sin `consoleUserRealm` (tenant sin realm IAM) → mensaje: "Este tenant no tiene un realm de consola IAM configurado."
- cargando usuarios o roles → indicadores de carga accesibles por sección
- error en carga → mensaje de error con botón de reintento por sección (`role="alert"`)
- sin usuarios → mensaje de lista vacía
- sin roles → mensaje de lista vacía

**Restricciones:**

- no implementar acciones (invitar, editar, borrar, suspender)
- usar `requestConsoleSessionJson()` directamente desde el componente de página (no crear módulo lib separado)
- usar presentación accesible: tablas con `<thead>` y `<th scope="col">` o listas con `aria-label`
- usar los componentes UI existentes: `Badge`, `Button` (para reintentar)

---

## Fase 3 — Router y navegación

### T03-P3-01 · Añadir ruta `/console/members` al router

Modificar `apps/web-console/src/router.tsx`.

Añadir dentro del bloque de rutas hijas de `ConsoleShellLayout`:

```tsx
{
  path: 'members',
  element: <ConsoleMembersPage />
}
```

Importar `ConsoleMembersPage` al inicio del archivo.

---

### T03-P3-02 · Añadir ítem "Members" a la navegación del shell

Modificar `apps/web-console/src/layouts/ConsoleShellLayout.tsx`.

Añadir entrada al array `consoleNavigationItems`:

```ts
{
  label: 'Members',
  to: '/console/members',
  icon: Users,           // importar Users desde 'lucide-react'
  description: 'Miembros, roles y permisos del realm IAM del tenant activo.'
}
```

Añadir `Users` a los imports de `lucide-react`.

Restricciones:

- no reordenar ni eliminar los ítems existentes
- insertar el ítem después de "Workspaces" o en la posición que resulte más natural en el flujo de navegación de la consola
- no modificar el resto del layout ni los controles de contexto

---

## Fase 4 — Tests

### T03-P4-01 · Ampliar `console-context.test.tsx`

Modificar `apps/web-console/src/lib/console-context.test.tsx`.

Cobertura mínima obligatoria:

1. `consoleUserRealm` presente en `ConsoleTenantOption` cuando el tenant tiene `identityContext.consoleUserRealm`
2. `consoleUserRealm` es `null` cuando `identityContext` está ausente o sin campo `consoleUserRealm`
3. cambio de tenant actualiza `consoleUserRealm` correctamente en el option del nuevo tenant activo

---

### T03-P4-02 · Ampliar `ConsoleShellLayout.test.tsx`

Modificar `apps/web-console/src/layouts/ConsoleShellLayout.test.tsx`.

Cobertura mínima obligatoria:

1. el ítem de navegación "Members" renderiza en el sidebar
2. el link de "Members" apunta a `/console/members`

---

### T03-P4-03 · Crear `ConsoleMembersPage.test.tsx`

Crear `apps/web-console/src/pages/ConsoleMembersPage.test.tsx`.

Cobertura mínima obligatoria:

1. render del mensaje de "sin tenant activo" cuando no hay `activeTenant`
2. render del mensaje de "sin realm IAM" cuando `activeTenant.consoleUserRealm` es `null`
3. render de la lista de usuarios cuando la API devuelve al menos un usuario
4. render de badges de `realmRoles` para un usuario con roles asignados
5. render de la lista de roles cuando la API devuelve al menos un rol
6. indicador de rol compuesto (`composite: true`) visible en la fila de rol
7. render del estado de carga mientras se resuelven los fetches
8. render de mensaje de error + botón de reintento cuando la carga falla

---

## Fase 5 — Validación y entrega

### T03-P5-01 · Validación del paquete web-console

Ejecutar como mínimo:

- `corepack pnpm --filter @in-falcone/web-console test`
- `corepack pnpm --filter @in-falcone/web-console typecheck`
- `corepack pnpm --filter @in-falcone/web-console build`

Corregir cualquier fallo directamente relacionado con la feature antes de cerrar la tarea.

---

### T03-P5-02 · Git / PR / merge

Completar el flujo estándar de la feature:

- commit en `051-console-members-roles-permissions`
- push
- PR contra `main`
- esperar/checkear CI
- corregir fallos si aparecen
- merge cuando CI quede verde

Mantener el alcance estrictamente acotado a T03.
