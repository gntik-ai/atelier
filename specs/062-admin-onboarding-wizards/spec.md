# Spec — Admin Onboarding Wizards

**Feature slug**: `062-admin-onboarding-wizards`
**Task ID**: US-UI-04-T02
**Epic**: EP-15 — Consola de administración: dominios funcionales
**Historia padre**: US-UI-04 — Métricas, auditoría, API keys, cuotas, wizards, warnings y snippets
**RF cubiertos**: RF-UI-027, RF-UI-028, RF-UI-029, RF-UI-030
**Dependencias**: US-OBS-03, US-UI-03, US-UI-04-T01 (sibling)
**Fecha**: 2026-03-29
**Estado**: Draft

---

## 1. Objetivo y problema que resuelve

La consola BaaS multi-tenant expone operaciones de creación de recursos (tenants, workspaces, clientes IAM, invitaciones, bases de datos, funciones) a través de formularios y acciones dispersos en distintas secciones. Sin un flujo guiado, los usuarios deben conocer de antemano la secuencia correcta de pasos, los campos obligatorios, las validaciones de cuotas y las dependencias entre recursos.

Esta tarea introduce **wizards de onboarding paso a paso** que:

- Guían al usuario por cada etapa de la creación de un recurso con feedback inmediato.
- Validan precondiciones (permisos, cuotas disponibles, recursos dependientes) antes de permitir avanzar.
- Reducen la carga cognitiva mostrando solo la información relevante en cada paso.
- Proporcionan un resumen de confirmación antes de ejecutar la acción final.

## 2. Usuarios afectados y valor recibido

| Actor | Valor |
|---|---|
| **Tenant Owner** | Crea su tenant y primeros workspaces sin necesidad de documentación externa; onboarding autoguiado. |
| **Workspace Admin** | Configura clientes IAM, invita usuarios y provisiona bases de datos con feedback de validación paso a paso. |
| **Developer** | Publica funciones serverless con un flujo que valida nombre, runtime, recursos y cuotas antes de desplegar. |
| **Superadmin** | Accede a los mismos wizards con permisos elevados; puede crear tenants en nombre de otros. |

## 3. Escenarios principales, edge cases y reglas de negocio

### 3.1 Wizards requeridos

Se especifican seis wizards, cada uno como flujo multi-paso modal o de página completa:

#### W1 — Creación de tenant
- **Pasos**: nombre del tenant → plan/tier selección → configuración inicial (región, preferencias) → resumen y confirmación.
- **Precondiciones**: el usuario debe tener rol `superadmin` o permiso explícito de creación de tenants.
- **Validaciones por paso**: unicidad de nombre, disponibilidad de cuota global de tenants.

#### W2 — Creación de workspace
- **Pasos**: selección de tenant contexto → nombre del workspace → configuración (límites iniciales, descripción) → resumen y confirmación.
- **Precondiciones**: el tenant debe existir; el usuario debe tener rol `tenant_owner` o `workspace_admin` sobre el tenant.
- **Validaciones por paso**: unicidad de nombre dentro del tenant, cuota de workspaces del tenant no excedida.

#### W3 — Creación de cliente IAM
- **Pasos**: selección de workspace → tipo de cliente (public / confidential / service-account) → identificador y redirect URIs (si aplica) → scopes y permisos → resumen y confirmación.
- **Precondiciones**: workspace debe existir; usuario con permiso de gestión IAM en el workspace.
- **Validaciones por paso**: formato de URIs, scopes válidos según configuración del tenant.

#### W4 — Invitación de usuario
- **Pasos**: selección de workspace → email del invitado → rol asignado → mensaje opcional → resumen y confirmación.
- **Precondiciones**: workspace debe existir; usuario con permiso de invitación.
- **Validaciones por paso**: formato de email, rol válido dentro del workspace, cuota de miembros no excedida.

#### W5 — Onboarding de base de datos
- **Pasos**: selección de workspace → motor (PostgreSQL / MongoDB) → nombre de la base de datos → configuración inicial (extensiones PG / colecciones Mongo opcionales) → resumen y confirmación.
- **Precondiciones**: workspace debe existir; usuario con permiso de provisión de datos; cuota de bases de datos no excedida.
- **Validaciones por paso**: unicidad de nombre, compatibilidad motor-workspace, cuota disponible.

#### W6 — Publicación de función
- **Pasos**: selección de workspace → nombre y descripción → runtime y versión → configuración de recursos (memoria, timeout) → trigger/ruta → resumen y confirmación.
- **Precondiciones**: workspace debe existir; usuario con permiso de gestión de funciones; cuota de funciones no excedida.
- **Validaciones por paso**: unicidad de nombre, runtime soportado, límites de recursos dentro de cuota.

### 3.2 Reglas de negocio transversales

1. **Validación progresiva**: cada paso se valida antes de habilitar el avance al siguiente. Los errores se muestran inline junto al campo afectado.
2. **Persistencia de borrador**: si el usuario cierra el wizard sin completarlo, el progreso parcial **no** se persiste en backend (se descarta). El estado se mantiene solo en memoria del cliente durante la sesión del wizard.
3. **Resumen de confirmación**: el paso final de cada wizard muestra un resumen read-only de todos los valores introducidos, con opción de volver a cualquier paso para editar.
4. **Acción atómica final**: la creación del recurso se ejecuta como una única llamada al backend. No hay creación parcial.
5. **Feedback post-creación**: tras éxito, el wizard muestra confirmación con enlace directo al recurso creado. Tras error, muestra el mensaje de error del backend y permite reintentar sin perder datos.

### 3.3 Edge cases

| Caso | Comportamiento esperado |
|---|---|
| Cuota excedida detectada en paso intermedio | Se muestra aviso bloqueante en el paso; el botón "Siguiente" queda deshabilitado. Se sugiere contactar al admin o ajustar cuotas. |
| Permiso insuficiente detectado al abrir wizard | El wizard no se abre; se muestra un mensaje de permisos insuficientes en el punto de entrada. |
| Recurso dependiente eliminado mientras el wizard está abierto | Al intentar confirmar, el backend rechaza con error descriptivo; el wizard muestra el error y permite cerrar. |
| Nombre duplicado | Validación asíncrona en el paso de nombre; mensaje inline inmediato. |
| Sesión expirada durante wizard | Al intentar avanzar o confirmar, se detecta 401; se redirige al login y el borrador se pierde. |
| Campos opcionales vacíos | Se aceptan; el resumen los muestra como "No configurado" o con valor por defecto explícito. |

## 4. Requisitos funcionales verificables

| ID | Requisito | Verificación |
|---|---|---|
| RF-W-01 | Cada wizard presenta un flujo de al menos 3 pasos con navegación adelante/atrás y un paso final de resumen. | Contar pasos en cada wizard; verificar botones Anterior/Siguiente/Confirmar. |
| RF-W-02 | El botón "Siguiente" se deshabilita mientras haya errores de validación en el paso actual. | Introducir datos inválidos y comprobar estado del botón. |
| RF-W-03 | El paso de resumen muestra todos los valores seleccionados y permite volver a cualquier paso anterior. | Completar wizard, verificar resumen, hacer click en paso previo y verificar navegación. |
| RF-W-04 | Tras confirmación exitosa, se muestra feedback con enlace al recurso creado. | Completar creación y verificar presencia de enlace funcional. |
| RF-W-05 | Tras error de backend en confirmación, se muestra el mensaje de error sin perder los datos del formulario. | Simular error 4xx/5xx y verificar que los datos persisten en el wizard. |
| RF-W-06 | Los wizards solo son accesibles para usuarios con los permisos requeridos para la operación. | Intentar abrir cada wizard sin el permiso necesario; verificar bloqueo. |
| RF-W-07 | Las validaciones de cuota se evalúan antes de permitir avanzar del paso relevante. | Configurar cuota al límite; verificar que el paso bloquea el avance. |
| RF-W-08 | Los seis wizards (tenant, workspace, cliente IAM, invitación, DB, función) están disponibles desde los puntos de entrada correspondientes en la consola. | Navegar a cada sección y verificar acceso al wizard. |

### Límites de alcance

- **Incluido**: los seis wizards descritos, con validación progresiva, resumen, confirmación y feedback.
- **Excluido**: wizards de edición/actualización de recursos existentes (solo creación).
- **Excluido**: persistencia de borradores entre sesiones.
- **Excluido**: operaciones destructivas y confirmaciones reforzadas (→ US-UI-04-T03).
- **Excluido**: snippets de conexión y ejemplos de uso (→ US-UI-04-T05).
- **Excluido**: vistas de métricas, auditoría, API keys y cuotas (→ US-UI-04-T01).

## 5. Permisos, multi-tenancy, auditoría, cuotas y seguridad

### Permisos
- Cada wizard verifica los permisos del usuario contra el tenant/workspace de contexto antes de renderizar.
- Los permisos requeridos son los mismos que los de la operación subyacente (e.g., crear tenant requiere `tenant:create`).

### Multi-tenancy
- El contexto de tenant/workspace se hereda del selector de contexto de la consola (provisto por US-UI-03).
- Los wizards de tenant y workspace operan a nivel de tenant; los demás operan a nivel de workspace.
- No debe ser posible crear recursos fuera del tenant/workspace activo del usuario.

### Auditoría
- La acción final de cada wizard (la llamada de creación) genera un evento de auditoría con actor, recurso, operación y timestamp.
- Los pasos intermedios del wizard no generan eventos de auditoría (son solo UI client-side).

### Cuotas
- Los wizards consultan las cuotas aplicables antes de permitir avanzar en los pasos relevantes.
- La verificación de cuota es doble: client-side para UX rápida, server-side para enforcement real en la llamada final.

### Seguridad
- Todos los datos del wizard se transmiten al backend exclusivamente vía HTTPS.
- No se almacenan datos sensibles (secrets, tokens) en el estado client-side del wizard.
- Las redirect URIs del wizard de cliente IAM se validan contra patrones permitidos.

## 6. Criterios de aceptación

1. Los seis wizards (W1–W6) están accesibles desde la consola y son funcionales end-to-end.
2. Cada wizard contiene al menos 3 pasos con navegación bidireccional y un paso de resumen final.
3. La validación progresiva bloquea el avance cuando hay errores; los errores se muestran inline.
4. Las precondiciones de permisos y cuotas se verifican y bloquean el acceso o el avance cuando no se cumplen.
5. La creación del recurso es atómica; tras éxito se muestra confirmación con enlace al recurso; tras error se muestra el mensaje sin perder datos del formulario.
6. El aislamiento multi-tenant es correcto: no se puede crear un recurso fuera del contexto del tenant/workspace activo.
7. La acción de creación genera evento de auditoría con los campos requeridos.

## 7. Riesgos, supuestos y preguntas abiertas

### Supuestos
- Los endpoints de backend para las seis operaciones de creación ya existen o serán provistos por sus respectivos servicios antes de la integración.
- El selector de contexto tenant/workspace (US-UI-03) está disponible y funcional.
- Las vistas de gestión de cuotas y métricas (US-UI-04-T01) se implementan en paralelo o antes; los wizards solo necesitan consultar cuotas, no gestionarlas.

### Riesgos
| Riesgo | Mitigación |
|---|---|
| Los endpoints de creación no están listos al momento de implementar los wizards. | Diseñar los wizards contra contratos de API definidos; usar mocks para desarrollo. |
| La verificación de cuotas client-side puede quedar desincronizada con el server-side. | La validación server-side es autoritativa; la client-side es solo UX. Documentar esta dualidad. |

### Preguntas abiertas
- Ninguna bloqueante identificada para avanzar a planificación.
