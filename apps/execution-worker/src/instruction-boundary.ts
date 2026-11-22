export interface ReleasedInstruction {
  readonly id: string;
  readonly kind: string;
  readonly body: string;
  readonly position: number;
}

/**
 * Called only after the current tool/session boundary. A released instruction is
 * never automatically released again; an apply failure is explicitly unknown.
 */
export async function executeAtInstructionBoundary(input: {
  readonly consume: () => Promise<ReleasedInstruction | null>;
  readonly apply: (instruction: ReleasedInstruction) => void | Promise<void>;
}): Promise<{ state: "idle" | "applied" | "outcome_unknown"; instruction?: ReleasedInstruction }> {
  const instruction = await input.consume();
  if (instruction === null) return { state: "idle" };
  try {
    await input.apply(instruction);
    return { state: "applied", instruction };
  } catch {
    return { state: "outcome_unknown", instruction };
  }
}
