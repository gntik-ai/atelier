# Feature Specification: Políticas de Timeout, Cancelación y Recuperación para Aprovisionamientos Complejos

**Feature Branch**: `076-timeout-cancel-recovery-policies`  
**Created**: 2026-03-30  
**Status**: Draft  
**Input**: User description: "Definir políticas de timeout, cancelación y recuperación para aprovisionamientos complejos"

**Backlog Traceability**:
- Task ID: US-UIB-02-T04
- Epic: EP-16 — Backend funcional de la consola
- Historia: US-UIB-02 — Estado asíncrono, reintentos e idempotencia de aprovisionamientos administrativos
- RF cubiertos: RF-UIB-006, RF-UIB-007, RF-UIB-008
- Dependencias declaradas de la historia: US-UIB-01
- Dependencias dentro de la historia: US-UIB-02-T01 (modelo de operation status), US-UIB-02-T02 (endpoints de consulta de progreso), US-UIB-02-T03 (reintentos idempotentes con deduplicación)

## Objetivo y Problema que Resuelve

Las tareas anteriores de US-UIB-02 han establecido el modelo de operaciones asíncronas (T01), los endpoints de consulta de progreso (T02) y los reintentos idempotentes con deduplicación (T03). Sin embargo, la plataforma aún carece de políticas formales para gestionar operaciones que se prolongan más allá de lo esperado, que necesitan ser canceladas por el actor solicitante, o que requieren acciones de recuperación cuando quedan en estados inconsistentes. Concretamente:

1. **Operaciones sin límite de duración**: una operación en estado `running` puede permanecer indefinidamente sin que el sistema detecte que ha dejado de progresar, consumiendo recursos y confundiendo al usuario sobre su estado real.
2. **Imposibilidad de cancelar**: un actor que inició un aprovisionamiento no tiene forma de indicar al sistema que desea abortar la operación, ni de obtener confirmación de que la cancelación fue procesada.
3. **Operaciones huérfanas sin recuperación**: cuando una operación falla parcialmente o queda en un estado inconsistente (p. ej. `running` tras un crash del procesador), no existe un mecanismo que detecte y trate estos casos, dejando registros en un limbo que requiere intervención manual sin guía.

Esta tarea define las **políticas de timeout, cancelación y recuperación** como capacidades funcionales del modelo de operaciones, extendiendo el ciclo de vida con nuevos estados y transiciones, reglas de gobierno configurables, y mecanismos de detección y resolución que permiten a la consola y al sistema operar de forma resiliente sobre aprovisionamientos complejos.

## Usuarios y Consumidores Afectados

| Actor | Tipo | Valor que recibe |
| ----- | ---- | ---------------- |
| Tenant Owner | Externo | Puede cancelar operaciones que ya no necesita y recibe notificación clara si una operación excede su tiempo esperado |
| Workspace Admin | Externo | Las operaciones sobre su workspace no quedan bloqueadas indefinidamente; puede intervenir con cancelación si lo necesita |
| Superadmin | Interno | Tiene visibilidad sobre operaciones expiradas u huérfanas en cualquier tenant y puede forzar recuperación o cancelación |
| Console Backend | Interno (sistema) | Dispone de políticas configurables para detectar timeouts, procesar cancelaciones y ejecutar acciones de recuperación de forma estandarizada |
| Motor de Sagas/Workflows | Interno (sistema) | Puede cooperar con las políticas de timeout y cancelación para ejecutar compensaciones cuando una operación es abortada a mitad de un workflow multi-step |

## User Scenarios & Testing

### User Story 1 — Timeout automático de operaciones que exceden su duración máxima (Priority: P1)

Cuando una operación permanece en estado `running` más allá de la duración máxima configurada para su tipo de operación, el sistema la detecta y la transiciona automáticamente a un estado que indica expiración, protegiendo al usuario de esperas infinitas y al sistema de consumo de recursos innecesario.

**Why this priority**: Sin detección de timeout, las operaciones pueden quedar en `running` indefinidamente, bloqueando al usuario y generando registros inconsistentes. Es la base sobre la que se construyen cancelación y recuperación.

**Independent Test**: Se puede verificar creando una operación con un timeout bajo, esperando a que expire, y comprobando que el sistema la transiciona al estado `timed_out` con el motivo correspondiente.

**Acceptance Scenarios**:

1. **Given** una operación en estado `running` cuyo tipo tiene un timeout configurado de T minutos, **When** transcurren más de T minutos sin que la operación transite a un estado terminal, **Then** el sistema transiciona la operación a estado `timed_out` con timestamp y motivo "timeout exceeded".
2. **Given** una operación en estado `running` que completa exitosamente justo antes del timeout, **When** el timeout se evalúa, **Then** la operación permanece en estado `completed` y no se aplica ninguna acción de timeout.
3. **Given** un tipo de operación sin timeout configurado, **When** una operación de ese tipo permanece en `running`, **Then** se aplica un timeout global por defecto del sistema para evitar operaciones perpetuas.
4. **Given** una operación que acaba de transicionar a `timed_out`, **When** se consulta su detalle, **Then** el registro incluye el motivo de expiración, el timestamp de timeout y el tiempo transcurrido desde el inicio.

---

### User Story 2 — Cancelación de operaciones por el actor solicitante (Priority: P1)

Un actor autorizado puede solicitar la cancelación de una operación que se encuentra en un estado cancelable (`pending` o `running`). El sistema procesa la solicitud de cancelación y transiciona la operación al estado `cancelled`, deteniendo la ejecución en curso si es posible.

**Why this priority**: La cancelación es una capacidad esencial para que el usuario mantenga control sobre procesos largos. Sin ella, el usuario queda atrapado esperando a que una operación que ya no desea termine o falle.

**Independent Test**: Se puede verificar creando una operación en estado `pending` o `running`, solicitando su cancelación, y comprobando que transiciona a `cancelled` con los metadatos correspondientes.

**Acceptance Scenarios**:

1. **Given** una operación en estado `pending`, **When** el actor que la creó solicita su cancelación, **Then** la operación transiciona a `cancelled` con timestamp de cancelación y actor_id del solicitante.
2. **Given** una operación en estado `running`, **When** el actor autorizado solicita su cancelación, **Then** el sistema marca la operación como `cancelling` (estado transitorio que indica cancelación en curso) y, una vez confirmada la detención, transiciona a `cancelled`.
3. **Given** una operación en estado `completed`, `failed`, `timed_out` o `cancelled`, **When** se solicita su cancelación, **Then** el sistema rechaza la solicitud con error descriptivo indicando que la operación ya se encuentra en estado terminal.
4. **Given** una operación en estado `running` de tenant A, **When** un actor de tenant B solicita cancelarla, **Then** la solicitud es rechazada (aislamiento multi-tenant).
5. **Given** una operación en estado `running` de cualquier tenant, **When** el superadmin solicita cancelarla, **Then** la cancelación se procesa con el superadmin registrado como actor de la acción.

---

### User Story 3 — Detección y recuperación de operaciones huérfanas (Priority: P1)

El sistema detecta periódicamente operaciones que han quedado en estados no terminales (`pending`, `running`, `cancelling`) sin progreso durante un período superior al umbral de recuperación, y ejecuta acciones de recuperación configuradas para cada tipo de operación.

**Why this priority**: Sin recuperación automática, las operaciones huérfanas (causadas por crashes, reinicios de nodos o fallos de infraestructura) se acumulan y requieren intervención manual ad-hoc, degradando la confianza del usuario y la operabilidad de la plataforma.

**Independent Test**: Se puede verificar creando una operación en `running`, simulando un escenario donde el procesador deja de actualizarla, y comprobando que el mecanismo de detección la identifica y ejecuta la acción de recuperación configurada.

**Acceptance Scenarios**:

1. **Given** una operación en estado `running` sin actualización durante más del umbral de recuperación (configurable por tipo de operación), **When** el proceso de detección de huérfanos se ejecuta, **Then** la operación se marca como candidata a recuperación y se ejecuta la acción configurada (transicionar a `failed` con motivo "orphaned — no progress detected").
2. **Given** una operación en estado `pending` sin transicionar a `running` durante más del umbral de inactividad, **When** el proceso de detección se ejecuta, **Then** la operación transiciona a `failed` con motivo "stale — never started".
3. **Given** una operación en estado `cancelling` que no completa la cancelación dentro del umbral, **When** el proceso de detección se ejecuta, **Then** la operación se fuerza a estado `cancelled` con motivo "cancellation forced — timeout".
4. **Given** una operación detectada como huérfana, **When** se aplica la acción de recuperación, **Then** se genera un evento auditable con operation_id, estado anterior, acción de recuperación aplicada, tenant_id y timestamp.

---

### User Story 4 — Configuración de políticas de timeout y recuperación por tipo de operación (Priority: P2)

Los administradores de la plataforma pueden configurar políticas de timeout y recuperación diferenciadas por tipo de operación, permitiendo que operaciones complejas (que legítimamente tardan más) tengan umbrales distintos a operaciones simples.

**Why this priority**: Las políticas diferenciadas optimizan el comportamiento del sistema para distintos tipos de aprovisionamiento, pero el sistema puede operar con valores por defecto globales mientras esta capacidad se entrega.

**Independent Test**: Se puede verificar configurando un timeout distinto para dos tipos de operación y comprobando que cada uno respeta su política independiente.

**Acceptance Scenarios**:

1. **Given** una configuración de políticas donde `create-workspace` tiene timeout de 10 minutos y `enable-service` tiene timeout de 5 minutos, **When** cada tipo de operación excede su respectivo umbral, **Then** cada una es tratada según su política específica.
2. **Given** un tipo de operación sin política específica configurada, **When** una operación de ese tipo excede el timeout, **Then** se aplica la política por defecto global del sistema.
3. **Given** un superadmin modifica la política de timeout de un tipo de operación, **When** la nueva política se activa, **Then** solo afecta a operaciones creadas después del cambio; las operaciones en curso mantienen la política vigente en el momento de su creación.

---

### User Story 5 — Extensión del ciclo de vida de operaciones con nuevos estados (Priority: P1)

El ciclo de vida de operaciones definido en T01 se extiende con los estados `timed_out`, `cancelled` y `cancelling`, y las transiciones válidas asociadas, preservando compatibilidad con el modelo existente.

**Why this priority**: Los nuevos estados son prerequisito para que las historias de timeout (US1), cancelación (US2) y recuperación (US3) funcionen. Sin la extensión del ciclo de vida, no se pueden representar las nuevas situaciones.

**Independent Test**: Se puede verificar intentando transiciones válidas e inválidas con los nuevos estados y comprobando que el sistema acepta las primeras y rechaza las segundas.

**Acceptance Scenarios**:

1. **Given** el ciclo de vida existente (`pending` → `running` → `completed`|`failed`), **When** se extiende con los nuevos estados, **Then** las transiciones válidas adicionales son: `running` → `timed_out`, `pending` → `cancelled`, `running` → `cancelling`, `cancelling` → `cancelled`, y `cancelling` → `failed` (si la cancelación falla).
2. **Given** una operación en estado `timed_out` o `cancelled`, **When** se intenta cualquier transición, **Then** es rechazada (ambos son estados terminales).
3. **Given** una operación en estado `cancelling`, **When** se intenta transicionar a `running` o `completed`, **Then** la transición es rechazada (solo `cancelled` y `failed` son destinos válidos desde `cancelling`).
4. **Given** operaciones creadas antes de la extensión (sin los nuevos estados), **When** se consultan o transicionan, **Then** el modelo extendido es compatible: las transiciones originales siguen funcionando sin cambios.

---

### Edge Cases

- **Cancelación durante timeout**: si una operación alcanza el timeout mientras se está procesando una cancelación (`cancelling`), la política de cancelación tiene prioridad; la operación transiciona a `cancelled`, no a `timed_out`.
- **Timeout de una operación con reintento pendiente**: si una operación reintentada (via T03) entra en timeout durante el nuevo intento, el timeout se aplica al intento actual y la operación puede ser reintentada de nuevo (si no se excede el límite de reintentos).
- **Recuperación de operación que pertenece a tenant desactivado**: la acción de recuperación debe marcar la operación como `failed` con motivo "tenant deactivated" sin intentar continuar la ejecución.
- **Cancelación por un actor distinto al creador**: un workspace admin del mismo workspace puede cancelar la operación; un actor de un workspace distinto del mismo tenant no puede, salvo que tenga rol de tenant owner o superadmin.
- **Operación sin tipo reconocido al aplicar política de recuperación**: si el tipo de operación no tiene política específica ni existe una por defecto, la operación se transiciona a `failed` con motivo "no recovery policy available" y se genera una alerta para el superadmin.
- **Concurrencia entre timeout automático y completado exitoso**: si la operación completa exitosamente justo cuando el timeout se dispara, el sistema debe garantizar que la transición a `completed` prevalece si se registró primero; la transición a `timed_out` es rechazada por conflicto de estado.

## Requirements

### Functional Requirements

- **FR-001**: El sistema DEBE detectar automáticamente operaciones en estado `running` que han excedido su duración máxima configurada (timeout) y transicionarlas al estado `timed_out`.
- **FR-002**: Cada tipo de operación DEBE tener un timeout configurable. Si no se configura explícitamente, se aplica un timeout global por defecto del sistema.
- **FR-003**: La evaluación de timeout DEBE ser periódica y no depender de una solicitud del usuario ni de la actividad de la operación.
- **FR-004**: El sistema DEBE permitir a un actor autorizado solicitar la cancelación de una operación en estado `pending` o `running`.
- **FR-005**: Cuando se solicita la cancelación de una operación en estado `running`, el sistema DEBE transicionar primero a estado `cancelling` (transitorio) y posteriormente a `cancelled` una vez confirmada la detención.
- **FR-006**: Cuando se solicita la cancelación de una operación en estado `pending`, el sistema DEBE transicionarla directamente a `cancelled`.
- **FR-007**: El sistema DEBE rechazar solicitudes de cancelación de operaciones en estados terminales (`completed`, `failed`, `timed_out`, `cancelled`) con error descriptivo.
- **FR-008**: La cancelación DEBE respetar aislamiento multi-tenant: un actor solo puede cancelar operaciones de su propio tenant, salvo el superadmin que puede cancelar operaciones de cualquier tenant.
- **FR-009**: El sistema DEBE detectar periódicamente operaciones huérfanas — operaciones en estados no terminales (`pending`, `running`, `cancelling`) sin actividad durante más del umbral de recuperación — y ejecutar la acción de recuperación configurada.
- **FR-010**: La acción de recuperación por defecto para operaciones huérfanas DEBE ser transicionar a `failed` con un motivo descriptivo que indique la causa (orphaned, stale, cancellation forced).
- **FR-011**: El ciclo de vida de operaciones DEBE extenderse con los estados `timed_out`, `cancelling` y `cancelled`, preservando todas las transiciones existentes definidas en T01.
- **FR-012**: Los estados `timed_out` y `cancelled` DEBEN ser terminales (sin transiciones de salida).
- **FR-013**: El estado `cancelling` DEBE permitir transiciones únicamente a `cancelled` o `failed`.
- **FR-014**: Las transiciones a nuevos estados (`timed_out`, `cancelling`, `cancelled`) DEBEN generar eventos auditables que incluyan operation_id, estado anterior, estado nuevo, actor_id (o "system" si es automático), tenant_id y timestamp.
- **FR-015**: Cuando se configura una política de timeout o recuperación por tipo de operación, los cambios solo DEBEN afectar a operaciones creadas después del cambio; las operaciones en curso mantienen la política vigente en el momento de su creación.
- **FR-016**: En caso de conflicto de concurrencia entre una transición legítima (e.g. `completed`) y una transición automática (e.g. `timed_out`), el sistema DEBE dar prioridad a la transición que se registró primero y rechazar la segunda.
- **FR-017**: Cada operación afectada por timeout, cancelación o recuperación DEBE registrar en su detalle el motivo de la transición en un campo legible sin exponer datos sensibles.
- **FR-018**: El estado `cancelling` DEBE tener un umbral temporal configurable; si la cancelación no completa dentro de ese umbral, el proceso de recuperación DEBE forzar la transición a `cancelled`.

### Key Entities

- **Operation (extendida de T01/T03)**: El modelo de operación se extiende con los estados `timed_out`, `cancelling` y `cancelled` en su ciclo de vida. Se añade conceptualmente: timeout_policy aplicada al crear la operación, cancelled_by (actor que solicitó cancelación, nullable), cancellation_reason/timeout_reason.
- **Timeout Policy**: Configuración que define la duración máxima permitida para operaciones de un tipo determinado. Atributos: operation_type, max_duration, aplicada como snapshot al crear cada operación.
- **Recovery Policy**: Configuración que define el umbral de inactividad y la acción de recuperación para operaciones huérfanas de un tipo determinado. Atributos: operation_type, orphan_threshold, recovery_action.

## Success Criteria

### Measurable Outcomes

- **SC-001**: El 100% de las operaciones que exceden su timeout configurado son detectadas y transicionadas a `timed_out` dentro de un ciclo de evaluación razonable (no más de 2 ciclos de detección tras la expiración).
- **SC-002**: Los actores autorizados pueden solicitar la cancelación de operaciones en estados cancelables y recibir confirmación de cancelación en menos de 5 segundos desde la solicitud.
- **SC-003**: El 100% de las solicitudes de cancelación de operaciones en estados terminales son rechazadas con error descriptivo.
- **SC-004**: Las operaciones huérfanas son detectadas y recuperadas dentro de un intervalo razonable tras superar el umbral de inactividad (no más de 2 ciclos de detección).
- **SC-005**: Cada transición a nuevos estados (`timed_out`, `cancelling`, `cancelled`) genera un evento auditable verificable en el 100% de los casos.
- **SC-006**: El aislamiento multi-tenant se respeta en el 100% de las solicitudes de cancelación (verificado con pruebas de aislamiento).
- **SC-007**: Las operaciones existentes (creadas antes de la extensión del ciclo de vida) siguen funcionando sin cambios, verificable con pruebas de regresión sobre las transiciones de T01.

## Assumptions

- El modelo de operaciones de T01 (US-UIB-02-T01) está disponible con estados `pending`, `running`, `completed`, `failed` y sus transiciones.
- Los endpoints de consulta de progreso de T02 (US-UIB-02-T02) están disponibles para que el usuario pueda verificar el estado tras timeout, cancelación o recuperación.
- El mecanismo de reintentos idempotentes de T03 (US-UIB-02-T03) está disponible; una operación que haya sido `timed_out` puede ser reintentada si cumple las condiciones de T03 (estado `failed` equivalente para reintentos, o extensión de elegibilidad si se decide en diseño).
- El IAM (Keycloak) proporciona tenant_id, actor_id y roles verificados en cada solicitud, conforme a la dependencia US-UIB-01.
- El bus de eventos (Kafka) está disponible para publicar eventos auditables de timeout, cancelación y recuperación.
- El almacenamiento persistente (PostgreSQL) soporta actualizaciones concurrentes con resolución de conflictos para evitar races entre transiciones automáticas y manuales.
- Existe un mecanismo de ejecución periódica (cron, scheduler o similar) disponible en la plataforma para los procesos de detección de timeout y huérfanos; su configuración concreta se decidirá en diseño.
- La cancelación de una operación `running` implica una señal a la capa de ejecución para detener el procesamiento en curso; el mecanismo concreto de señalización depende de la arquitectura del motor de workflows y se definirá en diseño.

## Out of Scope

- **US-UIB-02-T01**: Modelo de job/operation status (ya entregado como dependencia).
- **US-UIB-02-T02**: Endpoints y UI de consulta de progreso (ya entregado como dependencia).
- **US-UIB-02-T03**: Reintentos idempotentes con deduplicación (ya entregado como dependencia).
- **US-UIB-02-T05**: Pruebas de reconexión de consola y relectura de estado de jobs en curso.
- **US-UIB-02-T06**: Documentación de semántica de reintento e intervención manual.
- **Compensación de pasos parciales**: la lógica de saga compensation cuando una operación se cancela a mitad de un workflow multi-step es responsabilidad del motor de sagas (specs 070/072).
- **UI/UX de cancelación y timeout en la consola**: los componentes visuales para que el usuario cancele o vea timeouts se construirán sobre los endpoints y el modelo aquí definidos, pero no son parte de esta tarea.
- **Notificaciones push o realtime**: notificar al usuario en tiempo real cuando una operación sufre timeout o es cancelada queda fuera de alcance.
