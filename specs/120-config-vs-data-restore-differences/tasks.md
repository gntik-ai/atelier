# Tasks: Documentar diferencias entre restauración de configuración y restauración de datos

**Branch**: `120-config-vs-data-restore-differences` | **Generated**: 2026-04-01
**Task ID**: US-BKP-02-T06 | **Epic**: EP-20 | **Story**: US-BKP-02
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)
**Depends on**: US-BKP-02-T01, US-BKP-02-T02, US-BKP-02-T03, US-BKP-02-T04, US-BKP-02-T05

---

## Implement Constraints (mandatory — enforced during `speckit.implement`)

1. **DOCUMENTATION-ONLY FEATURE** — this task produces a single Markdown artifact. Do not create, modify, or delete any source code, migrations, tests, APISIX routes, Keycloak config, Kafka topics, or OpenWhisk actions.
2. **TARGETED FILE READS ONLY** — during implement, read only the files listed in the File Path Map below. Do not perform broad repo reads (`find`, `ls`, or glob beyond the map) unless looking up an existing pattern in `docs/operations/secret-management.md` for formatting reference.
3. **MINIMAL SPEC CONTEXT** — the implement step receives only `plan.md` and `tasks.md`; do NOT open `spec.md`, `research.md`, or `data-model.md` unless a specific factual detail cannot be resolved from `plan.md` alone.
4. **NO SENSITIVE DATA** — the output document MUST NOT contain credentials, tokens, secrets, real tenant data, real hostnames, or internal service URLs. Only env var names and fictitious examples are allowed.
5. **COHERENCE WITH T01–T05** — every element listed as "configuración restaurable" in the output document must correspond exactly to what the T01 collectors export and T03 applies. Do not invent or omit capabilities.
6. **AGENTS.md UPDATE** — after writing the doc, append a concise summary of the 120-config-vs-data-restore-differences feature to `AGENTS.md` under the `<!-- MANUAL ADDITIONS START -->` section, consistent with the pattern used by other features.
7. **INDEX UPDATE** — if `docs/operations/` has an index file (e.g. `README.md` or `index.md`), add an entry for the new document. If no index exists, skip this step.
8. **SINGLE COMMIT** — commit all output files together in one commit with message: `docs: add config-vs-data-restore-differences operational reference (US-BKP-02-T06)`.
9. **PUSH IMMEDIATELY** — push the commit to `origin/120-config-vs-data-restore-differences` before reporting done.
10. **NO PR** — do not open a pull request.

---

## File Path Map

> All paths are relative to `/root/projects/falcone`.
> During `speckit.implement`, read only the paths listed here plus `plan.md` and `tasks.md`.

### Read-only reference files (for content accuracy — targeted reads only)

```text
specs/120-config-vs-data-restore-differences/research.md       ← domain inventory (T01 exports, complementary mechanisms, limitations)
specs/120-config-vs-data-restore-differences/data-model.md     ← RestoreDomain instances, RestorableConfig, NonRestorableData, ComplementaryMechanism, TransversalLimitations
docs/operations/secret-management.md                           ← formatting and style reference (first 60 lines only)
AGENTS.md                                                      ← existing feature summaries; append new entry for this feature
```

### New files to create

```text
docs/operations/config-vs-data-restore-differences.md   ← primary output: operational reference document
```

### Files to modify

```text
AGENTS.md   ← append feature summary for 120-config-vs-data-restore-differences under <!-- MANUAL ADDITIONS START -->
```

### No contracts, no migrations, no tests

This feature is documentation-only. There are no contract files, SQL migrations, integration tests, or source modules to create or modify beyond the files listed above.

---

## Tasks

### Phase 1 — Redact secciones 1–2: resumen ejecutivo y tabla resumen

**Goal**: Produce the opening sections of the document that serve non-technical audiences and provide a quick-lookup summary for all six domains.

**Why first**: The executive summary (section 1) and summary table (section 2) are the highest-value sections for non-SRE audiences. Completing them first establishes the document skeleton and ensures the scope contract is visible before the technical detail is written.

**Steps**:

1. Open `docs/operations/config-vs-data-restore-differences.md` as a new file.
2. Add the standard document header: title, metadata block (feature branch, related specs T01–T05, last updated date, audience).
3. Write **Section 1 — Resumen ejecutivo** (~300–400 words, non-technical language):
   - What the configuration reprovisioning restores.
   - What it does NOT restore.
   - What complementary mechanisms exist for user data.
   - The three main gaps (PostgreSQL rows, Kafka messages, S3 objects) stated plainly.
   - Note on redacted secrets requiring manual post-restoration step.
4. Write **Section 2 — Tabla resumen de alto nivel**:
   - Six-row table with columns: `Dominio`, `Configuración restaurable (resumen)`, `Datos de usuario NO restaurables`, `Mecanismo complementario`, `Estado del gap`.
   - One row per domain: IAM (Keycloak), PostgreSQL, MongoDB, Kafka, Funciones (OpenWhisk), Almacenamiento (S3-compatible).
   - Gap status for all six domains: `no_cubierto` (no integrated platform mechanism exists for user data backup).
   - MongoDB and OpenWhisk rows must note optional availability (`CONFIG_EXPORT_MONGO_ENABLED`, `CONFIG_EXPORT_OW_ENABLED`).

**Acceptance checks**:
- [ ] Section 1 is self-contained and ≤ 1 page of Markdown (CA-10).
- [ ] Section 2 table has exactly 6 rows and 5 columns (CA-01).
- [ ] No credentials, secrets, or real hostnames appear in either section (CA-12).

---

### Phase 2 — Redact sección 3: detalle por dominio (los seis subdominios)

**Goal**: Write the technically-complete per-domain sections that SREs and auditors use as authoritative reference during DR planning and compliance review.

**Why after Phase 1**: The summary table drives the structure of the per-domain sections; writing the detail after the summary ensures consistency between the two.

**Steps**:

For each of the six domains, write a subsection `3.x — <Domain>` with the following fixed structure (three sub-headings):

```text
#### Configuración restaurable
#### Datos de usuario NO restaurables
#### Mecanismo complementario
```

Domain-specific requirements:

**3.1 — IAM (Keycloak)**:
- Configuración restaurable: roles de realm, grupos (estructura), client scopes, identity providers (sin credenciales), protocol mappers, clients (metadatos), configuración de realm (token lifetime, session settings).
- Datos no restaurables: sesiones activas, tokens emitidos (access/refresh/ID), historial de login y eventos de auditoría de Keycloak, credenciales de usuarios individuales (passwords, TOTP secrets), cuentas de usuario registradas.
- Mecanismo complementario: Keycloak Admin REST API — exportación/importación de realm completo. Note limitations: includes hashed credentials (privacy considerations); not isolated per tenant; not integrated in the platform.

**3.2 — PostgreSQL**:
- Configuración restaurable: esquemas, tablas (DDL completo: columnas, tipos, constraints, PKs, FKs), índices, vistas (DDL), vistas materializadas (DDL, sin datos), extensiones instaladas, grants.
- Datos no restaurables: filas de tablas de aplicación, valores actuales de secuencias (`currval`), datos materializados en vistas materializadas.
- Mecanismo complementario: `pg_dump` / `pg_restore`. Note: requires direct access to PostgreSQL server; not automated per-tenant in the platform; volume snapshots as alternative.

**3.3 — MongoDB**:
- Configuración restaurable: bases de datos (nombres), colecciones (nombres, validadores JSON Schema), índices (definición), configuración de sharding (si aplica).
- Datos no restaurables: documentos almacenados en colecciones, GridFS objects.
- Mecanismo complementario: `mongodump` / `mongorestore`. Note: optional domain (`CONFIG_EXPORT_MONGO_ENABLED=false` by default — returns `not_available`); not integrated in platform.

**3.4 — Kafka**:
- Configuración restaurable: topics (nombre, particiones, factor de replicación, configuración de retention), ACLs de topics, consumer groups registrados (nombre — sin estado ni offsets).
- Datos no restaurables: mensajes almacenados en topics (sujetos a `retention.ms`), offsets de consumidores, estado interno de consumer groups (lag, posición de consumo), datos de transacciones Kafka.
- Mecanismo complementario: MirrorMaker 2 / `kafka-console-consumer`. Critical note: messages are ephemeral — irrecoverable once `retention.ms` expires; not per-tenant in the platform.

**3.5 — Funciones (OpenWhisk)**:
- Configuración restaurable: acciones (runtime, código fuente o referencia, límites de memoria/timeout), paquetes, triggers (tipo, configuración — sin valores de parámetros sensibles redactados), rules (bindings trigger → action).
- Datos no restaurables: logs de ejecución de activaciones, resultados almacenados de invocaciones previas, estado de activaciones activas.
- Mecanismo complementario: repositorio Git del tenant (código fuente de acciones). Note: activation logs are ephemeral by design; optional domain (`CONFIG_EXPORT_OW_ENABLED=false` by default); parameters with sensitive names are redacted (`***REDACTED***`) and require manual post-restoration configuration.

**3.6 — Almacenamiento (S3-compatible)**:
- Configuración restaurable: buckets (nombre, versionado habilitado), lifecycle rules, configuración CORS, políticas de acceso (bucket policies).
- Datos no restaurables: objetos almacenados en los buckets, versiones anteriores de objetos, metadatos de objetos individuales.
- Mecanismo complementario: `rclone sync`, `aws s3 sync`, replicación cross-bucket/cross-region del proveedor. Note: requires direct access to bucket credentials; not integrated in platform.

**Acceptance checks**:
- [ ] Each of the six domains has all three sub-headings with non-empty content (CA-02 to CA-07).
- [ ] MongoDB and OpenWhisk sections include the optionality note (CA-04, CA-06).
- [ ] Kafka section includes the ephemeral-messages note (CA-05).
- [ ] OpenWhisk section includes the redacted-secrets limitation (CA-06).
- [ ] No element is listed as "configuración restaurable" that contradicts specs T01–T05 (CA-11).

---

### Phase 3 — Redact secciones 4–6: limitaciones, recomendaciones y trazabilidad

**Goal**: Complete the document with operational guidance and governance content.

**Steps**:

1. Write **Section 4 — Limitaciones transversales**:
   - TL-01: Secretos redactados (`***REDACTED***`) — impact and required manual action.
   - TL-02: Configuración dinámica/emergente — examples: auto-created consumer groups, auto-registered users, dynamically-created indexes.
   - TL-03: Incoherencia posible entre configuración restaurada y datos existentes — example: restored PostgreSQL schema with constraints that existing data does not satisfy; T04 partially mitigates.
   - TL-04: No-transaccionalidad cross-domain — sequential application; partial failure leaves the tenant in a mixed state.
   - TL-05: Dominios opcionales según perfil de despliegue — MongoDB and OpenWhisk may be unavailable; affects both configuration and data restoration for those domains.

2. Write **Section 5 — Recomendaciones operativas**:
   - 5.1 Orden recomendado de restauración completa:
     a. Run T04 pre-flight conflict validation on the target tenant.
     b. Execute T03 reprovisioning (configuration restoration).
     c. Manually configure redacted secrets on each domain.
     d. Restore user data per subsystem using the complementary mechanisms (pg_restore, mongorestore, MirrorMaker, rclone, Keycloak realm import) — in parallel or sequentially as needed.
     e. Verify data–configuration coherence (constraints, indexes, lifecycle rules).
     f. Run T05 functional test suite to validate the restored configuration.
   - 5.2 Verificación post-restauración:
     - Check that restored PostgreSQL schemas accept the restored data rows (no constraint violations).
     - Confirm Kafka consumer groups can resume from restored offsets.
     - Validate Keycloak roles and client scopes are accessible for the tenant's active sessions.
     - Test S3 bucket lifecycle rules do not prematurely expire recently-restored objects.
   - 5.3 Periodicidad recomendada:
     - Configuration export (T01/T02): daily or on every significant configuration change.
     - User data backup per subsystem: per SLA requirements and data criticality; typically daily to hourly depending on RPO.
   - 5.4 Integración con pruebas de T05:
     - The T05 functional test suite (US-BKP-02-T05) validates the configuration restoration chain. Run T05 periodically (at minimum after each major export) as a health check of the DR procedure for configuration.
     - T05 does not validate user data restoration; that validation is the responsibility of subsystem-specific backup tests.

3. Write **Section 6 — Trazabilidad y mantenibilidad**:
   - 6.1 Fuentes de verdad: this document derives its "configuración restaurable" inventories from the T01 collector specifications and T03 applicator specifications. If T01 or T03 changes scope (new domain added, element removed), this document must be updated in the same change set.
   - 6.2 Procedimiento de actualización: when a new domain is added to the export artifact (T01), add: a new row to the summary table (Section 2), a new subsection under Section 3, and update Sections 4–5 if the new domain introduces new transversal limitations or operational recommendations. When a domain is removed, remove its entries. Changes must be reviewed for coherence with T05 test coverage.

**Acceptance checks**:
- [ ] Section 4 lists all five transversal limitations TL-01 to TL-05 (CA-08).
- [ ] Section 5 includes recommended restoration order, post-restoration verification, periodicity, and T05 integration (CA-09).
- [ ] Section 6 references T01–T05 as source of truth and provides an update procedure (CA-11 traceability).

---

### Phase 4 — Revisión de coherencia, seguridad y formato

**Goal**: Validate the completed document against all acceptance criteria before commit.

**Steps**:

1. **Structural completeness check** — verify all six sections exist and are non-empty:
   - Section 1: Resumen ejecutivo ≤ 1 page (CA-10).
   - Section 2: Table with 6 rows × 5 columns (CA-01).
   - Sections 3.1–3.6: each with 3 sub-headings (CA-02 to CA-07).
   - Section 4: 5 transversal limitations (CA-08).
   - Section 5: 4 subsections with operational guidance (CA-09).
   - Section 6: traceability and update procedure (CA-11).

2. **Coherence check** — for each element listed as "configuración restaurable" in any domain section, verify it is consistent with what `research.md` describes as exported by T01 and applied by T03. Correct any discrepancy.

3. **Security check** — scan the document for:
   - Credentials or token values → remove.
   - Real hostnames or internal service URLs → replace with generic placeholders (e.g., `<keycloak-host>`, `<pg-host>`).
   - Real tenant IDs or user data → remove.
   - Only env var names (e.g., `CONFIG_EXPORT_MONGO_ENABLED`) are allowed as-is (CA-12).

4. **Format check** — verify:
   - File is valid Markdown; no broken table syntax.
   - No special tooling required to read the file.
   - File is saved at `docs/operations/config-vs-data-restore-differences.md` (CA-13).

**Acceptance checks**:
- [ ] All CA-01 to CA-13 from spec.md are satisfied.
- [ ] No sensitive information detected.
- [ ] Markdown renders correctly (validate table syntax manually or with a linter).

---

### Phase 5 — AGENTS.md update y commit + push

**Goal**: Record the feature in the shared knowledge base, commit all output files, and push.

**Steps**:

1. **Update AGENTS.md**: append the following block inside the `<!-- MANUAL ADDITIONS START -->` section (before `<!-- MANUAL ADDITIONS END -->`), using the same format as existing feature entries:

```text
## Config vs Data Restore Differences (120-config-vs-data-restore-differences)

- **New file**: `docs/operations/config-vs-data-restore-differences.md` — operational reference documenting the distinction between configuration restoration (US-BKP-02-T01 to T05) and user data restoration (not covered by the current chain), domain by domain (IAM/Keycloak, PostgreSQL, MongoDB, Kafka, OpenWhisk, S3-compatible).
- **Coverage**: six domains × three aspects each (restorable config, non-restorable data, complementary mechanism).
- **Transversal limitations documented**: redacted secrets, dynamic/emergent config, config-data coherence risk, cross-domain non-transactionality, optional domains.
- **Audiences**: SRE/platform team (full document), superadmin (executive summary + table), product team (gap status column), QA/audit (traceability section).
- **Gap status for all domains**: `no_cubierto` — no integrated platform mechanism for user data backup exists; external/native subsystem tools are documented as complementary mechanisms.
- **No runtime dependencies**: documentation-only artifact; no code, migrations, API routes, or Kafka topics added.
```

1. **Check for index file**: run `ls docs/operations/` — if a `README.md` or `index.md` exists, add an entry for `config-vs-data-restore-differences.md`. If none exists, skip.

1. **Stage files**:

   ```bash
   git add docs/operations/config-vs-data-restore-differences.md AGENTS.md
   ```

   (also stage `docs/operations/index.md` or `README.md` if modified in step 2)

1. **Commit** with message:

   ```text
   docs: add config-vs-data-restore-differences operational reference (US-BKP-02-T06)
   ```

1. **Push** to remote:

   ```bash
   git push origin 120-config-vs-data-restore-differences
   ```

1. **Verify**: confirm push succeeded; report the commit SHA.

**Acceptance checks**:
- [ ] `docs/operations/config-vs-data-restore-differences.md` is tracked in the commit.
- [ ] `AGENTS.md` is updated and tracked in the commit.
- [ ] No other unrelated files are staged or modified.
- [ ] Commit message matches the required format.
- [ ] Branch is pushed and up to date with remote.

---

## Done Criteria

All of the following must be true before this task is considered complete:

- [ ] `docs/operations/config-vs-data-restore-differences.md` exists, is complete, and satisfies CA-01 to CA-13 from the spec.
- [ ] `AGENTS.md` has been updated with the 120-config-vs-data-restore-differences feature summary.
- [ ] No source code, migrations, API routes, or test files have been created or modified.
- [ ] The document contains no credentials, secrets, real hostnames, or tenant data.
- [ ] All elements listed as "configuración restaurable" are consistent with T01 collector specs and T03 applicator specs.
- [ ] One commit containing only the documentation changes has been pushed to `origin/120-config-vs-data-restore-differences`.
- [ ] No pull request has been opened.

---

*Tasks generadas para el stage `speckit.tasks` — US-BKP-02-T06 | Rama: `120-config-vs-data-restore-differences`*
