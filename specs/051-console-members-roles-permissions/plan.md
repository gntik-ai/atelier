# Plan técnico de implementación — US-UI-02-T03

**Feature Branch**: `051-console-members-roles-permissions`
**Task ID**: US-UI-02-T03
**Epic**: EP-14 — Consola de administración: shell, acceso y contexto
**Historia padre**: US-UI-02 — Contexto de tenant/workspace, members y gestión Auth/IAM en consola
**Fecha del plan**: 2026-03-29
**Estado**: Ready for tasks

---

## 1. Objetivo y alcance estricto de T03

Construir, dentro de la consola React, las vistas operativas de **members, invitaciones, roles y permisos** para el contexto multi-tenant. A partir de las bases establecidas en T01 (selector de tenant/workspace) y T02 (indicadores de estado), esta tarea extiende el shell con páginas reales que permiten al administrador:

- visualizar y gestionar los **miembros del tenant** y su rol asignado,
- gestionar los **miembros del workspace** activo y su rol de workspace,
- emitir y revocar **invitaciones** de tenant (targetType `tenant`) con estado de ciclo de vida visible,
- visualizar los **roles de tenant** (`TenantRole`) y de workspace (`WorkspaceRole`) disponibles en la plataforma,
- visualizar el **estado de sincronización de permisos** de cada membership (`roleMappingStatus`).

La entrega queda estrictamente acotada a **frontend en `apps/web-console/`**. No se introducen nuevos endpoints, migraciones de base de datos ni cambios de Helm/Kubernetes. El backend ya expone todos los contratos necesarios en `tenants.openapi.json` y `workspaces.openapi.json`.

### Fuera de alcance en T03

- Construcción de vistas de Auth/IAM (users, roles Keycloak, scopes, clients, providers OIDC/SAML) → T04.
- Creación de aplicaciones externas vinculadas al workspace → T05.
- Pruebas E2E de cambio de contexto y administración de miembros → T06.
- Formularios de edición compleja de membership (cambio de rol in-place masivo).
- Gestión de ownership transfers.
- Acceso a dashboard de gobernanza de permisos avanzado.

---

## 2. Estado actual relevante del repositorio

### Baseline ya disponible

`US-UI-02-T01` dejó operativos:

- `ConsoleContextProvider` y `useConsoleContext()` en `apps/web-console/src/lib/console-context.tsx`
- `activeTenant`, `activeTenantId`, `activeWorkspace`, `activeWorkspaceId` reactivos con persistencia por usuario.
- `operationalAlerts[]` derivados del estado del contexto activo.
- Shell protegido con selección de tenant/workspace en `ConsoleShellLayout.tsx`.

`US-UI-02-T02` añadió:

- Indicadores de estado del tenant y workspace en el shell (`ConsoleContextStatusPanel`).
- Banners de degradación en páginas protegidas.
- Resumen de cuotas e inventario en `ConsolePlaceholderPage`.

### Rutas existentes en el router

El router ya registra `/console/tenants` y `/console/workspaces` como `ConsolePlaceholderPage`. T03 reemplazará esos placeholders con páginas reales específicas.

### Contratos ya disponibles para esta tarea

| Contrato (OpenAPI family) | Operaciones a consumir en T03 |
|---|---|
| `tenants.openapi.json` | `listTenants` (colección de tenants), `getTenant` (detalle del tenant activo), `getTenantMembership`, `createTenantMembership`, `createInvitation`, `getInvitation`, `acceptInvitation`, `revokeInvitation` |
| `workspaces.openapi.json` | `listWorkspaces`, `getWorkspaceMembership`, `createWorkspaceMembership` |
| `iam.openapi.json` | `listIamRoles` (roles del realm asociado al tenant para UI informativa) |

Los schemas clave para T03 ya se encuentran en los family files y son consumibles mediante `requestConsoleSessionJson()` del módulo `console-session.ts`.

---

## 3. Decisiones técnicas

| Decisión | Elección | Justificación |
|---|---|---|
| Colocación de las nuevas páginas | Reemplazar los `ConsolePlaceholderPage` de `/console/tenants` y `/console/workspaces` en `router.tsx` con componentes dedicados | Aprovecha el shell ya existente sin añadir rutas nuevas no previstas en EP-14. |
| Acceso a datos de members e invitaciones | Llamadas directas a las APIs de tenant/workspace desde los nuevos componentes de página, reutilizando `requestConsoleSessionJson()` | Mantiene el patrón establecido en T01/T02; no requiere store global nuevo para datos de listas que son específicos de página. |
| Carga por contexto activo | Cada página escucha `activeTenantId`/`activeWorkspaceId` del provider y relanza el fetch cuando cambia | Garantiza coherencia entre el selector de contexto y el contenido de la página. |
| Estado local de las páginas | Custom hooks `useTenantMembers`, `useWorkspaceMembers` y `useTenantInvitations` por página, en `src/lib/` | Separa la lógica de carga del render y facilita los tests unitarios. |
| Escrituras optimistas | No se usan; todas las mutaciones son asíncronas con `202 Accepted` según el contrato | El contrato de las mutations devuelve `MutationAccepted` y el backend procesa en background; la UI recarga el listado tras la aceptación del 202. |
| Presentación de roles | `TenantRole` y `WorkspaceRole` son enums del contrato; se presentan con `formatConsoleEnumLabel()` ya existente | No requiere una capa de configuración nueva para describir roles. |
| Paginación | `page[size]=50` en la primera implementación; no se construye paginación interactiva en T03 | Simplifica la primera entrega; la paginación real es alcance incremental de tareas posteriores. |
| Accesibilidad de tablas | Usar `<table>` semántica con `<thead>` y `<caption>` para las listas de members e invitaciones | Cumple con los requisitos de accesibilidad (RF-UI-014) y es coherente con shadcn/ui. |
| Estados vacíos / carga / error | Componente reutilizable `ConsolePageState` para los tres estados por consistencia con el shell | Homogeneiza la experiencia y facilita los tests de presentación. |
| Mutaciones que requieren confirmación | Modal de confirmación con `AlertDialog` de shadcn/ui para revocación de invitaciones y suspensión de membership | Evita acciones destructivas accidentales; `AlertDialog` ya está disponible en shadcn. |

---

## 4. Arquitectura objetivo

```text
ConsoleContextProvider (ya existente)
  └─► expone activeTenantId, activeWorkspaceId, activeTenant, activeWorkspace

Nuevas páginas de consola (routes)
  ├─► ConsoleTenantMembersPage  (/console/tenants)
  │     ├─► useTenantMembers(tenantId)
  │     │     └─► GET /v1/tenants/{tenantId}/memberships/{id}  ← sólo GET individual disponible
  │     │         (listado de memberships desde GET /v1/tenants: items[].membership si aplica)
  │     ├─► useTenantInvitations(tenantId)
  │     │     └─► GET /v1/tenants/{tenantId}/invitations/{invitationId}  (detail)
  │     ├─► InviteMemberForm  → POST /v1/tenants/{tenantId}/invitations
  │     ├─► RevokeInvitationDialog  → POST /v1/tenants/{tenantId}/invitations/{id}/revocation
  │     └─► TenantMembersTable / TenantInvitationsTable
  │
  └─► ConsoleWorkspaceMembersPage  (/console/workspaces)
        ├─► useWorkspaceMembers(workspaceId)
        │     └─► GET /v1/workspaces/{workspaceId}/memberships/{id}
        ├─► AddWorkspaceMemberForm  → POST /v1/workspaces/{workspaceId}/memberships
        └─► WorkspaceMembersTable

Hooks de datos  (src/lib/console-members.ts)
  ├─► useTenantMembers(tenantId)    ← carga TenantMembershipRecord[]
  ├─► useTenantInvitations(tenantId) ← carga Invitation[] (individual por ahora)
  └─► useWorkspaceMembers(workspaceId) ← carga WorkspaceMembershipRecord[]

Contratos de escritura
  ├─► POST /v1/tenants/{tenantId}/invitations    ← InvitationWriteRequest
  ├─► POST /v1/tenants/{tenantId}/invitations/{id}/revocation  ← InvitationRevocationRequest
  └─► POST /v1/workspaces/{workspaceId}/memberships ← WorkspaceMembershipRecordWriteRequest

Componentes compartidos  (src/components/console/)
  ├─► ConsolePageState   (empty | loading | error)
  ├─► ConsoleMembershipStatusBadge (MembershipStatus → badge visual)
  ├─► ConsoleRoleBadge  (TenantRole | WorkspaceRole → badge visual)
  └─► ConsoleRoleMappingBadge (RoleMappingStatus → badge visual)
```

### Límites entre componentes

| Componente | Responsabilidad | Fuera de alcance |
|---|---|---|
| `console-context.tsx` | Estado global de tenant/workspace activos | Listados de members e invitaciones (son datos de página, no de contexto global) |
| `console-members.ts` | Hooks y funciones de acceso a datos de members e invitaciones vía API | Render visual |
| `ConsoleTenantMembersPage.tsx` | Vista de members e invitaciones del tenant activo | Gestión de Auth/IAM (T04) |
| `ConsoleWorkspaceMembersPage.tsx` | Vista de members del workspace activo | Gestión de roles Keycloak, OIDC/SAML (T04) |
| Componentes de consola (`/components/console/`) | Elementos de presentación reutilizables (badges, estados de página) | Lógica de negocio |
| Family files OpenAPI | Fuente contractual de schemas y enums | No se modifican en T03 |

---

## 5. Cambios propuestos por artefacto o carpeta

### 5.1 `apps/web-console/src/lib/console-members.ts` (nuevo)

Módulo con hooks y helpers para members e invitaciones:

- `useTenantMembers(tenantId: string | null)` → `{ records: TenantMembershipRecord[]; loading; error; reload }`
- `useTenantInvitations(tenantId: string | null)` → `{ invitations: Invitation[]; loading; error; reload }`
- `useWorkspaceMembers(workspaceId: string | null)` → `{ records: WorkspaceMembershipRecord[]; loading; error; reload }`
- `createTenantInvitation(tenantId: string, payload: ConsoleTenantInvitationRequest): Promise<void>`
- `revokeTenantInvitation(tenantId: string, invitationId: string, payload: ConsoleInvitationRevocationRequest): Promise<void>`
- `createWorkspaceMembership(workspaceId: string, payload: ConsoleWorkspaceMembershipRequest): Promise<void>`
- Tipos internos normalizados para la UI: `ConsoleTenantMemberRecord`, `ConsoleTenantInvitationRecord`, `ConsoleWorkspaceMemberRecord`

**Nota sobre el listado de memberships**: La API actual expone `GET /v1/tenants/{tenantId}/memberships/{id}` (recurso individual) y `POST /v1/tenants/{tenantId}/memberships` (creación), sin un endpoint de lista. Para obtener el listado inicial se hará uso de `GET /v1/tenants` / `GET /v1/tenants/{tenantId}` que incluye `inventorySummary`, o bien se mostrará la tabla vacía hasta que el usuario cree memberships con la UI. Si el backend incorpora `listTenantMemberships` en el futuro, el hook se actualiza sin cambiar la API de la página.

### 5.2 `apps/web-console/src/pages/ConsoleTenantMembersPage.tsx` (nuevo)

Vista principal para `/console/tenants`:

- Header: nombre del tenant activo + estado (reutilizando `getConsoleTenantStatusMeta`).
- Sección **Miembros del tenant**: tabla de `TenantMembershipRecord` con columnas de usuario (principalBindings.subject), rol (`TenantRole`), estado de membership (`MembershipStatus`), estado de sincronización (`roleMappingStatus`) y roles efectivos.
- Sección **Invitaciones pendientes**: tabla de `Invitation` con columnas de email enmascarado (`maskedEmail`), rol, target type, estado (`InvitationStatus`), expiración y acciones (revocar).
- Formulario rápido **Invitar miembro** (inline o drawer): campos `emailHash`, `maskedEmail`, `role` (select con `TenantRole`), `targetType` (`tenant`/`workspace`), expiración opcional.
- Confirmación de revocación via `AlertDialog`.
- Estados de carga, error y vacío con `ConsolePageState`.
- Degradación visible si `activeTenant` no está `active` (reutiliza `operationalAlerts` del contexto + banner específico bloqueando el formulario de invitación).

### 5.3 `apps/web-console/src/pages/ConsoleWorkspaceMembersPage.tsx` (nuevo)

Vista principal para `/console/workspaces`:

- Header: nombre del workspace activo + estado y entorno.
- Sección **Miembros del workspace**: tabla de `WorkspaceMembershipRecord` con columnas de usuario, rol (`WorkspaceRole`), estado de membership, estado de sincronización y roles efectivos.
- Formulario rápido **Añadir miembro al workspace**: campos `principalBindings` (iamUserId o subject), `role` (select con `WorkspaceRole`).
- Estados de carga, error y vacío.
- Bloqueado si no hay workspace activo seleccionado.

### 5.4 `apps/web-console/src/components/console/ConsolePageState.tsx` (nuevo)

Componente reutilizable para los tres estados típicos de una página de datos:

```tsx
type ConsolePageStateVariant = 'loading' | 'empty' | 'error'

interface ConsolePageStateProps {
  variant: ConsolePageStateVariant
  title?: string
  description?: string
  onRetry?: () => void
}
```

- `loading`: skeleton de filas + aria-busy + texto accesible.
- `empty`: ilustración/icono vacío + texto descriptivo contextual.
- `error`: mensaje de error + botón "Reintentar" si se proporciona `onRetry`.

### 5.5 `apps/web-console/src/components/console/ConsoleMembershipStatusBadge.tsx` (nuevo)

Badge visual para `MembershipStatus` (`pending_activation`, `active`, `suspended`, `revoked`) con color semántico coherente con los tonos ya usados en T02.

### 5.6 `apps/web-console/src/components/console/ConsoleRoleBadge.tsx` (nuevo)

Badge visual para `TenantRole` y `WorkspaceRole`. Aplica `formatConsoleEnumLabel()` y añade variantes visuales por tipo de rol (owner, admin, developer, viewer, auditor).

### 5.7 `apps/web-console/src/components/console/ConsoleRoleMappingBadge.tsx` (nuevo)

Badge visual para `RoleMappingStatus` (`pending_sync`, `synced`, `degraded`) con indicador de color apropiado.

### 5.8 `apps/web-console/src/router.tsx` (modificar)

Reemplazar los dos `ConsolePlaceholderPage` de `tenants` y `workspaces`:

```tsx
// Antes
{ path: 'tenants', element: <ConsolePlaceholderPage badge="Tenants" ... /> }
{ path: 'workspaces', element: <ConsolePlaceholderPage badge="Workspaces" ... /> }

// Después
{ path: 'tenants', element: <ConsoleTenantMembersPage /> }
{ path: 'workspaces', element: <ConsoleWorkspaceMembersPage /> }
```

Mantener el resto de rutas sin cambios.

### 5.9 Tests

| Archivo | Tipo | Qué cubre |
|---|---|---|
| `src/lib/console-members.test.ts` (nuevo) | Unitario | normalización de memberships, hooks con fetch mock, derivación de estado |
| `src/pages/ConsoleTenantMembersPage.test.tsx` (nuevo) | Integración ligera | render con datos, estado vacío, estado de error, revocación de invitación con confirmación, bloqueo por tenant inactivo |
| `src/pages/ConsoleWorkspaceMembersPage.test.tsx` (nuevo) | Integración ligera | render con datos, estado sin workspace activo, creación de membership |
| `src/components/console/ConsolePageState.test.tsx` (nuevo) | Unitario | variantes loading/empty/error, accesibilidad aria |
| `src/router.test.tsx` (modificar) | Unitario/ruta | comprobar que `tenants` y `workspaces` ya no apuntan a placeholder |

---

## 6. Modelo de datos, contratos y tipos UI

### 6.1 Tipos del dominio del contrato (inferidos de los family files)

```typescript
// TenantRole (enum del contrato)
type TenantRole = 'tenant_owner' | 'tenant_admin' | 'tenant_developer' | 'tenant_viewer'

// WorkspaceRole (enum del contrato)
type WorkspaceRole =
  | 'workspace_admin' | 'workspace_developer' | 'workspace_operator'
  | 'workspace_auditor' | 'workspace_viewer' | 'workspace_owner'
  | 'workspace_service_account'

// MembershipStatus (enum del contrato)
type MembershipStatus = 'pending_activation' | 'active' | 'suspended' | 'revoked'

// RoleMappingStatus (enum del contrato)
type RoleMappingStatus = 'pending_sync' | 'synced' | 'degraded'

// InvitationStatus (enum del contrato)
type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired'
```

### 6.2 Tipos normalizados de UI (en `console-members.ts`)

```typescript
export interface ConsoleTenantMemberRecord {
  membershipId: string
  subject: string | null          // principalBindings.subject
  iamUserId: string | null        // principalBindings.iamUserId
  role: TenantRole | null
  effectiveRoles: TenantRole[]
  membershipStatus: MembershipStatus | null
  roleMappingStatus: RoleMappingStatus | null
  invitationId: string | null
  grantedByUserId: string | null
}

export interface ConsoleTenantInvitationRecord {
  invitationId: string
  maskedEmail: string | null
  role: TenantRole | null
  targetType: 'tenant' | 'workspace' | null
  invitationStatus: InvitationStatus | null
  expiresAt: string | null
  issuedByUserId: string | null
  acceptedByUserId: string | null
  acceptedAt: string | null
}

export interface ConsoleWorkspaceMemberRecord {
  membershipId: string
  subject: string | null
  iamUserId: string | null
  role: WorkspaceRole | null
  effectiveRoles: WorkspaceRole[]
  membershipStatus: MembershipStatus | null
  roleMappingStatus: RoleMappingStatus | null
  invitationId: string | null
}
```

### 6.3 Payloads de escritura (en `console-members.ts`)

```typescript
export interface ConsoleTenantInvitationRequest {
  emailHash: string
  maskedEmail?: string
  role: TenantRole
  targetType: 'tenant' | 'workspace'
  expiresAt?: string
}

export interface ConsoleInvitationRevocationRequest {
  reason?: string
}

export interface ConsoleWorkspaceMembershipRequest {
  iamUserId: string
  role: WorkspaceRole
}
```

### 6.4 Eventos relevantes (solo informativos, no generados en frontend)

Los eventos de dominio ya están registrados en el contrato del backend (`iam.invitation.created`, `iam.invitation.accepted`, `iam.invitation.revoked`). La UI no produce eventos Kafka directamente; son generados por el backend al aceptar las mutations.

---

## 7. Seguridad, aislamiento, compatibilidad y rollback

### Seguridad y permisos

- La consola sólo llama APIs con las credenciales de sesión del usuario autenticado (token Keycloak vía `console-session.ts`). El backend filtra las respuestas según los permisos del principal.
- Si la API devuelve `403` en algún listado (usuario sin permiso para ver members del tenant), la UI muestra el estado `error` con mensaje descriptivo en lugar de un error crudo.
- El formulario de invitación y el botón de revocación quedan deshabilitados si `activeTenant?.state !== 'active'` o si `activeTenant?.governanceStatus` indica restricción, previniendo intentos que el backend rechazaría.
- No se almacenan datos de membership en `localStorage` ni fuera de la memoria de sesión del navegador.
- El campo `emailHash` de la invitación es un hash del email del invitado; la consola no tiene acceso al email en claro.

### Aislamiento multi-tenant

- Los hooks `useTenantMembers` y `useTenantInvitations` se reinician con cada cambio de `activeTenantId`, garantizando que nunca se mezclen datos de tenants distintos.
- Idéntico comportamiento para `useWorkspaceMembers` con `activeWorkspaceId`.

### Compatibilidad

- No cambian contratos públicos ni rutas de API.
- El reemplazo de los dos `ConsolePlaceholderPage` no rompe ninguna ruta existente (sólo cambia el componente renderizado).
- T04–T06 pueden seguir sobre la estructura establecida sin rehacer el contexto ni el shell.
- No hay migraciones, DDL, seeds ni cambios de Helm/Kubernetes.

### Rollback

- El cambio queda completamente acotado a `apps/web-console/` y `specs/051-console-members-roles-permissions/`.
- Revertir la rama elimina las vistas de members y restaura los placeholders sin afectar datos persistidos.
- No hay side-effects externos al proceso de build del paquete.

---

## 8. Estrategia de pruebas y validación

### 8.1 Unitarias — `console-members.test.ts`

- Normalización de `TenantMembershipRecord` → `ConsoleTenantMemberRecord` (campos opcionales, valores null).
- Normalización de `Invitation` → `ConsoleTenantInvitationRecord`.
- Normalización de `WorkspaceMembershipRecord` → `ConsoleWorkspaceMemberRecord`.
- Hook `useTenantMembers`: estado inicial de carga, transición a datos, transición a error, recarga por cambio de `tenantId`.
- Hook `useTenantInvitations`: idem.
- Hook `useWorkspaceMembers`: idem.
- `createTenantInvitation`: llamada correcta al endpoint, manejo de 202 y de error 4xx.
- `revokeTenantInvitation`: llamada correcta, confirmación de revocación.

### 8.2 Integración ligera — páginas

**`ConsoleTenantMembersPage.test.tsx`**

- Render con datos de members e invitaciones: tablas visibles, badges correctos.
- Estado de carga: skeleton visible y aria-busy.
- Estado vacío: mensaje de "sin miembros" y "sin invitaciones pendientes".
- Estado de error: mensaje de error y botón de reintentar.
- Formulario de invitación: envía payload correcto, recarga la lista tras 202, muestra error de API.
- Revocación: diálogo de confirmación aparece, se cancela sin efecto, se confirma y relanza la carga.
- Con tenant suspendido (alert de contexto activo): formulario de invitación deshabilitado con aviso.

**`ConsoleWorkspaceMembersPage.test.tsx`**

- Render sin workspace activo: mensaje de "selecciona un workspace".
- Render con datos: tabla de members, badges de rol y estado.
- Formulario de añadir miembro: payload correcto, reload tras 202.

**`ConsolePageState.test.tsx`**

- Variante `loading`: aria-busy, texto de carga visible.
- Variante `empty`: texto descriptivo visible, sin botón.
- Variante `error`: mensaje de error, botón reintentar si `onRetry` proporcionado.

### 8.3 Router

**`router.test.tsx`** (modificar):

- Verificar que la ruta `/console/tenants` renderiza `ConsoleTenantMembersPage`.
- Verificar que la ruta `/console/workspaces` renderiza `ConsoleWorkspaceMembersPage`.

### 8.4 Validaciones operativas del paquete

Ejecutar al menos:

```sh
corepack pnpm --filter @in-falcone/web-console test
corepack pnpm --filter @in-falcone/web-console typecheck
corepack pnpm --filter @in-falcone/web-console build
```

### 8.5 Validaciones finales del flujo implement

Antes de cerrar la unidad, el implement stage también debe completar:

- commit en `051-console-members-roles-permissions`
- push de la rama
- PR contra `main`
- seguimiento del CI
- fixes si aparecen regresiones
- merge cuando los checks queden en verde

---

## 9. Riesgos y mitigaciones

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| **Ausencia de endpoint de listado de memberships** — La API actual sólo expone `GET` individual para memberships de tenant y workspace, no un listado paginado. | Media-alta | La UI arranca con tabla vacía y permite crear nuevas memberships. Cuando el backend exponga `listTenantMemberships`, se actualiza el hook sin cambiar la página. Documentar la limitación en comentarios del código. |
| **Datos de email enmascarado inconsistentes** — `maskedEmail` es opcional en el contrato; algunos registros de invitación pueden no tenerlo. | Media | La UI muestra `emailHash` truncado si `maskedEmail` no está disponible. |
| **Backend procesa mutations en background (202 Accepted)** — No hay confirmación inmediata de que la membership/invitación quedó activa. | Baja (comportamiento conocido) | Mostrar mensaje "procesando" tras el 202 y recargar la lista con un pequeño delay (500ms). Documentar el comportamiento asíncrono en la UI con texto informativo. |
| **Permisos insuficientes para algunas operaciones** — Un `tenant_viewer` puede ver la pantalla pero no poder crear invitaciones. | Media | Botones de acción deshabilitados con `title` accesible si la API devuelve 403 en el intent. Capturar el 403 en el handler de error del formulario. |
| **RoleMappingStatus `degraded`** — Indica que Keycloak no sincronizó el rol. Visible en la tabla pero no accionable en T03. | Baja | Mostrar badge informativo. No añadir acción de re-sincronización (es alcance de T04 o de operaciones internas). |

---

## 10. Dependencias previas y secuencia de implementación

### Dependencias confirmadas

- `US-UI-02-T01` ✅ — `ConsoleContextProvider` con selección de tenant/workspace.
- `US-UI-02-T02` ✅ — Indicadores de estado y banners de degradación en el shell.
- `US-IAM-02` — El backend de Keycloak debe estar disponible para que las mutations de membership sincronicen roles. Si no está disponible, las vistas son de solo lectura sin afectar la entrega de T03.
- `US-TEN-03` — Los tenants y workspaces deben existir y ser accesibles por la API. Ya cumplen T01 en baseline.

### Paralelización posible

Los hooks de datos (`console-members.ts`), los componentes compartidos (`ConsolePageState`, badges) y las dos páginas pueden desarrollarse en paralelo por un mismo implementor una vez definido el contrato de hooks. Los tests se escriben en paralelo con la implementación de los componentes correspondientes.

### Secuencia recomendada

1. Crear `console-members.ts` con tipos normalizados y skeletons de hooks (mocks para tests).
2. Implementar `ConsolePageState`, `ConsoleMembershipStatusBadge`, `ConsoleRoleBadge` y `ConsoleRoleMappingBadge`.
3. Implementar `ConsoleTenantMembersPage` con integración del hook y formulario de invitación.
4. Implementar `ConsoleWorkspaceMembersPage` con integración del hook y formulario de membership.
5. Actualizar `router.tsx` para reemplazar los dos placeholders.
6. Completar tests de hooks, páginas y componentes compartidos.
7. Ejecutar validaciones del paquete (`test`, `typecheck`, `build`).
8. Completar git/PR/CI/merge dentro del mismo stage de implementación.

---

## 11. Criterios de done verificables

La tarea quedará cerrada cuando exista evidencia de que:

1. La ruta `/console/tenants` muestra una página real de members e invitaciones del tenant activo, no un placeholder.
2. La ruta `/console/workspaces` muestra una página real de members del workspace activo, no un placeholder.
3. Ambas páginas muestran los badges de rol (`TenantRole` / `WorkspaceRole`), estado de membership y estado de sincronización de permisos.
4. La página de tenants permite crear invitaciones (formulario visible y funcional) y revocarlas (con confirmación modal).
5. La página de workspaces permite añadir memberships al workspace activo.
6. Los formularios de acción quedan deshabilitados cuando el tenant activo no está en estado `active`.
7. Los estados de carga, vacío y error son visibles y accesibles (aria adecuado) en ambas páginas.
8. Cambiar de tenant/workspace en el selector recarga automáticamente el contenido de la página activa.
9. `corepack pnpm --filter @in-falcone/web-console test`, `typecheck` y `build` quedan en verde.
10. La rama `051-console-members-roles-permissions` se publica, la PR se valida en CI y termina mergeada a `main`.

### Evidencia esperada al terminar

- diff acotado a `apps/web-console/` y `specs/051-console-members-roles-permissions/`
- salida verde de validaciones del paquete web-console
- commit, PR, checks verdes y merge registrados en el flujo
- no hay cambios en `apps/control-plane/`, family files OpenAPI, Helm charts ni configuración de infraestructura
