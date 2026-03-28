# Tareas de implementación — US-UI-01-T01

**Feature Branch**: `043-react-console-foundation`
**Task ID**: US-UI-01-T01
**Epic**: EP-14 — Consola de administración: shell, acceso y contexto
**Historia padre**: US-UI-01 — Shell de consola: stack React/Tailwind/shadcn, login y navegación base
**Fecha**: 2026-03-28
**Estado**: Ready for implementation

---

## Archivos que la implementación tocará

> Mapa de lectura para el agente de implementación. Solo estos archivos son relevantes para T01.

```text

apps/web-console/
├── package.json                          ← REESCRIBIR completo
├── index.html                            ← CREAR
├── vite.config.ts                        ← CREAR
├── tsconfig.json                         ← CREAR
├── tsconfig.app.json                     ← CREAR
├── tsconfig.node.json                    ← CREAR
├── tailwind.config.ts                    ← CREAR
├── postcss.config.ts                     ← CREAR
├── nginx.conf                            ← CREAR
├── Dockerfile                            ← CREAR
└── src/
    ├── main.tsx                          ← CREAR
    ├── router.tsx                        ← CREAR
    ├── styles/
    │   └── globals.css                   ← CREAR
    ├── lib/
    │   └── utils.ts                      ← CREAR (shadcn cn helper)
    ├── components/
    │   └── ui/
    │       ├── button.tsx                ← CREAR (shadcn copiado)
    │       └── badge.tsx                 ← CREAR (shadcn copiado)
    ├── pages/
    │   ├── WelcomePage.tsx               ← CREAR
    │   ├── WelcomePage.test.tsx          ← CREAR
    │   ├── NotFoundPage.tsx              ← CREAR
    │   └── NotFoundPage.test.tsx         ← CREAR
    ├── test/
    │   └── setup.ts                      ← CREAR
    └── actions/                          ← CREAR carpeta (mover stubs)
        ├── README.md                     ← CREAR
        ├── observability-audit-correlation.mjs   ← MOVER desde src/
        ├── observability-audit-export.mjs        ← MOVER desde src/
        ├── observability-audit.mjs               ← MOVER desde src/
        ├── observability-quota-usage.mjs         ← MOVER desde src/
        ├── postgres-admin.mjs                    ← MOVER desde src/
        ├── public-api-catalog.mjs                ← MOVER desde src/
        ├── tenant-management.mjs                 ← MOVER desde src/
        └── workspace-management.mjs              ← MOVER desde src/

# Archivos fuera de apps/web-console/ que pueden requerir ajuste:

pnpm-workspace.yaml                       ← VERIFICAR / añadir apps/web-console si falta

```

---

## Fase 1 — Preparación de la estructura (bloqueante)

### T01-P1-01 · Reubicar stubs OpenWhisk a `src/actions/`

Mover todos los archivos `.mjs` que actualmente están en `apps/web-console/src/` a la nueva carpeta `apps/web-console/src/actions/`. Esto libera `src/` para la estructura React y desambigua la naturaleza de esos archivos.

**Archivos a mover:**
- `apps/web-console/src/observability-audit-correlation.mjs` → `apps/web-console/src/actions/`
- `apps/web-console/src/observability-audit-export.mjs` → `apps/web-console/src/actions/`
- `apps/web-console/src/observability-audit.mjs` → `apps/web-console/src/actions/`
- `apps/web-console/src/observability-quota-usage.mjs` → `apps/web-console/src/actions/`
- `apps/web-console/src/postgres-admin.mjs` → `apps/web-console/src/actions/`
- `apps/web-console/src/public-api-catalog.mjs` → `apps/web-console/src/actions/`
- `apps/web-console/src/tenant-management.mjs` → `apps/web-console/src/actions/`
- `apps/web-console/src/workspace-management.mjs` → `apps/web-console/src/actions/`

**Archivo a crear:** `apps/web-console/src/actions/README.md`
Contenido: explicación de que estos archivos son lógica de servidor/OpenWhisk para acciones de backend futuras, no son código de la SPA React y no deben importarse desde componentes.

---

### T01-P1-02 · Verificar `pnpm-workspace.yaml` en la raíz del monorepo

Comprobar si `pnpm-workspace.yaml` en la raíz del repositorio ya incluye `apps/*` o `apps/web-console` en su lista de `packages`. Si no lo incluye, añadirlo.

**Archivo a verificar/modificar:** `pnpm-workspace.yaml` (raíz del monorepo)

---

### T01-P1-03 · Verificar `scripts/validate-structure.mjs`

Revisar el contenido del script `scripts/validate-structure.mjs` (raíz del monorepo) para confirmar que las reglas de validación no rechazarán la nueva estructura de `apps/web-console/` (presencia de `vite.config.ts`, `tsconfig*.json`, `index.html`, `Dockerfile`, etc.). Ajustar las reglas si es necesario.

**Archivo a verificar/ajustar:** `scripts/validate-structure.mjs`

---

## Fase 2 — Configuración del stack de build

### T01-P2-01 · Reescribir `apps/web-console/package.json`

Reemplazar el `package.json` placeholder actual por uno completo que declare:

- `name`: `@in-atelier/web-console`
- `type`: `module`
- Dependencias de producción: `react@^18.3.0`, `react-dom@^18.3.0`, `react-router-dom@^6.24.0`, `class-variance-authority@^0.7.0`, `clsx@^2.1.1`, `tailwind-merge@^2.4.0`, `lucide-react@^0.400.0`, `@radix-ui/react-slot@^1.1.0`
- Dependencias de desarrollo: `vite@^5.3.0`, `@vitejs/plugin-react@^4.3.0`, `typescript@^5.5.0`, `@types/react@^18.3.0`, `@types/react-dom@^18.3.0`, `tailwindcss@^3.4.0`, `autoprefixer@^10.4.0`, `postcss@^8.4.0`, `vitest@^1.6.0`, `@vitest/coverage-v8@^1.6.0`, `@testing-library/react@^16.0.0`, `@testing-library/jest-dom@^6.4.0`, `@testing-library/user-event@^14.5.0`, `jsdom@^24.0.0`
- Scripts: `dev` → `vite`; `build` → `tsc -b && vite build`; `preview` → `vite preview`; `test` → `vitest run`; `test:watch` → `vitest`; `test:coverage` → `vitest run --coverage`; `typecheck` → `tsc --noEmit`

**Archivo:** `apps/web-console/package.json`

---

### T01-P2-02 · Crear `apps/web-console/vite.config.ts`

Configuración Vite que incluya:
- Plugin `@vitejs/plugin-react`
- Alias `@` resuelto a `./src`
- `define` para inyectar `__APP_VERSION__` desde `process.env.VITE_APP_VERSION ?? 'dev'`
- `build.outDir`: `dist`
- Bloque `test` para Vitest: environment `jsdom`, `setupFiles: ['./src/test/setup.ts']`, `coverage.provider: 'v8'`

**Archivo:** `apps/web-console/vite.config.ts`

---

### T01-P2-03 · Crear archivos de configuración TypeScript

Crear los tres archivos de configuración TypeScript con sus referencias cruzadas:

- **`apps/web-console/tsconfig.json`**: referencias a `tsconfig.app.json` y `tsconfig.node.json`
- **`apps/web-console/tsconfig.app.json`**: target `ES2022`, lib `['ES2022', 'DOM', 'DOM.Iterable']`, module `ESNext`, `moduleResolution: bundler`, `jsx: react-jsx`, paths `{ "@/*": ["./src/*"] }`, include `['src']`, excluir `src/actions`
- **`apps/web-console/tsconfig.node.json`**: para archivos de configuración como `vite.config.ts`, include `['vite.config.ts', 'tailwind.config.ts', 'postcss.config.ts']`

---

### T01-P2-04 · Crear `apps/web-console/tailwind.config.ts`

Configuración de Tailwind CSS que incluya:
- `content`: `['./index.html', './src/**/*.{ts,tsx}']` (excluye `src/actions`)
- `darkMode`: `'class'`
- `theme.extend.colors`: variables CSS del tema shadcn/ui mapeadas a `hsl(var(--...))` para todos los tokens de color base (background, foreground, primary, primary-foreground, secondary, secondary-foreground, muted, muted-foreground, accent, accent-foreground, destructive, destructive-foreground, border, input, ring, card, card-foreground, popover, popover-foreground)
- `theme.extend.borderRadius`: mapeado a `var(--radius)`

**Archivo:** `apps/web-console/tailwind.config.ts`

---

### T01-P2-05 · Crear `apps/web-console/postcss.config.ts`

Configuración PostCSS con plugins `tailwindcss` y `autoprefixer`.

**Archivo:** `apps/web-console/postcss.config.ts`

---

## Fase 3 — Estilos base y helpers

### T01-P3-01 · Crear `apps/web-console/src/styles/globals.css`

Archivo CSS global que incluya:
- Directivas `@tailwind base`, `@tailwind components`, `@tailwind utilities`
- Variables CSS del tema shadcn/ui en `:root` (modo claro) y `.dark` (modo oscuro): tokens de color en formato HSL sin la función `hsl()` (para compatibilidad con Tailwind), radio de borde `--radius`

**Archivo:** `apps/web-console/src/styles/globals.css`

---

### T01-P3-02 · Crear `apps/web-console/src/lib/utils.ts`

Helper `cn()` de shadcn/ui que combina `clsx` y `tailwind-merge`.

```typescript

// apps/web-console/src/lib/utils.ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

```

**Archivo:** `apps/web-console/src/lib/utils.ts`

---

### T01-P3-03 · Copiar componentes shadcn/ui: `button.tsx` y `badge.tsx`

Copiar los dos componentes shadcn/ui mínimos necesarios para T01 en `apps/web-console/src/components/ui/`. Estos archivos siguen la convención shadcn de copiarse al repositorio (no se instalan como dependencia opaca):

- **`apps/web-console/src/components/ui/button.tsx`**: componente `Button` con variantes (`default`, `destructive`, `outline`, `secondary`, `ghost`, `link`) y tamaños (`default`, `sm`, `lg`, `icon`) usando `class-variance-authority`, `@radix-ui/react-slot` y el helper `cn()`
- **`apps/web-console/src/components/ui/badge.tsx`**: componente `Badge` con variantes (`default`, `secondary`, `destructive`, `outline`) usando `class-variance-authority` y `cn()`

---

## Fase 4 — Implementación de páginas y enrutador

### T01-P4-01 · Crear `apps/web-console/index.html`

Entry point HTML de Vite que incluya:
- `<meta charset="UTF-8">` y `<meta name="viewport">`
- `<meta name="application-name" content="In Atelier Console">`
- `<meta name="version" content="%VITE_APP_VERSION%">` (Vite lo sustituye en build)
- `<title>In Atelier Console</title>`
- `<link rel="stylesheet" href="/src/styles/globals.css">` (Vite procesa en dev; en build se incluye en el bundle)
- `<div id="root"></div>`
- `<script type="module" src="/src/main.tsx"></script>`
- `<noscript>` con mensaje indicando que se requiere JavaScript

**Archivo:** `apps/web-console/index.html`

---

### T01-P4-02 · Crear `apps/web-console/src/pages/WelcomePage.tsx`

Componente funcional React para la ruta `/` que:
- Usa estructura semántica: `<main>`, `<h1>`
- Muestra el nombre del producto: "In Atelier Console"
- Muestra un mensaje de contexto: "Consola administrativa del producto BaaS multi-tenant"
- Incluye al menos un componente shadcn/ui visible (`<Badge>` o `<Button>` con rol decorativo)
- No realiza llamadas a APIs externas
- Aplica clases Tailwind CSS para layout centrado y tipografía legible

**Archivo:** `apps/web-console/src/pages/WelcomePage.tsx`

---

### T01-P4-03 · Crear `apps/web-console/src/pages/NotFoundPage.tsx`

Componente funcional React para la ruta catch-all `*` que:
- Muestra un título "Página no encontrada"
- Incluye un enlace de vuelta a `/` usando `<Link>` de React Router
- Es navegable por teclado
- Aplica clases Tailwind CSS básicas

**Archivo:** `apps/web-console/src/pages/NotFoundPage.tsx`

---

### T01-P4-04 · Crear `apps/web-console/src/router.tsx`

Enrutador con `createBrowserRouter` de React Router v6 que declare:
- Ruta `"/"` → elemento `<WelcomePage />`
- Ruta `"*"` → elemento `<NotFoundPage />`

Exportar el router como export por defecto. Comentar explícitamente que las rutas de layout anidado (shell, login, dashboard) se añadirán en T04/T05.

**Archivo:** `apps/web-console/src/router.tsx`

---

### T01-P4-05 · Crear `apps/web-console/src/main.tsx`

Entry point React que:
- Importa `globals.css` para activar Tailwind
- Usa `ReactDOM.createRoot(document.getElementById('root')!)` con `<RouterProvider router={router} />`
- Envuelve en `<React.StrictMode>`
- Opcionalmente emite `console.info('In Atelier Console', __APP_VERSION__)` para trazabilidad de versión en DevTools

**Archivo:** `apps/web-console/src/main.tsx`

---

## Fase 5 — Tests

### T01-P5-01 · Crear `apps/web-console/src/test/setup.ts`

Archivo de setup de Vitest que extiende los matchers de jest-dom:

```typescript

// apps/web-console/src/test/setup.ts
import '@testing-library/jest-dom'

```

**Archivo:** `apps/web-console/src/test/setup.ts`

---

### T01-P5-02 · Crear `apps/web-console/src/pages/WelcomePage.test.tsx`

Tests unitarios de componente para `WelcomePage.tsx`:

| Caso de test | Qué verifica |
|---|---|
| Renderiza sin errores | No lanza excepciones al montar |
| Contiene un `<h1>` | Estructura semántica (SC-008) |
| El `<h1>` contiene el nombre del producto | Identidad mínima visible |
| Muestra el mensaje de contexto | Texto de contexto administrativo presente |
| Contiene al menos un componente shadcn/ui | Integración sistema de diseño (SC-003) |

**Archivo:** `apps/web-console/src/pages/WelcomePage.test.tsx`

Dependencias que el test debe importar/mockear: ninguna (WelcomePage no consume APIs).
Envolver el render con `<MemoryRouter>` si WelcomePage usa `<Link>` internamente.

---

### T01-P5-03 · Crear `apps/web-console/src/pages/NotFoundPage.test.tsx`

Tests unitarios de componente para `NotFoundPage.tsx`:

| Caso de test | Qué verifica |
|---|---|
| Renderiza sin errores | No lanza excepciones al montar |
| Muestra texto de página no encontrada | Estado controlado visible (SC-004) |
| Contiene enlace a `/` | Recuperabilidad de navegación |
| El enlace a `/` es accesible | `role="link"` o elemento `<a>` con `href="/"` |

**Archivo:** `apps/web-console/src/pages/NotFoundPage.test.tsx`

Envolver el render con `<MemoryRouter>` para que `<Link>` funcione en el entorno de test.

---

## Fase 6 — Contenedor Docker

### T01-P6-01 · Crear `apps/web-console/nginx.conf`

Configuración nginx para servir la SPA:
- `listen 3000`
- `root /usr/share/nginx/html`
- `index index.html`
- `try_files $uri $uri/ /index.html` (crítico para el routing del lado del cliente)
- `gzip on` para tipos `text/html text/css application/javascript application/json`
- Cache `no-store` para `index.html`; cache de larga duración (`max-age=31536000, immutable`) para assets con hash en el nombre (`/assets/`)
- Sin cabeceras CSP ni HSTS (delegadas a APISIX / US-GW-01)

**Archivo:** `apps/web-console/nginx.conf`

---

### T01-P6-02 · Crear `apps/web-console/Dockerfile`

Build multi-stage:

**Stage 1 (builder):** `node:22-alpine`
- `WORKDIR /app`
- Copia `package.json` y el lockfile del workspace
- `RUN corepack enable && pnpm install --frozen-lockfile`
- Copia el resto del código fuente
- `ARG VITE_APP_VERSION=dev` + `ENV VITE_APP_VERSION=$VITE_APP_VERSION`
- `RUN pnpm build`

**Stage 2 (runtime):** `nginx:1.25-alpine`
- `COPY --from=builder /app/dist /usr/share/nginx/html`
- `COPY nginx.conf /etc/nginx/conf.d/default.conf`
- `EXPOSE 3000`
- `CMD ["nginx", "-g", "daemon off;"]`

**Archivo:** `apps/web-console/Dockerfile`

---

## Criterios de done verificables

| ID | Criterio | Comando de verificación |
|---|---|---|
| DON-01 | Build sin errores y `dist/` contiene `index.html`, `assets/*.js`, `assets/*.css` | `pnpm --filter @in-atelier/web-console build` |
| DON-02 | Tests pasan con cobertura ≥ 80% en `src/pages/` | `pnpm --filter @in-atelier/web-console test:coverage` |
| DON-03 | Sin errores TypeScript | `pnpm --filter @in-atelier/web-console typecheck` |
| DON-04 | Imagen arranca y responde HTTP 200 con nombre del producto | `docker build -t web-console:local apps/web-console/ && docker run --rm -p 3000:3000 web-console:local` → `curl -s http://localhost:3000/ \| grep -i "In Atelier"` |
| DON-05 | nginx sirve SPA fallback (HTTP 200) en rutas inexistentes | `curl -o /dev/null -w "%{http_code}" http://localhost:3000/ruta-no-existe` → `200` |
| DON-06 | WelcomePage tiene `<h1>` y `<main>` | Verificación RTL en `WelcomePage.test.tsx` |
| DON-07 | Al menos 1 componente shadcn/ui en WelcomePage | Verificación RTL en `WelcomePage.test.tsx` |
| DON-08 | No existen `.mjs` directamente bajo `src/` | `ls apps/web-console/src/*.mjs` → vacío |
| DON-09 | `validate:structure` del monorepo sigue pasando | `pnpm validate:structure` desde la raíz |
| DON-10 | `pnpm-workspace.yaml` incluye `apps/web-console` o `apps/*` | Inspección del archivo |

---

## Notas para el agente de implementación

- **No implementar** en esta fase: login, signup, sidebar, rutas protegidas, integración Keycloak.
- Los componentes shadcn/ui (`button.tsx`, `badge.tsx`) deben copiarse manualmente siguiendo el patrón de shadcn, o generarse con `pnpm dlx shadcn@latest add button badge` dentro de `apps/web-console/`. Si se usa el CLI de shadcn, verificar que el `components.json` generado es coherente con las rutas de este proyecto.
- La carpeta `src/actions/` y los `.mjs` que contiene no deben aparecer en los `include` de `tsconfig.app.json` ni en el `content` de `tailwind.config.ts`.
- El `router.tsx` usa `createBrowserRouter` (no `<BrowserRouter>`); el `RouterProvider` se monta en `main.tsx`.
- Fijar `tailwindcss@^3.4.0`; no actualizar a v4 sin validación explícita de compatibilidad con shadcn/ui.
