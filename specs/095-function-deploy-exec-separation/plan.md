<!-- markdownlint-disable MD031 MD040 -->
# Plan técnico de implementación — US-SEC-02-T05

**Feature Branch**: `095-function-deploy-exec-separation`  
**Task ID**: US-SEC-02-T05  
**Epic**: EP-18 — Seguridad funcional transversal  
**Historia padre**: US-SEC-02 — Gestión segura de secretos, rotación, enforcement de scope y separación de privilegios  
**Fecha del plan**: 2026-03-31  
**Estado**: Ready for tasks  
**Dependencias directas**: US-SEC-02-T01 (`091-secure-secret-storage`), US-SEC-02-T02 (`092-secret-rotation-no-redeploy`), US-SEC-02-T03 (`093-scope-enforcement-blocking`), US-SEC-02-T04 (`094-admin-data-privilege-separation`)  
**Requisitos funcionales**: RF-SEC-010, RF-SEC-011

---

## 1. Objetivo y alcance estricto de T05

Implementar la **separación de permisos entre despliegue de funciones y ejecución de funciones** sobre la base ya establecida en T04, incluyendo:

- Definición canónica de dos sub-dominios funcionales: **`function_deployment`** y **`function_invocation`**.
- Clasificación de todas las operaciones relacionadas con funciones en exactamente uno de esos dos sub-dominios.
- Extensión del enforcement existente en APISIX (`scope-enforcement`) para validar el sub-dominio requerido por cada endpoint/operación de funciones, además del dominio superior heredado de T04.
- Persistencia de asignaciones de privilegio de funciones por miembro de workspace y por service account.
- Extensión del flujo de creación/rotación de API keys para permitir scopes de funciones separados (`deploy`, `invoke`) siempre subordinados al dominio superior correspondiente.
- Actualización del control plane y de las acciones OpenWhisk para distinguir operaciones de despliegue (alta, actualización, borrado, configuración, triggers) de operaciones de invocación (invoke, activations/resultados).
- Validación de identidades runtime asociadas a triggers para impedir que un trigger configurado con credencial de solo despliegue pueda ejecutar funciones.
- Registro de eventos de auditoría diferenciando **deploy denied to invoker** de **invoke denied to deployer**, con superficie de consulta y filtros dedicados.
- Extensión de la consola para que tenant owners administren y revisen privilegios de funciones de manera independiente.
- Migración compatible hacia el nuevo modelo, asignando por defecto ambos sub-dominios a quienes ya tenían acceso funcional antes de activar la feature.

### Fuera de alcance de T05

- Almacenamiento de secretos y credenciales (T01).
- Rotación segura de secretos sin reinstalación completa (T02).
- Enforcement genérico de scope/token/membership fuera del ámbito de funciones (T03).
- Separación top-level entre `structural_admin` y `data_access` (T04).
- Suite de hardening/penetration testing específica (T06).
- Permisos por función individual (por ejemplo, desplegar solo la función `foo`).
- Firma de código, integridad de artefactos o aislamiento de runtimes más allá del RBAC funcional.

---

## 2. Technical Context

**Language/Version**: Node.js 20+ ESM (`"type": "module"`, pnpm workspaces); Lua 5.1 (plugin APISIX / OpenResty); React 18 + TypeScript para consola  
**Primary Dependencies**: `pg`, `kafkajs`, patrones OpenWhisk existentes en `services/provisioning-orchestrator/src/actions/`, APISIX plugin API, Keycloak admin API, React + Tailwind CSS + shadcn/ui  
**Storage**: PostgreSQL (asignaciones funcionales, auditoría de denegaciones, extensión de API keys y catálogo de requisitos), Keycloak realm/client roles, caché in-memory APISIX  
**Testing**: `node:test` (backend / actions / repositorios), Vitest + React Testing Library (consola), `busted` (plugin Lua), validaciones de contratos/OpenAPI  
**Target Platform**: Kubernetes / OpenShift, multi-tenant BaaS, OpenWhisk como compute serverless  
**Project Type**: Monorepo multi-servicio (gateway-config + provisioning-orchestrator + control-plane + web-console + internal-contracts)  
**Performance Goals**: evaluación de sub-dominio funcional p95 < 3 ms sobre caché APISIX; propagación de cambios ≤ 60 s; query de denegaciones < 300 ms por 30 días; warning de trigger inválido en tiempo de configuración < 1 s  
**Constraints**: fail-closed por defecto, separación estricta entre top-level domains y function sub-domains, multi-tenancy y workspace isolation, preservación backward-compatible mediante migración dual-privilege, sin acceso implícito por “tener deploy” o “tener invoke”  
**Scale/Scope**: todos los endpoints públicos y administrativos de funciones, todos los triggers configurables, todos los miembros/service accounts con acceso funcional y todas las API keys funcionales existentes

---

## 3. Constitution Check

| Principio | Estado | Notas |
|-----------|--------|-------|
| I. Monorepo Separation of Concerns | ✅ PASS | La extensión del enforcement se mantiene en `services/gateway-config/plugins/`; la lógica de asignación/auditoría en `services/provisioning-orchestrator/src/`; la UI en `apps/web-console/src/`; contratos en `services/internal-contracts/src/`; OpenAPI/route catalog en los artefactos ya existentes del control plane. |
| II. Incremental Delivery First | ✅ PASS | Secuencia clara: modelo de datos y clasificación → enforcement gateway/control-plane → migración API keys y members → UI → rollout gradual. |
| III. Kubernetes / OpenShift Compatibility | ✅ PASS | Sin supuestos de host local; cambios desplegables vía Helm/ConfigMap/job de migración y compatibles con el patrón actual de APISIX/OpenWhisk/Keycloak. |
| IV. Quality Gates at Root | ✅ PASS | Las pruebas caben en suites ya presentes (`node:test`, Vitest, `busted`, validaciones OpenAPI/contratos). |
| V. Documentation as Part of the Change | ✅ PASS | Este plan + contratos + data model + ADR/documentación de operación forman parte del cambio. |
| Security by Default | ✅ PASS | El enforcement es fail-closed, los triggers se validan antes de permitir configuración efectiva y toda denegación queda auditada. |
| Backward Compatibility During Rollout | ✅ PASS | La migración preserva acceso existente asignando ambos sub-dominios inicialmente y notificando revisión posterior. |

*Sin violaciones detectadas. No se requiere tabla de complejidad adicional.*

---

## 4. Arquitectura objetivo

### 4.1 Modelo conceptual de privilegios funcionales

```text
Top-level domains (T04)
├── structural_admin
│   └── function_deployment
│       ├── function:create
│       ├── function:update
│       ├── function:delete
│       ├── function:config:write
│       ├── function:package:upload
│       ├── function:trigger:create
│       ├── function:trigger:update
│       ├── function:trigger:delete
│       └── function:version:manage
│
└── data_access
    └── function_invocation
        ├── function:invoke
        ├── function:activation:read
        ├── function:result:read
        └── trigger:runtime:execute
```

**Regla principal**: el sub-dominio funcional **no sustituye** al dominio superior. Para desplegar funciones se requieren simultáneamente `structural_admin` + `function_deployment`. Para invocar funciones se requieren simultáneamente `data_access` + `function_invocation`.

### 4.2 Diagrama de componentes

```text
Cliente / CI service account / runtime service account / API key
  │
  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ APISIX (services/gateway-config/)                                          │
│                                                                             │
│  Plugin key-auth / jwt-auth                                                 │
│    └─ autentica token o API key                                             │
│                                                                             │
│  Plugin scope-enforcement (extendido en T05)                                │
│    ├─ reutiliza dominio superior T04                                        │
│    ├─ extrae function_subdomain claim/scope (`function_deployment` /        │
│    │  `function_invocation`)                                                │
│    ├─ consulta catálogo de requisitos por endpoint de funciones             │
│    ├─ evalúa top-level domain + function sub-domain                         │
│    ├─ si mismatch → HTTP 403 + evento Kafka + auditoría                     │
│    └─ inyecta `X-Privilege-Domain` y `X-Function-Privilege-Subdomain`       │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │ request permitida
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Control plane / provisioning-orchestrator / OpenWhisk admin adapters       │
│                                                                             │
│  Deploy path                                                                │
│    ├─ create/update/delete functions, packages, triggers                    │
│    └─ revalida sub-domain en segunda línea antes de llamar a OpenWhisk      │
│                                                                             │
│  Invoke path                                                                │
│    ├─ invoke sync/async                                                     │
│    ├─ consulta activations/resultados                                       │
│    └─ revalida sub-domain antes de exponer resultados                       │
└────────────────────────────┬────────────────────────────────────────────────┘
                             │
                             ├───────────────► Keycloak
                             │                 ├─ roles / claims de sub-dominios funcionales
                             │                 └─ invalidación de sesiones y sync de members
                             │
                             ├───────────────► PostgreSQL
                             │                 ├─ function_privilege_assignments
                             │                 ├─ function_privilege_denials
                             │                 └─ api_keys.function_privileges / endpoint requirements
                             │
                             └───────────────► Kafka
                                               ├─ function privilege denied
                                               ├─ function privilege assignment changed
                                               └─ function privilege migration review notice
```

### 4.3 Decisiones de arquitectura

| Decisión | Elección | Justificación |
|----------|----------|---------------|
| Representación del sub-dominio funcional | Conjunto explícito de flags/claims `function_deployment` y `function_invocation` | Refleja el modelo del spec: un actor puede tener uno, ambos o ninguno. |
| Relación con T04 | T05 se implementa como refinamiento del dominio superior, no como dominio paralelo | Evita inconsistencias donde un actor tenga `function_deployment` pero no `structural_admin`, o viceversa. |
| Punto principal de enforcement | Extender `scope-enforcement.lua` y revalidar en backend | El gateway bloquea por defecto; la segunda línea protege contra bypass interno o misconfiguración accidental. |
| Catálogo de requisitos funcionales | Extender la fuente canónica de requisitos por endpoint con `function_privilege_subdomain` | Permite cobertura exhaustiva y validación automatizable sobre todas las rutas de funciones. |
| Roles en Keycloak | Roles/claims por workspace para `function_deployment` y `function_invocation` | Consistente con el modelo per-workspace y con propagación existente. |
| Persistencia de members | Nueva tabla específica de asignaciones funcionales, separada de la top-level assignment de T04 | Permite refinar privilegios de funciones sin mezclar la semántica del dominio superior. |
| API keys | Almacenamiento explícito de sub-dominios funcionales como conjunto permitido | Soporta deploy-only, invoke-only o ambos, manteniendo el outer boundary del dominio superior. |
| Triggers | Validación preventiva en create/update + enforcement en runtime path | Cubre el edge case más sensible: trigger con identidad incorrecta. |
| Migración | Asignar ambos sub-dominios a actores con acceso funcional legacy y emitir notificación de revisión | Garantiza cero disrupción y habilita endurecimiento progresivo. |

### 4.4 Flujo de evaluación del sub-dominio funcional

```text
1. Cliente presenta JWT o API key.
2. APISIX autentica y extrae:
   - tenant_id / workspace_id
   - privilege_domain (T04)
   - function privilege claims/scopes
3. APISIX resuelve el endpoint solicitado:
   - required top-level domain
   - required function sub-domain (si aplica a funciones)
4. APISIX evalúa:
   - top-level domain correcto
   - function sub-domain correcto
5. Si falla:
   - retorna 403 con código específico
   - emite evento Kafka
   - persiste auditoría asíncrona
6. Si pasa:
   - inyecta cabeceras verificadas al backend
7. Backend/control-plane revalida antes de llamar a OpenWhisk u operar sobre activations.
8. Para create/update trigger:
   - se valida que la identidad runtime tenga `function_invocation`
   - si no lo tiene, se bloquea o se advierte según el modo configurado.
```

---

## 5. Modelo de datos

### 5.1 Nuevas tablas PostgreSQL

```sql
-- Migración: 095-function-deploy-exec-separation.sql

CREATE TABLE IF NOT EXISTS function_privilege_assignments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL,
  workspace_id          UUID NOT NULL,
  member_id             UUID NOT NULL,
  function_deployment   BOOLEAN NOT NULL DEFAULT false,
  function_invocation   BOOLEAN NOT NULL DEFAULT false,
  assigned_by           UUID NOT NULL,
  assigned_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, workspace_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_fpa_workspace_member
  ON function_privilege_assignments (workspace_id, member_id);

CREATE INDEX IF NOT EXISTS idx_fpa_workspace_deploy
  ON function_privilege_assignments (workspace_id)
  WHERE function_deployment = true;

CREATE INDEX IF NOT EXISTS idx_fpa_workspace_invoke
  ON function_privilege_assignments (workspace_id)
  WHERE function_invocation = true;

CREATE TABLE IF NOT EXISTS function_privilege_denials (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL,
  workspace_id            UUID,
  actor_id                TEXT NOT NULL,
  actor_type              TEXT NOT NULL CHECK (actor_type IN ('user','service_account','api_key','trigger_identity','anonymous')),
  attempted_operation     TEXT NOT NULL CHECK (attempted_operation IN (
                           'function_deploy','function_update','function_delete',
                           'trigger_create','trigger_update','trigger_delete',
                           'function_invoke','activation_read','result_read'
                         )),
  required_subdomain      TEXT NOT NULL CHECK (required_subdomain IN ('function_deployment','function_invocation')),
  presented_subdomains    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  top_level_domain        TEXT,
  request_path            TEXT NOT NULL,
  http_method             TEXT NOT NULL,
  target_function_id      TEXT,
  correlation_id          TEXT NOT NULL,
  denied_reason           TEXT NOT NULL,
  source_ip               INET,
  denied_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fpd_tenant_denied_at
  ON function_privilege_denials (tenant_id, denied_at DESC);

CREATE INDEX IF NOT EXISTS idx_fpd_workspace_denied_at
  ON function_privilege_denials (workspace_id, denied_at DESC)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fpd_required_subdomain
  ON function_privilege_denials (required_subdomain, denied_at DESC);

CREATE TABLE IF NOT EXISTS function_privilege_assignment_history (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id         UUID NOT NULL,
  tenant_id             UUID NOT NULL,
  workspace_id          UUID NOT NULL,
  member_id             UUID NOT NULL,
  privilege_subdomain   TEXT NOT NULL CHECK (privilege_subdomain IN ('function_deployment','function_invocation')),
  change_type           TEXT NOT NULL CHECK (change_type IN ('assigned','revoked','migrated','system')),
  changed_by            UUID NOT NULL,
  changed_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  correlation_id        TEXT
);
```

### 5.2 Extensiones de tablas existentes

```sql
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS function_privileges TEXT[]
    DEFAULT ARRAY[]::TEXT[];

ALTER TABLE endpoint_scope_requirements
  ADD COLUMN IF NOT EXISTS function_privilege_subdomain TEXT
    CHECK (function_privilege_subdomain IN ('function_deployment','function_invocation'));
```

### 5.3 Entidades del dominio

| Entidad | Descripción |
|---------|-------------|
| `FunctionPrivilegeAssignment` | Asociación per-workspace de un miembro/service account con `function_deployment` y/o `function_invocation`. |
| `FunctionPrivilegeDenialEvent` | Registro inmutable de denegaciones en la frontera deploy/invoke. |
| `ApiKeyFunctionScope` | Atributo de una API key que restringe sus capacidades funcionales dentro del dominio superior permitido. |
| `FunctionTriggerRuntimeIdentity` | Identidad/credencial con la que un trigger ejecuta funciones y que debe poseer `function_invocation`. |
| `FunctionEndpointRequirement` | Requisito canónico por endpoint/operación de funciones respecto a dominio superior y sub-dominio funcional. |

### 5.4 Clasificación inicial de operaciones

```text
function_deployment
  POST   /v1/functions
  PUT    /v1/functions/:id
  DELETE /v1/functions/:id
  POST   /v1/functions/:id/versions
  PUT    /v1/functions/:id/config
  POST   /v1/functions/:id/triggers
  PUT    /v1/functions/:id/triggers/:triggerId
  DELETE /v1/functions/:id/triggers/:triggerId
  POST   /v1/functions/:id/packages

function_invocation
  POST   /v1/functions/:id/invoke
  POST   /v1/functions/:id/invoke-async
  GET    /v1/functions/:id/activations
  GET    /v1/functions/:id/activations/:activationId
  GET    /v1/functions/:id/results/:activationId
```

La clasificación se almacena junto al catálogo actual de rutas públicas/endpoint requirements para permitir validación de cobertura en CI.

---

## 6. Contratos de API y eventos

### 6.1 Endpoints de asignación de privilegios funcionales

#### GET `/api/workspaces/:workspaceId/members/:memberId/function-privileges`

```json
{
  "memberId": "uuid",
  "workspaceId": "uuid",
  "tenantId": "uuid",
  "functionDeployment": true,
  "functionInvocation": false,
  "assignedAt": "2026-03-31T00:00:00Z",
  "updatedAt": "2026-03-31T00:00:00Z"
}
```

#### PUT `/api/workspaces/:workspaceId/members/:memberId/function-privileges`

```json
{
  "functionDeployment": true,
  "functionInvocation": false
}
```

Respuestas esperadas:

- `200 OK` — actualización exitosa.
- `400 INVALID_FUNCTION_PRIVILEGE_COMBINATION` — intento incompatible con el dominio superior ya asignado en T04.
- `403 FORBIDDEN` — actor sin privilegios para administrar permisos funcionales.
- `409 CONFLICT` — cambio concurrente.

### 6.2 Endpoint de auditoría

#### GET `/api/security/function-privileges/denials`

Query params: `tenantId`, `workspaceId`, `requiredSubdomain`, `attemptedOperation`, `actorId`, `from`, `to`, `limit`, `offset`

```json
{
  "denials": [
    {
      "id": "uuid",
      "tenantId": "uuid",
      "workspaceId": "uuid",
      "actorId": "svc-ci",
      "actorType": "service_account",
      "attemptedOperation": "function_invoke",
      "requiredSubdomain": "function_invocation",
      "presentedSubdomains": ["function_deployment"],
      "topLevelDomain": "structural_admin",
      "requestPath": "/v1/functions/fn-1/invoke",
      "targetFunctionId": "fn-1",
      "correlationId": "corr-123",
      "deniedReason": "FUNCTION_PRIVILEGE_MISMATCH",
      "deniedAt": "2026-03-31T00:00:00Z"
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0
}
```

### 6.3 API key creation/update contract

La creación de API keys debe aceptar explícitamente los privilegios funcionales permitidos, compatibles con el dominio superior:

```json
{
  "name": "ci-function-deployer",
  "topLevelPrivilegeDomain": "structural_admin",
  "functionPrivileges": ["function_deployment"]
}
```

Reglas:

- `function_deployment` solo permitido si `topLevelPrivilegeDomain = structural_admin`.
- `function_invocation` solo permitido si `topLevelPrivilegeDomain = data_access`.
- Si el actor tiene ambos dominios superiores y el modelo de keys existente lo soporta, se permite `["function_deployment", "function_invocation"]`; en caso contrario, se crean dos keys distintas y el contrato debe rechazar mezcla incompatible.

### 6.4 Eventos Kafka

```jsonc
// console.security.function-privilege-denied
{
  "eventType": "function_privilege_denied",
  "tenantId": "uuid",
  "workspaceId": "uuid",
  "actorId": "svc-ci",
  "actorType": "service_account",
  "attemptedOperation": "function_invoke",
  "requiredSubdomain": "function_invocation",
  "presentedSubdomains": ["function_deployment"],
  "topLevelDomain": "structural_admin",
  "requestPath": "/v1/functions/fn-1/invoke",
  "targetFunctionId": "fn-1",
  "correlationId": "corr-123",
  "occurredAt": "2026-03-31T00:00:00Z"
}

// console.security.function-privilege-assigned
{
  "eventType": "function_privilege_assigned",
  "tenantId": "uuid",
  "workspaceId": "uuid",
  "memberId": "uuid",
  "privilegeSubdomain": "function_deployment",
  "assignedBy": "uuid",
  "occurredAt": "2026-03-31T00:00:00Z"
}

// console.security.function-privilege-review-notice
{
  "eventType": "function_privilege_review_notice",
  "tenantId": "uuid",
  "workspaceId": "uuid",
  "memberId": "uuid",
  "source": "migration",
  "occurredAt": "2026-03-31T00:00:00Z"
}
```

---

## 7. Artefactos impactados por componente

### `services/gateway-config/`

- **`plugins/scope-enforcement.lua`** — extender evaluación para `function_privilege_subdomain`, mensajes 403 específicos y cabecera `X-Function-Privilege-Subdomain`.
- **`public-route-catalog.json`** o catálogo equivalente — añadir clasificación funcional a todas las rutas de funciones.
- **`openapi` / fragmentos de políticas** — reflejar el sub-dominio requerido cuando aplique a endpoints de funciones.
- **tests Lua** — nuevos casos para deploy-only, invoke-only, dual-role, trigger runtime identity y rutas sin clasificación funcional.

### `services/provisioning-orchestrator/src/`

- **`migrations/095-function-deploy-exec-separation.sql`** — DDL de asignaciones/auditoría/extensiones.
- **`actions/function-privilege-assign.mjs`** — CRUD/actualización de asignaciones funcionales por miembro.
- **`actions/function-privilege-query.mjs`** — lectura/listado por workspace para consola.
- **`actions/function-privilege-audit-query.mjs`** — consulta de denegaciones filtrables.
- **`actions/function-api-key-migration.mjs`** — migración de keys funcionales legacy a dual-privilege por compatibilidad.
- **`actions/function-trigger-validate-runtime.mjs`** o extensión equivalente — validación de identidad runtime al crear/editar triggers.
- **repositorios/models/events** asociados a privilegios funcionales y denegaciones.
- **tests** para asignación, migración, validación de triggers y query de auditoría.

### `apps/control-plane/`

- Handlers/controladores de funciones y triggers para revalidación de privilegio funcional en segunda línea.
- OpenAPI de la familia de funciones para documentar los requisitos actualizados de autorización.
- Posible actualización de validadores/request schemas de API key creation si el contrato vive aquí.

### `apps/web-console/src/`

- **Página o sección de permisos de miembros**: separar “Function Deployment” y “Function Invocation”.
- **Pantalla de auditoría**: filtros por `requiredSubdomain` y operación intentada.
- **UI de API keys**: selección explícita del alcance funcional.
- **Tests Vitest/RTL** para toggles, restricciones y mensajes de error.

### `services/internal-contracts/src/`

- Nuevos schemas JSON para asignaciones y denegaciones funcionales.
- Posible ampliación de contratos de API keys y de eventos de auditoría.

### `docs/adr/` / documentación operativa

- ADR explicando por qué los sub-dominios funcionales refinan T04 en lugar de convertirse en nuevos dominios superiores.
- Nota operativa de rollout y revisión post-migración.

---

## 8. Variables de entorno nuevas

| Variable | Default | Descripción |
|----------|---------|-------------|
| `FUNCTION_PRIVILEGE_ENFORCEMENT_ENABLED` | `false` | Activa el enforcement de sub-dominios funcionales en APISIX/backend. |
| `FUNCTION_PRIVILEGE_CACHE_TTL_SECONDS` | `60` | TTL del caché de requisitos funcionales por endpoint en APISIX. |
| `FUNCTION_PRIVILEGE_PROPAGATION_SLA_SECONDS` | `60` | Ventana máxima permitida para que cambios de asignación surtan efecto. |
| `FUNCTION_PRIVILEGE_MIGRATION_REVIEW_PERIOD_DAYS` | `14` | Ventana para revisión de asignaciones duales generadas por migración. |
| `FUNCTION_PRIVILEGE_KAFKA_TOPIC_DENIED` | `console.security.function-privilege-denied` | Topic principal de denegaciones. |
| `FUNCTION_PRIVILEGE_KAFKA_TOPIC_ASSIGNED` | `console.security.function-privilege-assigned` | Topic de cambios de asignación. |
| `FUNCTION_PRIVILEGE_KAFKA_TOPIC_REVIEW_NOTICE` | `console.security.function-privilege-review-notice` | Topic de notificaciones post-migración. |
| `FUNCTION_TRIGGER_RUNTIME_VALIDATION_MODE` | `warn` | `warn` durante rollout; `enforce` cuando T05 quede activo. |

---

## 9. Estrategia de pruebas

### 9.1 Unitarias

- Plugin Lua:
  - deploy-only puede crear/actualizar/borrar funciones pero no invocar.
  - invoke-only puede invocar/ver resultados pero no desplegar ni gestionar triggers.
  - dual-role puede hacer ambas cosas.
  - actor con dominio superior correcto pero sub-dominio incorrecto recibe 403.
- Actions backend:
  - asignación/revocación de privilegios funcionales.
  - validación de compatibilidad con top-level domains.
  - query de auditoría con filtros.
  - migración de API keys legacy.
  - validación runtime de trigger identity.
- Consola:
  - toggles separados para deploy/invoke.
  - mensajes y errores cuando se intenta combinación inválida.
  - notificación de revisión tras migración.

### 9.2 Integración

- PUT de privilegios funcionales → PostgreSQL + sync Keycloak + invalidación caché APISIX.
- API key deploy-only intentando `POST /invoke` → 403 + evento + registro PG.
- API key invoke-only intentando `POST /functions` → 403 + evento + registro PG.
- Trigger create/update con runtime identity sin `function_invocation` → warning o bloqueo según modo.
- Propagación de cambios a sesiones activas en ≤ 60 s.

### 9.3 Contratos / OpenAPI

- Validar schemas JSON de eventos de denegación y asignación.
- Actualizar la familia OpenAPI de funciones para reflejar autorización funcional y respuestas 403 específicas.
- Validar que el catálogo público de rutas mantiene correspondencia 1:1 con la clasificación funcional.

### 9.4 Aceptación / E2E

| ID | Escenario | Evidencia esperada |
|----|-----------|-------------------|
| AC-01 | Credencial deploy-only intenta invocar función | HTTP 403, evento Kafka, fila en `function_privilege_denials` |
| AC-02 | Credencial invoke-only intenta desplegar función | HTTP 403, evento Kafka, fila en `function_privilege_denials` |
| AC-03 | Usuario con ambos privilegios despliega e invoca con éxito | 200/2xx en ambos paths y logs diferenciados |
| AC-04 | Tenant owner asigna solo invoke a un miembro en consola | UI refleja cambio, backend persiste y deploy posterior es denegado |
| AC-05 | Trigger configurado con identidad deploy-only | warning/bloqueo según modo y evidencia en auditoría/configuración |
| AC-06 | API keys legacy migradas conservan operativa | acceso existente sigue funcionando con dual-privilege hasta revisión |
| AC-07 | Filtro de auditoría por `function_deployment` | devuelve solo denegaciones de despliegue |
| AC-08 | Filtro de auditoría por `function_invocation` | devuelve solo denegaciones de invocación |

### 9.5 Validaciones operativas

- La migración SQL es idempotente.
- Rollout con `FUNCTION_PRIVILEGE_ENFORCEMENT_ENABLED=false` genera telemetría sin bloquear tráfico.
- Al activar enforcement, la tasa de 403 esperada coincide con los escenarios de prueba y no con falsos positivos masivos.

---

## 10. Riesgos, migraciones y rollback

### 10.1 Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|-----------|
| Clasificación incompleta de operaciones de funciones deja huecos o bloqueos indebidos | Media | Alto | Validación automática del catálogo de rutas + fail-closed controlado durante rollout log-only. |
| Mezcla incoherente entre top-level domain y sub-dominio funcional | Media | Alto | Validaciones server-side y de contrato al asignar members y crear API keys. |
| Triggers existentes ejecutan con identidades legacy sin `function_invocation` | Alta | Medio/Alto | Migración dual-privilege + modo `warn` inicial + reporte de revisión. |
| Propagación lenta de cambios de roles en Keycloak/APISIX | Media | Medio | Invalidación explícita de sesión y caché, medición en tests de integración. |
| Cambios en OpenWhisk admin/invoke paths quedan desalineados | Media | Alto | Revalidación en segunda línea y suite de tests de integración por path. |

### 10.2 Migración

1. **Fase 0**: desplegar DDL, contratos y clasificación funcional con enforcement desactivado.
2. **Fase 1**: migrar miembros y API keys con acceso funcional legacy a dual-privilege (`deploy + invoke`).
3. **Fase 2**: activar validación de triggers en modo `warn` y poblar auditoría.
4. **Fase 3**: activar enforcement duro en gateway/backend.
5. **Fase 4**: enviar notificaciones de revisión y cerrar el período de gracia.

### 10.3 Rollback

- Desactivar `FUNCTION_PRIVILEGE_ENFORCEMENT_ENABLED` y volver a modo observación.
- Mantener tablas/columnas añadidas, ya que son aditivas y no rompen compatibilidad.
- Mantener claims/roles en Keycloak; el rollback solo suprime enforcement, no la información.

### 10.4 Idempotencia

- Asignaciones con `INSERT ... ON CONFLICT DO UPDATE`.
- Migración de API keys/members no sobreescribe registros ya refinados manualmente.
- Seed de clasificación funcional reejecutable sin duplicación.

### 10.5 Observabilidad

- Métrica: `function_privilege_denials_total{required_subdomain, attempted_operation}`.
- Dashboard: denegaciones por deploy/invoke, por tenant/workspace y por actor.
- Logs estructurados para cada mismatch funcional.
- Reporte diario/24h de asignaciones duales aún no revisadas tras migración.

---

## 11. Dependencias y secuencia recomendada

### 11.1 Dependencias previas requeridas

- T01: credenciales de Keycloak/OpenWhisk/API keys gestionadas de forma segura.
- T02: rotación sin redeploy disponible para no acoplar rollout de privilegios a reinstalaciones.
- T03: plugin `scope-enforcement` y superficie de auditoría ya operativos.
- T04: dominios superiores `structural_admin` / `data_access` ya implementados.

### 11.2 Secuencia de implementación

```text
Step 1: Migración SQL + modelo de datos + clasificación de endpoints de funciones
Step 2: Extensión del plugin APISIX para function sub-domains
Step 3: Revalidación backend/control-plane para deploy/invoke/trigger paths
Step 4: CRUD de asignaciones funcionales + sync Keycloak + auditoría
Step 5: Extensión de API keys y migración de credenciales legacy
Step 6: Validación de runtime identities de triggers
Step 7: UI de permisos funcionales + UI de auditoría + UI de API keys
Step 8: Contratos/OpenAPI/ADR/documentación
Step 9: Rollout log-only → warn mode triggers → enforcement duro
```

### 11.3 Paralelización posible

- Step 4 (CRUD + sync) y Step 7 (UI) pueden avanzar en paralelo tras completar Step 1.
- Step 5 (API keys) y Step 6 (trigger validation) pueden desarrollarse en paralelo una vez definido el modelo de datos.
- Los contratos/OpenAPI pueden cerrarse en paralelo con Step 7, siempre que el modelo y los endpoints estén fijados.

---

## 12. Definition of Done

| Criterio | Evidencia |
|----------|-----------|
| Todas las operaciones de funciones están clasificadas en exactamente un sub-dominio | Validación automática del catálogo y/o seed DB sin rutas huérfanas |
| Deploy-only no puede invocar | AC-01 en CI + registro de denegación |
| Invoke-only no puede desplegar ni mutar triggers | AC-02 en CI + registro de denegación |
| Miembros pueden recibir deploy e invoke por separado en consola | Test UI + integración backend |
| API keys soportan alcance funcional explícito | Contrato actualizado + tests de creación/uso |
| Triggers validan identidad runtime con `function_invocation` | Tests de integración y evidencia en modo warn/enforce |
| Auditoría distingue deployment denied vs invocation denied | Query filtrable y schemas/eventos validados |
| Migración preserva operativa legacy sin downtime | tests de migración + validación en staging |
| Propagación de cambios ≤ 60 s | prueba automatizada / medición documentada |
| OpenAPI/contratos/documentación reflejan el nuevo modelo | artefactos presentes en el PR y validaciones verdes |

---

## Project Structure

### Documentation (this feature)

```text
specs/095-function-deploy-exec-separation/
├── plan.md              ← este archivo
├── research.md          ← salida Phase 0 de /speckit.plan
├── data-model.md        ← salida Phase 1 de /speckit.plan
├── contracts/           ← schemas de eventos/respuestas/requests
└── tasks.md             ← salida de /speckit.tasks
```

### Source Code (repository root)

```text
services/gateway-config/
├── plugins/
│   └── scope-enforcement.lua                         ← MODIFICADO
├── public-route-catalog.json                         ← MODIFICADO
└── tests/plugins/                                    ← NUEVOS/AMPLIADOS

services/provisioning-orchestrator/src/
├── migrations/
│   └── 095-function-deploy-exec-separation.sql       ← NUEVO
├── actions/
│   ├── function-privilege-assign.mjs                 ← NUEVO
│   ├── function-privilege-query.mjs                  ← NUEVO
│   ├── function-privilege-audit-query.mjs            ← NUEVO
│   ├── function-api-key-migration.mjs                ← NUEVO
│   └── function-trigger-validate-runtime.mjs         ← NUEVO o extensión equivalente
├── models/
│   └── function-privilege-assignment.mjs             ← NUEVO
├── repositories/
│   └── function-privilege-repository.mjs             ← NUEVO
├── events/
│   └── function-privilege-events.mjs                 ← NUEVO
└── tests/
    ├── actions/function-privilege-assign.test.mjs    ← NUEVO
    ├── actions/function-privilege-audit-query.test.mjs ← NUEVO
    ├── actions/function-api-key-migration.test.mjs   ← NUEVO
    └── actions/function-trigger-validate-runtime.test.mjs ← NUEVO

apps/control-plane/
├── openapi/families/functions.openapi.json           ← MODIFICADO
├── src/handlers|routes de funciones/triggers         ← MODIFICADO
└── tests/ correspondientes                           ← NUEVOS/AMPLIADOS

apps/web-console/src/
├── pages / components de permisos de miembros        ← MODIFICADOS
├── pages / components de auditoría                   ← MODIFICADOS
├── pages / components de API keys                    ← MODIFICADOS
└── tests/ correspondientes                           ← NUEVOS/AMPLIADOS

services/internal-contracts/src/
├── function-privilege-assignment.schema.json         ← NUEVO
├── function-privilege-denial.schema.json             ← NUEVO
└── exports / índices                                 ← MODIFICADOS

docs/adr/
└── adr-095-function-deploy-exec-separation.md        ← NUEVO
```

**Structure Decision**: Se mantiene la estructura actual del monorepo y se refina el enforcement de funciones reutilizando APISIX + control plane + Keycloak + OpenWhisk, sin introducir servicios nuevos ni carpetas raíz adicionales.
