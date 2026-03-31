# Especificación — US-BKP-01-T01: Visibilidad del estado de backup de componentes gestionados

| Campo               | Valor                                                                 |
|---------------------|-----------------------------------------------------------------------|
| **Task ID**         | US-BKP-01-T01                                                         |
| **Epic**            | EP-20 — Backup, recuperación y continuidad operativa                  |
| **Historia**        | US-BKP-01 — Estado de backup/restore y flujos administrativos de recuperación |
| **Tipo**            | Feature                                                               |
| **Prioridad**       | P1                                                                    |
| **Tamaño**          | M                                                                     |
| **RFs cubiertos**   | RF-BKP-001, RF-BKP-002, RF-BKP-005                                   |
| **Dependencias**    | US-OBS-01, US-DEP-03                                                  |

---

## 1. Objetivo y problema que resuelve

### Problema

La plataforma BaaS multi-tenant gestiona múltiples componentes de infraestructura (PostgreSQL, MongoDB, almacenamiento S3-compatible, Keycloak, Kafka, etc.) que, según el perfil de despliegue, pueden tener mecanismos de backup nativos o delegados al operador de Kubernetes. En la actualidad, **no existe un punto único dentro del producto donde un SRE, superadmin o tenant owner pueda consultar el estado de backup de los componentes que soportan su tenant**. Esto obliga a los equipos de operaciones a:

1. **Salir del producto** para consultar herramientas externas (consolas de Kubernetes, dashboards de Velero, paneles del proveedor de base de datos) y cruzar información manualmente.
2. **Operar sin visibilidad** cuando los mecanismos de backup del despliegue no están instrumentados o no son accesibles al equipo que necesita la información.
3. **Generar tickets innecesarios** al equipo de plataforma para verificar algo que debería ser observable desde la propia consola.

### Objetivo de esta tarea

Exponer de forma unificada, dentro de la plataforma, el estado de backup de los componentes gestionados cuando el despliegue lo permita. La tarea se centra en **lectura y visibilidad**, no en iniciar, restaurar ni gestionar backups (eso corresponde a tareas hermanas).

El resultado es que operaciones, superadmin y, opcionalmente, el tenant owner puedan ver desde la consola o la API si los backups de los componentes que soportan un tenant están configurados, cuándo fue el último backup exitoso, y si hay alguna anomalía, sin salir de la plataforma.

---

## 2. Usuarios y valor recibido

| Actor | Relación con la capacidad | Valor que recibe |
|---|---|---|
| **SRE / Platform team** | Responsable de la operación y continuidad del servicio | Visibilidad centralizada del estado de backup de todos los tenants en un único panel, sin necesidad de herramientas externas. Detección temprana de anomalías. |
| **Superadmin** | Administrador global de la plataforma | Puede verificar que la política de backup se cumple para cualquier tenant sin escalar al equipo de infraestructura. |
| **Tenant owner** | Propietario del tenant | Obtiene confianza en que sus datos están respaldados (cuando el despliegue lo soporta) y puede detectar ausencia de backup antes de que sea un problema real. |
| **Equipo de soporte** | Atiende incidencias de tenants | Puede responder preguntas del tipo "¿mis datos están respaldados?" sin escalar, usando la información expuesta en la consola. |

---

## 3. Escenarios principales, edge cases y reglas de negocio

### 3.1 Escenarios principales

**E1 — Superadmin consulta el estado global de backup**

> El superadmin accede a la sección de backup en la consola administrativa. Ve un listado de componentes gestionados (PostgreSQL, MongoDB, S3, etc.) con el estado de backup de cada uno: último backup exitoso, fecha/hora, estado general (OK / Warning / Error / No configurado / No disponible). El listado es filtrable por tenant.

**E2 — SRE consulta el estado de backup de un tenant específico**

> El SRE selecciona un tenant. Ve los componentes del tenant con su estado de backup individual. Si un componente reporta que el último backup falló o lleva más de un umbral configurable sin backup exitoso, el estado se muestra como Warning o Error.

**E3 — Tenant owner consulta su propio estado de backup**

> El tenant owner, si el despliegue y los permisos lo permiten, accede a una vista resumida del estado de backup de los componentes que soportan su tenant. No ve detalles internos de infraestructura, sino un resumen funcional: "Tus datos están respaldados — último backup: hace 2 horas" o "Estado de backup no disponible en este despliegue".

**E4 — Componente sin soporte de backup en el despliegue**

> El despliegue actual no tiene habilitado un mecanismo de backup para MongoDB. La plataforma muestra explícitamente que la visibilidad de backup no está disponible para ese componente en este perfil de despliegue, en lugar de omitir el componente silenciosamente.

**E5 — Consulta de estado de backup vía API**

> Un sistema de monitoreo externo o un script de operaciones consulta el estado de backup de los componentes del tenant mediante un endpoint API REST. Recibe un payload estandarizado con el mismo modelo de datos que consume la consola.

### 3.2 Edge cases

| Caso | Comportamiento esperado |
|---|---|
| Componente gestionado no tiene mecanismo de backup configurado | Se muestra como `not_configured`. No se muestra como error ni se omite. |
| El despliegue no soporta ningún tipo de reporte de backup | La sección de backup está presente pero indica claramente que la funcionalidad de visibilidad no está disponible en el perfil de despliegue actual. |
| El adaptador de backup de un componente no responde (timeout) | Se muestra el último estado conocido con una indicación de que la información puede estar desactualizada, junto con el timestamp de la última lectura exitosa. |
| Tenant recién creado sin historial de backup | Se muestra como `pending` o `no_history`. No se marca como error. |
| Componente con backup parcialmente exitoso (p. ej., base de datos OK, pero índices no) | El estado debe reflejar el detalle granular si el adaptador lo proporciona; de lo contrario, se reporta como `partial` o `warning` con el detalle disponible. |
| Múltiples instancias del mismo componente para un tenant (p. ej., varias bases de datos PostgreSQL) | Cada instancia se lista individualmente con su propio estado de backup. |
| Zona horaria del timestamp del backup | Todos los timestamps se almacenan y exponen en UTC (ISO 8601). La consola puede formatear en la zona horaria del usuario. |

### 3.3 Reglas de negocio y gobierno

**RN-01 — La visibilidad es pasiva y de solo lectura**
Esta tarea solo expone estado. No inicia, programa, cancela ni restaura backups. Las acciones de mutación corresponden a US-BKP-01-T02.

**RN-02 — El estado debe reflejar la realidad del despliegue, no una aspiración**
Si el despliegue no tiene backup configurado para un componente, la plataforma lo dice explícitamente. No se muestra un estado ficticio de "OK" ni se oculta la carencia.

**RN-03 — Modelo de adaptadores por componente**
La visibilidad de backup se obtiene a través de un modelo de adaptadores (uno por tipo de componente gestionado). Cada adaptador sabe cómo consultar el estado de backup del componente al que representa. Si no existe adaptador para un componente, este aparece con estado `not_available`.

**RN-04 — El estado de backup es por componente-instancia y por tenant**
La granularidad mínima es: qué componente, qué instancia, para qué tenant, cuál es el estado. No se admite un estado global "todos los backups están OK" sin desglose.

**RN-05 — Degradación informativa, no silenciosa**
Cuando la consulta de estado falla o devuelve información incompleta, se muestra el último estado conocido con indicación de antigüedad. Nunca se oculta la sección ni se muestra "OK" por defecto.

**RN-06 — Los nombres internos de componentes de infraestructura no se exponen a tenant owners**
El tenant owner ve un resumen funcional ("Base de datos relacional", "Almacenamiento de objetos"), no nombres técnicos internos como "pg-cluster-12" o "minio-tenant-3". El superadmin y el SRE sí ven los identificadores técnicos.

---

## 4. Requisitos funcionales y límites de alcance

### 4.1 Requisitos funcionales verificables

**RF-T01-01 — Modelo de estado de backup unificado**
Debe existir un modelo de datos que represente el estado de backup de un componente-instancia para un tenant. Como mínimo debe incluir: identificador del componente, tipo de componente, tenant asociado, estado del último backup (`success`, `failure`, `partial`, `in_progress`, `not_configured`, `not_available`, `pending`), timestamp del último backup exitoso, timestamp de la última consulta al adaptador, y detalle textual opcional.

**RF-T01-02 — Endpoint API de consulta de estado de backup**
Debe existir un endpoint REST que, dado un `tenant_id`, devuelva el estado de backup de todos los componentes-instancia asociados a ese tenant. El endpoint debe ser consultable también sin filtro de tenant por parte del superadmin/SRE para obtener la vista global.

**RF-T01-03 — Modelo de adaptadores de backup**
Debe existir un contrato/interfaz que defina cómo un adaptador de componente reporta su estado de backup. El sistema debe poder registrar adaptadores para cada tipo de componente gestionado. Los adaptadores concretos a implementar en esta tarea son los mínimos viables para demostrar la capacidad (al menos uno para un componente con backup observable).

**RF-T01-04 — Vista de estado de backup en consola (superadmin/SRE)**
La consola administrativa debe incluir una vista que muestre el estado de backup de los componentes gestionados, filtrable por tenant, con indicadores visuales de estado (OK, Warning, Error, No configurado, No disponible).

**RF-T01-05 — Vista resumida de backup en consola (tenant owner)**
La consola del tenant debe incluir un resumen del estado de backup de los componentes que soportan su tenant, con lenguaje funcional (no técnico), visible solo cuando el despliegue soporta la funcionalidad.

**RF-T01-06 — Indicación explícita de funcionalidad no disponible**
Cuando un componente o el despliegue completo no soporta visibilidad de backup, la consola y la API deben devolver un estado explícito (`not_available`) en lugar de omitir el componente o la sección.

**RF-T01-07 — Refresco periódico del estado de backup**
El sistema debe consultar el estado de backup de los componentes con una frecuencia configurable (no en tiempo real, sino con un ciclo de recolección). El resultado se almacena como snapshot consultable por la API y la consola.

**RF-T01-08 — Formato estandarizado del payload de estado**
El endpoint API debe devolver un payload JSON con un esquema documentado y versionado, consumible tanto por la consola como por sistemas de monitoreo externo.

### 4.2 Límites claros de alcance

**Incluido en US-BKP-01-T01:**
- Modelo de datos de estado de backup.
- Contrato/interfaz de adaptador de backup.
- Al menos un adaptador concreto para un componente con backup observable.
- Endpoint API REST de consulta de estado de backup (lectura).
- Vista de backup en consola administrativa (superadmin/SRE).
- Vista resumida en consola del tenant (tenant owner).
- Indicación de funcionalidad no disponible cuando el despliegue no la soporte.
- Ciclo de recolección periódica del estado.

**Excluido (tareas hermanas):**
- Iniciar o programar backups → **US-BKP-01-T02**
- Auditoría de acciones de recuperación → **US-BKP-01-T03**
- Confirmaciones y prechecks de restauración → **US-BKP-01-T04**
- Pruebas y simulaciones de restore → **US-BKP-01-T05**
- Documentación de alcance del soporte de backup por perfil → **US-BKP-01-T06**

---

## 5. Permisos, aislamiento multi-tenant, auditoría y seguridad

### 5.1 Aislamiento multi-tenant

- El estado de backup se almacena y se consulta siempre en el contexto de un `tenant_id`. Un tenant nunca puede ver el estado de backup de otro tenant.
- La vista global (todos los tenants) solo está disponible para actores con rol superadmin o SRE.
- Los adaptadores de backup consultan el estado del componente en el contexto del tenant; si el componente es compartido (multi-tenant sobre la misma instancia), el adaptador debe segregar el estado por tenant o, si no es posible, reportar el estado a nivel de instancia compartida solo a roles privilegiados (superadmin/SRE), nunca al tenant owner.

### 5.2 Permisos de acceso

| Actor | Puede consultar estado de backup de su tenant | Puede consultar estado global (todos los tenants) | Puede ver identificadores técnicos de infraestructura |
|---|---|---|---|
| Tenant owner | ✅ Sí (resumen funcional) | ❌ No | ❌ No |
| Workspace admin | ✅ Sí (resumen funcional, si tiene permiso heredado) | ❌ No | ❌ No |
| SRE / Platform team | ✅ Sí | ✅ Sí | ✅ Sí |
| Superadmin | ✅ Sí | ✅ Sí | ✅ Sí |
| Proceso interno (recolector de estado) | ✅ Sí (con credencial de servicio) | ✅ Sí (scope de recolección) | ✅ Sí |

### 5.3 Auditoría

- Las consultas al endpoint de estado de backup por parte de actores humanos deben generar un registro de acceso en el pipeline de auditoría estándar de la plataforma (ya existente por US-OBS-01).
- Las consultas automatizadas del ciclo de recolección no generan eventos de auditoría individuales (para evitar volumen excesivo), pero sí se registra el resultado de cada ciclo de recolección como evento operacional.
- Esta tarea no genera eventos de auditoría de acción de backup/restore (eso corresponde a US-BKP-01-T03), solo de consulta de estado.

### 5.4 Seguridad

- El endpoint API de estado de backup debe estar protegido con autenticación (token JWT de Keycloak). No es público.
- Los adaptadores de backup que consultan sistemas externos deben usar credenciales de servicio con el menor privilegio posible (solo lectura de estado de backup, no capacidad de iniciar o restaurar backups).
- La información de estado de backup no debe incluir credenciales, rutas internas de almacenamiento ni detalles de configuración de infraestructura en el payload de la API. Solo estado operacional.
- Si un adaptador falla, el error interno no se propaga al consumidor. Se muestra un estado genérico de indisponibilidad.

### 5.5 Trazabilidad con el backlog

| Requisito funcional | RF del backlog |
|---|---|
| Modelo de estado y endpoint de consulta | RF-BKP-001 |
| Vista de estado en consola | RF-BKP-002 |
| Modelo de adaptadores y visibilidad por perfil de despliegue | RF-BKP-005 |

---

## 6. Criterios de aceptación

**CA-01 — Endpoint devuelve estado de backup por tenant**
Dado un `tenant_id` con componentes gestionados que tienen backup configurado, cuando un superadmin consulta el endpoint de estado de backup, entonces recibe un payload JSON con al menos un componente cuyo estado es `success`, `failure` o `in_progress`, incluyendo timestamp del último backup exitoso.

**CA-02 — Endpoint devuelve `not_configured` para componente sin backup**
Dado un componente gestionado que no tiene mecanismo de backup configurado en el despliegue, cuando se consulta el estado de backup del tenant asociado, entonces ese componente aparece en la respuesta con estado `not_configured`.

**CA-03 — Endpoint devuelve `not_available` para componente sin adaptador**
Dado un tipo de componente para el cual no existe adaptador de backup registrado, cuando se consulta el estado de backup, entonces el componente aparece con estado `not_available`.

**CA-04 — Aislamiento multi-tenant en la API**
Dado un tenant owner autenticado, cuando consulta el endpoint de estado de backup, entonces solo recibe el estado de los componentes de su propio tenant. No recibe información de otros tenants.

**CA-05 — Vista global solo para roles privilegiados**
Dado un tenant owner autenticado, cuando intenta consultar el endpoint sin filtro de tenant (vista global), entonces recibe `HTTP 403`. Dado un superadmin, la misma consulta retorna el estado de todos los tenants.

**CA-06 — Consola administrativa muestra estado de backup con indicadores visuales**
Dado un superadmin que accede a la sección de backup en la consola, entonces ve un listado de componentes por tenant con indicadores de estado visual diferenciados (OK verde, Warning amarillo, Error rojo, No configurado gris, No disponible gris atenuado).

**CA-07 — Consola del tenant muestra resumen funcional**
Dado un tenant owner que accede a su consola, cuando el despliegue soporta visibilidad de backup, entonces ve un resumen con lenguaje funcional (p. ej., "Base de datos relacional — Último backup: hace 3 horas — Estado: OK"). No ve identificadores técnicos de infraestructura.

**CA-08 — Indicación explícita cuando el despliegue no soporta backup**
Dado un despliegue que no tiene backup configurado para ningún componente, cuando cualquier actor accede a la sección de backup, entonces la consola muestra un mensaje explícito indicando que la visibilidad de backup no está disponible en este perfil de despliegue.

**CA-09 — Degradación informativa ante fallo de adaptador**
Dado un adaptador de backup que no responde (timeout), cuando se consulta el estado, entonces se muestra el último estado conocido con el timestamp de la última lectura exitosa y una indicación de que la información puede estar desactualizada.

**CA-10 — Ciclo de recolección actualiza el estado periódicamente**
Dado un componente con backup configurado cuyo estado cambia (p. ej., un nuevo backup exitoso), cuando ha transcurrido el intervalo de recolección configurado, entonces el endpoint y la consola reflejan el estado actualizado.

**CA-11 — Payload de la API no expone información sensible**
Dado cualquier respuesta del endpoint de estado de backup, cuando se inspecciona el payload, entonces no contiene credenciales, rutas internas de almacenamiento, cadenas de conexión ni detalles de configuración de infraestructura.

---

## 7. Riesgos, supuestos y preguntas abiertas

### 7.1 Riesgos

| ID | Descripción | Probabilidad | Impacto | Mitigación sugerida |
|---|---|---|---|---|
| R-01 | Heterogeneidad de mecanismos de backup entre despliegues dificulta un modelo de estado unificado | Alta | Alto | Definir un modelo de estado mínimo común y permitir campos de detalle opcionales por tipo de adaptador. |
| R-02 | Componentes compartidos multi-tenant no pueden segregar estado de backup por tenant | Media | Alto | El adaptador reporta estado a nivel de instancia solo a roles privilegiados. El tenant owner ve un estado derivado o "no disponible" si la segregación no es posible. |
| R-03 | Frecuencia del ciclo de recolección demasiado alta genera carga innecesaria en los componentes | Media | Medio | Hacer la frecuencia configurable por componente y por despliegue. Valores conservadores por defecto. |
| R-04 | Ausencia de un estándar de reporte de backup entre los componentes gestionados (PostgreSQL, MongoDB, S3, etc.) | Alta | Medio | El modelo de adaptadores absorbe la heterogeneidad. Cada adaptador traduce el formato nativo a la interfaz común. |

### 7.2 Supuestos

**S-01**: El sistema de observabilidad básico (US-OBS-01) ya está operativo y proporciona el pipeline de auditoría y eventos que esta tarea consume para registrar accesos.

**S-02**: El modelo de despliegue (US-DEP-03) permite declarar qué componentes están presentes y si tienen mecanismo de backup habilitado. Esta tarea consume esa información para decidir qué adaptadores activar.

**S-03**: Al menos un componente gestionado (PostgreSQL o MongoDB) tiene un mecanismo de backup observable en el entorno de referencia del proyecto, suficiente para implementar y validar al menos un adaptador concreto.

**S-04**: El backend de la consola puede ejecutarse como función OpenWhisk y consultar el endpoint de estado de backup con credenciales de servicio.

**S-05**: Los timestamps de backup de los componentes gestionados son consultables de alguna forma (API del operador, ficheros de estado, queries al sistema) sin necesidad de acceso directo al almacenamiento de backups.

### 7.3 Preguntas abiertas

**P-01 — ¿Qué componentes gestionados tienen prioridad para el primer adaptador?**
Hay que decidir si el adaptador MVP se implementa para PostgreSQL, MongoDB, S3 u otro. La elección depende de cuál tiene el mecanismo de backup más observable en el entorno de referencia. No bloquea la especificación, pero sí el plan de implementación.

**P-02 — ¿El tenant owner debe ver el estado de backup por defecto o es una capability del plan?**
Si la visibilidad de backup para tenant owners depende del plan contratado (capability booleana), esta tarea debe coordinarse con el modelo de capabilities de US-PLAN-02. Si es universal para todos los tenants, no hay dependencia adicional.
*Potencialmente bloquea*: la definición de permisos en la consola del tenant.

**P-03 — ¿Cuál es la frecuencia de recolección aceptable por defecto?**
Un ciclo de 5 minutos puede ser suficiente para operaciones. Un ciclo de 1 hora puede ser suficiente para tenant owners. La elección afecta la carga sobre los adaptadores y la frescura de la información. No bloquea la especificación, pero debe definirse antes de implementar.

---

*Documento generado para el stage `speckit.specify` — US-BKP-01-T01 | Rama: `109-backup-status-visibility`*
