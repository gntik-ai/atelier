# Feature Specification: US-UI-02-T04 — Vistas de Auth/IAM en consola

**Feature Branch**: `052-console-auth-iam-views`  
**Created**: 2026-03-29  
**Status**: Draft  
**Input**: User description: "Construir vistas de Auth/IAM para users, roles, scopes, clients, providers OIDC/SAML y aplicaciones externas"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Inspeccionar la postura Auth/IAM del tenant activo (Priority: P1)

Como operador de la consola con acceso al tenant activo, quiero abrir una vista Auth/IAM que me muestre el estado del realm de consola y sus superficies principales de identidad para entender, sin salir de la consola, qué users/roles existen, cuántos scopes y clients están gestionados y si el realm está listo para operar.

**Why this priority**: La historia padre exige administrar identidad y colaboración desde la consola. Sin una entrada Auth/IAM legible dentro del shell, el operador sigue dependiendo de herramientas nativas o de navegación fragmentada.

**Independent Test**: Puede probarse de forma independiente entrando a `/console/auth` con un tenant activo que tenga `consoleUserRealm`, verificando que la página muestra el resumen de users/roles, tablas de scopes y clients, y enlaza a la vista detallada de members sin romper el contexto activo.

**Acceptance Scenarios**:

1. **Given** un usuario autenticado con un tenant activo que expone `consoleUserRealm`, **When** entra a `/console/auth`, **Then** ve un resumen del realm con métricas visibles para users, roles, scopes y clients sin abandonar el shell.
2. **Given** un tenant activo con realm IAM accesible, **When** la consola carga la sección del realm, **Then** presenta tablas de scopes y clients con estados, protocolo y metadatos operativos relevantes en formato legible.
3. **Given** que los users y roles ya tienen una vista dedicada en `/console/members`, **When** el operador consulta la vista Auth/IAM, **Then** ve un resumen de users/roles y un acceso directo claro a la vista detallada de members sin duplicar flujos de edición.

---

### User Story 2 - Inspeccionar aplicaciones externas vinculadas al workspace activo (Priority: P2)

Como workspace admin, quiero ver en la consola las aplicaciones externas del workspace activo, con sus flujos de autenticación, validaciones, scopes, redirects y relación con el client IAM subyacente, para entender la postura de acceso de mis apps antes de crear o cambiar configuraciones.

**Why this priority**: La historia incluye gestión Auth/IAM de aplicaciones externas. Antes de introducir escritura en T05, el operador necesita una vista confiable y contextual de lo ya configurado.

**Independent Test**: Puede probarse con un workspace activo que tenga aplicaciones registradas, verificando que la página muestra la colección de aplicaciones externas y sus señales principales de autenticación/validación.

**Acceptance Scenarios**:

1. **Given** un tenant y workspace activos, **When** la consola carga las aplicaciones externas del workspace, **Then** muestra una tabla con display name, protocolo, estado, flows, redirects, scopes y estado de validación por aplicación.
2. **Given** un workspace sin aplicaciones externas, **When** la sección correspondiente se renderiza, **Then** se muestra un estado vacío explícito y no un error genérico.
3. **Given** un cambio de workspace activo desde el selector del shell, **When** el operador permanece en `/console/auth`, **Then** la sección de aplicaciones externas se recarga con los datos del nuevo workspace sin mezclar resultados entre workspaces.

---

### User Story 3 - Revisar providers federados OIDC/SAML asociados a las apps (Priority: P3)

Como operador responsable de autenticación federada, quiero visualizar qué providers OIDC/SAML están asociados a las aplicaciones externas del workspace activo para comprobar alias, protocolo, modo de configuración y estado habilitado antes de tocar la configuración.

**Why this priority**: La federación es parte central del alcance de T04, pero su inspección puede entregarse después del resumen de realm y de la lista de aplicaciones porque depende de ese mismo contexto.

**Independent Test**: Puede probarse con una respuesta de aplicaciones externas que incluya `federatedProviders`, verificando que la página agrega y presenta providers OIDC/SAML con referencia a la aplicación asociada.

**Acceptance Scenarios**:

1. **Given** aplicaciones externas con providers federados asociados, **When** la sección de providers se renderiza, **Then** la consola muestra alias, protocolo, modo de provider, estado habilitado y aplicación asociada.
2. **Given** una aplicación sin providers federados, **When** la lista se procesa, **Then** la consola no falla y refleja que esa aplicación no expone providers.
3. **Given** un provider SAML u OIDC deshabilitado, **When** aparece en la lista, **Then** su estado queda visible de forma diferenciada para el operador.

---

### Edge Cases

- ¿Qué ocurre si existe tenant activo pero no `consoleUserRealm`? La página debe mostrar un estado vacío específico para el dominio Auth/IAM del tenant y no intentar cargar colecciones del realm.
- ¿Qué ocurre si existe tenant activo pero no workspace activo? La parte de realm debe seguir siendo usable, mientras que las secciones de aplicaciones externas y providers deben mostrar un estado contextual solicitando seleccionar un workspace.
- ¿Qué ocurre si falla una colección concreta (por ejemplo, clients) pero scopes sí responde? Los errores deben quedar aislados por sección; la página no debe degradar completamente si otras secciones siguen disponibles.
- ¿Qué ocurre si la API devuelve colecciones vacías? Debe mostrarse una experiencia de vacío por sección, diferenciando “sin datos” de “error”.
- ¿Qué ocurre al cambiar de tenant o workspace mientras la página está abierta? Deben reiniciarse las cargas y descartarse respuestas obsoletas para no mezclar datos entre contextos.
- ¿Qué ocurre si una aplicación usa `api_key` y no expone providers federados? La vista debe seguir mostrando la aplicación sin asumir obligatoriamente OIDC/SAML para todos los registros.
- ¿Qué ocurre si el usuario autenticado no tiene permiso para alguna sección? Debe mostrarse el mensaje de error devuelto por la API en esa sección, sin revelar datos de otros tenants o workspaces.

## Requirements *(mandatory)*

## Functional Requirements

- **FR-001**: El sistema MUST exponer una ruta protegida `/console/auth` dentro del shell administrativo para la inspección de Auth/IAM.
- **FR-002**: La vista Auth/IAM MUST consumir el `consoleUserRealm` del tenant activo para cargar el resumen del realm y las colecciones IAM correspondientes.
- **FR-003**: La vista MUST mostrar un resumen visible de users, roles, scopes y clients del realm activo.
- **FR-004**: La vista MUST ofrecer acceso directo a la vista detallada existente de `/console/members` para users y roles del realm, manteniendo el mismo contexto activo.
- **FR-005**: La vista MUST mostrar una tabla o listado accesible de client scopes del realm con nombre, protocolo, flags operativas y vínculos con clients cuando existan.
- **FR-006**: La vista MUST mostrar una tabla o listado accesible de IAM clients con protocolo, access type, estado, redirects, origins y scopes principales.
- **FR-007**: La vista MUST mostrar la colección de aplicaciones externas del workspace activo con al menos protocolo, estado, display name, flows de autenticación, scopes, redirects y resultado de validación.
- **FR-008**: La vista MUST presentar los providers federados OIDC/SAML asociados a las aplicaciones externas del workspace activo, incluyendo aplicación asociada, alias, protocolo, modo y estado habilitado.
- **FR-009**: La vista MUST diferenciar estados de carga, vacío y error por sección (realm, applications, providers) sin colapsar toda la página por un fallo parcial.
- **FR-010**: La vista MUST reaccionar a cambios de tenant y workspace activos recargando los datos relevantes y descartando resultados obsoletos.
- **FR-011**: El sistema MUST respetar el aislamiento multi-tenant y multi-workspace, evitando reutilizar resultados de un contexto en otro contexto activo.
- **FR-012**: La vista MUST ser estrictamente read-only en T04; no debe crear, editar, borrar, activar ni desactivar users, roles, scopes, clients, providers o aplicaciones externas.
- **FR-013**: Cuando no exista tenant activo, la página MUST mostrar un estado vacío específico solicitando seleccionar un tenant.
- **FR-014**: Cuando el tenant activo no exponga `consoleUserRealm`, la página MUST mostrar un estado vacío específico indicando que el tenant no tiene realm IAM de consola configurado.
- **FR-015**: Cuando no exista workspace activo, la página MUST mantener accesibles las secciones del realm y mostrar estados vacíos contextuales para aplicaciones externas y providers.
- **FR-016**: La navegación lateral del shell MUST incluir un ítem visible “Auth” o equivalente claramente asociado a Auth/IAM.
- **FR-017**: Los mensajes de error MUST reutilizar, cuando sea posible, el `message` devuelto por la API para que el operador entienda el problema sin exponer información sensible adicional.
- **FR-018**: La presentación MUST ser accesible mediante tablas/listados semánticos, encabezados claros, estados con `role="alert"` en errores y affordances comprensibles para teclado/lector de pantalla.

### Key Entities *(include if feature involves data)*

- **Realm Auth Summary**: Resumen operativo del realm de consola del tenant activo, incluyendo métricas visibles de users, roles, scopes y clients.
- **IAM Scope**: Scope gestionado del realm, con nombre, protocolo, banderas de inclusión y asociación con clients.
- **IAM Client**: Cliente IAM gestionado del realm, con tipo de acceso, protocolo, estado y configuración de redirects/origins/scopes.
- **External Application**: Aplicación externa vinculada a un workspace con protocolo, flows, client IAM, redirects, scopes, validaciones y metadata operativa.
- **Federated Identity Provider**: Provider OIDC o SAML asociado a una aplicación externa, con alias, protocolo, modo y estado habilitado.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un operador autenticado puede llegar desde el shell a la superficie Auth/IAM del tenant/workspace activo en un máximo de 2 clics desde cualquier página de consola.
- **SC-002**: La vista `/console/auth` actualiza sus datos del realm y del workspace activo tras un cambio de contexto sin requerir recarga manual completa de la SPA.
- **SC-003**: Los estados de carga, vacío y error quedan visibles por sección y pueden verificarse mediante pruebas automatizadas del paquete `@in-atelier/web-console`.
- **SC-004**: La vista expone de forma legible el inventario mínimo de scopes, clients, aplicaciones externas y providers federados del contexto activo sin introducir operaciones de escritura en T04.
