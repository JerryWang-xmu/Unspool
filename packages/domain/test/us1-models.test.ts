import { describe, expect, expectTypeOf, it } from "vitest";
import type { AgentConversation } from "../src/agent-conversation.js";
import type { QueuedInstruction } from "../src/queued-instruction.js";
import {
  QUEUED_INSTRUCTION_STATES,
  type QueuedInstructionState,
} from "../src/queued-instruction.js";
import type { Run } from "../src/run.js";
import { ACTIVE_RUN_STATES, RUN_STATES, type RunState, TERMINAL_RUN_STATES } from "../src/run.js";
import type { RunAttempt } from "../src/run-attempt.js";
import { RUN_ATTEMPT_STATES, type RunAttemptState } from "../src/run-attempt.js";
import type { RunCommand } from "../src/run-command.js";
import { RUN_COMMAND_KINDS, type RunCommandKind } from "../src/run-command.js";
import type { SessionCheckpoint } from "../src/session-checkpoint.js";

describe("US1 canonical domain models", () => {
  it("keeps technical Run state separate from the manual result", () => {
    expectTypeOf<Run["state"]>().toEqualTypeOf<RunState>();
    expectTypeOf<"result" extends keyof Run ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<"completion" extends keyof Run ? true : false>().toEqualTypeOf<false>();
    expect(RUN_STATES).toContain("technical_complete");
    expect(RUN_STATES).toContain("needs_confirmation");
    expect(ACTIVE_RUN_STATES).toContain("needs_confirmation");
    expect(TERMINAL_RUN_STATES).not.toContain("needs_confirmation");
  });

  it("keeps exact conversation and checkpoint references", () => {
    expectTypeOf<AgentConversation["piSessionRef"]>().toEqualTypeOf<string>();
    expectTypeOf<Run["conversationId"]>().toEqualTypeOf<string>();
    expectTypeOf<Run["lastKnownCheckpoint"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<SessionCheckpoint["conversationId"]>().toEqualTypeOf<string>();
    expectTypeOf<SessionCheckpoint["piLeafId"]>().toEqualTypeOf<string>();
    expectTypeOf<SessionCheckpoint["lastPersistedEntryId"]>().toEqualTypeOf<string>();
    expectTypeOf<SessionCheckpoint["lastProjectedEventId"]>().toEqualTypeOf<string>();
    expectTypeOf<SessionCheckpoint["runId"]>().toEqualTypeOf<string | undefined>();
  });

  it("keeps operator and attempt epochs explicit", () => {
    expectTypeOf<Run["operatorEpoch"]>().toEqualTypeOf<number>();
    expectTypeOf<RunAttempt["attemptEpoch"]>().toEqualTypeOf<number>();
    expectTypeOf<RunCommand["operatorEpoch"]>().toEqualTypeOf<number>();
    expectTypeOf<RunAttempt["state"]>().toEqualTypeOf<RunAttemptState>();
    expect(RUN_ATTEMPT_STATES).toContain("outcome_unknown");
  });

  it("keeps command kinds and idempotency fields explicit", () => {
    expectTypeOf<RunCommand["kind"]>().toEqualTypeOf<RunCommandKind>();
    expectTypeOf<RunCommand["commandId"]>().toEqualTypeOf<string>();
    expectTypeOf<RunCommand["payload"]>().toEqualTypeOf<Readonly<Record<string, unknown>>>();
    expect(RUN_COMMAND_KINDS).toEqual(["start", "steer", "follow_up", "stop", "queue_action"]);
  });

  it("keeps the self-managed FIFO and withheld queue model", () => {
    expectTypeOf<QueuedInstruction["state"]>().toEqualTypeOf<QueuedInstructionState>();
    expectTypeOf<QueuedInstruction["position"]>().toEqualTypeOf<number>();
    expectTypeOf<QueuedInstruction["sourceCommandId"]>().toEqualTypeOf<string>();
    expectTypeOf<QueuedInstruction["dequeuedAt"]>().toEqualTypeOf<string | undefined>();
    expect(QUEUED_INSTRUCTION_STATES).toEqual([
      "queued",
      "withheld",
      "modified",
      "deleted",
      "released",
    ]);
  });
});
