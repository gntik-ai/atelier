<!-- markdownlint-disable MD031 MD040 -->
# Plan técnico de implementación — US-SEC-02-T02

**Feature Branch**: `092-secret-rotation-no-redeploy`  
**Task ID**: US-SEC-02-T02  
**Epic**: EP-18 — Seguridad funcional transversal  
**Historia padre**: US-SEC-02 — Gestión segura de secretos, rotación, enforcement de scope y separación de privilegios  
**Fecha del plan**: 2026-03-31  
**Estado**: Ready for tasks  
**Dependencia directa**: US-SEC-02-T01 (`091-secure-secret-storage`) — Vault OSS + ESO + `secret_metadata` PostgreSQL ya operativos

---

## 1. Objetivo y alcance estricto de T02

Implementar el mecanismo completo de **rotación de secretos Vault sin redespliegue ni reinicio de servicios**, incluyendo:

- Acciones OpenWhisk para iniciar rotación, revocar versiones y barrer expiraciones — siguiendo el patrón establecido en `services/provisioning-orchestrator/src/actions/`.
- Nuevas tablas PostgreSQL para versiones de secretos, consumidores y eventos de propagación.
- Mecanismo de propagación automática a consumidores registrados via Kafka notificación + polling ESO.
- Período de gracia configurable (mínimo 300 s, máximo 86 400 s); máximo dos versiones válidas simultáneas.
- Revocación inmediata anulando la gracia con confirmación requerida si no queda versión activa.
- Auditoría completa en Kafka topic `console.secrets.audit` (sin valores de secretos).
- Página de gestión de rotaciones en la consola (`apps/web-console`).

### Fuera de alcance de T02

- Almacenamiento inicial de secretos en Vault (T01).
- Enforcement de scopes de tokens APISIX/Keycloak (T03).
- Separación admin vs. datos (T04) y deploy vs. ejecución de funciones (T05).
- Pruebas de hardening/penetración (T06).

---

## 2. Arquitectura objetivo

### 2.1 Diagrama de componentes

```
┌──────────────────────────────────────────────────────────────────────┐
│ OpenWhisk Actions (services/provisioning-orchestrator/src/actions/)  │
│                                                                      │
│  secret-rotation-initiate.mjs  ←──── operador (consola / API)       │
│  secret-rotation-revoke.mjs    ←──── operador (emergencia)          │
│  secret-rotation-expiry-sweep.mjs  ←── cron job (k8s CronJob)       │
│  secret-rotation-consumer-status.mjs  ←── query estado consumidores │
│                                                                      │
└────────────────┬─────────────────────────────────────────────────────┘
                 │ PostgreSQL (via pg)
                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ PostgreSQL — services/provisioning-orchestrator/src/migrations/     │
│                                                                     │
│  092-secret-rotation.sql                                            │
│    secret_version_states      — versiones activa/en-gracia/etc.     │
│    secret_consumer_registry   — servicios registrados por secreto   │
│    secret_propagation_events  — estado recarga por consumidor       │
│    secret_rotation_events     — log inmutable del ciclo rotación    │
└────────────────┬────────────────────────────────────────────────────┘
                 │ Kafka publish (kafkajs)
                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Kafka Topics                                                        │
│                                                                     │
│  console.secrets.rotation.initiated    (30d)                        │
│  console.secrets.rotation.grace-started (30d)                       │
│  console.secrets.rotation.propagated   (30d)                        │
│  console.secrets.rotation.grace-expired (30d)                       │
│  console.secrets.rotation.revoked      (90d)                        │
│  console.secrets.consumer.reload-requested (7d)                     │
│  console.secrets.consumer.reload-confirmed (30d)                    │
│  console.secrets.consumer.reload-timeout   (30d)                    │
│  console.secrets.audit                  (90d) — ya existente        │
└────────────────┬────────────────────────────────────────────────────┘
                 │ ESO refresh trigger (annotation update)
                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ External Secrets Operator + Vault KV v2                             │
│                                                                     │
│  ESO ExternalSecret CRDs: refreshInterval + manual annotation       │
│  Vault: rotación escribe nueva versión en path existente            │
│  ESO detecta nueva versión y sincroniza Kubernetes Secret           │
│  Servicios (APISIX, Keycloak, Kafka, PG, Mongo, OW, S3) consumen   │
│  el kube Secret actualizado sin reinicio (secreto montado como      │
│  fichero o inyectado por init container con hot-reload)             │
└─────────────────────────────────────────────────────────────────────┘
                 │ console pages
                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ apps/web-console/src/pages/                                         │
│                                                                     │
│  ConsoleSecretsPage.tsx         — inventario + estado versiones     │
│  ConsoleSecretRotationPage.tsx  — formulario rotación + historial   │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Decisiones de arquitectura

| Decisión | Elección | Justificación |
|---|---|---|
| Escritura del nuevo valor en Vault | Acción OpenWhisk con Vault token de platform-operator | Vault KV v2 versiona nativamente; la acción escribe `PUT /v1/secret/data/{path}` sin eliminar la versión anterior |
| Propagación a consumidores | Kafka `console.secrets.consumer.reload-requested` + ESO annotation refresh | Desacopla la señal del pull; ESO maneja el ciclo de vida de la sincronización k8s Secret → pod |
| Gestión de período de gracia | PostgreSQL `secret_version_states.grace_expires_at` + cron sweep (patrón `credential-rotation-expiry-sweep.mjs`) | Reutiliza patrón probado de `089-api-key-rotation`; sweep cada 60 s |
| Atomicidad | Transacción PostgreSQL: insertar nueva versión + actualizar estado antigua en una sola TX antes de escribir en Vault | Garantiza que si Vault falla, PG no refleja el cambio; las acciones OpenWhisk lanzan rollback explícito si Vault write falla |
| Máx. dos versiones válidas | `UNIQUE INDEX` parcial en `secret_version_states (secret_path) WHERE state IN ('active','grace')` + invalidación previa de la más antigua | Impide rotación encadenada > 2 versiones activas simultáneas |
| Revocación con confirmación | Parámetro `forceRevoke: true` + comprobación de consumidores sin versión activa alternativa | Fail-closed explícito con justificación auditada |
| Hot-reload de servicios | Secretos Vault montados vía ESO como ficheros en `/etc/secrets`; servicios configurados con `inotify`/`SIGHUP` o re-lectura periódica | Compatible con APISIX (reload API), Keycloak (SPI credentials), Kafka/PG/Mongo (driver connection pool refresh) |
| Consola | React + shadcn/ui `DataTable` + `Dialog` para confirmación — patrón establecido en `ConsoleCapabilityCatalogPage.tsx` | Consistente con el stack existente |

### 2.3 Flujo completo de rotación (secuencia)

```
Operador
  │
  ├─1─► POST /api/secrets/{domain}/{secretName}/rotate
  │       { newValue, gracePeriodSeconds, justification }
  │       (APISIX → OpenWhisk action: secret-rotation-initiate.mjs)
  │
  ├─2─► [TX PostgreSQL]
  │       INSERT secret_rotation_events (type='initiated', ...)
  │       UPDATE secret_version_states SET state='grace' WHERE current active
  │       INSERT secret_version_states (state='active', version=new)
  │
  ├─3─► Vault write new version at path (KV v2)
  │
  ├─4─► Kafka publish console.secrets.rotation.initiated
  │       Kafka publish console.secrets.consumer.reload-requested
  │         (un mensaje por consumer registrado en secret_consumer_registry)
  │
  ├─5─► ESO annotation update: kubectl annotate externalsecret force-sync=<timestamp>
  │       ESO pulls new Vault version → updates kube Secret
  │
  ├─6─► Servicios detectan cambio de fichero/Secret y recargan credencial
  │       (APISIX: reload admin API; Keycloak: SPI reload; Kafka/PG/Mongo: pool refresh)
  │
  ├─7─► Cada servicio publica confirmación via
  │       POST /api/secrets/{domain}/{secretName}/consumer-ack
  │       → INSERT secret_propagation_events (state='confirmed', consumer_id, ...)
  │       → Kafka publish console.secrets.consumer.reload-confirmed
  │
  ├─8─► Si consumer no confirma en RELOAD_ACK_TIMEOUT_SECONDS:
  │       cron sweep publica console.secrets.consumer.reload-timeout
  │       → alerta operativa
  │
  └─9─► Cuando grace_expires_at <= NOW() (sweep):
          UPDATE secret_version_states SET state='expired' WHERE state='grace'
          Vault delete old version (soft-delete KV v2)
          Kafka publish console.secrets.rotation.grace-expired
          INSERT secret_rotation_events (type='grace_expired', ...)
```

---

## 3. Modelo de datos

### 3.1 Migración PostgreSQL — `092-secret-rotation.sql`

**Fichero**: `services/provisioning-orchestrator/src/migrations/092-secret-rotation.sql`

```sql
-- Versiones de un secreto: activa, en-gracia, expirada, revocada
CREATE TABLE IF NOT EXISTS secret_version_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_path TEXT NOT NULL,           -- e.g., 'platform/postgresql/app-password'
  domain TEXT NOT NULL,                -- 'platform', 'tenant', 'functions', 'gateway', 'iam'
  tenant_id UUID,
  secret_name TEXT NOT NULL,
  vault_version INTEGER NOT NULL,      -- número de versión en Vault KV v2
  state TEXT NOT NULL CHECK (state IN ('active','grace','expired','revoked')),
  grace_period_seconds INTEGER NOT NULL DEFAULT 0,
  grace_expires_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expired_at TIMESTAMPTZ,
  initiated_by TEXT NOT NULL,
  revocation_justification TEXT,
  rotation_lock_version INTEGER NOT NULL DEFAULT 0
);

-- Máximo dos versiones válidas (active o grace) por path
CREATE UNIQUE INDEX IF NOT EXISTS uq_secret_active_version
  ON secret_version_states (secret_path)
  WHERE state = 'active';

CREATE INDEX IF NOT EXISTS idx_svs_grace_expiry
  ON secret_version_states (grace_expires_at)
  WHERE state = 'grace' AND grace_expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_svs_domain_tenant
  ON secret_version_states (domain, tenant_id);

-- Registro de servicios consumidores de un secreto
CREATE TABLE IF NOT EXISTS secret_consumer_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_path TEXT NOT NULL,
  consumer_id TEXT NOT NULL,           -- e.g., 'apisix', 'keycloak', 'kafka-broker'
  consumer_namespace TEXT NOT NULL,    -- namespace k8s del consumidor
  eso_external_secret_name TEXT,       -- nombre del ExternalSecret CRD a refrescar
  reload_mechanism TEXT NOT NULL CHECK (reload_mechanism IN ('eso_annotation','sighup','api_reload','pool_refresh')),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  registered_by TEXT NOT NULL,
  UNIQUE (secret_path, consumer_id)
);

-- Estado de propagación por rotación y consumidor
CREATE TABLE IF NOT EXISTS secret_propagation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_path TEXT NOT NULL,
  vault_version INTEGER NOT NULL,
  consumer_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','confirmed','timeout','failed')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  timeout_at TIMESTAMPTZ,
  error_detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_spe_pending
  ON secret_propagation_events (secret_path, vault_version)
  WHERE state = 'pending';

-- Log inmutable del ciclo de rotación (sin valores de secretos)
CREATE TABLE IF NOT EXISTS secret_rotation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_path TEXT NOT NULL,
  domain TEXT NOT NULL,
  tenant_id UUID,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'initiated','grace_started','consumer_reload_requested',
    'consumer_reload_confirmed','consumer_reload_timeout',
    'grace_expired','revoked','revoke_confirmed','rotation_failed'
  )),
  vault_version_new INTEGER,
  vault_version_old INTEGER,
  grace_period_seconds INTEGER,
  actor_id TEXT NOT NULL,
  actor_roles TEXT[],
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  detail JSONB DEFAULT '{}'::jsonb   -- metadatos sin valores de secretos
);

CREATE INDEX IF NOT EXISTS idx_sre_path_time
  ON secret_rotation_events (secret_path, occurred_at DESC);
```

### 3.2 Variables de entorno nuevas

```
SECRET_ROTATION_MIN_GRACE_SECONDS=300
SECRET_ROTATION_MAX_GRACE_SECONDS=86400
SECRET_ROTATION_DEFAULT_GRACE_SECONDS=1800
RELOAD_ACK_TIMEOUT_SECONDS=60
SECRET_ROTATION_SWEEP_BATCH_SIZE=50
VAULT_ADDR=https://vault.secret-store.svc.cluster.local:8200
VAULT_NAMESPACE=platform
VAULT_SKIP_VERIFY=false
```

---

## 4. Cambios por artefacto

### 4.1 Repositorio PostgreSQL — `services/provisioning-orchestrator/src/repositories/`

**Nuevo fichero**: `secret-rotation-repo.mjs`

Funciones:
- `insertSecretVersion(client, record)` — inserta en `secret_version_states`
- `getActiveVersion(client, secretPath)` — SELECT WHERE state='active'
- `getGraceVersion(client, secretPath)` — SELECT WHERE state='grace'
- `transitionToGrace(client, { secretPath, gracePeriodSeconds, initiatedBy })` — UPDATE active→grace + calcula `grace_expires_at`
- `revokeVersion(client, { id, justification, actorId })` — UPDATE state='revoked'
- `listExpiredGraceVersions(client, batchSize)` — SELECT WHERE state='grace' AND grace_expires_at <= NOW()
- `expireGraceVersion(client, { id, actorId })` — UPDATE state='expired'
- `insertRotationEvent(client, record)` — INSERT en `secret_rotation_events`
- `listRotationHistory(client, { secretPath, limit, offset })` — SELECT con paginación
- `upsertConsumer(client, record)` — INSERT/UPDATE en `secret_consumer_registry`
- `listConsumers(client, secretPath)` — lista consumidores registrados
- `insertPropagationEvent(client, record)` — INSERT en `secret_propagation_events`
- `confirmPropagation(client, { secretPath, vaultVersion, consumerId })` — UPDATE state='confirmed'
- `listPendingPropagations(client, { secretPath, vaultVersion })` — pendientes de ack

**Nuevo fichero**: `secret-rotation-policy-repo.mjs`

Reutiliza `tenant_rotation_policies` de `089-api-key-rotation.sql` para límites de gracia por tenant.

### 4.2 Modelos — `services/provisioning-orchestrator/src/models/`

**Nuevo fichero**: `secret-version-state.mjs`
```js
// Constantes y validador para secret_version_states
export const SECRET_STATES = ['active','grace','expired','revoked'];
export function validateSecretVersionState(record) { ... }
export function createSecretVersionRecord({ secretPath, domain, tenantId, secretName, vaultVersion, gracePeriodSeconds, initiatedBy }) { ... }
```

**Nuevo fichero**: `secret-rotation-event.mjs`
```js
export const ROTATION_EVENT_TYPES = ['initiated','grace_started','consumer_reload_requested','consumer_reload_confirmed','consumer_reload_timeout','grace_expired','revoked','revoke_confirmed','rotation_failed'];
export function validateRotationEvent(record) { ... }
```

### 4.3 Acciones OpenWhisk — `services/provisioning-orchestrator/src/actions/`

#### `secret-rotation-initiate.mjs`

```
Parámetros de entrada:
  { auth, secretPath, domain, tenantId?, newValue (cifrado en tránsito), gracePeriodSeconds?, justification }

Flujo:
  1. Validar auth roles (platform-operator | superadmin | tenant-owner según domain)
  2. Validar gracePeriodSeconds [MIN, MAX]
  3. Leer versionActiva desde PG
  4. Si hay versión en gracia: invalidar la más antigua (state='expired', Vault soft-delete)
  5. BEGIN TX PG:
       - transitionToGrace(versionActiva)
       - insertSecretVersion(nueva, state='active')
       - insertRotationEvent(type='initiated')
       - insertRotationEvent(type='grace_started')
  6. Vault write: PUT /v1/{vaultMount}/data/{secretPath} con { data: { value: newValue } }
  7. Si Vault write falla → ROLLBACK TX, return 502 VAULT_WRITE_FAILED
  8. COMMIT TX
  9. Para cada consumer en secret_consumer_registry:
       - insertPropagationEvent(state='pending')
       - triggerEsoRefresh(consumer.eso_external_secret_name) si reload_mechanism='eso_annotation'
       - publishKafka('console.secrets.consumer.reload-requested', { consumer_id, secretPath, vaultVersion })
  10. publishKafka('console.secrets.rotation.initiated', { secretPath, domain, actor })
  11. publishKafka('console.secrets.rotation.grace-started', { secretPath, gracePeriodSeconds })
  12. Return { rotationId, vaultVersionNew, gracePeriodSeconds, graceExpiresAt }
```

#### `secret-rotation-revoke.mjs`

```
Parámetros:
  { auth, secretPath, domain, tenantId?, vaultVersion, justification, forceRevoke? }

Flujo:
  1. Validar auth
  2. Obtener versión target por secretPath + vaultVersion
  3. Si vaultVersion es la única activa y no hay versión de respaldo:
       - Si !forceRevoke → return 409 REVOKE_LEAVES_NO_ACTIVE_VERSION
  4. BEGIN TX PG: revokeVersion + insertRotationEvent(type='revoked')
  5. Vault: DELETE /v1/{vaultMount}/data/{secretPath} (soft-delete versión específica)
  6. COMMIT TX
  7. publishKafka('console.secrets.rotation.revoked', ...)
  8. Return { revokedVersion, effectiveAt }
```

#### `secret-rotation-expiry-sweep.mjs`

```
Parámetros: { batchSize? } — invocado por k8s CronJob cada 60 s

Flujo:
  1. listExpiredGraceVersions(batchSize)
  2. Por cada versión expirada:
       a. expireGraceVersion(id)
       b. Vault soft-delete versión antigua
       c. insertRotationEvent(type='grace_expired')
       d. publishKafka('console.secrets.rotation.grace-expired', ...)
  3. Return { processed, errors }
```

#### `secret-rotation-consumer-status.mjs`

```
Parámetros: { auth, secretPath, vaultVersion? }
→ Consulta secret_propagation_events + secret_consumer_registry
→ Return { consumers: [{ consumer_id, state, confirmedAt, timeoutAt }] }
```

#### `secret-consumer-ack.mjs`

```
Parámetros: { consumerId, secretPath, vaultVersion }
→ confirmPropagation + publishKafka('console.secrets.consumer.reload-confirmed', ...)
→ Return { ack: true }
```

### 4.4 Sweeper de timeouts de recarga — `services/provisioning-orchestrator/src/actions/secret-rotation-propagation-timeout-sweep.mjs`

Cron job separado (cada 30 s): lista `secret_propagation_events` WHERE state='pending' AND requested_at < NOW() - RELOAD_ACK_TIMEOUT_SECONDS → marca state='timeout' + publishKafka('console.secrets.consumer.reload-timeout').

### 4.5 Migración SQL — `services/provisioning-orchestrator/src/migrations/092-secret-rotation.sql`

Completa según sección 3.1.

### 4.6 Configuración Helm — `charts/in-falcone/`

Nuevos valores en `charts/in-falcone/values.yaml`:
```yaml
secretRotation:
  enabled: true
  minGraceSeconds: 300
  maxGraceSeconds: 86400
  defaultGraceSeconds: 1800
  reloadAckTimeoutSeconds: 60
  sweepCronSchedule: "*/1 * * * *"
  propagationTimeoutCronSchedule: "*/1 * * * *"
```

Nuevos CronJob manifests en `charts/in-falcone/templates/`:
- `cronjob-secret-rotation-expiry-sweep.yaml`
- `cronjob-secret-rotation-propagation-timeout-sweep.yaml`

### 4.7 Consola web — `apps/web-console/src/`

#### Nuevas páginas

**`pages/ConsoleSecretsPage.tsx`**
- Lista `secret_metadata` (de T01) enriquecida con estado actual de versión (`active`, `grace`, `expired`)
- Columnas: nombre, dominio, tenant, estado de versión, última rotación, acciones (rotar, historial, revocar)
- Componente `SecretVersionBadge` con colores por estado

**`pages/ConsoleSecretRotationPage.tsx`**
- Formulario de rotación: `gracePeriodSeconds` (slider + input), `justification` (textarea), confirmación
- Tabla de historial: `secret_rotation_events` con paginación
- Panel de consumidores: estado de propagación en tiempo real (polling cada 5 s)
- Dialog de confirmación de revocación con aviso explícito si elimina última versión válida

#### Nuevas acciones de consola

**`actions/secretRotationActions.ts`**
```ts
export async function initiateRotation(secretPath, { gracePeriodSeconds, justification, newValue }): Promise<RotationResult>
export async function revokeSecretVersion(secretPath, vaultVersion, { justification, forceRevoke }): Promise<RevokeResult>
export async function listRotationHistory(secretPath, { limit, offset }): Promise<RotationHistoryPage>
export async function getConsumerStatus(secretPath, vaultVersion?): Promise<ConsumerStatusPage>
```

#### Router — `router.tsx`

Añadir rutas:
```ts
{ path: '/secrets', element: <ConsoleSecretsPage /> }
{ path: '/secrets/:secretPath/rotate', element: <ConsoleSecretRotationPage /> }
```

---

## 5. Estrategia de pruebas

### 5.1 Tests unitarios — `services/provisioning-orchestrator/tests/`

| Fichero | Qué prueba |
|---|---|
| `secret-rotation-repo.test.mjs` | CRUD de `secret_version_states`, `secret_propagation_events`, `secret_rotation_events`; estado transitions; unicidad de índice `uq_secret_active_version` |
| `secret-version-state.model.test.mjs` | `validateSecretVersionState` — casos válidos e inválidos, límites de gracia |
| `secret-rotation-initiate.action.test.mjs` | Flujo completo con mocks de `db`, `vault`, `publishEvent`; atomicidad TX; fallo de Vault → rollback; rotación encadenada → invalidación de versión más antigua |
| `secret-rotation-revoke.action.test.mjs` | Revocación normal; revocación de última versión sin `forceRevoke` → 409; con `forceRevoke` → OK; auditoría |
| `secret-rotation-expiry-sweep.action.test.mjs` | Procesa expiradas; manejo de errores parciales |
| `secret-consumer-ack.action.test.mjs` | ACK correcto; ACK de versión ya confirmada (idempotente) |
| `secret-rotation-propagation-timeout-sweep.action.test.mjs` | Detecta pending > timeout; publica evento timeout |

### 5.2 Tests de integración — `tests/integration/`

| Fichero | Qué prueba |
|---|---|
| `secret-rotation-initiate.integration.test.mjs` | Rotación completa contra PostgreSQL real (contenedor de test); verifica estados PG + eventos Kafka |
| `secret-rotation-grace-expiry.integration.test.mjs` | Ciclo completo: rotar → esperar gracia → sweep → verificar estado 'expired' en PG y evento Kafka |
| `secret-rotation-revoke.integration.test.mjs` | Revocación inmediata; comprueba que versión anterior aún válida sigue activa |
| `secret-consumer-propagation.integration.test.mjs` | Registra consumidor mock → inicia rotación → mock publica ACK → verifica `confirmed` en PG |
| `secret-rotation-multi-tenant-isolation.integration.test.mjs` | Rotación en tenant A no afecta estado de secretos de tenant B |

### 5.3 Tests de contrato — `services/provisioning-orchestrator/tests/contract/`

| Fichero | Qué prueba |
|---|---|
| `secret-rotation-api.contract.test.mjs` | Verifica que `secret-rotation-initiate.mjs` y `secret-rotation-revoke.mjs` devuelven contratos estables (shape de respuesta, códigos de error) |

### 5.4 Tests de consola — `apps/web-console/src/pages/`

| Fichero | Qué prueba |
|---|---|
| `ConsoleSecretsPage.test.tsx` | Renderiza lista de secretos con badges de estado; navega a rotación |
| `ConsoleSecretRotationPage.test.tsx` | Formulario de rotación: validación de gracia; submit llama `initiateRotation`; dialog de confirmación de revocación |

### 5.5 Validaciones operativas

- Smoke test post-despliegue: rotar `platform/postgresql/app-password` y verificar que `psql` conecta con la nueva contraseña sin reinicio del pod.
- Verificación de auditoría: tras una rotación completa, `SELECT COUNT(*) FROM secret_rotation_events WHERE secret_path = $1 AND event_type IN ('initiated','grace_started','grace_expired')` devuelve ≥ 3 filas.
- Verificación de aislamiento: intentar GET de secreto de tenant-A con token de tenant-B → 403.

---

## 6. Riesgos, rollback y seguridad

### 6.1 Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Vault write exitoso pero fallo de Kafka publish | Media | Bajo | Kafka publish es best-effort post-commit; sweep periódico detecta versiones sin eventos y republica |
| Consumidor no soporta hot-reload (fail-open) | Baja | Alto | Lista de consumidores registrados con `reload_mechanism`; si no soporta ESO/sighup, se documenta reinicio controlado como procedimiento de emergencia |
| Rotación encadenada rápida crea estado inconsistente | Baja | Alto | `UNIQUE INDEX uq_secret_active_version` + transacción atómica PG previene > 1 versión activa simultánea |
| Grace period demasiado corto fuerza reinicio de pods | Media | Medio | Valor mínimo 300 s configurable; UI advierte si valor < mínimo recomendado por tipo de consumidor |
| Exposición de valores en logs Vault/OpenWhisk | Baja | Alto | `sanitizer.mjs` existente (de `secret-audit-handler`); `ensureNoSecretMaterial()` en repo layer (patrón de `secret-inventory.mjs`) |

### 6.2 Rollback

- Si `092-secret-rotation.sql` falla: tablas nuevas aisladas; no modifica tablas existentes.
- Si acción OpenWhisk falla en producción: desactivar CronJobs via Helm `--set secretRotation.enabled=false`; las tablas quedan con datos consistentes.
- Rollback de Vault: el Vault KV v2 mantiene historial de versiones; se puede restaurar la versión anterior via `vault kv rollback`.

### 6.3 Seguridad

- Los valores de secretos viajan cifrados (TLS) entre operador → APISIX → OpenWhisk → Vault; nunca se almacenan en PostgreSQL, Kafka ni logs.
- `secret_rotation_events.detail` (JSONB) es revisado por `ensureNoSecretMaterial()` antes de persistir.
- Roles requeridos por dominio: `superadmin` o `platform-operator` para `platform/`, `gateway/`, `iam/`, `functions/`; `tenant-owner` del tenant correspondiente para `tenant/{tenantId}/`.
- La columna `actor_roles` en `secret_rotation_events` es inmutable (INSERT-only, sin UPDATE ni DELETE permitidos vía rol de aplicación).

### 6.4 Observabilidad

- Kafka topics `console.secrets.rotation.*` consumibles por pipeline de observabilidad existente (spec `031-observability-audit-pipeline`).
- Alerta Prometheus/Alertmanager: `secret_consumer_reload_timeout_total > 0` → página a platform team.
- Métrica: `secret_rotation_duration_seconds` (histogram) desde `initiated` hasta último `consumer_reload_confirmed`.

---

## 7. Dependencias, paralelización y secuencia

### 7.1 Dependencias previas

- **US-SEC-02-T01** (`091-secure-secret-storage`): Vault OSS + ESO operativos, `secret_metadata` PostgreSQL existente, `secret-audit-handler` sidecar publicando en `console.secrets.audit`.
- Patrón `credential-rotation-expiry-sweep.mjs` (de `089-api-key-rotation`): reutilizado directamente.
- `services/provisioning-orchestrator` con `pg` y `kafkajs` ya configurados.

### 7.2 Secuencia de implementación

```
Paso 1 (base):
  - 092-secret-rotation.sql (migración PG)
  - secret-rotation-repo.mjs
  - secret-version-state.mjs (modelo)
  - secret-rotation-event.mjs (modelo)
  - Tests unitarios de repo y modelos

Paso 2 (acciones core):
  - secret-rotation-initiate.mjs
  - secret-rotation-revoke.mjs
  - secret-consumer-ack.mjs
  - Tests unitarios de acciones

Paso 3 (sweepers):
  - secret-rotation-expiry-sweep.mjs
  - secret-rotation-propagation-timeout-sweep.mjs
  - CronJob Helm templates
  - Tests unitarios de sweepers

Paso 4 (integración):
  - Tests de integración contra PG real
  - Smoke test de rotación completa

Paso 5 (consola):
  - ConsoleSecretsPage.tsx
  - ConsoleSecretRotationPage.tsx
  - secretRotationActions.ts
  - Tests de consola
  - Rutas en router.tsx

Paso 6 (despliegue):
  - Helm values y templates
  - Smoke test en cluster
  - Actualización AGENTS.md
```

### 7.3 Paralelización posible

Los pasos 1 y 5 son paralelizables: el equipo de frontend puede construir la UI con mocks mientras el backend implementa las acciones.

---

## 8. Criterios de done verificables

| Criterio | Evidencia esperada |
|---|---|
| **CD-01** La migración `092-secret-rotation.sql` aplica limpiamente sobre la BD del proyecto | `psql \d secret_version_states` muestra la tabla con índices; `psql \d secret_consumer_registry`, `secret_propagation_events`, `secret_rotation_events` presentes |
| **CD-02** `secret-rotation-initiate.mjs` rota un secreto y crea las entradas PG correctas | Test de integración pasa; `secret_version_states` tiene 1 fila `active` y 1 fila `grace` para el mismo `secret_path` |
| **CD-03** No coexisten > 2 versiones válidas por secreto | Test de integración de rotación encadenada: tercera rotación invalida la versión más antigua; `SELECT COUNT(*) WHERE state IN ('active','grace') AND secret_path=X` = 2 |
| **CD-04** El sweep expira versiones en gracia correctamente | Test: insertar versión con `grace_expires_at` en el pasado → ejecutar sweep → `state='expired'` en PG + evento Kafka publicado |
| **CD-05** La revocación sin versión activa alternativa requiere `forceRevoke=true` | Test unitario: `forceRevoke=false` → 409; `forceRevoke=true` → OK + evento `revoke_confirmed` |
| **CD-06** Ningún evento de auditoría contiene valores de secretos | Todos los tests que insertan `secret_rotation_events` afirman `!record.detail?.value && !record.detail?.data` |
| **CD-07** Aislamiento multi-tenant: rotación de tenant A no afecta tenant B | Test de integración `secret-rotation-multi-tenant-isolation` pasa |
| **CD-08** Consola renderiza lista de secretos con estado de versión y permite iniciar rotación | `ConsoleSecretsPage.test.tsx` y `ConsoleSecretRotationPage.test.tsx` pasan |
| **CD-09** Variables de entorno documentadas y presentes en Helm values | `charts/in-falcone/values.yaml` contiene bloque `secretRotation` con todos los parámetros |
| **CD-10** AGENTS.md actualizado con nuevas tablas, topics Kafka y env vars | Sección "Secure Secret Rotation" añadida al AGENTS.md del proyecto |

---

## 9. Actualización de AGENTS.md (extracto)

Al completar T02, añadir al bloque `<!-- MANUAL ADDITIONS START -->` de `AGENTS.md`:

```markdown
## Secure Secret Rotation (092-secret-rotation-no-redeploy)

- New PostgreSQL tables: `secret_version_states`, `secret_consumer_registry`, `secret_propagation_events`, `secret_rotation_events`.
- Migration file: `services/provisioning-orchestrator/src/migrations/092-secret-rotation.sql`.
- New OpenWhisk actions: `secret-rotation-initiate`, `secret-rotation-revoke`, `secret-rotation-expiry-sweep`, `secret-rotation-propagation-timeout-sweep`, `secret-consumer-ack`, `secret-rotation-consumer-status`.
- New Kafka topics: `console.secrets.rotation.initiated` (30d), `console.secrets.rotation.grace-started` (30d), `console.secrets.rotation.propagated` (30d), `console.secrets.rotation.grace-expired` (30d), `console.secrets.rotation.revoked` (90d), `console.secrets.consumer.reload-requested` (7d), `console.secrets.consumer.reload-confirmed` (30d), `console.secrets.consumer.reload-timeout` (30d).
- New env vars: `SECRET_ROTATION_MIN_GRACE_SECONDS`, `SECRET_ROTATION_MAX_GRACE_SECONDS`, `SECRET_ROTATION_DEFAULT_GRACE_SECONDS`, `RELOAD_ACK_TIMEOUT_SECONDS`, `SECRET_ROTATION_SWEEP_BATCH_SIZE`.
- New console pages: `ConsoleSecretsPage.tsx`, `ConsoleSecretRotationPage.tsx`.
- Max two valid versions per secret path enforced via `UNIQUE INDEX uq_secret_active_version`.
- Rotation is atomic: PostgreSQL TX committed before Vault write; rollback on Vault failure.
```
