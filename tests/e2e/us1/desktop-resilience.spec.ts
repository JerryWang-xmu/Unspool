import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";

const baseUrl = process.env.UNSPOOL_E2E_RESILIENCE_BASE_URL;
const healthUrl = process.env.UNSPOOL_E2E_RESILIENCE_HEALTH_URL;
const corsHeaders = {
  "access-control-allow-origin": "http://127.0.0.1:1420",
  "access-control-allow-headers": "authorization,content-type",
  "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
};

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required; use scripts/validate-desktop-resilience.mjs.`);
  }
  return value;
}

function settledRunPayload(value: unknown, runId: string): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => settledRunPayload(item, runId));
  }
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  const next: Record<string, unknown> = { ...record };
  if (record.id === runId) next.state = "technical_complete";
  for (const [key, item] of Object.entries(next)) {
    next[key] = settledRunPayload(item, runId);
  }
  return next;
}

async function openHome(page: Page): Promise<void> {
  await page.goto(required(baseUrl, "UNSPOOL_E2E_RESILIENCE_BASE_URL"), {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("desktop-root")).toBeVisible();
  await expect(page.getByTestId("runner-status")).toHaveText(/available/i, { timeout: 30_000 });
  const response = await page.request.get(required(healthUrl, "UNSPOOL_E2E_RESILIENCE_HEALTH_URL"));
  expect(response.ok()).toBe(true);
}

async function createTask(page: Page, label: string): Promise<string> {
  const name = `${label} ${randomUUID().slice(0, 8)}`;
  await page.getByTestId("new-personal-task").click();
  await expect(page.getByTestId("personal-task-editor")).toBeVisible();
  await page.getByTestId("personal-task-name").fill(name);
  await page.getByTestId("personal-task-goal").fill(`Exercise the ${label} UI boundary.`);
  await page
    .getByTestId("personal-task-completion-criteria")
    .fill("Keep workspace, Run, and disclosure state authoritative under controlled failures.");
  await expect(page.getByTestId("create-personal-task")).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId("create-personal-task").click();
  await expect(page.getByTestId("workspace-title")).toHaveText(name);
  await expect(page.getByTestId("workspace-id")).toBeVisible();
  return (await page.getByTestId("workspace-id").textContent())?.trim() ?? "";
}

async function openTask(page: Page, workspaceId: string): Promise<void> {
  await page
    .locator(`[data-testid="personal-task-item"][data-workspace-id="${workspaceId}"]`)
    .click();
  await expect(page.getByTestId("workspace-id")).toHaveText(workspaceId);
}

async function startRun(page: Page): Promise<string> {
  await expect(page.getByTestId("start-run")).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId("start-run").click();
  await expect(page.getByTestId("start-run-disclosure")).toBeVisible();
  await expect(page.getByTestId("confirm-start-run")).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId("confirm-start-run").click();
  await expect(page.getByTestId("start-run-disclosure")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByTestId("run-id")).toBeVisible();
  return (await page.getByTestId("run-id").textContent())?.trim() ?? "";
}

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

test("stale A responses cannot overwrite B and workspace refreshes do not create a request storm", async ({
  page,
}) => {
  await openHome(page);
  const workspaceA = await createTask(page, "navigation A");
  const runA = await startRun(page);
  expect(runA).not.toBe("");
  const workspaceB = await createTask(page, "navigation B");
  await openTask(page, workspaceA);
  await expect(page.getByTestId("run-id")).toHaveText(runA);

  let releaseDelay: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseDelay = resolve;
  });
  let delayedRead = false;
  const runsPath = `/v1/workspaces/${workspaceA}/runs`;
  await page.route(`**${runsPath}`, async (route) => {
    if (
      route.request().method() === "GET" &&
      new URL(route.request().url()).pathname === runsPath
    ) {
      delayedRead = true;
      await gate;
    }
    await route.continue();
  });
  try {
    await page.getByRole("button", { name: "Refresh task", exact: true }).click();
    await expect.poll(() => delayedRead).toBe(true);
    await openTask(page, workspaceB);
    await expect(page.getByTestId("run-timeline")).toContainText("No Run has been recorded");
    const staleResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" && new URL(response.url()).pathname === runsPath,
    );
    releaseDelay();
    await staleResponse;
    await expect(page.getByTestId("workspace-id")).toHaveText(workspaceB);
    await expect(page.getByTestId("run-id")).toHaveCount(0);
    await expect(page.getByTestId("run-timeline")).not.toContainText(runA);

    let workspaceReads = 0;
    const onRequest = (request: { url(): string; method(): string }): void => {
      if (
        request.method() === "GET" &&
        new URL(request.url()).pathname === `/v1/workspaces/${workspaceB}`
      ) {
        workspaceReads += 1;
      }
    };
    page.on("request", onRequest);
    await page.waitForTimeout(1_300);
    page.off("request", onRequest);
    expect(workspaceReads).toBeLessThanOrEqual(1);
  } finally {
    releaseDelay();
    await page.unrouteAll();
  }
});

test("execution disclosure waits for the real context scope before enabling confirmation", async ({
  page,
}) => {
  await openHome(page);
  const workspaceId = await createTask(page, "delayed context");
  await expect(page.getByTestId("start-run")).toBeEnabled({ timeout: 30_000 });
  let releaseDelay: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseDelay = resolve;
  });
  let delayContext = true;
  await page.route(`**/v1/workspaces/${workspaceId}/context-items`, async (route) => {
    if (delayContext && route.request().method() === "GET") {
      await gate;
    }
    await route.continue();
  });
  try {
    await page.getByTestId("start-run").click();
    const disclosure = page.getByTestId("start-run-disclosure");
    await expect(disclosure).toBeVisible();
    await expect(disclosure.getByText("Loading the actual context scope…")).toBeVisible();
    await expect(page.getByTestId("confirm-start-run")).toBeDisabled();
    await expect(disclosure.getByText("No saved context versions will be supplied.")).toHaveCount(
      0,
    );
    releaseDelay();
    await expect(page.getByTestId("confirm-start-run")).toBeEnabled({ timeout: 30_000 });
    await expect(disclosure.getByText("No saved context versions will be supplied.")).toBeVisible();
    delayContext = false;
    await page.getByTestId("cancel-start-run").click();
    await expect(disclosure).toHaveCount(0);
  } finally {
    releaseDelay();
    await page.unrouteAll();
  }
});

test("a rejected start stays visible inside the modal and permits an explicit retry", async ({
  page,
}) => {
  await openHome(page);
  const workspaceId = await createTask(page, "rejected start");
  let rejectStart = true;
  await page.route(`**/v1/workspaces/${workspaceId}/runs`, async (route) => {
    if (rejectStart && route.request().method() === "POST") {
      await route.fulfill({
        status: 503,
        headers: { ...corsHeaders, "content-type": "application/json" },
        body: JSON.stringify({ error: "controlled start rejection" }),
      });
      return;
    }
    await route.continue();
  });
  try {
    await expect(page.getByTestId("start-run")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("start-run").click();
    await expect(page.getByTestId("confirm-start-run")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("confirm-start-run").click();
    const disclosure = page.getByTestId("start-run-disclosure");
    await expect(disclosure).toBeVisible();
    await expect(page.getByTestId("start-run-error")).toContainText("Start failed");
    await expect(page.getByTestId("start-run-error")).toContainText("HTTP 503");
    await expect(page.getByTestId("confirm-start-run")).toBeEnabled();
    rejectStart = false;
    await page.getByTestId("confirm-start-run").click();
    await expect(disclosure).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId("run-id")).toBeVisible();
  } finally {
    await page.unrouteAll();
  }
});

test("an accepted but unreconciled start cannot be confirmed again before refresh", async ({
  page,
}) => {
  await openHome(page);
  const workspaceId = await createTask(page, "unreconciled start");
  let accepted = false;
  let failNextRunList = false;
  await page.route(`**/v1/workspaces/${workspaceId}/runs`, async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const response = await route.fetch();
      accepted = response.ok();
      failNextRunList = response.ok();
      await route.fulfill({ response });
      return;
    }
    if (accepted && failNextRunList && request.method() === "GET") {
      failNextRunList = false;
      await route.fulfill({
        status: 503,
        headers: { ...corsHeaders, "content-type": "application/json" },
        body: JSON.stringify({ error: "controlled reconciliation failure" }),
      });
      return;
    }
    await route.continue();
  });
  try {
    await expect(page.getByTestId("start-run")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("start-run").click();
    await expect(page.getByTestId("confirm-start-run")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("confirm-start-run").click();
    const disclosure = page.getByTestId("start-run-disclosure");
    await expect(disclosure).toBeVisible();
    await expect(page.getByTestId("start-run-error")).toContainText(
      "Start was accepted, but the Run record could not be loaded",
    );
    await expect(page.getByTestId("start-run-error")).toContainText("HTTP 503");
    await expect(page.getByTestId("confirm-start-run")).toBeDisabled();
    await page.getByTestId("cancel-start-run").click();
    await expect(page.getByTestId("start-run")).toBeDisabled();
    await page.getByRole("button", { name: "Refresh task", exact: true }).click();
    await expect(page.getByTestId("run-id")).toBeVisible({ timeout: 30_000 });
  } finally {
    await page.unrouteAll();
  }
});

test("an accepted start with no Run record stays unresolved across polling and navigation until explicit refresh", async ({
  page,
}) => {
  await openHome(page);
  const workspaceA = await createTask(page, "missing Run record A");
  let accepted = false;
  let explicitlyReconciling = false;
  await page.route(`**/v1/workspaces/${workspaceA}/runs`, async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      accepted = true;
      await route.fulfill({ status: 202, headers: corsHeaders, body: "" });
      return;
    }
    if (accepted && !explicitlyReconciling && request.method() === "GET") {
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, "content-type": "application/json" },
        body: JSON.stringify({ runs: [] }),
      });
      return;
    }
    await route.continue();
  });
  try {
    await expect(page.getByTestId("start-run")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("start-run").click();
    await expect(page.getByTestId("confirm-start-run")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("confirm-start-run").click();
    await expect(page.getByTestId("start-run-error")).toContainText("did not return a Run record");
    await expect(page.getByTestId("confirm-start-run")).toBeDisabled();
    await page.getByTestId("cancel-start-run").click();
    await expect(page.getByTestId("run-composer")).toContainText(
      "Refresh before starting another Run",
    );
    await expect(page.getByTestId("start-run")).toBeDisabled();

    const workspaceB = await createTask(page, "missing Run record B");
    await openTask(page, workspaceA);
    await expect(page.getByTestId("run-composer")).toContainText(
      "Refresh before starting another Run",
    );
    await expect(page.getByTestId("start-run")).toBeDisabled();
    await openTask(page, workspaceB);
    await openTask(page, workspaceA);
    await expect(page.getByTestId("start-run")).toBeDisabled();

    explicitlyReconciling = true;
    await page.getByRole("button", { name: "Refresh task", exact: true }).click();
    await expect(page.getByTestId("start-run")).toBeEnabled({ timeout: 30_000 });
    await expect(page.getByTestId("run-composer")).not.toContainText(
      "Refresh before starting another Run",
    );
  } finally {
    await page.unrouteAll();
  }
});

test("a historical Run never reconciles a newly accepted empty start response", async ({
  page,
}) => {
  await openHome(page);
  const workspaceA = await createTask(page, "historical Run A");
  const firstRunId = await startRun(page);
  const runsPath = `/v1/workspaces/${workspaceA}/runs`;
  const firstRunPath = `${runsPath}/${firstRunId}`;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === runsPath && request.method() === "POST") {
      await route.fulfill({ status: 202, headers: corsHeaders, body: "" });
      return;
    }
    if (request.method() === "GET" && (pathname === runsPath || pathname === firstRunPath)) {
      const response = await route.fetch();
      const payload = settledRunPayload(await response.json(), firstRunId);
      await route.fulfill({ response, body: JSON.stringify(payload) });
      return;
    }
    await route.continue();
  });
  try {
    await page.getByRole("button", { name: "Refresh task", exact: true }).click();
    await expect(page.getByTestId("run-state")).toHaveText("technical_complete");
    await expect(page.getByTestId("start-run")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("start-run").click();
    await expect(page.getByTestId("confirm-start-run")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("confirm-start-run").click();
    const disclosure = page.getByTestId("start-run-disclosure");
    await expect(disclosure).toBeVisible();
    await expect(page.getByTestId("start-run-error")).toContainText("did not return a Run record");
    await expect(page.getByTestId("confirm-start-run")).toBeDisabled();
    await expect(page.getByTestId("run-id")).toHaveText(firstRunId);
    await page.getByTestId("cancel-start-run").click();

    await createTask(page, "historical Run B");
    await openTask(page, workspaceA);
    await expect(page.getByTestId("run-id")).toHaveText(firstRunId);
    await expect(page.getByTestId("run-composer")).toContainText(
      "Refresh before starting another Run",
    );
    await expect(page.getByTestId("start-run")).toBeDisabled();

    await page.getByRole("button", { name: "Refresh task", exact: true }).click();
    await expect(page.getByTestId("start-run")).toBeEnabled({ timeout: 30_000 });
  } finally {
    await page.unrouteAll();
  }
});

test("an accepted response arriving after Escape and navigation is still registered for reconciliation", async ({
  page,
}) => {
  await openHome(page);
  const workspaceA = await createTask(page, "late accepted response A");
  const runsPath = `/v1/workspaces/${workspaceA}/runs`;
  let releaseStart: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseStart = resolve;
  });
  let accepted = false;
  let explicitlyReconciling = false;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === runsPath && request.method() === "POST") {
      await gate;
      accepted = true;
      await route.fulfill({ status: 202, headers: corsHeaders, body: "" });
      return;
    }
    if (pathname === runsPath && accepted && !explicitlyReconciling && request.method() === "GET") {
      await route.fulfill({
        status: 200,
        headers: { ...corsHeaders, "content-type": "application/json" },
        body: JSON.stringify({ runs: [] }),
      });
      return;
    }
    await route.continue();
  });
  try {
    await expect(page.getByTestId("start-run")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("start-run").click();
    await expect(page.getByTestId("confirm-start-run")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("confirm-start-run").click();
    await expect(page.getByTestId("confirm-start-run")).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("start-run-disclosure")).toHaveCount(0);
    await createTask(page, "late accepted response B");

    const acceptedResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && new URL(response.url()).pathname === runsPath,
    );
    releaseStart();
    await acceptedResponse;
    await openTask(page, workspaceA);
    await expect(page.getByTestId("run-composer")).toContainText(
      "Refresh before starting another Run",
    );
    await expect(page.getByTestId("start-run")).toBeDisabled();

    explicitlyReconciling = true;
    await page.getByRole("button", { name: "Refresh task", exact: true }).click();
    await expect(page.getByTestId("start-run")).toBeEnabled({ timeout: 30_000 });
  } finally {
    releaseStart();
    await page.unrouteAll();
  }
});

test("a pre-start historical detail response cannot erase a newly recorded pending start", async ({
  page,
}) => {
  await openHome(page);
  const workspaceId = await createTask(page, "pre-start refresh");
  const firstRunId = await startRun(page);
  const runsPath = `/v1/workspaces/${workspaceId}/runs`;
  const firstRunPath = `${runsPath}/${firstRunId}`;
  let releaseHistoricalDetail: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseHistoricalDetail = resolve;
  });
  let delayHistoricalDetail = false;
  let delayedRead = false;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === runsPath && request.method() === "POST") {
      await route.fulfill({ status: 202, headers: corsHeaders, body: "" });
      return;
    }
    if (request.method() === "GET" && (pathname === runsPath || pathname === firstRunPath)) {
      const response = await route.fetch();
      const payload = settledRunPayload(await response.json(), firstRunId);
      if (pathname === firstRunPath && delayHistoricalDetail) {
        delayHistoricalDetail = false;
        delayedRead = true;
        await gate;
      }
      await route.fulfill({ response, body: JSON.stringify(payload) });
      return;
    }
    await route.continue();
  });
  try {
    await page.getByRole("button", { name: "Refresh task", exact: true }).click();
    await expect(page.getByTestId("run-state")).toHaveText("technical_complete");
    await expect(page.getByTestId("start-run")).toBeEnabled({ timeout: 30_000 });

    delayHistoricalDetail = true;
    await expect.poll(() => delayedRead, { timeout: 10_000 }).toBe(true);
    await page.getByTestId("start-run").click();
    await expect(page.getByTestId("confirm-start-run")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("confirm-start-run").click();
    await expect(page.getByTestId("start-run-error")).toContainText("did not return a Run record");
    const historicalResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" && new URL(response.url()).pathname === firstRunPath,
    );
    releaseHistoricalDetail();
    await historicalResponse;
    await expect(page.getByTestId("confirm-start-run")).toBeDisabled();
    await page.getByTestId("cancel-start-run").click();
    await expect(page.getByTestId("run-composer")).toContainText(
      "Refresh before starting another Run",
    );
    await expect(page.getByTestId("start-run")).toBeDisabled();

    await page.getByRole("button", { name: "Refresh task", exact: true }).click();
    await expect(page.getByTestId("start-run")).toBeEnabled({ timeout: 30_000 });
  } finally {
    releaseHistoricalDetail();
    await page.unrouteAll();
  }
});

test("a manual refresh started before a new start cannot clear the newer pending entry", async ({
  page,
}) => {
  await openHome(page);
  const workspaceId = await createTask(page, "pre-start manual refresh");
  const firstRunId = await startRun(page);
  const runsPath = `/v1/workspaces/${workspaceId}/runs`;
  const firstRunPath = `${runsPath}/${firstRunId}`;
  let releaseHistoricalDetail: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseHistoricalDetail = resolve;
  });
  let delayHistoricalDetail = false;
  let delayedRead = false;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === runsPath && request.method() === "POST") {
      await route.fulfill({ status: 202, headers: corsHeaders, body: "" });
      return;
    }
    if (request.method() === "GET" && (pathname === runsPath || pathname === firstRunPath)) {
      const response = await route.fetch();
      const payload = settledRunPayload(await response.json(), firstRunId);
      if (pathname === firstRunPath && delayHistoricalDetail) {
        delayHistoricalDetail = false;
        delayedRead = true;
        await gate;
      }
      await route.fulfill({ response, body: JSON.stringify(payload) });
      return;
    }
    await route.continue();
  });
  try {
    await page.getByRole("button", { name: "Refresh task", exact: true }).click();
    await expect(page.getByTestId("run-state")).toHaveText("technical_complete");
    await expect(page.getByTestId("start-run")).toBeEnabled({ timeout: 30_000 });

    delayHistoricalDetail = true;
    await page.getByRole("button", { name: "Refresh task", exact: true }).click();
    await expect.poll(() => delayedRead).toBe(true);
    await page.getByTestId("start-run").click();
    await expect(page.getByTestId("confirm-start-run")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("confirm-start-run").click();
    await expect(page.getByTestId("start-run-error")).toContainText("did not return a Run record");
    const historicalResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" && new URL(response.url()).pathname === firstRunPath,
    );
    releaseHistoricalDetail();
    await historicalResponse;
    await expect(page.getByTestId("confirm-start-run")).toBeDisabled();
    await page.getByTestId("cancel-start-run").click();
    await expect(page.getByTestId("run-composer")).toContainText(
      "Refresh before starting another Run",
    );
    await expect(page.getByTestId("start-run")).toBeDisabled();

    await page.getByRole("button", { name: "Refresh task", exact: true }).click();
    await expect(page.getByTestId("start-run")).toBeEnabled({ timeout: 30_000 });
  } finally {
    releaseHistoricalDetail();
    await page.unrouteAll();
  }
});
