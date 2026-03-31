export class PlanAssignment {
  constructor({ id = null, tenantId, planId, assignedBy, assignmentMetadata = {}, effectiveFrom = null, supersededAt = null } = {}) {
    this.id = id;
    this.tenantId = tenantId;
    this.planId = planId;
    this.assignedBy = assignedBy;
    this.assignmentMetadata = assignmentMetadata ?? {};
    this.effectiveFrom = effectiveFrom;
    this.supersededAt = supersededAt;
    this.validate();
  }

  isCurrent() {
    return this.supersededAt === null;
  }

  validate() {
    if (!this.tenantId || typeof this.tenantId !== 'string') throw Object.assign(new Error('tenantId is required'), { code: 'VALIDATION_ERROR' });
    if (!this.planId || typeof this.planId !== 'string') throw Object.assign(new Error('planId is required'), { code: 'VALIDATION_ERROR' });
    if (!this.assignedBy || typeof this.assignedBy !== 'string') throw Object.assign(new Error('assignedBy is required'), { code: 'VALIDATION_ERROR' });
    if (!this.assignmentMetadata || typeof this.assignmentMetadata !== 'object' || Array.isArray(this.assignmentMetadata)) throw Object.assign(new Error('assignmentMetadata must be an object'), { code: 'VALIDATION_ERROR' });
  }
}
