# Plan técnico — UX Regression Tests: Wizards, Confirmaciones y Snippets

**Spec**: `066-ux-regression-tests-wizards-confirmations-snippets`
**Task ID**: US-UI-04-T06
**Epic**: EP-15 — Consola de administración: dominios funcionales
**Historia**: US-UI-04 — Métricas, auditoría, API keys, cuotas, wizards, warnings y snippets
**Fecha del plan**: 2026-03-29
**Estado**: Ready

---

## 1. Resumen ejecutivo

Esta tarea materializa la suite de pruebas de regresión de UX que protege los tres grupos de comportamiento introducidos por T02 (wizards), T03 (confirmaciones destructivas) y T05 (snippets). La infraestructura de testing ya existe en el monorepo (`vitest` + `@testing-library/react` + `jsdom`). Los componentes objetivo (`WizardShell`, `DestructiveConfirmationDialog`, `ConnectionSnippets`) ya están implementados y tienen tests de humo iniciales. Esta tarea extiende y consolida esa cobertura hasta los 26 escenarios de aceptación definidos en la spec, con fixtures compartidos, trazabilidad explícita y ejecución integrada en CI.

No se require cambio de stack ni adición de dependencias.

### 1.1 Reconciliación repo ↔ suite (2026-03-29 cron continuation)

Durante la primera ejecución acotada de `implement` aparecieron desajustes concretos entre el contrato de tests planificado y el comportamiento real del repo. Esta tarea se mantiene como una unidad de regresión, pero se autoriza un parche de producción mínimo en los componentes estrictamente necesarios para que la suite refleje escenarios ya aceptados:

- `DestructiveConfirmationDialog.tsx` debe disparar `config.onSuccess?.()` tras una confirmación satisfactoria, ya que el callback ya forma parte del contrato tipado en `destructive-ops.ts`.
- `CreateWorkspaceWizard.tsx` y `ProvisionDatabaseWizard.tsx` pueden requerir exponer `validation.blockingError` en el paso donde hoy ya se evalúa la cuota para que el usuario vea el motivo del bloqueo.
- `PublishFunctionWizard.tsx` puede requerir el mismo render mínimo de `validation.blockingError` si el escenario de bloqueo por cuota se valida ahí.
- La navegación atrás desde el resumen de `InviteUserWizard` debe considerarse correcta cuando vuelve al último paso real de datos (`Mensaje`), porque ese wizard tiene cuatro pasos antes del resumen.
- Los snippets sin endpoint usan actualmente `<RESOURCE_HOST>` / `<RESOURCE_PORT>`; la suite debe afirmar esos placeholders reales y no inventar otros alternativos.
- El enlace de éxito del summary wizard se expone actualmente con la etiqueta `Abrir recurso`; los tests deben verificar el contrato visible real.

---

## 2. Arquitectura de la suite

### 2.1 Estructura de archivos

```text
apps/web-console/src/
├── components/console/
│   ├── wizards/
│   │   ├── WizardShell.test.tsx                  ← ampliar: RW-01..RW-06 via WizardShell
│   │   ├── CreateTenantWizard.test.tsx            ← ampliar: RW-07 (cuota), RW-08 (permisos)
│   │   ├── CreateWorkspaceWizard.test.tsx         ← nuevo: RW-07/RW-08 para workspace
│   │   ├── CreateIamClientWizard.test.tsx         ← nuevo: RW-02/RW-05/RW-06
│   │   ├── InviteUserWizard.test.tsx              ← nuevo: RW-01/RW-03/RW-04
│   │   ├── ProvisionDatabaseWizard.test.tsx       ← nuevo: RW-07 (cuota DB)
│   │   └── PublishFunctionWizard.test.tsx         ← nuevo: RW-02/RW-05/RW-06
│   ├── DestructiveConfirmationDialog.test.tsx     ← ampliar: RC-01..RC-10 completos
│   └── ConnectionSnippets.test.tsx               ← ampliar: RS-01..RS-08 completos
├── test/
│   ├── setup.ts                                  ← sin cambios
│   └── fixtures/
│       ├── tenants.ts                            ← nuevo: datos tenant/workspace multi-tenant
│       ├── resources.ts                          ← nuevo: PG, Mongo, storage, función, IAM client
│       ├── permissions.ts                        ← nuevo: roles y permisos diferenciados
│       ├── quotas.ts                             ← nuevo: posturas de cuota (ok, excedida)
│       └── snippets.ts                           ← nuevo: contextos SnippetContext representativos
```

### 2.2 Capas de la suite

```text
┌─────────────────────────────────────────────────────────┐
│  Suite de regresión de UX (vitest + Testing Library)    │
│                                                         │
│  ┌──────────────┐  ┌─────────────────┐  ┌───────────┐  │
│  │ Wizards (RW) │  │ Destructive (RC) │  │Snippets(RS│  │
│  │ WizardShell  │  │ ConfirmDialog   │  │ Connection│  │
│  │ + 6 wizards  │  │ + useDestruct.  │  │ Snippets  │  │
│  └──────┬───────┘  └────────┬────────┘  └─────┬─────┘  │
│         │                   │                  │        │
│  ┌──────▼───────────────────▼──────────────────▼──────┐ │
│  │           Fixtures compartidos (test/fixtures/)    │ │
│  │  tenants · resources · permissions · quotas ·      │ │
│  │  snippets · mocks de API (vi.mock / vi.fn)         │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

### 2.3 Estrategia de mocking

- **console-session**: `vi.mock('@/lib/console-session')` → `requestConsoleSessionJson` retorna fixtures deterministas.
- **console-quotas**: `vi.mock('@/lib/console-quotas')` → `useConsoleQuotas` retorna postura de cuota del fixture.
- **cascade-impact API**: `vi.mock('@/lib/http')` → `requestJson` retorna `dependents[]` del fixture.
- **Clipboard API**: `vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn() } })`.
- **Routers**: los wizards que usan `<Link>` o `useNavigate` se envuelven en `<MemoryRouter>`.
- No se realizan llamadas de red reales en ningún test.

---

## 3. Cambios propuestos por artefacto

### 3.1 `src/test/fixtures/tenants.ts` (nuevo)

```typescript
// Fixture: dos tenants, tres workspaces entre ambos
export const FIXTURE_TENANT_ALPHA = {
  tenantId: "ten_alpha",
  tenantSlug: "tenant-alpha",
  name: "Tenant Alpha",
  planId: "starter",
  region: "eu-west",
  status: "active",
};

export const FIXTURE_TENANT_BETA = {
  tenantId: "ten_beta",
  tenantSlug: "tenant-beta",
  name: "Tenant Beta",
  planId: "pro",
  region: "us-east",
  status: "active",
};

export const FIXTURE_WORKSPACE_A1 = {
  workspaceId: "wrk_a1",
  workspaceSlug: "workspace-alpha-1",
  tenantId: "ten_alpha",
  name: "Workspace Alpha 1",
};

export const FIXTURE_WORKSPACE_A2 = {
  workspaceId: "wrk_a2",
  workspaceSlug: "workspace-alpha-2",
  tenantId: "ten_alpha",
  name: "Workspace Alpha 2",
};

export const FIXTURE_WORKSPACE_B1 = {
  workspaceId: "wrk_b1",
  workspaceSlug: "workspace-beta-1",
  tenantId: "ten_beta",
  name: "Workspace Beta 1",
};
```

### 3.2 `src/test/fixtures/resources.ts` (nuevo)

Contiene un recurso de cada tipo soportado por los snippets y wizards:

```typescript
// Un recurso de cada tipo: PG, Mongo, storage bucket, serverless function, IAM client
export const FIXTURE_PG_DB = { resourceId: 'db_pg1', name: 'orders', host: 'db.test', port: 5432, ... }
export const FIXTURE_MONGO_COLL = { ... }
export const FIXTURE_STORAGE_BUCKET = { ... }
export const FIXTURE_FUNCTION = { ... }
export const FIXTURE_IAM_CLIENT = { ... }
// Recurso en estado transitorio (provisioning)
export const FIXTURE_PG_DB_PROVISIONING = { ...FIXTURE_PG_DB, resourceState: 'provisioning' }
// Recurso sin endpoint asignado
export const FIXTURE_PG_DB_NO_ENDPOINT = { ...FIXTURE_PG_DB, host: null, port: null }
```

### 3.3 `src/test/fixtures/permissions.ts` (nuevo)

```typescript
export const ROLES_SUPERADMIN = { platformRoles: ["superadmin"] };
export const ROLES_WORKSPACE_ADMIN = { platformRoles: ["workspace_admin"] };
export const ROLES_MEMBER_ONLY = { platformRoles: ["member"] }; // sin permisos de wizard
export const ROLES_TENANT_OWNER = { platformRoles: ["tenant_owner"] };
```

### 3.4 `src/test/fixtures/quotas.ts` (nuevo)

```typescript
// Cuota disponible para workspaces (1 disponible de 5)
export const QUOTA_AVAILABLE = {
  posture: {
    dimensions: [
      { dimensionId: "workspaces", isExceeded: false, remainingToHardLimit: 1 },
    ],
  },
};
// Cuota agotada
export const QUOTA_EXCEEDED = {
  posture: {
    dimensions: [
      { dimensionId: "workspaces", isExceeded: true, remainingToHardLimit: 0 },
    ],
  },
};
// Cuota disponible para bases de datos
export const QUOTA_DB_AVAILABLE = {
  workspacePosture: {
    dimensions: [
      { dimensionId: "databases", isExceeded: false, remainingToHardLimit: 3 },
    ],
  },
};
export const QUOTA_DB_EXCEEDED = {
  workspacePosture: {
    dimensions: [
      { dimensionId: "databases", isExceeded: true, remainingToHardLimit: 0 },
    ],
  },
};
```

### 3.5 `src/test/fixtures/snippets.ts` (nuevo)

```typescript
// Contextos SnippetContext representativos
export const SNIPPET_CTX_POSTGRES: SnippetContext = {
  tenantId: "ten_alpha",
  tenantSlug: "tenant-alpha",
  workspaceId: "wrk_a1",
  workspaceSlug: "workspace-alpha-1",
  resourceName: "orders",
  resourceHost: "db.example.test",
  resourcePort: 5432,
  resourceExtraA: "public",
  resourceExtraB: null,
  resourceState: "active",
  externalAccessEnabled: true,
};
export const SNIPPET_CTX_NO_ENDPOINT: SnippetContext = {
  ...SNIPPET_CTX_POSTGRES,
  resourceHost: null,
  resourcePort: null,
};
export const SNIPPET_CTX_PROVISIONING: SnippetContext = {
  ...SNIPPET_CTX_POSTGRES,
  resourceState: "provisioning",
};
export const SNIPPET_CTX_MONGO: SnippetContext = {
  ...SNIPPET_CTX_POSTGRES,
  resourceName: "events",
  resourceHost: "mongo.example.test",
  resourcePort: 27017,
};
export const SNIPPET_CTX_STORAGE: SnippetContext = {
  ...SNIPPET_CTX_POSTGRES,
  resourceName: "assets",
  resourceHost: "s3.example.test",
  resourcePort: 443,
};
export const SNIPPET_CTX_FUNCTION: SnippetContext = {
  ...SNIPPET_CTX_POSTGRES,
  resourceName: "hello",
  resourceExtraB: "https://functions.example.test/hello",
};
export const SNIPPET_CTX_IAM_CLIENT: SnippetContext = {
  ...SNIPPET_CTX_POSTGRES,
  resourceName: "atelier-console",
  resourceExtraB: "https://sso.example.test/token",
};
```

### 3.6 `src/components/console/wizards/WizardShell.test.tsx` (ampliar)

Añadir los escenarios no cubiertos por los dos tests actuales:

| ID    | Descripción                                            | Mecanismo                                                                |
| ----- | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| RW-01 | Navegación completa adelante/atrás preserva datos      | wizard de 2 pasos; avanza, retrocede, comprueba valor del campo          |
| RW-02 | Bloqueo por validación (ya parcialmente cubierto)      | input vacío → botón deshabilitado                                        |
| RW-03 | Paso de resumen muestra todos los valores introducidos | avanza hasta summary; verifica render de `buildSummary`                  |
| RW-04 | Desde resumen navegar a paso anterior                  | botón "atrás" en summary; verifica que se va al último paso              |
| RW-05 | Confirmación exitosa muestra feedback y URL            | `onSubmit` mock resuelve → `screen.findByText(/recurso creado/i)` + link |
| RW-06 | Error de backend preserva datos del formulario         | `onSubmit` mock rechaza → mensaje de error visible; datos preservados    |

### 3.7 `src/components/console/wizards/CreateTenantWizard.test.tsx` (ampliar)

| ID    | Descripción                                                               |
| ----- | ------------------------------------------------------------------------- |
| RW-07 | Cuota de tenants excedida bloquea el primer paso con aviso                |
| RW-08 | Rol sin permiso `create_tenant` muestra mensaje de permisos insuficientes |

### 3.8 `src/components/console/wizards/<Wizard>.test.tsx` (nuevos — un file por wizard restante)

Ficheros para `CreateWorkspaceWizard`, `CreateIamClientWizard`, `InviteUserWizard`, `ProvisionDatabaseWizard`, `PublishFunctionWizard`. Cada uno cubre como mínimo:

- Happy path (RW-01/RW-03/RW-05 adaptado al wizard)
- Bloqueo por validación (RW-02)
- Error de backend sin pérdida de datos (RW-06)
- Cuota excedida si aplica (RW-07)
- Sin permisos (RW-08)

### 3.9 `src/components/console/DestructiveConfirmationDialog.test.tsx` (ampliar)

Tests existentes ya cubren RC-01, RC-02, RC-04, RC-05, RC-06 (Escape), RC-07 (parcial), RC-08, RC-09. Añadir:

| ID                    | Descripción                                                | Gap                                                                                |
| --------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| RC-03                 | Resumen de cascada presenta tipos y cantidades en CRITICAL | montar con `cascadeImpact: [{resourceType:'workspace', count:2}]`; verificar texto |
| RC-06 (click-outside) | Click fuera del modal también cierra                       | completar el test de Escape con click fuera usando `overlay`                       |
| RC-07 (redirect)      | Tras confirmación exitosa se redirige                      | mock `onSuccess`; verificar que se llama tras `onConfirm` resuelve                 |
| RC-10                 | No se abren dos diálogos simultáneamente                   | renderizar dos instancias, verificar que solo una tiene `open=true` a la vez       |

### 3.10 `src/components/console/ConnectionSnippets.test.tsx` (ampliar)

Tests existentes cubren RS-01, RS-02 (implícito), RS-03 (parcial), RS-04, RS-07. Añadir:

| ID    | Descripción                                               | Gap                                                                                               |
| ----- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| RS-02 | Valores de host/puerto en snippet coinciden con context   | verificar substring del valor del fixture en el código renderizado                                |
| RS-03 | Ningún snippet expone contraseña real — sólo placeholders | verificar ausencia de strings con formato de secreto real; presencia de `<PG_USER>`, `{PASSWORD}` |
| RS-05 | Sin endpoint → placeholders genéricos + nota              | contexto con `resourceHost: null`; buscar nota explicativa                                        |
| RS-06 | Estado transitorio → advertencia visible                  | contexto con `resourceState: 'provisioning'`; buscar texto de advertencia                         |
| RS-08 | Cobertura mínima de lenguajes por tipo                    | iterar tipos soportados; verificar presencia de labels definidos en el catálogo                   |

---

## 4. Modelo de datos de prueba

No se modifica ningún modelo de datos del backend ni de la UI. Los fixtures son objetos TypeScript inmutables importados únicamente desde el código de test. Estructura conceptual:

```text
Tenant Alpha (ten_alpha)
  ├── Workspace Alpha 1 (wrk_a1)
  │     ├── PostgreSQL: orders (db.example.test:5432)
  │     ├── MongoDB: events (mongo.example.test:27017)
  │     ├── Storage Bucket: assets (s3.example.test)
  │     ├── Serverless Function: hello
  │     └── IAM Client: atelier-console
  └── Workspace Alpha 2 (wrk_a2)
        └── (vacío — para tests de cuota y permisos)

Tenant Beta (ten_beta)
  └── Workspace Beta 1 (wrk_b1)
        └── (datos separados — para tests de aislamiento multi-tenant)
```

---

## 5. Estrategia de pruebas completa

### 5.1 Nivel: Tests de componente (Vitest + Testing Library)

Todos los tests de esta tarea son **tests de componente** renderizados en `jsdom`. No requieren backend real.

- **Herramienta**: Vitest 2.x + @testing-library/react 16 + @testing-library/user-event 14
- **Entorno**: `jsdom` (configurado en `vite.config.ts` bajo `test.environment`)
- **Setup**: `src/test/setup.ts` (ya importa `@testing-library/jest-dom/vitest`)
- **Runners**: `userEvent.setup()` para interacciones realistas; `fireEvent` sólo cuando la API de eventos no es accesible

### 5.2 Convención de nombrado

```typescript
describe('WizardShell', () => {
  it('[RW-01] navega adelante y atrás preservando datos — RF-UI-025 / T02-AC1', ...)
  it('[RW-02] bloquea avance con datos inválidos — RF-UI-025 / T02-AC2', ...)
  ...
})

describe('DestructiveConfirmationDialog', () => {
  it('[RC-03] muestra resumen de cascada en CRITICAL — RF-UI-026 / T03-AC3', ...)
  ...
})

describe('ConnectionSnippets', () => {
  it('[RS-05] muestra placeholders y nota cuando no hay endpoint — RF-UI-029 / T05-AC5', ...)
  ...
})
```

### 5.3 Cobertura objetivo

| Grupo               | Tests objetivo                        | Tests existentes (estimado)                 | Tests a añadir       |
| ------------------- | ------------------------------------- | ------------------------------------------- | -------------------- |
| RW (Wizards)        | 8 escenarios × 6 wizards = 48 mínimos | ~4 (WizardShell x2, CreateTenant x1, basic) | ~44 tests nuevos     |
| RC (Confirmaciones) | 10 escenarios                         | ~7 existentes                               | ~3 tests nuevos      |
| RS (Snippets)       | 8 escenarios                          | ~5 existentes                               | ~3 tests nuevos      |
| **Total**           | **≥ 26 (spec mínimo)**                | ~16                                         | **~50 tests nuevos** |

> Nota: la spec exige 26 tests mínimos; la suite completa será más extensa al cubrir los 6 wizards individualmente. El umbral de 26 se cumple como mínimo.

### 5.4 Criterios de calidad de los tests

1. **Aislamiento**: cada test usa `afterEach(() => cleanup())` y restablece mocks con `vi.restoreAllMocks()`.
2. **Determinismo**: no existen dependencias de orden de ejecución; los `vi.mock` se declaran antes de las importaciones (hoisting).
3. **Legibilidad**: cada `it()` incluye el ID del escenario y la referencia al RF/criterio de aceptación.
4. **Sin lógica de negocio duplicada**: los tests únicamente aseveran sobre elementos del DOM y llamadas a mocks.

### 5.5 Tests de contrato de mocks

Añadir en `src/lib/snippets/snippet-catalog.test.ts` (ya existe) una verificación de que la estructura de cada entrada del catálogo es válida contra `SnippetTemplate`, como guard para que los mocks no diverjan del contrato real.

### 5.6 Tests de regresión de aislamiento multi-tenant

En `ConnectionSnippets.test.tsx` y en `DestructiveConfirmationDialog.test.tsx`, añadir al menos un caso que:

- Renderiza el componente con el contexto de `TENANT_ALPHA / WORKSPACE_A1`
- Verifica que los valores del contexto de `TENANT_BETA` no aparecen en ningún lugar del DOM

---

## 6. Contratos de mocks de API

### 6.1 `requestConsoleSessionJson` (wizards)

```typescript
// Mock mínimo para wizard de tenant
vi.mock("@/lib/console-session", () => ({
  readConsoleShellSession: () => ({
    principal: { platformRoles: ["superadmin"] },
  }),
  requestConsoleSessionJson: vi
    .fn()
    .mockResolvedValueOnce({ tenantId: "ten_new" }), // respuesta de creación
}));
```

**Contrato de respuesta esperado:**

```json
// POST /v1/admin/tenants
{ "tenantId": "ten_new" }
// POST /v1/admin/workspaces
{ "workspaceId": "wrk_new" }
// POST /v1/admin/iam/clients
{ "clientId": "client_new" }
// POST /v1/admin/members/invite
{ "invitationId": "inv_new" }
// POST /v1/workspaces/{id}/databases
{ "databaseId": "db_new" }
// POST /v1/workspaces/{id}/functions/publish
{ "functionId": "fn_new" }
```

### 6.2 `fetchCascadeImpact` (confirmaciones)

```typescript
// Mock para cascada real
vi.mock("@/lib/http", () => ({
  requestJson: vi.fn().mockResolvedValue({
    dependents: [
      { resourceType: "workspace", count: 2 },
      { resourceType: "database", count: 5 },
    ],
  }),
}));
```

**Contrato de respuesta esperado (`GET /admin/v1/{type}/{id}/cascade-impact`):**

```json
{
  "dependents": [
    { "resourceType": "workspace", "count": 2 },
    { "resourceType": "database", "count": 5 }
  ]
}
```

### 6.3 `useConsoleQuotas` (cuotas en wizards)

```typescript
vi.mock("@/lib/console-quotas", () => ({
  useConsoleQuotas: () => QUOTA_EXCEEDED,
}));
```

---

## 7. Observabilidad y telemetría de la suite

### 7.1 Reporte de CI

El runner de Vitest produce por defecto salida de texto estructurada (TAP-like). Para CI se añade el reporter `junit` en la invocación:

```bash
# En el script de CI (ya configurado en package.json como "test")
vitest run --reporter=verbose --reporter=junit --outputFile=test-results/junit.xml
```

El pipeline puede consumir `test-results/junit.xml` para el panel de test results.

### 7.2 Cobertura

La cobertura de los nuevos tests se añade a la configuración existente expandiendo el campo `include`:

```typescript
// vite.config.ts — sección test.coverage.include
include: [
  "src/pages/**/*.tsx",
  "src/components/console/wizards/*.tsx", // nuevo
  "src/components/console/DestructiveConfirmationDialog.tsx", // nuevo
  "src/components/console/ConnectionSnippets.tsx", // nuevo
  "src/lib/console-wizards.ts", // nuevo
  "src/lib/destructive-ops.ts", // nuevo
  "src/lib/snippets/*.ts", // nuevo
];
```

### 7.3 Criterios observables de éxito en CI

- Exit code 0 cuando todos los tests pasan.
- Reporte JUnit generado en `apps/web-console/test-results/junit.xml`.
- Tiempo de ejecución de la suite < 5 minutos (umbral del criterio RF-RT-09); verificable con `--reporter=verbose` (imprime duración total).
- Coverage report generado en `apps/web-console/coverage/` (HTML + texto).

---

## 8. Secuencia de implementación recomendada

### Fase 0 — Infraestructura de fixtures (½ día)

1. Crear `src/test/fixtures/` con los 5 ficheros de fixtures.
2. Verificar que los tipos importados de `@/lib/snippets/snippet-types` y `@/lib/destructive-ops` son compatibles con los fixtures.
3. Ejecutar `vitest run` y confirmar que los tests existentes siguen pasando.

### Fase 1 — Suite RC: Confirmaciones destructivas (½ día)

1. Ampliar `DestructiveConfirmationDialog.test.tsx` con RC-03, RC-06 (click-outside), RC-07, RC-10.
2. Ejecutar el grupo RC; todos los tests del grupo deben pasar.

### Fase 2 — Suite RS: Snippets (½ día)

1. Ampliar `ConnectionSnippets.test.tsx` con RS-02, RS-03, RS-05, RS-06, RS-08.
2. Añadir los tests de aislamiento multi-tenant en el mismo fichero.
3. Ejecutar el grupo RS; todos los tests del grupo deben pasar.

### Fase 3 — Suite RW: WizardShell genérico (½ día)

1. Ampliar `WizardShell.test.tsx` con RW-01, RW-03, RW-04, RW-06.
2. Verificar que los dos tests de WizardShell existentes siguen siendo válidos.

### Fase 4 — Suite RW: Wizards específicos (1 día)

1. Ampliar `CreateTenantWizard.test.tsx` con RW-07 y RW-08.
2. Crear `CreateWorkspaceWizard.test.tsx`, `CreateIamClientWizard.test.tsx`, `InviteUserWizard.test.tsx`, `ProvisionDatabaseWizard.test.tsx`, `PublishFunctionWizard.test.tsx`.
3. Para cada wizard: happy path + validación bloqueante + error backend + cuota (si aplica) + permisos.

### Fase 5 — Configuración CI y cobertura (¼ día)

1. Actualizar `vite.config.ts` (`coverage.include`).
2. Añadir o actualizar el script de CI para incluir `--reporter=junit`.
3. Ejecutar la suite completa; verificar exit code y tiempo.

### Paralelización posible

- Fases 1, 2 y 3 son independientes entre sí y pueden asignarse a diferentes ingenieros.
- Fase 4 requiere que Fase 3 esté completa (WizardShell debe ser estable antes de los wizards específicos).
- Fase 0 es prerequisito de todas las demás.

---

## 9. Riesgos, compatibilidad y rollback

| Riesgo                                                         | Probabilidad | Impacto | Mitigación                                                                                                                                                                        |
| -------------------------------------------------------------- | ------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T02/T03/T05 no están completamente implementados               | Media        | Alto    | Los tests se escriben contra la interfaz pública de los componentes (props + DOM); si el componente no existe aún, se usa un stub mínimo. Los tests fallidos actúan como gate.    |
| Componentes sin `data-testid` o roles ARIA insuficientes       | Baja         | Medio   | Los componentes existentes ya usan roles ARIA y `shadcn/ui` (Radix). Si falta cobertura, se añade `data-testid` en el componente (cambio no rompedor).                            |
| Mocks desincronizados de las APIs reales                       | Media        | Medio   | Los contratos de los mocks se derivan de las specs. El test de contrato en `snippet-catalog.test.ts` añade un guard.                                                              |
| Timeout en el test `RS-04` (resetea feedback visual tras 2.6s) | Media        | Bajo    | El test ya usa `setTimeout(2600ms)` con un timeout de test de 8000ms. Si hay flakiness en CI, se puede aumentar el `fake timer` de Vitest para aislar el timeout sin espera real. |
| Wizard con lógica asíncrona de validación de nombre            | Baja         | Bajo    | `useAsyncNameValidator` usa `window.setTimeout`; en tests, `vi.useFakeTimers()` permite avanzar el reloj de forma determinista.                                                   |

### Compatibilidad

- Sin migraciones de base de datos.
- Sin cambios en APIs de backend.
- Sin cambios de configuración de Helm/Kubernetes.
- Los cambios en `vite.config.ts` (`coverage.include`) son aditivos y no afectan a builds de producción.

### Rollback

- Al ser únicamente código de test, el rollback es eliminar los ficheros añadidos. No existe riesgo de regresión en producción.

---

## 10. Seguridad y privacidad en los fixtures

- Ningún fixture contiene contraseñas, tokens ni credenciales reales.
- Los valores de host (`db.example.test`, `mongo.example.test`, etc.) usan el dominio de test reservado `example.test` (RFC 2606).
- Los tests de snippets verifican activamente que no se renderiza ningún secreto real (RS-03): si un futuro cambio rompe el enmascaramiento, el test falla de forma inmediata.
- Los `vi.stubGlobal` se restauran con `vi.restoreAllMocks()` en `afterEach` para no contaminar otros tests.

---

## 11. Criterios de done verificables

| #      | Criterio                                                                                                                                  | Evidencia                                                                                                      |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| DoD-1  | La suite contiene ≥ 26 tests (8 RW + 10 RC + 8 RS) identificados con su ID de escenario                                                   | `vitest run --reporter=verbose` lista todos los tests; grep de IDs `RW-`, `RC-`, `RS-`                         |
| DoD-2  | Todos los tests pasan con `vitest run` sin errores ni skips                                                                               | Exit code 0; sin `[skipped]` en la salida                                                                      |
| DoD-3  | La suite se ejecuta sin backend real (mocks cubren todas las llamadas de red)                                                             | `vitest run` en entorno sin red; no hay errores de `ECONNREFUSED` ni `fetch failed`                            |
| DoD-4  | Cada test documenta trazabilidad con ID de escenario y referencia al criterio de aceptación de T02/T03/T05                                | Inspección de nombres de tests en output de verbose                                                            |
| DoD-5  | Los fixtures modelan ≥ 2 tenants, ≥ 3 workspaces, recursos de los 5 tipos soportados, permisos diferenciados, cuota disponible y excedida | Inspección de `src/test/fixtures/`                                                                             |
| DoD-6  | El tiempo de ejecución de la suite completa es < 5 minutos en CI                                                                          | Tiempo impreso por Vitest en la línea `Tests completed in X.XXs`                                               |
| DoD-7  | Añadir un test nuevo no requiere modificar tests existentes ni el setup                                                                   | Verificación empírica: añadir un `it.skip('dummy', ...)` y ejecutar; los demás siguen pasando                  |
| DoD-8  | Los tests de snippets confirman que ningún snippet expone credenciales reales                                                             | Test RS-03 pasa; revisión de fixtures para ausencia de contraseñas                                             |
| DoD-9  | Los tests de multi-tenancy confirman que solo se muestran datos del contexto activo                                                       | Test dedicado de aislamiento en `ConnectionSnippets.test.tsx` y `DestructiveConfirmationDialog.test.tsx` pasan |
| DoD-10 | `vite.config.ts` actualizado con cobertura sobre los módulos nuevos; reporte de cobertura generado                                        | `vitest run --coverage` genera `coverage/index.html` con los módulos listados                                  |

---

## 12. Dependencias previas

| Dependencia                                | Estado requerido                                                                                                                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| US-UI-04-T02 (wizards)                     | Los 6 componentes de wizard deben existir y ser importables. Si no están terminados, los tests se escriben contra el contrato de props y fallan hasta que el componente esté listo (actuando como gate de calidad). |
| US-UI-04-T03 (confirmaciones destructivas) | `DestructiveConfirmationDialog` y `useDestructiveOp` deben existir. Ya están implementados.                                                                                                                         |
| US-UI-04-T05 (snippets)                    | `ConnectionSnippets` y el catálogo de snippets deben existir. Ya están implementados.                                                                                                                               |
| Vitest + Testing Library                   | Ya configurados en el monorepo. Sin cambios requeridos.                                                                                                                                                             |
| CI pipeline                                | Debe soportar `vitest run`; ya lo hace (script `test` en `package.json`).                                                                                                                                           |

---

_Plan elaborado para US-UI-04-T06 — pruebas de regresión de UX para wizards, confirmaciones y snippets. Cubre los 26 escenarios de aceptación de la spec con una estrategia incremental, fixtures compartidos y ejecución determinista en CI sin backend real._
