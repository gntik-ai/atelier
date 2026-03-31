# Especificación — US-PLAN-02-T05: Enforcement de Capabilities en Gateway, UI y Control Plane

| Campo               | Valor                                                                 |
|---------------------|-----------------------------------------------------------------------|
| **Task ID**         | US-PLAN-02-T05                                                        |
| **Epic**            | EP-19 — Planes, límites y packaging del producto                      |
| **Historia**        | US-PLAN-02 — Hard/soft quotas, capabilities booleanas, overrides y visualización de consumo |
| **Tipo**            | Feature                                                               |
| **Prioridad**       | P0                                                                    |
| **Tamaño**          | M                                                                     |
| **RFs cubiertos**   | RF-PLAN-005, RF-PLAN-006, RF-PLAN-007, RF-PLAN-008                    |
| **Dependencias**    | US-PLAN-01, US-OBS-03, US-PLAN-02-T01, US-PLAN-02-T02, US-PLAN-02-T03, US-PLAN-02-T04 |

---

## 1. Objetivo y problema que resuelve

### Problema

El sistema BaaS tiene planes de producto que definen qué capacidades están contratadas por cada tenant (p. ej., acceso a SQL admin API, webhooks, realtime, funciones públicas, passthrough admin). Sin embargo, en la actualidad **no existe ningún mecanismo activo que aplique esas capacidades**: cualquier tenant puede intentar invocar funcionalidades que no forman parte de su plan, y el sistema no las bloquea ni las oculta.

Esto provoca tres tipos de riesgo:

1. **Riesgo de negocio**: Tenants acceden a capacidades premium sin haberlas contratado, erosionando el modelo de packaging.
2. **Riesgo operacional**: La plataforma no puede garantizar los SLAs diferenciados por plan si no hay enforcement real.
3. **Riesgo de experiencia**: La consola muestra opciones que el tenant no puede usar (frustración, confusión de soporte).

### Objetivo de esta tarea

Aplicar el conjunto de capabilities booleanas efectivas del tenant en los **tres puntos de control** del producto:

- **API Gateway (APISIX)**: bloquear en el perímetro las rutas o verbos que corresponden a capacidades no habilitadas para el tenant.
- **Control Plane (API interna)**: proporcionar un endpoint/contrato que exponga las capabilities efectivas de un tenant, consumible por gateway y consola.
- **Consola web**: ocultar o deshabilitar con indicación clara las opciones de UI vinculadas a capabilities no contratadas.

El *qué* de esta tarea es el **enforcement activo**: que el sistema diga "no puedes" antes de que el tenant incurra en trabajo o costes innecesarios, y que el tenant entienda por qué.

---

## 2. Usuarios y valor recibido

| Actor | Relación con la capacidad | Valor que recibe |
|---|---|---|
| **Tenant owner** | Contrata el plan y gestiona el tenant | Ve exactamente qué tiene habilitado. Si intenta usar algo no contratado, recibe un mensaje claro que le indica cómo ampliarlo, no un error técnico opaco. |
| **Workspace admin** | Opera recursos dentro del tenant | No puede invocar (ni verá en UI) acciones que no corresponden a su plan. Reduce errores y tickets de soporte. |
| **Superadmin** | Gestiona planes y overrides para todos los tenants | Puede confiar en que los overrides puntuales que concede son los únicos caminos para habilitar capacidades fuera del plan base. |
| **Finance / Product Ops** | Define planes y su packaging | El enforcement real hace que los planes tengan valor de negocio real: lo que se cobra es lo que se habilita. |
| **Equipo de soporte** | Atiende tickets de tenants | Los mensajes de rechazo son informativos y estandarizados: reducen el tiempo medio de resolución porque el error ya indica el motivo. |

---

## 3. Escenarios principales, edge cases y reglas de negocio

### 3.1 Escenarios principales

**E1 — Tenant invoca una ruta bloqueada por su plan**

> Un tenant con plan *Starter* (sin webhooks) hace `POST /webhooks`. El gateway, al resolver las capabilities efectivas del tenant, detecta que `webhooks` está en `false`. La solicitud se rechaza con `HTTP 402 Payment Required` y un cuerpo JSON estandarizado que incluye la capability bloqueada y un enlace o mensaje de upgrade.

**E2 — Tenant con override puntual accede a capacidad no incluida en el plan base**

> Un tenant tiene plan *Starter* pero el superadmin le concedió un override que habilita `realtime`. El gateway y la consola deben reflejar esa capability como activa para ese tenant específico. El cálculo de capabilities efectivas es: `plan_base ∪ overrides_tenant`.

**E3 — Tenant hace downgrade de plan**

> Un tenant pasa de *Pro* (con `sql_admin_api: true`) a *Starter* (con `sql_admin_api: false`). A partir de ese momento todas las llamadas a `/admin/sql` deben ser rechazadas y la opción debe desaparecer/deshabilitarse en la consola. No hay período de gracia para capabilities booleanas (sí puede existir para cuotas cuantitativas, pero eso es US-PLAN-02-T01).

**E4 — Consola refleja capabilities en tiempo real**

> Un workspace admin abre la consola. Las secciones de navegación y los botones de acción vinculados a `webhooks`, `realtime`, `functions_public`, `sql_admin_api`, `passthrough_admin` muestran estado *disponible* o *bloqueado* según las capabilities efectivas del tenant en ese momento.

**E5 — Capability enforcement en llamada API autenticada desde integración tercera**

> Un sistema externo integrado con el tenant (no la consola) hace una llamada autenticada a una ruta que requiere `webhooks`. Si la capability no está activa, el gateway la rechaza igual que en E1. El enforcement es independiente del canal de acceso (consola vs. integración directa).

### 3.2 Edge cases

| Caso | Comportamiento esperado |
|---|---|
| El tenant no tiene ningún plan asignado | Todas las capabilities están en `false`. Ninguna ruta premium es accesible. |
| El sistema de planes no está disponible (error / timeout al resolver capabilities) | El gateway aplica **deny-by-default**: bloquea la solicitud si no puede confirmar que la capability está habilitada. Se registra un evento de degradación observable. |
| Override que habilita una capability que el plan no incluye, pero luego el plan se actualiza para incluirla | El resultado es idempotente: la capability sigue activa. No se requiere eliminar el override manualmente. |
| Override que deshabilita una capability que el plan sí incluye | El override prevalece (restricción explícita). La capability queda bloqueada para ese tenant. |
| Tenant con múltiples workspaces — ¿se puede segmentar capability por workspace? | **Fuera de alcance de esta tarea.** Las capabilities son a nivel tenant en US-PLAN-02-T05. Sub-capabilities a nivel workspace pertenecen a US-PLAN-02-T03. |
| Cambio de plan con efectividad futura (fecha programada) | El enforcement se activa en la fecha efectiva. Hasta ese momento, el plan vigente continúa aplicándose. |
| Llamada que usa múltiples capabilities a la vez (batch/pipeline) | Si cualquiera de las capabilities requeridas no está activa, el conjunto completo se rechaza. |

### 3.3 Reglas de negocio y gobierno

**RN-01 — Las capabilities efectivas son el único criterio de enforcement**
El gateway y la consola no razonan sobre el plan por nombre, sino sobre el mapa de capabilities efectivas resuelto para el tenant en ese instante. El plan es una forma de definir ese mapa, no el mecanismo de enforcement en sí.

**RN-02 — Deny-by-default en ausencia de señal**
Si no puede determinarse si una capability está habilitada, se deniega el acceso. La seguridad prevalece sobre la disponibilidad.

**RN-03 — Los overrides son aditivos o restrictivos, nunca neutrales implícitamente**
Un override explícito en `true` habilita. Un override explícito en `false` restringe, incluso si el plan base incluye la capability.

**RN-04 — El rechazo debe ser informativo y estandarizado**
El error devuelto al consumidor (API o UI) debe identificar: (a) la capability bloqueada, (b) la razón (plan no lo incluye o override restrictivo), (c) la acción sugerida (contactar soporte, consultar plan). Nunca un error genérico 403/404 que oculte el motivo real.

**RN-05 — La UI no debe mostrar como accesibles capacidades no habilitadas**
Ocultar o deshabilitar (según la gravedad de la restricción y el contexto de navegación) es mandatorio. El tenant no debe descubrir la restricción al hacer clic, sino antes de intentar la acción.

**RN-06 — Auditoría de enforcement**
Cada rechazo por capability debe generar un evento de auditoría con: tenant ID, workspace ID (si aplica), capability bloqueada, timestamp, actor (token/usuario), canal (gateway/consola/API interna).

---

## 4. Requisitos funcionales y límites de alcance

### 4.1 Requisitos funcionales verificables

**RF-T05-01 — Contrato de capabilities efectivas**
Debe existir un contrato (endpoint o interfaz interna) que, dado un `tenant_id`, devuelva el mapa de capabilities booleanas efectivas de ese tenant. El resultado es la combinación de plan base + overrides activos.

**RF-T05-02 — Enforcement en API Gateway**
El API Gateway (APISIX) debe evaluar las capabilities efectivas del tenant antes de enrutar cualquier solicitud a rutas marcadas como `capability-gated`. Si la capability requerida no está activa, la solicitud se rechaza con el código y cuerpo estandarizado definido en RN-04.

**RF-T05-03 — Definición de la tabla de routing de capabilities**
Debe existir un registro mantenible que mapee cada ruta (o grupo de rutas) del API Gateway a la capability booleana que la protege. Este mapa es el que el gateway consulta para saber qué capability verificar.

**RF-T05-04 — Enforcement en la consola (UI)**
Los componentes de la consola vinculados a capacidades premium deben consultar las capabilities efectivas del tenant al cargar el contexto de sesión y ajustar su estado (visible/oculto, habilitado/deshabilitado) en consecuencia.

**RF-T05-05 — Indicación clara al usuario en UI**
Cuando un elemento de UI está deshabilitado por restricción de plan, debe mostrar un indicador visual (tooltip, badge, modal) que explique que la funcionalidad requiere un plan superior, sin revelar detalles internos de configuración.

**RF-T05-06 — Rechazo estandarizado con información accionable**
El cuerpo de error del rechazo en gateway y API debe incluir: `capability` bloqueada, `reason` legible por humano, `upgrade_path` (URL o referencia al canal de upgrade). Debe cumplir un esquema JSON documentado.

**RF-T05-07 — Evento de auditoría por enforcement**
Cada rechazo activo de una solicitud por capability no habilitada genera un evento de auditoría persistido, con los campos definidos en RN-06.

**RF-T05-08 — Resolución fresca de capabilities (TTL/invalidación)**
El mecanismo de enforcement no debe depender de datos de capabilities obsoletos por más de un umbral de tiempo configurable. Un cambio de plan o override debe reflejarse en el enforcement dentro de ese umbral. (El valor concreto del TTL es una decisión de plan/implementación, no de esta especificación.)

### 4.2 Límites claros de alcance

**Incluido en US-PLAN-02-T05:**
- Enforcement activo de capabilities booleanas en gateway, control plane (contrato de capabilities) y consola.
- Definición del contrato de capabilities efectivas (schema/interfaz).
- Mapa de rutas del gateway a capabilities.
- Indicadores visuales en consola para capacidades bloqueadas.
- Eventos de auditoría de enforcement.
- Comportamiento ante degradación (deny-by-default).

**Excluido (otras tareas de US-PLAN-02):**
- Definición y gestión del catálogo de capabilities booleanas por plan → **US-PLAN-02-T02**
- Cálculo de límites efectivos cuantitativos (cuotas) y subcuotas → **US-PLAN-02-T03**
- Visualización en consola del plan activo y consumo de cuotas → **US-PLAN-02-T04**
- Pruebas automatizadas de enforcement → **US-PLAN-02-T06**
- Interfaz de gestión de overrides por superadmin → **US-PLAN-02-T01**

---

## 5. Permisos, aislamiento multi-tenant, auditoría y seguridad

### 5.1 Aislamiento multi-tenant

- Las capabilities efectivas son siempre resueltas en el contexto de un `tenant_id` específico. No existe resolución cross-tenant.
- El contrato de capabilities no expone capabilities de otros tenants bajo ninguna circunstancia.
- El token de autenticación (Keycloak) debe contener o permitir derivar el `tenant_id` para que el gateway pueda resolver capabilities sin llamadas adicionales de enriquecimiento que introduzcan latencia crítica.

### 5.2 Permisos de acceso al contrato de capabilities

| Actor | Puede consultar capabilities de su propio tenant | Puede consultar capabilities de cualquier tenant |
|---|---|---|
| Tenant owner / Workspace admin | ✅ Sí (solo las propias) | ❌ No |
| Superadmin | ✅ Sí | ✅ Sí |
| Proceso interno (gateway, consola backend) | ✅ Sí (con credencial de servicio) | ❌ No (scope acotado al tenant del request) |

### 5.3 Auditoría

Cada evento de rechazo por enforcement debe registrarse con:

```text
tenant_id        : UUID del tenant
workspace_id     : UUID del workspace si aplica, null si es operación a nivel tenant
actor_id         : identificador del usuario o token de servicio
actor_type       : user | service_account
capability       : nombre de la capability bloqueada (p. ej. "webhooks")
reason           : plan_restriction | override_restriction | plan_unresolvable
channel          : gateway | console | internal_api
resource_path    : ruta del recurso solicitado
timestamp        : ISO 8601 UTC
request_id       : identificador de correlación del request
```text

Los eventos de auditoría de enforcement se tratan como eventos de seguridad y deben tener mayor retención que los eventos operacionales ordinarios.

### 5.4 Seguridad

- El contrato de capabilities debe estar protegido con autenticación. No es un endpoint público.
- En caso de fallo del sistema de capabilities (timeout, error), la postura de seguridad es **deny-by-default** (RN-02).
- Los nombres internos de capabilities no deben filtrarse en mensajes de error dirigidos a usuarios no privilegiados más allá de lo necesario para la acción de upgrade.
- Las credenciales de servicio usadas por el gateway para resolver capabilities deben tener el menor privilegio posible (solo lectura, solo capabilities).

### 5.5 Trazabilidad con el backlog

| Requisito funcional | RF del backlog |
|---|---|
| Contrato de capabilities efectivas | RF-PLAN-005 |
| Enforcement en gateway | RF-PLAN-006 |
| Enforcement en consola (UI) | RF-PLAN-007 |
| Auditoría de enforcement | RF-PLAN-008 |

---

## 6. Criterios de aceptación

Los siguientes criterios deben poder verificarse de forma determinista para considerar esta tarea bien implementada:

**CA-01 — Rechazo correcto en gateway**
Dado un tenant con `webhooks: false`, cuando realiza `POST /webhooks` con token válido, entonces el gateway responde `HTTP 402` con un cuerpo JSON que incluye `"capability": "webhooks"` y un campo `upgrade_path` no vacío. La solicitud no llega al servicio downstream.

**CA-02 — Permiso correcto en gateway**
Dado un tenant con `webhooks: true` (por plan o por override), cuando realiza `POST /webhooks` con token válido, entonces el gateway enruta la solicitud al servicio downstream sin rechazo por capability.

**CA-03 — Override prevalece sobre plan base (habilitación)**
Dado un tenant con plan Starter (`realtime: false`) y un override activo `realtime: true`, cuando consulta sus capabilities efectivas, entonces la respuesta indica `realtime: true` y el gateway permite las rutas de realtime.

**CA-04 — Override restrictivo prevalece sobre plan base (restricción)**
Dado un tenant con plan Pro (`sql_admin_api: true`) y un override restrictivo `sql_admin_api: false`, cuando consulta sus capabilities efectivas, entonces la respuesta indica `sql_admin_api: false` y el gateway bloquea las rutas de SQL admin.

**CA-05 — Deny-by-default ante fallo de resolución**
Dado un tenant válido y un fallo simulado del sistema de capabilities (timeout o error 5xx), cuando el tenant intenta acceder a una ruta capability-gated, entonces el gateway rechaza la solicitud con `HTTP 503` o `HTTP 502` (según política), no la enruta, y genera un evento de degradación en el sistema de observabilidad.

**CA-06 — Consola deshabilita elemento vinculado a capability inactiva**
Dado un tenant con `webhooks: false`, cuando el workspace admin abre la sección de webhooks en la consola, entonces el botón/acción de creación de webhook está deshabilitado y muestra un indicador que indica la restricción de plan.

**CA-07 — Consola habilita elemento cuando la capability está activa**
Dado el mismo tenant con `webhooks: true`, cuando el workspace admin abre la sección de webhooks, entonces el botón/acción de creación está habilitado y operable.

**CA-08 — Generación de evento de auditoría**
Dado un rechazo por capability (CA-01), cuando se consulta el registro de auditoría, entonces existe un evento con `tenant_id`, `capability: "webhooks"`, `reason: "plan_restriction"`, `channel: "gateway"` y `timestamp` dentro del período del rechazo.

**CA-09 — El contrato de capabilities refleja cambios de plan dentro del TTL**
Dado un tenant que cambia de plan Pro a Starter, cuando ha transcurrido el TTL configurado de invalidación, entonces el contrato de capabilities para ese tenant retorna `sql_admin_api: false` y las rutas correspondientes son rechazadas.

**CA-10 — El mapa de rutas a capabilities está documentado y es mantenible**
Existe un registro formal (fichero de configuración, tabla en base de datos o documento de referencia) que mapea cada ruta capability-gated a su capability booleana. Puede modificarse sin cambios de código en el gateway.

---

## 7. Riesgos, supuestos y preguntas abiertas

### 7.1 Riesgos

| ID | Descripción | Probabilidad | Impacto | Mitigación sugerida |
|---|---|---|---|---|
| R-01 | Latencia adicional en el gateway por resolución de capabilities en cada request | Media | Alto | Caché con TTL configurable en el gateway; pre-carga del contexto del tenant al autenticar. |
| R-02 | Inconsistencia temporal entre cambio de plan y propagación al gateway (ventana de enforcement) | Media | Medio | TTL corto + mecanismo de invalidación proactiva en cambios de plan. Documentar la ventana máxima aceptable. |
| R-03 | Experiencia de usuario degradada si la consola no recarga capabilities al cambiar de contexto (workspace switch, etc.) | Media | Medio | Definir cuándo la consola recarga el contexto de capabilities (login, switch de workspace, polling background). |
| R-04 | Scope creep: presión para incluir enforcement cuantitativo (cuotas) en esta tarea | Alta | Medio | Mantener los límites de alcance estrictos. US-PLAN-02-T01 y T03 cubren cuotas. Esta tarea es solo capabilities booleanas. |

### 7.2 Supuestos

**S-01**: Las capabilities booleanas del plan ya están modeladas en el sistema de datos como resultado de US-PLAN-02-T02. Esta tarea asume que el contrato de capabilities tiene datos que consumir.

**S-02**: El mapa de rutas del gateway a capabilities puede ser relativamente estático (no cambia con cada release del producto). Si las rutas cambian frecuentemente, el mantenimiento del mapa se convierte en una carga operacional no contemplada aquí.

**S-03**: El sistema de autenticación (Keycloak) proporciona el `tenant_id` como claim en el token JWT, de forma que el gateway pueda identificar el tenant sin llamadas adicionales de lookup.

**S-04**: La consola tiene acceso a las capabilities efectivas del tenant a través del mismo contrato definido en RF-T05-01, bien directamente bien a través del backend de la consola en OpenWhisk.

**S-05**: Los planes "sin plan asignado" son una condición válida y se tratan como "todas las capabilities deshabilitadas" (ver edge case correspondiente).

### 7.3 Preguntas abiertas (solo las que bloquean avanzar)

**P-01 — ¿Cuál es el TTL máximo aceptable para la propagación del enforcement?**
Determina el SLA de activación/desactivación de capabilities. Afecta al diseño de caché del gateway. Si el negocio exige enforcement inmediato al cambiar el plan, se necesita un mecanismo de invalidación proactiva (más complejo). Si un TTL de 1-5 minutos es aceptable, el diseño es más simple.
*Bloquea*: el diseño del mecanismo de caché/invalidación en el plan (etapa siguiente).

**P-02 — ¿Las capabilities se evalúan a nivel de tenant o también a nivel de workspace para esta tarea?**
La especificación asume nivel tenant. Si el producto requiere que ciertas capabilities puedan activarse/desactivarse por workspace (independientemente del plan del tenant), eso amplía el alcance de esta tarea o requiere repartirlo con US-PLAN-02-T03.
*Bloquea*: el contrato de capabilities efectivas si el nivel es workspace.

**P-03 — ¿Cuál es el código HTTP canónico para "capability no contratada"?**
`402 Payment Required` es semánticamente correcto pero poco usado. `403 Forbidden` es más estándar pero puede confundirse con falta de permisos. La elección afecta a integraciones de terceros. Debe definirse antes del plan de implementación.
*Bloquea*: el contrato del error estandarizado (RF-T05-06).

---

*Documento generado para el stage `speckit.specify` — US-PLAN-02-T05 | Rama: `107-capability-enforcement`*
