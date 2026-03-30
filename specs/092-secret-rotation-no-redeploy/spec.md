# Feature Specification: Rotación de Secretos sin Reinstalación Completa del Producto

**Feature Branch**: `092-secret-rotation-no-redeploy`  
**Created**: 2026-03-31  
**Status**: Draft  
**Input**: User description: "Permitir rotación de secretos sin reinstalación completa del producto"  
**Task ID**: US-SEC-02-T02  
**Epic**: EP-18 — Seguridad funcional transversal  
**Historia**: US-SEC-02 — Gestión segura de secretos, rotación, enforcement de scope y separación de privilegios  
**Dependencia directa**: US-SEC-02-T01 (Almacenamiento seguro de secretos — spec `091-secure-secret-storage`)  
**RF cubiertos**: RF-SEC-005, RF-SEC-006, RF-SEC-007, RF-SEC-010, RF-SEC-011

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Rotación manual de un secreto sin redespliegue (Priority: P1)

Como miembro del platform team o superadmin, necesito poder rotar (reemplazar el valor de) cualquier secreto del clúster desde la interfaz de gestión o línea de comandos, y que los servicios consumidores adopten el nuevo valor automáticamente sin necesidad de reinstalar, reiniciar manualmente o redesplegar ningún componente de la plataforma.

**Why this priority**: Este es el escenario central de la feature. Si los secretos no pueden rotarse sin redespliegue, la organización enfrenta ventanas de exposición prolongadas ante credenciales comprometidas y depende de ventanas de mantenimiento costosas para cada rotación.

**Independent Test**: Se puede verificar rotando un secreto (por ejemplo, la contraseña de una base de datos) y confirmando que los servicios consumidores comienzan a usar el nuevo valor dentro del período de gracia definido, sin intervención manual de despliegue ni interrupción del servicio.

**Acceptance Scenarios**:

1. **Given** un secreto activo consumido por uno o más servicios, **When** un operador autorizado ejecuta la rotación del secreto proporcionando un nuevo valor, **Then** el almacén registra la nueva versión como activa y la versión anterior entra en período de gracia.
2. **Given** un secreto recién rotado con período de gracia activo, **When** un servicio consumidor solicita el secreto, **Then** recibe la nueva versión activa.
3. **Given** un secreto rotado, **When** han transcurrido menos de 30 segundos desde la rotación, **Then** todos los servicios consumidores que mantenían la versión anterior en caché han adoptado la nueva versión sin reinicio ni redespliegue.
4. **Given** un secreto rotado, **When** un operador verifica el estado del servicio, **Then** ningún pod o instancia ha sido reiniciado, reconstruido ni redespliegado como consecuencia de la rotación.

---

### User Story 2 - Período de gracia dual durante la rotación (Priority: P1)

Como responsable de seguridad, necesito que durante la rotación de un secreto exista un período de gracia configurable en el que tanto la versión anterior como la nueva sean válidas simultáneamente, para evitar interrupciones de servicio en componentes que aún no hayan recogido el nuevo valor.

**Why this priority**: Sin período de gracia, la rotación causaría interrupciones transitorias en servicios distribuidos que no pueden adoptar instantáneamente el nuevo secreto, lo que haría la rotación operativamente inviable.

**Independent Test**: Se puede verificar rotando un secreto y durante el período de gracia confirmando que tanto la versión antigua como la nueva son aceptadas por los servicios dependientes; y que tras expirar el período de gracia, solo la nueva versión es válida.

**Acceptance Scenarios**:

1. **Given** un secreto con período de gracia configurado en N minutos, **When** se rota el secreto, **Then** durante los siguientes N minutos ambas versiones (anterior y nueva) son válidas para autenticación/consumo.
2. **Given** un secreto en período de gracia activo, **When** un servicio presenta la versión anterior del secreto, **Then** la operación es aceptada y se genera un aviso (no error) en auditoría indicando uso de versión en deprecación.
3. **Given** un secreto cuyo período de gracia ha expirado, **When** un servicio presenta la versión anterior, **Then** la operación es rechazada y se registra un evento de auditoría con resultado denegado.
4. **Given** un operador que configura el período de gracia, **When** establece un valor fuera de los límites permitidos (e.g., 0 o superior al máximo de la plataforma), **Then** el sistema rechaza la configuración con un mensaje de error claro.

---

### User Story 3 - Propagación automática del nuevo secreto a servicios consumidores (Priority: P1)

Como miembro del platform team, necesito que cuando un secreto se rote, los servicios consumidores reciban automáticamente la nueva versión sin intervención manual, ya sea mediante notificación push, polling periódico o un mecanismo de invalidación de caché, para que la rotación sea efectiva de extremo a extremo.

**Why this priority**: La rotación en el almacén no tiene valor si los consumidores no recogen el nuevo valor. Este es el mecanismo que cierra el ciclo de rotación sin redespliegue.

**Independent Test**: Se puede verificar monitorizando que tras la rotación, cada servicio consumidor realiza una recarga del secreto dentro del intervalo esperado, y que las conexiones subsiguientes usan el nuevo valor.

**Acceptance Scenarios**:

1. **Given** un secreto rotado en el almacén, **When** el mecanismo de propagación se activa, **Then** cada servicio registrado como consumidor de ese secreto recibe una señal para recargar la credencial.
2. **Given** un servicio consumidor que recibe la señal de recarga, **When** solicita el secreto al almacén, **Then** obtiene la nueva versión activa y la aplica a sus conexiones sin reiniciarse.
3. **Given** un servicio consumidor que no responde a la señal de recarga dentro del timeout configurado, **When** se supera el timeout, **Then** se genera una alerta operativa y un evento de auditoría indicando el servicio que no completó la recarga.

---

### User Story 4 - Auditoría completa del ciclo de rotación (Priority: P2)

Como superadmin, necesito que cada rotación de secreto genere un registro de auditoría detallado que incluya: quién inició la rotación, cuándo, sobre qué secreto (sin valor), el inicio y fin del período de gracia, y la confirmación de que todos los consumidores adoptaron la nueva versión, para trazabilidad y cumplimiento.

**Why this priority**: La auditoría es esencial para cumplimiento y para diagnosticar problemas post-rotación, pero su valor depende de que la rotación funcione correctamente.

**Independent Test**: Se puede verificar ejecutando una rotación y consultando el registro de auditoría para confirmar la presencia de todos los eventos del ciclo completo.

**Acceptance Scenarios**:

1. **Given** una rotación iniciada por un operador autorizado, **When** la rotación se completa, **Then** el registro de auditoría contiene eventos para: inicio de rotación, activación de período de gracia, confirmación de propagación a cada consumidor, y expiración del período de gracia.
2. **Given** una rotación en la que un consumidor no recargó el secreto a tiempo, **When** se consulta la auditoría, **Then** aparece un evento de alerta específico para ese consumidor con el timestamp del timeout.
3. **Given** un evento de auditoría de rotación, **When** se inspecciona, **Then** nunca contiene el valor anterior ni el nuevo del secreto.

---

### User Story 5 - Revocación inmediata de una versión de secreto (Priority: P2)

Como responsable de seguridad, ante un incidente de compromiso de credenciales, necesito poder revocar inmediatamente una versión específica de un secreto (eliminando el período de gracia si existe) para que deje de ser válida de forma instantánea, aceptando la posible interrupción temporal de servicios como trade-off de seguridad.

**Why this priority**: La revocación inmediata es crítica para respuesta a incidentes, pero es un escenario excepcional frente a la rotación normal con gracia.

**Independent Test**: Se puede verificar revocando una versión de secreto y confirmando que cualquier intento de uso de esa versión falla inmediatamente, incluso si estaba dentro del período de gracia.

**Acceptance Scenarios**:

1. **Given** un secreto con período de gracia activo (versión antigua aún válida), **When** un operador ejecuta revocación inmediata de la versión antigua, **Then** la versión antigua deja de ser válida instantáneamente, sin esperar al fin del período de gracia.
2. **Given** una versión de secreto revocada, **When** un servicio intenta autenticarse con esa versión, **Then** la operación es rechazada y se registra un evento de auditoría con motivo "versión revocada".
3. **Given** una revocación inmediata, **When** se consulta la auditoría, **Then** aparece un evento de revocación de emergencia con la identidad del operador y la justificación proporcionada.

---

### User Story 6 - Historial de versiones de secreto (Priority: P3)

Como miembro del platform team, necesito poder consultar el historial de versiones de un secreto (sin ver los valores), incluyendo fechas de creación, rotación, períodos de gracia y revocaciones, para entender el ciclo de vida de cada credencial.

**Why this priority**: La visibilidad del historial mejora la operativa pero no es bloqueante para la rotación funcional.

**Independent Test**: Se puede verificar consultando el historial de un secreto que ha sido rotado múltiples veces y confirmando que cada versión aparece con sus metadatos completos.

**Acceptance Scenarios**:

1. **Given** un secreto que ha sido rotado 3 veces, **When** un operador consulta su historial, **Then** ve 4 entradas (original + 3 rotaciones) con fechas de activación, expiración de gracia y estado (activa/expirada/revocada) para cada versión.
2. **Given** el historial de un secreto, **When** se inspeccionan los registros, **Then** ninguno contiene el valor del secreto en ninguna versión.

---

### Edge Cases

- ¿Qué ocurre si se intenta rotar un secreto que ya está en período de gracia (rotación encadenada)? El sistema debe completar la rotación anterior (invalidando la versión más antigua inmediatamente) antes de iniciar la nueva rotación, evitando que coexistan más de dos versiones simultáneamente.
- ¿Qué ocurre si el almacén de secretos pierde conectividad durante una rotación? La rotación debe ser atómica: o se completa (nueva versión activa + gracia para la anterior) o no se aplica ningún cambio; el sistema reporta el fallo y el operador debe reintentar.
- ¿Qué ocurre si un servicio consumidor está caído durante la propagación? La señal de recarga queda pendiente; cuando el servicio vuelva, debe recoger el secreto vigente. La alerta de timeout se genera igualmente para visibilidad operativa.
- ¿Qué ocurre si se revoca la única versión activa de un secreto? El sistema debe advertir que la revocación dejará a los consumidores sin credencial válida y requerir confirmación explícita del operador. Los servicios afectados fallarán de forma segura (fail-closed).
- ¿Qué ocurre si la rotación afecta a un secreto compartido entre múltiples dominios funcionales? La propagación y el período de gracia se aplican a todos los dominios consumidores; la auditoría refleja cada dominio afectado individualmente.
- ¿Qué ocurre si el período de gracia expira y hay consumidores que no recogieron el nuevo valor? Se genera una alerta crítica; los consumidores que presenten la versión expirada son rechazados (fail-closed); el operador debe intervenir manualmente para diagnosticar y remediar.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE permitir rotar cualquier secreto gestionado por el almacén centralizado, reemplazando su valor por uno nuevo, sin requerir reinstalación, reinicio manual ni redespliegue de ningún componente de la plataforma.
- **FR-002**: El sistema DEBE versionar los secretos, manteniendo al menos la versión activa actual y la versión inmediatamente anterior durante el período de gracia.
- **FR-003**: El sistema DEBE soportar un período de gracia configurable por secreto (con valores mínimo y máximo definidos por la plataforma) durante el cual tanto la versión nueva como la anterior del secreto son válidas simultáneamente.
- **FR-004**: El sistema DEBE invalidar automáticamente la versión anterior de un secreto al expirar su período de gracia.
- **FR-005**: El sistema DEBE propagar la nueva versión del secreto a todos los servicios consumidores registrados de forma automática, sin intervención manual del operador.
- **FR-006**: Los servicios consumidores DEBEN recargar el nuevo valor del secreto y aplicarlo a sus conexiones sin necesidad de reinicio ni redespliegue.
- **FR-007**: El sistema DEBE generar una alerta operativa cuando un servicio consumidor no confirme la recarga del nuevo secreto dentro del timeout configurado.
- **FR-008**: El sistema DEBE permitir la revocación inmediata de una versión específica de un secreto, anulando el período de gracia restante.
- **FR-009**: El sistema DEBE impedir que coexistan más de dos versiones válidas de un mismo secreto simultáneamente. Una rotación encadenada invalida inmediatamente la versión más antigua.
- **FR-010**: La rotación de un secreto DEBE ser atómica: o se completa exitosamente (nueva versión activa + gracia para anterior) o no se aplica ningún cambio.
- **FR-011**: El sistema DEBE registrar un evento de auditoría por cada operación del ciclo de rotación (inicio, activación de gracia, propagación confirmada por consumidor, expiración de gracia, revocación) sin incluir valores de secretos en los registros.
- **FR-012**: El sistema DEBE registrar un evento de auditoría cuando un servicio presente una versión en período de gracia (advertencia) o una versión expirada/revocada (denegación).
- **FR-013**: El sistema DEBE proporcionar un historial de versiones por secreto con metadatos (fecha de activación, fecha de expiración de gracia, estado, identidad del rotador) sin exponer valores.
- **FR-014**: El sistema DEBE requerir confirmación explícita del operador cuando una revocación deje a consumidores sin versión válida del secreto.
- **FR-015**: El sistema DEBE respetar el aislamiento multi-tenant y por dominio funcional durante la rotación: la rotación de un secreto de un tenant o dominio no debe afectar a secretos de otros tenants o dominios.
- **FR-016**: Solo operadores con el rol y permisos adecuados (platform team, superadmin, o tenant owner según el dominio del secreto) DEBEN poder iniciar rotaciones o revocaciones.

### Key Entities

- **SecretVersion**: Versión individual de un secreto, con: identificador de versión, referencia al secreto padre, estado (activa, en-gracia, expirada, revocada), fecha de activación, fecha de expiración de gracia, identidad del operador que la creó.
- **RotationEvent**: Registro del ciclo completo de una rotación, con: secreto afectado, versión anterior, versión nueva, período de gracia configurado, estado de propagación a consumidores, timestamps de cada fase.
- **SecretConsumer**: Registro de un servicio que consume un secreto específico, con: identificador del servicio, secreto consumido, estado de recarga (pendiente, confirmada, timeout), timestamp de última recarga exitosa.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un operador puede completar la rotación de cualquier secreto del clúster en menos de 2 minutos desde la interfaz de gestión, sin tocar pipelines de despliegue ni reiniciar servicios.
- **SC-002**: El 100% de los servicios consumidores adoptan el nuevo secreto dentro de los 60 segundos posteriores a la rotación, sin intervención manual.
- **SC-003**: Durante el período de gracia, cero interrupciones de servicio se producen como consecuencia de la rotación (disponibilidad ≥ 99.9% durante la ventana de rotación).
- **SC-004**: El registro de auditoría captura el 100% de los eventos del ciclo de rotación con toda la información requerida (sin valores de secretos) y es consultable en menos de 5 segundos.
- **SC-005**: La revocación inmediata de una versión comprometida se efectúa en menos de 10 segundos desde la acción del operador hasta la invalidación efectiva.
- **SC-006**: Las rotaciones operan correctamente con aislamiento total entre tenants y entre dominios funcionales, sin fugas de credenciales entre contextos.

## Assumptions

- El almacén seguro centralizado de secretos (US-SEC-02-T01 / spec `091-secure-secret-storage`) ya está implementado y operativo, incluyendo la segregación por dominio funcional, cifrado, auditoría básica y el inventario de metadatos.
- Los servicios de la plataforma (APISIX, Keycloak, Kafka, PostgreSQL, MongoDB, OpenWhisk, almacenamiento S3-compatible) soportan o pueden adaptarse para recargar credenciales dinámicamente sin reinicio.
- La consola administrativa (React + Tailwind + shadcn/ui) proporciona la interfaz para que los operadores ejecuten rotaciones, pero los detalles de UX están fuera del alcance de esta especificación.
- Los valores mínimo y máximo del período de gracia se definirán como configuración de la plataforma; valores razonables por defecto serían 5 minutos mínimo y 24 horas máximo.
- El mecanismo de propagación (push vs. polling) es una decisión de implementación; esta especificación define el comportamiento esperado sin prescribir la técnica.
