# W1 — FAL-012 spec session (plan mode, effort high)

Draft the OpenSpec change encrypt-sensitive-flow-payloads
(GAP-FAL-012; serves §19 item 15 of docs/track-f/production-readiness.md,
RUN-033, DAT-005; precondition for FAL-002 touching real credentials).
Read first: docs/track-f/FALCONE_GAP_ANALYSIS_FOR_LLM_CODE_WIKI.md
GAP-FAL-012 and the Flows architecture doc it cites. Scope: no secret
value (provider key, repository token, OAuth refresh token) may enter
workflow inputs or Temporal history — opaque secret/connection IDs
only; payload codec/encryption for sensitive non-secret customer
metadata; restricted Temporal UI/history access; retention and
deletion; tests that scan activity logs, errors and history for
source/secret leakage. Cover the 11 required sections (CLAUDE.md rule
1). Deliver the proposal only. Do not implement yet.
