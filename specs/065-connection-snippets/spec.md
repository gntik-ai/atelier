# Spec — Connection Snippets and Usage Examples in Console

**Feature slug**: `065-connection-snippets`
**Task ID**: US-UI-04-T05
**Epic**: EP-15 — Consola de administración: dominios funcionales
**Historia padre**: US-UI-04 — Métricas, auditoría, API keys, cuotas, wizards, warnings y snippets
**RF cubiertos**: RF-UI-027, RF-UI-028
**Dependencias**: US-OBS-03, US-UI-03, US-UI-04-T01, US-UI-04-T02, US-UI-04-T03, US-UI-04-T04
**Fecha**: 2026-03-29
**Estado**: Draft

---

## 1. Objetivo y problema que resuelve

El BaaS multi-tenant expone múltiples servicios — bases de datos (PostgreSQL, MongoDB), object storage, funciones serverless, autenticación — que los desarrolladores consumen desde aplicaciones externas. Cada servicio requiere URLs, credenciales, puertos y parámetros de configuración específicos del tenant y workspace activo. Sin una capacidad de **snippets de conexión** en la consola, los desarrolladores deben:

- Localizar manualmente endpoints, puertos y credenciales en distintas pantallas de la consola o documentación externa.
- Componer cadenas de conexión y configuraciones de SDK a mano, con riesgo de errores tipográficos, endpoints incorrectos o credenciales equivocadas.
- Perder tiempo en onboarding cada vez que integran un servicio nuevo o cambian de workspace.
- Depender de documentación genérica que no refleja la configuración real de su tenant/workspace.

Esta tarea especifica la capacidad de **copiar snippets de conexión y ejemplos de uso pre-configurados** para cada recurso del workspace, directamente desde la consola administrativa. Los snippets se generan con los valores reales del contexto activo (tenant, workspace, endpoints, credenciales visibles), reduciendo fricción de onboarding y errores de integración.

## 2. Usuarios afectados y valor recibido

| Actor | Valor |
|---|---|
| **Developer** | Obtiene snippets de conexión listos para copiar y pegar en su aplicación. Reduce tiempo de integración, elimina errores de configuración manual y acelera el ciclo de desarrollo. |
| **Workspace Admin** | Puede compartir snippets contextualizados con nuevos miembros del equipo, facilitando el onboarding técnico dentro del workspace. |
| **Tenant Owner** | Tiene visibilidad sobre los recursos disponibles y cómo conectarse a ellos. Puede evaluar rápidamente la superficie de servicios de su tenant. |
| **Superadmin** | Puede consultar los snippets de cualquier tenant/workspace para soporte operativo o diagnóstico de problemas de conexión. |

## 3. Escenarios principales, edge cases y reglas de negocio

### 3.1 Acceso a snippets desde el detalle de un recurso

El usuario navega al detalle de un recurso del workspace (una base de datos PostgreSQL, una colección MongoDB, un bucket de storage, una función, un client IAM) y encuentra una sección o acción **"Connection snippets"** / **"Snippets de conexión"**. La sección muestra una lista de snippets categorizados por lenguaje/SDK/herramienta.

### 3.2 Contenido de un snippet

Cada snippet incluye:

- **Título descriptivo**: identifica el lenguaje, SDK o herramienta (e.g., "Node.js — pg", "Python — psycopg2", "cURL", "MongoDB Shell").
- **Bloque de código**: cadena de conexión o fragmento de código funcional, con los valores reales del contexto sustituidos (host, puerto, nombre de base de datos, nombre de bucket, URL de función, client ID).
- **Marcadores de secretos**: las credenciales sensibles (passwords, secrets, API keys) **no se incluyen en claro** en el snippet. Se sustituyen por un placeholder descriptivo (e.g., `<YOUR_DB_PASSWORD>`, `<API_KEY>`) acompañado de una referencia textual a dónde obtener el valor real en la consola (e.g., "Consulta la sección API Keys de este workspace").
- **Notas contextuales opcionales**: advertencias sobre TLS, puertos no estándar, o requisitos previos (e.g., "Requiere habilitar acceso externo en la configuración del workspace").

### 3.3 Copiar al portapapeles

Cada snippet tiene un botón **"Copiar"** que copia el bloque de código completo al portapapeles del navegador. Tras copiar, el botón muestra una confirmación visual transitoria (e.g., "Copiado ✓") durante 2–3 segundos antes de volver al estado normal.

### 3.4 Snippets por tipo de recurso

Los snippets disponibles dependen del tipo de recurso:

| Tipo de recurso | Ejemplos de snippets |
|---|---|
| **PostgreSQL database** | Cadena de conexión `postgresql://`, ejemplo Node.js (`pg`), ejemplo Python (`psycopg2`), ejemplo cURL (API REST si aplica). |
| **MongoDB collection** | URI de conexión `mongodb://`, ejemplo Node.js (`mongoose` / `mongodb`), ejemplo Python (`pymongo`). |
| **Storage bucket** | URL del endpoint S3, ejemplo AWS CLI (`aws s3`), ejemplo Node.js (`@aws-sdk/client-s3`), ejemplo Python (`boto3`), ejemplo cURL (presigned URL). |
| **Función serverless** | URL de invocación, ejemplo cURL, ejemplo Node.js (`fetch`), ejemplo Python (`requests`). |
| **Client IAM (Keycloak)** | URL del token endpoint, ejemplo cURL para obtener token, ejemplo con `client_credentials` grant. |

### 3.5 Contextualización automática

Los snippets se generan con valores del contexto activo:

- **Tenant**: el tenant seleccionado en el selector de contexto.
- **Workspace**: el workspace seleccionado.
- **Recurso**: los parámetros específicos del recurso visualizado (host, puerto, nombre, región si aplica).
- Si algún valor de contexto no está disponible (e.g., el recurso aún no tiene un endpoint asignado), el snippet muestra un placeholder genérico y una nota explicativa.

### 3.6 Edge cases

- **Recurso sin endpoint asignado**: el snippet muestra placeholders genéricos y una nota indicando que el recurso no tiene endpoint activo aún. El botón de copiar sigue disponible.
- **Recurso en estado de error o aprovisionamiento**: los snippets se generan igualmente con los datos disponibles. Se muestra una nota de advertencia indicando el estado del recurso.
- **Tipo de recurso sin snippets definidos**: la sección de snippets no se muestra. No se genera un bloque vacío.
- **Navegador sin soporte de Clipboard API**: el botón de copiar muestra un mensaje alternativo indicando que la copia automática no está disponible, y el usuario puede seleccionar y copiar manualmente el texto del bloque de código.
- **Snippets para recurso con acceso externo deshabilitado**: el snippet se genera pero incluye una nota visible: "El acceso externo no está habilitado para este recurso. Los snippets muestran la configuración esperada una vez habilitado."

### 3.7 Reglas de negocio

- Los snippets son **solo lectura y generados en el frontend** a partir de los datos del recurso ya cargados en la vista de detalle. No requieren una llamada adicional al backend.
- Los snippets no revelan secretos. Los passwords, API keys y secrets se sustituyen por placeholders con referencia a la sección correspondiente de la consola.
- El catálogo de snippets por tipo de recurso es **extensible**: la implementación debe permitir añadir nuevos lenguajes/SDKs sin modificar la lógica de generación core.
- Los snippets respetan el idioma de la consola para las notas contextuales, pero los bloques de código se mantienen siempre en inglés (nombres de variables, comentarios inline).

## 4. Requisitos funcionales verificables

| ID | Requisito | Verificación |
|---|---|---|
| RF-CS-01 | La vista de detalle de un recurso (PostgreSQL, MongoDB, storage bucket, función, client IAM) incluye una sección "Snippets de conexión" cuando existen snippets definidos para ese tipo de recurso. | Navegar al detalle de cada tipo de recurso; verificar presencia de la sección. |
| RF-CS-02 | Cada snippet muestra título descriptivo (lenguaje/SDK/herramienta), bloque de código con valores contextualizados y botón de copiar. | Inspeccionar la estructura visual de al menos un snippet por tipo de recurso. |
| RF-CS-03 | Los valores de host, puerto, nombre del recurso, tenant y workspace en el snippet corresponden al contexto activo del usuario. | Comparar los valores del snippet con los datos del recurso y del selector de contexto. |
| RF-CS-04 | Los secretos (passwords, API keys, tokens) se sustituyen por placeholders descriptivos; nunca aparecen en claro en el snippet. | Verificar que ningún snippet contiene credenciales reales en el bloque de código. |
| RF-CS-05 | Cada placeholder de secreto incluye una referencia textual a la sección de la consola donde se puede obtener el valor real. | Verificar la presencia del texto de referencia junto a cada placeholder. |
| RF-CS-06 | El botón "Copiar" copia el bloque de código completo al portapapeles y muestra confirmación visual transitoria (2–3 s). | Pulsar copiar, pegar en editor externo, verificar contenido; verificar feedback visual. |
| RF-CS-07 | Si el navegador no soporta Clipboard API, se muestra un mensaje alternativo y el texto del bloque es seleccionable manualmente. | Simular ausencia de Clipboard API; verificar mensaje y selección manual. |
| RF-CS-08 | Si el recurso no tiene endpoint asignado, los snippets se generan con placeholders genéricos y una nota explicativa visible. | Navegar al detalle de un recurso sin endpoint; verificar snippets y nota. |
| RF-CS-09 | Si el recurso está en estado de error o aprovisionamiento, los snippets se generan con datos disponibles y muestran una nota de advertencia sobre el estado. | Navegar al detalle de un recurso en estado transitorio; verificar nota. |
| RF-CS-10 | Para tipos de recurso sin snippets definidos, la sección no se renderiza (no hay bloque vacío ni encabezado sin contenido). | Navegar a un recurso de tipo sin snippets; verificar ausencia de la sección. |
| RF-CS-11 | Los snippets cubren al menos los lenguajes/herramientas listados en la sección 3.4 para cada tipo de recurso. | Contrastar snippets visibles con la tabla de la sección 3.4. |
| RF-CS-12 | Las notas contextuales de los snippets se muestran en el idioma de la consola; los bloques de código permanecen en inglés. | Cambiar idioma de consola; verificar idioma de notas vs. código. |

### Límites de alcance

- **Incluido**: sección de snippets en vistas de detalle de recursos, generación contextualizada en frontend, botón de copiar con feedback, placeholders para secretos, notas contextuales, cobertura de los 5 tipos de recurso listados.
- **Excluido**: generación de snippets en el backend (los snippets se componen en frontend con datos ya disponibles).
- **Excluido**: ejecución directa de snippets desde la consola (e.g., terminal embebida).
- **Excluido**: personalización de snippets por el usuario (editar plantillas, añadir lenguajes custom).
- **Excluido**: descarga de snippets como archivo (e.g., `.env`, config file).
- **Excluido**: snippets para servicios no gestionados por el BaaS (servicios externos del usuario).
- **Excluido**: vistas de métricas, auditoría, API keys y cuotas (→ US-UI-04-T01).
- **Excluido**: wizards de onboarding (→ US-UI-04-T02).
- **Excluido**: confirmaciones destructivas (→ US-UI-04-T03).
- **Excluido**: logs de ejecución de funciones (→ US-UI-04-T04).
- **Excluido**: tests de regresión de UX (→ US-UI-04-T06).

## 5. Permisos, multi-tenancy, auditoría, cuotas y seguridad

### Permisos

- La sección de snippets solo se muestra si el usuario tiene permisos de lectura sobre el recurso visualizado dentro del workspace activo.
- No se requieren permisos adicionales más allá de los ya necesarios para ver el detalle del recurso. Los snippets se generan a partir de datos ya presentes en la respuesta de la API de detalle.
- El superadmin puede ver los snippets de recursos de cualquier tenant/workspace.

### Multi-tenancy

- El contexto de tenant/workspace se hereda del selector de contexto de la consola (US-UI-03).
- Los snippets solo reflejan datos del recurso dentro del workspace activo. No es posible generar snippets con datos de otro tenant o workspace.
- Los endpoints, hosts y puertos incluidos en los snippets corresponden exclusivamente al scope del workspace seleccionado.

### Auditoría

- La visualización de snippets es una operación de lectura derivada de datos ya cargados en el frontend. No genera eventos de auditoría propios.
- La acción de copiar al portapapeles es local al navegador y no genera tráfico al backend ni eventos de auditoría.

### Cuotas

- La generación de snippets no consume cuota adicional del tenant, ya que se construyen en frontend sin llamadas adicionales al backend.
- No existen límites de cuota sobre la cantidad de veces que un usuario puede copiar snippets.

### Seguridad

- Los snippets **nunca** incluyen secretos en claro (passwords, API keys, tokens, secrets de client IAM).
- Los placeholders de secretos son descriptivos pero no revelan información sobre la naturaleza o formato del secreto real.
- Los snippets se generan y renderizan en memoria del navegador; no se persisten en localStorage, sessionStorage ni IndexedDB.
- Al navegar fuera de la vista de detalle del recurso, los snippets generados se descartan de memoria.
- Toda comunicación subyacente (carga de datos del recurso) es vía HTTPS.

## 6. Criterios de aceptación

1. Cada tipo de recurso soportado (PostgreSQL, MongoDB, storage bucket, función serverless, client IAM) muestra una sección de snippets de conexión en su vista de detalle, con al menos los lenguajes/herramientas especificados en la sección 3.4.
2. Los snippets contienen los valores reales de host, puerto, nombre del recurso, tenant y workspace del contexto activo.
3. Ningún snippet muestra credenciales sensibles en claro; todos los secretos aparecen como placeholders con referencia a la sección correspondiente de la consola.
4. El botón "Copiar" copia el contenido completo del snippet al portapapeles y muestra feedback visual transitorio.
5. Si el recurso no tiene endpoint activo o está en estado transitorio, los snippets se generan con placeholders y notas explicativas visibles.
6. La sección de snippets no se renderiza para tipos de recurso sin snippets definidos.
7. El aislamiento multi-tenant es correcto: los snippets solo contienen datos del workspace activo.
8. Los snippets no se persisten en almacenamiento client-side del navegador.
9. La funcionalidad solo es accesible para usuarios con permisos de lectura sobre el recurso en el workspace activo.
10. El catálogo de snippets es extensible: añadir un nuevo lenguaje/SDK para un tipo de recurso existente no requiere modificar la lógica de generación core.

## 7. Riesgos, supuestos y preguntas abiertas

### Supuestos

- Las vistas de detalle de recursos (specs `055-console-postgres-views`, `058-console-functions-views`, storage views, IAM views) están disponibles y proporcionan los datos necesarios (host, puerto, nombre, estado) para generar los snippets.
- El selector de contexto tenant/workspace (US-UI-03) está funcional y proporciona los valores de contexto necesarios.
- Las API keys y tokens se gestionan en la pantalla dedicada (US-UI-04-T01); los snippets solo referencian esa sección, no duplican la funcionalidad.
- Los endpoints de cada servicio son determinísticos a partir del tenant, workspace y nombre del recurso (no requieren una llamada adicional para resolverlos).

### Riesgos

| Riesgo | Mitigación |
|---|---|
| Los endpoints de algunos servicios no son predecibles desde el frontend (e.g., asignación dinámica de puertos). | El backend incluye el endpoint resuelto en la respuesta de detalle del recurso. Si no lo incluye, el snippet usa un placeholder y nota explicativa. |
| Nuevos tipos de recurso se añaden al BaaS y no tienen snippets definidos. | El diseño extensible permite añadir definiciones de snippet por tipo sin modificar la lógica core. La sección se oculta automáticamente si no hay snippets para el tipo. |
| Los snippets quedan desactualizados si el endpoint del recurso cambia tras la carga de la página. | Los snippets se regeneran cada vez que el usuario accede al detalle del recurso. No se cachean entre navegaciones. |

### Preguntas abiertas

- Ninguna bloqueante identificada para avanzar a planificación.
