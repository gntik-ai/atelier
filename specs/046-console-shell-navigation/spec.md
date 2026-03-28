# Especificación de Feature: Shell de consola con header, avatar, dropdown y sidebar

**Feature Branch**: `046-console-shell-navigation`
**Creada**: 2026-03-28
**Estado**: Specified
**Task ID**: US-UI-01-T04
**Epic**: EP-14 — Consola de administración: shell, acceso y contexto
**Historia padre**: US-UI-01 — Shell de consola: stack React/Tailwind/shadcn, login y navegación base
**Tipo**: Feature
**Prioridad**: P0
**Tamaño relativo**: L
**Dependencias de historia**: US-IAM-03, US-GW-01
**Dependencias dentro de la historia**: US-UI-01-T01, US-UI-01-T02, US-UI-01-T03
**RF trazados desde la historia**: RF-UI-001, RF-UI-002, RF-UI-003, RF-UI-004, RF-UI-005, RF-UI-006, RF-UI-007, RF-UI-008, RF-UI-009, RF-UI-010
**Input**: Prompt de especificación importado para US-UI-01-T04

---

## Objetivo y problema que resuelve

En un producto BaaS multi-tenant, la consola administrativa es la superficie principal de interacción para todos los roles de usuario. Las tareas previas (T01–T03) entregan la aplicación React base, la página de login y las pantallas de signup. Sin embargo, una vez autenticado, el usuario llega a un espacio sin estructura de navegación: no hay header que identifique la aplicación y al usuario, ni sidebar que permita recorrer las secciones del producto, ni mecanismo visual para acceder al perfil, ajustes o cerrar sesión.

**US-UI-01-T04 resuelve exactamente esto**: entregar el shell persistente de la consola — el layout estructural que envuelve todo el contenido post-autenticación — compuesto por un header con logo, avatar del usuario y dropdown de acciones (Settings, Profile, Logout), y una sidebar de navegación persistente que lista las secciones principales del producto.

Este shell es el armazón visual y funcional sobre el que se montarán todas las pantallas futuras de gestión de tenants, workspaces, funciones, storage, observabilidad, etc. Sin él, cada pantalla futura tendría que resolver su propia navegación, rompiendo la coherencia de la experiencia.

---

## Usuarios y consumidores afectados

| Actor | Relación con esta tarea | Valor que recibe |
|---|---|---|
| **Superadmin de plataforma** | Consumidor final de la consola | Obtiene una estructura de navegación clara para acceder a las secciones de administración de plataforma, y controles visibles para gestionar su sesión y perfil. |
| **Tenant owner** | Consumidor final de la consola | Navega por las secciones relevantes de su tenant desde la sidebar y accede a su perfil/ajustes desde el header. |
| **Workspace admin** | Consumidor final de la consola | Misma estructura de navegación disponible, con visibilidad de las secciones de workspace a las que tiene acceso. |
| **Miembro de tenant** | Consumidor final de la consola | Dispone de un layout coherente con acceso visible a logout y perfil, aunque su nivel de acceso a secciones sea más reducido. |
| **Equipo de desarrollo (consumidor interno)** | Construye pantallas dentro del shell | Recibe un contenedor de layout predecible donde montar nuevas páginas sin recrear header ni sidebar en cada pantalla. |

---

## User Scenarios & Testing

### User Story 1 — Header con identidad del producto y del usuario (Prioridad: P1)

Como usuario autenticado de la consola, quiero ver un header persistente que muestre el logo/nombre del producto y mi avatar o identificador visual, para saber en todo momento en qué aplicación estoy y con qué cuenta he iniciado sesión.

**Por qué esta prioridad**: Es la pieza más fundamental del shell. Sin un header que confirme la identidad del producto y del usuario, el usuario carece de orientación básica. Toda interacción posterior (dropdown, sidebar) depende de que el header exista.

**Prueba independiente**: Iniciar sesión en la consola y verificar que el header se muestra con el logo del producto y un indicador visual del usuario autenticado.

**Escenarios de aceptación**:

1. **Dado** que un usuario ha iniciado sesión correctamente, **cuando** accede a cualquier página protegida de la consola, **entonces** se muestra un header en la parte superior que contiene el logo o nombre del producto y un avatar o indicador visual del usuario actual.
2. **Dado** que el usuario autenticado tiene nombre y/o foto de perfil disponibles en su sesión (claims del token), **cuando** se renderiza el header, **entonces** el avatar muestra la foto de perfil si está disponible, o las iniciales del nombre del usuario como fallback.
3. **Dado** que el usuario autenticado no tiene foto de perfil ni nombre disponible en los claims, **cuando** se renderiza el header, **entonces** se muestra un avatar genérico reconocible (icono de usuario por defecto) que sigue siendo interactivo.
4. **Dado** que la consola se visualiza en distintos anchos de pantalla de escritorio (1024px a 1920px+), **cuando** se renderiza el header, **entonces** el logo y el avatar permanecen visibles y correctamente alineados sin solapamiento ni desbordamiento.

---

### User Story 2 — Dropdown de usuario con acciones de sesión y perfil (Prioridad: P1)

Como usuario autenticado, quiero hacer clic en mi avatar en el header y ver un menú desplegable con las opciones Settings, Profile y Logout, para acceder rápidamente a la gestión de mi cuenta y cerrar sesión sin buscar estas acciones en otro lugar.

**Por qué esta prioridad**: El dropdown es el punto de acceso único para logout y perfil. Sin él, el usuario no tiene forma visible de cerrar sesión ni de acceder a ajustes de cuenta desde la consola.

**Prueba independiente**: Iniciar sesión, hacer clic en el avatar del header y verificar que aparece un dropdown con las tres opciones listadas y que cada opción responde al clic.

**Escenarios de aceptación**:

1. **Dado** que el usuario autenticado está viendo cualquier página de la consola, **cuando** hace clic en el avatar/indicador del header, **entonces** se despliega un menú contextual (dropdown) que contiene al menos las opciones: "Settings", "Profile" y "Logout".
2. **Dado** que el dropdown está abierto, **cuando** el usuario hace clic en "Logout", **entonces** se cierra la sesión del usuario (se invoca el flujo de logout contra Keycloak) y el usuario es redirigido a la página de login.
3. **Dado** que el dropdown está abierto, **cuando** el usuario hace clic en "Profile", **entonces** se navega a la ruta de perfil de usuario dentro de la consola (la página destino puede estar vacía o con placeholder en esta tarea; lo relevante es que la navegación se produce).
4. **Dado** que el dropdown está abierto, **cuando** el usuario hace clic en "Settings", **entonces** se navega a la ruta de ajustes dentro de la consola (la página destino puede estar vacía o con placeholder en esta tarea).
5. **Dado** que el dropdown está abierto, **cuando** el usuario hace clic fuera del dropdown o presiona la tecla Escape, **entonces** el dropdown se cierra sin ejecutar ninguna acción.
6. **Dado** que el dropdown está abierto, **cuando** el usuario navega las opciones con el teclado (Tab, flechas, Enter), **entonces** puede seleccionar y activar cualquier opción sin necesidad de ratón.

---

### User Story 3 — Sidebar de navegación persistente (Prioridad: P1)

Como usuario autenticado, quiero ver una barra lateral (sidebar) persistente que liste las secciones principales del producto, para poder navegar entre ellas sin perder contexto ni tener que volver a una página de inicio.

**Por qué esta prioridad**: La sidebar es el mecanismo primario de navegación de la consola. Sin ella, el usuario no tiene forma de descubrir ni acceder a las distintas áreas del producto (dashboard, tenants, workspaces, funciones, storage, etc.).

**Prueba independiente**: Iniciar sesión y verificar que la sidebar se muestra con al menos las secciones de navegación principales definidas y que al hacer clic en cada sección se navega a la ruta correspondiente.

**Escenarios de aceptación**:

1. **Dado** que el usuario ha iniciado sesión, **cuando** accede a cualquier página protegida, **entonces** se muestra una sidebar en el lateral izquierdo con una lista de secciones de navegación principales del producto.
2. **Dado** que la sidebar está visible, **cuando** el usuario hace clic en una sección, **entonces** el contenido principal se actualiza para mostrar la vista correspondiente a esa sección (la vista destino puede ser un placeholder en esta tarea) y la sección seleccionada se marca visualmente como activa.
3. **Dado** que la sidebar está visible y el usuario está en una sección determinada, **cuando** navega a otra sección, **entonces** la marca visual de sección activa se actualiza para reflejar la ubicación actual.
4. **Dado** que la sidebar está visible, **cuando** el usuario recarga la página en una sección específica, **entonces** tras la recarga la sidebar sigue visible y la sección activa corresponde a la URL actual.
5. **Dado** que la consola se visualiza en un ancho de escritorio estándar (≥1024px), **cuando** se renderiza la sidebar, **entonces** la sidebar y el área de contenido principal coexisten sin solapamiento, con el contenido principal ocupando el espacio restante.

---

### User Story 4 — Layout shell integrado: header + sidebar + área de contenido (Prioridad: P2)

Como usuario autenticado, quiero que el header, la sidebar y el área de contenido principal funcionen como un layout único y coherente, para que la experiencia de navegación sea predecible y consistente en todas las secciones de la consola.

**Por qué esta prioridad**: Las stories P1 definen los componentes individuales. Esta story valida que su composición como layout unificado es correcta y estable.

**Prueba independiente**: Navegar entre varias secciones de la consola y verificar que el header permanece fijo, la sidebar permanece visible, y solo el área de contenido central cambia.

**Escenarios de aceptación**:

1. **Dado** que el usuario está autenticado y navega entre secciones de la sidebar, **cuando** cambia de sección, **entonces** el header y la sidebar permanecen estáticos y solo el área de contenido principal se actualiza.
2. **Dado** que el contenido de una sección es más largo que la altura visible de la ventana, **cuando** el usuario hace scroll, **entonces** el scroll afecta solo al área de contenido principal; el header y la sidebar permanecen fijos en su posición.
3. **Dado** que el usuario cambia el tamaño de la ventana del navegador dentro del rango de escritorio (≥1024px), **cuando** se redimensiona, **entonces** el layout se adapta sin romper la estructura de header/sidebar/contenido.

---

### Edge Cases

- **¿Qué ocurre si la sesión del usuario expira mientras está navegando la consola?** El comportamiento de expiración de sesión y refresh de tokens es responsabilidad de US-UI-01-T05. Esta tarea no define el comportamiento ante sesión expirada; el shell simplemente renderiza los datos de sesión que recibe.
- **¿Qué ocurre si los claims del token no incluyen nombre, email ni foto del usuario?** El avatar debe mostrar un icono genérico de usuario. El dropdown debe seguir siendo funcional con las tres opciones (Settings, Profile, Logout) independientemente de los datos de perfil disponibles.
- **¿Qué ocurre si el usuario accede directamente a una URL profunda (deep link) de una sección?** El shell debe renderizarse completo (header + sidebar) y la sidebar debe marcar como activa la sección correspondiente a la URL, incluso si el usuario no entró por la ruta raíz.
- **¿Qué ocurre si la lista de secciones de la sidebar está vacía o no se puede determinar?** El shell debe renderizarse con la sidebar visible pero vacía o con un estado informativo, sin romper el layout. Esto cubriría un caso de configuración incorrecta o degradación.
- **¿Qué ocurre si se accede a la consola sin estar autenticado?** Esta tarea no define el comportamiento de rutas protegidas; ese es alcance de T05. El shell asume que se renderiza solo en contexto autenticado.
- **¿Qué ocurre en pantallas menores a 1024px (tablets, móviles)?** Esta tarea define el shell para escritorio (≥1024px). El comportamiento responsivo para pantallas menores (sidebar colapsable, hamburger menu) puede abordarse como mejora posterior. El shell no debe romper el layout en pantallas menores, pero no se exige una experiencia optimizada para móvil en este alcance.

---

## Requirements

### Requisitos funcionales

- **FR-001**: La consola DEBE renderizar un layout shell compuesto por header, sidebar y área de contenido principal en todas las páginas protegidas post-autenticación.
- **FR-002**: El header DEBE mostrar el logo o nombre del producto en una posición fija y visible.
- **FR-003**: El header DEBE mostrar un avatar del usuario autenticado que refleje la foto de perfil (si disponible en los claims de sesión), las iniciales del nombre (si disponible) o un icono genérico de usuario como fallback.
- **FR-004**: Al hacer clic en el avatar del header, DEBE desplegarse un menú contextual (dropdown) que contenga al menos las opciones: "Settings", "Profile" y "Logout".
- **FR-005**: La opción "Logout" del dropdown DEBE invocar el flujo de cierre de sesión contra Keycloak y redirigir al usuario a la página de login.
- **FR-006**: Las opciones "Settings" y "Profile" del dropdown DEBEN navegar a rutas internas de la consola dedicadas a ajustes y perfil respectivamente (el contenido de esas páginas puede ser placeholder).
- **FR-007**: El dropdown DEBE cerrarse al hacer clic fuera de él o al presionar Escape.
- **FR-008**: El dropdown DEBE ser navegable por teclado (Tab, flechas, Enter) para cumplir accesibilidad básica.
- **FR-009**: La sidebar DEBE mostrarse en el lateral izquierdo de la consola con una lista de secciones de navegación principales del producto.
- **FR-010**: Al hacer clic en una sección de la sidebar, la consola DEBE navegar a la ruta correspondiente y marcar visualmente la sección como activa.
- **FR-011**: La sección activa de la sidebar DEBE sincronizarse con la URL actual, incluso en recarga de página o acceso por deep link.
- **FR-012**: El header y la sidebar DEBEN permanecer fijos durante el scroll del contenido principal.
- **FR-013**: El layout shell DEBE funcionar correctamente en anchos de pantalla de escritorio (≥1024px) sin solapamiento ni desbordamiento entre header, sidebar y contenido.
- **FR-014**: La estructura del shell DEBE ser modular, permitiendo que tareas posteriores añadan secciones a la sidebar, modifiquen las opciones del dropdown o extiendan el header sin reescribir el layout base.
- **FR-015**: Los elementos interactivos del shell (avatar, opciones del dropdown, secciones de la sidebar) DEBEN ser accesibles por teclado y tener roles ARIA adecuados.
- **FR-016**: El shell NO DEBE implementar lógica de visibilidad condicional de secciones por rol en esta tarea; todas las secciones definidas se muestran a todo usuario autenticado. La restricción por permisos es alcance de tareas posteriores.

### Entidades clave

- **Shell layout**: Contenedor estructural que compone header + sidebar + área de contenido. Es el wrapper de toda pantalla post-autenticación. No persiste datos propios.
- **Header**: Barra superior fija que contiene el logo del producto y el avatar del usuario con su dropdown.
- **Avatar de usuario**: Elemento visual en el header que representa al usuario autenticado. Consume datos de los claims de sesión (nombre, email, foto). Es el trigger del dropdown.
- **Dropdown de usuario**: Menú contextual que se despliega al interactuar con el avatar. Contiene las opciones Settings, Profile y Logout.
- **Sidebar**: Panel lateral izquierdo persistente que lista las secciones de navegación principales del producto. Cada entrada tiene un label, un icono (opcional) y una ruta de destino.
- **Sección de navegación**: Entrada individual en la sidebar que representa un área funcional del producto (ej. Dashboard, Tenants, Workspaces, Functions, Storage, etc.). La lista exacta de secciones se definirá en la planificación técnica basándose en las capacidades del producto.
- **Área de contenido principal**: Zona central del layout donde se renderiza la vista de la sección seleccionada. Es el target del enrutamiento.

---

## Seguridad, multi-tenancy, auditoría y cuotas

### Multi-tenancy

Esta tarea **no introduce lógica de aislamiento por tenant** en el shell. El shell renderiza la misma estructura para todos los roles. La personalización del shell por tenant (ej. filtrado de secciones de sidebar según contexto de tenant, branding por tenant) es alcance de tareas posteriores.

El shell consume datos de sesión (claims del token) para mostrar el avatar, pero no interpreta ni filtra contenido basándose en tenant_id en esta tarea.

### Seguridad

- El shell no almacena ni gestiona tokens directamente; consume los datos de sesión que el módulo de autenticación (T02/T05) le expone.
- La opción "Logout" debe invocar el flujo de cierre de sesión contra Keycloak, no simplemente limpiar estado local. Esto garantiza la invalidación de la sesión en el proveedor de identidad.
- El dropdown y la sidebar no deben exponer información sensible más allá del nombre/email/avatar del usuario autenticado.
- Los datos de perfil mostrados en el avatar (nombre, foto) provienen exclusivamente de los claims del token de sesión; el shell no realiza llamadas adicionales a APIs para obtener datos de usuario en esta tarea.

### Auditoría

- La acción de "Logout" ejecutada desde el dropdown DEBERÍA generar un evento auditable (la emisión real del evento depende de la infraestructura de auditoría; esta tarea garantiza que el flujo de logout es explícito e invocable).
- La navegación entre secciones de la sidebar no genera eventos de auditoría en esta tarea.

### Cuotas y límites

No aplica en esta tarea. El shell no consume recursos cuotificados.

### Trazabilidad

- El shell DEBERÍA incluir atributos `data-testid` o equivalentes en los elementos clave (avatar, dropdown, secciones de sidebar) para facilitar las pruebas automatizadas de E2E que se implementarán en T06.

---

## Fuera de alcance explícito

| Elemento | Tarea responsable | Motivo de exclusión |
|---|---|---|
| Aplicación React base y configuración fundacional | US-UI-01-T01 | Prerrequisito ya entregado. |
| Página de login con Keycloak | US-UI-01-T02 | Flujo de autenticación, no de navegación. |
| Pantallas de signup y activación pendiente | US-UI-01-T03 | Flujo de registro, fuera del shell. |
| Manejo de sesión, refresh de tokens, rutas protegidas | US-UI-01-T05 | El shell asume contexto autenticado; la gestión de tokens es responsabilidad de T05. |
| Pruebas E2E de login, logout, signup y navegación | US-UI-01-T06 | Validación automatizada, no construcción del shell. |
| Visibilidad condicional de secciones de sidebar por rol o permisos | Tarea futura | Requiere definir política de permisos UI, fuera de esta feature. |
| Sidebar responsiva para móvil/tablet (<1024px) | Mejora futura | Alcance de escritorio en esta entrega. |
| Contenido real de las páginas de Settings y Profile | Tareas futuras | Esta tarea solo entrega la navegación a esas rutas; las páginas destino pueden ser placeholder. |
| Branding o personalización del shell por tenant | Tarea futura | Requiere resolución de multi-tenancy en la capa UI. |
| Notificaciones en el header | Tarea futura | No forma parte del shell base. |
| Breadcrumbs o navegación secundaria | Tarea futura | No es requisito de la navegación principal. |

---

## Success Criteria

### Resultados medibles

- **SC-001**: Tras iniciar sesión, el usuario ve un header con el logo del producto y su avatar en menos de 2 segundos desde la carga de la primera página protegida.
- **SC-002**: Al hacer clic en el avatar, el dropdown se despliega con las opciones Settings, Profile y Logout visibles y funcionales.
- **SC-003**: Al hacer clic en "Logout", la sesión se cierra (se ejecuta el flujo de logout contra Keycloak) y el usuario es redirigido a la página de login.
- **SC-004**: La sidebar muestra las secciones de navegación principales y al hacer clic en cada una, la consola navega a la ruta correspondiente y marca la sección como activa.
- **SC-005**: Al acceder directamente a una URL profunda de una sección, el shell se renderiza completo y la sidebar marca la sección correcta como activa.
- **SC-006**: Al navegar entre secciones, el header y la sidebar permanecen fijos; solo el área de contenido cambia.
- **SC-007**: El dropdown se cierra al hacer clic fuera o al presionar Escape.
- **SC-008**: Todas las opciones del dropdown y las secciones de la sidebar son alcanzables y activables por teclado.
- **SC-009**: El layout shell no presenta solapamientos, desbordamientos ni roturas visuales en anchos de pantalla de escritorio (1024px a 1920px+).
- **SC-010**: Un desarrollador del equipo puede añadir una nueva sección a la sidebar sin modificar la estructura del shell layout (verificable por revisión de código).

---

## Supuestos

- Las tareas T01 (aplicación React base), T02 (login con Keycloak) y T03 (signup) están completadas o en progreso paralelo, de modo que existe una aplicación React funcional con autenticación operativa sobre la que montar el shell.
- Los datos de usuario (nombre, email, foto de perfil) estarán disponibles como claims del token de sesión gestionado por Keycloak. Si algún claim no está presente, el shell aplica los fallbacks definidos (iniciales o icono genérico).
- La lista concreta de secciones de navegación de la sidebar se definirá durante la planificación técnica, basándose en las capacidades del producto conocidas hasta el momento. Esta especificación no fija la lista exacta.
- El flujo de logout contra Keycloak está disponible como capacidad consumible desde el frontend (expuesto por la integración de T02/T05). Esta tarea invoca dicho flujo, no lo implementa.

## Riesgos

- **Riesgo**: Que los claims del token de Keycloak no incluyan los atributos esperados (nombre, foto) por configuración incompleta del realm. **Mitigación**: FR-003 define una cadena de fallback (foto → iniciales → icono genérico) que garantiza que el avatar siempre se renderiza.
- **Riesgo**: Que la estructura del shell dificulte la integración de pantallas complejas en tareas posteriores. **Mitigación**: FR-014 exige modularidad del layout y SC-010 lo valida explícitamente.
- **Riesgo**: Que el flujo de logout no esté disponible cuando se implemente esta tarea si T02/T05 se retrasan. **Mitigación**: El shell puede implementar la invocación del logout como una llamada a una función/hook que T05 proveerá; mientras tanto, un stub permite validar el flujo visual.

## Preguntas abiertas

_Ninguna pregunta bloquea el avance de esta especificación. Las decisiones de implementación (componentes específicos de shadcn/ui para dropdown y sidebar, estructura del routing, lista exacta de secciones) se tomarán en la fase de planificación técnica._
