function readEventField(event, field) {
  if (event?.data && Object.hasOwn(event.data, field)) {
    return event.data[field];
  }

  if (event?.payload && Object.hasOwn(event.payload, field)) {
    return event.payload[field];
  }

  if (event?.after && Object.hasOwn(event.after, field)) {
    return event.after[field];
  }

  return event?.[field];
}

function evaluatePredicate(predicate, event) {
  const actual = readEventField(event, predicate.field);

  switch (predicate.op) {
    case 'eq':
      return actual === predicate.value;
    case 'neq':
      return actual !== predicate.value;
    case 'contains':
      if (typeof actual === 'string') {
        return actual.includes(String(predicate.value));
      }

      if (Array.isArray(actual)) {
        return actual.includes(predicate.value);
      }

      return false;
    default:
      return false;
  }
}

export function evaluateFilter(filterSpec, event) {
  if (!filterSpec || filterSpec.passAll) {
    return true;
  }

  if (filterSpec.operation && filterSpec.operation !== event?.operation) {
    return false;
  }

  if (filterSpec.entity && filterSpec.entity !== event?.entity) {
    return false;
  }

  return (filterSpec.predicates ?? []).every((predicate) => evaluatePredicate(predicate, event));
}
