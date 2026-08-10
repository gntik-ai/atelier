# Track F — remediation order (both repos)

Authoritative solve order for the open defects in `gntik-ai/falcone` **and**
`gntik-ai/falcone-charts`, reviewed 2026-08-10 against the live boards.

**When a session asks "which issue next?", read this file first**, then confirm the issue is still
open and not superseded. This supersedes `triage.md` §3.3–§3.5 for *ordering* purposes; triage.md
remains the reference for per-issue relationships, duplicate/merge groups and wave labels.

Board at review time: **91 open** — 78 falcone (17 of them OpenSpec enhancements), 13 charts.

## Why this exists — triage.md cannot be worked top-down

`triage.md` ranked 62 falcone issues and **zero charts issues**. Five of its twelve W0 blockers have
their fix in the charts repo, so working the falcone board in its own order stalls immediately. Three
consecutive fix runs each had to skip #997, #981 and #980 for exactly this reason and pick something
lower down.

The pairs are the same defect from two sides:

| charts issue | falcone issue | Same defect |
|---|---|---|
| `charts#13` | #981 | executor has no `KEYCLOAK_ISSUER`/`JWKS_URL` |
| `charts#20` | #997 | Temporal NetworkPolicy admits a label no pod carries |
| `charts#22` | #980, #985, #1012 | no working APISIX route table under chart defaults |
| `charts#16` | #972, #1007 | Kafka PLAINTEXT, no ACLs, no policy |

## Four findings that set the order

1. **The charts repo is the critical path.** Fixing the falcone side of any pair above alone changes
   nothing observable.
2. **Three NetworkPolicy selectors name labels no pod carries.** `charts#20` allow-lists `flows-api`;
   and the obvious fix for #972 — a `podSelector` on `in-falcone.function=true` — selects **zero
   pods**, because that label is on the Knative Service, not the pod template (verified live:
   `kubectl get pods -l in-falcone.function=true` returned nothing while a function was running). Both
   fixes can be applied cleanly, report success, leave the hole open, and satisfy any later audit that
   greps for a policy.
3. **`runAsNonRoot` without a numeric `runAsUser` has wedged three components** — `charts#12`
   (FerretDB), APISIX on 2026-08-10, and the vendor half of the **closed** #965. Each stayed invisible
   because the previous ReplicaSet kept serving, so the deployment read healthy while being one
   eviction from an outage.
4. **Config can disappear silently.** Three failed `helm upgrade` attempts on 2026-08-09 stripped 10 of
   56 control-plane env vars — including all four `REALM_BRUTE_FORCE_*`, so brute-force protection was
   off for six hours, and `ROUTE_MAP_FILE`, so 45 declared routes answered 404. No error, no failed
   probe, no alert; the signal was a *missing* log line. #981 asks for fail-closed narrowly; it
   generalises.

## Tier 0 — make the environment reproducible

*charts repo · operator work · blocks all verification.* Every verdict on the falcone board is
provisional until staging can be rebuilt from the chart.

| Issue | What it is | Unblocks |
|---|---|---|
| `charts#27` | Chart pins control-plane `0.3.1` while the namespace runs newer; 6 repairs are out-of-band and the next upgrade reverts them | every fix's durability |
| `charts#11` | A failed upgrade leaves control-plane scaled to 0 with no recovery path | safe upgrades at all |
| `charts#12` | `runAsNonRoot` with no numeric `runAsUser` — FerretDB and APISIX both wedged | closes #965's vendor half |
| `charts#22` | No working APISIX route table under chart defaults; staging works only via a hand-applied ConfigMap | #980 #985 #1012 |
| `charts#13` | Executor env lacks `KEYCLOAK_JWKS_URL`/`ISSUER` | #981 → S1 S3 S9 |
| `charts#20` | Temporal policy allow-lists a label no pod carries; zero workflows have ever run | #997 → S6 S7 S9 S10 S12 |
| `charts#14` | `openbao-init` freezes an ephemeral SA token as `token_reviewer_jwt` | all secrets-lifecycle work |

## Tier 1 — live security exposure

*Exploitable on the running deployment; gates PRD-001 / §19.*

- **#972 + #1007 + `charts#16`** — one composite in three parts, **no single part closes it**: no policy
  selects function pods · unrestricted `require` gives tenant code `child_process`/`net`/`fs` · Kafka
  PLAINTEXT with no ACLs. Schedule together. Beware finding 2's zero-pod selector.
- **#953** (critical) — tenant-realm users cannot log in; signup writes to the tenant realm, login
  authenticates against the platform realm.
- **`charts#15`** — Temporal Web UI unauthenticated, write-enabled, unprotected by policy.
- **`charts#17`** — Grafana anonymous access and unauthenticated Prometheus disclose the tenant roster.
- **#976** — flow execution tokens signed with a committed constant; a forged token was accepted.
- **#978** — audit hash chain resets to genesis and the verifier is inverted. Integrity, not coverage —
  do this before tier 4's coverage work.
- **#1016** — admin-created principals still get no `workspace_id` claim (the unfinished half of #961).
- **#1008 + #973** — opposite axes of one authorization problem: five of seven roles inert
  (fail-closed), and tenant membership granting blanket workspace access (fail-open). Fix together.
- **#1011** — `anon` API keys can be minted with `data:write`; the declared ceiling is never enforced.

## Tier 2 — the portal M1 path

- **#981 + #980** — must land together; either alone still yields an unauthenticated or unrouted
  request. Waits on `charts#13` and `charts#22`.
- **#997** — waits on `charts#20`.
- **#1002** — `storage.get` calls an obsolete `/download` object route.
- **#979 + #969** — nothing in the platform ever creates a Keycloak client.
- **#1005 + #1010** — a client generated from the published OpenAPI cannot talk to the runtime. Blocks
  the rule-6 contract handover.
- **#993** — `Idempotency-Key` published `required` with a 24 h replay promise and no implementation.
- **#998** — shared E2E workspace has no bucket; S12 is the M1 gate itself.

## Tier 3 — close the classes, not the instances

*Highest leverage per hour. Deliberately placed **before** tier 4: the substrate work is large, and
doing it without these guards means re-finding the same classes by hand.*

| Work | Retires |
|---|---|
| **#985** — catalog↔runtime CI guard | #954 #952 #992 #967 #975 — the guard is the fix, the 18 unreachable routes are symptoms |
| **Fail-closed on absent config** (not yet filed) | the class behind the 2026-08-09 outage; generalises #981 |
| **`charts#12`** — assert `runAsNonRoot` ⇒ numeric `runAsUser` in a rendered-manifest test | `charts#12` · APISIX · #965's vendor half |
| **`charts#20`** — assert every NetworkPolicy selector matches a real pod label | `charts#20` · the #972 fix trap |
| **#1015** — validate release versions against a tag or ref | release traceability; §19 rows 12 and 13 |

## Tier 4 — the DoD substrate

*Prerequisite of all 15 OpenSpec changes.* CLAUDE.md rule 1 requires tenant/workspace authorization,
audit, quotas and secret redaction in **every** change, and all four are broken platform-wide, so no
change can honestly claim its Definition of Done until this lands.

| Subsystem | State | Issues |
|---|---|---|
| Quotas | 1 of 18 declared dimensions enforced; overrides and plan assignments discarded | #962 #988 #963 #960 #964 |
| Audit coverage | 65 of 93 mutating routes unaudited; most denials unrecorded | #971 #974 #958 |
| Secret lifecycle | plaintext inlined into 5 Knative object kinds; survives purge; session never renewed | #970 #977 #984 |
| Write-envelope class | third and fourth instances of the pattern #994 opened | #1004 #1009 |

## Tier 5 — wave backlog and long tail

The 15 planned OpenSpec changes keep their `delivery-plan.md` §2.4 order (#937 #951 #949, then W2
onward), but **none should start before tier 4**, because each one's DoD depends on it.

Long tail, genuinely deferrable: #982 #983 #986 #987 #989 #990 #991 #995 #1013 #1014, `charts#18`
`charts#19` `charts#21`. Two worth pulling forward opportunistically: **`charts#21`** (the flow audit
topic is never provisioned, so 100 % of flow audit is lost) and **#1014** (the docs gap blocking the
portal's onboarding story).

## If you only do one thing

**Tier 0, specifically `charts#27` + `charts#11`.** Six repairs to staging exist only as out-of-band
`kubectl` state, and the next `helm upgrade` reverts every one — including turning brute-force
protection back off. Until that is closed, work on this board can be undone faster than it can be
verified, and any staging test result carries an asterisk.

Second-best single move: the **selector-matches-pod test** in tier 3. Small, and it is the difference
between fixing #972 and appearing to fix #972.

## Two corrections to the board itself

- **#965 is closed but its class is not.** It fixed three first-party Dockerfiles; the same failure has
  since wedged FerretDB and APISIX, both vendor images a Dockerfile change cannot reach. Recorded on
  `charts#12`.
- **#961 is closed but reaches only the signup path.** #1016 carries the remainder, and the runbook's
  §6 "re-stamp existing principals" is not the one-time migration it reads as, while the admin route
  keeps producing claim-less users.

## Maintenance

Re-derive rather than trust this file blindly when it is more than a few runs old: the tier structure
is stable, but membership changes as issues close. Two verifier legs remain unrun and their issues say
so — the positive control for #1009 and the live reproduction for #1013.

Rendered version (same content, shareable):
<https://claude.ai/code/artifact/3615873d-e21c-4f48-8754-d2b70dbc27ff>
