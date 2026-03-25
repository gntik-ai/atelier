# US-MGADM-03 — Credenciales seguras y auditoría administrativa MongoDB

## Objetivo

Extender la superficie administrativa MongoDB para que las mutaciones operen con manejo seguro de credenciales mediante service accounts internas o scopeadas por tenant/workspace, con ciclo de vida acotado, auditoría completa, eventos administrativos enriquecidos por correlación y cobertura explícita de recuperación ante rotación o revocación.

## Alcance implementado

- Enriquecimiento del perfil MongoDB con guía mínima de permisos, estrategia de identidad de ejecución y límites máximos de vida de credenciales.
- Normalización y validación de `passwordBinding` con `credentialScope`, `serviceAccountId` y `lifecycle` acotado.
- Envoltorio interno `mongo_admin_request` con `admin_credential_binding`, `correlation_context`, advertencias previas, resumen de auditoría, evento administrativo y guía de recuperación.
- Proyección `mongo_inventory_snapshot` con `credential_posture` y `audit_coverage` para lecturas seguras de consola.
- Contrato `mongo_admin_event` para entrega a auditoría/streaming con metadata de correlación y lifecycle.
- OpenAPI pública ampliada con esquemas de lifecycle, binding administrativo, recovery guidance, correlation context y minimum-permission guidance.

## Notas operativas

- No se exponen secretos crudos en API ni en artefactos de auditoría.
- Las credenciales administrativas quedan referenciadas por secreto o service account, con límites de vida y señales de recuperación.
- La evolución es aditiva sobre la familia `mongo` y eleva la semver OpenAPI a `1.17.0`.
