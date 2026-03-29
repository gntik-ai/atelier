# Tareas de implementación — US-UI-02-T04

**Feature Branch**: `052-console-auth-iam-views`
**Task ID**: US-UI-02-T04
**Epic**: EP-14 — Consola de administración: shell, acceso y contexto
**Historia padre**: US-UI-02 — Contexto de tenant/workspace, members y gestión Auth/IAM en consola
**Fecha**: 2026-03-29
**Estado**: Ready for implementation

---

## Archivos que la implementación tocará

> Mapa de lectura para la implementación. **Lee solo estos archivos** y los family files OpenAPI indicados.
> **No leas** `apps/control-plane/openapi/control-plane.openapi.json`.
> **Lee únicamente `plan.md` y `tasks.md`** como contexto Spec Kit.

```text
apps/control-plane/openapi/families/iam.openapi.json               ← LEER solo paths:
                                                                        /v1/iam/realms/{realmId}/users
                                                                        /v1/iam/realms/{realmId}/roles
                                                                        /v1/iam/realms/{realmId}/scopes
                                                                        /v1/iam/realms/{realmId}/clients
                                                                      y solo schemas:
                                                                        IamUserCollectionResponse, IamRoleCollectionResponse,
                                                                        IamScope, IamScopeCollectionResponse,
                                                                        IamClient, IamClientCollectionResponse,
                                                                        IamProviderCompatibility, EntityState, PageInfo, ErrorResponse
apps/control-plane/openapi/families/workspaces.openapi.json        ← LEER solo path:
                                                                        /v1/workspaces/{workspaceId}/applications
                                                                      y solo schemas:
                                                                        ExternalApplication, ExternalApplicationCollectionResponse,
                                                                        FederatedIdentityProvider, ExternalApplicationValidationSummary,
                                                                        ExternalApplicationAuthenticationFlow, ExternalApplicationScope,
                                                                        ExternalApplicationIamClient, ExternalApplicationLoginPolicy,
                                                                        ExternalApplicationLogoutPolicy, EntityState, PageInfo, ErrorResponse
apps/web-console/src/lib/console-session.ts                        ← LEER solo el bloque inicial + el tramo donde vive requestConsoleSessionJson(); no leer el resto del módulo
apps/web-console/src/layouts/ConsoleShellLayout.tsx                ← MODIFICAR
apps/web-console/src/layouts/ConsoleShellLayout.test.tsx           ← MODIFICAR (leer imports + primer test antes de ampliar)
apps/web-console/src/pages/ConsoleAuthPage.tsx                     ← CREAR
apps/web-console/src/pages/ConsoleAuthPage.test.tsx                ← CREAR
apps/web-console/src/router.tsx                                    ← MODIFICAR
specs/052-console-auth-iam-views/plan.md                           ← LEER
specs/052-console-auth-iam-views/tasks.md                          ← LEER
```

### Reglas obligatorias para lectura durante implement

1. Leer únicamente `specs/052-console-auth-iam-views/plan.md` y `specs/052-console-auth-iam-views/tasks.md` como contexto Spec Kit.
2. **No leer** `apps/control-plane/openapi/control-plane.openapi.json`.
3. Del family `iam.openapi.json`, leer solo los 4 paths listados y los schemas indicados arriba.
4. Del family `workspaces.openapi.json`, leer solo el path `/v1/workspaces/{workspaceId}/applications` y los schemas indicados arriba.
5. Para `console-session.ts`, leer primero solo el bloque inicial y luego solo la firma/implementación de `requestConsoleSessionJson()`.
6. Para tests existentes, leer solo imports + primer test case antes de ampliar cobertura.
7. No explorar el repo con `find`, `ls` amplios ni búsquedas ad hoc. Este mapa es suficiente.

---

## Objetivo y alcance estricto de T04

Entregar en `apps/web-console/` una nueva vista **Auth/IAM** que concentre la inspección operativa del dominio de identidad del tenant/workspace activo.

La entrega añade:

- nueva ruta protegida `/console/auth`
- nuevo ítem de navegación lateral `Auth`
- página `ConsoleAuthPage` con:
  - resumen del realm (users, roles, scopes, clients)
  - tabla de client scopes IAM
  - tabla de IAM clients
  - tabla de aplicaciones externas del workspace activo
  - tabla agregada de providers federados OIDC/SAML derivados de las aplicaciones
  - enlace visible hacia `/console/members` como drill-down canónico de users/roles

La entrega es **estrictamente read-only**.

### Fuera de alcance explícito para T04

- crear/editar/borrar users, roles, scopes, clients
- crear/editar/borrar aplicaciones externas o providers
- duplicar la página `Members` con tablas completas de users/roles
- plantillas de alta, formularios o mutations de T05
- pruebas E2E de T06

---

## Fase 1 — Routing y navegación

### T04-P1-01 · Añadir ruta `/console/auth`

Modificar `apps/web-console/src/router.tsx`.

Cambios obligatorios:

1. importar `ConsoleAuthPage`
2. añadir la ruta hija:

```tsx
{
  path: 'auth',
  element: <ConsoleAuthPage />
}
```

Restricciones:

- mantener la ruta dentro del árbol protegido de `ConsoleShellLayout`
- no alterar el resto de guardas ni redirecciones

---

### T04-P1-02 · Añadir ítem de navegación `Auth`

Modificar `apps/web-console/src/layouts/ConsoleShellLayout.tsx`.

Añadir una entrada al array `consoleNavigationItems` con:

- `label: 'Auth'`
- `to: '/console/auth'`
- descripción centrada en Auth/IAM del tenant/workspace activo
- icono de `lucide-react` ya disponible o añadible sin tocar más layout del necesario

Restricciones:

- no eliminar ni reordenar de forma agresiva el resto de ítems
- mantener el shell y los controles de contexto intactos

---

## Fase 2 — Página `ConsoleAuthPage`

### T04-P2-01 · Crear `ConsoleAuthPage.tsx`

Crear `apps/web-console/src/pages/ConsoleAuthPage.tsx`.

La página consume `useConsoleContext()` para obtener:

- `activeTenant`
- `activeWorkspace`
- `activeTenant?.consoleUserRealm`

#### Carga del realm

Si existe `consoleUserRealm`, cargar en paralelo:

- `GET /v1/iam/realms/{realmId}/users?page[size]=100`
- `GET /v1/iam/realms/{realmId}/roles?page[size]=100`
- `GET /v1/iam/realms/{realmId}/scopes?page[size]=100`
- `GET /v1/iam/realms/{realmId}/clients?page[size]=100`

Usar `requestConsoleSessionJson()` directamente desde el propio archivo de página.

La sección del realm debe mostrar como mínimo:

- badge `Auth / IAM`
- nombre del tenant activo y `consoleUserRealm`
- resumen con los counts de users, roles, scopes y clients
- enlace claro a `/console/members` para el detalle de users/roles

### T04-P2-02 · Renderizar tablas de scopes y clients

Dentro de `ConsoleAuthPage.tsx`, renderizar dos secciones accesibles.

**Scopes** — columnas mínimas:

- `scopeName`
- `protocol`
- `isDefault`
- `isOptional`
- `includeInTokenScope`
- `assignedClientIds`

**Clients** — columnas mínimas:

- `clientId`
- `protocol`
- `accessType`
- `enabled`
- `state`
- `redirectUris`
- `defaultScopes`
- `optionalScopes`

Restricciones:

- usar tablas semánticas (`<table>`, `<thead>`, `<th scope="col">`)
- no implementar acciones de escritura
- formatear arrays de forma compacta (badges o texto compacto)

### T04-P2-03 · Cargar y renderizar aplicaciones externas

Si existe `activeWorkspace?.workspaceId`, cargar:

- `GET /v1/workspaces/{workspaceId}/applications?page[size]=100`

Renderizar una tabla/listado accesible con columnas mínimas:

- `displayName`
- `slug`
- `protocol`
- `state`
- `authenticationFlows`
- `redirectUris`
- `scopes`
- `validation`

Aprovechar `federatedProviders` embebidos en cada aplicación para derivar la subsección de providers federados, sin hacer llamadas adicionales a rutas `/providers/*`.

### T04-P2-04 · Renderizar providers federados derivados

A partir de `applications.items.flatMap(...)`, construir una colección visual read-only con columnas mínimas:

- aplicación asociada (`displayName` o `slug`)
- `alias`
- `protocol`
- `providerMode`
- `enabled`

Restricciones:

- si no hay workspace activo, esta sección debe mostrar un empty state contextual
- si hay aplicaciones pero ninguna expone providers, mostrar empty state específico de providers
- no hacer fetch N+1 por aplicación

### T04-P2-05 · Estados vacíos, carga y error por sección

Implementar los estados mínimos:

- sin tenant activo → mensaje global: `Selecciona un tenant para inspeccionar Auth/IAM.`
- sin `consoleUserRealm` → mensaje global: `Este tenant no tiene un realm IAM de consola configurado.`
- sin workspace activo → mensaje contextual para apps/providers: `Selecciona un workspace para ver aplicaciones externas y providers.`
- carga del realm → indicador accesible por bloque
- error del realm → mensaje con `role="alert"` y botón `Reintentar`
- error de apps → mensaje con `role="alert"` y botón `Reintentar`
- listas vacías → mensaje específico por sección

Además:

- descartar resultados obsoletos al cambiar tenant/workspace
- no mezclar datos entre contextos

---

## Fase 3 — Tests

### T04-P3-01 · Ampliar `ConsoleShellLayout.test.tsx`

Modificar `apps/web-console/src/layouts/ConsoleShellLayout.test.tsx`.

Cobertura mínima obligatoria:

1. el item `Auth` aparece en la navegación lateral
2. el link apunta a `/console/auth`

---

### T04-P3-02 · Crear `ConsoleAuthPage.test.tsx`

Crear `apps/web-console/src/pages/ConsoleAuthPage.test.tsx`.

Cobertura mínima obligatoria:

1. render del mensaje cuando no hay tenant activo
2. render del mensaje cuando `consoleUserRealm` es `null`
3. render del resumen del realm con counts de users/roles/scopes/clients
4. render de la tabla de scopes
5. render de la tabla de clients
6. render de la tabla de aplicaciones externas con workspace activo
7. render de providers federados derivados de `federatedProviders`
8. render del mensaje sin workspace activo para apps/providers
9. render de error + retry cuando falla una colección

---

## Fase 4 — Validación y entrega

### T04-P4-01 · Validación del paquete

Ejecutar como mínimo:

- `corepack pnpm --filter @in-atelier/web-console test`
- `corepack pnpm --filter @in-atelier/web-console typecheck`
- `corepack pnpm --filter @in-atelier/web-console build`
- `corepack pnpm lint`
- `corepack pnpm test`

Corregir cualquier regresión directamente relacionada con la feature antes de cerrar la tarea.

---

### T04-P4-02 · Git / PR / merge

Completar el flujo estándar de la feature dentro del mismo implement stage:

- commit en `052-console-auth-iam-views`
- push
- PR contra `main`
- seguimiento de CI
- corrección de fallos si aparecen
- merge cuando CI quede verde

Mantener el alcance estrictamente acotado a T04.
