const CAPABILITY_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

export function isValidCapabilityKey(key) {
  return typeof key === 'string' && CAPABILITY_KEY_PATTERN.test(key);
}

export class BooleanCapability {
  constructor({ capabilityKey, displayLabel, description, platformDefault = false, isActive = true, sortOrder = 0 } = {}) {
    this.capabilityKey = capabilityKey;
    this.displayLabel = displayLabel;
    this.description = description;
    this.platformDefault = platformDefault;
    this.isActive = isActive;
    this.sortOrder = sortOrder;
    this.validate();
  }

  validate() {
    if (!isValidCapabilityKey(this.capabilityKey)) throw Object.assign(new Error('Invalid capability key'), { code: 'INVALID_CAPABILITY_KEY' });
    if (!this.displayLabel || typeof this.displayLabel !== 'string') throw Object.assign(new Error('displayLabel is required'), { code: 'VALIDATION_ERROR' });
    if (!this.description || typeof this.description !== 'string') throw Object.assign(new Error('description is required'), { code: 'VALIDATION_ERROR' });
    if (typeof this.platformDefault !== 'boolean') throw Object.assign(new Error('platformDefault must be boolean'), { code: 'VALIDATION_ERROR' });
    if (typeof this.isActive !== 'boolean') throw Object.assign(new Error('isActive must be boolean'), { code: 'VALIDATION_ERROR' });
    if (!Number.isInteger(this.sortOrder)) throw Object.assign(new Error('sortOrder must be an integer'), { code: 'VALIDATION_ERROR' });
  }
}

export function buildCapabilityProfile(planCapabilitiesJsonb = {}, activeCatalogEntries = []) {
  const explicit = planCapabilitiesJsonb ?? {};
  const catalogKeys = new Set();
  const capabilityProfile = activeCatalogEntries.map((entry) => {
    catalogKeys.add(entry.capabilityKey);
    const hasExplicit = Object.prototype.hasOwnProperty.call(explicit, entry.capabilityKey);
    return {
      capabilityKey: entry.capabilityKey,
      displayLabel: entry.displayLabel,
      description: entry.description,
      enabled: hasExplicit ? Boolean(explicit[entry.capabilityKey]) : Boolean(entry.platformDefault),
      source: hasExplicit ? 'explicit' : 'platform_default',
      platformDefault: Boolean(entry.platformDefault)
    };
  });
  const orphanedCapabilities = Object.entries(explicit)
    .filter(([capabilityKey]) => !catalogKeys.has(capabilityKey))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([capabilityKey, enabled]) => ({ capabilityKey, enabled: Boolean(enabled), status: 'orphaned' }));
  return [...capabilityProfile, ...orphanedCapabilities];
}

export function buildTenantCapabilityView(planCapabilitiesJsonb = {}, activeCatalogEntries = []) {
  return activeCatalogEntries.map((entry) => ({
    displayLabel: entry.displayLabel,
    enabled: Object.prototype.hasOwnProperty.call(planCapabilitiesJsonb ?? {}, entry.capabilityKey)
      ? Boolean(planCapabilitiesJsonb[entry.capabilityKey])
      : Boolean(entry.platformDefault)
  }));
}

export function diffCapabilities(currentJsonb = {}, toSet = {}) {
  const changed = [];
  const unchanged = [];
  for (const [capabilityKey, newState] of Object.entries(toSet ?? {})) {
    const hasCurrent = Object.prototype.hasOwnProperty.call(currentJsonb ?? {}, capabilityKey);
    const previousState = hasCurrent ? Boolean(currentJsonb[capabilityKey]) : null;
    if (hasCurrent && previousState === newState) unchanged.push(capabilityKey);
    else changed.push({ capabilityKey, previousState, newState: Boolean(newState) });
  }
  return { changed, unchanged };
}
