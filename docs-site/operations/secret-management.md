# Secret Management

In Falcone uses **HashiCorp Vault** as the source of truth for secrets, with the **External Secrets Operator (ESO)** syncing them to Kubernetes Secrets.

## Architecture

```
┌──────────────────────────────────────┐
│           HashiCorp Vault            │
│                                      │
│  secret/data/platform/               │
│  ├── keycloak-admin                  │
│  ├── postgresql-credentials          │
│  ├── mongodb-credentials             │
│  ├── kafka-credentials               │
│  ├── minio-credentials               │
│  └── apisix-admin-key                │
│                                      │
│  secret/data/tenant/{tenantSlug}/    │
│  ├── workspace-credentials           │
│  └── api-keys                        │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│    External Secrets Operator (ESO)   │
│                                      │
│  ClusterSecretStore → Vault          │
│  ExternalSecret → K8s Secret         │
└──────────────┬───────────────────────┘
               │
               ▼
┌──────────────────────────────────────┐
│         Kubernetes Secrets           │
│  (consumed by pods via envFrom)      │
└──────────────────────────────────────┘
```

## Setup

### 1. Enable Vault

Vault is deployed as a subchart within the umbrella chart:

```yaml
vault:
  enabled: true
  persistence:
    enabled: true
    size: 5Gi
```

### 2. Initialize Vault

After deployment, initialize and unseal Vault:

```bash
# Port-forward to Vault
kubectl port-forward -n in-falcone-dev svc/in-falcone-vault 8200:8200

# Initialize
export VAULT_ADDR=http://localhost:8200
vault operator init -key-shares=5 -key-threshold=3

# Unseal (repeat with 3 different keys)
vault operator unseal <key-1>
vault operator unseal <key-2>
vault operator unseal <key-3>
```

### 3. Store Platform Secrets

```bash
vault kv put secret/platform/keycloak-admin \
  username=admin \
  password='<strong-password>'

vault kv put secret/platform/postgresql-credentials \
  username=postgres \
  password='<strong-password>'

vault kv put secret/platform/mongodb-credentials \
  username=root \
  password='<strong-password>'

vault kv put secret/platform/kafka-credentials \
  username=admin \
  password='<strong-password>'

vault kv put secret/platform/minio-credentials \
  accessKey=minio \
  secretKey='<strong-password>'

vault kv put secret/platform/apisix-admin-key \
  apiKey='<random-key>'
```

### 4. Enable ESO

```yaml
eso:
  enabled: true
  clusterSecretStore:
    vaultUrl: http://in-falcone-vault:8200
    vaultPath: secret
```

ESO automatically creates `ExternalSecret` resources that sync Vault secrets to Kubernetes Secrets.

## Vault Policies

| Policy | Path | Access | Used By |
|--------|------|--------|---------|
| `platform-policy` | `secret/data/platform/*` | read, list | Control Plane, Bootstrap |
| `tenant-policy` | `secret/data/tenant/*` | read, list, create, update | Provisioning Orchestrator |
| `gateway-policy` | `secret/data/gateway/*` | read | APISIX |
| `functions-policy` | `secret/data/functions/*` | read | OpenWhisk |
| `iam-policy` | `secret/data/iam/*` | read | Keycloak |

## Secret Resolution Strategies

The bootstrap controller supports three strategies for resolving secrets:

### `kubernetesSecret` (Default)

Secret is stored in a Kubernetes Secret and referenced via `secretKeyRef`:

```yaml
env:
  - name: POSTGRES_PASSWORD
    valueFrom:
      secretKeyRef:
        name: in-falcone-postgresql-credentials
        key: password
```

### `env`

Secret is pre-injected as a pod environment variable (e.g., by an external system):

```yaml
env:
  - name: POSTGRES_PASSWORD
    value: "injected-by-external-system"
```

### `externalRef`

Secret is resolved from an external secret manager at runtime:

```yaml
env:
  - name: POSTGRES_PASSWORD
    valueFrom:
      externalRef:
        provider: aws-secrets-manager
        secretName: /falcone/prod/postgresql
        key: password
```

## Audit

All secret access is audited:

- **Vault audit log**: Every read/write to Vault is logged
- **Secret audit handler**: Monitors Kubernetes Secret access patterns
- **Kafka topic**: `console.secrets.audit`

## Troubleshooting

### Vault is Sealed

```bash
# Check seal status
vault status

# Unseal with threshold keys
vault operator unseal <key>
```

### ESO Sync Failure

```bash
# Check ExternalSecret status
kubectl get externalsecrets -n in-falcone-dev

# Check ESO operator logs
kubectl logs -n external-secrets deployment/external-secrets
```

### Pod CrashLooping (Missing Secrets)

```bash
# Verify the secret exists
kubectl get secret in-falcone-bootstrap-secrets -n in-falcone-dev -o yaml

# Check pod events
kubectl describe pod <pod-name> -n in-falcone-dev
```

## Best Practices

1. **Never store secrets in git** — Use Vault or cloud secret managers
2. **Rotate regularly** — Implement automated rotation for database and API credentials
3. **Least privilege** — Each service gets only the secrets it needs
4. **Audit everything** — Monitor secret access patterns for anomalies
5. **Break-glass** — Maintain emergency access procedures for Vault
