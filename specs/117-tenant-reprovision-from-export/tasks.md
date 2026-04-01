# Tasks — US-BKP-02-T03: Reaprovisionamiento de tenant a partir de export

**Branch**: `117-tenant-reprovision-from-export` | **Date**: 2026-04-01
**Task ID**: US-BKP-02-T03 | **Stage**: `speckit.tasks`
**Spec**: [`spec.md`](./spec.md) | **Plan**: [`plan.md`](./plan.md)
**Dependencias**: US-TEN-04, US-BKP-01, US-BKP-02-T01, US-BKP-02-T02

---

## Mapa de archivos (file-path map)

Todo el trabajo se circunscribe a los siguientes paths. El paso `speckit.implement` **no debe tocar ningún otro archivo** salvo los aquí listados.

### Archivos nuevos a crear

```
services/provisioning-orchestrator/src/
  reprovision/
    types.mjs
    identifier-map.mjs
    diff.mjs
    registry.mjs
  appliers/
    iam-applier.mjs
    postgres-applier.mjs
    mongo-applier.mjs
    kafka-applier.mjs
    functions-applier.mjs
    storage-applier.mjs
  actions/
    tenant-config-reprovision.mjs
    tenant-config-identifier-map.mjs
  repositories/
    config-reprovision-audit-repository.mjs
    config-reprovision-lock-repository.mjs
  events/
    config-reprovision-events.mjs
  migrations/
    117-tenant-config-reprovision.sql

services/gateway-config/routes/
  backup-admin-routes.yaml          ← MODIFICAR (añadir rutas de reprovision)

services/keycloak-config/scopes/
  backup-scopes.yaml                ← MODIFICAR (añadir scope platform:admin:config:reprovision)

apps/web-console/src/
  api/
    configReprovisionApi.ts
  components/
    ConfigIdentifierMapEditor.tsx
    ConfigReprovisionResultPanel.tsx
  pages/
    ConsoleTenantConfigReprovisionPage.tsx

tests/contracts/
  tenant-config-reprovision.contract.test.mjs
  tenant-config-identifier-map.contract.test.mjs
  config-reprovision-audit-event.contract.test.mjs

tests/e2e/workflows/
  tenant-config-reprovision.test.mjs

services/provisioning-orchestrator/tests/reprovision/
  identifier-map.test.mjs
  diff.test.mjs
  lock-repository.test.mjs
  iam-applier.test.mjs
  postgres-applier.test.mjs
  mongo-applier.test.mjs
  kafka-applier.test.mjs
  functions-applier.test.mjs
  storage-applier.test.mjs

services/provisioning-orchestrator/src/tests/actions/
  tenant-config-reprovision.test.mjs
  tenant-config-identifier-map.test.mjs
```

### Artifacts de stage a preservar (no tocar)

```
specs/117-tenant-reprovision-from-export/
  spec.md
  plan.md
  research.md
  data-model.md
  contracts/
    tenant-config-reprovision.json
    tenant-config-identifier-map.json
    config-reprovision-audit-event.json
```

---

## Secuencia de implementación

Las tareas están ordenadas de forma que cada bloque puede empezar una vez que el bloque anterior está completo. Los bloques marcados con `[PARALELO]` pueden ejecutarse simultáneamente.

---

## Bloque 1 — Persistencia: migración SQL y repositorios

### T-01 · Migración SQL `117-tenant-config-reprovision.sql`

**Archivo**: `services/provisioning-orchestrator/src/migrations/117-tenant-config-reprovision.sql`

Crear las dos tablas PostgreSQL necesarias para el lock de concurrencia y el log de auditoría. La migración debe ser idempotente (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).

**Tabla `tenant_config_reprovision_locks`**:

```sql
CREATE TABLE IF NOT EXISTS tenant_config_reprovision_locks (
  tenant_id          TEXT        PRIMARY KEY,
  lock_token         UUID        NOT NULL DEFAULT gen_random_uuid(),
  actor_id           TEXT        NOT NULL,
  actor_type         TEXT        NOT NULL CHECK (actor_type IN ('superadmin', 'sre', 'service_account')),
  source_tenant_id   TEXT        NOT NULL,
  dry_run            BOOLEAN     NOT NULL DEFAULT FALSE,
  correlation_id     TEXT        NOT NULL,
  status             TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released', 'expired', 'failed')),
  acquired_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at         TIMESTAMPTZ NOT NULL,
  released_at        TIMESTAMPTZ,
  last_heartbeat_at  TIMESTAMPTZ,
  error_detail       TEXT
);

CREATE INDEX IF NOT EXISTS idx_reprovision_lock_status_expires
  ON tenant_config_reprovision_locks(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_reprovision_lock_correlation
  ON tenant_config_reprovision_locks(correlation_id);
```

**Tabla `config_reprovision_audit_log`**:

```sql
CREATE TABLE IF NOT EXISTS config_reprovision_audit_log (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             TEXT        NOT NULL,
  source_tenant_id      TEXT        NOT NULL,
  actor_id              TEXT        NOT NULL,
  actor_type            TEXT        NOT NULL CHECK (actor_type IN ('superadmin', 'sre', 'service_account')),
  dry_run               BOOLEAN     NOT NULL DEFAULT FALSE,
  requested_domains     TEXT[]      NOT NULL,
  effective_domains     TEXT[]      NOT NULL DEFAULT '{}',
  identifier_map_hash   TEXT,
  artifact_checksum     TEXT,
  format_version        TEXT        NOT NULL,
  result_status         TEXT        NOT NULL CHECK (result_status IN ('success', 'partial', 'failed', 'blocked', 'dry_run')),
  domain_summary        JSONB,
  resource_summary      JSONB,
  correlation_id        TEXT        NOT NULL,
  started_at            TIMESTAMPTZ NOT NULL,
  ended_at              TIMESTAMPTZ NOT NULL,
  error_detail          TEXT
);

CREATE INDEX IF NOT EXISTS idx_reprovision_audit_tenant
  ON config_reprovision_audit_log(tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_reprovision_audit_source_tenant
  ON config_reprovision_audit_log(source_tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_reprovision_audit_correlation
  ON config_reprovision_audit_log(correlation_id);
CREATE INDEX IF NOT EXISTS idx_reprovision_audit_actor
  ON config_reprovision_audit_log(actor_id, started_at DESC);
```

**Criterio de aceptación**: La migración corre sin errores en una base de datos limpia y es idempotente (puede ejecutarse dos veces consecutivas).

---

### T-02 · Repositorio de lock `config-reprovision-lock-repository.mjs`

**Archivo**: `services/provisioning-orchestrator/src/repositories/config-reprovision-lock-repository.mjs`

Módulo ESM que expone cuatro funciones:

```js
/**
 * Intenta adquirir el lock para tenant_id.
 * Si ya existe una fila activa con expires_at en el futuro → lanza error con código 'LOCK_HELD'.
 * Si existe una fila expirada (expires_at < NOW()) → la sobrescribe (reclamación de lock expirado).
 * Inserta/actualiza con status='active', lock_token nuevo, y expires_at = NOW() + ttlMs.
 *
 * @returns {{ lock_token: string, expires_at: string }}
 */
export async function acquireLock(pgClient, { tenant_id, actor_id, actor_type, source_tenant_id, dry_run, correlation_id, ttlMs });

/**
 * Libera el lock si lock_token coincide con el almacenado.
 * Actualiza status='released' y released_at=NOW().
 * Si el lock_token no coincide, no hace nada (operación silenciosa).
 */
export async function releaseLock(pgClient, { tenant_id, lock_token });

/**
 * Marca el lock como fallido con error_detail.
 * Actualiza status='failed' y released_at=NOW().
 */
export async function failLock(pgClient, { tenant_id, lock_token, error_detail });

/**
 * Devuelve la fila del lock activo para tenant_id, o null si no hay ninguno.
 */
export async function getActiveLock(pgClient, tenant_id);
```

**Semántica**: La adquisición usa una transacción con `SELECT ... FOR UPDATE SKIP LOCKED` o `INSERT ... ON CONFLICT` con condición de expiración. El código de error `'LOCK_HELD'` es distinguible del código genérico `'LOCK_EXPIRED_RECLAIMED'` para logging.

**Criterio de aceptación**: Las cuatro funciones tienen firmas correctas y las pruebas unitarias (T-24) cubren acquire/release/fail con lock activo, lock expirado y ausencia de lock.

---

### T-03 · Repositorio de auditoría `config-reprovision-audit-repository.mjs`

**Archivo**: `services/provisioning-orchestrator/src/repositories/config-reprovision-audit-repository.mjs`

Módulo ESM que expone:

```js
/**
 * Inserta un registro en config_reprovision_audit_log.
 * @returns {{ id: string }}
 */
export async function insertReprovisionAuditLog(pgClient, record);

/**
 * Busca un registro por correlation_id. Útil para debugging/replay.
 * @returns {Object | null}
 */
export async function getReprovisionAuditByCorrelationId(pgClient, correlationId);
```

`record` debe incluir todos los campos no nulos de la tabla. Validar al menos `tenant_id`, `actor_id`, `actor_type`, `correlation_id`, `started_at`, `ended_at`. Lanzar errores descriptivos si faltan.

**Criterio de aceptación**: La función `insertReprovisionAuditLog` mapea correctamente todos los campos del modelo; `getReprovisionAuditByCorrelationId` devuelve null si no existe.

---

## Bloque 2 — Runtime compartido de reaprovisionamiento [PARALELO con Bloque 1]

### T-04 · Tipos compartidos `reprovision/types.mjs`

**Archivo**: `services/provisioning-orchestrator/src/reprovision/types.mjs`

Definir las constantes y JSDoc typedefs de todo el módulo de reprovision:

```js
/** @type {readonly string[]} */
export const KNOWN_DOMAINS = ['iam', 'postgres_metadata', 'mongo_metadata', 'kafka', 'functions', 'storage'];

/** @type {readonly string[]} */
export const SKIPPABLE_STATUSES = ['error', 'not_available', 'not_requested'];

export const REDACTED_MARKER = '***REDACTED***';

/**
 * @typedef {'applied'|'applied_with_warnings'|'skipped'|'skipped_not_exportable'|'skipped_no_applier'|'conflict'|'error'|'would_apply'|'would_conflict'|'would_skip'} DomainStatus
 * @typedef {'created'|'skipped'|'conflict'|'error'|'applied_with_warnings'|'would_create'|'would_skip'|'would_conflict'} ResourceAction
 */

/**
 * @typedef {Object} ResourceResult
 * @property {string} resource_type
 * @property {string} resource_name
 * @property {string|null} resource_id
 * @property {ResourceAction} action
 * @property {string|null} message
 * @property {string[]} warnings
 * @property {Object|null} diff
 */

/**
 * @typedef {Object} DomainResult
 * @property {string} domain_key
 * @property {DomainStatus} status
 * @property {ResourceResult[]} resource_results
 * @property {{ created: number, skipped: number, conflicts: number, errors: number, warnings: number }} counts
 * @property {string|null} message
 */

/**
 * @typedef {Object} ReprovisionSummary
 * @property {number} domains_requested
 * @property {number} domains_processed
 * @property {number} domains_skipped
 * @property {number} resources_created
 * @property {number} resources_skipped
 * @property {number} resources_conflicted
 * @property {number} resources_failed
 */
```

**Criterio de aceptación**: Importable sin errores. Todas las constantes y typedefs son consistentes con `data-model.md` y el contrato OpenAPI.

---

### T-05 · Generador y aplicador de mapa de identificadores `reprovision/identifier-map.mjs`

**Archivo**: `services/provisioning-orchestrator/src/reprovision/identifier-map.mjs`

Implementar tres funciones exportadas:

#### `buildProposedIdentifierMap(artifact, targetTenantId)`

Inspecciona el artefacto e infiere un mapa de reemplazos propuesto. Para cada dominio disponible del artefacto, extrae los identificadores conocidos:

| Scope | Fuente en el artefacto | Destino propuesto |
|---|---|---|
| `iam.realm` | `artifact.domains[iam].data.realm` o `artifact.tenant_id` como fallback | Derivado de `targetTenantId` según convención de la plataforma |
| `postgres.schema` | `artifact.domains[postgres_metadata].data.schema` | Derivado de `targetTenantId` |
| `mongo.database` | `artifact.domains[mongo_metadata].data.database` | Derivado de `targetTenantId` |
| `kafka.topic_prefix` | Prefijo común de los topics en `artifact.domains[kafka].data.topics[*].name` | Derivado de `targetTenantId` |
| `functions.namespace` | `artifact.domains[functions].data.namespace` | Derivado de `targetTenantId` |
| `storage.bucket_prefix` | Prefijo común de los buckets en `artifact.domains[storage].data.buckets[*].name` | Derivado de `targetTenantId` |

La derivación del valor destino sigue la convención: `<targetTenantId>` con separadores ajustados al dominio (guion para IAM/Kafka, subrayado para PostgreSQL, punto para prefijos de topics/buckets). Si no se puede inferir un valor destino, se devuelve `""` y se emite una advertencia.

Devuelve: `{ source_tenant_id, target_tenant_id, entries: IdentifierMapEntry[], warnings: string[] }`.

#### `validateIdentifierMap(map)`

Valida que:
- Ningún `from` sea vacío.
- Ningún `to` sea vacío ni tenga solo espacios.
- No haya claves `from` duplicadas.

Si hay errores, lanza un error con detalle de las entradas inválidas (para que el action devuelva `HTTP 400`).

#### `applyIdentifierMap(artifact, map)`

Aplica el mapa de reemplazos al artefacto de forma recursiva, clonando en profundidad. Reglas:

1. Ordenar las entradas del mapa por longitud de `from` descendente (más largo primero) para evitar reemplazos parciales de subcadenas.
2. Recorrer recursivamente todos los nodos string del artefacto.
3. Para cada string, reemplazar **todas** las ocurrencias exactas de cada `from` por su `to` (no regex, reemplazo literal con `split/join` para evitar interpretación de caracteres especiales).
4. No modificar campos con el marcador `***REDACTED***`.
5. Devolver el artefacto transformado (profundamente clonado, sin mutar el original).

**Criterio de aceptación**: Las pruebas unitarias (T-23) cubren:
- Generación de mapa con artefacto completo.
- Generación de mapa con dominios no disponibles (se omiten esos scopes).
- Validación rechaza `from` duplicado o `to` vacío.
- La aplicación del mapa reemplaza correctamente todas las ocurrencias en cadenas anidadas.
- El orden por longitud evita colisión cuando un `from` es subcadena de otro.
- Los valores `***REDACTED***` no se alteran.
- El artefacto original no muta.

---

### T-06 · Comparador conservador `reprovision/diff.mjs`

**Archivo**: `services/provisioning-orchestrator/src/reprovision/diff.mjs`

Implementar helpers de comparación usados por todos los aplicadores:

```js
/**
 * Compara dos objetos JSON de forma profunda e ignora campos excluidos.
 * @param {unknown} existing - estado actual en el subsistema
 * @param {unknown} desired  - estado deseado del artefacto
 * @param {string[]} [ignoreKeys] - claves a excluir de la comparación (ej: timestamps)
 * @returns {'equal' | 'different'}
 */
export function compareResources(existing, desired, ignoreKeys = []);

/**
 * Dado el resultado de compareResources, calcula la acción del recurso.
 * existsInTarget=true + 'equal' → 'skipped' (o 'would_skip' si dry_run)
 * existsInTarget=true + 'different' → 'conflict' (o 'would_conflict' si dry_run)
 * existsInTarget=false → 'created' (o 'would_create' si dry_run)
 * @param {boolean} existsInTarget
 * @param {'equal'|'different'} comparison
 * @param {boolean} [dryRun]
 * @returns {import('./types.mjs').ResourceAction}
 */
export function resolveAction(existsInTarget, comparison, dryRun = false);

/**
 * Genera un diff legible entre dos objetos para el campo `diff` en ResourceResult.
 * Solo incluye las claves que difieren; no incluye valores de secretos.
 * @param {Object} existing
 * @param {Object} desired
 * @returns {Object | null}
 */
export function buildDiff(existing, desired);
```

**Criterio de aceptación**: Las pruebas unitarias (T-23) verifican todos los paths de `resolveAction` y que `buildDiff` no filtra valores redactados hacia el diff.

---

### T-07 · Registro de aplicadores `reprovision/registry.mjs`

**Archivo**: `services/provisioning-orchestrator/src/reprovision/registry.mjs`

```js
import { apply as applyIam } from '../appliers/iam-applier.mjs';
import { apply as applyPostgres } from '../appliers/postgres-applier.mjs';
import { apply as applyMongo } from '../appliers/mongo-applier.mjs';
import { apply as applyKafka } from '../appliers/kafka-applier.mjs';
import { apply as applyFunctions } from '../appliers/functions-applier.mjs';
import { apply as applyStorage } from '../appliers/storage-applier.mjs';

/** Orden canónico de ejecución de aplicadores. */
export const APPLIER_ORDER = ['iam', 'postgres_metadata', 'mongo_metadata', 'kafka', 'functions', 'storage'];

/**
 * Construye el registro de aplicadores según feature flags.
 * @param {string} deploymentProfile
 * @returns {Map<string, (tenantId: string, domainData: Object, options: Object) => Promise<import('./types.mjs').DomainResult>>}
 */
export function getApplierRegistry(deploymentProfile = 'standard');
```

Feature flags que rigen el registro:
- `CONFIG_IMPORT_OW_ENABLED` — habilita aplicador de funciones.
- `CONFIG_IMPORT_MONGO_ENABLED` — habilita aplicador de MongoDB.
- Sin flag equivalente para IAM, PostgreSQL, Kafka y Storage (siempre registrados).
- Si un aplicador no está registrado, el dominio se devuelve con `status: 'skipped_no_applier'`.

**Criterio de aceptación**: El registro con todos los flags activos contiene los seis aplicadores en orden canónico. Con flags desactivados, los dominios respectivos retornan `skipped_no_applier`.

---

## Bloque 3 — Aplicadores de dominio [PARALELO entre sí, requiere Bloque 2]

Cada aplicador exporta una función:

```js
/**
 * @param {string} tenantId - tenant destino
 * @param {Object} domainData - sección `data` del artefacto (ya con identificadores sustituidos)
 * @param {Object} options
 * @param {boolean} options.dryRun
 * @param {Object} [options.credentials] - credenciales de escritura para el subsistema
 * @param {Console} [options.log]
 * @returns {Promise<import('../reprovision/types.mjs').DomainResult>}
 */
export async function apply(tenantId, domainData, options);
```

Cada aplicador sigue el mismo patrón:
1. Si `domainData` es null o items vacíos → devolver `{ domain_key, status: 'applied', counts: todos 0, resource_results: [], message: 'empty domain' }`.
2. Para cada recurso en el domainData:
   a. Verificar si el recurso existe en el subsistema destino.
   b. Si no existe → crear (o `would_create` si `dryRun`).
   c. Si existe y es equivalente → `skipped` / `would_skip`.
   d. Si existe y difiere → `conflict` / `would_conflict` (no modificar).
   e. Si el recurso contiene valores `***REDACTED***` → crear sin ellos y marcar `applied_with_warnings`.
3. Capturar errores por recurso individual con `try/catch`; un fallo en un recurso no aborta los demás del mismo dominio.
4. Calcular `counts` y `status` del dominio: `applied_with_warnings` si hay warnings, `conflict` si todo son conflictos, `applied` si hay creaciones, `skipped` si todos son skipped, `error` si fallo general del aplicador.

### T-08 · Aplicador IAM `appliers/iam-applier.mjs`

**Archivo**: `services/provisioning-orchestrator/src/appliers/iam-applier.mjs`

Recursos gestionados: roles, grupos, client scopes, identity providers, mappers.

Credencial de acceso: `process.env.CONFIG_IMPORT_KEYCLOAK_URL`, `CONFIG_IMPORT_KEYCLOAK_ADMIN_CLIENT_ID`, `CONFIG_IMPORT_KEYCLOAK_ADMIN_SECRET`.

Criterio de equivalencia IAM:
- **Roles**: mismo `name` + mismo conjunto de `composites` + mismos `attributes`.
- **Grupos**: mismo `name` + mismo `path` + mismos `attributes`.
- **Client scopes**: mismo `name` + mismo `protocol` + mismas `protocolMappers`.
- **Identity providers**: mismo `alias` + mismo `providerId` + misma `config` (excluyendo campos de timestamp).
- Si un campo es `***REDACTED***` → omitir ese campo del objeto a crear; incluir warning.

---

### T-09 · Aplicador PostgreSQL `appliers/postgres-applier.mjs`

**Archivo**: `services/provisioning-orchestrator/src/appliers/postgres-applier.mjs`

Recursos gestionados: esquemas, tablas (estructura, columnas, tipos, constraints, índices), vistas, extensiones, grants.

Credencial de acceso: `process.env.CONFIG_IMPORT_PG_CONNECTION_STRING` o `CONFIG_IMPORT_PG_*` individuales.

Criterio de equivalencia:
- **Esquema**: mismo nombre en `information_schema.schemata`.
- **Tabla**: misma estructura de columnas (nombre, tipo, nullable, default) + mismos constraints. Comparar con `information_schema.columns` y `pg_constraint`.
- **Vista**: misma definición (`pg_views.definition`).
- **Extensión**: misma versión en `pg_extension`.
- **Grant**: misma combinación grantee/privilege/objeto.
- Si una tabla ya existe con columnas diferentes → `conflict`.
- No ejecutar DDL en `dry_run`.

---

### T-10 · Aplicador MongoDB `appliers/mongo-applier.mjs`

**Archivo**: `services/provisioning-orchestrator/src/appliers/mongo-applier.mjs`

Recursos gestionados: bases de datos, colecciones (con validadores/schema), índices.

Credencial de acceso: `process.env.CONFIG_IMPORT_MONGO_URI`.

Criterio de equivalencia:
- **Colección**: misma existencia + mismo validador (comparar con `listCollections` + `options.validator`).
- **Índice**: mismo `key` + mismas `options` (unique, sparse, etc.).
- Sharding metadata: si el artefacto contiene configuración de sharding y el destino no está sharded, reportar como `conflict` con mensaje descriptivo.

---

### T-11 · Aplicador Kafka `appliers/kafka-applier.mjs`

**Archivo**: `services/provisioning-orchestrator/src/appliers/kafka-applier.mjs`

Recursos gestionados: topics (particiones, replicación, retention), ACLs, consumer groups metadata.

Credencial de acceso: `process.env.CONFIG_IMPORT_KAFKA_BROKERS`, `CONFIG_IMPORT_KAFKA_SASL_*`.

Criterio de equivalencia:
- **Topic**: mismo nombre + misma `numPartitions` + mismos `configEntries` relevantes (retention.ms, cleanup.policy, min.insync.replicas).
- **ACL**: mismo principal + operation + resourceType + patternType + permissionType.
- Consumer groups: solo metadata (no offsets). Si el grupo existe, `skipped`.
- Si un topic existe con diferente número de particiones → `conflict` (no se reduce particiones en Kafka).

---

### T-12 · Aplicador OpenWhisk `appliers/functions-applier.mjs`

**Archivo**: `services/provisioning-orchestrator/src/appliers/functions-applier.mjs`

Recursos gestionados: paquetes, acciones (runtime, código fuente, límites, parámetros), triggers, rules.

Credencial de acceso: `process.env.CONFIG_IMPORT_OW_API_HOST`, `CONFIG_IMPORT_OW_API_KEY`.

Criterio de equivalencia:
- **Acción**: mismo nombre + mismo runtime + mismo código (hash del source o del exec.code) + mismos límites.
- **Parámetros con `***REDACTED***`**: crear la acción/paquete sin esos parámetros; incluir warning por cada uno. El recurso se reporta como `applied_with_warnings`.
- **Trigger/Rule**: mismo nombre + misma configuración de feed/action.

---

### T-13 · Aplicador Storage S3 `appliers/storage-applier.mjs`

**Archivo**: `services/provisioning-orchestrator/src/appliers/storage-applier.mjs`

Recursos gestionados: buckets (versionado, lifecycle rules), políticas de acceso, CORS.

Credencial de acceso: `process.env.CONFIG_IMPORT_S3_ENDPOINT`, `CONFIG_IMPORT_S3_ACCESS_KEY`, `CONFIG_IMPORT_S3_SECRET_KEY`.

Criterio de equivalencia:
- **Bucket**: mismo nombre. Si existe → comparar versioning + lifecycle + política + CORS. Si alguna difiere → `conflict`.
- **Política**: comparación JSON normalizada (sin whitespace, sin orden de claves).
- **CORS**: comparación de reglas como conjuntos (no orden).
- No copiar objetos almacenados.

---

## Bloque 4 — Eventos Kafka [PARALELO con Bloque 3]

### T-14 · Publisher de eventos de reprovisionamiento `events/config-reprovision-events.mjs`

**Archivo**: `services/provisioning-orchestrator/src/events/config-reprovision-events.mjs`

Siguiendo el patrón de `config-export-events.mjs`:

```js
export const CONFIG_REPROVISION_COMPLETED_TOPIC =
  process.env.CONFIG_REPROVISION_KAFKA_TOPIC_COMPLETED ?? 'console.config.reprovision.completed';

export const CONFIG_REPROVISION_IDENTIFIER_MAP_TOPIC =
  process.env.CONFIG_REPROVISION_KAFKA_TOPIC_MAP ?? 'console.config.reprovision.identifier-map';

/** Construye el payload del evento de reprovision completado. */
export function buildReprovisionCompletedEvent(p);

/** Construye el payload del evento de mapa de identificadores generado. */
export function buildIdentifierMapGeneratedEvent(p);

/** Fire-and-forget: publica el evento; captura errores de Kafka sin abortar. */
export async function publishReprovisionCompleted(kafkaProducer, eventPayload, log);

/** Fire-and-forget: publica el evento de mapa de identificadores. */
export async function publishIdentifierMapGenerated(kafkaProducer, eventPayload, log);
```

El shape de cada evento debe ser compatible con el schema de `contracts/config-reprovision-audit-event.json`. Los campos `event_id` y `emitted_at` se generan internamente.

**Criterio de aceptación**: `publishReprovisionCompleted` retorna `{ published: false }` cuando no hay producer (no lanza). El event shape pasa la validación del JSON schema del contrato.

---

## Bloque 5 — Actions OpenWhisk [requiere Bloques 1, 2, 3 y 4]

### T-15 · Action principal `actions/tenant-config-reprovision.mjs`

**Archivo**: `services/provisioning-orchestrator/src/actions/tenant-config-reprovision.mjs`

Implementar la función `main(params, overrides)` siguiendo el patrón de `tenant-config-export.mjs`. Flujo completo:

```
1. Extraer claims JWT (reusar lógica de extractAuth de export; scope: platform:admin:config:reprovision)
2. Extraer tenant_id del path o params
3. Verificar que el tenant destino existe (tenantExistsFn)
4. Parsear body: { artifact, identifier_map?, domains?, dry_run? }
5. Validar formato del artefacto:
   a. Verificar format_version: mismo major que la versión actual del servidor (SUPPORTED_FORMAT_MAJOR='1')
   b. Si major incompatible → return { statusCode: 422, body: { error: '...' } }
6. Validar y normalizar identifier_map:
   a. Si artifact.tenant_id !== tenant_id (destino):
      - Si no se proporciona identifier_map → generar propuesta y retornar { statusCode: 200, body: { proposal: map, needs_confirmation: true } }
      - Si se proporciona → validar con validateIdentifierMap; si inválido → return { statusCode: 400 }
   b. Si artifact.tenant_id === tenant_id → identifier_map puede ser null (no se aplica)
7. Aplicar identifier map al artefacto (applyIdentifierMap)
8. Filtrar dominios a procesar:
   - Si params.domains → verificar que sean conocidos; si desconocidos → return { statusCode: 400 }
   - Solo procesar dominios con status 'ok' o 'empty' (intersection con params.domains si se especifica)
   - Dominios con status 'error'/'not_available'/'not_requested' → skipped_not_exportable automáticamente
9. Adquirir lock (acquireLock); si LOCK_HELD → return { statusCode: 409 }
10. Ejecutar aplicadores:
    - Para cada dominio en orden canónico (APPLIER_ORDER):
      - Si no en dominios a procesar → incluir con skipped_not_exportable o saltar del resultado
      - Si no hay aplicador → DomainResult con skipped_no_applier
      - Else → withTimeout(applier(tenantId, domainData, { dryRun, credentials, log }), timeoutMs, domainKey)
      - Capturar errores de aplicador: resultado con status='error' y mensaje; NO abortar
    - Recoger todos los DomainResults
11. Calcular ReprovisionSummary
12. Determinar status global: 'success'/'partial'/'failed'/'dry_run'
13. Insertar auditoría PostgreSQL (insertReprovisionAuditLog)
14. Publicar evento Kafka (fire-and-forget)
15. Liberar lock (releaseLock); si fallo antes de 13/14 → failLock
16. Retornar { statusCode: 200 | 207, body: ReprovisionResult }
```

Variables de entorno usadas:
- `CONFIG_IMPORT_SUPPORTED_FORMAT_MAJOR` (default `'1'`)
- `CONFIG_IMPORT_APPLIER_TIMEOUT_MS` (default `10000`)
- `CONFIG_IMPORT_LOCK_TTL_MS` (default `120000`)
- Credenciales por subsistema: `CONFIG_IMPORT_KEYCLOAK_*`, `CONFIG_IMPORT_PG_*`, `CONFIG_IMPORT_MONGO_*`, `CONFIG_IMPORT_KAFKA_*`, `CONFIG_IMPORT_OW_*`, `CONFIG_IMPORT_S3_*`

**Manejo de errores HTTP**:
| Condición | HTTP |
|---|---|
| Sin autenticación o scope incorrecto | 403 |
| tenant_id no encontrado | 404 |
| format_version incompatible | 422 |
| identifier_map inválido | 400 |
| dominio desconocido en filtro | 400 |
| lock activo | 409 |
| Aplicador fallado (parcial) | 207 |
| Todo OK (incluyendo dry_run) | 200 |
| Todos los aplicadores fallaron | 207 (no 500) |

**Criterio de aceptación**: Las pruebas unitarias (T-26) cubren todos los paths de retorno.

---

### T-16 · Action auxiliar `actions/tenant-config-identifier-map.mjs`

**Archivo**: `services/provisioning-orchestrator/src/actions/tenant-config-identifier-map.mjs`

Flujo:

```
1. Extraer JWT (mismo scope: platform:admin:config:reprovision)
2. Extraer tenant_id del path
3. Verificar tenant destino
4. Parsear body: { artifact }
5. Validar formato del artefacto (solo estructura, no major version)
6. buildProposedIdentifierMap(artifact, tenant_id)
7. Insertar auditoría (operation_type: 'identifier_map')
8. Publicar evento Kafka buildIdentifierMapGeneratedEvent
9. Retornar { statusCode: 200, body: IdentifierMapResponse }
```

`IdentifierMapResponse`:
```json
{
  "source_tenant_id": "...",
  "target_tenant_id": "...",
  "proposal": { "entries": [...], "source_tenant_id": "...", "target_tenant_id": "..." },
  "warnings": [],
  "correlation_id": "..."
}
```

**Criterio de aceptación**: Devuelve `200` con propuesta aunque el artefacto tenga dominios `not_available` (los ignora con warning). Pruebas unitarias en T-27.

---

## Bloque 6 — Gateway y Keycloak [PARALELO con Bloque 5]

### T-17 · Rutas APISIX `backup-admin-routes.yaml`

**Archivo**: `services/gateway-config/routes/backup-admin-routes.yaml`

Añadir al YAML existente (sin modificar las rutas ya presentes):

```yaml
  - name: config-reprovision-post
    uri: /v1/admin/tenants/*/config/reprovision
    methods:
      - POST
    plugins:
      keycloak-openid-connect:
        enabled: true
        required_scopes:
          - platform:admin:config:reprovision
      limit-req:
        rate: 3
        burst: 6
        key: consumer_name
      response-rewrite:
        headers:
          set:
            Cache-Control: "no-store"
    upstream:
      type: roundrobin
      timeout:
        connect: 5
        send: 90
        read: 90
      nodes:
        openwhisk-tenant-config-reprovision: 1

  - name: config-reprovision-identifier-map-post
    uri: /v1/admin/tenants/*/config/reprovision/identifier-map
    methods:
      - POST
    plugins:
      keycloak-openid-connect:
        enabled: true
        required_scopes:
          - platform:admin:config:reprovision
      limit-req:
        rate: 10
        burst: 20
        key: consumer_name
      response-rewrite:
        headers:
          set:
            Cache-Control: "no-store"
    upstream:
      type: roundrobin
      timeout:
        connect: 5
        send: 15
        read: 15
      nodes:
        openwhisk-tenant-config-identifier-map: 1
```

**Criterio de aceptación**: El YAML es válido, las rutas nuevas no solapan con las existentes.

---

### T-18 · Scope Keycloak `backup-scopes.yaml`

**Archivo**: `services/keycloak-config/scopes/backup-scopes.yaml`

Añadir al YAML existente:

```yaml
  - name: platform:admin:config:reprovision
    description: >
      Reprovision the functional configuration of any tenant from an export artifact
      (superadmin/sre/service_account only)
```

Y en `role_mappings`:

```yaml
  superadmin:
    - platform:admin:config:reprovision
  sre:
    - platform:admin:config:reprovision
  service_account:
    - platform:admin:config:reprovision
```

**Criterio de aceptación**: El YAML es válido y el scope nuevo no duplica ninguno existente.

---

## Bloque 7 — Consola web [PARALELO con Bloque 5, requiere contratos estables]

### T-19 · API client `configReprovisionApi.ts`

**Archivo**: `apps/web-console/src/api/configReprovisionApi.ts`

Siguiendo el patrón de `configExportApi.ts`, implementar:

```ts
export class ConfigReprovisionApiError extends Error { ... }

export interface ReprovisionRequest { ... }
export interface IdentifierMapEntry { from: string; to: string; scope?: string | null }
export interface IdentifierMap { source_tenant_id?: string | null; target_tenant_id?: string | null; entries: IdentifierMapEntry[] }
export interface ReprovisionResult { ... }    // alineado al contrato OpenAPI
export interface IdentifierMapResponse { ... } // alineado al contrato OpenAPI

/** POST /v1/admin/tenants/{tenantId}/config/reprovision */
export async function reprovisionTenantConfig(tenantId: string, request: ReprovisionRequest): Promise<ReprovisionResult>

/** POST /v1/admin/tenants/{tenantId}/config/reprovision/identifier-map */
export async function generateIdentifierMap(tenantId: string, artifact: object): Promise<IdentifierMapResponse>
```

**Criterio de aceptación**: Tipos alineados con los schemas OpenAPI de `contracts/`. Manejo de errores HTTP 400, 403, 404, 409, 422, 207.

---

### T-20 · Editor de mapa de identificadores `ConfigIdentifierMapEditor.tsx`

**Archivo**: `apps/web-console/src/components/ConfigIdentifierMapEditor.tsx`

Componente React que:
- Recibe `entries: IdentifierMapEntry[]` y `onChange: (entries: IdentifierMapEntry[]) => void`.
- Muestra una tabla editable con columnas `Scope`, `Desde (origen)`, `Hacia (destino)`.
- La columna `Desde` es solo lectura (no editable; muestra el valor del artefacto).
- La columna `Hacia` es un input de texto editable.
- Resalta en rojo las filas donde `to` está vacío (validación visual antes de submit).
- Muestra badge con el scope si está disponible.
- Accesible: labels correctos, navegable por teclado.

**Criterio de aceptación**: El componente renderiza y permite editar los valores `to`. Las filas inválidas se destacan visualmente. Prop `onChange` se llama con las entries actualizadas.

---

### T-21 · Panel de resultado `ConfigReprovisionResultPanel.tsx`

**Archivo**: `apps/web-console/src/components/ConfigReprovisionResultPanel.tsx`

Componente React que:
- Recibe `result: ReprovisionResult | null` y `loading: boolean`.
- Muestra: status global con badge de color, summary (dominios/recursos creados/omitidos/conflictos/errores).
- Para cada `DomainResult`: sección expandible con status, counts, lista de recursos.
- Para cada `ResourceResult`: nombre, tipo, acción (badge), mensaje, warnings.
- Badge de colores: `applied`→verde, `skipped`→gris, `conflict`→naranja, `error`→rojo, `applied_with_warnings`→amarillo.
- Si `dry_run=true` → banner prominente "SIMULACIÓN — Ningún cambio ha sido aplicado".

**Criterio de aceptación**: Panel renderiza todos los estados de dominio y recurso. Banner dry_run visible.

---

### T-22 · Página de consola `ConsoleTenantConfigReprovisionPage.tsx`

**Archivo**: `apps/web-console/src/pages/ConsoleTenantConfigReprovisionPage.tsx`

Página de admin que integra los componentes en el flujo completo:

**Paso 1 — Cargar artefacto**
- Área de texto o file upload para pegar/subir el JSON del artefacto exportado.
- Botón "Analizar artefacto" → llama `generateIdentifierMap`, muestra el mapa propuesto.

**Paso 2 — Revisar mapa de identificadores**
- Muestra `ConfigIdentifierMapEditor` con el mapa propuesto.
- El operador puede editar los valores `to`.
- Botón "Confirmar mapa".

**Paso 3 — Configurar y ejecutar**
- Toggle "Modo simulación (dry run)" — activo por defecto.
- Multi-select opcional de dominios a aplicar.
- Botón "Ejecutar simulación" / "Aplicar configuración" según el toggle.
- Confirmación modal antes de la aplicación efectiva (cuando dry_run=false).

**Paso 4 — Resultado**
- Muestra `ConfigReprovisionResultPanel` con el resultado.
- Botón "Nueva operación" para reiniciar el flujo.

**Visibilidad**: La página solo se muestra a usuarios con rol `superadmin` o `sre`. Para `tenant_owner`, redirigir a `403`.

**Criterio de aceptación**: El flujo completo (cargar → mapa → dry-run → resultado) es navegable. Usuarios no privilegiados no pueden acceder.

---

## Bloque 8 — Tests [requiere Bloques 2, 3, 4, 5]

### T-23 · Tests unitarios del runtime `tests/reprovision/`

**Archivos**:
- `services/provisioning-orchestrator/tests/reprovision/identifier-map.test.mjs`
- `services/provisioning-orchestrator/tests/reprovision/diff.test.mjs`

Framework: `node:test` + `node:assert/strict`.

**`identifier-map.test.mjs`** debe cubrir:
- `buildProposedIdentifierMap` con artefacto completo (6 dominios ok) genera 6 entradas.
- `buildProposedIdentifierMap` con dominio `not_available` omite ese scope y añade warning.
- `validateIdentifierMap` rechaza `from` duplicado.
- `validateIdentifierMap` rechaza `to` vacío.
- `applyIdentifierMap` reemplaza todas las ocurrencias de `from` en strings anidados.
- `applyIdentifierMap` aplica orden por longitud descendente correctamente.
- `applyIdentifierMap` no modifica `***REDACTED***`.
- `applyIdentifierMap` no muta el artefacto original.
- Entrada con `from` como subcadena de otra entrada no produce reemplazos parciales.

**`diff.test.mjs`** debe cubrir:
- `compareResources` devuelve `'equal'` para objetos profundamente iguales.
- `compareResources` devuelve `'different'` para objetos con una clave diferente.
- `compareResources` ignora las claves excluidas.
- `resolveAction` para todos los casos (existsInTarget × comparison × dryRun).
- `buildDiff` solo incluye claves con diferencia.

---

### T-24 · Tests del lock repository `tests/reprovision/lock-repository.test.mjs`

**Archivo**: `services/provisioning-orchestrator/tests/reprovision/lock-repository.test.mjs`

Usando un mock de `pg` (DI injection), cubrir:
- Acquire con tabla vacía → éxito, devuelve lock_token y expires_at.
- Acquire con lock activo no expirado → lanza error con código `LOCK_HELD`.
- Acquire con lock expirado → éxito (reclamación).
- Release con lock_token correcto → actualiza status.
- Release con lock_token incorrecto → no lanza, no modifica.
- Fail → actualiza status a `'failed'`.
- GetActiveLock sin fila → devuelve null.

---

### T-25 · Tests de aplicadores `tests/reprovision/*.test.mjs`

**Archivos** (uno por aplicador):
- `services/provisioning-orchestrator/tests/reprovision/iam-applier.test.mjs`
- `services/provisioning-orchestrator/tests/reprovision/postgres-applier.test.mjs`
- `services/provisioning-orchestrator/tests/reprovision/mongo-applier.test.mjs`
- `services/provisioning-orchestrator/tests/reprovision/kafka-applier.test.mjs`
- `services/provisioning-orchestrator/tests/reprovision/functions-applier.test.mjs`
- `services/provisioning-orchestrator/tests/reprovision/storage-applier.test.mjs`

Para cada aplicador, mockear el cliente del subsistema y cubrir:
- Recurso no existe → action `'created'` / `'would_create'`.
- Recurso existe idéntico → action `'skipped'` / `'would_skip'`.
- Recurso existe diferente → action `'conflict'` / `'would_conflict'`, no se llama a la API de escritura.
- Valor `***REDACTED***` en un campo → recurso creado sin ese campo, action `'applied_with_warnings'`.
- Dominio vacío (items_count=0) → domain status `'applied'`, resource_results vacío.
- Error de API del subsistema en un recurso → ese recurso con action `'error'`, los demás continúan.
- dry_run=true → ninguna llamada de escritura; actions prefijadas con `would_`.

---

### T-26 · Tests de la action principal `src/tests/actions/tenant-config-reprovision.test.mjs`

**Archivo**: `services/provisioning-orchestrator/src/tests/actions/tenant-config-reprovision.test.mjs`

Framework: `node:test` + `node:assert/strict`. DI injection igual que en `tenant-config-export-checksum.test.mjs`.

Casos obligatorios:
1. Sin autenticación → `403`.
2. Scope incorrecto → `403`.
3. Tenant inexistente → `404`.
4. `format_version` con major incompatible → `422`.
5. Artefacto con `tenant_id` diferente y sin `identifier_map` → `200` con `needs_confirmation: true` y propuesta.
6. `identifier_map` con `to` vacío → `400`.
7. Dominio desconocido en filtro → `400`.
8. Lock ya activo → `409`.
9. Happy path (dry_run=false, tenant vacío, 6 dominios ok) → `200`, todos los dominios `applied`.
10. Happy path dry_run=true → `200`, status `'dry_run'`, ningún aplicador ejecuta escrituras.
11. Aplicador IAM falla → `207`, dominio IAM con status `error`, otros dominios ok.
12. Todos los aplicadores fallan → `207`.
13. Auditoría insertada correctamente (spy en insertReprovisionAuditLog).
14. Kafka publishReprovisionCompleted llamado (spy).
15. Lock se libera tras éxito (spy en releaseLock).
16. Lock marcado como failed si un error no controlado ocurre antes de la auditoría.

---

### T-27 · Tests de la action auxiliar `src/tests/actions/tenant-config-identifier-map.test.mjs`

**Archivo**: `services/provisioning-orchestrator/src/tests/actions/tenant-config-identifier-map.test.mjs`

Casos:
1. Sin autenticación → `403`.
2. Tenant inexistente → `404`.
3. Artefacto válido (mismo tenant) → `200` con propuesta de 0 reemplazos o propuesta vacía con warning.
4. Artefacto válido (tenant diferente) → `200` con propuesta completa.
5. Artefacto con dominios `not_available` → `200` con propuesta parcial y warnings.
6. Auditoría insertada.
7. Kafka publishIdentifierMapGenerated llamado.

---

### T-28 · Tests de contratos `tests/contracts/`

**Archivos**:
- `tests/contracts/tenant-config-reprovision.contract.test.mjs`
- `tests/contracts/tenant-config-identifier-map.contract.test.mjs`
- `tests/contracts/config-reprovision-audit-event.contract.test.mjs`

Usando el mismo patrón de `functions-import-export.contract.test.mjs` (SwaggerParser + `control-plane.openapi.test.mjs`):

**`tenant-config-reprovision.contract.test.mjs`**:
- El contrato OpenAPI `contracts/tenant-config-reprovision.json` es válido (SwaggerParser.validate).
- Las rutas `POST /v1/admin/tenants/{tenant_id}/config/reprovision` existen en el documento.
- El scope `platform:admin:config:reprovision` está declarado en el security scheme.
- Los schemas `ReprovisionRequest`, `ReprovisionResult`, `DomainResult`, `ResourceResult`, `ReprovisionSummary` existen en components.
- `ReprovisionResult.required` incluye los campos obligatorios del data-model.

**`tenant-config-identifier-map.contract.test.mjs`**:
- El contrato OpenAPI `contracts/tenant-config-identifier-map.json` es válido.
- Ruta `POST .../config/reprovision/identifier-map` existe.
- `IdentifierMapResponse.required` incluye `source_tenant_id`, `target_tenant_id`, `proposal`, `correlation_id`.

**`config-reprovision-audit-event.contract.test.mjs`**:
- El JSON Schema `contracts/config-reprovision-audit-event.json` es válido (Ajv).
- Un evento con todos los campos required pasa la validación.
- Un evento sin `event_type` falla la validación.
- Un evento sin `actor_type` falla la validación.
- Un evento con `actor_type: 'tenant_owner'` (no permitido) falla la validación.
- Validar que `additionalProperties: false` rechaza campos extra.

---

### T-29 · Tests E2E de flujo `tests/e2e/workflows/tenant-config-reprovision.test.mjs`

**Archivo**: `tests/e2e/workflows/tenant-config-reprovision.test.mjs`

Tests de integración de extremo a extremo usando mocks de subsistemas externos (sin conexiones reales). Cubrir:

1. **Happy path completo**: Artefacto con 6 dominios ok, tenant vacío, mapa de identificadores confirmado → resultado con todos los dominios `applied`, auditoría escrita, evento Kafka publicado.
2. **Dry-run**: Misma fixture, dry_run=true → resultado con `status: 'dry_run'`, ningún aplicador llamó a APIs de escritura.
3. **Filtrado de dominios**: filtro `['iam', 'functions']` → solo esos dos dominios en resultado, otros ausentes o skipped.
4. **Conflicto detectado**: Tenant con recurso existente diferente → ese recurso en `conflict`, no se modifica.
5. **Fallo parcial de aplicador**: Mock de IAM lanza excepción → IAM con status `error`, demás dominios aplicados, HTTP 207.
6. **Lock concurrente**: Dos invocaciones simultáneas sobre mismo tenant → segunda recibe 409.
7. **format_version incompatible**: Artefacto con major 2 cuando servidor soporta major 1 → 422.
8. **Secretos redactados**: Función con variable `***REDACTED***` → recurso creado con `applied_with_warnings`, warning en resultado.

---

## Criterios de done (verificables antes del merge)

| # | Criterio |
|---|---|
| D-01 | Todos los archivos listados en el mapa de archivos existen o han sido modificados según lo especificado. |
| D-02 | `117-tenant-config-reprovision.sql` es idempotente y crea las dos tablas correctamente. |
| D-03 | `tenant-config-reprovision.mjs` devuelve los códigos HTTP correctos para los 16 casos de T-26. |
| D-04 | `identifier-map.mjs` aplica orden por longitud descendente y no muta el artefacto original. |
| D-05 | Los seis aplicadores nunca ejecutan operaciones de escritura cuando `dry_run=true`. |
| D-06 | Los seis aplicadores nunca sobrescriben recursos con configuración diferente; los reportan como `conflict`. |
| D-07 | Los valores `***REDACTED***` nunca se aplican a ningún subsistema; los recursos afectados se marcan `applied_with_warnings`. |
| D-08 | El lock de concurrencia impide dos reaprovisionamientos simultáneos sobre el mismo tenant; el segundo recibe 409. |
| D-09 | La auditoría se inserta en PostgreSQL y el evento Kafka se publica en toda invocación exitosa (incluido dry_run). |
| D-10 | Los tres contratos en `contracts/` pasan sus respectivos contract tests. |
| D-11 | Los tests E2E de T-29 pasan en entorno sin subsistemas reales (todos mockados). |
| D-12 | Las rutas YAML de APISIX y el scope de Keycloak son válidos y no solapan ni duplican entradas existentes. |
| D-13 | Ningún secreto, credential o payload completo del artefacto se escribe en logs, DB o eventos Kafka. |
| D-14 | Los archivos de stage previos (`spec.md`, `plan.md`, `research.md`, `data-model.md`, contratos) no han sido modificados. |
| D-15 | El worktree está limpio al finalizar (solo archivos de este feature, sin archivos temporales). |

---

## Variables de entorno de referencia

| Variable | Descripción | Default |
|---|---|---|
| `CONFIG_IMPORT_SUPPORTED_FORMAT_MAJOR` | Major version del artefacto que acepta el servidor | `'1'` |
| `CONFIG_IMPORT_APPLIER_TIMEOUT_MS` | Timeout por aplicador en ms | `10000` |
| `CONFIG_IMPORT_LOCK_TTL_MS` | TTL del lock de concurrencia en ms | `120000` |
| `CONFIG_IMPORT_OW_ENABLED` | Habilita aplicador de funciones OpenWhisk | `'false'` |
| `CONFIG_IMPORT_MONGO_ENABLED` | Habilita aplicador de MongoDB | `'false'` |
| `CONFIG_IMPORT_KEYCLOAK_URL` | URL base del servidor Keycloak admin | — |
| `CONFIG_IMPORT_KEYCLOAK_ADMIN_CLIENT_ID` | Client ID de servicio para escritura en Keycloak | — |
| `CONFIG_IMPORT_KEYCLOAK_ADMIN_SECRET` | Secret del client de servicio | — |
| `CONFIG_IMPORT_PG_CONNECTION_STRING` | Connection string PostgreSQL de escritura | — |
| `CONFIG_IMPORT_MONGO_URI` | URI MongoDB de escritura | — |
| `CONFIG_IMPORT_KAFKA_BROKERS` | Lista de brokers Kafka (comma-separated) | — |
| `CONFIG_IMPORT_KAFKA_SASL_USERNAME` | SASL username para Kafka | — |
| `CONFIG_IMPORT_KAFKA_SASL_PASSWORD` | SASL password para Kafka | — |
| `CONFIG_IMPORT_OW_API_HOST` | API host de OpenWhisk | — |
| `CONFIG_IMPORT_OW_API_KEY` | API key de OpenWhisk | — |
| `CONFIG_IMPORT_S3_ENDPOINT` | Endpoint S3-compatible | — |
| `CONFIG_IMPORT_S3_ACCESS_KEY` | Access key S3 | — |
| `CONFIG_IMPORT_S3_SECRET_KEY` | Secret key S3 | — |
| `CONFIG_REPROVISION_KAFKA_TOPIC_COMPLETED` | Topic Kafka para eventos de reprovision completado | `'console.config.reprovision.completed'` |
| `CONFIG_REPROVISION_KAFKA_TOPIC_MAP` | Topic Kafka para eventos de mapa de identificadores | `'console.config.reprovision.identifier-map'` |

---

*Documento generado para el stage `speckit.tasks` — US-BKP-02-T03 | Rama: `117-tenant-reprovision-from-export`*
