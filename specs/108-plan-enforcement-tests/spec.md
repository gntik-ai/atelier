# Especificación — US-PLAN-02-T06: Pruebas de Enforcement Coherente de Capabilities y Cuotas por Plan

| Campo               | Valor                                                                 |
|---------------------|-----------------------------------------------------------------------|
| **Task ID**         | US-PLAN-02-T06                                                        |
| **Epic**            | EP-19 — Planes, límites y packaging del producto                      |
| **Historia**        | US-PLAN-02 — Hard/soft quotas, capabilities booleanas, overrides y visualización de consumo |
| **Tipo**            | Feature                                                               |
| **Prioridad**       | P0                                                                    |
| **Tamaño**          | M                                                                     |
| **RFs cubiertos**   | RF-PLAN-005, RF-PLAN-006, RF-PLAN-007, RF-PLAN-008 (validación transversal) |
| **Dependencias**    | US-PLAN-02-T01 (103), US-PLAN-02-T02 (104), US-PLAN-02-T03 (105), US-PLAN-02-T04 (106), US-PLAN-02-T05 (107) |

---

## 1. Objetivo y problema que resuelve

### Problema

Las tareas T01–T05 de US-PLAN-02 implementan, cada una por separado, piezas del sistema de enforcement de planes:

- **T01**: cuotas hard/soft con overrides por superadmin.
- **T02**: capabilities booleanas por plan y catálogo de capabilities.
- **T03**: resolución de límites efectivos (plan + overrides + subcuotas de workspace).
- **T04**: visualización de consumo y plan activo en la consola.
- **T05**: enforcement activo de capabilities en gateway (Lua plugin), control-plane (middleware) y consola (React UI gating).

Sin embargo, **no existe ningún artefacto que valide la coherencia end-to-end entre todas estas capas**. Cada tarea puede tener sus propias pruebas unitarias o de integración local, pero nadie verifica que:

1. Un cambio de plan se propague correctamente desde la base de datos → resolución de límites efectivos → gateway Lua plugin → consola React → y que los eventos de auditoría se generen con los campos esperados.
2. Un override de superadmin altere el enforcement en gateway, middleware y UI de forma consistente.
3. Una subcuota de workspace respete los límites del tenant y se aplique correctamente en el gateway.
4. La consola muestre exactamente las mismas capabilities que el gateway permite o bloquea.

Este vacío deja al producto expuesto a:

- **Desincronización silenciosa**: una capa permite lo que otra bloquea.
- **Regresiones cross-layer**: un cambio en el modelo de datos rompe el enforcement en gateway sin que ninguna prueba lo detecte.
- **Falsa confianza**: pruebas unitarias pasan pero el comportamiento integrado es incorrecto.

### Objetivo de esta tarea

Crear una **suite de pruebas automatizadas** que valide la coherencia del enforcement de capabilities booleanas y cuotas cuantitativas a través de las cuatro capas del stack: gateway APISIX (Lua plugin `capability-enforcement`), control-plane (provisioning-orchestrator middleware/actions), consola web (React + shadcn/ui), y auditoría (eventos Kafka/PostgreSQL). Las pruebas cubren escenarios de estado estable, transiciones (cambios de plan, overrides, subcuotas) y condiciones de degradación.

---

## 2. Usuarios y valor recibido

| Actor | Valor que recibe |
|---|---|
| **Equipo de desarrollo** | Confianza en que las capas del enforcement se comportan de forma coherente tras cada cambio. Red de seguridad contra regresiones cross-layer. |
| **QA / Release engineering** | Suite ejecutable como gate de CI/CD que bloquea releases con enforcement incoherente. |
| **Product Ops / Superadmin** | Garantía de que los cambios de plan, overrides y subcuotas se aplican correctamente en todo el producto, no solo en una capa aislada. |
| **Tenant owner / Workspace admin** | Experiencia fiable: lo que la consola muestra como bloqueado es realmente bloqueado en la API, y viceversa. |
| **Equipo de soporte** | Reducción de tickets causados por inconsistencias entre lo que el tenant ve y lo que el sistema permite. |

---

## 3. Escenarios principales, edge cases y reglas de negocio

### 3.1 Escenarios principales de prueba

**E1 — Coherencia de capability booleana: gateway ↔ consola**

> Dado un tenant en plan `Starter` con `webhooks: false`, la prueba verifica que:
> (a) el gateway Lua plugin rechaza `POST /webhooks` con `HTTP 402` y cuerpo JSON estandarizado,
> (b) la consola React deshabilita/oculta la sección de webhooks con indicador de restricción de plan, y
> (c) ambas respuestas referencian la misma capability (`webhooks`) y el mismo motivo (`plan_restriction`).

**E2 — Override habilita capability: propagación completa**

> Dado un tenant en plan `Starter` con `realtime: false` y un override activo `realtime: true`:
> (a) el contrato de capabilities efectivas retorna `realtime: true`,
> (b) el gateway permite las rutas de realtime,
> (c) la consola habilita las opciones de realtime, y
> (d) un evento de auditoría NO se genera para rutas de realtime (porque no hay rechazo).

**E3 — Override restrictivo: bloqueo coherente**

> Dado un tenant en plan `Pro` con `sql_admin_api: true` y un override restrictivo `sql_admin_api: false`:
> (a) el contrato de capabilities retorna `sql_admin_api: false`,
> (b) el gateway rechaza `/admin/sql`,
> (c) la consola deshabilita la opción de SQL admin,
> (d) se genera un evento de auditoría con `reason: override_restriction`.

**E4 — Cuota hard: gateway + middleware + consola**

> Dado un tenant con cuota hard `max_pg_databases: 5` y consumo actual de 5:
> (a) el middleware de control-plane rechaza la creación de un sexto database con `QUOTA_HARD_LIMIT_REACHED`,
> (b) la consola muestra la cuota como agotada con indicador visual correspondiente,
> (c) se genera un evento de auditoría de enforcement.

**E5 — Cambio de plan (downgrade): propagación temporal**

> Un tenant pasa de `Pro` a `Starter`. Dentro del TTL de propagación configurado:
> (a) las capabilities revocadas por el downgrade dejan de estar activas en el contrato,
> (b) el gateway rechaza las rutas asociadas a capabilities revocadas,
> (c) la consola refleja el nuevo estado,
> (d) las cuotas cuantitativas reflejan los nuevos límites del plan `Starter`.

**E6 — Subcuota de workspace: coherencia con límite del tenant**

> Dado un tenant con `max_pg_databases: 10` y workspace `ws-prod` con subcuota de `6`:
> (a) la resolución de límites efectivos del workspace retorna `6`,
> (b) el enforcement bloquea la creación del séptimo database en `ws-prod`,
> (c) la consola del workspace muestra `6` como límite, no `10`.

**E7 — Deny-by-default bajo degradación del servicio de capabilities**

> Cuando el servicio de resolución de capabilities no está disponible (timeout/5xx):
> (a) el gateway rechaza solicitudes a rutas capability-gated (deny-by-default),
> (b) se genera un evento de degradación observable,
> (c) la consola muestra un estado degradado o de error, no capabilities falsamente habilitadas.

**E8 — Coherencia de auditoría end-to-end**

> Para cada rechazo de enforcement (capability o cuota), se verifica que existe un evento de auditoría con todos los campos requeridos: `tenant_id`, `workspace_id`, `capability` o `dimension`, `reason`, `channel`, `actor_id`, `actor_type`, `resource_path`, `timestamp`, `request_id`.

### 3.2 Edge cases de prueba

| Caso | Comportamiento esperado verificado por la prueba |
|---|---|
| Tenant sin plan asignado | Todas las capabilities en `false`, todas las cuotas en valor por defecto del catálogo. Gateway bloquea todo lo capability-gated. Consola no muestra funciones premium. |
| Override que habilita lo que el plan ya incluye | Idempotente: capability sigue activa. No se genera inconsistencia. |
| Cambio de plan que reduce cuota por debajo de subcuotas existentes | Las subcuotas se marcan como inconsistentes (warning), pero no se revocan automáticamente. La consola muestra la advertencia. |
| Dos requests concurrentes con 1 unidad de cuota restante | Exactamente uno tiene éxito, el otro es rechazado. No hay sobre-asignación. |
| Capability evaluada a nivel tenant, no workspace | Boolean capabilities no son segmentables por workspace; la prueba verifica que workspace-level no altera el enforcement de capabilities. |
| Ruta que requiere múltiples capabilities | Si cualquiera está deshabilitada, el conjunto se rechaza. |
| Cambio de plan con efectividad futura (fecha programada) | Antes de la fecha efectiva, enforcement del plan vigente. Después, enforcement del nuevo plan. |
| Caché del gateway con TTL expirado vs. no expirado | Dentro del TTL, el gateway usa datos cacheados. Tras expiración, refresca desde el contrato de capabilities. |

### 3.3 Reglas de negocio validadas por las pruebas

**RN-V01 — Fuente única de verdad**: El contrato de capabilities efectivas (T03/T05) es el único input para todos los puntos de enforcement. Las pruebas verifican que gateway, middleware y consola consumen el mismo contrato y producen decisiones consistentes.

**RN-V02 — Deny-by-default es universal**: Ante fallo de resolución, ninguna capa permite acceso a recursos capability-gated. Las pruebas inyectan fallos y verifican el bloqueo en todas las capas.

**RN-V03 — El rechazo es informativo en todas las capas**: El gateway, el middleware y la consola exponen la misma capability/dimensión bloqueada y razón. Las pruebas comparan los payloads de rechazo entre capas.

**RN-V04 — Auditoría completa por cada enforcement**: Todo rechazo genera exactamente un evento de auditoría con schema completo. Las pruebas verifican la existencia y completitud del evento tras cada rechazo.

**RN-V05 — Propagación temporal acotada**: Tras un cambio de plan/override/subcuota, el enforcement refleja el cambio dentro del TTL configurado. Las pruebas miden el tiempo de propagación.

---

## 4. Requisitos funcionales y límites de alcance

### 4.1 Requisitos funcionales verificables

**RF-T06-01 — Suite de pruebas de coherencia gateway ↔ control-plane**
Debe existir una suite automatizada que, para cada capability booleana del catálogo, verifique que el veredicto del gateway Lua plugin coincide con el veredicto del middleware de control-plane para un mismo tenant y estado de plan/overrides.

**RF-T06-02 — Suite de pruebas de coherencia gateway ↔ consola**
Debe existir una suite automatizada que, para cada capability booleana, verifique que el estado de habilitación/deshabilitación en la consola React coincide con el veredicto del gateway. La prueba puede usar Playwright o testing-library para verificar el estado del DOM de componentes capability-gated.

**RF-T06-03 — Suite de pruebas de coherencia cuota ↔ middleware ↔ consola**
Debe existir una suite automatizada que verifique que para cuotas hard y soft, el middleware de enforcement y la consola reflejan el mismo estado (agotado, en gracia, disponible) para un tenant dado.

**RF-T06-04 — Pruebas de transición de plan**
Debe existir una suite que simule cambios de plan (upgrade, downgrade) y verifique que todas las capas reflejan el nuevo estado dentro del TTL de propagación configurado.

**RF-T06-05 — Pruebas de override (habilitación y restricción)**
Debe existir una suite que cree, modifique y revoque overrides de capabilities y cuotas, verificando la propagación coherente a gateway, middleware y consola.

**RF-T06-06 — Pruebas de subcuota de workspace**
Debe existir una suite que asigne subcuotas a workspaces y verifique que el enforcement a nivel workspace respeta la subcuota asignada, no el límite del tenant.

**RF-T06-07 — Pruebas de degradación (deny-by-default)**
Debe existir una suite que simule fallos del servicio de resolución de capabilities/cuotas y verifique que todas las capas aplican deny-by-default.

**RF-T06-08 — Pruebas de auditoría de enforcement**
Para cada escenario de rechazo, la suite debe verificar que existe exactamente un evento de auditoría con schema completo en el sistema de auditoría (PostgreSQL/Kafka).

**RF-T06-09 — Pruebas de concurrencia**
Debe existir al menos una prueba que envíe N requests concurrentes con 1 unidad de cuota restante y verifique que exactamente 1 tiene éxito y N-1 son rechazados.

**RF-T06-10 — Pruebas de caché y TTL del gateway**
Debe existir una suite que verifique que el plugin Lua `capability-enforcement` respeta el TTL configurado (`cache_ttl_seconds`) y refresca los datos tras expiración.

**RF-T06-11 — Integración con CI/CD**
La suite de pruebas debe ser ejecutable como paso de pipeline CI/CD y producir resultados en formato compatible con los runners del proyecto (exit code 0/1, reporte estructurado).

### 4.2 Límites claros de alcance

**Incluido en US-PLAN-02-T06:**
- Diseño y creación de la suite de pruebas automatizadas de coherencia cross-layer.
- Fixtures y helpers para configurar escenarios de plan, capabilities, cuotas, overrides y subcuotas.
- Pruebas de propagación temporal (TTL).
- Pruebas de degradación y deny-by-default.
- Pruebas de concurrencia para cuotas.
- Pruebas de auditoría de enforcement.
- Integración con pipeline CI/CD.

**Excluido (implementado en otras tareas):**
- Implementación del modelo de cuotas hard/soft → **T01** (103)
- Implementación del catálogo y asignación de capabilities booleanas → **T02** (104)
- Implementación de la resolución de límites efectivos → **T03** (105)
- Implementación de la visualización en consola → **T04** (106)
- Implementación del enforcement activo en gateway/middleware/UI → **T05** (107)

---

## 5. Permisos, aislamiento multi-tenant, auditoría, seguridad y trazabilidad

### 5.1 Aislamiento multi-tenant en las pruebas

- Cada escenario de prueba debe usar tenants y workspaces aislados (fixtures dedicados por test o grupo de tests).
- Las pruebas deben verificar explícitamente que el enforcement de un tenant **no afecta** al enforcement de otro tenant (pruebas de aislamiento negativo).
- Los fixtures no deben compartir estado mutable entre tests para evitar contaminación cross-test.

### 5.2 Permisos verificados por las pruebas

| Verificación | Detalle |
|---|---|
| Un tenant no puede ver capabilities de otro tenant | La prueba consulta el contrato de capabilities con token de tenant A y verifica que no hay datos de tenant B. |
| Un workspace admin no puede crear recursos más allá de la subcuota de su workspace | La prueba autentica como workspace admin y verifica el rechazo al exceder la subcuota. |
| Un superadmin puede crear overrides y ver capabilities de cualquier tenant | La prueba autentica como superadmin y verifica acceso cross-tenant para operaciones de gestión. |

### 5.3 Auditoría verificada por las pruebas

Las pruebas de RF-T06-08 verifican que cada evento de rechazo contiene:

```
tenant_id        : UUID del tenant
workspace_id     : UUID del workspace (si aplica)
actor_id         : identificador del usuario o token de servicio
actor_type       : user | service_account
capability       : nombre de la capability bloqueada (para enforcement de capabilities)
dimension        : nombre de la dimensión de cuota (para enforcement de cuotas)
reason           : plan_restriction | override_restriction | hard_limit_reached | soft_limit_grace_exhausted | plan_unresolvable
channel          : gateway | console | internal_api
resource_path    : ruta del recurso solicitado
timestamp        : ISO 8601 UTC
request_id       : identificador de correlación
```

### 5.4 Seguridad verificada por las pruebas

- Las pruebas verifican que el contrato de capabilities requiere autenticación (requests sin token válido reciben 401).
- Las pruebas verifican que bajo deny-by-default, ninguna capa filtra información sensible sobre el motivo interno del fallo de resolución.
- Las pruebas verifican que credenciales de servicio del gateway tienen acceso de solo lectura al contrato de capabilities.

### 5.5 Trazabilidad con el backlog

| Requisito funcional del backlog | Pruebas que lo validan transversalmente |
|---|---|
| RF-PLAN-005 (Contrato de capabilities) | RF-T06-01, RF-T06-02, RF-T06-04, RF-T06-05 |
| RF-PLAN-006 (Enforcement en gateway) | RF-T06-01, RF-T06-02, RF-T06-07, RF-T06-10 |
| RF-PLAN-007 (Enforcement en consola) | RF-T06-02, RF-T06-03, RF-T06-04 |
| RF-PLAN-008 (Auditoría de enforcement) | RF-T06-08 |
| RF-OBS-009–015 (Cuotas y metering) | RF-T06-03, RF-T06-06, RF-T06-09 |

---

## 6. Criterios de aceptación

**CA-01 — Coherencia gateway ↔ control-plane para capabilities**
Para cada capability booleana del catálogo, existe al menos un test automatizado que configura un tenant con esa capability deshabilitada, verifica que el gateway rechaza la ruta asociada, y verifica que el middleware de control-plane también la rechaza. Y viceversa para capability habilitada.

**CA-02 — Coherencia gateway ↔ consola para capabilities**
Para cada capability booleana del catálogo, existe al menos un test que verifica que si el gateway bloquea una ruta, la consola deshabilita/oculta el elemento UI correspondiente. Y si el gateway permite, la consola habilita.

**CA-03 — Coherencia cuota hard ↔ middleware ↔ consola**
Para al menos 3 dimensiones de cuota distintas, existe un test que lleva el consumo al límite hard, verifica el rechazo en middleware, y verifica que la consola refleja la cuota como agotada.

**CA-04 — Propagación de cambio de plan**
Existe un test end-to-end que cambia un tenant de plan Pro a Starter, espera el TTL configurado, y verifica que las capabilities revocadas están bloqueadas en gateway y deshabilitadas en consola.

**CA-05 — Override de capability se propaga a todas las capas**
Existe un test que crea un override habilitando una capability, verifica la propagación al gateway y consola, y luego revoca el override verificando el bloqueo en ambas capas.

**CA-06 — Subcuota de workspace se aplica correctamente**
Existe un test que asigna una subcuota a un workspace, lleva el consumo al límite de la subcuota, y verifica el rechazo. Verifica también que otro workspace del mismo tenant con más cuota disponible aún puede crear recursos.

**CA-07 — Deny-by-default ante fallo de resolución**
Existe un test que simula indisponibilidad del servicio de capabilities y verifica que el gateway rechaza requests a rutas capability-gated y que la consola no muestra capabilities como activas.

**CA-08 — Auditoría completa por cada rechazo**
Para cada tipo de rechazo probado (capability bloqueada, cuota hard, cuota soft grace exhausted, deny-by-default), la suite verifica que existe un evento de auditoría con todos los campos del schema definido en §5.3.

**CA-09 — Concurrencia segura**
Existe un test que envía ≥10 requests concurrentes con 1 unidad de cuota restante y verifica que exactamente 1 tiene éxito y el resto son rechazados con `QUOTA_HARD_LIMIT_REACHED`.

**CA-10 — Caché TTL del gateway**
Existe un test que modifica una capability, verifica que el gateway sigue usando el valor cacheado dentro del TTL, y tras expiración del TTL verifica que el gateway refleja el nuevo valor.

**CA-11 — La suite se ejecuta en CI/CD**
La suite completa es ejecutable con un solo comando, produce exit code 0 cuando todas las pruebas pasan y exit code 1 cuando alguna falla, y genera un reporte parseable (JUnit XML, JSON, o TAP).

**CA-12 — Aislamiento multi-tenant verificado**
Existe al menos un test que configura dos tenants con planes distintos y verifica que el enforcement de cada uno es independiente: cambiar el override del tenant A no afecta al tenant B.

---

## 7. Riesgos, supuestos y preguntas abiertas

### 7.1 Riesgos

| ID | Descripción | Probabilidad | Impacto | Mitigación |
|---|---|---|---|---|
| R-01 | Las pruebas E2E que cruzan gateway + middleware + consola requieren un entorno de integración completo (APISIX + Keycloak + PostgreSQL + React), lo que puede dificultar la ejecución local y en CI | Alta | Alto | Definir un docker-compose de integración mínimo. Separar la suite en niveles: unit mocks, integration con servicios reales, E2E con consola. |
| R-02 | Los tests de TTL/propagación son inherentemente temporales y pueden ser flaky | Media | Medio | Usar TTL cortos en entorno de test (ej. 2-5s). Implementar retry con backoff en las verificaciones de propagación en lugar de `sleep` fijos. |
| R-03 | Las pruebas de concurrencia pueden ser no deterministas en entornos con recursos limitados | Media | Medio | Ejecutar las pruebas de concurrencia con configuración controlada (connection pool, timeouts explícitos). Aceptar tolerancia mínima documentada. |
| R-04 | Dependencia fuerte en que T01–T05 estén completas antes de poder escribir tests reales | Alta | Alto | Diseñar los fixtures y helpers primero usando contratos/interfaces documentados. Implementar tests contra mocks inicialmente, migrar a integración real cuando T01–T05 estén disponibles. |

### 7.2 Supuestos

**S-01**: T01–T05 estarán implementadas y funcionales cuando esta suite se ejecute en integración. Los tests se diseñan contra los contratos especificados en las specs 103–107.

**S-02**: El proyecto dispone o dispondrá de un entorno de integración (docker-compose o equivalente) que levanta APISIX, Keycloak, PostgreSQL, el provisioning-orchestrator y la consola React.

**S-03**: El plugin Lua `capability-enforcement` ya existe en `services/gateway-config/plugins/capability-enforcement.lua` y consume el mapa de rutas YAML y el contrato HTTP de capabilities efectivas.

**S-04**: Los tests de consola pueden ejecutarse con Playwright o testing-library/react contra la aplicación en `apps/web-console/`.

**S-05**: Los eventos de auditoría son consultables vía la acción `scope-enforcement-audit-query` del provisioning-orchestrator o directamente en PostgreSQL.

### 7.3 Preguntas abiertas

No se identifican preguntas que bloqueen el inicio del diseño de la suite. Las decisiones pendientes de P-01 (TTL máximo) y P-03 (código HTTP canónico) de la spec T05 afectan a los valores esperados en las assertions, pero la estructura de los tests es independiente de esos valores concretos — se parametrizan con constantes configurables.

---

*Documento generado para el stage `speckit.specify` — US-PLAN-02-T06 | Rama: `108-plan-enforcement-tests`*
