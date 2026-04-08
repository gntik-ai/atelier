# Vault sub-chart

## Prerequisites
- cert-manager
- Kafka reachable for `console.secrets.audit`
- Kubernetes/OpenShift cluster with the `secret-store` namespace

## Key values
- `vault.replicas`
- `vault.storage.size`
- `vault.tls.enabled`
- `vault.unsealMethod`
- `vault.initShares`
- `vault.initThreshold`
- `vault.auditSidecar.kafkaTopic`
- `vault.auditSidecar.kafkaBrokers`
- `vault.image.tag`
- `vault.namespace`

## Bootstrap
1. Install the chart.
2. Wait for the StatefulSet and TLS secret.
3. Run the `vault-init` Job once.
4. Verify `vault status` reports `Unsealed: true`.

## Upgrade notes
- Keep Vault data PVCs intact across upgrades.
- Rotate dummy bootstrap secrets before production use.

## OpenShift notes
- Provide SCC permissions for the Vault pod and init job.
- Apply the OpenShift APIServer encryption configuration equivalent for encrypted Kubernetes Secrets.
