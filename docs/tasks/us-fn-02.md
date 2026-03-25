# US-FN-02 — Governed functions surface over OpenWhisk

## Summary

Expanded the functions family from basic package and trigger administration into a full
workspace-governed serverless surface.

## Delivered scope

- Function action CRUD with logical-name normalization and internal-only namespace/subject binding.
- Deployment source coverage for inline code, packaged artifacts, stored references, and runtime images.
- Execution configuration for runtime, entrypoint, params, env, timeout, memory, limits, and web-action settings.
- Direct invocation plus activation listing, activation detail, logs, result, and rerun endpoints.
- APISIX-managed HTTP exposure contracts.
- Managed trigger contracts for Kafka, storage, and cron delivery.
- OpenWhisk compatibility metadata with supported runtimes, source kinds, trigger kinds, and managed exposure policy.
- Internal contract updates for deployment source, execution policy, trigger bindings, exposure projection, and inventory projections.
- Adapter and control-plane helper coverage plus contract validation for the expanded surface.

## Notes

This feature preserves the product rule that native OpenWhisk namespace and subject CRUD stay
internal-only. All public routes remain multi-tenant, quota-aware, auditable, and scoped through
the control-plane abstractions.
