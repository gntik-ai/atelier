// Aggregate the non-mutating C-08 handler families.  Keeping the implementations
// separated makes their dependency and isolation boundaries explicit:
// observability adapters, function/audit repositories, platform discovery/billing,
// and the tenant governance composition.
import { C08_OBSERVABILITY_HANDLERS } from './c08-observability-handlers.mjs';
import { C08_FUNCTION_AUDIT_HANDLERS } from './c08-function-audit-handlers.mjs';
import { PLATFORM_DISCOVERY_HANDLERS } from './platform-discovery-handlers.mjs';
import { C08_DASHBOARD_HANDLERS } from './c08-dashboard-handler.mjs';

export const C08_HANDLERS = Object.freeze({
  ...C08_OBSERVABILITY_HANDLERS,
  ...C08_FUNCTION_AUDIT_HANDLERS,
  ...PLATFORM_DISCOVERY_HANDLERS,
  ...C08_DASHBOARD_HANDLERS
});
