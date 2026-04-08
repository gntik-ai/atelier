<!-- markdownlint-disable MD031 MD040 -->
# Plan técnico de implementación — US-SEC-02-T06

**Feature Branch**: `096-security-hardening-tests`  
**Task ID**: US-SEC-02-T06  
**Epic**: EP-18 — Seguridad funcional transversal  
**Historia padre**: US-SEC-02 — Gestión segura de secretos, rotación, enforcement de scope y separación de privilegios  
**Fecha del plan**: 2026-03-31  
**Estado**: Ready for tasks  
**Dependencias directas**: US-SEC-02-T01 (`091-secure-secret-storage`), US-SEC-02-T02 (`092-secret-rotation-no-redeploy`), US-SEC-02-T03 (`093-scope-enforcement-blocking`), US-SEC-02-T04 (`094-admin-data-privilege-separation`), US-SEC-02-T05 (`095-function-deploy-exec-separation`)  
**Requisitos funcionales**: RF-SEC-005, RF-SEC-006, RF-SEC-007, RF-SEC-010, RF-SEC-011

---

## 1. Objetivo y alcance estricto de T06

Crear la **suite de pruebas de hardening de seguridad** que valida de forma automatizada y continua el comportamiento real de todos los mecanismos de seguridad implementados en T01–T05. Incluye:

- Suite de hardening para ciclo de vida de secretos: secreto válido → aceptado; rotado en gracia → aceptado con cabecera deprecation; post-gracia o revocado → rechazado con 401/403 y evento de auditoría.
- Suite de hardening para enforcement de scopes: tokens con scopes insuficientes, de dominio erróneo o ausentes → rechazados con 403 y evento de auditoría; fail-closed cuando el endpoint no tiene requisitos registrados.
- Suite de hardening para rutas restringidas por plan: tenant en plan inferior → rechazado con 403; fail-closed cuando el plan referenciado no existe.
- Suite de hardening para separación de dominios de privilegio: `structural_admin` vs. `data_access` y `function_deployment` vs. `function_invocation`.
- Suite de hardening para aislamiento multi-tenant: credencial de Tenant A no puede acceder a recursos de Tenant B.
- Infraestructura de fixtures aislados: provisión y teardown de tenants, workspaces y credenciales de prueba con identificadores únicos por ejecución.
- Reporter estructurado: salida JSON y texto con conteos pass/fail/skip, clasificación de severidad y modo de enforcement detectado.
- Integración CI/CD: exit code no-cero cuando cualquier test de severidad P1 falla; modo skip automático cuando la feature flag de enforcement está deshabilitada.

### Fuera de alcance de T06

- Implementación de los mecanismos de seguridad (cubiertos por T01–T05).
- Pruebas de penetración manuales o red-teaming.
- Fuzzing de protocolos o análisis estático de código.
- Definición o gestión del catálogo de scopes (consumido desde T03).
- Pruebas de carga/rendimiento (cubierto por suites de observabilidad).

---

## 2. Technical Context

**Language/Version**: Node.js 20+ ESM (`"type": "module"`, pnpm workspaces)  
**Primary Dependencies**: `node:test` (test runner nativo Node 20), `node:assert`, `undici` (cliente HTTP para llamadas a APISIX/API), `kafkajs` (verificación de eventos de auditoría), `pg` (consultas de estado para fixtures y auditoría), cliente Vault HTTP (`node-vault` o `undici` directo), `@in-falcone/internal-contracts` (schemas de contratos de auditoría)  
**Storage**: PostgreSQL (lectura de tablas de auditoría: `scope_enforcement_denials`, `privilege_domain_denials`, `secret_version_states`), Kafka (consumo de audit topics para verificar emisión), Vault (API HTTP para bootstrap de secretos en fixtures)  
**Testing**: La propia tarea ES la suite de tests; no tiene tests propios más allá de los smoke checks del scaffolding  
**Target Platform**: Kubernetes / OpenShift con APISIX, Keycloak, Vault, PostgreSQL, Kafka y OpenWhisk desplegados  
**Project Type**: Suite de hardening tests dentro del monorepo (`tests/hardening/`)  
**Performance Goals**: suite completa ejecutable en < 10 minutos en un despliegue estándar (SC-003)  
**Constraints**: multi-tenancy, aislamiento de fixtures por ejecución (UUID de run), fail-safe cuando infraestructura no disponible, sin valores de secretos en repositorio, compatible con ejecución concurrente de pipelines

---

## 3. Constitution Check

| Principio | Estado | Notas |
|-----------|--------|-------|
| I. Monorepo Separation of Concerns | ✅ PASS | Suite en `tests/hardening/` — parallel a `tests/e2e/`, `tests/integration/` ya existentes. Fixtures helpers en `tests/hardening/lib/`. Sin nuevas carpetas de primer nivel. |
| II. Incremental Delivery First | ✅ PASS | Fases ordenadas: infraestructura de fixtures → suites P1 (secretos, scopes, plan) → suites P2 (privilege-domain, tenant-isolation) → reporter → integración CI. Cada fase es revisable y merge-able independientemente. |
| III. Kubernetes / OpenShift Compatibility | ✅ PASS | Tests de hardening se ejecutan desde un Job de CI apuntando al cluster; sin supuestos de host; acceso a servicios vía variables de entorno estándar (`APISIX_BASE_URL`, `VAULT_ADDR`, `KAFKA_BROKERS`, `DATABASE_URL`). |
| IV. Quality Gates at Root | ✅ PASS | Script raíz `test:hardening` añadido en `package.json` raíz. CI falla en P1 failures via exit code. |
| V. Documentation as Part of the Change | ✅ PASS | Este `plan.md` + `research.md` + `data-model.md` en `specs/096-security-hardening-tests/`. README en `tests/hardening/`. |
| Secrets | ✅ PASS | Credenciales de test generadas en runtime a través de fixtures con TTL corto; ningún secreto en repo. |
| pnpm workspaces | ✅ PASS | `tests/hardening/` añadido como workspace member en `pnpm-workspace.yaml`. |

*Sin violaciones. Tabla de complejidad no requerida.*

---

## 4. Arquitectura objetivo

### 4.1 Diagrama de componentes

```
tests/hardening/
│
├── lib/
│   ├── fixtures.mjs          ← provisión/teardown de tenants, workspaces, credentials
│   ├── audit-verifier.mjs    ← polling Kafka/PostgreSQL para verificar eventos de auditoría
│   ├── http-client.mjs       ← wrapper undici con retry y logging para llamadas a APISIX
│   ├── enforcement-mode.mjs  ← detecta flags SCOPE_ENFORCEMENT_ENABLED / PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED
│   └── reporter.mjs          ← agrega resultados y genera JSON + texto estructurado
│
├── suites/
│   ├── secret-lifecycle.test.mjs      ← P1: secretos válidos/rotados-en-gracia/revocados
│   ├── scope-enforcement.test.mjs     ← P1: scopes insuficientes, fail-closed
│   ├── plan-restriction.test.mjs      ← P1: plan inferior, downgrade, fail-closed
│   ├── privilege-domain.test.mjs      ← P2: structural_admin vs data_access
│   ├── function-privilege.test.mjs    ← P2: function_deployment vs function_invocation
│   └── tenant-isolation.test.mjs      ← P2: cross-tenant access denial
│
├── run.mjs                   ← entrypoint principal, agrega suites y genera reporte
├── package.json
└── README.md
```

### 4.2 Flujo de ejecución de una suite

```
run.mjs
  │
  ├─► enforcement-mode.mjs   → detecta flags del entorno / consulta endpoints de status
  │
  ├─► fixtures.mjs           → provisiona tenants/workspaces/credentials únicos por run
  │        │
  │        └── TAG: hardening-run-{UUID}  (para teardown garantizado en finally)
  │
  ├─► HTTP call → APISIX (via undici)
  │        │
  │        └── assertion: HTTP status esperado
  │
  ├─► audit-verifier.mjs     → polling PostgreSQL / Kafka topic
  │        │
  │        └── assertion: audit event presente en < 5 s (SC-002)
  │
  ├─► reporter.mjs           → acumula HardeningTestResult
  │
  └─► fixtures.mjs (finally) → teardown (DELETE tenant/workspace/credentials/secrets)
```

### 4.3 Entidades de datos de la suite

**HardeningTestResult** (en memoria, serializado en reporte final):
```json
{
  "id": "SEC-HRD-001",
  "suite": "secret-lifecycle",
  "category": "secrets | scopes | plan | privilege-domain | tenant-isolation",
  "severity": "P1 | P2 | P3",
  "status": "pass | fail | skip",
  "skipReason": "enforcement-disabled | infrastructure-unavailable | null",
  "request": { "method": "POST", "path": "/v1/...", "headers": {} },
  "expectedHttpStatus": 403,
  "actualHttpStatus": 403,
  "auditEventExpected": "scope-denied",
  "auditEventObserved": true,
  "durationMs": 320,
  "timestamp": "2026-03-31T..."
}
```

**HardeningReport** (salida a fichero JSON + stdout):
```json
{
  "runId": "uuid-v4",
  "startedAt": "...",
  "completedAt": "...",
  "environment": {
    "scopeEnforcementEnabled": true,
    "privilegeDomainEnforcementEnabled": false,
    "vaultReachable": true,
    "kafkaReachable": true
  },
  "summary": { "total": 42, "passed": 38, "failed": 2, "skipped": 2 },
  "results": [ ...HardeningTestResult[] ],
  "exitCode": 1
}
```

---

## 5. Cambios por artefacto

### 5.1 Nuevo: `tests/hardening/` (workspace pnpm)

| Fichero | Descripción |
|---------|-------------|
| `package.json` | `@in-falcone/hardening-tests`, `"type":"module"`, deps: `undici`, `kafkajs`, `pg`, `node-vault` |
| `run.mjs` | Entrypoint: importa todas las suites, invoca fixtures, agrega HardeningReport, imprime reporte, sale con exit 1 si hay P1 failures |
| `lib/fixtures.mjs` | `createIsolatedFixture(runId)` → crea Tenant + Workspace + credenciales vía API superadmin; `teardownFixture(runId)` → eliminación idempotente |
| `lib/audit-verifier.mjs` | `waitForAuditEvent(topic, filter, timeoutMs=5000)` → polling Kafka consumer o query PostgreSQL; devuelve `{found: bool, eventData}` |
| `lib/http-client.mjs` | Wrapper `fetch`/`undici` con cabeceras de autenticación configurables, logging de request/response para diagnóstico en CI |
| `lib/enforcement-mode.mjs` | `detectEnforcementMode()` → consulta `GET /v1/admin/status` o lee variables de entorno; devuelve objeto con flags activos |
| `lib/reporter.mjs` | Agrega resultados, calcula summary, serializa a JSON y texto; exporta `exitCode()` |
| `suites/secret-lifecycle.test.mjs` | Tests P1: lifecycle completo secreto API-key, Vault credential, webhook signing secret (US-SEC-02-T02) |
| `suites/scope-enforcement.test.mjs` | Tests P1: scope insuficiente, scope de dominio equivocado, scope removido, endpoint sin requisito (T03) |
| `suites/plan-restriction.test.mjs` | Tests P1: plan inferior, plan superset, downgrade TTL, plan inválido fail-closed (T03 plan-based) |
| `suites/privilege-domain.test.mjs` | Tests P2: `data_access` → operación `structural_admin` y viceversa (T04) |
| `suites/function-privilege.test.mjs` | Tests P2: deploy-only credential → invoke denegado; invoke-only → deploy denegado (T05) |
| `suites/tenant-isolation.test.mjs` | Tests P2: credential Tenant A → resource Tenant B; superadmin → resource cualquier tenant |
| `README.md` | Instrucciones de ejecución local y en CI, variables de entorno requeridas, descripción de categorías |

### 5.2 Modificado: `pnpm-workspace.yaml`

Añadir `tests/hardening` como miembro del workspace.

### 5.3 Modificado: `package.json` (raíz)

Añadir script:
```json
"test:hardening": "node tests/hardening/run.mjs"
```

### 5.4 Nuevo: `specs/096-security-hardening-tests/research.md`

Resolución de decisiones técnicas: elección de `node:test` vs Jest, estrategia de polling de auditoría (Kafka vs PostgreSQL), mecanismo de fixtures aislados.

### 5.5 Nuevo: `specs/096-security-hardening-tests/data-model.md`

Entidades `HardeningTestResult`, `HardeningReport`, `TestFixture` con sus campos, invariantes y diagrama de flujo de estado.

---

## 6. Suites de prueba — detalle por categoría

### 6.1 Suite: `secret-lifecycle` (P1)

| ID | Scenario | Precondición | Acción | Resultado esperado |
|----|----------|-------------|--------|-------------------|
| SL-01 | Secreto válido concede acceso | API key activa en estado `active` | `GET /v1/storage/buckets` con API key | HTTP 200 |
| SL-02 | Secreto rotado en gracia concede acceso con advertencia | Rotación iniciada, versión anterior en grace period | Request con versión anterior | HTTP 200 + cabecera `Deprecation: true` o `X-Credential-Deprecated: true` |
| SL-03 | Secreto post-gracia rechazado | Grace period expirado para versión anterior | Request con versión anterior | HTTP 401/403 + evento Kafka `console.secrets.rotation.grace-expired` |
| SL-04 | Secreto revocado explícitamente rechazado | Revocación explícita antes de fin de grace | Request con versión revocada | HTTP 401/403 inmediato |
| SL-05 | Webhook signing secret rotado, old post-gracia rechazado | Webhook signing secret rotado, grace expirado | Delivery firmado con secret antiguo | Validación de firma falla, delivery flagged |
| SL-06 | Vault credential rotado post-gracia rechazado | Vault credential de service account rotado | Request con versión antigua | HTTP 401/403 + audit event |

**Verificaciones cruzadas para cada test**: HTTP status + presencia de evento de auditoría en ≤ 5 s (SC-002).

### 6.2 Suite: `scope-enforcement` (P1)

| ID | Scenario | Scope del token | Scope requerido | Resultado esperado |
|----|----------|----------------|-----------------|-------------------|
| SE-01 | Scope insuficiente denegado | `storage:read` | `storage:write` | HTTP 403 + `scope-denied` audit event |
| SE-02 | Scope de sub-dominio erróneo denegado | `functions:invoke` | `functions:deploy` | HTTP 403 + audit event |
| SE-03 | Scope removido de requisitos → fail-closed | Scope previamente válido pero eliminado de `endpoint_scope_requirements` | — | HTTP 403 + `config-error` audit event |
| SE-04 | Endpoint sin requisito registrado → fail-closed | Cualquier token | — | HTTP 403 + `config-error` audit event |
| SE-05 | Token con scope correcto concede acceso | `storage:write` | `storage:write` | HTTP 200 |
| SE-06 | Enforcement deshabilitado → test marcado skip | `SCOPE_ENFORCEMENT_ENABLED=false` | — | Status: `skip` con razón `enforcement-disabled` |

### 6.3 Suite: `plan-restriction` (P1)

| ID | Scenario | Plan tenant | Plan requerido | Resultado esperado |
|----|----------|------------|----------------|-------------------|
| PR-01 | Plan inferior rechazado | `free` | `enterprise` | HTTP 403 + `plan-denied` audit event |
| PR-02 | Plan superset aceptado | `enterprise` | `professional` | HTTP 200 |
| PR-03 | Downgrade reciente → rechazado tras TTL | `enterprise` → downgrade a `free` (bypass cache) | `enterprise` | HTTP 403 tras expirar plan cache |
| PR-04 | Plan inválido en configuración → fail-closed | Cualquier plan | Plan tier inexistente | HTTP 403 + `config-error` audit event |

### 6.4 Suite: `privilege-domain` (P2)

| ID | Scenario | Credential domain | Operación | Resultado esperado |
|----|----------|------------------|-----------|-------------------|
| PD-01 | `data_access` no puede ejecutar op `structural_admin` | `data_access` | `PUT /v1/workspaces/:id/config` | HTTP 403 + `privilege-domain-denied` audit event |
| PD-02 | `structural_admin` no puede leer datos de aplicación | `structural_admin` | `GET /v1/data/collections/:id/items` | HTTP 403 + audit event |
| PD-03 | Ambos dominios permiten operación en dominio correcto | `data_access` + `structural_admin` | Ambas operaciones | HTTP 200 en ambos casos |

### 6.5 Suite: `function-privilege` (P2)

| ID | Scenario | Credential privilege | Operación | Resultado esperado |
|----|----------|---------------------|-----------|-------------------|
| FP-01 | Deploy-only no puede invocar | `function_deployment` | `POST /v1/functions/:id/invoke` | HTTP 403 + `function-privilege-denied` audit event |
| FP-02 | Invoke-only no puede desplegar | `function_invocation` | `PUT /v1/functions/:id` | HTTP 403 + audit event |
| FP-03 | Full-function puede hacer ambas | `function_deployment` + `function_invocation` | Deploy + invoke | HTTP 200 en ambas |

### 6.6 Suite: `tenant-isolation` (P2)

| ID | Scenario | Actor | Recurso | Resultado esperado |
|----|----------|-------|---------|-------------------|
| TI-01 | Credencial Tenant A rechazada en secret de Tenant B | Tenant A (fully-privileged) | Secret metadata de Tenant B | HTTP 403 + `workspace-mismatch` audit event |
| TI-02 | Credencial Tenant A rechazada en función de Tenant B | Tenant A | Invoke función Tenant B | HTTP 403 + audit event |
| TI-03 | Superadmin accede a recursos de cualquier tenant | Superadmin | Resource de Tenant A | HTTP 200 + audit event con actor superadmin |

---

## 7. Infraestructura de fixtures

### 7.1 Provisión por ejecución

```javascript
// lib/fixtures.mjs
export async function createIsolatedFixture(runId) {
  // 1. Crear Tenant con nombre hardening-{runId}
  // 2. Crear Workspace dentro del tenant
  // 3. Crear pares de API keys con distintos scopes/dominios
  // 4. Registrar secret via secret-rotation-initiate (Vault)
  // 5. Registrar webhook subscription
  // 6. Devolver { tenantId, workspaceId, credentials: {...}, secrets: {...} }
}

export async function teardownFixture(runId) {
  // DELETE en orden inverso: secrets → webhooks → API keys → workspace → tenant
  // Idempotente: ignora 404
}
```

### 7.2 Concurrencia segura

Cada ejecución usa su propio `runId` (UUID v4 generado en `run.mjs`). Todos los recursos creados llevan el tag `hardening-run-{runId}` en sus metadatos. Si dos pipelines se ejecutan en paralelo, sus fixtures son completamente independientes (SC-006).

### 7.3 Limpieza en errores

El bloque `finally` en `run.mjs` garantiza el teardown incluso cuando los tests fallan o hay errores de infraestructura. Errores de teardown se loguean como warnings sin bloquear el exit code.

---

## 8. Verificación de eventos de auditoría

### 8.1 Estrategia dual (PostgreSQL primero, Kafka secundario)

```javascript
// lib/audit-verifier.mjs
export async function waitForAuditEvent({ pgTable, filter, timeoutMs = 5000 }) {
  // Polling PostgreSQL: SELECT FROM scope_enforcement_denials / privilege_domain_denials
  // WHERE actor_id = filter.actorId AND resource = filter.resource
  //   AND created_at > filter.requestTime - '100ms'
  // Polling cada 200 ms hasta timeoutMs
  // Si no se encuentra en PG, intentar Kafka consumer como fallback
  return { found: boolean, eventData: object | null };
}
```

**Justificación de PostgreSQL como fuente primaria**: los audit query endpoints de T03/T04 ya persisten las denegaciones en tablas relacionales. La consulta directa es más rápida (< 1 s) que esperar a que Kafka delivery confirme en tests de hardening.

**Kafka como secondary assertion**: para tests de secretos (T02), la verificación usa el consumer de `console.secrets.rotation.*` ya que los eventos de secretos no tienen tabla de denegaciones propia, solo Kafka.

### 8.2 Configuración por ambiente

| Variable | Descripción | Default |
|----------|-------------|---------|
| `HARDENING_AUDIT_TIMEOUT_MS` | Timeout para esperar audit event | `5000` |
| `HARDENING_AUDIT_POLL_INTERVAL_MS` | Intervalo de polling | `200` |
| `HARDENING_AUDIT_SOURCE` | `postgres` / `kafka` / `auto` | `auto` |

---

## 9. Reporter y salida estructurada

### 9.1 Salida en ejecución normal

```
[HARDENING] Suite: secret-lifecycle
  ✅ SL-01 valid secret grants access                      [P1]  (245ms)
  ✅ SL-02 rotated-in-grace succeeds with deprecation hdr  [P1]  (312ms)
  ✅ SL-03 post-grace secret rejected + audit event        [P1]  (890ms)
  ✅ SL-04 explicitly revoked secret rejected              [P1]  (421ms)

[HARDENING] Suite: scope-enforcement
  ✅ SE-01 insufficient scope denied + audit              [P1]  (187ms)
  ⏭  SE-06 scope enforcement disabled → skip             [P1]  (skipped: enforcement-disabled)

[HARDENING] Summary
  Total: 42  Passed: 39  Failed: 1  Skipped: 2
  P1 failures: 1 → EXIT CODE 1
```

### 9.2 Fichero de reporte

Generado en `tests/hardening/reports/hardening-{runId}.json`. En CI, el path se imprime en stdout y puede ser archivado como artefacto.

### 9.3 Integración CI/CD

```yaml
# Ejemplo GitLab CI / GitHub Actions
- name: Run hardening tests
  run: node tests/hardening/run.mjs
  env:
    APISIX_BASE_URL: ${{ secrets.APISIX_BASE_URL }}
    SUPERADMIN_TOKEN: ${{ secrets.SUPERADMIN_TOKEN }}
    DATABASE_URL: ${{ secrets.HARDENING_DATABASE_URL }}
    KAFKA_BROKERS: ${{ secrets.KAFKA_BROKERS }}
    VAULT_ADDR: ${{ secrets.VAULT_ADDR }}
```

Exit code 1 cuando hay P1 failures → pipeline bloqueado (SC-004).

---

## 10. Manejo de modos de enforcement deshabilitados

```javascript
// lib/enforcement-mode.mjs
export async function detectEnforcementMode() {
  return {
    scopeEnforcement: process.env.SCOPE_ENFORCEMENT_ENABLED !== 'false',
    privilegeDomain: process.env.PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED !== 'false',
    vaultReachable: await checkVaultHealth(),
    kafkaReachable: await checkKafkaHealth(),
  };
}
```

Cada suite consulta `detectEnforcementMode()` al inicio:
- Si `scopeEnforcement === false` → tests de scope marcados `skip` con razón `enforcement-disabled`.
- Si `privilegeDomain === false` → tests de privilege-domain marcados `skip`.
- Si `vaultReachable === false` → tests de secret-lifecycle que requieren Vault marcados `skip` con razón `infrastructure-unavailable`.
- Tests P1 skipped **no** incrementan el contador de failures, pero se reportan explícitamente en el summary (SC-005).

---

## 11. Variables de entorno requeridas

| Variable | Descripción | Requerida |
|----------|-------------|----------|
| `APISIX_BASE_URL` | URL base del API gateway | ✅ |
| `SUPERADMIN_TOKEN` | Token de superadmin para provisión de fixtures | ✅ |
| `DATABASE_URL` | PostgreSQL para verificación de audit events | ✅ |
| `KAFKA_BROKERS` | Brokers Kafka para verificación de eventos | ✅ |
| `VAULT_ADDR` | Dirección del servidor Vault | Opcional (si ausente, tests de Vault → skip) |
| `VAULT_TOKEN` | Token de acceso a Vault para fixtures | Opcional |
| `SCOPE_ENFORCEMENT_ENABLED` | Feature flag de enforcement de scope | Opcional (default: `true`) |
| `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED` | Feature flag de privilege domain | Opcional (default: `true`) |
| `PLAN_CACHE_BYPASS_HEADER` | Header especial para bypass de caché en tests de plan | Opcional |
| `HARDENING_AUDIT_TIMEOUT_MS` | Timeout para verificación de audit events | Opcional (default: `5000`) |
| `HARDENING_REPORT_DIR` | Directorio de salida del reporte JSON | Opcional (default: `tests/hardening/reports/`) |

---

## 12. Estrategia de pruebas

### 12.1 Cobertura por categoría

| Categoría | Severidad | Tests | Dependencia |
|-----------|-----------|-------|------------|
| Secret lifecycle | P1 | 6 tests (SL-01..SL-06) | T01, T02 |
| Scope enforcement | P1 | 6 tests (SE-01..SE-06) | T03 |
| Plan restriction | P1 | 4 tests (PR-01..PR-04) | T03 (plan-based) |
| Privilege domain | P2 | 3 tests (PD-01..PD-03) | T04 |
| Function privilege | P2 | 3 tests (FP-01..FP-03) | T05 |
| Tenant isolation | P2 | 3 tests (TI-01..TI-03) | T01–T05 |

Total mínimo: 25 tests de hardening + smoke tests de fixtures.

### 12.2 Tests del scaffolding de la suite

```text
tests/hardening/
└── lib/
    └── fixtures.smoke.test.mjs   ← verifica que fixtures se crean y borran correctamente
```

Este smoke test puede ejecutarse en `node:test` nativo y valida el propio scaffolding sin depender de un entorno completo.

### 12.3 No testing of tests

No se escriben tests de los tests de hardening en sí mismos (es circular). La validez de la suite se garantiza por:
1. Smoke test de fixtures.
2. Code review manual de cada asserción.
3. Primera ejecución contra entorno real como evidencia de done.

---

## 13. Riesgos, mitigaciones y dependencias

### 13.1 Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|-----------|
| T01–T05 no completamente desplegados al ejecutar T06 | Media | Alto | Detección de enforcement mode; skip automático con reason |
| Flakiness por timing de audit events | Media | Medio | Polling con timeout configurable (default 5 s); retry en audit-verifier con backoff |
| Cross-contamination entre pipelines CI concurrentes | Baja | Alto | UUID por run en todos los fixtures; teardown en finally |
| Vault no disponible en entorno de test | Media | Medio | Skip graceful de tests que dependen de Vault |
| Plan cache TTL hace tests de plan no deterministas | Media | Medio | Header de bypass de cache (si disponible) o wait con timeout explícito |
| Cambio de API de T01–T05 rompe fixtures | Baja | Medio | Contratos versionados en `services/internal-contracts/`; suite sigue contratos publicados |

### 13.2 Compatibilidad y rollback

- La suite de hardening no modifica estado de producción; solo crea y elimina fixtures en namespaces aislados.
- Si la suite falla por errores de infraestructura (no por fallos de seguridad), el teardown limpia los recursos y el pipeline puede reintentar.
- Compatible con despliegues parciales: si T04 no está desplegado, los tests `privilege-domain` se skippean automáticamente.

### 13.3 Idempotencia

Todos los helpers de fixtures usan `upsert` / `create or return existing` semántics para tolerar reruns en el mismo entorno sin dejar basura acumulada.

---

## 14. Secuencia de implementación

```
Fase A — Scaffolding (puede comenzar en paralelo con últimas fases de T05)
  ├── Crear tests/hardening/package.json, README.md, run.mjs (stub)
  ├── Implementar lib/fixtures.mjs + smoke test
  └── Implementar lib/enforcement-mode.mjs, lib/http-client.mjs

Fase B — Suites P1 (bloquea: T02 completado, T03 completado)
  ├── suites/secret-lifecycle.test.mjs
  ├── suites/scope-enforcement.test.mjs
  └── suites/plan-restriction.test.mjs

Fase C — Verificación de auditoría (bloquea: Fase B)
  └── lib/audit-verifier.mjs (Kafka + PostgreSQL dual-source)

Fase D — Suites P2 (bloquea: T04 completado, T05 completado)
  ├── suites/privilege-domain.test.mjs
  ├── suites/function-privilege.test.mjs
  └── suites/tenant-isolation.test.mjs

Fase E — Reporter e integración CI
  ├── lib/reporter.mjs
  ├── run.mjs (completo con report + exit code)
  └── Integración en package.json raíz + documentación CI
```

**Paralelización**: Fase A puede ejecutarse en paralelo con las últimas fases de T05. Fases B y D requieren sus respectivas dependencias completadas.

---

## 15. Criterios de done verificables

| Criterio | Evidencia esperada |
|----------|--------------------|
| Suite completa ejecutable via `node tests/hardening/run.mjs` | CI log con summary pass/fail/skip |
| 100% de categorías de denegación cubiertas (SC-001) | Reporte final muestra tests en las 6 categorías |
| Cada denegación verifica HTTP status + audit event en ≤ 5 s (SC-002) | `durationMs` en HardeningTestResult por test; audit-verifier timeout no superado |
| Suite completa en < 10 min (SC-003) | Timestamp start/end en HardeningReport |
| Exit code 1 en P1 failure (SC-004) | CI pipeline bloqueado en test con P1 failure simulado |
| Tests de enforcement deshabilitado → skip, no false-pass (SC-005) | Ejecución con `SCOPE_ENFORCEMENT_ENABLED=false` → tests SE-* en status `skip` |
| Ejecución concurrente sin cross-contamination (SC-006) | Dos ejecuciones simultáneas con runIds distintos; logs no muestran interferencia |
| Fixtures creados y eliminados limpiamente | No quedan tenants/workspaces con prefijo `hardening-` tras ejecución exitosa |
| README actualizado con instrucciones de ejecución local y CI | `tests/hardening/README.md` revisado por al menos un peer |
| `specs/096-security-hardening-tests/research.md` y `data-model.md` presentes | Artefactos en el directorio del spec |

---

## Apéndice A: Artefactos del plan generados

```text
specs/096-security-hardening-tests/
├── plan.md              ← este fichero (/speckit.plan)
├── research.md          ← decisiones técnicas y alternativas evaluadas
└── data-model.md        ← entidades HardeningTestResult, HardeningReport, TestFixture
```

*`tasks.md` se generará en la siguiente fase (`/speckit.tasks`), no en este plan.*
