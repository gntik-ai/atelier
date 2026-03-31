const SLUG_PATTERN = /^[a-z0-9-]{1,64}$/;

export class Plan {
  static STATUSES = ['draft', 'active', 'deprecated', 'archived'];
  static VALID_TRANSITIONS = {
    draft: ['active'],
    active: ['deprecated'],
    deprecated: ['archived'],
    archived: []
  };

  constructor({ id = null, slug, displayName, description = null, status = 'draft', capabilities = {}, quotaDimensions = {}, createdBy = null, updatedBy = null, createdAt = null, updatedAt = null } = {}) {
    this.id = id;
    this.slug = Plan.normalizeSlug(slug);
    this.displayName = displayName;
    this.description = description;
    this.status = status;
    this.capabilities = capabilities ?? {};
    this.quotaDimensions = quotaDimensions ?? {};
    this.createdBy = createdBy;
    this.updatedBy = updatedBy ?? createdBy;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    this.validate();
  }

  static normalizeSlug(slug) {
    return typeof slug === 'string' ? slug.trim().toLowerCase() : slug;
  }

  static canTransition(currentStatus, targetStatus) {
    return (Plan.VALID_TRANSITIONS[currentStatus] ?? []).includes(targetStatus);
  }

  validate() {
    if (!this.slug || !SLUG_PATTERN.test(this.slug)) throw Object.assign(new Error('Invalid slug'), { code: 'INVALID_SLUG' });
    if (!this.displayName || typeof this.displayName !== 'string') throw Object.assign(new Error('displayName is required'), { code: 'VALIDATION_ERROR' });
    if (!Plan.STATUSES.includes(this.status)) throw Object.assign(new Error('Invalid status'), { code: 'VALIDATION_ERROR' });
    validateBooleanMap(this.capabilities, 'capabilities');
    validateNumberMap(this.quotaDimensions, 'quotaDimensions');
  }
}

function validateBooleanMap(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error(`${field} must be an object`), { code: 'VALIDATION_ERROR' });
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'boolean') throw Object.assign(new Error(`${field}.${key} must be boolean`), { code: 'VALIDATION_ERROR' });
  }
}

function validateNumberMap(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error(`${field} must be an object`), { code: 'VALIDATION_ERROR' });
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) throw Object.assign(new Error(`${field}.${key} must be a finite number`), { code: 'VALIDATION_ERROR' });
  }
}
