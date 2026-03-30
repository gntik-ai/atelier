export function guardEvent(event, sessionContext) {
  return event?.tenantId === sessionContext?.tenantId
    && event?.workspaceId === sessionContext?.workspaceId;
}
