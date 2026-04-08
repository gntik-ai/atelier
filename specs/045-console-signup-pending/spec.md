# Feature Specification: Signup de consola y pantalla de activación pendiente

**Feature Branch**: `045-console-signup-pending`  
**Created**: 2026-03-28  
**Status**: Draft  
**Input**: User description: "Implementar pantallas de signup y estado pendiente de activación cuando el auto-registro esté habilitado"

**Compatibility note**: Esta feature debe mantenerse compatible con el baseline ya entregado en `US-UI-01-T01` y `US-UI-01-T02`. No debe absorber shell persistente, refresh de tokens, rutas protegidas, logout ni las pruebas E2E completas reservadas para `US-UI-01-T04` a `US-UI-01-T06`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Registrarme desde la consola cuando el auto-registro está habilitado (Priority: P1)

Como usuario potencial de la consola, quiero completar un formulario de signup dentro de la SPA para solicitar o crear mi acceso sin abandonar el flujo principal del producto.

**Why this priority**: Sin una pantalla de signup usable, el punto de entrada público de la consola queda incompleto cuando la policy permite auto-registro.

**Independent Test**: Puede probarse visitando `/signup`, resolviendo una policy de registro permitida, completando el formulario mínimo y verificando que la SPA envía el alta a `/v1/auth/signups` y comunica el resultado sin errores de UI no controlados.

**Acceptance Scenarios**:

1. **Given** que la policy efectiva permite auto-registro, **When** la persona abre `/signup`, **Then** la pantalla muestra el formulario mínimo requerido y explica si la activación será automática o pendiente de aprobación.
2. **Given** que la persona envía datos válidos de signup, **When** la API acepta la solicitud, **Then** la pantalla comunica el resultado canónico de registro y ofrece una siguiente acción coherente.
3. **Given** que la activación efectiva es automática, **When** el registro es aceptado, **Then** la SPA indica que la cuenta ya puede continuar hacia el acceso de consola sin introducir shell ni sesión persistente adicionales.

---

### User Story 2 - Entender que mi cuenta está pendiente de activación (Priority: P1)

Como usuario recién registrado, quiero ver una pantalla explícita de activación pendiente para saber que el registro fue aceptado pero todavía requiere aprobación o una acción previa antes de entrar.

**Why this priority**: El estado `pending_activation` forma parte del comportamiento esperado del dominio y necesita una pantalla dedicada para evitar incertidumbre tras el signup o el login.

**Independent Test**: Puede probarse simulando una respuesta de signup en `pending_activation` o visitando la pantalla de estado pendiente y comprobando que se muestra copy canónica, contexto del registro y siguientes acciones seguras.

**Acceptance Scenarios**:

1. **Given** que el backend devuelve un registro en estado `pending_activation`, **When** la persona termina el signup, **Then** la SPA la lleva a una pantalla dedicada que explica el estado y las acciones siguientes disponibles.
2. **Given** que un login previo ya detectó `pending_activation`, **When** la persona entra en la vista de estado, **Then** la pantalla mantiene un mensaje coherente con el contrato público `status-view` y evita reintentos ambiguos.
3. **Given** que la vista se carga sin contexto completo del registro, **When** el usuario abre la pantalla de activación pendiente, **Then** la SPA sigue mostrando copy útil y un camino visible de vuelta al login o al signup.

---

### User Story 3 - Saber si el signup está deshabilitado sin recibir affordances engañosas (Priority: P2)

Como visitante de la consola, quiero que la pantalla de signup refleje honestamente la policy efectiva para no intentar un flujo que el entorno no admite.

**Why this priority**: La discoverability del acceso debe mantenerse alineada con la policy pública y evitar CTA engañosos cuando el registro no está permitido.

**Independent Test**: Puede probarse haciendo que `/v1/auth/signups/policy` devuelva `allowed=false` o falle transitoriamente y verificando que la pantalla deja claro el estado sin bloquear el acceso alternativo al login.

**Acceptance Scenarios**:

1. **Given** que la policy efectiva deshabilita el auto-registro, **When** la persona abre `/signup`, **Then** la pantalla no envía altas y comunica que el registro no está disponible en ese entorno.
2. **Given** que la resolución de policy falla temporalmente, **When** la pantalla se monta, **Then** la UI degrada con seguridad, evita prometer un alta no confirmada y mantiene visible el camino hacia login.

---

### Edge Cases

- El formulario omite campos obligatorios o incumple los mínimos del contrato (`username`, `displayName`, `primaryEmail`, `password`).
- El backend rechaza el signup con `403` porque la policy efectiva no permite auto-registro para el entorno o plan solicitados.
- El backend devuelve `409` porque el username o email ya existen.
- El gateway devuelve `429`, `504` o un error de red mientras el formulario está en vuelo.
- El usuario reenvía el formulario repetidamente mientras la petición sigue en curso.
- La pantalla de activación pendiente se visita directamente sin un `registrationId` o contexto de navegación previo.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema MUST exponer una ruta visible de signup en la SPA de la consola bajo el path configurado para registro (`/signup` en el baseline actual).
- **FR-002**: La pantalla de signup MUST resolver la policy efectiva desde `/v1/auth/signups/policy` antes de permitir el envío del formulario.
- **FR-003**: La SPA MUST capturar y validar visualmente los campos mínimos `username`, `displayName`, `primaryEmail` y `password` para solicitar el alta de consola.
- **FR-004**: La SPA MUST autenticar el alta contra la familia pública `/v1/auth/signups` respetando el contrato vigente y los headers operativos requeridos por la gateway.
- **FR-005**: La SPA MUST comunicar si el resultado del alta quedó `active` o `pending_activation`, sin asumir todavía gestión completa de sesión persistente ni autorización de rutas protegidas.
- **FR-006**: El sistema MUST exponer una pantalla dedicada para el estado `pending_activation` con copy entendible, affordances seguras y retorno visible hacia login o signup según corresponda.
- **FR-007**: La pantalla de activación pendiente MUST poder alimentarse del contrato canónico `/v1/auth/status-views/{statusViewId}` para mantener el mensaje consistente con el backend cuando esté disponible.
- **FR-008**: La SPA MUST mostrar feedback diferenciado para validación fallida, política deshabilitada, conflicto por cuenta existente, throttling e indisponibilidad operativa.
- **FR-009**: La SPA MUST impedir dobles envíos mientras la solicitud de signup está en progreso.
- **FR-010**: Cuando la policy efectiva deshabilite el registro, la pantalla MUST ocultar affordances engañosas de alta y mantener un camino visible hacia login.
- **FR-011**: La entrega MUST mantenerse aditiva respecto a T01/T02 y no introducir shell persistente, refresh automático, recuperación completa de contraseña ni guardas de rutas autenticadas.

### Key Entities *(include if feature involves data)*

- **ConsoleSignupRequest**: Payload de entrada con `username`, `displayName`, `primaryEmail` y `password` para solicitar un alta de consola.
- **ConsoleSignupRegistration**: Envelope de salida del signup con `registrationId`, `state`, `activationMode`, `statusView`, `message` y metadatos opcionales de aprovisionamiento.
- **ConsoleSignupPolicy**: Resolución efectiva de la policy de auto-registro que indica si el flujo está permitido y si requiere aprobación.
- **ConsoleAccountStatusView**: Vista canónica para estados especiales como `pending_activation`, incluyendo copy y acciones siguientes seguras.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Un usuario puede abrir `/signup`, completar el formulario mínimo con datos válidos y obtener una respuesta satisfactoria de `/v1/auth/signups` sin errores de UI no controlados.
- **SC-002**: Cuando el backend devuelve `pending_activation`, la SPA presenta una pantalla dedicada con mensaje claro y al menos una acción siguiente visible.
- **SC-003**: Cuando la policy de signup está deshabilitada o no puede resolverse, la pantalla comunica el estado sin exponer un CTA engañoso de alta y mantiene visible la navegación hacia login.
- **SC-004**: La entrega mantiene verde la validación local del paquete `@in-falcone/web-console` y la validación global exigida por el monorepo.
