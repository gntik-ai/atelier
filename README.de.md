<p align="center">
  <img src="logo.svg" alt="In Falcone" width="200" />
</p>

<h1 align="center">In Falcone</h1>

<p align="center">
  Selbstgehostete, mandantenf&auml;hige Backend-as-a-Service-Plattform
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.es.md">Espa&ntilde;ol</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.zh.md">中文</a>
</p>

---

**In Falcone** ist eine selbstgehostete, mandantenf&auml;hige Backend-as-a-Service (BaaS)-Plattform, die verwaltete Datenbanken, Identit&auml;tsverwaltung, serverlose Funktionen, Event-Streaming und Objektspeicher bereitstellt — alles auf Ihrer eigenen Kubernetes- oder OpenShift-Infrastruktur &uuml;ber ein einziges Helm-Chart bereitgestellt.

Die Plattform organisiert Ressourcen in einem hierarchischen Modell — Plattform, Mandanten, Arbeitsbereiche — mit integrierter Plan-Governance, Kontingentdurchsetzung und kontextbezogener Autorisierung. Jeder Arbeitsbereich erh&auml;lt isolierte PostgreSQL-Schemata (mit RLS), MongoDB-Datenbanken, Kafka-Topics, OpenWhisk-Namespaces und S3-Bucket-Pfade, die alle automatisch &uuml;ber eine idempotente Orchestrierungs-Engine bereitgestellt werden.

Die Plattform wird mit einem APISIX-API-Gateway (OIDC-Authentifizierung, Rate-Limiting, Idempotenz, CORS), einer Keycloak-basierten IAM-Schicht mit mandantenspezifischen Realms, einer React-Verwaltungskonsole, Echtzeit-WebSocket-Abonnements mit CDC-Bridges, einer vollst&auml;ndigen Audit-Pipeline mit Korrelationsverfolgung und Vault-basierter Geheimnisverwaltung &uuml;ber den External Secrets Operator geliefert.

Die Bereitstellung ist deklarativ und schichtbasiert: W&auml;hlen Sie ein Profil (All-in-One, Standard, HA), eine Umgebung (Dev, Staging, Prod) und eine Zielplattform (Kubernetes, OpenShift, Air-Gapped) — kombinieren Sie diese als Helm-Werte-Overlays und stellen Sie bereit.

## Dokumentation

Die vollst&auml;ndige Dokumentation ist verf&uuml;gbar unter **[gntik-ai.github.io/falcone](https://gntik-ai.github.io/falcone/)**.

## Repository-Struktur

```text
apps/
  control-plane/          # Plattform-API-Backend (Node.js 20+ ESM)
  web-console/            # Verwaltungs-UI (React 18 + Vite + Tailwind)
services/
  adapters/               # Anbieter-Adapter (Keycloak, PG, Mongo, Kafka, OW, S3)
  internal-contracts/     # Maschinenlesbare JSON-Schemata und Vertr&auml;ge
  provisioning-orchestrator/  # Mandanten-/Arbeitsbereich-Lebenszyklusverwaltung
  gateway-config/         # APISIX-Routing-Definitionen und Plugins
  event-gateway/          # Event-Publishing-Bridge
  realtime-gateway/       # WebSocket-Abonnement-Server
  audit/                  # Audit-Event-Verarbeitungspipeline
  backup-status/          # Backup-&Uuml;berwachungsdienst
  pg-cdc-bridge/          # PostgreSQL Change Data Capture
  mongo-cdc-bridge/       # MongoDB Change Data Capture
charts/
  in-falcone/             # Umbrella-Helm-Chart
docs/                     # ADRs und interne Referenz
tests/                    # Unit-, Vertrags-, E2E-, Resilienz-, H&auml;rtungstests
```

## Schnellstart

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

## Qualit&auml;tssicherung

```bash
corepack pnpm install
corepack pnpm lint
corepack pnpm test
corepack pnpm security:deps
```

## Lizenz

[MIT](LICENSE)

---

<p align="center">
  <i>Benannt nach <b>Giovanni Falcone</b> (1939–1992), dem italienischen Richter, der sein Leben im Kampf f&uuml;r die Gerechtigkeit gab.</i>
</p>
