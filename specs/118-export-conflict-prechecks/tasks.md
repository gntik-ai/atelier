# Tasks — US-BKP-02-T04: Validaciones previas para detectar conflictos entre export existente y entorno destino

**Branch**: `118-export-conflict-prechecks` | **Date**: 2026-04-01
**Task ID**: US-BKP-02-T04 | **Stage**: `speckit.tasks`
**Spec**: [`spec.md`](./spec.md) | **Plan**: [`plan.md`](./plan.md)
**Dependencias**: US-TEN-04, US-BKP-01, US-BKP-02-T01, US-BKP-02-T02, US-BKP-02-T03

---

## Mapa de archivos (file-path map)

Todo el trabajo se circunscribe a los siguientes paths. El paso `speckit.implement` **no debe tocar ningún otro archivo** salvo los aquí listados.

### Archivos nuevos a crear

```text
services/provisioning-orchestrator/src/
  preflight/
    types.mjs
    conflict-classifier.mjs
    recommendation-engine.mjs
    analyzer-registry.mjs
    analyzers/
      iam-analyzer.mjs
      postgres-analyzer.mjs
      mongo-analyzer.mjs
      kafka-analyzer.mjs
      functions-analyzer.mjs
      storage-analyzer.mjs
  actions/
    tenant-config-preflight.mjs
  repositories/
    config-preflight-audit-repository.mjs
  migrations/
    118-config-preflight.sql

services/gateway-config/routes/
  backup-admin-routes.yaml          ← MODIFICAR (añadir ruta preflight)

apps/web-console/src/
  api/
    configPreflightApi.ts
  components/
    PreflightConflictReport.tsx
    PreflightRiskBadge.tsx
  pages/
    ConsoleTenantConfigPreflightPage.tsx

tests/contracts/
  tenant-config-preflight.contract.test.mjs
  config-preflight-audit-event.contract.test.mjs

tests/e2e/workflows/
  tenant-config-preflight.test.mjs

services/provisioning-orchestrator/tests/preflight/
  conflict-classifier.test.mjs
  recommendation-engine.test.mjs
  iam-analyzer.test.mjs
  postgres-analyzer.test.mjs
  mongo-analyzer.test.mjs
  kafka-analyzer.test.mjs
  functions-analyzer.test.mjs
  storage-analyzer.test.mjs

services/provisioning-orchestrator/src/tests/actions/
  tenant-config-preflight.test.mjs
```

### Artifacts de stage a preservar (no tocar)

```text
specs/118-export-conflict-prechecks/
  spec.md
  plan.md
  research.md
  data-model.md
  contracts/
    tenant-config-preflight.json
    config-preflight-audit-event.json
```

> **Nota de reutilización**: Los analizadores importan directamente desde `../reprovision/diff.mjs` e `../reprovision/identifier-map.mjs` (artefactos de T03). No se duplica ni modifica ningún módulo de T03.

---

## Secuencia de implementación

Las tareas están ordenadas de forma que cada bloque puede empezar una vez que el bloque anterior está completo. Los bloques marcados con `[PARALELO]` pueden ejecutarse simultáneamente.

---

## Bloque 1 — Persistencia: migración SQL y repositorio de auditoría

### T-01 · Migración SQL `118-config-preflight.sql`

**Archivo**: `services/provisioning-orchestrator/src/migrations/118-config-preflight.sql`

Crear la tabla PostgreSQL para el log de auditoría de validaciones previas. La migración debe ser idempotente (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).

**Tabla `config_preflight_audit_log`**:

```sql
CREATE TABLE IF NOT EXISTS config_preflight_audit_log (
  id                              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                       TEXT        NOT NULL,
  source_tenant_id                TEXT        NOT NULL,
  actor_id                        TEXT        NOT NULL,
  actor_type                      TEXT        NOT NULL CHECK (actor_type IN ('superadmin', 'sre', 'service_account')),
  domains_requested               TEXT[]      NOT NULL DEFAULT '{}',
  domains_analyzed                TEXT[]      NOT NULL DEFAULT '{}',
  domains_skipped                 TEXT[]      NOT NULL DEFAULT '{}',
  risk_level                      TEXT        NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  conflict_count_low              INT         NOT NULL DEFAULT 0,
  conflict_count_medium           INT         NOT NULL DEFAULT 0,
  conflict_count_high             INT         NOT NULL DEFAULT 0,
  conflict_count_critical         INT         NOT NULL DEFAULT 0,
  compatible_count                INT         NOT NULL DEFAULT 0,
  compatible_with_redacted_count  INT         NOT NULL DEFAULT 0,
  total_resources_analyzed        INT         NOT NULL DEFAULT 0,
  incomplete_analysis             BOOLEAN     NOT NULL DEFAULT FALSE,
  identifier_map_provided         BOOLEAN     NOT NULL DEFAULT FALSE,
  identifier_map_hash             TEXT,
  artifact_checksum               TEXT,
  format_version                  TEXT        NOT NULL,
  correlation_id                  TEXT        NOT NULL,
  executed_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_preflight_audit_tenant
  ON config_preflight_audit_log(tenant_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_preflight_audit_source_tenant
  ON config_preflight_audit_log(source_tenant_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_preflight_audit_correlation
  ON config_preflight_audit_log(correlation_id);
CREATE INDEX IF NOT EXISTS idx_preflight_audit_risk
  ON config_preflight_audit_log(risk_level, executed_at DESC);
```

**Criterio de aceptación**: La migración corre sin errores en una base de datos limpia y es idempotente (puede ejecutarse dos veces consecutivas sin error). No crea ninguna tabla de lock (la validación previa es read-only y no necesita concurrencia exclusiva).

---

### T-02 · Repositorio de auditoría `config-preflight-audit-repository.mjs`

**Archivo**: `services/provisioning-orchestrator/src/repositories/config-preflight-audit-repository.mjs`

Módulo ESM que expone:

```js
/**
 * Inserta un registro en config_preflight_audit_log.
 * Valida que los campos obligatorios estén presentes antes de insertar.
 * @returns {{ id: string }}
 */
export async function insertPreflightAuditLog(pgClient, record);

/**
 * Busca un registro por correlation_id. Útil para debugging y auditoría.
 * @returns {Object | null}
 */
export async function getPreflightAuditByCorrelationId(pgClient, correlationId);
```

`record` debe mapear todos los campos no nulos de la tabla `config_preflight_audit_log`. Campos obligatorios: `tenant_id`, `source_tenant_id`, `actor_id`, `actor_type`, `risk_level`, `format_version`, `correlation_id`, `executed_at`. Lanzar errores descriptivos si faltan.

Los campos numéricos (`conflict_count_*`, `compatible_count`, `compatible_with_redacted_count`, `total_resources_analyzed`) defaulan a `0` si no se proporcionan. Los arrays (`domains_requested`, `domains_analyzed`, `domains_skipped`) defaulan a `[]`.

**Criterio de aceptación**: `insertPreflightAuditLog` mapea correctamente todos los campos del modelo. `getPreflightAuditByCorrelationId` devuelve `null` si no existe registro.

---

## Bloque 2 — Módulo preflight: runtime compartido [PARALELO con Bloque 1]

### T-03 · Tipos compartidos `preflight/types.mjs`

**Archivo**: `services/provisioning-orchestrator/src/preflight/types.mjs`

Definir las constantes y JSDoc typedefs de todo el módulo de validación previa:

```js
/** @type {readonly string[]} */
export const KNOWN_DOMAINS = ['iam', 'postgres_metadata', 'mongo_metadata', 'kafka', 'functions', 'storage'];

/** @type {readonly string[]} */
export const SKIPPABLE_DOMAIN_STATUSES = ['error', 'not_available', 'not_requested'];

export const REDACTED_MARKER = '***REDACTED***';

/** Orden de severidad ascendente, usado para comparación. */
export const SEVERITY_LEVELS = /** @type {const} */ (['low', 'medium', 'high', 'critical']);

export const PREFLIGHT_RESOURCE_STATUSES = /** @type {const} */ ({
  COMPATIBLE: 'compatible',
  COMPATIBLE_REDACTED: 'compatible_with_redacted_fields',
  CONFLICT: 'conflict',
});

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
 * @property {Object|null} diff        - diff de campos no redactados entre artefacto y destino
 * @property {string} recommendation   - texto accionable específico al tipo de recurso y severidad
 */

/**
 * @typedef {Object} CompatibleWithRedactedEntry
 * @property {string} resource_type
 * @property {string} resource_name
 * @property {string|null} resource_id
 * @property {string[]} redacted_fields - campos del artefacto que son REDACTED_MARKER
 */

/**
 * @typedef {Object} DomainAnalysisResult
 * @property {string} domain_key
 * @property {'analyzed'|'no_conflicts'|'skipped_not_exportable'|'analysis_error'} status
 * @property {number} resources_analyzed
 * @property {number} compatible_count
 * @property {number} compatible_with_redacted_count
 * @property {ConflictEntry[]} conflicts
 * @property {CompatibleWithRedactedEntry[]} compatible_with_redacted
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
 * @property {string} analyzed_at          - ISO 8601 timestamp
 * @property {PreflightSummary} summary
 * @property {DomainAnalysisResult[]} domains
 * @property {boolean} [needs_confirmation] - presente solo cuando se propone un mapa sin análisis
 * @property {Object|null} [identifier_map_proposal] - propuesta de mapa cuando needs_confirmation=true
 */
```

**Criterio de aceptación**: Importable sin errores. Todas las constantes y typedefs son consistentes con `data-model.md` y el contrato OpenAPI `contracts/tenant-config-preflight.json`.

---

### T-04 · Clasificador de severidad `preflight/conflict-classifier.mjs`

**Archivo**: `services/provisioning-orchestrator/src/preflight/conflict-classifier.mjs`

Implementar la clasificación de severidad como una **tabla de datos** (no ramas `if/else`). La tabla es exportable para permitir sobreescritura en tests y carga futura desde configuración externa.

```js
/**
 * Tabla de severidad indexada por [domain][resource_type][diff_key].
 * diff_key describe el nombre del campo que difiere (extraído de los diff keys del buildDiff de T03).
 *
 * Si un par (resource_type, diff_key) no está mapeado, se aplica SEVERITY_FALLBACK.
 *
 * @type {Record<string, Record<string, Record<string, 'low'|'medium'|'high'|'critical'>>>}
 */
export const SEVERITY_TABLE = {
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

/** Severidad por defecto cuando el par (resource_type, diff_key) no está en SEVERITY_TABLE. */
export const SEVERITY_FALLBACK = 'medium';

/**
 * Clasifica la severidad de un conflicto dado el dominio, tipo de recurso y campos que difieren.
 * Devuelve el nivel más alto entre los diffKeys encontrados en SEVERITY_TABLE.
 * Si ninguna clave está mapeada, devuelve SEVERITY_FALLBACK.
 *
 * @param {string} domain         - e.g. 'iam', 'postgres_metadata'
 * @param {string} resource_type  - e.g. 'role', 'table', 'topic'
 * @param {string[]} diffKeys     - claves del diff que difieren (de buildDiff de T03)
 * @returns {'low'|'medium'|'high'|'critical'}
 */
export function classifySeverity(domain, resource_type, diffKeys);

/**
 * Calcula el riesgo global del informe a partir de todos los ConflictEntry de todos los dominios.
 * Si no hay conflictos (o el array está vacío), devuelve 'low'.
 * El riesgo global es el nivel de severidad máximo encontrado.
 *
 * @param {import('./types.mjs').ConflictEntry[]} allConflicts
 * @returns {'low'|'medium'|'high'|'critical'}
 */
export function computeGlobalRiskLevel(allConflicts);
```

La función `classifySeverity` debe:
1. Buscar `SEVERITY_TABLE[domain][resource_type]`.
2. Para cada clave en `diffKeys`, buscar su severidad en la entrada del recurso.
3. Si no hay entrada para la clave, usar `SEVERITY_FALLBACK`.
4. Devolver la severidad máxima entre todas las claves (`low < medium < high < critical`).

**Criterio de aceptación**: `classifySeverity('postgres_metadata', 'table', ['columns'])` → `'high'`; `classifySeverity('iam', 'role', ['description'])` → `'low'`; par no mapeado → `'medium'`; `computeGlobalRiskLevel([])` → `'low'`; `computeGlobalRiskLevel` con conflictos `['low','high','medium']` → `'high'`.

---

### T-05 · Motor de recomendaciones `preflight/recommendation-engine.mjs`

**Archivo**: `services/provisioning-orchestrator/src/preflight/recommendation-engine.mjs`

Implementar las recomendaciones accionables como un mapa de lookup (no lógica condicional). Las recomendaciones son en español para coherencia con la plataforma.

```js
/**
 * Mapa de recomendaciones indexado por [domain][resource_type][severity].
 * Los templates pueden incluir {resource_name} (interpolado por getRecommendation).
 *
 * @type {Record<string, Record<string, Record<string, string>>>}
 */
export const RECOMMENDATIONS = {
  iam: {
    role: {
      low:      'Verificar que los atributos descriptivos del rol «{resource_name}» son correctos en el destino. La diferencia no afecta el comportamiento funcional.',
      medium:   'El rol «{resource_name}» tiene permisos o composites diferentes. Verificar si la diferencia es intencional. Si el artefacto debe prevalecer, actualizar el rol manualmente antes de reaprovisionar.',
      high:     'El rol «{resource_name}» tiene una estructura de permisos significativamente diferente. Revisar cuidadosamente antes de reaprovisionar; la diferencia puede afectar accesos activos.',
      critical: 'El rol «{resource_name}» tiene una configuración estructuralmente incompatible. Resolver manualmente antes de ejecutar el reaprovisionamiento.',
    },
    group: {
      low:      'El grupo «{resource_name}» tiene diferencias menores en atributos. La diferencia no afecta la estructura del grupo.',
      medium:   'El grupo «{resource_name}» tiene atributos diferentes. Verificar si los atributos en el destino son intencionales.',
      high:     'El grupo «{resource_name}» tiene un path diferente. El path de un grupo afecta la jerarquía y los accesos. Resolver manualmente.',
      critical: 'El grupo «{resource_name}» tiene una estructura incompatible. Resolver manualmente antes de reaprovisionar.',
    },
    client_scope: {
      low:      'El client scope «{resource_name}» tiene diferencias menores. Verificar si son intencionales.',
      medium:   'El client scope «{resource_name}» tiene mappers de protocolo diferentes. Verificar el impacto en tokens emitidos.',
      high:     'El client scope «{resource_name}» tiene un protocolo diferente. Cambiar el protocolo puede afectar la autenticación. Resolver manualmente.',
      critical: 'El client scope «{resource_name}» es estructuralmente incompatible con el existente. Resolver manualmente.',
    },
    identity_provider: {
      low:      'El identity provider «{resource_name}» tiene diferencias de configuración menores.',
      medium:   'El identity provider «{resource_name}» tiene configuración diferente. Revisar el impacto en los flujos de autenticación federada.',
      high:     'El identity provider «{resource_name}» tiene diferencias significativas de configuración. Revisar cuidadosamente antes de reaprovisionar.',
      critical: 'El identity provider «{resource_name}» tiene un providerId incompatible. No puede coexistir con el existente sin intervención manual.',
    },
  },
  postgres_metadata: {
    table: {
      low:      'La tabla «{resource_name}» tiene diferencias menores. La diferencia puede resolverse sin riesgo destructivo.',
      medium:   'La tabla «{resource_name}» tiene diferencias en índices o grants. Revisar el impacto antes de reaprovisionar.',
      high:     'La tabla «{resource_name}» tiene columnas o constraints incompatibles. Resolver la estructura manualmente o eliminar la tabla en el destino si es aceptable.',
      critical: 'La tabla «{resource_name}» tiene restricciones mutuamente excluyentes con la definición del artefacto. No se puede aplicar sin intervención manual.',
    },
    view: {
      low:      'La vista «{resource_name}» tiene diferencias menores.',
      medium:   'La vista «{resource_name}» tiene una definición diferente. Verificar si la diferencia es intencional.',
      high:     'La vista «{resource_name}» tiene una definición incompatible. Revisar antes de reaprovisionar.',
      critical: 'La vista «{resource_name}» es incompatible con la existente. Resolver manualmente.',
    },
    extension: {
      low:      'La extensión «{resource_name}» tiene diferencias menores.',
      medium:   'La extensión «{resource_name}» tiene una versión diferente. Verificar compatibilidad antes de reaprovisionar.',
      high:     'La extensión «{resource_name}» tiene una versión incompatible. Revisar el impacto antes de reaprovisionar.',
      critical: 'La extensión «{resource_name}» es incompatible con la instalada. Resolver manualmente.',
    },
    grant: {
      low:      'El grant «{resource_name}» tiene diferencias menores.',
      medium:   'El grant «{resource_name}» tiene privilegios diferentes. Verificar si los permisos del destino son intencionales.',
      high:     'El grant «{resource_name}» tiene diferencias significativas en privilegios. Revisar antes de reaprovisionar.',
      critical: 'El grant «{resource_name}» es incompatible. Resolver manualmente.',
    },
  },
  mongo_metadata: {
    collection: {
      low:      'La colección «{resource_name}» tiene diferencias menores.',
      medium:   'La colección «{resource_name}» tiene diferencias de configuración. Verificar el impacto.',
      high:     'La colección «{resource_name}» tiene un validador incompatible. La diferencia puede rechazar documentos existentes. Resolver antes de reaprovisionar.',
      critical: 'La colección «{resource_name}» es incompatible con la existente. Resolver manualmente.',
    },
    index: {
      low:      'El índice «{resource_name}» tiene diferencias menores en opciones.',
      medium:   'El índice «{resource_name}» tiene opciones diferentes. Verificar el impacto en consultas.',
      high:     'El índice «{resource_name}» tiene un campo unique diferente. Puede afectar la integridad de datos. Revisar antes de reaprovisionar.',
      critical: 'El índice «{resource_name}» tiene una definición de clave incompatible. Debe recrearse manualmente.',
    },
  },
  kafka: {
    topic: {
      low:      'El topic «{resource_name}» tiene diferencias menores en configuración.',
      medium:   'El topic «{resource_name}» tiene diferencias en configuración (retention, cleanup policy). Revisar el impacto antes de reaprovisionar.',
      high:     'El topic «{resource_name}» tiene un número diferente de particiones. Kafka no permite reducir particiones. Si el artefacto tiene más particiones que el destino, el topic deberá recrearse. Si tiene menos, el conflicto es informativo.',
      critical: 'El topic «{resource_name}» es incompatible. Resolver manualmente.',
    },
    acl: {
      low:      'La ACL «{resource_name}» tiene diferencias menores.',
      medium:   'La ACL «{resource_name}» tiene operaciones o permisos diferentes. Verificar si la diferencia es intencional.',
      high:     'La ACL «{resource_name}» tiene diferencias significativas de permisos. Revisar el impacto en consumidores y productores.',
      critical: 'La ACL «{resource_name}» es incompatible. Resolver manualmente.',
    },
  },
  functions: {
    action: {
      low:      'La acción «{resource_name}» tiene diferencias menores en parámetros.',
      medium:   'La acción «{resource_name}» tiene código o límites diferentes. Verificar si la diferencia es intencional.',
      high:     'La acción «{resource_name}» tiene un runtime diferente. Cambiar el runtime puede romper la ejecución. Revisar antes de reaprovisionar.',
      critical: 'La acción «{resource_name}» es incompatible. Resolver manualmente.',
    },
    package: {
      low:      'El paquete «{resource_name}» tiene diferencias menores.',
      medium:   'El paquete «{resource_name}» tiene bindings diferentes. Verificar si la diferencia es intencional.',
      high:     'El paquete «{resource_name}» tiene diferencias significativas. Revisar antes de reaprovisionar.',
      critical: 'El paquete «{resource_name}» es incompatible. Resolver manualmente.',
    },
    trigger: {
      low:      'El trigger «{resource_name}» tiene diferencias menores.',
      medium:   'El trigger «{resource_name}» tiene configuración de feed diferente. Verificar si la diferencia es intencional.',
      high:     'El trigger «{resource_name}» tiene diferencias significativas. Revisar antes de reaprovisionar.',
      critical: 'El trigger «{resource_name}» es incompatible. Resolver manualmente.',
    },
    rule: {
      low:      'La rule «{resource_name}» tiene diferencias menores.',
      medium:   'La rule «{resource_name}» apunta a una acción o trigger diferente. Verificar si la diferencia es intencional.',
      high:     'La rule «{resource_name}» tiene diferencias significativas. Revisar antes de reaprovisionar.',
      critical: 'La rule «{resource_name}» es incompatible. Resolver manualmente.',
    },
  },
  storage: {
    bucket: {
      low:      'El bucket «{resource_name}» tiene diferencias menores en CORS.',
      medium:   'El bucket «{resource_name}» tiene diferencias en versioning, lifecycle o política. Verificar si la diferencia es intencional.',
      high:     'El bucket «{resource_name}» tiene diferencias significativas de configuración. Revisar el impacto antes de reaprovisionar.',
      critical: 'El bucket «{resource_name}» es incompatible. Resolver manualmente.',
    },
  },
};

/** Recomendación genérica de fallback cuando no existe entrada para la combinación. */
export const GENERIC_RECOMMENDATION =
  'Revisar la diferencia en el recurso «{resource_name}» y resolver manualmente antes de ejecutar el reaprovisionamiento si es necesario.';

/**
 * Devuelve la recomendación accionable para un conflicto.
 * Busca en el árbol RECOMMENDATIONS[domain][resource_type][severity].
 * Cae a GENERIC_RECOMMENDATION si no hay entrada para la combinación.
 * Interpola {resource_name} en el template.
 *
 * @param {string} domain
 * @param {string} resource_type
 * @param {'low'|'medium'|'high'|'critical'} severity
 * @param {string} resource_name
 * @returns {string}
 */
export function getRecommendation(domain, resource_type, severity, resource_name);
```

**Criterio de aceptación**: `getRecommendation('postgres_metadata', 'table', 'high', 'events')` devuelve texto específico que incluye `events`; `getRecommendation('kafka', 'topic', 'high', 'my-topic')` menciona particiones; combinación no mapeada → texto genérico con `resource_name` interpolado.

---

### T-06 · Registro de analizadores `preflight/analyzer-registry.mjs`

**Archivo**: `services/provisioning-orchestrator/src/preflight/analyzer-registry.mjs`

Módulo ligero que registra los seis analizadores siguiendo el mismo patrón que `reprovision/registry.mjs` de T03:

```js
import { analyze as analyzeIam }       from './analyzers/iam-analyzer.mjs';
import { analyze as analyzePostgres }  from './analyzers/postgres-analyzer.mjs';
import { analyze as analyzeMongo }     from './analyzers/mongo-analyzer.mjs';
import { analyze as analyzeKafka }     from './analyzers/kafka-analyzer.mjs';
import { analyze as analyzeFunctions } from './analyzers/functions-analyzer.mjs';
import { analyze as analyzeStorage }   from './analyzers/storage-analyzer.mjs';

/** Orden canónico de análisis. Misma secuencia que APPLIER_ORDER de T03. */
export const ANALYZER_ORDER = ['iam', 'postgres_metadata', 'mongo_metadata', 'kafka', 'functions', 'storage'];

/**
 * Construye el registro de analizadores según feature flags.
 *
 * Feature flags:
 * - CONFIG_PREFLIGHT_OW_ENABLED    → habilita analizador de funciones (default: 'false')
 * - CONFIG_PREFLIGHT_MONGO_ENABLED → habilita analizador de MongoDB  (default: 'false')
 * - IAM, PostgreSQL, Kafka, Storage siempre registrados.
 *
 * Si un analizador no está registrado, el dominio devuelve un DomainAnalysisResult con
 * status: 'skipped_not_exportable' y analysis_error_message: 'analyzer_not_enabled'.
 *
 * @param {string} [deploymentProfile]
 * @returns {Map<string, (tenantId: string, domainData: Object, options: Object) => Promise<import('./types.mjs').DomainAnalysisResult>>}
 */
export function getAnalyzerRegistry(deploymentProfile = 'standard');
```

**Criterio de aceptación**: Con ambos flags activos, el registro contiene los seis analizadores en orden canónico. Con `CONFIG_PREFLIGHT_OW_ENABLED=false`, el analizador de funciones no está registrado y el dominio devuelve `skipped_not_exportable`.

---

## Bloque 3 — Analizadores de dominio [PARALELO entre sí, requiere Bloque 2]

Cada analizador exporta una función `analyze(tenantId, domainData, options)`:

```js
/**
 * Analiza un dominio en modo read-only y devuelve los conflictos detectados.
 *
 * @param {string} tenantId    - tenant destino
 * @param {Object} domainData  - sección `data` del artefacto (ya con identificadores sustituidos)
 * @param {Object} options
 * @param {Object}  [options.credentials] - credenciales de lectura para el subsistema (CONFIG_EXPORT_*)
 * @param {number}  [options.timeoutMs]   - timeout en ms para este analizador
 * @param {Console} [options.log]
 * @returns {Promise<import('../preflight/types.mjs').DomainAnalysisResult>}
 */
export async function analyze(tenantId, domainData, options);
```

**Patrón común de todos los analizadores**:

1. Si `domainData` es null, vacío o sin items → devolver `{ domain_key, status: 'no_conflicts', resources_analyzed: 0, compatible_count: 0, compatible_with_redacted_count: 0, conflicts: [], compatible_with_redacted: [], analysis_error_message: null }`.
2. Para cada recurso en `domainData`:
   a. Obtener el estado actual del recurso en el subsistema destino en modo **solo lectura**.
   b. Si el recurso **no existe** en el destino → `compatible` (no hay conflicto; el artefacto lo crearía si se reprovisionara).
   c. Si el recurso **existe** → comparar con `compareResources` de `../reprovision/diff.mjs`.
      - Si es igual → `compatible`.
      - Si difiere → extraer `diffKeys` del resultado de `buildDiff`.
        - Si todos los campos que difieren son `***REDACTED***` → `compatible_with_redacted_fields`.
        - Si difieren campos no redactados → `conflict` con severidad (de `conflict-classifier`) y recomendación (de `recommendation-engine`).
3. Capturar errores por recurso individual con `try/catch`; un error en un recurso no aborta el análisis del dominio. El recurso fallido se incluye como `conflict` con severidad `high` y mensaje del error.
4. Si el analizador falla completamente (error al conectar al subsistema) → capturar y devolver `{ status: 'analysis_error', analysis_error_message: mensaje_descriptivo, ... }`.
5. Calcular `status` del dominio: `'analyzed'` si hay algún recurso procesado, `'no_conflicts'` si todos son compatibles (y compatible_with_redacted), `'analysis_error'` si el analizador falló completamente.

**Los analizadores NUNCA llaman a APIs de escritura**. Usan las mismas credenciales de solo lectura que los recolectores de T01 (`CONFIG_EXPORT_*`).

### T-07 · Analizador IAM `analyzers/iam-analyzer.mjs`

**Archivo**: `services/provisioning-orchestrator/src/preflight/analyzers/iam-analyzer.mjs`

Recursos analizados: roles, grupos, client scopes, identity providers.
Credencial: `CONFIG_EXPORT_KEYCLOAK_URL`, `CONFIG_EXPORT_KEYCLOAK_ADMIN_CLIENT_ID`, `CONFIG_EXPORT_KEYCLOAK_ADMIN_SECRET`.
API de lectura: Keycloak Admin REST API (solo `GET`).

Criterio de comparación (delegado a `compareResources` de `../reprovision/diff.mjs`):
- **Roles**: compara `composites`, `attributes`. Ignora `id` (identificador interno de Keycloak).
  - Diff keys para clasificación: `composites`, `attributes`, `description`.
- **Grupos**: compara `path`, `attributes`. Ignora `id`.
  - Diff keys: `path`, `attributes`.
- **Client scopes**: compara `protocol`, `protocolMappers`. Ignora `id`.
  - Diff keys: `protocol`, `protocolMappers`.
- **Identity providers**: compara `providerId`, `config`. Ignora timestamps en `config` (ej: `lastRefresh`, `lastImport`).
  - Diff keys: `providerId`, `config`.

**Criterio de aceptación**: Recurso no existente → compatible; recurso idéntico → compatible; rol con composites diferentes → conflict con severity `medium`; campo redactado único diferente → `compatible_with_redacted_fields`; Keycloak inaccesible → `analysis_error`.

---

### T-08 · Analizador PostgreSQL `analyzers/postgres-analyzer.mjs`

**Archivo**: `services/provisioning-orchestrator/src/preflight/analyzers/postgres-analyzer.mjs`

Recursos analizados: esquemas, tablas (columnas, tipos, nullable, default, constraints, índices), vistas, extensiones, grants.
Credencial: `CONFIG_EXPORT_PG_CONNECTION_STRING` o `CONFIG_EXPORT_PG_*` individuales.
API de lectura: queries a `information_schema.columns`, `information_schema.schemata`, `pg_constraint`, `pg_indexes`, `pg_views`, `pg_extension`, `information_schema.role_table_grants`. Solo `SELECT`.

Criterio de comparación:
- **Esquema**: existencia por nombre en `information_schema.schemata`.
- **Tabla**: misma estructura de columnas (nombre, tipo, nullable, default) + mismos constraints PK/FK/UK + mismos índices. Usar `information_schema.columns` + `pg_constraint` + `pg_indexes`.
  - Diff keys: `columns`, `constraints`, `indexes`.
- **Vista**: misma definición textual normalizada (`pg_views.definition`, trim + lowercase).
  - Diff keys: `definition`.
- **Extensión**: misma versión instalada (`pg_extension.extversion`).
  - Diff keys: `version`.
- **Grant**: misma combinación grantee/privilege/objeto (`information_schema.role_table_grants`).
  - Diff keys: `privilege`.

**Criterio de aceptación**: Tabla con columnas incompatibles → conflict con severity `high`; tabla inexistente → compatible; PostgreSQL inaccesible → `analysis_error`.

---

### T-09 · Analizador MongoDB `analyzers/mongo-analyzer.mjs`

**Archivo**: `services/provisioning-orchestrator/src/preflight/analyzers/mongo-analyzer.mjs`

Recursos analizados: colecciones (con validadores), índices.
Credencial: `CONFIG_EXPORT_MONGO_URI`.
API de lectura: `db.listCollections()` con `options.validator`; `collection.listIndexes()`. Sin operaciones de escritura.

Criterio de comparación:
- **Colección**: mismo validador JSON Schema (profundo). Comparar `options.validator`.
  - Diff keys: `validator`.
- **Índice**: misma `key` + mismas `options` (unique, sparse, background, expireAfterSeconds).
  - Diff keys: `key`, `unique`, `options`.
- Si el artefacto contiene configuración de sharding y la colección en destino no está sharded → conflict con severity `critical`.

**Criterio de aceptación**: Colección con validador incompatible → conflict con severity `high`; índice con clave diferente → conflict con severity `critical`; MongoDB inaccesible → `analysis_error`.

---

### T-10 · Analizador Kafka `analyzers/kafka-analyzer.mjs`

**Archivo**: `services/provisioning-orchestrator/src/preflight/analyzers/kafka-analyzer.mjs`

Recursos analizados: topics (numPartitions, replicationFactor, configEntries), ACLs.
Credencial: `CONFIG_EXPORT_KAFKA_BROKERS`, `CONFIG_EXPORT_KAFKA_SASL_*`.
API de lectura: `admin.describeTopics()`, `admin.describeAcls()`, `admin.fetchTopicMetadata()`. Sin operaciones de escritura.

Criterio de comparación:
- **Topic**: mismo nombre + mismo `numPartitions` + mismos `configEntries` relevantes (retention.ms, cleanup.policy, min.insync.replicas, max.message.bytes).
  - Diff keys: `numPartitions`, `replicationFactor`, `configEntries`, `retentionMs`, `cleanupPolicy`.
- **ACL**: mismo principal + operation + resourceType + patternType + permissionType.
  - Diff keys: `permission`, `operation`.

**Criterio de aceptación**: Topic con numPartitions diferentes → conflict con severity `high` y recomendación sobre particiones Kafka; topic idéntico → compatible; Kafka inaccesible → `analysis_error`.

---

### T-11 · Analizador OpenWhisk `analyzers/functions-analyzer.mjs`

**Archivo**: `services/provisioning-orchestrator/src/preflight/analyzers/functions-analyzer.mjs`

Recursos analizados: paquetes, acciones (runtime, código, límites, parámetros no redactados), triggers, rules.
Credencial: `CONFIG_EXPORT_OW_API_HOST`, `CONFIG_EXPORT_OW_API_KEY`.
API de lectura: `GET /api/v1/namespaces/{namespace}/actions`, `GET /api/v1/namespaces/{namespace}/packages`, etc. Sin operaciones de escritura.
Habilitado con flag: `CONFIG_PREFLIGHT_OW_ENABLED` (default `'false'`).

Criterio de comparación:
- **Acción**: mismo nombre + mismo runtime + mismo hash de código (`exec.code` o `exec.binary`) + mismos límites.
  - Diff keys: `runtime`, `code`, `limits`, `parameters`.
  - Parámetros con `***REDACTED***` se excluyen de la comparación (no generan conflicto por sí mismos).
- **Paquete**: mismo nombre + mismo binding.
  - Diff keys: `binding`.
- **Trigger**: mismo nombre + misma configuración de feed.
  - Diff keys: `feed`.
- **Rule**: mismo nombre + misma action + mismo trigger.
  - Diff keys: `action`, `trigger`.

**Criterio de aceptación**: Si `CONFIG_PREFLIGHT_OW_ENABLED=false`, el analizador no está registrado y el dominio devuelve `skipped_not_exportable`. Acción con runtime diferente → conflict con severity `high`; parámetro redactado único diferente → `compatible_with_redacted_fields`.

---

### T-12 · Analizador Storage S3 `analyzers/storage-analyzer.mjs`

**Archivo**: `services/provisioning-orchestrator/src/preflight/analyzers/storage-analyzer.mjs`

Recursos analizados: buckets (versioning, lifecycle, política, CORS).
Credencial: `CONFIG_EXPORT_S3_ENDPOINT`, `CONFIG_EXPORT_S3_ACCESS_KEY`, `CONFIG_EXPORT_S3_SECRET_KEY`.
API de lectura: `GetBucketVersioning`, `GetBucketLifecycleConfiguration`, `GetBucketPolicy`, `GetBucketCors`. Sin operaciones de escritura.

Criterio de comparación:
- **Bucket**: mismo nombre. Si existe → comparar versioning + lifecycle + política (JSON normalizado) + CORS (reglas como conjunto, sin orden).
  - Diff keys: `versioning`, `lifecycle`, `policy`, `cors`.
- Bucket inexistente en destino → compatible (no conflicto).

**Criterio de aceptación**: Bucket con política diferente → conflict con severity `medium`; bucket con CORS diferente → conflict con severity `low`; bucket inexistente → compatible; S3 inaccesible → `analysis_error`.

---

## Bloque 4 — Publisher de eventos [PARALELO con Bloque 3]

### T-13 · Publisher de eventos de validación previa

**Archivo**: `services/provisioning-orchestrator/src/events/config-preflight-events.mjs`

> **Nota**: Este archivo puede no existir si la plataforma publica eventos de auditoría directamente desde el repositorio. Si ya existe un módulo `config-export-events.mjs` o similar como patrón de referencia, seguirlo exactamente.

Siguiendo el patrón de `config-reprovision-events.mjs` (T03):

```js
export const CONFIG_PREFLIGHT_TOPIC =
  process.env.CONFIG_PREFLIGHT_KAFKA_TOPIC ?? 'console.config.reprovision.preflight';

/**
 * Construye el payload del evento de validación previa.
 * Los campos deben ser compatibles con el schema de
 * contracts/config-preflight-audit-event.json.
 */
export function buildPreflightAuditEvent(p);

/**
 * Fire-and-forget: publica el evento de auditoría.
 * Captura errores de Kafka sin abortar el flujo de la action.
 */
export async function publishPreflightAuditEvent(kafkaProducer, eventPayload, log);
```

El campo `operation_type` del evento debe ser `'pre_flight_check'` para distinguirlo de `'reprovision'` e `'identifier_map'`. Campos `event_id` y `emitted_at` generados internamente.

**Criterio de aceptación**: `publishPreflightAuditEvent` retorna `{ published: false }` cuando no hay producer (no lanza). El event shape supera la validación del JSON schema del contrato `contracts/config-preflight-audit-event.json`.

---

## Bloque 5 — Action OpenWhisk [requiere Bloques 1, 2, 3 y 4]

### T-14 · Action principal `actions/tenant-config-preflight.mjs`

**Archivo**: `services/provisioning-orchestrator/src/actions/tenant-config-preflight.mjs`

Implementar la función `main(params, overrides)` siguiendo el patrón de `tenant-config-reprovision.mjs` (T03). Flujo completo:

```text
1. Extraer claims JWT
   - Reutilizar lógica de extractAuth de export/reprovision.
   - Scope requerido: platform:admin:config:reprovision (mismo que T03; no se crea scope nuevo).
   - Sin scope o rol insuficiente → return { statusCode: 403 }.

2. Extraer tenant_id del path o params.

3. Verificar que el tenant destino existe (tenantExistsFn) → 404 si no existe.

4. Parsear body: { artifact, identifier_map?, domains? }

5. Validar formato del artefacto:
   - Verificar format_version: mismo major que SUPPORTED_FORMAT_MAJOR.
   - Si major incompatible → return { statusCode: 422, body: { error: '...' } }.

6. Validar y normalizar identifier_map:
   - Si artifact.tenant_id !== tenant_id (destino):
     a. Si no se proporciona identifier_map:
        → buildProposedIdentifierMap(artifact, tenant_id)
        → return { statusCode: 200, body: { needs_confirmation: true, identifier_map_proposal: map } }
        (No se ejecuta el análisis de conflictos.)
     b. Si se proporciona identifier_map:
        → validateIdentifierMap(identifier_map); si inválido → return { statusCode: 400 }.
   - Si artifact.tenant_id === tenant_id → identifier_map puede ser null.

7. Aplicar identifier_map al artefacto en memoria (applyIdentifierMap de ../reprovision/identifier-map.mjs).

8. Filtrar dominios a analizar:
   - Si params.domains especificado:
     → Verificar que todos están en KNOWN_DOMAINS; si hay desconocidos → return { statusCode: 400 }.
     → Usar la intersección de params.domains con dominios disponibles del artefacto.
   - Si params.domains no especificado → analizar todos los dominios con status 'ok' o 'empty'.
   - Dominios con status 'error'/'not_available'/'not_requested' → DomainAnalysisResult con
     status 'skipped_not_exportable', counts en 0, conflicts vacío.

9. Ejecutar analizadores EN PARALELO (Promise.allSettled):
   - const registry = getAnalyzerRegistry();
   - const results = await Promise.allSettled(
       domainsToAnalyze.map(domain =>
         withTimeout(registry.get(domain)(tenantId, domainData, opts), timeoutMs, domain)
       )
     );
   - Para cada resultado settled:
     - fulfilled → usar DomainAnalysisResult directamente.
     - rejected → DomainAnalysisResult con status 'analysis_error' y analysis_error_message del error.

10. Construir PreflightSummary:
    - Agregar todos los ConflictEntry de todos los dominios analizados.
    - Calcular conflict_counts por severidad.
    - computeGlobalRiskLevel(allConflicts) → risk_level.
    - incomplete_analysis = algún dominio tiene status 'analysis_error'.
    - domains_analyzed = dominios con status 'analyzed' o 'no_conflicts'.
    - domains_skipped = dominios con status 'skipped_not_exportable' o 'analysis_error'.

11. Construir PreflightReport completo con correlation_id generado, analyzed_at = NOW().

12. Insertar auditoría PostgreSQL (insertPreflightAuditLog). No abortar si falla.

13. Publicar evento Kafka (fire-and-forget, publishPreflightAuditEvent).

14. Retornar { statusCode: 200, body: PreflightReport }.
```

**La action NO adquiere el lock de reaprovisionamiento de T03 en ningún momento.**

**Manejo de errores HTTP**:

| Condición | HTTP |
|---|---|
| Sin autenticación o scope incorrecto | 403 |
| tenant_id no encontrado | 404 |
| format_version con major incompatible | 422 |
| identifier_map inválido | 400 |
| Dominio desconocido en filtro `domains` | 400 |
| tenant_id difiere y no se proporciona mapa | 200 con `needs_confirmation: true` (sin análisis) |
| Uno o más analizadores fallaron (parcial) | 200 con `incomplete_analysis: true` |
| Análisis completo | 200 |

> **Nota**: El endpoint nunca devuelve `207` ni `500`. Un fallo parcial de analizadores es un resultado válido expresado en `incomplete_analysis`. No existe lock de concurrencia.

**Variables de entorno usadas**:

| Variable | Descripción | Default |
|---|---|---|
| `CONFIG_PREFLIGHT_SUPPORTED_FORMAT_MAJOR` | Major version del artefacto aceptada | `'1'` |
| `CONFIG_PREFLIGHT_ANALYZER_TIMEOUT_MS` | Timeout por analizador en ms | `10000` |
| `CONFIG_PREFLIGHT_OW_ENABLED` | Habilita analizador de funciones | `'false'` |
| `CONFIG_PREFLIGHT_MONGO_ENABLED` | Habilita analizador de MongoDB | `'false'` |
| `CONFIG_PREFLIGHT_KAFKA_TOPIC` | Topic Kafka para eventos de auditoría | `'console.config.reprovision.preflight'` |
| Credenciales de lectura (`CONFIG_EXPORT_*`) | Reutilizadas de T01 | — |

**Criterio de aceptación**: Las pruebas unitarias (T-20) cubren todos los paths de retorno HTTP.

---

## Bloque 6 — Gateway [PARALELO con Bloque 5]

### T-15 · Ruta APISIX `backup-admin-routes.yaml`

**Archivo**: `services/gateway-config/routes/backup-admin-routes.yaml`

Añadir al YAML existente, después de las rutas de reprovision de T03 (sin modificar las rutas ya presentes):

```yaml
  - name: config-preflight-post
    uri: /v1/admin/tenants/*/config/reprovision/preflight
    methods:
      - POST
    plugins:
      keycloak-openid-connect:
        enabled: true
        required_scopes:
          - platform:admin:config:reprovision
      limit-req:
        rate: 5
        burst: 10
        key: consumer_name
      response-rewrite:
        headers:
          set:
            Cache-Control: "no-store"
    upstream:
      type: roundrobin
      timeout:
        connect: 5
        send: 60
        read: 60
      nodes:
        openwhisk-tenant-config-preflight: 1
```

> **Nota de scope**: No se añade ni modifica ninguna entrada en `backup-scopes.yaml` de Keycloak. T04 reutiliza el scope `platform:admin:config:reprovision` definido en T03. El acceso solo se otorga a `superadmin`, `sre` y `service_account`.

**Criterio de aceptación**: El YAML es válido, la ruta nueva no solapa con las existentes, y el timeout `send/read: 60` es coherente con el target de 30 s de análisis estándar.

---

## Bloque 7 — Consola web [PARALELO con Bloque 5, requiere contratos estables]

### T-16 · API client `configPreflightApi.ts`

**Archivo**: `apps/web-console/src/api/configPreflightApi.ts`

Siguiendo el patrón de `configExportApi.ts` y `configReprovisionApi.ts` (T03):

```ts
export class ConfigPreflightApiError extends Error {
  constructor(message: string, public readonly statusCode: number, public readonly body?: unknown) {
    super(message);
  }
}

export interface ConflictEntry {
  resource_type: string;
  resource_name: string;
  resource_id: string | null;
  severity: 'low' | 'medium' | 'high' | 'critical';
  diff: Record<string, unknown> | null;
  recommendation: string;
}

export interface CompatibleWithRedactedEntry {
  resource_type: string;
  resource_name: string;
  resource_id: string | null;
  redacted_fields: string[];
}

export interface DomainAnalysisResult {
  domain_key: string;
  status: 'analyzed' | 'no_conflicts' | 'skipped_not_exportable' | 'analysis_error';
  resources_analyzed: number;
  compatible_count: number;
  compatible_with_redacted_count: number;
  conflicts: ConflictEntry[];
  compatible_with_redacted: CompatibleWithRedactedEntry[];
  analysis_error_message: string | null;
}

export interface PreflightSummary {
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  total_resources_analyzed: number;
  compatible: number;
  compatible_with_redacted_fields: number;
  conflict_counts: { low: number; medium: number; high: number; critical: number };
  incomplete_analysis: boolean;
  domains_analyzed: string[];
  domains_skipped: string[];
}

export interface PreflightReport {
  correlation_id: string;
  source_tenant_id: string;
  target_tenant_id: string;
  format_version: string;
  analyzed_at: string;
  summary: PreflightSummary;
  domains: DomainAnalysisResult[];
  needs_confirmation?: boolean;
  identifier_map_proposal?: unknown;
}

export interface PreflightRequest {
  artifact: object;
  identifier_map?: { entries: { from: string; to: string; scope?: string | null }[] } | null;
  domains?: string[] | null;
}

/** POST /v1/admin/tenants/{tenantId}/config/reprovision/preflight */
export async function runPreflightCheck(
  tenantId: string,
  request: PreflightRequest
): Promise<PreflightReport>;
```

Maneja errores HTTP: 400 (mapa inválido / dominio desconocido), 403 (sin permisos), 404 (tenant no encontrado), 422 (format_version incompatible).

**Criterio de aceptación**: Tipos alineados con el contrato OpenAPI `contracts/tenant-config-preflight.json`. Los tipos `PreflightSummary` y `DomainAnalysisResult` coinciden con las interfaces de la action.

---

### T-17 · Badge de riesgo `PreflightRiskBadge.tsx`

**Archivo**: `apps/web-console/src/components/PreflightRiskBadge.tsx`

Componente React que renderiza un badge de color según el nivel de riesgo:

```tsx
interface PreflightRiskBadgeProps {
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  size?: 'sm' | 'md' | 'lg';
}
```

Colores:
- `low` → verde (bg-green-100, text-green-800)
- `medium` → amarillo (bg-yellow-100, text-yellow-800)
- `high` → naranja (bg-orange-100, text-orange-800)
- `critical` → rojo (bg-red-100, text-red-800)

Etiquetas: `'Sin conflictos'` para `low`, `'Riesgo medio'` para `medium`, `'Riesgo alto'` para `high`, `'Riesgo crítico'` para `critical`.

Usar clases de Tailwind CSS + `shadcn/ui Badge` siguiendo el patrón existente en la consola.

**Criterio de aceptación**: El componente renderiza el color y texto correctos para cada nivel. Accesible: `aria-label` descriptivo.

---

### T-18 · Panel de informe de conflictos `PreflightConflictReport.tsx`

**Archivo**: `apps/web-console/src/components/PreflightConflictReport.tsx`

Componente React que muestra el informe completo de validación previa:

```tsx
interface PreflightConflictReportProps {
  report: PreflightReport;
}
```

Estructura del panel:

1. **Resumen ejecutivo**: `PreflightRiskBadge` prominente + conteos (recursos analizados, compatibles, conflictos por severidad). Si `incomplete_analysis` → banner amarillo de advertencia con los dominios que fallaron.

2. **Sección por dominio**: Para cada `DomainAnalysisResult`:
   - Encabezado expandible con nombre del dominio, badge de status y número de conflictos.
   - `status: 'skipped_not_exportable'` → chip gris "No exportado".
   - `status: 'analysis_error'` → chip rojo "Error de análisis" + mensaje.
   - `status: 'no_conflicts'` → chip verde "Sin conflictos".
   - `status: 'analyzed'` → lista de conflictos.

3. **Sección de conflictos por dominio**: Para cada `ConflictEntry`:
   - Nombre y tipo del recurso.
   - Badge de severidad con colores (mismos que `PreflightRiskBadge` pero en escala reducida).
   - Bloque colapsable con diff (key → { artifact: valor, destino: valor }).
   - Recomendación en texto.

4. **Sección "Recursos con campos redactados"** (colapsada por defecto): Lista de `compatible_with_redacted_fields` con los campos redactados que no se compararon.

**Criterio de aceptación**: Renderiza todos los estados de dominio y tipo de recurso. Banner de `incomplete_analysis` visible cuando corresponde. Sección de redactados colapsada por defecto.

---

### T-19 · Página de consola `ConsoleTenantConfigPreflightPage.tsx`

**Archivo**: `apps/web-console/src/pages/ConsoleTenantConfigPreflightPage.tsx`

Página de admin que integra los componentes en un flujo de dos pasos:

**Paso 1 — Cargar y analizar**
- Campo de tenant_id destino (puede ser prefilled desde contexto de navegación).
- Área de texto o file upload para pegar/subir el JSON del artefacto.
- Selector opcional de dominios (multi-select, default: todos).
- Botón "Analizar conflictos" → llama `runPreflightCheck`.
- Estado de carga con spinner.

**Caso especial — needs_confirmation**:
- Si el endpoint devuelve `needs_confirmation: true` → mostrar `ConfigIdentifierMapEditor` (del T03) para que el operador confirme el mapa antes de ejecutar el análisis real.
- Botón "Confirmar mapa y analizar" → relanza `runPreflightCheck` con el mapa confirmado.

**Paso 2 — Resultado**
- Muestra `PreflightConflictReport` con el informe completo.
- Si `risk_level === 'low'` y `!incomplete_analysis` → banner verde "Sin conflictos detectados. Puede reaprovisionar con confianza."
- Si hay conflictos → banner informativo con enlace a la página de reaprovisionamiento (T03) como siguiente paso sugerido.
- Botón "Nueva validación" para reiniciar el flujo.

**Control de acceso**: La página solo se muestra a usuarios con rol `superadmin` o `sre`. Para `tenant_owner`, redirigir a la página de error 403.

**Criterio de aceptación**: El flujo completo (cargar → analizar → resultado) es navegable. El caso `needs_confirmation` muestra el editor de mapa antes de ejecutar el análisis. Usuarios sin privilegios no pueden acceder.

---

## Bloque 8 — Tests [requiere Bloques 2, 3, 4, 5]

### T-20 · Tests de la action `src/tests/actions/tenant-config-preflight.test.mjs`

**Archivo**: `services/provisioning-orchestrator/src/tests/actions/tenant-config-preflight.test.mjs`

Framework: `node:test` + `node:assert/strict`. DI injection siguiendo el patrón de `tenant-config-reprovision.test.mjs` (T03).

Casos obligatorios (mínimo 16):

| # | Condición | HTTP esperado |
|---|---|---|
| 1 | Sin autenticación | 403 |
| 2 | Scope incorrecto | 403 |
| 3 | Rol `tenant_owner` autenticado | 403 |
| 4 | Tenant inexistente | 404 |
| 5 | `format_version` con major incompatible | 422 |
| 6 | Artefacto con `tenant_id` diferente y sin `identifier_map` | 200 con `needs_confirmation: true` y propuesta; sin `domains` en body |
| 7 | `identifier_map` con `to` vacío | 400 |
| 8 | Dominio desconocido en filtro `domains` | 400 |
| 9 | Happy path: tenant vacío, 6 dominios ok | 200, cero conflictos, `risk_level: 'low'` |
| 10 | Conflictos mixtos: rol IAM (medium) + tabla PG (high) | 200, `risk_level: 'high'`, conflictos por severidad |
| 11 | Filtrado de dominios `['iam', 'functions']` | 200, solo esos dominios en `domains` |
| 12 | Analizador MongoDB falla (timeout) | 200 con `incomplete_analysis: true`, demás dominios analizados |
| 13 | Todos los analizadores fallan | 200 con `incomplete_analysis: true`, `conflict_counts` todos en 0 |
| 14 | Auditoría insertada correctamente (spy en `insertPreflightAuditLog`) | — |
| 15 | `publishPreflightAuditEvent` llamado (spy) | — |
| 16 | La action NO llama a `acquireLock` ni `releaseLock` en ningún caso | — |
| 17 | Dos invocaciones concurrentes sobre mismo tenant completan normalmente (sin bloqueo) | 200 ambas |
| 18 | Recursos con campo `***REDACTED***` único diferente → `compatible_with_redacted_fields`, no `conflict` | — |

**Criterio de aceptación**: Todos los 18 casos pasan. El test 16 verifica que no hay import ni llamada a ningún módulo de lock.

---

### T-21 · Tests unitarios del clasificador `tests/preflight/conflict-classifier.test.mjs`

**Archivo**: `services/provisioning-orchestrator/tests/preflight/conflict-classifier.test.mjs`

Framework: `node:test` + `node:assert/strict`.

Casos obligatorios:

- `classifySeverity('postgres_metadata', 'table', ['columns'])` → `'high'`
- `classifySeverity('kafka', 'topic', ['numPartitions'])` → `'high'`
- `classifySeverity('iam', 'role', ['description'])` → `'low'`
- `classifySeverity('iam', 'role', ['composites'])` → `'medium'`
- `classifySeverity('mongo_metadata', 'index', ['key'])` → `'critical'`
- `classifySeverity` con diff key no mapeada → `'medium'` (fallback)
- `classifySeverity` con múltiples diffKeys, el máximo prevalece: `['description', 'composites']` → `'medium'`
- `classifySeverity` con múltiples diffKeys incluyendo `'high'`: `['composites', 'columns']` en un recurso arbitrario con tabla → `'high'`
- `computeGlobalRiskLevel([])` → `'low'`
- `computeGlobalRiskLevel` con solo conflictos `low` → `'low'`
- `computeGlobalRiskLevel` con conflictos `low` y `medium` → `'medium'`
- `computeGlobalRiskLevel` con conflictos de todos los niveles → `'critical'`
- Verificar que el orden `low < medium < high < critical` se respeta.

---

### T-22 · Tests unitarios del motor de recomendaciones `tests/preflight/recommendation-engine.test.mjs`

**Archivo**: `services/provisioning-orchestrator/tests/preflight/recommendation-engine.test.mjs`

Framework: `node:test` + `node:assert/strict`.

Casos obligatorios:

- `getRecommendation('postgres_metadata', 'table', 'high', 'events')` → texto específico que incluye `'events'` y menciona columnas/estructura.
- `getRecommendation('kafka', 'topic', 'high', 'my-topic')` → texto específico que menciona particiones y `'my-topic'`.
- `getRecommendation('iam', 'role', 'medium', 'editor')` → texto específico que menciona permisos y `'editor'`.
- `getRecommendation('iam', 'role', 'low', 'viewer')` → texto que incluye `'viewer'` y no alarma innecesariamente.
- Combinación no mapeada (ej: dominio inexistente) → texto genérico de `GENERIC_RECOMMENDATION` con `resource_name` interpolado.
- Interpolación: `{resource_name}` sustituido correctamente por el valor pasado.
- Cuando `resource_name` contiene caracteres especiales (e.g. `'my-bucket/sub'`) → interpolación correcta sin error.

---

### T-23 · Tests unitarios de analizadores `tests/preflight/*.test.mjs`

**Archivos** (uno por analizador):

```text
services/provisioning-orchestrator/tests/preflight/
  iam-analyzer.test.mjs
  postgres-analyzer.test.mjs
  mongo-analyzer.test.mjs
  kafka-analyzer.test.mjs
  functions-analyzer.test.mjs
  storage-analyzer.test.mjs
```

Framework: `node:test` + `node:assert/strict`. Mockear el cliente del subsistema mediante DI o import patching.

Para **cada** analizador, cubrir:

- **Recurso no existe en destino** → `DomainAnalysisResult` con recurso como `compatible`, conflict array vacío.
- **Recurso existe idéntico** → recurso como `compatible`, conflict array vacío.
- **Recurso existe diferente en campo no redactado** → recurso como `conflict` con severidad y recomendación correctas para el tipo.
- **Recurso existe diferente solo en campo `***REDACTED***`** → recurso como `compatible_with_redacted_fields`, NOT en `conflicts`.
- **Dominio vacío (null o sin items)** → `DomainAnalysisResult` con `status: 'no_conflicts'`, todos los conteos en 0.
- **Error de API del subsistema en un recurso** → ese recurso con conflict de severidad alta y mensaje del error; los demás recursos del dominio continúan.
- **Error de conexión al subsistema (análisis completo falla)** → `DomainAnalysisResult` con `status: 'analysis_error'` y `analysis_error_message` descriptivo.
- **Verificar que no se llama a ninguna API de escritura** (spy en todos los métodos del cliente mock que modifican estado).

Casos adicionales específicos por analizador:

**IAM**: Rol con `composites` diferentes → severity `medium`; identity provider con `providerId` diferente → severity `critical`.
**PostgreSQL**: Tabla con columnas incompatibles → severity `high`; vista con definición diferente → severity `medium`.
**MongoDB**: Colección con validador diferente → severity `high`; índice con `key` diferente → severity `critical`.
**Kafka**: Topic con `numPartitions` diferente → severity `high` con mención a particiones.
**Functions** (solo si `CONFIG_PREFLIGHT_OW_ENABLED=true`): Acción con runtime diferente → severity `high`. Parámetro redactado como único campo diferente → `compatible_with_redacted_fields`.
**Storage**: Bucket con política diferente → severity `medium`; CORS diferente → severity `low`.

---

### T-24 · Tests de contratos `tests/contracts/`

**Archivos**:

```text
tests/contracts/
  tenant-config-preflight.contract.test.mjs
  config-preflight-audit-event.contract.test.mjs
```

Siguiendo el patrón de `functions-import-export.contract.test.mjs` (SwaggerParser + Ajv):

**`tenant-config-preflight.contract.test.mjs`**:
- El contrato OpenAPI `specs/118-export-conflict-prechecks/contracts/tenant-config-preflight.json` es válido (`SwaggerParser.validate`).
- La ruta `POST /v1/admin/tenants/{tenant_id}/config/reprovision/preflight` existe en el documento.
- El scope `platform:admin:config:reprovision` está declarado en el security scheme.
- Los schemas `PreflightRequest`, `PreflightReport`, `PreflightSummary`, `DomainAnalysisResult`, `ConflictEntry` existen en `components.schemas`.
- `PreflightReport.required` incluye: `correlation_id`, `source_tenant_id`, `target_tenant_id`, `analyzed_at`, `summary`, `domains`.
- `PreflightSummary.required` incluye: `risk_level`, `total_resources_analyzed`, `incomplete_analysis`.
- `ConflictEntry.required` incluye: `resource_type`, `resource_name`, `severity`, `recommendation`.

**`config-preflight-audit-event.contract.test.mjs`**:
- El JSON Schema `specs/118-export-conflict-prechecks/contracts/config-preflight-audit-event.json` es válido (Ajv compile sin error).
- Un evento con todos los campos required supera la validación de Ajv.
- Un evento sin `operation_type` falla la validación.
- Un evento sin `actor_type` falla la validación.
- Un evento con `actor_type: 'tenant_owner'` (no permitido) falla la validación.
- Un evento con `operation_type: 'pre_flight_check'` es el único valor válido para esta operación.
- Si el schema tiene `additionalProperties: false`, campos extra rechazan la validación.

---

### T-25 · Tests E2E de flujo `tests/e2e/workflows/tenant-config-preflight.test.mjs`

**Archivo**: `tests/e2e/workflows/tenant-config-preflight.test.mjs`

Tests de integración de extremo a extremo usando mocks de subsistemas externos (sin conexiones reales). Cubrir mínimo 10 escenarios:

| # | Escenario | Resultado esperado |
|---|---|---|
| 1 | Artefacto con 6 dominios ok, tenant vacío | 200, cero conflictos, `risk_level: 'low'`, auditoría escrita, evento Kafka publicado |
| 2 | Filtrado de dominios `['iam', 'functions']` | Solo esos dos dominios en `domains`; demás ausentes |
| 3 | Rol IAM con composites diferentes | Conflicto de severidad `medium` en IAM; `risk_level: 'medium'` |
| 4 | Tabla PostgreSQL con columnas incompatibles + rol IAM compatible | Conflicto `high` en postgres; `risk_level: 'high'` |
| 5 | Mock de analizador MongoDB lanza timeout | `incomplete_analysis: true`, otros dominios analizados normalmente |
| 6 | Todos los analizadores fallan | `incomplete_analysis: true`, `conflict_counts` todos en 0, `risk_level: 'low'` |
| 7 | `format_version` con major incompatible | 422 |
| 8 | `tenant_id` difiere y no se proporciona mapa | 200 con `needs_confirmation: true`, sin `summary` ni `domains` en body |
| 9 | `tenant_id` difiere con mapa confirmado | Análisis ejecutado con identificadores del destino (no del origen) |
| 10 | Función con variable `***REDACTED***` como único campo diferente | `compatible_with_redacted_fields`, sin entrada en `conflicts` |
| 11 | Dos invocaciones simultáneas sobre mismo tenant | Ambas completan con 200; ninguna bloquea a la otra (verificar sin lock) |
| 12 | Kafka falla al publicar | Auditoría insertada, response 200, error de Kafka logueado y suprimido |

---

## Criterios de done (verificables antes del merge)

| # | Criterio |
|---|---|
| D-01 | Todos los archivos listados en el mapa de archivos existen o han sido modificados según lo especificado. |
| D-02 | `118-config-preflight.sql` es idempotente, crea la tabla `config_preflight_audit_log` con todos los campos del modelo y los índices correspondientes. |
| D-03 | La action `tenant-config-preflight.mjs` devuelve los códigos HTTP correctos para los 18 casos de T-20. |
| D-04 | La action **nunca** llama a `acquireLock`, `releaseLock` ni ninguna función de lock de T03. |
| D-05 | Los seis analizadores nunca ejecutan operaciones de escritura sobre ningún subsistema. |
| D-06 | Los valores `***REDACTED***` no generan `ConflictEntry`; los recursos afectados se clasifican como `compatible_with_redacted_fields`. |
| D-07 | El fallo de un analizador no aborta el análisis de los demás dominios; el informe devuelve `incomplete_analysis: true`. |
| D-08 | La clasificación de severidad se implementa como tabla de datos exportable, no como ramas `if/else`. |
| D-09 | Las recomendaciones son específicas al tipo de recurso y severidad, con `resource_name` interpolado en el texto. |
| D-10 | La auditoría se inserta en PostgreSQL y el evento Kafka se publica en toda invocación del endpoint (incluyendo `needs_confirmation: true`). |
| D-11 | Los dos contratos en `contracts/` pasan sus respectivos contract tests (D-24). |
| D-12 | Los tests E2E de T-25 (12 escenarios) pasan en entorno sin subsistemas reales (todos mockados). |
| D-13 | La ruta YAML de APISIX es válida, no solapa con las existentes y reutiliza el scope de T03 sin crear uno nuevo en Keycloak. |
| D-14 | Ningún secreto, credential o payload completo del artefacto se escribe en logs, DB o eventos Kafka. |
| D-15 | Los módulos de T03 (`diff.mjs`, `identifier-map.mjs`) no han sido modificados. |
| D-16 | Los archivos de stage previos de esta feature (`spec.md`, `plan.md`, `research.md`, `data-model.md`, contratos) no han sido modificados. |
| D-17 | El worktree está limpio al finalizar (solo archivos de este feature, sin archivos temporales). |

---

## Variables de entorno de referencia

| Variable | Descripción | Default |
|---|---|---|
| `CONFIG_PREFLIGHT_SUPPORTED_FORMAT_MAJOR` | Major version del artefacto aceptada por el servidor | `'1'` |
| `CONFIG_PREFLIGHT_ANALYZER_TIMEOUT_MS` | Timeout por analizador en ms | `10000` |
| `CONFIG_PREFLIGHT_OW_ENABLED` | Habilita analizador de funciones OpenWhisk | `'false'` |
| `CONFIG_PREFLIGHT_MONGO_ENABLED` | Habilita analizador de MongoDB | `'false'` |
| `CONFIG_PREFLIGHT_KAFKA_TOPIC` | Topic Kafka para eventos de auditoría de validación previa | `'console.config.reprovision.preflight'` |
| `CONFIG_EXPORT_KEYCLOAK_URL` | URL del servidor Keycloak admin (lectura) | — |
| `CONFIG_EXPORT_KEYCLOAK_ADMIN_CLIENT_ID` | Client ID de servicio para lectura en Keycloak | — |
| `CONFIG_EXPORT_KEYCLOAK_ADMIN_SECRET` | Secret del client de lectura en Keycloak | — |
| `CONFIG_EXPORT_PG_CONNECTION_STRING` | Connection string PostgreSQL de solo lectura | — |
| `CONFIG_EXPORT_MONGO_URI` | URI MongoDB de solo lectura | — |
| `CONFIG_EXPORT_KAFKA_BROKERS` | Lista de brokers Kafka (comma-separated) | — |
| `CONFIG_EXPORT_KAFKA_SASL_USERNAME` | SASL username para Kafka (lectura) | — |
| `CONFIG_EXPORT_KAFKA_SASL_PASSWORD` | SASL password para Kafka (lectura) | — |
| `CONFIG_EXPORT_OW_API_HOST` | API host de OpenWhisk (lectura) | — |
| `CONFIG_EXPORT_OW_API_KEY` | API key de OpenWhisk (lectura) | — |
| `CONFIG_EXPORT_S3_ENDPOINT` | Endpoint S3-compatible (lectura) | — |
| `CONFIG_EXPORT_S3_ACCESS_KEY` | Access key S3 (lectura) | — |
| `CONFIG_EXPORT_S3_SECRET_KEY` | Secret key S3 (lectura) | — |

---

*Documento generado para el stage `speckit.tasks` — US-BKP-02-T04 | Rama: `118-export-conflict-prechecks`*
