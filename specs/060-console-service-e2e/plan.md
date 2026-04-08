<!-- markdownlint-disable MD031 MD040 -->
# Plan técnico de implementación — US-UI-03-T06

**Feature Branch**: `060-console-service-e2e`
**Task ID**: US-UI-03-T06
**Epic**: EP-15 — Consola de administración: dominios funcionales
**Historia padre**: US-UI-03 — Consola de gestión de PostgreSQL, MongoDB, Kafka, Functions y Storage
**Fecha del plan**: 2026-03-29
**Estado**: Ready for tasks

---

## 1. Objetivo y alcance estricto de T06

Entregar una suite E2E por servicio que, desde el navegador, valide los journeys administrativos principales de las cinco vistas de servicio entregadas en T01–T05 (PostgreSQL, MongoDB, Kafka, Functions, Storage) y confirme de forma automatizada que todas las peticiones de red se dirigen a los endpoints públicos documentados del BaaS.

La suite debe:

- cubrir al menos **listado de recursos + exploración de un nivel de detalle** por servicio;
- **interceptar y verificar** que las URLs de red pertenecen a las familias de API pública de cada dominio;
- incluir un escenario de **empty state** y otro de **error de API** por servicio;
- incluir al menos un escenario de **acceso denegado** transversal;
- incluir una **verificación transversal de ausencia de backdoors** tras los cinco journeys;
- ejecutarse con el comando ya existente `corepack pnpm --filter @in-falcone/web-console test:e2e`.

### Fuera del alcance de T06

- Journeys de login/logout/signup: ya cubiertos en `048-console-auth-e2e-flows`.
- Journeys de contexto tenant/workspace: ya cubiertos en `052-console-auth-iam-views`.
- Operaciones de escritura destructivas (DROP, DELETE de recursos de producción).
- Integración contra servicios reales (no se usan PostgreSQL, MongoDB, Kafka, OpenWhisk ni S3 reales).
- Validación formal de contratos API (no se inspecciona shape de respuesta completo, solo que la URL es la esperada).
- Cobertura de vistas de métricas, alertas u observabilidad de la consola.

---

## 2. Estado actual relevante del repositorio

### Baseline entregado por T01–T05

`apps/web-console/src/pages/` ya incluye las cinco páginas operativas:

| Página | Ruta de consola | Familias de API públicas consumidas |
|---|---|---|
| `ConsolePostgresPage.tsx` | `/console/postgres` | `/v1/postgres/databases`, `/v1/postgres/databases/:db/schemas`, `/v1/postgres/databases/:db/schemas/:schema/tables`, y sub-recursos |
| `ConsoleMongoPage.tsx` | `/console/mongo` | `/v1/mongo/databases`, `/v1/mongo/databases/:db/collections`, `/v1/mongo/databases/:db/views`, `/v1/mongo/workspaces/:wid/data/:db/collections/:col/documents` |
| `ConsoleKafkaPage.tsx` | `/console/kafka` | `/v1/events/workspaces/:wid/inventory`, `/v1/events/topics/:id`, `/v1/events/topics/:id/access`, `/v1/events/topics/:id/metadata`, `/v1/events/topics/:id/publish`, `/v1/events/topics/:id/stream`, `/v1/events/workspaces/:wid/bridges/:id` |
| `ConsoleFunctionsPage.tsx` | `/console/functions` | `/v1/functions/workspaces/:wid/inventory`, `/v1/functions/workspaces/:wid/actions`, `/v1/functions/actions/:id`, `/v1/functions/actions/:id/versions`, `/v1/functions/actions/:id/activations`, `/v1/functions/actions/:id/invocations`, `/v1/functions/actions`, `/v1/functions/actions/:id/rollback` |
| `ConsoleStoragePage.tsx` | `/console/storage` | `/v1/storage/buckets`, `/v1/storage/workspaces/:wid/usage`, `/v1/storage/buckets/:id/objects`, `/v1/storage/buckets/:id/objects/:key/metadata` |

### Infraestructura E2E ya instalada (herencia de 048 y 052)

- `@playwright/test` ya está instalado en `apps/web-console/package.json`.
- `playwright.config.ts` ya existe con `testDir: './e2e'`, `testMatch: ['**/*.e2e.ts']`, `webServer` que lanza `build && vite preview`, y proyecto `chromium`.
- Script `test:e2e` ya existe en `package.json`.
- Fixture `e2e/fixtures/context-auth-e2e.ts` ya provee helpers de autenticación simulada y carga de contexto (tenant/workspace) reutilizables.

### Huecos que cubre T06

No existe todavía ningún spec que ejercite las vistas de los cinco servicios desde el navegador ni que verifique el consumo de la API pública vía interceptación de red.

---

## 3. Decisiones técnicas

| Decisión | Elección | Justificación |
|---|---|---|
| Spec nuevo | `apps/web-console/e2e/console-service-e2e.e2e.ts` | Aislamiento claro de journeys de servicio vs. journeys de auth/contexto ya existentes. |
| Fixture de mocks de servicio | `apps/web-console/e2e/fixtures/service-e2e.ts` | Reutilizable por los cinco grupos de tests; sigue el mismo patrón de `context-auth-e2e.ts`. |
| Autenticación en la suite | Reutilizar `installContextAuthMocks` + helpers `loginToConsole`/`selectTenant`/`selectWorkspace` ya definidos en `console-context-auth-e2e.e2e.ts` | Elimina duplicación; los mocks auth ya son estables y probados. |
| Mock de API de servicio | `page.route('**/v1/<dominio>/**')` por servicio | Intercepta todas las peticiones del dominio; hace la suite determinista y desacoplada de infraestructura real. |
| Verificación de API pública | Registro acumulado de URLs interceptadas durante cada journey; aserción transversal al final contra allowlist de prefijos | Detecta backdoors sin depender de lógica dentro de los componentes. |
| Allowlist de API pública | Configuración centralizada en la fixture: `/v1/postgres/`, `/v1/mongo/`, `/v1/events/`, `/v1/functions/`, `/v1/storage/`, `/v1/auth/` | Actualizable sin modificar los specs. |
| Selectores | Roles ARIA, headings, `aria-label` de tablas, textos visibles ya presentes en las páginas entregadas | Minimiza acoplamiento a detalles de implementación. |

---

## 4. API pública allowlist por dominio

La suite verifica que **todas** las peticiones de red durante cada journey pertenecen a uno de los prefijos siguientes. Cualquier URL fuera de este conjunto falla el test con mensaje identificativo.

```typescript
const PUBLIC_API_PREFIXES = [
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

Nota: `/v1/tenants` y `/v1/workspaces` cubren las llamadas del shell de contexto (tenant selector, workspace selector) que las páginas de servicio disparan al cambiar de contexto.

---

## 5. Arquitectura objetivo

```text
Playwright test runner (Chromium)
  ├─► arranca `vite preview` para apps/web-console (ya configurado)
  ├─► installServiceMocks(page, service) — intercepta /v1/<dominio>/**
  │     devuelve fixtures controladas (nominal / vacío / error)
  ├─► installContextAuthMocks(page, 'multi_tenant_nominal') — reusa 052 fixture
  ├─► loginToConsole(page) → selectTenant → selectWorkspace
  ├─► navega a /console/<service>
  ├─► verifica heading + listado de recursos (aserción visible)
  ├─► interactúa para abrir un nivel de detalle
  ├─► verifica rendering de detalle (aserción visible)
  ├─► verifica que TODAS las URLs interceptadas ∈ PUBLIC_API_PREFIXES
  └─► (escenario de error) verifica alerta + botón de reintento visibles

Verificación transversal:
  ├─► ejecuta los cinco journeys nominales en secuencia
  └─► aserción final sobre el log agregado de URLs → sin violaciones
```

### Flujo de interceptación y registro

```typescript
const interceptedUrls: string[] = []

await page.route('**/*', async (route) => {
  const url = new URL(route.request().url())
  if (url.pathname.startsWith('/v1/')) {
    interceptedUrls.push(url.pathname)
  }
  // delegar al handler específico del servicio
})
```

---

## 6. Cambios propuestos por artefacto o carpeta

### 6.1 `apps/web-console/e2e/fixtures/service-e2e.ts` _(crear)_

Fixture que exporta:

```typescript
// Tipos y constantes de datos de prueba por servicio
export const pgFixtures: PgServiceFixtures     // bases, esquemas, tablas
export const mongoFixtures: MongoServiceFixtures  // bases, colecciones, índices, docs
export const kafkaFixtures: KafkaServiceFixtures  // inventory, topic detail
export const functionsFixtures: FunctionsServiceFixtures  // inventory, action detail, activations
export const storageFixtures: StorageServiceFixtures  // buckets, objetos, usage

// Instaladores de mocks por servicio
export async function installPgMocks(page: Page, scenario: 'nominal' | 'empty' | 'error'): Promise<void>
export async function installMongoMocks(page: Page, scenario: 'nominal' | 'empty' | 'error'): Promise<void>
export async function installKafkaMocks(page: Page, scenario: 'nominal' | 'empty' | 'error'): Promise<void>
export async function installFunctionsMocks(page: Page, scenario: 'nominal' | 'empty' | 'error'): Promise<void>
export async function installStorageMocks(page: Page, scenario: 'nominal' | 'empty' | 'error'): Promise<void>

// Verificador de allowlist
export function assertPublicApiOnly(urls: string[], serviceName: string): void
```

### 6.2 `apps/web-console/e2e/console-service-e2e.e2e.ts` _(crear)_

Spec principal con seis grupos `test.describe`:

1. `J01 — PostgreSQL: listado y exploración de esquemas/tablas`
2. `J02 — MongoDB: listado y exploración de colecciones`
3. `J03 — Kafka: topics y estado de salud`
4. `J04 — Functions: listado, estado y activations`
5. `J05 — Storage: buckets, objetos y uso`
6. `J06 — Verificación transversal de ausencia de backdoors`

Cada grupo contiene:
- `T1` — journey nominal (listado + detalle + aserción de API pública)
- `T2` — empty state (sin recursos → mensaje coherente + sin error)
- `T3` — error de API (4xx/5xx → alerta visible + botón reintentar)
- `T4` (solo J06) — aserción transversal sobre log agregado de URLs

Adicionalmente, uno de los grupos incluye:
- `T4/T5` — acceso denegado (usuario sin contexto de tenant → vista muestra estado vacío en lugar de datos)

### 6.3 Sin cambios en otros artefactos

No se modifica ningún archivo fuera de `apps/web-console/e2e/`. No se modifica `package.json`, `playwright.config.ts`, código fuente, tests unitarios ni archivos de configuración de Vite, TypeScript o Tailwind.

---

## 7. Shapes de fixtures de prueba

### 7.1 PostgreSQL (`/v1/postgres/`)

**GET `/v1/postgres/databases`** — nominal:
```json
{
  "items": [
    {
      "databaseName": "ws_alpha_prod_db",
      "state": "active",
      "ownerRoleName": "ws_alpha_owner",
      "placementMode": "dedicated",
      "tenantId": "tenant_001",
      "workspaceId": "workspace_ops"
    }
  ],
  "page": { "total": 1 }
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
      "objectCounts": { "tables": 3, "views": 1, "materializedViews": 0, "indexes": 4 }
    }
  ],
  "page": { "total": 1 }
}
```

**GET `/v1/postgres/databases/ws_alpha_prod_db/schemas/public/tables`** — nominal:
```json
{
  "items": [
    { "tableName": "users", "state": "active", "columnCount": 5 },
    { "tableName": "orders", "state": "active", "columnCount": 8 }
  ],
  "page": { "total": 2 }
}
```

Resto de endpoints (`/columns`, `/indexes`, `/policies`, `/security`, `/views`, `/materialized-views`) devuelven colecciones vacías en escenario nominal del journey principal para mantener el journey acotado.

### 7.2 MongoDB (`/v1/mongo/`)

**GET `/v1/mongo/databases`** — nominal:
```json
{
  "items": [
    {
      "databaseName": "ws_alpha_events",
      "stats": { "dataSize": 1048576, "storageSize": 2097152, "collections": 2, "indexes": 3 }
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

**GET `/v1/mongo/databases/ws_alpha_events/collections/audit_logs/indexes`** — nominal (un índice adicional al `_id_`):
```json
{
  "items": [
    { "indexName": "_id_", "indexType": "single", "unique": false },
    {
      "indexName": "created_at_1",
      "keys": [{ "fieldName": "created_at", "direction": 1 }],
      "indexType": "single",
      "unique": false
    }
  ]
}
```

**GET `/v1/mongo/databases/ws_alpha_events/views`** — vacío.

**GET `/v1/mongo/workspaces/workspace_ops/data/ws_alpha_events/collections/audit_logs/documents`** — nominal (tres documentos mínimos para verificar scroll):
```json
{
  "items": [
    { "_id": "doc_001", "event": "login", "userId": "usr_ops_001" },
    { "_id": "doc_002", "event": "create_db", "userId": "usr_ops_001" },
    { "_id": "doc_003", "event": "logout", "userId": "usr_ops_001" }
  ],
  "page": { "after": null, "size": 3 }
}
```

### 7.3 Kafka (`/v1/events/`)

**GET `/v1/events/workspaces/workspace_ops/inventory`** — nominal:
```json
{
  "topics": [
    {
      "topicId": "topic_audit_001",
      "topicName": "platform.audit.events",
      "state": "active",
      "partitions": 3,
      "replicationFactor": 1
    }
  ],
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
  "policies": [
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

### 7.4 Functions (`/v1/functions/`)

**GET `/v1/functions/workspaces/workspace_ops/inventory`** — nominal:
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

**GET `/v1/functions/actions/fn_hello_world/versions`** — nominal (lista con una entrada).

### 7.5 Storage (`/v1/storage/`)

**GET `/v1/storage/buckets`** — nominal:
```json
{
  "items": [
    {
      "bucketId": "bucket_alpha_assets",
      "bucketName": "alpha-assets",
      "region": "eu-west-1",
      "state": "active",
      "versioning": false
    }
  ],
  "page": { "total": 1 }
}
```

**GET `/v1/storage/workspaces/workspace_ops/usage`** — nominal:
```json
{
  "workspaceId": "workspace_ops",
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

---

## 8. Escenarios E2E por grupo

### Grupo J01 — PostgreSQL

#### J01-T1 — Listado de bases y exploración de esquemas/tablas (nominal)

```
Precondiciones: sesión activa, tenant "Alpha Corp", workspace "Production",
mocks pg nominal instalados

1. navegar a /console/postgres
2. verificar heading "Inventario relacional del tenant activo" visible
3. verificar tabla "Listado de bases de datos PostgreSQL" contiene "ws_alpha_prod_db"
4. hacer clic en la fila "ws_alpha_prod_db"
5. verificar heading "Esquemas de ws_alpha_prod_db" visible
6. verificar tabla "Listado de esquemas PostgreSQL" contiene "public"
7. hacer clic en "public"
8. verificar panel de detalle de esquema visible con tab "Tablas"
9. verificar tabla "Listado de tablas" contiene "users"
10. ASSERT: todas las URLs interceptadas ∈ PUBLIC_API_PREFIXES
11. ASSERT: se llamó a /v1/postgres/databases
12. ASSERT: se llamó a /v1/postgres/databases/ws_alpha_prod_db/schemas
```

#### J01-T2 — Empty state sin bases de datos

```
Mocks pg 'empty': GET /v1/postgres/databases → { items: [] }

1. navegar a /console/postgres con tenant/workspace activos
2. verificar que aparece el mensaje "No hay bases de datos disponibles para este tenant."
3. ASSERT: no se renderiza ninguna tabla de bases
4. ASSERT: no se muestra ningún error 5xx ni spinner infinito
```

#### J01-T3 — Error de API en listado de bases

```
Mocks pg 'error': GET /v1/postgres/databases → 503

1. navegar a /console/postgres con tenant/workspace activos
2. verificar que se muestra role="alert" con mensaje de error
3. verificar botón "Reintentar" visible
4. ASSERT: no se muestran datos parciales de bases de datos
```

#### J01-T4 — Acceso denegado (sin tenant seleccionado)

```
1. navegar a /console/postgres sin tenant activo (solo login)
2. verificar que la vista muestra "Selecciona un tenant para explorar las bases de datos PostgreSQL."
3. ASSERT: no se realizan llamadas a /v1/postgres/**
```

---

### Grupo J02 — MongoDB

#### J02-T1 — Listado de bases y exploración de colecciones (nominal)

```
Mocks mongo nominal

1. navegar a /console/mongo con tenant/workspace activos
2. verificar heading "Inventario documental del tenant activo"
3. verificar tabla contiene "ws_alpha_events"
4. hacer clic en "ws_alpha_events"
5. verificar panel de colecciones con "audit_logs"
6. hacer clic en "audit_logs"
7. verificar detalle de colección visible con tab "Índices"
8. verificar que la tabla de índices contiene "created_at_1"
9. ASSERT: URLs ∈ PUBLIC_API_PREFIXES
10. ASSERT: llamadas a /v1/mongo/databases, /v1/mongo/databases/ws_alpha_events/collections
```

#### J02-T2 — Empty state sin bases MongoDB

```
GET /v1/mongo/databases → { items: [] }
→ mensaje "No hay bases de datos MongoDB disponibles para este tenant."
```

#### J02-T3 — Error de API en listado MongoDB

```
GET /v1/mongo/databases → 503
→ role="alert" + botón "Reintentar"
```

---

### Grupo J03 — Kafka

#### J03-T1 — Listado de topics y estado de salud (nominal)

```
Mocks kafka nominal

1. navegar a /console/kafka con tenant/workspace activos
2. verificar heading Kafka visible (heading que la página renderiza)
3. verificar que "platform.audit.events" aparece en el listado de topics
4. seleccionar el topic
5. verificar panel de detalle con metadata visible (health "healthy" o particiones)
6. ASSERT: URLs ∈ PUBLIC_API_PREFIXES
7. ASSERT: llamada a /v1/events/workspaces/workspace_ops/inventory
```

#### J03-T2 — Empty state sin topics

```
GET /v1/events/workspaces/workspace_ops/inventory → { topics: [], bridges: [] }
→ mensaje de estado vacío visible, sin error
```

#### J03-T3 — Error de API en inventory Kafka

```
GET /v1/events/workspaces/workspace_ops/inventory → 503
→ role="alert" + botón de reintento visible
```

---

### Grupo J04 — Functions

#### J04-T1 — Listado de funciones y activations (nominal)

```
Mocks functions nominal

1. navegar a /console/functions con tenant/workspace activos
2. verificar heading Functions visible
3. verificar que "hello-world" aparece en la lista de funciones
4. seleccionar "hello-world"
5. verificar panel de detalle con activations visible
6. verificar que la activation "act_001" aparece en el listado
7. ASSERT: URLs ∈ PUBLIC_API_PREFIXES
8. ASSERT: llamada a /v1/functions/workspaces/workspace_ops/inventory (o /actions fallback)
```

#### J04-T2 — Empty state sin funciones

```
GET inventory → { actions: [] }
→ estado vacío coherente, sin error
```

#### J04-T3 — Error en carga de funciones

```
GET inventory → 503
→ role="alert" + botón de reintento
```

---

### Grupo J05 — Storage

#### J05-T1 — Listado de buckets y exploración de objetos (nominal)

```
Mocks storage nominal

1. navegar a /console/storage con tenant/workspace activos
2. verificar heading Storage visible
3. verificar que "alpha-assets" aparece en el listado de buckets
4. seleccionar "alpha-assets"
5. verificar panel de objetos con "images/logo.png"
6. ASSERT: URLs ∈ PUBLIC_API_PREFIXES
7. ASSERT: llamada a /v1/storage/buckets
8. ASSERT: llamada a /v1/storage/buckets/bucket_alpha_assets/objects
```

#### J05-T2 — Empty state sin buckets

```
GET /v1/storage/buckets → { items: [] }
→ estado vacío coherente
```

#### J05-T3 — Error de API en listado de buckets

```
GET /v1/storage/buckets → 503
→ role="alert" + botón de reintento
```

---

### Grupo J06 — Verificación transversal de ausencia de backdoors

#### J06-T1 — Ningún journey llama a endpoints fuera de la allowlist

```
Prerrequisito: journeys J01-T1, J02-T1, J03-T1, J04-T1, J05-T1 han ejecutado
con registro de URLs activado

1. Recolectar el log agregado de todas las URLs interceptadas
2. Para cada URL: verificar que empieza por uno de los PUBLIC_API_PREFIXES
3. Si alguna URL viola el allowlist: FAIL con mensaje:
   "URL fuera de la API pública detectada en journey <servicio>: <url>"
```

---

## 9. Estrategia de pruebas

### Suite E2E nueva

Todos los escenarios son E2E de navegador con Playwright/Chromium. No se introducen tests unitarios ni de integración adicionales en esta tarea.

**Cobertura por escenario → RF trazado**:

| Escenario | RF cubierto | SC cubierto |
|---|---|---|
| J01-T1 PostgreSQL nominal | RF-UI-016, FR-001, FR-002, FR-003 | SC-001, SC-002, SC-003 |
| J02-T1 MongoDB nominal | RF-UI-017, FR-001, FR-002, FR-003 | SC-001, SC-002, SC-003 |
| J03-T1 Kafka nominal | RF-UI-018, FR-001, FR-002, FR-003 | SC-001, SC-002, SC-003 |
| J04-T1 Functions nominal | RF-UI-019, FR-001, FR-002, FR-003 | SC-001, SC-002, SC-003 |
| J05-T1 Storage nominal | RF-UI-020, FR-001, FR-002, FR-003 | SC-001, SC-002, SC-003 |
| J01-T2…J05-T2 (empty states) | FR-006 | SC-005 |
| J01-T3…J05-T3 (error states) | FR-007 | SC-006 |
| J01-T4 (sin tenant) | FR-008 | SC-007 |
| J06-T1 (transversal) | FR-004 | SC-004 |

### Validaciones del paquete antes del PR

```bash
corepack pnpm --filter @in-falcone/web-console test
corepack pnpm --filter @in-falcone/web-console typecheck
corepack pnpm --filter @in-falcone/web-console build
corepack pnpm --filter @in-falcone/web-console test:e2e
corepack pnpm lint
```

---

## 10. Riesgos, compatibilidad y rollback

### Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| **Flakiness por timing de render** en páginas con múltiples llamadas paralelas | Media | Usar `await expect(locator).toBeVisible()` con timeout Playwright en lugar de `page.waitForTimeout` |
| **Acoplamiento a textos hardcoded** de las páginas T01–T05 | Media | Usar `aria-label` y roles ARIA ya presentes en las páginas en lugar de texto libre; solo usar texto visible para headings de primer nivel que son muy estables |
| **Rutas de API desalineadas** respecto a lo que T01–T05 realmente llaman | Baja | Las rutas se extraen directamente del código de cada `ConsoleXxxPage.tsx` ya entregado; cualquier cambio en T01–T05 afectaría también los mocks y se detectaría en la siguiente ejecución |
| **Página Kafka con stream SSE** (usa `fetch` directo, no XHR) | Baja-Media | El journey nominal no activa el stream; si el componente arranca una suscripción SSE automáticamente, se añade un mock de `**/v1/events/topics/**/stream` que devuelve vacío con `text/event-stream` |
| **Lentitud de la suite** por cinco journeys secuenciales | Baja | `workers: 1` ya está configurado; la suite usa fixtures compactas y navega a rutas directas sin flujos de login complejos reutilizando la sesión |
| **Cambios en T01–T05 post-merge** que rompan selectores | Baja | Al priorizar roles ARIA y `aria-label` de tablas ya definidos, la superficie frágil es mínima |

### Compatibilidad

- No se modifica ningún contrato backend.
- No se modifican las páginas de servicio T01–T05.
- No se modifica `playwright.config.ts` (el `testMatch: ['**/*.e2e.ts']` ya recoge el nuevo archivo).
- No se modifica `package.json` (la dependencia `@playwright/test` y el script `test:e2e` ya existen).

### Rollback

La entrega es 100% en la capa de tests E2E. Si fuera necesario revertir:
- eliminar `e2e/console-service-e2e.e2e.ts`
- eliminar `e2e/fixtures/service-e2e.ts`

Sin impacto en datos, APIs, configuración de servicios ni código de producción.

---

## 11. Secuencia recomendada de implementación

1. **Crear fixture `service-e2e.ts`**: definir tipos, constantes de datos nominales/vacíos, funciones `installXxxMocks` por servicio y `assertPublicApiOnly`. Verificar typecheck del paquete.
2. **Implementar Grupo J01 (PostgreSQL)**: T1 nominal, T2 empty, T3 error, T4 sin tenant. Ejecutar `test:e2e --grep J01` para validar.
3. **Implementar Grupo J02 (MongoDB)**: T1–T3. Ejecutar con `--grep J02`.
4. **Implementar Grupo J03 (Kafka)**: T1–T3. Ejecutar con `--grep J03`. Añadir mock de SSE si el componente lo requiere.
5. **Implementar Grupo J04 (Functions)**: T1–T3. Ejecutar con `--grep J04`.
6. **Implementar Grupo J05 (Storage)**: T1–T3. Ejecutar con `--grep J05`.
7. **Implementar Grupo J06 (transversal)**: T1 con log agregado. Ejecutar suite completa.
8. **Ejecutar validaciones completas del paquete**: `test`, `typecheck`, `build`, `test:e2e`, `lint`.
9. Preparar commit, push, PR, monitorización de CI y merge.

La implementación por grupos permite detectar problemas de selectores o mocks por servicio antes de avanzar al siguiente.

---

## 12. Criterios de done y evidencia esperada

### Done verificable

- Existe `apps/web-console/e2e/console-service-e2e.e2e.ts` con al menos 16 escenarios (3 por servicio + J01-T4 de acceso denegado + J06-T1 transversal).
- Existe `apps/web-console/e2e/fixtures/service-e2e.ts` con mocks deterministas para los cinco dominios.
- Cada journey nominal verifica heading principal, listado de recursos y al menos un nivel de detalle.
- Cada journey nominal incluye aserción explícita de que todas las URLs pertenecen al allowlist de API pública.
- La verificación transversal J06-T1 agrega el log de los cinco journeys y falla con mensaje claro si detecta una URL fuera del allowlist.
- Existen escenarios de empty state y error de API para cada servicio.
- La suite no depende de infraestructura real (PostgreSQL, MongoDB, Kafka, OpenWhisk, S3).
- `test`, `typecheck`, `build`, `test:e2e` y `lint` del paquete pasan en verde sin modificar código fuera de `e2e/`.

### Evidencia esperada

- Diff acotado a `apps/web-console/e2e/` (dos archivos nuevos, ningún otro cambio).
- Salida verde de Playwright con al menos 16 tests pasados en Chromium.
- Salida verde de Vitest, typecheck, Vite build y ESLint.
- Commit en la rama `060-console-service-e2e` listo para PR y merge.
