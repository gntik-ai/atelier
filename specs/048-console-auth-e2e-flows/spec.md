# Especificación de Feature: Pruebas E2E de login, logout, signup y navegación básica de la consola

**Feature Branch**: `048-console-auth-e2e-flows`
**Creada**: 2026-03-28
**Estado**: Specified
**Task ID**: US-UI-01-T06
**Epic**: EP-14 — Consola de administración: shell, acceso y contexto
**Historia padre**: US-UI-01 — Shell de consola: stack React/Tailwind/shadcn, login y navegación base
**Tipo**: Feature
**Prioridad**: P0
**Tamaño relativo**: L
**Dependencias de historia**: US-IAM-03, US-GW-01
**Dependencias dentro de la historia**: US-UI-01-T01, US-UI-01-T02, US-UI-01-T03, US-UI-01-T04, US-UI-01-T05
**RF trazados desde la historia**: RF-UI-001, RF-UI-002, RF-UI-003, RF-UI-004, RF-UI-005, RF-UI-006, RF-UI-007, RF-UI-008, RF-UI-009, RF-UI-010
**Input**: Prompt de especificación importado para US-UI-01-T06

---

## Objetivo y problema que resuelve

Las tareas T01–T05 ya entregan la SPA de consola, el login basado en Keycloak, el signup, el shell persistente y la capa de protección/refresh de sesión. Sin embargo, todavía falta una validación automatizada que ejercite el producto desde la perspectiva real del navegador y confirme que los flujos base de acceso funcionan de punta a punta para el primer release.

Sin esta tarea, el equipo solo dispone de pruebas unitarias e integración ligera sobre piezas aisladas. Eso deja sin cobertura automatizada los recorridos que más riesgo concentran en una consola administrativa inicial:

1. entrar a una ruta protegida sin sesión y completar login hasta volver al destino solicitado;
2. cerrar sesión desde el shell y comprobar que el acceso vuelve a quedar protegido;
3. iniciar un registro y aterrizar en el estado pendiente de activación cuando el auto-registro está habilitado con aprobación;
4. navegar por la estructura base del shell autenticado.

**US-UI-01-T06 resuelve exactamente esto**: incorporar una suite E2E estable y repetible que valide login, logout, signup y navegación básica como journeys de usuario reales en navegador, reduciendo regresiones del acceso de consola antes de ampliar la superficie funcional.

---

## Usuarios y consumidores afectados

| Actor | Relación con esta tarea | Valor que recibe |
|---|---|---|
| **Superadmin de plataforma** | Usuario final de la consola | Mayor confianza en que el acceso inicial a la consola funciona de forma consistente en navegador. |
| **Tenant owner / workspace admin** | Usuario final de la consola | Menor probabilidad de encontrar regresiones en login, logout o navegación base al usar la consola. |
| **Equipo frontend** | Consumidor interno | Evidencia automatizada de que los flujos críticos del shell y autenticación siguen operativos tras cambios futuros. |
| **Equipo de plataforma / CI** | Consumidor interno | Un gate reproducible para validar journeys base sin depender de pruebas manuales repetitivas. |

---

## User Scenarios & Testing

### User Story 1 — Acceso protegido con retorno al destino solicitado (Prioridad: P1)

Como operador que abre una ruta protegida sin haber iniciado sesión, quiero ser redirigido al login y, tras autenticarme correctamente, volver al destino que intentaba visitar, para no perder mi contexto de navegación.

**Por qué esta prioridad**: Es el journey más crítico del acceso real a la consola. Valida en una sola prueba la protección de rutas, el login y la restauración de intención entregada en T05.

**Prueba independiente**: Abrir una ruta protegida profunda sin sesión, verificar redirección a login, completar autenticación válida y confirmar retorno a la ruta original.

**Escenarios de aceptación**:

1. **Dado** que el usuario navega directamente a una ruta protegida profunda sin sesión activa, **cuando** la consola se inicializa, **entonces** es redirigido a `/login` sin renderizar contenido protegido.
2. **Dado** que el usuario fue redirigido desde una ruta protegida, **cuando** completa el login correctamente, **entonces** la consola restaura el destino protegido original.
3. **Dado** que el usuario ya está autenticado y dentro del shell, **cuando** navega por la barra lateral a otra sección base, **entonces** la ruta cambia y el contenido placeholder correspondiente se muestra sin perder la sesión.

---

### User Story 2 — Logout seguro desde el shell (Prioridad: P1)

Como usuario autenticado, quiero cerrar sesión desde el menú del shell y quedar fuera del área protegida, para asegurar que el acceso administrativo no permanezca abierto en el navegador.

**Por qué esta prioridad**: Es el complemento natural del login. Si el logout no funciona bien, la consola queda insegura o en un estado de sesión inconsistente.

**Prueba independiente**: Iniciar sesión, abrir el menú del avatar, ejecutar logout y verificar redirección a login y pérdida de acceso protegido.

**Escenarios de aceptación**:

1. **Dado** que el usuario está autenticado en una ruta de consola, **cuando** ejecuta logout desde el menú del avatar, **entonces** la consola limpia la sesión local y lo redirige a `/login`.
2. **Dado** que el usuario ha cerrado sesión, **cuando** intenta volver a una ruta protegida desde la URL, **entonces** la consola vuelve a exigir autenticación.
3. **Dado** que la invalidación remota de sesión responde correctamente, **cuando** se ejecuta el logout, **entonces** la consola completa el flujo sin errores visibles para el usuario.

---

### User Story 3 — Signup con aterrizaje en pending activation (Prioridad: P2)

Como usuario sin cuenta operativa, quiero completar el alta desde la consola y ver el estado pendiente de activación cuando la policy lo requiera, para entender claramente cuál es el siguiente paso antes de acceder al producto.

**Por qué esta prioridad**: El signup es parte del resultado esperado de la historia, pero depende de que el login y el shell ya sean funcionales. Tiene menor criticidad que el acceso protegido y el logout.

**Prueba independiente**: Abrir `/signup`, completar un registro válido bajo una policy que exige aprobación y verificar redirección a la vista de activación pendiente.

**Escenarios de aceptación**:

1. **Dado** que la policy de auto-registro permite signup con aprobación posterior, **cuando** el usuario abre `/signup`, **entonces** ve el formulario y el resumen de la policy.
2. **Dado** que el usuario completa un registro válido con estado `pending_activation`, **cuando** el backend acepta la solicitud, **entonces** la consola navega a la pantalla de activación pendiente.
3. **Dado** que la consola navega a pending activation tras el registro, **cuando** la pantalla se renderiza, **entonces** se muestran el mensaje principal y el resumen de registro recibido.

---

## Edge Cases

- **¿Qué ocurre si el usuario intenta abrir una ruta protegida con query string o hash?** La intención recordada debe preservar la ruta completa para restaurarla tras el login.
- **¿Qué ocurre si el logout remoto responde lentamente?** La consola puede mantener un estado temporal de cierre en curso, pero debe finalizar el logout local y devolver al login.
- **¿Qué ocurre si la policy de signup no está disponible?** Esta tarea no amplía el manejo funcional; la suite E2E debe centrarse en el caso soportado y estable donde la policy sí se resuelve.
- **¿Qué ocurre si la ruta protegida restaurada ya no existe?** La tarea no introduce nuevas reglas; la validación E2E se centra en destinos protegidos vigentes de la consola base.

---

## Requirements

### Requisitos funcionales

- **FR-001**: El repositorio DEBE incorporar una suite E2E automatizada para `apps/web-console` que ejecute journeys reales de navegador sobre la SPA.
- **FR-002**: La suite E2E DEBE validar que una ruta protegida profunda redirige a login cuando no existe sesión activa.
- **FR-003**: La suite E2E DEBE validar que, tras un login correcto, la consola restaura el destino protegido originalmente solicitado.
- **FR-004**: La suite E2E DEBE validar al menos una navegación autenticada básica a través del shell (por ejemplo, desde una sección a otra de la barra lateral).
- **FR-005**: La suite E2E DEBE validar el flujo de logout desde el menú del avatar del shell, incluyendo la redirección a login y la pérdida de acceso protegido.
- **FR-006**: La suite E2E DEBE validar el flujo de signup exitoso cuando el resultado esperado es `pending_activation`.
- **FR-007**: La suite E2E DEBE poder ejecutarse en CI o localmente sin depender de una instancia externa real de Keycloak, usando un entorno controlado y reproducible para las respuestas HTTP necesarias del family auth.
- **FR-008**: La suite E2E DEBE mantener el alcance acotado a login, logout, signup y navegación básica; no debe absorber permisos finos, roles UI ni journeys de negocio posteriores.
- **FR-009**: La suite E2E DEBE usar aserciones estables sobre comportamiento visible al usuario (rutas, headings, acciones y mensajes clave), evitando depender de detalles frágiles no esenciales.
- **FR-010**: La entrega DEBE incluir la forma de ejecutar la suite E2E dentro del paquete `@in-falcone/web-console`.

### Entidades clave

- **Journey E2E de login**: Secuencia observable en navegador que arranca en una ruta protegida, pasa por `/login`, crea sesión y devuelve al usuario al destino solicitado.
- **Journey E2E de logout**: Secuencia observable en navegador que parte de una sesión activa, ejecuta cierre desde el shell y comprueba que el acceso protegido vuelve a requerir autenticación.
- **Journey E2E de signup**: Secuencia observable en navegador que parte de `/signup`, crea un registro y aterriza en el estado `pending_activation`.
- **Backend auth controlado para pruebas**: Conjunto acotado de respuestas HTTP simuladas para `/v1/auth/*` que hace reproducible la suite sin depender de servicios IAM externos.

---

## Seguridad, multi-tenancy, auditoría y trazabilidad

### Seguridad

- La suite E2E debe verificar flujos de autenticación sin exponer secretos reales ni depender de credenciales productivas.
- Las respuestas HTTP usadas en la suite deben ser datos de prueba controlados y no tokens operativos reales.
- El logout validado por la suite debe confirmar que el acceso protegido deja de estar disponible tras el cierre.

### Multi-tenancy

Esta tarea no redefine el aislamiento multi-tenant. La cobertura E2E valida los journeys base de acceso a la consola, no la autorización fina entre tenants o workspaces.

### Auditoría

No se introduce una nueva superficie de auditoría. La tarea valida journeys visibles de UI; la generación de eventos de auditoría sigue siendo responsabilidad del backend y de tareas posteriores.

### Trazabilidad

- Los escenarios automatizados deben mapearse claramente a login, logout, signup y navegación básica.
- La evidencia esperada debe quedar en la suite E2E y en el comando reproducible del paquete.

---

## Fuera de alcance explícito

| Elemento | Motivo de exclusión |
|---|---|
| Integración contra un Keycloak real desplegado | Haría la suite menos determinista y no es necesaria para validar los journeys base del frontend en esta tarea. |
| Autorización por roles/scopes en el shell | Pertenece a incrementos posteriores del dominio UI/IAM. |
| Cobertura E2E de módulos de negocio (functions, storage, observability, etc.) | Esta tarea solo cubre acceso y navegación base. |
| Sincronización multi-tab, expiración avanzada y errores complejos de red | T05 ya cubre la base funcional; T06 se centra en los journeys primarios felices y sus verificaciones esenciales. |
| Rediseño visual del shell, login o signup | La tarea añade validación automatizada, no reabre la UX entregada. |

---

## Success Criteria

### Resultados medibles

- **SC-001**: La suite E2E puede ejecutarse con un único comando dentro de `@in-falcone/web-console` y finaliza en verde en entorno local/CI controlado.
- **SC-002**: Un escenario automatizado demuestra que una navegación directa a una ruta protegida profunda redirige a login y vuelve al destino solicitado tras autenticar.
- **SC-003**: Un escenario automatizado demuestra que el logout desde el shell devuelve al login y restaura la protección de rutas.
- **SC-004**: Un escenario automatizado demuestra que el signup con activación pendiente termina en la pantalla de `pending_activation`.
- **SC-005**: La suite cubre al menos una navegación autenticada básica por la barra lateral del shell después del login.
- **SC-006**: La ejecución de la suite no requiere credenciales reales ni servicios IAM externos activos.

---

## Supuestos

- T01–T05 ya dejaron operativas las rutas `/login`, `/signup`, `/signup/pending-activation` y `/console/*`.
- La consola sigue consumiendo el family auth público mediante requests HTTP estándar que pueden ser simuladas de forma controlada en navegador.
- Las respuestas simuladas de login, signup y logout pueden representar fielmente el comportamiento contractual esperado para esta iteración.

## Riesgos

- **Riesgo**: Incorporar una herramienta E2E pesada o frágil que complique la CI. **Mitigación**: mantener una suite pequeña, enfocada y con un entorno de prueba autocontenido.
- **Riesgo**: Que las aserciones dependan de copy demasiado volátil. **Mitigación**: priorizar rutas, headings y elementos de interacción estables.
- **Riesgo**: Que la suite dependa de servicios externos inestables. **Mitigación**: usar respuestas controladas para el family auth y limitar el alcance a los journeys base.

## Preguntas abiertas

_No hay preguntas bloqueantes para avanzar. La elección concreta de la herramienta/browser runner y del mecanismo de simulación HTTP queda para la fase de planificación técnica._
