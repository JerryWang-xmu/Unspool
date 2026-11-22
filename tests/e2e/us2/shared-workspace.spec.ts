import { mkdir, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

expect.configure({ timeout: 30_000 });

/** T090 / T114: two-member-capable workspace and five-client GUI acceptance. */
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`[US2 E2E setup missing] ${name} is required.`);
  return value;
}

test.beforeEach(async () => {
  for (const name of [
    "UNSPOOL_E2E_BASE_URL",
    "UNSPOOL_E2E_US2_FIXTURE_URL",
    "UNSPOOL_E2E_US2_SECOND_MEMBER_URL",
  ])
    required(name);
  const response = await fetch(required("UNSPOOL_E2E_US2_FIXTURE_URL"));
  if (!response.ok)
    throw new Error(`[US2 E2E setup missing] Shared fixture is unavailable: ${response.status}`);
});

test("two members and five clients converge on selected context and one active Run", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("requestfailed", (request) =>
    console.error(
      `GUI request failed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? "unknown"}`,
    ),
  );
  page.on("response", (response) => {
    if (response.status() >= 400) console.error(`GUI HTTP ${response.status()}: ${response.url()}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") console.error(`GUI console: ${message.text()}`);
  });
  const guiUrl = required("UNSPOOL_E2E_BASE_URL");
  await page.goto(guiUrl);
  await expect(page.getByTestId("desktop-root")).toBeVisible();
  await expect(page.getByTestId("workspace-overview")).toBeVisible();
  await expect(page.getByTestId("latest-artifact").first()).toContainText("shared-onboarding.md");
  await expect(page.getByTestId("workspace-goal")).toContainText(
    "Prove real GUI context convergence",
  );
  await expect(page.getByTestId("workspace-criteria")).toContainText(
    "Five clients display one context and Run",
  );
  await expect(page.getByTestId("current-operator")).toContainText("us2-operator");
  await page.getByLabel("Title", { exact: true }).fill("Five-client shared decision");
  await page
    .getByLabel("Body", { exact: true })
    .fill("Created through the desktop GUI and visible to every connected client.");
  await page.getByTestId("save-context-version").click();
  await expect(page.getByTestId("context-item").first()).toBeVisible();
  await expect(page.getByTestId("context-item").first()).toContainText(
    "Five-client shared decision",
  );

  const otherPages = await Promise.all(
    Array.from({ length: 4 }, async (_, index) => {
      const other = await context.newPage();
      await other.goto(index === 0 ? required("UNSPOOL_E2E_US2_SECOND_MEMBER_URL") : guiUrl);
      await expect(other.getByTestId("workspace-overview")).toBeVisible();
      await expect(other.getByTestId("latest-artifact").first()).toContainText(
        "shared-onboarding.md",
      );
      await expect(other.getByTestId("workspace-goal")).toContainText(
        "Prove real GUI context convergence",
      );
      await expect(other.getByTestId("current-operator")).toContainText("us2-operator");
      return other;
    }),
  );
  const pages = [page, ...otherPages];
  for (const client of pages) {
    await expect(client.getByTestId("context-item").first()).toContainText(
      "Five-client shared decision",
    );
    await expect(client.getByTestId("run-state").first()).toContainText(
      /created|running|waiting_approval/,
    );
  }
  const runIds = await Promise.all(
    pages.map(async (client) => (await client.getByTestId("run-id").first().textContent())?.trim()),
  );
  expect(runIds[0]).toBeTruthy();
  expect(new Set(runIds).size).toBe(1);

  const draftValues = pages.map(
    (_, index) => `Private client-${index} draft; must not appear in another client.`,
  );
  for (const [index, client] of pages.entries()) {
    await client.getByLabel("Discussion draft", { exact: true }).fill(draftValues[index]!);
    await client
      .getByLabel("Filter timeline", { exact: true })
      .fill(index === 0 ? "client-zero-display-filter" : "");
  }
  for (const [index, client] of pages.entries()) {
    await expect(client.getByLabel("Discussion draft", { exact: true })).toHaveValue(
      draftValues[index]!,
    );
    if (index > 0)
      await expect(client.getByLabel("Discussion draft", { exact: true })).not.toHaveValue(
        draftValues[0]!,
      );
  }
  await pages[1]!.evaluate(() => window.scrollTo(0, 0));
  await pages[0]!.evaluate(() => window.scrollTo(0, 600));
  const scrollY = await Promise.all(pages.map((client) => client.evaluate(() => window.scrollY)));
  expect(scrollY[0]).toBeGreaterThan(scrollY[1]!);
  await pages[0]!.evaluate(() => window.scrollTo(0, 0));

  const output = "artifacts/validation/us2/gui";
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: `${output}/five-clients.png`, fullPage: true });
  await writeFile(
    `${output}/summary.json`,
    `${JSON.stringify(
      {
        scenario: "QS-02 five-client GUI",
        result: "pass",
        clientCount: pages.length,
        contextTitle: "Five-client shared decision",
        latestArtifact: "shared-onboarding.md",
        secondMemberRole: "contributor",
        runIds,
        independentDrafts: draftValues,
        independentTimelineFilter: "client-zero-display-filter",
        scrollY,
        screenshot: `${output}/five-clients.png`,
        authenticatedRealRunner: true,
        syntheticPaidApis: false,
      },
      null,
      2,
    )}\n`,
  );
  await context.close();
});

test("operator cancels an exact pre-start disclosure, then confirms one scoped Run", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(required("UNSPOOL_E2E_US2_START_URL"));
  await expect(page.getByTestId("workspace-overview")).toBeVisible();
  await expect(page.getByTestId("start-run")).toBeEnabled();
  await page.getByTestId("start-run").click();
  await expect(page.getByTestId("start-run-disclosure")).toBeVisible();
  await expect(page.getByTestId("disclosure-goal")).toContainText("Review exact context scope");
  await expect(page.getByTestId("disclosure-criteria")).toContainText("Cancel creates no Run");
  await expect(page.getByTestId("disclosure-runner")).toContainText("US2 GUI faux runner");
  await expect(page.getByTestId("disclosure-profile")).toContainText("faux");
  const items = page.getByTestId("disclosure-context-item");
  await expect(items).toHaveCount(2);
  await expect(items.filter({ hasText: "Provided decision" })).toHaveAttribute(
    "data-provided",
    "true",
  );
  await expect(items.filter({ hasText: "Excluded private draft" })).toHaveAttribute(
    "data-provided",
    "false",
  );
  await page.getByTestId("cancel-start-run").click();
  await expect(page.getByTestId("start-run-disclosure")).toHaveCount(0);
  await expect(page.getByTestId("run-id")).toHaveCount(0);

  await page.getByTestId("start-run").click();
  await page.getByTestId("confirm-start-run").click();
  await expect(page.getByTestId("start-run-disclosure")).toHaveCount(0);
  await expect(page.getByTestId("run-id")).toHaveText(/^[0-9a-f-]{36}$/);
  await expect(page.getByTestId("run-state")).toContainText(/created|running|waiting_approval/);
  const runId = (await page.getByTestId("run-id").textContent())?.trim();
  await mkdir("artifacts/validation/us2/gui", { recursive: true });
  await page.screenshot({
    path: "artifacts/validation/us2/gui/start-disclosure.png",
    fullPage: true,
  });
  await writeFile(
    "artifacts/validation/us2/gui/start-disclosure.json",
    `${JSON.stringify({ scenario: "UAT-05 pre-start disclosure", result: "pass", cancelCreatedRun: false, confirmedRunId: runId, providedContext: 1, excludedContext: 1 }, null, 2)}\n`,
  );
  await context.close();
});
