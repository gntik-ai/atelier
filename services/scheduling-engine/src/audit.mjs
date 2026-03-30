function buildEvent(action, { tenantId, workspaceId, actorId, resourceId, metadata = {} }) {
  return {
    tenantId,
    workspaceId,
    actorId,
    action,
    resourceId,
    timestamp: new Date().toISOString(),
    metadata,
  };
}

export const jobCreatedEvent = (input) => buildEvent('job.created', input);
export const jobUpdatedEvent = (input) => buildEvent('job.updated', input);
export const jobPausedEvent = (input) => buildEvent('job.paused', input);
export const jobResumedEvent = (input) => buildEvent('job.resumed', input);
export const jobDeletedEvent = (input) => buildEvent('job.deleted', input);
export const jobErroredEvent = (input) => buildEvent('job.errored', input);
export const executionSucceededEvent = (input) => buildEvent('execution.succeeded', input);
export const executionFailedEvent = (input) => buildEvent('execution.failed', input);
export const executionTimedOutEvent = (input) => buildEvent('execution.timed_out', input);
export const executionMissedEvent = (input) => buildEvent('execution.missed', input);
export const capabilityToggledEvent = (input) => buildEvent('capability.toggled', input);
export const quotaExceededEvent = (input) => buildEvent('quota.exceeded', input);
