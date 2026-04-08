# Tareas de implementación — US-UI-01-T06

**Feature Branch**: `048-console-auth-e2e-flows`
**Task ID**: US-UI-01-T06
**Epic**: EP-14 — Consola de administración: shell, acceso y contexto
**Historia padre**: US-UI-01 — Shell de consola: stack React/Tailwind/shadcn, login y navegación base
**Fecha**: 2026-03-28
**Estado**: Ready for implementation

---

## Archivos que la implementación tocará

> Mapa de lectura para la implementación. **Lee solo estos archivos**. Para esta tarea no hace falta leer ningún family OpenAPI file ni el agregado `control-plane.openapi.json`.

```text
apps/web-console/package.json                           ← MODIFICAR
apps/web-console/playwright.config.ts                   ← CREAR
apps/web-console/e2e/console-auth-flows.e2e.ts         ← CREAR
pnpm-lock.yaml                                          ← ACTUALIZAR
```

### Reglas obligatorias para lectura durante implement

1. Leer `plan.md` y `tasks.md` como único contexto Spec Kit.
2. No leer `spec.md`, `research.md`, `data-model.md` ni `quickstart.md`.
3. No leer `apps/control-plane/openapi/control-plane.openapi.json`.
4. No explorar el repo con `find` ni `ls` amplios; el mapa anterior es suficiente.
5. Si hace falta recordar convenciones del paquete, leer solo `apps/web-console/package.json` de esta lista.

---

## Fase 1 — Configuración E2E del paquete

### T06-P1-01 · Añadir Playwright al paquete web-console

Modificar `apps/web-console/package.json` para añadir:

- dependencia de desarrollo `@playwright/test`
- script `test:e2e`
- script auxiliar `e2e:serve`

Restricciones:

- mantener intactos los scripts existentes de `test`, `build` y `typecheck`
- no introducir herramientas E2E adicionales

---

### T06-P1-02 · Crear `playwright.config.ts`

Crear `apps/web-console/playwright.config.ts` con:

- `testDir` apuntando al directorio `e2e`
- `baseURL` fija local
- `webServer` que ejecute `build && vite preview` del paquete
- proyecto Chromium único
- timeouts y `reuseExistingServer` razonables

Restricciones:

- mantener la configuración autocontenida en `apps/web-console`
- no depender de variables secretas ni servicios externos

---

## Fase 2 — Escenarios E2E

### T06-P2-01 · Crear `console-auth-flows.e2e.ts`

Crear `apps/web-console/e2e/console-auth-flows.e2e.ts`.

La suite debe incluir helpers locales para mockear las respuestas HTTP necesarias del family auth y cubrir estos escenarios mínimos:

1. **Deep link protegido + login + navegación básica**
   - abrir `/console/workspaces?tab=active`
   - verificar redirección a `/login`
   - completar login válido
   - verificar retorno a `/console/workspaces?tab=active`
   - navegar a otra sección base del sidebar (por ejemplo `Functions`)

2. **Logout desde el shell**
   - iniciar desde una sesión válida
   - abrir menú del avatar
   - ejecutar logout con `DELETE /v1/auth/login-sessions/{sessionId}` aceptado
   - verificar retorno a `/login`
   - confirmar que una nueva apertura de ruta protegida vuelve a pedir login

3. **Signup con pending activation**
   - abrir `/signup`
   - resolver policy `approval_required`
   - completar formulario válido
   - devolver `pending_activation`
   - verificar pantalla `/signup/pending-activation`

Restricciones:

- usar aserciones sobre comportamiento visible y rutas
- mantener los mocks dentro del propio spec para no abrir alcance innecesario
- no tocar lógica productiva salvo que resulte imprescindible por estabilidad real del test

---

## Fase 3 — Validación y entrega

### T06-P3-01 · Actualizar lockfile

Actualizar `pnpm-lock.yaml` para reflejar la nueva dependencia del paquete.

---

### T06-P3-02 · Validación del paquete y del repo

Ejecutar:

- `corepack pnpm --filter @in-falcone/web-console test`
- `corepack pnpm --filter @in-falcone/web-console typecheck`
- `corepack pnpm --filter @in-falcone/web-console build`
- `corepack pnpm --filter @in-falcone/web-console test:e2e`
- `corepack pnpm lint`

Corregir los fallos relacionados con la feature antes de cerrar la tarea.

---

### T06-P3-03 · Git / PR / merge

Completar el flujo estándar de la feature:

- commit en `048-console-auth-e2e-flows`
- push
- PR contra `main`
- esperar/checkear CI
- corregir fallos si aparecen
- merge cuando CI quede verde

Mantener el alcance acotado a T06.
