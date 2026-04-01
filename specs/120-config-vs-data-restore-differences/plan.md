# Implementation Plan: Documentar diferencias entre restauración de configuración y restauración de datos

**Branch**: `120-config-vs-data-restore-differences` | **Date**: 2026-04-01 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/120-config-vs-data-restore-differences/spec.md`

## Summary

Esta tarea produce un documento operativo estructurado que delimita, dominio por dominio, la distinción entre restauración de configuración funcional (cubierta por US-BKP-02-T01 a T05) y restauración de datos de usuario (no cubierta por la cadena actual). El artefacto resultante se publica en `docs/operations/` como referencia accionable para SRE, superadmins, equipo de producto y auditores.

No hay implementación de código, DDL, migraciones ni rutas de API nuevas. El entregable completo es un archivo Markdown estructurado.

## Technical Context

**Language/Version**: N/A — artefacto de documentación puro (Markdown)
**Primary Dependencies**: Ninguna dependencia de runtime; referencia cruzada con especificaciones de T01–T05 como fuente de verdad
**Storage**: N/A
**Testing**: Verificación manual de completitud contra criterios de aceptación CA-01 a CA-13 del spec
**Target Platform**: Repositorio Git; documentación legible en cualquier visor Markdown
**Project Type**: Documentación operativa (entregable: doc artifact en `docs/operations/`)
**Performance Goals**: El documento debe permitir que un SRE identifique el alcance de restauración por dominio en < 10 minutos (SC-001)
**Constraints**: No debe contener credenciales, secrets, URLs internas ni información sensible (FR-007); debe mantenerse coherente con T01–T05 (FR-008, CA-11)
**Scale/Scope**: 6 dominios (IAM/Keycloak, PostgreSQL, MongoDB, Kafka, OpenWhisk, S3-compatible), ~1 documento Markdown de referencia operativa + índice actualizado en `docs/operations/`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio constitucional | Estado | Nota |
|---|---|---|
| **I. Monorepo Separation of Concerns** | ✅ | Artefacto de doc en `docs/operations/`; sin nuevas carpetas top-level. |
| **II. Incremental Delivery First** | ✅ | Tarea documentación pura; no introduce framework ni infra nueva. |
| **III. Kubernetes/OpenShift Compatibility** | ✅ N/A | No hay artefactos de despliegue. |
| **IV. Quality Gates at the Root** | ✅ | No cambia gates de calidad; la verificación es revisión manual. |
| **V. Documentation as Part of the Change** | ✅ | El objetivo de la tarea es, precisamente, documentar. Ubicación `docs/operations/`. |
| **Additional: Secrets not committed** | ✅ | El doc sólo puede referenciar nombres de env vars, nunca valores. |

No se detectan violaciones. Complexity Tracking no aplica.

## Project Structure

### Documentation (this feature)

```text
specs/120-config-vs-data-restore-differences/
├── plan.md              # Este archivo (/speckit.plan output)
├── research.md          # Phase 0 output (/speckit.plan)
├── data-model.md        # Phase 1 output (/speckit.plan)
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code / Documentation (repository root)

```text
docs/
└── operations/
    ├── config-vs-data-restore-differences.md   # [NEW] Documento operativo principal
    └── (otros archivos existentes sin cambio)
```

No se crean nuevas carpetas top-level. No hay cambios en `apps/`, `services/`, `charts/` ni `tests/`.

**Structure Decision**: Documento único en `docs/operations/` — coherente con el patrón existente (ej: `docs/operations/secret-management.md`). El artefacto es auto-contenido y referenciable desde runbooks externos.

## Phase 0: Research

*Ver archivo `research.md` generado en esta misma fase.*

Alcance de la investigación:

1. **Inventario de elementos exportados por T01 por dominio** — extraído de la especificación de US-BKP-02-T01 y del código de los recolectores en `services/provisioning-orchestrator/src/collectors/`.
2. **Inventario de elementos aplicados por T03** — extraído de la especificación de US-BKP-02-T03.
3. **Mecanismos nativos de backup de datos por subsistema** — identificados mediante documentación oficial (pg_dump, mongodump, Kafka MirrorMaker, replicación S3-compatible, Keycloak export).
4. **Limitaciones transversales** — secretos redactados, configuración emergente, no-transaccionalidad cross-domain, dominios opcionales.
5. **Audiencias y estructura de comunicación** — roles (SRE, superadmin, tenant owner, producto, QA/auditoría) y sus necesidades diferenciadas.

## Phase 1: Design & Document Structure

*Ver archivo `data-model.md` generado en esta misma fase.*

### Estructura del documento operativo principal

`docs/operations/config-vs-data-restore-differences.md` se organiza en las secciones siguientes:

```
1. Resumen ejecutivo
   - ¿Qué restaura el reaprovisionamiento de configuración?
   - ¿Qué NO restaura?
   - Mecanismos complementarios disponibles
   - Gaps principales identificados

2. Tabla resumen de alto nivel (6 dominios × 4 columnas)
   - Dominio | Configuración restaurable | Datos NO restaurables | Gap status

3. Detalle por dominio (1 sección por dominio)
   3.1 IAM (Keycloak)
   3.2 PostgreSQL
   3.3 MongoDB
   3.4 Kafka
   3.5 Funciones (OpenWhisk)
   3.6 Almacenamiento (S3-compatible)

   Cada sección incluye:
   - Configuración restaurable (alineada con T01/T03)
   - Datos de usuario NO restaurables
   - Mecanismo complementario nativo (o gap si no existe)
   - Notas de opcionalidad / vars de entorno relevantes

4. Limitaciones transversales
   - Secretos redactados (***REDACTED***)
   - Configuración dinámica/emergente
   - Incoherencia posible config-datos post-restauración
   - No-transaccionalidad cross-domain
   - Dominios opcionales según perfil de despliegue

5. Recomendaciones operativas
   - Orden recomendado de restauración (config primero, datos después)
   - Verificación post-restauración
   - Periodicidad recomendada de exportaciones y backups
   - Integración con pruebas de T05

6. Trazabilidad y mantenibilidad
   - Referencia a T01–T05 como fuente de verdad
   - Procedimiento para actualizar el documento ante cambios de alcance
```

### Entidades documentales (data-model)

| Entidad | Descripción |
|---|---|
| `RestoreDomain` | Cada uno de los 6 subsistemas cubiertos por el artefacto de exportación |
| `RestorableConfig` | Lista de elementos de configuración que T01 exporta y T03 aplica para un dominio |
| `NonRestorableData` | Lista de datos de usuario que quedan fuera del alcance del reaprovisionamiento |
| `ComplementaryMechanism` | Herramienta o proceso nativo del subsistema capaz de cubrir el gap de datos |
| `GapStatus` | Clasificación: `cubierto` / `parcialmente_cubierto` / `no_cubierto` |
| `TransversalLimitation` | Limitación que afecta a todos los dominios (secretos, dinamismo, etc.) |

### Verificación de completitud (alineada con CAs del spec)

| CA | Verificación implementada en el doc |
|---|---|
| CA-01 | Tabla resumen con 6 entradas, 4 columnas cada una |
| CA-02 | Sección 3.1 IAM con 3 sub-apartados |
| CA-03 | Sección 3.2 PostgreSQL con 3 sub-apartados |
| CA-04 | Sección 3.3 MongoDB con nota de opcionalidad |
| CA-05 | Sección 3.4 Kafka con nota sobre mensajes efímeros |
| CA-06 | Sección 3.5 Funciones con nota de redacción de secretos |
| CA-07 | Sección 3.6 Almacenamiento con herramientas de sync |
| CA-08 | Sección 4 cubre las 5 limitaciones transversales requeridas |
| CA-09 | Sección 5 incluye orden, verificación y referencia a T05 |
| CA-10 | Sección 1 (resumen ejecutivo) autónoma ≤ 1 página |
| CA-11 | Fuentes de verdad: specs T01–T05 + código recolectores |
| CA-12 | Revisión manual pre-commit: sin credenciales ni URLs internas |
| CA-13 | Formato Markdown en `docs/operations/`; sin dependencias especiales |

## Estrategia de verificación

Esta tarea no produce código ejecutable, por lo que no aplican pruebas unitarias, de integración ni E2E en sentido tradicional. La verificación es:

1. **Revisión de completitud estructural**: cada sección del documento existe y tiene contenido no vacío para los 6 dominios.
2. **Revisión de coherencia con T01–T05**: cada elemento listado como "configuración restaurable" debe tener correspondencia verificable en la especificación de T01 (recolectores) y T03 (aplicadores).
3. **Revisión de ausencia de información sensible**: búsqueda manual de patrones de credenciales, URLs de subsistemas con hostnames reales, valores de secretos.
4. **Prueba de legibilidad por audiencia**: el resumen ejecutivo (sección 1) debe ser comprensible por un lector no técnico; el detalle por dominio (sección 3) debe ser accionable para un SRE.

## Riesgos, dependencias y secuencia

### Dependencias de entrada

| Dependencia | Estado asumido | Impacto si no disponible |
|---|---|---|
| Especificación US-BKP-02-T01 (recolectores exportados) | Especificada y aceptada | Bloquea definición de "configuración restaurable" por dominio |
| Especificación US-BKP-02-T03 (aplicadores de reaprovisionamiento) | Especificada y aceptada | Bloquea verificación de qué configuración se aplica realmente |
| Código de recolectores en `services/provisioning-orchestrator/src/collectors/` | Fusionado en rama principal o en la rama actual | Permite verificar precisión del inventario |

### Riesgos

| ID | Riesgo | Mitigación en el plan |
|---|---|---|
| R-01 | Desactualización ante cambios en T01–T05 | Sección 6 del doc establece procedimiento de actualización; el doc referencia las specs como fuente de verdad |
| R-02 | Mecanismos complementarios no operativos en todos los entornos | El doc distingue "mecanismo nativo disponible" vs. "mecanismo configurado"; no asegura operatividad en ningún entorno concreto |
| R-03 | Audienecia demasiado técnica o superficial | Estructura en niveles: sección 1 no técnica, sección 3 técnica-operativa |

### Secuencia de implementación

```
[Fase plan — esta fase]
  → research.md: inventario de T01/T03 + mecanismos nativos
  → data-model.md: entidades documentales y estructura del doc

[Fase tasks — /speckit.tasks]
  → Task 1: Redactar secciones 1–2 (resumen ejecutivo + tabla resumen)
  → Task 2: Redactar sección 3 (detalle por dominio, los 6 subdominios)
  → Task 3: Redactar secciones 4–6 (limitaciones, recomendaciones, trazabilidad)
  → Task 4: Revisión de coherencia con T01–T05 + verificación sin datos sensibles
  → Task 5: Commit del artefacto en docs/operations/ + actualización de índices si aplica
```

## Criterios de done verificables

- [ ] `docs/operations/config-vs-data-restore-differences.md` existe y contiene las 6 secciones principales.
- [ ] La tabla resumen cubre los 6 dominios con las 4 columnas requeridas (CA-01).
- [ ] Cada dominio tiene sección de detalle con sub-apartados: configuración restaurable / datos no restaurables / mecanismo complementario (CA-02 a CA-07).
- [ ] La sección de limitaciones transversales menciona los 5 elementos requeridos por CA-08.
- [ ] La sección de recomendaciones operativas incluye orden de restauración, verificación y referencia a T05 (CA-09).
- [ ] El resumen ejecutivo es autónomo y no supera 1 página Markdown (CA-10).
- [ ] Revisión de coherencia completada: ningún elemento declarado como restaurable contradice las specs de T01–T05 (CA-11).
- [ ] Revisión de seguridad completada: el documento no contiene credenciales, tokens, secretos ni URLs internas (CA-12).
- [ ] Formato Markdown; legible sin herramientas especiales (CA-13).
- [ ] Artefacto commiteado y pusheado en la rama `120-config-vs-data-restore-differences`.

---

*Plan generado para el stage `speckit.plan` — US-BKP-02-T06 | Rama: `120-config-vs-data-restore-differences`*
