# Especificación — US-BKP-02-T04: Validaciones previas para detectar conflictos entre export existente y entorno destino

| Campo               | Valor                                                                 |
|---------------------|-----------------------------------------------------------------------|
| **Task ID**         | US-BKP-02-T04                                                         |
| **Epic**            | EP-20 — Backup, recuperación y continuidad operativa                  |
| **Historia**        | US-BKP-02 — Exportación de configuración funcional y reprovisionamiento de tenants |
| **Tipo**            | Feature                                                               |
| **Prioridad**       | P1                                                                    |
| **Tamaño**          | M                                                                     |
| **RFs cubiertos**   | RF-BKP-003, RF-BKP-004                                               |
| **Dependencias**    | US-TEN-04, US-BKP-01, US-BKP-02-T01, US-BKP-02-T02, US-BKP-02-T03  |

**Feature Branch**: `118-export-conflict-prechecks`
**Created**: 2026-04-01
**Status**: Draft

---

## 1. Objetivo y problema que resuelve

### Problema

US-BKP-02-T03 implementa el flujo de reaprovisionamiento de configuración funcional a partir de un artefacto de exportación. Durante ese proceso, cuando un recurso del artefacto ya existe en el tenant destino con configuración diferente, el aplicador correspondiente lo reporta como `conflict` y **no lo modifica**. Esta política conservadora es correcta, pero tiene limitaciones operativas importantes:

1. **La detección de conflictos ocurre durante la ejecución del reaprovisionamiento**, no antes. El operador descubre los conflictos solo después de que los aplicadores han recorrido todos los dominios, lo que puede tardar decenas de segundos y consume un lock de concurrencia por tenant. Si hay muchos conflictos, el resultado útil (qué conflictos existen) llega mezclado con el resultado de la aplicación de dominios sin conflicto.

2. **No existe un análisis previo dedicado al inventario de conflictos**. El modo `dry_run` de T03 simula la aplicación completa y devuelve un plan, pero su propósito principal es evaluar el impacto de la aplicación, no ofrecer un diagnóstico estructurado de conflictos con clasificación, severidad y recomendaciones.

3. **No hay visibilidad anticipada del riesgo de un reaprovisionamiento**. Un operador que va a aplicar un artefacto sobre un tenant no vacío no puede evaluar rápidamente la magnitud de los conflictos ni decidir si necesita ajustar el artefacto, modificar el tenant destino, o proceder con confianza.

4. **No existe clasificación de conflictos ni recomendaciones de resolución**. Los conflictos reportados por T03 son todos iguales: `conflict` con un diff. No se distingue entre un conflicto menor (un atributo cosmético difiere) y un conflicto estructural (un esquema de tabla tiene columnas incompatibles).

### Objetivo de esta tarea

Implementar un servicio de validación previa (pre-flight check) que, dado un artefacto de exportación y un tenant destino, analice todos los dominios y produzca un **informe de conflictos** estructurado antes de que el operador decida si ejecutar el reaprovisionamiento. El informe debe clasificar cada conflicto por severidad, ofrecer un resumen ejecutivo del riesgo, y proporcionar recomendaciones accionables por tipo de conflicto.

El resultado es que un operador pueda invocar una validación previa ligera, obtener un informe claro de qué conflictos existen entre el artefacto y el estado actual del tenant destino, evaluar el riesgo del reaprovisionamiento, y tomar una decisión informada antes de comprometer el lock de concurrencia y ejecutar la aplicación.

---

## 2. Usuarios y valor recibido

| Actor | Relación con la capacidad | Valor que recibe |
|---|---|---|
| **SRE / Platform team** | Ejecuta la validación previa como paso previo al reaprovisionamiento | Obtiene un diagnóstico completo de conflictos antes de comprometer cambios, reduciendo el riesgo de resultados inesperados y la necesidad de investigación manual posterior. |
| **Superadmin** | Evalúa la viabilidad de clonar configuraciones entre tenants o entornos | Puede determinar si la configuración del artefacto es compatible con el tenant destino antes de invertir tiempo en ajustar el mapa de identificadores o en ejecutar un reaprovisionamiento parcial. |
| **Proceso interno (automatización de DR)** | Ejecuta la validación previa como gate automático en runbooks de recuperación | Puede decidir programáticamente si proceder con el reaprovisionamiento o escalar a un operador humano cuando los conflictos superan un umbral de severidad. |
| **Tenant owner** | Consumidor indirecto | Mayor confianza en que el reaprovisionamiento se ejecutará sobre una base analizada, minimizando el riesgo de estados parciales no deseados. |

---

## 3. Escenarios principales, edge cases y reglas de negocio

### 3.1 Escenarios principales

**E1 — Validación previa sobre tenant vacío (sin conflictos)**

> Un SRE tiene un artefacto de exportación y un tenant destino recién creado y vacío. Invoca la validación previa. El sistema recorre todos los dominios, verifica que no existe ningún recurso en conflicto, y devuelve un informe con cero conflictos, riesgo `low`, y la recomendación de proceder con confianza.

**E2 — Validación previa sobre tenant con configuración parcial (conflictos mixtos)**

> Un superadmin quiere aplicar un artefacto sobre un tenant que ya tiene roles IAM, algunos topics Kafka y un esquema PostgreSQL parcialmente diferente. Invoca la validación previa. El sistema detecta:
> - 2 roles IAM que existen con permisos diferentes → conflictos de severidad `medium`.
> - 1 tabla PostgreSQL con columnas incompatibles → conflicto de severidad `high`.
> - 3 topics Kafka que coinciden exactamente → sin conflicto (compatibles).
> - 1 bucket S3 con política diferente → conflicto de severidad `medium`.
>
> El informe muestra un resumen ejecutivo con riesgo `high` (por la tabla incompatible), el detalle por dominio y recurso, y recomendaciones específicas: "Resolver manualmente la estructura de la tabla X antes de reaprovisionar" y "Revisar los permisos de los roles Y, Z si la diferencia es intencional".

**E3 — Validación previa con mapa de identificadores**

> Un operador quiere validar un artefacto de un entorno staging contra un tenant de producción. Proporciona el mapa de identificadores (generado previamente con el endpoint de T03). La validación previa aplica el mapa al artefacto antes de comparar contra el estado del tenant destino, de forma que los identificadores ya están normalizados durante el análisis.

**E4 — Validación previa filtrada por dominios**

> Un SRE solo necesita reaprovisionar IAM y funciones. Invoca la validación previa indicando `domains: ["iam", "functions"]`. El sistema analiza solo esos dos dominios e ignora el resto. El informe cubre únicamente los dominios solicitados.

**E5 — Validación previa como gate automático**

> Un pipeline de DR ejecuta la validación previa programáticamente. Si el informe devuelve riesgo `high` o `critical`, el pipeline escala a un operador humano. Si el riesgo es `low` o `medium`, el pipeline procede con el reaprovisionamiento automáticamente.

### 3.2 Edge cases

| Caso | Comportamiento esperado |
|---|---|
| Artefacto con un dominio en status `error` o `not_available` | Ese dominio se omite de la validación. Se reporta como `skipped_not_exportable` en el informe. |
| Artefacto con un dominio en status `empty` | El dominio se analiza pero no genera conflictos (no hay items que comparar). Se reporta como `no_conflicts` con zero items. |
| Tenant destino no existe | El endpoint devuelve `HTTP 404`. |
| El artefacto no pasa validación de formato (format_version incompatible) | El endpoint rechaza con `HTTP 422`. No se ejecuta ningún análisis. |
| Subsistema inaccesible durante la validación (ej: Keycloak no responde) | El dominio se reporta con status `analysis_error` y mensaje descriptivo. Los demás dominios se analizan normalmente. No se aborta la validación por un dominio fallido. |
| Mapa de identificadores inválido | El endpoint rechaza con `HTTP 400`. |
| Todos los recursos del artefacto ya existen idénticos en el destino (noop) | El informe muestra cero conflictos, riesgo `low`, y la recomendación de que el reaprovisionamiento resultará en una operación sin cambios. |
| Validación concurrente sobre el mismo tenant | Se permite. La validación previa es de solo lectura y no adquiere el lock de reaprovisionamiento. Múltiples validaciones pueden ejecutarse en paralelo. |
| Artefacto con secretos redactados (`***REDACTED***`) | Los campos redactados no generan conflicto por sí mismos. Si el recurso difiere en campos no redactados, se reporta el conflicto solo por esos campos. Si el único campo que difiere es un secreto redactado, el recurso se reporta como `compatible_with_redacted_fields` (no es conflicto). |

### 3.3 Reglas de negocio y gobierno

**RN-T04-01 — La validación previa es de solo lectura**
La validación previa no modifica ningún recurso en ningún subsistema. Es estrictamente una operación de análisis y comparación. No requiere ni adquiere el lock de reaprovisionamiento de T03.

**RN-T04-02 — Clasificación de severidad de conflictos**
Cada conflicto detectado se clasifica con una severidad según el tipo de diferencia:

| Severidad | Criterio | Ejemplos |
|---|---|---|
| `low` | La diferencia es cosmética o no afecta el comportamiento funcional | Atributos descriptivos distintos, metadata decorativa |
| `medium` | La diferencia afecta la configuración funcional pero el recurso podría actualizarse manualmente sin riesgo destructivo | Permisos de un rol IAM difieren, política de un bucket difiere, configuración de retention de un topic difiere |
| `high` | La diferencia es estructural o potencialmente destructiva; la resolución manual es no trivial | Columnas de una tabla PostgreSQL incompatibles, validador de una colección MongoDB incompatible, número de particiones de un topic difiere |
| `critical` | El conflicto impide la coexistencia del recurso del artefacto con el existente en el destino | Tipo de índice incompatible, restricciones de esquema mutuamente excluyentes |

**RN-T04-03 — Riesgo global del informe**
El riesgo global del informe se determina por la severidad máxima encontrada entre todos los conflictos:
- Cero conflictos → `low`
- Solo conflictos `low` → `low`
- Al menos un conflicto `medium` (y ninguno mayor) → `medium`
- Al menos un conflicto `high` → `high`
- Al menos un conflicto `critical` → `critical`

**RN-T04-04 — Recomendaciones por tipo de conflicto**
El informe incluye una recomendación accionable por cada conflicto. Las recomendaciones son específicas al tipo de recurso y severidad, no genéricas. Ejemplos:
- Rol IAM con permisos diferentes → "Verificar si los permisos del destino son intencionales. Si el artefacto debe prevalecer, actualizar el rol manualmente antes de reaprovisionar."
- Tabla PostgreSQL con columnas diferentes → "La tabla X tiene columnas incompatibles. Resolver la estructura manualmente o eliminar la tabla en el destino si es aceptable."
- Topic Kafka con diferente número de particiones → "Kafka no permite reducir particiones. Si el artefacto tiene menos particiones que el destino, el conflicto es informativo. Si tiene más, el topic deberá recrearse."

**RN-T04-05 — Reutilización de la lógica de comparación de T03**
Los comparadores de conflictos de la validación previa reutilizan la misma lógica de equivalencia que los aplicadores de T03 (`diff.mjs`). La diferencia es que la validación previa no ejecuta ninguna operación de escritura y agrega clasificación y recomendación al resultado.

**RN-T04-06 — Compatibilidad con el mapa de identificadores**
Si se proporciona un mapa de identificadores, la validación previa lo aplica al artefacto antes de comparar. Reutiliza `applyIdentifierMap` de T03. Si no se proporciona mapa y el `tenant_id` del artefacto difiere del destino, el endpoint devuelve la propuesta de mapa (igual que T03) e indica que la validación requiere un mapa confirmado para ser precisa.

**RN-T04-07 — No bloquea ni condiciona el reaprovisionamiento**
La validación previa es informativa. No impide ejecutar el reaprovisionamiento aunque el riesgo sea `critical`. El operador puede decidir proceder bajo su propio criterio. El informe proporciona la información para una decisión informada.

**RN-T04-08 — Degradación parcial ante subsistema inaccesible**
Si un subsistema no está disponible durante la validación, el dominio correspondiente se reporta como `analysis_error` y los demás dominios se analizan normalmente. El riesgo global incluye un flag `incomplete_analysis: true` para indicar que no todos los dominios fueron evaluados.

---

## 4. Requisitos funcionales y límites de alcance

### 4.1 Requisitos funcionales verificables

**RF-T04-01 — Endpoint de validación previa de conflictos**
Debe existir un endpoint REST que, dado un `tenant_id` destino, un artefacto de exportación (body JSON), un mapa de identificadores (opcional) y una lista de dominios a analizar (opcional), ejecute una validación de solo lectura y devuelva un informe estructurado de conflictos.

**RF-T04-02 — Validación del artefacto antes del análisis**
Antes de ejecutar cualquier análisis, el endpoint debe validar que el artefacto tiene una `format_version` compatible con la versión actual del formato (mismo major version). Si no es compatible, debe rechazar con `422`.

**RF-T04-03 — Aplicación del mapa de identificadores antes del análisis**
Si se proporciona un mapa de identificadores, el endpoint debe aplicarlo al artefacto (reutilizando `applyIdentifierMap` de T03) antes de comparar con el estado del tenant destino. Si el `tenant_id` del artefacto difiere del destino y no se proporciona mapa, el endpoint debe devolver la propuesta de mapa e indicar que se requiere confirmación para un análisis preciso.

**RF-T04-04 — Análisis de conflictos por dominio y por recurso**
Para cada dominio del artefacto incluido en el análisis, el endpoint debe comparar cada recurso del artefacto con el estado actual del recurso equivalente en el subsistema destino. Debe clasificar cada recurso como: `compatible` (no existe o es idéntico), `compatible_with_redacted_fields` (idéntico salvo campos redactados), o `conflict` (existe con configuración diferente en campos no redactados).

**RF-T04-05 — Clasificación de severidad por conflicto**
Cada conflicto detectado debe incluir una severidad (`low`, `medium`, `high`, `critical`) determinada por el tipo de recurso y la naturaleza de la diferencia, según las reglas de RN-T04-02.

**RF-T04-06 — Recomendación accionable por conflicto**
Cada conflicto detectado debe incluir una recomendación de texto que indique al operador qué acción tomar para resolverlo, específica al tipo de recurso y severidad.

**RF-T04-07 — Resumen ejecutivo del informe**
El informe debe incluir un resumen ejecutivo con: riesgo global (`low`, `medium`, `high`, `critical`), número total de recursos analizados, número de recursos compatibles, número de conflictos por severidad, flag `incomplete_analysis` si algún dominio no pudo analizarse, y dominios analizados vs dominios omitidos.

**RF-T04-08 — Filtrado por dominios**
El endpoint debe aceptar un parámetro opcional que indique qué dominios analizar. Si no se especifica, se analizan todos los dominios con status `ok` o `empty` en el artefacto.

**RF-T04-09 — Degradación parcial ante fallo de análisis**
Si un analizador de dominio falla (subsistema inaccesible, timeout), el dominio se reporta como `analysis_error` con mensaje descriptivo. El análisis continúa con los demás dominios. El endpoint no devuelve `HTTP 500` por el fallo de un solo dominio.

**RF-T04-10 — Detalle de diff por conflicto**
Cada conflicto debe incluir un diff estructurado que muestre qué campos difieren entre el recurso del artefacto y el recurso existente en el destino, excluyendo valores redactados del diff.

**RF-T04-11 — Auditoría de la validación previa**
Cada invocación de la validación previa debe generar un evento de auditoría que registre: actor, `tenant_id` destino, `tenant_id` origen, dominios analizados, resumen de conflictos (por severidad), riesgo global, flag `incomplete_analysis`, timestamp y correlation-id.

**RF-T04-12 — Sin lock de concurrencia**
La validación previa no adquiere ni consulta el lock de reaprovisionamiento de T03. Múltiples validaciones previas pueden ejecutarse en paralelo sobre el mismo tenant.

### 4.2 Límites claros de alcance

**Incluido en US-BKP-02-T04:**

- Endpoint de validación previa de conflictos (API REST, solo lectura).
- Analizadores de conflictos por dominio (reutilizando lógica de comparación de T03).
- Clasificación de severidad por tipo de conflicto y recurso.
- Recomendaciones accionables por conflicto.
- Resumen ejecutivo con riesgo global.
- Soporte para mapa de identificadores y filtrado por dominios.
- Degradación parcial ante subsistemas inaccesibles.
- Auditoría de la validación previa.
- Integración en la consola web (panel de validación previa).

**Excluido (tareas hermanas u otros):**

- Resolución automática de conflictos (sobrescritura, merge, force) → fuera de alcance de US-BKP-02; podría ser una tarea futura.
- Modificación del flujo de reaprovisionamiento de T03 → T03 permanece inalterado.
- Pruebas de restauración funcional en sandbox → **US-BKP-02-T05**.
- Documentación de diferencias entre restauración de config y de datos → **US-BKP-02-T06**.
- Creación de tenants → **US-TEN-04**.
- Restauración de datos de usuario → fuera del scope de US-BKP-02.

---

## 5. Permisos, aislamiento multi-tenant, auditoría y seguridad

### 5.1 Aislamiento multi-tenant

- La validación previa opera sobre un único `tenant_id` destino. Un actor solo puede validar un tenant para el cual tiene autorización.
- Los analizadores de dominio acceden a cada subsistema en modo lectura dentro del scope del tenant destino.
- No existe validación previa masiva de múltiples tenants en una sola invocación.

### 5.2 Permisos de acceso

| Actor | Puede ejecutar validación previa |
|---|---|
| Tenant owner | ❌ No (en esta fase) |
| SRE / Platform team | ✅ Sí |
| Superadmin | ✅ Sí |
| Proceso interno (automatización DR) | ✅ Sí (con credencial de servicio) |

> **Nota**: La validación previa requiere los mismos permisos que el reaprovisionamiento (T03). Reutiliza el mismo scope `platform:admin:config:reprovision` para mantener coherencia con la cadena de operaciones de backup/restore.

### 5.3 Auditoría

- Cada invocación de la validación previa debe generar un evento de auditoría que registre: actor, `tenant_id` destino, `tenant_id` origen (del artefacto), dominios analizados, resumen de conflictos por severidad, riesgo global, flag `incomplete_analysis`, timestamp y correlation-id.
- El tipo de operación en el evento de auditoría es `pre_flight_check` para distinguirlo de los eventos de reaprovisionamiento (`reprovision`) y de generación de mapa (`identifier_map`).
- Los eventos de auditoría se envían al pipeline estándar de la plataforma (US-OBS-01).

### 5.4 Seguridad

- El endpoint de validación previa requiere autenticación (token JWT de Keycloak) y autorización por rol.
- Los analizadores acceden a los subsistemas con credenciales de servicio con permisos de **solo lectura** sobre el scope del tenant destino. Pueden reutilizar las mismas credenciales de lectura que los recolectores de T01 (`CONFIG_EXPORT_*`), ya que la validación previa no escribe.
- El artefacto enviado para validación no se almacena en la plataforma; se procesa en memoria.
- Las respuestas de error no revelan detalles internos de los subsistemas.
- Los valores redactados del artefacto no se incluyen en diffs ni en el informe de conflictos.

### 5.5 Trazabilidad con el backlog

| Requisito funcional | RF del backlog |
|---|---|
| Validación previa de conflictos entre export y entorno destino | RF-BKP-003 |
| Clasificación de conflictos y recomendaciones accionables | RF-BKP-004 |

---

## User Scenarios & Testing

### User Story 1 — Validación previa sobre tenant vacío sin conflictos (Priority: P1)

Un SRE tiene un artefacto de exportación y un tenant destino vacío. Ejecuta la validación previa para confirmar que no hay conflictos antes de reaprovisionar.

**Why this priority**: Es el caso base que valida que la validación previa funciona correctamente cuando no hay conflictos, proporcionando confianza al operador.

**Independent Test**: Dado un artefacto con los seis dominios en status `ok` y un tenant vacío, la validación previa devuelve un informe con cero conflictos y riesgo `low`.

**Acceptance Scenarios**:

1. **Given** un artefacto completo (6 dominios, status `ok`) y un tenant vacío, **When** un superadmin ejecuta la validación previa, **Then** el informe muestra cero conflictos, riesgo `low`, y todos los recursos reportados como `compatible`.
2. **Given** un informe de validación previa con riesgo `low`, **When** el operador inspecciona el resumen ejecutivo, **Then** el resumen confirma que todos los dominios se analizaron correctamente y no hay flag `incomplete_analysis`.

---

### User Story 2 — Validación previa con conflictos mixtos y clasificación de severidad (Priority: P1)

Un operador quiere aplicar un artefacto sobre un tenant que ya tiene configuración parcial. La validación previa identifica conflictos con diferentes severidades y proporciona recomendaciones.

**Why this priority**: Es el caso de uso principal que justifica esta tarea. Sin clasificación de severidad y recomendaciones, el operador tiene la misma información que con un dry-run de T03.

**Independent Test**: Dado un tenant con un rol IAM diferente (medium) y una tabla PostgreSQL incompatible (high), el informe clasifica correctamente cada conflicto y el riesgo global es `high`.

**Acceptance Scenarios**:

1. **Given** un tenant con un rol `editor` con permisos diferentes al artefacto y una tabla `events` con columnas incompatibles, **When** se ejecuta la validación previa, **Then** el rol aparece como conflicto `medium` con recomendación sobre permisos, la tabla aparece como conflicto `high` con recomendación sobre estructura, y el riesgo global es `high`.
2. **Given** un informe con conflictos de severidad mixta, **When** se inspecciona cada conflicto, **Then** cada uno tiene un diff estructurado de los campos que difieren y una recomendación de texto específica al tipo de recurso.

---

### User Story 3 — Validación previa con mapa de identificadores (Priority: P1)

Un superadmin quiere validar un artefacto de staging contra un tenant de producción. Proporciona el mapa de identificadores para que la validación compare correctamente.

**Why this priority**: Sin aplicar el mapa de identificadores, la validación compararía identificadores que no corresponden, produciendo falsos conflictos.

**Independent Test**: Dado un artefacto de `tenant-stg` y un mapa que sustituye `stg→prod`, la validación compara contra los recursos del tenant de producción con los identificadores correctos.

**Acceptance Scenarios**:

1. **Given** un artefacto de `tenant-stg` y un mapa de identificadores confirmado, **When** se ejecuta la validación previa sobre `tenant-prod`, **Then** los conflictos reportados comparan recursos con los identificadores del destino, no los del origen.
2. **Given** un artefacto de `tenant-stg` sin mapa de identificadores proporcionado, **When** se invoca la validación previa sobre `tenant-prod`, **Then** el endpoint devuelve la propuesta de mapa con `needs_confirmation: true` y no ejecuta el análisis de conflictos.

---

### User Story 4 — Validación previa filtrada por dominios (Priority: P2)

Un SRE solo va a reaprovisionar IAM y funciones. Ejecuta la validación previa solo para esos dos dominios.

**Why this priority**: Permite validaciones más rápidas y enfocadas cuando el operador ya sabe qué dominios aplicará.

**Independent Test**: Dado un filtro `["iam", "functions"]`, la validación solo analiza esos dominios y el informe no contiene resultados de otros dominios.

**Acceptance Scenarios**:

1. **Given** un artefacto con 6 dominios y un filtro `["iam", "functions"]`, **When** se ejecuta la validación previa, **Then** el informe solo contiene resultados de IAM y funciones, los demás dominios no aparecen.

---

### User Story 5 — Validación previa como gate automático en DR (Priority: P2)

Un pipeline de DR ejecuta la validación previa programáticamente y decide si proceder o escalar según el nivel de riesgo.

**Why this priority**: Habilita la automatización de decisiones de reaprovisionamiento en runbooks de DR, reduciendo el tiempo de intervención humana.

**Independent Test**: El informe de la validación previa tiene un campo `risk_level` legible programáticamente que un pipeline puede evaluar como condición de gate.

**Acceptance Scenarios**:

1. **Given** un pipeline que ejecuta la validación previa, **When** el informe devuelve `risk_level: "low"`, **Then** el pipeline puede proceder automáticamente con el reaprovisionamiento.
2. **Given** un pipeline que ejecuta la validación previa, **When** el informe devuelve `risk_level: "high"`, **Then** el pipeline puede escalar a un operador humano sin haber ejecutado el reaprovisionamiento.

---

### User Story 6 — Degradación parcial cuando un subsistema no está disponible (Priority: P2)

Un operador ejecuta la validación previa pero MongoDB no está accesible. El informe cubre todos los demás dominios y marca MongoDB como `analysis_error`.

**Why this priority**: En entornos degradados, la validación parcial sigue siendo más útil que ninguna validación.

**Independent Test**: Dado un subsistema inaccesible, la validación previa completa los demás dominios y el informe incluye `incomplete_analysis: true`.

**Acceptance Scenarios**:

1. **Given** MongoDB inaccesible y los demás subsistemas disponibles, **When** se ejecuta la validación previa, **Then** MongoDB aparece como `analysis_error` con mensaje descriptivo, los demás dominios tienen resultados normales, y `incomplete_analysis` es `true`.

---

### User Story 7 — Manejo de recursos con campos redactados (Priority: P3)

Un artefacto contiene funciones con variables de entorno redactadas. La validación previa no reporta conflicto por los campos redactados cuando el recurso es compatible en los demás campos.

**Why this priority**: Evita falsos positivos de conflicto por campos que se sabe que no se pueden comparar.

**Independent Test**: Dado un recurso existente idéntico al del artefacto salvo por un campo `***REDACTED***`, la validación previa lo reporta como `compatible_with_redacted_fields` en lugar de `conflict`.

**Acceptance Scenarios**:

1. **Given** un artefacto con una función cuya variable `DB_PASSWORD` es `***REDACTED***` y la función existe en el destino con el mismo runtime y código, **When** se ejecuta la validación previa, **Then** el recurso se reporta como `compatible_with_redacted_fields` con un aviso de que los campos redactados no se compararon.

---

### Edge Cases

- ¿Qué ocurre si el artefacto tiene dominios con status `not_available` o `error`? → Se omiten con status `skipped_not_exportable`.
- ¿Qué pasa si el `format_version` del artefacto es incompatible? → Rechazado con `HTTP 422`.
- ¿Qué ocurre si el mapa de identificadores tiene entradas inválidas? → Rechazado con `HTTP 400`.
- ¿Qué pasa si el tenant destino no existe? → `HTTP 404`.
- ¿Qué ocurre si se ejecutan dos validaciones simultáneas sobre el mismo tenant? → Ambas se ejecutan normalmente (no hay lock).
- ¿Qué pasa si todos los recursos coinciden exactamente? → Cero conflictos, riesgo `low`, recomendación de que la operación resultará en noop.

---

## Requirements

### Functional Requirements

- **FR-001**: El sistema DEBE permitir ejecutar una validación previa de conflictos entre un artefacto de exportación y el estado actual de un tenant destino, sin modificar ningún recurso (RF-T04-01).
- **FR-002**: El sistema DEBE validar el `format_version` del artefacto antes de ejecutar el análisis, rechazando artefactos incompatibles (RF-T04-02).
- **FR-003**: El sistema DEBE aplicar el mapa de identificadores al artefacto antes de comparar, si se proporciona (RF-T04-03).
- **FR-004**: El sistema DEBE clasificar cada conflicto con una severidad: `low`, `medium`, `high`, `critical` (RF-T04-05).
- **FR-005**: El sistema DEBE incluir una recomendación accionable por cada conflicto detectado (RF-T04-06).
- **FR-006**: El sistema DEBE producir un resumen ejecutivo con riesgo global, conteos de conflictos por severidad, y flag de análisis incompleto (RF-T04-07).
- **FR-007**: El sistema DEBE permitir filtrar qué dominios analizar (RF-T04-08).
- **FR-008**: El sistema DEBE continuar el análisis de los demás dominios cuando un analizador falla, sin abortar la validación (RF-T04-09).
- **FR-009**: El sistema DEBE incluir un diff estructurado por cada conflicto que muestre los campos que difieren (RF-T04-10).
- **FR-010**: El sistema DEBE generar un evento de auditoría por cada invocación de la validación previa (RF-T04-11).
- **FR-011**: El sistema NO DEBE adquirir el lock de reaprovisionamiento de T03 durante la validación previa (RF-T04-12).
- **FR-012**: El sistema NO DEBE reportar como conflicto un recurso cuya única diferencia son campos redactados (`***REDACTED***`); debe reportarlo como `compatible_with_redacted_fields`.

### Key Entities

- **Pre-flight Check Report**: Estructura de resultado que contiene el resumen ejecutivo, el detalle por dominio y el detalle por recurso con clasificación de severidad y recomendación.
- **Conflict Entry**: Registro de un conflicto individual con: recurso, dominio, severidad, diff, recomendación.
- **Domain Analysis Result**: Resultado del análisis de un dominio con: status, conflictos detectados, recursos compatibles, recursos con campos redactados.
- **Executive Summary**: Resumen de alto nivel con: riesgo global, conteos, flag de análisis incompleto, dominios analizados.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: Un operador puede obtener un informe completo de conflictos entre un artefacto y un tenant destino en una única operación de solo lectura, sin comprometer el lock de reaprovisionamiento.
- **SC-002**: La validación previa para un tenant estándar (hasta 50 recursos por dominio) completa en menos de 30 segundos (mismo target que el dry-run de T03).
- **SC-003**: Cada conflicto del informe tiene una severidad y una recomendación específica al tipo de recurso, no genérica.
- **SC-004**: El riesgo global del informe permite a un pipeline automatizado tomar una decisión de gate sin parsear el detalle recurso por recurso.
- **SC-005**: Los campos redactados no producen falsos positivos de conflicto.
- **SC-006**: Un subsistema inaccesible no impide el análisis de los demás dominios; el informe indica claramente qué dominios no pudieron evaluarse.

---

## 6. Criterios de aceptación

**CA-01 — Validación previa sobre tenant vacío**
Dado un artefacto con los seis dominios en status `ok` y un tenant destino vacío, cuando un superadmin ejecuta la validación previa, entonces el informe muestra cero conflictos, riesgo `low`, todos los recursos como `compatible`, y todos los dominios analizados correctamente.

**CA-02 — Clasificación de severidad de conflictos**
Dado un tenant con un rol IAM diferente al artefacto y una tabla PostgreSQL con columnas incompatibles, cuando se ejecuta la validación previa, entonces el rol aparece como conflicto con severidad `medium` y la tabla aparece como conflicto con severidad `high`.

**CA-03 — Riesgo global basado en severidad máxima**
Dado un informe con conflictos de severidades `low`, `medium` y `high`, cuando se calcula el riesgo global, entonces es `high`.

**CA-04 — Recomendaciones accionables por conflicto**
Dado un conflicto de tipo "rol IAM con permisos diferentes", cuando se inspecciona la recomendación, entonces el texto es específico a roles IAM y sugiere una acción concreta (no un mensaje genérico como "resolver el conflicto").

**CA-05 — Aplicación del mapa de identificadores antes del análisis**
Dado un artefacto de `tenant-stg` y un mapa de identificadores confirmado, cuando se ejecuta la validación previa sobre `tenant-prod`, entonces los conflictos comparan con los identificadores del destino y no del origen.

**CA-06 — Sin mapa cuando tenant difiere → propuesta sin análisis**
Dado un artefacto de `tenant-stg` sin mapa de identificadores, cuando se invoca la validación previa sobre `tenant-prod`, entonces el endpoint devuelve la propuesta de mapa con `needs_confirmation: true` y no ejecuta el análisis.

**CA-07 — Filtrado por dominios**
Dado un artefacto con 6 dominios y un filtro `["iam", "functions"]`, cuando se ejecuta la validación previa, entonces solo IAM y funciones aparecen en el informe.

**CA-08 — Degradación parcial ante subsistema inaccesible**
Dado un analizador de MongoDB que falla por timeout, cuando se ejecuta la validación previa, entonces MongoDB aparece como `analysis_error`, los demás dominios se analizan normalmente, y `incomplete_analysis` es `true`.

**CA-09 — Recursos compatibles con campos redactados**
Dado un recurso existente idéntico al del artefacto salvo por un campo `***REDACTED***`, cuando se ejecuta la validación previa, entonces el recurso se reporta como `compatible_with_redacted_fields`, no como `conflict`.

**CA-10 — Diff estructurado por conflicto**
Dado un conflicto en un rol IAM, cuando se inspecciona el diff del conflicto, entonces muestra los campos que difieren (ej: `composites`) con los valores del artefacto y los valores del destino, sin incluir valores redactados.

**CA-11 — Validación de format_version**
Dado un artefacto con `format_version` de un major anterior al actual, cuando se envía al endpoint de validación previa, entonces se rechaza con `HTTP 422`.

**CA-12 — Tenant destino inexistente**
Dado un `tenant_id` destino que no existe, cuando se invoca la validación previa, entonces se devuelve `HTTP 404`.

**CA-13 — Autorización: solo roles privilegiados**
Dado un tenant owner autenticado, cuando intenta invocar la validación previa, entonces recibe `HTTP 403`. Dado un superadmin, la misma invocación procede normalmente.

**CA-14 — No adquiere lock de reaprovisionamiento**
Dado un reaprovisionamiento en curso sobre el tenant X (lock activo), cuando un operador ejecuta la validación previa sobre el mismo tenant X, entonces la validación se ejecuta normalmente sin ser bloqueada por el lock.

**CA-15 — Evento de auditoría por validación previa**
Dado una validación previa completada, cuando se verifica el pipeline de auditoría, entonces existe un evento con `operation_type: "pre_flight_check"`, actor, tenant_id destino, tenant_id origen, dominios analizados, resumen de conflictos por severidad, riesgo global, timestamp y correlation-id.

**CA-16 — Concurrencia sin restricción**
Dado dos validaciones previas simultáneas sobre el mismo tenant, cuando ambas se ejecutan, entonces ambas completan correctamente sin interferencia.

---

## 7. Riesgos, supuestos y preguntas abiertas

### 7.1 Riesgos

| ID | Descripción | Probabilidad | Impacto | Mitigación sugerida |
|---|---|---|---|---|
| R-01 | La clasificación de severidad puede ser subjetiva y requerir ajustes iterativos basados en la experiencia operativa | Alta | Medio | Definir una tabla de severidad por tipo de recurso y tipo de diferencia como configuración, no como código hardcodeado. Permitir que la tabla evolucione sin cambios de código. |
| R-02 | Los subsistemas pueden tener latencia alta para operaciones de lectura al comparar muchos recursos, afectando el tiempo de respuesta del endpoint | Media | Medio | Aplicar timeouts por dominio consistentes con los del dry-run de T03. Considerar paralelizar el análisis de dominios cuando sea posible. |
| R-03 | Las recomendaciones de texto por tipo de conflicto pueden no cubrir todos los casos edge desde la primera iteración | Media | Bajo | Incluir una recomendación genérica de fallback cuando no haya una específica para el tipo de conflicto. Iterar las recomendaciones basándose en feedback operativo. |
| R-04 | La reutilización de credenciales de lectura de T01 (`CONFIG_EXPORT_*`) asume que esas credenciales tienen acceso a todos los subsistemas en modo lectura para el tenant destino, no solo para el tenant de origen | Media | Medio | Verificar que las credenciales de lectura son cross-tenant o que se pueden parametrizar por tenant destino. |

### 7.2 Supuestos

**S-01**: El tenant destino existe y ha sido creado previamente por US-TEN-04.

**S-02**: Los comparadores de T03 (`diff.mjs`) son reutilizables como base para la clasificación de conflictos. La validación previa extiende esa comparación añadiendo severidad y recomendación, sin duplicar la lógica de equivalencia.

**S-03**: Las APIs de lectura de cada subsistema soportan la inspección del estado actual de los recursos del tenant destino con las credenciales de servicio configuradas.

**S-04**: El pipeline de auditoría (US-OBS-01) acepta eventos de validación previa con la misma interfaz usada por exportación (T01) y reaprovisionamiento (T03), diferenciando por `operation_type`.

**S-05**: La tabla de clasificación de severidad (RN-T04-02) es suficiente para la primera iteración y puede refinarse basándose en feedback operativo.

### 7.3 Preguntas abiertas

**P-01 — ¿La tabla de severidad debe ser configurable externamente (ej: YAML/JSON) o puede ser código?**
La especificación sugiere que sea configuración para facilitar la evolución. La decisión final se tomará en la fase de plan.
*No bloquea la especificación.*

**P-02 — ¿Los analizadores de dominio deben ejecutarse en paralelo o secuencialmente?**
La ejecución en paralelo reduciría la latencia total, pero aumenta la complejidad de manejo de errores. La validación previa de T03 (dry-run) ejecuta los aplicadores secuencialmente.
*No bloquea la especificación; puede resolverse en plan/implementación.*

---

## Assumptions

- El artefacto de exportación (T01) contiene toda la información funcional necesaria para comparar contra el estado del tenant destino.
- La lógica de comparación de equivalencia de T03 (`diff.mjs`, `compareResources`, `buildDiff`) está disponible y es reutilizable.
- El endpoint de generación de mapa de identificadores de T03 está disponible y funcional.
- Las credenciales de lectura para cada subsistema están configuradas y permiten inspeccionar el estado de cualquier tenant destino.

---

*Documento generado para el stage `speckit.specify` — US-BKP-02-T04 | Rama: `118-export-conflict-prechecks`*
