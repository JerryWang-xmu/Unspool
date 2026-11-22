import { expect, test } from "@playwright/test";

/** T119: approval center, stop confirmation and unknown-state GUI acceptance. */
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`[US3 E2E setup missing] ${name} is required.`);
  return value;
}

test.beforeEach(async () => {
  for (const name of ["UNSPOOL_E2E_BASE_URL", "UNSPOOL_E2E_US3_FIXTURE_URL"]) required(name);
  const response = await fetch(required("UNSPOOL_E2E_US3_FIXTURE_URL"));
  if (!response.ok)
    throw new Error(
      `[US3 E2E setup missing] Safe-execution fixture is unavailable: ${response.status}`,
    );
});

test("approval branches, stop-withheld queue and unknown outcome stay explicit", async ({
  page,
}) => {
  await page.goto(required("UNSPOOL_E2E_BASE_URL"));
  await expect(page.getByTestId("approval-center")).toBeVisible();
  await page.getByTestId("approval-item").first().click();
  await expect(page.getByTestId("approval-details")).toBeVisible();
  await page.getByTestId("reject-reason").fill("Reviewed and rejected for validation");
  await page.getByTestId("reject-approval").click();
  await page.getByTestId("confirm-reject").click();
  await expect(page.getByTestId("approval-feedback")).toContainText(/reject/i);
  await page.getByTestId("approve-approval").click();
  await expect(page.getByTestId("permit-consumed")).toHaveCount(1);
  await page.getByTestId("stop-run").click();
  await expect(page.getByTestId("stop-run-dialog")).toBeVisible();
  await page.getByTestId("confirm-stop").click();
  await expect(page.getByTestId("unknown-outcome-panel")).toBeVisible();
  await expect(page.getByTestId("no-blind-retry")).toContainText(/Do not retry/i);
});
