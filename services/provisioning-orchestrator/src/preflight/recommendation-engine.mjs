/**
 * Actionable recommendations per conflict type.
 * Implemented as a lookup map — not conditional branches — for evolvability.
 * @module preflight/recommendation-engine
 */

/**
 * RECOMMENDATIONS[domain][resource_type][severity] → template string.
 * Templates may include {resource_name} which is interpolated by getRecommendation.
 * @type {Record<string, Record<string, Record<string, string>>>}
 */
export const RECOMMENDATIONS = {
  iam: {
    role: {
      low:      'Verificar que los atributos descriptivos del rol «{resource_name}» son correctos en el destino. La diferencia no afecta el comportamiento funcional.',
      medium:   'El rol «{resource_name}» tiene permisos o composites diferentes. Verificar si la diferencia es intencional. Si el artefacto debe prevalecer, actualizar el rol manualmente antes de reaprovisionar.',
      high:     'El rol «{resource_name}» tiene una estructura de permisos significativamente diferente. Revisar cuidadosamente antes de reaprovisionar; la diferencia puede afectar accesos activos.',
      critical: 'El rol «{resource_name}» tiene una configuración estructuralmente incompatible. Resolver manualmente antes de ejecutar el reaprovisionamiento.',
    },
    group: {
      low:      'El grupo «{resource_name}» tiene diferencias menores en atributos. La diferencia no afecta la estructura del grupo.',
      medium:   'El grupo «{resource_name}» tiene atributos diferentes. Verificar si los atributos en el destino son intencionales.',
      high:     'El grupo «{resource_name}» tiene un path diferente. El path de un grupo afecta la jerarquía y los accesos. Resolver manualmente.',
      critical: 'El grupo «{resource_name}» tiene una estructura incompatible. Resolver manualmente antes de reaprovisionar.',
    },
    client_scope: {
      low:      'El client scope «{resource_name}» tiene diferencias menores. Verificar si son intencionales.',
      medium:   'El client scope «{resource_name}» tiene mappers de protocolo diferentes. Verificar el impacto en tokens emitidos.',
      high:     'El client scope «{resource_name}» tiene un protocolo diferente. Cambiar el protocolo puede afectar la autenticación. Resolver manualmente.',
      critical: 'El client scope «{resource_name}» es estructuralmente incompatible con el existente. Resolver manualmente.',
    },
    identity_provider: {
      low:      'El identity provider «{resource_name}» tiene diferencias de configuración menores.',
      medium:   'El identity provider «{resource_name}» tiene configuración diferente. Revisar el impacto en los flujos de autenticación federada.',
      high:     'El identity provider «{resource_name}» tiene diferencias significativas de configuración. Revisar cuidadosamente antes de reaprovisionar.',
      critical: 'El identity provider «{resource_name}» tiene un providerId incompatible. No puede coexistir con el existente sin intervención manual.',
    },
  },
  postgres_metadata: {
    table: {
      low:      'La tabla «{resource_name}» tiene diferencias menores. La diferencia puede resolverse sin riesgo destructivo.',
      medium:   'La tabla «{resource_name}» tiene diferencias en índices o grants. Revisar el impacto antes de reaprovisionar.',
      high:     'La tabla «{resource_name}» tiene columnas o constraints incompatibles. Resolver la estructura manualmente o eliminar la tabla en el destino si es aceptable.',
      critical: 'La tabla «{resource_name}» tiene restricciones mutuamente excluyentes con la definición del artefacto. No se puede aplicar sin intervención manual.',
    },
    schema: {
      low:      'El esquema «{resource_name}» tiene diferencias menores.',
      medium:   'El esquema «{resource_name}» tiene diferencias. Verificar si son intencionales.',
      high:     'El esquema «{resource_name}» tiene diferencias significativas. Revisar antes de reaprovisionar.',
      critical: 'El esquema «{resource_name}» es incompatible. Resolver manualmente.',
    },
    view: {
      low:      'La vista «{resource_name}» tiene diferencias menores.',
      medium:   'La vista «{resource_name}» tiene una definición diferente. Verificar si la diferencia es intencional.',
      high:     'La vista «{resource_name}» tiene una definición incompatible. Revisar antes de reaprovisionar.',
      critical: 'La vista «{resource_name}» es incompatible con la existente. Resolver manualmente.',
    },
    extension: {
      low:      'La extensión «{resource_name}» tiene diferencias menores.',
      medium:   'La extensión «{resource_name}» tiene una versión diferente. Verificar compatibilidad antes de reaprovisionar.',
      high:     'La extensión «{resource_name}» tiene una versión incompatible. Revisar el impacto antes de reaprovisionar.',
      critical: 'La extensión «{resource_name}» es incompatible con la instalada. Resolver manualmente.',
    },
    grant: {
      low:      'El grant «{resource_name}» tiene diferencias menores.',
      medium:   'El grant «{resource_name}» tiene privilegios diferentes. Verificar si los permisos del destino son intencionales.',
      high:     'El grant «{resource_name}» tiene diferencias significativas en privilegios. Revisar antes de reaprovisionar.',
      critical: 'El grant «{resource_name}» es incompatible. Resolver manualmente.',
    },
  },
  mongo_metadata: {
    collection: {
      low:      'La colección «{resource_name}» tiene diferencias menores.',
      medium:   'La colección «{resource_name}» tiene diferencias de configuración. Verificar el impacto.',
      high:     'La colección «{resource_name}» tiene un validador incompatible. La diferencia puede rechazar documentos existentes. Resolver antes de reaprovisionar.',
      critical: 'La colección «{resource_name}» es incompatible con la existente. Resolver manualmente.',
    },
    index: {
      low:      'El índice «{resource_name}» tiene diferencias menores en opciones.',
      medium:   'El índice «{resource_name}» tiene opciones diferentes. Verificar el impacto en consultas.',
      high:     'El índice «{resource_name}» tiene un campo unique diferente. Puede afectar la integridad de datos. Revisar antes de reaprovisionar.',
      critical: 'El índice «{resource_name}» tiene una definición de clave incompatible. Debe recrearse manualmente.',
    },
    sharding: {
      low:      'La configuración de sharding «{resource_name}» tiene diferencias menores.',
      medium:   'La configuración de sharding «{resource_name}» tiene diferencias. Verificar el impacto.',
      high:     'La configuración de sharding «{resource_name}» tiene diferencias significativas. Revisar antes de reaprovisionar.',
      critical: 'La configuración de sharding «{resource_name}» es incompatible. Resolver manualmente.',
    },
  },
  kafka: {
    topic: {
      low:      'El topic «{resource_name}» tiene diferencias menores en configuración.',
      medium:   'El topic «{resource_name}» tiene diferencias en configuración (retention, cleanup policy). Revisar el impacto antes de reaprovisionar.',
      high:     'El topic «{resource_name}» tiene un número diferente de particiones. Kafka no permite reducir particiones. Si el artefacto tiene más particiones que el destino, el topic deberá recrearse. Si tiene menos, el conflicto es informativo.',
      critical: 'El topic «{resource_name}» es incompatible. Resolver manualmente.',
    },
    acl: {
      low:      'La ACL «{resource_name}» tiene diferencias menores.',
      medium:   'La ACL «{resource_name}» tiene operaciones o permisos diferentes. Verificar si la diferencia es intencional.',
      high:     'La ACL «{resource_name}» tiene diferencias significativas de permisos. Revisar el impacto en consumidores y productores.',
      critical: 'La ACL «{resource_name}» es incompatible. Resolver manualmente.',
    },
  },
  functions: {
    action: {
      low:      'La acción «{resource_name}» tiene diferencias menores en parámetros.',
      medium:   'La acción «{resource_name}» tiene código o límites diferentes. Verificar si la diferencia es intencional.',
      high:     'La acción «{resource_name}» tiene un runtime diferente. Cambiar el runtime puede romper la ejecución. Revisar antes de reaprovisionar.',
      critical: 'La acción «{resource_name}» es incompatible. Resolver manualmente.',
    },
    package: {
      low:      'El paquete «{resource_name}» tiene diferencias menores.',
      medium:   'El paquete «{resource_name}» tiene bindings diferentes. Verificar si la diferencia es intencional.',
      high:     'El paquete «{resource_name}» tiene diferencias significativas. Revisar antes de reaprovisionar.',
      critical: 'El paquete «{resource_name}» es incompatible. Resolver manualmente.',
    },
    trigger: {
      low:      'El trigger «{resource_name}» tiene diferencias menores.',
      medium:   'El trigger «{resource_name}» tiene configuración de feed diferente. Verificar si la diferencia es intencional.',
      high:     'El trigger «{resource_name}» tiene diferencias significativas. Revisar antes de reaprovisionar.',
      critical: 'El trigger «{resource_name}» es incompatible. Resolver manualmente.',
    },
    rule: {
      low:      'La rule «{resource_name}» tiene diferencias menores.',
      medium:   'La rule «{resource_name}» apunta a una acción o trigger diferente. Verificar si la diferencia es intencional.',
      high:     'La rule «{resource_name}» tiene diferencias significativas. Revisar antes de reaprovisionar.',
      critical: 'La rule «{resource_name}» es incompatible. Resolver manualmente.',
    },
  },
  storage: {
    bucket: {
      low:      'El bucket «{resource_name}» tiene diferencias menores en CORS.',
      medium:   'El bucket «{resource_name}» tiene diferencias en versioning, lifecycle o política. Verificar si la diferencia es intencional.',
      high:     'El bucket «{resource_name}» tiene diferencias significativas de configuración. Revisar el impacto antes de reaprovisionar.',
      critical: 'El bucket «{resource_name}» es incompatible. Resolver manualmente.',
    },
  },
};

/** Generic fallback when no entry exists for the combination. */
export const GENERIC_RECOMMENDATION =
  'Revisar la diferencia en el recurso «{resource_name}» y resolver manualmente antes de ejecutar el reaprovisionamiento si es necesario.';

/**
 * Return the actionable recommendation for a conflict.
 *
 * @param {string} domain
 * @param {string} resource_type
 * @param {'low'|'medium'|'high'|'critical'} severity
 * @param {string} resource_name
 * @returns {string}
 */
export function getRecommendation(domain, resource_type, severity, resource_name) {
  const template =
    RECOMMENDATIONS[domain]?.[resource_type]?.[severity] ?? GENERIC_RECOMMENDATION;
  return template.replace(/\{resource_name\}/g, resource_name);
}
