import { expect, test } from "@playwright/test";

/** T131: running-handoff and private-preparation GUI acceptance. */
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`[US4 E2E setup missing] ${name} is required.`);
  return value;
}

test.beforeEach(async () => {
  for (const name of ["UNSPOOL_E2E_BASE_URL", "UNSPOOL_E2E_US4_FIXTURE_URL"]) required(name);
  const response = await fetch(required("UNSPOOL_E2E_US4_FIXTURE_URL"));
  if (!response.ok)
    throw new Error(`[US4 E2E setup missing] Handoff fixture is unavailable: ${response.status}`);
});

test("recipient prepares privately with citations, then accepts without stopping the main Run", async ({
  page,
}) => {
  await page.goto(required("UNSPOOL_E2E_BASE_URL"));
  await expect(page.getByTestId("handoff-invitation")).toBeVisible();
  await expect(page.getByTestId("preparation-workspace")).toBeVisible();
  await expect(page.getByTestId("citation-item").first()).toBeVisible();
  await expect(page.getByTestId("run-state")).toContainText("running");
  await page.getByTestId("accept-handoff").click();
  await expect(page.getByTestId("current-operator")).toContainText(/epoch/i);
  await expect(page.getByTestId("run-state")).toContainText("running");
});
