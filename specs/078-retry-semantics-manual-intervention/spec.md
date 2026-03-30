# Feature Specification: Semántica de Reintento y Casos de Intervención Manual

**Feature Branch**: `078-retry-semantics-manual-intervention`  
**Created**: 2026-03-30  
**Status**: Draft  
**Input**: User description: "Documentar semántica de reintento y casos donde se requiere intervención manual"

**Backlog Traceability**:
- Task ID: US-UIB-02-T06
- Epic: EP-16 — Backend funcional de la consola
- Historia: US-UIB-02 — Estado asíncrono, reintentos e idempotencia de aprovisionamientos administrativos
- RF cubiertos: RF-UIB-006, RF-UIB-007, RF-UIB-008
- Dependencias declaradas de la historia: US-UIB-01
- Dependencias dentro de la historia: US-UIB-02-T01 (modelo de operation status), US-UIB-02-T02 (endpoints de consulta de progreso), US-UIB-02-T03 (reintentos idempotentes con deduplicación), US-UIB-02-T04 (políticas de timeout, cancelación y recuperación), US-UIB-02-T05 (reconexión de consola y relectura de estado)

## Objetivo y Problema que Resuelve

Las tareas anteriores de US-UIB-02 han establecido el modelo de operaciones asíncronas (T01), endpoints de consulta de progreso (T02), reintentos idempotentes con deduplicación (T03), políticas de timeout/cancelación/recuperación (T04) y reconexión de consola con relectura de estado (T05). Sin embargo, la plataforma carece de una **semántica documentada y verificable** que defina:

1. **Clasificación de fallos según retryabilidad**: no existe una taxonomía que distinga qué tipos de fallos son transitorios (reintentar tiene sentido) y cuáles son permanentes (reintentar solo repetirá el fallo). Sin esta clasificación, los actores reintentan a ciegas y los sistemas automáticos no pueden tomar decisiones informadas.
2. **Criterios claros de intervención manual**: cuando una operación falla repetidamente o alcanza su límite de reintentos, no hay un protocolo definido que indique al usuario o al operador qué hacer: ¿escalar a soporte?, ¿modificar parámetros y crear una nueva operación?, ¿esperar a que una dependencia externa se recupere? La consola no ofrece orientación y el usuario queda sin guía.
3. **Señalización de estado "requiere intervención"**: el modelo de estados actual (pending, running, completed, failed, timed_out, cancelled) no distingue entre un fallo que el actor puede resolver por sí mismo reintentando y un fallo que requiere acción externa (soporte, corrección de datos, restauración de dependencia). Esta ambigüedad aumenta tickets de soporte y reduce la autonomía del usuario.

Esta tarea define la **semántica de reintento** como contrato verificable —clasificando fallos, documentando cuándo el reintento es seguro y cuándo no— y establece los **casos de intervención manual** como capacidad funcional visible para el actor, incluyendo la señalización en la consola, la información contextual necesaria para actuar y el flujo de escalación.

## Usuarios y Consumidores Afectados

| Actor | Tipo | Valor que recibe |
| ----- | ---- | ---------------- |
| Tenant Owner | Externo | Al enfrentarse a una operación fallida, recibe orientación clara sobre si puede reintentar por sí mismo o necesita escalar; reduce frustración y tiempo de resolución |
| Workspace Admin | Externo | Las operaciones sobre su workspace que fallan muestran información clasificada del fallo, evitando reintentos inútiles sobre errores permanentes |
| Superadmin | Interno | Dispone de un marco documentado para diagnosticar operaciones que requieren intervención, con contexto suficiente para actuar sin reconstruir el historial completo |
| Console Backend | Interno (sistema) | Puede etiquetar fallos con categoría de retryabilidad y emitir señales claras de "intervención requerida" para el frontend |
| Console Frontend | Interno (sistema) | Dispone de semántica definida para mostrar acciones diferenciadas según el tipo de fallo: botón de reintento vs. enlace a soporte vs. instrucciones de corrección |
| Motor de Workflows/Sagas | Interno (sistema) | Puede consumir la clasificación de fallos para decidir automáticamente entre reintentar un paso, compensar y abortar, o marcar la operación como pendiente de intervención humana |

## User Scenarios & Testing

### User Story 1 — Clasificación de fallos y orientación de acción al usuario (Priority: P1)

Cuando una operación de aprovisionamiento falla, el sistema clasifica el fallo según su retryabilidad y presenta al actor información diferenciada que le indica si puede reintentar la operación, si debe esperar y reintentar más tarde, o si necesita intervención manual (corrección de datos, contacto con soporte, resolución de una dependencia externa).

**Why this priority**: Es la capacidad fundamental que transforma la experiencia de un fallo opaco en una guía de acción. Sin clasificación, todas las demás funcionalidades (reintento, escalación) operan a ciegas.

**Independent Test**: Se puede verificar provocando fallos de distintas categorías (transitorio, permanente, requiere intervención) y comprobando que la consola muestra la clasificación correcta con las acciones apropiadas para cada caso.

**Acceptance Scenarios**:

1. **Given** una operación que falla por un error transitorio (p. ej. timeout de red contra un servicio downstream), **When** el actor consulta el detalle de la operación fallida, **Then** la operación muestra la categoría "transitorio" junto con una indicación de que el reintento es seguro, y la consola habilita el botón de reintento.
2. **Given** una operación que falla por un error permanente (p. ej. recurso solicitado ya existe con nombre conflictivo, cuota de tenant agotada, parámetros inválidos), **When** el actor consulta el detalle, **Then** la operación muestra la categoría "permanente" con una descripción del motivo, las acciones correctivas sugeridas (p. ej. "ajuste los parámetros" o "solicite ampliación de cuota"), y el botón de reintento está deshabilitado o acompañado de una advertencia clara de que reintentar no resolverá el problema.
3. **Given** una operación que falla por una causa que requiere intervención externa (p. ej. servicio downstream no disponible de forma prolongada, fallo de infraestructura, inconsistencia de datos que necesita corrección manual), **When** el actor consulta el detalle, **Then** la operación muestra la categoría "requiere intervención" con contexto diagnóstico (servicio afectado, último error conocido, timestamp), instrucciones de escalación y un enlace o mecanismo para contactar soporte o al administrador de la plataforma.
4. **Given** una operación cuyo fallo no puede ser clasificado automáticamente (error desconocido o no mapeado), **When** el actor consulta el detalle, **Then** la operación muestra la categoría "indeterminado" con una recomendación de no reintentar inmediatamente y escalar al superadmin, junto con el detalle técnico del error para facilitar el diagnóstico.

---

### User Story 2 — Señalización de "requiere intervención manual" en operaciones que agotan reintentos (Priority: P1)

Cuando una operación ha alcanzado el límite máximo de reintentos configurado (definido por T03) sin éxito, el sistema la marca con una señal explícita de "requiere intervención manual", diferenciándola de un fallo simple que aún admite reintentos. Esta señalización es visible en la consola y consultable por sistemas internos.

**Why this priority**: Sin esta señalización, las operaciones que agotan reintentos quedan en un limbo de `failed` indistinguible de un primer fallo. El actor no sabe que ya se intentó todo lo automático y que debe actuar de forma diferente.

**Independent Test**: Se puede verificar provocando que una operación falle repetidamente hasta agotar su límite de reintentos y comprobando que la consola la muestra con el indicador de intervención manual, diferente de un fallo con reintentos disponibles.

**Acceptance Scenarios**:

1. **Given** una operación en estado `failed` que ha alcanzado su límite máximo de reintentos, **When** el sistema detecta que no quedan reintentos disponibles, **Then** la operación se marca con el indicador "requiere intervención manual" y este indicador es visible en la vista de operaciones de la consola.
2. **Given** una operación marcada como "requiere intervención manual", **When** el actor la consulta, **Then** ve un resumen de los intentos previos (número de intentos, fechas, errores resumidos de cada intento) y las acciones recomendadas (contactar soporte, revisar dependencias, crear nueva operación con parámetros corregidos).
3. **Given** una operación marcada como "requiere intervención manual", **When** un superadmin la revisa, **Then** puede opcionalmente forzar un reintento extraordinario (bypass del límite) tras evaluar la situación, y este override queda registrado como evento auditable.
4. **Given** una operación marcada como "requiere intervención manual", **When** el actor intenta reintentar desde la consola de forma estándar, **Then** la consola bloquea el reintento y muestra un mensaje explicando que se requiere intervención manual, con las opciones disponibles (escalación, override por superadmin).

---

### User Story 3 — Documentación de semántica de reintento como contrato consultable (Priority: P2)

La plataforma expone la semántica de reintento como un contrato consultable que describe, para cada tipo de operación, cuáles son las categorías de fallo posibles, cuántos reintentos se permiten, qué estrategia de backoff se recomienda y bajo qué condiciones se requiere intervención manual. Este contrato es consumible tanto por actores humanos (vía consola) como por sistemas (vía API/configuración).

**Why this priority**: Completa la clasificación de P1 proporcionando la fuente de verdad consultable. Los actores y sistemas no solo reaccionan al fallo clasificado, sino que pueden anticipar la semántica antes de actuar.

**Independent Test**: Se puede verificar consultando el contrato de semántica de reintento para un tipo de operación dado y comprobando que describe las categorías de fallo, límites de reintentos e instrucciones de intervención.

**Acceptance Scenarios**:

1. **Given** un tipo de operación "create-workspace", **When** el actor o sistema consulta su semántica de reintento, **Then** obtiene: categorías de fallo posibles (transitorio, permanente, requiere intervención), número máximo de reintentos, backoff recomendado entre reintentos y condiciones explícitas que disparan intervención manual.
2. **Given** un tipo de operación sin semántica de reintento configurada explícitamente, **When** se consulta su semántica, **Then** se aplican los valores por defecto del sistema (máximo de reintentos global, clasificación de fallos genérica, instrucciones de escalación estándar).
3. **Given** un superadmin que necesita ajustar la semántica de reintento para un tipo de operación, **When** modifica la configuración de retryabilidad, **Then** los cambios se aplican a nuevas operaciones de ese tipo sin afectar operaciones en curso.

---

### User Story 4 — Notificación proactiva de operaciones que requieren intervención (Priority: P2)

Cuando una operación transiciona al estado de "requiere intervención manual", el sistema genera una notificación dirigida al actor solicitante y al superadmin responsable, de modo que la necesidad de intervención no depende de que alguien revise activamente la lista de operaciones.

**Why this priority**: La señalización pasiva (US2) es necesaria pero insuficiente si la operación queda sin atención; la notificación proactiva cierra el loop asegurando que alguien actúe.

**Independent Test**: Se puede verificar provocando que una operación alcance el estado de intervención manual y comprobando que se genera un evento de notificación con los destinatarios correctos.

**Acceptance Scenarios**:

1. **Given** una operación que transiciona a "requiere intervención manual", **When** el sistema detecta la transición, **Then** genera un evento de notificación dirigido al actor que inició la operación, incluyendo operation_id, tipo de operación, resumen del fallo y acciones sugeridas.
2. **Given** una operación de tenant A que requiere intervención manual, **When** se genera la notificación, **Then** el superadmin con responsabilidad sobre tenant A también recibe la notificación para visibilidad y posible acción.
3. **Given** múltiples operaciones del mismo actor que requieren intervención manual en un período breve, **When** se generan las notificaciones, **Then** el sistema las consolida en un resumen para evitar saturación de alertas.

---

### User Story 5 — Registro auditable del ciclo de vida de reintentos e intervenciones (Priority: P3)

Cada transición significativa en el ciclo de vida de reintentos —clasificación de fallo, marcado como intervención manual, override de superadmin, resolución— queda registrada como evento auditable, permitiendo reconstruir el historial completo para auditoría y mejora continua.

**Why this priority**: Es la capa de gobernanza que soporta trazabilidad y mejora del sistema, pero no bloquea la operativa de los actores.

**Independent Test**: Se puede verificar ejecutando un ciclo completo (fallo → reintentos → intervención manual → resolución) y consultando los eventos auditables generados.

**Acceptance Scenarios**:

1. **Given** una operación que falla y se clasifica como "transitorio", **When** se registra el fallo, **Then** se emite un evento auditable que incluye operation_id, tenant_id, categoría de fallo, error_code, y timestamp.
2. **Given** una operación marcada como "requiere intervención manual", **When** se aplica el marcado, **Then** se emite un evento auditable de tipo "manual_intervention_required" con operation_id, motivo, número de intentos realizados y actor_id original.
3. **Given** un superadmin que fuerza un reintento extraordinario sobre una operación con intervención manual, **When** se ejecuta el override, **Then** se emite un evento auditable de tipo "retry_override" con superadmin_id, operation_id, justificación y nuevo attempt_number.

### Edge Cases

- **Fallo con clasificación ambigua**: si un error del servicio downstream no mapea claramente a ninguna categoría (p. ej. código de error no documentado), el sistema lo clasifica como "indeterminado" y recomienda no reintentar sin diagnóstico previo.
- **Operación que falla con errores distintos en cada intento**: cada intento puede producir un error diferente (transitorio en el primer intento, permanente en el segundo). La clasificación visible se basa en el último fallo, pero el historial de errores de todos los intentos está disponible para diagnóstico.
- **Cambio de categoría de fallo entre reintentos**: si un fallo que era transitorio se convierte en permanente entre reintentos (p. ej. el recurso fue eliminado mientras se reintentaba), la clasificación se actualiza en la operación reflejando la causa más reciente.
- **Override de superadmin sobre operación ya resuelta**: si un superadmin intenta forzar reintento sobre una operación que ya fue resuelta por otro medio (p. ej. recreada manualmente), el sistema debe detectar el conflicto y advertir antes de proceder.
- **Múltiples superadmins actuando sobre la misma operación**: si dos superadmins intentan forzar override simultáneamente, solo uno debe proceder; el segundo recibe un error indicando que ya hay un reintento en curso.
- **Operación que requiere intervención pero el tenant fue desactivado**: la notificación al actor original puede no ser entregable; la notificación al superadmin se mantiene para que gestione la situación.
- **Backoff entre reintentos no respetado por el actor**: si el actor intenta reintentar antes del período de backoff recomendado, la consola muestra una advertencia con el tiempo restante sugerido, aunque no bloquea el reintento si el usuario insiste (la protección contra duplicados la proporciona la idempotency key de T03).

## Requirements

### Functional Requirements

- **FR-001**: El sistema DEBE clasificar cada fallo de operación en una de las siguientes categorías: `transient` (transitorio, reintentar es seguro), `permanent` (permanente, reintentar no resolverá el problema), `requires_intervention` (requiere acción humana externa) o `unknown` (no clasificable automáticamente).
- **FR-002**: La clasificación de fallo DEBE basarse en el código de error o condición reportada por el paso que falló, usando un mapeo configurable de códigos/condiciones a categorías.
- **FR-003**: La consola DEBE mostrar la clasificación de fallo junto con el detalle de la operación fallida, presentando acciones diferenciadas según la categoría: reintento habilitado para `transient`, acciones correctivas sugeridas para `permanent`, instrucciones de escalación para `requires_intervention`, y recomendación de no reintentar para `unknown`.
- **FR-004**: El sistema DEBE marcar una operación con el indicador "requiere intervención manual" cuando se agota su límite máximo de reintentos (definido por T03) sin alcanzar un estado terminal exitoso.
- **FR-005**: El indicador de "requiere intervención manual" DEBE ser visible en la vista de operaciones de la consola y consultable por API, como atributo distinto del estado `failed`.
- **FR-006**: La consola DEBE mostrar, para operaciones marcadas como "requiere intervención manual", un resumen del historial de intentos (número, fechas, errores por intento) y acciones recomendadas.
- **FR-007**: El sistema DEBE impedir reintentos estándar sobre operaciones marcadas como "requiere intervención manual" desde la consola de usuario regular.
- **FR-008**: Un superadmin DEBE poder forzar un reintento extraordinario (override del límite) sobre operaciones marcadas como "requiere intervención manual", con registro auditable obligatorio del override.
- **FR-009**: La semántica de reintento DEBE ser consultable por tipo de operación, exponiendo: categorías de fallo posibles, límite de reintentos, backoff recomendado y condiciones de intervención manual.
- **FR-010**: Tipos de operación sin semántica de reintento configurada explícitamente DEBEN heredar los valores por defecto del sistema.
- **FR-011**: El sistema DEBE generar un evento de notificación cuando una operación transiciona a "requiere intervención manual", dirigido al actor solicitante y al superadmin responsable del tenant.
- **FR-012**: Las notificaciones de intervención manual DEBEN consolidarse si múltiples operaciones del mismo actor requieren intervención en un período breve.
- **FR-013**: El sistema DEBE emitir eventos auditables para: clasificación de fallo, marcado de intervención manual, override de superadmin, y resolución de intervención.
- **FR-014**: El aislamiento multi-tenant DEBE respetarse en la clasificación de fallos, señalización de intervención y notificaciones: un actor solo accede a información de operaciones de sus tenants y workspaces autorizados.
- **FR-015**: La consola DEBE mostrar una advertencia de backoff recomendado cuando el actor intenta reintentar una operación transitoria antes del período sugerido, sin bloquear el reintento.

### Key Entities

- **Clasificación de fallo (failure classification)**: etiqueta asociada a cada fallo de operación que indica su categoría de retryabilidad (`transient`, `permanent`, `requires_intervention`, `unknown`). Atributos: categoría, error_code de origen, descripción humana, acciones sugeridas.
- **Indicador de intervención manual (manual intervention flag)**: atributo booleano o de estado en la operación que señala que se han agotado los reintentos automáticos y se requiere acción humana. Es ortogonal al estado `failed`: una operación `failed` puede o no tener este indicador.
- **Semántica de reintento por tipo de operación (retry semantics profile)**: configuración que define, para cada tipo de operación, las categorías de fallo esperadas, el límite de reintentos, el backoff recomendado y las condiciones de escalación a intervención manual. Incluye un perfil por defecto del sistema.
- **Override de reintento (retry override)**: acción extraordinaria del superadmin que permite forzar un reintento sobre una operación con intervención manual activada. Atributos: superadmin_id, operation_id, justificación, timestamp.
- **Evento de notificación de intervención**: señal emitida al actor y al superadmin cuando una operación requiere intervención manual. Atributos: operation_id, tenant_id, actor_id, resumen de fallo, acciones sugeridas.

## Success Criteria

### Measurable Outcomes

- **SC-001**: El 100% de las operaciones fallidas muestran una clasificación de fallo (`transient`, `permanent`, `requires_intervention` o `unknown`) con acciones diferenciadas visibles en la consola en menos de 3 segundos tras consultar el detalle.
- **SC-002**: El 100% de las operaciones que agotan su límite de reintentos se marcan con el indicador "requiere intervención manual", verificable mediante consulta a la API y en la interfaz de consola.
- **SC-003**: Los actores regulares no pueden ejecutar reintentos estándar sobre operaciones marcadas como "requiere intervención manual" en el 100% de los intentos (protección verificable).
- **SC-004**: El 100% de las transiciones a "requiere intervención manual" generan un evento de notificación dirigido a los destinatarios correctos (actor solicitante + superadmin del tenant).
- **SC-005**: El 100% de los overrides de superadmin sobre operaciones con intervención manual quedan registrados como eventos auditables con superadmin_id, operation_id y justificación.
- **SC-006**: La semántica de reintento es consultable para cada tipo de operación registrado, retornando categorías de fallo, límite de reintentos y condiciones de intervención en el 100% de los casos.

## Assumptions

- El modelo de operaciones de T01 está disponible con estados `pending`, `running`, `completed`, `failed`, `timed_out`, `cancelled` y soporta atributos adicionales (clasificación de fallo, indicador de intervención manual).
- El mecanismo de idempotency key y límite de reintentos de T03 está operativo y proporciona el conteo de intentos y el límite máximo como datos consultables.
- Las políticas de timeout y cancelación de T04 producen transiciones de estado que pueden ser clasificadas en las categorías de retryabilidad definidas aquí.
- La reconexión de consola de T05 muestra correctamente la clasificación de fallos y el indicador de intervención manual al relectura de estado.
- El IAM (Keycloak) proporciona tenant_id, actor_id y roles verificados en cada solicitud, conforme a US-UIB-01.
- El bus de eventos (Kafka) está disponible para publicar eventos auditables de clasificación, intervención y override.
- Los códigos de error de los servicios downstream son suficientemente descriptivos para permitir la clasificación automática en la mayoría de los casos; los errores no mapeados se clasifican como `unknown`.
- La definición de backoff recomendado entre reintentos es orientativa para el actor humano; el enforcement de backoff en sistemas automáticos queda fuera de alcance.

## Out of Scope

- **US-UIB-02-T01**: Modelo de job/operation status (ya entregado como dependencia).
- **US-UIB-02-T02**: Endpoints y UI de consulta de progreso (ya entregado como dependencia).
- **US-UIB-02-T03**: Reintentos idempotentes con deduplicación (ya entregado como dependencia; esta tarea consume su semántica pero no la redefine).
- **US-UIB-02-T04**: Políticas de timeout, cancelación y recuperación (ya entregado como dependencia).
- **US-UIB-02-T05**: Reconexión de consola y relectura de estado (ya entregado como dependencia).
- **Retry automático no supervisado**: la automatización completa de reintentos sin intervención humana (auto-healing) puede construirse sobre la semántica definida aquí pero no es parte del alcance.
- **Compensación de sagas**: la lógica de compensación de pasos parciales en workflows multi-step corresponde a specs 070/072.
- **UI de administración de perfiles de semántica de reintento**: la gestión visual de la configuración de semántica por tipo de operación puede ser una mejora futura; en esta tarea la configuración se gestiona a nivel de sistema.
