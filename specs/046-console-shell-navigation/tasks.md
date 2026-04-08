# Tareas de implementación — US-UI-01-T04

**Feature Branch**: `046-console-shell-navigation`
**Task ID**: US-UI-01-T04
**Epic**: EP-14 — Consola de administración: shell, acceso y contexto
**Historia padre**: US-UI-01 — Shell de consola: stack React/Tailwind/shadcn, login y navegación base
**Fecha**: 2026-03-28
**Estado**: Ready for implementation

---

## Archivos que la implementación tocará

> Mapa de lectura para el agente de implementación. **Lee solo estos archivos** y el family file OpenAPI indicado. **No leas** `apps/control-plane/openapi/control-plane.openapi.json`.

```text
apps/control-plane/openapi/families/auth.openapi.json             ← LEER solo paths/schemas relevantes de login session + logout
apps/web-console/src/lib/http.ts                                 ← MODIFICAR
apps/web-console/src/lib/console-auth.ts                         ← MODIFICAR
apps/web-console/src/lib/console-session.ts                      ← CREAR
apps/web-console/src/layouts/ConsoleShellLayout.tsx              ← CREAR
apps/web-console/src/layouts/ConsoleShellLayout.test.tsx         ← CREAR
apps/web-console/src/pages/ConsolePlaceholderPage.tsx            ← CREAR
apps/web-console/src/pages/LoginPage.tsx                         ← MODIFICAR
apps/web-console/src/pages/LoginPage.test.tsx                    ← MODIFICAR solo si cambia la salida visible tras login
apps/web-console/src/router.tsx                                  ← MODIFICAR
```

### Reglas obligatorias para lectura durante implement

1. Leer `plan.md` y `tasks.md` como único contexto Spec Kit.
2. Del `auth.openapi.json`, leer solo:
   - path `/v1/auth/login-sessions`
   - path `/v1/auth/login-sessions/{sessionId}`
   - schemas `ConsoleLoginSession`, `ConsoleSessionPrincipal`, `ConsoleTokenSet`, `ConsoleSessionTerminationAccepted`, `ErrorResponse`
3. Para patrones de test existentes, leer solo la cabecera imports + primer caso de `LoginPage.test.tsx`.
4. Para `console-auth.ts`, leer primero solo el bloque inicial de tipos/exports y luego solo la parte necesaria para extender login/logout.
5. No explorar el repo con `find` ni `ls` amplios. Este mapa es suficiente.

---

## Fase 1 — Helpers y sesión mínima

### T04-P1-01 · Extender `http.ts`

Modificar `apps/web-console/src/lib/http.ts` para soportar:

- método `DELETE`
- `headers` opcionales adicionales por request

Requisitos:

- no romper el comportamiento actual de GET/POST
- seguir generando `X-API-Version`, `X-Correlation-Id` e `Idempotency-Key`
- conservar la normalización de errores existente

---

### T04-P1-02 · Extender `console-auth.ts` con logout

Modificar `apps/web-console/src/lib/console-auth.ts` para añadir:

- tipo `ConsoleSessionExpirationPolicy`
- tipo `ConsoleTokenSet`
- tipo `ConsoleSessionTerminationAccepted`
- campos `sessionPolicy` y `tokenSet` dentro de `ConsoleLoginSession`
- helper `terminateConsoleLoginSession(sessionId, accessToken, signal?)`

Requisitos:

- usar `DELETE /v1/auth/login-sessions/{sessionId}`
- enviar `Authorization: Bearer <accessToken>` cuando se invoque logout
- reutilizar `requestJson()`

---

### T04-P1-03 · Crear `console-session.ts`

Crear `apps/web-console/src/lib/console-session.ts`.

Debe incluir:

- persistencia mínima en `sessionStorage`
- lectura segura cuando `window` no exista
- `persistConsoleShellSession(session)`
- `readConsoleShellSession()`
- `clearConsoleShellSession()`
- helper para derivar nombre visible e iniciales del avatar con fallback seguro

Restricciones:

- no implementar refresh de token
- no implementar guards completos
- persistir solo el snapshot necesario para el shell

---

## Fase 2 — Shell y rutas

### T04-P2-01 · Crear `ConsoleShellLayout.tsx`

Crear `apps/web-console/src/layouts/ConsoleShellLayout.tsx`.

Debe incluir:

- header fijo superior con marca textual/logo del producto
- avatar interactivo con iniciales o fallback genérico
- dropdown accesible con `Profile`, `Settings`, `Logout`
- cierre del dropdown por click externo y `Escape`
- navegación por teclado razonable dentro del menú (`Tab` nativo + flechas para mover foco)
- sidebar fija con secciones principales:
  - Overview
  - Tenants
  - Workspaces
  - Functions
  - Storage
  - Observability
- `NavLink` o equivalente para reflejar la sección activa
- `Outlet` para el contenido principal

Comportamiento esperado:

- usa la sesión persistida para mostrar nombre/email/roles cuando existan
- `Profile` navega a `/console/profile`
- `Settings` navega a `/console/settings`
- `Logout`:
  - intenta invalidar la sesión remota si hay `sessionId` + `accessToken`
  - limpia `sessionStorage` siempre
  - redirige a `/login`

---

### T04-P2-02 · Crear `ConsolePlaceholderPage.tsx`

Crear `apps/web-console/src/pages/ConsolePlaceholderPage.tsx`.

Debe aceptar props para:

- título
- descripción
- badge/etiqueta opcional

Debe renderizar una vista placeholder consistente para:

- overview
- tenants
- workspaces
- functions
- storage
- observability
- profile
- settings

---

### T04-P2-03 · Registrar el árbol `/console/*`

Modificar `apps/web-console/src/router.tsx` para declarar:

- ruta padre `/console` con `ConsoleShellLayout`
- índice que redirige o resuelve a `overview`
- rutas hijas para:
  - `/console/overview`
  - `/console/tenants`
  - `/console/workspaces`
  - `/console/functions`
  - `/console/storage`
  - `/console/observability`
  - `/console/profile`
  - `/console/settings`

Mantener `/`, `/login`, `/signup`, `/signup/pending-activation` y `*`.

---

### T04-P2-04 · Ajuste mínimo de `LoginPage.tsx`

Modificar `apps/web-console/src/pages/LoginPage.tsx` para que, tras un login exitoso:

- persista la sesión mínima del shell
- mantenga el resumen de sesión existente
- muestre una acción visible para abrir el shell base (`/console/overview`)

No reabrir el alcance de T02:

- no introducir refresh
- no introducir guards completos
- no eliminar el feedback actual de login

---

## Fase 3 — Tests

### T04-P3-01 · Crear `ConsoleShellLayout.test.tsx`

Crear `apps/web-console/src/layouts/ConsoleShellLayout.test.tsx`.

Cobertura mínima obligatoria:

1. render del shell con header, sidebar y avatar basado en sesión persistida
2. apertura del dropdown y presencia de `Profile`, `Settings`, `Logout`
3. cierre del dropdown al pulsar `Escape`
4. marca visual de la sección activa según la ruta actual
5. logout que:
   - invoca `DELETE /v1/auth/login-sessions/{sessionId}`
   - envía cabecera `Authorization`
   - limpia la sesión persistida
   - navega a `/login`

Sugerencia:

- usar `createMemoryRouter` o `MemoryRouter` con rutas mínimas
- mockear `global.fetch`
- poblar `sessionStorage` antes del render

---

### T04-P3-02 · Ajustar `LoginPage.test.tsx` solo si hace falta

Modificar `apps/web-console/src/pages/LoginPage.test.tsx` únicamente si el cambio visible tras login exitoso añade el CTA al shell y hace falta validarlo.

---

## Fase 4 — Validación end-to-end de la tarea

### T04-P4-01 · Validación del paquete web-console

Ejecutar y dejar verde:

```bash
corepack pnpm --filter @in-falcone/web-console test
corepack pnpm --filter @in-falcone/web-console typecheck
corepack pnpm --filter @in-falcone/web-console build
```

---

### T04-P4-02 · Validación global del monorepo

Ejecutar y dejar verde:

```bash
corepack pnpm lint
corepack pnpm test
```

---

### T04-P4-03 · Git + PR + CI + merge

Completar íntegramente dentro del paso implement:

1. `git status` limpio salvo los cambios previstos
2. commit con mensaje coherente para T04
3. push de `046-console-shell-navigation`
4. abrir PR contra `main`
5. observar checks hasta verde
6. corregir localmente cualquier fallo de CI y repush si fuese necesario
7. fusionar a `main` cuando la PR quede verde
8. volver a `main`, sincronizar con `origin/main` y preparar el siguiente cursor del backlog
