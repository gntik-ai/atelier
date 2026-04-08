<p align="center">
  <img src="logo.svg" alt="In Falcone" width="200" />
</p>

<h1 align="center">In Falcone</h1>

<p align="center">
  Self-hosted, multi-tenant Backend-as-a-Service platform
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.es.md">Espa&ntilde;ol</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.zh.md">中文</a>
</p>

---

**In Falcone** is a self-hosted, multi-tenant Backend-as-a-Service (BaaS) platform that provides managed databases, identity, serverless functions, event streaming, and object storage — all deployed on your own Kubernetes or OpenShift infrastructure via a single Helm chart.

It organizes resources in a hierarchical model — platform, tenants, workspaces — with built-in plan governance, quota enforcement, and contextual authorization. Each workspace gets isolated PostgreSQL schemas (with RLS), MongoDB databases, Kafka topics, OpenWhisk namespaces, and S3 bucket paths, all provisioned automatically through an idempotent orchestration engine.

The platform ships with an APISIX API gateway (OIDC auth, rate limiting, idempotency, CORS), a Keycloak-based IAM layer with per-tenant realms, a React management console, realtime WebSocket subscriptions backed by CDC bridges, a full audit pipeline with correlation tracking, and Vault-based secret management via External Secrets Operator.

Deployment is declarative and layered: choose a profile (all-in-one, standard, HA), an environment (dev, staging, prod), and a platform target (Kubernetes, OpenShift, air-gapped) — compose them as Helm value overlays and deploy.

## Documentation

Full documentation is available at **[gntik-ai.github.io/falcone](https://gntik-ai.github.io/falcone/)**.

## Repository Structure

```text
apps/
  control-plane/          # Platform API backend (Node.js 20+ ESM)
  web-console/            # Management UI (React 18 + Vite + Tailwind)
services/
  adapters/               # Provider adapters (Keycloak, PG, Mongo, Kafka, OW, S3)
  internal-contracts/     # Machine-readable JSON schemas & contracts
  provisioning-orchestrator/  # Tenant/workspace lifecycle management
  gateway-config/         # APISIX routing definitions & plugins
  event-gateway/          # Event publishing bridge
  realtime-gateway/       # WebSocket subscription server
  audit/                  # Audit event processing pipeline
  backup-status/          # Backup monitoring service
  pg-cdc-bridge/          # PostgreSQL Change Data Capture
  mongo-cdc-bridge/       # MongoDB Change Data Capture
charts/
  in-falcone/             # Umbrella Helm chart
docs/                     # ADRs & internal reference
tests/                    # Unit, contract, E2E, resilience, hardening
```

## Quick Start

```bash
git clone https://github.com/gntik-ai/falcone.git
cd falcone

helm dependency build charts/in-falcone

helm upgrade --install in-falcone charts/in-falcone \
  --namespace in-falcone-dev --create-namespace \
  -f charts/in-falcone/values.yaml \
  -f charts/in-falcone/values/profiles/all-in-one.yaml \
  -f charts/in-falcone/values/dev.yaml \
  -f charts/in-falcone/values/platform-kubernetes.yaml
```

## Quality Gates

```bash
corepack pnpm install
corepack pnpm lint
corepack pnpm test
corepack pnpm security:deps
```

## License

[MIT](LICENSE)

---

<p align="center">
  <i>Named after <b>Giovanni Falcone</b> (1939–1992), the Italian magistrate who gave his life fighting for justice.</i>
</p>
