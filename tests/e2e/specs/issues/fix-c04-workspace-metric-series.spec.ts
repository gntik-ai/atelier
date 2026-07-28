/**
 * Real-stack regression for OpenSpec change `fix-c04-workspace-metric-series`.
 *
 * This spec intentionally crosses every deployed boundary involved in C-04:
 *
 *   public login -> control-plane tenant/workspace APIs -> workspace traffic
 *   -> scraped Prometheus counters -> public metric-series API -> web console
 *
 * It does not import product handlers, replace network calls, route requests,
 * or inject metric samples. Prometheus's own query-range HTTP request counter
 * is used to prove that invalid and cross-tenant requests stop before provider
 * access.
 *
 * Required:
 *   E2E_CONSOLE_USER
 *   E2E_CONSOLE_PASSWORD
 *
 * Optional:
 *   E2E_BASE_URL        (default http://localhost:3000)
 *   E2E_API_BASE_URL    (default http://localhost:8080)
 *   E2E_KEYCLOAK_URL    (default http://localhost:8180)
 *   E2E_KEYCLOAK_HOST   (default falcone-keycloak:8080)
 *   E2E_PROMETHEUS_URL  (default http://localhost:9090)
 */
import { randomUUID } from "node:crypto";
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from "@playwright/test";

const CONSOLE_BASE_URL = process.env.E2E_BASE_URL || "http://localhost:3000";
const API_BASE_URL = process.env.E2E_API_BASE_URL || "http://localhost:8080";
const KEYCLOAK_BASE_URL =
  process.env.E2E_KEYCLOAK_URL || "http://localhost:8180";
const KEYCLOAK_HOST = process.env.E2E_KEYCLOAK_HOST || "falcone-keycloak:8080";
const PROMETHEUS_BASE_URL =
  process.env.E2E_PROMETHEUS_URL || "http://localhost:9090";
const CONSOLE_USER = process.env.E2E_CONSOLE_USER || "";
const CONSOLE_PASSWORD = process.env.E2E_CONSOLE_PASSWORD || "";

const RUN_SUFFIX = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
const TRAFFIC_FETCH_MAX_ATTEMPTS = 3;
const TRAFFIC_FETCH_RETRY_BACKOFF_MS = 100;
const ADMIN_HEADERS = () => ({ authorization: `Bearer ${adminToken}` });

type TenantFixture = {
  tenantId: string;
  slug: string;
};

type WorkspaceFixture = {
  tenantId: string;
  workspaceId: string;
};

type MetricPoint = {
  timestamp: string;
  value: number;
};

type MetricSeriesResponse = {
  tenantId: string;
  workspaceId: string;
  metricKey: "api_requests" | "api_errors";
  window: "5m" | "1h" | "24h" | "7d" | "30d";
  unit: "requests_per_second";
  points: MetricPoint[];
};

type PrometheusVectorSample = {
  metric: Record<string, string>;
  value: [number, string];
};

let api: APIRequestContext;
let keycloak: APIRequestContext;
let prometheus: APIRequestContext;
let adminToken = "";
let ownerToken = "";

let primaryTenant: TenantFixture | undefined;
let siblingAlpha: WorkspaceFixture | undefined;
let siblingBeta: WorkspaceFixture | undefined;
let foreignTenant: TenantFixture | undefined;
let foreignWorkspace: WorkspaceFixture | undefined;

test.describe.configure({ mode: "serial" });

function requireFixture<T>(value: T | undefined, name: string): T {
  if (!value) throw new Error(`missing E2E fixture: ${name}`);
  return value;
}

function prometheusLabel(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r\n|\r|\n/g, "\\n");
}

async function publicLogin() {
  const response = await api.post("/v1/auth/login-sessions", {
    data: {
      username: CONSOLE_USER,
      password: CONSOLE_PASSWORD,
    },
  });
  expect(
    [200, 201],
    "the public console login endpoint must authenticate the configured user",
  ).toContain(response.status());

  const session = (await response.json()) as {
    tokenSet?: { accessToken?: unknown };
  };
  expect(typeof session.tokenSet?.accessToken).toBe("string");
  expect(String(session.tokenSet?.accessToken || "").length).toBeGreaterThan(0);
  return String(session.tokenSet?.accessToken);
}

async function createTenant({
  label,
  withOwner = false,
}: {
  label: string;
  withOwner?: boolean;
}) {
  const slug = `c04-${label}-${RUN_SUFFIX}`.toLowerCase();
  const ownerUsername = `c04-owner-${RUN_SUFFIX}`.toLowerCase();
  const response = await api.post("/v1/tenants", {
    headers: ADMIN_HEADERS(),
    data: {
      name: `C04 ${label} ${RUN_SUFFIX}`,
      slug,
      region: "eu-west",
      ...(withOwner
        ? {
            ownerUsername,
            ownerEmail: `${ownerUsername}@example.test`,
            ownerPassword: CONSOLE_PASSWORD,
          }
        : {}),
    },
  });
  expect(
    response.status(),
    `create the ${label} tenant through POST /v1/tenants`,
  ).toBe(201);

  const body = (await response.json()) as {
    tenantId?: unknown;
    id?: unknown;
    tenant?: { tenantId?: unknown; id?: unknown };
  };
  const tenantId = String(
    body.tenantId || body.id || body.tenant?.tenantId || body.tenant?.id || "",
  );
  expect(
    tenantId.length,
    `the ${label} tenant response must expose its canonical id`,
  ).toBeGreaterThan(0);

  return {
    fixture: { tenantId, slug } satisfies TenantFixture,
    ownerUsername,
  };
}

async function createWorkspace(tenant: TenantFixture, label: string) {
  const response = await api.post(
    `/v1/tenants/${encodeURIComponent(tenant.tenantId)}/workspaces`,
    {
      headers: ADMIN_HEADERS(),
      data: {
        name: `C04 ${label} ${RUN_SUFFIX}`,
        slug: `c04-${label}-${RUN_SUFFIX}`.toLowerCase(),
        environment: "sandbox",
      },
    },
  );
  expect(
    response.status(),
    `create workspace ${label} through POST /v1/tenants/{tenantId}/workspaces`,
  ).toBe(201);

  const body = (await response.json()) as {
    workspaceId?: unknown;
    id?: unknown;
    workspace?: { workspaceId?: unknown; id?: unknown };
  };
  const workspaceId = String(
    body.workspaceId ||
      body.id ||
      body.workspace?.workspaceId ||
      body.workspace?.id ||
      "",
  );
  expect(
    workspaceId.length,
    `workspace ${label} must expose its canonical id`,
  ).toBeGreaterThan(0);
  return { tenantId: tenant.tenantId, workspaceId } satisfies WorkspaceFixture;
}

async function obtainTenantOwnerToken(tenant: TenantFixture, username: string) {
  const tokenPath =
    `/realms/${encodeURIComponent(tenant.tenantId)}` +
    "/protocol/openid-connect/token";
  let lastStatus = 0;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await keycloak.post(tokenPath, {
      // Keycloak derives `iss` from the incoming Host when hostname-strict is
      // disabled. Preserve the chart's internal service host through the local
      // port-forward so the control-plane's trusted realm base can verify this
      // tenant token; `localhost:8180` would deliberately be an untrusted issuer.
      headers: { host: KEYCLOAK_HOST },
      form: {
        grant_type: "password",
        client_id: `${tenant.slug}-app`,
        scope: "openid",
        username,
        password: CONSOLE_PASSWORD,
      },
    });
    lastStatus = response.status();
    if (response.ok()) {
      const body = (await response.json()) as { access_token?: unknown };
      expect(typeof body.access_token).toBe("string");
      expect(String(body.access_token || "").length).toBeGreaterThan(0);
      const accessToken = String(body.access_token);
      const claims = JSON.parse(
        Buffer.from(accessToken.split(".")[1] || "", "base64url").toString(),
      ) as {
        iss?: unknown;
        realm_access?: { roles?: unknown };
      };
      expect(String(claims.iss || "")).toMatch(
        new RegExp(
          `/realms/${tenant.tenantId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        ),
      );
      expect(Array.isArray(claims.realm_access?.roles)).toBe(true);
      expect(claims.realm_access?.roles).toContain("tenant_owner");
      return accessToken;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `tenant-owner token endpoint did not become ready (last status ${lastStatus})`,
  );
}

async function prometheusInstantQuery(
  query: string,
): Promise<PrometheusVectorSample[]> {
  const response = await prometheus.get("/api/v1/query", { params: { query } });
  expect(response.status(), "Prometheus instant query must succeed").toBe(200);
  const body = (await response.json()) as {
    status?: unknown;
    data?: { resultType?: unknown; result?: unknown };
  };
  expect(body.status).toBe("success");
  expect(body.data?.resultType).toBe("vector");
  expect(Array.isArray(body.data?.result)).toBe(true);
  return body.data?.result as PrometheusVectorSample[];
}

async function workspaceCounter(workspace: WorkspaceFixture) {
  const result = await prometheusInstantQuery(
    `sum(falcone_http_requests_total{tenant_id="${prometheusLabel(
      workspace.tenantId,
    )}",workspace_id="${prometheusLabel(workspace.workspaceId)}"})`,
  );
  if (result.length === 0) return 0;
  const value = Number(result[0]?.value?.[1]);
  expect(Number.isFinite(value)).toBe(true);
  return value;
}

async function workspaceCounterSamples(workspace: WorkspaceFixture) {
  return prometheusInstantQuery(
    `falcone_http_requests_total{tenant_id="${prometheusLabel(
      workspace.tenantId,
    )}",workspace_id="${prometheusLabel(workspace.workspaceId)}"}`,
  );
}

async function queryRangeRequestCounter() {
  const response = await prometheus.get("/metrics");
  expect(response.status(), "Prometheus self-metrics must be readable").toBe(
    200,
  );
  const text = await response.text();
  let total = 0;
  let found = false;

  for (const line of text.split("\n")) {
    if (
      !line.startsWith("prometheus_http_requests_total{") ||
      !line.includes('handler="/api/v1/query_range"')
    ) {
      continue;
    }
    const value = Number(line.trim().split(/\s+/).at(-1));
    if (!Number.isFinite(value)) continue;
    found = true;
    total += value;
  }

  return { found, total };
}

async function primeQueryRangeRequestCounter() {
  const end = Math.floor(Date.now() / 1000);
  const response = await prometheus.get("/api/v1/query_range", {
    params: {
      query: "vector(1)",
      start: String(end - 10),
      end: String(end),
      step: "5",
    },
  });
  expect(
    response.status(),
    "Prometheus query-range API must be reachable",
  ).toBe(200);
  const body = (await response.json()) as { status?: unknown };
  expect(body.status).toBe("success");
}

async function generateWorkspaceTraffic(
  workspace: WorkspaceFixture,
  count: number,
) {
  for (let index = 0; index < count; index += 1) {
    const response = await fetchWorkspaceTrafficWithRetry(
      new URL(
        `/v1/workspaces/${encodeURIComponent(workspace.workspaceId)}`,
        API_BASE_URL,
      ),
      index + 1,
      count,
    );
    expect(
      response.status,
      `workspace traffic request ${index + 1}/${count} must succeed`,
    ).toBe(200);
  }
}

async function fetchWorkspaceTrafficWithRetry(
  url: URL,
  requestNumber: number,
  requestCount: number,
) {
  for (let attempt = 1; attempt <= TRAFFIC_FETCH_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await fetch(url, { headers: ADMIN_HEADERS() });
    } catch {
      if (attempt === TRAFFIC_FETCH_MAX_ATTEMPTS) {
        throw new Error(
          `workspace traffic request ${requestNumber}/${requestCount} failed after ${TRAFFIC_FETCH_MAX_ATTEMPTS} transport attempts`,
        );
      }
      await new Promise((resolve) =>
        setTimeout(resolve, TRAFFIC_FETCH_RETRY_BACKOFF_MS * attempt),
      );
    }
  }

  throw new Error("workspace traffic request exhausted transport retries");
}

async function getSeries(
  workspace: WorkspaceFixture,
  metricKey: MetricSeriesResponse["metricKey"],
  window: MetricSeriesResponse["window"],
  token = adminToken,
) {
  const response = await api.get(
    `/v1/metrics/workspaces/${encodeURIComponent(workspace.workspaceId)}/series`,
    {
      headers: { authorization: `Bearer ${token}` },
      params: { metricKey, window },
    },
  );
  expect(
    response.status(),
    `${metricKey}/${window} workspace series must succeed`,
  ).toBe(200);
  return (await response.json()) as MetricSeriesResponse;
}

function assertMetricSeries(
  body: MetricSeriesResponse,
  expected: {
    workspace: WorkspaceFixture;
    metricKey: MetricSeriesResponse["metricKey"];
    window: MetricSeriesResponse["window"];
  },
) {
  expect(Object.keys(body).sort()).toEqual([
    "metricKey",
    "points",
    "tenantId",
    "unit",
    "window",
    "workspaceId",
  ]);
  expect(body.tenantId).toBe(expected.workspace.tenantId);
  expect(body.workspaceId).toBe(expected.workspace.workspaceId);
  expect(body.metricKey).toBe(expected.metricKey);
  expect(body.window).toBe(expected.window);
  expect(body.unit).toBe("requests_per_second");
  expect(Array.isArray(body.points)).toBe(true);

  for (const point of body.points) {
    expect(Object.keys(point).sort()).toEqual(["timestamp", "value"]);
    expect(point.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/,
    );
    expect(Number.isFinite(Date.parse(point.timestamp))).toBe(true);
    expect(Number.isFinite(point.value)).toBe(true);
  }
}

async function bestEffortCleanup() {
  if (!api || !adminToken) return;

  for (const workspace of [foreignWorkspace, siblingBeta, siblingAlpha]) {
    if (!workspace) continue;
    await api
      .delete(`/v1/workspaces/${encodeURIComponent(workspace.workspaceId)}`, {
        headers: ADMIN_HEADERS(),
      })
      .catch(() => undefined);
  }

  for (const tenant of [foreignTenant, primaryTenant]) {
    if (!tenant) continue;
    const tenantPath = `/v1/tenants/${encodeURIComponent(tenant.tenantId)}`;
    await api
      .delete(tenantPath, {
        headers: ADMIN_HEADERS(),
        data: {
          reason: "C04 E2E fixture cleanup",
          confirmationText: `delete ${tenant.tenantId}`,
        },
      })
      .catch(() => undefined);
    await api
      .post(`${tenantPath}/purge`, {
        headers: ADMIN_HEADERS(),
      })
      .catch(() => undefined);
  }
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  if (!CONSOLE_USER || !CONSOLE_PASSWORD) {
    throw new Error(
      "E2E_CONSOLE_USER and E2E_CONSOLE_PASSWORD are required for the real C04 regression",
    );
  }

  api = await playwrightRequest.newContext({ baseURL: API_BASE_URL });
  keycloak = await playwrightRequest.newContext({ baseURL: KEYCLOAK_BASE_URL });
  prometheus = await playwrightRequest.newContext({
    baseURL: PROMETHEUS_BASE_URL,
  });

  adminToken = await publicLogin();
  const created = await createTenant({ label: "primary", withOwner: true });
  primaryTenant = created.fixture;
  siblingAlpha = await createWorkspace(created.fixture, "alpha");
  siblingBeta = await createWorkspace(created.fixture, "beta");
  ownerToken = await obtainTenantOwnerToken(
    created.fixture,
    created.ownerUsername,
  );
});

test.afterAll(async () => {
  test.setTimeout(120_000);
  await bestEffortCleanup();
  await Promise.all([
    api?.dispose(),
    keycloak?.dispose(),
    prometheus?.dispose(),
  ]);
});

test("C04 rejects missing, ambiguous, and unsupported key/window values before Prometheus", async () => {
  test.setTimeout(60_000);
  const alpha = requireFixture(siblingAlpha, "sibling alpha");
  const path = `/v1/metrics/workspaces/${encodeURIComponent(alpha.workspaceId)}/series`;
  await primeQueryRangeRequestCounter();
  const before = await queryRangeRequestCounter();
  expect(
    before.found,
    "Prometheus must expose its query-range request counter",
  ).toBe(true);
  const invalidUrls = [
    `${path}?window=5m`,
    `${path}?metricKey=api_requests`,
    `${path}?metricKey=&window=5m`,
    `${path}?metricKey=api_requests&window=`,
    `${path}?metricKey=storage_bytes&window=7d`,
    `${path}?metricKey=api_requests&window=2h`,
    `${path}?metricKey=api_requests&metricKey=api_errors&window=5m`,
    `${path}?metricKey=api_requests&window=5m&window=1h`,
  ];

  for (const url of invalidUrls) {
    const response = await api.get(url, { headers: ADMIN_HEADERS() });
    expect(
      response.status(),
      `invalid query must fail: ${new URL(url, API_BASE_URL).search}`,
    ).toBe(400);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.code).toBe("INVALID_METRIC_SERIES_QUERY");
    expect("points" in body).toBe(false);
    expect("tenantId" in body).toBe(false);
    expect("workspaceId" in body).toBe(false);
  }

  expect(await queryRangeRequestCounter()).toEqual(before);
});

test("C04 keeps sibling selectors isolated and returns live requests plus a distinct empty error series", async () => {
  test.setTimeout(180_000);
  const alpha = requireFixture(siblingAlpha, "sibling alpha");
  const beta = requireFixture(siblingBeta, "sibling beta");
  const alphaBaseline = await workspaceCounter(alpha);
  const betaBaseline = await workspaceCounter(beta);

  // First scrape boundary: only alpha receives traffic. Beta must remain exactly
  // at its baseline even though it shares alpha's tenant.
  await generateWorkspaceTraffic(alpha, 8);
  await expect
    .poll(() => workspaceCounter(alpha), {
      message: "Prometheus must scrape alpha workspace traffic",
      timeout: 60_000,
      intervals: [1_000, 2_000, 3_000],
    })
    .toBeGreaterThanOrEqual(alphaBaseline + 8);
  const alphaAfterFirstScrape = await workspaceCounter(alpha);
  expect(await workspaceCounter(beta)).toBe(betaBaseline);

  // Give beta its own first sample and prove that it cannot increment alpha.
  await generateWorkspaceTraffic(beta, 2);
  await expect
    .poll(() => workspaceCounter(beta), {
      message: "Prometheus must scrape beta workspace traffic",
      timeout: 60_000,
      intervals: [1_000, 2_000, 3_000],
    })
    .toBeGreaterThanOrEqual(betaBaseline + 2);
  expect(await workspaceCounter(alpha)).toBe(alphaAfterFirstScrape);

  // A second scrape with intentionally different deltas makes rate() available
  // for both workspaces and gives the public series distinguishable live data.
  await generateWorkspaceTraffic(alpha, 16);
  await generateWorkspaceTraffic(beta, 4);
  await expect
    .poll(() => workspaceCounter(alpha), {
      message: "Prometheus must scrape alpha second-interval traffic",
      timeout: 60_000,
      intervals: [1_000, 2_000, 3_000],
    })
    .toBeGreaterThanOrEqual(alphaAfterFirstScrape + 16);
  await expect
    .poll(() => workspaceCounter(beta), {
      message: "Prometheus must scrape beta second-interval traffic",
      timeout: 60_000,
      intervals: [1_000, 2_000, 3_000],
    })
    .toBeGreaterThanOrEqual(betaBaseline + 6);

  const alphaSamples = await workspaceCounterSamples(alpha);
  const betaSamples = await workspaceCounterSamples(beta);
  expect(alphaSamples.length).toBeGreaterThan(0);
  expect(betaSamples.length).toBeGreaterThan(0);
  for (const sample of alphaSamples) {
    expect(sample.metric.tenant_id).toBe(alpha.tenantId);
    expect(sample.metric.workspace_id).toBe(alpha.workspaceId);
    expect(sample.metric.workspace_id).not.toBe(beta.workspaceId);
  }
  for (const sample of betaSamples) {
    expect(sample.metric.tenant_id).toBe(beta.tenantId);
    expect(sample.metric.workspace_id).toBe(beta.workspaceId);
    expect(sample.metric.workspace_id).not.toBe(alpha.workspaceId);
  }

  const queryRangeBefore = await queryRangeRequestCounter();
  const alphaRequests = await getSeries(alpha, "api_requests", "5m");
  const alphaErrors = await getSeries(alpha, "api_errors", "5m");
  const betaRequests = await getSeries(beta, "api_requests", "5m");

  assertMetricSeries(alphaRequests, {
    workspace: alpha,
    metricKey: "api_requests",
    window: "5m",
  });
  assertMetricSeries(alphaErrors, {
    workspace: alpha,
    metricKey: "api_errors",
    window: "5m",
  });
  assertMetricSeries(betaRequests, {
    workspace: beta,
    metricKey: "api_requests",
    window: "5m",
  });

  expect(alphaRequests.points.length).toBeGreaterThan(0);
  expect(betaRequests.points.length).toBeGreaterThan(0);
  expect(alphaRequests.points.some((point) => point.value > 0)).toBe(true);
  expect(betaRequests.points.some((point) => point.value > 0)).toBe(true);
  expect(
    alphaErrors.points,
    "no generated 5xx traffic means api_errors must not alias api_requests",
  ).toEqual([]);
  expect(alphaErrors.points).not.toEqual(alphaRequests.points);

  const alphaPeak = Math.max(
    ...alphaRequests.points.map((point) => point.value),
  );
  const betaPeak = Math.max(...betaRequests.points.map((point) => point.value));
  expect(
    alphaPeak,
    "the deliberately larger alpha traffic burst must remain distinct",
  ).toBeGreaterThan(betaPeak);

  // Exercise every accepted public window through the real provider and verify
  // that the response echoes the selected window instead of defaulting to 1h.
  for (const window of ["1h", "24h", "7d", "30d"] as const) {
    const body = await getSeries(alpha, "api_requests", window);
    assertMetricSeries(body, {
      workspace: alpha,
      metricKey: "api_requests",
      window,
    });
  }

  const queryRangeAfter = await queryRangeRequestCounter();
  expect(
    queryRangeAfter.found,
    "Prometheus must expose its query-range request counter",
  ).toBe(true);
  expect(queryRangeAfter.total).toBeGreaterThanOrEqual(
    queryRangeBefore.total + 7,
  );
});

test("C04 denies a tenant-owner token at a known foreign workspace without reaching Prometheus", async () => {
  test.setTimeout(120_000);
  const created = await createTenant({ label: "foreign" });
  foreignTenant = created.fixture;
  foreignWorkspace = await createWorkspace(created.fixture, "foreign-empty");

  const before = await queryRangeRequestCounter();
  expect(
    before.found,
    "the earlier valid-series scenario must establish the provider counter",
  ).toBe(true);

  const response = await api.get(
    `/v1/metrics/workspaces/${encodeURIComponent(foreignWorkspace.workspaceId)}/series`,
    {
      headers: { authorization: `Bearer ${ownerToken}` },
      params: { metricKey: "api_requests", window: "5m" },
    },
  );
  expect(response.status()).toBe(403);
  const body = (await response.json()) as Record<string, unknown>;
  const serialized = JSON.stringify(body);
  expect(body.code).toBe("FORBIDDEN");
  expect("points" in body).toBe(false);
  expect("tenantId" in body).toBe(false);
  expect("workspaceId" in body).toBe(false);
  expect(serialized).not.toContain(foreignTenant.tenantId);
  expect(serialized).not.toContain(foreignWorkspace.workspaceId);
  expect(serialized.toLowerCase()).not.toContain("prometheus");
  expect(serialized.toLowerCase()).not.toContain("query_range");
  expect(await queryRangeRequestCounter()).toEqual(before);
});

test("C04 web console requests and accepts an authoritative empty workspace series", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const tenant = requireFixture(foreignTenant, "foreign tenant");
  const workspace = requireFixture(foreignWorkspace, "foreign empty workspace");

  await page.goto(`${CONSOLE_BASE_URL}/login`);
  await page.locator('input[name="username"]').fill(CONSOLE_USER);
  await page.locator('input[name="password"]').fill(CONSOLE_PASSWORD);
  const [loginResponse] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url().includes("/v1/auth/login-sessions") &&
        response.request().method() === "POST",
    ),
    page.locator('button[type="submit"]').click(),
  ]);
  expect([200, 201]).toContain(loginResponse.status());
  await page.waitForURL(/\/console(?:\/|$)/, { timeout: 30_000 });

  await page.goto(`${CONSOLE_BASE_URL}/console/observability`);
  const tenantSelect = page.getByTestId("console-context-tenant-select");
  await expect(tenantSelect).toBeVisible({ timeout: 30_000 });
  await expect(
    tenantSelect.locator(`option[value="${tenant.tenantId}"]`),
  ).toHaveCount(1, { timeout: 30_000 });

  const seriesResponsePromise = page.waitForResponse(
    (response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "GET" &&
        url.pathname ===
          `/v1/metrics/workspaces/${workspace.workspaceId}/series` &&
        url.searchParams.get("metricKey") === "api_requests" &&
        url.searchParams.get("window") === "24h"
      );
    },
    { timeout: 30_000 },
  );

  await tenantSelect.selectOption(tenant.tenantId);
  const workspaceSelect = page.getByTestId("console-context-workspace-select");
  await expect(
    workspaceSelect.locator(`option[value="${workspace.workspaceId}"]`),
  ).toHaveCount(1, { timeout: 30_000 });
  if ((await workspaceSelect.inputValue()) !== workspace.workspaceId) {
    await workspaceSelect.selectOption(workspace.workspaceId);
  }

  const seriesResponse = await seriesResponsePromise;
  expect(seriesResponse.status()).toBe(200);
  const series = (await seriesResponse.json()) as MetricSeriesResponse;
  assertMetricSeries(series, {
    workspace,
    metricKey: "api_requests",
    window: "24h",
  });
  expect(
    series.points,
    "the never-used workspace must remain empty instead of inheriting tenant/sibling history",
  ).toEqual([]);

  await expect(
    page.getByRole("heading", { name: "Observabilidad" }),
  ).toBeVisible();
  await expect(
    page.getByText("No se pudieron cargar las métricas"),
  ).toHaveCount(0);

  // The real usage endpoint currently publishes only instantaneous quota
  // dimensions and explicitly empty `points` arrays. A non-empty unrelated
  // usage-history fixture cannot be produced without a mock, which this spec
  // forbids; the assertion above covers the real console's strongest observable
  // empty-series behavior.
});
