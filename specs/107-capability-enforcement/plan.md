# Plan de Implementación: US-PLAN-02-T05 — Enforcement de Capabilities en Gateway, UI y Control Plane

**Branch**: `107-capability-enforcement` | **Fecha**: 2026-03-31 | **Spec**: `specs/107-capability-enforcement/spec.md`\
**Input**: Especificación de feature US-PLAN-02-T05 | **Tamaño**: M | **Prioridad**: P0

## Resumen ejecutivo

Implementar el enforcement activo de capabilities booleanas en los tres puntos de control del producto BaaS multi-tenant: API Gateway (APISIX), Control Plane (endpoint de capabilities efectivas) y Consola Web (React). Cuando un tenant intenta acceder a una funcionalidad no incluida en su plan (o bloqueada por override), el sistema la rechaza en el gateway, la oculta/deshabilita en la consola, y genera un evento de auditoría trazable.

## Contexto técnico

- **Lenguaje/Versión**: Node.js 20+ ESM (backend), TypeScript + React (consola), Lua (plugins APISIX)
- **Dependencias principales**: Apache APISIX (gateway), Keycloak (IAM), PostgreSQL (datos de planes), Kafka (eventos), OpenWhisk (backend de consola)
- **Testing**: `node:test` nativo, Vitest (consola), contract tests OpenAPI
- **Plataforma destino**: Kubernetes / OpenShift vía Helm
- **Tipo de proyecto**: Monorepo BaaS multi-tenant (`in-falcone`)
- **Restricciones de rendimiento**: La resolución de capabilities en gateway no debe añadir más de 5 ms p99 al path crítico del request
- **Constraints**: Aislamiento multi-tenant estricto, deny-by-default, auditabilidad completa

## Verificación de constitución

- **Separación monorepo**: PASS — Plugin Lua en `services/gateway-config/plugins/`, acciones OpenWhisk en `services/provisioning-orchestrator/src/actions/`, consola en `apps/web-console/src/`
- **Entrega incremental**: PASS — Se extienden componentes existentes (`scope-enforcement.lua`, `plan-effective-entitlements-get.mjs`, `console-context.tsx`) sin crear servicios nuevos
- **Compatibilidad K8s/OpenShift**: PASS — Configuración externalizable vía ConfigMap/Helm values
- **Quality gates en raíz**: PASS — Validable con scripts de validación existentes del monorepo
- **Documentación como parte del cambio**: PASS — Spec, plan, contratos y data model incluidos

## Estructura del proyecto

### Documentación (esta feature)

```text
specs/107-capability-enforcement/
├── spec.md
├── plan.md
├── data-model.md
└── contracts/
    └── capability-enforcement-errors.openapi.md
```

### Código fuente (raíz del repositorio)

```text
services/gateway-config/
├── plugins/
│   ├── scope-enforcement.lua          # MODIFICAR — añadir evaluación de capabilities
│   └── capability-enforcement.lua     # NUEVO — plugin dedicado de enforcement
├── routes/
│   └── capability-gated-routes.yaml   # NUEVO — mapa de rutas a capabilities
└── tests/
    └── capability-enforcement.test.mjs # NUEVO

services/provisioning-orchestrator/
├── src/
│   ├── actions/
│   │   └── tenant-effective-capabilities-get.mjs  # NUEVO — endpoint público
│   ├── models/
│   │   └── boolean-capability.mjs     # EXISTENTE — ya tiene buildCapabilityProfile
│   └── repositories/
│       └── effective-entitlements-repository.mjs   # EXISTENTE — extender si necesario
└── tests/
    └── tenant-effective-capabilities-get.test.mjs  # NUEVO

services/audit/
└── src/
    └── contract-boundary.mjs          # MODIFICAR — añadir tipo de evento capability_enforcement_denied

apps/web-console/
└── src/
    ├── lib/
    │   ├── console-context.tsx        # MODIFICAR — exponer capabilities en contexto
    │   └── hooks/
    │       └── use-capability-gate.ts  # NUEVO — hook de evaluación de capability
    ├── components/
    │   └── console/
    │       └── CapabilityGate.tsx      # NUEVO — componente wrapper
    ├── pages/
    │   ├── ConsoleFunctionsPage.tsx    # MODIFICAR — envolver con CapabilityGate
    │   └── ConsoleRealtimePage.tsx     # MODIFICAR — envolver con CapabilityGate
    └── services/
        └── planManagementApi.ts       # MODIFICAR — añadir fetcher de capabilities
```

## Decisiones de arquitectura

### DA-01 — Plugin APISIX dedicado vs. extensión de scope-enforcement

**Decisión**: Crear un plugin Lua independiente `capability-enforcement` que se ejecute después de `scope-enforcement` (priority 2850, inferior a 2900 del scope-enforcement existente). El scope-enforcement existente ya maneja scopes OAuth, privilege domains y function subdomains; añadirle capability gating lo haría excesivamente complejo.

**Justificación**: El plugin `scope-enforcement.lua` ya tiene 250+ líneas con 4 dominios de evaluación. Capabilities booleanas de plan son un dominio separado (negocio vs. IAM). Un plugin dedicado mantiene la responsabilidad única y permite habilitarlo/deshabilitarlo por ruta sin afectar al enforcement de scopes.

### DA-02 — Resolución de capabilities: caché LRU con TTL + invalidación por evento Kafka

**Decisión**: El plugin `capability-enforcement` mantiene un caché LRU en memoria con TTL configurable (env `CAPABILITY_CACHE_TTL_SECONDS`, default 120s). Adicionalmente, un consumer Kafka ligero escucha eventos `plan.assignment.changed` y `capability.override.changed` para invalidar la entrada del tenant afectado antes del TTL.

**Justificación**: El TTL solo introduce una ventana de inconsistencia de hasta 2 min. La invalidación por evento reduce esa ventana a < 1s en condiciones normales. Si Kafka no está disponible, el TTL garantiza eventual consistency.

### DA-03 — Código HTTP para rechazo por capability: 403 con código semántico diferenciado

**Decisión**: Usar `HTTP 403` con `code: "GW_CAPABILITY_NOT_ENTITLED"` en el cuerpo del error, no 402. El campo `detail.upgradePath` proporciona la acción sugerida.

**Justificación**: `402 Payment Required` no es estándar ni universalmente soportado por clientes HTTP. `403` es el estándar para "autenticado pero no autorizado". La diferenciación entre "sin permiso IAM" y "sin capability de plan" se hace por el campo `code` (`GW_SCOPE_INSUFFICIENT` vs. `GW_CAPABILITY_NOT_ENTITLED`), coherente con la estructura `ErrorResponse` existente en el OpenAPI.

### DA-04 — Mapa de rutas a capabilities: fichero YAML estático en gateway-config

**Decisión**: Un fichero `capability-gated-routes.yaml` define el mapeo `(method, path_pattern) → required_capability`. El plugin lo carga al arranque y lo refresca por watch de ConfigMap.

**Justificación**: El `public-route-catalog.json` existente ya sigue este patrón para `privilege_domain`. Usar YAML permite comentarios y agrupación. El mapa cambia con releases del producto, no con operaciones de tenant, así que un fichero estático desplegado vía Helm es el mecanismo correcto.

### DA-05 — Endpoint de capabilities efectivas: reutilizar vs. crear nuevo

**Decisión**: Crear una acción OpenWhisk dedicada `tenant-effective-capabilities-get` que devuelve solo el mapa booleano de capabilities efectivas (sin cuotas). Esto es más ligero y específico para el gateway y la consola que el endpoint existente `plan-effective-entitlements-get` que incluye cuotas, consumo y metadata de plan.

**Justificación**: El gateway necesita una respuesta mínima y rápida (< 10ms). El endpoint existente resuelve cuotas, hace joins con snapshots de uso y construye un payload grande. Un endpoint dedicado evita coupling entre el path de enforcement (hot path) y el path de visualización (consola de consumo).

### DA-06 — Postura de seguridad: deny-by-default

**Decisión**: Si el plugin no puede resolver las capabilities del tenant (timeout, error 5xx, caché vacío), bloquea el request con `HTTP 503` y `code: "GW_CAPABILITY_RESOLUTION_DEGRADED"`.

**Justificación**: Coherente con RN-02 de la spec. La disponibilidad del gateway no debe comprometer el modelo de negocio. El evento de degradación se emite para alerting.

## Flujo de enforcement objetivo

```text
┌──────────┐     ┌─────────────────┐     ┌────────────────────────┐     ┌─────────────┐
│  Client   │────▶│  APISIX Gateway │────▶│ scope-enforcement (P2900) │────▶│ capability- │
│ (API/UI)  │     │                 │     │ (auth, scopes, domains)  │     │ enforcement │
└──────────┘     └─────────────────┘     └────────────────────────┘     │  (P2850)    │
                                                                         └──────┬──────┘
                                                                                │
                                          ┌─────────────────────────────────────┼──────────┐
                                          │                                     ▼          │
                                          │  1. Extraer tenant_id del JWT                  │
                                          │  2. Buscar ruta en capability-gated-routes      │
                                          │     → Si no está mapeada: PASS (no gated)      │
                                          │  3. Consultar caché LRU por tenant_id           │
                                          │     → Hit: usar capabilities cacheadas          │
                                          │     → Miss: llamar tenant-effective-caps GET    │
                                          │  4. Evaluar required_capability en el mapa      │
                                          │     → enabled=true: PASS al upstream            │
                                          │     → enabled=false: DENY 403 + audit event    │
                                          │     → error resolución: DENY 503 + degrad event│
                                          └────────────────────────────────────────────────┘
```

## Cambios por artefacto

### 1. `services/gateway-config/plugins/capability-enforcement.lua` — NUEVO

Plugin APISIX Lua que implementa el enforcement de capabilities booleanas por ruta.

**Responsabilidades**:

- Cargar y mantener en memoria el mapa `capability-gated-routes` desde YAML/ConfigMap
- Mantener caché LRU de capabilities por tenant con TTL configurable
- En `access` phase: extraer `tenant_id` del JWT, buscar la ruta en el mapa, resolver capabilities, permitir o denegar
- Emitir eventos de denial vía sidecar HTTP (mismo patrón que `scope-enforcement.lua`)
- Emitir métricas Prometheus: `capability_enforcement_total{result="allow|deny|degraded",capability="..."}`

**Schema del plugin**:

```lua
schema = {
  type = "object",
  properties = {
    capability_resolution_url = { type = "string" },
    cache_ttl_seconds = { type = "integer", default = 120, minimum = 10 },
    cache_max_entries = { type = "integer", default = 500, minimum = 50 },
    deny_on_resolution_failure = { type = "boolean", default = true },
    audit_sidecar_url = { type = "string" },
    upgrade_path_url = { type = "string", default = "/plans/upgrade" }
  }
}
```

**Cuerpo de error estándar** (coherente con `ErrorResponse` existente):

```json
{
  "status": 403,
  "code": "GW_CAPABILITY_NOT_ENTITLED",
  "message": "Your current plan does not include this capability.",
  "detail": {
    "capability": "webhooks",
    "reason": "plan_restriction",
    "upgradePath": "/plans/upgrade",
    "currentPlanId": "pln_abc123"
  },
  "requestId": "req_xyz",
  "correlationId": "corr_abc",
  "timestamp": "2026-03-31T20:00:00Z",
  "resource": "/v1/webhooks",
  "retryable": false
}
```

### 2. `services/gateway-config/routes/capability-gated-routes.yaml` — NUEVO

Mapa declarativo de rutas protegidas por capability booleana.

```yaml
# Capability-gated route map
# Each entry maps (method, path_pattern) to the boolean capability key
# that must be enabled for the tenant to access the route.
# Path patterns use APISIX radixtree syntax.
capability_gates:
  - capability: webhooks
    routes:
      - { method: "*", path: "/v1/workspaces/*/webhooks" }
      - { method: "*", path: "/v1/workspaces/*/webhooks/*" }

  - capability: realtime
    routes:
      - { method: "*", path: "/v1/workspaces/*/realtime" }
      - { method: "*", path: "/v1/workspaces/*/realtime/*" }
      - { method: "GET", path: "/v1/events/subscribe" }

  - capability: sql_admin_api
    routes:
      - { method: "*", path: "/v1/workspaces/*/sql" }
      - { method: "*", path: "/v1/workspaces/*/sql/*" }
      - { method: "*", path: "/v1/workspaces/*/admin/sql" }
      - { method: "*", path: "/v1/workspaces/*/admin/sql/*" }

  - capability: passthrough_admin
    routes:
      - { method: "*", path: "/v1/workspaces/*/admin/passthrough" }
      - { method: "*", path: "/v1/workspaces/*/admin/passthrough/*" }

  - capability: functions_public
    routes:
      - { method: "POST", path: "/v1/functions/*/invoke" }
      - { method: "*", path: "/v1/workspaces/*/functions/public" }
      - { method: "*", path: "/v1/workspaces/*/functions/public/*" }
```

**Estrategia de despliegue**: Este fichero se monta como ConfigMap en el pod APISIX. Cambios requieren re-deploy del Helm chart (aceptable dado que los cambios de rutas gated son producto, no operación).

### 3. `services/provisioning-orchestrator/src/actions/tenant-effective-capabilities-get.mjs` — NUEVO

Acción OpenWhisk dedicada que devuelve el mapa booleano de capabilities efectivas de un tenant.

**Contrato de entrada**:

- `tenantId` (path param o query) — obligatorio para superadmin/internal, derivado del JWT para tenant actors
- `callerContext.actor` — del JWT procesado por el middleware

**Contrato de salida** (HTTP 200):

```json
{
  "tenantId": "ten_abc123",
  "planId": "pln_xyz789",
  "resolvedAt": "2026-03-31T20:00:00Z",
  "capabilities": {
    "webhooks": true,
    "realtime": false,
    "sql_admin_api": true,
    "passthrough_admin": false,
    "functions_public": true
  },
  "ttlHint": 120
}
```

**Lógica de resolución**:

1. Obtener `plan_assignment` actual del tenant (reutilizar `plan-assignment-repository`)
2. Si no hay assignment: devolver todas las capabilities como `false`
3. Obtener capabilities del plan base (`plan_capability_repository`)
4. Obtener overrides activos del tenant (`capability-override-repository` — ya modelado en T01/T02)
5. Merge: override explicit `true` habilita, override explicit `false` deshabilita, sin override usa plan base, sin plan base usa `platformDefault` del catálogo
6. Devolver mapa plano `{ [capabilityKey]: boolean }`

**Permisos**:

| Actor | Acceso |
|---|---|
| Tenant owner / admin / developer / viewer | Solo su propio tenant (derivado del JWT) |
| Superadmin / internal | Cualquier tenant (tenantId explícito requerido) |
| Service account (gateway) | Cualquier tenant con scope `capability:resolve` |

### 4. `services/audit/src/contract-boundary.mjs` — MODIFICAR

Añadir el tipo de evento `capability_enforcement_denied` al contrato de auditoría.

**Campos del evento**:

```javascript
{
  eventType: 'capability_enforcement_denied',
  tenantId: String,          // UUID del tenant
  workspaceId: String|null,  // UUID si aplica
  actorId: String,           // sub del JWT o client_id
  actorType: 'user' | 'service_account',
  capability: String,        // key de la capability bloqueada
  reason: 'plan_restriction' | 'override_restriction' | 'plan_unresolvable',
  channel: 'gateway' | 'console' | 'internal_api',
  resourcePath: String,      // ruta del recurso solicitado
  httpMethod: String,        // GET, POST, etc.
  requestId: String,         // ID de correlación
  correlationId: String,
  sourceIp: String,
  occurredAt: String         // ISO 8601 UTC
}
```

**Retención**: Clasificar como evento de seguridad (retención extendida, misma categoría que `scope_insufficient` y `privilege_domain_denied`).

### 5. `apps/web-console/src/lib/hooks/use-capability-gate.ts` — NUEVO

Hook React que evalúa si una capability está habilitada para el tenant del contexto actual.

```typescript
export function useCapabilityGate(capabilityKey: string): {
  enabled: boolean
  loading: boolean
  reason: 'plan_restriction' | 'override_restriction' | null
}
```

**Implementación**:

- Consume el contexto de consola (`console-context.tsx`) donde se almacenan las capabilities efectivas
- Devuelve `{ enabled: true, loading: false, reason: null }` si la capability está activa
- Devuelve `{ enabled: false, loading: false, reason: 'plan_restriction' }` si está bloqueada
- Durante carga inicial: `{ enabled: false, loading: true, reason: null }` (deny while loading)

### 6. `apps/web-console/src/components/console/CapabilityGate.tsx` — NUEVO

Componente wrapper que oculta o deshabilita children según la capability.

```typescript
interface CapabilityGateProps {
  capability: string
  mode?: 'hide' | 'disable'  // default: 'disable'
  upgradeMessage?: string
  children: ReactNode
}
```

**Comportamiento**:

- `mode='hide'`: No renderiza los children
- `mode='disable'`: Renderiza los children envueltos en un contenedor con `opacity-50 pointer-events-none` y un tooltip/badge de shadcn/ui que indica "Disponible en plan [X]. Contacta con tu administrador para ampliar."
- Usa `useCapabilityGate` internamente
- Durante `loading`: renderiza un skeleton placeholder

### 7. `apps/web-console/src/lib/console-context.tsx` — MODIFICAR

Extender el contexto de consola para incluir capabilities efectivas del tenant.

**Cambios**:

- Añadir campo `capabilities: Record<string, boolean>` al estado del contexto
- Añadir campo `capabilitiesLoading: boolean`
- En el efecto de carga del tenant: llamar a `getEffectiveCapabilities(tenantId)` desde `planManagementApi.ts`
- Refrescar capabilities cuando cambia el tenant activo
- Exponer `refreshCapabilities()` para forzar recarga manual

### 8. `apps/web-console/src/services/planManagementApi.ts` — MODIFICAR

Añadir función para obtener capabilities efectivas:

```typescript
export interface EffectiveCapabilities {
  tenantId: string
  planId: string
  resolvedAt: string
  capabilities: Record<string, boolean>
  ttlHint: number
}

export function getEffectiveCapabilities(
  tenantId?: string
): Promise<EffectiveCapabilities> {
  const url = tenantId
    ? `/v1/tenants/${tenantId}/effective-capabilities`
    : '/v1/tenant/effective-capabilities'
  return request<EffectiveCapabilities>(url)
}
```

### 9. `apps/web-console/src/pages/ConsoleFunctionsPage.tsx` — MODIFICAR

Envolver las acciones de funciones públicas con `CapabilityGate`:

```tsx
<CapabilityGate capability="functions_public" mode="disable">
  <PublishFunctionWizard />
</CapabilityGate>
```

### 10. `apps/web-console/src/pages/ConsoleRealtimePage.tsx` — MODIFICAR

Envolver la sección de realtime con `CapabilityGate`:

```tsx
<CapabilityGate capability="realtime" mode="disable">
  {/* Contenido de realtime */}
</CapabilityGate>
```

## Modelo de datos

### Tablas existentes utilizadas (no se modifican)

| Tabla | Uso en esta tarea |
|---|---|
| `plans` | Lectura de capabilities del plan base |
| `plan_assignments` | Lectura de plan activo del tenant |
| `boolean_capability_catalog` | Lectura de catálogo y platform defaults |
| `capability_overrides` (de T01/T02) | Lectura de overrides activos por tenant |

### Datos nuevos

No se crean tablas nuevas. El endpoint `tenant-effective-capabilities-get` es una vista calculada sobre datos existentes.

### Eventos Kafka nuevos

| Topic | Evento | Productor | Consumidor |
|---|---|---|---|
| `audit.security` | `capability_enforcement_denied` | Plugin APISIX (vía sidecar) | Servicio de auditoría |
| `platform.observability` | `capability_resolution_degraded` | Plugin APISIX (vía sidecar) | Sistema de alerting |

### Eventos Kafka consumidos

| Topic | Evento | Productor | Consumidor |
|---|---|---|---|
| `plan.lifecycle` | `plan.assignment.changed` | provisioning-orchestrator | Plugin APISIX (vía sidecar invalidador) |
| `plan.lifecycle` | `capability.override.changed` | provisioning-orchestrator | Plugin APISIX (vía sidecar invalidador) |

## Configuración de infraestructura

### Variables de entorno nuevas (plugin APISIX)

| Variable | Default | Descripción |
|---|---|---|
| `CAPABILITY_RESOLUTION_URL` | `http://provisioning-orchestrator:8080` | URL del servicio de resolución |
| `CAPABILITY_CACHE_TTL_SECONDS` | `120` | TTL del caché LRU |
| `CAPABILITY_CACHE_MAX_ENTRIES` | `500` | Tamaño máximo del caché |
| `CAPABILITY_ENFORCEMENT_ENABLED` | `false` | Feature flag global |
| `CAPABILITY_AUDIT_SIDECAR_URL` | `http://127.0.0.1:19092/denials` | URL del sidecar de auditoría |
| `CAPABILITY_UPGRADE_PATH_URL` | `/plans/upgrade` | URL base para mensajes de upgrade |

### Helm values nuevos

```yaml
gateway:
  plugins:
    capabilityEnforcement:
      enabled: false  # activar por entorno
      cacheTtlSeconds: 120
      cacheMaxEntries: 500
      upgradePathUrl: "/plans/upgrade"
  configMaps:
    capabilityGatedRoutes:
      mountPath: /etc/apisix/capability-gates
```

## Estrategia de pruebas

### Unitarias

| Fichero | Cobertura |
|---|---|
| `services/gateway-config/tests/capability-enforcement.test.mjs` | Lógica Lua del plugin: parsing del mapa de rutas, evaluación de capabilities, generación de errores, comportamiento deny-by-default |
| `services/provisioning-orchestrator/tests/tenant-effective-capabilities-get.test.mjs` | Resolución de capabilities: plan base, overrides aditivos/restrictivos, sin plan, merge correcto |
| `apps/web-console/src/lib/hooks/use-capability-gate.test.ts` | Hook: estados loading/enabled/disabled, cambio de tenant |
| `apps/web-console/src/components/console/CapabilityGate.test.tsx` | Componente: modos hide/disable, tooltip, skeleton |

### Integración

| Escenario | Componentes |
|---|---|
| Plugin resuelve capabilities vía HTTP y deniega correctamente | Plugin Lua + mock del endpoint de capabilities |
| Endpoint de capabilities devuelve merge correcto plan+overrides | Action OpenWhisk + PostgreSQL test DB |
| Consola carga capabilities al montar contexto | Console context + mock API |

### Contrato

| Fichero | Cobertura |
|---|---|
| `tests/contracts/capability-enforcement-error.contract.test.mjs` | El error 403 del gateway cumple el schema `ErrorResponse` del OpenAPI con los campos `detail.capability`, `detail.reason`, `detail.upgradePath` |
| `tests/contracts/tenant-effective-capabilities.contract.test.mjs` | El response del endpoint cumple el schema documentado |

### E2E

No se implementan E2E en esta tarea. US-PLAN-02-T06 cubre las pruebas de enforcement E2E.

### Validaciones operativas

```bash
npm run validate:public-api
npm run validate:openapi
npm run test:unit
npm run test:adapters
npm run test:contracts
npm run lint
```

## Riesgos y mitigaciones

| ID | Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|---|
| R-01 | Latencia del gateway aumenta por resolución de capabilities | Media | Alto | Caché LRU con TTL 120s; endpoint dedicado ligero (sin cuotas/consumo); métricas p99 monitorizadas |
| R-02 | Ventana de inconsistencia entre cambio de plan y enforcement | Media | Medio | Invalidación proactiva por Kafka + TTL máximo 120s; documentar SLA de propagación |
| R-03 | Feature flag `CAPABILITY_ENFORCEMENT_ENABLED=false` se olvida activar | Baja | Alto | Checklist de deploy por entorno; alerta si el flag está en false en producción > 24h |
| R-04 | El endpoint de resolución no está disponible al arrancar el gateway | Media | Alto | El plugin arranca con caché vacío + deny-by-default; primera request falla con 503, notifica degradación |
| R-05 | Scope creep: presión para incluir enforcement cuantitativo | Alta | Medio | Límites de alcance estrictos en el código; el plugin solo evalúa booleanos, nunca cantidades |

## Rollback

- **Feature flag**: `CAPABILITY_ENFORCEMENT_ENABLED=false` desactiva todo el enforcement sin redespliegue
- **Plugin**: El plugin `capability-enforcement` se puede desactivar por ruta en APISIX sin afectar `scope-enforcement`
- **Consola**: El hook `useCapabilityGate` devuelve `enabled: true` si no hay capabilities cargadas (graceful degradation en UI)
- **Endpoint**: La acción OpenWhisk se puede desactivar independientemente
- **No hay migraciones de datos**: No se requiere rollback de schema

## Dependencias previas

| Dependencia | Estado esperado | Bloquea |
|---|---|---|
| US-PLAN-02-T01 (cuotas hard/soft, overrides) | Implementado | Modelo de overrides en BD |
| US-PLAN-02-T02 (capabilities booleanas por plan) | Implementado | Catálogo y datos de capabilities en BD |
| US-PLAN-02-T03 (límites efectivos) | Implementado | Repository de resolución efectiva |
| US-PLAN-02-T04 (consola de consumo) | Implementado | Contexto de consola con datos de plan |
| US-PLAN-01 (catálogo de planes) | Implementado | Estructura de planes en BD |
| US-OBS-03 (observabilidad) | Implementado | Pipeline de eventos de auditoría |

## Paralelización posible

```text
Fase 1 (paralelo):
  ├── [A] Plugin capability-enforcement.lua + capability-gated-routes.yaml
  ├── [B] Action tenant-effective-capabilities-get.mjs
  └── [C] Contrato de error capability-enforcement-errors.openapi.md

Fase 2 (depende de B):
  ├── [D] Hook useCapabilityGate + componente CapabilityGate
  └── [E] Modificar console-context.tsx + planManagementApi.ts

Fase 3 (depende de A, D, E):
  ├── [F] Integrar plugin con endpoint real
  ├── [G] Envolver páginas de consola con CapabilityGate
  └── [H] Evento de auditoría en contract-boundary.mjs

Fase 4 (depende de todo):
  └── [I] Tests de contrato + validación completa
```

## Secuencia recomendada de implementación

1. **Contrato de error** — Definir el schema del error 403 de enforcement para que gateway y consola compartan la misma estructura
2. **Endpoint de capabilities efectivas** — Implementar `tenant-effective-capabilities-get.mjs` con tests unitarios
3. **Mapa de rutas gated** — Crear `capability-gated-routes.yaml` con las rutas iniciales
4. **Plugin Lua** — Implementar `capability-enforcement.lua` con tests unitarios y mock del endpoint
5. **Evento de auditoría** — Extender `contract-boundary.mjs` con el nuevo tipo de evento
6. **Hook y componente de consola** — Implementar `useCapabilityGate` y `CapabilityGate`
7. **Integración en contexto de consola** — Modificar `console-context.tsx` para cargar capabilities
8. **Envolver páginas** — Aplicar `CapabilityGate` en las páginas de funciones, realtime, webhooks, SQL admin
9. **Tests de contrato e integración** — Validar todo el flujo end-to-end a nivel de contrato
10. **Validación completa** — Ejecutar todos los quality gates del monorepo

## Criterios de done verificables

| ID | Criterio | Evidencia esperada |
|---|---|---|
| CD-01 | El plugin APISIX rechaza requests a rutas gated cuando la capability está deshabilitada | Test unitario + log de request rechazado con `GW_CAPABILITY_NOT_ENTITLED` |
| CD-02 | El plugin permite requests cuando la capability está habilitada | Test unitario + request pasa al upstream |
| CD-03 | Override aditivo habilita capability no incluida en plan base | Test unitario del endpoint de resolución |
| CD-04 | Override restrictivo deshabilita capability incluida en plan base | Test unitario del endpoint de resolución |
| CD-05 | Deny-by-default ante fallo de resolución | Test unitario del plugin con mock de error 5xx |
| CD-06 | La consola deshabilita elementos vinculados a capabilities inactivas | Test del componente CapabilityGate con capability=false |
| CD-07 | La consola habilita elementos cuando la capability está activa | Test del componente CapabilityGate con capability=true |
| CD-08 | Cada rechazo genera evento de auditoría con campos completos | Test de integración plugin + sidecar mock |
| CD-09 | El mapa de rutas a capabilities es declarativo y desplegable vía Helm | Fichero YAML validado + template Helm |
| CD-10 | El error de rechazo cumple el schema `ErrorResponse` del OpenAPI | Test de contrato |
| CD-11 | Capabilities se refrescan en < TTL tras cambio de plan | Test de integración con invalidación de caché |
| CD-12 | Todos los quality gates del monorepo pasan | Output de `npm run validate:public-api`, `npm run lint`, `npm run test:unit`, `npm run test:contracts` |

## Observabilidad

### Métricas Prometheus

| Métrica | Tipo | Labels | Descripción |
|---|---|---|---|
| `capability_enforcement_total` | Counter | `result={allow,deny,degraded}`, `capability`, `tenant_id` | Total de evaluaciones de enforcement |
| `capability_resolution_duration_seconds` | Histogram | `source={cache,remote}` | Latencia de resolución de capabilities |
| `capability_cache_hit_ratio` | Gauge | — | Ratio de cache hits sobre total de lookups |

### Dashboards sugeridos

- **Capability Enforcement Overview**: Tasa de deny/allow por capability, top tenants denegados, tasa de degradación
- **Resolution Latency**: p50/p95/p99 de resolución por source (cache vs. remote)
- **Cache Efficiency**: Hit ratio, evictions, size

### Alertas sugeridas

| Alerta | Condición | Severidad |
|---|---|---|
| `CapabilityResolutionDegraded` | `rate(capability_enforcement_total{result="degraded"}[5m]) > 0.01` | Warning |
| `CapabilityEnforcementDisabled` | `CAPABILITY_ENFORCEMENT_ENABLED == false` en producción > 24h | Warning |
| `CapabilityResolutionLatencyHigh` | `histogram_quantile(0.99, capability_resolution_duration_seconds) > 0.05` | Warning |

## Tracking de complejidad

| Violación | Justificación | Alternativa simple rechazada |
|---|---|---|
| Plugin Lua separado en vez de extender scope-enforcement | Separación de responsabilidades: IAM scopes vs. business capabilities | Extender scope-enforcement lo llevaría a 400+ líneas con 6 dominios de evaluación mezclados |
| Endpoint dedicado de capabilities vs. reutilizar effective-entitlements | Hot path del gateway necesita respuesta mínima < 10ms | effective-entitlements incluye cuotas, consumo y metadata; demasiado pesado para enforcement |
| Caché LRU + invalidación Kafka vs. solo TTL | Reducir ventana de inconsistencia de 2min a < 1s | Solo TTL es aceptable pero no cumple expectativas de producto para cambios de plan inmediatos |
