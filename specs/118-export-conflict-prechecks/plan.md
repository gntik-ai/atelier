# Plan de Implementación: US-BKP-02-T04 — Validaciones previas para detectar conflictos entre export existente y entorno destino

**Branch**: `118-export-conflict-prechecks` | **Date**: 2026-04-01 | **Spec**: [`spec.md`](./spec.md)
**Task ID**: US-BKP-02-T04 | **Epic**: EP-20 — Backup, recuperación y continuidad operativa | **Story**: US-BKP-02
**Dependencias**: US-TEN-04, US-BKP-01, US-BKP-02-T01, US-BKP-02-T02, US-BKP-02-T03
**Input**: Especificación de feature desde `/specs/118-export-conflict-prechecks/spec.md`

## Summary

Implementar un servicio de validación previa (pre-flight check) que, dado un artefacto de exportación y un tenant destino, analice todos los dominios en modo **solo lectura** y produzca un informe estructurado de conflictos clasificados por severidad antes de que el operador decida ejecutar el reaprovisionamiento (T03).

La solución reutiliza el motor de comparación de T03 (`diff.mjs`, `identifier-map.mjs`) y lo extiende con:
- un módulo `preflight/` que implementa analizadores de dominio (contrapartes read-only de los aplicadores de T03),
- un clasificador de severidad basado en tabla configurable (`conflict-classifier.mjs`),
- un motor de recomendaciones por tipo de conflicto (`recommendation-engine.mjs`),
- y un action OpenWhisk `tenant-config-preflight.mjs` expuesto vía APISIX bajo el mismo scope de autorización que T03.

Decisiones clave:
- La validación previa **no adquiere el lock de reaprovisionamiento** de T03; es un análisis puramente read-only sin efectos secundarios en los subsistemas.
- Los analizadores de dominio se ejecutan **en paralelo** (`Promise.allSettled`) para reducir la latencia total. El fallo de un analizador no aborta los demás.
- La clasificación de severidad se implementa como una **tabla de datos**, no como ramas `if/else`, para facilitar evolución sin cambios de código.
- Las recomendaciones son específicas al tipo de recurso y severidad, almacenadas en un mapa de lookup en `recommendation-engine.mjs`.
- Los campos `***REDACTED***` del artefacto se excluyen de la comparación; si el único campo diferente es un secreto redactado, el recurso se clasifica como `compatible_with_redacted_fields` en lugar de `conflict`.
- El endpoint devuelve `200` para análisis completo y `200` con `incomplete_analysis: true` para análisis parcial (fallo de subsistemas individuales). No emite `207` ni `500`.
- Si el `tenant_id` del artefacto difiere del destino y no se proporciona mapa de identificadores, el endpoint devuelve la propuesta de mapa con `needs_confirmation: true` sin ejecutar el análisis.

---

## Technical Context

**Language/Version**: Node.js 20+ ESM (`"type": "module"`, pnpm workspaces) + React 18 + TypeScript en consola
**Primary Dependencies**: `pg`, `kafkajs`, `undici`, `ajv`, React + Tailwind CSS + shadcn/ui
**Storage**: PostgreSQL (auditoría); análisis ejecutado completamente en memoria; dependencias externas Keycloak, Kafka, MongoDB, S3-compatible, OpenWhisk (todas accesadas en modo read-only)
**Testing**: `node:test`, `node:assert`, `undici` (contracts/integration), `vitest` + React Testing Library (console)
**Target Platform**: Kubernetes / OpenShift con Helm, acción OpenWhisk detrás de APISIX
**Project Type**: Plataforma BaaS multi-tenant de control plane + serverless actions + console web
**Performance Goals**: análisis estándar (hasta 50 recursos por dominio) completado en < 30 s; adquisición de auditoría < 1 s; análisis de dominios en paralelo
**Constraints**: no adquirir lock de T03; no almacenar el artefacto; no modificar ningún recurso; auditoría obligatoria; campos redactados excluidos del diff; multi-tenant estricto; secretos nunca en logs/DB/eventos
**Scale/Scope**: 6 dominios funcionales, decenas de recursos por dominio, multi-tenant estricto, análisis paralelo, resultado completo con severidad y recomendaciones por recurso

---

## Constitution Check

| Principio | Estado | Notas |
|---|---|---|
| I. Monorepo Separation of Concerns | ✅ PASS | Backend en `services/provisioning-orchestrator/src/`; consola en `apps/web-console/src/`; rutas en `services/gateway-config/`; specs y contratos en `specs/118-export-conflict-prechecks/` |
| II. Incremental Delivery First | ✅ PASS | La feature se entrega por capas: contrato, auditoría, módulo preflight, analizadores por dominio, UI, pruebas |
| III. Kubernetes and OpenShift Compatibility | ✅ PASS | Reutiliza acciones OpenWhisk y recursos Helm/APISIX existentes; no introduce dependencias de plataforma no portables |
| IV. Quality Gates at the Root | ✅ PASS | Contratos, integración y consola se verifican con scripts raíz existentes + tests nuevos en ubicaciones estándar |
| V. Documentation as Part of the Change | ✅ PASS | Plan, research.md, data-model.md y contratos documentan la implementación propuesta |

No hay violaciones que requieran `Complexity Tracking`.

---

## Project Structure

### Documentation (this feature)

```text
specs/118-export-conflict-prechecks/
├── spec.md                                  ← ya existe
├── plan.md                                  ← este archivo
├── research.md
├── data-model.md
└── contracts/
    ├── tenant-config-preflight.json         ← OpenAPI
    └── config-preflight-audit-event.json    ← JSON Schema Kafka event
```

### Backend: provisioning-orchestrator

```text
services/provisioning-orchestrator/src/
├── actions/
│   └── tenant-config-preflight.mjs          ← nuevo (OpenWhisk action)
├── preflight/                               ← nuevo módulo feature-scoped
│   ├── types.mjs
│   ├── conflict-classifier.mjs
│   ├── recommendation-engine.mjs
│   └── analyzers/
│       ├── iam-analyzer.mjs
│       ├── postgres-analyzer.mjs
│       ├── mongo-analyzer.mjs
│       ├── kafka-analyzer.mjs
│       ├── functions-analyzer.mjs
│       └── storage-analyzer.mjs
├── repositories/
│   └── config-preflight-audit-repository.mjs
└── migrations/
    └── 118-config-preflight.sql
```

> **Reutilización de T03**: Los analizadores importan directamente desde `../reprovision/diff.mjs` e `../reprovision/identifier-map.mjs`. No se duplica la lógica de comparación ni la de aplicación del mapa de identificadores.

### Gateway

```text
services/gateway-config/routes/
└── backup-admin-routes.yaml                 ← MODIFICAR (añadir ruta preflight)
```

> **Keycloak**: No requiere cambio de scopes. T04 reutiliza `platform:admin:config:reprovision` definido en T03.

### Console

```text
apps/web-console/src/
├── api/
│   └── configPreflightApi.ts
├── components/
│   ├── PreflightConflictReport.tsx
│   └── PreflightRiskBadge.tsx
└── pages/
    └── ConsoleTenantConfigPreflightPage.tsx
```

### Tests

```text
tests/contracts/
├── tenant-config-preflight.contract.test.mjs
└── config-preflight-audit-event.contract.test.mjs

tests/e2e/workflows/
└── tenant-config-preflight.test.mjs

services/provisioning-orchestrator/tests/preflight/
├── conflict-classifier.test.mjs
├── recommendation-engine.test.mjs
├── iam-analyzer.test.mjs
├── postgres-analyzer.test.mjs
├── mongo-analyzer.test.mjs
├── kafka-analyzer.test.mjs
├── functions-analyzer.test.mjs
└── storage-analyzer.test.mjs

services/provisioning-orchestrator/src/tests/actions/
└── tenant-config-preflight.test.mjs
```

---

## Design & Implementation Plan

### 1) Backend domain model and persistence

1. Añadir la migración `118-config-preflight.sql` con la tabla `config_preflight_audit_log`. Ver `data-model.md` para DDL completo.
2. La tabla almacena: actor, tenant_id destino, tenant_id origen, dominios analizados, resumen de conflictos por severidad (conteos), riesgo global, flag de análisis incompleto, artifact_checksum, identifier_map_hash, correlation_id y timestamp. No almacena el artefacto completo ni los valores redactados.
3. Proporcionar el módulo repositorio `config-preflight-audit-repository.mjs` con `insertPreflightAuditLog` y `getPreflightAuditByCorrelationId`.

### 2) Módulo `preflight/` — runtime compartido del análisis

#### `preflight/types.mjs`

Define las constantes y typedefs del módulo de validación previa:

```js
export const PREFLIGHT_RESOURCE_STATUSES = /** @type {const} */ ({
  COMPATIBLE: 'compatible',
  COMPATIBLE_REDACTED: 'compatible_with_redacted_fields',
  CONFLICT: 'conflict',
});

export const SEVERITY_LEVELS = /** @type {const} */ (['low', 'medium', 'high', 'critical']);

export const DOMAIN_ANALYSIS_STATUSES = /** @type {const} */ ({
  ANALYZED: 'analyzed',
  NO_CONFLICTS: 'no_conflicts',
  SKIPPED: 'skipped_not_exportable',
  ERROR: 'analysis_error',
});

/**
 * @typedef {Object} ConflictEntry
 * @property {string} resource_type
 * @property {string} resource_name
 * @property {string|null} resource_id
 * @property {'low'|'medium'|'high'|'critical'} severity
 * @property {Object|null} diff
 * @property {string} recommendation
 */

/**
 * @typedef {Object} DomainAnalysisResult
 * @property {string} domain_key
 * @property {'analyzed'|'no_conflicts'|'skipped_not_exportable'|'analysis_error'} status
 * @property {number} resources_analyzed
 * @property {number} compatible_count
 * @property {number} compatible_with_redacted_count
 * @property {ConflictEntry[]} conflicts
 * @property {string|null} analysis_error_message
 */

/**
 * @typedef {Object} PreflightSummary
 * @property {'low'|'medium'|'high'|'critical'} risk_level
 * @property {number} total_resources_analyzed
 * @property {number} compatible
 * @property {number} compatible_with_redacted_fields
 * @property {{ low: number, medium: number, high: number, critical: number }} conflict_counts
 * @property {boolean} incomplete_analysis
 * @property {string[]} domains_analyzed
 * @property {string[]} domains_skipped
 */

/**
 * @typedef {Object} PreflightReport
 * @property {string} correlation_id
 * @property {string} source_tenant_id
 * @property {string} target_tenant_id
 * @property {string} format_version
 * @property {string} analyzed_at
 * @property {PreflightSummary} summary
 * @property {DomainAnalysisResult[]} domains
 * @property {boolean} [needs_confirmation]
 * @property {Object|null} [identifier_map_proposal]
 */
```

#### `preflight/conflict-classifier.mjs`

Implementa la lógica de clasificación de severidad a partir de una tabla de datos, no de ramas condicionales:

```js
/**
 * SEVERITY_TABLE[domain][resource_type][diff_pattern] → severity
 *
 * diff_pattern es una clave string que describe la naturaleza del campo que difiere.
 * Ejemplos: 'attributes', 'composites', 'columns', 'partitions', 'validator', 'policy'
 *
 * Si el par (resource_type, diff_pattern) no está en la tabla, se devuelve 'medium' como fallback seguro.
 */
const SEVERITY_TABLE = {
  iam: {
    role: {
      composites: 'medium',
      attributes: 'low',
      description: 'low',
    },
    group: {
      attributes: 'low',
      path: 'high',
    },
    client_scope: {
      protocolMappers: 'medium',
      protocol: 'high',
    },
    identity_provider: {
      config: 'medium',
      providerId: 'critical',
    },
  },
  postgres_metadata: {
    table: {
      columns: 'high',
      constraints: 'high',
      indexes: 'medium',
    },
    schema: {
      exists: 'low',
    },
    view: {
      definition: 'medium',
    },
    extension: {
      version: 'medium',
    },
    grant: {
      privilege: 'medium',
    },
  },
  mongo_metadata: {
    collection: {
      validator: 'high',
    },
    index: {
      key: 'critical',
      unique: 'high',
      options: 'medium',
    },
    sharding: {
      config: 'critical',
    },
  },
  kafka: {
    topic: {
      numPartitions: 'high',
      replicationFactor: 'medium',
      configEntries: 'medium',
      retentionMs: 'medium',
      cleanupPolicy: 'medium',
    },
    acl: {
      permission: 'medium',
      operation: 'medium',
    },
  },
  functions: {
    action: {
      runtime: 'high',
      code: 'medium',
      limits: 'medium',
      parameters: 'low',
    },
    package: {
      binding: 'medium',
    },
    trigger: {
      feed: 'medium',
    },
    rule: {
      action: 'medium',
      trigger: 'medium',
    },
  },
  storage: {
    bucket: {
      versioning: 'medium',
      lifecycle: 'medium',
      policy: 'medium',
      cors: 'low',
    },
  },
};

const SEVERITY_FALLBACK = 'medium';

/**
 * Clasifica la severidad de un conflicto dado el dominio, tipo de recurso y campos que difieren.
 *
 * @param {string} domain - e.g. 'iam', 'postgres_metadata'
 * @param {string} resource_type - e.g. 'role', 'table', 'topic'
 * @param {string[]} diffKeys - claves del diff que difieren
 * @returns {'low'|'medium'|'high'|'critical'}
 */
export function classifySeverity(domain, resource_type, diffKeys);

/**
 * Calcula el riesgo global del informe a partir de todos los ConflictEntry.
 * Si no hay conflictos, devuelve 'low'.
 *
 * @param {import('./types.mjs').ConflictEntry[]} allConflicts
 * @returns {'low'|'medium'|'high'|'critical'}
 */
export function computeGlobalRiskLevel(allConflicts);
```

La función `classifySeverity` busca el mayor nivel de severidad entre los `diffKeys` en `SEVERITY_TABLE[domain][resource_type]`. Si alguna clave no está mapeada, usa `SEVERITY_FALLBACK`. La severidad "mayor" se determina por el orden `low < medium < high < critical`.

La tabla es exportable como constante para permitir sobreescritura en tests y eventualmente carga desde config externa (YAML/JSON) sin cambiar la firma de la función.

#### `preflight/recommendation-engine.mjs`

Implementa las recomendaciones accionables por tipo de conflicto como un mapa de lookup:

```js
/**
 * RECOMMENDATIONS[domain][resource_type][severity] → string template
 *
 * Los templates pueden incluir variables como {resource_name} (interpoladas por getRec).
 */
const RECOMMENDATIONS = {
  iam: {
    role: {
      low:    'Verificar que los atributos descriptivos del rol «{resource_name}» son correctos en el destino. La diferencia no afecta el comportamiento funcional.',
      medium: 'El rol «{resource_name}» tiene permisos o composites diferentes. Verificar si la diferencia es intencional. Si el artefacto debe prevalecer, actualizar el rol manualmente antes de reaprovisionar.',
      high:   'El rol «{resource_name}» tiene una estructura de permisos significativamente diferente. Revisar cuidadosamente antes de reaprovisionar; la diferencia puede afectar accesos activos.',
      critical: 'El rol «{resource_name}» tiene una configuración estructuralmente incompatible. Resolver manualmente antes de ejecutar el reaprovisionamiento.',
    },
    // ... otros resource_types con sus recomendaciones
  },
  postgres_metadata: {
    table: {
      low:    'La tabla «{resource_name}» tiene diferencias menores (índices o grants). La diferencia puede resolverse sin riesgo destructivo.',
      medium: 'La tabla «{resource_name}» tiene diferencias en índices o grants. Revisar el impacto antes de reaprovisionar.',
      high:   'La tabla «{resource_name}» tiene columnas o constraints incompatibles. Resolver la estructura manualmente o eliminar la tabla en el destino si es aceptable.',
      critical: 'La tabla «{resource_name}» tiene restricciones mutuamente excluyentes con la definición del artefacto. No se puede aplicar sin intervención manual.',
    },
    // ...
  },
  kafka: {
    topic: {
      high: 'El topic «{resource_name}» tiene un número diferente de particiones. Kafka no permite reducir particiones. Si el artefacto tiene más particiones que el destino, el topic deberá recrearse. Si tiene menos, el conflicto es informativo.',
      medium: 'El topic «{resource_name}» tiene diferencias en configuración (retention, cleanup policy). Revisar el impacto antes de reaprovisionar.',
      // ...
    },
    // ...
  },
  // ... resto de dominios
};

const GENERIC_RECOMMENDATION = 'Revisar la diferencia en el recurso «{resource_name}» y resolver manualmente antes de ejecutar el reaprovisionamiento si es necesario.';

/**
 * Devuelve la recomendación accionable para un conflicto.
 *
 * @param {string} domain
 * @param {string} resource_type
 * @param {'low'|'medium'|'high'|'critical'} severity
 * @param {string} resource_name
 * @returns {string}
 */
export function getRecommendation(domain, resource_type, severity, resource_name);
```

`getRecommendation` busca en el árbol de RECOMMENDATIONS y cae a `GENERIC_RECOMMENDATION` si no hay entrada para la combinación. Interpola `{resource_name}` en el template. Las recomendaciones son en español para consistencia con la plataforma.

### 3) Analizadores de dominio

Cada analizador exporta una función `analyze(tenantId, domainData, options)`:

```js
/**
 * @param {string} tenantId - tenant destino
 * @param {Object} domainData - sección `data` del artefacto (ya con identificadores sustituidos)
 * @param {Object} options
 * @param {Object} [options.credentials] - credenciales de lectura para el subsistema
 * @param {number} [options.timeoutMs] - timeout en ms para este analizador
 * @param {Console} [options.log]
 * @returns {Promise<import('../preflight/types.mjs').DomainAnalysisResult>}
 */
export async function analyze(tenantId, domainData, options);
```

Cada analizador sigue el mismo patrón:

1. Si `domainData` es null o vacío → devolver `{ domain_key, status: 'no_conflicts', resources_analyzed: 0, compatible_count: 0, compatible_with_redacted_count: 0, conflicts: [], analysis_error_message: null }`.
2. Para cada recurso en domainData:
   a. Obtener el estado actual del recurso en el subsistema destino (read-only).
   b. Si el recurso no existe en el destino → `compatible` (no hay conflicto; el artefacto lo crearía si se reprovisionara).
   c. Si el recurso existe → comparar con `compareResources` de `../reprovision/diff.mjs`.
      - Si es igual → `compatible`.
      - Si difiere → extraer `diffKeys` del resultado de `buildDiff`. Verificar si alguna clave diferente no es `***REDACTED***`.
        - Si solo difieren campos redactados → `compatible_with_redacted_fields`.
        - Si difieren campos no redactados → `conflict` con severidad y recomendación.
3. Capturar errores por recurso individual con `try/catch`; un error en un recurso no aborta el análisis del dominio.
4. Calcular conteos y status del dominio: `analyzed` si hay algún recurso procesado, `no_conflicts` si todos son compatibles, `analysis_error` si el analizador falló completamente (error al conectar al subsistema).

**Diferencia clave con los aplicadores de T03**: Los analizadores **nunca llaman a APIs de escritura**. Usan las mismas credenciales que los recolectores de T01 (`CONFIG_EXPORT_*`) para acceso de solo lectura, ya que la validación previa no necesita permisos de escritura.

#### `analyzers/iam-analyzer.mjs`

Recursos analizados: roles, grupos, client scopes, identity providers, mappers.
Credencial: `CONFIG_EXPORT_KEYCLOAK_URL`, `CONFIG_EXPORT_KEYCLOAK_ADMIN_CLIENT_ID`, `CONFIG_EXPORT_KEYCLOAK_ADMIN_SECRET`.

Criterio de comparación IAM (delegado a `compareResources` de `diff.mjs`):
- **Roles**: compara `composites`, `attributes`. Ignora `id` (identificador interno). Diff keys para clasificación: `composites`, `attributes`, `description`.
- **Grupos**: compara `path`, `attributes`.
- **Client scopes**: compara `protocol`, `protocolMappers`.
- **Identity providers**: compara `providerId`, `config` (excluyendo campos de timestamp como `lastRefresh`).

#### `analyzers/postgres-analyzer.mjs`

Recursos analizados: esquemas, tablas (columnas, constraints, índices), vistas, extensiones, grants.
Credencial: `CONFIG_EXPORT_PG_CONNECTION_STRING` o individuales `CONFIG_EXPORT_PG_*`.

Criterio: igual que el comparador de T03 pero sin DDL. Usa `information_schema.columns`, `pg_constraint`, `pg_indexes`, `pg_extension` en modo read-only.

#### `analyzers/mongo-analyzer.mjs`

Recursos analizados: colecciones, índices, validadores.
Credencial: `CONFIG_EXPORT_MONGO_URI`.

Criterio: `listCollections` para comparar validators; `listIndexes` para índices. Sin operaciones de escritura.

#### `analyzers/kafka-analyzer.mjs`

Recursos analizados: topics, ACLs.
Credencial: `CONFIG_EXPORT_KAFKA_BROKERS`, `CONFIG_EXPORT_KAFKA_SASL_*`.

Criterio: `admin.describeTopics` para numPartitions y configEntries. `admin.describeAcls` para ACLs.

#### `analyzers/functions-analyzer.mjs`

Recursos analizados: paquetes, acciones (runtime, código, límites, parámetros no redactados), triggers, rules.
Credencial: `CONFIG_EXPORT_OW_API_HOST`, `CONFIG_EXPORT_OW_API_KEY`.

Habilitado con flag: `CONFIG_PREFLIGHT_OW_ENABLED`.

#### `analyzers/storage-analyzer.mjs`

Recursos analizados: buckets, versioning, lifecycle, política, CORS.
Credencial: `CONFIG_EXPORT_S3_ENDPOINT`, `CONFIG_EXPORT_S3_ACCESS_KEY`, `CONFIG_EXPORT_S3_SECRET_KEY`.

### 4) Action y API flow

#### Endpoint de validación previa

`POST /v1/admin/tenants/{tenant_id}/config/reprovision/preflight`

**Request envelope**:
- `artifact` (required) — artefacto JSON de exportación
- `identifier_map` (optional) — mapa confirmado o editado manualmente
- `domains` (optional) — lista de dominios a analizar; si no se especifica, se analizan todos los disponibles

**Flujo de la action `tenant-config-preflight.mjs`**:

```text
1. Extraer claims JWT (mismo scope: platform:admin:config:reprovision)
2. Extraer tenant_id del path o params
3. Verificar que el tenant destino existe (tenantExistsFn) → 404 si no existe
4. Parsear body: { artifact, identifier_map?, domains? }
5. Validar formato del artefacto:
   a. Verificar format_version: mismo major que la versión actual del servidor (SUPPORTED_FORMAT_MAJOR)
   b. Si major incompatible → return { statusCode: 422, body: { error: '...' } }
6. Validar y normalizar identifier_map:
   a. Si artifact.tenant_id !== tenant_id (destino):
      - Si no se proporciona identifier_map → buildProposedIdentifierMap y retornar
        { statusCode: 200, body: { needs_confirmation: true, identifier_map_proposal: map } }
      - Si se proporciona → validateIdentifierMap; si inválido → return { statusCode: 400 }
   b. Si artifact.tenant_id === tenant_id → identifier_map puede ser null
7. Aplicar identifier_map al artefacto en memoria (applyIdentifierMap de ../reprovision/identifier-map.mjs)
8. Filtrar dominios a analizar:
   - Si params.domains → verificar que sean KNOWN_DOMAINS; si hay desconocidos → return { statusCode: 400 }
   - Intersección de params.domains con dominios del artefacto con status 'ok' o 'empty'
   - Dominios con status 'error'/'not_available'/'not_requested' → DomainAnalysisResult con status 'skipped_not_exportable'
9. Ejecutar analizadores EN PARALELO:
   - Promise.allSettled(domainsToAnalyze.map(domain => withTimeout(analyze(tenantId, domainData, opts), timeoutMs, domain)))
   - Para cada resultado settled:
     - fulfilled → usar DomainAnalysisResult directamente
     - rejected → DomainAnalysisResult con status 'analysis_error' y mensaje descriptivo
10. Construir PreflightSummary:
    - Agregar todos los ConflictEntry de todos los dominios analyzed
    - Calcular conflict_counts por severidad
    - computeGlobalRiskLevel(allConflicts) → risk_level
    - incomplete_analysis = algún dominio en 'analysis_error'
    - domains_analyzed, domains_skipped
11. Construir PreflightReport completo
12. Insertar auditoría PostgreSQL (insertPreflightAuditLog)
13. Publicar evento Kafka (fire-and-forget)
14. Retornar { statusCode: 200, body: PreflightReport }
```

**Manejo de errores HTTP**:

| Condición | HTTP |
|---|---|
| Sin autenticación o scope incorrecto | 403 |
| tenant_id no encontrado | 404 |
| format_version con major incompatible | 422 |
| identifier_map inválido | 400 |
| Dominio desconocido en filtro `domains` | 400 |
| tenant_id difiere y no se proporciona mapa | 200 con `needs_confirmation: true` |
| Un o más analizadores fallaron (parcial) | 200 con `incomplete_analysis: true` |
| Análisis completo | 200 |

> **Nota**: El endpoint de validación previa no emite `207` ni `500`. Un fallo parcial de analizadores es un resultado válido y se expresa en `incomplete_analysis`. Un error sistémico no previsto es el único caso que podría resultar en un error de infraestructura, pero los analizadores están envueltos en `try/catch`.

**Variables de entorno usadas**:
- `CONFIG_PREFLIGHT_SUPPORTED_FORMAT_MAJOR` (default: `'1'`)
- `CONFIG_PREFLIGHT_ANALYZER_TIMEOUT_MS` (default: `10000`)
- `CONFIG_PREFLIGHT_OW_ENABLED` (default: `'false'`)
- `CONFIG_PREFLIGHT_MONGO_ENABLED` (default: `'false'`)
- Credenciales de lectura: `CONFIG_EXPORT_*` (reutilizadas de T01 — acceso read-only)

### 5) Registro de analizadores

Un módulo ligero `preflight/analyzer-registry.mjs` registra los seis analizadores siguiendo el mismo patrón que `reprovision/registry.mjs`:

```js
export const ANALYZER_ORDER = ['iam', 'postgres_metadata', 'mongo_metadata', 'kafka', 'functions', 'storage'];

/**
 * @returns {Map<string, (tenantId, domainData, options) => Promise<DomainAnalysisResult>>}
 */
export function getAnalyzerRegistry(deploymentProfile = 'standard');
```

Feature flags:
- `CONFIG_PREFLIGHT_OW_ENABLED` — habilita analizador de funciones.
- `CONFIG_PREFLIGHT_MONGO_ENABLED` — habilita analizador de MongoDB.
- Si un analizador no está registrado, el dominio devuelve `status: 'skipped_not_exportable'` con mensaje `'analyzer_not_enabled'`.

### 6) Console flow

La consola expone una página dedicada para la validación previa. El flujo es intencionalmente más simple que la página de reaprovisionamiento de T03 (no hay editor de mapa en el flujo principal; el mapa solo aparece si se detecta que los tenants difieren).

**Paso 1 — Cargar artefacto**
- Área de texto o file upload para pegar/subir el JSON exportado.
- Campo de tenant_id destino (puede ser prefilled desde el contexto de navegación).
- Botón "Analizar conflictos".

**Paso 2 — Resultado del análisis**
- `PreflightRiskBadge` prominente con el nivel de riesgo global.
- Resumen ejecutivo: recursos analizados, conflictos por severidad, flag de análisis incompleto.
- Sección expandible por dominio con sus conflictos.
- Para cada conflicto: tipo, nombre, severidad (badge de color), diff y recomendación.
- Recursos `compatible_with_redacted_fields` en sección colapsada "Recursos con secretos redactados".

**Paso 3 — Acción sugerida**
- Si `risk_level` es `low` y `incomplete_analysis` es `false` → banner verde "Sin conflictos. Puede reaprovisionar con confianza."
- Si hay conflictos → banner con enlace a la página de reaprovisionamiento de T03, con los conflictos visible como contexto.

**Caso especial — needs_confirmation**:
- Si el endpoint devuelve `needs_confirmation: true`, mostrar `ConfigIdentifierMapEditor` (del T03) para que el operador confirme el mapa antes de ejecutar el análisis real.

**Visibilidad**: La página solo se muestra a usuarios con rol `superadmin` o `sre`. Para `tenant_owner`, redirigir a `403`.

**Components**:
- `PreflightRiskBadge.tsx`: badge de color `low`→verde, `medium`→amarillo, `high`→naranja, `critical`→rojo.
- `PreflightConflictReport.tsx`: panel principal con summary + secciones por dominio + detalle de conflictos.

### 7) Contratos y gateway wiring

1. Añadir la ruta `preflight` en `backup-admin-routes.yaml` (sin nueva ruta para Keycloak — scope ya existe).
2. Publicar contrato OpenAPI `specs/118-export-conflict-prechecks/contracts/tenant-config-preflight.json` con los schemas `PreflightRequest`, `PreflightReport`, `PreflightSummary`, `DomainAnalysisResult`, `ConflictEntry`.
3. Publicar JSON Schema de evento Kafka `config-preflight-audit-event.json`.

---

## Data, Metadata, Events, Secrets, and Infra

### Database

Nueva migración `118-config-preflight.sql` con la tabla `config_preflight_audit_log`. Ver `data-model.md` para DDL completo. La migración es idempotente (`CREATE TABLE IF NOT EXISTS`).

Campos clave:
- `id UUID PK`
- `tenant_id TEXT` — tenant destino
- `source_tenant_id TEXT` — tenant de origen del artefacto
- `actor_id TEXT`, `actor_type TEXT`
- `domains_requested TEXT[]`, `domains_analyzed TEXT[]`, `domains_skipped TEXT[]`
- `risk_level TEXT CHECK (IN ('low','medium','high','critical'))`
- `conflict_count_low INT`, `conflict_count_medium INT`, `conflict_count_high INT`, `conflict_count_critical INT`
- `compatible_count INT`, `compatible_with_redacted_count INT`
- `incomplete_analysis BOOLEAN`
- `identifier_map_provided BOOLEAN`
- `identifier_map_hash TEXT` — hash del mapa si se proporcionó
- `artifact_checksum TEXT`
- `format_version TEXT`
- `correlation_id TEXT`
- `executed_at TIMESTAMPTZ`

No se añaden tablas de lock (la validación previa es read-only y no requiere concurrencia exclusiva).

### Kafka

Nuevo topic y evento para auditoría de validaciones previas:
- Topic: `CONFIG_PREFLIGHT_KAFKA_TOPIC` (default: `console.config.reprovision.preflight`)
- Event shape en `contracts/config-preflight-audit-event.json`
- Publisher: fire-and-forget; fallo de Kafka no aborta la respuesta HTTP.

### Secrets

- Los valores `***REDACTED***` del artefacto no se incluyen en diffs ni se comparan.
- Las credenciales de acceso a subsistemas (`CONFIG_EXPORT_*`) son de solo lectura.
- Ningún valor secreto se almacena en PostgreSQL, logs ni eventos Kafka.

### Infrastructure

- Reutiliza el deployment de OpenWhisk, APISIX y Keycloak existentes.
- No requiere nuevos ConfigMaps, Secrets ni Helm charts para esta feature (las credenciales `CONFIG_EXPORT_*` ya existen).
- La nueva action OpenWhisk sigue el mismo patrón de despliegue que `tenant-config-export.mjs` y `tenant-config-reprovision.mjs`.

---

## Testing Strategy

### Unit tests

- `conflict-classifier.mjs`: clasificación correcta para cada combinación (domain, resource_type, diffKeys); fallback para combinaciones no mapeadas; orden de severidad.
- `recommendation-engine.mjs`: recomendación correcta por (domain, resource_type, severity); fallback genérico; interpolación de `resource_name`.
- Analizadores por dominio (6 módulos): recurso no existente → compatible; recurso idéntico → compatible; recurso diferente → conflict; diferencia solo en campo redactado → compatible_with_redacted_fields; dominio vacío; error de API del subsistema en un recurso no aborta el dominio.

### Contract tests

- Contrato OpenAPI `tenant-config-preflight.json` es válido (SwaggerParser.validate).
- Ruta `POST /v1/admin/tenants/{tenant_id}/config/reprovision/preflight` existe.
- Scope `platform:admin:config:reprovision` declarado en security scheme.
- Schemas `PreflightRequest`, `PreflightReport`, `PreflightSummary`, `DomainAnalysisResult`, `ConflictEntry` existen en components.
- `PreflightReport.required` incluye `correlation_id`, `source_tenant_id`, `target_tenant_id`, `analyzed_at`, `summary`, `domains`.
- JSON Schema del evento Kafka es válido (Ajv); valida correctamente con/sin campos obligatorios.

### Integration tests (action)

- Happy path: tenant vacío, artefacto completo → 200, zero conflicts, risk `low`.
- Conflicts mixtos: roles IAM diferentes (medium) + tabla PostgreSQL incompatible (high) → 200, risk `high`.
- Filtrado de dominios: `domains: ['iam', 'functions']` → solo esos dos dominios en el informe.
- Analizador MongoDB falla → `incomplete_analysis: true`, demás dominios analizados normalmente.
- `tenant_id` difiere sin mapa → 200 con `needs_confirmation: true`, sin análisis.
- `tenant_id` difiere con mapa confirmado → análisis correcto con identificadores del destino.
- `format_version` con major incompatible → 422.
- Tenant no existe → 404.
- Sin autenticación → 403.
- Scope incorrecto → 403.
- Tenant owner autenticado → 403.
- Dominio desconocido en filtro → 400.
- Mapa de identificadores inválido (`to` vacío) → 400.
- Recursos con campo `***REDACTED***` únicamente diferente → `compatible_with_redacted_fields`.
- Dos validaciones concurrentes sobre mismo tenant → ambas completan normalmente (sin lock).
- Auditoría insertada con todos los campos por cada invocación exitosa.
- Evento Kafka publicado por cada invocación.
- Kafka falla → auditoría insertada, response 200, Kafka error logueado y suprimido.

### Console tests

- `PreflightRiskBadge` renderiza con colores correctos por nivel.
- `PreflightConflictReport` renderiza summary y detalles por dominio.
- Flujo `needs_confirmation` muestra el editor de mapa.
- Usuarios no privilegiados no pueden acceder a la página.

### Operational validation

- Verificar que ningún artefacto completo se almacena en PostgreSQL.
- Verificar que ningún valor `***REDACTED***` aparece en logs ni eventos.
- Verificar que el endpoint de preflight no requiere ni consulta el lock de T03.

---

## Implementation Sequence and Parallelization

### Orden recomendado

1. **Migración + repositorio de auditoría** — base de persistencia; sin dependencias externas.
2. **Módulo `preflight/types.mjs`** — typedefs compartidos por todo el módulo.
3. **`conflict-classifier.mjs` + `recommendation-engine.mjs`** — lógica central de clasificación; testeable de forma aislada.
4. **`analyzer-registry.mjs`** — andamio del registro; define el contrato de `analyze()`.
5. **Analizadores de dominio** (los seis en paralelo) — dependen de types, classifier y recommendation-engine.
6. **Action `tenant-config-preflight.mjs`** — orquesta todo; depende de los analizadores y el repositorio.
7. **Ruta APISIX** — wiring del endpoint; no depende de la implementación interna.
8. **Consola** — depende de los contratos estables; puede avanzar en paralelo con la action.
9. **Contratos y tests** — avanzan en paralelo con la implementación una vez los contratos están esbozados.

### Paralelizable

- Los seis analizadores de dominio pueden implementarse en paralelo una vez `types.mjs`, `diff.mjs` (T03) y el contrato de `analyze()` están fijos.
- Los componentes de consola pueden desarrollarse con mocks del API una vez `contracts/tenant-config-preflight.json` está publicado.
- Los tests de contrato pueden escribirse en paralelo con la action una vez los JSON Schema están esbozados.

---

## Risks, Compatibility, Rollback, Idempotency, Observability, Security

### Risks

| ID | Descripción | Probabilidad | Impacto | Mitigación |
|---|---|---|---|---|
| R-01 | La tabla de severidad puede producir clasificaciones incorrectas para casos no anticipados → falsos positivos o falsos negativos de severidad | Alta | Medio | Implementar como tabla de datos configurable (no hardcoded). Añadir fallback `medium` para pares no mapeados. Planificar revisión operativa iterativa. |
| R-02 | Los subsistemas pueden tener latencia alta en lecturas concurrentes para muchos recursos → análisis supera los 30 s | Media | Medio | Timeout por analizador (`CONFIG_PREFLIGHT_ANALYZER_TIMEOUT_MS`, default 10 s). Análisis en paralelo reduce el tiempo total. Los dominios que superen el timeout se marcan `analysis_error`. |
| R-03 | La reutilización de credenciales `CONFIG_EXPORT_*` para los analizadores asume que esas credenciales tienen acceso de lectura sobre el tenant destino, no solo sobre el origen | Media | Medio | Verificar que las credenciales de exportación son cross-tenant o parametrizables por tenant destino. Si no, crear credenciales de lectura específicas para preflight. |
| R-04 | Los campos `***REDACTED***` pueden estar en posiciones inesperadas del artefacto (objetos anidados profundos) → el chequeo de redacción puede no cubrir todos los casos | Baja | Bajo | El helper `isRedactedValue` debe recorrer el diff de forma recursiva, no solo el primer nivel. Añadir test específico para valores redactados en campos anidados. |
| R-05 | El análisis de muchos recursos en paralelo puede saturar los subsistemas con llamadas de lectura concurrentes | Baja | Medio | Los analizadores respetan los mismos límites de concurrencia que los recolectores de T01. Si se detecta saturación, añadir semáforos por subsistema. |

### Compatibility

- La feature es puramente aditiva: nuevo endpoint, nueva tabla, nuevo evento Kafka. No modifica rutas ni tablas existentes.
- Reutiliza el scope de Keycloak y los contratos de T03 sin modificarlos.
- Los analizadores leen el artefacto con el mismo `format_version` que acepta T03; la validación de major version es idéntica.
- Si T03 no está desplegado (fallo de dependencia), T04 puede funcionar de forma independiente siempre que `diff.mjs` e `identifier-map.mjs` estén disponibles (módulos de código, no servicios).

### Rollback

- Si la feature debe revertirse, se eliminan: la ruta APISIX añadida, la action OpenWhisk, la tabla PostgreSQL (con drop migration), los archivos de console, y los módulos `preflight/`. No hay cambios destructivos en artefactos existentes.

### Idempotency

- La validación previa es por naturaleza idempotente: el mismo artefacto sobre el mismo tenant producirá el mismo informe siempre que el estado del tenant no cambie entre invocaciones.
- Múltiples invocaciones del mismo análisis generan múltiples registros de auditoría con correlation_ids distintos, lo que es correcto.

### Observability and Security

- Auditoría en PostgreSQL y evento Kafka por cada invocación.
- Los logs del analizador nunca incluyen valores de secretos ni el payload completo del artefacto.
- El endpoint requiere autenticación JWT con scope `platform:admin:config:reprovision`.
- Los analizadores usan credenciales de solo lectura (`CONFIG_EXPORT_*`); no requieren ni exponen credenciales de escritura.
- Las respuestas de error no revelan detalles internos de los subsistemas.
- El informe de conflictos excluye los valores del artefacto que son `***REDACTED***`; solo incluye el campo `diff` con las claves que difieren, no los valores redactados.

---

## Done Criteria / Evidence Expected

La tarea está completa cuando todo lo siguiente es verdad:

1. `plan.md`, `research.md`, `data-model.md` y los archivos de contratos en `contracts/` existen bajo `specs/118-export-conflict-prechecks/`.
2. El módulo `preflight/` tiene tipos, clasificador, motor de recomendaciones y los seis analizadores con sus contratos de función.
3. La action `tenant-config-preflight.mjs` implementa el flujo completo: autenticación, validación de artefacto, aplicación de mapa, análisis paralelo, construcción de informe, auditoría y publicación de evento.
4. La ruta APISIX para el endpoint de preflight está especificada y añadida a `backup-admin-routes.yaml`.
5. No se añade ni modifica ningún scope de Keycloak (reutiliza el existente de T03).
6. La consola expone una página de validación previa con informe de conflictos, badge de riesgo y flujo de `needs_confirmation`.
7. La cobertura de pruebas incluye: unit (clasificador, recomendaciones, analizadores), contract (OpenAPI + Kafka event), integration (action — 15+ casos), console (componentes y página), y E2E (8+ escenarios).
8. El plan **no avanza a `speckit.tasks`** ni introduce implementación de código real.
9. Los artefactos `spec.md` de la feature no han sido modificados.
10. El worktree contiene solo los archivos del plan-stage de esta feature, sin archivos temporales.
