# Plan de Implementación: US-BKP-01-T01 — Visibilidad del Estado de Backup de Componentes Gestionados

**Branch**: `109-backup-status-visibility` | **Fecha**: 2026-03-31 | **Spec**: `specs/109-backup-status-visibility/spec.md`\
**Input**: Especificación de feature US-BKP-01-T01 | **Tamaño**: M | **Prioridad**: P1

---

## Resumen ejecutivo

Implementar la capa de visibilidad de estado de backup de los componentes gestionados de la plataforma BaaS multi-tenant. La solución se basa en un modelo de adaptadores por tipo de componente, un colector periódico (acción OpenWhisk con cron alarm) que materializa snapshots en PostgreSQL, un endpoint REST de consulta expuesto vía APISIX con auth JWT de Keycloak, y dos vistas en la consola React: una vista técnica para superadmin/SRE y un resumen funcional para el tenant owner. La arquitectura es de solo lectura; ningún flujo de esta tarea inicia, cancela ni restaura backups.

---

## Contexto técnico

- **Lenguaje/Runtime**: Node.js 20+ ESM, TypeScript (acciones OpenWhisk), React 18 + Tailwind + shadcn/ui (consola)
- **Infraestructura de compute**: OpenWhisk (acciones serverless para colector y API handler)
- **Base de datos**: PostgreSQL (snapshots de estado de backup), existente en el monorepo
- **Gateway**: Apache APISIX (enrutado, auth JWT, rate limiting)
- **IAM**: Keycloak (tokens JWT, scopes y roles)
- **Eventos**: Kafka (eventos operacionales del ciclo de recolección)
- **Plataforma de despliegue**: Kubernetes / OpenShift vía Helm
- **Monorepo**: `in-falcone` (estructura existente, convenciones de specs 097–108)
- **Dependencias funcionales**: US-OBS-01 (pipeline de auditoría), US-DEP-03 (modelo de perfil de despliegue)

---

## Verificación de constitución

- **Separación de concerns**: PASS — Nuevo módulo `services/backup-status/` independiente, sin modificar lógica existente de otros dominios
- **Entrega incremental**: PASS — Cada subsistema (schema, colector, API, frontend) se entrega como commits atómicos
- **Compatibilidad K8s/OpenShift**: PASS — El colector usa cron alarms de OpenWhisk; no requiere CronJob de K8s adicional
- **Multi-tenant**: PASS — Todo el modelo de datos incluye `tenant_id`; aislamiento garantizado por DB query y gateway policy
- **Solo lectura**: PASS — Esta tarea no expone mutaciones de backup ni restauración

---

## Estructura del proyecto

### Documentación (esta feature)

```text
specs/109-backup-status-visibility/
├── spec.md
├── plan.md          ← este fichero
└── tasks.md
```

### Código fuente (raíz del repositorio)

```text
services/backup-status/
├── src/
│   ├── adapters/
│   │   ├── types.ts                            # NUEVO — Interfaz BackupAdapter y tipos compartidos
│   │   ├── registry.ts                         # NUEVO — Registro de adaptadores por componentType
│   │   ├── postgresql.adapter.ts               # NUEVO — Adaptador concreto para PostgreSQL
│   │   ├── mongodb.adapter.ts                  # NUEVO — Stub/adaptador para MongoDB (not_available si no instrumentado)
│   │   ├── s3.adapter.ts                       # NUEVO — Stub/adaptador para S3-compatible
│   │   ├── keycloak.adapter.ts                 # NUEVO — Stub/adaptador para Keycloak
│   │   └── kafka.adapter.ts                    # NUEVO — Stub/adaptador para Kafka
│   ├── collector/
│   │   ├── collector.action.ts                 # NUEVO — Acción OpenWhisk: colector periódico
│   │   ├── collector.config.ts                 # NUEVO — Config de frecuencia y timeouts por componente
│   │   └── collector.types.ts                  # NUEVO — Tipos internos del colector
│   ├── api/
│   │   ├── backup-status.action.ts             # NUEVO — Acción OpenWhisk: handler de API REST
│   │   ├── backup-status.schema.ts             # NUEVO — Esquema JSON de response versionado
│   │   └── backup-status.auth.ts               # NUEVO — Validación de JWT y enforcement de roles
│   ├── db/
│   │   ├── migrations/
│   │   │   └── 001_backup_status_snapshots.sql # NUEVO — Migración PostgreSQL
│   │   └── repository.ts                       # NUEVO — Data access layer sobre PostgreSQL
│   └── shared/
│       ├── deployment-profile.ts               # NUEVO — Consulta perfil de despliegue (integra US-DEP-03)
│       └── audit.ts                            # NUEVO — Emite eventos de acceso vía pipeline US-OBS-01
├── test/
│   ├── unit/
│   │   ├── adapters/
│   │   │   └── postgresql.adapter.test.ts      # NUEVO
│   │   ├── collector/
│   │   │   └── collector.action.test.ts        # NUEVO
│   │   └── api/
│   │       └── backup-status.action.test.ts    # NUEVO
│   ├── integration/
│   │   └── backup-status-api.test.mjs          # NUEVO — Prueba API end-to-end contra DB real
│   └── contract/
│       └── backup-status-response.contract.ts  # NUEVO — Validación del esquema de response
├── package.json                                # NUEVO
└── tsconfig.json                               # NUEVO

services/gateway-config/
└── routes/
    └── backup-status-routes.yaml               # NUEVO — Rutas APISIX para el endpoint de backup

services/keycloak-config/
└── scopes/
    └── backup-status-scopes.yaml               # NUEVO — Scopes y permisos de Keycloak

apps/console/
└── src/
    ├── pages/
    │   ├── admin/
    │   │   └── BackupStatusPage.tsx             # NUEVO — Vista admin (superadmin/SRE)
    │   └── tenant/
    │       └── BackupSummaryPage.tsx            # NUEVO — Vista resumen del tenant owner
    ├── components/backup/
    │   ├── BackupStatusTable.tsx                # NUEVO — Tabla de componentes con estados
    │   ├── BackupStatusBadge.tsx                # NUEVO — Badge de estado (OK/Warning/Error/…)
    │   ├── BackupStatusDetail.tsx               # NUEVO — Panel de detalle de una instancia
    │   ├── BackupNotAvailable.tsx               # NUEVO — Mensaje explícito de no disponibilidad
    │   └── BackupSummaryCard.tsx                # NUEVO — Tarjeta resumen funcional para tenant
    ├── hooks/
    │   └── useBackupStatus.ts                   # NUEVO — Hook de fetch con refresco periódico
    └── lib/api/
        └── backup-status.api.ts                 # NUEVO — Cliente HTTP para el endpoint de backup

helm/
└── charts/backup-status/
    ├── Chart.yaml                               # NUEVO
    ├── values.yaml                              # NUEVO — collector_interval, adapter_timeouts, feature flags
    └── templates/
        ├── openwhisk-alarm.yaml                 # NUEVO — Cron alarm OpenWhisk para el colector
        ├── openwhisk-trigger.yaml               # NUEVO
        ├── openwhisk-rule.yaml                  # NUEVO
        ├── openwhisk-actions.yaml               # NUEVO — Deploy de las acciones
        └── secret.yaml                          # NUEVO — Credenciales de service account del colector
```

---

## Arquitectura y flujo de datos

### Diagrama de flujo (ASCII)

```
┌─────────────────────────────────────────────────────────────────────────┐
│  RECOLECCIÓN PERIÓDICA (OpenWhisk Cron Alarm)                           │
│                                                                          │
│  alarm ──► trigger ──► rule ──► collector.action                        │
│                                       │                                  │
│               ┌───────────────────────┘                                  │
│               │  Para cada (tenant, component_instance):                 │
│               ▼                                                          │
│       AdapterRegistry.get(componentType)                                 │
│               │                                                          │
│       ┌───────┴──────┐                                                   │
│       │   Adapter    │ ← credenciales mínimas (solo lectura de estado)   │
│       │  .check()    │   timeout configurable por adaptador              │
│       └───────┬──────┘                                                   │
│               │ BackupCheckResult                                         │
│               ▼                                                          │
│       repository.upsertSnapshot()                                        │
│               │                                                          │
│               ▼                                                          │
│       PostgreSQL: backup_status_snapshots                                 │
│               │                                                          │
│               ▼                                                          │
│       Kafka: platform.backup.collector.events  (resultado del ciclo)     │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  CONSULTA DE ESTADO (REST API vía APISIX)                               │
│                                                                          │
│  Client ──► APISIX (JWT auth, role check) ──► backup-status.action      │
│                                                        │                 │
│                                        ┌───────────────┘                 │
│                                        │  1. Validar JWT + rol           │
│                                        │  2. Extraer tenant_id (scope)   │
│                                        │  3. repository.getSnapshots()   │
│                                        │  4. Filtrar shared instances    │
│                                        │     (tenant owner no ve tech)   │
│                                        │  5. Emitir evento de auditoría  │
│                                        │  6. Serializar respuesta        │
│                                        └──────────────► JSON Response    │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│  CONSOLA REACT                                                           │
│                                                                          │
│  BackupStatusPage (admin) ──► useBackupStatus() ──► backup-status.api   │
│  BackupSummaryPage (tenant) ──► useBackupStatus() ──► backup-status.api │
│                                                                          │
│  Auto-refresco: intervalo configurable (default 5 min consola admin,    │
│                 15 min consola tenant)                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Componentes y responsabilidades

| Componente | Responsabilidad |
|---|---|
| `collector.action` | Orquesta el ciclo de recolección; itera instancias registradas; llama adaptadores; persiste snapshots; emite evento operacional |
| `AdapterRegistry` | Mapeo `componentType → BackupAdapter`; devuelve `not_available` si no hay adaptador registrado |
| `BackupAdapter` (interfaz) | Contrato común: `check(instanceId, tenantId, ctx) → BackupCheckResult` |
| `PostgresAdapter` | Adaptador concreto (MVP): consulta estado de backup de instancias PostgreSQL vía Barman API o VolumeSnapshot status en K8s |
| `repository` | DAL sobre la tabla `backup_status_snapshots`; `upsertSnapshot`, `getByTenant`, `getAll` |
| `backup-status.action` | Handler REST: valida JWT, aplica RBAC, consulta repository, serializa respuesta, emite auditoría |
| `deployment-profile` | Wrapper sobre US-DEP-03: dice qué componentes están presentes y si tienen backup habilitado |
| APISIX route | Valida JWT, extrae claims, forwarda a la acción OpenWhisk; aplica rate limiting |
| Keycloak scopes | `backup-status:read:own`, `backup-status:read:global`, `backup-status:read:technical` |

---

## Modelo de datos

### Tabla principal: `backup_status_snapshots`

```sql
CREATE TABLE backup_status_snapshots (
  id                       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                TEXT          NOT NULL,
  component_type           TEXT          NOT NULL,
  -- 'postgresql' | 'mongodb' | 's3' | 'keycloak' | 'kafka'
  instance_id              TEXT          NOT NULL,
  instance_label           TEXT,
  -- etiqueta funcional para tenant owners ("Base de datos relacional")
  deployment_profile       TEXT,
  -- slug del perfil de despliegue cuando se tomó el snapshot
  is_shared_instance       BOOLEAN       NOT NULL DEFAULT FALSE,
  -- TRUE = instancia compartida entre tenants; solo roles privilegiados la ven
  status                   TEXT          NOT NULL,
  -- 'success' | 'failure' | 'partial' | 'in_progress'
  -- | 'not_configured' | 'not_available' | 'pending'
  last_successful_backup_at TIMESTAMPTZ,
  last_checked_at          TIMESTAMPTZ   NOT NULL,
  detail                   TEXT,
  -- detalle textual opcional (no expuesto a tenant owners)
  adapter_metadata         JSONB,
  -- campos extra del adaptador (no expuestos en API pública)
  collected_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_backup_snapshot UNIQUE (tenant_id, component_type, instance_id)
);

CREATE INDEX idx_backup_snapshots_tenant
  ON backup_status_snapshots(tenant_id, last_checked_at DESC);

CREATE INDEX idx_backup_snapshots_status
  ON backup_status_snapshots(status, last_checked_at DESC);
```

> **Nota**: El constraint `UNIQUE (tenant_id, component_type, instance_id)` permite hacer upsert en el colector: cada ciclo actualiza el snapshot existente en lugar de insertar filas nuevas, manteniendo historial mínimo en la misma fila.

### Tipos de estado permitidos

| Estado | Significado |
|---|---|
| `success` | Último backup completado sin errores |
| `failure` | Último backup falló o superó el umbral de antigüedad |
| `partial` | Backup con resultado mixto (p. ej., datos OK, índices no) |
| `in_progress` | Backup en curso en el momento de la consulta |
| `not_configured` | El componente no tiene mecanismo de backup configurado en este despliegue |
| `not_available` | No existe adaptador para este tipo de componente |
| `pending` | Tenant/instancia recién creado, sin historial de backup |

### Esquema de respuesta API (v1)

```json
{
  "schema_version": "1",
  "tenant_id": "tenant-abc",
  "queried_at": "2026-03-31T21:00:00Z",
  "components": [
    {
      "component_type": "postgresql",
      "instance_id": "pg-cluster-12",
      "instance_label": "Base de datos relacional",
      "status": "success",
      "last_successful_backup_at": "2026-03-31T18:00:00Z",
      "last_checked_at": "2026-03-31T20:55:00Z",
      "stale": false,
      "stale_since": null
    },
    {
      "component_type": "mongodb",
      "instance_id": "mongo-tenant-3",
      "instance_label": "Base de datos documental",
      "status": "not_configured",
      "last_successful_backup_at": null,
      "last_checked_at": "2026-03-31T20:55:00Z",
      "stale": false,
      "stale_since": null
    }
  ],
  "deployment_backup_available": true
}
```

> **Campos excluidos para tenant owners**: `adapter_metadata`, `detail` (si contiene rutas internas), identificadores técnicos de infraestructura (los tenant owners ven solo `instance_label`, no `instance_id`).

### Campo `stale`

`stale = true` cuando `NOW() - last_checked_at > stale_threshold_ms` (configurable, default 2× el intervalo del colector). Indica que el snapshot puede estar desactualizado (p. ej., el adaptador falló en el último ciclo y se muestra el valor anterior).

---

## Interfaz de adaptadores (TypeScript)

```typescript
// services/backup-status/src/adapters/types.ts

export type BackupStatus =
  | 'success'
  | 'failure'
  | 'partial'
  | 'in_progress'
  | 'not_configured'
  | 'not_available'
  | 'pending';

export interface AdapterContext {
  deploymentProfile: string;
  serviceAccountToken?: string;
  k8sNamespace?: string;
  adapterConfig?: Record<string, unknown>;
}

export interface BackupCheckResult {
  status: BackupStatus;
  lastSuccessfulBackupAt?: Date;
  detail?: string;
  metadata?: Record<string, unknown>;
}

export interface BackupAdapter {
  readonly componentType: string;
  readonly instanceLabel: string;
  check(
    instanceId: string,
    tenantId: string,
    context: AdapterContext
  ): Promise<BackupCheckResult>;
}
```

### Adaptador MVP: PostgreSQL

El adaptador de PostgreSQL (único obligatorio para MVP) consulta el estado de backup mediante una de estas estrategias (ordenadas por preferencia según disponibilidad en el despliegue):

1. **Velero VolumeSnapshot API** (K8s): Consulta el CRD `VolumeSnapshot` asociado a los PVCs del cluster PG. Estado `readyToUse: true` → `success`.
2. **Barman API**: Si el operador CloudNativePG/Barman está disponible, consulta el endpoint `/api/v1/backups` del cluster para obtener la fecha del último backup exitoso.
3. **K8s Backup Annotation**: Lee anotaciones `backup.kubernetes.io/last-success-timestamp` del StatefulSet/Pod si las establece el operador.
4. **Fallback**: Si ninguna estrategia aplica, devuelve `not_configured`.

El adaptador no tiene conocimiento de la estrategia concreta en tiempo de compilación; prueba las estrategias en orden y usa la primera que responde.

---

## Permisos y RBAC

### Scopes de Keycloak

| Scope | Descripción |
|---|---|
| `backup-status:read:own` | Leer estado de backup del propio tenant (tenant owner, workspace admin) |
| `backup-status:read:global` | Leer estado de backup de todos los tenants (SRE, superadmin) |
| `backup-status:read:technical` | Ver identificadores técnicos de infraestructura en la respuesta (SRE, superadmin) |

### Mapping rol → scope

| Rol Keycloak | Scopes asignados |
|---|---|
| `tenant_owner` | `backup-status:read:own` |
| `workspace_admin` | `backup-status:read:own` |
| `sre` | `backup-status:read:own`, `backup-status:read:global`, `backup-status:read:technical` |
| `superadmin` | `backup-status:read:own`, `backup-status:read:global`, `backup-status:read:technical` |
| `service_account_collector` | (credencial interna, no pasa por la API pública) |

### Lógica de enforcement en `backup-status.action`

```
1. Extraer JWT del header Authorization
2. Validar firma y expiración (Keycloak JWKS)
3. Si el request incluye ?tenant_id=X:
   a. Si el token tiene scope global → permitir cualquier tenant_id
   b. Si el token solo tiene scope own → solo permite tenant_id == token.tenant_id
   c. Si no → 403 Forbidden
4. Si el request NO incluye ?tenant_id (vista global):
   a. Si el token tiene scope global → devuelve todos los tenants
   b. Si no → 403 Forbidden
5. Aplicar filtro de is_shared_instance:
   a. Si el token NO tiene scope technical → excluir instancias shared
   b. Excluir campos detail e instance_id de la respuesta
```

---

## Ciclo de recolección

### Configuración (Helm values)

```yaml
# helm/charts/backup-status/values.yaml
collector:
  enabled: true
  schedule: "*/5 * * * *"      # cada 5 minutos
  stale_threshold_minutes: 15  # snapshot se marca stale si supera este umbral
  adapter_timeout_ms: 10000    # timeout por adaptador (10s)
  adapters:
    postgresql:
      enabled: true
      strategy: "auto"          # auto | velero | barman | annotation | none
    mongodb:
      enabled: false            # desactivado hasta tener adaptador concreto
    s3:
      enabled: false
    keycloak:
      enabled: false
    kafka:
      enabled: false
```

### Flujo del colector (pseudocódigo)

```
async function runCollector(params, context) {
  const profile = await deploymentProfile.getCurrent();
  const instances = await deploymentProfile.getManagedInstances(); // US-DEP-03

  const results = [];

  for (const instance of instances) {
    const adapter = adapterRegistry.get(instance.componentType);

    let result: BackupCheckResult;
    try {
      result = await Promise.race([
        adapter.check(instance.id, instance.tenantId, { deploymentProfile: profile }),
        timeout(config.adapter_timeout_ms, { status: 'not_available', detail: 'adapter_timeout' })
      ]);
    } catch (err) {
      // Si el adaptador falla, mantener último snapshot con flag stale
      result = { status: 'not_available', detail: 'adapter_error' };
    }

    await repository.upsertSnapshot({
      tenantId: instance.tenantId,
      componentType: instance.componentType,
      instanceId: instance.id,
      instanceLabel: instance.label,
      ...result,
      lastCheckedAt: new Date()
    });

    results.push({ instanceId: instance.id, status: result.status });
  }

  // Emitir evento operacional del ciclo (no de auditoría de usuario)
  await kafka.produce('platform.backup.collector.events', {
    type: 'backup_collection_cycle_completed',
    timestamp: new Date().toISOString(),
    results_summary: summarize(results)
  });

  return { ok: true, processed: results.length };
}
```

---

## Rutas APISIX

```yaml
# services/gateway-config/routes/backup-status-routes.yaml

- id: backup-status-get
  uri: /v1/backup/status
  methods: [GET]
  upstream_id: openwhisk-backup-status
  plugins:
    openid-connect:
      discovery: "${KEYCLOAK_DISCOVERY_URL}"
      required_scopes: ["backup-status:read:own"]
    response-rewrite:
      headers:
        Cache-Control: "no-store"
    limit-req:
      rate: 10
      burst: 20
      key: consumer_name
```

---

## Estrategia de tests

### Pirámide de testing

| Capa | Framework | Foco | Ficheros |
|---|---|---|---|
| **Unit** | Vitest (TS) | Adaptadores, repository, serialización, filtrado de roles | `test/unit/**/*.test.ts` |
| **Integration** | `node:test` nativo | API end-to-end contra DB real + colector contra adaptador mockeado | `test/integration/backup-status-api.test.mjs` |
| **Contract** | Vitest + JSON Schema validator | Payload del endpoint cumple el schema versionado `v1` | `test/contract/backup-status-response.contract.ts` |
| **E2E** | Playwright (opcional) | Consola admin muestra tabla con badges correctos; consola tenant muestra resumen | `apps/console/e2e/backup-status.spec.ts` |

### Cobertura mínima por criterio de aceptación

| CA del spec | Test |
|---|---|
| CA-01 (endpoint devuelve estado con tenant) | integration: `GET /v1/backup/status?tenant_id=X` con snapshot `success` en DB |
| CA-02 (`not_configured` para componente sin backup) | integration: snapshot `not_configured` en DB → aparece en respuesta |
| CA-03 (`not_available` para tipo sin adaptador) | unit: `AdapterRegistry.get('unknown')` devuelve `not_available` |
| CA-04 (aislamiento multi-tenant) | integration: token tenant-A solo ve componentes de tenant-A |
| CA-05 (403 para tenant owner en vista global) | integration: `GET /v1/backup/status` sin tenant_id + token con scope own → 403 |
| CA-06 (badges en consola admin) | E2E Playwright o test de componente React |
| CA-07 (resumen funcional en consola tenant) | E2E Playwright o test de componente React |
| CA-08 (mensaje explícito no disponible) | integration: `deployment_backup_available: false` en respuesta cuando no hay adaptadores activos |
| CA-09 (degradación informativa ante timeout) | unit: colector marca snapshot como `not_available` + stale al expirar timeout |
| CA-10 (ciclo de recolección actualiza estado) | integration: ejecutar colector → cambio de snapshot → API devuelve nuevo estado |
| CA-11 (payload no expone info sensible) | contract: schema validator rechaza respuestas que incluyan campos prohibidos |

### Test unitario del adaptador PostgreSQL

```typescript
// test/unit/adapters/postgresql.adapter.test.ts

describe('PostgresAdapter.check()', () => {
  it('returns success when VolumeSnapshot readyToUse=true', async () => { ... });
  it('returns in_progress when VolumeSnapshot readyToUse=false', async () => { ... });
  it('returns not_configured when no VolumeSnapshot CRD found', async () => { ... });
  it('returns not_available on timeout', async () => { ... });
  it('returns failure when last successful backup older than threshold', async () => { ... });
});
```

---

## Riesgos y mitigaciones

| ID | Descripción | Probabilidad | Impacto | Mitigación |
|---|---|---|---|---|
| R-01 | El despliegue de referencia no tiene ningún mecanismo de backup observable (sin Velero, sin Barman, sin anotaciones) | Media | Alto | El adaptador PostgreSQL implementa fallback a `not_configured`. La tarea sigue siendo demostrable aunque el estado MVP sea `not_configured` para todos los componentes. El contrato y la UI se validan igualmente. |
| R-02 | US-DEP-03 (modelo de perfil de despliegue) no expone la lista de instancias gestionadas con suficiente granularidad | Media | Alto | Definir una interfaz provisional `ManagedInstance[]` que puede ser hardcodeada en el colector hasta que US-DEP-03 la provea. Anotar como deuda técnica. |
| R-03 | Volumen de snapshots crece sin límite (N instancias × M tenants × ciclos) | Baja | Medio | La constraint `UNIQUE` + upsert garantiza 1 fila por (tenant, component, instance). No hay acumulación histórica en esta tarea. El historial detallado es scope de US-BKP-01-T03. |
| R-04 | El adaptador PostgreSQL tarda más que el timeout configurado en despliegues con muchas instancias | Media | Medio | Timeout configurable por adaptador (default 10s); el colector continúa con las demás instancias. El snapshot previo se marca `stale`. |
| R-05 | La consola del tenant expone información técnica inadvertidamente (instance_id filtrado incorrectamente) | Baja | Alto | La serialización tiene dos modos: `technical=true/false`. Test de contrato verifica que `instance_id` no aparece en respuestas con scope `read:own`. |
| R-06 | Dependencia en pipeline de auditoría (US-OBS-01) no disponible en entorno de test | Media | Bajo | El módulo `audit.ts` tiene un fallback a log local si Kafka no está disponible. La funcionalidad de backup status no se bloquea por fallos de auditoría. |

---

## Compatibilidad, rollback e idempotencia

- **Migración DB**: Solo añade una tabla nueva. No modifica tablas existentes. Rollback: `DROP TABLE backup_status_snapshots;`.
- **OpenWhisk actions**: Deploy incremental. Si el colector falla, no afecta a otras acciones de la plataforma.
- **APISIX routes**: Route nueva, no modifica rutas existentes. Rollback: eliminar la ruta.
- **Keycloak scopes**: Nuevos scopes que se asignan a roles existentes. Rollback: desvincular scopes de roles.
- **Idempotencia del colector**: El upsert con constraint UNIQUE garantiza que múltiples ejecuciones del colector son idempotentes. El colector puede ejecutarse más frecuentemente sin efectos secundarios.
- **Feature flag**: El chart Helm incluye `collector.enabled: true/false`. Con `false`, el colector no se despliega y la API devuelve snapshots vacíos con `deployment_backup_available: false`.

---

## Observabilidad y seguridad

### Observabilidad

- **Evento Kafka por ciclo de colección**: `platform.backup.collector.events` con resumen del ciclo (instancias procesadas, errores, duración).
- **Log estructurado**: El colector y el API handler emiten logs estructurados con `tenant_id`, `component_type`, `status`, `duration_ms`.
- **Métricas** (via Prometheus si disponible): `backup_collector_cycle_duration_ms`, `backup_adapter_timeout_total`, `backup_status_by_state` (gauge por estado).
- **Evento de auditoría de acceso** (US-OBS-01): Cada llamada al endpoint por un actor humano genera un evento de auditoría con `actor`, `tenant_id`, `timestamp`, `action: backup_status_read`.

### Seguridad

- Las credenciales del adaptador (acceso al cluster K8s para VolumeSnapshots) se almacenan en un Secret de Kubernetes, montado en la acción OpenWhisk como variable de entorno. Scope mínimo: `get/list` sobre `volumesnapshots.snapshot.storage.k8s.io`.
- El payload de la API nunca incluye: credenciales, connection strings, rutas de almacenamiento internas, cadenas de configuración de infraestructura.
- El filtro `is_shared_instance` y el filtro de scope `technical` son obligatorios en la serialización; si fallan, la acción devuelve 500 antes de exponer datos.
- La acción no tiene endpoint de escritura; el método `POST/PUT/DELETE` en la ruta retorna 405.

---

## Dependencias y secuencia recomendada

### Dependencias entre módulos de esta tarea

```
T-01 (DB schema) ──► T-02 (repository DAL) ──► T-03 (adapter interface + registry)
                                                      │
                              ┌───────────────────────┘
                              │
              ┌───────────────▼───────────────┐
              │  T-04 (PostgreSQL adapter MVP) │
              └───────────────┬───────────────┘
                              │
              ┌───────────────▼───────────────────┐
              │  T-05 (collector action)           │
              └───────────────┬───────────────────┘
                              │
              ┌───────────────▼───────────────────┐
              │  T-06 (API action + APISIX route)  │
              └───────────────┬───────────────────┘
                              │
      ┌───────────────────────┴────────────────────────┐
      │                                                 │
      ▼                                                 ▼
T-07 (Keycloak scopes + Helm)                   T-08 (Frontend)
      │                                                 │
      └───────────────────────┬────────────────────────┘
                              │
                      T-09 (Tests + CI)
```

### Paralelización posible

- **T-04 y T-08** pueden comenzar en paralelo una vez que `T-03` está completo (el frontend puede trabajar con mocks mientras el adaptador no está listo).
- **T-07** (Keycloak + Helm) puede hacerse en paralelo con T-05 y T-06 si hay dos implementadores.

---

## Criterios de completado con evidencia verificable

| Criterio | Evidencia |
|---|---|
| La migración de DB se ejecuta sin errores | `psql` muestra la tabla `backup_status_snapshots` con todas las columnas e índices |
| El colector se ejecuta y persiste snapshots | `SELECT * FROM backup_status_snapshots LIMIT 5;` devuelve filas con `last_checked_at` reciente |
| El endpoint `GET /v1/backup/status?tenant_id=X` responde con schema válido | Test de contrato pasa; respuesta incluye `schema_version: "1"` |
| El aislamiento multi-tenant funciona | Test de integración: token tenant-A solicita datos de tenant-B → `403` |
| La vista global requiere scope global | Test: token tenant owner sin scope global → `403` en vista sin `tenant_id` |
| El payload no expone info sensible | Test de contrato: validator rechaza respuestas con campos prohibidos |
| El badge de estado en consola admin es correcto visualmente | Playwright o screenshot manual con estados `success`, `failure`, `not_configured`, `not_available` |
| El resumen funcional del tenant no incluye identificadores técnicos | Test de componente React o inspección manual del DOM |
| El ciclo de recolección se ejecuta periódicamente | Evento `backup_collection_cycle_completed` observable en topic Kafka |
| El stale flag funciona correctamente | Test unitario del colector + observación en DB al detener el adaptador |

---

*Documento generado para el stage `speckit.plan` — US-BKP-01-T01 | Rama: `109-backup-status-visibility`*
