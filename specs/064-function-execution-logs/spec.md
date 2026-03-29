# Spec — Function Execution Logs and Results in Console

**Feature slug**: `064-function-execution-logs`
**Task ID**: US-UI-04-T04
**Epic**: EP-15 — Consola de administración: dominios funcionales
**Historia padre**: US-UI-04 — Métricas, auditoría, API keys, cuotas, wizards, warnings y snippets
**RF cubiertos**: RF-UI-025, RF-UI-026
**Dependencias**: US-OBS-03, US-UI-03, US-UI-04-T01, US-UI-04-T02, US-UI-04-T03
**Fecha**: 2026-03-29
**Estado**: Draft

---

## 1. Objetivo y problema que resuelve

Las funciones serverless (OpenWhisk) son el mecanismo principal de extensión y lógica custom del BaaS multi-tenant. Cada invocación produce una **activación** que contiene metadata operativa, logs de salida estándar y un resultado de ejecución. Sin una interfaz de consola que exponga esta información, los desarrolladores y administradores no pueden:

- Diagnosticar errores de funciones sin acceso directo a infraestructura.
- Verificar que una función produce los resultados esperados tras un despliegue.
- Entender el rendimiento y el estado de las invocaciones recientes.
- Determinar si los logs fueron truncados por política de retención.

Esta tarea especifica la capacidad de **visualizar, explorar y navegar los logs y resultados de ejecución de funciones serverless** directamente desde la consola administrativa, completando la experiencia operativa del runtime de funciones.

## 2. Usuarios afectados y valor recibido

| Actor | Valor |
|---|---|
| **Developer** | Diagnostica errores, verifica output y revisa logs de funciones sin acceso a infraestructura ni herramientas externas. Acelera el ciclo de desarrollo y depuración. |
| **Workspace Admin** | Supervisa el estado operativo de las funciones del workspace, identifica funciones con fallos recurrentes y evalúa el rendimiento. |
| **Tenant Owner** | Obtiene visibilidad agregada sobre la salud de las funciones de sus workspaces; puede detectar problemas sistémicos. |
| **Superadmin** | Accede a logs y resultados de cualquier tenant para soporte operativo y diagnóstico cross-tenant. |

## 3. Escenarios principales, edge cases y reglas de negocio

### 3.1 Listado de activaciones recientes

El usuario navega al detalle de una función y accede a la sección de activaciones (ejecuciones). La consola presenta un **listado paginado de activaciones recientes** para esa función.

Cada entrada del listado muestra:

- **Activation ID** — identificador único de la ejecución.
- **Estado** — succeeded, failed, timed_out, cancelled u otro estado reportado por el runtime.
- **Duración** — tiempo de ejecución en milisegundos.
- **Tipo de trigger** — HTTP, cron, Kafka, storage u otro tipo que originó la invocación.
- **Fecha/hora de inicio** — timestamp de cuándo comenzó la ejecución.

El listado se carga bajo demanda (lazy) al acceder a la sección de activaciones y soporta paginación basada en cursor.

### 3.2 Detalle de una activación

Al seleccionar una activación del listado, se muestra un panel de detalle con tres secciones:

#### 3.2.1 Metadata de la activación

- Activation ID, resource ID, status, started at, finished at, duration (ms), status code, trigger kind, memory utilizada, invocation ID y política de activación.

#### 3.2.2 Logs de salida

- Líneas de log de la ejecución, presentadas en un bloque de texto con scroll vertical.
- Si los logs están truncados (por política de retención o por tamaño), se muestra un indicador explícito: "Los logs están truncados. Se muestra el contenido disponible."
- Si no hay logs disponibles (ejecución sin output), se muestra un mensaje: "No hay logs disponibles para esta activación."
- Si la consulta de logs falla (red, permisos, error de backend), se muestra un mensaje de error independiente que no bloquea la visualización de metadata ni resultado.

#### 3.2.3 Resultado de la ejecución

- El resultado de la función se presenta formateado como JSON (pretty-printed, indentado).
- Si el resultado no está disponible o la consulta falla, se muestra un mensaje de error independiente sin afectar a las otras secciones.
- El content type del resultado se respeta para la presentación: si es JSON, se formatea; si es texto, se muestra como texto plano.

### 3.3 Carga resiliente e independiente de secciones

Las tres secciones del detalle (metadata, logs, resultado) se obtienen de forma **paralela e independiente** del backend. Cada sección gestiona su propio estado de carga y error:

- Si la metadata falla pero los logs se obtienen, se muestran los logs con un error para la metadata.
- Si los logs fallan pero el resultado se obtiene, se muestra el resultado con un error para los logs.
- Esta resiliencia evita que un fallo parcial deje al usuario sin ninguna información útil.

### 3.4 Reglas de negocio y gobierno

1. **Retención de activaciones**: la disponibilidad de logs y resultados está sujeta a la política de retención de activaciones configurada por workspace. La consola muestra la política vigente cuando está disponible en la respuesta del backend (`activationPolicy`).
2. **Logs y resultados son read-only**: la consola solo consulta y presenta la información; no permite editar, eliminar ni manipular logs o resultados.
3. **No hay streaming en tiempo real**: los logs se obtienen como snapshot una vez que la activación ha terminado. El live-tailing de ejecuciones en curso queda fuera de alcance.
4. **Paginación del listado**: la lista de activaciones usa paginación basada en cursor (`page[size]` + `after`). La consola solicita un tamaño de página razonable (e.g., 50 elementos) y ofrece navegación a la siguiente página si hay más resultados.
5. **Orden descendente por fecha**: las activaciones se presentan de más reciente a más antigua.

### 3.5 Edge cases

| Caso | Comportamiento esperado |
|---|---|
| Función sin ninguna activación registrada | El listado muestra "Esta función no tiene activaciones registradas." |
| Activación con logs vacíos (ejecución sin stdout/stderr) | La sección de logs muestra "No hay logs disponibles para esta activación." |
| Activación con resultado `null` o vacío | La sección de resultado muestra el valor `null` formateado o "Sin resultado disponible." |
| Logs truncados por política de retención | Se muestra el indicador de truncamiento junto al contenido parcial disponible. |
| Consulta de logs devuelve error 403 (permisos insuficientes) | Se muestra "No tienes permisos para ver los logs de esta activación." sin bloquear las otras secciones. |
| Consulta de detalle devuelve 404 (activación purgada) | Se muestra "Esta activación ya no está disponible." y se permite volver al listado. |
| Sesión expirada al consultar detalle | Se detecta 401; se redirige al login. |
| Resultado de ejecución no es JSON (e.g., texto plano, binario) | Se muestra como texto plano. Si es binario o no representable, se indica "El resultado no se puede mostrar en texto." |
| El backend devuelve más de 50 activaciones (paginación) | Se muestra la primera página con indicación de que hay más resultados; la navegación a la siguiente página está disponible. |
| Activación en curso (started pero no finished) | Se muestra con status "running" o equivalente; los logs y resultado pueden no estar disponibles aún. Se muestra "La activación sigue en curso." |

## 4. Requisitos funcionales verificables

| ID | Requisito | Verificación |
|---|---|---|
| RF-FEL-01 | La consola muestra un listado paginado de activaciones recientes para una función seleccionada, con activation ID, estado, duración, trigger kind y fecha de inicio. | Seleccionar una función con activaciones; verificar que el listado muestra los campos requeridos. |
| RF-FEL-02 | Al seleccionar una activación, se muestra un panel de detalle con metadata operativa, logs de salida y resultado de ejecución en secciones independientes. | Seleccionar una activación; verificar presencia de las tres secciones. |
| RF-FEL-03 | Los logs de la activación se muestran en un bloque de texto con scroll vertical; si están truncados, se indica explícitamente. | Consultar una activación con logs truncados; verificar indicador. |
| RF-FEL-04 | El resultado de la ejecución se presenta formateado como JSON (pretty-printed) cuando el contenido es JSON. | Consultar una activación con resultado JSON; verificar indentación. |
| RF-FEL-05 | Si la consulta de logs falla, se muestra un error en la sección de logs sin bloquear metadata ni resultado. | Simular error en la API de logs; verificar que metadata y resultado siguen visibles. |
| RF-FEL-06 | Si la consulta de resultado falla, se muestra un error en la sección de resultado sin bloquear metadata ni logs. | Simular error en la API de resultado; verificar que metadata y logs siguen visibles. |
| RF-FEL-07 | Si la función no tiene activaciones, el listado muestra un mensaje vacío explícito. | Consultar una función sin activaciones; verificar mensaje. |
| RF-FEL-08 | El listado soporta paginación con navegación a la siguiente página cuando hay más resultados que el tamaño de página. | Consultar una función con más de 50 activaciones; verificar indicación de siguiente página. |
| RF-FEL-09 | Los estados de las activaciones se representan con indicadores visuales diferenciados (colores/badges) que permiten distinguir éxito, fallo, timeout y otros estados. | Verificar que activaciones con distintos estados tienen indicadores visuales distintos. |
| RF-FEL-10 | La sección de logs muestra "No hay logs disponibles" cuando la activación no tiene salida estándar. | Consultar una activación sin logs; verificar mensaje. |

### Límites de alcance

- **Incluido**: listado de activaciones, detalle de activación (metadata + logs + resultado), paginación por cursor, estados de carga/error independientes, indicador de logs truncados, formato JSON del resultado.
- **Excluido**: live-tailing / streaming en tiempo real de funciones en ejecución.
- **Excluido**: filtrado avanzado de activaciones (por estado, fecha, trigger) — puede añadirse como mejora incremental.
- **Excluido**: exportación de logs a archivo o servicio externo.
- **Excluido**: eliminación o manipulación de activaciones/logs.
- **Excluido**: vistas de métricas agregadas y cuotas (→ US-UI-04-T01).
- **Excluido**: wizards de creación (→ US-UI-04-T02).
- **Excluido**: confirmaciones destructivas (→ US-UI-04-T03).
- **Excluido**: snippets de conexión (→ US-UI-04-T05).
- **Excluido**: tests de regresión de UX (→ US-UI-04-T06).

## 5. Permisos, multi-tenancy, auditoría, cuotas y seguridad

### Permisos

- La sección de activaciones solo se muestra si el usuario tiene permisos de lectura sobre la función seleccionada dentro del workspace activo.
- Los logs y resultados requieren permisos de lectura de activaciones; si el backend deniega acceso, la consola muestra un mensaje de permisos insuficientes en la sección correspondiente sin bloquear las demás.
- El superadmin puede consultar activaciones de cualquier función en cualquier tenant.

### Multi-tenancy

- El contexto de tenant/workspace se hereda del selector de contexto de la consola (US-UI-03).
- Las activaciones solo se consultan dentro del scope del workspace activo. No es posible consultar activaciones de funciones de otro tenant o workspace desde la consola.
- Las API calls incluyen el contexto de workspace en la ruta del endpoint.

### Auditoría

- La consulta de logs y resultados de activaciones es una operación de lectura. No se generan eventos de auditoría por la mera visualización de logs.
- Si la política de auditoría del tenant requiere registrar accesos de lectura a datos operativos, el backend es responsable de ese registro; la consola no introduce eventos de auditoría propios.

### Cuotas

- La retención de activaciones y logs está sujeta a la política de cuota/retención del workspace. La consola refleja lo que el backend devuelve.
- La consola no gestiona ni modifica cuotas de retención; solo las muestra si la respuesta del backend incluye la política.

### Seguridad

- Los logs y resultados pueden contener datos sensibles generados por las funciones. La consola los muestra tal como los devuelve el backend, sin filtrado adicional.
- Toda comunicación es vía HTTPS.
- No se almacenan logs ni resultados en el almacenamiento client-side del navegador (no localStorage, no sessionStorage, no IndexedDB).
- Los datos se descartan de memoria al navegar fuera de la vista de detalle de la activación.

## 6. Criterios de aceptación

1. La consola presenta un listado paginado de activaciones para la función seleccionada, con los campos definidos (activation ID, estado, duración, trigger, fecha).
2. Al seleccionar una activación, se muestran metadata, logs y resultado en secciones separadas e independientes.
3. Las tres secciones del detalle cargan de forma paralela; un fallo en una no bloquea las otras.
4. Los logs se muestran en un bloque scrollable; si están truncados, el indicador es visible.
5. El resultado JSON se muestra formateado (pretty-printed); si no es JSON, se muestra como texto plano.
6. Los estados de activación tienen indicadores visuales diferenciados (badges con colores apropiados).
7. Los mensajes vacíos y de error son claros y específicos (sin logs, sin activaciones, error de permisos, activación no disponible).
8. La funcionalidad solo es accesible para usuarios con permisos de lectura sobre la función en el workspace activo.
9. El aislamiento multi-tenant es correcto: solo se muestran activaciones del workspace activo.
10. No se persisten logs ni resultados en almacenamiento client-side.

## 7. Riesgos, supuestos y preguntas abiertas

### Supuestos

- Los endpoints de activaciones, logs y resultado por activación ya existen en la API del servicio de funciones y son accesibles vía el gateway de la consola.
- La API de activaciones soporta paginación basada en cursor con parámetros `page[size]` y `after`.
- La API de logs devuelve un campo `truncated` cuando los logs han sido recortados por política de retención.
- El selector de contexto tenant/workspace (US-UI-03) está disponible y funcional.
- Las vistas de detalle de funciones (spec `058-console-functions-views`) proporcionan el punto de entrada para la navegación a activaciones.

### Riesgos

| Riesgo | Mitigación |
|---|---|
| La API de activaciones no soporta paginación por cursor. | Implementar con paginación offset como fallback; documentar la limitación y migrar cuando la API soporte cursor. |
| Los logs de funciones con mucho output causan problemas de rendimiento en el navegador. | El backend ya trunca los logs por política. La consola aplica scroll virtual o limita la altura del contenedor con overflow. No renderizar más de lo que devuelve el endpoint. |
| El resultado de ejecución es un blob binario que no puede representarse como texto. | Mostrar mensaje "El resultado no se puede mostrar en texto." con metadata de content type disponible. |

### Preguntas abiertas

- Ninguna bloqueante identificada para avanzar a planificación.
