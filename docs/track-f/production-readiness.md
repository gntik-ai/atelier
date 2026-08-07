# GAP-PRD-001 — Production readiness (release gate)

Rule: no external private repository is ingested before every row is
CLOSED with linked evidence. Reviewed at the end of every wave.
Rows 1–12: closure evidence from GAP-PRD-001. Rows 13–27: the §19
go/no-go criteria from FALCONE_GAP_ANALYSIS_FOR_LLM_CODE_WIKI.md.

| # | Evidence item | Status | Evidence |
|---|---|---|---|
| 1 | Supported production topology + version matrix | OPEN | |
| 2 | Threat model + independent security review | OPEN | |
| 3 | Tenant-isolation tests across all used APIs and background paths | OPEN | |
| 4 | Secret lifecycle + credential-compromise procedures | OPEN | |
| 5 | Migration/upgrade/rollback/compatibility guarantees | OPEN | |
| 6 | Backup/restore rehearsals incl. application-domain data | OPEN | |
| 7 | HA / multi-replica behavior validated | OPEN | |
| 8 | Capacity + soak tests (large workflows, object storage) | OPEN | |
| 9 | Disaster-recovery objectives + rehearsal evidence | OPEN | |
| 10 | Vulnerability / dependency / image / supply-chain controls | OPEN | |
| 11 | SLOs, alerting, incident response, support ownership | OPEN | |
| 12 | Defined supported release (not a moving main branch) | OPEN | |
| 13 | Supported release/build deployed in the beta environment | OPEN | |
| 14 | Tenant isolation tested across all product-used resources | OPEN | |
| 15 | Repo + provider credentials fully self-service, write-only, rotated, revocable, never in workflow history | OPEN | |
| 16 | Git workers isolated; repository code never executes by default | OPEN | |
| 17 | Private GitHub, GitLab and generic Git paths pass e2e security tests | OPEN | |
| 18 | At least two LLM connections coexist in one workspace | OPEN | |
| 19 | Launch providers have validated adapters + capability records | OPEN | |
| 20 | Batch state/cancel/partial/reconciliation/usage correct per advertised provider | OPEN | |
| 21 | Queue position honest and tenant-fair | OPEN | |
| 22 | Snapshots, artifacts, indexes, histories: deletion + restore tested | OPEN | |
| 23 | Wiki publication atomic and failure-safe | OPEN | |
| 24 | Every answer/page citation access-controlled and version-consistent | OPEN | |
| 25 | Estimates, actual usage, budget blocks, retry/batch accounting tested | OPEN | |
| 26 | Audit + support diagnostics contain no secrets or unnecessary source | OPEN | |
| 27 | Security review, incident runbook, data-processing disclosures complete | OPEN | |
