# Feature Specification: Almacenamiento Seguro de Secretos y Credenciales en el Clúster

**Feature Branch**: `091-secure-secret-storage`  
**Created**: 2026-03-30  
**Status**: Draft  
**Input**: User description: "Implementar almacenamiento seguro de secretos y credenciales sensibles en el clúster"  
**Task ID**: US-SEC-02-T01  
**Epic**: EP-18 — Seguridad funcional transversal  
**Historia**: US-SEC-02 — Gestión segura de secretos, rotación, enforcement de scope y separación de privilegios  
**RF cubiertos**: RF-SEC-005, RF-SEC-006, RF-SEC-007, RF-SEC-010, RF-SEC-011

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Almacenamiento centralizado de secretos del clúster (Priority: P1)

Como miembro del platform team, necesito que todas las credenciales sensibles del clúster (claves de bases de datos, tokens de servicios, secretos de cifrado, credenciales de broker) se almacenen en un almacén seguro centralizado, de modo que ningún secreto quede expuesto en texto plano en configuraciones, variables de entorno sin proteger o artefactos de despliegue.

**Why this priority**: Sin un almacenamiento seguro centralizado, cualquier credencial filtrada compromete toda la plataforma. Este es el cimiento sobre el que se construyen rotación, scopes y separación de privilegios.

**Independent Test**: Se puede verificar desplegando el clúster y confirmando que ninguna credencial aparece en texto plano en configuraciones accesibles; todas las credenciales se resuelven desde el almacén seguro.

**Acceptance Scenarios**:

1. **Given** un clúster recién desplegado, **When** un operador inspecciona las configuraciones de los servicios (APISIX, Keycloak, Kafka, PostgreSQL, MongoDB, OpenWhisk, S3-compatible), **Then** ninguna credencial aparece en texto plano; todas referencian el almacén seguro.
2. **Given** un servicio que necesita acceder a una credencial, **When** solicita el secreto al almacén, **Then** recibe la credencial vigente sin que esta se persista en disco o logs del servicio consumidor.
3. **Given** un intento de acceso al almacén de secretos sin autorización válida, **Then** el acceso es denegado y el intento queda registrado en el sistema de auditoría.

---

### User Story 2 - Segregación de secretos por dominio funcional (Priority: P1)

Como superadmin o tenant owner, necesito que los secretos estén organizados y aislados por dominio funcional (infraestructura de plataforma, datos de tenant, ejecución de funciones, gateway, IAM), de modo que un compromiso en un dominio no exponga credenciales de otros dominios.

**Why this priority**: La segregación es esencial para cumplir el principio de mínimo privilegio entre dominios de administración y ejecución, que es un criterio de aceptación explícito de la historia.

**Independent Test**: Se puede verificar intentando acceder a secretos de un dominio desde el contexto de otro dominio y confirmando que el acceso es denegado.

**Acceptance Scenarios**:

1. **Given** secretos organizados por dominio (e.g., `platform/`, `tenant/{id}/`, `functions/`, `gateway/`, `iam/`), **When** un servicio del dominio de funciones intenta leer un secreto del dominio de plataforma, **Then** el acceso es denegado.
2. **Given** un tenant con sus propios secretos (claves de API, webhooks, credenciales de storage), **When** otro tenant intenta acceder a esos secretos, **Then** el acceso es denegado y el intento queda registrado.
3. **Given** un nuevo dominio funcional que se añade al clúster, **When** se provisionan sus secretos, **Then** se crean en un namespace aislado con políticas de acceso específicas para ese dominio.

---

### User Story 3 - Cifrado en reposo y en tránsito de secretos (Priority: P1)

Como responsable de seguridad, necesito que todos los secretos estén cifrados tanto en reposo (almacenamiento) como en tránsito (cuando se transmiten a servicios consumidores), para cumplir con las políticas de seguridad de la plataforma.

**Why this priority**: El cifrado es un requisito fundamental sin el cual el almacenamiento centralizado no ofrece protección real.

**Independent Test**: Se puede verificar inspeccionando el almacenamiento subyacente para confirmar que los valores están cifrados, y capturando tráfico de red para confirmar que la transmisión usa canales cifrados.

**Acceptance Scenarios**:

1. **Given** un secreto almacenado en el almacén, **When** se inspecciona directamente el almacenamiento subyacente (e.g., volumen persistente, base de datos backend), **Then** el valor aparece cifrado, no en texto plano.
2. **Given** un servicio que solicita un secreto, **When** la credencial viaja del almacén al servicio, **Then** la comunicación usa un canal cifrado (TLS/mTLS).

---

### User Story 4 - Auditoría de acceso a secretos (Priority: P2)

Como superadmin, necesito que cada acceso (lectura, escritura, denegación) a cualquier secreto quede registrado con la identidad del solicitante, timestamp, dominio del secreto y resultado de la operación, para mantener trazabilidad completa.

**Why this priority**: La auditoría es necesaria para detectar accesos no autorizados y cumplir con los requisitos de trazabilidad de la plataforma, pero su valor depende de que el almacenamiento seguro ya exista.

**Independent Test**: Se puede verificar realizando operaciones sobre secretos y consultando el registro de auditoría para confirmar que cada operación generó una entrada.

**Acceptance Scenarios**:

1. **Given** un servicio autorizado que lee un secreto, **When** la operación se completa, **Then** se registra un evento de auditoría con: identidad del solicitante, secreto accedido (sin el valor), dominio, timestamp y resultado (éxito).
2. **Given** un intento denegado de acceso a un secreto, **When** se consulta el registro de auditoría, **Then** aparece la entrada con resultado (denegado) y el motivo de la denegación.
3. **Given** un operador que crea o actualiza un secreto, **When** la operación se completa, **Then** se registra un evento de auditoría de escritura sin incluir el valor del secreto en el registro.

---

### User Story 5 - Inventario y visibilidad de secretos para operadores (Priority: P3)

Como miembro del platform team, necesito poder listar los secretos existentes (sin ver sus valores), conocer sus metadatos (dominio, fecha de creación, última rotación, estado) y verificar qué servicios tienen acceso a cada secreto, para gestionar el ciclo de vida de las credenciales.

**Why this priority**: La visibilidad operativa facilita la gestión pero no es bloqueante para la seguridad básica del almacenamiento.

**Independent Test**: Se puede verificar consultando el inventario de secretos y confirmando que se muestran metadatos pero nunca valores.

**Acceptance Scenarios**:

1. **Given** un operador autorizado, **When** solicita el inventario de secretos de un dominio, **Then** recibe la lista con metadatos (nombre, dominio, fecha de creación, fecha de última modificación, estado) sin valores.
2. **Given** un secreto específico, **When** un operador consulta sus políticas de acceso, **Then** puede ver qué roles o servicios tienen permiso de lectura sobre ese secreto.

---

### Edge Cases

- ¿Qué ocurre si el almacén de secretos no está disponible al arrancar un servicio? El servicio debe fallar de forma segura (fail-closed), sin arrancar con credenciales por defecto o vacías, y registrar el fallo.
- ¿Qué ocurre si se intenta crear un secreto con un nombre que ya existe en el mismo dominio? La operación debe rechazarse con un error claro, no sobrescribir silenciosamente.
- ¿Qué ocurre si un secreto tiene un valor vacío o malformado? El almacén debe rechazar valores vacíos y validar el formato cuando el tipo de secreto lo requiera.
- ¿Qué ocurre si el almacén de secretos pierde conectividad con su backend de almacenamiento? Los servicios deben mantener las credenciales ya obtenidas en memoria (nunca persistirlas en disco) y generar alertas, sin exponer errores internos al exterior.
- ¿Cómo se manejan secretos durante la migración o restauración de backups? Los backups del almacén deben estar cifrados con las mismas garantías que los secretos en reposo; la restauración debe requerir autenticación y autorización equivalentes al acceso en producción.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: El sistema DEBE almacenar todas las credenciales sensibles del clúster (contraseñas de bases de datos, tokens de servicio, claves de cifrado, credenciales de broker, credenciales de IAM, claves de API gateway, credenciales de object storage) en un almacén seguro centralizado.
- **FR-002**: El sistema DEBE cifrar todos los secretos en reposo usando un algoritmo de cifrado estándar de la industria (AES-256 o superior).
- **FR-003**: El sistema DEBE transmitir secretos exclusivamente a través de canales cifrados (TLS 1.2+ / mTLS).
- **FR-004**: El sistema DEBE organizar los secretos en namespaces aislados por dominio funcional, como mínimo: plataforma, tenant, funciones, gateway, IAM.
- **FR-005**: El sistema DEBE impedir que un servicio o identidad acceda a secretos fuera de su dominio funcional asignado, cumpliendo el principio de mínimo privilegio.
- **FR-006**: El sistema DEBE aislar los secretos entre tenants, impidiendo que un tenant acceda a secretos de otro tenant.
- **FR-007**: El sistema DEBE registrar un evento de auditoría por cada operación sobre secretos (lectura, escritura, eliminación, denegación) incluyendo: identidad del solicitante, identificador del secreto (sin valor), dominio, timestamp y resultado.
- **FR-008**: El sistema DEBE rechazar cualquier acceso a secretos cuando la identidad del solicitante no esté autenticada o no tenga permiso sobre el dominio y secreto solicitado.
- **FR-009**: El sistema DEBE proporcionar un mecanismo para listar secretos con sus metadatos (nombre, dominio, fecha de creación, última modificación, estado) sin exponer los valores.
- **FR-010**: El sistema DEBE aplicar comportamiento fail-closed: si el almacén de secretos no está disponible, los servicios dependientes no deben arrancar con credenciales por defecto o vacías.
- **FR-011**: El sistema DEBE rechazar la creación de secretos con nombres duplicados dentro del mismo dominio/namespace.
- **FR-012**: El sistema DEBE rechazar valores de secretos vacíos.
- **FR-013**: Los secretos NUNCA DEBEN aparecer en texto plano en logs, configuraciones en disco, variables de entorno sin proteger, respuestas de API de error ni artefactos de despliegue.

### Key Entities

- **Secret**: Credencial sensible con nombre único dentro de su dominio, valor cifrado, tipo (contraseña, token, clave, certificado), estado (activo, revocado, pendiente de rotación) y metadatos de ciclo de vida (fecha de creación, última modificación, última lectura).
- **Secret Namespace / Domain**: Agrupación lógica que aísla secretos por dominio funcional (plataforma, tenant, funciones, gateway, IAM). Cada namespace tiene políticas de acceso independientes.
- **Access Policy**: Regla que define qué identidades (servicios, roles, usuarios) pueden realizar qué operaciones (lectura, escritura, listado) sobre qué secretos o namespaces.
- **Audit Event (Secret)**: Registro inmutable de cada operación sobre secretos, incluyendo solicitante, operación, identificador del secreto, dominio, timestamp y resultado, sin incluir nunca el valor del secreto.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: El 100% de las credenciales sensibles del clúster se almacenan en el almacén seguro centralizado; cero credenciales en texto plano en configuraciones o artefactos.
- **SC-002**: Todos los secretos están cifrados en reposo; una inspección directa del almacenamiento subyacente no revela valores en texto plano.
- **SC-003**: El 100% de los accesos a secretos (exitosos y denegados) generan un evento de auditoría consultable.
- **SC-004**: Un intento de acceso cross-domain (servicio accediendo a secreto de otro dominio) es denegado en el 100% de los casos.
- **SC-005**: Un intento de acceso cross-tenant es denegado en el 100% de los casos.
- **SC-006**: Los servicios que dependen de secretos aplican comportamiento fail-closed cuando el almacén no está disponible: no arrancan con credenciales por defecto.
- **SC-007**: Un operador autorizado puede listar secretos y sus metadatos en menos de 5 segundos sin que se expongan valores.

## Scope Boundaries

### In Scope

- Almacén seguro centralizado para todas las credenciales del clúster.
- Cifrado en reposo y en tránsito de secretos.
- Segregación de secretos por dominio funcional y por tenant.
- Control de acceso basado en políticas por dominio/namespace.
- Auditoría de todas las operaciones sobre secretos.
- Inventario y consulta de metadatos de secretos (sin valores).
- Comportamiento fail-closed para servicios dependientes.

### Out of Scope

- **Rotación de secretos** (US-SEC-02-T02): mecanismos automáticos o manuales para rotar credenciales sin redespliegue.
- **Enforcement de scopes de tokens** (US-SEC-02-T03): bloqueo de uso fuera del scope del token o membresía.
- **Separación de permisos admin vs. datos** (US-SEC-02-T04): segregación entre administración estructural y acceso a datos.
- **Separación de permisos deploy vs. ejecución** (US-SEC-02-T05): segregación entre despliegue y ejecución de funciones.
- **Pruebas de hardening** (US-SEC-02-T06): pruebas de penetración y hardening específicas para secretos y scopes.

## Assumptions

- El clúster opera sobre Kubernetes/OpenShift, que proporciona primitivas nativas de secretos (Kubernetes Secrets) que pueden ser extendidas o reemplazadas por un almacén más robusto.
- Los servicios del clúster (APISIX, Keycloak, Kafka, PostgreSQL, MongoDB, OpenWhisk, S3-compatible) pueden ser configurados para obtener credenciales de un almacén centralizado en lugar de variables de entorno o archivos de configuración.
- Ya existe un pipeline de auditoría (observabilidad) capaz de recibir y almacenar eventos de auditoría de secretos.
- La infraestructura de red del clúster soporta TLS/mTLS entre servicios.
- Las dependencias declaradas (US-SEC-01, US-STO-03, US-FN-03) están completadas o proporcionan las interfaces necesarias.

## Dependencies

- **US-SEC-01**: Seguridad base — proporciona modelo de autenticación y autorización sobre el que se construyen las políticas de acceso a secretos.
- **US-STO-03**: Storage — las credenciales de object storage son secretos gestionados por este almacén.
- **US-FN-03**: Functions — las credenciales de ejecución y despliegue de funciones son secretos gestionados por este almacén.
