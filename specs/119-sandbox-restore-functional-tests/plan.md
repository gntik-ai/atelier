# Plan de Implementación: US-BKP-02-T05 — Pruebas de restauración funcional parcial y total en entornos sandbox

**Branch**: `119-sandbox-restore-functional-tests` | **Date**: 2026-04-01 | **Spec**: [`spec.md`](./spec.md)
**Task ID**: US-BKP-02-T05 | **Epic**: EP-20 — Backup, recuperación y continuidad operativa | **Story**: US-BKP-02
**Dependencias**: US-TEN-04, US-BKP-01, US-BKP-02-T01, US-BKP-02-T02, US-BKP-02-T03, US-BKP-02-T04
**Input**: Especificación de feature desde `/specs/119-sandbox-restore-functional-tests/spec.md`

## Summary

Implementar un catálogo estructurado de pruebas de restauración funcional end-to-end que verifiquen la cadena completa export (T01) → formato versionado (T02) → validación previa de conflictos (T04) → reaprovisionamiento (T03) en entornos sandbox.

El conjunto de pruebas cubre restauración total sobre tenant vacío (golden path), restauración parcial por subconjunto de dominios, restauración sobre tenant con conflictos preexistentes, restauración con artefactos degradados, restauración con migración de formato, y edge cases operativos (fallo parcial y reintento, concurrencia bloqueada, tenant suspendido). Cada prueba es autocontenida, reproducible, y limpia sus propios tenants de referencia y destino.

La implementación se articula como un módulo de pruebas E2E bajo `tests/e2e/workflows/restore/` usando `node:test` y `undici` sobre las APIs reales del producto (sin acceso directo a base de datos), complementado por fixtures y helpers de seed bajo `tests/e2e/fixtures/restore/`.

---

## Technical Context

**Language/Version**: Node.js 20+ ESM (`"type": "module"`, pnpm workspaces)
**Primary Dependencies**: `node:test`, `node:assert`, `undici` (cliente HTTP para llamadas a APISIX), `kafkajs` (verificación de eventos de auditoría), `pg` (consultas de estado para fixtures y seed), credenciales de `service_account` con scope `platform:admin:config:export` y `platform:admin:config:reprovision`
**Storage**: PostgreSQL (consultas de fixture/seed y verificación de auditoría); los tenants de referencia y destino se crean/destruyen vía APIs del producto — sin acceso directo a las bases de datos internas de los subsistemas
**Testing**: `node:test` (runner nativo Node 20), `node:assert`, `undici` (HTTP), helpers propios de fixture y assertion
**Target Platform**: Entornos sandbox / integración sobre Kubernetes / OpenShift (los mismos donde están desplegadas T01–T04)
**Project Type**: Plataforma BaaS multi-tenant — suite de pruebas E2E de cadena de backup/restore
**Performance Goals**: Cada escenario individual completa en < 120 s (incluyendo seed, ejecución y cleanup); el catálogo completo en < 15 min en ejecución secuencial
**Constraints**: Las pruebas usan exclusivamente APIs del producto (sin bypass de subsistemas); cada prueba es autocontenida y deja el entorno limpio; las credenciales de prueba respetan el modelo de permisos de producción (actores `sre` o `service_account` con scopes reales); los artefactos generados pasan el mismo pipeline de redacción de secretos que en operación normal
**Scale/Scope**: 10 escenarios de prueba (E1–E5 + EC1–EC5), 6 dominios funcionales, multi-tenant strict, verificación de equivalencia funcional dominio a dominio, cleanup obligatorio post-ejecución

---

## Constitution Check

| Principio | Estado | Notas |
|---|---|---|
| I. Monorepo Separation of Concerns | ✅ PASS | Pruebas bajo `tests/e2e/workflows/restore/`; fixtures bajo `tests/e2e/fixtures/restore/`; contratos de verificación bajo `specs/119-sandbox-restore-functional-tests/contracts/`; ningún código de prueba en `apps/` ni `services/` |
| II. Incremental Delivery First | ✅ PASS | La suite se entrega por capas: helpers comunes → fixtures de seed → escenarios principals (E1–E5) → edge cases (EC1–EC5) → runner y reporte |
| III. Kubernetes and OpenShift Compatibility | ✅ PASS | Las pruebas son agnósticas de infraestructura; consumen solo las APIs APISIX del producto sin asumir topología de red interna |
| IV. Quality Gates at the Root | ✅ PASS | Se añade script raíz `test:e2e:restore` que ejecuta la suite; integreable en CI con `NODE_ENV=sandbox` |
| V. Documentation as Part of the Change | ✅ PASS | Plan, research.md, data-model.md y quickstart.md documentan la implementación; `specs/119-sandbox-restore-functional-tests/contracts/` formaliza los schemas de reporte |

No hay violaciones que requieran `Complexity Tracking`.

---

## Project Structure

### Documentation (this feature)

```text
specs/119-sandbox-restore-functional-tests/
├── spec.md                                  ← ya existe
├── plan.md                                  ← este archivo
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    └── restore-test-report.json             ← JSON Schema del informe de resultados
```

### Tests: suite E2E de restauración

```text
tests/e2e/
├── workflows/
│   └── restore/
│       ├── index.test.mjs                   ← runner principal: ejecuta todos los escenarios y genera informe
│       ├── e1-full-restore-empty-tenant.test.mjs
│       ├── e2-partial-restore-domain-subset.test.mjs
│       ├── e3-restore-with-conflicts.test.mjs
│       ├── e4-restore-degraded-artifact.test.mjs
│       ├── e5-restore-format-migration.test.mjs
│       ├── ec1-partial-failure-retry.test.mjs
│       ├── ec2-tenant-id-mismatch.test.mjs
│       ├── ec3-concurrent-restore-blocked.test.mjs
│       ├── ec4-max-size-artifact.test.mjs
│       └── ec5-suspended-tenant-rejected.test.mjs
└── fixtures/
    └── restore/
        ├── tenant-factory.mjs               ← crea/destruye tenants de referencia y destino
        ├── seed-iam.mjs                     ← seed de IAM (roles, grupos, client scopes, IdPs)
        ├── seed-postgres.mjs                ← seed de metadata PostgreSQL (esquemas, tablas, vistas)
        ├── seed-kafka.mjs                   ← seed de topics y ACLs
        ├── seed-storage.mjs                 ← seed de buckets y políticas
        ├── seed-functions.mjs               ← seed de paquetes y acciones OpenWhisk (opcional)
        ├── seed-mongo.mjs                   ← seed de colecciones e índices MongoDB (opcional)
        ├── artifact-builder.mjs             ← invoca la API de exportación T01 y captura el artefacto
        ├── assert-equivalence.mjs           ← comparador dominio-a-dominio artefacto vs. tenant destino
        └── cleanup.mjs                      ← limpieza robusta con reintentos por ejecución-id
```

### Helpers compartidos

```text
tests/e2e/helpers/
├── api-client.mjs                           ← wrapper undici con autenticación JWT
├── correlation.mjs                          ← generador de correlation-id por ejecución de prueba
├── retry.mjs                                ← helper de reintento para operaciones de cleanup
└── report-writer.mjs                        ← serializa el informe de resultados a JSON + texto
```

> **Estructura Decision**: Todos los archivos de esta feature residen bajo `tests/e2e/` (para pruebas ejecutables) y `specs/119-sandbox-restore-functional-tests/` (para documentación, contratos y plan). No se añade código a `apps/` ni `services/`.

---

## Design & Implementation Plan

### 1) Arquitectura general de la suite

La suite se estructura como un conjunto de módulos de prueba independientes (`node:test`) que comparten helpers y fixtures pero no comparten estado entre ellos. Cada módulo sigue el mismo ciclo:

```text
1. SETUP    — crear tenants de referencia + destino con IDs únicos basados en UUID
2. SEED     — poblar tenant de referencia vía APIs del producto
3. EXPORT   — invocar POST /v1/admin/tenants/{src}/config/export → artefacto JSON
4. VALIDATE — invocar POST /v1/admin/tenants/{dst}/config/reprovision/preflight
5. APPLY    — invocar POST /v1/admin/tenants/{dst}/config/reprovision
6. ASSERT   — verificar equivalencia funcional usando el artefacto como referencia canónica
7. CLEANUP  — destruir tenants creados (src + dst) vía APIs del producto
```

El módulo `index.test.mjs` actúa como orquestador: importa todos los escenarios, los ejecuta (en paralelo o secuencial según `RESTORE_TEST_PARALLELISM` env var), y escribe el informe final de resultados.

**Verificación de equivalencia**: La comparación dominio-a-dominio en `assert-equivalence.mjs` invoca el endpoint de estado del tenant destino para cada dominio (o el endpoint de exportación del tenant destino) y compara contra el artefacto de origen aplicando los mismos filtros de identificadores internos que el mapa de T03. Las diferencias se reportan como fallos de prueba con `assert.deepStrictEqual` y mensajes estructurados.

**No se accede directamente a bases de datos internas**: Las verificaciones se hacen exclusivamente a través de las APIs del producto. Esto garantiza que las pruebas validan la misma interfaz que usa un operador real.

### 2) Fixtures y seed

#### `tenant-factory.mjs`

```js
/**
 * Crea un tenant de referencia y uno destino con identificadores únicos.
 *
 * @param {string} executionId - UUID de la ejecución, incluido en los nombres de tenant
 * @param {Object} opts
 * @param {boolean} [opts.withSuspendedDst=false] - crea el tenant destino en estado 'suspended'
 * @param {string[]} [opts.domains=['iam','postgres_metadata','kafka','storage']] - dominios a sembrar
 * @returns {Promise<{ srcTenantId: string, dstTenantId: string, cleanup: () => Promise<void> }>}
 */
export async function createTestTenants(executionId, opts);
```

Los tenants se crean con nombres del patrón `test-restore-{executionId}-src` y `test-restore-{executionId}-dst`. La función devuelve una función `cleanup()` que destruye ambos tenants con reintentos.

#### Módulos de seed

Cada módulo de seed (`seed-iam.mjs`, `seed-postgres.mjs`, etc.) expone una función `seedDomain(tenantId, executionId, level)`:

- `level` controla la cantidad de recursos a crear: `minimal` (1–2 recursos, para pruebas de edge case) / `standard` (5–10 recursos por tipo) / `conflicting` (incluye recursos diseñados para conflictar con una segunda carga).
- Los recursos tienen nombres únicos que incluyen `executionId` para evitar colisiones entre ejecuciones concurrentes.
- Cada seed devuelve un manifiesto de los recursos creados, que sirve como referencia para las aserciones de equivalencia.

#### `artifact-builder.mjs`

```js
/**
 * Invoca la exportación T01 para el tenant dado y devuelve el artefacto como objeto JSON.
 *
 * @param {string} tenantId
 * @param {string[]} [domains] - si se omite, exporta todos los dominios disponibles
 * @param {ApiClient} client
 * @returns {Promise<Object>} artefacto JSON
 */
export async function buildArtifact(tenantId, domains, client);
```

#### `assert-equivalence.mjs`

```js
/**
 * Compara el tenant destino contra el artefacto de origen, dominio a dominio.
 * Lanza AssertionError con detalle estructurado si encuentra diferencias.
 *
 * @param {string} dstTenantId
 * @param {Object} artifact - artefacto de exportación del tenant origen
 * @param {string[]} domainsToCheck - dominios a comparar
 * @param {ApiClient} client
 */
export async function assertEquivalence(dstTenantId, artifact, domainsToCheck, client);
```

La equivalencia se verifica exportando el tenant destino y comparando los datos de cada dominio contra el artefacto. Se excluyen identificadores internos conocidos (IDs de realm Keycloak, schema prefix PostgreSQL, namespace OpenWhisk) mediante la misma lógica de identifier-map de T03.

### 3) Escenarios de prueba

#### E1 — Restauración total sobre tenant vacío (golden path)

**Archivo**: `e1-full-restore-empty-tenant.test.mjs`

```text
Precondiciones:
  - Tenant origen con los 6 dominios sembrados (level=standard)
  - Tenant destino vacío
  
Pasos:
  1. buildArtifact(src, all_domains)
  2. preflight(dst, artifact) → assert risk_level IN ('low', 'medium'), zero critical conflicts
  3. reprovision(dst, artifact, identifier_map) → assert HTTP 200, todos los dominios applied
  4. assertEquivalence(dst, artifact, all_active_domains)
  5. cleanup()

Criterio de éxito (CA-01):
  - assertEquivalence pasa sin diferencias
  - reprovision.result.summary.failed_domains === []
  - Evento Kafka de reaprovisionamiento publicado con correlation_id trazable
```

#### E2 — Restauración parcial: solo dominios seleccionados

**Archivo**: `e2-partial-restore-domain-subset.test.mjs`

```text
Ejecuciones (2 combinaciones para CA-02):
  - Combo A: dominios ['iam', 'postgres_metadata']
  - Combo B: dominios ['kafka', 'functions'] (si OW habilitado) o ['kafka', 'storage']

Pasos por combinación:
  1. buildArtifact(src, all_domains)
  2. reprovision(dst, artifact, { domains: combo, identifier_map })
  3. assertEquivalence(dst, artifact, combo)
  4. assertDomainEmpty(dst, all_domains - combo)  // dominios no restaurados = vacíos
  5. cleanup()

Criterio de éxito (CA-02):
  - Dominios solicitados: assertEquivalence pasa
  - Dominios no solicitados: assertDomainEmpty pasa (sin artefactos residuales)
```

#### E3 — Restauración sobre tenant con configuración preexistente (con conflictos)

**Archivo**: `e3-restore-with-conflicts.test.mjs`

```text
Precondiciones:
  - Tenant origen con seed level=standard
  - Tenant destino con seed 'conflicting' en IAM (roles con nombres idénticos pero diferentes composites)

Pasos:
  1. buildArtifact(src)
  2. preflight(dst, artifact) → assert conflictos detectados, risk_level IN ('medium', 'high', 'critical')
  3. reprovision(dst, artifact) → assert HTTP 200
  4. Verificar que los recursos sin conflicto se aplicaron (assertEquivalence para recursos no conflictivos)
  5. Verificar que los recursos en conflicto NO se modificaron (assertConflictsPreserved)
  6. cleanup()

Criterio de éxito (CA-03):
  - preflight.domains[iam].conflicts.length > 0
  - reprovision.result.domains[iam].conflicts === preflight.domains[iam].conflicts (mismos recursos)
  - Los recursos en conflicto en el destino mantienen su valor original
```

#### E4 — Restauración con artefacto que contiene dominios degradados

**Archivo**: `e4-restore-degraded-artifact.test.mjs`

```text
Precondiciones:
  - Artefacto construido artificialmente (o exportando con MONGO_ENABLED=false) con
    domains.mongo_metadata.status = 'not_available'

Pasos:
  1. Construir artefacto con dominio mongo_metadata degradado (status='not_available')
  2. reprovision(dst, artifact) → assert HTTP 200
  3. Verificar que los dominios con datos válidos se aplicaron
  4. Verificar que mongo_metadata aparece como 'skipped' en el resultado
  5. cleanup()

Criterio de éxito (CA-04):
  - reprovision.result.domains donde status='not_available' → skipped en resultado
  - Los dominios válidos tienen status='applied' o 'skipped' (ya existía y era igual)
  - Ningún error inesperado en el resultado
```

#### E5 — Restauración con migración de formato

**Archivo**: `e5-restore-format-migration.test.mjs`

```text
Precondiciones:
  - Existe al menos una migración de formato disponible en T02 (de '1.0' a '1.0.0' o similar)
  - Si no existe migración disponible → test marcado como SKIP con mensaje claro

Pasos:
  1. Construir artefacto con format_version anterior (simulado o vía API de migración T02)
  2. Invocar POST /v1/admin/config/migrate para actualizar al formato vigente
  3. reprovision(dst, artifact_migrado) → assert HTTP 200
  4. assertEquivalence(dst, artifact_migrado, active_domains)
  5. cleanup()

Criterio de éxito (implicit):
  - Artefacto migrado produce reaprovisionamiento funcional equivalente al de un artefacto nativo
```

#### EC1 — Fallo parcial durante reaprovisionamiento y reintento posterior

**Archivo**: `ec1-partial-failure-retry.test.mjs`

```text
Estrategia de fallo: construir un artefacto con datos inválidos para un dominio específico
  (por ejemplo, kafka topics con numPartitions=-1) para forzar un fallo de aplicación controlado.

Pasos:
  1. buildArtifact(src) para dominios válidos (IAM, PostgreSQL)
  2. Inyectar datos inválidos en kafka_topics del artefacto
  3. reprovision(dst, artifact_with_bad_kafka) → assert HTTP 207 o 200 con dominios fallidos
  4. Verificar que IAM y PostgreSQL se aplicaron correctamente
  5. Verificar que kafka aparece con status='error' en el resultado
  6. Construir artefacto correcto solo para kafka
  7. reprovision(dst, kafka_only_artifact, { domains: ['kafka'] }) → assert HTTP 200
  8. assertEquivalence(dst, original_artifact, ['kafka'])
  9. cleanup()

Criterio de éxito (CA-05):
  - Dominios ya aplicados (IAM, PostgreSQL) no se revierten tras el fallo de kafka
  - Reintento selectivo de kafka completa la restauración
```

#### EC2 — Tenant de origen inexistente en entorno destino

**Archivo**: `ec2-tenant-id-mismatch.test.mjs`

```text
Precondiciones:
  - Artefacto exportado de tenant-src con identificadores específicos del origen

Pasos:
  1. buildArtifact(src) → artefacto con tenant_id=src
  2. preflight(dst, artifact) → assert needs_confirmation=true, identifier_map_proposal presente
  3. reprovision(dst, artifact, confirmed_identifier_map) → assert HTTP 200
  4. assertEquivalence(dst, artifact_with_applied_map, active_domains)
  5. cleanup()

Criterio de éxito:
  - preflight detecta la discrepancia de tenant_id y propone mapa
  - reprovision con mapa confirmado produce tenant destino funcional
```

#### EC3 — Restauración concurrente bloqueada

**Archivo**: `ec3-concurrent-restore-blocked.test.mjs`

```text
Pasos:
  1. Iniciar reprovision(dst, artifact) — no esperar la respuesta (fire-and-forget con timeout largo)
  2. Inmediatamente intentar segundo reprovision(dst, artifact)
  3. assert segundo reprovision → HTTP 409 con código 'REPROVISION_IN_PROGRESS'
  4. Esperar que el primero complete → assert HTTP 200
  5. cleanup()

Criterio de éxito:
  - El mecanismo de lock de T03 rechaza la segunda operación concurrente
  - El primer reaprovisionamiento completa correctamente
```

#### EC4 — Artefacto con tamaño máximo permitido

**Archivo**: `ec4-max-size-artifact.test.mjs`

```text
Pasos:
  1. Generar artefacto artificial que se acerque a CONFIG_EXPORT_MAX_ARTIFACT_BYTES (10 MB por defecto)
  2. preflight(dst, large_artifact) → assert responde en < 30 s, sin timeout ni error de tamaño
  3. reprovision(dst, large_artifact) → assert HTTP 200, sin errores de truncamiento
  4. cleanup()

Criterio de éxito:
  - El sistema maneja el artefacto de máximo tamaño sin error
```

#### EC5 — Restauración sobre tenant en estado suspendido

**Archivo**: `ec5-suspended-tenant-rejected.test.mjs`

```text
Precondiciones:
  - Tenant destino en estado 'suspended' (creado con opts.withSuspendedDst=true)

Pasos:
  1. buildArtifact(src)
  2. reprovision(suspended_dst, artifact) → assert HTTP 422 o 409, error claro de tenant suspendido
  3. cleanup()

Criterio de éxito:
  - El sistema rechaza la operación con un error descriptivo
  - El tenant suspendido no se modifica
```

### 4) Runner principal e informe de resultados

#### `index.test.mjs`

El runner principal:
1. Lee la configuración de ejecución desde variables de entorno (`RESTORE_TEST_API_BASE_URL`, `RESTORE_TEST_AUTH_TOKEN`, `RESTORE_TEST_PARALLELISM`, `RESTORE_TEST_DOMAINS_ENABLED`).
2. Importa todos los escenarios.
3. Ejecuta los escenarios (secuencial por defecto; paralelo si `RESTORE_TEST_PARALLELISM=true`).
4. Captura el resultado de cada escenario: `pass`, `fail` o `skip` con duración y detalle de fallos.
5. Invoca `report-writer.mjs` para escribir el informe en `$RESTORE_TEST_REPORT_OUTPUT` (default: `restore-test-report.json`).
6. Emite salida estructurada al stderr del proceso para integración CI.

El informe de resultados sigue el schema definido en `contracts/restore-test-report.json` (ver data-model.md).

### 5) Variables de entorno de la suite

| Variable | Descripción | Default |
|---|---|---|
| `RESTORE_TEST_API_BASE_URL` | URL base APISIX del entorno sandbox | `http://localhost:9080` |
| `RESTORE_TEST_AUTH_TOKEN` | JWT de service_account con scopes de export y reprovision | — |
| `RESTORE_TEST_PARALLELISM` | Ejecutar escenarios en paralelo | `false` |
| `RESTORE_TEST_DOMAINS_ENABLED` | Dominios habilitados en el sandbox (CSV) | `iam,postgres_metadata,kafka,storage` |
| `RESTORE_TEST_OW_ENABLED` | Habilitar escenarios que requieren OpenWhisk | `false` |
| `RESTORE_TEST_MONGO_ENABLED` | Habilitar escenarios que requieren MongoDB | `false` |
| `RESTORE_TEST_REPORT_OUTPUT` | Ruta del archivo de informe JSON | `restore-test-report.json` |
| `RESTORE_TEST_CLEANUP_RETRIES` | Número de reintentos de cleanup | `3` |
| `RESTORE_TEST_SCENARIO_TIMEOUT_MS` | Timeout por escenario | `120000` |
| `RESTORE_TEST_CORRELATION_PREFIX` | Prefijo de correlation_id por ejecución | `restore-e2e` |

### 6) Script raíz

Añadir al `package.json` raíz el script:

```json
{
  "scripts": {
    "test:e2e:restore": "node --test tests/e2e/workflows/restore/index.test.mjs"
  }
}
```

Y en `tests/e2e/workflows/restore/` añadir un `README.md` con instrucciones de ejecución y variables de entorno requeridas (ver `quickstart.md`).

---

## Data, Metadata, Events, Secrets, and Infra

### Modelo de datos de la suite de pruebas

No se añaden tablas PostgreSQL permanentes para la suite de pruebas. El informe de resultados es un artefacto en fichero. Ver `data-model.md` para el schema JSON completo del informe de resultados.

Los tenants de referencia y destino se crean vía APIs del producto; los metadatos de los tenants (IDs, timestamps, estado de cleanup) se mantienen en memoria durante la ejecución.

### Kafka

Las pruebas verifican que los eventos de auditoría de T01, T03 y T04 se publican correctamente. El helper `api-client.mjs` incluye un consumer Kafka ligero para verificación de eventos.

La suite **no publica eventos propios** de auditoría; las operaciones verificadas generan sus propios eventos a través de las APIs del producto.

### Secrets

- Las credenciales de la suite (`RESTORE_TEST_AUTH_TOKEN`) se inyectan como variables de entorno y nunca se registran en logs ni reportes.
- Los artefactos de exportación generados durante las pruebas pasan el mismo pipeline de redacción de secretos que en operación normal (gestionado por T01, no por la suite).
- Los tenants de prueba no deben utilizarse para datos sensibles reales.

### Infrastructure

- La suite es independiente de la infraestructura: consume solo las APIs APISIX del producto.
- No requiere nuevos ConfigMaps, Secrets, Helm charts ni despliegues adicionales.
- El entorno sandbox debe tener las acciones OpenWhisk de T01, T03 y T04 desplegadas y accesibles vía APISIX.

---

## Testing Strategy

### Escenarios de prueba E2E (la suite misma)

Ver sección 3. Los 10 escenarios (E1–E5 + EC1–EC5) son la entrega principal de esta tarea.

### Pruebas del informe de resultados

- `report-writer.mjs` tiene pruebas unitarias que verifican que el schema del informe generado es válido contra `contracts/restore-test-report.json` (Ajv).

### Pruebas de los helpers de fixture

- `tenant-factory.mjs`: creación y destrucción de tenants vía mock de API.
- `assert-equivalence.mjs`: comparación correcta incluyendo exclusión de identificadores internos; diferencias encontradas lanzan AssertionError con mensaje estructurado.
- `cleanup.mjs`: reintentos ante fallo de cleanup; identificación de residuos por execution_id.

### Contrato del informe de resultados

- JSON Schema `contracts/restore-test-report.json` es válido (Ajv meta-schema).
- Validación automática del informe generado contra el schema al final de cada ejecución de la suite.

### Validación operativa

- Verificar que todas las pruebas limpian sus tenants correctamente incluso si el escenario falla.
- Verificar que los artefactos de exportación generados contienen `***REDACTED***` en campos sensibles (no exponen secretos).
- Verificar que el runner respeta `RESTORE_TEST_SCENARIO_TIMEOUT_MS` y marca el escenario como `fail` en lugar de colgar indefinidamente.

---

## Implementation Sequence and Parallelization

### Orden recomendado

1. **Contratos y schema del informe** (`contracts/restore-test-report.json`) — define el contrato de salida antes de implementar el runner.
2. **Helpers comunes** (`api-client.mjs`, `correlation.mjs`, `retry.mjs`, `report-writer.mjs`) — base compartida; sin dependencias de fixtures.
3. **`tenant-factory.mjs` + `cleanup.mjs`** — gestión del ciclo de vida de tenants de prueba.
4. **Módulos de seed** (`seed-iam.mjs`, `seed-postgres.mjs`, `seed-kafka.mjs`, `seed-storage.mjs`) — poblar dominios vía API; pueden desarrollarse en paralelo.
5. **`artifact-builder.mjs` + `assert-equivalence.mjs`** — cadena de exportación y comparación.
6. **Escenario E1 (golden path)** — verifica la cadena completa; sirve como smoke test de la suite.
7. **Escenarios E2–E5** — una vez E1 funciona, estos son variantes del mismo patrón.
8. **Edge cases EC1–EC5** — requieren seed especializado; pueden desarrollarse en paralelo con E2–E5.
9. **Runner `index.test.mjs` + `report-writer.mjs`** — integra todos los escenarios y produce el informe.
10. **Script raíz + `quickstart.md`** — wiring CI y documentación de ejecución.

### Paralelizable

- Los módulos de seed (pasos 4) pueden implementarse en paralelo una vez `tenant-factory.mjs` está disponible.
- Los escenarios E2–E5 y EC1–EC5 (pasos 7 y 8) pueden desarrollarse en paralelo una vez E1 funciona y el contrato de los fixtures está estable.
- El schema del informe (paso 1) puede desarrollarse en paralelo con los helpers (paso 2).

---

## Risks, Compatibility, Rollback, Idempotency, Observability, Security

### Risks

| ID | Descripción | Probabilidad | Impacto | Mitigación |
|---|---|---|---|---|
| R-01 | El entorno sandbox puede no tener todos los dominios habilitados (MongoDB, OpenWhisk deshabilitados por defecto), lo que reduce la cobertura de las pruebas de restauración total | Alta | Medio | Las pruebas consultan el endpoint de dominios exportables de T01 y adaptan dinámicamente las expectativas. Los dominios opcionales se marcan como SKIP con mensaje claro. |
| R-02 | La simulación de fallos parciales (EC1) puede ser difícil de reproducir determinísticamente en entorno sandbox estándar | Media | Medio | Se usa inyección de datos inválidos en el artefacto (en lugar de simular caída de subsistemas) para forzar fallos de aplicación controlados y reproducibles. |
| R-03 | La limpieza de tenants puede fallar (el sandbox no responde, el tenant ya fue eliminado), dejando residuos | Media | Bajo | `cleanup.mjs` implementa reintentos configurables + identificación de residuos por execution_id. Los residuos son tenants de prueba con prefijo conocido, fáciles de limpiar manualmente. |
| R-04 | Las pruebas de equivalencia pueden ser demasiado estrictas si el producto añade campos nuevos al artefacto sin versionarlos correctamente | Baja | Medio | `assert-equivalence.mjs` compara solo campos documentados en el contrato del artefacto (T02), ignorando campos desconocidos adicionales. |
| R-05 | Las pruebas de concurrencia (EC3) pueden ser flaky si el timing entre las dos solicitudes no es suficientemente pequeño | Media | Bajo | EC3 usa un artefacto grande o un delay artificial en la primera solicitud para garantizar que el lock esté activo cuando llega la segunda solicitud. |

### Compatibility

- La suite es puramente aditiva: no modifica ningún artefacto existente de T01–T04.
- No requiere cambios de schema, contratos ni variables de entorno de las acciones OpenWhisk.
- Compatible con el estado actual del repo (branch `119-sandbox-restore-functional-tests` sobre main que incluye T01–T04).

### Rollback

- La suite de pruebas puede eliminarse sin impacto funcional sobre el producto.
- Si una prueba deja tenants residuales (por fallo de cleanup), pueden identificarse por el prefijo `test-restore-` y eliminarse manualmente.

### Idempotency

- Cada ejecución de la suite usa un `execution_id` único (UUID), garantizando que múltiples ejecuciones simultáneas no colisionan en nombres de tenants.
- Las pruebas son idempotentes respecto al entorno: no dejan estado persistente entre ejecuciones (cleanup obligatorio).

### Observability and Security

- El runner produce un informe estructurado por ejecución con correlation_id global.
- Los errores de cada escenario incluyen dominio, recurso, campo, valor esperado vs. obtenido.
- El `RESTORE_TEST_AUTH_TOKEN` no se registra en el informe ni en los logs de prueba.
- Los artefactos de exportación generados durante las pruebas contienen secretos redactados (`***REDACTED***`), nunca en claro.
- Los tenants de prueba se eliminan al finalizar; no persisten datos reales.

---

## Done Criteria / Evidence Expected

La tarea está completa cuando todo lo siguiente es verdad:

1. `plan.md`, `research.md`, `data-model.md`, `quickstart.md` y `contracts/restore-test-report.json` existen bajo `specs/119-sandbox-restore-functional-tests/`.
2. Los 10 módulos de prueba (`e1-*.mjs` a `ec5-*.mjs`) existen bajo `tests/e2e/workflows/restore/` con su estructura completa de pasos, aserciones y cleanup.
3. Los 6 fixtures de seed existen bajo `tests/e2e/fixtures/restore/` (incluidos los opcionales `seed-functions.mjs` y `seed-mongo.mjs` con flag de skip).
4. Los helpers comunes (`api-client.mjs`, `correlation.mjs`, `retry.mjs`, `report-writer.mjs`) existen bajo `tests/e2e/helpers/`.
5. El runner `index.test.mjs` integra todos los escenarios, produce un informe conforme al schema `contracts/restore-test-report.json`, y se invoca desde el script raíz `test:e2e:restore`.
6. Las pruebas de helpers y de validación del schema del informe tienen cobertura de las rutas principales.
7. El plan **no avanza a `speckit.tasks`** ni introduce implementación de código de producto en T01–T04.
8. Los artefactos `spec.md` de la feature no han sido modificados.
9. El worktree contiene solo los archivos del plan-stage de esta feature, sin archivos temporales.
