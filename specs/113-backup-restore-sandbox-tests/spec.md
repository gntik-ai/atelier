# Especificación — US-BKP-01-T05: Pruebas y simulaciones de restore en entornos de integración/sandbox

| Campo               | Valor                                                                 |
|---------------------|-----------------------------------------------------------------------|
| **Task ID**         | US-BKP-01-T05                                                         |
| **Epic**            | EP-20 — Backup, recuperación y continuidad operativa                  |
| **Historia**        | US-BKP-01 — Estado de backup/restore y flujos administrativos de recuperación |
| **Tipo**            | Feature                                                               |
| **Prioridad**       | P1                                                                    |
| **Tamaño**          | M                                                                     |
| **RFs cubiertos**   | RF-BKP-001, RF-BKP-002, RF-BKP-005                                   |
| **Dependencias**    | US-BKP-01-T01, US-BKP-01-T02, US-BKP-01-T03, US-BKP-01-T04           |

---

## 1. Objetivo y problema que resuelve

### Problema

Tras US-BKP-01-T02, la plataforma permite iniciar backups y solicitar restauraciones. Tras US-BKP-01-T03 y US-BKP-01-T04, esas acciones ya son trazables y están protegidas por auditoría y confirmación reforzada. Sin embargo, **todavía no existe una capacidad explícita para probar y simular restores en entornos seguros de integración o sandbox** antes de llevar cambios al camino operativo real.

Esto deja varios huecos prácticos:

1. **No hay un drill de restore reproducible.** Los equipos de plataforma necesitan validar que un snapshot realmente puede restaurarse sin tener que hacerlo en producción o en un tenant real.
2. **No hay una forma estándar de ejecutar pruebas de regresión.** Cada despliegue, cambio de proveedor o ajuste de configuración puede afectar a la restauración, pero hoy esas validaciones dependen de procesos manuales y ad hoc.
3. **No hay evidencia funcional del resultado de la prueba.** Aunque un restore funcione técnicamente, la plataforma no ofrece una vista unificada del resultado, de las comprobaciones ejecutadas ni de las desviaciones detectadas.
4. **No hay aislamiento claro entre ensayo y operación.** Cuando una prueba se mezcla con un flujo real, el riesgo de error aumenta y es difícil distinguir una simulación de una restauración efectiva.

### Objetivo de esta tarea

Introducir una capacidad funcional para **ejecutar pruebas y simulaciones de restore únicamente en entornos de integración o sandbox**, con aislamiento explícito respecto a producción. La tarea cubre:

- el lanzamiento de simulaciones o drills de restore sobre snapshots o copias de prueba,
- la ejecución de comprobaciones post-restore sobre el entorno objetivo,
- la presentación del resultado y de la evidencia asociada,
- y la protección explícita contra cualquier intento de usar esta capacidad sobre un entorno productivo.

El resultado es que SRE, superadmin y automatizaciones de QA pueden validar restores de forma repetible, segura y auditable, sin tocar tenants reales ni alterar datos de producción.

---

## 2. Usuarios afectados y valor recibido

| Actor | Relación con la capacidad | Valor que recibe |
|---|---|---|
| **SRE / Platform team** | Ejecuta drills de restore y valida preparación operativa | Puede comprobar que un backup realmente es restaurable antes de necesitarlo en un incidente. |
| **Superadmin** | Valida la capacidad de recuperación de forma transversal | Puede revisar el comportamiento del restore en sandboxes controladas sin afectar tenants reales. |
| **QA / automatización de integración** | Consume la simulación como prueba de regresión | Puede incorporar simulaciones de restore en pipelines y suites de validación. |
| **Equipo de seguridad / cumplimiento** | Revisa evidencia de pruebas de recuperación | Puede verificar que existen controles y resultados documentados para restores ensayados. |
| **Tenant owner** | Consumidor indirecto | Se beneficia de que la recuperación se pruebe antes de una incidencia real, reduciendo riesgo operativo. |

---

## 3. Escenarios principales, edge cases y reglas de negocio

### 3.1 Escenarios principales

**E1 — SRE ejecuta una simulación de restore en sandbox**

> Un SRE selecciona un snapshot de un componente gestionado y elige un entorno sandbox o de integración previamente habilitado. La plataforma crea una simulación de restore que usa un objetivo desechable o aislado, ejecuta la restauración de prueba y muestra el resultado con un resumen claro: si el restore se pudo completar, qué comprobaciones posteriores pasaron y si hubo diferencias con el estado esperado.

**E2 — QA automatiza un drill de restore en integración**

> Un pipeline de integración dispara una simulación de restore sobre datos de prueba. La plataforma devuelve un identificador de ejecución y, al finalizar, expone el estado de la simulación, el resultado de las comprobaciones y la evidencia de la corrida para su uso en regresión.

**E3 — Superadmin revisa una simulación fallida**

> Un superadmin consulta el historial de simulaciones y ve que una prueba de restore falló porque el snapshot estaba incompleto o porque el entorno sandbox no estaba preparado. El detalle le permite distinguir un problema de datos, de configuración o de disponibilidad del entorno.

**E4 — Intento de usar la capacidad sobre un entorno de producción**

> Un actor intenta lanzar una simulación de restore apuntando a un tenant o entorno productivo. La plataforma rechaza la solicitud de forma explícita y no ejecuta ninguna acción. La denegación indica que la capacidad solo está disponible para integración/sandbox.

**E5 — Simulación de restore sobre un snapshot compatible pero con validación parcial**

> La restauración de prueba se completa, pero una de las comprobaciones posteriores detecta una discrepancia menor, por ejemplo un conteo esperado que no coincide con la semilla de datos del entorno. La simulación se marca como completada con advertencias y deja evidencia del desajuste.

### 3.2 Edge cases

| Caso | Comportamiento esperado |
|---|---|
| El entorno sandbox no está preparado o no existe | La simulación no arranca. La plataforma informa que el objetivo de prueba no está disponible. |
| El snapshot seleccionado no es restaurable o está expirado | La simulación se rechaza con un motivo funcional claro. |
| La simulación tarda más de lo esperado | El estado pasa a `in_progress` y, si supera el límite configurado, se marca como `failed` o `timed_out` con evidencia parcial. |
| La verificación post-restore encuentra datos inesperados | La simulación se completa con resultado `warning` o `failed`, según la severidad definida por la regla de validación. |
| El actor no tiene permisos sobre el entorno de prueba | La solicitud se rechaza con `HTTP 403`. |
| Se intenta reutilizar la misma ejecución o su identificador | La ejecución ya finalizada no se reabre; solo se puede consultar su resultado. |
| Se ejecutan múltiples simulaciones en paralelo | Se permiten si el sandbox tiene capacidad, pero el sistema debe reflejar colas o límites si existe saturación. |
| La simulación no puede completar las comprobaciones finales por fallo del entorno | Se reporta como fallo de la prueba, pero se conserva la evidencia obtenida hasta ese punto. |

### 3.3 Reglas de negocio y gobierno

**RN-01 — La capacidad solo aplica a integración/sandbox**
Las simulaciones de restore de esta tarea nunca se ejecutan sobre tenants o entornos de producción. La plataforma debe distinguir explícitamente entre test y operación.

**RN-02 — Una simulación no equivale a una restauración operativa**
El resultado de esta tarea es evidencia de validación, no una operación de recuperación real. No debe confundirse con un restore productivo ni activar consecuencias sobre datos reales.

**RN-03 — Aislamiento total respecto a datos productivos**
La simulación utiliza objetivos desechables, réplicas de prueba o tenants de laboratorio. No puede mutar el estado de producción ni sobrescribir recursos reales.

**RN-04 — El resultado debe ser verificable**
Cada simulación devuelve un estado claro (`completed`, `failed`, `warning` o equivalente), un resumen de comprobaciones y una referencia de ejecución consultable posteriormente.

**RN-05 — La ejecución debe ser reproducible**
La misma combinación de snapshot, entorno y parámetros de prueba debe producir un resultado comparable, permitiendo regresión y comparación entre despliegues.

**RN-06 — La capacidad respeta permisos y trazabilidad**
Solo los roles autorizados pueden lanzar o consultar simulaciones. La ejecución debe quedar registrada para poder auditar quién probó qué y en qué entorno.

**RN-07 — La simulación no sustituye a las confirmaciones de restore real**
Las protecciones de US-BKP-01-T04 siguen aplicando a restores reales. Esta tarea no relaja esas barreras; únicamente añade un camino seguro para pruebas.

---

## 4. Requisitos funcionales verificables

**RF-T05-01 — Lanzamiento de simulación de restore en sandbox**
La plataforma debe permitir iniciar una simulación de restore sobre un snapshot usando un entorno de integración o sandbox explícitamente habilitado. La solicitud debe devolver un identificador de ejecución consultable.

**RF-T05-02 — Bloqueo de simulaciones fuera de entornos no productivos**
Si la solicitud apunta a producción o a un entorno no marcado como seguro para pruebas, la plataforma debe rechazarla con un error funcional claro.

**RF-T05-03 — Modelo de estado de ejecución de la simulación**
Debe existir un estado consultable para cada simulación, como mínimo con: `pending`, `in_progress`, `completed`, `failed`, `warning` y el motivo funcional del resultado.

**RF-T05-04 — Validaciones post-restore**
La simulación debe poder ejecutar comprobaciones posteriores al restore, como verificación de integridad básica, presencia de datos esperados o salud funcional mínima del entorno de prueba. El resultado de esas comprobaciones debe formar parte de la respuesta.

**RF-T05-05 — Evidencia y trazabilidad de la prueba**
Cada simulación debe conservar evidencia consultable: snapshot usado, entorno destino, actor que la inició, timestamps, comprobaciones ejecutadas y resultado final.

**RF-T05-06 — Consulta de historial de simulaciones**
La consola o la API deben permitir consultar simulaciones anteriores para revisar resultados, advertencias y fallos de forma histórica.

**RF-T05-07 — Control de acceso por rol**
Solo SRE, superadmin o automatizaciones con permisos explícitos pueden lanzar o consultar simulaciones. El tenant owner no obtiene acceso por defecto a esta capacidad.

**RF-T05-08 — Integración con el flujo de restore existente**
La simulación debe reutilizar el dominio de restore ya definido en tareas previas, pero con un objetivo y una semántica de prueba claramente diferenciados del restore productivo.

---

## 5. Permisos, aislamiento multi-tenant, auditoría y seguridad

### 5.1 Permisos

| Acción | Roles autorizados | Notas |
|---|---|---|
| Lanzar simulación de restore | SRE, superadmin, automatización autorizada | Requiere acceso al entorno de prueba. |
| Consultar resultado de simulación | SRE, superadmin, automatización autorizada | Solo sobre simulaciones visibles para el actor. |
| Revisar historial completo de pruebas | SRE, superadmin | Vista global o por tenant de laboratorio. |
| Usar la capacidad sobre producción | Ninguno | Siempre denegado. |

### 5.2 Aislamiento multi-tenant

- La simulación debe estar ligada a un tenant de pruebas, laboratorio o sandbox, no a un tenant productivo real.
- Si la prueba usa datos representativos, deben ser anonimizados o sembrados para el entorno de ensayo.
- Ninguna simulación debe exponer datos de otros tenants reales.
- El identificador de la simulación debe permitir correlacionar la prueba con el entorno sin revelar información sensible de producción.

### 5.3 Auditoría

- Cada simulación iniciada, abortada, completada o fallida debe dejar rastro en el trail de auditoría de la plataforma.
- El evento de auditoría debe incluir: actor, entorno objetivo, snapshot, timestamp, resultado y motivo funcional.
- Los resultados de las comprobaciones posteriores también deben ser consultables como parte de la evidencia.

### 5.4 Seguridad

- La capacidad debe estar protegida por autenticación y autorización.
- Los objetivos de prueba deben estar explícitamente marcados como seguros para simulación; la plataforma no debe asumirlo por defecto.
- La funcionalidad no debe permitir restaurar ni sobrescribir componentes productivos aunque se invoque desde herramientas de automatización.
- Los datos usados en pruebas no deben incluir credenciales, secretos ni información operativa sensible.

### 5.5 Trazabilidad con el backlog

| Requisito funcional de esta tarea | RF del backlog |
|---|---|
| Simulación de restore y evidencia consultable | RF-BKP-001 |
| Vista de resultados en consola o API | RF-BKP-002 |
| Aislamiento por perfil de despliegue y entorno | RF-BKP-005 |

---

## 6. Criterios de aceptación

**CA-01 — Simulación de restore en sandbox disponible**
Dado un actor autorizado y un entorno de integración/sandbox habilitado, cuando inicia una simulación de restore para un snapshot válido, entonces la plataforma devuelve un identificador de ejecución y el estado inicial de la simulación.

**CA-02 — La simulación no afecta a producción**
Dado un intento de lanzar la misma operación contra un entorno productivo, cuando la plataforma recibe la solicitud, entonces la rechaza y no ejecuta ninguna restauración.

**CA-03 — Resultado consultable de la simulación**
Dada una simulación completada o fallida, cuando el actor consulta su resultado, entonces la plataforma devuelve el estado final, el motivo funcional y las comprobaciones ejecutadas.

**CA-04 — Evidencia de prueba registrada**
Dado un drill de restore en sandbox, cuando finaliza, entonces queda una referencia consultable con snapshot, entorno objetivo, actor, timestamps y resultado.

**CA-05 — Fallo de validación post-restore visible**
Dada una simulación cuya verificación posterior detecta una discrepancia, cuando se presenta el resultado, entonces la plataforma marca la ejecución con advertencia o fallo y muestra la validación afectada.

**CA-06 — Acceso restringido a roles autorizados**
Dado un tenant owner o un actor sin permisos, cuando intenta lanzar o consultar una simulación, entonces la plataforma deniega el acceso.

**CA-07 — Historial de simulaciones consultable**
Dado un conjunto de simulaciones previas, cuando un SRE o superadmin consulta el historial, entonces puede ver las ejecuciones, sus estados y el detalle esencial de cada una.

**CA-08 — Aislamiento de entorno garantizado**
Dado un sandbox habilitado para pruebas, cuando la simulación se ejecuta, entonces solo muta el objetivo desechable o aislado asignado a la prueba y no altera ningún tenant real.
