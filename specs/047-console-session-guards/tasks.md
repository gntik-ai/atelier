# Tareas de implementación — US-UI-01-T05

**Feature Branch**: `047-console-session-guards`
**Task ID**: US-UI-01-T05
**Epic**: EP-14 — Consola de administración: shell, acceso y contexto
**Historia padre**: US-UI-01 — Shell de consola: stack React/Tailwind/shadcn, login y navegación base
**Fecha**: 2026-03-28
**Estado**: Ready for implementation

---

## Archivos que la implementación tocará

> Mapa de lectura para la implementación. **Lee solo estos archivos** y el family file OpenAPI indicado. **No leas** `apps/control-plane/openapi/control-plane.openapi.json`.

```text
apps/control-plane/openapi/families/auth.openapi.json            ← LEER solo paths/schemas relevantes de login session + refresh + logout
apps/web-console/src/lib/console-auth.ts                        ← MODIFICAR
apps/web-console/src/lib/console-session.ts                     ← MODIFICAR
apps/web-console/src/components/auth/ProtectedRoute.tsx         ← CREAR
apps/web-console/src/components/auth/ProtectedRoute.test.tsx    ← CREAR
apps/web-console/src/pages/LoginPage.tsx                        ← MODIFICAR
apps/web-console/src/pages/LoginPage.test.tsx                   ← MODIFICAR solo si cambia output/redirect visible
apps/web-console/src/router.tsx                                 ← MODIFICAR
apps/web-console/src/router.test.tsx                            ← MODIFICAR solo si hace falta por rutas protegidas
apps/web-console/src/lib/console-session.test.ts                ← CREAR
```

### Reglas obligatorias para lectura durante implement

1. Leer `plan.md` y `tasks.md` como único contexto Spec Kit.
2. Del `auth.openapi.json`, leer solo:
   - path `/v1/auth/login-sessions`
   - path `/v1/auth/login-sessions/{sessionId}`
   - path `/v1/auth/login-sessions/{sessionId}/refresh`
   - schemas `ConsoleLoginSession`, `ConsoleTokenRefreshRequest`, `ConsoleTokenSet`, `ConsoleSessionTerminationAccepted`, `ErrorResponse`
3. Para patrones de test existentes, leer solo la cabecera imports + el primer test case de `LoginPage.test.tsx` y `router.test.tsx`.
4. Para `console-auth.ts` y `console-session.ts`, leer primero solo el bloque inicial de tipos/exports y luego solo los tramos necesarios para ampliar refresh/session runtime.
5. No explorar el repo con `find` ni `ls` amplios. Este mapa es suficiente.

---

## Fase 1 — Contrato auth y runtime de sesión

### T05-P1-01 · Extender `console-auth.ts` con refresh

Modificar `apps/web-console/src/lib/console-auth.ts` para añadir:

- tipo `ConsoleTokenRefreshRequest`
- helper `refreshConsoleLoginSession(sessionId, refreshToken, signal?)`

Requisitos:

- usar `POST /v1/auth/login-sessions/{sessionId}/refresh`
- enviar `refreshToken` en body JSON
- reutilizar `requestJson()`
- mantener el resto de contratos auth existentes

---

### T05-P1-02 · Endurecer `console-session.ts`

Modificar `apps/web-console/src/lib/console-session.ts` para incluir:

- validación robusta del snapshot persistido
- helpers para saber si el access token está caducado o próximo a caducar
- almacenamiento/lectura/consumo de la ruta protegida recordada
- almacenamiento/lectura/consumo del hint auth
- `ensureConsoleSession()` con refresh on-demand
- serialización de refresh concurrente con una promesa compartida
- `requestConsoleSessionJson()` con bearer automático y un solo retry tras `401`

Restricciones:

- limpiar la sesión local completa cuando el refresh falle definitivamente
- no introducir sincronización avanzada multi-tab
- no introducir autorización por roles

---

## Fase 2 — Guardas y navegación

### T05-P2-01 · Crear `ProtectedRoute.tsx`

Crear `apps/web-console/src/components/auth/ProtectedRoute.tsx`.

Debe incluir:

- estado mínimo de carga auth
- lectura inicial de la sesión
- intento de recuperación si la sesión puede refrescarse
- persistencia de la ruta destino antes de redirigir a `/login`
- render de `Outlet` solo cuando la sesión sea válida

Comportamiento esperado:

- sin sesión recuperable => navegar a `/login`
- con sesión válida => render inmediato
- con sesión refrescable => loading corto, luego render o redirección

---

### T05-P2-02 · Envolver `/console/*` en la guarda

Modificar `apps/web-console/src/router.tsx` para declarar:

- wrapper `ProtectedRoute` por encima de `ConsoleShellLayout`
- mantenimiento de todas las rutas públicas actuales
- mantenimiento del árbol de rutas hijas ya entregado en T04

---

### T05-P2-03 · Ajustar `LoginPage.tsx`

Modificar `apps/web-console/src/pages/LoginPage.tsx` para que:

- muestre el hint auth si existe
- tras login exitoso navegue a la ruta protegida recordada o `/console/overview`
- si ya existe sesión válida o recuperable, no permanezca innecesariamente en `/login`

No reabrir alcance de T02:

- mantener el formulario y feedback base existentes
- no tocar signup ni pending activation

---

## Fase 3 — Tests

### T05-P3-01 · Crear `console-session.test.ts`

Crear `apps/web-console/src/lib/console-session.test.ts`.

Cobertura mínima obligatoria:

1. snapshot inválido => `null`
2. refresh exitoso => persiste nuevo token set
3. refresh concurrente => una sola llamada real
4. request autenticada añade bearer
5. `401` => refresh + retry único
6. refresh fallido => limpieza de sesión + hint auth

---

### T05-P3-02 · Crear `ProtectedRoute.test.tsx`

Crear `apps/web-console/src/components/auth/ProtectedRoute.test.tsx`.

Cobertura mínima obligatoria:

1. sin sesión => redirección a login y persistencia del destino
2. con sesión válida => render del contenido protegido
3. con sesión refrescable => recuperación y render
4. con fallo de refresh => redirección y hint auth

---

### T05-P3-03 · Ajustar `LoginPage.test.tsx` y `router.test.tsx` solo si hace falta

Modificar estos tests únicamente si el cambio visible o el árbol de rutas protegido lo exige.

---

## Fase 4 — Validación y entrega

### T05-P4-01 · Validación del paquete web-console

Ejecutar:

- `corepack pnpm --filter @in-atelier/web-console test`
- `corepack pnpm --filter @in-atelier/web-console typecheck`
- `corepack pnpm --filter @in-atelier/web-console build`
- `corepack pnpm lint`

Corregir los fallos relacionados con la feature antes de cerrar la tarea.

---

### T05-P4-02 · Git / PR / merge

Completar el flujo estándar de la feature:

- commit en `047-console-session-guards`
- push
- PR contra `main`
- esperar/checkear CI
- corregir fallos si aparecen
- merge cuando CI quede verde

Mantener el alcance acotado a T05.
