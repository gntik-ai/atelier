# Tasks: Almacenamiento Seguro de Secretos y Credenciales en el Clúster

**Feature Branch**: `091-secure-secret-storage`
**Feature Dir**: `specs/091-secure-secret-storage/`
**Input**: `plan.md` + `spec.md`
**Task ID**: US-SEC-02-T01 | **Epic**: EP-18

**Tech Stack**: Kubernetes/OpenShift, HashiCorp Vault OSS 1.15+, External Secrets Operator (ESO) v0.9+, Node.js 20+ ESM, PostgreSQL (`pg`), Kafka (`kafkajs`), Apache OpenWhisk, Helm, cert-manager

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (independent files, no blocking dependency)
- **[Story]**: User story label (US1–US5)
- Exact file paths included in every task description

## File Path Map (implementation reference)

```text
charts/in-atelier/charts/vault/
  Chart.yaml
  values.yaml
  README.md
  templates/
    vault-deployment.yaml
    vault-service.yaml
    vault-config-configmap.yaml
    vault-pvc.yaml
    vault-init-job.yaml
    vault-migration-job.yaml
    vault-audit-sidecar.yaml
    vault-rbac.yaml
    vault-networkpolicy.yaml
    vault-tls-certificate.yaml
    vault-policies/
      platform-policy.hcl.yaml
      tenant-policy.hcl.yaml
      functions-policy.hcl.yaml
      gateway-policy.hcl.yaml
      iam-policy.hcl.yaml

charts/in-atelier/charts/eso/
  Chart.yaml
  values.yaml
  templates/
    cluster-secret-store.yaml
    eso-rbac.yaml
    eso-networkpolicy.yaml
    external-secrets/
      platform-postgresql.yaml
      platform-mongodb.yaml
      platform-kafka.yaml
      platform-s3.yaml
      platform-openwhisk.yaml
      functions-openwhisk.yaml
      gateway-apisix.yaml
      iam-keycloak.yaml

deploy/k8s/
  encryption-config.yaml

services/secret-audit-handler/
  package.json
  README.md
  src/
    index.mjs
    vault-log-reader.mjs
    kafka-publisher.mjs
    event-schema.mjs
    sanitizer.mjs
  tests/
    unit/
      vault-log-reader.test.mjs
      kafka-publisher.test.mjs
      sanitizer.test.mjs
    integration/
      audit-handler.integration.test.mjs

services/provisioning-orchestrator/src/
  actions/
    secret-inventory.mjs
  tests/
    secret-inventory.test.mjs
  migrations/
    022-secret-metadata.sql

internal-contracts/secrets/
  secret-inventory-v1.yaml
  secret-metadata-v1.yaml
  secret-audit-event-v1.yaml

tests/integration/secret-storage/
  vault-access-control.test.mjs
  vault-audit-log.test.mjs
  eso-sync.test.mjs
  fail-closed.test.mjs
  inventory-api.test.mjs
  secret-no-plaintext.test.mjs

scripts/
  verify-secret-storage.sh

docs/
  operations/secret-management.md
  architecture/secret-storage-adr.md
```

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Scaffold all new package/chart skeletons so parallel work can proceed in Phase 2+

- [ ] T001 Create Vault Helm sub-chart skeleton with `Chart.yaml` (name: vault, version: 0.1.0, appVersion: 1.15.0, dependencies: []) in `charts/in-atelier/charts/vault/Chart.yaml`
- [ ] T002 [P] Create ESO Helm sub-chart skeleton with `Chart.yaml` (name: eso, wrapping external-secrets/external-secrets 0.9+) in `charts/in-atelier/charts/eso/Chart.yaml`
- [ ] T003 [P] Create `services/secret-audit-handler/package.json` — ESM Node.js 20+ package (`"type":"module"`) with dependencies: `kafkajs`, `node:fs`, `node:readline`; devDependencies: `node:test`
- [ ] T004 [P] Create `internal-contracts/secrets/` directory with placeholder README listing the three contracts to be generated (secret-inventory-v1, secret-metadata-v1, secret-audit-event-v1)
- [ ] T005 [P] Create `deploy/k8s/` directory and stub `deploy/k8s/encryption-config.yaml` with boilerplate EncryptionConfiguration skeleton (kind, apiVersion, empty resources list)

---

## Phase 2: Foundational (Vault Core — Blocking Prerequisites)

**Purpose**: Deploy Vault with TLS, init/unseal Job, RBAC, NetworkPolicy, and EncryptionConfiguration so all subsequent phases can consume secrets

**⚠️ CRITICAL**: No user story phase can begin until Vault is running and reachable in `secret-store` namespace

- [ ] T006 Implement `charts/in-atelier/charts/vault/values.yaml` — expose all configurable values: `vault.replicas` (default 1), `vault.storage.size` (default 10Gi), `vault.tls.enabled` (default true), `vault.unsealMethod` (shamir|transit), `vault.initShares` (5), `vault.initThreshold` (3), `vault.auditSidecar.kafkaTopic` (console.secrets.audit), `vault.auditSidecar.kafkaBrokers`, `vault.image.tag` (1.15.0), `vault.namespace` (secret-store)
- [ ] T007 [P] Implement `charts/in-atelier/charts/vault/templates/vault-rbac.yaml` — ServiceAccount `vault` in `secret-store` namespace, ClusterRole with `tokenreviews/create` and `nodes/get` verbs (for Kubernetes auth method), ClusterRoleBinding; also ServiceAccount `eso-vault-auth` for ESO access
- [ ] T008 Implement `charts/in-atelier/charts/vault/templates/vault-config-configmap.yaml` — Vault HCL config: `storage "file" { path = "/vault/data" }`, `listener "tcp" { address = "0.0.0.0:8200", tls_cert_file, tls_key_file }`, `ui = true`, `default_lease_ttl = "24h"`, `max_lease_ttl = "768h"`, `log_level = "info"`, `audit_device "file" { file_path = "/vault/audit/vault-audit.log" }`
- [ ] T009 [P] Implement `charts/in-atelier/charts/vault/templates/vault-pvc.yaml` — PVC for Vault data (`/vault/data`) and audit log volume (`/vault/audit`) using `.Values.vault.storage.size`
- [ ] T010 Implement `charts/in-atelier/charts/vault/templates/vault-deployment.yaml` — StatefulSet (1 or 3 replicas per `vault.replicas`), image `hashicorp/vault:{{ .Values.vault.image.tag }}`, liveness/readiness probes on `/v1/sys/health`, volumeMounts for data PVC + audit PVC + config ConfigMap + TLS cert; securityContext `runAsNonRoot: true`, `readOnlyRootFilesystem: true` (except /vault/data and /vault/audit)
- [ ] T011 [P] Implement `charts/in-atelier/charts/vault/templates/vault-service.yaml` — ClusterIP Service exposing port 8200 (API+UI) and 8201 (cluster) in namespace `secret-store`
- [ ] T012 Implement `charts/in-atelier/charts/vault/templates/vault-tls-certificate.yaml` — cert-manager Certificate resource (or self-signed Secret) for `vault.secret-store.svc.cluster.local`; TLS SAN includes `vault`, `vault.secret-store`, `vault.secret-store.svc`, `vault.secret-store.svc.cluster.local`
- [ ] T013 Implement `charts/in-atelier/charts/vault/templates/vault-init-job.yaml` — Kubernetes Job that: (1) checks `vault status` to skip if already initialized; (2) runs `vault operator init -key-shares={{ .Values.vault.initShares }} -key-threshold={{ .Values.vault.initThreshold }}`; (3) stores unseal keys and root token in a Kubernetes Secret `vault-init-keys` in `secret-store` (accessible only by this Job and superadmin); (4) runs `vault operator unseal` three times; (5) enables Kubernetes auth method (`vault auth enable kubernetes`); (6) configures Kubernetes auth with cluster host and SA JWT; (7) enables KV v2 secrets engine at `secret/`; (8) enables file audit device; (9) applies all HCL policies from ConfigMaps; (10) creates dummy initial secrets at every required path
- [ ] T014 [P] Implement `charts/in-atelier/charts/vault/templates/vault-networkpolicy.yaml` — NetworkPolicy in `secret-store`: ingress on port 8200 ONLY from namespaces labeled `vault-access: "true"` and from namespace `eso-system`; egress to Kubernetes API (443) for token review; deny all else

---

## Phase 3: US1 — Almacenamiento Centralizado de Secretos (P1) 🎯 MVP

**Goal**: All cluster service credentials stored in Vault and synced via ESO ExternalSecrets; no plaintext credentials in pod specs

**Independent Test**: Deploy cluster, run `scripts/verify-secret-storage.sh` item 1 — confirms 0 env vars with PASSWORD|SECRET|KEY|TOKEN values; confirm `vault kv list secret/platform` returns postgresql, mongodb, kafka, s3, openwhisk

- [ ] T015 [US1] Implement `charts/in-atelier/charts/eso/values.yaml` — values: `eso.vaultAddress` (`https://vault.secret-store.svc.cluster.local:8200`), `eso.vaultAuthPath` (kubernetes), `eso.vaultAuthRole` (eso-role), `eso.serviceAccountName` (eso-vault-auth), `eso.refreshInterval` (1h)
- [ ] T016 [US1] Implement `charts/in-atelier/charts/eso/templates/eso-rbac.yaml` — Role + RoleBinding in each service namespace allowing ESO ServiceAccount to `create/update/delete` Kubernetes Secrets; ClusterRole for reading ServiceAccount tokens (TokenReview)
- [ ] T017 [US1] Implement `charts/in-atelier/charts/eso/templates/eso-networkpolicy.yaml` — allow egress from `eso-system` namespace to `secret-store` on port 8200; deny direct pod-to-Vault from other namespaces
- [ ] T018 [US1] Implement `charts/in-atelier/charts/eso/templates/cluster-secret-store.yaml` — ClusterSecretStore `vault-backend` authenticating to Vault using `kubernetes` auth with ServiceAccount `eso-vault-auth` in `eso-system`; mount KV v2 at `secret/`
- [ ] T019 [P] [US1] Implement `charts/in-atelier/charts/eso/templates/external-secrets/platform-postgresql.yaml` — ExternalSecret `platform-postgresql-credentials` syncing keys `root-password` and `app-password` from `secret/data/platform/postgresql/` into Kubernetes Secret `platform-postgresql-credentials` in `postgresql` namespace; `refreshInterval: 1h`
- [ ] T020 [P] [US1] Implement `charts/in-atelier/charts/eso/templates/external-secrets/platform-mongodb.yaml` — ExternalSecret `platform-mongodb-credentials` syncing `root-password`, `app-password` from `secret/data/platform/mongodb/`; target namespace `mongodb`
- [ ] T021 [P] [US1] Implement `charts/in-atelier/charts/eso/templates/external-secrets/platform-kafka.yaml` — ExternalSecret `platform-kafka-credentials` syncing `admin-password`, `inter-broker-secret` from `secret/data/platform/kafka/`; target namespace `kafka`
- [ ] T022 [P] [US1] Implement `charts/in-atelier/charts/eso/templates/external-secrets/platform-s3.yaml` — ExternalSecret `platform-s3-credentials` syncing `access-key`, `secret-key` from `secret/data/platform/s3/`; target namespace `s3-compat`
- [ ] T023 [P] [US1] Implement `charts/in-atelier/charts/eso/templates/external-secrets/platform-openwhisk.yaml` — ExternalSecret `platform-openwhisk-credentials` syncing `db-password` from `secret/data/platform/openwhisk/`; target namespace `openwhisk`
- [ ] T024 [P] [US1] Implement `charts/in-atelier/charts/eso/templates/external-secrets/functions-openwhisk.yaml` — ExternalSecret `functions-openwhisk-credentials` syncing `controller-password`, `invoker-password`, `action-encryption-key` from `secret/data/functions/openwhisk/`; target namespace `openwhisk`
- [ ] T025 [P] [US1] Implement `charts/in-atelier/charts/eso/templates/external-secrets/gateway-apisix.yaml` — ExternalSecret `gateway-apisix-credentials` syncing `admin-key`, `dashboard-password`, `etcd-password` from `secret/data/gateway/apisix/`; target namespace `apisix`
- [ ] T026 [P] [US1] Implement `charts/in-atelier/charts/eso/templates/external-secrets/iam-keycloak.yaml` — ExternalSecret `iam-keycloak-credentials` syncing `admin-password`, `db-password` from `secret/data/iam/keycloak/`; target namespace `keycloak`
- [ ] T027 [US1] Implement `charts/in-atelier/charts/vault/templates/vault-migration-job.yaml` — idempotent migration Job that: (1) reads existing credentials from current Helm values/Secrets using `kubectl get secret`; (2) writes each to Vault at correct path using `vault kv put`; (3) records each migration in `secret_metadata` table (INSERT ON CONFLICT DO NOTHING); (4) verifies each service can resolve secrets before removing inline credentials; includes rollback annotation comment

---

## Phase 4: US2 — Segregación de Secretos por Dominio Funcional (P1)

**Goal**: Vault HCL policies enforce domain isolation; cross-domain access returns 403; tenant isolation enforced by path parameterization

**Independent Test**: Run `tests/integration/secret-storage/vault-access-control.test.mjs` — SA of `functions` domain receives 403 reading `platform/*`; tenant A SA receives 403 reading tenant B secrets

- [ ] T028 [US2] Implement `charts/in-atelier/charts/vault/templates/vault-policies/platform-policy.hcl.yaml` — ConfigMap with HCL: `path "secret/data/platform/*" { capabilities = ["read"] }`, `path "secret/metadata/platform/*" { capabilities = ["list","read"] }`; denies all other paths implicitly
- [ ] T029 [P] [US2] Implement `charts/in-atelier/charts/vault/templates/vault-policies/tenant-policy.hcl.yaml` — ConfigMap with HCL parameterized by entity alias metadata `tenantId`: `path "secret/data/tenant/{{identity.entity.aliases.auth_kubernetes_cluster_1.metadata.tenantId}}/*" { capabilities = ["read"] }`, `path "secret/metadata/tenant/..." { capabilities = ["list","read"] }`
- [ ] T030 [P] [US2] Implement `charts/in-atelier/charts/vault/templates/vault-policies/functions-policy.hcl.yaml` — ConfigMap with HCL: `path "secret/data/functions/*" { capabilities = ["read"] }`, `path "secret/metadata/functions/*" { capabilities = ["list","read"] }`
- [ ] T031 [P] [US2] Implement `charts/in-atelier/charts/vault/templates/vault-policies/gateway-policy.hcl.yaml` — ConfigMap with HCL: `path "secret/data/gateway/*" { capabilities = ["read"] }`, `path "secret/metadata/gateway/*" { capabilities = ["list","read"] }`
- [ ] T032 [P] [US2] Implement `charts/in-atelier/charts/vault/templates/vault-policies/iam-policy.hcl.yaml` — ConfigMap with HCL: `path "secret/data/iam/*" { capabilities = ["read"] }`, `path "secret/metadata/iam/*" { capabilities = ["list","read"] }`
- [ ] T033 [US2] Update `charts/in-atelier/charts/vault/templates/vault-init-job.yaml` — extend init Job to apply all 5 domain policies via `vault policy write platform /config/policies/platform.hcl` (and analogously for tenant, functions, gateway, iam); create Vault roles binding each policy to the corresponding ServiceAccount namespace labels
- [ ] T034 [P] [US2] Write integration test `tests/integration/secret-storage/vault-access-control.test.mjs` — test cases: (a) SA `functions-sa` reads `secret/data/platform/postgresql/app-password` → expect 403; (b) tenant-A SA reads `secret/data/tenant/tenant-b/*` → expect 403; (c) SA `gateway-sa` reads `secret/data/gateway/apisix/admin-key` → expect 200; (d) unauthenticated request → expect 403; uses node:test + vault HTTP API client

---

## Phase 5: US3 — Cifrado en Reposo y en Tránsito (P1)

**Goal**: EncryptionConfiguration active in kube-apiserver for Kubernetes Secrets; all Vault traffic over TLS; Vault internal storage encrypted; ExternalSecret tokens expire

**Independent Test**: `kubectl get secret -n secret-store -o yaml` — values are encrypted ciphertext, not base64-decodable plaintext; `openssl s_client -connect vault.secret-store.svc.cluster.local:8200` returns valid TLS cert

- [ ] T035 [US3] Implement `deploy/k8s/encryption-config.yaml` — EncryptionConfiguration apiVersion `apiserver.config.k8s.io/v1`: resources `secrets` with provider `aescbc` (key1, 32-byte key sourced from Vault `platform/encryption/master-key` via init Job bootstrap); fallback `identity: {}` for read compatibility; includes comment for OpenShift equivalent (`apiserver.config.openshift.io/v1` + `APIServer` object)
- [ ] T036 [P] [US3] Update `charts/in-atelier/charts/vault/templates/vault-deployment.yaml` — mount TLS cert from `vault-tls-certificate.yaml` secret; set env vars `VAULT_CACERT`, `VAULT_ADDR=https://...`; set `VAULT_SKIP_VERIFY=false`; verify readiness probe uses `https://`
- [ ] T037 [P] [US3] Update `charts/in-atelier/charts/eso/templates/cluster-secret-store.yaml` — add `caBundle` or `caProvider` referencing the Vault CA cert; set ESO token refresh to `24h` (configurable via `eso.tokenTTL`)
- [ ] T038 [P] [US3] Update all ExternalSecret templates in `charts/in-atelier/charts/eso/templates/external-secrets/` — add `immutable: true` annotation to synced Kubernetes Secrets that are static (postgres root-password, kafka inter-broker-secret, etc.) to prevent accidental mutation; document which secrets must be mutable for rotation (T02 scope)

---

## Phase 6: US4 — Auditoría de Acceso a Secretos (P2)

**Goal**: Every Vault operation (read, write, delete, deny) emits a `SecretAuditEvent` to Kafka topic `console.secrets.audit`; no secret values ever appear in audit events

**Independent Test**: Perform a read and a denied read; run `kafka-console-consumer --topic console.secrets.audit --from-beginning --max-messages 2`; confirm both events present, neither contains a `value` or `data` field

- [ ] T039 [US4] Implement `services/secret-audit-handler/src/event-schema.mjs` — export `SecretAuditEvent` schema object (plain JS object + JSDoc) with fields: `eventId` (UUID), `timestamp` (ISO-8601), `operation` (read|write|delete|denied), `domain` (platform|tenant|functions|gateway|iam), `secretPath`, `secretName`, `requestorIdentity` ({type, name, namespace, serviceAccount}), `result` (success|denied|error), `denialReason` (nullable), `vaultRequestId`; export `FORBIDDEN_FIELDS = ['value','data','secret','password','token','key']`
- [ ] T040 [P] [US4] Implement `services/secret-audit-handler/src/sanitizer.mjs` — export `sanitize(rawVaultLogEntry)`: recursively removes any field whose key matches FORBIDDEN_FIELDS pattern (case-insensitive); returns cleaned event object; throws if output still contains any FORBIDDEN_FIELDS match
- [ ] T041 [US4] Implement `services/secret-audit-handler/src/vault-log-reader.mjs` — export `createLogTailer(filePath)`: uses `fs.watch` + `readline` to tail `/vault/audit/vault-audit.log` (shared volume); emits parsed JSON entries via async generator; handles log rotation (SIGHUP); exports `parseVaultEntry(line)` that maps Vault audit JSON to `SecretAuditEvent` shape
- [ ] T042 [P] [US4] Implement `services/secret-audit-handler/src/kafka-publisher.mjs` — export `createPublisher({ brokers, topic })`: creates `kafkajs` producer; export `publishAuditEvent(event)` that validates event against schema (no forbidden fields), publishes to `console.secrets.audit` with key = `event.domain`, headers `{ eventId, domain }`; logs publish errors without rethrowing; uses existing `kafkajs` retry config pattern from `services/provisioning-orchestrator`
- [ ] T043 [US4] Implement `services/secret-audit-handler/src/index.mjs` — entry point: reads `VAULT_AUDIT_LOG_PATH` (default `/vault/audit/vault-audit.log`), `KAFKA_BROKERS`, `SECRET_AUDIT_KAFKA_TOPIC`; starts log tailer, sanitizes each entry, publishes to Kafka; handles SIGTERM gracefully (flush + disconnect); exits with code 1 if Kafka connection fails at startup
- [ ] T044 [P] [US4] Write unit test `services/secret-audit-handler/tests/unit/sanitizer.test.mjs` — using `node:test`: (a) sanitize removes `value`, `data`, `password`, `token`, `key`, `secret` fields at any nesting depth; (b) sanitize preserves allowed fields (`secretPath`, `domain`, `operation`); (c) sanitize throws if forbidden field survives
- [ ] T045 [P] [US4] Write unit test `services/secret-audit-handler/tests/unit/vault-log-reader.test.mjs` — mock vault audit log lines; verify `parseVaultEntry` maps `type`, `auth.display_name`, `request.path`, `response.auth`, `time` correctly to `SecretAuditEvent` shape; verify denied entries set `operation=denied`
- [ ] T046 [P] [US4] Write unit test `services/secret-audit-handler/tests/unit/kafka-publisher.test.mjs` — mock `kafkajs` producer; verify `publishAuditEvent` rejects events containing forbidden fields; verify correct topic and partition key used; verify disconnects on SIGTERM
- [ ] T047 [US4] Implement `charts/in-atelier/charts/vault/templates/vault-audit-sidecar.yaml` — sidecar container in Vault StatefulSet: image `node:20-alpine`, runs `services/secret-audit-handler/src/index.mjs`, mounts shared `vault-audit` volume (read-only), env vars `KAFKA_BROKERS`, `SECRET_AUDIT_KAFKA_TOPIC`, `VAULT_AUDIT_LOG_PATH=/vault/audit/vault-audit.log`; resource limits: 128Mi / 100m
- [ ] T048 [P] [US4] Add Kafka topic `console.secrets.audit` to cluster Kafka configuration — partitions: 3, retention: 90 days (7776000000 ms), cleanup.policy: delete (append-only audit log), min.insync.replicas: 2; add topic definition to the existing Kafka topics Helm chart or ConfigMap in `charts/in-atelier/`

---

## Phase 7: US5 — Inventario y Visibilidad de Secretos para Operadores (P3)

**Goal**: Operators can list secret metadata (no values) and inspect access policies; `secret_metadata` table populated on every secret write

**Independent Test**: `GET /v1/secrets/inventory?domain=platform` returns JSON with `secrets[]` array where each item has `name, domain, path, createdAt, updatedAt, status`; `jq` confirms no `value` field present

- [ ] T049 [US5] Implement migration `services/provisioning-orchestrator/src/migrations/022-secret-metadata.sql` — CREATE TABLE IF NOT EXISTS `secret_metadata` with columns: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`, `secret_path TEXT NOT NULL`, `domain TEXT NOT NULL`, `tenant_id UUID` (nullable), `secret_name TEXT NOT NULL`, `secret_type TEXT NOT NULL` (password|token|key|certificate), `status TEXT NOT NULL DEFAULT 'active'`, `created_at TIMESTAMPTZ DEFAULT now()`, `updated_at TIMESTAMPTZ DEFAULT now()`, `last_accessed_at TIMESTAMPTZ`, `created_by TEXT`, `vault_mount TEXT NOT NULL DEFAULT 'secret'`, UNIQUE(domain, tenant_id, secret_name); CREATE INDEX IF NOT EXISTS for domain, tenant_id, status; invariant comment: NO value column ever
- [ ] T050 [US5] Implement `services/provisioning-orchestrator/src/actions/secret-inventory.mjs` — OpenWhisk action: validates Keycloak JWT has role `platform-operator` or `superadmin` (else 403); accepts query params `domain` (required), `tenantId` (optional for tenant domain); queries `secret_metadata` table via `pg`; returns `{ secrets: [{ name, domain, path, createdAt, updatedAt, status, secretType }] }`; NEVER includes `value`, `data`, or any secret material; supports pagination (`offset`, `limit`, default 50)
- [ ] T051 [P] [US5] Write unit test `services/provisioning-orchestrator/src/tests/secret-inventory.test.mjs` — using `node:test`: (a) returns 403 for missing/invalid JWT; (b) returns 403 for JWT without required role; (c) returns metadata list for authorized operator; (d) response never contains `value` or `data` field; (e) cross-tenant query denied (tenant-scoped operator requesting another tenant's domain); mock `pg` client
- [ ] T052 [P] [US5] Implement OpenAPI contract `internal-contracts/secrets/secret-inventory-v1.yaml` — OpenAPI 3.0 schema for `GET /v1/secrets/inventory`: query params `domain` (enum: platform|tenant|functions|gateway|iam), `tenantId` (string, conditional), `offset` (int), `limit` (int); response 200 `application/json` with schema `SecretInventoryResponse` (secrets array of `SecretMetadataItem`); SecretMetadataItem properties: name, domain, path, createdAt, updatedAt, status, secretType; explicitly `not` includes `value`, `data`
- [ ] T053 [P] [US5] Implement OpenAPI contract `internal-contracts/secrets/secret-metadata-v1.yaml` — OpenAPI 3.0 schema for `GET /v1/secrets/{domain}/{path}`: path params domain + path; response 200 with `SecretMetadataDetail` (same fields as Item + `lastAccessedAt`, `vaultMount`, `accessPolicies: []`); 403 for unauthorized; 404 for not-found
- [ ] T054 [P] [US5] Implement OpenAPI contract `internal-contracts/secrets/secret-audit-event-v1.yaml` — JSON Schema for `SecretAuditEvent` Kafka message: required fields `eventId, timestamp, operation, domain, secretPath, secretName, requestorIdentity, result`; `additionalProperties: false` to prevent accidental value leakage; `not: { required: ["value"] }`, `not: { required: ["data"] }`

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Fail-closed enforcement, integration tests, operational tooling, documentation, alerting

### Fail-Closed (FR-010 / SC-006)

- [ ] T055 Update `charts/in-atelier/charts/postgresql/` (or relevant sub-chart) — add `initContainer` `wait-for-secret`: image `bitnami/kubectl`, command verifies `platform-postgresql-credentials` Secret exists and is non-empty before allowing PostgreSQL container to start; readiness probe depends on successful secret mount at `/run/secrets/pg/`; update `volumeMounts` to use `secret:platform-postgresql-credentials` mounted at `/run/secrets/pg/` instead of env vars
- [ ] T056 [P] Update `charts/in-atelier/charts/mongodb/` — same fail-closed initContainer pattern for `platform-mongodb-credentials`; mount at `/run/secrets/mongo/`; remove inline credential env vars
- [ ] T057 [P] Update `charts/in-atelier/charts/kafka/` — same fail-closed initContainer for `platform-kafka-credentials`; mount at `/run/secrets/kafka/`
- [ ] T058 [P] Update `charts/in-atelier/charts/apisix/` — same fail-closed initContainer for `gateway-apisix-credentials`; mount at `/run/secrets/apisix/`
- [ ] T059 [P] Update `charts/in-atelier/charts/keycloak/` — same fail-closed initContainer for `iam-keycloak-credentials`; mount at `/run/secrets/keycloak/`

### Integration Tests

- [ ] T060 Write integration test `tests/integration/secret-storage/vault-audit-log.test.mjs` — perform authorized read of `platform/postgresql/app-password`; perform unauthorized read from functions SA; query Kafka topic `console.secrets.audit`; assert: (a) read event present with `operation=read`, `result=success`; (b) deny event present with `operation=denied`, `result=denied`; (c) neither event has `value` or `data` field; uses `kafkajs` consumer + vault client
- [ ] T061 [P] Write integration test `tests/integration/secret-storage/eso-sync.test.mjs` — verify ExternalSecrets are in `SecretSynced` condition for all 8 services; verify synced Kubernetes Secrets are non-empty; verify secrets are mounted as files (not env vars) in service pods; timeout: 120s for sync
- [ ] T062 [P] Write integration test `tests/integration/secret-storage/fail-closed.test.mjs` — scale down Vault to 0 replicas; attempt to (re)start a service pod; assert pod enters `Init:Error` or `Init:CrashLoopBackOff` with explicit error message, NOT with default/empty credentials; scale Vault back up; assert pod recovers
- [ ] T063 [P] Write integration test `tests/integration/secret-storage/inventory-api.test.mjs` — call `GET /v1/secrets/inventory?domain=platform` with valid platform-operator JWT; assert 200 with non-empty secrets array; assert no `value`/`data` fields; call with no auth → 401; call with non-operator JWT → 403; call with tenant-scoped JWT for platform domain → 403
- [ ] T064 [P] Write integration test `tests/integration/secret-storage/secret-no-plaintext.test.mjs` — run `kubectl get pods -A -o json` and parse all container env vars; assert zero matches for `/PASSWORD|SECRET|KEY|TOKEN/i` with literal values; run `kubectl get configmap -A -o yaml` and assert no credential patterns match; encode the assertions as node:test cases

### Operational Tooling

- [ ] T065 Implement `scripts/verify-secret-storage.sh` — executable bash script with 4 checks: (1) `kubectl get pods -A -o json | jq` count of env vars with literal PASSWORD|SECRET|KEY|TOKEN values → must be 0; (2) `vault kv list secret/platform` → must return postgresql, mongodb, kafka, s3, openwhisk; (3) `kubectl get externalsecret -A -o json | jq` all ExternalSecrets STATUS=SecretSynced; (4) curl `GET /v1/secrets/inventory` with operator token, jq assert no `.secrets[].value`; exits 0 if all pass, 1 with failure details otherwise; add usage comment header

### Observability & Alerting

- [ ] T066 [P] Add Vault metrics and PrometheusRule to `charts/in-atelier/charts/vault/templates/` — expose `vault_secret_access_total{domain,operation,result}` (counter), `vault_secret_deny_total{domain,reason}` (counter), `vault_audit_lag_seconds` (gauge), `vault_unseal_status` (gauge 0=sealed,1=unsealed) via Vault Prometheus endpoint `/v1/sys/metrics`; create PrometheusRule with alerts: `VaultSealed` (unsealed=0 for >60s), `SecretAccessDeniedSpike` (>10 denies/5min from same identity), `AuditKafkaLag` (lag>30s), `ExternalSecretSyncFailed` (NotReady>5min)

### Documentation

- [ ] T067 [P] Create `docs/operations/secret-management.md` — platform team runbook: Vault access procedures (how to read/write secrets as operator), inventory query examples, troubleshooting (Vault sealed, ESO sync failure, fail-closed pod loop), unseal procedure, audit log query via Kafka, environment variable reference table from plan.md Section 11.2
- [ ] T068 [P] Create `docs/architecture/secret-storage-adr.md` — ADR: context (plaintext credentials risk), decision (Vault OSS + ESO), alternatives considered (Sealed Secrets, k8s-native only, AWS Secrets Manager), consequences, date 2026-03-30
- [ ] T069 [P] Create `charts/in-atelier/charts/vault/README.md` — sub-chart installation guide: prerequisites (cert-manager, Kafka), values reference (all values from T006), upgrade notes, initial bootstrap steps, OpenShift-specific notes (SCC, apiserver config)
- [ ] T070 [P] Create `services/secret-audit-handler/README.md` — service description, environment variables (`VAULT_AUDIT_LOG_PATH`, `KAFKA_BROKERS`, `SECRET_AUDIT_KAFKA_TOPIC`), deployment notes (runs as Vault sidecar), log format reference, security invariants (no value in published events)
- [ ] T071 Update `AGENTS.md` — add Secure Secret Storage section under `<!-- MANUAL ADDITIONS START -->`: new Vault service in `secret-store` namespace, ESO in `eso-system`, `secret-audit-handler` sidecar, `secret_metadata` PostgreSQL table, Kafka topic `console.secrets.audit` (90d), new env vars from plan.md Section 11.2, Vault KV path structure summary

---

## Dependencies Graph

```text
Phase 1 (T001–T005)                    → no dependencies
Phase 2 (T006–T014): Vault Core        → requires Phase 1
Phase 3 (T015–T027): US1 Centralized   → requires Phase 2 (Vault running)
Phase 4 (T028–T034): US2 Segregation   → requires Phase 2 (Vault policies)
Phase 5 (T035–T038): US3 Encryption    → requires Phase 2 (Vault TLS)
Phase 6 (T039–T048): US4 Audit         → requires Phase 2 (Vault audit device), Phase 3 (Kafka topic)
Phase 7 (T049–T054): US5 Inventory     → requires Phase 3 (secret_metadata migration)
Phase 8 (T055–T071): Polish            → requires Phases 3–7
```

**Parallel opportunities**:
- Phases 3, 4, 5, 6 can start in parallel once Phase 2 is complete
- Phase 7 can start once Phase 3 (T049 migration) is done
- Within each phase, tasks marked [P] can run in parallel
- `services/secret-audit-handler/` (T039–T046) is fully independent of chart work until T047

## Implementation Strategy

**MVP (Week 1–2)**: Complete Phase 1 + Phase 2 + Phase 3 (T001–T027) — Vault running, all cluster secrets in Vault, ESO syncing, no plaintext in pods. This satisfies SC-001, SC-002, and partially SC-006.

**Increment 2 (Week 3)**: Phase 4 + Phase 5 — domain segregation policies active, encryption config applied. Satisfies SC-004, SC-005.

**Increment 3 (Week 4)**: Phase 6 — audit handler live, events flowing to Kafka. Satisfies SC-003.

**Increment 4 (Week 5)**: Phase 7 + Phase 8 — inventory API, fail-closed verified, full integration test suite green. All SC criteria met.

## Total Task Count

| Phase | Story | Tasks | Parallelizable |
|---|---|---|---|
| Phase 1: Setup | — | 5 | 4 |
| Phase 2: Foundational | — | 9 | 5 |
| Phase 3: US1 Centralized | US1 (P1) | 13 | 10 |
| Phase 4: US2 Segregation | US2 (P1) | 7 | 5 |
| Phase 5: US3 Encryption | US3 (P1) | 4 | 3 |
| Phase 6: US4 Audit | US4 (P2) | 10 | 7 |
| Phase 7: US5 Inventory | US5 (P3) | 6 | 5 |
| Phase 8: Polish | — | 17 | 14 |
| **Total** | | **71** | **53** |

**Independent test criteria per story**:
- **US1**: `verify-secret-storage.sh` check 1 returns 0; `vault kv list secret/platform` succeeds
- **US2**: `vault-access-control.test.mjs` passes with 0 failures
- **US3**: kube secret values are encrypted ciphertext; Vault port 8200 requires TLS
- **US4**: Two audit events in `console.secrets.audit` after read + denied-read; no value fields
- **US5**: `GET /v1/secrets/inventory` returns metadata without values in <5s
