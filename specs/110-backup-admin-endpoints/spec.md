# Especificación — US-BKP-01-T02: Puntos de entrada administrativos para iniciar backups o restauraciones

| Campo               | Valor                                                                 |
|---------------------|-----------------------------------------------------------------------|
| **Task ID**         | US-BKP-01-T02                                                         |
| **Epic**            | EP-20 — Backup, recuperación y continuidad operativa                  |
| **Historia**        | US-BKP-01 — Estado de backup/restore y flujos administrativos de recuperación |
| **Tipo**            | Feature                                                               |
| **Prioridad**       | P1                                                                    |
| **Tamaño**          | M                                                                     |
| **RFs cubiertos**   | RF-BKP-001, RF-BKP-002, RF-BKP-005                                   |
| **Dependencias**    | US-OBS-01, US-DEP-03, US-BKP-01-T01 (visibilidad de estado de backup) |

---

## 1. Objetivo y problema que resuelve

### Problema

Tras US-BKP-01-T01, la plataforma expone visibilidad de solo lectura sobre el estado de backup de los componentes gestionados. Sin embargo, **no existe un mecanismo dentro del producto para que un actor autorizado pueda iniciar un backup bajo demanda ni solicitar la restauración de un recurso a un punto anterior**. Esto obliga a los equipos de operaciones y a los superadmin a:

1. **Acceder a herramientas externas** (consola de Kubernetes, CLI de Velero, pgAdmin, mongodump, etc.) para iniciar backups o restauraciones manualmente, rompiendo la experiencia unificada del producto.
2. **Depender de procesos manuales no estandarizados** que varían entre despliegues y componentes, lo que aumenta el riesgo de error humano en operaciones críticas.
3. **Perder trazabilidad** sobre quién solicitó una operación de backup o restore, cuándo y sobre qué recurso, porque la acción ocurre fuera del perímetro del producto.

### Objetivo de esta tarea

Proveer puntos de entrada administrativos (API y consola) que permitan a actores autorizados **iniciar un backup bajo demanda** de un componente gestionado o **solicitar la restauración** de un recurso a un snapshot previo, cuando el perfil de despliegue lo soporte. La tarea se centra en las **acciones de mutación** (iniciar backup, solicitar restore) y en el **ciclo de vida básico de la solicitud** (aceptada, en progreso, completada, fallida), complementando la visibilidad de solo lectura que ya provee US-BKP-01-T01.

No se incluyen en esta tarea los mecanismos de confirmación reforzada ni prechecks previos a restauraciones destructivas (US-BKP-01-T04), la auditoría detallada de cada acción (US-BKP-01-T03) ni las pruebas de simulación (US-BKP-01-T05).

---

## 2. Usuarios y valor recibido

| Actor | Relación con la capacidad | Valor que recibe |
|---|---|---|
| **SRE / Platform team** | Ejecutor principal de operaciones de backup y restore | Puede iniciar backups bajo demanda y solicitar restauraciones desde la propia plataforma, con una interfaz estandarizada independiente del componente. Reduce tiempo de respuesta ante incidentes. |
| **Superadmin** | Administrador global con autoridad sobre todos los tenants | Puede iniciar backup o restore de cualquier tenant sin escalar al equipo de infraestructura ni acceder a herramientas externas. |
| **Tenant owner** | Propietario del tenant (acceso condicionado) | Si el despliegue y los permisos lo permiten, puede solicitar un backup bajo demanda de los recursos de su propio tenant. El acceso a restore está restringido a roles privilegiados. |
| **Sistemas de automatización** | Scripts y pipelines que consumen la API | Pueden integrar la solicitud de backup/restore en flujos automatizados de recuperación ante desastres o migraciones planificadas. |

---

## 3. Escenarios principales, edge cases y reglas de negocio

### 3.1 Escenarios principales

**E1 — Superadmin inicia un backup bajo demanda de un componente de un tenant**

> El superadmin accede a la sección de backup de un tenant en la consola administrativa. Ve los componentes gestionados (con su estado de backup, provisto por US-BKP-01-T01). Selecciona un componente cuyo estado indica que el backup está disponible. Pulsa "Iniciar backup". La plataforma registra la solicitud, la envía al adaptador del componente correspondiente y muestra el estado de la operación como `accepted` y luego `in_progress`. Cuando el adaptador reporta finalización, el estado pasa a `completed` o `failed`.

**E2 — SRE solicita la restauración de un componente a un snapshot previo**

> El SRE accede a la vista de backup de un tenant. Ve el historial de snapshots disponibles para un componente (lista expuesta por el adaptador). Selecciona un snapshot y pulsa "Restaurar a este punto". La plataforma registra la solicitud de restore con el identificador del snapshot seleccionado. El estado pasa a `accepted`, luego `in_progress`, y finalmente `completed` o `failed`.

**E3 — Tenant owner solicita un backup bajo demanda de su propio tenant**

> El tenant owner accede a la sección de backup de su consola. Si el despliegue y los permisos lo permiten, ve un botón "Solicitar backup" junto al resumen de estado de sus componentes. Pulsa el botón. La solicitud se registra y se procesa igual que en E1, pero el tenant owner solo puede operar sobre sus propios componentes y no tiene acceso a la acción de restore.

**E4 — Solicitud de backup sobre un componente que no soporta backup en el despliegue**

> Un superadmin intenta iniciar un backup de un componente cuyo estado es `not_available` o `not_configured`. La plataforma rechaza la solicitud con un mensaje explícito indicando que el componente no soporta backup en el perfil de despliegue actual. No se registra ninguna operación.

**E5 — Consulta del estado de una operación de backup/restore en curso vía API**

> Un sistema de automatización envía una solicitud de backup vía API y recibe un identificador de operación. Luego consulta el estado de la operación usando ese identificador. La API devuelve el estado actual (`accepted`, `in_progress`, `completed`, `failed`) con timestamps de cada transición.

**E6 — Solicitud de restore vía API para un snapshot específico**

> Un SRE envía una solicitud de restore vía API indicando el `tenant_id`, el identificador del componente y el identificador del snapshot destino. La API valida que el snapshot existe y que el actor tiene permisos, registra la solicitud y devuelve el identificador de la operación.

### 3.2 Edge cases

| Caso | Comportamiento esperado |
|---|---|
| Solicitud de backup cuando ya hay una operación de backup en progreso para el mismo componente-tenant | La plataforma rechaza la solicitud con un error claro indicando que ya existe una operación en curso. Devuelve el identificador de la operación activa. |
| Solicitud de restore cuando ya hay una operación de restore en progreso para el mismo componente-tenant | Mismo comportamiento: rechazo con referencia a la operación activa. |
| El adaptador del componente no responde al solicitar la operación (timeout) | La operación pasa a estado `failed` con motivo `adapter_timeout`. Se muestra al solicitante que la operación no pudo iniciarse. |
| El adaptador reporta fallo durante la ejecución del backup | La operación pasa a estado `failed` con el motivo reportado por el adaptador (sin exponer detalles internos de infraestructura al tenant owner). El SRE/superadmin recibe el motivo técnico. |
| Snapshot seleccionado para restore ya no existe o ha expirado | La plataforma rechaza la solicitud con un error específico indicando que el snapshot no está disponible. |
| Solicitud de backup/restore sobre un componente que no tiene adaptador registrado | Rechazo con error `adapter_not_available`. |
| Solicitud de restore por parte de un tenant owner | La plataforma rechaza la solicitud con `HTTP 403`. El restore está limitado a SRE y superadmin. |
| Múltiples solicitudes concurrentes de backup para distintos componentes del mismo tenant | Se permiten, ya que son operaciones independientes por componente-instancia. |
| El despliegue no soporta ningún tipo de operación de backup/restore | Los endpoints de acción existen pero devuelven `HTTP 501 Not Implemented` o un error semántico equivalente indicando que la capacidad no está habilitada en el despliegue. La consola oculta los botones de acción y muestra un mensaje informativo. |

### 3.3 Reglas de negocio y gobierno

**RN-01 — Las acciones de backup/restore son operaciones privilegiadas**
Iniciar un backup o solicitar un restore no es una operación de consulta. Requiere permisos explícitos y diferenciados. El backup bajo demanda puede ser accesible a tenant owners si el despliegue lo permite; el restore está restringido exclusivamente a SRE y superadmin.

**RN-02 — Una operación de backup/restore es una entidad con ciclo de vida rastreable**
Cada solicitud de backup o restore genera un registro de operación con un identificador único, timestamps de transiciones de estado, actor solicitante, componente destino, tenant afectado y resultado final. Este registro es la base para la trazabilidad (y será consumido por la auditoría en US-BKP-01-T03).

**RN-03 — El modelo de adaptadores de US-BKP-01-T01 se extiende con capacidades de acción**
Los adaptadores que ya exponen estado de backup (lectura) deben declarar también si soportan las acciones de `trigger_backup` y `trigger_restore`. Si un adaptador solo soporta lectura, las acciones de mutación no están disponibles para ese componente y la plataforma lo indica explícitamente.

**RN-04 — Una sola operación activa por componente-instancia-tenant por tipo de acción**
No se permite tener dos backups simultáneos ni dos restores simultáneos sobre el mismo componente-instancia para el mismo tenant. Sí se permite un backup y un restore concurrentes si el adaptador lo soporta, aunque la plataforma debería advertir del riesgo.

**RN-05 — Las operaciones respetan el aislamiento multi-tenant**
Un actor solo puede solicitar operaciones sobre los componentes de los tenants a los que tiene acceso. Un tenant owner solo puede operar sobre su propio tenant. Un superadmin/SRE puede operar sobre cualquier tenant.

**RN-06 — Degradación explícita, nunca silenciosa**
Si la capacidad de backup/restore no está disponible en el despliegue, los endpoints existen pero responden con un error semántico claro. La consola adapta la interfaz para no mostrar botones de acción inoperativos sin explicación.

**RN-07 — La solicitud es asíncrona**
Las operaciones de backup y restore son inherentemente asíncronas. La API acepta la solicitud, devuelve un identificador de operación y el solicitante consulta el estado posteriormente. La consola puede implementar actualización periódica del estado de la operación.

---

## 4. Requisitos funcionales y límites de alcance

### 4.1 Requisitos funcionales verificables

**RF-T02-01 — Modelo de operación de backup/restore**
Debe existir un modelo de datos que represente una operación de backup o restore. Como mínimo debe incluir: identificador único de operación, tipo de operación (`backup` o `restore`), `tenant_id`, identificador del componente-instancia, estado (`accepted`, `in_progress`, `completed`, `failed`, `rejected`), actor solicitante (identificador del usuario), timestamp de creación, timestamp de última transición de estado, motivo de fallo (si aplica) e identificador del snapshot destino (solo para restore).

**RF-T02-02 — Endpoint API para iniciar backup bajo demanda**
Debe existir un endpoint REST que acepte una solicitud de backup bajo demanda para un componente-instancia de un tenant. El endpoint debe validar permisos del solicitante, verificar que el componente soporta la acción de backup, verificar que no hay una operación de backup activa para ese componente-instancia-tenant, crear el registro de operación y despachar la solicitud al adaptador correspondiente. Devuelve el identificador de la operación creada.

**RF-T02-03 — Endpoint API para solicitar restauración**
Debe existir un endpoint REST que acepte una solicitud de restore para un componente-instancia de un tenant, indicando el identificador del snapshot destino. El endpoint debe validar que el solicitante tiene rol SRE o superadmin, que el componente soporta restore, que el snapshot indicado existe y está disponible, que no hay una operación de restore activa para ese componente-instancia-tenant, crear el registro de operación y despachar la solicitud al adaptador. Devuelve el identificador de la operación creada.

**RF-T02-04 — Endpoint API para consultar estado de una operación**
Debe existir un endpoint REST que, dado un identificador de operación, devuelva el estado actual de la operación con todos sus timestamps de transición. El acceso está restringido al actor que creó la operación y a roles SRE/superadmin.

**RF-T02-05 — Endpoint API para listar snapshots disponibles de un componente**
Debe existir un endpoint REST que, dado un `tenant_id` y un identificador de componente-instancia, devuelva la lista de snapshots disponibles para restauración. Cada snapshot debe incluir al menos: identificador, timestamp de creación y estado (disponible, expirado). El acceso está restringido a SRE y superadmin.

**RF-T02-06 — Extensión del contrato de adaptador con capacidades de acción**
El contrato/interfaz de adaptador definido en US-BKP-01-T01 debe extenderse para declarar las capacidades `trigger_backup` y `trigger_restore`, y para exponer la lista de snapshots disponibles. Cada adaptador debe poder indicar qué acciones soporta.

**RF-T02-07 — Vista de acciones de backup en consola administrativa (superadmin/SRE)**
La consola administrativa debe permitir a un superadmin o SRE iniciar un backup bajo demanda y solicitar una restauración desde la vista de backup de un tenant. Los botones de acción solo se muestran si el adaptador del componente declara soporte para la acción correspondiente. Debe mostrarse el estado de operaciones en curso o recientes.

**RF-T02-08 — Vista de solicitud de backup en consola del tenant (tenant owner)**
Si el despliegue y los permisos lo habilitan, la consola del tenant debe permitir al tenant owner solicitar un backup bajo demanda. El botón de restore no está disponible para el tenant owner. Si la capacidad no está habilitada, la consola no muestra el botón y no da indicación de una acción inoperativa.

**RF-T02-09 — Rechazo explícito de operaciones no soportadas**
Cuando un actor solicita una operación (backup o restore) sobre un componente cuyo adaptador no la soporta o cuyo despliegue no la habilita, la API debe devolver un error semántico claro (no un error genérico 500). La consola debe impedir la acción antes de enviar la solicitud cuando ya conoce la información de capacidades.

**RF-T02-10 — Prevención de operaciones concurrentes duplicadas**
La API debe rechazar una solicitud de backup si ya existe una operación de backup en estado `accepted` o `in_progress` para el mismo componente-instancia-tenant. Mismo comportamiento para restore. El error debe incluir el identificador de la operación activa.

### 4.2 Límites claros de alcance

**Incluido en US-BKP-01-T02:**
- Modelo de datos de operación de backup/restore (entidad con ciclo de vida).
- Extensión del contrato de adaptador con capacidades de acción (`trigger_backup`, `trigger_restore`, `list_snapshots`).
- Endpoints API REST para iniciar backup, solicitar restore, consultar estado de operación y listar snapshots.
- Vista de acciones en consola administrativa (superadmin/SRE).
- Vista de solicitud de backup en consola del tenant (tenant owner, condicionada).
- Validación de permisos y aislamiento multi-tenant en las operaciones.
- Prevención de operaciones concurrentes duplicadas.
- Registro básico de la operación como entidad rastreable (identificador, estados, timestamps, actor).

**Excluido (tareas hermanas):**
- Visibilidad de solo lectura del estado de backup → **US-BKP-01-T01** (ya cubierta).
- Auditoría completa y detallada de cada acción de recuperación → **US-BKP-01-T03**.
- Confirmaciones reforzadas y prechecks antes de restauraciones destructivas → **US-BKP-01-T04**.
- Pruebas y simulaciones de restore en entornos de integración → **US-BKP-01-T05**.
- Documentación de alcance del soporte de backup por perfil de despliegue → **US-BKP-01-T06**.

---

## 5. Permisos, aislamiento multi-tenant, auditoría y seguridad

### 5.1 Aislamiento multi-tenant

- Toda operación de backup o restore se ejecuta en el contexto de un `tenant_id`. Un actor solo puede solicitar operaciones sobre tenants a los que tiene acceso.
- El tenant owner solo puede iniciar operaciones sobre componentes de su propio tenant. Nunca sobre otros tenants.
- El SRE y el superadmin pueden operar sobre cualquier tenant.
- Si un componente es compartido (instancia multi-tenant), la operación de backup o restore a nivel de tenant solo se permite si el adaptador soporta la segregación. Si el adaptador solo puede operar a nivel de instancia completa, la acción queda restringida exclusivamente a SRE/superadmin y la plataforma advierte que la operación afecta a todos los tenants de la instancia.

### 5.2 Permisos de acceso

| Actor | Puede iniciar backup de su tenant | Puede solicitar restore de su tenant | Puede iniciar backup de cualquier tenant | Puede solicitar restore de cualquier tenant | Puede consultar estado de operación | Puede listar snapshots |
|---|---|---|---|---|---|---|
| Tenant owner | ✅ Condicionado al despliegue | ❌ No | ❌ No | ❌ No | ✅ Solo sus operaciones | ❌ No |
| SRE / Platform team | ✅ Sí | ✅ Sí | ✅ Sí | ✅ Sí | ✅ Todas | ✅ Sí |
| Superadmin | ✅ Sí | ✅ Sí | ✅ Sí | ✅ Sí | ✅ Todas | ✅ Sí |
| Automatización (servicio) | ✅ Con credencial y scope adecuado | ✅ Con credencial y scope adecuado | ✅ Con credencial y scope adecuado | ✅ Con credencial y scope adecuado | ✅ Con credencial | ✅ Con credencial |

### 5.3 Auditoría

- Cada solicitud de backup o restore debe generar un evento de auditoría mínimo que incluya: tipo de operación, actor solicitante, `tenant_id`, componente-instancia, timestamp e identificador de operación.
- Este evento mínimo es parte del registro de la operación como entidad rastreable. La auditoría completa y enriquecida (con contexto de sesión, IP, detalles de aprobación, etc.) corresponde a US-BKP-01-T03, que consumirá estos registros.
- Las consultas de estado de operación siguen el pipeline de auditoría estándar de la plataforma (lectura).

### 5.4 Seguridad

- Los endpoints de backup y restore deben estar protegidos con autenticación (token JWT de Keycloak) y autorización basada en roles.
- Las credenciales usadas por los adaptadores para ejecutar la operación en los componentes gestionados deben tener el privilegio mínimo necesario para la acción concreta (backup o restore). No deben reutilizar las credenciales de solo lectura de US-BKP-01-T01 si la acción requiere permisos adicionales.
- El motivo técnico de fallo de una operación se expone completo solo a SRE/superadmin. Al tenant owner se le muestra un mensaje genérico ("La operación no pudo completarse. Contacte al administrador.").
- El identificador de snapshot no debe contener ni exponer rutas internas de almacenamiento, credenciales ni metadatos de infraestructura.
- Las operaciones de restore son potencialmente destructivas. Esta tarea implementa la solicitud y el despacho, pero las confirmaciones reforzadas y prechecks se implementan en US-BKP-01-T04. Hasta que US-BKP-01-T04 esté disponible, la API permite la solicitud directa con la validación básica aquí definida.

### 5.5 Trazabilidad con el backlog

| Requisito funcional de esta tarea | RF del backlog |
|---|---|
| Endpoints de acción de backup/restore y modelo de operación | RF-BKP-001 |
| Vistas de acción en consola administrativa y del tenant | RF-BKP-002 |
| Extensión del modelo de adaptadores con capacidades de acción | RF-BKP-005 |

---

## 6. Criterios de aceptación

**CA-01 — Iniciar backup bajo demanda vía API**
Dado un superadmin autenticado y un componente-instancia con adaptador que soporta `trigger_backup`, cuando envía una solicitud de backup para un `tenant_id` y componente válidos, entonces la API devuelve `HTTP 202` con un identificador de operación, y la operación aparece en estado `accepted` o `in_progress`.

**CA-02 — Solicitar restore vía API**
Dado un SRE autenticado, un componente-instancia con adaptador que soporta `trigger_restore` y un snapshot válido, cuando envía una solicitud de restore indicando `tenant_id`, componente y snapshot, entonces la API devuelve `HTTP 202` con un identificador de operación.

**CA-03 — Tenant owner no puede solicitar restore**
Dado un tenant owner autenticado, cuando envía una solicitud de restore para un componente de su propio tenant, entonces la API devuelve `HTTP 403`.

**CA-04 — Consulta de estado de operación**
Dado un identificador de operación válido, cuando el actor solicitante o un SRE/superadmin consulta el estado, entonces la API devuelve el estado actual (`accepted`, `in_progress`, `completed`, `failed`) con timestamps de cada transición.

**CA-05 — Listado de snapshots disponibles**
Dado un SRE autenticado y un componente-instancia con adaptador que soporta `list_snapshots`, cuando consulta los snapshots disponibles para un `tenant_id` y componente, entonces la API devuelve una lista con al menos: identificador de snapshot, timestamp de creación y estado de disponibilidad.

**CA-06 — Rechazo de backup sobre componente sin soporte**
Dado un componente cuyo adaptador no declara soporte para `trigger_backup` (o que no tiene adaptador), cuando un superadmin solicita un backup, entonces la API devuelve un error semántico claro indicando que la acción no está soportada para ese componente.

**CA-07 — Rechazo de operación concurrente duplicada**
Dado un componente-instancia-tenant con una operación de backup en estado `in_progress`, cuando un actor solicita otro backup para el mismo componente-instancia-tenant, entonces la API devuelve un error que incluye el identificador de la operación activa.

**CA-08 — Rechazo cuando el snapshot no existe o expiró**
Dado un identificador de snapshot que ya no está disponible, cuando un SRE solicita restore a ese snapshot, entonces la API devuelve un error específico indicando que el snapshot no está disponible.

**CA-09 — Aislamiento multi-tenant en operaciones**
Dado un tenant owner autenticado, cuando intenta iniciar un backup sobre un componente de un tenant que no es el suyo, entonces la API devuelve `HTTP 403`.

**CA-10 — Consola administrativa permite iniciar backup y restore**
Dado un superadmin que accede a la vista de backup de un tenant en la consola, cuando el componente tiene adaptador con soporte para `trigger_backup`, entonces ve un botón "Iniciar backup". Cuando el adaptador soporta `trigger_restore`, ve una lista de snapshots con opción "Restaurar". Tras iniciar la acción, la consola muestra el estado de la operación en curso.

**CA-11 — Consola del tenant permite solicitar backup (condicionado)**
Dado un tenant owner que accede a su consola y el despliegue habilita backup bajo demanda para tenant owners, cuando su componente soporta la acción, entonces ve un botón "Solicitar backup". Si el despliegue no lo habilita, el botón no aparece y no hay indicación engañosa.

**CA-12 — Operación fallida muestra motivo diferenciado por rol**
Dado una operación de backup que falla, cuando un SRE consulta el estado, entonces ve el motivo técnico del fallo. Cuando un tenant owner consulta el estado de una operación que inició, entonces ve un mensaje genérico sin detalles técnicos internos.

**CA-13 — Despliegue sin soporte de backup/restore responde de forma explícita**
Dado un despliegue que no habilita ningún mecanismo de backup/restore, cuando un superadmin intenta iniciar un backup vía API, entonces la API devuelve un error semántico (no `HTTP 500`) indicando que la capacidad no está disponible. La consola no muestra botones de acción.

---

## 7. Riesgos, supuestos y preguntas abiertas

### 7.1 Riesgos

| ID | Descripción | Probabilidad | Impacto | Mitigación sugerida |
|---|---|---|---|---|
| R-01 | Las operaciones de restore son inherentemente destructivas y sin US-BKP-01-T04 no hay prechecks ni confirmaciones reforzadas | Alta | Crítico | Limitar el acceso a restore exclusivamente a SRE/superadmin. Documentar en la consola que la operación es irreversible. Planificar US-BKP-01-T04 como siguiente tarea prioritaria. |
| R-02 | Heterogeneidad de APIs de backup entre componentes (PostgreSQL, MongoDB, S3) dificulta un flujo de acción unificado | Alta | Alto | El modelo de adaptadores absorbe la heterogeneidad. Cada adaptador traduce la solicitud genérica a la acción nativa del componente. |
| R-03 | Operaciones de restore de larga duración pueden generar timeouts o estados inconsistentes | Media | Alto | El modelo asíncrono con ciclo de vida permite que las operaciones de larga duración sean rastreables. El adaptador debe reportar transiciones de estado, no depender de una respuesta síncrona. |
| R-04 | Componentes compartidos multi-tenant no pueden segregar backup/restore a nivel de tenant individual | Media | Alto | Si el adaptador no soporta segregación, la acción queda restringida a SRE/superadmin con advertencia explícita de que afecta a toda la instancia compartida. |
| R-05 | Sin auditoría completa (US-BKP-01-T03), la trazabilidad de acciones de restore es limitada al registro básico de operación | Media | Medio | El registro de operación incluye actor, timestamp, tenant y componente. Es suficiente para trazabilidad básica. US-BKP-01-T03 enriquecerá la auditoría. |

### 7.2 Supuestos

**S-01**: US-BKP-01-T01 está implementada y disponible. El modelo de estado de backup, el contrato de adaptadores y el endpoint de consulta de estado ya existen y funcionan.

**S-02**: Al menos un adaptador concreto (PostgreSQL o MongoDB) implementado en US-BKP-01-T01 puede extenderse para soportar las acciones de `trigger_backup` y `trigger_restore` en el entorno de referencia.

**S-03**: El sistema de observabilidad (US-OBS-01) y el modelo de despliegue (US-DEP-03) están operativos, ya que son dependencias declaradas de la historia.

**S-04**: El backend de la consola ejecutándose en OpenWhisk puede despachar solicitudes de backup/restore a los adaptadores a través de la API interna del producto.

**S-05**: Los mecanismos nativos de backup/restore de los componentes gestionados (pg_dump/pg_restore, mongodump/mongorestore, etc.) son invocables desde los adaptadores con credenciales de servicio adecuadas.

### 7.3 Preguntas abiertas

**P-01 — ¿Debe el tenant owner poder iniciar backups bajo demanda en todos los despliegues o es una capability del plan?**
Si depende del plan contratado, se necesita coordinación con el modelo de capabilities (US-PLAN-02). Si es una decisión de despliegue (feature flag), es gestionable localmente.
*Impacto*: afecta la lógica de permisos en la consola del tenant.

**P-02 — ¿Cuántos snapshots debe retener la lista de snapshots disponibles por defecto?**
La retención de snapshots es propia del mecanismo de backup de cada componente. La plataforma solo lista lo que el adaptador reporta. Sin embargo, conviene definir si la API debe paginar o limitar la respuesta.
*No bloquea*: se puede implementar con paginación estándar.

**P-03 — ¿Se requiere algún mecanismo de notificación al completarse una operación (webhook, evento Kafka, correo)?**
La tarea define la solicitud y el ciclo de vida de la operación. Las notificaciones proactivas podrían ser un incremento posterior. El evento Kafka de la operación podría emitirse como efecto lateral del cambio de estado.
*No bloquea*: se puede añadir como mejora incremental.

---

*Documento generado para el stage `speckit.specify` — US-BKP-01-T02 | Rama: `110-backup-admin-endpoints`*
