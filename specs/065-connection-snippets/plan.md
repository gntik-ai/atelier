# Plan técnico — Connection Snippets and Usage Examples

**Feature slug**: `065-connection-snippets`
**Task ID**: US-UI-04-T05
**Spec de referencia**: `specs/065-connection-snippets/spec.md`
**Rama**: `spec/065-connection-snippets`
**Fecha**: 2026-03-29

---

## 1. Objetivo del plan

Implementar la capacidad de **snippets de conexión** en la consola de administración web (`apps/web-console`). Los snippets se generan en el frontend a partir de datos ya disponibles en las vistas de detalle de recursos, sin llamadas adicionales al backend. Deben cubrirse 5 tipos de recurso: PostgreSQL database, MongoDB collection, Storage bucket, Función serverless (OpenWhisk) y Client IAM (Keycloak).

---

## 2. Arquitectura y flujo objetivo

```text
apps/web-console/src/
  lib/
    snippets/
      snippet-catalog.ts        ← Catálogo puro de plantillas por tipo de recurso
      snippet-generator.ts      ← Función de generación a partir de contexto + datos de recurso
      snippet-types.ts          ← Tipos compartidos (SnippetEntry, SnippetContext, ResourceType)
  components/console/
    ConnectionSnippets.tsx      ← Componente de sección (lista de snippets + botón copiar)
    ConnectionSnippets.test.tsx ← Tests unitarios del componente
  pages/
    ConsolePostgresPage.tsx     ← Integra <ConnectionSnippets> en detalle de database
    ConsoleMongoPage.tsx        ← Integra <ConnectionSnippets> en detalle de collection
    ConsoleStoragePage.tsx      ← Integra <ConnectionSnippets> en detalle de bucket
    ConsoleFunctionsPage.tsx    ← Integra <ConnectionSnippets> en detalle de función
    ConsoleAuthPage.tsx         ← Integra <ConnectionSnippets> en detalle de client IAM
```

### Flujo de datos

1. El usuario navega al detalle de un recurso en cualquier page existente.
2. La page ya tiene los datos del recurso en estado React local (`SectionState<T>`).
3. La page construye un objeto `SnippetContext` a partir de los datos disponibles (host, port, name, tenant, workspace).
4. Pasa el `SnippetContext` y `resourceType` al componente `<ConnectionSnippets>`.
5. `ConnectionSnippets` llama a `generateSnippets(resourceType, context)` de `snippet-generator.ts`, que consulta el catálogo y sustituye los placeholders con los valores reales.
6. Si no hay snippets para el tipo, el componente no se renderiza.
7. El usuario interactúa con el botón "Copiar"; el componente gestiona el estado de feedback visual (2–3 s) usando `useState` + `setTimeout`.

### Límites entre componentes

- `snippet-types.ts` → solo tipos, sin lógica.
- `snippet-catalog.ts` → solo datos estructurados (plantillas por tipo de recurso). Extensible sin tocar lógica.
- `snippet-generator.ts` → aplica plantillas del catálogo al contexto. Sin side effects.
- `ConnectionSnippets.tsx` → UI pura: recibe snippets ya generados, gestiona clipboard y feedback visual.
- Las pages integran el componente con datos de su propio estado, sin nueva API.

---

## 3. Artefactos a crear o modificar

### 3.1 Nuevos artefactos

#### `apps/web-console/src/lib/snippets/snippet-types.ts`

```typescript
export type ResourceType =
  | 'postgres-database'
  | 'mongo-collection'
  | 'storage-bucket'
  | 'serverless-function'
  | 'iam-client'

export interface SnippetContext {
  tenantId: string | null
  tenantSlug: string | null
  workspaceId: string | null
  workspaceSlug: string | null
  resourceName: string | null       // databaseName / collectionName / bucketName / actionName / clientId
  resourceHost: string | null       // hostname or endpoint base URL
  resourcePort: number | null       // port when applicable
  resourceExtraA: string | null     // uso específico por tipo: schemaName (PG), databaseName (Mongo), region (S3), etc.
  resourceExtraB: string | null     // uso adicional: httpPublicUrl (function), tokenEndpoint (IAM), etc.
  resourceState: string | null      // provisioning state del recurso
  externalAccessEnabled: boolean    // false → nota de advertencia en snippets
}

export interface SnippetEntry {
  id: string
  label: string                     // e.g. "Node.js — pg"
  code: string                      // bloque de código final
  notes: string[]                   // notas contextuales (idioma consola, código en inglés)
  hasPlaceholderSecrets: boolean
  secretPlaceholderRef: string | null  // texto de referencia a sección de consola
}

export interface SnippetGroup {
  resourceType: ResourceType
  entries: SnippetEntry[]
}
```

#### `apps/web-console/src/lib/snippets/snippet-catalog.ts`

Define un tipo `SnippetTemplate` con campos parametrizados (`{HOST}`, `{PORT}`, `{DB_NAME}`, `{SCHEMA}`, `{PASSWORD}`, etc.) para cada lenguaje/herramienta por tipo de recurso. Exporta un `Map<ResourceType, SnippetTemplate[]>` o equivalente objeto `SNIPPET_CATALOG`.

Plantillas mínimas por tipo:

| Tipo | Templates |
|---|---|
| `postgres-database` | `postgresql://` URI, Node.js `pg`, Python `psycopg2`, cURL (si REST) |
| `mongo-collection` | `mongodb://` URI, Node.js `mongoose`, Python `pymongo` |
| `storage-bucket` | AWS CLI `aws s3`, Node.js `@aws-sdk/client-s3`, Python `boto3`, cURL (presigned) |
| `serverless-function` | cURL, Node.js `fetch`, Python `requests` |
| `iam-client` | cURL token endpoint, `client_credentials` grant |

Los **secretos** se sustituyen con placeholders tipados (`<YOUR_DB_PASSWORD>`, `<CLIENT_SECRET>`, etc.) y una `secretPlaceholderRef` fija por tipo de recurso.

**Regla de extensibilidad**: añadir un nuevo template = añadir una entrada al catálogo. La función generadora no cambia.

#### `apps/web-console/src/lib/snippets/snippet-generator.ts`

```typescript
export function generateSnippets(
  resourceType: ResourceType,
  context: SnippetContext
): SnippetEntry[]
```

- Consulta `SNIPPET_CATALOG[resourceType]`.
- Si no existe → devuelve `[]`.
- Por cada template, sustituye tokens en el código con los valores de `context`. Si un valor es `null`, usa un placeholder genérico descriptivo.
- Evalúa `context.externalAccessEnabled` → si `false`, añade nota de advertencia al campo `notes`.
- Evalúa `context.resourceState` → si estado transitorio (`provisioning`, `error`, `degraded`), añade nota de advertencia.
- Devuelve array de `SnippetEntry[]`.

#### `apps/web-console/src/components/console/ConnectionSnippets.tsx`

Props:

```typescript
interface ConnectionSnippetsProps {
  resourceType: ResourceType
  context: SnippetContext
}
```

- Calcula `entries = useMemo(() => generateSnippets(resourceType, context), [resourceType, context])`.
- Si `entries.length === 0` → retorna `null` (no renderiza la sección).
- Renderiza sección con heading "Snippets de conexión", lista de `SnippetEntry`.
- Cada entry: título + `<pre><code>` + botón "Copiar".
- El botón "Copiar" llama a `navigator.clipboard.writeText()`. Si la API no está disponible (`typeof navigator.clipboard === 'undefined'`), muestra mensaje alternativo con texto seleccionable manualmente (el `<pre>` tiene `user-select: text`).
- Estado de feedback: `const [copiedId, setCopiedId] = useState<string | null>(null)`. Al copiar, `setCopiedId(entry.id)` + `setTimeout(() => setCopiedId(null), 2500)`.
- Notes renderizadas como lista bajo el bloque de código.
- Si `entry.hasPlaceholderSecrets` → muestra inline la `secretPlaceholderRef`.

#### `apps/web-console/src/components/console/ConnectionSnippets.test.tsx`

Tests con `vitest` + `@testing-library/react`:
- Render con `resourceType` válido y contexto completo → sección visible, snippets presentes.
- Render con `resourceType` sin snippets → sección no renderizada.
- Botón copiar → `navigator.clipboard.writeText` llamado con el código correcto.
- Feedback visual transitorio → verificar clase/texto "Copiado ✓" presente y luego ausente.
- Fallback Clipboard API ausente → mensaje alternativo visible.
- Contexto con `externalAccessEnabled: false` → nota de advertencia presente.
- Secretos → placeholder visible, credencial real ausente.

### 3.2 Artefactos modificados (integraciones)

Los cambios en las pages son mínimos: construir `SnippetContext` a partir de datos ya disponibles en el estado y renderizar `<ConnectionSnippets>` en la sección de detalle del recurso activo.

#### `ConsolePostgresPage.tsx`

- Punto de integración: sección de detalle de **base de datos** (cuando `selectedDatabase !== null` y `databases.data` tiene el registro activo).
- El `SnippetContext` se construye a partir de:
  - `resourceName`: `selectedDatabase`
  - `resourceHost`: valor del objeto `PgDatabase` activo (no existe campo `host` en el tipo actual → ver §6 Riesgo 1)
  - `resourcePort`: `5432` por defecto (o el que devuelva la API)
  - `resourceExtraA`: `selectedSchema` (opcional, para snippets de esquema)
  - `tenantId/tenantSlug/workspaceId/workspaceSlug`: del `useConsoleContext()`
  - `externalAccessEnabled`: derivado del estado del recurso (asumido `true` si `state === 'active'`)
- Renderizar `<ConnectionSnippets resourceType="postgres-database" context={ctx} />` justo tras el breadcrumb de la base de datos seleccionada (dentro de la sección de detalle de base de datos).

#### `ConsoleMongoPage.tsx`

- Punto de integración: sección de detalle de **colección** (cuando `selectedCollection !== null`).
- `resourceName`: `selectedCollection`
- `resourceHost`: del objeto `MongoDatabase` o `MongoCollection` activo (campo ausente en tipos actuales → §6 Riesgo 1)
- `resourcePort`: `27017` por defecto
- `resourceExtraA`: `selectedDatabase` (database name)
- Renderizar `<ConnectionSnippets resourceType="mongo-collection" context={ctx} />` en el panel de detalle de colección.

#### `ConsoleStoragePage.tsx`

- Punto de integración: sección de detalle del **bucket** (cuando `selectedBucketId !== null` y el bucket está en `buckets.data`).
- `resourceName`: `selectedBucket.bucketName`
- `resourceHost`: endpoint S3-compatible del workspace (no en el tipo actual `StorageBucket` → §6 Riesgo 1)
- `resourceExtraA`: `selectedBucket.region`
- `externalAccessEnabled`: derivado de `selectedBucket.provisioning?.state === 'active'`
- Renderizar `<ConnectionSnippets resourceType="storage-bucket" context={ctx} />` en el panel de detalle del bucket.

#### `ConsoleFunctionsPage.tsx`

- Punto de integración: tab `detail` del action seleccionado, bajo la sección de "Configuración avanzada".
- `resourceName`: `effectiveAction.actionName`
- `resourceHost`: base URL de la consola / gateway APISIX (no disponible en el tipo `FunctionAction` directamente; `httpExposure.publicUrl` es la URL completa → se usa como `resourceExtraB`)
- `resourceExtraB`: `effectiveAction.httpExposure?.publicUrl` (URL de invocación completa cuando HTTP está habilitado)
- `externalAccessEnabled`: `effectiveAction.httpExposure?.enabled === true`
- Renderizar `<ConnectionSnippets resourceType="serverless-function" context={ctx} />` en el tab `detail`.

#### `ConsoleAuthPage.tsx`

- Punto de integración: sección de detalle de **client IAM** seleccionado.
- `resourceName`: `selectedClient.clientId`
- `resourceExtraB`: token endpoint Keycloak construido a partir del realm del tenant (`activeTenant.consoleUserRealm`)
- `externalAccessEnabled`: `selectedClient.enabled === true`
- Renderizar `<ConnectionSnippets resourceType="iam-client" context={ctx} />` en el panel de detalle del client.

---

## 4. Modelo de datos y ausencias de endpoints

### 4.1 Campos de conexión ausentes en los tipos actuales

Los tipos de recursos existentes en las pages **no incluyen campos de endpoint/host explícitos** (salvo `FunctionHttpExposure.publicUrl`). Estrategia:

| Tipo | Campo ausente | Decisión |
|---|---|---|
| `PgDatabase` | `host`, `port`, `connectionEndpoint` | Mostrar placeholder `<PG_HOST>` con nota explicativa. Si la API lo añade en el futuro, actualizar `SnippetContext`. |
| `MongoDatabase` / `MongoCollection` | `host`, `port`, `connectionUri` | Ídem con `<MONGO_HOST>`. |
| `StorageBucket` | `endpoint`, `s3Endpoint` | Ídem con `<S3_ENDPOINT>`. |
| `FunctionAction` | `httpExposure.publicUrl` ya existe | Usar directamente. Si `httpExposure.enabled = false`, snippet con placeholder y nota. |
| `IamClient` | Token endpoint | Construir desde `activeTenant.consoleUserRealm` + URL base conocida del realm Keycloak. |

Esta decisión evita bloquear la implementación UI en cambios de backend. Los snippets siempre se muestran; los campos sin dato usan placeholders con referencia.

### 4.2 Extensión de tipos existentes (opcional, no bloqueante)

Si el control-plane o los adapters añaden `connectionEndpoint` u objetos de conectividad al shape de respuesta, basta con mapear esos campos al `SnippetContext` en la page correspondiente. No se requiere modificar ni el catálogo ni el generador.

### 4.3 Persistencia

**Ninguna.** Los snippets se generan en memoria en cada render; no se persisten en `localStorage`, `sessionStorage` ni `IndexedDB`. Al desmontar el componente, los datos se descartan automáticamente (garantía por diseño React).

### 4.4 Eventos de auditoría

**Ninguno.** La visualización de snippets es derivada de datos ya cargados; no genera llamadas al backend ni eventos de auditoría. El copiado al portapapeles es local al navegador.

---

## 5. Contratos de componente

### `ConnectionSnippets` — Props

```typescript
interface ConnectionSnippetsProps {
  resourceType: ResourceType
  context: SnippetContext
}
```

**Invariantes**:
- Si `generateSnippets()` devuelve `[]`, el componente retorna `null`.
- El componente no hace fetch. No tiene efectos con red.
- El estado de feedback del clipboard es local (`copiedId: string | null`).

### `generateSnippets` — Contrato

```typescript
function generateSnippets(type: ResourceType, ctx: SnippetContext): SnippetEntry[]
// Pura. Sin side effects. Sin estado global.
// Devuelve [] si no hay templates para `type`.
// Sustituye tokens en orden: valores reales > placeholders descriptivos.
// Nunca incluye credenciales reales.
```

### `SNIPPET_CATALOG` — Contrato de extensibilidad

```typescript
// Añadir nuevo template:
SNIPPET_CATALOG['postgres-database'].push({
  id: 'pg-ruby-sequel',
  label: 'Ruby — Sequel',
  codeTemplate: `DB = Sequel.connect('postgres://<PG_USER>:{PASSWORD}@{HOST}:{PORT}/{DB_NAME}')`,
  secretTokens: ['{PASSWORD}'],
  secretPlaceholderRef: 'Consulta la sección API Keys de este workspace'
})
// El generador no cambia. ConnectionSnippets no cambia.
```

---

## 6. Riesgos, mitigaciones y decisiones técnicas

| ID | Riesgo | Mitigación | Decisión tomada |
|---|---|---|---|
| R-01 | Los tipos de recurso no exponen campos de `host`/`endpoint`. | Usar placeholders descriptivos y notas. El contrato de `SnippetContext` acepta `null` en esos campos. | Implementar con placeholders; no bloquear en backend. |
| R-02 | `navigator.clipboard` no disponible en HTTP o contextos no seguros. | Fallback: mensaje + bloque seleccionable. | `try/catch` + check de disponibilidad antes de llamar. |
| R-03 | El token endpoint de Keycloak varía por instalación. | Usar `activeTenant.consoleUserRealm` + URL base del realm como patrón. Si el realm no está disponible, placeholder genérico. | Construir desde contexto disponible; placeholder si null. |
| R-04 | La URL de invocación de funciones requiere `httpExposure.enabled`. | Si `enabled = false`, snippet con placeholder + nota visible de acceso externo deshabilitado. | Ya cubierto por `externalAccessEnabled` en `SnippetContext`. |
| R-05 | Cambios de workspace/tenant no refrescan snippets. | `generateSnippets` se llama en `useMemo` con dependencia en `context` y `resourceType`. Al cambiar contexto, React recalcula automáticamente. | Por diseño. No requiere acción adicional. |
| R-06 | Nuevos tipos de recurso se añaden al BaaS sin snippets. | La sección no se renderiza si `generateSnippets` devuelve `[]`. No hay error ni bloque vacío. | Comportamiento por defecto. |

### Rollback

La implementación es **puramente aditiva**:
- Nuevo módulo `lib/snippets/` sin dependencias inversas en código existente.
- Nuevo componente `ConnectionSnippets.tsx` sin registrarse en el router.
- Las integraciones en pages son renders condicionales: retirarlos vuelve la page a su estado anterior.
- No hay migraciones de base de datos ni cambios de API.

Rollback = eliminar el directorio `lib/snippets/`, el componente `ConnectionSnippets.tsx` y las importaciones añadidas en las 5 pages.

---

## 7. Estrategia de pruebas

### 7.1 Tests unitarios (Vitest + RTL)

**`ConnectionSnippets.test.tsx`** (nuevo):
- Render correcto con contexto completo para cada `resourceType`.
- Render nulo para tipo sin snippets.
- Botón copiar: `navigator.clipboard.writeText` mockeado → verify llamada con contenido correcto.
- Estado "Copiado ✓" aparece y desaparece (usar `vi.useFakeTimers`).
- Fallback Clipboard API: mock `navigator.clipboard = undefined` → mensaje alternativo visible.
- `externalAccessEnabled: false` → nota de advertencia en snippets.
- Secretos → confirmar que ningún snippet contiene una credential real.

**`snippet-generator.test.ts`** (nuevo):
- Por cada `ResourceType`, `generateSnippets` devuelve entradas con los valores del contexto sustituidos.
- Si el campo es `null` en el contexto, el snippet contiene el placeholder genérico.
- Para tipo no registrado en catálogo, devuelve `[]`.
- Función pura: misma entrada → mismo output (determinismo).

**`snippet-catalog.test.ts`** (opcional pero recomendado):
- Todos los templates del catálogo contienen al menos los tokens obligatorios.
- Ningún template contiene strings que parezcan credenciales reales (`password`, `secret`, `key` literales sin ser placeholder).

### 7.2 Tests de integración en pages existentes

Cada page tiene un archivo `.test.tsx` existente. Añadir un bloque `describe('ConnectionSnippets integration', ...)` en cada test de página afectada:
- Cuando el recurso está seleccionado, la sección "Snippets de conexión" aparece.
- Cuando no hay recurso seleccionado, la sección no aparece.
- Para tipo sin snippets definidos, la sección no aparece.

No modificar los tests existentes; solo añadir describe blocks nuevos.

### 7.3 Tests E2E (Playwright — US-UI-04-T06)

Los tests E2E de regresión de UX **quedan excluidos de esta tarea** (→ US-UI-04-T06). Esta tarea entrega cobertura unitaria suficiente para el criterio de done.

### 7.4 Criterios observables de calidad

- TypeScript: `tsc -p tsconfig.app.json --noEmit` sin errores.
- Vitest: `pnpm test` en `apps/web-console` pasa sin regresiones.
- ESLint: sin errores nuevos en los artefactos añadidos.
- No hay imports cíclicos entre `lib/snippets/` y `components/console/`.

---

## 8. Secuencia recomendada de implementación

```text
Paso 1 — Tipos y catálogo (sin UI, 100% testeable de forma aislada)
  snippet-types.ts
  snippet-catalog.ts
  snippet-generator.ts
  snippet-generator.test.ts
  snippet-catalog.test.ts

Paso 2 — Componente UI aislado
  ConnectionSnippets.tsx
  ConnectionSnippets.test.tsx

Paso 3 — Integraciones en pages (una a una, independientes entre sí)
  ConsolePostgresPage.tsx → postgres-database
  ConsoleMongoPage.tsx    → mongo-collection
  ConsoleStoragePage.tsx  → storage-bucket
  ConsoleFunctionsPage.tsx → serverless-function
  ConsoleAuthPage.tsx     → iam-client

Paso 4 — Tests de integración en pages (bloques describe nuevos)
Paso 5 — Typecheck + test run completo
```

**Paralelización posible**: los pasos 3a–3e son independientes entre sí y pueden asignarse a implementaciones paralelas. Los pasos 1 y 2 son prerequisitos para todos.

---

## 9. Dependencias previas

| Dependencia | Estado requerido | Riesgo si no disponible |
|---|---|---|
| `useConsoleContext()` → `activeTenantId`, `activeWorkspaceId`, `activeTenant` (con `consoleUserRealm`) | Disponible (US-UI-03 entregado) | Bajo — el contexto ya existe y funciona. |
| Vistas de detalle de recursos (ConsolePostgresPage, ConsoleMongoPage, ConsoleStoragePage, ConsoleFunctionsPage, ConsoleAuthPage) | Disponibles (US-UI-04-T01–T04 parcialmente entregados, pages ya existen) | Bajo — las pages ya tienen datos de recursos cargados. |
| `navigator.clipboard` en el navegador del usuario | Disponible en contextos HTTPS | Bajo — el fallback cubre entornos sin soporte. |
| Campos `host`/`endpoint` en respuestas de API de recursos | **No requerido** | Ninguno — se usan placeholders si no están disponibles. |

---

## 10. Criterios de done verificables

| ID | Criterio | Evidencia |
|---|---|---|
| DoD-01 | Módulo `lib/snippets/` creado con los 3 ficheros y sus tests. | `pnpm test` pasa. |
| DoD-02 | Componente `ConnectionSnippets` renderiza snippets para todos los `ResourceType` con datos de contexto completos. | Tests unitarios pasan; render manual verificable. |
| DoD-03 | Botón "Copiar" copia el bloque correcto y muestra feedback de 2–3 s. | Test con timers falsos pasa. |
| DoD-04 | Fallback cuando Clipboard API no está disponible. | Test con mock de `navigator.clipboard = undefined` pasa. |
| DoD-05 | La sección no se renderiza si no hay snippets para el tipo. | Test de render nulo pasa. |
| DoD-06 | Las 5 pages integran `ConnectionSnippets` en la sección de detalle del recurso activo. | Tests de integración en pages pasan. |
| DoD-07 | Ningún snippet contiene credenciales en claro; todos los secretos son placeholders con referencia. | Test de ausencia de credenciales pasa; revisión manual del catálogo. |
| DoD-08 | `context.externalAccessEnabled = false` produce nota de advertencia visible. | Test unitario pasa. |
| DoD-09 | Recursos con endpoint `null` muestran snippets con placeholders genéricos y nota explicativa. | Test con contexto parcial pasa. |
| DoD-10 | `tsc --noEmit` sin errores. | `pnpm typecheck` pasa. |
| DoD-11 | Añadir un nuevo template al catálogo no requiere modificar el generador ni el componente. | Verificable por inspección del diseño; test del catálogo cubre la estructura esperada. |
| DoD-12 | Los snippets no se persisten en almacenamiento client-side. | Ausencia de llamadas a `localStorage/sessionStorage/indexedDB` en el módulo (lint / revisión). |

---

## 11. Observabilidad y seguridad

- **No hay telemetría nueva**: los snippets no generan tráfico de red ni eventos de auditoría.
- **Seguridad**: revisión obligatoria del catálogo antes de merge para confirmar que ningún template contiene credenciales literales. El PR reviewer debe verificar explícitamente los campos `secretTokens` de cada template.
- **Multi-tenancy**: el aislamiento es estructural: los snippets se generan a partir de `SnippetContext`, que se construye exclusivamente con datos del workspace activo ya verificados por la capa de autenticación APISIX/Keycloak.
- **XSS**: los bloques de código se renderizan dentro de `<pre><code>` como texto plano (no `dangerouslySetInnerHTML`). Los valores del contexto son strings tipados; no se ejecutan.
