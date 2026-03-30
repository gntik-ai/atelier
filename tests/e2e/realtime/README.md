# Realtime E2E Test Suite

Traceability: EP-17 / US-DX-01 / US-DX-01-T06.

## Prerequisites

- Plataforma desplegada y accesible por APISIX.
- Keycloak operativo con acceso de administración.
- CDC bridges de PostgreSQL y MongoDB activos.
- Kafka accesible para la validación de auditoría.

## Variables de entorno

- `REALTIME_ENDPOINT`: endpoint WebSocket/SSE realtime.
- `API_BASE_URL`: base REST pública.
- `PROVISIONING_API_BASE_URL`: base API de aprovisionamiento.
- `PROVISIONING_ADMIN_TOKEN`: token administrativo para aprovisionamiento.
- `KEYCLOAK_BASE_URL`: URL base de Keycloak.
- `KEYCLOAK_REALM`: realm a utilizar.
- `KEYCLOAK_ADMIN_CLIENT_ID`: client id administrativo.
- `KEYCLOAK_ADMIN_SECRET`: secreto del cliente administrativo.
- `WS_PG_CONN_STR`: DSN PostgreSQL de pruebas.
- `WS_MONGO_CONN_STR`: URI MongoDB de pruebas.
- `KAFKA_BROKERS`: lista de brokers separada por comas.
- `KAFKA_CLIENT_ID`: client id Kafka, por defecto `realtime-e2e-test`.
- `SUBSCRIPTION_HAPPY_PATH_TIMEOUT_MS`: timeout happy path, por defecto `10000`.
- `SCOPE_REVOCATION_TIMEOUT_MS`: timeout revocación de scopes, por defecto `30000`.
- `RECONNECTION_WINDOW_SECONDS`: ventana de reconexión, por defecto `60`.
- `TOKEN_SHORT_TTL_SECONDS`: TTL corto para tokens de prueba, por defecto `5`.
- `REPLAY_BUFFER_LIMIT`: límite de replay buffer, por defecto `500`.
- `SIMULATE_KAFKA_UNAVAILABLE`: habilita el caso degradado si vale `true`.
- `TEST_CONCURRENCY`: concurrencia deseada de la suite.

## Ejecución local

```bash
pnpm test:e2e:realtime
```

## Unit tests de helpers

```bash
pnpm test:unit:realtime
```

## JUnit XML para CI

```bash
node --test --test-reporter=junit --test-reporter-destination=realtime-e2e-results.xml tests/e2e/realtime/**/*.test.mjs
```

## Runtime esperado

La suite está diseñada para completar en ≤ 10 minutos en CI estable.

## Ajuste de timings

Los timeouts principales se ajustan mediante `SUBSCRIPTION_HAPPY_PATH_TIMEOUT_MS`, `SCOPE_REVOCATION_TIMEOUT_MS`, `RECONNECTION_WINDOW_SECONDS`, `TOKEN_SHORT_TTL_SECONDS` y `REPLAY_BUFFER_LIMIT`.

## Garantías de teardown

Cada test intenta limpiar sesión, workspace, tenant, usuarios y conexiones. Si hay fugas, revisar primero el log del helper `teardown` y los recursos registrados en la API de aprovisionamiento.
