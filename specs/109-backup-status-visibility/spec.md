# Feature Specification: US-BKP-01-T01 — Estado de Backup de Componentes Gestionados

**Feature Branch**: `109-backup-status-visibility`
**Task**: US-BKP-01-T01
**Epic**: EP-20 — Backup, recuperación y continuidad operativa
**Story**: US-BKP-01 — Estado de backup/restore y flujos administrativos de recuperación
**Story type**: Feature
**Priority**: P1
**Relative size**: M
**Requirements traceability**: RF-BKP-001, RF-BKP-002, RF-BKP-005
**Dependencies**: US-OBS-01 (observability metrics stack), US-DEP-03 (deployment topology and profiles)
**Created**: 2026-03-31
**Status**: Draft

---

## 1. Objetivo y Problema que Resuelve

La plataforma BaaS multi-tenant gestiona múltiples componentes de infraestructura —PostgreSQL, MongoDB, Kafka, S3-compatible storage, Keycloak, OpenWhisk— cada uno con sus propias capacidades y mecanismos de backup/restore nativos. Actualmente, los operadores (SRE, superadmin) no disponen de una superficie unificada dentro del producto para conocer el estado de backup de estos componentes. La consecuencia directa:

1. **Opacidad operativa**: para conocer si un componente tiene backup activo, cuándo fue la última ejecución exitosa o si hay errores, el operador debe salir del producto y consultar cada subsistema por separado (consola de Kubernetes, herramientas nativas del proveedor de almacenamiento, logs de CronJobs, etc.).
2. **Riesgo de indisponibilidad no detectada**: un fallo silencioso en la configuración o ejecución de backups puede pasar inadvertido durante días, comprometiendo la capacidad de recuperación.
3. **Ausencia de base para flujos de recuperación**: sin visibilidad sobre el estado de backup, las tareas hermanas (T02–T06) que implementan flujos de restore, validación de integridad y políticas de retención no tienen una superficie sobre la que operar.

Esta tarea resuelve exclusivamente el **primer escalón**: exponer, de forma consultable y auditable, el estado de backup de cada componente gestionado cuando la configuración de despliegue lo permita.

No implementa la ejecución de backups, la restauración, la validación de integridad, ni la gestión de políticas de retención. Esos alcances pertenecen a T02–T06.

---

## 2. Actores y Consumidores

| Actor | Tipo | Valor que recibe |
| --- | --- | --- |
| SRE / Platform team | Interno (operador) | Vista unificada del estado de backup de todos los componentes gestionados sin salir del producto; detección temprana de fallos |
| Superadmin | Interno (gobernanza) | Visibilidad transversal de la postura de backup de la plataforma para cumplimiento operativo y auditoría |
| Tenant Owner | Externo (futuro) | **No es consumidor directo en T01**; la superficie expuesta aquí será la base para vistas tenant-scoped en tareas posteriores |
| Console backend | Interno (sistema) | Modelo estructurado de estado de backup consumible por endpoints de API y vistas de consola |
| Pipeline de auditoría (US-OBS-02) | Interno (sistema) | Eventos de consulta de estado de backup integrados en el stream de auditoría existente |

---

## 3. Escenarios de Usuario y Criterios de Aceptación

### Escenario 1 — Consultar estado de backup de componentes gestionados (Prioridad: P1)

Un operador (SRE o superadmin) solicita, a través de la API del control plane, el estado de backup de los componentes gestionados de la plataforma. El sistema responde con un resumen por componente.

**Por qué esta prioridad**: es la capacidad central de la tarea; sin ella no hay visibilidad.

**Verificación independiente**: se puede probar invocando el endpoint y verificando que la respuesta contiene un registro por cada componente gestionado con campos de estado definidos.

**Criterios de aceptación**:

1. **Given** un SRE autenticado con permisos de operador de plataforma, **When** consulta el estado de backup a través de la API del control plane, **Then** recibe una lista de componentes gestionados con su estado de backup actual (ver campos mínimos en sección 5).
2. **Given** un componente gestionado cuyo despliegue no incluye configuración de backup (e.g., entorno `dev` sin backups habilitados), **When** el operador consulta el estado, **Then** el componente aparece con estado `not_configured` y no se presenta como error.
3. **Given** un componente con backup configurado y última ejecución exitosa, **When** el operador consulta el estado, **Then** el registro muestra estado `healthy`, timestamp de última ejecución exitosa y destino de almacenamiento (sin exponer credenciales).
4. **Given** un componente con backup configurado cuya última ejecución ha fallado, **When** el operador consulta el estado, **Then** el registro muestra estado `unhealthy`, timestamp del último fallo, y razón resumida del error.

---

### Escenario 2 — Estado condicionado al perfil de despliegue (Prioridad: P1)

La visibilidad de backup solo se activa cuando el perfil de despliegue (US-DEP-03) lo habilita. No todos los entornos tienen backup configurado, y la superficie debe reflejar eso con claridad en lugar de reportar falsos negativos.

**Por qué esta prioridad**: sin esta lógica, la superficie genera ruido y falsas alarmas en entornos de desarrollo.

**Verificación independiente**: se puede verificar desplegando con y sin la feature flag de backup habilitada y comprobando que la respuesta de la API refleja correctamente la configuración.

**Criterios de aceptación**:

1. **Given** un entorno de despliegue donde el perfil de backup está habilitado para PostgreSQL y MongoDB pero no para Kafka, **When** el operador consulta el estado, **Then** PostgreSQL y MongoDB aparecen con su estado real; Kafka aparece con estado `not_configured`.
2. **Given** un entorno `dev` donde ningún componente tiene backup configurado, **When** el operador consulta el estado, **Then** todos los componentes aparecen con estado `not_configured` y la respuesta es exitosa (HTTP 200), no un error.
3. **Given** un cambio en el perfil de despliegue que habilita backup para un componente que antes no lo tenía, **When** el operador consulta el estado después del redespliegue, **Then** el componente refleja su nuevo estado real en lugar de `not_configured`.

---

### Escenario 3 — Aislamiento de visibilidad y seguridad de acceso (Prioridad: P1)

La consulta de estado de backup es una operación privilegiada. Solo actores con roles de operador de plataforma (SRE) o superadmin pueden acceder a esta superficie.

**Por qué esta prioridad**: el aislamiento de seguridad es un requisito transversal P0 de la plataforma; sin él, la superficie no es desplegable.

**Verificación independiente**: se puede verificar intentando acceder al endpoint con diferentes roles y comprobando que solo los autorizados reciben datos.

**Criterios de aceptación**:

1. **Given** un tenant owner autenticado, **When** intenta consultar el estado de backup de la plataforma, **Then** la solicitud es rechazada con HTTP 403 (Forbidden).
2. **Given** un workspace admin autenticado, **When** intenta consultar el estado de backup de la plataforma, **Then** la solicitud es rechazada con HTTP 403 (Forbidden).
3. **Given** un usuario no autenticado, **When** intenta consultar el estado de backup, **Then** la solicitud es rechazada con HTTP 401 (Unauthorized).
4. **Given** un SRE autenticado con rol de operador de plataforma, **When** consulta el estado de backup, **Then** recibe la información completa de todos los componentes gestionados.
5. **Given** un superadmin autenticado, **When** consulta el estado de backup, **Then** recibe la misma información que el SRE.

---

### Escenario 4 — Auditoría de consultas de estado de backup (Prioridad: P1)

Cada consulta al estado de backup genera un evento de auditoría siguiendo el esquema canónico de auditoría de la plataforma (US-OBS-02-T02).

**Por qué esta prioridad**: la auditabilidad es un requisito explícito de la historia US-BKP-01 y un requisito transversal de la plataforma.

**Verificación independiente**: se puede verificar consultando el estado de backup y comprobando que el pipeline de auditoría recibe el evento correspondiente.

**Criterios de aceptación**:

1. **Given** un SRE consulta el estado de backup, **When** la respuesta se entrega exitosamente, **Then** se emite un evento de auditoría con: `actor` (identidad del operador), `scope` (platform), `resource` (backup_status), `action` (read), `result` (success), `correlation_id`, y `event_timestamp`.
2. **Given** un actor no autorizado intenta consultar el estado de backup, **When** la solicitud es rechazada, **Then** se emite un evento de auditoría con `result` (denied) y el mismo conjunto de campos descriptivos.
3. **Given** un evento de auditoría de consulta de backup, **When** se inspecciona el registro, **Then** no contiene credenciales, secretos ni rutas internas de almacenamiento de backup.

---

## 4. Casos Borde

| # | Caso borde | Comportamiento esperado |
| --- | --- | --- |
| E1 | Un componente gestionado está desplegado pero su mecanismo nativo de reporte de estado no responde (timeout) | El componente aparece con estado `unknown` y un campo `reason` indicando timeout. No bloquea la respuesta del resto de componentes. |
| E2 | Se consulta el estado inmediatamente después de un despliegue inicial, antes de que cualquier backup haya ejecutado | Los componentes con backup configurado aparecen con estado `pending` (configurado, sin ejecución aún). |
| E3 | Un componente es eliminado del despliegue (ya no está gestionado) | El componente desaparece de la respuesta. No se muestran componentes fantasma. |
| E4 | Dos operadores consultan el estado de backup de forma concurrente | Ambos reciben respuestas consistentes y completas; la operación es de solo lectura y no requiere serialización. |
| E5 | El servicio de observabilidad (US-OBS-01) no está disponible temporalmente | La consulta de estado de backup puede funcionar de forma degradada si la fuente de datos de estado es independiente del stack de métricas. Si depende completamente de él, devuelve HTTP 503 con mensaje descriptivo. |
| E6 | Un componente tiene backup configurado pero el destino de almacenamiento es inalcanzable | El estado del componente refleja `unhealthy` con `reason` descriptivo referente al destino inalcanzable, sin exponer la URI completa del destino ni credenciales. |

---

## 5. Reglas de Negocio

### RN-1: Campos mínimos del estado de backup por componente

Cada registro de estado de backup debe incluir al menos:

| Campo | Descripción | Ejemplo |
| --- | --- | --- |
| `component_kind` | Tipo canónico del componente gestionado | `postgresql`, `mongodb`, `kafka`, `storage_s3`, `keycloak`, `openwhisk` |
| `component_id` | Identificador único de la instancia del componente en el despliegue | `pg-primary-prod-01` |
| `backup_status` | Estado actual del backup | `healthy`, `unhealthy`, `pending`, `not_configured`, `unknown` |
| `last_successful_at` | Timestamp ISO 8601 de la última ejecución exitosa | `2026-03-31T02:00:00Z` o `null` |
| `last_failed_at` | Timestamp ISO 8601 del último fallo | `2026-03-31T02:15:00Z` o `null` |
| `failure_reason` | Razón resumida del último fallo (sin secretos) | `"destination unreachable"` o `null` |
| `destination_label` | Etiqueta legible del destino de backup (sin URIs ni credenciales) | `"s3-backup-primary"` |
| `deployment_profile` | Perfil de despliegue que gobierna la configuración de backup | `prod`, `staging`, `dev` |

### RN-2: Estados válidos de backup

El campo `backup_status` solo admite los siguientes valores:

- `healthy` — backup configurado, última ejecución exitosa dentro del umbral esperado.
- `unhealthy` — backup configurado, última ejecución fallida o expiración del umbral de frescura.
- `pending` — backup configurado, sin ejecución registrada aún.
- `not_configured` — el perfil de despliegue no habilita backup para este componente.
- `unknown` — no se puede determinar el estado (timeout, error de comunicación con el subsistema).

### RN-3: No exposición de secretos

Ningún campo de la respuesta de estado de backup puede contener:
- URIs completas de destinos de almacenamiento de backup.
- Credenciales, tokens, o claves de acceso.
- Rutas internas del sistema de archivos del cluster.

La redacción de destino se limita a una etiqueta configurada (`destination_label`).

### RN-4: Lectura solamente

Esta tarea expone una superficie de **solo lectura**. No permite iniciar, cancelar ni modificar backups. Esos flujos pertenecen a T02–T06.

### RN-5: Degradación parcial

Si el estado de un componente individual no puede ser determinado, el endpoint debe devolver el resultado del resto de componentes con normalidad. El componente problemático aparece con estado `unknown`. La respuesta global no falla por un componente individual.

---

## 6. Requisitos Funcionales Detallados

### RF-BKP-001 — Consulta de estado de backup

El control plane expone un endpoint de solo lectura que retorna el estado de backup agregado de todos los componentes gestionados de la plataforma. La respuesta incluye los campos definidos en RN-1 para cada componente.

### RF-BKP-002 — Condicionamiento al perfil de despliegue

El estado de backup reportado por cada componente está condicionado a la configuración de backup declarada en el perfil de despliegue activo (US-DEP-03). Si el perfil no habilita backup para un componente, el estado es `not_configured`.

### RF-BKP-005 — Integración con el pipeline de auditoría

Toda consulta al estado de backup —exitosa o denegada— emite un evento de auditoría al pipeline canónico (US-OBS-02) siguiendo el esquema de evento definido en `observability-audit-event-schema.json`.

---

## 7. Límites de Alcance

### En alcance (T01)

- Modelo lógico del estado de backup por componente gestionado.
- Endpoint de lectura en el control plane para operadores.
- Condicionamiento de la respuesta al perfil de despliegue.
- Emisión de eventos de auditoría por consulta.
- Redacción de secretos en la superficie expuesta.

### Fuera de alcance (tareas hermanas T02–T06)

- **T02**: Ejecución manual o programada de backups.
- **T03**: Flujo de restauración (restore) administrativa.
- **T04**: Validación de integridad de backups.
- **T05**: Gestión de políticas de retención.
- **T06**: Vista de tenant owner sobre estado de backup de sus recursos.

### Fuera de alcance (otras historias)

- Backup de datos de usuario/tenant (scope de negocio, no de infraestructura).
- Disaster recovery cross-region.
- Automatización de backup basada en eventos (e.g., pre-upgrade).

---

## 8. Permisos, Multi-tenancy y Auditoría

### Permisos

| Rol | Acceso a estado de backup (T01) |
| --- | --- |
| Superadmin | ✅ Lectura completa de todos los componentes |
| SRE / Operador de plataforma | ✅ Lectura completa de todos los componentes |
| Tenant Owner | ❌ Sin acceso en T01 (futuro en T06) |
| Workspace Admin | ❌ Sin acceso |
| Service Account | ❌ Sin acceso |
| Usuario no autenticado | ❌ Sin acceso |

La autorización se evalúa contra el modelo contextual de autorización de la plataforma (`contextual-authorization.md`). El recurso protegido es `backup_status` con acción `read` a nivel de scope `platform`.

### Multi-tenancy

En T01, la superficie de estado de backup opera a nivel de plataforma, no a nivel de tenant. No existe filtrado por tenant porque los componentes gestionados (PostgreSQL, MongoDB, etc.) son infraestructura compartida gestionada por el equipo de plataforma.

La extensión a visibilidad tenant-scoped (e.g., "estado de backup de los recursos de mi workspace") pertenece a T06 y dependerá del mapeo entre `managed_resource` (del core domain model) y los componentes de infraestructura subyacentes.

### Auditoría

- Cada consulta exitosa genera un evento con `action: read`, `resource: backup_status`, `scope: platform`.
- Cada intento denegado genera un evento con `result: denied`.
- Los eventos siguen el esquema canónico de `observability-audit-event-schema.json`.
- Los eventos no contienen datos sensibles (credenciales, rutas de almacenamiento).

---

## 9. Riesgos y Supuestos

### Supuestos

| # | Supuesto |
| --- | --- |
| S1 | El perfil de despliegue (US-DEP-03) ya declara, por componente, si el backup está habilitado y con qué etiqueta de destino. Si esta declaración no existe aún, T01 la introduce como extensión mínima del contrato de despliegue. |
| S2 | Cada componente gestionado que soporta backup expone de forma nativa algún mecanismo consultable para conocer el timestamp y resultado de la última ejecución de backup (e.g., CronJob status en Kubernetes, tabla de estado en el propio servicio, o archivo de estado en el destino de almacenamiento). |
| S3 | El pipeline de auditoría (US-OBS-02) está operativo y acepta eventos con el esquema canónico. |
| S4 | La autenticación y autorización del control plane (Keycloak + gateway) están operativas y soportan el rol de operador de plataforma. |

### Riesgos

| # | Riesgo | Mitigación |
| --- | --- | --- |
| R1 | Un componente gestionado no expone un mecanismo nativo consultable para conocer el estado de su backup. | Se introduce el estado `unknown` con `reason` descriptivo. La integración con ese componente se documenta como limitación conocida y se aborda en tareas posteriores. |
| R2 | La latencia de consulta del estado de backup a múltiples subsistemas puede ser elevada si se realiza de forma síncrona en cada petición. | Se permite que el control plane mantenga un caché de estado con frescura configurable (TTL), consultando los subsistemas de forma periódica en lugar de bajo demanda. El campo `last_checked_at` puede añadirse para transparencia. |
| R3 | Los perfiles de despliegue actuales (US-DEP-03) pueden no tener un campo explícito para habilitar/deshabilitar backup por componente. | T01 introduce la extensión mínima necesaria al contrato de despliegue, documentada como parte de esta tarea. |
| R4 | Cambios en la lista de componentes gestionados entre versiones del despliegue podrían generar inconsistencias en la respuesta. | El endpoint refleja siempre el estado actual del despliegue activo; no persiste historial de componentes removidos. |

---

## 10. Resumen de Criterios de Aceptación

| # | Criterio | Prioridad |
| --- | --- | --- |
| AC-1 | Un SRE o superadmin puede consultar el estado de backup de todos los componentes gestionados a través de la API del control plane y recibir los campos definidos en RN-1. | P1 |
| AC-2 | Componentes sin backup configurado en el perfil de despliegue aparecen con estado `not_configured` (no como error). | P1 |
| AC-3 | Componentes con backup configurado reflejan correctamente `healthy`, `unhealthy`, `pending` o `unknown` según el estado real. | P1 |
| AC-4 | Actores sin rol de operador de plataforma o superadmin reciben HTTP 403. Usuarios no autenticados reciben HTTP 401. | P1 |
| AC-5 | Cada consulta (exitosa o denegada) genera un evento de auditoría conforme al esquema canónico, sin secretos. | P1 |
| AC-6 | La respuesta no contiene credenciales, URIs completas de destino ni rutas internas del sistema de archivos. | P1 |
| AC-7 | Un fallo en la determinación de estado de un componente individual no bloquea la respuesta del resto (degradación parcial). | P1 |
