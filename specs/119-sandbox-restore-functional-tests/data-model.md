# Data Model — US-BKP-02-T05: Pruebas de restauración funcional parcial y total en entornos sandbox

**Branch**: `119-sandbox-restore-functional-tests` | **Date**: 2026-04-01
**Task ID**: US-BKP-02-T05 | **Stage**: `speckit.plan`

---

## 1. Sin nuevas tablas PostgreSQL

Esta tarea no introduce nuevas tablas de base de datos permanentes. Las pruebas crean tenants de referencia y destino vía las APIs del producto (los cuales generan sus propias tablas de auditoría en el sistema). Los metadatos de ejecución de la suite se mantienen en memoria y se persisten como archivo JSON del informe de resultados.

---

## 2. Schema JSON del informe de resultados

**Contrato**: `specs/119-sandbox-restore-functional-tests/contracts/restore-test-report.json`

El informe de resultados es producido por `report-writer.mjs` al final de cada ejecución del catálogo de pruebas. Cumple con el requisito RF-T05-008.

### 2.1 Schema JSON (v1)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "restore-test-report.json",
  "title": "RestoreTestReport",
  "description": "Informe de resultados del catálogo de pruebas de restauración funcional (US-BKP-02-T05)",
  "type": "object",
  "required": ["report_id", "execution_id", "started_at", "finished_at", "summary", "scenarios"],
  "properties": {
    "report_id": {
      "type": "string",
      "format": "uuid",
      "description": "UUID único del informe"
    },
    "execution_id": {
      "type": "string",
      "description": "UUID de la ejecución, compartido por todos los escenarios de esta ejecución"
    },
    "started_at": {
      "type": "string",
      "format": "date-time"
    },
    "finished_at": {
      "type": "string",
      "format": "date-time"
    },
    "duration_ms": {
      "type": "integer",
      "description": "Duración total de la ejecución en milisegundos"
    },
    "environment": {
      "type": "object",
      "properties": {
        "api_base_url": { "type": "string" },
        "domains_enabled": { "type": "array", "items": { "type": "string" } },
        "ow_enabled": { "type": "boolean" },
        "mongo_enabled": { "type": "boolean" }
      }
    },
    "summary": {
      "type": "object",
      "required": ["total", "passed", "failed", "skipped"],
      "properties": {
        "total": { "type": "integer" },
        "passed": { "type": "integer" },
        "failed": { "type": "integer" },
        "skipped": { "type": "integer" }
      }
    },
    "scenarios": {
      "type": "array",
      "items": {
        "$ref": "#/definitions/ScenarioResult"
      }
    }
  },
  "definitions": {
    "ScenarioResult": {
      "type": "object",
      "required": ["scenario_id", "name", "status", "duration_ms"],
      "properties": {
        "scenario_id": {
          "type": "string",
          "description": "Identificador del escenario, p.ej. 'E1', 'EC3'"
        },
        "name": {
          "type": "string",
          "description": "Nombre descriptivo del escenario"
        },
        "status": {
          "type": "string",
          "enum": ["pass", "fail", "skip"]
        },
        "duration_ms": {
          "type": "integer"
        },
        "skip_reason": {
          "type": "string",
          "description": "Presente solo cuando status='skip'"
        },
        "failure_detail": {
          "$ref": "#/definitions/FailureDetail",
          "description": "Presente solo cuando status='fail'"
        },
        "correlation_id": {
          "type": "string",
          "description": "Correlation ID de la ejecución del escenario"
        },
        "tenants": {
          "type": "object",
          "properties": {
            "src_tenant_id": { "type": "string" },
            "dst_tenant_id": { "type": "string" }
          }
        }
      }
    },
    "FailureDetail": {
      "type": "object",
      "properties": {
        "assertion_type": {
          "type": "string",
          "enum": ["equivalence", "http_status", "conflict_detection", "lock_rejection", "cleanup"],
          "description": "Tipo de aserción que falló"
        },
        "domain": {
          "type": "string",
          "description": "Dominio funcional donde se detectó el fallo (si aplica)"
        },
        "resource_type": {
          "type": "string",
          "description": "Tipo de recurso donde se detectó el fallo (si aplica)"
        },
        "resource_name": {
          "type": "string",
          "description": "Nombre del recurso donde se detectó el fallo (si aplica)"
        },
        "expected": {
          "description": "Valor esperado (serializado; secretos excluidos)"
        },
        "actual": {
          "description": "Valor obtenido (serializado; secretos excluidos)"
        },
        "message": {
          "type": "string",
          "description": "Mensaje de error humano-legible"
        },
        "stack": {
          "type": "string",
          "description": "Stack trace del error (solo en modo debug)"
        }
      }
    }
  }
}
```

### 2.2 Ejemplo de informe de resultados

```json
{
  "report_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "execution_id": "7f3a1b9c-2d4e-4f5a-8b6c-0e1d2f3a4b5c",
  "started_at": "2026-04-01T19:00:00.000Z",
  "finished_at": "2026-04-01T19:12:34.567Z",
  "duration_ms": 754567,
  "environment": {
    "api_base_url": "http://sandbox-apisix:9080",
    "domains_enabled": ["iam", "postgres_metadata", "kafka", "storage"],
    "ow_enabled": false,
    "mongo_enabled": false
  },
  "summary": {
    "total": 10,
    "passed": 8,
    "failed": 1,
    "skipped": 1
  },
  "scenarios": [
    {
      "scenario_id": "E1",
      "name": "Restauración total sobre tenant vacío (golden path)",
      "status": "pass",
      "duration_ms": 84320,
      "correlation_id": "restore-e2e-7f3a1b9c-E1",
      "tenants": {
        "src_tenant_id": "test-restore-7f3a1b9c-src",
        "dst_tenant_id": "test-restore-7f3a1b9c-dst-e1"
      }
    },
    {
      "scenario_id": "E5",
      "name": "Restauración con migración de formato",
      "status": "skip",
      "duration_ms": 12,
      "skip_reason": "No hay migraciones de formato disponibles en el entorno sandbox. Requiere T02 con al menos una migración definida.",
      "correlation_id": "restore-e2e-7f3a1b9c-E5"
    },
    {
      "scenario_id": "EC1",
      "name": "Fallo parcial durante reaprovisionamiento y reintento posterior",
      "status": "fail",
      "duration_ms": 45230,
      "correlation_id": "restore-e2e-7f3a1b9c-EC1",
      "tenants": {
        "src_tenant_id": "test-restore-7f3a1b9c-src-ec1",
        "dst_tenant_id": "test-restore-7f3a1b9c-dst-ec1"
      },
      "failure_detail": {
        "assertion_type": "equivalence",
        "domain": "kafka",
        "resource_type": "topic",
        "resource_name": "events-7f3a1b9c",
        "expected": { "numPartitions": 3 },
        "actual": { "numPartitions": 1 },
        "message": "El topic 'events-7f3a1b9c' no fue restaurado correctamente tras el reintento selectivo: numPartitions difiere."
      }
    }
  ]
}
```

---

## 3. Modelo en memoria: estado de ejecución de la suite

Durante la ejecución, el runner mantiene un estado en memoria (nunca persistido en DB):

```js
/**
 * @typedef {Object} ScenarioContext
 * @property {string} scenarioId - 'E1', 'E2', 'EC3', etc.
 * @property {string} executionId - UUID de la ejecución global
 * @property {string} correlationId - ID trazable para esta ejecución del escenario
 * @property {string} srcTenantId - tenant de referencia creado para este escenario
 * @property {string} dstTenantId - tenant destino creado para este escenario
 * @property {string[]} domainsEnabled - dominios activos en el sandbox
 * @property {() => Promise<void>} cleanup - función de limpieza
 */

/**
 * @typedef {Object} SuiteState
 * @property {string} executionId - UUID compartido por todos los escenarios
 * @property {string} startedAt - ISO 8601
 * @property {ScenarioResult[]} results - acumulado durante la ejecución
 */
```

---

## 4. Modelo de seed por dominio

Cada módulo de seed crea recursos con identificadores deterministas basados en `executionId` para garantizar unicidad y facilitar el cleanup manual si fuera necesario.

### Estructura de recursos de seed (level=standard)

| Dominio | Recursos creados (standard) |
|---|---|
| IAM | 3 roles (`role-a-{id}`, `role-b-{id}`, `role-c-{id}`), 1 grupo (`group-{id}`), 1 client scope (`scope-{id}`) |
| PostgreSQL | 1 esquema (`schema_{id}`), 2 tablas (`tbl_users_{id}`, `tbl_events_{id}`) con columnas e índices definidos |
| Kafka | 2 topics (`events-{id}`, `notifications-{id}`) con configuración explícita, 2 ACLs |
| Storage | 1 bucket (`bucket-{id}`) con política de acceso y configuración de versioning |
| Functions (opcional) | 1 paquete (`pkg-{id}`), 2 acciones (`action-a-{id}`, `action-b-{id}`) |
| MongoDB (opcional) | 1 colección (`col-{id}`) con validador e índices |

### Recursos de seed level=conflicting

El nivel `conflicting` crea recursos con nombres idénticos a `standard` pero con diferencias funcionales:
- IAM: `role-a-{id}` existe en el destino con `composites` diferentes → conflicto `medium`.
- PostgreSQL: `tbl_users_{id}` existe en el destino sin un índice que el artefacto sí tiene → conflicto `medium`.

---

## 5. Variables de entorno y configuración runtime

Ver plan.md sección 5 para la lista completa de variables de entorno de la suite.

No se añaden variables de entorno a las acciones OpenWhisk de T01–T04; la suite consume las APIs del producto con credenciales de `service_account`.
