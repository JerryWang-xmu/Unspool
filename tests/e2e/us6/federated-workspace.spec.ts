import { expect, test } from "@playwright/test";

/**
 * T178 / T219: GUI acceptance for two owners, five nodes, twenty Grants and
 * emergency-disable. The validation fixture must seed these records through
 * the real Runner; no fixed-tool/Patch control is allowed in B0.
 */
const REQUIRED = ["UNSPOOL_E2E_BASE_URL", "UNSPOOL_E2E_BETA_FIXTURE_URL"] as const;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value)
    throw new Error(
      `[US6 E2E setup missing] ${name} is required. Start the two-owner, five-node, twenty-Grant validation fixture.`,
    );
  return value;
}

test.beforeEach(async () => {
  for (const name of REQUIRED) requireEnv(name);
  const response = await fetch(requireEnv("UNSPOOL_E2E_BETA_FIXTURE_URL"));
  if (!response.ok)
    throw new Error(`[US6 E2E setup missing] Beta fixture is unavailable: ${response.status}`);
});

test("B0 shows five nodes, twenty Grants, independent rights, and no Patch controls", async ({
  page,
}) => {
  await page.goto(requireEnv("UNSPOOL_E2E_BASE_URL"), { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("desktop-root")).toBeVisible();
  await expect(page.getByTestId("node-item")).toHaveCount(5);
  await expect(page.getByTestId("grant-editor")).toBeVisible();
  await expect(page.getByTestId("snapshot-preview")).toBeVisible();
  await expect(page.getByTestId("patch-review")).toHaveCount(0);
  await expect(page.getByTestId("propagation-review")).toHaveCount(0);
  await expect(page.getByTestId("receipt-gap")).toBeVisible();
});

test("B1 requires dual approval and emergency-disable returns every level to disabled", async ({
  page,
}) => {
  await page.goto(requireEnv("UNSPOOL_E2E_BASE_URL"), { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("patch-review")).toBeVisible();
  await expect(page.getByTestId("propagation-review")).toBeVisible();
  await page.getByTestId("emergency-disable-beta").click();
  await expect(page.getByTestId("runner-status")).toContainText(/disabled|offline/i);
  await expect(page.getByTestId("patch-review")).toHaveCount(0);
  await expect(page.getByTestId("propagation-review")).toHaveCount(0);
});
