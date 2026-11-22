import {
  B1_ONLY_CAPABILITIES,
  validationCases,
} from "../../../../packages/test-support/src/validation-cases.js";

export function validationCaseCounts(): { uat: number; to: number; t: number } {
  return {
    uat: validationCases.filter((entry) => entry.suite === "uat").length,
    to: validationCases.filter((entry) => entry.suite === "to").length,
    t: validationCases.filter((entry) => entry.suite === "t").length,
  };
}

export function assertReleaseEvidence(executedCaseIds: ReadonlySet<string>): void {
  const missing = validationCases
    .filter((entry) => !executedCaseIds.has(entry.id))
    .map((entry) => entry.id);
  if (missing.length > 0)
    throw new Error(`Release evidence is missing cases: ${missing.join(", ")}`);
}

export function assertValidationCatalogComplete(): void {
  const counts = validationCaseCounts();
  if (counts.uat !== 60 || counts.to !== 13 || counts.t !== 20)
    throw new Error(`Validation catalog is incomplete: ${JSON.stringify(counts)}`);
  for (const entry of validationCases) {
    if (
      entry.stage === "beta-b0" &&
      entry.capabilities.some((capability) => B1_ONLY_CAPABILITIES.includes(capability as never))
    ) {
      throw new Error(`${entry.id} leaks a B1 capability into B0`);
    }
  }
}
