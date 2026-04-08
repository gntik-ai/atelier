# Plan de Implementación: US-PLAN-02-T06 — Pruebas de Enforcement Coherente de Capabilities y Cuotas por Plan

**Branch**: `108-plan-enforcement-tests` | **Fecha**: 2026-03-31 | **Spec**: `specs/108-plan-enforcement-tests/spec.md`\
**Input**: Especificación de feature US-PLAN-02-T06 | **Tamaño**: M | **Prioridad**: P0

## Resumen ejecutivo

Implementar una suite completa de pruebas de integración y coherencia end-to-end que valide que los cinco subsistemas construidos en T01–T05 (cuotas hard/soft, capabilities booleanas, resolución de límites efectivos, visualización en consola y enforcement activo) funcionan de forma coherente entre sí a lo largo de escenarios realistas del ciclo de vida de un tenant. La suite cubre la propagación DB → resolución → gateway → consola → auditoría, y se ejecuta en CI/CD sin intervención manual.

## Contexto técnico

- **Lenguaje/Versión**: Node.js 20+ ESM (tests de API/integración), TypeScript + Vitest (tests de consola), Playwright (tests E2E de browser)
- **Dependencias principales**: Apache APISIX (gateway), Keycloak (IAM), PostgreSQL (datos de planes), MongoDB (datos de workspace), Kafka (eventos de auditoría), OpenWhisk (acciones del control plane), React + Tailwind + shadcn/ui (consola)
- **Testing framework**: `node:test` nativo para tests de API, Vitest para tests de componentes de consola, Playwright para tests E2E de browser
- **Plataforma destino**: Kubernetes / OpenShift vía Helm (entorno de test desplegado)
- **Tipo de proyecto**: Monorepo BaaS multi-tenant (`in-falcone`)
- **Constraints**: Aislamiento de tenants de prueba, credenciales vía env vars, idempotencia, tiempo total < 15 min en CI

## Verificación de constitución

- **Separación monorepo**: PASS — Tests en directorio dedicado `tests/integration/plan-enforcement/`, sin modificar código de producción
- **Entrega incremental**: PASS — Tests se añaden sin alterar comportamiento existente
- **Compatibilidad K8s/OpenShift**: PASS — Tests se ejecutan contra el cluster desplegado, no requieren cambios de infra
- **Quality gates en raíz**: PASS — Integrable con scripts de validación existentes del monorepo
- **Documentación como parte del cambio**: PASS — Spec, plan y tasks incluidos

## Estructura del proyecto

### Documentación (esta feature)

```text
specs/108-plan-enforcement-tests/
├── spec.md
├── plan.md
└── tasks.md
```

### Código fuente (raíz del repositorio)

```text
tests/integration/plan-enforcement/
├── README.md                               # NUEVO — Documentación de la suite
├── config/
│   ├── test-env.mjs                        # NUEVO — Carga de config y env vars
│   ├── test-plans.mjs                      # NUEVO — Definición de planes de prueba (seed data)
│   └── test-capabilities.mjs               # NUEVO — Catálogo de capabilities para tests
├── helpers/
│   ├── tenant-factory.mjs                  # NUEVO — Creación/teardown de tenants de prueba
│   ├── plan-factory.mjs                    # NUEVO — Creación/asignación de planes de prueba
│   ├── override-factory.mjs                # NUEVO — Creación/revocación de overrides
│   ├── workspace-factory.mjs               # NUEVO — Creación de workspaces y subcuotas
│   ├── resource-factory.mjs                # NUEVO — Creación de recursos (DBs, topics, functions, etc.)
│   ├── api-client.mjs                      # NUEVO — Cliente HTTP para gateway y control plane
│   ├── console-api-client.mjs              # NUEVO — Cliente HTTP para endpoints JSON de consola
│   ├── kafka-consumer.mjs                  # NUEVO — Consumidor de eventos de auditoría en Kafka
│   ├── auth.mjs                            # NUEVO — Obtención de tokens Keycloak (superadmin, tenant)
│   ├── wait-for-propagation.mjs            # NUEVO — Polling con timeout configurable para TTL
│   └── report.mjs                          # NUEVO — Generación de reporte estructurado
├── suites/
│   ├── 01-resolution-gateway-coherence.test.mjs      # NUEVO — RF-T06-01
│   ├── 02-resolution-console-coherence.test.mjs      # NUEVO — RF-T06-02
│   ├── 03-gateway-console-coherence.test.mjs         # NUEVO — RF-T06-03
│   ├── 04-plan-change-propagation.test.mjs           # NUEVO — RF-T06-04
│   ├── 05-override-propagation.test.mjs              # NUEVO — RF-T06-05
│   ├── 06-hard-quota-enforcement.test.mjs            # NUEVO — RF-T06-06
│   ├── 07-soft-quota-grace-enforcement.test.mjs      # NUEVO — RF-T06-07
│   ├── 08-workspace-subquota-coherence.test.mjs      # NUEVO — RF-T06-08
│   ├── 09-upstream-change-inconsistency.test.mjs     # NUEVO — RF-T06-09
│   ├── 10-deny-by-default.test.mjs                   # NUEVO — RF-T06-10
│   ├── 11-audit-enforcement-events.test.mjs          # NUEVO — RF-T06-11
│   ├── 12-capability-quota-orthogonality.test.mjs    # NUEVO — RF-T06-12
│   ├── 13-multi-tenant-isolation.test.mjs            # NUEVO — RF-T06-14
│   └── 14-full-lifecycle-e2e.test.mjs                # NUEVO — Escenarios E1–E8 completos
└── e2e-browser/
    ├── console-capability-display.spec.ts             # NUEVO — Tests Playwright para consola
    └── console-quota-display.spec.ts                  # NUEVO — Tests Playwright para cuotas en consola
```

## Arquitectura de la suite de pruebas

### 1. Capas de pruebas

La suite se organiza en tres capas complementarias:

| Capa | Herramienta | Alcance | Tiempo estimado |
|------|-------------|---------|-----------------|
| **Contract tests** | `node:test` + OpenAPI validation | Verifican que los endpoints de resolución y enforcement respetan su contrato (schemas, códigos HTTP, headers) | ~2 min |
| **Integration tests** | `node:test` | Verifican coherencia cross-subsistema: resolución ↔ gateway, resolución ↔ consola API, gateway ↔ consola API, propagación temporal | ~8 min |
| **E2E browser tests** | Playwright | Verifican que la consola React refleja correctamente capabilities y cuotas, incluyendo estados dinámicos (upgrade, downgrade, override) | ~5 min |

### 2. Patrón de test: Arrange → Assert coherence → Teardown

Cada test sigue un patrón estandarizado:

```text
1. ARRANGE
   - Crear tenant de prueba (prefijo `test-t06-{uuid}`)
   - Crear/asignar plan de prueba
   - Crear overrides si el escenario lo requiere
   - Crear workspaces/subcuotas si aplica
   - Crear recursos base si aplica

2. ACT + ASSERT COHERENCE
   - Consultar resolución de entitlements (T03)
   - Consultar gateway con request a ruta capability-gated (T05)
   - Consultar endpoints JSON de consola (T04)
   - Consultar eventos de auditoría en Kafka (T01/T05)
   - Comparar resultados entre subsistemas

3. TEARDOWN
   - Eliminar recursos creados
   - Revocar overrides
   - Eliminar workspaces
   - Eliminar tenant de prueba
```

### 3. Propagación y TTL

Las pruebas de coherencia temporal (plan change, override creation/revocation) usan un helper `waitForPropagation()` que:

- Hace polling al endpoint de resolución cada 500ms
- Compara el resultado con el estado esperado post-cambio
- Tiene un timeout configurable (env var `PROPAGATION_TTL_MS`, default 30000ms)
- Falla con mensaje descriptivo si el timeout expira sin convergencia

### 4. Gestión de identidad y tokens

```text
SUPERADMIN_CLIENT_ID / SUPERADMIN_CLIENT_SECRET → token superadmin (Keycloak)
TENANT_OWNER_USERNAME / TENANT_OWNER_PASSWORD → token tenant owner (Keycloak)
WORKSPACE_ADMIN_USERNAME / WORKSPACE_ADMIN_PASSWORD → token workspace admin (Keycloak)
```

El helper `auth.mjs` obtiene tokens via Keycloak client credentials o ROPC grant según el actor. Los tokens se cachean por ejecución de suite con refresh automático.

### 5. Seed data: planes de prueba

Se definen planes de prueba dedicados que no interfieren con planes de producción:

| Plan de prueba | Capabilities | Cuotas |
|----------------|-------------|--------|
| `test-starter` | `realtime: false`, `webhooks: false`, `sql_admin_api: false`, `passthrough_admin: false`, `public_functions: false`, `custom_domains: false`, `scheduled_functions: false` | `max_workspaces: 3 (hard)`, `max_pg_databases: 5 (hard)`, `max_kafka_topics: 5 (soft, grace: 2)`, `max_functions: 10 (hard)` |
| `test-professional` | `realtime: true`, `webhooks: true`, `sql_admin_api: true`, `passthrough_admin: false`, `public_functions: true`, `custom_domains: false`, `scheduled_functions: false` | `max_workspaces: 10 (hard)`, `max_pg_databases: 20 (hard)`, `max_kafka_topics: 50 (soft, grace: 10)`, `max_functions: 200 (hard)` |
| `test-enterprise` | todas `true` | `max_workspaces: -1 (unlimited)`, `max_pg_databases: 100 (hard)`, `max_kafka_topics: 200 (soft, grace: 50)`, `max_functions: -1 (unlimited)` |

### 6. Reporte de resultados

El helper `report.mjs` genera un reporte JSON al final de la ejecución:

```json
{
  "suite": "plan-enforcement-coherence",
  "timestamp": "2026-03-31T21:00:00Z",
  "environment": "test-cluster-01",
  "duration_ms": 540000,
  "total": 45,
  "passed": 44,
  "failed": 1,
  "results": [
    {
      "name": "E1 — capability coherence: webhooks enabled on professional",
      "scenario": "E1",
      "subsystems": ["resolution", "gateway", "console-api"],
      "result": "pass",
      "duration_ms": 2300
    }
  ]
}
```

El reporte se escribe en `test-results/plan-enforcement-report.json` y se publica como artefacto de CI.

## Secuencia de implementación recomendada

### Fase 1 — Infraestructura de test (T-01, T-02, T-03)

Primero se construyen los helpers, la configuración, y el framework de reporte. Sin esto, ningún test puede ejecutarse.

### Fase 2 — Tests de contract y coherencia API (T-04, T-05, T-06, T-07)

Tests que verifican coherencia entre resolución ↔ gateway ↔ consola API. Solo usan HTTP, no browser. Son los más estables y prioritarios.

### Fase 3 — Tests de propagación y ciclo de vida (T-08, T-09, T-10, T-11)

Tests que verifican comportamiento temporal: upgrade, downgrade, override lifecycle, deny-by-default. Dependen del helper `waitForPropagation`.

### Fase 4 — Tests de cuotas, subcuotas y ortogonalidad (T-12, T-13, T-14)

Tests que verifican enforcement de cuotas hard/soft, subcuotas de workspace, y la interacción capability-cuota.

### Fase 5 — Tests E2E de browser y lifecycle completo (T-15, T-16)

Tests con Playwright para la consola y el escenario de lifecycle completo E2E.

### Fase 6 — Integración CI y documentación (T-17)

Integración en el pipeline de CI/CD, README final, y reporte de cobertura.

## Dependencias externas

| Dependencia | Estado requerido | Validación |
|-------------|-----------------|------------|
| Subsistema T01 (cuotas hard/soft) | Desplegado en entorno de test | Health-check previo en suite |
| Subsistema T02 (capabilities booleanas) | Desplegado en entorno de test | Health-check previo en suite |
| Subsistema T03 (resolución efectiva) | Desplegado en entorno de test | Health-check previo en suite |
| Subsistema T04 (visualización consola) | Desplegado en entorno de test | Health-check previo en suite |
| Subsistema T05 (enforcement gateway) | Desplegado en entorno de test | Health-check previo en suite |
| Keycloak | Operativo con realm de test | Token acquisition en setup |
| Kafka | Operativo con topics de auditoría | Consumer connection en setup |
| PostgreSQL | Operativo con schema de planes | Seed data insertion en setup |
| APISIX | Operativo con plugins de enforcement | Route validation en setup |

## Variables de entorno requeridas

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `GATEWAY_BASE_URL` | URL base del gateway APISIX | `https://api.test.falcone.local` |
| `CONTROL_PLANE_URL` | URL base del control plane (acciones OpenWhisk) | `https://cp.test.falcone.local` |
| `CONSOLE_API_URL` | URL base de los endpoints JSON de la consola | `https://console.test.falcone.local/api` |
| `KEYCLOAK_URL` | URL de Keycloak | `https://auth.test.falcone.local` |
| `KEYCLOAK_REALM` | Realm de Keycloak | `falcone-test` |
| `SUPERADMIN_CLIENT_ID` | Client ID del superadmin | `test-superadmin` |
| `SUPERADMIN_CLIENT_SECRET` | Client secret del superadmin | (secreto de CI) |
| `KAFKA_BROKERS` | Brokers de Kafka | `kafka.test.falcone.local:9092` |
| `KAFKA_AUDIT_TOPIC` | Topic de eventos de auditoría | `platform.audit.events` |
| `PROPAGATION_TTL_MS` | TTL máximo de propagación (ms) | `30000` |
| `TEST_TENANT_PREFIX` | Prefijo para tenants de prueba | `test-t06` |
| `BROWSER_TEST_ENABLED` | Habilitar tests de browser E2E | `true` |
| `PLAYWRIGHT_BASE_URL` | URL de la consola para Playwright | `https://console.test.falcone.local` |

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|-----------|
| TTL variable causa flakiness | `waitForPropagation` con polling + timeout configurable; TTL como env var |
| Entorno de test incompleto | Health-check previo; tests se saltan con `skip` si el servicio no está disponible |
| Teardown incompleto deja residuos | UUID en nombres de tenant; cleanup con retries; script de cleanup global |
| Tests de browser lentos/frágiles | Suite de browser separada y opcional (`BROWSER_TEST_ENABLED`); foco en API tests primero |
| Kafka consumer no recibe eventos a tiempo | Polling con timeout configurable; verificación asíncrona con retry |

---

*Documento generado para el stage `speckit.plan` — US-PLAN-02-T06 | Rama: `108-plan-enforcement-tests`*
