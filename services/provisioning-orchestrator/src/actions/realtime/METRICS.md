# Realtime metrics

- `realtime_subscriptions_created_total{workspace_id,tenant_id,channel_type}`
- `realtime_subscriptions_active_gauge{workspace_id}`
- `realtime_subscription_resolver_matches_total{workspace_id,channel_type}`
- `realtime_quota_rejections_total{tenant_id,workspace_id}`

Suggested instrumentation points:
- create success / quota rejection in `realtime-subscription-crud.mjs`
- active count changes on suspend/reactivate/delete
- resolver match count in `realtime-subscription-resolver.mjs`
