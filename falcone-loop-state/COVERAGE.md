# Coverage

Coverage % = tested items / items in CAPABILITIES.md. Keep it honest.
Updated run **F0-R1**, 2026-08-08 (supersedes everything below it).

## F0-R1 health slice — core covered capabilities

Run against the post-F0-4 full topology (chart `in-falcone-0.4.1` rev 20: executor ×2,
workflow-worker ×2, Temporal 1.31.1, SeaweedFS, OpenBao all newly core).

| Capability | Verdict | Evidence |
|---|---|---|
| **auth** | **PARTIAL** | Superadmin/platform-realm PASS end to end (token mint, tenant + workspace provisioning, 28-section console). Tenant-realm users still cannot obtain a session — #953, re-confirmed critical. |
| **flows** | **FAIL** | Substrate healthy: namespace `falcone-flows` registered, both workers polling `flows-main`. But **zero workflow executions have ever run** and none can be started — `/v1/flows/workspaces/{ws}/flows` → 401 for every principal (falcone-charts#13). |
| **documents** | **FAIL** | Provision + read work (`POST /v1/workspaces/{ws}/databases` → 201; collections/documents list → 200). **No write path exists**: the control plane's mongo routes are all GET/export/import, and the executor's write route is 401-walled. Document CRUD cannot be completed by any principal. |
| **storage** | **PARTIAL** *(was PASS)* | Read round-trip PASS via `contentBase64`; 2048-byte object sha256-exact, delete verified, usage metering live. **[DOWNGRADED 2026-08-09, triage batch]** The claim *"`contentBase64` is correct"* was **withdrawn**: ~~**#994** shows `contentBase64` is the schema-*mandated* write field and the handler ignores it — a conformant `PUT` returns 201 with `sizeBytes: 0`, and GET→PUT silently corrupts~~ **FIXED `192c8cd0`…`cf4f8a45`, verifier CONFIRMED-FIXED on both original reproductions — `contentBase64` is honoured and takes precedence, GET→PUT is byte-identical, an unusable body is 400 before any backend call; #966's lossy `content` field is gone from the read envelope. NOT yet true on staging, which runs the pre-fix image.** Still standing: **#973** (`denyUnlessBucketOwner` never reads `workspace_id`) and **#998** (shared E2E workspace has no bucket). **Row stays PARTIAL**: the write path and the read envelope are repaired, object *authorization* and the E2E fixture are not. |
| **llm** | **FAIL** | 401 `Missing tenant identity` for every principal shape tried — superadmin, tenant-realm service account, and the apikey path. No provider could be configured (falcone-charts#13). |
| **webhooks** | **FAIL** | Superadmin 500, service account 404 — #957 unchanged, no drift. |
| *(secrets, bonus)* | **PARTIAL** *(was PASS)* | The API-tier round trip and write-only-on-read guarantee still hold. **[DOWNGRADED 2026-08-09, triage batch]** Consumption, erasure, session and attribution all FAIL: **#970** (resolved plaintext inlined into five Knative object kinds, zero K8s Secrets, survives revocation), **#977** (survives tenant purge in OpenBao with plaintext intact, undisclosed and unrevocable), **#984** (token never renewed → every secret route 502s within ≤24 h), **#974** (superadmin mutations unaudited). |

**Three of the four FAILs share one cause** — falcone-charts#13, the executor's missing
Keycloak OIDC configuration. That single chart fix would move flows, llm and document-writes
from "unreachable" to genuinely testable for the first time in this campaign.

**Regression pass:** all 29 open findings re-verified from a clean state; **29 of 29 still
reproduce, 0 closed.** 4 new defects filed (falcone-charts#13 critical, falcone-charts#12,
#966, #967), 1 candidate ruled ENVIRONMENT and not filed.

**Honest note on the numbers below.** The F0-2 table's "76% verified" rested on treating the
executor-owned surface as legitimately absent. It is now deployed but unreachable, which is a
worse state than absent for coverage purposes: the capabilities are claimed, shipped and
exercised by no one. Recomputing a headline % is deferred until falcone-charts#13 is fixed,
because any number produced now would measure a misconfiguration rather than the platform.

---

**Headline: 76% of the F0 claim set is now verified, up from 41%.** Credentials
closed the auth gap entirely; what remains unverifiable is the ~30% of the surface
owned by `control-plane-executor` / `workflow-worker` / Temporal, which this
environment deliberately does not deploy (chart ships them `false`).

| Area | Tested | Total | Coverage | Notes |
|---|---|---|---|---|
| Identity & tenancy | 6 | 7 | 86% → **PARTIAL** | A1/A5/A6/A7 PASS live; A3 gap confirmed. A4 blocked by #953. **[DOWNGRADED 2026-08-09, triage batch]** Provisioning PASS, but the identity-claim and membership planes FAIL: ~~**#961** (no principal ever receives a `workspace_id` claim)~~ **FIXED `01e966f2`, verifier CONFIRMED-FIXED — tenant realms now declare the attributes and `workspace-context` mints the claim; NOT yet true on staging, which runs the pre-fix image and needs the back-fill plus a per-user re-stamp**, **#975** (invitations write-only, never read), **#979**/**#969** (no Keycloak client is ever materialized), **#960** (plan assignment discarded on the create-tenant path). **Row stays PARTIAL**: the claim plane is repaired, the membership plane (#975 #979 #969) and #960 are not. |
| Flows / durable execution | 1 | 5 | 20% | Only B5 (GAP-FAL-012, code) verifiable. B1-B4 need Temporal + worker — not deployed. |
| Storage, events, realtime, webhooks, scheduling | 5 | 6 | 83% → **PARTIAL** | C3 → #955. C5 → #957. C6 → #952. C4 advertised but `features.realtime:false`. C2 executor-owned. **[DOWNGRADED 2026-08-09, triage batch]** 5 of 6 *exercised*, 1 of 6 *correct*: ~~storage **#994**~~ **storage FIXED `192c8cd0`…`cf4f8a45`, verifier CONFIRMED-FIXED — now 2 of 6 correct**, events **#955**, webhooks **#957**, scheduling **#952** + **#985**. **Row stays PARTIAL**: four of the five defects that downgraded it are untouched. |
| Secrets | 2 | 2 | 100% → **PARTIAL** | D1 backend off by chart config (ENVIRONMENT); D2 gap confirmed. **[DOWNGRADED 2026-08-09, triage batch]** 2 of 2 *surfaces* exercised; **0 of 4 lifecycle properties hold** — see the secrets row above (#970 #977 #984 #974). Coverage of a surface is not coverage of its lifecycle. |
| LLM & embeddings | 5 | 9 | 56% | E1/E2/E3/E9 code-verified; E4-E8 executor-gated. Unchanged from F0-1. |
| Quotas, audit, backup, MCP | 4 | 4 | 100% → **FAIL** | F3 "surface only" was the honest half; the rest should not have read PASS. **[DOWNGRADED 2026-08-09, triage batch]** Surface reachable, behaviour not — quotas **#962 #988 #963 #960 #964** (1 of 18 declared dimensions enforced across both services; overrides and plan assignments discarded); audit **#978 #971 #974 #958**; backup **#985** (`GET /v1/backups/status` — `packages/backup-status` is absent from the image). |
| Absence gaps (G1-G5) | 5 | 5 | 100% | All five absences confirmed by exhaustive grep. |
| **Console personas (P25-P27)** | 2 | 3 | 67% | P25 + P27 PASS in a real browser. **P26 blocked by #953.** |
| **Total** | **30** | **41** | **73%** | 21 PASS · 5 confirmed bugs · 14 blocked/not-deployed · 1 partial |

## What coverage still does NOT include

- **The executor-owned data plane** — flows, functions, object storage, Postgres/
  Mongo data APIs, LLM/embeddings, MCP, realtime SSE. Not a testing gap; the
  components are switched off by chart default. Needs a full-topology environment.
- **P26 (developer building on the BaaS)** — needs a tenant user session, which
  #953 makes impossible. This is now blocked by a *product defect*, not by access.
- **Restore.** Backup *scope catalog* verified; the restore path is still untouched
  (§19 item 10 remains open).
- **Multi-replica and resilience slices.** Not attempted.
- **Load/soak, rate limiting, quota enforcement under pressure.**
  `quota_enforcement_log` is still empty — no quota has ever actually tripped here.

## Next-highest-value slices

1. **#953 blocks the most.** Fixing it unblocks A4, P26, and every genuine
   tenant-user journey. Highest leverage item on the board.
2. A full-topology environment (executor + worker + Temporal) — unblocks ~30% of
   the claim surface that no amount of credentials can reach.
3. Restore test (§19 item 10) and a quota-enforcement slice (drive a dimension to
   its limit and confirm `quota_enforcement_log` records the denial).
4. Re-run the isolation matrix with a *tenant user* principal once #953 lands —
   this run proved it with a service account, which is a narrower principal shape.

---

## F0-1 baseline (2026-08-07, superseded)

41% verifiable / 63% tested. Blocked at the time: all authenticated API testing
and the entire console persona set, because Keycloak admin credential extraction
was refused by the permission classifier. Both are now resolved.

---

# F0-5 — 2026-08-08 — full-topology claim re-verification

Supersedes everything above. Commit `39ca71bb`, chart `in-falcone-0.4.1` helm rev 20.

## Headline

**41 claim rows: PASS 18 · PARTIAL 12 · FAIL 8 · REFUTED 2 · BLOCKED 1.**
Only **1 row** is now blocked for want of environment, against 15 in F0-1 — the full topology
converted almost the entire BLOCKED set into real verdicts.

| Area | Verdict shape | Note |
|---|---|---|
| Identity & tenancy (A1–A9) | 4 PASS · 2 PARTIAL · 2 FAIL · 1 split | Tenant isolation **PASS at the API tier / FAIL at the network tier** **[DOWNGRADED 2026-08-09, triage batch]** — the ~60-probe matrix exercised the **gateway** and never east-west pod traffic; **#972** shows tenant B's function invoking tenant A's over cluster DNS with identity stripped, unmetered and unaudited (critical). Workspace tier **fails** (#973). |
| Flows (B1–B8) | 3 PASS · 3 PARTIAL · 1 FAIL · 1 BLOCKED | Definition plane **PARTIAL** *(was "works")* **[DOWNGRADED 2026-08-09, triage batch]** — it accepts semantically invalid and unbounded input: **#991** (FLW-E004 never wired; dangling sub-flow refs validate `true` and publish), **#988** (29 versions published against a limit of 20, zero 429s), **#976** (tokens forged from a committed constant accepted by the platform's own validator). **Execution plane has never run once** (charts#20 → **#997**). |
| Storage/events/realtime (C1–C10) | 4 PASS · 3 PARTIAL · 2 FAIL · 1 REFUTED | ~~Storage is the strongest capability on the platform.~~ **Sentence stays withdrawn** **[DOWNGRADED 2026-08-09, triage batch]** — ~~the only contract-conformant storage write stores 0 bytes (**#994**)~~ **that half is FIXED (`192c8cd0`…`cf4f8a45`, verifier CONFIRMED-FIXED)**, but object authorization still never reads `workspace_id` (**#973**), so the superlative is not reinstated on a capability whose authorization tier is unimplemented. |
| Secrets & LLM (D1–E9) | 4 PASS · 1 PARTIAL · 1 FAIL · 1 REFUTED · 4 BLOCKED-by-401 | SSRF guard 19/20. Secret *storage* solid **only within one token lease and only until the first purge** **[DOWNGRADED 2026-08-09, triage batch]** (**#984**, **#977**); secret *consumption* broken (**#970**). |
| Quotas/audit/backup/MCP (F1–F10) | 1 PASS · 7 PARTIAL · 2 FAIL | Audit **integrity** inverted (#978). |
| Absences (G1–G5) | 5 PASS | All five re-confirmed under adversarial re-greps. |

## Honest coverage number

**~85% of the F0 claim set is now verified** (35 of 41 rows carry a live or code verdict backed by
printed evidence), up from 76% in F0-2 and 41% in F0-1.

What the remaining ~15% is, precisely:
- **4 rows blocked by falcone-charts#13** (E4/E6 and the LLM/embedding runtime) — the executor
  401-walls them. Note charts#13's root cause was **corrected this run**: adding the Keycloak env is
  necessary but *not sufficient*; #961 (no `workspace_id` claim) is a second blocker
  (**#961 fixed in `01e966f2`** — the other two causes are chart-side and still stand).
  **Corrected again 2026-08-09 (triage batch): there are three mandatory causes, not two** —
  **#981** (executor receives no `KEYCLOAK_ISSUER`/`KEYCLOAK_JWKS_URL`, so `createJwtVerifier`
  returns `undefined`), **#980** (APISIX route `2006` forwards bearer `/v1/mongo/*` to the control
  plane, which owns no such route → `404 NO_ROUTE`) and **#961**. Fixing any two still leaves the
  surface unreachable. **#961 is now fixed (`01e966f2`); #981 and #980 remain, and both live in
  `falcone-charts`, so this surface stays unreachable from this repo.**
- **1 row (B3) blocked by falcone-charts#20** — SSE monitoring needs an execution to exist, and none
  can.
- **Provider-call rows** need an external LLM key that this campaign deliberately does not hold.

## What changed in the picture

1. **The campaign's main sequencing assumption was wrong.** "Fix charts#13 and ~30% of the surface
   unblocks" is wrong *in kind*: #13 and charts#20 are on **different axes**, both mandatory. #13
   unblocks flows *authoring*; it unblocks **zero** executions.
2. **#953 is not the blocker it was treated as.** Tenant users authenticate fine via the per-tenant
   `<slug>-app` client. It is a console-flow defect. Tenant-user journeys and the per-role matrix are
   testable **today** — this run did both for the first time.
3. **Two gap-analysis "Covered foundation" ratings do not survive**: audit infrastructure (#978) and
   pgvector (#983). A third, "Service accounts and OAuth applications", must be **split** (#969).
4. **Security posture is the story of this run.** 1 critical + 8 high findings, concentrated in
   network isolation (function pods, Kafka, Temporal Web, Grafana/Prometheus), audit integrity, and
   secret consumption/lifecycle.

## Still not covered

- **Provider-call paths** — no external LLM credential by design.
- **Restore** (§19 item 10 proper). The backup surface is a **static catalog only**: 21 rows, **0
  tenant-restorable**, `operationalStatus:"unknown"`, and **no table records a single backup,
  snapshot or restore run**. `/v1/backup/{status,snapshots,restore/dry-run}` all 404.
- **Load/soak and quota-under-pressure.** `quota_enforcement_log` fired for the first time (6 rows)
  but only for `max_workspaces`.
- **Multi-replica hazards beyond the basics.** No leader election exists anywhere in the repo; most
  divergence hazards remain untriggerable black-box while the executor serves so little.
- **P26 (developer building on the BaaS)** end-to-end — now unblocked in principle by the `<slug>-app`
  discovery, but not yet walked as a journey.

---

# F0-6 — 2026-08-09 — §19 re-rating + P26

## P26 — no longer uncovered

The campaign's longest-standing coverage gap is closed. COVERAGE.md previously recorded P26 as
"unblocked in principle by the `<slug>-app` discovery, but not yet walked as a journey". It has now
been walked end to end.

| Persona | Verdict | Note |
|---|---|---|
| **P26** developer building on the BaaS | **WALKED — mostly FAIL** | ~1/3 of an app is buildable, and only with a tenant owner doing the setup. Works unaided: Knative function deploy + invoke, storage reads — **[DOWNGRADED 2026-08-09, triage batch]** **that "works unaided" claim now carries #972** (function sandboxes have no NetworkPolicy and the runtime authenticates nothing — critical cross-tenant lateral movement), **#992** (32 of 54 declared function operations 404; no event-driven or scheduled invocation exists by any path, so functions are a synchronous-RPC primitive only) and ~~**#994** (storage *writes*)~~ **— the storage-write leg is FIXED (`192c8cd0`…`cf4f8a45`, verifier CONFIRMED-FIXED), so "storage reads" now honestly extends to storage writes; the row stays downgraded on #972 and #992, which are untouched**. Hard stops: no Postgres DDL route, nothing asynchronous, no BYOK LLM config path, no self-service observability. |

Console personas are therefore **3 of 3 exercised** (P25, P26, P27).

## §19 go/no-go — 8 of 15 re-rated on the full topology

| Criteria | State |
|---|---|
| 1–8 | **Re-rated this run: 8 NO-GO.** Replaces the F0-1 control-plane-only ratings. Criteria 4, 5, 7 move from undeclared to rated; criterion 1 from "not verifiable here" to NO-GO on provenance. |
| 9–15 | **NOT re-rated** — the slice was killed by a session limit. F0-1 ratings stand, control-plane-only caveats intact. |

§19 coverage: **8/15 current, 7/15 stale.** Criterion 10 (deletion + restore) remains the
longest-deferred item in the campaign.

## Honest note on defect yield

**Zero findings were filed this run.** Eleven candidates are at PENDING VERIFIER because all nine
verifier agents died before returning a verdict. That is the maker≠checker rule working as intended,
but coverage should not be read as having advanced on the defect side — only on the claim side
(§19 1–8) and the persona side (P26).

## Still not covered

- **§19 criteria 9–15**, including the restore half of criterion 10.
- **Provider-call paths** — no external LLM credential, by design.
- **Function-secrets surface** (`/v1/functions/workspaces/{ws}/secrets`) — never exercised.
- **Load/soak and quota-under-pressure.**
- **Multi-replica hazards beyond the basics.**

---

# Triage batch — 2026-08-09 — claim refutations from the 62-issue audit board

Source: `docs/track-f/triage.md`. No new testing this entry; this records what the open
issue board refutes about claims already made above. Twelve rows above are edited in place
and marked **[DOWNGRADED 2026-08-09, triage batch]** — search that string to find them all.

## Rows downgraded

| Section | Row | Was | Now | Refuted by |
|---|---|---|---|---|
| F0-R1 | storage | PASS | **PARTIAL** | ~~#994~~ (fixed `192c8cd0`…`cf4f8a45`) #973 #998 |
| F0-R1 | secrets (bonus) | PASS | **PARTIAL** | #970 #977 #984 #974 |
| F0-2 | Identity & tenancy 86% | 86% | **PARTIAL** | ~~#961~~ (fixed `01e966f2`) #975 #979 #969 #960 |
| F0-2 | Storage/events/realtime/webhooks/scheduling 83% | 83% | **PARTIAL** | ~~#994~~ (fixed `192c8cd0`…`cf4f8a45`) #955 #957 #952 #985 |
| F0-2 | Secrets 2/2 100% | 100% | **PARTIAL** | #970 #977 #984 #974 |
| F0-2 | Quotas/audit/backup/MCP 4/4 100% | 100% | **FAIL** | #962 #988 #963 #960 #964 · #978 #971 #974 #958 · #985 |
| F0-5 | Tenant isolation PASS | PASS | **PASS (API) / FAIL (network)** | #972 |
| F0-5 | Flows definition plane "works" | PASS | **PARTIAL** | #991 #988 #976 |
| F0-5 | "Storage is the strongest capability" | — | **withdrawn** | ~~#994~~ (fixed `192c8cd0`…`cf4f8a45`) #973 |
| F0-5 | "Secret storage solid" | — | **qualified** | #984 #977 |
| F0-5 | charts#13 has two causes | 2 | **3 mandatory** | #981 + #980 + ~~#961~~ (fixed `01e966f2`) |
| F0-6 | P26 "works unaided: function deploy + invoke, storage reads" | partial-PASS | **downgraded further** | #972 #992 ~~#994~~ (fixed `192c8cd0`…`cf4f8a45`) |

Also corrected in `CAPABILITIES.md`: the events-consume *"bounded poll by design"* note —
the clamp is real, but the shipped default never returns data (#955).

## Gap-analysis "Covered foundation" ratings that do not survive

Three were already recorded above (audit infrastructure #978, pgvector #983, and
"service accounts and OAuth applications" needing a split #969). Four more:

| Rating | Refuted by |
|---|---|
| C5 "signed + retried webhooks" (gap analysis §6) | **#957** — no obtainable principal can list or create a subscription. Noted at F0-R1 but the *rating* was never downgraded |
| platform idempotency | **#993** — `Idempotency-Key` is published `required: true` with a documented 24 h replay window and `X-Idempotency-Replayed`, and has no implementation anywhere |
| functions as an event-driven primitive | **#992** — 32 of 54 declared operations 404; no trigger, rule, cron or http-exposure handler exists on either service |
| the quota framework | **#962 #988 #963 #960** — 1 of 18 declared dimensions enforced across both services; overrides and plan assignments discarded |

## The structural finding this batch produces

CLAUDE.md rule 1 requires **every** OpenSpec change to carry tenant/workspace
authorization, audit events, quotas and secret redaction. All four subsystems are broken
platform-wide (#973 #961 #972 · #971 #974 #958 #978 · #962 #988 #963 #960 #964 · #970 #977
#984). Those fourteen issues are therefore `prerequisite-of` **all fifteen** planned
changes, not of any one — no change can honestly claim its Definition of Done until they
land. This is the practical content of "W1 · PRD-001 kickoff" in delivery-plan §2.4.

## Coverage number

**Not recomputed.** No capability was exercised this entry, and recomputing a headline %
from a triage would measure the board rather than the platform. The honest statement is
that the F0-5 figure of "~85% of the F0 claim set verified" remains correct as a measure of
*rows carrying a verdict*, and is now materially worse as a measure of *rows passing*: six
of the seven area rows above moved down.
