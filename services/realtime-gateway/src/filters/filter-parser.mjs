import Ajv from 'ajv';

export class FilterValidationError extends Error {
  constructor(validationErrors) {
    super('Filter validation failed');
    this.name = 'FilterValidationError';
    this.validationErrors = validationErrors;
  }
}

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });

const filterSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    operation: {
      type: 'string',
      enum: ['INSERT', 'UPDATE', 'DELETE']
    },
    entity: {
      type: 'string',
      minLength: 1
    },
    predicates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'op'],
        properties: {
          field: { type: 'string', minLength: 1 },
          op: { type: 'string', minLength: 1 },
          value: true
        }
      }
    }
  }
};

const validateFilter = ajv.compile(filterSchema);

function normalizeFilter(raw) {
  if (raw == null) {
    return { passAll: true, predicates: [] };
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new FilterValidationError(['Filter must be an object.']);
  }

  if (Object.keys(raw).length === 0) {
    return { passAll: true, predicates: [] };
  }

  const valid = validateFilter(raw);

  if (!valid) {
    const validationErrors = (validateFilter.errors ?? []).map((error) => {
      const path = error.instancePath || error.schemaPath;
      return `${path} ${error.message}`.trim();
    });

    throw new FilterValidationError(validationErrors);
  }

  return {
    passAll: false,
    operation: raw.operation,
    entity: raw.entity,
    predicates: (raw.predicates ?? []).map((predicate) => ({
      field: predicate.field,
      op: predicate.op,
      value: predicate.value
    }))
  };
}

export function parseFilter(raw) {
  return normalizeFilter(raw);
}
