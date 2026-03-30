import crypto from 'node:crypto';
import net from 'node:net';
import { isValidEventType } from './event-catalogue.mjs';

function uuid() {
  return crypto.randomUUID();
}

function isPrivateHostname(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (['localhost', '127.0.0.1', '::1'].includes(host)) return true;
  if (!net.isIP(host)) return false;
  if (host.startsWith('10.') || host.startsWith('127.') || host.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  if (host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true;
  return false;
}

export function validateSubscriptionInput({ targetUrl, eventTypes }) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    const error = new Error('Malformed target URL');
    error.code = 'INVALID_URL';
    throw error;
  }
  if (parsed.protocol !== 'https:' || isPrivateHostname(parsed.hostname)) {
    const error = new Error('Webhook target must be public HTTPS');
    error.code = 'INVALID_URL';
    throw error;
  }
  if (!Array.isArray(eventTypes) || eventTypes.length === 0 || eventTypes.some((item) => !isValidEventType(item))) {
    const error = new Error('Unknown event types');
    error.code = 'INVALID_EVENT_TYPES';
    throw error;
  }
  return { targetUrl: parsed.toString(), eventTypes: [...new Set(eventTypes)] };
}

export function buildSubscriptionRecord(input, context) {
  const validated = validateSubscriptionInput(input);
  const now = new Date().toISOString();
  return {
    id: uuid(),
    tenant_id: context.tenantId,
    workspace_id: context.workspaceId,
    target_url: validated.targetUrl,
    event_types: validated.eventTypes,
    status: 'active',
    consecutive_failures: 0,
    max_consecutive_failures: context.maxConsecutiveFailures ?? 5,
    description: input.description ?? null,
    metadata: input.metadata ?? {},
    created_by: context.actorId,
    created_at: now,
    updated_at: now,
    deleted_at: null
  };
}

const TRANSITIONS = {
  active: new Set(['paused', 'disabled', 'deleted']),
  paused: new Set(['active', 'deleted']),
  disabled: new Set(['active', 'deleted']),
  deleted: new Set()
};

export function canTransition(currentStatus, targetStatus) {
  return TRANSITIONS[currentStatus]?.has(targetStatus) ?? false;
}

export function applyStatusTransition(subscription, status) {
  if (!canTransition(subscription.status, status)) {
    const error = new Error(`Cannot transition ${subscription.status} to ${status}`);
    error.code = 'INVALID_STATUS_TRANSITION';
    throw error;
  }
  return { ...subscription, status, updated_at: new Date().toISOString() };
}

export function softDelete(subscription) {
  return { ...applyStatusTransition(subscription, 'deleted'), deleted_at: new Date().toISOString() };
}
