# Plan técnico de implementación — US-UI-01-T01

**Feature Branch**: `043-react-console-foundation`
**Task ID**: US-UI-01-T01
**Epic**: EP-14 — Consola de administración: shell, acceso y contexto
**Historia padre**: US-UI-01 — Shell de consola: stack React/Tailwind/shadcn, login y navegación base
**Fecha del plan**: 2026-03-28
**Estado**: Ready for tasks

---

## 1. Objetivo y alcance estricto de T01

Transformar `apps/web-console/` de su estado actual (placeholder con stubs `.mjs`) en una **Single Page Application (SPA) React** completamente funcional, con Tailwind CSS y shadcn/ui configurados, enrutamiento del lado del cliente, página de bienvenida identificable como consola administrativa, y un bundle de assets estáticos listo para servirse en el contenedor nginx que ya contempla el chart Helm.

**No se implementa en T01**: login, signup, sesión Keycloak, shell de navegación con sidebar, rutas protegidas ni pruebas E2E de autenticación.

---

## 2. Estado actual del repositorio

### `apps/web-console/`

```text

apps/web-console/
├── package.json            ← placeholder; sin React ni Vite
└── src/
    ├── README.md
    ├── observability-audit-correlation.mjs   ← stubs de lógica futura (OpenWhisk/backend)
    ├── observability-audit-export.mjs
    ├── observability-audit.mjs
    ├── observability-quota-usage.mjs
    ├── postgres-admin.mjs
    ├── public-api-catalog.mjs
    ├── tenant-management.mjs
    └── workspace-management.mjs

```

Los archivos `.mjs` bajo `src/` son stubs de lógica de servidor/OpenWhisk, **no** código de la aplicación React. Deben moverse a una carpeta `src/actions/` o `src/server/` para desambiguar su naturaleza antes de superponer la estructura React.

### Chart Helm

El chart ya tiene `webConsole` declarado:
- Deployment con imagen `in-falcone-web-console`, puerto `3000`.
- ConfigMap `in-falcone-web-console-config` en `values.yaml`.
- `webConsole.auth.*` disponible para T02–T05.
- El hostname de consola expuesto: `console.<env>.in-falcone.example.com`.

La SPA estática se servirá con **nginx** en el contenedor, escuchando en el puerto `3000`.

---

## 3. Decisiones técnicas

| Decisión | Elección | Justificación |
|---|---|---|
| Bundler / framework de proyecto | **Vite 5** | Estándar de facto para SPAs React; HMR rápido, build optimizado con código splitting y tree-shaking; sin SSR. |
| Runtime React | **React 18** + **React DOM 18** | Versión estable actual; compatibilidad verificada con shadcn/ui. |
| Enrutamiento | **React Router v6** (modo `createBrowserRouter`) | Enrutamiento del lado del cliente; navegación con History API; soporte para layouts anidados necesario en T04. |
| Estilos | **Tailwind CSS 3** | Requerimiento de proyecto. PostCSS como procesador. |
| Sistema de componentes | **shadcn/ui** (sobre Radix UI) | Requerimiento de proyecto. Componentes copiados al repo, no instalados como dependencia opaca. |
| Lenguaje | **TypeScript 5** | Detectabilidad de contratos en tiempo de desarrollo; alineado con la calidad esperada de la base. |
| Testing unitario y de componentes | **Vitest** + **React Testing Library** | Integración nativa con Vite; misma configuración de transformaciones. |
| Servidor de assets en contenedor | **nginx 1.25 (alpine)** | Imagen ligera, configuración CSP-ready, soporte para `try_files` necesario para SPA. |
| Gestión de paquetes | **pnpm 10** (workspace) | Consistente con la raíz del monorepo (`packageManager: pnpm@10.0.0`). |
| Metadato de versión de build | Variable de entorno `VITE_APP_VERSION` inyectada en build time | Trazabilidad de versión sin secretos embebidos. |

---

## 4. Arquitectura objetivo

```text

Browser
  └─► console.<env>.in-falcone.example.com  (APISIX → Service K8s → nginx:3000)
        └─► nginx sirve /dist como assets estáticos
              └─► index.html → React SPA (bundle JS/CSS)
                    └─► React Router
                          ├─► / → WelcomePage
                          └─► * → NotFoundPage

```

### Módulos internos de la SPA (T01)

```text

apps/web-console/
├── index.html                     ← Entry point HTML con <div id="root"> y meta version
├── vite.config.ts                 ← Configuración Vite (alias, env vars, test)
├── tailwind.config.ts             ← Tema y content paths
├── postcss.config.ts
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
├── nginx.conf                     ← Config nginx SPA-ready
├── Dockerfile                     ← Build multi-stage: node build + nginx serve
├── package.json                   ← Scripts React; dependencias declaradas
├── src/
│   ├── main.tsx                   ← ReactDOM.createRoot + RouterProvider
│   ├── router.tsx                 ← createBrowserRouter: routes declaradas
│   ├── App.tsx                    ← Root component (puede omitirse si router es top-level)
│   ├── lib/
│   │   └── utils.ts               ← cn() helper de shadcn/ui
│   ├── components/
│   │   └── ui/                    ← Componentes shadcn/ui copiados aquí (Button, Badge, etc.)
│   ├── pages/
│   │   ├── WelcomePage.tsx        ← Página de bienvenida (ruta /)
│   │   └── NotFoundPage.tsx       ← Ruta catch-all (*)
│   └── styles/
│       └── globals.css            ← @tailwind directives + CSS variables del tema shadcn
└── src/actions/                   ← Stubs OpenWhisk/server reubicados desde src/*.mjs
    ├── README.md                  ← Explica que estos archivos son lógica de servidor futura
    ├── observability-audit-correlation.mjs
    ├── observability-audit-export.mjs
    ├── observability-audit.mjs
    ├── observability-quota-usage.mjs
    ├── postgres-admin.mjs
    ├── public-api-catalog.mjs
    ├── tenant-management.mjs
    └── workspace-management.mjs

```

### Límites de componentes

| Frontera | Dentro de T01 | Fuera de T01 |
|---|---|---|
| `src/pages/` | `WelcomePage`, `NotFoundPage` | `LoginPage` (T02), `SignupPage` (T03), `DashboardPage` y ss. (T04+) |
| `src/components/ui/` | Componentes shadcn base instalados (Button, Badge mínimo) | Header, Sidebar, Avatar, Dropdown (T04) |
| `src/lib/` | `utils.ts` (cn helper) | `auth.ts` (T02/T05), `api.ts` (T02+) |
| `src/router.tsx` | Rutas `/` y `*` | Rutas protegidas, layout anidado de shell (T04/T05) |
| `nginx.conf` | Configuración SPA con `try_files` | Headers CSP/HSTS (responsabilidad APISIX, US-GW-01) |
| `Dockerfile` | Imagen build+serve para CI | Configuración de registry airgap (chart values) |

---

## 5. Cambios propuestos por artefacto

### 5.1 `apps/web-console/package.json` — reescribir completo

**Dependencias de producción:**

```text

react@^18.3.0
react-dom@^18.3.0
react-router-dom@^6.24.0
class-variance-authority@^0.7.0
clsx@^2.1.1
tailwind-merge@^2.4.0
lucide-react@^0.400.0
@radix-ui/react-slot@^1.1.0

```

**Dependencias de desarrollo:**

```text

vite@^5.3.0
@vitejs/plugin-react@^4.3.0
typescript@^5.5.0
@types/react@^18.3.0
@types/react-dom@^18.3.0
tailwindcss@^3.4.0
autoprefixer@^10.4.0
postcss@^8.4.0
vitest@^1.6.0
@vitest/coverage-v8@^1.6.0
@testing-library/react@^16.0.0
@testing-library/jest-dom@^6.4.0
@testing-library/user-event@^14.5.0
jsdom@^24.0.0

```

**Scripts:**

```text

dev           → vite
build         → tsc -b && vite build
preview       → vite preview
test          → vitest run
test:watch    → vitest
test:coverage → vitest run --coverage
typecheck     → tsc --noEmit
lint          → eslint src --ext ts,tsx

```

### 5.2 `apps/web-console/vite.config.ts`

- Plugin `@vitejs/plugin-react`
- Alias `@` → `./src`
- `define`: inyectar `__APP_VERSION__` desde `process.env.VITE_APP_VERSION ?? package.json#version`
- `build.outDir`: `dist`
- `test`: configuración Vitest con `jsdom` como environment, `setupFiles: ['./src/test/setup.ts']`

### 5.3 `apps/web-console/tailwind.config.ts`

- `content`: `['./index.html', './src/**/*.{ts,tsx}']`
- `theme.extend`: colores CSS variables del tema shadcn/ui (`--background`, `--foreground`, `--primary`, etc.) mapeados a variables CSS para compatibilidad con shadcn
- `darkMode`: `'class'` (preparado para T04)
- `plugins`: ninguno adicional en T01

### 5.4 `apps/web-console/src/styles/globals.css`

- Directivas `@tailwind base/components/utilities`
- Variables CSS del tema shadcn/ui en `:root` y `.dark` (colores, radios)

### 5.5 `apps/web-console/src/router.tsx`

```typescript

// Contrato de rutas declaradas en T01:
// - path: "/"       → element: <WelcomePage />
// - path: "*"       → element: <NotFoundPage />
// Pendiente de T04: agregar layout shell anidado

```

### 5.6 `apps/web-console/src/pages/WelcomePage.tsx`

- Componente funcional React
- Muestra nombre del producto ("In Falcone Console" o similar)
- Muestra mensaje de contexto ("Consola administrativa del producto BaaS multi-tenant")
- Incluye al menos un componente shadcn/ui visible (p. ej. `<Badge>` o `<Button>` decorativo)
- Estructura semántica: `<main>`, `<h1>`, contraste legible
- No realiza llamadas a APIs externas

### 5.7 `apps/web-console/src/pages/NotFoundPage.tsx`

- Componente funcional React
- Muestra mensaje "Página no encontrada" con enlace de vuelta a `/`
- Navegable por teclado

### 5.8 `apps/web-console/nginx.conf`

```nginx

# Puntos clave:

# - listen 3000

# - root /usr/share/nginx/html

# - try_files $uri $uri/ /index.html   ← crítico para SPA routing

# - gzip on para JS/CSS

# - cache headers para assets con hash en nombre; no-cache para index.html

# - Sin cabeceras CSP/HSTS (delegadas a APISIX)

```

### 5.9 `apps/web-console/Dockerfile`

Build multi-stage:

**Stage 1 (build):**

```dockerfile

FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
ARG VITE_APP_VERSION=dev
ENV VITE_APP_VERSION=$VITE_APP_VERSION
RUN pnpm build

```

**Stage 2 (serve):**

```dockerfile

FROM nginx:1.25-alpine AS runtime
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]

```

### 5.10 `apps/web-console/index.html`

- `<meta name="application-name" content="In Falcone Console">`
- `<meta name="version" content="%VITE_APP_VERSION%">` (reemplazado por Vite en build)
- `<div id="root"></div>`
- `<noscript>` con mensaje de fallback

### 5.11 Reubicación de stubs OpenWhisk

Mover `apps/web-console/src/*.mjs` → `apps/web-console/src/actions/`
Crear `apps/web-console/src/actions/README.md` con explicación de que estos archivos son lógica de servidor/OpenWhisk, no código de la SPA.

### 5.12 `apps/web-console/src/components/ui/`

Instalar (mediante `pnpm dlx shadcn@latest add`) los componentes mínimos necesarios para T01:
- `button` (componente de validación de integración en WelcomePage)
- `badge` (alternativo a button para identificación visual)

Los archivos copiados residen en `src/components/ui/button.tsx` y `src/lib/utils.ts`, siguiendo la convención shadcn de copiar al repo.

### 5.13 Tests a crear

| Archivo | Tipo | Qué valida |
|---|---|---|
| `src/test/setup.ts` | Setup | Importa `@testing-library/jest-dom/matchers` |
| `src/pages/WelcomePage.test.tsx` | Unit/componente | Renderiza sin errores; contiene `<h1>`; muestra nombre del producto; contiene texto de contexto; al menos 1 componente shadcn/ui presente |
| `src/pages/NotFoundPage.test.tsx` | Unit/componente | Renderiza sin errores; contiene texto "no encontrada"; contiene enlace a `/` |
| `src/router.test.tsx` | Integración enrutamiento | Navegar a `/` renderiza WelcomePage; navegar a ruta inexistente renderiza NotFoundPage |

### 5.14 Ajuste a `package.json` raíz del monorepo

- Añadir `apps/web-console` al workspace pnpm (si no está ya declarado en `pnpm-workspace.yaml`).
- Verificar que el script `validate:structure` del raíz no rechace la nueva estructura bajo `apps/web-console/`.

---

## 6. Infraestructura, secretos y configuración

### Secretos

T01 **no requiere ningún secreto nuevo**. El bloque `webConsole.auth.identityClient` del chart se utiliza a partir de T02.

### ConfigMap

El ConfigMap `in-falcone-web-console-config` existe en el chart. T01 no necesita añadir claves, pero puede añadir `APP_VERSION` como referencia informativa:

```yaml

# values.yaml — sin cambios necesarios para T01

# webConsole.image.tag se actualizará con el tag del build de CI

```

### Chart Helm — cambios mínimos en T01

1. `webConsole.image.tag`: actualizar al tag producido por el pipeline (ej. `0.1.0-043`).
2. No se añaden nuevas variables de entorno al Deployment: la versión de build se embebe en el bundle estático vía Vite.
3. `webConsole.service.port: 3000` y `targetPort: 3000` ya configurados; sin cambio.

### Imagen en registry airgap

La imagen debe publicarse en `registry.airgap.in-falcone.local/example/in-falcone-web-console` para entornos sin acceso a internet externo. El pipeline de CI deberá hacer push con el tag adecuado.

---

## 7. Estrategia de pruebas

### 7.1 Pruebas unitarias y de componentes (Vitest + RTL)

**Alcance T01**: todos los componentes y páginas creados en esta tarea.

| Caso | Verifica |
|---|---|
| `WelcomePage` renderiza sin errores | Sin excepciones al montar |
| `WelcomePage` contiene `<h1>` | Estructura semántica (SC-008) |
| `WelcomePage` muestra nombre del producto | Identidad mínima visible |
| `WelcomePage` contiene al menos 1 componente shadcn/ui | Integración sistema de diseño (SC-003) |
| `NotFoundPage` renderiza sin errores | Sin excepciones al montar |
| `NotFoundPage` muestra mensaje de página no encontrada | Estado controlado (SC-004) |
| `NotFoundPage` contiene enlace a `/` | Recuperabilidad de navegación |
| Ruta `/` → `WelcomePage` | Enrutamiento correcto |
| Ruta `/ruta-inexistente` → `NotFoundPage` | Fallback controlado (SC-004) |

**Comando**: `pnpm --filter @in-falcone/web-console test`
**Cobertura**: objetivo mínimo 80% sobre `src/pages/` y `src/router.tsx` antes de merge.

### 7.2 Prueba de typecheck

`pnpm --filter @in-falcone/web-console typecheck`
Sin errores TypeScript antes de merge.

### 7.3 Prueba de build

`pnpm --filter @in-falcone/web-console build`
El comando debe producir `apps/web-console/dist/` con `index.html`, un archivo JS y un archivo CSS como mínimo.

### 7.4 Prueba de contenedor local (smoke)

```bash

docker build -t web-console:local apps/web-console/
docker run --rm -p 3000:3000 web-console:local
curl -s http://localhost:3000/ | grep -i "In Falcone"
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ruta-no-existe

# → 200 (nginx sirve index.html para rutas SPA)

```

### 7.5 Validación de accesibilidad mínima (manual / automatizable)

- Verificar presencia de `<h1>` en el HTML renderizado.
- Verificar presencia de `<main>` como contenedor principal.
- Verificar que el botón/badge de shadcn tiene `role` o semántica correcta.
- Verificar que Tab navega por los elementos interactivos sin trampa.

Esta validación puede formalizarse con `axe-core` vía `@axe-core/react` en el entorno de testing (recomendado, no bloqueante para T01 si se añade en T02).

### 7.6 Pruebas E2E

Las pruebas E2E de login, logout y signup completas son responsabilidad de T06. T01 **no requiere** pruebas E2E. El script `test:e2e:console` en el `package.json` raíz puede quedar como placeholder hasta T06.

---

## 8. Riesgos, compatibilidad y rollback

### Riesgos identificados

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Incompatibilidad de versiones entre shadcn/ui, Radix UI y React 18 | Baja | Alto | Verificar tabla de compatibilidad de shadcn durante el paso de instalación; fijar versiones exactas en `package.json`. |
| Los stubs `.mjs` de OpenWhisk en `src/` rompen la configuración de TypeScript/Vite si no se reubican | Media | Medio | Reubicación a `src/actions/` como primer paso del trabajo; incluir en `tsconfig.json` exclusión de esa carpeta si no son TypeScript. |
| El script `validate:structure` del monorepo rechaza la nueva estructura React bajo `apps/web-console/` | Media | Medio | Revisar `scripts/validate-structure.mjs` antes de hacer push; actualizar reglas si es necesario. |
| El chart Helm no refleja el nuevo tag de imagen | Baja | Medio | El pipeline de CI debe actualizar `webConsole.image.tag`; documentarlo en el pipeline. |
| Tailwind CSS 4 (alpha/beta) no compatible con shadcn/ui durante el periodo de trabajo | Baja | Medio | Fijar `tailwindcss@^3.4.0` en `package.json`; no actualizar a v4 sin validación explícita. |

### Compatibilidad

- La aplicación debe compilar sin warnings de deprecación en Node 22 (runtime actual del monorepo: `node=v22.22.2`).
- Los browsers target (últimas 2 versiones principales de Chrome, Firefox, Edge, Safari desktop) se configuran en `vite.config.ts` → `build.target: ['es2022']` o equivalente mediante `browserslist`.
- El bundle estático es compatible con el nginx ya declarado en el chart.

### Rollback

T01 crea capacidad nueva; no modifica código existente de otros servicios. Rollback = revertir los commits de `apps/web-console/` y actualizar el tag de imagen en el chart a la versión anterior (en T01 no existe versión anterior, por lo que el rollback equivale a deshabilitar `webConsole.enabled: false` en los values del environment).

### Idempotencia

El build de Vite es determinista dado el mismo contenido de fuentes. La imagen Docker producida puede reconstruirse en cualquier momento con los mismos artefactos de salida.

### Observabilidad

- La versión del build es visible en el HTML mediante `<meta name="version">` y en la consola del navegador si se expone como `console.info` en `main.tsx`.
- nginx puede configurarse para registrar accesos; los logs son recogidos por el stack de observabilidad del cluster (Prometheus + Loki si está disponible).
- No se añaden métricas de negocio en T01 (no hay acciones de usuario auditables).

---

## 9. Secuencia de implementación

Las subtareas internas de T01 son independientes entre sí una vez completado el paso 1. Se recomienda la siguiente secuencia:

```text

Paso 1 (bloqueante): Preparar la estructura de carpetas
  └─ Reubicar stubs OpenWhisk a src/actions/
  └─ Inicializar pnpm workspace para apps/web-console
  └─ Verificar validate:structure en raíz

Paso 2 (paralelo A): Configurar herramientas de build
  └─ Escribir package.json con dependencias
  └─ Escribir vite.config.ts
  └─ Escribir tsconfig*.json
  └─ Escribir tailwind.config.ts + postcss.config.ts

Paso 2 (paralelo B): Configurar entorno de testing
  └─ Configurar vitest en vite.config.ts
  └─ Escribir src/test/setup.ts

Paso 3: Instalar y copiar componentes shadcn/ui
  └─ pnpm dlx shadcn@latest init (responder prompts)
  └─ pnpm dlx shadcn@latest add button badge
  └─ Verificar src/components/ui/ y src/lib/utils.ts

Paso 4: Implementar páginas y enrutador
  └─ src/styles/globals.css
  └─ src/pages/WelcomePage.tsx
  └─ src/pages/NotFoundPage.tsx
  └─ src/router.tsx
  └─ src/main.tsx
  └─ index.html

Paso 5: Escribir tests
  └─ src/pages/WelcomePage.test.tsx
  └─ src/pages/NotFoundPage.test.tsx
  └─ src/router.test.tsx

Paso 6: Construir imagen Docker
  └─ nginx.conf
  └─ Dockerfile
  └─ Smoke test local

Paso 7: Integración CI
  └─ Verificar pnpm --filter @in-falcone/web-console build en pipeline
  └─ Verificar pnpm --filter @in-falcone/web-console test en pipeline
  └─ Publicar imagen al registry

Paso 8: Ajuste chart (si aplica)
  └─ Actualizar webConsole.image.tag en values de dev/sandbox

```

### Paralelización posible

- Los pasos 2A y 2B pueden ejecutarse en paralelo.
- El paso 3 puede iniciarse en cuanto el paso 2A produce un `package.json` con dependencias instaladas.
- Los pasos 5 y 6 son independientes entre sí; pueden ejecutarse en paralelo tras el paso 4.

---

## 10. Dependencias

### Dependencias externas a T01

| Dependencia | Estado requerido para T01 | Notas |
|---|---|---|
| US-IAM-03 | **No requerida** en T01 | Keycloak se integra en T02/T05. |
| US-GW-01 | **No requerida** en T01 | APISIX/ingress se necesita para validación en entorno de staging, no para el build ni para la validación local. |
| Registry airgap disponible | Necesaria para despliegue en cluster airgap | En desarrollo local y CI público puede omitirse. |

### Dependencias internas al monorepo

- `scripts/validate-structure.mjs` debe no rechazar la nueva estructura. Revisar antes del primer push.
- Si `pnpm-workspace.yaml` no existe en la raíz, crearlo con `packages: ['apps/*']` o añadir `apps/web-console` a la lista existente.

---

## 11. Criterios de done verificables

| ID | Criterio | Evidencia esperada |
|---|---|---|
| DON-01 | `pnpm --filter @in-falcone/web-console build` finaliza sin errores | Output de CI / terminal: `dist/` contiene `index.html`, `assets/*.js`, `assets/*.css` |
| DON-02 | `pnpm --filter @in-falcone/web-console test` pasa con cobertura ≥ 80% en `src/pages/` y `src/router.tsx` | Reporte Vitest en CI |
| DON-03 | `pnpm --filter @in-falcone/web-console typecheck` sin errores | Output de CI sin líneas de error TypeScript |
| DON-04 | La imagen Docker arranca y responde HTTP 200 en `/` con contenido HTML que incluye el nombre del producto | Smoke test: `curl -s http://localhost:3000/ \| grep -i "In Falcone"` |
| DON-05 | La imagen Docker sirve HTTP 200 (SPA fallback) en `/ruta-inexistente` | Smoke test: `curl -o /dev/null -w "%{http_code}" http://localhost:3000/ruta-no-existe` → `200` |
| DON-06 | La página de bienvenida tiene `<h1>` y `<main>` en el HTML renderizado | Verificación RTL en `WelcomePage.test.tsx` o inspección de `index.html` |
| DON-07 | Al menos 1 componente shadcn/ui está presente y visible en `WelcomePage` | Verificación RTL: el componente renderiza sin errores y contiene markup esperado |
| DON-08 | Un desarrollador puede añadir una nueva ruta en `src/router.tsx` sin modificar `vite.config.ts`, `tailwind.config.ts`, `nginx.conf` ni `Dockerfile` | Verificación por revisión de código de T02 |
| DON-09 | El bundle no contiene secretos ni variables sensibles embebidas | Inspección del `dist/assets/*.js` producido; ausencia de patrones de credenciales |
| DON-10 | `validate:structure` del monorepo sigue pasando tras los cambios | Output de `pnpm validate:structure` en CI sin errores |
| DON-11 | Los stubs OpenWhisk han sido reubicados a `src/actions/` con su `README.md` | Revisión de código: no existen `.mjs` directamente en `src/` |
| DON-12 | PR aprobado y branch mergeado sin conflictos | GitHub: PR con todos los checks en verde y al menos 1 aprobación |

---

## 12. Artefactos de salida esperados

Al finalizar T01, los siguientes artefactos deben existir y estar committed en la rama `043-react-console-foundation`:

```text

apps/web-console/
├── Dockerfile
├── index.html
├── nginx.conf
├── package.json                   ← reescrito con deps React/Vite/Tailwind/shadcn
├── postcss.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
├── vite.config.ts
└── src/
    ├── main.tsx
    ├── router.tsx
    ├── actions/                   ← stubs OpenWhisk reubicados
    │   ├── README.md
    │   └── *.mjs
    ├── components/
    │   └── ui/
    │       ├── button.tsx
    │       └── badge.tsx
    ├── lib/
    │   └── utils.ts
    ├── pages/
    │   ├── WelcomePage.tsx
    │   ├── WelcomePage.test.tsx
    │   ├── NotFoundPage.tsx
    │   └── NotFoundPage.test.tsx
    ├── styles/
    │   └── globals.css
    └── test/
        └── setup.ts

```

**Ningún otro archivo fuera de `apps/web-console/`** debe modificarse para cumplir T01, salvo:
- `pnpm-workspace.yaml` en la raíz si `apps/web-console` no está ya incluido.
- `charts/in-falcone/values/dev.yaml` o `sandbox.yaml` para actualizar `webConsole.image.tag`.
