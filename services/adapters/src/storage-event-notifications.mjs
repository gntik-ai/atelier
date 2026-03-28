import { STORAGE_NORMALIZED_ERROR_CODES } from './storage-error-taxonomy.mjs';

const DEFAULT_NOW = '2026-03-28T00:00:00Z';
const DEFAULT_SATISFACTION_STATE = 'unsatisfied';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value;
}

function sanitizeAuditString(value) {
  if (typeof value !== 'string') {
    return value ?? null;
  }

  return value
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/secret:\/\/\S+/gi, '[redacted-secret-ref]')
    .replace(/(access|secret|session)[-_ ]?key\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .trim();
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function toNonNegativeNumber(value, fallback = 0) {
  if (value == null || value === '') {
    return fallback;
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(numeric, 0);
}

function normalizeDestinationType(value) {
  return Object.values(STORAGE_EVENT_NOTIFICATION_DESTINATION_TYPES).includes(value)
    ? value
    : null;
}

function normalizeEventTypes(values = []) {
  return uniqueStrings(values).filter((value) => Object.values(STORAGE_EVENT_NOTIFICATION_EVENT_TYPES).includes(value));
}

function buildErrorEnvelope(definition, extra = {}) {
  return deepFreeze({
    code: definition.code,
    normalizedCode: definition.normalizedCode,
    httpStatus: definition.httpStatus,
    retryability: definition.retryability,
    fallbackHint: definition.fallbackHint,
    ...extra
  });
}

function getCapabilityEntry(providerProfile) {
  return (providerProfile?.capabilityDetails ?? []).find(
    (entry) => entry.capabilityId === STORAGE_EVENT_NOTIFICATION_CAPABILITY_ID
  ) ?? null;
}

function normalizeAllowedDestinationTypes(values = []) {
  const normalized = uniqueStrings(values)
    .map((value) => normalizeDestinationType(value))
    .filter(Boolean);

  return normalized;
}

function buildRuleLimitStatus({ maxRules = null, currentRules = 0 } = {}) {
  const normalizedMaxRules = maxRules == null || maxRules === '' ? null : toNonNegativeNumber(maxRules, 0);
  const normalizedCurrentRules = toNonNegativeNumber(currentRules, 0);

  return deepFreeze({
    maxRules: normalizedMaxRules,
    currentRules: normalizedCurrentRules,
    remainingRules: normalizedMaxRules == null ? null : Math.max(normalizedMaxRules - normalizedCurrentRules, 0),
    blocked: normalizedMaxRules == null ? false : normalizedCurrentRules >= normalizedMaxRules
  });
}

function buildViolation(definition, message, extra = {}) {
  return deepFreeze({
    ...buildErrorEnvelope(definition),
    message,
    ...extra
  });
}

function generateRuleId() {
  return `sen_${Math.random().toString(36).slice(2, 10)}`;
}

function generateDeliveryId() {
  return `snd_${Math.random().toString(36).slice(2, 10)}`;
}

function matchesFilter(filters = {}, objectKey = null) {
  const normalizedObjectKey = typeof objectKey === 'string' ? objectKey : '';
  const prefix = typeof filters.prefix === 'string' && filters.prefix.trim() ? filters.prefix.trim() : null;
  const suffix = typeof filters.suffix === 'string' && filters.suffix.trim() ? filters.suffix.trim() : null;

  if (prefix && !normalizedObjectKey.startsWith(prefix)) {
    return false;
  }

  if (suffix && !normalizedObjectKey.endsWith(suffix)) {
    return false;
  }

  return true;
}

export const STORAGE_EVENT_NOTIFICATION_CAPABILITY_ID = 'bucket.event_notifications';

export const STORAGE_EVENT_NOTIFICATION_DESTINATION_TYPES = deepFreeze({
  KAFKA_TOPIC: 'kafka_topic',
  OPENWHISK_ACTION: 'openwhisk_action'
});

export const STORAGE_EVENT_NOTIFICATION_EVENT_TYPES = deepFreeze({
  OBJECT_CREATED: 'object.created',
  OBJECT_DELETED: 'object.deleted',
  MULTIPART_COMPLETED: 'multipart.completed'
});

export const STORAGE_EVENT_NOTIFICATION_AUDIT_ACTIONS = deepFreeze({
  RULE_CREATED: 'rule_created',
  RULE_UPDATED: 'rule_updated',
  RULE_DELETED: 'rule_deleted',
  DELIVERY_PREVIEWED: 'delivery_previewed',
  DELIVERY_BLOCKED: 'delivery_blocked'
});

export const STORAGE_EVENT_NOTIFICATION_ERROR_CODES = deepFreeze({
  CAPABILITY_NOT_AVAILABLE: {
    code: 'CAPABILITY_NOT_AVAILABLE',
    normalizedCode: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_PRECONDITION_FAILED,
    httpStatus: 501,
    retryability: 'not_retryable',
    fallbackHint: 'Use a provider profile that explicitly satisfies bucket.event_notifications before enabling storage event notifications.'
  },
  DESTINATION_NOT_ALLOWED: {
    code: 'DESTINATION_NOT_ALLOWED',
    normalizedCode: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_ACCESS_DENIED,
    httpStatus: 403,
    retryability: 'not_retryable',
    fallbackHint: 'Select a destination type allowed for the current tenant/workspace governance profile.'
  },
  RULE_LIMIT_EXCEEDED: {
    code: 'RULE_LIMIT_EXCEEDED',
    normalizedCode: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_QUOTA_EXCEEDED,
    httpStatus: 409,
    retryability: 'not_retryable',
    fallbackHint: 'Delete an existing notification rule or increase the notification-rule limit before retrying.'
  },
  INVALID_RULE: {
    code: 'INVALID_RULE',
    normalizedCode: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_INVALID_REQUEST,
    httpStatus: 400,
    retryability: 'not_retryable',
    fallbackHint: 'Correct the notification rule payload and retry.'
  },
  INVALID_EVENT: {
    code: 'INVALID_EVENT',
    normalizedCode: STORAGE_NORMALIZED_ERROR_CODES.STORAGE_INVALID_REQUEST,
    httpStatus: 400,
    retryability: 'not_retryable',
    fallbackHint: 'Provide a supported storage event type and valid bucket scope before retrying.'
  }
});

export function buildStorageEventGovernanceProfile({
  tenantId = null,
  workspaceId = null,
  allowedDestinationTypes = [],
  maxTenantRules = null,
  currentTenantRuleCount = 0,
  maxWorkspaceRules = null,
  currentWorkspaceRuleCount = 0,
  builtAt = DEFAULT_NOW
} = {}) {
  return deepFreeze({
    tenantId,
    workspaceId,
    allowedDestinationTypes: Object.freeze(normalizeAllowedDestinationTypes(allowedDestinationTypes)),
    tenantLimits: buildRuleLimitStatus({ maxRules: maxTenantRules, currentRules: currentTenantRuleCount }),
    workspaceLimits: buildRuleLimitStatus({ maxRules: maxWorkspaceRules, currentRules: currentWorkspaceRuleCount }),
    builtAt
  });
}

export function buildStorageEventNotificationRule({
  ruleId = null,
  tenantId = null,
  workspaceId = null,
  bucketId = null,
  destinationType = null,
  destinationRef = null,
  eventTypes = [],
  filters = {},
  enabled = true,
  actorRef = null,
  correlationId = null,
  createdAt = DEFAULT_NOW,
  updatedAt = createdAt
} = {}) {
  const normalizedDestinationType = normalizeDestinationType(destinationType);
  const normalizedFilters = {
    prefix: typeof filters.prefix === 'string' && filters.prefix.trim() ? filters.prefix.trim() : null,
    suffix: typeof filters.suffix === 'string' && filters.suffix.trim() ? filters.suffix.trim() : null
  };

  return deepFreeze({
    ruleId: ruleId ?? generateRuleId(),
    tenantId,
    workspaceId,
    bucketId,
    destinationType: normalizedDestinationType,
    destinationRef: typeof destinationRef === 'string' ? destinationRef.trim() || null : null,
    eventTypes: Object.freeze(normalizeEventTypes(eventTypes)),
    filters: deepFreeze(normalizedFilters),
    enabled: Boolean(enabled),
    actorRef: sanitizeAuditString(actorRef),
    correlationId: sanitizeAuditString(correlationId),
    createdAt,
    updatedAt
  });
}

export function buildStorageEventNotificationDeliveryPreview({
  rule,
  event,
  matchedAt = DEFAULT_NOW
} = {}) {
  return deepFreeze({
    deliveryId: generateDeliveryId(),
    ruleId: rule?.ruleId ?? null,
    destinationType: rule?.destinationType ?? null,
    destinationRef: sanitizeAuditString(rule?.destinationRef),
    eventType: event?.eventType ?? null,
    tenantId: event?.tenantId ?? rule?.tenantId ?? null,
    workspaceId: event?.workspaceId ?? rule?.workspaceId ?? null,
    bucketId: event?.bucketId ?? rule?.bucketId ?? null,
    objectKey: sanitizeAuditString(event?.objectKey),
    actorRef: sanitizeAuditString(event?.actorRef),
    correlationId: sanitizeAuditString(event?.correlationId ?? rule?.correlationId),
    occurredAt: event?.occurredAt ?? DEFAULT_NOW,
    matchedAt
  });
}

export function buildStorageEventNotificationAuditEvent({
  action,
  outcome = 'allowed',
  rule = null,
  deliveryPreview = null,
  reasonCode = null,
  occurredAt = DEFAULT_NOW,
  actorRef = null,
  correlationId = null
} = {}) {
  const normalizedAction = Object.values(STORAGE_EVENT_NOTIFICATION_AUDIT_ACTIONS).includes(action)
    ? action
    : STORAGE_EVENT_NOTIFICATION_AUDIT_ACTIONS.DELIVERY_PREVIEWED;

  return deepFreeze({
    eventType: 'storage.event_notification.audit',
    action: normalizedAction,
    outcome,
    ruleId: rule?.ruleId ?? deliveryPreview?.ruleId ?? null,
    tenantId: rule?.tenantId ?? deliveryPreview?.tenantId ?? null,
    workspaceId: rule?.workspaceId ?? deliveryPreview?.workspaceId ?? null,
    bucketId: rule?.bucketId ?? deliveryPreview?.bucketId ?? null,
    destinationType: rule?.destinationType ?? deliveryPreview?.destinationType ?? null,
    destinationRef: sanitizeAuditString(rule?.destinationRef ?? deliveryPreview?.destinationRef),
    matchedEventType: deliveryPreview?.eventType ?? null,
    objectKey: sanitizeAuditString(deliveryPreview?.objectKey),
    reasonCode,
    actorRef: sanitizeAuditString(actorRef ?? rule?.actorRef ?? deliveryPreview?.actorRef),
    correlationId: sanitizeAuditString(correlationId ?? rule?.correlationId ?? deliveryPreview?.correlationId),
    occurredAt
  });
}

export function checkStorageEventNotificationCapability({ providerProfile } = {}) {
  const entry = getCapabilityEntry(providerProfile);
  const state = entry?.state ?? DEFAULT_SATISFACTION_STATE;
  const constraints = Object.freeze([...(entry?.constraints ?? [])]);
  const allowed = state === 'satisfied';

  return deepFreeze({
    capabilityId: STORAGE_EVENT_NOTIFICATION_CAPABILITY_ID,
    allowed,
    satisfactionState: state,
    constraints,
    ...(allowed
      ? {}
      : {
          errorEnvelope: buildErrorEnvelope(STORAGE_EVENT_NOTIFICATION_ERROR_CODES.CAPABILITY_NOT_AVAILABLE, {
            missingCapabilityId: STORAGE_EVENT_NOTIFICATION_CAPABILITY_ID,
            message: 'The current provider profile does not satisfy storage event notification support.'
          })
        })
  });
}

export function validateStorageEventNotificationRule({
  rule,
  ruleInput,
  providerProfile,
  governanceProfile = buildStorageEventGovernanceProfile()
} = {}) {
  const candidateRule = rule ?? buildStorageEventNotificationRule(ruleInput ?? {});
  const capabilityCheck = checkStorageEventNotificationCapability({ providerProfile });
  const violations = [];

  if (!candidateRule.bucketId) {
    violations.push(buildViolation(
      STORAGE_EVENT_NOTIFICATION_ERROR_CODES.INVALID_RULE,
      'Notification rules require a bucketId.'
    ));
  }

  if (!candidateRule.destinationType || !candidateRule.destinationRef) {
    violations.push(buildViolation(
      STORAGE_EVENT_NOTIFICATION_ERROR_CODES.INVALID_RULE,
      'Notification rules require a supported destinationType and destinationRef.'
    ));
  }

  if (!candidateRule.eventTypes.length) {
    violations.push(buildViolation(
      STORAGE_EVENT_NOTIFICATION_ERROR_CODES.INVALID_RULE,
      'Notification rules require at least one supported event type.'
    ));
  }

  if (
    candidateRule.destinationType &&
    !governanceProfile.allowedDestinationTypes.includes(candidateRule.destinationType)
  ) {
    violations.push(buildViolation(
      STORAGE_EVENT_NOTIFICATION_ERROR_CODES.DESTINATION_NOT_ALLOWED,
      `Destination type ${candidateRule.destinationType} is not allowed for the current governance profile.`
    ));
  }

  const tenantWouldExceed = governanceProfile.tenantLimits.maxRules != null
    && governanceProfile.tenantLimits.currentRules + 1 > governanceProfile.tenantLimits.maxRules;
  const workspaceWouldExceed = governanceProfile.workspaceLimits.maxRules != null
    && governanceProfile.workspaceLimits.currentRules + 1 > governanceProfile.workspaceLimits.maxRules;

  if (tenantWouldExceed || workspaceWouldExceed) {
    violations.push(buildViolation(
      STORAGE_EVENT_NOTIFICATION_ERROR_CODES.RULE_LIMIT_EXCEEDED,
      'Creating this notification rule would exceed the tenant/workspace notification-rule limit.',
      {
        tenantRemainingRules: governanceProfile.tenantLimits.remainingRules,
        workspaceRemainingRules: governanceProfile.workspaceLimits.remainingRules
      }
    ));
  }

  if (!capabilityCheck.allowed) {
    violations.push(buildViolation(
      STORAGE_EVENT_NOTIFICATION_ERROR_CODES.CAPABILITY_NOT_AVAILABLE,
      'The provider capability for storage event notifications is not available.',
      { missingCapabilityId: STORAGE_EVENT_NOTIFICATION_CAPABILITY_ID }
    ));
  }

  return deepFreeze({
    valid: violations.length === 0,
    rule: candidateRule,
    governanceProfile,
    capabilityCheck,
    violations: Object.freeze(violations),
    effectiveViolation: violations[0] ?? null
  });
}

export function matchStorageEventNotificationRule({
  rule,
  event,
  providerProfile
} = {}) {
  const capabilityCheck = checkStorageEventNotificationCapability({ providerProfile });
  const reasons = [];

  if (!rule?.enabled) {
    reasons.push('rule_disabled');
  }

  if (!capabilityCheck.allowed) {
    reasons.push('capability_not_available');
  }

  if (!event?.eventType || !Object.values(STORAGE_EVENT_NOTIFICATION_EVENT_TYPES).includes(event.eventType)) {
    reasons.push('invalid_event_type');
  }

  if (!rule?.eventTypes?.includes(event?.eventType)) {
    reasons.push('event_type_not_subscribed');
  }

  if ((rule?.tenantId ?? null) !== (event?.tenantId ?? null)) {
    reasons.push('tenant_mismatch');
  }

  if ((rule?.workspaceId ?? null) !== (event?.workspaceId ?? null)) {
    reasons.push('workspace_mismatch');
  }

  if ((rule?.bucketId ?? null) !== (event?.bucketId ?? null)) {
    reasons.push('bucket_mismatch');
  }

  if (!matchesFilter(rule?.filters, event?.objectKey ?? null)) {
    reasons.push('key_filter_mismatch');
  }

  return deepFreeze({
    matched: reasons.length === 0,
    ruleId: rule?.ruleId ?? null,
    eventType: event?.eventType ?? null,
    reasons: Object.freeze(reasons),
    capabilityCheck
  });
}

export function evaluateStorageEventNotifications({
  rules = [],
  event,
  providerProfile,
  evaluatedAt = DEFAULT_NOW
} = {}) {
  const normalizedRules = [...rules];
  const matches = [];
  const nonMatches = [];

  for (const rule of normalizedRules) {
    const evaluation = matchStorageEventNotificationRule({ rule, event, providerProfile });
    if (evaluation.matched) {
      matches.push(buildStorageEventNotificationDeliveryPreview({ rule, event, matchedAt: evaluatedAt }));
    } else {
      nonMatches.push(deepFreeze({
        ruleId: rule?.ruleId ?? null,
        reasons: evaluation.reasons
      }));
    }
  }

  return deepFreeze({
    supported: checkStorageEventNotificationCapability({ providerProfile }).allowed,
    allowed: matches.length > 0,
    eventType: event?.eventType ?? null,
    matches: Object.freeze(matches),
    nonMatches: Object.freeze(nonMatches),
    evaluatedAt
  });
}
