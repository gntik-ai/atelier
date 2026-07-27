# Secret Management

Falcone keeps secret **values** out of git, values files, and rendered Helm manifests. Workloads
reference Kubernetes Secrets by name (`config.secretRefs` / `secretKeyRef`). On a fresh install a
pre-install credential bootstrap hook creates or adopts those Secrets **inside the cluster** without
printing their values in `helm template`, `helm diff`, or Helm release manifests. The OpenBao init job
then copies the same values into OpenBao, and the External Secrets Operator (ESO) keeps the Kubernetes
Secrets reconciled from OpenBao after the secret backend is ready.

## Model

```text
credential bootstrap hook ──▶ Kubernetes Secret ──▶ Pods
                                     │
                                     ▼
OpenBao  ──(External Secrets Operator)──▶ Kubernetes Secret
```

- `openbao` (chart alias) — the core secret backend (image `openbao/openbao`, CLI `bao`). Fresh Helm installs provision it by default with self-signed TLS unless you select the cert-manager mode for clusters that already run cert-manager.
- `eso` (chart alias) — the External Secrets Operator, which materializes OpenBao KV paths into namespaced Kubernetes Secrets. Its `ClusterSecretStore` (`openbao-backend`) uses ESO's `vault` provider type, which is the OpenBao-compatible client (the KV v2 REST surface is byte-compatible).
- `templates/platform-credentials.yaml` — the pre-install hook that creates/adopts the initial
  platform Secrets in-cluster. It generates missing values with the bootstrap image and reuses
  existing Secret keys on upgrades.
- `config.secretRefs` — the chart's map of which Secret + keys feed each component.

## secretRefs

```yaml
config:
  secretRefs:
    postgresCredentials:    { existingSecret: in-falcone-postgresql, keys: [POSTGRESQL_USERNAME, POSTGRESQL_PASSWORD, POSTGRESQL_POSTGRES_PASSWORD] }
    mongoCredentials:       { existingSecret: in-falcone-documentdb, keys: [POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB] }
    kafkaCredentials:       { existingSecret: in-falcone-kafka, keys: [KAFKA_CFG_NODE_ID, KAFKA_CFG_PROCESS_ROLES, KAFKA_CFG_CONTROLLER_LISTENER_NAMES, KAFKA_CFG_CONTROLLER_QUORUM_VOTERS, KAFKA_CFG_LISTENERS, KAFKA_CFG_ADVERTISED_LISTENERS, KAFKA_CFG_LISTENER_SECURITY_PROTOCOL_MAP] }
    objectStorageCredentials: { existingSecret: in-falcone-storage, keys: [s3_access_key, s3_secret_key] }
    identityClient:         { existingSecret: in-falcone-identity-client, keys: [client-id, client-secret] }
    gatewayTls:             { existingSecret: in-falcone-dev-api-tls, keys: [tls.crt, tls.key] }
```

To use an externally managed credential, set `existingSecret` to your Secret and keep the OpenBao/ESO
contract coherent. Core components are not disabled with `<component>.enabled=false`; managed-service
paths must still provide the expected Secret keys and chart/runtime wiring.

## Sensitive material is mounted by reference, never inlined

The platform never embeds secret values in manifests or values. Generated material is created by the
credential bootstrap hook as a Secret and consumed via `secretKeyRef`; `helm template` should show the
hook logic, not the generated passwords or DSNs. The document store is **FerretDB over
DocumentDB-on-PostgreSQL**, so there is **no replica-set keyfile** — the gateway authenticates to its
engine with Postgres credentials. For example, when supplying an externally managed DocumentDB Secret:

```bash
openssl rand -hex 24 | tr -d '\n' | \
  kubectl create secret generic in-falcone-documentdb \
    --from-file=POSTGRES_PASSWORD=/dev/stdin -n falcone
# referenced via secretKeyRef (it feeds FERRETDB_POSTGRESQL_URL / MONGO_URI), not an inline value
```

> [!TIP]
> Avoid putting provider-shaped literals (e.g. `sk_live_…`, real cloud keys) even in test fixtures — secret scanners and push protection will reject the commit. Use clearly non-provider placeholders.

## Air-gapped registries

Air-gapped installs add a registry pull secret and CA bundle (`global.imagePullSecrets`, `global.privateRegistry.caBundleConfigMap`) — create these in the namespace before installing. See [OpenShift Install: Harbor or air-gap](/operations/openshift-install#openshift-with-harbor-or-air-gap).

## TLS

Gateway TLS comes from the `gatewayTls` secret (`tls.crt` / `tls.key`); the active mode is set by `publicSurface.tls.mode`.

## Webhook signing master key

The platform-global webhook signing master key uses a dedicated
`global.webhookSigningKey` contract. It is not a `config.secretRefs` entry and C-25 does not add a
KMS, ESO, Vault/OpenBao, or other manager integration for it. A managed fresh install generates an
immutable retained Secret inside the credential hook; `create: false` validates an externally
created Kubernetes Secret read-only.

Never provide this key through `--set`, values, `controlPlane.env`, rendered Secret YAML, Git, logs,
or evidence. Adoption and rotation also couple the database backup to matching current/recovery key
custody. Use the [Webhook Signing Master-Key Lifecycle Runbook](/operations/webhook-signing-key-lifecycle),
including its external-manager in-place mutation warning and finalization deletion boundaries.
