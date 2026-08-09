# Track F — audit triage

Phase 1 output. 2026-08-09 · commit `39ca71bb` · chart `in-falcone-0.4.1` helm rev 20 ·
`$FALCONE_NS=in-falcone-staging`.

No issue was filed or closed to produce this document. **Phase 1** produced the tables
below with no board mutation. **Phase 2 was approved and executed on 2026-08-09** — labels,
merge-group cross-references and ledger downgrades applied; see §5 for exactly what changed.

## Scope note — read this first

The instruction named `--label falcone-loop`, which returns **29** issues (#937–#965). The
repository currently has **62** open issues. The remaining **33** carry `needs-triage`
(26) or no labels at all (7: #981 #980 #979 #967 #966 #935 #933) — and they are the newer
audit batch: the F0-5/F0-6 findings that `COVERAGE.md` already cites by number
(#966, #967, #969, #973, #978, #983). Phase 2's instruction to *remove `needs-triage`* can
only apply to them, since no `falcone-loop` issue carries that label.

Triaging only the 29 would produce a W0 set with no `#997` (Flow execution plane down),
no `#994` (the only contract-conformant storage write stores 0 bytes), no `#980`/`#981`
(bearer document CRUD unreachable) and no `#998` (E2E has no bucket) — i.e. a W0 set that
omits most of what actually blocks portal M1. So **both batches are triaged below, kept in
separate tables** so the literal filter stays visible and Phase 2 can act on either.

- **Batch A** — `falcone-loop`, 29 issues (14 bugs, 15 OpenSpec enhancements).
- **Batch B** — `needs-triage` / unlabelled, 33 issues (31 bugs, 2 enhancements).

## Column definitions

- **portal-M1 blocker?** — YES if the issue breaks an auth, documents, storage, gateway
  routing, flows, llm or realtime path that portal slices **S1–S12** actually traverse
  (`../llmwiki/docs/portal-getting-started.md:189-201`). A critical *security* defect on a
  path M1 merely *touches* is marked **NO · gate**: it does not stop M1 functioning, but it
  stops the §19 go/no-go and PRD-001 release gate. Both facts matter and collapsing them
  into one YES would hide the difference.
- **Relationship** — against the 15 planned OpenSpec changes (issues #937–#951 /
  delivery-plan §2.3) plus GAP-PRD-001. `prerequisite-of` means the change's Definition of
  Done cannot be met while the defect stands.
- **Order** — global rank, low first. Wave grouping is defined in §3.

---

## 1. Batch A — `falcone-loop` (29)

### 1a. Bugs (14)

| # | Capability | Sev | M1 blocker? | Relationship to planned OpenSpec changes | Duplicate-of / merge | Order |
|---|---|---|---|---|---|---|
| **#960** | `cap:tenant-provisioning` `cap:quotas-plans` | **critical** | NO | prerequisite-of `add-code-wiki-quota-dimensions`, `add-tenant-fair-job-admission-queue`, **`fix-774-tenant-plan-allocation-ux`** (on disk — §3.7) — plan-derived entitlement is the input to all three | shares the "201 with an ID, nothing written" class with **#963**; distinct mechanism (pooled `BEGIN`/`COMMIT` vs in-memory-only branch). Not duplicates — one shared test gap | 23 |
| **#953** | `cap:iam-admin` `cap:access-control` `security` | **critical** | NO — S2 does its own OIDC against Keycloak (`<slug>-app`), per COVERAGE.md:127-128. Blocks the console + platform-brokered signup→login journey | independent (platform auth broker; no planned change owns it) | — | 12 |
| **#961** | `cap:iam-admin` `tenant-isolation` `security` | high | **YES** — no principal ever gets a `workspace_id` claim, so workspace-scoped executor auth (S1 documents/storage/llm) cannot bind | prerequisite-of `integrate-byok-with-workspace-secret-store` (workspace-scoped secret resolution), and of every change whose DoD requires workspace authorization | **root cause of #957** (symptom + its own handler bug — keep both) | 5 |
| **#962** | `cap:quotas-plans` `tenant-isolation` | high | NO | prerequisite-of `add-code-wiki-quota-dimensions` — adding dimensions to a framework that enforces 1 of 13 ships more fail-open surface | **merge with #988** (control-plane half ⟷ executor/flows half of one census; #962's "not deployed" rows *are* #988's scope). Parent: #962 | 25 |
| **#963** | `cap:quotas-plans` | high | NO | prerequisite-of `add-code-wiki-quota-dimensions` — with overrides no-op *and* #960, the catalog default is the only reachable limit and is unchangeable by any supported operator action | see #960 | 24 |
| **#964** | `cap:quotas-plans` `cap:observability` | medium | NO | prerequisite-of `add-code-wiki-quota-dimensions`, **`fix-774-tenant-plan-allocation-ux`** (on disk — §3.7) | symptom-adjacent to #962/#963; independent code fix (two adjacent resolvers disagree) | 27 |
| **#965** | `infra` `deployment` | high | **YES** — executor + workflow-worker cannot start under `runAsNonRoot`; worked around in staging with `runAsUser:1000`, so any clean redeploy re-breaks S1/S6/S9/S10/S12 | prerequisite-of *every* change requiring cluster black-box tests (CLAUDE.md DoD) | independent | **1** |
| **#952** | `cap:scheduling` `cap:gateway` | high | NO — S1–S12 do not call `/v1/scheduling/*` | independent | cause **(f)** in **#985**'s census (the only route it explains). Distinct root cause — keep open, do not fold | 30 |
| **#954** | `cap:iam-admin` `cap:web-console` | medium | NO | independent | **subsumed by #985** (cause (a): `module: NONE`). Also the live trigger for **#956** | 32 |
| **#955** | `cap:events` `cap:web-console` | high | NO — M1 progress rides Flow SSE (S10), not Kafka consume | independent | refutes CAPABILITIES.md:313-316 ("bounded poll by design") — see §4 | 31 |
| **#956** | `cap:web-console` `frontend` | medium | NO | independent | triggered by #954 but generic; fix separately as the issue argues | 33 |
| **#957** | `cap:webhooks` `tenant-isolation` | high | NO | **prerequisite-of `fix-audit-c25-webhook-signing-key-lifecycle`** (on disk — §3.7): no principal can create a subscription, so its acceptance evidence cannot be produced | **caused by #961** for the SA-404 half; the superadmin-500 half (`identity.tenantId` vs `ws.tenant_id`) is its own fix | 34 |
| **#958** | `cap:access-control` `cap:audit` `security` | medium | NO · gate | prerequisite-of **all 15** — CLAUDE.md rule 1 requires audit events in every change | **merge-family with #971, #974** (three mechanisms, one requirement: "every authorization decision and mutation is recorded"). Parent: #971 | 22 |
| **#959** | `cap:openapi-sdk` `cap:iam-admin` | medium | NO — but any S12 service-account handoff gets an unreachable endpoint | prerequisite-of contract handover (CLAUDE.md rule 6) — the field is `required` in the published contract | independent | 35 |

### 1b. OpenSpec enhancements (15) — the planned changes themselves

These are not defects; they are the wave backlog. Order follows delivery-plan §2.4, with
prerequisite bugs pulled ahead of each.

| # | Change | Gap | Plan wave | M1 blocker? | Blocked by (from this triage) | Order |
|---|---|---|---|---|---|---|
| **#937** | `add-multi-provider-connection-registry` | FAL-001 | W1 | NO — S3 reads the *current single* provider; full FR-PROV waits behind `ff_models_settings` | #981 (executor auth), #961 | 28 |
| **#951** | `encrypt-sensitive-flow-payloads` | FAL-012 | W1 (P0-A) | NO · gate (§19 item 3) | **#976** — encrypting history is inert while the signing key is a committed public constant | 29 |
| **#949** | `add-code-wiki-quota-dimensions` | FAL-010 | W1 spec (needs D4) | NO | #962 #963 #964 #988 #960 | 30 |
| **#938** | `integrate-byok-with-workspace-secret-store` | FAL-002/AI-002 | W2 | NO for M1; blocks M5 | **#970 #977 #984** — self-service credentials on a store that inlines plaintext, survives purge and drops its session | 36 |
| **#940** | `add-compatible-provider-adapter-contract` | FAL-004 | W2 | NO | #937 | 37 |
| **#947** | `add-tenant-fair-job-admission-queue` | FAL-008 | W2 | NO (M2 shows "queued" without rank) | #949, #988 | 38 |
| **#948** | `define-large-task-worker-security-profile` | FAL-009 | W2 (P0-C, M3) | NO · gate (§19 item 4) | **#972** — a worker profile is meaningless while no NetworkPolicy selects function pods | 39 |
| **#941** | `add-native-openai-provider-adapter` | FAL-004 | W3 | NO | #940 | 40 |
| **#942** | `add-native-anthropic-provider-adapter` | FAL-004 | W3 | NO | #940 | 41 |
| **#944** | `add-model-capability-catalog` | FAL-005 | W3 | NO | #940 | 42 |
| **#945** | `add-llm-provider-batch-execution` | FAL-006 | W4 (needs D5) | NO | #938 #944 #941 #942 | 43 |
| **#946** | `add-ai-usage-cost-ledger` | FAL-007 | W4 | NO | #938 #945 | 44 |
| **#939** | `add-provider-credential-broker` | FAL-003 | W5 (P1) | NO | #938 | 45 |
| **#950** | `complete-social-idp-management-console` | FAL-011 | W5 (P1) | NO — S2 social login is realm config, not console UX | independent | 46 |
| **#943** | `add-native-gemini-provider-adapter` | FAL-004 | W5 (P1) | NO | #940 | 47 |

---

## 2. Batch B — `needs-triage` / unlabelled (33)

### 2a. Bugs (31)

| # | Capability (proposed `cap:*`) | Sev | M1 blocker? | Relationship to planned OpenSpec changes | Duplicate-of / merge | Order |
|---|---|---|---|---|---|---|
| **#997** | `cap:workflows` `e2e` `deployment` | **critical** | **YES** — `POST …/executions` → 503 `TEMPORAL_UNAVAILABLE`; kills S6, S7, S9, S10, S12 outright | prerequisite-of `encrypt-sensitive-flow-payloads`, `add-tenant-fair-job-admission-queue` — neither can be black-box tested while zero executions can run | chart-side root cause `falcone-charts#20` (NetworkPolicy admits `flows-api`/`flows-worker`, not `control-plane-executor`). Not a duplicate of #989 (that is *recovery*, this is *reachability*) | **2** |
| **#972** | `tenant-isolation` `security` (+`cap:functions`) | **critical** | NO · **gate** — tenant B's function read tenant A's function output over cluster DNS, unmetered, unaudited, identity stripped | prerequisite-of `define-large-task-worker-security-profile`; hard blocker for GAP-PRD-001 / §19 | independent (network tier). Refutes the F0-5 "tenant isolation PASS" row — see §4 | 13 |
| **#994** | `cap:storage` | high | **YES** — the schema-mandated `contentBase64` write stores **0 bytes** and returns 201; GET→PUT corrupts. Blocks S10 (wiki storage) and the S1 typed client | prerequisite-of contract handover (rule 6) — the shipped OpenAPI is `additionalProperties:false` and forbids the only fields that work | **merge with #966** — one object-body envelope; #966 is the read half (lossy `content`), #994 the write half (ignores `contentBase64`), and the GET→PUT corruption is the two combined. Parent: **#994** | **6** |
| **#966** | `cap:storage` | (unset → high) | **YES** | as #994 | **merge into #994** | 7 |
| **#981** | `cap:token-validation` (unset) | (unset → high) | **YES** — executor has no `KEYCLOAK_ISSUER`/`KEYCLOAK_JWKS_URL`, so `createJwtVerifier` returns `undefined` and every bearer call to executor-owned APIs is 401 | prerequisite-of `add-multi-provider-connection-registry` and every executor-owned change | **pair with #980** — together they are the falcone-side successors to `falcone-charts#13`; both must land for bearer document CRUD. Parent: **#980** | **3** |
| **#980** | `cap:gateway` `cap:document-store` (unset) | (unset → high) | **YES** — APISIX route `2006` sends bearer `/v1/mongo/*` to the control plane, which has no such route → 404 `NO_ROUTE`. Blocked llmwiki AUTH-025 first-login profile persistence | prerequisite-of every documents-dependent change; blocks S1/S4 | see #981 | **4** |
| **#998** | `cap:storage` `cap:tenant-provisioning` `e2e` | medium | **YES** — the shared E2E workspace has no bucket and no documented fixture contract; blocks S12 (the M1 gate) and S10 | prerequisite-of the "black-box tests green in $FALCONE_NS" DoD clause | independent (fixture/provisioning contract, not a code defect) | **8** |
| **#979** | `cap:iam-admin` (unset) | (unset → high) | **YES** — `POST /v1/workspaces/{ws}/iam/clients` → 404; S2's authorization-code + PKCE BFF client had to be provisioned operator-side in Keycloak | prerequisite-of `complete-social-idp-management-console` | **merge with #969** — one missing capability (nothing in the platform ever creates a Keycloak client); #979 is the absent route, #969 the false-success read model on the other door into it. Parent: **#979**. Also cause (a) in **#985** | **9** |
| **#969** | `cap:iam-admin` | high | **YES** (partial — same capability as #979) | as #979 | **merge with #979** | 10 |
| **#993** | `cap:gateway` | medium | **YES** — `Idempotency-Key` is `required:true` in the published contract with a 24 h replay promise and zero implementation; the S1 typed client's retry policy silently duplicates | prerequisite-of contract handover (rule 6) and of the "failure and idempotency semantics" clause in **all 15** changes | independent | **11** |
| **#973** | `cap:access-control` `tenant-isolation` `security` | high | NO · **gate** — violates the published `AUTHZ-XWS-002`; no `workspace_members` table exists | prerequisite-of **all 15** — CLAUDE.md rule 1 requires tenant/**workspace** authorization in every change | independent (already cited in COVERAGE.md:100) | 14 |
| **#976** | `cap:workflows` `security` | high | NO · gate | **prerequisite-of `encrypt-sensitive-flow-payloads`** — a forged token minted from the committed constant was accepted by the platform's own validator | independent | 15 |
| **#970** | `cap:secrets` `security` | high | NO · gate | prerequisite-of `integrate-byok-with-workspace-secret-store` | **merge-family with #977, #987** — one contract: "purge removes credential material and derived rows, or discloses them in `residual`". Three mechanisms (Knative inline / OpenBao KV / DB cascade). Parent: **#977** | 16 |
| **#977** | `cap:secrets` `cap:tenant-lifecycle` `security` | high | NO · gate | prerequisite-of `integrate-byok-with-workspace-secret-store` | parent of the purge-completeness family (#970, #987) | 17 |
| **#984** | `cap:secrets` | high | NO | prerequisite-of `integrate-byok-with-workspace-secret-store` (request-time resolution on a session that lapses to 502 after ≤24 h) and, weakly, `harden-workspace-secrets-console-ux` (on disk — §3.7) | independent (chart-side trigger `falcone-charts#14`) | 18 |
| **#978** | `cap:audit` `security` | high | NO · gate | prerequisite-of **all 15**; §19 / PRD-001 | **do not merge** with #971/#974/#958 — those are *coverage*, this is *integrity* (honest logs report invalid, truncated logs report valid). Already cited COVERAGE.md:130 | 19 |
| **#971** | `cap:audit` | medium | NO · gate | prerequisite-of **all 15** | **parent** of the audit-coverage family (#974, #958) | 20 |
| **#974** | `cap:audit` `security` | high | NO · gate | prerequisite-of **all 15** | merge-family with #971 (parent), #958 | 21 |
| **#988** | `cap:quotas-plans` `cap:workflows` | high | NO | prerequisite-of `add-code-wiki-quota-dimensions`, `add-tenant-fair-job-admission-queue` | **merge with #962** (parent #962) — the evaluator endpoint the gate calls was never built, so no chart value can fix it | 26 |
| **#985** | `cap:gateway` | medium | **YES** (partial, via #979) — 18 of 124 declared routes unreachable; 12 have complete shipped handlers never added to the runtime table | prerequisite-of contract handover (rule 6) — the CI catalog↔runtime check it proposes prevents the whole class recurring | **umbrella** for #954, #979 (cause a), #952 (cause f). #992 is the same class for the function family; #967 and #975 are absences of the same kind | 32 |
| **#992** | `cap:functions` (unset) | high | NO — S7 drives the acquisition worker from a Flow activity, not a function trigger | prerequisite-of `define-large-task-worker-security-profile` if that profile is expressed as a triggered function | same class as **#985**, own family (32 of 54 function operations; no trigger/rule/cron/http-exposure handler exists anywhere) | 33 |
| **#982** | `cap:observability` (unset) | high | NO — but remotely injectable **without any credential**, 82.3% of the TSDB today, with object keys / secret names / tenant DB names verbatim in metrics | prerequisite-of GAP-PRD-001 | independent. Same subsystem as #986, different root cause — not duplicates | 34 |
| **#983** | `cap:database` (unset) | high | NO for M1; blocks **M6** (chat/hybrid vector search) | prerequisite-of nothing planned — but it **refutes a gap-analysis "Covered foundation"** (already COVERAGE.md:130) | independent | 35 |
| **#987** | `cap:tenant-lifecycle` | low | NO · gate | prerequisite-of GAP-PRD-001 (deletion/purge graph, §19 item 10) | merge-family with #977 (parent), #970 | 36 |
| **#967** | `cap:database` (unset) | (unset → medium) | NO | prerequisite-of GAP-PRD-001 (§19 item 10) | absence of the same kind as **#985**; create-without-delete against two metered dimensions | 37 |
| **#975** | `cap:iam-admin` | high | NO — S2/S8 org invitations are portal-side (M8) | **prerequisite-of `add-759-console-members-invite-wizard`** (on disk — §3.7): that change mounts a wizard submitting to this write-only stub | absence of the same kind as **#985**, explicitly *not* the #952 class (issue makes the distinction correctly) | 38 |
| **#986** | `cap:gateway` `cap:observability` | medium | NO | prerequisite-of GAP-PRD-001 | supersedes/reopens **#606** — that fix could not have worked in any environment (`enable_export_server` gate) | 39 |
| **#995** | `cap:document-store` (unset) | medium | NO — S1/S4 write documents individually, not via bulk import | prerequisite-of GAP-PRD-001 (backup/restore round trip cannot preserve identity) | shares the idempotency half with **#993** | 40 |
| **#989** | `cap:workflows` | medium | NO — S6 starts flows directly, no schedules in M1 | independent | adjacent to **#997** (that is reachability; this is non-recovery + a 500-vs-503 taxonomy split). Not duplicates | 41 |
| **#991** | `cap:workflows` | medium | NO | independent | refutes the F0-5 "definition plane works" row — see §4 | 42 |
| **#990** | `cap:openapi-sdk` | low | NO — but `*ReasonPublic` fields reach end users and the portal consumes these contracts | prerequisite-of contract handover (rule 6) | independent | 43 |

### 2b. Enhancements (2)

| # | Title | M1 blocker? | Relationship | Order |
|---|---|---|---|---|
| **#933** | Managed Knative runtime modes for Functions and hosted MCP | NO | independent — implements `add-managed-knative-serving` (already on disk); pairs with `falcone-charts#8` | 44 |
| **#935** | Selectable execution backend (Knative or Fission) | NO | independent — air-gapped OpenShift track, orthogonal to the FAL waves | 45 |

---

## 3. Summary

### 3.1 Counts by severity (62 open)

| Severity | Batch A | Batch B | Total |
|---|---:|---:|---:|
| critical | 2 (#960 #953) | 2 (#997 #972) | **4** |
| high | 8 | 13 | **21** |
| medium | 4 | 9 | **13** |
| low | 0 | 2 | **2** |
| *no severity label* (all bugs) | 0 | 5 (#981 #980 #979 #967 #966) | **5** |
| enhancement (priority instead) | 15 (13×P0, 2×P1… see 1b) | 2 (#933 P2, #935 none) | **17** |

45 bugs · 17 enhancements. Five bugs carry no severity label at all and four of them are
W0 — that is the single most misleading thing about the current board.

### 3.2 Counts by capability

| `cap:*` | n | Issues |
|---|---:|---|
| `cap:quotas-plans` | 7 | #988 #964 #963 #962 #960 #949 #947 |
| `cap:iam-admin` | 7 | #975 #969 #961 #959 #954 #953 #950 |
| `cap:workflows` | 6 | #997 #991 #989 #988 #976 #951 |
| `cap:secrets` | 5 | #984 #977 #970 #939 #938 |
| `cap:audit` | 4 | #978 #974 #971 #958 |
| `cap:gateway` | 4 | #993 #986 #985 #952 |
| `cap:access-control` | 3 | #973 #958 #953 |
| `cap:web-console` | 3 | #956 #955 #954 |
| `cap:storage` | 2 | #998 #994 |
| `cap:tenant-lifecycle` | 2 | #987 #977 |
| `cap:tenant-provisioning` | 2 | #998 #960 |
| `cap:openapi-sdk` | 2 | #990 #959 |
| `cap:events` · `cap:webhooks` · `cap:scheduling` · `cap:observability` · `cap:billing` · `cap:mcp` · `cap:functions` | 1 each | #955 · #957 · #952 · #964 · #946 · #933 · #933 |
| **cross-cutting** `tenant-isolation` | 5 | #973 #972 #962 #961 #957 |
| **cross-cutting** `security` | 12 | #978 #977 #976 #974 #973 #972 #970 #961 #958 #953 #951 #948 |
| **no `cap:*` at all** | 10 bugs | #995 #992 #983 #982 #981 #980 #979 #967 #966 #965 + 9 enhancements (#937 #940–#945 #948 #935) |

Capability labelling is the weakest part of the board: 11 bugs and the entire LLM
enhancement family carry no `cap:*`, and there is **no `cap:llm` label defined** at all
(`gh label list` has 25 `cap:*` labels; none covers LLM/providers/embeddings). Phase 2
should create `cap:llm` before labelling #937–#946.

### 3.3 The W0 blocking set — 12 issues

W0 is defined here as: *nothing downstream is testable or consumable until these land.*
Every one either breaks a path S1–S12 traverse, or makes the shared cluster unable to host
a black-box test at all.

| Order | # | Sev | One line | Unblocks |
|---:|---|---|---|---|
| 1 | **#965** | high | executor + worker images use non-numeric `USER node`; cannot start under `runAsNonRoot` | every redeploy; currently masked by a hand-set `runAsUser:1000` |
| 2 | **#997** | crit | Flow execution 503 `TEMPORAL_UNAVAILABLE` — NetworkPolicy admits `flows-api`/`flows-worker`, not `control-plane-executor` | S6 S7 S9 S10 S12; every flows change's black-box tests |
| 3 | **#981** | (unset) | executor has no `KEYCLOAK_ISSUER`/`KEYCLOAK_JWKS_URL` → verifier `undefined` → 401 on all executor APIs | S1 S3 S9 |
| 4 | **#980** | (unset) | APISIX `2006` routes bearer `/v1/mongo/*` to the control plane → 404 `NO_ROUTE` | S1 documents, S4, AUTH-025 |
| 5 | **#961** | high | no principal ever receives a `workspace_id` claim (realm user-profile + mapper-less client scopes) | workspace-scoped executor auth; #957 |
| 6 | **#994** | high | contract-mandated `contentBase64` write stores 0 bytes and returns 201; GET→PUT corrupts | S10 wiki storage, S1 client |
| 7 | **#966** | (unset) | read envelope's `content` is a lossy UTF-8 conversion (43 % U+FFFD on binary) | merge with #994 |
| 8 | **#998** | med | shared E2E workspace has no bucket and no documented fixture contract | S12 — the M1 gate itself |
| 9 | **#979** | (unset) | `POST /v1/workspaces/{ws}/iam/clients` → 404; console wizard submits to it | S2 without an operator-side workaround |
| 10 | **#969** | high | OAuth application reports `state:"active"` naming an IAM client nothing ever creates | same capability as #979 |
| 11 | **#993** | med | `Idempotency-Key` published `required:true` with a 24 h replay promise, zero implementation | S1 typed-client retry semantics |
| 12 | **#953** | crit | signup creates in the tenant realm, login authenticates against the platform realm | console + platform-brokered signup→login (not S2 itself) |

**Sequencing note.** #965 must precede #997: fixing the NetworkPolicy is pointless while
the executor pod cannot start from a clean image. #981 and #980 must land together — either
alone still yields an unauthenticated or unrouted request. #994 and #966 are one fix.

### 3.4 The structural finding

CLAUDE.md rule 1 requires **every** OpenSpec change to carry tenant/workspace
authorization, audit events, quotas and secret redaction. All four of those subsystems are
currently broken platform-wide:

| Subsystem | State | Issues |
|---|---|---|
| workspace authorization | never implemented; no `workspace_members` table; blanket tenant access | #973 (+#961, #972 at the network tier) |
| audit | 65 of 93 mutating routes unaudited; most denials unrecorded; superadmin secret mutations unattributable; **and the integrity chain resets while its verifier is inverted** | #971 #974 #958 #978 |
| quotas | 1 of 13 control-plane dimensions enforced; 0 of 5 flow dimensions; overrides never written; plan assignment discarded | #962 #988 #963 #960 #964 |
| secret lifecycle | resolved plaintext inlined into 5 Knative object kinds; survives deletion and purge; backend session never renewed | #970 #977 #984 |

So these 14 issues are `prerequisite-of` **all fifteen** planned changes, not of any one of
them. They are the real content of "W1 · PRD-001 kickoff" in delivery-plan §2.4, and no
change can honestly claim its Definition of Done until they land. This is the largest
single conclusion of the triage.

### 3.5 Proposed wave assignment

| Wave | Content | n |
|---|---|---:|
| **w0** | §3.3 substrate set | 12 |
| **w1** | DoD substrate (#972 #973 #976 #970 #977 #984 #978 #971 #974 #958 #960 #963 #962 #988 #964) + W1 changes (#937 #951 #949) + cheap high-yield fixes (#952 #954 #955 #956 #959 #985) | 24 |
| **w2** | #938 #940 #947 #948 + #957 #967 #975 #983 #986 #987 #989 #992 #995 #982 | 14 |
| **w3** | #941 #942 #944 + #990 #991 | 5 |
| **w4** | #945 #946 | 2 |
| **w5** | #939 #943 #950 + #933 #935 | 5 |

### 3.6 Merge candidates (Phase 2 cross-reference comments)

| Group | Parent | Members | Shared root cause |
|---|---|---|---|
| Storage object envelope | **#994** | #966 | one read/write body contract; the GET→PUT corruption is the two halves combined |
| Executor reachability | **#980** | #981 | falcone-side successors to `falcone-charts#13`; neither alone restores bearer CRUD |
| Keycloak client materialization | **#979** | #969 | nothing in the platform ever creates a Keycloak client |
| Declared-but-unserved routes | **#985** | #954, #979 (cause a), #952 (cause f), and by class #992 #967 #975 | catalog↔runtime table drift; one CI guard closes the class |
| Audit coverage | **#971** | #974, #958 | three mechanisms, one requirement — mutations and denials are recorded with resolved scope |
| Purge completeness | **#977** | #970, #987 | purge removes credential material and derived rows, or discloses them in `residual` |
| Quota enforcement fail-open | **#962** | #988 | complementary halves of one dimension census |
| Quota write discarded | *(none — keep separate)* | #960, #963 | different mechanisms, one test gap: no test exercises the real Postgres path |

### 3.7 Relationships to OpenSpec changes *already on disk*

Found while validating `subsumed-by` against `openspec/changes/` rather than assuming.
Only two issues are genuinely **subsumed** by an existing change; the rest of the contact
points are blocking relationships that were not previously recorded anywhere.

| Existing change | Issue | Relationship |
|---|---|---|
| `add-multi-provider-connection-registry` | **#937** | **subsumed-by** — the change exists and cites #937's reproduction |
| `add-managed-knative-serving` | **#933** | **subsumed-by** — the issue names the change as its parent |
| `add-759-console-members-invite-wizard` | **#975** | **prerequisite-of** — add-759 mounts `InviteUserWizard` on `/console/members`; that wizard submits to `POST /v1/tenants/{tenantId}/invitations`, which is the write-only stub. Landing add-759 first ships a console action that reports success and does nothing |
| `fix-audit-c25-webhook-signing-key-lifecycle` | **#957** | **prerequisite-of** — the change governs per-subscription webhook signing-key lifecycle, and no obtainable principal can create a subscription, so its acceptance evidence cannot be produced end to end |
| `fix-774-tenant-plan-allocation-ux` | **#960**, **#964** | **prerequisite-of** — the change keeps the wire contract unchanged and renders tenant plan/allocation pages. Every tenant on this deployment is planless (#960) and `effective-limits` denies the defaults it is actually enforcing (#964), so the corrected pages render an honest view of wrong data |
| `harden-workspace-secrets-console-ux` | **#984** | **prerequisite-of** (weak) — the change explicitly does not touch the secrets API; the page still 502s once the un-renewed OpenBao token lapses |
| `add-763-superadmin-iam-access-management` | #954, #979, #956 | **independent** — add-763 covers `ConsoleIamAccessPage` (realm users/roles/groups). #954/#956 are `ConsoleAuthPage`; #979 is workspace IAM clients. Different pages and different routes; do not assume add-763 closes them |
| `add-769-plan-limits-editor` | #963 | **independent** — add-769 edits *plan* limits; #963 is *tenant quota overrides*, a different table and route |

Explicitly **not** merges: #978 with the audit-coverage family (integrity ≠ coverage); #982
with #986 (same subsystem, unrelated causes); #989 with #997 (recovery ≠ reachability); #975
with #952 (absent from the table ≠ mis-compiled in the table — the issue argues this
correctly and folding them would lose the distinction).

---

## 4. `COVERAGE.md` claims this batch refutes

Proposed downgrades. Nothing has been edited yet.

| COVERAGE.md row | Current claim | Refuted by | Proposed |
|---|---|---|---|
| F0-R1 `storage` (:16) — "2048-byte object round-tripped **sha256-exact** … Caveat: the `content` field corrupts binary — filed as #966; **`contentBase64` is correct**" | **PASS** | **#994** — `contentBase64` is the schema-*mandated* write field and the handler ignores it (201, `sizeBytes:0`, MD5 of the empty string). #973 — `denyUnlessBucketOwner` never reads `workspace_id`. #998 — no bucket on the shared E2E workspace | **PARTIAL** — read round-trip PASS via `contentBase64`; the only contract-conformant **write** stores nothing. The phrase "`contentBase64` is correct" is directly false and must be struck |
| F0-R1 `secrets (bonus)` (:19) — "full round-trip with write-only semantics preserved (no plaintext in reads)" | **PASS** | **#970** (resolved plaintext inlined into 5 Knative object kinds, 0 K8s Secrets), **#977** (survives purge in OpenBao, plaintext intact, unrevocable), **#984** (token never renewed → 502 after ≤24 h), **#974** (superadmin mutations unaudited) | **PARTIAL** — the API-tier write-only guarantee holds; **consumption, erasure, session and attribution all FAIL** |
| F0-2 area table `Secrets 2/2 100%` (:47) | **100%** | as above | **PARTIAL** — 2 of 2 surfaces exercised; 0 of 4 lifecycle properties hold |
| F0-2 area table `Quotas, audit, backup, MCP 4/4 100%` (:49) — "F1/F2/F3 PASS live" | **100%** | quotas **#962 #963 #964 #988 #960**; audit **#978 #971 #974 #958**; backup **#985** (`GET /v1/backups/status` — `packages/backup-status` is absent from the image) | **FAIL** — surface reachable, behaviour not. "F3 surface only" was the honest half; the rest should not have read PASS |
| F0-2 area table `Storage, events, realtime, webhooks, scheduling 5/6 83%` (:46) | **83%** | **#994** storage · **#955** events · **#957** webhooks · **#952 + #985** scheduling | **PARTIAL** — 5 of 6 exercised, 1 of 6 correct |
| F0-2 area table `Identity & tenancy 6/7 86%` (:44) | **86%** | **#961** (no `workspace_id` claim for any principal), **#975** (invitations write-only, never read), **#979/#969** (no IAM client ever materialized), **#960** (plan assignment discarded on the create-tenant path) | **PARTIAL** — provisioning PASS; identity-claim and membership planes FAIL |
| F0-5 (:100) — "Tenant isolation **PASS** under a ~60-probe adversarial matrix" | **PASS** | **#972** — tenant B's function invoked tenant A's over cluster DNS with identity stripped, unmetered and unaudited. The 60-probe matrix tested the **gateway**; it never tested east-west pod traffic | **PASS (API tier) / FAIL (network tier)** — split the row. The existing "Workspace tier fails (#973)" note stays |
| F0-5 (:102) — "**Storage is the strongest capability on the platform**" | superlative | **#994**, **#973** | **withdraw the sentence** |
| F0-5 (:103) — "Secret **storage solid**, secret consumption broken" | half-PASS | **#984** (solid only while the cached token lives), **#977** (and only until a purge) | qualify: storage solid **within one token lease and until the first purge** |
| F0-5 (:101) — "Flows: **definition plane works**; execution plane has never run once" | definition PASS | **#991** (FLW-E004 never wired — dangling sub-flow refs validate `true` and publish), **#988** (29 versions published against a limit of 20, zero 429s), **#976** (execution tokens forged from a committed constant were accepted) | **PARTIAL** — the definition plane accepts semantically invalid and unbounded input |
| F0-5 (:114-115) — "4 rows blocked by falcone-charts#13 … #961 is the actual blocker" | 2 causes | **#980** — a third, independent cause: APISIX sends bearer `/v1/mongo/*` to the wrong upstream. #981 is the falcone-side record of the env half | three causes, all mandatory: **#981 + #980 + #961** |
| F0-6 (:159) — P26 "works unaided: **Knative function deploy + invoke**, storage reads" | partial-PASS | **#972** (function sandboxes not network-isolated, runtime authenticates nothing), **#992** (32 of 54 function ops unimplemented — no event-driven or scheduled invocation exists by any path), **#994** (storage writes) | downgrade further — "works unaided" now carries a critical isolation defect and a synchronous-RPC-only ceiling |
| CAPABILITIES.md (:313-316) — events consume "clamped to a bounded batch **by design**, so a console poll cannot create an unbounded consume loop" | design-correct | **#955** — the bound is real but inert: the default `timeoutMs` (3000) exactly ties Kafka's `group.initial.rebalance.delay.ms`, so the shipped console button returns `[]` deterministically | keep the "by design" reading, add: **the shipped default never returns data** |

### Gap-analysis "Covered foundation" ratings

COVERAGE.md:129-131 already records three that do not survive — audit infrastructure
(#978), pgvector (#983), and "service accounts and OAuth applications" needing a split
(#969). This batch adds four more:

| Rating | Refuted by |
|---|---|
| "signed + retried webhooks" (C5, gap analysis §6) | **#957** — no obtainable principal can list or create a subscription; already noted at COVERAGE.md:18, but the *rating* has not been downgraded |
| platform idempotency | **#993** — published `required:true` with a 24 h replay promise and no implementation anywhere |
| functions as an event-driven primitive | **#992** — 32 of 54 declared operations 404; no trigger, rule, cron or http-exposure handler exists on either service |
| the quota framework | **#962 #988 #963 #960** — 1 of 18 declared dimensions enforced across both services; overrides and plan assignments discarded |

---

## 5. Phase 2 — applied 2026-08-09

**Labels created (10):** `portal-blocker` · `wave:w0`–`wave:w5` · `cap:llm` ·
`subsumed-by:add-multi-provider-connection-registry` ·
`subsumed-by:add-managed-knative-serving`.

**Applied:**

1. `portal-blocker` + `wave:w0` on the 12 W0 issues (§3.3).
2. `wave:w0`–`wave:w5` across all 62 open issues — verified **exactly one wave label each**
   (12 / 24 / 14 / 5 / 2 / 5).
3. `cap:llm` created and applied to #937–#946 and #983. `cap:*` backfilled on the 10 bugs
   that carried none: #995 `document-store` · #992 `functions` · #983 `database`+`llm` ·
   #982 `observability` · #981 `token-validation` · #980 `gateway`+`document-store` ·
   #979 `iam-admin` · #967 `database` · #966 `storage`. #972 (which carried only
   `tenant-isolation`/`security`) got `functions`; #935 got `functions`+`mcp`.
   **#965 deliberately keeps only `infra`/`deployment`** — it is a build/packaging defect,
   not a product capability, so no `cap:*` applies. It is the one bug on the board with no
   capability label by intent rather than by omission.
4. `severity:high` on #981 #980 #979 #966; `severity:medium` on #967. Those five plus #967
   also carried no `bug` label — added.
5. `subsumed-by:` applied to **two** issues only — #937 and #933. Validated against
   `openspec/changes/` rather than assumed; the other contact points are blocking
   relationships, recorded in §3.7.
6. `needs-triage` removed from all 26 issues that carried it; 0 remain open.
7. Cross-reference comments posted on **22 issues** across the 8 merge groups of §3.6,
   each naming the parent, the shared root cause, and — where applicable — why the issues
   are deliberately *not* merged.
8. Ledger updated: 12 rows downgraded in place in `falcone-loop-state/COVERAGE.md` (each
   marked `[DOWNGRADED 2026-08-09, triage batch]`), a triage section appended there, and
   the events-consume note corrected in `falcone-loop-state/CAPABILITIES.md`.

**Not done, deliberately:** nothing was closed. The merge groups are recorded as
cross-references, not as `duplicate` closures — every member carries evidence its parent
does not, and closing them would lose it. Closure is a fix-time decision, not a triage-time
one.
