<!-- markdownlint-disable MD031 MD040 -->
# Plan técnico de implementación — US-SEC-02-T01

**Feature Branch**: `091-secure-secret-storage`
**Task ID**: US-SEC-02-T01
**Epic**: EP-18 — Seguridad funcional transversal
**Historia padre**: US-SEC-02 — Gestión segura de secretos, rotación, enforcement de scope y separación de privilegios
**Fecha del plan**: 2026-03-30
**Estado**: Ready for tasks

---

## 1. Objetivo y alcance estricto de T01

Implementar el almacenamiento seguro centralizado de secretos y credenciales sensibles del clúster, con:

- Un almacén centralizado de secretos usando **Kubernetes Secrets** cifrados en reposo a través de `EncryptionConfiguration` + **External Secrets Operator (ESO)** como capa de sincronización y policy enforcement, desplegado vía Helm en Kubernetes/OpenShift.
- Namespaces lógicos (paths) por dominio funcional: `platform/`, `tenant/{tenantId}/`, `functions/`, `gateway/`, `iam/`.
- Políticas de acceso mediante RBAC de Kubernetes + Keycloak OIDC para autenticación de identidades de servicio.
- Auditoría completa de todas las operaciones sobre secretos (lectura, escritura, eliminación, denegación) publicada en Kafka.
- Integración con todos los servicios del clúster (APISIX, Keycloak, Kafka, PostgreSQL, MongoDB, OpenWhisk, S3-compatible) para que consuman credenciales desde el almacén en lugar de variables de entorno en texto plano.
- Comportamiento fail-closed verificable: los servicios que no puedan resolver sus secretos no arrancan.
- Inventario de metadatos de secretos accesible sin exponer valores.

### Fuera del alcance de T01

- Rotación automática/manual de secretos (T02).
- Enforcement de scopes de tokens (T03).
- Separación admin vs. datos (T04).
- Separación deploy vs. ejecución de funciones (T05).
- Pruebas de hardening/penetración (T06).
- UI en consola de administración para gestión de secretos (se puede añadir en un task posterior).

---

## 2. Arquitectura objetivo

### 2.1 Componentes implicados

```
┌─────────────────────────────────────────────────────────────────┐
│                       Kubernetes Cluster                        │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │               secret-store namespace                      │  │
│  │                                                           │  │
│  │  ┌─────────────────────┐  ┌──────────────────────────┐  │  │
│  │  │  External Secrets   │  │  Kubernetes Secrets       │  │  │
│  │  │  Operator (ESO)     │  │  (cifrado en reposo       │  │  │
│  │  │                     │  │   via EncryptionConfig)   │  │  │
│  │  │  SecretStore CRD    │  │                           │  │  │
│  │  │  ExternalSecret CRD │  │  Namespaced por dominio:  │  │  │
│  │  │  ClusterSecretStore │  │  - platform/*             │  │  │
│  │  └──────────┬──────────┘  │  - tenant/{id}/*          │  │  │
│  │             │             │  - functions/*            │  │  │
│  │             │ sync        │  - gateway/*              │  │  │
│  │             ▼             │  - iam/*                  │  │  │
│  │  ┌─────────────────────┐  └──────────────────────────┘  │  │
│  │  │  Backend de secretos│                                  │  │
│  │  │  (Vault OSS o       │                                  │  │
│  │  │   AWS Secrets Mgr   │                                  │  │
│  │  │   compatible ESO)   │                                  │  │
│  │  └─────────────────────┘                                  │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │  APISIX      │  │  Keycloak    │  │  Kafka / PostgreSQL /  │ │
│  │  (gateway/   │  │  (iam/       │  │  MongoDB / OpenWhisk / │ │
│  │   secrets)   │  │   secrets)   │  │  S3 (platform/*,       │ │
│  │              │  │              │  │  functions/*, etc.)    │ │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬────────────┘ │
│         │                 │                      │              │
│         └─────────────────┴──────────────────────┘             │
│                         ESO sync                               │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  secret-audit-handler (OpenWhisk action)                  │  │
│  │  → publica en Kafka: console.secrets.audit (eventos de    │  │
│  │    acceso, escritura, denegación)                         │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Decisiones de arquitectura

| Decisión | Elección | Justificación |
|---|---|---|
| Backend de almacenamiento | HashiCorp Vault OSS (opcionalmente Banzai Cloud Bank-Vaults) | Open-source, integra nativamente con Kubernetes auth, KV v2 con versioning, políticas HCL expresivas, compatible con ESO |
| Capa de sincronización | External Secrets Operator (ESO) | Estándar de facto para k8s, soporta Vault + múltiples backends, CRDs declarativos, GitOps-friendly |
| Cifrado en reposo | Vault seal + EncryptionConfiguration k8s para kube secrets | Doble capa: Vault cifra internamente; los kube secrets sincronizados por ESO también cifrados |
| Autenticación de servicios | Vault Kubernetes Auth Method + ServiceAccount tokens | Sin secrets adicionales necesarios para acceder a Vault; zero-secret bootstrap |
| Políticas de acceso | Vault HCL policies + Kubernetes RBAC | Vault policies por path/domain; RBAC para quién puede crear ExternalSecret CRDs |
| Auditoría | Vault audit log → sidecar → Kafka `console.secrets.audit` | Inmutable en Vault, propagado a Kafka para observabilidad centralizada |
| Despliegue | Helm sub-chart dentro de `charts/in-falcone` | Consistente con el patrón existente del proyecto |
| Fail-closed | init containers + readiness probes que requieren secreto resuelto | Servicio no arranca si no resuelve credenciales de Vault |

### 2.3 Namespaces / paths de secretos en Vault

```
secret/                           # Motor KV v2
  platform/
    postgresql/
      root-password
      app-password
    mongodb/
      root-password
      app-password
    kafka/
      admin-password
      inter-broker-secret
    s3/
      access-key
      secret-key
    openwhisk/
      db-password
    encryption/
      master-key
  tenant/
    {tenantId}/
      storage/
        access-key
        secret-key
      webhooks/
        signing-secret
      api-keys/
        {keyId}
  functions/
    openwhisk/
      controller-password
      invoker-password
      action-encryption-key
  gateway/
    apisix/
      admin-key
      dashboard-password
      etcd-password
  iam/
    keycloak/
      admin-password
      db-password
      client-secrets/
        {clientId}
```

### 2.4 Flujo de acceso a secreto (servicio → Vault)

```
1. Servicio arranca con ServiceAccount k8s
2. ESO ExternalSecret CRD solicita secreto a Vault via SA token
3. Vault valida SA token con k8s TokenReview API
4. Vault verifica policy sobre el path (e.g., platform/postgresql/*)
5. Vault registra acceso en audit log
6. Vault devuelve secreto cifrado sobre TLS
7. ESO materializa Kubernetes Secret en el namespace del servicio
8. Servicio monta el Secret como volumen (nunca como env var en texto plano)
9. Sidecar de audit publisher captura el log de Vault y publica en Kafka
```

---

## 3. Cambios por artefacto

### 3.1 Nuevo sub-chart Helm: `charts/in-falcone/charts/vault/`

```
charts/in-falcone/charts/vault/
  Chart.yaml
  values.yaml
  templates/
    vault-deployment.yaml          # Vault OSS con HA si disponible
    vault-service.yaml
    vault-config-configmap.yaml    # Configuración HCL de Vault
    vault-pvc.yaml                 # Persistencia para data de Vault
    vault-init-job.yaml            # Job de inicialización y unsealing
    vault-policies/
      platform-policy.hcl.yaml    # ConfigMap con policy HCL
      tenant-policy.hcl.yaml
      functions-policy.hcl.yaml
      gateway-policy.hcl.yaml
      iam-policy.hcl.yaml
    vault-auth-configmap.yaml      # Configuración auth method k8s
    vault-audit-sidecar.yaml       # Sidecar que lee audit log y publica a Kafka
    vault-rbac.yaml                # ServiceAccount, ClusterRoleBinding para Vault
    vault-networkpolicy.yaml       # NetworkPolicy: solo ESO y servicios autorizados
```

**`values.yaml`** expondrá:
- `vault.replicas` (default: 1, HA: 3)
- `vault.storage.size`
- `vault.tls.enabled` (default: true)
- `vault.auditSidecar.kafkaTopic` (default: `console.secrets.audit`)
- `vault.auditSidecar.kafkaBrokers`
- `vault.unsealMethod` (shamir | transit | cloud-kms)

### 3.2 External Secrets Operator: `charts/in-falcone/charts/eso/`

```
charts/in-falcone/charts/eso/
  Chart.yaml                       # Dependencia: external-secrets/external-secrets Helm chart
  values.yaml
  templates/
    cluster-secret-store.yaml      # ClusterSecretStore apuntando a Vault
    external-secrets/
      platform-postgresql.yaml     # ExternalSecret para PostgreSQL
      platform-mongodb.yaml
      platform-kafka.yaml
      platform-s3.yaml
      platform-openwhisk.yaml
      functions-openwhisk.yaml
      gateway-apisix.yaml
      iam-keycloak.yaml
    eso-rbac.yaml                  # Roles para que ESO acceda a Vault
    eso-networkpolicy.yaml
```

**`ClusterSecretStore`** se autentica a Vault usando el ServiceAccount del namespace `eso-system` con el Vault Kubernetes Auth Method.

### 3.3 Políticas Vault HCL (contenido de los ConfigMaps)

**`platform-policy.hcl`**:
```hcl
# Solo servicios de plataforma (PostgreSQL, Kafka, MongoDB, S3, OpenWhisk)
path "secret/data/platform/*" {
  capabilities = ["read"]
}
path "secret/metadata/platform/*" {
  capabilities = ["list", "read"]
}
```

**`tenant-policy.hcl`** (parametrizada por `tenantId`):
```hcl
path "secret/data/tenant/{{identity.entity.aliases.auth_kubernetes_cluster_1.metadata.tenantId}}/*" {
  capabilities = ["read"]
}
path "secret/metadata/tenant/{{identity.entity.aliases.auth_kubernetes_cluster_1.metadata.tenantId}}/*" {
  capabilities = ["list", "read"]
}
```

**`functions-policy.hcl`**:
```hcl
path "secret/data/functions/*" {
  capabilities = ["read"]
}
path "secret/metadata/functions/*" {
  capabilities = ["list", "read"]
}
```

**`gateway-policy.hcl`** y **`iam-policy.hcl`**: análogos a los anteriores, restringidos a sus paths.

**Política de auditoría (solo lectura de audit log)**:
```hcl
path "sys/audit*" {
  capabilities = ["read"]
}
```

### 3.4 Nuevo servicio: `services/secret-audit-handler/`

```
services/secret-audit-handler/
  src/
    index.mjs                # Entry point: lee audit log de Vault (file sink) y publica a Kafka
    vault-log-reader.mjs     # Tail del audit log file expuesto vía shared volume
    kafka-publisher.mjs      # Publica SecretAuditEvent a console.secrets.audit
    event-schema.mjs         # Schema del SecretAuditEvent (sin valores de secretos)
    sanitizer.mjs            # Elimina cualquier campo que pudiera contener valores
  tests/
    unit/
      vault-log-reader.test.mjs
      kafka-publisher.test.mjs
      sanitizer.test.mjs
    integration/
      audit-handler.integration.test.mjs
  package.json
```

Este servicio corre como sidecar del pod de Vault o como DaemonSet en el namespace `secret-store`.

### 3.5 Nueva acción OpenWhisk: `services/provisioning-orchestrator/src/actions/secret-inventory.mjs`

Expone el inventario de metadatos de secretos (sin valores) para operadores autorizados:

```javascript
// Contrato: GET /v1/secrets/inventory?domain=platform&namespace=postgresql
// Response: { secrets: [{ name, domain, path, createdAt, updatedAt, status }] }
// Requiere: rol platform-operator o superadmin en Keycloak
// Prohibido: nunca incluir el campo "value" ni "data" en la respuesta
```

### 3.6 Contrato OpenAPI: `internal-contracts/secrets/`

```
internal-contracts/secrets/
  secret-inventory-v1.yaml     # GET /v1/secrets/inventory
  secret-metadata-v1.yaml      # GET /v1/secrets/{domain}/{path}
  secret-audit-event-v1.yaml   # Esquema del evento Kafka de auditoría
```

### 3.7 Kafka: nuevo topic `console.secrets.audit`

| Propiedad | Valor |
|---|---|
| Topic | `console.secrets.audit` |
| Particiones | 3 |
| Retención | 90 días |
| Compactación | No (log normal, append-only) |
| Cifrado en tránsito | TLS (ya configurado en el clúster) |

**Schema del evento (SecretAuditEvent)**:
```json
{
  "eventId": "uuid",
  "timestamp": "ISO-8601",
  "operation": "read | write | delete | denied",
  "domain": "platform | tenant | functions | gateway | iam",
  "secretPath": "platform/postgresql/app-password",
  "secretName": "app-password",
  "requestorIdentity": {
    "type": "service | user",
    "name": "provisioning-orchestrator",
    "namespace": "orchestrator",
    "serviceAccount": "provisioning-orchestrator-sa"
  },
  "result": "success | denied | error",
  "denialReason": null,
  "vaultRequestId": "uuid"
}
```

**Nunca** se incluye el valor del secreto en el evento.

### 3.8 Modificaciones a charts existentes para fail-closed

Para cada servicio que consuma secretos (APISIX, Keycloak, Kafka, PostgreSQL, MongoDB, OpenWhisk), se añadirá al values.yaml del chart:

```yaml
initContainers:
  - name: wait-for-secret
    image: vault:latest
    command: ["vault", "kv", "get", "secret/platform/postgresql/app-password"]
    env:
      - name: VAULT_ADDR
        value: "https://vault.secret-store.svc.cluster.local:8200"
      - name: VAULT_TOKEN
        valueFrom:
          secretKeyRef:
            name: vault-token
            key: token
```

Y los Secrets montados como volúmenes (no env vars):
```yaml
volumes:
  - name: db-credentials
    secret:
      secretName: platform-postgresql-credentials
volumeMounts:
  - name: db-credentials
    mountPath: /run/secrets/db
    readOnly: true
```

### 3.9 EncryptionConfiguration para Kubernetes Secrets

Archivo `deploy/k8s/encryption-config.yaml`:
```yaml
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources:
      - secrets
    providers:
      - aescbc:
          keys:
            - name: key1
              secret: <base64-encoded-32-byte-key-from-vault>
      - identity: {}
```

Se aplica al `kube-apiserver` con `--encryption-provider-config`. En OpenShift se gestiona vía `apiserver.config.openshift.io/v1`.

### 3.10 NetworkPolicy: aislamiento del namespace `secret-store`

```yaml
# Solo ESO y servicios autorizados pueden comunicarse con Vault
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: vault-access-policy
  namespace: secret-store
spec:
  podSelector:
    matchLabels:
      app: vault
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: eso-system
        - namespaceSelector:
            matchLabels:
              vault-access: "true"
      ports:
        - protocol: TCP
          port: 8200
```

---

## 4. Modelo de datos / metadata

### 4.1 PostgreSQL: tabla `secret_metadata` (solo metadatos, nunca valores)

```sql
CREATE TABLE secret_metadata (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secret_path      TEXT NOT NULL,           -- e.g. 'platform/postgresql/app-password'
  domain           TEXT NOT NULL,           -- 'platform' | 'tenant' | 'functions' | 'gateway' | 'iam'
  tenant_id        UUID,                    -- NULL para secretos de plataforma
  secret_name      TEXT NOT NULL,
  secret_type      TEXT NOT NULL,           -- 'password' | 'token' | 'key' | 'certificate'
  status           TEXT NOT NULL DEFAULT 'active', -- 'active' | 'revoked' | 'pending_rotation'
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_accessed_at TIMESTAMPTZ,
  created_by       TEXT,
  vault_mount      TEXT NOT NULL DEFAULT 'secret',
  UNIQUE (domain, tenant_id, secret_name)
);

CREATE INDEX idx_secret_metadata_domain ON secret_metadata(domain);
CREATE INDEX idx_secret_metadata_tenant ON secret_metadata(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX idx_secret_metadata_status ON secret_metadata(status);
```

**Invariante crítica**: Esta tabla NO almacena nunca el valor del secreto. Solo metadatos.

### 4.2 Migración

Archivo: `services/provisioning-orchestrator/src/migrations/022-secret-metadata.sql`

La migración es idempotente (usa `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).

---

## 5. Integración con servicios del clúster

### 5.1 Mapa de secretos por servicio

| Servicio | Path en Vault | ExternalSecret k8s | Montaje |
|---|---|---|---|
| PostgreSQL | `platform/postgresql/*` | `platform-postgresql-credentials` | `/run/secrets/pg/` |
| MongoDB | `platform/mongodb/*` | `platform-mongodb-credentials` | `/run/secrets/mongo/` |
| Kafka | `platform/kafka/*` | `platform-kafka-credentials` | `/run/secrets/kafka/` |
| S3-compatible | `platform/s3/*` | `platform-s3-credentials` | `/run/secrets/s3/` |
| OpenWhisk | `platform/openwhisk/*`, `functions/openwhisk/*` | `platform-openwhisk-credentials` | `/run/secrets/ow/` |
| APISIX | `gateway/apisix/*` | `gateway-apisix-credentials` | `/run/secrets/apisix/` |
| Keycloak | `iam/keycloak/*` | `iam-keycloak-credentials` | `/run/secrets/keycloak/` |

### 5.2 Bootstrap de Vault

El Job `vault-init-job` ejecuta:
1. `vault operator init` → genera unseal keys y root token.
2. Almacena unseal keys en un Secret de Kubernetes (cifrado por EncryptionConfiguration) accesible solo por el Job y el operador.
3. `vault operator unseal` con las 3 primeras keys (threshold configurable).
4. Configura el auth method de Kubernetes.
5. Crea los secrets iniciales con valores dummy rotables (no hard-coded) o los importa desde un Secret de bootstrap externo.
6. Configura los audit devices (file sink + syslog).
7. Aplica las HCL policies.

---

## 6. Estrategia de pruebas

### 6.1 Tests unitarios

**`services/secret-audit-handler/tests/unit/`**:
- `sanitizer.test.mjs`: verifica que el sanitizador elimina cualquier campo `value`, `data` o similar del evento de auditoría.
- `event-schema.test.mjs`: valida que el schema del `SecretAuditEvent` rechaza entradas con valores de secretos.
- `vault-log-reader.test.mjs`: mockea el file sink de Vault y verifica el parsing correcto de entradas de log.

**`services/provisioning-orchestrator/src/actions/secret-inventory.test.mjs`**:
- Verifica que la acción no incluye valores en la respuesta.
- Verifica que usuarios sin rol `platform-operator` o `superadmin` reciben 403.
- Verifica filtrado por domain y tenant correctos.

### 6.2 Tests de integración

**`tests/integration/secret-storage/`**:

```
tests/integration/secret-storage/
  vault-access-control.test.mjs    # Verifica deny de acceso cross-domain y cross-tenant
  vault-audit-log.test.mjs         # Verifica que operaciones generan audit entries
  eso-sync.test.mjs                # Verifica que ExternalSecrets se sincronizan correctamente
  fail-closed.test.mjs             # Verifica que servicios no arrancan sin secretos
  inventory-api.test.mjs           # Verifica endpoint de inventario (sin valores)
  secret-no-plaintext.test.mjs     # Verifica ausencia de valores en logs y configuraciones
```

**`vault-access-control.test.mjs`** — casos clave:
- SA del dominio `functions` intenta leer `platform/postgresql/*` → `403 permission denied`.
- SA del tenant A intenta leer secretos del tenant B → `403 permission denied`.
- SA del dominio `gateway` lee `gateway/apisix/*` → éxito.
- Identidad sin ServiceAccount válido → `403`.

### 6.3 Tests de contrato

**`internal-contracts/secrets/`**: validación JSON Schema de las respuestas del endpoint de inventario y del evento Kafka, usando la librería existente de validación de contratos del proyecto.

### 6.4 Validaciones operativas

Script `scripts/verify-secret-storage.sh`:
```bash
# 1. Verifica que ningún pod expone secretos como env vars
kubectl get pods -A -o json | jq '.items[].spec.containers[].env[] | select(.value != null) | select(.name | test("PASSWORD|SECRET|KEY|TOKEN"))' | wc -l
# Debe ser 0

# 2. Verifica cifrado en reposo en etcd
kubectl get secret -n secret-store -o yaml | grep -v "type: kubernetes.io/service-account-token" | grep "data:" -A5
# Los valores deben ser base64 de datos cifrados

# 3. Verifica que ExternalSecrets están sincronizados
kubectl get externalsecret -A -o json | jq '.items[] | {name:.metadata.name, status:.status.conditions[].status}'

# 4. Verifica acceso al inventario sin exponer valores
curl -s -H "Authorization: Bearer $TOKEN" https://api.falcone.io/v1/secrets/inventory | jq 'if .secrets[].value? then error("VALUE EXPOSED") else "OK" end'
```

---

## 7. Observabilidad y seguridad

### 7.1 Métricas

- `vault_secret_access_total{domain, operation, result}` — contador de accesos por dominio y resultado.
- `vault_secret_deny_total{domain, reason}` — denegaciones.
- `vault_audit_lag_seconds` — lag entre operación y publicación en Kafka.
- `vault_unseal_status` — estado del unseal (0=sealed, 1=unsealed).

### 7.2 Alertas

- `VaultSealed`: Vault sellado durante más de 60 segundos.
- `SecretAccessDeniedSpike`: Más de 10 denegaciones en 5 minutos desde la misma identidad.
- `AuditKafkaLag`: Lag de publicación de auditoría mayor a 30 segundos.
- `ExternalSecretSyncFailed`: ExternalSecret en estado `NotReady` más de 5 minutos.

### 7.3 Seguridad en transit

- Vault expone solo puerto 8200 sobre TLS (certificado auto-gestionado o cert-manager).
- NetworkPolicy bloquea acceso directo a Vault desde namespaces no autorizados.
- Los ExternalSecrets usan ServiceAccount tokens con expiración configurable (default: 24h).
- Los Kubernetes Secrets resultantes usan `immutable: true` cuando el secreto no necesita rotación.

---

## 8. Riesgos, migraciones y rollback

### 8.1 Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Vault no disponible al arrancar servicios | Media | Alto | fail-closed esperado; readiness probes; Vault HA en producción |
| Unseal keys comprometidas | Baja | Crítico | Unseal con Transit seal (auto-unseal) en producción; keys distribuidas |
| ESO bug al sincronizar secretos | Baja | Alto | Versión pinned de ESO; tests de integración de sync |
| Migración de credenciales existentes en texto plano | Alta | Medio | Job de migración con rollback; secretos dummy en dev/staging primero |
| EncryptionConfiguration mal aplicada | Baja | Alto | Verificación post-apply con script operativo; backup de etcd antes |

### 8.2 Migración desde credenciales existentes

El Job `vault-migration-job` (idempotente):
1. Lee credenciales actuales desde los Helm values o Secrets existentes.
2. Las escribe en Vault bajo el path correcto.
3. Actualiza los charts de cada servicio para usar ESO ExternalSecrets en lugar de credenciales inline.
4. Verifica que el servicio puede arrancar con la nueva configuración antes de eliminar la credencial antigua.
5. Registra cada migración en la tabla `secret_metadata`.

**Rollback**: si el Job falla, los Helm values originales siguen presentes y los servicios pueden seguir usando las credenciales antiguas. El rollback es revertir el chart update.

### 8.3 Compatibilidad

- Compatible con Kubernetes 1.24+ (ESO v0.9+).
- Compatible con OpenShift 4.12+ (usando SCC apropiado para Vault).
- Vault OSS 1.15+ para compatibilidad con ESO.
- No requiere cambios en las APIs públicas del BaaS.

### 8.4 Idempotencia

- Vault policies usan `vault policy write` (idempotente).
- ExternalSecret CRDs son declarativos (idempotentes).
- La migración SQL usa `CREATE TABLE IF NOT EXISTS` e `INSERT ... ON CONFLICT DO NOTHING`.
- El Job de bootstrap verifica si Vault ya está inicializado antes de `vault operator init`.

---

## 9. Dependencias, paralelización y secuencia

### 9.1 Dependencias previas (ya deben estar completas)

- **US-SEC-01**: Proporciona el modelo de autenticación base (Keycloak OIDC) que se usa para autenticar operadores en el inventario de secretos.
- **US-STO-03**: Las credenciales de S3 son los primeros secretos a migrar.
- **US-FN-03**: Las credenciales de OpenWhisk son secretos del dominio `functions`.

### 9.2 Secuencia recomendada de implementación

```
Semana 1:
  [T1a] Helm sub-chart de Vault (deployment, service, config, init-job, RBAC)
  [T1b] EncryptionConfiguration de k8s (puede ir en paralelo con T1a)
  [T1c] NetworkPolicy para namespace secret-store

Semana 2:
  [T2a] Vault policies HCL (requiere T1a completado y Vault running)
  [T2b] Helm sub-chart de ESO + ClusterSecretStore (requiere T1a)
  [T2c] ExternalSecrets para servicios de plataforma (requiere T2a, T2b)

Semana 3:
  [T3a] secret-audit-handler service (puede ir en paralelo con semana 2)
  [T3b] Kafka topic console.secrets.audit (requiere T3a)
  [T3c] Tabla secret_metadata + migración SQL

Semana 4:
  [T4a] Acción OpenWhisk secret-inventory (requiere T3c)
  [T4b] Contrato OpenAPI + validación
  [T4c] Job de migración de credenciales existentes
  [T4d] Modificaciones fail-closed en charts de servicios (requiere T2c)

Semana 5:
  [T5a] Tests de integración (requiere todo lo anterior)
  [T5b] Script de validación operativa
  [T5c] Alertas y métricas
  [T5d] Documentación operativa
```

### 9.3 Paralelización posible

- Semana 1: T1a, T1b, T1c pueden ir en paralelo.
- Semana 2: T2a y T3a pueden ir en paralelo.
- Semana 4: T4a, T4b, T4c pueden ir en paralelo si T3c está completo.

---

## 10. Criterios de done y evidencia esperada

| Criterio | Evidencia verificable |
|---|---|
| **CD-01**: Vault desplegado y running en `secret-store` namespace | `kubectl get pods -n secret-store` muestra `vault-0` en estado Running; `vault status` devuelve `Unsealed: true` |
| **CD-02**: EncryptionConfiguration activa para Kubernetes Secrets | `kubectl get secret -n secret-store -o yaml \| grep '^  [a-zA-Z]'` muestra valores cifrados (no en base64 decodable a texto plano) |
| **CD-03**: Todos los secretos de servicios del clúster en Vault | `vault kv list secret/platform` devuelve postgresql, mongodb, kafka, s3, openwhisk; análogamente para gateway e iam |
| **CD-04**: ExternalSecrets sincronizados y Ready | `kubectl get externalsecret -A` muestra `STATUS=SecretSynced` para todos |
| **CD-05**: Ningún valor en texto plano en pods | Script `verify-secret-storage.sh` item 1 devuelve 0 credenciales en env vars |
| **CD-06**: Acceso cross-domain denegado | Test `vault-access-control.test.mjs` pasa: SA de `functions` recibe 403 al leer `platform/*` |
| **CD-07**: Acceso cross-tenant denegado | Test `vault-access-control.test.mjs` pasa: tenant A recibe 403 al leer secretos de tenant B |
| **CD-08**: Auditoría completa en Kafka | `kafka-console-consumer --topic console.secrets.audit` muestra eventos para operaciones de lectura y denegación; ningún evento contiene campo `value` |
| **CD-09**: Inventario de metadatos funcional | `GET /v1/secrets/inventory` devuelve lista con metadatos; jq verifica ausencia de campo `value` |
| **CD-10**: Fail-closed verificado | Simular Vault indisponible; confirmar que pods dependientes no arrancan (CrashLoopBackOff con mensaje de error, no con credenciales vacías) |
| **CD-11**: Tabla `secret_metadata` poblada | `SELECT count(*) FROM secret_metadata` > 0; ningún registro tiene columna `value` |
| **CD-12**: Tests de integración pasando | `pnpm test:integration --filter secret-storage` termina con 0 fallos |
| **CD-13**: Migración SQL idempotente | Ejecutar migración dos veces; segunda ejecución sin errores ni cambios |

---

## 11. Documentación

### 11.1 Artefactos de documentación a crear

- `docs/operations/secret-management.md`: guía operativa para el platform team (acceso, inventario, troubleshooting de Vault).
- `docs/architecture/secret-storage-adr.md`: ADR documentando la elección de Vault + ESO vs. alternativas (Sealed Secrets, k8s native only).
- `charts/in-falcone/charts/vault/README.md`: instrucciones de instalación y configuración del sub-chart.
- `services/secret-audit-handler/README.md`: descripción del servicio y configuración.

### 11.2 Variables de entorno nuevas

| Variable | Descripción | Valor por defecto |
|---|---|---|
| `VAULT_ADDR` | URL de Vault | `https://vault.secret-store.svc.cluster.local:8200` |
| `VAULT_NAMESPACE` | Namespace de Vault (Enterprise) | `` (OSS) |
| `VAULT_SKIP_VERIFY` | Deshabilitar verificación TLS (solo dev) | `false` |
| `SECRET_AUDIT_KAFKA_TOPIC` | Topic de auditoría | `console.secrets.audit` |
| `SECRET_AUDIT_KAFKA_BROKERS` | Brokers de Kafka | heredado del clúster |
| `VAULT_UNSEAL_METHOD` | Método de unseal | `shamir` (prod: `transit`) |
| `VAULT_INIT_SHARES` | Shares de Shamir | `5` |
| `VAULT_INIT_THRESHOLD` | Threshold de Shamir | `3` |
