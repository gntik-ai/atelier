# Especificación — US-BKP-02-T01: Exportación de configuración funcional de tenants

| Campo               | Valor                                                                 |
|---------------------|-----------------------------------------------------------------------|
| **Task ID**         | US-BKP-02-T01                                                         |
| **Epic**            | EP-20 — Backup, recuperación y continuidad operativa                  |
| **Historia**        | US-BKP-02 — Exportación de configuración funcional y reprovisionamiento de tenants |
| **Tipo**            | Feature                                                               |
| **Prioridad**       | P1                                                                    |
| **Tamaño**          | M                                                                     |
| **RFs cubiertos**   | RF-BKP-003, RF-BKP-004                                               |
| **Dependencias**    | US-TEN-04 (gestión de tenants), US-BKP-01 (visibilidad y flujos de backup) |

---

## 1. Objetivo y problema que resuelve

### Problema

La plataforma BaaS multi-tenant gestiona una cantidad significativa de **configuración funcional** distribuida entre múltiples subsistemas (IAM en Keycloak, esquemas y metadata en PostgreSQL, colecciones y metadata en MongoDB, topics y ACLs en Kafka, funciones serverless en OpenWhisk, y buckets con políticas en almacenamiento S3-compatible). Esta configuración define "cómo está montado" un tenant: sus roles, permisos, estructuras de datos, canales de mensajería, lógica de negocio desplegada y políticas de acceso a objetos.

En la situación actual:

1. **No existe un mecanismo unificado dentro del producto para extraer la configuración funcional completa de un tenant** como un artefacto cohesivo. Si un operador necesita reconstruir o migrar un tenant, debe ir componente por componente, con herramientas y formatos heterogéneos, sin garantía de completitud.
2. **La ausencia de exportación dificulta escenarios críticos**: migración entre entornos (staging → producción), clonado de tenants para pruebas, auditoría de configuración, recuperación tras un error de configuración, y reprovisionamiento tras incidentes.
3. **El conocimiento de qué constituye la configuración funcional de un tenant está implícito**, disperso entre los equipos de cada subsistema, sin un inventario explícito ni una interfaz de extracción unificada.

### Objetivo de esta tarea

Implementar la capacidad de exportar la configuración funcional de un tenant como un artefacto estructurado y cohesivo, abarcando los seis dominios de configuración gestionados por la plataforma: IAM, metadata relacional (PostgreSQL), metadata documental (MongoDB), topics y ACLs de mensajería (Kafka), funciones serverless (OpenWhisk) y buckets con políticas de almacenamiento (S3-compatible).

El resultado es que un actor autorizado pueda obtener, mediante un único punto de entrada (API), un snapshot exportable de toda la configuración funcional de un tenant, sin incluir datos de usuario ni contenido de objetos almacenados.

---

## 2. Usuarios y valor recibido

| Actor | Relación con la capacidad | Valor que recibe |
|---|---|---|
| **SRE / Platform team** | Ejecuta la exportación como parte de procedimientos operativos | Obtiene un artefacto completo y estructurado para migración, clonado o recuperación sin ensamblar manualmente exports parciales de cada subsistema. |
| **Superadmin** | Solicita exportaciones para auditoría o preparación de migraciones | Puede verificar la configuración funcional completa de un tenant en un único documento/artefacto, sin dependencia del equipo de plataforma. |
| **Tenant owner** | Consumidor indirecto; se beneficia de que su configuración sea recuperable | Garantía de que la configuración de su tenant puede ser reconstruida en caso de incidente, migración o clonación de entorno. |
| **Equipo de QA / Staging** | Usa exports para reproducir configuraciones de producción en entornos de prueba | Puede clonar la configuración funcional de un tenant de producción a un entorno sandbox sin reconstrucción manual. |

---

## 3. Escenarios principales, edge cases y reglas de negocio

### 3.1 Escenarios principales

**E1 — Superadmin exporta la configuración funcional completa de un tenant**

> El superadmin invoca el endpoint de exportación indicando el `tenant_id`. El sistema recopila la configuración funcional de los seis dominios (IAM, PostgreSQL metadata, MongoDB metadata, Kafka topics/ACLs, funciones OpenWhisk, buckets/políticas S3) y devuelve un artefacto JSON estructurado con toda la configuración funcional del tenant. El artefacto incluye metadata de exportación (timestamp, versión del formato, tenant de origen, perfil de despliegue).

**E2 — SRE exporta la configuración funcional de un tenant para migración entre entornos**

> El SRE ejecuta la exportación del tenant de producción. Descarga el artefacto. Lo utiliza como referencia (o input para una futura importación en US-BKP-02-T03) en el entorno destino. El artefacto es autocontenido: no depende de referencias a IDs internos del entorno de origen que no puedan mapearse.

**E3 — Exportación parcial por dominio**

> El superadmin solicita exportar solo la configuración de IAM y funciones de un tenant (no todos los dominios). El endpoint acepta un filtro de dominios y devuelve el artefacto con solo las secciones solicitadas, manteniendo la estructura y metadata del artefacto completo.

**E4 — Exportación de tenant con componentes no disponibles en el despliegue**

> El despliegue actual no incluye OpenWhisk. Cuando se exporta la configuración del tenant, la sección de funciones aparece con un indicador explícito de `not_available` en lugar de omitirse silenciosamente, para que el artefacto refleje fielmente el estado del despliegue de origen.

**E5 — Consulta de dominios exportables antes de la exportación**

> Un actor consulta un endpoint auxiliar que devuelve la lista de dominios exportables para un tenant dado, según el perfil de despliegue y la configuración activa. Esto permite a herramientas y UIs presentar opciones válidas antes de iniciar la exportación.

### 3.2 Edge cases

| Caso | Comportamiento esperado |
|---|---|
| Tenant sin configuración en algún dominio (p. ej., no tiene funciones desplegadas) | La sección del dominio aparece vacía pero presente: `"functions": { "status": "empty", "items": [] }`. No se omite. |
| Tenant recién creado con solo configuración IAM por defecto | La exportación incluye la configuración IAM por defecto y secciones vacías para los demás dominios. Es un artefacto válido. |
| Exportación durante una operación de escritura concurrente en la configuración del tenant | La exportación opera sobre snapshots de lectura. No se garantiza consistencia transaccional cross-domain (cada dominio se exporta con su propio nivel de aislamiento de lectura). El artefacto incluye timestamps por sección para que el consumidor pueda evaluar la ventana temporal. |
| Componente gestionado temporalmente inaccesible (p. ej., PostgreSQL no responde) | La sección del dominio afectado aparece con `"status": "error"` y un mensaje descriptivo. Las demás secciones se exportan normalmente. La exportación no falla por completo. |
| Tenant con gran volumen de configuración (cientos de funciones, decenas de topics) | El endpoint no pagina el artefacto: se exporta como un solo documento. Si el tamaño excede un límite configurable, el endpoint devuelve un error con indicación del tamaño estimado y sugiere filtrar por dominios. |
| Datos sensibles en la configuración (p. ej., secretos en variables de entorno de funciones) | Los secretos se redactan o se sustituyen por placeholders (`"value": "***REDACTED***"`). El artefacto de exportación nunca contiene credenciales en texto plano. |
| Exportación de un tenant inexistente o eliminado | El endpoint devuelve `HTTP 404` con un mensaje claro. |
| ACLs de Kafka que referencian identidades internas del entorno (IDs de Keycloak, nombres de servicio) | Las ACLs se exportan con los identificadores tal como están. La resolución de conflictos de identidad es responsabilidad de la importación (US-BKP-02-T03), no de la exportación. |

### 3.3 Reglas de negocio y gobierno

**RN-01 — Configuración funcional, no datos de usuario**
La exportación incluye exclusivamente configuración funcional: esquemas, roles, permisos, definiciones de funciones, topics, ACLs, políticas de buckets, metadata de colecciones. **No incluye** datos de usuario, contenido de objetos almacenados, mensajes en topics, ni registros de tablas/colecciones.

**RN-02 — El artefacto es un snapshot de lectura, no un stream**
Cada exportación produce un artefacto puntual (snapshot). No es un mecanismo de replicación continua ni de CDC.

**RN-03 — Cada dominio tiene un recolector independiente**
La exportación utiliza un modelo de recolectores (collectors), uno por dominio de configuración. Cada recolector sabe cómo extraer la configuración funcional de su subsistema. Si no existe recolector para un dominio, ese dominio aparece como `not_available`.

**RN-04 — El artefacto debe ser determinista y reproducible**
Dos exportaciones consecutivas del mismo tenant sin cambios intermedios deben producir artefactos funcionalmente equivalentes (mismo contenido, posiblemente diferente timestamp de exportación).

**RN-05 — Redacción de secretos obligatoria**
Cualquier valor identificado como secreto, credencial, token o clave privada debe ser redactado en el artefacto de exportación. Los recolectores deben implementar la redacción como parte de su extracción, no como un paso posterior.

**RN-06 — Metadata de exportación obligatoria**
Todo artefacto de exportación debe incluir en su raíz: timestamp de exportación (UTC ISO 8601), identificador del tenant de origen, versión del formato de exportación, perfil de despliegue activo, y lista de dominios incluidos con su estado individual.

**RN-07 — El formato de exportación es JSON estructurado**
El artefacto de exportación es un documento JSON con un esquema definido. La definición detallada del formato versionado y su compatibilidad con upgrades es responsabilidad de US-BKP-02-T02, pero esta tarea produce un formato inicial funcional.

---

## 4. Requisitos funcionales y límites de alcance

### 4.1 Requisitos funcionales verificables

**RF-T01-01 — Endpoint de exportación de configuración funcional**
Debe existir un endpoint REST que, dado un `tenant_id` y opcionalmente una lista de dominios a incluir, inicie la exportación de la configuración funcional del tenant y devuelva el artefacto JSON resultante.

**RF-T01-02 — Recolector de configuración IAM (Keycloak)**
Debe existir un recolector que extraiga la configuración funcional de IAM del tenant: realm settings relevantes al tenant, roles, grupos, client scopes, identity providers configurados, y mappers. No incluye contraseñas de usuarios ni tokens activos.

**RF-T01-03 — Recolector de metadata PostgreSQL**
Debe existir un recolector que extraiga la metadata de las bases de datos asociadas al tenant: esquemas, tablas (estructura, columnas, tipos, constraints, índices), vistas, extensiones habilitadas, y grants/permisos a nivel de schema/tabla. No incluye datos de las tablas.

**RF-T01-04 — Recolector de metadata MongoDB**
Debe existir un recolector que extraiga la metadata de las bases de datos y colecciones MongoDB del tenant: bases de datos, colecciones (con sus validadores/schemas si existen), índices, y configuración de sharding si aplica. No incluye documentos de las colecciones.

**RF-T01-05 — Recolector de topics y ACLs de Kafka**
Debe existir un recolector que extraiga la configuración de Kafka asociada al tenant: topics (nombre, particiones, factor de replicación, configuración específica), ACLs asociadas, y consumer groups relevantes. No incluye mensajes de los topics.

**RF-T01-06 — Recolector de funciones OpenWhisk**
Debe existir un recolector que extraiga la configuración de funciones serverless del tenant: acciones (nombre, runtime, código fuente o referencia al paquete, límites configurados, variables de entorno con secretos redactados), paquetes, triggers y rules. No incluye logs de ejecución ni resultados de invocaciones.

**RF-T01-07 — Recolector de buckets y políticas S3**
Debe existir un recolector que extraiga la configuración de almacenamiento de objetos del tenant: buckets (nombre, región, versionado, lifecycle rules), políticas de acceso (bucket policies), y configuración de CORS si aplica. No incluye los objetos almacenados.

**RF-T01-08 — Estructura del artefacto de exportación**
El artefacto JSON debe seguir una estructura con: una sección raíz de metadata (timestamp, tenant_id, format_version, deployment_profile, domains_included) y una sección por dominio con su estado (`ok`, `empty`, `error`, `not_available`) y sus items.

**RF-T01-09 — Filtrado por dominios**
El endpoint de exportación debe aceptar un parámetro opcional que indique qué dominios incluir. Si no se especifica, se exportan todos los dominios disponibles.

**RF-T01-10 — Endpoint de dominios exportables**
Debe existir un endpoint auxiliar que, dado un `tenant_id`, devuelva la lista de dominios de configuración exportables y su disponibilidad según el perfil de despliegue.

**RF-T01-11 — Degradación parcial ante fallo de recolector**
Si un recolector falla (timeout, error de conexión, error interno), la exportación continúa con los demás dominios. El dominio fallido aparece con `"status": "error"` y un mensaje descriptivo. La exportación no se aborta por el fallo de un solo dominio.

**RF-T01-12 — Redacción de secretos en el artefacto**
Todo valor identificado como secreto, credencial, token o clave privada debe ser sustituido por un placeholder (`***REDACTED***`) en el artefacto de exportación. La redacción se aplica en cada recolector durante la extracción.

### 4.2 Límites claros de alcance

**Incluido en US-BKP-02-T01:**
- Endpoint de exportación de configuración funcional (API REST).
- Seis recolectores de configuración: IAM, PostgreSQL metadata, MongoDB metadata, Kafka topics/ACLs, OpenWhisk funciones, S3 buckets/políticas.
- Estructura inicial del artefacto JSON de exportación.
- Endpoint auxiliar de dominios exportables.
- Redacción de secretos.
- Degradación parcial ante fallos de recolectores.

**Excluido (tareas hermanas):**
- Formato de export versionado y compatibilidad con upgrades → **US-BKP-02-T02**
- Flujo de importación/reprovisionamiento → **US-BKP-02-T03**
- Validaciones de conflicto previas a importación → **US-BKP-02-T04**
- Pruebas de restauración funcional en sandbox → **US-BKP-02-T05**
- Documentación de diferencias entre restauración de config y restauración de datos → **US-BKP-02-T06**

---

## 5. Permisos, aislamiento multi-tenant, auditoría y seguridad

### 5.1 Aislamiento multi-tenant

- La exportación opera siempre en el contexto de un único `tenant_id`. Un actor solo puede exportar la configuración de un tenant para el cual tiene autorización.
- Los recolectores acceden a cada subsistema en el scope del tenant. Si un componente es compartido multi-tenant (p. ej., un cluster Kafka con topics de varios tenants), el recolector filtra exclusivamente la configuración del tenant solicitado.
- No existe exportación masiva de todos los tenants en un solo artefacto. Cada exportación produce un artefacto por tenant.

### 5.2 Permisos de acceso

| Actor | Puede exportar configuración de un tenant | Puede exportar cualquier tenant |
|---|---|---|
| Tenant owner | ❌ No (en esta fase; puede habilitarse como capability de plan en el futuro) |  ❌ No |
| SRE / Platform team | ✅ Sí | ✅ Sí |
| Superadmin | ✅ Sí | ✅ Sí |
| Proceso interno (automatización de backup) | ✅ Sí (con credencial de servicio) | ✅ Sí (scope configurado) |

> **Nota**: La exportación es una operación privilegiada porque el artefacto contiene la estructura completa de configuración del tenant. Incluso con secretos redactados, la información de esquemas, roles, topics y funciones puede ser sensible. Por ello, en esta primera iteración, solo roles de operaciones y superadmin tienen acceso.

### 5.3 Auditoría

- Cada invocación del endpoint de exportación debe generar un evento de auditoría que registre: actor, tenant_id exportado, dominios solicitados, dominios efectivamente exportados, resultado (éxito/éxito parcial/fallo), timestamp y correlation-id.
- Si la exportación es parcial (algún recolector falló), el evento de auditoría debe indicar qué dominios fallaron.
- Los eventos de auditoría se envían al pipeline estándar de la plataforma (US-OBS-01).

### 5.4 Seguridad

- El endpoint de exportación requiere autenticación (token JWT de Keycloak) y autorización por rol.
- Los recolectores acceden a los subsistemas con credenciales de servicio de solo lectura.
- El artefacto de exportación nunca contiene secretos en texto plano (RN-05).
- El artefacto no se almacena en la plataforma por defecto; se devuelve como respuesta al actor que lo solicitó. Si en el futuro se almacena (para historial o programación), será con cifrado en reposo (fuera de alcance de esta tarea).
- Las respuestas de error del endpoint no revelan detalles internos de los subsistemas.

### 5.5 Trazabilidad con el backlog

| Requisito funcional | RF del backlog |
|---|---|
| Exportación de configuración funcional completa de un tenant | RF-BKP-003 |
| Recolectores por dominio y artefacto cohesivo | RF-BKP-004 |

---

## 6. Criterios de aceptación

**CA-01 — Exportación completa de un tenant con todos los dominios disponibles**
Dado un tenant con configuración en los seis dominios gestionados (IAM, PostgreSQL, MongoDB, Kafka, OpenWhisk, S3), cuando un superadmin invoca el endpoint de exportación sin filtro de dominios, entonces recibe un artefacto JSON que contiene las seis secciones de dominio con estado `ok` o `empty`, metadata de exportación (timestamp, tenant_id, format_version, deployment_profile), y al menos un item de configuración en cada dominio que tiene configuración.

**CA-02 — Exportación filtrada por dominio**
Dado un tenant con configuración en todos los dominios, cuando un SRE invoca el endpoint especificando solo `["iam", "functions"]`, entonces el artefacto contiene únicamente las secciones de IAM y funciones. Las demás secciones no están presentes o aparecen como `not_requested`.

**CA-03 — Dominio no disponible en el despliegue**
Dado un despliegue sin OpenWhisk, cuando se exporta la configuración de un tenant, entonces la sección de funciones aparece con `"status": "not_available"` y un mensaje indicando que el componente no está presente en el perfil de despliegue.

**CA-04 — Dominio vacío**
Dado un tenant sin funciones desplegadas en un entorno que sí tiene OpenWhisk, cuando se exporta, entonces la sección de funciones aparece con `"status": "empty"` e items vacíos. No se omite.

**CA-05 — Redacción de secretos**
Dado un tenant con funciones que tienen variables de entorno con valores secretos, cuando se exporta, entonces esos valores aparecen como `***REDACTED***` en el artefacto. No se incluyen credenciales en texto plano.

**CA-06 — Degradación parcial ante fallo de recolector**
Dado un recolector de MongoDB que falla por timeout, cuando se exporta la configuración completa del tenant, entonces las demás secciones se exportan con normalidad y la sección de MongoDB aparece con `"status": "error"` y mensaje descriptivo. El endpoint devuelve HTTP 200 (éxito parcial) o HTTP 207, no HTTP 500.

**CA-07 — Aislamiento multi-tenant**
Dado un tenant A y un tenant B en la misma plataforma, cuando un superadmin exporta la configuración del tenant A, entonces el artefacto no contiene configuración del tenant B en ningún dominio.

**CA-08 — Autorización: solo roles privilegiados**
Dado un tenant owner autenticado, cuando intenta invocar el endpoint de exportación, entonces recibe `HTTP 403`. Dado un superadmin, la misma invocación retorna el artefacto.

**CA-09 — Evento de auditoría por exportación**
Dado una exportación exitosa o parcialmente exitosa, cuando se completa, entonces existe un evento de auditoría en el pipeline con: actor, tenant_id, dominios solicitados, dominios exportados, resultado, timestamp y correlation-id.

**CA-10 — Endpoint de dominios exportables**
Dado un tenant en un despliegue con OpenWhisk desactivado, cuando un superadmin consulta los dominios exportables, entonces la respuesta lista los seis dominios con su disponibilidad, y OpenWhisk aparece como `not_available`.

**CA-11 — Artefacto determinista**
Dado un tenant sin cambios de configuración entre dos exportaciones consecutivas, cuando se comparan los artefactos excluyendo el timestamp de exportación, entonces el contenido funcional es idéntico.

**CA-12 — Metadata de exportación presente**
Dado cualquier artefacto de exportación, cuando se inspecciona la sección raíz, entonces contiene: `export_timestamp` (UTC ISO 8601), `tenant_id`, `format_version`, `deployment_profile`, y `domains` con la lista de dominios incluidos y su estado.

---

## 7. Riesgos, supuestos y preguntas abiertas

### 7.1 Riesgos

| ID | Descripción | Probabilidad | Impacto | Mitigación sugerida |
|---|---|---|---|---|
| R-01 | La extracción de metadata de los seis subsistemas requiere acceso administrativo a cada uno; las credenciales de servicio podrían no estar uniformemente configuradas en todos los entornos | Media | Alto | Verificar la disponibilidad de credenciales de servicio en el entorno de referencia antes de implementar cada recolector. Degradar a `not_available` si no hay acceso. |
| R-02 | La heterogeneidad de APIs de administración entre subsistemas (Keycloak Admin API, pg_catalog, MongoDB commands, Kafka AdminClient, OpenWhisk API, S3 API) puede hacer que cada recolector sea significativamente diferente en complejidad | Alta | Medio | Aceptar la heterogeneidad como inherente. Definir un contrato común de salida (no de extracción). Priorizar recolectores por complejidad creciente. |
| R-03 | La exportación de tenants con gran cantidad de configuración (cientos de funciones, decenas de topics con ACLs complejas) puede producir artefactos de gran tamaño o tiempos de exportación largos | Media | Medio | Establecer un límite configurable de tamaño del artefacto. Permitir filtrado por dominio (RF-T01-09) para reducir el scope. |
| R-04 | La identificación de qué valores son "secretos" no es trivial en todos los subsistemas; riesgo de fuga de credenciales si la heurística de redacción falla | Media | Alto | Los recolectores deben usar listas explícitas de campos sensibles por tipo de configuración. Complementar con una heurística de detección de patrones comunes (tokens, passwords, keys). Revisión de seguridad del artefacto como parte de la validación. |
| R-05 | La exportación no es transaccional cross-domain; puede capturar un estado inconsistente si hay cambios concurrentes | Media | Bajo | Documentar que el artefacto es un snapshot best-effort. Incluir timestamps por sección para que el consumidor evalúe la consistencia temporal. La consistencia transaccional cross-domain es un problema de la importación (US-BKP-02-T03), no de la exportación. |

### 7.2 Supuestos

**S-01**: El modelo de tenants (US-TEN-04) permite identificar qué recursos de cada subsistema pertenecen a un tenant dado (p. ej., namespace de Keycloak, schema de PostgreSQL, base de datos de MongoDB, prefijo de topics de Kafka, namespace de OpenWhisk, prefijo de buckets S3).

**S-02**: Existen APIs de administración accesibles para cada subsistema gestionado (Keycloak Admin REST API, PostgreSQL information_schema/pg_catalog, MongoDB administrative commands, Kafka AdminClient, OpenWhisk REST API, S3 API) que permiten extraer la metadata de configuración necesaria.

**S-03**: Las credenciales de servicio con acceso de lectura a las APIs administrativas de cada subsistema están disponibles o pueden configurarse como parte del despliegue.

**S-04**: El pipeline de auditoría (US-OBS-01) está operativo y acepta eventos de exportación.

**S-05**: El formato inicial del artefacto JSON no necesita ser compatible con versiones futuras del producto desde el día uno. La compatibilidad forward/backward es responsabilidad de US-BKP-02-T02.

### 7.3 Preguntas abiertas

**P-01 — ¿Cómo se identifica la pertenencia de recursos a un tenant en cada subsistema?**
Cada subsistema usa una convención diferente para asociar recursos a tenants (realm en Keycloak, schema en PostgreSQL, database en MongoDB, prefijo de topic en Kafka, namespace en OpenWhisk, prefijo de bucket en S3). ¿Existe un registro centralizado de estas convenciones o cada recolector debe conocer la suya?
*No bloquea la especificación*, pero afecta el diseño de los recolectores.

**P-02 — ¿El código fuente de las funciones OpenWhisk se incluye en el artefacto o solo la referencia al paquete?**
Incluir el código fuente hace el artefacto más autocontenido pero más grande. Incluir solo la referencia al paquete requiere que el paquete esté disponible externamente.
*No bloquea la especificación*; la decisión puede tomarse en plan/implementación.

**P-03 — ¿Se debe soportar exportación asíncrona para tenants grandes?**
Si la exportación de un tenant grande tarda más de lo aceptable para una respuesta HTTP síncrona, ¿se debe ofrecer un mecanismo asíncrono (iniciar exportación → poll estado → descargar artefacto)?
*No bloquea la especificación*; puede resolverse como refinamiento en el plan.

---

*Documento generado para el stage `speckit.specify` — US-BKP-02-T01 | Rama: `115-functional-config-export`*
