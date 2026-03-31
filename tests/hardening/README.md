# Hardening Tests

## Descripción

Esta suite valida el hardening de seguridad transversal implementado en T01–T05: ciclo de vida de secretos, enforcement de scopes, restricciones por plan, separación de dominios de privilegio, privilegios de funciones y aislamiento multi-tenant.

## Variables de entorno

| Variable | Descripción | Requerida | Default |
| --- | --- | --- | --- |
| `APISIX_BASE_URL` | URL base del API gateway | Sí | — |
| `SUPERADMIN_TOKEN` | Token de superadmin para provisionar fixtures | Sí | — |
| `DATABASE_URL` | PostgreSQL para verificar auditoría | Sí para verificación PG | — |
| `KAFKA_BROKERS` | Brokers Kafka para eventos de auditoría | Sí para verificación Kafka | — |
| `VAULT_ADDR` | Dirección de Vault | Opcional | — |
| `VAULT_TOKEN` | Token de Vault | Opcional | — |
| `SCOPE_ENFORCEMENT_ENABLED` | Flag de enforcement de scopes | Opcional | `true` |
| `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED` | Flag de enforcement de dominios | Opcional | `true` |
| `PLAN_CACHE_BYPASS_HEADER` | Header para forzar bypass de caché de plan | Opcional | — |
| `HARDENING_AUDIT_TIMEOUT_MS` | Timeout de espera de eventos | Opcional | `5000` |
| `HARDENING_AUDIT_POLL_INTERVAL_MS` | Polling de eventos PG | Opcional | `200` |
| `HARDENING_HTTP_TIMEOUT_MS` | Timeout HTTP | Opcional | `10000` |
| `HARDENING_REPORT_DIR` | Directorio de salida del JSON | Opcional | `tests/hardening/reports` |
| `HARDENING_DEBUG` | Activa logging HTTP | Opcional | `false` |

## Ejecución local

```bash
pnpm install
APISIX_BASE_URL=https://gateway.example.internal \
SUPERADMIN_TOKEN=token \
DATABASE_URL=postgres://user:pass@db:5432/app \
KAFKA_BROKERS=kafka-1:9092,kafka-2:9092 \
node tests/hardening/run.mjs
```

## Ejecución en CI/CD

```yaml
- name: Run hardening tests
  run: node tests/hardening/run.mjs
  env:
    APISIX_BASE_URL: ${{ secrets.APISIX_BASE_URL }}
    SUPERADMIN_TOKEN: ${{ secrets.SUPERADMIN_TOKEN }}
    DATABASE_URL: ${{ secrets.HARDENING_DATABASE_URL }}
    KAFKA_BROKERS: ${{ secrets.KAFKA_BROKERS }}
    VAULT_ADDR: ${{ secrets.VAULT_ADDR }}
    VAULT_TOKEN: ${{ secrets.VAULT_TOKEN }}
```

## Categorías de tests

| Suite | Severidad | IDs | Dependencia |
| --- | --- | --- | --- |
| `secret-lifecycle` | P1 | `SL-01..SL-06` | T01, T02 |
| `scope-enforcement` | P1 | `SE-01..SE-06` | T03 |
| `plan-restriction` | P1 | `PR-01..PR-04` | T03 |
| `privilege-domain` | P2 | `PD-01..PD-03` | T04 |
| `function-privilege` | P2 | `FP-01..FP-03` | T05 |
| `tenant-isolation` | P2 | `TI-01..TI-03` | T01–T05 |

## Interpretar el reporte

- `✅`: caso superado.
- `❌`: caso fallido.
- `⏭`: caso omitido por enforcement deshabilitado o infraestructura no disponible.
- Exit code `1`: existe al menos un fallo P1.
- Exit code `0`: no hay fallos P1.
- El JSON se escribe en `tests/hardening/reports/hardening-<runId>.json`.

## Enforcement modes

Si `SCOPE_ENFORCEMENT_ENABLED=false`, la suite de scopes se marca como `skip`. Si `PRIVILEGE_DOMAIN_ENFORCEMENT_ENABLED=false`, las suites de privilegios se marcan como `skip`. Si Vault/Kafka/Postgres no están disponibles, las verificaciones dependientes degradan a `skip` o a `not found` sin romper el proceso por excepción de infraestructura.

## Concurrencia

Cada ejecución genera un `runId` único y etiqueta sus fixtures con `hardening-run-<runId>`. Eso aísla tenants, workspaces, API keys y rutas de secretos entre pipelines concurrentes.
