# Plan técnico — US-BKP-02-T02: Formato de export/import versionado y compatible con upgrades

| Campo               | Valor                                                                               |
| ------------------- | ----------------------------------------------------------------------------------- |
| **Task ID**         | US-BKP-02-T02                                                                       |
| **Stage**           | speckit.plan                                                                        |
| **Rama**            | `116-versioned-export-import-format`                                                |
| **Dependencias**    | US-BKP-02-T01 (artefacto de exportación ya existe en producción)                   |
| **Stack confirmado**| Node.js 20+ ESM, Apache OpenWhisk, APISIX, Keycloak, PostgreSQL, Kafka, React+TS   |

---

## 1. Objetivo técnico

Partiendo del artefacto JSON que produce `tenant-config-export.mjs` (T01), esta tarea:

1. Eleva `format_version` de `"1.0"` a semver `"1.0.0"` y agrega `schema_checksum`.
2. Define el JSON Schema formal del artefacto como módulo versionado en el código.
3. Construye un registro de esquemas en memoria (`schema-registry.mjs`) que mapea versión → esquema + migraciones.
4. Expone tres nuevas OpenWhisk actions:
   - `tenant-config-validate` — valida un artefacto contra el esquema de su versión declarada.
   - `tenant-config-migrate` — migra un artefacto de versión anterior al formato actual.
   - `tenant-config-format-versions` — consulta versiones de formato soportadas.
5. Añade tres rutas APISIX y los eventos Kafka de auditoría correspondientes.
6. Actualiza `tenant-config-export.mjs` para emitir `schema_checksum` en la metadata raíz.

---

## 2. Arquitectura y flujo

```text
                    ┌──────────────────────────────────────────────┐
                    │  APISIX (keycloak-openid-connect, scope check) │
                    └──────────┬───────────────────┬───────────────┘
                               │                   │
          POST /config/validate │   POST /config/migrate  GET /config/format-versions
                               ▼                   ▼               ▼
                    ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
                    │ tenant-config-   │  │ tenant-config-   │  │ tenant-config-   │
                    │   validate       │  │   migrate        │  │ format-versions  │
                    └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘
                             │                     │                     │
                             └──────────┬──────────┘                     │
                                        ▼                                 │
                         ┌─────────────────────────┐                     │
                         │     schema-registry.mjs  │◄────────────────────┘
                         │  (versions, schemas,     │
                         │   migrations, checksum)  │
                         └─────────────────────────┘
                                        │
                          ┌─────────────┴──────────────┐
                          │                            │
                 ┌────────▼────────┐        ┌──────────▼───────────┐
                 │  Kafka audit    │        │  config-schema-      │
                 │  (validate /    │        │  v1.0.0.schema.json  │
                 │   migrate evts) │        │  (static ESM asset)  │
                 └─────────────────┘        └──────────────────────┘
```

### Principios de diseño

- **Las migraciones son funciones puras deterministas**: sin I/O, sin estado externo.
- **El esquema es código, no configuración**: `schemas/` contiene módulos ESM inmutables.
- **Compatibilidad backward dentro del mismo major**: validador acepta cualquier minor/patch sin migración.
- **No se almacena artefacto**: validación y migración operan en memoria; el resultado se devuelve como respuesta HTTP.

---

## 3. Estructura de ficheros propuesta

```text
services/provisioning-orchestrator/src/
  schemas/
    index.mjs                       ← re-exporta el registro público (getSchemaRegistry)
    v1.0.0.schema.json              ← JSON Schema draft 2020-12 para format_version 1.0.0
    schema-registry.mjs             ← registro en memoria: versiones, schemas, migraciones, checksum
    migrations/
      (vacío en v1; aquí irán migrate-1.x-to-2.0.mjs etc. cuando el formato evolucione)
  actions/
    tenant-config-validate.mjs      ← nueva action: valida artefacto
    tenant-config-migrate.mjs       ← nueva action: migra artefacto
    tenant-config-format-versions.mjs ← nueva action: lista versiones soportadas
    tenant-config-export.mjs        ← MODIFICADO: agrega schema_checksum, normaliza a "1.0.0"
  events/
    config-schema-events.mjs        ← nueva: publica eventos Kafka de validación/migración
  tests/
    schemas/
      schema-registry.test.mjs
      v1.0.0-schema.test.mjs
    actions/
      tenant-config-validate.test.mjs
      tenant-config-migrate.test.mjs
      tenant-config-format-versions.test.mjs
      tenant-config-export-checksum.test.mjs

services/gateway-config/routes/
  backup-admin-routes.yaml          ← MODIFICADO: +3 rutas nuevas

services/keycloak-config/scopes/
  backup-scopes.yaml                ← MODIFICADO: scope platform:admin:config:validate

apps/web-console/src/
  api/configSchemaApi.ts            ← nueva: tipos + fetch para validate/migrate/versions
  components/ConfigArtifactValidator.tsx ← nueva: panel de validación/migración en consola
```

---

## 4. JSON Schema formal — v1.0.0

Archivo: `services/provisioning-orchestrator/src/schemas/v1.0.0.schema.json`

### Estructura raíz del artefacto

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://falcone.internal/schemas/config-export/v1.0.0",
  "title": "Falcone Tenant Config Export Artifact — v1.0.0",
  "type": "object",
  "required": ["export_timestamp", "tenant_id", "format_version", "deployment_profile",
               "correlation_id", "schema_checksum", "domains"],
  "additionalProperties": true,
  "properties": {
    "export_timestamp":   { "type": "string", "format": "date-time" },
    "tenant_id":          { "type": "string", "minLength": 1 },
    "format_version":     { "type": "string", "pattern": "^1\\.\\d+\\.\\d+$" },
    "deployment_profile": { "type": "string", "enum": ["standard", "minimal", "full"] },
    "correlation_id":     { "type": "string", "minLength": 1 },
    "schema_checksum":    { "type": "string", "pattern": "^sha256:[a-f0-9]{64}$" },
    "domains": {
      "type": "array",
      "items": { "$ref": "#/$defs/DomainSection" }
    },
    "_migration_metadata": { "$ref": "#/$defs/MigrationMetadata" }
  },
  "$defs": {
    "DomainStatus": {
      "type": "string",
      "enum": ["ok", "empty", "error", "not_available", "not_requested"]
    },
    "DomainSection": {
      "type": "object",
      "required": ["domain_key", "status", "exported_at"],
      "additionalProperties": true,
      "properties": {
        "domain_key":   { "type": "string", "minLength": 1 },
        "status":       { "$ref": "#/$defs/DomainStatus" },
        "exported_at":  { "type": "string", "format": "date-time" },
        "items_count":  { "type": ["integer", "null"], "minimum": 0 },
        "data":         { "type": ["object", "null"] },
        "error":        { "type": "string" },
        "reason":       { "type": "string" }
      }
    },
    "MigrationMetadata": {
      "type": "object",
      "properties": {
        "migrated_from":  { "type": "string" },
        "migrated_to":    { "type": "string" },
        "migration_chain": { "type": "array", "items": { "type": "string" } },
        "migrated_at":    { "type": "string", "format": "date-time" }
      }
    }
  }
}
```

**Nota**: `additionalProperties: true` en raíz y en `DomainSection` garantiza la preservación de campos desconocidos (RF-T02-07).

---

## 5. Registro de esquemas (`schema-registry.mjs`)

```js
// Responsabilidades:
// 1. Mantiene mapa { version_string → { schema, checksum, releaseDate, changeNotes } }
// 2. Mantiene mapa { "A→B" → migrationFn }
// 3. Provee: getCurrentVersion(), getMinMigratable(), getSupportedVersions()
// 4. Provee: getSchemaFor(version), getChecksum(version)
// 5. Provee: buildMigrationChain(fromVersion, toVersion) → [fn, fn, ...]
// 6. Provee: isSameMajor(vA, vB) → boolean

const CURRENT_VERSION = '1.0.0';
const MIN_MIGRATABLE  = '1.0.0';  // solo 1 versión en el lanzamiento inicial

// Schema checksum: sha256 del contenido canónico del fichero v1.0.0.schema.json
// (calculado con node:crypto en build time y almacenado como constante)
```

- El checksum se calcula una sola vez en módulo initialization con `createHash('sha256')` sobre el JSON serializado del schema importado. No es un checksum del artefacto, sino del esquema con el que se generó el artefacto.
- Las migraciones entre major versions se registran como `registry.migrations.set('1→2', migrateFn)`. En v1 este mapa está vacío.
- La función `buildMigrationChain('1.3.0', '3.0.0')` resuelve la cadena: `1.x→2.0 → 2.0→3.0`. Cada salto es solo entre major consecutivos.

---

## 6. Cambios en `tenant-config-export.mjs`

### Cambios mínimos necesarios

| Cambio | Detalle |
| ------ | ------- |
| `FORMAT_VERSION` | Cambia de `'1.0'` a `'1.0.0'` (alineación a semver) |
| `schema_checksum` | Se agrega al objeto `artifact` antes de JSON.stringify. Valor: `schemaRegistry.getChecksum('1.0.0')` |
| Import | Se importa `getSchemaRegistry` desde `../schemas/index.mjs` |

Estos cambios son **backwards-compatible**: los consumidores que ignoran `schema_checksum` no se ven afectados. La variación de `"1.0"` a `"1.0.0"` requiere que los tests existentes de T01 sean actualizados.

---

## 7. Nuevas OpenWhisk actions

### 7.1 `tenant-config-validate`

**Ruta**: `POST /v1/admin/tenants/{tenant_id}/config/validate`

**Entrada**: body JSON = artefacto de exportación completo.

**Flujo**:

1. Auth: mismo check que T01 (`platform:admin:config:export` o nuevo scope `platform:admin:config:validate`; ver §11).
2. Leer `format_version` del body. Si ausente → 400 `format_version is required`.
3. Buscar esquema en registry. Si versión desconocida → 422 `format_version X not recognized`.
4. Determinar si requiere migración: si major del artefacto < major actual → advertencia en response, no error.
5. Validar con `Ajv` (o validador JSON Schema nativo) contra el esquema de la versión declarada.
6. Coleccionar campos desconocidos en raíz y en cada `DomainSection` → `warnings`.
7. Responder con:

```jsonc
{
  "result": "valid" | "invalid" | "valid_with_warnings",
  "format_version": "1.0.0",
  "errors": [],           // lista Ajv ErrorObject
  "warnings": [],         // campos desconocidos, deprecaciones
  "schema_checksum_match": true | false | null,
  "migration_required": false
}
```

1. Emitir evento Kafka `console.config.schema.validated` (§10).
1. Status codes: `200` (valid/valid_with_warnings), `422` (invalid estructura), `400` (format_version ausente o futura), `403` (sin permisos).

**Límites de tamaño**: rechazar body > `CONFIG_EXPORT_MAX_ARTIFACT_BYTES` (mismo env que T01) con 413.

### 7.2 `tenant-config-migrate`

**Ruta**: `POST /v1/admin/tenants/{tenant_id}/config/migrate`

**Entrada**: body JSON = artefacto de exportación en versión antigua.

**Flujo**:

1. Auth: igual que validate.
2. Leer `format_version`. Validaciones iniciales (ausente, futura, ya en current).
3. Si misma major que current → responder `200` con `migration_required: false` y el artefacto sin cambios.
4. Construir cadena de migraciones con `buildMigrationChain(from, current)`.
5. Ejecutar cadena secuencialmente. Si una migración falla → parar cadena, responder `422` con `failed_at_step`.
6. Agregar `_migration_metadata` al artefacto migrado.
7. Agregar `_migration_warnings` si alguna migración reportó pérdida de información.
8. Validar artefacto migrado contra esquema de versión destino. Si inválido → `500` (bug en migración).
9. Responder `200` con artefacto migrado.
10. Emitir evento Kafka `console.config.schema.migrated`.

**El artefacto migrado NO se persiste.** Se devuelve como response body para que el operador lo inspeccione y, si procede, lo envíe a T03.

### 7.3 `tenant-config-format-versions`

**Ruta**: `GET /v1/admin/config/format-versions` (sin `tenant_id`; es global a la plataforma)

**Flujo**: consulta el schema-registry y devuelve:

```jsonc
{
  "current_version": "1.0.0",
  "min_migratable_version": "1.0.0",
  "versions": [
    {
      "version": "1.0.0",
      "release_date": "2026-04-01",
      "change_notes": "Initial versioned format. Formalizes artifact produced by US-BKP-02-T01.",
      "schema_checksum": "sha256:abc..."
    }
  ]
}
```

No requiere `tenant_id`. Auth: `platform:admin:config:export` o `platform:admin:config:validate`.

---

## 8. Modelo de datos y eventos

### 8.1 PostgreSQL — sin nuevas tablas

T02 no introduce nuevas tablas. Los eventos de validación y migración se auditan únicamente vía Kafka (las operaciones son stateless y no persisten artefactos). Si en el futuro se necesita historial de validaciones, se añadirá una tabla en una tarea separada.

### 8.2 Nuevos Kafka topics

| Topic | Retención | Descripción |
| ----- | --------- | ----------- |
| `console.config.schema.validated` | 30 d | Evento por cada invocación a `tenant-config-validate` |
| `console.config.schema.migrated`  | 30 d | Evento por cada migración ejecutada en `tenant-config-migrate` |

**Schema del evento `console.config.schema.validated`**:

```jsonc
{
  "event_type": "config.schema.validated",
  "correlation_id": "string",
  "tenant_id": "string",
  "actor_id": "string",
  "actor_type": "superadmin|sre|service_account",
  "format_version_validated": "string",
  "result": "valid|invalid|valid_with_warnings",
  "error_count": 0,
  "warning_count": 0,
  "schema_checksum_match": true,
  "migration_required": false,
  "validated_at": "ISO 8601"
}
```

**Schema del evento `console.config.schema.migrated`**:

```jsonc
{
  "event_type": "config.schema.migrated",
  "correlation_id": "string",
  "tenant_id": "string",
  "actor_id": "string",
  "actor_type": "string",
  "migrated_from": "string",
  "migrated_to": "string",
  "migration_chain": ["string"],
  "has_migration_warnings": false,
  "migrated_at": "ISO 8601"
}
```

### 8.3 Variables de entorno nuevas

| Variable | Default | Descripción |
| -------- | ------- | ----------- |
| `CONFIG_SCHEMA_KAFKA_TOPIC_VALIDATED` | `console.config.schema.validated` | Topic para eventos de validación |
| `CONFIG_SCHEMA_KAFKA_TOPIC_MIGRATED`  | `console.config.schema.migrated`  | Topic para eventos de migración |
| `CONFIG_SCHEMA_MAX_INPUT_BYTES`       | `10485760` (10 MB)                | Tamaño máximo de artefacto en validate/migrate |

Las variables `CONFIG_EXPORT_*` de T01 se reutilizan donde aplican (auth, brokers).

---

## 9. Rutas APISIX

Archivo: `services/gateway-config/routes/backup-admin-routes.yaml` (modificado)

```yaml
# Añadir al fichero existente:

  - name: config-validate-post
    uri: /v1/admin/tenants/*/config/validate
    methods:
      - POST
    plugins:
      keycloak-openid-connect:
        enabled: true
        required_scopes:
          - platform:admin:config:export
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
        openwhisk-tenant-config-validate: 1

  - name: config-migrate-post
    uri: /v1/admin/tenants/*/config/migrate
    methods:
      - POST
    plugins:
      keycloak-openid-connect:
        enabled: true
        required_scopes:
          - platform:admin:config:export
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
        send: 30
        read: 30
      nodes:
        openwhisk-tenant-config-migrate: 1

  - name: config-format-versions-get
    uri: /v1/admin/config/format-versions
    methods:
      - GET
    plugins:
      keycloak-openid-connect:
        enabled: true
        required_scopes:
          - platform:admin:config:export
      limit-req:
        rate: 30
        burst: 60
        key: consumer_name
    upstream:
      type: roundrobin
      timeout:
        connect: 5
        send: 10
        read: 10
      nodes:
        openwhisk-tenant-config-format-versions: 1
```

---

## 10. Componente de consola (React)

### `configSchemaApi.ts`

Tipos y funciones fetch para los tres endpoints nuevos:

```typescript
export interface ValidationResult {
  result: 'valid' | 'invalid' | 'valid_with_warnings';
  format_version: string;
  errors: AjvError[];
  warnings: string[];
  schema_checksum_match: boolean | null;
  migration_required: boolean;
}

export interface MigrationResult {
  artifact: ExportArtifact;           // artefacto migrado
  _migration_metadata: MigrationMetadata;
  _migration_warnings?: MigrationWarning[];
}

export interface FormatVersionsResponse {
  current_version: string;
  min_migratable_version: string;
  versions: FormatVersionEntry[];
}

export async function validateArtifact(tenantId: string, artifact: unknown): Promise<ValidationResult>
export async function migrateArtifact(tenantId: string, artifact: unknown): Promise<MigrationResult>
export async function getFormatVersions(): Promise<FormatVersionsResponse>
```

### `ConfigArtifactValidator.tsx`

Panel de consola que permite:

1. Pegar o subir un artefacto JSON.
2. Ver la `format_version` detectada, resultado de validación y errores/warnings.
3. Si `migration_required: true`, mostrar botón "Migrar artefacto" que invoca `/config/migrate`.
4. Tras migración exitosa, mostrar el artefacto migrado descargable y los warnings de migración.

El componente usa estado React local (no Redux ni contexto global); el artefacto nunca sale del navegador sin solicitud explícita del usuario.

---

## 11. Permisos y seguridad

Se reutiliza el scope `platform:admin:config:export` para todos los nuevos endpoints. No se crea un scope nuevo (simplifica la integración con T01 y evita proliferación de scopes para operaciones complementarias del mismo flujo).

Los mismos roles que pueden exportar (`superadmin`, `sre`, `service_account`) pueden validar y migrar.

---

## 12. Estrategia de pruebas

### 12.1 Unitarias (`node:test`)

| Fichero | Qué prueba |
| ------- | ---------- |
| `schema-registry.test.mjs` | `getCurrentVersion()`, `getChecksum()`, `buildMigrationChain()`, comportamiento con versión desconocida/futura |
| `v1.0.0-schema.test.mjs` | El esquema valida artefactos reales producidos por T01 en los escenarios: todos ok, partial error, not_available, campos extra |
| `tenant-config-validate.test.mjs` | CA-02 a CA-06, CA-10: artefacto válido, inválido, sin format_version, versión futura, campos desconocidos |
| `tenant-config-migrate.test.mjs` | CA-07 a CA-09, CA-11, CA-16: no-op cuando ya es versión actual, detención en fallo, determinismo |
| `tenant-config-format-versions.test.mjs` | CA-12: response shape, versión actual, min migratable |
| `tenant-config-export-checksum.test.mjs` | CA-13: artefacto exportado contiene `schema_checksum` con patrón `sha256:[hex]` |

### 12.2 Contrato

- El JSON Schema `v1.0.0.schema.json` es el contrato. Los tests de contrato validan que el schema registry lo expone correctamente y que su checksum es estable entre ejecuciones.
- El contrato se publica como artefacto de build (puede incluirse en `public-route-catalog.json` o como endpoint `GET /v1/admin/config/format-versions`).

### 12.3 Integración (manual / CI)

- Ejecutar exportación de T01 → pasar artefacto a `/config/validate` → esperar `valid`.
- Introducir artefacto con campo extra → esperar `valid_with_warnings`.
- Simular artefacto de versión futura → esperar 422.
- Verificar evento Kafka `console.config.schema.validated` tras cada validación.

### 12.4 Tests a actualizar (T01)

Los tests existentes de `tenant-config-export.test.mjs` que assertan `format_version: '1.0'` deben actualizarse a `'1.0.0'` y agregar assert de `schema_checksum` en la metadata raíz.

---

## 13. Gestión de cambios y compatibilidad

### Política de versionado semántico del formato

| Tipo de cambio | Acción |
| -------------- | ------ |
| Nueva campo opcional en DomainSection o metadata raíz | MINOR bump (`1.0.0 → 1.1.0`). Sin migración necesaria. |
| Nuevo dominio en la lista de colectores | MINOR bump. Los artefactos sin ese dominio son válidos (dominio ausente = no exportado). |
| Eliminación o renombrado de campo existente | MAJOR bump (`1.x.x → 2.0.0`). Requiere migración. |
| Cambio de estructura de un DomainSection existente | MAJOR bump. Requiere migración. |
| Corrección de documentación del schema sin cambio funcional | PATCH bump. |

### Cómo registrar una nueva versión

1. Crear `schemas/vX.Y.Z.schema.json`.
2. Registrar en `schema-registry.mjs`: añadir entrada al mapa de versiones.
3. Si MAJOR: implementar `schemas/migrations/migrate-N-to-M.mjs` como función pura exportada y registrarla en el mapa de migraciones.
4. Actualizar `FORMAT_VERSION` en `tenant-config-export.mjs` y `schema-registry.mjs`.
5. Actualizar tests del schema y tests de migración.

### Política de sunset

- Se soportarán migraciones para los **2 major versions anteriores** al current. Versiones más antiguas se rechazarán con error `format_version too old; minimum migratable version is X.0.0`.
- Esta política no afecta a v1 inicial; se aplicará cuando exista v3.

---

## 14. Observabilidad

- Los eventos Kafka `console.config.schema.validated` y `console.config.schema.migrated` son la fuente principal de observabilidad.
- Los campos `result`, `error_count`, `warning_count` permiten crear dashboards de salud del formato.
- Logs estructurados en cada action con `correlation_id`, `format_version`, `actor_id`.

---

## 15. Rollback y seguridad

- Las nuevas actions son additive; su despliegue o rollback no afecta a T01 ni a ninguna otra acción existente.
- El cambio de `format_version: '1.0'` a `'1.0.0'` en T01 es el único cambio con impacto en artefactos existentes. Los consumidores que comparaban `=== '1.0'` deben actualizarse, pero no hay consumidores de importación en producción todavía (T03 es posterior).
- El campo `schema_checksum` es aditivo y retrocompatible.
- Las migraciones son operaciones read-only sobre el artefacto; no modifican estado en la plataforma.

---

## 16. Secuencia de implementación

```text
Paso 1 — Schema y registro (base sin dependencias)
  ├─ Crear v1.0.0.schema.json
  ├─ Implementar schema-registry.mjs (sin migraciones)
  └─ Tests: schema-registry.test.mjs + v1.0.0-schema.test.mjs

Paso 2 — Actualizar T01
  ├─ Cambiar FORMAT_VERSION a '1.0.0'
  ├─ Agregar schema_checksum al artefacto
  └─ Actualizar tests de tenant-config-export

Paso 3 — Actions nuevas (independientes entre sí)
  ├─ tenant-config-format-versions.mjs + test
  ├─ tenant-config-validate.mjs + test
  └─ tenant-config-migrate.mjs + test

Paso 4 — Eventos y config
  ├─ config-schema-events.mjs
  └─ Variables de entorno en Helm values

Paso 5 — APISIX + Keycloak
  └─ backup-admin-routes.yaml (3 nuevas rutas)

Paso 6 — Consola (puede paralelizarse con Paso 3)
  ├─ configSchemaApi.ts
  └─ ConfigArtifactValidator.tsx

Paso 7 — Validación integral
  └─ Test end-to-end: export → validate → migrate (no-op en v1)
```

Los pasos 3 y 6 pueden realizarse en paralelo por dos desarrolladores.

---

## 17. Criterios de done verificables

| Criterio | Evidencia |
| -------- | --------- |
| Existe `v1.0.0.schema.json` con la estructura descrita en §4 | Fichero presente en `schemas/`; válido como JSON Schema draft 2020-12 |
| `schema-registry.mjs` expone `getCurrentVersion()` → `'1.0.0'` | Test verde en CI |
| `tenant-config-export` emite `schema_checksum` con patrón `sha256:[hex]` | CA-13: assert en test unitario |
| `tenant-config-export` emite `format_version: '1.0.0'` | Assert en test unitario actualizado |
| `POST /config/validate` retorna `valid` para artefacto conforme de T01 | CA-02: test unitario e integración manual |
| `POST /config/validate` retorna `invalid` para artefacto con campos requeridos ausentes | CA-03 |
| `POST /config/validate` retorna 400 para artefacto sin `format_version` | CA-04 |
| `POST /config/validate` retorna 422 para `format_version: 99.0.0` | CA-05 |
| `POST /config/validate` retorna `valid_with_warnings` para artefacto con campos extra | CA-10 |
| `POST /config/migrate` retorna el mismo artefacto con `migration_required: false` si ya está en versión actual | CA-07 (no-op en v1) |
| `GET /config/format-versions` devuelve `current_version: '1.0.0'` y lista de versiones | CA-12 |
| Eventos `console.config.schema.validated` y `console.config.schema.migrated` publicados en Kafka | CA-14, CA-15: verificado en test de integración |
| Suite de tests pasa en CI (`pnpm test` en `provisioning-orchestrator`) | Salida de CI verde |
| Rutas APISIX responden 403 sin token válido | Verificación manual o test de seguridad |

---

*Plan generado para el stage `speckit.plan` — US-BKP-02-T02 | Rama: `116-versioned-export-import-format`*
