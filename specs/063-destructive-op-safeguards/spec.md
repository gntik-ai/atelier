# Spec — Destructive Operation Safeguards

**Feature slug**: `063-destructive-op-safeguards`
**Task ID**: US-UI-04-T03
**Epic**: EP-15 — Consola de administración: dominios funcionales
**Historia padre**: US-UI-04 — Métricas, auditoría, API keys, cuotas, wizards, warnings y snippets
**RF cubiertos**: RF-UI-025, RF-UI-026
**Dependencias**: US-OBS-03, US-UI-03, US-UI-04-T01 (metrics/quota views), US-UI-04-T02 (wizards)
**Fecha**: 2026-03-29
**Estado**: Draft

---

## 1. Objetivo y problema que resuelve

La consola BaaS multi-tenant permite a los administradores y desarrolladores ejecutar operaciones irreversibles — eliminación de tenants, workspaces, bases de datos, funciones, clientes IAM y revocación de API keys — desde múltiples puntos de la interfaz. Sin salvaguardas explícitas, un click accidental o una confusión de contexto puede destruir recursos en producción de forma irrecuperable.

Esta tarea introduce un sistema coherente de **warnings, confirmaciones reforzadas y resúmenes de impacto** para todas las operaciones destructivas de la consola:

- Advierte al usuario antes de iniciar la operación, con un resumen claro de qué se va a destruir y qué depende de ello.
- Exige una confirmación reforzada (escritura del nombre del recurso) para operaciones de alto impacto.
- Muestra el impacto en cascada: recursos dependientes que se verán afectados.
- Unifica el patrón visual y de interacción para que el usuario reconozca siempre una operación destructiva, independientemente de la sección de la consola.

## 2. Usuarios afectados y valor recibido

| Actor | Valor |
|---|---|
| **Tenant Owner** | Recibe protección frente a la eliminación accidental de su tenant y todos sus workspaces. Ve claramente el impacto antes de confirmar. |
| **Workspace Admin** | Tiene salvaguardas al eliminar workspaces, bases de datos, clientes IAM o revocar invitaciones. Entiende las consecuencias en cascada. |
| **Developer** | Está protegido contra la eliminación accidental de funciones desplegadas, bases de datos o API keys activas. |
| **Superadmin** | Mismas protecciones con capacidad de ejecutar operaciones destructivas sobre cualquier tenant; la confirmación reforzada es especialmente crítica. |

## 3. Escenarios principales, edge cases y reglas de negocio

### 3.1 Operaciones destructivas cubiertas

Se clasifican todas las operaciones destructivas de la consola en dos niveles de severidad:

#### Nivel CRITICAL — confirmación reforzada (type-to-confirm)

| Operación | Recurso afectado | Impacto en cascada |
|---|---|---|
| Eliminar tenant | Tenant | Todos los workspaces, bases de datos, funciones, clientes IAM, invitaciones y API keys del tenant. |
| Eliminar workspace | Workspace | Todas las bases de datos, funciones, clientes IAM, invitaciones y API keys del workspace. |
| Eliminar base de datos | Base de datos (PG o Mongo) | Todos los datos almacenados en la base de datos. |
| Revocar todas las API keys de un workspace | Conjunto de API keys | Todas las integraciones externas que usen esas keys dejarán de funcionar. |

#### Nivel WARNING — confirmación estándar (dialog con botón explícito)

| Operación | Recurso afectado |
|---|---|
| Eliminar función serverless | Función individual y su trigger/ruta asociada. |
| Eliminar cliente IAM | Cliente individual; las sesiones activas se invalidan. |
| Revocar invitación de usuario | Invitación pendiente o acceso de usuario invitado al workspace. |
| Revocar API key individual | API key individual; las integraciones que la usen fallarán. |
| Eliminar service account | Service account y sus credenciales asociadas. |

### 3.2 Flujo de confirmación — Nivel CRITICAL

1. El usuario hace click en la acción destructiva (e.g., botón "Eliminar tenant").
2. Se abre un diálogo modal que muestra:
   - **Icono y color de advertencia** (rojo/destructivo) coherente con el design system.
   - **Nombre del recurso** que se va a eliminar.
   - **Resumen de impacto en cascada**: lista de tipos y cantidades de recursos dependientes que se eliminarán (e.g., "3 workspaces, 7 bases de datos, 12 funciones").
   - **Mensaje explícito**: "Esta operación es irreversible."
   - **Campo de confirmación**: input de texto donde el usuario debe escribir el nombre exacto del recurso para habilitar el botón de confirmación.
3. El botón de confirmación está deshabilitado hasta que el texto introducido coincida exactamente con el nombre del recurso.
4. Al confirmar, se ejecuta la llamada al backend. El diálogo muestra un estado de carga.
5. Tras éxito, se muestra confirmación de eliminación y se redirige al listado padre.
6. Tras error, se muestra el mensaje de error del backend; el diálogo permanece abierto para reintentar o cerrar.

### 3.3 Flujo de confirmación — Nivel WARNING

1. El usuario hace click en la acción destructiva.
2. Se abre un diálogo modal que muestra:
   - **Icono y color de advertencia** (amarillo/advertencia).
   - **Nombre del recurso** que se va a eliminar/revocar.
   - **Descripción breve del impacto** (una frase, sin cascada detallada).
   - **Mensaje explícito**: "Esta operación no se puede deshacer."
   - **Dos botones**: "Cancelar" (primario/por defecto) y "Eliminar" / "Revocar" (destructivo, estilo danger).
3. No se requiere escribir el nombre; basta con hacer click en el botón destructivo.
4. Tras confirmar, mismo flujo de carga/éxito/error que el nivel CRITICAL.

### 3.4 Reglas de negocio transversales

1. **Clasificación determinista**: cada operación destructiva de la consola tiene asignado un nivel (CRITICAL o WARNING) que no depende del estado del recurso sino del tipo de operación y recurso.
2. **Resumen de impacto dinámico**: para el nivel CRITICAL, el diálogo consulta al backend para obtener el conteo de recursos dependientes antes de mostrar el resumen. Si la consulta falla, se muestra un aviso genérico de impacto potencial sin bloquear la confirmación.
3. **Coherencia visual**: todos los diálogos destructivos usan los mismos componentes UI base, colores y patrones de interacción, independientemente de la sección de la consola.
4. **Sin doble confirmación**: no se encadenan múltiples diálogos. Un único diálogo por operación es suficiente.
5. **Sin undo**: las operaciones destructivas no tienen mecanismo de deshacer. El diálogo es la única barrera.
6. **Botón de cancelación siempre presente y con foco por defecto**: el foco inicial del diálogo está en "Cancelar", no en "Confirmar".
7. **Escape cierra el diálogo**: la tecla Escape y el click fuera del modal equivalen a "Cancelar".

### 3.5 Edge cases

| Caso | Comportamiento esperado |
|---|---|
| Recurso eliminado por otro usuario mientras el diálogo está abierto | Al confirmar, el backend devuelve 404; el diálogo muestra "El recurso ya no existe" y se cierra. |
| Sesión expirada durante diálogo de confirmación | Al confirmar, se detecta 401; se redirige al login. |
| Nombre del recurso contiene caracteres especiales o espacios | La comparación type-to-confirm es exacta (case-sensitive, whitespace-sensitive). |
| Recurso sin dependencias en cascada (nivel CRITICAL) | El resumen de impacto muestra "No se detectaron recursos dependientes adicionales." La confirmación type-to-confirm sigue siendo requerida. |
| Cuota de recursos recuperada tras eliminación | Fuera de alcance de esta tarea; la cuota se actualiza server-side. Las vistas de cuotas (T01) reflejarán el cambio al recargar. |
| Operación destructiva lanzada desde wizard (T02) | No aplica: los wizards solo crean recursos, no los eliminan. Las eliminaciones ocurren desde las vistas de detalle/listado. |
| Múltiples diálogos simultáneos | No se permite; solo un diálogo destructivo puede estar abierto a la vez. Si hay uno abierto, la acción sobre otro recurso no abre un segundo diálogo. |

## 4. Requisitos funcionales verificables

| ID | Requisito | Verificación |
|---|---|---|
| RF-DS-01 | Todas las operaciones clasificadas como CRITICAL muestran un diálogo modal con campo type-to-confirm antes de ejecutar. | Intentar eliminar tenant, workspace, base de datos y revocar todas las API keys; verificar que se muestra el diálogo con input de confirmación. |
| RF-DS-02 | El botón de confirmación del diálogo CRITICAL está deshabilitado hasta que el texto introducido coincida exactamente con el nombre del recurso. | Escribir texto parcial y verificar estado del botón; completar el nombre exacto y verificar habilitación. |
| RF-DS-03 | Todas las operaciones clasificadas como WARNING muestran un diálogo modal con botón destructivo explícito y botón de cancelación por defecto. | Intentar eliminar función, cliente IAM, invitación, API key individual y service account; verificar diálogo. |
| RF-DS-04 | El diálogo CRITICAL muestra un resumen de impacto en cascada con tipos y cantidades de recursos dependientes. | Eliminar un tenant con workspaces y recursos; verificar que el resumen lista los dependientes con conteo. |
| RF-DS-05 | Si la consulta de impacto en cascada falla, el diálogo muestra un aviso genérico sin bloquear la confirmación. | Simular fallo de la API de impacto; verificar que el diálogo se muestra con aviso genérico. |
| RF-DS-06 | Tras confirmación exitosa, se muestra feedback de éxito y se redirige al listado padre. | Completar eliminación; verificar mensaje de éxito y redirección. |
| RF-DS-07 | Tras error de backend en confirmación, se muestra el mensaje de error sin cerrar el diálogo. | Simular error 4xx/5xx en eliminación; verificar que el diálogo permanece abierto con el error. |
| RF-DS-08 | El foco inicial del diálogo está en el botón "Cancelar" (no en "Confirmar" ni en el campo de texto). | Abrir cualquier diálogo destructivo; verificar foco. |
| RF-DS-09 | La tecla Escape y el click fuera del modal cierran el diálogo sin ejecutar la operación. | Verificar en ambos niveles. |
| RF-DS-10 | Solo un diálogo destructivo puede estar abierto simultáneamente. | Intentar abrir dos diálogos; verificar que el segundo no se abre. |

### Límites de alcance

- **Incluido**: diálogos de confirmación (CRITICAL y WARNING) para todas las operaciones destructivas de la consola, resumen de impacto en cascada, patrón visual unificado.
- **Excluido**: mecanismo de undo/soft-delete (las operaciones son irreversibles a nivel de backend).
- **Excluido**: confirmaciones para operaciones no destructivas (edición, actualización, cambio de configuración).
- **Excluido**: wizards de creación (→ US-UI-04-T02).
- **Excluido**: vistas de métricas y cuotas (→ US-UI-04-T01).
- **Excluido**: snippets de conexión (→ US-UI-04-T05).
- **Excluido**: logs de funciones (→ US-UI-04-T04).
- **Excluido**: tests de regresión de UX (→ US-UI-04-T06).

## 5. Permisos, multi-tenancy, auditoría, cuotas y seguridad

### Permisos

- Los diálogos destructivos solo se muestran si el usuario tiene el permiso correspondiente a la operación subyacente (e.g., `tenant:delete`, `workspace:delete`, `database:delete`).
- Si el usuario no tiene el permiso, el botón/acción destructiva no se renderiza o se muestra deshabilitado, y el diálogo no se abre.

### Multi-tenancy

- El contexto de tenant/workspace se hereda del selector de contexto de la consola (US-UI-03).
- La consulta de impacto en cascada solo devuelve recursos dentro del tenant/workspace activo.
- No es posible eliminar recursos de un tenant distinto al activo.

### Auditoría

- La ejecución de la operación destructiva (la llamada al backend) genera un evento de auditoría con: actor, recurso eliminado, tipo de operación, timestamp y resumen de impacto (si disponible).
- La apertura o cancelación del diálogo no genera eventos de auditoría.

### Cuotas

- La eliminación de recursos puede liberar cuota. La actualización de cuotas es responsabilidad del backend; esta tarea no gestiona cuotas directamente.

### Seguridad

- La confirmación type-to-confirm es una salvaguarda de UX, no un mecanismo de seguridad. La autorización real se verifica server-side.
- Los diálogos no exponen datos sensibles más allá del nombre del recurso y los conteos de dependencias.
- Toda comunicación con el backend es vía HTTPS.

## 6. Criterios de aceptación

1. Todas las operaciones destructivas de la consola están clasificadas en nivel CRITICAL o WARNING y muestran el diálogo correspondiente antes de ejecutar.
2. Las operaciones CRITICAL requieren que el usuario escriba el nombre exacto del recurso para habilitar la confirmación.
3. Las operaciones CRITICAL muestran un resumen dinámico de impacto en cascada (tipos y cantidades de recursos dependientes).
4. Las operaciones WARNING muestran un diálogo con descripción del impacto y botones Cancelar (foco por defecto) / Eliminar-Revocar (estilo danger).
5. Los diálogos son visualmente coherentes entre sí: mismos componentes, colores y patrones de interacción en todas las secciones.
6. Tras confirmación exitosa se muestra feedback y redirección; tras error se muestra el mensaje sin cerrar el diálogo ni perder estado.
7. Los diálogos solo aparecen para usuarios con los permisos requeridos para la operación.
8. El aislamiento multi-tenant es correcto: la cascada solo muestra recursos del contexto activo.
9. La operación destructiva genera evento de auditoría con los campos requeridos.

## 7. Riesgos, supuestos y preguntas abiertas

### Supuestos

- Los endpoints de eliminación/revocación ya existen o serán provistos por sus respectivos servicios antes de la integración.
- Existe o existirá un endpoint para consultar el impacto en cascada (conteo de dependencias) de un recurso antes de eliminarlo. Si no existe, el resumen se degrada al aviso genérico.
- El selector de contexto tenant/workspace (US-UI-03) está disponible y funcional.
- Las vistas de detalle y listado donde se encuentran los botones de eliminación ya están implementadas (US-UI-04-T01) o se implementan en paralelo.

### Riesgos

| Riesgo | Mitigación |
|---|---|
| El endpoint de impacto en cascada no está disponible al implementar. | El diálogo se degrada a aviso genérico (RF-DS-05). Diseñar contra contrato de API con mocks. |
| Inconsistencia visual entre secciones si los diálogos se implementan de forma dispersa. | Definir un componente compartido `DestructiveConfirmationDialog` con variantes CRITICAL y WARNING que se reutilice en todas las secciones. |
| El nombre del recurso es muy largo o contiene caracteres confusos para type-to-confirm. | Mostrar el nombre completo en el diálogo y en el placeholder del input. No truncar. |

### Preguntas abiertas

- Ninguna bloqueante identificada para avanzar a planificación.
