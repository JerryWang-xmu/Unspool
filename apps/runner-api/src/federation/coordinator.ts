export interface FederationStep {
  readonly id: string;
  readonly dependsOn: readonly string[];
}

export function orderFederationSteps(steps: readonly FederationStep[]): string[] {
  const ordered: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(steps.map((step) => [step.id, step]));
  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error("federation_cycle_detected");
    const step = byId.get(id);
    if (step === undefined) throw new Error("federation_dependency_missing");
    visiting.add(id);
    for (const dependency of step.dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
    ordered.push(id);
  }
  for (const step of steps) visit(step.id);
  return ordered;
}

export class FederationBudgetWatermarks {
  readonly #values = new Map<string, number>();

  consume(nodeId: string, amount: number, limit: number): number {
    if (amount < 0) throw new Error("invalid_budget_amount");
    const next = (this.#values.get(nodeId) ?? 0) + amount;
    if (next > limit) throw new Error("budget_exhausted");
    this.#values.set(nodeId, next);
    return next;
  }

  get(nodeId: string): number {
    return this.#values.get(nodeId) ?? 0;
  }
}

export function reassignPrivateGrant(sourceOwnerId: string, targetOwnerId: string): never {
  if (sourceOwnerId !== targetOwnerId) throw new Error("private_reassignment_denied");
  throw new Error("private_grant_read_only_handoff_required");
}
