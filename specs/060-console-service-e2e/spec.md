# Especificación de Feature: Pruebas E2E por servicio verificando consumo de APIs públicas del BaaS

**Feature Branch**: `060-console-service-e2e`
**Creada**: 2026-03-29
**Estado**: Specified
**Task ID**: US-UI-03-T06
**Epic**: EP-15 — Consola de administración: dominios funcionales
**Historia padre**: US-UI-03 — Consola de gestión de PostgreSQL, MongoDB, Kafka, Functions y Storage
**Tipo**: Feature
**Prioridad**: P0
**Tamaño relativo**: XL
**Dependencias de historia**: US-UI-01, US-PGADM-05, US-MGADM-03, US-EVT-03, US-FN-03, US-STO-03
**Dependencias dentro de la historia**: US-UI-03-T01, US-UI-03-T02, US-UI-03-T03, US-UI-03-T04, US-UI-03-T05
**RF trazados desde la historia**: RF-UI-016, RF-UI-017, RF-UI-018, RF-UI-019, RF-UI-020
**Input**: Prompt de especificación importado para US-UI-03-T06

---

## Objetivo y problema que resuelve

Las tareas T01–T05 entregan las vistas de consola para los cinco servicios core del BaaS: PostgreSQL, MongoDB, Kafka, Functions y Storage. Cada vista permite a operadores y desarrolladores administrar recursos, inspeccionar estado y ejecutar acciones sobre el servicio correspondiente. Sin embargo, hasta ahora no existe validación automatizada que confirme, desde la perspectiva del navegador, que estas vistas consumen exclusivamente las APIs públicas del producto y que los journeys administrativos principales funcionan de punta a punta.

Sin esta tarea el equipo corre dos riesgos concretos:

1. **Regresiones silenciosas**: un cambio en cualquier vista o en el contrato de una API pública puede romper un flujo administrativo sin que nadie lo detecte hasta pruebas manuales.
2. **Backdoors ocultos**: sin evidencia automatizada de que la consola consume las mismas APIs públicas expuestas a los consumidores del BaaS, no se puede afirmar con confianza que la UI y la API comparten la misma superficie de seguridad, cuotas y auditoría.

**US-UI-03-T06 resuelve exactamente esto**: incorporar una suite E2E estable por servicio que ejercite los journeys administrativos principales de cada dominio en navegador, verificando que las llamadas de red van dirigidas a los endpoints públicos del BaaS y no a rutas internas o atajos no documentados.

---

## Usuarios y consumidores afectados

| Actor | Relación con esta tarea | Valor que recibe |
|---|---|---|
| **Tenant owner** | Usuario final de la consola | Mayor confianza en que las vistas de cada servicio funcionan correctamente con la API pública y respetan sus permisos y cuotas. |
| **Workspace admin** | Usuario final de la consola | Menor probabilidad de regresiones en los flujos de gestión de recursos al actualizar la consola o las APIs. |
| **Developer** | Usuario final de la consola | Garantía de que las operaciones que ve en la UI corresponden a las mismas APIs que puede consumir programáticamente. |
| **Superadmin** | Usuario final de la consola | Evidencia de que la consola no utiliza backdoors que eludan seguridad, auditoría o cuotas de la plataforma. |
| **Equipo frontend** | Consumidor interno | Red de seguridad automatizada que detecta roturas en los flujos de cada servicio tras cambios de código. |
| **Equipo de plataforma / CI** | Consumidor interno | Gate reproducible por servicio para validar que la consola sigue operando correctamente sin pruebas manuales. |

---

## User Scenarios & Testing

### User Story 1 — E2E de vistas PostgreSQL: listado y exploración de recursos (Prioridad: P1)

Como workspace admin autenticado, quiero que la suite E2E verifique que puedo navegar a la sección PostgreSQL, ver la lista de bases de datos del workspace, explorar esquemas y tablas de una base, y que todas las peticiones de red se dirijan a endpoints públicos del BaaS.

**Por qué esta prioridad**: PostgreSQL es el servicio RDBMS principal del producto y el que más interacciones de gestión concentra (bases, esquemas, tablas, columnas, índices, vistas, políticas). Validar su journey primero maximiza la cobertura de riesgo.

**Prueba independiente**: Autenticarse, navegar a la sección PostgreSQL, verificar que se renderiza el listado de bases y que al expandir una base aparecen sus esquemas y tablas; inspeccionar que las llamadas de red usan rutas de la API pública.

**Escenarios de aceptación**:

1. **Dado** que el usuario está autenticado y tiene un workspace con al menos una base PostgreSQL provisionada, **cuando** navega a la sección PostgreSQL de la consola, **entonces** se renderiza el listado de bases de datos del workspace activo.
2. **Dado** que el listado de bases se muestra, **cuando** el usuario selecciona una base, **entonces** la consola muestra los esquemas y tablas asociados sin errores visibles.
3. **Dado** que la suite E2E intercepta las peticiones de red durante la navegación PostgreSQL, **cuando** analiza las URLs llamadas, **entonces** todas corresponden a endpoints documentados de la API pública del BaaS (familia `/v1/pg/` o equivalente público).

---

### User Story 2 — E2E de vistas MongoDB: listado y exploración de colecciones (Prioridad: P1)

Como workspace admin autenticado, quiero que la suite E2E verifique que puedo navegar a la sección MongoDB, ver las bases y colecciones, y que la consola consume exclusivamente la API pública.

**Por qué esta prioridad**: MongoDB es el segundo motor de datos core; su journey de exploración es análogo al de PostgreSQL pero con entidades distintas (colecciones, documentos, validaciones).

**Prueba independiente**: Autenticarse, navegar a MongoDB, verificar listado de bases/colecciones y confirmar que las llamadas van a la API pública.

**Escenarios de aceptación**:

1. **Dado** que el usuario está autenticado y tiene un workspace con al menos una base MongoDB, **cuando** navega a la sección MongoDB, **entonces** se renderiza el listado de bases con sus colecciones.
2. **Dado** que el usuario selecciona una colección, **cuando** la consola carga sus detalles, **entonces** se muestran índices o información de validación sin errores.
3. **Dado** que la suite intercepta las peticiones de red durante la navegación MongoDB, **cuando** analiza las URLs, **entonces** todas pertenecen a la familia pública del BaaS (familia `/v1/mongo/` o equivalente público).

---

### User Story 3 — E2E de vistas Kafka: topics y estado de salud (Prioridad: P1)

Como workspace admin autenticado, quiero que la suite E2E verifique que puedo navegar a la sección Kafka, ver los topics del workspace, consultar su estado de salud y que todo se consume desde la API pública.

**Por qué esta prioridad**: Kafka es el backbone de eventos del producto; validar que la consola muestra topics, ACLs y health correctamente es crítico para la operación multi-tenant.

**Prueba independiente**: Autenticarse, navegar a Kafka, verificar listado de topics y visualización de health/lag; confirmar API pública.

**Escenarios de aceptación**:

1. **Dado** que el usuario está autenticado y el workspace tiene topics Kafka provisionados, **cuando** navega a la sección Kafka, **entonces** se renderiza la lista de topics con información básica.
2. **Dado** que el listado de topics se muestra, **cuando** el usuario accede al detalle de un topic, **entonces** la consola muestra ACLs, health o lag según lo entregado por T03.
3. **Dado** que la suite intercepta las peticiones de red, **cuando** analiza las URLs de la sección Kafka, **entonces** todas corresponden a endpoints públicos del BaaS (familia `/v1/kafka/` o equivalente público).

---

### User Story 4 — E2E de vistas Functions: listado, estado y activations (Prioridad: P1)

Como developer autenticado, quiero que la suite E2E verifique que puedo navegar a la sección Functions, ver las funciones desplegadas, consultar activations recientes y que la consola consume la API pública.

**Por qué esta prioridad**: Functions es el motor serverless del BaaS y tiene la interacción más rica (deploy, edición, ejecución, logs, activations). Validar el journey principal evita regresiones en una superficie amplia.

**Prueba independiente**: Autenticarse, navegar a Functions, verificar listado de funciones y que al seleccionar una se muestran activations o logs; confirmar API pública.

**Escenarios de aceptación**:

1. **Dado** que el usuario está autenticado y el workspace tiene funciones desplegadas, **cuando** navega a la sección Functions, **entonces** se renderiza el listado de funciones con su estado.
2. **Dado** que el usuario selecciona una función, **cuando** la consola carga el detalle, **entonces** se muestran activations recientes o logs sin errores.
3. **Dado** que la suite intercepta las peticiones de red en la sección Functions, **cuando** analiza las URLs, **entonces** todas corresponden a la API pública del BaaS (familia `/v1/functions/` o equivalente público).

---

### User Story 5 — E2E de vistas Storage: buckets, objetos y uso (Prioridad: P1)

Como workspace admin autenticado, quiero que la suite E2E verifique que puedo navegar a la sección Storage, ver los buckets, explorar objetos y que la consola consume exclusivamente la API pública.

**Por qué esta prioridad**: Storage es el quinto servicio core; su journey incluye buckets, objetos, metadatos y uso, con implicaciones directas de cuotas y presigned URLs.

**Prueba independiente**: Autenticarse, navegar a Storage, verificar listado de buckets y exploración de objetos; confirmar API pública.

**Escenarios de aceptación**:

1. **Dado** que el usuario está autenticado y el workspace tiene buckets provisionados, **cuando** navega a la sección Storage, **entonces** se renderiza el listado de buckets con información de uso.
2. **Dado** que el usuario selecciona un bucket, **cuando** la consola carga su contenido, **entonces** se muestran los objetos con metadatos básicos.
3. **Dado** que la suite intercepta las peticiones de red en la sección Storage, **cuando** analiza las URLs, **entonces** todas corresponden a la API pública del BaaS (familia `/v1/storage/` o equivalente público).

---

### User Story 6 — Verificación transversal de ausencia de backdoors (Prioridad: P2)

Como superadmin de la plataforma, quiero que la suite E2E confirme de forma transversal que ninguna vista de los cinco servicios realiza llamadas a endpoints internos, no documentados o que eludan la capa de gateway/autenticación.

**Por qué esta prioridad**: Es una verificación de seguridad y gobernanza que complementa los journeys funcionales individuales. No entrega funcionalidad nueva al usuario, pero reduce riesgo de superficie de ataque oculta.

**Prueba independiente**: Ejecutar los cinco journeys de servicio y al finalizar verificar que el log completo de peticiones de red no contiene rutas fuera de las familias de API pública documentadas.

**Escenarios de aceptación**:

1. **Dado** que los cinco journeys de servicio han ejecutado sus escenarios, **cuando** la suite analiza el registro completo de peticiones de red, **entonces** no existe ninguna petición dirigida a endpoints fuera de las familias de API pública documentadas del BaaS.
2. **Dado** que se detecta una petición a un endpoint no documentado, **cuando** la suite evalúa la aserción transversal, **entonces** la prueba falla con un mensaje claro que identifica la URL y el servicio origen.

---

## Edge Cases

- **¿Qué ocurre si un servicio no tiene recursos provisionados en el workspace de prueba?** La suite debe verificar que la vista muestra un estado vacío coherente (empty state) en lugar de un error, y que no se realizan llamadas a endpoints inesperados.
- **¿Qué ocurre si la API pública de un servicio responde con error (4xx/5xx)?** La suite debe verificar que la vista muestra un estado de error comprensible al usuario y no queda en blanco o con un spinner infinito.
- **¿Qué ocurre si el usuario no tiene permisos sobre un servicio específico?** La suite debe incluir al menos un escenario donde un actor sin permisos sobre un dominio verifica que la consola muestra un mensaje de acceso denegado y no expone datos.
- **¿Qué ocurre si la sesión expira durante la navegación entre secciones de servicio?** La suite debe verificar que la consola redirige al login en lugar de mostrar datos parciales o errores no controlados.
- **¿Qué ocurre si una petición de red es redirigida por el gateway a una ruta interna?** La aserción de API pública debe evaluar la URL destino final, no solo la URL inicial, para detectar redirecciones a endpoints internos.

---

## Requirements

### Requisitos funcionales

- **FR-001**: El repositorio DEBE incorporar una suite E2E automatizada que cubra journeys de navegador para cada uno de los cinco servicios core: PostgreSQL, MongoDB, Kafka, Functions y Storage.
- **FR-002**: Cada journey de servicio DEBE verificar al menos el listado principal de recursos y la exploración de un nivel de detalle (por ejemplo, bases → esquemas/tablas para PostgreSQL, buckets → objetos para Storage).
- **FR-003**: La suite DEBE interceptar las peticiones de red realizadas por la consola durante cada journey y verificar que todas se dirigen a endpoints de las familias de API pública documentadas del BaaS.
- **FR-004**: La suite DEBE incluir una verificación transversal que, tras ejecutar los cinco journeys, confirme la ausencia total de llamadas a endpoints no documentados o internos.
- **FR-005**: La suite DEBE poder ejecutarse en CI o localmente sin depender de instancias reales de PostgreSQL, MongoDB, Kafka, OpenWhisk o S3, usando un entorno controlado y reproducible para las respuestas HTTP de cada servicio.
- **FR-006**: La suite DEBE verificar que cuando un servicio devuelve un estado vacío (sin recursos), la vista renderiza un empty state coherente y no un error.
- **FR-007**: La suite DEBE verificar que cuando la API de un servicio responde con error, la vista muestra un estado de error comprensible al usuario.
- **FR-008**: La suite DEBE verificar al menos un escenario de acceso denegado donde un usuario sin permisos sobre un dominio recibe un mensaje claro de la consola.
- **FR-009**: La suite DEBE usar aserciones estables sobre comportamiento visible al usuario (rutas, headings, listados, mensajes de estado), evitando depender de detalles de implementación frágiles.
- **FR-010**: La suite DEBE poder ejecutarse con un único comando dentro del paquete `@in-atelier/web-console`.
- **FR-011**: La suite DEBE mantener el alcance acotado a las vistas de los cinco servicios core y su verificación de consumo de API pública; no debe absorber journeys de autenticación base (ya cubiertos en 048), permisos finos entre roles, ni operaciones de escritura destructivas.
- **FR-012**: La suite DEBE ser extensible para incorporar nuevos servicios o journeys adicionales sin reestructurar los escenarios existentes.

### Entidades clave

- **Journey E2E de servicio**: Secuencia observable en navegador que parte de una sesión autenticada, navega a la sección de un servicio, verifica el listado de recursos principales, explora al menos un nivel de detalle y confirma que las peticiones de red van a la API pública.
- **Registro de peticiones de red**: Log capturado durante la ejecución de cada journey que contiene las URLs, métodos HTTP y códigos de respuesta de todas las llamadas realizadas por la consola.
- **Aserción de API pública**: Verificación automatizada que compara cada URL del registro de peticiones contra las familias de endpoints públicos documentados y falla si encuentra una petición fuera de ese conjunto.
- **Backend de servicio controlado para pruebas**: Conjunto acotado de respuestas HTTP simuladas por servicio (PostgreSQL, MongoDB, Kafka, Functions, Storage) que hace reproducible la suite sin depender de infraestructura real.
- **Empty state de servicio**: Vista que la consola renderiza cuando un servicio no tiene recursos provisionados en el workspace activo.

---

## Seguridad, multi-tenancy, auditoría y trazabilidad

### Seguridad

- La suite E2E debe confirmar que la consola no realiza llamadas a endpoints fuera de la API pública, reforzando que la UI comparte la misma superficie de seguridad que cualquier consumidor externo del BaaS.
- Las respuestas simuladas utilizadas en la suite deben ser datos de prueba controlados; no se deben incluir tokens, secretos ni credenciales operativas reales.
- Al menos un escenario debe verificar que un usuario sin permisos sobre un servicio recibe un rechazo visible en lugar de datos.

### Multi-tenancy

- La suite debe operar en un contexto de workspace determinista. Los datos simulados deben corresponder a un tenant y workspace específicos de prueba.
- La verificación de API pública confirma indirectamente que la consola pasa por el gateway, donde se aplica el aislamiento multi-tenant. La suite no necesita validar el aislamiento en sí, pero sí que la consola no elude la capa donde se aplica.

### Auditoría

- No se introduce nueva superficie de auditoría. La tarea valida journeys visibles de UI; la generación de eventos de auditoría sigue siendo responsabilidad del backend y de las tareas de auditoría específicas.

### Trazabilidad

- Cada journey E2E debe mapearse claramente a uno de los cinco servicios core y a los RF de la historia (RF-UI-016 a RF-UI-020).
- La evidencia de ejecución debe quedar en la suite E2E y en el comando reproducible del paquete.
- El registro de peticiones de red capturado durante la suite debe ser inspeccionable para auditoría posterior si es necesario.

---

## Fuera de alcance explícito

| Elemento | Motivo de exclusión |
|---|---|
| Journeys E2E de autenticación base (login, logout, signup) | Ya cubiertos en 048-console-auth-e2e-flows (US-UI-01-T06). |
| Operaciones de escritura destructivas (DROP, DELETE, etc.) en la suite E2E | La tarea se centra en verificar navegación y lectura de recursos; las operaciones de escritura requieren consideraciones adicionales de entorno. |
| Integración contra servicios reales desplegados (PostgreSQL, MongoDB, Kafka, OpenWhisk, S3) | Haría la suite no determinista y no es necesaria para validar los journeys del frontend en esta tarea. |
| Permisos finos por rol dentro de cada servicio | Pertenece a incrementos posteriores del dominio IAM/UI. Esta tarea valida un escenario de acceso denegado genérico. |
| Validación de contratos de API (schema validation) | La suite verifica que la consola llama a los endpoints correctos, no que la respuesta cumpla un schema formal. |
| Journeys de métricas, alertas u observabilidad de la consola | Pertenecen a dominios funcionales distintos (observability). |
| Rendimiento o carga de la suite E2E | La tarea se centra en corrección funcional, no en benchmarks de rendimiento. |
| Elección concreta de herramienta E2E o mecanismo de interceptación de red | Decisión de la fase de planificación técnica, no de especificación. |

---

## Success Criteria

### Resultados medibles

- **SC-001**: La suite E2E puede ejecutarse con un único comando dentro de `@in-atelier/web-console` y finaliza en verde en entorno local/CI controlado.
- **SC-002**: Existe al menos un escenario automatizado por cada servicio core (PostgreSQL, MongoDB, Kafka, Functions, Storage) que verifica listado de recursos y exploración de un nivel de detalle.
- **SC-003**: Cada escenario de servicio incluye una aserción que confirma que todas las peticiones de red durante el journey van dirigidas a endpoints de la API pública del BaaS.
- **SC-004**: Existe una verificación transversal que, tras los cinco journeys, confirma ausencia de llamadas a endpoints no documentados.
- **SC-005**: Al menos un escenario por servicio verifica el comportamiento de empty state (sin recursos provisionados).
- **SC-006**: Al menos un escenario por servicio verifica el comportamiento ante error de la API (4xx/5xx).
- **SC-007**: Al menos un escenario verifica acceso denegado para un usuario sin permisos sobre un servicio.
- **SC-008**: La ejecución de la suite no requiere infraestructura real de los cinco servicios ni credenciales operativas.

---

## Supuestos

- T01–T05 ya dejaron operativas las vistas de los cinco servicios core dentro de la consola, con navegación desde el shell autenticado.
- La consola consume las APIs públicas del BaaS a través del gateway (APISIX), usando las familias de endpoints documentadas para cada servicio.
- Las respuestas HTTP de cada servicio pueden simularse de forma controlada y determinista para los journeys principales.
- El paquete `@in-atelier/web-console` ya soporta la infraestructura base de E2E establecida en 048-console-auth-e2e-flows, que puede extenderse para los journeys de servicio.
- La suite E2E de 048 ya resolvió el patrón de autenticación simulada en navegador, reutilizable aquí.

## Riesgos

- **Riesgo**: La superficie de cinco servicios es amplia y la suite puede volverse lenta o frágil. **Mitigación**: mantener journeys acotados al listado y un nivel de detalle por servicio; no intentar cubrir todas las sub-vistas de cada dominio.
- **Riesgo**: Las familias de endpoints de API pública pueden no estar documentadas de forma centralizada, dificultando las aserciones de URL. **Mitigación**: definir un allowlist de prefijos de API pública por servicio como configuración de la suite, actualizable conforme se estabilicen las APIs.
- **Riesgo**: Los datos simulados por servicio pueden desalinearse con los contratos reales de la API. **Mitigación**: basar las respuestas simuladas en los contratos vigentes y revisar cuando los contratos evolucionen.
- **Riesgo**: La interceptación de peticiones de red en el browser runner puede tener limitaciones según la herramienta elegida. **Mitigación**: dejar la elección de herramienta para la fase de planificación; la especificación no asume un mecanismo concreto.

## Preguntas abiertas

_No hay preguntas bloqueantes para avanzar. La elección de herramienta E2E, el mecanismo de interceptación de red y la estructura concreta de los fixtures simulados por servicio quedan para la fase de planificación técnica._
