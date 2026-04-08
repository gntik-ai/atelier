<!-- markdownlint-disable MD024 MD031 -->
# Tasks — US-UI-03-T06: Pruebas E2E por servicio verificando consumo de APIs públicas del BaaS

**Feature Branch**: `060-console-service-e2e`
**Task ID**: US-UI-03-T06
**Estado**: Ready for implement
**Fecha**: 2026-03-29

---

## Resumen ejecutivo

Entregar dos archivos nuevos bajo `apps/web-console/e2e/`:

1. `e2e/fixtures/service-e2e.ts` — fixture con datos simulados y funciones `installXxxMocks` para los cinco servicios.
2. `e2e/console-service-e2e.e2e.ts` — spec con 16+ escenarios organizados en seis grupos (J01–J06).

No se modifica ningún otro archivo del repositorio.

---

## Mapa de archivos de implementación

### Archivos a crear (únicos cambios en el repo)

| Archivo | Acción |
|---|---|
| `apps/web-console/e2e/fixtures/service-e2e.ts` | Crear |
| `apps/web-console/e2e/console-service-e2e.e2e.ts` | Crear |

### Archivos de referencia obligatoria (solo lectura)

| Archivo | Por qué se necesita |
|---|---|
| `apps/web-console/e2e/fixtures/context-auth-e2e.ts` | Importar `installContextAuthMocks`, `TENANT_ALPHA`, `WORKSPACE_ALPHA_PROD`, `SESSION_OPS_MULTI_TENANT` |
| `apps/web-console/e2e/console-context-auth-e2e.e2e.ts` | Copiar patrón de `loginToConsole`, `selectTenant`, `selectWorkspace`, `waitForSelectOption` |

### Archivos de referencia opcional (para verificar aria-labels/headings reales)

| Archivo | Sección relevante |
|---|---|
| `apps/web-console/src/pages/ConsolePostgresPage.tsx` | `aria-label="PostgreSQL del tenant activo"`, `h1 "Inventario relacional del tenant activo"`, `aria-label="Listado de bases de datos PostgreSQL"`, mensajes empty/error |
| `apps/web-console/src/pages/ConsoleMongoPage.tsx` | `aria-label="MongoDB del tenant activo"`, `h1 "Inventario documental del tenant activo"`, `h2 "Bases de datos"`, mensajes empty/error |
| `apps/web-console/src/pages/ConsoleKafkaPage.tsx` | `data-testid="console-kafka-page"`, `h1 "Kafka / Events"`, `h2 "Topics Kafka"`, mensajes `role="alert"` |
| `apps/web-console/src/pages/ConsoleFunctionsPage.tsx` | `h1 "Consola de funciones"`, `h2 "Inventario"`, mensajes `role="alert"` |
| `apps/web-console/src/pages/ConsoleStoragePage.tsx` | `data-testid="console-storage-page"`, `h1 "Storage / Objetos"`, `h2 "Buckets"`, mensajes `role="alert"` |

> **Regla token-optimization**: el implement debe leer ÚNICAMENTE los archivos listados en estas tablas. No leer `apps/control-plane/openapi/control-plane.openapi.json`. No se necesita ningún archivo OpenAPI ya que las rutas de API están definidas explícitamente en las tareas y en los archivos de página.

---

## Tarea T1 — Crear `apps/web-console/e2e/fixtures/service-e2e.ts`

### Descripción

Fixture centralizada que provee:
- Tipos TypeScript de respuesta para los cinco dominios.
- Constantes de datos de prueba (nominal, vacío, error) para cada dominio.
- Funciones `installXxxMocks(page, scenario)` por servicio.
- Función `assertPublicApiOnly(urls, serviceName)`.
- Constante `PUBLIC_API_PREFIXES`.

### Contratos de exportación requeridos

```typescript
import { type Page } from '@playwright/test'

export type ServiceScenario = 'nominal' | 'empty' | 'error'

export const PUBLIC_API_PREFIXES: string[]

// Verificador de allowlist — lanza error si alguna URL viola el allowlist
export function assertPublicApiOnly(urls: string[], serviceName: string): void

// Instaladores de mocks por servicio
export async function installPgMocks(page: Page, scenario: ServiceScenario): Promise<void>
export async function installMongoMocks(page: Page, scenario: ServiceScenario): Promise<void>
export async function installKafkaMocks(page: Page, scenario: ServiceScenario): Promise<void>
export async function installFunctionsMocks(page: Page, scenario: ServiceScenario): Promise<void>
export async function installStorageMocks(page: Page, scenario: ServiceScenario): Promise<void>
```

### Constante `PUBLIC_API_PREFIXES`

```typescript
export const PUBLIC_API_PREFIXES = [
  '/v1/postgres/',
  '/v1/mongo/',
  '/v1/events/',
  '/v1/functions/',
  '/v1/storage/',
  '/v1/auth/',
  '/v1/tenants',
  '/v1/workspaces',
  '/v1/iam/',
]
```

### Implementación de `assertPublicApiOnly`

```typescript
export function assertPublicApiOnly(urls: string[], serviceName: string): void {
  for (const url of urls) {
    const isAllowed = PUBLIC_API_PREFIXES.some((prefix) => url.startsWith(prefix))
    if (!isAllowed) {
      throw new Error(
        `URL fuera de la API pública detectada en journey ${serviceName}: ${url}`
      )
    }
  }
}
```

### Patrón de instalador de mocks

Cada `installXxxMocks` debe:
1. Registrar rutas con `page.route('**/v1/<dominio>/**', ...)`.
2. Para `scenario === 'error'`: devolver `503` con body JSON `{ message: '...' }` en el endpoint de listado principal.
3. Para `scenario === 'empty'`: devolver `200` con colección vacía en el endpoint de listado principal; el resto de endpoints devuelven vacíos también.
4. Para `scenario === 'nominal'`: devolver los datos de fixture definidos a continuación.
5. Terminar cada handler con `await route.abort('failed')` si la ruta no coincide con ningún patrón conocido del dominio.

> **Nota**: los `installXxxMocks` se registran DESPUÉS de `installContextAuthMocks`. La ruta `**/v1/**` de `installContextAuthMocks` cubre auth/tenants/workspaces/iam. Los instaladores de servicio solo cubren sus rutas específicas; no deben re-interceptar `/v1/auth/`, `/v1/tenants`, `/v1/workspaces`, ni `/v1/iam/`. Usar `page.route('**/v1/postgres/**', ...)` (dominio-específico) para evitar conflictos.

### Fixtures de datos de prueba

#### PostgreSQL

**Constantes de contexto**:
```typescript
export const PG_DB_NAME = 'ws_alpha_prod_db'
export const PG_SCHEMA_NAME = 'public'
export const PG_TABLE_NAME = 'users'
```

**GET `/v1/postgres/databases`** — nominal:
```json
{
  "items": [
    {
      "databaseName": "ws_alpha_prod_db",
      "state": "active",
      "ownerRoleName": "ws_alpha_owner",
      "placementMode": "dedicated",
      "tenantId": "tenant_alpha",
      "workspaceId": "ws_alpha_prod"
    }
  ],
  "page": { "total": 1, "size": 1, "number": 1, "totalPages": 1 }
}
```

**GET `/v1/postgres/databases/ws_alpha_prod_db/schemas`** — nominal:
```json
{
  "items": [
    {
      "schemaName": "public",
      "state": "active",
      "ownerRoleName": "ws_alpha_owner",
      "objectCounts": { "tables": 2, "views": 0, "materializedViews": 0, "indexes": 2 }
    }
  ],
  "page": { "total": 1, "size": 1, "number": 1, "totalPages": 1 }
}
```

**GET `/v1/postgres/databases/ws_alpha_prod_db/schemas/public/tables`** — nominal:
```json
{
  "items": [
    { "tableName": "users", "state": "active", "columnCount": 5 },
    { "tableName": "orders", "state": "active", "columnCount": 8 }
  ],
  "page": { "total": 2, "size": 2, "number": 1, "totalPages": 1 }
}
```

Resto de sub-endpoints (`/columns`, `/indexes`, `/policies`, `/security`, `/views`, `/materialized-views`, `/table-detail`): devuelven `{ "items": [], "page": { "total": 0 } }` en todos los escenarios del journey principal (el test no los verifica explícitamente).

#### MongoDB

**Constantes de contexto**:
```typescript
export const MONGO_DB_NAME = 'ws_alpha_events'
export const MONGO_COL_NAME = 'audit_logs'
export const MONGO_WORKSPACE_ID = 'ws_alpha_prod'
```

**GET `/v1/mongo/databases`** — nominal:
```json
{
  "items": [
    {
      "databaseName": "ws_alpha_events",
      "stats": { "dataSize": 1048576, "storageSize": 2097152, "collections": 1, "indexes": 2 }
    }
  ]
}
```

**GET `/v1/mongo/databases/ws_alpha_events/collections`** — nominal:
```json
{
  "items": [
    {
      "collectionName": "audit_logs",
      "collectionType": "standard",
      "documentCount": 120,
      "estimatedSize": 204800
    }
  ]
}
```

**GET `/v1/mongo/databases/ws_alpha_events/views`** — nominal: `{ "items": [] }`

**GET `/v1/mongo/databases/ws_alpha_events/collections/audit_logs/indexes`** — nominal:
```json
{
  "items": [
    { "indexName": "_id_", "indexType": "single", "unique": false },
    { "indexName": "created_at_1", "keys": [{ "fieldName": "created_at", "direction": 1 }], "indexType": "single", "unique": false }
  ]
}
```

**GET `/v1/mongo/workspaces/ws_alpha_prod/data/ws_alpha_events/collections/audit_logs/documents`** — nominal:
```json
{
  "items": [
    { "_id": "doc_001", "event": "login", "userId": "usr_ops_001" },
    { "_id": "doc_002", "event": "create_db", "userId": "usr_ops_001" }
  ],
  "page": { "after": null, "size": 2 }
}
```

#### Kafka

**Constantes de contexto**:
```typescript
export const KAFKA_WORKSPACE_ID = 'ws_alpha_prod'
export const KAFKA_TOPIC_ID = 'topic_audit_001'
export const KAFKA_TOPIC_NAME = 'platform.audit.events'
```

**GET `/v1/events/workspaces/ws_alpha_prod/inventory`** — nominal:
```json
{
  "items": [
    {
      "topicId": "topic_audit_001",
      "topicName": "platform.audit.events",
      "state": "active",
      "partitions": 3,
      "replicationFactor": 1
    }
  ],
  "counts": { "total": 1, "topics": 1 },
  "bridges": []
}
```

**GET `/v1/events/topics/topic_audit_001`** — nominal:
```json
{
  "topicId": "topic_audit_001",
  "topicName": "platform.audit.events",
  "state": "active",
  "partitions": 3,
  "retentionMs": 604800000
}
```

**GET `/v1/events/topics/topic_audit_001/access`** — nominal:
```json
{
  "aclBindings": [
    { "principal": "ws_alpha_owner", "operations": ["read", "write"], "state": "active" }
  ]
}
```

**GET `/v1/events/topics/topic_audit_001/metadata`** — nominal:
```json
{
  "lag": { "total": 0, "byPartition": [] },
  "health": "healthy"
}
```

**GET `/v1/events/topics/topic_audit_001/stream`** (SSE) — siempre responder con `200`, `Content-Type: text/event-stream`, body vacío (evita que el componente quede colgado si inicia el stream automáticamente).

#### Functions

**Constantes de contexto**:

```typescript
export const FN_WORKSPACE_ID = 'ws_alpha_prod'
export const FN_ACTION_ID = 'fn_hello_world'
export const FN_ACTION_NAME = 'hello-world'
```

**GET `/v1/functions/workspaces/ws_alpha_prod/inventory`** — nominal:

```json
{
  "actions": [
    {
      "actionId": "fn_hello_world",
      "name": "hello-world",
      "namespace": "ws_alpha",
      "runtime": "nodejs:18",
      "state": "active",
      "version": "0.0.3"
    }
  ]
}
```

**GET `/v1/functions/actions/fn_hello_world`** — nominal:

```json
{
  "actionId": "fn_hello_world",
  "name": "hello-world",
  "namespace": "ws_alpha",
  "runtime": "nodejs:18",
  "state": "active",
  "version": "0.0.3",
  "limits": { "timeout": 60000, "memory": 256 }
}
```

**GET `/v1/functions/actions/fn_hello_world/activations`** — nominal:

```json
{
  "items": [
    {
      "activationId": "act_001",
      "actionId": "fn_hello_world",
      "status": "success",
      "duration": 42,
      "start": "2026-03-29T08:00:00.000Z"
    }
  ]
}
```

**GET `/v1/functions/actions/fn_hello_world/versions`** — nominal:

```json
{
  "items": [
    { "version": "0.0.2", "actionId": "fn_hello_world", "createdAt": "2026-03-28T10:00:00.000Z" }
  ]
}
```

**GET `/v1/functions/workspaces/ws_alpha_prod/actions`** — nominal (fallback si la página lo llama): devolver mismo payload que `inventory` pero en formato `{ "items": [...] }`.

#### Storage

**Constantes de contexto**:

```typescript
export const STO_WORKSPACE_ID = 'ws_alpha_prod'
export const STO_BUCKET_ID = 'bucket_alpha_assets'
export const STO_BUCKET_NAME = 'alpha-assets'
export const STO_OBJECT_KEY = 'images/logo.png'
```

**GET `/v1/storage/buckets`** — nominal:

```json
{
  "items": [
    {
      "resourceId": "bucket_alpha_assets",
      "bucketName": "alpha-assets",
      "region": "eu-west-1",
      "state": "active",
      "versioning": false
    }
  ],
  "page": { "total": 1, "size": 1, "number": 1, "totalPages": 1 }
}
```

**GET `/v1/storage/workspaces/ws_alpha_prod/usage`** — nominal:

```json
{
  "workspaceId": "ws_alpha_prod",
  "totalBytes": 10485760,
  "objectCount": 42,
  "bucketCount": 1
}
```

**GET `/v1/storage/buckets/bucket_alpha_assets/objects`** — nominal:

```json
{
  "items": [
    {
      "objectKey": "images/logo.png",
      "size": 204800,
      "contentType": "image/png",
      "lastModified": "2026-03-20T10:00:00.000Z",
      "etag": "abc123"
    }
  ],
  "page": { "total": 1, "nextCursor": null }
}
```

**GET `/v1/storage/buckets/bucket_alpha_assets/objects/images%2Flogo.png/metadata`** — nominal: devolver el mismo objeto que el item de objetos.

---

## Tarea T2 — Crear `apps/web-console/e2e/console-service-e2e.e2e.ts`

### Objetivo

Spec Playwright con 16+ escenarios en seis grupos. Usa el fixture `service-e2e.ts` para mocks de servicio y reutiliza helpers de `console-context-auth-e2e.e2e.ts` para login/contexto.

### Helpers locales requeridos (copiar/adaptar de `console-context-auth-e2e.e2e.ts`)

```typescript
// Copiar estos helpers localmente en el spec (no re-exportarlos):
// - loginToConsole(page, scenario) — usa installContextAuthMocks + flujo de login
// - selectTenant(page, label)
// - selectWorkspace(page, label)
// - waitForSelectOption(page, testId, label)
```

### Patrón de registro de URLs interceptadas

```typescript
// Al inicio de cada test nominal, antes de navegar:
const interceptedUrls: string[] = []

await page.route('**/*', async (route) => {
  const url = new URL(route.request().url())
  if (url.pathname.startsWith('/v1/')) {
    interceptedUrls.push(url.pathname)
  }
  await route.fallback()  // delegar al handler de mock ya registrado
})

// Al final del test:
assertPublicApiOnly(interceptedUrls, 'postgresql') // o el nombre del servicio
```

> **Importante**: registrar el handler de registro DESPUÉS de `installContextAuthMocks` e `installXxxMocks`, y usar `route.fallback()` para no interferir con los mocks ya registrados. El orden de `page.route` en Playwright es LIFO (último en registrar, primero en ejecutar), por lo que el handler de registro debe registrarse AL FINAL.

### Estructura del spec

```typescript
import { expect, test } from '@playwright/test'
import { installContextAuthMocks } from './fixtures/context-auth-e2e'
import {
  PUBLIC_API_PREFIXES,
  assertPublicApiOnly,
  installPgMocks,
  installMongoMocks,
  installKafkaMocks,
  installFunctionsMocks,
  installStorageMocks,
  PG_DB_NAME, PG_SCHEMA_NAME, PG_TABLE_NAME,
  MONGO_DB_NAME, MONGO_COL_NAME,
  KAFKA_TOPIC_NAME,
  FN_ACTION_NAME,
  STO_BUCKET_NAME, STO_OBJECT_KEY,
} from './fixtures/service-e2e'

// helpers locales: loginToConsole, selectTenant, selectWorkspace, waitForSelectOption

test.describe('J01 — PostgreSQL: listado y exploración de esquemas/tablas', () => { ... })
test.describe('J02 — MongoDB: listado y exploración de colecciones', () => { ... })
test.describe('J03 — Kafka: topics y estado de salud', () => { ... })
test.describe('J04 — Functions: listado, estado y activations', () => { ... })
test.describe('J05 — Storage: buckets, objetos y uso', () => { ... })
test.describe('J06 — Verificación transversal de ausencia de backdoors', () => { ... })
```

---

## Escenarios detallados

### Grupo J01 — PostgreSQL

#### J01-T1 — Journey nominal: listado de bases y exploración de esquemas/tablas

**Setup**: `installContextAuthMocks(page, 'multi_tenant_nominal')` + `installPgMocks(page, 'nominal')` + handler de registro de URLs.

**Pasos**:
1. `loginToConsole(page, 'multi_tenant_nominal')` (login completo al shell).
2. `selectTenant(page, 'Alpha Corp')`.
3. `selectWorkspace(page, 'Production')`.
4. `await page.goto('/console/postgres')`.
5. `await expect(page.getByRole('heading', { name: /inventario relacional del tenant activo/i })).toBeVisible()`.
6. `await expect(page.getByRole('table', { name: /listado de bases de datos postgresql/i })).toBeVisible()`.
7. Verificar que la fila con texto `ws_alpha_prod_db` es visible en la tabla.
8. Hacer clic en la fila `ws_alpha_prod_db` (botón de selección o la propia celda clicable).
9. `await expect(page.getByRole('table', { name: /listado de esquemas postgresql/i })).toBeVisible()`.
10. Verificar que la fila con texto `public` es visible.
11. Hacer clic en `public`.
12. `await expect(page.getByRole('tabpanel', { name: /tablas postgresql del esquema seleccionado/i })).toBeVisible()`.
13. `await expect(page.getByRole('table', { name: /listado de tablas postgresql/i })).toBeVisible()`.
14. Verificar que la fila con texto `users` es visible.
15. `assertPublicApiOnly(interceptedUrls, 'postgresql')`.
16. Verificar que `interceptedUrls` incluye una entrada que contiene `/v1/postgres/databases`.
17. Verificar que `interceptedUrls` incluye una entrada que contiene `/v1/postgres/databases/${PG_DB_NAME}/schemas`.

**RF**: RF-UI-016 | **SC**: SC-001, SC-002, SC-003

#### J01-T2 — Empty state: sin bases de datos

**Setup**: `installContextAuthMocks(page, 'multi_tenant_nominal')` + `installPgMocks(page, 'empty')`.

**Pasos**:
1. `loginToConsole(page, 'multi_tenant_nominal')`.
2. `selectTenant(page, 'Alpha Corp')` + `selectWorkspace(page, 'Production')`.
3. `await page.goto('/console/postgres')`.
4. `await expect(page.getByText('No hay bases de datos disponibles para este tenant.')).toBeVisible()`.
5. `await expect(page.getByRole('table', { name: /listado de bases de datos/i })).not.toBeVisible()`.

**SC**: SC-005

#### J01-T3 — Error de API: listado de bases

**Setup**: `installContextAuthMocks(page, 'multi_tenant_nominal')` + `installPgMocks(page, 'error')`.

**Pasos**:
1. `loginToConsole(page, 'multi_tenant_nominal')`.
2. `selectTenant(page, 'Alpha Corp')` + `selectWorkspace(page, 'Production')`.
3. `await page.goto('/console/postgres')`.
4. `await expect(page.getByRole('alert').first()).toBeVisible()`.
5. `await expect(page.getByRole('button', { name: /reintentar/i }).first()).toBeVisible()`.

**SC**: SC-006

#### J01-T4 — Acceso denegado: sin tenant seleccionado

**Setup**: `installContextAuthMocks(page, 'multi_tenant_nominal')` + `installPgMocks(page, 'nominal')` + handler de registro de URLs.

**Pasos**:
1. `loginToConsole(page, 'multi_tenant_nominal')` (sin seleccionar tenant ni workspace).
2. `await page.goto('/console/postgres')`.
3. `await expect(page.getByText('Selecciona un tenant para explorar las bases de datos PostgreSQL.')).toBeVisible()`.
4. Verificar que `interceptedUrls` NO contiene ninguna entrada que empiece por `/v1/postgres/`.

**SC**: SC-007

---

### Grupo J02 — MongoDB

#### J02-T1 — Journey nominal: listado de bases y exploración de colecciones

**Setup**: `installContextAuthMocks(page, 'multi_tenant_nominal')` + `installMongoMocks(page, 'nominal')` + handler de registro.

**Pasos**:
1. `loginToConsole` + `selectTenant('Alpha Corp')` + `selectWorkspace('Production')`.
2. `await page.goto('/console/mongo')`.
3. `await expect(page.getByRole('heading', { name: /inventario documental del tenant activo/i })).toBeVisible()`.
4. `await expect(page.getByRole('heading', { name: /bases de datos/i })).toBeVisible()`.
5. Verificar que la fila con texto `ws_alpha_events` es visible.
6. Hacer clic en `ws_alpha_events`.
7. `await expect(page.getByRole('heading', { name: /base de datos: ws_alpha_events/i })).toBeVisible()`.
8. Verificar que `audit_logs` es visible en el listado de colecciones.
9. Hacer clic en `audit_logs`.
10. `await expect(page.getByRole('heading', { name: /colección: audit_logs/i })).toBeVisible()`.
11. Verificar que el índice `created_at_1` es visible.
12. `assertPublicApiOnly(interceptedUrls, 'mongodb')`.
13. Verificar que `interceptedUrls` incluye entrada con `/v1/mongo/databases`.
14. Verificar que `interceptedUrls` incluye entrada con `/v1/mongo/databases/${MONGO_DB_NAME}/collections`.

**RF**: RF-UI-017 | **SC**: SC-001, SC-002, SC-003

#### J02-T2 — Empty state: sin bases MongoDB

**Setup**: `installContextAuthMocks(page, 'multi_tenant_nominal')` + `installMongoMocks(page, 'empty')`.

**Pasos**:
1. Login + tenant + workspace.
2. `await page.goto('/console/mongo')`.
3. `await expect(page.getByText('No hay bases de datos MongoDB disponibles para este tenant.')).toBeVisible()`.

**SC**: SC-005

#### J02-T3 — Error de API: listado MongoDB

**Setup**: `installContextAuthMocks(page, 'multi_tenant_nominal')` + `installMongoMocks(page, 'error')`.

**Pasos**:
1. Login + tenant + workspace.
2. `await page.goto('/console/mongo')`.
3. `await expect(page.getByRole('alert').first()).toBeVisible()`.
4. `await expect(page.getByRole('button', { name: /reintentar/i }).first()).toBeVisible()`.

**SC**: SC-006

---

### Grupo J03 — Kafka

#### J03-T1 — Journey nominal: topics y estado de salud

**Setup**: `installContextAuthMocks(page, 'multi_tenant_nominal')` + `installKafkaMocks(page, 'nominal')` + handler de registro.

**Pasos**:
1. Login + tenant + workspace.
2. `await page.goto('/console/kafka')`.
3. `await expect(page.getByRole('heading', { name: /kafka \/ events/i })).toBeVisible()`.
4. `await expect(page.getByRole('heading', { name: /topics kafka/i })).toBeVisible()`.
5. Verificar que `platform.audit.events` es visible en el listado.
6. Hacer clic en la fila `platform.audit.events`.
7. `await expect(page.getByRole('heading', { name: /detalle del topic/i })).toBeVisible()`.
8. Verificar que algún elemento con texto `healthy` o `active` o el topicName es visible en el panel de detalle.
9. `assertPublicApiOnly(interceptedUrls, 'kafka')`.
10. Verificar que `interceptedUrls` incluye entrada con `/v1/events/workspaces/`.

**RF**: RF-UI-018 | **SC**: SC-001, SC-002, SC-003

#### J03-T2 — Empty state: sin topics

**Setup**: `installContextAuthMocks(page, 'multi_tenant_nominal')` + `installKafkaMocks(page, 'empty')`.

**Pasos**:
1. Login + tenant + workspace.
2. `await page.goto('/console/kafka')`.
3. `await expect(page.getByText('No hay topics en este workspace.')).toBeVisible()`.

**SC**: SC-005

#### J03-T3 — Error de API: inventory Kafka

**Setup**: `installContextAuthMocks(page, 'multi_tenant_nominal')` + `installKafkaMocks(page, 'error')`.

**Pasos**:
1. Login + tenant + workspace.
2. `await page.goto('/console/kafka')`.
3. `await expect(page.getByRole('alert').first()).toBeVisible()`.
4. `await expect(page.getByRole('button', { name: /reintentar/i }).first()).toBeVisible()`.

**SC**: SC-006

---

### Grupo J04 — Functions

#### J04-T1 — Journey nominal: listado de funciones y activations

**Setup**: `installContextAuthMocks(page, 'multi_tenant_nominal')` + `installFunctionsMocks(page, 'nominal')` + handler de registro.

**Pasos**:
1. Login + tenant + workspace.
2. `await page.goto('/console/functions')`.
3. `await expect(page.getByRole('heading', { name: /consola de funciones/i })).toBeVisible()`.
4. `await expect(page.getByRole('heading', { name: /inventario/i })).toBeVisible()`.
5. Verificar que `hello-world` es visible en el listado.
6. Hacer clic en la fila `hello-world`.
7. `await expect(page.getByRole('heading', { name: /detalle de la función/i })).toBeVisible()`.
8. Verificar que `act_001` es visible en el panel de activations.
9. `assertPublicApiOnly(interceptedUrls, 'functions')`.
10. Verificar que `interceptedUrls` incluye entrada con `/v1/functions/`.

**RF**: RF-UI-019 | **SC**: SC-001, SC-002, SC-003

#### J04-T2 — Empty state: sin funciones

**Setup**: `installContextAuthMocks(page, 'multi_tenant_nominal')` + `installFunctionsMocks(page, 'empty')`.

**Pasos**:
1. Login + tenant + workspace.
2. `await page.goto('/console/functions')`.
3. `await expect(page.getByText('No hay funciones en este workspace.')).toBeVisible()`.

**SC**: SC-005

#### J04-T3 — Error de API: carga de funciones

**Setup**: `installContextAuthMocks(page, 'multi_tenant_nominal')` + `installFunctionsMocks(page, 'error')`.

**Pasos**:
1. Login + tenant + workspace.
2. `await page.goto('/console/functions')`.
3. `await expect(page.getByRole('alert').first()).toBeVisible()`.
4. `await expect(page.getByRole('button', { name: /reintentar/i }).first()).toBeVisible()`.

**SC**: SC-006

---

### Grupo J05 — Storage

#### J05-T1 — Journey nominal: listado de buckets y exploración de objetos

**Setup**: `installContextAuthMocks(page, 'multi_tenant_nominal')` + `installStorageMocks(page, 'nominal')` + handler de registro.

**Pasos**:
1. Login + tenant + workspace.
2. `await page.goto('/console/storage')`.
3. `await expect(page.getByRole('heading', { name: /storage \/ objetos/i })).toBeVisible()`.
4. `await expect(page.getByRole('heading', { name: /buckets/i })).toBeVisible()`.
5. Verificar que `alpha-assets` es visible en el listado.
6. Hacer clic en la fila `alpha-assets`.
7. `await expect(page.getByRole('heading', { name: /detalle del bucket/i })).toBeVisible()`.
8. Verificar que `images/logo.png` es visible en el listado de objetos.
9. `assertPublicApiOnly(interceptedUrls, 'storage')`.
10. Verificar que `interceptedUrls` incluye entrada con `/v1/storage/buckets`.
11. Verificar que `interceptedUrls` incluye entrada con `/v1/storage/buckets/${STO_BUCKET_ID}/objects`.

**RF**: RF-UI-020 | **SC**: SC-001, SC-002, SC-003

#### J05-T2 — Empty state: sin buckets

**Setup**: `installContextAuthMocks(page, 'multi_tenant_nominal')` + `installStorageMocks(page, 'empty')`.

**Pasos**:
1. Login + tenant + workspace.
2. `await page.goto('/console/storage')`.
3. `await expect(page.getByText('No hay buckets en el workspace seleccionado.')).toBeVisible()`.

**SC**: SC-005

#### J05-T3 — Error de API: listado de buckets

**Setup**: `installContextAuthMocks(page, 'multi_tenant_nominal')` + `installStorageMocks(page, 'error')`.

**Pasos**:
1. Login + tenant + workspace.
2. `await page.goto('/console/storage')`.
3. `await expect(page.getByRole('alert').first()).toBeVisible()`.
4. `await expect(page.getByRole('button', { name: /reintentar/i }).first()).toBeVisible()`.

**SC**: SC-006

---

### Grupo J06 — Verificación transversal de ausencia de backdoors

#### J06-T1 — Ningún journey llama a endpoints fuera del allowlist

**Setup**: `installContextAuthMocks(page, 'multi_tenant_nominal')` + los cinco `installXxxMocks(page, 'nominal')` + handler de registro de URLs ACUMULATIVO para los cinco dominios.

**Descripción**: Ejecutar los cinco journeys nominales en secuencia dentro del mismo test, acumulando todas las URLs interceptadas en un único array, y aplicar `assertPublicApiOnly` al final.

**Pasos**:
1. Instalar todos los mocks (context + cinco servicios).
2. Instalar handler de registro acumulativo.
3. Login + tenant + workspace.
4. Ejecutar journey PostgreSQL mínimo (navegar a `/console/postgres`, esperar heading).
5. Ejecutar journey MongoDB mínimo (navegar a `/console/mongo`, esperar heading).
6. Ejecutar journey Kafka mínimo (navegar a `/console/kafka`, esperar heading).
7. Ejecutar journey Functions mínimo (navegar a `/console/functions`, esperar heading).
8. Ejecutar journey Storage mínimo (navegar a `/console/storage`, esperar heading).
9. `assertPublicApiOnly(allInterceptedUrls, 'transversal')` — debe pasar sin errores.
10. Verificar que `allInterceptedUrls.length > 0` (la suite realmente capturó URLs).

**Nota de fallo esperado**: si alguna vista llama a un endpoint fuera del allowlist, `assertPublicApiOnly` lanza un error que Playwright captura como fallo de test con el mensaje: `"URL fuera de la API pública detectada en journey transversal: <url>"`.

**SC**: SC-004

---

## Secuencia de implementación recomendada

1. Crear `e2e/fixtures/service-e2e.ts` completo con todos los tipos, constantes y funciones.
2. Verificar typecheck: `corepack pnpm --filter @in-falcone/web-console typecheck`.
3. Crear `e2e/console-service-e2e.e2e.ts` con helpers locales y Grupo J01.
4. Ejecutar `corepack pnpm --filter @in-falcone/web-console test:e2e -- --grep "J01"` para validar.
5. Añadir Grupo J02. Ejecutar `--grep "J02"`.
6. Añadir Grupo J03. Ejecutar `--grep "J03"`. Verificar si el componente Kafka activa SSE automáticamente; si lo hace, confirmar que el mock de stream devuelve `text/event-stream` vacío.
7. Añadir Grupo J04. Ejecutar `--grep "J04"`.
8. Añadir Grupo J05. Ejecutar `--grep "J05"`.
9. Añadir Grupo J06. Ejecutar suite completa.
10. Ejecutar validaciones completas: `test`, `typecheck`, `build`, `test:e2e`, `lint`.

---

## Criterios de done

| Criterio | Verificación |
|---|---|
| Existen los dos archivos nuevos en `e2e/` | `ls apps/web-console/e2e/console-service-e2e.e2e.ts apps/web-console/e2e/fixtures/service-e2e.ts` |
| Al menos 16 escenarios (3×5 + J01-T4 + J06-T1) | Salida de `test:e2e` muestra ≥ 16 tests passed |
| Cada journey nominal verifica heading, listado y API pública | Código del spec contiene `assertPublicApiOnly` en J01-T1 a J05-T1 |
| Verificación transversal J06-T1 existe | Código del spec contiene el test J06-T1 |
| Escenarios empty state y error para cada servicio | 5 × T2 + 5 × T3 presentes en el spec |
| No se modificó ningún archivo fuera de `e2e/` | `git diff --name-only` solo muestra los dos archivos nuevos |
| `test`, `typecheck`, `build`, `test:e2e`, `lint` pasan en verde | Salida de cada comando sin errores |

---

## Trazabilidad RF

| Escenario | RF | SC |
|---|---|---|
| J01-T1 PostgreSQL nominal | RF-UI-016, FR-001, FR-002, FR-003 | SC-001, SC-002, SC-003 |
| J02-T1 MongoDB nominal | RF-UI-017, FR-001, FR-002, FR-003 | SC-001, SC-002, SC-003 |
| J03-T1 Kafka nominal | RF-UI-018, FR-001, FR-002, FR-003 | SC-001, SC-002, SC-003 |
| J04-T1 Functions nominal | RF-UI-019, FR-001, FR-002, FR-003 | SC-001, SC-002, SC-003 |
| J05-T1 Storage nominal | RF-UI-020, FR-001, FR-002, FR-003 | SC-001, SC-002, SC-003 |
| J01-T2 … J05-T2 (empty states) | FR-006 | SC-005 |
| J01-T3 … J05-T3 (error states) | FR-007 | SC-006 |
| J01-T4 (sin tenant) | FR-008 | SC-007 |
| J06-T1 (transversal) | FR-004 | SC-004 |
