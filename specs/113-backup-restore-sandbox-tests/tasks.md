# Tasks — US-BKP-01-T05: Pruebas y simulaciones de restore en integración/sandbox

**Branch**: `113-backup-restore-sandbox-tests`  
**Spec**: `specs/113-backup-restore-sandbox-tests/spec.md`  
**Plan**: `specs/113-backup-restore-sandbox-tests/plan.md`

---

## Instrucciones para el agente de implementación

> Lee **únicamente** `spec.md` + `plan.md` para entender el alcance de la feature y los ficheros explícitamente mencionados en cada tarea. No navegues el repo libremente.  
> Preserva en todo momento los artefactos no relacionados de las series `070` y `072` si aparecen en el árbol de trabajo.  
> Mantén el alcance estrictamente acotado a simulaciones y drills de restore en integración/sandbox; no relajar el flujo de restore operativo.

---

## Tareas de implementación

### T001 — Formalizar el modo de ejecución de restore y la evidencia de simulación

**Objetivo**
Definir el contrato interno que distingue restore operativo de simulación, junto con la forma de evidencia que se persistirá y serializará en `backup_operations.metadata`.

**Ficheros de entrada**
- `specs/113-backup-restore-sandbox-tests/plan.md` — secciones “Arquitectura objetivo y flujo”, “Modelo de datos y metadatos” y “Criterios de done”
- `services/backup-status/src/operations/operations.types.ts`
- `services/backup-status/src/confirmations/confirmations.types.ts`
- `services/backup-status/src/operations/operations.repository.ts`

**Ficheros de salida**
- `services/backup-status/src/operations/operations.types.ts` ← MODIFICADO
- `services/backup-status/src/confirmations/confirmations.types.ts` ← MODIFICADO si el request necesita bandera de simulación
- `services/backup-status/src/operations/restore-simulation.types.ts` ← NUEVO si se necesita tipado auxiliar separado

**Qué hacer**
- Añadir tipos para `execution_mode`, `target_environment`, `validation_summary` y `evidence_refs`.
- Mantener compatibilidad con las formas actuales de `OperationRecord` y `OperationResponseV1`.
- Definir un shape estable para la evidencia de simulación que pueda reutilizarse en la consola y en el historial.
- Evitar crear tablas o migraciones nuevas: la persistencia debe seguir en `backup_operations.metadata`.

**Criterios de aceptación**
- El modo de ejecución queda inequívocamente diferenciado entre operativo y simulación.
- La evidencia puede tiparse sin romper el contrato actual de restore operativo.
- No se introducen cambios de base de datos.

**Dependencias**
- Ninguna; puede arrancar en paralelo con la preparación de UI si se acuerda el shape final.

---

### T002 — Implementar la rama de simulación en el flujo de restore

**Objetivo**
Bifurcar el flujo de restore para que una solicitud marcada como simulación pase por validaciones seguras, genere un resultado consultable y nunca dispare el camino destructivo.

**Ficheros de entrada**
- `specs/113-backup-restore-sandbox-tests/plan.md` — secciones “Arquitectura objetivo y flujo” y “Plan de cambios por artefacto”
- `services/backup-status/src/operations/trigger-restore.action.ts`
- `services/backup-status/src/operations/operation-dispatcher.ts`
- `services/backup-status/src/confirmations/confirmations.service.ts`
- `services/backup-status/src/shared/deployment-profile.ts`

**Ficheros de salida**
- `services/backup-status/src/operations/trigger-restore.action.ts` ← MODIFICADO
- `services/backup-status/src/operations/operation-dispatcher.ts` ← MODIFICADO
- `services/backup-status/src/operations/restore-simulation.service.ts` ← NUEVO
- `services/backup-status/src/confirmations/confirmations.service.ts` ← MODIFICADO si el camino operativo debe bloquear explícitamente la simulación

**Qué hacer**
- Detectar el modo de simulación en la solicitud de restore.
- Verificar el perfil de despliegue y rechazar cualquier entorno no seguro.
- Ejecutar validaciones post-restore sobre un objetivo desechable o aislado.
- Persistir el resultado y la evidencia resumida en metadata.
- Mantener intacto el flujo de confirmación reforzada para restores operativos.
- Asegurar idempotencia y denegación explícita en producción.

**Criterios de aceptación**
- Una solicitud de simulación no puede activar restore destructivo real.
- Un request contra producción o un perfil no seguro se rechaza antes de cualquier dispatch.
- El resultado de la simulación queda registrado y consultable.

**Dependencias**
- T001.

---

### T003 — Extender consulta de estado, auditoría y serialización de evidencia

**Objetivo**
Hacer visible el modo de ejecución y la evidencia en el historial/estado sin alterar las respuestas operativas existentes.

**Ficheros de entrada**
- `specs/113-backup-restore-sandbox-tests/plan.md` — secciones “Plan de cambios por artefacto”, “Modelo de datos y metadatos” y “Consideraciones de API y UX”
- `services/backup-status/src/operations/get-operation.action.ts`
- `services/backup-status/src/operations/operations.repository.ts`
- `services/backup-status/src/audit/audit-trail.ts`
- `services/backup-status/src/audit/audit-trail.types.ts` si existe tipado asociado

**Ficheros de salida**
- `services/backup-status/src/operations/get-operation.action.ts` ← MODIFICADO
- `services/backup-status/src/operations/operations.repository.ts` ← MODIFICADO
- `services/backup-status/src/audit/audit-trail.ts` ← MODIFICADO
- `services/backup-status/src/audit/audit-trail.types.ts` ← MODIFICADO si hace falta

**Qué hacer**
- Exponer `execution_mode` y el resumen de validación cuando la operación sea simulación.
- Registrar en auditoría que la ejecución fue un drill/sandbox test.
- Conservar la forma actual de la respuesta para restores operativos.
- Evitar filtrar datos sensibles de producción en la evidencia.

**Criterios de aceptación**
- La simulación es distinguible del restore operativo en la consulta de estado.
- La auditoría conserva la trazabilidad del drill y su resultado.
- No hay regresión en la serialización actual de operaciones normales.

**Dependencias**
- T001 y T002.

---

### T004 — Añadir la superficie de consola para lanzar y revisar simulaciones

**Objetivo**
Exponer la simulación en la consola con guardrails de entorno y un panel claro de evidencia/resultados.

**Ficheros de entrada**
- `specs/113-backup-restore-sandbox-tests/plan.md` — secciones “Consideraciones de API y UX” y “Plan de cambios por artefacto”
- `apps/web-console/src/hooks/useTriggerRestore.ts`
- `apps/web-console/src/hooks/useOperationStatus.ts`
- `apps/web-console/src/hooks/useSnapshots.ts`
- `apps/web-console/src/pages/admin/BackupStatusPage.tsx`
- `apps/web-console/src/pages/tenant/BackupSummaryPage.tsx`
- `apps/web-console/src/components/backup/*` (componentes existentes)

**Ficheros de salida**
- `apps/web-console/src/hooks/useTriggerRestore.ts` ← MODIFICADO
- `apps/web-console/src/hooks/useOperationStatus.ts` ← MODIFICADO
- `apps/web-console/src/pages/admin/BackupStatusPage.tsx` ← MODIFICADO
- `apps/web-console/src/pages/tenant/BackupSummaryPage.tsx` ← MODIFICADO
- `apps/web-console/src/components/backup/RestoreSimulationDialog.tsx` ← NUEVO
- `apps/web-console/src/components/backup/RestoreSimulationEvidence.tsx` ← NUEVO
- `apps/web-console/src/components/backup/OperationStatusBadge.tsx` ← MODIFICADO si ya existe el componente en la rama

**Qué hacer**
- Añadir toggle o acción explícita de simulación.
- Mostrar claramente que la operación no es operativa/destructiva.
- Restringir la acción al perfil/entorno permitido.
- Presentar el resumen de validaciones y la evidencia tras la ejecución.
- Mantener la UX existente de restore operativo sin mezclarla con el drill.

**Criterios de aceptación**
- La consola sólo permite iniciar la simulación cuando el perfil lo admite.
- El usuario puede revisar el estado y la evidencia de la simulación.
- La UI deja claro que la operación no toca producción.

**Dependencias**
- T001 y T002; puede avanzar en paralelo con T003 una vez estabilizado el shape de evidencia.

---

### T005 — Cobertura unitaria y de resiliencia para guardrails de sandbox

**Objetivo**
Probar los límites de seguridad, la serialización de evidencia y la negativa sobre producción.

**Ficheros de entrada**
- `specs/113-backup-restore-sandbox-tests/plan.md` — secciones “Estrategia de pruebas” y “Riesgos y mitigaciones”
- `services/backup-status/src/operations/trigger-restore.action.ts`
- `services/backup-status/src/operations/restore-simulation.service.ts`
- `services/backup-status/src/operations/get-operation.action.ts`
- `apps/web-console/src/hooks/useTriggerRestore.ts`
- `apps/web-console/src/hooks/useOperationStatus.ts`

**Ficheros de salida**
- `tests/unit/backup-restore-sandbox.test.mjs` ← NUEVO
- `tests/resilience/backup-restore-sandbox.test.mjs` ← NUEVO
- `tests/unit/operations/trigger-restore.action.test.mjs` ← NUEVO si conviene aislar la rama de simulación
- `tests/unit/operations/restore-simulation.service.test.mjs` ← NUEVO si se extrae servicio puro

**Qué hacer**
- Verificar que la simulación no llama al camino destructivo.
- Verificar rechazo explícito en producción o perfiles no seguros.
- Verificar la forma y el contenido mínimo de la evidencia.
- Verificar idempotencia/consistencia de la denegación en reintentos.
- Verificar que la serialización de estado muestra `execution_mode` correctamente.

**Criterios de aceptación**
- Las pruebas fallan si la simulación puede tocar producción.
- La evidencia de simulación se serializa como se espera.
- La ruta operativa existente sigue pasando sus aserciones base.

**Dependencias**
- T001, T002 y T003.

---

### T006 — Pruebas de contrato, integración y E2E para simulación end-to-end

**Objetivo**
Demostrar el comportamiento completo de la capacidad desde el contrato hasta la consola.

**Ficheros de entrada**
- `specs/113-backup-restore-sandbox-tests/spec.md`
- `specs/113-backup-restore-sandbox-tests/plan.md`
- `services/backup-status/src/operations/get-operation.action.ts`
- `apps/web-console/src/pages/admin/BackupStatusPage.tsx`
- `apps/web-console/src/pages/tenant/BackupSummaryPage.tsx`

**Ficheros de salida**
- `tests/contracts/backup-restore-sandbox.contract.test.mjs` ← NUEVO
- `tests/integration/backup-restore-sandbox.test.mjs` ← NUEVO
- `tests/e2e/console/backup-restore-sandbox.spec.ts` ← NUEVO

**Qué hacer**
- Validar que la respuesta de simulación conserva el contrato base y añade metadatos de forma aditiva.
- Validar que el historial/estado devuelve evidencia consultable.
- Validar el flujo de consola para lanzar y revisar una simulación.
- Validar que el rechazo por entorno no seguro tiene forma consistente.

**Criterios de aceptación**
- El contrato de simulación es verificable y no rompe las respuestas existentes.
- La integración confirma que la simulación se ejecuta sólo en el perfil permitido.
- El E2E de consola cubre iniciar y revisar la evidencia.

**Dependencias**
- T001, T002, T003 y T004.

---

### T007 — Validación final, fijación de drift y preparación de push

**Objetivo**
Correr las validaciones del repositorio, corregir cualquier drift y dejar la rama lista para subir.

**Ficheros de entrada**
- Todos los artefactos modificados por las tareas anteriores

**Ficheros de salida**
- Ningún archivo nuevo; sólo corrección de drift si fuese necesario

**Qué hacer**
- Ejecutar las validaciones del repo definidas en el plan.
- Corregir cualquier desviación de contrato, consola o tests.
- Verificar que no se han tocado artefactos no relacionados de las series `070` / `072`.
- Confirmar que la rama queda limpia y lista para commit/push.

**Criterios de aceptación**
- La suite de validación pasa para el alcance de US-BKP-01-T05.
- No quedan archivos de plantilla ni cambios fuera de alcance.

**Dependencias**
- Todas las tareas anteriores.

---

## Notas de paralelización

- T001 puede empezar de inmediato.
- T003 y T004 pueden avanzar en paralelo una vez el shape de evidencia y `execution_mode` estén fijados.
- T005 y T006 deben esperar a que T001–T004 estabilicen el contrato.
- T007 siempre va al final.

## Definición de done

- La feature permite simulaciones/drills de restore sólo en sandbox/integration.
- El restore operativo sigue protegido y no se degrada.
- La evidencia y el resultado de simulación son consultables desde API/consola.
- La denegación en producción es explícita y testeada.
- Las suites de validación del repo pasan para esta rama.
