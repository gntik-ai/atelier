export const UNLIMITED_SENTINEL = -1;

const DIMENSION_KEY_PATTERN = /^[a-z][a-z0-9_]{1,62}$/;
const VALID_UNITS = new Set(['count', 'bytes']);

export function isValidLimitValue(value) {
  return Number.isInteger(value) && value >= UNLIMITED_SENTINEL;
}

export function isUnlimited(value) {
  return value === UNLIMITED_SENTINEL;
}

export function isInherited(value) {
  return value === null || value === undefined;
}

export function isValidDimensionKey(key) {
  return typeof key === 'string' && DIMENSION_KEY_PATTERN.test(key);
}

export class QuotaDimension {
  constructor({ dimensionKey, displayLabel, unit, defaultValue, description = null } = {}) {
    this.dimensionKey = dimensionKey;
    this.displayLabel = displayLabel;
    this.unit = unit;
    this.defaultValue = defaultValue;
    this.description = description;
    this.validate();
  }

  validate() {
    if (!isValidDimensionKey(this.dimensionKey)) throw Object.assign(new Error('Invalid dimension key'), { code: 'INVALID_DIMENSION_KEY' });
    if (!this.displayLabel || typeof this.displayLabel !== 'string') throw Object.assign(new Error('displayLabel is required'), { code: 'VALIDATION_ERROR' });
    if (!VALID_UNITS.has(this.unit)) throw Object.assign(new Error('Invalid unit'), { code: 'VALIDATION_ERROR' });
    if (!isValidLimitValue(this.defaultValue)) throw Object.assign(new Error('Invalid defaultValue'), { code: 'VALIDATION_ERROR' });
    if (this.description !== null && this.description !== undefined && typeof this.description !== 'string') throw Object.assign(new Error('description must be a string'), { code: 'VALIDATION_ERROR' });
  }
}

export function formatProfileEntry({ dimension, explicitValue }) {
  const inherited = isInherited(explicitValue);
  const effectiveValue = inherited ? dimension.defaultValue : explicitValue;
  return {
    dimensionKey: dimension.dimensionKey,
    displayLabel: dimension.displayLabel,
    unit: dimension.unit,
    effectiveValue,
    source: inherited ? 'default' : 'explicit',
    unlimitedSentinel: isUnlimited(effectiveValue)
  };
}
