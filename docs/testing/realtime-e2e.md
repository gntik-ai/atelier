# Realtime E2E Testing Guide

Fecha: 2026-03-30  
Traceability: EP-17 / US-DX-01 / US-DX-01-T06

## Alcance

Esta suite valida el pipeline realtime end-to-end mediante interfaces públicas HTTP/WebSocket/SSE, incluyendo suscripción, reconexión, aislamiento tenant/workspace, revocación de scopes y edge cases operativos.

## Prerrequisitos CI/CD

- Acceso de red a APISIX, provisioning API, Keycloak y Kafka.
- Credenciales de servicio para aprovisionamiento y administración de Keycloak.
- Bases de datos de prueba accesibles para inyección CDC.
- Entorno suficientemente estable para ventanas de propagación CDC.

## Variables de entorno

| Variable | Descripción |
|---|---|
| `REALTIME_ENDPOINT` | Endpoint realtime WebSocket/SSE |
| `API_BASE_URL` | URL base REST pública |
| `PROVISIONING_API_BASE_URL` | URL base de aprovisionamiento |
| `PROVISIONING_ADMIN_TOKEN` | Token admin de aprovisionamiento |
| `KEYCLOAK_BASE_URL` | URL base de Keycloak |
| `KEYCLOAK_REALM` | Realm de pruebas |
| `KEYCLOAK_ADMIN_CLIENT_ID` | Client ID administrativo |
| `KEYCLOAK_ADMIN_SECRET` | Secreto del cliente administrativo |
| `WS_PG_CONN_STR` | Cadena de conexión PostgreSQL |
| `WS_MONGO_CONN_STR` | URI MongoDB |
| `KAFKA_BROKERS` | Brokers Kafka separados por comas |
| `KAFKA_CLIENT_ID` | Client ID Kafka |
| `SUBSCRIPTION_HAPPY_PATH_TIMEOUT_MS` | Timeout delivery happy path |
| `SCOPE_REVOCATION_TIMEOUT_MS` | Timeout revocación scopes |
| `RECONNECTION_WINDOW_SECONDS` | Ventana de reconexión |
| `TOKEN_SHORT_TTL_SECONDS` | TTL corto para pruebas de expiración |
| `REPLAY_BUFFER_LIMIT` | Límite de replay buffer |
| `SIMULATE_KAFKA_UNAVAILABLE` | Habilita el test de degradación |

## Parámetros de timing

- `SUBSCRIPTION_HAPPY_PATH_TIMEOUT_MS`: por defecto `10000`
- `SCOPE_REVOCATION_TIMEOUT_MS`: por defecto `30000`
- `RECONNECTION_WINDOW_SECONDS`: por defecto `60`
- `TOKEN_SHORT_TTL_SECONDS`: por defecto `5`
- `REPLAY_BUFFER_LIMIT`: por defecto `500`

## Integración CI/CD

### GitHub Actions

```yaml
- name: Realtime E2E
  run: pnpm test:e2e:realtime
  env:
    REALTIME_ENDPOINT: ${{ secrets.REALTIME_ENDPOINT }}
    PROVISIONING_API_BASE_URL: ${{ secrets.PROVISIONING_API_BASE_URL }}
    PROVISIONING_ADMIN_TOKEN: ${{ secrets.PROVISIONING_ADMIN_TOKEN }}
    KEYCLOAK_BASE_URL: ${{ secrets.KEYCLOAK_BASE_URL }}
    KEYCLOAK_REALM: falcone
    KEYCLOAK_ADMIN_CLIENT_ID: ${{ secrets.KEYCLOAK_ADMIN_CLIENT_ID }}
    KEYCLOAK_ADMIN_SECRET: ${{ secrets.KEYCLOAK_ADMIN_SECRET }}
    WS_PG_CONN_STR: ${{ secrets.WS_PG_CONN_STR }}
    WS_MONGO_CONN_STR: ${{ secrets.WS_MONGO_CONN_STR }}
    KAFKA_BROKERS: ${{ secrets.KAFKA_BROKERS }}
```

### GitLab CI

```yaml
realtime_e2e:
  script:
    - pnpm test:e2e:realtime
```

## Mapeo de criterios de éxito

- SC-001/FR coverage: cubierto por los suites bajo `tests/e2e/realtime/`.
- SC-002: objetivo ≤ 10 min.
- SC-003: estabilidad basada en retries acotados con backoff.
- SC-004: `tenant-isolation.test.mjs`.
- SC-005: `workspace-isolation.test.mjs`.
- SC-006: `reconnection.test.mjs`.
- SC-007: `scope-revocation.test.mjs`.
- SC-008: salida TAP/JUnit nativa de `node:test`.

## Limitaciones conocidas

- La latencia CDC puede introducir variabilidad temporal.
- El escenario de degradación requiere `SIMULATE_KAFKA_UNAVAILABLE=true` y soporte del entorno.
- La auditoría Kafka depende de topic y ACLs accesibles desde el runner.
