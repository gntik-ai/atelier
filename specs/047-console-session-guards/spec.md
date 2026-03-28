# Especificación de Feature: Manejo de sesión, refresh de tokens, errores de autenticación y rutas protegidas

**Feature Branch**: `047-console-session-guards`
**Creada**: 2026-03-28
**Estado**: Specified
**Task ID**: US-UI-01-T05
**Epic**: EP-14 — Consola de administración: shell, acceso y contexto
**Historia padre**: US-UI-01 — Shell de consola: stack React/Tailwind/shadcn, login y navegación base
**Tipo**: Feature
**Prioridad**: P0
**Tamaño relativo**: L
**Dependencias de historia**: US-IAM-03, US-GW-01
**Dependencias dentro de la historia**: US-UI-01-T01, US-UI-01-T02, US-UI-01-T03, US-UI-01-T04
**RF trazados desde la historia**: RF-UI-001, RF-UI-002, RF-UI-003, RF-UI-004, RF-UI-005, RF-UI-006, RF-UI-007, RF-UI-008, RF-UI-009, RF-UI-010
**Input**: Prompt de especificación importado para US-UI-01-T05

---

## Objetivo y problema que resuelve

Las tareas anteriores (T01–T04) entregan la aplicación React base, el login contra Keycloak, el signup y el shell de navegación. Sin embargo, una vez que el usuario se autentica, la consola carece de un mecanismo que:

1. **Mantenga la sesión viva** de forma transparente mientras el usuario trabaja, renovando los tokens antes de que expiren.
2. **Detecte y reaccione** ante errores de autenticación (token expirado sin posibilidad de refresh, revocación de sesión, respuestas 401/403 de la API).
3. **Proteja las rutas internas** de la consola para que un usuario no autenticado no pueda acceder a ninguna pantalla post-login.

Sin esta tarea, cualquier usuario que permanezca en la consola más tiempo del que dura su access token será expulsado sin aviso, las rutas internas serían accesibles directamente por URL sin sesión válida, y no existiría un flujo predecible de recuperación ante errores de autenticación.

**US-UI-01-T05 resuelve exactamente esto**: entregar la capa de gestión de sesión, renovación automática de tokens, manejo de errores de autenticación y protección de rutas que convierte la consola en una aplicación segura y estable para sesiones de trabajo reales.

---

## Usuarios y consumidores afectados

| Actor | Relación con esta tarea | Valor que recibe |
|---|---|---|
| **Superadmin de plataforma** | Consumidor final de la consola | Sesiones de trabajo prolongadas sin interrupciones inesperadas; acceso protegido a las secciones de administración. |
| **Tenant owner** | Consumidor final de la consola | Puede trabajar de forma continua en la gestión de su tenant sin re-autenticarse manualmente mientras su sesión sea válida. |
| **Workspace admin** | Consumidor final de la consola | Misma estabilidad de sesión; las rutas de su workspace no son accesibles sin autenticación válida. |
| **Miembro de tenant** | Consumidor final de la consola | Experiencia predecible ante expiración o errores: se le informa y redirige al login en lugar de ver errores crípticos. |
| **Equipo de desarrollo (consumidor interno)** | Construye pantallas y llamadas a API dentro de la consola | Recibe una capa de sesión reutilizable que gestiona tokens, intercepta errores 401/403 y protege rutas, evitando que cada pantalla reimplemente lógica de autenticación. |

---

## User Scenarios & Testing

### User Story 1 — Rutas protegidas: redirección al login cuando no hay sesión (Prioridad: P1)

Como usuario no autenticado, quiero que al intentar acceder a cualquier ruta protegida de la consola sea redirigido automáticamente a la página de login, para que ningún contenido interno sea visible sin una sesión válida.

**Por qué esta prioridad**: Es el requisito de seguridad más fundamental de la consola. Sin protección de rutas, cualquier persona podría acceder a pantallas internas simplemente escribiendo la URL.

**Prueba independiente**: Abrir el navegador sin sesión activa, navegar directamente a una ruta protegida (ej. /dashboard) y verificar que se redirige al login.

**Escenarios de aceptación**:

1. **Dado** que el usuario no tiene una sesión activa (no hay tokens válidos almacenados), **cuando** intenta acceder a cualquier ruta protegida de la consola, **entonces** es redirigido a la página de login sin que se renderice ningún contenido de la ruta protegida.
2. **Dado** que el usuario no está autenticado, **cuando** intenta acceder a una ruta protegida profunda (deep link, ej. `/workspaces/abc/functions`), **entonces** es redirigido al login y, tras autenticarse correctamente, es devuelto a la ruta original que intentó visitar.
3. **Dado** que el usuario está autenticado con una sesión válida, **cuando** accede a una ruta protegida, **entonces** el contenido se renderiza con normalidad sin redirección al login.
4. **Dado** que el usuario está autenticado, **cuando** accede a la ruta de login (`/login`), **entonces** es redirigido automáticamente a la ruta protegida por defecto (ej. `/dashboard`) sin mostrar la pantalla de login.

---

### User Story 2 — Renovación automática de tokens (Prioridad: P1)

Como usuario autenticado trabajando en la consola, quiero que mis tokens se renueven automáticamente antes de expirar, para poder mantener una sesión de trabajo continua sin interrupciones ni re-autenticaciones manuales.

**Por qué esta prioridad**: Sin renovación automática, el access token de Keycloak expira (habitualmente en minutos) y el usuario pierde el acceso de forma abrupta en medio de su trabajo. Es la segunda pieza más crítica tras la protección de rutas.

**Prueba independiente**: Iniciar sesión, esperar a que el access token se acerque a su expiración y verificar que se renueva de forma transparente sin intervención del usuario.

**Escenarios de aceptación**:

1. **Dado** que el usuario está autenticado y su access token se acerca a la expiración, **cuando** el mecanismo de renovación se activa (antes de que el token expire), **entonces** se obtiene un nuevo access token usando el refresh token, de forma transparente para el usuario.
2. **Dado** que la renovación automática se ejecuta correctamente, **cuando** el usuario continúa navegando o realizando acciones en la consola, **entonces** las peticiones a la API utilizan el nuevo access token sin que el usuario perciba interrupción alguna.
3. **Dado** que la renovación automática se ejecuta correctamente, **cuando** se obtiene un nuevo par de tokens, **entonces** los tokens anteriores son reemplazados por los nuevos en el almacenamiento de sesión del cliente.
4. **Dado** que el access token ha expirado pero el refresh token sigue siendo válido, **cuando** se detecta la expiración del access token (ej. antes de una petición a la API o tras una respuesta 401), **entonces** se intenta una renovación usando el refresh token antes de dar por perdida la sesión.

---

### User Story 3 — Manejo de errores de autenticación y cierre de sesión forzado (Prioridad: P1)

Como usuario autenticado, quiero que cuando mi sesión ya no pueda ser renovada (refresh token expirado, sesión revocada, error irrecuperable de Keycloak), la consola me informe y me redirija al login de forma limpia, para no quedarme atrapado en un estado roto o ver errores técnicos incomprensibles.

**Por qué esta prioridad**: Complementa directamente la renovación automática. Si la renovación falla, la consola debe degradar de forma controlada en lugar de colapsar.

**Prueba independiente**: Invalidar manualmente el refresh token (ej. revocar la sesión en Keycloak) y verificar que la consola detecta el fallo y redirige al login con un mensaje informativo.

**Escenarios de aceptación**:

1. **Dado** que el access token ha expirado y el refresh token también ha expirado o es inválido, **cuando** se intenta la renovación, **entonces** la renovación falla, el estado de sesión local se limpia completamente y el usuario es redirigido a la página de login.
2. **Dado** que la renovación de tokens falla, **cuando** el usuario es redirigido al login, **entonces** se muestra un mensaje informativo indicando que la sesión ha expirado y que debe iniciar sesión de nuevo (no un error técnico críptico).
3. **Dado** que la consola recibe una respuesta HTTP 401 de cualquier petición a la API backend, **cuando** el intento de renovación del token también falla, **entonces** se ejecuta el flujo de cierre de sesión forzado (limpieza de estado local + redirección al login con mensaje).
4. **Dado** que la sesión del usuario ha sido revocada desde Keycloak (ej. por un administrador), **cuando** la siguiente petición a la API o el siguiente intento de renovación devuelve un error de autenticación, **entonces** se ejecuta el flujo de cierre de sesión forzado.
5. **Dado** que se produce un error de red transitorio durante la renovación de tokens, **cuando** la renovación falla por timeout o falta de conectividad, **entonces** se reintenta al menos una vez antes de ejecutar el cierre de sesión forzado, para evitar expulsar al usuario por un fallo de red momentáneo.

---

### User Story 4 — Interceptación centralizada de respuestas 401/403 en llamadas a la API (Prioridad: P2)

Como desarrollador de la consola, quiero que exista un mecanismo centralizado que intercepte las respuestas 401 y 403 de la API y ejecute el flujo de renovación o cierre de sesión forzado según corresponda, para no tener que manejar errores de autenticación en cada pantalla individualmente.

**Por qué esta prioridad**: Las stories P1 definen los flujos de sesión del usuario. Esta story garantiza que la integración con la API backend está cubierta de forma centralizada, lo que es prerequisito para que cualquier pantalla futura funcione correctamente.

**Prueba independiente**: Realizar una llamada a la API con un token expirado y verificar que el interceptor intenta renovar el token antes de propagar el error, o ejecuta el cierre de sesión forzado si la renovación falla.

**Escenarios de aceptación**:

1. **Dado** que una petición a la API devuelve HTTP 401, **cuando** el interceptor centralizado la captura, **entonces** intenta renovar el access token y reintentar la petición original con el nuevo token antes de propagar el error al componente que realizó la llamada.
2. **Dado** que una petición a la API devuelve HTTP 401 y la renovación del token tiene éxito, **cuando** se reintenta la petición original con el nuevo token, **entonces** la respuesta de la petición reintentada se devuelve al componente que la originó de forma transparente.
3. **Dado** que una petición a la API devuelve HTTP 401 y la renovación del token falla, **cuando** el interceptor detecta el fallo de renovación, **entonces** ejecuta el flujo de cierre de sesión forzado (User Story 3) en lugar de devolver el error 401 al componente.
4. **Dado** que una petición a la API devuelve HTTP 403 (prohibido, no falta de autenticación), **cuando** el interceptor la captura, **entonces** NO intenta renovar el token ni cerrar la sesión; propaga el error 403 al componente para que lo maneje como un problema de permisos, no de sesión.
5. **Dado** que múltiples peticiones concurrentes reciben 401 simultáneamente, **cuando** el interceptor las captura, **entonces** ejecuta una sola renovación de token (no una por cada petición) y reintenta todas las peticiones pendientes con el nuevo token una vez obtenido.

---

### User Story 5 — Preservación de la ruta destino tras re-autenticación (Prioridad: P2)

Como usuario cuya sesión ha expirado mientras navegaba en una sección profunda de la consola, quiero que tras re-autenticarme sea devuelto a la sección donde estaba trabajando, para no perder mi contexto de navegación.

**Por qué esta prioridad**: Mejora significativa de experiencia, pero no es un requisito de seguridad. Depende de que las rutas protegidas (P1) y el cierre de sesión forzado (P1) funcionen correctamente.

**Prueba independiente**: Navegar a una ruta profunda, forzar la expiración de sesión, re-autenticarse y verificar que se regresa a la ruta original.

**Escenarios de aceptación**:

1. **Dado** que el usuario está navegando en `/workspaces/abc/functions` y su sesión expira (cierre de sesión forzado), **cuando** es redirigido al login, **entonces** la ruta original se preserva como parámetro o estado.
2. **Dado** que el usuario se re-autentica correctamente tras un cierre de sesión forzado, **cuando** el login se completa, **entonces** es redirigido a la ruta que estaba visitando antes de la expiración, no a la ruta por defecto.
3. **Dado** que la ruta preservada ya no es válida o accesible tras la re-autenticación, **cuando** se intenta la redirección, **entonces** se redirige a la ruta protegida por defecto en lugar de mostrar un error.

---

### Edge Cases

- **¿Qué ocurre si el usuario abre la consola en múltiples pestañas del navegador?** La renovación de tokens debe ser consistente: si una pestaña renueva el token, las demás pestañas deben poder utilizar el token renovado. Si una pestaña ejecuta un logout, las demás pestañas deben detectar la pérdida de sesión y redirigir al login. El mecanismo exacto de sincronización entre pestañas se decidirá en la fase de planificación técnica.
- **¿Qué ocurre si el servidor de Keycloak no está disponible durante un intento de renovación?** Se trata como un error de red transitorio: se reintenta al menos una vez. Si el fallo persiste, se ejecuta el cierre de sesión forzado con un mensaje que indique que el servicio de autenticación no está disponible.
- **¿Qué ocurre si el reloj del cliente está significativamente desincronizado respecto al servidor?** Los tokens podrían parecer expirados o válidos incorrectamente. La renovación proactiva debería basarse en un margen de seguridad conservador antes de la expiración declarada del token, no en una comparación de reloj exacta.
- **¿Qué ocurre si el refresh token expira mientras el usuario está activamente trabajando (ej. rellenando un formulario largo)?** Se ejecuta el cierre de sesión forzado al detectarse el fallo en la siguiente interacción con la API. El trabajo no guardado del formulario se pierde. Mitigar esta situación (ej. alertas previas al usuario) puede ser alcance de una mejora futura, pero no de esta tarea.
- **¿Qué ocurre si la consola se carga en un entorno donde las cookies o el almacenamiento local están bloqueados?** La gestión de sesión depende de poder almacenar tokens en el cliente. Si el almacenamiento no está disponible, la consola no podrá mantener la sesión y el usuario será redirigido al login en cada navegación. Esta tarea no implementa un fallback para este caso; se documenta como limitación conocida.
- **¿Qué ocurre si el usuario cierra el navegador y lo reabre?** El comportamiento depende de la persistencia de la sesión de Keycloak y de cómo se almacenan los tokens en el cliente. Si los tokens persisten y el refresh token sigue siendo válido, la sesión se puede recuperar. Si no, se redirige al login. El tipo de almacenamiento (memoria, sessionStorage, localStorage) se decidirá en la planificación técnica.

---

## Requirements

### Requisitos funcionales

- **FR-001**: Toda ruta de la consola clasificada como protegida DEBE ser inaccesible sin una sesión autenticada válida. Un usuario sin sesión que intente acceder a una ruta protegida DEBE ser redirigido a la página de login.
- **FR-002**: Las rutas públicas (login, signup, activación pendiente) DEBEN ser accesibles sin sesión. Un usuario autenticado que acceda a la ruta de login DEBE ser redirigido a la ruta protegida por defecto.
- **FR-003**: La consola DEBE renovar el access token de forma automática y transparente antes de que expire, utilizando el refresh token proporcionado por Keycloak.
- **FR-004**: La renovación automática de tokens DEBE ejecutarse con un margen de seguridad antes de la expiración declarada del access token, para evitar que peticiones en curso fallen por un token recién expirado.
- **FR-005**: Cuando la renovación de tokens falle de forma irrecuperable (refresh token expirado, sesión revocada, error persistente de Keycloak), la consola DEBE limpiar completamente el estado de sesión local y redirigir al usuario a la página de login.
- **FR-006**: Cuando se ejecute un cierre de sesión forzado por error de autenticación, la consola DEBE mostrar un mensaje informativo al usuario indicando que su sesión ha expirado, distinguiéndolo de un logout voluntario.
- **FR-007**: La consola DEBE proporcionar un mecanismo centralizado de interceptación de respuestas HTTP 401 de la API que intente la renovación del token antes de propagar el error.
- **FR-008**: El interceptor centralizado DEBE reintentar la petición original con el nuevo token si la renovación tiene éxito, devolviendo la respuesta al componente de forma transparente.
- **FR-009**: El interceptor centralizado NO DEBE tratar las respuestas HTTP 403 como errores de sesión; DEBE propagarlas al componente como errores de permisos.
- **FR-010**: Cuando múltiples peticiones concurrentes reciban HTTP 401, el mecanismo de renovación DEBE ejecutar una sola operación de refresh y encolar las peticiones pendientes hasta que el nuevo token esté disponible.
- **FR-011**: Ante un error de red transitorio durante la renovación de tokens, la consola DEBE reintentar la renovación al menos una vez antes de ejecutar el cierre de sesión forzado.
- **FR-012**: Cuando el usuario sea redirigido al login por cierre de sesión forzado, la consola DEBE preservar la ruta que estaba visitando para restaurarla tras una re-autenticación exitosa.
- **FR-013**: Tras una re-autenticación exitosa, la consola DEBE redirigir al usuario a la ruta preservada si es válida, o a la ruta protegida por defecto si no lo es.
- **FR-014**: La consola DEBE exponer el estado de autenticación (autenticado / no autenticado / renovando) de forma consumible por cualquier componente del shell y de las pantallas internas, sin que cada componente implemente su propia lógica de verificación de sesión.
- **FR-015**: La lógica de gestión de sesión y renovación de tokens DEBE ser independiente de componentes UI específicos, permitiendo su reutilización por cualquier pantalla futura sin acoplamiento.

### Entidades clave

- **Sesión de usuario**: Estado lógico que representa la autenticación activa de un usuario en la consola. Compuesta por el access token, el refresh token y los metadatos de expiración. No es una entidad persistida por la consola; es un estado derivado de los tokens de Keycloak almacenados en el cliente.
- **Access token**: Token JWT de corta duración emitido por Keycloak. Autoriza las peticiones a la API backend. Contiene claims del usuario (nombre, email, roles, tenant_id).
- **Refresh token**: Token de mayor duración emitido por Keycloak. Permite obtener un nuevo access token sin re-autenticación del usuario. Su expiración marca el límite máximo de la sesión sin intervención del usuario.
- **Ruta protegida**: Cualquier ruta de la consola que requiere una sesión autenticada válida para ser accedida. Incluye todas las pantallas post-login (dashboard, tenants, workspaces, funciones, storage, perfil, ajustes, etc.).
- **Ruta pública**: Ruta accesible sin sesión (login, signup, activación pendiente). Conjunto cerrado y pequeño.
- **Cierre de sesión forzado**: Flujo que se ejecuta cuando la sesión no puede ser renovada. Limpia el estado local, informa al usuario y redirige al login. Se distingue del logout voluntario (iniciado por el usuario desde el dropdown del shell).

---

## Seguridad, multi-tenancy, auditoría y cuotas

### Multi-tenancy

Esta tarea **no introduce lógica de aislamiento por tenant** en la gestión de sesión. Los tokens de Keycloak contienen claims de tenant_id, pero esta tarea no los interpreta ni utiliza para filtrar contenido o restringir acceso a nivel de UI. La sesión es la misma independientemente del tenant al que pertenezca el usuario.

La autorización por tenant (ej. que un usuario de tenant A no pueda ver datos de tenant B) es responsabilidad del backend (API Gateway + políticas de Keycloak), no de la capa de sesión del frontend.

### Seguridad

- Los tokens NO DEBEN almacenarse en ubicaciones accesibles por JavaScript de terceros si se utilizan cookies (flag `HttpOnly`). Si se utiliza almacenamiento en memoria o `sessionStorage`, se acepta el trade-off documentado respecto a persistencia entre recargas.
- El refresh token NO DEBE enviarse a ningún endpoint distinto del endpoint de renovación de tokens de Keycloak.
- Cuando se ejecuta un cierre de sesión forzado, DEBEN eliminarse todos los tokens y datos de sesión del almacenamiento del cliente. No debe quedar estado residual que pueda ser reutilizado.
- El interceptor centralizado NO DEBE reenviar tokens expirados a la API tras detectar un fallo de renovación; debe abortar las peticiones pendientes.
- La consola NO DEBE exponer tokens en la URL (ej. como query parameters) bajo ninguna circunstancia.
- La consola NO DEBE registrar tokens (access ni refresh) en logs del navegador (console.log) en entornos de producción.

### Auditoría

- El cierre de sesión forzado DEBERÍA generar un evento auditable del lado cliente que permita rastrear que la sesión terminó por expiración o error, diferenciándolo de un logout voluntario. La emisión efectiva de este evento depende de la infraestructura de auditoría disponible en el momento de la implementación.
- Las renovaciones de tokens exitosas no generan eventos de auditoría (son operaciones transparentes de mantenimiento de sesión).

### Cuotas y límites

No aplica directamente. La renovación de tokens consume un endpoint de Keycloak, pero el rate limiting de ese endpoint es responsabilidad de Keycloak y del API Gateway, no de esta tarea. La consola debe evitar renovaciones innecesarias (ej. no renovar en cada petición, sino solo cuando se acerque la expiración).

### Trazabilidad

- Los componentes de gestión de sesión y protección de rutas DEBERÍAN incluir atributos `data-testid` o equivalentes en los elementos visibles al usuario (ej. mensaje de sesión expirada, indicadores de estado) para facilitar las pruebas E2E de T06.
- Los estados de sesión (autenticado, renovando, expirado) DEBERÍAN ser observables desde las herramientas de desarrollo del navegador para facilitar la depuración.

---

## Fuera de alcance explícito

| Elemento | Tarea responsable | Motivo de exclusión |
|---|---|---|
| Aplicación React base y configuración fundacional | US-UI-01-T01 | Prerrequisito ya entregado. |
| Página de login con Keycloak | US-UI-01-T02 | Flujo de autenticación inicial, no de mantenimiento de sesión. |
| Pantallas de signup y activación pendiente | US-UI-01-T03 | Flujo de registro, fuera de la gestión de sesión. |
| Shell con header, sidebar, dropdown y navegación | US-UI-01-T04 | Layout estructural; esta tarea provee la capa de sesión que el shell consume. |
| Pruebas E2E de login, logout, signup y navegación | US-UI-01-T06 | Validación automatizada, no construcción de la capa de sesión. |
| Autorización por roles o permisos en la UI | Tarea futura | Requiere definir política de permisos UI; esta tarea solo gestiona autenticación. |
| Filtrado de contenido por tenant en el frontend | Tarea futura | La segregación por tenant es responsabilidad del backend. |
| Alerta previa al usuario antes de expiración de sesión | Mejora futura | Mejora de UX que no es requisito base. |
| Sincronización avanzada de sesión entre pestañas | Mejora futura | Comportamiento básico esperado pero la estrategia avanzada se decidirá como mejora. |
| Single Sign-Out federado entre múltiples aplicaciones | Fuera de alcance del producto en esta fase | Requiere infraestructura de SSO avanzada. |
| Gestión de sesión offline o en modo sin conexión | Fuera de alcance | La consola requiere conectividad para operar. |

---

## Success Criteria

### Resultados medibles

- **SC-001**: Un usuario sin sesión activa que navega a cualquier ruta protegida es redirigido a la página de login en menos de 500ms, sin que se renderice contenido de la ruta protegida.
- **SC-002**: Un usuario autenticado cuyo access token está próximo a expirar experimenta una renovación automática transparente: la sesión continúa sin interrupciones y sin intervención del usuario.
- **SC-003**: Cuando la renovación de tokens falla (refresh token expirado o sesión revocada), el usuario es redirigido al login con un mensaje informativo de sesión expirada en menos de 2 segundos desde la detección del fallo.
- **SC-004**: Cuando múltiples peticiones concurrentes reciben HTTP 401, se ejecuta una sola renovación de token y todas las peticiones pendientes se reintentan con el nuevo token.
- **SC-005**: Las respuestas HTTP 403 de la API se propagan al componente sin desencadenar el flujo de renovación ni cierre de sesión.
- **SC-006**: Tras un cierre de sesión forzado y re-autenticación, el usuario es devuelto a la ruta donde estaba trabajando antes de la expiración.
- **SC-007**: Un usuario autenticado que accede a la ruta de login es redirigido automáticamente a la ruta protegida por defecto.
- **SC-008**: Tras un cierre de sesión forzado, no quedan tokens ni datos de sesión residuales en el almacenamiento del cliente (verificable por inspección del almacenamiento del navegador).
- **SC-009**: Un desarrollador del equipo puede proteger una nueva ruta añadiéndola a la configuración de rutas protegidas sin modificar la lógica de gestión de sesión (verificable por revisión de código).
- **SC-010**: Un error de red transitorio durante la renovación de tokens no ejecuta cierre de sesión inmediato; se reintenta al menos una vez antes de escalar.

---

## Supuestos

- Las tareas T01 (aplicación React base), T02 (login con Keycloak), T03 (signup) y T04 (shell de navegación) están completadas o en progreso paralelo, de modo que existe una aplicación React funcional con autenticación inicial y un shell donde integrar la gestión de sesión.
- Keycloak está configurado con un flujo estándar de OAuth2/OIDC que emite access tokens y refresh tokens con tiempos de expiración configurables. Los tiempos de expiración concretos (ej. 5 minutos para access token, 30 minutos para refresh token) son configuración de Keycloak, no decisión de esta tarea.
- El endpoint de renovación de tokens de Keycloak (`/token` con `grant_type=refresh_token`) está disponible y accesible desde el frontend.
- El shell (T04) consume los datos de sesión que esta tarea expone (estado de autenticación, datos del usuario desde los claims) sin que el shell gestione tokens directamente.
- El logout voluntario del shell (T04, opción "Logout" del dropdown) utilizará el mecanismo de cierre de sesión que esta tarea provee, diferenciándolo del cierre forzado solo en el mensaje al usuario.

## Riesgos

- **Riesgo**: Que la configuración de Keycloak tenga tiempos de expiración de refresh token muy cortos, provocando cierres de sesión frecuentes. **Mitigación**: La especificación no fija los tiempos de expiración; se documentará la dependencia de la configuración de Keycloak y se recomendará un tiempo de refresh token adecuado para sesiones de trabajo.
- **Riesgo**: Que la estrategia de almacenamiento de tokens (memoria vs. sessionStorage vs. localStorage) tenga trade-offs de seguridad y persistencia difíciles de conciliar. **Mitigación**: La decisión se tomará en la planificación técnica con criterios explícitos documentados; esta especificación no prescribe el mecanismo.
- **Riesgo**: Que la renovación automática genere demasiadas peticiones al endpoint de Keycloak en escenarios de múltiples pestañas abiertas. **Mitigación**: FR-010 exige que las renovaciones concurrentes se colapsen en una sola operación; la sincronización entre pestañas puede mitigarse con mejoras futuras.

## Preguntas abiertas

_Ninguna pregunta bloquea el avance de esta especificación. Las decisiones de implementación (mecanismo de almacenamiento de tokens, librería de gestión de estado para la sesión, estrategia exacta de interceptación HTTP, margen de renovación proactiva) se tomarán en la fase de planificación técnica._
