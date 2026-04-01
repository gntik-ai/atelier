# Especificación — US-BKP-01-T04: Confirmaciones reforzadas y prechecks antes de restauraciones destructivas

| Campo               | Valor                                                                 |
|---------------------|-----------------------------------------------------------------------|
| **Task ID**         | US-BKP-01-T04                                                         |
| **Epic**            | EP-20 — Backup, recuperación y continuidad operativa                  |
| **Historia**        | US-BKP-01 — Estado de backup/restore y flujos administrativos de recuperación |
| **Tipo**            | Feature                                                               |
| **Prioridad**       | P1                                                                    |
| **Tamaño**          | M                                                                     |
| **RFs cubiertos**   | RF-BKP-001, RF-BKP-002, RF-BKP-005                                   |
| **Dependencias**    | US-BKP-01-T01 (merged PR#156), US-BKP-01-T02 (merged PR#157), US-BKP-01-T03 (merged PR#158) |

---

## 1. Objetivo y problema que resuelve

### Problema

Tras US-BKP-01-T02, la plataforma permite a actores autorizados iniciar backups bajo demanda y solicitar restauraciones de componentes gestionados. Tras US-BKP-01-T03, cada una de estas acciones queda registrada en un trail de auditoría completo. Sin embargo, **las operaciones de restauración son inherentemente destructivas** — reemplazan el estado actual de un componente con un estado anterior — y actualmente **no existe ningún mecanismo de defensa previo a la ejecución** que proteja contra errores humanos, acciones precipitadas o restauraciones sobre un estado de datos que ha divergido significativamente desde el snapshot destino:

1. **No hay confirmación reforzada.** Un SRE o superadmin puede iniciar una restauración con un solo clic o una sola llamada API. No se le pide que confirme la acción de forma deliberada, que verifique el tenant y componente afectados ni que reconozca el impacto potencial.
2. **No hay prechecks automáticos.** La plataforma no verifica antes de aceptar la solicitud si el componente destino tiene operaciones activas (escrituras, conexiones, jobs), si hay un backup más reciente que el snapshot seleccionado (restaurar a un punto antiguo descartando un backup más nuevo), si el snapshot destino corresponde efectivamente al componente y tenant solicitados, o si el tiempo transcurrido desde el snapshot es inusualmente largo.
3. **No hay diferenciación por nivel de riesgo.** Todas las restauraciones se tratan por igual, independientemente de si son parciales (un solo componente de un tenant) o completas (todos los componentes de un tenant), o de si el intervalo temporal es corto (minutos) o largo (días/semanas).
4. **No hay posibilidad de abortar tras ver las advertencias.** Un actor que inicia un restore no recibe información contextual antes de que la operación sea despachada al adaptador. Si quisiera reconsiderar, ya es tarde.

### Objetivo de esta tarea

Introducir un flujo de confirmación reforzada y prechecks automáticos que se interponga entre la solicitud de restauración (US-BKP-01-T02) y el despacho efectivo al adaptador. Este flujo:

- Presenta al solicitante un resumen del impacto y las advertencias relevantes **antes** de que la operación sea irrevocable.
- Ejecuta verificaciones automáticas (prechecks) sobre el estado del componente y del snapshot para detectar condiciones de riesgo.
- Requiere una confirmación explícita y deliberada que demuestre que el actor ha revisado las advertencias.
- Clasifica las restauraciones por nivel de riesgo y ajusta la severidad de las confirmaciones.
- Registra la decisión de confirmación (aceptada o abortada) como parte del trail de auditoría (US-BKP-01-T03).

El resultado es que las restauraciones destructivas no se ejecutan sin que el actor haya visto y reconocido las condiciones de riesgo, reduciendo significativamente la probabilidad de errores humanos irreversibles.

---

## 2. Usuarios afectados y valor recibido

| Actor | Relación con la capacidad | Valor que recibe |
|---|---|---|
| **SRE / Platform team** | Ejecutor habitual de restauraciones | Recibe advertencias contextuales antes de ejecutar un restore, lo que le permite abortar si detecta que el snapshot, componente o tenant no son los correctos. Reduce el riesgo de errores operacionales en situaciones de alta presión (incidentes). |
| **Superadmin** | Administrador global que puede iniciar restauraciones sobre cualquier tenant | Obtiene un flujo de confirmación que le obliga a verificar el alcance de la operación. Especialmente valioso cuando opera sobre tenants ajenos, donde la familiaridad con el contexto es menor. |
| **Equipo de seguridad** | Revisor de actividad privilegiada | Puede verificar en el trail de auditoría que cada restauración fue precedida por una confirmación explícita y que el actor fue informado de las condiciones de riesgo antes de proceder. |
| **Equipo de cumplimiento / auditoría** | Verificador de controles | Dispone de evidencia auditable de que las acciones destructivas pasan por un control de confirmación reforzada, un requisito frecuente en marcos de cumplimiento (SOC 2, ISO 27001). |
| **Tenant owner** | Consumidor indirectamente afectado | Aunque no ejecuta restauraciones, se beneficia de que las restauraciones sobre los recursos de su tenant requieran verificación explícita por parte del operador. |

---

## 3. Escenarios principales, edge cases y reglas de negocio

### 3.1 Escenarios principales

**E1 — Restore estándar con confirmación reforzada vía consola**

> Un SRE selecciona un snapshot de un componente de un tenant y pulsa "Restaurar a este punto" (flujo de US-BKP-01-T02). En lugar de despachar la operación inmediatamente, la plataforma ejecuta los prechecks y presenta un diálogo de confirmación reforzada que muestra: tenant afectado, componente e instancia, snapshot destino con su timestamp, antigüedad del snapshot (tiempo transcurrido desde su creación), resultado de los prechecks (cada uno con estado OK / Advertencia / Error bloqueante), y un resumen del nivel de riesgo calculado (normal, elevado, crítico). El SRE revisa la información. Si los prechecks no contienen errores bloqueantes, puede confirmar escribiendo el nombre del tenant en un campo de texto (confirmación deliberada) y pulsando "Confirmar restauración". Solo entonces la operación se despacha al adaptador.

**E2 — Restore con precheck bloqueante**

> Un superadmin solicita la restauración de un componente, pero el precheck detecta que ya hay una operación de restore en progreso sobre ese mismo componente-instancia-tenant. La plataforma muestra un error bloqueante en el diálogo de confirmación y deshabilita el botón de confirmación. El superadmin no puede proceder hasta que la operación activa finalice. El intento y el bloqueo se registran en auditoría.

**E3 — Restore con advertencias no bloqueantes**

> Un SRE solicita restaurar un componente a un snapshot de hace 72 horas. El precheck genera una advertencia indicando que la antigüedad del snapshot supera el umbral configurado y que existen snapshots más recientes. La advertencia aparece en el diálogo de confirmación, el nivel de riesgo sube a "elevado", pero el SRE puede proceder si confirma deliberadamente. La advertencia mostrada y la decisión de proceder se registran en auditoría.

**E4 — Restore vía API con flujo de confirmación en dos pasos**

> Un sistema de automatización envía una solicitud de restore vía API. La API no despacha la operación directamente, sino que crea una **solicitud de restore pendiente de confirmación** con un token único y devuelve el resumen de prechecks, advertencias y nivel de riesgo. El sistema revisa la respuesta y, si decide proceder, envía una segunda llamada API de confirmación incluyendo el token y un campo explícito `"confirmed": true`. Solo entonces la operación se despacha. Si el token expira sin confirmación, la solicitud se cancela automáticamente.

**E5 — Abort de restauración tras ver las advertencias**

> Un superadmin inicia una solicitud de restore en la consola. El diálogo de confirmación muestra que el snapshot tiene 5 días de antigüedad y que el componente tiene conexiones activas. El superadmin decide no proceder y pulsa "Cancelar". La solicitud se marca como `aborted_by_user` y se registra en auditoría con el motivo de cancelación y las advertencias que se presentaron.

**E6 — Restore de riesgo crítico requiere confirmación adicional**

> Un SRE solicita restaurar **todos los componentes** de un tenant (restore completo). Los prechecks clasifican la operación como riesgo crítico. Además de la confirmación por nombre de tenant, la plataforma requiere que un segundo actor autorizado (superadmin distinto del solicitante) apruebe la operación, o que el solicitante introduzca un código OTP de su sesión MFA activa. Solo tras esta segunda verificación se despacha la operación.

### 3.2 Edge cases

| Caso | Comportamiento esperado |
|---|---|
| La ejecución de los prechecks falla (timeout del adaptador, error interno) | La plataforma muestra un error en la sección de prechecks indicando que no fue posible completar la verificación. El nivel de riesgo se eleva automáticamente a "elevado" y se muestra una advertencia adicional: "No se pudieron completar todas las verificaciones previas". El actor puede proceder si confirma deliberadamente. |
| El snapshot seleccionado deja de existir entre el inicio de la solicitud y la confirmación | Al recibir la confirmación, la plataforma revalida la existencia del snapshot. Si ya no existe, rechaza la confirmación con un error específico y cancela la solicitud pendiente. |
| El token de confirmación API expira (timeout configurable) | La solicitud pendiente pasa a estado `expired`. Si el consumidor envía la confirmación con un token expirado, recibe un error `confirmation_token_expired`. Debe iniciar una nueva solicitud. |
| El actor intenta confirmar un restore sobre un tenant/componente distinto al de la solicitud original | La plataforma rechaza la confirmación. El token está vinculado a la solicitud específica (tenant, componente, snapshot). No es reutilizable ni transferible. |
| Se solicita restore parcial (un solo componente) con riesgo normal | Los prechecks pasan sin advertencias. El nivel de riesgo es "normal". Se requiere solo la confirmación estándar (escribir nombre del tenant). No se requiere segundo factor ni segundo actor. |
| El solicitante pierde la sesión o cierra la consola antes de confirmar | La solicitud queda pendiente. Tras el timeout de confirmación (configurable), se cancela automáticamente y se registra como `expired` en auditoría. |
| Restore solicitado fuera del horario operativo configurado | El precheck genera una advertencia no bloqueante indicando que la operación se solicita fuera del horario operativo definido. El nivel de riesgo se eleva. El actor puede proceder con confirmación deliberada. |
| Prechecks detectan que no hay backup reciente del estado actual antes de restaurar | Se genera una advertencia no bloqueante sugiriendo crear un backup del estado actual antes de restaurar. La plataforma no bloquea, pero la advertencia queda registrada en auditoría. |

### 3.3 Reglas de negocio y gobierno

**RN-01 — Toda restauración requiere confirmación reforzada**
Ninguna operación de restore se despacha al adaptador sin pasar por el flujo de confirmación. Esto aplica tanto a la consola como a la API. No hay un modo "bypass" ni "force" que salte la confirmación.

**RN-02 — Los prechecks son obligatorios pero no todos son bloqueantes**
Los prechecks se ejecutan siempre antes de presentar el diálogo de confirmación. Los resultados se clasifican en:
- **OK**: la verificación pasó sin observaciones.
- **Advertencia** (no bloqueante): se detectó una condición de riesgo que el actor debe conocer pero puede aceptar.
- **Error bloqueante**: se detectó una condición que impide la restauración. El actor no puede confirmar hasta que la condición se resuelva.

**RN-03 — Nivel de riesgo calculado a partir de los prechecks y el alcance**
El nivel de riesgo de una restauración se determina combinando:
- Alcance: parcial (un componente) vs. completo (todos los componentes de un tenant).
- Antigüedad del snapshot: reciente (< umbral configurado) vs. antiguo (> umbral).
- Presencia de advertencias en los prechecks.
- Horario de la solicitud respecto al horario operativo configurado.

Los niveles resultantes son:
- **Normal**: restore parcial, snapshot reciente, sin advertencias.
- **Elevado**: snapshot antiguo, advertencias presentes, horario no operativo, o prechecks incompletos.
- **Crítico**: restore completo de un tenant, o acumulación de múltiples factores de riesgo.

**RN-04 — Confirmación deliberada proporcional al riesgo**
- Riesgo normal: el actor escribe el nombre del tenant en un campo de confirmación y pulsa confirmar.
- Riesgo elevado: igual que normal, más reconocimiento explícito de las advertencias (checkbox o equivalente).
- Riesgo crítico: igual que elevado, más segundo factor (OTP de sesión MFA activa) o aprobación de un segundo actor autorizado.

**RN-05 — La confirmación y sus prechecks se registran en auditoría**
El resultado de los prechecks, las advertencias presentadas, el nivel de riesgo calculado y la decisión del actor (confirmar o abortar) se registran como parte del evento de auditoría de la operación (US-BKP-01-T03). Esto incluye el timestamp de la confirmación, el actor que confirmó y, en caso de riesgo crítico, el segundo actor que aprobó.

**RN-06 — Token de confirmación API con expiración y vinculación**
En el flujo API de dos pasos, el token de confirmación:
- Tiene un TTL configurable (por defecto: 5 minutos).
- Está vinculado a la solicitud específica (tenant, componente, snapshot, actor).
- Es de un solo uso: una vez utilizado (para confirmar o abortar), no puede reutilizarse.
- No es transferible entre solicitudes ni entre actores.

**RN-07 — Los prechecks no sustituyen la validación del adaptador**
Los prechecks verifican condiciones observables desde la plataforma antes del despacho. El adaptador puede rechazar la operación por motivos adicionales que la plataforma no puede anticipar (estado interno del componente, locks del proveedor, etc.). Si el adaptador rechaza la operación después de la confirmación, se registra como fallo post-confirmación en auditoría.

**RN-08 — Aislamiento multi-tenant en prechecks y confirmaciones**
Los prechecks solo acceden a información del tenant afectado. Las advertencias presentadas al actor no incluyen información de otros tenants. El token de confirmación incluye el `tenant_id` y se valida contra él.

**RN-09 — Los backups bajo demanda no requieren confirmación reforzada**
Solo las restauraciones pasan por el flujo de confirmación reforzada. Los backups bajo demanda mantienen el flujo directo de US-BKP-01-T02, dado que no son operaciones destructivas.

---

## 4. Requisitos funcionales verificables

**RF-T04-01 — Prechecks automáticos antes de aceptar una restauración**
Antes de presentar la confirmación al actor, la plataforma ejecuta un conjunto de prechecks que, como mínimo, verifican:
- No hay otra operación de restore activa para el mismo componente-instancia-tenant.
- El snapshot destino existe y corresponde al componente y tenant solicitados.
- La antigüedad del snapshot (tiempo desde su creación) respecto al umbral configurado.
- La existencia de snapshots más recientes que el seleccionado.
- Si el componente tiene operaciones activas conocidas (conexiones, jobs).
Cada precheck devuelve un resultado: `ok`, `warning` o `blocking_error`, con un mensaje descriptivo.

**RF-T04-02 — Clasificación del nivel de riesgo**
La plataforma calcula un nivel de riesgo (`normal`, `elevated`, `critical`) a partir de: el alcance de la restauración (parcial vs. completa), los resultados de los prechecks, la antigüedad del snapshot y el horario de la solicitud. La clasificación se expone en la respuesta de prechecks y en el diálogo de confirmación.

**RF-T04-03 — Diálogo de confirmación reforzada en consola**
La consola presenta un diálogo modal que muestra: tenant afectado, componente e instancia, snapshot destino con timestamp y antigüedad, resultado de cada precheck con su estado, nivel de riesgo calculado y los controles de confirmación adecuados al nivel de riesgo (campo de texto para nombre del tenant, checkbox de reconocimiento de advertencias, y/o campo de OTP / solicitud de segundo actor). El botón de confirmación está deshabilitado mientras haya errores bloqueantes o los campos requeridos no estén completos.

**RF-T04-04 — Flujo de confirmación en dos pasos para la API**
Al recibir una solicitud de restore vía API, la plataforma:
1. Ejecuta los prechecks.
2. Si no hay errores bloqueantes, crea una solicitud pendiente de confirmación con un token único y un TTL configurable.
3. Devuelve al consumidor: token de confirmación, resumen de prechecks, nivel de riesgo y advertencias.
4. La operación no se despacha al adaptador hasta que el consumidor envíe una solicitud de confirmación con el token y `"confirmed": true`.
5. Si el token expira sin confirmación, la solicitud pasa a estado `expired`.
6. Si hay errores bloqueantes, la solicitud se rechaza inmediatamente sin generar token.

**RF-T04-05 — Registro en auditoría de confirmaciones y aborts**
Cada decisión de confirmación (confirmada o abortada) genera un evento de auditoría que incluye: el resultado de los prechecks presentados, el nivel de riesgo calculado, las advertencias mostradas al actor, la decisión del actor (`confirmed` o `aborted`), el timestamp de la decisión y, en caso de riesgo crítico, la identidad del segundo actor/método de verificación utilizado.

**RF-T04-06 — Segundo factor o segundo actor para riesgo crítico**
Cuando el nivel de riesgo es `critical`, la plataforma requiere una verificación adicional antes de despachar la operación. Esta verificación puede ser:
- Introducción de un código OTP de la sesión MFA activa del solicitante.
- Aprobación explícita por un segundo actor autorizado (superadmin distinto del solicitante).
La plataforma no despacha la operación hasta que se complete una de estas verificaciones.

**RF-T04-07 — Revalidación del snapshot al confirmar**
Al recibir la confirmación (tanto en consola como en API), la plataforma verifica nuevamente que el snapshot destino sigue existiendo y que no ha cambiado el estado del componente de forma que invalide los prechecks. Si la revalidación falla, la confirmación se rechaza y se informa al actor.

**RF-T04-08 — Timeout configurable de confirmación**
La solicitud pendiente de confirmación tiene un TTL configurable (por defecto: 5 minutos). Si expira sin confirmación ni cancelación explícita, la solicitud pasa a estado `expired` y se registra en auditoría.

---

## 5. Permisos, multi-tenant, auditoría y seguridad

### 5.1 Permisos

| Acción | Roles autorizados | Notas |
|---|---|---|
| Iniciar solicitud de restore (que activa el flujo de confirmación) | SRE, superadmin | Mismo modelo de permisos de US-BKP-01-T02. |
| Confirmar restauración de riesgo normal/elevado | El mismo actor que inició la solicitud | La confirmación está vinculada al actor solicitante. |
| Confirmar restauración de riesgo crítico (segundo actor) | Superadmin distinto del solicitante | El segundo actor debe tener rol superadmin y no puede ser el mismo que inició la solicitud. |
| Abortar una solicitud pendiente de confirmación | El actor solicitante, o cualquier superadmin | Permite a un superior cancelar una solicitud que considera inapropiada. |
| Consultar el estado de prechecks de una solicitud pendiente | El actor solicitante, SRE, superadmin | Solo sobre solicitudes del tenant al que el actor tiene acceso. |

### 5.2 Multi-tenant

- Los prechecks solo acceden a datos del tenant afectado por la solicitud. No cruzan información entre tenants.
- Las advertencias presentadas al actor no revelan información de otros tenants.
- El token de confirmación incluye el `tenant_id` y se valida contra él. Una solicitud creada para el tenant A no puede ser confirmada reutilizando un token que referencia al tenant B.
- En el escenario de segundo actor (riesgo crítico), el segundo actor debe tener permisos sobre el tenant afectado.

### 5.3 Auditoría

El flujo de confirmación extiende los eventos de auditoría de US-BKP-01-T03 con los siguientes datos adicionales por evento de restore:

- `prechecks_result`: array con cada precheck ejecutado, su resultado y su mensaje.
- `risk_level`: nivel de riesgo calculado (`normal`, `elevated`, `critical`).
- `warnings_shown`: lista de advertencias presentadas al actor.
- `confirmation_decision`: `confirmed`, `aborted` o `expired`.
- `confirmation_timestamp`: momento de la confirmación o abort.
- `second_factor_method`: `otp` o `second_actor` (solo si riesgo crítico).
- `second_actor_id`: identificador del segundo actor (solo si aplica).

### 5.4 Seguridad

- El token de confirmación es opaco, de alta entropía, generado con CSPRNG. No contiene información decodificable por el cliente.
- El token se almacena con hash en el servidor. El valor en texto plano solo se devuelve una vez al solicitante.
- El flujo de dos pasos en API mitiga ataques de replay: el token es de un solo uso, tiene TTL y está vinculado a la solicitud específica.
- La confirmación deliberada (escritura del nombre del tenant) mitiga errores de fat-finger y automatización no intencionada.
- El requisito de segundo factor o segundo actor para riesgo crítico añade una capa de defensa contra compromiso de una sola cuenta.

---

## 6. Criterios de aceptación concretos

| # | Criterio | Verificable como |
|---|---|---|
| CA-01 | Una solicitud de restore vía consola presenta un diálogo de confirmación con los prechecks, advertencias y nivel de riesgo **antes** de despachar la operación al adaptador. | Test E2E: iniciar restore → verificar que se muestra el diálogo → verificar que la operación no se ha despachado. |
| CA-02 | Una solicitud de restore vía API devuelve el resumen de prechecks y un token de confirmación sin despachar la operación. La operación solo se despacha tras la confirmación explícita con el token. | Test de integración API: POST restore → verificar respuesta con token y prechecks → verificar que la operación está en estado `pending_confirmation`. |
| CA-03 | Si un precheck devuelve `blocking_error`, el botón de confirmación en consola está deshabilitado y la API no genera token de confirmación. | Test con condición de bloqueo (p.ej., restore activo concurrente): verificar que no se puede confirmar. |
| CA-04 | Las advertencias no bloqueantes se muestran al actor pero permiten proceder con confirmación deliberada. | Test con snapshot antiguo: verificar que se muestra advertencia, se puede confirmar, y la operación se despacha. |
| CA-05 | La confirmación requiere que el actor escriba el nombre del tenant afectado (riesgo normal y superiores). | Test E2E: verificar que el botón de confirmación no se habilita sin el texto correcto. |
| CA-06 | Una restauración de riesgo crítico no se despacha sin segundo factor (OTP) o aprobación de un segundo actor autorizado. | Test de integración: simular restore completo → verificar que no se despacha solo con confirmación del primer actor. |
| CA-07 | El token de confirmación API expira tras el TTL configurado. Una confirmación con token expirado es rechazada. | Test de integración: crear solicitud → esperar expiración → intentar confirmar → verificar rechazo. |
| CA-08 | Al confirmar, la plataforma revalida que el snapshot sigue existiendo. Si no existe, rechaza la confirmación. | Test de integración: crear solicitud → eliminar snapshot → intentar confirmar → verificar rechazo. |
| CA-09 | Cada confirmación, abort y expiración genera un evento de auditoría que incluye los prechecks, advertencias, nivel de riesgo y decisión del actor. | Test de integración: ejecutar flujo completo → consultar eventos de auditoría → verificar campos obligatorios. |
| CA-10 | Un actor que aborta la restauración desde el diálogo de confirmación genera un evento de auditoría con decisión `aborted` y las advertencias que se le mostraron. | Test E2E: iniciar restore → abortar → verificar evento de auditoría. |
| CA-11 | Los prechecks solo acceden a información del tenant afectado. No se filtra información de otros tenants en advertencias ni en la respuesta. | Test de aislamiento: verificar que los prechecks de un tenant no revelan datos de otro. |
| CA-12 | Los backups bajo demanda no pasan por el flujo de confirmación reforzada. | Test: iniciar backup → verificar que se despacha directamente sin diálogo de confirmación. |

---

## 7. Riesgos y supuestos

### 7.1 Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| La latencia de los prechecks añade tiempo al flujo de restore, percibido como fricción excesiva en situaciones de urgencia | Medio. En un incidente, cada segundo cuenta y un flujo largo puede frustrar al operador. | Los prechecks deben tener un timeout máximo configurable (por defecto: 10 segundos). Si se excede, se muestran los resultados parciales con advertencia y se permite proceder. |
| La confirmación por escritura del nombre del tenant puede ser difícil si el nombre es largo o complejo | Bajo. Fricción operacional menor. | Permitir autocompletado parcial o confirmar con un identificador corto configurable por tenant. |
| El segundo factor para riesgo crítico puede no estar disponible si MFA no está habilitado en el despliegue | Medio. Se perdería la capa de protección adicional para operaciones de máximo riesgo. | Si MFA no está habilitado, requerir aprobación de segundo actor como única opción. Si no hay segundo actor disponible, documentar la limitación y registrar en auditoría que la operación se ejecutó sin segundo factor. |
| Los prechecks pueden generar falsos positivos (advertencias innecesarias que desensibilizan al operador) | Medio. Si hay demasiadas advertencias, el operador las ignora sistemáticamente. | Los umbrales de los prechecks deben ser configurables. Revisar periódicamente la tasa de advertencias para ajustar los umbrales. |
| El flujo de dos pasos en API añade complejidad para consumidores de automatización | Bajo. Los sistemas de automatización deben adaptarse al flujo. | Documentar el flujo claramente. Proporcionar ejemplos de integración. El TTL del token permite un margen razonable para la lógica de decisión del consumidor. |

### 7.2 Supuestos

| Supuesto | Consecuencia si no se cumple |
|---|---|
| US-BKP-01-T02 ya proporciona el modelo de operación de restore y el endpoint de solicitud. | T04 no puede interceptar el flujo de restore si no existe el flujo base. Se verifica como dependencia merged (PR#157). |
| US-BKP-01-T03 ya proporciona el pipeline de auditoría para operaciones de backup/restore. | Los eventos de confirmación no tendrían dónde publicarse. Se verifica como dependencia merged (PR#158). |
| Los adaptadores de componentes pueden proporcionar información sobre operaciones activas y existencia de snapshots para los prechecks. | Algunos prechecks podrían no ejecutarse para ciertos componentes. Se degradan a advertencia ("verificación no disponible para este componente") en lugar de bloquear. |
| El sistema de IAM (Keycloak) soporta la verificación de OTP como segundo factor dentro del flujo de la aplicación. | La opción de OTP para riesgo crítico no estaría disponible. Se recurre exclusivamente a la aprobación de segundo actor. |
| Los umbrales de los prechecks (antigüedad de snapshot, horario operativo) son configurables por despliegue, no hardcodeados. | La plataforma no podría adaptarse a distintos despliegues con políticas operativas diferentes. |
