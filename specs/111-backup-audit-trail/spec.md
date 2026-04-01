# Especificación — US-BKP-01-T03: Auditoría completa de acciones de recuperación

| Campo               | Valor                                                                 |
|---------------------|-----------------------------------------------------------------------|
| **Task ID**         | US-BKP-01-T03                                                         |
| **Epic**            | EP-20 — Backup, recuperación y continuidad operativa                  |
| **Historia**        | US-BKP-01 — Estado de backup/restore y flujos administrativos de recuperación |
| **Tipo**            | Feature                                                               |
| **Prioridad**       | P1                                                                    |
| **Tamaño**          | M                                                                     |
| **RFs cubiertos**   | RF-BKP-001, RF-BKP-002, RF-BKP-005                                   |
| **Dependencias**    | US-OBS-01, US-DEP-03, US-BKP-01-T01 (visibilidad de estado), US-BKP-01-T02 (endpoints administrativos) |

---

## 1. Objetivo y problema que resuelve

### Problema

Tras US-BKP-01-T02, la plataforma permite a actores autorizados iniciar backups bajo demanda y solicitar restauraciones de componentes gestionados. Cada operación genera un registro básico (identificador, actor, timestamps, estado), pero **no existe un mecanismo de auditoría completo que permita responder con certeza a las preguntas que surgen en un incidente, en una auditoría de cumplimiento o en una revisión de seguridad**:

1. **¿Quién inició la restauración, desde dónde y con qué contexto de sesión?** El registro básico de operación contiene el identificador del actor, pero no la dirección IP de origen, el user-agent, el identificador de sesión ni la cadena de autorización que lo habilitó.
2. **¿Qué ocurrió exactamente durante la operación?** Las transiciones de estado (`accepted` → `in_progress` → `completed`/`failed`) se registran en la entidad de operación, pero no se emiten como eventos inmutables e independientes consultables fuera del ciclo de vida de la operación.
3. **¿Es posible reconstruir la secuencia completa de acciones de recuperación en un periodo?** Sin un log de auditoría dedicado, la reconstrucción requiere cruzar registros de operaciones, logs de aplicación y trazas del adaptador, un proceso manual, frágil y no apto para auditoría formal.
4. **¿Se pueden detectar patrones anómalos?** Sin eventos de auditoría estandarizados, no es posible configurar alertas sobre frecuencia inusual de restores, operaciones fuera de horario o actores no habituales ejecutando acciones destructivas.

### Objetivo de esta tarea

Registrar un trail de auditoría completo, inmutable y consultable para toda acción de backup o restauración iniciada desde la plataforma. Cada evento de auditoría enriquece el registro básico de operación (US-BKP-01-T02) con el contexto de sesión, la cadena de autorización, los metadatos de origen y las transiciones de estado, y lo publica en el pipeline de auditoría estándar de la plataforma (US-OBS-01).

El resultado es que operaciones, superadmin, seguridad y cumplimiento pueden reconstruir cualquier acción de recuperación con nivel de detalle suficiente para auditoría formal, investigación de incidentes y detección de anomalías, sin salir de la plataforma.

---

## 2. Usuarios y valor recibido

| Actor | Relación con la capacidad | Valor que recibe |
|---|---|---|
| **SRE / Platform team** | Ejecutor y revisor de operaciones de backup/restore | Puede revisar quién hizo qué, cuándo y desde dónde ante cualquier incidente de recuperación. Dispone de un log inmutable para postmortems. |
| **Superadmin** | Administrador global responsable de la gobernanza | Puede verificar que las operaciones de recuperación cumplen las políticas internas sin depender de logs de infraestructura externa. |
| **Equipo de seguridad** | Revisor de actividad privilegiada | Puede detectar patrones anómalos (restores fuera de horario, frecuencia inusual, actores inesperados) y alimentar sistemas de alertas o SIEM con eventos estandarizados. |
| **Equipo de cumplimiento / auditoría** | Verificador de controles | Dispone de un trail de auditoría consultable que demuestra que las acciones de recuperación son trazables, autorizadas y registradas conforme a los controles requeridos. |
| **Tenant owner** | Consumidor afectado por las restauraciones | Puede consultar un historial resumido de las acciones de recuperación realizadas sobre los recursos de su tenant (sin detalles de infraestructura). |

---

## 3. Escenarios principales, edge cases y reglas de negocio

### 3.1 Escenarios principales

**E1 — Se registra auditoría al iniciar un backup bajo demanda**

> Un superadmin inicia un backup bajo demanda de un componente de un tenant a través de la API o la consola (flujo de US-BKP-01-T02). Al aceptarse la solicitud, la plataforma emite un evento de auditoría de tipo `backup.requested` que incluye: identificador de operación, tipo de acción (`backup`), `tenant_id`, componente-instancia, actor solicitante, dirección IP de origen, user-agent, identificador de sesión y timestamp. El evento se publica en el pipeline de auditoría estándar (US-OBS-01).

**E2 — Se registra auditoría en cada transición de estado de una operación de restore**

> Un SRE solicita la restauración de un componente a un snapshot previo. La plataforma emite un evento `restore.requested` al aceptar la solicitud. Cuando la operación pasa a `in_progress`, emite `restore.started`. Cuando finaliza, emite `restore.completed` o `restore.failed` con el motivo del resultado. Cada evento contiene el identificador de operación, permitiendo reconstruir la secuencia completa.

**E3 — Superadmin consulta el historial de auditoría de acciones de recuperación**

> El superadmin accede a la sección de auditoría de backup/restore en la consola administrativa. Ve un listado cronológico de eventos de auditoría filtrable por tenant, por tipo de acción (backup/restore), por actor, por rango temporal y por resultado. Cada entrada muestra: timestamp, tipo de acción, actor, tenant, componente, resultado y un enlace al detalle del evento.

**E4 — Equipo de seguridad exporta eventos de auditoría a un SIEM externo**

> El equipo de seguridad configura un consumidor del pipeline de auditoría (Kafka topic, webhook o integración) para recibir los eventos de tipo `backup.*` y `restore.*`. Los eventos llegan en un formato JSON estandarizado y documentado, compatible con la ingesta del SIEM corporativo.

**E5 — Tenant owner consulta el historial de acciones de recuperación de su tenant**

> El tenant owner accede a su consola y ve un historial resumido de las acciones de backup/restore ejecutadas sobre los componentes de su tenant. Ve: fecha, tipo de acción y resultado. No ve la dirección IP del actor, el identificador de sesión ni los detalles técnicos del componente.

**E6 — Consulta de auditoría vía API**

> Un sistema de automatización o un auditor consulta el historial de eventos de backup/restore mediante un endpoint API REST dedicado. Puede filtrar por `tenant_id`, tipo de acción, rango temporal, actor y resultado. La respuesta es paginada.

### 3.2 Edge cases

| Caso | Comportamiento esperado |
|---|---|
| La emisión del evento de auditoría falla (pipeline de US-OBS-01 no disponible) | La operación de backup/restore **no se bloquea** por un fallo de auditoría, pero se registra un evento compensatorio en un log local de fallback. Se genera una alerta operacional indicando que hay eventos de auditoría pendientes de publicación. |
| Operación de backup/restore rechazada antes de aceptarse (permisos insuficientes, componente no soportado) | Se emite un evento de auditoría de tipo `backup.rejected` o `restore.rejected` con el motivo del rechazo. Los intentos rechazados son trazables. |
| Actor desconocido o sesión expirada durante la solicitud | Si la autenticación es válida pero la sesión original ha expirado entre la validación y la emisión del evento, se registra con el contexto disponible y se marca como `session_context_partial`. |
| Múltiples transiciones de estado rápidas (la operación pasa de `accepted` a `completed` en milisegundos) | Cada transición genera su propio evento de auditoría con su timestamp preciso. No se agrupan ni se omiten transiciones intermedias. |
| Volumen alto de operaciones de backup automatizadas | Los eventos de auditoría se emiten para todas las operaciones, incluidas las automatizadas. El pipeline debe soportar el volumen. Si se detecta presión, se aplica buffering, nunca descarte. |
| Evento de auditoría con payload que excede el tamaño máximo del pipeline | Se trunca el campo de detalle opcional, manteniendo los campos obligatorios intactos. Se marca el evento como `detail_truncated`. |
| Consulta de auditoría con rango temporal muy amplio | La API pagina los resultados. No devuelve datasets ilimitados. Puede imponer un límite máximo de rango configurable para evitar queries destructivas. |

### 3.3 Reglas de negocio y gobierno

**RN-01 — Todo evento de auditoría es inmutable una vez emitido**
Los eventos de auditoría no se editan, actualizan ni eliminan. Son append-only. La corrección de un evento erróneo se realiza emitiendo un evento compensatorio, nunca modificando el original.

**RN-02 — El fallo de auditoría no bloquea la operación, pero se compensa**
Si el pipeline de auditoría no está disponible, la operación de backup/restore continúa. El evento se almacena en un log local de fallback y se reintenta la publicación. Se genera una alerta operacional para que el equipo de plataforma actúe.

**RN-03 — Los eventos de auditoría cubren todo el ciclo de vida de la operación**
Cada operación de backup/restore genera al menos dos eventos: uno al solicitarse (o rechazarse) y otro al completarse (o fallar). Las transiciones intermedias también generan eventos.

**RN-04 — Los intentos rechazados también se auditan**
Una solicitud de backup o restore que es rechazada por permisos insuficientes, componente no soportado u otra causa genera un evento de auditoría de rechazo. No queda invisible.

**RN-05 — El contexto de sesión enriquece el evento, no lo sustituye**
El evento de auditoría contiene tanto la identidad del actor (del token JWT) como el contexto de sesión (IP, user-agent, session ID). Si el contexto de sesión no está disponible (p. ej., solicitud de servicio automatizado), los campos de contexto se marcan como `not_applicable` pero el evento se emite igualmente.

**RN-06 — La retención de eventos de auditoría sigue la política del pipeline de US-OBS-01**
Esta tarea no define una política de retención propia. Los eventos se publican en el pipeline estándar y heredan su política de retención. Si se requiere una retención diferenciada para eventos de backup/restore, se gestionará como configuración del pipeline, no como lógica de esta tarea.

**RN-07 — El tenant owner ve un subconjunto del evento de auditoría**
El tenant owner puede consultar eventos de auditoría de su propio tenant, pero solo ve los campos funcionales (fecha, tipo de acción, resultado). No ve IP de origen, identificador de sesión, nombre técnico del componente ni detalles internos.

---

## 4. Requisitos funcionales y límites de alcance

### 4.1 Requisitos funcionales verificables

**RF-T03-01 — Modelo de evento de auditoría de backup/restore**
Debe existir un modelo de datos para el evento de auditoría de acciones de backup/restore. Como mínimo debe incluir: identificador único del evento, identificador de la operación asociada (de US-BKP-01-T02), tipo de evento (`backup.requested`, `backup.started`, `backup.completed`, `backup.failed`, `backup.rejected`, `restore.requested`, `restore.started`, `restore.completed`, `restore.failed`, `restore.rejected`), `tenant_id`, identificador del componente-instancia, actor solicitante (user ID del JWT), dirección IP de origen, user-agent, identificador de sesión, timestamp del evento (UTC ISO 8601), resultado o motivo (si aplica) y detalle textual opcional.

**RF-T03-02 — Emisión de eventos de auditoría en solicitud de operación**
Al aceptarse o rechazarse una solicitud de backup o restore (endpoints de US-BKP-01-T02), el sistema debe emitir un evento de auditoría correspondiente (`*.requested` o `*.rejected`) con todos los campos del modelo. El evento se publica en el pipeline de auditoría de US-OBS-01.

**RF-T03-03 — Emisión de eventos de auditoría en transiciones de estado**
En cada transición de estado de una operación de backup/restore (`accepted` → `in_progress` → `completed`/`failed`), el sistema debe emitir un evento de auditoría correspondiente (`*.started`, `*.completed`, `*.failed`). Cada evento contiene el identificador de operación para correlación.

**RF-T03-04 — Mecanismo de fallback ante fallo del pipeline de auditoría**
Si la publicación del evento en el pipeline de US-OBS-01 falla, el sistema debe almacenar el evento en un log local de fallback (fichero o tabla dedicada), reintentar la publicación con backoff exponencial y generar una alerta operacional (evento o métrica) indicando que hay eventos de auditoría pendientes.

**RF-T03-05 — Endpoint API de consulta de historial de auditoría de backup/restore**
Debe existir un endpoint REST que permita consultar los eventos de auditoría de backup/restore. Debe soportar filtros por: `tenant_id`, tipo de evento, actor, rango temporal (desde/hasta) y resultado. La respuesta debe ser paginada. El acceso está restringido a SRE, superadmin y, con vista reducida, al tenant owner sobre su propio tenant.

**RF-T03-06 — Vista de historial de auditoría en consola administrativa**
La consola administrativa debe incluir una vista de historial de auditoría de acciones de backup/restore, con filtros por tenant, tipo de acción, actor, rango temporal y resultado. Cada entrada permite expandir el detalle del evento (IP, user-agent, sesión, motivo).

**RF-T03-07 — Vista resumida de historial en consola del tenant**
La consola del tenant debe incluir un historial resumido de las acciones de backup/restore ejecutadas sobre los componentes del tenant. El tenant owner ve: fecha, tipo de acción y resultado. No ve campos de contexto de sesión, IP ni identificadores técnicos de componente.

**RF-T03-08 — Formato estandarizado del evento de auditoría**
Los eventos de auditoría deben tener un esquema JSON documentado y versionado, compatible con el formato del pipeline de US-OBS-01 y consumible por sistemas externos (SIEM, herramientas de análisis). El esquema debe incluir un campo de versión para permitir evolución futura.

**RF-T03-09 — Auditoría de intentos rechazados**
Las solicitudes de backup o restore que son rechazadas (por permisos, por componente no soportado, por operación concurrente duplicada, etc.) deben generar un evento de auditoría de tipo `*.rejected` con el motivo del rechazo. No deben quedar fuera del trail de auditoría.

**RF-T03-10 — Correlación con la entidad de operación**
Cada evento de auditoría debe contener el identificador de la operación de US-BKP-01-T02 cuando aplique. Los eventos de rechazo que no llegan a crear una operación deben contener un identificador de correlación propio generado al momento del rechazo.

### 4.2 Límites claros de alcance

**Incluido en US-BKP-01-T03:**
- Modelo de evento de auditoría de backup/restore.
- Emisión de eventos en solicitud y en cada transición de estado de operaciones de backup/restore.
- Emisión de eventos para solicitudes rechazadas.
- Mecanismo de fallback y reintento ante fallo del pipeline de auditoría.
- Endpoint API de consulta de historial de auditoría (con filtros y paginación).
- Vista de historial de auditoría en consola administrativa.
- Vista resumida en consola del tenant owner.
- Esquema JSON documentado y versionado del evento.
- Correlación de eventos con la entidad de operación de US-BKP-01-T02.

**Excluido (tareas hermanas y otros):**
- Visibilidad de solo lectura del estado de backup → **US-BKP-01-T01** (ya cubierta).
- Puntos de entrada para iniciar backup/restore → **US-BKP-01-T02** (ya cubierta).
- Confirmaciones reforzadas y prechecks antes de restauraciones → **US-BKP-01-T04**.
- Pruebas y simulaciones de restore → **US-BKP-01-T05**.
- Documentación de alcance del soporte de backup por perfil → **US-BKP-01-T06**.
- Definición de alertas o reglas de detección sobre los eventos de auditoría (puede ser un incremento futuro o parte de US-OBS-01).
- Política de retención diferenciada para eventos de backup/restore (se hereda de US-OBS-01).

---

## 5. Permisos, aislamiento multi-tenant, auditoría y seguridad

### 5.1 Aislamiento multi-tenant

- Los eventos de auditoría se almacenan y consultan siempre en el contexto de un `tenant_id`. Un tenant owner nunca puede ver eventos de auditoría de otro tenant.
- La vista global (eventos de todos los tenants) solo está disponible para SRE y superadmin.
- Si una operación afecta a un componente compartido (instancia multi-tenant), el evento de auditoría se asocia al `tenant_id` que inició la operación. Si la operación afecta a múltiples tenants, se emite un evento por cada tenant afectado con una referencia cruzada al evento original.

### 5.2 Permisos de acceso

| Actor | Puede consultar auditoría de su tenant | Puede consultar auditoría global (todos los tenants) | Puede ver contexto de sesión (IP, user-agent, session ID) | Puede ver identificadores técnicos de componente |
|---|---|---|---|---|
| Tenant owner | ✅ Sí (vista resumida) | ❌ No | ❌ No | ❌ No |
| SRE / Platform team | ✅ Sí | ✅ Sí | ✅ Sí | ✅ Sí |
| Superadmin | ✅ Sí | ✅ Sí | ✅ Sí | ✅ Sí |
| Equipo de seguridad | ✅ Sí (vía pipeline/SIEM) | ✅ Sí (vía pipeline/SIEM) | ✅ Sí | ✅ Sí |
| Automatización (servicio) | ✅ Con credencial y scope adecuado | ✅ Con credencial y scope adecuado | ✅ Sí | ✅ Sí |

### 5.3 Seguridad

- El endpoint API de consulta de auditoría debe estar protegido con autenticación (token JWT de Keycloak) y autorización basada en roles.
- Los eventos de auditoría no deben contener credenciales, tokens, contraseñas ni cadenas de conexión. Si el contexto original incluye datos sensibles, estos se redactan antes de la emisión.
- El log local de fallback debe tener permisos de escritura restringidos al proceso de la plataforma y no debe ser accesible vía API pública. Es un mecanismo interno de resiliencia.
- Los eventos de auditoría son inmutables. La API no debe exponer operaciones de actualización ni eliminación de eventos.
- La consulta de auditoría por parte del tenant owner debe filtrar estrictamente los campos visibles para no exponer información de infraestructura, contexto de sesión de otros actores ni detalles técnicos internos.

### 5.4 Trazabilidad con el backlog

| Requisito funcional de esta tarea | RF del backlog |
|---|---|
| Emisión de eventos de auditoría para operaciones de backup/restore | RF-BKP-001 |
| Vistas de auditoría en consola administrativa y del tenant | RF-BKP-002 |
| Esquema de eventos compatible con pipeline de observabilidad | RF-BKP-005 |

---

## 6. Criterios de aceptación

**CA-01 — Evento de auditoría al aceptar un backup bajo demanda**
Dado un superadmin que inicia un backup bajo demanda exitosamente (US-BKP-01-T02), cuando la solicitud es aceptada, entonces se emite un evento de auditoría de tipo `backup.requested` en el pipeline de US-OBS-01 que contiene: identificador de operación, `tenant_id`, componente-instancia, actor, IP de origen, user-agent, session ID y timestamp UTC.

**CA-02 — Evento de auditoría al aceptar una solicitud de restore**
Dado un SRE que solicita una restauración exitosamente, cuando la solicitud es aceptada, entonces se emite un evento `restore.requested` con los mismos campos que CA-01 más el identificador del snapshot destino.

**CA-03 — Eventos de auditoría en transiciones de estado**
Dada una operación de backup que pasa de `accepted` a `in_progress` y luego a `completed`, entonces se emiten tres eventos de auditoría (`backup.requested`, `backup.started`, `backup.completed`) con el mismo identificador de operación y timestamps distintos.

**CA-04 — Evento de auditoría al rechazar una solicitud**
Dado un tenant owner que intenta solicitar un restore (acción no permitida para su rol), cuando la plataforma rechaza la solicitud con `HTTP 403`, entonces se emite un evento `restore.rejected` con el motivo `insufficient_permissions`, el actor y el contexto de sesión.

**CA-05 — Fallback ante fallo del pipeline de auditoría**
Dado que el pipeline de US-OBS-01 no está disponible, cuando se emite un evento de auditoría, entonces el evento se almacena en el log local de fallback, se reintenta la publicación y se genera una alerta operacional. La operación de backup/restore no se bloquea.

**CA-06 — Consulta de historial de auditoría vía API con filtros**
Dado un superadmin autenticado, cuando consulta el endpoint de auditoría de backup/restore con filtros de `tenant_id`, rango temporal y tipo de evento, entonces recibe una respuesta paginada con los eventos que cumplen los filtros, cada uno con todos los campos del modelo.

**CA-07 — Aislamiento multi-tenant en consulta de auditoría**
Dado un tenant owner autenticado, cuando consulta el endpoint de auditoría, entonces solo recibe eventos de su propio tenant. Los campos de contexto de sesión (IP, user-agent, session ID) y los identificadores técnicos de componente no están presentes en la respuesta.

**CA-08 — Vista global solo para roles privilegiados**
Dado un tenant owner autenticado, cuando intenta consultar el endpoint de auditoría sin filtro de tenant (vista global), entonces recibe `HTTP 403`. Dado un superadmin o SRE, la misma consulta retorna eventos de todos los tenants.

**CA-09 — Consola administrativa muestra historial de auditoría**
Dado un superadmin que accede a la sección de auditoría de backup/restore en la consola, entonces ve un listado cronológico de eventos filtrable por tenant, tipo de acción, actor, rango temporal y resultado. Puede expandir cada evento para ver IP, user-agent, session ID y detalle del motivo.

**CA-10 — Consola del tenant muestra historial resumido**
Dado un tenant owner que accede a su consola, entonces ve un historial resumido de acciones de backup/restore sobre su tenant con: fecha, tipo de acción y resultado. No ve IP, user-agent, session ID ni nombres técnicos de componente.

**CA-11 — Eventos inmutables**
Dado un evento de auditoría emitido, cuando cualquier actor intenta modificarlo o eliminarlo vía API, entonces la API devuelve `HTTP 405 Method Not Allowed` o no expone operación alguna de mutación.

**CA-12 — Esquema versionado y documentado**
Dado un evento de auditoría emitido, cuando se inspecciona el payload JSON, entonces contiene un campo `schema_version` y su estructura corresponde al esquema documentado.

**CA-13 — Correlación de eventos con la operación**
Dado un identificador de operación de US-BKP-01-T02, cuando se consultan los eventos de auditoría filtrando por ese identificador, entonces se obtienen todos los eventos del ciclo de vida de esa operación, ordenados cronológicamente.

---

## 7. Riesgos, supuestos y preguntas abiertas

### 7.1 Riesgos

| ID | Descripción | Probabilidad | Impacto | Mitigación sugerida |
|---|---|---|---|---|
| R-01 | El pipeline de auditoría de US-OBS-01 no soporta el volumen de eventos generado por operaciones de backup/restore automatizadas a escala | Media | Alto | Implementar buffering local antes de la publicación. Diseñar el evento con tamaño compacto. Validar capacidad del pipeline en el entorno de referencia. |
| R-02 | El mecanismo de fallback local acumula eventos no publicados y el reintento no converge | Baja | Alto | Implementar backoff exponencial con límite máximo de reintentos. Generar alerta operacional con métrica de eventos pendientes. Definir un proceso manual de reconciliación como plan B. |
| R-03 | El contexto de sesión (IP, user-agent) no está disponible en todos los puntos de emisión (p. ej., operaciones iniciadas por servicios internos) | Media | Bajo | Los campos de contexto de sesión son opcionales en el modelo. Se marcan como `not_applicable` cuando no están disponibles. El evento se emite igualmente. |
| R-04 | Operaciones sobre componentes compartidos multi-tenant generan ambigüedad sobre a qué tenant atribuir el evento | Media | Medio | Se emite un evento por cada tenant afectado con referencia cruzada. Si no es posible determinar los tenants afectados, se emite un evento a nivel de instancia visible solo para SRE/superadmin. |

### 7.2 Supuestos

**S-01**: US-BKP-01-T01 y US-BKP-01-T02 están implementadas y disponibles. El modelo de operación con ciclo de vida, los endpoints de acción y el registro básico de operación ya existen.

**S-02**: El pipeline de auditoría de US-OBS-01 está operativo y acepta eventos con un esquema extensible. Los eventos de backup/restore son un nuevo tipo de evento dentro del pipeline existente, no un pipeline separado.

**S-03**: El contexto de sesión (IP de origen, user-agent, session ID) está disponible en el punto de entrada de la solicitud HTTP y puede propagarse hasta el punto de emisión del evento de auditoría.

**S-04**: El backend de la consola puede consultar el endpoint de auditoría con credenciales de servicio para renderizar las vistas de historial.

### 7.3 Preguntas abiertas

**P-01 — ¿Se requiere firma o hash de integridad en los eventos de auditoría?**
Algunos marcos de cumplimiento exigen que los registros de auditoría tengan una prueba de integridad (hash encadenado, firma digital). Si es necesario, se añade complejidad al modelo de evento. Si no, se confía en la inmutabilidad del pipeline.
*No bloquea*: se puede añadir como mejora posterior si el marco de cumplimiento lo exige.

**P-02 — ¿Los eventos de auditoría de backup/restore deben tener retención diferenciada respecto al resto de eventos de US-OBS-01?**
Algunos marcos regulatorios exigen retención mínima de registros de auditoría (p. ej., 1 año, 5 años). Si la política de retención del pipeline estándar no cubre este requisito, se necesita una configuración diferenciada.
*No bloquea*: la retención se hereda del pipeline. Si se requiere diferenciación, es configuración del pipeline, no lógica de esta tarea.

**P-03 — ¿Debe existir un mecanismo de alerta inmediata sobre operaciones de restore (notificación en tiempo real)?**
El trail de auditoría registra los eventos, pero no genera alertas proactivas por sí mismo. Si seguridad necesita alertas en tiempo real ante un restore, esto podría ser un consumidor adicional del pipeline o un incremento futuro.
*No bloquea*: se puede resolver como configuración de alertas sobre el pipeline de US-OBS-01.

---

*Documento generado para el stage `speckit.specify` — US-BKP-01-T03 | Rama: `111-backup-audit-trail`*
