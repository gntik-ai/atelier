# Research: Documentar diferencias entre restauración de configuración y restauración de datos

**Feature**: US-BKP-02-T06 | **Branch**: `120-config-vs-data-restore-differences` | **Stage**: Phase 0

---

## 1. Inventario de elementos exportados por T01 — por dominio

Fuentes: especificación US-BKP-02-T01, código de recolectores en `services/provisioning-orchestrator/src/collectors/`, AGENTS.md.

### 1.1 IAM — Keycloak (`iam-collector.mjs`)

- **Exportado (configuración)**: roles de realm, grupos, client scopes, identity providers, protocol mappers, clients (metadatos), configuración de realm (token lifetime, etc.).
- **NO exportado (datos de usuario)**: sesiones activas, tokens emitidos, historial de login/eventos de auditoría de Keycloak, credenciales de usuarios individuales (passwords, OTP secrets), refresh tokens.
- **Secretos redactados**: valores de `clientSecret`, credenciales de identity providers → `***REDACTED***`.

### 1.2 PostgreSQL (`postgres-collector.mjs`)

- **Exportado (configuración)**: esquemas, tablas (DDL completo: columnas, tipos, constraints, PKs, FKs, índices), vistas, vistas materializadas (DDL, no datos), extensiones instaladas, grants sobre esquemas y tablas.
- **NO exportado (datos de usuario)**: filas de tablas, valores actuales de secuencias (`currval`), datos materializados en vistas materializadas.
- **Nota**: El recolector lee `information_schema` y `pg_catalog`; no accede a datos de tablas de aplicación.

### 1.3 MongoDB (`mongo-collector.mjs`, opcional)

- **Exportado (configuración)**: lista de bases de datos, colecciones por base de datos, validadores JSON Schema de colecciones, índices (definición, no datos), configuración de sharding (si aplica).
- **NO exportado (datos de usuario)**: documentos almacenados en colecciones, GridFS objects.
- **Condición de disponibilidad**: `CONFIG_EXPORT_MONGO_ENABLED=false` por defecto → retorna `not_available`.

### 1.4 Kafka (`kafka-collector.mjs`)

- **Exportado (configuración)**: topics (nombre, número de particiones, factor de replicación, configuración de retention), ACLs de topics, consumer groups registrados (nombre, descripción — no estado ni offsets).
- **NO exportado (datos de usuario)**: mensajes almacenados en los topics, offsets de consumidores, estado interno de consumer groups (lag, posición actual), datos de transacciones Kafka.
- **Nota**: Los mensajes son efímeros por diseño; sujetos a `retention.ms` configurado por topic.

### 1.5 Funciones — OpenWhisk (`functions-collector.mjs`, opcional)

- **Exportado (configuración)**: acciones (runtime, código fuente o referencia, límites de memoria/timeout), paquetes, triggers (tipo, configuración), rules (trigger → action bindings).
- **NO exportado (datos de usuario)**: logs de ejecución de activaciones, resultados almacenados de activaciones previas, estado de activaciones activas.
- **Secretos redactados**: valores de parámetros de acciones con nombres sensibles → `***REDACTED***`.
- **Condición de disponibilidad**: `CONFIG_EXPORT_OW_ENABLED=false` por defecto → retorna `not_available`.

### 1.6 Almacenamiento S3-compatible (`s3-collector.mjs`)

- **Exportado (configuración)**: buckets (nombre, versionado habilitado, lifecycle rules, configuración de CORS, políticas de acceso/IAM bucket policies).
- **NO exportado (datos de usuario)**: objetos almacenados en los buckets, versiones anteriores de objetos, metadatos de objetos individuales, ACLs de objetos.
- **Nota**: El recolector usa las APIs de metadatos del proveedor S3-compatible; no lista ni descarga objetos.

---

## 2. Elementos aplicados por T03 (reaprovisionamiento)

Fuente: especificación US-BKP-02-T03.

T03 aplica el artefacto de exportación sobre un tenant destino, dominio por dominio. Los elementos que T03 puede aplicar son exactamente los que T01 exportó, excepto los secretos redactados. Por tanto:

- T03 **recrea** la configuración estructural de cada dominio: roles IAM, esquemas de tablas, topics, funciones, buckets.
- T03 **no puede restaurar** secretos redactados (require configuración manual post-reaprovisionamiento).
- T03 **no puede restaurar** datos de usuario (filas, documentos, mensajes, objetos) porque no están en el artefacto de exportación.
- T03 aplica dominios de forma independiente; un fallo en un dominio no revierte los dominios ya aplicados (no-transaccional cross-domain).

---

## 3. Mecanismos nativos de backup de datos por subsistema

### 3.1 PostgreSQL

- **Mecanismo principal**: `pg_dump` / `pg_restore` — backup lógico completo o por base de datos/esquema/tabla.
- **Alternativa**: snapshots de volumen de almacenamiento persistente (Kubernetes PVC).
- **Limitación**: no integrado en la plataforma; requiere acceso directo al subsistema PostgreSQL (credenciales DBA o acceso al PVC).
- **Gap de plataforma**: la plataforma no tiene actualmente un mecanismo integrado de backup de datos PostgreSQL por tenant. Es un gap accionable.

### 3.2 MongoDB

- **Mecanismo principal**: `mongodump` / `mongorestore` — backup lógico por base de datos o colección.
- **Alternativa**: snapshots de volumen; Atlas Backup si se usa MongoDB Atlas.
- **Limitación**: no integrado en la plataforma; acceso directo requerido. Dominio opcional.
- **Gap de plataforma**: sin capacidad integrada de backup de datos MongoDB. Gap accionable.

### 3.3 Kafka

- **Mecanismo principal**: Kafka MirrorMaker 2 (replicación de topics entre clusters) o herramientas de consumo y re-publicación.
- **Alternativa**: `kafka-console-consumer` con persistencia a archivo; Confluent Platform Replicator.
- **Limitación crítica**: los mensajes son efímeros — sujetos a `retention.ms` del topic. Una vez expirada la ventana de retención, los mensajes no son recuperables aunque exista infraestructura de backup.
- **Gap de plataforma**: sin capacidad integrada de snapshot o replicación de mensajes Kafka por tenant. Gap accionable, con la advertencia de que la ventana de oportunidad está limitada por la retención.

### 3.4 Funciones — OpenWhisk

- **Datos de ejecución**: los logs de activación y resultados son efímeros por diseño en OpenWhisk. No existe un mecanismo estándar de backup de logs de ejecución.
- **Backup relevante**: el código fuente de las acciones debería estar en el repositorio de código del tenant (Git), no en la plataforma. Si está en Git, no necesita backup de plataforma.
- **Mecanismo de emergencia**: exportación manual via CLI `wsk` o API de OpenWhisk; no integrado en la plataforma.
- **Conclusión**: para logs de activación el gap es estructural (datos efímeros por diseño). Para código fuente, la responsabilidad recae en el repositorio Git del tenant.

### 3.5 Almacenamiento S3-compatible

- **Mecanismo principal**: replicación cross-bucket o cross-region del proveedor S3-compatible (si soportada).
- **Herramientas**: `rclone sync`, `aws s3 sync`, scripts con SDK S3.
- **Limitación**: no integrado en la plataforma; requiere acceso directo a las credenciales del bucket.
- **Gap de plataforma**: sin capacidad integrada de snapshot o replicación de objetos S3 por tenant. Gap accionable.

### 3.6 IAM — Keycloak

- **Mecanismo nativo**: Keycloak Admin REST API exportación/importación de realm (incluye usuarios, credenciales, sesiones).
- **Limitación**: la exportación de realm completa incluye credenciales de usuarios (hashed), pero puede ser excesivamente grande para realms con muchos usuarios. No integrado en la plataforma.
- **Gap de plataforma**: sin capacidad integrada de backup de datos de usuarios Keycloak por tenant. Gap accionable, con consideraciones de privacidad (hashed credentials en el export).

---

## 4. Limitaciones transversales identificadas

### 4.1 Secretos redactados

Todo valor de parámetro o configuración cuyo nombre coincida con patrones heurísticos de campo sensible (password, secret, token, key, credential) es sustituido por `***REDACTED***` en el artefacto de exportación. Esto afecta:
- Credenciales de identity providers en Keycloak.
- Parámetros de acciones OpenWhisk con nombres sensibles.
- Variables de entorno sensibles de servicios configurados.

**Consecuencia**: el reaprovisionamiento desde el artefacto requiere una fase de configuración manual de secretos post-aplicación. T03 debe documentar explícitamente los pasos de configuración manual de secretos.

### 4.2 Configuración dinámica/emergente

No toda la configuración que existe en un tenant en producción es declarativa o fue creada vía la plataforma. Por ejemplo:
- Consumer groups en Kafka creados automáticamente por las aplicaciones del tenant al consumir por primera vez.
- Usuarios de Keycloak creados por auto-registro o flows de invitación.
- Índices creados directamente por aplicaciones del tenant vía conexión directa a PostgreSQL.

Esta configuración emergente puede no estar en el artefacto de exportación, o puede estar parcialmente.

### 4.3 Incoherencia posible entre configuración restaurada y datos existentes

Si un tenant destino ya tiene datos (filas, documentos, objetos), restaurar la configuración sobre esos datos puede generar incoherencias:
- Esquemas PostgreSQL restaurados con constraints que los datos existentes no cumplen.
- Índices Kafka restaurados con configuraciones diferentes a las que el consumidor espera.
- Buckets S3 con lifecycle rules modificadas que afectan objetos ya existentes.

T04 (validaciones previas) mitiga parcialmente este riesgo, pero no lo elimina completamente.

### 4.4 No-transaccionalidad cross-domain

El reaprovisionamiento (T03) aplica dominios de forma secuencial e independiente. No existe un mecanismo de rollback atómico cross-domain. Si el dominio PostgreSQL se aplica correctamente pero el dominio Kafka falla, el tenant queda con configuración parcialmente restaurada.

### 4.5 Dominios opcionales según perfil de despliegue

MongoDB y OpenWhisk son opcionales (`CONFIG_EXPORT_MONGO_ENABLED`, `CONFIG_EXPORT_OW_ENABLED`, ambos `false` por defecto). En entornos donde estos dominios están deshabilitados, no hay exportación ni restauración posible de configuración ni datos para esos dominios.

---

## 5. Audiencias y necesidades diferenciadas

| Audiencia | Necesidad principal | Sección del doc relevante |
|---|---|---|
| SRE / Platform team | Planificación de DR completa; qué pasos para config, qué pasos para datos | Tabla resumen + Detalle por dominio + Recomendaciones operativas |
| Superadmin | Comunicación clara del alcance a stakeholders; lenguaje no técnico | Resumen ejecutivo |
| Tenant owner | Expectativas sobre recuperabilidad de sus datos | Resumen ejecutivo (vía comunicación del superadmin) |
| Equipo de producto | Identificación de gaps para priorización de roadmap | Tabla resumen (columna Gap status) + Detalle por dominio (mecanismo complementario) |
| QA / Auditoría | Verificación de coherencia doc-capacidades | Sección de trazabilidad + comparación con specs T01–T05 |

---

## 6. Decisiones de diseño del documento

| Decisión | Racional | Alternativa descartada |
|---|---|---|
| Ubicación: `docs/operations/config-vs-data-restore-differences.md` | Consistente con patrón existente (`docs/operations/secret-management.md`); es documentación operativa, no referencia de API | `docs/reference/` — no aplica porque es un runbook operativo, no una referencia de interfaz |
| Formato: Markdown estructurado con tabla resumen + secciones por dominio | Legible sin herramientas especiales; puede renderizarse en GitHub, wikis, Confluence | PDF o HTML generado — introduce dependencias de toolchain innecesarias |
| Nombre de archivo: `config-vs-data-restore-differences.md` | Descriptivo, buscable, coherente con las convenciones de nombre del proyecto (kebab-case) | `backup-restore-guide.md` — demasiado genérico, no refleja el foco específico |
| No incluir ejemplos de artefactos reales de exportación | Evita riesgo de datos sensibles y desactualización ante cambios de formato | Incluir JSON de ejemplo — riesgo de contener datos de tenants reales o quedar desactualizado |
| Estructura en niveles: resumen ejecutivo (no técnico) + tabla resumen + detalle por dominio (técnico) | Permite que cada audiencia consuma sólo la sección relevante | Documento único uniforme — fuerza a todos los lectores a leer todo |

---

*Research generado para el stage `speckit.plan` — US-BKP-02-T06 | Rama: `120-config-vs-data-restore-differences`*
