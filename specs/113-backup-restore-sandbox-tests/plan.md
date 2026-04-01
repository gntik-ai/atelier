# Plan de implementación — US-BKP-01-T05: Pruebas y simulaciones de restore en integración/sandbox

**Branch**: `113-backup-restore-sandbox-tests` | **Fecha**: 2026-04-01 | **Spec**: `specs/113-backup-restore-sandbox-tests/spec.md`  
**Input**: Especificación de feature US-BKP-01-T05

## Resumen ejecutivo

Extender el flujo existente de backup/restore para permitir **simulaciones y drills de restore en entornos de integración o sandbox**, con aislamiento explícito respecto a producción, resultados verificables y evidencia consultable. La solución debe reutilizar el dominio ya existente de `backup_operations`, `confirmations` y `audit-trail`, evitando nuevas tablas salvo que se demuestre una imposibilidad real. La propuesta preferente es introducir un **modo de ejecución de simulación** sobre el mismo contrato de restore, de forma que la operación siga pasando por el control plane y la auditoría, pero quede marcada como no operativa, no destructiva y restringida a perfiles de despliegue seguros.

La capacidad debe cubrir cuatro resultados funcionales:

1. lanzar un drill o simulación de restore sobre snapshots o copias de prueba,
2. ejecutar comprobaciones post-restore sobre el objetivo aislado,
3. conservar y consultar evidencia de la prueba,
4. bloquear cualquier intento de usar la capacidad en producción o fuera de un perfil de despliegue seguro.

## Contexto técnico

**Lenguaje/Runtime**: Node.js 20+ ESM, TypeScript en acciones OpenWhisk, React 18 + Tailwind + shadcn/ui en consola, Markdown para artefactos de plan/tareas  
**Dependencias primarias**: `node:test`, módulos existentes de `services/backup-status`, adaptadores OpenWhisk ya gobernados, `apps/web-console` hooks/componentes, scripts de validación del repositorio  
**Almacenamiento**: PostgreSQL existente vía `backup_operations` y `backup_audit_events`; la simulación debe aprovechar `backup_operations.metadata` y `detail` de auditoría para guardar evidencia y no introducir tablas nuevas  
**Plataforma de despliegue**: Kubernetes / OpenShift vía Helm  
**IAM / gateway**: Keycloak + APISIX, reutilizando los scopes ya existentes para restore y reforzando la comprobación del perfil de despliegue  
**Mensajería / observabilidad**: Kafka y auditoría ya presentes; la simulación debe dejar trazabilidad en el mismo pipeline de eventos  
**Tipo de proyecto**: monorepo multi-tenant BaaS con control plane y consola  
**Restricciones**: preservar aislamiento tenant/workspace, no relajar las protecciones del restore operativo, no tocar producción, no introducir un camino privado paralelo, no romper la confirmación reforzada ya entregada en T04  
**Escala**: un incremento acotado al flujo de restore y su representación en consola/tests; sin cambios de stack

## Verificación de constitución

- **Separación de concerns**: PASS — la simulación se modela como una extensión del flujo de restore ya gobernado, sin introducir acceso directo a la infraestructura real.
- **Entrega incremental**: PASS — puede implementarse con helpers, metadata y tests antes de cualquier cambio de infraestructura.
- **Compatibilidad K8s/OpenShift**: PASS — el control del entorno se apoya en el perfil de despliegue existente; no se requieren recursos cluster nuevos.
- **Multi-tenant**: PASS — la simulación sigue ligada a `tenant_id`, `component_type`, `instance_id` y al contexto de actor ya existente.
- **No degradar restore operativo**: PASS — el camino destructivo real permanece protegido; la simulación es una rama explícitamente no operativa.
- **Evidencia verificable**: PASS — el resultado debe quedar serializado en metadata y ser consultable desde la API/consola.

## Estructura del proyecto

### Documentación (esta feature)

```text
specs/113-backup-restore-sandbox-tests/
├── spec.md
├── plan.md
└── tasks.md
```

### Código fuente — extensiones previstas

```text
services/backup-status/
├── src/
│   ├── operations/
│   │   ├── operations.types.ts                 # MODIFICADO — añadir modo de ejecución/evidencia de simulación en metadata tipada
│   │   ├── operations.repository.ts            # MODIFICADO — persistir/leer metadata de simulación y resultados de validación
│   │   ├── trigger-restore.action.ts           # MODIFICADO — bifurcación operativa vs simulación
│   │   ├── operation-dispatcher.ts             # MODIFICADO — no ejecutar restore destructivo cuando la operación es simulación
│   │   ├── get-operation.action.ts             # MODIFICADO — exponer evidencia y estado de simulación cuando corresponda
│   │   ├── restore-simulation.types.ts         # NUEVO — tipos auxiliares para modo de ejecución y evidencia
│   │   └── restore-simulation.service.ts       # NUEVO — orquestador de simulaciones/drills de restore
│   ├── confirmations/
│   │   ├── confirmations.service.ts            # MODIFICADO — asegurar que el camino de confirmación siga siendo sólo operativo
│   │   └── confirmations.types.ts              # MODIFICADO — tipos auxiliares si el request acepta bandera de simulación
│   ├── audit/
│   │   └── audit-trail.ts                      # MODIFICADO — registrar resultados/evidencia de simulación sin perder trazabilidad
│   └── shared/
│       └── deployment-profile.ts               # REUTILIZADO — fuente de verdad para permitir sólo perfiles sandbox/integration

apps/web-console/
├── src/
│   ├── hooks/
│   │   ├── useTriggerRestore.ts                 # MODIFICADO — permitir modo simulación y almacenar evidencia recibida
│   │   ├── useOperationStatus.ts                # MODIFICADO — mostrar estado/evidencia de simulaciones
│   │   └── useSnapshots.ts                      # REUTILIZADO/MODIFICADO — selección de snapshots para simulación
│   ├── components/backup/
│   │   ├── RestoreSimulationDialog.tsx          # NUEVO — formulario de drill con guardrails de entorno
│   │   ├── RestoreSimulationEvidence.tsx        # NUEVO — panel de comprobaciones y evidencia
│   │   └── OperationStatusBadge.tsx             # MODIFICADO — distintivo de simulación vs restore operativo
│   └── pages/
│       ├── admin/BackupStatusPage.tsx           # MODIFICADO — acceso administrativo al drill y a su historial
│       └── tenant/BackupSummaryPage.tsx         # MODIFICADO — visibilidad condicional si el perfil lo permite

services/gateway-config/
└── routes/backup-operations-routes.yaml         # REVISAR sólo si el contrato público exige exposición adicional del modo simulación

services/keycloak-config/
└── scopes/backup-operations-scopes.yaml         # REUTILIZAR scopes existentes; sólo añadir uno nuevo si la política de producto lo exige

tests/
├── unit/
│   └── backup-restore-sandbox.test.mjs          # NUEVO — guardrails, metadata y serialización de evidencia
├── contracts/
│   └── backup-restore-sandbox.contract.test.mjs # NUEVO — contrato de request/response y denegaciones
├── resilience/
│   └── backup-restore-sandbox.test.mjs          # NUEVO — denegación en producción, reintentos e idempotencia
├── integration/
│   └── backup-restore-sandbox.test.mjs          # NUEVO — drill en perfil seguro con evidencia consultable
└── e2e/
    └── console/
        └── backup-restore-sandbox.spec.ts       # NUEVO — flujo de consola para iniciar y revisar simulaciones
```

**Decisión de estructura**: La implementación preferente es **incremental y sin nuevas tablas**. La simulación debe apoyarse en el `metadata` ya disponible en `backup_operations`, y la evidencia en el `detail`/payload de auditoría existente. Si en la fase de análisis se detecta que alguna validación no cabe en ese modelo, la alternativa mínima compatible será añadir sólo campos aditivos, no un sistema paralelo.

## Arquitectura objetivo y flujo

1. El actor autorizado inicia un restore desde la consola o la API con una marca explícita de **simulación/drill**.
2. El handler de restore detecta el modo de ejecución y valida que el despliegue actual está clasificado como seguro para pruebas (por ejemplo, `sandbox` o `integration`) mediante `deployment-profile.ts`.
3. Si el perfil es seguro, la operación se crea en `backup_operations` con `metadata.execution_mode = 'simulation'` y con referencias al snapshot, al entorno y a los comprobantes esperados.
4. La lógica de simulación ejecuta validaciones post-restore sobre un objetivo desechable o aislado: integridad mínima, presencia de datos esperados, coherencia de configuración y salud funcional básica.
5. El dispatcher o el servicio específico de simulación marca el resultado de la ejecución como `completed`, `warning` o `failed`, y persiste la evidencia resumida en metadata.
6. El audit trail registra que se trata de una simulación, qué comprobaciones se ejecutaron y cuál fue el resultado, de forma distinguible pero sin exponer datos sensibles de producción.
7. La API de estado/historial y la consola muestran la simulación como una ejecución consultable, con su evidencia, pero sin confundirla con un restore operativo.
8. Si el perfil de despliegue no es seguro, el request se rechaza antes de iniciar cualquier workflow y sin tocar datos productivos.

## Plan de cambios por artefacto

### `services/backup-status/src/operations/restore-simulation.service.ts` (nuevo)

- Centralizar la lógica de simulación/drill de restore.
- Resolver el perfil de despliegue y rechazar cualquier ejecución fuera de sandbox/integration.
- Preparar el contexto de validación post-restore y recopilar la evidencia final.
- Emitir un resultado estructurado que pueda serializarse en `backup_operations.metadata`.

### `services/backup-status/src/operations/trigger-restore.action.ts`

- Introducir una bifurcación explícita entre restore operativo y simulación.
- Mantener intacta la confirmación reforzada del camino operativo.
- Cuando la solicitud sea simulación, delegar en `restore-simulation.service.ts` y evitar cualquier dispatch destructivo.

### `services/backup-status/src/operations/operation-dispatcher.ts`

- Asegurar que la simulación no llame a acciones destructivas de restore.
- Registrar transiciones de estado y resultados de validación para el modo simulación.
- Mantener idempotencia y trazabilidad por `operation_id`.

### `services/backup-status/src/operations/operations.types.ts`

- Añadir tipos auxiliares para distinguir `execution_mode` y para tipar la evidencia de simulación.
- Mantener compatibilidad con la forma actual de `OperationRecord` y `OperationResponseV1`.

### `services/backup-status/src/operations/operations.repository.ts`

- Persistir y leer metadata adicional sin romper operaciones existentes.
- Permitir consultar historial y detalle de simulación a partir de la información ya almacenada.

### `services/backup-status/src/operations/get-operation.action.ts`

- Exponer el resumen de evidencia de simulación cuando el actor tenga permiso para verla.
- Conservar la forma de response actual para el resto de operaciones.

### `services/backup-status/src/audit/audit-trail.ts`

- Marcar las entradas de auditoría de simulación con el modo de ejecución.
- Incluir comprobaciones y resultados en el payload de detalle sin romper el esquema existente.

### `apps/web-console/src/hooks/useTriggerRestore.ts`

- Añadir el modo simulación y transportar la evidencia devuelta por la API.
- Mantener el comportamiento actual para restore operativo.

### `apps/web-console/src/hooks/useOperationStatus.ts`

- Mostrar el modo de ejecución y el resumen de validaciones en el polling de estado.

### `apps/web-console/src/components/backup/RestoreSimulationDialog.tsx` y `RestoreSimulationEvidence.tsx` (nuevos)

- Formulario para seleccionar snapshot y lanzar el drill.
- Panel para visualizar evidencia, advertencias y resultado final.

### `apps/web-console/src/pages/admin/BackupStatusPage.tsx` y `apps/web-console/src/pages/tenant/BackupSummaryPage.tsx`

- Superficies administrativas/condicionales para iniciar simulaciones y revisar su historial.
- No introducir acceso a producción ni duplicar el flujo operativo.

### `tests/`

- Cobertura unitaria del guardrail de entorno, serialización de evidencia y denegaciones.
- Contratos para request/response y para la distinción entre restore operativo y simulación.
- Pruebas de integración y E2E para el flujo de consola en sandbox.
- Pruebas de resiliencia para reintentos, denegaciones por producción y comportamiento idempotente.

## Modelo de datos y metadatos

**No se prevén nuevas tablas ni migraciones**. La información de simulación debe guardarse en los artefactos ya existentes:

| Entidad / campo | Uso |
|---|---|
| `backup_operations.metadata.execution_mode` | Distinguir `operative` de `simulation` |
| `backup_operations.metadata.target_environment` | Perfil/entorno donde se ejecutó el drill |
| `backup_operations.metadata.validation_summary` | Resumen de validaciones post-restore |
| `backup_operations.metadata.evidence_refs` | Referencias a comprobaciones, snapshots y/o resultados útiles para auditoría |
| `backup_audit_events.detail` | Detalle extendido de cada simulación, incluyendo motivos de rechazo |

La evidencia debe ser lo suficientemente estable como para comparar corridas entre despliegues, pero sin copiar datos sensibles del entorno operativo.

## Consideraciones de API y UX

- La simulación debe ser **explícita**: el usuario debe ver claramente que no está lanzando un restore operativo.
- Si se mantiene el mismo endpoint de restore, el request debe incluir un flag o modo de ejecución que no pueda confundirse con la operación destructiva.
- La consola sólo debe habilitar el botón/toggle de simulación cuando el perfil de despliegue lo permita.
- El estado y la evidencia deben poder consultarse después de la ejecución, con el mismo modelo de acceso multi-tenant ya existente.
- El rechazo por producción debe ser funcionalmente claro y no ambiguo.
- No se introduce un camino privado ni bypass directo a la infraestructura real.

## Estrategia de pruebas

### Unitarias

- Verificar que el modo simulación queda correctamente tipado y serializado.
- Verificar rechazo cuando el perfil de despliegue no es seguro.
- Verificar que la simulación no llama al camino destructivo.
- Verificar la forma de la evidencia y la visibilidad condicionada en consola.

### Integración

- Ejecutar un drill contra un entorno sandbox/integration con snapshots de prueba.
- Validar que el resultado persiste y que el historial es consultable.
- Validar que la evidencia mostrada coincide con la ejecución real.

### Contrato

- Comprobar que la respuesta de simulación es compatible con el esquema del API y que las extensiones son aditivas.
- Comprobar que la denegación por entorno no seguro devuelve el código y la forma de error esperada.

### E2E

- Simular la interacción de la consola para iniciar una prueba, revisar el estado y abrir la evidencia.
- Verificar que la UI sólo expone la acción en perfiles permitidos.

### Operacional

- `npm run validate:public-api`
- `npm run validate:openapi`
- `npm run validate:service-map`
- `npm run validate:authorization-model`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:contracts`
- `npm run test:resilience`
- `npm run test:e2e`
- `npm run lint`

## Riesgos y mitigaciones

- **Riesgo**: una simulación podría activar accidentalmente un restore real.  
  **Mitigación**: bifurcación temprana por modo de ejecución, rechazo explícito fuera de sandbox/integration y cobertura de resiliencia.

- **Riesgo**: la evidencia de simulación podría quedar demasiado pobre para validar regresiones.  
  **Mitigación**: persistir un resumen estructurado de checks, entorno, snapshot y resultado en `metadata` y en auditoría.

- **Riesgo**: la consola podría presentar la simulación como un restore operativo.  
  **Mitigación**: UI diferenciada con copy explícito, badges de modo y guardrails por perfil.

- **Riesgo**: al reutilizar `backup_operations`, el historial podría mezclar operativas y simulaciones.  
  **Mitigación**: filtrar y etiquetar por `execution_mode` en queries y serialización.

- **Riesgo**: rechazo por entorno no seguro podría romper flujos de prueba automatizados.  
  **Mitigación**: hacer el control por perfil predecible y documentado; los tests deben fijar el perfil esperado.

## Secuencia recomendada de implementación

1. Definir el contrato interno de simulación y la forma de evidencia sobre `metadata`.
2. Implementar el bifurcado de `trigger-restore.action.ts` y el servicio de simulación.
3. Alinear dispatcher, auditoría y serialización de estado/historial.
4. Exponer la funcionalidad en la consola con guardrails de entorno.
5. Añadir pruebas unitarias y de resiliencia primero, luego contrato, integración y E2E.
6. Ejecutar validaciones del repo y corregir cualquier deriva de contrato o consola.

## Criterios de done

- La plataforma permite iniciar un drill/simulación de restore en sandbox o integración.
- La misma capacidad rechaza de forma explícita cualquier entorno no seguro, especialmente producción.
- El resultado y la evidencia de la simulación quedan persistidos y consultables.
- La consola distingue claramente simulación de restore operativo.
- No se introduce una ruta privada ni se relaja la confirmación de restores reales.
- Las suites de tests y validación del repo pasan para el alcance acotado de US-BKP-01-T05.

## Evidencia esperada

- Diff del flujo de restore mostrando la bifurcación por modo de ejecución.
- Diff de `backup_operations.metadata` y del serializador de estado/historial.
- Diff de consola con el diálogo y la vista de evidencia de simulación.
- Salida de tests unitarios, de contrato, resiliencia, integración y E2E.
- Salida de validaciones del repo sin regresiones en los restore operativos existentes.
