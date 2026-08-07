# W1 — FAL-001 spec session (plan mode, effort high)

Draft the OpenSpec change add-multi-provider-connection-registry
(GAP-FAL-001; serves FR-PROV-01/02/06, MOD-002/011/012/018, portal S3).
Read first: docs/track-f/FALCONE_GAP_ANALYSIS_FOR_LLM_CODE_WIKI.md §8 +
GAP-FAL-001, the existing openspec/ changes as format reference, and
../llmwiki-contracts/openapi/falcone-ai/provider-connections.v0-DRAFT.yaml
— treat the DRAFT as the consumer's expectation: keep its shapes where
sound, and list every deviation explicitly. The change must cover the 11
required sections (CLAUDE.md rule 1), including the migration off the
unique (tenant_id, workspace_id) key in workspace_llm_providers with
backward compatibility for the current single-connection API. Deliver
the proposal + the real OpenAPI contract. Do not implement yet.
