import { mkdir, readFile, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

expect.configure({ timeout: 30_000 });

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`[UAT-28 setup missing] ${name} is required.`);
  return value;
}

test.beforeEach(async () => {
  const response = await fetch(required("UNSPOOL_E2E_US2_FIXTURE_URL"));
  expect(response.ok).toBe(true);
});

test("UAT-28 completes sharing, collaboration, approval, handoff, evidence and archive through GUI only", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const owner = await browser.newPage();
  owner.on("response", (response) => {
    if (response.status() >= 400)
      console.error(`UAT28 HTTP ${response.status()}: ${response.url()}`);
  });
  owner.on("requestfailed", (request) =>
    console.error(
      `UAT28 request failed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? "unknown"}`,
    ),
  );
  const baseUrl = required("UNSPOOL_E2E_BASE_URL");
  await owner.goto(baseUrl);
  await expect(owner.getByTestId("desktop-root")).toBeVisible();
  await owner.getByTestId("new-personal-task").click();
  await owner.getByTestId("personal-task-name").fill("UAT28 personal workflow");
  await owner
    .getByTestId("personal-task-goal")
    .fill("Share only selected work and complete the whole collaboration workflow");
  await owner
    .getByTestId("personal-task-completion-criteria")
    .fill("All decisions are made in the GUI and the shared workspace is archived");
  await expect(owner.getByTestId("create-personal-task")).toBeEnabled();
  await owner.getByTestId("create-personal-task").click();
  await expect(owner.getByTestId("workspace-kind")).toHaveText("personal");
  const personalId = (await owner.getByTestId("workspace-id").textContent())?.trim();
  expect(personalId).toBeTruthy();

  await owner.getByLabel("Title", { exact: true }).fill("Shareable decision");
  await owner.getByLabel("Body", { exact: true }).fill("Approved shared decision content");
  await owner.getByTestId("save-context-version").click();
  await expect(
    owner.getByTestId("context-item").filter({ hasText: "Shareable decision" }),
  ).toBeVisible();
  await owner.getByLabel("Title", { exact: true }).fill("Private draft never shared");
  await owner.getByLabel("Body", { exact: true }).fill("UAT28-PRIVATE-CANARY");
  await owner.getByTestId("member-visibility-select").selectOption("private");
  await owner.getByTestId("save-context-version").click();
  await expect(
    owner.getByTestId("context-item").filter({ hasText: "Private draft never shared" }),
  ).toBeVisible();

  const privateRecord = owner
    .getByTestId("share-record")
    .filter({ hasText: "Private draft never shared" });
  await expect(privateRecord.locator("input[type=checkbox]")).toBeDisabled();
  const sharedRecord = owner.getByTestId("share-record").filter({ hasText: "Shareable decision" });
  await expect(sharedRecord).toBeVisible();
  await sharedRecord.locator("input[type=checkbox]").check();
  await owner.getByTestId("create-share-preview").click();
  await expect(owner.getByTestId("share-preview-result")).toBeVisible({ timeout: 30_000 });
  const member = owner
    .getByTestId("share-member")
    .filter({ hasText: required("UNSPOOL_E2E_US2_RECIPIENT_ID") });
  await expect(member).toBeVisible();
  await member.locator("input[type=checkbox]").first().check();
  await member.getByLabel("Role", { exact: true }).selectOption("operator");
  await expect(owner.getByTestId("convert-shared")).toBeEnabled();
  await owner.getByTestId("convert-shared").click();
  await expect(owner.getByTestId("workspace-kind")).toHaveText("shared", { timeout: 30_000 });
  const sharedId = (await owner.getByTestId("workspace-id").textContent())?.trim();
  expect(sharedId).toBeTruthy();
  expect(sharedId).not.toBe(personalId);
  await expect(
    owner.getByTestId("context-item").filter({ hasText: "Private draft never shared" }),
  ).toHaveCount(0);
  await expect(
    owner.getByTestId("context-item").filter({ hasText: "Shareable decision" }),
  ).toBeVisible();

  await owner
    .getByTestId("collaboration-input")
    .fill("A discussion that does not instruct the Agent");
  await owner.getByTestId("submit-collaboration-input").click();
  await expect(owner.getByTestId("run-timeline")).toContainText(
    "A discussion that does not instruct the Agent",
  );
  await owner.getByTestId("collaboration-mode-suggestion").click();
  await owner.getByTestId("collaboration-input").fill("Suggested next instruction");
  await owner.getByTestId("submit-collaboration-input").click();
  const suggestion = owner
    .getByTestId("suggestion-item")
    .filter({ hasText: "Suggested next instruction" });
  await expect(suggestion).toBeVisible();
  await suggestion.getByRole("button", { name: "Adopt", exact: true }).click();
  await expect(suggestion.getByTestId("suggestion-resulting-input")).toBeVisible();

  const pending = owner.locator('[data-testid="approval-item"][data-state="pending"]');
  await expect(pending).toHaveCount(1, { timeout: 30_000 });
  await pending.click();
  await owner.getByTestId("reject-reason").fill("UAT-28 rejection leaves the fixture unchanged");
  await owner.getByTestId("reject-approval").click();
  await owner.getByTestId("confirm-reject").click();
  await expect(owner.getByTestId("approval-state")).toContainText(/rejected/i);

  await owner.getByTestId("handoff-recipient").fill(required("UNSPOOL_E2E_US2_RECIPIENT_ID"));
  await owner.getByTestId("invite-handoff").click();
  const recipient = await browser.newPage();
  recipient.on("response", (response) => {
    if (response.status() >= 400)
      console.error(`UAT28 recipient HTTP ${response.status()}: ${response.url()}`);
    if (response.url().includes("/accept"))
      void response
        .text()
        .then((body) => console.log(`UAT28 accept response ${response.status()}: ${body}`));
  });
  const recipientUrl = new URL(baseUrl);
  recipientUrl.searchParams.set("workspaceId", sharedId!);
  recipientUrl.searchParams.set("runnerToken", required("UNSPOOL_E2E_US2_RECIPIENT_TOKEN"));
  await recipient.goto(recipientUrl.toString());
  await expect(recipient.getByTestId("prepare-handoff")).toBeVisible({ timeout: 30_000 });
  await recipient.getByTestId("prepare-handoff").click();
  await expect(recipient.getByTestId("preparation-workspace")).toBeVisible();
  await recipient
    .getByLabel("Ask a private question")
    .fill("[US4:SOURCED] What is the shared decision?");
  await recipient.getByRole("button", { name: "Ask read-only question" }).click();
  await expect(recipient.getByTestId("private-answer").first()).toBeVisible();
  await expect(recipient.getByTestId("private-answer").first()).toContainText(/sourced/i);
  await recipient.getByTestId("accept-handoff").click();
  await expect(recipient.getByTestId("current-operator").first()).toContainText(
    required("UNSPOOL_E2E_US2_RECIPIENT_ID"),
    { timeout: 30_000 },
  );

  await owner.getByRole("button", { name: "Refresh task", exact: true }).click();
  const conclusion = owner.getByTestId("conclusion-item").first();
  await expect(conclusion).toBeVisible({ timeout: 30_000 });
  await conclusion.getByRole("button").click();
  await owner.getByLabel("Review outcome").selectOption("confirmed");
  await owner
    .getByLabel("Reason", { exact: true })
    .fill("Human owner reviewed the fixture source and selected conclusion");
  await owner.getByRole("button", { name: "Record review" }).click();
  await expect(conclusion).toHaveAttribute("data-state", "confirmed");

  await recipient.getByTestId("stop-run").click();
  await recipient.getByTestId("confirm-stop").click();
  await expect(recipient.getByTestId("run-state")).toContainText(/cancelled|stopped/i, {
    timeout: 30_000,
  });
  await owner.getByRole("button", { name: "Refresh task", exact: true }).click();
  await expect(owner.getByTestId("archive-workspace")).toBeEnabled();
  await owner.getByTestId("archive-workspace").click();
  await expect(owner.getByTestId("workspace-status")).toHaveText("archived");
  await expect(owner.getByTestId("archive-workspace")).toBeDisabled();
  await owner.getByRole("button", { name: "Create export", exact: true }).click();
  const exported = owner.getByTestId("archive-export-item").first();
  await expect(exported).toBeVisible();
  const downloadPromise = owner.waitForEvent("download");
  await exported.getByRole("button", { name: "Download manifest" }).click();
  const download = await downloadPromise;

  const output = "artifacts/validation/us2/full-workflow";
  await mkdir(output, { recursive: true });
  await download.saveAs(`${output}/archive-manifest.json`);
  const manifest = await readFile(`${output}/archive-manifest.json`, "utf8");
  expect(manifest).toContain("conclusions");
  const archive = JSON.parse(manifest);
  expect(archive.workspace.name).toBe("UAT28 personal workflow (shared)");
  expect(archive.workspace.goal).toBe(
    "Share only selected work and complete the whole collaboration workflow",
  );
  expect(archive.workspace.status).toBe("archived");
  expect(archive.runs.some((run: { state: string }) => run.state === "cancelled")).toBe(true);
  expect(archive.conclusions[0].sourceVersionIds.length).toBeGreaterThan(0);
  await owner.screenshot({ path: `${output}/final.png`, fullPage: true });
  await writeFile(
    `${output}/summary.json`,
    `${JSON.stringify(
      {
        caseId: "UAT-28",
        result: "PASS",
        personalId,
        sharedId,
        guiOnlyDecisions: [
          "selective share",
          "discussion",
          "suggestion adoption",
          "approval rejection",
          "private preparation",
          "handoff acceptance",
          "evidence confirmation",
          "stop",
          "archive",
          "manifest download",
        ],
        privateCanaryExcluded: true,
        manifest: `${output}/archive-manifest.json`,
        screenshot: `${output}/final.png`,
        realRunner: true,
        realPaidApis: false,
      },
      null,
      2,
    )}\n`,
  );
  await browser.close();
});
