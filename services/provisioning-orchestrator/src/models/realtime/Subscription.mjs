import { validate as validateEventFilter } from './EventFilter.mjs';

const TRANSITIONS = {
  suspend: { from: ['active'], to: 'suspended' },
  reactivate: { from: ['suspended'], to: 'active' },
  delete: { from: ['active', 'suspended'], to: 'deleted' },
  update: { from: ['active', 'suspended'], to: null }
};

export class Subscription {
  constructor(attrs) {
    this.id = attrs.id;
    this.tenant_id = attrs.tenant_id;
    this.workspace_id = attrs.workspace_id;
    this.channel_id = attrs.channel_id;
    this.channel_type = attrs.channel_type;
    this.owner_identity = attrs.owner_identity;
    this.owner_client_id = attrs.owner_client_id ?? null;
    this.event_filter = attrs.event_filter ?? null;
    this.status = attrs.status ?? 'active';
    this.created_at = attrs.created_at ?? null;
    this.updated_at = attrs.updated_at ?? null;
    this.deleted_at = attrs.deleted_at ?? null;
    this.metadata = attrs.metadata ?? null;
    if (!validateEventFilter(this.event_filter).valid) throw new Error('INVALID_EVENT_FILTER');
  }

  transition(action, changes = {}) {
    const rule = TRANSITIONS[action];
    if (!rule || !rule.from.includes(this.status)) throw new Error('INVALID_STATUS_TRANSITION');
    const next = new Subscription({ ...this, ...changes, status: rule.to ?? this.status, deleted_at: action === 'delete' ? new Date().toISOString() : this.deleted_at, updated_at: new Date().toISOString() });
    return next;
  }

  static fromRow(row) { return new Subscription(row); }
  toJSON() { return { ...this }; }
}
