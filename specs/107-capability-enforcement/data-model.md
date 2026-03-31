# Data Model — US-PLAN-02-T05: Capability Enforcement

## Entidades existentes consumidas (solo lectura)

### `plans` (PostgreSQL)

| Columna | Tipo | Uso en T05 |
|---|---|---|
| `id` | `VARCHAR` `pln_*` | Lookup de plan del tenant |
| `slug` | `VARCHAR` | Incluido en response de capabilities |
| `capabilities` | `JSONB` | Mapa `{ capabilityKey: boolean }` del plan base |
| `status` | `VARCHAR` | Solo planes `active` se resuelven |

### `plan_assignments` (PostgreSQL)

| Columna | Tipo | Uso en T05 |
|---|---|---|
| `tenant_id` | `VARCHAR` `ten_*` | Identificar plan activo del tenant |
| `plan_id` | `VARCHAR` `pln_*` | FK al plan asignado |
| `effective_from` | `TIMESTAMPTZ` | Determinar plan vigente |
| `superseded_at` | `TIMESTAMPTZ` | NULL = asignación activa |

### `boolean_capability_catalog` (PostgreSQL)

| Columna | Tipo | Uso en T05 |
|---|---|---|
| `capability_key` | `VARCHAR` | Key canónica de la capability |
| `platform_default` | `BOOLEAN` | Fallback si ni plan ni override definen la capability |
| `is_active` | `BOOLEAN` | Solo capabilities activas se evalúan |

### `capability_overrides` (PostgreSQL — de US-PLAN-02-T01/T02)

| Columna | Tipo | Uso en T05 |
|---|---|---|
| `tenant_id` | `VARCHAR` `ten_*` | Tenant afectado |
| `capability_key` | `VARCHAR` | Capability overrideada |
| `enabled` | `BOOLEAN` | `true` = habilitación forzada, `false` = restricción forzada |
| `created_by` | `VARCHAR` | Superadmin que creó el override |
| `effective_from` | `TIMESTAMPTZ` | Desde cuándo aplica |
| `expires_at` | `TIMESTAMPTZ` | NULL = indefinido |

## Modelo de resolución de capabilities efectivas

```text
Para cada capability_key en boolean_capability_catalog (is_active = true):

  1. ¿Existe override activo para (tenant_id, capability_key)?
     → Sí: enabled = override.enabled
     → No: continuar

  2. ¿El plan del tenant define explícitamente esta capability?
     → Sí: enabled = plan.capabilities[capability_key]
     → No: continuar

  3. Fallback: enabled = boolean_capability_catalog.platform_default
```

**Precedencia**: override > plan explícito > catalog platform_default

## Estructura del response de capabilities efectivas

```json
{
  "tenantId": "ten_abc123",
  "planId": "pln_xyz789",
  "resolvedAt": "2026-03-31T20:00:00Z",
  "capabilities": {
    "webhooks": true,
    "realtime": false,
    "sql_admin_api": true,
    "passthrough_admin": false,
    "functions_public": true
  },
  "ttlHint": 120
}
```

## Estructura del evento de auditoría

```json
{
  "eventType": "capability_enforcement_denied",
  "tenantId": "ten_abc123",
  "workspaceId": "wrk_def456",
  "actorId": "usr_ghi789",
  "actorType": "user",
  "capability": "webhooks",
  "reason": "plan_restriction",
  "channel": "gateway",
  "resourcePath": "/v1/workspaces/wrk_def456/webhooks",
  "httpMethod": "POST",
  "requestId": "req_xyz",
  "correlationId": "corr_abc",
  "sourceIp": "10.0.1.42",
  "occurredAt": "2026-03-31T20:00:00Z"
}
```

## Estructura del caché LRU en gateway

```text
Key:   tenant_id (string)
Value: {
  capabilities: { [capabilityKey]: boolean },
  planId: string,
  fetchedAt: unix_timestamp
}
TTL:   CAPABILITY_CACHE_TTL_SECONDS (default 120)
Max:   CAPABILITY_CACHE_MAX_ENTRIES (default 500)
```

## Mapa de rutas a capabilities (capability-gated-routes)

```text
Key:   (http_method, path_pattern)
Value: capability_key (string)

Lookup: O(1) usando tabla hash tras parsing inicial del YAML
```

## Notas sobre migraciones

No se requieren migraciones DDL. Todas las tablas referenciadas ya existen
como resultado de US-PLAN-02-T01 y US-PLAN-02-T02. Esta tarea solo lee datos
existentes y expone un endpoint de resolución + enforcement en gateway y consola.
