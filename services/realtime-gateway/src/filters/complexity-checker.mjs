import { FilterValidationError } from './filter-parser.mjs';

export function checkComplexity(filterSpec, maxPredicates) {
  const predicateCount = filterSpec?.predicates?.length ?? 0;

  if (predicateCount > maxPredicates) {
    throw new FilterValidationError([
      `Filter exceeds maximum predicate count of ${maxPredicates}.`
    ]);
  }
}
