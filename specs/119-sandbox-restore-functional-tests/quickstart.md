# Quickstart — US-BKP-02-T05: Pruebas de restauración funcional en sandbox

**Branch**: `119-sandbox-restore-functional-tests` | **Date**: 2026-04-01

---

## Prerrequisitos

1. Las acciones OpenWhisk de T01 (`tenant-config-export`), T02 (`tenant-config-validate`, `tenant-config-migrate`), T03 (`tenant-config-reprovision`) y T04 (`tenant-config-preflight`) deben estar desplegadas y accesibles vía APISIX en el entorno sandbox.
2. Un JWT de `service_account` con scopes `platform:admin:config:export` y `platform:admin:config:reprovision` (y `platform:admin:config:validate` para T02).
3. El entorno sandbox debe permitir crear y destruir tenants de prueba (sin cuota que lo impida).
4. Node.js 20+, `pnpm` instalado.

---

## Configuración de variables de entorno

```bash
# URL base del gateway APISIX del sandbox
export RESTORE_TEST_API_BASE_URL=http://sandbox-apisix:9080

# JWT de service_account con scopes necesarios
export RESTORE_TEST_AUTH_TOKEN=eyJhbGciOiJSUzI1NiIsInR5...

# Dominios habilitados en el sandbox (ajustar según perfil de despliegue)
export RESTORE_TEST_DOMAINS_ENABLED=iam,postgres_metadata,kafka,storage

# Opcionales: habilitar dominios opcionales si están disponibles
export RESTORE_TEST_OW_ENABLED=false
export RESTORE_TEST_MONGO_ENABLED=false

# Ruta de salida del informe de resultados
export RESTORE_TEST_REPORT_OUTPUT=./restore-test-report.json
```

---

## Ejecución

### Ejecutar el catálogo completo

```bash
pnpm test:e2e:restore
```

### Ejecutar un escenario específico

```bash
node --test tests/e2e/workflows/restore/e1-full-restore-empty-tenant.test.mjs
```

### Ejecutar con paralelismo habilitado

```bash
RESTORE_TEST_PARALLELISM=true pnpm test:e2e:restore
```

---

## Revisar el informe de resultados

El informe JSON se escribe en `$RESTORE_TEST_REPORT_OUTPUT`. Ejemplo de resumen en stdout:

```text
✅ E1 — Restauración total sobre tenant vacío (golden path): PASS (84320 ms)
✅ E2a — Restauración parcial IAM + PostgreSQL: PASS (42100 ms)
✅ E2b — Restauración parcial Kafka + Storage: PASS (38900 ms)
✅ E3 — Restauración con conflictos preexistentes: PASS (51200 ms)
✅ E4 — Restauración con artefacto degradado: PASS (29800 ms)
⏭️  E5 — Restauración con migración de formato: SKIP (sin migraciones disponibles)
✅ EC1 — Fallo parcial y reintento: PASS (67300 ms)
✅ EC2 — Tenant de origen inexistente: PASS (55100 ms)
✅ EC3 — Restauración concurrente bloqueada: PASS (34500 ms)
✅ EC4 — Artefacto de tamaño máximo: PASS (88700 ms)
✅ EC5 — Tenant suspendido rechazado: PASS (12300 ms)

Total: 10 | Passed: 9 | Failed: 0 | Skipped: 1
Informe escrito en: ./restore-test-report.json
```

---

## Limpieza manual (si un test deja residuos)

En caso de fallo catastrófico del runner, los tenants de prueba pueden identificarse por el prefijo `test-restore-` y eliminarse manualmente:

```bash
# Listar tenants de prueba residuales
GET /v1/admin/tenants?name_prefix=test-restore- \
  -H "Authorization: Bearer $RESTORE_TEST_AUTH_TOKEN"

# Eliminar un tenant de prueba específico
DELETE /v1/admin/tenants/{tenant_id} \
  -H "Authorization: Bearer $RESTORE_TEST_AUTH_TOKEN"
```

---

## Integración CI

```yaml
# Ejemplo de job CI (GitHub Actions / GitLab CI)
test:e2e:restore:
  stage: integration
  environment: sandbox
  script:
    - pnpm install --frozen-lockfile
    - pnpm test:e2e:restore
  artifacts:
    paths:
      - restore-test-report.json
  variables:
    RESTORE_TEST_API_BASE_URL: $SANDBOX_APISIX_URL
    RESTORE_TEST_AUTH_TOKEN: $SANDBOX_SERVICE_ACCOUNT_TOKEN
    RESTORE_TEST_DOMAINS_ENABLED: "iam,postgres_metadata,kafka,storage"
```
