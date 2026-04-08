# Guía práctica de uso de la plataforma

Esta guía resume los flujos operativos más importantes del paraguas `in-falcone` y cómo se usan en la práctica desde la consola, el gateway público o las APIs de administración.

## Mapa rápido de capacidades

| Capacidad | Servicio principal | Actor habitual | Cuándo usarla |
|-----------|-------------------|----------------|---------------|
| Gestión de planes y cuotas | `services/provisioning-orchestrator` | `superadmin`, `tenant-owner`, `workspace-admin` | Para definir límites, capacidades y asignaciones por tenant o workspace |
| Exportación / validación / migración de configuración | `services/provisioning-orchestrator` | `superadmin`, `sre`, `service_account` | Antes de reprovisionar o mover configuración entre tenants |
| Reprovisionamiento de configuración | `services/provisioning-orchestrator` | `superadmin`, `sre`, `service_account` | Para aplicar un artefacto de configuración a un tenant destino |
| Publicación de eventos en tiempo real | `services/realtime-gateway` | Frontend y backend consumidores | Para suscribirse a cambios del workspace y de la sesión |
| Documentación de workspace y SDKs | `services/workspace-docs-service`, `services/openapi-sdk-service` | Operadores y desarrolladores internos | Para publicar catálogos y artefactos de soporte |
| Estado, snapshots y restore | `services/backup-status` | `superadmin`, `sre`, `tenant-owner` | Para auditar backups y ejecutar restauraciones controladas |

## 1. Gestión de planes, capacidades y cuotas

La capa de provisión modela el plano de negocio de la plataforma: planes, capacidades booleanas, límites por dimensión y asignaciones por tenant.

### Flujos típicos

- Crear un plan nuevo.
- Ajustar capacidades del plan.
- Establecer o retirar límites por dimensión.
- Asignar un plan a un tenant.
- Revisar el impacto de cambio en capacidad / cuota.

### Ejemplos operativos

**Crear un plan**

La acción `plan-create` requiere actor `superadmin` y valida capacidades contra el catálogo activo.

**Actualizar un plan**

La acción `plan-update` permite cambiar `displayName`, `description`, `capabilities` y `quotaDimensions`.

**Asignar un plan a un tenant**

La acción `plan-assign` calcula impactos de capacidad y cuota antes de persistir la asignación y emite eventos de historial.

### Qué mirar cuando algo no cuadra

- `plan.lifecycle_transitioned` si el plan está en un estado incompatible.
- `plan.capability.enabled` / `plan.capability.disabled` si cambió la matriz de capacidades.
- `quota` y `effective-entitlements` si el problema es de cálculo de límites.

## 2. Exportar, validar, migrar y reprovisionar configuración

Estos flujos están pensados para mover configuración entre tenants o reconstruir un tenant a partir de un artefacto versionado.

### Secuencia recomendada

1. **Exportar** la configuración del tenant origen.
2. **Validar** el artefacto contra su esquema declarado.
3. **Migrar** el artefacto si la versión no coincide con la plataforma actual.
4. **Preflight** de reprovisionamiento para revisar riesgos y conflictos.
5. **Reprovisionar** cuando el artefacto y el mapa de identidades estén listos.

### Endpoints y acciones clave

| Operación | Ruta / acción | Comentario |
|-----------|---------------|------------|
| Exportar | `POST /v1/admin/tenants/{tenant_id}/config/export` | Genera el artefacto con dominios disponibles y checksum de esquema |
| Validar | `POST /v1/admin/tenants/{tenant_id}/config/validate` | Comprueba formato, checksum y compatibilidad de versión |
| Migrar | `POST /v1/admin/tenants/{tenant_id}/config/migrate` | Lleva un artefacto antiguo a la versión soportada |
| Preflight | `POST /v1/admin/tenants/{tenant_id}/config/reprovision/preflight` | Analiza conflictos antes de aplicar cambios |
| Reprovisionar | `POST /v1/admin/tenants/{tenant_id}/config/reprovision` | Aplica el artefacto en el tenant destino |

### Cuándo se necesita un identifier map

Si el `tenant_id` del artefacto origen difiere del tenant destino, el flujo de preflight / reprovision exige revisar el `identifier_map` propuesto antes de aplicar cambios.

### Buenas prácticas

- Valida siempre antes de migrar o reprovisionar.
- Trata el artefacto como un objeto firmado por proceso, no como un dump libre.
- Usa `dry_run` cuando quieras revisar el impacto sin escribir cambios.
- Conserva la trazabilidad de `correlation_id` entre exportación, validación y reprovisionamiento.

## 3. Sesiones y eventos en tiempo real

El gateway en tiempo real usa Keycloak para autenticación y Kafka para auditar eventos de autorización y sesión.

### Cuándo usarlo

- Interfaces web que necesitan refrescar estado del workspace sin polling.
- Backends que reaccionan a cambios de sesiones, suscripciones o permisos.

### Puntos operativos importantes

- Si `REALTIME_AUTH_ENABLED=false`, la autorización en tiempo real queda desactivada.
- El gateway requiere JWKS, introspección y acceso a Kafka para operar en producción.
- Las audiencias y scopes deben venir correctamente resueltos desde Keycloak.

### Qué verificar

- Que el cliente de Keycloak y el secreto de introspección están cargados.
- Que la lista de brokers Kafka es válida.
- Que los tópicos de auditoría tienen la convención esperada de la plataforma.

## 4. Documentación de workspace y SDKs

### `services/workspace-docs-service`

Este servicio publica metadatos y notas de un workspace. Operativamente se usa para:

- listar documentos del workspace,
- mostrar descripciones operativas,
- publicar o consultar catálogos que acompañan la consola.

### `services/openapi-sdk-service`

Este servicio genera o sirve SDKs y artefactos basados en la especificación OpenAPI.

Uso típico:

- publicar artefactos en S3-compatible storage,
- limitar la cadencia de peticiones al generador,
- conservar SDKs antiguos solo durante el tiempo de retención definido.

## 5. Estado de backup y restore

El servicio `backup-status` cubre el ciclo de vida operativo de backups, snapshots, validaciones previas y restauración.

### Flujos habituales

- Comprobar salud y frescura de backups.
- Listar snapshots disponibles.
- Lanzar un backup o una restauración controlada.
- Revisar auditoría de operaciones y prechecks.

### Reglas que conviene recordar

- El sistema puede usar confirmaciones previas antes de una restauración.
- Hay ventanas operativas y umbrales de riesgo configurables por entorno.
- Algunos adaptadores pueden estar deshabilitados; en ese caso el servicio degrada con la información disponible.

### Señales útiles durante una incidencia

- `BACKUP_STALE_THRESHOLD_MS` para decidir si un estado se considera obsoleto.
- `PRECHECK_*` para entender por qué una restauración quedó bloqueada.
- `RESTORE_CONFIRMATION_ENABLED` para saber si el flujo exige confirmación explícita.

## 6. Cómo operarlo desde la consola

Si no quieres consumir acciones directamente:

1. Usa la consola web para cambios de plan, cuota o capacidad.
2. Usa el área de administración para exportar o reprovisionar configuración.
3. Usa las vistas de backup y restore para revisar snapshots y auditar cambios.
4. Usa los componentes de realtime para validar que los cambios llegan al frontend sin polling.

## 7. Recomendaciones de operación

- Conserva `correlation_id` en todas las llamadas encadenadas.
- Prefiere `superadmin` o `sre` solo para operaciones que realmente lo requieran.
- Si un flujo toca identidad o secretos, registra el cambio en el trail de auditoría correspondiente.
- Antes de reprovisionar, revisa el perfil de despliegue y la compatibilidad de formato.

## Referencias relacionadas

- `docs/guides/installation-openshift.md`
- `docs/reference/environment-variables.md`
- `docs/README.md`
