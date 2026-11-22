/**
 * Per-ID UAT, TO, and T validation case registry.
 *
 * Each entry is an independently executable case: its prepare, action, expected,
 * positive control, and negative control describe that case rather than linking to
 * an aggregate quickstart scenario. Evidence is always written per case under
 * artifacts/validation/cases/<ID>/summary.json.
 *
 * Stage gates are monotonic: a B1 execution must first complete B0 evidence, while
 * a B0 execution can never run a B1 case or carry a B1-only capability.
 */

export type ValidationSuite = "uat" | "to" | "t";

export type ValidationStage = "stable" | "beta-b0" | "beta-b1";

export const B1_ONLY_CAPABILITIES = [
  "fixed_tool_execution",
  "patch_application",
  "cross_domain_artifact",
] as const;

export type B1OnlyCapability = (typeof B1_ONLY_CAPABILITIES)[number];

export interface ValidationCase {
  readonly id: string;
  readonly suite: ValidationSuite;
  readonly stage: ValidationStage;
  readonly prepare: string;
  readonly action: string;
  readonly expected: string;
  readonly positiveControl: string;
  readonly negativeControl: string;
  readonly evidencePath: string;
  readonly quickstart: readonly string[];
  readonly capabilities: readonly string[];
}

type ValidationCaseDraft = Omit<ValidationCase, "evidencePath">;

const STAGE_PREREQUISITES: Readonly<Record<ValidationStage, readonly ValidationStage[]>> = {
  stable: [],
  "beta-b0": [],
  "beta-b1": ["beta-b0"],
};

function assertRegistryIntegrity(cases: readonly ValidationCase[]): void {
  for (const entry of cases) {
    if (entry.stage !== "beta-b0") {
      continue;
    }

    for (const capability of entry.capabilities) {
      if (isB1OnlyCapability(capability)) {
        throw new Error(`${entry.id} is B0 but declares B1 capability ${capability}`);
      }
    }

    for (const reference of entry.quickstart) {
      if (reference.startsWith("QS-09") || reference.startsWith("QS-10")) {
        throw new Error(`${entry.id} is B0 but depends on B1 fixture ${reference}`);
      }
    }
  }

  const b1Capabilities = new Set(
    cases.filter((entry) => entry.stage === "beta-b1").flatMap((entry) => entry.capabilities),
  );
  for (const capability of B1_ONLY_CAPABILITIES) {
    if (!b1Capabilities.has(capability)) {
      throw new Error(`The B1 registry is missing required capability ${capability}`);
    }
  }
}

function defineCases(drafts: readonly ValidationCaseDraft[]): readonly ValidationCase[] {
  const seen = new Set<string>();
  const cases = drafts.map((draft) => {
    if (seen.has(draft.id)) {
      throw new Error(`Duplicate validation case id: ${draft.id}`);
    }
    seen.add(draft.id);

    return {
      ...draft,
      evidencePath: `artifacts/validation/cases/${draft.id}/summary.json`,
    };
  });

  assertRegistryIntegrity(cases);
  return cases;
}

export const validationCases = defineCases([
  // Stable UAT-01..31
  {
    id: "UAT-01",
    suite: "uat",
    stage: "stable",
    prepare:
      "Create two draft workspaces from one template; the first omits goal, completion criteria, runner, agent configuration, member roles, and approval owner, while the second supplies all of them.",
    action:
      "Save the incomplete workspace, then save the complete workspace and inspect the available start action.",
    expected:
      "The incomplete workspace remains a draft with no start action; the complete workspace becomes startable only after every required field resolves.",
    positiveControl:
      "The complete workspace saves with a resolved runner, configuration, members, and approver and exposes Start.",
    negativeControl:
      "The incomplete save returns field validation and creates no Run, start action, or agent invocation.",
    quickstart: ["QS-02.2"],
    capabilities: ["workspace_lifecycle", "required_fields"],
  },
  {
    id: "UAT-02",
    suite: "uat",
    stage: "stable",
    prepare:
      "Populate a shared workspace overview with goal, completion criteria, status, current operator, key decisions, blockers, and the latest artifact before inviting a second member.",
    action:
      "Sign in as the second member without prior conversation and open the workspace overview for the first time.",
    expected:
      "The new member can state every overview item from the product surface alone, including the current operator and latest artifact.",
    positiveControl:
      "The second member reads the same goal, criteria, status, operator, decisions, blockers, and artifact digest recorded by the owner.",
    negativeControl:
      "A private draft that was not shared is absent from the overview and the member cannot infer or open it.",
    quickstart: ["QS-02.3"],
    capabilities: ["workspace_overview", "member_onboarding"],
  },
  {
    id: "UAT-03",
    suite: "uat",
    stage: "stable",
    prepare:
      "Set up a shared workspace with an idle main agent session and a second member who can post discussion messages.",
    action: "Post a collaborator discussion message that mentions a possible next step.",
    expected:
      "The discussion is visible with its author on the member timeline while the main agent session receives no new instruction and performs no execution.",
    positiveControl:
      "The message appears in the shared timeline exactly once with author and timestamp, and the run state remains idle.",
    negativeControl:
      "No agent prompt, tool call, command, or assistant turn is created from the discussion message.",
    quickstart: ["QS-02.4"],
    capabilities: ["discussion", "agent_isolation"],
  },
  {
    id: "UAT-04",
    suite: "uat",
    stage: "stable",
    prepare:
      "Create one instruction suggestion and one edited variant from a collaborator while the workspace has no active Run.",
    action:
      "Leave both suggestions unadopted, then adopt the original and the edited variant while inspecting attribution.",
    expected:
      "Neither suggestion affects the agent before adoption; each adopted version affects the agent and retains both suggester and operator attribution.",
    positiveControl:
      "The adopted instruction enters the run input with suggestion id, suggester, operator, and adoption timestamp.",
    negativeControl:
      "Before adoption no Run or command exists, and an edit preview does not change agent input.",
    quickstart: ["QS-02.4"],
    capabilities: ["suggestion", "adoption", "attribution"],
  },
  {
    id: "UAT-05",
    suite: "uat",
    stage: "stable",
    prepare:
      "Create a workspace with an agent configuration, completion criteria, and a deliberately selected context set that excludes one private draft.",
    action: "Start the task and inspect the pre-start disclosure before confirming.",
    expected:
      "Before execution the operator sees goal, runner, agent configuration, completion criteria, and the actual context scope, with the private draft excluded.",
    positiveControl:
      "Confirmation creates a Run whose context digest matches the disclosed selection.",
    negativeControl:
      "Cancelling the disclosure creates no Run, and the excluded draft is not read or sent to the model.",
    quickstart: ["QS-02.5"],
    capabilities: ["run_start", "context_disclosure"],
  },
  {
    id: "UAT-06",
    suite: "uat",
    stage: "stable",
    prepare:
      "Start a long-running tool call, then prepare one mid-run correction and one later instruction from the same operator.",
    action:
      "Send the correction while the tool is running, send the later instruction, and let the current tool finish.",
    expected:
      "The correction changes direction after the current tool completes; the later instruction waits until current work ends, and the two timestamps and meanings remain distinguishable.",
    positiveControl:
      "Both messages are recorded with their delivery mode and are applied at the intended boundary in order.",
    negativeControl:
      "The correction does not abort the running tool mid-flight, and the queued instruction does not execute early or twice.",
    quickstart: ["QS-02.5"],
    capabilities: ["run_control", "message_ordering"],
  },
  {
    id: "UAT-07",
    suite: "uat",
    stage: "stable",
    prepare:
      "Connect two independent GUI clients to one workspace and synchronize a barrier before either may start the task.",
    action:
      "Trigger Start from both clients at the same barrier and observe both responses and the run list.",
    expected:
      "Exactly one active Run and one execution exist; the losing client sees the current run state instead of a duplicate success.",
    positiveControl:
      "One request wins and the other returns or displays the existing active Run with the same run id.",
    negativeControl:
      "Only one run id and one execution record exist, with no duplicate agent, tool, or external side effect.",
    quickstart: ["QS-02.5"],
    capabilities: ["concurrency", "single_active_run"],
  },
  {
    id: "UAT-08",
    suite: "uat",
    stage: "stable",
    prepare:
      "Keep a long Run active, invite a second member to prepare a handoff, and generate a handoff summary before acceptance.",
    action: "The receiver accepts the handoff while the original operator remains connected.",
    expected:
      "The summary is complete, the receiver becomes operator, the original operator loses control, and the Run neither stops nor restarts.",
    positiveControl:
      "An operator-handoff event increments the operator epoch while the run id, worker, and current tool remain unchanged.",
    negativeControl:
      "Commands from the old operator are rejected after acceptance and no new Run is created.",
    quickstart: ["QS-04.1"],
    capabilities: ["handoff", "operator_epoch"],
  },
  {
    id: "UAT-09",
    suite: "uat",
    stage: "stable",
    prepare:
      "Start a Run, disconnect the operator, and keep a second member ready to request takeover while task status remains visible.",
    action:
      "Attempt takeover before two minutes, wait until after two minutes, request takeover, then reconnect the original operator.",
    expected:
      "Operator status is separate from task status; takeover is unavailable before the threshold, succeeds after it, and the reconnecting former operator does not regain control automatically.",
    positiveControl:
      "The post-threshold takeover succeeds once with an operator epoch and audit record.",
    negativeControl:
      "The early request is denied, and the reconnected client cannot issue control commands without a new handoff.",
    quickstart: ["QS-04.4"],
    capabilities: ["offline_operator", "takeover"],
  },
  {
    id: "UAT-10",
    suite: "uat",
    stage: "stable",
    prepare:
      "Record the initial SHA-256 of file F and zero external calls, then create a high-risk write request whose approval summary binds the target, body, and recipient.",
    action:
      "Request the action without approval, inspect F and the counter, approve the original digest, and execute once.",
    expected:
      "File hash and external count stay unchanged before approval; approval is bound to the original summary and the approved action executes exactly once.",
    positiveControl:
      "The approved write changes F once and produces one approval and Permit audit record.",
    negativeControl:
      "A request whose target or body was altered after approval is rejected and leaves F and the counter unchanged.",
    quickstart: ["QS-03.1", "QS-03.2"],
    capabilities: ["approval", "digest_binding", "file_side_effect"],
  },
  {
    id: "UAT-11",
    suite: "uat",
    stage: "stable",
    prepare:
      "Create a pending high-risk action with fixed file hash and external counter, plus four separate clients for rejection, timeout, page close, and network loss.",
    action:
      "Reject the action, let another approval expire, close the page on a third, and disconnect the fourth before approval.",
    expected:
      "No action takes effect; rejected, timed-out, closed, and disconnected states remain distinguishable, and both operator and agent receive feedback with searchable history.",
    positiveControl: "A separate unchanged request that receives a valid approval executes once.",
    negativeControl:
      "All four non-approval paths leave the file hash and external count unchanged and never record success.",
    quickstart: ["QS-03.1"],
    capabilities: ["approval", "failure_states", "no_side_effect"],
  },
  {
    id: "UAT-12",
    suite: "uat",
    stage: "stable",
    prepare:
      "Upload a source document into a workspace and define a task that will generate a derived artifact with a known author and run id.",
    action: "Run the agent to produce the artifact and inspect the input and output records.",
    expected:
      "Inputs and outputs are classified separately, and source, author, linked task, version, and hash are visible for both.",
    positiveControl:
      "The artifact manifest links the output digest to the run, author, and source document digest.",
    negativeControl:
      "An output cannot claim provenance that lacks a recorded source, author, or task link, and the unshared source is not listed.",
    quickstart: ["QS-02.3", "QS-02.4"],
    capabilities: ["artifact_provenance", "source_lineage"],
  },
  {
    id: "UAT-13",
    suite: "uat",
    stage: "stable",
    prepare:
      "Connect a client at a known event cursor, disconnect it, then create accepted operations and unrelated state changes.",
    action: "Reconnect and resume the event stream from the stored cursor.",
    expected:
      "The client first warns that content may be stale, then synchronizes the main offline changes without repeating accepted operations.",
    positiveControl:
      "Replay from the cursor shows each missed change once and recognized commands return their existing receipts.",
    negativeControl:
      "No accepted operation is executed twice and the client does not silently jump to the latest state without the stale warning.",
    quickstart: ["QS-02.5"],
    capabilities: ["reconnect", "event_replay", "idempotency"],
  },
  {
    id: "UAT-14",
    suite: "uat",
    stage: "stable",
    prepare:
      "Start a Run that has entered a tool or external write, then kill the Runner or worker while the outcome is still uncertain.",
    action:
      "Restart the affected component and inspect the task outcome and last recorded progress.",
    expected:
      "The task enters manual confirmation, preserves the last progress, avoids a definite success or failure claim, and does not recommend an automatic retry.",
    positiveControl:
      "The recovered task shows an unknown-outcome state with the last event, affected operation, and confirmation prompt.",
    negativeControl:
      "Recovery does not replay the operation, does not report success or failure as certain, and does not create a second side effect.",
    quickstart: ["QS-03.4"],
    capabilities: ["crash_recovery", "unknown_outcome"],
  },
  {
    id: "UAT-15",
    suite: "uat",
    stage: "stable",
    prepare:
      "Start a task with one active instruction and two queued instructions that have not begun.",
    action: "Stop the task and inspect the active and queued items.",
    expected:
      "The current task stops, both queued items remain withheld without automatic execution, and the user can handle each item individually.",
    positiveControl:
      "The stop event is recorded, the active Run ends, and both queued items remain visible with a withheld state.",
    negativeControl:
      "No queued instruction starts after the stop and no replacement Run is created automatically.",
    quickstart: ["QS-03.4"],
    capabilities: ["run_control", "queue_retention"],
  },
  {
    id: "UAT-16",
    suite: "uat",
    stage: "stable",
    prepare:
      "Let the agent finish a task and claim completion while the business outcome has not been confirmed by a human.",
    action:
      "Record the agent claim, then have the user choose completed, partially completed, not completed, failed, and cancelled in separate trials.",
    expected:
      "The agent claim never triggers business completion; only the human decision sets the outcome, and each choice is recorded.",
    positiveControl:
      "Each human decision is stored with actor, timestamp, and optional reason and replaces the awaiting-confirmation state.",
    negativeControl:
      "Without a human decision the task remains awaiting confirmation, and an agent message cannot set any terminal business state.",
    quickstart: ["QS-03.4"],
    capabilities: ["human_confirmation", "outcome_state"],
  },
  {
    id: "UAT-17",
    suite: "uat",
    stage: "stable",
    prepare:
      "Complete a workspace with several artifacts, a manifest, one intentionally missing object, one truncated object, and one unknown object.",
    action:
      "Archive the workspace, attempt an edit, export the archive, and read it with a generic archive reader.",
    expected:
      "The archived workspace is read-only; the archive is independently readable; artifacts correspond to the manifest; missing, truncated, and unknown entries are prominent.",
    positiveControl:
      "The exported manifest verifies known artifact hashes and marks the missing, truncated, and unknown entries explicitly.",
    negativeControl:
      "Editing or starting a new Run in the archived workspace is rejected, and no missing artifact is silently reported as complete.",
    quickstart: ["QS-05.3", "QS-05.4"],
    capabilities: ["archive", "export", "manifest_integrity"],
  },
  {
    id: "UAT-18",
    suite: "uat",
    stage: "stable",
    prepare:
      "Prepare restricted workspace content and three principals: a non-member, a removed member, and a member without the required permission.",
    action:
      "Each principal attempts a direct link, search, timeline request, crafted error path, download, and export.",
    expected:
      "Every channel denies content and execution rights without revealing restricted ids, paths, or bytes.",
    positiveControl:
      "A properly authorized member receives only the permitted view and permitted download.",
    negativeControl:
      "All unauthorized channel results are redacted and contain no restricted body, file path, or operable command.",
    quickstart: ["QS-02.5"],
    capabilities: ["authorization", "redaction", "side_channel"],
  },
  {
    id: "UAT-19",
    suite: "uat",
    stage: "stable",
    prepare:
      "Create a workspace with one missing-evidence conclusion, one invalidated conclusion, and one conclusion pending review.",
    action:
      "Attempt to mark the workspace complete, then try adding evidence, recording partial completion, and recording an owner exception.",
    expected:
      "Completion is blocked with a prompt; evidence can be added, partial completion is allowed, and an owner exception is recorded with its risk and trace.",
    positiveControl:
      "The owner exception records actor, reason, timestamp, and affected criteria and is not counted as full evidence coverage.",
    negativeControl:
      "No completion state is set while evidence is missing, invalid, or pending, and no exception is silently applied.",
    quickstart: ["QS-05.3"],
    capabilities: ["completion_gate", "evidence_review", "exception_trace"],
  },
  {
    id: "UAT-20",
    suite: "uat",
    stage: "stable",
    prepare:
      "Bind one shared source to a conclusion, a completion criterion, an artifact, and a pending external action, then update, replace, and revoke that source.",
    action:
      "Update the source, replace it with a new version, and revoke it while inspecting every dependent.",
    expected:
      "All direct dependents enter pending review; the impact list covers criteria, artifacts, and later actions; no business action is automatically reversed.",
    positiveControl:
      "Each review record shows the previous and new source digest plus the complete affected set.",
    negativeControl:
      "No external action is automatically undone, no artifact is deleted, and dependents do not remain silently valid.",
    quickstart: ["QS-05.2"],
    capabilities: ["source_invalidation", "impact_analysis", "review"],
  },
  {
    id: "UAT-21",
    suite: "uat",
    stage: "stable",
    prepare:
      "Create two authoritative-looking sources that contradict each other and attach both to one conclusion.",
    action:
      "Open the conclusion and review the conflicting evidence before choosing any resolution.",
    expected:
      "Both sources are shown side by side with their origins, no side is auto-selected, and the conflict review history is complete.",
    positiveControl:
      "The conflict view lists both source ids, digests, timestamps, and the pending decision with no winner preselected.",
    negativeControl:
      "The system does not mark either source as selected or final, and does not hide one source from the reviewer.",
    quickstart: ["QS-05.2"],
    capabilities: ["conflict_review", "source_provenance"],
  },
  {
    id: "UAT-22",
    suite: "uat",
    stage: "stable",
    prepare:
      "Put a receiver into private preparation mode with private Q&A and a shared main task, then prepare requests for a private source, tool, approval, and file write.",
    action:
      "Ask the private questions and submit each overreach request while observing the shared timeline and main task.",
    expected:
      "Private answers stay out of the public timeline, the main task continues, and the receiver cannot control the task, approve, execute tools, or write files.",
    positiveControl:
      "A question about an authorized source returns a sourced answer visible only to the receiver.",
    negativeControl:
      "No preparation-stage tool, file, approval, or publication side effect occurs and no private answer enters shared or model-visible content.",
    quickstart: ["QS-04.2"],
    capabilities: ["private_preparation", "authorization"],
  },
  {
    id: "UAT-23",
    suite: "uat",
    stage: "stable",
    prepare:
      "Open a receiver preparation view, then change the workspace goal, risk level, and blocker from another client.",
    action:
      "Refresh the preparation view after the changes and attempt to accept the stale view without refreshing.",
    expected:
      "The receiver sees a changed-background warning with the change time and can refresh; stale content cannot be accepted as current.",
    positiveControl: "The refreshed view shows the new goal, risk, blocker, and their timestamps.",
    negativeControl:
      "The stale view is rejected or clearly marked stale and does not record background acknowledgement as if it were current.",
    quickstart: ["QS-04.3"],
    capabilities: ["preparation_freshness", "change_notice"],
  },
  {
    id: "UAT-24",
    suite: "uat",
    stage: "stable",
    prepare:
      "Create a private agent answer and a draft clarification, with two possible publish scopes.",
    action: "Edit the draft, choose a publish scope, publish it, and inspect shared facts.",
    expected:
      "The draft is editable before publication, the chosen scope is honored, and the private agent answer does not become a confirmed shared fact by itself.",
    positiveControl:
      "The published clarification is attributed, versioned, and visible only in the selected scope.",
    negativeControl:
      "The private answer remains private and no content is published outside the selected scope without a new action.",
    quickstart: ["QS-04.3"],
    capabilities: ["clarification", "publish_scope", "private_content"],
  },
  {
    id: "UAT-25",
    suite: "uat",
    stage: "stable",
    prepare:
      "Use a fresh personal configuration without a team, fix file F hash and external counter, and prepare one write tool that requires approval.",
    action:
      "Complete a task through the GUI while denying one write request and approving another unchanged request.",
    expected:
      "No team is required; the denied branch leaves F unchanged; the approved branch executes once and records approval plus a single-use Permit.",
    positiveControl:
      "The approved write changes F once and the audit includes the approval decision and consumed Permit.",
    negativeControl:
      "The denied write leaves F unchanged, consumes no Permit, and produces no second execution.",
    quickstart: ["QS-01.1", "QS-01.2"],
    capabilities: ["personal_workspace", "approval", "write_tool"],
  },
  {
    id: "UAT-26",
    suite: "uat",
    stage: "stable",
    prepare:
      "Create two workspaces with distinct history, work files, and artifacts, then close the GUI and restart the Runner.",
    action: "Reopen the recent-session surface and continue the intended workspace after restart.",
    expected:
      "The intended workspace and its history, work files, and artifacts remain available and continue correctly; no session resumes in the wrong workspace.",
    positiveControl:
      "Reopened files and artifacts match their pre-restart hashes and the session points at the expected workspace id.",
    negativeControl:
      "The recent list never opens the other workspace context, and a deleted or missing object is flagged rather than silently recreated.",
    quickstart: ["QS-01.3"],
    capabilities: ["restart", "history_restore", "workspace_binding"],
  },
  {
    id: "UAT-27",
    suite: "uat",
    stage: "stable",
    prepare:
      "Create a personal task containing a credential canary, a preference, a private draft, and normal history, context, evidence, and artifacts.",
    action: "Preview sharing and select only the normal records before creating the shared copy.",
    expected:
      "Only selected content enters the shared workspace with provenance; credentials, preferences, drafts, and unselected content remain invisible.",
    positiveControl:
      "The selected record is visible in the shared workspace with a source reference back to the personal item.",
    negativeControl:
      "Canary, preference, draft, and unselected content are absent from shared events, search, downloads, exports, and the original pi session is not copied.",
    quickstart: ["QS-02.1"],
    capabilities: ["selective_sharing", "secret_exclusion", "provenance"],
  },
  {
    id: "UAT-28",
    suite: "uat",
    stage: "stable",
    prepare:
      "Configure a GUI-only validation environment with member roles, a write tool, an approval fixture, and evidence records, with no terminal use allowed after setup.",
    action:
      "Use only the GUI to invite members, send an instruction, approve, hand off, review evidence, and archive.",
    expected:
      "Every step completes without a terminal, with the same state and audit results as the corresponding direct operation.",
    positiveControl:
      "Each GUI action produces the expected state change and an attributed audit record.",
    negativeControl:
      "No step requires a hidden CLI command, raw database edit, or manual file manipulation to reach completion.",
    quickstart: ["QS-02.1", "QS-02.2", "QS-02.3", "QS-02.4", "QS-02.5"],
    capabilities: ["gui_only", "end_to_end", "audit"],
  },
  {
    id: "UAT-29",
    suite: "uat",
    stage: "stable",
    prepare:
      "Use a supported clean host, a documented backup, and two Runner versions with a restore target directory.",
    action:
      "Install, restart, upgrade after taking a backup, restore into an empty directory, and verify the manifest.",
    expected:
      "The documentation is sufficient; restart and upgrade do not silently clear history or files; upgrade requires a backup; the restore is verifiable.",
    positiveControl:
      "Restored manifest digests match the backup and the restored workspace opens with its artifacts.",
    negativeControl:
      "An upgrade without a required backup is blocked or clearly warns, and a restore with missing objects reports them instead of presenting an empty success.",
    quickstart: ["QS-01.3", "QS-01.4"],
    capabilities: ["install", "upgrade", "backup_restore"],
  },
  {
    id: "UAT-30",
    suite: "uat",
    stage: "stable",
    prepare:
      "Connect two independent GUI clients to the same Runner with different draft text and display preferences.",
    action:
      "Edit drafts and preferences in both clients, perform one key state change, and attempt an unauthorized access from one client.",
    expected:
      "Drafts and display preferences remain independent, key workspace state stays consistent, and unauthorized access is rejected.",
    positiveControl:
      "The key state change converges in both clients and each client keeps its own draft and display settings.",
    negativeControl:
      "The other client cannot see the first draft or preference, and the unauthorized request returns no protected content.",
    quickstart: ["QS-02.5"],
    capabilities: ["multi_client", "preference_isolation", "authorization"],
  },
  {
    id: "UAT-31",
    suite: "uat",
    stage: "stable",
    prepare:
      "Assemble release artifacts, the MIT license, the third-party inventory, the SBOM, and the design-provenance references for inspection.",
    action:
      "Review every license, third-party entry, and visual or code provenance against the release contents.",
    expected:
      "MIT and third-party notices are complete; no unlicensed PI-Desktop code, assets, or recognizable visual reproduction is present.",
    positiveControl:
      "Each shipped package or asset has a matching license and provenance entry with a resolvable source.",
    negativeControl:
      "A copied code sample, asset, or recognizable visual element without a license or provenance record is flagged and blocks release.",
    quickstart: ["QS-06"],
    capabilities: ["license_compliance", "design_provenance", "release_review"],
  },

  // Federated Beta B0 UAT-32..42, 49..51, 55, 57, 59, 60
  {
    id: "UAT-32",
    suite: "uat",
    stage: "beta-b0",
    prepare:
      "Prepare a fresh team, an existing upgraded team, and a restart of an existing deployment, each with Beta disabled and node request logging enabled.",
    action:
      "Inspect the default Beta state, node resource requests, and upgrade result in all three deployments.",
    expected:
      "Beta is off by default, no node resource is requested, and upgrading does not enable Beta automatically.",
    positiveControl:
      "An explicit owner enable action changes only the Beta flag and still requests no resource before a Grant exists.",
    negativeControl:
      "No deployment enables Beta, starts a node request, or creates a Grant without the explicit enable action.",
    quickstart: ["QS-07.1"],
    capabilities: ["beta_default_off", "upgrade_safety"],
  },
  {
    id: "UAT-33",
    suite: "uat",
    stage: "beta-b0",
    prepare:
      "Create valid team, workspace, node, resource, and owner Grant records, then remove one applicable layer in separate trials.",
    action:
      "Request the same snapshot with each missing layer and finally with every layer plus the specific Grant present.",
    expected:
      "Any missing applicable layer rejects the request; only the complete valid stack with the specific Grant allows the read.",
    positiveControl: "The complete stack returns the authorized snapshot entry and digest.",
    negativeControl: "Each missing-layer trial returns a specific denial and zero resource bytes.",
    quickstart: ["QS-07.3"],
    capabilities: ["beta_layers", "grant_scope"],
  },
  {
    id: "UAT-34",
    suite: "uat",
    stage: "beta-b0",
    prepare:
      "Pair two nodes with a valid code, keep a replay client, prepare a replacement public key, and give the owner a revocation control.",
    action:
      "Complete one valid pairing, replay the code, replace the public key, and revoke the node while checking resource access.",
    expected:
      "Valid pairing grants no resource contribution, replay and key replacement fail, and the owner can revoke with visible status.",
    positiveControl:
      "The owner sees the node as revoked and the node cannot obtain a new Grant after revocation.",
    negativeControl:
      "The replayed code and replaced key never establish a trusted pairing, and the revoked node is denied.",
    quickstart: ["QS-07.2"],
    capabilities: ["pairing", "revocation", "node_identity"],
  },
  {
    id: "UAT-35",
    suite: "uat",
    stage: "beta-b0",
    prepare:
      "Prepare a central administrator, a workspace lead, and the resource owner, with a valid node and resource but no owner signature.",
    action:
      "Have the administrator and lead attempt to grant access, then have the owner sign an exact Grant.",
    expected:
      "Only the owner-signed Grant is effective at the node; administrator and lead cannot open the resource.",
    positiveControl:
      "The owner-signed Grant authorizes the exact read and returns the pinned snapshot entry.",
    negativeControl:
      "Administrator and lead Grants are rejected locally before any file is opened.",
    quickstart: ["QS-07.3"],
    capabilities: ["owner_authority", "local_denial"],
  },
  {
    id: "UAT-36",
    suite: "uat",
    stage: "beta-b0",
    prepare:
      "Create a short-lived owner Grant naming one resource, one read operation, one recipient, one snapshot version, and a fixed expiry.",
    action:
      "Execute the positive read within scope, then try another resource, operation, recipient, version, and an expired copy.",
    expected:
      "Only the granted resource, operation, and recipient can read; the content version and hash remain pinned.",
    positiveControl:
      "The authorized read returns exactly the snapshot entry digest recorded in the Grant.",
    negativeControl: "Every out-of-scope or expired variation is denied with no returned bytes.",
    quickstart: ["QS-07.4"],
    capabilities: ["read_grant", "scope_binding", "expiry"],
  },
  {
    id: "UAT-37",
    suite: "uat",
    stage: "beta-b0",
    prepare:
      "Create a sealed snapshot containing an in-range file, an outside canary, a symlink to the canary, a sibling path, and a TOCTOU replacement target.",
    action:
      "Request absolute paths, parent traversal, the symlink, the sibling, and a replaced file through the node reader.",
    expected:
      "Outside bytes are never opened or returned; each denial has a receipt and does not leak the restricted path.",
    positiveControl: "The in-range file returns its manifest digest and exact bytes.",
    negativeControl:
      "The outside canary is never read and every denial message omits the outside path.",
    quickstart: ["QS-08.1"],
    capabilities: ["path_confinement", "toctou", "denial_receipt"],
  },
  {
    id: "UAT-38",
    suite: "uat",
    stage: "beta-b0",
    prepare:
      "Authenticate with a valid central identity but issue a request that exceeds the local resource and operation scope.",
    action: "Ask the node to read an out-of-scope file and start an out-of-scope operation.",
    expected:
      "The node rejects before any file open or process start; central authentication does not replace a local owner Grant.",
    positiveControl:
      "A locally signed exact Grant allows the same request and records its execution.",
    negativeControl:
      "No file descriptor is opened and no process starts for the unauthorized request.",
    quickstart: ["QS-07.3"],
    capabilities: ["central_identity", "local_denial"],
  },
  {
    id: "UAT-39",
    suite: "uat",
    stage: "beta-b0",
    prepare:
      "Grant read access but no model-disclosure recipient, and attach a faux model that records every received payload.",
    action:
      "Attempt to send the original, a summary, an error, and an artifact reference to the model.",
    expected:
      "No effective payload reaches the model; a separate explicit egress Grant is required.",
    positiveControl:
      "A separate model Grant naming the exact model recipient delivers only the authorized payload.",
    negativeControl:
      "The faux model records zero effective bytes for every path without the egress Grant.",
    quickstart: ["QS-08.2"],
    capabilities: ["read_grant", "model_egress", "payload_observation"],
  },
  {
    id: "UAT-40",
    suite: "uat",
    stage: "beta-b0",
    prepare: "Create restricted content with a canary and a member who has no entitlement to it.",
    action:
      "Search the timeline, inspect parameters, trigger errors, read logs, export, and run analysis while scanning each output.",
    expected: "No channel exposes restricted body, path, or parameters to the unauthorized member.",
    positiveControl:
      "An entitled member sees only the permitted redacted detail for the same content.",
    negativeControl:
      "Every unauthorized channel contains zero canary occurrences and no restricted path or parameter value.",
    quickstart: ["QS-08.5"],
    capabilities: ["member_visibility", "side_channel", "canary_scan"],
  },
  {
    id: "UAT-41",
    suite: "uat",
    stage: "beta-b0",
    prepare:
      "Place untrusted content in node A containing instructions to read node B, send data to a model, and write to node C.",
    action: "Process the content in A and observe whether B, the model, or C is contacted.",
    expected:
      "The attempts form new GrantProposal requests, are blocked by default, and any related conclusion is marked pending review.",
    positiveControl:
      "After the owner approves an exact B read, that single proposal becomes executable and the review record is visible.",
    negativeControl:
      "No automatic B read, model egress, or C write occurs and no target or permission is inherited from A.",
    quickstart: ["QS-08.3"],
    capabilities: ["prompt_injection", "grant_proposal", "review"],
  },
  {
    id: "UAT-42",
    suite: "uat",
    stage: "beta-b0",
    prepare:
      "Create two sources with different restrictions and derive one result that carries both.",
    action: "Attempt a non-owner downgrade, then have all relevant owners review one narrow scope.",
    expected:
      "The derived result inherits the strictest limit per dimension; only the fully reviewed specific scope may be relaxed.",
    positiveControl:
      "After every required owner signs, the reviewed scope is allowed and the remaining dimensions stay strict.",
    negativeControl:
      "One owner or a partial review cannot downgrade any dimension and the merged label keeps every prohibition.",
    quickstart: ["QS-08.4"],
    capabilities: ["derived_label", "downgrade_review", "strictest_intersection"],
  },
  {
    id: "UAT-49",
    suite: "uat",
    stage: "beta-b0",
    prepare:
      "Authorize and seal a snapshot, then change the live file and add a new directory after sealing.",
    action:
      "Read the old snapshot, request the changed file, and request the new directory without a new owner decision.",
    expected:
      "The old snapshot stays unchanged; changed and new content require a new owner-approved snapshot and are not added implicitly.",
    positiveControl:
      "An owner-sealed new snapshot contains the new directory and exposes its new manifest digest.",
    negativeControl:
      "The old snapshot still returns the old hash and the new directory is absent until the owner approves a fresh snapshot.",
    quickstart: ["QS-08.1"],
    capabilities: ["snapshot_immutability", "owner_decision"],
  },
  {
    id: "UAT-50",
    suite: "uat",
    stage: "beta-b0",
    prepare:
      "Create one Grant with caching denied and another with caching allowed for the same resource, then take the node offline before expiry.",
    action:
      "Attempt an offline read under each policy, then change the recipient and let the Grant expire in separate trials.",
    expected:
      "Without cache permission the read stops; with permission it works only for the original recipient and expiry, and never fabricates success.",
    positiveControl:
      "The permitted cache read within the original recipient and window returns the pinned snapshot entry.",
    negativeControl:
      "Uncached, expired, or wrong-recipient offline reads return unavailable with no bytes or fabricated result.",
    quickstart: ["QS-08.5"],
    capabilities: ["cache_policy", "offline_read", "recipient_binding"],
  },
  {
    id: "UAT-51",
    suite: "uat",
    stage: "beta-b0",
    prepare:
      "Create an active Grant and an in-flight operation, record its status, then expire and revoke the Grant in separate trials.",
    action:
      "Replay the old ticket after expiry and after revocation, and inspect the in-flight operation.",
    expected:
      "New access stops immediately; the in-flight operation safely stops or is marked unknown; history remains without a promise to recall lawful copies.",
    positiveControl: "A read completed before expiry is recorded and remains in history.",
    negativeControl:
      "Post-expiry and post-revocation replays are denied and create no new external side effect.",
    quickstart: ["QS-07.4"],
    capabilities: ["revocation", "in_flight", "history_retention"],
  },
  {
    id: "UAT-55",
    suite: "uat",
    stage: "beta-b0",
    prepare:
      "Start a node with an owner pause control, an isolate control, and separate administrator and lead sessions.",
    action:
      "Have the owner pause and isolate the node, then have the administrator and lead attempt remote release.",
    expected:
      "The owner action takes effect immediately; neither administrator nor lead can remotely clear the local pause or isolation.",
    positiveControl:
      "The owner can release the pause locally after a local policy check and the node then resumes authorized reads.",
    negativeControl:
      "Remote release attempts leave the local node state unchanged and do not restore access.",
    quickstart: ["QS-07.5"],
    capabilities: ["owner_isolation", "local_control", "role_limits"],
  },
  {
    id: "UAT-57",
    suite: "uat",
    stage: "beta-b0",
    prepare:
      "Run a malicious node that signs a false success and contradictory receipts alongside one honest node.",
    action: "Verify and display both results while attempting isolation and review.",
    expected:
      "The system confirms only the signing source, not the truth of the claim; the malicious node can be isolated and reviewed without exposing other nodes.",
    positiveControl:
      "The honest node receipt verifies its content chain and is displayed as source-authenticated.",
    negativeControl:
      "The false success is never marked true or verified, and isolation does not expand access to any other node.",
    quickstart: ["QS-08.5"],
    capabilities: ["malicious_node", "receipt_verification", "isolation"],
  },
  {
    id: "UAT-59",
    suite: "uat",
    stage: "beta-b0",
    prepare:
      "Create existing Beta Grants and cached state, keep Stable fixtures available, then prepare an upgrade and an administrative Beta disable.",
    action:
      "Upgrade the deployment, disable Beta, and test existing Grants, new Beta access, Stable operations, and legal export.",
    expected:
      "Existing Grants do not gain scope; disabling Beta blocks new access; Stable features and lawful export remain available.",
    positiveControl:
      "A valid pre-disable read still works within its original scope, and Stable operations and export continue.",
    negativeControl:
      "New Beta access after disable is denied and the upgrade grants no additional resource or model scope.",
    quickstart: ["QS-07.5"],
    capabilities: ["beta_shutdown", "upgrade_safety", "stable_continuity"],
  },
  {
    id: "UAT-60",
    suite: "uat",
    stage: "beta-b0",
    prepare:
      "Record an old Grant and nonce that have already expired or been revoked, plus a fixed external counter.",
    action:
      "Replay the old Grant and nonce, restart the client, server, and node, then replay again.",
    expected:
      "The old authorization remains denied across restarts, no permission revives, and no duplicate side effect appears.",
    positiveControl: "A fresh valid Grant created after restart executes the same operation once.",
    negativeControl:
      "The old Grant and nonce are rejected after every restart and the external counter does not change.",
    quickstart: ["QS-07.4"],
    capabilities: ["replay", "restart", "revocation"],
  },

  // Federated Beta B1 UAT-43..48, 52..54, 56, 58
  {
    id: "UAT-43",
    suite: "uat",
    stage: "beta-b1",
    prepare:
      "Create source and recipient domains, an Artifact with a security label, and separate source-owner and recipient approvals.",
    action:
      "Request a cross-node Artifact transfer and inspect the transfer metadata and approvals before accepting.",
    expected:
      "Source, destination, content type, quantity, recipient, and task reason are clear, and every required approval is complete before transfer.",
    positiveControl:
      "The approved transfer delivers exactly one Artifact with matching digest and records both approval decisions.",
    negativeControl:
      "A missing approval or a source label that forbids destination propagation sends zero payload.",
    quickstart: ["QS-09.2"],
    capabilities: ["cross_domain_artifact", "artifact_transfer", "approval"],
  },
  {
    id: "UAT-44",
    suite: "uat",
    stage: "beta-b1",
    prepare:
      "Register a fixed tool template and create a Grant that binds parameters, working directory, output recipient, and budget.",
    action:
      "Run the registered tool with only the allowed parameters and inspect its output handling.",
    expected:
      "Parameters, working directory, output, recipient, and budget all stay within the Grant and results follow policy.",
    positiveControl:
      "One execution completes with the allowed parameter values and a result digest recorded against the Grant.",
    negativeControl:
      "An extra parameter or a working directory outside the Grant is denied without starting a process.",
    quickstart: ["QS-09.1"],
    capabilities: ["fixed_tool_execution", "grant_scope", "resource_budget"],
  },
  {
    id: "UAT-45",
    suite: "uat",
    stage: "beta-b1",
    prepare:
      "Use the fixed tool template and prepare arbitrary Shell, command chaining, extra argv, and a replaced executable in separate requests.",
    action:
      "Submit each variant through the same tool surface and observe processes, files, and network access.",
    expected:
      "All variants are rejected with no extra process or side effect; a fixed-tool wrapper cannot authorize them.",
    positiveControl: "The exact declared template and parameters still execute once within budget.",
    negativeControl:
      "No extra process, file write, or network request occurs, and a changed executable digest is rejected.",
    quickstart: ["QS-09.1"],
    capabilities: ["fixed_tool_execution", "argv_confinement", "injection"],
  },
  {
    id: "UAT-46",
    suite: "uat",
    stage: "beta-b1",
    prepare:
      "Prepare a sandbox probe for environment variables, credential files, mounts, network sockets, and the Docker socket, then run twice.",
    action:
      "Inspect each resource from inside two consecutive fixed-tool executions and inspect residue after they end.",
    expected:
      "Unauthorized environment, credentials, mounts, network, and Docker socket are inaccessible; consecutive runs leave no residue.",
    positiveControl:
      "The tool can write only its declared output file inside the working scope and read only declared input.",
    negativeControl:
      "Host secrets, Docker socket, network, and extra mounts are absent in both runs, and no temporary state remains.",
    quickstart: ["QS-09.2"],
    capabilities: ["fixed_tool_execution", "sandbox_isolation", "residue_check"],
  },
  {
    id: "UAT-47",
    suite: "uat",
    stage: "beta-b1",
    prepare:
      "Set explicit CPU, memory, process, duration, and output budgets for a fixed tool and configure owner and operator notifications.",
    action: "Exhaust each budget in turn and let one execution time out while attempting new work.",
    expected:
      "New work is stopped or rejected, budgets are not raised automatically, policy remains enabled, and both owner and operator are notified.",
    positiveControl:
      "A fresh execution within every budget completes once after the exhaustion trials.",
    negativeControl:
      "No automatic budget increase or policy disable occurs and the over-budget execution does not continue.",
    quickstart: ["QS-09.2"],
    capabilities: ["fixed_tool_execution", "resource_budget", "budget_exhaustion"],
  },
  {
    id: "UAT-48",
    suite: "uat",
    stage: "beta-b1",
    prepare:
      "Create a base snapshot, a valid Patch proposal, a conflicting base digest, a path-escaping Patch, and an unauthorized application request.",
    action:
      "Generate the Patch, try conflict and escaping applications, then apply a separately approved Patch.",
    expected:
      "No write-back happens by default; source changes are reported as conflicts; a legal local application requires separate authorization and creates a new version and evidence.",
    positiveControl:
      "The authorized Patch creates a new file digest, new artifact version, and application evidence.",
    negativeControl:
      "The conflict, escaping, and unauthorized attempts leave the source files at zero writes and never overwrite silently.",
    quickstart: ["QS-09.3"],
    capabilities: ["patch_application", "patch_review", "path_confinement"],
  },
  {
    id: "UAT-52",
    suite: "uat",
    stage: "beta-b1",
    prepare:
      "Prepare one operation that has a side effect before recording and one after recording, with a controllable external counter and connection loss points.",
    action:
      "Disconnect or kill the worker before and after each side-effect point, reconnect, and replay the original request.",
    expected:
      "Both cases show an unknown result without automatic replay; the external side-effect count remains zero or one and never becomes two.",
    positiveControl:
      "A request whose receipt was durably recorded returns the same logical result on retry and keeps the count at one.",
    negativeControl:
      "No automatic retry produces a second external effect and the UI never shows a definite result for the unknown case.",
    quickstart: ["QS-09.4"],
    capabilities: ["fixed_tool_execution", "unknown_outcome", "side_effect_count"],
  },
  {
    id: "UAT-53",
    suite: "uat",
    stage: "beta-b1",
    prepare:
      "Create a Run with one read-only Grant and one high-risk Grant, plus private data visible only to the original operator, then begin a handoff.",
    action: "The receiver accepts the handoff and attempts both Grants and the private data.",
    expected:
      "The read-only Grant retains its original expiry, the high-risk Grant requires renewed confirmation, and private data is not inherited.",
    positiveControl:
      "The receiver uses the retained read Grant and, after confirming, uses the high-risk Grant with new approval evidence.",
    negativeControl:
      "Private data stays hidden and the high-risk action is denied until the receiver confirms it explicitly.",
    quickstart: ["QS-10.1"],
    capabilities: ["handoff", "read_grant", "high_risk_reconfirmation"],
  },
  {
    id: "UAT-54",
    suite: "uat",
    stage: "beta-b1",
    prepare:
      "Give the receiver access to one federated source while another source belongs only to a different owner and remains invisible to the receiver.",
    action:
      "Ask a question that would require the other-owned source and inspect the answer and model payload.",
    expected:
      "The system does not borrow another person's permission, states that part of the background is invisible, and keeps the permission boundary clear.",
    positiveControl:
      "A question about the receiver-visible source returns a sourced answer with its known scope.",
    negativeControl:
      "No borrowed content, id, or path appears in the answer or model payload, and the gap is stated explicitly.",
    quickstart: ["QS-10.1"],
    capabilities: ["handoff", "federated_source", "permission_boundary"],
  },
  {
    id: "UAT-56",
    suite: "uat",
    stage: "beta-b1",
    prepare:
      "Generate read, egress, propagation, execution, denial, and revocation receipts with one deliberately missing sequence number, then prepare an export.",
    action:
      "Inspect the audit chain and export the federation archive for reading in a generic viewer.",
    expected:
      "All actions are traceable; the missing sequence is a prominent gap; the archive covers nodes, snapshots, Grants, executions, and propagation states.",
    positiveControl:
      "The complete portion of the chain verifies and the exported archive preserves node, snapshot, Grant, execution, and propagation fields.",
    negativeControl:
      "The missing sequence is not hidden or counted as complete, and the export contains no unauthorized bytes.",
    quickstart: ["QS-10.4"],
    capabilities: ["receipt_integrity", "federation_export", "audit"],
  },
  {
    id: "UAT-58",
    suite: "uat",
    stage: "beta-b1",
    prepare:
      "Admit an external expert with an existing session, history access, and attributed contributions, then set the identity to expire.",
    action:
      "After expiry, attempt authentication, reuse the old session, read and operate on historical workspaces, and inspect contributions.",
    expected:
      "Identity, existing session, and historical read or operation access all terminate, while prior contribution attribution remains.",
    positiveControl:
      "The expert's earlier contribution still shows the original author and timestamp after expiry.",
    negativeControl:
      "Authentication, session reuse, history read, and workspace operations are all denied after expiry.",
    quickstart: ["QS-10.2"],
    capabilities: ["expert_exit", "session_revocation", "attribution"],
  },

  // Independent security oracles TO-01..13
  {
    id: "TO-01",
    suite: "to",
    stage: "stable",
    prepare:
      "Fix file F hash and external count at zero, create a real approval boundary for a write and external call, and prepare one unmodified valid approval.",
    action:
      "Attempt the action without approval, after rejection, after closing the page, after network loss, and after timeout, then run the valid approval.",
    expected:
      "F and the external count remain unchanged for every non-approval path; only the valid approval executes once.",
    positiveControl:
      "The valid approval changes F once and increments the external count exactly once.",
    negativeControl:
      "No bypass path changes F or calls the endpoint, and none records a successful action.",
    quickstart: ["QS-03.1"],
    capabilities: ["approval_bypass", "file_side_effect", "external_side_effect"],
  },
  {
    id: "TO-02",
    suite: "to",
    stage: "stable",
    prepare:
      "Approve action A0 with a fixed body, goal, and recipient summary, then prepare changed-body, changed-goal, and changed-recipient replays plus an unchanged control.",
    action:
      "Replay the original approval against each changed variant and then execute the unchanged control.",
    expected:
      "Every changed variant invalidates the old approval and requires a new decision; the unchanged control executes once.",
    positiveControl:
      "The unchanged body, goal, and recipient still match the approved digest and execute exactly once.",
    negativeControl:
      "No changed variant is accepted under the old approval and no external effect occurs for it.",
    quickstart: ["QS-03.2"],
    capabilities: ["approval_binding", "digest_binding", "replay"],
  },
  {
    id: "TO-03",
    suite: "to",
    stage: "stable",
    prepare:
      "Synchronize two clients for a concurrent start and two clients for a concurrent takeover, then keep the old operator ready to reconnect.",
    action:
      "Start concurrently, take over concurrently, reconnect the old operator, and attempt a control command.",
    expected:
      "There is one active Run and one new operator, with no duplicate side effect and no last-writer overwrite.",
    positiveControl:
      "The single winning start and takeover each record one operator epoch and the old operator receives the new state.",
    negativeControl:
      "The old operator cannot overwrite the new operator, and no second Run or duplicate execution exists.",
    quickstart: ["QS-02.5", "QS-04.4"],
    capabilities: ["concurrency", "takeover", "operator_epoch"],
  },
  {
    id: "TO-04",
    suite: "to",
    stage: "stable",
    prepare:
      "Execute an accepted operation with a known result, drop its response, and retain the original idempotency key and payload digest.",
    action:
      "Refresh and retry the same logical request, then retry a separate request whose result is unknown.",
    expected:
      "The known request recovers the same logical operation and result with exactly one external effect; the unknown request does not use automatic retry.",
    positiveControl:
      "The retried known request returns the stored receipt and the external count stays at one.",
    negativeControl:
      "The retry does not create a second execution, and the unknown result is not overwritten by an automatic retry.",
    quickstart: ["QS-03.3"],
    capabilities: ["idempotency", "receipt", "unknown_outcome"],
  },
  {
    id: "TO-05",
    suite: "to",
    stage: "stable",
    prepare:
      "Put a receiver in private preparation mode with access to one source and no access to a private secret, approval, tool, or publication path.",
    action:
      "Request the private source, tool execution, approval action, and public publication while monitoring the main task and public views.",
    expected:
      "The main task continues and no preparation-attributed tool, file, approval, or publication side effect exists; secrets never enter public views or analytics.",
    positiveControl:
      "An authorized question about the visible source returns a sourced private answer.",
    negativeControl:
      "Tool, file, approval, and publication calls have zero effects, and no secret appears in public or model-visible content.",
    quickstart: ["QS-04.2"],
    capabilities: ["private_preparation", "authorization", "secret_exclusion"],
  },
  {
    id: "TO-06",
    suite: "to",
    stage: "stable",
    prepare:
      "Bind one source to two conclusions, one completion criterion, one artifact, and one delivered external action, then invalidate the source.",
    action: "Observe every dependent and attempt completion, then record an owner exception.",
    expected:
      "All direct dependents enter review; decisions, artifacts, and external actions are not automatically overturned, deleted, or reversed; the exception preserves history.",
    positiveControl:
      "The review list includes the two conclusions, criterion, artifact, and external action with the new source state.",
    negativeControl:
      "No external action is undone, no artifact is removed, and the exception does not erase the prior audit trail.",
    quickstart: ["QS-05.2", "QS-05.3"],
    capabilities: ["source_invalidation", "impact_analysis", "exception_trace"],
  },
  {
    id: "TO-07",
    suite: "to",
    stage: "beta-b0",
    prepare:
      "Configure the central service to allow a read while the resource owner locally denies it, and prepare an exact owner Grant as a separate control.",
    action:
      "Request the read with the central allow and no owner Grant, then repeat with the exact owner Grant.",
    expected:
      "The node denies locally and no resource bytes leave; only the exact owner Grant succeeds.",
    positiveControl:
      "The exact owner Grant returns the pinned snapshot entry and records the local authorization.",
    negativeControl: "The central allow alone opens no file and emits no resource bytes.",
    quickstart: ["QS-07.3"],
    capabilities: ["local_denial", "owner_authority", "central_identity"],
  },
  {
    id: "TO-08",
    suite: "to",
    stage: "beta-b0",
    prepare:
      "Create a Grant and operation ticket, expire or revoke them, then prepare client, server, and node restarts.",
    action: "Replay the ticket before and after each restart and attempt a cache fallback.",
    expected:
      "The invalid decision persists across restarts, with no new access, no cache fallback, and no revived permission; history remains.",
    positiveControl: "A newly issued valid Grant after restart reads the allowed entry once.",
    negativeControl:
      "The old ticket is rejected after every restart and no cached bytes are returned.",
    quickstart: ["QS-07.4"],
    capabilities: ["replay", "restart", "revocation", "cache_policy"],
  },
  {
    id: "TO-09",
    suite: "to",
    stage: "beta-b0",
    prepare:
      "Create a real file-system snapshot with an in-scope file, an outside canary, symlinks, hard links, a mount point, and a replacement race.",
    action:
      "Drive path and link variants through the real reader and observe open/read attempts for the canary.",
    expected:
      "Only the fixed manifest version is returned; the outside canary is never opened or read, and errors do not reveal its path.",
    positiveControl: "The in-scope file returns exactly the manifest digest and byte length.",
    negativeControl:
      "The canary open/read count stays zero and every denial omits the outside path.",
    quickstart: ["QS-08.1"],
    capabilities: ["path_confinement", "toctou", "canary_observation"],
  },
  {
    id: "TO-10",
    suite: "to",
    stage: "beta-b0",
    prepare:
      "Create independent model-egress and member-visibility Grants with different recipients, plus an injected cross-domain instruction in source A.",
    action:
      "Send payloads to each recipient and follow the injected instruction toward a model, another member, or another domain.",
    expected:
      "Each permission permits only its exact recipient and payload; unauthorized network requests stay at zero; affected conclusions enter review.",
    positiveControl:
      "The model Grant delivers only to its named model, and the visibility Grant exposes only to its named member.",
    negativeControl:
      "No payload reaches an unnamed model or member, no unauthorized network request occurs, and no new domain is read.",
    quickstart: ["QS-08.2", "QS-08.3"],
    capabilities: ["model_egress", "member_visibility", "prompt_injection", "review"],
  },
  {
    id: "TO-11",
    suite: "to",
    stage: "beta-b0",
    prepare:
      "Merge a source that forbids egress with a source that allows it, then derive a result and prepare a partial owner approval.",
    action:
      "Try to downgrade the derived label with one owner, then obtain all required owner reviews for one narrow scope.",
    expected:
      "The derivative retains all sources and the prohibition; only the fully reviewed specific scope can be released.",
    positiveControl:
      "After all required owners review, the narrow scope is allowed and all other dimensions remain prohibited.",
    negativeControl:
      "A single-owner or partial review cannot release any scope and the complete source list remains attached.",
    quickstart: ["QS-08.4"],
    capabilities: ["derived_label", "downgrade_review", "strictest_intersection"],
  },
  {
    id: "TO-12",
    suite: "to",
    stage: "beta-b1",
    prepare:
      "Prepare one operation with a committed side effect and one without, both disconnected before the response returns, plus an external counter.",
    action:
      "Reconnect after each disconnection and replay the original request while observing the counter and UI state.",
    expected:
      "Both cases report an unknown result, recovery does not auto-retry, and the external side-effect total stays zero or one.",
    positiveControl:
      "A durably committed operation returns its stored result on retry and the counter remains one.",
    negativeControl:
      "No automatic retry adds a second external effect and the uncommitted case never reports a definite success or failure.",
    quickstart: ["QS-03.4", "QS-09.4"],
    capabilities: ["fixed_tool_execution", "unknown_outcome", "side_effect_count"],
  },
  {
    id: "TO-13",
    suite: "to",
    stage: "beta-b0",
    prepare:
      "Prepare Beta disabled, layered enable/disable states, an upgrade, and a component failure while keeping Stable tools, history, artifacts, and export available.",
    action:
      "Exercise Stable functionality throughout and attempt the Beta read with incomplete and complete layer/Grant stacks.",
    expected:
      "Stable tools, history, artifacts, and export continue; Beta succeeds only when every layer and its Grant are valid.",
    positiveControl:
      "The complete Beta stack reads the authorized snapshot, while Stable operations and export keep working.",
    negativeControl:
      "Beta off, a missing layer, upgrade, or component failure denies Beta access without disabling Stable features.",
    quickstart: ["QS-07.1", "QS-07.2", "QS-07.3", "QS-07.4", "QS-07.5"],
    capabilities: ["beta_gate", "stable_continuity", "upgrade_safety"],
  },

  // Federated adversarial tests T01..T20
  {
    id: "T01",
    suite: "t",
    stage: "beta-b0",
    prepare:
      "Create new, existing, and upgraded teams, then prepare each layer for separate enable and disable trials.",
    action:
      "Enable and disable layers individually while a non-owner administrator attempts to substitute an owner decision.",
    expected:
      "No resource is requested by default, any missing layer denies access, and an administrator cannot replace the owner.",
    positiveControl:
      "The fully enabled stack with the owner-signed Grant reads the permitted snapshot.",
    negativeControl:
      "Default, missing-layer, and administrator-only states create no resource request and return no bytes.",
    quickstart: ["QS-07.1", "QS-07.2", "QS-07.3"],
    capabilities: ["beta_gate", "owner_authority", "layer_completeness"],
  },
  {
    id: "T02",
    suite: "t",
    stage: "beta-b0",
    prepare:
      "Prepare a valid pairing code, a replay client, a replacement public key, a wrong team, and a revocation control.",
    action:
      "Attempt the valid pairing, replay the code, replace the key, choose the wrong team, and revoke the certificate.",
    expected:
      "Every anomaly fails; a successful pairing grants no resource call and opens no inbound listener; a revoked certificate cannot continue requests.",
    positiveControl:
      "The single valid pairing records the node identity and leaves resource access unavailable until a Grant exists.",
    negativeControl:
      "Replay, key replacement, and wrong-team attempts fail, and the revoked certificate receives no further response.",
    quickstart: ["QS-07.2"],
    capabilities: ["pairing", "revocation", "node_identity"],
  },
  {
    id: "T03",
    suite: "t",
    stage: "beta-b0",
    prepare:
      "Prepare a malicious coordinator that forges a Grant and expands the path, operation, and recipient fields beyond the owner's signature.",
    action:
      "Submit the forged Grant and each expanded field, then run the legitimate Grant as a control.",
    expected:
      "The node rejects every forged or expanded request before any file open or process start; only the legitimate control executes.",
    positiveControl:
      "The exact legitimate Grant opens the authorized file and records one execution.",
    negativeControl: "Forged and expanded Grants trigger no file open and no process start.",
    quickstart: ["QS-07.3"],
    capabilities: ["grant_forgery", "local_denial", "owner_authority"],
  },
  {
    id: "T04",
    suite: "t",
    stage: "beta-b0",
    prepare:
      "Create a valid nonce and Grant, then prepare a replayed nonce, a modified body, a cross-task copy, a cross-node copy, and a restart sequence.",
    action:
      "Submit each replay and modified variant, restart the components, and submit the original nonce again.",
    expected:
      "All variants fail; at most one execution record exists and no second external effect appears.",
    positiveControl:
      "A fresh nonce with the correct body and node executes once and records one effect.",
    negativeControl:
      "No replayed, modified, cross-task, or cross-node variant executes, including after restart.",
    quickstart: ["QS-07.4"],
    capabilities: ["nonce_replay", "restart", "side_effect_count"],
  },
  {
    id: "T05",
    suite: "t",
    stage: "beta-b0",
    prepare:
      "Seal a snapshot, change one live file, and add a directory after sealing while retaining the old manifest.",
    action:
      "Request the old snapshot before and after the live changes, then request the new directory.",
    expected:
      "Only the fixed manifest version is readable; the new snapshot requires an owner decision and new content is not added implicitly.",
    positiveControl:
      "An owner-sealed new snapshot returns the changed file and new directory with new digests.",
    negativeControl:
      "The old snapshot keeps the old hash and the new directory is absent until the owner seals it.",
    quickstart: ["QS-08.1"],
    capabilities: ["snapshot_immutability", "owner_decision"],
  },
  {
    id: "T06",
    suite: "t",
    stage: "beta-b0",
    prepare:
      "Create absolute-path, encoded-variant, symlink, hard-link, mount-point, and replacement-race probes around a sealed snapshot with an outside canary.",
    action: "Submit each probe through the reader and attempt the canary through every alias.",
    expected:
      "The outside canary is never opened or read; the legitimate snapshot entry remains verifiable.",
    positiveControl: "The in-scope entry returns its manifest digest and expected byte length.",
    negativeControl:
      "All path and link variants leave the canary open/read count at zero and leak no path.",
    quickstart: ["QS-08.1"],
    capabilities: ["path_confinement", "toctou", "canary_observation"],
  },
  {
    id: "T07",
    suite: "t",
    stage: "beta-b0",
    prepare:
      "Create one Grant without cache permission and one with it, then prepare offline and post-revocation reads.",
    action: "Read offline under each policy, revoke the Grant, and retry each read.",
    expected:
      "Without permission the read stops; with permission it remains bound to the original recipient and expiry; revocation blocks immediately.",
    positiveControl:
      "The permitted cache read inside its window returns the pinned entry for the original recipient.",
    negativeControl:
      "Unpermitted, revoked, or wrong-recipient reads return no bytes and no fabricated success.",
    quickstart: ["QS-08.5"],
    capabilities: ["cache_policy", "revocation", "recipient_binding"],
  },
  {
    id: "T08",
    suite: "t",
    stage: "beta-b0",
    prepare:
      "Grant only read access and attach a faux model that records original, summary, error, and Artifact payloads.",
    action:
      "Attempt each payload path to the model without a model Grant, then add a separate model Grant.",
    expected:
      "The faux model receives zero effective payload under read-only access; only the independent model Grant enables delivery.",
    positiveControl:
      "The separate model Grant delivers the exact approved payload to the named model.",
    negativeControl: "Read-only access produces zero model payload for every attempted form.",
    quickstart: ["QS-08.2"],
    capabilities: ["read_grant", "model_egress", "payload_observation"],
  },
  {
    id: "T09",
    suite: "t",
    stage: "beta-b0",
    prepare:
      "Insert a unique canary into restricted content and prepare an unauthorized member plus other roles with different permitted granularity.",
    action:
      "Search member views, request parameters, trigger errors, read logs, export, and run analysis for the canary.",
    expected:
      "The unauthorized member cannot see the canary at all; other roles see only the granularity they are authorized for.",
    positiveControl:
      "An authorized role sees only the permitted redacted representation without the raw canary.",
    negativeControl:
      "Unauthorized surfaces contain zero canary occurrences and no restricted path or parameter.",
    quickstart: ["QS-08.5"],
    capabilities: ["member_visibility", "canary_scan", "redaction"],
  },
  {
    id: "T10",
    suite: "t",
    stage: "beta-b0",
    prepare:
      "Place content in A that induces a B read, a model send, and a C write, with alternate tools and summaries for retries.",
    action:
      "Process the content repeatedly through different tools and summary paths while observing B, the model, C, and review state.",
    expected:
      "Every retry is blocked for the same unauthorized target, and the affected conclusion enters pending review.",
    positiveControl:
      "A separate owner-approved exact B read succeeds once and produces the expected review record.",
    negativeControl:
      "No retry reaches B, the model, or C without a new Grant, and no tool substitution changes the target.",
    quickstart: ["QS-08.3"],
    capabilities: ["prompt_injection", "grant_proposal", "review"],
  },
  {
    id: "T11",
    suite: "t",
    stage: "beta-b1",
    prepare:
      "Create a multi-source Artifact with differing recipient, model, and propagation limits, plus separate approvals from each required owner.",
    action: "Attempt transfer and downgrade with one approval, then with all required approvals.",
    expected:
      "Each permission dimension uses the strictest intersection; propagation or downgrade requires every required review.",
    positiveControl:
      "All required reviews allow exactly the approved destination, recipient, and content version.",
    negativeControl: "Partial approval sends zero payload and cannot relax any dimension.",
    quickstart: ["QS-09.2"],
    capabilities: ["cross_domain_artifact", "derived_label", "approval"],
  },
  {
    id: "T12",
    suite: "t",
    stage: "beta-b1",
    prepare:
      "Register a normal fixed-tool invocation and prepare extra argv, Shell, pipe, replaced-program, and changed-template variants.",
    action:
      "Run the valid invocation, then submit every variant and inspect processes and side effects.",
    expected:
      "The valid control runs within budget; every variant creates no extra process or side effect.",
    positiveControl:
      "The exact template and parameters execute once with a recorded result digest.",
    negativeControl:
      "No Shell, pipe, extra argv, replaced executable, or changed template produces a process or file effect.",
    quickstart: ["QS-09.1"],
    capabilities: ["fixed_tool_execution", "argv_confinement", "injection"],
  },
  {
    id: "T13",
    suite: "t",
    stage: "beta-b1",
    prepare:
      "Prepare environment, mount, network, and Docker-socket probes plus budget limits for two consecutive fixed-tool executions.",
    action: "Inspect host boundaries in both runs, exhaust the budgets, and inspect residue.",
    expected:
      "No host secret or residue is accessible; the default has no network; timeout or exhaustion does not raise the budget.",
    positiveControl:
      "A within-budget execution after the trials still writes only its declared output.",
    negativeControl:
      "Host secrets, extra mounts, network, Docker socket, and residue remain absent, and the budget stays unchanged.",
    quickstart: ["QS-09.2"],
    capabilities: ["fixed_tool_execution", "sandbox_isolation", "resource_budget"],
  },
  {
    id: "T14",
    suite: "t",
    stage: "beta-b1",
    prepare:
      "Prepare a base digest, a valid Patch, a conflicting base, a path-escaping Patch, and an unauthorized application request.",
    action:
      "Generate the Patch, apply the conflict and escape variants, then apply a separately approved Patch.",
    expected:
      "Source files receive zero writes for rejected variants; conflict, escape, and unauthorized requests are refused; a legal application creates a new version and evidence.",
    positiveControl:
      "The approved Patch produces the declared new file digest, version, and application record.",
    negativeControl:
      "Conflict, escaping, and unauthorized applications leave all source files unchanged.",
    quickstart: ["QS-09.3"],
    capabilities: ["patch_application", "path_confinement", "patch_review"],
  },
  {
    id: "T15",
    suite: "t",
    stage: "beta-b0",
    prepare:
      "Prepare a Grant for a multi-part read and an external egress, with revocation points before read, during read, during execution, and before egress.",
    action:
      "Revoke at each point and inspect new access, in-flight operations, and local isolation controls.",
    expected:
      "New access stops immediately, undecided side effects are marked unknown, and an administrator cannot clear local isolation.",
    positiveControl:
      "A read completed before revocation remains in history without extending access.",
    negativeControl:
      "Post-revocation access stops, no new side effect is committed, and remote release of isolation fails.",
    quickstart: ["QS-07.4", "QS-07.5"],
    capabilities: ["revocation", "local_isolation", "in_flight"],
  },
  {
    id: "T16",
    suite: "t",
    stage: "beta-b1",
    prepare:
      "Prepare kill and network-loss points before a side effect, after it but before the receipt, and before the response, with an external counter.",
    action:
      "Kill or disconnect at each point, recover, and replay the request without changing the idempotency key.",
    expected:
      "The system does not falsely report success or failure, does not auto-retry, and retains a pending-confirmation state.",
    positiveControl:
      "A request with a durable receipt returns the same result after recovery and keeps the counter at one.",
    negativeControl:
      "No recovery path creates a second external effect or turns an unknown result into a definite one.",
    quickstart: ["QS-09.4"],
    capabilities: ["fixed_tool_execution", "unknown_outcome", "side_effect_count"],
  },
  {
    id: "T17",
    suite: "t",
    stage: "beta-b1",
    prepare:
      "Run an in-progress handoff with a read Grant, a high-risk Grant, private operator data, and an external expert whose identity will expire.",
    action:
      "Accept the handoff, let the expert expire, and test read access, high-risk access, private data, and attribution.",
    expected:
      "The read Grant follows its original rules, high risk is reconfirmed, private data is not inherited, expert access ends, and attribution remains.",
    positiveControl:
      "The receiver uses the retained read Grant and reapproved high-risk action while the expired expert contribution stays attributed.",
    negativeControl:
      "Private data and expired expert sessions are inaccessible, and the high-risk action is denied without reconfirmation.",
    quickstart: ["QS-10.1"],
    capabilities: ["handoff", "expert_exit", "high_risk_reconfirmation"],
  },
  {
    id: "T18",
    suite: "t",
    stage: "beta-b0",
    prepare:
      "Record a stream of receipted operations while a node is offline, then create one intentional sequence gap and prepare a reconnect.",
    action:
      "Reconnect, submit the offline records, replay duplicates, and inspect completeness metrics.",
    expected:
      "Resubmission is idempotent and creates no new operation; the missing interval is prominent and incomplete records are not counted as complete.",
    positiveControl:
      "Duplicates return their original receipts and the complete interval verifies without a gap.",
    negativeControl:
      "The gap is not hidden, the incomplete interval is not counted as complete, and resubmission creates no extra effect.",
    quickstart: ["QS-08.5"],
    capabilities: ["receipt_integrity", "offline_records", "idempotency"],
  },
  {
    id: "T19",
    suite: "t",
    stage: "beta-b0",
    prepare:
      "Run one malicious node that forges a result, a summary, and a receipt, alongside an honest node with a verifiable chain.",
    action:
      "Verify both displays, isolate the malicious node, request review, and inspect other node access.",
    expected:
      "Only the signing source is confirmed; business truth is not asserted; isolation and review work without expanding other node access.",
    positiveControl:
      "The honest node chain verifies and is displayed as source-authenticated with its digest.",
    negativeControl:
      "The forged claims are never shown as verified truth and isolation grants no new access to other nodes.",
    quickstart: ["QS-08.5"],
    capabilities: ["malicious_node", "receipt_verification", "isolation"],
  },
  {
    id: "T20",
    suite: "t",
    stage: "beta-b0",
    prepare:
      "Create existing Grants, cached content, model routes, and propagation records, then prepare an upgrade, emergency disable, and version withdrawal.",
    action:
      "Upgrade, disable Beta, withdraw the version, and test Grant, cache, model, propagation, evidence, export, and Stable access.",
    expected:
      "Grant, cache, model, and propagation scope does not expand; new Grants pause; evidence and lawful export remain; Stable continues.",
    positiveControl:
      "A pre-existing valid read remains within its original scope and the exported evidence still verifies.",
    negativeControl:
      "Emergency disable and withdrawal create no broader access, and no Stable feature or lawful export is blocked.",
    quickstart: ["QS-07.5"],
    capabilities: ["beta_shutdown", "version_withdrawal", "stable_continuity"],
  },
]);

const validationCaseById = new Map(validationCases.map((entry) => [entry.id, entry]));

export function getValidationCase(id: string): ValidationCase | undefined {
  return validationCaseById.get(id);
}

export function stagePrerequisites(stage: ValidationStage): readonly ValidationStage[] {
  const prerequisites = STAGE_PREREQUISITES[stage];
  if (prerequisites === undefined) {
    throw new RangeError(`Unknown validation stage: ${String(stage)}`);
  }
  return prerequisites;
}

export function isB1OnlyCapability(value: string): value is B1OnlyCapability {
  return (B1_ONLY_CAPABILITIES as readonly string[]).includes(value);
}

export function validationCaseRequiresB1(entry: ValidationCase): boolean {
  return (
    entry.stage === "beta-b1" ||
    entry.capabilities.some((capability) => isB1OnlyCapability(capability))
  );
}

/**
 * Rejects execution that would let a B0 track run B1 work or let Stable run a
 * Beta case. B1 callers must additionally prove B0 completion through
 * stagePrerequisites before executing a case.
 */
export function assertCaseAllowedAtStage(
  entry: ValidationCase,
  executingStage: ValidationStage,
): void {
  if (executingStage === "stable" && entry.stage !== "stable") {
    throw new Error(`${entry.id} requires ${entry.stage} and cannot run in stable`);
  }

  if (executingStage === "beta-b0" && validationCaseRequiresB1(entry)) {
    throw new Error(`${entry.id} requires beta-b1 and cannot run in beta-b0`);
  }
}
