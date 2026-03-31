# Contrato de errores — Capability Enforcement (US-PLAN-02-T05)

## Error: Capability no habilitada (403)

Cuando el gateway rechaza una solicitud porque la capability requerida
no está habilitada para el tenant, devuelve un `HTTP 403` con el
siguiente cuerpo JSON, coherente con el schema `ErrorResponse` del
OpenAPI del proyecto.

### Schema

```yaml
CapabilityNotEntitledError:
  allOf:
    - $ref: "#/components/schemas/ErrorResponse"
    - type: object
      properties:
        status:
          type: integer
          enum: [403]
        code:
          type: string
          enum: ["GW_CAPABILITY_NOT_ENTITLED"]
        message:
          type: string
          example: "Your current plan does not include this capability."
        detail:
          type: object
          required:
            - capability
            - reason
            - upgradePath
          properties:
            capability:
              type: string
              description: Key de la capability bloqueada
              example: "webhooks"
            reason:
              type: string
              enum:
                - plan_restriction
                - override_restriction
              description: Motivo del bloqueo
            upgradePath:
              type: string
              description: URL o referencia al canal de upgrade
              example: "/plans/upgrade"
            currentPlanId:
              type: string
              pattern: "^pln_[0-9a-z]+$"
              description: ID del plan actual del tenant
        retryable:
          type: boolean
          enum: [false]
```

### Ejemplo

```json
{
  "status": 403,
  "code": "GW_CAPABILITY_NOT_ENTITLED",
  "message": "Your current plan does not include this capability.",
  "detail": {
    "capability": "webhooks",
    "reason": "plan_restriction",
    "upgradePath": "/plans/upgrade",
    "currentPlanId": "pln_abc123"
  },
  "requestId": "req_xyz789",
  "correlationId": "corr_abc456",
  "timestamp": "2026-03-31T20:00:00Z",
  "resource": "/v1/workspaces/wrk_def456/webhooks",
  "retryable": false
}
```

## Error: Resolución degradada (503)

Cuando el gateway no puede resolver las capabilities del tenant
(timeout, error del servicio de resolución, caché vacío) y la
postura es deny-by-default.

### Schema de degradación

```yaml
CapabilityResolutionDegradedError:
  allOf:
    - $ref: "#/components/schemas/ErrorResponse"
    - type: object
      properties:
        status:
          type: integer
          enum: [503]
        code:
          type: string
          enum: ["GW_CAPABILITY_RESOLUTION_DEGRADED"]
        message:
          type: string
          example: "Capability resolution is temporarily unavailable."
        retryable:
          type: boolean
          enum: [true]
```

### Ejemplo de degradación

```json
{
  "status": 503,
  "code": "GW_CAPABILITY_RESOLUTION_DEGRADED",
  "message": "Capability resolution is temporarily unavailable. Please retry.",
  "requestId": "req_xyz789",
  "correlationId": "corr_abc456",
  "timestamp": "2026-03-31T20:00:01Z",
  "resource": "/v1/workspaces/wrk_def456/webhooks",
  "retryable": true
}
```

## Diferenciación con errores existentes

| Código | Error code | Significado |
|---|---|---|
| 401 | `UNAUTHENTICATED` | Token ausente o inválido |
| 403 | `GW_SCOPE_INSUFFICIENT` | Token no tiene los scopes OAuth requeridos |
| 403 | `GW_PRIVILEGE_DOMAIN_MISMATCH` | Credencial en dominio incorrecto |
| 403 | `GW_CAPABILITY_NOT_ENTITLED` | **Nuevo** — Plan no incluye la capability |
| 503 | `GW_CAPABILITY_RESOLUTION_DEGRADED` | **Nuevo** — Servicio de resolución no disponible |
