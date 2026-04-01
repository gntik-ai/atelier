# Data Model: Documentar diferencias entre restauración de configuración y restauración de datos

**Feature**: US-BKP-02-T06 | **Branch**: `120-config-vs-data-restore-differences` | **Stage**: Phase 1

---

## Nota de contexto

Esta tarea no produce código ni esquemas de base de datos. El "modelo de datos" aquí descrito son las **entidades documentales** que estructuran el artefacto Markdown resultante: `docs/operations/config-vs-data-restore-differences.md`. Las entidades son conceptuales y se materializan como secciones, tablas y listas del documento.

---

## Entidades documentales

### RestoreDomain

Representa uno de los 6 subsistemas cubiertos por el artefacto de exportación funcional.

| Campo | Tipo | Descripción |
|---|---|---|
| `name` | string | Nombre del dominio (ej: `IAM`, `PostgreSQL`, `MongoDB`, `Kafka`, `Funciones`, `Almacenamiento`) |
| `subsystem` | string | Tecnología concreta (ej: `Keycloak`, `PostgreSQL 15`, `MongoDB`, `Apache Kafka`, `Apache OpenWhisk`, `S3-compatible`) |
| `isOptional` | boolean | `true` si el dominio puede estar deshabilitado en ciertos perfiles de despliegue |
| `enableEnvVar` | string \| null | Variable de entorno que controla la disponibilidad (ej: `CONFIG_EXPORT_MONGO_ENABLED`) |
| `gapStatus` | GapStatus | Estado del gap de restauración de datos de usuario |

**Instancias**:

| name | subsystem | isOptional | enableEnvVar | gapStatus |
|---|---|---|---|---|
| IAM | Keycloak | false | null | no_cubierto |
| PostgreSQL | PostgreSQL | false | null | no_cubierto |
| MongoDB | MongoDB | true | `CONFIG_EXPORT_MONGO_ENABLED` | no_cubierto |
| Kafka | Apache Kafka | false | null | no_cubierto |
| Funciones | Apache OpenWhisk | true | `CONFIG_EXPORT_OW_ENABLED` | no_cubierto (datos efímeros por diseño) |
| Almacenamiento | S3-compatible | false | null | no_cubierto |

---

### RestorableConfig

Lista de elementos de configuración que T01 exporta y T03 aplica para un dominio dado.

| Campo | Tipo | Descripción |
|---|---|---|
| `domain` | RestoreDomain | Dominio al que pertenece |
| `elements` | string[] | Lista de elementos de configuración restaurables |

**Instancias por dominio**:

**IAM (Keycloak)**:
- Roles de realm
- Grupos y membresías de grupos (estructura, no usuarios individuales)
- Client scopes
- Identity providers (sin credenciales — redactadas)
- Protocol mappers
- Clients (metadatos de configuración, sin client secrets)
- Configuración de realm (token lifetime, session settings)

**PostgreSQL**:
- Esquemas
- Tablas (DDL: columnas, tipos, constraints, PKs, FKs)
- Índices
- Vistas (DDL)
- Vistas materializadas (DDL, sin datos)
- Extensiones instaladas
- Grants sobre esquemas y tablas

**MongoDB**:
- Bases de datos (nombres)
- Colecciones (nombres, validadores JSON Schema)
- Índices (definición)
- Configuración de sharding (si aplica)

**Kafka**:
- Topics (nombre, particiones, factor de replicación, configuración de retention)
- ACLs de topics
- Consumer groups registrados (nombre — sin estado ni offsets)

**Funciones (OpenWhisk)**:
- Acciones (runtime, código fuente o referencia, límites de memoria/timeout)
- Paquetes
- Triggers (tipo, configuración — sin valores de parámetros sensibles)
- Rules (bindings trigger → action)

**Almacenamiento (S3-compatible)**:
- Buckets (nombre, versionado habilitado)
- Lifecycle rules
- Configuración CORS
- Políticas de acceso (bucket policies)

---

### NonRestorableData

Lista de datos de usuario que quedan fuera del alcance del reaprovisionamiento para un dominio dado.

| Campo | Tipo | Descripción |
|---|---|---|
| `domain` | RestoreDomain | Dominio al que pertenece |
| `elements` | string[] | Lista de datos de usuario no restaurables |

**Instancias por dominio**:

**IAM (Keycloak)**:
- Sesiones de usuario activas
- Tokens emitidos (access tokens, refresh tokens, ID tokens)
- Historial de login y eventos de auditoría de Keycloak
- Credenciales de usuarios individuales (passwords, TOTP secrets)
- Usuarios registrados (cuentas individuales de usuario)

**PostgreSQL**:
- Filas de tablas de aplicación
- Valores actuales de secuencias (`currval`)
- Datos materializados en vistas materializadas

**MongoDB**:
- Documentos almacenados en colecciones
- GridFS objects (archivos almacenados como documentos)

**Kafka**:
- Mensajes almacenados en los topics (sujetos a `retention.ms`)
- Offsets de consumidores
- Estado interno de consumer groups (lag, posición de consumo)
- Datos de transacciones Kafka

**Funciones (OpenWhisk)**:
- Logs de ejecución de activaciones
- Resultados almacenados de invocaciones previas
- Estado de activaciones activas

**Almacenamiento (S3-compatible)**:
- Objetos almacenados en los buckets
- Versiones anteriores de objetos (si el versionado está habilitado)
- Metadatos de objetos individuales

---

### ComplementaryMechanism

Herramienta, proceso o capacidad nativa del subsistema capaz de cubrir (total o parcialmente) el gap de restauración de datos.

| Campo | Tipo | Descripción |
|---|---|---|
| `domain` | RestoreDomain | Dominio al que aplica |
| `tool` | string | Nombre de la herramienta o proceso |
| `scope` | string | Qué datos cubre |
| `isIntegratedInPlatform` | boolean | `true` si está integrado en la plataforma; `false` si es externo |
| `limitations` | string[] | Limitaciones relevantes |

**Instancias**:

| domain | tool | scope | isIntegratedInPlatform | limitations |
|---|---|---|---|---|
| IAM | Keycloak Admin REST API (realm export) | Usuarios, credenciales, sesiones | false | Export de realm completo puede ser grande; incluye hashed credentials (consideraciones de privacidad); no por tenant aislado |
| PostgreSQL | pg_dump / pg_restore | Filas, secuencias, datos de vistas materializadas | false | Requiere acceso directo al servidor PostgreSQL; no automatizado por tenant |
| MongoDB | mongodump / mongorestore | Documentos, GridFS objects | false | Requiere acceso directo; dominio opcional |
| Kafka | MirrorMaker 2 / kafka-console-consumer | Mensajes en topics | false | Datos efímeros sujetos a retention; no recuperables tras expiración; no por tenant aislado |
| Funciones | Repositorio Git del tenant (código fuente) | Código fuente de acciones | false (responsabilidad del tenant) | No cubre logs de activación (efímeros por diseño) |
| Almacenamiento | rclone sync / aws s3 sync / replicación del proveedor | Objetos, versiones, metadatos | false | Requiere acceso directo a credenciales del bucket |

---

### GapStatus

Clasificación del estado de cobertura de restauración de datos de usuario para un dominio.

| Valor | Descripción |
|---|---|
| `cubierto` | Los datos de usuario del dominio tienen cobertura de restauración integrada en la plataforma |
| `parcialmente_cubierto` | Existen mecanismos parciales o limitados integrados en la plataforma |
| `no_cubierto` | Los datos de usuario no tienen cobertura de restauración integrada; existen mecanismos nativos externos o no existen |

> **Todos los dominios actuales tienen estado `no_cubierto`**. No existe actualmente ningún mecanismo integrado en la plataforma para backup y restauración de datos de usuario por tenant. Esta situación es documentada como gap accionable para cada dominio.

---

### TransversalLimitation

Limitación que afecta a todos los dominios, no específica de uno solo.

| ID | Descripción | Impacto |
|---|---|---|
| TL-01 | **Secretos redactados**: valores de parámetros sensibles → `***REDACTED***` en el artefacto | La restauración de configuración no es completa sin una fase manual de configuración de secretos post-reaprovisionamiento |
| TL-02 | **Configuración dinámica/emergente**: configuración creada en runtime por aplicaciones del tenant puede no estar en el artefacto | El artefacto puede estar incompleto respecto al estado real del tenant en producción |
| TL-03 | **Incoherencia config-datos**: restaurar configuración sobre datos existentes puede generar violaciones de constraints o comportamientos inesperados | T04 mitiga parcialmente; la restauración completa requiere alinear orden de operaciones |
| TL-04 | **No-transaccionalidad cross-domain**: un fallo en un dominio no revierte los dominios ya aplicados | El estado del tenant puede quedar parcialmente restaurado tras un fallo |
| TL-05 | **Dominios opcionales**: MongoDB y OpenWhisk pueden no estar disponibles según el perfil de despliegue | En esos entornos, no hay ni exportación ni restauración posible para esos dominios |

---

## Estructura del documento de salida

El artefacto `docs/operations/config-vs-data-restore-differences.md` implementa las entidades anteriores con la siguiente estructura Markdown:

```
# Diferencias entre restauración de configuración y restauración de datos

## 1. Resumen ejecutivo
   [~300-400 palabras, lenguaje no técnico]

## 2. Tabla resumen de alto nivel
   [Tabla: RestoreDomain × (configuración restaurable | datos NO restaurables | mecanismo complementario | gap status)]

## 3. Detalle por dominio

### 3.1 IAM (Keycloak)
   #### Configuración restaurable [RestorableConfig.elements]
   #### Datos de usuario NO restaurables [NonRestorableData.elements]
   #### Mecanismo complementario [ComplementaryMechanism]

### 3.2 PostgreSQL
   [misma estructura]

### 3.3 MongoDB
   [misma estructura + nota de opcionalidad]

### 3.4 Kafka
   [misma estructura + nota sobre mensajes efímeros]

### 3.5 Funciones (OpenWhisk)
   [misma estructura + nota de secretos redactados + opcionalidad]

### 3.6 Almacenamiento (S3-compatible)
   [misma estructura]

## 4. Limitaciones transversales
   [Lista de TransversalLimitations TL-01 a TL-05]

## 5. Recomendaciones operativas
   5.1 Orden recomendado de restauración completa
   5.2 Verificación post-restauración
   5.3 Periodicidad recomendada
   5.4 Integración con pruebas de T05

## 6. Trazabilidad y mantenibilidad
   6.1 Fuentes de verdad
   6.2 Procedimiento de actualización del documento
```

---

*Data model generado para el stage `speckit.plan` — US-BKP-02-T06 | Rama: `120-config-vs-data-restore-differences`*
