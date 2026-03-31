<!-- markdownlint-disable MD031 MD040 -->
# Plan técnico de implementación — US-SEC-02-T03

**Feature Branch**: `093-scope-enforcement-blocking`  
**Task ID**: US-SEC-02-T03  
**Epic**: EP-18 — Seguridad funcional transversal  
**Historia padre**: US-SEC-02 — Gestión segura de secretos, rotación, enforcement de scope y separación de privilegios  
**Fecha del plan**: 2026-03-31  
**Estado**: Ready for tasks  
**Dependencias directas**: US-SEC-02-T01 (`091-secure-secret-storage`), US-SEC-02-T02 (`092-secret-rotation-no-redeploy`)  
**Requisitos funcionales**: RF-SEC-005, RF-SEC-006, RF-SEC-007, RF-SEC-010, RF-SEC-011

---

## 1. Objetivo y alcance estricto de T03

Implementar el mecanismo completo de **registro y bloqueo de peticiones fuera del scope del token o de la membresía**, incluyendo:

- Plugin APISIX personalizado (`scope-enforcement`) que evalúa los scopes del token Keycloak y las entitlements del plan del tenant antes de enrutar la petición al backend.
- Registro de la declaración de scopes requeridos por ruta en `services/gateway-config` (manifiestos YAML) y opcionalmente en una tabla PostgreSQL para rutas dinámicas.
- Evaluación de workspace-scope: tokens vinculados a un workspace no pueden operar sobre recursos de otro workspace del mismo tenant.
- Comportamiento fail-closed: rutas sin declaración de scope requerido bloquean la petición y emiten un evento de error de configuración.
- Publicación de eventos de auditoría a Kafka para cada petición denegada, consumibles por operadores de seguridad.
- OpenWhisk action `scope-enforcement-audit-query` para que superadmins y tenant-owners consulten el registro de denegaciones.
- Página en la consola de administración (`ConsoleScopeEnforcementPage.tsx`) con vista de denegaciones recientes, filtros y exportación.

### Fuera de alcance de T03

- Emisión, renovación o revocación de tokens (US-SEC-02-T01, Keycloak).
- Mecánica de rotación de secretos (US-SEC-02-T02).
- Separación de permisos admin estructural vs. acceso a datos (US-SEC-02-T04).
- Separación de permisos deploy de funciones vs. ejecución (US-SEC-02-T05).
- Pruebas de hardening/penetración (US-SEC-02-T06).
- Gestión de UI del plan o integración con facturación.
- Definición del catálogo de scopes por endpoint (goberned externamente; T03 lo consume, no lo crea).

---

## 2. Technical Context

**Language/Version**: Node.js 20+ ESM (`"type": "module"`, pnpm workspaces); Lua 5.1 (plugin APISIX via OpenResty)  
**Primary Dependencies**: `pg` (PostgreSQL), `kafkajs` (Kafka audit), Apache OpenWhisk action patterns (`services/provisioning-orchestrator/src/actions/`), React 18 + Tailwind CSS + shadcn/ui (consola), APISIX plugin API + `kong.request`/`ngx` globals  
**Storage**: PostgreSQL (`scope_enforcement_denials`, `endpoint_scope_requirements`), cache in-memory APISIX (TTL configurable)  
**Testing**: `node:test` Node 20 built-in (backend unit/integration), Vitest + React Testing Library (consola), Lua `busted` (plugin unitario)  
**Target Platform**: Kubernetes / OpenShift (Helm), multi-tenant BaaS  
**Project Type**: Multi-service monorepo (control-plane + gateway-config + provisioning-orchestrator + web-console)  
**Performance Goals**: evaluación de scope p95 < 5 ms (caché in-process en APISIX); query de denegaciones < 300 ms por 30 días  
**Constraints**: multi-tenancy, workspace isolation, fail-closed por defecto, sin valores de secretos en repositorio, RBAC sobre consultas de auditoría  
**Scale/Scope**: todos los endpoints públicos `/v1/`, cobertura cruzada de tenants en vista superadmin

---

## 3. Constitution Check

| Principio | Estado | Notas |
|-----------|--------|-------|
| I. Monorepo Separation of Concerns | ✅ PASS | Plugin APISIX en `services/gateway-config/plugins/`; acción OpenWhisk en `services/provisioning-orchestrator/src/actions/`; contrato en `services/internal-contracts/src/`; UI en `apps/web-console/src/pages/`; migración en `services/provisioning-orchestrator/src/migrations/`. Sin nuevas carpetas de primer nivel. |
| II. Incremental Delivery First | ✅ PASS | Fases ordenadas: modelo de datos → plugin APISIX → action query → UI. Cada fase independientemente revisable y desplegable. |
| III. Kubernetes / OpenShift Compatibility | ✅ PASS | Plugin APISIX empaquetado en ConfigMap; migrations vía Helm job; sin supuestos de host. |
| IV. Quality Gates at Root | ✅ PASS | Tests nuevos integrados en los scripts raíz existentes (`node --test`, Vitest). Busted para el plugin Lua. |
| V. Documentation as Part of the Change | ✅ PASS | Este plan.md + data-model.md + contracts/ + ADR en `docs/adr/` constituyen la documentación obligatoria. |
| Secrets | ✅ PASS | Sin valores de secretos en repositorio; tokens Keycloak gestionados en runtime. |
| pnpm workspaces | ✅ PASS | Nuevos packages siguen el patrón existente de miembros de workspace. |

*Sin violaciones. Tabla de complejidad no requerida.*

---

## 4. Arquitectura objetivo

### 4.1 Diagrama de componentes

```
Cliente
  │
  ▼
┌───────────────────────────────────────────────────────────────────┐
│ APISIX (services/gateway-config/)                                 │
│                                                                   │
│  Fase: access (antes de cualquier proxy al backend)               │
│                                                                   │
│  Plugin 1: key-auth / jwt-auth  ← autentica, extrae token claims  │
│  Plugin 2: scope-enforcement    ← bloquea fuera de scope/plan     │
│    ├─ Lee scopes del token (claim "scope" o "scp")                │
│    ├─ Lee workspace_id (claim "workspace_id" o header)            │
│    ├─ Lee plan_id del tenant (caché + PostgreSQL fallback)        │
│    ├─ Consulta endpoint_scope_requirements (caché in-process)     │
│    ├─ Si falta declaración → deny + log CONFIG_ERROR              │
│    ├─ Si scopes insuficientes → HTTP 403 SCOPE_INSUFFICIENT       │
│    ├─ Si workspace mismatch → HTTP 403 WORKSPACE_SCOPE_MISMATCH   │
│    ├─ Si plan no incluye entitlement → HTTP 403 PLAN_ENTITLEMENT_DENIED │
│    └─ En deny: publica a Kafka (fire-and-forget, buffered)        │
│                                                                   │
│  Manifiestos: plugins/scope-enforcement.yaml                      │
│               openapi-fragments/scope-enforcement.yaml            │
└───────────────────────────┬───────────────────────────────────────┘
                            │ peticiones permitidas
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│ Backend (control-plane / provisioning-orchestrator / etc.)        │
│ Recibe header X-Enforcement-Verified: true                        │
│ (Puede re-validar en segunda línea si lleva token user context)   │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ Kafka Topics (kafkajs publisher — dentro del plugin vía sidecar) │
│                                                                   │
│  console.security.scope-denied       (30d)                        │
│  console.security.plan-denied        (30d)                        │
│  console.security.workspace-mismatch (30d)                        │
│  console.security.config-error       (7d)                         │
└──────────────────────────┬───────────────────────────────────────┘
                           │
                           ▼ consume
┌──────────────────────────────────────────────────────────────────┐
│ scope-enforcement-event-recorder (sidecar OpenWhisk action)       │
│   → INSERT scope_enforcement_denials (PostgreSQL)                 │
│   → garantiza audit trail sin bloquear path de evaluación        │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ scope-enforcement-audit-query (OpenWhisk action)                  │
│   → GET /api/security/scope-enforcement/denials                   │
│   → filtra por tenant_id, workspace_id, time range, denial_type  │
│   → superadmin: todos los tenants; tenant-owner: solo su tenant   │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ apps/web-console/src/pages/ConsoleScopeEnforcementPage.tsx        │
│   → tabla denegaciones recientes con filtros                      │
│   → exportación CSV/JSON                                          │
│   → badge de configuración errónea para superadmins              │
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 Decisiones de arquitectura

| Decisión | Elección | Justificación |
|----------|----------|---------------|
| Ubicación del enforcement | Plugin Lua en APISIX, fase `access` | El gateway es el único punto de entrada público; evaluar en el gateway garantiza cero side effects en el backend antes de la decisión |
| Caché de scope requirements | LRU in-process en APISIX (TTL 60 s) + recarga explícita vía admin API | Sub-ms lookup en path crítico; TTL acotado evita stale > 1 min |
| Caché de plan entitlements | Shared dict APISIX `scope_plan_cache` (TTL 30 s) + PostgreSQL fallback | Garantiza propagación de downgrades en ≤ 30 s (FR-012) |
| Workspace isolation | Claim `workspace_id` en JWT vs. workspace en path/body; comparación en plugin | Reutiliza el binding `workspace_sources` ya definido en `authorization-model.json` |
| Fail-closed sin declaración | Plugin devuelve 403 + emite CONFIG_ERROR en Kafka | Cualquier endpoint no declarado es inseguro por definición |
| Publicación de audit events | Fire-and-forget hacia sidecar Kafka publisher (sin bloquear respuesta HTTP) | Auditoría saturada no puede elevar latencia del enforcement (requisito de edge case) |
| Persistencia de denegaciones | Sidecar consumer Kafka → INSERT en `scope_enforcement_denials` (PostgreSQL) | Desacopla write path de audit del gateway; PostgreSQL es el store de query |
| Query de denegaciones | OpenWhisk action `scope-enforcement-audit-query` | Sigue el patrón establecido en acciones existentes de provisioning-orchestrator |
| Header de verificación | `X-Enforcement-Verified: true` inyectado por plugin en peticiones autorizadas | Permite a backends de segunda línea distinguir peticiones evaluadas en gateway |

### 4.3 Flujo de evaluación (secuencia, happy path y denial path)

```
Cliente → APISIX
  │
  ├─1─► Plugin key-auth / jwt-auth verifica token
  │       Si inválido/expirado → HTTP 401 (authentication failure, antes de scope check)
  │
  ├─2─► Plugin scope-enforcement extrae del token:
  │       scopes (claim "scope" o array "scp")
  │       workspace_id (claim "workspace_id")
  │       tenant_id (claim "tenant_id" o "azp" namespace)
  │       plan_id (claim "plan_id" o lookup PostgreSQL por tenant_id)
  │
  ├─3─► Lookup endpoint_scope_requirements para (method, path_pattern):
  │       Caché hit → usa declaración
  │       Caché miss → carga desde ConfigMap / PostgreSQL
  │       No encontrado → DENY + emit CONFIG_ERROR + HTTP 403
  │
  ├─4─► Evaluación de scopes del token:
  │       token_scopes ⊇ required_scopes ? → continua
  │       else → DENY SCOPE_INSUFFICIENT + emit kafka + HTTP 403
  │
  ├─5─► Evaluación de workspace binding:
  │       path_workspace_id == token_workspace_id ? → continua
  │       (superadmin bypass si role == platform_admin)
  │       else → DENY WORKSPACE_SCOPE_MISMATCH + emit kafka + HTTP 403
  │
  ├─6─► Evaluación de plan entitlements:
  │       plan_entitlements(plan_id) ⊇ required_entitlements(endpoint) ? → continua
  │       else → DENY PLAN_ENTITLEMENT_DENIED + emit kafka + HTTP 403
  │
  ├─7─► Inyecta X-Enforcement-Verified: true en headers de upstream
  │
  └─8─► Proxy petición al backend
```

---

## 5. Modelo de datos

### 5.1 Tablas PostgreSQL nuevas

```sql
-- Migración: 093-scope-enforcement.sql

-- Registro inmutable de denegaciones
CREATE TABLE IF NOT EXISTS scope_enforcement_denials (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  workspace_id       UUID,
  actor_id           TEXT NOT NULL,
  actor_type         TEXT NOT NULL CHECK (actor_type IN ('user','service_account','api_key','anonymous')),
  denial_type        TEXT NOT NULL CHECK (denial_type IN (
                       'SCOPE_INSUFFICIENT',
                       'PLAN_ENTITLEMENT_DENIED',
                       'WORKSPACE_SCOPE_MISMATCH',
                       'CONFIG_ERROR'
                     )),
  http_method        TEXT NOT NULL,
  request_path       TEXT NOT NULL,
  required_scopes    TEXT[],
  presented_scopes   TEXT[],
  missing_scopes     TEXT[],
  required_entitlement TEXT,
  current_plan_id    TEXT,
  source_ip          INET,
  correlation_id     TEXT NOT NULL,
  denied_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sed_tenant_denied_at
  ON scope_enforcement_denials (tenant_id, denied_at DESC);

CREATE INDEX IF NOT EXISTS idx_sed_workspace_denied_at
  ON scope_enforcement_denials (workspace_id, denied_at DESC)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sed_denial_type
  ON scope_enforcement_denials (denial_type, denied_at DESC);

CREATE INDEX IF NOT EXISTS idx_sed_actor
  ON scope_enforcement_denials (actor_id, tenant_id, denied_at DESC);

-- Declaración de scopes requeridos por ruta (complementa el ConfigMap YAML)
-- Usada para rutas dinámicas y como fuente de verdad consultable
CREATE TABLE IF NOT EXISTS endpoint_scope_requirements (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  http_method          TEXT NOT NULL,
  path_pattern         TEXT NOT NULL,  -- e.g. /v1/functions/:id/deploy
  required_scopes      TEXT[] NOT NULL,
  required_entitlements TEXT[],        -- entitlements del plan requeridos
  workspace_scoped     BOOLEAN NOT NULL DEFAULT true,
  description          TEXT,
  declared_by          TEXT NOT NULL,  -- 'config' | 'migration' | 'admin'
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (http_method, path_pattern)
);

CREATE INDEX IF NOT EXISTS idx_esr_method_path
  ON endpoint_scope_requirements (http_method, path_pattern);
```

### 5.2 Entities del dominio

| Entidad | Descripción |
|---------|-------------|
| `ScopeEnforcementDenial` | Registro inmutable de cada petición denegada (scope, plan o workspace mismatch) |
| `EndpointScopeRequirement` | Declaración del scope y entitlements requeridos por un endpoint HTTP |
| `TokenScopeSet` | Conjunto de scopes extraídos del JWT del actor (claim `scope`/`scp`) |
| `PlanEntitlementSet` | Conjunto de capabilities incluidas en el plan del tenant (caché + PostgreSQL) |
| `WorkspaceScopeBinding` | Asociación token ↔ workspace: el campo `workspace_id` del JWT |

---

## 6. Contratos y eventos Kafka

### 6.1 Kafka topics nuevos

| Topic | Retención | Descripción |
|-------|-----------|-------------|
| `console.security.scope-denied` | 30 d | Denegación por scope insuficiente |
| `console.security.plan-denied` | 30 d | Denegación por plan entitlement |
| `console.security.workspace-mismatch` | 30 d | Denegación por workspace mismatch |
| `console.security.config-error` | 7 d | Endpoint sin declaración de scope (error de configuración) |

### 6.2 Schema de evento de denegación (Kafka message body)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "ScopeEnforcementDenialEvent",
  "type": "object",
  "required": [
    "event_id", "event_type", "tenant_id", "actor_id", "actor_type",
    "denial_type", "http_method", "request_path",
    "presented_scopes", "source_ip", "correlation_id", "denied_at"
  ],
  "properties": {
    "event_id":            { "type": "string", "format": "uuid" },
    "event_type":          { "type": "string", "enum": [
                               "SCOPE_INSUFFICIENT", "PLAN_ENTITLEMENT_DENIED",
                               "WORKSPACE_SCOPE_MISMATCH", "CONFIG_ERROR"] },
    "tenant_id":           { "type": "string", "format": "uuid" },
    "workspace_id":        { "type": "string", "format": "uuid" },
    "actor_id":            { "type": "string" },
    "actor_type":          { "type": "string" },
    "http_method":         { "type": "string" },
    "request_path":        { "type": "string" },
    "required_scopes":     { "type": "array", "items": { "type": "string" } },
    "presented_scopes":    { "type": "array", "items": { "type": "string" } },
    "missing_scopes":      { "type": "array", "items": { "type": "string" } },
    "required_entitlement":{ "type": "string" },
    "current_plan_id":     { "type": "string" },
    "source_ip":           { "type": "string" },
    "correlation_id":      { "type": "string" },
    "denied_at":           { "type": "string", "format": "date-time" }
  }
}
```

### 6.3 Respuesta HTTP en deny

```json
// HTTP 403 — SCOPE_INSUFFICIENT
{
  "status": 403,
  "code": "SCOPE_INSUFFICIENT",
  "message": "Token scopes do not satisfy the requirements for this resource.",
  "detail": {
    "required_scopes": ["functions:deploy"],
    "presented_scopes": ["storage:read"],
    "missing_scopes": ["functions:deploy"]
  },
  "requestId": "req_xxx",
  "correlationId": "corr_yyy",
  "timestamp": "2026-03-31T00:00:00Z",
  "resource": "/v1/functions/:id/deploy"
}

// HTTP 403 — PLAN_ENTITLEMENT_DENIED
{
  "status": 403,
  "code": "PLAN_ENTITLEMENT_DENIED",
  "message": "Your current plan does not include this capability.",
  "detail": {
    "required_entitlement": "realtime:subscribe",
    "current_plan_id": "plan_starter"
  },
  ...
}

// HTTP 403 — WORKSPACE_SCOPE_MISMATCH
{
  "status": 403,
  "code": "WORKSPACE_SCOPE_MISMATCH",
  "message": "Token is not authorized for the requested workspace.",
  "detail": {
    "token_workspace_id": "ws_aaa",
    "requested_workspace_id": "ws_bbb"
  },
  ...
}
```

### 6.4 API de query de denegaciones

```
GET /api/security/scope-enforcement/denials
  ?tenant_id=<uuid>        (superadmin: opcional; tenant-owner: forzado a su tenant)
  &workspace_id=<uuid>     (opcional)
  &denial_type=SCOPE_INSUFFICIENT|PLAN_ENTITLEMENT_DENIED|WORKSPACE_SCOPE_MISMATCH|CONFIG_ERROR
  &actor_id=<string>       (opcional)
  &from=<ISO8601>          (requerido)
  &to=<ISO8601>            (requerido, máx 30 días de ventana)
  &limit=<int>             (default 100, máx 500)
  &cursor=<opaque>         (paginación keyset)

Response 200:
{
  "denials": [ /* array de ScopeEnforcementDenial */ ],
  "next_cursor": "...",
  "total_in_window": 1234
}
```

---

## 7. Artefactos nuevos y modificados

### 7.1 Documentation (this feature)

```text
specs/093-scope-enforcement-blocking/
├── plan.md              ← este archivo
├── research.md          ← Phase 0 output (inline a continuación)
├── data-model.md        ← Phase 1 output
├── contracts/
│   ├── scope-enforcement-denial-event.schema.json
│   ├── scope-enforcement-denial-query-response.schema.json
│   └── endpoint-scope-requirements.schema.json
└── tasks.md             ← Phase 2 output (/speckit.tasks — no creado aquí)
```

### 7.2 Source Code (repository root)

```text
services/
├── gateway-config/
│   ├── plugins/
│   │   └── scope-enforcement.lua                       [NEW] plugin Lua APISIX
│   ├── openapi-fragments/
│   │   └── scope-enforcement.yaml                      [NEW] declaración de scopes por ruta
│   └── base/
│       └── public-api-routing.yaml                     [EXTEND] referencia al plugin
│
├── provisioning-orchestrator/
│   └── src/
│       ├── migrations/
│       │   └── 093-scope-enforcement.sql               [NEW] tablas PG
│       ├── models/
│       │   └── scope-enforcement-denial.mjs            [NEW] entity model
│       ├── repositories/
│       │   └── scope-enforcement-repo.mjs              [NEW] queries PG
│       ├── events/
│       │   └── scope-enforcement-events.mjs            [NEW] Kafka publishers
│       └── actions/
│           ├── scope-enforcement-audit-query.mjs        [NEW] query action
│           └── scope-enforcement-event-recorder.mjs     [NEW] Kafka consumer→PG
│
├── internal-contracts/
│   └── src/
│       ├── scope-enforcement-denial-event.json         [NEW] Kafka event schema
│       ├── scope-enforcement-denial-query-response.json [NEW] query response schema
│       └── index.mjs                                   [EXTEND] exporta nuevos schemas
│
└── audit/
    └── scope-enforcement-denial-audit-surface.json     [NEW] audit surface declaration

apps/
└── web-console/
    └── src/
        ├── pages/
        │   ├── ConsoleScopeEnforcementPage.tsx         [NEW] denial audit page
        │   └── ConsoleScopeEnforcementPage.test.tsx    [NEW]
        ├── components/console/
        │   ├── ScopeEnforcementDenialsTable.tsx        [NEW] tabla con filtros
        │   └── ScopeEnforcementDenialsTable.test.tsx   [NEW]
        └── lib/
            └── console-scope-enforcement.ts            [NEW] API client helper

tests/
└── scope-enforcement/
    ├── plugin.integration.test.mjs                     [NEW] test end-to-end plugin
    └── audit-query.integration.test.mjs               [NEW] test query action
```

---

## 8. Plugin APISIX `scope-enforcement.lua` — diseño

### 8.1 Estructura del plugin

```lua
-- services/gateway-config/plugins/scope-enforcement.lua

local plugin_name = "scope-enforcement"
local schema = { ... }  -- configuración por ruta: required_scopes, required_entitlements, workspace_scoped

function _M.access(conf, ctx)
  -- 1. Obtener token claims del contexto (ya verificados por key-auth/jwt-auth)
  local claims = get_token_claims(ctx)
  if not claims then return deny(401, "UNAUTHENTICATED") end

  -- 2. Obtener scopes requeridos (caché LRU in-process o conf local)
  local req = get_endpoint_requirements(conf, ctx)
  if not req then
    emit_config_error(ctx, claims)
    return deny(403, "CONFIG_ERROR", "Endpoint scope requirements not declared")
  end

  -- 3. Evaluar token scopes
  local missing = compute_missing_scopes(claims.scopes, req.required_scopes)
  if #missing > 0 then
    emit_denial_event("SCOPE_INSUFFICIENT", ctx, claims, req, missing)
    return deny(403, "SCOPE_INSUFFICIENT", missing)
  end

  -- 4. Evaluar workspace binding (si endpoint es workspace_scoped)
  if req.workspace_scoped then
    local path_ws = extract_workspace_id_from_path(ctx)
    if path_ws and path_ws ~= claims.workspace_id and not is_platform_admin(claims) then
      emit_denial_event("WORKSPACE_SCOPE_MISMATCH", ctx, claims, req, nil)
      return deny(403, "WORKSPACE_SCOPE_MISMATCH")
    end
  end

  -- 5. Evaluar plan entitlements
  if req.required_entitlements and #req.required_entitlements > 0 then
    local plan_ents = get_plan_entitlements(claims.tenant_id, claims.plan_id)
    local missing_ent = compute_missing_entitlements(plan_ents, req.required_entitlements)
    if #missing_ent > 0 then
      emit_denial_event("PLAN_ENTITLEMENT_DENIED", ctx, claims, req, missing_ent)
      return deny(403, "PLAN_ENTITLEMENT_DENIED", missing_ent[1])
    end
  end

  -- 6. Petición autorizada: inyectar header downstream
  ngx.req.set_header("X-Enforcement-Verified", "true")
  ngx.req.set_header("X-Verified-Tenant-Id", claims.tenant_id)
  ngx.req.set_header("X-Verified-Workspace-Id", claims.workspace_id or "")
end
```

### 8.2 Manejo de caché

- **Scope requirements**: LRU local en cada worker APISIX, TTL 60 s, invalidado con `POST /apisix/admin/plugins/reload`.
- **Plan entitlements**: `ngx.shared.scope_plan_cache` (shared dict, configurable 10 MB), TTL 30 s. Fallback a PostgreSQL mediante llamada HTTP interna al control-plane.
- **Race condition en plan downgrade**: El tenant ve el acceso denegado dentro del TTL de 30 s del caché. Documentado como ventana de propagación aceptable (FR-012).

---

## 9. Estrategia de pruebas

### 9.1 Unitarias (plugin Lua — busted)

- `describe("scope-enforcement")` con casos: scopes suficientes, insuficientes, vacíos, irreconocidos, workspace match/mismatch, plan granted/denied, endpoint sin declaración (fail-closed), token expirado (pre-evaluado por plugin anterior).
- Mock de `ngx.shared`, `kong.request`, y Kafka emit.

### 9.2 Unitarias (acciones Node — node:test)

- `scope-enforcement-audit-query.mjs`: cobertura de filtros, paginación keyset, aislamiento tenant (tenant-owner vs. superadmin), validación de rango máx 30 días.
- `scope-enforcement-event-recorder.mjs`: idempotencia de INSERT (conflict on `correlation_id`+`denied_at`), manejo de campos opcionales.

### 9.3 Integración (node:test sobre stack real)

- `plugin.integration.test.mjs`: Levanta APISIX mock + PostgreSQL; valida que cada tipo de denegación retorna el HTTP correcto, emite el evento Kafka y persiste en PG.
- `audit-query.integration.test.mjs`: Inserta denegaciones sintéticas, llama al action, verifica filtros y paginación.

### 9.4 Contrato

- Schema validation en CI: `scope-enforcement-denial-event.schema.json` vs. mensajes Kafka reales usando el harness de contrato existente en `services/internal-contracts`.

### 9.5 E2E (operativo)

- Test de smoke en Helm chart: deploy plugin → emitir petición fuera de scope → verificar 403 + evento en Kafka + registro en PG.
- Incluido como validación en `tests/scope-enforcement/plugin.integration.test.mjs` con tag `@e2e`.

---

## 10. Variables de entorno nuevas

| Variable | Descripción | Default |
|----------|-------------|---------|
| `SCOPE_ENFORCEMENT_PLAN_CACHE_TTL_SECONDS` | TTL del caché de plan entitlements en APISIX | `30` |
| `SCOPE_ENFORCEMENT_REQUIREMENTS_CACHE_TTL_SECONDS` | TTL del caché de scope requirements en APISIX | `60` |
| `SCOPE_ENFORCEMENT_AUDIT_QUERY_MAX_DAYS` | Ventana máxima de consulta en días | `30` |
| `SCOPE_ENFORCEMENT_KAFKA_TOPIC_SCOPE_DENIED` | Topic Kafka para denegaciones de scope | `console.security.scope-denied` |
| `SCOPE_ENFORCEMENT_KAFKA_TOPIC_PLAN_DENIED` | Topic Kafka para denegaciones de plan | `console.security.plan-denied` |
| `SCOPE_ENFORCEMENT_KAFKA_TOPIC_WORKSPACE_MISMATCH` | Topic Kafka para workspace mismatch | `console.security.workspace-mismatch` |
| `SCOPE_ENFORCEMENT_KAFKA_TOPIC_CONFIG_ERROR` | Topic Kafka para errores de configuración | `console.security.config-error` |

---

## 11. Riesgos, compatibilidad y rollback

### 11.1 Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Plugin Lua introduce latencia en path crítico | Media | Alto | Benchmarks con `wrk` antes de merge; target p95 < 5 ms |
| Caché stale de plan entitlements bloquea tenant recién upgradado | Baja | Medio | TTL 30 s + admin API para invalidación manual |
| Fallo del publisher Kafka en burst de denegaciones | Media | Medio | Buffer local en shared dict; drop con log de métrica si buffer lleno (enforcement no se ve afectado) |
| Endpoints sin declaración de scope en migración inicial | Alta | Alto | Script de auditoría previo al deploy que lista rutas sin cobertura; deploy bloqueado si hay rutas críticas sin declarar |
| Falsos positivos en workspace mismatch para tokens de plataforma | Media | Alto | Bypass explícito para `role == platform_admin`; tests de regresión cubriendo service accounts cross-workspace |

### 11.2 Compatibilidad

- El plugin se activa únicamente en rutas declaradas; rutas no migradas (internas, legacy) no se ven afectadas.
- El header `X-Enforcement-Verified` es aditivo; backends que no lo leen no se ven afectados.
- Las tablas PostgreSQL son aditivas (no modifica tablas existentes).

### 11.3 Rollback

- Plugin APISIX: se deshabilita vía ConfigMap update sin reinicio de pods (`apisix/admin/plugins/reload`).
- Migration PostgreSQL: las tablas son nuevas; rollback elimina `scope_enforcement_denials` y `endpoint_scope_requirements`.
- Feature flag en Helm values: `scopeEnforcement.enabled: false` deshabilita el plugin en todos los ingress.

### 11.4 Idempotencia

- `scope-enforcement-event-recorder.mjs`: INSERT con `ON CONFLICT (correlation_id, denied_at) DO NOTHING` para garantizar idempotencia ante redelivery Kafka.
- `endpoint_scope_requirements`: `UNIQUE (http_method, path_pattern)` + `INSERT ... ON CONFLICT DO UPDATE` para migraciones re-ejecutadas.

### 11.5 Observabilidad

- Métrica APISIX: `scope_enforcement_denials_total{type="...", tenant="..."}` (contador Prometheus via plugin `prometheus`).
- Dashboard Grafana: panel de denegaciones por tipo, tenant, endpoint, rate/min.
- Alerta: tasa de `CONFIG_ERROR` > 0 en 5 min → PagerDuty (endpoint sin declaración en producción es P1).

---

## 12. Secuencia de implementación

```
Fase 1 — Datos y contratos (prerequisito)
  1a. Migración PostgreSQL 093-scope-enforcement.sql
  1b. Schemas JSON en services/internal-contracts/src/
  1c. scope-enforcement-denial-event.schema.json
  1d. Actualizar services/internal-contracts/src/index.mjs

Fase 2 — Plugin APISIX (núcleo del enforcement)
  2a. scope-enforcement.lua con evaluación de scope + workspace + plan
  2b. scope-enforcement.yaml (declaración de scopes por ruta para rutas existentes)
  2c. Tests unitarios busted
  2d. Integrar en public-api-routing.yaml (habilitado con feature flag off)

Fase 3 — Backend de auditoría
  3a. scope-enforcement-repo.mjs (queries PostgreSQL)
  3b. scope-enforcement-events.mjs (publishers Kafka)
  3c. scope-enforcement-event-recorder.mjs (consumer Kafka → PG)
  3d. scope-enforcement-audit-query.mjs (action de query)
  3e. Tests unitarios node:test

Fase 4 — Consola
  4a. ConsoleScopeEnforcementPage.tsx + ScopeEnforcementDenialsTable.tsx
  4b. console-scope-enforcement.ts (API client)
  4c. Tests Vitest

Fase 5 — Activación progresiva
  5a. Habilitar plugin en rutas no críticas (read-only endpoints)
  5b. Monitorear métricas y audit log
  5c. Habilitar en rutas de escritura/admin
  5d. Remover feature flag (enforcement siempre on)

Fase 6 — Documentación
  6a. ADR en docs/adr/093-scope-enforcement-blocking.md
  6b. Actualizar AGENTS.md con nuevas tablas, topics y env vars
```

### Paralelización posible

- Fases 1 y parte de 2 son independientes; la fase 3 requiere que existan los schemas del paso 1.
- Fase 4 puede desarrollarse en paralelo con fases 2 y 3 usando datos mock.

---

## 13. Criterios de done verificables

| ID | Criterio | Evidencia esperada |
|----|----------|--------------------|
| DON-01 | Plugin bloquea 100% de peticiones con scope insuficiente antes de llegar al backend | Test de integración: backend mock no recibe ninguna petición denegada |
| DON-02 | Plugin bloquea peticiones para entitlements no incluidos en el plan | Test con tenant en plan "Starter" intentando usar `realtime:subscribe` → HTTP 403 PLAN_ENTITLEMENT_DENIED |
| DON-03 | Plugin bloquea tokens de workspace A sobre recursos de workspace B | Test con token ws_A + request a /v1/workspaces/ws_B/... → HTTP 403 WORKSPACE_SCOPE_MISMATCH |
| DON-04 | Endpoint sin declaración retorna 403 + emite CONFIG_ERROR | Test: ruta sin entrada en `endpoint_scope_requirements` → 403 CONFIG_ERROR + evento Kafka |
| DON-05 | Cada denegación genera evento Kafka queryable en ≤ 5 s | Test: trigger denial + Kafka consumer delay < 5 s + PG record presente |
| DON-06 | Superadmin obtiene denegaciones de todos los tenants con filtros correctos | Test: denegaciones de 2 tenants distintos; superadmin ve las 2; tenant-owner ve solo las suyas |
| DON-07 | Downgraded tenant denegado dentro de 30 s | Test: cambio de plan simulado + request dentro de 30 s → 403 PLAN_ENTITLEMENT_DENIED |
| DON-08 | Upgraded tenant obtiene acceso una vez propagado el cambio | Test: upgrade + request tras TTL → 200 OK |
| DON-09 | Latencia p95 del plugin < 5 ms en test de carga (1000 req/s) | Benchmark `wrk` con resultados en PR description |
| DON-10 | Rollback funcional: feature flag off deshabilita enforcement sin downtime | Deploy con `scopeEnforcement.enabled: false` → rutas funcionan; plugin ignorado |
| DON-11 | Todas las variables de entorno nuevas documentadas en AGENTS.md | PR incluye actualización de AGENTS.md |
| DON-12 | ADR documentado en docs/adr/ | Archivo `093-scope-enforcement-blocking.md` presente y aprobado en PR |

---

## 14. Research (Phase 0 — inline)

### APISIX Plugin Lua — decisiones

**Decisión**: Plugin Lua nativo APISIX en lugar de external auth service  
**Rationale**: La evaluación en el plugin evita un round-trip de red adicional (2–10 ms); con caché LRU in-process el costo marginal es sub-ms. Un external auth service añadiría un SPOF y latencia.  
**Alternativas consideradas**: OPA (Open Policy Agent) sidecar — descartado por latencia de red y complejidad operativa para un enforcement relativamente simple de subset check.

### Plan entitlements — fuente de verdad

**Decisión**: PostgreSQL como fuente de verdad, caché in-process APISIX con TTL 30 s  
**Rationale**: La tabla de entitlements del plan del tenant ya existe (patrón establecido en `090-workspace-capability-catalog`). El plugin Lua hace una llamada HTTP al control-plane para el primer lookup; el shared dict `scope_plan_cache` sirve el resto.  
**Alternativas consideradas**: Keycloak custom attribute — descartado porque mezcla preocupaciones de IAM con lógica de plan de negocio.

### Workspace isolation — claim vs. header

**Decisión**: Claim `workspace_id` en el JWT como fuente primaria; `x-workspace-id` header como fallback para service accounts sin JWT  
**Rationale**: Consistente con `authorization-model.json` (`workspace_sources: ["session", "header:x-workspace-id"]`). El claim del JWT no puede ser manipulado por el cliente.  
**Alternativas consideradas**: Solo header — descartado porque cualquier cliente puede falsificar el header si no hay validación en el token.

### Audit write path — sin bloquear enforcement

**Decisión**: Fire-and-forget hacia Kafka con buffer local; consumer asíncrono escribe en PostgreSQL  
**Rationale**: El edge case del spec exige que enforcement no se degrade si el sistema de auditoría está saturado. El buffer local en `ngx.shared` absorbe bursts hasta que Kafka es alcanzable.  
**Alternativas consideradas**: Write directo a PostgreSQL desde el plugin — descartado porque TCP synchronous write desde Lua bloquearía el worker OpenResty.
