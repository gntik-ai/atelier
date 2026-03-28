# Especificación de Feature: Mostrar estado de tenant y workspace en shell y páginas relevantes

**Feature Branch**: `050-console-context-status`
**Creada**: 2026-03-28
**Estado**: Specified
**Task ID**: US-UI-02-T02
**Epic**: EP-14 — Consola de administración: shell, acceso y contexto
**Historia padre**: US-UI-02 — Contexto de tenant/workspace, members y gestión Auth/IAM en consola
**Tipo**: Feature
**Prioridad**: P0
**Tamaño relativo**: L
**Dependencias de historia**: US-UI-01, US-IAM-02, US-TEN-03
**Dependencias dentro de la historia**: US-UI-02-T01
**RF trazados desde la historia**: RF-UI-011, RF-UI-012, RF-UI-013, RF-UI-014, RF-UI-015, RF-UI-023, RF-UI-024
**Input**: Prompt de especificación importado para US-UI-02-T02

---

## Objetivo y problema que resuelve

US-UI-02-T01 entrega el selector de tenant y workspace con persistencia de contexto. A partir de ese momento, el usuario sabe *qué* tenant y workspace tiene seleccionados, pero no sabe *en qué estado están*. ¿Está el tenant activo o suspendido? ¿Se completó el aprovisionamiento del workspace o quedó a medias? ¿Las cuotas del tenant están en un nivel de uso saludable o próximas al límite? ¿Cuántos workspaces, aplicaciones y recursos gestionados tiene el tenant?

Sin esta información visible, el usuario opera a ciegas: puede intentar crear funciones en un workspace que está en aprovisionamiento parcial, o no enterarse de que su tenant fue suspendido hasta que una operación falle con un error críptico de la API. La falta de visibilidad del estado multiplica las interacciones de soporte y dificulta la autogestión.

**US-UI-02-T02 resuelve exactamente esto**: mostrar el estado operativo del tenant y workspace activos de forma prominente dentro del shell y en las páginas donde el contexto es relevante, proporcionando al usuario una lectura inmediata de la salud, el ciclo de vida y el uso de cuotas del ámbito en el que está trabajando, sin necesidad de navegar a pantallas de administración dedicadas.

---

## Usuarios y consumidores afectados

| Actor | Relación con esta tarea | Valor que recibe |
|---|---|---|
| **Superadmin de plataforma** | Consumidor final de la consola | Ve de un vistazo el estado de gobernanza, aprovisionamiento y cuotas de cualquier tenant que inspeccione, lo que le permite detectar problemas y priorizar intervenciones sin acceder a herramientas internas. |
| **Tenant owner** | Consumidor final de la consola | Conoce en todo momento el estado de ciclo de vida de su tenant, el progreso de aprovisionamiento y si sus cuotas están en zona saludable, de alerta o bloqueada. Puede actuar proactivamente antes de que las operaciones fallen. |
| **Workspace admin** | Consumidor final de la consola | Ve el estado de su workspace (activo, provisionando, suspendido) y su entorno (dev, staging, prod), lo que le permite evaluar rápidamente si el workspace está listo para operar o requiere atención. |
| **Miembro de tenant** | Consumidor final de la consola | Recibe señales claras cuando el contexto en el que trabaja tiene restricciones (tenant suspendido, workspace en aprovisionamiento, cuotas agotadas), evitando confusión por errores inesperados. |
| **Equipo de desarrollo (consumidor interno)** | Construye pantallas dentro del shell | Dispone de datos de estado de tenant y workspace pre-cargados y accesibles globalmente, evitando que cada página tenga que consultar el estado por su cuenta. |

---

## User Scenarios & Testing

### User Story 1 — Indicador de estado del tenant activo en el shell (Prioridad: P1)

Como usuario autenticado que ha seleccionado un tenant, quiero ver un indicador del estado de ese tenant (ciclo de vida, gobernanza) integrado en el shell de la consola, para saber de un vistazo si el tenant está operativo, presenta alertas o está restringido.

**Por qué esta prioridad**: Sin un indicador de estado del tenant visible en el shell, el usuario no tiene forma de anticipar problemas. Todas las operaciones de la consola dependen de que el tenant esté en un estado operativo; mostrar ese estado es la señal más básica y de mayor impacto.

**Prueba independiente**: Seleccionar un tenant activo y verificar que el shell muestra un indicador visual de estado saludable. Luego, seleccionar un tenant con estado `suspended` y verificar que el indicador cambia para reflejar la restricción.

**Escenarios de aceptación**:

1. **Dado** que el usuario tiene un tenant seleccionado cuyo estado de ciclo de vida es `active` y cuyo estado de gobernanza es `nominal`, **cuando** se renderiza el shell, **entonces** se muestra un indicador visual de estado saludable asociado al tenant (ej. badge verde, icono de check, o texto de estado).
2. **Dado** que el usuario tiene un tenant seleccionado cuyo estado de ciclo de vida es `active` pero cuyo estado de gobernanza es `warning`, **cuando** se renderiza el shell, **entonces** el indicador de estado del tenant refleja la condición de alerta con una señal visual diferenciada (ej. badge amarillo/ámbar) y, al interactuar con él, muestra un resumen del motivo de alerta.
3. **Dado** que el usuario tiene un tenant seleccionado cuyo estado de ciclo de vida es `suspended`, **cuando** se renderiza el shell, **entonces** el indicador muestra claramente que el tenant está suspendido con señal visual de restricción (ej. badge rojo, icono de advertencia) y se muestra un mensaje que indica que las operaciones pueden estar limitadas.
4. **Dado** que el usuario tiene un tenant seleccionado cuyo estado de ciclo de vida es `pending_activation`, **cuando** se renderiza el shell, **entonces** el indicador muestra que el tenant está pendiente de activación y que aún no está operativo.
5. **Dado** que el usuario cambia de tenant mediante el selector de contexto (US-UI-02-T01), **cuando** se actualiza el contexto, **entonces** el indicador de estado se actualiza para reflejar el estado del nuevo tenant seleccionado.

---

### User Story 2 — Indicador de estado del workspace activo en el shell (Prioridad: P1)

Como usuario autenticado que ha seleccionado un tenant y un workspace, quiero ver el estado del workspace activo (ciclo de vida, entorno, aprovisionamiento) en el shell de la consola, para saber si el workspace está listo para operar y en qué entorno me encuentro.

**Por qué esta prioridad**: El workspace es el ámbito directo de las operaciones del usuario. Mostrar su estado y entorno es tan fundamental como el estado del tenant; sin ello, el usuario puede ejecutar operaciones sobre un workspace que no ha terminado de aprovisionarse o confundir el entorno de trabajo.

**Prueba independiente**: Seleccionar un workspace activo en entorno `prod` y verificar que el shell muestra su estado y la etiqueta de entorno. Luego, seleccionar un workspace en estado `provisioning` y verificar que el indicador refleja que no está completamente operativo.

**Escenarios de aceptación**:

1. **Dado** que el usuario tiene un workspace seleccionado cuyo estado es `active`, **cuando** se renderiza el shell, **entonces** se muestra un indicador que confirma que el workspace está activo, junto con una etiqueta visible de su entorno (`dev`, `sandbox`, `staging` o `prod`).
2. **Dado** que el workspace seleccionado está en estado `provisioning`, **cuando** se renderiza el shell, **entonces** el indicador muestra que el workspace está en proceso de aprovisionamiento y que puede no estar completamente operativo.
3. **Dado** que el workspace seleccionado tiene un aprovisionamiento con estado `partially_failed`, **cuando** se renderiza el shell, **entonces** el indicador muestra una señal visual de problema en el aprovisionamiento, indicando que algunos recursos pueden no estar disponibles.
4. **Dado** que el workspace seleccionado está en estado `suspended`, **cuando** se renderiza el shell, **entonces** el indicador muestra claramente que el workspace está suspendido.
5. **Dado** que el usuario cambia de workspace mediante el selector de contexto, **cuando** se actualiza el contexto, **entonces** el indicador de estado del workspace se actualiza para reflejar el nuevo workspace.
6. **Dado** que no hay workspace seleccionado (solo tenant), **cuando** se renderiza el shell, **entonces** no se muestra indicador de estado de workspace, o se muestra un estado vacío coherente que indica que debe seleccionarse un workspace.

---

### User Story 3 — Resumen de cuotas del tenant activo (Prioridad: P2)

Como tenant owner o superadmin, quiero ver un resumen del uso de cuotas del tenant activo, para conocer rápidamente si alguna cuota está próxima al límite o bloqueada sin tener que navegar a una pantalla de administración de cuotas dedicada.

**Por qué esta prioridad**: Las cuotas determinan si las operaciones del usuario van a funcionar o serán rechazadas. Aunque el indicador de ciclo de vida (P1) es más urgente, el resumen de cuotas es la segunda señal más valiosa para la autogestión. Es P2 porque no bloquea la orientación básica del usuario en el shell, pero tiene alto valor práctico.

**Prueba independiente**: Seleccionar un tenant con cuotas configuradas y verificar que la consola muestra un resumen con las alertas de cuota. Verificar que un tenant sin alertas muestra un estado saludable.

**Escenarios de aceptación**:

1. **Dado** que el tenant activo tiene alertas de cuota con severidad `nominal` para todas las métricas, **cuando** se muestra el resumen de cuotas, **entonces** se indica un estado general saludable sin destacar alertas individuales.
2. **Dado** que el tenant activo tiene al menos una alerta de cuota con severidad `warning`, **cuando** se muestra el resumen de cuotas, **entonces** se destaca el número de cuotas en alerta y se permite ver el detalle (métrica, uso, límite, porcentaje de utilización).
3. **Dado** que el tenant activo tiene al menos una alerta de cuota con severidad `blocked`, **cuando** se muestra el resumen de cuotas, **entonces** se muestra una señal visual crítica que indica que al menos una cuota está agotada, identificando la métrica afectada.
4. **Dado** que el usuario expande o interactúa con el resumen de cuotas, **cuando** se despliega el detalle, **entonces** se muestra una lista de las alertas de cuota con: nombre de métrica, ámbito (tenant/workspace), uso actual, límite, porcentaje de utilización y severidad.
5. **Dado** que el tenant activo cambia (el usuario selecciona otro tenant), **cuando** se actualiza el contexto, **entonces** el resumen de cuotas se recarga con los datos del nuevo tenant.

---

### User Story 4 — Resumen de inventario del tenant activo (Prioridad: P3)

Como tenant owner o superadmin, quiero ver un resumen compacto del inventario del tenant activo (número de workspaces, aplicaciones, recursos gestionados), para tener una orientación rápida del tamaño y la composición del tenant sin navegar a pantallas de detalle.

**Por qué esta prioridad**: El inventario da contexto operativo y orienta al usuario sobre la escala del tenant. Es útil, pero no es crítico para la operación diaria ni para detectar problemas inmediatos. Por eso es P3.

**Prueba independiente**: Seleccionar un tenant y verificar que se muestra un resumen con los conteos de workspaces, aplicaciones y recursos gestionados.

**Escenarios de aceptación**:

1. **Dado** que el tenant activo tiene datos de inventario disponibles, **cuando** se muestra el resumen, **entonces** se visualizan al menos: número de workspaces, número de aplicaciones y número de recursos gestionados.
2. **Dado** que el usuario expande el resumen de inventario, **cuando** se despliega el detalle, **entonces** se muestra un desglose por workspace con su slug, entorno, estado y conteos de recursos.
3. **Dado** que el tenant activo cambia, **cuando** se actualiza el contexto, **entonces** el resumen de inventario se recarga con los datos del nuevo tenant.

---

### User Story 5 — Banners de estado degradado en páginas de operación (Prioridad: P2)

Como usuario que navega a una sección operativa de la consola (funciones, storage, eventos, etc.), quiero ver un banner informativo si el tenant o el workspace activo están en un estado no operativo (suspendido, en aprovisionamiento parcial, cuota bloqueada), para entender por qué las operaciones podrían fallar antes de intentarlas.

**Por qué esta prioridad**: Los indicadores del shell (P1) son compactos y siempre visibles, pero en las páginas de operación donde el usuario va a ejecutar acciones, un banner contextual más prominente reduce la frustración de intentar operaciones que fallarán.

**Prueba independiente**: Navegar a una página de operación con un tenant suspendido y verificar que se muestra un banner de advertencia. Navegar a la misma página con un tenant activo y verificar que no se muestra el banner.

**Escenarios de aceptación**:

1. **Dado** que el tenant activo está en estado `suspended`, **cuando** el usuario navega a cualquier sección operativa de la consola, **entonces** se muestra un banner prominente indicando que el tenant está suspendido y que las operaciones pueden estar limitadas o bloqueadas.
2. **Dado** que el workspace activo tiene aprovisionamiento `partially_failed`, **cuando** el usuario navega a una sección operativa, **entonces** se muestra un banner indicando que el workspace tiene aprovisionamiento incompleto y que algunos recursos pueden no estar disponibles.
3. **Dado** que el tenant activo tiene al menos una cuota con severidad `blocked`, **cuando** el usuario navega a una sección operativa, **entonces** se muestra un banner indicando que al menos una cuota está agotada, con la métrica afectada.
4. **Dado** que el tenant y workspace activos están en estado operativo normal (tenant `active` + gobernanza `nominal`, workspace `active`, aprovisionamiento `completed`, sin cuotas `blocked`), **cuando** el usuario navega a una sección operativa, **entonces** no se muestra ningún banner de estado degradado.
5. **Dado** que el usuario resuelve la condición degradada (ej. el tenant es reactivado) y recarga o navega de nuevo, **cuando** se re-evalúa el estado, **entonces** el banner desaparece.

---

### Edge Cases

- **Datos de estado no disponibles (API lenta o fallida)**: Si la llamada para obtener los datos de estado del tenant o workspace falla o tarda, los indicadores de estado deben mostrar un estado de carga y, si persiste el error, un estado de error con opción de reintentar. Nunca se debe mostrar un estado saludable falso por defecto.
- **Tenant en estado `deleted`**: Un tenant marcado como `deleted` no debería ser seleccionable en el selector (T01), pero si por un edge case de caché o timing aparece seleccionado, el indicador debe mostrarlo como eliminado y bloquear la operación.
- **Workspace en estado `soft_deleted` o `deleted`**: Mismo tratamiento que el caso anterior a nivel de workspace.
- **Cambio de estado durante la sesión**: Si el estado del tenant o workspace cambia mientras el usuario tiene la consola abierta (ej. un admin suspende el tenant), el estado mostrado quedará desactualizado hasta la próxima recarga de datos. Para esta tarea, es aceptable que los datos se refresquen al cambiar de contexto, al navegar entre secciones y al recargar la página. No se requiere actualización en tiempo real vía WebSocket en este alcance.
- **Permisos insuficientes para ver detalles de gobernanza o cuotas**: Si la API devuelve datos parciales porque el usuario no tiene permisos para ver gobernanza o cuotas (ej. un miembro sin rol de admin), los indicadores deben mostrar solo la información disponible (ej. estado de ciclo de vida) y omitir las secciones para las que no hay datos, sin errores visibles.
- **Tenant sin cuotas configuradas**: Si el tenant no tiene alertas de cuota (array vacío), el resumen de cuotas muestra un estado saludable genérico indicando que no hay alertas.
- **Múltiples banners simultáneos**: Si el tenant está suspendido y además tiene cuotas bloqueadas, se pueden mostrar múltiples banners apilados o un único banner consolidado que mencione todas las condiciones. La decisión de presentación se tomará en la fase de planificación técnica, pero la especificación exige que todas las condiciones relevantes sean comunicadas.

---

## Requirements

### Requisitos funcionales

- **FR-001**: El sistema DEBE mostrar un indicador del estado de ciclo de vida del tenant activo (`pending_activation`, `active`, `suspended`, `deleted`) integrado en el shell de la consola, visible en todas las páginas protegidas cuando hay un tenant seleccionado.
- **FR-002**: El indicador de estado del tenant DEBE diferenciar visualmente al menos tres niveles: operativo normal (tenant activo + gobernanza nominal), alerta (gobernanza `warning`) y restricción (tenant suspendido, gobernanza `suspended`, `retention` o `purge_pending`).
- **FR-003**: El sistema DEBE mostrar un indicador del estado del workspace activo (`draft`, `provisioning`, `pending_activation`, `active`, `suspended`, `soft_deleted`, `deleted`) integrado en el shell, visible cuando hay un workspace seleccionado.
- **FR-004**: El indicador de estado del workspace DEBE incluir una etiqueta del entorno (`dev`, `sandbox`, `staging`, `prod`) visible de forma permanente junto al nombre del workspace.
- **FR-005**: Si el workspace activo tiene un aprovisionamiento con estado `partially_failed` o `in_progress`, el indicador DEBE reflejar esa condición aunque el estado de ciclo de vida del workspace sea `active`.
- **FR-006**: Los indicadores de estado del tenant y workspace DEBEN actualizarse al cambiar de contexto (selección de otro tenant o workspace en el selector), al navegar entre secciones de la consola y al recargar la página.
- **FR-007**: El sistema DEBE ofrecer un resumen de cuotas del tenant activo que muestre el número de alertas por severidad (`nominal`, `warning`, `blocked`) y permita expandir el detalle de cada alerta (métrica, ámbito, uso, límite, porcentaje de utilización, severidad).
- **FR-008**: El resumen de cuotas DEBE estar accesible desde el shell o desde una sección visible en las páginas principales, sin requerir navegación a una pantalla de administración dedicada.
- **FR-009**: El sistema DEBE ofrecer un resumen de inventario del tenant activo que muestre al menos: número de workspaces, número de aplicaciones y número de recursos gestionados, con posibilidad de expandir el desglose por workspace.
- **FR-010**: El sistema DEBE mostrar banners informativos en las secciones operativas de la consola cuando el contexto activo presenta una condición degradada: tenant no activo, workspace no activo, aprovisionamiento parcialmente fallido o cuota bloqueada.
- **FR-011**: Los banners de estado degradado NO DEBEN mostrarse cuando el tenant y workspace activos están en estado operativo normal.
- **FR-012**: Si la obtención de datos de estado del tenant o workspace falla, los indicadores DEBEN mostrar un estado de error con opción de reintentar, en lugar de asumir un estado saludable.
- **FR-013**: Si los datos de cuotas o inventario no están disponibles (por permisos del usuario o porque la API no los devuelve), el sistema DEBE omitir la sección afectada sin mostrar un error, mostrando solo la información disponible.
- **FR-014**: Los indicadores de estado y los banners DEBEN ser accesibles por teclado y tener roles ARIA adecuados (ej. `role="status"` o `role="alert"` para los banners).
- **FR-015**: Los datos de estado DEBEN exponerse como estado global reactivo de la aplicación (junto o complementando el contexto de tenant/workspace de T01), para que cualquier componente de la consola pueda consultar el estado del contexto activo sin realizar llamadas propias.

### Entidades clave

- **Estado del tenant activo**: Conjunto de datos que describe la condición operativa del tenant seleccionado. Incluye: estado de ciclo de vida (`TenantLifecycleState`), estado de gobernanza (`TenantGovernanceStatus`), estado de aprovisionamiento (`ProvisioningRunStatus`) y alertas de cuota (array de alertas con métrica, ámbito, uso, límite, porcentaje y severidad). Se obtiene de la API del backend al seleccionar o refrescar el contexto.
- **Estado del workspace activo**: Conjunto de datos que describe la condición del workspace seleccionado. Incluye: estado de ciclo de vida (`EntityState`), entorno (`WorkspaceEnvironment`) y estado de aprovisionamiento (`ProvisioningRunStatus`). Se obtiene de la API del backend.
- **Resumen de cuotas**: Representación de las alertas de cuota del tenant activo. Cada alerta incluye: clave de métrica, ámbito (tenant o workspace), límite, uso, restante, porcentaje de utilización y severidad. Derivado del `TenantGovernanceDashboard` o del `TenantQuotaProfile` que expone la API.
- **Resumen de inventario**: Representación compacta de los recursos del tenant: conteos de workspaces, aplicaciones, service accounts y recursos gestionados, con desglose opcional por workspace. Derivado del `TenantInventoryResponse` de la API.
- **Banner de estado degradado**: Componente informativo contextual que se muestra en páginas operativas cuando el contexto activo tiene condiciones que pueden afectar las operaciones. Se deriva del estado del tenant y del workspace activos.

---

## Permisos, aislamiento multi-tenant, auditoría y seguridad

### Aislamiento

- Los datos de estado mostrados corresponden exclusivamente al tenant y workspace seleccionados. La consola no muestra datos de estado de otros tenants ni de workspaces de otros tenants.
- Los datos provienen de las APIs del backend, que aplican filtrado por permisos. La consola no implementa lógica de autorización propia sobre qué datos de estado mostrar.

### Permisos y visibilidad parcial

- No todos los roles tienen los mismos permisos para ver datos de gobernanza, cuotas o inventario. Un miembro sin rol de admin puede no tener acceso al dashboard de gobernanza o al perfil de cuotas.
- La consola DEBE tratar la ausencia de datos de gobernanza o cuotas como "información no disponible para este usuario" y mostrar solo los datos que la API le devuelve. No debe generar un error visible por datos que el usuario no tiene permiso de ver.
- El estado de ciclo de vida del tenant y del workspace se considera información básica visible para cualquier usuario que tenga acceso al tenant/workspace.

### Seguridad

- Los datos de estado (ciclo de vida, gobernanza, cuotas, inventario) se obtienen mediante las mismas credenciales y mecanismo de autenticación que el resto de operaciones de la consola. No se requieren tokens ni flujos adicionales.
- No se persisten datos de estado en el cliente más allá de la duración de la sesión del navegador (en memoria). Los datos se refrescan desde la API en cada cambio de contexto o recarga.

### Auditoría

- La consulta de estado del tenant y workspace es una operación de lectura del lado del cliente. No genera eventos de auditoría propios en esta tarea. La auditoría de acceso a las APIs de estado ocurre en el backend.

### Cuotas y límites

- No aplica directamente. Esta tarea *muestra* cuotas pero no las consume ni las modifica.

---

## Criterios de éxito

### Resultados medibles

- **SC-001**: Al seleccionar un tenant, el indicador de estado del tenant se muestra en el shell en menos de 2 segundos (asumiendo latencia de API normal).
- **SC-002**: Al seleccionar un workspace, el indicador de estado y etiqueta de entorno del workspace se muestran en el shell en menos de 2 segundos.
- **SC-003**: Un usuario puede identificar visualmente si su tenant está en estado operativo, en alerta o restringido sin necesidad de hacer clic ni expandir ningún componente.
- **SC-004**: Un usuario puede identificar visualmente el entorno del workspace activo (`dev`, `sandbox`, `staging`, `prod`) sin necesidad de hacer clic ni expandir ningún componente.
- **SC-005**: Al navegar a una sección operativa con un tenant suspendido, el banner de advertencia se muestra antes de que el usuario intente cualquier operación.
- **SC-006**: Al cambiar de tenant/workspace, los indicadores de estado se actualizan reflejando los datos del nuevo contexto, sin necesidad de recargar la página.
- **SC-007**: Un tenant owner puede ver un resumen de cuotas del tenant activo (número de alertas y detalle expandible) sin navegar a una pantalla de administración de cuotas dedicada.
- **SC-008**: Los indicadores de estado y los banners son operables y legibles mediante teclado y tecnologías de asistencia.

---

## Supuestos

- La API del backend expone datos suficientes de estado del tenant (ciclo de vida, gobernanza, aprovisionamiento, cuotas, inventario) en los endpoints existentes de lectura de tenant (ej. `GET /tenants/{tenantId}` o el governance dashboard). Estos contratos están definidos en las familias `tenants.openapi.json` y `workspaces.openapi.json` del control plane.
- La API del backend expone datos suficientes de estado del workspace (ciclo de vida, entorno, aprovisionamiento) en los endpoints existentes de lectura de workspace.
- El selector de contexto (US-UI-02-T01) ya entrega el contexto activo (tenant ID, workspace ID) como estado global reactivo, y esta tarea lo extiende con datos de estado adicionales.
- El shell de la consola (US-UI-01-T04) ya proporciona el layout estructural (header, sidebar, área de contenido) donde integrar los indicadores y banners.

## Riesgos

- **APIs de estado no disponibles todavía**: Si los endpoints de governance dashboard, cuotas o inventario no están implementados en el backend, esta tarea podría necesitar datos mock para avanzar en la implementación de UI. Esto no bloquea la especificación pero sí la verificación end-to-end.
- **Datos parciales según el rol del usuario**: Si la API devuelve datos muy distintos según el rol, la UI podría necesitar múltiples variantes de presentación. El riesgo se mitiga con FR-013 (omitir secciones sin datos disponibles en lugar de manejar variantes complejas).

## Fuera de alcance de esta tarea

- Implementar selector de tenant y workspace con persistencia de contexto (US-UI-02-T01; esta tarea lo consume como dependencia).
- Construir vistas de members, invitaciones, roles y permisos (US-UI-02-T03).
- Construir vistas de Auth/IAM (US-UI-02-T04).
- Gestión de aplicaciones externas vinculadas al workspace (US-UI-02-T05).
- Pruebas E2E de cambio de contexto y administración (US-UI-02-T06).
- Actualización en tiempo real del estado vía WebSocket o SSE (mejora futura; esta tarea refresca al cambiar contexto, navegar o recargar).
- Pantallas de administración detallada de cuotas, gobernanza o inventario (esta tarea solo muestra un resumen y banners, no pantallas CRUD).
- Acciones correctivas desde los indicadores o banners (ej. botón para reactivar un tenant suspendido). Los indicadores son informativos; las acciones son alcance de tareas futuras.
