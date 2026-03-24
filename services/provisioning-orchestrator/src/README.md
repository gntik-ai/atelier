# Provisioning Orchestrator

This workspace is reserved for the control-plane provisioning orchestrator.

Initial responsibility boundaries:

- accept versioned provisioning requests
- correlate runs by stable idempotency keys
- preserve tenant/workspace authorization context and plan guardrails across orchestration
- normalize signup-activation bootstrap requests into one tenant/workspace owner-aware run
- persist per-resource provisioning state so console/API consumers can inspect bootstrap progress
- resume partially failed runs without replaying already converged resources
- sequence provider-facing adapter calls
- aggregate outcomes into shared provisioning-result envelopes
- emit audit evidence for step changes and terminal outcomes

Future tasks should implement runtime behavior here without bypassing `services/internal-contracts` or provider ports in `services/adapters`.

Current authorization scaffolding:

- `contract-boundary.mjs` exposes the internal provisioning contracts
- `authorization-context.mjs` exposes the propagated authorization projections used by downstream adapter calls
