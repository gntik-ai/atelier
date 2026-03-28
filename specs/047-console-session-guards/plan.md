# Plan técnico de implementación — US-UI-01-T05

**Feature Branch**: `047-console-session-guards`
**Task ID**: US-UI-01-T05
**Epic**: EP-14 — Consola de administración: shell, acceso y contexto
**Historia padre**: US-UI-01 — Shell de consola: stack React/Tailwind/shadcn, login y navegación base
**Fecha del plan**: 2026-03-28
**Estado**: Ready for tasks

---

## 1. Objetivo y alcance estricto de T05

Endurecer `apps/web-console/` para que la experiencia post-login tenga un lifecycle de sesión usable y seguro:

- rutas protegidas bajo `/console/*`
- preservación de ruta destino para volver tras login
- refresh explícito del token set mediante el family auth ya publicado
- recuperación acotada ante `401` en requests autenticadas
- limpieza total de sesión cuando el refresh ya no es viable
- mensaje de estado auth comprensible cuando la consola expira o revoca la sesión

La entrega debe dejar lista la base funcional para que T06 solo valide por E2E, sin reabrir todavía:

- autorización fina por roles/scopes
- sincronización avanzada multi-tab
- cambios de UX profundos en shell/signup

---

## 2. Estado actual relevante del repositorio

### Baseline entregado por T04

`apps/web-console/` ya dispone de:

- `ConsoleShellLayout` y árbol `/console/*`
- login funcional contra `POST /v1/auth/login-sessions`
- persistencia local básica del snapshot de sesión
- logout remoto y limpieza local
- placeholders navegables para las vistas protegidas iniciales

### Contratos auth relevantes para T05

Según `apps/control-plane/openapi/families/auth.openapi.json`:

- `POST /v1/auth/login-sessions` devuelve `ConsoleLoginSession`
- `DELETE /v1/auth/login-sessions/{sessionId}` invalida una sesión activa
- `POST /v1/auth/login-sessions/{sessionId}/refresh` recibe `ConsoleTokenRefreshRequest` y devuelve el `ConsoleLoginSession` rotado
- los errores principales de refresh relevantes para cliente son `403`, `404`, `429`, `504` y `default` vía `ErrorResponse`

---

## 3. Decisiones técnicas

| Decisión | Elección | Justificación |
|---|---|---|
| Guardas de ruta | `ProtectedRoute` dedicado para el árbol `/console/*` | Centraliza acceso protegido sin contaminar cada página. |
| Persistencia de intención | Guardar destino protegido en storage temporal | Permite volver al contexto tras login/expiración. |
| Gestión de sesión | Extender `console-session.ts` como runtime auth del cliente | Reutiliza el snapshot existente y evita repartir lógica en varios módulos. |
| Refresh | Helper explícito `refreshConsoleLoginSession(sessionId, refreshToken)` | Sigue el contrato OpenAPI publicado y mantiene trazabilidad con el family auth. |
| Requests autenticadas | Wrapper de request con bearer + recuperación única ante `401` | Resuelve el caso real de expiración en uso sin loops infinitos. |
| Concurrencia refresh | Reutilizar una única promesa de refresh en el navegador | Evita ráfagas y sesiones desalineadas cuando coinciden varias requests. |
| Mensaje de sesión expirada | Hint auth persistido y consumido por `LoginPage` | Entrega feedback claro tras redirección forzada. |
| Shell y router | Mantener el shell T04 y endurecer acceso alrededor | Minimiza regresiones y conserva el alcance incremental. |

---

## 4. Arquitectura objetivo

```text
LoginPage
  ├─► createConsoleLoginSession()
  ├─► persistConsoleShellSession()
  ├─► consumeStoredProtectedRoute()
  └─► navigate(returnTo || '/console/overview')

ProtectedRoute
  ├─► readConsoleShellSession()
  ├─► ensureConsoleSession()
  │     ├─► refreshConsoleLoginSession() cuando haga falta
  │     └─► persistConsoleShellSession() con token rotado
  ├─► storeProtectedRouteIntent(location)
  └─► Navigate('/login') si no hay sesión recuperable

Authenticated request
  ├─► getValidAccessToken()
  ├─► requestJson(..., Authorization)
  ├─► on 401 => refresh once
  └─► retry original request exactly once
```

### Límites entre componentes

| Componente | Responsabilidad | Fuera de alcance |
|---|---|---|
| `console-auth.ts` | Tipos auth y llamadas REST login/logout/refresh | UI, storage, navegación |
| `console-session.ts` | Snapshot local, refresh orchestration, hints auth, request auth wrapper | Composición visual del shell |
| `ProtectedRoute.tsx` | Gate de navegación, loading inicial y redirección segura | Render de negocio de cada vista |
| `router.tsx` | Inserción del guard en `/console/*` y consistencia de rutas | Lógica interna de refresh |
| `LoginPage.tsx` | Consumir hints, respetar ruta recordada y evitar login redundante | Nuevos flujos de signup |

---

## 5. Cambios propuestos por artefacto o carpeta

### 5.1 `apps/web-console/src/lib/console-auth.ts`

Añadir/asegurar:

- tipo `ConsoleTokenRefreshRequest`
- helper `refreshConsoleLoginSession(sessionId, refreshToken, signal?)`
- reutilización de `requestJson()` e idempotencia del request de refresh

### 5.2 `apps/web-console/src/lib/console-session.ts`

Extender para cubrir:

- validación del snapshot local
- helpers de expiración / margen de refresh
- almacenamiento y consumo de la ruta protegida recordada
- almacenamiento y consumo del hint de estado auth
- `ensureConsoleSession()` con refresh on-demand
- `requestConsoleSessionJson()` para requests autenticadas con un único reintento tras `401`
- serialización de refresh concurrente con una promesa compartida

### 5.3 `apps/web-console/src/components/auth/ProtectedRoute.tsx`

Crear componente con:

- pantalla mínima de carga de autenticación
- intento inicial de recuperación si la sesión existe pero necesita refresh
- guardado del destino protegido antes de redirigir a `/login`
- render de `Outlet` solo cuando la sesión ya está disponible

### 5.4 `apps/web-console/src/router.tsx`

Modificar para que `/console` quede envuelto por `ProtectedRoute` antes de `ConsoleShellLayout`, manteniendo todas las rutas públicas actuales.

### 5.5 `apps/web-console/src/pages/LoginPage.tsx`

Ajustar para:

- leer y consumir el hint auth (sesión expirada/revocada)
- leer la ruta protegida recordada y navegar a ella tras login exitoso
- redirigir automáticamente fuera de login si ya existe sesión válida o recuperable
- mantener el feedback visible ya existente del login

### 5.6 Tests

- `apps/web-console/src/lib/console-session.test.ts` para refresh, hints y request retry
- `apps/web-console/src/components/auth/ProtectedRoute.test.tsx` para guardas y redirecciones
- `apps/web-console/src/pages/LoginPage.test.tsx` para hint auth y retorno al destino recordado
- `apps/web-console/src/router.test.tsx` solo si hace falta ajustar el árbol protegido o redirecciones visibles

---

## 6. Estrategia de pruebas

### Unitarias / integración ligera

**`console-session.test.ts`** debe cubrir al menos:

1. snapshot inválido tratado como sesión nula
2. refresh exitoso y persistencia del nuevo token set
3. refresh concurrente reutiliza una sola promesa
4. `requestConsoleSessionJson()` adjunta bearer
5. `401` recuperable => refresh + reintento único
6. refresh fallido => limpieza de sesión + hint auth

**`ProtectedRoute.test.tsx`** debe cubrir al menos:

1. sin sesión => redirección a login y persistencia de ruta destino
2. con sesión válida => render del `Outlet`
3. con sesión refrescable => loading breve + acceso concedido
4. con refresh fallido => redirección y hint auth persistido

**`LoginPage.test.tsx`** debe cubrir al menos:

1. muestra hint auth consumido desde storage
2. tras login exitoso navega al destino protegido recordado
3. si ya existe sesión válida, evita permanecer en login

### Validaciones operativas

- `corepack pnpm --filter @in-atelier/web-console test`
- `corepack pnpm --filter @in-atelier/web-console typecheck`
- `corepack pnpm --filter @in-atelier/web-console build`
- `corepack pnpm lint`

---

## 7. Riesgos, compatibilidad y rollback

### Riesgos

- **Loops auth**: un mal manejo de 401 puede provocar refresh infinitos. Mitigación: un único reintento por request.
- **Refresh paralelo**: varias requests pueden disparar refresh simultáneo. Mitigación: promesa compartida en runtime.
- **Storage corrupto**: snapshots incompletos pueden romper la UI. Mitigación: validación defensiva y caída a sesión nula.
- **Regresión en login**: cambiar la navegación post-login puede afectar T02/T04. Mitigación: mantener feedback actual y limitar el cambio al destino final.

### Compatibilidad

- No cambia el contrato backend publicado; consume el endpoint de refresh ya descrito en el family auth.
- Mantiene las rutas públicas y el shell existentes.
- Conserva logout remoto/local ya entregado en T04.

### Rollback

- El cambio es íntegramente de cliente web-console.
- Si apareciera una regresión severa, puede revertirse la rama/PR sin migraciones ni impacto persistente en datos.

---

## 8. Secuencia recomendada de implementación

1. Extender `console-auth.ts` con el refresh contractual.
2. Endurecer `console-session.ts` como runtime auth local.
3. Crear `ProtectedRoute.tsx`.
4. Envolver `/console/*` en `router.tsx`.
5. Ajustar `LoginPage.tsx` para hints y retorno a destino.
6. Añadir/ajustar tests.
7. Ejecutar test, typecheck, build y lint del paquete.

---

## 9. Criterios de done y evidencia esperada

### Done verificable

- todas las rutas `/console/*` pasan por una guarda reutilizable;
- la consola puede refrescar una sesión mediante el endpoint oficial de auth;
- las requests autenticadas pueden recuperarse de un `401` con un solo refresh + retry;
- el login respeta la ruta protegida recordada y muestra el hint auth cuando corresponda;
- las pruebas automatizadas cubren guardas, refresh y expiración;
- `test`, `typecheck`, `build` y `lint` pasan para `@in-atelier/web-console`.

### Evidencia esperada

- diff de cliente enfocado en auth/session routing;
- salida verde de Vitest, typecheck y build;
- commit en la rama `047-console-session-guards` listo para PR.
