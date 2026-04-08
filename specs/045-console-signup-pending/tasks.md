# Tareas de implementación — US-UI-01-T03

**Feature Branch**: `045-console-signup-pending`
**Task ID**: US-UI-01-T03
**Epic**: EP-14 — Consola de administración: shell, acceso y contexto
**Historia padre**: US-UI-01 — Shell de consola: stack React/Tailwind/shadcn, login y navegación base
**Fecha**: 2026-03-28
**Estado**: Ready for implementation

---

## Archivos que la implementación tocará

> Mapa de lectura para el agente de implementación. **Lee solo estos archivos** y el family file OpenAPI indicado. **No leas** `apps/control-plane/openapi/control-plane.openapi.json`.

```text
apps/control-plane/openapi/families/auth.openapi.json        ← LEER solo paths/schemas relevantes de signup/policy/status
apps/web-console/src/lib/console-config.ts                   ← MODIFICAR
apps/web-console/src/lib/console-auth.ts                     ← MODIFICAR
apps/web-console/src/router.tsx                              ← MODIFICAR
apps/web-console/src/pages/LoginPage.tsx                     ← MODIFICAR solo si hace falta coherencia de CTA/copy
apps/web-console/src/pages/LoginPage.test.tsx                ← MODIFICAR solo si cambia discoverability
apps/web-console/src/pages/SignupPage.tsx                    ← CREAR
apps/web-console/src/pages/SignupPage.test.tsx               ← CREAR
apps/web-console/src/pages/PendingActivationPage.tsx         ← CREAR
apps/web-console/src/pages/PendingActivationPage.test.tsx    ← CREAR
```

### Reglas obligatorias para lectura durante implement

1. Leer `plan.md` y `tasks.md` como único contexto Spec Kit.
2. Del `auth.openapi.json`, leer solo:
   - path `/v1/auth/signups`
   - path `/v1/auth/signups/policy`
   - path `/v1/auth/status-views/{statusViewId}`
   - schemas `ConsoleSignupRequest`, `ConsoleSignupRegistration`, `ConsoleSignupPolicy`, `ConsoleAccountStatusView`, `ConsoleSignupState`, `ConsoleStatusViewId`, `ErrorResponse`
3. Para patrones de test existentes, leer solo la cabecera imports + primer caso de `LoginPage.test.tsx`.
4. No explorar el repo con `find` ni `ls` amplios. Este mapa es suficiente.
5. Si necesitas helper patterns, lee solo las secciones necesarias de `console-auth.ts` y `LoginPage.tsx`; no abras archivos adicionales fuera del mapa.

---

## Fase 1 — Cliente auth y configuración

### T03-P1-01 · Extender `console-config.ts`

Modificar `apps/web-console/src/lib/console-config.ts` para añadir:

- `pendingActivationPath: '/signup/pending-activation'`
- labels o copy mínimos de signup/pending activation si ayudan a evitar duplicación

Mantener los defaults actuales de login/signup/password recovery.

---

### T03-P1-02 · Extender `console-auth.ts` con signup

Modificar `apps/web-console/src/lib/console-auth.ts` para añadir:

- tipo `ConsoleSignupRequest`
- tipo `ConsoleSignupState`
- tipo `ConsoleSignupRegistration`
- helper `createConsoleSignup(payload, signal?)`

Requisitos:

- usar `POST /v1/auth/signups`
- body alineado al schema `ConsoleSignupRequest`
- reutilizar `requestJson()`
- no introducir persistencia de sesión ni refresh tokens

---

## Fase 2 — Pantallas públicas

### T03-P2-01 · Crear `SignupPage.tsx`

Crear `apps/web-console/src/pages/SignupPage.tsx`.

Debe incluir:

- heading y subtítulo de registro de consola
- campos `username`, `displayName`, `primaryEmail`, `password`
- CTA principal de submit
- CTA visible a `/login`
- resolución inicial de `signupPolicy`
- mensaje de modo efectivo (`auto_activate` vs `approval_required`)
- bloqueo del submit cuando `policyLoading`, `!allowed` o la petición está en vuelo

Comportamiento esperado:

- `POST /v1/auth/signups` con payload válido
- `state=active` → feedback de éxito + CTA a login
- `state=pending_activation` → navegación a `/signup/pending-activation` con contexto de registro
- `400` → feedback de validación
- `403` → signup no disponible/policy rechazada
- `409` → cuenta ya existente
- `429`/`504`/red → feedback operativo reintentable

---

### T03-P2-02 · Crear `PendingActivationPage.tsx`

Crear `apps/web-console/src/pages/PendingActivationPage.tsx`.

Debe incluir:

- heading explícito de activación pendiente
- lectura opcional de `location.state` para mostrar `registrationId`, `message`, `activationMode` o estado devuelto por el signup
- `best effort` a `getConsoleAccountStatusView('pending_activation')`
- CTA a login
- CTA secundario a signup si resulta útil

Restricciones:

- no hacer polling
- no intentar activar la cuenta desde la SPA
- no depender exclusivamente del contexto de navegación para renderizar algo útil

---

### T03-P2-03 · Registrar rutas nuevas

Modificar `apps/web-console/src/router.tsx` para declarar:

- `"/signup"` → `<SignupPage />`
- `"/signup/pending-activation"` → `<PendingActivationPage />`

Mantener `/`, `/login` y `*`.

---

### T03-P2-04 · Ajuste mínimo de discoverability

Modificar `apps/web-console/src/pages/LoginPage.tsx` solo si hace falta para mantener coherencia entre:

- CTA hacia signup
- copy del estado `pending_activation`
- retorno a login/signup entre pantallas

No reabrir el alcance de T02.

---

## Fase 3 — Tests

### T03-P3-01 · Crear `SignupPage.test.tsx`

Crear `apps/web-console/src/pages/SignupPage.test.tsx`.

Cobertura mínima obligatoria:

1. render del formulario cuando la policy permite signup
2. pantalla informativa/bloqueo cuando la policy deshabilita signup
3. submit exitoso con resultado `active` mostrando CTA a login
4. submit exitoso con resultado `pending_activation` mostrando la transición esperada
5. conflicto `409` mostrando feedback de cuenta existente

Sugerencia:

- mockear `global.fetch`
- verificar que el signup usa `POST /v1/auth/signups`
- verificar headers operativos al menos en la llamada de submit

---

### T03-P3-02 · Crear `PendingActivationPage.test.tsx`

Crear `apps/web-console/src/pages/PendingActivationPage.test.tsx`.

Cobertura mínima obligatoria:

1. render con contexto de navegación previo
2. render útil cuando el fetch de `status-view` falla
3. CTA visible a `/login`

---

### T03-P3-03 · Ajustar tests existentes solo si cambia discoverability

Modificar `apps/web-console/src/pages/LoginPage.test.tsx` únicamente si el CTA o copy visible cambia por coherencia con T03.

---

## Fase 4 — Validación end-to-end de la tarea

### T03-P4-01 · Validación del paquete web-console

Ejecutar y dejar verde:

```bash
corepack pnpm --filter @in-falcone/web-console test
corepack pnpm --filter @in-falcone/web-console typecheck
corepack pnpm --filter @in-falcone/web-console build
```

---

### T03-P4-02 · Validación global del monorepo

Ejecutar y dejar verde:

```bash
corepack pnpm lint
corepack pnpm test
```

---

### T03-P4-03 · Git + PR + CI + merge

Completar íntegramente dentro del paso implement:

1. `git status` limpio salvo los cambios previstos
2. commit con mensaje coherente para T03
3. push de `045-console-signup-pending`
4. abrir PR contra `main`
5. observar checks hasta verde
6. corregir localmente cualquier fallo de CI y repush si fuese necesario
7. fusionar a `main` cuando la PR quede verde
8. volver a `main`, sincronizar con `origin/main` y preparar el siguiente cursor del backlog
