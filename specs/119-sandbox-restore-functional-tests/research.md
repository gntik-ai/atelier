# Research — US-BKP-02-T05: Pruebas de restauración funcional parcial y total en entornos sandbox

**Branch**: `119-sandbox-restore-functional-tests` | **Date**: 2026-04-01
**Task ID**: US-BKP-02-T05 | **Stage**: `speckit.plan`

---

## 1. Pregunta de investigación principal

¿Cómo diseñar un conjunto de pruebas E2E reproducibles y autocontenidas que validen la cadena completa export → preflight → reprovision sin acceso directo a bases de datos internas, reutilizando los patrones ya establecidos en el proyecto y maximizando la cobertura de escenarios de DR?

---

## 2. Reutilización de patrones del proyecto

### 2.1 Patrón de suite E2E existente (`tests/e2e/`)

El proyecto ya tiene suites E2E bajo `tests/e2e/workflows/` (por ejemplo, `tests/e2e/workflows/tenant-config-preflight.test.mjs` de T04). La suite de T05 sigue exactamente el mismo patrón:
- Módulos independientes por escenario.
- `undici` como cliente HTTP.
- `node:test` como runner.
- No se usan frameworks de testing externos (Mocha, Jest, etc.).

### 2.2 Credenciales de prueba

Las pruebas reutilizan el patrón de autenticación JWT ya establecido: un `service_account` con scopes `platform:admin:config:export` y `platform:admin:config:reprovision` inyectado vía `RESTORE_TEST_AUTH_TOKEN`. No se requieren credenciales adicionales.

### 2.3 Patrón de fixture con `execution_id`

Los tests de T04 y T03 ya usan UUIDs por ejecución para evitar colisiones entre runs concurrentes. El mismo patrón se aplica a T05 con nombres de tenant `test-restore-{executionId}-src` / `test-restore-{executionId}-dst`.

---

## 3. Decisiones de diseño clave

### 3.1 Verificación de equivalencia: API-only vs. acceso directo a subsistemas

- **Decision**: Verificar equivalencia exportando el tenant destino vía la API de T01 y comparando contra el artefacto de origen, sin acceso directo a Keycloak, PostgreSQL, Kafka, etc.
- **Rationale**: La spec exige que las verificaciones se hagan a través de las APIs del producto (RN-T05-003 / RF-T05-007). Además, acceder directamente a los subsistemas acoplaría la suite a la topología interna de cada entorno sandbox, dificultando la portabilidad. La API de exportación ya implementa la lectura de todos los dominios de forma normalizada.
- **Alternatives considered**: Queries directas a PostgreSQL/Keycloak/Kafka; rechazadas por acoplamiento y por violar el principio de testing-via-contract.

### 3.2 Simulación de fallos parciales (EC1): inyección de datos inválidos vs. caída de subsistema

- **Decision**: Simular fallos parciales inyectando datos inválidos en el artefacto (por ejemplo, `numPartitions: -1` en un topic Kafka) en lugar de desactivar subsistemas temporalmente.
- **Rationale**: Desactivar un subsistema en el sandbox es arriesgado (puede afectar otras pruebas o procesos), requiere permisos de infraestructura, y no es reproducible de forma determinista. La inyección de datos inválidos es determinista, aislada al escenario, y no requiere permisos de infra.
- **Alternatives considered**: Deshabilitar temporalmente el contenedor Kafka; rechazado por riesgo de impacto lateral y no-determinismo. Usar un dominio opcional deshabilitado como proxy de "fallo"; válido como alternativa simple si la inyección no está disponible en todos los entornos.

### 3.3 Escenario de concurrencia (EC3): timing

- **Decision**: Usar un artefacto de mayor tamaño combinado con un primer request disparado sin await, seguido de un segundo request inmediato, para garantizar overlap del lock de T03.
- **Rationale**: Un artefacto pequeño completaría el reaprovisionamiento antes de que llegue el segundo request, haciendo el test flaky. Un artefacto con datos sustanciales extiende la duración del primero, garantizando que el lock de T03 esté activo.
- **Alternatives considered**: Delay artificial con `setTimeout` antes del segundo request; viable pero frágil a variaciones de latencia del entorno. Mocking del endpoint de T03 con un sleep; rechazado porque queremos probar el lock real, no un mock.

### 3.4 Formato del informe de resultados: JSON estructurado vs. TAP/JUnit

- **Decision**: Informe JSON propio siguiendo el schema `restore-test-report.json`, con un resumen human-readable también en stdout.
- **Rationale**: El proyecto ya usa JSON estructurado para informes de auditoría. Un formato propio permite incluir campos específicos del dominio (dominio fallido, recurso, campo, valor esperado/obtenido) que no caben en TAP o JUnit sin extensiones. `node:test` también produce salida TAP compatible con CI nativo; ambos formatos coexisten.
- **Alternatives considered**: Sólo TAP/JUnit; rechazado porque no permite el nivel de detalle por dominio que requiere CA-07.

### 3.5 Cleanup robusto: cleanup-on-fail obligatorio

- **Decision**: El cleanup de tenants de prueba se ejecuta siempre, incluso si el escenario falla, mediante el patrón `try { ... } finally { await cleanup() }`.
- **Rationale**: La spec (RN-02 / CA-06) exige que las pruebas no dejen recursos residuales. Un cleanup condicional (solo en éxito) dejaría tenants huérfanos en fallos frecuentes durante el desarrollo.
- **Alternatives considered**: Cleanup manual post-ejecución; rechazado por riesgo de acumulación de residuos. Teardown centralizado al final de toda la suite; rechazado porque un fallo catastrófico del runner dejaría todos los tenants sin limpiar.

### 3.6 Adaptación dinámica a dominios disponibles

- **Decision**: Al inicio de la ejecución, la suite consulta el endpoint de dominios exportables de T01 (`GET /v1/admin/tenants/{src}/config/export/domains`) para determinar qué dominios están habilitados en el sandbox actual, y ajusta las expectativas de equivalencia de forma dinámica.
- **Rationale**: El riesgo R-01 (dominios opcionales deshabilitados) es de alta probabilidad. Forzar fallo en escenarios donde un dominio está deshabilitado por configuración del sandbox introduciría falsos negativos constantes. El ajuste dinámico hace las pruebas portables entre sandboxes con distintos perfiles de despliegue.
- **Alternatives considered**: Configuración estática de dominios activos vía env var `RESTORE_TEST_DOMAINS_ENABLED`; válida como fallback, pero menos precisa que consultar la API real.

---

## 4. Mapeo de escenarios a criterios de aceptación

| Escenario | Criterio de Aceptación (spec) |
|---|---|
| E1 — Restauración total sobre tenant vacío | CA-01 |
| E2 — Restauración parcial (2 combinaciones de dominios) | CA-02 |
| E3 — Restauración sobre tenant con conflictos | CA-03 |
| E4 — Restauración con artefacto degradado | CA-04 |
| E5 — Restauración con migración de formato | (implícito, cobertura de T02) |
| EC1 — Fallo parcial y reintento | CA-05 |
| EC2 — Tenant de origen inexistente | (cobertura de mapa de identificadores T03) |
| EC3 — Restauración concurrente bloqueada | (cobertura de lock T03) |
| EC4 — Artefacto de tamaño máximo | (cobertura de límites T01) |
| EC5 — Tenant suspendido rechazado | (cobertura de validación de estado T03) |
| Todos | CA-06 (pruebas autocontenidas) + CA-07 (informe estructurado) |

---

## 5. Gaps y riesgos identificados

- **R-01 (dominios opcionales)**: Alta probabilidad. Mitigado por adaptación dinámica (sección 3.6).
- **R-02 (simulación de fallos)**: La inyección de datos inválidos cubre la mayoría de los casos, pero el escenario de retry selectivo (solo un dominio) requiere que T03 soporte re-ejecución parcial por dominio. Si T03 no expone ese endpoint, EC1 debe adaptarse para usar un artefacto de solo ese dominio desde el inicio.
- **R-05 (flakiness de EC3)**: Mitigado por uso de artefacto de mayor tamaño. Si sigue siendo flaky, añadir retry en EC3 con marcado explícito de "flaky by design" en el reporte.
- **Dependencia de T02 para E5**: Si no existe migración de formato disponible en T02, E5 se marca SKIP dinámicamente. El test verifica la existencia de migraciones antes de ejecutar.
