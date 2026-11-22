import { expect, test } from "@playwright/test";

/** T153: evidence review and independent archive-reading GUI acceptance. */
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`[US5 E2E setup missing] ${name} is required.`);
  return value;
}

test.beforeEach(async () => {
  for (const name of ["UNSPOOL_E2E_BASE_URL", "UNSPOOL_E2E_US5_FIXTURE_URL"]) required(name);
  const response = await fetch(required("UNSPOOL_E2E_US5_FIXTURE_URL"));
  if (!response.ok)
    throw new Error(`[US5 E2E setup missing] Evidence fixture is unavailable: ${response.status}`);
});

test("review impacts and download an independent archive with missing and unknown markers", async ({
  page,
}) => {
  await page.goto(required("UNSPOOL_E2E_BASE_URL"));
  await expect(page.getByTestId("conclusion-board")).toBeVisible();
  await expect(page.getByTestId("impact-review")).toBeVisible();
  await page.getByTestId("impact-reason").fill("Reviewed changed source");
  await page.getByTestId("impact-state").selectOption("review_required");
  await page.getByRole("button", { name: "Record review" }).click();
  await expect(page.getByTestId("archive-explorer")).toBeVisible();
  await expect(page.getByTestId("archive-missing")).toBeVisible();
  await expect(page.getByTestId("archive-unknown")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download manifest" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.json$/);
});
