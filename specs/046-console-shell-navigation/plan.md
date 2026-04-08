# Plan técnico de implementación — US-UI-01-T04

**Feature Branch**: `046-console-shell-navigation`
**Task ID**: US-UI-01-T04
**Epic**: EP-14 — Consola de administración: shell, acceso y contexto
**Historia padre**: US-UI-01 — Shell de consola: stack React/Tailwind/shadcn, login y navegación base
**Fecha del plan**: 2026-03-28
**Estado**: Ready for tasks

---

## 1. Objetivo y alcance estricto de T04

Entregar en `apps/web-console/` el **shell persistente de consola** para la experiencia post-login:

- header persistente con identidad del producto
- avatar de usuario con fallback robusto
- dropdown accesible con `Settings`, `Profile` y `Logout`
- sidebar persistente con secciones principales del producto
- rutas placeholder navegables dentro del shell
- integración incremental con el login ya existente para abrir el shell con el contexto de la sesión creada

La entrega debe dejar utilizable la base de navegación de escritorio sin reabrir todavía:

- persistencia robusta/refresh de tokens y control de expiración (`T05`)
- guards completos de rutas protegidas (`T05`)
- E2E completos de acceso y navegación (`T06`)

---

## 2. Estado actual relevante del repositorio

### Baseline entregado por T01–T03

`apps/web-console/` ya dispone de:

- SPA React/Vite/Tailwind operativa
- componentes UI base (`alert`, `badge`, `button`, `input`, `label`)
- rutas públicas `/`, `/login`, `/signup`, `/signup/pending-activation`
- cliente auth básico en `src/lib/console-auth.ts`
- página `LoginPage` que crea sesiones contra `/v1/auth/login-sessions`
- pantallas públicas de signup y pending activation

### Contratos auth relevantes para T04

Según `apps/control-plane/openapi/families/auth.openapi.json`:

- `POST /v1/auth/login-sessions` devuelve `ConsoleLoginSession`
- `DELETE /v1/auth/login-sessions/{sessionId}` invalida una sesión activa y devuelve `ConsoleSessionTerminationAccepted`
- `ConsoleLoginSession` incluye `principal`, `sessionId`, `sessionPolicy` y `tokenSet`
- `ConsoleSessionPrincipal` expone `displayName`, `primaryEmail`, `username` y `platformRoles`

---

## 3. Decisiones técnicas

| Decisión | Elección | Justificación |
|---|---|---|
| Composición del shell | `ConsoleShellLayout` con rutas hijas en React Router | Mantiene header/sidebar persistentes y cambia solo el área central. |
| Navegación principal | Lista estática y aditiva de secciones base del producto | Permite crecimiento incremental sin introducir todavía autorización por rol. |
| Avatar | Foto no disponible en contrato actual; usar iniciales de `displayName` o fallback genérico | El schema auth actual no garantiza foto de perfil. |
| Dropdown | Implementación accesible propia con `button` + `menu` + cierre por outside click/Escape + navegación por flechas | No existe aún un componente `dropdown-menu` en el baseline. |
| Sesión para shell | Persistencia mínima en `sessionStorage` mediante un helper dedicado | Permite avatar/logout y recarga básica sin invadir todavía T05. |
| Logout | Intentar `DELETE /v1/auth/login-sessions/{sessionId}` con bearer cuando exista `tokenSet.accessToken`; limpiar storage siempre y redirigir a `/login` | Cumple el flujo explícito de cierre sin introducir refresh/guards completos. |
| Integración con login | Mantener el resumen de sesión existente y añadir CTA visible para entrar al shell usando la sesión recién creada | Minimiza regresiones en T02 y enlaza la nueva capacidad. |
| Páginas destino | Placeholder pages para secciones, `Profile` y `Settings` | T04 entrega navegación estructural, no contenido funcional completo. |
| Testing | Vitest + RTL con `fetch` mockeado y `sessionStorage` real de jsdom | Patrón consistente con el paquete ya existente. |

---

## 4. Arquitectura objetivo

```text
LoginPage
  └─► createConsoleLoginSession()
        └─► persistConsoleShellSession()
              └─► navigate('/console/overview') o CTA explícita a shell

Router
  ├─► /, /login, /signup, /signup/pending-activation      → rutas públicas existentes
  └─► /console                                             → ConsoleShellLayout
         ├─► /console/overview
         ├─► /console/tenants
         ├─► /console/workspaces
         ├─► /console/functions
         ├─► /console/storage
         ├─► /console/observability
         ├─► /console/profile
         └─► /console/settings

ConsoleShellLayout
  ├─► header persistente (logo + avatar + dropdown)
  ├─► sidebar persistente (NavLink)
  ├─► outlet central
  └─► logout -> terminateConsoleLoginSession() -> clearConsoleShellSession() -> /login
```

### Límites entre componentes

| Componente | Responsabilidad | Fuera de alcance |
|---|---|---|
| `console-auth.ts` | Tipos auth, login-session termination y consumo de family auth | Refresh, guards globales, recuperación automática |
| `console-session.ts` | Persistencia mínima del snapshot de sesión para el shell | Gestión completa del lifecycle de tokens |
| `ConsoleShellLayout.tsx` | Header, avatar, dropdown, sidebar, logout, composición del layout | Resolución de permisos por rol o tenant |
| `ConsolePlaceholderPage.tsx` | Render homogéneo de vistas placeholder navegables | Contenido final de cada dominio |
| `router.tsx` | Declaración de las rutas públicas y del árbol `/console/*` | Guards completos |
| `LoginPage.tsx` | Puente incremental entre login exitoso y shell | Reescritura del flujo de autenticación |

---

## 5. Cambios propuestos por artefacto o carpeta

### 5.1 `apps/web-console/src/lib/http.ts`

Extender el helper para soportar:

- método HTTP `DELETE`
- headers adicionales opcionales (`Authorization`)

Sin cambiar el comportamiento actual de GET/POST ya usado por T02/T03.

### 5.2 `apps/web-console/src/lib/console-auth.ts`

Ampliar el módulo con:

- tipos `ConsoleSessionExpirationPolicy`, `ConsoleTokenSet`, `ConsoleSessionTerminationAccepted`
- campos `sessionPolicy` y `tokenSet` en `ConsoleLoginSession`
- helper `terminateConsoleLoginSession(sessionId, accessToken, signal?)`

### 5.3 `apps/web-console/src/lib/console-session.ts`

Crear helper dedicado para:

- persistir un snapshot mínimo del login útil para el shell
- leer la sesión actual del shell
- limpiar la sesión local al hacer logout
- derivar nombre visible/iniciales de avatar con fallbacks seguros

### 5.4 `apps/web-console/src/layouts/ConsoleShellLayout.tsx`

Crear el layout principal con:

- header fijo superior
- identidad de producto / logo textual
- avatar interactivo
- dropdown accesible con `Profile`, `Settings`, `Logout`
- sidebar fija con navegación principal
- área central vía `Outlet`
- sincronización visual de la sección activa con la URL

### 5.5 `apps/web-console/src/pages/ConsolePlaceholderPage.tsx`

Crear una página placeholder reutilizable para las secciones del shell:

- heading
- explicación corta del alcance incremental
- badge de ruta/estado

Se reutilizará para Overview, Tenants, Workspaces, Functions, Storage, Observability, Profile y Settings.

### 5.6 `apps/web-console/src/router.tsx`

Modificar para:

- mantener las rutas públicas existentes
- añadir el árbol `/console/*`
- usar nested routes con `ConsoleShellLayout`
- definir una ruta índice a `overview`

### 5.7 `apps/web-console/src/pages/LoginPage.tsx`

Ajuste mínimo para:

- persistir la sesión recién creada para el shell
- exponer CTA visible hacia el shell base tras login exitoso
- no eliminar el resumen de sesión ya validado por T02

### 5.8 Tests

Crear o ajustar:

- `apps/web-console/src/layouts/ConsoleShellLayout.test.tsx`
- `apps/web-console/src/pages/LoginPage.test.tsx` solo para verificar el CTA al shell si cambia el output visible

---

## 6. Estrategia de pruebas

### Unit / component tests

**`ConsoleShellLayout.test.tsx`** debe cubrir al menos:

1. render del header y la sidebar con una sesión persistida
2. avatar con iniciales o fallback genérico
3. apertura/cierre del dropdown por click y `Escape`
4. navegación visible a `Profile` y `Settings`
5. logout que invoca `DELETE /v1/auth/login-sessions/{sessionId}`, limpia storage y redirige a login
6. marca visual de la sección activa en sidebar

**`LoginPage.test.tsx`** debe cubrir, si cambia el flujo visible:

1. presencia del CTA para abrir el shell tras un login exitoso

### Validaciones operativas

- `corepack pnpm --filter @in-falcone/web-console test`
- `corepack pnpm --filter @in-falcone/web-console typecheck`
- `corepack pnpm --filter @in-falcone/web-console build`
- `corepack pnpm lint`
- `corepack pnpm test`

---

## 7. Riesgos, compatibilidad y rollback

### Riesgos

- **Solapamiento con T05**: introducir demasiada lógica de sesión en T04. Mitigación: persistencia mínima, sin refresh ni guards completos.
- **Logout parcial si falta token**: en escenarios de mock o degradación puede no haber bearer para llamar al endpoint. Mitigación: limpiar storage y redirigir siempre; intentar invalidación remota cuando el token exista.
- **Accesibilidad del dropdown**: un menú custom puede degradarse si no se controla teclado/cierre. Mitigación: implementar `Escape`, outside click y flechas con tests dedicados.

### Compatibilidad

- cambios aditivos sobre la SPA actual
- no altera contratos backend existentes
- no introduce dependencias externas nuevas

### Rollback

- revertir el commit elimina el shell y retorna al baseline público previo sin afectar login/signup existentes

---

## 8. Secuencia recomendada de implementación

1. Extender `http.ts` y `console-auth.ts` para soportar terminación de sesión.
2. Crear `console-session.ts` para persistencia mínima del shell.
3. Crear `ConsoleShellLayout.tsx` con navegación y dropdown.
4. Crear `ConsolePlaceholderPage.tsx`.
5. Registrar el árbol `/console/*` en `router.tsx`.
6. Ajustar `LoginPage.tsx` para enlazar el shell tras login exitoso.
7. Añadir tests del shell y el ajuste mínimo de login.
8. Ejecutar validaciones del paquete y del monorepo.
9. Completar commit, push, PR, CI y merge dentro del mismo paso implement.

---

## 9. Criterios de done verificables

La tarea se considera done cuando:

- existe un árbol de rutas `/console/*` con shell persistente
- el header muestra identidad de producto y avatar con fallback
- el dropdown expone `Profile`, `Settings` y `Logout`
- la sidebar muestra secciones principales y refleja la ruta activa
- `Logout` intenta invalidar la sesión actual y limpia el estado local
- el login exitoso deja un camino visible para entrar al shell
- `@in-falcone/web-console` queda verde en `test`, `typecheck` y `build`
- el monorepo queda verde en `lint` y `test`
- la rama `046-console-shell-navigation` se publica, pasa CI y se fusiona a `main`
