# Tasks — US-PLAN-02-T05: Enforcement de Capabilities en Gateway, UI y Control Plane

**Rama**: `107-capability-enforcement` | **Fecha**: 2026-03-31\
**Derivado de**: `plan.md` (secuencia de implementación recomendada, secciones 1–10)\
**Contexto de implementación**: El agente implementador recibe **únicamente** `plan.md` y este fichero (`tasks.md`). No tiene acceso al `spec.md` ni a otros artefactos de la carpeta `specs/`. Todo el contexto técnico necesario está incluido aquí o referenciado a `plan.md`.

---

## Reglas de carry-forward para el agente implementador

1. **Leer primero**: `specs/107-capability-enforcement/plan.md` completo antes de comenzar cualquier tarea.
2. **No modificar** ningún fichero fuera del mapa de ficheros listado en cada tarea.
3. **No crear** ficheros nuevos que no estén en el mapa de ficheros de la tarea en curso.
4. **No borrar** ficheros existentes no listados en el mapa.
5. Ejecutar los quality gates al final de cada tarea (ver sección de validación al final de este documento).
6. Si una tarea depende de una tarea anterior, verificar que los artefactos de esa tarea están presentes antes de comenzar.
7. **Preserve los ficheros no relacionados**: no tocar artefactos de specs `070`/`072` ni ningún otro fichero fuera del scope.
8. Cada tarea es atómica: debe poder mergearse de forma independiente sin romper el build.
9. El orden de las tareas es el orden correcto de implementación; respetar dependencias.

---

## Resumen de tareas

| # | Tarea | Fase | Depende de | Tipo |
|---|---|---|---|---|
| T-01 | Mapa declarativo de rutas capability-gated | 1 | — | NUEVO fichero |
| T-02 | Acción OpenWhisk `tenant-effective-capabilities-get` | 1 | — | NUEVO fichero |
| T-03 | Plugin APISIX `capability-enforcement.lua` | 2 | T-01, T-02 | NUEVO fichero |
| T-04 | Extensión de contrato de auditoría | 2 | — | MODIFICAR fichero |
| T-05 | Hook `useCapabilityGate` + componente `CapabilityGate` | 2 | — | NUEVO ficheros |
| T-06 | Integración de capabilities en contexto de consola | 3 | T-05 | MODIFICAR ficheros |
| T-07 | Envolver páginas de consola con `CapabilityGate` | 3 | T-05, T-06 | MODIFICAR ficheros |
| T-08 | Tests unitarios | 4 | T-01, T-02, T-03, T-05, T-06 | NUEVO ficheros |
| T-09 | Tests de contrato | 4 | T-02, T-03 | NUEVO ficheros |

---

## T-01 — Mapa declarativo de rutas capability-gated

### Alcance

Crear el fichero YAML estático `capability-gated-routes.yaml` que mapea cada ruta (method + path pattern) a la capability booleana que la protege. Este fichero es el input declarativo del plugin APISIX (T-03) y define qué rutas son "capability-gated". No contiene lógica; es pura configuración.

### Criterios de aceptación

- [ ] El fichero existe en `services/gateway-config/routes/capability-gated-routes.yaml`.
- [ ] Contiene las 5 capabilities de la plataforma: `webhooks`, `realtime`, `sql_admin_api`, `passthrough_admin`, `functions_public`.
- [ ] Para cada capability hay al menos 2 entradas de ruta con distintos path patterns.
- [ ] Todas las entradas siguen la sintaxis del radixtree de APISIX (`/v1/workspaces/*/webhooks`).
- [ ] El fichero tiene comentarios que explican el formato y cómo añadir nuevas entradas.
- [ ] El YAML es válido (sin errores de parseo).
- [ ] El fichero no referencia nombres de plan ni IDs de tenant (es solo routing, no lógica de negocio).

### Notas de implementación

Ver `plan.md` § "2. `capability-gated-routes.yaml` — NUEVO" para el contenido exacto de ejemplo incluyendo la estructura `capability_gates[].capability` y `capability_gates[].routes[].{ method, path }`.

La estrategia de despliegue (ConfigMap Helm) está documentada en `plan.md` § "Helm values nuevos".

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `services/gateway-config/routes/capability-gated-routes.yaml` | **WRITE** (crear) |
| `specs/107-capability-enforcement/plan.md` | READ |

---

## T-02 — Acción OpenWhisk `tenant-effective-capabilities-get`

### Alcance

Crear la acción OpenWhisk dedicada que resuelve y devuelve el mapa booleano de capabilities efectivas de un tenant. Esta acción es el único punto de verdad para que el gateway y la consola obtengan capabilities. Implementa la lógica de merge: override > plan explícito > `platform_default` del catálogo.

### Criterios de aceptación

- [ ] El fichero existe en `services/provisioning-orchestrator/src/actions/tenant-effective-capabilities-get.mjs`.
- [ ] Acepta `tenantId` como parámetro (query/path para superadmin/internal, derivado del JWT para tenant actors).
- [ ] Devuelve HTTP 200 con el schema exacto:
  ```json
  {
    "tenantId": "ten_abc123",
    "planId": "pln_xyz789",
    "resolvedAt": "<ISO 8601 UTC>",
    "capabilities": { "<key>": true|false },
    "ttlHint": 120
  }
  ```
- [ ] Si el tenant no tiene plan asignado (`plan_assignments` sin registro activo), devuelve todas las capabilities como `false`.
- [ ] Override explícito `enabled: true` habilita la capability incluso si el plan base la tiene `false`.
- [ ] Override explícito `enabled: false` deshabilita la capability incluso si el plan base la tiene `true`.
- [ ] Sin override, usa `plan.capabilities[key]`; si el plan no define la key, usa `boolean_capability_catalog.platform_default`.
- [ ] Solo capabilities con `is_active = true` en `boolean_capability_catalog` se incluyen en la respuesta.
- [ ] Solo tenants con scope `capability:resolve` o actor superadmin pueden consultar capabilities de otro tenant.
- [ ] Tenant owner/admin/developer/viewer solo puede consultar su propio tenant (derivado del JWT).
- [ ] El módulo es ES Module (`export default async function main(params)`), Node.js 20+.

### Notas de implementación

Ver `plan.md` § "3. `tenant-effective-capabilities-get.mjs` — NUEVO" para la lógica de resolución paso a paso y la tabla de permisos.

Las tablas de BD usadas (solo lectura) son: `plans`, `plan_assignments`, `boolean_capability_catalog`, `capability_overrides`. Ver `plan.md` § "Modelo de datos — Tablas existentes utilizadas".

Reutilizar `plan-assignment-repository`, `plan_capability_repository`, `capability-override-repository` ya existentes en `services/provisioning-orchestrator/src/repositories/` (estos repositorios fueron creados en T01/T02 previas y están disponibles en el código base).

El campo `ttlHint` debe ser el valor de la variable de entorno `CAPABILITY_CACHE_TTL_SECONDS` (default: `120`).

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `services/provisioning-orchestrator/src/actions/tenant-effective-capabilities-get.mjs` | **WRITE** (crear) |
| `services/provisioning-orchestrator/src/repositories/effective-entitlements-repository.mjs` | READ (y WRITE si necesita extensión para el nuevo caso) |
| `services/provisioning-orchestrator/src/models/boolean-capability.mjs` | READ |
| `specs/107-capability-enforcement/plan.md` | READ |
| `specs/107-capability-enforcement/data-model.md` | READ |

---

## T-03 — Plugin APISIX `capability-enforcement.lua`

### Alcance

Crear el plugin Lua de APISIX que aplica el enforcement de capabilities booleanas en el gateway. Se ejecuta en la fase `access` con prioridad 2850 (después de `scope-enforcement` en 2900). Carga el mapa de rutas (T-01), mantiene un caché LRU con TTL, consulta el endpoint de capabilities (T-02) en caso de miss, y rechaza con `HTTP 403` si la capability no está activa. Implementa deny-by-default ante fallos de resolución.

### Criterios de aceptación

- [ ] El fichero existe en `services/gateway-config/plugins/capability-enforcement.lua`.
- [ ] El plugin tiene prioridad `2850` (inferior a `2900` de `scope-enforcement`).
- [ ] Se ejecuta en la fase `access`.
- [ ] Lee el mapa de rutas desde `capability-gated-routes.yaml` (cargado al arranque; ruta configurable).
- [ ] Si la ruta del request no está en el mapa, el plugin hace PASS sin evaluación.
- [ ] Mantiene un caché LRU en memoria: key = `tenant_id`, TTL = `CAPABILITY_CACHE_TTL_SECONDS` (default 120s), max = `CAPABILITY_CACHE_MAX_ENTRIES` (default 500).
- [ ] Extrae `tenant_id` del claim JWT del request (claim `tenant_id` o `x-tenant-id`).
- [ ] En caso de cache miss, llama a `CAPABILITY_RESOLUTION_URL/v1/tenant/effective-capabilities` con el `tenant_id`.
- [ ] Si la capability está `true`: PASS al upstream.
- [ ] Si la capability está `false`: responde `HTTP 403` con el cuerpo `CapabilityNotEntitledError` del contrato (ver `plan.md` § "1. `capability-enforcement.lua` — NUEVO" y `contracts/capability-enforcement-errors.openapi.md`).
- [ ] Si no puede resolver capabilities (timeout, 5xx): responde `HTTP 503` con `GW_CAPABILITY_RESOLUTION_DEGRADED` y **no** enruta al upstream.
- [ ] Emite evento de auditoría al sidecar HTTP (`CAPABILITY_AUDIT_SIDECAR_URL`) en cada rechazo (403 o 503).
- [ ] Emite métrica Prometheus `capability_enforcement_total{result,capability}` en cada evaluación.
- [ ] El schema del plugin valida las opciones de configuración definidas en `plan.md` § schema del plugin.
- [ ] Si `deny_on_resolution_failure = false` (override operacional), hace PASS ante fallo de resolución (modo de emergencia).
- [ ] El evento de auditoría emitido incluye todos los campos del schema de `plan.md` § "4. `contract-boundary.mjs` — MODIFICAR".

### Notas de implementación

Ver `plan.md` § "1. `capability-enforcement.lua` — NUEVO" para el schema completo del plugin, el cuerpo de error estándar y el flujo de evaluación.

Ver `plan.md` § "Flujo de enforcement objetivo" para el diagrama de flujo completo.

Variables de entorno relevantes: `CAPABILITY_RESOLUTION_URL`, `CAPABILITY_CACHE_TTL_SECONDS`, `CAPABILITY_CACHE_MAX_ENTRIES`, `CAPABILITY_ENFORCEMENT_ENABLED`, `CAPABILITY_AUDIT_SIDECAR_URL`, `CAPABILITY_UPGRADE_PATH_URL`.

El campo `requestId` del error debe tomarse del header `X-Request-ID` del request entrante. El campo `correlationId` del header `X-Correlation-ID`.

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `services/gateway-config/plugins/capability-enforcement.lua` | **WRITE** (crear) |
| `services/gateway-config/plugins/scope-enforcement.lua` | READ (referencia de patrones existentes, no modificar) |
| `services/gateway-config/routes/capability-gated-routes.yaml` | READ (output de T-01) |
| `specs/107-capability-enforcement/plan.md` | READ |
| `specs/107-capability-enforcement/contracts/capability-enforcement-errors.openapi.md` | READ |

---

## T-04 — Extensión del contrato de auditoría

### Alcance

Modificar `services/audit/src/contract-boundary.mjs` para añadir el tipo de evento `capability_enforcement_denied` al catálogo de tipos de eventos de auditoría del sistema. No implementa la emisión del evento (eso lo hace el plugin en T-03 y el sidecar existente); solo expone el tipo y el schema del campo.

### Criterios de aceptación

- [ ] El fichero `contract-boundary.mjs` incluye `'capability_enforcement_denied'` en el enum/lista de `eventType` válidos.
- [ ] Expone o documenta el schema del evento con todos los campos requeridos:
  `eventType`, `tenantId`, `workspaceId`, `actorId`, `actorType`, `capability`, `reason`, `channel`, `resourcePath`, `httpMethod`, `requestId`, `correlationId`, `sourceIp`, `occurredAt`.
- [ ] El campo `reason` acepta exactamente: `'plan_restriction' | 'override_restriction' | 'plan_unresolvable'`.
- [ ] El campo `channel` acepta exactamente: `'gateway' | 'console' | 'internal_api'`.
- [ ] El campo `actorType` acepta exactamente: `'user' | 'service_account'`.
- [ ] El evento está clasificado como `security` (misma categoría que `scope_insufficient` y `privilege_domain_denied`) para garantizar retención extendida.
- [ ] No se rompe ningún export existente del módulo.

### Notas de implementación

Ver `plan.md` § "4. `contract-boundary.mjs` — MODIFICAR" para el objeto JavaScript completo con los campos y sus tipos.

La clasificación de retención como `security` debe seguir el patrón existente en el módulo para `scope_insufficient` y `privilege_domain_denied`.

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `services/audit/src/contract-boundary.mjs` | **WRITE** (modificar) |
| `specs/107-capability-enforcement/plan.md` | READ |

---

## T-05 — Hook `useCapabilityGate` + componente `CapabilityGate`

### Alcance

Crear los dos primitivos de consola para enforcement de capabilities en UI:

1. **Hook** `useCapabilityGate(capabilityKey)`: consume el contexto de consola y devuelve el estado de la capability (`enabled`, `loading`, `reason`).
2. **Componente** `CapabilityGate`: wrapper que renderiza sus `children` según el estado de la capability, con soporte para modos `'hide'` y `'disable'`.

Esta tarea no modifica `console-context.tsx` (eso es T-06). El hook asume que el contexto ya expone `capabilities: Record<string, boolean>` y `capabilitiesLoading: boolean`.

### Criterios de aceptación

**Hook `useCapabilityGate`:**
- [ ] El fichero existe en `apps/web-console/src/lib/hooks/use-capability-gate.ts`.
- [ ] Firma: `function useCapabilityGate(capabilityKey: string): { enabled: boolean; loading: boolean; reason: 'plan_restriction' | 'override_restriction' | null }`.
- [ ] Durante carga (`capabilitiesLoading = true`): devuelve `{ enabled: false, loading: true, reason: null }` (deny while loading).
- [ ] Si `capabilities[capabilityKey] === true`: devuelve `{ enabled: true, loading: false, reason: null }`.
- [ ] Si `capabilities[capabilityKey] === false` o la key no existe: devuelve `{ enabled: false, loading: false, reason: 'plan_restriction' }`.
- [ ] Si el contexto no tiene la key (undefined): trata como `false` (deny-by-default).

**Componente `CapabilityGate`:**
- [ ] El fichero existe en `apps/web-console/src/components/console/CapabilityGate.tsx`.
- [ ] Props: `{ capability: string; mode?: 'hide' | 'disable'; upgradeMessage?: string; children: ReactNode }`.
- [ ] `mode` default: `'disable'`.
- [ ] En modo `'hide'` + capability deshabilitada: no renderiza `children`.
- [ ] En modo `'disable'` + capability deshabilitada: renderiza `children` con `opacity-50 pointer-events-none` y un tooltip/badge de shadcn/ui con el mensaje de restricción de plan.
- [ ] El mensaje por defecto del tooltip es: `"Disponible en un plan superior. Contacta con tu administrador para ampliar."` (o usa `upgradeMessage` si se proporciona).
- [ ] Durante `loading`: renderiza un skeleton placeholder (no los children).
- [ ] Cuando capability está habilitada: renderiza `children` sin modificación.
- [ ] El componente es puramente visual; no hace fetch ni llama a API.

### Notas de implementación

Ver `plan.md` § "5. `use-capability-gate.ts` — NUEVO" y § "6. `CapabilityGate.tsx` — NUEVO".

El hook importa el contexto de consola con el hook de contexto existente (probablemente `useConsoleContext()` o similar); revisar `apps/web-console/src/lib/console-context.tsx` para el nombre exacto del hook de contexto antes de implementar.

El componente usa componentes de shadcn/ui para el tooltip. Revisar qué componentes de tooltip/popover están disponibles en `apps/web-console/src/components/ui/`.

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `apps/web-console/src/lib/hooks/use-capability-gate.ts` | **WRITE** (crear) |
| `apps/web-console/src/components/console/CapabilityGate.tsx` | **WRITE** (crear) |
| `apps/web-console/src/lib/console-context.tsx` | READ (para entender la shape del contexto, no modificar) |
| `apps/web-console/src/components/ui/` | READ (para identificar componentes de tooltip disponibles) |
| `specs/107-capability-enforcement/plan.md` | READ |

---

## T-06 — Integración de capabilities en contexto de consola

### Alcance

Modificar `console-context.tsx` y `planManagementApi.ts` para:
1. Añadir la función `getEffectiveCapabilities` al API client de gestión de planes.
2. Extender el contexto de consola para cargar y exponer las capabilities efectivas del tenant.

Esto hace que `useCapabilityGate` (T-05) tenga datos reales cuando se monta el contexto.

### Criterios de aceptación

**`planManagementApi.ts`:**
- [ ] Añade la interface `EffectiveCapabilities` con los campos: `tenantId`, `planId`, `resolvedAt`, `capabilities: Record<string, boolean>`, `ttlHint`.
- [ ] Añade la función exportada `getEffectiveCapabilities(tenantId?: string): Promise<EffectiveCapabilities>`.
- [ ] Si `tenantId` se proporciona (superadmin): llama a `/v1/tenants/${tenantId}/effective-capabilities`.
- [ ] Si no se proporciona: llama a `/v1/tenant/effective-capabilities` (tenant del JWT).
- [ ] Usa la función `request<T>()` existente en el módulo (mismo patrón que otras funciones del módulo).
- [ ] No modifica ninguna función existente.

**`console-context.tsx`:**
- [ ] Añade campo `capabilities: Record<string, boolean>` al estado del contexto (initial value: `{}`).
- [ ] Añade campo `capabilitiesLoading: boolean` al estado del contexto (initial value: `true`).
- [ ] En el efecto de carga del tenant activo: llama a `getEffectiveCapabilities()` y almacena el resultado en `capabilities`.
- [ ] Cuando cambia el tenant activo: limpia `capabilities` y `capabilitiesLoading = true`, luego recarga.
- [ ] Expone `refreshCapabilities(): void` para forzar recarga manual.
- [ ] En caso de error en `getEffectiveCapabilities()`: `capabilities` queda como `{}` y `capabilitiesLoading = false` (deny-by-default implícito por valor vacío).
- [ ] No rompe ningún campo o función existente del contexto.

### Notas de implementación

Ver `plan.md` § "7. `console-context.tsx` — MODIFICAR" y § "8. `planManagementApi.ts` — MODIFICAR".

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `apps/web-console/src/lib/console-context.tsx` | **WRITE** (modificar) |
| `apps/web-console/src/services/planManagementApi.ts` | **WRITE** (modificar) |
| `specs/107-capability-enforcement/plan.md` | READ |

---

## T-07 — Envolver páginas de consola con `CapabilityGate`

### Alcance

Aplicar el componente `CapabilityGate` (T-05) en las páginas de la consola que están vinculadas a capabilities premium. En esta tarea se cubren las dos páginas explícitamente identificadas en `plan.md`. Las páginas de `webhooks`, `sql_admin_api` y `passthrough_admin` siguen el mismo patrón pero están fuera del alcance de esta tarea (ver nota de scope más abajo).

### Criterios de aceptación

**`ConsoleFunctionsPage.tsx`:**
- [ ] El componente/wizard de publicación de funciones está envuelto con `<CapabilityGate capability="functions_public" mode="disable">`.
- [ ] Si `functions_public` está deshabilitado: el wizard de publicación está deshabilitado con indicador visual.
- [ ] Si `functions_public` está habilitado: el wizard funciona exactamente igual que antes.
- [ ] No se modifica ninguna otra lógica de la página.

**`ConsoleRealtimePage.tsx`:**
- [ ] El contenido de realtime está envuelto con `<CapabilityGate capability="realtime" mode="disable">`.
- [ ] Si `realtime` está deshabilitado: el contenido está deshabilitado con indicador visual.
- [ ] Si `realtime` está habilitado: el contenido funciona exactamente igual que antes.
- [ ] No se modifica ninguna otra lógica de la página.

**Nota de scope**: Las páginas de `webhooks`, `sql_admin_api` y `passthrough_admin` no están listadas en `plan.md` como ficheros a modificar. No crearlas ni modificarlas en esta tarea. Si el agente las encuentra, dejarlas intactas.

### Notas de implementación

Ver `plan.md` § "9. `ConsoleFunctionsPage.tsx` — MODIFICAR" y § "10. `ConsoleRealtimePage.tsx` — MODIFICAR".

Importar `CapabilityGate` desde `@/components/console/CapabilityGate` (o la ruta relativa equivalente).

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `apps/web-console/src/pages/ConsoleFunctionsPage.tsx` | **WRITE** (modificar) |
| `apps/web-console/src/pages/ConsoleRealtimePage.tsx` | **WRITE** (modificar) |
| `apps/web-console/src/components/console/CapabilityGate.tsx` | READ (output de T-05) |
| `specs/107-capability-enforcement/plan.md` | READ |

---

## T-08 — Tests unitarios

### Alcance

Crear los tests unitarios para los cuatro componentes nuevos: plugin Lua, acción OpenWhisk, hook y componente de consola.

### Criterios de aceptación

**`capability-enforcement.test.mjs` (gateway):**
- [ ] El fichero existe en `services/gateway-config/tests/capability-enforcement.test.mjs`.
- [ ] Test: ruta no gated → PASS sin evaluación.
- [ ] Test: ruta gated + capability `true` → PASS al upstream.
- [ ] Test: ruta gated + capability `false` → respuesta 403 con `code: "GW_CAPABILITY_NOT_ENTITLED"` y `detail.capability` correcto.
- [ ] Test: fallo de resolución (mock 5xx) + `deny_on_resolution_failure: true` → respuesta 503.
- [ ] Test: caché hit → no llama al endpoint de resolución.
- [ ] Test: caché miss → llama al endpoint y almacena el resultado.
- [ ] Test: override aditivo (plan `false`, override `true`) → PASS.
- [ ] Test: override restrictivo (plan `true`, override `false`) → 403.
- [ ] Usa el framework de testing del monorepo (`node:test` nativo).

**`tenant-effective-capabilities-get.test.mjs` (provisioning-orchestrator):**
- [ ] El fichero existe en `services/provisioning-orchestrator/tests/tenant-effective-capabilities-get.test.mjs`.
- [ ] Test: tenant sin plan asignado → todas capabilities `false`.
- [ ] Test: plan base define capability como `true` → capability `true`.
- [ ] Test: override aditivo sobre plan con `false` → capability `true`.
- [ ] Test: override restrictivo sobre plan con `true` → capability `false`.
- [ ] Test: capability no definida en plan → usa `platform_default`.
- [ ] Test: capability con `is_active = false` → no aparece en respuesta.
- [ ] Usa el framework de testing del monorepo (`node:test` nativo).

**`use-capability-gate.test.ts` (consola):**
- [ ] El fichero existe en `apps/web-console/src/lib/hooks/use-capability-gate.test.ts`.
- [ ] Test: capability `true` en contexto → `{ enabled: true, loading: false }`.
- [ ] Test: capability `false` en contexto → `{ enabled: false, reason: 'plan_restriction' }`.
- [ ] Test: `capabilitiesLoading = true` → `{ enabled: false, loading: true }`.
- [ ] Test: capability key no existe en el mapa → `{ enabled: false }` (deny-by-default).
- [ ] Usa Vitest.

**`CapabilityGate.test.tsx` (consola):**
- [ ] El fichero existe en `apps/web-console/src/components/console/CapabilityGate.test.tsx`.
- [ ] Test: modo `'hide'` + capability deshabilitada → children no renderizados.
- [ ] Test: modo `'disable'` + capability deshabilitada → children renderizados con `pointer-events-none` y tooltip visible.
- [ ] Test: capability habilitada → children renderizados sin modificación.
- [ ] Test: `loading = true` → skeleton renderizado (children no visibles).
- [ ] Usa Vitest + Testing Library.

### Notas de implementación

Ver `plan.md` § "Estrategia de pruebas — Unitarias" para la tabla de cobertura.

Para los tests del plugin Lua (`capability-enforcement.test.mjs`), seguir el patrón de los tests existentes en `services/gateway-config/tests/` para mockear el contexto de APISIX.

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `services/gateway-config/tests/capability-enforcement.test.mjs` | **WRITE** (crear) |
| `services/provisioning-orchestrator/tests/tenant-effective-capabilities-get.test.mjs` | **WRITE** (crear) |
| `apps/web-console/src/lib/hooks/use-capability-gate.test.ts` | **WRITE** (crear) |
| `apps/web-console/src/components/console/CapabilityGate.test.tsx` | **WRITE** (crear) |
| `services/gateway-config/plugins/capability-enforcement.lua` | READ (output de T-03) |
| `services/provisioning-orchestrator/src/actions/tenant-effective-capabilities-get.mjs` | READ (output de T-02) |
| `apps/web-console/src/lib/hooks/use-capability-gate.ts` | READ (output de T-05) |
| `apps/web-console/src/components/console/CapabilityGate.tsx` | READ (output de T-05) |
| `services/gateway-config/tests/` | READ (patrones existentes) |
| `services/provisioning-orchestrator/tests/` | READ (patrones existentes) |
| `specs/107-capability-enforcement/plan.md` | READ |

---

## T-09 — Tests de contrato

### Alcance

Crear los dos tests de contrato que verifican que los contratos del sistema (error del gateway y response de capabilities) cumplen los schemas OpenAPI documentados.

### Criterios de aceptación

**`capability-enforcement-error.contract.test.mjs`:**
- [ ] El fichero existe en `tests/contracts/capability-enforcement-error.contract.test.mjs`.
- [ ] Verifica que el payload de error 403 producido por el plugin incluye: `status: 403`, `code: "GW_CAPABILITY_NOT_ENTITLED"`, `detail.capability` (string), `detail.reason` (enum), `detail.upgradePath` (string), `retryable: false`.
- [ ] Verifica que el payload de error 503 incluye: `status: 503`, `code: "GW_CAPABILITY_RESOLUTION_DEGRADED"`, `retryable: true`.
- [ ] El test valida contra el schema `ErrorResponse` base del proyecto más las extensiones definidas en `specs/107-capability-enforcement/contracts/capability-enforcement-errors.openapi.md`.
- [ ] Usa el framework de contract testing del monorepo.

**`tenant-effective-capabilities.contract.test.mjs`:**
- [ ] El fichero existe en `tests/contracts/tenant-effective-capabilities.contract.test.mjs`.
- [ ] Verifica que el response de `tenant-effective-capabilities-get` incluye: `tenantId` (string con prefijo `ten_`), `planId` (string con prefijo `pln_`), `resolvedAt` (ISO 8601), `capabilities` (objeto con valores booleanos), `ttlHint` (number).
- [ ] Verifica que `capabilities` es un objeto plano (sin nesting) con keys en formato `snake_case`.
- [ ] Usa el framework de contract testing del monorepo.

### Notas de implementación

Ver `plan.md` § "Estrategia de pruebas — Contrato" para la tabla de cobertura.

Para los schemas, leer `specs/107-capability-enforcement/contracts/capability-enforcement-errors.openapi.md` y `specs/107-capability-enforcement/data-model.md`.

Seguir el patrón de los tests de contrato existentes en `tests/contracts/` para imports, setup y assertions.

### Mapa de ficheros

| Fichero | Operación |
|---|---|
| `tests/contracts/capability-enforcement-error.contract.test.mjs` | **WRITE** (crear) |
| `tests/contracts/tenant-effective-capabilities.contract.test.mjs` | **WRITE** (crear) |
| `tests/contracts/` | READ (patrones existentes) |
| `specs/107-capability-enforcement/contracts/capability-enforcement-errors.openapi.md` | READ |
| `specs/107-capability-enforcement/data-model.md` | READ |
| `specs/107-capability-enforcement/plan.md` | READ |

---

## Validación tras cada tarea

Ejecutar los siguientes comandos desde la raíz del repositorio tras completar cada tarea. Todos deben pasar antes de hacer commit de la tarea:

```bash
npm run lint
npm run test:unit
npm run validate:openapi
```

Tras completar T-09 (última tarea), ejecutar la validación completa:

```bash
npm run validate:public-api
npm run validate:openapi
npm run test:unit
npm run test:adapters
npm run test:contracts
npm run lint
```

---

## Criterios de done globales (de `plan.md`)

| ID | Criterio | Tarea que lo cubre |
|---|---|---|
| CD-01 | Plugin APISIX rechaza requests con capability deshabilitada | T-03, T-08 |
| CD-02 | Plugin permite requests con capability habilitada | T-03, T-08 |
| CD-03 | Override aditivo habilita capability no en plan base | T-02, T-08 |
| CD-04 | Override restrictivo deshabilita capability en plan base | T-02, T-08 |
| CD-05 | Deny-by-default ante fallo de resolución | T-03, T-08 |
| CD-06 | Consola deshabilita elementos con capability inactiva | T-05, T-06, T-07, T-08 |
| CD-07 | Consola habilita elementos con capability activa | T-05, T-06, T-07, T-08 |
| CD-08 | Cada rechazo genera evento de auditoría completo | T-03, T-04 |
| CD-09 | Mapa de rutas es declarativo y desplegable vía Helm | T-01 |
| CD-10 | Error de rechazo cumple schema `ErrorResponse` del OpenAPI | T-03, T-09 |
| CD-11 | Capabilities se refrescan en < TTL tras cambio de plan | T-02, T-03 (caché + Kafka hint) |
| CD-12 | Todos los quality gates del monorepo pasan | T-08, T-09 (validación completa) |

---

*Documento generado para el stage `speckit.tasks` — US-PLAN-02-T05 | Rama: `107-capability-enforcement`*
