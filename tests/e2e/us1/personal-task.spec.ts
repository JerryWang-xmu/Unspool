/**
 * T052 / US1 / QS-01.1-3 / UAT-25, UAT-26 / SC-001, SC-002.
 *
 * RED GUI acceptance test for the personal MVP. It deliberately creates and
 * mutates everything through the desktop GUI; the only non-GUI operations are
 * reading the fixture file for hash evidence, polling the validation Runner's
 * health endpoint, and invoking the validation restart command.
 *
 * The validation fixture must run a deterministic faux scenario:
 * read-only fixture tool -> Markdown artifact -> approval-required write.
 * The write must be proposed again after one rejection, and it must append
 * UNSPOOL_E2E_US1_WRITE_MARKER to UNSPOOL_E2E_US1_CANARY_PATH exactly once
 * after the second proposal is approved.
 *
 * Required environment variables:
 * - UNSPOOL_E2E_US1_CANARY_PATH: regular file targeted only by the write tool.
 * - UNSPOOL_E2E_US1_WRITE_MARKER: non-secret marker appended exactly once.
 * - UNSPOOL_E2E_US1_ARTIFACT_NAME: Markdown artifact produced by the task.
 * - UNSPOOL_E2E_US1_RUN_LABEL: unique label for this validation run.
 * - UNSPOOL_E2E_US1_RUNNER_LABEL: exact GUI option label of the local Runner.
 * - UNSPOOL_E2E_US1_MODEL_LABEL: exact GUI option label of the faux profile.
 * - UNSPOOL_E2E_US1_RUNNER_HEALTH_URL: Runner readiness URL used after restart.
 * - UNSPOOL_E2E_US1_RUNNER_RESTART_COMMAND: validation-only command that stops
 *   and starts the dedicated Runner. It must never target a real data directory.
 * - UNSPOOL_E2E_BASE_URL (optional): GUI URL, default http://127.0.0.1:1420.
 *
 * Stable data-testid contract used below:
 * - Shell/home: desktop-root, personal-task-list, team-required-banner,
 *   new-personal-task, personal-task-item[data-workspace-id], nav-personal-tasks,
 *   recent-task[data-workspace-id][data-session-id], runner-status.
 * - Creation: personal-task-editor, personal-task-name, personal-task-goal,
 *   runner-select, model-profile-select, create-personal-task, workspace-id,
 *   workspace-title, workspace-kind, workspace-team-id, selected-runner,
 *   selected-model-profile.
 * - Run/tools: start-run, run-timeline, run-state, run-id, session-id,
 *   tool-call[data-tool-kind][data-approval-required][data-state],
 *   permit-consumed, permit-event[data-event-type].
 * - Approval: approval-center, approval-item[data-state][data-tool-kind],
 *   approval-details, approval-action[data-tool-kind], approval-state,
 *   reject-reason, reject-approval, confirm-reject, approval-feedback,
 *   approve-approval.
 * - Artifact: artifact-list, artifact-item[data-artifact-name]
 *   [data-artifact-version].
 *
 * The GUI is expected to be already signed in as the single owner. No Team,
 * sharing, federation, or real model credential is required or permitted.
 */
import { exec } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { promisify } from "node:util";
import { expect, type Locator, type Page, test } from "@playwright/test";

const execAsync = promisify(exec);

const DEFAULT_GUI_URL = "http://127.0.0.1:1420";
const GUI_CLOSED_GRACE_MS = 2_000;
const PENDING_APPROVAL = '[data-testid="approval-item"][data-state="pending"]';
const PERMIT_EVENT = '[data-testid="permit-event"][data-event-type="approval.permit_consumed"]';
const REQUIRED_ENV = {
  artifactName: "UNSPOOL_E2E_US1_ARTIFACT_NAME",
  canaryPath: "UNSPOOL_E2E_US1_CANARY_PATH",
  healthUrl: "UNSPOOL_E2E_US1_RUNNER_HEALTH_URL",
  modelLabel: "UNSPOOL_E2E_US1_MODEL_LABEL",
  restartCommand: "UNSPOOL_E2E_US1_RUNNER_RESTART_COMMAND",
  runLabel: "UNSPOOL_E2E_US1_RUN_LABEL",
  runnerLabel: "UNSPOOL_E2E_US1_RUNNER_LABEL",
  writeMarker: "UNSPOOL_E2E_US1_WRITE_MARKER",
} as const;

interface Setup {
  readonly artifactName: string;
  readonly baseUrl: string;
  readonly canaryPath: string;
  readonly healthUrl: string;
  readonly modelLabel: string;
  readonly restartCommand: string;
  readonly runLabel: string;
  readonly runnerLabel: string;
  readonly writeMarker: string;
}

interface RunRef {
  readonly runId: string;
  readonly sessionId: string;
}

let setup: Setup;

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function requireEnvValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`[US1 E2E setup missing] ${name} must be set to a non-empty value.`);
  }
  return value;
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }

  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

async function fileHash(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function assertReachable(url: string, failure: string): Promise<void> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    await response.arrayBuffer();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    }
  } catch (cause) {
    throw new Error(`${failure} Cause: ${causeMessage(cause)}`);
  }
}

async function restartRunner(input: Setup): Promise<void> {
  try {
    // Supplied only by the dedicated validation fixture. Never point this at a
    // real user Runner or a production data directory.
    await execAsync(input.restartCommand, { timeout: 120_000, windowsHide: true });
  } catch (cause) {
    throw new Error(
      [
        "[US1 Runner restart precondition] The validation restart command failed.",
        `Command: ${input.restartCommand}`,
        `Cause: ${causeMessage(cause)}`,
        "UNSPOOL_E2E_US1_RUNNER_RESTART_COMMAND must stop and start only the dedicated local validation Runner.",
      ].join("\n"),
    );
  }

  await expect
    .poll(
      async () => {
        try {
          const response = await fetch(input.healthUrl, {
            signal: AbortSignal.timeout(3_000),
          });
          await response.arrayBuffer();
          return response.ok;
        } catch {
          return false;
        }
      },
      {
        message: `Runner did not become healthy at ${input.healthUrl} after restart`,
        timeout: 90_000,
        intervals: [500, 1_000, 2_000],
      },
    )
    .toBe(true);
}

async function gotoGui(page: Page): Promise<void> {
  try {
    await page.goto(setup.baseUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
  } catch (cause) {
    throw new Error(
      [
        `[US1 GUI precondition] Unspool GUI could not be loaded at ${setup.baseUrl}.`,
        "Start the validation GUI before running tests/e2e/us1/personal-task.spec.ts.",
        `Cause: ${causeMessage(cause)}`,
      ].join(" "),
    );
  }

  await expect(
    page.getByTestId("desktop-root"),
    'The GUI loaded but did not render the Unspool desktop root (data-testid="desktop-root").',
  ).toBeVisible({ timeout: 20_000 });
}

async function openHome(page: Page): Promise<void> {
  await gotoGui(page);
  await expect(
    page.getByTestId("personal-task-list"),
    "US1 personal-task home must be usable without creating or joining a Team.",
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByTestId("runner-status"),
    "The GUI must show the local Runner as available.",
  ).toHaveText(/available|online|connected|ready|可用|在线/i, { timeout: 30_000 });
}

async function textOf(locator: Locator, label: string): Promise<string> {
  await expect(locator, `${label} must be visible`).toBeVisible();
  const value = (await locator.textContent())?.trim();
  expect(value, `${label} must not be empty`).toBeTruthy();
  return value ?? "";
}

async function createPersonalTask(
  page: Page,
  input: { readonly name: string; readonly goal: string },
): Promise<string> {
  await page.getByTestId("new-personal-task").click();
  await expect(page.getByTestId("personal-task-editor")).toBeVisible();
  await expect(
    page.getByTestId("team-required-banner"),
    "personal task creation must not require a Team",
  ).toHaveCount(0);

  await page.getByTestId("personal-task-name").fill(input.name);
  await page.getByTestId("personal-task-goal").fill(input.goal);
  await page
    .getByTestId("personal-task-completion-criteria")
    .fill("Complete the stated goal and preserve readable approval and artifact evidence.");

  const runnerSelect = page.getByTestId("runner-select");
  await expect(
    runnerSelect.locator("option").filter({ hasText: setup.runnerLabel }),
    `Runner option "${setup.runnerLabel}" must exist in the GUI`,
  ).toHaveCount(1);
  await runnerSelect.selectOption({ label: setup.runnerLabel });

  const modelSelect = page.getByTestId("model-profile-select");
  await expect(
    modelSelect.locator("option").filter({ hasText: setup.modelLabel }),
    `Model option "${setup.modelLabel}" must exist in the GUI`,
  ).toHaveCount(1);
  await modelSelect.selectOption({ label: setup.modelLabel });

  await page.getByTestId("create-personal-task").click();
  await expect(page.getByTestId("workspace-title")).toContainText(input.name);
  await expect(page.getByTestId("workspace-kind")).toHaveText(/personal|个人/i);
  await expect(page.getByTestId("workspace-team-id")).toHaveCount(0);
  await expect(page.getByTestId("selected-model-profile")).toContainText(/faux/i);

  return textOf(page.getByTestId("workspace-id"), "personal workspace id");
}

async function startPersonalRun(page: Page): Promise<RunRef> {
  await expect(
    page.getByTestId("start-run"),
    "The personal task must expose a GUI start action.",
  ).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId("start-run").click();
  await expect(page.getByTestId("start-run-disclosure")).toBeVisible();
  await page.getByTestId("confirm-start-run").click();
  await expect(
    page.getByTestId("run-timeline"),
    "Starting a Run must open its timeline.",
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("run-state")).toHaveText(
    /running|waiting_approval|created|运行|待审批/i,
    { timeout: 30_000 },
  );

  const runId = await textOf(page.getByTestId("run-id"), "run id");
  const sessionId = await textOf(page.getByTestId("session-id"), "pi session id");
  expect(runId, "run id must be a UUID").toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
  expect(sessionId, "pi session id must not be empty").not.toBe("");
  return { runId, sessionId };
}

async function waitForReadOnlyToolAndArtifact(page: Page): Promise<void> {
  await expect(
    page.locator('[data-testid="tool-call"][data-tool-kind="read"]').first(),
    "The GUI must show the read-only tool call.",
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.locator('[data-testid="tool-call"][data-tool-kind="read"][data-approval-required="true"]'),
    "The read-only tool must not require approval.",
  ).toHaveCount(0);

  const artifact = page
    .getByTestId("artifact-item")
    .filter({ hasText: setup.artifactName })
    .first();
  await expect(artifact, `Artifact "${setup.artifactName}" must be visible.`).toBeVisible({
    timeout: 30_000,
  });
  await expect(artifact).toHaveAttribute("data-artifact-version", /\d+/);
}

async function waitForPendingApproval(page: Page, label: string): Promise<Locator> {
  const pending = page.locator(PENDING_APPROVAL);
  await expect(pending, `${label}: exactly one pending approval must be visible`).toHaveCount(1, {
    timeout: 30_000,
  });
  return pending.first();
}

async function rejectPendingWriteApproval(page: Page): Promise<void> {
  const pending = await waitForPendingApproval(page, "write approval to reject");
  await expect(pending).toHaveAttribute("data-tool-kind", "write");
  await pending.click();

  await expect(page.getByTestId("approval-details")).toBeVisible();
  await expect(page.getByTestId("approval-action")).toHaveAttribute("data-tool-kind", "write");
  await expect(page.getByTestId("approval-action")).toContainText(basename(setup.canaryPath));
  await expect(page.getByTestId("approval-state")).toHaveText(/pending|待审批/i);

  await page
    .getByTestId("reject-reason")
    .fill("Rejected once: this branch must leave the target file unchanged.");
  await page.getByTestId("reject-approval").click();
  await page.getByTestId("confirm-reject").click();

  await expect(page.getByTestId("approval-state")).toHaveText(/rejected|已拒绝/i);
  await expect(page.getByTestId("approval-feedback")).toContainText(/reject|拒绝/i);
  await expect(
    page.locator('[data-testid="approval-item"][data-state="rejected"]'),
    "The rejected approval must remain visible in history.",
  ).toHaveCount(1);
}

async function goHome(page: Page): Promise<void> {
  const taskList = page.getByTestId("personal-task-list");
  if (await taskList.isVisible().catch(() => false)) {
    return;
  }

  const nav = page.getByTestId("nav-personal-tasks");
  await expect(nav, "The GUI must expose a way back to personal task history.").toBeVisible();
  await nav.click();
  await expect(taskList).toBeVisible();
}

async function currentWorkspaceId(page: Page): Promise<string | null> {
  const workspace = page.getByTestId("workspace-id").first();
  if (!(await workspace.isVisible().catch(() => false))) {
    return null;
  }
  const value = (await workspace.textContent())?.trim();
  return value === "" ? null : (value ?? null);
}

async function openTask(
  page: Page,
  input: { readonly taskName: string; readonly workspaceId: string; readonly sessionId: string },
): Promise<void> {
  await expect
    .poll(
      async () =>
        (await page
          .getByTestId("workspace-id")
          .first()
          .isVisible()
          .catch(() => false)) ||
        (await page
          .getByTestId("personal-task-list")
          .isVisible()
          .catch(() => false)),
      {
        message: "The GUI must show either personal task history or an open task after recovery.",
        timeout: 30_000,
        intervals: [250, 500, 1_000],
      },
    )
    .toBe(true);

  const workspace = page.getByTestId("workspace-id").first();
  if (await workspace.isVisible().catch(() => false)) {
    await expect(workspace).toHaveText(input.workspaceId);
    await expect(page.getByTestId("session-id")).toHaveText(input.sessionId);
    return;
  }

  const item = page.getByTestId("personal-task-item").filter({ hasText: input.taskName }).first();
  await expect(item, `History must contain the personal task "${input.taskName}".`).toBeVisible();
  await expect(item).toHaveAttribute("data-workspace-id", input.workspaceId);
  await item.click();

  await expect(page.getByTestId("workspace-id")).toHaveText(input.workspaceId);
  await expect(page.getByTestId("session-id")).toHaveText(input.sessionId);
}

test.describe.configure({ mode: "serial" });

test.describe("US1 personal task, approval boundary, and recovery", () => {
  test.beforeAll(async () => {
    const missing = Object.values(REQUIRED_ENV).filter((name) => {
      const value = process.env[name];
      return value === undefined || value.trim() === "";
    });
    if (missing.length > 0) {
      throw new Error(
        [
          "[US1 E2E setup missing] Required environment variables are not set:",
          ...missing.map((name) => `  - ${name}`),
          "Start the dedicated US1 validation profile (GUI + local Runner + faux reject-then-approve fixture) and export these values.",
          "Do not point this spec at a real user data directory.",
        ].join("\n"),
      );
    }

    const baseUrl = process.env.UNSPOOL_E2E_BASE_URL?.trim() || DEFAULT_GUI_URL;
    setup = {
      artifactName: requireEnvValue(REQUIRED_ENV.artifactName),
      baseUrl: baseUrl.replace(/\/+$/, ""),
      canaryPath: requireEnvValue(REQUIRED_ENV.canaryPath),
      healthUrl: requireEnvValue(REQUIRED_ENV.healthUrl),
      modelLabel: requireEnvValue(REQUIRED_ENV.modelLabel),
      restartCommand: requireEnvValue(REQUIRED_ENV.restartCommand),
      runLabel: requireEnvValue(REQUIRED_ENV.runLabel),
      runnerLabel: requireEnvValue(REQUIRED_ENV.runnerLabel),
      writeMarker: requireEnvValue(REQUIRED_ENV.writeMarker),
    };

    if (!/faux/i.test(setup.modelLabel)) {
      throw new Error(
        `[US1 E2E setup invalid] UNSPOOL_E2E_US1_MODEL_LABEL must select the faux model profile; received "${setup.modelLabel}".`,
      );
    }

    try {
      const info = await stat(setup.canaryPath);
      if (!info.isFile()) {
        throw new Error("path is not a regular file");
      }
      const initial = await readFile(setup.canaryPath, "utf8");
      if (countOccurrences(initial, setup.writeMarker) !== 0) {
        throw new Error(
          "the write marker is already present; start from a clean validation fixture",
        );
      }
    } catch (cause) {
      throw new Error(
        [
          "[US1 E2E setup invalid] UNSPOOL_E2E_US1_CANARY_PATH must point to a readable fixture file",
          "that does not already contain UNSPOOL_E2E_US1_WRITE_MARKER.",
          `Path: ${setup.canaryPath}`,
          `Cause: ${causeMessage(cause)}`,
        ].join("\n"),
      );
    }

    await assertReachable(
      setup.baseUrl,
      [
        `[US1 GUI precondition] Unspool GUI is not reachable at ${setup.baseUrl}.`,
        "Start the validation GUI (for example `npm run dev:desktop`) before running tests/e2e/us1/personal-task.spec.ts.",
      ].join(" "),
    );
    await assertReachable(
      setup.healthUrl,
      [
        `[US1 Runner precondition] Runner health is not reachable at ${setup.healthUrl}.`,
        "Start the dedicated local validation Runner with the faux model and the US1 reject-then-approve fixture.",
      ].join(" "),
    );
  });

  test("no Team, Runner/faux, read-only plus write approval, reject once, approve once, GUI close, Runner restart", async ({
    page,
  }) => {
    test.setTimeout(300_000);

    const taskName = `US1 primary ${setup.runLabel}`;
    const decoyName = `US1 decoy ${setup.runLabel}`;
    const taskGoal = [
      "Use the read-only fixture tool to read the supplied brief.",
      `Create the Markdown artifact "${setup.artifactName}".`,
      "Before writing the canary file, request approval.",
      "If that write is rejected, request the same write again; never retry it automatically.",
    ].join(" ");

    const hashBefore = await fileHash(setup.canaryPath);
    expect(
      countOccurrences(await readFile(setup.canaryPath, "utf8"), setup.writeMarker),
      "the canary fixture must start without the write marker",
    ).toBe(0);

    const context = page.context();
    let gui = page;
    let primaryWorkspaceId = "";
    let decoyWorkspaceId = "";
    let runRef: RunRef = { runId: "", sessionId: "" };
    let hashAfterApproval = "";

    await test.step("create decoy and primary personal tasks without a Team", async () => {
      await openHome(gui);
      await expect(
        gui.getByTestId("team-required-banner"),
        "the personal flow must not require Team setup",
      ).toHaveCount(0);

      decoyWorkspaceId = await createPersonalTask(gui, {
        name: decoyName,
        goal: "History decoy only. Do not start a Run.",
      });
      await goHome(gui);
      const decoyItem = gui
        .getByTestId("personal-task-item")
        .filter({ hasText: decoyName })
        .first();
      await expect(decoyItem).toBeVisible();
      await expect(decoyItem).toHaveAttribute("data-workspace-id", decoyWorkspaceId);

      primaryWorkspaceId = await createPersonalTask(gui, { name: taskName, goal: taskGoal });
      expect(primaryWorkspaceId).not.toBe(decoyWorkspaceId);
      await expect(gui.getByTestId("selected-runner")).toContainText(setup.runnerLabel);
      await expect(gui.getByTestId("selected-model-profile")).toContainText(/faux/i);
    });

    await test.step("run the read-only tool and show the artifact before write approval", async () => {
      runRef = await startPersonalRun(gui);
      await waitForReadOnlyToolAndArtifact(gui);
    });

    await test.step("reject one write approval without changing the file", async () => {
      await rejectPendingWriteApproval(gui);
      await expect(
        gui.locator(PENDING_APPROVAL),
        "the rejected write must be proposed again for the approval branch",
      ).toHaveCount(1, { timeout: 30_000 });

      expect(
        await fileHash(setup.canaryPath),
        "rejecting the write must not change the target file hash",
      ).toBe(hashBefore);
      expect(
        countOccurrences(await readFile(setup.canaryPath, "utf8"), setup.writeMarker),
        "rejecting the write must not append the write marker",
      ).toBe(0);
      await expect(
        gui.locator(PERMIT_EVENT),
        "a rejected approval must not consume a permit",
      ).toHaveCount(0);
    });

    await test.step("close the GUI while the Run is still waiting for approval", async () => {
      await gui.close();
      await new Promise<void>((resolve) => {
        setTimeout(resolve, GUI_CLOSED_GRACE_MS);
      });

      gui = await context.newPage();
      await gotoGui(gui);
      await expect(
        gui.getByTestId("runner-status"),
        "the Runner must reconnect after the GUI was closed",
      ).toHaveText(/available|online|connected|ready|可用|在线/i, { timeout: 60_000 });

      await openTask(gui, {
        taskName,
        workspaceId: primaryWorkspaceId,
        sessionId: runRef.sessionId,
      });
      await expect(gui.getByTestId("run-id")).toHaveText(runRef.runId);
      await expect(gui.getByTestId("session-id")).toHaveText(runRef.sessionId);
      await expect(
        gui.getByTestId("run-state"),
        "closing the GUI must not stop the active Run",
      ).not.toHaveText(/stopped|cancelled|已停止|已取消/i);
      await expect(
        gui.locator(PENDING_APPROVAL),
        "the pending approval must survive a GUI close",
      ).toHaveCount(1, { timeout: 30_000 });
    });

    await test.step("approve once and observe a single permit and a single write", async () => {
      const pending = await waitForPendingApproval(gui, "second write approval");
      await expect(pending).toHaveAttribute("data-tool-kind", "write");
      await pending.click();

      await expect(gui.getByTestId("approval-details")).toBeVisible();
      await expect(gui.getByTestId("approval-action")).toHaveAttribute("data-tool-kind", "write");
      await expect(gui.getByTestId("approval-action")).toContainText(basename(setup.canaryPath));
      await expect(gui.getByTestId("approve-approval")).toBeEnabled();
      await gui.getByTestId("approve-approval").click();

      await expect(
        gui.getByTestId("permit-consumed"),
        "approving once must show permit consumption",
      ).toBeVisible({ timeout: 30_000 });
      await expect(gui.getByTestId("approval-state")).toHaveText(
        /approved|consumed|已批准|已消费/i,
      );
      await expect(gui.getByTestId("approve-approval")).toBeDisabled();
      await expect(
        gui.locator(PERMIT_EVENT),
        "the run must record exactly one approval.permit_consumed event",
      ).toHaveCount(1, { timeout: 30_000 });
      await expect(
        gui.locator('[data-testid="tool-call"][data-tool-kind="write"][data-state="succeeded"]'),
        "the approved write tool must succeed exactly once",
      ).toHaveCount(1, { timeout: 30_000 });

      await expect
        .poll(async () => fileHash(setup.canaryPath), {
          message: "the approved write must change the target file",
          timeout: 30_000,
        })
        .not.toBe(hashBefore);
      await expect
        .poll(
          async () => countOccurrences(await readFile(setup.canaryPath, "utf8"), setup.writeMarker),
          {
            message: "the approved write must append the marker exactly once",
            timeout: 30_000,
          },
        )
        .toBe(1);

      hashAfterApproval = await fileHash(setup.canaryPath);

      const artifact = gui
        .getByTestId("artifact-item")
        .filter({ hasText: setup.artifactName })
        .first();
      await expect(
        artifact,
        `Artifact "${setup.artifactName}" must remain visible after approval.`,
      ).toBeVisible({ timeout: 30_000 });
      await expect(gui.getByTestId("artifact-list")).toContainText(setup.artifactName);
    });

    await test.step("restart the Runner and restore history with the correct recent session", async () => {
      await gui.close();
      await restartRunner(setup);

      gui = await context.newPage();
      await gotoGui(gui);
      await expect(
        gui.getByTestId("runner-status"),
        "the restarted Runner must become available to the GUI",
      ).toHaveText(/available|online|connected|ready|可用|在线/i, { timeout: 60_000 });

      const landingId = await currentWorkspaceId(gui);
      if (landingId !== null) {
        expect(
          landingId,
          "restart must not restore a recent session from the decoy workspace",
        ).toBe(primaryWorkspaceId);
        await expect(gui.getByTestId("session-id")).toHaveText(runRef.sessionId);
      }

      await openTask(gui, {
        taskName,
        workspaceId: primaryWorkspaceId,
        sessionId: runRef.sessionId,
      });
      await expect(gui.getByTestId("workspace-id")).toHaveText(primaryWorkspaceId);
      await expect(gui.getByTestId("workspace-kind")).toHaveText(/personal|个人/i);
      await expect(gui.getByTestId("run-id")).toHaveText(runRef.runId);
      await expect(gui.getByTestId("session-id")).toHaveText(runRef.sessionId);
      await expect(gui.getByTestId("run-timeline")).not.toBeEmpty();
      await expect(gui.getByTestId("artifact-list")).toContainText(setup.artifactName);
      await expect(gui.getByTestId("approval-center")).toBeVisible();
      await expect(
        gui.locator('[data-testid="approval-item"][data-state="rejected"]'),
        "the rejected approval must remain in recovered history",
      ).toHaveCount(1);
      await expect(
        gui.locator(PERMIT_EVENT),
        "recovered history must still contain exactly one consumed permit",
      ).toHaveCount(1);

      await goHome(gui);
      const recent = gui.getByTestId("recent-task");
      await expect(recent, "the recent task must point to the primary personal task").toBeVisible();
      await expect(recent).toHaveAttribute("data-workspace-id", primaryWorkspaceId);
      await expect(recent).toHaveAttribute("data-session-id", runRef.sessionId);
      await expect(recent).toContainText(taskName);
      await expect(recent).not.toContainText(decoyName);

      const primaryItem = gui
        .getByTestId("personal-task-item")
        .filter({ hasText: taskName })
        .first();
      const decoyItem = gui
        .getByTestId("personal-task-item")
        .filter({ hasText: decoyName })
        .first();
      await expect(primaryItem).toHaveAttribute("data-workspace-id", primaryWorkspaceId);
      await expect(decoyItem).toHaveAttribute("data-workspace-id", decoyWorkspaceId);

      await primaryItem.click();
      await expect(gui.getByTestId("workspace-id")).toHaveText(primaryWorkspaceId);
      await expect(gui.getByTestId("run-id")).toHaveText(runRef.runId);
      await expect(gui.getByTestId("session-id")).toHaveText(runRef.sessionId);
      await expect(gui.locator(PERMIT_EVENT)).toHaveCount(1);

      expect(
        await fileHash(setup.canaryPath),
        "Runner restart must not replay the approved write",
      ).toBe(hashAfterApproval);
      expect(
        countOccurrences(await readFile(setup.canaryPath, "utf8"), setup.writeMarker),
        "the write tool must have executed exactly once across the restart",
      ).toBe(1);
      await mkdir("artifacts/validation/us1/gui", { recursive: true });
      await gui.screenshot({ path: "artifacts/validation/us1/gui/recovered.png", fullPage: true });
    });
  });
});
