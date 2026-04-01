# Data Model — US-BKP-02-T04: Validaciones previas para detectar conflictos

**Branch**: `118-export-conflict-prechecks` | **Date**: 2026-04-01
**Task ID**: US-BKP-02-T04 | **Stage**: `speckit.plan`

---

## 1. Tabla PostgreSQL: `config_preflight_audit_log`

Registra cada invocación de la validación previa para auditoría y trazabilidad. No almacena el artefacto completo ni los valores de los conflictos (solo conteos y resumen).

```sql
CREATE TABLE IF NOT EXISTS config_preflight_audit_log (
  id                              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                       TEXT        NOT NULL,
  source_tenant_id                TEXT        NOT NULL,
  actor_id                        TEXT        NOT NULL,
  actor_type                      TEXT        NOT NULL CHECK (actor_type IN ('superadmin', 'sre', 'service_account')),
  domains_requested               TEXT[]      NOT NULL DEFAULT '{}',
  domains_analyzed                TEXT[]      NOT NULL DEFAULT '{}',
  domains_skipped                 TEXT[]      NOT NULL DEFAULT '{}',
  identifier_map_provided         BOOLEAN     NOT NULL DEFAULT FALSE,
  identifier_map_hash             TEXT,
  artifact_checksum               TEXT,
  format_version                  TEXT        NOT NULL,
  risk_level                      TEXT        CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  conflict_count_low              INT         NOT NULL DEFAULT 0,
  conflict_count_medium           INT         NOT NULL DEFAULT 0,
  conflict_count_high             INT         NOT NULL DEFAULT 0,
  conflict_count_critical         INT         NOT NULL DEFAULT 0,
  compatible_count                INT         NOT NULL DEFAULT 0,
  compatible_with_redacted_count  INT         NOT NULL DEFAULT 0,
  total_resources_analyzed        INT         NOT NULL DEFAULT 0,
  incomplete_analysis             BOOLEAN     NOT NULL DEFAULT FALSE,
  needs_confirmation              BOOLEAN     NOT NULL DEFAULT FALSE,
  correlation_id                  TEXT        NOT NULL,
  executed_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_ms                     INT
);

CREATE INDEX IF NOT EXISTS idx_preflight_audit_tenant
  ON config_preflight_audit_log(tenant_id, executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_preflight_audit_source_tenant
  ON config_preflight_audit_log(source_tenant_id, executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_preflight_audit_correlation
  ON config_preflight_audit_log(correlation_id);

CREATE INDEX IF NOT EXISTS idx_preflight_audit_actor
  ON config_preflight_audit_log(actor_id, executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_preflight_audit_risk
  ON config_preflight_audit_log(risk_level, executed_at DESC);
```

**Notas de diseño**:
- No hay tabla de locks: la validación previa es read-only y no requiere exclusividad de concurrencia.
- Los conteos de conflictos por severidad (`conflict_count_*`) son desnormalizados en la tabla de auditoría para permitir queries de reporting sin joins.
- `needs_confirmation: true` se registra cuando el tenant difiere y no se proporcionó mapa, para detectar invocaciones incompletas en el log de auditoría.
- `duration_ms` es opcional; registra el tiempo total de ejecución del análisis para detectar degradaciones de rendimiento.

---

## 2. Esquema JSON del informe de validación previa (PreflightReport)

El endpoint devuelve el siguiente objeto. Es el contrato principal de la API.

```json
{
  "correlation_id": "uuid-v4",
  "source_tenant_id": "tenant-abc",
  "target_tenant_id": "tenant-xyz",
  "format_version": "1.2.0",
  "analyzed_at": "2026-04-01T17:00:00.000Z",
  "summary": {
    "risk_level": "high",
    "total_resources_analyzed": 42,
    "compatible": 35,
    "compatible_with_redacted_fields": 2,
    "conflict_counts": {
      "low": 1,
      "medium": 2,
      "high": 2,
      "critical": 0
    },
    "incomplete_analysis": false,
    "domains_analyzed": ["iam", "postgres_metadata", "kafka", "storage"],
    "domains_skipped": ["mongo_metadata", "functions"]
  },
  "domains": [
    {
      "domain_key": "iam",
      "status": "analyzed",
      "resources_analyzed": 12,
      "compatible_count": 10,
      "compatible_with_redacted_count": 0,
      "conflicts": [
        {
          "resource_type": "role",
          "resource_name": "editor",
          "resource_id": null,
          "severity": "medium",
          "diff": {
            "composites": {
              "artifact": ["read:items", "write:items"],
              "destination": ["read:items"]
            }
          },
          "recommendation": "El rol «editor» tiene permisos o composites diferentes. Verificar si la diferencia es intencional. Si el artefacto debe prevalecer, actualizar el rol manualmente antes de reaprovisionar."
        }
      ],
      "analysis_error_message": null
    },
    {
      "domain_key": "mongo_metadata",
      "status": "skipped_not_exportable",
      "resources_analyzed": 0,
      "compatible_count": 0,
      "compatible_with_redacted_count": 0,
      "conflicts": [],
      "analysis_error_message": null
    }
  ]
}
```

**Caso `needs_confirmation`** (tenant difiere, sin mapa):

```json
{
  "needs_confirmation": true,
  "identifier_map_proposal": {
    "source_tenant_id": "tenant-abc",
    "target_tenant_id": "tenant-xyz",
    "entries": [
      { "scope": "iam.realm", "from": "staging-abc", "to": "prod-xyz" },
      { "scope": "postgres.schema", "from": "stg_abc", "to": "prod_xyz" }
    ],
    "warnings": []
  },
  "correlation_id": "uuid-v4"
}
```

---

## 3. Esquema JSON del evento Kafka de auditoría

Topic: `console.config.reprovision.preflight`

```json
{
  "event_id": "uuid-v4",
  "event_type": "config.preflight.executed",
  "emitted_at": "2026-04-01T17:00:00.000Z",
  "correlation_id": "uuid-v4",
  "actor": {
    "id": "actor-id",
    "type": "superadmin"
  },
  "tenant": {
    "target_id": "tenant-xyz",
    "source_id": "tenant-abc"
  },
  "artifact": {
    "format_version": "1.2.0",
    "checksum": "sha256:abc..."
  },
  "analysis": {
    "risk_level": "high",
    "incomplete_analysis": false,
    "needs_confirmation": false,
    "domains_analyzed": ["iam", "postgres_metadata"],
    "domains_skipped": ["mongo_metadata"],
    "conflict_counts": { "low": 0, "medium": 1, "high": 1, "critical": 0 },
    "total_resources_analyzed": 20,
    "duration_ms": 4200
  }
}
```

**`actor.type` permitidos**: `superadmin`, `sre`, `service_account`.
**Campos obligatorios**: `event_id`, `event_type`, `emitted_at`, `correlation_id`, `actor.id`, `actor.type`, `tenant.target_id`, `tenant.source_id`, `artifact.format_version`, `analysis.risk_level`.

---

## 4. Tipos de datos del módulo `preflight/`

### 4.1 `ConflictEntry`

```ts
interface ConflictEntry {
  resource_type: string;          // 'role', 'table', 'topic', etc.
  resource_name: string;          // nombre del recurso
  resource_id: string | null;     // ID interno si es relevante
  severity: 'low' | 'medium' | 'high' | 'critical';
  diff: Record<string, {
    artifact: unknown;            // valor del artefacto (nunca un valor redactado)
    destination: unknown;         // valor actual en el tenant destino
  }> | null;
  recommendation: string;         // texto específico al tipo de recurso y severidad
}
```

### 4.2 `DomainAnalysisResult`

```ts
interface DomainAnalysisResult {
  domain_key: string;             // 'iam', 'postgres_metadata', etc.
  status: 'analyzed' | 'no_conflicts' | 'skipped_not_exportable' | 'analysis_error';
  resources_analyzed: number;
  compatible_count: number;
  compatible_with_redacted_count: number;
  conflicts: ConflictEntry[];
  analysis_error_message: string | null;
}
```

### 4.3 `PreflightSummary`

```ts
interface PreflightSummary {
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  total_resources_analyzed: number;
  compatible: number;
  compatible_with_redacted_fields: number;
  conflict_counts: { low: number; medium: number; high: number; critical: number };
  incomplete_analysis: boolean;
  domains_analyzed: string[];
  domains_skipped: string[];
}
```

### 4.4 `PreflightReport`

```ts
interface PreflightReport {
  correlation_id: string;
  source_tenant_id: string;
  target_tenant_id: string;
  format_version: string;
  analyzed_at: string;            // ISO 8601
  summary: PreflightSummary;
  domains: DomainAnalysisResult[];
  needs_confirmation?: boolean;   // presente solo cuando true
  identifier_map_proposal?: IdentifierMap | null; // presente solo cuando needs_confirmation=true
}
```

---

## 5. Variables de entorno

| Variable | Descripción | Default |
|---|---|---|
| `CONFIG_PREFLIGHT_SUPPORTED_FORMAT_MAJOR` | Major version del artefacto que acepta el servidor | `'1'` |
| `CONFIG_PREFLIGHT_ANALYZER_TIMEOUT_MS` | Timeout por analizador (ms) | `10000` |
| `CONFIG_PREFLIGHT_OW_ENABLED` | Habilita analizador de funciones OpenWhisk | `'false'` |
| `CONFIG_PREFLIGHT_MONGO_ENABLED` | Habilita analizador de MongoDB | `'false'` |
| `CONFIG_PREFLIGHT_KAFKA_TOPIC` | Topic Kafka para eventos de auditoría de preflight | `'console.config.reprovision.preflight'` |
| `CONFIG_EXPORT_KEYCLOAK_URL` | URL base Keycloak admin (lectura) | — |
| `CONFIG_EXPORT_KEYCLOAK_ADMIN_CLIENT_ID` | Client ID de servicio Keycloak (lectura) | — |
| `CONFIG_EXPORT_KEYCLOAK_ADMIN_SECRET` | Secret del client Keycloak (lectura) | — |
| `CONFIG_EXPORT_PG_CONNECTION_STRING` | Connection string PostgreSQL (lectura) | — |
| `CONFIG_EXPORT_MONGO_URI` | URI MongoDB (lectura) | — |
| `CONFIG_EXPORT_KAFKA_BROKERS` | Brokers Kafka (lectura) | — |
| `CONFIG_EXPORT_KAFKA_SASL_USERNAME` | SASL username Kafka | — |
| `CONFIG_EXPORT_KAFKA_SASL_PASSWORD` | SASL password Kafka | — |
| `CONFIG_EXPORT_OW_API_HOST` | API host OpenWhisk (lectura) | — |
| `CONFIG_EXPORT_OW_API_KEY` | API key OpenWhisk (lectura) | — |
| `CONFIG_EXPORT_S3_ENDPOINT` | Endpoint S3-compatible (lectura) | — |
| `CONFIG_EXPORT_S3_ACCESS_KEY` | Access key S3 | — |
| `CONFIG_EXPORT_S3_SECRET_KEY` | Secret key S3 | — |

> **Nota**: Se reutilizan las credenciales `CONFIG_EXPORT_*` de T01 porque los analizadores de T04 solo necesitan acceso de lectura, el mismo que los recolectores de exportación. No se requieren nuevas credenciales de servicio.
