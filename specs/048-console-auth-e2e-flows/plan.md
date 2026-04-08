# Plan técnico de implementación — US-UI-01-T06

**Feature Branch**: `048-console-auth-e2e-flows`
**Task ID**: US-UI-01-T06
**Epic**: EP-14 — Consola de administración: shell, acceso y contexto
**Historia padre**: US-UI-01 — Shell de consola: stack React/Tailwind/shadcn, login y navegación base
**Fecha del plan**: 2026-03-28
**Estado**: Ready for tasks

---

## 1. Objetivo y alcance estricto de T06

Entregar una suite E2E pequeña, estable y ejecutable para `apps/web-console/` que valide desde navegador los journeys mínimos del release inicial de la consola:

- acceso a ruta protegida sin sesión → redirección a login;
- login válido → restauración del destino protegido y navegación básica dentro del shell;
- logout desde el avatar menu → limpieza del acceso protegido y retorno a login;
- signup válido con policy de aprobación → aterrizaje en pending activation.

La tarea debe dejar la consola con evidencia automatizada del comportamiento observable ya implementado en T01–T05, sin reabrir todavía:

- integración real contra Keycloak desplegado;
- cobertura E2E de permisos finos o dominios de negocio posteriores;
- rediseños de UX o refactors profundos del shell/login/signup.

---

## 2. Estado actual relevante del repositorio

### Baseline entregado por T01–T05

`apps/web-console/` ya dispone de:

- SPA React/Vite operativa con Tailwind/shadcn;
- rutas públicas `/`, `/login`, `/signup`, `/signup/pending-activation`;
- árbol protegido `/console/*` con `ProtectedRoute` y `ConsoleShellLayout`;
- login/sesión/logout/signup respaldados por el family auth público;
- tests unitarios e integración ligera con Vitest para las piezas principales.

### Hueco que cubre T06

No existe todavía una herramienta ni una suite de navegador que compruebe el journey completo del usuario sobre la SPA renderizada.

### Restricción clave para esta iteración

Para que la suite sea reproducible en CI y localmente, el backend auth no debe depender de un Keycloak real. Las respuestas HTTP necesarias se simularán dentro del propio navegador de pruebas sobre el subset `/v1/auth/*` que ya consume la consola.

---

## 3. Decisiones técnicas

| Decisión | Elección | Justificación |
|---|---|---|
| Runner E2E | `@playwright/test` dentro de `apps/web-console` | Proporciona navegador real, web server integrado, route mocking y aserciones robustas con poco código adicional. |
| Servidor bajo prueba | `vite preview` del build de `apps/web-console` | Valida la SPA ya compilada y evita depender de un entorno de desarrollo ad hoc. |
| Backend para la suite | Intercepción de red (`page.route`) sobre `/v1/auth/*` | Mantiene la suite determinista y desacoplada de Keycloak/servicios externos. |
| Alcance de escenarios | Un spec enfocado en login+retorno+navegación, logout y signup pending activation | Mantiene la suite pequeña y alineada con el backlog. |
| Selectores | Priorizar roles, labels, textos y rutas visibles ya existentes | Minimiza cambios en la UI solo para testing. |
| Validación local | `vitest` + `typecheck` + `build` + `playwright` + `lint` | Cubre regresiones del paquete y la nueva capa E2E antes de PR. |

---

## 4. Arquitectura objetivo

```text
Playwright test runner
  ├─► arranca `vite preview` para apps/web-console
  ├─► abre navegador Chromium
  ├─► intercepta /v1/auth/* con respuestas controladas
  ├─► ejecuta journeys reales sobre rutas públicas/protegidas
  └─► verifica navegación, mensajes y protección de sesión
```

### Flujo E2E 1 — Login con retorno a deep link y navegación base

```text
/console/workspaces?tab=active
  ├─► ProtectedRoute detecta ausencia de sesión
  ├─► redirección a /login
  ├─► mock GET/POST auth responde policy + sesión activa
  ├─► LoginPage persiste sesión y restaura el destino recordado
  ├─► shell renderiza Workspaces
  └─► usuario navega a otra sección base del sidebar (ej. Functions)
```

### Flujo E2E 2 — Logout

```text
sesión activa en /console/overview
  ├─► usuario abre menú de avatar
  ├─► mock DELETE /v1/auth/login-sessions/{sessionId} acepta terminación
  ├─► ConsoleShellLayout limpia sesión local y navega a /login
  └─► reentrada a /console/overview sin sesión vuelve a exigir login
```

### Flujo E2E 3 — Signup con pending activation

```text
/signup
  ├─► mock policy permite approval_required
  ├─► usuario completa formulario
  ├─► mock POST /v1/auth/signups devuelve pending_activation
  ├─► navegación a /signup/pending-activation
  └─► PendingActivationPage renderiza mensaje y resumen del registro
```

---

## 5. Cambios propuestos por artefacto o carpeta

### 5.1 `apps/web-console/package.json`

Añadir:

- dependencia de desarrollo `@playwright/test`;
- script `test:e2e` para ejecutar la suite;
- script auxiliar `e2e:serve` para publicar la build en el puerto fijo usado por Playwright.

### 5.2 `apps/web-console/playwright.config.ts`

Crear configuración con:

- `testDir` apuntando al directorio E2E del paquete;
- `baseURL` local fija;
- `webServer` que haga `build && vite preview` del paquete;
- proyecto Chromium único para mantener la suite rápida;
- timeouts y reuse de servidor razonables.

### 5.3 `apps/web-console/e2e/console-auth-flows.e2e.ts`

Crear el spec E2E con helpers internos para:

- mockear `GET /v1/auth/signups/policy`;
- mockear `POST /v1/auth/login-sessions`;
- mockear `DELETE /v1/auth/login-sessions/{sessionId}`;
- mockear `POST /v1/auth/signups`;
- opcionalmente mockear `GET /v1/auth/status-views/pending_activation`.

Escenarios mínimos:

1. deep link protegido → login → retorno al destino → navegación a otra sección base;
2. logout desde shell → vuelta a login → protección restaurada;
3. signup approval_required → pending activation.

### 5.4 `pnpm-lock.yaml`

Actualizar el lockfile para reflejar la nueva dependencia de Playwright.

---

## 6. Estrategia de pruebas

### Suite E2E nueva

**Escenario 1 — login + retorno + navegación**

Debe cubrir al menos:

1. abrir `/console/workspaces?tab=active` sin sesión;
2. observar `/login`;
3. completar usuario/contraseña;
4. verificar aterrizaje en `/console/workspaces?tab=active`;
5. verificar shell visible;
6. navegar a `/console/functions` desde el sidebar.

**Escenario 2 — logout**

Debe cubrir al menos:

1. entrar con sesión válida a una ruta de consola;
2. abrir menú de avatar;
3. ejecutar logout y esperar `DELETE` aceptado;
4. verificar `/login`;
5. reintentar `/console/overview` y confirmar redirección a login.

**Escenario 3 — signup**

Debe cubrir al menos:

1. abrir `/signup` con policy `approval_required`;
2. completar formulario de alta;
3. recibir respuesta `pending_activation`;
4. verificar `/signup/pending-activation` y el mensaje principal.

### Validaciones del paquete

- `corepack pnpm --filter @in-falcone/web-console test`
- `corepack pnpm --filter @in-falcone/web-console typecheck`
- `corepack pnpm --filter @in-falcone/web-console build`
- `corepack pnpm --filter @in-falcone/web-console test:e2e`
- `corepack pnpm lint`

---

## 7. Riesgos, compatibilidad y rollback

### Riesgos

- **Peso de la herramienta E2E**: Playwright aumenta dependencias y tiempo de CI. **Mitigación**: usar solo Chromium y tres escenarios pequeños.
- **Fragilidad por copy/UI**: los textos visibles pueden cambiar. **Mitigación**: centrar aserciones en rutas, headings y acciones clave ya estables.
- **Dependencia de servidor externo**: usar Keycloak real haría la suite inestable. **Mitigación**: mock de `/v1/auth/*` dentro de Playwright.
- **Flakiness por build/preview**: la suite depende de servir la build. **Mitigación**: usar puerto fijo, `strictPort`, timeout razonable y un único proyecto.

### Compatibilidad

- No se modifica el contrato backend publicado.
- No se cambian los flujos funcionales de login/signup/logout ya entregados; solo se añade evidencia automatizada de navegador.
- La configuración se mantiene encapsulada en `apps/web-console`.

### Rollback

- La entrega es autocontenida en scripts/config/tests de frontend.
- Si apareciera una regresión severa, la rama/PR puede revertirse sin migraciones ni impacto persistente en datos o APIs.

---

## 8. Secuencia recomendada de implementación

1. Añadir la dependencia/script de Playwright en `apps/web-console/package.json`.
2. Crear `playwright.config.ts` con servidor y baseURL del paquete.
3. Implementar el spec E2E con helpers de network mocking.
4. Ejecutar unit tests, typecheck y build del paquete.
5. Ejecutar la nueva suite E2E.
6. Ejecutar lint del repo para confirmar que no se introducen regresiones colaterales.
7. Preparar commit, push, PR, monitorización de CI y merge.

---

## 9. Criterios de done y evidencia esperada

### Done verificable

- existe un comando E2E reproducible en `@in-falcone/web-console`;
- la suite cubre login con retorno a deep link, logout y signup pending activation;
- la suite valida al menos una navegación autenticada básica del shell;
- la ejecución no depende de un Keycloak real ni de servicios externos;
- `test`, `typecheck`, `build`, `test:e2e` del paquete y `lint` del repo pasan en verde.

### Evidencia esperada

- diff acotado a configuración/scripts y tests E2E del paquete web-console;
- salida verde de Vitest, typecheck, build y Playwright;
- commit en la rama `048-console-auth-e2e-flows` listo para PR y merge.
