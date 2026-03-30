# Feature Specification: Progreso, Logs y Resultado de Operaciones Asíncronas

**Feature Branch**: `074-async-job-progress-ui`  
**Created**: 2026-03-30  
**Status**: Draft  
**Input**: User description: "Exponer endpoints y componentes UI para consultar progreso, logs resumidos y resultado final de operaciones largas (US-UIB-02-T02)."

**Backlog Traceability**:
- Task ID: US-UIB-02-T02
- Epic: EP-16 — Backend funcional de la consola
- Historia: US-UIB-02 — Estado asíncrono, reintentos e idempotencia de aprovisionamientos administrativos
- RF cubiertos: RF-UIB-006, RF-UIB-007, RF-UIB-008
- Dependencias: US-UIB-01, US-UIB-02-T01

## Objetivo y Problema que Resuelve

La tarea anterior (US-UIB-02-T01) estableció el modelo de dominio para representar operaciones asíncronas: registros con estados, transiciones, timestamps y aislamiento multi-tenant. Sin embargo, ese modelo por sí solo no es visible para los usuarios de la consola ni accesible desde la API pública.

**Problema actual**: Aunque el sistema registra internamente el ciclo de vida de las operaciones de aprovisionamiento, no existe una forma para que el actor administrativo (tenant owner, workspace admin, superadmin) consulte el progreso de una operación en curso, vea un resumen de los logs de ejecución ni obtenga el resultado final de la operación. Esto significa que:

1. **El usuario no sabe qué pasa**: tras iniciar un aprovisionamiento, la consola no puede mostrar si la operación está en progreso, ha fallado o ha finalizado.
2. **Sin visibilidad de logs**: no hay forma de consultar un resumen de la actividad de la operación para diagnosticar problemas o entender qué ha ocurrido.
3. **Sin resultado accesible**: una vez completada la operación, el resultado final (éxito con detalle o fallo con motivo) no se expone al usuario ni a la consola.

Esta tarea entrega los **endpoints de consulta** y los **componentes de interfaz** que conectan el modelo de operaciones con la experiencia del usuario, permitiendo seguimiento no bloqueante de procesos largos.

## Usuarios y Consumidores Afectados

| Actor | Tipo | Valor que recibe |
| ----- | ---- | ---------------- |
| Tenant Owner | Externo | Puede monitorizar el progreso de sus aprovisionamientos sin abandonar la consola ni depender de soporte |
| Workspace Admin | Externo | Visibilidad sobre operaciones que afectan a su workspace, incluyendo logs resumidos para autodiagnóstico |
| Superadmin | Interno | Vista transversal de operaciones en todos los tenants para gobernanza y soporte proactivo |
| Console Frontend | Interno (sistema) | Componentes reutilizables para presentar estado, progreso y resultado de cualquier operación asíncrona |

## User Scenarios & Testing

### User Story 1 — Consultar el estado actual de una operación en curso (Priority: P1)

Un actor administrativo inicia un aprovisionamiento largo desde la consola. Mientras la operación se ejecuta, el usuario puede navegar a una vista donde se muestra el estado actual de la operación (pending, running, completed, failed) junto con marcas temporales y metadatos básicos (tipo de operación, quién la inició, cuándo).

**Why this priority**: Es la capacidad más fundamental: sin visibilidad del estado, todo lo demás (logs, resultado) carece de contexto. Es el primer valor tangible para el usuario.

**Independent Test**: Se puede verificar creando una operación de prueba, consultando su estado a través del endpoint o la vista de consola y comprobando que los datos presentados coinciden con el registro del modelo subyacente.

**Acceptance Scenarios**:

1. **Given** un tenant owner ha iniciado un aprovisionamiento que está en estado `running`, **When** consulta la vista de operaciones en la consola, **Then** ve la operación listada con su estado actual (`running`), tipo de operación, fecha de inicio y actor que la inició.
2. **Given** un workspace admin consulta operaciones de su workspace, **When** hay 3 operaciones (una `pending`, una `running`, una `completed`), **Then** la vista muestra las tres con sus respectivos estados y timestamps, ordenadas por fecha de creación descendente.
3. **Given** un tenant owner consulta operaciones, **When** existen operaciones de otro tenant en el sistema, **Then** solo se muestran las operaciones que pertenecen a su propio tenant.
4. **Given** un actor sin permisos de administración sobre el workspace, **When** intenta consultar operaciones del workspace, **Then** la solicitud es rechazada con error de autorización.

---

### User Story 2 — Ver logs resumidos de una operación (Priority: P2)

Mientras una operación está en ejecución o tras su finalización, el usuario puede acceder a un resumen de los pasos o eventos relevantes de la operación. No se trata de logs técnicos completos, sino de un resumen orientado al usuario que indica qué etapas se han ejecutado y su resultado parcial.

**Why this priority**: Los logs resumidos aportan transparencia y capacidad de autodiagnóstico, reduciendo la dependencia de soporte, pero requieren primero que la consulta de estado (US1) funcione.

**Independent Test**: Se puede verificar ejecutando una operación que produce al menos dos entradas de log resumido, consultando los logs a través del endpoint o la vista de consola, y comprobando que las entradas aparecen en orden cronológico con su contenido.

**Acceptance Scenarios**:

1. **Given** una operación en estado `running` que ha completado 2 de 4 pasos, **When** el usuario consulta los logs resumidos de esa operación, **Then** ve las 2 entradas de los pasos completados con sus mensajes descriptivos y timestamps, en orden cronológico.
2. **Given** una operación en estado `failed`, **When** el usuario consulta los logs resumidos, **Then** la última entrada indica el motivo de fallo en lenguaje comprensible para el usuario (no trazas técnicas internas).
3. **Given** una operación que no ha producido entradas de log aún (recién creada en `pending`), **When** el usuario consulta los logs, **Then** se muestra un estado vacío con mensaje informativo (e.g., "La operación aún no ha comenzado a ejecutarse").
4. **Given** una operación con logs resumidos, **When** un actor de otro tenant intenta acceder a esos logs, **Then** la solicitud es rechazada.

---

### User Story 3 — Obtener resultado final de una operación completada (Priority: P2)

Cuando una operación alcanza un estado terminal (`completed` o `failed`), el usuario puede consultar el resultado final: en caso de éxito, un resumen de lo que se aprovisionó; en caso de fallo, el motivo y cualquier acción recomendada.

**Why this priority**: El resultado final cierra el ciclo de visibilidad. Sin él, el usuario sabe que terminó pero no qué pasó. Es complementario a la consulta de estado (US1).

**Independent Test**: Se puede verificar completando y fallando operaciones de prueba, consultando el resultado final en cada caso, y comprobando que la información presentada es correcta y accionable.

**Acceptance Scenarios**:

1. **Given** una operación en estado `completed`, **When** el usuario consulta su resultado, **Then** ve un resumen que incluye qué se aprovisionó, cuándo finalizó y cualquier detalle relevante del resultado.
2. **Given** una operación en estado `failed`, **When** el usuario consulta su resultado, **Then** ve el motivo del fallo en lenguaje claro y, si aplica, una indicación de si la operación puede reintentarse.
3. **Given** una operación en estado `running`, **When** el usuario intenta consultar el resultado final, **Then** el sistema indica que la operación aún está en curso y no hay resultado final disponible.

---

### User Story 4 — Indicador de progreso no bloqueante en la consola (Priority: P3)

Mientras el usuario navega por la consola tras iniciar un aprovisionamiento, un indicador discreto (notificación, badge o panel lateral) muestra que hay operaciones en curso, permitiendo al usuario seguir trabajando sin bloqueo.

**Why this priority**: Mejora la experiencia del usuario pero no es estrictamente necesario para la funcionalidad mínima de consulta. Los usuarios pueden alternativamente navegar explícitamente a la vista de operaciones.

**Independent Test**: Se puede verificar iniciando una operación larga, navegando a otra sección de la consola, y comprobando que un indicador visual muestra la existencia de operaciones activas.

**Acceptance Scenarios**:

1. **Given** un usuario tiene 2 operaciones en estado `running`, **When** navega a cualquier sección de la consola, **Then** un indicador muestra que hay operaciones activas (e.g., badge con contador "2").
2. **Given** todas las operaciones del usuario han finalizado, **When** navega por la consola, **Then** el indicador de operaciones activas desaparece o muestra "0".
3. **Given** un usuario con operaciones activas, **When** hace clic en el indicador, **Then** se navega a la vista detallada de operaciones.

### Edge Cases

- ¿Qué sucede cuando una operación lleva más tiempo del esperado sin cambiar de estado? El sistema debe mostrar el estado tal cual (e.g., `running`) con el timestamp de la última actualización, permitiendo al usuario evaluar si la operación está atascada.
- ¿Cómo se gestiona la consulta de una operación que ha sido eliminada o purgada del registro? El sistema debe retornar un error claro indicando que la operación no existe o ha sido archivada.
- ¿Qué sucede si la consola pierde conectividad mientras consulta el progreso? La interfaz debe degradar graciosamente, mostrando el último estado conocido y un indicador de reconexión.
- ¿Qué ocurre si hay un volumen alto de operaciones históricas? La consulta debe soportar paginación y no degradarse con cientos de registros por tenant.

## Requirements

### Functional Requirements

- **FR-001**: El sistema DEBE exponer un endpoint para listar operaciones del tenant autenticado, con filtros por estado, tipo de operación y workspace, con paginación.
- **FR-002**: El sistema DEBE exponer un endpoint para obtener el detalle de una operación individual por su identificador, incluyendo estado, timestamps, tipo, actor y workspace.
- **FR-003**: El sistema DEBE exponer un endpoint para obtener los logs resumidos de una operación, con las entradas en orden cronológico y contenido orientado al usuario.
- **FR-004**: El sistema DEBE exponer un endpoint para obtener el resultado final de una operación en estado terminal, incluyendo resumen de resultado (éxito) o motivo y acción recomendada (fallo).
- **FR-005**: Todos los endpoints de consulta DEBEN aplicar aislamiento multi-tenant: un actor solo puede consultar operaciones de su propio tenant.
- **FR-006**: Todos los endpoints de consulta DEBEN verificar permisos del actor sobre el recurso (tenant/workspace) antes de retornar datos.
- **FR-007**: La consola DEBE presentar una vista de listado de operaciones con estado, tipo, timestamps y actor, con paginación y filtros.
- **FR-008**: La consola DEBE presentar una vista de detalle de operación individual que incluya estado, logs resumidos y resultado final (cuando disponible).
- **FR-009**: La consola DEBE incluir un indicador no bloqueante de operaciones activas visible desde cualquier sección.
- **FR-010**: Todas las consultas de operaciones DEBEN generar entradas de auditoría que registren quién consultó qué operación.
- **FR-011**: Los logs resumidos DEBEN presentar mensajes en lenguaje comprensible para el usuario, no trazas técnicas internas.
- **FR-012**: El sistema DEBE soportar paginación en la consulta de listado de operaciones y en la consulta de logs resumidos.

### Key Entities

- **Operation**: Registro del ciclo de vida de una operación asíncrona. Atributos clave: identificador único, estado, tipo de operación, tenant_id, actor_id, workspace_id (opcional), timestamps de creación/inicio/fin, resultado final.
- **Operation Log Entry**: Entrada de resumen asociada a una operación. Atributos clave: identificador, operation_id, timestamp, mensaje descriptivo orientado al usuario, nivel (informativo/advertencia/error).
- **Operation Result**: Resultado final de una operación terminal. Atributos clave: tipo de resultado (éxito/fallo), resumen, detalle del fallo (si aplica), indicador de reintentabilidad.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Un actor administrativo puede consultar el estado de cualquier operación propia en menos de 3 segundos desde la consola.
- **SC-002**: Los logs resumidos de una operación se muestran al usuario en menos de 5 segundos, independientemente del número de entradas (con paginación).
- **SC-003**: El 100% de las consultas de operaciones respetan el aislamiento multi-tenant: ningún actor accede a datos de otro tenant.
- **SC-004**: El indicador de operaciones activas se actualiza sin requerir recarga manual de la página.
- **SC-005**: El resultado final de una operación completada incluye información suficiente para que el usuario entienda qué se aprovisionó o por qué falló, sin necesidad de contactar a soporte.
- **SC-006**: La vista de listado soporta al menos 500 operaciones históricas por tenant sin degradación perceptible.

## Assumptions

- El modelo de dominio de operaciones (US-UIB-02-T01, specs/073) ya existe y proporciona la representación de estados, transiciones, timestamps y metadatos necesarios.
- Los logs resumidos se almacenan como entradas asociadas a cada operación; el mecanismo de escritura de estos logs es responsabilidad del workflow que ejecuta la operación, no de esta tarea.
- El aislamiento multi-tenant sigue el patrón existente del producto: tenant_id como filtro obligatorio en todas las consultas.
- Los permisos de consulta siguen el modelo RBAC existente del producto (via Keycloak).
- El indicador no bloqueante de operaciones activas utiliza polling periódico o mecanismo equivalente; la elección concreta es decisión de implementación.
- La paginación sigue convenciones estándar del producto (offset/limit o cursor).

## Scope Boundaries

### In Scope

- Endpoints de consulta (listado, detalle, logs, resultado) para operaciones asíncronas.
- Componentes UI de la consola para visualizar estado, progreso, logs y resultado.
- Indicador no bloqueante de operaciones activas.
- Aislamiento multi-tenant y control de permisos en todas las consultas.
- Auditoría de accesos a datos de operaciones.

### Out of Scope

- Creación o modificación de operaciones (ya cubierto por US-UIB-02-T01).
- Reintentos de operaciones fallidas (US-UIB-02-T03).
- Políticas de timeout o cancelación (US-UIB-02-T04).
- Pruebas de reconexión (US-UIB-02-T05).
- Documentación de semántica de reintento (US-UIB-02-T06).
- Logs técnicos detallados (este alcance cubre solo logs resumidos orientados al usuario).
