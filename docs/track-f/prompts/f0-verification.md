# F0 — verification campaign kickoff (paste into Claude Code, /model opus)

Run the falcone-testing loop. Slice for this campaign: verify every
"Covered foundation" and "Partial" claim in
docs/track-f/FALCONE_GAP_ANALYSIS_FOR_LLM_CODE_WIKI.md §4-§11, plus the
§19 go/no-go items that can be checked on the cluster. Discovery on. For each
claim, print the evidence (commands + output). Suspected defects go to
falcone-verifier; file only CONFIRMED findings, deduped against
FINDINGS.md and open gh issues, in the brief's OpenSpec format
(bug = MODIFIED requirement, enhancement = ADDED requirement). For each
of the 12 platform gaps (GAP-FAL-001..012 and the two GAP-AI items),
confirm current state and open/refresh the corresponding enhancement
issue named after its suggested OpenSpec change. Update the ledger.

Convergence:
/goal "every claim row in falcone-loop-state/TEST-PLAN.md section F0 is
PASS/FAIL/REFUTED with printed evidence, every suspected defect has a
falcone-verifier verdict printed, FINDINGS.md updated — or stop after N
turns"
