# ADR 074 — Async Job Progress UI: Consulta de operaciones asíncronas

**Fecha**: 2026-03-30
**Estado**: Accepted
**Task**: US-UIB-02-T02

## Decisiones

### D1: Almacenamiento de logs resumidos en PostgreSQL

Tabla `async_operation_log_entries` en PostgreSQL. Rechazado: MongoDB, porque añadiría inconsistencia operacional sin aportar ventajas para un caso tabular y multi-tenant.

### D2: Acción OpenWhisk unificada con `queryType`

Se implementa una única acción `async-operation-query` con enrutado interno para `list`, `detail`, `logs` y `result`. Rechazado: cuatro acciones separadas, por el overhead de despliegue y mantenimiento.

### D3: Polling adaptativo en la consola

La consola actualiza el listado cada 30 s si hay operaciones activas y el indicador global cada 15 s mientras exista actividad. Rechazado: SSE/WebSocket, porque requieren infraestructura adicional no justificada en este alcance.

### D4: `tenant_id` siempre desde `callerContext`

Los actores regulares sólo leen dentro de su tenant IAM-verificado. El superadmin puede ampliar el scope con `filters.tenantId`. Rechazado: aceptar `tenant_id` desde el payload del cliente para todos los roles, por riesgo de escalada horizontal.

### D5: Resultado final desde campos JSONB ya existentes

El resultado exitoso se proyecta desde `result` y el fallo desde `error_summary` en `async_operations`. Rechazado: una tabla adicional `operation_results`, por redundante.
