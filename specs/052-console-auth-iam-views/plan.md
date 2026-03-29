# Plan técnico de implementación — US-UI-02-T04

**Feature Branch**: `052-console-auth-iam-views`
**Task ID**: US-UI-02-T04
**Epic**: EP-14 — Consola de administración: shell, acceso y contexto
**Historia padre**: US-UI-02 — Contexto de tenant/workspace, members y gestión Auth/IAM en consola
**Fecha del plan**: 2026-03-29
**Estado**: Ready for tasks

---

## 1. Objetivo y alcance estricto de T04

Construir, dentro de `apps/web-console/`, una nueva vista protegida de **Auth/IAM** que concentre la inspección operativa del dominio de identidad del tenant/workspace activo sin salir del shell administrativo. La entrega debe cubrir tres superficies:

1. **Resumen del realm de consola** del tenant activo (`consoleUserRealm`) con visibilidad de users, roles, scopes y clients.
2. **Inventario Auth/IAM del realm** mediante tablas read-only de client scopes e IAM clients.
3. **Inventario Auth/IAM del workspace activo** mediante tablas read-only de aplicaciones externas y providers federados OIDC/SAML asociados.

La entrega se mantiene **estrictamente read-only**. No se crean formularios ni mutaciones para users, roles, scopes, clients, providers o aplicaciones externas; esa capacidad queda reservada para `US-UI-02-T05`.

### Delimitación respecto a T03 y T05

- `US-UI-02-T03` ya entregó la vista detallada de users y roles en `/console/members`. T04 **no duplica** esos listados completos; en su lugar, la nueva página Auth/IAM los resume y enlaza a la vista `Members` como drill-down canónico.
- `US-UI-02-T05` añadirá creación/gestión de aplicaciones externas y parámetros de login/logout/providers. T04 sólo expone la **lectura** de ese inventario y su postura operativa.

### Fuera de alcance en T04

- CRUD de users, roles, scopes o clients.
- CRUD de aplicaciones externas o providers federados.
- Invitaciones, memberships o permisos de colaboración (T03).
- E2E de cambio de contexto y administración de members/Auth (T06).
- Cambios en `apps/control-plane/`, family files OpenAPI, base de datos, Helm o infraestructura.

---

## 2. Estado actual relevante del repositorio

### Baseline ya disponible

`US-UI-02-T01` y `US-UI-02-T02` dejaron operativo:

- `ConsoleContextProvider` con `activeTenant`, `activeTenantId`, `activeWorkspace`, `activeWorkspaceId` y persistencia por usuario.
- `consoleUserRealm` expuesto en `activeTenant` desde `console-context.tsx`.
- Shell protegido con selector de tenant/workspace y panel de estado contextual.

`US-UI-02-T03` añadió:

- navegación lateral `Members`
- ruta `/console/members`
- página `ConsoleMembersPage` con carga read-only de users y roles IAM por realm

### Rutas existentes relevantes

- `/console/members` → detalle read-only de users y roles IAM
- `/console/*` bajo `ConsoleShellLayout` ya soporta añadir una nueva entrada de navegación sin rehacer el shell

### Contratos ya disponibles para esta tarea

| Contrato (OpenAPI family) | Operaciones a consumir en T04 |
|---|---|
| `iam.openapi.json` | `GET /v1/iam/realms/{realmId}/users`, `GET /v1/iam/realms/{realmId}/roles`, `GET /v1/iam/realms/{realmId}/scopes`, `GET /v1/iam/realms/{realmId}/clients` |
| `workspaces.openapi.json` | `GET /v1/workspaces/{workspaceId}/applications` |

Los schemas relevantes ya existen en los family files y son consumibles desde la SPA vía `requestConsoleSessionJson()`.

---

## 3. Decisiones técnicas

| Decisión | Elección | Justificación |
|---|---|---|
| Ruta nueva de consola | Añadir `/console/auth` con `ConsoleAuthPage` | Mantiene la semántica del shell y separa identidad/auth del resto de superficies sin reemplazar rutas existentes. |
| Navegación | Nuevo ítem lateral `Auth` entre `Members` y `Functions` | Refleja el backlog y permite entrada directa a la superficie de identidad/aplicaciones. |
| Carga de datos | Llamadas directas desde `ConsoleAuthPage.tsx` usando `requestConsoleSessionJson()` | Mantiene el patrón ya usado en `ConsoleMembersPage`; evita introducir stores o módulos de datos nuevos para una pantalla acotada. |
| Alcance de users/roles | Resumen + enlace a `/console/members`, no duplicar tablas completas | Evita solape con T03 y mantiene la vista Auth/IAM pequeña e incremental. |
| Secciones del realm | `summary cards` + tablas de scopes y clients | Aporta valor operativo directo sin repetir toda la superficie de members. |
| Secciones del workspace | tabla de aplicaciones externas + tabla agregada de providers federados a partir de `federatedProviders` embebidos | Evita llamadas N+1 a `/providers` y mantiene el alcance en una sola colección workspace-scoped. |
| Gestión de estados | Estados separados por sección (`realm`, `applications`) con rendering derivado para providers | Permite degradación parcial si falla una colección sin romper toda la página. |
| Tamaño de página | `page[size]=100` para colecciones IAM y aplicaciones | Sigue el patrón de T03 y evita paginación interactiva en esta entrega. |
| Accesibilidad | Tablas semánticas, badges existentes, botones de retry, enlace claro a `Members` | Alineado con RF-UI-014 y con la implementación actual del shell. |
| Permisos | Confiar en errores `401/403/404` del backend y mostrarlos por sección | No se reimplementa autorización en frontend; la UI sólo refleja el resultado del contrato. |

---

## 4. Arquitectura objetivo

```text
ConsoleContextProvider (existente)
  └─► expone activeTenant.consoleUserRealm y activeWorkspace.workspaceId

ConsoleAuthPage (/console/auth)
  ├─► loadRealmSurface(realmId)
  │     ├─► GET /v1/iam/realms/{realmId}/users?page[size]=100
  │     ├─► GET /v1/iam/realms/{realmId}/roles?page[size]=100
  │     ├─► GET /v1/iam/realms/{realmId}/scopes?page[size]=100
  │     └─► GET /v1/iam/realms/{realmId}/clients?page[size]=100
  │
  ├─► loadWorkspaceApplications(workspaceId)
  │     └─► GET /v1/workspaces/{workspaceId}/applications?page[size]=100
  │
  ├─► render Realm summary
  ├─► render Scopes table
  ├─► render Clients table
  ├─► render External applications table
  └─► render Federated providers table (flatten app.federatedProviders[])
```

### Límites entre componentes

| Componente | Responsabilidad | Fuera de alcance |
|---|---|---|
| `console-context.tsx` | Mantener el contexto activo de tenant/workspace | No necesita cambios para T04 |
| `ConsoleMembersPage.tsx` | Vista detallada de users y roles | No se toca en T04 |
| `ConsoleAuthPage.tsx` | Nueva página de Auth/IAM read-only | No realiza escrituras ni gestión de formularios |
| `ConsoleShellLayout.tsx` | Navegación lateral persistente | Sólo se añade un ítem nuevo |
| `router.tsx` | Registrar la nueva ruta protegida | No se alteran guardas ni layout |

---

## 5. Cambios propuestos por artefacto o carpeta

### 5.1 `apps/web-console/src/pages/ConsoleAuthPage.tsx` (nuevo)

Crear una página única, autocontenida, que cargue y renderice el dominio Auth/IAM.

#### Datos del realm (tenant-scoped)

Usar `activeTenant?.consoleUserRealm` para cargar en paralelo:

- users → sólo para resumen/count y compatibilidad
- roles → sólo para resumen/count y compatibilidad
- scopes → tabla principal
- clients → tabla principal

#### Datos del workspace (workspace-scoped)

Usar `activeWorkspace?.workspaceId` para cargar:

- aplicaciones externas → tabla principal
- providers federados → colección derivada aplanando `application.federatedProviders`

#### Composición visual propuesta

1. **Header de página**
   - badge `Auth / IAM`
   - tenant y workspace activos
   - descripción contextual
   - CTA secundaria a `/console/members`

2. **Resumen del realm**
   - cards: Users, Roles, Scopes, Clients
   - estado de compatibilidad/provider del realm si la colección lo expone
   - hint de realm activo (`consoleUserRealm`)

3. **Client scopes**
   - columnas mínimas: `scopeName`, `protocol`, `isDefault`, `isOptional`, `includeInTokenScope`, `assignedClientIds`

4. **IAM clients**
   - columnas mínimas: `clientId`, `protocol`, `accessType`, `enabled`, `state`, `redirectUris`, `defaultScopes`, `optionalScopes`

5. **Aplicaciones externas**
   - columnas mínimas: `displayName`, `slug`, `protocol`, `state`, `authenticationFlows`, `redirectUris`, `scopes`, `validation`

6. **Providers federados**
   - tabla agregada con columnas: `application`, `alias`, `protocol`, `providerMode`, `enabled`

#### Estados y restricciones

- sin tenant activo → empty state global
- sin `consoleUserRealm` → empty state global del realm
- sin workspace activo → las secciones realm siguen visibles; applications/providers muestran empty state contextual
- errores por sección con `role="alert"` y botón de reintento
- read-only total: no botones de crear/editar/borrar

### 5.2 `apps/web-console/src/router.tsx` (modificar)

- importar `ConsoleAuthPage`
- añadir la ruta hija `{ path: 'auth', element: <ConsoleAuthPage /> }` dentro de `ConsoleShellLayout`

### 5.3 `apps/web-console/src/layouts/ConsoleShellLayout.tsx` (modificar)

- añadir ítem de navegación `Auth` apuntando a `/console/auth`
- descripción alineada con Auth/IAM del tenant/workspace activo
- reutilizar un icono ya disponible en `lucide-react` sin alterar el resto del layout

### 5.4 Tests

| Archivo | Tipo | Qué cubre |
|---|---|---|
| `apps/web-console/src/pages/ConsoleAuthPage.test.tsx` | Integración ligera | estados vacío/carga/error, render de resumen de realm, tablas de scopes/clients/apps/providers, mensaje sin workspace |
| `apps/web-console/src/layouts/ConsoleShellLayout.test.tsx` | Integración ligera | presencia y destino del link `Auth` |
| `apps/web-console/src/router.tsx` | Validación indirecta vía render de ruta | la ruta protegida existe y resuelve la página |

No se necesitan cambios de contrato ni nuevos tests de control-plane.

---

## 6. Modelo de datos y contratos UI

### Tipos del realm usados por la página

- `IamUserCollectionResponse` → `items.length` y `compatibility`
- `IamRoleCollectionResponse` → `items.length` y `compatibility`
- `IamScopeCollectionResponse` → `items[]` para tabla de scopes
- `IamClientCollectionResponse` → `items[]` para tabla de clients

### Tipos del workspace usados por la página

- `ExternalApplicationCollectionResponse` → `items[]` para tabla de apps
- `ExternalApplication.federatedProviders[]` → flatten para tabla de providers

### Normalizaciones mínimas en UI

No hace falta crear un módulo nuevo de normalización. La propia página puede derivar:

- counts del realm (`users.length`, `roles.length`, `scopes.length`, `clients.length`)
- `providerRows = applications.flatMap(...)`
- etiquetas humanas con helpers locales pequeños (`Sí/No`, `Activo/Inactivo`, join de arrays)

---

## 7. Seguridad, aislamiento, compatibilidad y rollback

### Seguridad y permisos

- Todas las llamadas usan la sesión actual (`requestConsoleSessionJson()`), por lo que la autorización real sigue del lado del backend.
- Si una colección devuelve `403`, la UI muestra el error textual en esa sección y no intenta inferir permisos adicionales.
- No se persisten resultados de Auth/IAM fuera del estado React en memoria.

### Aislamiento multi-tenant / multi-workspace

- El realm se resuelve únicamente desde `activeTenant.consoleUserRealm`.
- Las apps se resuelven únicamente desde `activeWorkspace.workspaceId`.
- Al cambiar tenant/workspace, la página resetea estados y descarta resultados obsoletos.

### Compatibilidad

- No cambian contratos públicos ni family files.
- No se toca `ConsoleContextProvider` ni `ConsoleMembersPage`, reduciendo riesgo de regresión sobre T01–T03.
- El diff queda acotado a la SPA de consola y los artefactos Spec Kit del slice `052`.

### Rollback

- Revertir la rama elimina la nueva ruta `auth`, el ítem de navegación y la página, sin side effects en datos persistidos.

---

## 8. Estrategia de pruebas y validación

### 8.1 `ConsoleAuthPage.test.tsx`

Cobertura mínima obligatoria:

1. mensaje cuando no hay tenant activo
2. mensaje cuando el tenant no tiene `consoleUserRealm`
3. render del resumen de realm con counts de users/roles/scopes/clients
4. render de tabla de scopes con flags operativas
5. render de tabla de clients con protocolo/accessType/estado
6. render de tabla de aplicaciones externas cuando hay workspace activo
7. render de tabla de providers federados a partir de `federatedProviders`
8. estado sin workspace activo para la parte de aplicaciones/providers
9. mensaje de error + retry cuando falla una colección

### 8.2 `ConsoleShellLayout.test.tsx`

Cobertura mínima:

1. el ítem `Auth` aparece en el sidebar
2. el link apunta a `/console/auth`

### 8.3 Validaciones del paquete

Ejecutar como mínimo:

```sh
corepack pnpm --filter @in-atelier/web-console test
corepack pnpm --filter @in-atelier/web-console typecheck
corepack pnpm --filter @in-atelier/web-console build
```

Para la entrega end-to-end del stage implement, completar además:

```sh
corepack pnpm lint
corepack pnpm test
```

---

## 9. Riesgos y mitigaciones

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Solape funcional con `Members` | Media | Limitar users/roles a resumen + deep link, dejando el detalle en `/console/members`. |
| Datos parciales entre realm y workspace | Media | Separar estados y errores por sección, con mensajes contextuales. |
| Niveles de permiso distintos por colección | Media | No asumir permisos homogéneos; cada sección maneja su propio error. |
| Aplicaciones sin providers o con protocolo `api_key` | Alta | Flatten defensivo; si no hay providers, mostrar estado vacío en esa subsección. |
| Respuestas obsoletas tras cambio de contexto | Media | Usar flags de cancelación/ignore por efecto y reset de estado al cambiar IDs activos. |

---

## 10. Dependencias previas y secuencia recomendada

### Dependencias confirmadas

- `US-UI-02-T01` ✅ — contexto activo tenant/workspace
- `US-UI-02-T02` ✅ — shell y estado operacional
- `US-UI-02-T03` ✅ — detalle de users/roles en `Members`

### Secuencia recomendada

1. Añadir la ruta `/console/auth` y el ítem `Auth` en el shell.
2. Implementar `ConsoleAuthPage` con el estado global/empty del tenant.
3. Añadir la carga paralela de realm (users/roles/scopes/clients) y render de resumen + tablas IAM.
4. Añadir la carga de aplicaciones externas y flatten de providers para el workspace activo.
5. Completar tests de página y navegación.
6. Ejecutar validaciones del paquete y después el flujo git/PR/CI/merge dentro del mismo stage implement.

---

## 11. Criterios de done verificables

La tarea queda cerrada cuando exista evidencia de que:

1. `/console/auth` existe dentro del shell protegido.
2. La navegación lateral muestra un acceso claro a Auth/IAM.
3. La página resume users/roles/scopes/clients del realm activo.
4. La página muestra tablas read-only de scopes y clients.
5. La página muestra aplicaciones externas del workspace activo.
6. La página muestra providers federados OIDC/SAML asociados a las aplicaciones.
7. Los estados vacío/carga/error están cubiertos por tests automatizados.
8. `corepack pnpm --filter @in-atelier/web-console test`, `typecheck`, `build`, `corepack pnpm lint` y `corepack pnpm test` quedan en verde.
9. La rama `052-console-auth-iam-views` se publica, la PR pasa CI y termina mergeada a `main`.

### Evidencia esperada al terminar

- diff acotado a `apps/web-console/` y `specs/052-console-auth-iam-views/`
- validaciones locales verdes del paquete web-console y del repo
- commit, PR, checks verdes y merge registrados en el flujo
- sin cambios en `apps/control-plane/`, OpenAPI agregada, infraestructura o datos persistidos
