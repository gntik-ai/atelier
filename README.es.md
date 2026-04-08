<p align="center">
  <img src="logo.svg" alt="In Falcone" width="200" />
</p>

<h1 align="center">In Falcone</h1>

<p align="center">
  Plataforma Backend-as-a-Service multi-tenant autoalojada
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.es.md">Espa&ntilde;ol</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.zh.md">中文</a>
</p>

---

**In Falcone** es una plataforma Backend-as-a-Service (BaaS) autoalojada y multi-tenant que proporciona bases de datos gestionadas, identidad, funciones serverless, streaming de eventos y almacenamiento de objetos — todo desplegado en tu propia infraestructura Kubernetes u OpenShift mediante un único chart de Helm.

Organiza los recursos en un modelo jerárquico — plataforma, tenants, workspaces — con gobernanza de planes, aplicación de cuotas y autorización contextual integradas. Cada workspace obtiene esquemas PostgreSQL aislados (con RLS), bases de datos MongoDB, topics de Kafka, namespaces de OpenWhisk y rutas de buckets S3, todo provisionado automáticamente mediante un motor de orquestación idempotente.

La plataforma incluye un API gateway APISIX (autenticación OIDC, rate limiting, idempotencia, CORS), una capa de IAM basada en Keycloak con realms por tenant, una consola de gestión en React, suscripciones WebSocket en tiempo real respaldadas por bridges CDC, un pipeline completo de auditoría con seguimiento de correlación, y gestión de secretos con Vault mediante External Secrets Operator.

El despliegue es declarativo y por capas: elige un perfil (all-in-one, standard, HA), un entorno (dev, staging, prod) y una plataforma objetivo (Kubernetes, OpenShift, air-gapped) — compónlos como overlays de valores Helm y despliega.

## Documentación

La documentación completa está disponible en **[gntik-ai.github.io/falcone](https://gntik-ai.github.io/falcone/)**.

## Estructura del Repositorio

```text
apps/
  control-plane/          # API de la plataforma (Node.js 20+ ESM)
  web-console/            # UI de gestión (React 18 + Vite + Tailwind)
services/
  adapters/               # Adaptadores de proveedores (Keycloak, PG, Mongo, Kafka, OW, S3)
  internal-contracts/     # Esquemas JSON y contratos
  provisioning-orchestrator/  # Gestión del ciclo de vida de tenants/workspaces
  gateway-config/         # Definiciones de rutas APISIX y plugins
  event-gateway/          # Bridge de publicación de eventos
  realtime-gateway/       # Servidor de suscripciones WebSocket
  audit/                  # Pipeline de procesamiento de auditoría
  backup-status/          # Servicio de monitoreo de backups
  pg-cdc-bridge/          # Change Data Capture para PostgreSQL
  mongo-cdc-bridge/       # Change Data Capture para MongoDB
charts/
  in-falcone/             # Chart Helm umbrella
docs/                     # ADRs y referencia interna
tests/                    # Unit, contratos, E2E, resiliencia, hardening
```

## Inicio Rápido

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

## Control de Calidad

```bash
corepack pnpm install
corepack pnpm lint
corepack pnpm test
corepack pnpm security:deps
```

## Licencia

[MIT](LICENSE)

---

<p align="center">
  <i>Nombrado en honor a <b>Giovanni Falcone</b> (1939–1992), el magistrado italiano que dio su vida luchando por la justicia.</i>
</p>
