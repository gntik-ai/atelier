# Data Model: Security Hardening Tests (US-SEC-02-T06)

**Branch**: `096-security-hardening-tests`  
**Date**: 2026-03-31  
**Note**: All entities below are in-memory / serialized to JSON. No new PostgreSQL tables or Kafka topics are introduced by T06. The hardening suite *reads* from existing tables/topics but does not add schema changes.

---

## Entity: HardeningTestResult

Represents the outcome of a single security hardening test case.

```typescript
interface HardeningTestResult {
  // Identity
  id: string;                        // e.g. "SL-01", "SE-03", "PR-02"
  suite: HardeningTestSuite;         // "secret-lifecycle" | "scope-enforcement" | "plan-restriction" | "privilege-domain" | "function-privilege" | "tenant-isolation"
  category: HardeningCategory;       // "secrets" | "scopes" | "plan" | "privilege-domain" | "function-privilege" | "tenant-isolation"
  description: string;               // Human-readable scenario description
  severity: "P1" | "P2" | "P3";

  // Outcome
  status: "pass" | "fail" | "skip";
  skipReason?: "enforcement-disabled" | "infrastructure-unavailable" | null;

  // Request details (for failed test diagnosis)
  request?: {
    method: string;                  // "GET" | "POST" | "PUT" | "DELETE"
    path: string;                    // e.g. "/v1/storage/buckets"
    headers?: Record<string, string>;
    actorId?: string;                // credential/token identifier used
    tenantId?: string;
  };

  // Assertions
  expectedHttpStatus: number;        // e.g. 403
  actualHttpStatus?: number;         // undefined if skip or infrastructure failure
  auditEventExpected?: string;       // e.g. "scope-denied", "plan-denied", "workspace-mismatch"
  auditEventObserved?: boolean;      // null if skip
  auditEventData?: Record<string, unknown>;

  // Timing
  durationMs: number;
  timestamp: string;                 // ISO-8601

  // Error (on fail)
  error?: string;                    // assertion failure message or infrastructure error
}
```

### Constraints

- `id` is unique within a test run.
- `severity === "P1"` implies the test is a CI gate blocker.
- `status === "skip"` never increments the failure count regardless of severity (SC-005).
- `auditEventObserved` must be verified within `HARDENING_AUDIT_TIMEOUT_MS` (default 5000 ms, SC-002).

---

## Entity: HardeningReport

Aggregate result of a complete hardening suite run.

```typescript
interface HardeningReport {
  // Run identity
  runId: string;               // UUID v4 generated at run start
  startedAt: string;           // ISO-8601
  completedAt: string;         // ISO-8601

  // Environment snapshot
  environment: {
    apisixBaseUrl: string;
    scopeEnforcementEnabled: boolean;
    privilegeDomainEnforcementEnabled: boolean;
    vaultReachable: boolean;
    kafkaReachable: boolean;
    postgresReachable: boolean;
    nodeVersion: string;
  };

  // Summary statistics
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    p1Total: number;
    p1Failed: number;           // drives exitCode
    p1Skipped: number;
    p2Total: number;
    p2Failed: number;
    p3Total: number;
    p3Failed: number;
  };

  // Per-suite breakdown
  suites: Array<{
    name: HardeningTestSuite;
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    durationMs: number;
  }>;

  // All test results
  results: HardeningTestResult[];

  // CI gate
  exitCode: 0 | 1;             // 1 if summary.p1Failed > 0
}
```

### Invariants

- `summary.total === summary.passed + summary.failed + summary.skipped`
- `exitCode === (summary.p1Failed > 0 ? 1 : 0)`
- `results.length === summary.total`

---

## Entity: TestFixture

Isolated tenant/workspace/credential set provisioned for a single hardening test run.

```typescript
interface TestFixture {
  runId: string;

  // Primary tenant (Tenant A in isolation tests)
  tenantA: {
    tenantId: string;            // hardening-{runId}-a
    workspaceId: string;
    credentials: FixtureCredentialSet;
    secrets: FixtureSecretSet;
  };

  // Secondary tenant (Tenant B in isolation tests)
  tenantB: {
    tenantId: string;            // hardening-{runId}-b
    workspaceId: string;
    credentials: Pick<FixtureCredentialSet, "fullAccess">;
  };

  superadminToken: string;       // pre-existing; not provisioned per-run
}

interface FixtureCredentialSet {
  // API keys by scope/domain
  fullAccess: string;                    // all scopes, all domains
  storageReadOnly: string;               // scope: storage:read only
  functionsInvokeOnly: string;           // function_invocation only
  functionsDeployOnly: string;           // function_deployment only
  dataAccessOnly: string;                // data_access domain only
  structuralAdminOnly: string;           // structural_admin domain only
}

interface FixtureSecretSet {
  // Vault-backed service credential
  activeVersion: { path: string; value: string; versionId: string };
  rotatedVersion?: { path: string; oldValue: string; newValue: string; graceExpiresAt: string };
  revokedVersion?: { path: string; revokedValue: string };
  // Webhook signing secret
  webhookSigningSecret: { subscriptionId: string; currentSecret: string; oldSecret?: string };
}
```

### Lifecycle

```text
createIsolatedFixture(runId)
  │
  ├─► POST /v1/admin/tenants            → tenantA, tenantB
  ├─► POST /v1/workspaces               → workspaceA, workspaceB
  ├─► POST /v1/api-keys (×6)            → FixtureCredentialSet per tenant
  ├─► POST /v1/secrets/rotation/initiate → activeVersion secret
  └─► POST /v1/webhooks/subscriptions   → webhookSigningSecret

teardownFixture(runId)
  │
  ├─► DELETE /v1/webhooks/subscriptions/:id
  ├─► DELETE /v1/secrets/:path (soft-delete via revoke)
  ├─► DELETE /v1/api-keys/:id (×6 per tenant)
  ├─► DELETE /v1/workspaces/:id (×2)
  └─► DELETE /v1/admin/tenants/:id (×2)
```

---

## Enum: HardeningTestSuite

```typescript
type HardeningTestSuite =
  | "secret-lifecycle"
  | "scope-enforcement"
  | "plan-restriction"
  | "privilege-domain"
  | "function-privilege"
  | "tenant-isolation";
```

## Enum: HardeningCategory

```typescript
type HardeningCategory =
  | "secrets"
  | "scopes"
  | "plan"
  | "privilege-domain"
  | "function-privilege"
  | "tenant-isolation";
```

---

## Data Flow: Audit Verification

```text
Test makes HTTP request
        │
        ▼
APISIX denies (HTTP 403)
        │
        ├─► Lua plugin writes to PostgreSQL (sync via action)
        │          scope_enforcement_denials
        │          privilege_domain_denials
        │
        └─► Lua plugin publishes to Kafka (async, fire-and-forget)
                   console.security.scope-denied
                   console.security.privilege-domain-denied
                   console.security.plan-denied
                   console.security.workspace-mismatch

audit-verifier.mjs polls:
  ├─► PostgreSQL (primary): SELECT ... WHERE actor_id = ? AND created_at > ?
  │       poll every 200 ms, up to HARDENING_AUDIT_TIMEOUT_MS (5000 ms)
  └─► Kafka consumer (fallback/secrets): earliest offset from test start
```

---

## Read-only Tables Accessed by the Suite

The hardening suite reads from (but does not write to) the following existing tables:

| Table | Source Feature | Purpose in hardening |
|-------|----------------|----------------------|
| `scope_enforcement_denials` | T03 | Verify scope-denied audit events for SE-\* and PR-\* tests |
| `privilege_domain_denials` | T04 | Verify privilege-domain-denied events for PD-\* and FP-\* tests |
| `secret_version_states` | T02 | Verify secret version status for SL-\* tests |
| `endpoint_scope_requirements` | T03 | Verify fail-closed tests (SE-03, SE-04): endpoint with no/removed requirements |

No DDL migrations are required for T06.
