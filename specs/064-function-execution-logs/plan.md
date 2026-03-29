# Plan — Function Execution Logs and Results in Console

**Feature slug**: `064-function-execution-logs`
**Task ID**: US-UI-04-T04
**Spec ref**: `specs/064-function-execution-logs/spec.md`
**Epic**: EP-15 — Consola de administración: dominios funcionales
**Historia padre**: US-UI-04
**RF cubiertos**: RF-FEL-01 … RF-FEL-10 (definidos en spec.md §4)
**Dependencias**: US-OBS-03, US-UI-03, US-UI-04-T01, US-UI-04-T02, US-UI-04-T03
**Stack**: React + Tailwind CSS + shadcn/ui · Apache APISIX gateway · Apache OpenWhisk
**Fecha**: 2026-03-29
**Estado**: Ready for implementation

---

## 1. Objetivo del plan

Producir una implementación incremental y verificable de la vista de activaciones de funciones serverless en la consola administrativa. La capacidad permite a los usuarios con permisos de lectura listar activaciones recientes de una función, examinar metadata operativa, visualizar logs de salida y ver el resultado de ejecución formateado, todo desde la consola React sin acceso directo a infraestructura OpenWhisk.

---

## 2. Arquitectura y flujo objetivo

```text
┌─────────────────────────────────────────────────────┐
│ Console React App                                    │
│                                                      │
│  FunctionDetailPage                                  │
│    └─ ActivationsTab                                 │
│         ├─ ActivationListPanel       (RF-FEL-01,08)  │
│         │    └─ ActivationRow × n                    │
│         └─ ActivationDetailPanel    (RF-FEL-02..10)  │
│              ├─ ActivationMeta      (metadata)       │
│              ├─ ActivationLogs      (logs)           │
│              └─ ActivationResult    (result)         │
└──────────────────────────────┬──────────────────────┘
                               │ HTTPS + JWT (Keycloak)
                               ▼
                     Apache APISIX Gateway
                               │
                  ┌────────────┴────────────┐
                  │  /api/v1/functions/*    │
                  │  (proxy → OpenWhisk)    │
                  └────────────┬────────────┘
                               │
                     Apache OpenWhisk API
                     /api/v1/namespaces/{ns}/activations

```

### Flujo de datos por sección

1. **Listado de activaciones**: al montar `ActivationsTab`, se invoca `GET /functions/{id}/activations?page[size]=50` con cursor opcional. La respuesta alimenta `ActivationListPanel`.
2. **Detalle de activación**: al seleccionar una fila, se disparan en paralelo tres peticiones independientes:
   - `GET /functions/{id}/activations/{activationId}` → metadata
   - `GET /functions/{id}/activations/{activationId}/logs` → logs
   - `GET /functions/{id}/activations/{activationId}/result` → result
3. Cada petición gestiona su propio estado `{ status: idle | loading | success | error, data, error }`. Los fallos son locales a cada sección.

---

## 3. Contratos de API (gateway APISIX → OpenWhisk)

### 3.1 Listado de activaciones

```text
GET /api/v1/workspaces/{workspaceId}/functions/{functionId}/activations
    ?page[size]=50
    &after={cursor}           # cursor opaco para paginación; omitido en primera página
    &order=desc               # más reciente primero
Authorization: Bearer <keycloak-jwt>

```

**Response 200**

```jsonc
{
  "data": [
    {
      "activationId": "abc123",
      "status": "succeeded",        // succeeded | failed | timed_out | cancelled | running
      "durationMs": 142,
      "triggerKind": "http",        // http | cron | kafka | storage | manual | unknown
      "startedAt": "2026-03-29T14:00:00Z"
    }
  ],
  "pagination": {
    "size": 50,
    "hasMore": true,
    "nextCursor": "eyJhZnRlciI6..."
  }
}

```text

**Errores esperados**

| HTTP | Situación | Acción consola |
|---|---|---|
| 401 | Sesión expirada | Redirigir a login |
| 403 | Sin permisos de lectura | Mostrar mensaje de permisos en panel |
| 404 | Función no encontrada | Mostrar "Función no disponible" |
| 200 `data: []` | Sin activaciones | Mostrar empty state RF-FEL-07 |

### 3.2 Metadata de activación

```http

GET /api/v1/workspaces/{workspaceId}/functions/{functionId}/activations/{activationId}
Authorization: Bearer <keycloak-jwt>

```text

**Response 200**

```jsonc
{
  "activationId": "abc123",
  "resourceId": "fn-xyz",
  "status": "succeeded",
  "startedAt": "2026-03-29T14:00:00Z",
  "finishedAt": "2026-03-29T14:00:00.142Z",
  "durationMs": 142,
  "statusCode": 0,
  "triggerKind": "http",
  "memoryMb": 256,
  "invocationId": "inv-0001",
  "activationPolicy": {
    "retentionDays": 7
  }
}

```

### 3.3 Logs de activación

```http
GET /api/v1/workspaces/{workspaceId}/functions/{functionId}/activations/{activationId}/logs
Authorization: Bearer <keycloak-jwt>

```

**Response 200**

```jsonc
{
  "lines": [
    "2026-03-29T14:00:00.010Z stdout: Processing request...",
    "2026-03-29T14:00:00.140Z stdout: Done."
  ],
  "truncated": false    // true si los logs fueron recortados por política
}

```

**Errores esperados**

| HTTP | Acción consola |
|---|---|
| 401 | Redirigir a login |
| 403 | Mostrar "No tienes permisos para ver los logs de esta activación." — sección aislada |
| 404 | Mostrar "Esta activación ya no está disponible." |
| 5xx / red | Mostrar mensaje de error en sección logs; no bloquear metadata ni result |

### 3.4 Resultado de activación

```http

GET /api/v1/workspaces/{workspaceId}/functions/{functionId}/activations/{activationId}/result
Authorization: Bearer <keycloak-jwt>

```

**Response 200**

```jsonc
{
  "contentType": "application/json",  // o "text/plain", "application/octet-stream"
  "payload": { ... }                  // object si JSON; string si text/plain; null si vacío
}

```

**Casos especiales**

| Situación | Render |
|---|---|
| `contentType: application/json` | Pretty-print JSON con indentación 2 espacios |
| `contentType: text/plain` | Texto plano |
| `contentType: application/octet-stream` | "El resultado no se puede mostrar en texto." |
| `payload: null` o campo ausente | "Sin resultado disponible." |

---

## 4. Módulos y artefactos a crear/modificar

### 4.1 Nuevos componentes React

```text
src/
  features/
    functions/
      activations/
        ActivationsTab.tsx            # pestaña de activaciones en FunctionDetailPage
        ActivationListPanel.tsx       # listado paginado (RF-FEL-01, RF-FEL-08, RF-FEL-09)
        ActivationRow.tsx             # fila del listado; badge de estado
        ActivationDetailPanel.tsx     # panel de detalle con tres secciones independientes
        ActivationMeta.tsx            # sección metadata (RF-FEL-02)
        ActivationLogs.tsx            # sección logs (RF-FEL-03, RF-FEL-05, RF-FEL-10)
        ActivationResult.tsx          # sección resultado (RF-FEL-04, RF-FEL-06)
        ActivationStatusBadge.tsx     # badge visual diferenciado por estado (RF-FEL-09)
        hooks/
          useActivations.ts           # listado + paginación
          useActivationDetail.ts      # metadata en paralelo con logs y result
          useActivationLogs.ts        # fetch logs independiente
          useActivationResult.ts      # fetch result independiente
        api/
          activations.api.ts          # funciones fetch tipadas para los 4 endpoints
        types/
          activation.types.ts         # interfaces TS: Activation, ActivationDetail, etc.

```

### 4.2 Modificaciones a archivos existentes

| Artefacto | Cambio |
|---|---|
| `src/features/functions/FunctionDetailPage.tsx` | Añadir pestaña "Activaciones" que monta `ActivationsTab` |
| `src/lib/api/client.ts` (o equivalente) | Asegurarse de que el cliente HTTP propaga el `workspaceId` de contexto |
| `src/routes/functions.routes.tsx` | Añadir subruta `activations` y subruta `activations/:activationId` si se usa routing para el panel de detalle |

### 4.3 Tests

```text
src/features/functions/activations/
  __tests__/
    ActivationListPanel.test.tsx
    ActivationDetailPanel.test.tsx
    ActivationLogs.test.tsx
    ActivationResult.test.tsx
    hooks/
      useActivations.test.ts
      useActivationDetail.test.ts
  __mocks__/
    activations.handlers.ts           # MSW handlers para todos los endpoints

```

---

## 5. Diseño de componentes clave

### 5.1 ActivationsTab

```tsx
// Monta ActivationListPanel y ActivationDetailPanel en layout split.
// Estado local: activationId seleccionado (null = solo listado visible).
// En mobile: navegación apilada (listado → detalle).

```text

### 5.2 ActivationListPanel

- Usa `useActivations(functionId, workspaceId)`.
- Tabla `shadcn/ui Table` con columnas: Status Badge, Activation ID (truncado a 8 chars), Duración, Trigger, Fecha.
- Botón "Cargar más" visible cuando `pagination.hasMore === true` (cursor-based).
- Empty state: `"Esta función no tiene activaciones registradas."` (RF-FEL-07).
- Skeleton loader durante `status === 'loading'`.

### 5.3 ActivationStatusBadge

Mapa de estado → color (Tailwind + shadcn/ui Badge):

| Estado | Variante Badge | Color |
|---|---|---|
| succeeded | `success` | verde |
| failed | `destructive` | rojo |
| timed_out | `warning` | naranja |
| cancelled | `secondary` | gris |
| running | `outline` + spinner | azul |
| unknown | `secondary` | gris claro |

### 5.4 ActivationDetailPanel

```tsx
// Al montar con un activationId:
// - dispara useActivationDetail, useActivationLogs, useActivationResult en paralelo.
// - Renderiza ActivationMeta, ActivationLogs, ActivationResult en orden vertical.
// - Cada sección gestiona su propio loading/error state independientemente.

```

### 5.5 ActivationLogs

- Contenedor `<pre>` con `overflow-y-auto max-h-96` para scroll vertical.
- Si `truncated === true`: banner de advertencia encima del bloque: `"Los logs están truncados. Se muestra el contenido disponible."`.
- Si `lines.length === 0`: `"No hay logs disponibles para esta activación."`.
- Si status es "running": `"La activación sigue en curso. Los logs pueden no estar disponibles aún."`.
- Si error 403: `"No tienes permisos para ver los logs de esta activación."`.
- Si error 404: `"Esta activación ya no está disponible."`.
- Si otros errores: mensaje genérico de error de carga sin bloquear otras secciones.

### 5.6 ActivationResult

- Si `contentType === 'application/json'`: `<pre>` con `JSON.stringify(payload, null, 2)`.
- Si `contentType === 'text/plain'`: `<pre>` con payload como string.
- Si `contentType === 'application/octet-stream'`: `"El resultado no se puede mostrar en texto."`.
- Si payload null/vacío: `"Sin resultado disponible."`.
- Si error: mensaje de error en sección; no bloquea logs ni metadata.

---

## 6. Hooks y gestión de estado

### 6.1 useActivations

```ts
interface UseActivationsResult {
  activations: Activation[];
  status: 'idle' | 'loading' | 'success' | 'error';
  error: ApiError | null;
  hasMore: boolean;
  loadMore: () => void;
}

```text

- Paginación basada en cursor: mantiene `nextCursor` internamente y appends al cargar más.
- No mezcla páginas si `functionId` cambia (cancela fetch previo o ignora respuesta obsoleta).

### 6.2 useActivationDetail / useActivationLogs / useActivationResult

Cada hook gestiona su propio `{ status, data, error }`. Son independientes para cumplir RF-FEL-05 y RF-FEL-06. Se invocan en paralelo dentro de `ActivationDetailPanel`.

### 6.3 Manejo de 401

El cliente HTTP central intercepta 401 y redirige al flujo de autenticación Keycloak. No requiere lógica en estos hooks salvo no consumir la respuesta errónea.

---

## 7. Seguridad

- JWT Keycloak propagado en `Authorization: Bearer` a través del cliente HTTP existente.
- No persistir logs ni resultados en `localStorage`, `sessionStorage` ni `IndexedDB` (RF spec §5).
- Vaciar datos al desmontar los componentes de detalle (retorno de cleanup en useEffect o librería de estado).
- El workspaceId se obtiene del contexto del selector de tenant/workspace (US-UI-03); nunca de parámetros URL libres.
- Los endpoints incluyen el workspaceId en la ruta para garantizar aislamiento multi-tenant en el gateway.
- Los datos de logs y resultados se muestran tal cual devuelve el backend sin filtrado adicional; los datos sensibles son responsabilidad del backend.

---

## 8. Estrategia de pruebas

### 8.1 Unit tests (Vitest + React Testing Library)

| Componente/Hook | Casos a cubrir |
|---|---|
| `ActivationStatusBadge` | Cada estado → variante correcta |
| `ActivationLogs` | Sin logs, truncado, error 403, error genérico, logs con contenido |
| `ActivationResult` | JSON, texto plano, binario, null, error |
| `ActivationListPanel` | Empty state, lista con datos, skeleton, error, paginación |
| `useActivations` | Carga inicial, loadMore, reset al cambiar functionId |
| `useActivationLogs` | Success, 403, 404, 5xx |
| `useActivationResult` | Success JSON, success text, success binario, error |

### 8.2 Integration tests (MSW + React Testing Library)

- `ActivationDetailPanel`: simular las tres peticiones en paralelo; verificar que fallo en logs no bloquea metadata ni result (RF-FEL-05, RF-FEL-06).
- `ActivationsTab`: flujo completo listado → selección → detalle.
- Paginación: primera página + loadMore con cursor.

### 8.3 E2E / contrato (opcional, alcance de US-UI-04-T06)

- Los tests E2E de regresión de UX quedan fuera de esta tarea según spec §4 Límites de alcance.
- Los tests de contrato de API (Pact) se delegan a US-OBS-03 si aplica.

### 8.4 Criterio de cobertura

- Cobertura de ramas ≥ 80% en los hooks y componentes nuevos.
- Todos los edge cases de spec §3.5 tienen al menos un test unitario o de integración.

---

## 9. Riesgos, mitigaciones y compatibilidad

| Riesgo | Mitigación |
|---|---|
| API de activaciones no soporta cursor | Implementar con offset fallback; documentar limitación en `activations.api.ts` con comentario `// TODO: migrar a cursor cuando API lo soporte` |
| Logs muy extensos degradan rendimiento del navegador | Backend ya trunca por política. Contenedor con `overflow-y-auto max-h-96`. No renderizar más de lo que devuelve el endpoint. Si se detecta payload > 500 KB, mostrar advertencia y botón "Descargar como texto" |
| Resultado binario en blob | Detectar `contentType: application/octet-stream` y mostrar mensaje; no intentar decodificar |
| Activación en curso (running) | Sección logs y result muestran "La activación sigue en curso." sin error; permiten refrescar manualmente |
| Cambio de workspaceId mientras se visualiza un detalle | Limpiar estado del detalle al cambiar contexto de workspace (efecto en ActivationsTab) |

### Rollback / compatibilidad

- Los nuevos endpoints son read-only; no modifican estado en backend.
- Si los endpoints no existen en el entorno (e.g., OpenWhisk no desplegado), los hooks devuelven error y los componentes muestran mensaje informativo sin romper otras partes de la consola.
- No hay migraciones de base de datos asociadas a esta tarea.

---

## 10. Dependencias previas y secuencia de implementación

### Dependencias que deben estar disponibles

| Dependencia | Estado requerido |
|---|---|
| US-UI-03 — Selector de contexto tenant/workspace | Disponible en entorno de desarrollo |
| US-OBS-03 — Endpoints de activaciones en gateway | Endpoints accesibles o mocks MSW disponibles |
| `FunctionDetailPage` con soporte de pestañas | Mínimo scaffold disponible |

### Secuencia recomendada

```text

1. Tipos TypeScript (activation.types.ts)
2. API client functions (activations.api.ts) + MSW handlers
3. Hooks: useActivations, useActivationLogs, useActivationResult, useActivationDetail
4. Componentes base: ActivationStatusBadge, ActivationRow
5. ActivationListPanel (con empty state, skeleton, paginación)
6. ActivationLogs (con todos los estados: vacío, truncado, error, running)
7. ActivationResult (JSON, text, binario, null, error)
8. ActivationMeta
9. ActivationDetailPanel (integración paralela de las tres secciones)
10. ActivationsTab (integración con FunctionDetailPage)
11. Tests unitarios e integración
12. Revisión de accesibilidad (aria-labels, roles en tabla y badges)

```text

### Paralelización posible

- Los pasos 1–2 pueden realizarse en paralelo con el scaffold de `FunctionDetailPage`.
- Los hooks (paso 3) pueden desarrollarse en paralelo con los componentes base (paso 4).
- Los componentes ActivationLogs, ActivationResult y ActivationMeta (pasos 6–8) son independientes entre sí.

---

## 11. Criterios de done verificables

| # | Criterio | Evidencia esperada |
|---|---|---|
| D-01 | Listado de activaciones muestra: Activation ID, estado (con badge visual), duración, trigger kind y fecha/hora de inicio | Screenshot o test con datos de MSW |
| D-02 | Empty state cuando la función no tiene activaciones | Test con respuesta `data: []` |
| D-03 | Paginación: "Cargar más" visible cuando `hasMore: true`; desaparece cuando no hay más páginas | Test de integración con dos páginas |
| D-04 | Selección de activación muestra panel con tres secciones: metadata, logs, resultado | Test de integración completo |
| D-05 | Fallo en fetch de logs no bloquea metadata ni resultado | Test con MSW: logs devuelve 500, metadata y result devuelven 200 |
| D-06 | Fallo en fetch de resultado no bloquea metadata ni logs | Test con MSW: result devuelve 500, metadata y logs devuelven 200 |
| D-07 | Logs truncados: indicador visible "Los logs están truncados..." | Test con `truncated: true` |
| D-08 | Logs vacíos: mensaje "No hay logs disponibles..." | Test con `lines: []` |
| D-09 | Resultado JSON: pretty-printed con 2 espacios de indentación | Test unitario de ActivationResult |
| D-10 | Resultado texto plano: mostrado como texto | Test unitario de ActivationResult |
| D-11 | Resultado binario: mensaje "El resultado no se puede mostrar en texto." | Test unitario de ActivationResult |
| D-12 | Error 403 en logs: "No tienes permisos..." — sin bloquear otras secciones | Test de integración con MSW |
| D-13 | Error 404 en detalle: "Esta activación ya no está disponible." | Test con MSW devolviendo 404 |
| D-14 | Activación en curso (running): sección logs y result muestran "La activación sigue en curso." | Test con status "running" |
| D-15 | No se persiste ningún dato en localStorage/sessionStorage/IndexedDB | Inspección manual o test de efecto cleanup |
| D-16 | Cobertura de ramas ≥ 80% en hooks y componentes nuevos | Informe de cobertura de Vitest |
| D-17 | Todos los edge cases de spec §3.5 tienen test unitario o de integración | Revisión de tabla de edge cases vs tests |

---

## 12. Notas de observabilidad

- No se introducen eventos de auditoría en la consola para operaciones de lectura (según spec §5 Auditoría).
- El cliente HTTP puede registrar en consola del navegador (dev mode) los errores de API, nunca en producción sin filtrado.
- Si se dispone de sistema de telemetría frontend (e.g., Sentry), los errores de fetch en los hooks se reportan con contexto: `{ workspaceId, functionId, activationId, section: 'logs' | 'result' | 'metadata' }`.
