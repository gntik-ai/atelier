# Research — US-BKP-02-T04: Validaciones previas para detectar conflictos entre export existente y entorno destino

**Branch**: `118-export-conflict-prechecks` | **Date**: 2026-04-01
**Task ID**: US-BKP-02-T04 | **Stage**: `speckit.plan`

---

## 1. Pregunta de investigación

¿Cómo implementar un servicio de pre-flight check de conflictos entre un artefacto de exportación y el estado actual de un tenant destino, reutilizando la infraestructura de T03 al máximo y añadiendo clasificación de severidad y recomendaciones accionables?

---

## 2. Dependencias de T03 reutilizables

### 2.1 `reprovision/diff.mjs`

T03 ya implementa `compareResources`, `resolveAction` y `buildDiff`. Estos tres helpers son exactamente lo que necesitan los analizadores de T04:
- `compareResources(existing, desired, ignoreKeys)` → `'equal' | 'different'`.
- `buildDiff(existing, desired)` → objeto con solo los campos que difieren.

Los analizadores de T04 **importan directamente** estos helpers. No los duplican.

### 2.2 `reprovision/identifier-map.mjs`

`applyIdentifierMap` y `validateIdentifierMap` de T03 se reutilizan sin modificación. Si el `tenant_id` del artefacto difiere del destino, el endpoint de T04 invoca `buildProposedIdentifierMap` (también de T03) y responde con la propuesta antes de ejecutar el análisis.

### 2.3 Credenciales de lectura `CONFIG_EXPORT_*`

Los recolectores de T01 ya usan credenciales de solo lectura para cada subsistema. Los analizadores de T04 reutilizan las mismas variables de entorno (`CONFIG_EXPORT_KEYCLOAK_*`, `CONFIG_EXPORT_PG_*`, etc.). No se requieren nuevas credenciales de servicio.

### 2.4 Scope de Keycloak

T03 ya registró el scope `platform:admin:config:reprovision`. T04 lo reutiliza sin añadir un scope nuevo. La decisión se basa en que la validación previa es parte de la cadena de reaprovisionamiento y debe requerir la misma autorización para evitar que actores no autorizados inspeccionen el estado detallado de un tenant.

---

## 3. Decisiones de diseño clave

### 3.1 Parallelismo de analizadores vs. secuencial de T03

Los aplicadores de T03 se ejecutan **secuencialmente** porque:
- Algunos dominios tienen dependencias de orden (IAM antes que funciones que usan roles IAM).
- Un fallo en un dominio early puede afectar la coherencia de los aplicadores siguientes.

Los analizadores de T04 se ejecutan **en paralelo** porque:
- La validación previa es read-only; no hay riesgo de estado inconsistente entre dominios.
- El objetivo es minimizar la latencia total (< 30 s para 50 recursos/dominio con 6 dominios).
- `Promise.allSettled` garantiza que todos los analizadores completan (o fallan) independientemente.

### 3.2 No adquirir el lock de T03

La validación previa no necesita exclusividad. Múltiples análisis simultáneos sobre el mismo tenant son seguros porque no modifican ningún recurso. Adquirir el lock de T03 introduciría un cuello de botella innecesario y violaría `RN-T04-12` de la especificación.

### 3.3 Tabla de severidad como datos, no como código

La clasificación de severidad podría implementarse como una cadena de `if/else` o `switch`. Se optó por una tabla de datos (`SEVERITY_TABLE`) porque:
- Facilita la evolución sin cambios de código (la tabla podría cargarse desde un archivo YAML en el futuro).
- Es trivialmente testeable: los tests verifican la tabla, no la lógica de ramificación.
- El fallback a `'medium'` para pares no mapeados es explícito y conservador.
- La tabla por dominio refleja la estructura del artefacto de exportación.

### 3.4 Motor de recomendaciones por lookup

Las recomendaciones se implementan como un árbol de lookup `RECOMMENDATIONS[domain][resource_type][severity]` en lugar de funciones generadoras. Ventajas:
- Las recomendaciones son texto revisable sin cambiar lógica.
- La interpolación de `{resource_name}` es mínima y controlada.
- El fallback genérico evita excepciones si una combinación no está mapeada.

### 3.5 HTTP 200 para todos los casos de éxito (incluidos parciales)

T03 podría devolver `207` para reprovisionamientos parciales. T04 usa siempre `200` porque:
- La validación previa no tiene efectos secundarios; no hay "partial success" en el sentido de que algunos recursos se modificaron y otros no.
- El flag `incomplete_analysis: true` en el informe comunica la parcialidad con suficiente precisión.
- Un pipeline automatizado puede evaluar `risk_level` e `incomplete_analysis` sin necesidad de interpretar códigos HTTP adicionales.

### 3.6 `compatible_with_redacted_fields` como status propio

En lugar de simplemente ignorar los campos redactados durante la comparación, se introduce un status explícito `compatible_with_redacted_fields` para que el operador sepa que un recurso no se comparó completamente. Esto es más informativo que silenciar los campos redactados sin visibilidad.

---

## 4. Patrones del proyecto aplicados

### 4.1 `Promise.allSettled` para análisis paralelo

El mismo patrón es usado por otros módulos del proyecto para operaciones de lectura paralelas sobre múltiples subsistemas. El patrón garantiza que todos los resultados (exitosos y fallidos) están disponibles antes de continuar, sin cortar el análisis ante el primer fallo.

### 4.2 `withTimeout(promise, ms, label)`

Helper de timeout ya existente en el proyecto (identificado en el contexto de T03). Se aplica por analizador con `CONFIG_PREFLIGHT_ANALYZER_TIMEOUT_MS` como valor configurable.

### 4.3 Auditoría fire-and-forget para Kafka

El evento Kafka se publica con el patrón fire-and-forget ya establecido en T03 (`publishReprovisionCompleted`). Los errores de Kafka se capturan, se loguean y se suprimen para no abortar la respuesta HTTP.

### 4.4 Credenciales inyectadas por DI en los analizadores

Los analizadores aceptan un objeto `options.credentials` para facilitar los tests unitarios con credenciales mock. En producción, la action construye el objeto credentials a partir de las variables de entorno.

---

## 5. Investigación de compatibilidad con T03

### 5.1 Impacto de T04 sobre T03

**Cero modificaciones a T03**. La validación previa es una feature puramente aditiva. No modifica:
- `reprovision/diff.mjs` — solo importa.
- `reprovision/identifier-map.mjs` — solo importa.
- La tabla de locks de T03 — no accede.
- Los aplicadores de T03 — no invoca.
- Los contratos de T03 (`contracts/tenant-config-reprovision.json`) — no modifica.
- El scope de Keycloak de T03 — no modifica.

### 5.2 Diferencias entre analizadores de T04 y aplicadores de T03

| Aspecto | Aplicadores T03 | Analizadores T04 |
|---|---|---|
| Modo | Lectura + escritura | Solo lectura |
| Lock | Requiere lock de concurrencia | No requiere lock |
| Ejecución | Secuencial (orden canónico) | Paralela (`Promise.allSettled`) |
| Resultado por recurso | action (created/skipped/conflict/error) | status (compatible/compatible_with_redacted/conflict) |
| Clasificación adicional | Ninguna | Severidad + recomendación por conflicto |
| Credenciales | `CONFIG_IMPORT_*` (lectura + escritura) | `CONFIG_EXPORT_*` (solo lectura) |
| Efectos secundarios | Crea/modifica recursos en subsistemas | Ninguno |

---

## 6. Preguntas resueltas vs. abiertas de la spec

### P-01 — ¿La tabla de severidad debe ser configurable externamente?

**Decisión**: La tabla se implementa como una constante exportable en `conflict-classifier.mjs`. En la primera iteración es código; en el futuro puede cargarse desde un archivo YAML sin cambiar la firma de la función. Esta decisión no bloquea la implementación.

### P-02 — ¿Los analizadores deben ejecutarse en paralelo o secuencialmente?

**Decisión**: En paralelo con `Promise.allSettled`. Ver sección 3.1.

---

## 7. Gaps y riesgos identificados

- **R-03 (credenciales cross-tenant)**: Las credenciales `CONFIG_EXPORT_*` pueden estar configuradas solo para el tenant propietario, no para todos los tenants. El implementador debe verificar que las credenciales de lectura son cross-tenant o que se pueden parametrizar por `tenant_id` destino antes de desarrollar los analizadores. Si no son cross-tenant, se necesitarán credenciales nuevas específicas para preflight.

- **Analizador MongoDB y OpenWhisk deshabilitados por defecto**: Al igual que en T03, los analizadores de MongoDB (`CONFIG_PREFLIGHT_MONGO_ENABLED`) y OpenWhisk (`CONFIG_PREFLIGHT_OW_ENABLED`) están deshabilitados por defecto en el registro. Los dominios correspondientes se marcan como `skipped_not_exportable` con mensaje `'analyzer_not_enabled'` cuando los flags están en `false`.

- **Tiempo de análisis en tenants grandes**: Con más de 50 recursos por dominio, el análisis puede exceder los 10 s por analizador. El timeout configurable mitiga esto, pero tenants con cientos de recursos podrían requerir ajuste del timeout.
