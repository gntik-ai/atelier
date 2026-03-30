# Outbound Webhooks E2E Scenario Matrix

| Scenario | Setup | Steps | Expected outcome |
| --- | --- | --- | --- |
| Happy path — single delivery | Active subscription + mock endpoint 200 | Create sub, emit event, inspect attempts | One POST received, one succeeded attempt |
| Failed then recovered | Endpoint fails twice then 200 | Emit event and let retries run | N failed attempts then succeeded |
| All retries exhausted | Endpoint always 503 | Emit event until retries exhausted | Delivery permanently_failed |
| Auto-disable | Threshold set to 1 | Force permanently failed delivery | Subscription becomes disabled |
| Paused subscription | Subscription paused | Emit matching event | No delivery row created |
| Quota exceeded | Workspace at limit | Create one more subscription | 409 QUOTA_EXCEEDED |
| Cross-workspace isolation | Two workspaces with same event type | Emit event for one workspace | Only matching workspace gets delivery |
| Secret rotation grace | Rotate secret with grace period | Verify signature with old/new secret during grace | Both validate until expiry |
| Redirect not followed | Endpoint returns 302 | Emit event | Attempt marked failed, no redirect follow |
| Payload size limit | Oversized event payload | Emit event | payload_ref set and truncated marker stored |
