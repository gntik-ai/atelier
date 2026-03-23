# Audit Module

This workspace is reserved for append-only audit evidence in the control plane.

Initial responsibility boundaries:

- accept versioned audit records from control and orchestration flows
- persist append-only evidence and correlation metadata
- retain authorization decision identifiers, effective roles, and delegation-chain evidence without storing raw credentials
- retain evidence pointers/redaction rules behind a dedicated module boundary

Future tasks should extend this package for query/export behavior without changing the producer-facing `audit_record` contract semantics.

Current authorization scaffolding:

- `contract-boundary.mjs` exposes the baseline audit contract slice
- `authorization-context.mjs` exposes the audit projection expected from the shared authorization model
