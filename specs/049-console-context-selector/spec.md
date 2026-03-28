# Especificación de Feature: Selector de tenant y workspace con persistencia de contexto

**Feature Branch**: `049-console-context-selector`
**Creada**: 2026-03-28
**Estado**: Specified
**Task ID**: US-UI-02-T01
**Epic**: EP-14 — Consola de administración: shell, acceso y contexto
**Historia padre**: US-UI-02 — Contexto de tenant/workspace, members y gestión Auth/IAM en consola
**Tipo**: Feature
**Prioridad**: P0
**Tamaño relativo**: L
**Dependencias de historia**: US-UI-01, US-IAM-02, US-TEN-03
**Dependencias dentro de la historia**: Ninguna (primera tarea de la historia)
**RF trazados desde la historia**: RF-UI-011, RF-UI-012, RF-UI-013, RF-UI-014, RF-UI-015, RF-UI-023, RF-UI-024
**Input**: Prompt de especificación importado para US-UI-02-T01

---

## Objetivo y problema que resuelve

Las tareas de US-UI-01 entregan el shell de consola con header, sidebar, login, signup, sesión y rutas protegidas. Sin embargo, una vez autenticado, el usuario opera en un vacío de contexto: no existe mecanismo para seleccionar sobre qué tenant está trabajando, ni para elegir un workspace concreto dentro de ese tenant. Todas las operaciones futuras de la consola — gestión de funciones serverless, storage, observabilidad, miembros, permisos — dependen de saber en qué tenant y workspace se ejecutan.

**US-UI-02-T01 resuelve exactamente esto**: entregar un selector de tenant y un selector de workspace integrados en el shell de la consola, que permitan al usuario elegir y cambiar su contexto de trabajo activo, y que ese contexto se persista entre navegaciones y recarga de página, de modo que toda la consola sepa en todo momento contra qué tenant y workspace debe operar.

Sin esta tarea, cada pantalla futura tendría que resolver por su cuenta cómo determinar el tenant y workspace objetivo, la experiencia sería fragmentada y el aislamiento multi-tenant en la capa de UI no tendría un punto de anclaje coherente.

---

## Usuarios y consumidores afectados

| Actor | Relación con esta tarea | Valor que recibe |
|---|---|---|
| **Superadmin de plataforma** | Consumidor final de la consola | Puede cambiar entre todos los tenants y workspaces de la plataforma para supervisar, auditar o intervenir en cualquiera de ellos. |
| **Tenant owner** | Consumidor final de la consola | Selecciona su tenant (o tenants si pertenece a varios) y elige el workspace en el que quiere operar; el contexto se mantiene estable mientras trabaja. |
| **Workspace admin** | Consumidor final de la consola | Selecciona el workspace que administra y trabaja con la certeza de que todas las operaciones de la consola afectan únicamente a ese workspace. |
| **Miembro de tenant** | Consumidor final de la consola | Ve solo los tenants y workspaces a los que tiene acceso; puede cambiar entre ellos sin perder orientación. |
| **Equipo de desarrollo (consumidor interno)** | Construye pantallas dentro del shell | Obtiene un contexto de tenant/workspace resuelto y disponible globalmente, evitando que cada página reimplemente la lógica de selección. |

---

## User Scenarios & Testing

### User Story 1 — Selección de tenant activo (Prioridad: P1)

Como usuario autenticado que pertenece a uno o más tenants, quiero ver un selector de tenant en el shell de la consola y poder elegir el tenant sobre el que voy a trabajar, para que todas las operaciones posteriores se ejecuten en el contexto correcto.

**Por qué esta prioridad**: Sin un tenant seleccionado, ninguna operación de la consola tiene sentido en un producto multi-tenant. Es el requisito más básico del contexto.

**Prueba independiente**: Iniciar sesión con un usuario que pertenece a al menos dos tenants, verificar que aparece el selector de tenant, elegir uno y confirmar que el contexto se actualiza visualmente.

**Escenarios de aceptación**:

1. **Dado** que el usuario acaba de iniciar sesión y pertenece a un único tenant, **cuando** se carga el shell de la consola, **entonces** ese tenant se selecciona automáticamente como contexto activo y se muestra su nombre en el selector.
2. **Dado** que el usuario acaba de iniciar sesión y pertenece a múltiples tenants, **cuando** se carga el shell de la consola, **entonces** se muestra el selector de tenant indicando que debe elegir un tenant, o se selecciona el último tenant utilizado si existe contexto persistido.
3. **Dado** que el usuario hace clic en el selector de tenant, **cuando** se despliega la lista, **entonces** se muestran únicamente los tenants a los que el usuario tiene acceso según sus permisos actuales.
4. **Dado** que el usuario selecciona un tenant diferente al activo, **cuando** confirma la selección, **entonces** el contexto de tenant activo se actualiza, el selector muestra el nuevo tenant, y el workspace previamente seleccionado se limpia (porque pertenecía al tenant anterior).
5. **Dado** que el usuario tiene acceso a un solo tenant, **cuando** interactúa con el selector, **entonces** el selector muestra el nombre del tenant pero no ofrece alternativas para cambiar (o muestra la lista con un único elemento).

---

### User Story 2 — Selección de workspace dentro del tenant activo (Prioridad: P1)

Como usuario autenticado que ha seleccionado un tenant, quiero elegir un workspace dentro de ese tenant para operar sobre los recursos de ese workspace concreto.

**Por qué esta prioridad**: El workspace es el segundo nivel de contexto obligatorio. Sin él, las operaciones sobre recursos (funciones, storage, etc.) no pueden resolverse.

**Prueba independiente**: Seleccionar un tenant que tiene al menos dos workspaces, verificar que el selector de workspace muestra las opciones disponibles, elegir uno y confirmar que el contexto se actualiza.

**Escenarios de aceptación**:

1. **Dado** que el usuario ha seleccionado un tenant activo, **cuando** se renderiza el selector de workspace, **entonces** se muestran únicamente los workspaces de ese tenant a los que el usuario tiene acceso.
2. **Dado** que el tenant activo tiene un único workspace accesible para el usuario, **cuando** se selecciona el tenant, **entonces** ese workspace se selecciona automáticamente como contexto activo.
3. **Dado** que el tenant activo tiene múltiples workspaces accesibles, **cuando** el usuario hace clic en el selector de workspace, **entonces** se despliega la lista de workspaces disponibles y puede elegir uno.
4. **Dado** que el usuario selecciona un workspace diferente al activo, **cuando** confirma la selección, **entonces** el contexto de workspace activo se actualiza y el selector muestra el nuevo workspace.
5. **Dado** que el usuario cambia de tenant (User Story 1, escenario 4), **cuando** se actualiza el contexto de tenant, **entonces** el selector de workspace se reinicia y muestra los workspaces del nuevo tenant, sin conservar la selección del tenant anterior.
6. **Dado** que el usuario no tiene acceso a ningún workspace dentro del tenant activo, **cuando** se renderiza el selector de workspace, **entonces** se muestra un estado vacío claro indicando que no hay workspaces disponibles y el usuario no puede seleccionar ninguno.

---

### User Story 3 — Persistencia del contexto seleccionado (Prioridad: P1)

Como usuario que ha elegido un tenant y un workspace, quiero que mi selección se mantenga cuando navego entre páginas de la consola y cuando recargo la página, para no tener que repetir la selección en cada interacción.

**Por qué esta prioridad**: Sin persistencia, el cambio de página o un F5 obliga al usuario a re-seleccionar contexto constantemente, destruyendo la usabilidad.

**Prueba independiente**: Seleccionar un tenant y workspace, navegar a otra sección de la consola, verificar que el contexto se mantiene. Recargar la página completa y verificar que el contexto sigue siendo el mismo.

**Escenarios de aceptación**:

1. **Dado** que el usuario ha seleccionado un tenant y un workspace, **cuando** navega a otra sección/ruta de la consola usando la sidebar o cualquier enlace interno, **entonces** el tenant y workspace seleccionados siguen apareciendo como activos en los selectores.
2. **Dado** que el usuario ha seleccionado un tenant y un workspace, **cuando** recarga la página del navegador (F5 o equivalente), **entonces** al re-renderizarse la consola, se recupera automáticamente la última selección de tenant y workspace y se muestra como activa.
3. **Dado** que el usuario cierra la sesión y vuelve a iniciar sesión, **cuando** se carga el shell, **entonces** se recupera la última selección de tenant y workspace del usuario si sigue siendo válida (el usuario aún tiene acceso a ese tenant y workspace).
4. **Dado** que el usuario tenía contexto persistido pero su acceso al tenant o workspace ha sido revocado entre sesiones, **cuando** se intenta restaurar el contexto, **entonces** el sistema detecta que el acceso ya no es válido, limpia la selección persistida y solicita al usuario que elija un nuevo contexto.

---

### User Story 4 — Contexto accesible globalmente para el resto de la consola (Prioridad: P2)

Como desarrollador del equipo que construye nuevas pantallas de la consola, quiero que el tenant y workspace activos estén disponibles como estado global de la aplicación, para que cualquier página o componente pueda consumir el contexto sin re-implementar lógica de selección.

**Por qué esta prioridad**: Es un habilitador interno. No tiene impacto visual directo para el usuario final, pero es imprescindible para que las pantallas futuras funcionen correctamente.

**Prueba independiente**: Desde cualquier componente hijo dentro del shell, acceder al contexto global y verificar que devuelve el tenant ID y workspace ID activos.

**Escenarios de aceptación**:

1. **Dado** que el usuario tiene un tenant y workspace seleccionados, **cuando** cualquier componente de la consola consulta el contexto activo, **entonces** recibe el identificador del tenant activo y el identificador del workspace activo.
2. **Dado** que el usuario cambia de tenant o workspace, **cuando** el contexto se actualiza, **entonces** todos los componentes que consumen el contexto se actualizan reactivamente sin necesidad de recargar la página.
3. **Dado** que no se ha seleccionado aún un tenant o un workspace, **cuando** un componente consulta el contexto, **entonces** recibe un valor nulo o indicador explícito de "sin contexto" que le permite mostrar un estado apropiado.

---

### Edge Cases

- **Usuario sin tenants**: ¿Qué ocurre si un usuario autenticado no pertenece a ningún tenant? → El selector de tenant muestra un estado vacío con mensaje claro. No se puede seleccionar workspace. La consola debe mostrar un estado informativo que explique que no tiene tenants asignados.
- **Tenant eliminado durante la sesión**: Si el tenant activo es eliminado mientras el usuario trabaja, las peticiones al backend fallarán. El sistema debe detectar errores de contexto inválido (404, 403 en operaciones de tenant) y limpiar la selección, solicitando al usuario que elija otro contexto.
- **Workspace eliminado durante la sesión**: Mismo tratamiento que el caso anterior pero a nivel de workspace: limpiar la selección de workspace y solicitar nueva selección dentro del tenant activo.
- **Cambio de permisos en caliente**: Si un administrador revoca el acceso del usuario a un tenant/workspace mientras este está activo, las operaciones subsiguientes contra la API devolverán errores de autorización. El sistema debe limpiar el contexto afectado y mostrar un mensaje apropiado.
- **Múltiples pestañas del navegador**: Si el usuario tiene la consola abierta en varias pestañas y cambia de contexto en una, ¿qué ocurre en las demás? → Para esta tarea, es aceptable que cada pestaña mantenga su propio contexto de forma independiente. La sincronización entre pestañas es un refinamiento futuro.
- **Latencia en la carga de tenants/workspaces**: Si la llamada a la API para obtener la lista de tenants o workspaces es lenta, el selector debe mostrar un indicador de carga y no permitir interacción hasta que los datos estén disponibles.
- **Error en la carga de tenants/workspaces**: Si la API falla al obtener la lista, se debe mostrar un estado de error con posibilidad de reintentar, en lugar de un selector vacío silencioso.

---

## Requirements

### Requisitos funcionales

- **RF-001**: El sistema DEBE mostrar un selector de tenant integrado en el shell de la consola, visible en todas las páginas protegidas post-autenticación.
- **RF-002**: El selector de tenant DEBE listar únicamente los tenants a los que el usuario autenticado tiene acceso, obtenidos de la API del backend.
- **RF-003**: Si el usuario tiene acceso a un único tenant, el sistema DEBE seleccionarlo automáticamente al cargar la consola.
- **RF-004**: El sistema DEBE mostrar un selector de workspace integrado en el shell, que se active y muestre opciones solo cuando hay un tenant seleccionado.
- **RF-005**: El selector de workspace DEBE listar únicamente los workspaces del tenant activo a los que el usuario tiene acceso.
- **RF-006**: Si el tenant activo tiene un único workspace accesible, el sistema DEBE seleccionarlo automáticamente.
- **RF-007**: Al cambiar de tenant, el sistema DEBE limpiar la selección de workspace anterior y cargar los workspaces del nuevo tenant.
- **RF-008**: El sistema DEBE persistir la selección de tenant y workspace activos de forma que sobreviva a la navegación entre rutas y a la recarga completa de la página.
- **RF-009**: Al restaurar un contexto persistido, el sistema DEBE validar que el usuario aún tiene acceso al tenant y workspace guardados; si no, DEBE limpiar la selección y solicitar una nueva.
- **RF-010**: El sistema DEBE exponer el contexto activo (tenant ID, workspace ID) como estado global reactivo de la aplicación, consumible por cualquier componente hijo.
- **RF-011**: Cuando no hay tenant seleccionado, el selector de workspace DEBE estar deshabilitado o mostrar un estado que indique que primero se debe elegir un tenant.
- **RF-012**: El selector de tenant DEBE mostrar un estado de carga mientras se obtiene la lista de tenants de la API.
- **RF-013**: Si la obtención de la lista de tenants o workspaces falla, el selector DEBE mostrar un estado de error con opción de reintentar.
- **RF-014**: Cuando el usuario no pertenece a ningún tenant, la consola DEBE mostrar un estado informativo claro en lugar de selectores vacíos sin explicación.
- **RF-015**: Los selectores DEBEN ser accesibles por teclado (navegación con Tab, selección con Enter, cierre con Escape).

### Entidades clave

- **Tenant**: Unidad de aislamiento lógico de primer nivel. Atributos relevantes para esta tarea: identificador único, nombre legible para mostrar en el selector. Un usuario puede pertenecer a uno o más tenants.
- **Workspace**: Subdivisión de recursos dentro de un tenant. Atributos relevantes: identificador único, nombre legible, tenant al que pertenece. Un usuario puede tener acceso a uno o más workspaces dentro de un tenant.
- **Contexto activo**: Par (tenant seleccionado, workspace seleccionado) que determina el ámbito de todas las operaciones de la consola. Persistido del lado del cliente. Expuesto como estado global reactivo.
- **Usuario autenticado**: Sujeto del contexto. Sus permisos determinan qué tenants y workspaces se muestran en los selectores.

---

## Permisos, aislamiento multi-tenant, auditoría y seguridad

- **Aislamiento en selector**: Los selectores SOLO deben mostrar tenants y workspaces a los que el usuario tiene acceso. La lista se obtiene de la API, que aplica filtrado por permisos en el backend. La consola no debe confiar en lógica de filtrado del lado del cliente para decisiones de acceso.
- **No escalamiento de privilegios**: Cambiar de tenant o workspace en el selector no otorga permisos adicionales. El contexto seleccionado simplemente dirige las peticiones al backend, que valida permisos en cada operación.
- **Tokens y contexto**: El contexto seleccionado (tenant ID, workspace ID) se envía como parte de las peticiones al backend (cabeceras, parámetros o path). El backend valida que el token del usuario tiene permisos sobre ese tenant/workspace en cada llamada.
- **Auditoría**: Los cambios de contexto (selección de tenant, selección de workspace) son acciones del lado del cliente que no requieren registro de auditoría propio en esta tarea. La auditoría de operaciones ocurre en el backend cuando se ejecutan las acciones reales.
- **Persistencia segura**: El contexto persistido en el cliente (tenant ID, workspace ID) no contiene información sensible más allá de identificadores. No se persisten tokens ni datos de permisos.

---

## Criterios de éxito

### Resultados medibles

- **SC-001**: El usuario puede seleccionar un tenant y un workspace en menos de 3 clics desde el estado inicial post-login.
- **SC-002**: El contexto seleccionado sobrevive al 100% de las navegaciones internas de la consola y a la recarga completa de la página.
- **SC-003**: Al cambiar de tenant, el workspace anterior se limpia y el nuevo listado de workspaces se presenta en menos de 2 segundos (asumiendo latencia de API normal).
- **SC-004**: Un usuario que pertenece a un solo tenant y un solo workspace llega al estado de "contexto completo" de forma automática, sin interacción manual con los selectores.
- **SC-005**: Los selectores son operables íntegramente con teclado (Tab, Enter, Escape, flechas).
- **SC-006**: Ningún tenant o workspace al que el usuario no tiene acceso aparece en los selectores.

---

## Supuestos

- Existe una API en el backend que devuelve la lista de tenants accesibles por el usuario autenticado, y una API que devuelve los workspaces de un tenant accesibles por ese usuario. Estas APIs son provistas por US-TEN-03 y US-IAM-02.
- El shell de la consola (header, sidebar, layout) ya está entregado por US-UI-01 y disponible como contenedor donde integrar los selectores.
- La gestión de sesión y tokens (US-UI-01-T05) ya está operativa, de modo que las peticiones a la API para obtener tenants y workspaces se autentican automáticamente.

## Riesgos

- **APIs de tenant/workspace no disponibles todavía**: Si las APIs de listado de tenants y workspaces de US-TEN-03 / US-IAM-02 no están listas, esta tarea podría necesitar datos mock para avanzar en la implementación de UI. Esto no bloquea la especificación pero sí la verificación end-to-end.

## Fuera de alcance de esta tarea

- Mostrar estado, cuotas o métricas del tenant/workspace seleccionado (US-UI-02-T02).
- Vistas de members, invitaciones, roles y permisos (US-UI-02-T03).
- Vistas de Auth/IAM (US-UI-02-T04).
- Gestión de aplicaciones externas vinculadas al workspace (US-UI-02-T05).
- Pruebas E2E de cambio de contexto (US-UI-02-T06).
