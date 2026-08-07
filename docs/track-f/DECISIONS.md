# Product decisions (owner-approved) — keep in sync with llmwiki/docs/DECISIONS.md

| ID | Decision | Status | Value |
|----|----------|--------|-------|
| D1 | Free-plan limits | OPEN | proposal: 1 concurrent run |
| D2 | $1 per month USD? | OPEN | proposal: yes |
| D3 | Payment provider | OPEN | proposal: Stripe |
| D4 | Billing/entitlement anchor | OPEN | proposal: per workspace |
| D5 | Launch batch providers | OPEN | proposal: OpenAI + Anthropic |
| D6 | Parsing languages | ASSUMED | TS/JS + Python (tree-sitter) |
| D7 | Retention defaults | OPEN | |
| D8 | Workspace mapping | ASSUMED | 1 Falcone WS per product WS |
| D9 | Public snippets default | OPEN | |

Agents: ASSUMED values may be built against but must stay isolated
behind config so a reversal is cheap. D4 blocks FAL-010 finalization;
D5 blocks FAL-006 provider scope.
