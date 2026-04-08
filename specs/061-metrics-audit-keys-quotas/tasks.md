<!-- markdownlint-disable MD031 MD040 -->
# Tasks — US-UI-04-T01: Vistas de métricas, auditoría, service accounts y cuotas

**Feature Branch**: `061-metrics-audit-keys-quotas`
**Task ID**: US-UI-04-T01
**Estado**: Ready for implement
**Fecha**: 2026-03-29

---

## Resumen ejecutivo

Entregar la superficie frontend completa de gobierno operativo para la consola administrativa del BaaS multi-tenant dentro de `apps/web-console/`, reemplazando el placeholder de observabilidad y añadiendo dos rutas nuevas:

1. `ConsoleObservabilityPage` en `/console/observability` con dos pestañas:
   - **Métricas**: overview de consumo, posture de cuota, selector temporal y estados vacíos/errores.
   - **Auditoría**: listado filtrable, detalle expandible y exportación.
2. `ConsoleServiceAccountsPage` en `/console/service-accounts`:
   - creación de service accounts,
   - emisión de credenciales con secreto visible una sola vez,
   - revocación y rotación,
   - limitación explícita: sin endpoint de listado global, la UI parte de IDs persistidos localmente por workspace.
3. `ConsoleQuotasPage` en `/console/quotas`:
   - postura general de cuotas,
   - tabla por dimensión con warning/exceeded,
   - sección secundaria para workspace cuando exista contexto activo,
   - botón informativo de ajuste visible solo para superadmin, sin mutación real.
4. Módulos de datos, componentes visuales compartidos, navegación lateral/routers y tests unitarios/integración asociados.

**Límite estricto del diff**: `apps/web-console/` y `specs/061-metrics-audit-keys-quotas/` únicamente.

---

## Mapa de archivos de implementación

> **Regla maestra para implement**: lee únicamente `plan.md`, `tasks.md`, los archivos listados aquí y los family files OpenAPI indicados. **No leas** `apps/control-plane/openapi/control-plane.openapi.json`.

### Family files OpenAPI permitidos (solo lectura focalizada)

```text
apps/control-plane/openapi/families/metrics.openapi.json           ← LEER solo los paths necesarios para:
                                                                       - tenant quota usage overview
                                                                       - tenant quota posture
                                                                       - tenant usage snapshot
                                                                       - tenant audit records
                                                                       - tenant audit export
                                                                       - workspace quota usage overview
                                                                       - workspace quota posture
                                                                       - workspace usage snapshot
                                                                       - workspace audit records
                                                                       - workspace metric series
                                                                     y solo los request/response schemas directamente referenciados por esos paths.

apps/control-plane/openapi/families/workspaces.openapi.json        ← LEER solo los paths necesarios para:
                                                                       - createServiceAccount
                                                                       - getServiceAccount
                                                                       - issueServiceAccountCredential
                                                                       - revokeServiceAccountCredential
                                                                       - rotateServiceAccountCredential
                                                                     y solo los request/response schemas directamente referenciados por esos paths.
```

### Archivos de código a leer/modificar/crear

```text
apps/web-console/src/lib/console-context.tsx                       ← LEER solo bloque inicial de tipos + contrato de useConsoleContext()
apps/web-console/src/lib/console-session.ts                        ← LEER solo bloque inicial + tramo donde vive requestConsoleSessionJson()
apps/web-console/src/layouts/ConsoleShellLayout.tsx                ← MODIFICAR
apps/web-console/src/layouts/ConsoleShellLayout.test.tsx           ← MODIFICAR (leer imports + primer test antes de ampliar)
apps/web-console/src/router.tsx                                    ← MODIFICAR
apps/web-console/src/router.test.tsx                               ← MODIFICAR

apps/web-console/src/lib/console-metrics.ts                        ← CREAR
apps/web-console/src/lib/console-metrics.test.ts                   ← CREAR
apps/web-console/src/lib/console-service-accounts.ts               ← CREAR
apps/web-console/src/lib/console-service-accounts.test.ts          ← CREAR
apps/web-console/src/lib/console-quotas.ts                         ← CREAR
apps/web-console/src/lib/console-quotas.test.ts                    ← CREAR

apps/web-console/src/components/console/ConsolePageState.tsx       ← CREAR
apps/web-console/src/components/console/ConsoleTimeRangeSelector.tsx ← CREAR
apps/web-console/src/components/console/ConsoleTimeRangeSelector.test.tsx ← CREAR
apps/web-console/src/components/console/ConsoleMetricDimensionRow.tsx ← CREAR
apps/web-console/src/components/console/ConsoleQuotaPostureBadge.tsx ← CREAR
apps/web-console/src/components/console/ConsoleQuotaPostureBadge.test.tsx ← CREAR
apps/web-console/src/components/console/ConsoleAuditCategoryBadge.tsx ← CREAR
apps/web-console/src/components/console/ConsoleAuditResultBadge.tsx ← CREAR
apps/web-console/src/components/console/ConsoleAuditRecordDetail.tsx ← CREAR
apps/web-console/src/components/console/ConsoleCredentialStatusBadge.tsx ← CREAR

apps/web-console/src/pages/ConsoleObservabilityPage.tsx            ← CREAR
apps/web-console/src/pages/ConsoleObservabilityPage.test.tsx       ← CREAR
apps/web-console/src/pages/ConsoleServiceAccountsPage.tsx          ← CREAR
apps/web-console/src/pages/ConsoleServiceAccountsPage.test.tsx     ← CREAR
apps/web-console/src/pages/ConsoleQuotasPage.tsx                   ← CREAR
apps/web-console/src/pages/ConsoleQuotasPage.test.tsx              ← CREAR
```

### Archivos de referencia opcional (lectura acotada)

```text
apps/web-console/src/pages/ConsoleFunctionsPage.tsx                ← REFERENCIA para guards tenant/workspace + patrón de fetch con requestConsoleSessionJson()
apps/web-console/src/pages/ConsoleFunctionsPage.test.tsx           ← REFERENCIA; leer solo imports + primer test + un test feliz de carga
apps/web-console/src/pages/ConsoleAuthPage.tsx                     ← REFERENCIA para tablas + badges + formularios de consola
```

---

## Reglas obligatorias de lectura y token-optimization para implement

1. **Contexto Spec Kit mínimo**: leer únicamente `specs/061-metrics-audit-keys-quotas/plan.md` y `specs/061-metrics-audit-keys-quotas/tasks.md`.
2. **No Full OpenAPI**: está prohibido leer `apps/control-plane/openapi/control-plane.openapi.json`.
3. **OpenAPI focalizado**: leer solo `metrics.openapi.json` y `workspaces.openapi.json`, y dentro de cada uno solo los paths/schemas listados arriba.
4. **Focused helper reads**:
   - `console-session.ts`: leer primero solo las primeras ~140 líneas y luego, si hace falta, el bloque concreto de `requestConsoleSessionJson()`.
   - `console-context.tsx`: leer primero solo las primeras ~180 líneas y luego, si hace falta, el bloque concreto donde se exporta `useConsoleContext()` y el shape consumido por las páginas.
5. **Focused test reads**:
   - `ConsoleFunctionsPage.test.tsx`: leer solo imports + primer test + un test asíncrono de referencia; no todo el archivo.
6. **No exploratory browsing**: no uses `find` ni `ls` para explorar el repo. El mapa de arriba es la fuente de verdad.
7. **Sin lectura de `src/components/ui/*`** salvo que un error de typecheck obligue a comprobar una firma concreta; prioriza HTML semántico + `Button`/`Badge` ya conocidos.
8. **La regeneración de API pública solo aplica si fuera necesaria por contrato**. Como T01 no modifica OpenAPI, no regeneres artefactos salvo que un validador/CI lo exija explícitamente.

---

## Tarea T1 — Implementar módulos de datos compartidos

### Objetivo T3

Crear la capa de acceso y normalización de datos para métricas/auditoría, service accounts/credenciales y cuotas, manteniendo el patrón repo-local de hooks con `requestConsoleSessionJson()` y reseteo por cambio de contexto.

### Archivos T3

```text
apps/web-console/src/lib/console-metrics.ts
apps/web-console/src/lib/console-metrics.test.ts
apps/web-console/src/lib/console-service-accounts.ts
apps/web-console/src/lib/console-service-accounts.test.ts
apps/web-console/src/lib/console-quotas.ts
apps/web-console/src/lib/console-quotas.test.ts
```

### Subtareas T3

#### T1.1 — `console-metrics.ts`

Implementar:

- tipos UI normalizados para métricas y auditoría;
- `useConsoleMetrics(tenantId, workspaceId, range)`;
- `useConsoleAuditRecords(tenantId, workspaceId, filters)`;
- `exportAuditRecords(tenantId, workspaceId, filters)`.

Requisitos concretos:

- Si hay `workspaceId`, usar endpoints workspace-first; si no, usar tenant-first.
- Derivar `pctUsed`, `hasQuotaWarning`, labels legibles y freshness defensiva.
- Exponer `{ loading, error, reload }` sin stores globales nuevos.
- Soportar rangos `24h`, `7d`, `30d`, `custom`.
- Mapear `403` a mensaje claro de acceso denegado.
- Para auditoría, serializar filtros opcionales sin enviar query params vacíos.
- Mantener el detalle completo del evento para el panel expandible.

#### T1.2 — `console-service-accounts.ts`

Implementar:

- tipos UI normalizados para service account, credential reference e issued credential;
- `useConsoleServiceAccounts(workspaceId)` o equivalente de alto nivel que sirva para la página;
- `createServiceAccount()`;
- `issueServiceAccountCredential()`;
- `revokeServiceAccountCredential()`;
- `rotateServiceAccountCredential()`.

Regla funcional crítica:

- Como no existe endpoint de listado global, persistir localmente por workspace los IDs de service account creados/ya conocidos y rehidratar cada ficha con `getServiceAccount`.
- Usar una clave de `sessionStorage`/`localStorage` namespaced por workspace; por ejemplo:

```text
in-falcone.console-service-account-index:<workspaceId>
```

- Si el índice está vacío, la página debe mostrar empty state explícito y permitir crear el primer service account.
- El secreto devuelto por emisión/rotación **no se persiste**; solo se devuelve al caller para el modal efímero.

#### T1.3 — `console-quotas.ts`

Implementar:

- `useConsoleQuotas(tenantId, workspaceId)`;
- tipos UI con `isWarning`, `isExceeded`, `overallPosture`, `evaluatedAt`, `generatedAt`.

Reglas:

- Fuente principal: `quota posture` + `quota usage overview`.
- Si existe `workspaceId`, cargar también la visión workspace.
- `isWarning` = `pctUsed >= 80`.
- `isExceeded` = `pctUsed >= 100` o la dimensión figura en breach/hard-limit set del contrato.
- Preservar `policyMode`, `freshnessStatus`, `remainingToHardLimit`.

### Tests mínimos en T1

- normalización correcta de payloads a tipos UI;
- transición `loading → success`;
- transición `loading → error`;
- recarga por cambio de tenant/workspace;
- emisión/revocación/rotación con payloads correctos;
- exportación de auditoría con llamada HTTP correcta;
- derivación de `pctUsed`, `hasQuotaWarning`, `isWarning`, `isExceeded`.

---

## Tarea T2 — Crear componentes visuales compartidos

### Objetivo T2

Crear primitives reutilizables para los tres dominios, evitando duplicar badges, estados y selectores en páginas distintas.

### Archivos T2

```text
apps/web-console/src/components/console/ConsolePageState.tsx
apps/web-console/src/components/console/ConsoleTimeRangeSelector.tsx
apps/web-console/src/components/console/ConsoleTimeRangeSelector.test.tsx
apps/web-console/src/components/console/ConsoleMetricDimensionRow.tsx
apps/web-console/src/components/console/ConsoleQuotaPostureBadge.tsx
apps/web-console/src/components/console/ConsoleQuotaPostureBadge.test.tsx
apps/web-console/src/components/console/ConsoleAuditCategoryBadge.tsx
apps/web-console/src/components/console/ConsoleAuditResultBadge.tsx
apps/web-console/src/components/console/ConsoleAuditRecordDetail.tsx
apps/web-console/src/components/console/ConsoleCredentialStatusBadge.tsx
```

### Subtareas T2

#### T2.1 — `ConsolePageState`

Crear un wrapper mínimo y accesible para estados de:

- loading (`aria-busy`),
- error (`role="alert"` + retry callback opcional),
- empty,
- blocked / missing context.

Debe ser genérico para reutilizarlo en las tres páginas.

#### T2.2 — `ConsoleTimeRangeSelector`

Implementar un selector simple y accesible con opciones:

- `24h`
- `7d`
- `30d`
- `custom`

No hace falta un date picker complejo: cuando `custom` esté activo, basta con dos inputs controlados de fecha/hora o ISO simple para `from` y `to`.

#### T2.3 — Badges y filas visuales

Crear:

- `ConsoleMetricDimensionRow` con `<progress>` y texto visible de consumo/límite;
- `ConsoleQuotaPostureBadge` con variantes defensivas para posture desconocido;
- `ConsoleAuditCategoryBadge`;
- `ConsoleAuditResultBadge`;
- `ConsoleCredentialStatusBadge`;
- `ConsoleAuditRecordDetail` mostrando actor, recurso, origin, correlation y metadatos visibles.

### Tests mínimos en T2

- `ConsoleTimeRangeSelector` cambia el valor y expone opciones accesibles.
- `ConsoleQuotaPostureBadge` renderiza variantes nominal/warning/exceeded/desconocida.

---

## Tarea T3 — Implementar `ConsoleObservabilityPage`

### Objetivo T4

Reemplazar el placeholder de `/console/observability` por una página real con pestañas **Métricas** y **Auditoría**.

### Archivos T4

```text
apps/web-console/src/pages/ConsoleObservabilityPage.tsx
apps/web-console/src/pages/ConsoleObservabilityPage.test.tsx
```

### Subtareas T4

#### T3.1 — Guardas y header

- Si no hay `activeTenantId`, mostrar estado bloqueado indicando que debe seleccionarse un tenant.
- Mostrar nombre del tenant/workspace activos cuando existan.
- Mostrar `generatedAt` / `evaluatedAt` / última actualización cuando el hook lo aporte.

#### T3.2 — Pestaña Métricas

Renderizar:

- selector temporal;
- badge de posture global;
- lista de dimensiones con barras/progreso;
- mensaje contextual cuando no haya datos;
- soporte tenant-only y workspace-specific.

Comportamiento esperado:

- cambiar rango relanza fetch;
- warning/exceeded se comunica visualmente;
- no usar librerías de charts.

#### T3.3 — Pestaña Auditoría

Renderizar:

- filtros por actor, categoría, resultado y rango temporal;
- tabla/lista de registros;
- fila expandible con `ConsoleAuditRecordDetail`;
- acción `Exportar` que invoque `exportAuditRecords` y muestre confirmación de inicio.

No introducir paginación compleja; basta una primera carga funcional de hasta 50 registros.

### Tests mínimos en T3

- renderiza métricas nominales con dimensiones visibles;
- cambio de rango provoca nueva consulta;
- estado vacío en métricas no aparece como error;
- auditoría aplica filtros y muestra fila expandible;
- exportar dispara la acción correcta;
- loading/error accesibles en ambas pestañas.

---

## Tarea T4 — Implementar `ConsoleServiceAccountsPage`

### Objetivo T5

Crear la página de service accounts y credenciales del workspace activo, respetando la limitación contractual del listado y el requisito de secreto de una sola visualización.

### Archivos T5

```text
apps/web-console/src/pages/ConsoleServiceAccountsPage.tsx
apps/web-console/src/pages/ConsoleServiceAccountsPage.test.tsx
```

### Subtareas T5

#### T4.1 — Guardas del contexto activo

- Si no hay tenant seleccionado, mostrar bloqueo contextual.
- Si no hay workspace seleccionado, mostrar bloqueo contextual.
- Si `activeTenant?.state !== 'active'`, deshabilitar acciones de escritura y explicarlo en pantalla.

#### T4.2 — Tabla y formulario de creación

- Mostrar tabla con:
  - nombre,
  - estado del cliente,
  - estado de credencial,
  - acceso efectivo,
  - expiración,
  - acciones.
- Incluir formulario/modal/drawer para crear service account.
- Tras crear uno nuevo:
  - persistir su ID en el índice local del workspace;
  - refrescar detalle usando `getServiceAccount`.

#### T4.3 — Emisión, revocación y rotación

- Incluir botones de acción por fila.
- Emisión y rotación deben abrir un modal de éxito con:
  - secreto visible,
  - botón de copia,
  - aviso explícito de una sola visualización.
- Al cerrar el modal, limpiar completamente el secreto del estado.
- Revocación puede ser inline/simple; no añadas la UX reforzada de T03.

#### T4.4 — Empty state contractual

Si el índice local del workspace está vacío, mostrar un empty state honesto; por ejemplo:

- no hay service accounts conocidas todavía en este navegador para este workspace;
- crea una nueva para empezar;
- el listado global quedará completo cuando el backend exponga un endpoint dedicado.

### Tests mínimos en T4

- sin workspace: mensaje bloqueante;
- tenant inactivo: acciones deshabilitadas;
- creación envía payload correcto y refresca;
- emisión muestra secreto y lo limpia al cerrar;
- revocación y rotación llaman al endpoint correcto;
- empty state contractual visible cuando no hay IDs persistidos.

---

## Tarea T5 — Implementar `ConsoleQuotasPage`

### Objetivo T6

Crear la vista de cuotas del tenant/workspace activo con highlighting visual y limitación explícita de edición real.

### Archivos T6

```text
apps/web-console/src/pages/ConsoleQuotasPage.tsx
apps/web-console/src/pages/ConsoleQuotasPage.test.tsx
```

### Subtareas T6

#### T5.1 — Header y postura global

- Mostrar tenant activo y `ConsoleQuotaPostureBadge`.
- Mostrar `evaluatedAt` cuando exista.

#### T5.2 — Tabla por dimensión

Renderizar columnas mínimas:

- dimensión,
- límite,
- consumo actual,
- `% uso`,
- `policyMode`,
- `freshnessStatus`.

Comportamiento visual:

- `isWarning` → estilo ámbar / alerta;
- `isExceeded` → estilo rojo / bloqueo;
- `policyMode = unbounded` → sin porcentaje engañoso.

#### T5.3 — Sección workspace y CTA superadmin

- Si hay `activeWorkspaceId`, mostrar una sección secundaria con la vista workspace.
- Si el usuario tiene rol de superadmin, mostrar botón informativo `Ajustar cuota` por dimensión.
- Ese botón **no** debe mutar backend; solo mostrar mensaje de que la edición real queda fuera de T01 / depende del panel de plataforma.

### Tests mínimos en T5

- dimensiones nominales, warning y exceeded se renderizan con señales distintas;
- render tenant + workspace cuando ambos existan;
- el CTA de superadmin aparece solo cuando corresponde;
- loading/error/empty visibles y accesibles.

---

## Tarea T6 — Actualizar router y navegación lateral

### Objetivo T7

Conectar las nuevas páginas a la navegación real de la consola.

### Archivos T7

```text
apps/web-console/src/router.tsx
apps/web-console/src/router.test.tsx
apps/web-console/src/layouts/ConsoleShellLayout.tsx
apps/web-console/src/layouts/ConsoleShellLayout.test.tsx
```

### Subtareas T7

#### T6.1 — Router

- sustituir el placeholder de `observability` por `ConsoleObservabilityPage` lazy-loaded;
- añadir lazy imports y rutas para:
  - `/console/service-accounts`
  - `/console/quotas`

#### T6.2 — Sidebar

Actualizar `consoleNavigationItems` para que aparezcan entradas navegables claras para:

- Observability
- Service Accounts
- Quotas

Mantener consistencia de labels/descriptions con el resto del shell.

### Tests mínimos en T6

- `router.test.tsx` verifica que `/console/observability` ya no es placeholder;
- `router.test.tsx` verifica nuevas rutas registradas;
- `ConsoleShellLayout.test.tsx` verifica presencia/navegabilidad de links nuevos sin romper header/avatar/contexto.

---

## Tarea T7 — Validación local, commit, push, PR, CI y merge

### Objetivo

Completar el `implement` end-to-end sin pedir confirmación adicional: código, tests, validación, commit, push, PR, seguimiento de checks, fixups si fallan y merge a `main` cuando CI esté verde.

### Validaciones mínimas obligatorias

Desde `/root/projects/falcone/apps/web-console`:

```sh
corepack pnpm test -- src/lib/console-metrics.test.ts src/lib/console-service-accounts.test.ts src/lib/console-quotas.test.ts src/pages/ConsoleObservabilityPage.test.tsx src/pages/ConsoleServiceAccountsPage.test.tsx src/pages/ConsoleQuotasPage.test.tsx src/components/console/ConsoleTimeRangeSelector.test.tsx src/components/console/ConsoleQuotaPostureBadge.test.tsx src/router.test.tsx src/layouts/ConsoleShellLayout.test.tsx
corepack pnpm typecheck
corepack pnpm build
```

Desde `/root/projects/falcone`:

```sh
npm run lint
```

### Reglas operativas del implement

- Si un test falla, corrige el código o el test antes de seguir.
- Si `npm run lint` falla por markdownlint en artefactos Spec Kit, aplica la corrección mínima local a los markdown de la spec actual.
- No delegar a `test-runner` ni `github-repo-manager`.
- Hacer commit en la rama `061-metrics-audit-keys-quotas`.
- Push, abrir PR contra `main`, monitorizar CI, aplicar fixups si hace falta y mergear al quedar verde.
- Después del merge, fast-forward local `main` y dejar el worktree limpio.

---

## Criterios de done

| Criterio | Verificación |
|---|---|
| `/console/observability` ya no renderiza placeholder | test de router + render de página real |
| Existe `ConsoleObservabilityPage` con pestañas Métricas/Auditoría | test de integración |
| El rango temporal actualiza la consulta | test de página |
| El log de auditoría filtra y expande detalle | test de página |
| Existe `/console/service-accounts` y permite crear/emitir/revocar/rotar | tests + validación manual mínima |
| El secreto solo se muestra una vez y se limpia al cerrar | test de página |
| Existe `/console/quotas` con warning/exceeded visual | test de página |
| Sidebar expone links a Observability, Service Accounts y Quotas | test del shell |
| No se leyó ni tocó `control-plane.openapi.json` | disciplina de implementación + diff final |
| `test`, `typecheck`, `build` y `npm run lint` quedan verdes | salidas locales |
| La rama se publica, la PR se valida y queda mergeada | evidencia de git/gh/CI |
| `main` local queda fast-forward y limpio tras merge | `git status --short --branch` |

---

## Notas de implementación a respetar

1. **No inventar backend nuevo**: T01 consume contratos existentes únicamente.
2. **Sin edición real de cuotas**: CTA informativo solo para superadmin.
3. **Sin wizard/confirmación avanzada**: eso pertenece a T02/T03.
4. **Aislamiento multi-tenant**: todas las páginas dependen del `activeTenantId`/`activeWorkspaceId` y se resetean al cambiar contexto.
5. **Accesibilidad primero**: usa headings, tablas semánticas, `role="alert"`, `aria-busy`, labels visibles y copy claro.
6. **Persistencia mínima y segura**:
   - se puede persistir el índice local de IDs de service account por workspace;
   - **no** se puede persistir el secreto emitido/rotado.
