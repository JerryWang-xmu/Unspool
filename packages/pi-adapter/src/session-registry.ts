/**
 * Opens the exact persisted pi session assigned to a workspace attempt.
 *
 * `SessionManager.open()` is deliberately the only restoration entry point:
 * `continueRecent()` may restore another task's most recent session and is not
 * part of the injected SDK port.
 */

import type { PiAgentSessionPort, PiSessionManagerPort } from "./session-adapter.js";

export interface PiExtensionLoadErrorDetail {
  path: string;
  error: string;
}

export interface PiExtensionsResult {
  errors: readonly PiExtensionLoadErrorDetail[];
}

export interface PiCreateAgentSessionResult {
  session: PiAgentSessionPort;
  extensionsResult?: PiExtensionsResult | undefined;
}

export interface PiWorkspaceSdkPort {
  SessionManager: {
    open(path: string, sessionDir?: string, cwdOverride?: string): PiSessionManagerPort;
  };
  createAgentSession(options: {
    cwd: string;
    sessionManager: PiSessionManagerPort;
  }): Promise<PiCreateAgentSessionResult>;
}

export interface OpenWorkspaceSessionInput {
  workspaceId: string;
  cwd: string;
  sessionPath: string;
  sessionDir: string;
  approvalExtensionPath: string;
  sdk: PiWorkspaceSdkPort;
}

export interface OpenedWorkspaceSession {
  sessionManager: PiSessionManagerPort;
  session: PiAgentSessionPort;
  extensionsResult: PiExtensionsResult;
}

export class PiExtensionLoadError extends Error {
  readonly code = "extension_load_failed";
  readonly workspaceId: string;
  readonly approvalExtensionPath: string;
  readonly errors: readonly PiExtensionLoadErrorDetail[];

  constructor(
    workspaceId: string,
    approvalExtensionPath: string,
    errors: readonly PiExtensionLoadErrorDetail[],
  ) {
    const summary = errors.map(({ path, error }) => `${path}: ${error}`).join("; ");
    super(
      `Pi extension load failed for workspace ${workspaceId} while loading ${approvalExtensionPath}: ${summary}`,
    );
    this.name = "PiExtensionLoadError";
    this.workspaceId = workspaceId;
    this.approvalExtensionPath = approvalExtensionPath;
    this.errors = errors;
  }
}

export async function openWorkspaceSession(
  input: OpenWorkspaceSessionInput,
): Promise<OpenedWorkspaceSession> {
  const { workspaceId, cwd, sessionPath, sessionDir, approvalExtensionPath, sdk } = input;

  if (typeof sessionPath !== "string" || sessionPath.trim().length === 0) {
    throw new TypeError("openWorkspaceSession requires an explicit sessionPath");
  }
  if (typeof cwd !== "string" || cwd.trim().length === 0) {
    throw new TypeError("openWorkspaceSession requires an explicit cwd");
  }

  const sessionManager = sdk.SessionManager.open(sessionPath, sessionDir, cwd);
  const created = await sdk.createAgentSession({ cwd, sessionManager });

  const extensionsResult = created.extensionsResult;
  if (extensionsResult === undefined || !Array.isArray(extensionsResult.errors)) {
    throw new PiExtensionLoadError(workspaceId, approvalExtensionPath, [
      {
        path: approvalExtensionPath,
        error: "extension load result is missing",
      },
    ]);
  }
  if (extensionsResult.errors.length > 0) {
    throw new PiExtensionLoadError(workspaceId, approvalExtensionPath, extensionsResult.errors);
  }

  created.session.agent.toolExecution = "sequential";

  return {
    sessionManager,
    session: created.session,
    extensionsResult,
  };
}
