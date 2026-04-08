<p align="center">
  <img src="logo.svg" alt="In Falcone" width="200" />
</p>

<h1 align="center">In Falcone</h1>

<p align="center">
  Piattaforma Backend-as-a-Service multi-tenant self-hosted
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.es.md">Espa&ntilde;ol</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.zh.md">中文</a>
</p>

---

**In Falcone** &egrave; una piattaforma Backend-as-a-Service (BaaS) self-hosted e multi-tenant che fornisce database gestiti, identit&agrave;, funzioni serverless, streaming di eventi e object storage — il tutto distribuito sulla propria infrastruttura Kubernetes o OpenShift tramite un singolo chart Helm.

Organizza le risorse in un modello gerarchico — piattaforma, tenant, workspace — con governance dei piani, applicazione delle quote e autorizzazione contestuale integrate. Ogni workspace ottiene schemi PostgreSQL isolati (con RLS), database MongoDB, topic Kafka, namespace OpenWhisk e percorsi bucket S3, tutti provisionati automaticamente tramite un motore di orchestrazione idempotente.

La piattaforma include un API gateway APISIX (autenticazione OIDC, rate limiting, idempotenza, CORS), un livello IAM basato su Keycloak con realm per tenant, una console di gestione React, sottoscrizioni WebSocket in tempo reale supportate da bridge CDC, una pipeline di audit completa con tracciamento della correlazione e gestione dei segreti con Vault tramite External Secrets Operator.

Il deployment &egrave; dichiarativo e stratificato: scegli un profilo (all-in-one, standard, HA), un ambiente (dev, staging, prod) e una piattaforma target (Kubernetes, OpenShift, air-gapped) — componili come overlay di valori Helm e distribuisci.

## Documentazione

La documentazione completa &egrave; disponibile su **[gntik-ai.github.io/falcone](https://gntik-ai.github.io/falcone/)**.

## Struttura del Repository

```text
apps/
  control-plane/          # API backend della piattaforma (Node.js 20+ ESM)
  web-console/            # UI di gestione (React 18 + Vite + Tailwind)
services/
  adapters/               # Adattatori provider (Keycloak, PG, Mongo, Kafka, OW, S3)
  internal-contracts/     # Schemi JSON e contratti leggibili dalle macchine
  provisioning-orchestrator/  # Gestione del ciclo di vita tenant/workspace
  gateway-config/         # Definizioni routing APISIX e plugin
  event-gateway/          # Bridge di pubblicazione eventi
  realtime-gateway/       # Server sottoscrizioni WebSocket
  audit/                  # Pipeline di elaborazione eventi di audit
  backup-status/          # Servizio di monitoraggio backup
  pg-cdc-bridge/          # Change Data Capture per PostgreSQL
  mongo-cdc-bridge/       # Change Data Capture per MongoDB
charts/
  in-falcone/             # Chart Helm umbrella
docs/                     # ADR e riferimenti interni
tests/                    # Unit, contratti, E2E, resilienza, hardening
```

## Avvio Rapido

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

## Controllo Qualit&agrave;

```bash
corepack pnpm install
corepack pnpm lint
corepack pnpm test
corepack pnpm security:deps
```

## Licenza

[MIT](LICENSE)

---

<p align="center">
  <i>Dedicato a <b>Giovanni Falcone</b> (1939–1992), il magistrato italiano che ha dato la vita nella lotta per la giustizia.</i>
</p>
