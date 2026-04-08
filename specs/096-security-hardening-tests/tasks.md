<!-- markdownlint-disable MD031 MD040 -->
# Tasks — US-SEC-02-T06: Hardening Tests para Secretos, Scopes Inválidos y Rutas Restringidas por Plan

**Feature Branch**: `096-security-hardening-tests`  
**Task ID**: US-SEC-02-T06  
**Epic**: EP-18 — Seguridad funcional transversal  
**Status**: Ready for implementation  
**Generado**: 2026-03-31

---

## File-Path Map (implement read-list)

Los pasos de implementación (`speckit.implement`) deben leer **únicamente** estos archivos de referencia:

```
# Spec y plan de esta tarea
specs/096-security-hardening-tests/spec.md
specs/096-security-hardening-tests/plan.md
specs/096-security-hardening-tests/data-model.md
specs/096-security-hardening-tests/research.md

# Contratos internos de auditoría (schemas de eventos)
services/internal-contracts/src/schemas/scope-enforcement.schema.json (si existe)
services/internal-contracts/src/schemas/secret-rotation.schema.json (si existe)
services/internal-contracts/src/schemas/privilege-domain.schema.json (si existe)

# Workspace config
pnpm-workspace.yaml
package.json

# Archivos de OpenAPI de familias relevantes (NO control-plane.openapi.json)
apps/control-plane/openapi/secrets.openapi.json (si existe)
apps/control-plane/openapi/scopes.openapi.json (si existe)
apps/control-plane/openapi/plans.openapi.json (si existe)
```

> **IMPORTANTE**: No leer `apps/control-plane/openapi/control-plane.openapi.json`. Si se necesita la forma de un endpoint, consultar sólo los archivos de familia específicos indicados arriba.

---

## Task List

### PHASE-A: Scaffolding del workspace de hardening

---

#### TASK-A1 — Crear `tests/hardening/package.json`

**Archivo destino**: `tests/hardening/package.json`  
**Tipo**: create  
**Dependencias**: ninguna  

Crear el archivo `package.json` para el workspace `@in-falcone/hardening-tests` con:

- `"name": "@in-falcone/hardening-tests"`
- `"type": "module"`
- `"version": "0.0.1"`
- `"private": true`
- `"scripts"`:
  - `"test": "node --test suites/*.test.mjs"`
  - `"test:smoke": "node --test lib/*.smoke.test.mjs"`
  - `"run": "node run.mjs"`
- `"dependencies"`:
  - `"undici": "^6"` — cliente HTTP para llamadas a APISIX
  - `"kafkajs": "^2"` — verificación de audit events vía Kafka
  - `"pg": "^8"` — consultas a PostgreSQL para audit tables
  - `"node-vault": "^0.10"` — cliente HTTP para Vault API
  - `"uuid": "^9"` — generación de runId v4

**Contenido mínimo esperado**:
```json
{
  "name": "@in-falcone/hardening-tests",
  "type": "module",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "test": "node --test suites/*.test.mjs",
    "test:smoke": "node --test lib/*.smoke.test.mjs",
    "run": "node run.mjs"
  },
  "dependencies": {
    "undici": "^6",
    "kafkajs": "^2",
    "pg": "^8",
    "node-vault": "^0.10",
    "uuid": "^9"
  }
}
```

---

#### TASK-A2 — Registrar workspace en `pnpm-workspace.yaml`

**Archivo destino**: `pnpm-workspace.yaml`  
**Tipo**: modify  
**Dependencias**: TASK-A1  

Añadir `'tests/hardening'` a la lista de packages en `pnpm-workspace.yaml`. Verificar si ya existe antes de añadirlo. El archivo debe quedar con:

```yaml
packages:
  # ... entradas existentes ...
  - 'tests/hardening'
```

---

#### TASK-A3 — Añadir script `test:hardening` en `package.json` raíz

**Archivo destino**: `package.json` (raíz del monorepo)  
**Tipo**: modify  
**Dependencias**: TASK-A1  

Añadir bajo `"scripts"`:
```json
"test:hardening": "node tests/hardening/run.mjs"
```

No modificar ningún otro campo del `package.json` raíz.

---

#### TASK-A4 — Crear `tests/hardening/lib/enforcement-mode.mjs`

**Archivo destino**: `tests/hardening/lib/enforcement-mode.mjs`  
**Tipo**: create  
**Dependencias**: TASK-A1  

Exportar función `detectEnforcementMode()` que devuelve un objeto con los flags del entorno de enforcement y disponibilidad de infraestructura.

**Interfaz**:
```javascript
// @returns {Promise<EnforcementMode>}
export async function detectEnforcementMode()

// EnforcementMode shape:
// {
//   scopeEnforcement: boolean,       // SCOPE_ENFORCEMENT_ENABLED !== 'false'
//   privilegeDomain: boolean,        // PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED !== 'false'
//   vaultReachable: boolean,         // GET VAULT_ADDR/v1/sys/health → 200
//   kafkaReachable: boolean,         // intento de conexión con timeout 3s
//   postgresReachable: boolean,      // SELECT 1 con timeout 3s
// }
```

**Reglas de implementación**:
- Leer flags desde `process.env`; default a `true` si la variable no está seteada.
- `checkVaultHealth()`: GET `${VAULT_ADDR}/v1/sys/health` con timeout 3000 ms; si `VAULT_ADDR` no está definido, retorna `false`.
- `checkKafkaHealth()`: intentar conexión con `kafkajs` con timeout 3000 ms; captura error y retorna `false`.
- `checkPostgresHealth()`: ejecutar `SELECT 1` via `pg` con timeout 3000 ms; captura error y retorna `false`.
- Todos los checks deben capturar errores y retornar `false` sin lanzar excepciones.

---

#### TASK-A5 — Crear `tests/hardening/lib/http-client.mjs`

**Archivo destino**: `tests/hardening/lib/http-client.mjs`  
**Tipo**: create  
**Dependencias**: TASK-A1  

Wrapper sobre `undici` para llamadas HTTP al API gateway (APISIX).

**Interfaz exportada**:
```javascript
// Realiza una petición HTTP y retorna { status, headers, body }
export async function request(method, path, { headers = {}, body = null } = {})

// Shorthand
export const get    = (path, opts) => request('GET',    path, opts)
export const post   = (path, opts) => request('POST',   path, opts)
export const put    = (path, opts) => request('PUT',    path, opts)
export const del    = (path, opts) => request('DELETE', path, opts)
```

**Reglas de implementación**:
- Base URL desde `process.env.APISIX_BASE_URL`; lanzar error descriptivo si no está definida.
- Loguear en stdout: `[HTTP] {method} {path} → {status} ({durationMs}ms)` cuando `HARDENING_DEBUG=true`.
- Capturar errores de red y relanzar con mensaje que incluya método y path.
- Timeout configurable via `HARDENING_HTTP_TIMEOUT_MS` (default 10000).
- `Content-Type: application/json` por defecto si `body` es objeto; serializar con `JSON.stringify`.

---

#### TASK-A6 — Crear `tests/hardening/lib/fixtures.mjs`

**Archivo destino**: `tests/hardening/lib/fixtures.mjs`  
**Tipo**: create  
**Dependencias**: TASK-A5  

Provisión y teardown de fixtures aislados por ejecución.

**Interfaz exportada**:
```javascript
// Crea fixtures aislados para un runId dado
// @param {string} runId  — UUID v4 del run
// @returns {Promise<TestFixture>}
export async function createIsolatedFixture(runId)

// Elimina todos los recursos creados para un runId
// @param {string} runId
// @returns {Promise<void>}
export async function teardownFixture(runId)

// TestFixture shape:
// {
//   runId: string,
//   tenantId: string,
//   workspaceId: string,
//   credentials: {
//     validApiKey: string,
//     rotatedOldKey: string,           // versión antigua post-rotación
//     revokedApiKey: string,
//     storageReadOnly: string,         // scope: storage:read
//     storageReadWrite: string,        // scope: storage:read storage:write
//     functionsInvokeOnly: string,     // scope: functions:invoke
//     functionsDeployOnly: string,     // scope: functions:deploy
//     structuralAdminOnly: string,     // privilege_domain: structural_admin
//     dataAccessOnly: string,          // privilege_domain: data_access
//     freePlanToken: string,           // tenant en plan free
//     enterprisePlanToken: string,     // tenant en plan enterprise
//     tenantBToken: string,            // credencial de un segundo tenant aislado
//   },
//   secrets: {
//     activeSecretPath: string,
//     rotatedSecretPath: string,
//     webhookSigningSecretId: string,
//   }
// }
```

**Reglas de implementación**:
- Usar `http-client.mjs` con el header `Authorization: Bearer ${process.env.SUPERADMIN_TOKEN}`.
- Crear Tenant con nombre `hardening-${runId}` y tag `hardening-run-${runId}`.
- Crear Workspace dentro del tenant con el mismo tag.
- Crear las credenciales listadas en `TestFixture.credentials` a través del endpoint de gestión de API keys.
- Si `VAULT_ADDR` está definido, crear secrets en Vault en la ruta `tenant/${tenantId}/hardening-${runId}/`.
- `teardownFixture`: eliminar en orden inverso (secrets → webhooks → API keys → workspace → tenant); ignorar 404.
- Idempotente: si un recurso ya existe (409), retornar el existente sin fallar.
- **No hardcodear** ningún valor de secreto; generarlos con `crypto.randomUUID()` o `crypto.randomBytes(32).toString('hex')`.

---

#### TASK-A7 — Crear `tests/hardening/lib/fixtures.smoke.test.mjs`

**Archivo destino**: `tests/hardening/lib/fixtures.smoke.test.mjs`  
**Tipo**: create  
**Dependencias**: TASK-A6  

Smoke test que valida que `createIsolatedFixture` y `teardownFixture` funcionan sin errores cuando las variables de entorno están configuradas, y que manejan gracefully la ausencia de variables requeridas.

**Tests requeridos** (usando `node:test` nativo):
1. `"smoke: createIsolatedFixture retorna estructura correcta"` — verifica shape de `TestFixture`.
2. `"smoke: teardownFixture completa sin errores tras create"` — verifica limpieza idempotente.
3. `"smoke: teardownFixture es no-op si fixture no existe"` — verifica 404 ignorado.

**Nota**: Si `APISIX_BASE_URL` o `SUPERADMIN_TOKEN` no están definidos, los tests deben marcarse como `skip` con razón `"infrastructure not configured"`.

---

### PHASE-B: Suites de pruebas P1

---

#### TASK-B1 — Crear `tests/hardening/suites/secret-lifecycle.test.mjs`

**Archivo destino**: `tests/hardening/suites/secret-lifecycle.test.mjs`  
**Tipo**: create  
**Dependencias**: TASK-A4, TASK-A5, TASK-A6  

Suite de hardening para el ciclo de vida de secretos (P1). Cubre los escenarios SL-01 a SL-06 del plan.

**Tests a implementar**:

| ID | Nombre del test | Acción principal | Resultado esperado |
|----|----------------|------------------|--------------------|
| SL-01 | `valid API key grants access` | GET /v1/storage/buckets con `validApiKey` | HTTP 200 |
| SL-02 | `rotated-in-grace API key succeeds with deprecation header` | GET con `rotatedOldKey` durante grace period | HTTP 200 + header `X-Credential-Deprecated: true` o `Deprecation: true` |
| SL-03 | `post-grace API key is rejected with audit event` | GET con `rotatedOldKey` post-expiración de grace | HTTP 401 o 403 + audit event en ≤ 5 s |
| SL-04 | `explicitly revoked API key is rejected immediately` | GET con `revokedApiKey` | HTTP 401 o 403 |
| SL-05 | `webhook signing secret post-grace fails delivery validation` | Simular delivery firmado con secret antiguo | Respuesta indica firma inválida (4xx) |
| SL-06 | `Vault credential post-grace is rejected` | GET con Vault credential revocada | HTTP 401 o 403 + audit event |

**Reglas de implementación**:
- Importar `detectEnforcementMode`, `createIsolatedFixture`, `teardownFixture`, `waitForAuditEvent`.
- Si `vaultReachable === false`, marcar SL-06 como `skip` con razón `infrastructure-unavailable`.
- En `before`: llamar `createIsolatedFixture(runId)`.
- En `after` / `finally`: llamar `teardownFixture(runId)`.
- Para SL-03: el grace period del fixture se crea con duración mínima (1 s); el test espera su expiración o usa el endpoint de forzado de expiración si está disponible.
- Verificar audit event usando `waitForAuditEvent({ pgTable: 'secret_version_states', ... })` para SL-03 y SL-06.
- Cada test registra su resultado en el reporter importado de `lib/reporter.mjs`.

---

#### TASK-B2 — Crear `tests/hardening/suites/scope-enforcement.test.mjs`

**Archivo destino**: `tests/hardening/suites/scope-enforcement.test.mjs`  
**Tipo**: create  
**Dependencias**: TASK-A4, TASK-A5, TASK-A6  

Suite de hardening para enforcement de scopes en el gateway (P1). Cubre los escenarios SE-01 a SE-06 del plan.

**Tests a implementar**:

| ID | Nombre del test | Token usado | Endpoint | Resultado esperado |
|----|----------------|-------------|----------|--------------------|
| SE-01 | `insufficient scope (read→write) is denied` | `storageReadOnly` | PUT /v1/storage/buckets/:id | HTTP 403 + `scope-denied` audit event |
| SE-02 | `wrong sub-domain scope (invoke→deploy) is denied` | `functionsInvokeOnly` | PUT /v1/functions/:id | HTTP 403 + audit event |
| SE-03 | `scope removed from requirements → fail-closed` | Token con scope previamente válido, requisito eliminado | endpoint sin requisito | HTTP 403 + `config-error` audit event |
| SE-04 | `endpoint with no scope requirement → fail-closed` | Cualquier token válido | endpoint sin registro en `endpoint_scope_requirements` | HTTP 403 + `config-error` audit event |
| SE-05 | `correct scope grants access` | `storageReadWrite` | PUT /v1/storage/buckets/:id | HTTP 200 |
| SE-06 | `scope enforcement disabled → tests skipped` | — | — | Status: `skip`, razón: `enforcement-disabled` |

**Reglas de implementación**:
- Al inicio de la suite: llamar `detectEnforcementMode()`.
- Si `scopeEnforcement === false`: marcar SE-01 a SE-05 como `skip` con razón `enforcement-disabled`; no ejecutar llamadas HTTP.
- SE-03 requiere modificar temporalmente `endpoint_scope_requirements` para eliminar un requisito; restaurar en `afterEach`.
- SE-04 usa un path de endpoint que no tiene registro en la tabla de requisitos (puede ser un path de test aislado).
- Verificar audit events en tabla `scope_enforcement_denials` usando `waitForAuditEvent`.
- Registrar resultado en `lib/reporter.mjs`.

---

#### TASK-B3 — Crear `tests/hardening/suites/plan-restriction.test.mjs`

**Archivo destino**: `tests/hardening/suites/plan-restriction.test.mjs`  
**Tipo**: create  
**Dependencias**: TASK-A4, TASK-A5, TASK-A6  

Suite de hardening para rutas restringidas por plan de suscripción (P1). Cubre los escenarios PR-01 a PR-04 del plan.

**Tests a implementar**:

| ID | Nombre del test | Plan del tenant | Endpoint plan-gated | Resultado esperado |
|----|----------------|-----------------|---------------------|--------------------|
| PR-01 | `free plan cannot access enterprise endpoint` | `free` | GET /v1/enterprise/feature | HTTP 403 + `plan-denied` audit event |
| PR-02 | `enterprise plan can access professional endpoint (superset)` | `enterprise` | GET /v1/professional/feature | HTTP 200 |
| PR-03 | `recently downgraded tenant is denied after cache expiry` | `enterprise` → downgrade a `free` | GET /v1/enterprise/feature | HTTP 403 tras bypass/expiración de plan cache |
| PR-04 | `endpoint with invalid plan tier config → fail-closed` | Cualquier plan | endpoint con tier inexistente | HTTP 403 + `config-error` audit event |

**Reglas de implementación**:
- PR-03: Si `PLAN_CACHE_BYPASS_HEADER` está definido, enviar el header en la request para forzar revalidación; si no, esperar `SCOPE_ENFORCEMENT_PLAN_CACHE_TTL_SECONDS + 1` segundos (default 31 s, configurable). Documentar el wait en el output del test.
- Verificar audit events en tabla `scope_enforcement_denials` (con campo `reason: 'plan-denied'` o `reason: 'config-error'`).
- Registrar resultado en `lib/reporter.mjs`.

---

### PHASE-C: Verificación de audit events

---

#### TASK-C1 — Crear `tests/hardening/lib/audit-verifier.mjs`

**Archivo destino**: `tests/hardening/lib/audit-verifier.mjs`  
**Tipo**: create  
**Dependencias**: TASK-A1  

Módulo de polling de eventos de auditoría con estrategia dual: PostgreSQL primero, Kafka secundario.

**Interfaz exportada**:
```javascript
// Espera un evento de auditoría en PostgreSQL (fuente primaria)
// @param {object} opts
// @param {string} opts.pgTable   — tabla de auditoría a consultar
// @param {object} opts.filter    — WHERE conditions: { actorId, resource, action, requestTimeAfter }
// @param {number} [opts.timeoutMs=5000]
// @param {number} [opts.pollIntervalMs=200]
// @returns {Promise<{ found: boolean, eventData: object | null }>}
export async function waitForAuditEvent(opts)

// Espera un mensaje en un topic Kafka (fuente secundaria / secretos)
// @param {object} opts
// @param {string} opts.topic     — nombre del topic
// @param {object} opts.filter    — predicado de filtro sobre el mensaje parseado
// @param {number} [opts.timeoutMs=5000]
// @returns {Promise<{ found: boolean, eventData: object | null }>}
export async function waitForKafkaEvent(opts)
```

**Reglas de implementación**:
- `waitForAuditEvent`: conectar a PostgreSQL via `pg.Pool` con `DATABASE_URL`; hacer polling `SELECT * FROM {pgTable} WHERE actor_id = $1 AND created_at > $2 LIMIT 1` cada `pollIntervalMs` ms hasta `timeoutMs`.
- Si `DATABASE_URL` no está definido: retornar `{ found: false, eventData: null }` sin error.
- `waitForKafkaEvent`: crear consumer `kafkajs` con `groupId: hardening-${runId}-${Date.now()}`; escuchar mensajes durante `timeoutMs`; filtrar con la función `filter`; desconectar en finally.
- Si `KAFKA_BROKERS` no está definido: retornar `{ found: false, eventData: null }`.
- Loguear timeout si el evento no se encuentra en `timeoutMs`.
- Ningún error de infraestructura lanzado; siempre retornar el shape esperado.

**Tablas de PostgreSQL consultadas por suite**:

| Suite | Tabla | Campos de filtro clave |
|-------|-------|------------------------|
| scope-enforcement | `scope_enforcement_denials` | `actor_id`, `endpoint_path`, `created_at` |
| plan-restriction | `scope_enforcement_denials` | `actor_id`, `denial_reason`, `created_at` |
| privilege-domain | `privilege_domain_denials` | `actor_id`, `attempted_domain`, `created_at` |
| secret-lifecycle | `secret_version_states` | `secret_path`, `state`, `updated_at` |
| tenant-isolation | `scope_enforcement_denials` | `actor_id`, `workspace_id`, `denial_reason` |

**Topics Kafka usados** (para secrets y function-privilege que no tienen tabla propia):

| Suite | Topic |
|-------|-------|
| secret-lifecycle | `console.secrets.rotation.grace-expired`, `console.secrets.rotation.revoked` |
| function-privilege | `console.security.privilege-domain-denied` (si no hay tabla separada) |

---

### PHASE-D: Suites de pruebas P2

---

#### TASK-D1 — Crear `tests/hardening/suites/privilege-domain.test.mjs`

**Archivo destino**: `tests/hardening/suites/privilege-domain.test.mjs`  
**Tipo**: create  
**Dependencias**: TASK-A4, TASK-A5, TASK-A6, TASK-C1  

Suite de hardening para separación de dominios de privilegio (P2). Cubre los escenarios PD-01 a PD-03 del plan.

**Tests a implementar**:

| ID | Nombre del test | Credential | Operación | Resultado esperado |
|----|----------------|------------|-----------|-------------------|
| PD-01 | `data_access credential denied on structural_admin operation` | `dataAccessOnly` | PUT /v1/workspaces/:id/config | HTTP 403 + `privilege-domain-denied` audit event |
| PD-02 | `structural_admin credential denied on data read` | `structuralAdminOnly` | GET /v1/data/collections/:id/items | HTTP 403 + audit event |
| PD-03 | `dual-domain credential succeeds on both domain operations` | credential con ambos dominios | PUT config + GET data | HTTP 200 en ambas |

**Reglas de implementación**:
- Al inicio: `detectEnforcementMode()`; si `privilegeDomain === false`, marcar PD-01 y PD-02 como `skip` con razón `enforcement-disabled`.
- Verificar audit events en tabla `privilege_domain_denials` usando `waitForAuditEvent`.
- Registrar resultado en `lib/reporter.mjs`.

---

#### TASK-D2 — Crear `tests/hardening/suites/function-privilege.test.mjs`

**Archivo destino**: `tests/hardening/suites/function-privilege.test.mjs`  
**Tipo**: create  
**Dependencias**: TASK-A4, TASK-A5, TASK-A6, TASK-C1  

Suite de hardening para separación entre despliegue e invocación de funciones (P2). Cubre los escenarios FP-01 a FP-03 del plan.

**Tests a implementar**:

| ID | Nombre del test | Credential | Operación | Resultado esperado |
|----|----------------|------------|-----------|-------------------|
| FP-01 | `deploy-only credential cannot invoke function` | `functionsDeployOnly` | POST /v1/functions/:id/invoke | HTTP 403 + audit event |
| FP-02 | `invoke-only credential cannot deploy function` | `functionsInvokeOnly` | PUT /v1/functions/:id | HTTP 403 + audit event |
| FP-03 | `full-function credential can deploy and invoke` | credential con deploy+invoke | PUT deploy + POST invoke | HTTP 200 en ambas |

**Reglas de implementación**:
- Si `privilegeDomain === false`: marcar FP-01 y FP-02 como `skip`.
- Verificar audit events via `waitForKafkaEvent({ topic: 'console.security.privilege-domain-denied', ... })` si no hay tabla PG dedicada; o `waitForAuditEvent` si `privilege_domain_denials` registra function-level.
- Registrar resultado en `lib/reporter.mjs`.

---

#### TASK-D3 — Crear `tests/hardening/suites/tenant-isolation.test.mjs`

**Archivo destino**: `tests/hardening/suites/tenant-isolation.test.mjs`  
**Tipo**: create  
**Dependencias**: TASK-A4, TASK-A5, TASK-A6, TASK-C1  

Suite de hardening para aislamiento multi-tenant (P2). Cubre los escenarios TI-01 a TI-03 del plan.

**Tests a implementar**:

| ID | Nombre del test | Actor | Recurso | Resultado esperado |
|----|----------------|-------|---------|-------------------|
| TI-01 | `Tenant A credential denied on Tenant B secret` | `tenantBToken` usado como Tenant A | secret metadata de Tenant A | HTTP 403 + `workspace-mismatch` audit event |
| TI-02 | `Tenant A credential denied on Tenant B function` | credential de Tenant A | invoke función de Tenant B workspace | HTTP 403 + audit event |
| TI-03 | `superadmin can access resources of any tenant` | `SUPERADMIN_TOKEN` | resource de Tenant A | HTTP 200 + audit con actor superadmin |

**Reglas de implementación**:
- El fixture para TI ya incluye dos tenants aislados (`tenantId` y `tenantBId`).
- Verificar audit events en `scope_enforcement_denials` con `denial_reason: 'workspace-mismatch'`.
- Registrar resultado en `lib/reporter.mjs`.

---

### PHASE-E: Reporter e integración final

---

#### TASK-E1 — Crear `tests/hardening/lib/reporter.mjs`

**Archivo destino**: `tests/hardening/lib/reporter.mjs`  
**Tipo**: create  
**Dependencias**: TASK-A1  

Módulo de agregación de resultados y generación del reporte estructurado.

**Interfaz exportada**:
```javascript
// Registra el resultado de un test individual
// @param {HardeningTestResult} result
export function recordResult(result)

// Genera y retorna el HardeningReport completo
// @param {object} opts
// @param {string} opts.runId
// @param {Date}   opts.startedAt
// @param {object} opts.environment   — salida de detectEnforcementMode()
// @returns {HardeningReport}
export function generateReport({ runId, startedAt, environment })

// Retorna 1 si hay P1 failures, 0 si no
// @returns {number}
export function exitCode()

// Escribe el reporte JSON en disco
// @param {HardeningReport} report
// @returns {Promise<string>}  — path del archivo escrito
export async function writeReport(report)

// Imprime el reporte en stdout (texto legible)
// @param {HardeningReport} report
export function printReport(report)
```

**Shape de `HardeningTestResult`** (ver plan.md §4.3 para definición completa):
```javascript
{
  id: string,                    // e.g. "SE-01"
  suite: string,                 // "scope-enforcement"
  category: string,              // "secrets|scopes|plan|privilege-domain|tenant-isolation"
  severity: 'P1' | 'P2' | 'P3',
  status: 'pass' | 'fail' | 'skip',
  skipReason: string | null,     // "enforcement-disabled"|"infrastructure-unavailable"|null
  request: { method, path, headers },
  expectedHttpStatus: number,
  actualHttpStatus: number | null,
  auditEventExpected: string | null,
  auditEventObserved: boolean,
  durationMs: number,
  timestamp: string,             // ISO 8601
  error: string | null,          // mensaje de error si status === 'fail'
}
```

**Reglas de implementación**:
- `writeReport`: guardar en `${HARDENING_REPORT_DIR ?? 'tests/hardening/reports'}/hardening-${runId}.json`.
- `printReport`: formato de salida como en plan.md §9.1 (✅/❌/⏭ por test, summary al final).
- `exitCode()`: retorna 1 si hay algún resultado con `severity === 'P1'` y `status === 'fail'`; 0 en caso contrario. Tests `skip` **no** cuentan como failures.
- Estado interno: array `results` en módulo-level scope; thread-safe para ejecución secuencial (no concurrente dentro del mismo proceso).

---

#### TASK-E2 — Crear `tests/hardening/run.mjs`

**Archivo destino**: `tests/hardening/run.mjs`  
**Tipo**: create  
**Dependencias**: TASK-A4, TASK-A6, TASK-B1, TASK-B2, TASK-B3, TASK-C1, TASK-D1, TASK-D2, TASK-D3, TASK-E1  

Entrypoint principal de la suite de hardening. Orquesta el flujo completo.

**Flujo requerido**:

```javascript
// 1. Generar runId único
const runId = randomUUID()
const startedAt = new Date()

// 2. Detectar modo de enforcement e infraestructura disponible
const environment = await detectEnforcementMode()

// 3. Provisionar fixtures aislados
let fixture
try {
  fixture = await createIsolatedFixture(runId)
} catch (err) {
  // Si el fixture falla, no se puede ejecutar nada; salir con código 1
  console.error('[HARDENING] FATAL: fixture provision failed:', err.message)
  process.exit(1)
}

// 4. Ejecutar todas las suites en orden (secuencial)
//    Cada suite recibe { fixture, environment, reporter }
try {
  await runSecretLifecycleSuite({ fixture, environment })
  await runScopeEnforcementSuite({ fixture, environment })
  await runPlanRestrictionSuite({ fixture, environment })
  await runPrivilegeDomainSuite({ fixture, environment })
  await runFunctionPrivilegeSuite({ fixture, environment })
  await runTenantIsolationSuite({ fixture, environment })
} finally {
  // 5. Teardown garantizado (incluso en caso de error)
  await teardownFixture(runId).catch(err =>
    console.warn('[HARDENING] WARN: teardown error (ignored):', err.message)
  )
}

// 6. Generar y escribir reporte
const report = generateReport({ runId, startedAt, environment })
printReport(report)
await writeReport(report)

// 7. Exit con código apropiado
process.exit(exitCode())
```

**Reglas de implementación**:
- No usar `process.exit` dentro de las suites; solo en `run.mjs`.
- Cada suite debe ser importable de forma independiente (para desarrollo y debug).
- Cada suite exporta una función `run{Suite}Suite({ fixture, environment })` que retorna `Promise<void>` y llama a `recordResult()` internamente.
- Imprimir en stdout el `runId` y `startedAt` al inicio: `[HARDENING] Run ID: {runId}`.

---

#### TASK-E3 — Crear `tests/hardening/README.md`

**Archivo destino**: `tests/hardening/README.md`  
**Tipo**: create  
**Dependencias**: TASK-E2  

Documentación de uso de la suite de hardening.

**Secciones requeridas**:

1. **Descripción** — Qué es la suite, qué valida, qué features de seguridad cubre (T01–T05).
2. **Variables de entorno** — Tabla completa con nombre, descripción, requerida/opcional y valor default (del plan.md §11).
3. **Ejecución local** — Comandos paso a paso:
   ```bash
   pnpm install
   APISIX_BASE_URL=https://... SUPERADMIN_TOKEN=... node tests/hardening/run.mjs
   ```
4. **Ejecución en CI/CD** — Snippet de YAML con variables de entorno inyectadas como secrets (del plan.md §9.3).
5. **Categorías de tests** — Tabla: Suite, Severidad, IDs de tests, Dependencia en feature.
6. **Interpretar el reporte** — Explicar símbolos ✅/❌/⏭, exit codes, archivo JSON de reporte.
7. **Enforcement modes** — Explicar comportamiento cuando `SCOPE_ENFORCEMENT_ENABLED=false` o `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED=false`.
8. **Concurrencia** — Explicar cómo el `runId` aísla fixtures entre pipelines concurrentes.

---

## Orden de implementación recomendado

```
TASK-A1 (package.json)
  ├─► TASK-A2 (pnpm-workspace)
  ├─► TASK-A3 (root package.json script)
  ├─► TASK-A4 (enforcement-mode)
  ├─► TASK-A5 (http-client)
  │     └─► TASK-A6 (fixtures)
  │           └─► TASK-A7 (fixtures smoke test)
  └─► TASK-E1 (reporter)

TASK-C1 (audit-verifier)  ← puede ir en paralelo con TASK-A4..A6

TASK-B1 (secret-lifecycle)   ← requiere A4, A5, A6, C1
TASK-B2 (scope-enforcement)  ← requiere A4, A5, A6, C1
TASK-B3 (plan-restriction)   ← requiere A4, A5, A6, C1

TASK-D1 (privilege-domain)   ← requiere A4, A5, A6, C1
TASK-D2 (function-privilege) ← requiere A4, A5, A6, C1
TASK-D3 (tenant-isolation)   ← requiere A4, A5, A6, C1

TASK-E2 (run.mjs)            ← requiere todas las suites + E1
TASK-E3 (README)             ← requiere E2
```

---

## Criterios de done (verificación post-implementación)

| Criterio | Verificación |
|----------|-------------|
| `node tests/hardening/run.mjs` ejecuta sin errores de sintaxis ESM | `node --check tests/hardening/run.mjs` pasa |
| Todas las suites importan sin errores | `node -e "import('./tests/hardening/run.mjs')"` en dry-run |
| Smoke test pasa sin entorno real | `HARDENING_SKIP_INFRA=true node --test tests/hardening/lib/fixtures.smoke.test.mjs` |
| Reporter genera JSON válido | `node -e "..."` produce JSON parseable |
| Exit code 1 con P1 failure | Test unitario de `exitCode()` en reporter |
| Ningún secreto hardcodeado en el código | `grep -r "password\|secret_value\|Bearer eyJ" tests/hardening/` retorna vacío |
| `SCOPE_ENFORCEMENT_ENABLED=false` → tests SE-* en skip | Ejecución con flag deshabilitado |
| `pnpm-workspace.yaml` incluye `tests/hardening` | `grep "tests/hardening" pnpm-workspace.yaml` |
| `package.json` raíz incluye `test:hardening` | `grep "test:hardening" package.json` |

---

## Notas de restricción para `speckit.implement`

1. **No leer** `apps/control-plane/openapi/control-plane.openapi.json`. Si se necesita la forma de un endpoint concreto, consultar solo los archivos de familia listados en el File-Path Map.
2. **No modificar** archivos en `specs/070-saga-compensation-workflows/`, `specs/072-workflow-e2e-compensation/` ni ningún archivo de specs de otras features.
3. Los archivos en `tests/hardening/` son **todos nuevos** (create); no modificar tests existentes en `tests/e2e/`, `tests/integration/`, etc.
4. Las únicas modificaciones a archivos existentes son: `pnpm-workspace.yaml` (TASK-A2) y `package.json` raíz (TASK-A3).
5. El `runId` debe generarse **una sola vez** en `run.mjs` y propagarse a todas las suites; nunca generarlo dentro de las suites individuales.
