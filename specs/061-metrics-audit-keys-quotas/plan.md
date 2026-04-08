# Plan técnico de implementación — US-UI-04-T01

**Feature Branch**: `061-metrics-audit-keys-quotas`
**Task ID**: US-UI-04-T01
**Epic**: EP-15 — Consola de administración: dominios funcionales
**Historia padre**: US-UI-04 — Métricas, auditoría, API keys, cuotas, wizards, warnings y snippets
**Fecha del plan**: 2026-03-29
**Estado**: Ready for tasks

**Backlog Traceability**: EP-15 / US-UI-04 / RF-UI-021, RF-UI-022, RF-UI-025, RF-UI-026, RF-UI-027, RF-UI-028, RF-UI-029, RF-UI-030
**Dependencias de historia declaradas**: US-OBS-03, US-UI-03

---

## 1. Objetivo y alcance estricto de T01

Construir, dentro de la consola React, las cuatro vistas operativas que completan el gobierno operativo del BaaS multi-tenant:

1. **Dashboard de métricas de consumo** — peticiones API, almacenamiento, funciones, documentos, realtime; filtrable por tenant/workspace y rango temporal (RF-UI-025, RF-UI-026).
2. **Registro de auditoría** — listado paginado y filtrable de eventos, con detalle expandible (RF-UI-021).
3. **Gestión de service accounts y credenciales** — crear, listar, emitir credenciales, revocar y rotar por workspace (RF-UI-022, RF-UI-027, RF-UI-030).
4. **Vista de cuotas** — tabla de límites, consumo actual y porcentaje de uso por tenant/workspace; superadmin puede ajustar (RF-UI-028, RF-UI-029, RF-UI-030).

La entrega queda estrictamente acotada a **frontend en `apps/web-console/`**. No se introducen nuevos endpoints, migraciones de base de datos ni cambios de Helm/Kubernetes. Los contratos ya existen en `metrics.openapi.json` y `workspaces.openapi.json`.

### Fuera de alcance en T01

- Wizards de creación guiada → US-UI-04-T02.
- Warnings, confirmaciones reforzadas y resumen de impacto → US-UI-04-T03.
- Logs y resultados de funciones serverless → US-UI-04-T04.
- Snippets de conexión para apps externas → US-UI-04-T05.
- Pruebas de regresión de UX → US-UI-04-T06.
- Definición de límites o políticas de cuota desde el backend (plataforma).

---

## 2. Estado actual relevante del repositorio

### Baseline ya disponible

Tareas previas del EP-14 / EP-15 dejaron operativos:

| Artefacto | Estado | Relevancia para T01 |
|---|---|---|
| `ConsoleContextProvider` + `useConsoleContext()` | ✅ activo | Proporciona `activeTenantId`, `activeWorkspaceId`, `activeTenant`, `activeWorkspace`, roles del principal. |
| `requestConsoleSessionJson()` | ✅ activo | Función de acceso HTTP autenticado, patrón uniforme para todos los fetch de esta tarea. |
| `ConsoleShellLayout.tsx` | ✅ activo | Shell protegido con selector de contexto. Las nuevas páginas se encajan sin cambios al layout. |
| `router.tsx` — ruta `/console/observability` | ✅ placeholder | Es el único placeholder actualmente vinculado al dominio de esta tarea; se reemplazará por `ConsoleObservabilityPage`. |
| Family file `metrics.openapi.json` | ✅ disponible | Expone todos los endpoints necesarios para métricas, auditoría y cuotas. |
| Family file `workspaces.openapi.json` | ✅ disponible | Expone `createServiceAccount`, `getServiceAccount`, `issueServiceAccountCredential`, `revokeServiceAccountCredential`, `rotateServiceAccountCredential`. |

### Rutas registradas en el router que impacta esta tarea

```text
/console/observability  → actualmente ConsolePlaceholderPage  → se reemplaza con ConsoleObservabilityPage
```

Las rutas `/console/service-accounts` y `/console/quotas` no existen aún en el router; se registran en esta tarea.

### Contratos disponibles (no se modifican)

| Family file | Operaciones a consumir |
|---|---|
| `metrics.openapi.json` | `getTenantQuotaUsageOverview`, `getTenantQuotaPosture`, `getTenantUsageSnapshot`, `listTenantAuditRecords`, `getTenantAuditCorrelation`, `exportTenantAuditRecords`, `getWorkspaceQuotaUsageOverview`, `getWorkspaceQuotaPosture`, `getWorkspaceUsageSnapshot`, `listWorkspaceAuditRecords`, `getWorkspaceAuditCorrelation`, `getWorkspaceMetricSeries` |
| `workspaces.openapi.json` | `createServiceAccount`, `getServiceAccount`, `issueServiceAccountCredential`, `revokeServiceAccountCredential`, `rotateServiceAccountCredential` |

> **Nota sobre API keys directas**: El backend modela las credenciales de acceso programático a través de `ServiceAccount` + `ServiceAccountCredential` (family: `workspaces.openapi.json`). No existe un endpoint `/api-keys` independiente; T01 expone esta superficie como "Credenciales de service account". La terminología en pantalla puede mencionar "API key" cuando haga referencia al token emitido al crear/rotar credenciales.

---

## 3. Decisiones técnicas

| Decisión | Elección | Justificación |
|---|---|---|
| Colocación de la vista de métricas + auditoría | Reemplazar `/console/observability` con `ConsoleObservabilityPage` como contenedor con pestañas (métricas / auditoría) | Agrupa en un solo punto de navegación los dos dominios, igual que otras páginas multi-sección (ej. `ConsolePostgresPage`). |
| Nuevas rutas para service accounts y cuotas | Registrar `/console/service-accounts` y `/console/quotas` como páginas independientes en `router.tsx` | Cada dominio tiene una entidad principal propia y una matriz de permisos diferente; agruparlos reduciría la legibilidad. |
| Acceso a datos | `requestConsoleSessionJson()` desde hooks de página | Sigue el patrón uniforme establecido en T01–T03 de US-UI-02 y US-UI-03. |
| Filtrado por contexto activo | Hooks escuchan `activeTenantId`/`activeWorkspaceId` y relanzar fetch cuando cambian | Coherencia con el selector de contexto, ya validada en otras páginas. |
| Serie temporal de métricas | Usar `getWorkspaceMetricSeries` para la vista por workspace; `getTenantUsageSnapshot` + `getTenantQuotaUsageOverview` para la vista de tenant | Los endpoints ya proveen los datos con la granularidad necesaria para la primera entrega. |
| Visualización de métricas | Barras horizontales simples con `<progress>` accesible o listado de dimensiones con badge numérico | Evita dependencia de una librería de charts completa en esta tarea incremental. Reemplazable en iteraciones posteriores. |
| Listado de service accounts | Llamada individual a `getServiceAccount` por service account id conocido por el contexto; sin endpoint de lista dedicado en el contrato actual | El contrato expone sólo `createServiceAccount` y `getServiceAccount`; la UI parte de `ConsoleContextProvider` para obtener los IDs disponibles, o muestra tabla vacía con formulario de creación hasta que el backend exponga una operación de listado. |
| Credenciales (secreto) | El secreto sólo se muestra en el modal de éxito inmediatamente tras la emisión; no se almacena ni re-expone | Cumple el requisito de seguridad RF-UI-022. |
| Paginación inicial | `page[size]=50` para auditoría y service accounts; sin paginación interactiva en T01 | Simplifica la primera entrega; alcance incremental futuro. |
| Gestión de cuotas (escritura) | Solo superadmin ve el botón de edición de cuota; la mutación se delega al backend (no existe un endpoint PATCH en el contrato actual) | El contrato de `platform.openapi.json` incluye `createQuotaPolicy` pero no un PATCH directo por tenant. T01 expone la UI en modo lectura para todos los roles y reserva el formulario de edición para cuando el contrato lo soporte explícitamente. |
| Confirmaciones de acciones destructivas | No se implementan en T01; se delegan a US-UI-04-T03 | El scope de T01 es la construcción de vistas; T03 añade la capa de protección de acciones destructivas. Las acciones de revocación de credenciales se construyen pero sin el diálogo de confirmación reforzado de T03. |
| Accesibilidad | `<table>` semántica, `aria-busy`, `aria-label`, shadcn/ui para badges y botones | Coherente con el patrón de toda la consola. |

---

## 4. Arquitectura objetivo

```text
ConsoleContextProvider (existente)
  └─► activeTenantId, activeWorkspaceId, activeTenant, activeWorkspace, principal.roles

┌─────────────────────────────────────────────────────────────────┐
│  /console/observability  →  ConsoleObservabilityPage            │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Tab: Métricas (RF-UI-025, RF-UI-026)                   │    │
│  │    ConsoleMetricsDashboard                              │    │
│  │      useConsoleMetrics(tenantId, workspaceId?, range)   │    │
│  │        → GET /v1/metrics/tenants/{id}/overview          │    │
│  │        → GET /v1/metrics/tenants/{id}/usage             │    │
│  │        → GET /v1/metrics/workspaces/{id}/overview       │    │
│  │        → GET /v1/metrics/workspaces/{id}/usage          │    │
│  │        → GET /v1/metrics/workspaces/{id}/series         │    │
│  │      TimeRangeSelector  (24h | 7d | 30d | custom)      │    │
│  │      MetricDimensionList  (dimensión + valor + barra)   │    │
│  │      QuotaPostureAlert  (warning/exceeded badges)       │    │
│  │                                                         │    │
│  │  Tab: Auditoría (RF-UI-021)                             │    │
│  │    ConsoleAuditLog                                      │    │
│  │      useConsoleAuditRecords(tenantId, workspaceId?, f)  │    │
│  │        → GET /v1/metrics/tenants/{id}/audit-records     │    │
│  │        → GET /v1/metrics/workspaces/{id}/audit-records  │    │
│  │      AuditFilterBar  (actor, category, result, dates)   │    │
│  │      AuditRecordTable  (paginada, fila expandible)      │    │
│  │      AuditRecordDetail  (metadata completo al expandir) │    │
│  │      ExportAuditButton  (POST audit-exports)            │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  /console/service-accounts  →  ConsoleServiceAccountsPage       │
│  (RF-UI-022, RF-UI-027, RF-UI-030)                              │
│    useConsoleServiceAccounts(workspaceId)                       │
│      → POST  /v1/workspaces/{id}/service-accounts  (crear)      │
│      → GET   /v1/workspaces/{id}/service-accounts/{saId}        │
│      → POST  /v1/workspaces/{id}/service-accounts/{id}/         │
│              credential-issuance                                 │
│      → POST  /v1/workspaces/{id}/service-accounts/{id}/         │
│              credential-revocations                              │
│      → POST  /v1/workspaces/{id}/service-accounts/{id}/         │
│              credential-rotations                                │
│    ServiceAccountTable  (lista con estado + credenciales)       │
│    CreateServiceAccountForm  (drawer/modal)                     │
│    IssueCredentialDialog  (muestra secreto una única vez)       │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  /console/quotas  →  ConsoleQuotasPage                          │
│  (RF-UI-028, RF-UI-029)                                         │
│    useConsoleQuotas(tenantId, workspaceId?)                     │
│      → GET /v1/metrics/tenants/{id}/quotas  (QuotaPosture)      │
│      → GET /v1/metrics/tenants/{id}/overview                    │
│      → GET /v1/metrics/workspaces/{id}/quotas  (si workspace)   │
│      → GET /v1/metrics/workspaces/{id}/overview                 │
│    QuotaDimensionTable                                          │
│      (dimensión, límite, consumo actual, %, postura visual)     │
│    QuotaPostureSummaryBadge  (within_limit / warning / exceeded)│
└─────────────────────────────────────────────────────────────────┘

Componentes de presentación compartidos nuevos
  ├── ConsoleMetricDimensionRow    → fila de métrica con barra de progreso
  ├── ConsoleQuotaPostureBadge     → badge de postura overall (within_limit / warning / exceeded)
  ├── ConsoleAuditCategoryBadge    → badge de categoría de evento de auditoría
  ├── ConsoleAuditResultBadge      → badge de resultado (success / failure)
  ├── ConsoleCredentialStatusBadge → badge de estado de credencial (active / rotated / revoked)
  └── ConsoleTimeRangeSelector     → selector de rango temporal reutilizable
```

### Límites entre componentes

| Componente | Responsabilidad | Fuera de alcance |
|---|---|---|
| `ConsoleContextProvider` | Estado global de tenant/workspace activos y roles del principal | Datos de métricas, auditoría, service accounts o cuotas |
| `console-metrics.ts` | Hooks y helpers de acceso a endpoints de métricas y auditoría | Render visual |
| `console-service-accounts.ts` | Hooks y funciones de gestión de service accounts y credenciales | Render visual |
| `console-quotas.ts` | Hooks de consulta de cuotas (lectura) | Operaciones de ajuste de cuota (pendiente de contrato backend) |
| `ConsoleObservabilityPage.tsx` | Contenedor de tabs Métricas / Auditoría | Service accounts, cuotas |
| `ConsoleServiceAccountsPage.tsx` | Gestión de service accounts del workspace activo | Métricas, auditoría, cuotas |
| `ConsoleQuotasPage.tsx` | Vista de postura de cuotas del tenant/workspace activo | Escritura de cuotas |
| Componentes de presentación (`/components/console/`) | Elementos visuales reutilizables | Lógica de negocio |
| Family files OpenAPI | Fuente contractual de schemas y enums | No se modifican en T01 |

---

## 5. Cambios propuestos por artefacto o carpeta

### 5.1 `apps/web-console/src/lib/console-metrics.ts` (nuevo)

Hooks y helpers para métricas y auditoría:

```typescript
// Hooks de métricas
export function useConsoleMetrics(
  tenantId: string | null,
  workspaceId: string | null,
  range: ConsoleMetricRange
): { overview: ConsoleMetricsOverview | null; loading: boolean; error: string | null; reload: () => void }

export function useConsoleAuditRecords(
  tenantId: string | null,
  workspaceId: string | null,
  filters: ConsoleAuditFilter
): { records: ConsoleAuditRecord[]; loading: boolean; error: string | null; reload: () => void }

// Función de exportación
export async function exportAuditRecords(
  tenantId: string,
  workspaceId: string | null,
  filters: ConsoleAuditFilter
): Promise<void>

// Tipos normalizados de UI
export type ConsoleMetricRange = '24h' | '7d' | '30d' | 'custom'

export interface ConsoleMetricsOverview {
  generatedAt: string
  overallPosture: 'within_limit' | 'warning_threshold_reached' | 'soft_limit_exceeded' | 'hard_limit_breached' | null
  dimensions: ConsoleMetricDimensionView[]
  hasQuotaWarning: boolean
}

export interface ConsoleMetricDimensionView {
  dimensionId: string
  displayName: string
  measuredValue: number
  hardLimit: number | null
  pctUsed: number | null       // derivado: measuredValue / hardLimit * 100
  policyMode: 'enforced' | 'unbounded'
  freshnessStatus: 'fresh' | 'degraded' | 'unavailable'
}

export interface ConsoleAuditFilter {
  actorId?: string
  category?: string
  result?: 'success' | 'failure'
  from?: string
  to?: string
}

export interface ConsoleAuditRecord {
  eventId: string
  eventTimestamp: string
  correlationId: string | null
  actor: { actorId: string; actorType: string; displayName?: string }
  action: { actionId: string; category: string }
  resource: { resourceId: string; resourceType: string; workspaceId?: string } | null
  result: { outcome: string; failureCode?: string } | null
  origin: { ipAddress?: string; userAgent?: string } | null
}
```

### 5.2 `apps/web-console/src/lib/console-service-accounts.ts` (nuevo)

Hooks y helpers para service accounts y credenciales:

```typescript
export function useConsoleServiceAccount(
  workspaceId: string | null,
  serviceAccountId: string | null
): { account: ConsoleServiceAccount | null; loading: boolean; error: string | null; reload: () => void }

export async function createServiceAccount(
  workspaceId: string,
  payload: ConsoleServiceAccountWriteRequest
): Promise<{ serviceAccountId: string }>

export async function issueServiceAccountCredential(
  workspaceId: string,
  serviceAccountId: string,
  payload: ConsoleCredentialIssuanceRequest
): Promise<ConsoleIssuedCredential>

export async function revokeServiceAccountCredential(
  workspaceId: string,
  serviceAccountId: string,
  payload: ConsoleCredentialRevocationRequest
): Promise<void>

export async function rotateServiceAccountCredential(
  workspaceId: string,
  serviceAccountId: string,
  payload: ConsoleCredentialRotationRequest
): Promise<ConsoleIssuedCredential>

// Tipos normalizados de UI
export interface ConsoleServiceAccount {
  serviceAccountId: string
  displayName: string | null
  entityType: 'service_account'
  desiredState: 'active' | 'suspended' | null
  expiresAt: string | null
  iamBinding: { realm: string; clientId: string; credentialRef: string } | null
  credentialStatus: {
    state: 'active' | 'rotated' | 'revoked' | null
    issuedAt: string | null
    expiresAt: string | null
    lastUsedAt: string | null
  } | null
  accessProjection: {
    effectiveAccess: string
    blockedByTenantSuspension: boolean
    clientState: string
    credentialState: string
  } | null
  credentials: ConsoleCredentialReference[]
}

export interface ConsoleCredentialReference {
  credentialId: string
  issuedAt: string | null
  expiresAt: string | null
  status: 'active' | 'rotated' | 'revoked' | null
}

export interface ConsoleIssuedCredential {
  credentialId: string
  secret: string           // sólo disponible en el momento de emisión
  expiresAt: string | null
}

export interface ConsoleServiceAccountWriteRequest {
  displayName: string
  entityType: 'service_account'
  desiredState?: 'active'
  expiresAt?: string
}

export interface ConsoleCredentialIssuanceRequest {
  requestedByUserId: string
  requestedTtl?: string
  revokeOutstandingCredentials?: boolean
  reason?: string
}

export interface ConsoleCredentialRevocationRequest {
  reason?: string
}

export interface ConsoleCredentialRotationRequest {
  reason?: string
}
```

### 5.3 `apps/web-console/src/lib/console-quotas.ts` (nuevo)

Hooks de consulta de cuotas:

```typescript
export function useConsoleQuotas(
  tenantId: string | null,
  workspaceId: string | null
): { posture: ConsoleQuotaPosture | null; loading: boolean; error: string | null; reload: () => void }

// Tipos normalizados de UI
export interface ConsoleQuotaPosture {
  evaluatedAt: string | null
  generatedAt: string | null
  overallPosture: string | null
  hardLimitDimensions: string[]
  dimensions: ConsoleQuotaDimensionView[]
}

export interface ConsoleQuotaDimensionView {
  dimensionId: string
  displayName: string
  policyMode: 'enforced' | 'unbounded'
  hardLimit: number | null
  softLimit: number | null
  measuredValue: number
  remainingToHardLimit: number | null
  pctUsed: number | null
  freshnessStatus: 'fresh' | 'degraded' | 'unavailable'
  isWarning: boolean       // derivado: pctUsed >= 80
  isExceeded: boolean      // derivado: pctUsed >= 100 o en hardLimitDimensions
}
```

### 5.4 `apps/web-console/src/pages/ConsoleObservabilityPage.tsx` (nuevo)

Vista principal para `/console/observability`, reemplazando el placeholder actual:

- Estructura con dos pestañas: **Métricas** y **Auditoría**.
- **Pestaña Métricas**:
  - `ConsoleTimeRangeSelector` (24h / 7d / 30d / custom) reactivo.
  - `ConsoleMetricsDashboard` con `ConsoleMetricDimensionRow[]` para cada dimensión.
  - `ConsoleQuotaPostureBadge` visible en la cabecera cuando `hasQuotaWarning === true`.
  - Soporte de vista de tenant (cuando sólo hay `activeTenantId`) y vista de workspace (cuando hay `activeWorkspaceId`).
  - Estado de última actualización (`generatedAt` de la respuesta).
  - Mensaje contextual si no hay datos en el periodo seleccionado (no error, sino estado vacío).
- **Pestaña Auditoría**:
  - `ConsoleAuditFilterBar` con filtros por actor, categoría (`AuditRecordAction.category`), resultado y rango de fechas.
  - `ConsoleAuditRecordTable` paginada (50 registros/página en primera entrega).
  - Cada fila expandible que muestra `ConsoleAuditRecordDetail` con todos los metadatos.
  - Botón "Exportar" que dispara `exportAuditRecords` y muestra confirmación de inicio de exportación.
- Ambas pestañas respetan el cambio de `activeTenantId`/`activeWorkspaceId` y relanzan fetch automáticamente.
- Estado de carga, error y vacío con el componente `ConsolePageState` existente (o el que T03 de US-UI-02 haya dejado).

### 5.5 `apps/web-console/src/pages/ConsoleServiceAccountsPage.tsx` (nuevo)

Vista principal para `/console/service-accounts`:

- Header: workspace activo + estado de acceso.
- Tabla `ConsoleServiceAccountTable` con columnas: nombre, estado de cliente, estado de credencial, acceso efectivo, expiración, acciones (emitir credencial / revocar / rotar).
- Formulario `CreateServiceAccountForm` (drawer o modal) con campos: `displayName`, `desiredState`, `expiresAt` opcional.
- `IssueCredentialDialog`: modal que muestra el secreto emitido **una sola vez** con botón de copia y aviso explícito de que no se puede recuperar posteriormente.
- Estados de carga, error y vacío.
- Bloqueado (formulario deshabilitado) si `activeTenant?.state !== 'active'` o si no hay workspace activo.

### 5.6 `apps/web-console/src/pages/ConsoleQuotasPage.tsx` (nuevo)

Vista principal para `/console/quotas`:

- Header: nombre del tenant activo + postura overall con `ConsoleQuotaPostureBadge`.
- Tabla `ConsoleQuotaDimensionTable` con columnas: dimensión, límite, consumo actual, % uso, modo (enforced/unbounded), estado freshness.
- Filas con `isWarning === true` destacadas visualmente (color ámbar / icono de alerta).
- Filas con `isExceeded === true` marcadas con color rojo e icono de bloqueo.
- Sección secundaria de cuotas a nivel de workspace si `activeWorkspaceId` está disponible.
- El superadmin ve un botón de "Ajustar cuota" por dimensión que, en T01, muestra un mensaje informativo de que la edición está disponible desde el panel de plataforma. (Implementación real de edición queda pendiente de confirmar endpoint en el contrato; no se bloquea la entrega de T01).
- Nota de última evaluación (`evaluatedAt`) visible en la cabecera.

### 5.7 Componentes de presentación compartidos (nuevos en `apps/web-console/src/components/console/`)

| Componente | Descripción |
|---|---|
| `ConsoleTimeRangeSelector.tsx` | Selector de rango temporal reutilizable (24h / 7d / 30d / custom). Props: `value`, `onChange`. |
| `ConsoleMetricDimensionRow.tsx` | Fila de una dimensión de métrica con barra de progreso (`<progress>` + texto). Props: `dimension: ConsoleMetricDimensionView`. |
| `ConsoleQuotaPostureBadge.tsx` | Badge de postura global. Props: `posture` nullable. Variantes de color: verde/ámbar/rojo. |
| `ConsoleAuditCategoryBadge.tsx` | Badge para `AuditRecordAction.category` con etiquetas legibles. |
| `ConsoleAuditResultBadge.tsx` | Badge para el resultado de un evento de auditoría (success / failure). |
| `ConsoleAuditRecordDetail.tsx` | Panel expandible con metadatos completos de un `ConsoleAuditRecord`. |
| `ConsoleCredentialStatusBadge.tsx` | Badge de estado de credencial (active / rotated / revoked). |

> Si `ConsolePageState` ya fue introducido por una tarea anterior (US-UI-02-T03), se reutiliza. Si no existe, se crea en esta tarea siguiendo la interfaz definida en el plan de US-UI-02-T03.

### 5.8 `apps/web-console/src/router.tsx` (modificar)

```tsx
// Reemplazar el placeholder de observability
// Antes:
{ path: 'observability', element: <ConsolePlaceholderPage badge="Observability" ... /> }

// Después (lazy):
const ConsoleObservabilityPage = lazy(...)
{ path: 'observability', element: <ConsoleObservabilityPage /> }

// Añadir dos rutas nuevas (lazy):
const ConsoleServiceAccountsPage = lazy(...)
const ConsoleQuotasPage = lazy(...)

{ path: 'service-accounts', element: <ConsoleServiceAccountsPage /> }
{ path: 'quotas', element: <ConsoleQuotasPage /> }
```

El resto de rutas se mantiene sin cambios.

### 5.9 Tests

| Archivo | Tipo | Qué cubre |
|---|---|---|
| `src/lib/console-metrics.test.ts` (nuevo) | Unitario | Normalización de `UsageSnapshot`/`QuotaPosture` → tipos UI, hooks con fetch mock (estados: carga/datos/error), recarga por cambio de tenantId/workspaceId, derivación de `pctUsed` y `hasQuotaWarning`. |
| `src/lib/console-service-accounts.test.ts` (nuevo) | Unitario | Normalización de `ServiceAccount` → `ConsoleServiceAccount`, emisión/revocación/rotación de credenciales, manejo de 202 y errores 4xx. |
| `src/lib/console-quotas.test.ts` (nuevo) | Unitario | Normalización de `QuotaPosture` → `ConsoleQuotaPosture`, derivación de `isWarning`/`isExceeded`, recarga por cambio de contexto. |
| `src/pages/ConsoleObservabilityPage.test.tsx` (nuevo) | Integración ligera | Render con datos de métricas (dimensiones, postura), cambio de rango temporal, render del log de auditoría con filtros, fila expandible, estado de carga/vacío/error, botón de exportación. |
| `src/pages/ConsoleServiceAccountsPage.test.tsx` (nuevo) | Integración ligera | Render con service accounts, creación (formulario visible y envía payload correcto), emisión de credencial (secreto mostrado en modal una sola vez), revocación, bloqueo por tenant inactivo. |
| `src/pages/ConsoleQuotasPage.test.tsx` (nuevo) | Integración ligera | Render con dimensiones dentro de límite, dimensión en warning (color ámbar), dimensión excedida (color rojo), render en modo workspace, carga/vacío/error. |
| `src/components/console/ConsoleTimeRangeSelector.test.tsx` (nuevo) | Unitario | Selección de rango predefinido, variante custom, aria accesible. |
| `src/components/console/ConsoleQuotaPostureBadge.test.tsx` (nuevo) | Unitario | Variantes visuales por postura. |
| `src/router.test.tsx` (modificar) | Unitario/ruta | Verificar que `/console/observability` ya no apunta a placeholder; verificar que `/console/service-accounts` y `/console/quotas` están registradas. |

---

## 6. Modelo de datos, contratos y tipos UI

### 6.1 Schemas clave del contrato `metrics.openapi.json`

```typescript
// QuotaPosture  (GET /v1/metrics/tenants/{id}/quotas)
interface QuotaPosture {
  dimensions: QuotaDimensionPosture[]
  evaluatedAt: string
  degradedDimensions: string[]
  hardLimitBreaches: string[]
  observationWindow: UsageObservationWindow
  evaluationAudit: QuotaEvaluationAudit
}

// QuotaDimensionPosture
interface QuotaDimensionPosture {
  dimensionId: string
  displayName: string
  measuredValue: number
  hardLimit: number | null
  softLimit?: number | null
  remainingToHardLimit: number | null
  policyMode: 'enforced' | 'unbounded'
  freshnessStatus: 'fresh' | 'degraded' | 'unavailable'
}

// TenantQuotaUsageOverview  (GET /v1/metrics/tenants/{id}/overview)
interface TenantQuotaUsageOverview {
  dimensions: QuotaUsageDimensionView[]
  generatedAt: string
  hardLimitDimensions: string[]
  overallPosture: 'within_limit' | 'warning_threshold_reached' | 'soft_limit_exceeded' | 'hard_limit_breached'
  accessAudit: QuotaUsageOverviewAccessAudit
}

// AuditRecord  (listTenantAuditRecords / listWorkspaceAuditRecords)
interface AuditRecord {
  eventId: string
  eventTimestamp: string
  correlationId?: string
  actor: AuditRecordActor
  action: AuditRecordAction
  resource: AuditRecordResource
  result: AuditRecordResult
  origin: AuditRecordOrigin
  scope: AuditRecordScope
}

// AuditRecordAction categories
type AuditRecordCategory =
  | 'resource_creation' | 'resource_deletion' | 'configuration_change'
  | 'access_control_modification' | 'quota_adjustment' | 'privilege_escalation'
  | 'secret_rotation' | 'policy_override' | 'backup_restore' | 'provider_reconciliation'
```

### 6.2 Schemas clave del contrato `workspaces.openapi.json`

```typescript
// ServiceAccount  (getServiceAccount)
interface ServiceAccount {
  serviceAccountId: string
  displayName: string
  entityType: 'service_account'
  expiresAt?: string
  iamBinding: ServiceAccountIamBinding
  credentialStatus: ServiceAccountCredentialStatus
  accessProjection: ServiceAccountAccessProjection
  credentials: ServiceAccountCredentialReference[]
}

// ServiceAccountCredentialIssuanceRequest  (issueServiceAccountCredential)
interface ServiceAccountCredentialIssuanceRequest {
  requestedByUserId: string
  requestedTtl?: string
  revokeOutstandingCredentials?: boolean
  reason?: string
}
```

### 6.3 Eventos de dominio (sólo informativos)

Los eventos de auditoría sobre service accounts y cuotas son generados por el backend y aparecen en `listTenantAuditRecords` bajo las categorías `secret_rotation`, `access_control_modification` y `quota_adjustment`. La UI no produce eventos Kafka directamente.

---

## 7. Seguridad, aislamiento, compatibilidad y rollback

### Seguridad y permisos

- La consola llama las APIs con las credenciales de sesión del usuario autenticado vía `requestConsoleSessionJson()`. El backend aplica las políticas de acceso.
- Los secrets de credenciales se muestran **una sola vez** en el `IssueCredentialDialog` y se borran del estado al cerrar el modal. No se almacenan en `localStorage` ni en ningún estado persistido.
- Si la API devuelve `403`, la UI muestra el estado `error` con mensaje de acceso denegado, no una pantalla vacía.
- Los formularios de creación/emisión de credenciales se deshabilitan si `activeTenant?.state !== 'active'` o si no hay workspace activo.
- Los botones de acción sensibles (revocar, rotar) quedan deshabilitados para usuarios sin permiso; la deshabilitación es de cortesía—el backend siempre es la fuente de verdad de permisos.

### Aislamiento multi-tenant

- Los hooks `useConsoleMetrics`, `useConsoleAuditRecords`, `useConsoleQuotas` y `useConsoleServiceAccount` se resetean con cada cambio de `activeTenantId`/`activeWorkspaceId`.
- Los parámetros de la URL de cada fetch incluyen `tenantId` o `workspaceId` del contexto activo; el backend filtra por éstos independientemente.
- No se mezclan datos de tenants distintos.

### Compatibilidad

- No cambian contratos públicos ni rutas de API.
- Las dos nuevas rutas (`/console/service-accounts`, `/console/quotas`) son aditivas.
- El reemplazo de `/console/observability` no rompe ninguna ruta existente (sólo cambia el componente renderizado).
- T02–T06 pueden seguir sobre la estructura establecida.

### Rollback

- El cambio queda completamente acotado a `apps/web-console/` y `specs/061-metrics-audit-keys-quotas/`.
- Revertir la rama elimina las vistas nuevas y restaura el placeholder de observability, sin afectar datos persistidos.
- No hay side-effects externos al proceso de build del paquete.

---

## 8. Estrategia de pruebas y validación

### 8.1 Unitarias

**`console-metrics.test.ts`**
- Normalización de `TenantQuotaUsageOverview` → `ConsoleMetricsOverview`, incluyendo `pctUsed` derivado.
- Normalización de `AuditRecord` → `ConsoleAuditRecord`.
- Hook `useConsoleMetrics`: estado inicial de carga, transición a datos, transición a error, recarga por cambio de `tenantId` y `workspaceId`.
- Hook `useConsoleAuditRecords`: ídem; filtros aplicados correctamente en la query.
- `exportAuditRecords`: genera el POST correcto y maneja 202 / error.

**`console-service-accounts.test.ts`**
- Normalización de `ServiceAccount` → `ConsoleServiceAccount` (campos opcionales, valores null).
- `createServiceAccount`: payload correcto, retorna `serviceAccountId`.
- `issueServiceAccountCredential`: payload correcto, retorna `ConsoleIssuedCredential` con `secret`.
- `revokeServiceAccountCredential` y `rotateServiceAccountCredential`: llamadas correctas, manejo de 202 y errores 4xx.

**`console-quotas.test.ts`**
- Normalización de `QuotaPosture` → `ConsoleQuotaPosture`, derivación de `isWarning` (pctUsed ≥ 80) y `isExceeded` (pctUsed ≥ 100 o en `hardLimitDimensions`).
- Hook `useConsoleQuotas`: estados de carga/datos/error, recarga por cambio de contexto.

### 8.2 Integración ligera — páginas

**`ConsoleObservabilityPage.test.tsx`**
- Render con datos de métricas: dimensiones visibles, postura overall mostrada, marca de última actualización.
- Cambio de rango temporal: se dispara nuevo fetch con parámetro correcto.
- Render con métricas vacías: mensaje contextual, no error.
- Pestaña Auditoría: tabla de registros visible, filtros aplicables, fila expandible muestra detalle.
- Botón exportar: dispara POST y muestra mensaje de confirmación.
- Estado de carga y estado de error en ambas pestañas.

**`ConsoleServiceAccountsPage.test.tsx`**
- Render sin workspace activo: mensaje de "selecciona un workspace".
- Render con service account existente: tabla con nombre, estado, credenciales.
- Formulario de creación: envía payload correcto, recarga la lista tras respuesta.
- Emisión de credencial: modal abre con el secreto visible, botón de copia presente, secreto no accesible tras cerrar.
- Revocación: se llama al endpoint correcto.
- Bloqueo con tenant inactivo: formularios deshabilitados con aviso contextual.

**`ConsoleQuotasPage.test.tsx`**
- Render con dimensiones dentro de límite: color normal, sin iconos de alerta.
- Dimensión en warning (pctUsed ≥ 80): fila con clase/color ámbar y badge de alerta.
- Dimensión excedida: fila con clase/color rojo y badge de bloqueo.
- Vista en contexto de workspace: sección adicional de cuotas de workspace.
- Estado de carga y error.

### 8.3 Router

**`router.test.tsx`** (modificar):
- Verificar que `/console/observability` no apunta a `ConsolePlaceholderPage`.
- Verificar que `/console/service-accounts` está registrada.
- Verificar que `/console/quotas` está registrada.

### 8.4 Validaciones operativas del paquete

```sh
corepack pnpm --filter @in-falcone/web-console test
corepack pnpm --filter @in-falcone/web-console typecheck
corepack pnpm --filter @in-falcone/web-console build
```

### 8.5 Validaciones finales del flujo de implementación

- Commit en `061-metrics-audit-keys-quotas`.
- Push de la rama y PR contra `main`.
- Seguimiento del CI; correcciones si aparecen regresiones.
- Merge cuando los checks queden en verde.

---

## 9. Riesgos y mitigaciones

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| **Sin endpoint de listado de service accounts** — El contrato expone `createServiceAccount` y `getServiceAccount` (por id) pero no `listServiceAccounts`. La UI no puede enumerar todos los service accounts del workspace sin conocer los IDs de antemano. | Alta | En T01 la tabla parte vacía con formulario de creación. Al crear un service account, la UI registra el id localmente en `sessionStorage` hasta que el backend exponga un endpoint de lista. Se documenta la limitación con un comentario claro en el hook. |
| **Latencia en métricas (hasta 5 min)** — Los datos pueden estar desactualizados. | Baja (comportamiento documentado) | La UI muestra `generatedAt` / `evaluatedAt` junto a un indicador de frescura (`freshnessStatus`). |
| **Secreto de credencial expuesto en estado React** — Si el componente se desmonta sin que el usuario copie el secreto, se pierde. | Media | El modal bloquea la interacción hasta que el usuario confirma "he copiado el secreto" o lo cierra activamente. El estado con el secreto se limpia al desmontar el componente. |
| **`overallPosture` del contrato puede retornar valores no tipados** — El enum podría crecer en el backend. | Baja | El badge de postura tiene un caso `default` defensivo que muestra el valor en bruto si no coincide con ninguna variante conocida. |
| **Backend 202 Accepted para mutations de service account** — No hay confirmación inmediata de que el service account quedó activo. | Baja (comportamiento conocido) | Mostrar mensaje "procesando" y recargar la ficha del service account con pequeño delay (500ms). |
| **Ausencia de `ConsolePageState`** — Si la tarea US-UI-02-T03 no se completó, el componente no existe. | Baja | Verificar en el repo antes de comenzar la implementación. Si no existe, crear el componente en esta tarea siguiendo la interfaz especificada en el plan de US-UI-02-T03. |
| **Edición de cuotas sin endpoint confirmado** — El plan reserva la funcionalidad para cuando el contrato la soporte. | Media | T01 implementa la vista en modo lectura; el botón de superadmin muestra mensaje informativo. No se bloquea la entrega. |

---

## 10. Dependencias previas y secuencia de implementación

### Dependencias confirmadas

- `US-UI-03` (US-UI-02-T01/T02/T03 de EP-14) — `ConsoleContextProvider`, `requestConsoleSessionJson()`, shell y bases del sistema de diseño de la consola.
- `US-OBS-03` — Los endpoints `metrics.openapi.json` deben estar accesibles en el entorno de desarrollo para validar la integración. Si no están disponibles, la UI puede probarse con mocks del hook.
- Family files `metrics.openapi.json` y `workspaces.openapi.json` — Ya presentes y estables (no se modifican).

### Paralelización posible

- Los tres módulos de hooks (`console-metrics.ts`, `console-service-accounts.ts`, `console-quotas.ts`) pueden desarrollarse en paralelo una vez fijados los contratos de hooks.
- Los componentes de presentación compartidos pueden desarrollarse en paralelo con las páginas.
- Los tests de hooks se desarrollan en paralelo con los hooks.

### Secuencia recomendada

1. Verificar existencia de `ConsolePageState` en el repo; crearlo si no existe.
2. Implementar los tres módulos de hooks con tipos normalizados:
   - `console-metrics.ts` (métricas + auditoría)
   - `console-service-accounts.ts` (service accounts + credenciales)
   - `console-quotas.ts` (cuotas)
3. Implementar componentes de presentación compartidos (badges, `ConsoleTimeRangeSelector`, `ConsoleMetricDimensionRow`, `ConsoleAuditRecordDetail`).
4. Implementar `ConsoleObservabilityPage` (Tab Métricas + Tab Auditoría).
5. Implementar `ConsoleServiceAccountsPage` con `IssueCredentialDialog`.
6. Implementar `ConsoleQuotasPage`.
7. Actualizar `router.tsx` (reemplazar placeholder de observability, añadir service-accounts y quotas).
8. Completar tests de hooks, páginas, componentes y router.
9. Ejecutar validaciones del paquete (`test`, `typecheck`, `build`).
10. Commit, PR, CI, merge.

---

## 11. Criterios de done verificables

La tarea quedará cerrada cuando exista evidencia de que:

1. La ruta `/console/observability` muestra `ConsoleObservabilityPage` con las pestañas **Métricas** y **Auditoría**, no un placeholder.
2. La pestaña Métricas muestra dimensiones de consumo reales con porcentajes de uso y postura overall para el tenant y workspace activos.
3. El selector de rango temporal (24h / 7d / 30d) actualiza los datos mostrados.
4. La pestaña Auditoría muestra un listado de eventos paginado con filtros funcionales (actor, categoría, resultado, rango de fechas).
5. Cada fila de auditoría es expandible y muestra metadatos completos del evento.
6. La ruta `/console/service-accounts` muestra la tabla de service accounts del workspace activo.
7. Desde `/console/service-accounts` es posible crear un service account y emitir una credencial; el secreto se muestra una única vez en el modal de confirmación.
8. Las operaciones de revocación y rotación de credenciales están disponibles y llaman al endpoint correcto.
9. La ruta `/console/quotas` muestra la tabla de cuotas del tenant con límites, consumo actual y porcentaje de uso.
10. Las cuotas con ≥ 80 % de uso se destacan visualmente (ámbar); las cuotas al 100 % se marcan como bloqueadas (rojo).
11. Los estados de carga, vacío y error son visibles y accesibles en las tres páginas.
12. Cambiar de tenant/workspace en el selector recarga el contenido de las páginas activas.
13. `corepack pnpm --filter @in-falcone/web-console test`, `typecheck` y `build` quedan en verde.
14. La rama `061-metrics-audit-keys-quotas` se publica, la PR se valida en CI y termina mergeada a `main`.

### Evidencia esperada al terminar

- Diff acotado a `apps/web-console/` y `specs/061-metrics-audit-keys-quotas/`.
- Salida verde de validaciones del paquete `web-console`.
- Commit, PR, checks verdes y merge registrados en el flujo.
- No hay cambios en `apps/control-plane/`, family files OpenAPI, Helm charts ni configuración de infraestructura.

---

## 12. Complejidad justificada

| Elección | Por qué es necesaria | Alternativa rechazada |
|---|---|---|
| Tres páginas separadas (observability, service-accounts, quotas) en lugar de una mega-página | Cada página tiene entidades principales distintas, permisos distintos y navegación independiente. | Una sola página con todas las secciones haría el archivo inmanejable y dificultaría el code-splitting. |
| Tabs dentro de ConsoleObservabilityPage para métricas y auditoría | Métricas y auditoría comparten el mismo dominio de observabilidad y contexto de navegación; separarlos en rutas distintas fragmentaría la UX. | Rutas `/console/metrics` y `/console/audit` separadas añadirían dos puntos de navegación adicionales sin ganancia funcional en esta entrega. |
| Secreto de credencial gestionado con estado local efímero y limpiado al desmontar | Requisito de seguridad: el secreto no puede persistir en memoria más allá del momento de uso. | Usar un store global (Zustand, Context) para el secreto crearía riesgo de persistencia accidental entre sesiones o recargas. |
| Listado de service accounts con limitación documentada | La ausencia de un endpoint de lista no bloquea el valor de la entrega. | Esperar a que el backend exponga el endpoint antes de construir la UI retraería la entrega sin necesidad. |
