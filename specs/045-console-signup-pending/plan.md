# Plan técnico de implementación — US-UI-01-T03

**Feature Branch**: `045-console-signup-pending`
**Task ID**: US-UI-01-T03
**Epic**: EP-14 — Consola de administración: shell, acceso y contexto
**Historia padre**: US-UI-01 — Shell de consola: stack React/Tailwind/shadcn, login y navegación base
**Fecha del plan**: 2026-03-28
**Estado**: Ready for tasks

---

## 1. Objetivo y alcance estricto de T03

Añadir a `apps/web-console/` la capacidad pública de **signup self-service** y la **pantalla dedicada de activación pendiente**, reutilizando la familia pública `/v1/auth/*` ya introducida en T02 y manteniendo la UX acotada al punto de entrada de acceso.

La entrega debe cubrir:

- ruta `/signup`
- formulario mínimo de registro
- resolución de policy de auto-registro
- creación de signup vía `/v1/auth/signups`
- representación diferenciada de resultados `active` y `pending_activation`
- ruta/pantalla dedicada para activación pendiente
- pruebas unitarias/componentes del flujo principal

**Fuera de alcance en T03**:

- shell persistente con header/sidebar (`T04`)
- persistencia/refresh de tokens y rutas protegidas (`T05`)
- flujo completo de recuperación de contraseña
- activación administrativa del registro
- E2E completos de acceso (`T06`)

---

## 2. Estado actual relevante del repositorio

### Baseline entregado por T02

`apps/web-console/` ya dispone de:

- `src/lib/http.ts` con headers operativos (`X-API-Version`, `X-Correlation-Id`, `Idempotency-Key`)
- `src/lib/console-auth.ts` con helpers de `login-sessions`, `signups/policy` y `status-views`
- `src/lib/console-config.ts` con paths configurables de login/signup/password recovery
- `src/pages/LoginPage.tsx` con formulario de acceso, CTA de signup y feedback de estados especiales
- `src/router.tsx` con rutas `/` y `/login`
- pruebas de `LoginPage` con mocking directo de `fetch`

### Contratos auth relevantes

Según `apps/control-plane/openapi/families/auth.openapi.json`:

- `POST /v1/auth/signups` acepta `ConsoleSignupRequest` y devuelve `202` con `ConsoleSignupRegistration`
- `GET /v1/auth/signups/policy` devuelve `ConsoleSignupPolicy`
- `GET /v1/auth/status-views/{statusViewId}` devuelve `ConsoleAccountStatusView`
- `ConsoleSignupRegistration.state` puede ser `pending_activation`, `active` o `rejected`
- `ConsoleSignupRegistration.statusView` puede alimentar la pantalla a mostrar tras el alta

---

## 3. Decisiones técnicas

| Decisión | Elección | Justificación |
|---|---|---|
| Cliente HTTP | Reutilizar `requestJson()` existente | Ya normaliza headers y errores del family público auth. |
| Cliente auth | Extender `console-auth.ts` con signup | Mantiene un único punto de acceso a la familia `/v1/auth/*`. |
| Routing | Añadir `/signup` y `/signup/pending-activation` | Permite separar claramente alta y estado post-registro sin introducir shell. |
| Estado post-signup | Navegación a pantalla dedicada para `pending_activation`; feedback inline + CTA a login para `active` | Mantiene UX explícita y incremental. |
| Fuente de copy canónica | Intentar resolver `status-views/pending_activation` y degradar con copy local segura si falla | Alinea UX con backend sin hacer la pantalla dependiente de una única llamada adicional. |
| Validación UI | Reglas HTML/React mínimas, sin introducir librerías nuevas | Mantiene la entrega pequeña y consistente con T02. |
| Testing | Vitest + RTL con `fetch` mockeado | Patrón ya adoptado en `LoginPage.test.tsx`. |

---

## 4. Arquitectura objetivo

```text
Browser
  └─► React Router
        ├─► /login                        → LoginPage
        ├─► /signup                       → SignupPage
        └─► /signup/pending-activation    → PendingActivationPage

SignupPage
  ├─► GET /v1/auth/signups/policy
  ├─► si allowed=true → muestra formulario
  └─► POST /v1/auth/signups
         ├─► state=active              → feedback de alta completada + CTA a login
         └─► state=pending_activation  → navegación a PendingActivationPage

PendingActivationPage
  ├─► consume estado de navegación si existe
  ├─► GET /v1/auth/status-views/pending_activation (best effort)
  └─► muestra copy + acciones seguras (login/signup)
```

### Límites entre componentes

| Componente | Responsabilidad | Fuera de alcance |
|---|---|---|
| `console-auth.ts` | Tipos y helpers para signup/policy/status-view | Persistencia de sesión o refresh tokens |
| `SignupPage.tsx` | Formulario, carga de policy, submit, feedback y CTA | Shell autenticado o autorización |
| `PendingActivationPage.tsx` | Copy de estado, resumen de registro y acciones siguientes | Polling de activación o aprobación administrativa |
| `router.tsx` | Declarar nuevas rutas públicas | Guards de autenticación |
| `LoginPage.tsx` | Ajustes menores de discoverability si hacen falta | Reescritura funcional amplia |

---

## 5. Cambios propuestos por artefacto o carpeta

### 5.1 `apps/web-console/src/lib/console-auth.ts`

Extender el módulo con:

- tipo `ConsoleSignupRequest`
- tipo `ConsoleSignupState`
- tipo `ConsoleSignupRegistration`
- helper `createConsoleSignup(payload, signal?)`
- helper opcional para inferir copy/defaults de signup si la respuesta trae `statusView`

Mantener los tipos ya existentes de `ConsoleSignupPolicy` y `ConsoleAccountStatusView`.

### 5.2 `apps/web-console/src/lib/console-config.ts`

Añadir configuración para:

- `pendingActivationPath` con default `/signup/pending-activation`
- copy específica de signup/pending activation si ayuda a evitar strings duplicados

### 5.3 `apps/web-console/src/router.tsx`

Registrar:

- `"/signup"` → `<SignupPage />`
- `"/signup/pending-activation"` → `<PendingActivationPage />`

Mantener `/`, `/login` y `*`.

### 5.4 `apps/web-console/src/pages/SignupPage.tsx`

Crear página con:

- carga inicial de `signupPolicy`
- formulario con `username`, `displayName`, `primaryEmail`, `password`
- bloqueo de submit si `policyLoading`, `!allowed` o petición en vuelo
- copy de modo efectivo (`auto_activate` vs `approval_required`)
- submit a `createConsoleSignup`
- manejo de resultados:
  - `active` → alerta de éxito + CTA a login
  - `pending_activation` → navegación a `pendingActivationPath` con `location.state`
- manejo de errores:
  - `400` → feedback de validación
  - `403` → policy rechazada / signup no disponible
  - `409` → cuenta ya existente
  - `429`, `504`, red y resto → feedback operativo reintentable

### 5.5 `apps/web-console/src/pages/PendingActivationPage.tsx`

Crear pantalla dedicada que:

- intente leer `location.state` con `registrationId`, `message`, `state`, `activationMode`
- haga `best effort` a `getConsoleAccountStatusView('pending_activation')`
- muestre resumen útil aunque el fetch secundario falle
- ofrezca CTA a `/login` y opcionalmente a `/signup`
- no haga polling, no reenvíe signup, no asuma sesión autenticada

### 5.6 `apps/web-console/src/pages/LoginPage.tsx`

Solo cambios mínimos si hacen falta para consistencia de discoverability/copy con T03. No ampliar el alcance de T02.

### 5.7 Tests

Crear:

- `apps/web-console/src/pages/SignupPage.test.tsx`
- `apps/web-console/src/pages/PendingActivationPage.test.tsx`

Ajustar, solo si es necesario:

- `apps/web-console/src/pages/LoginPage.test.tsx`
- `apps/web-console/src/pages/WelcomePage.test.tsx`

---

## 6. Estrategia de pruebas

### Unit / component tests

**`SignupPage.test.tsx`** debe cubrir al menos:

1. render del formulario cuando la policy permite signup
2. bloqueo/estado informativo cuando la policy deshabilita signup
3. submit exitoso con resultado `active` mostrando CTA a login
4. submit exitoso con resultado `pending_activation` navegando a la pantalla dedicada o mostrando su contenido
5. conflicto `409` mostrando feedback de cuenta existente

**`PendingActivationPage.test.tsx`** debe cubrir al menos:

1. render con contexto de navegación previo
2. degradación segura cuando el `status-view` falla
3. presencia de CTA de retorno a login

### Validaciones operativas

- `corepack pnpm --filter @in-falcone/web-console test`
- `corepack pnpm --filter @in-falcone/web-console typecheck`
- `corepack pnpm --filter @in-falcone/web-console build`
- `corepack pnpm lint`
- `corepack pnpm test`

---

## 7. Riesgos, compatibilidad y rollback

### Riesgos

- **Deriva entre policy y resultado de signup**: la policy puede indicar una cosa y el alta terminar en otra vía por reglas de backend. Mitigación: renderizar siempre el resultado real devuelto por `ConsoleSignupRegistration`.
- **Pantalla pendiente sin contexto de navegación**: un acceso directo puede carecer de detalles del registro. Mitigación: fallback local + `status-view` best effort.
- **Mensajes inconsistentes entre login y signup**: T02 ya resuelve `pending_activation` desde login. Mitigación: reutilizar `status-view` y copy común donde sea posible.

### Compatibilidad

- Cambios aditivos sobre las rutas públicas actuales.
- No altera contratos backend existentes.
- No introduce nuevas dependencias externas ni cambia la estrategia de build.

### Rollback

- Revertir el commit de la feature elimina rutas y páginas nuevas sin afectar el baseline de login.

---

## 8. Secuencia recomendada de implementación

1. Extender `console-config.ts` y `console-auth.ts` con signup/pending activation.
2. Crear `SignupPage.tsx` con policy load + submit + feedback.
3. Crear `PendingActivationPage.tsx` con resolución best effort de status-view.
4. Registrar rutas nuevas en `router.tsx`.
5. Ajustar `LoginPage.tsx` solo si se necesita coherencia de CTA/copy.
6. Añadir tests de signup y pending activation.
7. Ejecutar validaciones del paquete y del monorepo.
8. Completar commit, push, PR, CI y merge dentro del mismo paso implement.

---

## 9. Criterios de done verificables

La tarea se considera done cuando:

- existe ruta pública `/signup`
- el formulario de signup usa el contrato `/v1/auth/signups`
- la UI refleja honestamente la policy resuelta por `/v1/auth/signups/policy`
- existe pantalla dedicada para `pending_activation`
- los tests nuevos cubren los flujos principales y de degradación
- `@in-falcone/web-console` queda verde en `test`, `typecheck` y `build`
- el monorepo queda verde en `lint` y `test`
- la rama `045-console-signup-pending` se publica, pasa CI y se fusiona a `main`
