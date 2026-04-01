# Checklist de calidad — spec.md US-BKP-01-T04

## Completitud

- [x] Objetivo y problema que resuelve claramente definidos
- [x] Usuarios afectados y valor recibido por cada actor
- [x] Escenarios principales con narrativa completa (E1–E6)
- [x] Edge cases con comportamiento esperado definido
- [x] Reglas de negocio explícitas y numeradas (RN-01 a RN-09)
- [x] Requisitos funcionales verificables (RF-T04-01 a RF-T04-08)
- [x] Permisos por acción y rol
- [x] Consideraciones multi-tenant
- [x] Extensión del modelo de auditoría existente (T03)
- [x] Consideraciones de seguridad (tokens, CSPRNG, replay)
- [x] Criterios de aceptación concretos y verificables (CA-01 a CA-12)
- [x] Riesgos con impacto y mitigación
- [x] Supuestos con consecuencia si no se cumplen

## Consistencia con tareas hermanas

- [x] Dependencias declaradas: T01 (PR#156), T02 (PR#157), T03 (PR#158) — todas merged
- [x] No duplica funcionalidad de T01 (visibilidad), T02 (endpoints), T03 (auditoría)
- [x] No invade alcance de T05 (simulaciones) ni T06 (documentación)
- [x] Extiende el modelo de operación de T02 (intercepta antes del despacho)
- [x] Extiende los eventos de auditoría de T03 (añade campos de confirmación)

## Alcance y entrega incremental

- [x] El alcance se limita a confirmaciones y prechecks de restore
- [x] Los backups bajo demanda quedan explícitamente fuera del flujo de confirmación
- [x] Los prechecks degradan gracefully si el adaptador no soporta todas las verificaciones
- [x] El spec no prescribe implementación concreta (se centra en qué y porqué)

## Claridad

- [x] Sin marcadores `[NEEDS CLARIFICATION]`
- [x] Todos los escenarios tienen narrativa completa
- [x] Todas las reglas de negocio son verificables
- [x] Los niveles de riesgo tienen criterios de clasificación explícitos
