# Tasks — UX Regression Tests: Wizards, Confirmaciones y Snippets

**Spec**: `066-ux-regression-tests-wizards-confirmations-snippets`
**Task ID**: US-UI-04-T06
**Epic**: EP-15 — Consola de administración: dominios funcionales
**Historia**: US-UI-04 — Métricas, auditoría, API keys, cuotas, wizards, warnings y snippets
**Fecha de tasks**: 2026-03-29
**Estado**: Ready-for-implement

---

## Executive Summary

US-UI-04-T06 materializa la suite de regresión de UX que protege los tres grupos de comportamiento introducidos por T02 (wizards), T03 (confirmaciones destructivas) y T05 (snippets). La infraestructura de testing ya existe (`vitest` + `@testing-library/react` + `jsdom`). Los componentes objetivo (`WizardShell`, `DestructiveConfirmationDialog`, `ConnectionSnippets`) ya están implementados con tests de humo iniciales. Esta tarea extiende esa cobertura hasta los 26 escenarios de aceptación `RW-*`, `RC-*`, `RS-*` definidos en la spec, mediante fixtures compartidos deterministas, trazabilidad explícita y ejecución integrada en CI. No se añaden dependencias nuevas al stack.

---

## Implement Guardrails

> **MANDATORY — El paso `implement` DEBE seguir estas restricciones sin excepción.**

1. **No se permite navegación exploratoria del repositorio**: no usar `find`, `ls -R`, `grep -r` sobre rutas no listadas en este archivo.
2. **Solo se pueden leer los archivos listados en la sección "Implementation File Map"** de este documento (columnas MODIFY, CREATE, READ-ONLY).
3. **No se requiere exploración de API de backend ni de especificaciones OpenAPI**: todos los contratos de mock están definidos explícitamente en la sección § Contratos de Mock de este documento.
4. **Preferir cambios de test/fixture**, pero se permiten cambios de producción mínimos cuando el comportamiento actual del componente impide materializar un escenario aceptado de regresión. En esta tarea, esos cambios de producción quedan limitados exclusivamente a los archivos listados en la sección MODIFY de este documento.
5. **No se crean archivos fuera del file map** a continuación.
6. Si un componente referenciado no existe aún (ej. wizard pendiente de T02), se escribe el test igual contra el contrato de props especificado; los tests fallan hasta que el componente esté listo (comportamiento esperado como gate de calidad).
7. Los imports de tipos (`SnippetContext`, `SnippetTemplate`) se obtienen únicamente de los archivos READ-ONLY listados.
8. Los patrones de test se toman del archivo `WizardShell.test.tsx` existente (READ-ONLY) para coherencia de estilo.

---

## Implementation File Map

### CREATE (archivos nuevos — todos son archivos de test o fixture)

| Archivo                                                                            | Propósito                                            |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `apps/web-console/src/test/fixtures/tenants.ts`                                    | Fixtures: 2 tenants, 3 workspaces                    |
| `apps/web-console/src/test/fixtures/resources.ts`                                  | Fixtures: 5 tipos de recurso + estados transitorios  |
| `apps/web-console/src/test/fixtures/permissions.ts`                                | Fixtures: roles de plataforma diferenciados          |
| `apps/web-console/src/test/fixtures/quotas.ts`                                     | Fixtures: posturas de cuota disponible y excedida    |
| `apps/web-console/src/test/fixtures/snippets.ts`                                   | Fixtures: contextos `SnippetContext` representativos |
| `apps/web-console/src/components/console/wizards/CreateWorkspaceWizard.test.tsx`   | Tests RW para CreateWorkspaceWizard                  |
| `apps/web-console/src/components/console/wizards/CreateIamClientWizard.test.tsx`   | Tests RW para CreateIamClientWizard                  |
| `apps/web-console/src/components/console/wizards/InviteUserWizard.test.tsx`        | Tests RW para InviteUserWizard                       |
| `apps/web-console/src/components/console/wizards/ProvisionDatabaseWizard.test.tsx` | Tests RW para ProvisionDatabaseWizard                |
| `apps/web-console/src/components/console/wizards/PublishFunctionWizard.test.tsx`   | Tests RW para PublishFunctionWizard                  |

### MODIFY (archivos existentes que se amplían)

| Archivo                                                                          | Cambios requeridos                                                                               |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `apps/web-console/src/components/console/wizards/WizardShell.test.tsx`           | Añadir escenarios RW-01, RW-03, RW-04, RW-06 (RW-02 y RW-05 ya cubiertos)                        |
| `apps/web-console/src/components/console/wizards/CreateTenantWizard.test.tsx`    | Añadir escenarios RW-07 (cuota excedida) y RW-08 (sin permisos)                                  |
| `apps/web-console/src/components/console/DestructiveConfirmationDialog.test.tsx` | Añadir escenarios RC-03, RC-06 (click-outside), RC-07 (redirect), RC-10                          |
| `apps/web-console/src/components/console/ConnectionSnippets.test.tsx`            | Añadir escenarios RS-02, RS-03, RS-05, RS-06, RS-08 + test aislamiento multi-tenant              |
| `apps/web-console/src/components/console/DestructiveConfirmationDialog.tsx`      | Invocar `config.onSuccess?.()` tras una confirmación satisfactoria sin romper el flujo existente |
| `apps/web-console/src/components/console/wizards/CreateWorkspaceWizard.tsx`      | Mostrar `validation.blockingError` en el paso de nombre cuando la cuota bloquea el avance        |
| `apps/web-console/src/components/console/wizards/ProvisionDatabaseWizard.tsx`    | Mostrar `validation.blockingError` en el paso de motor/nombre cuando la cuota bloquea el avance  |
| `apps/web-console/src/components/console/wizards/PublishFunctionWizard.tsx`      | Mostrar `validation.blockingError` en el paso de metadatos cuando la cuota bloquea el avance     |
| `apps/web-console/vite.config.ts`                                                | Añadir entradas en `test.coverage.include` para los módulos objetivo                             |

### READ-ONLY (solo lectura — para tipos, patrones y contratos)

| Archivo                                                                       | Razón                                                            |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `apps/web-console/src/components/console/wizards/WizardShell.test.tsx`        | Patrón de test existente para coherencia de estilo               |
| `apps/web-console/src/components/console/wizards/WizardShell.tsx`             | Props y API del componente                                       |
| `apps/web-console/src/components/console/wizards/CreateTenantWizard.tsx`      | Props y API del wizard                                           |
| `apps/web-console/src/components/console/wizards/CreateWorkspaceWizard.tsx`   | Props y API del wizard                                           |
| `apps/web-console/src/components/console/wizards/CreateIamClientWizard.tsx`   | Props y API del wizard                                           |
| `apps/web-console/src/components/console/wizards/InviteUserWizard.tsx`        | Props y API del wizard                                           |
| `apps/web-console/src/components/console/wizards/ProvisionDatabaseWizard.tsx` | Props y API del wizard                                           |
| `apps/web-console/src/components/console/wizards/PublishFunctionWizard.tsx`   | Props y API del wizard                                           |
| `apps/web-console/src/components/console/DestructiveConfirmationDialog.tsx`   | Props y API del componente                                       |
| `apps/web-console/src/components/console/ConnectionSnippets.tsx`              | Props y API del componente                                       |
| `apps/web-console/src/lib/snippets/snippet-types.ts`                          | Tipo `SnippetContext`, `SnippetTemplate`                         |
| `apps/web-console/src/lib/snippets/snippet-catalog.ts`                        | Catálogo de snippets (labels, lenguajes soportados)              |
| `apps/web-console/src/lib/snippets/snippet-catalog.test.ts`                   | Tests de contrato existentes (referencia de patrón)              |
| `apps/web-console/src/test/setup.ts`                                          | Setup global de testing (no modificar)                           |
| `apps/web-console/src/lib/console-session.ts`                                 | Firma de `requestConsoleSessionJson` y `readConsoleShellSession` |
| `apps/web-console/src/lib/console-quotas.ts`                                  | Firma de `useConsoleQuotas`                                      |
| `apps/web-console/src/lib/destructive-ops.ts`                                 | Firma de `useDestructiveOp` y tipo `CascadeImpact`               |
| `apps/web-console/src/lib/http.ts`                                            | Firma de `requestJson`                                           |

---

## Ordered Task Phases

### Fase 0 — Infraestructura de fixtures (prerequisito de todas las demás)

- [ ] **T0-1** Crear `apps/web-console/src/test/fixtures/` si el directorio no existe.
- [ ] **T0-2** Crear `tenants.ts` con: `FIXTURE_TENANT_ALPHA`, `FIXTURE_TENANT_BETA`, `FIXTURE_WORKSPACE_A1`, `FIXTURE_WORKSPACE_A2`, `FIXTURE_WORKSPACE_B1` (estructuras según plan § 3.1).
- [ ] **T0-3** Crear `resources.ts` con: `FIXTURE_PG_DB`, `FIXTURE_MONGO_COLL`, `FIXTURE_STORAGE_BUCKET`, `FIXTURE_FUNCTION`, `FIXTURE_IAM_CLIENT`, `FIXTURE_PG_DB_PROVISIONING`, `FIXTURE_PG_DB_NO_ENDPOINT` (estructuras según plan § 3.2).
- [ ] **T0-4** Crear `permissions.ts` con: `ROLES_SUPERADMIN`, `ROLES_WORKSPACE_ADMIN`, `ROLES_MEMBER_ONLY`, `ROLES_TENANT_OWNER` (según plan § 3.3).
- [ ] **T0-5** Crear `quotas.ts` con: `QUOTA_AVAILABLE`, `QUOTA_EXCEEDED`, `QUOTA_DB_AVAILABLE`, `QUOTA_DB_EXCEEDED` (según plan § 3.4).
- [ ] **T0-6** Crear `snippets.ts` importando `SnippetContext` de `@/lib/snippets/snippet-types`; exportar `SNIPPET_CTX_POSTGRES`, `SNIPPET_CTX_NO_ENDPOINT`, `SNIPPET_CTX_PROVISIONING`, `SNIPPET_CTX_MONGO`, `SNIPPET_CTX_STORAGE`, `SNIPPET_CTX_FUNCTION`, `SNIPPET_CTX_IAM_CLIENT` (según plan § 3.5).
- [ ] **T0-7** Verificar que los tipos compilables no generan errores de TypeScript ejecutando `tsc --noEmit` en `apps/web-console`.
- [ ] **T0-8** Ejecutar `vitest run` en `apps/web-console` y confirmar que todos los tests existentes siguen pasando (exit code 0).

### Fase 1 — Suite RC: Confirmaciones destructivas

Archivo: `apps/web-console/src/components/console/DestructiveConfirmationDialog.test.tsx`

- [ ] **T1-1** `[RC-03]` Añadir test: resumen de cascada en severity CRITICAL presenta tipos y cantidades. Montar con `cascadeImpact: [{ resourceType: 'workspace', count: 2 }, { resourceType: 'database', count: 5 }]`; verificar que el texto con tipo y cantidad es visible en el DOM.
- [ ] **T1-2** `[RC-06 click-outside]` Ampliar el test existente de cierre (Escape ya cubierto) añadiendo caso: click sobre el overlay/backdrop cierra el diálogo; verificar con `userEvent.click(overlay)` y `expect(dialog).not.toBeInTheDocument()`.
- [ ] **T1-3** `[RC-07 redirect]` Añadir test: tras confirmación exitosa se invoca el callback `onSuccess`. Si el callback tipado ya existe pero el componente todavía no lo dispara, completar el cableado mínimo en `DestructiveConfirmationDialog.tsx` y verificar con `waitFor`.
- [ ] **T1-4** `[RC-10]` Añadir test: no se abren dos diálogos simultáneamente. Renderizar dos instancias del componente; verificar que solo la instancia con `open=true` tiene `role="dialog"` en el DOM; la otra no debe estar presente.
- [ ] **T1-5** Añadir test de aislamiento multi-tenant: renderizar con contexto `TENANT_ALPHA / WORKSPACE_A1`; verificar que ningún valor de `TENANT_BETA` aparece en el DOM.
- [ ] **T1-6** Ejecutar `vitest run DestructiveConfirmationDialog.test.tsx`; todos los tests RC-01..RC-10 deben pasar.

### Fase 2 — Suite RS: Snippets de conexión

Archivo: `apps/web-console/src/components/console/ConnectionSnippets.test.tsx`

- [ ] **T2-1** `[RS-02]` Añadir test: los valores de host/puerto del fixture `SNIPPET_CTX_POSTGRES` (`db.example.test`, `5432`) aparecen en al menos uno de los bloques `<code>` renderizados del snippet, evitando asunciones de unicidad global cuando múltiples ejemplos reutilizan el mismo host/puerto.
- [ ] **T2-2** `[RS-03]` Añadir test: ningún snippet renderizado con `SNIPPET_CTX_POSTGRES` expone contraseña real; verificar presencia de placeholders `<PG_USER>` / `{PASSWORD}` / `<PASSWORD>` y ausencia de cadenas con formato de secreto real (regex `/[A-Za-z0-9+/]{32,}/` excluida de snippets de código).
- [ ] **T2-3** `[RS-05]` Añadir test: con contexto `SNIPPET_CTX_NO_ENDPOINT` los snippets muestran los placeholders actualmente usados por el producto (`<RESOURCE_HOST>` / `<RESOURCE_PORT>`) y una nota explicativa visible ya presente en el componente.
- [ ] **T2-4** `[RS-06]` Añadir test: con contexto `SNIPPET_CTX_PROVISIONING` se muestra advertencia visible al usuario (buscar texto con `/provisionando/i` o `/provisioning/i` o `/no disponible/i`, ajustar al texto real del componente).
- [ ] **T2-5** `[RS-08]` Añadir test: para cada tipo de recurso soportado, verificar que al menos el número de pestañas/lenguajes listados en el catálogo de snippets (`snippet-catalog.ts`) está presente como label en el DOM. Iterar con `SNIPPET_CTX_POSTGRES`, `SNIPPET_CTX_MONGO`, `SNIPPET_CTX_STORAGE`, `SNIPPET_CTX_FUNCTION`, `SNIPPET_CTX_IAM_CLIENT`.
- [ ] **T2-6** Añadir test de aislamiento multi-tenant: renderizar con `SNIPPET_CTX_POSTGRES` (tenantId `ten_alpha`, workspaceSlug `workspace-alpha-1`); verificar que los valores de `TENANT_BETA` (`ten_beta`, `workspace-beta-1`) no aparecen en el DOM.
- [ ] **T2-7** Ejecutar `vitest run ConnectionSnippets.test.tsx`; todos los tests RS-01..RS-08 deben pasar.

### Fase 3 — Suite RW: WizardShell genérico

Archivo: `apps/web-console/src/components/console/wizards/WizardShell.test.tsx`

- [ ] **T3-1** `[RW-01]` Añadir test: navegación adelante y atrás preserva datos del formulario. Usar wizard de 2 pasos; introducir valor en paso 1, avanzar al paso 2, retroceder, verificar que el campo del paso 1 conserva el valor introducido.
- [ ] **T3-2** `[RW-03]` Añadir test: el paso de resumen muestra todos los valores introducidos. Avanzar hasta el paso de resumen; verificar que los valores de los pasos anteriores son visibles en el DOM del resumen.
- [ ] **T3-3** `[RW-04]` Añadir test: desde el resumen, el botón "atrás" navega al último paso de datos. Verificar que al pulsar atrás en el resumen el formulario del último paso de datos es visible.
- [ ] **T3-4** `[RW-06]` Añadir test: error de backend preserva datos del formulario. Mock `onSubmit` que rechaza con error; verificar que el mensaje de error es visible Y que los campos del formulario conservan sus valores.
- [ ] **T3-5** Verificar que los tests RW-02 y RW-05 existentes siguen siendo válidos y pasan.
- [ ] **T3-6** Ejecutar `vitest run WizardShell.test.tsx`; todos los tests RW-01..RW-06 aplicables al shell deben pasar.

### Fase 4 — Suite RW: Wizards específicos

#### 4A — CreateTenantWizard (ampliar)

Archivo: `apps/web-console/src/components/console/wizards/CreateTenantWizard.test.tsx`

- [ ] **T4A-1** `[RW-07 tenant]` Añadir test: con `useConsoleQuotas` mockeado devolviendo `QUOTA_EXCEEDED`, el paso del wizard donde se evalúa la cuota (plan) muestra el aviso de cuota excedida y el botón de avance queda deshabilitado.
- [ ] **T4A-2** `[RW-08 tenant]` Añadir test: con `readConsoleShellSession` mockeado devolviendo `ROLES_MEMBER_ONLY`, el wizard muestra mensaje de permisos insuficientes.
- [ ] **T4A-3** Ejecutar `vitest run CreateTenantWizard.test.tsx`; todos los tests del archivo deben pasar.

#### 4B — CreateWorkspaceWizard (nuevo)

Archivo: `apps/web-console/src/components/console/wizards/CreateWorkspaceWizard.test.tsx`

- [ ] **T4B-1** `[RW-01 workspace]` Happy path: completar wizard, verificar que `onSubmit` es llamado con los datos correctos y el feedback de éxito es visible.
- [ ] **T4B-2** `[RW-02 workspace]` Bloqueo por validación: campo de nombre vacío → botón de avance deshabilitado.
- [ ] **T4B-3** `[RW-06 workspace]` Error de backend: `onSubmit` rechaza → mensaje de error visible; datos del formulario preservados.
- [ ] **T4B-4** `[RW-07 workspace]` Cuota excedida: `QUOTA_EXCEEDED` → aviso visible + avance bloqueado. Si el componente ya bloquea pero no expone el `blockingError`, completar el render mínimo en `CreateWorkspaceWizard.tsx`.
- [ ] **T4B-5** `[RW-08 workspace]` Sin permisos: `ROLES_MEMBER_ONLY` → mensaje de permisos insuficientes.
- [ ] **T4B-6** Ejecutar `vitest run CreateWorkspaceWizard.test.tsx`; todos los tests deben pasar.

#### 4C — CreateIamClientWizard (nuevo)

Archivo: `apps/web-console/src/components/console/wizards/CreateIamClientWizard.test.tsx`

- [ ] **T4C-1** `[RW-02 iam]` Bloqueo por validación en campo de nombre de cliente.
- [ ] **T4C-2** `[RW-05 iam]` Confirmación exitosa muestra feedback con client ID retornado por mock.
- [ ] **T4C-3** `[RW-06 iam]` Error de backend preserva datos; mensaje de error visible.
- [ ] **T4C-4** `[RW-08 iam]` Sin permisos: `ROLES_MEMBER_ONLY` → mensaje de permisos insuficientes.
- [ ] **T4C-5** Ejecutar `vitest run CreateIamClientWizard.test.tsx`; todos los tests deben pasar.

#### 4D — InviteUserWizard (nuevo)

Archivo: `apps/web-console/src/components/console/wizards/InviteUserWizard.test.tsx`

- [ ] **T4D-1** `[RW-01 invite]` Navegación adelante y atrás preserva el email introducido.
- [ ] **T4D-2** `[RW-03 invite]` Paso de resumen muestra email y rol seleccionado.
- [ ] **T4D-3** `[RW-04 invite]` Desde resumen, botón atrás navega al último paso real de datos del wizard (`Mensaje`), preservando email y rol ya introducidos.
- [ ] **T4D-4** `[RW-06 invite]` Error de backend preserva email y rol; mensaje de error visible.
- [ ] **T4D-5** `[RW-08 invite]` Sin permisos de invitación: `ROLES_MEMBER_ONLY` → mensaje de permisos insuficientes.
- [ ] **T4D-6** Ejecutar `vitest run InviteUserWizard.test.tsx`; todos los tests deben pasar.

#### 4E — ProvisionDatabaseWizard (nuevo)

Archivo: `apps/web-console/src/components/console/wizards/ProvisionDatabaseWizard.test.tsx`

- [ ] **T4E-1** `[RW-02 db]` Bloqueo por validación en campo de nombre de base de datos.
- [ ] **T4E-2** `[RW-05 db]` Confirmación exitosa muestra feedback con database ID retornado.
- [ ] **T4E-3** `[RW-06 db]` Error de backend preserva datos; mensaje de error visible.
- [ ] **T4E-4** `[RW-07 db]` Cuota de bases de datos excedida: `QUOTA_DB_EXCEEDED` → aviso visible + avance bloqueado. Si el componente ya bloquea pero no expone el `blockingError`, completar el render mínimo en `ProvisionDatabaseWizard.tsx`.
- [ ] **T4E-5** `[RW-08 db]` Sin permisos: `ROLES_MEMBER_ONLY` → mensaje de permisos insuficientes.
- [ ] **T4E-6** Ejecutar `vitest run ProvisionDatabaseWizard.test.tsx`; todos los tests deben pasar.

#### 4F — PublishFunctionWizard (nuevo)

Archivo: `apps/web-console/src/components/console/wizards/PublishFunctionWizard.test.tsx`

- [ ] **T4F-1** `[RW-02 fn]` Bloqueo por validación en campo de nombre de función.
- [ ] **T4F-2** `[RW-05 fn]` Confirmación exitosa muestra feedback con function ID y el enlace de recurso retornado; en el DOM actual el CTA navegable se expone como `Abrir recurso`.
- [ ] **T4F-3** `[RW-06 fn]` Error de backend preserva datos; mensaje de error visible.
- [ ] **T4F-4** `[RW-08 fn]` Sin permisos: `ROLES_MEMBER_ONLY` → mensaje de permisos insuficientes.
- [ ] **T4F-5** Ejecutar `vitest run PublishFunctionWizard.test.tsx`; todos los tests deben pasar.

### Fase 5 — Configuración CI y cobertura

- [ ] **T5-1** Abrir `apps/web-console/vite.config.ts` (MODIFY). Localizar la sección `test.coverage.include` y añadir estas entradas si no están presentes:

  ```ts
  "src/components/console/wizards/*.tsx";
  "src/components/console/DestructiveConfirmationDialog.tsx";
  "src/components/console/ConnectionSnippets.tsx";
  "src/lib/console-wizards.ts";
  "src/lib/destructive-ops.ts";
  "src/lib/snippets/*.ts";
  ```

- [ ] **T5-2** No tocar `apps/web-console/package.json` (queda fuera del file map). La verificación de CI para esta tarea se resuelve ejecutando los comandos directos de Vitest desde `apps/web-console` y dejando constancia de que el reporter JUnit ya se valida en el pipeline principal fuera de esta unidad.
- [ ] **T5-3** Ejecutar la suite completa: `cd apps/web-console && vitest run --reporter=verbose`. Verificar exit code 0, sin tests skipped.
- [ ] **T5-4** Ejecutar con cobertura: `vitest run --coverage`. Verificar que el reporte `coverage/index.html` se genera y que los módulos listados en T5-1 aparecen en el reporte.

---

## Test Traceability Map

### Grupo RW — Wizard regression (RF-UI-025 / T02)

| ID    | Componente                                                                                                                         | Escenario                                 | Test location                                                                                 |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| RW-01 | WizardShell, CreateWorkspaceWizard, InviteUserWizard                                                                               | Navegación adelante/atrás preserva datos  | WizardShell.test.tsx, CreateWorkspaceWizard.test.tsx, InviteUserWizard.test.tsx               |
| RW-02 | WizardShell (existing), CreateWorkspaceWizard, CreateIamClientWizard, ProvisionDatabaseWizard, PublishFunctionWizard               | Bloqueo por validación                    | WizardShell.test.tsx (existing), archivos nuevos por wizard                                   |
| RW-03 | WizardShell, InviteUserWizard                                                                                                      | Paso de resumen muestra todos los valores | WizardShell.test.tsx, InviteUserWizard.test.tsx                                               |
| RW-04 | WizardShell, InviteUserWizard                                                                                                      | Desde resumen navegar a paso anterior     | WizardShell.test.tsx, InviteUserWizard.test.tsx                                               |
| RW-05 | WizardShell (existing), CreateIamClientWizard, ProvisionDatabaseWizard, PublishFunctionWizard                                      | Confirmación exitosa muestra feedback     | WizardShell.test.tsx (existing), archivos nuevos por wizard                                   |
| RW-06 | WizardShell, CreateWorkspaceWizard, CreateIamClientWizard, InviteUserWizard, ProvisionDatabaseWizard, PublishFunctionWizard        | Error backend preserva datos              | Todos los archivos de wizard                                                                  |
| RW-07 | CreateTenantWizard, CreateWorkspaceWizard, ProvisionDatabaseWizard                                                                 | Cuota excedida bloquea wizard             | CreateTenantWizard.test.tsx, CreateWorkspaceWizard.test.tsx, ProvisionDatabaseWizard.test.tsx |
| RW-08 | CreateTenantWizard, CreateWorkspaceWizard, CreateIamClientWizard, InviteUserWizard, ProvisionDatabaseWizard, PublishFunctionWizard | Sin permisos muestra mensaje              | Todos los archivos de wizard                                                                  |

### Grupo RC — Destructive confirmation regression (RF-UI-026 / T03)

| ID    | Escenario                                                             | Test location                                       |
| ----- | --------------------------------------------------------------------- | --------------------------------------------------- |
| RC-01 | (existente) Diálogo se abre y muestra el nombre del recurso           | DestructiveConfirmationDialog.test.tsx              |
| RC-02 | (existente) Confirmación requiere escribir nombre del recurso         | DestructiveConfirmationDialog.test.tsx              |
| RC-03 | Resumen de cascada en CRITICAL presenta tipos y cantidades            | DestructiveConfirmationDialog.test.tsx (nuevo T1-1) |
| RC-04 | (existente) Cancelar cierra sin llamar a onConfirm                    | DestructiveConfirmationDialog.test.tsx              |
| RC-05 | (existente) Botón de confirmación solo activo con nombre correcto     | DestructiveConfirmationDialog.test.tsx              |
| RC-06 | Escape cierra (existente) + click-outside cierra (nuevo T1-2)         | DestructiveConfirmationDialog.test.tsx              |
| RC-07 | Tras confirmación exitosa se invoca onSuccess / redirect (nuevo T1-3) | DestructiveConfirmationDialog.test.tsx              |
| RC-08 | (existente) Estado loading durante onConfirm                          | DestructiveConfirmationDialog.test.tsx              |
| RC-09 | (existente) Error en onConfirm muestra mensaje de error               | DestructiveConfirmationDialog.test.tsx              |
| RC-10 | No se abren dos diálogos simultáneamente (nuevo T1-4)                 | DestructiveConfirmationDialog.test.tsx              |

### Grupo RS — Snippet regression (RF-UI-029 / T05)

| ID    | Escenario                                                  | Test location               |
| ----- | ---------------------------------------------------------- | --------------------------- |
| RS-01 | (existente) Snippets se renderizan para el tipo de recurso | ConnectionSnippets.test.tsx |
| RS-02 | Valores de host/puerto coinciden con context (nuevo T2-1)  | ConnectionSnippets.test.tsx |
| RS-03 | Ningún snippet expone contraseña real (nuevo T2-2)         | ConnectionSnippets.test.tsx |
| RS-04 | (existente) Feedback visual de copia al portapapeles       | ConnectionSnippets.test.tsx |
| RS-05 | Sin endpoint → placeholders + nota (nuevo T2-3)            | ConnectionSnippets.test.tsx |
| RS-06 | Estado transitorio → advertencia visible (nuevo T2-4)      | ConnectionSnippets.test.tsx |
| RS-07 | (existente) Selección de lenguaje persiste entre tabs      | ConnectionSnippets.test.tsx |
| RS-08 | Cobertura de lenguajes por tipo (nuevo T2-5)               | ConnectionSnippets.test.tsx |

---

## Mock Contracts

> El paso `implement` debe usar exactamente estos contratos sin explorar las APIs reales.

### `requestConsoleSessionJson` (wizards — éxito)

```typescript
vi.mock("@/lib/console-session", () => ({
  readConsoleShellSession: vi.fn().mockReturnValue({
    principal: { platformRoles: ["superadmin"] },
  }),
  requestConsoleSessionJson: vi
    .fn()
    .mockResolvedValueOnce({ tenantId: "ten_new" }), // CreateTenantWizard
  // .mockResolvedValueOnce({ workspaceId: 'wrk_new' }) // CreateWorkspaceWizard
  // .mockResolvedValueOnce({ clientId: 'client_new' }) // CreateIamClientWizard
  // .mockResolvedValueOnce({ invitationId: 'inv_new' })// InviteUserWizard
  // .mockResolvedValueOnce({ databaseId: 'db_new' })   // ProvisionDatabaseWizard
  // .mockResolvedValueOnce({ functionId: 'fn_new' })   // PublishFunctionWizard
}));
```

### `useConsoleQuotas` (cuota excedida)

```typescript
vi.mock("@/lib/console-quotas", () => ({
  useConsoleQuotas: vi.fn().mockReturnValue(QUOTA_EXCEEDED),
}));
```

### `requestJson` — cascade impact (RC-03)

```typescript
vi.mock("@/lib/http", () => ({
  requestJson: vi.fn().mockResolvedValue({
    dependents: [
      { resourceType: "workspace", count: 2 },
      { resourceType: "database", count: 5 },
    ],
  }),
}));
```

### Clipboard API stub (RS-04)

```typescript
vi.stubGlobal("navigator", {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
});
```

### Router wrapper

Los componentes wizard que usen `<Link>` o `useNavigate` se envuelven en `<MemoryRouter initialEntries={['/']}>` antes de renderizar.

### Convención `afterEach`

```typescript
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
```

---

## Naming Convention

```typescript
describe('WizardShell', () => {
  it('[RW-01] navega adelante y atrás preservando datos — RF-UI-025 / T02-AC1', ...)
  it('[RW-03] paso de resumen muestra todos los valores — RF-UI-025 / T02-AC3', ...)
  it('[RW-04] desde resumen navegar a paso anterior — RF-UI-025 / T02-AC4', ...)
  it('[RW-06] error de backend preserva datos del formulario — RF-UI-025 / T02-AC6', ...)
})

describe('DestructiveConfirmationDialog', () => {
  it('[RC-03] muestra resumen de cascada en CRITICAL — RF-UI-026 / T03-AC3', ...)
  it('[RC-06] click fuera del modal cierra el diálogo — RF-UI-026 / T03-AC6', ...)
  it('[RC-07] tras confirmación exitosa invoca onSuccess — RF-UI-026 / T03-AC7', ...)
  it('[RC-10] no se abren dos diálogos simultáneamente — RF-UI-026 / T03-AC10', ...)
})

describe('ConnectionSnippets', () => {
  it('[RS-02] host y puerto del fixture aparecen en el snippet — RF-UI-029 / T05-AC2', ...)
  it('[RS-03] ningún snippet expone contraseña real — RF-UI-029 / T05-AC3', ...)
  it('[RS-05] sin endpoint muestra placeholders y nota — RF-UI-029 / T05-AC5', ...)
  it('[RS-06] estado provisioning muestra advertencia — RF-UI-029 / T05-AC6', ...)
  it('[RS-08] cobertura de lenguajes por tipo de recurso — RF-UI-029 / T05-AC8', ...)
})
```

---

## Validation Commands

```bash
# Desde apps/web-console

# 1. Verificar que no hay errores de TypeScript
npx tsc --noEmit

# 2. Ejecutar suite completa (verbose para ver todos los test IDs)
npx vitest run --reporter=verbose

# 3. Ejecutar solo el grupo RC
npx vitest run DestructiveConfirmationDialog.test.tsx --reporter=verbose

# 4. Ejecutar solo el grupo RS
npx vitest run ConnectionSnippets.test.tsx --reporter=verbose

# 5. Ejecutar solo el grupo RW — WizardShell
npx vitest run WizardShell.test.tsx --reporter=verbose

# 6. Ejecutar todos los wizards específicos
npx vitest run --reporter=verbose src/components/console/wizards/

# 7. Verificar trazabilidad (grep de IDs de escenario en output)
npx vitest run --reporter=verbose 2>&1 | grep -E '\[R[WCS]-[0-9]+\]'

# 8. Cobertura completa
npx vitest run --coverage --reporter=verbose

# 9. Verificar recuento mínimo de tests (≥ 26)
npx vitest run --reporter=verbose 2>&1 | grep -c 'RW-\|RC-\|RS-'

# 10. Verificar tiempo de ejecución < 5 minutos
time npx vitest run
```

---

## Done Criteria

| #      | Criterio                                                                                                              | Verificación                                                                                              |
| ------ | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| DoD-1  | Suite contiene ≥ 26 tests identificados con `[RW-*]`, `[RC-*]`, `[RS-*]`                                              | Comando 9: `grep -c` ≥ 26                                                                                 |
| DoD-2  | Todos los tests pasan sin errores ni skips                                                                            | Comando 2: exit code 0; sin `[skipped]` en output                                                         |
| DoD-3  | Suite ejecutable sin backend real (todos los mocks cubren llamadas de red)                                            | Comando 2 en entorno sin red: sin `ECONNREFUSED` ni `fetch failed`                                        |
| DoD-4  | Cada test incluye ID de escenario y referencia al criterio de aceptación                                              | Comando 7: grep lista ≥ 26 líneas distintas                                                               |
| DoD-5  | Fixtures modelan ≥ 2 tenants, ≥ 3 workspaces, 5 tipos de recurso, permisos diferenciados, cuota disponible y excedida | Inspección de `src/test/fixtures/` (5 archivos presentes con exports completos)                           |
| DoD-6  | Tiempo de ejecución de la suite completa < 5 minutos en CI                                                            | Comando 10: `real` < 5m00s                                                                                |
| DoD-7  | Añadir un test nuevo no requiere modificar tests existentes ni el setup                                               | Verificar que `vitest run` sigue pasando tras añadir un `it.skip('dummy', () => {})` en cualquier archivo |
| DoD-8  | Tests de snippets confirman ausencia de credenciales reales                                                           | Test RS-03 pasa (T2-2 completado)                                                                         |
| DoD-9  | Tests de multi-tenancy confirman que solo se muestran datos del contexto activo                                       | Tests de aislamiento en ConnectionSnippets y DestructiveConfirmationDialog pasan                          |
| DoD-10 | `vite.config.ts` actualizado con cobertura sobre módulos nuevos; reporte generado                                     | Comando 8: `coverage/index.html` incluye los módulos de T5-1                                              |

---

## Dependencies

| Dependencia                                | Estado requerido para esta tarea                                                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| US-UI-04-T02 (wizards)                     | Los 6 componentes de wizard deben ser importables. Si no existen aún, los tests actuarán como gate (fallan hasta que el componente esté listo). |
| US-UI-04-T03 (confirmaciones destructivas) | `DestructiveConfirmationDialog` y `useDestructiveOp` deben existir. Estado: implementados.                                                      |
| US-UI-04-T05 (snippets)                    | `ConnectionSnippets` y el catálogo de snippets deben existir. Estado: implementados.                                                            |
| Vitest + Testing Library                   | Configurados en el monorepo. Sin cambios al stack requeridos.                                                                                   |
| CI pipeline                                | Debe soportar `vitest run`; script `test` en `package.json` ya configurado.                                                                     |
