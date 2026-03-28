# Especificación de Feature: Fundación de Consola React

**Feature Branch**: `043-react-console-foundation`
**Creada**: 2026-03-28
**Estado**: Draft
**Task ID**: US-UI-01-T01
**Epic**: EP-14 — Consola de administración: shell, acceso y contexto
**Historia padre**: US-UI-01 — Shell de consola: stack React/Tailwind/shadcn, login y navegación base
**Tipo**: Feature
**Prioridad**: P0
**Tamaño relativo**: L
**Dependencias de historia**: US-IAM-03, US-GW-01
**RF trazados desde la historia**: RF-UI-001 … RF-UI-010
**Input**: Prompt de especificación importado para US-UI-01-T01

---

## Objetivo y problema que resuelve

El producto BaaS multi-tenant necesita una consola web administrativa que permita a operadores de plataforma, propietarios de tenant, administradores de workspace y miembros gestionar todos los recursos del producto desde el navegador.

Actualmente no existe ninguna aplicación frontend. Sin esta base, ninguna tarea posterior de la historia US-UI-01 (login, signup, shell con sidebar, manejo de sesión, pruebas E2E) puede construirse ni entregarse.

**US-UI-01-T01 resuelve exactamente esto**: entregar la aplicación React fundacional con el stack tecnológico decidido (React + Tailwind CSS + shadcn/ui), configurada para renderizar contenido, aplicar estilos, exponer un punto de entrada único y servir como contenedor donde las tareas hermanas (T02–T06) montarán sus capacidades de forma incremental.

El valor funcional mínimo de esta tarea es que un usuario pueda abrir la URL de la consola en un navegador y ver una página de bienvenida correctamente estilizada que confirma que el stack está operativo.

---

## Usuarios y consumidores afectados

| Actor | Relación con esta tarea | Valor que recibe |
|---|---|---|
| **Superadmin de plataforma** | Consumidor final de la consola | Dispone de un punto de entrada web funcional sobre el que se montarán las pantallas de gestión de plataforma. |
| **Tenant owner** | Consumidor final de la consola | Accederá a la consola para gestionar su tenant; esta tarea le garantiza que la base tecnológica existe y funciona. |
| **Workspace admin** | Consumidor final de la consola | Misma base disponible para futuras pantallas de workspace. |
| **Miembro de tenant** | Consumidor final de la consola | Podrá acceder a la consola cuando se integren las pantallas de su ámbito. |
| **Equipo de desarrollo (consumidor interno)** | Construye sobre esta base | Recibe un proyecto React configurado, con sistema de diseño y estilos unificados, listo para añadir rutas, páginas y componentes sin fricciones de setup. |

---

## User Scenarios & Testing

### User Story 1 — Acceso inicial a la consola (Prioridad: P1)

Como cualquier usuario del producto, quiero abrir la URL base de la consola en mi navegador y ver una página de bienvenida correctamente renderizada y estilizada, para confirmar que la consola está disponible y operativa.

**Por qué esta prioridad**: Es el escenario más básico y fundacional. Si la aplicación no carga, nada más funciona. Valida que el stack React + Tailwind + shadcn/ui está correctamente ensamblado y desplegado.

**Prueba independiente**: Abrir la URL raíz de la consola en un navegador moderno; debe mostrar una página de bienvenida con estilos aplicados y sin errores de consola JavaScript.

**Escenarios de aceptación**:

1. **Dado** que la aplicación está desplegada y accesible, **cuando** un usuario navega a la URL raíz de la consola, **entonces** se muestra una página de bienvenida con contenido visible, estilos de Tailwind aplicados y al menos un componente visual de shadcn/ui renderizado correctamente.
2. **Dado** que la aplicación está desplegada, **cuando** un usuario abre la consola del navegador (DevTools), **entonces** no hay errores JavaScript bloqueantes ni warnings de dependencias rotas.
3. **Dado** que el usuario accede desde un navegador moderno de escritorio (Chrome, Firefox, Edge, Safari últimas 2 versiones principales), **cuando** carga la página de bienvenida, **entonces** el layout se presenta correctamente sin elementos rotos ni desbordamientos visibles.

---

### User Story 2 — Página de bienvenida como punto de partida reconocible (Prioridad: P2)

Como operador o miembro del producto, quiero que la página de bienvenida muestre la identidad visual mínima del producto (nombre del producto y un mensaje de contexto), para saber que estoy en la consola correcta.

**Por qué esta prioridad**: Sin identidad visual, la página sería indistinguible de cualquier template genérico. Esto valida que el sistema de diseño está aplicado y que la consola es reconocible como parte del producto.

**Prueba independiente**: Verificar que la página de bienvenida contiene el nombre del producto y un mensaje de contexto legible y estilizado.

**Escenarios de aceptación**:

1. **Dado** que la aplicación está cargada, **cuando** el usuario visualiza la página de bienvenida, **entonces** el nombre del producto es visible en la página.
2. **Dado** que la aplicación está cargada, **cuando** el usuario visualiza la página de bienvenida, **entonces** se muestra un mensaje de contexto que indica al usuario que está en la consola administrativa.
3. **Dado** que la página de bienvenida está renderizada, **cuando** se inspeccionan los estilos, **entonces** los componentes usan clases de Tailwind CSS y al menos un componente de shadcn/ui está presente y estilizado según el theme configurado.

---

### User Story 3 — Contenedor preparado para rutas futuras (Prioridad: P3)

Como desarrollador del equipo, quiero que la aplicación tenga un sistema de enrutamiento del lado del cliente configurado y operativo, para poder añadir nuevas rutas (login, dashboard, etc.) sin reconfiguración del stack base.

**Por qué esta prioridad**: Habilita la entrega incremental. Las tareas T02–T06 dependen de poder montar rutas sin modificar la fundación.

**Prueba independiente**: Navegar a una ruta inexistente y verificar que la aplicación responde con un estado controlado (página no encontrada o redirección a la ruta raíz), en lugar de un error del servidor o una pantalla en blanco.

**Escenarios de aceptación**:

1. **Dado** que la aplicación está cargada, **cuando** el usuario navega a una ruta que no existe (ej. `/ruta-inexistente`), **entonces** la aplicación muestra un estado controlado (mensaje de "página no encontrada" o redirección a la raíz) en lugar de un error 500, pantalla en blanco o recarga completa del servidor.
2. **Dado** que la aplicación está cargada, **cuando** el usuario navega a la ruta raíz y luego a una ruta no encontrada y vuelve atrás, **entonces** la navegación del navegador (botones atrás/adelante) funciona correctamente sin recargas completas de página.

---

### Edge Cases

- **¿Qué ocurre si los assets estáticos (CSS, JS) no se cargan?** La aplicación debe fallar de forma visible y comprensible (no pantalla en blanco silenciosa); el HTML base debe contener al menos un indicador de carga o mensaje de fallback.
- **¿Qué ocurre si el usuario accede desde un navegador no soportado o muy antiguo?** No se exige polyfill ni compatibilidad retroactiva, pero la página no debe causar un crash silencioso; un mensaje legible de incompatibilidad es aceptable.
- **¿Qué ocurre si se accede por HTTP en lugar de HTTPS?** El comportamiento de redirección HTTP→HTTPS es responsabilidad de la capa de gateway/ingress (US-GW-01), no de esta tarea. La aplicación no debe asumir ni forzar el protocolo por sí misma.
- **¿Qué ocurre si se despliega la consola pero el backend no está disponible?** En el alcance de esta tarea, la consola no consume ningún backend. La página de bienvenida debe renderizar correctamente sin dependencia de APIs.
- **¿Qué ocurre con la accesibilidad?** La página de bienvenida debe cumplir un nivel mínimo de accesibilidad: contraste legible, estructura semántica HTML, y navegabilidad por teclado en los elementos interactivos presentes.

---

## Requirements

### Requisitos funcionales

- **FR-001**: La aplicación DEBE renderizar una página de bienvenida completa en la ruta raíz, sin requerir autenticación ni llamadas a APIs externas.
- **FR-002**: La aplicación DEBE utilizar React como framework de UI, Tailwind CSS como sistema de utilidades de estilo, y shadcn/ui como librería de componentes base.
- **FR-003**: La página de bienvenida DEBE mostrar el nombre del producto y un mensaje de contexto que identifique la consola administrativa.
- **FR-004**: La aplicación DEBE incluir al menos un componente visual de shadcn/ui renderizado y estilizado en la página de bienvenida para validar la integración del sistema de diseño.
- **FR-005**: La aplicación DEBE tener un sistema de enrutamiento del lado del cliente operativo que permita definir rutas sin recargas completas de página.
- **FR-006**: La aplicación DEBE manejar rutas inexistentes con un estado controlado (página no encontrada o redirección a la raíz), nunca con pantalla en blanco o error no gestionado.
- **FR-007**: La aplicación DEBE cargar sin errores JavaScript bloqueantes en la consola del navegador en las últimas 2 versiones principales de Chrome, Firefox, Edge y Safari de escritorio.
- **FR-008**: La estructura de la aplicación DEBE ser modular, permitiendo que las tareas hermanas (T02–T06) añadan rutas, layouts y funcionalidades sin modificar la configuración fundacional.
- **FR-009**: La página de bienvenida DEBE cumplir un nivel mínimo de accesibilidad: contraste suficiente para lectura, estructura semántica HTML (`<main>`, `<h1>`, etc.), y elementos interactivos accesibles por teclado.
- **FR-010**: La aplicación DEBE poder servirse como un bundle de assets estáticos (HTML, CSS, JS) desplegable de forma independiente, sin acoplamiento a un servidor de renderizado específico.

### Requisitos no cubiertos por esta tarea (trazabilidad)

Los siguientes RF de la historia US-UI-01 **no** son responsabilidad de T01 y se abordan en tareas hermanas:

- RF-UI-002 a RF-UI-010 relativos a login, signup, sesión, navegación con sidebar, refresh de tokens y rutas protegidas se cubren en T02–T06.

T01 cubre parcialmente **RF-UI-001** (existencia de la consola con el stack decidido) como habilitador fundacional.

### Entidades clave

- **Aplicación de consola**: Artefacto desplegable que representa la SPA (Single Page Application) del producto. Es el contenedor donde se monta toda la UI de administración. No persiste datos propios en esta tarea.
- **Página de bienvenida**: Vista por defecto que se muestra al acceder a la raíz de la consola. Contiene identidad visual mínima del producto. No requiere autenticación.
- **Ruta del cliente**: Concepto de navegación interna de la SPA. En esta tarea solo existe la ruta raíz y el manejo de rutas no encontradas. Las rutas de login, dashboard, etc., se añaden en tareas posteriores.
- **Theme / sistema de diseño**: Configuración visual base (colores, tipografía, espaciado) que shadcn/ui y Tailwind CSS aplican de forma consistente. Debe estar configurado y operativo.

---

## Seguridad, multi-tenancy, auditoría y cuotas

### Multi-tenancy

Esta tarea **no introduce lógica de tenant** en la aplicación. La consola en T01 no tiene contexto de autenticación ni de tenant. La segregación por tenant se implementará cuando se integre el login (T02) y el manejo de sesión (T05).

### Seguridad

- La aplicación no expone endpoints de API propios ni maneja credenciales en esta tarea.
- No debe incluir secretos, tokens ni configuración sensible embebida en el bundle estático.
- Las cabeceras de seguridad HTTP (CSP, X-Frame-Options, etc.) son responsabilidad de la capa de gateway/ingress (US-GW-01), no de la propia SPA.

### Auditoría

No aplica en esta tarea. No hay acciones de usuario auditables hasta que existan login y operaciones sobre recursos.

### Cuotas y límites

No aplica en esta tarea.

### Trazabilidad

- La versión del build de la consola DEBERÍA ser identificable (ej. visible en el HTML, en un meta tag, o en la consola del navegador) para facilitar el diagnóstico en entornos desplegados.

---

## Fuera de alcance explícito

| Elemento | Tarea responsable | Motivo de exclusión |
|---|---|---|
| Página de login con Keycloak | US-UI-01-T02 | Funcionalidad de autenticación, no de fundación. |
| Pantallas de signup y activación | US-UI-01-T03 | Requiere flujo de registro, fuera del shell base. |
| Shell con header, sidebar, avatar, dropdown | US-UI-01-T04 | Layout de navegación persistente, depende de que la base exista. |
| Manejo de sesión, refresh tokens, rutas protegidas | US-UI-01-T05 | Requiere integración con Keycloak y estado de autenticación. |
| Pruebas E2E de login, logout, signup | US-UI-01-T06 | Requiere que los flujos de autenticación estén implementados. |
| Configuración de APISIX para servir la consola | US-GW-01 | Responsabilidad del gateway. |
| Configuración de Keycloak para la consola | US-IAM-03 | Responsabilidad del dominio IAM. |

---

## Success Criteria

### Resultados medibles

- **SC-001**: La URL raíz de la consola desplegada responde con una página de bienvenida completa y estilizada en menos de 3 segundos en una conexión estándar.
- **SC-002**: La página de bienvenida renderiza sin errores JavaScript bloqueantes en Chrome, Firefox, Edge y Safari (últimas 2 versiones principales de escritorio).
- **SC-003**: Al menos un componente de shadcn/ui está presente y visualmente estilizado en la página de bienvenida, confirmando la integración del sistema de diseño.
- **SC-004**: Navegar a una ruta inexistente produce un estado controlado (página no encontrada o redirección), nunca pantalla en blanco ni error no gestionado.
- **SC-005**: La navegación con botones atrás/adelante del navegador funciona sin recargas completas.
- **SC-006**: El bundle producido es un conjunto de assets estáticos (HTML + CSS + JS) desplegable sin servidor de renderizado.
- **SC-007**: Un desarrollador del equipo puede añadir una nueva ruta a la aplicación sin modificar la configuración fundacional del proyecto (verificable por revisión de código de una tarea hermana posterior).
- **SC-008**: La página de bienvenida pasa una inspección básica de accesibilidad: tiene `<h1>`, usa `<main>`, y los elementos interactivos son alcanzables por teclado.

---

## Supuestos

- La infraestructura de despliegue (Kubernetes/OpenShift + ingress) y el gateway (APISIX) estarán disponibles para servir assets estáticos cuando esta tarea se despliegue. Si no lo están, la tarea puede validarse en un entorno de desarrollo local.
- La integración con Keycloak no es requisito de esta tarea; el login se aborda en T02.
- El stack tecnológico (React + Tailwind + shadcn/ui) es una decisión de proyecto ya tomada y no está sujeta a revisión en esta especificación.

## Riesgos

- **Riesgo**: Que la versión de shadcn/ui o sus dependencias introduzcan incompatibilidades con la versión de React elegida. **Mitigación**: Validar compatibilidad de versiones durante la planificación técnica (fase plan).
- **Riesgo**: Que la configuración base del proyecto sea demasiado rígida y dificulte la integración de T02–T06. **Mitigación**: FR-008 exige modularidad y SC-007 lo valida explícitamente.

## Preguntas abiertas

_Ninguna pregunta bloquea el avance de esta especificación. Las decisiones de implementación (bundler, estructura de archivos, versiones exactas) se tomarán en la fase de planificación técnica._
