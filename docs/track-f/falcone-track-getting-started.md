# Falcone Track — Getting Started (Gap Closure with Claude Opus 5)

v0.1 · 2026-08-04 · Executes §2 of `delivery-plan.md` (Track F) · Companions: `FALCONE_GAP_ANALYSIS_FOR_LLM_CODE_WIKI.md` v1.0 · `falcone-gap-analysis.md` v0.5

## 0. What starting Track F means

The workspace becomes three sibling folders with a hard ownership boundary:

```
workspace/
  llmwiki/               ← Codex only (portal). Claude Code never enters.
  llmwiki-contracts/     ← openapi/falcone-ai/* is now OWNED by this track (contract handover)
  falcone/               ← clone of gntik-ai/falcone. Claude Code's home. Codex never enters.
```

Target environment — **no kind**. Falcone runs on the team's Kubernetes cluster, reachable as the **current default kubectl context**, inside **its own namespace**, which may be modified freely. The safety rule changes accordingly: **before any mutating action, confirm `kubectl config current-context` is the expected default context AND the operation targets the Falcone namespace only** — never another namespace. Export it once (`FALCONE_NS=<falcone namespace>`) and use `-n $FALCONE_NS` everywhere.

One deployment now serves both the campaign loop and the portal's integration. The loop's resilience slices are disruptive by design (pod kills, failovers): run them in announced windows — or, since Falcone installs namespace-scoped, stand up a second namespace (e.g. `falcone-test`) on the same cluster for destructive slices and keep the main namespace stable for the portal.

## 1. Prerequisites

- **Claude Code v2.1.219 or later** (`npm install -g @anthropic-ai/claude-code`, or `claude update`). Opus 5 requires ≥ 2.1.219; below that the `opus` alias silently keeps resolving to Opus 4.8.
- A plan that includes Opus 5: Max, Team Premium, Enterprise pay-as-you-go, or an API key. (Pro tops out at Sonnet 5.)
- Model: `/model opus` in-session (the alias lands on Opus 5 from v2.1.219) or `claude --model claude-opus-5`. Effort defaults to high; `/effort` adjusts it — drop to medium for routine sessions, keep high for spec drafting and hard debugging.
- **CLAUDE.md hygiene for Opus 5:** do NOT include "always double-check your work / verify before reporting" boilerplate. Opus 5 self-verifies by training; adding those lines causes over-verification and wasted tokens (per Anthropic's Opus 5 prompting guide).
- `gh` CLI authenticated against `gntik-ai/falcone` (the loop files issues); kubectl + helm pointed at the default-context cluster, with rights on the Falcone namespace; Docker only if you build images locally.
- Your **falcone-testing skill** and **loop-kit** installed for this checkout: skill folder → `.claude/skills/falcone-testing/`, loop-kit agents/commands (including the `falcone-explorer` and `falcone-verifier` subagents) → `.claude/agents/` and `.claude/commands/`, bash drivers wherever the kit expects them.

## 2. Files inside `falcone/`

| File / folder | Role |
|---|---|
| `falcone-capability-test-prompt.md` (repo root) | The mission brief the skill defers to: personas P1–P27, Phases 1–6, and the **OpenSpec issue format**. Already in the repo — the loop reads it every run. |
| `falcone-loop-state/` | Campaign ledger, read at the start of every run: `CAPABILITIES.md`, `TEST-PLAN.md`, `COVERAGE.md`, `FINDINGS.md` (`FINGERPRINT \| type \| severity \| issue-url`), `RUNLOG.md`. |
| `CLAUDE.md` | Track F rules — template in §3. |
| `docs/track-f/` | Copy in: `FALCONE_GAP_ANALYSIS_FOR_LLM_CODE_WIKI.md` (v1.0, the authoritative claims to verify), `falcone-gap-analysis.md` (v0.5 reconciliation), `delivery-plan.md`, `DECISIONS.md` (synced with the portal's copy), `production-readiness.md` (§6 skeleton). |
| `.claude/skills/`, `.claude/agents/`, `.claude/commands/` | falcone-testing skill + loop-kit. |
| `.gitignore` | Must cover kubeconfigs, tokens, BYOK keys — the skill forbids secrets in git. |

## 3. `CLAUDE.md` template (falcone root)

```markdown
# CLAUDE.md — Falcone · Track F (gap closure)

Mission: close the platform gaps in docs/track-f/ via OpenSpec changes,
in the wave order of docs/track-f/delivery-plan.md §2. The portal
(../llmwiki) consumes this platform through versioned contracts only.

## Hard rules
1. OpenSpec first. No implementation without an approved change under
   openspec/ (follow the existing changes in this repo as the format
   reference). Every change includes ALL of: public API and event
   contracts · tenant/workspace authorization · failure and idempotency
   semantics · migration and backward compatibility · secret redaction ·
   audit events · quotas · black-box tests · multi-replica tests ·
   operator runbook · production-readiness acceptance evidence.
2. Every task references IDs: GAP-FAL-x / GAP-AI-x / GAP-PRD-001 plus
   the baseline requirement IDs it serves (e.g. MOD-016, RUN-005,
   CST-018).
3. Maker ≠ checker. Suspected defects go to the falcone-verifier
   subagent; only CONFIRMED findings are filed. Implementations get an
   independent review pass before merge.
4. Safety: before any mutating action, confirm the kubectl context is
   the expected default context and the target is the Falcone
   namespace ($FALCONE_NS) only — never another namespace. Run
   destructive/resilience slices in announced windows or in the
   optional second namespace (falcone-test) on the same cluster.
5. Secrets: never in git, never in Temporal workflow inputs/history —
   opaque secret references only (FAL-012). BYOK keys live in untracked
   files or the platform secret store.
6. Contract handover: when a change's API contract is approved, publish
   it to ../llmwiki-contracts/openapi/falcone-ai/ (supersede the
   matching v0-DRAFT, bump CHANGELOG.md, note the diff vs the DRAFT).
   That folder is the ONLY thing outside this repo you may edit; the
   ../llmwiki portal is off-limits.
7. Human review required before merge for: Keycloak realm/client
   changes, OpenBao paths and policies, Temporal payload/codec changes,
   APISIX routes, database migrations, anything touching tenant
   isolation.

## Definition of done (per OpenSpec change)
Approved spec · migration proven on the cluster (up + rollback) ·
black-box and multi-replica tests green in $FALCONE_NS · audit events and
redaction verified · runbook written · CAPABILITIES.md and the
delivery-plan blockers board updated · contract handed over.
```

## 4. Phase F0 — verification campaign (do this before any gap work)

The authoritative gap analysis was **static** (no live deployment). F0 converts its Covered/Partial claims into evidence and opens the gap issues.

1. Verify the environment: `kubectl config current-context` shows the expected default context; `export FALCONE_NS=<falcone namespace>`; `kubectl -n $FALCONE_NS get pods` shows Falcone healthy (the loop force-installs/repairs into that namespace if it is not).
2. `cd falcone && claude` → `/model opus`.
3. Kick off with:

```
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
```

4. Converge with the loop's goal mechanism, e.g. `/goal "every claim row from §4-§11 is marked verified/refuted in COVERAGE.md with printed evidence, every suspected defect has a falcone-verifier verdict printed, FINDINGS.md updated — or stop after N turns"`.
5. **Exit criteria:** `COVERAGE.md` covers the claim list; the 15 suggested OpenSpec changes exist as tracked issues (or are marked as already covered by your pre-existing 14-item register); `CAPABILITIES.md` matches reality.

## 5. Wave 1 — first OpenSpec changes (delivery-plan §2.4)

W1 = `add-multi-provider-connection-registry` (FAL-001) · `encrypt-sensitive-flow-payloads` (FAL-012) · `add-code-wiki-quota-dimensions` spec (FAL-010, proceed on the D4 "per workspace" assumption, flagged) · PRD-001 program kickoff (§6).

Per change, three session types:

**Session A — spec (plan mode, effort high).** Prompt for FAL-001:

```
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
```

Then you review and approve — this is the gate.

**Contract handover (you or the agent, after approval).** Replace the v0-DRAFT in `llmwiki-contracts/openapi/falcone-ai/`, add a CHANGELOG entry with the DRAFT→v1 diff, and note it in the portal's `docs/platform-wait.md` so Codex flips `ff_models_settings` and finishes the waiting UI against the live endpoint.

**Session B — implement (maker/checker).** Implement against the approved spec; migration up+rollback proven on the cluster; black-box + multi-replica tests; independent review pass before merge (second session or verifier agent with the diff).

**Session C — close.** Runbook, docs, `CAPABILITIES.md`, blockers board, and a quick regression pass (the skill's regression mode: re-check open issues via falcone-verifier, close what no longer reproduces).

FAL-012 spec prompt (same pattern): scope = no secret values in Flow inputs/history (opaque references), payload codec/encryption for sensitive metadata, restricted Temporal UI/history access, retention — serves GAP-FAL-012 and the §19 gate; it is a precondition for FAL-002 touching real credentials.

Then W2 (`integrate-byok-with-workspace-secret-store`, adapter contract, `add-tenant-fair-job-admission-queue`) per the dependency graph.

## 6. `docs/track-f/production-readiness.md` — PRD-001 skeleton

```markdown
# GAP-PRD-001 — Production readiness (release gate)
Rule: no external private repository is ingested before every row is
CLOSED with linked evidence. Reviewed at the end of every wave.

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
| 9 | DR objectives + rehearsal evidence | OPEN | |
| 10 | Vulnerability / dependency / image / supply-chain controls | OPEN | |
| 11 | SLOs, alerting, incident response, support ownership | OPEN | |
| 12 | Defined supported release (not a moving main) | OPEN | |
| 13-27 | §19 go/no-go criteria 1–15 (one row each) | OPEN | |
```

## 7. Cadence & coordination with the portal

- Weekly: regression pass on the Falcone namespace (or the optional `falcone-test` namespace); roll the namespace to the latest merged state for the portal; review the blockers board together with the portal's `mock-debt.md`.
- Unblock order (what the portal is waiting for): FAL-001+FAL-002 → S3 flag flip (real Settings ▸ Models) · FAL-008 → M2 real queue position · FAL-005/006/007 → M4 batch + costs · PRD-001 closed → M5 private repositories.
- Never parallelize two OpenSpec changes that touch the same schema or executor; the graph in `delivery-plan.md` §2.3 defines what can run concurrently.
