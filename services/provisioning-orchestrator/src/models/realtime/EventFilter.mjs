export const EVENT_FILTER_SCHEMA = {
  type: 'object',
  properties: {
    table_name: { type: 'string' },
    collection_name: { type: 'string' },
    operations: { type: 'array', items: { enum: ['INSERT', 'UPDATE', 'DELETE', 'REPLACE'] }, minItems: 1 },
    schema_name: { type: 'string' }
  },
  additionalProperties: false
};

const ALLOWED_KEYS = new Set(Object.keys(EVENT_FILTER_SCHEMA.properties));
const ALLOWED_OPERATIONS = new Set(EVENT_FILTER_SCHEMA.properties.operations.items.enum);

export function validate(filter) {
  if (filter == null) return { valid: true, errors: [] };
  if (typeof filter !== 'object' || Array.isArray(filter)) return { valid: false, errors: ['EVENT_FILTER_MUST_BE_OBJECT'] };
  const errors = [];
  for (const key of Object.keys(filter)) if (!ALLOWED_KEYS.has(key)) errors.push(`UNKNOWN_FIELD:${key}`);
  for (const key of ['table_name', 'collection_name', 'schema_name']) {
    if (key in filter && typeof filter[key] !== 'string') errors.push(`INVALID_${key.toUpperCase()}`);
  }
  if ('operations' in filter) {
    if (!Array.isArray(filter.operations) || filter.operations.length === 0) errors.push('INVALID_OPERATIONS');
    else if (filter.operations.some((op) => !ALLOWED_OPERATIONS.has(op))) errors.push('INVALID_OPERATION_VALUE');
  }
  return { valid: errors.length === 0, errors };
}

export function matches(filter, event) {
  if (filter == null) return true;
  const validation = validate(filter);
  if (!validation.valid) throw new Error('INVALID_EVENT_FILTER');
  if (filter.table_name && filter.table_name !== event.tableName) return false;
  if (filter.collection_name && filter.collection_name !== event.collectionName) return false;
  if (filter.schema_name && filter.schema_name !== event.schemaName) return false;
  if (filter.operations && !filter.operations.includes(event.operation)) return false;
  return true;
}
